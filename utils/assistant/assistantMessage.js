/**
 * assistantMessage.js
 * 
 * 消息渲染：appendMessage、appendSystemEmptyMessage、finalizeAssistantMessage、
 * showImageFullscreen、parseAndRenderAskChoice、handleEditMessage、
 * handleContinueFromMessage、handleRegenerateMessage、adjustInputHeight、
 * createThrottledUIUpdater、updateSendButtonState 等。
 */

import {
    dom, activeChat, isAiGenerating,
    currentSystemMsgElement, currentSystemMsgContent,
    setCurrentSystemMsgElement, setCurrentSystemMsgContent,
    selectedImages, setSelectedImages
} from './assistantContext.js';
import { getChatImagesBatch } from '../configDatabase.js';
import { escapeHTML, escapeHTMLWithBreaks, renderMarkdown, renderThinkingPanel, renderThinkingIndicator } from './assistantUtils.js';
import { parseThinkingContent } from '../aiThinkingParser.js';
import { removeThinkBlocks } from '../aiSettingsBridge.js';
import { renderImagePreview } from './assistantImage.js';
import { getCurrentCharAvatar, getCurrentUserAvatar, generateAvatarHTML, getAssistantDisplayName } from './assistantAvatar.js';

/**
 * 移除 <disclaimer>...</disclaimer> 标签及其内容
 * disclaimer 仅作为附加合约存在，不参与任何显示或其他作用
 * @param {string} text
 * @returns {string}
 */
function removeDisclaimerBlocks(text) {
    if (!text || typeof text !== 'string') return text;
    return text.replace(/<disclaimer>[\s\S]*?<\/disclaimer>/gi, '').trim();
}
import { handleTTSButtonClick } from './assistantTTS.js';
import { syncAndSave } from './assistantSession.js';
import { incrementUnreadCount, isNearBottom } from './assistantScrollManager.js';

// ═══════════════════════════════════════════════════════════
//  发送按钮状态
// ═══════════════════════════════════════════════════════════

/**
 * 更新发送按钮的状态（发送/停止）
 */
export function updateSendButtonState() {
    if (isAiGenerating) {
        dom.sendBtn.html('<i class="fa-solid fa-stop"></i>');
        dom.sendBtn.addClass('generating');
        dom.sendBtn.attr('title', '停止生成');
    } else {
        dom.sendBtn.html('<i class="fa-solid fa-paper-plane"></i>');
        dom.sendBtn.removeClass('generating');
        dom.sendBtn.attr('title', '发送');
    }
}

// ═══════════════════════════════════════════════════════════
//  输入框高度自适应
// ═══════════════════════════════════════════════════════════

/**
 * 自适应输入框高度
 */
export function adjustInputHeight() {
    dom.inputArea[0].style.height = 'auto';
    const newHeight = Math.min(dom.inputArea[0].scrollHeight, 100);
    dom.inputArea[0].style.height = newHeight + 'px';
}

// ═══════════════════════════════════════════════════════════
//  AskChoice 解析
// ═══════════════════════════════════════════════════════════

/**
 * 解析 <AskChoice> 标签并渲染为选项按钮 HTML
 * @param {string} text
 * @returns {{ cleanedText: string, choiceHtml: string }}
 */
export function parseAndRenderAskChoice(text) {
    text = removeThinkBlocks(text);

    const choiceMatch = text.match(/<AskChoice>([\s\S]*?)<\/AskChoice>/i);
    if (!choiceMatch) return { cleanedText: text, choiceHtml: '' };

    let options = [];
    try {
        options = JSON.parse(choiceMatch[1]);
        if (!Array.isArray(options)) options = [];
    } catch (e) {
        options = choiceMatch[1].split('\n').map(s => s.trim()).filter(Boolean);
    }

    const cleanedText = text.replace(/<AskChoice>[\s\S]*?<\/AskChoice>/gi, '').trim();

    if (options.length === 0) return { cleanedText, choiceHtml: '' };

    let choiceHtml = '<div class="st-chatu8-ai-ask-choice">';
    choiceHtml += '<div class="st-chatu8-ai-ask-choice-label"><i class="fa-solid fa-hand-pointer"></i> 请选择：</div>';
    choiceHtml += '<div class="st-chatu8-ai-ask-choice-options">';
    options.forEach((opt, idx) => {
        const label = typeof opt === 'object' ? (opt.label || opt.text || JSON.stringify(opt)) : String(opt);
        choiceHtml += `<button class="st-chatu8-ai-ask-choice-btn" data-choice-index="${idx}" data-choice-value="${escapeHTML(label)}">${escapeHTML(label)}</button>`;
    });
    choiceHtml += '</div>';
    choiceHtml += '<div class="st-chatu8-ai-ask-choice-hint">点击选项发送，或直接输入消息取消选择</div>';
    choiceHtml += '</div>';

    return { cleanedText, choiceHtml };
}

/**
 * 清除所有未处理的 AskChoice 选项
 */
export function dismissAskChoices() {
    dom.chatBody.find('.st-chatu8-ai-ask-choice').addClass('dismissed');
}

// ═══════════════════════════════════════════════════════════
//  空消息气泡
// ═══════════════════════════════════════════════════════════

/**
 * 追加一个空的系统消息气泡（用于流式输出填充）
 */
export async function appendSystemEmptyMessage() {
    console.log('[DEBUG-MSG] ▶ appendSystemEmptyMessage() 开始');
    console.log('[DEBUG-MSG]   dom.chatBody 存在:', !!dom.chatBody, ', 长度:', dom.chatBody?.length);

    const charAvatar = await getCurrentCharAvatar();
    const icon = generateAvatarHTML(charAvatar, getAssistantDisplayName());

    const html = `
        <div class="st-chatu8-ai-msg system-msg">
            <div class="msg-avatar">${icon}</div>
            <div class="msg-content"></div>
        </div>
    `;
    const $elem = $(html);
    dom.chatBody.append($elem);
    dom.chatBody.scrollTop(dom.chatBody[0].scrollHeight);

    setCurrentSystemMsgElement($elem);
    setCurrentSystemMsgContent($elem.find('.msg-content'));

    // 调试：检查元素是否正确附加到 DOM
    const isInDOM = $.contains(document, $elem[0]);
    const contentEl = $elem.find('.msg-content');
    console.log('[DEBUG-MSG]   消息气泡已创建, 在DOM中:', isInDOM);
    console.log('[DEBUG-MSG]   currentSystemMsgContent 存在:', !!contentEl.length, ', 在DOM中:', $.contains(document, contentEl[0]));
    console.log('[DEBUG-MSG] ◀ appendSystemEmptyMessage() 结束');
}

// ═══════════════════════════════════════════════════════════
//  消息完成时添加操作按钮
// ═══════════════════════════════════════════════════════════

/**
 * 为流式生成完成的 AI 消息气泡补上 data-msg-index 属性和操作按钮
 * @param {number} messageIndex - 该消息在 activeChat.messages 中的索引
 * @param {Function} handleRegenerateMessage - 重新生成回调
 */
export function finalizeAssistantMessage(messageIndex, handleRegenerateMessage) {
    if (!currentSystemMsgElement) return;

    currentSystemMsgElement.attr('data-msg-index', messageIndex);

    // 添加楼层号标识
    if (!currentSystemMsgElement.find('.st-chatu8-ai-msg-floor').length) {
        currentSystemMsgElement.prepend(`<span class="st-chatu8-ai-msg-floor">#${messageIndex + 1}</span>`);
    }

    const actionButtons = `
        <div class="st-chatu8-ai-msg-actions">
            <button class="st-chatu8-ai-msg-tts" data-index="${messageIndex}" title="朗读此回复">
                <i class="fa-solid fa-volume-up"></i>
            </button>
            <button class="st-chatu8-ai-msg-regenerate" data-index="${messageIndex}" title="重新生成此回复">
                <i class="fa-solid fa-rotate-right"></i>
            </button>
        </div>
    `;
    currentSystemMsgElement.append(actionButtons);

    currentSystemMsgElement.find('.st-chatu8-ai-msg-regenerate').on('click', function () {
        handleRegenerateMessage(messageIndex);
    });

    currentSystemMsgElement.find('.st-chatu8-ai-msg-tts').on('click', function () {
        handleTTSButtonClick(messageIndex);
    });
}

// ═══════════════════════════════════════════════════════════
//  全屏图片查看
// ═══════════════════════════════════════════════════════════

/**
 * 全屏查看图片
 * @param {string} imageUrl
 */
export function showImageFullscreen(imageUrl) {
    const overlay = $(`
        <div class="st-chatu8-ai-image-fullscreen-overlay" style="
            position: fixed;
            top: 0;
            left: 0;
            width: 100vw;
            height: 100vh;
            background: rgba(0, 0, 0, 0.95);
            z-index: 99999;
            display: flex;
            align-items: center;
            justify-content: center;
            cursor: zoom-out;
            animation: fadeIn 0.2s ease;
        ">
            <img src="${imageUrl}" style="
                max-width: 95vw;
                max-height: 95vh;
                object-fit: contain;
                border-radius: 8px;
                box-shadow: 0 8px 32px rgba(0, 0, 0, 0.5);
                animation: zoomIn 0.3s ease;
            " />
            <div style="
                position: absolute;
                top: 20px;
                right: 20px;
                color: white;
                font-size: 32px;
                cursor: pointer;
                background: rgba(0, 0, 0, 0.5);
                width: 48px;
                height: 48px;
                border-radius: 50%;
                display: flex;
                align-items: center;
                justify-content: center;
                transition: background 0.2s;
            " class="st-chatu8-ai-fullscreen-close">
                <i class="fa-solid fa-times"></i>
            </div>
        </div>
    `);

    if (!$('#st-chatu8-ai-fullscreen-styles').length) {
        $('head').append(`
            <style id="st-chatu8-ai-fullscreen-styles">
                @keyframes fadeIn {
                    from { opacity: 0; }
                    to { opacity: 1; }
                }
                @keyframes zoomIn {
                    from { transform: scale(0.8); opacity: 0; }
                    to { transform: scale(1); opacity: 1; }
                }
                .st-chatu8-ai-fullscreen-close:hover {
                    background: rgba(255, 255, 255, 0.2) !important;
                }
            </style>
        `);
    }

    overlay.on('click', function (e) {
        if (e.target === this || $(e.target).closest('.st-chatu8-ai-fullscreen-close').length) {
            overlay.fadeOut(200, () => overlay.remove());
        }
    });

    $(document).on('keydown.fullscreen', function (e) {
        if (e.key === 'Escape') {
            overlay.fadeOut(200, () => overlay.remove());
            $(document).off('keydown.fullscreen');
        }
    });

    $('body').append(overlay);
}

// ═══════════════════════════════════════════════════════════
//  主消息渲染函数
// ═══════════════════════════════════════════════════════════

/**
 * 渲染一条消息到聊天面板
 * @param {string} role - 'user' | 'assistant' | 'system'
 * @param {string} text - 消息文本
 * @param {Array|null} images - 图片数组
 * @param {number|null} messageIndex - 消息索引
 * @param {boolean} skipScroll - 是否跳过滚动
 * @param {object} callbacks - 回调函数集合 { handleEditMessage, handleContinueFromMessage, handleRegenerateMessage, handleSend }
 */
export async function appendMessage(role, text, images = null, messageIndex = null, skipScroll = false, callbacks = {}) {
    // 动态获取头像
    let icon;
    if (role === 'system' || role === 'assistant') {
        const charAvatar = await getCurrentCharAvatar();
        icon = generateAvatarHTML(charAvatar, getAssistantDisplayName());
    } else {
        const userAvatar = await getCurrentUserAvatar();
        icon = generateAvatarHTML(userAvatar, 'User');
    }
    const cssClass = role === 'system' || role === 'assistant' ? 'system-msg' : 'user-msg';

    let innerContent = '';

    // 如果有图片，先渲染图片
    if (images && images.length > 0) {
        innerContent += '<div class="st-chatu8-ai-message-images">';
        images.forEach(img => {
            innerContent += `<img src="${img.data}" alt="${escapeHTML(img.name)}" class="st-chatu8-ai-message-image" style="cursor: zoom-in;" data-fullscreen-url="${img.data}" />`;
        });
        innerContent += '</div>';
    }

    // Parse thinking content first (for assistant messages)
    if (role === 'assistant' && typeof text === 'string') {
        const thinkingResult = parseThinkingContent(text);

        if (thinkingResult.hasThinking) {
            thinkingResult.thinkingBlocks.forEach(block => {
                innerContent += renderThinkingPanel(block.content);
            });
            text = thinkingResult.cleanedText;
        }
    }

    // 如果是系统注入的检索结果
    if (role === 'user' && typeof text === 'string' && (text.includes('【系统自动回复检索】') || text.includes('【系统自动回复'))) {
        const summaryTitle = "🔧 内部工具查询与执行结果 (点击展开)";
        innerContent += `
            <details class="st-chatu8-ai-query-details">
                <summary class="st-chatu8-ai-query-summary"><i class="fa-solid fa-code" style="margin-right: 5px;"></i> ${summaryTitle}</summary>
                <pre class="st-chatu8-ai-query-content">${escapeHTML(text)}</pre>
            </details>
        `;
    } else if (role === 'assistant' && typeof text === 'string') {
        // 先提取 <think> 块
        const thinkingResult = parseThinkingContent(text);

        // 如果有思考块，渲染思考面板
        if (thinkingResult.hasThinking) {
            thinkingResult.thinkingBlocks.forEach(block => {
                innerContent += renderThinkingPanel(block.content);
            });
        }

        // 使用去除思考块后的文本继续处理
        text = thinkingResult.cleanedText;

        // 提取 AskChoice 标签
        const askChoiceResult = parseAndRenderAskChoice(text);
        text = askChoiceResult.cleanedText;

        const queryMatch = text.match(/<SystemQuery>([\s\S]*?)<\/SystemQuery>/gi);
        const updateMatch = text.match(/<UpdateSettings>([\s\S]*?)<\/UpdateSettings>/gi);

        if (queryMatch || updateMatch) {
            let displayHtml = `<i><span style="color:var(--st-chatu8-text-secondary);">${getAssistantDisplayName()}调用了内部工具...</span></i>\n`;

            let rawCode = '';
            if (queryMatch) rawCode += queryMatch.join('\n');
            if (updateMatch) rawCode += updateMatch.join('\n');

            displayHtml += `
                <details class="st-chatu8-ai-query-details">
                    <summary class="st-chatu8-ai-query-summary"><i class="fa-solid fa-microchip" style="margin-right:5px"></i> 执行内部命令</summary>
                    <pre class="st-chatu8-ai-query-content">${escapeHTML(rawCode)}</pre>
                </details>
            `;

            let textWithoutTags = text.replace(/<SystemQuery>[\s\S]*?<\/SystemQuery>/gi, '').replace(/<UpdateSettings>[\s\S]*?<\/UpdateSettings>/gi, '').trim();
            // 最后移除 disclaimer 标签
            textWithoutTags = removeDisclaimerBlocks(textWithoutTags);
            if (textWithoutTags) {
                displayHtml = renderMarkdown(textWithoutTags) + '<br><br>' + displayHtml;
            }

            innerContent += displayHtml;
        } else {
            // 最后移除 disclaimer 标签
            text = removeDisclaimerBlocks(text);
            innerContent += renderMarkdown(text);
        }

        // 追加 AskChoice 选项按钮
        if (askChoiceResult.choiceHtml) {
            innerContent += askChoiceResult.choiceHtml;
        }
    } else {
        // 用户消息使用纯文本显示
        innerContent += escapeHTML(text).replace(/\n/g, '<br>');
    }

    // 为用户消息添加编辑和继续按钮，为 AI 消息添加重新生成按钮
    let actionButtons = '';
    if (role === 'user' && messageIndex !== null) {
        actionButtons = `
            <div class="st-chatu8-ai-msg-actions">
                <button class="st-chatu8-ai-msg-edit" data-index="${messageIndex}" title="编辑此消息">
                    <i class="fa-solid fa-pen"></i>
                </button>
                <button class="st-chatu8-ai-msg-continue" data-index="${messageIndex}" title="从此处继续对话">
                    <i class="fa-solid fa-play"></i>
                </button>
            </div>
        `;
    } else if ((role === 'assistant' || role === 'system') && messageIndex !== null) {
        actionButtons = `
            <div class="st-chatu8-ai-msg-actions">
                <button class="st-chatu8-ai-msg-tts" data-index="${messageIndex}" title="朗读此回复">
                    <i class="fa-solid fa-volume-up"></i>
                </button>
                <button class="st-chatu8-ai-msg-regenerate" data-index="${messageIndex}" title="重新生成此回复">
                    <i class="fa-solid fa-rotate-right"></i>
                </button>
            </div>
        `;
    }

    const floorBadge = messageIndex !== null ? `<span class="st-chatu8-ai-msg-floor">#${messageIndex + 1}</span>` : '';

    const html = `
        <div class="st-chatu8-ai-msg ${cssClass}" data-msg-index="${messageIndex !== null ? messageIndex : ''}">
            ${floorBadge}
            <div class="msg-avatar">${icon}</div>
            <div class="msg-content">${innerContent}</div>
            ${actionButtons}
        </div>
    `;
    const $msgElement = $(html);
    dom.chatBody.append($msgElement);

    // 绑定图片点击事件
    $msgElement.find('.st-chatu8-ai-message-image').on('click', function () {
        const imageUrl = $(this).attr('data-fullscreen-url') || $(this).attr('src');
        showImageFullscreen(imageUrl);
    });

    // 绑定按钮事件
    if (role === 'user' && messageIndex !== null) {
        $msgElement.find('.st-chatu8-ai-msg-edit').on('click', function () {
            if (callbacks.handleEditMessage) callbacks.handleEditMessage(messageIndex);
        });

        $msgElement.find('.st-chatu8-ai-msg-continue').on('click', function () {
            if (callbacks.handleContinueFromMessage) callbacks.handleContinueFromMessage(messageIndex);
        });
    } else if ((role === 'assistant' || role === 'system') && messageIndex !== null) {
        $msgElement.find('.st-chatu8-ai-msg-regenerate').on('click', function () {
            if (callbacks.handleRegenerateMessage) callbacks.handleRegenerateMessage(messageIndex);
        });
        $msgElement.find('.st-chatu8-ai-msg-tts').on('click', function () {
            handleTTSButtonClick(messageIndex);
        });
    }

    // 绑定 AskChoice 选项按钮点击事件
    $msgElement.find('.st-chatu8-ai-ask-choice-btn').on('click', function () {
        const choiceValue = $(this).attr('data-choice-value');
        if (!choiceValue) return;

        $(this).addClass('selected');
        $(this).closest('.st-chatu8-ai-ask-choice').addClass('answered');

        dom.inputArea.val(choiceValue);
        if (callbacks.handleSend) callbacks.handleSend();
    });

    // 自动滚动到最底部
    if (!skipScroll) {
        dom.chatBody.scrollTop(dom.chatBody[0].scrollHeight);
    } else {
        // 如果是批量渲染（skipScroll=true）且是 AI 消息，检查是否需要增加未读计数
        if ((role === 'assistant' || role === 'system') && !isNearBottom()) {
            incrementUnreadCount();
        }
    }
}

// ═══════════════════════════════════════════════════════════
//  编辑消息
// ═══════════════════════════════════════════════════════════

/**
 * 处理编辑消息
 * V2 适配：使用 activeChat 代替 chatSessions，支持 imageRefs 异步加载图片
 * @param {number} messageIndex
 */
export async function handleEditMessage(messageIndex) {
    if (!activeChat) return;

    const message = activeChat.messages[messageIndex];

    if (!message || message.role !== 'user') return;

    // V2 格式：content 始终为纯文本字符串
    // 兼容 V1 遗留：content 可能是多模态数组
    let textContent = '';
    if (Array.isArray(message.content)) {
        // V1 遗留格式
        const textPart = message.content.find(c => c.type === 'text');
        textContent = textPart ? textPart.text : '';
    } else {
        textContent = message.content || '';
    }

    dom.inputArea.val(textContent);
    adjustInputHeight();

    // V2: 通过 imageRefs 从图片层异步加载图片，还原为 selectedImages 格式
    if (Array.isArray(message.imageRefs) && message.imageRefs.length > 0) {
        try {
            const imageCache = await getChatImagesBatch(message.imageRefs);
            const restoredImages = message.imageRefs
                .filter(refId => imageCache[refId])
                .map(refId => ({ data: imageCache[refId], name: refId }));
            if (restoredImages.length > 0) {
                setSelectedImages(restoredImages);
                renderImagePreviewFromMessage();
            }
        } catch (err) {
            console.error('[AI Assistant] 编辑消息时加载图片失败:', err);
        }
    } else if (message.images && message.images.length > 0) {
        // V1 兼容：直接使用内嵌的 images 数组
        setSelectedImages([...message.images]);
        renderImagePreviewFromMessage();
    }

    dom.chatBody.find('.st-chatu8-ai-msg').removeClass('editing');
    dom.chatBody.find(`.st-chatu8-ai-msg[data-msg-index="${messageIndex}"]`).addClass('editing');

    dom.inputArea.focus();
    toastr?.info('消息已加载到输入框，修改后发送将替换原消息并重新生成后续对话');
    dom.inputArea.data('editing-index', messageIndex);
}

/**
 * 渲染图片预览（从消息恢复时使用）
 * 调用 assistantImage.js 中的 renderImagePreview 来实际渲染图片
 */
function renderImagePreviewFromMessage() {
    renderImagePreview();
}

// ═══════════════════════════════════════════════════════════
//  从某处继续对话
// ═══════════════════════════════════════════════════════════

/**
 * 处理从某条消息继续对话
 * V2 适配：使用 activeChat 代替 chatSessions
 * @param {number} messageIndex
 * @param {Function} switchChatFn - switchChat 函数引用
 */
export async function handleContinueFromMessage(messageIndex, switchChatFn) {
    if (!activeChat) return;

    if (messageIndex >= activeChat.messages.length) return;

    const confirmMsg = `确定要从第 ${messageIndex + 1} 条消息继续吗？这将删除该消息之后的所有对话。`;
    if (!confirm(confirmMsg)) return;

    activeChat.messages = activeChat.messages.slice(0, messageIndex + 1);
    activeChat.updatedAt = Date.now();

    await syncAndSave(activeChat);
    switchChatFn(activeChat.id);

    toastr?.success('已从此处继续对话，可以输入新消息了');
}

// ═══════════════════════════════════════════════════════════
//  流式输出节流 UI 更新器
// ═══════════════════════════════════════════════════════════

/**
 * 节流滚动到底部
 */
let _scrollRAFPending = false;
export function throttledScrollToBottom() {
    if (_scrollRAFPending) return;
    _scrollRAFPending = true;
    requestAnimationFrame(() => {
        _scrollRAFPending = false;
        if (dom.chatBody && dom.chatBody[0]) {
            dom.chatBody[0].scrollTop = dom.chatBody[0].scrollHeight;
        }
    });
}

/**
 * 当 currentSystemMsgElement 脱离 DOM 时，尝试重新附着到 chatBody。
 * 在 doUpdate() 和 flush() 中共用。
 * @returns {boolean} 是否成功重新附着
 */
function reattachMessageElement() {
    console.log('[FIX-REATTACH] ▶ 开始尝试重新附着消息元素到 DOM');

    // Step 0: 如果 AI 已停止生成（如会话切换时被中止），不再重新附着，防止旧会话内容泄漏到新会话
    if (!isAiGenerating) {
        console.warn('[FIX-REATTACH] Step0 中止：AI 已停止生成，跳过重新附着（可能是会话已切换）');
        return false;
    }

    // Step 1: 检查元素引用
    if (!currentSystemMsgElement || !currentSystemMsgContent) {
        console.warn('[FIX-REATTACH] Step1 失败：currentSystemMsgElement=', !!currentSystemMsgElement, ', currentSystemMsgContent=', !!currentSystemMsgContent);
        return false;
    }
    console.log('[FIX-REATTACH] Step1 通过：元素引用存在');

    // Step 2: 检查 dom.chatBody 是否还在 DOM 中
    let chatBody = dom.chatBody;
    console.log('[FIX-REATTACH] Step2: dom.chatBody 存在:', !!chatBody, ', 长度:', chatBody?.length);
    if (chatBody && chatBody.length) {
        const chatBodyInDOM = $.contains(document, chatBody[0]);
        console.log('[FIX-REATTACH] Step2: dom.chatBody 在DOM中:', chatBodyInDOM);
    }

    if (!chatBody || !chatBody.length || !$.contains(document, chatBody[0])) {
        console.warn('[FIX-REATTACH] Step2: dom.chatBody 也已脱离 DOM，尝试重新查找...');
        // 尝试通过多种选择器重新查找 chatBody
        const selectors = [
            '#st-chatu8-ai-chat-body',
            '.st-chatu8-ai-dialog #st-chatu8-ai-chat-body',
            '[id="st-chatu8-ai-chat-body"]'
        ];
        let found = false;
        for (const sel of selectors) {
            const newChatBody = $(sel);
            console.log('[FIX-REATTACH] Step2: 尝试选择器', sel, '→ 找到:', newChatBody.length);
            if (newChatBody.length && $.contains(document, newChatBody[0])) {
                dom.chatBody = newChatBody;
                chatBody = newChatBody;
                found = true;
                console.log('[FIX-REATTACH] Step2 ✅ 已通过', sel, '重新找到 dom.chatBody');
                break;
            }
        }
        if (!found) {
            console.error('[FIX-REATTACH] Step2 ❌ 无法找到有效的 dom.chatBody，放弃重新附着');
            return false;
        }
    } else {
        console.log('[FIX-REATTACH] Step2 通过：dom.chatBody 仍在 DOM 中');
    }

    // Step 3: 将消息元素重新 append 到 chatBody
    console.log('[FIX-REATTACH] Step3: 执行 chatBody.append(currentSystemMsgElement)');
    chatBody.append(currentSystemMsgElement);

    // Step 4: 验证是否成功
    const nowInDOM = $.contains(document, currentSystemMsgContent[0]);
    console.log('[FIX-REATTACH] Step4: 重新附着后 currentSystemMsgContent 在DOM中:', nowInDOM);

    if (nowInDOM) {
        console.log('[FIX-REATTACH] ✅ 重新附着成功！');
    } else {
        console.error('[FIX-REATTACH] ❌ 重新附着后元素仍不在 DOM 中！');
    }

    return nowInDOM;
}

/**
 * 创建节流版的 UI 更新回调函数，避免流式输出时 DOM 操作风暴
 * @param {Function} handleSendFn - handleSend 函数引用（用于 AskChoice 按钮）
 * @returns {{ callback: Function, flush: Function, getReply: Function }}
 */
export function createThrottledUIUpdater(handleSendFn) {
    let accumulatedReply = '';
    let thinkingRendered = false;
    let lastUpdateTime = 0;
    let pendingUpdate = null;
    const UPDATE_INTERVAL = 120;

    function doUpdate() {
        if (!currentSystemMsgContent) {
            console.warn('[DEBUG-UI] ⚠ doUpdate(): currentSystemMsgContent 为 null/undefined，跳过');
            return;
        }
        const inDOM = $.contains(document, currentSystemMsgContent[0]);
        console.log('[DEBUG-UI] doUpdate(): currentSystemMsgContent 在DOM中:', inDOM, ', accumulatedReply长度:', accumulatedReply.length);
        if (!inDOM) {
            console.error('[DEBUG-UI] ❌ doUpdate(): currentSystemMsgContent 已脱离 DOM！尝试修复...');
            const fixed = reattachMessageElement();
            if (!fixed) {
                console.error('[DEBUG-UI] ❌ doUpdate(): 修复失败，跳过本次更新');
                return;
            }
            console.log('[DEBUG-UI] ✅ doUpdate(): DOM 重新附着成功，继续更新');
        }

        let displayHtml = '';
        const thinkingResult = parseThinkingContent(accumulatedReply);

        if (thinkingResult.hasThinking && !thinkingRendered) {
            thinkingResult.thinkingBlocks.forEach(block => {
                displayHtml += renderThinkingPanel(block.content);
            });
            thinkingRendered = true;
        }

        let textWithoutThink = thinkingResult.cleanedText;

        // 流式渲染期间移除 AskChoice 标签（disclaimer 保留到最后处理）
        textWithoutThink = textWithoutThink.replace(/<AskChoice>[\s\S]*?<\/AskChoice>/gi, '').trim();

        const queryMatch = textWithoutThink.match(/<SystemQuery>([\s\S]*?)<\/SystemQuery>/gi);
        const updateMatch = textWithoutThink.match(/<UpdateSettings>([\s\S]*?)<\/UpdateSettings>/gi);

        if (queryMatch || updateMatch) {
            displayHtml += `<i><span style="color:var(--st-chatu8-text-secondary);">${getAssistantDisplayName()}调用了内部工具...</span></i>\n`;
            let rawCode = '';
            if (queryMatch) rawCode += queryMatch.join('\n');
            if (updateMatch) rawCode += updateMatch.join('\n');
            displayHtml += `
                <details class="st-chatu8-ai-query-details">
                    <summary class="st-chatu8-ai-query-summary"><i class="fa-solid fa-microchip" style="margin-right:5px"></i> 执行内部命令</summary>
                    <pre class="st-chatu8-ai-query-content">${escapeHTML(rawCode)}</pre>
                </details>
            `;
            let textWithoutTags = textWithoutThink.replace(/<SystemQuery>[\s\S]*?<\/SystemQuery>/gi, '').replace(/<UpdateSettings>[\s\S]*?<\/UpdateSettings>/gi, '').trim();
            // 最后移除 disclaimer 标签
            textWithoutTags = removeDisclaimerBlocks(textWithoutTags);
            if (textWithoutTags) {
                displayHtml += '<br>' + escapeHTML(textWithoutTags).replace(/\n/g, '<br>');
            }
        } else {
            // 最后移除 disclaimer 标签
            const finalText = removeDisclaimerBlocks(textWithoutThink);
            if (finalText.trim()) {
                displayHtml += escapeHTML(finalText).replace(/\n/g, '<br>');
            }
        }

        currentSystemMsgContent.html(displayHtml);
        throttledScrollToBottom();
    }

    function callback(replyPart) {
        accumulatedReply = replyPart;
        console.log('[DEBUG-UI] callback() 被调用, replyPart长度:', (typeof replyPart === 'string' ? replyPart.length : 'N/A'));

        const now = Date.now();
        if (now - lastUpdateTime >= UPDATE_INTERVAL) {
            lastUpdateTime = now;
            if (pendingUpdate) {
                clearTimeout(pendingUpdate);
                pendingUpdate = null;
            }
            doUpdate();
        } else if (!pendingUpdate) {
            pendingUpdate = setTimeout(() => {
                pendingUpdate = null;
                lastUpdateTime = Date.now();
                doUpdate();
            }, UPDATE_INTERVAL - (now - lastUpdateTime));
        }
    }

    function flush() {
        console.log('[DEBUG-UI] ▶ flush() 开始');
        if (pendingUpdate) {
            clearTimeout(pendingUpdate);
            pendingUpdate = null;
        }
        if (!currentSystemMsgContent || !accumulatedReply) {
            console.warn('[DEBUG-UI] ⚠ flush(): 提前返回 - currentSystemMsgContent:', !!currentSystemMsgContent, ', accumulatedReply:', !!accumulatedReply, ', accumulatedReply长度:', accumulatedReply?.length);
            return;
        }
        const inDOM = $.contains(document, currentSystemMsgContent[0]);
        console.log('[DEBUG-UI] flush(): currentSystemMsgContent 在DOM中:', inDOM, ', accumulatedReply长度:', accumulatedReply.length);
        if (!inDOM) {
            console.error('[DEBUG-UI] ❌ flush(): currentSystemMsgContent 已脱离 DOM！尝试修复...');
            const fixed = reattachMessageElement();
            if (!fixed) {
                console.error('[DEBUG-UI] ❌ flush(): 修复失败，跳过本次渲染');
                return;
            }
            console.log('[DEBUG-UI] ✅ flush(): DOM 重新附着成功，继续渲染');
        }

        let displayHtml = '';
        const thinkingResult = parseThinkingContent(accumulatedReply);

        if (thinkingResult.hasThinking) {
            thinkingResult.thinkingBlocks.forEach(block => {
                displayHtml += renderThinkingPanel(block.content);
            });
        }

        let textWithoutThink = thinkingResult.cleanedText;

        const askChoiceResult = parseAndRenderAskChoice(textWithoutThink);
        textWithoutThink = askChoiceResult.cleanedText;

        const queryMatch = textWithoutThink.match(/<SystemQuery>([\s\S]*?)<\/SystemQuery>/gi);
        const updateMatch = textWithoutThink.match(/<UpdateSettings>([\s\S]*?)<\/UpdateSettings>/gi);

        if (queryMatch || updateMatch) {
            displayHtml += `<i><span style="color:var(--st-chatu8-text-secondary);">${getAssistantDisplayName()}调用了内部工具...</span></i>\n`;
            let rawCode = '';
            if (queryMatch) rawCode += queryMatch.join('\n');
            if (updateMatch) rawCode += updateMatch.join('\n');
            displayHtml += `
                <details class="st-chatu8-ai-query-details">
                    <summary class="st-chatu8-ai-query-summary"><i class="fa-solid fa-microchip" style="margin-right:5px"></i> 执行内部命令</summary>
                    <pre class="st-chatu8-ai-query-content">${escapeHTML(rawCode)}</pre>
                </details>
            `;
            let textWithoutTags = textWithoutThink.replace(/<SystemQuery>[\s\S]*?<\/SystemQuery>/gi, '').replace(/<UpdateSettings>[\s\S]*?<\/UpdateSettings>/gi, '').trim();
            // 最后移除 disclaimer 标签
            textWithoutTags = removeDisclaimerBlocks(textWithoutTags);
            if (textWithoutTags) {
                displayHtml += '<br>' + renderMarkdown(textWithoutTags);
            }
        } else {
            // 最后移除 disclaimer 标签
            const finalText = removeDisclaimerBlocks(textWithoutThink);
            if (finalText.trim()) {
                displayHtml += renderMarkdown(finalText);
            }
        }

        if (askChoiceResult.choiceHtml) {
            displayHtml += askChoiceResult.choiceHtml;
        }

        currentSystemMsgContent.html(displayHtml);

        // 绑定 AskChoice 按钮点击事件
        if (askChoiceResult.choiceHtml) {
            currentSystemMsgContent.find('.st-chatu8-ai-ask-choice-btn').on('click', function () {
                const choiceValue = $(this).attr('data-choice-value');
                if (!choiceValue) return;
                $(this).addClass('selected');
                $(this).closest('.st-chatu8-ai-ask-choice').addClass('answered');
                dom.inputArea.val(choiceValue);
                if (handleSendFn) handleSendFn();
            });
        }

        throttledScrollToBottom();
    }

    function getReply() {
        return removeDisclaimerBlocks(accumulatedReply);
    }

    return { callback, flush, getReply };
}
