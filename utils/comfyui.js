// @ts-nocheck
import {
    sleep,
    generateRandomSeed,
    zhengmian,
    fumian,
    getRequestHeaders,
    prompt_replace,
    addLog,
    clearLog,
    parsePromptStringWithCoordinates,
    prompt_replace_for_character,
    stripChineseAnnotations,
    convertImageToJpeg,
    deduplicateTags,
    getRandomYusheId
} from './utils.js';
import { extension_settings } from "../../../../extensions.js";
import { extensionName, EventType } from './config.js';
import { setItemImg } from './database.js';
import { saveChatDebounced, saveSettingsDebounced, eventSource } from '../../../../../script.js';
import { initializeImageProcessing } from './iframe.js';
import { taskQueue, TaskType } from './taskQueue.js';

import { processCharacterPrompt } from './characterprompt.js';
import { bananaGenerate } from './banana.js';
import { recordImageGeneration } from './imageGenStats.js';
import { processSkippedNodes } from './settings/worker.js';

// 获取 ComfyUI 直连模式的通用请求头
function getComfyUIHeaders(contentType = null) {
    const headers = {};
    if (contentType) {
        headers['Content-Type'] = contentType;
    }
    return headers;
}

function stringifyJsonString(value) {
    return JSON.stringify(value == null ? '' : String(value));
}

function stringifyJsonNumber(value, fallback = 0) {
    const numericValue = Number(value);
    return Number.isFinite(numericValue) ? String(numericValue) : String(fallback);
}

function normalizeSettingString(value) {
    return value == null ? '' : String(value).trim();
}

function normalizeBackslashPath(value) {
    return normalizeSettingString(value).replace(/\\{2,}/g, '\\');
}

async function replacepro(payload, json) {
    console.log("payload222", payload);

    json = json.replaceAll("\"%seed%\"", stringifyJsonNumber(payload.seed));
    json = json.replaceAll("\"%steps%\"", stringifyJsonNumber(payload.steps));
    json = json.replaceAll("\"%cfg_scale%\"", stringifyJsonNumber(payload.cfg_scale));
    json = json.replaceAll("\"%sampler_name%\"", stringifyJsonString(payload.sampler_name));
    json = json.replaceAll("\"%width%\"", stringifyJsonNumber(payload.width));
    json = json.replaceAll("\"%height%\"", stringifyJsonNumber(payload.height));
    json = json.replaceAll("\"%negative_prompt%\"", stringifyJsonString(payload.negative_prompt));
    json = json.replaceAll("\"%prompt%\"", stringifyJsonString(payload.prompt));
    json = json.replaceAll("\"%MODEL_NAME%\"", stringifyJsonString(payload.MODEL_NAME));
    json = json.replaceAll("\"%c_quanzhong%\"", stringifyJsonNumber(payload.c_quanzhong));
    json = json.replaceAll("\"%c_idquanzhong%\"", stringifyJsonNumber(payload.c_idquanzhong));
    json = json.replaceAll("\"%c_xijie%\"", stringifyJsonNumber(payload.c_xijie));
    json = json.replaceAll("\"%c_fenwei%\"", stringifyJsonNumber(payload.c_fenwei));
    json = json.replaceAll("\"%comfyuicankaotupian%\"", stringifyJsonString(payload.comfyuicankaotupian));
    json = json.replaceAll("\"%ipa%\"", stringifyJsonString(payload.ipa));
    json = json.replaceAll("\"%scheduler%\"", stringifyJsonString(payload.scheduler));
    json = json.replaceAll("\"%vae%\"", stringifyJsonString(payload.vae));
    json = json.replaceAll("\"%clip%\"", stringifyJsonString(payload.clip));

    console.log(json);
    // 局部重绘占位符
    if (payload.inpaint_image) {
        json = json.replaceAll('\"%inpaint_image%\"', stringifyJsonString(payload.inpaint_image));
    } else {

        json = json.replaceAll('\"%inpaint_image%\"', stringifyJsonString(''));
    }
    if (payload.inpaint_mask) {
        json = json.replaceAll('\"%inpaint_mask%\"', stringifyJsonString(payload.inpaint_mask));
    } else {

        json = json.replaceAll('\"%inpaint_mask%\"', stringifyJsonString(''));
    }
    json = json.replaceAll('\"%inpaint_denoise%\"', stringifyJsonNumber(payload.inpaint_denoise || 0.75, 0.75));
    // 局部重绘提示词
    if (payload.inpaint_positive) {
        json = json.replaceAll('\"%inpaint_positive%\"', stringifyJsonString(payload.inpaint_positive));
    } else {

        json = json.replaceAll('\"%inpaint_positive%\"', stringifyJsonString(''));
    }
    if (payload.inpaint_negative) {
        json = json.replaceAll('\"%inpaint_negative%\"', stringifyJsonString(payload.inpaint_negative));
    } else {

        json = json.replaceAll('\"%inpaint_negative%\"', stringifyJsonString(''));
    }
    JSON.parse(json);
    return json
}

// 当前任务ID（用于取消检测）
let currentTaskId = null;

// New function, modeled after generateNovelAIImage
export async function generateComfyUIImage({ prompt: link, width: Xwidth, height: Xheight, change, extraNegativePrompt }) {
    clearLog();

    // 注册任务到队列
    const taskId = taskQueue.addTask({
        name: (link || '').substring(0, 30) + (link && link.length > 30 ? '...' : ''),
        type: TaskType.COMFYUI,
        prompt: link
    });
    currentTaskId = taskId;

    link = typeof link === 'string' ? link : '';
    change = typeof change === 'string' ? change : '';

    console.log("link", link);

    let change_ = "";

    if (change) {
        change_ = change.replaceAll('{ComfyUI局部重绘}', '').replaceAll('{局部重绘}', '');
    } else {

        change_ = link
    }

    // --- 提取并剔除分辨率，防止发给后端 API ---


    const sizeRegex = /,?\s*(\d{2,4})x(\d{2,4})(?=[;\s]|$)/i;
    if (typeof link === 'string') {
        const match = link.match(sizeRegex);

        if (match) {
            if (String(extension_settings[extensionName].aiAutonomousResolution) !== 'false') {
                Xwidth = parseInt(match[1], 10);
                Xheight = parseInt(match[2], 10);
            }
        }
        link = link.replace(sizeRegex, '');
    }
    if (typeof change === 'string') {
        const match = change.match(sizeRegex);

        if (match) {
            if (String(extension_settings[extensionName].aiAutonomousResolution) !== 'false') {
                Xwidth = parseInt(match[1], 10);
                Xheight = parseInt(match[2], 10);
            }
        }
        change = change.replace(sizeRegex, '');
    }

    link = processCharacterPrompt(link);

    link = await stripChineseAnnotations(link)

    change = processCharacterPrompt(change)

    change = await stripChineseAnnotations(change)
    addLog(`开始 ComfyUI 生图流程。客户端为${extension_settings[extensionName].client}`);
    addLog(`请求工作流id - ${extension_settings[extensionName].workerid}`);
    addLog(`请求尺寸: 宽度 - ${Xwidth || '默认'}, 高度 - ${Xheight || '默认'}`);

    if (extension_settings[extensionName].MODEL_NAME.trim() === '连接后选择') {
        addLog('请填写ComfyUI模型。');
        toastr.error('请填写ComfyUI模型。');
        taskQueue.completeTask(taskId, false);
        currentTaskId = null;
        return;
    }

    const url = extension_settings[extensionName].comfyuiUrl.trim();

    const promptForGeneration = (change && change.trim() !== '') ? change : link;
    addLog(`用于生成的Tag: ${promptForGeneration}`);

    let Divide_roles = false;
    if (promptForGeneration.includes("Scene Composition")) {
        Divide_roles = true;
    }
    addLog(`是否启用分角色模式 (Divide_roles): ${Divide_roles}`);

    let prompt_data = {};
    let mainPrompt = "";
    let other_prompt = "";

    if (Divide_roles) {
        addLog("分角色模式: 解析带坐标的提示词字符串。");
        prompt_data = parsePromptStringWithCoordinates(promptForGeneration);
        mainPrompt = prompt_data["Scene Composition"];

        for (let i = 1; i <= 4; i++) {
            if (prompt_data[`Character ${i} Prompt`]) {

                other_prompt = other_prompt + ", " + prompt_data[`Character ${i} Prompt`]

            }
        }
    } else {
        addLog("标准模式: 使用请求中的 prompt。");
        mainPrompt = deduplicateTags(promptForGeneration);
    }

    // 应用新的复杂提示词替换规则
    let { modifiedPrompt, insertions } = await prompt_replace(mainPrompt, other_prompt);

    if (Divide_roles) {
        for (let i = 1; i <= 4; i++) {
            if (prompt_data[`Character ${i} Prompt`]) {

                modifiedPrompt = modifiedPrompt + " | " + prompt_replace_for_character(prompt_data[`Character ${i} Prompt`], (mainPrompt || '') + ' ' + (other_prompt || ''))

            }
        }

    }
    // 使用新的 zhengmian 函数组合所有部分
    const _comfyui_yushe_id = getRandomYusheId('yusheid_comfyui');
    let prompt = await zhengmian(
        extension_settings[extensionName].yushe[_comfyui_yushe_id].fixedPrompt,
        modifiedPrompt,
        extension_settings[extensionName].yushe[_comfyui_yushe_id].fixedPrompt_end,
        extension_settings[extensionName].AQT_comfyui,
        insertions
    );
    prompt = replaceLoraTags(prompt); //替换lora字符串  处理字符
    function replaceLoraTags(input, addClipSkip = false) {
        const regex = /<lora:([^:>]+):([^>]+)>/g;
        return input.replace(regex, (match, filename, paramStr) => {
            if (!addClipSkip) {
                return `<lora:${filename}:${paramStr}>`;
            }
            // 将用户提供的参数拆分，不足则补 '1'，多余则截断
            const params = paramStr.split(':');
            if (extension_settings[extensionName].weilin_lora_fix === 'true') {
                // WeiLinPromptUI 需要 3 个参数
                const p1 = params[0] || '1';
                const p2 = params[1] || '1';
                const p3 = params[2] || '1';
                console.log("开启的");
                return `<lora:${filename}:${p1}:${p2}:${p3}>`;
            } else {
                // WeiLinPromptUI 需要 2 个参数
                const p1 = params[0] || '1';
                const p2 = params[1] || '1';
                return `<lora:${filename}:${p1}:${p2}>`;
            }
        });
    }

    if (extension_settings[extensionName].worker.includes('WeiLin') && !extension_settings[extensionName].worker.includes('WeiLinPromptUI')) {
        // WeiLinPromptUI需要添加:1，并将lora替换为wlr
        prompt = replaceLoraTags(prompt, true);
        // 如果lora文件名没有.safetensors后缀，自动添加
        prompt = prompt.replace(/<lora:([^:>]+)(\.safetensors)?:([^>]+)>/g, (match, filename, ext, weight) => {
            if (!prompt.includes('.safetensors')) {
                return `<lora:${filename}.safetensors:${weight}> `;
            }
            return match;
        });
    }
    if (extension_settings[extensionName].worker.includes('WeiLinPromptUI')) {
        // WeiLinPromptUI需要添加:1，并将lora替换为wlr
        prompt = replaceLoraTags(prompt, true);
        prompt = prompt.replaceAll('<lora:', '<wlr:');
        prompt = prompt.replaceAll('.safetensors', '');
    }

    console.log("prompt", prompt);
    addLog(`正面提示词: ${prompt} `);
    let negative_prompt = await fumian(extension_settings[extensionName].yushe[_comfyui_yushe_id].negativePrompt, extension_settings[extensionName].UCP_comfyui);

    // 合并角色负面提示词（非分角色模式）
    if (!Divide_roles && window.collectedCharacterNegatives) {
        const characterNegatives = window.collectedCharacterNegatives.trim();
        if (characterNegatives) {
            negative_prompt = negative_prompt ? `${negative_prompt}, ${characterNegatives} ` : characterNegatives;
            addLog(`[角色负面] 添加角色负面提示词: ${characterNegatives} `);
            console.log('[ComfyUI] 合并角色负面提示词:', characterNegatives);
        }
    }

    // 合并智绘姬传入的额外负面提示词
    if (extraNegativePrompt && extraNegativePrompt.trim()) {
        const trimmedExtra = extraNegativePrompt.trim();
        negative_prompt = negative_prompt ? `${negative_prompt}, ${trimmedExtra} ` : trimmedExtra;
        addLog(`[智绘姬] 添加额外负面提示词: ${trimmedExtra} `);
        console.log('[ComfyUI] 合并智绘姬额外负面提示词:', trimmedExtra);
    }

    if (extension_settings[extensionName].worker.includes('WeiLinPromptUI')) {
        negative_prompt = replaceLoraTags(negative_prompt, true);
        negative_prompt = negative_prompt.replaceAll('<lora:', '<wlr:');
    } else {
        negative_prompt = replaceLoraTags(negative_prompt);
    }
    addLog(`负面提示词: ${negative_prompt} `);
    prompt = prompt.replaceAll("\n", ",").replace(/,{2,}/g, ',').replaceAll("\\\\", "\\").replaceAll("\\", "\\\\");

    negative_prompt = negative_prompt.replaceAll("\n", ",").replace(/,{2,}/g, ',').replaceAll("\\\\", "\\").replaceAll("\\", "\\\\");

    const normalizedModelName = normalizeBackslashPath(extension_settings[extensionName].MODEL_NAME);

    let payload = {
        "prompt": prompt,
        "negative_prompt": negative_prompt,
        "steps": extension_settings[extensionName].comfyui_steps,
        "sampler_name": extension_settings[extensionName].comfyuisamplerName,
        "width": Xwidth ? Xwidth : extension_settings[extensionName].comfyui_width,
        "height": Xheight ? Xheight : extension_settings[extensionName].comfyui_height,
        "cfg_scale": extension_settings[extensionName].cfg_comfyui,
        "seed": extension_settings[extensionName].comfyui_seed === 0 || extension_settings[extensionName].comfyui_seed === "0" || extension_settings[extensionName].comfyui_seed === "" || extension_settings[extensionName].comfyui_seed === -1 || extension_settings[extensionName].comfyui_seed === "-1" ? generateRandomSeed() : extension_settings[extensionName].comfyui_seed,
        "MODEL_NAME": normalizedModelName,
        "c_quanzhong": extension_settings[extensionName].c_quanzhong,
        "c_idquanzhong": extension_settings[extensionName].c_idquanzhong,
        "c_xijie": extension_settings[extensionName].c_xijie,
        "c_fenwei": extension_settings[extensionName].c_fenwei,
        "comfyuicankaotupian": window.comfyuicankaotupian,
        "ipa": extension_settings[extensionName].ipa,
        "scheduler": normalizeSettingString(extension_settings[extensionName].comfyui_scheduler),
        "vae": normalizeSettingString(extension_settings[extensionName].comfyui_vae),
        "clip": normalizeSettingString(extension_settings[extensionName].comfyuiCLIPName),
        // 局部重绘参数（如果有）
        "inpaint_image": window.comfyuiInpaintImage || null,
        "inpaint_mask": window.comfyuiInpaintMask || null,
        "inpaint_denoise": extension_settings[extensionName].inpaint_denoise || '0.75',
        "inpaint_positive": window.comfyuiInpaintPositivePrompt || '',
        "inpaint_negative": window.comfyuiInpaintNegativePrompt || '',
    };

    if (!payload.MODEL_NAME) {
        throw new Error('ComfyUI 模型名为空或只包含空白字符。');
    }

    const report = `\n-- - 生图参数报告-- -\n正面提示词: ${payload.prompt} \n负面提示词: ${payload.negative_prompt} \n模型: ${payload.MODEL_NAME} \n采样器: ${payload.sampler_name} \n步数: ${payload.steps} \nCFG Scale: ${payload.cfg_scale} \n种子: ${payload.seed} \n尺寸: ${payload.width}x${payload.height} \nVAE: ${payload.vae} \nScheduler: ${payload.scheduler} \n--------------------\n`;
    addLog(report);

    //工作流
    const clientId = "533ef3a3-39c0-4e39-9ced-37d290f371f8";

    // 处理跳过的节点 - 在执行前重映射连接（支持类型匹配）
    let workflowToUse = extension_settings[extensionName].worker;

    if (change.includes("{ComfyUI局部重绘}") || change.includes("{局部重绘}")) {

        workflowToUse = extension_settings[extensionName].editWorker;


    }

    try {
        const workflowObj = JSON.parse(workflowToUse);
        const skippedCount = Object.values(workflowObj).filter(n => n && n._skip).length;
        if (skippedCount > 0) {
            addLog(`检测到 ${skippedCount} 个跳过的节点，正在处理连接重映射...`);
            // 获取objectInfo用于类型匹配
            const { getComfyuiCache } = await import('./configDatabase.js');
            const objectInfo = await getComfyuiCache('objectinfo') || {};
            const processedWorkflow = processSkippedNodes(workflowObj, objectInfo);
            workflowToUse = JSON.stringify(processedWorkflow);
            addLog(`跳过节点处理完成，已重映射连接${Object.keys(objectInfo).length > 0 ? '（含类型匹配）' : ''}`);
        } else {
            workflowToUse = JSON.stringify(workflowObj);
        }
    } catch (e) {
        throw new Error(`ComfyUI 工作流 JSON 无效: ${e.message}`);
    }

    payload = await replacepro(payload, workflowToUse);
    payload = JSON.stringify({ client_id: clientId, prompt: JSON.parse(payload) });
    addLog(`发送到 ComfyUI 的最终 payload: ${payload} `);

    while (!window.xiancheng) {
        // 检查任务是否在排队期间被取消
        if (!taskQueue.isTaskInQueue(taskId)) {
            addLog('排队等待期间任务已被取消。');
            throw new Error('任务已取消');
        }
        await sleep(1000); //排队线程

    }

    let lockAcquired = false;
    try {
        // 在正式请求前再次判断是否已被取消，防止刚跳出等待循环就被取消的任务死灰复燃
        if (!taskQueue.isTaskInQueue(taskId)) {
            addLog('正式请求前检测到任务已被取消。');
            throw new Error('任务已取消');
        }

        window.xiancheng = false;
        lockAcquired = true;
        taskQueue.updateStatus(taskId, 'running');
        let imageUrl;

        if (extension_settings[extensionName].client === 'jiuguan') {
            const response = await fetch('/api/sd/comfy/generate', {
                method: "POST",
                body: JSON.stringify({
                    url: url,
                    prompt: payload,
                }),
                headers: getRequestHeaders(window.token),
            });

            if (!response.ok) {
                const errorText = await response.text();
                addLog(`API 请求失败(jiuguan client): ${errorText} `);
                taskQueue.completeTask(taskId, false);
                throw new Error(`请求失败, 状态码: ${response.status}, 详情: ${errorText} `);
            }

            const responseText = await response.text();
            let format, data;

            try {
                // First, try to parse as JSON, which is the expected format.
                const jsonResponse = JSON.parse(responseText);
                format = jsonResponse.format;
                data = jsonResponse.data;
            } catch (e) {
                // If parsing fails, assume the response is the raw base64 data.
                addLog('JSON 解析失败，尝试作为原始 Base64 数据处理。');
                format = 'png'; // Assume png format if not specified
                data = responseText;
            }

            if (!data) {
                addLog('API 响应中没有图片数据 (jiuguan client)。');
                taskQueue.completeTask(taskId, false);
                throw new Error('Endpoint did not return image data.');
            }

            // 检测是否为视频格式
            const videoFormats = ['mp4', 'webm', 'gif', 'avi', 'mov'];
            const isVideo = videoFormats.some(fmt => format && format.toLowerCase().includes(fmt));
            const mediaType = isVideo ? '视频' : '图片';

            addLog(`${mediaType} 生成成功(jiuguan client)。`);

            // 根据媒体类型构造正确的 data URL
            const mimePrefix = isVideo ? 'video' : 'image';
            let mimeType = format;

            // 修正视频 MIME 类型
            if (isVideo) {
                if (format.includes('mp4') || format.includes('h264')) {
                    mimeType = 'mp4';
                } else if (format.includes('webm')) {
                    mimeType = 'webm';
                } else if (format.includes('gif')) {
                    mimeType = 'gif';
                }
            }

            imageUrl = `data:${mimePrefix}/${mimeType};base64,${data}`;

            setTimeout(() => {
                console.log('xiancheng 为true');
                window.xiancheng = true
            }, extension_settings[extensionName].imageGenInterval);;
            taskQueue.completeTask(taskId, true);
            currentTaskId = null;

            console.log("format", format, "isVideo", isVideo)

            // 只对图片进行 JPEG 转换，视频不转换
            if (String(extension_settings[extensionName].convertToJpegStorage) === "true" && !isVideo) {

                imageUrl = await convertImageToJpeg(imageUrl);

            }

            let finalFormat = format;
            if (isVideo) {
                finalFormat = `video/${mimeType}`;
            }

            return { image: imageUrl, change: change_ || '', isVideo: isVideo, format: finalFormat };

        } else {
            const urlObj = new URL(url + "/prompt");
            const response = await fetch(urlObj, {
                method: "POST",
                body: payload,
                headers: getComfyUIHeaders('application/json')
            });

            if (!response.ok) {
                const errorText = await response.text();
                addLog(`API 请求失败 (direct comfyui): ${errorText}`);
                throw new Error(`请求失败,状态码: ${response.status}, 详情: ${errorText}`);
            }

            const r = await response.json();
            let id = r.prompt_id;
            let ii = 0;

            while (true) {
                try {
                    // 检查任务是否被取消
                    if (!taskQueue.isTaskInQueue(taskId)) {
                        addLog('任务已被用户取消，正在中断 ComfyUI...');
                        try {
                            await fetch(`${url}/api/interrupt`, { method: 'POST', headers: getComfyUIHeaders() });
                        } catch (e) {
                            console.warn('[ComfyUI] 中断请求失败:', e);
                        }
                        throw new Error('任务已取消');
                    }

                    const response2 = await fetch(`${url}/history/${id}`, { headers: getComfyUIHeaders() });
                    if (!response2.ok) {
                        addLog(`轮询历史记录时出错: ${response2.status}`);
                        throw new Error(`History request failed: ${response2.status}`);
                    }
                    let re = await response2.json();
                    console.log("response2", re);

                    // 检查 ComfyUI 执行错误
                    if (re.hasOwnProperty(id)) {
                        const historyData = re[id];

                        // 检查状态中的错误信息
                        if (historyData.status && historyData.status.status_str === 'error') {
                            const errorInfo = historyData.status;
                            addLog(`❌ ComfyUI 执行失败 - 状态: ${errorInfo.status_str}`);

                            if (errorInfo.messages && errorInfo.messages.length > 0) {
                                errorInfo.messages.forEach((msg, idx) => {
                                    addLog(`消息 ${idx + 1}: ${JSON.stringify(msg)}`);
                                });
                            }

                            let errorMessage = 'ComfyUI 执行错误';
                            if (errorInfo.exception_message) {
                                errorMessage = errorInfo.exception_message;
                                addLog(`异常信息: ${errorInfo.exception_message}`);
                            }
                            if (errorInfo.exception_type) {
                                addLog(`异常类型: ${errorInfo.exception_type}`);
                            }

                            throw new Error(errorMessage);
                        }
                    }
                    if (re.hasOwnProperty(id)) {
                        function getImageInfoFromOutputs(outputs) {
                            for (const key in outputs) {
                                const value = outputs[key];
                                // Check for image outputs - 只获取 type: "output" 的最终图片，排除 type: "temp" 的临时预览
                                if (value.images && value.images.length > 0) {
                                    // 查找第一个 type 为 "output" 的图片
                                    const outputImage = value.images.find(img => img.type === 'output');
                                    if (outputImage) {
                                        return {
                                            filename: outputImage.filename,
                                            subfolder: outputImage.subfolder || '',
                                            isVideo: false,
                                            format: 'image'
                                        };
                                    }
                                    // 如果当前节点没有 output 类型的图片，继续检查下一个节点
                                    continue;
                                }
                                // Check for video outputs (gifs field with video format)
                                if (value.gifs && value.gifs.length > 0) {
                                    const gif = value.gifs[0];
                                    const isVideo = gif.format && gif.format.startsWith('video/');
                                    return {
                                        filename: gif.filename,
                                        subfolder: gif.subfolder || '',
                                        isVideo: isVideo,
                                        format: gif.format || 'image/gif'
                                    };
                                }
                            }
                            return null;
                        }

                        let imageInfo = getImageInfoFromOutputs(re[id]["outputs"]);
                        if (!imageInfo) {
                            throw new Error("未能从API响应中找到文件名。");
                        }
                        // Store for later reference
                        window._lastMediaInfo = imageInfo;
                        const mediaType = imageInfo.isVideo ? '视频' : '图片';
                        addLog(`${mediaType}生成成功 (direct comfyui)。`);

                        let fileurl = `${url}/view?filename=${imageInfo.filename}&subfolder=${encodeURIComponent(imageInfo.subfolder)}&type=output`;
                        const imageResponse = await fetch(fileurl, { headers: getComfyUIHeaders() });
                        if (!imageResponse.ok) {
                            throw new Error(`获取图片失败,状态码: ${imageResponse.status}`);
                        }
                        let blob = await imageResponse.blob();

                        // 修正视频 MIME 类型问题：某些格式如 video/h264-mp4 浏览器不支持
                        // 需要将其转换为标准的 video/mp4 或 video/webm
                        if (imageInfo.isVideo) {
                            let correctedMimeType = 'video/mp4'; // 默认使用 mp4
                            if (imageInfo.format) {
                                if (imageInfo.format.includes('webm')) {
                                    correctedMimeType = 'video/webm';
                                } else if (imageInfo.format.includes('mp4') || imageInfo.format.includes('h264')) {
                                    correctedMimeType = 'video/mp4';
                                }
                            }
                            // 用正确的 MIME 类型重新构造 Blob
                            const arrayBuffer = await blob.arrayBuffer();
                            blob = new Blob([arrayBuffer], { type: correctedMimeType });
                            console.log(`[ComfyUI] 视频 MIME 类型修正: ${imageInfo.format} -> ${correctedMimeType}`);

                            window._lastMediaInfo.format = correctedMimeType;
                        }

                        imageUrl = await new Promise((resolve, reject) => {
                            const reader = new FileReader();
                            reader.onloadend = () => resolve(reader.result);
                            reader.onerror = reject;
                            reader.readAsDataURL(blob);
                        });
                        if (String(extension_settings[extensionName].convertToJpegStorage) === "true") {

                            if (!imageInfo.isVideo) {
                                imageUrl = await convertImageToJpeg(imageUrl);
                            }

                        }
                        break; // Exit while loop
                    }
                    await sleep(1000);
                    ii++;

                    if (ii > 1000) {
                        addLog('轮询超时（1000次），服务器可能已断开连接。');
                        throw new Error("ComfyUI 服务器超时。");
                    }
                } catch (error) {
                    addLog(`轮询时发生异常: ${error}`);
                    throw error; // Re-throw to be caught by outer catch
                }
            }
            setTimeout(() => {
                console.log('xiancheng 为true');
                window.xiancheng = true
            }, extension_settings[extensionName].imageGenInterval);;
            if (!imageUrl) {
                throw new Error("未能生成图片 URL。");
            }

            // Determine if it's a video based on mediaInfo captured earlier
            const isVideo = window._lastMediaInfo?.isVideo || false;
            const mediaFormat = window._lastMediaInfo?.format || 'image';
            addLog(`媒体 (${isVideo ? '视频' : '图片'}) 已成功获取并格式化为 data URL。`);

            taskQueue.completeTask(taskId, true);
            currentTaskId = null;

            return { image: imageUrl, change: change_ || '', isVideo: isVideo, format: mediaFormat };
        }

    } catch (error) {

        if (lockAcquired) {
            window.xiancheng = true; // 仅当获取了锁时才释放，防止取消等待任务时错误释放锁
        }

        // 更新任务状态
        const rawMessage = error instanceof Error ? error.message : String(error);
        const propagatedMessage = rawMessage === 'Failed to fetch' || rawMessage === 'Load failed'
            ? `ComfyUI 请求失败，可能是服务不可达、跨域、代理异常或返回了无效响应: ${rawMessage}`
            : rawMessage;

        if (rawMessage === '任务已取消') {
            // 已在 cancelTask 中更新状态
        } else {
            taskQueue.completeTask(taskId, false);
        }
        currentTaskId = null;

        addLog(`图片生成过程中发生错误: ${propagatedMessage}`);
        console.error('Error generating image:', error);
        // Re-throw the error to be caught by the event listener or caller
        throw new Error(propagatedMessage);
    }
}

async function comfyuigenerate(requestData) {
    let { id, prompt, width, height, change, negative_prompt: extraNegativePrompt } = requestData;
    addLog(`收到生图请求 (ID: ${id}) - Prompt: ${prompt}${change ? ` - Change: ${change}` : ''}${extraNegativePrompt ? ` - NegativePrompt: ${extraNegativePrompt}` : ''}`);

    if (change && change.includes('{修图}')) {

        bananaGenerate(requestData)
        return;
    }

    if (change && change.includes('{视频}')) {
        bananaGenerate(requestData)
        return;
    }

    try {

        const { image: imageUrl, change: returnedChange, isVideo, format } = await generateComfyUIImage({ prompt, width, height, change, extraNegativePrompt });


        if (extension_settings[extensionName].cache != "0") {
            await setItemImg(prompt, imageUrl, { change: returnedChange, isVideo: isVideo, format: format });
            addLog(`${isVideo ? '视频' : '图像'}已存入数据库 for prompt: ${prompt}`);

        } else {

            addLog(`缓存设置为不存入数据库`);

        }

        recordImageGeneration('comfyui', true);
        eventSource.emit(EventType.GENERATE_IMAGE_RESPONSE, {
            id,
            success: true,
            imageData: imageUrl,
            prompt: prompt, // pass back the original prompt
            change: returnedChange,
            isVideo: isVideo || false,
            format: format || 'image',
        });
        addLog(`发送${isVideo ? '视频' : '图片'}生成成功响应 (ID: ${id})`);

    } catch (error) {
        const errorMsg = `生图流程捕获到异常 (ID: ${id}): ${error.message}`;
        addLog(`错误: ${errorMsg}`);
        console.error('Error generating image:', error);

        recordImageGeneration('comfyui', false);
        eventSource.emit(EventType.GENERATE_IMAGE_RESPONSE, {
            id,
            success: false,
            error: error.message,
            prompt: prompt,
        });
        addLog(`发送生图失败响应 (ID: ${id})`);
    }
}







function initializeComfyuiListener() {
    // 监听新版事件
    eventSource.on(EventType.GENERATE_IMAGE_REQUEST, comfyuigenerate);
    addLog("comfyui 生图事件监听器已初始化（含旧版兼容）。");
}

export async function replaceWithcomfyui() {

    if (extension_settings[extensionName].mode == "comfyui") {
        if (!window.initializeComfyuiListener) {
            window.initializeComfyuiListener = true;
            initializeComfyuiListener();
        }
        initializeImageProcessing();
    } else {
        if (window.initializeComfyuiListener) {
            // 移除新版事件监听
            eventSource.removeListener(EventType.GENERATE_IMAGE_REQUEST, comfyuigenerate);
            window.initializeComfyuiListener = false;
            addLog("comfyui 生图事件监听器已关闭。");
        }
    }
}
