// @ts-nocheck
import { extension_settings } from "../../../../../extensions.js";
import { saveSettingsDebounced } from "../../../../../../script.js";
import { extensionName } from '../config.js';
import { getSuffix, stylInput, stylishConfirm } from '../ui_common.js';


export const generationTabs = ['sd', 'novelai', 'comfyui'];

function syncAllPromptReplaceFields(force = false) {
    const settings = extension_settings[extensionName];
    const presetName = settings.prompt_replace_id;
    const currentPreset = settings.prompt_replace[presetName] || {};

    generationTabs.forEach(mode => {
        const suffix = getSuffix(mode);
        const replaceSelect = document.getElementById('prompt_replace_id' + suffix);
        if (replaceSelect) replaceSelect.value = presetName;

        const textarea = document.getElementById('prompt_replace_text' + suffix);
        const warning = textarea.closest('.st-chatu8-field-col').querySelector('.st-chatu8-unsaved-warning');
        let isDirty = textarea.value !== (currentPreset.text ?? '');

        if (force || !isDirty) {
            textarea.value = currentPreset.text ?? '';
            if (warning) $(warning).hide();
        }
    });
}


function prompt_replace_change(mode) {
    const settings = extension_settings[extensionName];
    const suffix = getSuffix(mode);
    const selectElement = document.getElementById("prompt_replace_id" + suffix);
    const newPresetId = selectElement.value;

    const currentPresetId = settings.prompt_replace_id;
    const currentPreset = settings.prompt_replace[currentPresetId] || {};
    const text = document.getElementById("prompt_replace_text" + suffix).value;

    const isDirty = (text !== (currentPreset.text ?? ''));

    if (isDirty) {
        stylishConfirm("您有未保存的替换规则。要放弃这些更改并切换预设吗？").then(confirmed => {
            if (confirmed) {
                settings.prompt_replace_id = newPresetId;
                saveSettingsDebounced();
                syncAllPromptReplaceFields(true); // Force sync
            } else {
                selectElement.value = currentPresetId;
            }
        });
    } else {
        settings.prompt_replace_id = newPresetId;
        saveSettingsDebounced();
        syncAllPromptReplaceFields(true); // Force sync
    }
}

function prompt_replace_new(mode) {
    const settings = extension_settings[extensionName];
    stylInput("请输入新替换规则配置的名称").then((newName) => {
        if (newName && newName.trim() !== '') {
            if (settings.prompt_replace[newName]) {
                alert("该名称已存在，请换一个名称。");
                return;
            }
            settings.prompt_replace[newName] = { "text": "" };
            settings.prompt_replace_id = newName;
            saveSettingsDebounced();
            try {
                if (typeof window.loadSilterTavernChatu8Settings === 'function') {
                    window.loadSilterTavernChatu8Settings();
                }
            } catch (error) {
                console.warn('Failed to refresh UI after creating preset:', error);
            }
        }
    });
}

function prompt_replace_rename(mode) {
    const settings = extension_settings[extensionName];
    const currentName = settings.prompt_replace_id;
    if (currentName === "默认" || !settings.prompt_replace[currentName]) {
        alert("默认配置或不存在的配置不能重命名。");
        return;
    }
    stylInput("请输入新的配置名称", currentName).then((newName) => {
        if (newName && newName.trim() !== '' && newName !== currentName) {
            if (settings.prompt_replace[newName]) {
                alert("该名称已存在，请换一个名称。");
                return;
            }
            settings.prompt_replace[newName] = settings.prompt_replace[currentName];
            delete settings.prompt_replace[currentName];
            settings.prompt_replace_id = newName;
            saveSettingsDebounced();
            try {
                if (typeof window.loadSilterTavernChatu8Settings === 'function') {
                    window.loadSilterTavernChatu8Settings();
                }
            } catch (error) {
                console.warn('Failed to refresh UI after renaming preset:', error);
            }
        }
    });
}

function prompt_replace_save(mode) { // "Save As"
    const settings = extension_settings[extensionName];
    const suffix = getSuffix(mode);
    stylInput("请输入新替换规则配置的名称").then((result) => {
        if (result && result.trim() !== '') {
            const text = document.getElementById("prompt_replace_text" + suffix).value;

            settings.prompt_replace[result] = { "text": text };
            settings.prompt_replace_id = result;
            saveSettingsDebounced();

            // Refresh UI to update dropdown lists across all tabs
            try {
                if (typeof window.loadSilterTavernChatu8Settings === 'function') {
                    window.loadSilterTavernChatu8Settings();
                }
            } catch (error) {
                console.warn('Failed to refresh UI after saving preset:', error);
            }

            alert(`替换规则 "${result}" 已保存。`);
        }
    });
}

function prompt_replace_update(mode) { // "Save"
    const settings = extension_settings[extensionName];
    const suffix = getSuffix(mode);
    const presetName = settings.prompt_replace_id;

    if (!presetName || !settings.prompt_replace[presetName]) {
        alert("没有活动的替换规则可保存。请先“另存为”一个新规则。");
        return;
    }

    stylishConfirm(`确定要覆盖当前替换规则 "${presetName}" 吗？`).then(confirmed => {
        if (confirmed) {
            const text = document.getElementById("prompt_replace_text" + suffix).value;

            settings.prompt_replace[presetName] = { "text": text };
            saveSettingsDebounced();

            const textarea = document.getElementById('prompt_replace_text' + suffix);
            const warning = textarea.closest('.st-chatu8-field-col').querySelector('.st-chatu8-unsaved-warning');
            if (warning) $(warning).hide();

            // alert(`替换规则 "${presetName}" 已更新。`);
        }
    });
}

function prompt_replace_delete(mode) {
    const settings = extension_settings[extensionName];
    const suffix = getSuffix(mode);
    const selectElement = document.getElementById("prompt_replace_id" + suffix);
    const valueToDelete = selectElement.value;

    if (valueToDelete === "默认") {
        alert("默认配置不能删除");
        return;
    }

    stylishConfirm("是否确定删除该替换规则").then((result) => {
        if (result) {
            Reflect.deleteProperty(settings.prompt_replace, valueToDelete);
            settings.prompt_replace_id = "默认";
            saveSettingsDebounced();

            // Refresh UI to update dropdown lists across all tabs
            try {
                if (typeof window.loadSilterTavernChatu8Settings === 'function') {
                    window.loadSilterTavernChatu8Settings();
                }
            } catch (error) {
                console.warn('Failed to refresh UI after deleting preset:', error);
            }
        }
    });
}

function prompt_replace_export_current() {
    const settings = extension_settings[extensionName];
    const selectedId = settings.prompt_replace_id;
    if (!selectedId || !settings.prompt_replace[selectedId]) {
        alert("没有选中的替换规则可导出。");
        return;
    }
    const dataToExport = { [selectedId]: settings.prompt_replace[selectedId] };
    const dataStr = JSON.stringify(dataToExport, null, 2);
    const blob = new Blob([dataStr], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `st-chatu8-prompt-replace-${selectedId}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

function prompt_replace_export_all() {
    const settings = extension_settings[extensionName];
    if (!settings.prompt_replace || Object.keys(settings.prompt_replace).length === 0) {
        alert("没有替换规则可导出。");
        return;
    }
    const dataStr = JSON.stringify(settings.prompt_replace, null, 2);
    const blob = new Blob([dataStr], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "st-chatu8-prompt-replace-all.json";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

function prompt_replace_import() {
    const settings = extension_settings[extensionName];
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.onchange = e => {
        const file = e.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = readerEvent => {
            try {
                const importedData = JSON.parse(readerEvent.target.result);
                let newPresetsCount = 0;
                for (const key in importedData) {
                    if (importedData.hasOwnProperty(key)) {
                        if (!settings.prompt_replace.hasOwnProperty(key)) {
                            newPresetsCount++;
                        }
                        settings.prompt_replace[key] = importedData[key];
                    }
                }
                saveSettingsDebounced();

                // Refresh UI to update dropdown lists across all tabs
                try {
                    if (typeof window.loadSilterTavernChatu8Settings === 'function') {
                        window.loadSilterTavernChatu8Settings();
                    }
                } catch (error) {
                    console.warn('Failed to refresh UI after importing presets:', error);
                }

                alert(`成功导入 ${Object.keys(importedData).length} 个替换规则，其中 ${newPresetsCount} 个是全新的。`);
            } catch (err) {
                alert("导入失败，请确保文件是正确的JSON格式。");
                console.error("Error importing prompt replacements:", err);
            }
        };
        reader.readAsText(file);
    };
    input.click();
}

export function initPromptReplaceControls(settingsModal) {
    generationTabs.forEach(mode => {
        const suffix = getSuffix(mode);
        settingsModal.find(`#prompt_replace_id${suffix}`).on('change', () => prompt_replace_change(mode));
        settingsModal.find(`#prompt_replace_new${suffix}`).on('click', () => prompt_replace_new(mode));
        settingsModal.find(`#prompt_replace_rename${suffix}`).on('click', () => prompt_replace_rename(mode));
        settingsModal.find(`#prompt_replace_save_style${suffix}`).on('click', () => prompt_replace_save(mode));
        settingsModal.find(`#prompt_replace_update_style${suffix}`).on('click', () => prompt_replace_update(mode));
        settingsModal.find(`#prompt_replace_delete_style${suffix}`).on('click', () => prompt_replace_delete(mode));
        settingsModal.find(`#prompt_replace_export_current${suffix}`).on('click', prompt_replace_export_current);
        settingsModal.find(`#prompt_replace_export_all${suffix}`).on('click', prompt_replace_export_all);
        settingsModal.find(`#prompt_replace_import${suffix}`).on('click', prompt_replace_import);

        // Show/hide warning on input change
        $(`#prompt_replace_text${suffix}`).on('input', function () {
            const settings = extension_settings[extensionName];
            const presetName = settings.prompt_replace_id;
            const currentPreset = settings.prompt_replace[presetName] || {};
            const isDirty = $(this).val() !== (currentPreset.text ?? '');
            const warning = $(this).closest('.st-chatu8-field-col').find('.st-chatu8-unsaved-warning');

            if (isDirty) {
                $(warning).show();
            } else {
                $(warning).hide();
            }
        });
    });
}
