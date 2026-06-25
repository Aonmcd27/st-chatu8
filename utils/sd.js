// @ts-nocheck
import {
    sleep,
    zhengmian,
    fumian,
    deepMerge,
    getSDMode,
    setSDMode,
    addLog,
    getRequestHeaders,
    clearLog,
    prompt_replace,
    getsdAuth,
    parsePromptStringWithCoordinates,
    prompt_replace_for_character,
    stripChineseAnnotations,
    convertImageToJpeg,
    deduplicateTags,
    getRandomYusheId
} from './utils.js';
import { setItemImg } from './database.js';
import { extension_settings } from "../../../../extensions.js";
import { extensionName, EventType } from './config.js';
import { saveSettingsDebounced, eventSource } from "../../../../../script.js";
import { initializeImageProcessing } from './iframe.js';
import { processCharacterPrompt } from './characterprompt.js';
import { bananaGenerate } from './banana.js';
import { generateComfyUIImage } from './comfyui.js';
import { taskQueue, TaskType } from './taskQueue.js';
import { recordImageGeneration } from './imageGenStats.js';

// 获取直连模式的通用请求头
function getDirectHeaders(contentType = null, auth = null) {
    const headers = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': '*/*',
        'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
        'Cache-Control': 'no-cache',
        'Pragma': 'no-cache',
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

// New, decoupled image generation function, mimicking novelai.js structure
async function generateSDImage({ prompt: link, width: Xwidth, height: Xheight, change, extraNegativePrompt }) {
    clearLog();

    // 注册任务到队列
    const taskId = taskQueue.addTask({
        name: (link || '').substring(0, 30) + (link && link.length > 30 ? '...' : ''),
        type: TaskType.SD,
        prompt: link
    });
    currentTaskId = taskId;

    let change_ = change;

    if (change) {
        change_ = change
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
    change = processCharacterPrompt(change)
    link = await stripChineseAnnotations(link)
    change = await stripChineseAnnotations(change)
    const url = extension_settings[extensionName].sdUrl.trim();
    const extension_settingss = extension_settings[extensionName];

    addLog(`正在通过sdwebui生成图片...客户端为${extension_settingss.client},模型为${extension_settingss.sd_cchatu_8_model}`);

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

                modifiedPrompt = modifiedPrompt + ", " + prompt_replace_for_character(prompt_data[`Character ${i} Prompt`], (mainPrompt || '') + ' ' + (other_prompt || ''))

            }
        }

    }


    // 使用新的 zhengmian 函数组合所有部分
    const _sd_yushe_id = getRandomYusheId('yusheid_sd');
    let prompt = await zhengmian(
        extension_settings[extensionName].yushe[_sd_yushe_id].fixedPrompt,
        modifiedPrompt,
        extension_settings[extensionName].yushe[_sd_yushe_id].fixedPrompt_end,
        extension_settings[extensionName].AQT_sd,
        insertions
    );


    let negative_prompt = await fumian(extension_settings[extensionName].yushe[_sd_yushe_id].negativePrompt, extension_settings[extensionName].UCP_sd);

    // 合并角色负面提示词（非分角色模式）
    if (!Divide_roles && window.collectedCharacterNegatives) {
        const characterNegatives = window.collectedCharacterNegatives.trim();
        if (characterNegatives) {
            negative_prompt = negative_prompt ? `${negative_prompt}, ${characterNegatives}` : characterNegatives;
            addLog(`[角色负面] 添加角色负面提示词: ${characterNegatives}`);
            console.log('[SD] 合并角色负面提示词:', characterNegatives);
        }
    }

    // 合并智绘姬传入的额外负面提示词
    if (extraNegativePrompt && extraNegativePrompt.trim()) {
        const trimmedExtra = extraNegativePrompt.trim();
        negative_prompt = negative_prompt ? `${negative_prompt}, ${trimmedExtra}` : trimmedExtra;
        addLog(`[智绘姬] 添加额外负面提示词: ${trimmedExtra}`);
        console.log('[SD] 合并智绘姬额外负面提示词:', trimmedExtra);
    }

    addLog(`负面为: ${negative_prompt}`);


    extension_settings["sd"]["auto_url"] = url;
    await saveSettingsDebounced();

    try {

        if (extension_settingss.client === 'jiuguan') {


            const readmodel = await fetch('/api/sd/get-model', {
                method: "POST",
                body: JSON.stringify({
                    auth: extension_settingss.st_chatu8_sd_auth ? extension_settingss.st_chatu8_sd_auth : "",
                    url: url
                }),
                headers: getRequestHeaders(window.token),
            });

            if (!readmodel.ok) {
                addLog(`获取模型失败: ${readmodel.status} ${readmodel.statusText}`);
                throw new Error(`获取模型失败: ${readmodel.status} ${readmodel.statusText}`);
            }

            let cmodel = await readmodel.text();

            let cleanCmodel = cmodel.trim();
            if (cleanCmodel.startsWith('"') && cleanCmodel.endsWith('"')) {
                cleanCmodel = cleanCmodel.slice(1, -1);
            }

            console.log("cmodel22222222", cmodel);
            console.log("extension_settingss.sd_cchatu_8_model", extension_settingss.sd_cchatu_8_model);

            if (cleanCmodel != extension_settingss.sd_cchatu_8_model) {

                addLog(`正在设置模型为${extension_settingss.sd_cchatu_8_model}...`);
                toastr.info(`正在设置模型...为${extension_settingss.sd_cchatu_8_model}`);

                const response = await fetch('/api/sd/set-model', {
                    method: "POST",
                    body: JSON.stringify({
                        auth: extension_settingss.st_chatu8_sd_auth ? extension_settingss.st_chatu8_sd_auth : "",
                        url: url,
                        model: extension_settingss.sd_cchatu_8_model,
                    }),
                    headers: getRequestHeaders(window.token),
                });

                if (!response.ok) {
                    addLog(`切换模型失败: ${response.status} ${response.statusText}`);
                    throw new Error(`切换模型失败: ${response.status} ${response.statusText}`);
                }
                toastr.info(`设置模型...为${extension_settingss.sd_cchatu_8_model}成功`);
            }
        } else {

            let nowmode = await getSDMode(url);
            if (nowmode != extension_settingss.sd_cchatu_8_model) {
                addLog(`正在切换模型为${extension_settingss.sd_cchatu_8_model}...`);
                await setSDMode(url, extension_settingss.sd_cchatu_8_model);
            }
        }

    } catch (error) {
        addLog(`获取或者切换模型失败: ${error.message}。请检查sdwebui是否正常启动，并检查模型是否正确。`);
        taskQueue.completeTask(taskId, false);
        currentTaskId = null;
        throw new Error(`获取或者切换模型失败，请检查sdwebui是否正常启动，并检查模型是否正确。`);
    }

    let seed = -1;
    const seedSetting = extension_settingss.sd_cseed;
    if (seedSetting !== '' && seedSetting !== null && !isNaN(Number(seedSetting)) && Number(seedSetting) >= 0) {
        seed = Number(seedSetting);
    }

    let payload = {
        prompt: prompt,
        negative_prompt: negative_prompt,
        sampler_name: extension_settingss.sd_cchatu_8_samplerName,
        scheduler: extension_settingss.sd_cchatu_8_scheduler,
        steps: extension_settingss.sd_csteps,
        cfg_scale: extension_settingss.sdCfgScale,
        width: Xwidth ? Xwidth : extension_settingss.sd_cwidth,
        height: Xheight ? Xheight : extension_settingss.sd_cheight,
        restore_faces: extension_settingss.restoreFaces == "true",
        enable_hr: extension_settingss.sd_chires_fix == "true",
        hr_upscaler: extension_settingss.sd_cchatu_8_upscaler,
        hr_scale: extension_settingss.sd_cupscale_factor,
        hr_additional_modules: [],
        denoising_strength: extension_settingss.sd_cdenoising_strength,
        hr_second_pass_steps: extension_settingss.sd_chires_steps,
        seed: seed,
        override_settings: {
            CLIP_stop_at_last_layers: Number(extension_settingss.sd_cclip_skip),
            sd_vae: extension_settingss.sd_cchatu_8_vae,
        },
        override_settings_restore_afterwards: true,
        save_images: true,
        send_images: true,
        do_not_save_grid: false,
        do_not_save_samples: false,
    };

    addLog(`restore_faces 脸部修复 为${payload.restore_faces}`);
    addLog(`enable_hr 高清修复 为${payload.enable_hr}`);

    if (extension_settingss.sd_cadetailer == "true") {
        addLog("adetailer_face 为开启");
        payload = deepMerge(payload, {
            alwayson_scripts: {
                ADetailer: {
                    args: [
                        true,
                        true,
                        {
                            'ad_model': 'face_yolov8n.pt',
                        },
                    ],
                },
            },
        });
    }

    const report = `
---
### 生图参数报告
- **正面提示 (Prompt):** ${prompt}
- **负面提示 (Negative Prompt):** ${negative_prompt}
- **采样方法 (Sampler):** ${payload.sampler_name}
- **步数 (Steps):** ${payload.steps}
- **CFG Scale:** ${payload.cfg_scale}
- **尺寸 (Size):** ${payload.width}x${payload.height}
- **种子 (Seed):** ${payload.seed === -1 ? '随机(-1)' : payload.seed}
- **模型 (Model):** ${extension_settingss.sd_cchatu_8_model}
- **VAE:** ${payload.override_settings.sd_vae}
- **Clip Skip:** ${payload.override_settings.CLIP_stop_at_last_layers}
- **高清修复 (Hires Fix):** ${payload.enable_hr}
- **放大倍率 (Upscale Factor):** ${payload.hr_scale}
- **重绘幅度 (Denoising Strength):** ${payload.denoising_strength}
- **脸部修复 (Restore Faces):** ${payload.restore_faces}
- **ADetailer:** ${extension_settingss.sd_cadetailer == "true"}
---
    `;
    addLog(report);
    addLog(`sdwebui生图参数为${JSON.stringify(payload)}`);

    console.log("payload", payload);


    while (!window.xiancheng) {
        // 检查任务是否在排队期间被取消
        if (!taskQueue.isTaskInQueue(taskId)) {
            addLog('排队等待期间任务已被取消。');
            throw new Error('任务已取消');
        }
        await sleep(1000);

    };

    let lockAcquired = false;
    try {
        // 在这之前原本就有一个 if (extension_settingss.client === 'jiuguan') 的判断
        // 为了统一，我们把 window.xiancheng = false 延迟到内部或者使用 lockAcquired 标记
        // 这里只是为了演示更安全地获取锁
        
        taskQueue.updateStatus(taskId, 'running');

        if (extension_settingss.client === 'jiuguan') {
            // 检查任务是否在发送请求前已被取消
            if (!taskQueue.isTaskInQueue(taskId)) {
                addLog('任务已被用户取消。');
                // 触发停止事件通知 jiuguan 客户端
                eventSource.emit('sd_stop_generation');
                throw new Error('任务已取消');
            }

            window.xiancheng = false;
            lockAcquired = true;

            payload.url = url

            console.log("payst_chatu8_sd_authload", extension_settingss.st_chatu8_sd_auth);

            payload.auth = extension_settingss.st_chatu8_sd_auth ? extension_settingss.st_chatu8_sd_auth : ""


            // Make the fetch call with the payload
            const result = await fetch('/api/sd/generate', {
                method: 'POST',
                headers: getRequestHeaders(window.token),
                body: JSON.stringify(payload),
            });

            if (!result.ok) {
                const errorText = await result.text();
                addLog(`酒馆 返回错误。状态码: ${result.status}。响应内容: ${errorText}`);
                console.log("响应内容:", errorText);
                throw new Error(`请求失败,状态码: ${result.status}, 详情: ${errorText}`);
            }

            const data = await result.text();
            let base64Image = ""

            try {
                // First, try to parse as JSON, which is the expected format.
                const jsonResponse = JSON.parse(data);
                base64Image = jsonResponse.images[0];
            } catch (e) {
                // If parsing fails, assume the response is the raw base64 data.
                addLog('JSON 解析失败，尝试作为原始 Base64 数据处理。');
                base64Image = data;
            }

            let imageUrl = "data:image/png;base64," + base64Image;
            addLog("图像已成功获取并格式化为 data URL。");
            setTimeout(() => {
                console.log('xiancheng 为true');
                window.xiancheng = true
            }, extension_settings[extensionName].imageGenInterval);;
            taskQueue.completeTask(taskId, true);
            currentTaskId = null;

            if (String(extension_settings[extensionName].convertToJpegStorage) === "true") {

                imageUrl = await convertImageToJpeg(imageUrl);

            }

            return { image: imageUrl, change: change || '' };

        } else {
            // 直连模式：检查任务是否已被取消
            if (!taskQueue.isTaskInQueue(taskId)) {
                addLog('任务已被用户取消。');
                throw new Error('任务已取消');
            }

            const urlObj = new URL(url + "/sdapi/v1/txt2img");
            window.xiancheng = false;
            lockAcquired = true;
            const response = await fetch(urlObj, {
                method: "POST",
                body: JSON.stringify(payload),
                headers: getDirectHeaders('application/json', getsdAuth())
            });

            setTimeout(() => {
                console.log('xiancheng 为true');
                window.xiancheng = true
            }, extension_settings[extensionName].imageGenInterval);;

            if (!response.ok) {
                const errorText = await response.text();
                addLog(`SD API 返回错误。状态码: ${response.status}。响应内容: ${errorText}`);
                console.log("响应内容:", errorText);
                throw new Error(`请求失败,状态码: ${response.status}, 详情: ${errorText}`);
            }

            const r = await response.json();

            if (!r.images || r.images.length === 0) {
                throw new Error("API响应中未找到图像数据。");
            }

            const base64Image = r.images[0];
            let imageUrl = "data:image/png;base64," + base64Image;
            addLog("图像已成功获取并格式化为 data URL。");

            taskQueue.completeTask(taskId, true);
            currentTaskId = null;

            if (String(extension_settings[extensionName].convertToJpegStorage) === "true") {

                imageUrl = await convertImageToJpeg(imageUrl);

            }

            return { image: imageUrl, change: change_ || '' };
        }

    } catch (error) {

        if (lockAcquired) {
            window.xiancheng = true;
        }


        // 更新任务状态
        if (error.message === '任务已取消') {
            // 已在 cancelTask 中更新状态
        } else {
            taskQueue.completeTask(taskId, false);
        }
        currentTaskId = null;

        addLog(`sd请求生图错误: ${error.message}`);
        console.error('Error generating image:', error);
        throw error;
    }

}

async function sdGenerate(requestData) {
    const { id, prompt, width, height, change, negative_prompt: extraNegativePrompt } = requestData;
    addLog(`收到SD生图请求 (ID: ${id}) - Prompt: ${prompt}${change ? ` - Change: ${change}` : ''}${extraNegativePrompt ? ` - NegativePrompt: ${extraNegativePrompt}` : ''}`);

    if (change && change.includes('{修图}')) {

        bananaGenerate(requestData)
        return;
    }

    if (change && change.includes('{视频}')) {
        bananaGenerate(requestData)
        return;
    }

    if (change && change.includes('{ComfyUI局部重绘}')) {
        try {
            const { image: imageUrl, change: returnedChange, isVideo, format } = await generateComfyUIImage({ prompt, width, height, change, extraNegativePrompt });
            const cleanedChange = returnedChange.replaceAll('{ComfyUI局部重绘}', '');

            if (extension_settings[extensionName].cache != "0") {
                await setItemImg(prompt, imageUrl, { change: cleanedChange });
                addLog(`图像已存入数据库 for prompt: ${prompt}`);
            } else {
                addLog(`缓存设置为不存入数据库`);
            }

            recordImageGeneration('sd', true);
            eventSource.emit(EventType.GENERATE_IMAGE_RESPONSE, {
                id,
                success: true,
                imageData: imageUrl,
                prompt: prompt,
                change: cleanedChange,
                isVideo: isVideo || false,
                format: format || 'image',
            });
            addLog(`发送ComfyUI局部重绘成功响应 (ID: ${id})`);
        } catch (error) {
            const errorMsg = `ComfyUI局部重绘流程捕获到异常 (ID: ${id}): ${error.message}`;
            addLog(`错误: ${errorMsg}`);
            console.error('Error generating ComfyUI inpaint image:', error);

            recordImageGeneration('sd', false);
            eventSource.emit(EventType.GENERATE_IMAGE_RESPONSE, {
                id,
                success: false,
                error: error.message,
                prompt: prompt,
            });
            addLog(`发送ComfyUI局部重绘失败响应 (ID: ${id})`);
        }
        return;
    }

    try {
        const { image: imageUrl, change: returnedChange } = await generateSDImage({ prompt, width, height, change, extraNegativePrompt });

        if (extension_settings[extensionName].cache != "0") {


            await setItemImg(prompt, imageUrl, { change: returnedChange });
            addLog(`图像已存入数据库 for prompt: ${prompt}`);

        } else {

            addLog(`缓存设置为不存入数据库`);

        }

        recordImageGeneration('sd', true);
        eventSource.emit(EventType.GENERATE_IMAGE_RESPONSE, {
            id,
            success: true,
            imageData: imageUrl,
            prompt: prompt,
            change: returnedChange,
        });
        addLog(`发送SD生图成功响应 (ID: ${id})`);

    } catch (error) {
        const errorMsg = `SD生图流程捕获到异常 (ID: ${id}): ${error.message}`;
        addLog(`错误: ${errorMsg}`);
        console.error('Error generating SD image:', error);

        recordImageGeneration('sd', false);
        eventSource.emit(EventType.GENERATE_IMAGE_RESPONSE, {
            id,
            success: false,
            error: error.message,
            prompt: prompt,
        });
        addLog(`发送SD生图失败响应 (ID: ${id})`);
    }
}

function initializeSDListener() {
    eventSource.on(EventType.GENERATE_IMAGE_REQUEST, sdGenerate);
    addLog("SD 生图事件监听器已初始化。");
}

export async function replaceWithSd() {
    if (extension_settings[extensionName].mode == "sd") {
        if (!window.initializeSDListener) {
            window.initializeSDListener = true;
            initializeSDListener();
        }
        initializeImageProcessing();
    } else {
        if (window.initializeSDListener) {
            eventSource.removeListener(EventType.GENERATE_IMAGE_REQUEST, sdGenerate);
            window.initializeSDListener = false;
            addLog("SD 生图事件监听器已关闭。");
        }
    }
}
