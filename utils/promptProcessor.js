// @ts-nocheck
/**
 * promptProcessor.js - Prompt 处理模块
 * 
 * 统一处理 LLM prompt 的构建流程：
 * 1. 先获取数据（上下文、正文、世界书触发、getvar变量）
 * 2. 使用数据触发条目（检查 triggerWords）
 * 3. 合并相邻相同角色的消息
 * 4. 进行占位符替换
 */

import { extension_settings } from "../../../../extensions.js";
import { extensionName } from "./config.js";
import { getContext } from "../../../../st-context.js";
import { getglobalvar, setglobalvar } from "./chatDataUtils.js";
import { getworldvar } from "./worldbookProcessor.js";

// ==================== 触发词检查 ====================

/**
 * 检查触发词是否在触发文本中出现
 * @param {string} triggerWords - 触发词（逗号分隔）
 * @param {string} triggerText - 触发文本
 * @returns {boolean} 是否触发
 */
export function checkTriggerWords(triggerWords, triggerText) {
    if (!triggerWords || !triggerText) {
        return false;
    }

    // 分割触发词，去除空白
    const words = triggerWords.split(',').map(w => w.trim()).filter(w => w);

    if (words.length === 0) {
        return false;
    }

    // 任一触发词匹配即返回 true
    for (const word of words) {
        if (triggerText.includes(word)) {
            return true;
        }
    }

    return false;
}

// ==================== 消息合并 ====================

/**
 * 合并相邻相同角色的消息
 * @param {Array<{role: string, content: string|Array}>} messages - 消息数组
 * @param {object} [options] - 合并选项
 * @param {boolean} [options.mergeSystemUser=false] - 是否将 system 和 user 视为同类角色进行合并
 * @returns {Array<{role: string, content: string|Array}>} 合并后的消息数组
 */
export function mergeAdjacentMessages(messages, options = {}) {
    if (!messages || messages.length === 0) {
        return [];
    }

    const { mergeSystemUser = false } = options;

    // 如果开启了合并 system 和 user，先将所有 system 角色转为 user
    const normalizedMessages = mergeSystemUser
        ? messages.map(msg => ({
            ...msg,
            role: msg.role === 'system' ? 'user' : msg.role
        }))
        : messages;

    const result = [];
    let current = null;

    for (const msg of normalizedMessages) {
        if (!current) {
            // 第一条消息
            current = { ...msg };
        } else if (current.role === msg.role) {
            // 角色相同，合并内容
            current.content = mergeContent(current.content, msg.content);
        } else {
            // 角色不同，保存当前并开始新的
            result.push(current);
            current = { ...msg };
        }
    }

    // 保存最后一条
    if (current) {
        result.push(current);
    }

    return result;
}

/**
 * 合并两个 content（支持字符串和多模态数组）
 * @param {string|Array} content1 - 第一个内容
 * @param {string|Array} content2 - 第二个内容
 * @returns {string|Array} 合并后的内容
 */
function mergeContent(content1, content2) {
    // 都是字符串：用换行符合并
    if (typeof content1 === 'string' && typeof content2 === 'string') {
        return content1 + '\n' + content2;
    }

    // 转换为数组格式合并
    const parts1 = normalizeToArray(content1);
    const parts2 = normalizeToArray(content2);

    // 在中间添加换行分隔
    return [...parts1, { type: 'text', text: '\n' }, ...parts2];
}

/**
 * 将内容标准化为数组格式
 * @param {string|Array} content - 内容
 * @returns {Array} 数组格式的内容
 */
function normalizeToArray(content) {
    if (Array.isArray(content)) {
        return content;
    }
    return [{ type: 'text', text: content || '' }];
}

// ==================== 占位符替换 ====================

/**
 * 递归替换对象中的占位符
 * @param {*} obj - 要处理的对象（字符串、数组或对象）
 * @param {string} placeholder - 占位符
 * @param {*} value - 替换值
 * @param {Set} [replacedSet] - 记录已替换的变量集合
 * @returns {*} 替换后的对象
 */
export function replacePlaceholder(obj, placeholder, value, replacedSet) {
    // 1. 字符串：直接替换
    if (typeof obj === 'string') {
        if (value && obj.includes(placeholder)) {
            if (replacedSet) {
                replacedSet.add(placeholder);
            }
        }
        return obj.replaceAll(placeholder, value || '');
    }

    // 2. 数组：遍历每个元素递归处理
    if (Array.isArray(obj)) {
        return obj.map(item => replacePlaceholder(item, placeholder, value, replacedSet));
    }

    // 3. 对象：遍历每个属性递归处理
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
 * 替换所有常用占位符
 * @param {Array} messages - 消息数组
 * @param {Object} contextData - 上下文数据
 * @returns {{messages: Array, replacedVariables: Set}} 替换后的消息和已替换变量集合
 */
export async function replaceAllPlaceholders(messages, contextData) {
    const {
        context = '',
        body = '',
        worldBookContent = '',
        variables = {},
        userDemand = '',
        characterListText = '',
        outfitEnableListText = '',
        commonCharacterListText = '',
        floorContext = '' // 新增：楼层信息上下文
    } = contextData;

    const replacedVariables = new Set();
    let result = messages;

    // 获取用户名进行世界书内容的替换
    const stContext = getContext();
    const username = stContext?.name1 || '';

    // 处理世界书触发内容中的 {{user}} 和 <user>
    let processedWorldBookContent = worldBookContent;
    if (processedWorldBookContent) {
        processedWorldBookContent = processedWorldBookContent.replaceAll('{{user}}', username);
        processedWorldBookContent = processedWorldBookContent.replaceAll('<user>', username);
    }

    // ★ 处理楼层信息 + 世界书触发
    let processedFloorContext = '';
    if (floorContext && floorContext.trim()) {
        try {
            // 动态导入 processWorldBooksWithTrigger
            const { processWorldBooksWithTrigger } = await import('./promptReq.js');

            // 使用楼层消息触发世界书
            const floorMessages = floorContext.split('\n').filter(line => line.trim());
            const triggeredWorldBook = await processWorldBooksWithTrigger(floorMessages);

            if (triggeredWorldBook) {
                processedFloorContext = `<酒馆故事背景>\n${triggeredWorldBook}\n</酒馆故事背景>\n\n${floorContext}`;
                console.log('[PromptProcessor] 楼层信息已触发世界书内容');
            } else {
                processedFloorContext = floorContext;
            }
        } catch (err) {
            console.warn('[PromptProcessor] 楼层信息触发世界书失败:', err);
            processedFloorContext = floorContext;
        }
    }

    // 按顺序替换占位符
    result = replacePlaceholder(result, '{{上下文}}', context, replacedVariables);
    result = replacePlaceholder(result, '{{世界书触发}}', processedWorldBookContent, replacedVariables);
    result = replacePlaceholder(result, '{{正文}}', body, replacedVariables);
    result = replacePlaceholder(result, '{{角色启用列表}}', characterListText, replacedVariables);
    result = replacePlaceholder(result, '{{通用服装启用列表}}', outfitEnableListText, replacedVariables);
    result = replacePlaceholder(result, '{{通用角色启用列表}}', commonCharacterListText, replacedVariables);
    result = replacePlaceholder(result, '{{用户需求}}', userDemand, replacedVariables);
    result = replacePlaceholder(result, '{{楼层信息}}', processedFloorContext, replacedVariables);

    // 替换 {{getvar::name}} 格式的变量
    if (variables && Object.keys(variables).length > 0) {
        const getvarPattern = /\{\{getvar::([^}]+)\}\}/g;
        const promptStr = JSON.stringify(result);
        const matches = [...promptStr.matchAll(getvarPattern)];

        const varsToReplace = new Set();
        for (const match of matches) {
            varsToReplace.add(match[1]);
        }

        for (const varName of varsToReplace) {
            const placeholder = `{{getvar::${varName}}}`;
            const value = variables[varName] || '';
            result = replacePlaceholder(result, placeholder, value, replacedVariables);
        }
    }

    // ★ 处理变量占位符（setvar/getvar/setglobalvar/getglobalvar）
    result = processVariablePlaceholdersInMessages(result, replacedVariables);

    return { messages: result, replacedVariables };
}

/**
 * 处理消息中的变量占位符
 * 支持: {{setvar::name::value}}, {{getvar::name}}, {{setglobalvar::name::value}}, {{getglobalvar::name}}
 * value 支持任意符号和换行
 * @param {Array} messages - 消息数组
 * @param {Set} replacedVariables - 记录已替换的变量集合
 * @returns {Array} 处理后的消息数组
 */
function processVariablePlaceholdersInMessages(messages, replacedVariables) {
    if (!messages || messages.length === 0) return messages;

    const context = getContext();

    // 确保 chatMetadata.variables 存在
    if (!context.chatMetadata) {
        context.chatMetadata = {};
    }
    if (!context.chatMetadata.variables) {
        context.chatMetadata.variables = {};
    }

    // 递归处理消息内容
    return messages.map(msg => {
        if (!msg || !msg.content) return msg;

        return {
            ...msg,
            content: processContentVariables(msg.content, context, replacedVariables)
        };
    });
}

/**
 * 处理内容中的变量占位符（支持字符串和多模态数组）
 * @param {string|Array} content - 内容
 * @param {Object} context - SillyTavern context
 * @param {Set} replacedVariables - 记录已替换的变量集合
 * @returns {string|Array} 处理后的内容
 */
function processContentVariables(content, context, replacedVariables) {
    // 处理字符串
    if (typeof content === 'string') {
        return processStringVariables(content, context, replacedVariables);
    }

    // 处理多模态数组
    if (Array.isArray(content)) {
        return content.map(part => {
            if (part && part.type === 'text' && typeof part.text === 'string') {
                return {
                    ...part,
                    text: processStringVariables(part.text, context, replacedVariables)
                };
            }
            return part;
        });
    }

    return content;
}

/**
 * 处理字符串中的变量占位符
 * @param {string} str - 字符串
 * @param {Object} context - SillyTavern context
 * @param {Set} replacedVariables - 记录已替换的变量集合
 * @returns {string} 处理后的字符串
 */
function processStringVariables(str, context, replacedVariables) {
    if (!str) return str;

    let result = str;

    // 1. 处理 {@setvar::name::value@} - 设置聊天变量，替换为空
    // 使用非贪婪匹配，value 可以包含任意字符（包括换行）
    result = result.replace(/\{@setvar::([^:@]+)::([\s\S]*?)@\}/g, (match, name, value) => {
        const trimmedName = name.trim();

        context.chatMetadata.variables[trimmedName] = value;
        if (replacedVariables) {
            replacedVariables.add(`{@setvar::${trimmedName}@}`);
        }
        return ''; // 替换为空
    });

    // 2. 处理 {@getvar::name@} - 获取聊天变量，替换为值
    result = result.replace(/\{@getvar::([^@]+)@\}/g, (match, name) => {
        const trimmedName = name.trim();
        const value = context.chatMetadata.variables[trimmedName] || '';

        if (replacedVariables) {
            replacedVariables.add(`{@getvar::${trimmedName}@}`);
        }
        return value;
    });

    // 3. 处理 {@setglobalvar::name::value@} - 设置全局变量，替换为空
    result = result.replace(/\{@setglobalvar::([^:@]+)::([\s\S]*?)@\}/g, (match, name, value) => {
        const trimmedName = name.trim();

        setglobalvar(trimmedName, value);
        if (replacedVariables) {
            replacedVariables.add(`{@setglobalvar::${trimmedName}@}`);
        }
        return ''; // 替换为空
    });

    // 4. 处理 {@getglobalvar::name@} - 获取全局变量，替换为值
    result = result.replace(/\{@getglobalvar::([^@]+)@\}/g, (match, name) => {
        const trimmedName = name.trim();
        const value = getglobalvar(trimmedName) || '';

        if (replacedVariables) {
            replacedVariables.add(`{@getglobalvar::${trimmedName}@}`);
        }
        return value;
    });

    // 5. 处理 {@getworldvar::name@} - 获取临时世界书变量（仅当前请求有效）
    // 这个变量由世界书中的 setworldvar 设置，下次请求会清空
    result = result.replace(/\{@getworldvar::([^@]+)@\}/g, (match, name) => {
        const trimmedName = name.trim();
        const value = getworldvar(trimmedName) || '';

        if (replacedVariables) {
            replacedVariables.add(`{@getworldvar::${trimmedName}@}`);
        }
        return value;
    });

    return result;
}

// ==================== 主处理函数 ====================

/**
 * 构建带有触发词过滤和消息合并的 prompt
 * @param {Object} options - 配置选项
 * @param {string} options.requestType - 请求类型
 * @param {Object} options.contextData - 上下文数据
 * @returns {Promise<Array>} 处理后的消息数组
 */
export async function buildPromptWithTrigger(options) {
    const { requestType, contextData } = options;

    // 1. 获取配置
    const configs = extension_settings[extensionName]?.llm_request_type_configs || {};
    const typeConfig = configs[requestType] || { context_profile: '默认' };
    const contextProfileName = typeConfig.context_profile || '默认';
    const apiProfileName = typeConfig.api_profile || '默认';

    const contextProfiles = extension_settings[extensionName]?.test_context_profiles || {};
    const contextProfile = contextProfiles[contextProfileName] || contextProfiles[Object.keys(contextProfiles)[0]] || {};

    // 获取 API profile 中的合并选项
    const llmProfiles = extension_settings[extensionName]?.llm_profiles || {};
    const apiProfile = llmProfiles[apiProfileName] || llmProfiles[Object.keys(llmProfiles)[0]] || {};
    const mergeOptions = { mergeSystemUser: apiProfile.merge_system_user ?? false };

    // 2. 构建触发文本
    const {
        context = '',
        body = '',
        worldBookContent = '',
        userDemand = ''
    } = contextData;

    const triggerText = [userDemand, body].filter(Boolean).join('\n');

    // 3. 过滤条目
    const messages = [];

    if (contextProfile.entries && Array.isArray(contextProfile.entries)) {
        for (const entry of contextProfile.entries) {
            // 跳过禁用的条目
            if (!entry.enabled) continue;
            // 跳过空内容
            if (!entry.content || entry.content.trim() === '') continue;

            // 检查触发模式
            if (entry.triggerMode === 'trigger') {
                // 触发模式：检查触发词
                if (!checkTriggerWords(entry.triggerWords, triggerText)) {
                    continue; // 未触发，跳过
                }
                // 并列触发词检查
                if (entry.andTriggerWords && entry.andTriggerWords.trim() !== '') {
                    if (!checkTriggerWords(entry.andTriggerWords, triggerText)) {
                        continue; // 并列触发未满足，跳过
                    }
                }
            }
            // 'always' 模式或未指定模式：直接包含

            messages.push({
                role: entry.role || 'user',
                content: entry.content
            });
        }
    }
    // 兼容旧格式：history 数组
    else if (contextProfile.history && Array.isArray(contextProfile.history)) {
        for (const h of contextProfile.history) {
            if (h.user && h.user.trim() !== '') {
                messages.push({ role: 'user', content: h.user });
            }
            if (h.assistant && h.assistant.trim() !== '') {
                messages.push({ role: 'assistant', content: h.assistant });
            }
        }
    }

    // 4. 合并相邻相同角色的消息
    const mergedMessages = mergeAdjacentMessages(messages, mergeOptions);

    // 5. 替换占位符（异步）
    const { messages: finalMessages, replacedVariables } = await replaceAllPlaceholders(mergedMessages, contextData);



    return finalMessages;
}

/**
 * 获取处理后的 prompt（供外部调用的简化接口）
 * @param {string} requestType - 请求类型
 * @param {Object} contextData - 上下文数据
 * @returns {Promise<Array>} 处理后的消息数组
 */
export async function getProcessedPrompt(requestType, contextData) {
    return await buildPromptWithTrigger({ requestType, contextData });
}
