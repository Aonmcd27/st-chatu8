// @ts-nocheck
/**
 * 角色预设管理模块
 * 处理角色相关的 CRUD 操作和导入导出
 */

import { extension_settings } from "../../../../../../extensions.js";
import { saveSettingsDebounced, eventSource } from "../../../../../../../script.js";
import { extensionName, EventType } from '../../config.js';
import { stylInput, stylishConfirm } from '../../ui_common.js';
import { getContext } from "../../../../../../st-context.js";
import { encryptExportData, decryptImportData } from './crypto.js';
import { loadOutfitPresetList } from './outfitPreset.js';
import { getConfigImage, saveConfigImage, deleteConfigImage } from '../../configDatabase.js';
import { handleCharacterPromptModify } from '../../characterPromptModify.js';
import { handlePhotoGeneratePromptClick } from '../../imagePromptGen.js';
import { translatePromptTags } from '../../ai.js';
import { showCharacterVisualSelector } from './characterVisualSelector.js';
import { calculateNovelAITokens } from '../../novelaiTokenCalculator.js';

// ========== Module-level state for image generation ==========

/**
 * 活动的角色图片生成请求映射表
 * 键: requestId, 值: { listener, timestamp }
 * 用于跟踪和管理多个并发的图片生成请求
 */
const activePhotoRequests = new Map();

/**
 * 角色预设的所有可编辑字段列表
 * 用于字段监听、加载、保存等操作，确保所有函数使用一致的字段列表
 */
const CHARACTER_FIELDS = [
    'nameCN',
    'nameEN',
    'characterTraits',
    'facialFeatures',
    'facialFeaturesBack',
    'upperBodySFW',
    'upperBodySFWBack',
    'fullBodySFW',
    'fullBodySFWBack',
    'upperBodyNSFW',
    'upperBodyNSFWBack',
    'fullBodyNSFW',
    'fullBodyNSFWBack',
    'negative'
];

// ========== 角色预设管理 ==========

/**
 * 设置角色控件
 */
export function setupCharacterControls(container) {
    const settings = extension_settings[extensionName];

    // 加载预设列表
    loadCharacterPresetList();

    // 绑定预设选择
    container.find('#character_preset_id').on('change', loadCharacterPreset);

    // 绑定按钮
    container.find('#character_new').on('click', createNewCharacterPreset);
    container.find('#character_rename').on('click', renameCharacterPreset);
    container.find('#character_update').on('click', updateCharacterPreset);
    container.find('#character_save_as').on('click', saveCharacterPresetAs);
    container.find('#character_export').on('click', exportCharacterPreset);
    container.find('#character_export_all').on('click', exportAllCharacterPresets);
    container.find('#character_import').on('click', importCharacterPreset);
    container.find('#character_delete').on('click', deleteCharacterPreset);
    container.find('#character_visual_select').on('click', handleCharacterVisualSelect);

    // 绑定服装相关按钮
    container.find('#char_outfit_check').on('click', checkCharacterOutfitList);
    container.find('#char_outfit_add').on('click', addOutfitFromSelector);
    container.find('#char_outfit_refresh').on('click', loadCharacterOutfitSelector);

    // 绑定翻译按钮
    container.find('#char_translate').on('click', translateCharacterFields);
    container.find('#char_photo_prompt_translate').on('click', translatePhotoPrompt);

    // 绑定清空详细参数按钮
    container.find('#char_clear_details').on('click', clearCharacterDetailParameters);

    // 绑定角色照片相关按钮
    container.find('#char_photo_generate').on('click', handlePhotoGenerate);
    container.find('#char_photo_generate_prompt').on('click', handlePhotoGeneratePrompt);
    container.find('#char_photo_modify_character_prompt').on('click', handlePhotoModifyCharacterPrompt);
    container.find('#char_photo_character_data').on('click', handleCharacterData);

    // 绑定角色照片上传按钮
    container.find('#char_photo_upload').on('click', () => {
        document.getElementById('char_photo_upload_input')?.click();
    });
    container.find('#char_photo_upload_input').on('change', handleCharacterPhotoUpload);

    // 绑定发送图片复选框变化事件
    container.find('#char_send_photo').on('change', function () {
        const settings = extension_settings[extensionName];
        const presetId = settings.characterPresetId;
        if (presetId && settings.characterPresets[presetId]) {
            settings.characterPresets[presetId].sendPhoto = this.checked;
            saveSettingsDebounced();
            console.log('[characterPreset] 已保存角色发送图片设置:', this.checked);
        }
    });

    // 绑定字段变化监听
    bindCharacterFieldListeners();

    // 加载当前预设
    loadCharacterPreset();
}

export function loadCharacterPresetList() {
    const settings = extension_settings[extensionName];
    const select = document.getElementById('character_preset_id');

    if (!select) return;

    select.innerHTML = '';

    // 获取预设名称并按中文拼音排序
    const sortedPresetNames = Object.keys(settings.characterPresets).sort((a, b) =>
        a.localeCompare(b, 'zh-CN', { sensitivity: 'base' })
    );

    for (const presetName of sortedPresetNames) {
        const option = document.createElement('option');
        option.value = presetName;
        option.textContent = presetName;
        select.add(option);
    }

    select.value = settings.characterPresetId;
}

export function loadCharacterPreset() {
    const settings = extension_settings[extensionName];
    const select = document.getElementById('character_preset_id');
    if (!select) return;

    const newPresetId = select.value;
    const currentPresetId = settings.characterPresetId;

    // 检查是否有未保存的更改
    if (currentPresetId && currentPresetId !== newPresetId) {
        const currentPreset = settings.characterPresets[currentPresetId] || {};

        let isDirty = false;
        for (const field of CHARACTER_FIELDS) {
            const element = document.getElementById(`char_${field}`);
            if (element && element.value !== (currentPreset[field] || '')) {
                isDirty = true;
                break;
            }
        }

        if (isDirty) {
            stylishConfirm("您有未保存的角色数据。要放弃这些更改并切换预设吗？").then(confirmed => {
                if (confirmed) {
                    settings.characterPresetId = newPresetId;
                    loadCharacterPresetData(newPresetId);
                    saveSettingsDebounced();
                } else {
                    select.value = currentPresetId;
                }
            });
            return;
        }
    }

    settings.characterPresetId = newPresetId;
    loadCharacterPresetData(newPresetId);
    saveSettingsDebounced();
}

export function loadCharacterPresetData(presetId) {
    const settings = extension_settings[extensionName];
    const preset = settings.characterPresets[presetId];

    if (!preset) return;

    CHARACTER_FIELDS.forEach(field => {
        const element = document.getElementById(`char_${field}`);
        if (element) {
            element.value = preset[field] || '';
            // 隐藏未保存警告
            const warning = element.closest('.st-chatu8-field-col')?.querySelector('.st-chatu8-unsaved-warning');
            if (warning) $(warning).hide();
        }
    });

    // 加载服装列表
    const outfitListElement = document.getElementById('char_outfit_list');
    if (outfitListElement) {
        outfitListElement.value = (preset.outfits || []).join('\n');
    }

    // 加载是否发送图片设置
    const sendPhotoElement = document.getElementById('char_send_photo');
    if (sendPhotoElement) {
        sendPhotoElement.checked = preset.sendPhoto === true; // 默认为 false
    }

    // 加载角色照片和提示词
    loadCharacterPhoto(preset);

    // 加载服装选择器
    loadCharacterOutfitSelector();

    // 初始计算 token 占用
    debouncedUpdateTokenCounts();
}

function updateCharacterPreset() {
    const settings = extension_settings[extensionName];
    const presetId = settings.characterPresetId;

    if (!presetId || !settings.characterPresets[presetId]) {
        toastr.warning('没有活动的角色预设可保存。请先"另存为"一个新预设。');
        return;
    }

    // 直接保存，不弹确认框
    saveCurrentCharacterData(presetId);

    // 保存后隐藏所有字段的未保存警告
    CHARACTER_FIELDS.forEach(field => {
        const element = document.getElementById(`char_${field}`);
        if (element) {
            const warning = element.closest('.st-chatu8-field-col')?.querySelector('.st-chatu8-unsaved-warning');
            if (warning) $(warning).hide();
        }
    });

    toastr.success(`角色预设 "${presetId}" 已保存`);
}

function saveCharacterPresetAs() {
    // 获取当前角色卡名称作为前缀
    const stContext = getContext();
    const cardPrefix = stContext?.name2 ? `[${stContext.name2}]` : '';
    const defaultName = cardPrefix || '';

    stylInput("请输入新角色预设的名称", defaultName).then((result) => {
        if (result && result.trim() !== '') {
            const settings = extension_settings[extensionName];
            saveCurrentCharacterData(result);
            settings.characterPresetId = result;
            loadCharacterPresetList();
            alert(`角色预设 "${result}" 已保存。`);
        }
    });
}

function createNewCharacterPreset() {
    // 获取当前角色卡名称作为前缀
    const stContext = getContext();
    const cardPrefix = stContext?.name2 ? `[${stContext.name2}]` : '';
    const defaultName = cardPrefix || '';

    stylInput("请输入新角色预设的名称", defaultName).then((result) => {
        if (result && result.trim() !== '') {
            const settings = extension_settings[extensionName];

            // 检查名称是否已存在
            if (settings.characterPresets[result]) {
                alert(`角色预设 "${result}" 已存在，请使用其他名称。`);
                return;
            }

            // 创建空白预设数据 - 使用 CHARACTER_FIELDS 动态生成
            const emptyPreset = {};

            // 为所有字段设置空字符串
            CHARACTER_FIELDS.forEach(field => {
                emptyPreset[field] = "";
            });

            // 添加其他非字段属性
            emptyPreset.outfits = [];
            emptyPreset.photoImageIds = [];
            emptyPreset.photoPrompt = "";
            emptyPreset.sendPhoto = false;
            emptyPreset.generationContext = "";
            emptyPreset.generationWorldBook = "";
            emptyPreset.generationVariables = {};

            // 保存空白预设
            settings.characterPresets[result] = emptyPreset;
            settings.characterPresetId = result;
            saveSettingsDebounced();

            // 刷新界面
            loadCharacterPresetList();
            loadCharacterPresetData(result);

            toastr.success(`空白角色预设 "${result}" 已创建。`);
        }
    });
}

function renameCharacterPreset() {
    const settings = extension_settings[extensionName];
    const currentName = settings.characterPresetId;
    if (!currentName || !settings.characterPresets[currentName]) {
        alert("没有活动的角色预设可重命名。");
        return;
    }
    if (currentName === "默认角色") {
        alert("默认预设不能重命名。");
        return;
    }
    
    stylInput("请输入新的角色预设名称", currentName).then((newName) => {
        if (newName && newName.trim() !== '' && newName !== currentName) {
            if (settings.characterPresets[newName]) {
                alert("该名称已存在，请换一个名称。");
                return;
            }
            
            settings.characterPresets[newName] = settings.characterPresets[currentName];
            delete settings.characterPresets[currentName];
            
            settings.characterPresetId = newName;
            
            saveSettingsDebounced();
            loadCharacterPresetList();
            
            try {
                if (typeof window.loadSilterTavernChatu8Settings === 'function') {
                    window.loadSilterTavernChatu8Settings();
                }
            } catch (error) {
                console.warn('Failed to refresh UI after renaming preset:', error);
            }
            toastr.success(`角色预设已重命名为 "${newName}"`);
        }
    });
}

function saveCurrentCharacterData(presetId) {
    const settings = extension_settings[extensionName];
    const preset = {};

    // 保存所有字段
    CHARACTER_FIELDS.forEach(field => {
        const element = document.getElementById(`char_${field}`);
        if (element) {
            preset[field] = element.value || '';
        }
    });

    // 保存服装列表
    const outfitListElement = document.getElementById('char_outfit_list');
    if (outfitListElement) {
        preset.outfits = outfitListElement.value
            .split('\n')
            .map(line => line.trim())
            .filter(line => line.length > 0);
    } else {
        preset.outfits = [];
    }

    // 保存角色照片提示词
    const photoPromptElement = document.getElementById('char_photo_prompt');
    if (photoPromptElement) {
        preset.photoPrompt = photoPromptElement.value || '';
    }

    // 保存是否发送图片设置
    const sendPhotoElement = document.getElementById('char_send_photo');
    if (sendPhotoElement) {
        preset.sendPhoto = sendPhotoElement.checked;
    }

    // 保留现有的照片 ID 数组（照片是通过生成功能保存的）
    const existingPreset = settings.characterPresets[presetId] || {};
    preset.photoImageIds = existingPreset.photoImageIds || [];

    // 保留现有的生成元数据（上下文、世界书触发、变量）
    preset.generationContext = existingPreset.generationContext || '';
    preset.generationWorldBook = existingPreset.generationWorldBook || '';
    preset.generationVariables = existingPreset.generationVariables || {};

    settings.characterPresets[presetId] = preset;
    saveSettingsDebounced();
}

function deleteCharacterPreset() {
    const settings = extension_settings[extensionName];
    const presetId = document.getElementById('character_preset_id')?.value;

    if (presetId === "默认角色") {
        alert("默认预设不能删除");
        return;
    }

    stylishConfirm("是否确定删除该角色预设").then((result) => {
        if (result) {
            delete settings.characterPresets[presetId];
            settings.characterPresetId = "默认角色";
            loadCharacterPresetList();
            loadCharacterPreset();
            saveSettingsDebounced();
        }
    });
}

/**
 * Format outfit list for display in confirmation dialog
 * @param {Array<string>} outfits - Array of outfit names
 * @param {number} threshold - Maximum number of outfits to display individually (default: 10)
 * @returns {string} Formatted outfit display string
 */
function formatOutfitListForDialog(outfits, threshold = 10) {
    // Handle edge cases
    if (!outfits || !Array.isArray(outfits) || outfits.length === 0) {
        return '';
    }

    // Validate threshold
    if (typeof threshold !== 'number' || threshold <= 0) {
        threshold = 10;
    }

    // Return formatted string based on outfit count vs threshold
    if (outfits.length <= threshold) {
        // Full list: show each outfit name on a separate line
        return ':\n' + outfits.join('\n');
    } else {
        // Summary: show count only
        return ` (共 ${outfits.length} 个服装)`;
    }
}

async function exportCharacterPreset() {
    const settings = extension_settings[extensionName];
    const presetId = settings.characterPresetId;
    const preset = settings.characterPresets[presetId];

    if (!preset) {
        alert("没有选中的角色预设可导出。");
        return;
    }

    // 检查是否有关联的服装列表
    const relatedOutfits = preset.outfits || [];

    let dataToExport = {
        characters: { [presetId]: preset }
    };

    // 如果有关联服装,询问用户是否一起导出
    if (relatedOutfits.length > 0) {
        const outfitDisplay = formatOutfitListForDialog(relatedOutfits);
        const confirmMessage = `检测到该角色包含 ${relatedOutfits.length} 个服装${outfitDisplay}\n\n是否一起导出相关服装?`;
        const includeOutfits = await stylishConfirm(confirmMessage);

        if (includeOutfits) {
            dataToExport.outfits = {};
            relatedOutfits.forEach(outfitName => {
                if (settings.outfitPresets[outfitName]) {
                    dataToExport.outfits[outfitName] = settings.outfitPresets[outfitName];
                }
            });
        }
    }

    // 收集并导出图片数据
    const imageIdsToExport = new Set();

    // 收集角色图片
    if (preset.photoImageIds && preset.photoImageIds.length > 0) {
        preset.photoImageIds.forEach(id => imageIdsToExport.add(id));
    }

    // 收集服装图片（如果导出了服装）
    if (dataToExport.outfits) {
        for (const outfitName in dataToExport.outfits) {
            const outfit = dataToExport.outfits[outfitName];
            if (outfit.photoImageIds && outfit.photoImageIds.length > 0) {
                outfit.photoImageIds.forEach(id => imageIdsToExport.add(id));
            }
        }
    }

    // 获取图片数据
    if (imageIdsToExport.size > 0) {
        dataToExport.images = {};
        for (const imageId of imageIdsToExport) {
            try {
                const imageData = await getConfigImage(imageId);
                if (imageData) {
                    dataToExport.images[imageId] = imageData;
                }
            } catch (error) {
                console.error(`[CharacterPreset] 获取图片 ${imageId} 失败:`, error);
            }
        }
        console.log(`[CharacterPreset] 导出 ${Object.keys(dataToExport.images).length} 张图片`);
    }

    // 使用统一的加密导出函数
    dataToExport = await encryptExportData(dataToExport);

    const dataStr = JSON.stringify(dataToExport, null, 2);
    const blob = new Blob([dataStr], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `st-chatu8-角色-${presetId}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

async function exportAllCharacterPresets() {
    const settings = extension_settings[extensionName];
    if (!settings.characterPresets || Object.keys(settings.characterPresets).length === 0) {
        alert("没有角色预设可导出。");
        return;
    }

    // 收集所有角色和关联的服装
    const allOutfits = new Set();

    for (const charName in settings.characterPresets) {
        const charPreset = settings.characterPresets[charName];
        const charOutfits = charPreset.outfits || [];
        charOutfits.forEach(outfitName => allOutfits.add(outfitName));
    }

    let dataToExport = {
        characters: settings.characterPresets
    };

    // 如果有关联服装,询问用户是否一起导出
    if (allOutfits.size > 0) {
        const outfitArray = Array.from(allOutfits);
        const outfitDisplay = formatOutfitListForDialog(outfitArray);
        const confirmMessage = `检测到所有角色共包含 ${allOutfits.size} 个不同的服装${outfitDisplay}\n\n是否一起导出相关服装?`;
        const includeOutfits = await stylishConfirm(confirmMessage);

        if (includeOutfits) {
            dataToExport.outfits = {};
            allOutfits.forEach(outfitName => {
                if (settings.outfitPresets[outfitName]) {
                    dataToExport.outfits[outfitName] = settings.outfitPresets[outfitName];
                }
            });
        }
    }

    // 收集并导出图片数据
    const imageIdsToExport = new Set();

    // 收集所有角色的图片
    for (const charName in settings.characterPresets) {
        const charPreset = settings.characterPresets[charName];
        if (charPreset.photoImageIds && charPreset.photoImageIds.length > 0) {
            charPreset.photoImageIds.forEach(id => imageIdsToExport.add(id));
        }
    }

    // 收集服装图片（如果导出了服装）
    if (dataToExport.outfits) {
        for (const outfitName in dataToExport.outfits) {
            const outfit = dataToExport.outfits[outfitName];
            if (outfit.photoImageIds && outfit.photoImageIds.length > 0) {
                outfit.photoImageIds.forEach(id => imageIdsToExport.add(id));
            }
        }
    }

    // 获取图片数据
    if (imageIdsToExport.size > 0) {
        dataToExport.images = {};
        for (const imageId of imageIdsToExport) {
            try {
                const imageData = await getConfigImage(imageId);
                if (imageData) {
                    dataToExport.images[imageId] = imageData;
                }
            } catch (error) {
                console.error(`[CharacterPreset] 获取图片 ${imageId} 失败:`, error);
            }
        }
        console.log(`[CharacterPreset] 导出全部：共 ${Object.keys(dataToExport.images).length} 张图片`);
    }

    // 使用统一的加密导出函数
    dataToExport = await encryptExportData(dataToExport);

    const dataStr = JSON.stringify(dataToExport, null, 2);
    const blob = new Blob([dataStr], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "st-chatu8-角色-全部.json";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

function importCharacterPreset() {
    const settings = extension_settings[extensionName];
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.onchange = async e => {
        const file = e.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = async readerEvent => {
            try {
                let importedData = JSON.parse(readerEvent.target.result);

                // 自动检测并解密数据
                importedData = decryptImportData(importedData);

                // 检查新格式(包含characters和outfits)或旧格式(直接是预设对象)
                let charactersToImport = {};
                let outfitsToImport = {};
                let imagesToImport = importedData.images || {};

                if (importedData.characters) {
                    // 新格式
                    charactersToImport = importedData.characters;
                    outfitsToImport = importedData.outfits || {};
                } else {
                    // 旧格式,直接是角色预设
                    charactersToImport = importedData;
                }

                // 如果有关联的服装,询问用户是否一起导入
                let importOutfits = false;
                if (Object.keys(outfitsToImport).length > 0) {
                    const outfitNames = Object.keys(outfitsToImport);
                    const confirmMessage = `检测到 ${outfitNames.length} 个相关服装:\n${outfitNames.join('\n')}\n\n是否一起导入?`;
                    importOutfits = await stylishConfirm(confirmMessage);
                }

                // 导入图片（如果有）
                let importedImagesCount = 0;
                const imageIdMapping = {}; // 旧ID -> 新ID 映射

                if (Object.keys(imagesToImport).length > 0) {
                    console.log(`[CharacterPreset] 正在导入 ${Object.keys(imagesToImport).length} 张图片...`);

                    for (const oldImageId in imagesToImport) {
                        try {
                            const imageData = imagesToImport[oldImageId];
                            // 保存图片并获取新的 ID
                            const newImageId = await saveConfigImage(imageData);
                            imageIdMapping[oldImageId] = newImageId;
                            importedImagesCount++;
                        } catch (error) {
                            console.error(`[CharacterPreset] 导入图片 ${oldImageId} 失败:`, error);
                        }
                    }

                    console.log(`[CharacterPreset] 成功导入 ${importedImagesCount} 张图片`);

                    // 更新角色预设中的图片ID引用
                    for (const charName in charactersToImport) {
                        const charPreset = charactersToImport[charName];
                        if (charPreset.photoImageIds && charPreset.photoImageIds.length > 0) {
                            charPreset.photoImageIds = charPreset.photoImageIds.map(oldId =>
                                imageIdMapping[oldId] || oldId
                            );
                        }
                    }

                    // 更新服装预设中的图片ID引用
                    for (const outfitName in outfitsToImport) {
                        const outfitPreset = outfitsToImport[outfitName];
                        if (outfitPreset.photoImageIds && outfitPreset.photoImageIds.length > 0) {
                            outfitPreset.photoImageIds = outfitPreset.photoImageIds.map(oldId =>
                                imageIdMapping[oldId] || oldId
                            );
                        }
                    }
                }

                // 导入角色
                let newCharactersCount = 0;
                for (const key in charactersToImport) {
                    if (charactersToImport.hasOwnProperty(key)) {
                        if (!settings.characterPresets.hasOwnProperty(key)) {
                            newCharactersCount++;
                        }
                        settings.characterPresets[key] = charactersToImport[key];
                    }
                }

                // 导入服装(如果用户确认)
                let newOutfitsCount = 0;
                if (importOutfits) {
                    for (const key in outfitsToImport) {
                        if (outfitsToImport.hasOwnProperty(key)) {
                            if (!settings.outfitPresets.hasOwnProperty(key)) {
                                newOutfitsCount++;
                            }
                            settings.outfitPresets[key] = outfitsToImport[key];
                        }
                    }
                }

                saveSettingsDebounced();
                loadCharacterPresetList();
                if (importOutfits) {
                    loadOutfitPresetList();
                }

                // 自动选择第一个导入的预设
                const firstImportedKey = Object.keys(charactersToImport)[0];
                if (firstImportedKey) {
                    settings.characterPresetId = firstImportedKey;
                    const select = document.getElementById('character_preset_id');
                    if (select) select.value = firstImportedKey;
                    loadCharacterPresetData(firstImportedKey);
                }

                let message = `成功导入 ${Object.keys(charactersToImport).length} 个角色预设，其中 ${newCharactersCount} 个是全新的。`;
                if (importOutfits) {
                    message += `\n同时导入 ${Object.keys(outfitsToImport).length} 个服装预设，其中 ${newOutfitsCount} 个是全新的。`;
                }
                if (importedImagesCount > 0) {
                    message += `\n同时导入 ${importedImagesCount} 张图片。`;
                }
                alert(message);
            } catch (err) {
                alert("导入失败，请确保文件是正确的JSON格式。\n错误信息: " + err.message);
                console.error("Error importing character presets:", err);
            }
        };
        reader.readAsText(file);
    };
    input.click();
}

/**
 * 打开角色预设可视化选择器
 */
function handleCharacterVisualSelect() {
    showCharacterVisualSelector((presetName) => {
        // 选择后更新下拉框
        const select = document.getElementById('character_preset_id');
        if (select) {
            select.value = presetName;
        }
    });
}

export async function updateTokenCounts() {
    let totalTokens = 0;
    const tokenCounts = {};

    const tokenFields = CHARACTER_FIELDS.filter(f => !['nameCN', 'nameEN'].includes(f));

    for (const field of tokenFields) {
        const element = document.getElementById(`char_${field}`);
        if (element) {
            const count = await calculateNovelAITokens(element.value || '');
            tokenCounts[field] = count;
            totalTokens += count;
        } else {
            tokenCounts[field] = 0;
        }
    }

    for (const field of tokenFields) {
        const display = document.getElementById(`char_${field}_tokens`);
        if (display) {
            display.textContent = `当前占用: ${tokenCounts[field] || 0} | 总占用: ${totalTokens}`;
        }
    }

    // 计算 4 种全身组合的 token 总和
    const baseTokens = tokenCounts.characterTraits || 0;
    
    const frontSfw = baseTokens + (tokenCounts.facialFeatures || 0) + (tokenCounts.upperBodySFW || 0) + (tokenCounts.fullBodySFW || 0);
    const frontNsfw = baseTokens + (tokenCounts.facialFeatures || 0) + (tokenCounts.upperBodyNSFW || 0) + (tokenCounts.fullBodyNSFW || 0);
    
    const backSfw = baseTokens + (tokenCounts.facialFeaturesBack || 0) + (tokenCounts.upperBodySFWBack || 0) + (tokenCounts.fullBodySFWBack || 0);
    const backNsfw = baseTokens + (tokenCounts.facialFeaturesBack || 0) + (tokenCounts.upperBodyNSFWBack || 0) + (tokenCounts.fullBodyNSFWBack || 0);

    // 渲染到 DOM
    const elFrontSfw = document.getElementById('token_combo_front_sfw');
    const elFrontNsfw = document.getElementById('token_combo_front_nsfw');
    const elBackSfw = document.getElementById('token_combo_back_sfw');
    const elBackNsfw = document.getElementById('token_combo_back_nsfw');
    
    if (elFrontSfw) elFrontSfw.textContent = `正面 SFW 全身: ${frontSfw}`;
    if (elFrontNsfw) elFrontNsfw.textContent = `正面 NSFW 全身: ${frontNsfw}`;
    if (elBackSfw) elBackSfw.textContent = `背面 SFW 全身: ${backSfw}`;
    if (elBackNsfw) elBackNsfw.textContent = `背面 NSFW 全身: ${backNsfw}`;
}

let tokenCalcTimeout;
export function debouncedUpdateTokenCounts() {
    clearTimeout(tokenCalcTimeout);
    tokenCalcTimeout = setTimeout(updateTokenCounts, 300);
}

function bindCharacterFieldListeners() {
    // 监听所有字段变化，显示/隐藏未保存警告
    CHARACTER_FIELDS.forEach(field => {
        const element = document.getElementById(`char_${field}`);
        if (element) {
            $(element).on('input', function () {
                const settings = extension_settings[extensionName];
                const presetName = settings.characterPresetId;
                const currentPreset = settings.characterPresets[presetName] || {};
                const isDirty = $(this).val() !== (currentPreset[field] || '');
                const warning = $(this).closest('.st-chatu8-field-col').find('.st-chatu8-unsaved-warning');

                if (isDirty) {
                    $(warning).show();
                } else {
                    $(warning).hide();
                }
            });
            
            // 绑定 Token 统计的防抖事件
            if (!['nameCN', 'nameEN'].includes(field)) {
                $(element).on('input', debouncedUpdateTokenCounts);
            }
        }
    });
}

// ========== 服装选择器相关 ==========

function loadCharacterOutfitSelector() {
    const settings = extension_settings[extensionName];
    const select = document.getElementById('char_outfit_selector');

    if (!select) return;

    select.innerHTML = '<option value="">-- 选择服装 --</option>';

    for (const presetName in settings.outfitPresets) {
        const option = document.createElement('option');
        option.value = presetName;
        option.textContent = presetName;
        select.add(option);
    }
}

function addOutfitFromSelector() {
    const select = document.getElementById('char_outfit_selector');
    const textarea = document.getElementById('char_outfit_list');

    if (!select || !textarea) return;

    const selectedOutfit = select.value;
    if (!selectedOutfit) {
        alert('请先选择一个服装');
        return;
    }

    const currentText = textarea.value.trim();
    const lines = currentText ? currentText.split('\n') : [];

    if (lines.includes(selectedOutfit)) {
        alert('该服装已在列表中');
        return;
    }

    lines.push(selectedOutfit);
    textarea.value = lines.join('\n');
}

function checkCharacterOutfitList() {
    const settings = extension_settings[extensionName];
    const textarea = document.getElementById('char_outfit_list');
    const resultDiv = document.getElementById('char_outfit_check_result');
    const contentDiv = document.getElementById('char_outfit_check_content');

    if (!textarea || !resultDiv || !contentDiv) return;

    const inputOutfits = textarea.value
        .split('\n')
        .map(line => line.trim())
        .filter(line => line.length > 0);

    if (inputOutfits.length === 0) {
        alert('请先输入服装名称');
        return;
    }

    const availableOutfits = new Set();
    for (const presetName in settings.outfitPresets) {
        availableOutfits.add(presetName);
    }

    const results = { found: [], notFound: [] };

    inputOutfits.forEach(outfit => {
        if (availableOutfits.has(outfit)) {
            results.found.push(outfit);
        } else {
            results.notFound.push(outfit);
        }
    });

    let html = '<div style="margin-bottom: 10px;">';
    html += `<strong>总计：</strong>${inputOutfits.length} 个服装`;
    html += `<br><strong>找到：</strong>${results.found.length} 个`;
    html += `<br><strong>未找到：</strong>${results.notFound.length} 个`;
    html += '</div>';

    if (results.found.length > 0) {
        html += '<div style="margin-bottom: 10px;">';
        html += '<strong style="color: #28a745;">✓ 已存在的服装：</strong>';
        html += '<ul style="margin: 5px 0; padding-left: 20px;">';
        results.found.forEach(outfit => {
            html += `<li>${outfit}</li>`;
        });
        html += '</ul></div>';
    }

    if (results.notFound.length > 0) {
        html += '<div>';
        html += '<strong style="color: #dc3545;">✗ 未找到的服装：</strong>';
        html += '<ul style="margin: 5px 0; padding-left: 20px;">';
        results.notFound.forEach(outfit => {
            html += `<li>${outfit}</li>`;
        });
        html += '</ul></div>';
    }

    contentDiv.innerHTML = html;
    $(resultDiv).show();
}

/**
 * 清理 tag 用于翻译匹配
 * 移除括号、权重等符号，只保留纯文本用于翻译 API
 * @param {string} tag - 原始 tag
 * @returns {string} 清理后的纯文本 tag
 */
function cleanTagForTranslation(tag) {
    return tag
        .replace(/^[\{\[\(\<]+|[\}\]\)\>]+$/g, '')  // 移除首尾的括号
        .replace(/^\{+|\}+$/g, '')  // 再次确保移除花括号
        .replace(/:[\d.]+$/, '')  // 移除末尾权重如 :0.8
        .trim();
}

/**
 * 清空角色详细参数
 * 清空所有角色描述字段（不包括中英文名称）
 */
async function clearCharacterDetailParameters() {
    const confirmed = await stylishConfirm(
        '确定要清空所有详细参数吗？\n\n' +
        '这将清空以下字段：\n' +
        '- 角色特质\n' +
        '- 面部特征（正面/背面）\n' +
        '- 上半身描述（SFW/NSFW，正面/背面）\n' +
        '- 全身描述（SFW/NSFW，正面/背面）\n' +
        '- 负面提示词\n\n' +
        '此操作不会自动保存，您需要手动保存更改。'
    );

    if (!confirmed) {
        return;
    }

    // 要清空的字段列表
    const fieldsToClean = [
        'characterTraits',
        'facialFeatures', 'facialFeaturesBack',
        'upperBodySFW', 'upperBodySFWBack',
        'fullBodySFW', 'fullBodySFWBack',
        'upperBodyNSFW', 'upperBodyNSFWBack',
        'fullBodyNSFW', 'fullBodyNSFWBack',
        'negative'
    ];

    // 清空所有字段
    fieldsToClean.forEach(field => {
        const element = document.getElementById(`char_${field}`);
        if (element) {
            element.value = '';
            // 触发 input 事件以更新 UI 状态（显示未保存警告）
            $(element).trigger('input');
        }
    });

    toastr.success('详细参数已清空，请记得保存更改。');
}

/**
 * 翻译角色详细参数
 * 使用 LLM 翻译除中英文名称外的所有角色描述字段
 * 将所有字段合并为一次请求，减少 API 调用
 */
async function translateCharacterFields() {
    // 需要翻译的字段列表（不包括中英文名称 nameCN, nameEN）
    const fields = CHARACTER_FIELDS.filter(field => field !== 'nameCN' && field !== 'nameEN');

    // 收集所有需要翻译的内容
    const fieldsToTranslate = [];
    const allTags = [];

    // 正则：移除已有的中文括号及其内容 "xxx（yyy）" -> "xxx"
    const removeChineseParenRegex = /（[^）]*）/g;

    for (const field of fields) {
        const element = document.getElementById(`char_${field}`);
        if (element && element.value && element.value.trim()) {
            // 先移除已有的中文括号翻译内容
            const cleanedValue = element.value.replace(removeChineseParenRegex, '').trim();
            fieldsToTranslate.push({ field, element, originalValue: element.value, cleanedValue });
            // 收集该字段的所有 tag（去除中文括号后）
            const tags = cleanedValue.split(/[,，]/).map(s => s.trim()).filter(Boolean);
            allTags.push(...tags);
        }
    }

    if (allTags.length === 0) {
        toastr.info('没有找到需要翻译的内容。');
        return;
    }

    // 去重 tags
    const uniqueTags = [...new Set(allTags)];

    // 清理 tags 用于翻译请求（移除括号和权重）
    const cleanedTagsForTranslation = uniqueTags.map(tag => cleanTagForTranslation(tag)).filter(Boolean);
    const uniqueCleanedTags = [...new Set(cleanedTagsForTranslation)];

    // 显示加载状态
    toastr.info('正在翻译角色描述...', '请稍候', { timeOut: 0, extendedTimeOut: 0 });

    try {
        // 合并成一次翻译请求（使用清理后的 tags）
        const combinedText = uniqueCleanedTags.join(', ');
        const result = await translatePromptTags(combinedText);

        if (result && result.results) {
            // 创建翻译映射表（清理后的 tag -> 翻译文本）
            const translationMap = {};
            for (const item of result.results) {
                if (item.original && item.translation) {
                    // 只存储翻译文本，后续回填时保留原始格式
                    translationMap[item.original.toLowerCase()] = item.translation;
                }
            }

            // 将翻译结果应用回各个字段
            let translatedCount = 0;
            for (const { field, element, cleanedValue } of fieldsToTranslate) {
                const fieldTags = cleanedValue.split(/[,，]/).map(s => s.trim()).filter(Boolean);
                const translatedTags = fieldTags.map(tag => {
                    // 用清理后的 tag 去匹配翻译结果
                    const cleanedTag = cleanTagForTranslation(tag);
                    const translation = translationMap[cleanedTag.toLowerCase()];
                    if (translation) {
                        // 保留原始 tag 格式，在后面添加中文注释
                        return `${tag}（${translation}）`;
                    }
                    return tag;
                });
                element.value = translatedTags.join(', ');
                translatedCount++;
                $(element).trigger('input');
            }

            toastr.clear();
            toastr.success(`已翻译 ${translatedCount} 个字段。`);
        } else {
            toastr.clear();
            toastr.info('翻译结果为空。');
        }
    } catch (error) {
        console.error('翻译失败:', error);
        toastr.clear();
        toastr.error(`翻译失败，请检查 LLM 设置。`);
    }
}

/**
 * 翻译角色照片提示词
 * 专门用于翻译 char_photo_prompt 输入框中的内容
 */
async function translatePhotoPrompt() {
    const element = document.getElementById('char_photo_prompt');
    if (!element || !element.value || !element.value.trim()) {
        toastr.info('没有找到需要翻译的提示词内容。');
        return;
    }

    // 正则：移除已有的中文括号及其内容 "xxx（yyy）" -> "xxx"
    const removeChineseParenRegex = /（[^）]*）/g;
    const originalValue = element.value;
    const cleanedValue = originalValue.replace(removeChineseParenRegex, '').trim();

    // 收集所有 tag
    const tags = cleanedValue.split(/[,，]/).map(s => s.trim()).filter(Boolean);
    if (tags.length === 0) {
        toastr.info('没有找到需要翻译的内容。');
        return;
    }

    // 去重 tags
    const uniqueTags = [...new Set(tags)];

    // 清理 tags 用于翻译请求（移除括号和权重）
    const cleanedTagsForTranslation = uniqueTags.map(tag => cleanTagForTranslation(tag)).filter(Boolean);
    const uniqueCleanedTags = [...new Set(cleanedTagsForTranslation)];

    // 显示加载状态
    toastr.info('正在翻译提示词...', '请稍候', { timeOut: 0, extendedTimeOut: 0 });

    try {
        // 合并成一次翻译请求（使用清理后的 tags）
        const combinedText = uniqueCleanedTags.join(', ');
        const result = await translatePromptTags(combinedText);

        if (result && result.results) {
            // 创建翻译映射表（清理后的 tag -> 翻译文本）
            const translationMap = {};
            for (const item of result.results) {
                if (item.original && item.translation) {
                    // 只存储翻译文本，后续回填时保留原始格式
                    translationMap[item.original.toLowerCase()] = item.translation;
                }
            }

            // 应用翻译结果
            const translatedTags = tags.map(tag => {
                // 用清理后的 tag 去匹配翻译结果
                const cleanedTag = cleanTagForTranslation(tag);
                const translation = translationMap[cleanedTag.toLowerCase()];
                if (translation) {
                    // 保留原始 tag 格式，在后面添加中文注释
                    return `${tag}（${translation}）`;
                }
                return tag;
            });
            element.value = translatedTags.join(', ');
            $(element).trigger('input');

            toastr.clear();
            toastr.success('提示词翻译完成。');
        } else {
            toastr.clear();
            toastr.info('翻译结果为空。');
        }
    } catch (error) {
        console.error('翻译失败:', error);
        toastr.clear();
        toastr.error('翻译失败，请检查 LLM 设置。');
    }
}

// ========== 角色照片相关 ==========

/**
 * 加载角色照片和提示词
 */
async function loadCharacterPhoto(preset) {
    const photoPreview = document.getElementById('char_photo_preview');
    const photoPlaceholder = document.getElementById('char_photo_placeholder');
    const photoPromptElement = document.getElementById('char_photo_prompt');

    // 加载提示词
    if (photoPromptElement) {
        photoPromptElement.value = preset.photoPrompt || '';
    }

    // 兼容旧格式：如果存在 photoImageId 但没有 photoImageIds，则迁移
    if (preset.photoImageId && (!preset.photoImageIds || preset.photoImageIds.length === 0)) {
        preset.photoImageIds = [preset.photoImageId];
        delete preset.photoImageId;
        saveSettingsDebounced();
    }

    // 确保 photoImageIds 是数组
    const imageIds = preset.photoImageIds || [];

    // 获取选中的图片索引，确保在有效范围内
    let selectedIndex = preset.selectedPhotoIndex || 0;
    if (selectedIndex < 0 || selectedIndex >= imageIds.length) {
        selectedIndex = imageIds.length > 0 ? imageIds.length - 1 : 0;
    }

    // 显示选中的图片
    if (imageIds.length > 0) {
        const selectedImageId = imageIds[selectedIndex];
        try {
            const imageData = await getConfigImage(selectedImageId);
            if (imageData && photoPreview && photoPlaceholder) {
                photoPreview.src = imageData;
                photoPreview.style.display = 'block';
                photoPlaceholder.style.display = 'none';

                // 添加点击事件以查看大图（传入数组和当前索引）
                photoPreview.style.cursor = 'pointer';
                photoPreview.onclick = () => showImageViewer(imageIds, selectedIndex);

                return;
            }
        } catch (error) {
            console.error('[CharacterPreset] 加载角色照片失败:', error);
        }
    }

    // 没有照片或加载失败，显示占位符
    if (photoPreview && photoPlaceholder) {
        photoPreview.src = '';
        photoPreview.style.display = 'none';
        photoPlaceholder.style.display = 'flex';
        photoPreview.onclick = null;
        photoPreview.style.cursor = 'default';
    }
}

/**
 * 生成图片按钮处理
 * 使用事件系统发送图片生成请求，接收返回的图片并存储到configDatabase
 */
async function handlePhotoGenerate() {
    const settings = extension_settings[extensionName];
    const presetId = settings.characterPresetId;
    const preset = settings.characterPresets[presetId];

    if (!preset) {
        toastr.warning('请先选择一个角色预设');
        return;
    }

    // 获取提示词
    const photoPromptElement = document.getElementById('char_photo_prompt');
    const prompt = photoPromptElement?.value?.trim() || '';

    if (!prompt) {
        toastr.warning('请先输入图片生成提示词');
        return;
    }

    // 生成唯一请求 ID
    const requestId = `char_photo_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    // 显示加载提示
    toastr.info('正在生成角色图片...', '请稍候', { timeOut: 0, extendedTimeOut: 0 });

    // 创建一次性事件监听器
    const handleResponse = async (responseData) => {
        // 检查是否是我们的请求
        if (responseData.id !== requestId) {
            return;
        }

        // 从活动请求映射表中移除此请求
        const requestInfo = activePhotoRequests.get(requestId);
        if (requestInfo) {
            eventSource.removeListener(EventType.GENERATE_IMAGE_RESPONSE, requestInfo.listener);
            activePhotoRequests.delete(requestId);
        }

        // 关闭加载提示
        toastr.clear();

        if (responseData.success && responseData.imageData) {
            try {
                // 存储图片到 configDatabase
                const imageId = await saveConfigImage(responseData.imageData);

                // 确保 photoImageIds 是数组
                if (!preset.photoImageIds) {
                    preset.photoImageIds = [];
                }

                // 将新图片追加到数组末尾，并更新选中索引为最新图片
                preset.photoImageIds.push(imageId);
                preset.selectedPhotoIndex = preset.photoImageIds.length - 1;
                saveSettingsDebounced();

                // 更新 UI
                const photoPreview = document.getElementById('char_photo_preview');
                const photoPlaceholder = document.getElementById('char_photo_placeholder');

                if (photoPreview && photoPlaceholder) {
                    photoPreview.src = responseData.imageData;
                    photoPreview.style.display = 'block';
                    photoPlaceholder.style.display = 'none';

                    // 更新点击事件
                    photoPreview.style.cursor = 'pointer';
                    photoPreview.onclick = () => showImageViewer(preset.photoImageIds, preset.photoImageIds.length - 1);
                }

                toastr.success('角色图片生成成功');
            } catch (error) {
                console.error('[CharacterPreset] 保存图片失败:', error);
                toastr.error('保存图片失败: ' + error.message);
            }
        } else {
            toastr.error('图片生成失败: ' + (responseData.error || '未知错误'));
        }
    };

    // 将此请求添加到活动请求映射表
    activePhotoRequests.set(requestId, {
        listener: handleResponse,
        timestamp: Date.now()
    });

    // 注册监听器
    eventSource.on(EventType.GENERATE_IMAGE_RESPONSE, handleResponse);

    // 发送图片生成请求
    eventSource.emit(EventType.GENERATE_IMAGE_REQUEST, {
        id: requestId,
        prompt: prompt,
        // 可选：指定图片尺寸
        // width: 1024,
        // height: 1024,
    });
}

/**
 * 生成图片提示词按钮处理
 * 调用 imagePromptGen 模块来生成图片提示词
 */
function handlePhotoGeneratePrompt() {
    handlePhotoGeneratePromptClick();
}

/**
 * 处理角色照片上传
 * 读取用户选择的图片文件，保存到 configDatabase，更新 UI
 */
async function handleCharacterPhotoUpload(event) {
    const input = event.target;
    if (!input.files || !input.files[0]) return;

    const settings = extension_settings[extensionName];
    const presetId = settings.characterPresetId;
    const preset = settings.characterPresets[presetId];

    if (!preset) {
        toastr.warning('请先选择一个角色预设');
        input.value = '';
        return;
    }

    const file = input.files[0];

    // 检查文件类型
    if (!file.type.startsWith('image/')) {
        toastr.warning('请选择图片文件');
        input.value = '';
        return;
    }

    // 读取文件
    const reader = new FileReader();
    reader.onload = async (e) => {
        try {
            const imageData = e.target.result;

            // 保存到 configDatabase
            const imageId = await saveConfigImage(imageData);

            // 确保 photoImageIds 是数组
            if (!preset.photoImageIds) {
                preset.photoImageIds = [];
            }

            // 将新图片追加到数组末尾，并更新选中索引为最新图片
            preset.photoImageIds.push(imageId);
            preset.selectedPhotoIndex = preset.photoImageIds.length - 1;
            saveSettingsDebounced();

            // 更新 UI
            const photoPreview = document.getElementById('char_photo_preview');
            const photoPlaceholder = document.getElementById('char_photo_placeholder');

            if (photoPreview && photoPlaceholder) {
                photoPreview.src = imageData;
                photoPreview.style.display = 'block';
                photoPlaceholder.style.display = 'none';

                // 更新点击事件
                photoPreview.style.cursor = 'pointer';
                photoPreview.onclick = () => showImageViewer(preset.photoImageIds, preset.photoImageIds.length - 1);
            }

            toastr.success('角色照片上传成功');
        } catch (error) {
            console.error('[CharacterPreset] 上传照片失败:', error);
            toastr.error('上传照片失败: ' + error.message);
        }
    };

    reader.onerror = () => {
        toastr.error('读取文件失败');
    };

    reader.readAsDataURL(file);

    // 清空 input，以便可以重复选择同一文件
    input.value = '';
}

/**
 * 读取文件为 base64
 * @param {File} file 
 * @returns {Promise<string>}
 */
function readFileAsBase64ForPopup(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = reject;
        reader.readAsDataURL(file);
    });
}

/**
 * 修改角色提示词按钮处理
 * 弹出气泡输入框让用户输入需求，然后调用 characterPromptModify 模块处理
 */
function handlePhotoModifyCharacterPrompt() {
    const uploadedImages = [];

    // 创建弹窗
    const parent = document.getElementById('st-chatu8-settings') || document.body;

    const backdrop = document.createElement('div');
    backdrop.className = 'st-chatu8-confirm-backdrop';

    const modal = document.createElement('div');
    modal.className = 'st-chatu8-confirm-box st-chatu8-popup-modal';

    // 标题
    const title = document.createElement('h3');
    title.className = 'st-chatu8-popup-title';
    title.textContent = '修改角色提示词';
    modal.appendChild(title);

    // 描述文字
    const description = document.createElement('p');
    description.className = 'st-chatu8-popup-description';
    description.textContent = '请输入您的修改需求，AI 将根据需求调整角色提示词：';
    modal.appendChild(description);

    // 输入框
    const textarea = document.createElement('textarea');
    textarea.className = 'st-chatu8-textarea';
    textarea.rows = 4;
    textarea.placeholder = '例如：让角色的表情更生动、增加背景描述、调整服装细节...';
    modal.appendChild(textarea);

    // ==================== 图片上传区域 ====================
    const imageUploadSection = document.createElement('div');
    imageUploadSection.className = 'st-chatu8-popup-upload-section';

    const uploadHeader = document.createElement('div');
    uploadHeader.className = 'st-chatu8-popup-upload-header';

    const uploadLabel = document.createElement('span');
    uploadLabel.className = 'st-chatu8-popup-upload-label';
    uploadLabel.textContent = '📎 参考图片（可选）';

    const fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.accept = 'image/*';
    fileInput.multiple = true;
    fileInput.style.display = 'none';

    const uploadBtn = document.createElement('button');
    uploadBtn.type = 'button';
    uploadBtn.innerHTML = '<i class="fa-solid fa-plus"></i> 添加图片';
    uploadBtn.className = 'st-chatu8-btn st-chatu8-popup-upload-btn';
    uploadBtn.addEventListener('click', () => fileInput.click());

    uploadHeader.appendChild(uploadLabel);
    uploadHeader.appendChild(uploadBtn);

    const imagePreviewContainer = document.createElement('div');
    imagePreviewContainer.className = 'st-chatu8-popup-image-preview';

    const emptyHint = document.createElement('div');
    emptyHint.className = 'st-chatu8-popup-empty-hint';
    emptyHint.textContent = '点击上方按钮添加参考图片';
    imagePreviewContainer.appendChild(emptyHint);

    function updateImagePreviews() {
        imagePreviewContainer.innerHTML = '';

        if (uploadedImages.length === 0) {
            const hint = document.createElement('div');
            hint.className = 'st-chatu8-popup-empty-hint';
            hint.textContent = '点击上方按钮添加参考图片';
            imagePreviewContainer.appendChild(hint);
            return;
        }

        uploadedImages.forEach((imgObj, index) => {
            const itemContainer = document.createElement('div');
            itemContainer.className = 'st-chatu8-popup-image-item';

            const imgWrapper = document.createElement('div');
            imgWrapper.className = 'st-chatu8-popup-image-wrapper';

            const img = document.createElement('img');
            img.src = imgObj.base64;

            const deleteBtn = document.createElement('button');
            deleteBtn.type = 'button';
            deleteBtn.className = 'st-chatu8-popup-image-delete';
            deleteBtn.innerHTML = '×';
            deleteBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                uploadedImages.splice(index, 1);
                updateImagePreviews();
            });

            imgWrapper.addEventListener('mouseenter', () => {
                deleteBtn.style.opacity = '1';
            });
            imgWrapper.addEventListener('mouseleave', () => {
                deleteBtn.style.opacity = '0';
            });

            imgWrapper.appendChild(img);
            imgWrapper.appendChild(deleteBtn);

            const nameInput = document.createElement('input');
            nameInput.type = 'text';
            nameInput.className = 'st-chatu8-popup-image-name';
            nameInput.placeholder = `图${index + 1}`;
            nameInput.value = imgObj.name || '';
            nameInput.addEventListener('input', (e) => {
                uploadedImages[index].name = e.target.value;
            });

            itemContainer.appendChild(imgWrapper);
            itemContainer.appendChild(nameInput);
            imagePreviewContainer.appendChild(itemContainer);
        });

        const countLabel = document.createElement('div');
        countLabel.className = 'st-chatu8-popup-image-count';
        countLabel.textContent = `已添加 ${uploadedImages.length} 张图片`;
        imagePreviewContainer.appendChild(countLabel);
    }

    fileInput.addEventListener('change', async (e) => {
        const files = e.target.files;
        if (!files || files.length === 0) return;

        for (const file of files) {
            if (!file.type.startsWith('image/')) continue;

            try {
                const base64 = await readFileAsBase64ForPopup(file);
                uploadedImages.push({
                    base64: base64,
                    name: ''
                });
            } catch (err) {
                console.error('[characterPreset] Failed to read image:', err);
            }
        }

        updateImagePreviews();
        fileInput.value = '';
    });

    imageUploadSection.appendChild(uploadHeader);
    imageUploadSection.appendChild(fileInput);
    imageUploadSection.appendChild(imagePreviewContainer);
    modal.appendChild(imageUploadSection);

    // 按钮区域
    const buttonContainer = document.createElement('div');
    buttonContainer.className = 'st-chatu8-confirm-buttons';

    const cancelButton = document.createElement('button');
    cancelButton.textContent = '取消';
    cancelButton.className = 'st-chatu8-btn';
    buttonContainer.appendChild(cancelButton);

    const confirmButton = document.createElement('button');
    confirmButton.innerHTML = '<i class="fa-solid fa-check"></i> 确认';
    confirmButton.className = 'st-chatu8-btn st-chatu8-btn-primary';
    buttonContainer.appendChild(confirmButton);

    modal.appendChild(buttonContainer);
    backdrop.appendChild(modal);
    parent.appendChild(backdrop);

    // 聚焦到输入框
    setTimeout(() => textarea.focus(), 100);

    // 关闭弹窗函数
    const closeModal = () => {
        parent.removeChild(backdrop);
    };

    // 事件绑定 - 只允许通过按钮关闭，点击外部不会关闭
    cancelButton.addEventListener('click', closeModal);

    confirmButton.addEventListener('click', () => {
        const userRequirement = textarea.value.trim();
        closeModal();
        handleCharacterPromptModify(userRequirement, [...uploadedImages]);
    });
}

/**
 * 角色数据按钮处理
 * 显示一个弹窗来查看和编辑角色的生成元数据
 */
function handleCharacterData() {
    const settings = extension_settings[extensionName];
    const presetId = settings.characterPresetId;
    const preset = settings.characterPresets[presetId];

    if (!preset) {
        toastr.warning('请先选择一个角色预设');
        return;
    }

    // 获取存储的元数据
    const generationContext = preset.generationContext || '';
    const generationWorldBook = preset.generationWorldBook || '';
    const generationVariables = preset.generationVariables || {};

    // 创建弹窗
    const parent = document.getElementById('st-chatu8-settings') || document.body;

    const backdrop = document.createElement('div');
    backdrop.className = 'st-chatu8-confirm-backdrop';

    const modal = document.createElement('div');
    modal.className = 'st-chatu8-confirm-box st-chatu8-popup-modal st-chatu8-popup-modal-large';

    // 标题
    const title = document.createElement('h3');
    title.className = 'st-chatu8-popup-title';
    title.textContent = `角色数据 - ${presetId}`;
    modal.appendChild(title);

    // 创建内容区域
    const contentArea = document.createElement('div');
    contentArea.className = 'st-chatu8-popup-content';

    // 上下文区域
    const contextSection = createDataSection(
        '生成时的上下文',
        'char_data_context',
        generationContext,
        '角色生成时使用的上下文内容...',
        6
    );
    contentArea.appendChild(contextSection);

    // 世界书触发区域
    const worldBookSection = createDataSection(
        '生成时的世界书触发',
        'char_data_worldbook',
        generationWorldBook,
        '角色生成时触发的世界书内容...',
        6
    );
    contentArea.appendChild(worldBookSection);

    // 变量区域
    const variablesSection = document.createElement('div');
    variablesSection.className = 'st-chatu8-field-col';

    const variablesLabel = document.createElement('label');
    variablesLabel.textContent = '生成时使用的变量';
    variablesSection.appendChild(variablesLabel);

    const variablesTextarea = document.createElement('textarea');
    variablesTextarea.id = 'char_data_variables';
    variablesTextarea.className = 'st-chatu8-textarea st-chatu8-popup-code-textarea';
    variablesTextarea.rows = 4;
    variablesTextarea.placeholder = '变量格式: 变量名=值（每行一个）...';
    // 将对象格式化为 "变量名=值" 格式
    variablesTextarea.value = Object.entries(generationVariables)
        .map(([key, value]) => `${key}=${value}`)
        .join('\n');
    variablesSection.appendChild(variablesTextarea);
    contentArea.appendChild(variablesSection);

    modal.appendChild(contentArea);

    // 按钮区域
    const buttonContainer = document.createElement('div');
    buttonContainer.className = 'st-chatu8-confirm-buttons';

    const cancelButton = document.createElement('button');
    cancelButton.textContent = '取消';
    cancelButton.className = 'st-chatu8-btn';
    buttonContainer.appendChild(cancelButton);

    const saveButton = document.createElement('button');
    saveButton.innerHTML = '<i class="fa-solid fa-save"></i> 保存';
    saveButton.className = 'st-chatu8-btn st-chatu8-btn-primary';
    buttonContainer.appendChild(saveButton);

    modal.appendChild(buttonContainer);
    backdrop.appendChild(modal);
    parent.appendChild(backdrop);

    // 关闭弹窗
    const closeModal = () => {
        parent.removeChild(backdrop);
    };

    // 事件绑定 - 只允许通过按钮关闭，防止点击外部误关闭导致数据丢失
    cancelButton.addEventListener('click', closeModal);

    saveButton.addEventListener('click', () => {
        // 获取编辑后的值
        const newContext = document.getElementById('char_data_context').value;
        const newWorldBook = document.getElementById('char_data_worldbook').value;
        const variablesText = document.getElementById('char_data_variables').value;

        // 解析变量
        const newVariables = {};
        variablesText.split('\n').forEach(line => {
            const trimmed = line.trim();
            if (!trimmed) return;
            const eqIndex = trimmed.indexOf('=');
            if (eqIndex > 0) {
                const key = trimmed.substring(0, eqIndex).trim();
                const value = trimmed.substring(eqIndex + 1).trim();
                newVariables[key] = value;
            }
        });

        // 保存到预设
        preset.generationContext = newContext;
        preset.generationWorldBook = newWorldBook;
        preset.generationVariables = newVariables;

        saveSettingsDebounced();
        closeModal();
        toastr.success('角色数据已保存');
    });
}

/**
 * 创建数据区域的辅助函数
 */
function createDataSection(labelText, textareaId, value, placeholder, rows) {
    const section = document.createElement('div');
    section.className = 'st-chatu8-field-col';

    const label = document.createElement('label');
    label.textContent = labelText;
    section.appendChild(label);

    const textarea = document.createElement('textarea');
    textarea.id = textareaId;
    textarea.className = 'st-chatu8-textarea st-chatu8-popup-code-textarea';
    textarea.rows = rows;
    textarea.placeholder = placeholder;
    textarea.value = value;
    section.appendChild(textarea);

    return section;
}

/**
 * 显示图片全屏查看器（支持多图片导航）
 * @param {string[]} imageIds - 图片 ID 数组
 * @param {number} initialIndex - 初始显示的图片索引
 */
async function showImageViewer(imageIds, initialIndex) {
    const settings = extension_settings[extensionName];
    const presetId = settings.characterPresetId;
    const preset = settings.characterPresets[presetId];

    if (!imageIds || imageIds.length === 0) {
        toastr.warning('没有可显示的图片');
        return;
    }

    let currentIndex = Math.max(0, Math.min(initialIndex, imageIds.length - 1));

    // 创建全屏查看器
    const parent = document.getElementById('st-chatu8-settings') || document.body;

    const backdrop = document.createElement('div');
    backdrop.className = 'st-chatu8-confirm-backdrop';
    backdrop.style.cssText = `
        z-index: 10002;
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 20px;
        box-sizing: border-box;
    `;

    const container = document.createElement('div');
    container.style.cssText = `
        position: relative;
        display: flex;
        flex-direction: column;
        align-items: center;
        max-width: 95vw;
        max-height: 95vh;
        background: var(--SmartThemeBlurTintColor, rgba(0, 0, 0, 0.8));
        border-radius: 12px;
        padding: 20px;
        box-shadow: 0 8px 32px rgba(0, 0, 0, 0.5);
    `;

    // 图片展示区域（包含左右按钮）
    const imageArea = document.createElement('div');
    imageArea.style.cssText = `
        display: flex;
        align-items: center;
        gap: 15px;
        position: relative;
    `;

    // 左箭头按钮
    const leftButton = document.createElement('button');
    leftButton.innerHTML = '<i class="fa-solid fa-chevron-left"></i>';
    leftButton.className = 'st-chatu8-btn';
    leftButton.style.cssText = `
        width: 50px;
        height: 50px;
        border-radius: 50%;
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 20px;
        background: rgba(255, 255, 255, 0.1);
        transition: all 0.2s ease;
    `;
    imageArea.appendChild(leftButton);

    // 图片元素
    const img = document.createElement('img');
    img.style.cssText = `
        max-width: calc(95vw - 180px);
        max-height: calc(95vh - 160px);
        object-fit: contain;
        border-radius: 8px;
        box-shadow: 0 4px 16px rgba(0, 0, 0, 0.3);
    `;
    imageArea.appendChild(img);

    // 右箭头按钮
    const rightButton = document.createElement('button');
    rightButton.innerHTML = '<i class="fa-solid fa-chevron-right"></i>';
    rightButton.className = 'st-chatu8-btn';
    rightButton.style.cssText = `
        width: 50px;
        height: 50px;
        border-radius: 50%;
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 20px;
        background: rgba(255, 255, 255, 0.1);
        transition: all 0.2s ease;
    `;
    imageArea.appendChild(rightButton);

    container.appendChild(imageArea);

    // 图片索引指示器
    const indexIndicator = document.createElement('div');
    indexIndicator.style.cssText = `
        margin-top: 12px;
        font-size: 14px;
        color: inherit;
        opacity: 0.8;
    `;
    container.appendChild(indexIndicator);

    // 按钮区域
    const buttonContainer = document.createElement('div');
    buttonContainer.style.cssText = `
        display: flex;
        gap: 15px;
        margin-top: 20px;
        justify-content: center;
    `;

    // 下载按钮
    const downloadButton = document.createElement('button');
    downloadButton.innerHTML = '<i class="fa-solid fa-download"></i> 下载图片';
    downloadButton.className = 'st-chatu8-btn';
    downloadButton.style.cssText = `
        background: linear-gradient(135deg, #28a745 0%, #20c997 100%);
        padding: 10px 20px;
        font-size: 14px;
    `;
    buttonContainer.appendChild(downloadButton);

    // 删除按钮
    const deleteButton = document.createElement('button');
    deleteButton.innerHTML = '<i class="fa-solid fa-trash"></i> 删除图片';
    deleteButton.className = 'st-chatu8-btn';
    deleteButton.style.cssText = `
        background: linear-gradient(135deg, #dc3545 0%, #c82333 100%);
        padding: 10px 20px;
        font-size: 14px;
    `;
    buttonContainer.appendChild(deleteButton);

    // 删除其他按钮
    const deleteOthersButton = document.createElement('button');
    deleteOthersButton.innerHTML = '<i class="fa-solid fa-trash-can"></i> 删除其他';
    deleteOthersButton.className = 'st-chatu8-btn';
    deleteOthersButton.style.cssText = `
        background: linear-gradient(135deg, #fd7e14 0%, #e65c00 100%);
        padding: 10px 20px;
        font-size: 14px;
    `;
    buttonContainer.appendChild(deleteOthersButton);

    // 关闭按钮
    const closeButton = document.createElement('button');
    closeButton.innerHTML = '<i class="fa-solid fa-xmark"></i> 关闭';
    closeButton.className = 'st-chatu8-btn';
    closeButton.style.cssText = `
        padding: 10px 20px;
        font-size: 14px;
    `;
    buttonContainer.appendChild(closeButton);

    container.appendChild(buttonContainer);
    backdrop.appendChild(container);
    parent.appendChild(backdrop);

    // 缓存已加载的图片
    const imageCache = {};

    // 加载并显示指定索引的图片
    const loadImage = async (index) => {
        if (index < 0 || index >= imageIds.length) return;

        currentIndex = index;
        const imageId = imageIds[currentIndex];

        // 更新索引显示
        indexIndicator.textContent = `${currentIndex + 1} / ${imageIds.length}`;

        // 更新按钮状态
        leftButton.style.opacity = currentIndex === 0 ? '0.3' : '1';
        leftButton.style.pointerEvents = currentIndex === 0 ? 'none' : 'auto';
        rightButton.style.opacity = currentIndex === imageIds.length - 1 ? '0.3' : '1';
        rightButton.style.pointerEvents = currentIndex === imageIds.length - 1 ? 'none' : 'auto';

        // 尝试从缓存获取或加载图片
        try {
            let imageData = imageCache[imageId];
            if (!imageData) {
                imageData = await getConfigImage(imageId);
                if (imageData) {
                    imageCache[imageId] = imageData;
                }
            }
            if (imageData) {
                img.src = imageData;
            } else {
                img.src = '';
                toastr.warning('图片加载失败');
            }
        } catch (error) {
            console.error('[CharacterPreset] 加载图片失败:', error);
            img.src = '';
        }
    };

    // 关闭查看器
    const closeViewer = async () => {
        document.removeEventListener('keydown', handleKeyDown);

        // 保存当前选中的图片索引
        if (preset) {
            preset.selectedPhotoIndex = currentIndex;
            saveSettingsDebounced();

            // 更新主界面预览图显示选中的图片
            const photoPreview = document.getElementById('char_photo_preview');
            const photoPlaceholder = document.getElementById('char_photo_placeholder');
            if (imageIds.length > 0 && currentIndex >= 0 && currentIndex < imageIds.length) {
                try {
                    const selectedImageId = imageIds[currentIndex];
                    const imageData = imageCache[selectedImageId] || await getConfigImage(selectedImageId);
                    if (imageData && photoPreview && photoPlaceholder) {
                        photoPreview.src = imageData;
                        photoPreview.style.display = 'block';
                        photoPlaceholder.style.display = 'none';
                        photoPreview.style.cursor = 'pointer';
                        photoPreview.onclick = () => showImageViewer(imageIds, currentIndex);
                    }
                } catch (error) {
                    console.error('[CharacterPreset] 更新预览图失败:', error);
                }
            }
        }

        parent.removeChild(backdrop);
    };

    // 键盘事件处理
    const handleKeyDown = (e) => {
        if (e.key === 'ArrowLeft' && currentIndex > 0) {
            loadImage(currentIndex - 1);
        } else if (e.key === 'ArrowRight' && currentIndex < imageIds.length - 1) {
            loadImage(currentIndex + 1);
        } else if (e.key === 'Escape') {
            closeViewer();
        }
    };

    // 事件绑定
    leftButton.addEventListener('click', () => {
        if (currentIndex > 0) loadImage(currentIndex - 1);
    });

    rightButton.addEventListener('click', () => {
        if (currentIndex < imageIds.length - 1) loadImage(currentIndex + 1);
    });

    closeButton.addEventListener('click', closeViewer);
    document.addEventListener('keydown', handleKeyDown);

    // 下载按钮事件
    downloadButton.addEventListener('click', () => {
        try {
            const currentImageData = imageCache[imageIds[currentIndex]];
            if (!currentImageData) {
                toastr.warning('图片未加载完成');
                return;
            }

            const link = document.createElement('a');
            link.href = currentImageData;

            const charName = preset?.nameCN || preset?.nameEN || presetId || 'character';
            const timestamp = new Date().toISOString().slice(0, 10);
            link.download = `${charName}_${currentIndex + 1}_${timestamp}.png`;

            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);

            toastr.success('图片下载成功');
        } catch (error) {
            console.error('[CharacterPreset] 下载图片失败:', error);
            toastr.error('下载图片失败: ' + error.message);
        }
    });

    // 删除按钮事件
    deleteButton.addEventListener('click', async () => {
        const confirmed = await stylishConfirm('确定要删除这张角色图片吗？此操作不可撤销。');

        if (confirmed) {
            try {
                const imageIdToDelete = imageIds[currentIndex];

                // 从数据库删除图片
                if (imageIdToDelete) {
                    await deleteConfigImage(imageIdToDelete);
                }

                // 从数组中移除
                if (preset && preset.photoImageIds) {
                    const deleteIndex = preset.photoImageIds.indexOf(imageIdToDelete);
                    if (deleteIndex > -1) {
                        preset.photoImageIds.splice(deleteIndex, 1);
                        saveSettingsDebounced();
                    }
                }

                // 同步更新本地 imageIds 数组
                imageIds.splice(currentIndex, 1);

                // 如果还有图片，切换到相邻图片
                if (imageIds.length > 0) {
                    // 如果删除的是最后一张，显示前一张
                    if (currentIndex >= imageIds.length) {
                        currentIndex = imageIds.length - 1;
                    }
                    loadImage(currentIndex);
                    toastr.success('图片已删除');
                } else {
                    // 没有图片了，关闭查看器并更新主界面
                    closeViewer();
                    toastr.success('图片已删除');

                    // 更新主界面显示
                    const photoPreview = document.getElementById('char_photo_preview');
                    const photoPlaceholder = document.getElementById('char_photo_placeholder');

                    if (photoPreview && photoPlaceholder) {
                        photoPreview.src = '';
                        photoPreview.style.display = 'none';
                        photoPreview.onclick = null;
                        photoPreview.style.cursor = 'default';
                        photoPlaceholder.style.display = 'flex';
                    }
                }

                // 刷新缓存
                delete imageCache[imageIdToDelete];

            } catch (error) {
                console.error('[CharacterPreset] 删除图片失败:', error);
                toastr.error('删除图片失败: ' + error.message);
            }
        }
    });

    // 删除其他按钮事件
    deleteOthersButton.addEventListener('click', async () => {
        if (imageIds.length <= 1) {
            toastr.info('没有其他图片可删除');
            return;
        }

        const confirmed = await stylishConfirm(`确定要删除当前图片之外的 ${imageIds.length - 1} 张图片吗？此操作不可撤销。`);

        if (confirmed) {
            try {
                const currentImageId = imageIds[currentIndex];
                const idsToDelete = imageIds.filter((id, idx) => idx !== currentIndex);

                // 从数据库删除其他图片
                for (const imageId of idsToDelete) {
                    if (imageId) {
                        await deleteConfigImage(imageId);
                        delete imageCache[imageId];
                    }
                }

                // 更新 preset 的 photoImageIds
                if (preset && preset.photoImageIds) {
                    preset.photoImageIds = [currentImageId];
                    saveSettingsDebounced();
                }

                // 更新本地 imageIds 数组
                imageIds.length = 0;
                imageIds.push(currentImageId);
                currentIndex = 0;

                // 更新显示
                loadImage(0);
                toastr.success(`已删除 ${idsToDelete.length} 张其他图片`);

            } catch (error) {
                console.error('[CharacterPreset] 删除其他图片失败:', error);
                toastr.error('删除其他图片失败: ' + error.message);
            }
        }
    });

    // 加载初始图片
    await loadImage(currentIndex);
}
