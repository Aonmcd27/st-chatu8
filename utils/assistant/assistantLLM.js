/**
 * assistantLLM.js
 * 
 * LLM 调用链：generateAiResponse、handleSend、handleEditAndRegenerate。
 * 核心 runLlmChain 逻辑被提取为共享的 buildAndRunLlmChain 工厂函数，
 * 消除原来三处几乎完全相同的代码重复。
 *
 * V2 存储适配：
 * - 消息中图片通过 imageRefs 引用 ID 存储，不再内嵌 Base64
 * - 发送消息时提取图片 → saveChatImage → 存 imageRefs
 * - 构建 LLM prompt 时按 imageRefs 批量获取图片 Base64 拼回多模态格式
 * - 兼容 V1 遗留消息中内嵌的多模态数组格式
 */

import {
    dom, chatSessions, activeChat, isAiGenerating, setIsAiGenerating,
    currentSystemMsgElement, currentSystemMsgContent,
    setCurrentSystemMsgElement, setCurrentSystemMsgContent,
    selectedImages, setSelectedImages, pendingCommand, setPendingCommand,
    pendingImageGenerations
} from './assistantContext.js';
import { extensionName, LLMRequestTypes } from '../config.js';
import { extension_settings } from "../../../../../extensions.js";
import { getContext } from "../../../../../st-context.js";
import { executeDefaultLLMRequest, abortLLMChannelRequest } from '../settings/llm.js';
import { updateCombinedPrompt, getResultTextareaUpdater } from '../settings/llmUi.js';
import { getEffectiveConfigForRequestType } from '../settings/llmService.js';
import { systemPrompts, defaultSystemPromptKey } from '../aiPrompts.js';
import { getModuleSummaries } from '../aiPromptModules.js';
import { getSettingsContextPrompt, parseAndApplySettings, parseQuerySettings, hasSystemCommand, buildTailReminder } from '../aiSettingsBridge.js';
import { buildKnowledgeBasePromptContent } from '../knowledgeBaseService.js';
import { buildPersonaPromptContent, buildUserPromptContent, getPersonaFieldValue, getUserFieldValue } from '../settings/knowledgeBase/index.js';
import { PERSONA_FIELDS } from '../settings/knowledgeBase/personaPreset.js';
import { escapeHTML } from './assistantUtils.js';
import { injectTTSStyleInstruction, tryPlayTTS, speakNotification } from './assistantTTS.js';
import { notifyAiGenerating, notifyAiGenerationDone, isConversationMode } from '../asr.js';
import { syncAndSave, startNewChat, switchChat } from './assistantSession.js';
import {
    updateSendButtonState, adjustInputHeight, appendMessage,
    appendSystemEmptyMessage, finalizeAssistantMessage,
    createThrottledUIUpdater, dismissAskChoices, parseAndRenderAskChoice
} from './assistantMessage.js';
import { clearImageSelection, renderImagePreview } from './assistantImage.js';
import { createPendingCommand, clearPendingCommand, renderExecuteButton, executePendingCommand, getAutoExecuteMode } from './assistantCommand.js';
import { removeThinkBlocks } from '../aiSettingsBridge.js';
import { captureForMessage } from './assistantScreenCapture.js';
import { buildFloorContext } from './assistantFloorMessage.js';
import { getSummaryManager } from './assistantSummary.js';
import { saveChatImage, getChatImagesBatch, getChatImagesMetadataBatch } from '../configDatabase.js';
import { updateScrollStateAfterEdit } from './assistantScrollManager.js';

// ═══════════════════════════════════════════════════════════
//  Profile Data 构建
// ═══════════════════════════════════════════════════════════

/**
 * 判断当前是否为自定义模式
 * @returns {boolean}
 */
function isCustomMode() {
    const aiConfig = extension_settings[extensionName]?.chatu8_ai_assistant || {};
    return (aiConfig.system_prompt_key || defaultSystemPromptKey) === 'custom';
}

/**
 * 从 extension_settings 构建 LLM 请求的 profileData
 * 始终使用「智绘姬AI」设置面板的配置（chatu8_ai_assistant）
 * @returns {object}
 */
function buildProfileData() {
    const aiConfig = extension_settings[extensionName]?.chatu8_ai_assistant || {};

    // 「发送图片」开关来源策略：
    // - 自定义预设模式：使用 LLM 自定义请求类型 AI_ASSISTANT 对应 api_profile 的 send_images
    // - 默认/内置预设模式：使用智绘姬面板自身的 send_images 开关（默认 true）
    let sendImages;
    if (isCustomMode()) {
        try {
            const cfg = getEffectiveConfigForRequestType(LLMRequestTypes.AI_ASSISTANT);
            sendImages = cfg?.send_images ?? false;
        } catch (_e) {
            sendImages = false;
        }
    } else {
        sendImages = aiConfig.send_images !== false;
    }

    return {
        api_url: aiConfig.api_url,
        api_key: aiConfig.api_key,
        model: aiConfig.model,
        bypass_proxy: aiConfig.bypass_proxy,
        stream: aiConfig.stream,
        temperature: typeof aiConfig.temperature === 'number' ? aiConfig.temperature : 0.8,
        top_p: typeof aiConfig.top_p === 'number' ? aiConfig.top_p : 1.0,
        max_tokens: typeof aiConfig.max_tokens === 'number' ? aiConfig.max_tokens : 40000,
        // 透传「发送图片」开关，否则 executeDefaultLLMRequest 会因 undefined → 默认 false 而剥离图片
        send_images: sendImages
    };
}

// ═══════════════════════════════════════════════════════════
//  系统提示词组装
// ═══════════════════════════════════════════════════════════

/**
 * 组装完整的系统提示词（动态注入各种占位符）
 * 自定义模式下返回 null，由 runLlmChain 使用上下文预设的 entries 替代
 * @returns {Promise<string|null>}
 */
async function buildSystemPrompt(kbTriggerText = '') {
    const aiConfig = extension_settings[extensionName]?.chatu8_ai_assistant || {};
    const promptKey = aiConfig.system_prompt_key || defaultSystemPromptKey;

    // 自定义模式：返回 null，由 runLlmChain 从上下文预设读取 entries
    if (promptKey === 'custom') {
        return null;
    }

    let systemPromptStr = systemPrompts[promptKey]?.prompt || systemPrompts[defaultSystemPromptKey].prompt;

    // 【动态注入】模块摘要
    if (systemPromptStr.includes('{modules}')) {
        const moduleSummaries = getModuleSummaries();
        systemPromptStr = systemPromptStr.replace('{modules}', "\n" + moduleSummaries + "\n");
    }

    // 【动态注入】设置上下文
    if (systemPromptStr.includes('{settings}')) {
        const contextStr = getSettingsContextPrompt();
        systemPromptStr = systemPromptStr.replace('{settings}', "\n" + contextStr + "\n");
    }

    // 【动态注入】智绘姬专属编号
    if (systemPromptStr.includes('{chatu8_code}')) {
        const settings = extension_settings[extensionName];
        const chatu8Code = settings?.chatu8_code || '未分配';
        systemPromptStr = systemPromptStr.replace(/{chatu8_code}/g, chatu8Code);
    }

    // 【动态注入】资料库内容（由调用方按触发深度收集好触发文本传入）
    if (systemPromptStr.includes('{knowledgeBase}')) {
        const knowledgeContent = await buildKnowledgeBasePromptContent(kbTriggerText);
        systemPromptStr = systemPromptStr.replace('{knowledgeBase}', "\n" + knowledgeContent + "\n");
    }

    // 【动态注入】TTS 逐句风格标注
    systemPromptStr = injectTTSStyleInstruction(systemPromptStr);

    return systemPromptStr;
}

/**
 * 对自定义预设条目内容执行模板变量替换
 * 支持：
 *   - {{人设}} → 整块人设内容（向后兼容）
 *   - {{userpersona}} → 整块 User 人设内容（向后兼容）
 *   - {{人设.fieldName}} → 角色人设的具体字段值
 *   - {{用户.fieldName}} → User 人设的具体字段值
 *   - {{知识库}} → 知识库内容（常开资料 + 按需资料库列表）
 *   - {{用户需求}} → 用户最新一条发言的文本内容
 *   - {{截图信息}} → 屏幕/浏览器截图的描述信息
 * @param {string} content - 原始条目内容
 * @param {object} [extraVars] - 额外的变量上下文
 * @param {string} [extraVars.lastUserText] - 用户最新发言文本
 * @param {string} [extraVars.captureInfo] - 截图信息描述
 * @returns {Promise<string>} 替换后的内容
 */
export async function substituteTemplateVariables(content, extraVars = {}) {
    if (!content) return content;

    let result = content;

    // ── 保留原有整块替换（向后兼容） ──

    // {{人设}} → 人设管理模块中当前选中的人设内容
    if (result.includes('{{人设}}')) {
        const personaContent = buildPersonaPromptContent();
        result = result.replace(/\{\{人设\}\}/g, personaContent || '暂无人设资料');
    }

    // {{userpersona}} → user管理模块中当前选中的User人设内容
    if (result.includes('{{userpersona}}')) {
        const userContent = buildUserPromptContent();
        result = result.replace(/\{\{userpersona\}\}/g, userContent || '暂无User人设资料');
    }

    // {{知识库}} → 知识库内容（用 kbTriggerText，或倒退到 lastUserText）
    if (result.includes('{{知识库}}')) {
        const triggerText = extraVars.kbTriggerText ?? extraVars.lastUserText ?? '';
        const knowledgeContent = await buildKnowledgeBasePromptContent(triggerText);
        result = result.replace(/\{\{知识库\}\}/g, knowledgeContent || '');
    }

    // {{用户需求}} → 用户最新一条发言的文本内容
    if (result.includes('{{用户需求}}')) {
        const lastUserText = extraVars.lastUserText ?? '';
        result = result.replace(/\{\{用户需求\}\}/g, lastUserText);
    }

    // {{截图信息}} → 屏幕/浏览器截图的描述信息
    if (result.includes('{{截图信息}}')) {
        const captureInfo = extraVars.captureInfo ?? '';
        result = result.replace(/\{\{截图信息\}\}/g, captureInfo);
    }

    // {{楼层信息}} → 酒馆楼层消息上下文 + 世界书触发
    if (result.includes('{{楼层信息}}')) {
        const floorContext = await buildFloorContext();
        let finalFloorContent = '';

        // 仅当楼层信息不为空时才触发世界书
        if (floorContext && floorContext.trim()) {
            try {
                const { processWorldBooksWithTrigger } = await import('../promptReq.js');
                const floorMessages = floorContext.split('\n').filter(line => line.trim());
                let triggeredWorldBook = await processWorldBooksWithTrigger(floorMessages);

                // 替换世界书触发内容中的 {{user}} 和 <user>（与 promptProcessor.js 逻辑一致）
                if (triggeredWorldBook) {
                    const username = getContext()?.name1 || '';
                    triggeredWorldBook = triggeredWorldBook.replaceAll('{{user}}', username);
                    triggeredWorldBook = triggeredWorldBook.replaceAll('<user>', username);
                }

                if (triggeredWorldBook) {
                    finalFloorContent = `<酒馆故事背景>\n${triggeredWorldBook}\n</酒馆故事背景>\n\n${floorContext}`;
                    console.log('[AI Assistant] 楼层信息已触发世界书内容');
                } else {
                    finalFloorContent = floorContext;
                }
            } catch (err) {
                console.warn('[AI Assistant] 楼层信息触发世界书失败:', err);
                finalFloorContent = floorContext;
            }
        }

        result = result.replace(/\{\{楼层信息\}\}/g, finalFloorContent);
    }

    // ── 新增：字段级占位符替换 ──

    // {{人设.fieldName}} → 角色人设的具体字段值
    for (const field of PERSONA_FIELDS) {
        const placeholder = `{{人设.${field}}}`;
        if (result.includes(placeholder)) {
            const value = getPersonaFieldValue(field);
            result = result.replace(
                new RegExp(`\\{\\{人设\\.${field}\\}\\}`, 'g'),
                value || ''
            );
        }
    }

    // {{用户.fieldName}} → User 人设的具体字段值
    for (const field of PERSONA_FIELDS) {
        const placeholder = `{{用户.${field}}}`;
        if (result.includes(placeholder)) {
            const value = getUserFieldValue(field);
            result = result.replace(
                new RegExp(`\\{\\{用户\\.${field}\\}\\}`, 'g'),
                value || ''
            );
        }
    }

    // ── Phase 4：空字段智能清理 ──
    // 移除占位符替换后只剩标签文本的行（如 "你的年龄：\n"）
    // 匹配模式：行首可有空白，然后是中文/英文标签文本，接冒号（中英文均可），
    // 冒号后仅有空白直到行尾 → 移除整行
    result = result.replace(/^[^\n]*[：:]\s*$/gm, '');
    // 清理连续的空行（多个换行合并为一个）
    result = result.replace(/\n{3,}/g, '\n\n');

    return result;
}

/**
 * 从上下文预设的 entries 构建前缀消息（自定义模式专用）
 * 会对每个条目执行模板变量替换（{{人设}}、{{人设.xxx}}、{{用户.xxx}}、{{知识库}}、{{用户需求}}、{{截图信息}}等）
 * 新增：检测 {{上下文}} 标记，返回对话历史插入点
 * 新增：检测 entry_user_input 条目，将最后一条用户消息的图片附加进去
 * @param {object} [extraVars] - 额外的变量上下文（透传给 substituteTemplateVariables）
 * @param {string} [extraVars.lastUserText] - 用户最新发言文本
 * @param {string} [extraVars.captureInfo] - 截图信息描述
 * @param {object} [extraVars.lastUserImages] - 最后一条用户消息的图片数据 { imageId: base64DataUrl }
 * @returns {Promise<{messages: Array<{role: string, content: string|Array}>, contextInsertIndex: number}>}
 */
export async function buildCustomPrefillMessages(extraVars = {}) {
    const effectiveConfig = getEffectiveConfigForRequestType(LLMRequestTypes.AI_ASSISTANT);
    const contextProfile = effectiveConfig.context || {};
    const messages = [];
    let contextInsertIndex = -1; // -1 表示未找到 {{上下文}} 标记

    if (contextProfile.entries && Array.isArray(contextProfile.entries)) {
        // ── 预先扫描：定位「图片附加目标」条目索引（最后一个匹配项，避免多处重复附图）──
        // 匹配规则：entry.id === 'entry_user_input' 或 entry.content 含有 {{用户需求}} 占位符
        const hasImages = extraVars.lastUserImages && Object.keys(extraVars.lastUserImages).length > 0;
        let imageTargetEntryIdx = -1;
        if (hasImages) {
            for (let i = 0; i < contextProfile.entries.length; i++) {
                const e = contextProfile.entries[i];
                if (!e || !e.enabled || !e.content || e.content.trim() === '') continue;
                if (e.content.trim() === '{{上下文}}' || e.content.includes('{{上下文}}')) continue;
                if (e.id === 'entry_user_input' || e.content.includes('{{用户需求}}')) {
                    imageTargetEntryIdx = i;
                }
            }
            console.log('[AI Assistant] 图片附加目标条目索引:', imageTargetEntryIdx,
                imageTargetEntryIdx >= 0 ? `(id=${contextProfile.entries[imageTargetEntryIdx].id})` : '(未找到，将不附加)');
        }

        for (let i = 0; i < contextProfile.entries.length; i++) {
            const entry = contextProfile.entries[i];
            if (!entry.enabled) continue;
            if (!entry.content || entry.content.trim() === '') continue;

            // ★ 检测 {{上下文}} 标记
            if (entry.content.trim() === '{{上下文}}' || entry.content.includes('{{上下文}}')) {
                // 记录插入点位置（当前 messages 数组的长度即为插入位置）
                contextInsertIndex = messages.length;
                // 不将此条目添加到 messages 中（它会被对话历史替换）
                continue;
            }

            // 自定义模式下忽略触发模式，全部 always 包含
            // 执行模板变量替换（异步，支持 {{知识库}}、{{用户需求}} 等异步占位符）
            const substitutedContent = await substituteTemplateVariables(entry.content, extraVars);

            // ★ 当该条目是「图片附加目标」时，转换为多模态格式
            if (i === imageTargetEntryIdx) {
                console.log('[AI Assistant] 在条目 id=' + entry.id + ' 上附加图片数据:', Object.keys(extraVars.lastUserImages).length, '张');
                const parts = [{ type: 'text', text: substitutedContent }];

                // 附加图片
                for (const [imageId, base64Url] of Object.entries(extraVars.lastUserImages)) {
                    console.log('[AI Assistant] 附加图片:', imageId, '长度:', base64Url?.length);
                    parts.push({
                        type: 'image_url',
                        image_url: { url: base64Url }
                    });
                }

                messages.push({ role: entry.role || 'system', content: parts });
                console.log('[AI Assistant] 已转换为多模态格式，parts 数量:', parts.length);
            } else {
                // 普通文本消息
                messages.push({ role: entry.role || 'system', content: substitutedContent });
            }
        }
    }

    return { messages, contextInsertIndex };
}

// ═══════════════════════════════════════════════════════════
//  生图检测
// ═══════════════════════════════════════════════════════════

// 始终自动执行且不进行 AI 回调的命令类型集合
const AUTO_EXECUTE_NO_CALLBACK_TYPES = new Set([
    'generate_image',
    'tavern_input',
    'tavern_read_input',
    // 任务管理写操作（不需要 AI 回调）
    'task_create',
    'task_update',
    'task_add_steps',
    'step_update',
    'task_complete',
    // UI/功能开关操作（不需要 AI 回调）
    'ui_action',
    'regex_test_mode',
    'click_trigger_enabled',
    'gesture_enabled'
]);

/**
 * 检测 AI 回复中是否仅包含"始终自动执行且不回调"的命令。
 * 包括：generate_image、tavern_input、tavern_read_input。
 * 如果所有 SystemQuery 指令都属于此类型，则返回 true。
 * @param {string} text - AI 回复文本
 * @returns {boolean}
 */
function isAutoExecuteNoCallbackOnly(text) {
    if (!text) return false;
    const cleaned = removeThinkBlocks(text);
    const queryMatches = [...cleaned.matchAll(/<SystemQuery>([\s\S]*?)<\/SystemQuery>/gi)];
    if (queryMatches.length === 0) return false;

    for (const match of queryMatches) {
        try {
            const data = JSON.parse(match[1].trim());
            if (!AUTO_EXECUTE_NO_CALLBACK_TYPES.has(data.type)) return false;
        } catch {
            return false;
        }
    }
    return true;
}

/**
 * 检测 AI 回复中是否包含画图命令（generate_image），可能还有其它命令混合。
 * @param {string} text - AI 回复文本
 * @returns {boolean}
 */
function hasImageGenerationCommand(text) {
    if (!text) return false;
    const cleaned = removeThinkBlocks(text);
    const queryMatches = [...cleaned.matchAll(/<SystemQuery>([\s\S]*?)<\/SystemQuery>/gi)];
    for (const match of queryMatches) {
        try {
            const data = JSON.parse(match[1].trim());
            if (data.type === 'generate_image') return true;
        } catch {
            // ignore
        }
    }
    return false;
}

/**
 * 检测是否包含生图请求并显示进度提示
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
        console.log('[AI Assistant] 已显示生图进度提示');
    }

    try {
        const queryResult = await parseQuerySettings(accumulatedReply);
        return queryResult;
    } finally {
        if (hasImageGeneration && currentSystemMsgContent) {
            currentSystemMsgContent.find('.st-chatu8-ai-image-generating').remove();
            console.log('[AI Assistant] 已移除生图进度提示');
        }
    }
}

/**
 * 检测AI回复中的生图请求并记录
 * @param {jQuery} messageElement
 * @param {string} aiReply
 */
function detectImageGenerationRequest(messageElement, aiReply) {
    const idMatch = aiReply.match(/生图请求已提交，ID: (ai_gen_\d+_\d+)/);
    if (idMatch && idMatch[1]) {
        const generationId = idMatch[1];
        pendingImageGenerations.set(generationId, messageElement);

        const loadingHtml = `
            <div class="st-chatu8-ai-image-loading" data-gen-id="${generationId}" style="margin-top: 10px; text-align: center; color: var(--st-chatu8-text-secondary);">
                <i class="fa-solid fa-spinner fa-spin"></i> 正在生成图片...
            </div>
        `;
        messageElement.append(loadingHtml);
    }
}

// ═══════════════════════════════════════════════════════════
//  V2 图片存储辅助函数
// ═══════════════════════════════════════════════════════════

/**
 * 将图片数组保存到图片层，返回 imageRefs 数组。
 * @param {Array<{data: string, name?: string, type?: string}>} images - 图片数组，data 为 Base64 Data URL
 * @param {string} chatId - 所属会话 ID
 * @returns {Promise<string[]>} imageRef ID 列表
 */
async function _saveImagesAndGetRefs(images, chatId) {
    if (!images || images.length === 0) return [];

    const refs = [];
    for (const img of images) {
        try {
            // 从 Data URL 提取 mimeType
            const mimeMatch = img.data.match(/^data:(image\/[^;]+);base64,/);
            const mimeType = mimeMatch ? mimeMatch[1] : 'image/png';

            // 使用图片的 name 字段（已包含截图类型信息）
            const imageId = await saveChatImage(img.data, {
                mimeType,
                name: img.name || '',
                chatId
            });
            refs.push(imageId);
        } catch (err) {
            console.error('[AI Assistant] 保存图片到图片层失败:', err);
        }
    }
    return refs;
}

// ═══════════════════════════════════════════════════════════
//  核心 LLM 调用链（去重后的统一实现）
// ═══════════════════════════════════════════════════════════

/**
 * 限制对话历史中的图片数量（从后往前保留最多 maxImages 张）。
 * 超出部分的 image_url 项会被移除，仅保留文本内容；
 * 如果移除后 content 数组只剩一个 text 项，则简化为纯字符串。
 *
 * @param {Array} messages - 对话消息数组（已经过 role 映射，已重建多模态格式）
 * @param {number} maxImages - 最多保留的图片数量，默认 5
 * @returns {Array} 处理后的消息数组（深拷贝，不修改原数组）
 */
function limitImagesInHistory(messages, maxImages = 5) {
    // 先统计总图片数
    let totalImages = 0;
    for (const msg of messages) {
        if (Array.isArray(msg.content)) {
            for (const part of msg.content) {
                if (part.type === 'image_url') {
                    totalImages++;
                }
            }
        }
    }

    // 如果总图片数不超过限制，直接返回原数组
    if (totalImages <= maxImages) {
        return messages;
    }

    console.log(`[AI Assistant] 对话历史中共有 ${totalImages} 张图片，超过上限 ${maxImages}，将从后往前保留最新的 ${maxImages} 张`);

    // 从后往前遍历，标记要保留的图片
    let kept = 0;
    // 用一个 Set 记录要保留的 (msgIndex, partIndex)
    const keepSet = new Set();

    for (let i = messages.length - 1; i >= 0 && kept < maxImages; i--) {
        const msg = messages[i];
        if (!Array.isArray(msg.content)) continue;

        // 从该消息的最后一个 part 往前扫描
        for (let j = msg.content.length - 1; j >= 0 && kept < maxImages; j--) {
            if (msg.content[j].type === 'image_url') {
                keepSet.add(`${i}-${j}`);
                kept++;
            }
        }
    }

    // 构建新的消息数组（深拷贝含图片的消息）
    return messages.map((msg, i) => {
        if (!Array.isArray(msg.content)) {
            return msg; // 纯文本消息直接返回
        }

        const newContent = [];
        let removedCount = 0;

        for (let j = 0; j < msg.content.length; j++) {
            const part = msg.content[j];
            if (part.type === 'image_url') {
                if (keepSet.has(`${i}-${j}`)) {
                    newContent.push(part);
                } else {
                    removedCount++;
                }
            } else {
                newContent.push(part);
            }
        }

        // 如果有图片被移除，添加提示文本
        if (removedCount > 0) {
            newContent.push({ type: 'text', text: `[已省略 ${removedCount} 张较早的图片以节省请求体积]` });
        }

        // 如果只剩一个 text 项，简化为纯字符串
        if (newContent.length === 1 && newContent[0].type === 'text') {
            return { role: msg.role, content: newContent[0].text };
        }

        return { role: msg.role, content: newContent };
    });
}

/**
 * 当「发送图片」开关关闭时，从消息数组中移除所有图片内容。
 * 图片仍保留在聊天历史和 UI 中，仅在发送给 LLM 时被过滤。
 *
 * @param {Array<{role: string, content: string|Array}>} messages
 * @returns {Array<{role: string, content: string|Array}>}
 */
function stripImagesFromMessages(messages) {
    return messages.map(msg => {
        if (!Array.isArray(msg.content)) return msg;
        const filtered = msg.content.filter(part => part.type !== 'image_url');
        if (filtered.length === 0) {
            return { role: msg.role, content: '' };
        }
        if (filtered.length === 1 && filtered[0].type === 'text') {
            return { role: msg.role, content: filtered[0].text };
        }
        return { role: msg.role, content: filtered };
    });
}

/**
 * 合并相邻同类 role 的消息。
 * 规则：
 *   1. 将所有 system role 转换为 user role
 *   2. 合并相邻的同 role 消息为一条
 *
 * 对于 content 的合并：
 *   - 两个纯字符串 → 用 "\n\n" 拼接
 *   - 其中一个或两个为数组（多模态） → 统一转为数组后拼接
 *
 * @param {Array<{role: string, content: string|Array}>} messages
 * @returns {Array<{role: string, content: string|Array}>}
 */
function mergeAdjacentMessages(messages) {
    if (!messages || messages.length === 0) return messages;

    // 辅助：将 content 统一为数组形式
    const toArray = (content) => {
        if (Array.isArray(content)) return content;
        return [{ type: 'text', text: String(content ?? '') }];
    };

    // 辅助：合并两个 content
    const mergeContent = (a, b) => {
        const isAStr = typeof a === 'string';
        const isBStr = typeof b === 'string';
        // 都是字符串时直接拼接
        if (isAStr && isBStr) return a + '\n\n' + b;
        // 否则统一转数组再拼接
        return [...toArray(a), ...toArray(b)];
    };

    // Step 1: 将 system → user
    const converted = messages.map(msg => ({
        ...msg,
        role: msg.role === 'system' ? 'user' : msg.role
    }));

    // Step 2: 合并相邻同 role
    const merged = [];
    for (const msg of converted) {
        const last = merged.length > 0 ? merged[merged.length - 1] : null;
        if (last && last.role === msg.role) {
            last.content = mergeContent(last.content, msg.content);
        } else {
            // 深拷贝 content 以免修改原数组
            merged.push({ role: msg.role, content: Array.isArray(msg.content) ? [...msg.content] : msg.content });
        }
    }

    return merged;
}

/**
 * 从消息内容中去除思维链（<think>...</think> 或 <thinking>...</thinking>）。
 * 使用贪婪匹配，从字符串开头匹配到最后一个闭合的 </think> 或 </thinking> 标签。
 * @param {string} content - 原始消息内容
 * @returns {string} 去除思维链后的内容
 */
function stripThinkingContent(content) {
    if (typeof content !== 'string') return content;
    // 贪婪匹配：从开头到最后一个 </think> 或 </thinking>，再去除尾部空白
    return content.replace(/^[\s\S]*<\/think(?:ing)?>\s*/g, '');
}

/**
 * V2: 从消息数组构建对话历史，将 imageRefs 还原为多模态格式。
 * 同时兼容 V1 遗留的多模态消息格式（content 为数组）。
 * @param {Array} rawMessages - activeChat.messages（V2 格式或 V1 兼容格式）
 * @param {Object} imageCache - { imageId: base64DataUrl } 批量获取的图片缓存
 * @returns {Array<{role: string, content: string|Array}>} 适合发送给 LLM 的对话历史
 */
function _buildConversationHistory(rawMessages, imageCache) {
    return rawMessages.filter(msg => msg && typeof msg === 'object').map(msg => {
        const role = msg.role === 'assistant' || msg.role === 'system' ? 'assistant' : msg.role;

        // ── V2 格式：content 为纯文本 + imageRefs 引用 ──
        if (msg.imageRefs && msg.imageRefs.length > 0) {
            const textContent = String(msg.content || '');
            const text = role === 'assistant' ? stripThinkingContent(textContent) : textContent;
            const parts = [{ type: 'text', text }];

            for (const refId of msg.imageRefs) {
                if (imageCache[refId]) {
                    parts.push({
                        type: 'image_url',
                        image_url: { url: imageCache[refId] }
                    });
                }
            }

            // 如果没有有效图片（全部获取失败），退化为纯文本
            if (parts.length === 1) {
                return { role, content: parts[0].text };
            }
            return { role, content: parts };
        }

        // ── V1 兼容：content 为多模态数组（含内嵌 Base64 image_url）──
        if (Array.isArray(msg.content)) {
            if (role === 'assistant') {
                const cleaned = msg.content.map(part =>
                    part.type === 'text' ? { ...part, text: stripThinkingContent(part.text) } : part
                );
                return { role, content: cleaned };
            }
            return { role, content: msg.content };
        }

        // ── 纯文本消息 ──
        if (role === 'assistant') {
            return { role, content: stripThinkingContent(msg.content) };
        }
        return { role, content: msg.content };
    });
}

/**
 * 通用的 LLM 调用链。
 * 原代码中 generateAiResponse、handleSend、handleEditAndRegenerate 各有一份几乎
 * 完全相同的 runLlmChain，此函数将其合并。
 *
 * V2 适配：从 activeChat.messages 的 imageRefs 批量获取图片，拼回多模态格式后发给 LLM。
 *
 * @param {object} activeChatRef - 当前活动的聊天对象（V2 ChatData）
 * @param {object} profileData - LLM 请求配置
 * @param {string} requestId - 请求标识
 * @param {object} iterState - { currentIteration, maxIterations } 迭代控制
 * @param {Function} handleSendFn - handleSend 函数引用（用于 AskChoice）
 * @param {Function} handleRegenerateFn - handleRegenerateMessage 函数引用
 * @param {Function} boundAppendMessage - 绑定了回调的 appendMessage
 */
async function runLlmChain(activeChatRef, profileData, requestId, iterState, handleSendFn, handleRegenerateFn, boundAppendMessage) {
    const chatMessages = Array.isArray(activeChatRef.messages)
        ? activeChatRef.messages.filter(msg => msg && typeof msg === 'object')
        : [];

    // ── 按触发深度收集知识库触发文本 ──
    // depth=0: 只用最后一条用户消息；depth=N: 再向上取 N 条消息（含AI消息）
    const kbConfig = extension_settings[extensionName]?.knowledgeBaseConfig || {};
    const kbTriggerDepth = typeof kbConfig.triggerDepth === 'number' ? kbConfig.triggerDepth : 1;
    const kbTriggerMessages = chatMessages.slice(-(kbTriggerDepth + 1));
    const kbTriggerText = kbTriggerMessages
        .map(m => Array.isArray(m.content)
            ? (m.content.find(c => c.type === 'text')?.text || '')
            : String(m.content || ''))
        .filter(t => t.trim())
        .join('\n');

    // 每次循环重新组装 prompt
    const systemPromptStr = await buildSystemPrompt(kbTriggerText);

    // ── V2: 收集所有 imageRefs 并批量获取 ──
    const allImageRefs = [];
    for (const msg of chatMessages) {
        if (msg.imageRefs && msg.imageRefs.length > 0) {
            allImageRefs.push(...msg.imageRefs);
        }
    }

    let imageCache = {};
    if (allImageRefs.length > 0) {
        try {
            imageCache = await getChatImagesBatch(allImageRefs);
        } catch (err) {
            console.error('[AI Assistant] 批量获取聊天图片失败:', err);
        }
    }

    // ── 构建对话历史（V2 imageRefs → 多模态，兼容 V1 内嵌格式）──
    const conversationHistory = _buildConversationHistory(chatMessages, imageCache);

    // 限制图片数量：最多保留最近 5 张，避免请求体过大
    const limitedHistory = limitImagesInHistory(conversationHistory, 5);

    // 如果关闭了「发送图片」开关，从消息中移除所有图片
    // 来源策略与 buildProfileData 保持一致：自定义预设走 LLM 自定义 profile，默认预设走面板开关
    const sendImages = profileData?.send_images !== false;
    // ── 诊断：打印 AI 助手的发送图片状态 ──
    try {
        let _imgCount = 0;
        if (Array.isArray(limitedHistory)) {
            for (const m of limitedHistory) {
                if (m && Array.isArray(m.content)) {
                    for (const p of m.content) if (p && p.type === 'image_url') _imgCount++;
                }
            }
        }
        console.warn(
            `[发送图片诊断/AI助手] send_images=${sendImages} | history 中图片数=${_imgCount} | 将${sendImages ? '保留' : '剥离'}图片`
        );
    } catch (_e) { /* 诊断输出失败不影响主流程 */ }
    let processedHistory = sendImages ? limitedHistory : stripImagesFromMessages(limitedHistory);

    // ── 聊天总结上下文注入 ──
    let summaryBlock = '';
    const summaryMgr = getSummaryManager();
    if (summaryMgr && summaryMgr.summaries.some(s => s.enabled)) {
        const result = summaryMgr.buildSummaryContextBlock(chatMessages);
        summaryBlock = result.summaryBlock;
        if (result.excludedRanges.length > 0) {
            processedHistory = summaryMgr.filterHistoryMessages(processedHistory, result.excludedRanges);
            console.log('[AI Assistant] 总结上下文：已排除', result.excludedRanges.length, '个消息范围，注入总结块');
        }
    }

    // 提取用户最后一条发言的文本内容（供自定义预设 {{用户需求}} 占位符 和 默认模式 tailReminder 使用）
    const lastUserMsg = [...chatMessages].reverse().find(m => m.role === 'user');
    const lastUserText = lastUserMsg
        ? (Array.isArray(lastUserMsg.content)
            ? (lastUserMsg.content.find(c => c.type === 'text')?.text || '')
            : String(lastUserMsg.content))
        : '';

    // 提取最后一条用户消息的截图信息（供自定义预设 {{截图信息}} 占位符使用）
    let captureInfo = '';
    let lastUserImages = {}; // 最后一条用户消息的图片数据

    if (lastUserMsg && lastUserMsg.imageRefs && lastUserMsg.imageRefs.length > 0) {
        console.log('[AI Assistant] 最后一条用户消息包含 imageRefs:', lastUserMsg.imageRefs.length, '个');
        try {
            // 批量获取图片元数据
            const metadataBatch = await getChatImagesMetadataBatch(lastUserMsg.imageRefs);
            const imageDescriptions = [];

            for (const refId of lastUserMsg.imageRefs) {
                const metadata = metadataBatch[refId];
                if (metadata && metadata.name) {
                    // 从 name 字段识别图片类型
                    if (metadata.name.includes('屏幕截图')) {
                        imageDescriptions.push('电脑屏幕截图');
                    } else if (metadata.name.includes('浏览器截图')) {
                        imageDescriptions.push('浏览器界面截图');
                    } else {
                        imageDescriptions.push('图片');
                    }
                } else {
                    imageDescriptions.push('图片');
                }

                // 收集图片数据（从 imageCache 中获取）
                if (imageCache[refId]) {
                    lastUserImages[refId] = imageCache[refId];
                    console.log('[AI Assistant] 收集图片数据:', refId, '长度:', imageCache[refId]?.length);
                } else {
                    console.warn('[AI Assistant] imageCache 中未找到图片:', refId);
                }
            }

            if (imageDescriptions.length > 0) {
                captureInfo = `\n[本次附带了 ${imageDescriptions.length} 张图片: ${imageDescriptions.join('、')}]`;
            }

            console.log('[AI Assistant] lastUserImages 构建完成，共', Object.keys(lastUserImages).length, '张图片');
        } catch (err) {
            console.error('[AI Assistant] 获取图片元数据失败:', err);
        }
    } else {
        console.log('[AI Assistant] 最后一条用户消息无 imageRefs');
    }

    // 构建 finalPrompt：自定义模式 vs 默认模式
    let finalPrompt;
    if (systemPromptStr === null) {
        // 自定义模式：使用上下文预设的 entries 作为前缀消息
        // 传递 lastUserText、captureInfo 和 lastUserImages 以支持 {{用户需求}}、{{截图信息}} 占位符和图片附加
        const { messages: prefillMessages, contextInsertIndex } = await buildCustomPrefillMessages({
            lastUserText,
            captureInfo,
            kbTriggerText,
            lastUserImages: sendImages ? lastUserImages : {}
        });

        if (contextInsertIndex >= 0) {
            // ★ 找到了 {{上下文}} 标记：在标记位置插入对话历史
            // 检查是否有 entry_user_input 条目（通过检查 prefillMessages 中是否有 id 为 entry_user_input 的）
            const hasUserInputEntry = prefillMessages.some(msg =>
                msg.content && (
                    (typeof msg.content === 'string' && msg.content.includes('<本次输入>')) ||
                    (Array.isArray(msg.content) && msg.content.some(part =>
                        part.type === 'text' && part.text.includes('<本次输入>')
                    ))
                )
            );

            // 如果有 entry_user_input 条目，对话历史应排除最后一条用户消息（避免重复）
            let historyToInsert = processedHistory;
            if (hasUserInputEntry && processedHistory.length > 0) {
                const lastMsg = processedHistory[processedHistory.length - 1];
                if (lastMsg.role === 'user') {
                    historyToInsert = processedHistory.slice(0, -1);
                    console.log('[AI Assistant] 自定义预设：对话历史排除最后一条用户消息（已在 entry_user_input 中）');
                }
            }

            const beforeContext = prefillMessages.slice(0, contextInsertIndex);
            const afterContext = prefillMessages.slice(contextInsertIndex);
            // 构建总结块（如有启用的总结）
            const summaryMessages = summaryBlock
                ? [{ role: 'system', content: summaryBlock }]
                : [];
            finalPrompt = [
                ...beforeContext,
                ...summaryMessages,       // 总结块插入到对话历史之前
                ...historyToInsert,       // 对话历史插入到标记位置
                ...afterContext
            ];
        } else {
            // 未找到 {{上下文}} 标记：不注入对话历史，仅使用预设条目
            console.warn('[AI Assistant] 自定义预设中未找到 {{上下文}} 标记，对话历史将不会被注入');
            finalPrompt = [
                ...prefillMessages
            ];
        }
    } else {
        // 默认模式：使用系统提示词模板
        // 构建总结块（如有启用的总结）
        const summaryMessages = summaryBlock
            ? [{ role: 'system', content: summaryBlock }]
            : [];
        finalPrompt = [
            { role: 'system', content: systemPromptStr },
            ...summaryMessages,       // 总结块插入到对话历史之前
            ...processedHistory,
            { role: 'system', content: buildTailReminder(lastUserText) },
            { role: 'assistant', content: '思考这个问题\n' }
        ];
    }

    // 使用节流版 UI 更新器
    const uiUpdater = createThrottledUIUpdater(handleSendFn);

    // 合并相邻同类 role 消息（system → user，相邻同 role 合并）
    finalPrompt = mergeAdjacentMessages(finalPrompt);

    console.log('[DEBUG-LLM] ▶ runLlmChain: 即将调用 executeDefaultLLMRequest');
    console.log('[DEBUG-LLM]   currentSystemMsgContent 存在:', !!currentSystemMsgContent);
    console.log('[DEBUG-LLM]   currentSystemMsgContent 在DOM中:', currentSystemMsgContent ? $.contains(document, currentSystemMsgContent[0]) : 'N/A');
    console.log('[DEBUG-LLM]   自定义模式:', systemPromptStr === null);
    console.log('[DEBUG-LLM]   finalPrompt 消息数:', finalPrompt.length);

    // 回显组合提示词到测试界面
    updateCombinedPrompt(finalPrompt, '[智绘姬助手] ');
    const resultUpdater = getResultTextareaUpdater();
    let assistantFullText = '';
    const wrappedCallback = (chunk) => {
        uiUpdater.callback(chunk);
        assistantFullText += chunk;
        if (resultUpdater) resultUpdater(assistantFullText);
    };

    await executeDefaultLLMRequest(
        { prompt: finalPrompt, id: requestId },
        profileData,
        wrappedCallback,
        'assistant'
    );

    console.log('[DEBUG-LLM] ◀ executeDefaultLLMRequest 完成');
    console.log('[DEBUG-LLM]   currentSystemMsgContent 存在:', !!currentSystemMsgContent);
    console.log('[DEBUG-LLM]   currentSystemMsgContent 在DOM中:', currentSystemMsgContent ? $.contains(document, currentSystemMsgContent[0]) : 'N/A');

    // 流结束后做一次完整的 Markdown 渲染
    uiUpdater.flush();
    const accumulatedReply = uiUpdater.getReply();

    console.log('[DEBUG] accumulatedReply length:', accumulatedReply.length,
        'hasCommand:', hasSystemCommand(accumulatedReply),
        'first 200 chars:', accumulatedReply.substring(0, 200));

    console.log('[DEBUG-LLM] flush 完成, accumulatedReply 长度:', accumulatedReply?.length);

    if (accumulatedReply) {
        // 检查是否包含系统命令
        const hasCommand = hasSystemCommand(accumulatedReply);
        const autoExecute = getAutoExecuteMode();

        // 画图/酒馆输入等命令始终自动执行，不受全局开关限制
        const isAutoNoCallback = isAutoExecuteNoCallbackOnly(accumulatedReply);

        // 如果是手动模式且包含命令（但自动执行类命令除外），显示执行按钮
        if (hasCommand && !autoExecute && !isAutoNoCallback) {
            activeChatRef.messages.push({ role: 'assistant', content: accumulatedReply });
            activeChatRef.updatedAt = Date.now();
            await syncAndSave(activeChatRef);

            finalizeAssistantMessage(activeChatRef.messages.length - 1, handleRegenerateFn);

            const cmd = createPendingCommand(currentSystemMsgElement, accumulatedReply);
            setPendingCommand(cmd);

            const buttonElement = renderExecuteButton(currentSystemMsgElement);
            cmd.buttonElement = buttonElement;
            setPendingCommand(cmd);

            buttonElement.find('button').on('click', async function () {
                await executePendingCommand(cmd, boundAppendMessage, handleRegenerateFn);
            });

            setCurrentSystemMsgElement(null);
            setCurrentSystemMsgContent(null);

            // 手动执行模式下，也需要播放对话 TTS
            tryPlayTTS(accumulatedReply, activeChatRef.messages.length - 1);

            return; // 不自动执行，等待用户点击
        }

        // 自动执行模式或无命令：继续原有逻辑
        parseAndApplySettings(accumulatedReply);
        const queryResult = await parseQueryWithProgress(accumulatedReply);

        if (queryResult !== null) {
            // 如果仅包含自动执行类命令（画图/酒馆输入等），不进行 AI 反馈（不递归调用 LLM）
            if (isAutoNoCallback) {
                console.log('[AI Assistant] 自动执行类命令已执行，跳过 AI 反馈');
            } else {
                iterState.currentIteration++;
                if (iterState.currentIteration <= iterState.maxIterations) {
                    activeChatRef.messages.push({ role: 'assistant', content: accumulatedReply });
                    activeChatRef.messages.push({ role: 'user', content: queryResult });
                    await boundAppendMessage('user', queryResult);
                    setCurrentSystemMsgElement(null);
                    setCurrentSystemMsgContent(null);
                    await appendSystemEmptyMessage();
                    if (currentSystemMsgContent) {
                        currentSystemMsgContent.html('<i><span style="color:var(--st-chatu8-text-secondary);">已获取最新系统参数，思考中...</span></i>');
                    }

                    console.log('[AI Assistant] 发生内部系统调用, 重定向二次查询...', queryResult);

                    // 工具调用前，先尝试播放当前回复中的对话 TTS
                    // （因为递归调用后会 return，跳过后面的 tryPlayTTS）
                    // 注意：assistant 消息在 messages.length - 2（因为后面紧跟了 user 消息）
                    tryPlayTTS(accumulatedReply, activeChatRef.messages.length - 2);

                    await runLlmChain(activeChatRef, profileData, requestId, iterState, handleSendFn, handleRegenerateFn, boundAppendMessage);
                    return;
                } else {
                    if (currentSystemMsgContent) {
                        currentSystemMsgContent.html(escapeHTML(accumulatedReply + "\n\n(抱歉，调用系统工具次数已达上限，请换个提问方式)").replace(/\n/g, '<br>'));
                    }
                }
            } // end of !isImageOnly else block
        }

        activeChatRef.messages.push({ role: 'assistant', content: accumulatedReply });
        activeChatRef.updatedAt = Date.now();

        console.log('[DEBUG-LLM] ▶ 即将调用 syncAndSave()');
        console.log('[DEBUG-LLM]   currentSystemMsgContent 在DOM中:', currentSystemMsgContent ? $.contains(document, currentSystemMsgContent[0]) : 'N/A');
        await syncAndSave(activeChatRef);
        console.log('[DEBUG-LLM] ◀ syncAndSave() 完成');
        console.log('[DEBUG-LLM]   syncAndSave后 currentSystemMsgContent 在DOM中:', currentSystemMsgContent ? $.contains(document, currentSystemMsgContent[0]) : 'N/A');

        console.log('[DEBUG-LLM] ▶ 即将调用 finalizeAssistantMessage()');
        finalizeAssistantMessage(activeChatRef.messages.length - 1, handleRegenerateFn);
        console.log('[DEBUG-LLM] ◀ finalizeAssistantMessage() 完成');

        // TTS 语音朗读
        tryPlayTTS(accumulatedReply, activeChatRef.messages.length - 1);

        // 检测生图请求
        if (currentSystemMsgElement) {
            detectImageGenerationRequest(currentSystemMsgElement, accumulatedReply);
        }
    }
}

/**
 * @param {Function|null} handleSendFn
 * @param {Function} handleRegenerateFn
 * @param {Function} boundAppendMessage
 */
export async function generateAiResponse(handleSendFn, handleRegenerateFn, boundAppendMessage) {
    if (!activeChat) return;

    const requestId = 'ai-assistant-' + Date.now().toString();
    const profileData = buildProfileData();
    const iterState = { currentIteration: 0, maxIterations: 10 };

    try {
        setIsAiGenerating(true);
        updateSendButtonState();
        notifyAiGenerating();
        await runLlmChain(activeChat, profileData, requestId, iterState, handleSendFn, handleRegenerateFn, boundAppendMessage);
    } catch (error) {
        const errorMsg = error.message || '未知错误';
        if (currentSystemMsgContent) {
            currentSystemMsgContent.html(`<span style="color:red">请求出错: ${escapeHTML(errorMsg)}</span>`);
        }
        if (isConversationMode()) {
            speakNotification(`请求出错：${errorMsg}`);
        }
    } finally {
        setCurrentSystemMsgElement(null);
        setCurrentSystemMsgContent(null);
        setIsAiGenerating(false);
        updateSendButtonState();
        notifyAiGenerationDone();
    }
}

/**
 * @param {number} messageIndex
 * @param {Function} handleSendFn
 * @param {Function} handleRegenerateFn
 * @param {Function} boundAppendMessage
 * @param {Function} switchChatFn
 */
export async function handleRegenerateMessage(messageIndex, handleSendFn, handleRegenerateFn, boundAppendMessage, switchChatFn) {
    if (!activeChat) return;
    if (!Number.isInteger(messageIndex) || messageIndex < 0 || messageIndex >= activeChat.messages.length) return;

    const targetMessage = activeChat.messages[messageIndex];
    if (!targetMessage || targetMessage.role !== 'assistant') {
        console.warn('[AI Assistant] handleRegenerateMessage 目标消息不是 assistant，已跳过:', messageIndex, targetMessage);
        return;
    }

    activeChat.messages = activeChat.messages.slice(0, messageIndex);
    activeChat.updatedAt = Date.now();

    await syncAndSave(activeChat);
    await switchChat(activeChat.id, boundAppendMessage);
    await appendSystemEmptyMessage();
    await generateAiResponse(handleSendFn, handleRegenerateFn, boundAppendMessage);
}

/**
 * 处理发送消息
 * V2 适配：图片提取 → saveChatImage → 消息中存 imageRefs 而非内嵌 Base64
 * @param {Function} handleSendFn - 自身引用（用于递归调用）
 * @param {Function} handleRegenerateFn
 * @param {Function} boundAppendMessage
 * @param {Function} switchChatFn
 */
export async function handleSend(handleSendFn, handleRegenerateFn, boundAppendMessage, switchChatFn) {
    clearPendingCommand();
    dismissAskChoices();

    const text = dom.inputArea.val().trim();
    if (!text && selectedImages.length === 0) return;

    // 检查是否处于编辑模式
    const editingIndex = dom.inputArea.data('editing-index');
    const isEditing = editingIndex !== undefined && editingIndex !== null;

    if (isEditing) {
        if (!activeChat || !Number.isInteger(editingIndex) || editingIndex < 0 || editingIndex >= (activeChat.messages?.length || 0)) {
            console.warn('[AI Assistant] 检测到失效的 editing-index，已降级为普通发送:', editingIndex);
            dom.inputArea.removeData('editing-index');
            dom.chatBody.find('.st-chatu8-ai-msg').removeClass('editing');
        } else {
            dom.inputArea.removeData('editing-index');
            dom.chatBody.find('.st-chatu8-ai-msg').removeClass('editing');
            await handleEditAndRegenerate(editingIndex, text, handleSendFn, handleRegenerateFn, boundAppendMessage, switchChatFn);
            return;
        }
    }

    // 正常发送模式
    const aiConfig = extension_settings[extensionName]?.chatu8_ai_assistant || {};
    const apiKey = aiConfig.api_key;
    if (!apiKey) {
        toastr?.error('未配置智绘姬 API Key，请点击齿轮图标设置。');
        return;
    }

    if (!activeChat) {
        await startNewChat(boundAppendMessage);
    }
    // 此时 activeChat 已通过 setActiveChat 更新
    // 获取当前 activeChat 的引用用于后续操作
    const currentChat = activeChat;

    // 【屏幕共享】自动截取屏幕/浏览器截图
    let screenCaptures = [];
    try {
        screenCaptures = await captureForMessage();
        if (screenCaptures.length > 0) {
            console.log(`[AI Assistant] 自动附加 ${screenCaptures.length} 张截图`);
        }
    } catch (err) {
        console.warn('[AI Assistant] 自动截图失败:', err.message);
    }

    // 合并用户手动选择的图片 + 自动截图
    const allImages = [...selectedImages, ...screenCaptures];

    // V2: 将图片保存到图片层，获取 imageRefs
    let imageRefs = [];
    if (allImages.length > 0) {
        imageRefs = await _saveImagesAndGetRefs(allImages, currentChat.id);
    }

    // V2: 构建消息内容（纯文本 + imageRefs）
    const messageContent = text || (allImages.length > 0 ? '请分析这些图片' : '');

    // 自动命名
    if (currentChat.messages.length === 0) {
        const titleText = text || '图片对话';
        currentChat.title = titleText.substring(0, 15) + (titleText.length > 15 ? '...' : '');
    }

    // V2: 消息存储为纯文本 + imageRefs（不再内嵌 Base64）
    const newMessage = {
        role: 'user',
        content: messageContent
    };
    if (imageRefs.length > 0) {
        newMessage.imageRefs = imageRefs;
    }
    currentChat.messages.push(newMessage);

    const currentMessageIndex = currentChat.messages.length - 1;

    // UI 渲染时仍传递原始图片数据供即时显示
    await boundAppendMessage('user', text, allImages.length > 0 ? [...allImages] : null, currentMessageIndex);

    dom.inputArea.val('');
    adjustInputHeight();
    currentChat.updatedAt = Date.now();
    await syncAndSave(currentChat);

    clearImageSelection();

    appendSystemEmptyMessage();
    const requestId = 'ai-assistant-' + Date.now().toString();
    const profileData = buildProfileData();
    const iterState = { currentIteration: 0, maxIterations: 10 };

    try {
        setIsAiGenerating(true);
        updateSendButtonState();
        notifyAiGenerating(); // 通知 ASR 多轮对话模式禁音
        await runLlmChain(currentChat, profileData, requestId, iterState, handleSendFn, handleRegenerateFn, boundAppendMessage);
    } catch (error) {
        const errorMsg = error.message || '未知错误';
        if (currentSystemMsgContent) {
            currentSystemMsgContent.html(`<span style="color:red">请求出错: ${escapeHTML(errorMsg)}</span>`);
        }
        // 多轮对话模式下，用 TTS 播报错误提示
        if (isConversationMode()) {
            speakNotification(`请求出错：${errorMsg}`);
        }
    } finally {
        setCurrentSystemMsgElement(null);
        setCurrentSystemMsgContent(null);
        setIsAiGenerating(false);
        updateSendButtonState();
        notifyAiGenerationDone(); // 通知 ASR 多轮对话模式：AI 生成完毕
    }
}

/**
 * 处理编辑并重新生成
 * V2 适配：图片提取 → saveChatImage → 消息中存 imageRefs
 * @param {number} editingIndex
 * @param {string} newText
 * @param {Function} handleSendFn
 * @param {Function} handleRegenerateFn
 * @param {Function} boundAppendMessage
 * @param {Function} switchChatFn
 */
export async function handleEditAndRegenerate(editingIndex, newText, handleSendFn, handleRegenerateFn, boundAppendMessage, switchChatFn) {
    if (!activeChat) return;

    const currentChat = activeChat;
    if (!Number.isInteger(editingIndex) || editingIndex < 0 || editingIndex >= (currentChat.messages?.length || 0)) {
        console.warn('[AI Assistant] handleEditAndRegenerate 收到无效 editingIndex，已取消编辑重发:', editingIndex);
        return;
    }

    // 【屏幕共享】自动截取屏幕/浏览器截图
    let editScreenCaptures = [];
    try {
        editScreenCaptures = await captureForMessage();
        if (editScreenCaptures.length > 0) {
            console.log(`[AI Assistant] 编辑重发：自动附加 ${editScreenCaptures.length} 张截图`);
        }
    } catch (err) {
        console.warn('[AI Assistant] 编辑重发：自动截图失败:', err.message);
    }

    // 合并用户手动选择的图片 + 自动截图
    const allEditImages = [...selectedImages, ...editScreenCaptures];

    // V2: 将图片保存到图片层，获取 imageRefs
    let imageRefs = [];
    if (allEditImages.length > 0) {
        imageRefs = await _saveImagesAndGetRefs(allEditImages, currentChat.id);
    }

    // V2: 构建新的消息内容（纯文本 + imageRefs）
    const messageContent = newText || (allEditImages.length > 0 ? '请分析这些图片' : '');

    const newMessage = {
        role: 'user',
        content: messageContent
    };
    if (imageRefs.length > 0) {
        newMessage.imageRefs = imageRefs;
    }

    currentChat.messages[editingIndex] = newMessage;
    currentChat.messages = currentChat.messages.slice(0, editingIndex + 1);
    currentChat.updatedAt = Date.now();

    await syncAndSave(currentChat);

    // 手动刷新 UI：外科手术式更新，只移除编辑位置及其之后的消息元素
    // 不清空整个聊天区域，避免重新渲染所有历史消息
    dom.chatBody.find('.st-chatu8-ai-msg').filter(function () {
        const idx = parseInt($(this).attr('data-msg-index'));
        return !isNaN(idx) && idx >= editingIndex;
    }).remove();

    // 更新滚动状态中的消息总数（编辑后消息数 = editingIndex + 1）
    const newTotal = currentChat.messages.length;
    updateScrollStateAfterEdit(newTotal);

    // 只渲染编辑后的消息（图片直接使用已在内存中的 allEditImages，无需重新读取 DB）
    const editedImages = allEditImages.length > 0 ? allEditImages : null;
    await boundAppendMessage(newMessage.role, newMessage.content, editedImages, editingIndex, false);

    dom.chatBody.scrollTop(dom.chatBody[0].scrollHeight);

    dom.inputArea.val('');
    adjustInputHeight();
    clearImageSelection();

    appendSystemEmptyMessage();
    const requestId = 'ai-assistant-' + Date.now().toString();
    const profileData = buildProfileData();
    const iterState = { currentIteration: 0, maxIterations: 10 };

    try {
        setIsAiGenerating(true);
        updateSendButtonState();
        notifyAiGenerating(); // 通知 ASR 多轮对话模式禁音
        await runLlmChain(currentChat, profileData, requestId, iterState, handleSendFn, handleRegenerateFn, boundAppendMessage);
    } catch (error) {
        const errorMsg = error.message || '未知错误';
        if (currentSystemMsgContent) {
            currentSystemMsgContent.html(`<span style="color:red">请求出错: ${escapeHTML(errorMsg)}</span>`);
        }
        // 多轮对话模式下，用 TTS 播报错误提示
        if (isConversationMode()) {
            speakNotification(`请求出错：${errorMsg}`);
        }
    } finally {
        setCurrentSystemMsgElement(null);
        setCurrentSystemMsgContent(null);
        setIsAiGenerating(false);
        updateSendButtonState();
        notifyAiGenerationDone(); // 通知 ASR 多轮对话模式：AI 生成完毕
    }
}

// ═══════════════════════════════════════════════════════════
//  初始化输入事件
// ═══════════════════════════════════════════════════════════

/**
 * 初始化输入区域和发送按钮事件
 * @param {Function} handleSendFn - 绑定好的 handleSend
 */
export function initInputEvents(handleSendFn) {
    // 回车发送 (Shift+Enter换行)
    dom.inputArea.on('keydown', function (e) {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            handleSendFn();
        }
    });

    // 自适应高度调整
    dom.inputArea.on('input', adjustInputHeight);

    // 发送/停止按钮
    dom.sendBtn.on('click', function () {
        if (isAiGenerating) {
            abortLLMChannelRequest('assistant');
        } else {
            handleSendFn();
        }
    });
}
