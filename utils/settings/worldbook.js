// @ts-nocheck
import { extension_settings } from "../../../../../extensions.js";
import { saveSettingsDebounced, eventSource, event_types } from "../../../../../../script.js";
import { extensionName } from '../config.js';
import { stylInput, stylishConfirm } from '../ui_common.js';

// 用于跟踪是否已经初始化
let isWorldBookInitialized = false;

/**
 * 初始化世界书设置（仅绑定事件，只执行一次）
 */
export function initWorldBookSettings(container) {
    console.log('[WorldBook] Initializing world book settings...');

    // 确保配置存在
    ensureWorldBookSettings();

    // 只在第一次初始化时绑定事件
    if (!isWorldBookInitialized) {
        setupWorldBookControls(container);
        isWorldBookInitialized = true;
    }

    console.log('[WorldBook] World book settings initialized');
}

/**
 * 刷新世界书设置UI（每次进入标签页或需要更新时调用）
 */
export function refreshWorldBookSettings(container) {
    console.log('[WorldBook] Refreshing world book settings...');

    // 确保配置存在
    ensureWorldBookSettings();

    // 刷新预设列表和内容
    loadWorldBookPresetList();
    loadWorldBookPreset();

    console.log('[WorldBook] World book settings refreshed');
}

/**
 * 确保配置存在
 */
function ensureWorldBookSettings() {
    const settings = extension_settings[extensionName];

    // 初始化世界书预设
    if (!settings.worldBookList) {
        settings.worldBookList = { "默认添加末尾": { "content": "" } };
    }
    if (!settings.worldBookList_id) {
        settings.worldBookList_id = "默认添加末尾";
    }
}

/**
 * 设置世界书控件
 */
function setupWorldBookControls(container) {
    // 加载预设列表
    loadWorldBookPresetList();

    // 绑定预设选择
    container.find('#worldBookList_id').on('change', worldbook_change);

    // 绑定按钮
    container.find('#worldbook_update_style').on('click', worldbook_update);
    container.find('#worldbook_save_style').on('click', worldbook_save);
    container.find('#worldbook_delete_style').on('click', worldbook_delete);
    container.find('#worldbook_export_current').on('click', worldbook_export_current);
    container.find('#worldbook_export_all').on('click', worldbook_export_all);
    container.find('#worldbook_import').on('click', worldbook_import);

    // 绑定字段变化监听
    bindWorldBookFieldListeners();

    // 加载当前预设
    loadWorldBookPreset();

    // 绑定世界书事件监听器
    setupWorldBookEventListener();
}

/**
 * 加载世界书预设列表
 */
function loadWorldBookPresetList() {
    const settings = extension_settings[extensionName];
    const select = document.getElementById('worldBookList_id');

    if (!select) return;

    select.innerHTML = '';

    for (const presetName in settings.worldBookList) {
        const option = document.createElement('option');
        option.value = presetName;
        option.textContent = presetName;
        select.add(option);
    }

    select.value = settings.worldBookList_id;
}

/**
 * 加载世界书预设
 */
function loadWorldBookPreset() {
    const settings = extension_settings[extensionName];
    const select = document.getElementById('worldBookList_id');
    if (!select) return;

    const newPresetId = select.value;
    const currentPresetId = settings.worldBookList_id;

    // 检查是否有未保存的更改
    if (currentPresetId && currentPresetId !== newPresetId) {
        const currentPreset = settings.worldBookList[currentPresetId] || {};
        const textarea = document.getElementById('worldbook_content');

        if (textarea && textarea.value !== (currentPreset.content || '')) {
            stylishConfirm("您有未保存的世界书数据。要放弃这些更改并切换预设吗？").then(confirmed => {
                if (confirmed) {
                    settings.worldBookList_id = newPresetId;
                    loadWorldBookPresetData(newPresetId);
                    saveSettingsDebounced();
                } else {
                    select.value = currentPresetId;
                }
            });
            return;
        }
    }

    settings.worldBookList_id = newPresetId;
    loadWorldBookPresetData(newPresetId);
    saveSettingsDebounced();
}

/**
 * 加载世界书预设数据
 */
function loadWorldBookPresetData(presetId) {
    const settings = extension_settings[extensionName];
    const preset = settings.worldBookList[presetId];

    if (!preset) return;

    const textarea = document.getElementById('worldbook_content');
    if (textarea) {
        textarea.value = preset.content || '';
        // 隐藏未保存警告
        const warning = textarea.closest('.st-chatu8-field-col')?.querySelector('.st-chatu8-unsaved-warning');
        if (warning) $(warning).hide();
    }
}

/**
 * 预设切换事件
 */
function worldbook_change() {
    loadWorldBookPreset();
}

/**
 * 更新当前预设
 */
function worldbook_update() {
    const settings = extension_settings[extensionName];
    const presetId = settings.worldBookList_id;

    if (!presetId || !settings.worldBookList[presetId]) {
        alert("没有活动的世界书预设可保存。请先\"另存为\"一个新预设。");
        return;
    }

    stylishConfirm(`确定要覆盖当前世界书预设 "${presetId}" 吗？`).then(confirmed => {
        if (confirmed) {
            saveCurrentWorldBookData(presetId);
            alert(`世界书预设 "${presetId}" 已更新。`);
        }
    });
}

/**
 * 另存为新预设
 */
function worldbook_save() {
    stylInput("请输入新世界书预设的名称").then((result) => {
        if (result && result.trim() !== '') {
            const settings = extension_settings[extensionName];
            saveCurrentWorldBookData(result);
            settings.worldBookList_id = result;
            loadWorldBookPresetList();
            alert(`世界书预设 "${result}" 已保存。`);
        }
    });
}

/**
 * 保存当前世界书数据
 */
function saveCurrentWorldBookData(presetId) {
    const settings = extension_settings[extensionName];
    const textarea = document.getElementById('worldbook_content');

    if (textarea) {
        settings.worldBookList[presetId] = {
            content: textarea.value || ''
        };
        saveSettingsDebounced();

        // 隐藏未保存警告
        const warning = textarea.closest('.st-chatu8-field-col')?.querySelector('.st-chatu8-unsaved-warning');
        if (warning) $(warning).hide();
    }
}

/**
 * 删除预设
 */
function worldbook_delete() {
    const settings = extension_settings[extensionName];
    const selectElement = document.getElementById("worldBookList_id");
    const valueToDelete = selectElement.value;

    if (valueToDelete === "默认添加末尾") {
        alert("默认预设不能删除");
        return;
    }

    stylishConfirm("是否确定删除该世界书预设").then((result) => {
        if (result) {
            delete settings.worldBookList[valueToDelete];
            settings.worldBookList_id = "默认添加末尾";
            loadWorldBookPresetList();
            loadWorldBookPreset();
            saveSettingsDebounced();
        }
    });
}

/**
 * 导出当前预设
 */
function worldbook_export_current() {
    const settings = extension_settings[extensionName];
    const selectedId = settings.worldBookList_id;
    if (!selectedId || !settings.worldBookList[selectedId]) {
        alert("没有选中的世界书预设可导出。");
        return;
    }
    const dataToExport = { [selectedId]: settings.worldBookList[selectedId] };
    const dataStr = JSON.stringify(dataToExport, null, 2);
    const blob = new Blob([dataStr], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `st-chatu8-worldbook-${selectedId}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

/**
 * 导出所有预设
 */
function worldbook_export_all() {
    const settings = extension_settings[extensionName];
    if (!settings.worldBookList || Object.keys(settings.worldBookList).length === 0) {
        alert("没有世界书预设可导出。");
        return;
    }
    const dataStr = JSON.stringify(settings.worldBookList, null, 2);
    const blob = new Blob([dataStr], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "st-chatu8-worldbook-all.json";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

/**
 * 导入预设
 */
function worldbook_import() {
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
                        if (!settings.worldBookList.hasOwnProperty(key)) {
                            newPresetsCount++;
                        }
                        settings.worldBookList[key] = importedData[key];
                    }
                }
                saveSettingsDebounced();
                loadWorldBookPresetList();

                // 自动选择第一个导入的预设
                const firstImportedKey = Object.keys(importedData)[0];
                if (firstImportedKey) {
                    settings.worldBookList_id = firstImportedKey;
                    const select = document.getElementById('worldBookList_id');
                    if (select) select.value = firstImportedKey;
                    loadWorldBookPresetData(firstImportedKey);
                }

                alert(`成功导入 ${Object.keys(importedData).length} 个世界书预设,其中 ${newPresetsCount} 个是全新的。`);
            } catch (err) {
                alert("导入失败,请确保文件是正确的JSON格式。\n错误信息: " + err.message);
                console.error("Error importing world books:", err);
            }
        };
        reader.readAsText(file);
    };
    input.click();
}

/**
 * 绑定字段变化监听
 */
function bindWorldBookFieldListeners() {
    // 监听字段变化,显示/隐藏未保存警告
    const textarea = document.getElementById('worldbook_content');
    if (textarea) {
        $(textarea).on('input', function () {
            const settings = extension_settings[extensionName];
            const presetName = settings.worldBookList_id;
            const currentPreset = settings.worldBookList[presetName] || {};
            const isDirty = $(this).val() !== (currentPreset.content ?? '');
            const warning = $(this).closest('.st-chatu8-field-col').find('.st-chatu8-unsaved-warning');

            if (isDirty) {
                $(warning).show();
            } else {
                $(warning).hide();
            }
        });
    }
}

/**
 * 检测角色是否被触发文本匹配
 * @param {Object} character - 角色对象
 * @param {string} triggerText - 触发文本
 * @returns {boolean} 是否匹配
 */
/**
 * 标准化用于触发匹配的字符串：去掉所有空白（含全角空格）并转小写。
 * 保证中英文都忽略大小写与空格差异。
 */
function normalizeTriggerText(text) {
    if (!text || typeof text !== 'string') return '';
    return text.replace(/[\s\u3000]+/g, '').toLowerCase();
}

function isCharacterTriggered(character, triggerText) {
    if (!triggerText || !character) return false;

    const normalizedTrigger = normalizeTriggerText(triggerText);
    if (!normalizedTrigger) return false;

    // 检查中文名（支持用|分割的多个名称）
    if (character.nameCN) {
        const chineseNames = character.nameCN.split('|')
            .map(name => normalizeTriggerText(name))
            .filter(name => name);
        for (const name of chineseNames) {
            if (normalizedTrigger.includes(name)) {
                return true;
            }
        }
    }

    // 检查英文名（支持用|分割的多个名称）
    if (character.nameEN) {
        const englishNames = character.nameEN.split('|')
            .map(name => normalizeTriggerText(name))
            .filter(name => name);
        for (const name of englishNames) {
            if (normalizedTrigger.includes(name)) {
                return true;
            }
        }
    }

    return false;
}

/**
 * 获取角色被触发的具体名字
 * @param {Object} character - 角色对象
 * @param {string} triggerText - 触发文本
 * @returns {string|null} 触发的名字，未触发返回 null
 */
function getTriggeredCharacterName(character, triggerText) {
    if (!triggerText || !character) return null;

    const normalizedTrigger = normalizeTriggerText(triggerText);
    if (!normalizedTrigger) return null;

    // 优先检查中文名（支持用|分割的多个名称）
    if (character.nameCN) {
        const chineseNames = character.nameCN.split('|').map(name => name.trim()).filter(name => name);
        for (const name of chineseNames) {
            if (normalizedTrigger.includes(normalizeTriggerText(name))) {
                return name; // 返回原始中文名
            }
        }
    }

    // 检查英文名（支持用|分割的多个名称）
    if (character.nameEN) {
        const englishNames = character.nameEN.split('|').map(name => name.trim()).filter(name => name);
        for (const name of englishNames) {
            if (normalizedTrigger.includes(normalizeTriggerText(name))) {
                return name; // 返回原始英文名
            }
        }
    }

    return null;
}

/**
 * 面向设置 UI：检测 {{角色启用列表}} 在给定触发文本下会命中哪些角色。
 * 仅扫描当前启用预设里登记的角色，不走通用列表/全局兜底。
 * @param {string} triggerText
 * @returns {{ presetId: string, enabledCount: number, triggered: Array, notTriggered: Array, missing: string[] }}
 */
export function inspectCharacterListTrigger(triggerText) {
    const settings = extension_settings[extensionName] || {};
    const enablePresetId = settings.characterEnablePresetId || '';
    const enablePreset = settings.characterEnablePresets?.[enablePresetId];

    if (!enablePreset || !Array.isArray(enablePreset.characters)) {
        return { presetId: enablePresetId, enabledCount: 0, triggered: [], notTriggered: [], missing: [] };
    }

    const triggered = [];
    const notTriggered = [];
    const missing = [];

    for (const charId of enablePreset.characters) {
        const character = settings.characterPresets?.[charId];
        if (!character) {
            missing.push(charId);
            continue;
        }
        const hitName = getTriggeredCharacterName(character, triggerText || '');
        const entry = {
            presetId: charId,
            nameCN: character.nameCN || '',
            nameEN: character.nameEN || '',
            triggeredBy: hitName || ''
        };
        if (hitName) {
            triggered.push(entry);
        } else {
            notTriggered.push(entry);
        }
    }

    return {
        presetId: enablePresetId,
        enabledCount: enablePreset.characters.length,
        triggered,
        notTriggered,
        missing
    };
}

/**
 * 生成角色启用列表文本
 * @param {string} [triggerText] - 可选的触发文本，如果提供则只返回在触发文本中被提及的角色
 *                                  触发文本一般由 {{用户需求}} + {{上下文}} + {{世界书触发}} 组成
 * @returns {string} 角色列表文本
 */
export function generateCharacterListText(triggerText = null) {
    const settings = extension_settings[extensionName];

    // 获取当前角色启用预设
    const enablePresetId = settings.characterEnablePresetId;
    const enablePreset = settings.characterEnablePresets?.[enablePresetId];

    if (!enablePreset || !Array.isArray(enablePreset.characters) || enablePreset.characters.length === 0) {
        return '（暂无启用的角色）';
    }

    const characterList = [];

    // 遍历启用的角色
    for (const charId of enablePreset.characters) {
        const character = settings.characterPresets?.[charId];
        if (!character) continue;

        // 如果提供了触发文本，检查角色是否被触发
        if (triggerText !== null) {
            if (!isCharacterTriggered(character, triggerText)) {
                // 角色未被触发，跳过
                continue;
            }
        }

        const charInfo = [];

        // 中文名称
        if (character.nameCN) {
            charInfo.push(`中文名称：${character.nameCN}`);
        }

        // 英文名称
        if (character.nameEN) {
            const displayName = character.nameEN.split('|')[0].trim();
            charInfo.push(`英文名称：${displayName}`);
        }

        // 角色特征
        if (character.characterTraits) {
            charInfo.push(`角色特征：${character.characterTraits}`);
        }

        // 五官外貌（正面）
        if (character.facialFeatures) {
            charInfo.push(`五官外貌（正面）：${character.facialFeatures}`);
        }

        // 五官外貌（背面）
        if (character.facialFeaturesBack) {
            charInfo.push(`五官外貌（背面）：${character.facialFeaturesBack}`);
        }

        // 上半身SFW（正面）
        if (character.upperBodySFW) {
            charInfo.push(`上半身SFW（正面）：${character.upperBodySFW}`);
        }

        // 上半身SFW（背面）
        if (character.upperBodySFWBack) {
            charInfo.push(`上半身SFW（背面）：${character.upperBodySFWBack}`);
        }

        // 下半身SFW（正面）
        if (character.fullBodySFW) {
            charInfo.push(`下半身SFW（正面）：${character.fullBodySFW}`);
        }

        // 下半身SFW（背面）
        if (character.fullBodySFWBack) {
            charInfo.push(`下半身SFW（背面）：${character.fullBodySFWBack}`);
        }

        // 上半身NSFW（正面）
        if (character.upperBodyNSFW) {
            charInfo.push(`上半身NSFW（正面）：${character.upperBodyNSFW}`);
        }

        // 上半身NSFW（背面）
        if (character.upperBodyNSFWBack) {
            charInfo.push(`上半身NSFW（背面）：${character.upperBodyNSFWBack}`);
        }

        // 下半身NSFW（正面）
        if (character.fullBodyNSFW) {
            charInfo.push(`下半身NSFW（正面）：${character.fullBodyNSFW}`);
        }

        // 下半身NSFW（背面）
        if (character.fullBodyNSFWBack) {
            charInfo.push(`下半身NSFW（背面）：${character.fullBodyNSFWBack}`);
        }

        // 服装列表详细信息
        if (Array.isArray(character.outfits) && character.outfits.length > 0) {
            charInfo.push(`服装列表：`);

            for (const outfitId of character.outfits) {
                const outfit = settings.outfitPresets?.[outfitId];
                if (!outfit) continue;

                const outfitDetails = [];

                // 服装中文名称
                if (outfit.nameCN) {
                    outfitDetails.push(`\n  中文名称：${outfit.nameCN}`);
                }

                // 服装英文名称
                if (outfit.nameEN) {
                    const displayName = outfit.nameEN.split('|')[0].trim();
                    outfitDetails.push(`  英文名称：${displayName}`);
                }

                // 服装上半身（正面）
                if (outfit.upperBody) {
                    outfitDetails.push(`  上半身（正面）：${outfit.upperBody}`);
                }

                // 服装上半身（背面）
                if (outfit.upperBodyBack) {
                    outfitDetails.push(`  上半身（背面）：${outfit.upperBodyBack}`);
                }

                // 服装下半身（正面）
                if (outfit.fullBody) {
                    outfitDetails.push(`  下半身（正面）：${outfit.fullBody}`);
                }

                // 服装下半身（背面）
                if (outfit.fullBodyBack) {
                    outfitDetails.push(`  下半身（背面）：${outfit.fullBodyBack}`);
                }

                if (outfitDetails.length > 0) {
                    charInfo.push(outfitDetails.join('\n'));
                }
            }
        }

        if (charInfo.length > 0) {
            characterList.push(charInfo.join('\n'));
        }
    }

    return characterList.length > 0 ? characterList.join('\n\n') : '（暂无被触发的角色）';
}

/**
 * 生成通用服装启用列表文本
 */
export function generateOutfitEnableListText() {
    const settings = extension_settings[extensionName];

    // 获取当前通用服装列表预设
    const enablePresetId = settings.outfitEnablePresetId;
    const enablePreset = settings.outfitEnablePresets?.[enablePresetId];

    if (!enablePreset || !Array.isArray(enablePreset.outfits) || enablePreset.outfits.length === 0) {
        return '暂未配置通用服装';
    }

    const outfitList = [];

    // 遍历启用的服装，获取详细信息
    for (const outfitId of enablePreset.outfits) {
        const outfit = settings.outfitPresets?.[outfitId];
        if (!outfit) continue;

        const outfitInfo = [];

        // 中文名称
        if (outfit.nameCN) {
            outfitInfo.push(`中文名称：${outfit.nameCN}`);
        }

        // 英文名称
        if (outfit.nameEN) {
            const displayName = outfit.nameEN.split('|')[0].trim();
            outfitInfo.push(`英文名称：${displayName}`);
        }

        // 上半身（正面）
        if (outfit.upperBody) {
            outfitInfo.push(`上半身（正面）：${outfit.upperBody}`);
        }

        // 上半身（背面）
        if (outfit.upperBodyBack) {
            outfitInfo.push(`上半身（背面）：${outfit.upperBodyBack}`);
        }

        // 下半身（正面）
        if (outfit.fullBody) {
            outfitInfo.push(`下半身（正面）：${outfit.fullBody}`);
        }

        // 下半身（背面）
        if (outfit.fullBodyBack) {
            outfitInfo.push(`下半身（背面）：${outfit.fullBodyBack}`);
        }

        if (outfitInfo.length > 0) {
            outfitList.push(outfitInfo.join('\n'));
        }
    }

    return outfitList.join('\n\n');
}

/**
 * 生成通用角色启用列表文本
 */
export function generateCommonCharacterListText() {
    const settings = extension_settings[extensionName];

    // 获取当前通用角色列表预设
    const enablePresetId = settings.characterCommonPresetId;
    const enablePreset = settings.characterCommonPresets?.[enablePresetId];

    if (!enablePreset || !Array.isArray(enablePreset.characters) || enablePreset.characters.length === 0) {
        return '暂未配置通用角色';
    }

    const characterList = [];

    // 遍历启用的角色
    for (const charId of enablePreset.characters) {
        const character = settings.characterPresets?.[charId];
        if (!character) continue;

        const charInfo = [];

        // 中文名称
        if (character.nameCN) {
            charInfo.push(character.nameCN);
        }

        // 英文名称
        if (character.nameEN) {
            const displayName = character.nameEN.split('|')[0].trim();
            charInfo.push(displayName);
        }

        if (charInfo.length > 0) {
            characterList.push(charInfo.join(' '));
        }
    }

    return characterList.join('\n');
}

/**
 * 获取启用角色列表中需要发送图片的角色图片
 * @param {string} [triggerText] - 可选的触发文本，如果提供则只返回在触发文本中被提及的角色的图片
 * @returns {Promise<Array<{base64: string, name: string}>>} 图片数组
 */
export async function getEnabledCharacterImages(triggerText = null) {
    const { getConfigImage } = await import('../configDatabase.js');
    const settings = extension_settings[extensionName];

    // 获取当前角色启用预设
    const enablePresetId = settings.characterEnablePresetId;
    const enablePreset = settings.characterEnablePresets?.[enablePresetId];

    if (!enablePreset || !Array.isArray(enablePreset.characters) || enablePreset.characters.length === 0) {
        return [];
    }

    const collectedImages = [];

    // 遍历启用的角色
    for (const charId of enablePreset.characters) {
        const character = settings.characterPresets?.[charId];
        if (!character) continue;

        // 检查是否需要发送图片
        if (!character.sendPhoto) continue;

        // 如果提供了触发文本，检查角色是否被触发
        if (triggerText !== null) {
            if (!isCharacterTriggered(character, triggerText)) {
                continue;
            }
        }

        // 获取角色图片 - 使用选中的图片索引
        const imageIds = character.photoImageIds || [];
        if (imageIds.length > 0) {
            // 获取选中的图片索引，确保在有效范围内
            let selectedIndex = character.selectedPhotoIndex || 0;
            if (selectedIndex < 0 || selectedIndex >= imageIds.length) {
                selectedIndex = imageIds.length - 1;
            }
            const selectedImageId = imageIds[selectedIndex];
            try {
                const imageData = await getConfigImage(selectedImageId);
                if (imageData) {
                    // 优先使用触发的名字，若无触发文本则使用第一个名字
                    const triggeredName = triggerText ? getTriggeredCharacterName(character, triggerText) : null;
                    const label = triggeredName || character.nameCN?.split('|')[0] || character.nameEN?.split('|')[0] || charId;
                    collectedImages.push({
                        base64: imageData,
                        name: `${label} 的参考图片`
                    });
                }
            } catch (err) {
                console.error(`[WorldBook] Failed to get image ${selectedImageId} for character ${charId}:`, err);
            }
        }

        // 获取角色服装的图片 - 使用选中的图片索引
        if (Array.isArray(character.outfits)) {
            for (const outfitId of character.outfits) {
                const outfit = settings.outfitPresets?.[outfitId];
                if (!outfit || !outfit.sendPhoto) continue;

                const outfitImageIds = outfit.photoImageIds || [];
                if (outfitImageIds.length > 0) {
                    // 获取选中的图片索引，确保在有效范围内
                    let selectedOutfitIndex = outfit.selectedPhotoIndex || 0;
                    if (selectedOutfitIndex < 0 || selectedOutfitIndex >= outfitImageIds.length) {
                        selectedOutfitIndex = outfitImageIds.length - 1;
                    }
                    const selectedOutfitImageId = outfitImageIds[selectedOutfitIndex];
                    try {
                        const imageData = await getConfigImage(selectedOutfitImageId);
                        if (imageData) {
                            // 优先使用触发的名字
                            const triggeredCharName = triggerText ? getTriggeredCharacterName(character, triggerText) : null;
                            const charLabel = triggeredCharName || character.nameCN?.split('|')[0] || character.nameEN?.split('|')[0] || charId;
                            const outfitLabel = outfit.nameCN?.split('|')[0] || outfit.nameEN?.split('|')[0] || outfitId;
                            collectedImages.push({
                                base64: imageData,
                                name: `${charLabel} 的 ${outfitLabel} 服装参考图片`
                            });
                        }
                    } catch (err) {
                        console.error(`[WorldBook] Failed to get image ${selectedOutfitImageId} for outfit ${outfitId}:`, err);
                    }
                }
            }
        }
    }

    return collectedImages;
}

/**
 * 获取通用服装列表中需要发送图片的服装图片
 * @returns {Promise<Array<{base64: string, name: string}>>} 图片数组
 */
export async function getEnabledOutfitImages() {
    const { getConfigImage } = await import('../configDatabase.js');
    const settings = extension_settings[extensionName];

    // 获取当前通用服装列表预设
    const enablePresetId = settings.outfitEnablePresetId;
    const enablePreset = settings.outfitEnablePresets?.[enablePresetId];

    if (!enablePreset || !Array.isArray(enablePreset.outfits) || enablePreset.outfits.length === 0) {
        return [];
    }

    const collectedImages = [];

    // 遍历启用的服装
    for (const outfitId of enablePreset.outfits) {
        const outfit = settings.outfitPresets?.[outfitId];
        if (!outfit) continue;

        // 检查是否需要发送图片
        if (!outfit.sendPhoto) continue;

        // 获取服装图片 - 使用选中的图片索引
        const imageIds = outfit.photoImageIds || [];
        if (imageIds.length > 0) {
            // 获取选中的图片索引，确保在有效范围内
            let selectedIndex = outfit.selectedPhotoIndex || 0;
            if (selectedIndex < 0 || selectedIndex >= imageIds.length) {
                selectedIndex = imageIds.length - 1;
            }
            const selectedImageId = imageIds[selectedIndex];
            try {
                const imageData = await getConfigImage(selectedImageId);
                if (imageData) {
                    const label = outfit.nameCN || outfit.nameEN?.split('|')[0] || outfitId;
                    collectedImages.push({
                        base64: imageData,
                        name: `${label} 的参考图片`
                    });
                }
            } catch (err) {
                console.error(`[WorldBook] Failed to get image ${selectedImageId} for outfit ${outfitId}:`, err);
            }
        }
    }

    return collectedImages;
}

/**
 * 获取通用角色列表中需要发送图片的角色图片
 * @returns {Promise<Array<{base64: string, name: string}>>} 图片数组
 */
export async function getCommonCharacterImages() {
    const { getConfigImage } = await import('../configDatabase.js');
    const settings = extension_settings[extensionName];

    // 获取当前通用角色列表预设
    const enablePresetId = settings.characterCommonPresetId;
    const enablePreset = settings.characterCommonPresets?.[enablePresetId];

    if (!enablePreset || !Array.isArray(enablePreset.characters) || enablePreset.characters.length === 0) {
        return [];
    }

    const collectedImages = [];

    // 遍历启用的角色
    for (const charId of enablePreset.characters) {
        const character = settings.characterPresets?.[charId];
        if (!character) continue;

        // 检查是否需要发送图片
        if (!character.sendPhoto) continue;

        // 获取角色图片 - 使用选中的图片索引
        const imageIds = character.photoImageIds || [];
        if (imageIds.length > 0) {
            // 获取选中的图片索引，确保在有效范围内
            let selectedIndex = character.selectedPhotoIndex || 0;
            if (selectedIndex < 0 || selectedIndex >= imageIds.length) {
                selectedIndex = imageIds.length - 1;
            }
            const selectedImageId = imageIds[selectedIndex];
            try {
                const imageData = await getConfigImage(selectedImageId);
                if (imageData) {
                    const label = character.nameCN || character.nameEN?.split('|')[0] || charId;
                    collectedImages.push({
                        base64: imageData,
                        name: `${label} 的参考图片`
                    });
                }
            } catch (err) {
                console.error(`[WorldBook] Failed to get image ${selectedImageId} for character ${charId}:`, err);
            }
        }
    }

    return collectedImages;
}

/**
 * 设置世界书事件监听器
 */
export function setupWorldBookEventListener() {
    // Listen to WORLDINFO_ENTRIES_LOADED event to inject custom world book entries
    // eventSource.on(event_types.WORLDINFO_ENTRIES_LOADED, (data) => {
    //     const settings = extension_settings[extensionName];

    //     // Check if world book is enabled
    //     // if (String(settings.worldBookEnabled) !== 'true' || String(settings.scriptEnabled) !== 'true') {
    //     //     return;
    //     // }

    //     // Get current world book preset
    //     const worldBookId = settings.worldBookList_id;
    //     const worldBookPreset = settings.worldBookList?.[worldBookId];

    //     if (!worldBookPreset || !worldBookPreset.content || !worldBookPreset.content.trim()) {
    //         return;
    //     }

    //     // Create custom globalLore entry from world book content
    //     const customEntry = {
    //         uid: 999999,
    //         world: `st-chatu8-${worldBookId}`,
    //         key: [],
    //         keysecondary: [],
    //         comment: `来自 st-chatu8 世界书: ${worldBookId}`,
    //         content: worldBookPreset.content,
    //         constant: true,
    //         vectorized: false,
    //         selective: false,
    //         selectiveLogic: 0,
    //         addMemo: false,
    //         order: 1,
    //         position: 4,
    //         disable: false,
    //         ignoreBudget: false,
    //         excludeRecursion: false,
    //         preventRecursion: false,
    //         matchPersonaDescription: false,
    //         matchCharacterDescription: false,
    //         matchCharacterPersonality: false,
    //         matchCharacterDepthPrompt: false,
    //         matchScenario: false,
    //         matchCreatorNotes: false,
    //         delayUntilRecursion: false,
    //         probability: 100,
    //         useProbability: false,
    //         depth: 0,
    //         outletName: "",
    //         group: "",
    //         groupOverride: false,
    //         groupWeight: 100,
    //         scanDepth: null,
    //         caseSensitive: null,
    //         matchWholeWords: null,
    //         useGroupScoring: null,
    //         automationId: "",
    //         role: 0,
    //         sticky: 0,
    //         cooldown: 0,
    //         delay: 0,
    //         triggers: [],
    //         displayIndex: 0
    //     };

    //     // Insert custom entry into globalLore
    //     if (data && Array.isArray(data.globalLore)) {
    //         data.globalLore.unshift(customEntry);
    //     }
    // });

    // Listen to WORLDINFO_ENTRIES_LOADED event to replace character list placeholders
    eventSource.on(event_types.WORLDINFO_ENTRIES_LOADED, (data) => {
        const settings = extension_settings[extensionName];

        // Generate character list text
        const characterListText = generateCharacterListText();
        const outfitEnableListText = generateOutfitEnableListText();
        const commonCharacterListText = generateCommonCharacterListText();

        console.log('[WorldBook] Character list text:', characterListText);
        console.log('[WorldBook] Outfit enable list text:', outfitEnableListText);
        console.log('[WorldBook] Common character list text:', commonCharacterListText);

        // Process all entries in globalLore
        if (data && Array.isArray(data.globalLore)) {
            for (const entry of data.globalLore) {
                if (entry.content && typeof entry.content === 'string') {
                    // Replace {{角色启用列表}} with generated character list
                    if (entry.content.includes('{{角色启用列表}}')) {
                        entry.content = entry.content.replace(/\{\{角色启用列表\}\}/g, characterListText);
                    }
                    // Replace {{通用服装启用列表}} with generated outfit enable list
                    if (entry.content.includes('{{通用服装启用列表}}')) {
                        entry.content = entry.content.replace(/\{\{通用服装启用列表\}\}/g, outfitEnableListText);
                    }
                    // Replace {{通用角色启用列表}} with generated common character list
                    if (entry.content.includes('{{通用角色启用列表}}')) {
                        entry.content = entry.content.replace(/\{\{通用角色启用列表\}\}/g, commonCharacterListText);
                    }
                }
            }
        }

        // Process all entries in charLore
        if (data && Array.isArray(data.charLore)) {
            for (const entry of data.charLore) {
                if (entry.content && typeof entry.content === 'string') {
                    // Replace {{角色启用列表}} with generated character list
                    if (entry.content.includes('{{角色启用列表}}')) {
                        entry.content = entry.content.replace(/\{\{角色启用列表\}\}/g, characterListText);
                    }
                    // Replace {{通用服装启用列表}} with generated outfit enable list
                    if (entry.content.includes('{{通用服装启用列表}}')) {
                        entry.content = entry.content.replace(/\{\{通用服装启用列表\}\}/g, outfitEnableListText);
                    }
                    // Replace {{通用角色启用列表}} with generated common character list
                    if (entry.content.includes('{{通用角色启用列表}}')) {
                        entry.content = entry.content.replace(/\{\{通用角色启用列表\}\}/g, commonCharacterListText);
                    }
                }
            }
        }

        console.log('[WorldBook] Processed globalLore and charLore entries', JSON.stringify(data));

    });
}

/**
 * 向后兼容的旧版初始化函数
 */
export function initWorldBookControls(settingsModal) {
    initWorldBookSettings(settingsModal);
}
