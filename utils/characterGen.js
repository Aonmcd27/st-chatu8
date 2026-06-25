// @ts-nocheck
/**
 * characterGen.js - 角色/服装设计生成模块
 * 
 * 处理手势2触发的角色/服装设计请求
 * 复用 promptReq.js 中的函数，调用 newline_fix.js 的解析函数
 */

import { eventSource } from "../../../../../script.js";
import { eventNames, extensionName } from './config.js';
import { extension_settings } from "../../../../extensions.js";
import { getContext } from "../../../../st-context.js";

// 从 promptReq.js 导入复用函数
import {
    getElContext,
    processWorldBooksWithTrigger
} from './promptReq.js';

// 从 newline_fix.js 导入解析函数
import {
    extractCharacterAndOutfitTags,
    handleExtractedData
} from './newline_fix.js';

// 从 worldbook.js 导入角色列表生成函数
import {
    generateCharacterListText,
    generateOutfitEnableListText,
    generateCommonCharacterListText,
    getEnabledCharacterImages,
    getEnabledOutfitImages,
    getCommonCharacterImages
} from './settings/worldbook.js';

import { updateCombinedPrompt } from './settings/llm.js';
import { buildPromptForRequestType, getMergeOptionsForRequestType } from './settings/llmService.js';
import { isMobileDevice, removeThinkingTags } from './utils.js';
import { mergeAdjacentMessages, replaceAllPlaceholders } from './promptProcessor.js';

/**
 * 显示用户需求输入弹窗
 * @returns {Promise<{text: string, images: string[]}|null>} 用户输入的需求和图片base64数组，取消时返回 null
 */
function showUserDemandPopup() {
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
                // 确保 topBound 在有效范围内（最小10px，最大不超过视口高度的一半）
                topBound = Math.max(10, Math.min(rect.bottom + 10, window.innerHeight * 0.5));
            }
            const sendForm = document.querySelector('#send_form');
            if (sendForm) {
                const rect = sendForm.getBoundingClientRect();
                // 确保 bottomBound 不会超出视口，且不小于 topBound + 200
                bottomBound = Math.max(topBound + 200, Math.min(rect.top - 10, window.innerHeight - 10));
            }
        }

        // 计算可用高度，确保至少有 200px 的高度
        const availableHeight = Math.max(200, bottomBound - topBound);

        // 创建遮罩层
        const overlay = document.createElement('div');
        overlay.id = 'user-demand-overlay';
        overlay.className = 'st-chatu8-popup-overlay';

        // 创建气泡容器
        const bubble = document.createElement('div');
        bubble.className = 'st-chatu8-popup-bubble';
        if (isMobile) {
            bubble.classList.add('mobile');
            bubble.style.top = `${topBound}px`;
            bubble.style.maxHeight = `${availableHeight}px`;
        }

        // 标题
        const title = document.createElement('div');
        title.textContent = '🎨 输入生成需求';
        title.className = 'st-chatu8-popup-title';

        // 提示文字
        const hint = document.createElement('div');
        hint.textContent = '请描述您希望生成的角色或服装的具体需求';
        hint.className = 'st-chatu8-popup-hint';

        // 输入框
        const textarea = document.createElement('textarea');
        textarea.placeholder = '例如：生成一个穿着古风汉服的少女角色，温柔可爱...';
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

        // 上传按钮
        const uploadBtn = document.createElement('button');
        uploadBtn.type = 'button';
        uploadBtn.innerHTML = '<i class="fa-solid fa-plus"></i> 添加图片';
        uploadBtn.className = 'st-chatu8-popup-upload-btn';
        uploadBtn.addEventListener('click', () => fileInput.click());

        uploadHeader.appendChild(uploadLabel);
        uploadHeader.appendChild(uploadBtn);

        // 图片预览容器
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
                // 图片项容器（包含图片和名称输入）
                const itemContainer = document.createElement('div');
                itemContainer.className = 'st-chatu8-popup-img-item';

                const imgWrapper = document.createElement('div');
                imgWrapper.className = 'st-chatu8-popup-img-wrapper';

                const img = document.createElement('img');
                img.src = imgObj.base64;

                // 删除按钮
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

                // 名称输入框
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

            // 显示图片数量
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
                    console.error('[showUserDemandPopup] Failed to read image:', err);
                }
            }

            updateImagePreviews();
            // 重置文件输入，允许重复选择同一文件
            fileInput.value = '';
        });

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

        imageUploadSection.appendChild(uploadHeader);
        imageUploadSection.appendChild(fileInput);
        imageUploadSection.appendChild(imagePreviewContainer);

        // ==================== 按钮容器 ====================
        const buttonContainer = document.createElement('div');
        buttonContainer.className = 'st-chatu8-popup-buttons';

        // 取消按钮
        const cancelBtn = document.createElement('button');
        cancelBtn.textContent = '取消';
        cancelBtn.className = 'st-chatu8-popup-btn-cancel';

        // 确定按钮
        const confirmBtn = document.createElement('button');
        confirmBtn.textContent = '确定生成';
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
            text: textarea.value.trim() || null,
            images: [...uploadedImages]
        }));

        // ESC 键关闭
        const handleKeydown = (e) => {
            if (e.key === 'Escape') {
                closePopup(null);
                document.removeEventListener('keydown', handleKeydown);
            } else if (e.key === 'Enter' && e.ctrlKey) {
                closePopup({
                    text: textarea.value.trim() || null,
                    images: [...uploadedImages]
                });
                document.removeEventListener('keydown', handleKeydown);
            }
        };
        document.addEventListener('keydown', handleKeydown);

        // 不再点击遮罩关闭，只能通过按钮关闭

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
 * 替换占位符函数
 * @param {*} obj - 要处理的对象（可以是字符串、数组或对象）
 * @param {string} placeholder - 占位符
 * @param {*} value - 替换的值
 * @param {Set} replacedSet - 记录已替换的变量集合
 * @returns {*} 替换后的对象
 */
function replacePlaceholder(obj, placeholder, value, replacedSet) {
    // 1. 如果是字符串，直接替换
    if (typeof obj === 'string') {
        if (value && obj.includes(placeholder)) {
            if (replacedSet) {
                replacedSet.add(placeholder);
            }
        }
        return obj.replaceAll(placeholder, value);
    }

    // 2. 如果是数组，遍历每个元素递归处理
    if (Array.isArray(obj)) {
        return obj.map(item => replacePlaceholder(item, placeholder, value, replacedSet));
    }

    // 3. 如果是对象，遍历每个属性递归处理
    if (obj && typeof obj === 'object') {
        const newObj = {};
        for (const key in obj) {
            newObj[key] = replacePlaceholder(obj[key], placeholder, value, replacedSet);
        }
        return newObj;
    }

    // 4. 其他类型（数字、布尔等）原样返回
    return obj;
}

/**
 * 将图片附加到指定索引的消息中（OpenAI 多模态格式）
 * @param {Array} messages - 消息数组
 * @param {number} messageIndex - 要附加图片的消息索引
 * @param {string[]} images - base64 图片数组
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

    // 2. 添加图片标签说明（可选）
    if (images.length > 0) {
        contentParts.push({
            type: 'text',
            text: `\n[以下是用户上传的${images.length}张${imageLabel}]`
        });
    }

    // 3. 添加图片（支持 {base64, name} 对象格式）
    images.forEach((imgItem, idx) => {
        // 支持两种格式：纯 base64 字符串 或 {base64, name} 对象
        const imgBase64 = typeof imgItem === 'string' ? imgItem : imgItem.base64;
        const imgName = typeof imgItem === 'object' && imgItem.name ? imgItem.name : `${imageLabel}${idx + 1}`;

        // 添加图片名称标签
        contentParts.push({
            type: 'text',
            text: `[${imgName}]`
        });

        // 解析 base64 格式：data:image/jpeg;base64,xxx
        let imageUrl = imgBase64;

        // 如果不是完整的 data URL，添加前缀
        if (!imgBase64.startsWith('data:')) {
            imageUrl = `data:image/png;base64,${imgBase64}`;
        }

        contentParts.push({
            type: 'image_url',
            image_url: {
                url: imageUrl,
                detail: 'auto' // 可选: 'low', 'high', 'auto'
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
 * 生成请求 ID
 * @returns {string}
 */
function generateRequestId() {
    if (crypto && crypto.randomUUID) {
        return crypto.randomUUID();
    }
    return Date.now().toString(36) + Math.random().toString(36).substring(2);
}

/**
 * 获取角色/服装设计的提示词
 * @returns {Promise<Array>} 消息数组
 */
export function LLM_CHAR_DESIGN_GET_PROMPT() {
    return new Promise((resolve, reject) => {
        const promptRequestId = generateRequestId();
        console.log(`[characterGen] Requesting char design prompt (ID: ${promptRequestId})`);

        const handler = (promptData) => {
            if (promptData.id !== promptRequestId) return;
            eventSource.removeListener(eventNames.LLM_CHAR_DESIGN_GET_PROMPT_RESPONSE, handler);
            resolve(promptData.prompt);
        };

        eventSource.on(eventNames.LLM_CHAR_DESIGN_GET_PROMPT_RESPONSE, handler);
        eventSource.emit(eventNames.LLM_CHAR_DESIGN_GET_PROMPT_REQUEST, { id: promptRequestId });

        setTimeout(() => {
            eventSource.removeListener(eventNames.LLM_CHAR_DESIGN_GET_PROMPT_RESPONSE, handler);
            reject(new Error("获取角色设计提示词超时"));
        }, 10000);
    });
}

/**
 * 执行角色/服装设计 LLM 请求
 * @param {Array} prompt - 消息数组
 * @param {Object} options - 选项
 * @returns {Promise<string>} LLM 输出
 */
export function LLM_CHAR_DESIGN(prompt, options = {}) {
    return new Promise((resolve, reject) => {
        const requestId = generateRequestId();
        const timeoutMs = options.timeoutMs || 60000;
        let timeoutTimer = null;

        console.log(`[characterGen] Executing char design LLM request (ID: ${requestId})`);

        const cleanup = () => {
            eventSource.removeListener(eventNames.LLM_CHAR_DESIGN_RESPONSE, handler);
            if (timeoutTimer) {
                clearTimeout(timeoutTimer);
                timeoutTimer = null;
            }
        };

        const handler = (responseData) => {
            if (responseData.id !== requestId) return;
            cleanup();

            if (responseData.success) {
                // 检查是否为测试模式
                if (responseData.testMode) {
                    resolve({ result: responseData.result, testMode: true });
                } else {
                    resolve({ result: responseData.result, testMode: false });
                }
            } else {
                reject(new Error(responseData.result || 'LLM 请求失败'));
            }
        };

        eventSource.on(eventNames.LLM_CHAR_DESIGN_RESPONSE, handler);
        eventSource.emit(eventNames.LLM_CHAR_DESIGN_REQUEST, { prompt, id: requestId });

        timeoutTimer = setTimeout(() => {
            cleanup();
            reject(new Error("角色设计 LLM 请求超时"));
        }, timeoutMs);
    });
}

/**
 * 处理角色/服装设计请求 (手势2触发)
 * @param {HTMLElement} el - 触发手势的 DOM 元素
 */
export async function handleCharacterDesignRequest(el) {
    console.log('[characterGen] Starting character design request...');

    try {
        // 0. 弹出用户需求输入框
        const popupResult = await showUserDemandPopup();
        if (popupResult === null) {
            console.log('[characterGen] User cancelled the request');
            toastr.info('已取消角色生成');
            return;
        }
        // popupResult 现在是 {text, images} 对象
        let userDemand = popupResult.text || extension_settings[extensionName]?.defaultCharDemand || '';
        const userUploadedImages = popupResult.images || []; // 用户上传的参考图片（base64）
        console.log('[characterGen] User demand:', userDemand);
        console.log('[characterGen] User uploaded images count:', userUploadedImages.length);
        toastr.info('[characterGen] 正在处理角色/服装设计请求...');

        const context = getContext();

        // 1. 获取元素上下文，+1 是因为 llm_history_depth 不含正文层
        const historyDepth = (extension_settings[extensionName]?.llm_history_depth ?? 2) + 1;
        const contextElements = await getElContext(el, historyDepth);
        if (!contextElements || contextElements.length === 0) {
            toastr.warning('未能获取上下文内容');
            return;
        }
        console.log('[characterGen] Context elements:', contextElements);

        const nowtxt = contextElements[contextElements.length - 1];

        // 2. 处理世界书触发 - 将用户需求也加入触发文本
        let triggeredContent = "";
        if (contextElements) {
            // 将用户需求添加到上下文中一起参与世界书触发
            const triggerElements = userDemand
                ? [...contextElements, userDemand]
                : contextElements;
            triggeredContent = await processWorldBooksWithTrigger(triggerElements);
            console.log('[characterGen] Triggered world book content:', triggeredContent);
        }

        // 4. 获取角色/服装列表（基于触发文本过滤）
        // 构建 {{上下文}}（不含正文）- 用于替换占位符
        const contextWithoutBody = contextElements && contextElements.length > 1
            ? contextElements.slice(0, -1)
            : [];

        // ★ 构建条目触发文本：只使用用户需求 + 正文
        const entryTriggerTextParts = [];
        if (userDemand) {
            entryTriggerTextParts.push(userDemand);
        }
        if (nowtxt) {
            entryTriggerTextParts.push(nowtxt);
        }
        const entryTriggerText = entryTriggerTextParts.join('\n');

        // ★ 构建角色触发文本：用户需求 + 完整上下文（含正文） + 世界书触发（用于角色列表生成）
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
        const characterTriggerText = characterTriggerTextParts.join('\n');

        console.log('[characterGen] Character trigger text:', characterTriggerText);

        // 3. 获取角色设计提示词（使用条目触发文本来触发条目）
        let prompt = buildPromptForRequestType('char_design', entryTriggerText);

        if (!prompt || prompt.length === 0) {
            throw new Error('未能获取到提示词，请检查 LLM 设置中"角色/服装设计"的上下文预设配置');
        }

        const characterListText = generateCharacterListText(characterTriggerText);
        const outfitEnableListText = generateOutfitEnableListText();
        const commonCharacterListText = generateCommonCharacterListText();
        console.log('[characterGen] Character list text (triggered):', characterListText);

        const variables = context.chatMetadata?.variables || {};

        // ★ 使用新的 promptProcessor 模块进行处理
        // 1. 先合并相邻相同角色的消息
        prompt = mergeAdjacentMessages(prompt, getMergeOptionsForRequestType('char_design'));
        console.log('[characterGen] 合并相邻消息后:', prompt);

        // 2. 准备上下文数据用于占位符替换
        const contextData = {
            context: contextWithoutBody.join('\n'),
            body: nowtxt,
            worldBookContent: triggeredContent,
            variables: variables,
            userDemand: userDemand || '',
            characterListText: characterListText,
            outfitEnableListText: outfitEnableListText,
            commonCharacterListText: commonCharacterListText
        };

        // 3. 替换所有占位符
        const { messages: processedMessages, replacedVariables } = await replaceAllPlaceholders(prompt, contextData);
        prompt = processedMessages;

        /**
         * 查找包含用户需求内容的消息索引（用于附加图片）
         * @param {Array} messages - 消息数组
         * @returns {number} 消息索引，未找到返回 -1
         */
        function findUserDemandMessageIndex(messages) {
            // 策略：找最后一条 user 角色的消息
            for (let i = messages.length - 1; i >= 0; i--) {
                if (messages[i].role === 'user') {
                    return i;
                }
            }
            return -1;
        }

        // ★ 找到用于附加图片的消息索引
        const userDemandMessageIndex = findUserDemandMessageIndex(prompt);
        console.log('[characterGen] 找到用户消息索引用于附加图片:', userDemandMessageIndex);

        // ★ 将用户上传的图片附加到包含 {{用户需求}} 的消息中（OpenAI 多模态格式）
        if (userUploadedImages.length > 0 && userDemandMessageIndex >= 0) {
            prompt = attachImagesToMessage(prompt, userDemandMessageIndex, userUploadedImages, '参考图片');
            console.log('[characterGen] 已将', userUploadedImages.length, '张图片附加到消息索引', userDemandMessageIndex);
        }

        // ★ 收集并附加启用角色/服装中 sendPhoto 为 true 的图片
        try {
            // 收集启用角色的图片（基于触发文本过滤）
            const characterImages = await getEnabledCharacterImages(characterTriggerText);
            // 收集通用服装的图片
            const outfitImages = await getEnabledOutfitImages();
            // 收集通用角色的图片
            const commonCharacterImagesData = await getCommonCharacterImages();

            // 合并所有角色/服装图片
            const allCharacterOutfitImages = [...characterImages, ...outfitImages, ...commonCharacterImagesData];

            if (allCharacterOutfitImages.length > 0 && userDemandMessageIndex >= 0) {
                prompt = attachImagesToMessage(prompt, userDemandMessageIndex, allCharacterOutfitImages, '角色服装参考图片');
                console.log('[characterGen] 已将', allCharacterOutfitImages.length, '张角色/服装图片附加到消息索引', userDemandMessageIndex);
            }
        } catch (err) {
            console.error('[characterGen] 收集角色/服装图片失败:', err);
        }

        console.log('[characterGen] Final prompt:', prompt);

        // 更新调试显示
        let diagnosticText = "";
        if (replacedVariables.size > 0) {
            diagnosticText = `诊断：检测到以下变量被使用：${[...replacedVariables].join('、')}\n`;
        }
        updateCombinedPrompt(prompt, diagnosticText);

        // ★ 检查正则测试模式：如果启用了测试模式，则停止 LLM 请求
        const isRegexTestMode = extension_settings[extensionName]?.regexTestMode ?? false;
        if (isRegexTestMode) {
            toastr.info('🧪 正则测试模式已启用：已停止角色设计 LLM 请求，仅展示最终 Prompt');
            console.log('[characterGen] 正则测试模式 - LLM 请求已跳过');

            // 自动关闭正则测试模式（一次性消耗）
            extension_settings[extensionName].regexTestMode = false;
            $('#ch-regex-test-mode').prop('checked', false);
            console.log('[characterGen] 正则测试模式已自动关闭（一次性触发）');

            return;
        }

        // 6. 执行 LLM 请求
        const llmResponse = await LLM_CHAR_DESIGN(prompt, { timeoutMs: 600000 });
        console.log('[characterGen] LLM response:', llmResponse);

        // 检查测试模式
        if (llmResponse.testMode) {
            console.log('[characterGen] 测试模式 - 后续操作已跳过');
            return;
        }

        const llmOutput = llmResponse.result;

        if (!llmOutput) {
            toastr.error('LLM 返回结果为空');
            return;
        }

        // 7. 解析 LLM 输出中的角色/服装标签（先移除 thinking 标签）
        const cleanedOutput = removeThinkingTags(llmOutput);
        const extracted = extractCharacterAndOutfitTags(cleanedOutput);

        if (extracted.characters.length === 0 && extracted.outfits.length === 0) {
            toastr.warning('未在 LLM 输出中检测到角色或服装标签');
            console.log('[characterGen] No character/outfit tags found in output');
            console.log('[characterGen] Raw LLM output for debugging:', llmOutput);
            return;
        }

        console.log('[characterGen] Extracted data:', extracted);

        // 8. 处理提取的数据（弹窗确认 + 保存）
        // 传递元数据：上下文、世界书触发内容和使用的变量
        // 收集使用到的 getvar 变量
        const usedVariables = {};
        for (const varPlaceholder of replacedVariables) {
            const getvarMatch = varPlaceholder.match(/^\{\{getvar::([^}]+)\}\}$/);
            if (getvarMatch) {
                const varName = getvarMatch[1];
                usedVariables[varName] = variables[varName] || '';
            }
        }

        const metadata = {
            generationContext: contextElements.join('\n'),
            generationWorldBook: triggeredContent,
            generationVariables: usedVariables
        };
        await handleExtractedData(extracted, metadata);

        toastr.success('角色/服装设计处理完成！');

    } catch (error) {
        console.error('[characterGen] Error:', error);
        toastr.error(`角色设计请求失败: ${error.message}`);
    }
}

// ==================== 外部数据录入事件接口 ====================

/**
 * 处理外部角色/服装数据录入请求
 * 
 * 支持两种模式：
 * - mode='text': 传入包含 <人物>...</人物> 和 <服装>...</服装> 标签的原始文本，自动解析后录入
 * - mode='structured': 传入已解析好的结构化数据，直接录入
 * 
 * @param {Object} requestData - 请求数据
 * @param {string} [requestData.id] - 请求 ID（用于追踪响应）
 * @param {'text'|'structured'} requestData.mode - 录入模式
 * @param {string} [requestData.text] - mode='text' 时必填，包含角色/服装标签的原始文本
 * @param {Object} [requestData.data] - mode='structured' 时必填，结构化数据 { characters, outfits }
 * @param {Object} [requestData.metadata] - 可选的元数据 { generationContext, generationWorldBook, generationVariables }
 */
async function onCharDataImportRequest(requestData) {
    const requestId = requestData?.id || '';
    console.log(`[characterGen] 收到外部数据录入请求 (ID: ${requestId}, mode: ${requestData?.mode})`);

    const emitResponse = (success, message, extra = {}) => {
        eventSource.emit(eventNames.CHAR_DATA_IMPORT_RESPONSE, {
            id: requestId,
            success,
            message,
            ...extra
        });
    };

    try {
        // 参数校验
        if (!requestData || !requestData.mode) {
            emitResponse(false, '缺少必需参数 mode（可选值: "text" | "structured"）');
            return;
        }

        let extracted;

        if (requestData.mode === 'text') {
            // 文本模式：解析 <人物>/<服装> 标签
            if (!requestData.text || typeof requestData.text !== 'string') {
                emitResponse(false, 'mode="text" 时必须提供 text 字段（包含 <人物>/<服装> 标签的文本）');
                return;
            }

            const cleanedText = removeThinkingTags(requestData.text);
            extracted = extractCharacterAndOutfitTags(cleanedText);

            if (extracted.characters.length === 0 && extracted.outfits.length === 0) {
                emitResponse(false, '未在文本中检测到有效的 <人物> 或 <服装> 标签');
                return;
            }

        } else if (requestData.mode === 'structured') {
            // 结构化模式：直接使用传入的数据
            if (!requestData.data || typeof requestData.data !== 'object') {
                emitResponse(false, 'mode="structured" 时必须提供 data 字段（{ characters, outfits }）');
                return;
            }

            const characters = requestData.data.characters || [];
            const outfits = requestData.data.outfits || [];

            // 基本校验：至少要有一项数据
            if (characters.length === 0 && outfits.length === 0) {
                emitResponse(false, 'data 中 characters 和 outfits 均为空');
                return;
            }

            // 校验角色数据必须有 nameCN
            for (let i = 0; i < characters.length; i++) {
                if (!characters[i].nameCN) {
                    emitResponse(false, `characters[${i}] 缺少必需字段 nameCN`);
                    return;
                }
            }

            // 校验服装数据必须有 nameCN
            for (let i = 0; i < outfits.length; i++) {
                if (!outfits[i].nameCN) {
                    emitResponse(false, `outfits[${i}] 缺少必需字段 nameCN`);
                    return;
                }
            }

            extracted = { characters, outfits };

        } else {
            emitResponse(false, `不支持的 mode: "${requestData.mode}"（可选值: "text" | "structured"）`);
            return;
        }

        // 执行录入（复用 handleExtractedData，包含弹窗确认）
        const metadata = requestData.metadata || {};
        await handleExtractedData(extracted, metadata);

        const charCount = extracted.characters?.length || 0;
        const outfitCount = extracted.outfits?.length || 0;
        // 统计角色关联的服装数
        let matchedOutfitCount = 0;
        if (extracted.characters) {
            for (const char of extracted.characters) {
                matchedOutfitCount += (char.matchedOutfits?.length || 0);
            }
        }
        const totalOutfits = outfitCount + matchedOutfitCount;

        emitResponse(true, `录入完成：${charCount} 个角色, ${totalOutfits} 套服装`, {
            characterCount: charCount,
            outfitCount: totalOutfits
        });

        console.log(`[characterGen] 外部数据录入完成 (ID: ${requestId}): ${charCount} 角色, ${totalOutfits} 服装`);

    } catch (error) {
        console.error('[characterGen] 外部数据录入失败:', error);
        emitResponse(false, `录入失败: ${error.message}`);
    }
}

/**
 * 注册角色/服装外部数据录入事件监听器
 * 应在模块初始化时调用一次
 */
export function registerCharDataImportListener() {
    eventSource.on(eventNames.CHAR_DATA_IMPORT_REQUEST, onCharDataImportRequest);
    console.log('[characterGen] 已注册外部数据录入事件监听器');
}
