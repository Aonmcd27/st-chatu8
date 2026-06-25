// @ts-nocheck
/**
 * personaPreset.js - 人设预设管理模块
 * 处理人设相关的 CRUD 操作、导入导出、自动保存
 */

import { extension_settings } from "../../../../../../extensions.js";
import { saveSettingsDebounced } from "../../../../../../../script.js";
import { extensionName } from '../../config.js';
import { stylInput, stylishConfirm } from '../../ui_common.js';
import { saveConfigImage, getConfigImage, deleteConfigImage } from '../../configDatabase.js';
import { AVATAR_CONFIG } from '../../avatarConfig.js';

/**
 * 人设的所有可编辑字段列表
 */
const PERSONA_FIELDS = [
    'name',
    'age',
    'gender',
    'race',
    'personality',
    'background',
    'bodyType',
    'appearance',
    'hobbies',
    'abilities',
    'speechStyle',
    'relationships',
    // ★ 次元穿越相关字段
    'isekai_origin',
    'isekai_method',
    'isekai_reaction',
    'isekai_goal',
    'notes',
    'avatarId'  // 头像图片ID
];

/** 人设字段对应的中文标签（用于提示词构建等） */
const PERSONA_FIELD_LABELS = {
    name: '角色名称',
    age: '年龄',
    gender: '性别',
    race: '种族/物种',
    personality: '性格',
    background: '背景',
    bodyType: '身材',
    appearance: '外貌特征',
    hobbies: '爱好',
    abilities: '特殊能力',
    speechStyle: '口癖/说话方式',
    relationships: '人际关系',
    // ★ 次元穿越相关字段
    isekai_origin: '穿越来源',
    isekai_method: '穿越方式',
    isekai_reaction: '穿越后反应',
    isekai_goal: '穿越期间目标',
    notes: '其他备注',
    avatarId: '头像'
};

// ---------- 自动保存 debounce ----------
let _autoSaveTimer = null;
const AUTO_SAVE_DELAY = 600;

/** 容器引用 */
let $container = null;

// ========== 初始化 ==========

/**
 * 确保 personaProfiles 数据结构已初始化
 */
function ensureDataStructure() {
    const settings = extension_settings[extensionName];
    if (!settings.personaProfiles) {
        settings.personaProfiles = {
            presets: {},
            currentPresetId: '',
            enabled: false,
            injectionMode: 'alwaysOn'
        };
    }
    if (!settings.personaProfiles.presets) {
        settings.personaProfiles.presets = {};
    }
    return settings.personaProfiles;
}

/**
 * 设置人设控件 - 绑定所有事件（初始化时调用一次）
 * @param {jQuery} container - 设置面板的 jQuery 对象
 */
export function setupPersonaControls(container) {
    $container = container;
    ensureDataStructure();

    // 加载预设列表
    loadPersonaPresetList();

    // 绑定预设选择
    container.find('#ch-persona-preset-id').on('change', onPresetChange);

    // 绑定按钮
    container.find('#ch-persona-new').on('click', onNewPreset);
    container.find('#ch-persona-rename').on('click', onRenamePreset);
    container.find('#ch-persona-save').on('click', onSavePreset);
    container.find('#ch-persona-save-as').on('click', onSaveAsPreset);
    container.find('#ch-persona-export').on('click', onExportPreset);
    container.find('#ch-persona-export-all').on('click', onExportAllPresets);
    container.find('#ch-persona-import').on('click', () => {
        container.find('#ch-persona-import-file').click();
    });
    container.find('#ch-persona-import-file').on('change', onImportPreset);
    container.find('#ch-persona-delete').on('click', onDeletePreset);

    // 绑定头像上传
    container.find('#ch-persona-avatar-upload-btn').on('click', () => {
        container.find('#ch-persona-avatar-input').click();
    });
    container.find('#ch-persona-avatar-input').on('change', onPersonaAvatarUpload);
    container.find('#ch-persona-avatar-remove-btn').on('click', onPersonaAvatarRemove);
    container.find('#ch-persona-avatar-preview').on('click', () => {
        container.find('#ch-persona-avatar-input').click();
    });

    // 绑定全局控制
    container.find('#ch-persona-enabled').on('change', onGlobalSettingChange);

    // 绑定字段自动保存
    bindFieldAutoSave(container);

    // 加载全局设置到 UI
    loadGlobalSettings();

    // 加载当前预设
    loadPersonaPresetData();
}

// ========== 预设列表管理 ==========

/**
 * 刷新预设下拉列表
 */
export function loadPersonaPresetList() {
    const profiles = ensureDataStructure();
    const $select = $container?.find('#ch-persona-preset-id');
    if (!$select || !$select.length) return;

    $select.empty();
    $select.append('<option value="">(请选择人设预设)</option>');

    // 按中文拼音排序
    const sortedNames = Object.keys(profiles.presets).sort((a, b) =>
        a.localeCompare(b, 'zh-CN', { sensitivity: 'base' })
    );

    for (const presetName of sortedNames) {
        const option = $('<option></option>').val(presetName).text(presetName);
        $select.append(option);
    }

    // 恢复选择
    if (profiles.currentPresetId && profiles.presets[profiles.currentPresetId]) {
        $select.val(profiles.currentPresetId);
    }
}

// ========== 预设加载 ==========

/**
 * 加载当前选中预设的数据到 UI
 */
export async function loadPersonaPresetData() {
    const profiles = ensureDataStructure();
    const presetId = profiles.currentPresetId;
    const preset = presetId ? profiles.presets[presetId] : null;

    PERSONA_FIELDS.forEach(field => {
        if (field === 'avatarId') return; // 跳过 avatarId
        const $el = $container?.find(`#ch-persona-${field}`);
        if ($el && $el.length) {
            $el.val(preset ? (preset[field] || '') : '');
        }
    });

    // 加载头像
    if (preset && preset.avatarId) {
        try {
            const base64 = await getConfigImage(preset.avatarId);
            if (base64) {
                displayPersonaAvatar(base64);
            } else {
                clearPersonaAvatarDisplay();
            }
        } catch (error) {
            console.error('[PersonaPreset] 加载头像失败:', error);
            clearPersonaAvatarDisplay();
        }
    } else {
        clearPersonaAvatarDisplay();
    }
}

/**
 * 加载全局设置到 UI
 */
function loadGlobalSettings() {
    const profiles = ensureDataStructure();
    $container?.find('#ch-persona-enabled').prop('checked', profiles.enabled || false);
}

// ========== 事件处理 ==========

/** 预设切换 */
async function onPresetChange() {
    const profiles = ensureDataStructure();
    const newPresetId = $container?.find('#ch-persona-preset-id').val() || '';

    profiles.currentPresetId = newPresetId;
    await loadPersonaPresetData();
    saveSettingsDebounced();
}

/** 新建预设 */
async function onNewPreset() {
    // 清除待执行的自动保存，避免旧数据污染新预设
    clearTimeout(_autoSaveTimer);

    const result = await stylInput('请输入新人设预设的名称', '');
    if (!result || !result.trim()) return;

    const name = result.trim();
    const profiles = ensureDataStructure();

    if (profiles.presets[name]) {
        toastr.warning(`人设预设「${name}」已存在，请使用其他名称。`);
        return;
    }

    // 创建空白预设
    const emptyPreset = {};
    PERSONA_FIELDS.forEach(field => {
        emptyPreset[field] = '';
    });

    profiles.presets[name] = emptyPreset;
    profiles.currentPresetId = name;
    saveSettingsDebounced();

    loadPersonaPresetList();
    // 强制清空所有输入框
    clearPersonaFields();
    toastr.success(`人设预设「${name}」已创建。`);
}

/** 保存当前预设 */
function onSavePreset() {
    const profiles = ensureDataStructure();
    const presetId = profiles.currentPresetId;

    if (!presetId || !profiles.presets[presetId]) {
        toastr.warning('没有活动的人设预设可保存。请先新建或选择一个预设。');
        return;
    }

    saveCurrentPersonaData(presetId);
    toastr.success(`人设预设「${presetId}」已保存。`);
}

/** 另存为 */
async function onSaveAsPreset() {
    const profiles = ensureDataStructure();
    const defaultName = profiles.currentPresetId || '';

    const result = await stylInput('请输入新人设预设的名称', defaultName);
    if (!result || !result.trim()) return;

    const name = result.trim();
    saveCurrentPersonaData(name);
    profiles.currentPresetId = name;
    saveSettingsDebounced();

    loadPersonaPresetList();
    toastr.success(`人设预设「${name}」已保存。`);
}

/** 重命名预设 */
async function onRenamePreset() {
    const profiles = ensureDataStructure();
    const currentName = profiles.currentPresetId;
    if (!currentName || !profiles.presets[currentName]) {
        toastr.warning('没有活动的人设预设可重命名。');
        return;
    }
    
    // Check if it's a default preset that shouldn't be renamed, though there doesn't seem to be a specific default preset constraint in the code for personaPresets, we add standard default protection
    if (currentName === "默认" || currentName === "default") {
        toastr.warning("默认预设不能重命名。");
        return;
    }
    
    const result = await stylInput("请输入新的人设预设名称", currentName);
    if (!result || !result.trim() || result.trim() === currentName) return;

    const newName = result.trim();
    if (profiles.presets[newName]) {
        toastr.error(`预设「${newName}」已存在，请换一个名称。`);
        return;
    }
    
    profiles.presets[newName] = profiles.presets[currentName];
    delete profiles.presets[currentName];
    
    profiles.currentPresetId = newName;
    
    // 如果 User 预设也在使用这个名称，也一并更新？
    // 因为 user 和 persona 共享 presests
    if (profiles.currentUserPresetId === currentName) {
        profiles.currentUserPresetId = newName;
    }
    
    saveSettingsDebounced();
    loadPersonaPresetList();
    toastr.success(`人设预设已重命名为「${newName}」`);
}

/** 删除预设 */
async function onDeletePreset() {
    const profiles = ensureDataStructure();
    const presetId = profiles.currentPresetId;

    if (!presetId || !profiles.presets[presetId]) {
        toastr.warning('没有选中的人设预设可删除。');
        return;
    }

    const confirmed = await stylishConfirm(`确定要删除人设预设「${presetId}」吗？\n此操作不可撤销！`);
    if (!confirmed) return;

    // 删除头像
    const avatarId = profiles.presets[presetId].avatarId;
    if (avatarId) {
        try {
            await deleteConfigImage(avatarId);
        } catch (error) {
            console.error('[PersonaPreset] 删除头像失败:', error);
        }
    }

    delete profiles.presets[presetId];

    // 切换到第一个可用预设或清空
    const remaining = Object.keys(profiles.presets);
    profiles.currentPresetId = remaining.length > 0 ? remaining[0] : '';
    saveSettingsDebounced();

    loadPersonaPresetList();
    await loadPersonaPresetData();
    toastr.success(`人设预设「${presetId}」已删除。`);
}

/** 导出当前预设 */
async function onExportPreset() {
    const profiles = ensureDataStructure();
    const presetId = profiles.currentPresetId;
    const preset = presetId ? profiles.presets[presetId] : null;

    if (!preset) {
        toastr.warning('没有选中的人设预设可导出。');
        return;
    }

    // 导出数据
    const exportData = {
        type: 'chatu8_persona_profile',
        version: '1.1', // 版本号升级
        data: {
            [presetId]: { ...preset }
        }
    };

    // 如果有头像，将头像 Base64 一起导出
    if (preset.avatarId) {
        try {
            const avatarBase64 = await getConfigImage(preset.avatarId);
            if (avatarBase64) {
                exportData.avatars = {
                    [presetId]: avatarBase64
                };
            }
        } catch (error) {
            console.error('[PersonaPreset] 导出头像失败:', error);
        }
    }

    downloadJson(exportData, `st-chatu8-人设-${presetId}.json`);
    toastr.success(`人设预设「${presetId}」已导出。`);
}

/** 导出全部预设 */
async function onExportAllPresets() {
    const profiles = ensureDataStructure();

    if (!profiles.presets || Object.keys(profiles.presets).length === 0) {
        toastr.warning('没有人设预设可导出。');
        return;
    }

    const exportData = {
        type: 'chatu8_persona_profile',
        version: '1.1', // 版本号升级
        data: { ...profiles.presets },
        avatars: {}
    };

    // 导出所有头像
    for (const [presetId, preset] of Object.entries(profiles.presets)) {
        if (preset.avatarId) {
            try {
                const avatarBase64 = await getConfigImage(preset.avatarId);
                if (avatarBase64) {
                    exportData.avatars[presetId] = avatarBase64;
                }
            } catch (error) {
                console.error(`[PersonaPreset] 导出头像失败 (${presetId}):`, error);
            }
        }
    }

    downloadJson(exportData, 'st-chatu8-人设-全部.json');
    toastr.success(`已导出全部 ${Object.keys(profiles.presets).length} 个人设预设。`);
}

/** 导入预设 */
async function onImportPreset(event) {
    const file = event.target.files?.[0];
    if (!file) return;

    try {
        const text = await file.text();
        const importedData = JSON.parse(text);

        // 验证格式
        if (importedData.type !== 'chatu8_persona_profile' || !importedData.data) {
            toastr.error('无效的人设预设文件格式！');
            return;
        }

        const profiles = ensureDataStructure();
        const presetsToImport = importedData.data;
        const avatarsToImport = importedData.avatars || {};
        let newCount = 0;
        let updateCount = 0;

        for (const key in presetsToImport) {
            if (!presetsToImport.hasOwnProperty(key)) continue;

            const presetData = presetsToImport[key];

            // 如果有头像数据，保存头像
            if (avatarsToImport[key]) {
                try {
                    const avatarId = await saveConfigImage(avatarsToImport[key], {
                        format: 'png',
                        filename: `persona_avatar_${key}_${Date.now()}`
                    });
                    presetData.avatarId = avatarId;
                } catch (error) {
                    console.error('[PersonaPreset] 导入头像失败:', error);
                    presetData.avatarId = '';
                }
            }

            if (profiles.presets.hasOwnProperty(key)) {
                // 删除旧头像
                const oldAvatarId = profiles.presets[key].avatarId;
                if (oldAvatarId) {
                    await deleteConfigImage(oldAvatarId);
                }
                updateCount++;
            } else {
                newCount++;
            }

            profiles.presets[key] = presetData;
        }

        // 自动选中第一个导入的预设
        const firstKey = Object.keys(presetsToImport)[0];
        if (firstKey) {
            profiles.currentPresetId = firstKey;
        }

        saveSettingsDebounced();
        loadPersonaPresetList();
        await loadPersonaPresetData();

        const total = Object.keys(presetsToImport).length;
        toastr.success(`成功导入 ${total} 个人设预设（${newCount} 个新增，${updateCount} 个更新）。`);
    } catch (e) {
        console.error('[PersonaPreset] 导入失败:', e);
        toastr.error('导入失败：' + e.message);
    }

    // 重置 file input
    event.target.value = '';
}

/** 全局设置变更 */
function onGlobalSettingChange() {
    const profiles = ensureDataStructure();
    profiles.enabled = $container?.find('#ch-persona-enabled').prop('checked') || false;
    saveSettingsDebounced();
}

// ========== 自动保存 ==========

/**
 * 绑定字段变化的自动保存
 */
function bindFieldAutoSave(container) {
    PERSONA_FIELDS.forEach(field => {
        container.find(`#ch-persona-${field}`).on('input', () => {
            triggerAutoSave();
        });
    });
}

/** 触发自动保存（debounce） */
function triggerAutoSave() {
    const profiles = ensureDataStructure();
    if (!profiles.currentPresetId) return;

    clearTimeout(_autoSaveTimer);
    _autoSaveTimer = setTimeout(() => {
        if (!profiles.currentPresetId) return;
        saveCurrentPersonaData(profiles.currentPresetId);
    }, AUTO_SAVE_DELAY);
}

/**
 * 强制清空所有人设字段输入框
 * 同时使用 jQuery 和原生 DOM 双重保障
 */
function clearPersonaFields() {
    PERSONA_FIELDS.forEach(field => {
        // 方式1: 通过 $container jQuery 查找
        const $el = $container?.find(`#ch-persona-${field}`);
        if ($el && $el.length) {
            $el.val('');
        }
        // 方式2: 通过原生 DOM 查找（fallback）
        const el = document.getElementById(`ch-persona-${field}`);
        if (el) {
            el.value = '';
        }
    });
}

/**
 * 程序化创建预设（供 personaGen 等外部模块调用）
 * @param {string} name - 预设名称
 * @param {Object} [data={}] - 预设字段数据
 * @returns {string} 最终使用的预设名称（可能因重名而追加后缀）
 */
export function createPersonaPreset(name, data = {}) {
    // 清除待执行的自动保存，避免旧数据污染新预设
    clearTimeout(_autoSaveTimer);

    const profiles = ensureDataStructure();

    // 处理重名：追加数字后缀
    let finalName = name;
    let counter = 1;
    while (profiles.presets[finalName]) {
        finalName = `${name}_${counter++}`;
    }

    // 构建预设数据
    const preset = {};
    PERSONA_FIELDS.forEach(field => {
        preset[field] = (data[field] !== undefined && data[field] !== null) ? String(data[field]) : '';
    });

    profiles.presets[finalName] = preset;
    profiles.currentPresetId = finalName;
    saveSettingsDebounced();

    loadPersonaPresetList();
    loadPersonaPresetData();

    return finalName;
}

// ========== 数据收集与保存 ==========

/**
 * 从 UI 收集字段值并保存到指定预设
 * @param {string} presetId 
 */
function saveCurrentPersonaData(presetId) {
    const profiles = ensureDataStructure();
    const preset = {};

    PERSONA_FIELDS.forEach(field => {
        const $el = $container?.find(`#ch-persona-${field}`);
        if ($el && $el.length) {
            preset[field] = $el.val() || '';
        }
    });

    profiles.presets[presetId] = preset;
    saveSettingsDebounced();
}

// ========== 工具函数 ==========

/**
 * 下载 JSON 文件
 */
function downloadJson(data, filename) {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

// ========== 导出常量供其他模块使用 ==========

export { PERSONA_FIELDS, PERSONA_FIELD_LABELS };


// ========== 头像管理 ==========

/**
 * 头像上传处理
 */
async function onPersonaAvatarUpload(event) {
    const file = event.target.files?.[0];
    if (!file) return;

    // 验证文件类型
    if (!AVATAR_CONFIG.acceptedFormats.includes(file.type)) {
        toastr.error('请选择有效的图片文件（JPG、PNG、WebP、GIF）！');
        return;
    }

    // 验证文件大小
    if (file.size > AVATAR_CONFIG.maxFileSize) {
        toastr.error('图片文件过大，请选择小于 5MB 的图片！');
        return;
    }

    try {
        // 读取图片为 Base64
        const base64 = await readFileAsBase64(file);

        // 压缩图片到合适尺寸
        const compressedBase64 = await compressImage(
            base64,
            AVATAR_CONFIG.maxWidth,
            AVATAR_CONFIG.maxHeight,
            AVATAR_CONFIG.quality
        );

        // 保存到 configDatabase
        const avatarId = await saveConfigImage(compressedBase64, {
            format: file.type.split('/')[1] || 'png',
            filename: `persona_avatar_${Date.now()}`
        });

        // 删除旧头像（如果存在）
        const profiles = ensureDataStructure();
        const presetId = profiles.currentPresetId;
        if (presetId && profiles.presets[presetId]) {
            const oldAvatarId = profiles.presets[presetId].avatarId;
            if (oldAvatarId) {
                await deleteConfigImage(oldAvatarId);
            }

            // 更新预设数据
            profiles.presets[presetId].avatarId = avatarId;
            saveSettingsDebounced();
        }

        // 更新 UI 显示
        displayPersonaAvatar(compressedBase64);

        toastr.success('头像上传成功！');
    } catch (error) {
        console.error('[PersonaPreset] 头像上传失败:', error);
        toastr.error('头像上传失败：' + error.message);
    }

    // 重置 file input
    event.target.value = '';
}

/**
 * 移除头像
 */
async function onPersonaAvatarRemove() {
    const profiles = ensureDataStructure();
    const presetId = profiles.currentPresetId;

    if (!presetId || !profiles.presets[presetId]) {
        toastr.warning('没有选中的预设。');
        return;
    }

    const avatarId = profiles.presets[presetId].avatarId;
    if (!avatarId) {
        toastr.info('当前预设没有设置头像。');
        return;
    }

    try {
        // 删除图片
        await deleteConfigImage(avatarId);

        // 更新预设数据
        profiles.presets[presetId].avatarId = '';
        saveSettingsDebounced();

        // 更新 UI
        clearPersonaAvatarDisplay();

        toastr.success('头像已移除。');
    } catch (error) {
        console.error('[PersonaPreset] 移除头像失败:', error);
        toastr.error('移除头像失败：' + error.message);
    }
}

/**
 * 显示头像
 */
function displayPersonaAvatar(base64) {
    const $preview = $container?.find('#ch-persona-avatar-preview');
    const $img = $container?.find('#ch-persona-avatar-img');
    const $removeBtn = $container?.find('#ch-persona-avatar-remove-btn');

    if ($img && $img.length) {
        $img.attr('src', base64);
        $img.addClass('loaded');
    }
    if ($preview && $preview.length) {
        $preview.addClass('has-image');
    }
    if ($removeBtn && $removeBtn.length) {
        $removeBtn.show();
    }
}

/**
 * 清除头像显示
 */
function clearPersonaAvatarDisplay() {
    const $preview = $container?.find('#ch-persona-avatar-preview');
    const $img = $container?.find('#ch-persona-avatar-img');
    const $removeBtn = $container?.find('#ch-persona-avatar-remove-btn');

    if ($img && $img.length) {
        $img.attr('src', '');
        $img.removeClass('loaded');
    }
    if ($preview && $preview.length) {
        $preview.removeClass('has-image');
    }
    if ($removeBtn && $removeBtn.length) {
        $removeBtn.hide();
    }
}

/**
 * 工具函数：读取文件为 Base64
 */
function readFileAsBase64(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = reject;
        reader.readAsDataURL(file);
    });
}

/**
 * 工具函数：压缩图片
 */
function compressImage(base64, maxWidth, maxHeight, quality = 0.9) {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => {
            let width = img.width;
            let height = img.height;

            // 计算缩放比例
            if (width > maxWidth || height > maxHeight) {
                const ratio = Math.min(maxWidth / width, maxHeight / height);
                width = Math.floor(width * ratio);
                height = Math.floor(height * ratio);
            }

            // 创建 canvas 并绘制
            const canvas = document.createElement('canvas');
            canvas.width = width;
            canvas.height = height;
            const ctx = canvas.getContext('2d');
            ctx.drawImage(img, 0, 0, width, height);

            // 转换为 Base64
            resolve(canvas.toDataURL('image/png', quality));
        };
        img.onerror = reject;
        img.src = base64;
    });
}

/**
 * 导出头像获取函数供外部使用
 */
export async function getPersonaAvatarById(presetId) {
    const profiles = ensureDataStructure();
    const preset = profiles.presets[presetId];
    if (!preset || !preset.avatarId) return null;

    try {
        return await getConfigImage(preset.avatarId);
    } catch (error) {
        console.error('[PersonaPreset] 获取头像失败:', error);
        return null;
    }
}

/**
 * 清除头像缓存
 */
const avatarCache = new Map();

export function clearAvatarCache(presetId = null) {
    if (presetId) {
        avatarCache.delete(presetId);
    } else {
        avatarCache.clear();
    }
}
