import { extension_settings } from "../../../../extensions.js";
import { extensionName } from './config.js';
import { saveSettingsDebounced }from "../../../../../script.js";
const generationTabs = ['sd', 'novelai', 'comfyui'];
import { storeDelete, storeReadOnly } from './database.js';
function checkSendBuClass() {
    const sendButton = document.getElementById('send_but');
    const stopButton = document.getElementById('mes_stop');
    const isSendHidden = !sendButton || getComputedStyle(sendButton).display === 'none';
    const isStopVisible = stopButton && getComputedStyle(stopButton).display !== 'none';
    return isSendHidden || isStopVisible;
}


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


export function tishici_change(mode) {
    const settings = extension_settings[extensionName];
    const suffix = getSuffix(mode);
    const selectElement = document.getElementById("yusheid" + suffix);
    const newPresetId = selectElement.value;
    const yusheIdKey = `yusheid${mode === 'sd' ? '_sd' : suffix}`;
    const currentPresetId = settings[yusheIdKey];

    // If we are not actually changing, do nothing.
    if (newPresetId === currentPresetId) return;

    const currentPreset = settings.yushe[currentPresetId] || {};
    const fixedPrompt = document.getElementById("fixedPrompt" + suffix).value;
    const fixedPrompt_end = document.getElementById("fixedPrompt_end" + suffix).value;
    const negativePrompt = document.getElementById("negativePrompt" + suffix).value;

    const isDirty = (fixedPrompt !== (currentPreset.fixedPrompt ?? '')) ||
                    (fixedPrompt_end !== (currentPreset.fixedPrompt_end ?? '')) ||
                    (negativePrompt !== (currentPreset.negativePrompt ?? ''));

    const switchPreset = () => {
        settings[yusheIdKey] = newPresetId;
        saveSettingsDebounced();
        const newPreset = settings.yushe[newPresetId] || {};
        document.getElementById("fixedPrompt" + suffix).value = newPreset.fixedPrompt ?? '';
        document.getElementById("fixedPrompt_end" + suffix).value = newPreset.fixedPrompt_end ?? '';
        document.getElementById("negativePrompt" + suffix).value = newPreset.negativePrompt ?? '';
        
        // Hide warnings
        const fields = ['fixedPrompt', 'fixedPrompt_end', 'negativePrompt'];
        fields.forEach(field => {
            const textarea = document.getElementById(field + suffix);
            const warning = textarea.closest('.st-chatu8-field-col').querySelector('.st-chatu8-unsaved-warning');
            if (warning) $(warning).hide();
        });
    };

    if (isDirty) {
        stylishConfirm("您有未保存的更改。要放弃这些更改并切换预设吗？").then(confirmed => {
            if (confirmed) {
                switchPreset();
            } else {
                // Revert dropdown to the old value
                selectElement.value = currentPresetId;
            }
        });
    } else {
        switchPreset();
    }
}

export function syncAllPromptReplaceFields(force = false) {
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


export function applyFabSettings() {
    const settings = extension_settings[extensionName];
    const fab = $('#st-chatu8-fab');
    if (!fab.length) return;

    if (settings.enable_chatu8_fab) {
        fab.show();
        fab.css('background-color', settings.chatu8_fab_bg_color || '#ADD8E6');
        fab.find('i').css('color', settings.chatu8_fab_icon_color || '#FFFFFF');
        fab.css('opacity', settings.chatu8_fab_opacity ?? 1);

        const size = settings.chatu8_fab_size ?? 50;
        fab.css('width', `${size}px`);
        fab.css('height', `${size}px`);
        fab.find('i').css('font-size', `${Math.round(size * 0.48)}px`);

        // Apply position based on device type
        const isMobile = window.innerWidth <= 768;
        const position = isMobile 
            ? (settings.chatu8_fab_position.mobile || defaultSettings.chatu8_fab_position.mobile)
            : (settings.chatu8_fab_position.desktop || defaultSettings.chatu8_fab_position.desktop);

        fab.css('top', position.top);
        fab.css('left', position.left);
    } else {
        fab.hide();
    }
}


export function tishici_export_current() {
    const settings = extension_settings[extensionName];
    const activeTabId = document.querySelector('.st-chatu8-tab-content.active').id.replace('ch-tab-', '');
    const suffix = getSuffix(activeTabId);
    const yusheIdKey = `yusheid${activeTabId === 'sd' ? '_sd' : suffix}`;
    const selectedId = settings[yusheIdKey];

    if (!selectedId || !settings.yushe[selectedId]) {
        alert("没有选中的预设可导出。");
        return;
    }
    const dataToExport = { [selectedId]: settings.yushe[selectedId] };
    const dataStr = JSON.stringify(dataToExport, null, 2);
    const blob = new Blob([dataStr], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `st-chatu8-prompt-preset-${selectedId}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}


export function tishici_update(mode) { // This is the new "Save"
    const settings = extension_settings[extensionName];
    const suffix = getSuffix(mode);
    const yusheIdKey = `yusheid${mode === 'sd' ? '_sd' : suffix}`;
    const presetName = settings[yusheIdKey];

    if (!presetName || !settings.yushe[presetName]) {
        alert("没有活动的预设可保存。请先“另存为”一个新预设。");
        return;
    }

    stylishConfirm(`确定要覆盖当前预设 "${presetName}" 吗？`).then(confirmed => {
        if (confirmed) {
            const fixedPrompt = document.getElementById("fixedPrompt" + suffix).value;
            const fixedPrompt_end = document.getElementById("fixedPrompt_end" + suffix).value;
            const negativePrompt = document.getElementById("negativePrompt" + suffix).value;

            settings.yushe[presetName] = { "fixedPrompt": fixedPrompt, "fixedPrompt_end": fixedPrompt_end, "negativePrompt": negativePrompt };
            saveSettingsDebounced();
            
            // Hide warnings after saving
            const fields = ['fixedPrompt', 'fixedPrompt_end', 'negativePrompt'];
            fields.forEach(field => {
                const textarea = document.getElementById(field + suffix);
                const warning = textarea.closest('.st-chatu8-field-col').querySelector('.st-chatu8-unsaved-warning');
                if (warning) $(warning).hide();
            });

            // alert(`预设 "${presetName}" 已更新。`);
        }
    });
}


export function showSettingsPanel() {

    const settings = extension_settings[extensionName];
    const panel = $('#ch-settings-modal');
    if (!panel.length) {
        console.error("Settings panel not found!");
        return;
    }
    
    // Set the last active tab
    const lastTab = settings.lastTab || 'main';
    const lastTabLink = panel.find(`.st-chatu8-nav-link[data-tab="${lastTab}"]`);
    
    // Fallback to main if last tab doesn't exist
    if (lastTabLink.length) {
        lastTabLink.click();
    } else {
        panel.find('.st-chatu8-nav-link[data-tab="main"]').click();
    }

    const content = panel.find('.st-chatu8-modal-content');
    if (window.innerWidth <= 768) {
        const buttonHeight = $('#ai-config-button').outerHeight(true) || 0;
        panel.css({ 'align-items': 'start' });
        content.css({
            'margin-top': `${buttonHeight}px`,
            'height': `calc(90vh - ${buttonHeight}px)`
        });
    } else {
        panel.css({ 'align-items': '' });
        content.css({
            'margin-top': '',
            'height': '' // Reverts to the value from the stylesheet
        });
    }
    panel.css('display', 'grid');
    panel.find('.st-chatu8-modal-content').focus();
}


export function theme_export(all = false) {

    const settings = extension_settings[extensionName];
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

export function hideSettingsPanel() {
    const panel = $('#ch-settings-modal');
    panel.hide();
    // Reset any inline styles that might have been applied
    panel.css({ 'align-items': '', 'padding-top': '' });
    panel.find('.st-chatu8-modal-content').css({
        'margin-top': '',
        'height': ''
    });
}

export function prompt_replace_change(mode) {
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


export async function clearCache() {
    await stylishConfirm("是否清空图片缓存").then(async (result) => {
        if (result) {
            let imagesid = await storeReadOnly("tupianshuju") || {};
            if (imagesid) {
                for (let key of Object.keys(imagesid)) {
                    await storeDelete(key);
                }
                await storeDelete("tupianshuju");
            }
            alert("已清除图片缓存");
        }
    });
}

export function tishici_export_all() {
    const settings = extension_settings[extensionName];
    if (!settings.yushe || Object.keys(settings.yushe).length === 0) {
        alert("没有预设可导出。");
        return;
    }
    const dataStr = JSON.stringify(settings.yushe, null, 2);
    const blob = new Blob([dataStr], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "st-chatu8-prompt-presets-all.json";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}


export function applyTheme(theme) {
    if (!theme) {
        console.error(`Theme object is invalid.`);
        return;
    }
    const root = document.querySelector('#st-chatu8-settings');
    if (!root) return;

    for (const [key, value] of Object.entries(theme)) {
        root.style.setProperty(key, value);
    }

    // Update toggle icon based on brightness
    const themeIcon = document.querySelector('#ch-toggle-theme i');
    const isDark = isThemeDark(theme);
    if (isDark) {
        themeIcon.classList.remove('fa-moon');
        themeIcon.classList.add('fa-sun');
    } else {
        themeIcon.classList.remove('fa-sun');
        themeIcon.classList.add('fa-moon');
    }
}

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
    "--st-chatu8-text-highlight": "高亮文本颜色"
};
function isElementHidden(elementId) {
    const element = document.getElementById(elementId);
    if (!element) return false; // 元素不存在

    // 优先使用内联样式
    if (element.style.display === 'none') return true;

    // 获取计算后的样式
    const computedStyle = window.getComputedStyle(element);
    return computedStyle.display === 'none';
}

/**
 * Creates a stylish input prompt.
 * @param {string} message The message to display in the prompt.
 * @returns {Promise<string|false>} A promise that resolves with the input value or false if canceled.
 */
function stylInput(message) {
    return new Promise((resolve) => {
        const parent = document.getElementById('st-chatu8-settings') || document.body;

        const backdrop = document.createElement('div');
        backdrop.className = 'st-chatu8-confirm-backdrop';

        const confirmBox = document.createElement('div');
        confirmBox.className = 'st-chatu8-confirm-box';

        const messageText = document.createElement('p');
        messageText.textContent = message;
        messageText.className = 'st-chatu8-confirm-message';
        confirmBox.appendChild(messageText);

        const messageinput = document.createElement('input');
        messageinput.className = 'st-chatu8-text-input';
        confirmBox.appendChild(messageinput);

        const buttonContainer = document.createElement('div');
        buttonContainer.className = 'st-chatu8-confirm-buttons';
        confirmBox.appendChild(buttonContainer);

        const cancelButton = document.createElement('button');
        cancelButton.textContent = '取消';
        cancelButton.className = 'st-chatu8-btn';
        buttonContainer.appendChild(cancelButton);

        const confirmButton = document.createElement('button');
        confirmButton.textContent = '确定';
        confirmButton.className = 'st-chatu8-btn';
        buttonContainer.appendChild(confirmButton);

        backdrop.appendChild(confirmBox);
        parent.appendChild(backdrop);

        const close = (value) => {
            parent.removeChild(backdrop);
            resolve(value);
        };

        cancelButton.addEventListener('click', () => close(false));
        confirmButton.addEventListener('click', () => close(messageinput.value));
        messageinput.focus();
    });
}

/**
 * Creates a stylish confirmation dialog.
 * @param {string} message The message to display in the dialog.
 * @returns {Promise<boolean>} A promise that resolves with true if confirmed, false otherwise.
 */
function stylishConfirm(message) {
    return new Promise((resolve) => {
        const parent = document.getElementById('st-chatu8-settings') || document.body;

        const backdrop = document.createElement('div');
        backdrop.className = 'st-chatu8-confirm-backdrop';

        const confirmBox = document.createElement('div');
        confirmBox.className = 'st-chatu8-confirm-box';

        const messageText = document.createElement('p');
        messageText.textContent = message;
        messageText.className = 'st-chatu8-confirm-message';
        confirmBox.appendChild(messageText);

        const buttonContainer = document.createElement('div');
        buttonContainer.className = 'st-chatu8-confirm-buttons';
        confirmBox.appendChild(buttonContainer);

        const cancelButton = document.createElement('button');
        cancelButton.textContent = '取消';
        cancelButton.className = 'st-chatu8-btn';
        buttonContainer.appendChild(cancelButton);

        const confirmButton = document.createElement('button');
        confirmButton.textContent = '确定';
        confirmButton.className = 'st-chatu8-btn';
        buttonContainer.appendChild(confirmButton);

        backdrop.appendChild(confirmBox);
        parent.appendChild(backdrop);

        const close = (value) => {
            parent.removeChild(backdrop);
            resolve(value);
        };

        cancelButton.addEventListener('click', () => close(false));
        confirmButton.addEventListener('click', () => close(true));
        confirmButton.focus();
    });
}

// --- URL Validation ---
function isValidUrl(string) {
    // An empty string is considered valid to not show an error initially.
    if (!string || string.trim() === '') return true;
    // This regex allows http/https, localhost, IP addresses, and domain names, with optional port and path.
    const urlRegex = /^(https?:\/\/)?(localhost|([a-zA-Z0-9-]+\.)+[a-zA-Z]{2,}|(\d{1,3}\.){3}\d{1,3})(:\d+)?(\/.*)*$/;
    return urlRegex.test(string);
}

function validateUrlInput(inputElement) {
    if (!inputElement) return;
    const parentGroup = inputElement.closest('.st-chatu8-input-group');
    if (!parentGroup) return;

    const isValid = isValidUrl(inputElement.value);
    parentGroup.classList.toggle('invalid', !isValid);
}

// --- Helper function to get ID suffix based on mode ---
function getSuffix(mode) {
    if (mode === 'sd') return '';
    return `_${mode}`;
}

function size_change(prefix) {

    if (prefix=="sd") {

        prefix="sd_c"

    }else{

        prefix=prefix+"_"
    }

    console.log(prefix)
    const width = document.getElementById(`${prefix}width`);
    const height = document.getElementById(`${prefix}height`);
    const selectElement = document.getElementById(`${prefix}size`);
    if (width && height && selectElement) {
        const [selectElementwidth, selectElementheight] = selectElement.value.split("x");
        width.value = selectElementwidth;
        height.value = selectElementheight;
        $(width).trigger('input');
        $(height).trigger('input');
    }
}

export { 
    checkSendBuClass, 
    isElementHidden,
    stylInput,
    stylishConfirm,
    isValidUrl,
    validateUrlInput,
    getSuffix,
    size_change
};
