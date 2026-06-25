// @ts-nocheck
/**
 * 聊天内容处理和 DOM 遍历
 */

import { extension_settings } from "../../../../../extensions.js";
import { extensionName, EventType } from '../config.js';
import { checkSendBuClass } from '../utils.js';
import { getItemImg } from '../database.js';
import { isElementVisible, isIframeVisible, generateStableId } from './utils.js';
import { findAndReplaceInElement } from './placeholder.js';
import { createAndShowImage, triggerGeneration } from './generation.js';
import { showEditDialog } from './dialogs.js';
import { injectButtonStyleToDocument } from '../settings/buttonstyle.js';
import { injectFrameStyleToDocument } from '../settings/framestyle.js';
import { injectCollapseStyleToDocument } from '../settings/collapsestyle.js';
import { taskQueue, TaskType } from '../taskQueue.js';
import { eventSource } from '../../../../../../script.js';

// /**
//  * 处理最近聊天记录
//  * @param {Array} chats - 聊天记录数组
//  */
// export function processRecentChats(chats) {
//     if (!extension_settings[extensionName].scriptEnabled || checkSendBuClass() || !Array.isArray(chats)) {
//         return;
//     }

//     const settings = extension_settings[extensionName];

//     // 空值检测：防止 startTag 或 endTag 为空时构建出会导致无限匹配的正则表达式，造成浏览器崩溃
//     if (!settings.startTag || !settings.endTag) {
//         console.warn('[chatProcessor] startTag or endTag is empty, skipping processRecentChats');
//         return;
//     }

//     const shouldAutoClickBatch = settings.zidongdianji === "true" && window.zidongdianji;
//     const escapeRegExp = (string) => {
//         return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
//     };
//     const pattern = new RegExp(`${escapeRegExp(settings.startTag)}([\\s\\S]*?)${escapeRegExp(settings.endTag)}`, 'g');
//     const doc = document; // Main document context

//     // Iterate backwards for the last 'depth' messages
//     const startIndex = 0
//     for (let i = chats.length - 1; i >= startIndex; i--) {
//         const chat = chats[i];
//         // In SillyTavern, chat messages are objects with a 'mes' property
//         if (!chat || typeof chat.mes !== 'string') continue;

//         const matches = [];
//         let match;
//         pattern.lastIndex = 0; // Reset regex state
//         while ((match = pattern.exec(chat.mes)) !== null) {
//             matches.push({
//                 fullMatch: match[0],
//                 content: match[1],
//             });
//         }

//         if (matches.length === 0) continue;
//         const mesElement = doc.querySelector(`.mes_text[data-mesid="${i}"]`);
//         if (!mesElement) continue;
//         const mesElementf = doc.querySelector(`.mes[mesid="${i}"]`);
//         const containerId = `st-chatu8-collapsible-${i}`;
//         // Check if a container is already associated with this message element
//         // Use document.getElementById for more reliable check (container may not always be the next sibling)
//         if (doc.getElementById(containerId)) {
//             continue; // Already exists
//         }

//         const container = doc.createElement('div');
//         container.id = containerId;
//         container.className = 'st-chatu8-collapsible-container';
//         container.style.marginTop = '5px';
//         container.style.borderRadius = '4px';
//         container.style.overflow = 'hidden';
//         container.style.border = '1px solid transparent';
//         container.style.transition = 'border-color 0.2s ease-in-out';


//         const header = doc.createElement('div');
//         header.style.display = 'flex';
//         header.style.justifyContent = 'space-between';
//         header.style.alignItems = 'center';
//         header.style.cursor = 'pointer';
//         header.style.padding = '2px 8px';
//         header.style.transition = 'background-color 0.2s ease-in-out';

//         const title = doc.createElement('span');
//         title.style.fontWeight = 'bold';
//         title.style.fontSize = '0.85em';
//         title.style.color = '#666';
//         title.style.display = 'flex';
//         title.style.alignItems = 'center';

//         const deleteButton = doc.createElement('button');
//         deleteButton.textContent = '刷新';
//         deleteButton.className = 'st-chatu8-refresh-button';
//         deleteButton.style.border = 'none';
//         deleteButton.style.backgroundColor = '#ff4d4d';
//         deleteButton.style.color = 'white';
//         deleteButton.style.fontSize = '0.8em';
//         deleteButton.style.padding = '2px 8px';
//         deleteButton.style.borderRadius = '4px';
//         deleteButton.style.cursor = 'pointer';
//         deleteButton.title = '删除折叠';
//         deleteButton.onclick = (e) => {
//             e.stopPropagation(); // Prevent header click from firing
//             container.remove();
//         };

//         const content = doc.createElement('div');
//         content.style.display = 'none'; // Initially collapsed
//         content.style.padding = '8px';
//         content.style.backgroundColor = 'rgba(128, 128, 128, 0.03)';
//         content.style.flexDirection = 'column';
//         content.style.alignItems = 'flex-start';


//         const toggleIcon = doc.createElement('span');
//         toggleIcon.textContent = '▶';
//         toggleIcon.style.marginRight = '5px';
//         toggleIcon.style.transition = 'transform 0.2s ease-in-out';
//         const titleText = doc.createElement('span');
//         titleText.textContent = '图片生成';
//         title.appendChild(toggleIcon);
//         title.appendChild(titleText);

//         header.onclick = () => {
//             const isHidden = content.style.display === 'none';
//             content.style.display = isHidden ? 'flex' : 'none';
//             toggleIcon.style.transform = isHidden ? 'rotate(90deg)' : 'rotate(0deg)';
//             header.style.backgroundColor = isHidden ? 'rgba(128, 128, 128, 0.05)' : 'transparent';
//             container.style.borderColor = 'transparent';
//         };

//         header.onmouseover = () => {
//             if (content.style.display === 'none') {
//                 header.style.backgroundColor = 'rgba(128, 128, 128, 0.1)';
//             }
//         };
//         header.onmouseout = () => {
//             if (content.style.display === 'none') {
//                 header.style.backgroundColor = 'transparent';
//             }
//         };

//         header.appendChild(title);

//         const buttonWrapper = doc.createElement('div');
//         buttonWrapper.style.textAlign = 'left';
//         buttonWrapper.appendChild(deleteButton);
//         content.appendChild(buttonWrapper);

//         const clickPromises = [];
//         matches.forEach(matchInfo => {
//             const link = matchInfo.content.replaceAll("《", "<").replaceAll("》", ">").replaceAll("\n", "");
//             const requestId = generateStableId(link);

//             const button = doc.createElement('button');
//             button.className = 'image-tag-button st-chatu8-image-button';
//             button.textContent = '生成图片';
//             button.dataset.link = link;
//             button.dataset.requestId = requestId;
//             button.dataset.imageTag = link;

//             let pressTimer = null;
//             let isLongPress = false;
//             const longPressThreshold = 1200;

//             const handlePressStart = (e) => {
//                 if (e.type === 'mousedown' && e.button !== 0) return;
//                 isLongPress = false;
//                 pressTimer = setTimeout(() => {
//                     isLongPress = true;
//                     pressTimer = null;
//                     e.preventDefault(); // Prevent click and other default actions
//                     if (extension_settings[extensionName].longPressToEdit == "true") {
//                         showEditDialog(null, button);
//                     }
//                 }, longPressThreshold);
//             };

//             const handlePressEnd = () => {
//                 if (pressTimer) {
//                     clearTimeout(pressTimer);
//                     pressTimer = null;
//                 }
//             };

//             button.addEventListener('click', (e) => {
//                 if (isLongPress) {
//                     e.preventDefault();
//                     e.stopPropagation();
//                     return;
//                 }
//                 e.preventDefault();
//                 triggerGeneration(button);
//             });

//             button.addEventListener('mousedown', handlePressStart);
//             button.addEventListener('mouseup', handlePressEnd);
//             button.addEventListener('mouseleave', handlePressEnd);
//             button.addEventListener('touchstart', handlePressStart);
//             button.addEventListener('touchend', handlePressEnd);
//             button.addEventListener('touchcancel', handlePressEnd);

//             // Styles are now handled by CSS class .st-chatu8-image-button
//             // button.style.cssText = ... removed to allow theming

//             const imgSpan = doc.createElement('span');
//             imgSpan.className = 'st-chatu8-image-span';
//             imgSpan.dataset.requestId = requestId;

//             const itemContainer = doc.createElement('div');
//             itemContainer.style.marginBottom = '5px';
//             itemContainer.style.display = 'flex';
//             itemContainer.style.flexDirection = 'column';
//             itemContainer.style.alignItems = 'flex-start';
//             itemContainer.appendChild(button);
//             itemContainer.appendChild(imgSpan);
//             content.appendChild(itemContainer);

//             // Check cache or in-flight status
//             const promise = (async () => {
//                 // Use getItemImg to get base64 data directly, avoiding blob memory leaks for chat history.
//                 // 使用 getItemImg to get base64 data directly, avoiding blob memory leaks for chat history.
//                 const [imageUrl, change, , isVideo] = await getItemImg(link);
//                 if (imageUrl) {
//                     createAndShowImage(imgSpan, imageUrl, 'Generated Image', button, change, isVideo);
//                     if (extension_settings[extensionName].dbclike === "true") {
//                         button.style.display = 'none';
//                     }
//                 } else {
//                     if (shouldAutoClickBatch) {

//                         console.log(`自动点击按钮: ${button.textContent}`);
//                         return button;
//                     }
//                 }
//                 return null;
//             })();
//             clickPromises.push(promise);
//         });

//         Promise.all(clickPromises).then(buttonsToClick => {
//             const filteredButtons = buttonsToClick.filter(Boolean);
//             if (filteredButtons.length > 0) {
//                 const orderedButtons = filteredButtons;

//                 // 批量注册所有待点击的按钮任务
//                 const taskIds = orderedButtons.map(button => {
//                     const link = button.getAttribute('data-link') || '';
//                     return taskQueue.addTask({
//                         name: link.substring(0, 30) + (link.length > 30 ? '...' : ''),
//                         type: TaskType.BUTTON,
//                         prompt: link
//                     });
//                 });

//                 (async () => {
//                     for (let i = 0; i < orderedButtons.length; i++) {
//                         const button = orderedButtons[i];
//                         const taskId = taskIds[i];

//                         // 检查任务是否还在队列中（未被取消）
//                         if (!taskQueue.isTaskInQueue(taskId)) {
//                             console.log(`[ChatProcessor] 任务已取消，跳过: ${taskId}`);
//                             continue;
//                         }

//                         taskQueue.updateStatus(taskId, 'running');

//                         // 生成唯一请求ID用于追踪
//                         const requestId = Date.now().toString(36) + Math.random().toString(36).substr(2, 5);
//                         button.setAttribute('data-request-id', requestId);

//                         triggerGeneration(button);

//                         // 等待当前任务完成
//                         await new Promise(resolve => {
//                             let resolved = false;

//                             const handler = (data) => {
//                                 if (resolved) return;
//                                 if (data && data.link === button.getAttribute('data-link')) {
//                                     resolved = true;
//                                     taskQueue.completeTask(taskId, data.success !== false);
//                                     eventSource.removeListener(EventType.GENERATE_IMAGE_RESPONSE, handler);
//                                     resolve();
//                                 }
//                             };
//                             eventSource.on(EventType.GENERATE_IMAGE_RESPONSE, handler);

//                             // 超时保护：5分钟
//                             setTimeout(() => {
//                                 if (!resolved) {
//                                     resolved = true;
//                                     eventSource.removeListener(EventType.GENERATE_IMAGE_RESPONSE, handler);
//                                     taskQueue.completeTask(taskId, false);
//                                     resolve();
//                                 }
//                             }, 300000);
//                         });

//                         // Add a small delay between automatic generation requests
//                         await new Promise(resolve => setTimeout(resolve, 100));
//                     }
//                 })();
//             }
//         });

//         container.appendChild(header);
//         container.appendChild(content);

//         // Insert after the message element
//         mesElement.parentNode.insertBefore(container, mesElement.nextSibling);
//     }
// }

/**
 * Part 1: Process all getElementsByClassName("mes_text") elements
 * 优化：只处理可见元素，跳过不可见元素以节省资源
 */
export function processMesTextElements() {
    if (!extension_settings[extensionName].scriptEnabled || checkSendBuClass()) {
        return;
    }
    const elements = document.getElementsByClassName("mes_text");
    for (const element of elements) {
        if (!isElementVisible(element, 0)) {
            continue; // 跳过不可见元素
        }
        findAndReplaceInElement(element);
    }
}

/**
 * Part 2: Handle iframe elements by processing their body content
 * 优化：只处理可见的 iframe，跳过不可见的以节省资源
 */
export function processIframes() {
    if (!extension_settings[extensionName].scriptEnabled || checkSendBuClass()) {
        return;
    }
    const iframes = document.querySelectorAll('iframe');
    iframes.forEach(iframe => {
        if (!isIframeVisible(iframe, 0)) {
            return; // 跳过不可见的 iframe
        }

        const processContent = () => {
            try {
                const iframeDoc = iframe.contentDocument;
                if (iframeDoc && iframeDoc.body) {
                    // 注入按钮主题样式到 iframe 文档
                    injectButtonStyleToDocument(iframeDoc);
                    // 注入图片框架样式到 iframe 文档
                    injectFrameStyleToDocument(iframeDoc);
                    // 注入折叠框样式到 iframe 文档
                    injectCollapseStyleToDocument(iframeDoc);

                    // 递归处理 div 元素，使用可见性检测排除不可见元素

                    // 获取 iframe 视口尺寸
                    const iframeWindow = iframeDoc.defaultView;
                    const viewportHeight = iframeWindow?.innerHeight || 800;
                    const viewportWidth = iframeWindow?.innerWidth || 600;

                    // === 效率监控统计 ===
                    const stats = {
                        totalVisited: 0,      // 遍历的总元素数
                        visibleElements: 0,   // 可见元素数
                        skippedHidden: 0,     // 跳过的不可见元素数（display:none 等）
                        skippedOutOfView: 0,  // 跳过的视口外元素数
                        stoppedAtContent: 0,  // 因包含足够内容而停止递归的元素数
                        leafProcessed: 0,     // 处理的叶子元素数
                        startTime: performance.now()
                    };

                    // 文本内容阈值：包含超过此字符数的直接文本就停止递归
                    const TEXT_CONTENT_THRESHOLD = 50;
                    // 视口边距：元素在视口外多少像素内仍算"接近可见"
                    const VIEWPORT_MARGIN = 0;

                    /**
                     * 检测元素是否在 iframe 视口内（或接近视口）
                     * @param {Element} el 
                     * @returns {boolean}
                     */
                    const isInViewport = (el) => {
                        if (!el || !el.getBoundingClientRect) return false;
                        const rect = el.getBoundingClientRect();

                        // 检查元素是否在扩展的视口范围内
                        const verticalVisible = rect.bottom >= -VIEWPORT_MARGIN && rect.top <= viewportHeight + VIEWPORT_MARGIN;
                        const horizontalVisible = rect.right >= -VIEWPORT_MARGIN && rect.left <= viewportWidth + VIEWPORT_MARGIN;

                        return verticalVisible && horizontalVisible;
                    };

                    /**
                     * 检测元素是否可见（display/visibility）
                     * @param {Element} el 
                     * @returns {boolean}
                     */
                    const isVisibleInIframe = (el) => {
                        if (!el || !el.getBoundingClientRect) return false;
                        const rect = el.getBoundingClientRect();
                        // 检查元素是否有大小
                        if (rect.width === 0 && rect.height === 0) return false;
                        // 检查 display/visibility
                        const style = iframeDoc.defaultView?.getComputedStyle(el);
                        if (style && (style.display === 'none' || style.visibility === 'hidden')) return false;
                        return true;
                    };

                    /**
                     * 获取元素的直接文本内容（不包括子元素的文本）
                     * @param {Element} el 
                     * @returns {number} 直接文本长度
                     */
                    const getDirectTextLength = (el) => {
                        let textLength = 0;
                        for (const node of el.childNodes) {
                            if (node.nodeType === Node.TEXT_NODE) {
                                textLength += node.textContent.trim().length;
                            }
                        }
                        return textLength;
                    };

                    /**
                     * 递归处理 div 元素
                     * @param {Element} element 
                     */
                    const processDiv = (element) => {
                        stats.totalVisited++;

                        // 检测 1：基本可见性（display:none, visibility:hidden）
                        if (!isVisibleInIframe(element)) {
                            stats.skippedHidden++;
                            return;
                        }

                        // 检测 2：是否在视口内（或接近视口）
                        if (!isInViewport(element)) {
                            stats.skippedOutOfView++;
                            return;
                        }

                        stats.visibleElements++;

                        // 检测 3：检查元素的总文本内容大小
                        const totalTextLength = element.textContent?.length || 0;
                        const MIN_TEXT_LENGTH = 100;    // 小于此值继续递归
                        const MAX_TEXT_LENGTH = 40000;  // 大于此值继续递归

                        // 如果内容太大或太小，强制继续递归子 div
                        if (totalTextLength < MIN_TEXT_LENGTH || totalTextLength > MAX_TEXT_LENGTH) {
                            const childDivs = element.querySelectorAll(':scope > div');
                            if (childDivs.length > 0) {
                                stats.skippedBySize = (stats.skippedBySize || 0) + 1;
                                childDivs.forEach(childDiv => {
                                    processDiv(childDiv);
                                });
                                return;
                            }
                            // 如果没有子 div 但内容太小，跳过不处理
                            if (totalTextLength < MIN_TEXT_LENGTH) {
                                stats.skippedTooSmall = (stats.skippedTooSmall || 0) + 1;
                                return;
                            }
                        }

                        // 优化 A：如果当前元素包含足够多的直接文本内容，直接处理它，不继续递归
                        const directTextLength = getDirectTextLength(element);
                        if (directTextLength >= TEXT_CONTENT_THRESHOLD) {
                            stats.stoppedAtContent++;
                            stats.leafProcessed++;
                            findAndReplaceInElement(element);
                            return;
                        }

                        const childDivs = element.querySelectorAll(':scope > div');

                        // 无论有没有子 div，都先处理当前元素
                        // 这样可以确保元素中不在子 div 内的文本（如直接的 span 和文本节点）也能被处理
                        stats.leafProcessed++;
                        findAndReplaceInElement(element);

                        // 如果有子 div，继续递归处理
                        if (childDivs.length > 0) {
                            childDivs.forEach(childDiv => {
                                processDiv(childDiv);
                            });
                        }
                    };

                    // 从 body 的直接子 div 开始递归
                    const topLevelDivs = iframeDoc.body.querySelectorAll(':scope > div');
                    if (topLevelDivs.length > 0) {
                        topLevelDivs.forEach(div => processDiv(div));
                    } else {
                        // 如果没有 div，回退到处理整个 body
                        findAndReplaceInElement(iframeDoc.body);
                    }

                    // === 输出效率统计 ===
                    const elapsed = (performance.now() - stats.startTime).toFixed(2);
                    //  console.log(`[iframe 处理统计] 耗时: ${elapsed}ms | 遍历: ${stats.totalVisited} | 视口内: ${stats.visibleElements} | 跳过隐藏: ${stats.skippedHidden} | 跳过视口外: ${stats.skippedOutOfView} | 跳过大小: ${stats.skippedBySize || 0} | 跳过太小: ${stats.skippedTooSmall || 0} | 处理叶子: ${stats.leafProcessed}`);
                }
            } catch (e) {
                console.warn(`无法访问 iframe 内容:`, e.message);
            }
        };

        try {
            const iframeDoc = iframe.contentDocument;
            if (iframeDoc && iframeDoc.readyState === 'complete') {
                processContent();
            } else {
                iframe.addEventListener('load', processContent);
            }
        } catch (e) {
            console.warn(`无法访问 iframe:`, e.message);
        }
    });
}
