// @ts-nocheck
// utils/settings/bananaui.js
import { saveSettingsDebounced } from "../../../../../../script.js";
import { extension_settings } from "../../../../../extensions.js";
import { extensionName } from '../config.js';
import { stylishConfirm, stylInput } from '../ui_common.js';
import { saveConfigImage, getConfigImage, deleteConfigImage } from '../configDatabase.js';
import { getRequestHeaders } from '../utils.js';

/**
 * 检查是否为图片 ID（新格式）
 */
const isImageId = (value) => value && typeof value === 'string' && value.startsWith('cfgimg_');

/**
 * 检查是否为 Base64 图片（旧格式）
 */
const isBase64Image = (value) => value && typeof value === 'string' && value.startsWith('data:image');

/**
 * 获取图片数据（兼容新旧格式）
 * @param {Object} turn - 对话轮次对象
 * @param {string} role - 'user' 或 'model'
 * @returns {Promise<string>} Base64 图片数据或空字符串
 */
async function getImageData(turn, role) {
    const data = turn?.[role];
    if (!data) return '';

    // 新格式：使用 imageId
    if (data.imageId && isImageId(data.imageId)) {
        const imageData = await getConfigImage(data.imageId);
        return imageData || '';
    }

    // 旧格式：直接存储 image
    if (data.image && isBase64Image(data.image)) {
        return data.image;
    }

    return '';
}

/**
 * 保存图片并返回 ID（如果是新图片）或返回现有 ID
 * @param {string} imgSrc - 图片 src（可能是 Base64 或空）
 * @param {string} existingId - 现有的图片 ID（如果有）
 * @returns {Promise<string>} 图片 ID 或空字符串
 */
async function saveImageAndGetId(imgSrc, existingId = '') {
    // 如果是有效的 Base64 图片
    if (isBase64Image(imgSrc)) {
        // 删除旧图片（如果存在）
        if (existingId && isImageId(existingId)) {
            await deleteConfigImage(existingId).catch(err => console.warn('[BananaUI] 删除旧图片失败:', err));
        }
        // 保存新图片
        const newId = await saveConfigImage(imgSrc);
        console.log('[BananaUI] 图片已保存到数据库:', newId);
        return newId;
    }
    return '';
}

/**
 * 删除预设中所有图片
 * @param {Object} preset - 预设对象
 */
async function deletePresetImages(preset) {
    if (!preset?.conversation) return;

    for (const turn of preset.conversation) {
        if (turn?.user?.imageId && isImageId(turn.user.imageId)) {
            await deleteConfigImage(turn.user.imageId).catch(err => console.warn('[BananaUI] 删除图片失败:', err));
        }
        if (turn?.model?.imageId && isImageId(turn.model.imageId)) {
            await deleteConfigImage(turn.model.imageId).catch(err => console.warn('[BananaUI] 删除图片失败:', err));
        }
    }
}

/**
 * 迁移旧格式预设到新格式（使用数据库存储图片）
 * @param {Object} preset - 预设对象
 * @returns {Promise<boolean>} 是否执行了迁移
 */
async function migratePresetIfNeeded(preset) {
    if (!preset?.conversation) return false;

    let migrated = false;

    for (const turn of preset.conversation) {
        // 迁移用户图片
        if (turn?.user?.image && isBase64Image(turn.user.image)) {
            const imageId = await saveConfigImage(turn.user.image);
            turn.user.imageId = imageId;
            delete turn.user.image;
            migrated = true;
            console.log('[BananaUI] 迁移用户图片:', imageId);
        }

        // 迁移模型图片
        if (turn?.model?.image && isBase64Image(turn.model.image)) {
            const imageId = await saveConfigImage(turn.model.image);
            turn.model.imageId = imageId;
            delete turn.model.image;
            migrated = true;
            console.log('[BananaUI] 迁移模型图片:', imageId);
        }
    }

    return migrated;
}

// Helper function to manage a single image upload component
const setupImageUpload = (role, index) => {
    const i = index + 1;
    const container = document.getElementById(`st-chatu8-banana-${role}-image-container-${i}`);
    const img = document.getElementById(`st-chatu8-banana-${role}-image-${i}`);
    const placeholder = container.querySelector('.st-chatu8-image-placeholder');
    const removeBtn = document.getElementById(`st-chatu8-banana-${role}-image-remove-${i}`);
    const input = document.getElementById(`st-chatu8-banana-${role}-image-input-${i}`);

    if (!container || !img || !placeholder || !removeBtn || !input) return;

    // Click container (but not the remove button) to trigger file input
    container.addEventListener('click', (event) => {
        if (event.target !== removeBtn && !removeBtn.contains(event.target)) {
            input.click();
        }
    });

    // Handle file selection
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

    // Handle image removal
    removeBtn.addEventListener('click', () => {
        img.src = '';
        img.style.display = 'none';
        placeholder.style.display = 'block';
        removeBtn.style.display = 'none';
        input.value = ''; // Reset file input
    });
};

// Helper to update UI based on image data
const updateImageUI = (role, index, imageData) => {
    const i = index + 1;
    const img = document.getElementById(`st-chatu8-banana-${role}-image-${i}`);
    const container = document.getElementById(`st-chatu8-banana-${role}-image-container-${i}`);
    if (!img || !container) return;

    const placeholder = container.querySelector('.st-chatu8-image-placeholder');
    const removeBtn = document.getElementById(`st-chatu8-banana-${role}-image-remove-${i}`);

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


// 初始化函数
export function initBananaUI(settingsModal) {
    const getBananaSettings = () => extension_settings[extensionName].banana;

    // --- DOM 元素 ---
    const presetSelect = document.getElementById('st-chatu8-banana-conversation-preset-id');
    const saveButton = document.getElementById('st-chatu8-banana-conversation-save');
    const saveAsButton = document.getElementById('st-chatu8-banana-conversation-save-as');
    const newButton = document.getElementById('st-chatu8-banana-conversation-new');
    const renameButton = document.getElementById('st-chatu8-banana-conversation-rename');
    const deleteButton = document.getElementById('st-chatu8-banana-conversation-delete');
    const importButton = document.getElementById('st-chatu8-banana-conversation-import');
    const exportButton = document.getElementById('st-chatu8-banana-conversation-export');
    const fixedPromptInput = document.getElementById('st-chatu8-banana-fixed-prompt');
    const postfixPromptInput = document.getElementById('st-chatu8-banana-postfix-prompt');
    const modelSelect = document.getElementById('st-chatu8-banana-model-select');
    const editModelSelect = document.getElementById('st-chatu8-banana-edit-model-select');
    const multimodalSection = document.getElementById('st-chatu8-banana-multimodal-section');
    const apiUrlInput = document.getElementById('st-chatu8-banana-api-url');
    const apiKeyInput = document.getElementById('st-chatu8-banana-api-key');
    const aspectRatioSelect = document.getElementById('st-chatu8-banana-aspect-ratio');
    const useGrokFormatCheckbox = document.getElementById('st-chatu8-banana-use-grok-format');
    const editPresetSelect = document.getElementById('st-chatu8-banana-edit-preset');
    const videoModelSelect = document.getElementById('st-chatu8-banana-video-model-select');
    const videoPresetSelect = document.getElementById('st-chatu8-banana-video-preset');

    // --- 逻辑函数 ---

    // 填充修图预设下拉框
    const populateEditPresetDropdown = () => {
        const bananaSettings = getBananaSettings();
        const presets = bananaSettings.conversationPresets || {};
        const presetNames = Object.keys(presets);
        const currentEditPresetId = bananaSettings.editPresetId || '默认';

        if (!editPresetSelect) return;

        editPresetSelect.innerHTML = '';
        presetNames.forEach(name => {
            const option = document.createElement('option');
            option.value = name;
            option.textContent = name;
            if (name === currentEditPresetId) {
                option.selected = true;
            }
            editPresetSelect.appendChild(option);
        });
    };

    // 填充视频预设下拉框
    const populateVideoPresetDropdown = () => {
        const bananaSettings = getBananaSettings();
        const presets = bananaSettings.conversationPresets || {};
        const presetNames = Object.keys(presets);
        const currentVideoPresetId = bananaSettings.videoPresetId || '默认';

        if (!videoPresetSelect) return;

        videoPresetSelect.innerHTML = '';
        presetNames.forEach(name => {
            const option = document.createElement('option');
            option.value = name;
            option.textContent = name;
            if (name === currentVideoPresetId) {
                option.selected = true;
            }
            videoPresetSelect.appendChild(option);
        });
    };

    const populateDropdown = () => {
        const bananaSettings = getBananaSettings();
        const presets = bananaSettings.conversationPresets || {};
        const presetNames = Object.keys(presets);
        const currentPresetId = bananaSettings.conversationPresetId;

        presetSelect.innerHTML = '';
        presetNames.forEach(name => {
            const option = document.createElement('option');
            option.value = name;
            option.textContent = name;
            if (name === currentPresetId) {
                option.selected = true;
            }
            presetSelect.appendChild(option);
        });
    };

    const loadPreset = async (presetId) => {
        const bananaSettings = getBananaSettings();
        const preset = bananaSettings.conversationPresets[presetId];
        if (!preset) return;

        // 检查并执行迁移
        const migrated = await migratePresetIfNeeded(preset);
        if (migrated) {
            saveSettingsDebounced();
            console.log('[BananaUI] 预设已迁移到新格式');
        }

        fixedPromptInput.value = preset.fixedPrompt || '';
        postfixPromptInput.value = preset.postfixPrompt || '';

        for (let i = 0; i < 3; i++) {
            const userTextEl = document.getElementById(`st-chatu8-banana-user-text-${i + 1}`);
            const modelTextEl = document.getElementById(`st-chatu8-banana-model-text-${i + 1}`);
            const turn = preset.conversation?.[i] || { user: { text: '' }, model: { text: '' } };

            if (userTextEl) userTextEl.value = turn.user?.text || '';
            if (modelTextEl) modelTextEl.value = turn.model?.text || '';

            // 异步加载图片
            const userImage = await getImageData(turn, 'user');
            const modelImage = await getImageData(turn, 'model');

            updateImageUI('user', i, userImage);
            updateImageUI('model', i, modelImage);
        }
        bananaSettings.conversationPresetId = presetId;
    };

    const updateVisibility = () => {
        if (modelSelect && multimodalSection) {
            const selectedModel = modelSelect.value;
            const isImagen = selectedModel.startsWith('imagen');
            // 除 imagen 外都显示多模态设置
            multimodalSection.style.display = 'block';

            const titleElement = multimodalSection.querySelector('h3');
            const conversationGroups = multimodalSection.querySelectorAll('.st-chatu8-banana-conversation-group');
            const presetLabel = document.querySelector('label[for="st-chatu8-banana-conversation-preset-id"]');

            if (isImagen) {
                // Imagen 模型只显示提示词预设，隐藏多轮对话
                if (titleElement) titleElement.textContent = '提示词预设 (Imagen)';
                if (presetLabel) presetLabel.textContent = '提示词预设';
                conversationGroups.forEach(group => group.style.display = 'none');
            } else {
                // 其他模型为多模态，显示多轮对话
                if (titleElement) titleElement.textContent = '多轮对话 (多模态)';
                if (presetLabel) presetLabel.textContent = '对话预设';
                conversationGroups.forEach(group => group.style.display = 'block');
            }
        }
    };

    // --- 事件监听器 ---

    presetSelect.addEventListener('change', async () => {
        await loadPreset(presetSelect.value);
        toastr.success(`已加载预设: "${presetSelect.value}"`);
    });

    saveButton.addEventListener('click', async () => {
        const bananaSettings = getBananaSettings();
        const presetId = bananaSettings.conversationPresetId;
        const existingPreset = bananaSettings.conversationPresets[presetId];
        const conversation = [];

        for (let i = 0; i < 3; i++) {
            const userImgSrc = document.getElementById(`st-chatu8-banana-user-image-${i + 1}`).src;
            const modelImgSrc = document.getElementById(`st-chatu8-banana-model-image-${i + 1}`).src;

            // 获取现有的 imageId
            const existingTurn = existingPreset?.conversation?.[i];
            const existingUserImageId = existingTurn?.user?.imageId || '';
            const existingModelImageId = existingTurn?.model?.imageId || '';

            // 保存图片到数据库
            const userImageId = await saveImageAndGetId(userImgSrc, existingUserImageId);
            const modelImageId = await saveImageAndGetId(modelImgSrc, existingModelImageId);

            conversation.push({
                user: {
                    text: document.getElementById(`st-chatu8-banana-user-text-${i + 1}`).value,
                    imageId: userImageId
                },
                model: {
                    text: document.getElementById(`st-chatu8-banana-model-text-${i + 1}`).value,
                    imageId: modelImageId
                }
            });
        }

        bananaSettings.conversationPresets[presetId] = {
            fixedPrompt: fixedPromptInput.value,
            postfixPrompt: postfixPromptInput.value,
            conversation: conversation
        };
        saveSettingsDebounced();
        toastr.success(`预设 "${presetId}" 已保存!`);
    });

    saveAsButton.addEventListener('click', async () => {
        const newPresetName = await stylInput("请输入新的预设名称:");
        if (!newPresetName || newPresetName.trim() === '') {
            toastr.info("操作已取消。");
            return;
        }

        const bananaSettings = getBananaSettings();
        if (bananaSettings.conversationPresets[newPresetName]) {
            const overwrite = await stylishConfirm(`预设 "${newPresetName}" 已存在。要覆盖它吗?`);
            if (!overwrite) {
                toastr.info("操作已取消。");
                return;
            }
            // 删除被覆盖预设的图片
            await deletePresetImages(bananaSettings.conversationPresets[newPresetName]);
        }

        const conversation = [];
        for (let i = 0; i < 3; i++) {
            const userImgSrc = document.getElementById(`st-chatu8-banana-user-image-${i + 1}`).src;
            const modelImgSrc = document.getElementById(`st-chatu8-banana-model-image-${i + 1}`).src;

            // 保存图片到数据库（另存为时总是创建新的图片记录）
            const userImageId = await saveImageAndGetId(userImgSrc);
            const modelImageId = await saveImageAndGetId(modelImgSrc);

            conversation.push({
                user: {
                    text: document.getElementById(`st-chatu8-banana-user-text-${i + 1}`).value,
                    imageId: userImageId
                },
                model: {
                    text: document.getElementById(`st-chatu8-banana-model-text-${i + 1}`).value,
                    imageId: modelImageId
                }
            });
        }

        bananaSettings.conversationPresets[newPresetName] = {
            fixedPrompt: fixedPromptInput.value,
            postfixPrompt: postfixPromptInput.value,
            conversation: conversation
        };
        bananaSettings.conversationPresetId = newPresetName;

        populateDropdown();
        populateEditPresetDropdown();
        populateVideoPresetDropdown();
        saveSettingsDebounced();
        toastr.success(`新预设 "${newPresetName}" 已创建并加载!`);
    });

    newButton.addEventListener('click', async () => {
        const newPresetName = await stylInput("请输入新的预设名称:");
        if (!newPresetName || newPresetName.trim() === '') return;

        const bananaSettings = getBananaSettings();
        if (bananaSettings.conversationPresets[newPresetName]) {
            toastr.error(`预设 "${newPresetName}" 已存在。`);
            return;
        }

        bananaSettings.conversationPresets[newPresetName] = {
            fixedPrompt: '',
            postfixPrompt: '',
            conversation: []
        };
        bananaSettings.conversationPresetId = newPresetName;

        populateDropdown();
        populateEditPresetDropdown();
        populateVideoPresetDropdown();
        await loadPreset(newPresetName);
        saveSettingsDebounced();
        toastr.success(`空预设 "${newPresetName}" 已创建!`);
    });

    renameButton.addEventListener('click', async () => {
        const bananaSettings = getBananaSettings();
        const currentName = bananaSettings.conversationPresetId;
        if (!currentName || !bananaSettings.conversationPresets[currentName]) {
            toastr.warning('没有活动的预设可重命名。');
            return;
        }
        if (currentName === "默认" || currentName === "default") {
            toastr.warning("默认预设不能重命名。");
            return;
        }
        
        const result = await stylInput("请输入新的预设名称:", currentName);
        if (!result || !result.trim() || result.trim() === currentName) return;

        const newName = result.trim();
        if (bananaSettings.conversationPresets[newName]) {
            toastr.error(`预设 "${newName}" 已存在，请换一个名称。`);
            return;
        }
        
        bananaSettings.conversationPresets[newName] = bananaSettings.conversationPresets[currentName];
        delete bananaSettings.conversationPresets[currentName];
        
        bananaSettings.conversationPresetId = newName;
        
        populateDropdown();
        populateEditPresetDropdown();
        populateVideoPresetDropdown();
        saveSettingsDebounced();
        toastr.success(`预设已重命名为 "${newName}"`);
    });

    deleteButton.addEventListener('click', async () => {
        const bananaSettings = getBananaSettings();
        const presetId = bananaSettings.conversationPresetId;

        if (Object.keys(bananaSettings.conversationPresets).length <= 1) {
            toastr.warning("不能删除最后一个预设。");
            return;
        }

        const confirmDelete = await stylishConfirm(`确定要删除预设 "${presetId}" 吗? 此操作不可撤销。`);
        if (!confirmDelete) {
            toastr.info("操作已取消。");
            return;
        }

        // 删除预设中的所有图片
        await deletePresetImages(bananaSettings.conversationPresets[presetId]);

        delete bananaSettings.conversationPresets[presetId];
        const newPresetId = Object.keys(bananaSettings.conversationPresets)[0];
        bananaSettings.conversationPresetId = newPresetId;

        populateDropdown();
        populateEditPresetDropdown();
        populateVideoPresetDropdown();
        await loadPreset(newPresetId);
        saveSettingsDebounced();
        toastr.success(`预设 "${presetId}" 已删除。`);
    });

    exportButton.addEventListener('click', async () => {
        const bananaSettings = getBananaSettings();
        const presetId = bananaSettings.conversationPresetId;
        if (!presetId) {
            toastr.warning("没有选中的预设可供导出。");
            return;
        }
        const preset = bananaSettings.conversationPresets[presetId];
        if (!preset) {
            toastr.error(`找不到预设 "${presetId}" 的数据。`);
            return;
        }

        // 导出时将 imageId 转换回 Base64
        const exportData = {
            fixedPrompt: preset.fixedPrompt,
            postfixPrompt: preset.postfixPrompt,
            conversation: []
        };

        for (const turn of preset.conversation || []) {
            const userImage = await getImageData(turn, 'user');
            const modelImage = await getImageData(turn, 'model');

            exportData.conversation.push({
                user: {
                    text: turn?.user?.text || '',
                    image: userImage
                },
                model: {
                    text: turn?.model?.text || '',
                    image: modelImage
                }
            });
        }

        const dataStr = JSON.stringify(exportData, null, 2);
        const blob = new Blob([dataStr], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${presetId}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        toastr.success(`预设 "${presetId}" 已导出。`);
    });

    importButton.addEventListener('click', () => {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = 'application/json,.json';
        input.onchange = async (event) => {
            const file = event.target.files[0];
            if (!file) return;

            const reader = new FileReader();
            reader.onload = async (e) => {
                try {
                    const presetData = JSON.parse(e.target.result);

                    if (typeof presetData.fixedPrompt === 'undefined' || typeof presetData.conversation === 'undefined') {
                        toastr.error("导入失败：文件格式不正确。");
                        return;
                    }

                    let presetName = file.name.replace(/\.json$/, '');
                    const bananaSettings = getBananaSettings();

                    if (bananaSettings.conversationPresets[presetName]) {
                        const overwrite = await stylishConfirm(`预设 "${presetName}" 已存在。要覆盖它吗?`);
                        if (!overwrite) {
                            presetName = await stylInput("请输入新的预设名称:", presetName + "_imported");
                            if (!presetName || presetName.trim() === '') {
                                toastr.info("操作已取消。");
                                return;
                            }
                        } else {
                            // 删除被覆盖预设的图片
                            await deletePresetImages(bananaSettings.conversationPresets[presetName]);
                        }
                    }

                    // 导入时将 Base64 图片存入数据库
                    const importedPreset = {
                        fixedPrompt: presetData.fixedPrompt,
                        postfixPrompt: presetData.postfixPrompt,
                        conversation: []
                    };

                    for (const turn of presetData.conversation || []) {
                        const userImageId = await saveImageAndGetId(turn?.user?.image || '');
                        const modelImageId = await saveImageAndGetId(turn?.model?.image || '');

                        importedPreset.conversation.push({
                            user: {
                                text: turn?.user?.text || '',
                                imageId: userImageId
                            },
                            model: {
                                text: turn?.model?.text || '',
                                imageId: modelImageId
                            }
                        });
                    }

                    bananaSettings.conversationPresets[presetName] = importedPreset;
                    bananaSettings.conversationPresetId = presetName;

                    populateDropdown();
                    populateEditPresetDropdown();
                    populateVideoPresetDropdown();
                    await loadPreset(presetName);
                    saveSettingsDebounced();
                    toastr.success(`预设 "${presetName}" 已成功导入并加载！`);

                } catch (error) {
                    toastr.error(`导入失败: ${error.message}`);
                    console.error("Error importing preset:", error);
                }
            };
            reader.readAsText(file);
        };
        input.click();
    });

    // --- 初始化 ---

    // 绑定非预设的简单输入
    apiUrlInput.addEventListener('input', () => { getBananaSettings().apiUrl = apiUrlInput.value; saveSettingsDebounced(); });
    apiKeyInput.addEventListener('input', () => { getBananaSettings().apiKey = apiKeyInput.value; saveSettingsDebounced(); });
    const apiKeyToggle = document.getElementById('st-chatu8-banana-api-key-toggle');
    if (apiKeyToggle) {
        apiKeyToggle.addEventListener('click', () => {
            const icon = apiKeyToggle.querySelector('i');
            if (apiKeyInput.type === 'password') {
                apiKeyInput.type = 'text';
                icon.classList.replace('fa-eye', 'fa-eye-slash');
            } else {
                apiKeyInput.type = 'password';
                icon.classList.replace('fa-eye-slash', 'fa-eye');
            }
        });
    }
    modelSelect.addEventListener('change', () => { getBananaSettings().model = modelSelect.value; saveSettingsDebounced(); updateVisibility(); });
    if (editModelSelect) {
        editModelSelect.addEventListener('change', () => { getBananaSettings().editModel = editModelSelect.value; saveSettingsDebounced(); });
    }
    if (videoModelSelect) {
        videoModelSelect.addEventListener('change', () => { getBananaSettings().videoModel = videoModelSelect.value; saveSettingsDebounced(); });
    }
    aspectRatioSelect.addEventListener('change', () => { getBananaSettings().aspectRatio = aspectRatioSelect.value; saveSettingsDebounced(); });

    // Grok 原生格式开关
    if (useGrokFormatCheckbox) {
        useGrokFormatCheckbox.addEventListener('change', () => {
            getBananaSettings().useGrokFormat = useGrokFormatCheckbox.checked ? "true" : "false";
            saveSettingsDebounced();
        });
    }

    // 修图预设选择事件监听
    if (editPresetSelect) {
        editPresetSelect.addEventListener('change', () => {
            getBananaSettings().editPresetId = editPresetSelect.value;
            saveSettingsDebounced();
            toastr.success(`修图预设已设置为: "${editPresetSelect.value}"`);
        });
    }

    // 视频预设选择事件监听
    if (videoPresetSelect) {
        videoPresetSelect.addEventListener('change', () => {
            getBananaSettings().videoPresetId = videoPresetSelect.value;
            saveSettingsDebounced();
            toastr.success(`视频预设已设置为: "${videoPresetSelect.value}"`);
        });
    }

    // 获取模型按钮
    const fetchModelsButton = document.getElementById('st-chatu8-banana-fetch-models');
    if (fetchModelsButton) {
        fetchModelsButton.addEventListener('click', async () => {
            const bananaSettings = getBananaSettings();
            const apiUrl = bananaSettings.apiUrl;
            const apiKey = bananaSettings.apiKey;

            if (!apiUrl) {
                toastr.warning('请先填写 API 连接地址');
                return;
            }

            try {
                fetchModelsButton.disabled = true;
                fetchModelsButton.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i>';

                // 正确拼接 URL：在用户输入的 URL 基础上追加 /models
                let baseUrl = apiUrl.replace(/\/$/, '');
                let directModelsUrl = baseUrl + '/models';

                // 根据客户端类型选择请求方式
                const client = extension_settings[extensionName].client;
                let response;

                if (client === 'jiuguan') {
                    // 使用 SillyTavern 后端代理，与 llmUi.js 保持一致
                    // 酒馆代理需要的 custom_url 格式：会自动追加 /models
                    let proxyBaseUrl = baseUrl;

                    response = await fetch('/api/backends/chat-completions/status', {
                        method: 'POST',
                        headers: getRequestHeaders(window.token),
                        body: JSON.stringify({
                            chat_completion_source: 'custom',
                            custom_url: proxyBaseUrl,
                            custom_include_headers: `Authorization: "Bearer ${apiKey || ''}"`
                        })
                    });
                    console.log('[BananaUI] 使用酒馆代理获取模型列表, URL:', proxyBaseUrl);
                } else {
                    // 直接请求
                    response = await fetch(directModelsUrl, {
                        method: 'GET',
                        headers: {
                            'Authorization': `Bearer ${apiKey || ''}`
                        }
                    });
                    console.log('[BananaUI] 直接请求获取模型列表');
                }

                if (!response.ok) {
                    throw new Error(`获取模型失败: ${response.status}`);
                }

                const result = await response.json();
                console.log('[BananaUI] 获取到的模型响应:', result);

                // 兼容不同 API 返回格式
                let models = [];
                if (Array.isArray(result.data)) {
                    models = result.data;
                } else if (Array.isArray(result.models)) {
                    models = result.models;
                } else if (Array.isArray(result)) {
                    models = result;
                }

                // 提取模型 ID（兼容不同对象格式）
                models = models.map(model => {
                    if (typeof model === 'string') {
                        return { id: model };
                    }
                    return { id: model.id || model.name || model.model || String(model) };
                }).filter(m => m.id);

                console.log('[BananaUI] 解析后的模型列表:', models);

                if (models.length === 0) {
                    toastr.info('没有获取到可用模型');
                    return;
                }

                // 保存当前选中的模型
                const currentModel = modelSelect.value;
                const currentEditModel = editModelSelect ? editModelSelect.value : '';
                const currentVideoModel = videoModelSelect ? videoModelSelect.value : '';

                // 按字母顺序排序
                models.sort((a, b) => a.id.localeCompare(b.id));

                // 清空并重新填充图像模型下拉框
                modelSelect.innerHTML = '';
                models.forEach(model => {
                    const option = document.createElement('option');
                    option.value = model.id;
                    option.textContent = model.id;
                    modelSelect.appendChild(option);
                });

                // 同时填充修图模型下拉框
                if (editModelSelect) {
                    editModelSelect.innerHTML = '';
                    models.forEach(model => {
                        const option = document.createElement('option');
                        option.value = model.id;
                        option.textContent = model.id;
                        editModelSelect.appendChild(option);
                    });
                }

                // 同时填充视频模型下拉框
                if (videoModelSelect) {
                    videoModelSelect.innerHTML = '';
                    models.forEach(model => {
                        const option = document.createElement('option');
                        option.value = model.id;
                        option.textContent = model.id;
                        videoModelSelect.appendChild(option);
                    });
                }

                // 尝试恢复之前选中的图像模型，否则选第一个
                if (models.some(m => m.id === currentModel)) {
                    modelSelect.value = currentModel;
                } else {
                    modelSelect.value = models[0].id;
                    getBananaSettings().model = models[0].id;
                    saveSettingsDebounced();
                }

                // 尝试恢复之前选中的修图模型，否则默认跟随文生图模型
                if (editModelSelect) {
                    if (models.some(m => m.id === currentEditModel)) {
                        editModelSelect.value = currentEditModel;
                    } else {
                        editModelSelect.value = models[0].id;
                        getBananaSettings().editModel = models[0].id;
                        saveSettingsDebounced();
                    }
                }

                // 尝试恢复之前选中的视频模型，否则选第一个
                if (videoModelSelect) {
                    if (models.some(m => m.id === currentVideoModel)) {
                        videoModelSelect.value = currentVideoModel;
                    } else {
                        videoModelSelect.value = models[0].id;
                        getBananaSettings().videoModel = models[0].id;
                        saveSettingsDebounced();
                    }
                }

                toastr.success(`成功获取 ${models.length} 个模型`);
                updateVisibility();

            } catch (error) {
                console.error('[BananaUI] 获取模型失败:', error);
                toastr.error(`获取模型失败: ${error.message}`);
            } finally {
                fetchModelsButton.disabled = false;
                fetchModelsButton.innerHTML = '<i class="fa-solid fa-rotate"></i>';
            }
        });
    }

    // Setup all image upload components
    for (let i = 0; i < 3; i++) {
        setupImageUpload('user', i);
        setupImageUpload('model', i);
    }

    // 加载初始状态
    const bananaSettings = getBananaSettings();
    apiUrlInput.value = bananaSettings.apiUrl || '';
    apiKeyInput.value = bananaSettings.apiKey || '';

    // 如果保存的模型不在预定义选项中，动态添加它（不再内置默认模型，未配置时下拉框留空，引导用户点"获取模型列表"）
    const savedModel = bananaSettings.model || '';
    if (savedModel) {
        const existingOption = Array.from(modelSelect.options).find(opt => opt.value === savedModel);
        if (!existingOption) {
            const newOption = document.createElement('option');
            newOption.value = savedModel;
            newOption.textContent = savedModel;
            modelSelect.appendChild(newOption);
        }
        modelSelect.value = savedModel;
    }

    // 修图模型下拉框初始化
    const savedEditModel = bananaSettings.editModel || '';
    if (editModelSelect && savedEditModel) {
        const existingEditOption = Array.from(editModelSelect.options).find(opt => opt.value === savedEditModel);
        if (!existingEditOption) {
            const newEditOption = document.createElement('option');
            newEditOption.value = savedEditModel;
            newEditOption.textContent = savedEditModel;
            editModelSelect.appendChild(newEditOption);
        }
        editModelSelect.value = savedEditModel;
    }

    aspectRatioSelect.value = bananaSettings.aspectRatio || '1:1';

    if (useGrokFormatCheckbox) {
        useGrokFormatCheckbox.checked = String(bananaSettings.useGrokFormat) === 'true';
    }

    // 如果保存的视频模型不在预定义选项中，动态添加它（不再内置默认模型）
    const savedVideoModel = bananaSettings.videoModel || '';
    if (videoModelSelect && savedVideoModel) {
        const existingVideoOption = Array.from(videoModelSelect.options).find(opt => opt.value === savedVideoModel);
        if (!existingVideoOption) {
            const newVideoOption = document.createElement('option');
            newVideoOption.value = savedVideoModel;
            newVideoOption.textContent = savedVideoModel;
            videoModelSelect.appendChild(newVideoOption);
        }
        videoModelSelect.value = savedVideoModel;
    }

    populateDropdown();
    populateEditPresetDropdown();
    populateVideoPresetDropdown();
    loadPreset(bananaSettings.conversationPresetId);
    updateVisibility();

    // ========== Banana 专属替换词设置 ==========
    initBananaPromptReplace();
}

/**
 * 初始化 Banana 专属替换词设置
 */
function initBananaPromptReplace() {
    const getBananaSettings = () => extension_settings[extensionName].banana;

    // DOM 元素
    const presetSelect = document.getElementById('st-chatu8-banana-prompt-replace-id');
    const textarea = document.getElementById('st-chatu8-banana-prompt-replace-text');
    const saveBtn = document.getElementById('st-chatu8-banana-prompt-replace-save');
    const saveAsBtn = document.getElementById('st-chatu8-banana-prompt-replace-save-as');
    const newBtn = document.getElementById('st-chatu8-banana-prompt-replace-new');
    const renameBtn = document.getElementById('st-chatu8-banana-prompt-replace-rename');
    const deleteBtn = document.getElementById('st-chatu8-banana-prompt-replace-delete');
    const importBtn = document.getElementById('st-chatu8-banana-prompt-replace-import');
    const exportBtn = document.getElementById('st-chatu8-banana-prompt-replace-export');
    const unsavedWarning = textarea?.closest('.st-chatu8-field-col')?.querySelector('.st-chatu8-unsaved-warning');

    if (!presetSelect || !textarea) {
        console.warn('[BananaUI] 替换词设置元素未找到');
        return;
    }

    // 确保 banana 设置中有 prompt_replace 配置
    const bananaSettings = getBananaSettings();
    if (!bananaSettings.prompt_replace) {
        bananaSettings.prompt_replace = { "默认": { "text": '' } };
    }
    if (!bananaSettings.prompt_replace_id) {
        bananaSettings.prompt_replace_id = "默认";
    }

    // 填充下拉框
    const populateReplaceDropdown = () => {
        const presets = bananaSettings.prompt_replace || {};
        const currentId = bananaSettings.prompt_replace_id;

        presetSelect.innerHTML = '';
        Object.keys(presets).forEach(name => {
            const option = document.createElement('option');
            option.value = name;
            option.textContent = name;
            if (name === currentId) option.selected = true;
            presetSelect.appendChild(option);
        });
    };

    // 加载预设内容
    const loadReplacePreset = (presetId) => {
        const preset = bananaSettings.prompt_replace[presetId] || {};
        textarea.value = preset.text ?? '';
        bananaSettings.prompt_replace_id = presetId;
        if (unsavedWarning) unsavedWarning.style.display = 'none';
    };

    // 检测是否有未保存更改
    const checkUnsaved = () => {
        const currentPreset = bananaSettings.prompt_replace[bananaSettings.prompt_replace_id] || {};
        const isDirty = textarea.value !== (currentPreset.text ?? '');
        if (unsavedWarning) {
            unsavedWarning.style.display = isDirty ? 'inline' : 'none';
        }
        return isDirty;
    };

    // 切换预设
    presetSelect.addEventListener('change', async () => {
        if (checkUnsaved()) {
            const confirmed = await stylishConfirm('您有未保存的替换规则。要放弃这些更改并切换预设吗？');
            if (!confirmed) {
                presetSelect.value = bananaSettings.prompt_replace_id;
                return;
            }
        }
        loadReplacePreset(presetSelect.value);
        saveSettingsDebounced();
        toastr.success(`已加载替换规则: "${presetSelect.value}"`);
    });

    // 文本变化监听
    textarea.addEventListener('input', checkUnsaved);

    // 保存当前预设
    saveBtn.addEventListener('click', async () => {
        const presetId = bananaSettings.prompt_replace_id;
        if (!presetId || !bananaSettings.prompt_replace[presetId]) {
            toastr.warning('没有活动的替换规则可保存，请先另存为一个新规则。');
            return;
        }

        const confirmed = await stylishConfirm(`确定要覆盖当前替换规则 "${presetId}" 吗？`);
        if (!confirmed) return;

        bananaSettings.prompt_replace[presetId] = { text: textarea.value };
        saveSettingsDebounced();
        if (unsavedWarning) unsavedWarning.style.display = 'none';
        toastr.success(`替换规则 "${presetId}" 已保存!`);
    });

    // 另存为新预设
    saveAsBtn.addEventListener('click', async () => {
        const newName = await stylInput('请输入新替换规则配置的名称:');
        if (!newName || newName.trim() === '') {
            toastr.info('操作已取消。');
            return;
        }

        if (bananaSettings.prompt_replace[newName]) {
            const overwrite = await stylishConfirm(`替换规则 "${newName}" 已存在，要覆盖它吗？`);
            if (!overwrite) return;
        }

        bananaSettings.prompt_replace[newName] = { text: textarea.value };
        bananaSettings.prompt_replace_id = newName;
        populateReplaceDropdown();
        saveSettingsDebounced();
        if (unsavedWarning) unsavedWarning.style.display = 'none';
        toastr.success(`替换规则 "${newName}" 已保存!`);
    });

    newBtn.addEventListener('click', async () => {
        const newName = await stylInput('请输入新替换规则配置的名称:');
        if (!newName || newName.trim() === '') return;

        if (bananaSettings.prompt_replace[newName]) {
            toastr.error(`替换规则 "${newName}" 已存在。`);
            return;
        }

        bananaSettings.prompt_replace[newName] = { text: '' };
        bananaSettings.prompt_replace_id = newName;
        populateReplaceDropdown();
        loadReplacePreset(newName);
        saveSettingsDebounced();
        if (unsavedWarning) unsavedWarning.style.display = 'none';
        toastr.success(`空替换规则 "${newName}" 已创建!`);
    });

    renameBtn.addEventListener('click', async () => {
        const currentName = bananaSettings.prompt_replace_id;
        if (!currentName || !bananaSettings.prompt_replace[currentName]) {
            toastr.warning('没有活动的规则可重命名。');
            return;
        }
        if (currentName === '默认' || currentName === 'default') {
            toastr.warning('默认配置不能重命名。');
            return;
        }

        const newName = await stylInput('请输入新的替换规则配置名称:', currentName);
        if (!newName || newName.trim() === '' || newName.trim() === currentName) return;

        if (bananaSettings.prompt_replace[newName]) {
            toastr.error(`替换规则 "${newName}" 已存在，请换一个名称。`);
            return;
        }

        bananaSettings.prompt_replace[newName] = bananaSettings.prompt_replace[currentName];
        delete bananaSettings.prompt_replace[currentName];
        bananaSettings.prompt_replace_id = newName;
        
        populateReplaceDropdown();
        saveSettingsDebounced();
        toastr.success(`替换规则已重命名为 "${newName}"`);
    });

    // 删除预设
    deleteBtn.addEventListener('click', async () => {
        const presetId = bananaSettings.prompt_replace_id;
        if (presetId === '默认') {
            toastr.warning('默认配置不能删除。');
            return;
        }

        const confirmed = await stylishConfirm(`确定要删除替换规则 "${presetId}" 吗？此操作不可撤销。`);
        if (!confirmed) return;

        delete bananaSettings.prompt_replace[presetId];
        bananaSettings.prompt_replace_id = '默认';
        populateReplaceDropdown();
        loadReplacePreset('默认');
        saveSettingsDebounced();
        toastr.success(`替换规则 "${presetId}" 已删除。`);
    });

    // 导出当前预设
    exportBtn.addEventListener('click', () => {
        const presetId = bananaSettings.prompt_replace_id;
        const preset = bananaSettings.prompt_replace[presetId];
        if (!preset) {
            toastr.warning('没有选中的替换规则可导出。');
            return;
        }

        const dataToExport = { [presetId]: preset };
        const dataStr = JSON.stringify(dataToExport, null, 2);
        const blob = new Blob([dataStr], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `banana-prompt-replace-${presetId}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        toastr.success(`替换规则 "${presetId}" 已导出。`);
    });

    // 导入预设
    importBtn.addEventListener('click', () => {
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
                    let newCount = 0;

                    for (const key in importedData) {
                        if (importedData.hasOwnProperty(key)) {
                            if (!bananaSettings.prompt_replace.hasOwnProperty(key)) {
                                newCount++;
                            }
                            bananaSettings.prompt_replace[key] = importedData[key];
                        }
                    }

                    populateReplaceDropdown();
                    saveSettingsDebounced();
                    toastr.success(`成功导入 ${Object.keys(importedData).length} 个替换规则，其中 ${newCount} 个是全新的。`);
                } catch (err) {
                    toastr.error('导入失败，请确保文件是正确的 JSON 格式。');
                    console.error('[BananaUI] 导入替换规则失败:', err);
                }
            };
            reader.readAsText(file);
        };
        input.click();
    });

    // 初始化
    populateReplaceDropdown();
    loadReplacePreset(bananaSettings.prompt_replace_id);
}
