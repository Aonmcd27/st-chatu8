// @ts-nocheck
/**
 * NovelAI Character Reference Group Editor
 * 
 * Allows users to create and manage groups of up to 4 character reference images.
 * Each group stores references to character reference images (by ID) along with individual
 * configuration parameters (type, strength, fidelity).
 */

import { extension_settings } from "../../../../../extensions.js";
import { saveSettingsDebounced } from "../../../../../../script.js";
import { extensionName } from '../config.js';
import { saveConfigImage, getConfigImage, deleteConfigImage } from '../configDatabase.js';

/**
 * Ensure Character Reference group presets storage structure exists
 * Initializes charRefGroups and charRefGroupId in extension_settings if not present
 * Provides fallback to empty state if data is corrupted
 * 
 * @returns {Object} The charRefGroups object from extension_settings
 */
export function ensureCharRefGroups() {
    const settings = extension_settings[extensionName];

    // Initialize charRefGroups if it doesn't exist or is corrupted
    if (!settings.charRefGroups || typeof settings.charRefGroups !== 'object' || Array.isArray(settings.charRefGroups)) {
        if (settings.charRefGroups) {
            console.error('[CharRef] Corrupted charRefGroups data detected, resetting to default:', settings.charRefGroups);
        }
        settings.charRefGroups = {
            "默认组": {
                references: [],
                createdAt: Date.now(),
                updatedAt: Date.now()
            }
        };
        console.log('[CharRef] Initialized charRefGroups with default group');
    }

    // Validate and fix each group
    for (const groupName in settings.charRefGroups) {
        const group = settings.charRefGroups[groupName];

        // Handle corrupted group data
        if (!group || typeof group !== 'object') {
            console.error('[CharRef] Corrupted group data for:', groupName, '- removing');
            delete settings.charRefGroups[groupName];
            continue;
        }

        // Ensure references array exists
        if (!Array.isArray(group.references)) {
            console.warn('[CharRef] Group missing references array:', groupName, '- initializing');
            group.references = [];
        }

        // Ensure timestamps exist
        if (typeof group.createdAt !== 'number') {
            group.createdAt = Date.now();
        }
        if (typeof group.updatedAt !== 'number') {
            group.updatedAt = Date.now();
        }
    }

    // Ensure at least one group exists
    if (Object.keys(settings.charRefGroups).length === 0) {
        console.warn('[CharRef] No valid groups found, creating default group');
        settings.charRefGroups["默认组"] = {
            references: [],
            createdAt: Date.now(),
            updatedAt: Date.now()
        };
    }

    // Initialize charRefGroupId if it doesn't exist or references non-existent group
    if (!settings.charRefGroupId || !settings.charRefGroups[settings.charRefGroupId]) {
        const firstGroupName = Object.keys(settings.charRefGroups)[0];
        settings.charRefGroupId = firstGroupName || "默认组";
        console.log('[CharRef] Set charRefGroupId to:', settings.charRefGroupId);
    }

    return settings.charRefGroups;
}

/**
 * Validate a character reference object
 * 
 * @param {Object} ref - The reference object to validate
 * @returns {Array<string>} Array of error messages (empty if valid)
 */
export function validateReference(ref) {
    const errors = [];

    if (!ref.imageId) {
        errors.push('缺少图片ID');
    }

    if (!['character', 'character_style', 'style'].includes(ref.type)) {
        errors.push('无效的参考类型');
    }

    if (typeof ref.strength !== 'number' || ref.strength < 0) {
        errors.push('Strength 值必须大于等于 0');
    }

    if (typeof ref.fidelity !== 'number' || ref.fidelity < 0) {
        errors.push('Fidelity 值必须大于等于 0');
    }

    return errors;
}

/**
 * Validate a character reference group
 * 
 * @param {Object} group - The group object to validate
 * @returns {Array<string>} Array of error messages (empty if valid)
 */
export function validateGroup(group) {
    const errors = [];

    if (!group || typeof group !== 'object') {
        errors.push('组数据无效');
        return errors;
    }

    if (!Array.isArray(group.references)) {
        errors.push('references 必须是数组');
    } else {
        if (group.references.length > 4) {
            errors.push('每个组最多只能包含 4 个参考图');
        }

        group.references.forEach((ref, index) => {
            const refErrors = validateReference(ref);
            refErrors.forEach(err => errors.push(`参考 ${index + 1}: ${err}`));
        });
    }

    return errors;
}


/**
 * Show status message
 * 
 * @param {HTMLElement} statusDiv - The status message div
 * @param {string} message - The message to display
 * @param {string} type - The message type ('success', 'error', 'info')
 */
function showCharRefStatus(statusDiv, message, type = 'info') {
    statusDiv.textContent = message;
    statusDiv.style.display = 'block';

    // Set background color based on type
    if (type === 'success') {
        statusDiv.style.backgroundColor = 'rgba(76, 175, 80, 0.1)';
        statusDiv.style.color = '#4caf50';
        statusDiv.style.border = '1px solid rgba(76, 175, 80, 0.3)';
    } else if (type === 'error') {
        statusDiv.style.backgroundColor = 'rgba(244, 67, 54, 0.1)';
        statusDiv.style.color = '#f44336';
        statusDiv.style.border = '1px solid rgba(244, 67, 54, 0.3)';
    } else {
        statusDiv.style.backgroundColor = 'rgba(33, 150, 243, 0.1)';
        statusDiv.style.color = '#2196f3';
        statusDiv.style.border = '1px solid rgba(33, 150, 243, 0.3)';
    }

    // Auto-hide after 5 seconds
    setTimeout(() => {
        statusDiv.style.display = 'none';
    }, 5000);
}

/**
 * Ensure Character Reference preset storage structure exists
 * Initializes charRefPresets and charRefPresetId in extension_settings if not present
 * 
 * @returns {Object} The charRefPresets object from extension_settings
 */
export function ensureCharRefPresets() {
    const settings = extension_settings[extensionName];

    // Initialize charRefPresets if it doesn't exist
    if (!settings.charRefPresets || typeof settings.charRefPresets !== 'object' || Array.isArray(settings.charRefPresets)) {
        if (settings.charRefPresets) {
            console.error('[CharRef] Corrupted charRefPresets data detected, resetting to default:', settings.charRefPresets);
        }
        settings.charRefPresets = {
            "默认": {
                imageId: null,
                createdAt: Date.now(),
                updatedAt: Date.now()
            }
        };
        console.log('[CharRef] Initialized charRefPresets with default preset');
    }

    // Ensure at least one preset exists
    if (Object.keys(settings.charRefPresets).length === 0) {
        console.warn('[CharRef] No valid presets found, creating default preset');
        settings.charRefPresets["默认"] = {
            imageId: null,
            createdAt: Date.now(),
            updatedAt: Date.now()
        };
    }

    // Initialize charRefPresetId if it doesn't exist or references non-existent preset
    if (!settings.charRefPresetId || !settings.charRefPresets[settings.charRefPresetId]) {
        const firstPresetName = Object.keys(settings.charRefPresets)[0];
        settings.charRefPresetId = firstPresetName || "默认";
        console.log('[CharRef] Set charRefPresetId to:', settings.charRefPresetId);
    }

    return settings.charRefPresets;
}

/**
 * Show Character Reference Upload Dialog (Preset Management System)
 * Creates and displays the dialog UI for managing character reference image presets
 * Each preset stores ONE reference image
 */
export function showCharRefUploadDialog() {
    const parent = document.getElementById('st-chatu8-settings') || document.body;
    const settings = extension_settings[extensionName];
    ensureCharRefPresets();

    // Create backdrop
    const backdrop = document.createElement('div');
    backdrop.className = 'st-chatu8-workflow-viz-backdrop';

    // Build dialog HTML structure
    backdrop.innerHTML = `
        <div class="st-chatu8-workflow-viz-dialog st-chatu8-char-ref-upload-dialog">
            <div class="st-chatu8-workflow-viz-header">
                <h3>角色参考图预设</h3>
                <span class="st-chatu8-workflow-viz-close">&times;</span>
            </div>
            <div class="st-chatu8-workflow-viz-body" style="padding: 2rem;">
                <div class="st-chatu8-char-ref-upload-content">
                    <!-- Preset Selector -->
                    <div class="st-chatu8-field" style="margin-bottom: 1.2rem;">
                        <label for="char-ref-preset-select">参考图预设</label>
                        <div class="st-chatu8-profile-controls">
                            <select id="char-ref-preset-select" class="st-chatu8-select"></select>
                            <button class="st-chatu8-icon-btn" id="char-ref-preset-new" title="新建预设">
                                <i class="fa-solid fa-plus"></i>
                            </button>
                            <button class="st-chatu8-icon-btn" id="char-ref-preset-export-current" title="导出当前预设">
                                <i class="fa-solid fa-upload"></i>
                            </button>
                            <button class="st-chatu8-icon-btn" id="char-ref-preset-export-all" title="导出全部预设">
                                <i class="fa-solid fa-file-export"></i>
                            </button>
                            <button class="st-chatu8-icon-btn" id="char-ref-preset-import" title="导入预设">
                                <i class="fa-solid fa-download"></i>
                            </button>
                            <button class="st-chatu8-icon-btn danger" id="char-ref-preset-delete" title="删除当前预设">
                                <i class="fa-solid fa-trash"></i>
                            </button>
                        </div>
                    </div>

                    <!-- Image Preview -->
                    <div class="st-chatu8-field-col" style="margin-bottom: 1.2rem;">
                        <label>参考图片预览</label>
                        <div class="st-chatu8-image-preview-container" id="char-ref-upload-preview-container">
                            <div class="st-chatu8-image-placeholder">
                                <i class="fa-solid fa-image"></i>
                                <span>没有选择图片</span>
                            </div>
                            <img id="char-ref-upload-preview" src="" alt="参考图预览" style="display: none;">
                        </div>
                        <div class="st-chatu8-image-controls" style="margin-top: 0.5rem;">
                            <input type="file" id="char-ref-upload-input" accept="image/png, image/jpeg, image/webp" style="display:none;">
                            <button type="button" class="st-chatu8-btn" id="char-ref-select-btn">
                                <i class="fa-solid fa-upload"></i> 选择图片
                            </button>
                            <button type="button" class="st-chatu8-btn danger" id="char-ref-remove-preview-btn" style="display: none;">
                                <i class="fa-solid fa-trash"></i> 移除图片
                            </button>
                        </div>
                    </div>
                    
                    <div id="char-ref-upload-status" style="margin-top: 1.5rem; padding: 1rem; border-radius: 6px; font-size: 0.9rem; display: none; line-height: 1.4;"></div>
                </div>
            </div>
        </div>
    `;

    parent.appendChild(backdrop);

    // Bind close events
    const closeBtn = backdrop.querySelector('.st-chatu8-workflow-viz-close');
    closeBtn.onclick = () => parent.removeChild(backdrop);
    backdrop.onclick = (e) => {
        if (e.target === backdrop) {
            parent.removeChild(backdrop);
        }
    };

    // Get DOM elements
    const presetSelect = document.getElementById('char-ref-preset-select');
    const newBtn = document.getElementById('char-ref-preset-new');
    const deleteBtn = document.getElementById('char-ref-preset-delete');
    const exportCurrentBtn = document.getElementById('char-ref-preset-export-current');
    const exportAllBtn = document.getElementById('char-ref-preset-export-all');
    const importBtn = document.getElementById('char-ref-preset-import');
    const imageInput = document.getElementById('char-ref-upload-input');
    const previewImage = document.getElementById('char-ref-upload-preview');
    const previewContainer = document.getElementById('char-ref-upload-preview-container');
    const selectBtn = document.getElementById('char-ref-select-btn');
    const removePreviewBtn = document.getElementById('char-ref-remove-preview-btn');
    const statusDiv = document.getElementById('char-ref-upload-status');

    let currentImageId = null;

    // Load preset list
    function loadPresetList() {
        presetSelect.innerHTML = '';
        const presets = settings.charRefPresets;
        const sortedKeys = Object.keys(presets).sort((a, b) => {
            if (a === "默认") return -1;
            if (b === "默认") return 1;
            return a.localeCompare(b, 'zh-CN');
        });
        for (const key of sortedKeys) {
            const option = new Option(key, key);
            presetSelect.add(option);
        }
        presetSelect.value = settings.charRefPresetId;
    }

    // Load current preset
    async function loadCurrentPreset() {
        const presetId = presetSelect.value;
        const preset = settings.charRefPresets[presetId];
        if (!preset) return;

        currentImageId = preset.imageId;

        if (currentImageId) {
            try {
                const imageData = await getConfigImage(currentImageId);
                if (imageData) {
                    previewImage.src = imageData;
                    previewImage.style.display = 'block';
                    previewContainer.querySelector('.st-chatu8-image-placeholder').style.display = 'none';
                    removePreviewBtn.style.display = 'inline-block';
                } else {
                    resetImagePreview();
                }
            } catch (error) {
                console.error('[CharRef] 加载图片预览失败:', error);
                resetImagePreview();
            }
        } else {
            resetImagePreview();
        }
    }

    // Reset image preview
    function resetImagePreview() {
        currentImageId = null;
        imageInput.value = '';
        previewImage.src = '';
        previewImage.style.display = 'none';
        previewContainer.querySelector('.st-chatu8-image-placeholder').style.display = 'flex';
        removePreviewBtn.style.display = 'none';
    }

    loadPresetList();
    loadCurrentPreset();

    // Preset select change
    presetSelect.onchange = () => {
        settings.charRefPresetId = presetSelect.value;
        saveSettingsDebounced();
        loadCurrentPreset();
    };

    // Bind select button
    selectBtn.onclick = () => imageInput.click();

    // Handle file selection - immediately save to database
    imageInput.onchange = async (e) => {
        const file = e.target.files[0];
        if (!file) return;

        // Validate file type
        const validTypes = ['image/png', 'image/jpeg', 'image/webp'];
        if (!validTypes.includes(file.type)) {
            showCharRefStatus(statusDiv, '不支持的图片格式。请选择 PNG、JPEG 或 WebP 格式的图片。', 'error');
            return;
        }

        try {
            showCharRefStatus(statusDiv, '正在保存图片...', 'info');

            // Read file as data URL
            const imageData = await new Promise((resolve, reject) => {
                const reader = new FileReader();
                reader.onload = (e) => resolve(e.target.result);
                reader.onerror = reject;
                reader.readAsDataURL(file);
            });

            // Delete old image if exists
            if (currentImageId) {
                try {
                    await deleteConfigImage(currentImageId);
                } catch (error) {
                    console.error('[CharRef] 删除旧图片失败:', error);
                }
            }

            // Save to configDatabase
            const presetId = presetSelect.value;
            const newImageId = await saveConfigImage(imageData, {
                format: file.type.split('/')[1] || 'png',
                filename: `char_ref_${presetId}_${Date.now()}`
            });

            currentImageId = newImageId;

            // Update preset in settings
            settings.charRefPresets[presetId] = {
                imageId: currentImageId,
                createdAt: settings.charRefPresets[presetId]?.createdAt || Date.now(),
                updatedAt: Date.now()
            };

            saveSettingsDebounced();

            // Update preview
            previewImage.src = imageData;
            previewImage.style.display = 'block';
            previewContainer.querySelector('.st-chatu8-image-placeholder').style.display = 'none';
            removePreviewBtn.style.display = 'inline-block';

            showCharRefStatus(statusDiv, '图片已保存！', 'success');
            console.log('[CharRef] Image saved with ID:', newImageId);

        } catch (error) {
            console.error('[CharRef] 保存图片失败:', error);

            if (error.name === 'QuotaExceededError') {
                showCharRefStatus(statusDiv, '存储空间不足，请删除一些旧图片', 'error');
            } else {
                showCharRefStatus(statusDiv, `保存失败: ${error.message || '未知错误'}`, 'error');
            }
        }
    };

    // Handle remove preview
    removePreviewBtn.onclick = async () => {
        if (currentImageId) {
            try {
                await deleteConfigImage(currentImageId);
                const presetId = presetSelect.value;
                settings.charRefPresets[presetId].imageId = null;
                saveSettingsDebounced();
            } catch (error) {
                console.error('[CharRef] 删除图片失败:', error);
            }
        }
        resetImagePreview();
    };

    // New preset
    newBtn.onclick = async () => {
        const newName = prompt('请输入新预设名称:');
        if (!newName) return;
        if (settings.charRefPresets[newName]) {
            alert('该预设名称已存在，请使用其他名称。');
            return;
        }

        try {
            settings.charRefPresets[newName] = {
                imageId: null,
                createdAt: Date.now(),
                updatedAt: Date.now()
            };

            settings.charRefPresetId = newName;
            saveSettingsDebounced();
            loadPresetList();
            loadCurrentPreset();
            showCharRefStatus(statusDiv, '新预设已创建！', 'success');
        } catch (error) {
            console.error('[CharRef] 创建预设失败:', error);
            showCharRefStatus(statusDiv, '创建失败: ' + error.message, 'error');
        }
    };

    // Delete preset
    deleteBtn.onclick = async () => {
        const presetId = presetSelect.value;
        if (presetId === "默认") {
            alert('默认预设不可删除。');
            return;
        }
        if (!confirm(`确定要删除预设 "${presetId}" 吗？此操作不可恢复！`)) return;

        try {
            const preset = settings.charRefPresets[presetId];
            if (preset && preset.imageId) {
                await deleteConfigImage(preset.imageId);
            }

            delete settings.charRefPresets[presetId];
            settings.charRefPresetId = "默认";
            saveSettingsDebounced();
            loadPresetList();
            loadCurrentPreset();
            showCharRefStatus(statusDiv, '预设已删除！', 'success');
        } catch (error) {
            console.error('[CharRef] 删除预设失败:', error);
            showCharRefStatus(statusDiv, '删除失败: ' + error.message, 'error');
        }
    };

    // Export current preset
    exportCurrentBtn.onclick = async () => {
        const presetId = presetSelect.value;
        const preset = settings.charRefPresets[presetId];
        if (!preset) {
            alert('没有选中的预设可导出。');
            return;
        }

        try {
            const dataToExport = { presets: { [presetId]: preset }, images: {} };

            if (preset.imageId) {
                try {
                    const imageData = await getConfigImage(preset.imageId);
                    if (imageData) dataToExport.images[preset.imageId] = imageData;
                } catch (error) {
                    console.error('[CharRef] 获取图片失败:', error);
                }
            }

            const dataStr = JSON.stringify(dataToExport, null, 2);
            const blob = new Blob([dataStr], { type: "application/json" });
            const url = URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url;
            a.download = `char-ref-preset-${presetId}.json`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
            showCharRefStatus(statusDiv, '预设已导出！', 'success');
        } catch (error) {
            console.error('[CharRef] 导出预设失败:', error);
            showCharRefStatus(statusDiv, '导出失败: ' + error.message, 'error');
        }
    };

    // Export all presets
    exportAllBtn.onclick = async () => {
        if (!settings.charRefPresets || Object.keys(settings.charRefPresets).length === 0) {
            alert('没有预设可导出。');
            return;
        }

        try {
            const dataToExport = { presets: settings.charRefPresets, images: {} };
            const imageIdsToExport = new Set();

            for (const presetName in settings.charRefPresets) {
                const preset = settings.charRefPresets[presetName];
                if (preset.imageId) imageIdsToExport.add(preset.imageId);
            }

            for (const imageId of imageIdsToExport) {
                try {
                    const imageData = await getConfigImage(imageId);
                    if (imageData) dataToExport.images[imageId] = imageData;
                } catch (error) {
                    console.error(`[CharRef] 获取图片 ${imageId} 失败:`, error);
                }
            }

            const dataStr = JSON.stringify(dataToExport, null, 2);
            const blob = new Blob([dataStr], { type: "application/json" });
            const url = URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url;
            a.download = "char-ref-presets-all.json";
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
            showCharRefStatus(statusDiv, `已导出 ${Object.keys(settings.charRefPresets).length} 个预设！`, 'success');
        } catch (error) {
            console.error('[CharRef] 导出全部预设失败:', error);
            showCharRefStatus(statusDiv, '导出失败: ' + error.message, 'error');
        }
    };

    // Import presets
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

                    if (importedData.presets) {
                        presetsToImport = importedData.presets;
                    } else {
                        presetsToImport = importedData;
                    }

                    let importedCount = 0;
                    let skippedCount = 0;

                    for (const key in presetsToImport) {
                        if (settings.charRefPresets[key]) {
                            const overwrite = confirm(`预设 "${key}" 已存在，是否覆盖？`);
                            if (!overwrite) { skippedCount++; continue; }
                        }

                        const presetData = presetsToImport[key];

                        if (presetData.imageId && imagesToImport[presetData.imageId]) {
                            try {
                                const newImageId = await saveConfigImage(imagesToImport[presetData.imageId], {
                                    format: 'png', filename: `char_ref_${key}_${Date.now()}`
                                });
                                presetData.imageId = newImageId;
                            } catch (error) {
                                console.error(`[CharRef] 导入图片失败:`, error);
                                presetData.imageId = null;
                            }
                        }

                        settings.charRefPresets[key] = presetData;
                        importedCount++;
                    }

                    saveSettingsDebounced();
                    loadPresetList();
                    loadCurrentPreset();
                    showCharRefStatus(statusDiv, `成功导入 ${importedCount} 个预设${skippedCount > 0 ? `，跳过 ${skippedCount} 个` : ''}！`, 'success');
                } catch (error) {
                    console.error('[CharRef] 导入预设失败:', error);
                    showCharRefStatus(statusDiv, '导入失败: ' + error.message, 'error');
                }
            };
            reader.readAsText(file);
        };
        input.click();
    };

    console.log('[CharRef] Upload dialog opened');
}


/**
 * Load group preset list into select element
 * Populates the select element with sorted group names and sets current selection
 * 
 * @param {HTMLSelectElement} selectElement - The select element to populate
 */
function loadCharRefGroupList(selectElement) {
    const settings = extension_settings[extensionName];
    const charRefGroups = settings.charRefGroups || {};
    const currentGroupId = settings.charRefGroupId || "默认组";

    // Clear existing options
    selectElement.innerHTML = '';

    // Get sorted group names
    const groupNames = Object.keys(charRefGroups).sort((a, b) => {
        // Sort alphabetically, but keep "默认组" at the top
        if (a === "默认组") return -1;
        if (b === "默认组") return 1;
        return a.localeCompare(b, 'zh-CN');
    });

    // Populate select element
    groupNames.forEach(groupName => {
        const option = document.createElement('option');
        option.value = groupName;
        option.textContent = groupName;
        if (groupName === currentGroupId) {
            option.selected = true;
        }
        selectElement.appendChild(option);
    });

    console.log('[CharRef] Loaded preset list:', groupNames.length, 'groups');
}

/**
 * Create a new character reference group
 * Prompts user for group name, validates uniqueness, and initializes empty group
 * 
 * @param {HTMLSelectElement} selectElement - The select element to update
 * @param {HTMLElement} statusDiv - The status message div
 */
function createNewCharRefGroup(selectElement, statusDiv) {
    const settings = extension_settings[extensionName];
    const charRefGroups = settings.charRefGroups || {};

    // Prompt for group name
    const groupName = prompt('请输入新组名称:');

    // Validate input
    if (!groupName) {
        return; // User cancelled
    }

    const trimmedName = groupName.trim();
    if (!trimmedName) {
        showCharRefStatus(statusDiv, '组名不能为空', 'error');
        return;
    }

    // Check for uniqueness
    if (charRefGroups[trimmedName]) {
        showCharRefStatus(statusDiv, `组名 "${trimmedName}" 已存在`, 'error');
        return;
    }

    // Initialize empty group with timestamp
    charRefGroups[trimmedName] = {
        references: [],
        createdAt: Date.now(),
        updatedAt: Date.now()
    };

    // Set as current group
    settings.charRefGroupId = trimmedName;

    // Save settings with error handling
    try {
        saveSettingsDebounced();
    } catch (error) {
        console.error('[CharRef] Failed to save settings after creating new group:', {
            groupName: trimmedName,
            error: error.message,
            errorName: error.name,
            timestamp: new Date().toISOString(),
            stack: error.stack
        });
        showCharRefStatus(statusDiv, `创建成功但保存失败: ${error.message}`, 'error');
        return;
    }

    // Reload preset list
    loadCharRefGroupList(selectElement);

    showCharRefStatus(statusDiv, `已创建新组 "${trimmedName}"`, 'success');
    console.log('[CharRef] Created new group:', trimmedName);
}

/**
 * Save current character reference group
 * Updates group data in extension_settings and persists to storage
 * 
 * @param {HTMLSelectElement} selectElement - The select element
 * @param {HTMLElement} statusDiv - The status message div
 */
function saveCurrentCharRefGroup(selectElement, statusDiv) {
    const settings = extension_settings[extensionName];
    const charRefGroups = settings.charRefGroups || {};
    const currentGroupId = selectElement.value;

    if (!currentGroupId) {
        showCharRefStatus(statusDiv, '未选择组', 'error');
        return;
    }

    const currentGroup = charRefGroups[currentGroupId];
    if (!currentGroup) {
        showCharRefStatus(statusDiv, '当前组不存在', 'error');
        return;
    }

    // Update timestamp
    currentGroup.updatedAt = Date.now();

    // Update current group ID in settings
    settings.charRefGroupId = currentGroupId;

    // Save settings with error handling
    try {
        saveSettingsDebounced();
    } catch (error) {
        console.error('[CharRef] Failed to save settings after saving group:', {
            groupId: currentGroupId,
            error: error.message,
            errorName: error.name,
            timestamp: new Date().toISOString(),
            stack: error.stack
        });
        showCharRefStatus(statusDiv, `保存失败: ${error.message}`, 'error');
        return;
    }

    showCharRefStatus(statusDiv, `已保存组 "${currentGroupId}"`, 'success');
    console.log('[CharRef] Saved group:', currentGroupId);
}

/**
 * Delete current character reference group
 * Confirms deletion with user, removes group from storage, and switches to default group
 * 
 * @param {HTMLSelectElement} selectElement - The select element
 * @param {HTMLElement} statusDiv - The status message div
 */
async function deleteCharRefGroup(selectElement, statusDiv) {
    const settings = extension_settings[extensionName];
    const charRefGroups = settings.charRefGroups || {};
    const currentGroupId = selectElement.value;

    if (!currentGroupId) {
        showCharRefStatus(statusDiv, '未选择组', 'error');
        return;
    }

    // Prevent deleting the default group if it's the only one
    if (currentGroupId === "默认组" && Object.keys(charRefGroups).length === 1) {
        showCharRefStatus(statusDiv, '不能删除唯一的组', 'error');
        return;
    }

    // Confirm deletion
    const confirmed = confirm(`确定要删除组 "${currentGroupId}" 吗？此操作无法撤销。`);
    if (!confirmed) {
        return;
    }

    // Cleanup images before deleting
    const group = charRefGroups[currentGroupId];
    if (group && Array.isArray(group.references)) {
        for (const ref of group.references) {
            try {
                await deleteConfigImage(ref.imageId);
            } catch (error) {
                console.error('[CharRef] Failed to delete image:', ref.imageId, error);
            }
        }
    }

    // Remove group from storage
    delete charRefGroups[currentGroupId];

    // Switch to default group or first available group
    if (charRefGroups["默认组"]) {
        settings.charRefGroupId = "默认组";
    } else {
        const remainingGroups = Object.keys(charRefGroups);
        settings.charRefGroupId = remainingGroups.length > 0 ? remainingGroups[0] : "默认组";

        // If no groups remain, create default group
        if (remainingGroups.length === 0) {
            charRefGroups["默认组"] = {
                references: [],
                createdAt: Date.now(),
                updatedAt: Date.now()
            };
            settings.charRefGroupId = "默认组";
        }
    }

    // Save settings with error handling
    try {
        saveSettingsDebounced();
    } catch (error) {
        console.error('[CharRef] Failed to save settings after deleting group:', {
            groupId: currentGroupId,
            error: error.message,
            errorName: error.name,
            timestamp: new Date().toISOString(),
            stack: error.stack
        });
        showCharRefStatus(statusDiv, `删除成功但保存失败: ${error.message}`, 'error');
        // Don't return - still reload the list
    }

    // Reload preset list
    loadCharRefGroupList(selectElement);

    showCharRefStatus(statusDiv, `已删除组 "${currentGroupId}"`, 'success');
    console.log('[CharRef] Deleted group:', currentGroupId);
}

/**
 * Show Character Reference Group Editor Dialog
 * Creates and displays the main dialog UI for managing character reference groups
 */
export function showCharRefGroupEditorDialog() {
    const parent = document.getElementById('st-chatu8-settings') || document.body;
    const settings = extension_settings[extensionName];
    ensureCharRefGroups();

    // Create backdrop
    const backdrop = document.createElement('div');
    backdrop.className = 'st-chatu8-workflow-viz-backdrop';

    // Build dialog HTML structure
    backdrop.innerHTML = `
        <div class="st-chatu8-workflow-viz-dialog st-chatu8-char-ref-group-editor-dialog">
            <div class="st-chatu8-workflow-viz-header">
                <h3>角色组编辑器</h3>
                <span class="st-chatu8-workflow-viz-close">&times;</span>
            </div>
            <div class="st-chatu8-workflow-viz-body" style="padding: 2rem;">
                <div class="st-chatu8-char-ref-group-editor-content">
                    <!-- Group Preset Selector -->
                    <div class="st-chatu8-field" style="margin-bottom: 1.2rem;">
                        <label for="char-ref-group-select">角色组预设</label>
                        <div class="st-chatu8-profile-controls">
                            <select id="char-ref-group-select" class="st-chatu8-select"></select>
                            <button class="st-chatu8-icon-btn" id="char-ref-group-new" title="新建组">
                                <i class="fa-solid fa-plus"></i>
                            </button>
                            <button class="st-chatu8-icon-btn" id="char-ref-group-save" title="保存当前组">
                                <i class="fa-solid fa-save"></i>
                            </button>
                            <button class="st-chatu8-icon-btn danger" id="char-ref-group-delete" title="删除当前组">
                                <i class="fa-solid fa-trash"></i>
                            </button>
                        </div>
                    </div>

                    <!-- Add Reference Button -->
                    <button type="button" class="st-chatu8-btn" id="char-ref-group-add-ref" style="width: 100%; padding: 1rem; font-size: 16px; font-weight: 600; margin-bottom: 1.5rem;">
                        <i class="fa-solid fa-plus"></i> 添加角色参考 (0/4)
                    </button>

                    <!-- Reference Slots Container -->
                    <div id="char-ref-slots-container" class="st-chatu8-char-ref-slots">
                        <!-- Dynamically rendered slots (0-4) -->
                    </div>

                    <!-- Status Message Area -->
                    <div id="char-ref-group-status" style="margin-top: 1.5rem; padding: 1rem; border-radius: 6px; font-size: 0.9rem; display: none; line-height: 1.4;"></div>
                </div>
            </div>
        </div>
    `;

    parent.appendChild(backdrop);

    // Bind close events
    const closeBtn = backdrop.querySelector('.st-chatu8-workflow-viz-close');
    closeBtn.onclick = () => parent.removeChild(backdrop);
    backdrop.onclick = (e) => {
        if (e.target === backdrop) {
            parent.removeChild(backdrop);
        }
    };

    // Get DOM elements
    const groupSelect = document.getElementById('char-ref-group-select');
    const newBtn = document.getElementById('char-ref-group-new');
    const saveBtn = document.getElementById('char-ref-group-save');
    const deleteBtn = document.getElementById('char-ref-group-delete');
    const addRefBtn = document.getElementById('char-ref-group-add-ref');
    const slotsContainer = document.getElementById('char-ref-slots-container');
    const statusDiv = document.getElementById('char-ref-group-status');

    // Load preset list
    loadCharRefGroupList(groupSelect);

    // Bind new group button
    newBtn.onclick = () => createNewCharRefGroup(groupSelect, statusDiv);

    // Bind save group button
    saveBtn.onclick = () => saveCurrentCharRefGroup(groupSelect, statusDiv);

    // Bind delete group button
    deleteBtn.onclick = () => deleteCharRefGroup(groupSelect, statusDiv);

    // Bind add reference button
    addRefBtn.onclick = () => addCharRefToGroup(groupSelect, slotsContainer, addRefBtn, statusDiv);

    // Initial render of reference slots
    renderCharRefSlots(slotsContainer, groupSelect, addRefBtn);

    // Bind group select change event to re-render slots
    groupSelect.onchange = () => {
        settings.charRefGroupId = groupSelect.value;
        renderCharRefSlots(slotsContainer, groupSelect, addRefBtn);
    };

    console.log('[CharRef] Group editor dialog opened');
}


/**
 * Render character reference slots for the current group
 * Clears the slots container and creates slot HTML for each reference (0-4)
 * 
 * @param {HTMLElement} slotsContainer - The container element for reference slots
 * @param {HTMLSelectElement} groupSelect - The group selector element
 * @param {HTMLButtonElement} addRefBtn - The "添加角色参考" button element
 */
async function renderCharRefSlots(slotsContainer, groupSelect, addRefBtn) {
    const settings = extension_settings[extensionName];
    const charRefGroups = settings.charRefGroups || {};
    const currentGroupId = groupSelect.value;
    const currentGroup = charRefGroups[currentGroupId];

    // Clear slots container
    slotsContainer.innerHTML = '';

    if (!currentGroup) {
        console.warn('[CharRef] Current group not found:', currentGroupId);
        // Provide fallback to empty state
        slotsContainer.innerHTML = `
            <div style="text-align: center; padding: 3rem; color: rgba(255, 255, 255, 0.5);">
                <i class="fa-solid fa-exclamation-circle" style="font-size: 3rem; margin-bottom: 1rem; display: block;"></i>
                <p>无法加载组数据</p>
                <p style="font-size: 0.9rem; margin-top: 0.5rem;">请尝试选择其他组或创建新组</p>
            </div>
        `;
        addRefBtn.disabled = true;
        addRefBtn.style.opacity = '0.5';
        return;
    }

    // Handle corrupted group data - ensure references is an array
    if (!Array.isArray(currentGroup.references)) {
        console.error('[CharRef] Corrupted group data - references is not an array:', currentGroupId, currentGroup);
        // Attempt to fix corrupted data by initializing empty array
        currentGroup.references = [];
        currentGroup.updatedAt = Date.now();
        saveSettingsDebounced();
        console.log('[CharRef] Fixed corrupted group data');
    }

    const references = currentGroup.references;
    const refCount = references.length;

    // Update add button text and state
    addRefBtn.innerHTML = `<i class="fa-solid fa-plus"></i> 添加角色参考 (${refCount}/4)`;
    addRefBtn.disabled = refCount >= 4;
    addRefBtn.style.opacity = refCount >= 4 ? '0.5' : '1';

    // If no references, show empty state
    if (refCount === 0) {
        slotsContainer.innerHTML = `
            <div style="text-align: center; padding: 3rem; color: rgba(255, 255, 255, 0.5);">
                <i class="fa-solid fa-image" style="font-size: 3rem; margin-bottom: 1rem; display: block;"></i>
                <p>此组还没有角色参考</p>
                <p style="font-size: 0.9rem; margin-top: 0.5rem;">点击上方按钮添加角色参考图</p>
            </div>
        `;
        return;
    }

    // Render each reference slot
    for (let i = 0; i < references.length; i++) {
        const ref = references[i];
        const slotDiv = document.createElement('div');
        slotDiv.className = 'st-chatu8-char-ref-slot';
        slotDiv.style.cssText = 'border: 1px solid rgba(255, 255, 255, 0.1); border-radius: 8px; padding: 1rem; margin-bottom: 1rem; background: rgba(0, 0, 0, 0.2);';

        // Get image data
        let imageDataUrl = '';
        try {
            imageDataUrl = await getConfigImage(ref.imageId);
        } catch (error) {
            console.error('[CharRef] Failed to load image:', ref.imageId, error);
        }

        slotDiv.innerHTML = `
            <div style="display: flex; gap: 1rem; align-items: flex-start;">
                <!-- Image Thumbnail -->
                <div style="flex-shrink: 0;">
                    <img src="${imageDataUrl || ''}" alt="参考图 ${i + 1}" 
                         style="width: 120px; height: 120px; object-fit: cover; border-radius: 6px; background: rgba(255, 255, 255, 0.05);"
                         onerror="this.style.display='none'; this.nextElementSibling.style.display='flex';">
                    <div style="width: 120px; height: 120px; display: ${imageDataUrl ? 'none' : 'flex'}; align-items: center; justify-content: center; border-radius: 6px; background: rgba(255, 255, 255, 0.05); color: rgba(255, 255, 255, 0.3);">
                        <i class="fa-solid fa-image" style="font-size: 2rem;"></i>
                    </div>
                </div>

                <!-- Controls -->
                <div style="flex: 1; display: flex; flex-direction: column; gap: 1rem;">
                    <!-- Reference Type -->
                    <div class="st-chatu8-field">
                        <label for="char-ref-type-${i}">参考类型</label>
                        <select id="char-ref-type-${i}" class="st-chatu8-select char-ref-type-select" data-index="${i}">
                            <option value="character" ${ref.type === 'character' ? 'selected' : ''}>Character</option>
                            <option value="character_style" ${ref.type === 'character_style' ? 'selected' : ''}>Character & Style</option>
                            <option value="style" ${ref.type === 'style' ? 'selected' : ''}>Style</option>
                        </select>
                    </div>

                    <!-- Strength Slider -->
                    <div class="st-chatu8-field">
                        <label for="char-ref-strength-${i}">Strength: <span id="char-ref-strength-val-${i}">${ref.strength ?? 0.6}</span></label>
                        <div class="st-chatu8-range-container">
                            <input type="range" id="char-ref-strength-range-${i}" class="st-chatu8-range-slider char-ref-strength-range" 
                                   data-index="${i}" min="0" max="2" step="0.01" value="${ref.strength ?? 0.6}">
                            <input type="number" id="char-ref-strength-${i}" class="st-chatu8-range-input char-ref-strength-input" 
                                   data-index="${i}" min="0" step="0.01" value="${ref.strength ?? 0.6}">
                        </div>
                    </div>

                    <!-- Fidelity Slider -->
                    <div class="st-chatu8-field">
                        <label for="char-ref-fidelity-${i}">Fidelity: <span id="char-ref-fidelity-val-${i}">${ref.fidelity ?? 0.6}</span></label>
                        <div class="st-chatu8-range-container">
                            <input type="range" id="char-ref-fidelity-range-${i}" class="st-chatu8-range-slider char-ref-fidelity-range" 
                                   data-index="${i}" min="0" max="2" step="0.01" value="${ref.fidelity ?? 0.6}">
                            <input type="number" id="char-ref-fidelity-${i}" class="st-chatu8-range-input char-ref-fidelity-input" 
                                   data-index="${i}" min="0" step="0.01" value="${ref.fidelity ?? 0.6}">
                        </div>
                    </div>

                    <!-- Remove Button -->
                    <button type="button" class="st-chatu8-btn danger char-ref-remove-btn" data-index="${i}" 
                            style="align-self: flex-start;">
                        <i class="fa-solid fa-trash"></i> 移除
                    </button>
                </div>
            </div>
        `;

        slotsContainer.appendChild(slotDiv);
    }

    // Bind events for all controls (will implement in next tasks)
    bindCharRefSlotEvents(slotsContainer, groupSelect, addRefBtn);

    console.log('[CharRef] Rendered', refCount, 'reference slots');
}


/**
 * Show image library selector dialog
 * Displays all stored character reference images and allows selection
 * 
 * @param {Function} onSelect - Callback function called with selected imageId
 */
async function showCharRefImageLibrary(onSelect) {
    const parent = document.getElementById('st-chatu8-settings') || document.body;
    const settings = extension_settings[extensionName];
    ensureCharRefPresets();
    const charRefPresets = settings.charRefPresets || {};

    // Pagination state
    let currentPage = 1;
    let pageSize = 12; // Default page size
    let filteredPresets = []; // Filtered preset names
    let searchQuery = '';

    // Create backdrop
    const backdrop = document.createElement('div');
    backdrop.className = 'st-chatu8-workflow-viz-backdrop';

    // Build dialog HTML structure with pagination
    backdrop.innerHTML = `
        <div class="st-chatu8-workflow-viz-dialog st-chatu8-vibe-visual-selector-dialog">
            <div class="st-chatu8-workflow-viz-header">
                <h3>选择角色参考图</h3>
                <span class="st-chatu8-workflow-viz-close">&times;</span>
            </div>
            <div class="st-chatu8-workflow-viz-toolbar" style="justify-content: space-between; align-items: center; gap: 15px; padding: 12px 20px; background: rgba(30, 30, 46, 0.6); border-bottom: 1px solid rgba(255,255,255,0.05);">
                <div class="st-chatu8-viz-search-container" style="position: relative; flex-grow: 1; max-width: 300px;">
                    <i class="fa-solid fa-search" style="position: absolute; left: 12px; top: 50%; transform: translateY(-50%); color: #aaa; pointer-events: none;"></i>
                    <input type="text" class="st-chatu8-viz-search-input" placeholder="搜索参考图..." style="width: 100%; padding: 8px 12px 8px 36px; background: rgba(0,0,0,0.2); border: 1px solid rgba(255,255,255,0.1); border-radius: 20px; color: white; outline: none; transition: all 0.3s;">
                </div>
            </div>
            <div class="st-chatu8-pagination-container">
                <button class="st-chatu8-pagination-btn st-chatu8-pagination-prev" title="上一页">
                    <i class="fa-solid fa-chevron-left"></i>
                </button>
                <div class="st-chatu8-pagination-info">
                    <span class="st-chatu8-pagination-current">1</span>
                    <span>/</span>
                    <span class="st-chatu8-pagination-total">1</span>
                    <span style="margin-left: 8px; color: #666;">|</span>
                    <span style="margin-left: 8px;">共 <span class="st-chatu8-pagination-count">0</span> 个</span>
                </div>
                <button class="st-chatu8-pagination-btn st-chatu8-pagination-next" title="下一页">
                    <i class="fa-solid fa-chevron-right"></i>
                </button>
                <div class="st-chatu8-pagination-size-container">
                    <span class="st-chatu8-pagination-size-label">每页</span>
                    <select class="st-chatu8-pagination-size">
                        <option value="8">8</option>
                        <option value="12" selected>12</option>
                        <option value="16">16</option>
                        <option value="24">24</option>
                    </select>
                </div>
            </div>
            <div class="st-chatu8-workflow-viz-body">
                <div class="st-chatu8-vibe-visual-selector-grid">
                    <!-- Character reference cards will be inserted here -->
                </div>
            </div>
        </div>
    `;

    parent.appendChild(backdrop);

    // Bind close events
    const closeBtn = backdrop.querySelector('.st-chatu8-workflow-viz-close');
    closeBtn.onclick = () => parent.removeChild(backdrop);
    backdrop.onclick = (e) => {
        if (e.target === backdrop) {
            parent.removeChild(backdrop);
        }
    };

    const gridContainer = backdrop.querySelector('.st-chatu8-vibe-visual-selector-grid');
    const searchInput = backdrop.querySelector('.st-chatu8-viz-search-input');
    const paginationPrev = backdrop.querySelector('.st-chatu8-pagination-prev');
    const paginationNext = backdrop.querySelector('.st-chatu8-pagination-next');
    const paginationCurrent = backdrop.querySelector('.st-chatu8-pagination-current');
    const paginationTotal = backdrop.querySelector('.st-chatu8-pagination-total');
    const paginationCount = backdrop.querySelector('.st-chatu8-pagination-count');
    const paginationSizeSelect = backdrop.querySelector('.st-chatu8-pagination-size');

    // Get all preset names with images (sorted)
    const allPresetNames = Object.keys(charRefPresets)
        .filter(name => charRefPresets[name].imageId) // Only include presets with images
        .sort((a, b) => {
            // Sort alphabetically, but keep "默认" at the top
            if (a === "默认") return -1;
            if (b === "默认") return 1;
            return a.localeCompare(b, 'zh-CN');
        });

    // Update filtered presets based on search query
    function updateFilteredPresets() {
        if (searchQuery) {
            filteredPresets = allPresetNames.filter(name =>
                name.toLowerCase().includes(searchQuery)
            );
        } else {
            filteredPresets = [...allPresetNames];
        }
    }

    // Update pagination UI
    function updatePaginationUI() {
        const totalPages = Math.ceil(filteredPresets.length / pageSize) || 1;
        paginationCurrent.textContent = currentPage;
        paginationTotal.textContent = totalPages;
        paginationCount.textContent = filteredPresets.length;

        // Update button states
        paginationPrev.disabled = currentPage <= 1;
        paginationPrev.style.opacity = currentPage <= 1 ? '0.5' : '1';
        paginationPrev.style.cursor = currentPage <= 1 ? 'not-allowed' : 'pointer';

        paginationNext.disabled = currentPage >= totalPages;
        paginationNext.style.opacity = currentPage >= totalPages ? '0.5' : '1';
        paginationNext.style.cursor = currentPage >= totalPages ? 'not-allowed' : 'pointer';
    }

    // Render current page
    async function renderCurrentPage() {
        // Add transition animation
        gridContainer.style.opacity = '0';
        gridContainer.style.transform = 'translateY(10px)';

        await new Promise(resolve => setTimeout(resolve, 150));

        gridContainer.innerHTML = '';

        // Check if there are any presets
        if (filteredPresets.length === 0) {
            gridContainer.innerHTML = `
                <div style="
                    grid-column: 1 / -1;
                    text-align: center;
                    padding: 3rem;
                    color: rgba(255, 255, 255, 0.5);
                ">
                    <i class="fa-solid fa-inbox" style="font-size: 3rem; margin-bottom: 1rem; display: block;"></i>
                    <p>${searchQuery ? '没有找到匹配的参考图' : '图片库为空'}</p>
                    <p style="font-size: 0.9rem; margin-top: 0.5rem;">${searchQuery ? '请尝试其他搜索词' : '请先上传一些角色参考图'}</p>
                </div>
            `;
            updatePaginationUI();
            gridContainer.style.transition = 'opacity 0.3s ease, transform 0.3s ease';
            gridContainer.style.opacity = '1';
            gridContainer.style.transform = 'translateY(0)';
            return;
        }

        const startIndex = (currentPage - 1) * pageSize;
        const endIndex = startIndex + pageSize;
        const pagePresets = filteredPresets.slice(startIndex, endIndex);

        // Display character reference cards for current page
        for (const presetName of pagePresets) {
            const preset = charRefPresets[presetName];

            // Create card element
            const card = document.createElement('div');
            card.className = 'st-chatu8-vibe-card';

            // Create thumbnail container
            const thumbnailDiv = document.createElement('div');
            thumbnailDiv.className = 'st-chatu8-vibe-card-thumbnail';

            // Load image from configDatabase
            try {
                const imageData = await getConfigImage(preset.imageId);
                if (imageData) {
                    const img = document.createElement('img');
                    img.src = imageData;
                    img.alt = presetName;
                    thumbnailDiv.appendChild(img);
                } else {
                    // Show placeholder if no image
                    thumbnailDiv.innerHTML = `
                        <div class="st-chatu8-vibe-card-placeholder">
                            <i class="fa-solid fa-image"></i>
                            <div>无图像</div>
                        </div>
                    `;
                }
            } catch (error) {
                // Show error placeholder
                thumbnailDiv.innerHTML = `
                    <div class="st-chatu8-vibe-card-error">
                        <i class="fa-solid fa-exclamation-triangle"></i>
                        <div>加载失败</div>
                    </div>
                `;
                thumbnailDiv.title = `加载失败: ${error.message}`;
                console.error('[CharRef] Failed to load image:', preset.imageId, error);
            }

            // Create info section
            const infoDiv = document.createElement('div');
            infoDiv.className = 'st-chatu8-vibe-card-info';

            // Preset name
            const nameDiv = document.createElement('div');
            nameDiv.className = 'st-chatu8-vibe-card-name';
            nameDiv.textContent = presetName;

            infoDiv.appendChild(nameDiv);

            // Assemble card
            card.appendChild(thumbnailDiv);
            card.appendChild(infoDiv);

            // Add click handler to select image
            card.onclick = () => {
                // Call onSelect callback with imageId
                onSelect(preset.imageId);

                // Close dialog
                parent.removeChild(backdrop);

                console.log('[CharRef] Selected image:', presetName, preset.imageId);
            };

            gridContainer.appendChild(card);
        }

        // Apply transition
        gridContainer.style.transition = 'opacity 0.3s ease, transform 0.3s ease';
        gridContainer.style.opacity = '1';
        gridContainer.style.transform = 'translateY(0)';

        updatePaginationUI();
    }

    // Search input handler
    searchInput.addEventListener('input', (e) => {
        searchQuery = e.target.value.toLowerCase();
        currentPage = 1; // Reset to first page
        updateFilteredPresets();
        renderCurrentPage();
    });

    // Pagination handlers
    paginationPrev.onclick = () => {
        if (currentPage > 1) {
            currentPage--;
            renderCurrentPage();
        }
    };

    paginationNext.onclick = () => {
        const totalPages = Math.ceil(filteredPresets.length / pageSize) || 1;
        if (currentPage < totalPages) {
            currentPage++;
            renderCurrentPage();
        }
    };

    paginationSizeSelect.onchange = (e) => {
        pageSize = parseInt(e.target.value);
        currentPage = 1; // Reset to first page
        renderCurrentPage();
    };

    // Initial render
    updateFilteredPresets();
    renderCurrentPage();
}

/**
 * Add reference to current group
 * 
 * @param {HTMLSelectElement} groupSelect - The group selector element
 * @param {HTMLElement} slotsContainer - The slots container element
 * @param {HTMLButtonElement} addRefBtn - The add reference button
 * @param {HTMLElement} statusDiv - The status message div
 */
function addCharRefToGroup(groupSelect, slotsContainer, addRefBtn, statusDiv) {
    const settings = extension_settings[extensionName];
    const charRefGroups = settings.charRefGroups || {};
    const currentGroupId = groupSelect.value;
    const currentGroup = charRefGroups[currentGroupId];

    if (!currentGroup) {
        showCharRefStatus(statusDiv, '错误: 未选择组。请先选择或创建一个组。', 'error');
        console.error('[CharRef] No group selected when attempting to add reference');
        return;
    }

    const references = currentGroup.references || [];
    if (references.length >= 4) {
        showCharRefStatus(statusDiv, '已达到最大数量 (4个)。每个组最多可包含 4 个角色参考。', 'error');
        console.warn('[CharRef] Maximum reference limit reached for group:', currentGroupId);
        return;
    }

    // Open image library selector
    try {
        showCharRefImageLibrary((imageId) => {
            try {
                // Validate imageId
                if (!imageId || typeof imageId !== 'string') {
                    showCharRefStatus(statusDiv, '错误: 无效的图片 ID', 'error');
                    console.error('[CharRef] Invalid imageId received:', imageId);
                    return;
                }

                // Add reference to group with default values
                currentGroup.references.push({
                    imageId: imageId,
                    type: 'character',
                    strength: 0.6,
                    fidelity: 0.6
                });

                // Update timestamp
                currentGroup.updatedAt = Date.now();

                // Save settings with error handling
                try {
                    saveSettingsDebounced();
                } catch (error) {
                    console.error('[CharRef] Failed to save settings after adding reference:', {
                        imageId: imageId.substring(0, 12) + '...',
                        error: error.message,
                        errorName: error.name,
                        groupId: currentGroupId,
                        timestamp: new Date().toISOString(),
                        stack: error.stack
                    });
                    showCharRefStatus(statusDiv, `错误: 保存设置失败 - ${error.message}`, 'error');
                    return;
                }

                // Re-render slots
                renderCharRefSlots(slotsContainer, groupSelect, addRefBtn);

                showCharRefStatus(statusDiv, '角色参考已成功添加到组', 'success');
                console.log('[CharRef] Successfully added reference to group:', currentGroupId, imageId);
            } catch (error) {
                console.error('[CharRef] Error adding reference to group:', {
                    error: error.message,
                    errorName: error.name,
                    groupId: currentGroupId,
                    timestamp: new Date().toISOString(),
                    stack: error.stack
                });
                showCharRefStatus(statusDiv, `错误: 添加角色参考失败 - ${error.message}`, 'error');
            }
        });
    } catch (error) {
        console.error('[CharRef] Error opening image library:', {
            error: error.message,
            errorName: error.name,
            timestamp: new Date().toISOString(),
            stack: error.stack
        });
        showCharRefStatus(statusDiv, `错误: 无法打开图片库 - ${error.message}`, 'error');
    }
}

/**
 * Remove reference from current group
 * 
 * @param {number} index - The index of the reference to remove
 * @param {HTMLSelectElement} groupSelect - The group selector element
 * @param {HTMLElement} slotsContainer - The slots container element
 * @param {HTMLButtonElement} addRefBtn - The add reference button
 * @param {HTMLElement} statusDiv - The status message div
 */
async function removeCharRefFromGroup(index, groupSelect, slotsContainer, addRefBtn, statusDiv) {
    const settings = extension_settings[extensionName];
    const charRefGroups = settings.charRefGroups || {};
    const currentGroupId = groupSelect.value;
    const currentGroup = charRefGroups[currentGroupId];

    if (!currentGroup || !Array.isArray(currentGroup.references)) {
        showCharRefStatus(statusDiv, '错误: 组数据无效', 'error');
        return;
    }

    if (index < 0 || index >= currentGroup.references.length) {
        showCharRefStatus(statusDiv, '错误: 无效的索引', 'error');
        return;
    }

    // Confirm deletion
    const confirmed = confirm('确定要移除这个角色参考吗？');
    if (!confirmed) {
        return;
    }

    const ref = currentGroup.references[index];

    // Remove from array
    currentGroup.references.splice(index, 1);

    // Update timestamp
    currentGroup.updatedAt = Date.now();

    // Save settings
    try {
        saveSettingsDebounced();
    } catch (error) {
        console.error('[CharRef] Failed to save settings after removing reference:', error);
        showCharRefStatus(statusDiv, `错误: 保存设置失败 - ${error.message}`, 'error');
        return;
    }

    // Note: We don't delete the image from configDatabase here because
    // it might be used in other groups. Image cleanup should be done
    // when deleting a group or through a separate cleanup function.

    // Re-render slots
    await renderCharRefSlots(slotsContainer, groupSelect, addRefBtn);

    showCharRefStatus(statusDiv, '角色参考已移除', 'success');
    console.log('[CharRef] Removed reference at index:', index);
}


/**
 * Bind events for all slot controls
 * 
 * @param {HTMLElement} slotsContainer - The slots container element
 * @param {HTMLSelectElement} groupSelect - The group selector element
 * @param {HTMLButtonElement} addRefBtn - The add reference button
 */
function bindCharRefSlotEvents(slotsContainer, groupSelect, addRefBtn) {
    const settings = extension_settings[extensionName];
    const charRefGroups = settings.charRefGroups || {};
    const currentGroupId = groupSelect.value;
    const currentGroup = charRefGroups[currentGroupId];
    const statusDiv = document.getElementById('char-ref-group-status');

    if (!currentGroup) return;

    // Bind type dropdown change events
    const typeSelects = slotsContainer.querySelectorAll('.char-ref-type-select');
    typeSelects.forEach(select => {
        select.onchange = (e) => {
            const index = parseInt(e.target.dataset.index);
            const newType = e.target.value;

            if (currentGroup.references[index]) {
                currentGroup.references[index].type = newType;
                currentGroup.updatedAt = Date.now();

                try {
                    saveSettingsDebounced();
                    console.log('[CharRef] Updated reference type:', index, newType);
                } catch (error) {
                    console.error('[CharRef] Failed to save after type change:', error);
                    showCharRefStatus(statusDiv, `保存失败: ${error.message}`, 'error');
                }
            }
        };
    });

    // Bind strength slider events
    const strengthRanges = slotsContainer.querySelectorAll('.char-ref-strength-range');
    const strengthInputs = slotsContainer.querySelectorAll('.char-ref-strength-input');

    strengthRanges.forEach(range => {
        range.oninput = (e) => {
            const index = parseInt(e.target.dataset.index);
            const value = parseFloat(e.target.value);

            // Update display
            const valueSpan = document.getElementById(`char-ref-strength-val-${index}`);
            if (valueSpan) valueSpan.textContent = value.toFixed(2);

            // Update corresponding number input
            const numberInput = document.getElementById(`char-ref-strength-${index}`);
            if (numberInput) numberInput.value = value;

            // Update settings
            if (currentGroup.references[index]) {
                currentGroup.references[index].strength = value;
                currentGroup.updatedAt = Date.now();

                try {
                    saveSettingsDebounced();
                } catch (error) {
                    console.error('[CharRef] Failed to save after strength change:', error);
                }
            }
        };
    });

    strengthInputs.forEach(input => {
        input.oninput = (e) => {
            const index = parseInt(e.target.dataset.index);
            const value = parseFloat(e.target.value);

            // Clamp value to minimum of 0
            const clampedValue = Math.max(0, value);

            // Update display
            const valueSpan = document.getElementById(`char-ref-strength-val-${index}`);
            if (valueSpan) valueSpan.textContent = clampedValue.toFixed(2);

            // Update corresponding range input
            const rangeInput = document.getElementById(`char-ref-strength-range-${index}`);
            if (rangeInput) rangeInput.value = clampedValue;

            // Update settings
            if (currentGroup.references[index]) {
                currentGroup.references[index].strength = clampedValue;
                currentGroup.updatedAt = Date.now();

                try {
                    saveSettingsDebounced();
                } catch (error) {
                    console.error('[CharRef] Failed to save after strength change:', error);
                }
            }
        };
    });

    // Bind fidelity slider events
    const fidelityRanges = slotsContainer.querySelectorAll('.char-ref-fidelity-range');
    const fidelityInputs = slotsContainer.querySelectorAll('.char-ref-fidelity-input');

    fidelityRanges.forEach(range => {
        range.oninput = (e) => {
            const index = parseInt(e.target.dataset.index);
            const value = parseFloat(e.target.value);

            // Update display
            const valueSpan = document.getElementById(`char-ref-fidelity-val-${index}`);
            if (valueSpan) valueSpan.textContent = value.toFixed(2);

            // Update corresponding number input
            const numberInput = document.getElementById(`char-ref-fidelity-${index}`);
            if (numberInput) numberInput.value = value;

            // Update settings
            if (currentGroup.references[index]) {
                currentGroup.references[index].fidelity = value;
                currentGroup.updatedAt = Date.now();

                try {
                    saveSettingsDebounced();
                } catch (error) {
                    console.error('[CharRef] Failed to save after fidelity change:', error);
                }
            }
        };
    });

    fidelityInputs.forEach(input => {
        input.oninput = (e) => {
            const index = parseInt(e.target.dataset.index);
            const value = parseFloat(e.target.value);

            // Clamp value to minimum of 0
            const clampedValue = Math.max(0, value);

            // Update display
            const valueSpan = document.getElementById(`char-ref-fidelity-val-${index}`);
            if (valueSpan) valueSpan.textContent = clampedValue.toFixed(2);

            // Update corresponding range input
            const rangeInput = document.getElementById(`char-ref-fidelity-range-${index}`);
            if (rangeInput) rangeInput.value = clampedValue;

            // Update settings
            if (currentGroup.references[index]) {
                currentGroup.references[index].fidelity = clampedValue;
                currentGroup.updatedAt = Date.now();

                try {
                    saveSettingsDebounced();
                } catch (error) {
                    console.error('[CharRef] Failed to save after fidelity change:', error);
                }
            }
        };
    });

    // Bind remove button events
    const removeButtons = slotsContainer.querySelectorAll('.char-ref-remove-btn');
    removeButtons.forEach(button => {
        button.onclick = (e) => {
            const index = parseInt(e.target.closest('.char-ref-remove-btn').dataset.index);
            removeCharRefFromGroup(index, groupSelect, slotsContainer, addRefBtn, statusDiv);
        };
    });
}


/**
 * Initialize Character Reference Group Editor
 * Sets up event handlers and UI integration
 * 
 * @param {jQuery} settingsModal - The settings modal jQuery object
 */
export function initCharRefGroupEditor(settingsModal) {
    // Ensure storage structures exist
    ensureCharRefGroups();
    ensureCharRefPresets();

    // Bind upload button click handler
    const charRefUploadBtn = settingsModal.find('#novelai-char-ref-upload-btn');
    if (charRefUploadBtn.length) {
        charRefUploadBtn.on('click', () => {
            showCharRefUploadDialog();
        });
    }

    // Bind group editor button click handler
    const charRefGroupEditorBtn = settingsModal.find('#novelai-char-ref-group-editor-btn');
    if (charRefGroupEditorBtn.length) {
        charRefGroupEditorBtn.on('click', () => {
            showCharRefGroupEditorDialog();
        });
    }
}
