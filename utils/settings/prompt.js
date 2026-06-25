// @ts-nocheck
import { extension_settings } from "../../../../../extensions.js";
import { saveSettingsDebounced } from "../../../../../../script.js";
import { extensionName } from '../config.js';
import { getSuffix, stylInput, stylishConfirm } from '../ui_common.js';
import { parsePromptStringWithCoordinates } from '../utils.js';
import { dbs } from '../database.js';
import { callTranslation, parseTranslationResult, tagsToJsonString } from '../ai.js';
import { showPresetVisualSelector } from './presetVisualSelector.js';
import { getConfigImage, saveConfigImage } from '../configDatabase.js';
import { calculateNovelAITokens, getNovelAIQualityPresetsText } from '../novelaiTokenCalculator.js';


export const generationTabs = ['sd', 'novelai', 'comfyui'];

// Translation helpers
function stripChineseAnnotations(text) {
    if (!text) return '';
    // 移除所有中文全角括号及其中内容（例如： （一个女孩））
    return text.replace(/（[^）]*）/g, '');
}
// parseTranslationResult 已从 ai.js 导入
async function translateAndAnnotateField(fieldBase, suffix) {
    const textarea = document.getElementById(fieldBase + suffix);
    if (!textarea) return;
    const button = document.getElementById(`translate_${fieldBase}${suffix}`);
    try {
        if (button) {
            button.disabled = true;
            const icon = button.querySelector('i');
            if (icon) {
                icon.classList.remove('fa-language');
                icon.classList.add('fa-spinner', 'fa-spin');
            }
        }
        const originalVal = textarea.value || '';
        // 清理旧中文注释并统一分隔符
        const cleaned = stripChineseAnnotations(originalVal).replace(/，/g, ',').replace(/[\r\n]+/g, ',');

        // 智能分割函数，保护 $...$ 包裹的标记不被拆分
        const smartSplitForTranslation = (text) => {
            const result = [];
            let current = '';
            let insideDollar = false;
            for (let i = 0; i < text.length; i++) {
                const char = text[i];
                if (char === '$') {
                    insideDollar = !insideDollar;
                    current += char;
                } else if ((char === ',' || char === '，') && !insideDollar) {
                    const trimmed = current.trim();
                    if (trimmed) result.push(trimmed);
                    current = '';
                } else {
                    current += char;
                }
            }
            if (current.trim()) result.push(current.trim());
            return result;
        };

        // 检查标签是否应该跳过翻译（$...$ 包裹的角色/服装预设）
        const shouldSkipTag = (tag) => {
            return tag.startsWith('$') && tag.endsWith('$');
        };

        // 清理符号函数：移除 {}[]() 和权重数字
        const cleanTagForTranslation = (tag) => {
            return tag
                .replace(/^[\{\[\(\<]+|[\}\]\)\>]+$/g, '')  // 移除首尾的括号
                .replace(/^\{+|\}+$/g, '')  // 再次确保移除花括号
                .replace(/:[\d.]+$/, '')  // 移除末尾权重如 :0.8
                .trim();
        };

        // 组装待翻译的英文标签列表
        let tokens = [];
        if (cleaned.includes('Scene Composition')) {
            // 分角色提示词：用 parsePromptStringWithCoordinates 解析
            const parsed = parsePromptStringWithCoordinates(cleaned);
            const keys = [
                'Scene Composition',
                'Character 1 Prompt', 'Character 1 UC',
                'Character 2 Prompt', 'Character 2 UC',
                'Character 3 Prompt', 'Character 3 UC',
                'Character 4 Prompt', 'Character 4 UC'
            ];
            keys.forEach(k => {
                const v = parsed?.[k];
                if (typeof v === 'string' && v.trim()) {
                    // 使用智能分割，保护 $...$ 标签
                    smartSplitForTranslation(v).forEach(t => {
                        // 跳过 $...$ 包裹的标签（角色/服装预设）
                        if (t && !shouldSkipTag(t)) {
                            tokens.push(t);
                        }
                    });
                }
            });
        } else {
            // 普通模式 - 智能分割，保护 $...$ 包裹的标记不被拆分
            tokens = smartSplitForTranslation(cleaned).filter(t => !shouldSkipTag(t));
        }

        // 去重
        tokens = Array.from(new Set(tokens));
        if (tokens.length === 0) {
            toastr.info('没有可翻译的标签。');
            return;
        }

        // 创建原始 tag 到清理后 tag 的映射
        const cleanedTokensForAI = [];
        for (const t of tokens) {
            const cleanedTag = cleanTagForTranslation(t);
            if (cleanedTag) {
                cleanedTokensForAI.push(cleanedTag);
            }
        }

        // 使用清理后的 token 发送给 AI
        const textToTranslate = tagsToJsonString(Array.from(new Set(cleanedTokensForAI)));

        // 发起翻译请求
        const response = await callTranslation(textToTranslate);
        const map = parseTranslationResult(response);

        // 使用智能分割函数分割原始内容，保护 $...$ 标记
        const originalTokens = smartSplitForTranslation(cleaned);
        const annotatedTokens = originalTokens.map(t => {
            // 跳过 $...$ 包裹的标记（角色/服装预设）
            if (t.startsWith('$') && t.endsWith('$')) {
                return t;
            }
            // 用清理后的 key 去匹配
            const cleanedKey = cleanTagForTranslation(t);
            if (map[cleanedKey]) {
                return `${t}（${map[cleanedKey]}）`;
            }
            // 也尝试直接匹配
            if (map[t]) {
                return `${t}（${map[t]}）`;
            }
            return t;
        });
        let annotated = annotatedTokens.join(', ');

        // 检测 NovelAI 分角色格式，在关键词前添加换行符提高可读性
        const novelaiKeywords = [
            'Scene Composition:',
            'Character 1 Prompt:', 'Character 1 UC:', 'Character 1 coordinates:',
            'Character 2 Prompt:', 'Character 2 UC:', 'Character 2 coordinates:',
            'Character 3 Prompt:', 'Character 3 UC:', 'Character 3 coordinates:',
            'Character 4 Prompt:', 'Character 4 UC:', 'Character 4 coordinates:'
        ];
        const hasNovelAIFormat = novelaiKeywords.some(kw => annotated.includes(kw));
        if (hasNovelAIFormat) {
            for (const keyword of novelaiKeywords) {
                // 在关键词前添加换行，但避免在开头添加多余换行
                // 不使用 lookbehind 以兼容 iOS Safari < 16.4：用 offset 回调判断是否在开头
                const escaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                annotated = annotated.replace(new RegExp(`\\s*${escaped}`, 'g'), (match, offset) => offset === 0 ? match : `\n\n${keyword}`);
            }
            // 清理可能产生的多余空白
            annotated = annotated.replace(/^\s+/, '').replace(/\n{3,}/g, '\n\n');
        }

        textarea.value = annotated;
        $(textarea).trigger('input'); // 触发未保存提示刷新
        toastr.success('翻译完成');
    } catch (e) {
        console.error('Tag translation failed:', e);
        alert(`翻译失败：${e.message || e}`);
    } finally {
        if (button) {
            button.disabled = false;
            const icon = button.querySelector('i');
            if (icon) {
                icon.classList.remove('fa-spinner', 'fa-spin');
                icon.classList.add('fa-language');
            }
        }
    }
}

// --- Autocomplete Logic ---

async function handleAutocomplete(inputEl, resultsEl) {
    const text = inputEl.value;
    const cursorPosition = inputEl.selectionStart;

    // 找到光标前后的逗号位置
    const textBeforeCursor = text.substring(0, cursorPosition);
    const textAfterCursor = text.substring(cursorPosition);

    const lastCommaBefore = Math.max(textBeforeCursor.lastIndexOf(','), textBeforeCursor.lastIndexOf('，'));
    const nextCommaAfter = textAfterCursor.search(/[,，]/);

    const startIndex = lastCommaBefore + 1;
    const endIndex = nextCommaAfter !== -1 ? cursorPosition + nextCommaAfter : text.length;

    const query = text.substring(startIndex, endIndex).trim();

    if (query.length < 1) {
        resultsEl.style.display = 'none';
        return;
    }

    try {
        // 从设置中读取搜索选项
        const settings = extension_settings[extensionName];
        const startsWith = String(settings.vocabulary_search_startswith) === 'true';
        const limit = parseInt(settings.vocabulary_search_limit, 10);
        const sortBy = settings.vocabulary_search_sort;

        const results = await dbs.searchTags(query, { startsWith, limit, sortBy });
        resultsEl.innerHTML = '';

        if (results.length > 0) {
            results.forEach(tag => {
                const item = document.createElement('div');
                item.className = 'ch-autocomplete-item';
                item.textContent = `${tag.name} (${tag.translation})`;
                item.addEventListener('click', () => handleResultClick(inputEl, resultsEl, tag));
                resultsEl.appendChild(item);
            });
            resultsEl.style.display = 'block';
        } else {
            resultsEl.style.display = 'none';
        }
    } catch (error) {
        console.error('Tag search failed:', error);
        resultsEl.style.display = 'none';
    }
}

function handleResultClick(inputEl, resultsEl, tag) {
    const text = inputEl.value;
    const cursorPosition = inputEl.selectionStart;

    // 找到光标前后的逗号位置
    const textBeforeCursor = text.substring(0, cursorPosition);
    const textAfterCursor = text.substring(cursorPosition);

    const lastCommaBefore = Math.max(textBeforeCursor.lastIndexOf(','), textBeforeCursor.lastIndexOf('，'));
    const nextCommaAfter = textAfterCursor.search(/[,，]/);

    const startIndex = lastCommaBefore + 1;
    const endIndex = nextCommaAfter !== -1 ? cursorPosition + nextCommaAfter : text.length;

    // The 'tag' parameter is now the full tag object
    const newTagText = `${tag.name}（${tag.translation}）`;

    // 构建新文本
    const textBefore = text.substring(0, startIndex);
    const textAfter = text.substring(endIndex);

    // 保留前导空格
    const leadingSpace = text.substring(startIndex, startIndex + 1) === ' ' ? ' ' : '';

    // 检查后面是否有内容，如果有且不是逗号开头则添加逗号
    const trimmedTextAfter = textAfter.trim();
    const trailingComma = trimmedTextAfter.length > 0 && !trimmedTextAfter.startsWith(',') ? ', ' : '';

    const newText = `${textBefore.trim() ? textBefore : ''}${leadingSpace}${newTagText}${trailingComma}${textAfter.trim() ? textAfter : ''}`;

    // 转换中文逗号为英文逗号
    inputEl.value = newText.replace(/，/g, ',');
    resultsEl.style.display = 'none';
    inputEl.focus();

    // 设置光标位置到插入的 tag 之后
    const newCursorPosition = (textBefore + leadingSpace + newTagText + trailingComma).length;
    setTimeout(() => inputEl.setSelectionRange(newCursorPosition, newCursorPosition), 0);
}

export function initPromptSettings(settingsModal, settings) {
    // Close autocomplete on outside click
    document.addEventListener('click', (event) => {
        if (!event.target.closest('.st-chatu8-field-col')) {
            $('.ch-autocomplete-results').hide();
        }
    });

    // Bind events for duplicated prompt controls
    generationTabs.forEach(mode => {
        const suffix = getSuffix(mode);
        settingsModal.find(`#yusheid${suffix}`).on('change', () => st_chatu8_tishici_change(mode, settings));
        settingsModal.find(`#st_chatu8_tishici_new${suffix}`).on('click', () => st_chatu8_tishici_new(mode, settings)); // New
        settingsModal.find(`#st_chatu8_tishici_rename${suffix}`).on('click', () => st_chatu8_tishici_rename(mode, settings)); // Rename
        settingsModal.find(`#st_chatu8_tishici_save_style${suffix}`).on('click', () => st_chatu8_tishici_save(mode, settings)); // Save As
        settingsModal.find(`#st_chatu8_tishici_update_style${suffix}`).on('click', () => st_chatu8_tishici_update(mode, settings)); // Save
        settingsModal.find(`#st_chatu8_tishici_delete_style${suffix}`).on('click', () => st_chatu8_tishici_delete(mode, settings));
        settingsModal.find(`#st_chatu8_tishici_export_current${suffix}`).on('click', () => st_chatu8_tishici_export_current(settings));
        settingsModal.find(`#st_chatu8_tishici_export_all${suffix}`).on('click', () => st_chatu8_tishici_export_all(settings));
        settingsModal.find(`#st_chatu8_tishici_import${suffix}`).on('click', () => st_chatu8_tishici_import(settings));

        // 绑定可视化选择按钮
        settingsModal.find(`#st_chatu8_tishici_visual_select${suffix}`).on('click', () => {
            showPresetVisualSelector(mode, settings, (presetName) => {
                // 更新下拉框并触发 change 事件
                const selectElement = document.getElementById('yusheid' + suffix);
                if (selectElement) {
                    selectElement.value = presetName;
                    $(selectElement).trigger('change');
                }
            });
        });

        // Show/hide warning on input change, instead of saving immediately
        const promptTextareas = [`#fixedPrompt${suffix}`, `#fixedPrompt_end${suffix}`, `#negativePrompt${suffix}`];

        promptTextareas.forEach(selector => {
            const textarea = $(selector)[0];
            const resultsContainer = $(`${selector}-results`)[0];
            if (textarea && resultsContainer) {
                $(textarea).on('input', () => handleAutocomplete(textarea, resultsContainer));
                // Prevent closing when clicking on the textarea itself
                $(textarea).on('click', (event) => event.stopPropagation());
            }
        });

        $(`#fixedPrompt${suffix}, #fixedPrompt_end${suffix}, #negativePrompt${suffix}`).on('input', function () {
            const yusheIdKey = `yusheid${mode === 'sd' ? '_sd' : suffix}`;
            const presetName = settings[yusheIdKey];
            const currentPreset = settings.yushe[presetName] || {};
            const field = $(this).attr('id').replace(suffix, '');
            const isDirty = $(this).val() !== (currentPreset[field] ?? '');
            const warning = $(this).closest('.st-chatu8-field-col').find('.st-chatu8-unsaved-warning');

            if (isDirty) {
                $(warning).show();
            } else {
                $(warning).hide();
            }
        });

        // 绑定翻译按钮（固定正面提示词、后置固定正面提示词）
        settingsModal.find(`#translate_fixedPrompt${suffix}`).on('click', () => translateAndAnnotateField('fixedPrompt', suffix));
        settingsModal.find(`#translate_fixedPrompt_end${suffix}`).on('click', () => translateAndAnnotateField('fixedPrompt_end', suffix));
        
        // NovelAI 专属的 Token 实时计算逻辑
        if (mode === 'novelai') {
            const updateTokens = async () => {
                const fixedPromptEl = document.getElementById(`fixedPrompt${suffix}`);
                const fixedPromptEndEl = document.getElementById(`fixedPrompt_end${suffix}`);
                const negativePromptEl = document.getElementById(`negativePrompt${suffix}`);
                
                const presetsText = getNovelAIQualityPresetsText(extension_settings[extensionName]);
                
                if (fixedPromptEl && fixedPromptEndEl) {
                    const t1 = await calculateNovelAITokens(fixedPromptEl.value);
                    const t2 = await calculateNovelAITokens(fixedPromptEndEl.value);
                    const tPresetAQT = await calculateNovelAITokens(presetsText.aqt);
                    const totalTokens = t1 + t2 + tPresetAQT;
                    
                    const fixedTokensDisplay = document.getElementById('novelai_fixedPrompt_tokens');
                    if (fixedTokensDisplay) {
                        fixedTokensDisplay.textContent = `当前占用: ${t1} | 总占用: ${totalTokens} / 512`;
                    }
                    
                    const fixedEndTokensDisplay = document.getElementById('novelai_fixedPrompt_end_tokens');
                    if (fixedEndTokensDisplay) {
                        fixedEndTokensDisplay.textContent = `当前占用: ${t2} | 总占用: ${totalTokens} / 512`;
                    }
                }
                
                if (negativePromptEl) {
                    const negTokens = await calculateNovelAITokens(negativePromptEl.value);
                    const tPresetUCP = await calculateNovelAITokens(presetsText.ucp);
                    const totalNegTokens = negTokens + tPresetUCP;
                    const negativeTokensDisplay = document.getElementById('novelai_negativePrompt_tokens');
                    if (negativeTokensDisplay) {
                        negativeTokensDisplay.textContent = `当前占用: ${negTokens} | 总占用: ${totalNegTokens} / 512`;
                    }
                }
            };
            
            // 使用简单的防抖避免频繁计算
            let tokenCalcTimeout;
            const debouncedUpdateTokens = () => {
                clearTimeout(tokenCalcTimeout);
                tokenCalcTimeout = setTimeout(updateTokens, 300);
            };
            
            $(`#fixedPrompt${suffix}, #fixedPrompt_end${suffix}, #negativePrompt${suffix}`).on('input', debouncedUpdateTokens);
            $(`#AQT_novelai, #UCP_novelai`).on('change', debouncedUpdateTokens);
            
            // 初始化执行一次，增加多阶延迟确保在各种缓慢加载情况下都能正确计算
            setTimeout(debouncedUpdateTokens, 200);
            setTimeout(debouncedUpdateTokens, 800);
            setTimeout(debouncedUpdateTokens, 2000);
        }
    });
}

function st_chatu8_tishici_change(mode, settings) {
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

        if (mode === 'novelai') {
            // 切换预设后更新 token 显示
            $(`#fixedPrompt${suffix}`).trigger('input');
        }
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

function st_chatu8_tishici_new(mode, settings) {
    const suffix = getSuffix(mode);
    const yusheIdKey = `yusheid${mode === 'sd' ? '_sd' : suffix}`;
    
    stylInput("请输入新预设的名称").then((newName) => {
        if (newName && newName.trim() !== '') {
            if (settings.yushe[newName]) {
                alert("该名称已存在，请换一个名称。");
                return;
            }
            settings.yushe[newName] = { fixedPrompt: "", fixedPrompt_end: "", negativePrompt: "" };
            settings[yusheIdKey] = newName;
            saveSettingsDebounced();
            window.loadSilterTavernChatu8Settings();
            toastr.success(`已创建空预设 "${newName}"`);
        }
    });
}

function st_chatu8_tishici_rename(mode, settings) {
    const suffix = getSuffix(mode);
    const yusheIdKey = `yusheid${mode === 'sd' ? '_sd' : suffix}`;
    const currentName = settings[yusheIdKey];
    
    if (currentName === "默认" || !settings.yushe[currentName]) {
        alert("默认预设或不存在的预设不能重命名。");
        return;
    }
    
    stylInput("请输入新的预设名称", currentName).then((newName) => {
        if (newName && newName.trim() !== '' && newName !== currentName) {
            if (settings.yushe[newName]) {
                alert("该名称已存在，请换一个名称。");
                return;
            }
            settings.yushe[newName] = settings.yushe[currentName];
            delete settings.yushe[currentName];
            settings[yusheIdKey] = newName;
            saveSettingsDebounced();
            window.loadSilterTavernChatu8Settings();
            toastr.success(`预设已重命名为 "${newName}"`);
        }
    });
}

function st_chatu8_tishici_save(mode, settings) { // This is now "Save As"
    const suffix = getSuffix(mode);
    stylInput("请输入新配置的名称").then((result) => {
        if (result && result.trim() !== '') {
            const fixedPrompt = document.getElementById("fixedPrompt" + suffix).value;
            const fixedPrompt_end = document.getElementById("fixedPrompt_end" + suffix).value;
            const negativePrompt = document.getElementById("negativePrompt" + suffix).value;
            const yusheIdKey = `yusheid${mode === 'sd' ? '_sd' : suffix}`;

            settings.yushe[result] = { ...(settings.yushe[result] || {}), "fixedPrompt": fixedPrompt, "fixedPrompt_end": fixedPrompt_end, "negativePrompt": negativePrompt };
            settings[yusheIdKey] = result;
            saveSettingsDebounced();
            // This needs to call a function in ui.js to reload the whole UI
            window.loadSilterTavernChatu8Settings();
            alert(`预设 "${result}" 已保存。`);
        }
    });
}

function st_chatu8_tishici_update(mode, settings) { // This is the new "Save"
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

            settings.yushe[presetName] = { ...settings.yushe[presetName], "fixedPrompt": fixedPrompt, "fixedPrompt_end": fixedPrompt_end, "negativePrompt": negativePrompt };
            saveSettingsDebounced();

            // Hide warnings after saving
            const fields = ['fixedPrompt', 'fixedPrompt_end', 'negativePrompt'];
            fields.forEach(field => {
                const textarea = document.getElementById(field + suffix);
                const warning = textarea.closest('.st-chatu8-field-col').querySelector('.st-chatu8-unsaved-warning');
                if (warning) $(warning).hide();
            });
        }
    });
}

function st_chatu8_tishici_delete(mode, settings) {
    const suffix = getSuffix(mode);
    const selectElement = document.getElementById("yusheid" + suffix);
    const valueToDelete = selectElement.value;
    const yusheIdKey = `yusheid${mode === 'sd' ? '_sd' : suffix}`;

    if (valueToDelete === "默认") {
        alert("默认配置不能删除");
        return;
    }

    // Check if the preset is used by other generation types
    const modesUsingPreset = [];
    const allModes = {
        sd: { key: 'yusheid_sd', name: 'SD' },
        novelai: { key: 'yusheid_novelai', name: 'NovelAI' },
        comfyui: { key: 'yusheid_comfyui', name: 'ComfyUI' }
    };

    for (const modeKey in allModes) {
        if (modeKey === mode) continue;

        const modeInfo = allModes[modeKey];
        if (settings[modeInfo.key] === valueToDelete) {
            modesUsingPreset.push(modeInfo.name);
        }
    }

    if (modesUsingPreset.length > 0) {
        alert(`无法删除预设 "${valueToDelete}"，因为它正在被以下模式使用：${modesUsingPreset.join('、 ')}。\n请先在这些模式中切换到其他预设。`);
        return;
    }

    stylishConfirm("是否确定删除").then((result) => {
        if (result) {
            Reflect.deleteProperty(settings.yushe, valueToDelete);
            settings[yusheIdKey] = "默认";
            saveSettingsDebounced();
            window.loadSilterTavernChatu8Settings();
        }
    });
}

async function st_chatu8_tishici_export_current(settings) {
    const activeTabId = document.querySelector('.st-chatu8-tab-content.active').id.replace('ch-tab-', '');
    const suffix = getSuffix(activeTabId);

    let yusheIdKey = '';
    if (suffix.includes('sd')) {
        yusheIdKey = "yusheid_sd";
    }
    if (suffix.includes('novelai')) {
        yusheIdKey = "yusheid_novelai";
    }
    if (suffix.includes('comfyui')) {
        yusheIdKey = "yusheid_comfyui";
    }

    const selectedId = settings[yusheIdKey];

    if (!selectedId || !settings.yushe[selectedId]) {
        alert("没有选中的预设可导出。");
        return;
    }

    const preset = settings.yushe[selectedId];
    const dataToExport = {
        presets: { [selectedId]: preset },
        images: {}
    };

    // 收集并导出预览图片
    if (preset.previewImageId) {
        try {
            const imageData = await getConfigImage(preset.previewImageId);
            if (imageData) {
                dataToExport.images[preset.previewImageId] = imageData;
            }
        } catch (error) {
            console.error(`[Prompt] 获取图片 ${preset.previewImageId} 失败:`, error);
        }
    }

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

async function st_chatu8_tishici_export_all(settings) {
    if (!settings.yushe || Object.keys(settings.yushe).length === 0) {
        alert("没有预设可导出。");
        return;
    }

    const dataToExport = {
        presets: settings.yushe,
        images: {}
    };

    // 收集所有预设的预览图片
    const imageIdsToExport = new Set();
    for (const presetName in settings.yushe) {
        const preset = settings.yushe[presetName];
        if (preset.previewImageId) {
            imageIdsToExport.add(preset.previewImageId);
        }
    }

    // 获取图片数据
    if (imageIdsToExport.size > 0) {
        for (const imageId of imageIdsToExport) {
            try {
                const imageData = await getConfigImage(imageId);
                if (imageData) {
                    dataToExport.images[imageId] = imageData;
                }
            } catch (error) {
                console.error(`[Prompt] 获取图片 ${imageId} 失败:`, error);
            }
        }
        console.log(`[Prompt] 导出 ${Object.keys(dataToExport.images).length} 张图片`);
    }

    const dataStr = JSON.stringify(dataToExport, null, 2);
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

function st_chatu8_tishici_import(settings) {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.onchange = async e => {
        const file = e.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = async readerEvent => {
            try {
                const importedData = JSON.parse(readerEvent.target.result);

                // 检测新格式（包含 presets）还是旧格式（直接是预设对象）
                let presetsToImport = {};
                let imagesToImport = importedData.images || {};

                if (importedData.presets) {
                    // 新格式
                    presetsToImport = importedData.presets;
                } else {
                    // 旧格式，直接是预设对象
                    presetsToImport = importedData;
                }

                // 导入图片（如果有）
                let importedImagesCount = 0;
                const imageIdMapping = {}; // 旧ID -> 新ID 映射

                if (Object.keys(imagesToImport).length > 0) {
                    console.log(`[Prompt] 正在导入 ${Object.keys(imagesToImport).length} 张图片...`);

                    for (const oldImageId in imagesToImport) {
                        try {
                            const imageData = imagesToImport[oldImageId];
                            // 保存图片并获取新的 ID
                            const newImageId = await saveConfigImage(imageData);
                            imageIdMapping[oldImageId] = newImageId;
                            importedImagesCount++;
                        } catch (error) {
                            console.error(`[Prompt] 导入图片 ${oldImageId} 失败:`, error);
                        }
                    }

                    console.log(`[Prompt] 成功导入 ${importedImagesCount} 张图片`);

                    // 更新预设中的图片ID引用
                    for (const presetName in presetsToImport) {
                        const preset = presetsToImport[presetName];
                        if (preset.previewImageId && imageIdMapping[preset.previewImageId]) {
                            preset.previewImageId = imageIdMapping[preset.previewImageId];
                        }
                    }
                }

                let newPresetsCount = 0;
                for (const key in presetsToImport) {
                    if (presetsToImport.hasOwnProperty(key)) {
                        if (!settings.yushe.hasOwnProperty(key)) {
                            newPresetsCount++;
                        }
                        settings.yushe[key] = presetsToImport[key];
                    }
                }
                saveSettingsDebounced();
                window.loadSilterTavernChatu8Settings();

                let message = `成功导入 ${Object.keys(presetsToImport).length} 个预设，其中 ${newPresetsCount} 个是全新的。`;
                if (importedImagesCount > 0) {
                    message += `\n同时导入 ${importedImagesCount} 张图片。`;
                }
                alert(message);
            } catch (err) {
                alert("导入失败，请确保文件是正确的JSON格式。");
                console.error("Error importing presets:", err);
            }
        };
        reader.readAsText(file);
    };
    input.click();
}
