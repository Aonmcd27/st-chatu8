// @ts-nocheck
/**
 * 文本占位符查找和替换
 */

import { extension_settings } from "../../../../../extensions.js";
import { eventSource, saveChatConditional } from "../../../../../../script.js";
import { getContext } from "../../../../../st-context.js";
import { extensionName, EventType } from '../config.js';
import { getItemImg } from '../database.js';
import { getcharData, setcharData } from '../promptReq.js';
import { fuzzyMatchLine, removeThinkingTextOnly } from '../imageInserter.js';
import { findNodeAtPosition, generateStableId, generateElKey } from './utils.js';
import { createAndShowImage, triggerGeneration } from './generation.js';
import { showEditDialog } from './dialogs.js';
import { isGenerating } from '../generation_status.js';

/**
 * 获取配置的标签前缀和后缀，带容错
 * @returns {{startTag: string, endTag: string}}
 */
function getImageTags() {
    const settings = extension_settings[extensionName];
    const startTag = settings?.startTag || 'image###';
    const endTag = settings?.endTag || '###';
    return { startTag, endTag };
}

/**
 * 从 tag 中提取纯内容（startTag 和 endTag 之间的部分）
 * 支持 tagthinkEcho=true 时 tag 格式为 <imgthink>...</imgthink>\nimage@@@...@@@ 的情况
 * @param {string} tag - 原始 tag 内容
 * @param {string} startTag - 前缀标签
 * @param {string} endTag - 后缀标签
 * @returns {string} 纯 tag 内容
 */
function extractPureTag(tag, startTag, endTag) {
    if (!tag) return tag;
    // 用正则提取 startTag 和 endTag 之间的内容
    const escapedStart = startTag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const escapedEnd = endTag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const pureTagRegex = new RegExp(`${escapedStart}([\\s\\S]*?)${escapedEnd}`);
    const pureTagMatch = tag.match(pureTagRegex);
    if (pureTagMatch) {
        return pureTagMatch[1].trim();
    }
    // 如果没有匹配到前后缀，返回原始 tag
    return tag;
}

/**
 * 检查保存的 image groups
 * mes_text 元素：优先从 chat[id].extra.images[swipe_id] 查找，使用模糊匹配定位
 * 非 mes_text 元素：使用 el 中间 20 字符作为 key 查找
 * @param {string} logicalText - 当前元素的逻辑文本（完整版，用于 elKey 生成和位置重映射）
 * @param {HTMLElement} rootElement - 根元素（用于检查是否已存在按钮/图片）
 * @param {string} [logicalTextForMatchOverride] - 可选，用于模糊匹配的文本（已排除第一个 div 等内容）
 * @param {number} [firstDivEndOffset=0] - 可选，第一个 div 在 logicalText 中的结束位置，用于 indexOf 重映射时跳过第一个 div
 * @returns {Promise<Array<{content: string, insertPosition: number}>>} 需要创建按钮的匹配列表
 */
export async function getSavedImageMatches(logicalText, rootElement, logicalTextForMatchOverride, firstDivEndOffset = 0) {
    const result = [];
    try {
        // 检查是否已存在 image 元素
        const existingImage = rootElement.querySelector(`.st-chatu8-image-container`);
        if (existingImage) {
            return result;
        }

        // ★ indexOf 重映射的搜索起始位置：跳过第一个 div 的文本范围
        const indexOfSearchStart = firstDivEndOffset > 0 ? firstDivEndOffset : 0;

        // 排除思考文本后的文本，用于 textHasTag 检查，与 imageInserter.js 保持一致
        // 如果调用方提供了已排除第一个 div 的文本，则在此基础上排除思考文本
        const logicalTextForMatch = removeThinkingTextOnly(logicalTextForMatchOverride || logicalText);

        // === 新逻辑：检查是否是 mes_text 元素 ===
        if (rootElement?.classList?.contains('mes_text')) {
            // 获取消息 ID（优先从 data-mesid 属性获取，回退到 grandparent 的 mesid 属性）
            let idStr = rootElement.getAttribute('data-mesid');
            if (!idStr) {
                const grandParent = rootElement.parentElement?.parentElement;
                idStr = grandParent?.getAttribute('mesid');
            }

            if (idStr) {
                const id = parseInt(idStr, 10);
                const context = getContext();

                if (context.chat && context.chat[id]) {
                    // 获取 swipe_id，如果不存在则默认为 0
                    const key = context.chat[id].swipe_id ?? 0;

                    // 从 extra.images[key] 获取数据
                    const extraImages = context.chat[id].extra?.images?.[key];

                    if (Array.isArray(extraImages) && extraImages.length > 0) {
                        // 使用模糊匹配定位每个 tag
                        const { startTag, endTag } = getImageTags();
                        for (const img of extraImages) {
                            // ★ 修复：img.tag 可能已经包含前后缀（tagthinkEcho=true 时 tag 可能是 <tagthink>...</tagthink>\nimage@@@...@@@）
                            // 检查 tag 是否包含前后缀（不仅是开头结尾），避免重复包裹
                            const alreadyWrapped = img.tag.includes(startTag) && img.tag.includes(endTag);
                            const imageTagText = alreadyWrapped ? img.tag : `${startTag}${img.tag}${endTag}`;
                            // ★ 修复：当 alreadyWrapped=true 时，imageTagText 包含 <tagthink> 内容
                            // 需要用原始 logicalText 检查，因为 logicalTextForMatch 已经移除了思考文本
                            const textHasTag = alreadyWrapped
                                ? logicalText.includes(imageTagText)
                                : logicalTextForMatch.includes(imageTagText);

                            // ★ 用于 button 查询的 link：如果包含前后缀则提取纯内容，否则直接用 tag
                            const linkForQuery = alreadyWrapped
                                ? (() => {
                                    const escapedStart = startTag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                                    const escapedEnd = endTag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                                    const pureTagRegex = new RegExp(`${escapedStart}([\\s\\S]*?)${escapedEnd}`);
                                    const pureTagMatch = img.tag.match(pureTagRegex);
                                    return pureTagMatch ? pureTagMatch[1].trim() : img.tag;
                                })()
                                : img.tag;
                            const existingButton = rootElement.querySelector(
                                `button.image-tag-button[data-link="${CSS.escape(linkForQuery)}"], button.image-tag-button[data-image-tag="${CSS.escape(linkForQuery)}"]`
                            );

                            if (!existingButton && !textHasTag) {
                                // 使用 fuzzyMatchLine 进行模糊匹配定位（使用排除思考文本后的版本）
                                const matchResult = fuzzyMatchLine(logicalTextForMatch, img.regex, 0.5);

                                if (matchResult) {
                                    // ★ 位置重映射：matchResult.endIndex 是相对于 logicalTextForMatch 的位置
                                    // 需要用匹配到的行内容在原始 logicalText 中重新定位，与 imageInserter.js 保持一致
                                    let correctEndIndex = matchResult.endIndex;
                                    const matchedLine = matchResult.matchedLine;
                                    // ★ 从第一个 div 之后开始搜索，避免匹配到第一个 div 内的相同文本
                                    let lineIndexInOriginal = logicalText.indexOf(matchedLine, indexOfSearchStart);
                                    if (lineIndexInOriginal === -1) {
                                        lineIndexInOriginal = logicalText.indexOf(matchedLine); // 备选：全文搜索
                                    }
                                    if (lineIndexInOriginal !== -1) {
                                        correctEndIndex = lineIndexInOriginal + matchedLine.length;
                                    }
                                    result.push({
                                        content: img.tag,
                                        insertPosition: correctEndIndex
                                    });
                                } else {
                                    // 模糊匹配失败，使用保存的 endIndex 作为回退
                                    result.push({
                                        content: img.tag,
                                        insertPosition: img.endIndex
                                    });
                                }
                            }
                        }

                        if (result.length > 0) {
                            console.log('[iframe] Matched from chat[' + id + '].extra.images[' + key + '], tags:', result.length);
                        }
                        return result;
                    }

                    // === 回退到旧逻辑，并迁移数据 ===
                    const imageGroups = await getcharData('image_groups') || {};
                    const elKey = generateElKey(logicalText);

                    if (elKey && imageGroups[elKey]) {
                        const oldImages = imageGroups[elKey];

                        // 迁移到新位置
                        if (!context.chat[id].extra) {
                            context.chat[id].extra = {};
                        }
                        if (!context.chat[id].extra.images) {
                            context.chat[id].extra.images = {};
                        }
                        context.chat[id].extra.images[key] = oldImages;

                        // 删除旧位置的数据
                        delete imageGroups[elKey];
                        await setcharData('image_groups', imageGroups);

                        // 保存聊天记录
                        saveChatConditional();

                        console.log('[iframe] Migrated image group from elKey:', elKey, 'to chat[' + id + '].extra.images[' + key + ']');

                        // 使用迁移后的数据继续处理
                        const { startTag, endTag } = getImageTags();
                        for (const img of oldImages) {
                            // ★ 修复：img.tag 可能已经包含前后缀（tagthinkEcho=true 时 tag 可能是 <tagthink>...</tagthink>\nimage@@@...@@@）
                            const alreadyWrapped = img.tag.includes(startTag) && img.tag.includes(endTag);
                            const imageTagText = alreadyWrapped ? img.tag : `${startTag}${img.tag}${endTag}`;
                            // ★ 修复：当 alreadyWrapped=true 时，用原始 logicalText 检查
                            const textHasTag = alreadyWrapped
                                ? logicalText.includes(imageTagText)
                                : logicalTextForMatch.includes(imageTagText);

                            // ★ 用于 button 查询的 link：如果包含前后缀则提取纯内容，否则直接用 tag
                            const linkForQuery = alreadyWrapped
                                ? (() => {
                                    const escapedStart = startTag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                                    const escapedEnd = endTag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                                    const pureTagRegex = new RegExp(`${escapedStart}([\\s\\S]*?)${escapedEnd}`);
                                    const pureTagMatch = img.tag.match(pureTagRegex);
                                    return pureTagMatch ? pureTagMatch[1].trim() : img.tag;
                                })()
                                : img.tag;
                            const existingButton = rootElement.querySelector(
                                `button.image-tag-button[data-link="${CSS.escape(linkForQuery)}"], button.image-tag-button[data-image-tag="${CSS.escape(linkForQuery)}"]`
                            );

                            if (!existingButton && !textHasTag) {
                                // 使用 fuzzyMatchLine 进行模糊匹配定位（使用排除思考文本后的版本）
                                const matchResult = fuzzyMatchLine(logicalTextForMatch, img.regex, 0.5);

                                if (matchResult) {
                                    // ★ 位置重映射：与 imageInserter.js 保持一致
                                    let correctEndIndex = matchResult.endIndex;
                                    const matchedLine = matchResult.matchedLine;
                                    // ★ 从第一个 div 之后开始搜索，避免匹配到第一个 div 内的相同文本
                                    let lineIndexInOriginal = logicalText.indexOf(matchedLine, indexOfSearchStart);
                                    if (lineIndexInOriginal === -1) {
                                        lineIndexInOriginal = logicalText.indexOf(matchedLine); // 备选：全文搜索
                                    }
                                    if (lineIndexInOriginal !== -1) {
                                        correctEndIndex = lineIndexInOriginal + matchedLine.length;
                                    }
                                    result.push({
                                        content: img.tag,
                                        insertPosition: correctEndIndex
                                    });
                                } else {
                                    result.push({
                                        content: img.tag,
                                        insertPosition: img.endIndex
                                    });
                                }
                            }
                        }

                        if (result.length > 0) {
                            console.log('[iframe] Matched from migrated data, tags:', result.length);
                        }
                        return result;
                    }

                    // 新旧位置都没有数据
                    return result;
                }
            }
        }

        // === 非 mes_text 元素：保持原有逻辑 ===
        const imageGroups = await getcharData('image_groups') || {};

        // 使用中间 20 字符作为 key 直接查找（O(1)）
        const elKey = generateElKey(logicalText);
        if (!elKey) return result;

        const images = imageGroups[elKey];
        if (!Array.isArray(images) || images.length === 0) return result;

        // 遍历每个保存的 tag，检查是否需要创建按钮
        const { startTag, endTag } = getImageTags();
        for (const img of images) {
            // ★ 修复：img.tag 可能已经包含前后缀（tagthinkEcho=true 时 tag 可能是 <tagthink>...</tagthink>\nimage@@@...@@@）
            const alreadyWrapped = img.tag.includes(startTag) && img.tag.includes(endTag);
            const imageTagText = alreadyWrapped ? img.tag : `${startTag}${img.tag}${endTag}`;
            // ★ 修复：当 alreadyWrapped=true 时，用原始 logicalText 检查
            const textHasTag = alreadyWrapped
                ? logicalText.includes(imageTagText)
                : logicalTextForMatch.includes(imageTagText);

            // ★ 用于 button 查询的 link：如果包含前后缀则提取纯内容，否则直接用 tag
            const linkForQuery = alreadyWrapped
                ? (() => {
                    const escapedStart = startTag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                    const escapedEnd = endTag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                    const pureTagRegex = new RegExp(`${escapedStart}([\\s\\S]*?)${escapedEnd}`);
                    const pureTagMatch = img.tag.match(pureTagRegex);
                    return pureTagMatch ? pureTagMatch[1].trim() : img.tag;
                })()
                : img.tag;
            const existingButton = rootElement.querySelector(
                `button.image-tag-button[data-link="${CSS.escape(linkForQuery)}"], button.image-tag-button[data-image-tag="${CSS.escape(linkForQuery)}"]`
            );

            if (!existingButton && !textHasTag) {
                result.push({
                    content: img.tag,
                    insertPosition: img.endIndex
                });
            }
        }

        if (result.length > 0) {
            console.log('[iframe] Matched image group by key:', elKey, 'tags:', result.length);
        }
    } catch (e) {
        console.error('[iframe] Error in getSavedImageMatches:', e);
    }
    return result;
}

/**
 * 在指定位置创建并插入按钮和 imgSpan（直接创建元素，不插入文本标签）
 * @param {number} insertPosition - 插入位置（在 logicalText 中的索引）
 * @param {string} tag - 图片标签内容
 * @param {Array} nodeInfos - 节点信息数组
 * @param {Document} doc - 文档对象
 * @param {HTMLElement} rootElement - 根元素
 * @param {object} settings - 扩展设置
 * @param {boolean} shouldAutoClickBatch - 是否应该自动点击（直接触发生成）
 * @param {string} imageAlt - 图片替代文本
 * @returns {Promise<void>}
 */
export async function createButtonAtPosition(insertPosition, tag, nodeInfos, doc, rootElement, settings, shouldAutoClickBatch, imageAlt = 'Generated Image') {
    // ★ 修复：tag 可能已经包含前后缀（tagthinkEcho=true 时 tag 可能是 <imgthink>...</imgthink>\nimage@@@...@@@）
    // 当 tag 包含前后缀时，提取纯 tag 用于按钮，同时提取前缀文本（thinking 内容）用于直接插入 DOM
    const { startTag, endTag } = getImageTags();
    const alreadyWrapped = tag.includes(startTag) && tag.includes(endTag);
    const pureTag = extractPureTag(tag, startTag, endTag);

    // 提取 thinking 前缀文本（startTag...endTag 之前的内容）
    let thinkingPrefix = '';
    if (alreadyWrapped && pureTag !== tag) {
        const escapedStart = startTag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const escapedEnd = endTag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const tagPatternRegex = new RegExp(`${escapedStart}[\\s\\S]*?${escapedEnd}`);
        const tagMatch = tag.match(tagPatternRegex);
        if (tagMatch) {
            const matchIndex = tag.indexOf(tagMatch[0]);
            if (matchIndex > 0) {
                thinkingPrefix = tag.substring(0, matchIndex);
            }
        }
    }

    const link = pureTag.replaceAll("《", "<").replaceAll("》", ">").replaceAll("\n", "");
    const requestId = generateStableId(link);
    const tagInsertedMarker = `tag-inserted-${requestId}`;

    // 检测1：检查该tag是否已被插入（使用独立的tag插入标记）
    const tagMarkerAttr = `data-${tagInsertedMarker}`;
    if (rootElement.hasAttribute && rootElement.hasAttribute(tagMarkerAttr)) {
        // 检查按钮是否真的存在，如果不存在则清除标记并继续
        const existingButton = rootElement.querySelector(
            `button.image-tag-button[data-link="${CSS.escape(link)}"], button.image-tag-button[data-image-tag="${CSS.escape(link)}"]`
        );
        if (existingButton) {
            console.log('[iframe] Tag already inserted with button, skipping:', tag.substring(0, 50));
            return null;
        } else {
            // 标记存在但按钮不存在（可能被编辑删除了），清除标记并继续插入
            console.log('[iframe] Tag marker exists but button missing, re-inserting:', tag.substring(0, 50));
            rootElement.removeAttribute(tagMarkerAttr);
        }
    }

    // 检测2：检查是否已存在具有该 tag 的按钮（按钮生成的独立检测）
    const existingButton = rootElement.querySelector(
        `button.image-tag-button[data-link="${CSS.escape(link)}"], button.image-tag-button[data-image-tag="${CSS.escape(link)}"]`
    );
    if (existingButton) {
        console.log('[iframe] Button already exists, skipping:', link.substring(0, 50), 'loading:', existingButton.hasAttribute('data-loading'));
        // 即使按钮已存在，也标记tag已插入
        if (rootElement.setAttribute) {
            rootElement.setAttribute(tagMarkerAttr, 'true');
        }
        return null;
    }

    // 使用二分查找定位节点 (O(log n))
    const targetNodeInfo = findNodeAtPosition(nodeInfos, insertPosition);
    if (!targetNodeInfo) {
        console.warn('[iframe] Could not find target node for position:', insertPosition);
        return null;
    }

    // 标记该tag已插入（在创建按钮之前标记，防止并发重复插入）
    if (rootElement.setAttribute) {
        rootElement.setAttribute(tagMarkerAttr, 'true');
    }

    // 创建按钮
    const button = doc.createElement('button');
    button.className = 'image-tag-button st-chatu8-image-button';
    button.textContent = '生成图片';
    button.dataset.link = link;
    button.dataset.requestId = requestId;
    button.dataset.imageTag = link;

    // 添加事件监听器
    let pressTimer = null;
    let isLongPress = false;
    const longPressThreshold = 1200;

    const handlePressStart = (e) => {
        if (e.type === 'mousedown' && e.button !== 0) return;
        isLongPress = false;
        pressTimer = setTimeout(() => {
            isLongPress = true;
            pressTimer = null;
            e.preventDefault();
            if (settings.longPressToEdit == "true") {
                showEditDialog(null, button);
            }
        }, longPressThreshold);
    };

    const handlePressEnd = () => {
        if (pressTimer) {
            clearTimeout(pressTimer);
            pressTimer = null;
        }
    };

    button.addEventListener('click', (e) => {
        if (isLongPress) {
            e.preventDefault();
            e.stopPropagation();
            return;
        }
        e.preventDefault();
        triggerGeneration(button);
    });

    button.addEventListener('mousedown', handlePressStart);
    button.addEventListener('mouseup', handlePressEnd);
    button.addEventListener('mouseleave', handlePressEnd);
    button.addEventListener('touchstart', handlePressStart);
    button.addEventListener('touchend', handlePressEnd);
    button.addEventListener('touchcancel', handlePressEnd);

    // 创建 imgSpan
    const imgSpan = doc.createElement('span');
    imgSpan.className = 'st-chatu8-image-span';
    imgSpan.dataset.requestId = requestId;

    // 在目标位置插入按钮和 imgSpan
    const range = doc.createRange();
    try {
        const targetNode = targetNodeInfo.node;
        const offsetInNode = insertPosition - targetNodeInfo.start;

        if (targetNode.nodeType === Node.TEXT_NODE) {
            range.setStart(targetNode, offsetInNode);
            range.setEnd(targetNode, offsetInNode);
        } else {
            range.setStartAfter(targetNode);
            range.setEndAfter(targetNode);
        }

        // insertNode 在 range 起始位置插入，后插入的在前面
        // 顺序：先插 imgSpan，再插 button（button 在 imgSpan 前），再插 thinkingPrefix（在 button 前）
        range.insertNode(imgSpan);
        range.insertNode(button);

        // ★ tagthinkEcho=true 时：将 thinking 前缀文本直接插入 DOM（在按钮之前）
        // 使用 <image> 标签包裹，innerHTML 解析 HTML 标签（如 <font>, <Tag_think> 等）
        if (thinkingPrefix) {
            const imageWrapper = doc.createElement('image');
            imageWrapper.innerHTML = thinkingPrefix;
            // 用 <p> 包裹实现换行分段，避免与后续按钮/文本挤在一起
            const pWrapper = doc.createElement('p');
            pWrapper.appendChild(imageWrapper);
            range.insertNode(pWrapper);
        }
    } catch (e) {
        console.error('[iframe] Error inserting button at position:', e);
        return null;
    }

    const [imageUrl, change, , isVideo, originalUrl] = await getItemImg(link);
    if (imageUrl) {
        createAndShowImage(imgSpan, imageUrl, imageAlt, button, change, isVideo, originalUrl);
        if (settings.dbclike === "true") {
            button.style.setProperty('display', 'none', 'important');
        }
    } else if (shouldAutoClickBatch) {
        // 直接触发生成，无需返回按钮
        console.log('[iframe] 自动点击直接触发生成:', button);
        triggerGeneration(button);
    } else if (isGenerating(link)) {
        console.log('[iframe] 图像正在预生成中，自动挂载监听器:', button);
        triggerGeneration(button);
    }
}

/**
 * Core worker function to find and replace placeholders within a given root element
 * @param {HTMLElement} rootElement - 根元素
 * @param {string} imageAlt - 图片替代文本
 */
export async function findAndReplaceInElement(rootElement, imageAlt = 'Generated Image') {
    if (!rootElement) {
        return;
    }

    // 如果元素已经被处理过，检查内容是否发生变化
    if (rootElement.dataset && rootElement.dataset.chatu8Processed === 'true') {
        // 获取当前内容长度
        const currentLength = rootElement.textContent?.length || 0;
        const storedLength = parseInt(rootElement.dataset.chatu8ContentLength || '0', 10);

        // 如果内容长度发生变化，清除标记并重新处理
        if (currentLength !== storedLength) {
            console.log('[iframe] Content length changed, re-processing:', { stored: storedLength, current: currentLength });
            delete rootElement.dataset.chatu8Processed;
            delete rootElement.dataset.chatu8ContentLength;
        } else {
            // 内容长度未变化，检查按钮是否仍然存在
            const anyButton = rootElement.querySelector('button.image-tag-button');
            if (anyButton) {
                return; // 有按钮且内容未变，跳过处理
            } else {
                // 没有按钮（可能被编辑删除了），清除标记并继续处理
                console.log('[iframe] Element marked processed but no buttons found, re-processing');
                delete rootElement.dataset.chatu8Processed;
                delete rootElement.dataset.chatu8ContentLength;
            }
        }
    }

    // 如果元素内有正在加载中的按钮，跳过处理，防止重复创建
    const loadingButton = rootElement.querySelector('button.image-tag-button[data-loading="true"]');
    if (loadingButton) {
        console.log('[iframe] Element has loading button, skipping processing');
        return;
    }

    const settings = extension_settings[extensionName];

    // 空值检测：防止 startTag 或 endTag 为空时构建出会导致无限匹配的正则表达式，造成浏览器崩溃
    if (!settings.startTag || !settings.endTag) {
        console.warn('[iframe] startTag or endTag is empty, skipping placeholder processing');
        return;
    }

    const shouldAutoClickBatch = settings.zidongdianji === "true" && window.zidongdianji;
    const escapeRegExp = (string) => {
        return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    };
    const pattern = new RegExp(`${escapeRegExp(settings.startTag)}([\\s\\S]*?)${escapeRegExp(settings.endTag)}`, 'g');
    const doc = rootElement.ownerDocument || rootElement;

    // 1. Build a flat list of relevant nodes (text and <br>) and a logical text representation.
    // ★ 标记第一个直接子 <div> 元素，后续匹配时排除其文本范围
    const firstDirectDiv = rootElement.querySelector(':scope > div');
    if (firstDirectDiv) {
        // console.log('[placeholder] Will exclude first direct <div> from matching:', firstDirectDiv.textContent?.substring(0, 50));
    }
    let firstDivStartOffset = -1;
    let firstDivEndOffset = -1;

    const nodeInfos = [];
    let logicalText = '';
    // 需要排除的代码相关标签
    const CODE_RELATED_TAGS = new Set([
        'SCRIPT', 'STYLE', 'BUTTON',
        'PRE', 'CODE',           // 代码块
        'TEXTAREA',              // 输入框
        'KBD', 'SAMP', 'VAR'     // 键盘输入、示例输出、变量
    ]);

    // 代码高亮库常用的类名前缀
    const CODE_CLASS_PATTERNS = ['hljs', 'highlight', 'prism', 'language-', 'CodeMirror', 'ace_'];

    const walker = doc.createTreeWalker(rootElement, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT, {
        acceptNode: function (node) {
            const parent = node.parentElement;
            const parentTag = parent?.tagName;

            if (node.nodeType === Node.ELEMENT_NODE && node.tagName !== 'BR') {
                return NodeFilter.FILTER_SKIP; // Skip non-BR elements but check their children
            }

            // 排除代码相关标签
            if (CODE_RELATED_TAGS.has(parentTag)) {
                return NodeFilter.FILTER_REJECT;
            }

            // 排除插件自身的元素
            if (parent?.classList.contains('image-tag-button') || parent?.classList.contains('st-chatu8-image-span')) {
                return NodeFilter.FILTER_REJECT;
            }

            // 排除代码高亮库的元素（检查类名）
            if (parent?.className && typeof parent.className === 'string') {
                for (const pattern of CODE_CLASS_PATTERNS) {
                    if (parent.className.includes(pattern)) {
                        return NodeFilter.FILTER_REJECT;
                    }
                }
            }

            return NodeFilter.FILTER_ACCEPT;
        }
    });

    let n;
    while (n = walker.nextNode()) {
        const start = logicalText.length;
        let text = '';
        if (n.nodeType === Node.TEXT_NODE) {
            text = n.textContent;
        } else if (n.tagName === 'BR') {
            text = '\n';
        }

        // ★ 追踪第一个直接子 <div> 的文本范围
        if (firstDirectDiv && text.length > 0) {
            const isInFirstDiv = (n === firstDirectDiv || firstDirectDiv.contains(n));
            if (isInFirstDiv) {
                if (firstDivStartOffset === -1) {
                    firstDivStartOffset = start;
                }
                firstDivEndOffset = start + text.length;
            }
        }

        logicalText += text;
        nodeInfos.push({ node: n, start: start, end: logicalText.length });
    }

    // ★ 构建排除第一个 <div> 内容后的文本，用于模糊匹配
    let logicalTextExcludingFirstDiv = logicalText;
    if (firstDirectDiv && firstDivStartOffset !== -1 && firstDivEndOffset > firstDivStartOffset) {
        const beforeDiv = logicalText.substring(0, firstDivStartOffset);
        const afterDiv = logicalText.substring(firstDivEndOffset);
        logicalTextExcludingFirstDiv = beforeDiv + afterDiv;
        // console.log(`[placeholder] Excluded first <div> text from matching (removed ${firstDivEndOffset - firstDivStartOffset} chars)`);
    }

    // 2. Find all matches in the logical text.
    const patternMatches = [];
    let match;
    while ((match = pattern.exec(logicalText)) !== null) {
        patternMatches.push({
            fullMatch: match[0],
            content: match[1],
            startIndex: match.index,
            endIndex: match.index + match[0].length,
            isPatternMatch: true  // 标记为 pattern 匹配，需要替换原文本
        });
    }

    // 3. 获取 saved image matches（联动：一次扫描，两种来源）
    // ★ 传入排除第一个 <div> 后的文本和 div 结束偏移量，避免图片标签匹配到第一个 <div> 中的内容
    const savedMatches = await getSavedImageMatches(logicalText, rootElement, logicalTextExcludingFirstDiv, firstDivEndOffset > 0 ? firstDivEndOffset : 0);

    // 如果两个都为空，则无需处理
    if (patternMatches.length === 0 && savedMatches.length === 0) return;

    const clickPromises = [];
    // 收集需要自动点击的按钮（按创建顺序，即倒序）
    const buttonsToAutoClick = [];

    // 4. 先处理 saved matches（这些只需要插入按钮，不需要删除原文本）
    // 按 insertPosition 降序排序，从后往前插入避免索引偏移
    const sortedSavedMatches = [...savedMatches].sort((a, b) => b.insertPosition - a.insertPosition);
    for (const savedMatch of sortedSavedMatches) {
        const promise = createButtonAtPosition(
            savedMatch.insertPosition,
            savedMatch.content,
            nodeInfos,
            doc,
            rootElement,
            settings,
            shouldAutoClickBatch,  // 非插入原文模式也支持自动点击
            imageAlt
        );
        clickPromises.push(promise);
    }

    // 5. Process pattern matches in reverse to avoid DOM manipulation conflicts.
    for (let i = patternMatches.length - 1; i >= 0; i--) {
        const matchInfo = patternMatches[i];

        // Find all nodes involved in this match
        const nodesToProcess = nodeInfos.filter(info =>
            (matchInfo.startIndex < info.end) && (matchInfo.endIndex > info.start)
        );

        if (nodesToProcess.length === 0) continue;

        const firstNodeInfo = nodesToProcess[0];
        const lastNodeInfo = nodesToProcess[nodesToProcess.length - 1];
        const parent = firstNodeInfo.node.parentNode;

        // 4. Use the Range API for robust DOM manipulation.
        const range = doc.createRange();
        try {
            // Set the start of the range, with validation to prevent IndexSizeError
            const startOffset = matchInfo.startIndex - firstNodeInfo.start;
            if (firstNodeInfo.node.nodeType === Node.TEXT_NODE) {
                const startTextLength = firstNodeInfo.node.textContent?.length ?? 0;
                if (startTextLength === 0 || startOffset > startTextLength) {
                    console.warn('[iframe] StartOffset out of bounds:', { startOffset, startTextLength, matchInfo });
                    continue; // Skip this match as DOM has changed
                }
                range.setStart(firstNodeInfo.node, startOffset);
            } else {
                range.setStartBefore(firstNodeInfo.node);
            }

            // Set the end of the range, handling text nodes and element nodes differently.
            const endNode = lastNodeInfo.node;
            const endOffset = matchInfo.endIndex - lastNodeInfo.start;

            if (endNode.nodeType === Node.TEXT_NODE) {
                // For a text node, the offset is a character count.
                // Validate offset against actual node length to prevent IndexSizeError
                const textLength = endNode.textContent?.length ?? 0;
                if (textLength === 0 || endOffset > textLength) {
                    console.warn('[iframe] EndOffset out of bounds:', { endOffset, textLength, matchInfo });
                    continue; // Skip this match as DOM has changed
                }
                range.setEnd(endNode, endOffset);
            } else {
                // For an element node (like <br>), we can't use a character offset.
                // Instead, we set the boundary of the range to be *after* the element.
                range.setEndAfter(endNode);
            }
        } catch (e) {
            console.error("st-chatu8: Error setting range. Skipping match.", e, matchInfo);
            continue;
        }

        // 5. Delete the matched content.
        range.deleteContents();

        // 6. Create and insert the new elements (button and span).
        const link = matchInfo.content.trim().replaceAll("《", "<").replaceAll("》", ">").replaceAll("\n", "");
        const requestId = generateStableId(link);
        const tagInsertedMarker = `tag-inserted-${requestId}`;

        // 检测1：检查该tag是否已被插入（使用独立的tag插入标记）
        const tagMarkerAttr = `data-${tagInsertedMarker}`;
        if (rootElement.hasAttribute && rootElement.hasAttribute(tagMarkerAttr)) {
            // 检查按钮是否真的存在，如果不存在则清除标记并继续
            const existingBtn = rootElement.querySelector(`button.image-tag-button[data-link="${CSS.escape(link)}"]`);
            if (existingBtn) {
                console.log('[iframe] Tag already inserted with button, skipping:', link.substring(0, 50));
                continue;
            } else {
                // 标记存在但按钮不存在（可能被编辑删除了），清除标记并继续插入
                console.log('[iframe] Tag marker exists but button missing, re-inserting:', link.substring(0, 50));
                rootElement.removeAttribute(tagMarkerAttr);
            }
        }

        // 检测2：检查是否已存在相同 tag 的按钮（按钮生成的独立检测）
        const existingBtn = rootElement.querySelector(`button.image-tag-button[data-link="${CSS.escape(link)}"]`);
        if (existingBtn) {
            console.log('[iframe] Button already exists, skipping:', link.substring(0, 50), 'loading:', existingBtn.hasAttribute('data-loading'));
            // 即使按钮已存在，也标记tag已插入
            if (rootElement.setAttribute) {
                rootElement.setAttribute(tagMarkerAttr, 'true');
            }
            continue;
        }

        // 标记该tag已插入（在创建按钮之前标记，防止并发重复插入）
        if (rootElement.setAttribute) {
            rootElement.setAttribute(tagMarkerAttr, 'true');
        }

        const button = doc.createElement('button');
        button.className = 'image-tag-button st-chatu8-image-button';
        button.textContent = '生成图片';
        button.dataset.link = link;
        button.dataset.requestId = requestId;
        button.dataset.imageTag = link;

        // Copy event listeners for the button
        let pressTimer = null;
        let isLongPress = false;
        const longPressThreshold = 1200;

        const handlePressStart = (e) => {
            if (e.type === 'mousedown' && e.button !== 0) return;
            isLongPress = false;
            pressTimer = setTimeout(() => {
                isLongPress = true;
                pressTimer = null;
                e.preventDefault();
                if (extension_settings[extensionName].longPressToEdit == "true") {
                    showEditDialog(null, button);
                }
            }, longPressThreshold);
        };

        const handlePressEnd = () => {
            if (pressTimer) {
                clearTimeout(pressTimer);
                pressTimer = null;
            }
        };

        button.addEventListener('click', (e) => {
            if (isLongPress) {
                e.preventDefault();
                e.stopPropagation();
                return;
            }
            e.preventDefault();
            triggerGeneration(button);
        });

        button.addEventListener('mousedown', handlePressStart);
        button.addEventListener('mouseup', handlePressEnd);
        button.addEventListener('mouseleave', handlePressEnd);
        button.addEventListener('touchstart', handlePressStart);
        button.addEventListener('touchend', handlePressEnd);
        button.addEventListener('touchcancel', handlePressEnd);

        // Styles are now handled by CSS class .st-chatu8-image-button
        // button.style.cssText = ... removed to allow theming

        const imgSpan = doc.createElement('span');
        imgSpan.className = 'st-chatu8-image-span';
        imgSpan.dataset.requestId = requestId;

        // Insert the new nodes at the now-collapsed range.
        // insertNode inserts at the start of the range. The last one inserted appears first.
        range.insertNode(imgSpan);
        range.insertNode(button);

        // 7. Asynchronously load image if it exists, or collect button for auto-click.
        const promise = (async () => {
            const [imageUrl, change, , isVideo, originalUrl] = await getItemImg(link);
            if (imageUrl) {
                createAndShowImage(imgSpan, imageUrl, imageAlt, button, change, isVideo, originalUrl);
                if (extension_settings[extensionName].dbclike === "true") {
                    button.style.setProperty('display', 'none', 'important');
                }
            } else if (shouldAutoClickBatch) {
                // 收集按钮，稍后按正序触发（当前是倒序遍历，所以用 unshift 插入到开头）
                buttonsToAutoClick.unshift(button);
            } else if (isGenerating(link)) {
                console.log('[iframe] 图像正在预生成中，自动挂载监听器:', button);
                triggerGeneration(button);
            }
        })();

        clickPromises.push(promise);
    }

    // 等待所有按钮创建和缓存检查完成
    Promise.all(clickPromises).then(() => {
        // 按正序（从上到下）触发自动生成
        if (buttonsToAutoClick.length > 0) {
            console.log('[iframe] 按正序触发自动生成，按钮数量:', buttonsToAutoClick.length);
            for (const btn of buttonsToAutoClick) {
                console.log('[iframe] 自动点击触发生成:', btn);
                triggerGeneration(btn);
            }
        }

        if (window.autoClickTaskId) {
            eventSource.emit('st_chatu8_auto_click_complete', {
                taskId: window.autoClickTaskId,
                success: true
            });
            console.log('[iframe] 自动点击任务已完成');
        }
    });

    // 标记元素已处理完成，防止重复处理，并保存内容长度
    if (rootElement.dataset) {
        rootElement.dataset.chatu8Processed = 'true';
        rootElement.dataset.chatu8ContentLength = String(rootElement.textContent?.length || 0);
    }
}
