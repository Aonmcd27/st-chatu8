// @ts-nocheck
/**
 * worldbookProcessor.js - 世界书处理模块
 * 
 * 处理世界书条目触发和匹配逻辑
 */

import { extensionName } from "./config.js";
import { extension_settings } from "../../../../extensions.js";
import { getrWorlds, getcharWorld, getWorldEntries, getglobalvar, setglobalvar } from "./chatDataUtils.js";
import { getContext } from "../../../../st-context.js";

// ★ 临时变量存储（仅当前请求有效）
// 每次调用 processWorldBooksWithTrigger 时会清空
let worldVars = {};

/**
 * 获取临时世界书变量（供 promptProcessor 使用）
 * @param {string} name - 变量名称
 * @returns {*} 变量值
 */
export function getworldvar(name) {
    return worldVars[name] || '';
}

/**
 * 设置临时世界书变量
 * @param {string} name - 变量名称
 * @param {*} value - 变量值
 */
export function setworldvar(name, value) {
    worldVars[name] = value;
}

/**
 * 清空临时世界书变量（每次请求开始时调用）
 */
export function clearWorldVars() {
    worldVars = {};
}

/**
 * 处理世界书条目触发逻辑
 * @param {Array<string>} contextElements - 触发文本数组
 * @returns {Promise<string>} 所有触发的世界书内容
 */
export async function processWorldBooksWithTrigger(contextElements) {
    const structuredData = await processWorldBooksWithTriggerStructured(contextElements);

    // 转换为字符串格式（保持向后兼容）
    let finalContent = structuredData
        .map(item => {
            const content = item.entries.map(e => e.content).filter(c => c && c.trim()).join('\n\n');
            return `=== ${item.worldName} ===\n${content}`;
        })
        .join('\n\n');

    // ★ 处理变量占位符替换
    finalContent = processVariablePlaceholders(finalContent);

    return finalContent;
}

/**
 * 处理世界书条目触发逻辑（返回结构化数据）
 * @param {Array<string>} contextElements - 触发文本数组
 * @returns {Promise<Array<{worldName: string, entries: Array<{uid: string, comment: string, content: string}>}>>}
 */
export async function processWorldBooksWithTriggerStructured(contextElements) {
    try {
        // ★ 清空临时世界书变量（确保每次请求都是全新的）
        clearWorldVars();

        // 合并所有触发文本
        const triggerText = contextElements.join('\n');

        // 从插件配置读取世界书设置
        const settings = extension_settings[extensionName];
        const worldBookConfig = settings?.worldBookConfig || {};
        const savedWorldBookSelections = worldBookConfig.worldBookSelections || {};
        const worldEntrySettings = worldBookConfig.worldEntrySelections || {};

        // 获取当前角色的世界书名称
        const currentCharWorldName = await getcharWorld();

        // 构建最终的世界书开启状态
        const worldBookSettings = { ...savedWorldBookSelections };
        if (currentCharWorldName) {
            const hasCharWorldEntrySettings =
                worldEntrySettings[currentCharWorldName] &&
                Object.keys(worldEntrySettings[currentCharWorldName]).length > 0;

            if (hasCharWorldEntrySettings || !savedWorldBookSelections.hasOwnProperty(currentCharWorldName)) {
                worldBookSettings[currentCharWorldName] = true;
            }
        }

        // 获取所有世界书
        const worlds = await getrWorlds();

        let allTriggeredData = [];

        // 遍历所有世界书
        for (const worldName of worlds) {
            // 检查世界书是否启用
            if (!worldBookSettings[worldName]) {
                continue;
            }

            // 获取该世界书的条目
            const entries = await getWorldEntries(worldName);
            if (!entries) {
                continue;
            }

            // 转换为数组
            const entriesArray = Array.isArray(entries) ? entries : Object.values(entries);

            // 获取该世界书的条目启用设置
            const currentWorldEntrySettings = worldEntrySettings[worldName] || {};

            // 处理该世界书的所有条目（返回结构化数据）
            const worldData = await processSingleWorldBookStructured(
                entriesArray,
                currentWorldEntrySettings,
                triggerText
            );

            if (worldData && worldData.entries.length > 0) {
                // ★ processSingleWorldBookStructured 现在已经返回了 constant、key 等字段
                // 直接使用返回的数据，不需要再次匹配
                allTriggeredData.push({
                    worldName,
                    entries: worldData.entries
                });
            }
        }

        return allTriggeredData;

    } catch (error) {
        console.error('[processWorldBooksStructured] Error:', error);
        return [];
    }
}

/**
 * 处理变量占位符替换
 * 支持: {{setvar::name::value}}, {{getvar::name}}, {{setglobalvar::name::value}}, {{getglobalvar::name}}
 * value 支持任意符号和换行
 * @param {string} content - 需要处理的内容
 * @returns {string} 处理后的内容
 */
function processVariablePlaceholders(content) {
    if (!content) return content;

    const context = getContext();

    // 确保 chatMetadata.variables 存在
    if (!context.chatMetadata) {
        context.chatMetadata = {};
    }
    if (!context.chatMetadata.variables) {
        context.chatMetadata.variables = {};
    }

    let result = content;

    // 1. 处理 {@setvar::name::value@} - 设置聊天变量，替换为空
    // 使用非贪婪匹配，value 可以包含任意字符（包括换行）
    // 格式: {@setvar::变量名::值@}，值可以包含换行和任意符号
    result = result.replace(/\{@setvar::([^:@]+)::([\s\S]*?)@\}/g, (match, name, value) => {
        const trimmedName = name.trim();

        context.chatMetadata.variables[trimmedName] = value;
        return ''; // 替换为空
    });

    // 2. 处理 {@getvar::name@} - 获取聊天变量，替换为值
    result = result.replace(/\{@getvar::([^@]+)@\}/g, (match, name) => {
        const trimmedName = name.trim();
        const value = context.chatMetadata.variables[trimmedName] || '';

        return value;
    });

    // 3. 处理 {@setglobalvar::name::value@} - 设置全局变量，替换为空
    result = result.replace(/\{@setglobalvar::([^:@]+)::([\s\S]*?)@\}/g, (match, name, value) => {
        const trimmedName = name.trim();

        setglobalvar(trimmedName, value);
        return ''; // 替换为空
    });

    // 4. 处理 {@getglobalvar::name@} - 获取全局变量，替换为值
    result = result.replace(/\{@getglobalvar::([^@]+)@\}/g, (match, name) => {
        const trimmedName = name.trim();
        const value = getglobalvar(trimmedName) || '';

        return value;
    });

    // 5. 处理 {@setworldvar::name::value@} - 设置临时世界书变量，替换为空
    // 这个变量仅在当前请求有效，供 prompt 中的 getworldvar 使用
    result = result.replace(/\{@setworldvar::([^:@]+)::([\s\S]*?)@\}/g, (match, name, value) => {
        const trimmedName = name.trim();

        setworldvar(trimmedName, value);
        return ''; // 替换为空
    });

    // 6. 处理 {@getworldvar::name@} - 获取临时世界书变量（在世界书中也可以使用）
    result = result.replace(/\{@getworldvar::([^@]+)@\}/g, (match, name) => {
        const trimmedName = name.trim();
        const value = getworldvar(trimmedName) || '';

        return value;
    });

    return result;
}

/**
 * 处理单个世界书的所有条目（返回结构化数据）
 * @param {Array} entries - 世界书条目数组
 * @param {Object} entrySettings - 条目启用设置
 * @param {string} triggerText - 触发文本
 * @returns {Promise<{entries: Array<{uid: string, comment: string, content: string}>}>}
 */
export async function processSingleWorldBookStructured(entries, entrySettings, triggerText) {
    // 过滤掉禁用的条目
    const enabledEntries = entries.filter(entry => {
        if (entry.disable) return false;

        const entryKey = entry.uid;
        const setting = entrySettings[entryKey];

        // 如果设置为 'force'，则强制启用
        if (setting === 'force') {
            return true;
        }

        // 只有明确设置为 true 的条目才启用
        return setting === true;
    });

    // 构建强制启用的条目 uid 集合
    const forceEnabledUids = new Set();
    for (const entry of enabledEntries) {
        const setting = entrySettings[entry.uid];
        if (setting === 'force') {
            forceEnabledUids.add(entry.uid);
        }
    }

    // 分离常驻条目和非常驻条目
    const constantEntries = enabledEntries.filter(e => e.constant === true || forceEnabledUids.has(e.uid));
    const nonConstantEntries = enabledEntries.filter(e => e.constant !== true && !forceEnabledUids.has(e.uid));

    // 进一步分离非常驻条目
    const excludeRecursionEntries = nonConstantEntries.filter(e => e.excludeRecursion === true);
    const normalEntries = nonConstantEntries.filter(e => e.excludeRecursion !== true);

    // 处理常驻条目
    const constantNoRecursion = constantEntries.filter(e => e.preventRecursion === true);
    const constantWithRecursion = constantEntries.filter(e => e.preventRecursion !== true);

    let triggeredEntries = [];
    let recursionText = triggerText;

    // 1. 先处理 excludeRecursion 为 true 的条目
    for (const entry of excludeRecursionEntries) {
        if (checkEntryTrigger(entry, triggerText)) {
            triggeredEntries.push(entry);
            if (entry.preventRecursion !== true) {
                recursionText += '\n' + (entry.content || '');
            }
        }
    }

    // 2. 添加常驻且允许递归的条目
    for (const entry of constantWithRecursion) {
        triggeredEntries.push(entry);
        recursionText += '\n' + (entry.content || '');
    }

    // 3. 递归处理普通非常驻条目
    const recursiveTriggered = await processEntriesRecursively(
        normalEntries,
        recursionText
    );
    triggeredEntries.push(...recursiveTriggered);

    // 4. 最后添加不参与递归的常驻条目
    triggeredEntries.push(...constantNoRecursion);

    // 按 order 字段排序
    triggeredEntries.sort((a, b) => {
        const orderA = a.order ?? Infinity;
        const orderB = b.order ?? Infinity;
        return orderA - orderB;
    });

    // 返回结构化数据
    const result = {
        entries: triggeredEntries.map(entry => ({
            uid: entry.uid !== undefined && entry.uid !== null ? entry.uid : '',
            comment: entry.comment || '未命名条目',
            content: entry.content || '',
            // ★ 新增：保留原始条目的其他重要字段
            // 注意：使用 ?? 而不是 || 来避免 false 被转换为默认值
            constant: entry.constant ?? false,
            key: entry.key ?? [],
            selectiveLogic: entry.selectiveLogic ?? 0,
            order: entry.order,
            disable: entry.disable
        }))
    };

    // 调试：输出返回的条目数量
    console.log(`[processSingleWorldBookStructured] 返回 ${result.entries.length} 个条目`);

    return result;
}

/**
 * 处理单个世界书的所有条目
 * @param {Array} entries - 世界书条目数组
 * @param {Object} entrySettings - 条目启用设置
 * @param {string} triggerText - 触发文本
 * @returns {Promise<string>} 触发的内容
 */
export async function processSingleWorldBook(entries, entrySettings, triggerText) {
    const structuredData = await processSingleWorldBookStructured(entries, entrySettings, triggerText);

    // 提取内容并拼接
    const content = structuredData.entries
        .map(entry => entry.content)
        .filter(c => c.trim())
        .join('\n\n');

    return content;
}

/**
 * 递归处理条目（只处理可以被递归内容触发的条目）
 * @param {Array} entries - 条目数组（excludeRecursion 为 false 的条目）
 * @param {string} recursionText - 递归文本（包含常驻条目和已触发条目的内容）
 * @returns {Promise<Array>} 触发的条目数组
 */
async function processEntriesRecursively(entries, recursionText) {
    let triggered = [];
    let currentRecursionText = recursionText;
    let hasNewTrigger = true;

    // 已触发的条目 UID 集合，防止重复触发
    const triggeredUids = new Set();

    while (hasNewTrigger) {
        hasNewTrigger = false;

        for (const entry of entries) {
            const uid = entry.uid;

            // 跳过已触发的条目
            if (triggeredUids.has(uid)) continue;

            // 检查是否触发（使用当前的递归文本）
            if (checkEntryTrigger(entry, currentRecursionText)) {
                triggered.push(entry);
                triggeredUids.add(uid);
                hasNewTrigger = true;

                // 如果该条目不阻止递归，将其内容加入递归文本
                if (entry.preventRecursion !== true) {
                    currentRecursionText += '\n' + (entry.content || '');
                }
            }
        }
    }

    return triggered;
}

/**
 * 检查条目是否被触发
 * @param {Object} entry - 世界书条目
 * @param {string} text - 触发文本
 * @returns {boolean} 是否触发
 */
function checkEntryTrigger(entry, text) {
    // 如果没有开启筛选，只检查主关键词
    if (!entry.selective) {
        return checkKeywords(entry.key, text, entry.caseSensitive, entry.matchWholeWords);
    }

    // 开启了筛选，需要根据 selectiveLogic 判断
    const hasMainKey = checkKeywords(entry.key, text, entry.caseSensitive, entry.matchWholeWords);

    // 主关键词都不匹配，直接返回 false
    if (!hasMainKey) return false;

    const keysecondary = entry.keysecondary || [];
    if (keysecondary.length === 0) return hasMainKey;

    const selectiveLogic = entry.selectiveLogic || 0;

    switch (selectiveLogic) {
        case 0: // AND Any - 主关键词 + 至少一个次级关键词
            return checkKeywords(keysecondary, text, entry.caseSensitive, entry.matchWholeWords, 'any');

        case 1: // AND All - 主关键词 + 所有次级关键词
            return checkKeywords(keysecondary, text, entry.caseSensitive, entry.matchWholeWords, 'all');

        case 2: // NOT - 主关键词 + 不能有任何次级关键词
            return !checkKeywords(keysecondary, text, entry.caseSensitive, entry.matchWholeWords, 'any');

        default:
            return hasMainKey;
    }
}

/**
 * 检查关键词是否在文本中
 * @param {Array|string} keywords - 关键词数组或单个关键词
 * @param {string} text - 文本
 * @param {boolean} caseSensitive - 是否区分大小写
 * @param {boolean} matchWholeWords - 是否全词匹配
 * @param {string} mode - 匹配模式: 'any'(任意), 'all'(全部), 默认为 'any'
 * @returns {boolean}
 */
function checkKeywords(keywords, text, caseSensitive, matchWholeWords, mode = 'any') {
    if (!keywords || keywords.length === 0) return false;

    const keywordArray = Array.isArray(keywords) ? keywords : [keywords];
    const searchText = caseSensitive ? text : text.toLowerCase();

    const matches = keywordArray.map(keyword => {
        if (!keyword) return false;

        const searchKeyword = caseSensitive ? keyword : keyword.toLowerCase();

        if (matchWholeWords) {
            // 全词匹配：使用正则表达式
            const regex = new RegExp(`\\b${escapeRegex(searchKeyword)}\\b`, caseSensitive ? '' : 'i');
            return regex.test(text);
        } else {
            // 普通匹配
            return searchText.includes(searchKeyword);
        }
    });

    if (mode === 'all') {
        return matches.every(m => m);
    } else {
        return matches.some(m => m);
    }
}

/**
 * 转义正则表达式特殊字符
 * @param {string} string - 字符串
 * @returns {string}
 */
function escapeRegex(string) {
    return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
