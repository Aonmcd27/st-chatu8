// @ts-nocheck
/**
 * 服装预设管理模块
 * 处理服装相关的 CRUD 操作和导入导出
 */

import { extension_settings } from "../../../../../../extensions.js";
import { saveSettingsDebounced, eventSource } from "../../../../../../../script.js";
import { extensionName, EventType } from '../../config.js';
import { stylInput, stylishConfirm } from '../../ui_common.js';
import { getContext } from "../../../../../../st-context.js";
import { encryptExportData, decryptImportData } from './crypto.js';
import { translatePromptTags } from '../../ai.js';
import { getConfigImage, saveConfigImage, deleteConfigImage } from '../../configDatabase.js';
import { handleOutfitPhotoGeneratePromptClick } from '../../outfitImagePromptGen.js';
import { handleOutfitPromptModify } from '../../outfitPromptModify.js';
import { showOutfitVisualSelector } from './characterVisualSelector.js';
import { calculateNovelAITokens } from '../../novelaiTokenCalculator.js';

// ========== 服装图片生成状态管理 ==========

/**
 * 活动的服装图片生成请求映射表
 * 键: requestId, 值: { listener, timestamp }
 * 用于跟踪和管理多个并发的图片生成请求
 */
const activeOutfitPhotoRequests = new Map();

// ========== 服装预设管理 ==========

/**
 * 设置服装控件
 */
export function setupOutfitControls(container) {
    const settings = extension_settings[extensionName];

    // 加载预设列表
    loadOutfitPresetList();

    // 绑定预设选择
    container.find('#outfit_preset_id').on('change', loadOutfitPreset);

    // 绑定按钮
    container.find('#outfit_new').on('click', createNewOutfitPreset);
    container.find('#outfit_rename').on('click', renameOutfitPreset);
    container.find('#outfit_update').on('click', updateOutfitPreset);
    container.find('#outfit_save_as').on('click', saveOutfitPresetAs);
    container.find('#outfit_export').on('click', exportOutfitPreset);
    container.find('#outfit_export_all').on('click', exportAllOutfitPresets);
    container.find('#outfit_import').on('click', importOutfitPreset);
    container.find('#outfit_delete').on('click', deleteOutfitPreset);
    container.find('#outfit_visual_select').on('click', handleOutfitVisualSelect);

    // 绑定翻译按钮
    container.find('#outfit_translate').on('click', translateOutfitFields);
    container.find('#outfit_photo_prompt_translate').on('click', translateOutfitPhotoPrompt);

    // 绑定清空详细参数按钮
    container.find('#outfit_clear_details').on('click', clearOutfitDetailParameters);

    // 绑定服装照片相关按钮
    container.find('#outfit_photo_generate').on('click', handleOutfitPhotoGenerate);
    container.find('#outfit_photo_generate_prompt').on('click', handleOutfitPhotoGeneratePrompt);
    container.find('#outfit_photo_modify_prompt').on('click', handleOutfitPhotoModifyPrompt);

    // 绑定服装照片上传按钮
    container.find('#outfit_photo_upload').on('click', () => {
        document.getElementById('outfit_photo_upload_input')?.click();
    });
    container.find('#outfit_photo_upload_input').on('change', handleOutfitPhotoUpload);

    // 绑定发送图片复选框变化事件
    container.find('#outfit_send_photo').on('change', function () {
        const settings = extension_settings[extensionName];
        const presetId = settings.outfitPresetId;
        if (presetId && settings.outfitPresets[presetId]) {
            settings.outfitPresets[presetId].sendPhoto = this.checked;
            saveSettingsDebounced();
            console.log('[outfitPreset] 已保存服装发送图片设置:', this.checked);
        }
    });

    // 绑定字段变化监听
    bindOutfitFieldListeners();

    // 加载当前预设
    loadOutfitPreset();
}

export function loadOutfitPresetList() {
    const settings = extension_settings[extensionName];
    const select = document.getElementById('outfit_preset_id');

    if (!select) return;

    select.innerHTML = '';

    for (const presetName in settings.outfitPresets) {
        const option = document.createElement('option');
        option.value = presetName;
        option.textContent = presetName;
        select.add(option);
    }

    select.value = settings.outfitPresetId;
}

export function loadOutfitPreset() {
    const settings = extension_settings[extensionName];
    const select = document.getElementById('outfit_preset_id');
    if (!select) return;

    const newPresetId = select.value;
    const currentPresetId = settings.outfitPresetId;

    // 检查是否有未保存的更改
    if (currentPresetId && currentPresetId !== newPresetId) {
        const currentPreset = settings.outfitPresets[currentPresetId] || {};
        const fields = ['nameCN', 'nameEN', 'upperBody', 'fullBody'];

        let isDirty = false;
        for (const field of fields) {
            const element = document.getElementById(`outfit_${field}`);
            if (element && element.value !== (currentPreset[field] || '')) {
                isDirty = true;
                break;
            }
        }

        if (isDirty) {
            stylishConfirm("您有未保存的服装数据。要放弃这些更改并切换预设吗？").then(confirmed => {
                if (confirmed) {
                    settings.outfitPresetId = newPresetId;
                    loadOutfitPresetData(newPresetId);
                    saveSettingsDebounced();
                } else {
                    select.value = currentPresetId;
                }
            });
            return;
        }
    }

    settings.outfitPresetId = newPresetId;
    loadOutfitPresetData(newPresetId);
    saveSettingsDebounced();
}

export function loadOutfitPresetData(presetId) {
    const settings = extension_settings[extensionName];
    const preset = settings.outfitPresets[presetId];

    if (!preset) return;

    const fields = ['nameCN', 'nameEN', 'upperBody', 'upperBodyBack', 'fullBody', 'fullBodyBack'];
    fields.forEach(field => {
        const element = document.getElementById(`outfit_${field}`);
        if (element) {
            element.value = preset[field] || '';
            // 隐藏未保存警告
            const warning = element.closest('.st-chatu8-field-col')?.querySelector('.st-chatu8-unsaved-warning');
            if (warning) $(warning).hide();
        }
    });

    // 加载是否发送图片设置
    const sendPhotoElement = document.getElementById('outfit_send_photo');
    if (sendPhotoElement) {
        sendPhotoElement.checked = preset.sendPhoto === true; // 默认为 false
    }

    // 加载服装照片和提示词
    loadOutfitPhoto(preset);

    // 初始计算 token 占用
    debouncedUpdateOutfitTokenCounts();
}

function updateOutfitPreset() {
    const settings = extension_settings[extensionName];
    const presetId = settings.outfitPresetId;

    if (!presetId || !settings.outfitPresets[presetId]) {
        toastr.warning('没有活动的服装预设可保存。请先"另存为"一个新预设。');
        return;
    }

    // 直接保存，不弹确认框
    saveCurrentOutfitData(presetId);
    toastr.success(`服装预设 "${presetId}" 已保存`);
}

function saveOutfitPresetAs() {
    // 获取当前角色卡名称作为前缀
    const stContext = getContext();
    const cardPrefix = stContext?.name2 ? `[${stContext.name2}]` : '';
    const defaultName = cardPrefix || '';

    stylInput("请输入新服装预设的名称", defaultName).then((result) => {
        if (result && result.trim() !== '') {
            const settings = extension_settings[extensionName];
            saveCurrentOutfitData(result);
            settings.outfitPresetId = result;
            loadOutfitPresetList();
            alert(`服装预设 "${result}" 已保存。`);
        }
    });
}

function createNewOutfitPreset() {
    // 获取当前角色卡名称作为前缀
    const stContext = getContext();
    const cardPrefix = stContext?.name2 ? `[${stContext.name2}]` : '';
    const defaultName = cardPrefix || '';

    stylInput("请输入新服装预设的名称", defaultName).then((result) => {
        if (result && result.trim() !== '') {
            const settings = extension_settings[extensionName];

            // 检查名称是否已存在
            if (settings.outfitPresets[result]) {
                alert(`服装预设 "${result}" 已存在，请使用其他名称。`);
                return;
            }

            // 创建空白预设数据
            const emptyPreset = {
                nameCN: "",
                nameEN: "",
                owner: "",
                upperBody: "",
                upperBodyBack: "",
                fullBody: "",
                fullBodyBack: "",
                photoImageIds: [],
                photoPrompt: "",
                sendPhoto: false
            };

            // 保存空白预设
            settings.outfitPresets[result] = emptyPreset;
            settings.outfitPresetId = result;
            saveSettingsDebounced();

            // 刷新界面
            loadOutfitPresetList();
            loadOutfitPresetData(result);

            toastr.success(`空白服装预设 "${result}" 已创建。`);
        }
    });
}

function renameOutfitPreset() {
    const settings = extension_settings[extensionName];
    const currentName = settings.outfitPresetId;
    if (!currentName || !settings.outfitPresets[currentName]) {
        alert("没有活动的服装预设可重命名。");
        return;
    }
    if (currentName === "默认服装") {
        alert("默认预设不能重命名。");
        return;
    }
    
    stylInput("请输入新的服装预设名称", currentName).then((newName) => {
        if (newName && newName.trim() !== '' && newName !== currentName) {
            if (settings.outfitPresets[newName]) {
                alert("该名称已存在，请换一个名称。");
                return;
            }
            
            settings.outfitPresets[newName] = settings.outfitPresets[currentName];
            delete settings.outfitPresets[currentName];
            
            settings.outfitPresetId = newName;
            
            saveSettingsDebounced();
            loadOutfitPresetList();
            
            try {
                if (typeof window.loadSilterTavernChatu8Settings === 'function') {
                    window.loadSilterTavernChatu8Settings();
                }
            } catch (error) {
                console.warn('Failed to refresh UI after renaming preset:', error);
            }
            toastr.success(`服装预设已重命名为 "${newName}"`);
        }
    });
}

function saveCurrentOutfitData(presetId) {
    const settings = extension_settings[extensionName];
    const preset = {};

    // 保存所有新字段
    const fields = ['nameCN', 'nameEN', 'upperBody', 'upperBodyBack', 'fullBody', 'fullBodyBack'];
    fields.forEach(field => {
        const element = document.getElementById(`outfit_${field}`);
        if (element) {
            preset[field] = element.value || '';
        }
    });

    // 保存服装照片提示词
    const photoPromptElement = document.getElementById('outfit_photo_prompt');
    if (photoPromptElement) {
        preset.photoPrompt = photoPromptElement.value || '';
    }

    // 保存是否发送图片设置
    const sendPhotoElement = document.getElementById('outfit_send_photo');
    if (sendPhotoElement) {
        preset.sendPhoto = sendPhotoElement.checked;
    }

    // 保留现有的照片 ID 数组（照片是通过生成功能保存的）
    const existingPreset = settings.outfitPresets[presetId] || {};
    preset.photoImageIds = existingPreset.photoImageIds || [];

    settings.outfitPresets[presetId] = preset;
    saveSettingsDebounced();
}

function deleteOutfitPreset() {
    const settings = extension_settings[extensionName];
    const presetId = document.getElementById('outfit_preset_id')?.value;

    if (presetId === "默认服装") {
        alert("默认预设不能删除");
        return;
    }

    stylishConfirm("是否确定删除该服装预设").then((result) => {
        if (result) {
            delete settings.outfitPresets[presetId];
            settings.outfitPresetId = "默认服装";
            loadOutfitPresetList();
            loadOutfitPreset();
            saveSettingsDebounced();
        }
    });
}

async function exportOutfitPreset() {
    const settings = extension_settings[extensionName];
    const presetId = settings.outfitPresetId;
    const preset = settings.outfitPresets[presetId];

    if (!preset) {
        alert("没有选中的服装预设可导出。");
        return;
    }

    let dataToExport = {
        outfits: { [presetId]: preset }
    };

    // 收集并导出图片数据
    const imageIdsToExport = new Set();

    // 收集服装图片
    if (preset.photoImageIds && preset.photoImageIds.length > 0) {
        preset.photoImageIds.forEach(id => imageIdsToExport.add(id));
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
                console.error(`[OutfitPreset] 获取图片 ${imageId} 失败:`, error);
            }
        }
        console.log(`[OutfitPreset] 导出 ${Object.keys(dataToExport.images).length} 张图片`);
    }

    // 使用统一的加密导出函数
    dataToExport = await encryptExportData(dataToExport);

    const dataStr = JSON.stringify(dataToExport, null, 2);
    const blob = new Blob([dataStr], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `st-chatu8-服装-${presetId}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

async function exportAllOutfitPresets() {
    const settings = extension_settings[extensionName];
    if (!settings.outfitPresets || Object.keys(settings.outfitPresets).length === 0) {
        alert("没有服装预设可导出。");
        return;
    }

    // 收集所有使用这些服装的角色
    const allOutfitNames = new Set(Object.keys(settings.outfitPresets));
    const relatedCharacters = {};

    for (const charName in settings.characterPresets) {
        const charPreset = settings.characterPresets[charName];
        const charOutfits = charPreset.outfits || [];

        // 检查该角色是否使用了要导出的任何服装
        const hasRelatedOutfit = charOutfits.some(outfitName => allOutfitNames.has(outfitName));
        if (hasRelatedOutfit) {
            relatedCharacters[charName] = charPreset;
        }
    }

    let dataToExport = {
        outfits: settings.outfitPresets
    };

    // 如果有使用这些服装的角色,询问用户是否一起导出
    if (Object.keys(relatedCharacters).length > 0) {
        const confirmMessage = `检测到 ${Object.keys(relatedCharacters).length} 个角色使用了这些服装:\n${Object.keys(relatedCharacters).join('\n')}\n\n是否一起导出相关角色?`;
        const includeCharacters = await stylishConfirm(confirmMessage);

        if (includeCharacters) {
            dataToExport.characters = relatedCharacters;
        }
    }

    // 收集并导出图片数据
    const imageIdsToExport = new Set();

    // 收集所有服装的图片
    for (const outfitName in settings.outfitPresets) {
        const outfit = settings.outfitPresets[outfitName];
        if (outfit.photoImageIds && outfit.photoImageIds.length > 0) {
            outfit.photoImageIds.forEach(id => imageIdsToExport.add(id));
        }
    }

    // 收集角色图片（如果导出了角色）
    if (dataToExport.characters) {
        for (const charName in dataToExport.characters) {
            const charPreset = dataToExport.characters[charName];
            if (charPreset.photoImageIds && charPreset.photoImageIds.length > 0) {
                charPreset.photoImageIds.forEach(id => imageIdsToExport.add(id));
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
                console.error(`[OutfitPreset] 获取图片 ${imageId} 失败:`, error);
            }
        }
        console.log(`[OutfitPreset] 导出全部：共 ${Object.keys(dataToExport.images).length} 张图片`);
    }

    // 使用统一的加密导出函数
    dataToExport = await encryptExportData(dataToExport);

    const dataStr = JSON.stringify(dataToExport, null, 2);
    const blob = new Blob([dataStr], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "st-chatu8-服装-全部.json";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

function importOutfitPreset() {
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

                // 检查新格式(包含outfits)或旧格式(直接是预设对象)
                let outfitsToImport = {};
                let imagesToImport = importedData.images || {};

                if (importedData.outfits) {
                    // 新格式
                    outfitsToImport = importedData.outfits;
                } else {
                    // 旧格式,直接是服装预设
                    outfitsToImport = importedData;
                }

                // 导入图片（如果有）
                let importedImagesCount = 0;
                const imageIdMapping = {}; // 旧ID -> 新ID 映射

                if (Object.keys(imagesToImport).length > 0) {
                    console.log(`[OutfitPreset] 正在导入 ${Object.keys(imagesToImport).length} 张图片...`);

                    for (const oldImageId in imagesToImport) {
                        try {
                            const imageData = imagesToImport[oldImageId];
                            // 保存图片并获取新的 ID
                            const newImageId = await saveConfigImage(imageData);
                            imageIdMapping[oldImageId] = newImageId;
                            importedImagesCount++;
                        } catch (error) {
                            console.error(`[OutfitPreset] 导入图片 ${oldImageId} 失败:`, error);
                        }
                    }

                    console.log(`[OutfitPreset] 成功导入 ${importedImagesCount} 张图片`);

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

                let newPresetsCount = 0;
                for (const key in outfitsToImport) {
                    if (outfitsToImport.hasOwnProperty(key)) {
                        if (!settings.outfitPresets.hasOwnProperty(key)) {
                            newPresetsCount++;
                        }
                        settings.outfitPresets[key] = outfitsToImport[key];
                    }
                }
                saveSettingsDebounced();
                loadOutfitPresetList();

                // 自动选择第一个导入的预设
                const firstImportedKey = Object.keys(outfitsToImport)[0];
                if (firstImportedKey) {
                    settings.outfitPresetId = firstImportedKey;
                    const select = document.getElementById('outfit_preset_id');
                    if (select) select.value = firstImportedKey;
                    loadOutfitPresetData(firstImportedKey);
                }

                let message = `成功导入 ${Object.keys(outfitsToImport).length} 个服装预设，其中 ${newPresetsCount} 个是全新的。`;
                if (importedImagesCount > 0) {
                    message += `\n同时导入 ${importedImagesCount} 张图片。`;
                }
                alert(message);
            } catch (err) {
                alert("导入失败，请确保文件是正确的JSON格式。\n错误信息: " + err.message);
                console.error("Error importing outfit presets:", err);
            }
        };
        reader.readAsText(file);
    };
    input.click();
}

/**
 * 打开服装预设可视化选择器
 */
function handleOutfitVisualSelect() {
    showOutfitVisualSelector((presetName) => {
        // 选择后更新下拉框
        const select = document.getElementById('outfit_preset_id');
        if (select) {
            select.value = presetName;
        }
    });
}

function bindOutfitFieldListeners() {
    // 监听所有字段变化，显示/隐藏未保存警告
    const fields = ['nameCN', 'nameEN', 'upperBody', 'fullBody'];
    fields.forEach(field => {
        const element = document.getElementById(`outfit_${field}`);
        if (element) {
            $(element).on('input', function () {
                const settings = extension_settings[extensionName];
                const presetName = settings.outfitPresetId;
                const currentPreset = settings.outfitPresets[presetName] || {};
                const isDirty = $(this).val() !== (currentPreset[field] || '');
                const warning = $(this).closest('.st-chatu8-field-col').find('.st-chatu8-unsaved-warning');

                if (isDirty) {
                    $(warning).show();
                } else {
                    $(warning).hide();
                }
            });

            // 绑定 token 计数
            $(element).on('input', debouncedUpdateOutfitTokenCounts);
        }
    });

    // 为带有背面的字段也绑定 token 计数
    const backFields = ['upperBodyBack', 'fullBodyBack'];
    backFields.forEach(field => {
        const element = document.getElementById(`outfit_${field}`);
        if (element) {
            $(element).on('input', debouncedUpdateOutfitTokenCounts);
        }
    });
}

export async function updateOutfitTokenCounts() {
    let totalTokens = 0;
    const tokenCounts = {};

    const tokenFields = ['upperBody', 'upperBodyBack', 'fullBody', 'fullBodyBack'];

    for (const field of tokenFields) {
        const element = document.getElementById(`outfit_${field}`);
        if (element) {
            const count = await calculateNovelAITokens(element.value || '');
            tokenCounts[field] = count;
            totalTokens += count;
        } else {
            tokenCounts[field] = 0;
        }
    }

    for (const field of tokenFields) {
        const display = document.getElementById(`outfit_${field}_tokens`);
        if (display) {
            display.textContent = `当前占用: ${tokenCounts[field] || 0} | 总占用: ${totalTokens}`;
        }
    }

    // 计算 2 种全身组合的 token 总和
    const frontTotal = (tokenCounts.upperBody || 0) + (tokenCounts.fullBody || 0);
    const backTotal = (tokenCounts.upperBodyBack || 0) + (tokenCounts.fullBodyBack || 0);

    // 渲染到 DOM
    const elFront = document.getElementById('token_combo_outfit_front');
    const elBack = document.getElementById('token_combo_outfit_back');
    
    if (elFront) elFront.textContent = `正面全身: ${frontTotal}`;
    if (elBack) elBack.textContent = `背面全身: ${backTotal}`;
}

let outfitTokenCalcTimeout;
export function debouncedUpdateOutfitTokenCounts() {
    clearTimeout(outfitTokenCalcTimeout);
    outfitTokenCalcTimeout = setTimeout(updateOutfitTokenCounts, 300);
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
 * 清空服装详细参数
 * 清空所有服装描述字段（不包括中英文名称）
 */
async function clearOutfitDetailParameters() {
    const confirmed = await stylishConfirm(
        '确定要清空所有详细参数吗？\n\n' +
        '这将清空以下字段：\n' +
        '- 上半身描述（正面/背面）\n' +
        '- 全身描述（正面/背面）\n\n' +
        '此操作不会自动保存，您需要手动保存更改。'
    );

    if (!confirmed) {
        return;
    }

    // 要清空的字段列表
    const fieldsToClean = [
        'upperBody', 'upperBodyBack',
        'fullBody', 'fullBodyBack'
    ];

    // 清空所有字段
    fieldsToClean.forEach(field => {
        const element = document.getElementById(`outfit_${field}`);
        if (element) {
            element.value = '';
            // 触发 input 事件以更新 UI 状态（显示未保存警告）
            $(element).trigger('input');
        }
    });

    toastr.success('详细参数已清空，请记得保存更改。');
}

/**
 * 翻译服装管理页面的服装描述字段
 * 使用 LLM 翻译上半身、上半身背面、下半身、下半身背面的提示词
 * 将所有字段合并为一次请求，减少 API 调用
 */
async function translateOutfitFields() {
    // 需要翻译的字段列表（不包括中英文名称）
    const fields = ['upperBody', 'upperBodyBack', 'fullBody', 'fullBodyBack'];

    // 收集所有需要翻译的内容
    const fieldsToTranslate = [];
    const allTags = [];

    // 正则：移除已有的中文括号及其内容 "xxx（yyy）" -> "xxx"
    const removeChineseParenRegex = /（[^）]*）/g;

    for (const field of fields) {
        const element = document.getElementById(`outfit_${field}`);
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
    toastr.info('正在翻译服装描述...', '请稍候', { timeOut: 0, extendedTimeOut: 0 });

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

// ========== 服装照片相关 ==========

/**
 * 加载服装照片和提示词
 */
async function loadOutfitPhoto(preset) {
    const photoPreview = document.getElementById('outfit_photo_preview');
    const photoPlaceholder = document.getElementById('outfit_photo_placeholder');
    const photoPromptElement = document.getElementById('outfit_photo_prompt');

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

                // 添加点击事件以查看大图
                photoPreview.style.cursor = 'pointer';
                photoPreview.onclick = () => showOutfitImageViewer(imageIds, selectedIndex);

                return;
            }
        } catch (error) {
            console.error('[OutfitPreset] 加载服装照片失败:', error);
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
 */
async function handleOutfitPhotoGenerate() {
    const settings = extension_settings[extensionName];
    const presetId = settings.outfitPresetId;
    const preset = settings.outfitPresets[presetId];

    if (!preset) {
        toastr.warning('请先选择一个服装预设');
        return;
    }

    const photoPromptElement = document.getElementById('outfit_photo_prompt');
    const prompt = photoPromptElement?.value?.trim() || '';

    if (!prompt) {
        toastr.warning('请先输入图片生成提示词');
        return;
    }

    const requestId = `outfit_photo_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    toastr.info('正在生成服装图片...', '请稍候', { timeOut: 0, extendedTimeOut: 0 });

    const handleResponse = async (responseData) => {
        if (responseData.id !== requestId) {
            return;
        }

        // 从活动请求映射表中移除此请求
        const requestInfo = activeOutfitPhotoRequests.get(requestId);
        if (requestInfo) {
            eventSource.removeListener(EventType.GENERATE_IMAGE_RESPONSE, requestInfo.listener);
            activeOutfitPhotoRequests.delete(requestId);
        }

        toastr.clear();

        if (responseData.success && responseData.imageData) {
            try {
                const imageId = await saveConfigImage(responseData.imageData);

                if (!preset.photoImageIds) {
                    preset.photoImageIds = [];
                }

                // 将新图片追加到数组末尾，并更新选中索引为最新图片
                preset.photoImageIds.push(imageId);
                preset.selectedPhotoIndex = preset.photoImageIds.length - 1;
                saveSettingsDebounced();

                const photoPreview = document.getElementById('outfit_photo_preview');
                const photoPlaceholder = document.getElementById('outfit_photo_placeholder');

                if (photoPreview && photoPlaceholder) {
                    photoPreview.src = responseData.imageData;
                    photoPreview.style.display = 'block';
                    photoPlaceholder.style.display = 'none';

                    photoPreview.style.cursor = 'pointer';
                    photoPreview.onclick = () => showOutfitImageViewer(preset.photoImageIds, preset.photoImageIds.length - 1);
                }

                toastr.success('服装图片生成成功');
            } catch (error) {
                console.error('[OutfitPreset] 保存图片失败:', error);
                toastr.error('保存图片失败: ' + error.message);
            }
        } else {
            toastr.error('图片生成失败: ' + (responseData.error || '未知错误'));
        }
    };

    // 将此请求添加到活动请求映射表
    activeOutfitPhotoRequests.set(requestId, {
        listener: handleResponse,
        timestamp: Date.now()
    });

    // 注册监听器
    eventSource.on(EventType.GENERATE_IMAGE_RESPONSE, handleResponse);

    eventSource.emit(EventType.GENERATE_IMAGE_REQUEST, {
        id: requestId,
        prompt: prompt,
    });
}

/**
 * 生成图片提示词按钮处理
 */
function handleOutfitPhotoGeneratePrompt() {
    handleOutfitPhotoGeneratePromptClick();
}

/**
 * 处理服装照片上传
 * 读取用户选择的图片文件，保存到 configDatabase，更新 UI
 */
async function handleOutfitPhotoUpload(event) {
    const input = event.target;
    if (!input.files || !input.files[0]) return;

    const settings = extension_settings[extensionName];
    const presetId = settings.outfitPresetId;
    const preset = settings.outfitPresets[presetId];

    if (!preset) {
        toastr.warning('请先选择一个服装预设');
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
            const photoPreview = document.getElementById('outfit_photo_preview');
            const photoPlaceholder = document.getElementById('outfit_photo_placeholder');

            if (photoPreview && photoPlaceholder) {
                photoPreview.src = imageData;
                photoPreview.style.display = 'block';
                photoPlaceholder.style.display = 'none';

                // 更新点击事件
                photoPreview.style.cursor = 'pointer';
                photoPreview.onclick = () => showOutfitImageViewer(preset.photoImageIds, preset.photoImageIds.length - 1);
            }

            toastr.success('服装照片上传成功');
        } catch (error) {
            console.error('[OutfitPreset] 上传照片失败:', error);
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
 * 修改服装提示词按钮处理
 */
function handleOutfitPhotoModifyPrompt() {
    const uploadedImages = [];

    const parent = document.getElementById('st-chatu8-settings') || document.body;

    const backdrop = document.createElement('div');
    backdrop.className = 'st-chatu8-confirm-backdrop';

    const modal = document.createElement('div');
    modal.className = 'st-chatu8-confirm-box st-chatu8-popup-modal';

    const title = document.createElement('h3');
    title.className = 'st-chatu8-popup-title';
    title.textContent = '修改服装提示词';
    modal.appendChild(title);

    const description = document.createElement('p');
    description.className = 'st-chatu8-popup-description';
    description.textContent = '请输入您的修改需求，AI 将根据需求调整服装提示词：';
    modal.appendChild(description);

    const textarea = document.createElement('textarea');
    textarea.className = 'st-chatu8-textarea';
    textarea.rows = 4;
    textarea.placeholder = '例如：增加更多细节描述、调整颜色描述、添加配饰细节...';
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
                console.error('[outfitPreset] Failed to read image:', err);
            }
        }

        updateImagePreviews();
        fileInput.value = '';
    });

    imageUploadSection.appendChild(uploadHeader);
    imageUploadSection.appendChild(fileInput);
    imageUploadSection.appendChild(imagePreviewContainer);
    modal.appendChild(imageUploadSection);

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

    setTimeout(() => textarea.focus(), 100);

    const closeModal = () => {
        parent.removeChild(backdrop);
    };

    cancelButton.addEventListener('click', closeModal);

    confirmButton.addEventListener('click', () => {
        const userRequirement = textarea.value.trim();
        closeModal();
        handleOutfitPromptModify(userRequirement, [...uploadedImages]);
    });
}

/**
 * 翻译服装照片提示词
 */
async function translateOutfitPhotoPrompt() {
    const element = document.getElementById('outfit_photo_prompt');
    if (!element || !element.value || !element.value.trim()) {
        toastr.info('没有找到需要翻译的提示词内容。');
        return;
    }

    const removeChineseParenRegex = /（[^）]*）/g;
    const originalValue = element.value;
    const cleanedValue = originalValue.replace(removeChineseParenRegex, '').trim();

    const tags = cleanedValue.split(/[,，]/).map(s => s.trim()).filter(Boolean);
    if (tags.length === 0) {
        toastr.info('没有找到需要翻译的内容。');
        return;
    }

    const uniqueTags = [...new Set(tags)];

    toastr.info('正在翻译提示词...', '请稍候', { timeOut: 0, extendedTimeOut: 0 });

    try {
        const combinedText = uniqueTags.join(', ');
        const result = await translatePromptTags(combinedText);

        if (result && result.results) {
            const translationMap = {};
            for (const item of result.results) {
                if (item.original && item.translation) {
                    translationMap[item.original.toLowerCase()] = `${item.original}（${item.translation}）`;
                } else if (item.original) {
                    translationMap[item.original.toLowerCase()] = item.original;
                }
            }

            const translatedTags = tags.map(tag => {
                return translationMap[tag.toLowerCase()] || tag;
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

/**
 * 显示服装图片全屏查看器（支持多图片导航）
 */
async function showOutfitImageViewer(imageIds, initialIndex) {
    const settings = extension_settings[extensionName];
    const presetId = settings.outfitPresetId;
    const preset = settings.outfitPresets[presetId];

    if (!imageIds || imageIds.length === 0) {
        toastr.warning('没有可显示的图片');
        return;
    }

    let currentIndex = Math.max(0, Math.min(initialIndex, imageIds.length - 1));

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

    const imageArea = document.createElement('div');
    imageArea.style.cssText = `
        display: flex;
        align-items: center;
        gap: 15px;
        position: relative;
    `;

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

    const img = document.createElement('img');
    img.style.cssText = `
        max-width: calc(95vw - 180px);
        max-height: calc(95vh - 160px);
        object-fit: contain;
        border-radius: 8px;
        box-shadow: 0 4px 16px rgba(0, 0, 0, 0.3);
    `;
    imageArea.appendChild(img);

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

    const indexIndicator = document.createElement('div');
    indexIndicator.style.cssText = `
        margin-top: 12px;
        font-size: 14px;
        color: inherit;
        opacity: 0.8;
    `;
    container.appendChild(indexIndicator);

    const buttonContainer = document.createElement('div');
    buttonContainer.style.cssText = `
        display: flex;
        gap: 15px;
        margin-top: 20px;
        justify-content: center;
    `;

    const downloadButton = document.createElement('button');
    downloadButton.innerHTML = '<i class="fa-solid fa-download"></i> 下载图片';
    downloadButton.className = 'st-chatu8-btn';
    downloadButton.style.cssText = `
        background: linear-gradient(135deg, #28a745 0%, #20c997 100%);
        padding: 10px 20px;
        font-size: 14px;
    `;
    buttonContainer.appendChild(downloadButton);

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

    const imageCache = {};

    const loadImage = async (index) => {
        if (index < 0 || index >= imageIds.length) return;

        currentIndex = index;
        const imageId = imageIds[currentIndex];

        indexIndicator.textContent = `${currentIndex + 1} / ${imageIds.length}`;

        leftButton.style.opacity = currentIndex === 0 ? '0.3' : '1';
        leftButton.style.pointerEvents = currentIndex === 0 ? 'none' : 'auto';
        rightButton.style.opacity = currentIndex === imageIds.length - 1 ? '0.3' : '1';
        rightButton.style.pointerEvents = currentIndex === imageIds.length - 1 ? 'none' : 'auto';

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
            console.error('[OutfitPreset] 加载图片失败:', error);
            img.src = '';
        }
    };

    const closeViewer = async () => {
        document.removeEventListener('keydown', handleKeyDown);

        // 保存当前选中的图片索引
        if (preset) {
            preset.selectedPhotoIndex = currentIndex;
            saveSettingsDebounced();

            // 更新主界面预览图显示选中的图片
            const photoPreview = document.getElementById('outfit_photo_preview');
            const photoPlaceholder = document.getElementById('outfit_photo_placeholder');
            if (imageIds.length > 0 && currentIndex >= 0 && currentIndex < imageIds.length) {
                try {
                    const selectedImageId = imageIds[currentIndex];
                    const imageData = imageCache[selectedImageId] || await getConfigImage(selectedImageId);
                    if (imageData && photoPreview && photoPlaceholder) {
                        photoPreview.src = imageData;
                        photoPreview.style.display = 'block';
                        photoPlaceholder.style.display = 'none';
                        photoPreview.style.cursor = 'pointer';
                        photoPreview.onclick = () => showOutfitImageViewer(imageIds, currentIndex);
                    }
                } catch (error) {
                    console.error('[OutfitPreset] 更新预览图失败:', error);
                }
            }
        }

        parent.removeChild(backdrop);
    };

    const handleKeyDown = (e) => {
        if (e.key === 'ArrowLeft' && currentIndex > 0) {
            loadImage(currentIndex - 1);
        } else if (e.key === 'ArrowRight' && currentIndex < imageIds.length - 1) {
            loadImage(currentIndex + 1);
        } else if (e.key === 'Escape') {
            closeViewer();
        }
    };

    leftButton.addEventListener('click', () => {
        if (currentIndex > 0) loadImage(currentIndex - 1);
    });

    rightButton.addEventListener('click', () => {
        if (currentIndex < imageIds.length - 1) loadImage(currentIndex + 1);
    });

    closeButton.addEventListener('click', closeViewer);
    document.addEventListener('keydown', handleKeyDown);

    downloadButton.addEventListener('click', () => {
        try {
            const currentImageData = imageCache[imageIds[currentIndex]];
            if (!currentImageData) {
                toastr.warning('图片未加载完成');
                return;
            }

            const link = document.createElement('a');
            link.href = currentImageData;

            const outfitName = preset?.nameCN || preset?.nameEN || presetId || 'outfit';
            const timestamp = new Date().toISOString().slice(0, 10);
            link.download = `${outfitName}_${currentIndex + 1}_${timestamp}.png`;

            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);

            toastr.success('图片下载成功');
        } catch (error) {
            console.error('[OutfitPreset] 下载图片失败:', error);
            toastr.error('下载图片失败: ' + error.message);
        }
    });

    deleteButton.addEventListener('click', async () => {
        const confirmed = await stylishConfirm('确定要删除这张服装图片吗？此操作不可撤销。');

        if (confirmed) {
            try {
                const imageIdToDelete = imageIds[currentIndex];

                if (imageIdToDelete) {
                    await deleteConfigImage(imageIdToDelete);
                }

                if (preset && preset.photoImageIds) {
                    const deleteIndex = preset.photoImageIds.indexOf(imageIdToDelete);
                    if (deleteIndex > -1) {
                        preset.photoImageIds.splice(deleteIndex, 1);
                        saveSettingsDebounced();
                    }
                }

                imageIds.splice(currentIndex, 1);

                if (imageIds.length > 0) {
                    if (currentIndex >= imageIds.length) {
                        currentIndex = imageIds.length - 1;
                    }
                    loadImage(currentIndex);
                    toastr.success('图片已删除');
                } else {
                    closeViewer();
                    toastr.success('图片已删除');

                    const photoPreview = document.getElementById('outfit_photo_preview');
                    const photoPlaceholder = document.getElementById('outfit_photo_placeholder');

                    if (photoPreview && photoPlaceholder) {
                        photoPreview.src = '';
                        photoPreview.style.display = 'none';
                        photoPreview.onclick = null;
                        photoPreview.style.cursor = 'default';
                        photoPlaceholder.style.display = 'flex';
                    }
                }

                delete imageCache[imageIdToDelete];

            } catch (error) {
                console.error('[OutfitPreset] 删除图片失败:', error);
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
                console.error('[OutfitPreset] 删除其他图片失败:', error);
                toastr.error('删除其他图片失败: ' + error.message);
            }
        }
    });

    await loadImage(currentIndex);
}
