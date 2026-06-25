// @ts-nocheck
import { extension_settings } from "../../../../../extensions.js";
import { saveSettingsDebounced } from "../../../../../../script.js";
import { defaultSettings, extensionName } from '../config.js';
import { stylishConfirm } from '../ui_common.js';
import { initJiuguanStorage } from '../database.js';

function onRestoreDefaultSettingsClick() {
    stylishConfirm("你确定要恢复默认设置吗？提示词预设和工作流会消失哦！请提前备份！").then((result) => {
        if (result) {
            stylishConfirm("你真的确定吗？").then(async (result) => {
                if (result) {
                    const defaults = JSON.parse(JSON.stringify(defaultSettings));
                    const settings = extension_settings[extensionName];

                    Object.keys(settings).forEach(key => {
                        delete settings[key];
                    });

                    Object.assign(settings, defaults);
                    saveSettingsDebounced();
                    
                    // 重新从隐写图片加载图片缓存信息
                    try {
                        await initJiuguanStorage();
                        console.log('[Settings] 已从隐写图片重新加载图片缓存');
                    } catch (error) {
                        console.error('[Settings] 重新加载图片缓存失败:', error);
                    }
                    
                    window.loadSilterTavernChatu8Settings();
                    alert("已恢复默认设置。");
                }
            });
        }
    });
}

function onExportSettingsClick() {
    const settingsString = JSON.stringify(extension_settings[extensionName], null, 4);
    const blob = new Blob([settingsString], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${extensionName}_settings.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    alert("设置已导出。");
}

function onImportSettingsClick() {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".json";
    input.onchange = (event) => {
        const file = event.target.files[0];
        if (file) {
            const reader = new FileReader();
            reader.onload = async (e) => {
                try {
                    const importedSettings = JSON.parse(e.target.result);
                    Object.assign(extension_settings[extensionName], importedSettings);
                    saveSettingsDebounced();
                    
                    // 重新从隐写图片加载图片缓存信息
                    try {
                        await initJiuguanStorage();
                        console.log('[Settings] 已从隐写图片重新加载图片缓存');
                    } catch (error) {
                        console.error('[Settings] 重新加载图片缓存失败:', error);
                    }
                    
                    window.loadSilterTavernChatu8Settings();
                    alert("设置已导入。");
                } catch (error) {
                    alert("导入设置失败，文件格式无效。");
                }
            };
            reader.readAsText(file);
        }
    };
    input.click();
}

export function initGeneralSettings(settingsModal) {
    settingsModal.find('#ch-restore-settings').on('click', onRestoreDefaultSettingsClick);
    settingsModal.find('#ch-export-settings').on('click', onExportSettingsClick);
    settingsModal.find('#ch-import-settings').on('click', onImportSettingsClick);
}
