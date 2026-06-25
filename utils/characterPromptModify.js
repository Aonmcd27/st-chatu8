// @ts-nocheck
/**
 * characterPromptModify.js - 角色提示词修改模块
 * 
 * 用于修改现有角色预设的提示词
 * 使用已保存的上下文和世界书触发进行 LLM 请求
 * 解析 LLM 输出并更新角色详细参数
 */

import { eventSource } from "../../../../../script.js";
import { eventNames, extensionName } from './config.js';
import { extension_settings } from "../../../../extensions.js";
import { getContext } from "../../../../st-context.js";
import { saveSettingsDebounced } from "../../../../../script.js";

// 从 worldbook.js 导入角色列表生成函数
import {
    generateCharacterListText,
    generateOutfitEnableListText,
    generateCommonCharacterListText
} from './settings/worldbook.js';

import { updateCombinedPrompt } from './settings/llm.js';
import { buildPromptForRequestType, getMergeOptionsForRequestType } from './settings/llmService.js';
import { refreshCharacterSettings } from './settings/character/index.js';
import { stylishConfirm } from './ui_common.js';
import { mergeAdjacentMessages, replaceAllPlaceholders, replacePlaceholder as replaceOnePlaceholder } from './promptProcessor.js';

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
 * @returns {string}
 */
function generateRequestId() {
    if (crypto && crypto.randomUUID) {
        return crypto.randomUUID();
    }
    return Date.now().toString(36) + Math.random().toString(36).substring(2);
}

/**
 * 获取角色修改的提示词
 * @returns {Promise<Array>} 消息数组
 */
export function LLM_CHAR_MODIFY_GET_PROMPT() {
    return new Promise((resolve, reject) => {
        const promptRequestId = generateRequestId();
        console.log(`[characterPromptModify] Requesting char modify prompt (ID: ${promptRequestId})`);

        const handler = (promptData) => {
            if (promptData.id !== promptRequestId) return;
            eventSource.removeListener(eventNames.LLM_CHAR_MODIFY_GET_PROMPT_RESPONSE, handler);
            resolve(promptData.prompt);
        };

        eventSource.on(eventNames.LLM_CHAR_MODIFY_GET_PROMPT_RESPONSE, handler);
        eventSource.emit(eventNames.LLM_CHAR_MODIFY_GET_PROMPT_REQUEST, { id: promptRequestId });

        setTimeout(() => {
            eventSource.removeListener(eventNames.LLM_CHAR_MODIFY_GET_PROMPT_RESPONSE, handler);
            reject(new Error("获取角色修改提示词超时"));
        }, 10000);
    });
}

/**
 * 执行角色修改 LLM 请求
 * @param {Array} prompt - 消息数组
 * @param {Object} options - 选项
 * @returns {Promise<string>} LLM 输出
 */
export function LLM_CHAR_MODIFY(prompt, options = {}) {
    return new Promise((resolve, reject) => {
        const requestId = generateRequestId();
        const timeoutMs = options.timeoutMs || 60000;
        let timeoutTimer = null;

        console.log(`[characterPromptModify] Executing char modify LLM request (ID: ${requestId})`);

        const cleanup = () => {
            eventSource.removeListener(eventNames.LLM_CHAR_MODIFY_RESPONSE, handler);
            if (timeoutTimer) {
                clearTimeout(timeoutTimer);
                timeoutTimer = null;
            }
        };

        const handler = (responseData) => {
            if (responseData.id !== requestId) return;
            cleanup();

            if (responseData.success) {
                resolve(responseData.result);
            } else {
                reject(new Error(responseData.result || 'LLM 请求失败'));
            }
        };

        eventSource.on(eventNames.LLM_CHAR_MODIFY_RESPONSE, handler);
        eventSource.emit(eventNames.LLM_CHAR_MODIFY_REQUEST, { prompt, id: requestId });

        timeoutTimer = setTimeout(() => {
            cleanup();
            reject(new Error("角色修改 LLM 请求超时"));
        }, timeoutMs);
    });
}

/**
 * 预处理标签内容
 * 1. 将中文冒号替换为英文冒号
 * 2. 将英文括号替换为中文括号
 * 3. 将中文逗号替换为英文逗号
 * 4. 修正常见的字段名拼写错误
 */
function preprocessTagContent(content) {
    let processed = content
        .replace(/:/g, ':')  // 中文冒号 -> 英文冒号
        .replace(/,/g, ','); // 中文逗号 -> 英文逗号

    // 修正常见的字段名拼写错误
    processed = processed.replace(/下半身NSWebcam:/g, '下半身NSFW背面:');
    processed = processed.replace(/下半身NSFW_背面:/g, '下半身NSFW背面:');
    processed = processed.replace(/上半身NSFW_背面:/g, '上半身NSFW背面:');

    return processed;
}

/**
 * 解析人物数据
 */
function parseCharacterData(content) {
    const lines = content.split('\n').map(line => line.trim()).filter(line => line);
    const data = {
        nameCN: '',
        nameEN: '',
        characterTraits: '',
        facialFeatures: '',
        facialFeaturesBack: '',
        upperBodySFW: '',
        upperBodySFWBack: '',
        fullBodySFW: '',
        fullBodySFWBack: '',
        upperBodyNSFW: '',
        upperBodyNSFWBack: '',
        fullBodyNSFW: '',
        fullBodyNSFWBack: ''
    };

    const fieldMap = {
        '中文名称': 'nameCN',
        '英文名称': 'nameEN',
        '角色特征': 'characterTraits',
        '五官外貌': 'facialFeatures',
        '五官外貌背面': 'facialFeaturesBack',
        '上半身SFW': 'upperBodySFW',
        '上半身SFW背面': 'upperBodySFWBack',
        '下半身SFW': 'fullBodySFW',
        '下半身SFW背面': 'fullBodySFWBack',
        '上半身NSFW': 'upperBodyNSFW',
        '上半身NSFW背面': 'upperBodyNSFWBack',
        '下半身NSFW': 'fullBodyNSFW',
        '下半身NSFW背面': 'fullBodyNSFWBack'
    };

    for (const line of lines) {
        const colonIndex = line.indexOf(':');
        if (colonIndex === -1) continue;

        const key = line.substring(0, colonIndex).trim();
        const value = line.substring(colonIndex + 1).trim();

        if (fieldMap[key]) {
            data[fieldMap[key]] = value;
        } else if (key && value) {
            // 记录未识别的字段以便调试
            console.log(`[characterPromptModify] 未识别的人物字段 "${key}"`);
        }
    }

    // 必须有中文名称才算有效
    if (!data.nameCN) {
        return null;
    }

    // 输出调试信息
    console.log('[characterPromptModify] 解析到的人物数据:', data);

    return data;
}

/**
 * 解析服装数据
 */
function parseOutfitData(content) {
    const lines = content.split('\n').map(line => line.trim()).filter(line => line);
    const data = {
        nameCN: '',
        nameEN: '',
        owner: '',  // 归属人（英文名称）
        upperBody: '',
        upperBodyBack: '',
        fullBody: '',
        fullBodyBack: ''
    };

    const fieldMap = {
        '归属人': 'owner',
        '中文名称': 'nameCN',
        '英文名称': 'nameEN',
        '上半身': 'upperBody',
        '上半身背面': 'upperBodyBack',
        '下半身': 'fullBody',
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
            console.log(`[characterPromptModify] 未识别的服装字段 "${key}"`);
        }
    }

    // 必须有中文名称才算有效
    if (!data.nameCN) {
        return null;
    }

    console.log('[characterPromptModify] 解析到的服装数据:', data);
    return data;
}

/**
 * 提取人物和服装标签
 */
function extractCharacterAndOutfitTags(message) {
    const items = []; // 按位置顺序存储所有项目

    // 先移除 <thinking>...</thinking> 标签及其内容
    message = message.replace(/<thinking>[\s\S]*?<\/thinking>/gi, '').trim();

    // 使用联合正则一次性提取所有标签，保留位置信息
    const combinedRegex = /<(人物|服装)>([\s\S]*?)<\/\1>/g;
    let match;
    while ((match = combinedRegex.exec(message)) !== null) {
        const type = match[1]; // "人物" 或 "服装"
        const content = preprocessTagContent(match[2]);
        const position = match.index;

        if (type === '人物') {
            const parsed = parseCharacterData(content);
            if (parsed) {
                items.push({ type: 'character', data: parsed, position, matchedOutfits: [] });
            }
        } else if (type === '服装') {
            const parsed = parseOutfitData(content);
            if (parsed) {
                items.push({ type: 'outfit', data: parsed, position });
            }
        }
    }

    // 按位置排序
    items.sort((a, b) => a.position - b.position);

    // 将服装分配给前面最近的人物
    let currentCharacter = null;
    const characters = [];
    const orphanOutfits = []; // 没有对应人物的服装（出现在第一个人物之前）

    for (const item of items) {
        if (item.type === 'character') {
            currentCharacter = item;
            characters.push(item);
        } else if (item.type === 'outfit') {
            if (currentCharacter) {
                currentCharacter.matchedOutfits.push(item.data);
            } else {
                orphanOutfits.push(item.data);
            }
        }
    }

    // 返回结果
    return {
        characters: characters.map(c => ({ ...c.data, matchedOutfits: c.matchedOutfits })),
        outfits: orphanOutfits
    };
}

/**
 * 获取当前角色预设数据
 */
function getCurrentCharacterPreset() {
    const settings = extension_settings[extensionName];
    const presetId = settings.characterPresetId;

    if (!presetId || !settings.characterPresets[presetId]) {
        return null;
    }

    return {
        id: presetId,
        data: settings.characterPresets[presetId]
    };
}

/**
 * 构建当前角色的文本表示
 */
function buildCharacterText(preset) {
    const data = preset.data;
    let text = '<人物>\n';
    text += `中文名称: ${data.nameCN || ''}\n`;
    text += `英文名称: ${data.nameEN || ''}\n`;
    text += `角色特征: ${data.characterTraits || ''}\n`;
    text += `五官外貌: ${data.facialFeatures || ''}\n`;
    text += `五官外貌背面: ${data.facialFeaturesBack || ''}\n`;
    text += `上半身SFW: ${data.upperBodySFW || ''}\n`;
    text += `上半身SFW背面: ${data.upperBodySFWBack || ''}\n`;
    text += `下半身SFW: ${data.fullBodySFW || ''}\n`;
    text += `下半身SFW背面: ${data.fullBodySFWBack || ''}\n`;
    text += `上半身NSFW: ${data.upperBodyNSFW || ''}\n`;
    text += `上半身NSFW背面: ${data.upperBodyNSFWBack || ''}\n`;
    text += `下半身NSFW: ${data.fullBodyNSFW || ''}\n`;
    text += `下半身NSFW背面: ${data.fullBodyNSFWBack || ''}\n`;
    text += '</人物>';
    return text;
}

/**
 * 处理角色提示词修改请求
 * @param {string} userRequirement - 用户需求 (来自输入框)
 * @param {Array} userImages - 用户上传的图片数组 [{base64, name}]
 */
export async function handleCharacterPromptModify(userRequirement, userImages = []) {
    console.log('[characterPromptModify] Starting character prompt modify request...');
    toastr.info('[characterPromptModify] 正在处理角色提示词修改请求...');

    try {
        const context = getContext();
        const settings = extension_settings[extensionName];

        // 1. 获取当前角色预设
        const currentPreset = getCurrentCharacterPreset();
        if (!currentPreset) {
            toastr.error('请先选择一个角色预设');
            return;
        }

        console.log('[characterPromptModify] Current preset:', currentPreset.id);

        // 2. 获取已保存的上下文和世界书触发
        const savedContext = currentPreset.data.generationContext || '';
        const savedWorldBook = currentPreset.data.generationWorldBook || '';
        const savedVariables = currentPreset.data.generationVariables || {};

        console.log('[characterPromptModify] Saved context:', savedContext);
        console.log('[characterPromptModify] Saved world book:', savedWorldBook);
        console.log('[characterPromptModify] Saved variables:', savedVariables);

        // 4. 获取角色/服装列表（基于触发文本过滤）
        // ★ 构建条目触发文本：只使用用户需求
        const entryTriggerText = userRequirement || '';

        // ★ 构建角色触发文本：用户需求 + 已保存的上下文 + 已保存的世界书触发（用于角色列表生成）
        const characterTriggerTextParts = [];
        if (userRequirement) {
            characterTriggerTextParts.push(userRequirement);
        }
        if (savedContext) {
            characterTriggerTextParts.push(savedContext);
        }
        if (savedWorldBook) {
            characterTriggerTextParts.push(savedWorldBook);
        }
        const characterTriggerText = characterTriggerTextParts.join('\n');
        console.log('[characterPromptModify] Character trigger text:', characterTriggerText);

        // 3. 获取角色修改提示词（使用条目触发文本来触发条目）
        let prompt = buildPromptForRequestType('char_modify', entryTriggerText);

        if (!prompt || prompt.length === 0) {
            throw new Error('未能获取到提示词，请检查 LLM 设置中"角色/服装修改"的上下文预设配置');
        }

        const characterListText = generateCharacterListText(characterTriggerText);
        const outfitEnableListText = generateOutfitEnableListText();
        const commonCharacterListText = generateCommonCharacterListText();
        console.log('[characterPromptModify] Character list text (triggered):', characterListText);

        const currentVariables = context.chatMetadata?.variables || {};

        // 5. 构建当前角色的文本表示
        const currentCharacterText = buildCharacterText(currentPreset);

        // ★ 使用新的 promptProcessor 模块进行处理
        // 1. 先合并相邻相同角色的消息
        prompt = mergeAdjacentMessages(prompt, getMergeOptionsForRequestType('char_modify'));
        console.log('[characterPromptModify] 合并相邻消息后:', prompt);

        // 在替换前先找到包含 {{用户需求}} 的消息索引（用于后续附加图片）
        const userRequirementMessageIndex = findMessageIndexWithPlaceholder(prompt, '{{用户需求}}');
        console.log('[characterPromptModify] User requirement message index:', userRequirementMessageIndex);

        // 2. 准备上下文数据用于占位符替换
        const contextData = {
            context: savedContext,
            worldBookContent: savedWorldBook,
            variables: { ...savedVariables, ...currentVariables },
            userDemand: userRequirement || '',
            characterListText: characterListText,
            outfitEnableListText: outfitEnableListText,
            commonCharacterListText: commonCharacterListText
        };

        // 3. 替换所有标准占位符
        const { messages: processedMessages, replacedVariables } = await replaceAllPlaceholders(prompt, contextData);
        prompt = processedMessages;

        // 4. 替换特殊占位符（当前角色）
        prompt = replaceOnePlaceholder(prompt, "{{当前角色}}", currentCharacterText, replacedVariables);

        console.log('[characterPromptModify] Final prompt:', prompt);

        // 更新调试显示
        let diagnosticText = "";
        if (replacedVariables.size > 0) {
            diagnosticText = `诊断：检测到以下变量被使用：${[...replacedVariables].join('、')}\n`;
        }

        // 如果有用户上传的图片，附加到包含用户需求的消息
        if (userImages && userImages.length > 0 && userRequirementMessageIndex >= 0) {
            prompt = attachImagesToMessage(prompt, userRequirementMessageIndex, userImages, '参考图片');
            console.log('[characterPromptModify] Attached', userImages.length, 'images to message at index', userRequirementMessageIndex);
        }

        updateCombinedPrompt(prompt, diagnosticText);

        // 7. 执行 LLM 请求
        const llmOutput = await LLM_CHAR_MODIFY(prompt, { timeoutMs: 600000 });
        console.log('[characterPromptModify] LLM output:', llmOutput);

        if (!llmOutput) {
            toastr.error('LLM 返回结果为空');
            return;
        }

        // 8. 解析 LLM 输出中的角色和服装标签
        const extracted = extractCharacterAndOutfitTags(llmOutput);

        if (extracted.characters.length === 0 && extracted.outfits.length === 0) {
            toastr.warning('未在 LLM 输出中检测到角色或服装标签');
            console.log('[characterPromptModify] No character/outfit tags found in output');
            console.log('[characterPromptModify] Raw LLM output for debugging:', llmOutput);
            return;
        }

        console.log('[characterPromptModify] Extracted data:', extracted);

        // 9. 更新角色数据 (只取第一个角色)
        if (extracted.characters.length > 0) {
            const newCharData = extracted.characters[0];
            await updateCharacterPresetFromLLM(currentPreset.id, newCharData);
        }

        // 10. 处理服装数据
        const allOutfits = [...extracted.outfits];
        // 收集角色匹配的服装
        for (const char of extracted.characters) {
            if (char.matchedOutfits && char.matchedOutfits.length > 0) {
                allOutfits.push(...char.matchedOutfits);
            }
        }

        if (allOutfits.length > 0) {
            await updateOutfitPresetsFromLLM(allOutfits);
        }

        toastr.success('角色/服装提示词修改完成！');

    } catch (error) {
        console.error('[characterPromptModify] Error:', error);
        toastr.error(`角色提示词修改失败: ${error.message}`);
    }
}

/**
 * 从 LLM 输出更新角色预设
 * @param {string} presetId - 预设ID
 * @param {Object} newData - 新的角色数据
 */
async function updateCharacterPresetFromLLM(presetId, newData) {
    const settings = extension_settings[extensionName];
    const preset = settings.characterPresets[presetId];

    if (!preset) {
        toastr.error('找不到指定的角色预设');
        return;
    }

    // 统计更改数量
    const fieldLabels = {
        'nameCN': '中文名称',
        'nameEN': '英文名称',
        'characterTraits': '角色特征',
        'facialFeatures': '五官外貌',
        'facialFeaturesBack': '五官外貌背面',
        'upperBodySFW': '上半身SFW',
        'upperBodySFWBack': '上半身SFW背面',
        'fullBodySFW': '下半身SFW',
        'fullBodySFWBack': '下半身SFW背面',
        'upperBodyNSFW': '上半身NSFW',
        'upperBodyNSFWBack': '上半身NSFW背面',
        'fullBodyNSFW': '下半身NSFW',
        'fullBodyNSFWBack': '下半身NSFW背面'
    };

    let changesCount = 0;
    for (const field in fieldLabels) {
        if (newData[field] && newData[field] !== preset[field]) {
            changesCount++;
        }
    }

    if (changesCount === 0) {
        toastr.info('没有检测到需要更新的内容');
        return;
    }

    // 构建简洁的确认消息
    const message = `检测到角色 "${presetId}" 有 ${changesCount} 项更改,是否应用?`;

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
    const characterTab = $('#st-chatu8-tab-character');
    if (characterTab.length) {
        refreshCharacterSettings(characterTab);
    }

    // 更新表单字段
    updateFormFields(newData);

    console.log(`[characterPromptModify] 已更新角色预设 "${presetId}"`);
}

/**
 * 从 LLM 输出更新服装预设
 * @param {Array} outfitsData - 服装数据数组
 */
async function updateOutfitPresetsFromLLM(outfitsData) {
    const settings = extension_settings[extensionName];

    // 获取当前角色卡名称作为前缀
    const stContext = getContext();
    const cardPrefix = stContext?.name2 ? `[${stContext.name2}]` : '';

    const outfitFieldLabels = {
        'nameCN': '中文名称',
        'nameEN': '英文名称',
        'owner': '归属人',
        'upperBody': '上半身',
        'upperBodyBack': '上半身背面',
        'fullBody': '下半身',
        'fullBodyBack': '下半身背面'
    };

    for (const outfitData of outfitsData) {
        const rawOutfitName = outfitData.nameCN;
        if (!rawOutfitName) continue;

        const outfitName = cardPrefix ? `${cardPrefix}${rawOutfitName}` : rawOutfitName;

        // 检查服装是否已存在
        const existingOutfit = settings.outfitPresets?.[outfitName];

        if (existingOutfit) {
            // 更新已有服装
            let changesCount = 0;
            for (const field in outfitFieldLabels) {
                if (outfitData[field] && outfitData[field] !== existingOutfit[field]) {
                    changesCount++;
                }
            }

            if (changesCount === 0) {
                console.log(`[characterPromptModify] 服装 "${outfitName}" 没有变更`);
                continue;
            }

            const message = `检测到服装 "${outfitName}" 有 ${changesCount} 项更改,是否应用?`;
            const confirmed = await stylishConfirm(message);
            if (!confirmed) {
                continue;
            }

            // 应用更改
            for (const field in outfitFieldLabels) {
                if (outfitData[field]) {
                    existingOutfit[field] = outfitData[field];
                }
            }

            console.log(`[characterPromptModify] 已更新服装预设 "${outfitName}"`);
        } else {
            // 创建新服装
            const message = `检测到新服装 "${outfitName}",是否录入?`;
            const confirmed = await stylishConfirm(message);
            if (!confirmed) {
                continue;
            }

            if (!settings.outfitPresets) {
                settings.outfitPresets = {};
            }

            settings.outfitPresets[outfitName] = {
                nameCN: outfitData.nameCN,
                nameEN: outfitData.nameEN || '',
                owner: outfitData.owner || '',
                upperBody: outfitData.upperBody || '',
                upperBodyBack: outfitData.upperBodyBack || '',
                fullBody: outfitData.fullBody || '',
                fullBodyBack: outfitData.fullBodyBack || ''
            };

            console.log(`[characterPromptModify] 已创建服装预设 "${outfitName}"`);

            // 如果有归属人，尝试关联到所有匹配的角色（支持多个同名角色）
            if (outfitData.owner && outfitData.owner.trim()) {
                const normalizedOwner = outfitData.owner.trim().toLowerCase().replace(/\s+/g, '');
                let matchCount = 0;
                for (const [charName, charPreset] of Object.entries(settings.characterPresets || {})) {
                    if (charPreset.nameEN && charPreset.nameEN.toLowerCase().replace(/\s+/g, '') === normalizedOwner) {
                        if (!charPreset.outfits) {
                            charPreset.outfits = [];
                        }
                        if (!charPreset.outfits.includes(outfitName)) {
                            charPreset.outfits.push(outfitName);
                            matchCount++;
                            console.log(`[characterPromptModify] 服装 "${outfitName}" 已归属到角色 "${charName}"`);
                        }
                    }
                }
                if (matchCount === 0) {
                    console.warn(`[characterPromptModify] 无法找到归属人 "${outfitData.owner}" 对应的角色,服装 "${outfitName}" 未归属`);
                } else if (matchCount > 1) {
                    console.log(`[characterPromptModify] 服装 "${outfitName}" 已归属到 ${matchCount} 个同名角色`);
                }
            }
        }
    }

    saveSettingsDebounced();

    // 刷新UI
    const characterTab = $('#st-chatu8-tab-character');
    if (characterTab.length) {
        refreshCharacterSettings(characterTab);
    }
}

/**
 * 更新表单字段
 * @param {Object} data - 新数据
 */
function updateFormFields(data) {
    const fields = ['nameCN', 'nameEN', 'characterTraits', 'facialFeatures', 'facialFeaturesBack', 'upperBodySFW', 'upperBodySFWBack', 'fullBodySFW', 'fullBodySFWBack', 'upperBodyNSFW', 'upperBodyNSFWBack', 'fullBodyNSFW', 'fullBodyNSFWBack'];

    fields.forEach(field => {
        if (data[field]) {
            const element = document.getElementById(`char_${field}`);
            if (element) {
                element.value = data[field];
                // 触发 input 事件
                $(element).trigger('input');
            }
        }
    });
}
