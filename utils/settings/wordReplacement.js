import { extension_settings } from "../../../../../extensions.js";
import { saveSettingsDebounced } from "../../../../../../script.js";
import { extensionName } from "../config.js";
import { stylInput } from '../ui_common.js';

// ==================== DOM 元素缓存 ====================

let wrProfileSelect, wrTextEditor, wrAiEditor;

// ==================== 核心替换函数 ====================

/**
 * 对正则特殊字符进行转义
 * @param {string} str - 待转义的字符串
 * @returns {string} 转义后的字符串
 */
function escapeRegexChars(str) {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * 解析替换规则文本为规则数组
 * @param {string} rulesText - 多行的 "词汇1=词汇2" 文本
 * @returns {Array<{find: string, replace: string}>} 规则数组
 */
function parseRules(rulesText) {
    if (!rulesText || typeof rulesText !== 'string') return [];

    const rules = [];
    const lines = rulesText.split('\n');

    for (const line of lines) {
        const trimmedLine = line.trim();
        if (!trimmedLine) continue;

        // 按第一个 = 分割
        const eqIndex = trimmedLine.indexOf('=');
        if (eqIndex === -1) continue; // 没有 = 号则跳过

        const find = trimmedLine.substring(0, eqIndex);
        const replace = trimmedLine.substring(eqIndex + 1);

        if (!find) continue; // 左侧为空则跳过

        rules.push({ find, replace });
    }

    return rules;
}

/**
 * 应用词汇替换
 * @param {string} text - 待处理的文本
 * @param {'text' | 'ai'} type - 替换类型：text=正文替换, ai=AI返回替换
 * @returns {string} 替换后的文本
 */
export function applyWordReplacement(text, type) {
    if (!text || typeof text !== 'string') return text;

    const settings = extension_settings[extensionName];
    if (!settings) return text;

    // 获取当前词汇替换预设
    const profiles = settings.word_replacement_profiles;
    if (!profiles) return text;

    const currentProfileName = settings.current_word_replacement_profile;
    if (!currentProfileName) return text;

    const profile = profiles[currentProfileName];
    if (!profile) return text;

    // 根据类型选择规则文本
    const rulesText = type === 'ai' ? profile.aiReplacement : profile.textReplacement;
    if (!rulesText) return text;

    const rules = parseRules(rulesText);
    if (rules.length === 0) return text;

    // 逐条执行替换
    let result = text;
    for (const rule of rules) {
        try {
            const escaped = escapeRegexChars(rule.find);
            const regex = new RegExp(escaped, 'g');
            result = result.replace(regex, rule.replace);
        } catch (e) {
            console.warn(`[st-chatu8] 词汇替换规则执行失败: "${rule.find}" -> "${rule.replace}"`, e);
        }
    }

    return result;
}

// ==================== 预设管理函数 ====================

/**
 * 确保词汇替换预设存在
 */
function ensureProfiles() {
    const settings = extension_settings[extensionName];
    if (!settings.word_replacement_profiles) {
        settings.word_replacement_profiles = {
            "默认": {
                textReplacement: "肉棒=🥒\n小穴=🌸\n女孩=♀👶🏻\n少女=♀🧒🏻\n男孩=♂👶🏻\n正太=♂👶🏻\n小孩子=👧🏻\n乱伦=⚠️💘\n色情=🔞\n岁=🎄\n小学=🏬\n小学生=🧒🏻\n女儿=👧🏼\n儿子=👦🏼",
                aiReplacement: "sf_=\nsafe_="
            }
        };
    }
    if (!settings.current_word_replacement_profile) {
        settings.current_word_replacement_profile = "默认";
    }
}

/**
 * 加载预设到下拉列表
 */
function loadWRProfiles() {
    ensureProfiles();
    const settings = extension_settings[extensionName];
    const profiles = settings.word_replacement_profiles;
    const currentName = settings.current_word_replacement_profile;

    wrProfileSelect.empty();
    Object.keys(profiles).forEach(name => {
        const option = new Option(name, name, name === currentName, name === currentName);
        wrProfileSelect.append(option);
    });

    if (wrProfileSelect.val()) {
        wrProfileSelect.trigger('change');
    }
}

/**
 * 切换预设时填充编辑器
 */
function onWRProfileSelectChange() {
    const profileName = $(this).val();
    if (!profileName) return;

    const settings = extension_settings[extensionName];
    const profiles = settings.word_replacement_profiles;
    const profile = profiles[profileName];

    if (profile) {
        wrTextEditor.val(profile.textReplacement || '');
        wrAiEditor.val(profile.aiReplacement || '');
        settings.current_word_replacement_profile = profileName;
        saveSettingsDebounced();
    }
}

/**
 * 保存当前编辑器内容到预设
 */
function onWRSaveProfile() {
    const profileName = wrProfileSelect.val();
    if (!profileName) {
        toastr.warning("没有选中的配置。");
        return;
    }

    const settings = extension_settings[extensionName];
    const profiles = settings.word_replacement_profiles;

    profiles[profileName] = {
        textReplacement: wrTextEditor.val(),
        aiReplacement: wrAiEditor.val()
    };

    saveSettingsDebounced();
    toastr.success(`词汇替换配置 "${profileName}" 已保存。`);
}

/**
 * 新建预设
 */
function onWRNewProfile() {
    stylInput("请输入新的词汇替换配置名称").then((newName) => {
        if (!newName || newName.trim() === '') return;

        const settings = extension_settings[extensionName];
        const profiles = settings.word_replacement_profiles;

        if (profiles[newName]) {
            toastr.error(`配置 "${newName}" 已存在。`);
            return;
        }

        profiles[newName] = {
            textReplacement: '',
            aiReplacement: ''
        };
        settings.current_word_replacement_profile = newName;
        saveSettingsDebounced();
        loadWRProfiles();
        toastr.success(`空配置 "${newName}" 已创建并选中。`);
    });
}

/**
 * 重命名预设
 */
function onWRRenameProfile() {
    const currentName = wrProfileSelect.val();
    if (!currentName) {
        toastr.warning("没有活动的配置可重命名。");
        return;
    }
    if (currentName === "默认" || currentName === "default") {
        toastr.warning("默认配置不能重命名。");
        return;
    }

    stylInput("请输入新的配置名称", currentName).then((newName) => {
        if (newName && newName.trim() !== '' && newName !== currentName) {
            const settings = extension_settings[extensionName];
            const profiles = settings.word_replacement_profiles;

            if (profiles[newName]) {
                toastr.error(`配置 "${newName}" 已存在，请换一个名称。`);
                return;
            }

            profiles[newName] = profiles[currentName];
            delete profiles[currentName];

            settings.current_word_replacement_profile = newName;
            saveSettingsDebounced();
            loadWRProfiles();
            toastr.success(`配置已重命名为 "${newName}"`);
        }
    });
}

/**
 * 删除预设
 */
function onWRDeleteProfile() {
    const profileName = wrProfileSelect.val();
    if (!profileName) {
        toastr.warning("没有选中的配置。");
        return;
    }

    const settings = extension_settings[extensionName];
    if (Object.keys(settings.word_replacement_profiles).length <= 1) {
        toastr.error("不能删除最后一个配置。");
        return;
    }

    if (confirm(`你确定要删除词汇替换配置 "${profileName}" 吗？`)) {
        delete settings.word_replacement_profiles[profileName];
        settings.current_word_replacement_profile = Object.keys(settings.word_replacement_profiles)[0];
        saveSettingsDebounced();
        loadWRProfiles();
        toastr.success(`配置 "${profileName}" 已删除。`);
    }
}

/**
 * 导出预设
 */
function onWRExportProfile() {
    const profileName = wrProfileSelect.val();
    if (!profileName) {
        toastr.warning("没有选中的配置可导出。");
        return;
    }

    const settings = extension_settings[extensionName];
    const profile = settings.word_replacement_profiles[profileName];
    const exportData = { [profileName]: profile };

    const blob = new Blob([JSON.stringify(exportData, null, 4)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `st_chatu8_word_replace_${profileName}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    toastr.success(`已导出词汇替换配置: ${profileName}`);
}

/**
 * 导入预设
 */
function onWRImportProfile() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.onchange = (event) => {
        const file = event.target.files[0];
        if (file) {
            const reader = new FileReader();
            reader.onload = (e) => {
                try {
                    const importedProfiles = JSON.parse(e.target.result);
                    const settings = extension_settings[extensionName];
                    let importedCount = 0;

                    for (const name in importedProfiles) {
                        if (Object.prototype.hasOwnProperty.call(importedProfiles, name)) {
                            const profile = importedProfiles[name];
                            // 验证导入数据格式
                            if (typeof profile === 'object' && profile !== null) {
                                settings.word_replacement_profiles[name] = {
                                    textReplacement: profile.textReplacement || '',
                                    aiReplacement: profile.aiReplacement || ''
                                };
                                importedCount++;
                            }
                        }
                    }

                    saveSettingsDebounced();
                    loadWRProfiles();
                    toastr.success(`成功导入 ${importedCount} 个词汇替换配置。`);
                } catch (error) {
                    toastr.error("导入失败，文件格式无效。");
                }
            };
            reader.readAsText(file);
        }
    };
    input.click();
}

// ==================== 初始化 ====================

/**
 * 初始化词汇替换设置
 */
export function initWordReplacementSettings() {
    // 缓存 DOM 元素
    wrProfileSelect = $('#ch-word-replace-profile-select');
    wrTextEditor = $('#ch-word-replace-text-editor');
    wrAiEditor = $('#ch-word-replace-ai-editor');

    // 绑定事件
    wrProfileSelect.on('change', onWRProfileSelectChange);
    $('#ch-new-word-replace-profile-button').on('click', onWRNewProfile);
    $('#ch-rename-word-replace-profile-button').on('click', onWRRenameProfile);
    $('#ch-save-word-replace-profile-button').on('click', onWRSaveProfile);
    $('#ch-import-word-replace-profile-button').on('click', onWRImportProfile);
    $('#ch-export-word-replace-profile-button').on('click', onWRExportProfile);
    $('#ch-delete-word-replace-profile-button').on('click', onWRDeleteProfile);

    // 加载预设
    loadWRProfiles();
}
