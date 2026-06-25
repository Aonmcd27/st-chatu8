// @ts-nocheck
/**
 * 配置档案管理模块
 * 用于 NovelAI 和 ComfyUI 配置的保存、读取、切换和删除
 */

import { extension_settings } from "../../../../../extensions.js";
import { saveSettingsDebounced } from "../../../../../../script.js";
import { extensionName, defaultSettings } from '../config.js';
import { stylishConfirm } from '../ui_common.js';

// NovelAI 配置档案包含的字段
const NOVELAI_PROFILE_KEYS = [
    // NovelAI 设置
    'novelaiApi',
    'novelaisite',
    'novelaiOtherSite',
    'enableCloudQueue',
    'cloudQueueUrl',
    'cloudQueueGreeting',
    'showQueueGreeting',
    'novelaimode',
    'novelai_sampler',
    'Schedule',
    'nai3Scale',
    'cfg_rescale',
    'AI_use_coords',
    'sm',
    'dyn',
    'nai3Variety',
    'nai3Deceisp',
    // Vibe Transfer
    'enableVibeGroupTransfer',
    'normalizeRefStrength',
    // 生成参数
    'novelai_width',
    'novelai_height',
    'novelai_steps',
    'novelai_seed'
];

// ComfyUI 配置档案包含的字段
const COMFYUI_PROFILE_KEYS = [
    // 工作流
    'workerid',
    'worker',
    // 修图预设
    'editWorkerid',
    'editWorker',
    // ComfyUI 设置
    'comfyuiUrl',
    // 其他设置
    'MODEL_NAME',
    'comfyuisamplerName',
    'comfyui_vae',
    'comfyui_scheduler',
    'comfyuiCLIPName',
    // 生成参数
    'comfyui_width',
    'comfyui_height',
    'comfyui_steps',
    'comfyui_seed',
    'cfg_comfyui'
];

/**
 * 获取当前设置对象
 */
function getSettings() {
    return extension_settings[extensionName];
}

/**
 * 刷新 NovelAI 配置档案下拉框
 */
export function refreshNovelaiProfileSelect() {
    const settings = getSettings();
    const select = document.getElementById('novelai_profile_id');
    if (!select) return;

    // 确保配置档案存在
    if (!settings.novelai_profiles) {
        settings.novelai_profiles = JSON.parse(JSON.stringify(defaultSettings.novelai_profiles));
    }
    if (!settings.novelai_profile_id) {
        settings.novelai_profile_id = "默认";
    }

    // Backward compatibility: ensure all profiles have enableVibeGroupTransfer
    for (const profileId in settings.novelai_profiles) {
        const profile = settings.novelai_profiles[profileId];
        if (profile.enableVibeGroupTransfer === undefined) {
            profile.enableVibeGroupTransfer = 'false';
        }
        if (profile.normalizeRefStrength === undefined) {
            profile.normalizeRefStrength = 'false';
        }
    }

    select.innerHTML = '';
    const sortedKeys = Object.keys(settings.novelai_profiles).sort((a, b) => a.localeCompare(b, 'zh-CN'));
    for (const key of sortedKeys) {
        const option = new Option(key, key);
        option.title = key;
        select.add(option);
    }
    select.value = settings.novelai_profile_id;
}

/**
 * 刷新 ComfyUI 配置档案下拉框
 */
export function refreshComfyuiProfileSelect() {
    const settings = getSettings();
    const select = document.getElementById('comfyui_profile_id');
    if (!select) return;

    // 确保配置档案存在
    if (!settings.comfyui_profiles) {
        settings.comfyui_profiles = JSON.parse(JSON.stringify(defaultSettings.comfyui_profiles));
    }
    if (!settings.comfyui_profile_id) {
        settings.comfyui_profile_id = "默认";
    }

    select.innerHTML = '';
    const sortedKeys = Object.keys(settings.comfyui_profiles).sort((a, b) => a.localeCompare(b, 'zh-CN'));
    for (const key of sortedKeys) {
        const option = new Option(key, key);
        option.title = key;
        select.add(option);
    }
    select.value = settings.comfyui_profile_id;
}

/**
 * 从当前设置收集 NovelAI 配置
 */
function collectNovelaiProfile() {
    const settings = getSettings();
    const profile = {};
    for (const key of NOVELAI_PROFILE_KEYS) {
        profile[key] = settings[key];
    }
    return profile;
}

/**
 * 从当前设置收集 ComfyUI 配置
 */
function collectComfyuiProfile() {
    const settings = getSettings();
    const profile = {};
    for (const key of COMFYUI_PROFILE_KEYS) {
        profile[key] = settings[key];
    }
    return profile;
}

/**
 * 应用 NovelAI 配置到当前设置
 */
function applyNovelaiProfile(profile) {
    const settings = getSettings();

    // Backward compatibility: ensure enableVibeGroupTransfer exists in profile
    if (profile.enableVibeGroupTransfer === undefined) {
        profile.enableVibeGroupTransfer = 'false';
    }
    if (profile.normalizeRefStrength === undefined) {
        profile.normalizeRefStrength = 'false';
    }

    for (const key of NOVELAI_PROFILE_KEYS) {
        if (profile[key] !== undefined) {
            settings[key] = profile[key];
            // 同步 UI
            const element = document.getElementById(key);
            if (element) {
                if (element.type === 'checkbox') {
                    element.checked = String(profile[key]) === 'true';
                } else {
                    element.value = profile[key];
                }
            }
        }
    }
    // 同步滑块
    syncSliders();
}

/**
 * 应用 ComfyUI 配置到当前设置
 */
function applyComfyuiProfile(profile) {
    const settings = getSettings();
    for (const key of COMFYUI_PROFILE_KEYS) {
        if (profile[key] !== undefined) {
            settings[key] = profile[key];
            // 同步 UI
            const element = document.getElementById(key);
            if (element) {
                if (element.type === 'checkbox') {
                    element.checked = String(profile[key]) === 'true';
                } else {
                    element.value = profile[key];
                }
            }
        }
    }
    // 处理工作流下拉框
    const workerSelect = document.getElementById('workerid');
    if (workerSelect && profile.workerid) {
        workerSelect.value = profile.workerid;
    }
    const workerTextarea = document.getElementById('worker');
    if (workerTextarea && profile.worker) {
        workerTextarea.value = typeof profile.worker === 'string' ? profile.worker : JSON.stringify(profile.worker, null, 2);
    }

    // 处理修图预设下拉框和文本框
    const editWorkerSelect = document.getElementById('editWorkerid');
    if (editWorkerSelect && profile.editWorkerid) {
        editWorkerSelect.value = profile.editWorkerid;
    }
    const editWorkerTextarea = document.getElementById('editWorker');
    if (editWorkerTextarea) {
        if (profile.editWorker) {
            editWorkerTextarea.value = typeof profile.editWorker === 'string' ? profile.editWorker : JSON.stringify(profile.editWorker, null, 2);
        } else if (profile.editWorkerid && settings.workers[profile.editWorkerid]) {
            // 如果没有 editWorker 但有 editWorkerid，从 workers 中读取
            editWorkerTextarea.value = settings.workers[profile.editWorkerid];
        }
    }
}

/**
 * 同步滑块和数值输入框
 */
function syncSliders() {
    // NovelAI Vibe Transfer 滑块（如果适用）
    const pairs = [
        ['InformationExtracted', 'InformationExtracted_range'],
        ['ReferenceStrength', 'ReferenceStrength_range']
    ];
    for (const [numId, rangeId] of pairs) {
        const numInput = document.getElementById(numId);
        const rangeInput = document.getElementById(rangeId);
        if (numInput && rangeInput) {
            rangeInput.value = numInput.value;
        }
    }
}

/**
 * 初始化配置档案控件事件
 */
export function initProfileControls(settingsModal) {
    const settings = getSettings();

    // 确保配置档案数据存在
    if (!settings.novelai_profiles) {
        settings.novelai_profiles = JSON.parse(JSON.stringify(defaultSettings.novelai_profiles));
    }
    if (!settings.comfyui_profiles) {
        settings.comfyui_profiles = JSON.parse(JSON.stringify(defaultSettings.comfyui_profiles));
    }

    // ========== NovelAI 配置档案 ==========

    // 读取配置
    settingsModal.find('#novelai_profile_load').on('click', function () {
        const select = document.getElementById('novelai_profile_id');
        if (!select) return;

        const profileId = select.value;
        const profile = settings.novelai_profiles[profileId];
        if (profile) {
            applyNovelaiProfile(profile);
            settings.novelai_profile_id = profileId;
            saveSettingsDebounced();
            toastr.success(`已加载配置: ${profileId}`);
        }
    });

    // 新建配置
    settingsModal.find('#novelai_profile_new').on('click', async function () {
        const name = prompt('请输入新配置名称:');
        if (!name || name.trim() === '') return;

        const trimmedName = name.trim();
        if (settings.novelai_profiles[trimmedName]) {
            const overwrite = await stylishConfirm('确认覆盖', `配置 "${trimmedName}" 已存在，是否覆盖？`);
            if (!overwrite) return;
        }

        // 保存当前设置到新配置
        settings.novelai_profiles[trimmedName] = collectNovelaiProfile();
        settings.novelai_profile_id = trimmedName;
        refreshNovelaiProfileSelect();
        saveSettingsDebounced();
        toastr.success(`已创建配置: ${trimmedName}`);
    });

    // 保存配置
    settingsModal.find('#novelai_profile_save').on('click', async function () {
        const select = document.getElementById('novelai_profile_id');
        if (!select) return;

        const profileId = select.value;
        if (!profileId) return;

        const confirmed = await stylishConfirm('确认保存', `确定要将当前所有设置保存并覆盖到配置 "${profileId}" 中吗？`);
        if (!confirmed) return;

        settings.novelai_profiles[profileId] = collectNovelaiProfile();
        saveSettingsDebounced();
        toastr.success(`已保存当前配置: ${profileId}`);
    });

    // 删除配置
    settingsModal.find('#novelai_profile_delete').on('click', async function () {
        const select = document.getElementById('novelai_profile_id');
        if (!select) return;

        const profileId = select.value;
        if (profileId === '默认') {
            toastr.warning('不能删除默认配置');
            return;
        }

        const confirmed = await stylishConfirm('确认删除', `确定要删除配置 "${profileId}" 吗？`);
        if (!confirmed) return;

        delete settings.novelai_profiles[profileId];
        settings.novelai_profile_id = '默认';
        refreshNovelaiProfileSelect();
        saveSettingsDebounced();
        toastr.success(`已删除配置: ${profileId}`);
    });

    // 下拉框变化时自动加载
    settingsModal.find('#novelai_profile_id').on('change', function () {
        const profileId = this.value;
        const profile = settings.novelai_profiles[profileId];
        if (profile) {
            applyNovelaiProfile(profile);
            settings.novelai_profile_id = profileId;
            saveSettingsDebounced();
        }
    });

    // ========== ComfyUI 配置档案 ==========

    // 读取配置
    settingsModal.find('#comfyui_profile_load').on('click', function () {
        const select = document.getElementById('comfyui_profile_id');
        if (!select) return;

        const profileId = select.value;
        const profile = settings.comfyui_profiles[profileId];
        if (profile) {
            applyComfyuiProfile(profile);
            settings.comfyui_profile_id = profileId;
            saveSettingsDebounced();
            toastr.success(`已加载配置: ${profileId}`);
        }
    });

    // 新建配置
    settingsModal.find('#comfyui_profile_new').on('click', async function () {
        const name = prompt('请输入新配置名称:');
        if (!name || name.trim() === '') return;

        const trimmedName = name.trim();
        if (settings.comfyui_profiles[trimmedName]) {
            const overwrite = await stylishConfirm('确认覆盖', `配置 "${trimmedName}" 已存在，是否覆盖？`);
            if (!overwrite) return;
        }

        // 保存当前设置到新配置
        settings.comfyui_profiles[trimmedName] = collectComfyuiProfile();
        settings.comfyui_profile_id = trimmedName;
        refreshComfyuiProfileSelect();
        saveSettingsDebounced();
        toastr.success(`已创建配置: ${trimmedName}`);
    });

    // 保存配置
    settingsModal.find('#comfyui_profile_save').on('click', async function () {
        const select = document.getElementById('comfyui_profile_id');
        if (!select) return;

        const profileId = select.value;
        if (!profileId) return;

        const confirmed = await stylishConfirm('确认保存', `确定要将当前所有设置保存并覆盖到配置 "${profileId}" 中吗？`);
        if (!confirmed) return;

        settings.comfyui_profiles[profileId] = collectComfyuiProfile();
        saveSettingsDebounced();
        toastr.success(`已保存当前配置: ${profileId}`);
    });

    // 删除配置
    settingsModal.find('#comfyui_profile_delete').on('click', async function () {
        const select = document.getElementById('comfyui_profile_id');
        if (!select) return;

        const profileId = select.value;
        if (profileId === '默认') {
            toastr.warning('不能删除默认配置');
            return;
        }

        const confirmed = await stylishConfirm('确认删除', `确定要删除配置 "${profileId}" 吗？`);
        if (!confirmed) return;

        delete settings.comfyui_profiles[profileId];
        settings.comfyui_profile_id = '默认';
        refreshComfyuiProfileSelect();
        saveSettingsDebounced();
        toastr.success(`已删除配置: ${profileId}`);
    });

    // 下拉框变化时自动加载
    settingsModal.find('#comfyui_profile_id').on('change', function () {
        const profileId = this.value;
        const profile = settings.comfyui_profiles[profileId];
        if (profile) {
            applyComfyuiProfile(profile);
            settings.comfyui_profile_id = profileId;
            saveSettingsDebounced();
        }
    });

    // 初始刷新下拉框
    refreshNovelaiProfileSelect();
    refreshComfyuiProfileSelect();
}
