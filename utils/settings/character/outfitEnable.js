// @ts-nocheck
/**
 * 通用服装列表管理模块
 * 处理通用服装启用列表的 CRUD 操作和导入导出
 */

import { extension_settings } from "../../../../../../extensions.js";
import { saveSettingsDebounced } from "../../../../../../../script.js";
import { extensionName } from '../../config.js';
import { stylInput, stylishConfirm } from '../../ui_common.js';
import { encryptExportData, decryptImportData } from './crypto.js';
import { loadOutfitPresetList } from './outfitPreset.js';

// ========== 通用服装列表管理 ==========

/**
 * 设置通用服装列表管理控件
 */
export function setupOutfitEnableControls(container) {
    // 加载预设列表
    loadOutfitEnablePresetList();

    // 绑定预设选择
    container.find('#outfit_enable_preset_id').on('change', loadOutfitEnablePreset);

    // 绑定按钮
    container.find('#outfit_enable_new').on('click', createNewOutfitEnablePreset);
    container.find('#outfit_enable_rename').on('click', renameOutfitEnablePreset);
    container.find('#outfit_enable_update').on('click', updateOutfitEnablePreset);
    container.find('#outfit_enable_save_as').on('click', saveOutfitEnablePresetAs);
    container.find('#outfit_enable_export').on('click', exportOutfitEnablePreset);
    container.find('#outfit_enable_export_all').on('click', exportAllOutfitEnablePresets);
    container.find('#outfit_enable_import').on('click', importOutfitEnablePreset);
    container.find('#outfit_enable_delete').on('click', deleteOutfitEnablePreset);
    container.find('#outfit_enable_check').on('click', checkOutfitEnableList);
    container.find('#outfit_enable_add').on('click', addOutfitFromEnableSelector);
    container.find('#outfit_enable_refresh').on('click', loadOutfitEnableSelector);

    // 加载当前预设
    loadOutfitEnablePreset();

    // 加载服装选择器
    loadOutfitEnableSelector();
}

export function loadOutfitEnablePresetList() {
    const settings = extension_settings[extensionName];
    const select = document.getElementById('outfit_enable_preset_id');

    if (!select) return;

    select.innerHTML = '';

    for (const presetName in settings.outfitEnablePresets) {
        const option = document.createElement('option');
        option.value = presetName;
        option.textContent = presetName;
        select.add(option);
    }

    select.value = settings.outfitEnablePresetId;
}

export function loadOutfitEnablePreset() {
    const settings = extension_settings[extensionName];
    const select = document.getElementById('outfit_enable_preset_id');
    if (!select) return;

    const presetId = select.value;
    settings.outfitEnablePresetId = presetId;

    const preset = settings.outfitEnablePresets[presetId];
    const textarea = document.getElementById('outfit_enable_list');

    if (textarea && preset) {
        textarea.value = (preset.outfits || []).join('\n');
    }

    saveSettingsDebounced();
}

function updateOutfitEnablePreset() {
    const settings = extension_settings[extensionName];
    const presetId = settings.outfitEnablePresetId;

    if (!presetId || !settings.outfitEnablePresets[presetId]) {
        toastr.warning('没有活动的通用服装列表预设可保存。请先"另存为"一个新预设。');
        return;
    }

    // 直接保存，不弹确认框
    saveCurrentOutfitEnableData(presetId);
    toastr.success(`通用服装列表预设 "${presetId}" 已保存`);
}

function saveOutfitEnablePresetAs() {
    stylInput("请输入新通用服装列表预设的名称").then((result) => {
        if (result && result.trim() !== '') {
            const settings = extension_settings[extensionName];
            saveCurrentOutfitEnableData(result);
            settings.outfitEnablePresetId = result;
            loadOutfitEnablePresetList();
            alert(`通用服装列表预设 "${result}" 已保存。`);
        }
    });
}

function createNewOutfitEnablePreset() {
    stylInput("请输入新通用服装列表预设的名称").then((result) => {
        if (result && result.trim() !== '') {
            const settings = extension_settings[extensionName];

            if (settings.outfitEnablePresets[result]) {
                alert(`通用服装列表预设 "${result}" 已存在，请使用其他名称。`);
                return;
            }

            settings.outfitEnablePresets[result] = {
                outfits: []
            };
            settings.outfitEnablePresetId = result;
            saveSettingsDebounced();

            loadOutfitEnablePresetList();
            loadOutfitEnablePreset();

            toastr.success(`空白通用服装列表预设 "${result}" 已创建。`);
        }
    });
}

function renameOutfitEnablePreset() {
    const settings = extension_settings[extensionName];
    const currentName = settings.outfitEnablePresetId;
    if (!currentName || !settings.outfitEnablePresets[currentName]) {
        alert("没有活动的通用服装列表预设可重命名。");
        return;
    }
    if (currentName === "默认服装列表") {
        alert("默认预设不能重命名。");
        return;
    }
    
    stylInput("请输入新的通用服装列表预设名称", currentName).then((newName) => {
        if (newName && newName.trim() !== '' && newName !== currentName) {
            if (settings.outfitEnablePresets[newName]) {
                alert("该名称已存在，请换一个名称。");
                return;
            }
            
            settings.outfitEnablePresets[newName] = settings.outfitEnablePresets[currentName];
            delete settings.outfitEnablePresets[currentName];
            
            settings.outfitEnablePresetId = newName;
            
            saveSettingsDebounced();
            loadOutfitEnablePresetList();
            
            try {
                if (typeof window.loadSilterTavernChatu8Settings === 'function') {
                    window.loadSilterTavernChatu8Settings();
                }
            } catch (error) {
                console.warn('Failed to refresh UI after renaming preset:', error);
            }
            toastr.success(`通用服装列表预设已重命名为 "${newName}"`);
        }
    });
}

function saveCurrentOutfitEnableData(presetId) {
    const settings = extension_settings[extensionName];
    const textarea = document.getElementById('outfit_enable_list');

    if (!textarea) return;

    const outfits = textarea.value
        .split('\n')
        .map(line => line.trim())
        .filter(line => line.length > 0);

    settings.outfitEnablePresets[presetId] = {
        outfits: outfits
    };

    saveSettingsDebounced();
}

function deleteOutfitEnablePreset() {
    const settings = extension_settings[extensionName];
    const presetId = document.getElementById('outfit_enable_preset_id')?.value;

    if (presetId === "默认服装列表") {
        alert("默认预设不能删除");
        return;
    }

    stylishConfirm("是否确定删除该通用服装列表预设").then((result) => {
        if (result) {
            delete settings.outfitEnablePresets[presetId];
            settings.outfitEnablePresetId = "默认服装列表";
            loadOutfitEnablePresetList();
            loadOutfitEnablePreset();
            saveSettingsDebounced();
        }
    });
}

async function exportOutfitEnablePreset() {
    const settings = extension_settings[extensionName];
    const presetId = settings.outfitEnablePresetId;
    const preset = settings.outfitEnablePresets[presetId];

    if (!preset) {
        alert("没有选中的通用服装列表预设可导出。");
        return;
    }

    const relatedOutfits = preset.outfits || [];

    let dataToExport = {
        outfitEnablePresets: { [presetId]: preset }
    };

    if (relatedOutfits.length > 0) {
        const confirmMessage = `检测到该列表包含 ${relatedOutfits.length} 个服装:\n${relatedOutfits.join('\n')}\n\n是否一起导出相关服装?`;
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

    dataToExport = await encryptExportData(dataToExport);

    const dataStr = JSON.stringify(dataToExport, null, 2);
    const blob = new Blob([dataStr], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `st-chatu8-通用服装列表-${presetId}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

async function exportAllOutfitEnablePresets() {
    const settings = extension_settings[extensionName];
    if (!settings.outfitEnablePresets || Object.keys(settings.outfitEnablePresets).length === 0) {
        alert("没有通用服装列表预设可导出。");
        return;
    }

    const allOutfits = new Set();

    for (const presetName in settings.outfitEnablePresets) {
        const preset = settings.outfitEnablePresets[presetName];
        const outfits = preset.outfits || [];
        outfits.forEach(outfitName => allOutfits.add(outfitName));
    }

    let dataToExport = {
        outfitEnablePresets: settings.outfitEnablePresets
    };

    if (allOutfits.size > 0) {
        const confirmMessage = `检测到所有列表共包含 ${allOutfits.size} 个不同的服装:\n${Array.from(allOutfits).join('\n')}\n\n是否一起导出相关服装?`;
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

    dataToExport = await encryptExportData(dataToExport);

    const dataStr = JSON.stringify(dataToExport, null, 2);
    const blob = new Blob([dataStr], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "st-chatu8-通用服装列表-全部.json";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

function importOutfitEnablePreset() {
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
                importedData = decryptImportData(importedData);

                let enablePresetsToImport = {};
                let outfitsToImport = {};

                if (importedData.outfitEnablePresets) {
                    enablePresetsToImport = importedData.outfitEnablePresets;
                    outfitsToImport = importedData.outfits || {};
                } else {
                    enablePresetsToImport = importedData;
                }

                let importOutfits = false;
                if (Object.keys(outfitsToImport).length > 0) {
                    const outfitNames = Object.keys(outfitsToImport);
                    const confirmMessage = `检测到 ${outfitNames.length} 个相关服装:\n${outfitNames.join('\n')}\n\n是否一起导入?`;
                    importOutfits = await stylishConfirm(confirmMessage);
                }

                let newEnablePresetsCount = 0;
                for (const key in enablePresetsToImport) {
                    if (enablePresetsToImport.hasOwnProperty(key)) {
                        if (!settings.outfitEnablePresets.hasOwnProperty(key)) {
                            newEnablePresetsCount++;
                        }
                        settings.outfitEnablePresets[key] = enablePresetsToImport[key];
                    }
                }

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
                loadOutfitEnablePresetList();
                if (importOutfits) {
                    loadOutfitPresetList();
                }

                const firstImportedKey = Object.keys(enablePresetsToImport)[0];
                if (firstImportedKey) {
                    settings.outfitEnablePresetId = firstImportedKey;
                    const select = document.getElementById('outfit_enable_preset_id');
                    if (select) select.value = firstImportedKey;
                    loadOutfitEnablePreset();
                }

                let message = `成功导入 ${Object.keys(enablePresetsToImport).length} 个通用服装列表预设，其中 ${newEnablePresetsCount} 个是全新的。`;
                if (importOutfits) {
                    message += `\n同时导入 ${Object.keys(outfitsToImport).length} 个服装预设，其中 ${newOutfitsCount} 个是全新的。`;
                }
                alert(message);
            } catch (err) {
                alert("导入失败，请确保文件是正确的JSON格式。\n错误信息: " + err.message);
                console.error("Error importing outfit enable presets:", err);
            }
        };
        reader.readAsText(file);
    };
    input.click();
}

export function loadOutfitEnableSelector() {
    const settings = extension_settings[extensionName];
    const select = document.getElementById('outfit_enable_selector');

    if (!select) return;

    select.innerHTML = '<option value="">-- 选择服装 --</option>';

    for (const presetName in settings.outfitPresets) {
        const option = document.createElement('option');
        option.value = presetName;
        option.textContent = presetName;
        select.add(option);
    }
}

function addOutfitFromEnableSelector() {
    const select = document.getElementById('outfit_enable_selector');
    const textarea = document.getElementById('outfit_enable_list');

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

function checkOutfitEnableList() {
    const settings = extension_settings[extensionName];
    const textarea = document.getElementById('outfit_enable_list');
    const resultDiv = document.getElementById('outfit_enable_check_result');
    const contentDiv = document.getElementById('outfit_enable_check_content');

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
