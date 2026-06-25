// @ts-nocheck
import {
    sleep,
    generateRandomSeed,
    zhengmian,
    fumian,
    prompt_replace,
    prompt_replace_for_character,
    parsePromptStringWithCoordinates,
    getRequestHeaders,
    calculateSkipCfgAboveSigma,
    processReferenceImage,
    addLog,
    clearLog,
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
import { processCharacterPrompt } from './characterprompt.js';
import { bananaGenerate } from './banana.js';
import { generateComfyUIImage } from './comfyui.js';
import { taskQueue, TaskType } from './taskQueue.js';
import { recordImageGeneration } from './imageGenStats.js';
import { waitForTurn, completeQueue, leaveQueue, getUserId, hashKey } from './queueService.js';
import { getConfigImage } from './configDatabase.js';
import { resolveVibeData } from './settings/vibeGroupEditor.js';

// 获取直连模式的通用请求头
function normalizeNovelAIOtherSiteUrl(value) {
    if (typeof value !== 'string') {
        return '';
    }
    return value.trim().replace(/\/+$/, '');
}

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
// 当前请求的 AbortController（用于取消正在进行的请求）
let currentAbortController = null;

// 云端队列状态
let currentCloudQueueInfo = null; // { keyHash, userId, lockToken }

/**
 * Cleans the NovelAI API payload by removing arrays not needed for the current model
 * NAI3 uses: reference_image_multiple, reference_information_extracted_multiple, reference_strength_multiple
 * NAI4/4.5 uses: reference_image_multiple_cached, reference_strength_multiple
 * NAI4.5 Character Reference uses: director_reference_* arrays
 * 
 * @param {Object} payload - The API payload to clean
 * @param {string} modelVersion - The NovelAI model version
 * @returns {Object} Cleaned payload
 */
function cleanNovelAIPayload(payload, modelVersion) {
    const isNAI3 = modelVersion === 'nai-diffusion-3';
    const isNAI4or45 = modelVersion.includes('nai-diffusion-4');

    // Create a copy to avoid mutating the original
    const cleanedPayload = { ...payload };

    if (isNAI3) {
        // NAI3: Remove NAI4/4.5 arrays
        delete cleanedPayload.reference_image_multiple_cached;
        delete cleanedPayload.director_reference_images_cached;
        delete cleanedPayload.director_reference_descriptions;
        delete cleanedPayload.director_reference_information_extracted;
        delete cleanedPayload.director_reference_strength_values;
        delete cleanedPayload.director_reference_secondary_strength_values;

        addLog('[PayloadClean] 已移除 NAI4/4.5 数组（使用 NAI3 模型）');
    } else if (isNAI4or45) {
        // NAI4/4.5: Remove NAI3 arrays (except reference_strength_multiple which is shared)
        delete cleanedPayload.reference_image_multiple;
        delete cleanedPayload.reference_information_extracted_multiple;

        addLog('[PayloadClean] 已移除 NAI3 数组（使用 NAI4/4.5 模型）');
    }

    return cleanedPayload;
}

/**
 * Validates the NovelAI API payload before sending
 * Ensures all reference arrays have consistent lengths
 * 
 * @param {Object} payload - The API payload to validate
 * @param {string} modelVersion - The NovelAI model version
 * @throws {Error} If validation fails
 * @returns {void}
 */
function validateNovelAIPayload(payload, modelVersion) {
    // Validate required fields
    const requiredFields = ['width', 'height', 'scale', 'sampler', 'steps', 'seed'];
    for (const field of requiredFields) {
        if (payload[field] === undefined || payload[field] === null) {
            throw new Error(`缺少必需字段: ${field}`);
        }
    }

    // Validate reference arrays for NAI3
    if (modelVersion === 'nai-diffusion-3') {
        const refImageLen = payload.reference_image_multiple?.length || 0;
        const refInfoLen = payload.reference_information_extracted_multiple?.length || 0;
        const refStrengthLen = payload.reference_strength_multiple?.length || 0;

        if (refImageLen > 0 || refInfoLen > 0 || refStrengthLen > 0) {
            if (refImageLen !== refInfoLen || refImageLen !== refStrengthLen) {
                const errorMsg = `NAI3 参考数组长度不匹配: ` +
                    `reference_image_multiple=${refImageLen}, ` +
                    `reference_information_extracted_multiple=${refInfoLen}, ` +
                    `reference_strength_multiple=${refStrengthLen}`;
                addLog(`[验证错误] ${errorMsg}`);
                throw new Error(errorMsg);
            }
            addLog(`[验证] NAI3 参考数组长度一致: ${refImageLen} 个参考`);
        }
    }

    // Validate reference arrays for NAI4/4.5 Vibe Transfer
    if (modelVersion.includes('nai-diffusion-4')) {
        const refCachedLen = payload.reference_image_multiple_cached?.length || 0;
        const refStrengthLen = payload.reference_strength_multiple?.length || 0;

        if (refCachedLen > 0 && refCachedLen !== refStrengthLen) {
            const errorMsg = `NAI4/4.5 Vibe Transfer 数组长度不匹配: ` +
                `reference_image_multiple_cached=${refCachedLen}, ` +
                `reference_strength_multiple=${refStrengthLen}`;
            addLog(`[验证错误] ${errorMsg}`);
            throw new Error(errorMsg);
        }
        if (refCachedLen > 0) {
            addLog(`[验证] NAI4/4.5 Vibe Transfer 数组长度一致: ${refCachedLen} 个 Vibe`);
        }
    }

    // Validate Character Reference arrays for NAI4.5
    if (modelVersion.includes('4-5')) {
        const directorImages = payload.director_reference_images_cached?.length || 0;
        const directorDescriptions = payload.director_reference_descriptions?.length || 0;
        const directorInfo = payload.director_reference_information_extracted?.length || 0;
        const directorStrength = payload.director_reference_strength_values?.length || 0;
        const directorSecondary = payload.director_reference_secondary_strength_values?.length || 0;

        if (directorImages > 0) {
            if (directorImages !== directorDescriptions ||
                directorImages !== directorInfo ||
                directorImages !== directorStrength ||
                directorImages !== directorSecondary) {
                const errorMsg = `角色参考数组长度不匹配: ` +
                    `images=${directorImages}, descriptions=${directorDescriptions}, ` +
                    `info=${directorInfo}, strength=${directorStrength}, secondary=${directorSecondary}`;
                addLog(`[验证错误] ${errorMsg}`);
                throw new Error(errorMsg);
            }
            addLog(`[验证] 角色参考数组长度一致: ${directorImages} 个参考`);
        }
    }

    addLog('[验证] Payload 验证通过');
}

/**
 * Apply single Vibe Transfer for NAI3
 * Ensures all reference arrays are populated atomically
 * 
 * @param {Object} preset_data - The generation parameters object
 * @returns {Promise<void>}
 */
async function applySingleVibeTransfer(preset_data) {
    if (!window.nai3VibeTransferImage || window.nai3VibeTransferImage === '') {
        addLog('[SingleVibe] 未设置 Vibe Transfer 图像，跳过');
        return;
    }

    try {
        addLog('[SingleVibe] 处理 NAI3 单个 Vibe Transfer');

        // Process the reference image
        const processedImage = await processReferenceImage(window.nai3VibeTransferImage);
        const infoExtracted = Number(extension_settings[extensionName].InformationExtracted);
        const strength = Number(extension_settings[extensionName].ReferenceStrength);

        // Validate values
        if (isNaN(infoExtracted) || infoExtracted < 0 || infoExtracted > 1) {
            throw new Error(`InformationExtracted 值无效: ${infoExtracted}。必须在 0 到 1 之间。`);
        }
        if (isNaN(strength) || strength < 0 || strength > 1) {
            throw new Error(`ReferenceStrength 值无效: ${strength}。必须在 0 到 1 之间。`);
        }

        // Atomic operation: add to all three arrays together
        preset_data.reference_image_multiple.push(processedImage);
        preset_data.reference_information_extracted_multiple.push(infoExtracted);
        preset_data.reference_strength_multiple.push(strength);

        addLog(`[SingleVibe] 已添加 Vibe Transfer: info=${infoExtracted}, strength=${strength}`);
        addLog(`[SingleVibe] 数组长度: images=${preset_data.reference_image_multiple.length}, ` +
            `info=${preset_data.reference_information_extracted_multiple.length}, ` +
            `strength=${preset_data.reference_strength_multiple.length}`);
    } catch (error) {
        addLog(`[SingleVibe] 错误: ${error.message}`);
        throw error;
    }
}

/**
 * Get the encoding key for a given NovelAI model
 * Maps NovelAI model names to their corresponding encoding keys in Vibe data
 * 
 * @param {string} model - The NovelAI model name
 * @returns {string} The encoding key for the model
 */
function getEncodingKeyForModel(model) {
    // Use includes() for more flexible matching, but check longer strings first
    // to avoid false matches (e.g., '4-5-curated' before '4-curated')
    if (model.includes('4-5-curated')) return 'v4-5curated';
    if (model.includes('4-5-full')) return 'v4-5full';
    if (model.includes('4-curated')) return 'v4curated';
    if (model.includes('4-full')) return 'v4full';
    if (model.includes('diffusion-3')) return 'v3';

    // Default to v4-5curated for unknown models
    console.warn('[VibeGroup] Unknown model:', model, '- defaulting to v4-5curated');
    return 'v4-5curated';
}

/**
 * Generate a random UUID v4
 * Uses crypto.randomUUID() when available, otherwise falls back to manual generation
 * 
 * @returns {string} A UUID string in the format "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx"
 */
function generateRandomUUID() {
    // Use crypto.randomUUID() if available (modern browsers)
    if (typeof crypto !== 'undefined' && crypto.randomUUID) {
        return crypto.randomUUID();
    }

    // Fallback: generate UUID v4 manually
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
        const r = Math.random() * 16 | 0;
        const v = c === 'x' ? r : (r & 0x3 | 0x8);
        return v.toString(16);
    });
}

function createLoggableNovelAIPayload(payload) {
    const loggablePayload = { ...payload };

    if (Array.isArray(payload.reference_image_multiple) && payload.reference_image_multiple.length > 0) {
        loggablePayload.reference_image_multiple = payload.reference_image_multiple.map((image, index) =>
            `...image data truncated (${image?.length || 0} chars)...`
        );
    }

    if (Array.isArray(payload.reference_image_multiple_cached) && payload.reference_image_multiple_cached.length > 0) {
        loggablePayload.reference_image_multiple_cached = payload.reference_image_multiple_cached.map((item) => ({
            cache_secret_key: item.cache_secret_key,
            data: `...vibe data truncated (${item.data?.length || 0} chars)...`
        }));
    }

    if (Array.isArray(payload.director_reference_images) && payload.director_reference_images.length > 0) {
        loggablePayload.director_reference_images = payload.director_reference_images.map((image) =>
            `...image data truncated (${image?.length || 0} chars)...`
        );
    }

    if (Array.isArray(payload.director_reference_images_cached) && payload.director_reference_images_cached.length > 0) {
        loggablePayload.director_reference_images_cached = payload.director_reference_images_cached.map((item) => ({
            cache_secret_key: item.cache_secret_key,
            data: `...char ref data truncated (${item.data?.length || 0} chars)...`
        }));
    }

    return loggablePayload;
}

/**
 * Apply Vibe Group Transfer to generation parameters (NAI4/4.5 only)
 * Loads the selected Vibe group and adds each Vibe to the request using reference_image_multiple_cached
 * 
 * @param {Object} preset_data - The generation parameters object
 * @returns {Promise<void>}
 */
async function applyVibeGroupTransfer(preset_data) {
    const settings = extension_settings[extensionName];
    const vibeGroups = settings.vibeGroups || {};
    const currentGroupId = settings.vibeGroupId;

    // Validate that Vibe groups exist
    if (!vibeGroups || Object.keys(vibeGroups).length === 0) {
        const warningMsg = '警告: 未找到 Vibe 组。请先创建至少一个 Vibe 组。';
        console.warn('[VibeGroup] No Vibe groups exist');
        addLog(`[VibeGroup] ${warningMsg}`);
        toastr.warning(warningMsg, 'Vibe 组氛围转移');
        return;
    }

    // Validate group exists
    if (!currentGroupId || !vibeGroups[currentGroupId]) {
        const warningMsg = '警告: 未选择有效的 Vibe 组。请在 Vibe 组编辑器中选择一个组。';
        console.warn('[VibeGroup] No valid Vibe group selected for transfer');
        addLog(`[VibeGroup] ${warningMsg}`);
        toastr.warning(warningMsg, 'Vibe 组氛围转移');
        return;
    }

    const currentGroup = vibeGroups[currentGroupId];
    const vibes = currentGroup.vibes || [];

    // Validate group has Vibes
    if (vibes.length === 0) {
        const errorMsg = '错误: 选中的 Vibe 组为空。请添加至少一个 Vibe 到组中。';
        console.warn('[VibeGroup] Selected Vibe group is empty');
        addLog(`[VibeGroup] ${errorMsg}`);
        toastr.error(errorMsg, 'Vibe 组氛围转移');
        return;
    }

    console.log(`[VibeGroup] Applying Vibe group transfer: ${currentGroup.name || currentGroupId} (${vibes.length} Vibes)`);
    addLog(`[VibeGroup] 应用 Vibe 组氛围转移: ${currentGroup.name || currentGroupId} (${vibes.length} 个 Vibe)`);

    let successCount = 0;
    let failureCount = 0;
    const vibeDataArray = []; // Collect data from all vibes

    // Load and process each Vibe in the group
    for (const vibe of vibes) {
        try {
            // Load parsed Vibe data from shared cache
            const vibeJson = await resolveVibeData(vibe.vibeDataId);

            if (!vibeJson) {
                failureCount++;
                console.warn('[VibeGroup] Vibe data not found:', vibe.vibeDataId);
                addLog(`[VibeGroup] 警告: 未找到 Vibe 数据: ${vibe.vibeDataId.substring(0, 12)}...`);
                continue;
            }

            // Extract the appropriate encoding based on model
            const model = settings.novelaimode;
            const encodingKey = getEncodingKeyForModel(model);

            console.log('[VibeGroup] Model mapping:', {
                originalModel: model,
                encodingKey: encodingKey,
                availableEncodings: Object.keys(vibeJson.encodings || {})
            });

            const modelEncodings = vibeJson.encodings?.[encodingKey];

            if (!modelEncodings) {
                failureCount++;
                console.warn('[VibeGroup] No encoding found for model:', model, 'encodingKey:', encodingKey, 'in Vibe:', vibe.vibeDataId);
                console.warn('[VibeGroup] Available encodings:', Object.keys(vibeJson.encodings || {}));
                addLog(`[VibeGroup] 警告: 未找到模型 ${model} (${encodingKey}) 的编码`);
                continue;
            }

            // The encoding structure is: encodings[modelKey][hashKey]
            // We need to get the first (and usually only) encoding key
            const encodingKeys = Object.keys(modelEncodings);
            if (encodingKeys.length === 0) {
                failureCount++;
                console.warn('[VibeGroup] No encoding keys found for model:', model, 'in Vibe:', vibe.vibeDataId);
                addLog(`[VibeGroup] 警告: 未找到模型 ${model} 的编码键`);
                continue;
            }

            // Use the first encoding key (usually the fixed key)
            const firstEncodingKey = encodingKeys[0];
            const encodingData = modelEncodings[firstEncodingKey];

            if (!encodingData || !encodingData.encoding) {
                failureCount++;
                console.warn('[VibeGroup] Invalid encoding structure for model:', model, 'in Vibe:', vibe.vibeDataId);
                addLog(`[VibeGroup] 警告: 编码结构无效`);
                continue;
            }

            const encoding = encodingData.encoding;

            // Extract the data field from encoding (for NAI4/4.5)
            // The encoding is already a base64 string, not an object with a data field
            const data = typeof encoding === 'string' ? encoding : (encoding.data || encoding);

            // Extract information_extracted value
            const infoExtracted = encodingData.params?.information_extracted || 1.0;

            // Collect vibe data for later processing
            vibeDataArray.push({
                data: data,
                infoExtracted: infoExtracted,
                strength: vibe.strength
            });

            successCount++;
            console.log('[VibeGroup] Collected Vibe data:', {
                vibeDataId: vibe.vibeDataId.substring(0, 12) + '...',
                strength: vibe.strength,
                infoExtracted: infoExtracted
            });
            addLog(`[VibeGroup] 已收集 Vibe: 强度=${vibe.strength}, 信息提取=${infoExtracted}`);
        } catch (error) {
            failureCount++;
            console.error('[VibeGroup] Error processing Vibe:', {
                vibeDataId: vibe.vibeDataId,
                error: error.message,
                errorName: error.name,
                stack: error.stack
            });
            addLog(`[VibeGroup] 错误: 处理 Vibe 失败: ${error.message}`);
        }
    }

    // If no vibes were successfully processed, return early
    if (vibeDataArray.length === 0) {
        console.warn('[VibeGroup] No vibes were successfully processed');
        addLog('[VibeGroup] 警告: 没有成功处理任何 Vibe');
        if (failureCount > 0) {
            toastr.error('所有 Vibe 处理失败，将不使用氛围转移', 'Vibe 组氛围转移');
        }
        return;
    }

    // Normalize strength values based on normalizeRefStrength setting
    const totalStrength = vibeDataArray.reduce((sum, v) => sum + v.strength, 0);
    const shouldNormalize = extension_settings[extensionName].normalizeRefStrength === "true";
    const isNAI45Model = ["nai-diffusion-4-5-full", "nai-diffusion-4-5-curated"]
        .includes(extension_settings[extensionName].novelaimode);

    let normalizedStrength;

    if (shouldNormalize && isNAI45Model) {
        // For NAI 4.5 with normalizeRefStrength enabled: skip manual adjustment, let API handle it
        normalizedStrength = vibeDataArray.map(v => v.strength);
        console.log(`[VibeGroup] NAI 4.5 自动归一化已启用，跳过手动调整 (总和: ${totalStrength.toFixed(3)})`);
        addLog(`[VibeGroup] NAI 4.5 自动归一化已启用，跳过手动调整 (总和: ${totalStrength.toFixed(3)})`);
    } else if (totalStrength > 1.0) {
        // For other cases: only normalize if sum exceeds 1.0
        normalizedStrength = vibeDataArray.map(v => v.strength / totalStrength);
        console.log(`[VibeGroup] 强度值已归一化 (总和超过 1.0: ${totalStrength.toFixed(3)})`);
        addLog(`[VibeGroup] 强度值已归一化 (总和超过 1.0: ${totalStrength.toFixed(3)})`);
        // Log individual normalized values for debugging
        normalizedStrength.forEach((s, i) => {
            console.log(`[VibeGroup]   Vibe ${i}: ${vibeDataArray[i].strength.toFixed(2)} → ${s.toFixed(3)}`);
        });
    } else {
        // Use original strength values
        normalizedStrength = vibeDataArray.map(v => v.strength);
        console.log(`[VibeGroup] 使用原始强度值 (总和: ${totalStrength.toFixed(3)})`);
        addLog(`[VibeGroup] 使用原始强度值 (总和: ${totalStrength.toFixed(3)})`);
    }

    // Build request parameters
    for (let i = 0; i < vibeDataArray.length; i++) {
        const vibeData = vibeDataArray[i];

        // Generate random cache_secret_key for each Vibe
        const cacheSecretKey = generateRandomUUID();

        // Add to reference_image_multiple_cached (NAI4/4.5 format)
        preset_data.reference_image_multiple_cached.push({
            cache_secret_key: cacheSecretKey,
            data: vibeData.data
        });

        // Add normalized strength to reference_strength_multiple
        // Note: information_extracted is already encoded in the cached data, no need for separate array
        preset_data.reference_strength_multiple.push(normalizedStrength[i]);
    }

    // Log summary
    console.log(`[VibeGroup] Transfer complete: ${successCount} succeeded, ${failureCount} failed`);
    addLog(`[VibeGroup] 氛围转移完成: ${successCount} 个成功, ${failureCount} 个失败`);
    console.log(`[VibeGroup] Added ${vibeDataArray.length} vibes to request parameters`);
    addLog(`[VibeGroup] 已添加 ${vibeDataArray.length} 个 Vibe 到请求参数`);

    // Show warning if some Vibes failed but at least one succeeded
    if (failureCount > 0 && successCount > 0) {
        toastr.warning(`部分 Vibe 处理失败 (${failureCount}/${vibes.length})，但生成将继续进行`, 'Vibe 组氛围转移');
    }
}

/**
 * Apply Character Reference Group to generation parameters (NAI4.5+ only)
 * Loads the selected character reference group and adds each reference to the request
 * 
 * @param {Object} preset_data - The generation parameters object
 * @returns {Promise<void>}
 */
async function applyCharacterReferenceGroup(preset_data) {
    const settings = extension_settings[extensionName];
    const charRefGroups = settings.charRefGroups || {};
    const currentGroupId = settings.charRefGroupId;

    // Validate that Character Reference groups exist
    if (!charRefGroups || Object.keys(charRefGroups).length === 0) {
        const warningMsg = '警告: 未找到角色参考组。请先创建至少一个角色参考组。';
        console.warn('[CharRef] No character reference groups exist');
        addLog(`[CharRef] ${warningMsg}`);
        toastr.warning(warningMsg, '角色参考');
        return;
    }

    // Validate group exists
    if (!currentGroupId || !charRefGroups[currentGroupId]) {
        const warningMsg = '警告: 未选择有效的角色参考组。请在角色组编辑器中选择一个组。';
        console.warn('[CharRef] No valid character reference group selected');
        addLog(`[CharRef] ${warningMsg}`);
        toastr.warning(warningMsg, '角色参考');
        return;
    }

    const currentGroup = charRefGroups[currentGroupId];
    const references = currentGroup.references || [];

    // Validate group has references
    if (references.length === 0) {
        const errorMsg = '错误: 选中的角色参考组为空。请添加至少一个角色参考到组中。';
        console.warn('[CharRef] Selected character reference group is empty');
        addLog(`[CharRef] ${errorMsg}`);
        toastr.error(errorMsg, '角色参考');
        return;
    }

    console.log(`[CharRef] Applying character reference group: ${currentGroup.name || currentGroupId} (${references.length} references)`);
    addLog(`[CharRef] 应用角色参考组: ${currentGroup.name || currentGroupId} (${references.length} 个参考)`);

    let successCount = 0;
    let failureCount = 0;

    // Initialize arrays
    preset_data.director_reference_images_cached = [];
    preset_data.director_reference_descriptions = [];
    preset_data.director_reference_information_extracted = [];
    preset_data.director_reference_strength_values = [];
    preset_data.director_reference_secondary_strength_values = [];

    // Load and process each reference in the group
    for (const ref of references) {
        try {
            // Load reference image from configDatabase
            const imageDataUrl = await getConfigImage(ref.imageId);

            if (!imageDataUrl) {
                failureCount++;
                console.warn('[CharRef] Reference image not found:', ref.imageId);
                addLog(`[CharRef] 警告: 未找到角色参考图像: ${ref.imageId.substring(0, 12)}...`);
                continue;
            }

            // Process image to base64 format
            const processedImage = await processReferenceImage(imageDataUrl);

            // Generate random cache_secret_key for this reference
            const cacheSecretKey = generateRandomUUID();

            // Add to director_reference_images_cached
            preset_data.director_reference_images_cached.push({
                cache_secret_key: cacheSecretKey,
                data: processedImage
            });

            // Map reference type to base_caption
            let baseCaption = "character";
            if (ref.type === "character_style") {
                baseCaption = "character&style";
            } else if (ref.type === "style") {
                baseCaption = "style";
            }

            // Add to director_reference_descriptions
            preset_data.director_reference_descriptions.push({
                caption: {
                    base_caption: baseCaption,
                    char_captions: []
                },
                legacy_uc: false
            });

            // Add information_extracted (must be exactly 1.0 per NovelAI API requirement)
            preset_data.director_reference_information_extracted.push(1.0);

            // Add primary strength
            preset_data.director_reference_strength_values.push(ref.strength);

            // Add secondary strength (1 - primary strength)
            preset_data.director_reference_secondary_strength_values.push(1 - ref.strength);

            successCount++;
            console.log('[CharRef] Added reference:', {
                imageId: ref.imageId.substring(0, 12) + '...',
                type: ref.type,
                strength: ref.strength,
                secondaryStrength: (1 - ref.strength).toFixed(3),
                fidelity: ref.fidelity,
                information_extracted: 1.0
            });
            addLog(`[CharRef] 已添加参考: 类型=${ref.type}, 强度=${ref.strength}, 次要强度=${(1 - ref.strength).toFixed(3)}, 保真度=${ref.fidelity}, information_extracted=1.0`);
        } catch (error) {
            failureCount++;
            console.error('[CharRef] Error processing reference:', {
                imageId: ref.imageId,
                error: error.message,
                errorName: error.name,
                stack: error.stack
            });
            addLog(`[CharRef] 错误: 处理角色参考失败: ${error.message}`);
        }
    }

    // Log summary
    console.log(`[CharRef] Application complete: ${successCount} succeeded, ${failureCount} failed`);
    addLog(`[CharRef] 角色参考应用完成: ${successCount} 个成功, ${failureCount} 个失败`);

    // Show warning if some references failed but at least one succeeded
    if (failureCount > 0 && successCount > 0) {
        toastr.warning(`部分角色参考处理失败 (${failureCount}/${references.length})，但生成将继续进行`, '角色参考');
    }

    // If all references failed, show error
    if (successCount === 0) {
        toastr.error('所有角色参考处理失败，将不使用角色参考', '角色参考');
    }
}

function decryptNovelAI(encryptedString) {
    // It might not be an encrypted string, check for the separator
    if (!encryptedString || typeof encryptedString !== 'string' || !encryptedString.includes(':')) {
        return encryptedString;
    }

    try {
        const keyHex = 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2';
        const key = CryptoJS.enc.Hex.parse(keyHex);

        const parts = encryptedString.split(':');
        if (parts.length !== 2) {
            return encryptedString;
        }

        const iv = CryptoJS.enc.Hex.parse(parts[0]);
        const encryptedData = parts[1];

        const cipherParams = CryptoJS.lib.CipherParams.create({
            ciphertext: CryptoJS.enc.Hex.parse(encryptedData)
        });

        const decrypted = CryptoJS.AES.decrypt(cipherParams, key, {
            iv: iv,
            mode: CryptoJS.mode.CBC,
            padding: CryptoJS.pad.Pkcs7
        });

        const decryptedString = decrypted.toString(CryptoJS.enc.Utf8);
        if (decryptedString) {
            return decryptedString;
        } else {
            console.error("NovelAI credential decryption failed. The key might be wrong or the data corrupted. Using raw value.");
            return encryptedString;
        }
    } catch (e) {
        console.error("An error occurred during decryption:", e);
        return encryptedString; // Fallback to original string
    }
}


function unzipFile(arrayBuffer) {
    addLog("开始解压 ZIP 文件...");
    const JSZipConstructor = window.stChatu8JSZip || window.JSZip;
    if (!JSZipConstructor || typeof JSZipConstructor.loadAsync !== 'function') {
        const error = new Error('JSZip 不可用，无法解压 ZIP 文件');
        addLog(error.message);
        return Promise.reject(error);
    }

    return new Promise((resolve, reject) => {
        JSZipConstructor.loadAsync(arrayBuffer)
            .then(function (zip) {
                addLog("ZIP 文件加载成功");

                // 遍历 ZIP 文件中的所有文件
                zip.forEach(function (relativePath, zipEntry) {
                    addLog(`在 ZIP 中找到文件: ${zipEntry.name}`);

                    zipEntry.async('base64').then(function (base64String) {
                        addLog(`文件 ${zipEntry.name} 解压为 Base64，大小: ${base64String.length}`);
                        resolve(base64String);
                    }).catch(err => {
                        addLog(`解压文件 ${zipEntry.name} 失败: ${err.message}`);
                        reject(err);
                    });
                });
            }).catch(err => {
                addLog(`加载 ZIP 文件失败: ${err.message}`);
                reject(err);
            });
    });
}

function _parseMsgpackMessage(messageData) {
    try {
        const unpacked = MessagePack.decode(messageData);
        if (unpacked && unpacked.event_type) {
            addLog(`解析 Msgpack 消息成功: 事件类型 - ${unpacked.event_type}`);
            return { eventType: unpacked.event_type, imageData: unpacked.image };
        }
    } catch (error) {
        addLog(`解析 Msgpack 消息失败: ${error.message}`);
        console.error("解析Msgpack消息失败:", error);
    }
    return null;
}

function _parseMsgpackEvents(msgpack_data) {
    addLog("开始解析 Msgpack 事件流...");
    let offset = 0;
    const events = [];
    while (offset < msgpack_data.length) {
        try {
            const lengthBytes = msgpack_data.slice(offset, offset + 4);
            const messageLength = new DataView(lengthBytes.buffer).getUint32(0);
            const msgStart = offset + 4;
            const msgEnd = msgStart + messageLength;
            addLog(`发现 Msgpack 消息: 长度 ${messageLength}, 范围 ${msgStart}-${msgEnd}`);
            const messageData = msgpack_data.slice(msgStart, msgEnd);
            const event = _parseMsgpackMessage(messageData);
            if (event) events.push(event);
            offset = msgEnd;
        } catch (error) {
            addLog(`解析 Msgpack 事件失败: ${error.message}`);
            console.error("解析Msgpack事件失败:", error);
            offset++; // 尝试跳过一个字节以继续
        }
    }
    addLog(`Msgpack 事件流解析完成，共找到 ${events.length} 个事件。`);
    return events;
}

function uint8ArrayToBase64(uint8Array) {
    // 创建一个字符数组，用于存储 Base64 字符
    let binary = '';
    const len = uint8Array.byteLength;

    // 将每个字节转换为字符
    for (let i = 0; i < len; i++) {
        binary += String.fromCharCode(uint8Array[i]);
    }
    // 使用 btoa() 将二进制字符串转换为 Base64 编码
    return btoa(binary);
}

// 新的、解耦的图像生成函数
async function generateNovelAIImage({ prompt: link, width: Xwidth, height: Xheight, change, extraNegativePrompt }) {
    clearLog();

    // 注册任务到队列
    const taskId = taskQueue.addTask({
        name: (link || '').substring(0, 30) + (link && link.length > 30 ? '...' : ''),
        type: TaskType.NOVELAI,
        prompt: link
    });
    currentTaskId = taskId;



    addLog(`开始 NovelAI 生图流程...客户端为${extension_settings[extensionName].client}`);
    addLog(`请求尺寸: 宽度 - ${Xwidth || '默认'}, 高度 - ${Xheight || '默认'}`);

    console.log("正在处理中文注释...", link);
    let change_ = change;
    if (change) {
        change_ = change
    } else {

        change_ = link
    }


    // 创建新的 AbortController 用于取消请求
    currentAbortController = new AbortController();

    // --- 提取并剔除分辨率，应用到生成参数 ---
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


    console.log("11111122" + JSON.stringify(link))


    link = await stripChineseAnnotations(link)
    change = await stripChineseAnnotations(change)

    console.log("正在处理中文注释完成...", link);

    if (extension_settings[extensionName].novelaiApi == '000000') {
        addLog("请填写 NovelAI API Key");
        toastr.error("请填写 NovelAI API Key");
        taskQueue.completeTask(taskId, false);
        currentTaskId = null;
        throw new Error("请填写 NovelAI API Key");
    }

    const promptForGeneration = (change && change.trim() !== '') ? change : link;
    addLog(`用于生成的Tag: ${promptForGeneration}`);

    let Divide_roles = false;
    if (promptForGeneration.includes("Scene Composition") && (extension_settings[extensionName].novelaimode == "nai-diffusion-4-curated-preview" || extension_settings[extensionName].novelaimode == "nai-diffusion-4-full" || extension_settings[extensionName].novelaimode == "nai-diffusion-4-5-full" || extension_settings[extensionName].novelaimode == "nai-diffusion-4-5-curated")) {
        Divide_roles = true;
    }
    addLog(`是否启用分角色模式 (Divide_roles): ${Divide_roles}`);


    let access_token = extension_settings[extensionName].novelaiApi;

    let aqt = "";
    if (extension_settings[extensionName].AQT_novelai != '' && extension_settings[extensionName].novelaimode == "nai-diffusion-4-curated-preview") {
        aqt = "rating:general, best quality, very aesthetic, absurdres";
    } else if (extension_settings[extensionName].AQT_novelai != '' && extension_settings[extensionName].novelaimode == "nai-diffusion-4-full") {
        aqt = "no text, best quality, very aesthetic, absurdres";
    } else if (extension_settings[extensionName].AQT_novelai != '' && extension_settings[extensionName].novelaimode == "nai-diffusion-4-5-full") {
        aqt = "very aesthetic, masterpiece, no text";
    } else if (extension_settings[extensionName].AQT_novelai != '' && extension_settings[extensionName].novelaimode == "nai-diffusion-4-5-curated") {
        aqt = "very aesthetic, masterpiece, no text, -0.8::feet::, rating:general";
    } else if (extension_settings[extensionName].AQT_novelai != '' && extension_settings[extensionName].novelaimode == "nai-diffusion-3") {
        aqt = "best quality, amazing quality, very aesthetic, absurdres";
    }
    addLog(`AQT (质量标签) 设置: ${aqt || '无'}`);

    let prompt = "";
    let prompt_data = {};
    let mainPrompt = "";
    let other_prompt = "";

    if (Divide_roles) {
        addLog("分角色模式: 解析带坐标的提示词字符串。");
        prompt_data = parsePromptStringWithCoordinates(promptForGeneration);
        mainPrompt = prompt_data["Scene Composition"];

        for (let i = 1; i <= 4; i++) {

            if (prompt_data[`Character ${i} coordinates`]) {

                if (!extension_settings[extensionName].AI_use_coords == "true") {
                    prompt_data[`Character ${i} coordinates`] = {}

                }

            }


            if (prompt_data[`Character ${i} Prompt`]) {

                other_prompt = other_prompt + ", " + prompt_data[`Character ${i} Prompt`]

            }
        }

    } else {
        addLog("标准模式: 使用请求中的 prompt。");
        mainPrompt = deduplicateTags(promptForGeneration);
    }


    console.log("11111111" + JSON.stringify(prompt_data[`Character 1 coordinates`]))

    // 应用新的复杂提示词替换规则
    let { modifiedPrompt, insertions } = await prompt_replace(mainPrompt, other_prompt);

    if (Divide_roles && extension_settings[extensionName].client == "jiuguan") {
        for (let i = 1; i <= 4; i++) {
            if (prompt_data[`Character ${i} Prompt`]) {

                modifiedPrompt = modifiedPrompt + " | " + prompt_replace_for_character(prompt_data[`Character ${i} Prompt`], (mainPrompt || '') + ' ' + (other_prompt || ''))

            }
        }

    }

    // 使用新的 zhengmian 函数组合所有部分
    const _nai_yushe_id = getRandomYusheId('yusheid_novelai');
    prompt = await zhengmian(
        extension_settings[extensionName].yushe[_nai_yushe_id].fixedPrompt,
        modifiedPrompt,
        extension_settings[extensionName].yushe[_nai_yushe_id].fixedPrompt_end,
        aqt,
        insertions
    );

    if (extension_settings[extensionName].addFurryDataset == "true") {
        prompt = "fur dataset, " + prompt;
        addLog("添加了 'fur dataset' 到提示词。");
    }

    // ... (UCP_novelai logic remains the same)
    let UCP_novelai = "";
    addLog(`正在根据模型 (${extension_settings[extensionName].novelaimode}) 和 UCP 预设 (${extension_settings[extensionName].UCP_novelai}) 选择负面提示词...`);

    if (extension_settings[extensionName].novelaimode == "nai-diffusion-3" && extension_settings[extensionName].UCP_novelai == 'Heavy') {

        UCP_novelai = "lowres, {bad}, error, fewer, extra, missing, worst quality, jpeg artifacts, bad quality, watermark, unfinished, displeasing, chromatic aberration, signature, extra digits, artistic error, username, scan, [abstract]"

    }

    if (extension_settings[extensionName].novelaimode == "nai-diffusion-3" && extension_settings[extensionName].UCP_novelai == 'Light') {

        UCP_novelai = "lowres, jpeg artifacts, worst quality, watermark, blurry, very displeasing"

    }
    if (extension_settings[extensionName].novelaimode == "nai-diffusion-3" && extension_settings[extensionName].UCP_novelai == 'Human Focus') {

        UCP_novelai = "lowres, {bad}, error, fewer, extra, missing, worst quality, jpeg artifacts, bad quality, watermark, unfinished, displeasing, chromatic aberration, signature, extra digits, artistic error, username, scan, [abstract], bad anatomy, bad hands, @_@, mismatched pupils, heart-shaped pupils, glowing eyes"

    }
    if (extension_settings[extensionName].novelaimode == "nai-diffusion-4-full" && extension_settings[extensionName].UCP_novelai == 'Human Focus') {


    }
    if (extension_settings[extensionName].novelaimode == "nai-diffusion-4-full" && extension_settings[extensionName].UCP_novelai == 'Heavy') {

        UCP_novelai = "blurry, lowres, error, film grain, scan artifacts, worst quality, bad quality, jpeg artifacts, very displeasing, chromatic aberration, multiple views, logo, too many watermarks, white blank page, blank page"

    }
    if (extension_settings[extensionName].novelaimode == "nai-diffusion-4-full" && extension_settings[extensionName].UCP_novelai == 'Light') {


        UCP_novelai = "blurry, lowres, error, worst quality, bad quality, jpeg artifacts, very displeasing, white blank page, blank page"


    }
    if (extension_settings[extensionName].novelaimode == "nai-diffusion-4-curated-preview" && extension_settings[extensionName].UCP_novelai == 'Human Focus') {




    }
    if (extension_settings[extensionName].novelaimode == "nai-diffusion-4-curated-preview" && extension_settings[extensionName].UCP_novelai == 'Heavy') {

        UCP_novelai = "blurry, lowres, error, film grain, scan artifacts, worst quality, bad quality, jpeg artifacts, very displeasing, chromatic aberration, logo, dated, signature, multiple views, gigantic breasts, white blank page, blank page"


    }
    if (extension_settings[extensionName].novelaimode == "nai-diffusion-4-curated-preview" && extension_settings[extensionName].UCP_novelai == 'Light') {

        UCP_novelai = "blurry, lowres, error, worst quality, bad quality, jpeg artifacts, very displeasing, logo, dated, signature, white blank page, blank page"

    }
    if (extension_settings[extensionName].novelaimode == "nai-diffusion-4-5-curated" && extension_settings[extensionName].UCP_novelai == 'Human Focus') {

        UCP_novelai = "blurry, lowres, upscaled, artistic error, film grain, scan artifacts, bad anatomy, bad hands, worst quality, bad quality, jpeg artifacts, very displeasing, chromatic aberration, halftone, multiple views, logo, too many watermarks, @_@, mismatched pupils, glowing eyes, negative space, blank page"

    }
    if (extension_settings[extensionName].novelaimode == "nai-diffusion-4-5-curated" && extension_settings[extensionName].UCP_novelai == 'Heavy') {

        UCP_novelai = "blurry, lowres, upscaled, artistic error, film grain, scan artifacts, worst quality, bad quality, jpeg artifacts, very displeasing, chromatic aberration, halftone, multiple views, logo, too many watermarks, negative space, blank page"

    }
    if (extension_settings[extensionName].novelaimode == "nai-diffusion-4-5-curated" && extension_settings[extensionName].UCP_novelai == 'Light') {

        UCP_novelai = "blurry, lowres, upscaled, artistic error, film grain, scan artifacts, worst quality, bad quality, jpeg artifacts, very displeasing, chromatic aberration, halftone, multiple views, logo, too many watermarks, negative space, blank page"


    }
    if (extension_settings[extensionName].novelaimode == "nai-diffusion-4-5-full" && extension_settings[extensionName].UCP_novelai == 'Human Focus') {

        UCP_novelai = "lowres, artistic error, film grain, scan artifacts, worst quality, bad quality, jpeg artifacts, very displeasing, chromatic aberration, dithering, halftone, screentone, multiple views, logo, too many watermarks, negative space, blank page, @_@, mismatched pupils, glowing eyes, bad anatomy"


    }
    if (extension_settings[extensionName].novelaimode == "nai-diffusion-4-5-full" && extension_settings[extensionName].UCP_novelai == 'Heavy') {

        UCP_novelai = "lowres, artistic error, film grain, scan artifacts, worst quality, bad quality, jpeg artifacts, very displeasing, chromatic aberration, dithering, halftone, screentone, multiple views, logo, too many watermarks, negative space, blank page"

    }
    if (extension_settings[extensionName].novelaimode == "nai-diffusion-4-5-full" && extension_settings[extensionName].UCP_novelai == 'Light') {

        UCP_novelai = "lowres, artistic error, scan artifacts, worst quality, bad quality, jpeg artifacts, multiple views, very displeasing, too many watermarks, negative space, blank page"

    }

    if (extension_settings[extensionName].novelaimode == "nai-diffusion-4-5-full" && extension_settings[extensionName].UCP_novelai == 'Furry Focus') {

        UCP_novelai = "{worst quality}, distracting watermark, unfinished, bad quality, {widescreen}, upscale, {sequence}, {{grandfathered content}}, blurred foreground, chromatic aberration, sketch, everyone, [sketch background], simple, [flat colors], ych (character), outline, multiple scenes, [[horror (theme)]], comic"

    }
    let negative_prompt = await fumian(extension_settings[extensionName].yushe[_nai_yushe_id].negativePrompt, UCP_novelai);

    // 合并角色负面提示词（非分角色模式）
    if (!Divide_roles && window.collectedCharacterNegatives) {
        const characterNegatives = window.collectedCharacterNegatives.trim();
        if (characterNegatives) {
            negative_prompt = negative_prompt ? `${negative_prompt}, ${characterNegatives}` : characterNegatives;
            addLog(`[角色负面] 添加角色负面提示词: ${characterNegatives}`);
            console.log('[NovelAI] 合并角色负面提示词:', characterNegatives);
        }
    }

    // 合并智绘姬传入的额外负面提示词
    if (extraNegativePrompt && extraNegativePrompt.trim()) {
        const trimmedExtra = extraNegativePrompt.trim();
        negative_prompt = negative_prompt ? `${negative_prompt}, ${trimmedExtra}` : trimmedExtra;
        addLog(`[智绘姬] 添加额外负面提示词: ${trimmedExtra}`);
        console.log('[NovelAI] 合并智绘姬额外负面提示词:', trimmedExtra);
    }

    let use_coords = !extension_settings[extensionName].AI_use_coords == "true";

    // ... (preset_data logic remains mostly the same, using link, Xwidth, Xheight)
    let preset_data = {
        "params_version": 3,
        "width": Number(Xwidth ? Xwidth : extension_settings[extensionName].novelai_width),
        "height": Number(Xheight ? Xheight : extension_settings[extensionName].novelai_height),
        "scale": Number(extension_settings[extensionName].nai3Scale), //提示词关联性
        "sampler": extension_settings[extensionName].novelai_sampler, //"k_euler",//使用的采样器   "k_dpm_2"   "k_dpmpp_2m"    "ddim_v3"  "k_dpmpp_2s_ancestral"
        "steps": Number(extension_settings[extensionName].novelai_steps), //生成的步数
        "n_samples": 1,
        "ucPreset": 3, //预设
        "qualityToggle": true,
        "sm": extension_settings[extensionName].sm === "false" ? false : true,
        "sm_dyn": extension_settings[extensionName].dyn === "false" || extension_settings[extensionName].sm === "false" ? false : true,
        "dynamic_thresholding": extension_settings[extensionName].nai3Deceisp === "false" ? false : true,
        "controlnet_strength": 1,
        "legacy": false,
        "legacy_uc": false,
        "add_original_image": true,
        "cfg_rescale": Number(extension_settings[extensionName].cfg_rescale), //关联性调整
        "noise_schedule": extension_settings[extensionName].Schedule,
        "skip_cfg_above_sigma": extension_settings[extensionName].nai3Variety === "false" ? null : 19,
        "legacy_v3_extend": false,
        "stream": "msgpack",
        "seed": extension_settings[extensionName].novelai_seed === "0" || extension_settings[extensionName].novelai_seed === "" || extension_settings[extensionName].novelai_seed === "-1" ? generateRandomSeed() : Number(extension_settings[extensionName].novelai_seed), //生成的种子，下面是固定的负面提示词
        "negative_prompt": negative_prompt,
        "reference_image_multiple": [],
        "reference_information_extracted_multiple": [],
        "reference_strength_multiple": [],
        "reference_image_multiple_cached": [],
        "normalize_reference_strength_multiple": extension_settings[extensionName].normalizeRefStrength === "true",
        "use_coords": use_coords
    }


    if (extension_settings[extensionName].novelaimode !== "nai-diffusion-3") {

        if (Divide_roles) {
            for (let i = 1; i <= 4; i++) {
                if (prompt_data[`Character ${i} Prompt`]) {
                    prompt_data[`Character ${i} Prompt`] = await prompt_replace_for_character(prompt_data[`Character ${i} Prompt`], (mainPrompt || '') + ' ' + (other_prompt || ''));
                }
            }
            let characterPrompts = [];
            for (let i = 1; i <= 4; i++) {
                if (prompt_data[`Character ${i} Prompt`]) {
                    characterPrompts[i - 1] = { enabled: true, prompt: prompt_data[`Character ${i} Prompt`], center: prompt_data[`Character ${i} coordinates`], uc: prompt_data[`Character ${i} UC`] ? prompt_data[`Character ${i} UC`] : 'one arms,lowres, aliasing, jaggy lines,bad hands,one legs' };
                }
            }
            let v4_negative_prompt = { caption: { base_caption: negative_prompt, char_captions: [] }, legacy_uc: false };
            for (let i = 1; i <= 4; i++) {
                if (prompt_data[`Character ${i} Prompt`]) {
                    v4_negative_prompt.caption.char_captions.push({ char_caption: prompt_data[`Character ${i} UC`] ? prompt_data[`Character ${i} UC`] : 'one arms,lowres, aliasing, jaggy lines,bad hands,one legs', centers: [prompt_data[`Character ${i} coordinates`]] });
                }
            }
            let v4_prompt = { caption: { base_caption: prompt, char_captions: [] }, use_coords: use_coords, use_order: true };
            for (let i = 1; i <= 4; i++) {
                if (prompt_data[`Character ${i} Prompt`]) {
                    v4_prompt.caption.char_captions.push({ char_caption: prompt_data[`Character ${i} Prompt`], centers: [prompt_data[`Character ${i} coordinates`]] });
                }
            }
            preset_data = { ...preset_data, characterPrompts, v4_prompt, v4_negative_prompt, add_original_image: true, skip_cfg_above_sigma: extension_settings[extensionName].nai3Variety === "false" ? null : 19.343056794463642 };
            if (extension_settings[extensionName].nai3Variety != "false" && extension_settings[extensionName].novelaimode == "nai-diffusion-4-full") {
                preset_data["skip_cfg_above_sigma"] = 19;
            }
            if (extension_settings[extensionName].nai3Variety != "false" && ((extension_settings[extensionName].novelaimode == "nai-diffusion-4-5-curated") || (extension_settings[extensionName].novelaimode == "nai-diffusion-4-5-full"))) {
                preset_data["skip_cfg_above_sigma"] = 59.04722600415217;
            }
            preset_data = {
                "autoSmea": false,
                "normalize_reference_strength_multiple": extension_settings[extensionName].normalizeRefStrength === "true",
                "inpaintImg2ImgStrength": 1,
                "params_version": 3,
                "width": Number(Xwidth ? Xwidth : extension_settings[extensionName].novelai_width),
                "height": Number(Xheight ? Xheight : extension_settings[extensionName].novelai_height),
                "scale": Number(extension_settings[extensionName].nai3Scale), //提示词关联性
                "sampler": extension_settings[extensionName].novelai_sampler, //"k_euler",//使用的采样器   "k_dpm_2"   "k_dpmpp_2m"    "ddim_v3"  "k_dpmpp_2s_ancestral"
                "steps": Number(extension_settings[extensionName].novelai_steps), //生成的步数
                "n_samples": 1,
                "ucPreset": 3, //预设
                "qualityToggle": true,
                "dynamic_thresholding": false,
                "controlnet_strength": 1,
                "legacy": false,
                "legacy_uc": false,
                "add_original_image": true,
                "cfg_rescale": Number(extension_settings[extensionName].cfg_rescale), //关联性调整
                "noise_schedule": extension_settings[extensionName].Schedule,
                "skip_cfg_above_sigma": extension_settings[extensionName].nai3Variety === "false" ? null : 19.343056794463642,
                "legacy_v3_extend": false,
                "seed": extension_settings[extensionName].novelai_seed === "0" || extension_settings[extensionName].novelai_seed === "" || extension_settings[extensionName].novelai_seed === "-1" ? generateRandomSeed() : Number(extension_settings[extensionName].novelai_seed), //生成的种子，下面是固定的负面提示词
                "negative_prompt": negative_prompt,
                "reference_image_multiple": [],
                "reference_information_extracted_multiple": [],
                "reference_strength_multiple": [],
                "reference_image_multiple_cached": [],
                "use_coords": use_coords,
                "stream": "msgpack",
                "characterPrompts": characterPrompts,
                "v4_prompt": v4_prompt,
                "v4_negative_prompt": v4_negative_prompt
            }
        } else {
            preset_data = {
                "autoSmea": false,
                "normalize_reference_strength_multiple": extension_settings[extensionName].normalizeRefStrength === "true",
                "inpaintImg2ImgStrength": 1,
                "params_version": 3,
                "width": Number(Xwidth ? Xwidth : extension_settings[extensionName].novelai_width),
                "height": Number(Xheight ? Xheight : extension_settings[extensionName].novelai_height),
                "scale": Number(extension_settings[extensionName].nai3Scale), //提示词关联性
                "sampler": extension_settings[extensionName].novelai_sampler, //"k_euler",//使用的采样器   "k_dpm_2"   "k_dpmpp_2m"    "ddim_v3"  "k_dpmpp_2s_ancestral"
                "steps": Number(extension_settings[extensionName].novelai_steps), //生成的步数
                "n_samples": 1,
                "ucPreset": 3, //预设
                "qualityToggle": false,
                "dynamic_thresholding": false,
                "controlnet_strength": 1,
                "legacy": false,
                "legacy_uc": false,
                "add_original_image": true,
                "cfg_rescale": Number(extension_settings[extensionName].cfg_rescale), //关联性调整
                "noise_schedule": extension_settings[extensionName].Schedule,
                "skip_cfg_above_sigma": extension_settings[extensionName].nai3Variety === "false" ? null : 19.343056794463642,
                "legacy_v3_extend": false,
                "seed": extension_settings[extensionName].novelai_seed === "0" || extension_settings[extensionName].novelai_seed === "" || extension_settings[extensionName].novelai_seed === "-1" ? generateRandomSeed() : Number(extension_settings[extensionName].novelai_seed), //生成的种子，下面是固定的负面提示词
                "negative_prompt": negative_prompt,
                "reference_image_multiple": [],
                "reference_information_extracted_multiple": [],
                "reference_strength_multiple": [],
                "reference_image_multiple_cached": [],
                "use_coords": use_coords,
                "characterPrompts": [],
                "stream": "msgpack",
                "v4_prompt": {
                    "caption": {
                        "base_caption": prompt,
                        "char_captions": []
                    },
                    "use_coords": use_coords,
                    "use_order": true
                },
                "v4_negative_prompt": {
                    "caption": {
                        "base_caption": negative_prompt,
                        "char_captions": []
                    },
                    legacy_uc: false
                }
            }
        }

    }
    // ... (rest of preset_data modifications)
    if (extension_settings[extensionName].novelai_sampler == "k_euler_ancestral") {
        preset_data["deliberate_euler_ancestral_bug"] = false;
        preset_data["prefer_brownian"] = true;
    }
    if (extension_settings[extensionName].nai3Variety != "false") {
        preset_data["skip_cfg_above_sigma"] = calculateSkipCfgAboveSigma(preset_data.width, preset_data.height, extension_settings[extensionName].novelaimode)
    }

    // Character Reference Logic - Check compatibility before applying
    // Character Reference takes priority over Vibe Transfer
    const isNAI3 = extension_settings[extensionName].novelaimode === "nai-diffusion-3";
    const isNAI45 = ["nai-diffusion-4-5-full", "nai-diffusion-4-5-curated"]
        .includes(extension_settings[extensionName].novelaimode);
    const isNAI4or45 = ["nai-diffusion-4-full", "nai-diffusion-4-curated-preview",
        "nai-diffusion-4-5-full", "nai-diffusion-4-5-curated"]
        .includes(extension_settings[extensionName].novelaimode);
    const isBrowserClient = extension_settings[extensionName].client !== "jiuguan";

    if (extension_settings[extensionName].nai3CharRef === "true" &&
        isNAI45 && isBrowserClient) {
        // Use Character Reference (NAI4.5 + Browser only)
        try {
            await applyCharacterReferenceGroup(preset_data);
        } catch (error) {
            console.error('[CharRef] Unexpected error in Character Reference:', error);
            addLog(`[CharRef] 错误: 角色参考应用失败: ${error.message}`);
            toastr.error('角色参考应用失败，将继续进行图像生成', '角色参考');
        }
    } else if (extension_settings[extensionName].nai3CharRef === "true") {
        // Log why Character Reference was skipped
        if (!isNAI45) {
            addLog('[CharRef] 跳过: 当前模型不支持角色参考 (仅支持 NAI4.5)');
            console.warn('[CharRef] Skipped: Current model does not support Character Reference (NAI4.5 only)');
        }
        if (!isBrowserClient) {
            addLog('[CharRef] 跳过: 酒馆端不支持角色参考');
            console.warn('[CharRef] Skipped: Tavern client does not support Character Reference');
        }
    } else if (extension_settings[extensionName].enableVibeGroupTransfer === "true" &&
        isNAI4or45 && isBrowserClient) {
        // Use Vibe Group Transfer (only if Character Reference is not enabled)
        try {
            await applyVibeGroupTransfer(preset_data);
        } catch (error) {
            // Catch any unexpected errors to prevent generation from failing
            console.error('[VibeGroup] Unexpected error in Vibe Group Transfer:', error);
            addLog(`[VibeGroup] 错误: Vibe 组氛围转移失败: ${error.message}`);
            toastr.error('Vibe 组氛围转移失败，将继续进行图像生成', 'Vibe 组氛围转移');
            // Continue with generation even if Vibe Transfer fails
        }
    } else if (extension_settings[extensionName].enableVibeGroupTransfer === "true") {
        // Log why Vibe Group Transfer was skipped
        if (!isNAI4or45) {
            addLog('[VibeGroup] 跳过: 当前模型不支持 Vibe 组氛围转移 (仅支持 NAI4/4.5)');
            console.warn('[VibeGroup] Skipped: Current model does not support Vibe Group Transfer (NAI4/4.5 only)');
        }
        if (!isBrowserClient) {
            addLog('[VibeGroup] 跳过: 酒馆端不支持 Vibe 组氛围转移');
            console.warn('[VibeGroup] Skipped: Tavern client does not support Vibe Group Transfer');
        }
    } else if (extension_settings[extensionName].nai3VibeTransfer === "true" && isNAI3) {
        // Priority 3: Single Vibe Transfer (NAI3 only)
        try {
            await applySingleVibeTransfer(preset_data);
        } catch (error) {
            console.error('[SingleVibe] Unexpected error in Single Vibe Transfer:', error);
            addLog(`[SingleVibe] 错误: 单个 Vibe 转移失败: ${error.message}`);
            toastr.error('Vibe 转移失败，将继续进行图像生成', 'Vibe 转移');
        }
    } else if (extension_settings[extensionName].nai3VibeTransfer === "true") {
        // Log why Single Vibe Transfer was skipped
        if (!isNAI3) {
            addLog('[SingleVibe] 跳过: 当前模型不支持单个 Vibe 转移 (仅支持 NAI3)');
            console.warn('[SingleVibe] Skipped: Current model does not support Single Vibe Transfer (NAI3 only)');
        }
    }
    // If all are false, no reference transfer is applied

    // Clean and validate payload before sending
    addLog('[Payload] 开始清理和验证 payload...');

    // Clean the payload to remove model-inappropriate arrays
    preset_data = cleanNovelAIPayload(preset_data, extension_settings[extensionName].novelaimode);

    // Validate the payload
    try {
        validateNovelAIPayload(preset_data, extension_settings[extensionName].novelaimode);
    } catch (validationError) {
        addLog(`[验证失败] ${validationError.message}`);
        toastr.error(`Payload 验证失败: ${validationError.message}`, 'NovelAI 生成错误');
        taskQueue.completeTask(taskId, false);
        currentTaskId = null;
        throw validationError;
    }

    const payload = preset_data;
    const loggablePayload = createLoggableNovelAIPayload(payload);
    if (extension_settings[extensionName].client != "jiuguan") {
        addLog(`最终生图参数 (payload): ${JSON.stringify(loggablePayload, null, 2)}`);

    }
    // let urlObj = new URL("https://image.novelai.net/ai/generate-image-stream");
    let urlObj = new URL("https://image.novelai.net/ai/generate-image");
    if (extension_settings[extensionName].novelaisite != "官网") {
        if (extension_settings[extensionName].client == "jiuguan") {
            taskQueue.completeTask(taskId, false);
            currentTaskId = null;
            throw new Error("酒馆端不支持自定义站点！");
        }
        let otherSite = normalizeNovelAIOtherSiteUrl(extension_settings[extensionName].novelaiOtherSite);
        if (!otherSite) {
            taskQueue.completeTask(taskId, false);
            currentTaskId = null;
            throw new Error('已选择第三方站点，但未填写 novelaiOtherSite 地址');
        }
        urlObj = otherSite.includes("generate-image") ? new URL(otherSite) : new URL(`${otherSite}/ai/generate-image`);
    }

    // The core fetch logic
    try {
        let re = "";
        if (extension_settings[extensionName].client == "jiuguan") {
            // ... tavern client logic
            while (!window.xiancheng) {
                // 检查任务是否被取消
                if (!taskQueue.isTaskInQueue(taskId)) {
                    addLog('任务已被用户取消');
                    throw new Error('任务已取消');
                }
                await sleep(1000);
            }
            window.xiancheng = false;

            // 云端队列等待（如果启用）
            if (extension_settings[extensionName].enableCloudQueue === 'true') {
                const keyHash = await hashKey(access_token);
                const userId = getUserId();
                try {
                    addLog('[云端队列] 开始等待...');
                    const result = await waitForTurn(keyHash, userId, taskId, taskQueue);
                    currentCloudQueueInfo = { keyHash, userId, taskId, lockToken: result.lockToken };
                    addLog('[云端队列] 已获得锁，等待1秒后开始生成');
                    await sleep(1000); // 等待1秒，防止NovelAI服务器反应不够快
                } catch (error) {
                    currentCloudQueueInfo = null;
                    throw error;
                }
            }

            taskQueue.updateStatus(taskId, 'running');
            const read = await fetch('/api/secrets/read', {
                method: 'POST',
                headers: getRequestHeaders(window.token),
                body: JSON.stringify({})
            });


            if (read.ok) {

                if (extension_settings[extensionName].novelaiApi_id != "") {

                    const read = await fetch('/api/secrets/delete', {
                        method: 'POST',
                        headers: getRequestHeaders(window.token),
                        body: JSON.stringify({ id: extension_settings[extensionName].novelaiApi_id, key: "api_key_novel" })

                    });
                }

                let id = "";

                const re = await fetch('/api/secrets/write', {
                    method: 'POST',
                    headers: getRequestHeaders(window.token),
                    body: JSON.stringify({ key: "api_key_novel", value: extension_settings[extensionName].novelaiApi, label: "插件设置的api_key_novel" })
                });

                if (!re.ok) {
                    const errorText = await re.text();
                    throw new Error(`Failed to write secret: ${errorText}`);
                }

                const responseText = await re.text();
                try {
                    const novelid = JSON.parse(responseText);
                    if (novelid && novelid.id) {
                        extension_settings[extensionName].novelaiApi_id = novelid.id;
                        saveSettingsDebounced();
                        await fetch('/api/secrets/rotate', {
                            method: 'POST',
                            headers: getRequestHeaders(window.token),
                            body: JSON.stringify({ id: novelid.id, key: "api_key_novel" })
                        });
                    }
                } catch (e) {
                    addLog(`Could not parse JSON from /api/secrets/write. Response was: "${responseText}". Continuing without rotating key.`);
                    console.warn(`Could not parse JSON from /api/secrets/write. Response was: "${responseText}". Continuing without rotating key.`);
                }
            }
            const tavernAIPayload = { prompt: prompt, model: extension_settings[extensionName].novelaimode, sampler: preset_data.sampler, scheduler: preset_data.noise_schedule, steps: preset_data.steps, scale: preset_data.scale, width: preset_data.width, height: preset_data.height, negative_prompt: preset_data.negative_prompt, decrisper: preset_data.dynamic_thresholding, variety_boost: preset_data.skip_cfg_above_sigma, sm: preset_data.sm, sm_dyn: preset_data.sm_dyn, seed: preset_data.seed };


            addLog(`最终生图参数 (payload): ${JSON.stringify(tavernAIPayload, null, 2)}`);

            const result = await fetch('/api/novelai/generate-image', { method: 'POST', headers: getRequestHeaders(window.token), body: JSON.stringify(tavernAIPayload), signal: currentAbortController?.signal });
            // 先释放云端锁，再释放本地锁
            if (currentCloudQueueInfo) {
                await completeQueue(currentCloudQueueInfo.keyHash, currentCloudQueueInfo.userId, currentCloudQueueInfo.taskId, currentCloudQueueInfo.lockToken);
                currentCloudQueueInfo = null;
            }
            setTimeout(() => {
                console.log('xiancheng 为true');
                window.xiancheng = true
            }, extension_settings[extensionName].imageGenInterval);;
            if (!result.ok) {
                const text = await result.text();
                throw new Error(`生成图片失败，详情查看酒馆控制台: ${text}`);
            }
            let data = await result.text();


            try {
                // First, try to parse as JSON, which is the expected format.
                const jsonResponse = JSON.parse(data);
                re = jsonResponse.images[0];
            } catch (e) {
                // If parsing fails, assume the response is the raw base64 data.
                addLog('JSON 解析失败，尝试作为原始 Base64 数据处理。');
                re = data;
            }
        } else {

            let data11 = ""
            let Authorization = "Bearer " + access_token;


            let recaptcha_token = "";


            data11 = { "input": prompt, "model": extension_settings[extensionName].novelaimode, "action": "generate", "parameters": payload, "use_new_shared_trial": true };


            if (recaptcha_token) {


                data11 = { "input": prompt, "model": extension_settings[extensionName].novelaimode, "action": "generate", "parameters": payload, "recaptcha_token": recaptcha_token.token, "use_new_shared_trial": true };


                Authorization = "Bearer " + recaptcha_token.token;
            }


            console.log("data11:", data11);
            let abc = true;
            while (!window.xiancheng) {
                // 检查任务是否被取消
                if (!taskQueue.isTaskInQueue(taskId)) {
                    addLog('任务已被用户取消');
                    throw new Error('任务已取消');
                }
                await sleep(1000);
            };
            window.xiancheng = false;

            // 云端队列等待（如果启用）
            if (extension_settings[extensionName].enableCloudQueue === 'true') {
                const keyHash = await hashKey(access_token);
                const userId = getUserId();
                try {
                    addLog('[云端队列] 开始等待...');
                    const result = await waitForTurn(keyHash, userId, taskId, taskQueue);
                    currentCloudQueueInfo = { keyHash, userId, taskId, lockToken: result.lockToken };
                    addLog('[云端队列] 已获得锁，等待1秒后开始生成');
                    await sleep(1000); // 等待1秒，防止NovelAI服务器反应不够快
                } catch (error) {
                    currentCloudQueueInfo = null;
                    throw error;
                }
            }

            taskQueue.updateStatus(taskId, 'running');

            let response;
            try {
                response = await fetch(urlObj, { method: "POST", headers: getDirectHeaders('application/json', Authorization), body: JSON.stringify(data11), signal: currentAbortController?.signal });
            } catch (networkError) {
                addLog(`请求遇到网络错误: ${networkError.message}。将在1秒后重试...`);
                await sleep(1000);
                try {
                    response = await fetch(urlObj, { method: "POST", headers: getDirectHeaders('application/json', Authorization), body: JSON.stringify(data11), signal: currentAbortController?.signal });
                } catch (finalError) {
                    // 网络错误时释放云端锁，再释放本地锁
                    if (currentCloudQueueInfo) {
                        await completeQueue(currentCloudQueueInfo.keyHash, currentCloudQueueInfo.userId, currentCloudQueueInfo.taskId, currentCloudQueueInfo.lockToken);
                        currentCloudQueueInfo = null;
                    }
                    setTimeout(() => {
                        console.log('xiancheng 为true');
                        window.xiancheng = true
                    }, extension_settings[extensionName].imageGenInterval);;
                    addLog(`重试失败: ${finalError.message}`);
                    throw finalError;
                }
            }

            // 请求完成后，先释放云端锁，再释放本地锁
            if (currentCloudQueueInfo) {
                await completeQueue(currentCloudQueueInfo.keyHash, currentCloudQueueInfo.userId, currentCloudQueueInfo.taskId, currentCloudQueueInfo.lockToken);
                currentCloudQueueInfo = null;
            }
            setTimeout(() => {
                console.log('xiancheng 为true');
                window.xiancheng = true
            }, extension_settings[extensionName].imageGenInterval);;
            if (!response.ok) {
                const mess = await response.text();
                let userFriendlyError = `请求失败, 状态码: ${response.status}, 错误信息: ${mess}`;

                // Parse and enhance error messages
                switch (response.status) {
                    case 400:
                        // Try to parse validation errors
                        try {
                            const errorJson = JSON.parse(mess);
                            if (errorJson.message) {
                                userFriendlyError = `请求验证失败: ${errorJson.message}`;
                                addLog(`[API 错误] 400 验证错误: ${errorJson.message}`);
                            }
                        } catch (e) {
                            // If not JSON, use the raw message
                            userFriendlyError = `请求验证失败: ${mess}`;
                            addLog(`[API 错误] 400 验证错误: ${mess}`);
                        }
                        break;
                    case 401:
                        userFriendlyError = "API Key 错误或无效，请检查 API Key。";
                        addLog('[API 错误] 401 认证失败');
                        break;
                    case 402:
                        userFriendlyError = "需要有效订阅才能访问此端点。";
                        addLog('[API 错误] 402 需要订阅');
                        break;
                    default:
                        addLog(`[API 错误] ${response.status}: ${mess}`);
                }
                throw new Error(userFriendlyError);
            }
            const data123 = await response.arrayBuffer();

            // const responseMsgpack = new Uint8Array(data123);
            // const decodedEvents = _parseMsgpackEvents(responseMsgpack);
            // const finalEvent = decodedEvents.find(event => event.eventType == "final");
            // if (finalEvent) {
            //     re = uint8ArrayToBase64(finalEvent.imageData);
            // }

            re = await unzipFile(data123);

        }
        if (!re) {
            throw new Error("未能从API响应中提取图像数据。");
        }
        let imageUrl = "data:image/png;base64," + re;
        addLog("图像已成功获取并格式化为 data URL。");

        taskQueue.completeTask(taskId, true);
        currentTaskId = null;
        currentAbortController = null;

        // 释放云端队列锁
        if (currentCloudQueueInfo) {
            await completeQueue(currentCloudQueueInfo.keyHash, currentCloudQueueInfo.userId, currentCloudQueueInfo.taskId, currentCloudQueueInfo.lockToken);
            currentCloudQueueInfo = null;
        }

        // Return the result instead of manipulating DOM


        if (String(extension_settings[extensionName].convertToJpegStorage) === "true") {

            imageUrl = await convertImageToJpeg(imageUrl);

        }
        return { image: imageUrl, change: change_ || '' };

    } catch (error) {
        // 释放云端队列锁
        if (currentCloudQueueInfo) {
            if (isAborted) {
                await leaveQueue(currentCloudQueueInfo.keyHash, currentCloudQueueInfo.userId, currentCloudQueueInfo.taskId, currentCloudQueueInfo.lockToken);
            } else {
                await completeQueue(currentCloudQueueInfo.keyHash, currentCloudQueueInfo.userId, currentCloudQueueInfo.taskId, currentCloudQueueInfo.lockToken);
            }
            currentCloudQueueInfo = null;
        }
        setTimeout(() => {
            console.log('xiancheng 为true');
            window.xiancheng = true
        }, extension_settings[extensionName].imageGenInterval);; // Ensure lock is released on error

        // 更新任务状态
        const isAborted = error.name === 'AbortError' || error.message === '任务已取消';
        if (isAborted) {
            // 用户取消的任务，状态已在 cancelTask 中更新
            addLog('NovelAI 请求已被用户取消');
        } else {
            taskQueue.completeTask(taskId, false);
        }
        currentTaskId = null;
        currentAbortController = null;



        // Re-throw the error to be caught by the event listener
        throw error;
    }
}





/**
 * NovelAI 局部重绘函数
 * 使用 Infill API 进行图像局部重绘
 */
async function generateNovelAIInpaint({ prompt: link, width: Xwidth, height: Xheight, change }) {
    clearLog();

    // --- 提取并剔除分辨率，应用到生成参数 ---
    const sizeRegex = /,?\s*(\d{2,4})x(\d{2,4})(?=[;\s]*$)/i;
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

    addLog('[NovelAI Inpaint] 开始局部重绘流程...');

    // 验证必需的重绘参数
    if (!window.novelaiInpaintImage) {
        const error = '缺少原始图像数据，请重新打开重绘对话框';
        addLog(`[NovelAI Inpaint] 错误: ${error}`);
        throw new Error(error);
    }
    if (!window.novelaiInpaintMask) {
        const error = '缺少遮罩数据，请重新打开重绘对话框';
        addLog(`[NovelAI Inpaint] 错误: ${error}`);
        throw new Error(error);
    }
    if (!window.novelaiInpaintPrompt) {
        const error = '缺少提示词，请在重绘对话框中输入提示词';
        addLog(`[NovelAI Inpaint] 错误: ${error}`);
        throw new Error(error);
    }

    // 注册任务到队列
    const taskId = taskQueue.addTask({
        name: '局部重绘: ' + (window.novelaiInpaintPrompt || '').substring(0, 20) + '...',
        type: TaskType.NOVELAI,
        prompt: window.novelaiInpaintPrompt
    });
    currentTaskId = taskId;

    // 创建新的 AbortController 用于取消请求
    currentAbortController = new AbortController();

    try {
        // 获取重绘参数
        const imageBase64 = window.novelaiInpaintImage.split(',')[1]; // 移除 data:image/png;base64, 前缀
        const maskBase64 = window.novelaiInpaintMask.split(',')[1];
        const inpaintPrompt = window.novelaiInpaintPrompt;
        const negativePrompt = window.novelaiInpaintNegativePrompt || 'blurry, lowres, bad quality';
        const strength = window.novelaiInpaintStrength || 0.54;

        addLog(`[NovelAI Inpaint] 提示词: ${inpaintPrompt}`);
        addLog(`[NovelAI Inpaint] 负面提示词: ${negativePrompt}`);
        addLog(`[NovelAI Inpaint] 强度: ${strength}`);

        // 检查 API Key
        const access_token = extension_settings[extensionName].novelaiApi;
        if (!access_token || access_token === '000000') {
            throw new Error('请填写 NovelAI API Key');
        }

        // 获取图像尺寸（优先使用 window 中存储的原始尺寸，确保是数字类型）
        const imgWidth = Number(window.novelaiInpaintWidth) || Number(Xwidth) || Number(extension_settings[extensionName].novelai_width) || 1024;
        const imgHeight = Number(window.novelaiInpaintHeight) || Number(Xheight) || Number(extension_settings[extensionName].novelai_height) || 1024;

        addLog(`[NovelAI Inpaint] 图像尺寸: ${imgWidth}x${imgHeight}`);

        // 生成随机种子
        const seed = extension_settings[extensionName].novelai_seed === "0" ||
            extension_settings[extensionName].novelai_seed === "" ||
            extension_settings[extensionName].novelai_seed === "-1"
            ? generateRandomSeed()
            : Number(extension_settings[extensionName].novelai_seed);

        // 构建 Infill API 请求参数
        const payload = {
            "action": "infill",
            "input": inpaintPrompt,
            "model": "nai-diffusion-4-5-curated-inpainting",
            "parameters": {
                "width": imgWidth,
                "height": imgHeight,
                "scale": Number(extension_settings[extensionName].nai3Scale) || 5,
                "sampler": extension_settings[extensionName].novelai_sampler || "k_euler_ancestral",
                "steps": Number(extension_settings[extensionName].novelai_steps) || 28,
                "seed": seed,
                "n_samples": 1,
                "image": imageBase64,
                "mask": maskBase64,
                "params_version": 3,
                "prefer_brownian": true,
                "autoSmea": false,
                "strength": 0.7,
                "noise": 0,
                "extra_noise_seed": seed,
                "add_original_image": false,
                "cfg_rescale": 0,//Number(extension_settings[extensionName].cfg_rescale) || 0,
                "controlnet_strength": 1,
                "deliberate_euler_ancestral_bug": false,
                "dynamic_thresholding": false,
                "legacy": false,
                "legacy_uc": false,
                "legacy_v3_extend": false,
                "normalize_reference_strength_multiple": extension_settings[extensionName].normalizeRefStrength === "true",
                "noise_schedule": extension_settings[extensionName].Schedule || "karras",
                "qualityToggle": true,
                "skip_cfg_above_sigma": 19,
                "ucPreset": 0,
                "use_coords": false,
                "image_format": "png",
                "img2img": {
                    "strength": strength,
                    "color_correct": true
                },
                "inpaintImg2ImgStrength": strength,
                "v4_prompt": {
                    "caption": {
                        "base_caption": inpaintPrompt,
                        "char_captions": []
                    },
                    "use_coords": false,
                    "use_order": true
                },
                "v4_negative_prompt": {
                    "caption": {
                        "base_caption": negativePrompt,
                        "char_captions": []
                    },
                    "use_coords": false,
                    "use_order": true
                }
            }
        };

        addLog(`[NovelAI Inpaint] 请求参数已构建完成`);

        // 等待队列
        while (!window.xiancheng) {
            if (!taskQueue.isTaskInQueue(taskId)) {
                addLog('[NovelAI Inpaint] 任务已被用户取消');
                throw new Error('任务已取消');
            }
            await sleep(1000);
        }
        window.xiancheng = false;

        // 云端队列等待（如果启用）
        if (extension_settings[extensionName].enableCloudQueue === 'true') {
            const keyHash = await hashKey(access_token);
            const userId = getUserId();
            try {
                addLog('[NovelAI Inpaint] [云端队列] 开始等待...');
                const result = await waitForTurn(keyHash, userId, taskId, taskQueue);
                currentCloudQueueInfo = { keyHash, userId, taskId, lockToken: result.lockToken };
                addLog('[NovelAI Inpaint] [云端队列] 已获得锁，等待1秒后开始生成');
                await sleep(1000);
            } catch (error) {
                currentCloudQueueInfo = null;
                throw error;
            }
        }

        taskQueue.updateStatus(taskId, 'running');

        // 发送请求（支持第三方站点）
        let urlObj = new URL("https://image.novelai.net/ai/generate-image");
        if (extension_settings[extensionName].novelaisite != "官网") {
            if (extension_settings[extensionName].client == "jiuguan") {
                throw new Error("酒馆端不支持自定义站点的局部重绘！");
            }
            const otherSite = normalizeNovelAIOtherSiteUrl(extension_settings[extensionName].novelaiOtherSite);
            if (!otherSite) {
                throw new Error('已选择第三方站点，但未填写 novelaiOtherSite 地址');
            }
            urlObj = otherSite.includes("generate-image")
                ? new URL(otherSite)
                : new URL(`${otherSite}/ai/generate-image`);
        }
        addLog(`[NovelAI Inpaint] 请求 URL: ${urlObj.toString()}`);
        const Authorization = "Bearer " + access_token;

        addLog('[NovelAI Inpaint] 正在发送请求到 NovelAI API...');

        let response;
        try {
            response = await fetch(urlObj, {
                method: "POST",
                headers: getDirectHeaders('application/json', Authorization),
                body: JSON.stringify(payload),
                signal: currentAbortController?.signal
            });
        } catch (networkError) {
            addLog(`[NovelAI Inpaint] 请求遇到网络错误: ${networkError.message}。将在1秒后重试...`);
            await sleep(1000);
            try {
                response = await fetch(urlObj, {
                    method: "POST",
                    headers: getDirectHeaders('application/json', Authorization),
                    body: JSON.stringify(payload),
                    signal: currentAbortController?.signal
                });
            } catch (finalError) {
                if (currentCloudQueueInfo) {
                    await completeQueue(currentCloudQueueInfo.keyHash, currentCloudQueueInfo.userId, currentCloudQueueInfo.taskId, currentCloudQueueInfo.lockToken);
                    currentCloudQueueInfo = null;
                }
                setTimeout(() => { window.xiancheng = true; }, extension_settings[extensionName].imageGenInterval);
                addLog(`[NovelAI Inpaint] 重试失败: ${finalError.message}`);
                throw finalError;
            }
        }

        // 释放云端锁
        if (currentCloudQueueInfo) {
            await completeQueue(currentCloudQueueInfo.keyHash, currentCloudQueueInfo.userId, currentCloudQueueInfo.taskId, currentCloudQueueInfo.lockToken);
            currentCloudQueueInfo = null;
        }
        setTimeout(() => { window.xiancheng = true; }, extension_settings[extensionName].imageGenInterval);

        // 检查响应状态
        if (!response.ok) {
            const errorText = await response.text();
            let userFriendlyError = `请求失败, 状态码: ${response.status}, 错误信息: ${errorText}`;
            switch (response.status) {
                case 401: userFriendlyError = "API Key 错误或无效，请检查 API Key。"; break;
                case 402: userFriendlyError = "需要有效订阅才能访问此端点。"; break;
            }
            throw new Error(userFriendlyError);
        }

        // 解压 ZIP 文件获取图像
        addLog('[NovelAI Inpaint] 正在解压返回的 ZIP 文件...');
        const arrayBuffer = await response.arrayBuffer();
        const imageBase64Result = await unzipFile(arrayBuffer);

        if (!imageBase64Result) {
            throw new Error("未能从API响应中提取图像数据");
        }

        let imageUrl = "data:image/png;base64," + imageBase64Result;
        addLog("[NovelAI Inpaint] 图像已成功获取并格式化为 data URL");

        // 清理 window 中的重绘参数
        delete window.novelaiInpaintImage;
        delete window.novelaiInpaintMask;
        delete window.novelaiInpaintPrompt;
        delete window.novelaiInpaintNegativePrompt;
        delete window.novelaiInpaintStrength;
        delete window.novelaiInpaintWidth;
        delete window.novelaiInpaintHeight;
        addLog('[NovelAI Inpaint] 已清理重绘参数');

        // 完成任务
        taskQueue.completeTask(taskId, true);
        currentTaskId = null;
        currentAbortController = null;

        // 转换为 JPEG（如果启用）
        if (String(extension_settings[extensionName].convertToJpegStorage) === "true") {
            imageUrl = await convertImageToJpeg(imageUrl);
        }

        addLog('[NovelAI Inpaint] 局部重绘完成！');
        return { image: imageUrl, change: change || '' };

    } catch (error) {
        // 释放云端队列锁
        if (currentCloudQueueInfo) {
            const isAborted = error.name === 'AbortError' || error.message === '任务已取消';
            if (isAborted) {
                await leaveQueue(currentCloudQueueInfo.keyHash, currentCloudQueueInfo.userId, currentCloudQueueInfo.taskId, currentCloudQueueInfo.lockToken);
            } else {
                await completeQueue(currentCloudQueueInfo.keyHash, currentCloudQueueInfo.userId, currentCloudQueueInfo.taskId, currentCloudQueueInfo.lockToken);
            }
            currentCloudQueueInfo = null;
        }
        setTimeout(() => { window.xiancheng = true; }, extension_settings[extensionName].imageGenInterval);

        // 更新任务状态
        const isAborted = error.name === 'AbortError' || error.message === '任务已取消';
        if (isAborted) {
            addLog('[NovelAI Inpaint] 请求已被用户取消');
        } else {
            taskQueue.completeTask(taskId, false);
        }
        currentTaskId = null;
        currentAbortController = null;

        // 清理 window 中的重绘参数
        delete window.novelaiInpaintImage;
        delete window.novelaiInpaintMask;
        delete window.novelaiInpaintPrompt;
        delete window.novelaiInpaintNegativePrompt;
        delete window.novelaiInpaintStrength;
        delete window.novelaiInpaintWidth;
        delete window.novelaiInpaintHeight;

        throw error;
    }
}

async function novelaigenerate(requestData) {

    const { id, prompt, width, height, change, negative_prompt: extraNegativePrompt } = requestData;
    addLog(`收到生图请求 (ID: ${id}) - Prompt: ${prompt}${change ? ` - Change: ${change}` : ''}${extraNegativePrompt ? ` - NegativePrompt: ${extraNegativePrompt}` : ''}`);

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
            try {
                if (extension_settings[extensionName].cache != "0") {
                    await setItemImg(prompt, imageUrl, { change: cleanedChange, isVideo, format });
                    addLog(`图像已存入数据库 for prompt: ${prompt}`);
                } else {
                    addLog(`缓存设置为不存入数据库`);
                }
            } catch (dbError) {
                addLog(`警告: 无法将图像存入缓存数据库 (ID: ${id}): ${dbError.message}`);
            }
            recordImageGeneration('novelai', true);
            eventSource.emit(EventType.GENERATE_IMAGE_RESPONSE, {
                id, success: true, imageData: imageUrl, prompt, change: cleanedChange,
                isVideo: isVideo || false, format: format || 'image',
            });
            addLog(`[ComfyUI转发] 发送ComfyUI局部重绘成功响应 (ID: ${id})`);
        } catch (error) {
            addLog(`[ComfyUI转发] 错误: ${error.message}`);
            recordImageGeneration('novelai', false);
            eventSource.emit(EventType.GENERATE_IMAGE_RESPONSE, { id, success: false, error: error.message, prompt });
        }
        return;
    }

    if (change && change.includes('{NovelAI局部重绘}')) {

        try {
            const { image: imageUrl, change: returnedChange } = await generateNovelAIInpaint({ prompt, width, height, change });
            const cleanedChange = returnedChange.replaceAll('{NovelAI局部重绘}', "")
            try {
                if (extension_settings[extensionName].cache != "0") {
                    await setItemImg(prompt, imageUrl, { change: cleanedChange });
                    addLog(`图像已存入数据库 for prompt: ${prompt}`);
                } else {
                    addLog(`缓存设置为不存入数据库`);
                }
            } catch (dbError) {
                const dbErrorMsg = `无法将图像存入缓存数据库 (ID: ${id}): ${dbError.message}`;
                addLog(`警告: ${dbErrorMsg}`);
                console.warn('Could not save image to DB cache:', dbError);
            }

            recordImageGeneration('novelai', true);
            eventSource.emit(EventType.GENERATE_IMAGE_RESPONSE, {
                id,
                success: true,
                imageData: imageUrl,
                prompt: prompt, // pass back the original prompt
                change: cleanedChange,
            });
            addLog(`发送生图成功响应 (ID: ${id})`);

        } catch (error) {
            const isAborted = error.name === 'AbortError' || error.message === '任务已取消';

            if (isAborted) {
                // 用户主动取消，发送取消响应
                addLog(`任务已取消 (ID: ${id})`);
                recordImageGeneration('novelai', false);
                eventSource.emit(EventType.GENERATE_IMAGE_RESPONSE, {
                    id,
                    success: false,
                    cancelled: true,
                    error: '任务已取消',
                    prompt: prompt,
                });
            } else {
                // 真正的错误
                const errorMsg = `生图流程捕获到异常 (ID: ${id}): ${error.message}`;
                addLog(`错误: ${errorMsg}`);
                console.error('Error generating image:', error);

                recordImageGeneration('novelai', false);
                eventSource.emit(EventType.GENERATE_IMAGE_RESPONSE, {
                    id,
                    success: false,
                    error: error.message,
                    prompt: prompt,
                });
                addLog(`发送生图失败响应 (ID: ${id})`);
            }
        }
        return;
    }

    try {
        const { image: imageUrl, change: returnedChange } = await generateNovelAIImage({ prompt, width, height, change, extraNegativePrompt });

        try {
            if (extension_settings[extensionName].cache != "0") {
                await setItemImg(prompt, imageUrl, { change: returnedChange });
                addLog(`图像已存入数据库 for prompt: ${prompt}`);
            } else {
                addLog(`缓存设置为不存入数据库`);
            }
        } catch (dbError) {
            const dbErrorMsg = `无法将图像存入缓存数据库 (ID: ${id}): ${dbError.message}`;
            addLog(`警告: ${dbErrorMsg}`);
            console.warn('Could not save image to DB cache:', dbError);
        }

        recordImageGeneration('novelai', true);
        eventSource.emit(EventType.GENERATE_IMAGE_RESPONSE, {
            id,
            success: true,
            imageData: imageUrl,
            prompt: prompt, // pass back the original prompt
            change: returnedChange,
        });
        addLog(`发送生图成功响应 (ID: ${id})`);

    } catch (error) {
        const isAborted = error.name === 'AbortError' || error.message === '任务已取消';

        if (isAborted) {
            // 用户主动取消，发送取消响应
            addLog(`任务已取消 (ID: ${id})`);
            recordImageGeneration('novelai', false);
            eventSource.emit(EventType.GENERATE_IMAGE_RESPONSE, {
                id,
                success: false,
                cancelled: true,
                error: '任务已取消',
                prompt: prompt,
            });
        } else {
            // 真正的错误
            const errorMsg = `生图流程捕获到异常 (ID: ${id}): ${error.message}`;
            addLog(`错误: ${errorMsg}`);
            console.error('Error generating image:', error);

            recordImageGeneration('novelai', false);
            eventSource.emit(EventType.GENERATE_IMAGE_RESPONSE, {
                id,
                success: false,
                error: error.message,
                prompt: prompt,
            });
            addLog(`发送生图失败响应 (ID: ${id})`);
        }
    }
}

function initializeNovelAIListener() {
    eventSource.on(EventType.GENERATE_IMAGE_REQUEST, novelaigenerate);

    // 监听 NovelAI 取消事件
    eventSource.on('st_chatu8_cancel_novelai_task', ({ taskId }) => {
        if (currentTaskId === taskId && currentAbortController) {
            addLog(`收到取消请求，正在中断 NovelAI 任务: ${taskId}`);
            currentAbortController.abort();
            currentAbortController = null;
            currentTaskId = null;
        }
    });

    addLog("NovelAI 生图事件监听器已初始化。");
}

export async function replaceWithnovelai() {
    if (extension_settings[extensionName].mode == "novelai") {
        if (!window.initializeNovelAIListener) {
            window.initializeNovelAIListener = true;
            initializeNovelAIListener();
        }
        initializeImageProcessing();
    } else {
        if (window.initializeNovelAIListener) {
            eventSource.removeListener(EventType.GENERATE_IMAGE_REQUEST, novelaigenerate)
            window.initializeNovelAIListener = false;
            addLog("NovelAI 生图事件监听器已关闭。");
        }
    }
}
