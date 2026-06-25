// @ts-nocheck
/**
 * NovelAI Vibe Transfer Generator
 * 
 * 生成官方兼容的 .naiv4vibe 文件，并支持预设管理
 */

import { extension_settings } from "../../../../../extensions.js";
import { saveSettingsDebounced } from "../../../../../../script.js";
import { extensionName } from '../config.js';
import { saveConfigImage, getConfigImage, deleteConfigImage, saveConfigText, getConfigText } from '../configDatabase.js';
import { getVibeStorageOptions } from './vibeStorageMigration.js';
import { processReferenceImage } from '../utils.js';

/**
 * 固定的 encoding key（与官方一致，所有 information_extracted=1 时通用）
 */
const FIXED_ENCODING_KEY = 'b36a8472fe418d9f80d6bb1c54e3a6e62c62936aa7bf31dae2bcf7e929f6430f';

function normalizeNovelAIOtherSiteUrl(value) {
    if (typeof value !== 'string') {
        return '';
    }
    return value.trim().replace(/\/+$/, '');
}

/**
 * SHA-256 哈希函数（兼容非安全上下文）
 */
async function sha256(message) {
    // 优先使用 crypto.subtle（在 HTTPS 或 localhost 下可用）
    if (typeof crypto !== 'undefined' && crypto.subtle) {
        try {
            const msgBuffer = new TextEncoder().encode(message);
            const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer);
            const hashArray = Array.from(new Uint8Array(hashBuffer));
            return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
        } catch (error) {
            console.warn('[Vibe] crypto.subtle 不可用，使用回退方案:', error);
        }
    }

    // 回退方案：使用简单但足够的哈希算法
    // 注意：这不是真正的 SHA-256，但对于生成唯一 ID 已经足够
    let hash = 0;
    for (let i = 0; i < message.length; i++) {
        const char = message.charCodeAt(i);
        hash = ((hash << 5) - hash) + char;
        hash = hash & hash; // Convert to 32bit integer
    }

    // 生成一个看起来像 SHA-256 的 64 字符十六进制字符串
    const timestamp = Date.now().toString(16);
    const random = Math.random().toString(16).substring(2);
    const hashHex = Math.abs(hash).toString(16).padStart(8, '0');

    // 组合成 64 字符的哈希值
    const combined = (timestamp + random + hashHex + message.substring(0, 20)).replace(/[^0-9a-f]/g, '0');
    return combined.padEnd(64, '0').substring(0, 64);
}

/**
 * Blob 转 Base64 (纯 base64，无前缀)
 */
const blobToBase64 = (blob) => new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(blob);
    reader.onload = () => resolve(reader.result.split(',')[1]);
    reader.onerror = error => reject(error);
});

/**
 * 大字符串安全的 Base64 编码
 */
function uint8ArrayToBase64(uint8Array) {
    let binary = '';
    const chunkSize = 8192;
    for (let i = 0; i < uint8Array.length; i += chunkSize) {
        const chunk = uint8Array.subarray(i, i + chunkSize);
        binary += String.fromCharCode.apply(null, chunk);
    }
    return btoa(binary);
}

function base64ToUint8Array(base64) {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
}

/**
 * 安全地将 JSON 字符串编码为 data URL
 */
function jsonToDataUrl(jsonString) {
    const encoder = new TextEncoder();
    const uint8Array = encoder.encode(jsonString);
    const base64 = uint8ArrayToBase64(uint8Array);
    return `data:application/json;base64,${base64}`;
}

/**
 * 安全地从 data URL 解码 JSON 字符串
 */
function dataUrlToJson(dataUrl) {
    const base64 = dataUrl.split(',')[1];
    const uint8Array = base64ToUint8Array(base64);
    const decoder = new TextDecoder();
    return decoder.decode(uint8Array);
}

/**
 * 生成缩略图 (最大边 256px，JPEG 格式，与官方一致)
 * @param {string} imageBase64 - 纯 base64 字符串（无前缀）
 * @param {string} format - 图片格式 ('png' 或 'jpeg')
 */
async function generateThumbnail(imageBase64, format = 'png') {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => {
            const maxDim = 256;
            const scale = maxDim / Math.max(img.width, img.height);
            const w = Math.floor(img.width * scale);
            const h = Math.floor(img.height * scale);

            const canvas = document.createElement('canvas');
            canvas.width = w;
            canvas.height = h;
            const ctx = canvas.getContext('2d');
            ctx.drawImage(img, 0, 0, w, h);

            const thumbnailDataUrl = canvas.toDataURL('image/jpeg', 0.8);
            resolve(thumbnailDataUrl);
        };
        img.onerror = reject;
        // 根据实际格式添加正确的 data URL 前缀
        const mimeType = format === 'jpeg' ? 'image/jpeg' : 'image/png';
        img.src = imageBase64.startsWith('data:') ? imageBase64 : `data:${mimeType};base64,${imageBase64}`;
    });
}

/**
 * 映射模型 ID 到 encodings JSON key（已通过官方文件确认）
 */
function getModelKey(modelName) {
    if (modelName.includes('4-5-curated')) return 'v4-5curated';
    if (modelName.includes('4-5-full')) return 'v4-5full';
    if (modelName.includes('4-curated')) return 'v4curated';
    if (modelName.includes('4-full')) return 'v4full';
    return modelName;
}

/**
 * 构建官方兼容的 Vibe JSON 结构（与官方 .naiv4vibe 格式完全一致）
 * @param {string} imageBase64 - 纯 base64 字符串（无前缀）
 * @param {string} vibeBase64 - vibe encoding 的 base64 字符串
 * @param {string} model - 模型名称
 * @param {number} extractVal - information_extracted 值
 * @param {number} strengthVal - strength 值
 * @param {string} format - 图片格式 ('png' 或 'jpeg')
 */
async function buildVibeJson(imageBase64, vibeBase64, model, extractVal, strengthVal, format = 'png') {
    const mainId = await sha256(imageBase64);
    const modelKey = getModelKey(model);
    const thumbnailDataUrl = await generateThumbnail(imageBase64, format);

    return {
        "identifier": "novelai-vibe-transfer",
        "version": 1,
        "type": "image",
        "image": imageBase64,
        "id": mainId,
        "encodings": {
            [modelKey]: {
                [FIXED_ENCODING_KEY]: {
                    "encoding": vibeBase64,
                    "params": {
                        "information_extracted": extractVal
                    }
                }
            }
        },
        "name": mainId.slice(0, 6) + '-' + mainId.slice(-6),
        "thumbnail": thumbnailDataUrl,
        "createdAt": Date.now(),
        "importInfo": {
            "model": model,
            "information_extracted": extractVal,
            "strength": strengthVal
        }
    };
}

/**
 * 确保 Vibe 预设存储对象存在
 */
function ensureVibePresets() {
    const settings = extension_settings[extensionName];
    if (!settings.vibePresets) {
        settings.vibePresets = {
            "默认": {
                model: "nai-diffusion-4-5-full",
                infoExtract: 1.0,
                strength: 0.6,
                imageId: null,
                vibeDataId: null
            }
        };
    }
    if (!settings.vibePresetId) {
        settings.vibePresetId = "默认";
    }
    return settings.vibePresets;
}

/**
 * 显示 Vibe 生成器对话框
 */
export function showVibeGeneratorDialog() {
    const parent = document.getElementById('st-chatu8-settings') || document.body;
    const settings = extension_settings[extensionName];
    ensureVibePresets();

    const backdrop = document.createElement('div');
    backdrop.className = 'st-chatu8-workflow-viz-backdrop';

    backdrop.innerHTML = `
        <div class="st-chatu8-workflow-viz-dialog st-chatu8-vibe-generator-dialog">
            <div class="st-chatu8-workflow-viz-header">
                <h3>Vibe 文件生成器 (.naiv4vibe)</h3>
                <span class="st-chatu8-workflow-viz-close">&times;</span>
            </div>
            <div class="st-chatu8-workflow-viz-body" style="padding: 2rem;">
                <div class="st-chatu8-vibe-generator-content">
                    <!-- 预设选择器 -->
                    <div class="st-chatu8-field" style="margin-bottom: 1.2rem;">
                        <label for="vibe-preset-select">氛围转移预设</label>
                        <div class="st-chatu8-profile-controls">
                            <select id="vibe-preset-select" class="st-chatu8-select"></select>
                            <button class="st-chatu8-icon-btn" id="vibe-preset-new" title="新建预设">
                                <i class="fa-solid fa-plus"></i>
                            </button>
                            <button class="st-chatu8-icon-btn" id="vibe-preset-save" title="保存当前预设">
                                <i class="fa-solid fa-save"></i>
                            </button>
                            <button class="st-chatu8-icon-btn" id="vibe-preset-export-current" title="导出当前预设">
                                <i class="fa-solid fa-upload"></i>
                            </button>
                            <button class="st-chatu8-icon-btn" id="vibe-preset-export-all" title="导出全部预设">
                                <i class="fa-solid fa-file-export"></i>
                            </button>
                            <button class="st-chatu8-icon-btn" id="vibe-preset-import" title="导入预设">
                                <i class="fa-solid fa-download"></i>
                            </button>
                            <button class="st-chatu8-icon-btn danger" id="vibe-preset-delete" title="删除当前预设">
                                <i class="fa-solid fa-trash"></i>
                            </button>
                        </div>
                    </div>

                    <!-- 图片预览 -->
                    <div class="st-chatu8-field-col" style="margin-bottom: 1.2rem;">
                        <label>参考图片预览</label>
                        <div class="st-chatu8-image-preview-container" id="vibe-image-preview-container">
                            <div class="st-chatu8-image-placeholder">
                                <i class="fa-solid fa-image"></i>
                                <span>没有选择图片</span>
                            </div>
                            <img id="vibe-preview-image" src="" alt="参考图预览" style="display: none;">
                        </div>
                        <div class="st-chatu8-image-controls" style="margin-top: 0.5rem;">
                            <input type="file" id="vibe-image-input" accept="image/png, image/jpeg, image/webp" style="display:none;">
                            <input type="file" id="vibe-file-input" accept=".naiv4vibe" style="display:none;">
                            <button type="button" class="st-chatu8-btn" id="vibe-select-image-btn">
                                <i class="fa-solid fa-upload"></i> 选择图片
                            </button>
                            <button type="button" class="st-chatu8-btn" id="vibe-upload-file-btn">
                                <i class="fa-solid fa-file-import"></i> 上传 Vibe 文件
                            </button>
                            <button type="button" class="st-chatu8-btn danger" id="vibe-remove-image-btn" style="display: none;">
                                <i class="fa-solid fa-trash"></i> 移除图片
                            </button>
                        </div>
                    </div>

                    <div class="st-chatu8-field" style="margin-bottom: 1.2rem;">
                        <label for="vibe-model-select">模型 (Model)</label>
                        <select id="vibe-model-select" class="st-chatu8-select">
                            <option value="nai-diffusion-4-5-full">V4.5 Full</option>
                            <option value="nai-diffusion-4-5-curated">V4.5 Curated</option>
                            <option value="nai-diffusion-4-full">V4 Full</option>
                            <option value="nai-diffusion-4-curated">V4 Curated</option>
                        </select>
                    </div>
                    
                    <div class="st-chatu8-field" style="margin-bottom: 1.5rem;">
                        <label for="vibe-strength-ref">默认参考强度: <span id="vibe-strength-val">0.6</span></label>
                        <div class="st-chatu8-range-container">
                            <input type="range" id="vibe-strength-ref" class="st-chatu8-range-slider" min="0" max="1" step="0.01" value="0.6">
                            <input type="number" id="vibe-strength-ref-num" class="st-chatu8-range-input" min="0" max="1" step="0.01" value="0.6">
                        </div>
                    </div>

                    <button type="button" class="st-chatu8-btn" id="vibe-submit-btn" style="width: 100%; padding: 1rem; font-size: 16px; font-weight: 600;">
                        <i class="fa-solid fa-wand-magic-sparkles"></i> 生成并保存到预设
                    </button>
                    
                    <button type="button" class="st-chatu8-btn" id="vibe-download-btn" style="width: 100%; padding: 1rem; font-size: 16px; font-weight: 600; margin-top: 0.5rem; background: #000; border: 1px solid #333;" title="请先生成或上传 Vibe 数据">
                        <i class="fa-solid fa-circle-exclamation"></i> 请先生成或上传 Vibe 数据
                    </button>
                    
                    <div id="vibe-status" style="margin-top: 1.5rem; padding: 1rem; border-radius: 6px; font-size: 0.9rem; display: none; line-height: 1.4;"></div>
                </div>
            </div>
        </div>
    `;

    parent.appendChild(backdrop);

    const closeBtn = backdrop.querySelector('.st-chatu8-workflow-viz-close');
    closeBtn.onclick = () => parent.removeChild(backdrop);
    backdrop.onclick = (e) => {
        if (e.target === backdrop) {
            parent.removeChild(backdrop);
        }
    };

    const presetSelect = document.getElementById('vibe-preset-select');
    const modelSelect = document.getElementById('vibe-model-select');
    const imageInput = document.getElementById('vibe-image-input');
    const previewImage = document.getElementById('vibe-preview-image');
    const previewContainer = document.getElementById('vibe-image-preview-container');
    const selectImageBtn = document.getElementById('vibe-select-image-btn');
    const removeImageBtn = document.getElementById('vibe-remove-image-btn');
    const strengthRange = document.getElementById('vibe-strength-ref');
    const strengthNum = document.getElementById('vibe-strength-ref-num');
    const submitBtn = document.getElementById('vibe-submit-btn');
    const downloadBtn = document.getElementById('vibe-download-btn');
    const statusDiv = document.getElementById('vibe-status');
    const newBtn = document.getElementById('vibe-preset-new');
    const saveBtn = document.getElementById('vibe-preset-save');
    const deleteBtn = document.getElementById('vibe-preset-delete');
    const exportCurrentBtn = document.getElementById('vibe-preset-export-current');
    const exportAllBtn = document.getElementById('vibe-preset-export-all');
    const importBtn = document.getElementById('vibe-preset-import');
    const uploadFileBtn = document.getElementById('vibe-upload-file-btn');
    const vibeFileInput = document.getElementById('vibe-file-input');

    let selectedFile = null;
    let currentImageId = null;
    let currentVibeDataId = null;

    function loadPresetList() {
        presetSelect.innerHTML = '';
        const presets = settings.vibePresets;
        const sortedKeys = Object.keys(presets).sort((a, b) => a.localeCompare(b, 'zh-CN'));
        for (const key of sortedKeys) {
            const option = new Option(key, key);
            presetSelect.add(option);
        }
        presetSelect.value = settings.vibePresetId;
    }

    function updateDownloadButtonState() {
        if (currentVibeDataId) {
            downloadBtn.disabled = false;
            downloadBtn.innerHTML = '<i class="fa-solid fa-download"></i> 下载 Vibe 文件 ✓';
            downloadBtn.title = '点击下载已保存的 Vibe 文件';
            downloadBtn.style.opacity = '1';
            downloadBtn.style.cursor = 'pointer';
            downloadBtn.style.background = '';
            downloadBtn.style.border = '';
        } else {
            downloadBtn.disabled = true;
            downloadBtn.innerHTML = '<i class="fa-solid fa-circle-exclamation"></i> 请先生成或上传 Vibe 数据';
            downloadBtn.title = '请先点击"生成并保存到预设"生成 Vibe 数据，或上传现有的 Vibe 文件';
            downloadBtn.style.opacity = '1';
            downloadBtn.style.cursor = 'not-allowed';
            downloadBtn.style.background = '#000';
            downloadBtn.style.border = '1px solid #333';
        }
    }

    function showImagePreview(src, showRemoveButton = true) {
        previewImage.src = src;
        previewImage.style.display = 'block';
        previewContainer.querySelector('.st-chatu8-image-placeholder').style.display = 'none';
        removeImageBtn.style.display = showRemoveButton ? 'inline-block' : 'none';
    }

    async function loadCurrentPreset() {
        const presetId = presetSelect.value;
        const preset = settings.vibePresets[presetId];
        if (!preset) return;

        modelSelect.value = preset.model || "nai-diffusion-4-5-full";
        strengthRange.value = preset.strength ?? 0.6;
        strengthNum.value = preset.strength ?? 0.6;
        document.getElementById('vibe-strength-val').textContent = preset.strength ?? 0.6;

        currentImageId = preset.imageId;
        currentVibeDataId = preset.vibeDataId || null;

        if (currentImageId) {
            try {
                const imageData = await getConfigImage(currentImageId);
                if (imageData) {
                    showImagePreview(imageData);
                } else if (preset.thumbnail) {
                    showImagePreview(preset.thumbnail, false);
                } else {
                    resetImagePreview({ clearVibeData: false });
                }
            } catch (error) {
                console.error('[Vibe] 加载图片预览失败:', error);
                if (preset.thumbnail) {
                    showImagePreview(preset.thumbnail, false);
                } else {
                    resetImagePreview({ clearVibeData: false });
                }
            }
        } else if (preset.thumbnail) {
            showImagePreview(preset.thumbnail, false);
        } else {
            resetImagePreview({ clearVibeData: false });
        }

        updateDownloadButtonState();
    }

    function resetImagePreview(options = {}) {
        const { clearVibeData = true } = options;
        selectedFile = null;
        currentImageId = null;
        if (clearVibeData) currentVibeDataId = null;  // 同时清空 Vibe 数据 ID
        imageInput.value = '';
        previewImage.src = '';
        previewImage.style.display = 'none';
        previewContainer.querySelector('.st-chatu8-image-placeholder').style.display = 'flex';
        removeImageBtn.style.display = 'none';
    }

    loadPresetList();
    loadCurrentPreset();

    presetSelect.onchange = () => {
        settings.vibePresetId = presetSelect.value;
        saveSettingsDebounced();
        loadCurrentPreset();
    };

    strengthRange.oninput = (e) => {
        strengthNum.value = e.target.value;
        document.getElementById('vibe-strength-val').textContent = e.target.value;
    };
    strengthNum.oninput = (e) => {
        strengthRange.value = e.target.value;
        document.getElementById('vibe-strength-val').textContent = e.target.value;
    };

    selectImageBtn.onclick = () => imageInput.click();

    imageInput.onchange = async (e) => {
        const file = e.target.files[0];
        if (!file) return;

        const presetId = presetSelect.value;
        if (presetId === "默认") {
            alert('请先"新建"一个新预设，默认预设不可修改。');
            imageInput.value = '';
            return;
        }

        try {
            // 读取图片为 data URL
            const imageData = await new Promise((resolve, reject) => {
                const reader = new FileReader();
                reader.onload = (ev) => resolve(ev.target.result);
                reader.onerror = reject;
                reader.readAsDataURL(file);
            });

            // 删除旧图片
            if (currentImageId) {
                await deleteConfigImage(currentImageId);
            }

            // 立即保存新图片到 configDatabase
            const newImageId = await saveConfigImage(imageData, {
                format: file.type.split('/')[1] || 'png',
                filename: `vibe_${presetId}_preview`,
                ...getVibeStorageOptions()
            });

            currentImageId = newImageId;
            selectedFile = null;  // 已持久化，不再需要 selectedFile

            // 更新 preset
            settings.vibePresets[presetId].imageId = newImageId;
            settings.vibePresets[presetId].thumbnail = null;
            saveSettingsDebounced();

            // DOM 预览
            previewImage.src = imageData;
            previewImage.style.display = 'block';
            previewContainer.querySelector('.st-chatu8-image-placeholder').style.display = 'none';
            removeImageBtn.style.display = 'inline-block';

            showStatus('图片已自动保存！', 'success');
        } catch (error) {
            console.error('[Vibe] 保存图片失败:', error);
            showStatus('保存图片失败: ' + error.message, 'error');
        }
    };

    removeImageBtn.onclick = async () => {
        if (currentImageId) {
            try {
                await deleteConfigImage(currentImageId);
                const presetId = presetSelect.value;
                settings.vibePresets[presetId].imageId = null;
                saveSettingsDebounced();
            } catch (error) {
                console.error('[Vibe] 删除图片失败:', error);
            }
        }
        resetImagePreview();
    };

    saveBtn.onclick = async () => {
        const presetId = presetSelect.value;
        if (!presetId || presetId === "默认") {
            alert('请先"新建"一个新预设，默认预设不可修改。');
            return;
        }

        try {
            // 图片已在选择时自动保存，此处仅保存 model/strength/vibeDataId
            settings.vibePresets[presetId] = {
                model: modelSelect.value,
                infoExtract: 1.0,
                strength: parseFloat(strengthRange.value),
                imageId: currentImageId,
                vibeDataId: currentVibeDataId,
                thumbnail: settings.vibePresets[presetId]?.thumbnail || null
            };

            saveSettingsDebounced();
            showStatus('预设已保存！', 'success');
        } catch (error) {
            console.error('[Vibe] 保存预设失败:', error);
            showStatus('保存失败: ' + error.message, 'error');
        }
    };

    newBtn.onclick = async () => {
        const newName = prompt('请输入新预设名称:');
        if (!newName) return;
        if (settings.vibePresets[newName]) {
            alert('该预设名称已存在，请使用其他名称。');
            return;
        }

        try {
            settings.vibePresets[newName] = {
                model: "nai-diffusion-4-5-full",
                infoExtract: 1.0,
                strength: 0.6,
                imageId: null,
                vibeDataId: null,
                thumbnail: null
            };

            settings.vibePresetId = newName;
            saveSettingsDebounced();
            loadPresetList();
            loadCurrentPreset();
            showStatus('新预设已创建！', 'success');
        } catch (error) {
            console.error('[Vibe] 创建预设失败:', error);
            showStatus('创建失败: ' + error.message, 'error');
        }
    };

    deleteBtn.onclick = async () => {
        const presetId = presetSelect.value;
        if (presetId === "默认") {
            alert('默认预设不可删除。');
            return;
        }
        if (!confirm(`确定要删除预设 "${presetId}" 吗？此操作不可恢复！`)) return;

        try {
            const preset = settings.vibePresets[presetId];
            if (preset) {
                if (preset.imageId) await deleteConfigImage(preset.imageId);
                if (preset.vibeDataId) await deleteConfigImage(preset.vibeDataId);
            }

            delete settings.vibePresets[presetId];
            settings.vibePresetId = "默认";
            saveSettingsDebounced();
            loadPresetList();
            loadCurrentPreset();
            showStatus('预设已删除！', 'success');
        } catch (error) {
            console.error('[Vibe] 删除预设失败:', error);
            showStatus('删除失败: ' + error.message, 'error');
        }
    };

    exportCurrentBtn.onclick = async () => {
        const presetId = presetSelect.value;
        const preset = settings.vibePresets[presetId];
        if (!preset) {
            alert('没有选中的预设可导出。');
            return;
        }

        try {
            const dataToExport = { presets: { [presetId]: preset }, images: {}, vibeData: {} };

            if (preset.imageId) {
                try {
                    const imageData = await getConfigImage(preset.imageId);
                    if (imageData) dataToExport.images[preset.imageId] = imageData;
                } catch (error) {
                    console.error('[Vibe] 获取图片失败:', error);
                }
            }

            if (preset.vibeDataId) {
                try {
                    const vibeData = await getConfigText(preset.vibeDataId);
                    if (vibeData) dataToExport.vibeData[preset.vibeDataId] = vibeData;
                } catch (error) {
                    console.error('[Vibe] 获取 Vibe 数据失败:', error);
                }
            }

            const dataStr = JSON.stringify(dataToExport, null, 2);
            const blob = new Blob([dataStr], { type: "application/json" });
            const url = URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url;
            a.download = `vibe-preset-${presetId}.json`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
            showStatus('预设已导出！', 'success');
        } catch (error) {
            console.error('[Vibe] 导出预设失败:', error);
            showStatus('导出失败: ' + error.message, 'error');
        }
    };

    exportAllBtn.onclick = async () => {
        if (!settings.vibePresets || Object.keys(settings.vibePresets).length === 0) {
            alert('没有预设可导出。');
            return;
        }

        try {
            const dataToExport = { presets: settings.vibePresets, images: {}, vibeData: {} };
            const imageIdsToExport = new Set();
            const vibeDataIdsToExport = new Set();

            for (const presetName in settings.vibePresets) {
                const preset = settings.vibePresets[presetName];
                if (preset.imageId) imageIdsToExport.add(preset.imageId);
                if (preset.vibeDataId) vibeDataIdsToExport.add(preset.vibeDataId);
            }

            for (const imageId of imageIdsToExport) {
                try {
                    const imageData = await getConfigImage(imageId);
                    if (imageData) dataToExport.images[imageId] = imageData;
                } catch (error) {
                    console.error(`[Vibe] 获取图片 ${imageId} 失败:`, error);
                }
            }

            for (const vibeDataId of vibeDataIdsToExport) {
                try {
                    const vibeData = await getConfigText(vibeDataId);
                    if (vibeData) dataToExport.vibeData[vibeDataId] = vibeData;
                } catch (error) {
                    console.error(`[Vibe] 获取 Vibe 数据 ${vibeDataId} 失败:`, error);
                }
            }

            const dataStr = JSON.stringify(dataToExport, null, 2);
            const blob = new Blob([dataStr], { type: "application/json" });
            const url = URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url;
            a.download = "vibe-presets-all.json";
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
            showStatus(`已导出 ${Object.keys(settings.vibePresets).length} 个预设！`, 'success');
        } catch (error) {
            console.error('[Vibe] 导出全部预设失败:', error);
            showStatus('导出失败: ' + error.message, 'error');
        }
    };

    importBtn.onclick = () => {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.json';
        input.onchange = async (e) => {
            const file = e.target.files[0];
            if (!file) return;
            const reader = new FileReader();
            reader.onload = async (readerEvent) => {
                try {
                    const importedData = JSON.parse(readerEvent.target.result);
                    let presetsToImport = {};
                    let imagesToImport = importedData.images || {};
                    let vibeDataToImport = importedData.vibeData || {};

                    if (importedData.presets) {
                        presetsToImport = importedData.presets;
                    } else {
                        presetsToImport = importedData;
                    }

                    let importedCount = 0;
                    let skippedCount = 0;

                    for (const key in presetsToImport) {
                        if (settings.vibePresets[key]) {
                            const overwrite = confirm(`预设 "${key}" 已存在，是否覆盖？`);
                            if (!overwrite) { skippedCount++; continue; }
                        }

                        const presetData = presetsToImport[key];

                        if (presetData.imageId && imagesToImport[presetData.imageId]) {
                            try {
                                const newImageId = await saveConfigImage(imagesToImport[presetData.imageId], {
                                    format: 'png',
                                    filename: `vibe_${key}_preview`,
                                    ...getVibeStorageOptions()
                                });
                                presetData.imageId = newImageId;
                            } catch (error) {
                                console.error(`[Vibe] 导入图片失败:`, error);
                                presetData.imageId = null;
                            }
                        }

                        if (presetData.vibeDataId && vibeDataToImport[presetData.vibeDataId]) {
                            try {
                                const importedVibeData = vibeDataToImport[presetData.vibeDataId];
                                const vibeText = typeof importedVibeData === 'string'
                                    ? importedVibeData
                                    : JSON.stringify(importedVibeData);
                                const newVibeDataId = await saveConfigText(vibeText, {
                                    filename: `vibe_${key}_data`,
                                    ...getVibeStorageOptions()
                                });
                                presetData.vibeDataId = newVibeDataId;
                            } catch (error) {
                                console.error(`[Vibe] 导入 Vibe 数据失败:`, error);
                                presetData.vibeDataId = null;
                            }
                        }

                        settings.vibePresets[key] = presetData;
                        importedCount++;
                    }

                    saveSettingsDebounced();
                    loadPresetList();
                    loadCurrentPreset();
                    showStatus(`成功导入 ${importedCount} 个预设${skippedCount > 0 ? `，跳过 ${skippedCount} 个` : ''}！`, 'success');
                } catch (error) {
                    console.error('[Vibe] 导入预设失败:', error);
                    showStatus('导入失败: ' + error.message, 'error');
                }
            };
            reader.readAsText(file);
        };
        input.click();
    };

    uploadFileBtn.onclick = () => vibeFileInput.click();

    vibeFileInput.onchange = async (e) => {
        const file = e.target.files[0];
        if (!file) return;

        const presetId = presetSelect.value;
        if (presetId === "默认") {
            alert('请先"新建"一个新预设，默认预设不可修改。');
            vibeFileInput.value = '';
            return;
        }

        try {
            const reader = new FileReader();
            reader.onload = async (readerEvent) => {
                try {
                    const vibeData = JSON.parse(readerEvent.target.result);

                    if (vibeData.identifier !== 'novelai-vibe-transfer') {
                        throw new Error('不是有效的 NovelAI Vibe 文件');
                    }

                    if (!vibeData.encodings || Object.keys(vibeData.encodings).length === 0) {
                        throw new Error('Vibe 文件中没有编码数据');
                    }

                    const importInfo = vibeData.importInfo || {};
                    const model = importInfo.model || 'nai-diffusion-4-5-full';
                    const strength = importInfo.strength ?? 0.6;
                    const imageBase64 = vibeData.image;
                    const thumbnailDataUrl = vibeData.thumbnail || null;
                    let importedPreviewDataUrl = null;
                    let shouldSavePreviewImage = false;

                    // 兜底：image 字段缺失时给出提示，但仍保存 encoding 数据
                    const warnings = [];
                    if (!imageBase64) {
                        warnings.push('Vibe 文件中缺少预览图片（image 字段），将仅保存编码数据');
                    }
                    if (!vibeData.importInfo) {
                        warnings.push('Vibe 文件中缺少 importInfo，使用默认模型和强度');
                    }

                    // 处理预览图片：优先使用 .naiv4vibe 内置缩略图，避免重复保存原图。
                    if (thumbnailDataUrl) {
                        importedPreviewDataUrl = thumbnailDataUrl;
                        showImagePreview(thumbnailDataUrl, false);
                    } else if (imageBase64) {
                        importedPreviewDataUrl = imageBase64.startsWith('data:') ? imageBase64 : `data:image/png;base64,${imageBase64}`;
                        shouldSavePreviewImage = true;
                        showImagePreview(importedPreviewDataUrl);
                    }

                    modelSelect.value = model;
                    strengthRange.value = strength;
                    strengthNum.value = strength;
                    document.getElementById('vibe-strength-val').textContent = strength;

                    showStatus('正在保存 Vibe 数据到预设...', 'loading');

                    if (currentVibeDataId) {
                        await deleteConfigImage(currentVibeDataId);
                    }

                    const vibeDataId = await saveConfigText(readerEvent.target.result, {
                        filename: `vibe_${presetId}_uploaded`,
                        ...getVibeStorageOptions()
                    });
                    currentVibeDataId = vibeDataId;

                    if (currentImageId) {
                        await deleteConfigImage(currentImageId);
                        currentImageId = null;
                    }

                    // 仅在没有内置 thumbnail 时保存预览图，避免导入官方 Vibe 时重复落库原图。
                    if (shouldSavePreviewImage && importedPreviewDataUrl) {
                        const previewFormat = importedPreviewDataUrl.startsWith('data:image/jpeg') ? 'jpeg' : 'png';
                        const newImageId = await saveConfigImage(importedPreviewDataUrl, {
                            format: previewFormat,
                            filename: `vibe_${presetId}_preview`,
                            ...getVibeStorageOptions()
                        });
                        currentImageId = newImageId;
                    }
                    selectedFile = null;

                    settings.vibePresets[presetId] = {
                        model: model,
                        infoExtract: 1.0,
                        strength: strength,
                        imageId: currentImageId,
                        vibeDataId: vibeDataId,
                        thumbnail: thumbnailDataUrl
                    };

                    saveSettingsDebounced();
                    updateDownloadButtonState();

                    // 显示结果（包含兜底警告）
                    if (warnings.length > 0) {
                        showStatus(`⚠️ Vibe 文件已保存，但存在以下问题：<br>${warnings.map(w => '• ' + w).join('<br>')}`, 'success');
                    } else {
                        showStatus('✅ Vibe 文件已上传并保存到预设！现在可以点击"下载 Vibe 文件"重新导出。', 'success');
                    }
                } catch (error) {
                    console.error('[Vibe] 解析 Vibe 文件失败:', error);
                    showStatus('解析失败: ' + error.message, 'error');
                }
            };
            reader.readAsText(file);
        } catch (error) {
            console.error('[Vibe] 读取 Vibe 文件失败:', error);
            showStatus('读取失败: ' + error.message, 'error');
        }
    };

    submitBtn.onclick = async () => {
        const apiKey = settings.novelaiApi;
        if (!apiKey || apiKey === '000000') {
            showStatus('请先在 NovelAI 设置中填写 API Key', 'error');
            return;
        }

        let imageToProcess = null;
        if (selectedFile) {
            imageToProcess = selectedFile;
        } else if (currentImageId) {
            try {
                const imageData = await getConfigImage(currentImageId);
                if (imageData) {
                    const base64Data = imageData.startsWith('data:') ? imageData.split(',')[1] : imageData;
                    const byteArray = base64ToUint8Array(base64Data);
                    imageToProcess = new Blob([byteArray], { type: 'image/png' });
                    imageToProcess.name = 'vibe_image.png';
                }
            } catch (error) {
                console.error('[Vibe] 加载图片失败:', error);
            }
        }

        if (!imageToProcess) {
            showStatus('请选择参考图片', 'error');
            return;
        }

        const model = modelSelect.value;
        const extractVal = 1;
        const strengthVal = parseFloat(strengthRange.value);

        try {
            showStatus('1/6 正在读取图片...', 'loading');
            submitBtn.disabled = true;

            // Step 1: Convert blob to data URL
            const imageDataUrl = await new Promise((resolve, reject) => {
                const reader = new FileReader();
                reader.onload = (e) => resolve(e.target.result);
                reader.onerror = reject;
                reader.readAsDataURL(imageToProcess);
            });

            showStatus('2/6 正在处理图片...', 'loading');

            // Log original size
            const originalSize = imageToProcess.size;
            console.log(`[Vibe] 原始图片大小: ${(originalSize / 1024).toFixed(2)} KB`);

            // Step 2: Process image (applies mobile optimization)
            // ⚠️ 临时注释：跳过图片优化处理，直接使用原始图片
            let processedBase64;
            // try {
            //     processedBase64 = await processReferenceImage(imageDataUrl);

            //     // Log processed size and format
            //     const processedSize = (processedBase64.length * 3) / 4; // Approximate byte size from base64
            //     const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
            //     const format = isMobile ? 'JPEG (质量 0.3)' : 'PNG';

            //     console.log(`[Vibe] 处理后图片大小: ${(processedSize / 1024).toFixed(2)} KB`);
            //     console.log(`[Vibe] 图片格式: ${format}`);
            //     console.log(`[Vibe] 移动端优化: ${isMobile ? '已启用' : '未启用'}`);
            //     console.log(`[Vibe] 大小减少: ${((1 - processedSize / originalSize) * 100).toFixed(1)}%`);
            // } catch (error) {
            //     console.error('[Vibe] 图片处理失败:', {
            //         error: error.message,
            //         stack: error.stack,
            //         imageSize: originalSize
            //     });
            //     showStatus(`图片处理失败: ${error.message}`, 'error');
            //     submitBtn.disabled = false;
            //     return;
            // }

            // 直接使用原始图片的 base64（去掉 data URL 前缀）
            processedBase64 = imageDataUrl.split(',')[1];
            console.log(`[Vibe] 使用原始图片（未优化）`);

            // Use processed base64 for backward compatibility with thumbnail generation
            const imageBase64 = processedBase64;

            showStatus('3/6 正在请求 API 编码 Vibe...（需要几秒）', 'loading');

            const payload = {
                image: imageBase64,
                information_extracted: extractVal,
                model: model
            };

            // 根据设置选择官方或第三方站点
            let encodeVibeUrl = 'https://image.novelai.net/ai/encode-vibe';
            if (settings.novelaisite && settings.novelaisite !== '官网') {
                if (settings.client === 'jiuguan') {
                    throw new Error('酒馆端不支持自定义站点的 Vibe 编码！');
                }
                const otherSite = normalizeNovelAIOtherSiteUrl(settings.novelaiOtherSite);
                if (!otherSite) {
                    throw new Error('已选择第三方站点，但未填写 novelaiOtherSite 地址');
                }
                encodeVibeUrl = otherSite.includes('encode-vibe')
                    ? otherSite
                    : `${otherSite}/ai/encode-vibe`;
            }
            console.log(`[Vibe] 编码请求 URL: ${encodeVibeUrl}`);

            const response = await fetch(encodeVibeUrl, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${apiKey}`,
                },
                body: JSON.stringify(payload)
            });

            if (!response.ok) {
                let errorDetail;
                try {
                    errorDetail = await response.text();
                    const errorJson = JSON.parse(errorDetail);
                    throw new Error(`API 错误 (${response.status}): ${errorJson.message || errorDetail}`);
                } catch (e) {
                    if (e.message.startsWith('API 错误')) throw e;
                    throw new Error(`HTTP ${response.status}: ${errorDetail || response.statusText}`);
                }
            }

            // ★ 直接用 ArrayBuffer 转 base64，与 Python base64.b64encode 完全等价
            const arrayBuffer = await response.arrayBuffer();
            const vibeUint8 = new Uint8Array(arrayBuffer);
            const vibeBase64 = uint8ArrayToBase64(vibeUint8);

            console.log(`[Vibe] encoding 原始字节: ${vibeUint8.length} bytes, base64 长度: ${vibeBase64.length}`);

            if (vibeUint8.length < 100) {
                throw new Error(`encoding 数据异常 (仅 ${vibeUint8.length} bytes)，API 可能返回了错误响应`);
            }

            showStatus('4/6 正在构建 Vibe JSON...', 'loading');

            // 确定图片格式（移动端为 JPEG，桌面端为 PNG）
            // ⚠️ 临时注释：使用原始图片格式
            // const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
            // const imageFormat = isMobile ? 'jpeg' : 'png';

            // 从原始文件类型获取格式
            const imageFormat = imageToProcess.type?.split('/')[1] || 'png';
            console.log(`[Vibe] 使用图片格式: ${imageFormat}`);

            const finalJson = await buildVibeJson(imageBase64, vibeBase64, model, extractVal, strengthVal, imageFormat);

            showStatus('5/6 保存图片到预设...', 'loading');

            if (selectedFile) {
                const imageData = await new Promise((resolve, reject) => {
                    const reader = new FileReader();
                    reader.onload = (ev) => resolve(ev.target.result);
                    reader.onerror = reject;
                    reader.readAsDataURL(selectedFile);
                });

                if (currentImageId) {
                    await deleteConfigImage(currentImageId);
                }

                const presetId = presetSelect.value;
                const newImageId = await saveConfigImage(imageData, {
                    format: selectedFile.type?.split('/')[1] || 'png',
                    filename: `vibe_${presetId}_preview`,
                    ...getVibeStorageOptions()
                });
                currentImageId = newImageId;
                selectedFile = null;
            }

            showStatus('6/6 保存 Vibe 数据到预设...', 'loading');

            const jsonString = JSON.stringify(finalJson);

            if (currentVibeDataId) {
                await deleteConfigImage(currentVibeDataId);
            }

            const presetId = presetSelect.value;
            const vibeDataId = await saveConfigText(jsonString, {
                filename: `vibe_${presetId}_data`,
                ...getVibeStorageOptions()
            });
            currentVibeDataId = vibeDataId;

            settings.vibePresets[presetId] = {
                model: model,
                infoExtract: 1.0,
                strength: strengthVal,
                imageId: currentImageId,
                vibeDataId: vibeDataId,
                thumbnail: finalJson.thumbnail || null
            };

            saveSettingsDebounced();
            updateDownloadButtonState();

            const filename = `${finalJson.name}.naiv4vibe`;
            showStatus(`✅ 完成！Vibe 数据已自动保存到预设 "${presetId}"<br>点击"下载 Vibe 文件"可导出 ${filename}`, 'success');

        } catch (err) {
            console.error('[Vibe] 生成失败:', err);
            showStatus(`失败: ${err.message}`, 'error');
        } finally {
            submitBtn.disabled = false;
        }
    };


    downloadBtn.onclick = async () => {
        if (!currentVibeDataId) {
            showStatus('没有可下载的 Vibe 数据，请先生成。', 'error');
            return;
        }

        try {
            downloadBtn.disabled = true;
            showStatus('正在准备下载...', 'loading');

            const jsonString = await getConfigText(currentVibeDataId);
            if (!jsonString) {
                throw new Error('无法读取 Vibe 数据');
            }

            // 验证有效性
            const parsed = JSON.parse(jsonString);
            if (parsed.identifier !== 'novelai-vibe-transfer') {
                throw new Error('存储的数据不是有效的 Vibe 格式');
            }

            const blob = new Blob([jsonString], { type: 'application/json' });
            const url = window.URL.createObjectURL(blob);

            const filename = `${parsed.name || 'vibe'}.naiv4vibe`;

            const a = document.createElement('a');
            a.href = url;
            a.download = filename;
            document.body.appendChild(a);
            a.click();
            window.URL.revokeObjectURL(url);
            document.body.removeChild(a);

            showStatus(`文件 ${filename} 已下载！可以直接上传到 NovelAI 官网使用。`, 'success');
        } catch (err) {
            console.error('[Vibe] 下载失败:', err);
            showStatus(`下载失败: ${err.message}`, 'error');
        } finally {
            downloadBtn.disabled = false;
        }
    };

    function showStatus(msg, type) {
        statusDiv.innerHTML = msg;
        statusDiv.style.display = 'block';
        statusDiv.className = '';
        statusDiv.style.textAlign = '';

        if (type === 'success') {
            statusDiv.style.background = 'rgba(27, 94, 32, 0.2)';
            statusDiv.style.color = '#81c784';
            statusDiv.style.border = '1px solid #2e7d32';
        } else if (type === 'error') {
            statusDiv.style.background = 'rgba(183, 28, 28, 0.2)';
            statusDiv.style.color = '#ef9a9a';
            statusDiv.style.border = '1px solid #c62828';
        } else if (type === 'loading') {
            statusDiv.style.background = '#333';
            statusDiv.style.color = '#90caf9';
            statusDiv.style.border = 'none';
            statusDiv.style.textAlign = 'center';
        }
    }
}

/**
 * 初始化 Vibe 生成器
 */
export function initVibeGenerator(settingsModal) {
    const vibeGeneratorBtn = settingsModal.find('#novelai-vibe-generator-btn');
    if (vibeGeneratorBtn.length) {
        vibeGeneratorBtn.on('click', () => {
            showVibeGeneratorDialog();
        });
    }
}
