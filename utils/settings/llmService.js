/* global toastr */
// @ts-nocheck
/**
 * llmService.js - LLM 核心服务层
 * 
 * 包含所有 LLM 核心业务逻辑（不依赖 DOM）：
 * - API 请求执行
 * - 配置获取
 * - 流处理
 * - 状态管理
 */

import { extension_settings } from "../../../../../extensions.js";
import { eventSource } from "../../../../../../script.js";
import { extensionName, eventNames, LLMRequestTypes } from "../config.js";
import { getRequestHeaders, clearLog, addLog } from "../utils.js";
import { startFabLoading, stopFabLoading } from "./fab.js";
import { checkTriggerWords, mergeAdjacentMessages } from "../promptProcessor.js";
import { processRollPlaceholders } from "./rollProcessor.js";
import { taskQueue, TaskType, TaskStatus } from "../taskQueue.js";

// ==================== 状态管理（多并发） ====================

/**
 * 所有活动 LLM 请求的中央注册表（支持多并发）
 * key: 唯一请求标识 (string)
 * value: { controller: AbortController, kind: 'typed'|'default', channel?: string, requestType?: string, id?: string }
 */
const activeRequests = new Map();

// 存储任务 ID 与 AbortController 的关联（用于从任务队列取消）
const llmTaskControllers = new Map();

// Fab 加载动画引用计数：仅当 0→1 时启动动画，1→0 时停止
let fabLoadingRefCount = 0;

/** 生成唯一请求 key */
let _reqSeq = 0;
function generateRequestKey(prefix) {
    return `${prefix}_${Date.now()}_${++_reqSeq}`;
}

/** 增加 fab loading 引用计数 */
function acquireFabLoading() {
    fabLoadingRefCount++;
    if (fabLoadingRefCount === 1) {
        startFabLoading();
    }
}

/** 减少 fab loading 引用计数 */
function releaseFabLoading() {
    fabLoadingRefCount--;
    if (fabLoadingRefCount <= 0) {
        fabLoadingRefCount = 0;
        stopFabLoading();
    }
}

// 监听 LLM 取消事件
eventSource.on('st_chatu8_cancel_llm_task', ({ taskId }) => {
    const controller = llmTaskControllers.get(taskId);
    if (controller) {
        controller.abort();
        llmTaskControllers.delete(taskId);
        console.log(`[LLM] 任务已取消: ${taskId}`);
    }
});

/**
 * 获取当前任一活动的 LLM 请求控制器（向后兼容）
 * @returns {AbortController|null}
 */
export function getLLMRequestController() {
    for (const entry of activeRequests.values()) {
        if (entry.controller) return entry.controller;
    }
    return null;
}

/**
 * 设置当前 LLM 请求控制器（向后兼容，多并发模式下为 no-op）
 * @param {AbortController|null} controller
 * @deprecated 多并发模式下，控制器由各请求自行管理
 */
export function setLLMRequestController(controller) {
    // no-op：保留接口兼容性
}

/**
 * 检查当前是否有正在进行的 LLM 请求。
 * @returns {boolean}
 */
export function isLLMRequestActive() {
    return activeRequests.size > 0;
}

/**
 * 获取当前活动请求数量
 * @returns {number}
 */
export function getActiveLLMRequestCount() {
    return activeRequests.size;
}

/**
 * 中止所有正在进行的 LLM 请求。
 */
export function abortLLMRequest() {
    if (activeRequests.size === 0) return;
    for (const [key, entry] of activeRequests) {
        entry.controller.abort();
    }
    activeRequests.clear();
    toastr.info('所有 LLM 请求已中止。');
}

/**
 * 针对特定通道/请求类型中止 LLM 请求
 * @param {string} channel - 通道名称或请求类型
 * @returns {boolean} 是否成功中止了至少一个请求
 */
export function abortLLMChannelRequest(channel) {
    let aborted = false;
    for (const [key, entry] of activeRequests) {
        if (entry.channel === channel || entry.requestType === channel) {
            entry.controller.abort();
            activeRequests.delete(key);
            aborted = true;
        }
    }
    return aborted;
}

// ==================== 重试逻辑辅助函数 ====================

/**
 * 判断错误是否应该重试
 * @param {Object} error - 错误对象或响应对象
 * @param {number} attempt - 当前尝试次数
 * @param {number} maxRetries - 最大重试次数
 * @returns {boolean} 是否应该重试
 */
function shouldRetryError(error, attempt, maxRetries) {
    if (attempt >= maxRetries) return false;

    // 检查错误消息
    const errorMsg = error.message || String(error);
    const errorMsgLower = errorMsg.toLowerCase();

    // 429 限流错误
    if (errorMsg.includes('429') ||
        errorMsgLower.includes('rate limit') ||
        errorMsgLower.includes('too many requests')) {
        return true;
    }

    // 服务器错误 (5xx)
    if (errorMsg.includes('500') || errorMsg.includes('502') ||
        errorMsg.includes('503') || errorMsg.includes('504')) {
        return true;
    }

    // 网络错误
    if (errorMsgLower.includes('network') ||
        errorMsgLower.includes('fetch')) {
        return true;
    }

    return false;
}

/**
 * 判断响应是否为空（需要重试）
 * @param {string} reply - LLM 响应内容
 * @returns {boolean} 是否为空响应
 */
function isEmptyResponse(reply) {
    return !reply || reply.trim() === '';
}

/**
 * 判断是否为不可重试的错误
 * @param {Error} error - 错误对象
 * @returns {boolean} 是否为不可重试的错误
 */
function isNonRetryableError(error) {
    // 用户主动中止
    if (error.name === 'AbortError') {
        return true;
    }

    const errorMsg = error.message || '';

    // 配置错误
    if (errorMsg.includes('未配置')) {
        return true;
    }

    // 认证错误 (401/403)
    if (errorMsg.includes('401') || errorMsg.includes('403')) {
        return true;
    }

    // 无效请求 (400)
    if (errorMsg.includes('400')) {
        return true;
    }

    return false;
}


// ==================== 多模态工具 ====================

/**
 * 当 LLM 配置中「发送图片」开关关闭时，从消息数组中移除所有图片内容。
 * 仅过滤发送给 API 的消息，不影响 UI 或聊天历史。
 *
 * @param {Array<{role: string, content: string|Array}>|any} messages
 * @returns {Array<{role: string, content: string|Array}>|any}
 */
/**
 * 统计消息数组里 image_url 片段的数量（用于诊断日志）
 * @param {Array<{role: string, content: string|Array}>|any} messages
 * @returns {number}
 */
export function countImageParts(messages) {
    if (!Array.isArray(messages)) return 0;
    let count = 0;
    for (const msg of messages) {
        if (msg && Array.isArray(msg.content)) {
            for (const part of msg.content) {
                if (part && part.type === 'image_url') count++;
            }
        }
    }
    return count;
}

export function stripImagesFromMessages(messages) {
    if (!Array.isArray(messages)) return messages;
    return messages.map(msg => {
        // 统计/诊断逻辑见调用方；这里只做纯过滤
        // (no-op: keep behavior identical, only filter image_url parts)
        if (!msg || !Array.isArray(msg.content)) return msg;
        const filtered = msg.content.filter(part => part && part.type !== 'image_url');
        // 如果过滤后只剩一段文本，转回字符串以保持兼容性
        if (filtered.length === 1 && filtered[0].type === 'text') {
            return { ...msg, content: filtered[0].text || '' };
        }
        if (filtered.length === 0) {
            return { ...msg, content: '' };
        }
        return { ...msg, content: filtered };
    });
}

// ==================== 格式化工具 ====================

/**
 * 格式化 prompt 对象为可读的文本格式
 * @param {Array|Object|string} prompt - 要格式化的 prompt（可以是消息数组、对象或字符串）
 * @returns {string} 格式化后的文本
 */
export function formatPromptForDisplay(prompt) {
    // 如果已经是字符串，直接返回
    if (typeof prompt === 'string') {
        return prompt;
    }

    // 如果是消息数组（OpenAI Chat API 格式）
    if (Array.isArray(prompt)) {
        const formattedLines = [];

        prompt.forEach((message, index) => {
            const role = message.role || 'unknown';
            const roleLabel = getRoleLabel(role);

            formattedLines.push(`${'═'.repeat(50)}`);
            formattedLines.push(`【${roleLabel}】`);
            formattedLines.push(`${'─'.repeat(50)}`);

            // 处理 content（可能是字符串或数组，用于多模态）
            const content = message.content;
            if (typeof content === 'string') {
                formattedLines.push(content);
            } else if (Array.isArray(content)) {
                // 多模态内容
                content.forEach(part => {
                    if (part.type === 'text') {
                        formattedLines.push(part.text || '');
                    } else if (part.type === 'image_url') {
                        const imageUrl = part.image_url?.url || '';
                        if (imageUrl.startsWith('data:')) {
                            // 提取图片类型和大小信息
                            const mimeMatch = imageUrl.match(/^data:([^;]+);/);
                            const mimeType = mimeMatch ? mimeMatch[1] : 'unknown';
                            const base64Part = imageUrl.split(',')[1] || '';
                            const sizeKB = Math.round((base64Part.length * 3 / 4) / 1024);
                            formattedLines.push(`📷 [用户上传的图片: ${mimeType}, 约 ${sizeKB}KB]`);
                        } else {
                            formattedLines.push(`📷 [图片链接: ${imageUrl}]`);
                        }
                    }
                });
            }

            formattedLines.push('');
        });

        return formattedLines.join('\n');
    }

    // 如果是其他对象，尝试格式化
    if (typeof prompt === 'object' && prompt !== null) {
        return JSON.stringify(prompt, null, 2);
    }

    return String(prompt);
}

/**
 * 根据角色返回中文标签
 * @param {string} role - 角色名（system/user/assistant 等）
 * @returns {string} 中文标签
 */
export function getRoleLabel(role) {
    const roleMap = {
        'system': '系统提示词',
        'user': '用户',
        'assistant': 'AI助手',
        'function': '函数调用',
        'tool': '工具'
    };
    return roleMap[role] || role;
}

// ==================== 配置获取 ====================

/**
 * 获取当前选中的 LLM 配置
 * @returns {object} LLM 配置对象
 */
export function getCurrentLLMProfile() {
    const profiles = extension_settings[extensionName].llm_profiles || {};
    const currentProfileName = extension_settings[extensionName].current_llm_profile;
    return profiles[currentProfileName] || profiles[Object.keys(profiles)[0]] || {};
}

/**
 * 获取当前选中的测试上下文
 * @returns {object} 测试上下文对象
 */
export function getCurrentTestContext() {
    const contexts = extension_settings[extensionName].test_context_profiles || {};
    const currentContextName = extension_settings[extensionName].current_test_context_profile;
    return contexts[currentContextName] || contexts[Object.keys(contexts)[0]] || {};
}

/**
 * 获取指定请求类型对应的合并选项
 * @param {string} requestType - 请求类型
 * @returns {object} 合并选项，可直接传给 mergeAdjacentMessages
 */
export function getMergeOptionsForRequestType(requestType) {
    const configs = extension_settings[extensionName].llm_request_type_configs || {};
    const typeConfig = configs[requestType] || { api_profile: '默认' };
    const apiProfileName = typeConfig.api_profile || '默认';
    const llmProfiles = extension_settings[extensionName].llm_profiles || {};
    const apiProfile = llmProfiles[apiProfileName] || llmProfiles[Object.keys(llmProfiles)[0]] || {};
    return {
        mergeSystemUser: apiProfile.merge_system_user ?? false
    };
}

/**
 * 获取指定请求类型的有效配置（从选择的预设中获取配置）
 * @param {string} requestType - 请求类型
 * @returns {object} 配置对象，包含 LLM 配置和上下文配置
 */
export function getEffectiveConfigForRequestType(requestType) {
    const configs = extension_settings[extensionName].llm_request_type_configs || {};
    const typeConfig = configs[requestType] || { api_profile: '默认', context_profile: '默认' };

    const llmProfiles = extension_settings[extensionName].llm_profiles || {};
    const contextProfiles = extension_settings[extensionName].test_context_profiles || {};

    // 获取选择的 API 配置预设
    const apiProfileName = typeConfig.api_profile || '默认';
    const apiProfile = llmProfiles[apiProfileName] || llmProfiles[Object.keys(llmProfiles)[0]] || {};

    // 获取选择的上下文预设
    const contextProfileName = typeConfig.context_profile || '默认';
    const contextProfile = contextProfiles[contextProfileName] || contextProfiles[Object.keys(contextProfiles)[0]] || {};

    return {
        // LLM API 配置
        api_url: apiProfile.api_url || '',
        api_key: apiProfile.api_key || '',
        model: apiProfile.model || '',
        temperature: apiProfile.temperature ?? 0.7,
        top_p: apiProfile.top_p ?? 1.0,
        max_tokens: apiProfile.max_tokens ?? 512,
        stream: apiProfile.stream ?? false,
        bypass_proxy: apiProfile.bypass_proxy ?? false,
        send_images: apiProfile.send_images ?? false,
        // 上下文配置
        context: contextProfile
    };
}

/**
 * 根据请求类型构建对应的提示词
 * @param {string} requestType - 请求类型
 * @param {string} [triggerText] - 可选的触发文本，用于触发词过滤
 * @returns {Array} 消息数组
 */
export function buildPromptForRequestType(requestType, triggerText = '') {
    const configs = extension_settings[extensionName].llm_request_type_configs || {};
    const typeConfig = configs[requestType] || { context_profile: '默认' };
    const contextProfileName = typeConfig.context_profile || '默认';

    const contextProfiles = extension_settings[extensionName].test_context_profiles || {};
    const contextProfile = contextProfiles[contextProfileName] || contextProfiles[Object.keys(contextProfiles)[0]] || {};

    const messages = [];

    // 新格式：使用 entries 数组
    if (contextProfile.entries && Array.isArray(contextProfile.entries)) {
        contextProfile.entries.forEach(entry => {
            // 跳过禁用的条目
            if (!entry.enabled) return;
            // 跳过空内容
            if (!entry.content || entry.content.trim() === '') return;

            // 触发模式逻辑
            if (entry.triggerMode === 'trigger') {
                // 触发模式：检查触发词是否在触发文本中出现
                if (!triggerText || !checkTriggerWords(entry.triggerWords, triggerText)) {
                    return; // 未触发，跳过此条目
                }
                // 并列触发词检查
                if (entry.andTriggerWords && entry.andTriggerWords.trim() !== '') {
                    if (!checkTriggerWords(entry.andTriggerWords, triggerText)) {
                        return; // 并列触发未满足，跳过
                    }
                }
            }
            // 'always' 模式或未指定模式：直接包含

            messages.push({ role: entry.role || 'user', content: entry.content });
        });
    }
    // 兼容旧格式：使用 history 数组
    else if (contextProfile.history && Array.isArray(contextProfile.history)) {
        contextProfile.history.forEach(h => {
            if (h.user && h.user.trim() !== '') {
                messages.push({ role: "user", content: h.user });
            }
            if (h.assistant && h.assistant.trim() !== '') {
                messages.push({ role: "assistant", content: h.assistant });
            }
        });
    }

    // ★ 合并相邻相同角色的消息（根据 API 配置决定是否合并 system+user）
    const mergeOptions = getMergeOptionsForRequestType(requestType);
    const mergedMessages = mergeAdjacentMessages(messages, mergeOptions);

    // ★ 处理 {{roll N}} 占位符
    const processedMessages = processRollPlaceholders(mergedMessages);

    return processedMessages;
}

// ==================== LLM 请求执行 ====================

/**
 * 请求类型名称映射
 */
const REQUEST_TYPE_NAMES = {
    'image_gen': '正文图片生成',
    'char_design': '角色/服装设计',
    'char_display': '角色/服装展示',
    'char_modify': '角色/服装修改',
    'translation': '翻译',
    'tag_modify': 'Tag修改',
    'ai_assistant': '智绘姬助手',
    'persona_gen': '人设生成',
    'user_persona_gen': 'User人设生成'
};

/**
 * 通用的 LLM 请求执行函数
 * @param {object} data - 事件数据，包含 { prompt, id }
 * @param {string} requestType - 请求类型
 * @param {string} responseEventName - 响应事件名称
 * @param {function} [updateResultUI] - 可选的 UI 更新回调函数
 */
export async function executeTypedLLMRequest(data, requestType, responseEventName, updateResultUI = null) {
    const { prompt, id } = data;
    if (!id || !prompt) return;

    const typeName = REQUEST_TYPE_NAMES[requestType] || requestType;
    const maxRetries = extension_settings[extensionName].llm_retry_count ?? 0;
    let attempt = 0;
    let lastError = null;

    // 重试循环
    while (attempt <= maxRetries) {
        // 多并发：为此次请求创建独立的 AbortController，不中断其他并发请求
        const controller = new AbortController();
        const signal = controller.signal;
        const requestKey = generateRequestKey(`typed_${requestType}`);

        // 注册到活动请求表
        activeRequests.set(requestKey, {
            controller,
            kind: 'typed',
            requestType,
            id
        });

        // 添加任务到队列（仅第一次）
        let taskId;
        if (attempt === 0) {
            taskId = taskQueue.addTask({
                name: `LLM: ${typeName}`,
                type: TaskType.LLM,
                prompt: id
            });

            // 存储任务 ID 与 AbortController 的关联
            llmTaskControllers.set(taskId, controller);

            // 更新任务状态为运行中
            taskQueue.updateStatus(taskId, TaskStatus.RUNNING);

            // 启动悬浮球加载动画（引用计数）
            acquireFabLoading();
        } else {
            // 重试时更新控制器
            llmTaskControllers.set(taskId, controller);
        }

        // 判断是否为智绘姬AI助手的请求（通过请求ID前缀判断）
        const isAiAssistantRequest = String(id).startsWith('ai-assistant-') || String(id).length === 13;

        // 记录请求的 prompt（智绘姬AI助手的请求不记录日志，避免污染系统日志）
        if (!isAiAssistantRequest && attempt === 0) {
            addLog(`===== LLM 请求开始 (${typeName}) [${requestKey}] =====`);
            addLog(`请求 ID: ${id}`);
            addLog(`发送的 Prompt:`);
            addLog(formatPromptForDisplay(prompt));
        }

        // 重试提示
        if (attempt > 0) {
            const retryMsg = `第 ${attempt} 次重试（共 ${maxRetries} 次）...`;
            console.log(`[LLM Retry] ${typeName} ${retryMsg}`);
            if (!isAiAssistantRequest) {
                addLog(`⏳ ${retryMsg}`);
            }
            if (updateResultUI) {
                updateResultUI(`${retryMsg}\n正在处理 ${typeName} 请求，请稍候...`);
            }
            // 等待 2 秒后重试
            await new Promise(resolve => setTimeout(resolve, 2000));
        }

        const config = getEffectiveConfigForRequestType(requestType);
        const { api_url, api_key, model, temperature, top_p, max_tokens, stream, bypass_proxy, send_images } = config;

        // 如果该请求类型对应的 LLM 配置关闭了「发送图片」，过滤掉 prompt 中的图片
        // ── 诊断：打印当前请求实际读到的 send_images，以及对应的 api_profile 名称 ──
        try {
            const _typeCfg = (extension_settings[extensionName].llm_request_type_configs || {})[requestType] || {};
            const _apiProfileName = _typeCfg.api_profile || '默认';
            const _imgCount = countImageParts(prompt);
            console.warn(
                `[发送图片诊断] requestType=${requestType} | api_profile="${_apiProfileName}" | send_images=${send_images} | prompt 中图片数=${_imgCount} | 将${send_images ? '保留' : '剥离'}图片`
            );
        } catch (_e) { /* 诊断输出失败不影响主流程 */ }
        const outboundMessages = send_images ? prompt : stripImagesFromMessages(prompt);

        if (!api_url || !api_key || !model) {
            const errorMsg = `${typeName}: API URL, API Key, 或 Model 未配置。`;
            toastr.error(errorMsg);
            activeRequests.delete(requestKey);
            if (attempt === 0) {
                releaseFabLoading();
                llmTaskControllers.delete(taskId);
            }
            eventSource.emit(responseEventName, { success: false, result: errorMsg, id: id });
            return;
        }

        // 根据 bypass_proxy 决定请求方式
        const customApiUrl = api_url.replace(/\/$/, '');
        let requestUrl, requestHeaders, requestBody;

        if (bypass_proxy) {
            // 直接请求 OpenAI 格式 API（绕过酒馆代理）
            requestUrl = `${customApiUrl}/chat/completions`;
            requestHeaders = {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${api_key}`
            };
            requestBody = {
                model: model,
                messages: outboundMessages,
                temperature: temperature,
                top_p: top_p,
                max_tokens: max_tokens,
                stream: stream,
            };
        } else {
            // 使用 SillyTavern 后端代理，避免 CORS 问题
            // 酒馆代理需要的 custom_url 格式：会自动追加 /chat/completions
            let proxyBaseUrl = customApiUrl;

            requestUrl = '/api/backends/chat-completions/generate';
            requestHeaders = getRequestHeaders(window.token);
            requestBody = {
                chat_completion_source: 'custom',
                custom_url: proxyBaseUrl,
                custom_include_headers: `Authorization: "Bearer ${api_key}"`,
                model: model,
                messages: outboundMessages,
                temperature: temperature,
                top_p: top_p,
                max_tokens: max_tokens,
                stream: stream,
            };
        }

        if (updateResultUI && attempt === 0) {
            updateResultUI(`正在处理 ${typeName} 请求，请稍候...`);
        }

        try {
            const response = await fetch(requestUrl, {
                method: 'POST',
                headers: requestHeaders,
                body: JSON.stringify(requestBody),
                signal,
            });

            if (!response.ok) {
                // 尝试解析错误响应
                try {
                    const errorData = await response.json();
                    if (errorData.error) {
                        let errorMsg;
                        if (typeof errorData.error === 'object' && errorData.error.message) {
                            errorMsg = `${errorData.error.message}`;
                            const details = [];
                            if (errorData.error.type) details.push(`类型: ${errorData.error.type}`);
                            if (errorData.error.code) details.push(`代码: ${errorData.error.code}`);
                            if (details.length > 0) {
                                errorMsg += ` (${details.join(', ')})`;
                            }
                        } else {
                            errorMsg = `${JSON.stringify(errorData.error)}`;
                        }
                        throw new Error(errorMsg);
                    }
                } catch (parseError) {
                    if (parseError.message.includes('类型:') || parseError.message.includes('代码:')) {
                        throw parseError;
                    }
                }
                throw new Error(`请求失败: ${response.status} ${response.statusText}`);
            }

            let reply = '';

            if (stream) {
                // 流式处理：使用 SSE 读取
                const reader = response.body.getReader();
                const decoder = new TextDecoder('utf-8');
                let buffer = '';
                let hasReasoning = false;
                let reasoningEnded = false;

                while (true) {
                    const { done, value } = await reader.read();
                    if (done) break;

                    buffer += decoder.decode(value, { stream: true });
                    const lines = buffer.split('\n');
                    buffer = lines.pop() || '';

                    for (const line of lines) {
                        const trimmedLine = line.trim();
                        if (!trimmedLine || trimmedLine === 'data: [DONE]') continue;

                        if (trimmedLine.startsWith('data: ')) {
                            try {
                                const jsonStr = trimmedLine.slice(6);
                                const chunk = JSON.parse(jsonStr);
                                const deltaReasoning = chunk.choices?.[0]?.delta?.reasoning_content;
                                if (deltaReasoning) {
                                    hasReasoning = true;
                                    reply += deltaReasoning;
                                    if (updateResultUI) {
                                        updateResultUI(reply);
                                    }
                                }
                                const delta = chunk.choices?.[0]?.delta?.content;
                                if (delta) {
                                    if (hasReasoning && !reasoningEnded) {
                                        reply += "\n\n";
                                        reasoningEnded = true;
                                    }
                                    reply += delta;
                                    if (updateResultUI) {
                                        updateResultUI(reply);
                                    }
                                }
                            } catch (e) {
                                // 忽略解析错误，可能是不完整的 JSON
                                console.warn('流式解析警告:', e.message);
                            }
                        }
                    }
                }

                // 处理最后剩余的 buffer
                if (buffer.trim() && buffer.trim() !== 'data: [DONE]' && buffer.trim().startsWith('data: ')) {
                    try {
                        const jsonStr = buffer.trim().slice(6);
                        const chunk = JSON.parse(jsonStr);
                        const deltaReasoning = chunk.choices?.[0]?.delta?.reasoning_content;
                        if (deltaReasoning) {
                            hasReasoning = true;
                            reply += deltaReasoning;
                            if (updateResultUI) {
                                updateResultUI(reply);
                            }
                        }
                        const delta = chunk.choices?.[0]?.delta?.content;
                        if (delta) {
                            if (hasReasoning && !reasoningEnded) {
                                reply += "\n\n";
                                reasoningEnded = true;
                            }
                            reply += delta;
                            if (updateResultUI) {
                                updateResultUI(reply);
                            }
                        }
                    } catch (e) {
                        console.warn('流式解析警告 (最后buffer):', e.message);
                    }
                }
                
                if (hasReasoning && !reasoningEnded) {
                    reply += "\n\n";
                    reasoningEnded = true;
                    if (updateResultUI) {
                        updateResultUI(reply);
                    }
                }

                // 检查空响应
                if (isEmptyResponse(reply)) {
                    if (attempt < maxRetries) {
                        lastError = new Error('未收到有效回复');
                        activeRequests.delete(requestKey);
                        attempt++;
                        continue; // 重试
                    } else {
                        reply = '未收到有效回复。';
                        toastr.warning(`${typeName}: LLM 请求返回为空（已重试 ${maxRetries} 次），可能是请求被截断、max_tokens 设置过小、或 API 连接问题。`);
                    }
                }
            } else {
                // 非流式处理：常规 JSON 响应
                const responseData = await response.json();

                if (responseData.error) {
                    let errorMsg;
                    if (typeof responseData.error === 'object' && responseData.error.message) {
                        errorMsg = `${responseData.error.message}`;
                        const details = [];
                        if (responseData.error.type) details.push(`类型: ${responseData.error.type}`);
                        if (responseData.error.code) details.push(`代码: ${responseData.error.code}`);
                        if (details.length > 0) {
                            errorMsg += ` (${details.join(', ')})`;
                        }
                    } else {
                        errorMsg = `${JSON.stringify(responseData.error)}`;
                    }
                    throw new Error(errorMsg);
                }

                let reasoning = responseData.choices?.[0]?.message?.reasoning_content || '';
                reply = responseData.choices?.[0]?.message?.content || '';
                if (reasoning) {
                    reply = reasoning + "\n\n" + reply;
                }

                // 检查空响应
                if (isEmptyResponse(reply)) {
                    if (attempt < maxRetries) {
                        lastError = new Error('未收到有效回复');
                        activeRequests.delete(requestKey);
                        attempt++;
                        continue; // 重试
                    } else {
                        reply = '未收到有效回复。';
                        toastr.warning(`${typeName}: LLM 请求返回为空（已重试 ${maxRetries} 次），可能是请求被截断、max_tokens 设置过小、或 API 连接问题。`);
                    }
                }

                if (updateResultUI) {
                    updateResultUI(reply);
                }
            }

            // 记录 LLM 回复到日志（智绘姬AI助手的请求不记录）
            if (!isAiAssistantRequest) {
                addLog(`\n----- LLM 回复 -----`);
                addLog(reply);
                if (attempt > 0) {
                    addLog(`✅ 重试成功（第 ${attempt} 次重试）`);
                }
                addLog(`===== LLM 请求完成 =====`);
            }

            // 更新任务状态为完成
            taskQueue.completeTask(taskId, true);
            llmTaskControllers.delete(taskId);

            eventSource.emit(responseEventName, { success: true, result: reply, id: id, testMode: false });

            // 成功，退出重试循环
            activeRequests.delete(requestKey);
            releaseFabLoading();
            return;

        } catch (error) {
            activeRequests.delete(requestKey);

            if (error.name === 'AbortError') {
                // 用户主动中止，不重试
                taskQueue.updateStatus(taskId, TaskStatus.CANCELLED);
                llmTaskControllers.delete(taskId);
                releaseFabLoading();
                eventSource.emit(responseEventName, {
                    success: false,
                    result: null,
                    id: id,
                    error: { name: 'AbortError', message: 'Request aborted' }
                });
                return;
            }

            // 检查是否应该重试
            if (!isNonRetryableError(error) && shouldRetryError(error, attempt, maxRetries)) {
                lastError = error;
                attempt++;
                console.warn(`[LLM Retry] ${typeName} 失败: ${error.message}，将在 2 秒后重试 (${attempt}/${maxRetries})`);
                if (!isAiAssistantRequest) {
                    addLog(`⚠️ 请求失败: ${error.message}`);
                }
                continue; // 继续重试
            }

            // 不应重试或已达最大重试次数
            console.error(`${typeName} Error:`, error);
            const errorMessage = attempt > 0
                ? `请求错误（已重试 ${attempt} 次）: ${error.message}`
                : `请求错误: ${error.message}`;

            if (updateResultUI) {
                updateResultUI(errorMessage);
            }
            toastr.error(errorMessage);

            // 更新任务状态为失败
            taskQueue.completeTask(taskId, false);
            llmTaskControllers.delete(taskId);
            releaseFabLoading();

            eventSource.emit(responseEventName, { success: false, result: errorMessage, id: id });
            return;
        }
    }
}

/**
 * 通用的 LLM 执行请求处理（使用 UI 中配置的默认 profile）
 * @param {object} data - 事件数据，包含 { prompt, id }
 * @param {object} profileData - 配置数据（从 UI 收集）
 * @param {function} [updateResultUI] - 可选的 UI 更新回调函数
 * @param {string} [channel='default'] - 请求通道名，不同通道互不干扰，同通道新请求会中断旧请求
 */
export async function executeDefaultLLMRequest(data, profileData, updateResultUI = null, channel = 'default') {
    console.log('[DEBUG-SVC] ▶ executeDefaultLLMRequest() 开始');
    console.log('[DEBUG-SVC]   channel:', channel, ', id:', data?.id);
    console.log('[DEBUG-SVC]   updateResultUI 是否存在:', !!updateResultUI);
    console.log('[DEBUG-SVC]   profileData.bypass_proxy:', profileData?.bypass_proxy);
    console.log('[DEBUG-SVC]   profileData.stream:', profileData?.stream);

    const { prompt, id } = data;
    if (!id || !prompt) {
        console.warn('[DEBUG-SVC] ⚠ id 或 prompt 为空，直接返回');
        return;
    }

    const maxRetries = extension_settings[extensionName].llm_retry_count ?? 0;
    let attempt = 0;
    let lastError = null;

    // 重试循环
    while (attempt <= maxRetries) {
        // 多并发：为此次请求创建独立的 AbortController，不中断其他并发请求
        const controller = new AbortController();
        const signal = controller.signal;
        const requestKey = generateRequestKey(`default_${channel}`);

        // 注册到活动请求表
        activeRequests.set(requestKey, {
            controller,
            kind: 'default',
            channel,
            id
        });

        // 添加任务到队列（仅第一次）
        let taskId;
        if (attempt === 0) {
            taskId = taskQueue.addTask({
                name: 'LLM: 外部请求',
                type: TaskType.LLM,
                prompt: id
            });

            // 存储任务 ID 与 AbortController 的关联
            llmTaskControllers.set(taskId, controller);

            // 更新任务状态为运行中
            taskQueue.updateStatus(taskId, TaskStatus.RUNNING);

            // 启动悬浮球加载动画（引用计数）
            acquireFabLoading();
        } else {
            // 重试时更新控制器
            llmTaskControllers.set(taskId, controller);
        }

        // 判断是否为智绘姬AI助手的请求（通过请求ID前缀判断）
        const isAiAssistantRequest = String(id).startsWith('ai-assistant-') || String(id).length === 13;

        // 记录请求的 prompt（智绘姬AI助手的请求不记录日志，避免污染系统日志）
        if (!isAiAssistantRequest && attempt === 0) {
            addLog(`===== LLM 默认请求开始 [${requestKey}] =====`);
            addLog(`请求 ID: ${id}`);
            addLog(`发送的 Prompt:`);
            addLog(formatPromptForDisplay(prompt));
        }

        // 重试提示
        if (attempt > 0) {
            const retryMsg = `第 ${attempt} 次重试（共 ${maxRetries} 次）...`;
            console.log(`[LLM Retry] 外部请求 ${retryMsg}`);
            if (!isAiAssistantRequest) {
                addLog(`⏳ ${retryMsg}`);
            }
            if (updateResultUI) {
                updateResultUI(`${retryMsg}\n正在处理外部请求，请稍候...`);
            }
            // 等待 2 秒后重试
            await new Promise(resolve => setTimeout(resolve, 2000));
        }

        const { api_url, api_key, model, temperature, top_p, max_tokens, stream, bypass_proxy } = profileData;
        const send_images = profileData.send_images ?? false;

        // 如果当前 LLM 配置关闭了「发送图片」，过滤掉 prompt 中的图片
        // ── 诊断：打印 send_images 与对应 profile 名 ──
        try {
            const _profileName = extension_settings[extensionName].current_llm_profile || '默认';
            const _imgCount = countImageParts(prompt);
            console.warn(
                `[发送图片诊断/默认请求] profile="${_profileName}" | send_images=${send_images} | prompt 中图片数=${_imgCount} | 将${send_images ? '保留' : '剥离'}图片`
            );
        } catch (_e) { /* 诊断输出失败不影响主流程 */ }
        const outboundMessages = send_images ? prompt : stripImagesFromMessages(prompt);

        if (!api_url || !api_key || !model) {
            const errorMsg = "API URL, API Key, 或 Model 未配置。";
            toastr.error(errorMsg);
            activeRequests.delete(requestKey);
            if (attempt === 0) {
                releaseFabLoading();
                llmTaskControllers.delete(taskId);
            }
            eventSource.emit(eventNames.LLM_EXECUTE_RESPONSE, { success: false, result: errorMsg, id: id });
            return;
        }

        // 根据 bypass_proxy 决定请求方式
        const customApiUrl = api_url.replace(/\/$/, '');
        let requestUrl, requestHeaders, requestBody;

        if (bypass_proxy) {
            // 直接请求 OpenAI 格式 API（绕过酒馆代理）
            requestUrl = `${customApiUrl}/chat/completions`;
            requestHeaders = {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${api_key}`
            };
            requestBody = {
                model: model,
                messages: outboundMessages,
                temperature: temperature,
                top_p: top_p,
                max_tokens: max_tokens,
                stream: stream ?? false,
            };
        } else {
            // 使用 SillyTavern 后端代理，避免 CORS 问题
            // 酒馆代理需要的 custom_url 格式：会自动追加 /chat/completions
            let proxyBaseUrl = customApiUrl;

            requestUrl = '/api/backends/chat-completions/generate';
            requestHeaders = getRequestHeaders(window.token);
            requestBody = {
                chat_completion_source: 'custom',
                custom_url: proxyBaseUrl,
                custom_include_headers: `Authorization: "Bearer ${api_key}"`,
                model: model,
                messages: outboundMessages,
                temperature: temperature,
                top_p: top_p,
                max_tokens: max_tokens,
                stream: false,
            };
        }

        if (updateResultUI && attempt === 0) {
            console.log('[DEBUG-SVC] ✉ 调用 updateResultUI("正在处理外部请求，请稍候...")');
            updateResultUI("正在处理外部请求，请稍候...");
            console.log('[DEBUG-SVC]   updateResultUI 第1次调用完成');
        }

        try {
            console.log('[DEBUG-SVC] 🌐 发起 fetch 请求...');
            console.log('[DEBUG-SVC]   requestUrl:', requestUrl);
            console.log('[DEBUG-SVC]   bypass_proxy:', bypass_proxy);
            const response = await fetch(requestUrl, {
                method: 'POST',
                headers: requestHeaders,
                body: JSON.stringify(requestBody),
                signal,
            });

            console.log('[DEBUG-SVC] ✅ fetch 响应已收到, status:', response.status, response.statusText);
            const responseData = await response.json();
            console.log('[DEBUG-SVC]   responseData 已解析, choices 数量:', responseData.choices?.length);

            if (responseData.error) {
                let errorMsg;
                if (typeof responseData.error === 'object' && responseData.error.message) {
                    errorMsg = `${responseData.error.message}`;
                    const details = [];
                    if (responseData.error.type) details.push(`类型: ${responseData.error.type}`);
                    if (responseData.error.code) details.push(`代码: ${responseData.error.code}`);
                    if (details.length > 0) {
                        errorMsg += ` (${details.join(', ')})`;
                    }
                } else {
                    errorMsg = `${JSON.stringify(responseData.error)}`;
                }
                throw new Error(errorMsg);
            }

            if (!response.ok) {
                throw new Error(`请求失败: ${response.status} ${response.statusText}`);
            }

            let reasoning = responseData.choices?.[0]?.message?.reasoning_content || "";
            let reply = responseData.choices?.[0]?.message?.content || "";
            if (reasoning) {
                reply = reasoning + "\n\n" + reply;
            }
            console.log('[DEBUG-SVC] 📝 reply 长度:', reply.length, ', 前50字符:', reply.substring(0, 50));

            // 检查空响应
            if (isEmptyResponse(reply)) {
                if (attempt < maxRetries) {
                    console.warn('[DEBUG-SVC] ⚠ reply 为空，将重试');
                    lastError = new Error('未收到有效回复');
                    activeRequests.delete(requestKey);
                    attempt++;
                    continue; // 重试
                } else {
                    console.warn('[DEBUG-SVC] ⚠ reply 为空（已达最大重试次数）');
                    toastr.warning(`LLM 请求返回为空（已重试 ${maxRetries} 次），可能是请求被截断、max_tokens 设置过小、或 API 连接问题。`);
                }
            }

            if (updateResultUI) {
                console.log('[DEBUG-SVC] ✉ 调用 updateResultUI(reply)，reply长度:', reply.length);
                updateResultUI(reply);
                console.log('[DEBUG-SVC]   updateResultUI 第2次调用完成（实际回复）');
            } else {
                console.warn('[DEBUG-SVC] ⚠ updateResultUI 为 null，无法更新实际回复到 UI');
            }

            // 记录 LLM 回复到日志（智绘姬AI助手的请求不记录）
            if (!isAiAssistantRequest) {
                addLog(`\n----- LLM 回复 -----`);
                addLog(reply);
                if (attempt > 0) {
                    addLog(`✅ 重试成功（第 ${attempt} 次重试）`);
                }
                addLog(`===== LLM 请求完成 =====`);
            }

            // 更新任务状态为完成
            taskQueue.completeTask(taskId, true);
            llmTaskControllers.delete(taskId);

            console.log('[DEBUG-SVC] 📤 即将 emit LLM_EXECUTE_RESPONSE, success: true, reply长度:', reply.length);
            eventSource.emit(eventNames.LLM_EXECUTE_RESPONSE, { success: true, result: reply, id: id });
            console.log('[DEBUG-SVC] ◀ executeDefaultLLMRequest() 正常完成');

            // 成功，退出重试循环
            activeRequests.delete(requestKey);
            releaseFabLoading();
            return;

        } catch (error) {
            activeRequests.delete(requestKey);

            if (error.name === 'AbortError') {
                // 用户主动中止，不重试
                console.log('LLM execute request aborted.');
                taskQueue.updateStatus(taskId, TaskStatus.CANCELLED);
                llmTaskControllers.delete(taskId);
                releaseFabLoading();
                eventSource.emit(eventNames.LLM_EXECUTE_RESPONSE, {
                    success: false,
                    result: null,
                    id: id,
                    error: { name: 'AbortError', message: 'Request aborted' }
                });
                return;
            }

            // 检查是否应该重试
            if (!isNonRetryableError(error) && shouldRetryError(error, attempt, maxRetries)) {
                lastError = error;
                attempt++;
                console.warn(`[LLM Retry] 外部请求失败: ${error.message}，将在 2 秒后重试 (${attempt}/${maxRetries})`);
                if (!isAiAssistantRequest) {
                    addLog(`⚠️ 请求失败: ${error.message}`);
                }
                continue; // 继续重试
            }

            // 不应重试或已达最大重试次数
            console.error("LLM Execute Error:", error);
            const errorMessage = attempt > 0
                ? `请求错误（已重试 ${attempt} 次）: ${error.message}`
                : `请求错误: ${error.message}`;

            if (updateResultUI) {
                updateResultUI(errorMessage);
            }
            toastr.error(errorMessage);

            // 更新任务状态为失败
            taskQueue.completeTask(taskId, false);
            llmTaskControllers.delete(taskId);
            releaseFabLoading();

            eventSource.emit(eventNames.LLM_EXECUTE_RESPONSE, { success: false, result: errorMessage, id: id });
            return;
        }
    }
}

// ==================== 请求类型处理器 ====================

/**
 * 创建请求类型的 GetPrompt 处理器
 * @param {string} requestType - 请求类型
 * @param {string} responseEventName - 响应事件名称
 * @returns {function} 处理器函数
 */
export function createGetPromptHandler(requestType, responseEventName) {
    return function (data) {
        const { id } = data;
        if (!id) return;

        const typeName = REQUEST_TYPE_NAMES[requestType] || requestType;
        console.log(`st-chatu8: 收到${typeName}提示词获取请求 (ID: ${id})`);
        const prompt = buildPromptForRequestType(requestType);
        eventSource.emit(responseEventName, { prompt: prompt, id: id });
    };
}

/**
 * 创建请求类型的 Execute 处理器
 * @param {string} requestType - 请求类型
 * @param {string} responseEventName - 响应事件名称
 * @param {function} [getUpdateResultUI] - 获取 UI 更新回调的函数
 * @returns {function} 处理器函数
 */
export function createExecuteHandler(requestType, responseEventName, getUpdateResultUI = null) {
    return async function (data) {
        const updateResultUI = getUpdateResultUI ? getUpdateResultUI() : null;
        await executeTypedLLMRequest(data, requestType, responseEventName, updateResultUI);
    };
}
