// @ts-nocheck
/**
 * assistantSummary.js - 聊天总结模块
 *
 * 职责：
 * 1. SummaryManager 类：消息分组、总结数据管理、父子冲突处理
 * 2. generateSummary()：调用 LLM 生成总结文本
 * 3. buildSummaryContextBlock()：构建注入上下文的总结块
 */

import { extension_settings } from '../../../../../extensions.js';
import { extensionName, LLMRequestTypes } from '../config.js';
import { getEffectiveConfigForRequestType, executeDefaultLLMRequest } from '../settings/llmService.js';
import { updateCombinedPrompt, getResultTextareaUpdater } from '../settings/llmUi.js';
import { substituteTemplateVariables, buildCustomPrefillMessages } from './assistantLLM.js';
import { dom, activeChat, setActiveChat } from './assistantContext.js';
import { syncAndSave } from './assistantSession.js';
import { isMobileDevice, countTokens } from '../utils.js';

// ═══════════════════════════════════════════════════════════
//  常量
// ═══════════════════════════════════════════════════════════

/** 每一组最多的对话轮数 */
const ROUNDS_PER_GROUP = 10;

/** LLM上下文保底最少发送的轮数（始终发送最近N轮） */
const MIN_KEEP_ROUNDS = 15;

/** Token 统计使用的默认模型 */
const TOKEN_COUNT_MODEL = 'gemini-2.5-pro';

// ═══════════════════════════════════════════════════════════
//  工具函数
// ═══════════════════════════════════════════════════════════

/**
 * 从消息 content 中提取纯文本（去除 think 块）
 * @param {string|Array} content
 * @returns {string}
 */
function extractCleanText(content) {
    let text = '';
    if (typeof content === 'string') {
        text = content;
    } else if (Array.isArray(content)) {
        const part = content.find(c => c.type === 'text');
        text = part?.text || '';
    }
    // 去除思维链
    return text.replace(/^[\s\S]*<\/think(?:ing)?>\s*/g, '').trim();
}

/**
 * 去除 think 块（用于辅助内容提取）
 * @param {string} text
 * @returns {string}
 */
function stripThink(text) {
    if (typeof text !== 'string') return '';
    // 去除 <think>...</think> 块（包括 prefill 的开头 <think>）
    let result = text.replace(/<think(?:ing)?>([\s\S]*?)<\/think(?:ing)?>/g, '').trim();
    // 如果整段以 <think 开头但没有闭合标签，说明模型没输出 </think>，尝试贪婪去除
    if (result.match(/^<think(?:ing)?>/)) {
        result = result.replace(/^<think(?:ing)?>([\s\S]*)$/g, '').trim();
    }
    // 兜底：如果原文有 </think>，取最后一个 </think> 之后的内容
    if (!result && text.includes('</think')) {
        result = text.replace(/^[\s\S]*<\/think(?:ing)?>\s*/g, '').trim();
    }
    return result;
}

// ═══════════════════════════════════════════════════════════
//  SummaryManager 类
// ═══════════════════════════════════════════════════════════

export class SummaryManager {
    /**
     * @param {string} chatId - 所属会话 ID
     */
    constructor(chatId) {
        this.chatId = chatId;
        /** @type {SummaryEntry[]} */
        this.summaries = [];
        /** @type {SummaryRelation[]} */
        this.relations = [];
    }

    // ─── 分组 ────────────────────────────────────────────────

    /**
     * 将消息数组按 40 轮一组分组。
     * @param {Array} messages - activeChat.messages
     * @returns {MessageGroup[]}
     */
    groupMessages(messages) {
        const pairs = [];

        for (let i = 0; i < messages.length; i++) {
            const msg = messages[i];
            if (msg.role === 'user') {
                const next = messages[i + 1];
                if (next && (next.role === 'assistant' || next.role === 'system')) {
                    pairs.push({
                        userIndex: i,
                        assistantIndex: i + 1,
                        userMsg: msg,
                        assistantMsg: next
                    });
                    i++; // 跳过已配对的 assistant
                }
            }
        }

        const groups = [];
        for (let i = 0; i < pairs.length; i += ROUNDS_PER_GROUP) {
            const chunk = pairs.slice(i, i + ROUNDS_PER_GROUP);
            const start = chunk[0].userIndex;
            const end = chunk[chunk.length - 1].assistantIndex;
            groups.push({
                groupIndex: groups.length,
                start,
                end,
                roundCount: chunk.length,
                pairs: chunk
            });
        }

        return groups;
    }

    // ─── 总结创建 ─────────────────────────────────────────────

    /**
     * 创建新的总结条目
     * @param {{ messageRange?: [number,number], sourceIds?: string[], content: string, type?: string }} opts
     * @returns {SummaryEntry}
     */
    createSummary({ messageRange = null, sourceIds = [], content, type = 'direct' }) {
        const id = `summary_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        const summary = {
            id,
            type: sourceIds.length > 0 ? 'merged' : type,
            messageRange,
            sourceIds,
            content: content || '',
            enabled: false,
            createdAt: Date.now(),
            level: sourceIds.length > 0 ? (this._getMaxLevel(sourceIds) + 1) : 1
        };

        this.summaries.push(summary);

        if (sourceIds.length > 0) {
            this.relations.push({ parentId: id, childIds: [...sourceIds] });
        }

        return summary;
    }

    /**
     * 获取 sourceIds 中最高层级
     * @param {string[]} sourceIds
     * @returns {number}
     */
    _getMaxLevel(sourceIds) {
        let max = 1;
        for (const id of sourceIds) {
            const s = this.summaries.find(s => s.id === id);
            if (s && s.level > max) max = s.level;
        }
        return max;
    }

    // ─── 启用/禁用 ────────────────────────────────────────────

    /**
     * 启用指定总结（自动禁用冲突）
     * @param {string} summaryId
     */
    enableSummary(summaryId) {
        const summary = this.summaries.find(s => s.id === summaryId);
        if (!summary) return;

        this._disableConflictingSummaries(summaryId);
        summary.enabled = true;
    }

    /**
     * 禁用指定总结
     * @param {string} summaryId
     */
    disableSummary(summaryId) {
        const summary = this.summaries.find(s => s.id === summaryId);
        if (summary) summary.enabled = false;
    }

    /**
     * 禁用与指定总结冲突的所有其他总结
     * 规则：父总结与所有子总结互斥
     * @param {string} summaryId
     */
    _disableConflictingSummaries(summaryId) {
        const childIds = this._getAllChildIds(summaryId);
        const parentIds = this._getAllParentIds(summaryId);

        const conflictIds = new Set([...childIds, ...parentIds]);
        conflictIds.delete(summaryId);

        for (const id of conflictIds) {
            const s = this.summaries.find(s => s.id === id);
            if (s) s.enabled = false;
        }
    }

    /**
     * 递归获取所有子总结 ID
     * @param {string} summaryId
     * @returns {string[]}
     */
    _getAllChildIds(summaryId) {
        const result = [];
        const relation = this.relations.find(r => r.parentId === summaryId);
        if (relation) {
            for (const childId of relation.childIds) {
                result.push(childId);
                result.push(...this._getAllChildIds(childId));
            }
        }
        return result;
    }

    /**
     * 递归获取所有父总结 ID
     * @param {string} summaryId
     * @returns {string[]}
     */
    _getAllParentIds(summaryId) {
        const result = [];
        const relation = this.relations.find(r => r.childIds.includes(summaryId));
        if (relation) {
            result.push(relation.parentId);
            result.push(...this._getAllParentIds(relation.parentId));
        }
        return result;
    }

    /**
     * 获取指定 summaryId 的直接子总结 ID 列表（只有一层）
     * @param {string} summaryId
     * @returns {string[]}
     */
    getDirectChildIds(summaryId) {
        const relation = this.relations.find(r => r.parentId === summaryId);
        return relation ? relation.childIds : [];
    }

    /**
     * 获取指定 summaryId 的父总结 ID（只有一层）
     * @param {string} summaryId
     * @returns {string|null}
     */
    getParentId(summaryId) {
        const relation = this.relations.find(r => r.childIds.includes(summaryId));
        return relation ? relation.parentId : null;
    }

    // ─── 查询 ─────────────────────────────────────────────────

    /**
     * 获取所有启用的总结，按 messageRange 升序排列（合并总结按第一个子总结的范围）
     * @returns {SummaryEntry[]}
     */
    getEnabledSummaries() {
        return this.summaries
            .filter(s => s.enabled)
            .sort((a, b) => {
                const aStart = a.messageRange?.[0] ?? Infinity;
                const bStart = b.messageRange?.[0] ?? Infinity;
                return aStart - bStart;
            });
    }

    /**
     * 根据 sourceIds 计算合并总结覆盖的 messageRange
     * @param {string[]} sourceIds
     * @returns {[number, number]|null}
     */
    getMergedRange(sourceIds) {
        let minStart = Infinity, maxEnd = -Infinity;
        for (const id of sourceIds) {
            const s = this.summaries.find(s => s.id === id);
            if (s?.messageRange) {
                if (s.messageRange[0] < minStart) minStart = s.messageRange[0];
                if (s.messageRange[1] > maxEnd) maxEnd = s.messageRange[1];
            }
        }
        if (minStart === Infinity) return null;
        return [minStart, maxEnd];
    }

    // ─── 上下文构建 ───────────────────────────────────────────

    /**
     * 构建注入到 LLM 上下文的总结文本块。
     * 格式：
     * <以前对话的总结>
     * [第X组总结 ...]
     * {content}
     * ...
     * </以前对话的总结>
     *
     * @param {Array} allMessages - 完整的消息数组
     * @returns {{ summaryBlock: string, excludedRanges: [number,number][] }}
     */
    buildSummaryContextBlock(allMessages) {
        const enabled = this.getEnabledSummaries();
        if (enabled.length === 0) {
            return { summaryBlock: '', excludedRanges: [] };
        }

        const totalMessages = allMessages.length;
        // 保底：始终保留最后 N 轮（2*N 条消息）
        const keepFromIndex = Math.max(0, totalMessages - MIN_KEEP_ROUNDS * 2);

        const lines = [];
        const excludedRanges = [];

        for (const summary of enabled) {
            if (!summary.messageRange) continue;
            const [start, end] = summary.messageRange;

            // 计算要排除的范围（保底区间内的消息不排除）
            const excludeEnd = Math.min(end, keepFromIndex - 1);
            if (start <= excludeEnd) {
                excludedRanges.push([start, excludeEnd]);
            }

            // 根据 messageRange 推算是第几组
            const groupStart = Math.floor(start / (ROUNDS_PER_GROUP * 2)) * ROUNDS_PER_GROUP + 1;
            const groupEnd = groupStart + Math.round((end - start + 1) / 2) - 1;

            lines.push(`[第${groupStart}至${groupEnd}轮对话总结]`);
            lines.push(summary.content.trim());
            lines.push('');
        }

        const summaryBlock = `<以前对话的总结>\n${lines.join('\n')}</以前对话的总结>`;
        return { summaryBlock, excludedRanges };
    }

    /**
     * 过滤消息历史，排除被总结覆盖的范围（但保底最后 MIN_KEEP_ROUNDS 轮）
     * @param {Array} messages - 原始消息数组（已处理为 LLM 格式）
     * @param {[number,number][]} excludedRanges
     * @returns {Array}
     */
    filterHistoryMessages(messages, excludedRanges) {
        if (!excludedRanges || excludedRanges.length === 0) return messages;

        return messages.filter((_, index) => {
            for (const [start, end] of excludedRanges) {
                if (index >= start && index <= end) return false;
            }
            return true;
        });
    }

    // ─── 持久化 ───────────────────────────────────────────────

    /** 导出数据（保存到会话） */
    exportData() {
        return {
            summaries: this.summaries,
            relations: this.relations
        };
    }

    /** 从会话加载数据 */
    importData(data) {
        if (!data) return;
        this.summaries = data.summaries || [];
        this.relations = data.relations || [];
    }

    /** 删除指定总结及其在 relations 中的记录 */
    deleteSummary(summaryId) {
        this.summaries = this.summaries.filter(s => s.id !== summaryId);
        this.relations = this.relations.filter(r => r.parentId !== summaryId);
        // 从子列表中移除
        this.relations.forEach(r => {
            r.childIds = r.childIds.filter(id => id !== summaryId);
        });
        // 清除空 relation
        this.relations = this.relations.filter(r => r.childIds.length > 0);
    }
}

// ═══════════════════════════════════════════════════════════
//  总结生成函数
// ═══════════════════════════════════════════════════════════

/**
 * 调用 LLM 生成总结文本。
 *
 * @param {object} opts
 * @param {Array<{userMsg, assistantMsg}>} [opts.messagePairs] - 原始消息对（直接总结时使用）
 * @param {string[]} [opts.existingSummaryContents] - 已有总结文本数组（合并总结时使用）
 * @param {Function} [opts.onProgress] - 流式进度回调 (chunkText) => void
 * @returns {Promise<string>} 总结正文（已去除 think 块）
 */
export async function generateSummary({ messagePairs = [], existingSummaryContents = [], onProgress = null }) {
    // ── 1. 构建待总结内容 ──────────────────────────────────────
    let contentToSummarize = '';

    if (existingSummaryContents.length > 0) {
        // 合并总结：拼接已有总结
        contentToSummarize = existingSummaryContents.map((text, idx) =>
            `[总结${idx + 1}]\n${text.trim()}`
        ).join('\n\n---\n\n');
    } else {
        // 直接总结：按轮次格式化
        contentToSummarize = messagePairs.map((pair, idx) => {
            const userText = extractCleanText(pair.userMsg.content);
            const assistantText = extractCleanText(pair.assistantMsg.content);
            return `[第${idx + 1}轮]\n用户：${userText}\nAI：${assistantText}`;
        }).join('\n\n');
    }

    // ── 2. 获取总结预设配置 ───────────────────────────────────
    const effectiveConfig = getEffectiveConfigForRequestType(LLMRequestTypes.CHAT_SUMMARY);
    const contextProfile = effectiveConfig.context || {};
    const profileData = effectiveConfig;

    if (!contextProfile.entries || !Array.isArray(contextProfile.entries)) {
        throw new Error('聊天总结预设未配置，请在 LLM 设置中配置「聊天总结」上下文预设。');
    }

    // ── 3. 构建消息数组（替换占位符）────────────────────────────
    const messages = [];
    for (const entry of contextProfile.entries) {
        if (!entry.enabled) continue;
        if (!entry.content || entry.content.trim() === '') continue;

        // 替换 {{需要总结的内容}} 占位符
        let content = entry.content;
        if (content.includes('{{需要总结的内容}}')) {
            content = content.replace(/\{\{需要总结的内容\}\}/g, contentToSummarize);
        }

        // 替换其他模板变量（人设、用户信息等）
        try {
            content = await substituteTemplateVariables(content, {});
        } catch (e) {
            // 变量替换失败不影响总结
        }

        messages.push({ role: entry.role || 'system', content });
    }

    if (messages.length === 0) {
        throw new Error('总结预设条目全部被禁用，无法生成总结。');
    }

    // ── 4. 调用 LLM ──────────────────────────────────────────
    // 回显组合提示词到测试界面
    updateCombinedPrompt(messages, '[聊天总结] ');

    let fullText = '';
    let isFirstChunk = true;
    const statusPatterns = /^(正在处理|请稍候|重试中|连接中|.*外部请求)/;
    const resultUpdater = getResultTextareaUpdater();
    const updateCallback = (chunk) => {
        // 过滤 LLM 服务层注入的状态提示文本
        if (isFirstChunk && statusPatterns.test(chunk.trim())) {
            if (onProgress) onProgress(chunk);
            return;
        }
        isFirstChunk = false;
        fullText += chunk;
        if (onProgress) onProgress(chunk);
        // 同步回显到测试界面
        if (resultUpdater) resultUpdater(fullText);
    };

    await executeDefaultLLMRequest(
        { prompt: messages, id: `summary_${Date.now()}` },
        profileData,
        updateCallback,
        'summary'
    );

    // ── 5. 后处理：去除 think 块 ────────────────────────────────
    return stripThink(fullText) || fullText.trim();
}

// ═══════════════════════════════════════════════════════════
//  全局 SummaryManager 单例
// ═══════════════════════════════════════════════════════════

/** 当前会话的 SummaryManager 实例 */
let summaryManager = null;

/**
 * 获取当前 SummaryManager（懒创建）
 * @returns {SummaryManager}
 */
export function getSummaryManager() {
    if (!summaryManager && activeChat) {
        summaryManager = new SummaryManager(activeChat.id);
    }
    return summaryManager;
}

/**
 * 重置 SummaryManager（切换会话时调用）
 * @param {string} chatId
 */
export function resetSummaryManager(chatId) {
    summaryManager = new SummaryManager(chatId);
}

// ═══════════════════════════════════════════════════════════
//  总结面板 UI 控制器
// ═══════════════════════════════════════════════════════════

/** 多选模式状态 */
let multiSelectMode = false;
/** 当前选中的消息组索引集合 */
const selectedGroupIndices = new Set();
/** 当前选中的总结 ID 集合 */
const selectedSummaryIds = new Set();
/** Token 统计版本号（防止过时更新） */
let tokenCalcVersion = 0;

/**
 * 初始化总结管理面板的事件绑定
 * 在 initAiAssistant 中调用
 */
export function initSummaryEvents() {
    const $sm = dom.summaryManager;
    if (!$sm || !$sm.length) return;

    // ── 关闭按钮 ──
    $sm.find('#summary-close-btn').on('click', function () {
        hideSummaryPanel();
    });

    // ── 多选模式切换 ──
    $sm.find('#summary-toggle-multiselect').on('click', function () {
        multiSelectMode = !multiSelectMode;
        const $btn = $(this);
        if (multiSelectMode) {
            $btn.addClass('active').html('<i class="fa-solid fa-check-double"></i> 取消多选');
        } else {
            $btn.removeClass('active').html('<i class="fa-solid fa-check-double"></i> 多选');
            selectedGroupIndices.clear();
            selectedSummaryIds.clear();
            $sm.find('.summary-card.selected').removeClass('selected');
        }
        updateToolbarButtons();
    });

    // ── 生成合并总结按钮 ──
    $sm.find('#summary-generate-selected-btn').on('click', async function () {
        await handleGenerateSelected();
    });

    // ── 启用选中总结 ──
    $sm.find('#summary-enable-selected-btn').on('click', function () {
        handleEnableSelected();
    });

    // ── 禁用选中总结 ──
    $sm.find('#summary-disable-selected-btn').on('click', function () {
        handleDisableSelected();
    });

    // ── 刷新事件（面板打开时触发） ──
    $sm.on('summary:refresh', function () {
        renderPanel();
    });
}

// ─── 显示/隐藏（独立弹窗模式） ────────────────────────────────

/** 遮罩层引用 */
let $summaryOverlay = null;

/**
 * 显示总结管理面板（独立弹窗，含遮罩层和移动端定位）
 */
export function showSummaryPanel() {
    const $sm = dom.summaryManager;
    if (!$sm || !$sm.length) return;

    // ── 移动端定位（参考 personaGen.js / assistantFloorMessage.js）──
    const isMobile = isMobileDevice();
    if (isMobile) {
        const topSettingsHolder = document.querySelector('#top-settings-holder');
        let topOffset = 10;
        if (topSettingsHolder) {
            const rect = topSettingsHolder.getBoundingClientRect();
            topOffset = Math.max(10, Math.min(rect.bottom + 10, window.innerHeight * 0.5));
        }
        const availableHeight = Math.max(200, window.innerHeight - topOffset - 20);
        $sm.css({
            top: `${topOffset}px`,
            left: '50%',
            transform: 'translateX(-50%)',
            width: '96vw',
            maxWidth: '96vw',
            height: `${availableHeight}px`,
            maxHeight: `${availableHeight}px`
        });
    } else {
        // 桌面端恢复居中默认值
        $sm.css({
            top: '50%',
            left: '50%',
            transform: 'translate(-50%, -50%)',
            width: '',
            maxWidth: '',
            height: '',
            maxHeight: ''
        });
    }

    // ── 创建遮罩层 ──
    if (!$summaryOverlay) {
        $summaryOverlay = $('<div class="st-chatu8-summary-overlay"></div>');
        $summaryOverlay.on('click', function () {
            hideSummaryPanel();
        });
    }
    $('body').append($summaryOverlay);

    // ── 将面板移到 body 下，脱离对话框的 transform 上下文 ──
    $sm.appendTo('body');

    // ── 显示面板并刷新 ──
    $sm.show();
    $sm.trigger('summary:refresh');
}

/**
 * 隐藏总结管理面板并移除遮罩层
 */
export function hideSummaryPanel() {
    const $sm = dom.summaryManager;
    if ($sm) $sm.hide();

    if ($summaryOverlay) {
        $summaryOverlay.detach();
    }
}

// ─── 渲染（多列水平布局） ─────────────────────────────────────

/**
 * 渲染整个总结面板
 */
function renderPanel() {
    if (!activeChat) return;
    const mgr = getSummaryManager();
    if (!mgr) return;

    const groups = mgr.groupMessages(activeChat.messages);
    renderColumns(groups, mgr);
    setTimeout(() => renderSVGLines(), 60);
    updateEnabledHint();
    calculateAndDisplayTokens(groups, mgr);
}

/**
 * 确保底部总 token 显示元素存在（兼容旧 HTML 缓存）
 * @param {jQuery} $sm - 面板 jQuery 对象
 * @returns {jQuery}
 */
function ensureTotalTokensElement($sm) {
    let $el = $sm.find('#summary-total-tokens');
    if (!$el.length) {
        $el = $('<span id="summary-total-tokens" class="summary-total-tokens"></span>');
        const $hint = $sm.find('#summary-enabled-hint');
        if ($hint.length) {
            $hint.after($el);
        } else {
            $sm.find('.summary-footer').prepend($el);
        }
    }
    return $el;
}

/**
 * 异步计算并显示所有组和总结的 token 数量，以及预估发送总 token
 */
async function calculateAndDisplayTokens(groups, mgr) {
    const version = ++tokenCalcVersion;
    const $sm = dom.summaryManager;

    // 显示加载状态
    $sm.find('.summary-card-tokens').html(
        '<i class="fa-solid fa-circle-notch fa-spin" style="font-size:9px;opacity:0.4;"></i>'
    );
    ensureTotalTokensElement($sm).text('统计中...');

    // ── 并行计算所有组的 token ──
    const groupTokens = new Map();
    const groupPromises = groups.map(async (group, idx) => {
        const msgs = [];
        for (const pair of group.pairs) {
            msgs.push({ role: 'user', content: extractCleanText(pair.userMsg.content) });
            msgs.push({ role: 'assistant', content: extractCleanText(pair.assistantMsg.content) });
        }
        const count = await countTokens(msgs, TOKEN_COUNT_MODEL);
        groupTokens.set(idx, count);
    });

    // ── 并行计算所有总结的 token ──
    const summaryTokens = new Map();
    const summaryPromises = mgr.summaries.map(async (summary) => {
        const msgs = [{ role: 'system', content: summary.content }];
        const count = await countTokens(msgs, TOKEN_COUNT_MODEL);
        summaryTokens.set(summary.id, count);
    });

    // ── 计算 LLM 自定义预设开销（完整占位符填充） ──
    let presetTokenCount = 0;
    const presetPromise = (async () => {
        try {
            const { messages: presetMessages } = await buildCustomPrefillMessages({});
            if (presetMessages && presetMessages.length > 0) {
                presetTokenCount = await countTokens(presetMessages, TOKEN_COUNT_MODEL);
                if (presetTokenCount < 0) presetTokenCount = 0;
            }
        } catch (e) {
            console.warn('[calculateAndDisplayTokens] 预设 token 计算失败:', e);
        }
    })();

    await Promise.all([...groupPromises, ...summaryPromises, presetPromise]);

    // 版本检查：如果面板已重新渲染，丢弃本次结果
    if (version !== tokenCalcVersion) return;

    // ── 更新组卡片上的 token 显示 ──
    for (const [idx, count] of groupTokens) {
        const $el = $sm.find(`[data-token-group="${idx}"]`);
        if ($el.length) {
            $el.text(count >= 0 ? `${(count / 1000).toFixed(1)}k` : '');
        }
    }

    // ── 更新总结卡片上的 token 显示 ──
    for (const [id, count] of summaryTokens) {
        const $el = $sm.find(`[data-token-summary="${id}"]`);
        if ($el.length) {
            $el.text(count >= 0 ? `${(count / 1000).toFixed(1)}k` : '');
        }
    }

    // ── 计算预估发送总 token ──
    let totalTokens = 0;
    const coveredGroupIndices = new Set();

    // 启用的总结：累计其 token 并标记它覆盖的组
    for (const summary of mgr.summaries) {
        if (!summary.enabled || !summary.messageRange) continue;
        totalTokens += Math.max(0, summaryTokens.get(summary.id) || 0);
        for (let i = 0; i < groups.length; i++) {
            const g = groups[i];
            if (g.start >= summary.messageRange[0] && g.end <= summary.messageRange[1]) {
                coveredGroupIndices.add(i);
            }
        }
    }

    // 未被覆盖的组：累计原始 token
    for (let i = 0; i < groups.length; i++) {
        if (!coveredGroupIndices.has(i)) {
            totalTokens += Math.max(0, groupTokens.get(i) || 0);
        }
    }

    // 被覆盖的组添加视觉标记（删除线 + 变淡）
    for (let i = 0; i < groups.length; i++) {
        const $el = $sm.find(`[data-token-group="${i}"]`);
        if (coveredGroupIndices.has(i)) {
            $el.addClass('summary-card-tokens--excluded');
        } else {
            $el.removeClass('summary-card-tokens--excluded');
        }
    }

    // 加上预设开销
    const historyTokens = totalTokens;
    totalTokens += presetTokenCount;

    // 更新底部总 token 显示
    const presetHint = presetTokenCount > 0 ? ` (预设 ${(presetTokenCount / 1000).toFixed(1)}k + 历史 ${(historyTokens / 1000).toFixed(1)}k)` : '';
    ensureTotalTokensElement($sm).text(`预估发送: ${(totalTokens / 1000).toFixed(1)}k tokens${presetHint}`);
}

/**
 * 按层级创建列并渲染紧凑卡片
 */
function renderColumns(groups, mgr) {
    const $container = dom.summaryManager.find('#summary-columns');
    $container.children('.summary-col').remove();

    // ── 第 0 列：消息组 ──
    const $col0 = $('<div class="summary-col" data-level="0"></div>');
    $col0.append('<div class="summary-col-header">消息组</div>');
    const $list0 = $('<div class="summary-col-list"></div>');

    groups.forEach((group, idx) => {
        const hasSummary = mgr.summaries.some(s =>
            s.messageRange && s.messageRange[0] === group.start && s.messageRange[1] === group.end
        );
        const enabledSummary = mgr.summaries.find(s =>
            s.messageRange && s.enabled && s.messageRange[0] === group.start && s.messageRange[1] === group.end
        );

        const cardClass = [
            'summary-card', 'summary-card--group',
            enabledSummary ? 'summary-card--enabled' : '',
            hasSummary ? 'summary-card--has-summary' : '',
            selectedGroupIndices.has(idx) ? 'selected' : ''
        ].filter(Boolean).join(' ');

        const $card = $(`
            <div class="${cardClass}" data-group-index="${idx}" data-group-start="${group.start}" data-group-end="${group.end}">
                <div class="summary-card-header">
                    <span class="summary-card-title">第 ${idx + 1} 组</span>
                    ${enabledSummary ? '<span class="summary-card-badge summary-card-badge--enabled">✓</span>' : ''}
                    ${hasSummary && !enabledSummary ? '<span class="summary-card-badge">✓</span>' : ''}
                </div>
                <div class="summary-card-info">${group.roundCount} 轮 (${group.start + 1}–${group.end + 1}) · <span class="summary-card-tokens" data-token-group="${idx}"></span></div>
                <div class="summary-card-actions">
                    ${!hasSummary ? `<button class="summary-btn summary-btn--sm summary-btn--primary summary-generate-btn" title="${group.roundCount < ROUNDS_PER_GROUP ? `不足${ROUNDS_PER_GROUP}轮，无法总结` : '生成总结'}" ${group.roundCount < ROUNDS_PER_GROUP ? 'disabled' : ''}><i class="fa-solid fa-wand-magic-sparkles"></i></button>` : ''}
                    ${hasSummary ? `<button class="summary-btn summary-btn--sm summary-btn--danger summary-delete-btn" title="删除总结"><i class="fa-solid fa-trash"></i></button>` : ''}
                </div>
            </div>
        `);

        // 点击：多选 or 查看详情
        $card.on('click', function (e) {
            if ($(e.target).closest('button').length) return;
            if (multiSelectMode) {
                if (selectedGroupIndices.has(idx)) { selectedGroupIndices.delete(idx); $card.removeClass('selected'); }
                else { selectedGroupIndices.add(idx); $card.addClass('selected'); }
                updateToolbarButtons();
            } else {
                showGroupDetailPopup(group, idx);
            }
        });

        $card.find('.summary-generate-btn').on('click', async function (e) {
            e.stopPropagation();
            await handleGenerateSingle(idx, group);
        });

        $card.find('.summary-delete-btn').on('click', function (e) {
            e.stopPropagation();
            handleDeleteByGroupRange(group.start, group.end);
        });

        $list0.append($card);
    });

    if (groups.length === 0) {
        $list0.append('<div class="summary-empty"><i class="fa-solid fa-comments"></i>暂无可总结的分组</div>');
    }
    $col0.append($list0);
    $container.append($col0);

    // ── 第 1..N 列：按层级渲染总结 ──
    const maxLevel = mgr.summaries.reduce((m, s) => Math.max(m, s.level || 1), 0);

    for (let level = 1; level <= Math.max(maxLevel, 1); level++) {
        const levelSummaries = mgr.summaries
            .filter(s => (s.level || 1) === level)
            .sort((a, b) => (a.sortOrder ?? a.createdAt ?? 0) - (b.sortOrder ?? b.createdAt ?? 0));

        const levelLabel = level === 1 ? '直接总结 L1' : `合并总结 L${level}`;
        const $col = $(`<div class="summary-col" data-level="${level}"></div>`);
        $col.append(`<div class="summary-col-header">${levelLabel}</div>`);
        const $list = $('<div class="summary-col-list"></div>');

        if (levelSummaries.length === 0) {
            $list.append(`<div class="summary-empty"><i class="fa-solid fa-wand-magic-sparkles"></i>${level === 1 ? '点击 ✨ 生成' : '选中多个总结合并'}</div>`);
        }

        levelSummaries.forEach(summary => {
            const isMerged = summary.type === 'merged';
            const cardClass = [
                'summary-card', 'summary-card--summary',
                summary.enabled ? 'summary-card--enabled' : '',
                isMerged ? 'summary-card--merged' : '',
                selectedSummaryIds.has(summary.id) ? 'selected' : ''
            ].filter(Boolean).join(' ');

            const rangeHint = summary.messageRange
                ? `${summary.messageRange[0] + 1}–${summary.messageRange[1] + 1}`
                : '';

            const preview = summary.content.length > 40
                ? summary.content.substring(0, 40) + '...'
                : summary.content;

            const $card = $(`
                <div class="${cardClass}" data-summary-id="${summary.id}">
                    <div class="summary-card-header">
                        <span class="summary-card-title">${isMerged ? '合并' : '总结'} L${summary.level}</span>
                        ${summary.enabled ? '<span class="summary-card-badge summary-card-badge--enabled">✓</span>' : ''}
                    </div>
                    ${rangeHint ? `<div class="summary-card-info">${rangeHint}</div>` : ''}
                    <div class="summary-card-preview">${escapeHTML(preview)}</div>
                    <div class="summary-card-tokens" data-token-summary="${summary.id}"></div>
                    <div class="summary-card-actions">
                        ${!summary.enabled
                    ? `<button class="summary-btn summary-btn--sm summary-btn--success summary-enable-btn" title="启用"><i class="fa-solid fa-check"></i></button>`
                    : `<button class="summary-btn summary-btn--sm summary-btn--warning summary-disable-btn" title="禁用"><i class="fa-solid fa-times"></i></button>`
                }
                        <button class="summary-btn summary-btn--sm summary-btn--danger summary-delete-summary-btn" title="删除"><i class="fa-solid fa-trash"></i></button>
                    </div>
                </div>
            `);

            // 点击：多选 or 查看详情弹窗
            $card.on('click', function (e) {
                if ($(e.target).closest('button').length) return;
                if (multiSelectMode) {
                    if (selectedSummaryIds.has(summary.id)) { selectedSummaryIds.delete(summary.id); $card.removeClass('selected'); }
                    else { selectedSummaryIds.add(summary.id); $card.addClass('selected'); }
                    updateToolbarButtons();
                } else {
                    showSummaryDetailPopup(summary);
                }
            });

            $card.find('.summary-enable-btn').on('click', function (e) {
                e.stopPropagation();
                mgr.enableSummary(summary.id);
                saveSummaryData();
                renderPanel();
            });

            $card.find('.summary-disable-btn').on('click', function (e) {
                e.stopPropagation();
                mgr.disableSummary(summary.id);
                saveSummaryData();
                renderPanel();
            });

            $card.find('.summary-delete-summary-btn').on('click', function (e) {
                e.stopPropagation();
                mgr.deleteSummary(summary.id);
                saveSummaryData();
                renderPanel();
            });

            $list.append($card);
        });

        // ── 拖拽排序 ──
        enableDragSort($list, level, mgr);

        $col.append($list);
        $container.append($col);
    }

    // 滚动时重绘 SVG
    let scrollTimer = null;
    $container.off('scroll.svgRedraw').on('scroll.svgRedraw', function () {
        if (scrollTimer) clearTimeout(scrollTimer);
        scrollTimer = setTimeout(() => renderSVGLines(), 60);
    });
    $container.find('.summary-col-list').off('scroll.svgRedraw').on('scroll.svgRedraw', function () {
        if (scrollTimer) clearTimeout(scrollTimer);
        scrollTimer = setTimeout(() => renderSVGLines(), 60);
    });
}

// ─── 详情弹窗 ────────────────────────────────────────────────

/**
 * 消息组详情弹窗
 */
function showGroupDetailPopup(group, idx) {
    const pairs = group.pairs.slice(0, 20);
    let contentHtml = pairs.map(pair => {
        const userText = extractCleanText(pair.userMsg.content).substring(0, 200);
        const aiText = extractCleanText(pair.assistantMsg.content).substring(0, 200);
        return `<div class="detail-turn">
            <div class="detail-role detail-role--user">用户:</div>
            <div class="detail-text">${escapeHTML(userText)}</div>
            <div class="detail-role detail-role--ai">AI:</div>
            <div class="detail-text">${escapeHTML(aiText)}</div>
        </div>`;
    }).join('');

    if (group.pairs.length > 20) {
        contentHtml += `<div style="text-align:center;opacity:0.5;padding:8px;">... 共 ${group.roundCount} 轮</div>`;
    }

    showDetailPopup(`第 ${idx + 1} 组 — ${group.roundCount} 轮对话 (${group.start + 1}–${group.end + 1})`, contentHtml);
}

/**
 * 总结详情弹窗（可编辑）
 */
function showSummaryDetailPopup(summary) {
    const isMerged = summary.type === 'merged';
    const title = `${isMerged ? '合并总结' : '直接总结'} L${summary.level}`;
    const rangeHint = summary.messageRange
        ? `消息范围: ${summary.messageRange[0] + 1}–${summary.messageRange[1] + 1}`
        : '';

    showDetailPopup(title, {
        editable: true,
        text: summary.content,
        hint: rangeHint,
        onSave: (newContent) => {
            const mgr = getSummaryManager();
            if (!mgr) return;
            const target = mgr.summaries.find(s => s.id === summary.id);
            if (target) {
                target.content = newContent;
                saveSummaryData();
                renderPanel();
            }
        }
    });
}

/**
 * 通用详情弹窗
 * @param {string} title
 * @param {object|string} opts - 字符串则为只读 HTML；对象则支持 { editable, text, hint, onSave, html }
 */
function showDetailPopup(title, opts) {
    $('.summary-detail-overlay').remove();

    const isObj = typeof opts === 'object' && opts !== null;
    const editable = isObj && opts.editable;
    const contentHtml = isObj ? (opts.html || '') : opts;
    const editText = isObj ? (opts.text || '') : '';
    const hint = isObj ? (opts.hint || '') : '';

    const isMobile = isMobileDevice();
    let panelExtra = '';
    if (isMobile) {
        const topSettingsHolder = document.querySelector('#top-settings-holder');
        let topOffset = 10;
        if (topSettingsHolder) {
            const rect = topSettingsHolder.getBoundingClientRect();
            topOffset = Math.max(10, Math.min(rect.bottom + 10, window.innerHeight * 0.5));
        }
        const availableHeight = Math.max(200, window.innerHeight - topOffset - 20);
        panelExtra = `style="top:${topOffset}px;left:50%;transform:translateX(-50%);width:94vw;max-height:${availableHeight}px;"`;
    }

    let bodyHtml;
    if (editable) {
        bodyHtml = `
            ${hint ? `<div style="font-size:12px;color:#888;margin-bottom:8px;">${hint}</div>` : ''}
            <textarea class="summary-detail-textarea">${escapeHTML(editText)}</textarea>
            <div class="summary-detail-actions">
                <button class="summary-btn summary-btn--sm summary-btn--success summary-detail-save-btn"><i class="fa-solid fa-check"></i> 保存</button>
                <button class="summary-btn summary-btn--sm summary-btn--outline summary-detail-cancel-btn">取消</button>
            </div>
        `;
    } else {
        bodyHtml = contentHtml;
    }

    const html = `
        <div class="summary-detail-overlay">
            <div class="summary-detail-panel" ${panelExtra}>
                <div class="summary-detail-header">
                    <div class="summary-detail-title">${title}</div>
                    <button class="summary-btn summary-btn--icon summary-detail-close-btn"><i class="fa-solid fa-xmark"></i></button>
                </div>
                <div class="summary-detail-body">${bodyHtml}</div>
            </div>
        </div>
    `;

    const $overlay = $(html);
    $('body').append($overlay);

    $overlay.find('.summary-detail-close-btn').on('click', () => $overlay.remove());
    $overlay.on('click', function (e) {
        if ($(e.target).hasClass('summary-detail-overlay')) $overlay.remove();
    });

    if (editable && isObj && opts.onSave) {
        $overlay.find('.summary-detail-save-btn').on('click', function () {
            const newText = $overlay.find('.summary-detail-textarea').val().trim();
            if (newText) {
                opts.onSave(newText);
                $overlay.remove();
            }
        });
        $overlay.find('.summary-detail-cancel-btn').on('click', () => $overlay.remove());
    }
}

// ─── 拖拽排序 ──────────────────────────────────────────────

/**
 * 在总结列表上启用拖拽排序
 * @param {jQuery} $list - 列表容器
 * @param {number} level - 层级
 * @param {SummaryManager} mgr
 */
function enableDragSort($list, level, mgr) {
    const listEl = $list[0];
    if (!listEl) return;

    let dragEl = null;
    let placeholder = null;

    $list.find('.summary-card--summary').attr('draggable', 'true');

    $list.on('dragstart', '.summary-card--summary', function (e) {
        dragEl = this;
        $(this).addClass('summary-card--dragging');
        e.originalEvent.dataTransfer.effectAllowed = 'move';
        e.originalEvent.dataTransfer.setData('text/plain', '');

        // 创建占位符
        placeholder = document.createElement('div');
        placeholder.className = 'summary-card-placeholder';
        placeholder.style.height = this.offsetHeight + 'px';
    });

    $list.on('dragover', '.summary-card--summary, .summary-card-placeholder', function (e) {
        e.preventDefault();
        e.originalEvent.dataTransfer.dropEffect = 'move';
        if (!dragEl || this === dragEl) return;

        const rect = this.getBoundingClientRect();
        const midY = rect.top + rect.height / 2;
        const parentEl = this.parentNode;

        if (e.originalEvent.clientY < midY) {
            parentEl.insertBefore(placeholder, this);
        } else {
            parentEl.insertBefore(placeholder, this.nextSibling);
        }
    });

    $list.on('dragend', '.summary-card--summary', function () {
        $(this).removeClass('summary-card--dragging');
        if (placeholder && placeholder.parentNode) {
            placeholder.parentNode.insertBefore(dragEl, placeholder);
            placeholder.parentNode.removeChild(placeholder);
        }

        // 根据当前 DOM 顺序更新 sortOrder
        const cards = $list.find('.summary-card--summary');
        cards.each(function (index) {
            const summaryId = $(this).data('summary-id');
            const s = mgr.summaries.find(s => s.id === summaryId);
            if (s) {
                s.sortOrder = index;
            }
        });

        saveSummaryData();
        // 延迟重绘连线
        setTimeout(() => renderSVGLines(), 60);
        dragEl = null;
        placeholder = null;
    });
}

// ─── SVG 连线（水平多列） ────────────────────────────────────

/**
 * 渲染 SVG 连接线（消息组→直接总结，子总结→合并总结）
 */
function renderSVGLines() {
    const $svg = dom.summaryManager.find('#summary-svg-lines');
    $svg.empty();

    const mgr = getSummaryManager();
    if (!mgr) return;

    const $columns = dom.summaryManager.find('#summary-columns');
    if (!$columns.length) return;

    const columnsEl = $columns[0];
    const colRect = columnsEl.getBoundingClientRect();
    const scrollLeft = columnsEl.scrollLeft;
    const scrollTop = 0;

    // SVG 尺寸 = 滚动内容的全宽 × 容器高
    const svgW = columnsEl.scrollWidth;
    const svgH = columnsEl.clientHeight;
    $svg.attr({ width: svgW, height: svgH });
    $svg.css({ width: svgW + 'px', height: svgH + 'px' });

    function drawCurve(fromEl, toEl, cssClass) {
        const fromRect = fromEl.getBoundingClientRect();
        const toRect = toEl.getBoundingClientRect();

        const x1 = fromRect.right - colRect.left + scrollLeft;
        const y1 = fromRect.top + fromRect.height / 2 - colRect.top + scrollTop;
        const x2 = toRect.left - colRect.left + scrollLeft;
        const y2 = toRect.top + toRect.height / 2 - colRect.top + scrollTop;
        const midX = (x1 + x2) / 2;

        const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        path.setAttribute('d', `M ${x1} ${y1} C ${midX} ${y1}, ${midX} ${y2}, ${x2} ${y2}`);
        path.setAttribute('class', cssClass);
        $svg.append(path);
    }

    // 1. 消息组 → 直接总结
    for (const summary of mgr.summaries) {
        if (summary.type === 'merged' || !summary.messageRange) continue;
        const $summaryCard = dom.summaryManager.find(`[data-summary-id="${summary.id}"]`);
        if (!$summaryCard.length) continue;

        const lineClass = summary.enabled ? 'line-group-to-summary line-enabled' : 'line-group-to-summary';

        // 多组合并的总结：连到所有来源组
        if (summary.sourceGroups && summary.sourceGroups.length > 0) {
            for (const sg of summary.sourceGroups) {
                const $groupCard = dom.summaryManager.find(
                    `[data-group-start="${sg.start}"][data-group-end="${sg.end}"]`
                );
                if ($groupCard.length) {
                    drawCurve($groupCard[0], $summaryCard[0], lineClass);
                }
            }
        } else {
            // 单组总结：精确匹配
            const $groupCard = dom.summaryManager.find(
                `[data-group-start="${summary.messageRange[0]}"][data-group-end="${summary.messageRange[1]}"]`
            );
            if (!$groupCard.length) continue;
            drawCurve($groupCard[0], $summaryCard[0], lineClass);
        }
    }

    // 2. 子总结 → 合并总结（水平方向）
    for (const relation of mgr.relations) {
        const $parent = dom.summaryManager.find(`[data-summary-id="${relation.parentId}"]`);
        if (!$parent.length) continue;

        const parentSummary = mgr.summaries.find(s => s.id === relation.parentId);

        for (const childId of relation.childIds) {
            const $child = dom.summaryManager.find(`[data-summary-id="${childId}"]`);
            if (!$child.length) continue;

            const lineClass = parentSummary?.enabled ? 'line-merged line-enabled' : 'line-merged';
            drawCurve($child[0], $parent[0], lineClass);
        }
    }
}

// ─── 操作处理 ──────────────────────────────────────────────

/**
 * 生成单个消息组的总结
 * @param {number} groupIndex
 * @param {object} group
 */
async function handleGenerateSingle(groupIndex, group) {
    if (!activeChat) return;
    const mgr = getSummaryManager();
    if (!mgr) return;

    // 不满 ROUNDS_PER_GROUP 轮的组不允许生成总结
    if (group.roundCount < ROUNDS_PER_GROUP) {
        showStatus(`第 ${groupIndex + 1} 组只有 ${group.roundCount} 轮，不足 ${ROUNDS_PER_GROUP} 轮，无法生成总结`, 'warning');
        return;
    }

    showStatus('正在生成总结...', 'info');

    // 在消息组卡片上显示 loading
    const $groupCard = dom.summaryManager.find(`[data-group-index="${groupIndex}"]`);
    const $loadingEl = $('<div class="summary-card-loading"><i class="fa-solid fa-spinner"></i><span>正在生成...</span></div>');
    $groupCard.find('.summary-card-actions').hide();
    $groupCard.append($loadingEl);

    try {
        let progressText = '';
        const summaryText = await generateSummary({
            messagePairs: group.pairs,
            onProgress: (chunk) => {
                progressText += chunk;
                const preview = stripThink(progressText);
                if (preview) {
                    const displayText = preview.length > 80 ? preview.substring(0, 80) + '...' : preview;
                    $loadingEl.find('span').text(displayText);
                }
            }
        });

        if (summaryText) {
            mgr.createSummary({
                messageRange: [group.start, group.end],
                content: summaryText,
                type: 'direct'
            });
            saveSummaryData();
            showStatus('总结生成完成', 'success');
        } else {
            showStatus('总结生成失败：返回内容为空', 'error');
        }
    } catch (err) {
        console.error('[Summary] 生成总结失败:', err);
        showStatus('生成失败: ' + err.message, 'error');
    }

    renderPanel();
}

/**
 * 生成合并总结（多选模式）
 */
async function handleGenerateSelected() {
    if (!activeChat) return;
    const mgr = getSummaryManager();
    if (!mgr) return;

    // ── 情况1：选中了消息组 → 合并所有选中组的消息，一次性生成总结 ──
    if (selectedGroupIndices.size > 0) {
        const groups = mgr.groupMessages(activeChat.messages);
        const indices = [...selectedGroupIndices].sort((a, b) => a - b);

        // 过滤不满 ROUNDS_PER_GROUP 轮的组
        const shortGroups = indices.filter(idx => groups[idx] && groups[idx].roundCount < ROUNDS_PER_GROUP);
        if (shortGroups.length > 0) {
            const names = shortGroups.map(idx => `第${idx + 1}组(${groups[idx].roundCount}轮)`).join('、');
            showStatus(`${names} 不足 ${ROUNDS_PER_GROUP} 轮，已自动跳过`, 'warning');
        }
        const validIndices = indices.filter(idx => groups[idx] && groups[idx].roundCount >= ROUNDS_PER_GROUP);

        // 收集所有选中组的消息对，合并为一个列表
        const allPairs = [];
        let mergeStart = Infinity, mergeEnd = -Infinity;
        const sourceGroupStarts = [];
        for (const idx of validIndices) {
            const group = groups[idx];
            if (!group) continue;
            allPairs.push(...group.pairs);
            if (group.start < mergeStart) mergeStart = group.start;
            if (group.end > mergeEnd) mergeEnd = group.end;
            sourceGroupStarts.push({ start: group.start, end: group.end });
        }

        if (allPairs.length === 0) {
            showStatus('选中的消息组无有效消息（可能全部不足轮数）', 'warning');
            return;
        }

        showStatus(`正在为 ${indices.length} 个消息组生成合并总结（共 ${allPairs.length} 轮）...`, 'info');

        try {
            const summaryText = await generateSummary({
                messagePairs: allPairs,
                onProgress: () => { }
            });
            if (summaryText) {
                const newSummary = mgr.createSummary({
                    messageRange: [mergeStart, mergeEnd],
                    content: summaryText,
                    type: 'direct'
                });
                // 记录来源组范围，用于连线
                if (sourceGroupStarts.length > 1) {
                    newSummary.sourceGroups = sourceGroupStarts;
                }
                saveSummaryData();
                showStatus('合并总结生成完成', 'success');
            } else {
                showStatus('总结生成失败：返回内容为空', 'error');
            }
        } catch (err) {
            console.error('[Summary] 生成合并总结失败:', err);
            showStatus('生成失败: ' + err.message, 'error');
        }

        selectedGroupIndices.clear();
        renderPanel();
        return;
    }

    // ── 情况2：选中了多个总结卡片 → 合并总结 ──
    if (selectedSummaryIds.size < 2) {
        showStatus('请至少选择 2 个总结进行合并', 'warning');
        return;
    }

    showStatus('正在生成合并总结...', 'info');

    try {
        const existingContents = [];
        const sourceIds = [];
        for (const id of selectedSummaryIds) {
            const s = mgr.summaries.find(s => s.id === id);
            if (s) {
                existingContents.push(s.content);
                sourceIds.push(id);
            }
        }

        const mergedRange = mgr.getMergedRange(sourceIds);

        const summaryText = await generateSummary({
            existingSummaryContents: existingContents,
            onProgress: () => { }
        });

        if (summaryText) {
            mgr.createSummary({
                messageRange: mergedRange,
                sourceIds: sourceIds,
                content: summaryText,
                type: 'merged'
            });
            saveSummaryData();
            showStatus('合并总结生成完成', 'success');
            selectedSummaryIds.clear();
        } else {
            showStatus('合并总结生成失败：返回内容为空', 'error');
        }
    } catch (err) {
        console.error('[Summary] 生成合并总结失败:', err);
        showStatus('生成失败: ' + err.message, 'error');
    }

    renderPanel();
}

/**
 * 删除指定消息组范围的总结
 */
function handleDeleteByGroupRange(start, end) {
    const mgr = getSummaryManager();
    if (!mgr) return;

    const target = mgr.summaries.find(s => s.messageRange && s.messageRange[0] === start && s.messageRange[1] === end);
    if (target) {
        mgr.deleteSummary(target.id);
        saveSummaryData();
        renderPanel();
    }
}

/**
 * 启用选中的总结
 */
function handleEnableSelected() {
    const mgr = getSummaryManager();
    if (!mgr) return;

    for (const id of selectedSummaryIds) {
        mgr.enableSummary(id);
    }
    saveSummaryData();
    selectedSummaryIds.clear();
    renderPanel();
}

/**
 * 禁用选中的总结
 */
function handleDisableSelected() {
    const mgr = getSummaryManager();
    if (!mgr) return;

    for (const id of selectedSummaryIds) {
        mgr.disableSummary(id);
    }
    saveSummaryData();
    selectedSummaryIds.clear();
    renderPanel();
}

// ─── 辅助 ──────────────────────────────────────────────────

/**
 * 更新工具栏按钮的启用/禁用状态
 */
function updateToolbarButtons() {
    const $genBtn = dom.summaryManager.find('#summary-generate-selected-btn');
    const $enableBtn = dom.summaryManager.find('#summary-enable-selected-btn');
    const $disableBtn = dom.summaryManager.find('#summary-disable-selected-btn');

    const hasSummarySelection = selectedSummaryIds.size > 0;
    const hasGroupSelection = selectedGroupIndices.size > 0;
    // 可合并：选中了 ≥2 个总结卡片；或选中了 ≥1 个消息组（批量生成）
    const canGenerate = selectedSummaryIds.size >= 2 || hasGroupSelection;

    $genBtn.prop('disabled', !canGenerate);
    $enableBtn.prop('disabled', !hasSummarySelection);
    $disableBtn.prop('disabled', !hasSummarySelection);
}

/**
 * 更新底部启用提示
 */
function updateEnabledHint() {
    const mgr = getSummaryManager();
    const $hint = dom.summaryManager.find('#summary-enabled-hint');
    if (!mgr || !mgr.summaries.length) {
        $hint.text('');
        return;
    }
    const enabledCount = mgr.summaries.filter(s => s.enabled).length;
    $hint.text(enabledCount > 0 ? `已启用 ${enabledCount} 个总结` : '');
}

/**
 * 显示状态栏消息
 * @param {string} msg
 * @param {'info'|'success'|'warning'|'error'} type
 */
function showStatus(msg, type = 'info') {
    const $bar = dom.summaryManager.find('#summary-status-bar');
    $bar.text(msg).removeClass('summary-status-bar--info summary-status-bar--success summary-status-bar--warning summary-status-bar--error')
        .addClass(`summary-status-bar--${type}`).show();
    if (type !== 'error') {
        setTimeout(() => $bar.fadeOut(), 3000);
    }
}

/**
 * 保存总结数据到会话
 */
function saveSummaryData() {
    if (!activeChat) return;
    const mgr = getSummaryManager();
    if (!mgr) return;
    activeChat.summaryData = mgr.exportData();
    syncAndSave().catch(err => {
        console.error('[Summary] 保存总结数据失败:', err);
    });
}

/**
 * HTML 转义
 * @param {string} str
 * @returns {string}
 */
function escapeHTML(str) {
    if (!str) return '';
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
