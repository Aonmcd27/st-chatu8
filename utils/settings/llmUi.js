/* global toastr */
// @ts-nocheck
/**
 * llmUi.js - LLM UI 层
 * 
 * 包含所有 LLM 相关的 UI 操作：
 * - DOM 元素管理
 * - 事件绑定
 * - 界面渲染
 * - 配置管理 UI
 */

import { extension_settings } from "../../../../../extensions.js";
import { saveSettingsDebounced, eventSource } from "../../../../../../script.js";
import { extensionName, eventNames, LLMRequestTypes } from "../config.js";
import { getRequestHeaders } from "../utils.js";
import {
    formatPromptForDisplay,
    buildPromptForRequestType,
    executeTypedLLMRequest,
    executeDefaultLLMRequest,
    getLLMRequestController,
    setLLMRequestController
} from "./llmService.js";

// ==================== DOM 元素缓存 ====================

let profileSelect, apiUrlInput, apiKeyInput, modelSelect, modelInput, fetchModelsButton;
let temperatureSlider, temperatureValue, topPSlider, topPValue, maxTokensSlider, maxTokensValue;
let streamToggle, bypassProxyToggle, mergeSystemUserToggle, sendImagesToggle;
let historyDepthSlider, historyDepthValue;
let retryCountSlider, retryCountValue;
let testContextSelect;
let testButton, resultTextarea, combinedPromptTextarea;

// 请求类型配置相关 DOM 元素 - 新版本使用下拉选择
let imageGenApiSelect, imageGenContextSelect;
let charDesignApiSelect, charDesignContextSelect;
let charDisplayApiSelect, charDisplayContextSelect;
let charModifyApiSelect, charModifyContextSelect;
let translationApiSelect, translationContextSelect;
let tagModifyApiSelect, tagModifyContextSelect;
let aiAssistantContextSelect;
let requestTypeProfileSelect, loadRequestTypeProfileBtn, newRequestTypeProfileBtn, saveRequestTypeProfileBtn, renameRequestTypeProfileBtn, deleteRequestTypeProfileBtn;
let personaGenApiSelect, personaGenContextSelect;
let userPersonaGenApiSelect, userPersonaGenContextSelect;
let summaryApiSelect, summaryContextSelect;


// ==================== 公共 UI 更新函数 ====================

/**
 * 更新组合提示词输入框的内容。
 * @param {string|Array|Object} promptOrText - 要显示的文本或 prompt 对象
 * @param {string} [diagnosticText=''] - 可选的诊断信息前缀
 */
export function updateCombinedPrompt(promptOrText, diagnosticText = '') {
    if (combinedPromptTextarea) {
        let displayText = diagnosticText;
        displayText += formatPromptForDisplay(promptOrText);
        combinedPromptTextarea.val(displayText);
    }
}

/**
 * 获取结果文本框的更新函数
 * @returns {function} 更新函数
 */
export function getResultTextareaUpdater() {
    return (text) => {
        if (resultTextarea) {
            resultTextarea.val(text);
        }
    };
}

// ==================== 条目列表 UI ====================

let presetEntriesContainer; // 条目容器 DOM 元素
let entryIdCounter = 0;     // 条目 ID 计数器
let currentEditingEntry = null; // 当前正在编辑的条目元素

// ==================== 虚拟滚动相关 ====================
let virtualEntriesData = []; // 内存中的完整条目数据
let virtualScrollEnabled = true; // 是否启用虚拟滚动
const VIRTUAL_ITEM_HEIGHT = 78; // 每个条目的最小高度（像素）
const VIRTUAL_BUFFER = 30; // 上下缓冲区条目数
let lastRenderedRange = { start: -1, end: -1 }; // 上次渲染的范围
let virtualScrollContainer = null; // 虚拟滚动内容容器
let virtualScrollSpacer = null; // 占位元素

// ==================== 编辑弹窗 UI ====================

/**
 * 获取编辑弹窗 HTML 模板
 * @returns {string} 弹窗 HTML
 */
function getEntryEditModalHTML() {
    return `
        <div class="st-chatu8-entry-edit-modal-backdrop" id="ch-entry-edit-modal">
            <div class="st-chatu8-entry-edit-modal">
                <div class="st-chatu8-entry-edit-modal-header">
                    <h4>编辑条目</h4>
                    <span class="st-chatu8-entry-edit-modal-close">&times;</span>
                </div>
                <div class="st-chatu8-entry-edit-modal-body">
                    <div class="st-chatu8-modal-field">
                        <label>条目名称</label>
                        <input type="text" id="ch-modal-entry-name" class="st-chatu8-text-input" placeholder="条目名称" />
                    </div>
                    <div class="st-chatu8-modal-field-row">
                        <div class="st-chatu8-modal-field">
                            <label>角色</label>
                            <select id="ch-modal-entry-role" class="st-chatu8-select">
                                <option value="system">System</option>
                                <option value="user">User</option>
                                <option value="assistant">Assistant</option>
                            </select>
                        </div>
                        <div class="st-chatu8-modal-field">
                            <label>触发模式</label>
                            <select id="ch-modal-trigger-mode" class="st-chatu8-select">
                                <option value="always">常开</option>
                                <option value="trigger">触发</option>
                            </select>
                        </div>
                        <div class="st-chatu8-modal-field st-chatu8-modal-toggle-field">
                            <label>启用</label>
                            <div class="st-chatu8-toggle">
                                <input id="ch-modal-entry-enabled" type="checkbox" checked />
                                <span class="st-chatu8-slider"></span>
                            </div>
                        </div>
                    </div>
                    <div class="st-chatu8-modal-field" id="ch-modal-trigger-words-container" style="display: none;">
                        <label>触发词（逗号分隔）</label>
                        <input type="text" id="ch-modal-trigger-words" class="st-chatu8-text-input" placeholder="触发词1, 触发词2" />
                        <label style="margin-top: 10px;">并列触发词（同时满足，逗号分隔，可选）</label>
                        <input type="text" id="ch-modal-and-trigger-words" class="st-chatu8-text-input" placeholder="并列触发词1, 并列触发词2" />
                    </div>
                    <div class="st-chatu8-modal-field">
                        <label>内容</label>
                        <textarea id="ch-modal-entry-content" class="st-chatu8-textarea" rows="10" placeholder="输入内容..."></textarea>
                    </div>
                </div>
                <div class="st-chatu8-entry-edit-modal-footer">
                    <button class="st-chatu8-btn st-chatu8-modal-cancel-btn">取消</button>
                    <button class="st-chatu8-btn st-chatu8-btn-primary st-chatu8-modal-save-btn">保存</button>
                </div>
            </div>
        </div>
    `;
}

/**
 * 显示编辑弹窗
 * @param {jQuery} $entryElement - 条目元素
 */
function showEntryEditModal($entryElement) {
    currentEditingEntry = $entryElement;

    // 如果弹窗不存在，先创建
    let $modal = $('#ch-entry-edit-modal');
    if (!$modal.length) {
        $('body').append(getEntryEditModalHTML());
        $modal = $('#ch-entry-edit-modal');

        // 绑定弹窗事件
        $modal.find('.st-chatu8-entry-edit-modal-close').on('click', closeEntryEditModal);
        $modal.find('.st-chatu8-modal-cancel-btn').on('click', closeEntryEditModal);
        $modal.find('.st-chatu8-modal-save-btn').on('click', saveEntryFromModal);
        // 注意：不再绑定点击遮罩层关闭弹窗，避免误触

        // 触发模式变化时显示/隐藏触发词输入
        $modal.find('#ch-modal-trigger-mode').on('change', function () {
            const $container = $modal.find('#ch-modal-trigger-words-container');
            if ($(this).val() === 'trigger') {
                $container.show();
            } else {
                $container.hide();
            }
        });
    }

    // 填充数据到弹窗
    $modal.find('#ch-modal-entry-name').val($entryElement.find('.st-chatu8-entry-name').val());
    $modal.find('#ch-modal-entry-role').val($entryElement.attr('data-role') || 'user');
    $modal.find('#ch-modal-entry-enabled').prop('checked', !$entryElement.hasClass('disabled'));
    $modal.find('#ch-modal-trigger-mode').val($entryElement.attr('data-trigger-mode') || 'always').trigger('change');
    $modal.find('#ch-modal-trigger-words').val($entryElement.attr('data-trigger-words') || '');
    $modal.find('#ch-modal-and-trigger-words').val($entryElement.attr('data-and-trigger-words') || '');
    $modal.find('#ch-modal-entry-content').val($entryElement.find('.st-chatu8-entry-content').val());

    // 显示弹窗
    $modal.fadeIn(200);
}

/**
 * 关闭编辑弹窗
 */
function closeEntryEditModal() {
    const $modal = $('#ch-entry-edit-modal');
    $modal.fadeOut(200);
    currentEditingEntry = null;
}

/**
 * 从弹窗保存数据到条目
 */
function saveEntryFromModal() {
    if (!currentEditingEntry) {
        closeEntryEditModal();
        return;
    }

    const $modal = $('#ch-entry-edit-modal');
    const $entry = currentEditingEntry;

    // 更新条目数据
    const name = $modal.find('#ch-modal-entry-name').val();
    const role = $modal.find('#ch-modal-entry-role').val();
    const enabled = $modal.find('#ch-modal-entry-enabled').is(':checked');
    const triggerMode = $modal.find('#ch-modal-trigger-mode').val();
    const triggerWords = $modal.find('#ch-modal-trigger-words').val();
    const andTriggerWords = $modal.find('#ch-modal-and-trigger-words').val();
    const content = $modal.find('#ch-modal-entry-content').val();

    // 更新显示
    $entry.find('.st-chatu8-entry-name').val(name);
    $entry.attr('data-role', role);
    $entry.find('.st-chatu8-entry-role-badge').text(getRoleBadgeText(role)).attr('data-role', role);
    $entry.attr('data-trigger-mode', triggerMode);
    $entry.attr('data-trigger-words', triggerWords);
    $entry.attr('data-and-trigger-words', andTriggerWords);
    $entry.find('.st-chatu8-entry-content').val(content);

    // 更新启用状态
    $entry.find('.st-chatu8-entry-toggle input').prop('checked', enabled);
    if (enabled) {
        $entry.removeClass('disabled');
    } else {
        $entry.addClass('disabled');
    }

    // 更新内容预览
    const preview = content.length > 50 ? content.substring(0, 50) + '...' : content;
    $entry.find('.st-chatu8-entry-preview').text(preview || '(空)');

    // 虚拟滚动模式下，同步更新内存数据
    if (virtualScrollEnabled) {
        const entryIndex = parseInt($entry.attr('data-entry-index'), 10);
        if (!isNaN(entryIndex) && virtualEntriesData[entryIndex]) {
            virtualEntriesData[entryIndex] = {
                ...virtualEntriesData[entryIndex],
                name,
                role,
                enabled,
                triggerMode,
                triggerWords,
                andTriggerWords,
                content
            };
        }
    }

    // 自动保存到设置
    const contextName = testContextSelect.val();
    if (contextName) {
        extension_settings[extensionName].test_context_profiles[contextName] = collectTestContextDataFromUI();
        saveSettingsDebounced();
    }

    toastr.success('条目已更新并保存');
    closeEntryEditModal();
}

/**
 * 获取角色标签文本
 * @param {string} role - 角色
 * @returns {string} 标签文本
 */
function getRoleBadgeText(role) {
    const roleLabels = {
        'system': 'SYS',
        'user': 'USR',
        'assistant': 'AI'
    };
    return roleLabels[role] || 'USR';
}

/**
 * 生成唯一的条目 ID
 * @returns {string} 唯一 ID
 */
function generateEntryId() {
    return `entry_${Date.now()}_${++entryIdCounter}`;
}

/**
 * 迁移旧格式数据到新格式
 * @param {object} contextData - 上下文数据
 * @returns {object} 迁移后的数据
 */
function migrateOldContextData(contextData) {
    // 如果已经是新格式（有 entries），直接返回
    if (contextData.entries && Array.isArray(contextData.entries)) {
        return contextData;
    }

    // 如果是旧格式（有 history），进行迁移
    if (contextData.history && Array.isArray(contextData.history)) {
        const entries = [];
        contextData.history.forEach((h, index) => {
            if (h.user && h.user.trim()) {
                entries.push({
                    id: generateEntryId(),
                    name: `用户消息 ${index + 1}`,
                    role: 'user',
                    content: h.user,
                    enabled: true,
                    triggerMode: 'always',
                    triggerWords: '',
                    andTriggerWords: ''
                });
            }
            if (h.assistant && h.assistant.trim()) {
                entries.push({
                    id: generateEntryId(),
                    name: `AI回复 ${index + 1}`,
                    role: 'assistant',
                    content: h.assistant,
                    enabled: true,
                    triggerMode: 'always',
                    triggerWords: '',
                    andTriggerWords: ''
                });
            }
        });

        // 如果迁移后没有条目，添加一个默认条目
        if (entries.length === 0) {
            entries.push({
                id: generateEntryId(),
                name: '系统提示',
                role: 'system',
                content: '',
                enabled: true,
                triggerMode: 'always',
                triggerWords: '',
                andTriggerWords: ''
            });
        }

        return { entries };
    }

    // 如果什么都没有，返回默认结构
    return {
        entries: [{
            id: generateEntryId(),
            name: '系统提示',
            role: 'system',
            content: '',
            enabled: true,
            triggerMode: 'always',
            triggerWords: '',
            andTriggerWords: ''
        }]
    };
}

/**
 * 渲染条目列表（虚拟滚动版本）
 * @param {Array} entriesData - 条目数组
 */
function renderPresetEntries(entriesData = []) {
    // 保存数据到内存
    virtualEntriesData = entriesData.map((entry, index) => ({
        ...entry,
        _index: index
    }));

    presetEntriesContainer.empty();
    lastRenderedRange = { start: -1, end: -1 };

    if (entriesData.length === 0) {
        presetEntriesContainer.html(`
            <div class="st-chatu8-entries-empty">
                <i class="fa-solid fa-inbox"></i>
                <p>暂无条目，点击上方按钮添加</p>
            </div>
        `);
        return;
    }

    // 条目少于50个时不使用虚拟滚动
    if (entriesData.length < 50) {
        virtualScrollEnabled = false;
        entriesData.forEach((entry, index) => {
            addPresetEntryDOM(entry, index);
        });
        return;
    }

    // 启用虚拟滚动
    virtualScrollEnabled = true;
    const totalHeight = entriesData.length * VIRTUAL_ITEM_HEIGHT;

    // 创建虚拟滚动结构
    presetEntriesContainer.html(`
        <div class="st-chatu8-virtual-spacer" style="height: ${totalHeight}px; position: relative;">
            <div class="st-chatu8-virtual-content" style="position: absolute; left: 0; right: 0; top: 0;"></div>
        </div>
    `);

    virtualScrollSpacer = presetEntriesContainer.find('.st-chatu8-virtual-spacer');
    virtualScrollContainer = presetEntriesContainer.find('.st-chatu8-virtual-content');

    // 绑定滚动事件
    presetEntriesContainer.off('scroll.virtual').on('scroll.virtual', onVirtualScroll);

    // 初始渲染
    updateVirtualScroll();
}

/**
 * 虚拟滚动事件处理
 */
function onVirtualScroll() {
    requestAnimationFrame(updateVirtualScroll);
}

/**
 * 更新虚拟滚动渲染 - 优化版本
 * 每个条目独立定位，不移动容器，滚动完全依赖原生滚动
 */
function updateVirtualScroll() {
    if (!virtualScrollEnabled || !virtualScrollContainer || virtualEntriesData.length === 0) return;

    const container = presetEntriesContainer[0];
    const scrollTop = container.scrollTop;
    const viewportHeight = container.clientHeight;

    // 计算可见范围（使用更大的缓冲区确保流畅）
    let startIndex = Math.floor(scrollTop / VIRTUAL_ITEM_HEIGHT) - VIRTUAL_BUFFER;
    let endIndex = Math.ceil((scrollTop + viewportHeight) / VIRTUAL_ITEM_HEIGHT) + VIRTUAL_BUFFER;

    // 边界约束
    startIndex = Math.max(0, startIndex);
    endIndex = Math.min(virtualEntriesData.length - 1, endIndex);

    // 如果范围没变化，不重新渲染
    if (startIndex === lastRenderedRange.start && endIndex === lastRenderedRange.end) {
        return;
    }

    // 增量更新：只添加/移除变化的条目
    const oldStart = lastRenderedRange.start;
    const oldEnd = lastRenderedRange.end;

    lastRenderedRange = { start: startIndex, end: endIndex };

    // 首次渲染或范围完全不重叠时，全量渲染
    if (oldStart === -1 || endIndex < oldStart || startIndex > oldEnd) {
        virtualScrollContainer.empty();
        for (let i = startIndex; i <= endIndex; i++) {
            const entry = virtualEntriesData[i];
            if (entry) {
                addPresetEntryDOMToContainerAbsolute(entry, i, virtualScrollContainer);
            }
        }
        return;
    }

    // 移除不再可见的条目（顶部）
    if (startIndex > oldStart) {
        virtualScrollContainer.children().each(function () {
            const idx = parseInt($(this).attr('data-entry-index'), 10);
            if (idx < startIndex) {
                $(this).remove();
            }
        });
    }

    // 移除不再可见的条目（底部）
    if (endIndex < oldEnd) {
        virtualScrollContainer.children().each(function () {
            const idx = parseInt($(this).attr('data-entry-index'), 10);
            if (idx > endIndex) {
                $(this).remove();
            }
        });
    }

    // 添加新进入可见区域的条目（顶部）
    if (startIndex < oldStart) {
        const fragment = document.createDocumentFragment();
        for (let i = startIndex; i < oldStart && i <= endIndex; i++) {
            const entry = virtualEntriesData[i];
            if (entry) {
                const elem = createEntryElementAbsolute(entry, i);
                fragment.appendChild(elem);
            }
        }
        virtualScrollContainer.prepend(fragment);
    }

    // 添加新进入可见区域的条目（底部）
    if (endIndex > oldEnd) {
        const fragment = document.createDocumentFragment();
        for (let i = Math.max(oldEnd + 1, startIndex); i <= endIndex; i++) {
            const entry = virtualEntriesData[i];
            if (entry) {
                const elem = createEntryElementAbsolute(entry, i);
                fragment.appendChild(elem);
            }
        }
        virtualScrollContainer.append(fragment);
    }
}

/**
 * 创建条目 DOM 元素到指定容器
 * @param {object} entry - 条目数据
 * @param {number} index - 索引
 * @param {jQuery} container - 目标容器
 */
function addPresetEntryDOMToContainer(entry, index, container) {
    const entryId = entry.id || generateEntryId();
    const entryName = entry.name || `条目 ${index + 1}`;
    const entryRole = entry.role || 'user';
    const entryContent = entry.content || '';
    const entryEnabled = entry.enabled !== false;
    const triggerMode = entry.triggerMode || 'always';
    const triggerWords = entry.triggerWords || '';
    const andTriggerWords = entry.andTriggerWords || '';

    const disabledClass = entryEnabled ? '' : 'disabled';
    const contentPreview = entryContent.length > 50 ? entryContent.substring(0, 50) + '...' : (entryContent || '(空)');

    const entryElement = $(`
        <div class="st-chatu8-preset-entry st-chatu8-preset-entry-collapsed ${disabledClass}" 
             data-entry-id="${entryId}" 
             data-entry-index="${index}"
             data-role="${entryRole}" 
             data-trigger-mode="${triggerMode}"
             data-trigger-words="${escapeHtml(triggerWords)}"
             data-and-trigger-words="${escapeHtml(andTriggerWords)}"
             draggable="true"
             style="min-height: ${VIRTUAL_ITEM_HEIGHT}px; box-sizing: border-box;">
            <div class="st-chatu8-entry-header">
                <span class="st-chatu8-entry-drag-handle" title="拖拽排序">
                    <i class="fa-solid fa-grip-vertical"></i>
                </span>
                <span class="st-chatu8-entry-role-badge" data-role="${entryRole}">${getRoleBadgeText(entryRole)}</span>
                <input type="text" class="st-chatu8-entry-name" value="${escapeHtml(entryName)}" placeholder="条目名称" readonly />
                <span class="st-chatu8-entry-preview">${escapeHtml(contentPreview)}</span>
                <div class="st-chatu8-entry-actions">
                    <div class="st-chatu8-entry-toggle" title="启用/禁用">
                        <input type="checkbox" ${entryEnabled ? 'checked' : ''} />
                        <span class="st-chatu8-slider"></span>
                    </div>
                    <button class="st-chatu8-icon-btn st-chatu8-entry-move-btn" title="点击移动此条目">
                        <i class="fa-solid fa-arrows-up-down"></i>
                    </button>
                    <button class="st-chatu8-icon-btn st-chatu8-entry-edit" title="编辑">
                        <i class="fa-solid fa-pen"></i>
                    </button>
                    <button class="st-chatu8-icon-btn danger st-chatu8-entry-delete" title="删除条目">
                        <i class="fa-solid fa-trash"></i>
                    </button>
                </div>
            </div>
            <textarea class="st-chatu8-entry-content" style="display:none;">${escapeHtml(entryContent)}</textarea>
        </div>
    `);

    container.append(entryElement);
}

/**
 * 创建带绝对定位的条目 DOM 元素（用于流畅虚拟滚动）
 * @param {object} entry - 条目数据
 * @param {number} index - 索引
 * @returns {HTMLElement} DOM 元素
 */
function createEntryElementAbsolute(entry, index) {
    const entryId = entry.id || generateEntryId();
    const entryName = entry.name || `条目 ${index + 1}`;
    const entryRole = entry.role || 'user';
    const entryContent = entry.content || '';
    const entryEnabled = entry.enabled !== false;
    const triggerMode = entry.triggerMode || 'always';
    const triggerWords = entry.triggerWords || '';
    const andTriggerWords = entry.andTriggerWords || '';

    const disabledClass = entryEnabled ? '' : 'disabled';
    const contentPreview = entryContent.length > 50 ? entryContent.substring(0, 50) + '...' : (entryContent || '(空)');

    // 使用 transform 定位，比 top 更流畅
    const topPosition = index * VIRTUAL_ITEM_HEIGHT;

    const div = document.createElement('div');
    div.className = `st-chatu8-preset-entry st-chatu8-preset-entry-collapsed ${disabledClass}`;
    div.setAttribute('data-entry-id', entryId);
    div.setAttribute('data-entry-index', String(index));
    div.setAttribute('data-role', entryRole);
    div.setAttribute('data-trigger-mode', triggerMode);
    div.setAttribute('data-trigger-words', triggerWords);
    div.setAttribute('data-and-trigger-words', andTriggerWords);
    div.setAttribute('draggable', 'true');
    div.style.cssText = `position: absolute; left: 0; right: 0; min-height: ${VIRTUAL_ITEM_HEIGHT}px; transform: translateY(${topPosition}px); will-change: transform; overflow: visible;`;

    div.innerHTML = `
        <div class="st-chatu8-entry-header">
            <span class="st-chatu8-entry-drag-handle" title="拖拽排序">
                <i class="fa-solid fa-grip-vertical"></i>
            </span>
            <span class="st-chatu8-entry-role-badge" data-role="${entryRole}">${getRoleBadgeText(entryRole)}</span>
            <input type="text" class="st-chatu8-entry-name" value="${escapeHtml(entryName)}" placeholder="条目名称" readonly />
            <span class="st-chatu8-entry-preview">${escapeHtml(contentPreview)}</span>
            <div class="st-chatu8-entry-actions">
                <div class="st-chatu8-entry-toggle" title="启用/禁用">
                    <input type="checkbox" ${entryEnabled ? 'checked' : ''} />
                    <span class="st-chatu8-slider"></span>
                </div>
                <button class="st-chatu8-icon-btn st-chatu8-entry-move-btn" title="点击移动此条目">
                    <i class="fa-solid fa-arrows-up-down"></i>
                </button>
                <button class="st-chatu8-icon-btn st-chatu8-entry-edit" title="编辑">
                    <i class="fa-solid fa-pen"></i>
                </button>
                <button class="st-chatu8-icon-btn danger st-chatu8-entry-delete" title="删除条目">
                    <i class="fa-solid fa-trash"></i>
                </button>
            </div>
        </div>
        <textarea class="st-chatu8-entry-content" style="display:none;">${escapeHtml(entryContent)}</textarea>
    `;

    return div;
}

/**
 * 使用绝对定位添加条目 DOM 元素到容器
 * @param {object} entry - 条目数据
 * @param {number} index - 索引
 * @param {jQuery} container - 目标容器
 */
function addPresetEntryDOMToContainerAbsolute(entry, index, container) {
    const elem = createEntryElementAbsolute(entry, index);
    container.append(elem);
}

/**
 * 创建并添加单个条目 DOM 元素（折叠视图）
 * @param {object} entry - 条目数据
 * @param {number} index - 索引
 */
function addPresetEntryDOM(entry, index = -1) {
    const entryId = entry.id || generateEntryId();
    const entryName = entry.name || `条目 ${index + 1}`;
    const entryRole = entry.role || 'user';
    const entryContent = entry.content || '';
    const entryEnabled = entry.enabled !== false;
    const triggerMode = entry.triggerMode || 'always';
    const triggerWords = entry.triggerWords || '';
    const andTriggerWords = entry.andTriggerWords || '';

    const disabledClass = entryEnabled ? '' : 'disabled';
    const contentPreview = entryContent.length > 50 ? entryContent.substring(0, 50) + '...' : (entryContent || '(空)');

    const entryElement = $(`
        <div class="st-chatu8-preset-entry st-chatu8-preset-entry-collapsed ${disabledClass}" 
             data-entry-id="${entryId}" 
             data-role="${entryRole}" 
             data-trigger-mode="${triggerMode}"
             data-trigger-words="${escapeHtml(triggerWords)}"
             data-and-trigger-words="${escapeHtml(andTriggerWords)}"
             draggable="true">
            <div class="st-chatu8-entry-header">
                <span class="st-chatu8-entry-drag-handle" title="拖拽排序">
                    <i class="fa-solid fa-grip-vertical"></i>
                </span>
                <span class="st-chatu8-entry-role-badge" data-role="${entryRole}">${getRoleBadgeText(entryRole)}</span>
                <input type="text" class="st-chatu8-entry-name" value="${escapeHtml(entryName)}" placeholder="条目名称" readonly />
                <span class="st-chatu8-entry-preview">${escapeHtml(contentPreview)}</span>
                <div class="st-chatu8-entry-actions">
                    <div class="st-chatu8-entry-toggle" title="启用/禁用">
                        <input type="checkbox" ${entryEnabled ? 'checked' : ''} />
                        <span class="st-chatu8-slider"></span>
                    </div>
                    <button class="st-chatu8-icon-btn st-chatu8-entry-move-btn" title="点击移动此条目">
                        <i class="fa-solid fa-arrows-up-down"></i>
                    </button>
                    <button class="st-chatu8-icon-btn st-chatu8-entry-edit" title="编辑">
                        <i class="fa-solid fa-pen"></i>
                    </button>
                    <button class="st-chatu8-icon-btn danger st-chatu8-entry-delete" title="删除条目">
                        <i class="fa-solid fa-trash"></i>
                    </button>
                </div>
            </div>
            <!-- 隐藏的数据存储 -->
            <textarea class="st-chatu8-entry-content" style="display:none;">${escapeHtml(entryContent)}</textarea>
        </div>
    `);

    presetEntriesContainer.append(entryElement);
}

/**
 * HTML 转义
 * @param {string} text - 要转义的文本
 * @returns {string} 转义后的文本
 */
function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

/**
 * 添加新条目到列表末尾
 */
function addNewPresetEntry() {
    // 移除空状态提示
    presetEntriesContainer.find('.st-chatu8-entries-empty').remove();

    const currentCount = virtualScrollEnabled ? virtualEntriesData.length : presetEntriesContainer.find('.st-chatu8-preset-entry').length;

    const newEntry = {
        id: generateEntryId(),
        name: `条目 ${currentCount + 1}`,
        role: 'user',
        content: '',
        enabled: true,
        triggerMode: 'always',
        triggerWords: '',
        andTriggerWords: ''
    };

    // 虚拟滚动模式下，添加到内存并重新渲染
    if (virtualScrollEnabled) {
        newEntry._index = virtualEntriesData.length;
        virtualEntriesData.push(newEntry);
        // 更新总高度
        const totalHeight = virtualEntriesData.length * VIRTUAL_ITEM_HEIGHT;
        virtualScrollSpacer.css('height', totalHeight + 'px');
        // 滚动到底部
        const container = presetEntriesContainer[0];
        container.scrollTop = container.scrollHeight;
        // 强制重新渲染
        lastRenderedRange = { start: -1, end: -1 };
        updateVirtualScroll();
    } else {
        addPresetEntryDOM(newEntry);
        // 滚动到新添加的条目
        const container = presetEntriesContainer[0];
        container.scrollTop = container.scrollHeight;
    }

    toastr.success('已添加新条目');
}

/**
 * 从 UI 收集条目数据
 * @returns {object} 包含 entries 数组的对象
 */
function collectTestContextDataFromUI() {
    // 虚拟滚动模式下，从内存数据收集
    if (virtualScrollEnabled && virtualEntriesData.length > 0) {
        return {
            entries: virtualEntriesData.map(e => ({
                id: e.id,
                name: e.name,
                role: e.role,
                content: e.content,
                enabled: e.enabled,
                triggerMode: e.triggerMode,
                triggerWords: e.triggerWords,
                andTriggerWords: e.andTriggerWords
            }))
        };
    }

    // 非虚拟滚动模式，从 DOM 收集
    const entries = [];
    presetEntriesContainer.find('.st-chatu8-preset-entry').each(function () {
        const $entry = $(this);
        const entry = {
            id: $entry.attr('data-entry-id'),
            name: $entry.find('.st-chatu8-entry-name').val() || '',
            role: $entry.attr('data-role') || 'user',
            content: $entry.find('.st-chatu8-entry-content').val() || '',
            enabled: $entry.find('.st-chatu8-entry-toggle input').is(':checked'),
            triggerMode: $entry.attr('data-trigger-mode') || 'always',
            triggerWords: $entry.attr('data-trigger-words') || '',
            andTriggerWords: $entry.attr('data-and-trigger-words') || ''
        };
        entries.push(entry);
    });

    return { entries };
}

// ==================== 拖拽排序 ====================

let draggedEntry = null;
let dragScrollInterval = null;
const SCROLL_THRESHOLD = 50; // 边缘滚动触发区域（像素）
const SCROLL_SPEED = 8; // 滚动速度

/**
 * 绑定拖拽事件
 */
function bindDragEvents() {
    presetEntriesContainer.on('dragstart', '.st-chatu8-preset-entry', function (e) {
        draggedEntry = this;
        $(this).addClass('dragging');
        e.originalEvent.dataTransfer.effectAllowed = 'move';
    });

    presetEntriesContainer.on('dragend', '.st-chatu8-preset-entry', function () {
        $(this).removeClass('dragging');
        presetEntriesContainer.find('.st-chatu8-preset-entry').removeClass('drag-over');
        draggedEntry = null;
        // 清理边缘滚动定时器
        if (dragScrollInterval) {
            clearInterval(dragScrollInterval);
            dragScrollInterval = null;
        }
    });

    presetEntriesContainer.on('dragover', '.st-chatu8-preset-entry', function (e) {
        e.preventDefault();
        e.originalEvent.dataTransfer.dropEffect = 'move';

        if (this !== draggedEntry) {
            presetEntriesContainer.find('.st-chatu8-preset-entry').removeClass('drag-over');
            $(this).addClass('drag-over');
        }
    });

    // 容器级别的 dragover 用于检测边缘滚动
    presetEntriesContainer.on('dragover', function (e) {
        e.preventDefault();

        if (!draggedEntry) return;

        const container = presetEntriesContainer[0];
        if (!container) return;
        const containerRect = container.getBoundingClientRect();
        const mouseY = e.originalEvent.clientY;

        // 检测是否接近上边缘或下边缘
        const distanceFromTop = mouseY - containerRect.top;
        const distanceFromBottom = containerRect.bottom - mouseY;

        // 清除之前的滚动
        if (dragScrollInterval) {
            clearInterval(dragScrollInterval);
            dragScrollInterval = null;
        }

        if (distanceFromTop < SCROLL_THRESHOLD && container.scrollTop > 0) {
            // 向上滚动
            dragScrollInterval = setInterval(() => {
                container.scrollTop -= SCROLL_SPEED;
                if (container.scrollTop <= 0) {
                    clearInterval(dragScrollInterval);
                    dragScrollInterval = null;
                }
            }, 16);
        } else if (distanceFromBottom < SCROLL_THRESHOLD &&
            container.scrollTop < container.scrollHeight - container.clientHeight) {
            // 向下滚动
            dragScrollInterval = setInterval(() => {
                container.scrollTop += SCROLL_SPEED;
                if (container.scrollTop >= container.scrollHeight - container.clientHeight) {
                    clearInterval(dragScrollInterval);
                    dragScrollInterval = null;
                }
            }, 16);
        }
    });

    presetEntriesContainer.on('drop', '.st-chatu8-preset-entry', function (e) {
        e.preventDefault();

        // 清理边缘滚动定时器
        if (dragScrollInterval) {
            clearInterval(dragScrollInterval);
            dragScrollInterval = null;
        }

        if (this !== draggedEntry && draggedEntry) {
            const $target = $(this);
            const $dragged = $(draggedEntry);

            // 判断插入位置
            const targetRect = this.getBoundingClientRect();
            const mouseY = e.originalEvent.clientY;
            const insertAfter = mouseY > targetRect.top + targetRect.height / 2;

            // 虚拟滚动模式下，同步更新内存数据
            if (virtualScrollEnabled) {
                const draggedIndex = parseInt($dragged.attr('data-entry-index'), 10);
                const targetIndex = parseInt($target.attr('data-entry-index'), 10);

                if (!isNaN(draggedIndex) && !isNaN(targetIndex) && draggedIndex !== targetIndex) {
                    // 从数组中移除被拖拽的元素
                    const [movedItem] = virtualEntriesData.splice(draggedIndex, 1);

                    // 计算新的插入位置
                    let newIndex = targetIndex;
                    if (draggedIndex < targetIndex) {
                        // 从前往后拖，目标索引需要减1（因为已经移除了一个元素）
                        newIndex = insertAfter ? targetIndex : targetIndex - 1;
                    } else {
                        // 从后往前拖
                        newIndex = insertAfter ? targetIndex + 1 : targetIndex;
                    }

                    // 插入到新位置
                    virtualEntriesData.splice(newIndex, 0, movedItem);

                    // 重新计算所有条目的索引
                    virtualEntriesData.forEach((entry, i) => {
                        entry._index = i;
                    });

                    // 强制重新渲染
                    lastRenderedRange = { start: -1, end: -1 };
                    updateVirtualScroll();
                }
            } else {
                // 非虚拟滚动模式，直接操作 DOM
                if (insertAfter) {
                    $target.after($dragged);
                } else {
                    $target.before($dragged);
                }
            }
        }

        presetEntriesContainer.find('.st-chatu8-preset-entry').removeClass('drag-over');
    });

    // 拖拽离开容器时清除滚动
    presetEntriesContainer.on('dragleave', function (e) {
        // 只在真正离开容器时清除（不是移到子元素）
        const container = presetEntriesContainer[0];
        if (!container) return;
        const containerRect = container.getBoundingClientRect();
        const mouseX = e.originalEvent.clientX;
        const mouseY = e.originalEvent.clientY;

        if (mouseX < containerRect.left || mouseX > containerRect.right ||
            mouseY < containerRect.top || mouseY > containerRect.bottom) {
            if (dragScrollInterval) {
                clearInterval(dragScrollInterval);
                dragScrollInterval = null;
            }
        }
    });
}

// ==================== 点击移动排序 ====================
let activeMoveSourceEntry = null;

function cancelMoveMode() {
    if (activeMoveSourceEntry) {
        activeMoveSourceEntry.removeClass('moving-source');
        activeMoveSourceEntry.find('.st-chatu8-entry-move-btn').removeClass('active');
        activeMoveSourceEntry = null;
        presetEntriesContainer.removeClass('move-mode');
    }
}

/**
 * 绑定条目事件（使用事件委托）
 */
function bindEntryEvents() {
    // 监听全局点击以取消移动模式
    $(document).on('click', function(e) {
        if (activeMoveSourceEntry && !$(e.target).closest('.st-chatu8-entry-move-btn').length) {
            cancelMoveMode();
        }
    });

    // 点击移动按钮
    presetEntriesContainer.on('click', '.st-chatu8-entry-move-btn', function (e) {
        e.stopPropagation();
        const $entry = $(this).closest('.st-chatu8-preset-entry');
        
        if (!activeMoveSourceEntry) {
            // 激活移动模式
            activeMoveSourceEntry = $entry;
            $entry.addClass('moving-source');
            $(this).addClass('active');
            presetEntriesContainer.addClass('move-mode');
            toastr.info('请点击要移动到的目标条目的移动按钮');
        } else {
            // 已经在移动模式
            if (activeMoveSourceEntry[0] === $entry[0]) {
                // 点击自己，取消移动
                cancelMoveMode();
                return;
            }
            
            // 点击了其他条目，执行移动到该条目下方
            const $source = activeMoveSourceEntry;
            const $target = $entry;
            
            // 虚拟滚动模式下，同步更新内存数据
            if (virtualScrollEnabled) {
                const sourceIndex = parseInt($source.attr('data-entry-index'), 10);
                const targetIndex = parseInt($target.attr('data-entry-index'), 10);
                
                if (!isNaN(sourceIndex) && !isNaN(targetIndex)) {
                    const [movedItem] = virtualEntriesData.splice(sourceIndex, 1);
                    
                    let newIndex = targetIndex;
                    if (sourceIndex < targetIndex) {
                        // 从前往后拖，目标索引已经少1，插入到其下方就是原来的targetIndex
                        newIndex = targetIndex;
                    } else {
                        // 从后往前拖，插入到其下方就是targetIndex + 1
                        newIndex = targetIndex + 1;
                    }
                    
                    virtualEntriesData.splice(newIndex, 0, movedItem);
                    
                    // 重新计算索引
                    virtualEntriesData.forEach((item, i) => item._index = i);
                    
                    // 强制重新渲染
                    lastRenderedRange = { start: -1, end: -1 };
                    updateVirtualScroll();
                }
            } else {
                // 非虚拟滚动，直接操作 DOM
                $target.after($source);
            }
            
            cancelMoveMode();
        }
    });

    // 编辑按钮点击 - 打开编辑弹窗
    presetEntriesContainer.on('click', '.st-chatu8-entry-edit', function (e) {
        e.stopPropagation();
        const $entry = $(this).closest('.st-chatu8-preset-entry');
        // 虚拟滚动模式下，先从内存加载完整数据到 DOM
        if (virtualScrollEnabled) {
            const entryIndex = parseInt($entry.attr('data-entry-index'), 10);
            if (!isNaN(entryIndex) && virtualEntriesData[entryIndex]) {
                const data = virtualEntriesData[entryIndex];
                $entry.find('.st-chatu8-entry-content').val(data.content || '');
            }
        }
        showEntryEditModal($entry);
    });

    // 启用/禁用切换
    presetEntriesContainer.on('change', '.st-chatu8-entry-toggle input', function () {
        const $entry = $(this).closest('.st-chatu8-preset-entry');
        const enabled = $(this).is(':checked');
        if (enabled) {
            $entry.removeClass('disabled');
        } else {
            $entry.addClass('disabled');
        }
        // 虚拟滚动模式下，同步更新内存数据
        if (virtualScrollEnabled) {
            const entryIndex = parseInt($entry.attr('data-entry-index'), 10);
            if (!isNaN(entryIndex) && virtualEntriesData[entryIndex]) {
                virtualEntriesData[entryIndex].enabled = enabled;
            }
        }
    });

    // 删除条目
    presetEntriesContainer.on('click', '.st-chatu8-entry-delete', function (e) {
        e.stopPropagation();
        const totalCount = virtualScrollEnabled ? virtualEntriesData.length : presetEntriesContainer.find('.st-chatu8-preset-entry').length;
        if (totalCount <= 1) {
            toastr.warning('至少需要保留一个条目');
            return;
        }

        const $entry = $(this).closest('.st-chatu8-preset-entry');

        // 虚拟滚动模式下，从内存删除并重新渲染
        if (virtualScrollEnabled) {
            const entryIndex = parseInt($entry.attr('data-entry-index'), 10);
            if (!isNaN(entryIndex)) {
                virtualEntriesData.splice(entryIndex, 1);
                // 重新计算索引
                virtualEntriesData.forEach((e, i) => e._index = i);
                // 更新总高度
                const totalHeight = virtualEntriesData.length * VIRTUAL_ITEM_HEIGHT;
                virtualScrollSpacer.css('height', totalHeight + 'px');
                // 强制重新渲染
                lastRenderedRange = { start: -1, end: -1 };
                updateVirtualScroll();
            }
        } else {
            $entry.remove();
        }
        toastr.info('已删除条目');
    });

    // 双击条目名称也可以打开编辑弹窗
    presetEntriesContainer.on('dblclick', '.st-chatu8-preset-entry', function (e) {
        // 不在按钮和开关上触发
        if ($(e.target).closest('.st-chatu8-entry-actions, .st-chatu8-entry-drag-handle').length) {
            return;
        }
        // 虚拟滚动模式下，先从内存加载完整数据到 DOM
        if (virtualScrollEnabled) {
            const entryIndex = parseInt($(this).attr('data-entry-index'), 10);
            if (!isNaN(entryIndex) && virtualEntriesData[entryIndex]) {
                const data = virtualEntriesData[entryIndex];
                $(this).find('.st-chatu8-entry-content').val(data.content || '');
            }
        }
        showEntryEditModal($(this));
    });
}

// ==================== LLM 配置管理 ====================

/**
 * Loads LLM profiles from settings and populates the dropdown.
 */
export function loadLLMProfiles() {
    const profiles = extension_settings[extensionName].llm_profiles || {};
    const currentProfileName = extension_settings[extensionName].current_llm_profile;

    profileSelect.empty();
    Object.keys(profiles).forEach(name => {
        const option = new Option(name, name, name === currentProfileName, name === currentProfileName);
        profileSelect.append(option);
    });

    if (profileSelect.val()) {
        profileSelect.trigger('change');
    }
}

/**
 * Loads test context profiles from settings and populates the dropdown.
 */
function loadTestContextProfiles() {
    const profiles = extension_settings[extensionName].test_context_profiles || {};
    const currentProfileName = extension_settings[extensionName].current_test_context_profile;

    testContextSelect.empty();
    Object.keys(profiles).forEach(name => {
        const option = new Option(name, name, name === currentProfileName, name === currentProfileName);
        testContextSelect.append(option);
    });

    if (testContextSelect.val()) {
        testContextSelect.trigger('change');
    }
}

/**
 * Handles the change event of the profile selection dropdown.
 */
function onProfileSelectChange() {
    const profileName = $(this).val();
    if (!profileName) return;

    const profiles = extension_settings[extensionName].llm_profiles;
    const profile = profiles[profileName];

    if (profile) {
        apiUrlInput.val(profile.api_url || '');
        apiKeyInput.val(profile.api_key || '');

        modelSelect.empty();
        const savedModel = profile.model || '';
        if (savedModel) {
            modelSelect.append(new Option(savedModel, savedModel, true, true));
        }
        modelInput.val(savedModel);

        const temp = profile.temperature ?? 0.7;
        temperatureSlider.val(temp);
        temperatureValue.val(temp);

        const topP = profile.top_p ?? 1.0;
        topPSlider.val(topP);
        topPValue.val(topP);

        const maxTokens = profile.max_tokens ?? 512;
        maxTokensSlider.val(maxTokens);
        maxTokensValue.val(maxTokens);

        const stream = profile.stream ?? false;
        streamToggle.prop('checked', stream);

        const bypassProxy = profile.bypass_proxy ?? false;
        bypassProxyToggle.prop('checked', bypassProxy);

        const mergeSystemUser = profile.merge_system_user ?? false;
        mergeSystemUserToggle.prop('checked', mergeSystemUser);

        const sendImages = profile.send_images ?? false;
        sendImagesToggle.prop('checked', sendImages);

        extension_settings[extensionName].current_llm_profile = profileName;
        saveSettingsDebounced();
    }
}

/**
 * Handles the change event of the test context selection dropdown.
 */
function onTestContextSelectChange() {
    const contextName = $(this).val();
    if (!contextName) return;

    const contexts = extension_settings[extensionName].test_context_profiles;
    let context = contexts[contextName];

    if (context) {
        // 迁移旧格式数据
        const migratedContext = migrateOldContextData(context);

        // 如果发生了迁移，更新存储的数据
        if (migratedContext !== context) {
            contexts[contextName] = migratedContext;
            saveSettingsDebounced();
            context = migratedContext;
        }

        renderPresetEntries(context.entries || []);
        extension_settings[extensionName].current_test_context_profile = contextName;
        saveSettingsDebounced();
    }
}

/**
 * Collects all data from the UI into a profile object.
 * @returns {object} The profile data object.
 */
export function collectProfileDataFromUI() {
    return {
        api_url: apiUrlInput.val(),
        api_key: apiKeyInput.val(),
        model: modelInput.val() || modelSelect.val(),
        temperature: parseFloat(temperatureSlider.val()),
        top_p: parseFloat(topPSlider.val()),
        max_tokens: parseInt(maxTokensSlider.val(), 10),
        stream: streamToggle.prop('checked'),
        bypass_proxy: bypassProxyToggle.prop('checked'),
        merge_system_user: mergeSystemUserToggle.prop('checked'),
        send_images: sendImagesToggle.prop('checked')
    };
}

// ==================== 配置 CRUD 操作 ====================

/**
 * Saves the current UI content to the selected profile.
 */
function onSaveProfileClick() {
    const profileName = profileSelect.val();
    if (!profileName) {
        toastr.warning("没有选中的配置。");
        return;
    }

    extension_settings[extensionName].llm_profiles[profileName] = collectProfileDataFromUI();
    saveSettingsDebounced();
    toastr.success(`配置 "${profileName}" 已保存。`);
}

/**
 * Saves the current test context to the selected profile.
 */
function onSaveTestContextClick() {
    const contextName = testContextSelect.val();
    if (!contextName) {
        toastr.warning("没有选中的测试上下文配置。");
        return;
    }

    extension_settings[extensionName].test_context_profiles[contextName] = collectTestContextDataFromUI();
    saveSettingsDebounced();
    toastr.success(`测试上下文 "${contextName}" 已保存。`);
}

/**
 * Saves the current test context to a new profile (Save As).
 */
function onSaveAsTestContextClick() {
    const currentContextName = testContextSelect.val();
    if (!currentContextName) {
        toastr.warning("没有选中的测试上下文配置。");
        return;
    }

    const newName = prompt("请输入另存为的测试上下文名称：", currentContextName + " (副本)");
    if (!newName || newName.trim() === '') {
        toastr.warning("测试上下文名称不能为空。");
        return;
    }

    const contexts = extension_settings[extensionName].test_context_profiles;
    if (contexts[newName]) {
        toastr.error(`测试上下文 "${newName}" 已存在。请使用其他名称或先删除。`);
        return;
    }

    // 复制当前配置到新名称下
    contexts[newName] = collectTestContextDataFromUI();
    extension_settings[extensionName].current_test_context_profile = newName;
    saveSettingsDebounced();
    loadTestContextProfiles();
    
    // 刷新请求类型配置下拉框以反映更新
    populateRequestTypeSelects();
    toastr.success(`测试上下文已另存为 "${newName}"。`);
}

/**
 * Creates a new profile based on the current UI settings.
 */
function onNewProfileClick() {
    const newName = prompt("请输入新的配置名称：");
    if (!newName || newName.trim() === '') {
        toastr.warning("配置名称不能为空。");
        return;
    }

    const profiles = extension_settings[extensionName].llm_profiles;
    if (profiles[newName]) {
        toastr.error(`配置 "${newName}" 已存在。`);
        return;
    }

    // 使用空白初始值而不是继承当前 UI 的值
    profiles[newName] = {
        api_url: "",
        api_key: "",
        model: "",
        temperature: 1.0,
        top_p: 1.0,
        max_tokens: 30000,
        stream: false,
        bypass_proxy: false,
        merge_system_user: false,
        send_images: false
    };
    extension_settings[extensionName].current_llm_profile = newName;
    saveSettingsDebounced();
    loadLLMProfiles();
    // 刷新请求类型配置下拉框
    populateRequestTypeSelects();
    toastr.success(`配置 "${newName}" 已创建并选中。`);
}

/**
 * Creates a new test context profile.
 */
function onNewTestContextClick() {
    const newName = prompt("请输入新的测试上下文名称：");
    if (!newName || newName.trim() === '') {
        toastr.warning("测试上下文名称不能为空。");
        return;
    }

    const contexts = extension_settings[extensionName].test_context_profiles;
    if (contexts[newName]) {
        toastr.error(`测试上下文 "${newName}" 已存在。`);
        return;
    }

    // 使用空白初始值而不是继承当前 UI 的值
    contexts[newName] = {
        history: [
            { user: '', assistant: '' }
        ]
    };
    extension_settings[extensionName].current_test_context_profile = newName;
    saveSettingsDebounced();
    loadTestContextProfiles();
    // 刷新请求类型配置下拉框
    populateRequestTypeSelects();
    toastr.success(`测试上下文 "${newName}" 已创建并选中。`);
}

/**
 * Deletes the currently selected profile.
 */
function onDeleteProfileClick() {
    const profileName = profileSelect.val();
    if (!profileName) {
        toastr.warning("没有选中的配置。");
        return;
    }

    if (Object.keys(extension_settings[extensionName].llm_profiles).length <= 1) {
        toastr.error("不能删除最后一个配置。");
        return;
    }

    if (confirm(`你确定要删除配置 "${profileName}" 吗？`)) {
        delete extension_settings[extensionName].llm_profiles[profileName];
        extension_settings[extensionName].current_llm_profile = Object.keys(extension_settings[extensionName].llm_profiles)[0];
        saveSettingsDebounced();
        loadLLMProfiles();
        // 刷新请求类型配置下拉框
        populateRequestTypeSelects();
        toastr.success(`配置 "${profileName}" 已删除。`);
    }
}

/**
 * Renames the currently selected LLM profile.
 */
function onRenameLLMProfileClick() {
    const oldName = profileSelect.val();
    if (!oldName) {
        toastr.warning("没有选中的 LLM 配置。");
        return;
    }

    const newName = prompt("请输入新的 LLM 配置名称：", oldName);
    if (!newName || newName.trim() === '') {
        toastr.warning("LLM 配置名称不能为空。");
        return;
    }

    if (newName === oldName) {
        return; // 名称未变化
    }

    const profiles = extension_settings[extensionName].llm_profiles;
    if (profiles[newName]) {
        toastr.error(`LLM 配置 "${newName}" 已存在。`);
        return;
    }

    // 复制数据到新名称，删除旧名称
    profiles[newName] = profiles[oldName];
    delete profiles[oldName];

    // 更新当前选中的配置名称
    extension_settings[extensionName].current_llm_profile = newName;

    // 同步更新请求类型配置中引用该预设的名称
    const requestTypeConfigs = extension_settings[extensionName].llm_request_type_configs || {};
    for (const requestType in requestTypeConfigs) {
        if (requestTypeConfigs[requestType].api_profile === oldName) {
            requestTypeConfigs[requestType].api_profile = newName;
        }
    }

    saveSettingsDebounced();
    loadLLMProfiles();
    // 刷新请求类型配置下拉框以反映更新
    populateRequestTypeSelects();
    toastr.success(`LLM 配置已从 "${oldName}" 重命名为 "${newName}"。`);
}

/**
 * Deletes the currently selected test context profile.
 */
function onDeleteTestContextClick() {
    const contextName = testContextSelect.val();
    if (!contextName) {
        toastr.warning("没有选中的测试上下文配置。");
        return;
    }

    if (Object.keys(extension_settings[extensionName].test_context_profiles).length <= 1) {
        toastr.error("不能删除最后一个测试上下文配置。");
        return;
    }

    if (confirm(`你确定要删除测试上下文 "${contextName}" 吗？`)) {
        delete extension_settings[extensionName].test_context_profiles[contextName];
        extension_settings[extensionName].current_test_context_profile = Object.keys(extension_settings[extensionName].test_context_profiles)[0];
        saveSettingsDebounced();
        loadTestContextProfiles();
        // 刷新请求类型配置下拉框
        populateRequestTypeSelects();
        toastr.success(`测试上下文 "${contextName}" 已删除。`);
    }
}

/**
 * Renames the currently selected test context profile.
 */
function onRenameTestContextClick() {
    const oldName = testContextSelect.val();
    if (!oldName) {
        toastr.warning("没有选中的测试上下文配置。");
        return;
    }

    const newName = prompt("请输入新的测试上下文名称：", oldName);
    if (!newName || newName.trim() === '') {
        toastr.warning("测试上下文名称不能为空。");
        return;
    }

    if (newName === oldName) {
        return; // 名称未变化
    }

    const contexts = extension_settings[extensionName].test_context_profiles;
    if (contexts[newName]) {
        toastr.error(`测试上下文 "${newName}" 已存在。`);
        return;
    }

    // 复制数据到新名称，删除旧名称
    contexts[newName] = contexts[oldName];
    delete contexts[oldName];

    // 更新当前选中的配置名称
    extension_settings[extensionName].current_test_context_profile = newName;

    // 同步更新请求类型配置中引用该预设的名称
    const requestTypeConfigs = extension_settings[extensionName].llm_request_type_configs || {};
    for (const requestType in requestTypeConfigs) {
        if (requestTypeConfigs[requestType].context_profile === oldName) {
            requestTypeConfigs[requestType].context_profile = newName;
        }
    }

    saveSettingsDebounced();
    loadTestContextProfiles();
    // 刷新请求类型配置下拉框以反映更新
    populateRequestTypeSelects();
    toastr.success(`测试上下文已从 "${oldName}" 重命名为 "${newName}"。`);
}

// ==================== 导入/导出功能 ====================

/**
 * Exports all test context profiles to a single JSON file.
 */
function onExportAllTestContextClick() {
    const contexts = extension_settings[extensionName].test_context_profiles || {};
    const contextCount = Object.keys(contexts).length;

    if (contextCount === 0) {
        toastr.warning("没有测试上下文可导出。");
        return;
    }

    const blob = new Blob([JSON.stringify(contexts, null, 4)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `st_chatu8_all_test_contexts.json`;
    document.body.appendChild(a);
    a.click();
    URL.revokeObjectURL(url);
    document.body.removeChild(a);
    toastr.success(`成功导出 ${contextCount} 个测试上下文配置。`);
}

/**
 * Exports the selected profile to a JSON file.
 */
function onExportProfileClick() {
    const profileName = profileSelect.val();
    if (!profileName) {
        toastr.warning("没有选中的配置可导出。");
        return;
    }
    const profile = extension_settings[extensionName].llm_profiles[profileName];
    const exportData = { [profileName]: profile };
    const blob = new Blob([JSON.stringify(exportData, null, 4)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `st_chatu8_llm_profile_${profileName}.json`;
    document.body.appendChild(a);
    a.click();
    URL.revokeObjectURL(url);
    document.body.removeChild(a);
}

/**
 * Exports the selected test context to a JSON file.
 */
function onExportTestContextClick() {
    const contextName = testContextSelect.val();
    if (!contextName) {
        toastr.warning("没有选中的测试上下文可导出。");
        return;
    }
    const context = extension_settings[extensionName].test_context_profiles[contextName];
    const exportData = { [contextName]: context };
    const blob = new Blob([JSON.stringify(exportData, null, 4)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `st_chatu8_test_context_${contextName}.json`;
    document.body.appendChild(a);
    a.click();
    URL.revokeObjectURL(url);
    document.body.removeChild(a);
}

/**
 * Imports profiles from a JSON file.
 */
function onImportProfileClick() {
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
                    let importedCount = 0;
                    for (const name in importedProfiles) {
                        if (Object.prototype.hasOwnProperty.call(importedProfiles, name)) {
                            extension_settings[extensionName].llm_profiles[name] = {
                                ...(extension_settings[extensionName].llm_profiles[name] || {}),
                                ...importedProfiles[name]
                            };
                            importedCount++;
                        }
                    }
                    saveSettingsDebounced();
                    loadLLMProfiles();
                    // 刷新请求类型配置下拉框
                    populateRequestTypeSelects();
                    toastr.success(`成功导入 ${importedCount} 个配置。`);
                } catch (error) {
                    toastr.error("导入失败，文件格式无效。");
                }
            };
            reader.readAsText(file);
        }
    };
    input.click();
}

/**
 * 将 worldBooks 格式转换为内部 entries 格式
 * @param {Array} worldBooks - worldBooks 数组
 * @returns {object} 包含 entries 数组的对象
 */
function convertWorldBooksToEntries(worldBooks) {
    const entries = [];

    worldBooks.forEach((book, index) => {
        // triggerMode: "blue" = 常开, 其他 = 触发模式
        const isAlwaysOn = book.triggerMode === 'blue';
        // keywords 数组转为逗号分隔的字符串
        const triggerWords = Array.isArray(book.keywords) ? book.keywords.join(', ') : (book.keywords || '');

        entries.push({
            id: book.id || generateEntryId(),
            name: book.name || `条目 ${index + 1}`,
            role: book.role || 'system',
            content: book.content || '',
            enabled: book.enabled !== false && book.active !== false,
            triggerMode: isAlwaysOn ? 'always' : 'trigger',
            triggerWords: triggerWords
        });
    });

    return { entries };
}

/**
 * 检测导入数据的格式类型
 * @param {object|Array} data - 导入的 JSON 数据
 * @returns {string} 'worldBooksArrayOuter' | 'worldBooks' | 'standard' | 'unknown'
 */
function detectImportFormat(data) {
    // 检查是否是最外层数组，里面每个元素有 worldBooks
    // 格式: [{ id, name, worldBooks: [...] }, ...]
    if (Array.isArray(data) && data.length > 0 && data[0].worldBooks) {
        return 'worldBooksArrayOuter';
    }
    // 检查是否是单个包含 worldBooks 数组的对象
    if (data.worldBooks && Array.isArray(data.worldBooks)) {
        return 'worldBooks';
    }
    // 检查是否是标准的测试上下文格式（键值对，值包含 entries 或 history）
    if (!Array.isArray(data)) {
        const keys = Object.keys(data);
        if (keys.length > 0) {
            const firstValue = data[keys[0]];
            if (firstValue && (firstValue.entries || firstValue.history)) {
                return 'standard';
            }
        }
    }
    return 'unknown';
}

/**
 * Imports test context profiles from a JSON file.
 * 支持三种格式：
 * 1. 标准格式：{ "配置名": { entries: [...] } }
 * 2. worldBooks 格式：{ "name": "xxx", "worldBooks": [...] }
 * 3. worldBooks 数组格式：[{ "name": "xxx", "worldBooks": [...] }, ...]
 */
function onImportTestContextClick() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.onchange = (event) => {
        const file = event.target.files[0];
        if (file) {
            const reader = new FileReader();
            reader.onload = (e) => {
                try {
                    const importedData = JSON.parse(e.target.result);
                    let importedCount = 0;
                    let totalEntries = 0;
                    const format = detectImportFormat(importedData);

                    if (format === 'worldBooksArrayOuter') {
                        // 最外层是数组，每个元素都有 name 和 worldBooks
                        importedData.forEach(item => {
                            const profileName = item.name || `导入配置_${importedCount + 1}`;
                            const convertedData = convertWorldBooksToEntries(item.worldBooks);
                            extension_settings[extensionName].test_context_profiles[profileName] = convertedData;
                            importedCount++;
                            totalEntries += item.worldBooks.length;
                        });
                        toastr.success(`成功导入 ${importedCount} 个配置，共 ${totalEntries} 个条目。`);
                    } else if (format === 'worldBooks') {
                        // 单个 worldBooks 对象
                        const profileName = importedData.name || file.name.replace('.json', '');
                        const convertedData = convertWorldBooksToEntries(importedData.worldBooks);
                        extension_settings[extensionName].test_context_profiles[profileName] = convertedData;
                        importedCount = 1;
                        toastr.success(`成功导入配置 "${profileName}"，共 ${importedData.worldBooks.length} 个条目。`);
                    } else {
                        // 标准格式
                        for (const name in importedData) {
                            if (Object.prototype.hasOwnProperty.call(importedData, name)) {
                                extension_settings[extensionName].test_context_profiles[name] = {
                                    ...(extension_settings[extensionName].test_context_profiles[name] || {}),
                                    ...importedData[name]
                                };
                                importedCount++;
                            }
                        }
                        toastr.success(`成功导入 ${importedCount} 个测试上下文。`);
                    }

                    saveSettingsDebounced();
                    loadTestContextProfiles();
                    // 刷新请求类型配置下拉框
                    populateRequestTypeSelects();
                } catch (error) {
                    console.error('导入测试上下文失败:', error);
                    toastr.error("导入失败，文件格式无效。");
                }
            };
            reader.readAsText(file);
        }
    };
    input.click();
}

// ==================== 模型获取和测试 ====================

/**
 * Fetches the list of available models from the API.
 */
async function onFetchModelsClick() {
    const baseUrl = apiUrlInput.val();
    const apiKey = apiKeyInput.val();

    if (!baseUrl || !apiKey) {
        toastr.warning("请输入 API Base URL 和 API Key。");
        return;
    }

    // 使用 SillyTavern 后端代理，避免 CORS 问题
    const proxyUrl = '/api/backends/chat-completions/status';
    const customApiUrl = baseUrl.replace(/\/$/, '');
    const originalButtonText = fetchModelsButton.html();
    fetchModelsButton.html('<i class="fa-solid fa-spinner fa-spin"></i> 正在获取...');
    fetchModelsButton.prop('disabled', true);

    try {
        const response = await fetch(proxyUrl, {
            method: 'POST',
            headers: getRequestHeaders(window.token),
            body: JSON.stringify({
                chat_completion_source: 'custom',
                custom_url: customApiUrl,
                custom_include_headers: `Authorization: "Bearer ${apiKey}"`
            })
        });

        const data = await response.json();

        if (data.error) {
            throw new Error(data.error.message || JSON.stringify(data.error));
        }
        if (!response.ok) {
            throw new Error(`获取模型列表失败: ${response.status} ${response.statusText}`);
        }

        const models = data.data || [];
        // 按字母顺序排序
        models.sort((a, b) => a.id.localeCompare(b.id));
        const currentlySelected = modelSelect.val();
        modelSelect.empty();

        models.forEach(model => {
            modelSelect.append(new Option(model.id, model.id));
        });

        if (currentlySelected && models.some(m => m.id === currentlySelected)) {
            modelSelect.val(currentlySelected);
            modelInput.val(currentlySelected);
        } else if (models.length > 0) {
            // 如果之前选择的模型不在列表中，不自动选择，但保留输入框的值
        }

        toastr.success(`成功获取 ${models.length} 个模型。`);

    } catch (error) {
        toastr.error(`获取模型失败: ${error.message}`);
    } finally {
        fetchModelsButton.html(originalButtonText);
        fetchModelsButton.prop('disabled', false);
    }
}

/**
 * Handles the LLM test button click.
 */
async function onTestLLMClick() {
    let currentController = getLLMRequestController();
    if (currentController) {
        currentController.abort();
        toastr.info('LLM请求已中断，开始新请求。');
    }
    const controller = new AbortController();
    setLLMRequestController(controller);
    const signal = controller.signal;

    const currentData = collectProfileDataFromUI();
    const { api_url, api_key, model, temperature, top_p, max_tokens, bypass_proxy } = currentData;

    if (!api_url || !api_key || !model) {
        toastr.warning("请完整填写 API URL, API Key, 和模型。");
        return;
    }

    resultTextarea.val("正在请求，请稍候...");
    testButton.prop('disabled', true);

    try {
        // 使用简单的 hello 消息测试 API 连接
        const messages = [{ role: "user", content: "Hello" }];
        const body = { model, messages, temperature, top_p, max_tokens, stream: false };

        let response;

        if (bypass_proxy) {
            // 直接发送请求（不通过酒馆代理）
            const requestUrl = api_url.replace(/\/$/, '') + '/chat/completions';
            response = await fetch(requestUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${api_key}` },
                body: JSON.stringify(body),
                signal,
            });
        } else {
            // 使用 SillyTavern 后端代理，避免 CORS 问题
            const proxyUrl = '/api/backends/chat-completions/generate';
            let proxyBaseUrl = api_url.replace(/\/$/, '');

            response = await fetch(proxyUrl, {
                method: 'POST',
                headers: getRequestHeaders(window.token),
                body: JSON.stringify({
                    chat_completion_source: 'custom',
                    custom_url: proxyBaseUrl,
                    custom_include_headers: `Authorization: "Bearer ${api_key}"`,
                    ...body
                }),
                signal,
            });
        }

        const data = await response.json();

        if (data.error) {
            throw new Error(data.error.message || JSON.stringify(data.error));
        }
        if (!response.ok) {
            throw new Error(`请求失败: ${response.status} ${response.statusText}`);
        }

        const reply = data.choices?.[0]?.message?.content || "未收到有效回复。";
        resultTextarea.val(reply);
        eventSource.emit(eventNames.LLM_TEST_RESULT, { success: true, data: data });

    } catch (error) {
        if (error.name === 'AbortError') {
            resultTextarea.val('请求已中止。');
            return;
        }
        const errorMessage = `请求错误: ${error.message}`;
        resultTextarea.val(errorMessage);
        toastr.error(errorMessage);
        eventSource.emit(eventNames.LLM_TEST_RESULT, { success: false, error: errorMessage });
    } finally {
        testButton.prop('disabled', false);
        setLLMRequestController(null);
    }
}

// ==================== Prompt 构建 ====================

/**
 * Builds a prompt array from the UI entries.
 * @returns {Array} The messages array for the LLM request.
 */
function buildPrompt() {
    const testContextData = collectTestContextDataFromUI();
    const { entries } = testContextData;
    const messages = [];

    if (entries && Array.isArray(entries)) {
        entries.forEach(entry => {
            // 跳过禁用的条目
            if (!entry.enabled) return;
            // 跳过空内容
            if (!entry.content || entry.content.trim() === '') return;
            messages.push({ role: entry.role || 'user', content: entry.content });
        });
    }

    return messages;
}

/**
 * Handles the request to get a constructed prompt.
 * @param {object} data - The event data, containing { id }.
 */
function onGetPromptRequest(data) {
    const { id } = data;
    if (!id) return;

    console.log(`st-chatu8: 收到提示词获取请求 (ID: ${id})`);
    const prompt = buildPrompt();
    eventSource.emit(eventNames.LLM_GET_PROMPT_RESPONSE, { prompt: prompt, id: id });
}

// ==================== 请求类型配置 UI ====================

// ==================== 请求类型档案配置 ====================

export function loadRequestTypeProfiles(isInit = false) {
    const profiles = extension_settings[extensionName].llm_request_type_profiles || {};
    const currentProfileName = extension_settings[extensionName].current_llm_request_type_profile;

    requestTypeProfileSelect.empty();
    Object.keys(profiles).forEach(name => {
        const option = new Option(name, name, name === currentProfileName, name === currentProfileName);
        requestTypeProfileSelect.append(option);
    });

    if (requestTypeProfileSelect.val() && !isInit) {
        requestTypeProfileSelect.trigger('change');
    }
}

function onRequestTypeProfileSelectChange() {
    const profileName = $(this).val();
    if (!profileName) return;
    extension_settings[extensionName].current_llm_request_type_profile = profileName;
    saveSettingsDebounced();

    // 自动读取配置并更新 UI
    const profiles = extension_settings[extensionName].llm_request_type_profiles || {};
    const profileData = profiles[profileName];

    if (profileData) {
        // 覆盖当前工作配置
        extension_settings[extensionName].llm_request_type_configs = JSON.parse(JSON.stringify(profileData));
        saveSettingsDebounced();
        // 刷新 UI 下拉框显示
        populateRequestTypeSelects();
    }
}

function collectRequestTypeConfigFromUI() {
    return {
        image_gen: {
            api_profile: imageGenApiSelect.val() || '默认',
            context_profile: imageGenContextSelect.val() || '默认'
        },
        char_design: {
            api_profile: charDesignApiSelect.val() || '默认',
            context_profile: charDesignContextSelect.val() || '默认'
        },
        char_display: {
            api_profile: charDisplayApiSelect.val() || '默认',
            context_profile: charDisplayContextSelect.val() || '默认'
        },
        char_modify: {
            api_profile: charModifyApiSelect.val() || '默认',
            context_profile: charModifyContextSelect.val() || '默认'
        },
        translation: {
            api_profile: translationApiSelect.val() || '默认',
            context_profile: translationContextSelect.val() || '默认'
        },
        tag_modify: {
            api_profile: tagModifyApiSelect.val() || '默认',
            context_profile: tagModifyContextSelect.val() || '默认'
        },
        ai_assistant: {
            api_profile: '默认',
            context_profile: aiAssistantContextSelect.val() || '默认'
        },
        persona_gen: {
            api_profile: personaGenApiSelect.val() || '默认',
            context_profile: personaGenContextSelect.val() || '默认'
        },
        user_persona_gen: {
            api_profile: userPersonaGenApiSelect.val() || '默认',
            context_profile: userPersonaGenContextSelect.val() || '默认'
        },
        chat_summary: {
            api_profile: summaryApiSelect.val() || '默认',
            context_profile: summaryContextSelect.val() || '默认'
        }
    };
}

function onNewRequestTypeProfileClick() {
    const newName = prompt("请输入新的请求类型档案名称：");
    if (!newName || newName.trim() === '') {
        toastr.warning("名称不能为空。");
        return;
    }

    if (!extension_settings[extensionName].llm_request_type_profiles) {
        extension_settings[extensionName].llm_request_type_profiles = {};
    }

    const profiles = extension_settings[extensionName].llm_request_type_profiles;
    if (profiles[newName]) {
        toastr.error(`档案 "${newName}" 已存在。`);
        return;
    }

    profiles[newName] = collectRequestTypeConfigFromUI();

    extension_settings[extensionName].current_llm_request_type_profile = newName;
    saveSettingsDebounced();
    loadRequestTypeProfiles();
    toastr.success(`档案 "${newName}" 已创建并选中。`);
}

function onSaveRequestTypeProfileClick() {
    const profileName = requestTypeProfileSelect.val();
    if (!profileName) {
        toastr.warning("没有选中的档案。");
        return;
    }

    if (!extension_settings[extensionName].llm_request_type_profiles) {
        extension_settings[extensionName].llm_request_type_profiles = {};
    }

    extension_settings[extensionName].llm_request_type_profiles[profileName] = collectRequestTypeConfigFromUI();
    saveSettingsDebounced();
    toastr.success(`档案 "${profileName}" 已更新保存。`);
}

function onLoadRequestTypeProfileClick() {
    const profileName = requestTypeProfileSelect.val();
    if (!profileName) {
        toastr.warning("没有选中的档案。");
        return;
    }

    const profiles = extension_settings[extensionName].llm_request_type_profiles || {};
    const profileData = profiles[profileName];

    if (!profileData) {
        toastr.error(`未找到档案 "${profileName}" 的数据。`);
        return;
    }

    // 覆盖当前工作配置
    extension_settings[extensionName].llm_request_type_configs = JSON.parse(JSON.stringify(profileData));
    saveSettingsDebounced();

    // 刷新 UI
    populateRequestTypeSelects();
    toastr.success(`已读取档案 "${profileName}" 的配置。`);
}

function onRenameRequestTypeProfileClick() {
    const oldName = requestTypeProfileSelect.val();
    if (!oldName) {
        toastr.warning("没有选中的档案。");
        return;
    }

    const newName = prompt("请输入新的档案名称：", oldName);
    if (!newName || newName.trim() === '') {
        toastr.warning("名称不能为空。");
        return;
    }

    if (newName === oldName) return;

    const profiles = extension_settings[extensionName].llm_request_type_profiles;
    if (profiles[newName]) {
        toastr.error(`档案 "${newName}" 已存在。`);
        return;
    }

    profiles[newName] = profiles[oldName];
    delete profiles[oldName];

    extension_settings[extensionName].current_llm_request_type_profile = newName;
    saveSettingsDebounced();
    loadRequestTypeProfiles();
    toastr.success(`档案已从 "${oldName}" 重命名为 "${newName}"。`);
}

function onDeleteRequestTypeProfileClick() {
    const profileName = requestTypeProfileSelect.val();
    if (!profileName) {
        toastr.warning("没有选中的档案。");
        return;
    }

    if (Object.keys(extension_settings[extensionName].llm_request_type_profiles).length <= 1) {
        toastr.error("不能删除最后一个档案。");
        return;
    }

    if (confirm(`你确定要删除档案 "${profileName}" 吗？`)) {
        delete extension_settings[extensionName].llm_request_type_profiles[profileName];
        extension_settings[extensionName].current_llm_request_type_profile = Object.keys(extension_settings[extensionName].llm_request_type_profiles)[0];
        saveSettingsDebounced();
        loadRequestTypeProfiles();
        toastr.success(`档案 "${profileName}" 已删除。`);
    }
}

/**
 * 填充请求类型配置的所有下拉框
 */
export function populateRequestTypeSelects() {
    const llmProfiles = extension_settings[extensionName].llm_profiles || {};
    const contextProfiles = extension_settings[extensionName].test_context_profiles || {};
    const configs = extension_settings[extensionName].llm_request_type_configs || {};

    // 获取所有预设名称
    const llmProfileNames = Object.keys(llmProfiles);
    const contextProfileNames = Object.keys(contextProfiles);

    // 填充各个下拉框
    const apiSelects = [imageGenApiSelect, charDesignApiSelect, charDisplayApiSelect, charModifyApiSelect, translationApiSelect, tagModifyApiSelect, null, personaGenApiSelect, userPersonaGenApiSelect, summaryApiSelect];
    const contextSelects = [imageGenContextSelect, charDesignContextSelect, charDisplayContextSelect, charModifyContextSelect, translationContextSelect, tagModifyContextSelect, aiAssistantContextSelect, personaGenContextSelect, userPersonaGenContextSelect, summaryContextSelect];
    const requestTypes = [LLMRequestTypes.IMAGE_GEN, LLMRequestTypes.CHAR_DESIGN, LLMRequestTypes.CHAR_DISPLAY, LLMRequestTypes.CHAR_MODIFY, LLMRequestTypes.TRANSLATION, LLMRequestTypes.TAG_MODIFY, LLMRequestTypes.AI_ASSISTANT, LLMRequestTypes.PERSONA_GEN, LLMRequestTypes.USER_PERSONA_GEN, LLMRequestTypes.CHAT_SUMMARY];

    // 填充 API 配置下拉框
    apiSelects.forEach((select, index) => {
        if (!select || !select.length) return;
        select.empty();
        const currentConfig = configs[requestTypes[index]] || {};
        const selectedApi = currentConfig.api_profile || '默认';

        llmProfileNames.forEach(name => {
            const option = new Option(name, name, name === selectedApi, name === selectedApi);
            select.append(option);
        });
    });

    // 填充上下文预设下拉框
    contextSelects.forEach((select, index) => {
        if (!select || !select.length) return;
        select.empty();
        const currentConfig = configs[requestTypes[index]] || {};
        const selectedContext = currentConfig.context_profile || '默认';

        contextProfileNames.forEach(name => {
            const option = new Option(name, name, name === selectedContext, name === selectedContext);
            select.append(option);
        });
    });
}

/**
 * 绑定请求类型下拉框的变化事件
 */
function bindRequestTypeSelectEvents() {
    // 正文图片生成
    if (imageGenApiSelect && imageGenApiSelect.length) {
        imageGenApiSelect.on('change', function () {
            saveRequestTypeSelection(LLMRequestTypes.IMAGE_GEN, 'api_profile', $(this).val());
        });
    }
    if (imageGenContextSelect && imageGenContextSelect.length) {
        imageGenContextSelect.on('change', function () {
            saveRequestTypeSelection(LLMRequestTypes.IMAGE_GEN, 'context_profile', $(this).val());
        });
    }

    // 角色/服装设计
    if (charDesignApiSelect && charDesignApiSelect.length) {
        charDesignApiSelect.on('change', function () {
            saveRequestTypeSelection(LLMRequestTypes.CHAR_DESIGN, 'api_profile', $(this).val());
        });
    }
    if (charDesignContextSelect && charDesignContextSelect.length) {
        charDesignContextSelect.on('change', function () {
            saveRequestTypeSelection(LLMRequestTypes.CHAR_DESIGN, 'context_profile', $(this).val());
        });
    }

    // 角色/服装展示
    if (charDisplayApiSelect && charDisplayApiSelect.length) {
        charDisplayApiSelect.on('change', function () {
            saveRequestTypeSelection(LLMRequestTypes.CHAR_DISPLAY, 'api_profile', $(this).val());
        });
    }
    if (charDisplayContextSelect && charDisplayContextSelect.length) {
        charDisplayContextSelect.on('change', function () {
            saveRequestTypeSelection(LLMRequestTypes.CHAR_DISPLAY, 'context_profile', $(this).val());
        });
    }

    // 角色/服装修改
    if (charModifyApiSelect && charModifyApiSelect.length) {
        charModifyApiSelect.on('change', function () {
            saveRequestTypeSelection(LLMRequestTypes.CHAR_MODIFY, 'api_profile', $(this).val());
        });
    }
    if (charModifyContextSelect && charModifyContextSelect.length) {
        charModifyContextSelect.on('change', function () {
            saveRequestTypeSelection(LLMRequestTypes.CHAR_MODIFY, 'context_profile', $(this).val());
        });
    }

    // 翻译
    if (translationApiSelect && translationApiSelect.length) {
        translationApiSelect.on('change', function () {
            saveRequestTypeSelection(LLMRequestTypes.TRANSLATION, 'api_profile', $(this).val());
        });
    }
    if (translationContextSelect && translationContextSelect.length) {
        translationContextSelect.on('change', function () {
            saveRequestTypeSelection(LLMRequestTypes.TRANSLATION, 'context_profile', $(this).val());
        });
    }

    // Tag修改
    if (tagModifyApiSelect && tagModifyApiSelect.length) {
        tagModifyApiSelect.on('change', function () {
            saveRequestTypeSelection(LLMRequestTypes.TAG_MODIFY, 'api_profile', $(this).val());
        });
    }
    if (tagModifyContextSelect && tagModifyContextSelect.length) {
        tagModifyContextSelect.on('change', function () {
            saveRequestTypeSelection(LLMRequestTypes.TAG_MODIFY, 'context_profile', $(this).val());
        });
    }

    // 智绘姬助手（API配置使用智绘姬AI面板，此处只保留上下文预设）
    if (aiAssistantContextSelect && aiAssistantContextSelect.length) {
        aiAssistantContextSelect.on('change', function () {
            saveRequestTypeSelection(LLMRequestTypes.AI_ASSISTANT, 'context_profile', $(this).val());
        });
    }

    // 人设生成
    if (personaGenApiSelect && personaGenApiSelect.length) {
        personaGenApiSelect.on('change', function () {
            saveRequestTypeSelection(LLMRequestTypes.PERSONA_GEN, 'api_profile', $(this).val());
        });
    }
    if (personaGenContextSelect && personaGenContextSelect.length) {
        personaGenContextSelect.on('change', function () {
            saveRequestTypeSelection(LLMRequestTypes.PERSONA_GEN, 'context_profile', $(this).val());
        });
    }

    // User 人设生成
    if (userPersonaGenApiSelect && userPersonaGenApiSelect.length) {
        userPersonaGenApiSelect.on('change', function () {
            saveRequestTypeSelection(LLMRequestTypes.USER_PERSONA_GEN, 'api_profile', $(this).val());
        });
    }
    if (userPersonaGenContextSelect && userPersonaGenContextSelect.length) {
        userPersonaGenContextSelect.on('change', function () {
            saveRequestTypeSelection(LLMRequestTypes.USER_PERSONA_GEN, 'context_profile', $(this).val());
        });
    }

    // 聊天总结
    if (summaryApiSelect && summaryApiSelect.length) {
        summaryApiSelect.on('change', function () {
            saveRequestTypeSelection(LLMRequestTypes.CHAT_SUMMARY, 'api_profile', $(this).val());
        });
    }
    if (summaryContextSelect && summaryContextSelect.length) {
        summaryContextSelect.on('change', function () {
            saveRequestTypeSelection(LLMRequestTypes.CHAT_SUMMARY, 'context_profile', $(this).val());
        });
    }
}

/**
 * 保存请求类型的选择
 * @param {string} requestType - 请求类型
 * @param {string} field - 字段名 ('api_profile' 或 'context_profile')
 * @param {string} value - 选择的值
 */
function saveRequestTypeSelection(requestType, field, value) {
    if (!extension_settings[extensionName].llm_request_type_configs) {
        extension_settings[extensionName].llm_request_type_configs = {};
    }
    if (!extension_settings[extensionName].llm_request_type_configs[requestType]) {
        extension_settings[extensionName].llm_request_type_configs[requestType] = {
            api_profile: '默认',
            context_profile: '默认'
        };
    }

    extension_settings[extensionName].llm_request_type_configs[requestType][field] = value;
    saveSettingsDebounced();

    const typeNames = {
        'image_gen': '正文图片生成',
        'char_design': '角色/服装设计',
        'char_display': '角色/服装展示',
        'char_modify': '角色/服装修改',
        'translation': '翻译',
        'tag_modify': 'Tag修改',
        'ai_assistant': '智绘姬助手',
        'persona_gen': '人设生成',
        'chat_summary': '聊天总结'
    };
    const fieldNames = {
        'api_profile': 'API 配置',
        'context_profile': '上下文预设'
    };
    console.log(`st-chatu8: ${typeNames[requestType]} 的 ${fieldNames[field]} 已更改为 "${value}"`);
}

// ==================== 请求处理器（使用服务层） ====================

/**
 * 处理正文图片生成的提示词获取请求
 * @param {object} data - 事件数据，包含 { id }
 */
function onImageGenGetPromptRequest(data) {
    const { id } = data;
    if (!id) return;

    console.log(`st-chatu8: 收到正文图片生成提示词获取请求 (ID: ${id})`);
    const prompt = buildPromptForRequestType(LLMRequestTypes.IMAGE_GEN);
    eventSource.emit(eventNames.LLM_IMAGE_GEN_GET_PROMPT_RESPONSE, { prompt: prompt, id: id });
}

/**
 * 处理角色/服装设计的提示词获取请求
 * @param {object} data - 事件数据，包含 { id }
 */
function onCharDesignGetPromptRequest(data) {
    const { id } = data;
    if (!id) return;

    console.log(`st-chatu8: 收到角色/服装设计提示词获取请求 (ID: ${id})`);
    const prompt = buildPromptForRequestType(LLMRequestTypes.CHAR_DESIGN);
    eventSource.emit(eventNames.LLM_CHAR_DESIGN_GET_PROMPT_RESPONSE, { prompt: prompt, id: id });
}

/**
 * 处理角色/服装展示的提示词获取请求
 * @param {object} data - 事件数据，包含 { id }
 */
function onCharDisplayGetPromptRequest(data) {
    const { id } = data;
    if (!id) return;

    console.log(`st-chatu8: 收到角色/服装展示提示词获取请求 (ID: ${id})`);
    const prompt = buildPromptForRequestType(LLMRequestTypes.CHAR_DISPLAY);
    eventSource.emit(eventNames.LLM_CHAR_DISPLAY_GET_PROMPT_RESPONSE, { prompt: prompt, id: id });
}

/**
 * 处理角色/服装修改的提示词获取请求
 * @param {object} data - 事件数据，包含 { id }
 */
function onCharModifyGetPromptRequest(data) {
    const { id } = data;
    if (!id) return;

    console.log(`st-chatu8: 收到角色/服装修改提示词获取请求 (ID: ${id})`);
    const prompt = buildPromptForRequestType(LLMRequestTypes.CHAR_MODIFY);
    eventSource.emit(eventNames.LLM_CHAR_MODIFY_GET_PROMPT_RESPONSE, { prompt: prompt, id: id });
}

/**
 * 处理翻译的提示词获取请求
 * @param {object} data - 事件数据，包含 { id }
 */
function onTranslationGetPromptRequest(data) {
    const { id } = data;
    if (!id) return;

    console.log(`st-chatu8: 收到翻译提示词获取请求 (ID: ${id})`);
    const prompt = buildPromptForRequestType(LLMRequestTypes.TRANSLATION);
    eventSource.emit(eventNames.LLM_TRANSLATION_GET_PROMPT_RESPONSE, { prompt: prompt, id: id });
}

/**
 * 处理Tag修改的提示词获取请求
 * @param {object} data - 事件数据，包含 { id }
 */
function onTagModifyGetPromptRequest(data) {
    const { id } = data;
    if (!id) return;

    console.log(`st-chatu8: 收到Tag修改提示词获取请求 (ID: ${id})`);
    const prompt = buildPromptForRequestType(LLMRequestTypes.TAG_MODIFY);
    eventSource.emit(eventNames.LLM_TAG_MODIFY_GET_PROMPT_RESPONSE, { prompt: prompt, id: id });
}

/**
 * 处理 LLM 执行请求（使用 UI 配置）
 * @param {object} data - 事件数据，包含 { prompt, id }
 */
async function onExecuteRequest(data) {
    const profileData = collectProfileDataFromUI();
    await executeDefaultLLMRequest(data, profileData, getResultTextareaUpdater());
}

/**
 * 处理正文图片生成请求
 * @param {object} data - 事件数据
 */
async function onImageGenRequest(data) {
    await executeTypedLLMRequest(data, LLMRequestTypes.IMAGE_GEN, eventNames.LLM_IMAGE_GEN_RESPONSE, getResultTextareaUpdater());
}

/**
 * 处理角色/服装设计请求
 * @param {object} data - 事件数据
 */
async function onCharDesignRequest(data) {
    await executeTypedLLMRequest(data, LLMRequestTypes.CHAR_DESIGN, eventNames.LLM_CHAR_DESIGN_RESPONSE, getResultTextareaUpdater());
}

/**
 * 处理角色/服装展示请求
 * @param {object} data - 事件数据
 */
async function onCharDisplayRequest(data) {
    await executeTypedLLMRequest(data, LLMRequestTypes.CHAR_DISPLAY, eventNames.LLM_CHAR_DISPLAY_RESPONSE, getResultTextareaUpdater());
}

/**
 * 处理角色/服装修改请求
 * @param {object} data - 事件数据
 */
async function onCharModifyRequest(data) {
    await executeTypedLLMRequest(data, LLMRequestTypes.CHAR_MODIFY, eventNames.LLM_CHAR_MODIFY_RESPONSE, getResultTextareaUpdater());
}

/**
 * 处理翻译请求
 * @param {object} data - 事件数据
 */
async function onTranslationRequest(data) {
    await executeTypedLLMRequest(data, LLMRequestTypes.TRANSLATION, eventNames.LLM_TRANSLATION_RESPONSE, getResultTextareaUpdater());
}

/**
 * 处理Tag修改请求
 * @param {object} data - 事件数据
 */
async function onTagModifyRequest(data) {
    await executeTypedLLMRequest(data, LLMRequestTypes.TAG_MODIFY, eventNames.LLM_TAG_MODIFY_RESPONSE, getResultTextareaUpdater());
}

/**
 * 处理人设生成的提示词获取请求
 * @param {object} data - 事件数据，包含 { id }
 */
function onPersonaGenGetPromptRequest(data) {
    const { id } = data;
    if (!id) return;

    console.log(`st-chatu8: 收到人设生成提示词获取请求 (ID: ${id})`);
    const prompt = buildPromptForRequestType(LLMRequestTypes.PERSONA_GEN);
    eventSource.emit(eventNames.LLM_PERSONA_GEN_GET_PROMPT_RESPONSE, { prompt: prompt, id: id });
}

/**
 * 处理人设生成请求
 * @param {object} data - 事件数据
 */
async function onPersonaGenRequest(data) {
    // 显示组合提示词，方便调试
    if (data.prompt) {
        updateCombinedPrompt(data.prompt);
    }
    await executeTypedLLMRequest(data, LLMRequestTypes.PERSONA_GEN, eventNames.LLM_PERSONA_GEN_RESPONSE, getResultTextareaUpdater());
}

/**
 * 处理 User 人设生成请求
 * @param {object} data - 事件数据
 */
async function onUserPersonaGenRequest(data) {
    // 显示组合提示词，方便调试
    if (data.prompt) {
        updateCombinedPrompt(data.prompt);
    }
    await executeTypedLLMRequest(data, LLMRequestTypes.USER_PERSONA_GEN, eventNames.LLM_USER_PERSONA_GEN_RESPONSE, getResultTextareaUpdater());
}

// ==================== 初始化 ====================

/**
 * 缓存 DOM 元素
 */
export function cacheDOMElements() {
    // Cache DOM elements
    profileSelect = $('#ch-llm_profile_select');
    apiUrlInput = $('#ch-llm_api_url');
    apiKeyInput = $('#ch-llm_api_key');
    modelSelect = $('#ch-llm_model_select');
    modelInput = $('#ch-llm_model_input');
    fetchModelsButton = $('#ch-llm_fetch_models_button');
    temperatureSlider = $('#ch-llm_temperature');
    temperatureValue = $('#ch-llm_temperature_value');
    topPSlider = $('#ch-llm_top_p');
    topPValue = $('#ch-llm_top_p_value');
    maxTokensSlider = $('#ch-llm_max_tokens');
    maxTokensValue = $('#ch-llm_max_tokens_value');
    testContextSelect = $('#ch-test_context_select');
    presetEntriesContainer = $('#ch-preset-entries-container');
    testButton = $('#ch-llm_test_button');
    resultTextarea = $('#ch-llm_test_result');
    combinedPromptTextarea = $('#ch-llm_combined_prompt');
    streamToggle = $('#ch-llm_stream');
    bypassProxyToggle = $('#ch-llm_bypass_proxy');
    mergeSystemUserToggle = $('#ch-llm_merge_system_user');
    sendImagesToggle = $('#ch-llm_send_images');
    historyDepthSlider = $('#ch-llm_history_depth');
    historyDepthValue = $('#ch-llm_history_depth_value');
    retryCountSlider = $('#ch-llm_retry_count');
    retryCountValue = $('#ch-llm_retry_count_value');

    // 请求类型配置下拉框
    imageGenApiSelect = $('#ch-llm_image_gen_api_select');
    imageGenContextSelect = $('#ch-llm_image_gen_context_select');
    charDesignApiSelect = $('#ch-llm_char_design_api_select');
    charDesignContextSelect = $('#ch-llm_char_design_context_select');
    charDisplayApiSelect = $('#ch-llm_char_display_api_select');
    charDisplayContextSelect = $('#ch-llm_char_display_context_select');
    charModifyApiSelect = $('#ch-llm_char_modify_api_select');
    charModifyContextSelect = $('#ch-llm_char_modify_context_select');
    translationApiSelect = $('#ch-llm_translation_api_select');
    translationContextSelect = $('#ch-llm_translation_context_select');
    tagModifyApiSelect = $('#ch-llm_tag_modify_api_select');
    tagModifyContextSelect = $('#ch-llm_tag_modify_context_select');
    aiAssistantContextSelect = $('#ch-llm_ai_assistant_context_select');
    personaGenApiSelect = $('#ch-llm_persona_gen_api_select');
    personaGenContextSelect = $('#ch-llm_persona_gen_context_select');
    userPersonaGenApiSelect = $('#ch-llm_user_persona_gen_api_select');
    userPersonaGenContextSelect = $('#ch-llm_user_persona_gen_context_select');
    summaryApiSelect = $('#ch-llm_summary_api_select');
    summaryContextSelect = $('#ch-llm_summary_context_select');

    // 请求类型档案按钮
    requestTypeProfileSelect = $('#ch-llm_request_type_profile_select');
    loadRequestTypeProfileBtn = $('#ch-load_llm_request_type_profile_button');
    newRequestTypeProfileBtn = $('#ch-new_llm_request_type_profile_button');
    saveRequestTypeProfileBtn = $('#ch-save_llm_request_type_profile_button');
    renameRequestTypeProfileBtn = $('#ch-rename_llm_request_type_profile_button');
    deleteRequestTypeProfileBtn = $('#ch-delete_llm_request_type_profile_button');
}

/**
 * 绑定所有 UI 事件
 */
export function bindUIEvents() {
    // Bind LLM profile management listeners
    $('#ch-new_llm_profile_button').on('click', onNewProfileClick);
    $('#ch-save_llm_profile_button').on('click', onSaveProfileClick);
    $('#ch-rename_llm_profile_button').on('click', onRenameLLMProfileClick);
    $('#ch-delete_llm_profile_button').on('click', onDeleteProfileClick);
    $('#ch-import_llm_profile_button').on('click', onImportProfileClick);
    $('#ch-export_llm_profile_button').on('click', onExportProfileClick);
    profileSelect.on('change', onProfileSelectChange);

    // Bind test context management listeners
    $('#ch-new_test_context_button').on('click', onNewTestContextClick);
    $('#ch-save_test_context_button').on('click', onSaveTestContextClick);
    $('#ch-save_as_test_context_button').on('click', onSaveAsTestContextClick);
    $('#ch-rename_test_context_button').on('click', onRenameTestContextClick);
    $('#ch-delete_test_context_button').on('click', onDeleteTestContextClick);
    $('#ch-import_test_context_button').on('click', onImportTestContextClick);
    $('#ch-export_test_context_button').on('click', onExportTestContextClick);
    $('#ch-export_all_test_context_button').on('click', onExportAllTestContextClick);
    testContextSelect.on('change', onTestContextSelectChange);

    // 绑定添加条目按钮
    $('#ch-add_preset_entry_button').on('click', addNewPresetEntry);

    // 绑定请求类型档案按钮
    loadRequestTypeProfileBtn.on('click', onLoadRequestTypeProfileClick);
    newRequestTypeProfileBtn.on('click', onNewRequestTypeProfileClick);
    saveRequestTypeProfileBtn.on('click', onSaveRequestTypeProfileClick);
    renameRequestTypeProfileBtn.on('click', onRenameRequestTypeProfileClick);
    deleteRequestTypeProfileBtn.on('click', onDeleteRequestTypeProfileClick);
    requestTypeProfileSelect.on('change', onRequestTypeProfileSelectChange);

    // 绑定条目事件（拖拽和交互）
    bindDragEvents();
    bindEntryEvents();

    // Bind other listeners
    fetchModelsButton.on('click', onFetchModelsClick);
    testButton.on('click', onTestLLMClick);

    $('#ch-llm_api_key_toggle').on('click', function () {
        const textarea = $('#ch-llm_api_key')[0];
        const icon = $(this).find('i');
        const isHidden = textarea.style.webkitTextSecurity === 'disc';
        if (isHidden) {
            textarea.style.webkitTextSecurity = 'none';
            icon.removeClass('fa-eye').addClass('fa-eye-slash');
        } else {
            textarea.style.webkitTextSecurity = 'disc';
            icon.removeClass('fa-eye-slash').addClass('fa-eye');
        }
    });

    // 统一配置自动保存逻辑（带防抖）
    let profileAutoSaveTimer = null;
    function triggerProfileAutoSave() {
        if (profileAutoSaveTimer) clearTimeout(profileAutoSaveTimer);
        profileAutoSaveTimer = setTimeout(() => {
            const profileName = profileSelect.val();
            if (profileName && extension_settings[extensionName].llm_profiles[profileName]) {
                extension_settings[extensionName].llm_profiles[profileName] = collectProfileDataFromUI();
                saveSettingsDebounced();
                console.log(`st-chatu8: 配置已自动保存 "${profileName}"`);
            }
        }, 800);
    }

    // 绑定自动保存到输入框和相关的开关
    apiUrlInput.on('input', triggerProfileAutoSave);
    apiKeyInput.on('input', triggerProfileAutoSave);
    modelInput.on('input', triggerProfileAutoSave);
    streamToggle.on('change', triggerProfileAutoSave);
    bypassProxyToggle.on('change', triggerProfileAutoSave);
    mergeSystemUserToggle.on('change', triggerProfileAutoSave);
    sendImagesToggle.on('change', triggerProfileAutoSave);

    // 模型下拉框变化时同步到输入框，并触发自动保存
    modelSelect.on('change', function () {
        const selectedModel = $(this).val();
        if (selectedModel) {
            modelInput.val(selectedModel);
        }
        triggerProfileAutoSave();
    });

    // Range slider bindings (同步滑动值并触发自动保存)
    temperatureSlider.on('input', () => { temperatureValue.val(temperatureSlider.val()); triggerProfileAutoSave(); });
    temperatureValue.on('input', () => { temperatureSlider.val(temperatureValue.val()); triggerProfileAutoSave(); });
    topPSlider.on('input', () => { topPValue.val(topPSlider.val()); triggerProfileAutoSave(); });
    topPValue.on('input', () => { topPSlider.val(topPValue.val()); triggerProfileAutoSave(); });
    maxTokensSlider.on('input', () => { maxTokensValue.val(maxTokensSlider.val()); triggerProfileAutoSave(); });
    maxTokensValue.on('input', () => { maxTokensSlider.val(maxTokensValue.val()); triggerProfileAutoSave(); });
    historyDepthSlider.on('input', () => {
        historyDepthValue.val(historyDepthSlider.val());
        extension_settings[extensionName].llm_history_depth = parseInt(historyDepthSlider.val(), 10);
        saveSettingsDebounced();
    });
    historyDepthValue.on('input', () => {
        historyDepthSlider.val(historyDepthValue.val());
        extension_settings[extensionName].llm_history_depth = parseInt(historyDepthValue.val(), 10);
        saveSettingsDebounced();
    });

    // 绑定重试次数滑块
    retryCountSlider.on('input', () => {
        retryCountValue.val(retryCountSlider.val());
        extension_settings[extensionName].llm_retry_count = parseInt(retryCountSlider.val(), 10);
        saveSettingsDebounced();
    });
    retryCountValue.on('input', () => {
        retryCountSlider.val(retryCountValue.val());
        extension_settings[extensionName].llm_retry_count = parseInt(retryCountValue.val(), 10);
        saveSettingsDebounced();
    });

    // 填充请求类型下拉框并绑定事件
    populateRequestTypeSelects();
    bindRequestTypeSelectEvents();

    // 绑定 bypass_proxy 开关警告
    bypassProxyToggle.on('change', function () {
        if ($(this).prop('checked')) {
            toastr.warning(
                '开启此选项后，将直接通过浏览器请求 API，可能存在跨域(CORS)问题。<br><br>' +
                '此功能仅用于解决酒馆同时请求导致的 bug，请确保你的 API 服务器已配置 CORS 或部署在同域下。',
                '跨域警告',
                { timeOut: 8000, closeButton: true, escapeHtml: false }
            );
        }
    });

    // 绑定 tagthink 回显开关
    $('#ch-tagthink_echo').on('change', function () {
        extension_settings[extensionName].tagthinkEcho = $(this).prop('checked') ? 'true' : 'false';
        saveSettingsDebounced();
    });

    // 绑定「历史正文保留 <image> 标签」开关（仅对生图请求生效）
    $('#ch-history_keep_image_tag').on('change', function () {
        extension_settings[extensionName].historyKeepImageTag = $(this).prop('checked');
        saveSettingsDebounced();
    });
}

/**
 * 注册事件监听器
 */
export function registerEventListeners() {
    // Listen for external requests
    eventSource.on(eventNames.LLM_GET_PROMPT_REQUEST, onGetPromptRequest);
    eventSource.on(eventNames.LLM_EXECUTE_REQUEST, onExecuteRequest);

    // 监听四种请求类型事件
    eventSource.on(eventNames.LLM_IMAGE_GEN_REQUEST, onImageGenRequest);
    eventSource.on(eventNames.LLM_CHAR_DESIGN_REQUEST, onCharDesignRequest);
    eventSource.on(eventNames.LLM_CHAR_DISPLAY_REQUEST, onCharDisplayRequest);
    eventSource.on(eventNames.LLM_CHAR_MODIFY_REQUEST, onCharModifyRequest);
    eventSource.on(eventNames.LLM_TRANSLATION_REQUEST, onTranslationRequest);
    eventSource.on(eventNames.LLM_TAG_MODIFY_REQUEST, onTagModifyRequest);

    // 监听四种请求类型的 GET_PROMPT 事件
    eventSource.on(eventNames.LLM_IMAGE_GEN_GET_PROMPT_REQUEST, onImageGenGetPromptRequest);
    eventSource.on(eventNames.LLM_CHAR_DESIGN_GET_PROMPT_REQUEST, onCharDesignGetPromptRequest);
    eventSource.on(eventNames.LLM_CHAR_DISPLAY_GET_PROMPT_REQUEST, onCharDisplayGetPromptRequest);
    eventSource.on(eventNames.LLM_CHAR_MODIFY_GET_PROMPT_REQUEST, onCharModifyGetPromptRequest);
    eventSource.on(eventNames.LLM_TRANSLATION_GET_PROMPT_REQUEST, onTranslationGetPromptRequest);
    eventSource.on(eventNames.LLM_TAG_MODIFY_GET_PROMPT_REQUEST, onTagModifyGetPromptRequest);

    // 监听人设生成事件
    eventSource.on(eventNames.LLM_PERSONA_GEN_REQUEST, onPersonaGenRequest);
    eventSource.on(eventNames.LLM_PERSONA_GEN_GET_PROMPT_REQUEST, onPersonaGenGetPromptRequest);

    // 监听 User 人设生成事件
    eventSource.on(eventNames.LLM_USER_PERSONA_GEN_REQUEST, onUserPersonaGenRequest);
    eventSource.on(eventNames.LLM_USER_PERSONA_GEN_GET_PROMPT_REQUEST, onPersonaGenGetPromptRequest);
}

/**
 * 加载初始数据
 */
export function loadInitialData() {
    loadLLMProfiles();
    loadTestContextProfiles();
    loadRequestTypeProfiles(true);

    // 加载历史层数设置
    const historyDepth = extension_settings[extensionName].llm_history_depth ?? 0;
    historyDepthSlider.val(historyDepth);
    historyDepthValue.val(historyDepth);

    // 加载 tagthink 回显设置
    const tagthinkEcho = String(extension_settings[extensionName].tagthinkEcho) === 'true';
    $('#ch-tagthink_echo').prop('checked', tagthinkEcho);

    // 加载「历史正文保留 <image> 标签」设置
    const historyKeepImageTag = extension_settings[extensionName].historyKeepImageTag === true;
    $('#ch-history_keep_image_tag').prop('checked', historyKeepImageTag);

    // 加载重试次数设置
    const retryCount = extension_settings[extensionName].llm_retry_count ?? 0;
    retryCountSlider.val(retryCount);
    retryCountValue.val(retryCount);
}
