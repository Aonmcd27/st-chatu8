// @ts-nocheck
import { extension_settings } from "../../../../extensions.js";
import { saveSettingsDebounced, eventSource } from "../../../../../script.js";
import { extensionName, eventNames } from './config.js';
import { addLog } from './utils.js';
import { updateCombinedPrompt } from './settings/llm.js';
import { buildPromptForRequestType, getMergeOptionsForRequestType } from './settings/llmService.js';
import { mergeAdjacentMessages } from './promptProcessor.js';
let settings;

/**
 * SD 提示词符号匹配正则
 * 匹配前后的括号/花括号/方括号/尖括号，以及末尾的权重数字（如 :0.8）
 */
const SD_SYMBOL_PATTERN = /^([\(\[\{<]+)?(.*?)([\)\]\}>]+)?(:[\d.]+)?$/;

/**
 * 需要跳过翻译的特殊 tag 模式
 * - LoRA 调用: <lora:xxx:0.8>
 * - 纯数字/权重
 * - 空字符串
 */
const SKIP_PATTERNS = [
    /^<lora:/i,           // LoRA
    /^<lyco:/i,           // LyCORIS
    /^<hypernet:/i,       // Hypernetwork
    /^[\d.:]+$/,          // 纯数字/权重
    /^$/,                 // 空字符串
    /^\$.*\$$/            // $...$ 角色/服装预设标记
];

/**
 * 检查 tag 是否应该跳过翻译
 * @param {string} tag - 清理后的 tag
 * @returns {boolean}
 */
function shouldSkipTranslation(tag) {
    return SKIP_PATTERNS.some(pattern => pattern.test(tag.trim()));
}

/**
 * 将标签数组转换为 JSON 字符串格式
 * 统一的翻译输入格式，便于 AI 精确识别每个标签
 * @param {string[]} tags - 标签数组
 * @returns {string} JSON 字符串格式的标签数组
 */
export function tagsToJsonString(tags) {
    if (!Array.isArray(tags)) return '[]';
    return JSON.stringify(tags.filter(t => t && typeof t === 'string'));
}

/**
 * 预处理 SD 提示词用于翻译
 * 将提示词分割、去除符号，准备用于翻译
 * @param {string} promptText - 原始提示词文本
 * @returns {Object} { originalTags, cleanedTags, cleanedText, tagMap }
 */
export function preprocessPromptForTranslation(promptText) {
    if (!promptText || typeof promptText !== 'string') {
        return {
            originalTags: [],
            cleanedTags: [],
            cleanedText: '',
            tagMap: new Map()
        };
    }
    // 智能分割函数，保护 $...$ 包裹的标记不被拆分
    const smartSplit = (text) => {
        const result = [];
        let current = '';
        let insideDollar = false;
        for (let i = 0; i < text.length; i++) {
            const char = text[i];
            if (char === '$') {
                insideDollar = !insideDollar;
                current += char;
            } else if ((char === ',' || char === '，') && !insideDollar) {
                const trimmed = current.trim();
                if (trimmed) result.push(trimmed);
                current = '';
            } else {
                current += char;
            }
        }
        if (current.trim()) result.push(current.trim());
        return result;
    };

    // 使用智能分割（保护 $...$ 标记）
    const rawTags = smartSplit(promptText);

    const originalTags = [];
    const cleanedTags = [];
    const tagMap = new Map(); // cleaned -> original info 的映射

    for (const tag of rawTags) {
        const match = tag.match(SD_SYMBOL_PATTERN);

        if (match) {
            const prefix = match[1] || '';
            const content = (match[2] || '').trim();
            const suffix = match[3] || '';
            const weight = match[4] || '';

            const tagInfo = {
                original: tag,
                cleaned: content,
                prefix: prefix,
                suffix: suffix,
                weight: weight,
                skip: shouldSkipTranslation(tag) || shouldSkipTranslation(content)
            };

            originalTags.push(tagInfo);

            // 只有不跳过的 tag 才加入翻译列表
            if (!tagInfo.skip && content) {
                cleanedTags.push(content);
                tagMap.set(content.toLowerCase(), tagInfo);
            }
        } else {
            // 无法匹配的保持原样
            const tagInfo = {
                original: tag,
                cleaned: tag,
                prefix: '',
                suffix: '',
                weight: '',
                skip: shouldSkipTranslation(tag)
            };
            originalTags.push(tagInfo);

            if (!tagInfo.skip && tag) {
                cleanedTags.push(tag);
                tagMap.set(tag.toLowerCase(), tagInfo);
            }
        }
    }

    return {
        originalTags,               // 完整的标签信息数组
        cleanedTags,                // 清理后用于翻译的标签数组
        cleanedText: tagsToJsonString(cleanedTags),  // 翻译用的 JSON 数组字符串
        tagMap                      // 用于快速查找的映射
    };
}

/**
 * 组合翻译结果与原始标签
 * @param {Array} originalTags - preprocessPromptForTranslation 返回的 originalTags
 * @param {Object} translationMap - 翻译结果映射 {英文: 中文}
 * @returns {Array} [{original, translation, cleaned}, ...]
 */
export function combineTranslationResult(originalTags, translationMap) {
    if (!originalTags || !Array.isArray(originalTags)) {
        return [];
    }

    // 创建大小写不敏感的翻译映射
    const lowerCaseMap = {};
    if (translationMap && typeof translationMap === 'object') {
        for (const [key, value] of Object.entries(translationMap)) {
            lowerCaseMap[key.toLowerCase()] = value;
        }
    }

    return originalTags.map(tagInfo => {
        const { original, cleaned, skip } = tagInfo;

        // 跳过的 tag 不翻译
        if (skip) {
            return {
                original: original,
                translation: '',
                cleaned: cleaned,
                skipped: true
            };
        }

        // 查找翻译（大小写不敏感）
        const translation = lowerCaseMap[cleaned.toLowerCase()] || '';

        return {
            original: original,           // 带符号的原始 tag，如 "((1girl))"
            translation: translation,     // 翻译结果，如 "一个女孩"
            cleaned: cleaned,             // 清理后的 tag，如 "1girl"
            skipped: false
        };
    });
}

/**
 * 格式化翻译结果为显示字符串
 * @param {Array} combinedResults - combineTranslationResult 的返回值
 * @param {Object} options - 格式化选项
 * @param {string} options.separator - 分隔符，默认 ", "
 * @param {boolean} options.showOriginal - 是否显示原始 tag，默认 true
 * @param {boolean} options.showTranslation - 是否显示翻译，默认 true
 * @returns {string} 格式化后的字符串
 */
export function formatTranslationDisplay(combinedResults, options = {}) {
    const {
        separator = ', ',
        showOriginal = true,
        showTranslation = true
    } = options;

    if (!combinedResults || !Array.isArray(combinedResults)) {
        return '';
    }

    return combinedResults
        .map(item => {
            if (item.skipped) {
                return showOriginal ? item.original : '';
            }

            const parts = [];
            if (showOriginal) parts.push(item.original);
            if (showTranslation && item.translation) {
                parts.push(`(${item.translation})`);
            }
            return parts.join(' ');
        })
        .filter(Boolean)
        .join(separator);
}

/**
 * 翻译 SD 提示词标签（便捷函数）
 * 整合预处理、翻译、后处理的完整流程
 * @param {string} promptText - 原始提示词文本，如 "((1girl)), masterpiece, {best quality}"
 * @returns {Promise<Object>} 返回 { results, displayText, originalTags }
 *   - results: 翻译结果数组 [{original, translation, cleaned, skipped}, ...]
 *   - displayText: 格式化后的显示文本
 *   - originalTags: 原始标签信息数组
 */
export async function translatePromptTags(promptText) {
    // 1. 预处理：分割并去除符号
    const { originalTags, cleanedText } = preprocessPromptForTranslation(promptText);

    if (!cleanedText) {
        return {
            results: [],
            displayText: '',
            originalTags: []
        };
    }

    try {
        // 2. 调用翻译
        const translationResult = await callTranslation(cleanedText);

        // 3. 解析翻译结果
        const translationMap = parseTranslationResult(translationResult);

        // 4. 组合结果
        const results = combineTranslationResult(originalTags, translationMap);

        // 5. 格式化显示
        const displayText = formatTranslationDisplay(results);

        return {
            results,
            displayText,
            originalTags
        };
    } catch (error) {
        console.error('st-chatu8: 翻译提示词标签失败:', error);
        throw error;
    }
}

/**
 * 解析翻译结果，支持 JSON 格式和旧格式（向后兼容）
 * @param {string} text - LLM 返回的翻译结果
 * @returns {Object} 英文到中文的映射对象 {"english": "中文", ...}
 */
export function parseTranslationResult(text) {
    if (!text) return {};

    // 尝试 JSON 格式解析
    try {
        const jsonMatch = text.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
            const parsed = JSON.parse(jsonMatch[0]);
            if (typeof parsed === 'object' && parsed !== null) {
                return parsed;
            }
        }
    } catch (e) {
        console.warn('st-chatu8: JSON解析失败，尝试旧格式:', e.message);
    }

    // 向后兼容：旧格式 "英文\\中文, 英文\\中文"
    const cleaned = String(text)
        .replace(/[\r\n]+/g, ' ')
        .replace(/^[\s"'`]+|[\s"'`]+$/g, '')
        .trim();
    const pairs = cleaned.split(/[,，]/).map(s => s.trim()).filter(Boolean);
    const map = {};
    for (const p of pairs) {
        const idx = p.indexOf('\\');
        if (idx > 0) {
            const en = p.slice(0, idx).trim();
            const zh = p.slice(idx + 1).trim();
            if (en) map[en] = zh;
        }
    }
    return map;
}

/**
 * Generates a unique ID for request tracking.
 * @returns {string}
 */
function generateRequestId() {
    if (crypto && crypto.randomUUID) {
        return crypto.randomUUID();
    }
    return Date.now().toString(36) + Math.random().toString(36).substring(2);
}

/**
 * 获取翻译的上下文预设提示词
 * @returns {Promise<Array>} 消息数组
 */
export function LLM_TRANSLATION_GET_PROMPT() {
    return new Promise((resolve, reject) => {
        const promptRequestId = generateRequestId();
        console.log(`st-chatu8: 请求获取翻译提示词 (ID: ${promptRequestId})`);

        const handler = (promptData) => {
            if (promptData.id !== promptRequestId) return;

            eventSource.removeListener(eventNames.LLM_TRANSLATION_GET_PROMPT_RESPONSE, handler);

            const { prompt } = promptData;
            console.log(`st-chatu8: 已获取翻译提示词 (ID: ${promptRequestId}):`, prompt);

            resolve(prompt);
        };

        eventSource.on(eventNames.LLM_TRANSLATION_GET_PROMPT_RESPONSE, handler);
        eventSource.emit(eventNames.LLM_TRANSLATION_GET_PROMPT_REQUEST, { id: promptRequestId });

        setTimeout(() => {
            eventSource.removeListener(eventNames.LLM_TRANSLATION_GET_PROMPT_RESPONSE, handler);
            reject(new Error("获取翻译提示词超时"));
        }, 10000);
    });
}

/**
 * 执行翻译 LLM 请求
 * @param {Array} prompt - 提示词数组
 * @param {Object} options - 选项
 * @param {number} options.timeoutMs - 超时时间（毫秒）
 * @returns {Promise<string>} LLM 响应结果
 */
export function LLM_TRANSLATION(prompt, { timeoutMs = 60000 } = {}) {
    return new Promise((resolve, reject) => {
        const executeRequestId = generateRequestId();
        console.log(`st-chatu8: 请求翻译 LLM (ID: ${executeRequestId})`);

        let timeoutTimer = null;

        const cleanup = () => {
            eventSource.removeListener(eventNames.LLM_TRANSLATION_RESPONSE, executeResponseHandler);
            if (timeoutTimer) clearTimeout(timeoutTimer);
        };

        const executeResponseHandler = (executeData) => {
            if (executeData.id !== executeRequestId) return;

            cleanup();

            console.log(`st-chatu8: 已收到翻译 LLM 执行结果 (ID: ${executeRequestId}):`, executeData);

            if (executeData.success) {
                resolve(executeData.result);
            } else {
                if (executeData.error && executeData.error.name === 'AbortError') {
                    const err = new Error(executeData.error.message);
                    err.name = 'AbortError';
                    reject(err);
                } else {
                    reject(new Error(executeData.result));
                }
            }
        };

        eventSource.on(eventNames.LLM_TRANSLATION_RESPONSE, executeResponseHandler);
        eventSource.emit(eventNames.LLM_TRANSLATION_REQUEST, { prompt, id: executeRequestId });

        timeoutTimer = setTimeout(() => {
            cleanup();
            reject(new Error(`翻译 LLM 执行超时（${timeoutMs}ms）`));
        }, timeoutMs);
    });
}

/**
 * 调用翻译功能
 * 使用 LLM 设置页面配置的翻译预设进行翻译
 * @param {string} inputText - 要翻译的文本
 * @returns {Promise<string>} 翻译结果
 */
export async function callTranslation(inputText) {
    try {
        // 先获取翻译的上下文预设（系统提示词），使用输入文本作为触发文本
        let basePrompt = buildPromptForRequestType('translation', inputText || '');

        if (!basePrompt || basePrompt.length === 0) {
            throw new Error('未能获取到提示词，请检查 LLM 设置中"翻译"的上下文预设配置');
        }

        // ★ 合并相邻相同角色的消息
        basePrompt = mergeAdjacentMessages(basePrompt, getMergeOptionsForRequestType('translation'));

        // 将用户输入追加到 prompt
        const fullPrompt = [...basePrompt, { role: 'user', content: inputText || '' }];

        updateCombinedPrompt(fullPrompt);
        // 执行翻译请求
        const result = await LLM_TRANSLATION(fullPrompt);
        return result;
    } catch (error) {
        addLog(`翻译失败: ${error.message}`);
        console.error('翻译失败:', error);
        throw error;
    }
}

// 用于跟踪是否已经初始化
let isAiInitialized = false;

export function initAiSettings(container) {
    // AI 设置现在已经统一到 LLM 设置页面
    // 此函数仅保持兼容性，不再需要初始化任何 UI 组件

    if (!isAiInitialized) {
        console.log('st-chatu8: AI 设置已统一到 LLM 设置页面');
        isAiInitialized = true;
    }
}
