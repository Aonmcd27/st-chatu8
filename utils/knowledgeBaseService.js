// @ts-nocheck
/**
 * knowledgeBaseService.js - 资料库核心服务（新版）
 *
 * 新版架构：
 * - 不再使用自建资料库（configDatabase），改为直接引用 SillyTavern 世界书
 * - 配置存储在独立字段 extension_settings[extensionName].knowledgeBaseConfig
 *   （与 send_data 使用的 worldBookConfig 完全隔离）
 *
 * 职责：
 * - 读写 knowledgeBaseConfig（全局开关、世界书启用状态、条目启用状态）
 * - 自动触发注入：扫描已启用的世界书，用 lastUserText 做关键词触发，返回匹配内容
 * - AI 搜索接口：listOnDemandKnowledgeBases、readKnowledgeBase、searchKnowledge 等
 */

import { extension_settings } from "../../../../extensions.js";
import { saveSettingsDebounced } from "../../../../../script.js";
import { extensionName } from './config.js';
import { getWorldEntries } from './chatDataUtils.js';
import { world_info } from "../../../../world-info.js";

// ---------- 内部工具 ----------

/**
 * 强制刷新世界书缓存
 * @param {string} worldName 世界书名称
 */
async function refreshWorldBookCache(worldName) {
    try {
        // 方法1: 如果 world_info 有 loadWorldInfoData 方法，直接调用
        if (world_info && typeof world_info.loadWorldInfoData === 'function') {
            await world_info.loadWorldInfoData(worldName);
            console.log(`[KnowledgeBase] 已刷新世界书缓存: ${worldName}`);
            return;
        }

        // 方法2: 通过 getContext().loadWorldInfo 强制重新加载
        // 注意：这个方法可能有内部缓存，但多次调用应该会触发刷新
        const { getContext } = await import("../../../../st-context.js");
        await getContext().loadWorldInfo(worldName);
        console.log(`[KnowledgeBase] 已通过 loadWorldInfo 刷新: ${worldName}`);
    } catch (err) {
        console.warn(`[KnowledgeBase] 刷新世界书缓存失败 ${worldName}:`, err);
    }
}

/**
 * 获取资料库专属配置（自动初始化）
 * @returns {Object} knowledgeBaseConfig
 */
function getKnowledgeBaseConfig() {
    const settings = extension_settings[extensionName];
    if (!settings.knowledgeBaseConfig) {
        settings.knowledgeBaseConfig = {
            enabled: false,
            worldBookSelections: {},
            worldEntrySelections: {}
        };
    }
    return settings.knowledgeBaseConfig;
}

// ---------- 全局开关 ----------

/**
 * 手动刷新所有已启用世界书的缓存
 * @returns {Promise<void>}
 */
export async function refreshAllKnowledgeBaseCaches() {
    const config = getKnowledgeBaseConfig();
    const enabledWorlds = Object.entries(config.worldBookSelections || {})
        .filter(([, enabled]) => enabled)
        .map(([name]) => name);

    console.log(`[KnowledgeBase] 开始刷新 ${enabledWorlds.length} 个世界书缓存...`);

    for (const worldName of enabledWorlds) {
        await refreshWorldBookCache(worldName);
    }

    console.log('[KnowledgeBase] 所有世界书缓存刷新完成');
}

/**
 * 获取资料库是否启用
 * @returns {boolean}
 */
export function isKnowledgeBaseEnabled() {
    return !!getKnowledgeBaseConfig().enabled;
}

/**
 * 设置资料库启用状态
 * @param {boolean} enabled
 */
export function setKnowledgeBaseEnabled(enabled) {
    getKnowledgeBaseConfig().enabled = enabled;
    saveSettingsDebounced();
}

// ---------- 自动触发注入（核心）----------

/**
 * 用触发文本扫描资料库中已启用的世界书条目，返回匹配内容字符串。
 * 供 assistantLLM.js 替换 {knowledgeBase} / {{知识库}} 占位符使用。
 *
 * @param {string} [lastUserText=''] 用户最后一条消息的文本（触发关键词的来源）
 * @returns {Promise<string>}
 */
export async function buildKnowledgeBasePromptContent(lastUserText = '') {
    const config = getKnowledgeBaseConfig();
    if (!config.enabled) return '';

    const { worldBookSelections, worldEntrySelections } = config;

    // 找出已启用的世界书
    const enabledWorlds = Object.entries(worldBookSelections)
        .filter(([, enabled]) => enabled)
        .map(([name]) => name);

    if (enabledWorlds.length === 0) return '';

    const results = [];

    for (const worldName of enabledWorlds) {
        const entrySettings = worldEntrySelections[worldName] || {};
        let entries;
        try {
            // ★ 强制刷新世界书缓存
            await refreshWorldBookCache(worldName);

            const raw = await getWorldEntries(worldName);
            if (!raw) continue;
            entries = Array.isArray(raw) ? raw : Object.values(raw);
        } catch (err) {
            console.warn(`[KnowledgeBase] 读取世界书 ${worldName} 失败:`, err);
            continue;
        }

        // ── 跳过常开：启用时将纯常开条目（非 force）临时标为非常驻，让它们走关键词触发 ──
        const skipConstant = config.skipConstant !== false;
        let processEntries = entries;
        if (skipConstant) {
            processEntries = entries.map(e => {
                const setting = entrySettings[e.uid];
                // 常开 且 非强制启用 → 临时把 constant 置为 false，需关键词命中才生效
                if (e.constant === true && setting !== 'force') {
                    return { ...e, constant: false };
                }
                return e;
            });
        }

        // 用 processSingleWorldBook 做关键词触发
        const { processSingleWorldBook } = await import('./worldbookProcessor.js');
        const worldContent = await processSingleWorldBook(processEntries, entrySettings, lastUserText);

        if (worldContent && worldContent.trim()) {
            results.push(`=== ${worldName} ===\n${worldContent}`);
        }
    }

    if (results.length === 0) return '';
    return `【资料库参考】\n${results.join('\n\n')}`;
}

// ---------- AI 搜索接口 ----------

/**
 * 列出资料库中已启用的世界书和条目摘要（供 AI 知道可以检索哪些内容）
 * @returns {Promise<string>}
 */
export async function listOnDemandKnowledgeBases() {
    const config = getKnowledgeBaseConfig();
    if (!config.enabled) return '资料库功能未启用。';

    const { worldBookSelections, worldEntrySelections } = config;
    const enabledWorlds = Object.entries(worldBookSelections)
        .filter(([, enabled]) => enabled)
        .map(([name]) => name);

    if (enabledWorlds.length === 0) return '资料库中没有启用任何世界书。';

    const parts = [];
    for (const worldName of enabledWorlds) {
        const entrySettings = worldEntrySelections[worldName] || {};
        let entries = [];
        try {
            // ★ 强制刷新世界书缓存
            await refreshWorldBookCache(worldName);

            const raw = await getWorldEntries(worldName);
            if (raw) {
                entries = Array.isArray(raw) ? raw : Object.values(raw);
            }
        } catch (err) {
            // 忽略读取失败的世界书
        }

        // 只列出已勾选的条目
        const enabledEntries = entries.filter(e => {
            const state = entrySettings[e.uid];
            return state === true || state === 'force';
        });

        let section = `📚 ${worldName}（${enabledEntries.length} 个已启用条目）`;
        if (enabledEntries.length > 0) {
            section += '\n   条目列表:';
            enabledEntries.forEach(e => {
                const label = e.comment || `条目 ${e.uid}`;
                const preview = (e.content || '').replace(/\n/g, ' ').substring(0, 60);
                section += `\n     - ${label} [uid: ${e.uid}]${preview ? ' — ' + preview + (e.content?.length > 60 ? '...' : '') : ''}`;
            });
        }
        parts.push(section);
    }

    return parts.join('\n\n') + '\n\n💡 使用 read_knowledge 读取整个世界书，或 search_knowledge 搜索关键词';
}

/**
 * 读取指定世界书中所有已启用条目的完整内容
 * @param {string} worldName 世界书名称
 * @returns {Promise<string>}
 */
export async function readKnowledgeBase(worldName) {
    const config = getKnowledgeBaseConfig();
    if (!config.worldBookSelections[worldName]) {
        return `世界书「${worldName}」在资料库中未启用或不存在。`;
    }

    const entrySettings = config.worldEntrySelections[worldName] || {};
    let entries = [];
    try {
        // ★ 强制刷新世界书缓存
        await refreshWorldBookCache(worldName);

        const raw = await getWorldEntries(worldName);
        if (raw) entries = Array.isArray(raw) ? raw : Object.values(raw);
    } catch (err) {
        return `读取世界书「${worldName}」失败：${err.message}`;
    }

    const enabledEntries = entries.filter(e => {
        const state = entrySettings[e.uid];
        return state === true || state === 'force';
    });

    if (enabledEntries.length === 0) return `世界书「${worldName}」中没有已启用的条目。`;

    let content = `## ${worldName}\n`;
    enabledEntries.forEach(e => {
        const label = e.comment || `条目 ${e.uid}`;
        content += `\n### ${label}\n${e.content || ''}\n`;
    });
    return content;
}

/**
 * 读取某世界书中指定 uid 条目的完整内容
 * @param {string} worldName 世界书名称
 * @param {string|number} entryUid 条目 uid
 * @returns {Promise<string>}
 */
export async function readKnowledgeEntry(worldName, entryUid) {
    const config = getKnowledgeBaseConfig();
    let entries = [];
    try {
        // ★ 强制刷新世界书缓存
        await refreshWorldBookCache(worldName);

        const raw = await getWorldEntries(worldName);
        if (raw) entries = Array.isArray(raw) ? raw : Object.values(raw);
    } catch (err) {
        return `读取世界书「${worldName}」失败：${err.message}`;
    }

    const uid = typeof entryUid === 'string' ? parseInt(entryUid, 10) : entryUid;
    const entry = entries.find(e => e.uid === uid || e.uid === entryUid);
    if (!entry) return `条目 uid=${entryUid} 在世界书「${worldName}」中不存在。`;

    const label = entry.comment || `条目 ${entry.uid}`;
    return `📚 世界书: ${worldName}\n\n📄 条目: ${label}\n\n${entry.content || '（无内容）'}`;
}

/**
 * 在资料库已启用的世界书范围内关键词搜索
 * @param {string} keyword 搜索关键词
 * @returns {Promise<string>}
 */
export async function searchKnowledge(keyword) {
    const config = getKnowledgeBaseConfig();
    if (!config.enabled) return '资料库功能未启用。';

    const { worldBookSelections, worldEntrySelections } = config;
    const enabledWorlds = Object.entries(worldBookSelections)
        .filter(([, enabled]) => enabled)
        .map(([name]) => name);

    if (enabledWorlds.length === 0) return '资料库中没有启用任何世界书。';

    const results = [];
    const kw = keyword.toLowerCase();

    for (const worldName of enabledWorlds) {
        const entrySettings = worldEntrySelections[worldName] || {};
        let entries = [];
        try {
            // ★ 强制刷新世界书缓存
            await refreshWorldBookCache(worldName);

            const raw = await getWorldEntries(worldName);
            if (raw) entries = Array.isArray(raw) ? raw : Object.values(raw);
        } catch (err) {
            continue;
        }

        // 只在已启用的条目中搜索
        const enabledEntries = entries.filter(e => {
            const state = entrySettings[e.uid];
            return state === true || state === 'force';
        });

        const matched = enabledEntries.filter(e => {
            const label = (e.comment || '').toLowerCase();
            const keys = (Array.isArray(e.key) ? e.key.join(' ') : String(e.key || '')).toLowerCase();
            const content = (e.content || '').toLowerCase();
            return label.includes(kw) || keys.includes(kw) || content.includes(kw);
        });

        if (matched.length > 0) {
            results.push(`\n📚 世界书: ${worldName}`);
            matched.forEach(e => {
                const label = e.comment || `条目 ${e.uid}`;
                // 清理内容：移除多余空白，保留基本可读性
                let preview = (e.content || '')
                    .replace(/\s+/g, ' ')  // 多个空白字符合并为一个空格
                    .trim()
                    .substring(0, 100);

                // 如果有关键词信息，也显示出来
                const keys = Array.isArray(e.key) ? e.key.join(', ') : String(e.key || '');
                const keyInfo = keys ? `\n      关键词: ${keys}` : '';

                results.push(`   📄 ${label} [uid: ${e.uid}]${keyInfo}\n      预览: ${preview}${(e.content?.length || 0) > 100 ? '...' : ''}`);
            });
        }
    }

    if (results.length === 0) return `未找到包含「${keyword}」的资料。`;
    return `搜索关键词「${keyword}」的结果：\n${results.join('\n')}\n\n💡 使用 read_entry 可查看条目完整内容`;
}

// ---------- 测试触发接口 ----------

/**
 * 测试资料库触发功能（返回结构化数据供 UI 展示）
 * @param {string} triggerText 触发文本
 * @returns {Promise<Array>} 返回触发的世界书和条目数据
 */
export async function testKnowledgeBaseTrigger(triggerText = '') {
    const config = getKnowledgeBaseConfig();
    if (!config.enabled) {
        throw new Error('资料库功能未启用');
    }

    const { worldBookSelections, worldEntrySelections } = config;
    const enabledWorlds = Object.entries(worldBookSelections)
        .filter(([, enabled]) => enabled)
        .map(([name]) => name);

    if (enabledWorlds.length === 0) {
        return [];
    }

    const results = [];

    for (const worldName of enabledWorlds) {
        const entrySettings = worldEntrySelections[worldName] || {};
        let entries;
        try {
            // ★ 强制刷新世界书缓存
            await refreshWorldBookCache(worldName);

            const raw = await getWorldEntries(worldName);
            if (!raw) continue;
            entries = Array.isArray(raw) ? raw : Object.values(raw);
        } catch (err) {
            console.warn(`[KnowledgeBase] 测试触发时读取世界书 ${worldName} 失败:`, err);
            continue;
        }

        // ── 跳过常开：启用时将纯常开条目（非 force）临时标为非常驻，让它们走关键词触发 ──
        const skipConstant = config.skipConstant !== false;
        let processEntries = entries;
        if (skipConstant) {
            processEntries = entries.map(e => {
                const setting = entrySettings[e.uid];
                // 常开 且 非强制启用 → 临时把 constant 置为 false，需关键词命中才生效
                if (e.constant === true && setting !== 'force') {
                    return { ...e, constant: false };
                }
                return e;
            });
        }

        // 用 processSingleWorldBookStructured 做关键词触发（返回结构化数据）
        const { processSingleWorldBookStructured } = await import('./worldbookProcessor.js');
        const triggeredData = await processSingleWorldBookStructured(processEntries, entrySettings, triggerText);

        if (triggeredData && triggeredData.entries && triggeredData.entries.length > 0) {
            // ★ processSingleWorldBookStructured 现在已经返回了 constant、key 等字段
            // 直接使用返回的数据，不需要再次匹配
            results.push({
                worldName,
                entries: triggeredData.entries
            });
        }
    }

    return results;
}
