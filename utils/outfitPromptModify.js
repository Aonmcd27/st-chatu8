// @ts-nocheck
/**
 * outfitPromptModify.js - 服装提示词修改模块
 * 
 * 用于修改现有服装预设的提示词
 * 解析 LLM 输出并更新服装详细参数
 */

import { eventSource } from "../../../../../script.js";
import { eventNames, extensionName } from './config.js';
import { extension_settings } from "../../../../extensions.js";
import { saveSettingsDebounced } from "../../../../../script.js";
import { updateCombinedPrompt } from './settings/llm.js';
import { buildPromptForRequestType } from './settings/llmService.js';
import { loadOutfitPreset } from './settings/character/index.js';
import { stylishConfirm } from './ui_common.js';

/**
 * 替换占位符函数
 */
function replacePlaceholder(obj, placeholder, value, replacedSet) {
    if (typeof obj === 'string') {
        if (value && obj.includes(placeholder)) {
            if (replacedSet) {
                replacedSet.add(placeholder);
            }
        }
        return obj.replaceAll(placeholder, value);
    }

    if (Array.isArray(obj)) {
        return obj.map(item => replacePlaceholder(item, placeholder, value, replacedSet));
    }

    if (obj && typeof obj === 'object') {
        const newObj = {};
        for (const key in obj) {
            newObj[key] = replacePlaceholder(obj[key], placeholder, value, replacedSet);
        }
        return newObj;
    }

    return obj;
}

/**
 * 将图片附加到指定索引的消息中（OpenAI 多模态格式）
 * @param {Array} messages - 消息数组
 * @param {number} messageIndex - 要附加图片的消息索引
 * @param {Array} images - 图片数组 [{base64, name}]
 * @param {string} imageLabel - 图片标签前缀
 * @returns {Array} 处理后的消息数组
 */
function attachImagesToMessage(messages, messageIndex, images, imageLabel = '参考图片') {
    if (!images || images.length === 0 || messageIndex < 0 || messageIndex >= messages.length) {
        return messages;
    }

    const result = [...messages];
    const targetMsg = result[messageIndex];

    const contentParts = [];

    if (typeof targetMsg.content === 'string') {
        contentParts.push({
            type: 'text',
            text: targetMsg.content
        });
    } else if (Array.isArray(targetMsg.content)) {
        contentParts.push(...targetMsg.content);
    }

    if (images.length > 0) {
        contentParts.push({
            type: 'text',
            text: `\n[以下是用户上传的${images.length}张${imageLabel}]`
        });
    }

    images.forEach((imgItem, idx) => {
        const imgBase64 = typeof imgItem === 'string' ? imgItem : imgItem.base64;
        const imgName = typeof imgItem === 'object' && imgItem.name ? imgItem.name : `${imageLabel}${idx + 1}`;

        contentParts.push({
            type: 'text',
            text: `[${imgName}]`
        });

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
 */
function generateRequestId() {
    if (crypto && crypto.randomUUID) {
        return crypto.randomUUID();
    }
    return Date.now().toString(36) + Math.random().toString(36).substring(2);
}

/**
 * 获取服装修改的提示词
 * @returns {Promise<Array>} 消息数组
 */
export function LLM_OUTFIT_MODIFY_GET_PROMPT() {
    return new Promise((resolve, reject) => {
        const promptRequestId = generateRequestId();
        console.log(`[outfitPromptModify] Requesting outfit modify prompt (ID: ${promptRequestId})`);

        const handler = (promptData) => {
            if (promptData.id !== promptRequestId) return;
            eventSource.removeListener(eventNames.LLM_CHAR_MODIFY_GET_PROMPT_RESPONSE, handler);
            resolve(promptData.prompt);
        };

        eventSource.on(eventNames.LLM_CHAR_MODIFY_GET_PROMPT_RESPONSE, handler);
        eventSource.emit(eventNames.LLM_CHAR_MODIFY_GET_PROMPT_REQUEST, { id: promptRequestId });

        setTimeout(() => {
            eventSource.removeListener(eventNames.LLM_CHAR_MODIFY_GET_PROMPT_RESPONSE, handler);
            reject(new Error("获取服装修改提示词超时"));
        }, 10000);
    });
}

/**
 * 执行服装修改 LLM 请求
 */
export function LLM_OUTFIT_MODIFY(prompt, options = {}) {
    return new Promise((resolve, reject) => {
        const requestId = generateRequestId();
        const timeoutMs = options.timeoutMs || 60000;

        console.log(`[outfitPromptModify] Executing outfit modify LLM request (ID: ${requestId})`);

        const handler = (responseData) => {
            if (responseData.id !== requestId) return;
            eventSource.removeListener(eventNames.LLM_CHAR_MODIFY_RESPONSE, handler);

            if (responseData.success) {
                resolve(responseData.result);
            } else {
                reject(new Error(responseData.result || 'LLM 请求失败'));
            }
        };

        eventSource.on(eventNames.LLM_CHAR_MODIFY_RESPONSE, handler);
        eventSource.emit(eventNames.LLM_CHAR_MODIFY_REQUEST, { prompt, id: requestId });

        setTimeout(() => {
            eventSource.removeListener(eventNames.LLM_CHAR_MODIFY_RESPONSE, handler);
            reject(new Error("服装修改 LLM 请求超时"));
        }, timeoutMs);
    });
}

/**
 * 预处理标签内容
 */
function preprocessTagContent(content) {
    let processed = content
        .replace(/:/g, ':')
        .replace(/\(/g, '（')
        .replace(/\)/g, '）')
        .replace(/,/g, ',');

    return processed;
}

/**
 * 解析服装数据
 */
function parseOutfitData(content) {
    const lines = content.split('\n').map(line => line.trim()).filter(line => line);
    const data = {
        nameCN: '',
        nameEN: '',
        upperBody: '',
        upperBodyBack: '',
        fullBody: '',
        fullBodyBack: ''
    };

    const fieldMap = {
        '中文名称': 'nameCN',
        '英文名称': 'nameEN',
        '上半身': 'upperBody',
        '上半身背面': 'upperBodyBack',
        '下半身': 'fullBody',
        '下半身服装': 'fullBody',
        '下半身背面': 'fullBodyBack'
    };

    for (const line of lines) {
        const colonIndex = line.indexOf(':');
        if (colonIndex === -1) continue;

        const key = line.substring(0, colonIndex).trim();
        const value = line.substring(colonIndex + 1).trim();

        if (fieldMap[key]) {
            data[fieldMap[key]] = value;
        } else if (key && value) {
            console.log(`[outfitPromptModify] 未识别的服装字段 "${key}"`);
        }
    }

    // 必须有中文名称才算有效
    if (!data.nameCN) {
        return null;
    }

    console.log('[outfitPromptModify] 解析到的服装数据:', data);

    return data;
}

/**
 * 提取服装标签
 */
function extractOutfitTags(message) {
    const result = {
        outfits: []
    };

    // 先移除 <thinking>...</thinking> 标签及其内容
    message = message.replace(/<thinking>[\s\S]*?<\/thinking>/gi, '').trim();

    // 提取服装标签
    const outfitRegex = /<服装>([\s\S]*?)<\/服装>/g;
    let match;
    while ((match = outfitRegex.exec(message)) !== null) {
        const content = preprocessTagContent(match[1]);
        const parsed = parseOutfitData(content);
        if (parsed) {
            result.outfits.push(parsed);
        }
    }

    return result;
}

/**
 * 获取当前服装预设数据
 */
function getCurrentOutfitPreset() {
    const settings = extension_settings[extensionName];
    const presetId = settings.outfitPresetId;

    if (!presetId || !settings.outfitPresets[presetId]) {
        return null;
    }

    return {
        id: presetId,
        data: settings.outfitPresets[presetId]
    };
}

/**
 * 构建当前服装的文本表示
 */
function buildOutfitText(preset) {
    const data = preset.data;
    let text = '<服装>\n';
    text += `中文名称: ${data.nameCN || ''}\n`;
    text += `英文名称: ${data.nameEN || ''}\n`;
    text += `上半身: ${data.upperBody || ''}\n`;
    text += `上半身背面: ${data.upperBodyBack || ''}\n`;
    text += `下半身: ${data.fullBody || ''}\n`;
    text += `下半身背面: ${data.fullBodyBack || ''}\n`;
    text += '</服装>';
    return text;
}

/**
 * 处理服装提示词修改请求
 * @param {string} userRequirement - 用户需求 (来自输入框)
 * @param {Array} userImages - 用户上传的图片数组 [{base64, name}]
 */
export async function handleOutfitPromptModify(userRequirement, userImages = []) {
    console.log('[outfitPromptModify] Starting outfit prompt modify request...');
    toastr.info('正在处理服装提示词修改请求...');

    try {
        const settings = extension_settings[extensionName];

        // 1. 获取当前服装预设
        const currentPreset = getCurrentOutfitPreset();
        if (!currentPreset) {
            toastr.error('请先选择一个服装预设');
            return;
        }

        console.log('[outfitPromptModify] Current preset:', currentPreset.id);

        // 构建触发文本：用户需求 + 服装信息
        const currentOutfitText = buildOutfitText(currentPreset);
        const triggerText = [userRequirement || '', currentOutfitText].filter(Boolean).join('\n');

        // 2. 获取服装修改提示词（使用触发文本来触发条目）
        let prompt = buildPromptForRequestType('char_modify', triggerText);

        if (!prompt || prompt.length === 0) {
            throw new Error('未能获取到提示词，请检查 LLM 设置中"角色/服装修改"的上下文预设配置');
        }

        const replacedVariables = new Set();

        // 3. 构建当前服装的文本表示（已在上面构建）

        // 4. 替换占位符

        // 在替换前先找到包含 {{用户需求}} 的消息索引（用于后续附加图片）
        const userRequirementMessageIndex = findMessageIndexWithPlaceholder(prompt, '{{用户需求}}');
        console.log('[outfitPromptModify] User requirement message index:', userRequirementMessageIndex);

        prompt = replacePlaceholder(prompt, "{{当前服装}}", currentOutfitText, replacedVariables);
        prompt = replacePlaceholder(prompt, "{{服装列表}}", currentOutfitText, replacedVariables);
        prompt = replacePlaceholder(prompt, "{{用户需求}}", userRequirement || '', replacedVariables);


        // 清空不需要的占位符
        prompt = replacePlaceholder(prompt, "{{当前角色}}", '', replacedVariables);
        prompt = replacePlaceholder(prompt, "{{上下文}}", '', replacedVariables);
        prompt = replacePlaceholder(prompt, "{{世界书触发}}", '', replacedVariables);
        prompt = replacePlaceholder(prompt, "{{角色启用列表}}", '', replacedVariables);
        prompt = replacePlaceholder(prompt, "{{通用服装启用列表}}", '', replacedVariables);
        prompt = replacePlaceholder(prompt, "{{通用角色启用列表}}", '', replacedVariables);

        console.log('[outfitPromptModify] Final prompt:', prompt);

        // 更新调试显示
        let diagnosticText = "";
        if (replacedVariables.size > 0) {
            diagnosticText = `诊断：检测到以下变量被使用：${[...replacedVariables].join('、')}\n`;
        }

        // 如果有用户上传的图片，附加到包含用户需求的消息
        if (userImages && userImages.length > 0 && userRequirementMessageIndex >= 0) {
            prompt = attachImagesToMessage(prompt, userRequirementMessageIndex, userImages, '参考图片');
            console.log('[outfitPromptModify] Attached', userImages.length, 'images to message at index', userRequirementMessageIndex);
        }

        updateCombinedPrompt(prompt, diagnosticText);

        // 5. 执行 LLM 请求
        const llmOutput = await LLM_OUTFIT_MODIFY(prompt, { timeoutMs: 600000 });
        console.log('[outfitPromptModify] LLM output:', llmOutput);

        if (!llmOutput) {
            toastr.error('LLM 返回结果为空');
            return;
        }

        // 6. 解析 LLM 输出中的服装标签
        const extracted = extractOutfitTags(llmOutput);

        if (extracted.outfits.length === 0) {
            toastr.warning('未在 LLM 输出中检测到服装标签');
            console.log('[outfitPromptModify] Raw LLM output for debugging:', llmOutput);
            return;
        }

        console.log('[outfitPromptModify] Extracted data:', extracted);

        // 7. 更新服装数据 (只取第一个服装)
        const newOutfitData = extracted.outfits[0];
        await updateOutfitPresetFromLLM(currentPreset.id, newOutfitData);

        toastr.success('服装提示词修改完成！');

    } catch (error) {
        console.error('[outfitPromptModify] Error:', error);
        toastr.error(`服装提示词修改失败: ${error.message}`);
    }
}

/**
 * 从 LLM 输出更新服装预设
 * @param {string} presetId - 预设ID
 * @param {Object} newData - 新的服装数据
 */
async function updateOutfitPresetFromLLM(presetId, newData) {
    const settings = extension_settings[extensionName];
    const preset = settings.outfitPresets[presetId];

    if (!preset) {
        toastr.error('找不到指定的服装预设');
        return;
    }

    // 构建确认消息
    let message = `准备更新服装 "${presetId}" 的以下数据:\n\n`;

    const fieldLabels = {
        'nameCN': '中文名称',
        'nameEN': '英文名称',
        'upperBody': '上半身',
        'upperBodyBack': '上半身背面',
        'fullBody': '下半身',
        'fullBodyBack': '下半身背面'
    };

    let changesCount = 0;
    for (const field in fieldLabels) {
        if (newData[field] && newData[field] !== preset[field]) {
            const oldValue = preset[field] || '(空)';
            const newValue = newData[field];
            message += `• ${fieldLabels[field]}:\n`;
            message += `  旧: ${oldValue.substring(0, 50)}${oldValue.length > 50 ? '...' : ''}\n`;
            message += `  新: ${newValue.substring(0, 50)}${newValue.length > 50 ? '...' : ''}\n\n`;
            changesCount++;
        }
    }

    if (changesCount === 0) {
        toastr.info('没有检测到需要更新的内容');
        return;
    }

    message += `共 ${changesCount} 项更改,是否应用?`;

    const confirmed = await stylishConfirm(message);
    if (!confirmed) {
        toastr.info('已取消更新');
        return;
    }

    // 应用更改
    for (const field in fieldLabels) {
        if (newData[field]) {
            preset[field] = newData[field];
        }
    }

    // 保存设置
    saveSettingsDebounced();

    // 刷新UI
    const outfitTab = $('#st-chatu8-tab-character');
    if (outfitTab.length) {
        loadOutfitPreset();
    }

    // 更新表单字段
    updateOutfitFormFields(newData);

    console.log(`[outfitPromptModify] 已更新服装预设 "${presetId}"`);
}

/**
 * 更新表单字段
 * @param {Object} data - 新数据
 */
function updateOutfitFormFields(data) {
    const fields = ['nameCN', 'nameEN', 'upperBody', 'upperBodyBack', 'fullBody', 'fullBodyBack'];

    fields.forEach(field => {
        if (data[field]) {
            const element = document.getElementById(`outfit_${field}`);
            if (element) {
                element.value = data[field];
                $(element).trigger('input');
            }
        }
    });
}
