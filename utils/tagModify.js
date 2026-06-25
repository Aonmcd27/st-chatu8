// @ts-nocheck
/**
 * Tag 修改模块
 * 通过 LLM 辅助修改图片标签
 */

import { getElContext, processWorldBooksWithTrigger, LLM_TAG_MODIFY } from './promptReq.js';
import { generateCharacterListText, generateCommonCharacterListText, generateOutfitEnableListText } from './settings/worldbook.js';
import { getContext } from '../../../../st-context.js';
import { updateCombinedPrompt } from './settings/llm.js';
import { buildPromptForRequestType, getMergeOptionsForRequestType } from './settings/llmService.js';

import { extension_settings } from "../../../../extensions.js";
import { extensionName } from "./config.js";

import { isMobileDevice, removeThinkingTags } from './utils.js';
import { mergeAdjacentMessages, replaceAllPlaceholders, replacePlaceholder as replaceOnePlaceholder } from './promptProcessor.js';

/**
 * 读取文件为 base64
 * @param {File} file 
 * @returns {Promise<string>}
 */
function readFileAsBase64(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = reject;
        reader.readAsDataURL(file);
    });
}

/**
 * 显示修改 tag 需求输入弹窗
 * @returns {Promise<{text: string, images: Array<{base64: string, name: string}>}|null>} 用户输入的需求和图片，取消时返回 null
 */
function showTagModifyDemandPopup() {
    return new Promise((resolve) => {
        const isMobile = isMobileDevice();

        // 存储上传的图片 base64 数据
        const uploadedImages = [];

        // 移动端：获取 top-settings-holder 和 send_form 的位置
        let topBound = 10;
        let bottomBound = window.innerHeight - 10;

        if (isMobile) {
            const topSettingsHolder = document.querySelector('#top-settings-holder');
            if (topSettingsHolder) {
                const rect = topSettingsHolder.getBoundingClientRect();
                topBound = rect.bottom + 10;
            }
            const sendForm = document.querySelector('#send_form');
            if (sendForm) {
                const rect = sendForm.getBoundingClientRect();
                bottomBound = rect.top - 10;
            }
        }

        // 计算可用高度
        const availableHeight = bottomBound - topBound;

        // 创建遮罩层 - 使用 CSS 类名
        const overlay = document.createElement('div');
        overlay.id = 'tag-modify-overlay';
        overlay.className = 'st-chatu8-popup-overlay';

        // 创建气泡容器 - 使用 CSS 类名
        const bubble = document.createElement('div');
        bubble.className = 'st-chatu8-popup-bubble';
        if (isMobile) {
            bubble.classList.add('mobile');
            bubble.style.top = `${topBound}px`;
            bubble.style.maxHeight = `${availableHeight}px`;
        }

        // 标题 - 使用 CSS 类名
        const title = document.createElement('div');
        title.textContent = '🏷️ 修改 Tag';
        title.className = 'st-chatu8-popup-title';

        // 提示文字 - 使用 CSS 类名
        const hint = document.createElement('div');
        hint.textContent = '请描述您希望如何修改当前的图片标签';
        hint.className = 'st-chatu8-popup-hint';

        // 输入框 - 使用 CSS 类名
        const textarea = document.createElement('textarea');
        textarea.placeholder = '例如：把背景改成夜晚、给人物添加翅膀、增加更多细节...';
        textarea.className = 'st-chatu8-popup-textarea';

        // ==================== 图片上传区域 ====================
        const imageUploadSection = document.createElement('div');
        imageUploadSection.className = 'st-chatu8-popup-upload-section';

        // 图片上传标题行
        const uploadHeader = document.createElement('div');
        uploadHeader.className = 'st-chatu8-popup-upload-header';

        const uploadLabel = document.createElement('span');
        uploadLabel.textContent = '📎 参考图片（可选）';
        uploadLabel.className = 'st-chatu8-popup-upload-label';

        // 隐藏的文件输入
        const fileInput = document.createElement('input');
        fileInput.type = 'file';
        fileInput.accept = 'image/*';
        fileInput.multiple = true;
        fileInput.style.display = 'none';

        // 上传按钮 - 使用 CSS 类名
        const uploadBtn = document.createElement('button');
        uploadBtn.type = 'button';
        uploadBtn.innerHTML = '<i class="fa-solid fa-plus"></i> 添加图片';
        uploadBtn.className = 'st-chatu8-popup-upload-btn';
        uploadBtn.addEventListener('click', () => fileInput.click());

        uploadHeader.appendChild(uploadLabel);
        uploadHeader.appendChild(uploadBtn);

        // 图片预览容器 - 使用 CSS 类名
        const imagePreviewContainer = document.createElement('div');
        imagePreviewContainer.className = 'st-chatu8-popup-preview-container';

        // 空状态提示
        const emptyHint = document.createElement('div');
        emptyHint.textContent = '点击上方按钮添加参考图片';
        emptyHint.className = 'st-chatu8-popup-empty-hint';
        imagePreviewContainer.appendChild(emptyHint);

        /**
         * 更新图片预览
         */
        function updateImagePreviews() {
            imagePreviewContainer.innerHTML = '';

            if (uploadedImages.length === 0) {
                const hint = document.createElement('div');
                hint.textContent = '点击上方按钮添加参考图片';
                hint.className = 'st-chatu8-popup-empty-hint';
                imagePreviewContainer.appendChild(hint);
                return;
            }

            uploadedImages.forEach((imgObj, index) => {
                // 图片项容器（包含图片和名称输入）- 使用 CSS 类名
                const itemContainer = document.createElement('div');
                itemContainer.className = 'st-chatu8-popup-img-item';

                const imgWrapper = document.createElement('div');
                imgWrapper.className = 'st-chatu8-popup-img-wrapper';

                const img = document.createElement('img');
                img.src = imgObj.base64;

                // 删除按钮 - 使用 CSS 类名
                const deleteBtn = document.createElement('button');
                deleteBtn.type = 'button';
                deleteBtn.innerHTML = '×';
                deleteBtn.className = 'st-chatu8-popup-img-delete';
                deleteBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    uploadedImages.splice(index, 1);
                    updateImagePreviews();
                });

                imgWrapper.appendChild(img);
                imgWrapper.appendChild(deleteBtn);

                // 名称输入框 - 使用 CSS 类名
                const nameInput = document.createElement('input');
                nameInput.type = 'text';
                nameInput.placeholder = `图${index + 1}`;
                nameInput.value = imgObj.name || '';
                nameInput.className = 'st-chatu8-popup-img-name';
                nameInput.addEventListener('input', (e) => {
                    uploadedImages[index].name = e.target.value;
                });

                itemContainer.appendChild(imgWrapper);
                itemContainer.appendChild(nameInput);
                imagePreviewContainer.appendChild(itemContainer);
            });

            // 显示图片数量 - 使用 CSS 类名
            const countLabel = document.createElement('div');
            countLabel.textContent = `已添加 ${uploadedImages.length} 张图片`;
            countLabel.className = 'st-chatu8-popup-img-count';
            imagePreviewContainer.appendChild(countLabel);
        }

        // 处理文件选择
        fileInput.addEventListener('change', async (e) => {
            const files = e.target.files;
            if (!files || files.length === 0) return;

            for (const file of files) {
                if (!file.type.startsWith('image/')) continue;

                try {
                    const base64 = await readFileAsBase64(file);
                    // 存储为对象，包含 base64 和可选名称
                    uploadedImages.push({
                        base64: base64,
                        name: '' // 用户可选填
                    });
                } catch (err) {
                    console.error('[showTagModifyDemandPopup] Failed to read image:', err);
                }
            }

            updateImagePreviews();
            // 重置文件输入，允许重复选择同一文件
            fileInput.value = '';
        });

        imageUploadSection.appendChild(uploadHeader);
        imageUploadSection.appendChild(fileInput);
        imageUploadSection.appendChild(imagePreviewContainer);

        // ==================== 按钮容器 ====================
        const buttonContainer = document.createElement('div');
        buttonContainer.className = 'st-chatu8-popup-buttons';

        // 取消按钮 - 使用 CSS 类名
        const cancelBtn = document.createElement('button');
        cancelBtn.textContent = '取消';
        cancelBtn.className = 'st-chatu8-popup-btn-cancel';

        // 确定按钮 - 使用 CSS 类名
        const confirmBtn = document.createElement('button');
        confirmBtn.textContent = '确定修改';
        confirmBtn.className = 'st-chatu8-popup-btn-confirm';

        // 关闭弹窗函数
        const closePopup = (result) => {
            overlay.classList.add('closing');
            setTimeout(() => {
                overlay.remove();
                resolve(result);
            }, 150);
        };

        // 绑定事件
        cancelBtn.addEventListener('click', () => closePopup(null));
        confirmBtn.addEventListener('click', () => closePopup({
            text: textarea.value.trim() || '',
            images: [...uploadedImages]
        }));

        // ESC 键关闭
        const handleKeydown = (e) => {
            if (e.key === 'Escape') {
                closePopup(null);
                document.removeEventListener('keydown', handleKeydown);
            } else if (e.key === 'Enter' && e.ctrlKey) {
                closePopup({
                    text: textarea.value.trim() || '',
                    images: [...uploadedImages]
                });
                document.removeEventListener('keydown', handleKeydown);
            }
        };
        document.addEventListener('keydown', handleKeydown);

        // 不允许点击遮罩关闭，只能通过按钮关闭

        // 组装元素
        buttonContainer.appendChild(cancelBtn);
        buttonContainer.appendChild(confirmBtn);
        bubble.appendChild(title);
        bubble.appendChild(hint);
        bubble.appendChild(textarea);
        bubble.appendChild(imageUploadSection);
        bubble.appendChild(buttonContainer);
        overlay.appendChild(bubble);
        document.body.appendChild(overlay);

        // 自动聚焦输入框
        setTimeout(() => textarea.focus(), 100);
    });
}

/**
 * 从 LLM 响应中解析 image###...### 格式的 tag
 * @param {string} text - LLM 响应文本
 * @returns {string|null} 解析出的 tag，未找到返回 null
 */
function parseImageTagFromResponse(text) {
    if (!text || typeof text !== 'string') return null;

    // 预处理：统一换行符
    let normalizedText = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

    // 获取配置的标签
    const settings = extension_settings[extensionName];
    const startTag = settings?.startTag || 'image###';
    const endTag = settings?.endTag || '###';
    const escapedStart = startTag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const escapedEnd = endTag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

    // 1. 优先尝试提取 <images>...</images> 块
    const imagesBlockRegex = /<images>([\s\S]*?)<\/images>/i;
    const imagesBlockMatch = normalizedText.match(imagesBlockRegex);

    if (imagesBlockMatch && imagesBlockMatch[1]) {
        const imagesContent = imagesBlockMatch[1];

        // 取最后一个 <image>...</image> 标签
        const imageTagRegex = /<image>([\s\S]*?)<\/image>/gi;
        const allImageMatches = [...imagesContent.matchAll(imageTagRegex)];

        if (allImageMatches.length > 0) {
            const lastImageContent = allImageMatches[allImageMatches.length - 1][1];
            console.log('[parseImageTagFromResponse] Using last <image> tag in <images> block');

            // 在最后一个 <image> 内提取最后一个 image###...###
            const innerRegex = new RegExp(`(?:${escapedStart}|image\\s*###)\\s*([\\s\\S]*?)\\s*(?:${escapedEnd}|###)`, 'gi');
            const innerMatches = [...lastImageContent.matchAll(innerRegex)];
            if (innerMatches.length > 0) {
                return innerMatches[innerMatches.length - 1][1].trim();
            }

            // 没有 image###，直接用 <image> 内容
            const fallback = lastImageContent.trim();
            if (fallback) return fallback;
        }
    }

    // 2. 尝试提取最后一个独立的 <image>...</image> 标签（无 <images> 包裹）
    const imageTagRegex = /<image>([\s\S]*?)<\/image>/gi;
    const allImageMatches = [...normalizedText.matchAll(imageTagRegex)];

    if (allImageMatches.length > 0) {
        const lastImageContent = allImageMatches[allImageMatches.length - 1][1];
        console.log('[parseImageTagFromResponse] Using last standalone <image> tag');

        // 在最后一个 <image> 内提取最后一个 image###...###
        const innerRegex = new RegExp(`(?:${escapedStart}|image\\s*###)\\s*([\\s\\S]*?)\\s*(?:${escapedEnd}|###)`, 'gi');
        const innerMatches = [...lastImageContent.matchAll(innerRegex)];
        if (innerMatches.length > 0) {
            return innerMatches[innerMatches.length - 1][1].trim();
        }

        // 没有 image###，直接用 <image> 内容
        const fallback = lastImageContent.trim();
        if (fallback) return fallback;
    }

    // 3. 回退：在全文中提取最后一组 image###...###（宽松匹配）
    const regex = new RegExp(`(?:${escapedStart}|image\\s*###)\\s*([\\s\\S]*?)\\s*(?:${escapedEnd}|###)`, 'gi');
    const matches = [...normalizedText.matchAll(regex)];
    if (matches.length > 0) {
        console.log('[parseImageTagFromResponse] Using last image### in full text');
        return matches[matches.length - 1][1].trim();
    }

    // 4. 最终兜底：2个或更多#的备选方案
    const fallbackRegex = /image\s*#{2,}\s*([\s\S]*?)\s*#{2,}/gi;
    const fallbackMatches = [...normalizedText.matchAll(fallbackRegex)];
    if (fallbackMatches.length > 0) {
        return fallbackMatches[fallbackMatches.length - 1][1].trim();
    }

    console.warn('[parseImageTagFromResponse] No match found in text:', normalizedText.substring(0, 300));
    return null;
}


/**
 * 替换占位符函数
 * @param {*} obj - 要处理的对象（可以是字符串、数组或对象）
 * @param {string} placeholder - 占位符
 * @param {*} value - 替换的值
 * @returns {*} 替换后的对象
 */
function replacePlaceholder(obj, placeholder, value) {
    if (typeof obj === 'string') {
        return obj.replaceAll(placeholder, value || '');
    }
    if (Array.isArray(obj)) {
        return obj.map(item => replacePlaceholder(item, placeholder, value));
    }
    if (obj && typeof obj === 'object') {
        const newObj = {};
        for (const key in obj) {
            newObj[key] = replacePlaceholder(obj[key], placeholder, value);
        }
        return newObj;
    }
    return obj;
}

/**
 * 将图片附加到指定索引的消息中（OpenAI 多模态格式）
 * @param {Array} messages - 消息数组
 * @param {number} messageIndex - 要附加图片的消息索引
 * @param {Array<{base64: string, name: string}>} images - 图片数组
 * @param {string} imageLabel - 图片标签前缀
 * @returns {Array} 处理后的消息数组
 */
function attachImagesToMessage(messages, messageIndex, images, imageLabel = '参考图片') {
    if (!images || images.length === 0 || messageIndex < 0 || messageIndex >= messages.length) {
        return messages;
    }

    const result = [...messages];
    const targetMsg = result[messageIndex];

    // 构建多模态 content 数组
    const contentParts = [];

    // 1. 原始文本内容
    if (typeof targetMsg.content === 'string') {
        contentParts.push({
            type: 'text',
            text: targetMsg.content
        });
    } else if (Array.isArray(targetMsg.content)) {
        // 已经是多模态格式，直接使用
        contentParts.push(...targetMsg.content);
    }

    // 2. 添加图片标签说明
    if (images.length > 0) {
        contentParts.push({
            type: 'text',
            text: `\n[以下是用户上传的${images.length}张${imageLabel}]`
        });
    }

    // 3. 添加图片
    images.forEach((imgItem, idx) => {
        const imgBase64 = typeof imgItem === 'string' ? imgItem : imgItem.base64;
        const imgName = typeof imgItem === 'object' && imgItem.name ? imgItem.name : `${imageLabel}${idx + 1}`;

        // 添加图片名称标签
        contentParts.push({
            type: 'text',
            text: `[${imgName}]`
        });

        // 解析 base64 格式
        let imageUrl = imgBase64;
        if (!imgBase64.startsWith('data:')) {
            imageUrl = `data:image/png;base64,${imgBase64}`;
        }

        contentParts.push({
            type: 'image_url',
            image_url: {
                url: imageUrl,
                detail: 'auto'
            }
        });
    });

    // 更新消息内容
    result[messageIndex] = {
        ...targetMsg,
        content: contentParts
    };

    return result;
}

/**
 * 查找包含指定占位符的消息索引
 * @param {Array} messages - 消息数组
 * @param {string} placeholder - 要查找的占位符
 * @returns {number} 消息索引，未找到返回 -1
 */
function findMessageIndexWithPlaceholder(messages, placeholder) {
    for (let i = 0; i < messages.length; i++) {
        const msg = messages[i];
        if (typeof msg.content === 'string' && msg.content.includes(placeholder)) {
            return i;
        } else if (Array.isArray(msg.content)) {
            for (const part of msg.content) {
                if (part.type === 'text' && part.text.includes(placeholder)) {
                    return i;
                }
            }
        }
    }
    return -1;
}

/**
 * 处理修改 tag 请求
 * @param {HTMLElement} el - 触发元素（用于获取上下文）
 * @param {string} currentTag - 当前的 tag 内容
 * @param {HTMLTextAreaElement} inputEl - tag 编辑框的输入框元素
 */
export async function handleTagModifyRequest(el, currentTag, inputEl) {


    // 1. 显示需求输入弹窗
    const popupResult = await showTagModifyDemandPopup();
    if (popupResult === null) {

        toastr.info('已取消修改');
        return;
    }

    // popupResult 现在是 {text, images} 对象
    const userDemand = popupResult.text || '';
    const userUploadedImages = popupResult.images || [];

    if (!userDemand) {
        toastr.warning('请输入修改需求');
        return;
    }



    toastr.info('正在处理修改请求...');

    try {
        // 2. 获取上下文
        let contextElements = [];
        let nowtxt = '';

        if (el) {
            contextElements = await getElContext(el) || [];
            nowtxt = contextElements[contextElements.length - 1] || '';
        }



        // 3. 获取世界书触发内容
        const triggerElements = userDemand
            ? [...contextElements, userDemand, currentTag]
            : [...contextElements, currentTag];
        const triggeredContent = await processWorldBooksWithTrigger(triggerElements);



        // 5. 获取角色/服装列表信息（基于触发文本过滤）
        const context = getContext();

        // ★ 构建条目触发文本：只使用用户需求 + 正文 + 当前tag
        const entryTriggerTextParts = [];
        if (userDemand) {
            entryTriggerTextParts.push(userDemand);
        }
        if (nowtxt) {
            entryTriggerTextParts.push(nowtxt);
        }
        if (currentTag) {
            entryTriggerTextParts.push(currentTag);
        }
        const entryTriggerText = entryTriggerTextParts.join('\n');

        // ★ 构建角色触发文本：用户需求 + 上下文 + 世界书触发 + 当前tag（用于角色列表生成）
        const characterTriggerTextParts = [];
        if (userDemand) {
            characterTriggerTextParts.push(userDemand);
        }
        if (contextElements && contextElements.length > 0) {
            characterTriggerTextParts.push(contextElements.join('\n'));
        }
        if (triggeredContent) {
            characterTriggerTextParts.push(triggeredContent);
        }
        if (currentTag) {
            characterTriggerTextParts.push(currentTag);
        }
        const characterTriggerText = characterTriggerTextParts.join('\n');


        // 4. 获取 LLM 提示词模板（使用条目触发文本来触发条目）
        let prompt = buildPromptForRequestType('tag_modify', entryTriggerText);

        if (!prompt || prompt.length === 0) {
            throw new Error('未能获取到提示词，请检查 LLM 设置中"Tag修改"的上下文预设配置');
        }



        const characterListText = generateCharacterListText(characterTriggerText);
        const outfitEnableListText = generateOutfitEnableListText();
        const commonCharacterListText = generateCommonCharacterListText();

        const variables = context.chatMetadata?.variables || {};

        // ★ 使用新的 promptProcessor 模块进行处理
        // 1. 先合并相邻相同角色的消息
        prompt = mergeAdjacentMessages(prompt, getMergeOptionsForRequestType('tag_modify'));


        // 记录包含 {{用户需求}} 的消息位置，以便后续附加图片
        const userDemandMsgIndex = findMessageIndexWithPlaceholder(prompt, '{{用户需求}}');

        // 2. 准备上下文数据用于占位符替换
        const contextData = {
            context: contextElements.join('\n'),
            body: nowtxt,
            worldBookContent: triggeredContent,
            variables: variables,
            userDemand: userDemand,
            characterListText: characterListText,
            outfitEnableListText: outfitEnableListText,
            commonCharacterListText: commonCharacterListText
        };

        // 3. 替换所有标准占位符
        const { messages: processedMessages } = await replaceAllPlaceholders(prompt, contextData);
        prompt = processedMessages;

        // 4. 替换特殊占位符（当前tag）
        prompt = replaceOnePlaceholder(prompt, '{{当前tag}}', currentTag);

        // 7. 如果有上传的图片，附加到包含用户需求的消息中
        if (userUploadedImages.length > 0 && userDemandMsgIndex !== -1) {
            prompt = attachImagesToMessage(prompt, userDemandMsgIndex, userUploadedImages, '参考图片');

        }



        // 8. 更新调试显示
        const diagnosticText = `[Tag修改] 用户需求: ${userDemand}${userUploadedImages.length > 0 ? `\n已附加 ${userUploadedImages.length} 张参考图片` : ''}`;
        updateCombinedPrompt(prompt, diagnosticText);

        // 9. 调用 LLM
        const response = await LLM_TAG_MODIFY(prompt, { timeoutMs: 600000 });


        // 提取实际的响应文本（LLM_TAG_MODIFY 返回 { result, testMode } 对象）
        const responseText = response?.result || response;


        // 10. 解析结果（先移除 thinking 标签）
        const cleanedResponseText = removeThinkingTags(responseText);
        const newTag = parseImageTagFromResponse(cleanedResponseText);
        if (newTag) {
            inputEl.value = newTag;
            inputEl.dispatchEvent(new Event('input', { bubbles: true }));
            toastr.success('Tag 修改成功！');

        } else {
            toastr.warning('未能从响应中解析出有效的 tag');
            console.warn('[tagModify] Could not parse tag from response:', response);
        }

    } catch (error) {
        console.error('[tagModify] Error:', error);
        toastr.error(`修改失败: ${error.message}`);
    }
}
