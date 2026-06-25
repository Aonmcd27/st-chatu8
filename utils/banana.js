// @ts-nocheck
import { extension_settings } from "../../../../extensions.js";
import { eventSource } from '../../../../../script.js';
import { extensionName, EventType } from './config.js';
import {
    sleep,
    generateRandomSeed,
    zhengmian,
    fumian,
    getRequestHeaders,
    prompt_replace_banana,
    addLog,
    clearLog,
    parsePromptStringWithCoordinates,
    prompt_replace_banana_for_character,
    stripChineseAnnotations,
    convertImageToJpeg
} from './utils.js';
import { initializeImageProcessing } from './iframe.js';
import { processCharacterPrompt } from './characterprompt.js';
import { setItemImg } from './database.js';
import { getConfigImage } from './configDatabase.js';
import { taskQueue, TaskType, TaskStatus } from './taskQueue.js';
import { generateComfyUIImage } from './comfyui.js';
import { recordImageGeneration } from './imageGenStats.js';

// 获取直连模式的通用请求头
function getDirectHeaders(contentType = null, auth = null) {
    const headers = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': '*/*'
    };
    if (contentType) {
        headers['Content-Type'] = contentType;
    }
    if (auth) {
        headers['Authorization'] = auth;
    }
    return headers;
}

// 当前任务ID（用于取消检测）
let currentTaskId = null;
// 当前请求ID（用于发送取消响应）
let currentRequestId = null;
// 当前 prompt（用于发送取消响应）
let currentPrompt = null;
// 当前请求的 AbortController（用于中断 fetch）
let currentAbortController = null;

/**
 * 从 turn 对象获取图片数据（兼容新旧格式）
 * @param {Object} data - user 或 model 对象
 * @returns {Promise<string>} Base64 图片数据或空字符串
 */
async function getImageFromTurnData(data) {
    if (!data) return '';

    // 新格式：使用 imageId
    if (data.imageId && data.imageId.startsWith('cfgimg_')) {
        const imageData = await getConfigImage(data.imageId);
        return imageData || '';
    }

    // 旧格式：直接存储 image
    if (data.image && data.image.startsWith('data:image')) {
        return data.image;
    }

    return '';
}
/**
 * 读取响应内容，自动识别 SSE 流式响应并聚合为 OpenAI 非流式格式。
 * 兼容：
 *   - 普通 JSON 响应（{ choices: [{ message: { content, reasoning_details } }] }）
 *   - SSE 流式响应（多个 data: {...} 块），聚合 delta.content / delta.reasoning_content
 * @param {Response} response
 * @returns {Promise<object>} 等价的非流式 OpenAI 响应对象
 */
async function readOpenAIResponse(response) {
    const text = await response.text();
    const trimmed = text.trimStart();
    const contentType = (response.headers.get('content-type') || '').toLowerCase();
    const isSSE = contentType.includes('text/event-stream')
        || trimmed.startsWith('data:')
        || /\n\s*data:\s*/.test(text);

    if (!isSSE) {
        try {
            return JSON.parse(text);
        } catch (e) {
            throw new Error(`无法解析响应 JSON: ${e.message}; 原始响应: ${text.slice(0, 500)}`);
        }
    }

    addLog('[Banana] 检测到 SSE 流式响应，开始聚合 chunk');

    let aggregatedContentText = '';
    const aggregatedContentParts = []; // 用于 content 是数组形式（image_url 等）
    let aggregatedReasoningText = '';
    const aggregatedImages = []; // 用于 reasoning_details.images
    let finishReason = null;
    let usage = null;
    let model = null;
    let id = null;

    // 拆分 SSE：以换行作为消息边界，过滤注释/空行
    const lines = text.split(/\r?\n/);
    for (const rawLine of lines) {
        const line = rawLine.trim();
        if (!line || line.startsWith(':')) continue;
        if (!line.startsWith('data:')) continue;
        const payload = line.slice(5).trim();
        if (!payload || payload === '[DONE]') continue;

        let chunk;
        try {
            chunk = JSON.parse(payload);
        } catch (e) {
            addLog(`[Banana] 跳过无法解析的 SSE chunk: ${payload.slice(0, 200)}`);
            continue;
        }

        if (chunk.id && !id) id = chunk.id;
        if (chunk.model && !model) model = chunk.model;
        if (chunk.usage) usage = chunk.usage;

        const choice = chunk.choices && chunk.choices[0];
        if (!choice) continue;

        const delta = choice.delta || choice.message || {};

        // 文本内容：兼容字符串与数组
        if (typeof delta.content === 'string') {
            aggregatedContentText += delta.content;
        } else if (Array.isArray(delta.content)) {
            for (const item of delta.content) {
                if (item && item.type === 'text' && typeof item.text === 'string') {
                    aggregatedContentText += item.text;
                } else {
                    aggregatedContentParts.push(item);
                }
            }
        }

        if (typeof delta.reasoning_content === 'string') {
            aggregatedReasoningText += delta.reasoning_content;
        }

        // reasoning_details.images（如果模型直接以这种方式返回图片）
        const rd = delta.reasoning_details;
        if (rd && Array.isArray(rd.images)) {
            for (const img of rd.images) aggregatedImages.push(img);
        }

        if (choice.finish_reason) finishReason = choice.finish_reason;
    }

    // 构造文本+数组混合的 content：如果同时收到文本和非文本部件，用数组形式呈现
    let messageContent;
    if (aggregatedContentParts.length > 0) {
        messageContent = [...aggregatedContentParts];
        if (aggregatedContentText) {
            messageContent.unshift({ type: 'text', text: aggregatedContentText });
        }
    } else {
        messageContent = aggregatedContentText;
    }

    const message = { role: 'assistant', content: messageContent };
    if (aggregatedReasoningText) message.reasoning_content = aggregatedReasoningText;
    if (aggregatedImages.length > 0) message.reasoning_details = { images: aggregatedImages };

    addLog(`[Banana] SSE 聚合完成：text=${aggregatedContentText.length} 字符，images=${aggregatedImages.length}，reasoning=${aggregatedReasoningText.length} 字符`);

    return {
        id,
        object: 'chat.completion',
        model,
        choices: [{ index: 0, message, finish_reason: finishReason || 'stop' }],
        usage: usage || undefined,
    };
}

/**
 * The core function to generate an image using the "Banana" backend.
 * It routes requests based on the selected model (Gemini vs. Imagen).
 * @param {{ prompt: string, width?: number, height?: number, change?: string, retouchPrompt?: string, retouchImage?: string }} options
 * @returns {Promise<{image: string, change: string}>}
 */
async function generateBananaImage({ prompt, width, height, change, retouchPrompt, retouchImage, videoPrompt, videoImage }) {
    clearLog();

    // 注册任务到队列
    const taskId = taskQueue.addTask({
        name: (prompt || '').substring(0, 30) + (prompt && prompt.length > 30 ? '...' : ''),
        type: TaskType.BANANA,
        prompt: prompt
    });
    currentTaskId = taskId;
    currentAbortController = new AbortController();

    // --- 视频模式：提前返回，跳过图片提示词处理 ---
    if (change && change.includes('{视频}')) {
        addLog(`[Banana] 视频模式：跳过图片提示词处理，直接构建视频请求`);

        const bananaSettings = extension_settings[extensionName].banana;
        const { videoModel, model, apiUrl, apiKey, conversationPresets, videoPresetId, aspectRatio } = bananaSettings;

        const useModel = videoModel || model;
        addLog(`[Banana] 视频模式使用模型: ${useModel}`);

        // 获取视频预设
        const selectedVideoPresetId = videoPresetId || '默认';
        const preset = conversationPresets[selectedVideoPresetId] || { conversation: [], fixedPrompt: '' };
        addLog(`[Banana] 使用视频预设: "${selectedVideoPresetId}"`);

        // 构建对话历史（从预设中加载）
        // 跳过 model 端为空的 turn，避免产生连续的 user 消息
        const history = [];
        for (const turn of preset.conversation) {
            const userContent = [];
            if (turn.user?.text) userContent.push({ type: 'text', text: turn.user.text });
            const userImage = await getImageFromTurnData(turn.user);
            if (userImage) userContent.push({ type: 'image_url', image_url: { url: userImage } });

            const modelContent = [];
            if (turn.model?.text) modelContent.push({ type: 'text', text: turn.model.text });
            const modelImage = await getImageFromTurnData(turn.model);
            if (modelImage) modelContent.push({ type: 'image_url', image_url: { url: modelImage } });

            // 必须 user 与 model 同时有内容，才视为有效的 few-shot 示例
            if (userContent.length === 0 || modelContent.length === 0) {
                if (userContent.length > 0 && modelContent.length === 0) {
                    addLog(`[Banana] 视频模式：跳过 model 为空的预设轮次，避免连续 user 消息堆叠`);
                }
                continue;
            }

            history.push({ role: 'user', content: userContent });
            history.push({ role: 'assistant', content: modelContent });
        }

        // 构建用户消息：仅视频提示词 + 参考图片
        const userContent = [];
        const promptText = videoPrompt || '';
        const combinedPrompt = [preset.fixedPrompt, promptText, preset.postfixPrompt].filter(Boolean).join(', ');
        userContent.push({ type: 'text', text: combinedPrompt });

        if (videoImage) {
            userContent.push({ type: 'image_url', image_url: { url: videoImage } });
            addLog(`[Banana] 视频模式：已添加参考图片`);
        }

        history.push({ role: 'user', content: userContent });
        addLog(`[Banana] 视频模式：指令 = ${combinedPrompt}`);

        // 构建 payload（临时禁用 config.imageConfig，排查部分模型（如 grok-imagine-*）不识别该字段导致生图异常）
        const payload = {
            model: useModel,
            messages: history.filter(entry => entry.content.length > 0),
            // config: {
            //     imageConfig: {
            //         aspectRatio: aspectRatio
            //     }
            // }
        };
        addLog(`[Banana] 视频模式 payload 包含 ${payload.messages.length} 条消息（已禁用 config.imageConfig）`);

        // 构建 URL
        const path = '/v1/chat/completions';
        let baseUrl = apiUrl.replace(/\/$/, '');
        let directUrl = baseUrl + '/chat/completions';

        // 选择请求方式
        const client = extension_settings[extensionName].client;
        let requestUrl, requestHeaders, requestBody;

        if (client === 'jiuguan') {
            let proxyBaseUrl = baseUrl;

            requestUrl = '/api/backends/chat-completions/generate';
            requestHeaders = getRequestHeaders(window.token);
            requestBody = {
                chat_completion_source: 'custom',
                custom_url: proxyBaseUrl,
                custom_include_headers: `Authorization: "Bearer ${apiKey}"`,
                model: useModel,
                messages: payload.messages,
                stream: false,
            };
        } else {
            requestUrl = directUrl;
            requestHeaders = getDirectHeaders('application/json', `Bearer ${apiKey}`);
            requestBody = payload;
        }

        addLog(`[Banana] 视频模式发送请求到: ${requestUrl}`);
        addLog(`[Banana] 视频 Payload: ${JSON.stringify(requestBody, null, 2)}`);

        // 发送请求
        try {
            taskQueue.updateStatus(taskId, 'running');

            const response = await fetch(requestUrl, {
                method: 'POST',
                headers: requestHeaders,
                body: JSON.stringify(requestBody),
                signal: currentAbortController.signal
            });

            if (!response.ok) {
                const errorText = await response.text();
                throw new Error(`API request failed with status ${response.status}: ${errorText}`);
            }

            const result = await readOpenAIResponse(response);

            // 解析视频响应
            const content = result.choices?.[0]?.message?.content;
            if (typeof content === 'string') {
                const videoSrcMatch = content.match(/src="([^"]+\.mp4[^"]*)"/);
                if (videoSrcMatch && videoSrcMatch[1]) {
                    const videoUrl = videoSrcMatch[1];
                    addLog(`[Banana] Video URL extracted: ${videoUrl}`);

                    // 下载视频并转为 base64
                    try {
                        const videoResponse = await fetch(videoUrl, { headers: getDirectHeaders() });
                        if (!videoResponse.ok) {
                            throw new Error(`Failed to fetch video: ${videoResponse.status}`);
                        }
                        const videoBlob = await videoResponse.blob();
                        const videoDataUrl = await new Promise((resolve, reject) => {
                            const reader = new FileReader();
                            reader.onloadend = () => resolve(reader.result);
                            reader.onerror = reject;
                            reader.readAsDataURL(videoBlob);
                        });
                        addLog(`[Banana] Video downloaded (${(videoBlob.size / 1024 / 1024).toFixed(2)} MB)`);

                        taskQueue.completeTask(taskId, true);
                        currentTaskId = null;
                        const changeClean = change.replaceAll('{视频}', '');
                        return { image: videoDataUrl, change: changeClean || prompt, isVideo: true, format: 'video/mp4', originalUrl: videoUrl };
                    } catch (fetchError) {
                        addLog(`[Banana] Failed to download video: ${fetchError.message}`);
                        throw new Error(`视频下载失败: ${fetchError.message}`);
                    }
                }
            }
            throw new Error('Video response did not contain a valid MP4 URL');

        } catch (error) {
            addLog(`[Banana] 视频模式错误: ${error.message}`);
            if (error.name === 'AbortError' || error.message === '任务已取消') {
                // 已在 cancelTask 中处理
                addLog('[Banana] 视频生成被取消。');
            } else {
                taskQueue.completeTask(taskId, false);
            }
            currentTaskId = null;
            throw error;
        }
    }
    // --- 视频模式结束 ---


    let change_ = change;


    // --- 提取并剔除分辨率，防止发给后端 API ---
    const sizeRegex = /,?\s*(\d{2,4})x(\d{2,4})(?=[;\s]*$)/i;
    if (typeof prompt === 'string') {
        const match = prompt.match(sizeRegex);
        if (match) {
            if (String(extension_settings[extensionName].aiAutonomousResolution) !== 'false') {
                width = parseInt(match[1], 10);
                height = parseInt(match[2], 10);
            }
        }
        prompt = prompt.replace(sizeRegex, '');
    }
    if (typeof change === 'string') {
        const match = change.match(sizeRegex);
        if (match) {
            if (String(extension_settings[extensionName].aiAutonomousResolution) !== 'false') {
                width = parseInt(match[1], 10);
                height = parseInt(match[2], 10);
            }
        }
        change = change.replace(sizeRegex, '');
    }

    prompt = processCharacterPrompt(prompt);

    prompt = await stripChineseAnnotations(prompt)




    change = processCharacterPrompt(change)

    change = await stripChineseAnnotations(change)


    addLog(`开始 Banana生图流程。客户端为${extension_settings[extensionName].client}`);
    addLog(`请求尺寸: 宽度 - ${width || '默认'}, 高度 - ${height || '默认'}`);

    prompt = (change && change.trim() !== '') ? change : prompt;

    addLog(`用于生成的Tag: ${prompt}`);

    let Divide_roles = false;
    if (prompt.includes("Scene Composition")) {
        Divide_roles = true;
    }
    addLog(`是否启用分角色模式 (Divide_roles): ${Divide_roles}`);


    let prompt_data = {};
    let mainPrompt = "";
    let other_prompt = "";

    if (Divide_roles) {
        addLog("分角色模式: 解析带坐标的提示词字符串。");
        prompt_data = parsePromptStringWithCoordinates(prompt);
        mainPrompt = prompt_data["Scene Composition"];

        for (let i = 1; i <= 4; i++) {
            if (prompt_data[`Character ${i} Prompt`]) {

                other_prompt = other_prompt + ", " + prompt_data[`Character ${i} Prompt`]

            }
        }
    } else {
        addLog("标准模式: 使用请求中的 prompt。");
        mainPrompt = prompt;
    }

    // 应用 Banana 专属的提示词替换规则
    let { modifiedPrompt, insertions } = await prompt_replace_banana(mainPrompt, other_prompt);


    if (Divide_roles) {
        for (let i = 1; i <= 4; i++) {
            if (prompt_data[`Character ${i} Prompt`]) {

                modifiedPrompt = modifiedPrompt + " | " + prompt_replace_banana_for_character(prompt_data[`Character ${i} Prompt`], (mainPrompt || '') + ' ' + (other_prompt || ''))

            }
        }

    }




    const bananaSettings = extension_settings[extensionName].banana;
    const { model, editModel, videoModel, apiUrl, apiKey, conversationPresets, conversationPresetId, editPresetId, videoPresetId, aspectRatio } = bananaSettings;

    const useGrokFormat = String(bananaSettings.useGrokFormat) === 'true';

    // 根据模式选择实际请求使用的模型：修图 → editModel，视频 → videoModel，否则 → 文生图 model
    // 任一专用模型为空时回退到文生图 model，保持向后兼容
    const isEditMode = !!(change && change.includes('{修图}'));
    const isVideoMode = !!(change && change.includes('{视频}'));
    const effectiveModel = isVideoMode
        ? (videoModel || model)
        : isEditMode
            ? (editModel || model)
            : model;

    addLog(`[Banana] Starting image generation with model: ${effectiveModel}${isEditMode ? ' (修图模式)' : isVideoMode ? ' (视频模式)' : ''}`);

    // ==================== Grok 原生 images/generations 分支 ====================
    // 不支持修图/视频（这些模式需要参考图，应继续走多模态 chat/completions）
    if (useGrokFormat && !change.includes('{修图}') && !change.includes('{视频}')) {
        addLog('[Banana] 启用 Grok 原生 images/generations 格式');

        const grokPreset = conversationPresets[conversationPresetId] || { fixedPrompt: '', postfixPrompt: '' };
        const grokFinalPrompt = [
            grokPreset.fixedPrompt,
            insertions['前置前'],
            insertions['前置后'],
            modifiedPrompt,
            insertions['后置前'],
            insertions['后置后'],
            grokPreset.postfixPrompt,
            insertions['最后置']
        ].filter(Boolean).join(', ');

        addLog(`[Banana] Grok prompt: ${grokFinalPrompt}`);

        const grokPath = '/v1/images/generations';
        let grokBaseUrl = apiUrl.replace(/\/$/, '');
        let grokDirectUrl = grokBaseUrl + '/images/generations';

        const grokPayload = {
            model,
            prompt: grokFinalPrompt,
            n: 1,
            response_format: 'b64_json'
        };

        // Grok images/generations 走直连（酒馆代理只代理 chat/completions）
        const grokRequestUrl = grokDirectUrl;
        const grokRequestHeaders = getDirectHeaders('application/json', `Bearer ${apiKey}`);

        addLog(`[Banana] Grok 模式发送请求到: ${grokRequestUrl}`);
        addLog(`[Banana] Grok payload: ${JSON.stringify(grokPayload)}`);

        try {
            taskQueue.updateStatus(taskId, 'running');
            const grokResponse = await fetch(grokRequestUrl, {
                method: 'POST',
                headers: grokRequestHeaders,
                body: JSON.stringify(grokPayload),
                signal: currentAbortController.signal
            });

            if (!grokResponse.ok) {
                const errorText = await grokResponse.text();
                throw new Error(`Grok API request failed (${grokResponse.status}): ${errorText}`);
            }

            const grokResult = await grokResponse.json();
            const item = grokResult?.data?.[0];
            if (!item) {
                throw new Error(`Grok 响应缺少 data[0]，原始响应: ${JSON.stringify(grokResult).slice(0, 500)}`);
            }

            let imageUrl = '';
            if (item.b64_json) {
                imageUrl = `data:image/png;base64,${item.b64_json}`;
                addLog('[Banana] Grok 模式：从 b64_json 提取到图片');
            } else if (item.url) {
                addLog(`[Banana] Grok 模式：下载图片 URL ${item.url}`);
                const imgResp = await fetch(item.url, { headers: getDirectHeaders() });
                if (!imgResp.ok) {
                    throw new Error(`下载图片失败: ${imgResp.status}`);
                }
                const blob = await imgResp.blob();
                imageUrl = await new Promise((resolve, reject) => {
                    const reader = new FileReader();
                    reader.onloadend = () => resolve(reader.result);
                    reader.onerror = reject;
                    reader.readAsDataURL(blob);
                });
            }

            if (!imageUrl) {
                throw new Error('Grok 响应未包含图片（b64_json/url 均为空）');
            }

            if (String(extension_settings[extensionName].convertToJpegStorage) === 'true') {
                imageUrl = await convertImageToJpeg(imageUrl);
            }

            addLog('[Banana] Grok 模式：图片生成成功');
            taskQueue.completeTask(taskId, true);
            currentTaskId = null;
            return { image: imageUrl, change: change_ || '' };
        } catch (error) {
            addLog(`[Banana] Grok 模式错误: ${error.message}`);
            console.error('[Banana] Grok mode error:', error);
            if (error.name !== 'AbortError' && error.message !== '任务已取消') {
                taskQueue.completeTask(taskId, false);
            } else {
                addLog('[Banana] Grok 模式生成被取消。');
            }
            currentTaskId = null;
            throw error;
        }
    }
    // ==================== Grok 分支结束 ====================

    let path;
    let payload;

    // 1. Build request payload based on the selected model
    if (effectiveModel.startsWith('imagen')) {
        // --- Imagen (single-turn) Logic ---
        path = `/v1beta/models/${effectiveModel}`;
        const preset = conversationPresets[conversationPresetId] || { fixedPrompt: '' };
        const finalPrompt = [
            preset.fixedPrompt,
            insertions['前置前'],
            insertions['前置后'],
            modifiedPrompt,
            insertions['后置前'],
            insertions['后置后'],
            preset.postfixPrompt,
            insertions['最后置']
        ].filter(Boolean).join(', ');

        addLog(`正面提示词: ${finalPrompt}`);

        payload = {
            instances: [{ prompt: finalPrompt }],
            parameters: {
                sampleCount: 1,
                aspectRatio: aspectRatio
            }
        };
        addLog(`[Banana] Built Imagen payload with prompt: ${finalPrompt}`);

    } else {
        // --- Multimodal (multi-turn) Logic for all other models ---
        path = '/v1/chat/completions';

        let preset;
        if (change.includes("{修图}")) {
            addLog("[Banana] 启用了 {修图} 标识。");
            const selectedEditPresetId = editPresetId || '默认';
            preset = conversationPresets[selectedEditPresetId] || { conversation: [], fixedPrompt: '' };
            addLog(`[Banana] 使用修图预设: "${selectedEditPresetId}"`);
        } else if (change.includes("{视频}")) {
            addLog("[Banana] 启用了 {视频} 标识。");
            const selectedVideoPresetId = videoPresetId || '默认';
            preset = conversationPresets[selectedVideoPresetId] || { conversation: [], fixedPrompt: '' };
            addLog(`[Banana] 使用视频预设: "${selectedVideoPresetId}"`);
        } else {
            preset = conversationPresets[conversationPresetId] || { conversation: [], fixedPrompt: '' };
        }

        const finalPrompt = [
            preset.fixedPrompt,
            insertions['前置前'],
            insertions['前置后'],
            modifiedPrompt,
            insertions['后置前'],
            insertions['后置后'],
            preset.postfixPrompt,
            insertions['最后置']
        ].filter(Boolean).join(', ');

        addLog(`正面提示词: ${finalPrompt}`);

        // 跳过 model 端为空的 turn，避免产生连续的 user 消息
        const history = [];
        for (const turn of preset.conversation) {
            const turnUserContent = [];
            if (turn.user?.text) turnUserContent.push({ type: 'text', text: turn.user.text });
            const userImage = await getImageFromTurnData(turn.user);
            if (userImage) turnUserContent.push({ type: 'image_url', image_url: { url: userImage } });

            const turnModelContent = [];
            if (turn.model?.text) turnModelContent.push({ type: 'text', text: turn.model.text });
            const modelImage = await getImageFromTurnData(turn.model);
            if (modelImage) turnModelContent.push({ type: 'image_url', image_url: { url: modelImage } });

            // 必须 user 与 model 同时有内容，才视为有效的 few-shot 示例
            if (turnUserContent.length === 0 || turnModelContent.length === 0) {
                if (turnUserContent.length > 0 && turnModelContent.length === 0) {
                    addLog(`[Banana] 跳过 model 为空的预设轮次，避免连续 user 消息堆叠`);
                }
                continue;
            }

            history.push({ role: 'user', content: turnUserContent });
            history.push({ role: 'assistant', content: turnModelContent });
        }

        if (!change.includes("{修图}") && !change.includes("{视频}")) {
            const bananaCharacterPresets = extension_settings[extensionName].bananaCharacterPresets || {};

            for (const presetName in bananaCharacterPresets) {
                const charPreset = bananaCharacterPresets[presetName];
                const triggers = (charPreset.triggers || '').split('|').filter(t => t.trim() !== '');

                for (const trigger of triggers) {
                    if (finalPrompt.toLowerCase().includes(trigger.toLowerCase())) {
                        addLog(`[Banana] Found matching trigger "${trigger}" from preset "${presetName}".`);

                        const turn = charPreset.conversation;
                        if (turn) {
                            const userContent = [];
                            if (turn.user && turn.user.text) userContent.push({ type: 'text', text: turn.user.text });
                            const userImage = await getImageFromTurnData(turn.user);
                            if (userImage) userContent.push({ type: 'image_url', image_url: { url: userImage } });
                            if (userContent.length > 0) {
                                history.push({ role: 'user', content: userContent });
                            }

                            const modelContent = [];
                            if (turn.model && turn.model.text) modelContent.push({ type: 'text', text: turn.model.text });
                            const modelImage = await getImageFromTurnData(turn.model);
                            if (modelImage) modelContent.push({ type: 'image_url', image_url: { url: modelImage } });
                            if (modelContent.length > 0) {
                                history.push({ role: 'assistant', content: modelContent });
                            }
                        }
                        break;
                    }
                }
            }
        }

        if (!change.includes("{修图}") && !change.includes("{视频}")) {
            history.push({
                role: 'user',
                content: [{ type: 'text', text: finalPrompt }]
            });
        } else if (change.includes("{修图}")) {
            // 修图模式：使用传入的修图指令和图片
            // 预设的对话历史已经加载到 history 中作为风格参考

            // 添加用户的修图请求（指令 + 待修改的图片）
            const userContent = [];

            // 添加修图指令
            const promptText = retouchPrompt || finalPrompt;
            const combinedPrompt = [preset.fixedPrompt, promptText, preset.postfixPrompt].filter(Boolean).join(', ');
            userContent.push({ type: 'text', text: combinedPrompt });

            // 添加待修改的图片
            if (retouchImage) {
                userContent.push({ type: 'image_url', image_url: { url: retouchImage } });
                addLog(`[Banana] 修图模式：已添加待修改的图片`);
            }

            history.push({
                role: 'user',
                content: userContent
            });

            addLog(`[Banana] 修图模式：指令 = ${combinedPrompt}`);
        } else if (change.includes("{视频}")) {
            // 视频模式：使用传入的视频指令和图片
            const userContent = [];
            const promptText = videoPrompt || finalPrompt;
            const combinedPrompt = [preset.fixedPrompt, promptText, preset.postfixPrompt].filter(Boolean).join(', ');
            userContent.push({ type: 'text', text: combinedPrompt });

            if (videoImage) {
                userContent.push({ type: 'image_url', image_url: { url: videoImage } });
                addLog(`[Banana] 视频模式：已添加参考图片`);
            }

            history.push({ role: 'user', content: userContent });
            addLog(`[Banana] 视频模式：指令 = ${combinedPrompt}`);
        }

        payload = {
            model: effectiveModel,
            messages: history.filter(entry => entry.content.length > 0),
            // 临时禁用 config.imageConfig，排查部分模型（如 grok-imagine-*）不识别该字段导致生图异常
            // config: {
            //     imageConfig: {
            //         aspectRatio: aspectRatio
            //     }
            // }
        };
        addLog(`[Banana] Built multimodal payload with ${payload.messages.length} messages.（已禁用 config.imageConfig）`);
    }

    // 智能拼接 URL：检测是否包含 v1
    let baseUrl = apiUrl.replace(/\/$/, '');
    let directUrl = baseUrl + '/chat/completions';

    // 根据客户端类型选择请求方式
    const client = extension_settings[extensionName].client;
    let requestUrl, requestHeaders, requestBody;

    if (client === 'jiuguan') {
        // 使用 SillyTavern 后端代理，避免 CORS 问题
        // 酒馆代理需要的 custom_url 格式：会自动追加 /chat/completions
        let proxyBaseUrl = baseUrl;

        requestUrl = '/api/backends/chat-completions/generate';
        requestHeaders = getRequestHeaders(window.token);
        const proxyModel = effectiveModel;
        requestBody = {
            chat_completion_source: 'custom',
            custom_url: proxyBaseUrl,
            custom_include_headers: `Authorization: "Bearer ${apiKey}"`,
            model: proxyModel,
            messages: payload.messages,
            stream: false,
        };
        // 如果是 Imagen 模型，需要特殊处理
        if (proxyModel.startsWith('imagen')) {
            // Imagen 不走 chat/completions，需要直接请求
            addLog(`[Banana] Imagen 模型不支持酒馆代理，切换为直接请求`);
            requestUrl = directUrl;
            requestHeaders = {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${apiKey}`
            };
            requestBody = payload;
        }
        addLog(`[Banana] 使用酒馆代理模式`);
    } else {
        // 直接请求外部 API
        requestUrl = directUrl;
        requestHeaders = getDirectHeaders('application/json', `Bearer ${apiKey}`);
        requestBody = payload;
        addLog(`[Banana] 使用直接请求模式`);
    }

    addLog(`[Banana] Sending request to: ${requestUrl}`);
    addLog(`[Banana] Payload: ${JSON.stringify(requestBody, null, 2)}`);

    // 2. Perform the API call
    try {
        // 更新任务状态为运行中
        taskQueue.updateStatus(taskId, 'running');

        const response = await fetch(requestUrl, {
            method: 'POST',
            headers: requestHeaders,
            body: JSON.stringify(requestBody),
            signal: currentAbortController.signal
        });

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`API request failed with status ${response.status}: ${errorText}`);
        }

        const result = await readOpenAIResponse(response);

        // --- Video response parsing ---
        if (change && change.includes("{视频}")) {
            const content = result.choices?.[0]?.message?.content;
            if (typeof content === 'string') {
                const videoSrcMatch = content.match(/src="([^"]+\.mp4[^"]*)"/);
                if (videoSrcMatch && videoSrcMatch[1]) {
                    const videoUrl = videoSrcMatch[1];
                    addLog(`[Banana] Video URL extracted: ${videoUrl}`);

                    // Download the video and convert to base64 data URL for local DB storage
                    try {
                        const videoResponse = await fetch(videoUrl, { headers: getDirectHeaders() });
                        if (!videoResponse.ok) {
                            throw new Error(`Failed to fetch video: ${videoResponse.status}`);
                        }
                        const videoBlob = await videoResponse.blob();
                        const videoDataUrl = await new Promise((resolve, reject) => {
                            const reader = new FileReader();
                            reader.onloadend = () => resolve(reader.result);
                            reader.onerror = reject;
                            reader.readAsDataURL(videoBlob);
                        });
                        addLog(`[Banana] Video downloaded (${(videoBlob.size / 1024 / 1024).toFixed(2)} MB)`);

                        taskQueue.completeTask(taskId, true);
                        currentTaskId = null;
                        return { image: videoDataUrl, change: change_ || '', isVideo: true, format: 'video/mp4', originalUrl: videoUrl };
                    } catch (fetchError) {
                        addLog(`[Banana] Failed to download video: ${fetchError.message}`);
                        throw new Error(`视频下载失败: ${fetchError.message}`);
                    }
                }
            }
            throw new Error('Video response did not contain a valid MP4 URL');
        }

        // Parse OpenAI format response to extract image
        let imageUrl = '';
        const choices = result.choices;
        if (choices && choices.length > 0) {
            const content = choices[0].message?.content;

            // 优先检查 reasoning_details.images 数组（新格式）
            const reasoningDetails = choices[0].message?.reasoning_details;
            if (reasoningDetails?.images && Array.isArray(reasoningDetails.images) && reasoningDetails.images.length > 0) {
                addLog('[Banana] Detected images array in reasoning_details.');
                const firstImage = reasoningDetails.images[0];
                if (firstImage.type === 'image_url' && firstImage.image_url) {
                    imageUrl = typeof firstImage.image_url === 'string'
                        ? firstImage.image_url
                        : firstImage.image_url.url;
                    addLog('[Banana] Extracted image from reasoning_details.images array.');
                }
            }

            // 如果没有找到图片，继续检查 content 数组
            if (!imageUrl && Array.isArray(content)) {
                // Find image_url in content array
                for (const item of content) {
                    if (item.type === 'image_url' && item.image_url) {
                        // 兼容两种格式：对象 { url: "..." } 或直接字符串
                        imageUrl = typeof item.image_url === 'string'
                            ? item.image_url
                            : item.image_url.url;
                        break;
                    }
                }
            } else if (!imageUrl && typeof content === 'string') {
                // 尝试从 Markdown 格式提取图片: ![任意文本](URL 或 data:image base64)
                // 支持两种格式：
                // 1. ![...](https://example.com/image.png) - 普通 URL
                // 2. ![...](data:image/png;base64,...) - 内嵌 base64
                const markdownImageRegex = /!\[.*?\]\(((?:https?:\/\/|data:image\/[^;]+;base64,)[^\s\)]+)\)/;
                const match = content.match(markdownImageRegex);
                if (match && match[1]) {
                    const mdImageData = match[1];

                    // 判断是 base64 还是普通 URL
                    if (mdImageData.startsWith('data:image/')) {
                        // 直接是 base64 格式，无需请求
                        addLog('[Banana] Detected Markdown embedded base64 image.');
                        imageUrl = mdImageData;
                        addLog('[Banana] Successfully extracted base64 image from Markdown.');
                    } else {
                        // 普通 URL，需要请求并转换
                        addLog('[Banana] Detected Markdown image URL, extracting...');
                        addLog(`[Banana] Markdown image URL: ${mdImageData}`);

                        // 请求图片并转换为 base64
                        try {
                            const imageResponse = await fetch(mdImageData, { headers: getDirectHeaders() });
                            if (!imageResponse.ok) {
                                throw new Error(`Failed to fetch image: ${imageResponse.status}`);
                            }
                            const imageBlob = await imageResponse.blob();
                            const base64Data = await new Promise((resolve, reject) => {
                                const reader = new FileReader();
                                reader.onloadend = () => resolve(reader.result);
                                reader.onerror = reject;
                                reader.readAsDataURL(imageBlob);
                            });
                            imageUrl = base64Data;
                            if (String(extension_settings[extensionName].convertToJpegStorage) === "true") {

                                imageUrl = await convertImageToJpeg(imageUrl);

                            }
                            addLog('[Banana] Successfully converted Markdown image to base64.');
                        } catch (fetchError) {
                            addLog(`[Banana] Failed to fetch Markdown image: ${fetchError.message}`);
                            // 如果无法获取图片，直接使用 URL
                            imageUrl = mdImageData;
                            addLog('[Banana] Using direct URL as fallback.');
                        }
                    }
                } else {
                    addLog('[Banana] Response contains text only, no image.');
                }
            }
        }

        if (!imageUrl) {
            throw new Error('API response did not contain image in OpenAI format');
        }


        addLog('[Banana] Image generated successfully.');

        taskQueue.completeTask(taskId, true);
        currentTaskId = null;
        return { image: imageUrl, change: change_ || '' };

    } catch (error) {
        addLog(`[Banana] Fetch error: ${error.message}`);
        console.error('[Banana] Fetch error:', error);
        // 更新任务状态
        if (error.name === 'AbortError' || error.message === '任务已取消') {
            // 已在 cancelTask 中更新状态
            addLog('[Banana] 任务已被取消，中断网络请求。');
        } else {
            taskQueue.completeTask(taskId, false);
        }
        currentTaskId = null;
        throw error; // Re-throw to be caught by the event handler
    }
}

/**
 * Event handler for GENERATE_IMAGE_REQUEST.
 * Wraps the core generation logic with event emission for success/failure.
 * @param {object} requestData 
 */
export async function bananaGenerate(requestData) {
    clearLog();
    let { id, prompt, width, height, change, retouchPrompt, retouchImage, videoPrompt, videoImage } = requestData;
    // 保存请求信息用于取消时发送响应
    currentRequestId = id;
    currentPrompt = prompt;
    addLog(`[Banana] Received image generation request (ID: ${id})`);
    let change_ = ""
    if (change) {
        change_ = change.replaceAll('{修图}', '').replaceAll('{视频}', '');
    } else {

        change_ = prompt
    }

    // --- 新增逻辑：处理修图请求 ---
    if (change && change.includes('{修图}')) {
        addLog(`Banana修图模式启动`);
        if (retouchPrompt) addLog(`修图指令: ${retouchPrompt}`);
        if (retouchImage) addLog(`修图图片: [已提供]`);
    }
    // --- 结束新增逻辑 ---

    // --- 新增逻辑：处理视频请求 ---
    if (change && change.includes('{视频}')) {
        addLog(`Banana视频模式启动`);
        if (videoPrompt) addLog(`视频指令: ${videoPrompt}`);
        if (videoImage) addLog(`视频图片: [已提供]`);
    }
    // --- 结束新增逻辑 ---

    // --- ComfyUI局部重绘转发 ---
    if (change && change.includes('{ComfyUI局部重绘}')) {
        addLog(`[Banana] 检测到 {ComfyUI局部重绘} 标签，转发到 ComfyUI 处理`);
        try {
            const { image: imageUrl, change: returnedChange, isVideo, format } = await generateComfyUIImage({ prompt, width, height, change, extraNegativePrompt: undefined });
            const cleanedChange = returnedChange.replaceAll('{ComfyUI局部重绘}', '');

            if (extension_settings[extensionName].cache != "0") {
                await setItemImg(prompt, imageUrl, { change: cleanedChange });
                addLog(`图像已存入数据库 for prompt: ${prompt}`);
            } else {
                addLog(`缓存设置为不存入数据库`);
            }

            recordImageGeneration('banana', true);
            eventSource.emit(EventType.GENERATE_IMAGE_RESPONSE, {
                id,
                success: true,
                imageData: imageUrl,
                prompt: prompt,
                change: cleanedChange,
                isVideo: isVideo || false,
                format: format || 'image',
            });
            addLog(`[Banana] 发送ComfyUI局部重绘成功响应 (ID: ${id})`);
        } catch (error) {
            const errorMsg = `[Banana] ComfyUI局部重绘流程捕获到异常 (ID: ${id}): ${error.message}`;
            addLog(`错误: ${errorMsg}`);
            console.error('Error generating ComfyUI inpaint image:', error);

            recordImageGeneration('banana', false);
            eventSource.emit(EventType.GENERATE_IMAGE_RESPONSE, {
                id,
                success: false,
                error: error.message,
                prompt: prompt,
            });
            addLog(`[Banana] 发送ComfyUI局部重绘失败响应 (ID: ${id})`);
        }
        return;
    }
    // --- ComfyUI局部重绘转发结束 ---

    try {
        const { image: imageUrl, change: returnedChange, isVideo, format, originalUrl } = await generateBananaImage({ prompt, width, height, change, retouchPrompt, retouchImage, videoPrompt, videoImage });

        // TODO: Add caching logic if needed, similar to other backends
        // await setItemImg(prompt, imageUrl, { change: returnedChange });

        if (extension_settings[extensionName].cache != "0") {
            await setItemImg(prompt, imageUrl, { change: change_, isVideo: isVideo || false, format: format || 'image', originalUrl: originalUrl || '' });
            addLog(`图像已存入数据库 for prompt: ${prompt}`);

            if (extension_settings[extensionName].banana.cishu) {
                extension_settings[extensionName].banana.cishu = extension_settings[extensionName].banana.cishu + 1

                addLog(`当前生图次数为 for prompt: ${extension_settings[extensionName].banana.cishu}`);
            } else {
                extension_settings[extensionName].banana.cishu = 1

                addLog(`当前生图次数为 for prompt: ${extension_settings[extensionName].banana.cishu}`);
            }

        } else {

            addLog(`缓存设置为不存入数据库`);

        }

        recordImageGeneration('banana', true);
        eventSource.emit(EventType.GENERATE_IMAGE_RESPONSE, {
            id,
            success: true,
            imageData: imageUrl,
            prompt: prompt,
            change: change_,
            isVideo: isVideo || false,
            format: format || 'image',
            originalUrl: originalUrl || '',
        });

        eventSource.emit("generate-image-response", {
            id,
            success: true,
            imageData: imageUrl,
            prompt: prompt,
            change: change_,
            isVideo: isVideo || false,
            format: format || 'image',
            originalUrl: originalUrl || '',
        });
        addLog(`[Banana] Emitted success response for ID: ${id}`);

    } catch (error) {
        const errorMessage = `[Banana] Generation failed for ID ${id}: ${error.message}`;
        addLog(errorMessage);
        console.error(errorMessage);

        recordImageGeneration('banana', false);
        eventSource.emit(EventType.GENERATE_IMAGE_RESPONSE, {
            id,
            success: false,
            error: error.message,
            prompt: prompt,
        });

        eventSource.emit("generate-image-response", {
            id,
            success: false,
            error: error.message,
            prompt: prompt,
        });
        addLog(`[Banana] Emitted failure response for ID: ${id}`);
    }
}

// 兼容旧版本的事件名

/**
 * 处理取消任务事件
 * @param {object} data - 取消事件数据
 */
function handleCancelBananaTask(data) {
    const { taskId } = data;
    addLog(`[Banana] 收到取消任务事件 (TaskID: ${taskId})`);

    // 检查是否是当前正在运行的任务
    if (currentTaskId === taskId && currentRequestId) {
        addLog(`[Banana] 取消当前任务，发送失败响应 (ID: ${currentRequestId})`);

        // 发送失败响应，让 iframe 中的按钮恢复状态
        recordImageGeneration('banana', false);
        eventSource.emit(EventType.GENERATE_IMAGE_RESPONSE, {
            id: currentRequestId,
            success: false,
            error: '任务已取消',
            prompt: currentPrompt || '',
        });
        // 兼容旧版事件名
        eventSource.emit("generate-image-response", {
            id: currentRequestId,
            success: false,
            error: '任务已取消',
            prompt: currentPrompt || '',
        });

        // 中断底层的网络请求
        if (currentAbortController) {
            currentAbortController.abort();
            currentAbortController = null;
            addLog(`[Banana] 已触发 AbortController 彻底中断请求`);
        }

        // 清空当前任务信息
        currentTaskId = null;
        currentRequestId = null;
        currentPrompt = null;
    }
}

/**
 * Initializes the event listener for Banana image generation.
 */
function initializeBananaListener() {
    eventSource.on(EventType.GENERATE_IMAGE_REQUEST, bananaGenerate);
    // 注册取消事件监听器
    eventSource.on('st_chatu8_cancel_banana_task', handleCancelBananaTask);
    addLog("banana 生图事件监听器已初始化。");
}

/**
 * Dynamically enables or disables the Banana backend based on settings.
 */
export async function replaceWithBanana() {
    if (extension_settings[extensionName].mode == "banana") {
        if (!window.initializeBananaListener) {
            window.initializeBananaListener = true;
            initializeBananaListener();
        }
        initializeImageProcessing(); // Activate UI placeholder processing
    } else {
        if (window.initializeBananaListener) {
            eventSource.removeListener(EventType.GENERATE_IMAGE_REQUEST, bananaGenerate);
            // 移除取消事件监听器
            eventSource.removeListener('st_chatu8_cancel_banana_task', handleCancelBananaTask);
            window.initializeBananaListener = false;
            addLog("[Banana] 生图事件监听器已关闭。");
        }
    }
}
