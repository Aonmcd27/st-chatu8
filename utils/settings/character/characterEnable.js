// @ts-nocheck
/**
 * 角色启用管理模块
 * 处理角色启用列表的 CRUD 操作和导入导出
 */

import { extension_settings } from "../../../../../../extensions.js";
import { saveSettingsDebounced } from "../../../../../../../script.js";
import { extensionName } from '../../config.js';
import { stylInput, stylishConfirm } from '../../ui_common.js';
import { encryptExportData, decryptImportData } from './crypto.js';
import { loadCharacterPresetList } from './characterPreset.js';
import { loadOutfitPresetList } from './outfitPreset.js';
import { inspectCharacterPromptTrigger, inspectCharacterPromptTriggers } from '../../characterprompt.js';
import { inspectCharacterListTrigger } from '../worldbook.js';
import { getContext } from "../../../../../../st-context.js";

// ========== 角色启用管理 ==========

/**
 * 设置角色启用管理控件
 */
export function setupCharacterEnableControls(container) {
    // 加载预设列表
    loadCharacterEnablePresetList();

    // 绑定预设选择
    container.find('#character_enable_preset_id').on('change', loadCharacterEnablePreset);

    // 绑定按钮
    container.find('#character_enable_new').on('click', createNewCharacterEnablePreset);
    container.find('#character_enable_rename').on('click', renameCharacterEnablePreset);
    container.find('#character_enable_update').on('click', updateCharacterEnablePreset);
    container.find('#character_enable_save_as').on('click', saveCharacterEnablePresetAs);
    container.find('#character_enable_export').on('click', exportCharacterEnablePreset);
    container.find('#character_enable_export_all').on('click', exportAllCharacterEnablePresets);
    container.find('#character_enable_import').on('click', importCharacterEnablePreset);
    container.find('#character_enable_delete').on('click', deleteCharacterEnablePreset);
    container.find('#character_enable_check').on('click', checkCharacterList);
    container.find('#character_enable_test').on('click', testCharacterTrigger);
    container.find('#character_list_test').on('click', testCharacterListTrigger);
    container.find('#character_enable_add').on('click', addCharacterFromSelector);
    container.find('#character_enable_refresh').on('click', loadCharacterSelector);

    // 绑定当前角色按钮
    container.find('#character_enable_bind_current_btn').on('click', () => {
        const conet = getContext();
        if (conet && conet.name2) {
            $('#character_enable_bind_card').val(conet.name2);
            updateCharacterEnablePreset();
        } else {
            toastr.warning('未能获取当前角色卡名称，请确保已打开某个角色的聊天。');
        }
    });

    // 绑定当前聊天记录按钮
    container.find('#character_enable_bind_current_chat_btn').on('click', () => {
        const conet = getContext();
        if (conet && conet.chatId) {
            $('#character_enable_bind_chat').val(conet.chatId);
            updateCharacterEnablePreset();
        } else {
            toastr.warning('未能获取当前聊天记录ID，请确保已打开某个角色的聊天。');
        }
    });

    // 加载当前预设
    loadCharacterEnablePreset();

    // 加载角色选择器
    loadCharacterSelector();
}

export function loadCharacterEnablePresetList() {
    const settings = extension_settings[extensionName];
    const select = document.getElementById('character_enable_preset_id');

    if (!select) return;

    select.innerHTML = '';

    for (const presetName in settings.characterEnablePresets) {
        const option = document.createElement('option');
        option.value = presetName;
        option.textContent = presetName;
        select.add(option);
    }

    select.value = settings.characterEnablePresetId;
}

export function loadCharacterEnablePreset() {
    const settings = extension_settings[extensionName];
    const select = document.getElementById('character_enable_preset_id');
    if (!select) return;

    const presetId = select.value;
    settings.characterEnablePresetId = presetId;

    const preset = settings.characterEnablePresets[presetId];
    const textarea = document.getElementById('character_enable_list');
    const bindCardInput = document.getElementById('character_enable_bind_card');
    const bindChatInput = document.getElementById('character_enable_bind_chat');

    if (textarea && preset) {
        // 将角色数组转换为换行分割的字符串
        textarea.value = (preset.characters || []).join('\n');
    }
    
    if (bindCardInput && preset) {
        bindCardInput.value = preset.bindCharacterCard || '';
    }

    if (bindChatInput && preset) {
        bindChatInput.value = preset.bindChatId || '';
    }

    saveSettingsDebounced();
}

function updateCharacterEnablePreset() {
    const settings = extension_settings[extensionName];
    const presetId = settings.characterEnablePresetId;

    if (!presetId || !settings.characterEnablePresets[presetId]) {
        toastr.warning('没有活动的角色启用预设可保存。请先"另存为"一个新预设。');
        return;
    }

    // 直接保存，不弹确认框
    saveCurrentCharacterEnableData(presetId);
    toastr.success(`角色启用预设 "${presetId}" 已保存`);
}

function saveCharacterEnablePresetAs() {
    stylInput("请输入新角色启用预设的名称").then((result) => {
        if (result && result.trim() !== '') {
            const settings = extension_settings[extensionName];
            saveCurrentCharacterEnableData(result);
            settings.characterEnablePresetId = result;
            loadCharacterEnablePresetList();
            alert(`角色启用预设 "${result}" 已保存。`);
        }
    });
}

function createNewCharacterEnablePreset() {
    stylInput("请输入新角色启用预设的名称").then((result) => {
        if (result && result.trim() !== '') {
            const settings = extension_settings[extensionName];

            if (settings.characterEnablePresets[result]) {
                alert(`角色启用预设 "${result}" 已存在，请使用其他名称。`);
                return;
            }

            settings.characterEnablePresets[result] = {
                characters: [],
                bindCharacterCard: '',
                bindChatId: ''
            };
            settings.characterEnablePresetId = result;
            saveSettingsDebounced();

            loadCharacterEnablePresetList();
            loadCharacterEnablePreset();

            toastr.success(`空白角色启用预设 "${result}" 已创建。`);
        }
    });
}

function renameCharacterEnablePreset() {
    const settings = extension_settings[extensionName];
    const currentName = settings.characterEnablePresetId;
    if (!currentName || !settings.characterEnablePresets[currentName]) {
        alert("没有活动的角色启用预设可重命名。");
        return;
    }
    if (currentName === "默认启用列表") {
        alert("默认预设不能重命名。");
        return;
    }
    
    stylInput("请输入新的角色启用预设名称", currentName).then((newName) => {
        if (newName && newName.trim() !== '' && newName !== currentName) {
            if (settings.characterEnablePresets[newName]) {
                alert("该名称已存在，请换一个名称。");
                return;
            }
            
            settings.characterEnablePresets[newName] = settings.characterEnablePresets[currentName];
            delete settings.characterEnablePresets[currentName];
            
            settings.characterEnablePresetId = newName;
            
            saveSettingsDebounced();
            loadCharacterEnablePresetList();
            
            try {
                if (typeof window.loadSilterTavernChatu8Settings === 'function') {
                    window.loadSilterTavernChatu8Settings();
                }
            } catch (error) {
                console.warn('Failed to refresh UI after renaming preset:', error);
            }
            toastr.success(`角色启用预设已重命名为 "${newName}"`);
        }
    });
}

function saveCurrentCharacterEnableData(presetId) {
    const settings = extension_settings[extensionName];
    const textarea = document.getElementById('character_enable_list');

    if (!textarea) return;

    // 将文本框内容按行分割，过滤空行
    const characters = textarea.value
        .split('\n')
        .map(line => line.trim())
        .filter(line => line.length > 0);

    const bindCardInput = document.getElementById('character_enable_bind_card');
    const bindCharacterCard = bindCardInput ? bindCardInput.value.trim() : '';

    const bindChatInput = document.getElementById('character_enable_bind_chat');
    const bindChatId = bindChatInput ? bindChatInput.value.trim() : '';

    settings.characterEnablePresets[presetId] = {
        characters: characters,
        bindCharacterCard: bindCharacterCard,
        bindChatId: bindChatId
    };

    saveSettingsDebounced();
}

function getCharacterEnableInputCharacters() {
    const textarea = document.getElementById('character_enable_list');

    if (!textarea) return [];

    return textarea.value
        .split('\n')
        .map(line => line.trim())
        .filter(line => line.length > 0);
}

function escapeTestHtml(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function testCharacterTrigger() {
    const settings = extension_settings[extensionName];
    const input = document.getElementById('character_enable_test_input');
    const resultDiv = document.getElementById('character_enable_test_result');
    const contentDiv = document.getElementById('character_enable_test_content');

    if (!input || !resultDiv || !contentDiv) return;

    const rawInput = input.value.trim();
    if (!rawInput) {
        alert('请先输入要测试的触发词');
        return;
    }

    const testCharacters = getCharacterEnableInputCharacters();
    const select = document.getElementById('character_enable_preset_id');
    const currentPresetId = select?.value || settings.characterEnablePresetId || '默认启用列表';
    const originalPresetId = settings.characterEnablePresetId;
    const hadPreset = Object.prototype.hasOwnProperty.call(settings.characterEnablePresets, currentPresetId);
    const originalPreset = hadPreset ? JSON.parse(JSON.stringify(settings.characterEnablePresets[currentPresetId])) : null;

    const formatLabelMap = {
        'plain': '纯名字',
        'legacy-character': '旧格式角色标记',
        'json': 'JSON 名字',
        'json-character': 'JSON 角色标记',
        'invalid': '无效输入'
    };

    const renderMatchSource = (r) => {
        if (!r.matched) return '<span style="color: #dc3545;">未命中</span>';
        switch (r.matchSource) {
            case 'enabled':
                return '<span style="color: #28a745;">启用列表</span>';
            case 'common':
                return '<span style="color: #f0ad4e;">通用列表 <strong>（未启用）</strong></span>';
            case 'fallback-all':
                return '<span style="color: #dc3545;"><strong>未启用</strong>（全局兜底命中）</span>';
            default:
                return '<span style="color: #dc3545;">未知</span>';
        }
    };

    const hasMultipleSegments = /\$[^$]+\$[\s\S]*\$[^$]+\$/.test(rawInput);
    let segmentResults = [];
    let singleResult = null;
    let errorMessage = '';

    try {
        settings.characterEnablePresetId = currentPresetId;
        settings.characterEnablePresets[currentPresetId] = {
            ...(hadPreset ? settings.characterEnablePresets[currentPresetId] : {}),
            characters: testCharacters
        };

        if (hasMultipleSegments) {
            segmentResults = inspectCharacterPromptTriggers(rawInput);
        } else {
            singleResult = inspectCharacterPromptTrigger(rawInput);
        }
    } catch (error) {
        errorMessage = error?.message || String(error);
        console.error('[CharacterEnable] Trigger test failed:', error);
    } finally {
        if (hadPreset) {
            settings.characterEnablePresets[currentPresetId] = originalPreset;
        } else {
            delete settings.characterEnablePresets[currentPresetId];
        }
        settings.characterEnablePresetId = originalPresetId;
    }

    let html = '';

    if (errorMessage) {
        html += `<div style="color: #dc3545;"><strong>执行错误：</strong>${escapeTestHtml(errorMessage)}</div>`;
    } else if (hasMultipleSegments) {
        const hitCount = segmentResults.filter(item => item.result.matched).length;
        html += '<div style="margin-bottom: 10px;">';
        html += `<strong>检测到片段：</strong>${segmentResults.length} 段`;
        html += `<br><strong>命中：</strong>${hitCount} / ${segmentResults.length}`;
        html += `<br><strong>当前启用列表：</strong>${testCharacters.length} 个角色`;
        html += '</div>';

        html += '<table style="width: 100%; border-collapse: collapse; font-size: 0.9em;">';
        html += '<thead><tr>'
            + '<th style="text-align: left; border-bottom: 1px solid var(--SmartThemeBorderColor); padding: 4px;">#</th>'
            + '<th style="text-align: left; border-bottom: 1px solid var(--SmartThemeBorderColor); padding: 4px;">原文</th>'
            + '<th style="text-align: left; border-bottom: 1px solid var(--SmartThemeBorderColor); padding: 4px;">格式</th>'
            + '<th style="text-align: left; border-bottom: 1px solid var(--SmartThemeBorderColor); padding: 4px;">提取名称</th>'
            + '<th style="text-align: left; border-bottom: 1px solid var(--SmartThemeBorderColor); padding: 4px;">命中</th>'
            + '<th style="text-align: left; border-bottom: 1px solid var(--SmartThemeBorderColor); padding: 4px;">命中角色</th>'
            + '<th style="text-align: left; border-bottom: 1px solid var(--SmartThemeBorderColor); padding: 4px;">命中预设</th>'
            + '<th style="text-align: left; border-bottom: 1px solid var(--SmartThemeBorderColor); padding: 4px;">命中来源</th>'
            + '</tr></thead><tbody>';

        segmentResults.forEach((item, index) => {
            const r = item.result;
            const formatLabel = formatLabelMap[r.format] || '未知';
            const hitHtml = r.matched
                ? '<span style="color: #28a745;">✓</span>'
                : '<span style="color: #dc3545;">✗</span>';
            html += '<tr>'
                + `<td style="padding: 4px; vertical-align: top;">${index + 1}</td>`
                + `<td style="padding: 4px; vertical-align: top; word-break: break-all;">${escapeTestHtml(item.segment)}</td>`
                + `<td style="padding: 4px; vertical-align: top;">${escapeTestHtml(formatLabel)}</td>`
                + `<td style="padding: 4px; vertical-align: top; word-break: break-all;">${escapeTestHtml(r.extractedName || '（无）')}</td>`
                + `<td style="padding: 4px; vertical-align: top;">${hitHtml}</td>`
                + `<td style="padding: 4px; vertical-align: top;">${escapeTestHtml(r.matchedDisplayName || '（无）')}</td>`
                + `<td style="padding: 4px; vertical-align: top; word-break: break-all;">${escapeTestHtml(r.matchedPresetId || '（无）')}</td>`
                + `<td style="padding: 4px; vertical-align: top;">${renderMatchSource(r)}</td>`
                + '</tr>';
        });

        html += '</tbody></table>';
        html += '<div style="margin-top: 10px; color: var(--SmartThemeEmColor);">这里只做名字匹配识别，不会执行完整的替换流程。</div>';
    } else {
        const inspectResult = singleResult || {
            matched: false, extractedName: '', normalizedName: '', matchedDisplayName: '', format: 'invalid'
        };
        const formatLabel = formatLabelMap[inspectResult.format] || '未知';

        html += '<div style="margin-bottom: 10px;">';
        html += `<strong>名字匹配：</strong>${inspectResult.matched ? '<span style="color: #28a745;">已命中角色预设</span>' : '<span style="color: #dc3545;">未命中角色预设</span>'}`;
        html += `<br><strong>当前启用列表：</strong>${testCharacters.length} 个角色`;
        html += '</div>';
        html += `<div style="margin-bottom: 10px;"><strong>提取名称：</strong>${escapeTestHtml(inspectResult.extractedName || '（未提取到）')}</div>`;
        html += `<div style="margin-bottom: 10px;"><strong>标准化名称：</strong>${escapeTestHtml(inspectResult.normalizedName || '（无）')}</div>`;
        html += `<div style="margin-bottom: 10px;"><strong>输入格式：</strong>${escapeTestHtml(formatLabel)}</div>`;
        html += `<div style="margin-bottom: 10px;"><strong>命中的角色：</strong>${escapeTestHtml(inspectResult.matchedDisplayName || '（无）')}</div>`;
        html += `<div style="margin-bottom: 10px;"><strong>命中的预设：</strong>${escapeTestHtml(inspectResult.matchedPresetId || '（无）')}</div>`;
        html += `<div style="margin-bottom: 10px;"><strong>命中来源：</strong>${renderMatchSource(inspectResult)}</div>`;
        html += `<div style="margin-bottom: 10px;"><strong>测试输入：</strong><div style="margin-top: 5px; white-space: pre-wrap; word-break: break-word;">${escapeTestHtml(rawInput)}</div></div>`;
        html += '<div style="color: var(--SmartThemeEmColor);">提示：若命中来源不是「启用列表」，说明当前启用列表并没有该角色，是经由通用列表或全局预设兜底匹配到的。</div>';
    }

    contentDiv.innerHTML = html;
    $(resultDiv).show();
}

function testCharacterListTrigger() {
    const settings = extension_settings[extensionName];
    const input = document.getElementById('character_list_test_input');
    const resultDiv = document.getElementById('character_list_test_result');
    const contentDiv = document.getElementById('character_list_test_content');

    if (!input || !resultDiv || !contentDiv) return;

    const rawInput = input.value;
    if (!rawInput.trim()) {
        alert('请先粘贴要测试的触发文本');
        return;
    }

    const testCharacters = getCharacterEnableInputCharacters();
    const select = document.getElementById('character_enable_preset_id');
    const currentPresetId = select?.value || settings.characterEnablePresetId || '默认启用列表';
    const originalPresetId = settings.characterEnablePresetId;
    const hadPreset = Object.prototype.hasOwnProperty.call(settings.characterEnablePresets, currentPresetId);
    const originalPreset = hadPreset ? JSON.parse(JSON.stringify(settings.characterEnablePresets[currentPresetId])) : null;

    let inspectResult = null;
    let errorMessage = '';

    try {
        settings.characterEnablePresetId = currentPresetId;
        settings.characterEnablePresets[currentPresetId] = {
            ...(hadPreset ? settings.characterEnablePresets[currentPresetId] : {}),
            characters: testCharacters
        };
        inspectResult = inspectCharacterListTrigger(rawInput);
    } catch (error) {
        errorMessage = error?.message || String(error);
        console.error('[CharacterEnable] List trigger test failed:', error);
    } finally {
        if (hadPreset) {
            settings.characterEnablePresets[currentPresetId] = originalPreset;
        } else {
            delete settings.characterEnablePresets[currentPresetId];
        }
        settings.characterEnablePresetId = originalPresetId;
    }

    let html = '';

    if (errorMessage) {
        html += `<div style="color: #dc3545;"><strong>执行错误：</strong>${escapeTestHtml(errorMessage)}</div>`;
    } else if (!inspectResult) {
        html += '<div style="color: #dc3545;">未返回结果。</div>';
    } else {
        const { presetId, enabledCount, triggered, notTriggered, missing } = inspectResult;

        html += '<div style="margin-bottom: 10px;">';
        html += `<strong>当前启用预设：</strong>${escapeTestHtml(presetId || '（无）')}`;
        html += `<br><strong>启用角色总数：</strong>${enabledCount}`;
        html += `<br><strong>命中：</strong><span style="color: #28a745;">${triggered.length}</span>`
            + ` &nbsp;/&nbsp; <strong>未命中：</strong><span style="color: #dc3545;">${notTriggered.length}</span>`;
        if (missing.length > 0) {
            html += ` &nbsp;/&nbsp; <strong>缺失预设：</strong><span style="color: #f0ad4e;">${missing.length}</span>`;
        }
        html += '</div>';

        const renderList = (title, items, color) => {
            if (!items || items.length === 0) return '';
            let block = `<div style="margin-top: 10px;"><strong style="color: ${color};">${title}（${items.length}）</strong>`;
            block += '<ul style="margin: 4px 0 0 0; padding-left: 20px; font-size: 0.9em; line-height: 1.5;">';
            for (const it of items) {
                const nameCN = it.nameCN ? `中文：${it.nameCN}` : '';
                const nameEN = it.nameEN ? `英文：${it.nameEN}` : '';
                const triggeredBy = it.triggeredBy ? ` <span style="color: #28a745;">（命中名字：${escapeTestHtml(it.triggeredBy)}）</span>` : '';
                const nameParts = [nameCN, nameEN].filter(Boolean).join('、');
                block += `<li><code>${escapeTestHtml(it.presetId || '')}</code>${nameParts ? ' · ' + escapeTestHtml(nameParts) : ''}${triggeredBy}</li>`;
            }
            block += '</ul></div>';
            return block;
        };

        html += renderList('✓ 被触发的角色', triggered, '#28a745');
        html += renderList('✗ 未被触发的角色', notTriggered, '#dc3545');

        if (missing.length > 0) {
            html += '<div style="margin-top: 10px;"><strong style="color: #f0ad4e;">⚠ 列表中不存在的角色预设 ID（' + missing.length + '）</strong>';
            html += '<ul style="margin: 4px 0 0 0; padding-left: 20px; font-size: 0.9em; line-height: 1.5;">';
            for (const id of missing) {
                html += `<li><code>${escapeTestHtml(id)}</code></li>`;
            }
            html += '</ul></div>';
        }

        html += '<div style="margin-top: 10px; color: var(--SmartThemeEmColor); font-size: 0.85em;">该测试仅反映 <code>{{角色启用列表}}</code> 的触发行为：大小写 / 空格已忽略，仅扫描启用列表中的角色。</div>';
    }

    contentDiv.innerHTML = html;
    $(resultDiv).show();
}

function deleteCharacterEnablePreset() {
    const settings = extension_settings[extensionName];
    const presetId = document.getElementById('character_enable_preset_id')?.value;

    if (presetId === "默认启用列表") {
        alert("默认预设不能删除");
        return;
    }

    stylishConfirm("是否确定删除该角色启用预设").then((result) => {
        if (result) {
            delete settings.characterEnablePresets[presetId];
            settings.characterEnablePresetId = "默认启用列表";
            loadCharacterEnablePresetList();
            loadCharacterEnablePreset();
            saveSettingsDebounced();
        }
    });
}

async function exportCharacterEnablePreset() {
    const settings = extension_settings[extensionName];
    const presetId = settings.characterEnablePresetId;
    const preset = settings.characterEnablePresets[presetId];

    if (!preset) {
        alert("没有选中的角色启用预设可导出。");
        return;
    }

    // 检查是否有关联的角色列表
    const relatedCharacters = preset.characters || [];

    let dataToExport = {
        characterEnablePresets: { [presetId]: preset }
    };

    // 如果有关联角色,询问用户是否一起导出
    if (relatedCharacters.length > 0) {
        const confirmMessage = `检测到该列表包含 ${relatedCharacters.length} 个角色:\n${relatedCharacters.join('\n')}\n\n是否一起导出相关角色?`;
        const includeCharacters = await stylishConfirm(confirmMessage);

        if (includeCharacters) {
            dataToExport.characters = {};
            relatedCharacters.forEach(charName => {
                if (settings.characterPresets[charName]) {
                    const charPreset = settings.characterPresets[charName];
                    dataToExport.characters[charName] = charPreset;

                    // 同时收集该角色的服装
                    const charOutfits = charPreset.outfits || [];
                    if (charOutfits.length > 0) {
                        if (!dataToExport.outfits) {
                            dataToExport.outfits = {};
                        }
                        charOutfits.forEach(outfitName => {
                            if (settings.outfitPresets[outfitName]) {
                                dataToExport.outfits[outfitName] = settings.outfitPresets[outfitName];
                            }
                        });
                    }
                }
            });
        }
    }

    // 使用统一的加密导出函数
    dataToExport = await encryptExportData(dataToExport);

    const dataStr = JSON.stringify(dataToExport, null, 2);
    const blob = new Blob([dataStr], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `st-chatu8-角色启用列表-${presetId}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

async function exportAllCharacterEnablePresets() {
    const settings = extension_settings[extensionName];
    if (!settings.characterEnablePresets || Object.keys(settings.characterEnablePresets).length === 0) {
        alert("没有角色启用预设可导出。");
        return;
    }

    // 收集所有角色启用预设中的角色和关联的服装
    const allCharacters = new Set();
    const allOutfits = new Set();

    for (const presetName in settings.characterEnablePresets) {
        const preset = settings.characterEnablePresets[presetName];
        const characters = preset.characters || [];
        characters.forEach(charName => {
            allCharacters.add(charName);
            // 收集该角色的服装
            if (settings.characterPresets[charName]) {
                const charOutfits = settings.characterPresets[charName].outfits || [];
                charOutfits.forEach(outfitName => allOutfits.add(outfitName));
            }
        });
    }

    let dataToExport = {
        characterEnablePresets: settings.characterEnablePresets
    };

    // 如果有关联角色,询问用户是否一起导出
    if (allCharacters.size > 0) {
        const confirmMessage = `检测到所有列表共包含 ${allCharacters.size} 个不同的角色:\n${Array.from(allCharacters).join('\n')}\n\n是否一起导出相关角色?`;
        const includeCharacters = await stylishConfirm(confirmMessage);

        if (includeCharacters) {
            dataToExport.characters = {};
            allCharacters.forEach(charName => {
                if (settings.characterPresets[charName]) {
                    dataToExport.characters[charName] = settings.characterPresets[charName];
                }
            });

            // 如果导出角色,询问是否也导出服装
            if (allOutfits.size > 0) {
                const confirmOutfits = `同时检测到这些角色包含 ${allOutfits.size} 个不同的服装:\n${Array.from(allOutfits).join('\n')}\n\n是否也一起导出?`;
                const includeOutfits = await stylishConfirm(confirmOutfits);

                if (includeOutfits) {
                    dataToExport.outfits = {};
                    allOutfits.forEach(outfitName => {
                        if (settings.outfitPresets[outfitName]) {
                            dataToExport.outfits[outfitName] = settings.outfitPresets[outfitName];
                        }
                    });
                }
            }
        }
    }

    // 使用统一的加密导出函数
    dataToExport = await encryptExportData(dataToExport);

    const dataStr = JSON.stringify(dataToExport, null, 2);
    const blob = new Blob([dataStr], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "st-chatu8-角色启用列表-全部.json";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

function importCharacterEnablePreset() {
    const settings = extension_settings[extensionName];
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.onchange = async e => {
        const file = e.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = async readerEvent => {
            try {
                let importedData = JSON.parse(readerEvent.target.result);

                // 自动检测并解密数据
                importedData = decryptImportData(importedData);

                // 检查新格式或旧格式
                let enablePresetsToImport = {};
                let charactersToImport = {};
                let outfitsToImport = {};

                if (importedData.characterEnablePresets) {
                    // 新格式
                    enablePresetsToImport = importedData.characterEnablePresets;
                    charactersToImport = importedData.characters || {};
                    outfitsToImport = importedData.outfits || {};
                } else {
                    // 旧格式
                    enablePresetsToImport = importedData;
                }

                // 如果有关联的角色,询问用户是否一起导入
                let importCharacters = false;
                if (Object.keys(charactersToImport).length > 0) {
                    const characterNames = Object.keys(charactersToImport);
                    const confirmMessage = `检测到 ${characterNames.length} 个相关角色:\n${characterNames.join('\n')}\n\n是否一起导入?`;
                    importCharacters = await stylishConfirm(confirmMessage);
                }

                // 导入角色启用预设
                let newEnablePresetsCount = 0;
                for (const key in enablePresetsToImport) {
                    if (enablePresetsToImport.hasOwnProperty(key)) {
                        if (!settings.characterEnablePresets.hasOwnProperty(key)) {
                            newEnablePresetsCount++;
                        }
                        settings.characterEnablePresets[key] = enablePresetsToImport[key];
                    }
                }

                // 导入角色(如果用户确认)
                let newCharactersCount = 0;
                let newOutfitsCount = 0;
                if (importCharacters) {
                    for (const key in charactersToImport) {
                        if (charactersToImport.hasOwnProperty(key)) {
                            if (!settings.characterPresets.hasOwnProperty(key)) {
                                newCharactersCount++;
                            }
                            settings.characterPresets[key] = charactersToImport[key];
                        }
                    }

                    // 同时导入服装
                    for (const key in outfitsToImport) {
                        if (outfitsToImport.hasOwnProperty(key)) {
                            if (!settings.outfitPresets.hasOwnProperty(key)) {
                                newOutfitsCount++;
                            }
                            settings.outfitPresets[key] = outfitsToImport[key];
                        }
                    }
                }

                saveSettingsDebounced();
                loadCharacterEnablePresetList();
                if (importCharacters) {
                    loadCharacterPresetList();
                    loadOutfitPresetList();
                }

                // 自动选择第一个导入的预设
                const firstImportedKey = Object.keys(enablePresetsToImport)[0];
                if (firstImportedKey) {
                    settings.characterEnablePresetId = firstImportedKey;
                    const select = document.getElementById('character_enable_preset_id');
                    if (select) select.value = firstImportedKey;
                    loadCharacterEnablePreset();
                }

                let message = `成功导入 ${Object.keys(enablePresetsToImport).length} 个角色启用预设，其中 ${newEnablePresetsCount} 个是全新的。`;
                if (importCharacters) {
                    message += `\n同时导入 ${Object.keys(charactersToImport).length} 个角色预设(${newCharactersCount} 个全新)`;
                    message += `和 ${Object.keys(outfitsToImport).length} 个服装预设(${newOutfitsCount} 个全新)。`;
                }
                alert(message);
            } catch (err) {
                alert("导入失败，请确保文件是正确的JSON格式。\n错误信息: " + err.message);
                console.error("Error importing character enable presets:", err);
            }
        };
        reader.readAsText(file);
    };
    input.click();
}

/**
 * 加载角色选择器
 */
export function loadCharacterSelector() {
    const settings = extension_settings[extensionName];
    const select = document.getElementById('character_enable_selector');

    if (!select) return;

    select.innerHTML = '<option value="">-- 选择角色 --</option>';

    // 从角色预设中加载所有角色 - 使用预设名称作为判定
    for (const presetName in settings.characterPresets) {
        const option = document.createElement('option');
        option.value = presetName;
        option.textContent = presetName;
        select.add(option);
    }
}

/**
 * 从选择器添加角色
 */
function addCharacterFromSelector() {
    const select = document.getElementById('character_enable_selector');
    const textarea = document.getElementById('character_enable_list');

    if (!select || !textarea) return;

    const selectedCharacter = select.value;
    if (!selectedCharacter) {
        alert('请先选择一个角色');
        return;
    }

    // 获取当前文本框内容
    const currentText = textarea.value.trim();
    const lines = currentText ? currentText.split('\n') : [];

    // 检查是否已存在
    if (lines.includes(selectedCharacter)) {
        alert('该角色已在列表中');
        return;
    }

    // 添加角色
    lines.push(selectedCharacter);
    textarea.value = lines.join('\n');
}

/**
 * 检测角色列表中的角色是否存在
 */
export function checkCharacterList() {
    const settings = extension_settings[extensionName];
    const textarea = document.getElementById('character_enable_list');
    const resultDiv = document.getElementById('character_enable_check_result');
    const contentDiv = document.getElementById('character_enable_check_content');

    if (!textarea || !resultDiv || !contentDiv) return;

    // 获取输入的角色列表
    const inputCharacters = textarea.value
        .split('\n')
        .map(line => line.trim())
        .filter(line => line.length > 0);

    if (inputCharacters.length === 0) {
        alert('请先输入角色名称');
        return;
    }

    // 获取所有可用的角色预设名称
    const availableCharacters = new Set();
    for (const presetName in settings.characterPresets) {
        availableCharacters.add(presetName);
    }

    // 检测结果
    const results = {
        found: [],
        notFound: []
    };

    inputCharacters.forEach(char => {
        if (availableCharacters.has(char)) {
            results.found.push(char);
        } else {
            results.notFound.push(char);
        }
    });

    // 显示结果
    let html = '<div style="margin-bottom: 10px;">';
    html += `<strong>总计：</strong>${inputCharacters.length} 个角色`;
    html += `<br><strong>找到：</strong>${results.found.length} 个`;
    html += `<br><strong>未找到：</strong>${results.notFound.length} 个`;
    html += '</div>';

    if (results.found.length > 0) {
        html += '<div style="margin-bottom: 10px;">';
        html += '<strong style="color: #28a745;">✓ 已存在的角色：</strong>';
        html += '<ul style="margin: 5px 0; padding-left: 20px;">';
        results.found.forEach(char => {
            html += `<li>${char}</li>`;
        });
        html += '</ul></div>';
    }

    if (results.notFound.length > 0) {
        html += '<div>';
        html += '<strong style="color: #dc3545;">✗ 未找到的角色：</strong>';
        html += '<ul style="margin: 5px 0; padding-left: 20px;">';
        results.notFound.forEach(char => {
            html += `<li>${char}</li>`;
        });
        html += '</ul></div>';
    }

    contentDiv.innerHTML = html;
    $(resultDiv).show();
}
