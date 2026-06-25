// @ts-nocheck
/**
 * 通用角色列表管理模块
 * 处理通用角色列表的 CRUD 操作和导入导出
 */

import { extension_settings } from "../../../../../../extensions.js";
import { saveSettingsDebounced } from "../../../../../../../script.js";
import { extensionName } from '../../config.js';
import { stylInput, stylishConfirm } from '../../ui_common.js';
import { encryptExportData, decryptImportData } from './crypto.js';
import { loadCharacterPresetList } from './characterPreset.js';
import { loadOutfitPresetList } from './outfitPreset.js';

// ========== 通用角色列表管理 ==========

/**
 * 设置通用角色列表管理控件
 */
export function setupCharacterCommonControls(container) {
    // 加载预设列表
    loadCharacterCommonPresetList();

    // 绑定预设选择
    container.find('#character_common_preset_id').on('change', loadCharacterCommonPreset);

    // 绑定按钮
    container.find('#character_common_new').on('click', createNewCharacterCommonPreset);
    container.find('#character_common_rename').on('click', renameCharacterCommonPreset);
    container.find('#character_common_update').on('click', updateCharacterCommonPreset);
    container.find('#character_common_save_as').on('click', saveCharacterCommonPresetAs);
    container.find('#character_common_export').on('click', exportCharacterCommonPreset);
    container.find('#character_common_export_all').on('click', exportAllCharacterCommonPresets);
    container.find('#character_common_import').on('click', importCharacterCommonPreset);
    container.find('#character_common_delete').on('click', deleteCharacterCommonPreset);
    container.find('#character_common_check').on('click', checkCharacterCommonList);
    container.find('#character_common_add').on('click', addCharacterFromCommonSelector);
    container.find('#character_common_refresh').on('click', loadCharacterCommonSelector);

    // 加载当前预设
    loadCharacterCommonPreset();

    // 加载角色选择器
    loadCharacterCommonSelector();
}

export function loadCharacterCommonPresetList() {
    const settings = extension_settings[extensionName];
    const select = document.getElementById('character_common_preset_id');

    if (!select) return;

    select.innerHTML = '';

    for (const presetName in settings.characterCommonPresets) {
        const option = document.createElement('option');
        option.value = presetName;
        option.textContent = presetName;
        select.add(option);
    }

    select.value = settings.characterCommonPresetId;
}

export function loadCharacterCommonPreset() {
    const settings = extension_settings[extensionName];
    const select = document.getElementById('character_common_preset_id');
    if (!select) return;

    const presetId = select.value;
    settings.characterCommonPresetId = presetId;

    const preset = settings.characterCommonPresets[presetId];
    const textarea = document.getElementById('character_common_list');

    if (textarea && preset) {
        textarea.value = (preset.characters || []).join('\n');
    }

    saveSettingsDebounced();
}

function updateCharacterCommonPreset() {
    const settings = extension_settings[extensionName];
    const presetId = settings.characterCommonPresetId;

    if (!presetId || !settings.characterCommonPresets[presetId]) {
        toastr.warning('没有活动的通用角色列表预设可保存。请先"另存为"一个新预设。');
        return;
    }

    // 直接保存，不弹确认框
    saveCurrentCharacterCommonData(presetId);
    toastr.success(`通用角色列表预设 "${presetId}" 已保存`);
}

function saveCharacterCommonPresetAs() {
    stylInput("请输入新通用角色列表预设的名称").then((result) => {
        if (result && result.trim() !== '') {
            const settings = extension_settings[extensionName];
            saveCurrentCharacterCommonData(result);
            settings.characterCommonPresetId = result;
            loadCharacterCommonPresetList();
            alert(`通用角色列表预设 "${result}" 已保存。`);
        }
    });
}

function createNewCharacterCommonPreset() {
    stylInput("请输入新通用角色列表预设的名称").then((result) => {
        if (result && result.trim() !== '') {
            const settings = extension_settings[extensionName];

            if (settings.characterCommonPresets[result]) {
                alert(`通用角色列表预设 "${result}" 已存在，请使用其他名称。`);
                return;
            }

            settings.characterCommonPresets[result] = {
                characters: []
            };
            settings.characterCommonPresetId = result;
            saveSettingsDebounced();

            loadCharacterCommonPresetList();
            loadCharacterCommonPreset();

            toastr.success(`空白通用角色列表预设 "${result}" 已创建。`);
        }
    });
}

function renameCharacterCommonPreset() {
    const settings = extension_settings[extensionName];
    const currentName = settings.characterCommonPresetId;
    if (!currentName || !settings.characterCommonPresets[currentName]) {
        alert("没有活动的通用角色列表预设可重命名。");
        return;
    }
    if (currentName === "默认通用角色列表") {
        alert("默认预设不能重命名。");
        return;
    }
    
    stylInput("请输入新的通用角色列表预设名称", currentName).then((newName) => {
        if (newName && newName.trim() !== '' && newName !== currentName) {
            if (settings.characterCommonPresets[newName]) {
                alert("该名称已存在，请换一个名称。");
                return;
            }
            
            settings.characterCommonPresets[newName] = settings.characterCommonPresets[currentName];
            delete settings.characterCommonPresets[currentName];
            
            settings.characterCommonPresetId = newName;
            
            saveSettingsDebounced();
            loadCharacterCommonPresetList();
            
            try {
                if (typeof window.loadSilterTavernChatu8Settings === 'function') {
                    window.loadSilterTavernChatu8Settings();
                }
            } catch (error) {
                console.warn('Failed to refresh UI after renaming preset:', error);
            }
            toastr.success(`通用角色列表预设已重命名为 "${newName}"`);
        }
    });
}

function saveCurrentCharacterCommonData(presetId) {
    const settings = extension_settings[extensionName];
    const textarea = document.getElementById('character_common_list');

    if (!textarea) return;

    const characters = textarea.value
        .split('\n')
        .map(line => line.trim())
        .filter(line => line.length > 0);

    settings.characterCommonPresets[presetId] = {
        characters: characters
    };

    saveSettingsDebounced();
}

function deleteCharacterCommonPreset() {
    const settings = extension_settings[extensionName];
    const presetId = document.getElementById('character_common_preset_id')?.value;

    if (presetId === "默认通用角色列表") {
        alert("默认预设不能删除");
        return;
    }

    stylishConfirm("是否确定删除该通用角色列表预设").then((result) => {
        if (result) {
            delete settings.characterCommonPresets[presetId];
            settings.characterCommonPresetId = "默认通用角色列表";
            loadCharacterCommonPresetList();
            loadCharacterCommonPreset();
            saveSettingsDebounced();
        }
    });
}

async function exportCharacterCommonPreset() {
    const settings = extension_settings[extensionName];
    const presetId = settings.characterCommonPresetId;
    const preset = settings.characterCommonPresets[presetId];

    if (!preset) {
        alert("没有选中的通用角色列表预设可导出。");
        return;
    }

    const relatedCharacters = preset.characters || [];

    let dataToExport = {
        characterCommonPresets: { [presetId]: preset }
    };

    if (relatedCharacters.length > 0) {
        const confirmMessage = `检测到该列表包含 ${relatedCharacters.length} 个角色:\n${relatedCharacters.join('\n')}\n\n是否一起导出相关角色?`;
        const includeCharacters = await stylishConfirm(confirmMessage);

        if (includeCharacters) {
            dataToExport.characters = {};
            relatedCharacters.forEach(charName => {
                if (settings.characterPresets[charName]) {
                    const charPreset = settings.characterPresets[charName];
                    dataToExport.characters[charName] = charPreset;

                    // 同时收集该角色的服装
                    const charOutfits = charPreset.outfits || [];
                    if (charOutfits.length > 0) {
                        if (!dataToExport.outfits) {
                            dataToExport.outfits = {};
                        }
                        charOutfits.forEach(outfitName => {
                            if (settings.outfitPresets[outfitName]) {
                                dataToExport.outfits[outfitName] = settings.outfitPresets[outfitName];
                            }
                        });
                    }
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
    a.download = `st-chatu8-通用角色列表-${presetId}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

async function exportAllCharacterCommonPresets() {
    const settings = extension_settings[extensionName];
    if (!settings.characterCommonPresets || Object.keys(settings.characterCommonPresets).length === 0) {
        alert("没有通用角色列表预设可导出。");
        return;
    }

    const allCharacters = new Set();
    const allOutfits = new Set();

    for (const presetName in settings.characterCommonPresets) {
        const preset = settings.characterCommonPresets[presetName];
        const characters = preset.characters || [];
        characters.forEach(charName => {
            allCharacters.add(charName);
            if (settings.characterPresets[charName]) {
                const charOutfits = settings.characterPresets[charName].outfits || [];
                charOutfits.forEach(outfitName => allOutfits.add(outfitName));
            }
        });
    }

    let dataToExport = {
        characterCommonPresets: settings.characterCommonPresets
    };

    if (allCharacters.size > 0) {
        const confirmMessage = `检测到所有列表共包含 ${allCharacters.size} 个不同的角色:\n${Array.from(allCharacters).join('\n')}\n\n是否一起导出相关角色?`;
        const includeCharacters = await stylishConfirm(confirmMessage);

        if (includeCharacters) {
            dataToExport.characters = {};
            allCharacters.forEach(charName => {
                if (settings.characterPresets[charName]) {
                    dataToExport.characters[charName] = settings.characterPresets[charName];
                }
            });

            if (allOutfits.size > 0) {
                const confirmOutfits = `同时检测到这些角色包含 ${allOutfits.size} 个不同的服装:\n${Array.from(allOutfits).join('\n')}\n\n是否也一起导出?`;
                const includeOutfits = await stylishConfirm(confirmOutfits);

                if (includeOutfits) {
                    dataToExport.outfits = {};
                    allOutfits.forEach(outfitName => {
                        if (settings.outfitPresets[outfitName]) {
                            dataToExport.outfits[outfitName] = settings.outfitPresets[outfitName];
                        }
                    });
                }
            }
        }
    }

    dataToExport = await encryptExportData(dataToExport);

    const dataStr = JSON.stringify(dataToExport, null, 2);
    const blob = new Blob([dataStr], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "st-chatu8-通用角色列表-全部.json";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

function importCharacterCommonPreset() {
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

                let commonPresetsToImport = {};
                let charactersToImport = {};
                let outfitsToImport = {};

                if (importedData.characterCommonPresets) {
                    commonPresetsToImport = importedData.characterCommonPresets;
                    charactersToImport = importedData.characters || {};
                    outfitsToImport = importedData.outfits || {};
                } else {
                    commonPresetsToImport = importedData;
                }

                let importCharacters = false;
                if (Object.keys(charactersToImport).length > 0) {
                    const characterNames = Object.keys(charactersToImport);
                    const confirmMessage = `检测到 ${characterNames.length} 个相关角色:\n${characterNames.join('\n')}\n\n是否一起导入?`;
                    importCharacters = await stylishConfirm(confirmMessage);
                }

                let newCommonPresetsCount = 0;
                for (const key in commonPresetsToImport) {
                    if (commonPresetsToImport.hasOwnProperty(key)) {
                        if (!settings.characterCommonPresets.hasOwnProperty(key)) {
                            newCommonPresetsCount++;
                        }
                        settings.characterCommonPresets[key] = commonPresetsToImport[key];
                    }
                }

                let newCharactersCount = 0;
                let newOutfitsCount = 0;
                if (importCharacters) {
                    for (const key in charactersToImport) {
                        if (charactersToImport.hasOwnProperty(key)) {
                            if (!settings.characterPresets.hasOwnProperty(key)) {
                                newCharactersCount++;
                            }
                            settings.characterPresets[key] = charactersToImport[key];
                        }
                    }

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
                loadCharacterCommonPresetList();
                if (importCharacters) {
                    loadCharacterPresetList();
                    loadOutfitPresetList();
                }

                const firstImportedKey = Object.keys(commonPresetsToImport)[0];
                if (firstImportedKey) {
                    settings.characterCommonPresetId = firstImportedKey;
                    const select = document.getElementById('character_common_preset_id');
                    if (select) select.value = firstImportedKey;
                    loadCharacterCommonPreset();
                }

                let message = `成功导入 ${Object.keys(commonPresetsToImport).length} 个通用角色列表预设，其中 ${newCommonPresetsCount} 个是全新的。`;
                if (importCharacters) {
                    message += `\n同时导入 ${Object.keys(charactersToImport).length} 个角色预设(${newCharactersCount} 个全新)`;
                    message += `和 ${Object.keys(outfitsToImport).length} 个服装预设(${newOutfitsCount} 个全新)。`;
                }
                alert(message);
            } catch (err) {
                alert("导入失败，请确保文件是正确的JSON格式。\n错误信息: " + err.message);
                console.error("Error importing character common presets:", err);
            }
        };
        reader.readAsText(file);
    };
    input.click();
}

export function loadCharacterCommonSelector() {
    const settings = extension_settings[extensionName];
    const select = document.getElementById('character_common_selector');

    if (!select) return;

    select.innerHTML = '<option value="">-- 选择角色 --</option>';

    for (const presetName in settings.characterPresets) {
        const option = document.createElement('option');
        option.value = presetName;
        option.textContent = presetName;
        select.add(option);
    }
}

function addCharacterFromCommonSelector() {
    const select = document.getElementById('character_common_selector');
    const textarea = document.getElementById('character_common_list');

    if (!select || !textarea) return;

    const selectedCharacter = select.value;
    if (!selectedCharacter) {
        alert('请先选择一个角色');
        return;
    }

    const currentText = textarea.value.trim();
    const lines = currentText ? currentText.split('\n') : [];

    if (lines.includes(selectedCharacter)) {
        alert('该角色已在列表中');
        return;
    }

    lines.push(selectedCharacter);
    textarea.value = lines.join('\n');
}

function checkCharacterCommonList() {
    const settings = extension_settings[extensionName];
    const textarea = document.getElementById('character_common_list');
    const resultDiv = document.getElementById('character_common_check_result');
    const contentDiv = document.getElementById('character_common_check_content');

    if (!textarea || !resultDiv || !contentDiv) return;

    const inputCharacters = textarea.value
        .split('\n')
        .map(line => line.trim())
        .filter(line => line.length > 0);

    if (inputCharacters.length === 0) {
        alert('请先输入角色名称');
        return;
    }

    const availableCharacters = new Set();
    for (const presetName in settings.characterPresets) {
        availableCharacters.add(presetName);
    }

    const results = { found: [], notFound: [] };

    inputCharacters.forEach(char => {
        if (availableCharacters.has(char)) {
            results.found.push(char);
        } else {
            results.notFound.push(char);
        }
    });

    let html = '<div style="margin-bottom: 10px;">';
    html += `<strong>总计：</strong>${inputCharacters.length} 个角色`;
    html += `<br><strong>找到：</strong>${results.found.length} 个`;
    html += `<br><strong>未找到：</strong>${results.notFound.length} 个`;
    html += '</div>';

    if (results.found.length > 0) {
        html += '<div style="margin-bottom: 10px;">';
        html += '<strong style="color: #28a745;">✓ 已存在的角色：</strong>';
        html += '<ul style="margin: 5px 0; padding-left: 20px;">';
        results.found.forEach(char => {
            html += `<li>${char}</li>`;
        });
        html += '</ul></div>';
    }

    if (results.notFound.length > 0) {
        html += '<div>';
        html += '<strong style="color: #dc3545;">✗ 未找到的角色：</strong>';
        html += '<ul style="margin: 5px 0; padding-left: 20px;">';
        results.notFound.forEach(char => {
            html += `<li>${char}</li>`;
        });
        html += '</ul></div>';
    }

    contentDiv.innerHTML = html;
    $(resultDiv).show();
}
