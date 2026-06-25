/**
 * assistantSession.js
 * 
 * 多会话管理：新建/切换/删除聊天、历史记录面板渲染、
 * 导出聊天记录、会话持久化等。
 * 
 * V2 三层分离存储改造：
 * - 索引层(ai_chat_index)：会话列表元数据
 * - 会话层(ai_chat_data_{chatId})：单个会话的消息数据
 * - 图片层(chatimg_{uuid})：图片二进制独立存储
 */

import {
    dom, chatSessions, setChatSessions,
    chatIndex, activeChat, v2Ready,
    setChatIndex, setActiveChat, setV2Ready,
    initialized, setInitialized,
    isAiGenerating, setIsAiGenerating,
    setCurrentSystemMsgElement, setCurrentSystemMsgContent,
    setPendingCommand
} from './assistantContext.js';
import { extensionName } from '../config.js';
import { extension_settings } from "../../../../../extensions.js";
import { addLog } from '../utils.js';
import {
    saveAiChatHistory, getAiChatHistory,
    saveChatIndex as dbSaveChatIndex, getChatIndex as dbGetChatIndex,
    saveChatData, getChatData, deleteChatData,
    deleteChatImagesByChatId, getChatImagesBatch,
    migrateV1ToV2
} from '../configDatabase.js';
import { clearTaskManager, serializeTaskManager, restoreTaskManager } from '../aiSettingsBridge.js';
import { escapeHTML } from './assistantUtils.js';
import { checkAndShowSettings } from './assistantDialog.js';
import { renderMessagesWithPagination } from './assistantScrollManager.js';
import { getSummaryManager, resetSummaryManager } from './assistantSummary.js';
import { getAssistantDisplayName } from './assistantAvatar.js';
import { abortLLMChannelRequest } from '../settings/llm.js';
import { updateSendButtonState } from './assistantMessage.js';

// ═══════════════════════════════════════════════════════════
//  会话辅助函数
// ═══════════════════════════════════════════════════════════

/**
 * 中止当前正在进行的 AI 生成并清理流式输出状态。
 * 在切换/新建会话前调用，防止旧会话的流式响应泄漏到新会话 DOM 中。
 */
function _abortAndCleanupGeneration() {
    if (isAiGenerating) {
        console.log('[AI Assistant] 切换会话前中止正在进行的 AI 生成');
        abortLLMChannelRequest('assistant');
        setIsAiGenerating(false);
        updateSendButtonState();
    }
    // 无论是否正在生成，都清理流式输出引用，防止 reattachMessageElement 把旧元素插入新会话
    setCurrentSystemMsgElement(null);
    setCurrentSystemMsgContent(null);
    setPendingCommand(null);
}

function _clearEditingState() {
    dom.inputArea?.removeData('editing-index');
    dom.chatBody?.find('.st-chatu8-ai-msg').removeClass('editing');
}

function _sanitizeChatMessages(chatData, source = '') {
    const rawMessages = Array.isArray(chatData?.messages) ? chatData.messages : [];
    const sanitizedMessages = [];
    const sourceLabel = source ? ` (${source})` : '';

    rawMessages.forEach((msg, idx) => {
        if (!msg || typeof msg !== 'object') {
            console.warn(`[AI Assistant] 消息[${idx}] 无效${sourceLabel}，已跳过:`, msg);
            return;
        }

        if (msg.content === undefined || msg.content === null) {
            msg.content = '';
        }

        if (!msg.role || (msg.role !== 'user' && msg.role !== 'assistant' && msg.role !== 'system')) {
            const inferredRole = idx % 2 === 0 ? 'user' : 'assistant';
            console.warn(`[AI Assistant] 消息[${idx}] role 字段无效${sourceLabel} (${msg.role})，推断为: ${inferredRole}`);
            msg.role = inferredRole;
        }

        sanitizedMessages.push(msg);
    });

    if (chatData) {
        chatData.messages = sanitizedMessages;
    }

    return sanitizedMessages;
}

/** 生成唯一的聊天 ID */
function generateChatId() {
    return 'chat_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5);
}

/** 格式化时间戳 */
export function formatDate(ms) {
    const d = new Date(ms);
    return `${d.getMonth() + 1}-${d.getDate()} ${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`;
}

/**
 * 更新索引中某个会话的条目（存在则更新，不存在则新增）
 * @param {Object} chatData - 会话数据 { id, title, updatedAt, messages }
 */
function _updateIndexEntry(chatData) {
    if (!chatData || !chatData.id) return;
    const idx = chatIndex.chatList.findIndex(e => e.id === chatData.id);
    const entry = {
        id: chatData.id,
        title: chatData.title || '新对话',
        updatedAt: chatData.updatedAt || Date.now(),
        messageCount: (chatData.messages || []).length
    };
    if (idx >= 0) {
        chatIndex.chatList[idx] = entry;
    } else {
        chatIndex.chatList.unshift(entry);
    }
}

// ═══════════════════════════════════════════════════════════
//  会话持久化（V2 分层保存）
// ═══════════════════════════════════════════════════════════

/**
 * 保存当前活动会话 + 索引到持久存储
 * V2：只保存索引层 + 当前会话层（不再全量序列化所有会话）
 */
export async function saveCurrentSessions() {
    if (!activeChat) return;

    _sanitizeChatMessages(activeChat, 'saveCurrentSessions');

    // 更新活动会话的时间戳和任务数据
    activeChat.updatedAt = Date.now();
    activeChat.taskData = serializeTaskManager();

    // 同步总结数据
    const mgr = getSummaryManager();
    if (mgr) {
        activeChat.summaryData = mgr.exportData();
    }

    // 更新索引中的对应条目
    _updateIndexEntry(activeChat);
    chatIndex.activeChatId = activeChat.id;

    // 分别保存会话层和索引层
    try {
        await saveChatData(activeChat.id, activeChat);
        await dbSaveChatIndex(chatIndex);
    } catch (err) {
        console.error('[AI Assistant] 保存会话失败:', err);
    }
}

/**
 * 同步任务状态并保存聊天记录
 * 确保每次保存都带上最新的任务数据
 * V2：保存当前会话数据 + 索引
 * @param {object} [chatData] - 可选的会话数据对象，如果提供则保存指定会话，否则保存全局 activeChat
 */
export async function syncAndSave(chatData) {
    const targetChat = chatData || activeChat;
    if (!targetChat) return;

    _sanitizeChatMessages(targetChat, 'syncAndSave');

    targetChat.taskData = serializeTaskManager();
    targetChat.updatedAt = Date.now();

    // 同步总结数据
    const mgr2 = getSummaryManager();
    if (mgr2 && targetChat === activeChat) {
        targetChat.summaryData = mgr2.exportData();
    }

    // 更新索引中的对应条目
    _updateIndexEntry(targetChat);

    try {
        await saveChatData(targetChat.id, targetChat);
        await dbSaveChatIndex(chatIndex);
    } catch (err) {
        console.error('[AI Assistant] syncAndSave 失败:', err);
    }
}

// ═══════════════════════════════════════════════════════════
//  会话 CRUD
// ═══════════════════════════════════════════════════════════

/**
 * 开始新聊天
 * @param {Function} appendMessage - appendMessage 函数引用（避免循环依赖）
 */
export async function startNewChat(appendMessage) {
    // 中止正在进行的 AI 生成，清理流式输出状态
    _abortAndCleanupGeneration();
    _clearEditingState();

    // 先保存当前活动会话
    if (activeChat) {
        _sanitizeChatMessages(activeChat, 'startNewChat:saveOld');
        activeChat.taskData = serializeTaskManager();
        activeChat.updatedAt = Date.now();
        _updateIndexEntry(activeChat);
        try {
            await saveChatData(activeChat.id, activeChat);
        } catch (err) {
            console.error('[AI Assistant] 保存旧会话失败:', err);
        }
    }

    const newId = generateChatId();
    const newChatData = {
        id: newId,
        title: '新对话',
        updatedAt: Date.now(),
        taskData: null,
        messages: []
    };

    // 更新 V2 状态
    setActiveChat(newChatData); // 会同步 V1 兼容层
    chatIndex.activeChatId = newId;
    _updateIndexEntry(newChatData);

    dom.chatBody.empty();
    await appendMessage('system', `你好呀！我是${getAssistantDisplayName()} AI 助手，让我们开始新的对话吧！`);

    // 新对话时清空任务管理器状态
    clearTaskManager();

    // 重置总结管理器
    resetSummaryManager(newId);

    // 持久化
    try {
        await saveChatData(newId, newChatData);
        await dbSaveChatIndex(chatIndex);
    } catch (err) {
        console.error('[AI Assistant] 保存新会话失败:', err);
    }
}

/**
 * 切换到指定聊天（异步版本）
 * V2：先保存当前会话，再从会话层加载目标会话
 * @param {string} chatId - 目标聊天 ID
 * @param {Function} appendMessage - appendMessage 函数引用
 */
export async function switchChat(chatId, appendMessage) {
    // 检查索引中是否存在目标会话
    const targetEntry = chatIndex.chatList.find(e => e.id === chatId);
    if (!targetEntry) return;

    // 中止正在进行的 AI 生成，清理流式输出状态
    _abortAndCleanupGeneration();
    _clearEditingState();

    // 1. 保存当前活动会话
    if (activeChat) {
        _sanitizeChatMessages(activeChat, 'switchChat:saveOld');
        activeChat.taskData = serializeTaskManager();
        activeChat.updatedAt = Date.now();
        _updateIndexEntry(activeChat);
        try {
            await saveChatData(activeChat.id, activeChat);
        } catch (err) {
            console.error('[AI Assistant] 保存当前会话失败:', err);
        }
    }

    // 2. 从会话层加载目标会话
    let targetChat = null;
    try {
        targetChat = await getChatData(chatId);
    } catch (err) {
        console.error(`[AI Assistant] 加载会话 ${chatId} 失败:`, err);
        return;
    }

    if (!targetChat) {
        console.warn(`[AI Assistant] 会话 ${chatId} 数据不存在`);
        return;
    }

    // 3. 更新 V2 状态
    setActiveChat(targetChat); // 会同步 V1 兼容层
    chatIndex.activeChatId = chatId;

    // 从目标会话恢复任务状态
    restoreTaskManager(targetChat.taskData || null);

    // 恢复总结数据
    resetSummaryManager(chatId);
    if (targetChat.summaryData) {
        const newMgr = getSummaryManager();
        if (newMgr) {
            newMgr.importData(targetChat.summaryData);
        }
    }

    // 4. 渲染消息
    const msgs = _sanitizeChatMessages(targetChat, `switchChat:${chatId}`);
    console.log('[AI Assistant] 开始渲染会话:', chatId, ', 消息数:', msgs.length);

    // 强制清空聊天区域
    if (!dom.chatBody || !dom.chatBody.length) {
        console.error('[AI Assistant] switchChat: dom.chatBody 不存在！');
        return;
    }

    dom.chatBody.empty();

    if (msgs.length === 0) {
        await appendMessage('system', `你好呀！我是${getAssistantDisplayName()} AI 助手，让我们开始新的对话吧！`);
    } else {
        // 使用分页渲染替代原有的批量渲染
        await renderMessagesWithPagination(msgs, appendMessage, true);
    }

    console.log('[AI Assistant] 会话渲染完成，最终消息数:', dom.chatBody.children().length);
    dom.historyPanel.removeClass('active');

    // 5. 保存索引（更新 activeChatId）
    try {
        await dbSaveChatIndex(chatIndex);
    } catch (err) {
        console.error('[AI Assistant] 保存索引失败:', err);
    }
}

/**
 * 渲染当前活动会话的消息（内部辅助，用于 initChatSession）
 * @param {Function} appendMessage
 */
export async function _renderActiveChat(appendMessage) {
    if (!activeChat) {
        console.warn('[AI Assistant] _renderActiveChat: activeChat 为空');
        return;
    }

    console.log('[AI Assistant] 开始渲染活动会话:', activeChat.id, ', 消息数:', activeChat.messages?.length);

    // 强制清空聊天区域
    if (!dom.chatBody || !dom.chatBody.length) {
        console.error('[AI Assistant] _renderActiveChat: dom.chatBody 不存在！');
        return;
    }

    dom.chatBody.empty();

    const msgs = _sanitizeChatMessages(activeChat, `_renderActiveChat:${activeChat.id}`);

    if (msgs.length === 0) {
        await appendMessage('system', `你好呀！我是${getAssistantDisplayName()} AI 助手，让我们开始新的对话吧！`);
        return;
    }

    // 使用分页渲染替代原有的批量渲染
    await renderMessagesWithPagination(msgs, appendMessage, true);
    console.log('[AI Assistant] 活动会话渲染完成，最终消息数:', dom.chatBody.children().length);
}

// ═══════════════════════════════════════════════════════════
//  初始化会话
// ═══════════════════════════════════════════════════════════

/**
 * 初始化聊天会话记录（从数据库加载）
 * V2：先尝试加载索引，如不存在则检测 V1 数据并迁移
 * @param {Function} appendMessage - appendMessage 函数引用
 */
export async function initChatSession(appendMessage) {
    // 严格防止重复初始化
    if (initialized) {
        console.log('[AI Assistant] 会话已初始化，跳过重复初始化');
        return;
    }
    setInitialized(true);

    try {
        // 1. 尝试加载 V2 索引
        const existingIndex = await dbGetChatIndex();

        if (existingIndex && existingIndex.version === 2) {
            // ── V2 索引存在，直接使用 ──
            setChatIndex(existingIndex);
            setV2Ready(true);
            console.log('[AI Assistant] V2 索引加载成功，共', existingIndex.chatList.length, '个会话');

            // 加载活动会话
            if (existingIndex.activeChatId) {
                try {
                    const chatData = await getChatData(existingIndex.activeChatId);
                    if (chatData) {
                        setActiveChat(chatData);
                        restoreTaskManager(chatData.taskData || null);
                        // 恢复总结数据
                        resetSummaryManager(chatData.id);
                        if (chatData.summaryData) {
                            const initMgr = getSummaryManager();
                            if (initMgr) initMgr.importData(chatData.summaryData);
                        }
                    } else {
                        // 活动会话数据丢失，清空引用
                        existingIndex.activeChatId = null;
                    }
                } catch (err) {
                    console.error('[AI Assistant] 加载活动会话失败:', err);
                    existingIndex.activeChatId = null;
                }
            }

        } else {
            // ── V2 索引不存在，检测 V1 旧数据 ──
            console.log('[AI Assistant] 未找到 V2 索引，检测 V1 旧数据...');
            const oldHistory = await getAiChatHistory();

            if (oldHistory && ((Array.isArray(oldHistory) && oldHistory.length > 0) || oldHistory.chats)) {
                // 存在 V1 数据，执行迁移
                console.log('[AI Assistant] 检测到 V1 数据，开始迁移...');
                try {
                    const result = await migrateV1ToV2();
                    if (result.success) {
                        console.log(`[AI Assistant] 迁移成功: ${result.migratedChats} 个会话, ${result.migratedImages} 张图片`);
                        // 重新加载迁移后的索引
                        const migratedIndex = await dbGetChatIndex();
                        if (migratedIndex) {
                            setChatIndex(migratedIndex);
                            // 加载活动会话
                            if (migratedIndex.activeChatId) {
                                const chatData = await getChatData(migratedIndex.activeChatId);
                                if (chatData) {
                                    setActiveChat(chatData);
                                    restoreTaskManager(chatData.taskData || null);
                                    // 恢复总结数据
                                    resetSummaryManager(chatData.id);
                                    if (chatData.summaryData) {
                                        const migMgr = getSummaryManager();
                                        if (migMgr) migMgr.importData(chatData.summaryData);
                                    }
                                }
                            }
                        }
                    } else {
                        console.error('[AI Assistant] V1→V2 迁移失败:', result.error);
                    }
                } catch (migErr) {
                    console.error('[AI Assistant] 迁移过程出错:', migErr);
                }
            } else {
                // 无任何旧数据，初始化空索引
                console.log('[AI Assistant] 无历史数据，初始化空索引');
                setChatIndex({ version: 2, activeChatId: null, chatList: [] });
            }

            setV2Ready(true);
        }

    } catch (err) {
        console.error('[AI Assistant] 加载聊天记录失败', err);
        setChatIndex({ version: 2, activeChatId: null, chatList: [] });
        setV2Ready(true);
    }

    // 渲染现场
    if (!activeChat) {
        await startNewChat(appendMessage);
    } else {
        // 活动会话已加载，直接渲染
        await _renderActiveChat(appendMessage);
    }
}

// ═══════════════════════════════════════════════════════════
//  历史记录面板
// ═══════════════════════════════════════════════════════════

/**
 * 内联重命名：将标题 span 替换为 input，完成后保存
 * @param {jQuery} $titleSpan - 标题 span 元素
 * @param {Object} entry - chatIndex.chatList 中的条目
 * @param {Function} appendMessage - appendMessage 函数引用
 */
function _startRenameInline($titleSpan, entry, appendMessage) {
    // 防止重复触发
    if ($titleSpan.parent().find('.st-chatu8-ai-history-rename-input').length > 0) return;

    const currentTitle = entry.title || '新对话';
    const $input = $(`<input type="text" class="st-chatu8-ai-history-rename-input" />`);
    $input.val(currentTitle);

    $titleSpan.hide().after($input);
    $input.focus().select();

    const finishRename = async () => {
        const newTitle = $input.val().trim();
        $input.remove();
        $titleSpan.show();

        if (!newTitle || newTitle === currentTitle) return;

        // 更新索引中的标题
        const idx = chatIndex.chatList.findIndex(e => e.id === entry.id);
        if (idx >= 0) {
            chatIndex.chatList[idx].title = newTitle;
        }
        entry.title = newTitle;

        // 如果是当前活动会话，同步更新内存中的 activeChat
        if (activeChat && activeChat.id === entry.id) {
            activeChat.title = newTitle;
            activeChat.updatedAt = Date.now();
            try {
                await saveChatData(activeChat.id, activeChat);
            } catch (err) {
                console.error('[AI Assistant] 保存重命名的活动会话失败:', err);
            }
        } else {
            // 非活动会话，按需加载并更新标题
            try {
                const chatData = await getChatData(entry.id);
                if (chatData) {
                    chatData.title = newTitle;
                    chatData.updatedAt = Date.now();
                    await saveChatData(entry.id, chatData);
                }
            } catch (err) {
                console.error(`[AI Assistant] 保存重命名会话 ${entry.id} 失败:`, err);
            }
        }

        // 保存索引
        try {
            await dbSaveChatIndex(chatIndex);
        } catch (err) {
            console.error('[AI Assistant] 保存索引失败:', err);
        }

        // 刷新列表
        renderHistoryList(appendMessage);
        toastr?.success('已重命名为: ' + newTitle);
    };

    let finished = false;
    const safeFinish = () => {
        if (finished) return;
        finished = true;
        finishRename();
    };

    $input.on('keydown', function (e) {
        if (e.key === 'Enter') {
            e.preventDefault();
            safeFinish();
        } else if (e.key === 'Escape') {
            e.preventDefault();
            $input.remove();
            $titleSpan.show();
            finished = true;
        }
    });

    $input.on('blur', function () {
        // 短延迟以防 blur 和 keydown 冲突
        setTimeout(safeFinish, 150);
    });
}

/**
 * 渲染历史记录列表
 * V2：从 chatIndex.chatList 渲染，无需加载所有会话消息
 * @param {Function} appendMessage - appendMessage 函数引用
 */
export function renderHistoryList(appendMessage) {
    dom.historyList.empty();

    // chatIndex.chatList 已按 updatedAt 排列，但此处再确保排序
    const chatArray = [...chatIndex.chatList].sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));

    if (chatArray.length === 0) {
        dom.historyList.append('<div style="text-align: center; color: var(--st-chatu8-text-secondary); margin-top: 20px;">暂无聊天记录</div>');
        return;
    }

    chatArray.forEach(entry => {
        const isActive = entry.id === chatIndex.activeChatId ? 'active-chat' : '';
        const html = `
            <div class="st-chatu8-ai-history-item ${isActive}" data-id="${entry.id}">
                <div class="st-chatu8-ai-history-content">
                    <input type="checkbox" class="st-chatu8-ai-history-checkbox" data-id="${entry.id}">
                    <div class="st-chatu8-ai-history-info">
                        <span class="st-chatu8-ai-history-title">${escapeHTML(entry.title)}</span>
                        <span class="st-chatu8-ai-history-time">${formatDate(entry.updatedAt)}${entry.messageCount != null ? ` · ${entry.messageCount}条` : ''}</span>
                    </div>
                </div>
                <div class="st-chatu8-ai-history-actions">
                    <i class="fa-solid fa-pen st-chatu8-ai-history-rename" data-id="${entry.id}" title="重命名"></i>
                    <i class="fa-solid fa-trash-can st-chatu8-ai-history-delete" data-id="${entry.id}" title="删除此对话"></i>
                </div>
            </div>
        `;
        const $item = $(html);

        // 点击卡片主体切换对话
        $item.find('.st-chatu8-ai-history-info').on('click', function (e) {
            e.stopPropagation();
            // 如果正在编辑中，不触发切换
            if ($(this).find('.st-chatu8-ai-history-rename-input').length > 0) return;
            switchChat(entry.id, appendMessage);
        });

        // 双击标题进入重命名模式
        $item.find('.st-chatu8-ai-history-title').on('dblclick', function (e) {
            e.stopPropagation();
            _startRenameInline($(this), entry, appendMessage);
        });

        // 复选框点击事件
        $item.find('.st-chatu8-ai-history-checkbox').on('click', function (e) {
            e.stopPropagation();
            const $checkbox = $(this);
            const $historyItem = $checkbox.closest('.st-chatu8-ai-history-item');
            if ($checkbox.is(':checked')) {
                $historyItem.addClass('selected');
            } else {
                $historyItem.removeClass('selected');
            }
        });

        // 点击重命名按钮
        $item.find('.st-chatu8-ai-history-rename').on('click', function (e) {
            e.stopPropagation();
            const $titleSpan = $item.find('.st-chatu8-ai-history-title');
            _startRenameInline($titleSpan, entry, appendMessage);
        });

        // 点击垃圾桶删除（级联删除图片层 + 会话层）
        $item.find('.st-chatu8-ai-history-delete').on('click', async function (e) {
            e.stopPropagation();
            if (confirm('确定要永久删除这条聊天记录吗？')) {
                const deleteId = entry.id;
                try {
                    // 1. 删除图片层关联数据
                    await deleteChatImagesByChatId(deleteId);
                    // 2. 删除会话层数据
                    await deleteChatData(deleteId);
                } catch (err) {
                    console.error(`[AI Assistant] 删除会话 ${deleteId} 失败:`, err);
                }

                // 3. 从索引中移除
                chatIndex.chatList = chatIndex.chatList.filter(e => e.id !== deleteId);

                // 4. 如果删除的是当前活动会话，开启新对话
                if (chatIndex.activeChatId === deleteId) {
                    chatIndex.activeChatId = null;
                    setActiveChat(null);
                    await startNewChat(appendMessage);
                }

                // 5. 保存更新后的索引
                try {
                    await dbSaveChatIndex(chatIndex);
                } catch (err) {
                    console.error('[AI Assistant] 保存索引失败:', err);
                }

                renderHistoryList(appendMessage);
            }
        });

        dom.historyList.append($item);
    });
}

// ═══════════════════════════════════════════════════════════
//  初始化会话面板事件
// ═══════════════════════════════════════════════════════════

/**
 * 初始化会话管理相关的事件绑定
 * @param {Function} appendMessage - appendMessage 函数引用
 */
export function initSessionEvents(appendMessage) {
    const {
        dialog, newChatBtn, historyBtn, historyPanel, historyCloseBtn,
        historyList, exportChatBtn, selectAllBtn, deselectAllBtn,
        settingsPanel, inputArea
    } = dom;

    // 图标点击：切换对话框显示/隐藏
    let isRendering = false; // 防止重复渲染

    // 先解绑旧的事件监听器，避免重复绑定
    $(document).off('click', '#st-chatu8-ai-trigger');

    $(document).on('click', '#st-chatu8-ai-trigger', async function (e) {
        const wasActive = dialog.hasClass('active');
        dialog.toggleClass('active');

        if (dialog.hasClass('active') && !wasActive) {
            if (isRendering) {
                console.log('[AI Assistant] 正在渲染中，跳过重复请求');
                return;
            }

            isRendering = true;
            addLog('[UI] 唤醒智绘姬AI助手');

            // 初次打开时，计算居中位置
            const dialogWidth = dialog.outerWidth();
            const dialogHeight = dialog.outerHeight();
            const viewportWidth = window.innerWidth;
            const viewportHeight = window.innerHeight;

            const centerLeft = (viewportWidth - dialogWidth) / 2;
            const centerTop = (viewportHeight - dialogHeight) / 2;

            dialog.css({
                left: Math.max(0, centerLeft) + 'px',
                top: Math.max(0, centerTop) + 'px'
            });

            checkAndShowSettings();

            // 使用 requestAnimationFrame 确保对话框先渲染出来再加载历史数据
            requestAnimationFrame(() => {
                // 只在首次打开时初始化会话，后续打开只需重新渲染当前会话
                if (!initialized) {
                    initChatSession(appendMessage).then(() => {
                        setTimeout(() => inputArea.focus(), 100);
                        isRendering = false;
                    }).catch(err => {
                        console.error('[AI Assistant] 初始化会话失败:', err);
                        isRendering = false;
                    });
                } else {
                    // 已初始化过，只需重新渲染当前活动会话
                    _renderActiveChat(appendMessage).then(() => {
                        setTimeout(() => inputArea.focus(), 100);
                        isRendering = false;
                    }).catch(err => {
                        console.error('[AI Assistant] 渲染会话失败:', err);
                        isRendering = false;
                    });
                }
            });
        }
    });

    // 新建聊天
    newChatBtn.on('click', async function () {
        if (confirm('确定要保留当前聊天，开启新对话吗？')) {
            await startNewChat(appendMessage);
            toastr?.success('已开启新对话。');
        }
    });

    // 历史记录面板控制
    historyBtn.on('click', function () {
        settingsPanel.removeClass('active');
        renderHistoryList(appendMessage);
        historyPanel.addClass('active');
    });

    historyCloseBtn.on('click', function () {
        historyPanel.removeClass('active');
    });

    // 全选聊天记录
    selectAllBtn.on('click', function () {
        historyList.find('.st-chatu8-ai-history-checkbox').prop('checked', true).trigger('change');
        historyList.find('.st-chatu8-ai-history-item').addClass('selected');
    });

    // 取消全选
    deselectAllBtn.on('click', function () {
        historyList.find('.st-chatu8-ai-history-checkbox').prop('checked', false).trigger('change');
        historyList.find('.st-chatu8-ai-history-item').removeClass('selected');
    });

    // 导出选中的聊天记录（V2：按需加载会话 + 内联图片还原）
    exportChatBtn.on('click', async function () {
        try {
            const selectedCheckboxes = historyList.find('.st-chatu8-ai-history-checkbox:checked');

            if (selectedCheckboxes.length === 0) {
                toastr?.warning('请先选择要导出的聊天记录！');
                return;
            }

            const selectedChatIds = [];
            selectedCheckboxes.each(function () {
                selectedChatIds.push($(this).data('id'));
            });

            // 按需加载每个选中的会话
            const selectedChats = {};
            for (const chatId of selectedChatIds) {
                let chatData = null;

                // 如果是当前活动会话，直接使用内存中的数据
                if (activeChat && activeChat.id === chatId) {
                    chatData = activeChat;
                } else {
                    try {
                        chatData = await getChatData(chatId);
                    } catch (err) {
                        console.error(`[AI Assistant] 加载会话 ${chatId} 失败:`, err);
                        continue;
                    }
                }

                if (!chatData) continue;

                // 收集该会话中所有 imageRefs
                const allRefs = [];
                (chatData.messages || []).forEach(msg => {
                    if (Array.isArray(msg.imageRefs)) {
                        allRefs.push(...msg.imageRefs);
                    }
                });

                // 批量加载图片
                let imageMap = {};
                if (allRefs.length > 0) {
                    try {
                        imageMap = await getChatImagesBatch(allRefs);
                    } catch (err) {
                        console.error(`[AI Assistant] 加载会话 ${chatId} 图片失败:`, err);
                    }
                }

                // 将 imageRefs 还原为内联图片格式（用于导出兼容性）
                const exportMessages = (chatData.messages || []).map(msg => {
                    const exportMsg = { role: msg.role, content: msg.content };
                    if (msg.timestamp) exportMsg.timestamp = msg.timestamp;

                    if (Array.isArray(msg.imageRefs) && msg.imageRefs.length > 0) {
                        // 还原为 V1 多模态格式用于导出
                        const contentParts = [];
                        if (msg.content) {
                            contentParts.push({ type: 'text', text: msg.content });
                        }
                        const imagesList = [];
                        for (const refId of msg.imageRefs) {
                            const base64 = imageMap[refId];
                            if (base64) {
                                contentParts.push({
                                    type: 'image_url',
                                    image_url: { url: base64 }
                                });
                                imagesList.push({ data: base64, name: '图片' });
                            }
                        }
                        if (contentParts.length > 0) {
                            exportMsg.content = contentParts.length === 1 && contentParts[0].type === 'text'
                                ? contentParts[0].text
                                : contentParts;
                        }
                        if (imagesList.length > 0) {
                            exportMsg.images = imagesList;
                        }
                    }

                    return exportMsg;
                });

                selectedChats[chatId] = {
                    id: chatData.id,
                    title: chatData.title,
                    updatedAt: chatData.updatedAt,
                    messages: exportMessages,
                    taskData: chatData.taskData
                };
            }

            if (Object.keys(selectedChats).length === 0) {
                toastr?.warning('未能加载任何选中的聊天记录！');
                return;
            }

            const exportData = {
                version: '2.0',
                exportDate: new Date().toISOString(),
                exportCount: Object.keys(selectedChats).length,
                chats: selectedChats
            };

            const jsonString = JSON.stringify(exportData, null, 2);
            const blob = new Blob([jsonString], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;

            const now = new Date();
            const dateStr = `${now.getFullYear()}${(now.getMonth() + 1).toString().padStart(2, '0')}${now.getDate().toString().padStart(2, '0')}`;
            const timeStr = `${now.getHours().toString().padStart(2, '0')}${now.getMinutes().toString().padStart(2, '0')}${now.getSeconds().toString().padStart(2, '0')}`;
            a.download = `智绘姬聊天记录_${dateStr}_${timeStr}.json`;

            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);

            toastr?.success(`已导出 ${Object.keys(selectedChats).length} 条聊天记录！`);
        } catch (error) {
            console.error('[AI Assistant] 导出聊天记录失败:', error);
            toastr?.error(`导出失败: ${error.message}`);
        }
    });
}
