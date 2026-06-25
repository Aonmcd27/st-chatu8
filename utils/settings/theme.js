// @ts-nocheck
import { extension_settings } from "../../../../../extensions.js";
import { saveSettingsDebounced } from "../../../../../../script.js";
import { defaultThemes, extensionName } from '../config.js';
import { stylInput, stylishConfirm } from '../ui_common.js';

import { applyGenerateButtonStyle, injectButtonStyleToDocument } from './buttonstyle.js';
import { applyImageFrameStyle, injectFrameStyleToDocument } from './framestyle.js';
import { applyCollapseStyle, injectCollapseStyleToDocument } from './collapsestyle.js';

let settings;
let currentPreviewTheme = {};

export const colorVarMap = {
    "--st-chatu8-bg-primary": "主背景色",
    "--st-chatu8-bg-secondary": "次背景色",
    "--st-chatu8-bg-tertiary": "三级背景色",
    "--st-chatu8-text-primary": "主文本颜色",
    "--st-chatu8-text-secondary": "次文本颜色",
    "--st-chatu8-accent-primary": "主强调色",
    "--st-chatu8-accent-secondary": "次强调色",
    "--st-chatu8-danger-primary": "危险/删除按钮色",
    "--st-chatu8-danger-secondary": "危险/删除按钮悬停色",
    "--st-chatu8-danger-text": "危险/删除按钮文本色",
    "--st-chatu8-border-color": "边框颜色",
    "--st-chatu8-dropdown-bg": "下拉框背景色",
    "--st-chatu8-dropdown-text": "下拉列表文本颜色",
    "--st-chatu8-dropdown-list-bg": "下拉选项背景色",
    "--st-chatu8-text-highlight": "高亮文本颜色",
    "--st-chatu8-input-bg": "输入框背景色",
    "--st-chatu8-input-text": "输入框文本颜色",
    "--st-chatu8-input-border": "输入框边框颜色"
};

export function isThemeDark(theme) {
    const bgColor = theme['--st-chatu8-bg-primary'] || '#ffffff';
    const color = bgColor.substring(1); // strip #
    const rgb = parseInt(color, 16);
    const r = (rgb >> 16) & 0xff;
    const g = (rgb >> 8) & 0xff;
    const b = (rgb >> 0) & 0xff;
    const luma = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    return luma < 128;
}

export function applyTheme(theme) {
    if (!theme) {
        console.error(`Theme object is invalid.`);
        return;
    }

    // Ensure new input variables have default values if they are missing
    const defaults = {
        '--st-chatu8-input-bg': theme['--st-chatu8-bg-secondary'] || '#ffffff',
        '--st-chatu8-input-text': theme['--st-chatu8-text-primary'] || '#000000',
        '--st-chatu8-input-border': theme['--st-chatu8-border-color'] || '#cccccc',
    };

    const fullTheme = { ...defaults, ...theme };


    // Apply to settings panel
    const root = document.querySelector('#st-chatu8-settings');
    if (root) {
        for (const [key, value] of Object.entries(fullTheme)) {
            root.style.setProperty(key, value);
        }
    }

    // Apply to top-level document for external UI elements like dialogs
    const topRoot = window.top.document.documentElement;
    if (topRoot) {
        for (const [key, value] of Object.entries(fullTheme)) {
            topRoot.style.setProperty(key, value);
        }
    }


    // Update toggle icon based on brightness
    const themeIcon = document.querySelector('#ch-toggle-theme i');
    if (themeIcon) {
        const isDark = isThemeDark(fullTheme);
        if (isDark) {
            themeIcon.classList.remove('fa-moon');
            themeIcon.classList.add('fa-sun');
        } else {
            themeIcon.classList.remove('fa-sun');
            themeIcon.classList.add('fa-moon');
        }
    }
}

function populateThemeColorPickers(themeId) {
    const container = document.getElementById('theme-color-pickers');
    if (!container) return;
    container.innerHTML = '';

    const theme = currentPreviewTheme;
    if (!theme) return;

    for (const key in colorVarMap) {
        if (Object.hasOwnProperty.call(theme, key)) {
            const labelText = colorVarMap[key];
            const color = theme[key];

            const field = document.createElement('div');
            field.className = 'st-chatu8-field';

            const label = document.createElement('label');
            label.textContent = labelText;
            label.htmlFor = `theme-color-${key}`;

            const colorPicker = document.createElement('input');
            colorPicker.type = 'color';
            colorPicker.id = `theme-color-${key}`;
            colorPicker.className = 'st-chatu8-color-picker';
            colorPicker.value = color;
            colorPicker.dataset.var = key;

            colorPicker.addEventListener('input', (event) => {
                const newColor = event.target.value;
                const cssVar = event.target.dataset.var;
                currentPreviewTheme[cssVar] = newColor;
                applyTheme(currentPreviewTheme);
            });

            field.appendChild(label);
            field.appendChild(colorPicker);
            container.appendChild(field);
        }
    }
}





function loadThemeSettings() {
    const select = document.getElementById('theme_id');
    if (!select) return;

    const currentThemeId = settings.theme_id;
    select.innerHTML = '';
    for (const key in settings.themes) {
        const option = new Option(key, key);
        option.title = key;
        select.add(option);
    }
    select.value = currentThemeId;

    // Load button style setting
    const btnStyleSelect = document.getElementById('theme_generate_btn_style');
    if (btnStyleSelect) {
        btnStyleSelect.value = settings.generate_btn_style || '默认';
    }

    // Load image frame style setting
    const frameStyleSelect = document.getElementById('theme_image_frame_style');
    if (frameStyleSelect) {
        frameStyleSelect.value = settings.image_frame_style || '无样式';
    }

    // Load collapse style setting
    const collapseStyleSelect = document.getElementById('theme_collapse_style');
    if (collapseStyleSelect) {
        collapseStyleSelect.value = settings.collapse_style || '默认';
    }

    currentPreviewTheme = JSON.parse(JSON.stringify(settings.themes[currentThemeId]));
    populateThemeColorPickers(currentThemeId);

    // Apply initial button style
    applyGenerateButtonStyle(settings.generate_btn_style, isThemeDark(currentPreviewTheme));

    // Apply initial image frame style
    applyImageFrameStyle(settings.image_frame_style || '无样式', isThemeDark(currentPreviewTheme));

    // Apply initial collapse style
    applyCollapseStyle(settings.collapse_style || '默认', isThemeDark(currentPreviewTheme));
}

function theme_change() {
    const select = document.getElementById('theme_id');
    const newThemeId = select.value;
    settings.theme_id = newThemeId;
    currentPreviewTheme = JSON.parse(JSON.stringify(settings.themes[newThemeId]));
    applyTheme(currentPreviewTheme);
    populateThemeColorPickers(newThemeId);
    saveSettingsDebounced();
}

function btn_style_change() {
    const select = document.getElementById('theme_generate_btn_style');
    const newStyle = select.value;
    settings.generate_btn_style = newStyle;
    applyGenerateButtonStyle(newStyle, isThemeDark(currentPreviewTheme));
    saveSettingsDebounced();
}

function frame_style_change() {
    const select = document.getElementById('theme_image_frame_style');
    const newStyle = select.value;
    settings.image_frame_style = newStyle;
    applyImageFrameStyle(newStyle, isThemeDark(currentPreviewTheme));
    saveSettingsDebounced();
}

function collapse_style_change() {
    const select = document.getElementById('theme_collapse_style');
    const newStyle = select.value;
    settings.collapse_style = newStyle;
    applyCollapseStyle(newStyle, isThemeDark(currentPreviewTheme));
    saveSettingsDebounced();
}

function theme_save() {
    const currentThemeId = settings.theme_id;

    if (defaultThemes.hasOwnProperty(currentThemeId)) {
        stylInput("正在编辑默认主题。请输入新主题的名称以保存：").then(name => {
            if (name && name.trim() !== '') {
                settings.themes[name] = JSON.parse(JSON.stringify(currentPreviewTheme));
                settings.theme_id = name;
                saveSettingsDebounced();
                loadThemeSettings();
                applyTheme(currentPreviewTheme);
            }
        });
    } else {
        stylishConfirm(`确定要覆盖当前主题 "${currentThemeId}" 吗？`).then(confirmed => {
            if (confirmed) {
                settings.themes[currentThemeId] = JSON.parse(JSON.stringify(currentPreviewTheme));
                saveSettingsDebounced();
                alert(`主题 "${currentThemeId}" 已保存。`);
            }
        });
    }
}

function theme_delete() {
    const select = document.getElementById('theme_id');
    const themeIdToDelete = select.value;

    if (defaultThemes.hasOwnProperty(themeIdToDelete)) {
        alert("不能删除默认主题。");
        return;
    }

    stylishConfirm(`确定要删除主题 "${themeIdToDelete}" 吗?`).then(confirmed => {
        if (confirmed) {
            delete settings.themes[themeIdToDelete];
            settings.theme_id = '默认-白天';
            saveSettingsDebounced();
            applyTheme(settings.themes[settings.theme_id]);
            loadThemeSettings();
        }
    });
}

function theme_import() {
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
                let newThemesCount = 0;
                for (const key in importedData) {
                    if (importedData.hasOwnProperty(key)) {
                        if (!settings.themes.hasOwnProperty(key)) {
                            newThemesCount++;
                        }
                        settings.themes[key] = importedData[key];
                    }
                }
                saveSettingsDebounced();
                loadThemeSettings();
                alert(`成功导入 ${Object.keys(importedData).length} 个主题，其中 ${newThemesCount} 个是全新的。`);
            } catch (err) {
                alert("导入失败，请确保文件是正确的JSON格式。");
                console.error("Error importing themes:", err);
            }
        };
        reader.readAsText(file);
    };
    input.click();
}

function theme_export(all = false) {
    const themeId = settings.theme_id;
    if (!all && !settings.themes[themeId]) {
        alert("没有选中的主题可导出。");
        return;
    }

    const dataToExport = all ? settings.themes : { [themeId]: settings.themes[themeId] };
    const dataStr = JSON.stringify(dataToExport, null, 2);
    const blob = new Blob([dataStr], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `st-chatu8-theme${all ? 's-all' : '-' + themeId}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

function toggleTheme() {
    const themeKeys = Object.keys(settings.themes);
    const currentIndex = themeKeys.indexOf(settings.theme_id);
    const nextIndex = (currentIndex + 1) % themeKeys.length;
    const newThemeId = themeKeys[nextIndex];

    settings.theme_id = newThemeId;
    applyTheme(settings.themes[newThemeId]);
    loadThemeSettings(); // To update the dropdown
    saveSettingsDebounced();
}

export function initThemeSettings(settingsModal) {
    settings = extension_settings[extensionName];

    // 将预设主题合并到用户设置中（只添加用户设置里没有的主题）
    for (const themeId in defaultThemes) {
        if (!settings.themes.hasOwnProperty(themeId)) {
            settings.themes[themeId] = JSON.parse(JSON.stringify(defaultThemes[themeId]));
        }
    }

    // Initial load
    loadThemeSettings();

    // Bind events
    settingsModal.find('#ch-toggle-theme').on('click', toggleTheme);
    settingsModal.find('#theme_id').on('change', theme_change);
    settingsModal.find('#theme_generate_btn_style').on('change', btn_style_change);
    settingsModal.find('#theme_image_frame_style').on('change', frame_style_change);
    settingsModal.find('#theme_collapse_style').on('change', collapse_style_change);
    settingsModal.find('#theme_save_style').on('click', theme_save);
    settingsModal.find('#theme_delete_style').on('click', theme_delete);
    settingsModal.find('#theme_export_current').on('click', () => theme_export(false));
    settingsModal.find('#theme_export_all').on('click', () => theme_export(true));
    settingsModal.find('#theme_import').on('click', theme_import);
}

// Also export for direct use in ui.js
export { loadThemeSettings };

// Re-export applyGenerateButtonStyle for backward compatibility
export { applyGenerateButtonStyle };

// Export injectButtonStyleToDocument for iframe style injection
export { injectButtonStyleToDocument };

// Export applyImageFrameStyle for use in other modules
export { applyImageFrameStyle };

// Export injectFrameStyleToDocument for iframe style injection
export { injectFrameStyleToDocument };

// Export applyCollapseStyle for use in other modules
export { applyCollapseStyle };

// Export injectCollapseStyleToDocument for iframe style injection
export { injectCollapseStyleToDocument };

