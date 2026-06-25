/* eslint-disable no-undef */
// @ts-nocheck
import { extension_settings } from "../../../../../extensions.js";
import { extensionName } from '../config.js';

/**
 * 智能刷新受影响的 UI 部分（避免全量刷新导致用户输入丢失）
 * @param {Object} changedSettings - 被修改的设置项
 */
export async function refreshAffectedUI(changedSettings) {
    try {
        const settings = extension_settings[extensionName];

        // 如果修改了工作流相关配置，刷新工作流选择器
        if (changedSettings.workers || changedSettings.workerid || changedSettings.editWorkerid) {
            refreshWorkflowSelectors(settings);
        }

        // 如果修改了提示词预设，刷新提示词预设选择器
        if (changedSettings.yushe || changedSettings.yusheid_sd || changedSettings.yusheid_novelai || changedSettings.yusheid_comfyui) {
            refreshPromptPresetSelectors(settings);
        }

        // 如果修改了提示词替换规则，刷新提示词替换选择器
        if (changedSettings.prompt_replace || changedSettings.prompt_replace_id) {
            refreshPromptReplaceSelectors(settings);
        }

        // 如果修改了正则配置，刷新正则选择器
        if (changedSettings.regex_profiles || changedSettings.current_regex_profile) {
            refreshRegexProfileSelector(settings);
        }

        // 如果修改了主题配置，刷新主题选择器
        if (changedSettings.themes || changedSettings.theme_id) {
            refreshThemeSelector(settings);
        }

        // 如果修改了世界书配置，刷新世界书选择器
        if (changedSettings.worldBookList || changedSettings.worldBookList_id) {
            refreshWorldBookSelector(settings);
        }

        // 如果修改了 Vibe 预设，刷新 Vibe 预设选择器
        if (changedSettings.vibePresets || changedSettings.vibePresetId) {
            refreshVibePresetSelector(settings);
        }

        // 如果修改了 Banana 角色预设，刷新 Banana 角色预设选择器
        if (changedSettings.bananaCharacterPresets || changedSettings.bananaCharacterPresetId) {
            refreshBananaCharacterPresetSelector(settings);
        }

        // 如果修改了 NovelAI 配置档案，刷新 NovelAI 选择器
        if (changedSettings.novelai_profiles || changedSettings.novelai_profile_id) {
            refreshNovelaiProfileSelector(settings);
        }

        // 如果修改了 ComfyUI 配置档案，刷新 ComfyUI 选择器
        if (changedSettings.comfyui_profiles || changedSettings.comfyui_profile_id) {
            refreshComfyuiProfileSelector(settings);
        }

        // 如果修改了 LLM 配置档案，刷新 LLM 选择器
        if (changedSettings.llm_profiles || changedSettings.current_llm_profile) {
            refreshLlmProfileSelector(settings);
            // 刷新请求类型配置中的 API 配置下拉框
            refreshRequestTypeApiSelects(settings);
        }

        // 如果修改了上下文预设，刷新上下文预设选择器
        if (changedSettings.test_context_profiles || changedSettings.current_test_context_profile) {
            refreshTestContextSelector(settings);
            // 刷新请求类型配置中的上下文预设下拉框
            refreshRequestTypeContextSelects(settings);
        }

        // 如果修改了请求类型配置，刷新对应的下拉框
        if (changedSettings.llm_request_type_configs) {
            refreshRequestTypeApiSelects(settings);
            refreshRequestTypeContextSelects(settings);
        }

        // 如果修改了翻译模型，刷新翻译模型选择器
        if (changedSettings.translation_model) {
            refreshTranslationModelSelector(settings);
        }

        // 如果修改了 SD 缓存数据，刷新 SD 相关选择器
        if (changedSettings.sdCache) {
            await refreshSdCacheSelectors(settings);
        }

        // 如果修改了 ComfyUI 缓存数据，刷新 ComfyUI 相关选择器
        if (changedSettings.comfyuiCache) {
            await refreshComfyuiCacheSelectors(settings);
        }

        // 如果修改了角色预设，刷新角色相关选择器
        if (changedSettings.characterPresets || changedSettings.character_preset_id) {
            refreshCharacterPresetSelectors(settings);
        }

        // 如果修改了服装预设，刷新服装相关选择器
        if (changedSettings.outfitPresets || changedSettings.outfit_preset_id) {
            refreshOutfitPresetSelectors(settings);
        }

        // 如果修改了角色启用预设，刷新角色启用预设选择器
        if (changedSettings.characterEnablePresets || changedSettings.character_enable_preset_id) {
            refreshCharacterEnablePresetSelector(settings);
        }

        // 如果修改了服装启用预设，刷新服装启用预设选择器
        if (changedSettings.outfitEnablePresets || changedSettings.outfit_enable_preset_id) {
            refreshOutfitEnablePresetSelector(settings);
        }

        // 如果修改了通用角色预设，刷新通用角色预设选择器
        if (changedSettings.characterCommonPresets || changedSettings.character_common_preset_id) {
            refreshCharacterCommonPresetSelector(settings);
        }

        // 如果修改了 Banana 对话预设，刷新 Banana 对话预设选择器
        if (changedSettings.banana?.conversationPresets || changedSettings.banana?.conversationPresetId) {
            refreshBananaConversationPresetSelector(settings);
        }

        // 如果修改了悬浮球主题，刷新悬浮球主题选择器
        if (changedSettings.fabThemes || changedSettings.chatu8_fab_theme) {
            refreshFabThemeSelector(settings);
        }

        // 刷新输入框和文本域（只刷新被修改的字段）
        refreshInputFields(changedSettings, settings);

        console.log('[AI Config Helper] UI 已智能刷新');
    } catch (error) {
        console.error('[AI Config Helper] UI 刷新失败:', error);
    }
}

/**
 * 刷新请求类型配置中的 API 配置下拉框
 * @param {Object} settings - 当前设置对象
 */
function refreshRequestTypeApiSelects(settings) {
    if (!settings.llm_profiles) return;

    const requestTypes = ['image_gen', 'char_design', 'char_display', 'char_modify', 'translation', 'tag_modify'];
    const profileNames = Object.keys(settings.llm_profiles);

    requestTypes.forEach(type => {
        const selectId = `ch-llm_${type}_api_select`;
        const select = document.getElementById(selectId);
        if (!select) return;

        const currentValue = select.value;
        select.innerHTML = '';

        // 添加选项
        profileNames.forEach(name => {
            const option = new Option(name, name);
            option.title = name;
            select.add(option);
        });

        // 恢复选中值
        const savedValue = settings.llm_request_type_configs?.[type]?.api_profile;
        if (savedValue && profileNames.includes(savedValue)) {
            select.value = savedValue;
        } else if (profileNames.includes(currentValue)) {
            select.value = currentValue;
        } else if (profileNames.length > 0) {
            select.value = profileNames[0];
        }
    });

    console.log('[AI Config Helper] 请求类型 API 配置下拉框已刷新');
}

/**
 * 刷新请求类型配置中的上下文预设下拉框
 * @param {Object} settings - 当前设置对象
 */
function refreshRequestTypeContextSelects(settings) {
    if (!settings.test_context_profiles) return;

    const requestTypes = ['image_gen', 'char_design', 'char_display', 'char_modify', 'translation', 'tag_modify'];
    const contextNames = Object.keys(settings.test_context_profiles);

    requestTypes.forEach(type => {
        const selectId = `ch-llm_${type}_context_select`;
        const select = document.getElementById(selectId);
        if (!select) return;

        const currentValue = select.value;
        select.innerHTML = '';

        // 添加选项
        contextNames.forEach(name => {
            const option = new Option(name, name);
            option.title = name;
            select.add(option);
        });

        // 恢复选中值
        const savedValue = settings.llm_request_type_configs?.[type]?.context_preset;
        if (savedValue && contextNames.includes(savedValue)) {
            select.value = savedValue;
        } else if (contextNames.includes(currentValue)) {
            select.value = currentValue;
        } else if (contextNames.length > 0) {
            select.value = contextNames[0];
        }
    });

    console.log('[AI Config Helper] 请求类型上下文预设下拉框已刷新');
}

/**
 * 刷新工作流选择器
 * @param {Object} settings - 当前设置对象
 */
export function refreshWorkflowSelectors(settings) {
    // 刷新工作流选择器
    const workerSelect = document.getElementById('workerid');
    if (workerSelect && settings.workers) {
        const currentValue = workerSelect.value;
        workerSelect.innerHTML = '';
        for (const key in settings.workers) {
            const option = new Option(key, key);
            option.title = key;
            workerSelect.add(option);
        }
        // 恢复选中值（如果还存在）
        if (settings.workers[currentValue]) {
            workerSelect.value = currentValue;
        } else if (settings.workerid && settings.workers[settings.workerid]) {
            workerSelect.value = settings.workerid;
        }

        // 刷新工作流 JSON 输入框
        const workerTextarea = document.getElementById('worker');
        if (workerTextarea) {
            const selectedWorkflowName = workerSelect.value;
            if (selectedWorkflowName && settings.workers[selectedWorkflowName]) {
                workerTextarea.value = settings.workers[selectedWorkflowName];
            }
        }
    }

    // 刷新修图预设选择器
    const editWorkerSelect = document.getElementById('editWorkerid');
    if (editWorkerSelect && settings.workers) {
        const currentValue = editWorkerSelect.value;
        editWorkerSelect.innerHTML = '';
        for (const key in settings.workers) {
            const option = new Option(key, key);
            option.title = key;
            editWorkerSelect.add(option);
        }
        // 恢复选中值（如果还存在）
        if (settings.workers[currentValue]) {
            editWorkerSelect.value = currentValue;
        } else if (settings.editWorkerid && settings.workers[settings.editWorkerid]) {
            editWorkerSelect.value = settings.editWorkerid;
        }

        // 刷新修图工作流 JSON 输入框
        const editWorkerTextarea = document.getElementById('editWorker');
        if (editWorkerTextarea) {
            const selectedEditWorkflowName = editWorkerSelect.value;
            if (selectedEditWorkflowName && settings.workers[selectedEditWorkflowName]) {
                editWorkerTextarea.value = settings.workers[selectedEditWorkflowName];
            }
        }
    }

    console.log('[AI Config Helper] 工作流选择器和JSON输入框已刷新');
}

/**
 * 刷新提示词预设选择器
 * @param {Object} settings - 当前设置对象
 */
function refreshPromptPresetSelectors(settings) {
    if (!settings.yushe) return;

    const modes = [
        { id: 'yusheid', key: 'yusheid_sd' },
        { id: 'yusheid_novelai', key: 'yusheid_novelai' },
        { id: 'yusheid_comfyui', key: 'yusheid_comfyui' }
    ];

    modes.forEach(({ id, key }) => {
        const select = document.getElementById(id);
        if (!select) return;

        const currentValue = select.value;
        select.innerHTML = '';

        for (const presetName in settings.yushe) {
            const option = new Option(presetName, presetName);
            option.title = presetName;
            select.add(option);
        }

        // 恢复选中值
        const savedValue = settings[key];
        if (savedValue && settings.yushe[savedValue]) {
            select.value = savedValue;
        } else if (settings.yushe[currentValue]) {
            select.value = currentValue;
        }
    });

    console.log('[AI Config Helper] 提示词预设选择器已刷新');
}

/**
 * 刷新提示词替换选择器
 * @param {Object} settings - 当前设置对象
 */
function refreshPromptReplaceSelectors(settings) {
    if (!settings.prompt_replace) return;

    const selectors = [
        { id: 'prompt_replace_id', key: 'prompt_replace_id' },
        { id: 'prompt_replace_id_novelai', key: 'prompt_replace_id' },
        { id: 'prompt_replace_id_comfyui', key: 'prompt_replace_id' }
    ];

    selectors.forEach(({ id, key }) => {
        const select = document.getElementById(id);
        if (!select) return;

        const currentValue = select.value;
        select.innerHTML = '';

        for (const replaceName in settings.prompt_replace) {
            const option = new Option(replaceName, replaceName);
            option.title = replaceName;
            select.add(option);
        }

        // 恢复选中值
        const savedValue = settings[key];
        if (savedValue && settings.prompt_replace[savedValue]) {
            select.value = savedValue;
        } else if (settings.prompt_replace[currentValue]) {
            select.value = currentValue;
        }
    });

    console.log('[AI Config Helper] 提示词替换选择器已刷新');
}

/**
 * 刷新正则配置选择器
 * @param {Object} settings - 当前设置对象
 */
function refreshRegexProfileSelector(settings) {
    if (!settings.regex_profiles) return;

    const select = document.getElementById('ch-regex-profile-select');
    if (!select) return;

    const currentValue = select.value;
    select.innerHTML = '';

    for (const profileName in settings.regex_profiles) {
        const option = new Option(profileName, profileName);
        option.title = profileName;
        select.add(option);
    }

    // 恢复选中值
    if (settings.regex_profiles[currentValue]) {
        select.value = currentValue;
    } else if (settings.current_regex_profile && settings.regex_profiles[settings.current_regex_profile]) {
        select.value = settings.current_regex_profile;
    }

    console.log('[AI Config Helper] 正则配置选择器已刷新');
}

/**
 * 刷新主题选择器
 * @param {Object} settings - 当前设置对象
 */
function refreshThemeSelector(settings) {
    if (!settings.themes) return;

    const select = document.getElementById('theme_id');
    if (!select) return;

    const currentValue = select.value;
    select.innerHTML = '';

    for (const themeName in settings.themes) {
        const option = new Option(themeName, themeName);
        option.title = themeName;
        select.add(option);
    }

    // 恢复选中值
    if (settings.themes[currentValue]) {
        select.value = currentValue;
    } else if (settings.theme_id && settings.themes[settings.theme_id]) {
        select.value = settings.theme_id;
    }

    console.log('[AI Config Helper] 主题选择器已刷新');
}

/**
 * 刷新世界书选择器
 * @param {Object} settings - 当前设置对象
 */
function refreshWorldBookSelector(settings) {
    if (!settings.worldBookList) return;

    const select = document.getElementById('worldBookList_id');
    if (!select) return;

    const currentValue = select.value;
    select.innerHTML = '';

    for (const bookName in settings.worldBookList) {
        const option = new Option(bookName, bookName);
        option.title = bookName;
        select.add(option);
    }

    // 恢复选中值
    if (settings.worldBookList[currentValue]) {
        select.value = currentValue;
    } else if (settings.worldBookList_id && settings.worldBookList[settings.worldBookList_id]) {
        select.value = settings.worldBookList_id;
    }

    console.log('[AI Config Helper] 世界书选择器已刷新');
}

/**
 * 刷新 Vibe 预设选择器
 * @param {Object} settings - 当前设置对象
 */
function refreshVibePresetSelector(settings) {
    if (!settings.vibePresets) return;

    const select = document.getElementById('vibePresetId');
    if (!select) return;

    const currentValue = select.value;
    select.innerHTML = '';

    for (const presetName in settings.vibePresets) {
        const option = new Option(presetName, presetName);
        option.title = presetName;
        select.add(option);
    }

    // 恢复选中值
    if (settings.vibePresets[currentValue]) {
        select.value = currentValue;
    } else if (settings.vibePresetId && settings.vibePresets[settings.vibePresetId]) {
        select.value = settings.vibePresetId;
    }

    console.log('[AI Config Helper] Vibe 预设选择器已刷新');
}

/**
 * 刷新 Banana 角色预设选择器
 * @param {Object} settings - 当前设置对象
 */
function refreshBananaCharacterPresetSelector(settings) {
    if (!settings.bananaCharacterPresets) return;

    const select = document.getElementById('bananaCharacterPresetId');
    if (!select) return;

    const currentValue = select.value;
    select.innerHTML = '';

    for (const presetName in settings.bananaCharacterPresets) {
        const option = new Option(presetName, presetName);
        option.title = presetName;
        select.add(option);
    }

    // 恢复选中值
    if (settings.bananaCharacterPresets[currentValue]) {
        select.value = currentValue;
    } else if (settings.bananaCharacterPresetId && settings.bananaCharacterPresets[settings.bananaCharacterPresetId]) {
        select.value = settings.bananaCharacterPresetId;
    }

    console.log('[AI Config Helper] Banana 角色预设选择器已刷新');
}

/**
 * 刷新 NovelAI 配置档案选择器
 * @param {Object} settings - 当前设置对象
 */
function refreshNovelaiProfileSelector(settings) {
    if (!settings.novelai_profiles) return;

    const select = document.getElementById('novelai_profile_id');
    if (!select) return;

    const currentValue = select.value;
    select.innerHTML = '';

    for (const profileName in settings.novelai_profiles) {
        const option = new Option(profileName, profileName);
        option.title = profileName;
        select.add(option);
    }

    // 恢复选中值
    if (settings.novelai_profiles[currentValue]) {
        select.value = currentValue;
    } else if (settings.novelai_profile_id && settings.novelai_profiles[settings.novelai_profile_id]) {
        select.value = settings.novelai_profile_id;
    }

    console.log('[AI Config Helper] NovelAI 配置档案选择器已刷新');
}

/**
 * 刷新 ComfyUI 配置档案选择器
 * @param {Object} settings - 当前设置对象
 */
function refreshComfyuiProfileSelector(settings) {
    if (!settings.comfyui_profiles) return;

    const select = document.getElementById('comfyui_profile_id');
    if (!select) return;

    const currentValue = select.value;
    select.innerHTML = '';

    for (const profileName in settings.comfyui_profiles) {
        const option = new Option(profileName, profileName);
        option.title = profileName;
        select.add(option);
    }

    // 恢复选中值
    if (settings.comfyui_profiles[currentValue]) {
        select.value = currentValue;
    } else if (settings.comfyui_profile_id && settings.comfyui_profiles[settings.comfyui_profile_id]) {
        select.value = settings.comfyui_profile_id;
    }

    console.log('[AI Config Helper] ComfyUI 配置档案选择器已刷新');
}

/**
 * 刷新 LLM 配置档案选择器
 * @param {Object} settings - 当前设置对象
 */
function refreshLlmProfileSelector(settings) {
    if (!settings.llm_profiles) return;

    const select = document.getElementById('ch-llm_profile_select');
    if (!select) return;

    const currentValue = select.value;
    select.innerHTML = '';

    for (const profileName in settings.llm_profiles) {
        const option = new Option(profileName, profileName);
        option.title = profileName;
        select.add(option);
    }

    // 恢复选中值
    if (settings.llm_profiles[currentValue]) {
        select.value = currentValue;
    } else if (settings.current_llm_profile && settings.llm_profiles[settings.current_llm_profile]) {
        select.value = settings.current_llm_profile;
    }

    console.log('[AI Config Helper] LLM 配置档案选择器已刷新');
}

/**
 * 刷新上下文预设选择器
 * @param {Object} settings - 当前设置对象
 */
function refreshTestContextSelector(settings) {
    if (!settings.test_context_profiles) return;

    const select = document.getElementById('ch-test_context_select');
    if (!select) return;

    const currentValue = select.value;
    select.innerHTML = '';

    for (const contextName in settings.test_context_profiles) {
        const option = new Option(contextName, contextName);
        option.title = contextName;
        select.add(option);
    }

    // 恢复选中值
    if (settings.test_context_profiles[currentValue]) {
        select.value = currentValue;
    } else if (settings.current_test_context_profile && settings.test_context_profiles[settings.current_test_context_profile]) {
        select.value = settings.current_test_context_profile;
    }

    console.log('[AI Config Helper] 上下文预设选择器已刷新');
}

/**
 * 刷新翻译模型选择器
 * @param {Object} settings - 当前设置对象
 */
function refreshTranslationModelSelector(settings) {
    if (!settings.llm_profiles) return;

    const select = document.getElementById('translation_model');
    if (!select) return;

    const currentValue = select.value;
    select.innerHTML = '';

    for (const profileName in settings.llm_profiles) {
        const option = new Option(profileName, profileName);
        option.title = profileName;
        select.add(option);
    }

    // 恢复选中值
    if (settings.llm_profiles[currentValue]) {
        select.value = currentValue;
    } else if (settings.translation_model && settings.llm_profiles[settings.translation_model]) {
        select.value = settings.translation_model;
    }

    console.log('[AI Config Helper] 翻译模型选择器已刷新');
}

/**
 * 从缓存项中提取字符串值（兼容 string 和 object 格式）
 * @param {string|Object} item
 * @returns {string}
 */
function toStr(item) {
    if (typeof item === 'string') return item;
    if (typeof item === 'object' && item !== null) return item.value || item.name || item.text || String(item);
    return String(item);
}

/**
 * 刷新 SD 缓存相关选择器
 * @param {Object} settings - 当前设置对象
 */
async function refreshSdCacheSelectors(settings) {
    // 直接从 configDatabase 读取 cache
    const { getFullSdCache } = await import('../configDatabase.js');
    const cache = await getFullSdCache();
    if (!cache || Object.keys(cache).length === 0) return;

    // 刷新模型选择器
    if (cache.models) {
        const modelSelect = document.getElementById('sd_cchatu_8_model');
        if (modelSelect) {
            const currentValue = modelSelect.value;
            modelSelect.innerHTML = '';
            const modelStrs = cache.models.map(toStr);
            modelStrs.forEach(model => modelSelect.add(new Option(model, model)));
            if (modelStrs.includes(currentValue)) {
                modelSelect.value = currentValue;
            } else if (settings.sd_cchatu_8_model && modelStrs.includes(settings.sd_cchatu_8_model)) {
                modelSelect.value = settings.sd_cchatu_8_model;
            }
        }
    }

    // 刷新 VAE 选择器
    if (cache.vaes) {
        const vaeSelect = document.getElementById('sd_cchatu_8_vae');
        if (vaeSelect) {
            const currentValue = vaeSelect.value;
            vaeSelect.innerHTML = '';
            const vaeStrs = cache.vaes.map(toStr);
            vaeStrs.forEach(vae => vaeSelect.add(new Option(vae, vae)));
            if (vaeStrs.includes(currentValue)) {
                vaeSelect.value = currentValue;
            } else if (settings.sd_cchatu_8_vae && vaeStrs.includes(settings.sd_cchatu_8_vae)) {
                vaeSelect.value = settings.sd_cchatu_8_vae;
            }
        }
    }

    // 刷新采样器选择器
    if (cache.samplers) {
        const samplerSelect = document.getElementById('sd_cchatu_8_samplerName');
        if (samplerSelect) {
            const currentValue = samplerSelect.value;
            samplerSelect.innerHTML = '';
            const samplerStrs = cache.samplers.map(toStr);
            samplerStrs.forEach(sampler => samplerSelect.add(new Option(sampler, sampler)));
            if (samplerStrs.includes(currentValue)) {
                samplerSelect.value = currentValue;
            } else if (settings.sd_cchatu_8_samplerName && samplerStrs.includes(settings.sd_cchatu_8_samplerName)) {
                samplerSelect.value = settings.sd_cchatu_8_samplerName;
            }
        }
    }

    // 刷新调度器选择器
    if (cache.schedulers) {
        const schedulerSelect = document.getElementById('sd_cchatu_8_scheduler');
        if (schedulerSelect) {
            const currentValue = schedulerSelect.value;
            schedulerSelect.innerHTML = '';
            const schedulerStrs = cache.schedulers.map(toStr);
            schedulerStrs.forEach(scheduler => schedulerSelect.add(new Option(scheduler, scheduler)));
            if (schedulerStrs.includes(currentValue)) {
                schedulerSelect.value = currentValue;
            } else if (settings.sd_cchatu_8_scheduler && schedulerStrs.includes(settings.sd_cchatu_8_scheduler)) {
                schedulerSelect.value = settings.sd_cchatu_8_scheduler;
            }
        }
    }

    // 刷新放大器选择器
    if (cache.upscalers) {
        const upscalerSelect = document.getElementById('sd_cchatu_8_upscaler');
        if (upscalerSelect) {
            const currentValue = upscalerSelect.value;
            upscalerSelect.innerHTML = '';
            const upscalerStrs = cache.upscalers.map(toStr);
            upscalerStrs.forEach(upscaler => upscalerSelect.add(new Option(upscaler, upscaler)));
            if (upscalerStrs.includes(currentValue)) {
                upscalerSelect.value = currentValue;
            } else if (settings.sd_cchatu_8_upscaler && upscalerStrs.includes(settings.sd_cchatu_8_upscaler)) {
                upscalerSelect.value = settings.sd_cchatu_8_upscaler;
            }
        }
    }

    // 刷新 LORA 选择器
    if (cache.loras) {
        const loraSelect = document.getElementById('sd_cchatu_8_lora');
        if (loraSelect) {
            const currentValue = loraSelect.value;
            loraSelect.innerHTML = '';
            const loraStrs = cache.loras.map(toStr);
            loraStrs.forEach(lora => loraSelect.add(new Option(lora, lora)));
            if (loraStrs.includes(currentValue)) {
                loraSelect.value = currentValue;
            }
        }
    }

    console.log('[AI Config Helper] SD 缓存选择器已刷新');
}

/**
 * 刷新 ComfyUI 缓存相关选择器
 * @param {Object} settings - 当前设置对象
 */
function normalizeBackslashPath(value) {
    return value == null ? '' : String(value).trim().replace(/\\{2,}/g, '\\');
}

async function refreshComfyuiCacheSelectors(settings) {
    // 直接从 configDatabase 读取 cache
    const { getFullComfyuiCache } = await import('../configDatabase.js');
    const cache = await getFullComfyuiCache();
    if (!cache || Object.keys(cache).length === 0) return;

    // 刷新模型选择器
    if (cache.models) {
        const modelSelect = document.getElementById('MODEL_NAME');
        if (modelSelect) {
            const currentValue = normalizeBackslashPath(modelSelect.value);
            modelSelect.innerHTML = '';
            cache.models.forEach(model => {
                const text = (typeof model === 'object' && model !== null) ? (model.text || model.value || String(model)) : String(model);
                const value = normalizeBackslashPath((typeof model === 'object' && model !== null) ? (model.value || String(model)) : String(model));
                const opt = new Option(text, value);
                opt.title = text;
                modelSelect.add(opt);
            });
            const modelValues = Array.from(modelSelect.options).map(o => o.value);
            if (modelValues.includes(currentValue)) {
                modelSelect.value = currentValue;
            } else if (settings.MODEL_NAME && modelValues.includes(normalizeBackslashPath(settings.MODEL_NAME))) {
                modelSelect.value = normalizeBackslashPath(settings.MODEL_NAME);
            }
        }
    }

    // 刷新采样器选择器
    if (cache.samplers) {
        const samplerSelect = document.getElementById('comfyuisamplerName');
        if (samplerSelect) {
            const currentValue = samplerSelect.value;
            samplerSelect.innerHTML = '';
            const samplerStrs = cache.samplers.map(toStr);
            samplerStrs.forEach(sampler => samplerSelect.add(new Option(sampler, sampler)));
            if (samplerStrs.includes(currentValue)) {
                samplerSelect.value = currentValue;
            } else if (settings.comfyuisamplerName && samplerStrs.includes(settings.comfyuisamplerName)) {
                samplerSelect.value = settings.comfyuisamplerName;
            }
        }
    }

    // 刷新 VAE 选择器
    if (cache.vaes) {
        const vaeSelect = document.getElementById('comfyui_vae');
        if (vaeSelect) {
            const currentValue = vaeSelect.value;
            vaeSelect.innerHTML = '';
            const vaeStrs = cache.vaes.map(toStr);
            vaeStrs.forEach(vae => vaeSelect.add(new Option(vae, vae)));
            if (vaeStrs.includes(currentValue)) {
                vaeSelect.value = currentValue;
            } else if (settings.comfyui_vae && vaeStrs.includes(settings.comfyui_vae)) {
                vaeSelect.value = settings.comfyui_vae;
            }
        }
    }

    // 刷新调度器选择器
    if (cache.schedulers) {
        const schedulerSelect = document.getElementById('comfyui_scheduler');
        if (schedulerSelect) {
            const currentValue = schedulerSelect.value;
            schedulerSelect.innerHTML = '';
            const schedulerStrs = cache.schedulers.map(toStr);
            schedulerStrs.forEach(scheduler => schedulerSelect.add(new Option(scheduler, scheduler)));
            if (schedulerStrs.includes(currentValue)) {
                schedulerSelect.value = currentValue;
            } else if (settings.comfyui_scheduler && schedulerStrs.includes(settings.comfyui_scheduler)) {
                schedulerSelect.value = settings.comfyui_scheduler;
            }
        }
    }

    // 刷新 CLIP 选择器
    if (cache.clips) {
        const clipSelect = document.getElementById('comfyuiCLIPName');
        if (clipSelect) {
            const currentValue = clipSelect.value;
            clipSelect.innerHTML = '';
            const clipStrs = cache.clips.map(toStr);
            clipStrs.forEach(clip => clipSelect.add(new Option(clip, clip)));
            if (clipStrs.includes(currentValue)) {
                clipSelect.value = currentValue;
            } else if (settings.comfyuiCLIPName && clipStrs.includes(settings.comfyuiCLIPName)) {
                clipSelect.value = settings.comfyuiCLIPName;
            }
        }
    }

    // 刷新 LORA 选择器
    if (cache.loras) {
        const loraSelect = document.getElementById('ComfyuiLORA');
        if (loraSelect) {
            const currentValue = loraSelect.value;
            loraSelect.innerHTML = '';
            const loraStrs = cache.loras.map(toStr);
            loraStrs.forEach(lora => loraSelect.add(new Option(lora, lora)));
            if (loraStrs.includes(currentValue)) {
                loraSelect.value = currentValue;
            }
        }
    }

    console.log('[AI Config Helper] ComfyUI 缓存选择器已刷新');
}

/**
 * 刷新角色预设相关选择器
 * @param {Object} settings - 当前设置对象
 */
function refreshCharacterPresetSelectors(settings) {
    if (!settings.characterPresets) return;

    const select = document.getElementById('character_preset_id');
    if (select) {
        const currentValue = select.value;
        select.innerHTML = '';
        for (const name in settings.characterPresets) {
            select.add(new Option(name, name));
        }
        if (settings.characterPresets[currentValue]) {
            select.value = currentValue;
        } else if (settings.character_preset_id && settings.characterPresets[settings.character_preset_id]) {
            select.value = settings.character_preset_id;
        }
    }

    console.log('[AI Config Helper] 角色预设选择器已刷新');
}

/**
 * 刷新服装预设相关选择器
 * @param {Object} settings - 当前设置对象
 */
function refreshOutfitPresetSelectors(settings) {
    if (!settings.outfitPresets) return;

    const select = document.getElementById('outfit_preset_id');
    if (select) {
        const currentValue = select.value;
        select.innerHTML = '';
        for (const name in settings.outfitPresets) {
            select.add(new Option(name, name));
        }
        if (settings.outfitPresets[currentValue]) {
            select.value = currentValue;
        } else if (settings.outfit_preset_id && settings.outfitPresets[settings.outfit_preset_id]) {
            select.value = settings.outfit_preset_id;
        }
    }

    console.log('[AI Config Helper] 服装预设选择器已刷新');
}

/**
 * 刷新角色启用预设选择器
 * @param {Object} settings - 当前设置对象
 */
function refreshCharacterEnablePresetSelector(settings) {
    if (!settings.characterEnablePresets) return;
    const select = document.getElementById('character_enable_preset_id');
    if (select) {
        const currentValue = select.value;
        select.innerHTML = '';
        for (const name in settings.characterEnablePresets) select.add(new Option(name, name));
        if (settings.characterEnablePresets[currentValue]) {
            select.value = currentValue;
        } else if (settings.character_enable_preset_id && settings.characterEnablePresets[settings.character_enable_preset_id]) {
            select.value = settings.character_enable_preset_id;
        }
    }
    console.log('[AI Config Helper] 角色启用预设选择器已刷新');
}

/**
 * 刷新服装启用预设选择器
 * @param {Object} settings - 当前设置对象
 */
function refreshOutfitEnablePresetSelector(settings) {
    if (!settings.outfitEnablePresets) return;
    const select = document.getElementById('outfit_enable_preset_id');
    if (select) {
        const currentValue = select.value;
        select.innerHTML = '';
        for (const name in settings.outfitEnablePresets) select.add(new Option(name, name));
        if (settings.outfitEnablePresets[currentValue]) {
            select.value = currentValue;
        } else if (settings.outfit_enable_preset_id && settings.outfitEnablePresets[settings.outfit_enable_preset_id]) {
            select.value = settings.outfit_enable_preset_id;
        }
    }
    console.log('[AI Config Helper] 服装启用预设选择器已刷新');
}

/**
 * 刷新通用角色预设选择器
 * @param {Object} settings - 当前设置对象
 */
function refreshCharacterCommonPresetSelector(settings) {
    if (!settings.characterCommonPresets) return;
    const select = document.getElementById('character_common_preset_id');
    if (select) {
        const currentValue = select.value;
        select.innerHTML = '';
        for (const name in settings.characterCommonPresets) select.add(new Option(name, name));
        if (settings.characterCommonPresets[currentValue]) {
            select.value = currentValue;
        } else if (settings.character_common_preset_id && settings.characterCommonPresets[settings.character_common_preset_id]) {
            select.value = settings.character_common_preset_id;
        }
    }
    console.log('[AI Config Helper] 通用角色预设选择器已刷新');
}

/**
 * 刷新 Banana 对话预设选择器
 * @param {Object} settings - 当前设置对象
 */
function refreshBananaConversationPresetSelector(settings) {
    if (!settings.banana?.conversationPresets) return;

    const select = document.getElementById('st-chatu8-banana-conversation-preset-id');
    if (select) {
        const currentValue = select.value;
        select.innerHTML = '';
        for (const name in settings.banana.conversationPresets) {
            select.add(new Option(name, name));
        }
        if (settings.banana.conversationPresets[currentValue]) {
            select.value = currentValue;
        } else if (settings.banana.conversationPresetId && settings.banana.conversationPresets[settings.banana.conversationPresetId]) {
            select.value = settings.banana.conversationPresetId;
        }
    }

    console.log('[AI Config Helper] Banana 对话预设选择器已刷新');
}

/**
 * 刷新悬浮球主题选择器
 * @param {Object} settings - 当前设置对象
 */
function refreshFabThemeSelector(settings) {
    if (!settings.fabThemes) return;

    const select = document.getElementById('chatu8_fab_theme');
    if (select) {
        const currentValue = select.value;
        select.innerHTML = '';
        for (const name in settings.fabThemes) {
            select.add(new Option(name, name));
        }
        if (settings.fabThemes[currentValue]) {
            select.value = currentValue;
        } else if (settings.chatu8_fab_theme && settings.fabThemes[settings.chatu8_fab_theme]) {
            select.value = settings.chatu8_fab_theme;
        }
    }

    console.log('[AI Config Helper] 悬浮球主题选择器已刷新');
}

/**
 * 刷新输入框和文本域（只刷新被修改的字段，避免干扰用户正在编辑的内容）
 * @param {Object} changedSettings - 被修改的设置项
 * @param {Object} settings - 当前完整设置对象
 */
function refreshInputFields(changedSettings, settings) {
    // 配置字段到元素ID的映射表
    const fieldToElementMap = {
        // 主要设置页面
        'startTag': 'startTag',
        'endTag': 'endTag',
        'imageGenInterval': 'imageGenInterval',

        // SD 设置页面
        'sdUrl': 'sdUrl',
        'st_chatu8_sd_auth': 'st_chatu8_sd_auth',
        'AQT_sd': 'fixedPrompt',
        'fixedPrompt_end_sd': 'fixedPrompt_end',
        'UCP_sd': 'negativePrompt',
        'sd_cwidth': 'sd_cwidth',
        'sd_cheight': 'sd_cheight',
        'sd_csteps': 'sd_csteps',
        'sd_cseed': 'sd_cseed',
        'sdCfgScale': 'sdCfgScale',
        'sd_cclip_skip': 'sd_cclip_skip',
        'sd_chires_steps': 'sd_chires_steps',
        'sd_cupscale_factor': 'sd_cupscale_factor',
        'sd_cdenoising_strength': 'sd_cdenoising_strength',

        // NovelAI 设置页面
        'novelaiApi': 'novelaiApi',
        'novelaiOtherSite': 'novelaiOtherSite',
        'cloudQueueUrl': 'cloudQueueUrl',
        'cloudQueueGreeting': 'cloudQueueGreeting',
        'AQT_novelai': 'fixedPrompt_novelai',
        'fixedPrompt_end_novelai': 'fixedPrompt_end_novelai',
        'UCP_novelai': 'negativePrompt_novelai',
        'nai3Scale': 'nai3Scale',
        'cfg_rescale': 'cfg_rescale',
        'novelai_width': 'novelai_width',
        'novelai_height': 'novelai_height',
        'novelai_steps': 'novelai_steps',
        'novelai_seed': 'novelai_seed',
        'InformationExtracted': 'InformationExtracted',
        'ReferenceStrength': 'ReferenceStrength',

        // ComfyUI 设置页面
        'comfyuiUrl': 'comfyuiUrl',
        'AQT_comfyui': 'fixedPrompt_comfyui',
        'fixedPrompt_end_comfyui': 'fixedPrompt_end_comfyui',
        'UCP_comfyui': 'negativePrompt_comfyui',
        'comfyui_width': 'comfyui_width',
        'comfyui_height': 'comfyui_height',
        'comfyui_steps': 'comfyui_steps',
        'comfyui_seed': 'comfyui_seed',
        'cfg_comfyui': 'cfg_comfyui',
        'c_fenwei': 'c_fenwei',
        'c_xijie': 'c_xijie',
        'c_quanzhong': 'c_quanzhong',
        'c_idquanzhong': 'c_idquanzhong',
        'inpaint_denoise': 'inpaint_denoise',
        'inpaint_positive_prompt': 'inpaint_positive_prompt',
        'inpaint_negative_prompt': 'inpaint_negative_prompt',

        // Banana 设置页面
        'banana.apiUrl': 'st-chatu8-banana-api-url',
        'banana.apiKey': 'st-chatu8-banana-api-key',

        // LLM 设置页面
        'translation_system_prompt': 'translation_system_prompt',
        'ai_temperature': 'ch-llm_temperature_value',
        'ai_top_p': 'ch-llm_top_p_value',
        'llm_history_depth': 'ch-llm_history_depth_value',

        // 世界书页面
        'worldbook_content': 'worldbook_content',

        // 正则页面
        'defaultCharDemand': 'ch-default-char-demand',
        'defaultImageDemand': 'ch-default-image-demand',

        // 词库页面
        'vocabulary_search_limit': 'vocabulary_search_limit',

        // 悬浮球页面
        'chatu8_fab_opacity': 'chatu8_fab_opacity_value',
        'chatu8_fab_size': 'chatu8_fab_size_value',

        // 角色管理页面
        'char_nameCN': 'char_nameCN',
        'char_nameEN': 'char_nameEN',
        'outfit_nameCN': 'outfit_nameCN',
        'outfit_nameEN': 'outfit_nameEN',
    };

    // 特殊处理：LLM 配置档案中的字段
    const llmProfileFields = {
        'api_url': 'ch-llm_api_url',
        'api_key': 'ch-llm_api_key',
        'model': 'ch-llm_model_input',
        'temperature': 'ch-llm_temperature_value',
        'top_p': 'ch-llm_top_p_value',
        'max_tokens': 'ch-llm_max_tokens_value',
    };

    let refreshCount = 0;

    // 遍历被修改的字段
    for (const [key, value] of Object.entries(changedSettings)) {
        // 处理普通字段
        if (fieldToElementMap[key]) {
            const elementId = fieldToElementMap[key];
            const element = document.getElementById(elementId);

            if (element) {
                // 检查元素是否正在被用户编辑（有焦点）
                if (document.activeElement !== element) {
                    // 根据元素类型设置值
                    if (element.tagName === 'TEXTAREA' || element.tagName === 'INPUT') {
                        element.value = value ?? '';
                        refreshCount++;
                    }
                }
            }
        }

        // 处理 LLM 配置档案的嵌套字段
        if (key === 'llm_profiles' && settings.current_llm_profile) {
            const currentProfile = settings.llm_profiles[settings.current_llm_profile];
            if (currentProfile) {
                for (const [profileKey, elementId] of Object.entries(llmProfileFields)) {
                    const element = document.getElementById(elementId);
                    if (element && document.activeElement !== element) {
                        const profileValue = currentProfile[profileKey];
                        if (profileValue !== undefined) {
                            element.value = profileValue ?? '';
                            refreshCount++;
                        }
                    }
                }
            }
        }

        // 处理 Banana 配置的嵌套字段
        if (key === 'banana' && typeof value === 'object') {
            if (value.apiUrl !== undefined) {
                const element = document.getElementById('st-chatu8-banana-api-url');
                if (element && document.activeElement !== element) {
                    element.value = value.apiUrl ?? '';
                    refreshCount++;
                }
            }
            if (value.apiKey !== undefined) {
                const element = document.getElementById('st-chatu8-banana-api-key');
                if (element && document.activeElement !== element) {
                    element.value = value.apiKey ?? '';
                    refreshCount++;
                }
            }
        }

        // 处理世界书内容
        if (key === 'worldBookList' && settings.worldBookList_id) {
            const currentBook = settings.worldBookList[settings.worldBookList_id];
            if (currentBook !== undefined) {
                const element = document.getElementById('worldbook_content');
                if (element && document.activeElement !== element) {
                    element.value = currentBook ?? '';
                    refreshCount++;
                }
            }
        }

        // 处理提示词替换文本
        if (key === 'prompt_replace' && settings.prompt_replace_id) {
            const currentReplace = settings.prompt_replace[settings.prompt_replace_id];
            if (currentReplace !== undefined) {
                // SD 提示词替换
                const sdElement = document.getElementById('prompt_replace_text');
                if (sdElement && document.activeElement !== sdElement) {
                    sdElement.value = currentReplace ?? '';
                    refreshCount++;
                }
                // NovelAI 提示词替换
                const naiElement = document.getElementById('prompt_replace_text_novelai');
                if (naiElement && document.activeElement !== naiElement) {
                    naiElement.value = currentReplace ?? '';
                    refreshCount++;
                }
                // ComfyUI 提示词替换
                const comfyElement = document.getElementById('prompt_replace_text_comfyui');
                if (comfyElement && document.activeElement !== comfyElement) {
                    comfyElement.value = currentReplace ?? '';
                    refreshCount++;
                }
            }
        }

        // 同步滑块和数字输入框
        syncRangeInputs(key, value);
    }

    if (refreshCount > 0) {
        console.log(`[AI Config Helper] 已刷新 ${refreshCount} 个输入框`);
    }
}

/**
 * 同步滑块和数字输入框的值
 * @param {string} key - 配置键名
 * @param {*} value - 配置值
 */
export function syncRangeInputs(key, value) {
    // 滑块和输入框的映射关系
    const rangeMap = {
        'ai_temperature': { slider: 'ch-llm_temperature', input: 'ch-llm_temperature_value' },
        'ai_top_p': { slider: 'ch-llm_top_p', input: 'ch-llm_top_p_value' },
        'llm_history_depth': { slider: 'ch-llm_history_depth', input: 'ch-llm_history_depth_value' },
        'InformationExtracted': { slider: 'InformationExtracted_range', input: 'InformationExtracted' },
        'ReferenceStrength': { slider: 'ReferenceStrength_range', input: 'ReferenceStrength' },
        'chatu8_fab_opacity': { slider: 'chatu8_fab_opacity', input: 'chatu8_fab_opacity_value' },
        'chatu8_fab_size': { slider: 'chatu8_fab_size', input: 'chatu8_fab_size_value' },
    };

    if (rangeMap[key]) {
        const { slider, input } = rangeMap[key];
        const sliderElement = document.getElementById(slider);
        const inputElement = document.getElementById(input);

        if (sliderElement && document.activeElement !== sliderElement) {
            sliderElement.value = value ?? '';
        }
        if (inputElement && document.activeElement !== inputElement) {
            inputElement.value = value ?? '';
        }
    }

    // 处理 LLM 配置档案中的 max_tokens
    if (key === 'llm_profiles') {
        const maxTokensSlider = document.getElementById('ch-llm_max_tokens');
        const maxTokensInput = document.getElementById('ch-llm_max_tokens_value');

        if (maxTokensSlider && maxTokensInput) {
            const settings = extension_settings[extensionName];
            const currentProfile = settings.llm_profiles?.[settings.current_llm_profile];
            if (currentProfile?.max_tokens !== undefined) {
                if (document.activeElement !== maxTokensSlider) {
                    maxTokensSlider.value = currentProfile.max_tokens;
                }
                if (document.activeElement !== maxTokensInput) {
                    maxTokensInput.value = currentProfile.max_tokens;
                }
            }
        }
    }
}
