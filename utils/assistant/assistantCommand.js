/**
 * assistantCommand.js
 * 
 * 命令执行控制：自动/手动执行模式判断、创建/清除/渲染/执行待处理命令。
 */

import {
    dom, activeChat, pendingCommand, setPendingCommand,
    currentSystemMsgElement, currentSystemMsgContent,
    setCurrentSystemMsgElement, setCurrentSystemMsgContent
} from './assistantContext.js';
import { extensionName } from '../config.js';
import { extension_settings } from "../../../../../extensions.js";
import { parseAndApplySettings, parseQuerySettings } from '../aiSettingsBridge.js';
import { escapeHTML } from './assistantUtils.js';
import { syncAndSave } from './assistantSession.js';
import { appendSystemEmptyMessage } from './assistantMessage.js';

// ═══════════════════════════════════════════════════════════
//  命令执行模式
// ═══════════════════════════════════════════════════════════

/**
 * 获取命令执行模式配置
 * @returns {boolean} true=自动执行, false=手动确认
 */
export function getAutoExecuteMode() {
    const aiConfig = extension_settings[extensionName]?.chatu8_ai_assistant || {};
    return aiConfig.auto_execute_commands === true;
}

// ═══════════════════════════════════════════════════════════
//  命令 CRUD
// ═══════════════════════════════════════════════════════════

/**
 * 创建待执行命令
 * @param {jQuery} messageElement - 消息DOM元素
 * @param {string} commandContent - 命令内容
 * @returns {object} 命令对象
 */
export function createPendingCommand(messageElement, commandContent) {
    return {
        messageElement,
        commandContent,
        buttonElement: null,
        timestamp: Date.now()
    };
}

/**
 * 清除待执行命令
 */
export function clearPendingCommand() {
    if (pendingCommand && pendingCommand.buttonElement) {
        pendingCommand.buttonElement.fadeOut(200, function () {
            $(this).remove();
        });
    }
    setPendingCommand(null);
}

/**
 * 渲染执行按钮
 * @param {jQuery} messageElement - 消息DOM元素
 * @returns {jQuery} 按钮元素
 */
export function renderExecuteButton(messageElement) {
    const button = $(`
        <div class="st-chatu8-ai-execute-command-btn">
            <button class="st-chatu8-ai-btn st-chatu8-ai-execute-btn">
                <i class="fa-solid fa-play"></i> 执行命令
            </button>
            <span class="st-chatu8-ai-execute-hint">
                或发送新消息取消
            </span>
        </div>
    `);

    messageElement.after(button);
    dom.chatBody.scrollTop(dom.chatBody[0].scrollHeight);
    return button;
}

// ═══════════════════════════════════════════════════════════
//  命令执行
// ═══════════════════════════════════════════════════════════

/**
 * 检测是否包含生图请求并显示进度提示（命令执行时使用）
 * @param {string} accumulatedReply
 * @returns {Promise<*>}
 */
async function parseQueryWithProgress(accumulatedReply) {
    const hasImageGeneration = accumulatedReply.includes('"type": "generate_image"') ||
        accumulatedReply.includes('"type":"generate_image"');

    if (hasImageGeneration && currentSystemMsgContent) {
        const loadingHtml = `
            <div class="st-chatu8-ai-image-generating" style="margin-top: 10px; padding: 10px; background: rgba(100, 150, 255, 0.1); border-left: 3px solid #6496ff; border-radius: 4px;">
                <i class="fa-solid fa-spinner fa-spin"></i> 正在生成图片，请稍候...
            </div>
        `;
        currentSystemMsgContent.append(loadingHtml);
        dom.chatBody.scrollTop(dom.chatBody[0].scrollHeight);
    }

    try {
        const queryResult = await parseQuerySettings(accumulatedReply);
        return queryResult;
    } finally {
        if (hasImageGeneration && currentSystemMsgContent) {
            currentSystemMsgContent.find('.st-chatu8-ai-image-generating').remove();
        }
    }
}

/**
 * 执行待处理的命令
 * @param {object} command - 命令对象
 * @param {Function} boundAppendMessage - appendMessage 绑定版
 * @param {Function} handleRegenerateFn - handleRegenerateMessage 引用
 */
export async function executePendingCommand(command, boundAppendMessage, handleRegenerateFn) {
    const { commandContent, buttonElement } = command;

    if (!buttonElement) return;

    const btn = buttonElement.find('button');

    // 显示加载状态
    btn.prop('disabled', true)
        .removeClass('success error')
        .addClass('loading')
        .html('<i class="fa-solid fa-spinner fa-spin"></i> 执行中...');

    try {
        // 执行命令
        parseAndApplySettings(commandContent);
        const queryResult = await parseQueryWithProgress(commandContent);

        // 显示成功状态
        btn.removeClass('loading')
            .addClass('success')
            .html('<i class="fa-solid fa-check"></i> 已执行');

        // 如果有查询结果，继续对话流程
        if (queryResult !== null) {
            if (!activeChat) {
                toastr?.error('当前没有活动的对话会话');
                return;
            }

            activeChat.messages.push({ role: 'user', content: queryResult });
            await boundAppendMessage('user', queryResult);

            setCurrentSystemMsgElement(null);
            setCurrentSystemMsgContent(null);

            await appendSystemEmptyMessage();
            if (currentSystemMsgContent) {
                currentSystemMsgContent.html('<i><span style="color:var(--st-chatu8-text-secondary);">已获取最新系统参数，思考中...</span></i>');
            }

            // 在继续生成前先清除当前的 pendingCommand
            setPendingCommand(null);

            // 动态导入 generateAiResponse 避免循环依赖
            const { generateAiResponse } = await import('./assistantLLM.js');
            await generateAiResponse(null, handleRegenerateFn, boundAppendMessage);
            return;
        }

        // 延迟移除按钮（无后续查询的情况）
        setTimeout(() => {
            buttonElement.fadeOut(300, () => buttonElement.remove());
        }, 2000);
        setPendingCommand(null);

    } catch (error) {
        console.error('[AI Command Execution] 命令执行失败:', error);

        btn.removeClass('loading')
            .addClass('error')
            .prop('disabled', false)
            .html('<i class="fa-solid fa-times"></i> 执行失败');

        toastr?.error(`命令执行失败: ${error.message}`);
        clearPendingCommand();
    }
}
