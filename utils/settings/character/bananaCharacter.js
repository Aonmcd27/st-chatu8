// @ts-nocheck
/**
 * Banana 角色管理模块
 * 处理 Banana 角色的 CRUD 操作
 */

import { extension_settings } from "../../../../../../extensions.js";
import { saveSettingsDebounced } from "../../../../../../../script.js";
import { extensionName } from '../../config.js';
import { stylInput, stylishConfirm } from '../../ui_common.js';
import { saveConfigImage, getConfigImage, deleteConfigImage } from '../../configDatabase.js';

// ========== Banana 角色管理 ==========

/**
 * 设置 Banana 角色管理控件
 */
export function setupBananaCharacterControls(container) {
    // 加载预设列表
    loadBananaCharacterPresetList();

    // 绑定预设选择
    container.find('#banana_char_preset_id').on('change', loadBananaCharacterPreset);

    // 绑定按钮
    container.find('#banana_char_new').on('click', createNewBananaCharacterPreset);
    container.find('#banana_char_rename').on('click', renameBananaCharacterPreset);
    container.find('#banana_char_update').on('click', updateBananaCharacterPreset);
    container.find('#banana_char_save_as').on('click', saveBananaCharacterPresetAs);
    container.find('#banana_char_delete').on('click', deleteBananaCharacterPreset);

    // 绑定图片上传
    setupBananaImageUpload('user');
    setupBananaImageUpload('model');

    // 加载当前预设
    loadBananaCharacterPreset();
}

export function loadBananaCharacterPresetList() {
    const settings = extension_settings[extensionName];
    const select = document.getElementById('banana_char_preset_id');

    if (!select) return;

    select.innerHTML = '';

    for (const presetName in settings.bananaCharacterPresets) {
        const option = document.createElement('option');
        option.value = presetName;
        option.textContent = presetName;
        select.add(option);
    }

    select.value = settings.bananaCharacterPresetId;
}

export async function loadBananaCharacterPreset() {
    const settings = extension_settings[extensionName];
    const select = document.getElementById('banana_char_preset_id');
    if (!select) return;

    const presetId = select.value;
    settings.bananaCharacterPresetId = presetId;

    const preset = settings.bananaCharacterPresets[presetId];
    if (!preset) return;

    // 检查并迁移旧格式
    let migrated = false;
    const conversation = preset.conversation || { user: { text: '' }, model: { text: '' } };

    // 迁移用户图片
    if (conversation.user?.image && conversation.user.image.startsWith('data:image')) {
        const imageId = await saveConfigImage(conversation.user.image);
        conversation.user.imageId = imageId;
        delete conversation.user.image;
        migrated = true;
        console.log('[Character] 迁移 Banana 用户图片:', imageId);
    }

    // 迁移模型图片
    if (conversation.model?.image && conversation.model.image.startsWith('data:image')) {
        const imageId = await saveConfigImage(conversation.model.image);
        conversation.model.imageId = imageId;
        delete conversation.model.image;
        migrated = true;
        console.log('[Character] 迁移 Banana 模型图片:', imageId);
    }

    if (migrated) {
        saveSettingsDebounced();
    }

    document.getElementById('banana_char_triggers').value = preset.triggers || '';
    document.getElementById('banana_char_user_text').value = conversation.user?.text || '';
    document.getElementById('banana_char_model_text').value = conversation.model?.text || '';

    // 异步加载图片
    let userImage = '';
    let modelImage = '';

    if (conversation.user?.imageId && conversation.user.imageId.startsWith('cfgimg_')) {
        userImage = await getConfigImage(conversation.user.imageId) || '';
    }
    if (conversation.model?.imageId && conversation.model.imageId.startsWith('cfgimg_')) {
        modelImage = await getConfigImage(conversation.model.imageId) || '';
    }

    updateBananaImageUI('user', userImage);
    updateBananaImageUI('model', modelImage);

    saveSettingsDebounced();
}

function updateBananaCharacterPreset() {
    const settings = extension_settings[extensionName];
    const presetId = settings.bananaCharacterPresetId;

    if (!presetId || !settings.bananaCharacterPresets[presetId]) {
        alert('没有活动的 Banana 角色预设可保存。请先"另存为"一个新预设。');
        return;
    }

    stylishConfirm(`确定要覆盖当前 Banana 角色预设 "${presetId}" 吗？`).then(confirmed => {
        if (confirmed) {
            saveCurrentBananaCharacterData(presetId);
            alert(`Banana 角色预设 "${presetId}" 已更新。`);
        }
    });
}

function saveBananaCharacterPresetAs() {
    stylInput("请输入新 Banana 角色预设的名称").then((result) => {
        if (result && result.trim() !== '') {
            const settings = extension_settings[extensionName];
            saveCurrentBananaCharacterData(result);
            settings.bananaCharacterPresetId = result;
            loadBananaCharacterPresetList();
            alert(`Banana 角色预设 "${result}" 已保存。`);
        }
    });
}

function createNewBananaCharacterPreset() {
    stylInput("请输入新 Banana 角色预设的名称").then((result) => {
        if (result && result.trim() !== '') {
            const settings = extension_settings[extensionName];

            if (settings.bananaCharacterPresets[result]) {
                alert(`Banana 角色预设 "${result}" 已存在，请使用其他名称。`);
                return;
            }

            settings.bananaCharacterPresets[result] = {
                triggers: "",
                conversation: {
                    user: { text: '', imageId: '' },
                    model: { text: '', imageId: '' }
                }
            };
            settings.bananaCharacterPresetId = result;
            saveSettingsDebounced();

            loadBananaCharacterPresetList();
            loadBananaCharacterPreset();

            toastr.success(`空白 Banana 角色预设 "${result}" 已创建。`);
        }
    });
}

function renameBananaCharacterPreset() {
    const settings = extension_settings[extensionName];
    const currentName = settings.bananaCharacterPresetId;
    if (!currentName || !settings.bananaCharacterPresets[currentName]) {
        alert("没有活动的 Banana 角色预设可重命名。");
        return;
    }
    if (currentName === "默认") {
        alert("默认预设不能重命名。");
        return;
    }
    
    stylInput("请输入新的 Banana 角色预设名称", currentName).then((newName) => {
        if (newName && newName.trim() !== '' && newName !== currentName) {
            if (settings.bananaCharacterPresets[newName]) {
                alert("该名称已存在，请换一个名称。");
                return;
            }
            
            settings.bananaCharacterPresets[newName] = settings.bananaCharacterPresets[currentName];
            delete settings.bananaCharacterPresets[currentName];
            
            settings.bananaCharacterPresetId = newName;
            
            saveSettingsDebounced();
            loadBananaCharacterPresetList();
            
            try {
                if (typeof window.loadSilterTavernChatu8Settings === 'function') {
                    window.loadSilterTavernChatu8Settings();
                }
            } catch (error) {
                console.warn('Failed to refresh UI after renaming preset:', error);
            }
            toastr.success(`Banana 角色预设已重命名为 "${newName}"`);
        }
    });
}

async function saveCurrentBananaCharacterData(presetId) {
    const settings = extension_settings[extensionName];
    const existingPreset = settings.bananaCharacterPresets[presetId];

    const userImgSrc = document.getElementById('banana_char_user_image').src;
    const modelImgSrc = document.getElementById('banana_char_model_image').src;

    // 获取现有的 imageId
    const existingUserImageId = existingPreset?.conversation?.user?.imageId || '';
    const existingModelImageId = existingPreset?.conversation?.model?.imageId || '';

    // 保存图片到数据库
    let userImageId = '';
    let modelImageId = '';

    if (userImgSrc.startsWith('data:image')) {
        // 删除旧图片
        if (existingUserImageId && existingUserImageId.startsWith('cfgimg_')) {
            await deleteConfigImage(existingUserImageId).catch(err => console.warn('[Character] 删除旧用户图片失败:', err));
        }
        userImageId = await saveConfigImage(userImgSrc);
        console.log('[Character] Banana 用户图片已保存:', userImageId);
    }

    if (modelImgSrc.startsWith('data:image')) {
        // 删除旧图片
        if (existingModelImageId && existingModelImageId.startsWith('cfgimg_')) {
            await deleteConfigImage(existingModelImageId).catch(err => console.warn('[Character] 删除旧模型图片失败:', err));
        }
        modelImageId = await saveConfigImage(modelImgSrc);
        console.log('[Character] Banana 模型图片已保存:', modelImageId);
    }

    const preset = {
        triggers: document.getElementById('banana_char_triggers').value,
        conversation: {
            user: {
                text: document.getElementById('banana_char_user_text').value,
                imageId: userImageId
            },
            model: {
                text: document.getElementById('banana_char_model_text').value,
                imageId: modelImageId
            }
        }
    };

    settings.bananaCharacterPresets[presetId] = preset;
    saveSettingsDebounced();
}

async function deleteBananaCharacterPreset() {
    const settings = extension_settings[extensionName];
    const presetId = document.getElementById('banana_char_preset_id')?.value;

    if (Object.keys(settings.bananaCharacterPresets).length <= 1) {
        alert("不能删除最后一个预设。");
        return;
    }

    const confirmed = await stylishConfirm(`是否确定删除该 Banana 角色预设 "${presetId}"`);
    if (confirmed) {
        // 删除预设中的图片
        const preset = settings.bananaCharacterPresets[presetId];
        if (preset?.conversation?.user?.imageId && preset.conversation.user.imageId.startsWith('cfgimg_')) {
            await deleteConfigImage(preset.conversation.user.imageId).catch(err => console.warn('[Character] 删除用户图片失败:', err));
        }
        if (preset?.conversation?.model?.imageId && preset.conversation.model.imageId.startsWith('cfgimg_')) {
            await deleteConfigImage(preset.conversation.model.imageId).catch(err => console.warn('[Character] 删除模型图片失败:', err));
        }

        delete settings.bananaCharacterPresets[presetId];
        settings.bananaCharacterPresetId = Object.keys(settings.bananaCharacterPresets)[0];
        loadBananaCharacterPresetList();
        await loadBananaCharacterPreset();
        saveSettingsDebounced();
    }
}

const setupBananaImageUpload = (role) => {
    const container = document.getElementById(`banana_char_${role}_image_container`);
    const img = document.getElementById(`banana_char_${role}_image`);
    const placeholder = container.querySelector('.st-chatu8-image-placeholder');
    const removeBtn = document.getElementById(`banana_char_${role}_image_remove`);
    const input = document.getElementById(`banana_char_${role}_image_input`);

    if (!container || !img || !placeholder || !removeBtn || !input) return;

    container.addEventListener('click', (event) => {
        if (event.target !== removeBtn && !removeBtn.contains(event.target)) {
            input.click();
        }
    });

    input.addEventListener('change', () => {
        if (input.files && input.files[0]) {
            const reader = new FileReader();
            reader.onload = (e) => {
                img.src = e.target.result;
                img.style.display = 'block';
                placeholder.style.display = 'none';
                removeBtn.style.display = 'block';
            };
            reader.readAsDataURL(input.files[0]);
        }
    });

    removeBtn.addEventListener('click', () => {
        img.src = '';
        img.style.display = 'none';
        placeholder.style.display = 'block';
        removeBtn.style.display = 'none';
        input.value = '';
    });
};

const updateBananaImageUI = (role, imageData) => {
    const img = document.getElementById(`banana_char_${role}_image`);
    const container = document.getElementById(`banana_char_${role}_image_container`);
    if (!img || !container) return;

    const placeholder = container.querySelector('.st-chatu8-image-placeholder');
    const removeBtn = document.getElementById(`banana_char_${role}_image_remove`);

    if (imageData) {
        img.src = imageData;
        img.style.display = 'block';
        placeholder.style.display = 'none';
        removeBtn.style.display = 'block';
    } else {
        img.src = '';
        img.style.display = 'none';
        placeholder.style.display = 'block';
        removeBtn.style.display = 'none';
    }
};
