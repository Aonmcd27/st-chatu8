/**
 * aiAssistant.js
 * 
 * 编排入口文件 —— 导入所有子模块并在 initAiAssistant(modal) 中按顺序初始化。
 * 保持原有的两个导出函数签名不变：
 *   - export function refreshAiAssistantSettings()
 *   - export function initAiAssistant(modal)
 * 
 * 子模块：
 *   assistant/assistantContext.js   — 共享状态 & DOM 引用
 *   assistant/assistantUtils.js     — 工具函数（throttle / debounce / escapeHTML / renderMarkdown …）
 *   assistant/assistantDialog.js    — 拖拽、缩放、设置面板 UI
 *   assistant/assistantSession.js   — 多会话 CRUD、历史面板、导出
 *   assistant/assistantTTS.js       — TTS 语音管线
 *   assistant/assistantMessage.js   — 消息渲染、流式 UI 更新器
 *   assistant/assistantLLM.js       — LLM 调用链（handleSend / generateAiResponse / handleEditAndRegenerate）
 *   assistant/assistantImage.js     — 图片上传 & 预览
 *   assistant/assistantCommand.js   — 命令执行控制
 */

// ── 子模块 ──────────────────────────────────────────────────
import {
    refreshSettingsPanelFn, initDomRefs, dom, chatSessions, activeChat
} from './assistant/assistantContext.js';

import { saveChatImage } from './configDatabase.js';

import { loadMarked, escapeHTML } from './assistant/assistantUtils.js';

import { initDialogEvents } from './assistant/assistantDialog.js';

import {
    initSessionEvents, syncAndSave, switchChat
} from './assistant/assistantSession.js';

import { setupTTSEventListeners } from './assistant/assistantTTS.js';

import {
    appendMessage, showImageFullscreen,
    handleEditMessage, handleContinueFromMessage
} from './assistant/assistantMessage.js';

import {
    handleSend, handleRegenerateMessage, initInputEvents
} from './assistant/assistantLLM.js';

import { initImageEvents } from './assistant/assistantImage.js';

import { initScreenCaptureEvents, bindIndicatorClickEvents } from './assistant/assistantScreenCapture.js';

import { initAvatarUpdateListener, updateDialogTitle } from './assistant/assistantAvatar.js';

import { initFloorMessageEvents, bindFloorIndicatorClick } from './assistant/assistantFloorMessage.js';

import { initSummaryEvents } from './assistant/assistantSummary.js';

import { refreshAllKnowledgeBaseCaches } from './knowledgeBaseService.js';

import { initScrollListener, initScrollToBottomButton } from './assistant/assistantScrollManager.js';

// ═══════════════════════════════════════════════════════════
//  导出刷新函数供外部调用
// ═══════════════════════════════════════════════════════════

export function refreshAiAssistantSettings() {
    if (refreshSettingsPanelFn) {
        refreshSettingsPanelFn();
    }
}

// ═══════════════════════════════════════════════════════════
//  主初始化函数
// ═══════════════════════════════════════════════════════════

let aiAssistantInitialized = false; // 防止重复初始化

export function initAiAssistant(modal) {
    if (aiAssistantInitialized) {
        console.warn('[AI Assistant] 已初始化过，跳过重复初始化');
        return;
    }
    aiAssistantInitialized = true;

    console.log('[AI Assistant] 开始初始化...');

    // 1. 预加载 marked.js
    loadMarked().catch(() => {
        console.warn('[AI Assistant] Markdown 渲染不可用，将使用纯文本模式');
    });

    // 2. 刷新资料库缓存（确保获取最新的世界书数据）
    refreshAllKnowledgeBaseCaches().catch(err => {
        console.warn('[AI Assistant] 刷新资料库缓存失败:', err);
    });

    // 3. 初始化 DOM 引用
    const dialog = $('#st-chatu8-ai-dialog');
    initDomRefs(dialog);

    // 4. 初始化 TTS 事件监听器（按钮状态管理 & 音频缓存）
    setupTTSEventListeners();

    // 5. 监听生图完成事件
    // V2 适配：生成的图片保存到图片层，消息中存 imageRefs 引用
    window.addEventListener('ai-show-generated-image', async (event) => {
        console.log('[AI Assistant] 收到显示图片事件:', event.detail);
        const { imageUrl, prompt } = event.detail;

        if (!imageUrl) {
            console.warn('[AI Assistant] 图片URL为空');
            return;
        }

        const chatBody = dom.chatBody;
        const icon = '<img src="/scripts/extensions/third-party/st-chatu8/html/settings/智绘姬头像.png" alt="智绘姬" style="width: 100%; height: 100%; object-fit: cover; border-radius: 50%; image-rendering: -webkit-optimize-contrast; image-rendering: crisp-edges;">';
        const messageHtml = `
            <div class="st-chatu8-ai-msg system-msg">
                <div class="msg-avatar">${icon}</div>
                <div class="msg-content">
                    <div class="st-chatu8-ai-generated-image" style="margin-top: 10px;">
                        <img src="${imageUrl}" alt="AI生成的图片" style="max-width: 100%; border-radius: 8px; cursor: pointer; box-shadow: 0 2px 8px rgba(0,0,0,0.1);" />
                        <div style="margin-top: 5px; font-size: 12px; color: #666;">提示词: ${escapeHTML(prompt)}</div>
                    </div>
                </div>
            </div>
        `;

        const $elem = $(messageHtml);
        $elem.find('img').on('click', function () {
            showImageFullscreen(imageUrl);
        });

        chatBody.append($elem);
        chatBody.scrollTop(chatBody[0].scrollHeight);
        console.log('[AI Assistant] 已添加图片消息到聊天');

        // V2: 使用 activeChat 并将图片保存到图片层
        if (activeChat) {
            try {
                // 检测 imageUrl 的 mimeType
                const mimeMatch = imageUrl.match(/^data:(image\/[^;]+);base64,/);
                const mimeType = mimeMatch ? mimeMatch[1] : 'image/png';

                // 保存图片到图片层，获取 imageRef ID
                const imageId = await saveChatImage(imageUrl, {
                    mimeType,
                    name: `generated_${Date.now()}`,
                    chatId: activeChat.id
                });

                // V2 消息格式：纯文本 content + imageRefs 引用
                const imageMessage = {
                    role: 'assistant',
                    content: `[图片生成]\n提示词: ${prompt}`,
                    imageRefs: [imageId]
                };
                activeChat.messages.push(imageMessage);
                activeChat.updatedAt = Date.now();

                await syncAndSave();
                console.log('[AI Assistant] 图片消息已保存到历史记录（V2 imageRefs 格式）, imageId:', imageId);
            } catch (err) {
                console.error('[AI Assistant] 保存图片消息失败:', err);
                // 降级处理：即使保存图片层失败，也尝试保存纯文本消息
                try {
                    const fallbackMessage = {
                        role: 'assistant',
                        content: `[图片生成]\n提示词: ${prompt}\n（图片保存失败）`
                    };
                    activeChat.messages.push(fallbackMessage);
                    activeChat.updatedAt = Date.now();
                    await syncAndSave();
                } catch (fallbackErr) {
                    console.error('[AI Assistant] 降级保存也失败:', fallbackErr);
                }
            }
        }
    });

    // ── 构建回调闭包 ──────────────────────────────────────────
    // 由于子模块之间有复杂的互相调用关系，这里通过闭包绑定统一的回调函数。

    /**
     * 绑定了所有回调的 appendMessage 包装器
     */
    const boundAppendMessage = (role, text, images = null, messageIndex = null, skipScroll = false) => {
        return appendMessage(role, text, images, messageIndex, skipScroll, {
            handleEditMessage: (idx) => handleEditMessage(idx),
            handleContinueFromMessage: (idx) => handleContinueFromMessage(idx, boundSwitchChat),
            handleRegenerateMessage: (idx) => boundHandleRegenerate(idx),
            handleSend: () => boundHandleSend()
        });
    };

    /**
     * 绑定了依赖的 switchChat 包装器
     */
    const boundSwitchChat = (chatId) => {
        switchChat(chatId, boundAppendMessage);
    };

    /**
     * 绑定了所有依赖的 handleSend 包装器
     */
    const boundHandleSend = () => {
        handleSend(boundHandleSend, boundHandleRegenerate, boundAppendMessage, boundSwitchChat);
    };

    /**
     * 绑定了所有依赖的 handleRegenerateMessage 包装器
     */
    const boundHandleRegenerate = (messageIndex) => {
        handleRegenerateMessage(messageIndex, boundHandleSend, boundHandleRegenerate, boundAppendMessage, boundSwitchChat);
    };

    // 6. 初始化对话框事件（拖拽、缩放、设置面板）
    initDialogEvents();

    // 7. 初始化会话管理事件（历史面板、新建聊天、导出等）
    initSessionEvents(boundAppendMessage);

    // 8. 初始化图片上传事件
    initImageEvents();

    // 9. 初始化屏幕截图模块（开关事件 & 指示图标）
    initScreenCaptureEvents();
    bindIndicatorClickEvents();

    // 10. 初始化楼层信息模块（开关事件 & 指示图标）
    initFloorMessageEvents();
    bindFloorIndicatorClick();

    // 11. 初始化聊天总结面板事件
    initSummaryEvents();

    // 12. 初始化输入区域和发送按钮事件
    initInputEvents(boundHandleSend);

    // 13. 初始化头像更新监听器 & 对话框标题
    initAvatarUpdateListener(dom.chatBody);
    updateDialogTitle();

    // 14. 初始化滚动管理器
    initScrollListener(boundAppendMessage);
    initScrollToBottomButton();

    console.log('[AI Assistant] 初始化完成');
}
