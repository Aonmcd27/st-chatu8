import { extension_settings } from "../../../../../extensions.js";
import { saveSettingsDebounced, eventSource } from "../../../../../../script.js";
import { extensionName, eventNames } from "../config.js";
import { recordGesture, initGestureMonitor, stopGestureMonitor } from "./Drawing.js";
import { initClickTriggerMonitor, stopClickTriggerMonitor } from "./ClickTrigger.js";
import { addLog, clearLog } from '../utils.js';
import { debugLog, debugBranch, debugTimer, debugContent } from '../debugLogger.js';
import { initWordReplacementSettings, applyWordReplacement } from './wordReplacement.js';

// ==================== 正则超时检查工具 ====================

/**
 * 正则执行超时限制 (毫秒)
 */
const REGEX_TIMEOUT_MS = 1000;

/**
 * 共享的 Worker 实例（避免每次创建新 Worker 的开销）
 */
let sharedRegexWorker = null;
let sharedRegexWorkerUrl = null;

/**
 * 请求 ID 计数器
 */
let regexRequestIdCounter = 0;

/**
 * 待处理请求的 Map: requestId -> { resolve, timeoutId }
 */
const pendingRegexRequests = new Map();

/**
 * Worker 代码（支持请求 ID）
 */
const REGEX_WORKER_CODE = `
    self.onmessage = function(e) {
        const { requestId, operation, text, pattern, flags, replacement } = e.data;
        // 发送 ready 信号，通知主线程开始计时
        self.postMessage({ requestId, ready: true });
        try {
            const regex = new RegExp(pattern, flags);
            let result;
            switch(operation) {
                case 'test':
                    result = regex.test(text);
                    break;
                case 'match':
                    // 保留 index 和 input 属性，避免序列化丢失
                    const m = text.match(regex);
                    if (m) {
                        result = {
                            matches: Array.from(m),
                            index: m.index,
                            input: m.input
                        };
                    } else {
                        result = null;
                    }
                    break;
                case 'replace':
                    result = text.replace(regex, replacement);
                    break;
                case 'matchAll':
                    result = [...text.matchAll(regex)].map(m => ({
                        match: m[0],
                        index: m.index,
                        groups: m.groups || null
                    }));
                    break;
                default:
                    throw new Error('Unknown operation: ' + operation);
            }
            self.postMessage({ requestId, success: true, result });
        } catch (err) {
            self.postMessage({ requestId, success: false, error: err.message });
        }
    };
`;

/**
 * 获取或创建共享的正则 Worker
 * @returns {Worker} 共享的 Worker 实例
 */
function getSharedRegexWorker() {
    if (!sharedRegexWorker) {
        const blob = new Blob([REGEX_WORKER_CODE], { type: 'application/javascript' });
        sharedRegexWorkerUrl = URL.createObjectURL(blob);
        sharedRegexWorker = new Worker(sharedRegexWorkerUrl);

        sharedRegexWorker.onmessage = (e) => {
            const { requestId, ready, success, result, error } = e.data;

            const pending = pendingRegexRequests.get(requestId);
            if (!pending) {
                // 请求可能已超时被清理
                return;
            }

            // 收到 ready 信号时开始计时
            if (ready) {
                const timeoutId = setTimeout(() => {
                    const pendingReq = pendingRegexRequests.get(requestId);
                    if (pendingReq) {
                        pendingRegexRequests.delete(requestId);
                        pendingReq.resolve({
                            success: false,
                            error: `正则执行超时 (>${REGEX_TIMEOUT_MS}ms)`,
                            timeout: true
                        });
                    }
                    // 超时时销毁并重建 Worker，因为可能卡住了
                    destroySharedRegexWorker();
                }, REGEX_TIMEOUT_MS);

                pending.timeoutId = timeoutId;
                return;
            }

            // 收到结果，清除超时并返回
            if (pending.timeoutId) {
                clearTimeout(pending.timeoutId);
            }
            pendingRegexRequests.delete(requestId);
            pending.resolve({ success, result, error });
        };

        sharedRegexWorker.onerror = (e) => {
            // Worker 出错，拒绝所有待处理请求
            for (const [reqId, pending] of pendingRegexRequests) {
                if (pending.timeoutId) {
                    clearTimeout(pending.timeoutId);
                }
                pending.resolve({ success: false, error: e.message || 'Worker error' });
            }
            pendingRegexRequests.clear();
            // Worker 出错后重建
            destroySharedRegexWorker();
        };
    }
    return sharedRegexWorker;
}

/**
 * 销毁共享的正则 Worker（用于超时或错误恢复）
 */
function destroySharedRegexWorker() {
    if (sharedRegexWorker) {
        sharedRegexWorker.terminate();
        sharedRegexWorker = null;
    }
    if (sharedRegexWorkerUrl) {
        URL.revokeObjectURL(sharedRegexWorkerUrl);
        sharedRegexWorkerUrl = null;
    }
    // 注意：不清理 pendingRegexRequests，让各自的超时处理它们
}

/**
 * 在 Web Worker 中执行正则操作，带超时检查
 * 使用共享 Worker 实例，通过请求 ID 支持并发调用
 * @param {string} operation - 操作类型: 'test', 'match', 'replace', 'matchAll'
 * @param {string} text - 待处理的文本
 * @param {string} pattern - 正则表达式模式
 * @param {string} flags - 正则标志
 * @param {string} [replacement] - 替换字符串 (仅用于 replace 操作)
 * @returns {Promise<{success: boolean, result: any, error?: string, timeout?: boolean}>}
 */
function executeRegexWithTimeout(operation, text, pattern, flags, replacement = '') {
    return new Promise((resolve) => {
        const requestId = ++regexRequestIdCounter;
        const worker = getSharedRegexWorker();

        // 存储待处理请求
        pendingRegexRequests.set(requestId, { resolve, timeoutId: null });

        // 发送请求（包含 requestId）
        worker.postMessage({ requestId, operation, text, pattern, flags, replacement });
    });
}

/**
 * 同步版本的正则超时检查 (使用性能计时器估算)
 * 用于不方便使用异步的场景
 * @param {Function} regexFn - 正则操作函数
 * @param {string} regexDesc - 正则描述 (用于错误提示)
 * @returns {any} 正则操作结果
 */
function executeRegexWithWarning(regexFn, regexDesc = '未知正则') {
    const startTime = performance.now();
    try {
        const result = regexFn();
        const elapsed = performance.now() - startTime;
        if (elapsed > REGEX_TIMEOUT_MS) {
            console.warn(`[st-chatu8] 正则执行时间过长 (${elapsed.toFixed(2)}ms): ${regexDesc}`);
            debugLog('regex.timeout', `正则执行慢: ${regexDesc}`, { 耗时: elapsed.toFixed(2) + 'ms' });
        }
        return result;
    } catch (e) {
        throw e;
    }
}


// DOM Elements
let profileSelect, beforeAfterEditor, textEditor, originalText, resultText, regexTestModeSwitch, gestureEnabledSwitch, clickTriggerEnabledSwitch, gestureShowRecognitionSwitch, gestureShowTrailSwitch, gestureTrailColorPicker, gestureMatchThresholdSlider, gestureMatchThresholdValue, imageGenDemandEnabledSwitch, defaultCharDemandTextarea, defaultImageDemandTextarea;

// 正则预设编辑器 DOM 元素
let regexEntriesContainer;
let regexEntryIdCounter = 0;
let currentEditingRegexEntry = null;

// ==================== 正则条目数据结构 ====================

/**
 * 默认正则条目值
 */
const DEFAULT_REGEX_ENTRY = {
    id: '',
    scriptName: '新建正则',
    disabled: false,
    runOnEdit: true,
    findRegex: '',
    replaceString: '',
    trimStrings: [],
    placement: [2],
    substituteRegex: 0,
    minDepth: null,
    maxDepth: null,
    markdownOnly: true,
    promptOnly: false
};

/**
 * 生成唯一的正则条目 ID
 * @returns {string} 唯一 ID
 */
function generateRegexEntryId() {
    return `regex_entry_${Date.now()}_${++regexEntryIdCounter}`;
}

/**
 * 创建新的正则条目（带默认值）
 * @returns {object} 新的正则条目对象
 */
function createNewRegexEntry() {
    return {
        ...DEFAULT_REGEX_ENTRY,
        id: generateRegexEntryId()
    };
}

/**
 * 从 ST 正则格式解析为内部条目格式
 * @param {object} json - ST 正则 JSON 对象
 * @returns {object|null} 解析后的条目对象，无效则返回 null
 */
function parseSTRegexFormat(json) {
    if (!json || typeof json !== 'object') {
        return null;
    }

    // 必须有 findRegex 字段
    if (typeof json.findRegex !== 'string') {
        return null;
    }

    return {
        id: json.id || generateRegexEntryId(),
        scriptName: json.scriptName || '导入的正则',
        disabled: json.disabled === true,
        runOnEdit: json.runOnEdit !== false,
        findRegex: json.findRegex || '',
        replaceString: json.replaceString || '',
        trimStrings: Array.isArray(json.trimStrings) ? json.trimStrings : [],
        placement: Array.isArray(json.placement) ? json.placement : [2],
        substituteRegex: typeof json.substituteRegex === 'number' ? json.substituteRegex : 0,
        minDepth: json.minDepth ?? null,
        maxDepth: json.maxDepth ?? null,
        markdownOnly: json.markdownOnly !== false,
        promptOnly: json.promptOnly === true
    };
}

/**
 * 导出条目为 ST 正则格式
 * @param {object} entry - 内部条目对象
 * @returns {object} ST 正则格式的 JSON 对象
 */
function exportToSTRegexFormat(entry) {
    return {
        id: entry.id || generateRegexEntryId(),
        scriptName: entry.scriptName || '未命名正则',
        disabled: entry.disabled === true,
        runOnEdit: entry.runOnEdit !== false,
        findRegex: entry.findRegex || '',
        replaceString: entry.replaceString || '',
        trimStrings: Array.isArray(entry.trimStrings) ? entry.trimStrings : [],
        placement: Array.isArray(entry.placement) ? entry.placement : [2],
        substituteRegex: typeof entry.substituteRegex === 'number' ? entry.substituteRegex : 0,
        minDepth: entry.minDepth ?? null,
        maxDepth: entry.maxDepth ?? null,
        markdownOnly: entry.markdownOnly !== false,
        promptOnly: entry.promptOnly === true
    };
}

/**
 * 验证正则条目数据是否有效
 * @param {object} entry - 条目对象
 * @returns {boolean} 是否有效
 */
function validateRegexEntry(entry) {
    if (!entry || typeof entry !== 'object') {
        return false;
    }
    if (typeof entry.findRegex !== 'string') {
        return false;
    }
    if (typeof entry.scriptName !== 'string') {
        return false;
    }
    return true;
}

// ==================== 正则条目编辑弹窗 ====================

/**
 * 获取正则条目编辑弹窗 HTML 模板
 * @returns {string} 弹窗 HTML
 */
function getRegexEntryEditModalHTML() {
    return `
        <div class="st-chatu8-entry-edit-modal-backdrop" id="ch-regex-entry-edit-modal">
            <div class="st-chatu8-entry-edit-modal">
                <div class="st-chatu8-entry-edit-modal-header">
                    <h4>编辑正则条目</h4>
                    <span class="st-chatu8-entry-edit-modal-close">&times;</span>
                </div>
                <div class="st-chatu8-entry-edit-modal-body">
                    <div class="st-chatu8-modal-field">
                        <label>脚本名称</label>
                        <input type="text" id="ch-regex-modal-script-name" class="st-chatu8-text-input" placeholder="脚本名称" />
                    </div>
                    <div class="st-chatu8-modal-field st-chatu8-modal-toggle-field">
                        <label>启用</label>
                        <div class="st-chatu8-toggle">
                            <input id="ch-regex-modal-enabled" type="checkbox" checked />
                            <span class="st-chatu8-slider"></span>
                        </div>
                    </div>
                    <div class="st-chatu8-modal-field">
                        <label>查找正则 (findRegex)</label>
                        <textarea id="ch-regex-modal-find-regex" class="st-chatu8-textarea" rows="4" placeholder="输入正则表达式..."></textarea>
                    </div>
                    <div class="st-chatu8-modal-field">
                        <label>替换字符串 (replaceString)</label>
                        <textarea id="ch-regex-modal-replace-string" class="st-chatu8-textarea" rows="4" placeholder="输入替换字符串..."></textarea>
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

// ==================== 正则条目列表渲染 ====================

/**
 * HTML 转义
 * @param {string} text - 要转义的文本
 * @returns {string} 转义后的文本
 */
function escapeHtmlForRegex(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    // 需要额外转义双引号，因为内容会被放到 HTML 属性值中
    return div.innerHTML.replace(/"/g, '&quot;');
}

/**
 * 渲染正则条目列表
 * @param {Array} entriesData - 条目数组
 */
function renderRegexEntries(entriesData = []) {
    // 确保使用当前 DOM 中的正确容器（修复缓存引用失效问题）
    const containerInDocument = regexEntriesContainer && $.contains(document, regexEntriesContainer[0]);
    if (!containerInDocument) {
        regexEntriesContainer = $('#ch-regex-entries-container');
        console.log('[st-chatu8] renderRegexEntries: 刷新容器引用');
    }

    if (!regexEntriesContainer || regexEntriesContainer.length === 0) {
        console.warn('[st-chatu8] renderRegexEntries: 容器不存在，无法渲染');
        return;
    }

    regexEntriesContainer.empty();

    if (entriesData.length === 0) {
        regexEntriesContainer.html(`
            <div class="st-chatu8-entries-empty">
                <i class="fa-solid fa-inbox"></i>
                <p>暂无正则条目，点击上方按钮添加</p>
            </div>
        `);
        return;
    }

    entriesData.forEach((entry, index) => {
        addRegexEntryDOM(entry, index);
    });

    // 调试：记录渲染的条目
    console.log('[st-chatu8] 渲染正则条目:', {
        容器ID: regexEntriesContainer.attr('id'),
        条目数: entriesData.length,
        条目名称: entriesData.map(e => e.scriptName || '(无名称)')
    });
}

/**
 * 创建并添加单个正则条目 DOM 元素
 * @param {object} entry - 条目数据
 * @param {number} index - 索引
 */
function addRegexEntryDOM(entry, index = -1) {
    // 确保使用当前 DOM 中的正确容器（修复导入时容器引用失效问题）
    const containerInDocument = regexEntriesContainer && $.contains(document, regexEntriesContainer[0]);
    if (!containerInDocument) {
        regexEntriesContainer = $('#ch-regex-entries-container');
        console.log('[st-chatu8] addRegexEntryDOM: 刷新容器引用');
    }

    if (!regexEntriesContainer || regexEntriesContainer.length === 0) {
        console.warn('[st-chatu8] addRegexEntryDOM: 容器不存在，无法添加条目');
        return false;
    }

    const entryId = entry.id || generateRegexEntryId();
    const scriptName = entry.scriptName || `正则 ${index + 1}`;
    const findRegex = entry.findRegex || '';
    const replaceString = entry.replaceString || '';
    const entryDisabled = entry.disabled === true;

    const disabledClass = entryDisabled ? 'disabled' : '';
    const regexPreview = findRegex.length > 40 ? findRegex.substring(0, 40) + '...' : (findRegex || '(空)');

    // Warning indicator for long replaceString (> 100 characters)
    const hasLongReplaceString = replaceString.length > 100;
    const warningHtml = hasLongReplaceString
        ? `<span class="st-chatu8-entry-warning" title="替换字符串超过100字符 (${replaceString.length}字符)"><i class="fa-solid fa-triangle-exclamation"></i></span>`
        : '';

    // 危险正则检测
    const dangerResult = detectDangerousRegex(findRegex);
    const dangerHtml = generateDangerousRegexWarningHTML(dangerResult.warnings);

    const entryElement = $(`
        <div class="st-chatu8-preset-entry st-chatu8-preset-entry-collapsed ${disabledClass}" 
             data-entry-id="${entryId}" 
             data-find-regex="${escapeHtmlForRegex(findRegex)}"
             data-replace-string="${escapeHtmlForRegex(replaceString)}"
             draggable="true">
            <div class="st-chatu8-entry-header">
                <span class="st-chatu8-entry-drag-handle" title="拖拽排序">
                    <i class="fa-solid fa-grip-vertical"></i>
                </span>
                <span class="st-chatu8-entry-role-badge" data-role="regex">REG</span>
                <input type="text" class="st-chatu8-entry-name" value="${escapeHtmlForRegex(scriptName)}" placeholder="脚本名称" readonly />
                ${dangerHtml}
                ${warningHtml}
                <span class="st-chatu8-entry-preview">${escapeHtmlForRegex(regexPreview)}</span>
                <div class="st-chatu8-entry-actions">
                    <div class="st-chatu8-entry-toggle" title="启用/禁用">
                        <input type="checkbox" ${!entryDisabled ? 'checked' : ''} />
                        <span class="st-chatu8-slider"></span>
                    </div>
                    <button class="st-chatu8-icon-btn st-chatu8-entry-edit" title="编辑">
                        <i class="fa-solid fa-pen"></i>
                    </button>
                    <button class="st-chatu8-icon-btn st-chatu8-entry-export" title="导出">
                        <i class="fa-solid fa-file-export"></i>
                    </button>
                    <button class="st-chatu8-icon-btn danger st-chatu8-entry-delete" title="删除条目">
                        <i class="fa-solid fa-trash"></i>
                    </button>
                </div>
            </div>
        </div>
    `);

    // 存储完整数据到 DOM 元素
    entryElement.data('entryData', entry);

    regexEntriesContainer.append(entryElement);
}

// ==================== 正则条目编辑弹窗功能 ====================

/**
 * 显示正则条目编辑弹窗
 * @param {jQuery} $entryElement - 条目元素
 */
function showRegexEntryEditModal($entryElement) {
    currentEditingRegexEntry = $entryElement;

    // 如果弹窗不存在，先创建
    let $modal = $('#ch-regex-entry-edit-modal');
    if (!$modal.length) {
        $('body').append(getRegexEntryEditModalHTML());
        $modal = $('#ch-regex-entry-edit-modal');

        // 绑定弹窗事件
        $modal.find('.st-chatu8-entry-edit-modal-close').on('click', closeRegexEntryEditModal);
        $modal.find('.st-chatu8-modal-cancel-btn').on('click', closeRegexEntryEditModal);
        $modal.find('.st-chatu8-modal-save-btn').on('click', saveRegexEntryFromModal);
    }

    // 获取条目数据
    const entryData = $entryElement.data('entryData') || {};

    // 填充数据到弹窗
    $modal.find('#ch-regex-modal-script-name').val(entryData.scriptName || $entryElement.find('.st-chatu8-entry-name').val());
    $modal.find('#ch-regex-modal-enabled').prop('checked', !$entryElement.hasClass('disabled'));
    $modal.find('#ch-regex-modal-find-regex').val(entryData.findRegex || '');
    $modal.find('#ch-regex-modal-replace-string').val(entryData.replaceString || '');

    // 显示弹窗
    $modal.fadeIn(200);
}

/**
 * 关闭正则条目编辑弹窗
 */
function closeRegexEntryEditModal() {
    const $modal = $('#ch-regex-entry-edit-modal');
    $modal.fadeOut(200);
    currentEditingRegexEntry = null;
}

/**
 * 从弹窗保存数据到正则条目
 */
function saveRegexEntryFromModal() {
    if (!currentEditingRegexEntry) {
        closeRegexEntryEditModal();
        return;
    }

    const $modal = $('#ch-regex-entry-edit-modal');
    const $entry = currentEditingRegexEntry;

    // 获取弹窗数据
    const scriptName = $modal.find('#ch-regex-modal-script-name').val() || '未命名正则';
    const enabled = $modal.find('#ch-regex-modal-enabled').is(':checked');
    const findRegex = $modal.find('#ch-regex-modal-find-regex').val() || '';
    const replaceString = $modal.find('#ch-regex-modal-replace-string').val() || '';

    // 获取现有数据并更新
    const entryData = $entry.data('entryData') || {};
    entryData.scriptName = scriptName;
    entryData.disabled = !enabled;
    entryData.findRegex = findRegex;
    entryData.replaceString = replaceString;

    // 更新 DOM 显示
    $entry.find('.st-chatu8-entry-name').val(scriptName);
    $entry.attr('data-find-regex', findRegex);
    $entry.attr('data-replace-string', replaceString);

    // 更新启用状态
    $entry.find('.st-chatu8-entry-toggle input').prop('checked', enabled);
    if (enabled) {
        $entry.removeClass('disabled');
    } else {
        $entry.addClass('disabled');
    }

    // 更新预览
    const regexPreview = findRegex.length > 40 ? findRegex.substring(0, 40) + '...' : (findRegex || '(空)');
    $entry.find('.st-chatu8-entry-preview').text(regexPreview);

    // 更新 replaceString 长度警告指示器
    const hasLongReplaceString = replaceString.length > 100;
    $entry.find('.st-chatu8-entry-warning').remove(); // 移除旧的警告
    $entry.find('.st-chatu8-entry-danger-warning').remove(); // 移除旧的危险警告

    // 添加危险正则警告
    const dangerResult = detectDangerousRegex(findRegex);
    if (dangerResult.isDangerous) {
        const dangerHtml = generateDangerousRegexWarningHTML(dangerResult.warnings);
        $entry.find('.st-chatu8-entry-name').after(dangerHtml);
    }

    // 添加长度警告
    if (hasLongReplaceString) {
        const warningHtml = `<span class="st-chatu8-entry-warning" title="替换字符串超过100字符 (${replaceString.length}字符)"><i class="fa-solid fa-triangle-exclamation"></i></span>`;
        // 插入到危险警告之后，或者名称之后
        const $dangerWarning = $entry.find('.st-chatu8-entry-danger-warning');
        if ($dangerWarning.length) {
            $dangerWarning.after(warningHtml);
        } else {
            $entry.find('.st-chatu8-entry-name').after(warningHtml);
        }
    }

    // 保存数据
    $entry.data('entryData', entryData);

    // 如果有危险正则警告，弹窗通知用户
    if (dangerResult.isDangerous) {
        const warningText = dangerResult.warnings.map(w => `<b>${w.name}</b>: ${w.description}`).join('<br>');
        toastr.error(warningText, '⚠️ 危险正则警告 - 可能导致浏览器卡顿', {
            timeOut: 10000,
            extendedTimeOut: 5000,
            escapeHtml: false,
            closeButton: true
        });
        toastr.info('正则条目已保存，但请注意性能风险');
    } else {
        toastr.success('正则条目已更新');
    }

    closeRegexEntryEditModal();

    // 保存到设置
    saveRegexEntriesToProfile();
}

// ==================== 正则条目 CRUD 操作 ====================

/**
 * 添加新的正则条目
 */
function addNewRegexEntry() {
    // 确保使用当前 DOM 中的正确容器
    const containerInDocument = regexEntriesContainer && $.contains(document, regexEntriesContainer[0]);
    if (!containerInDocument) {
        regexEntriesContainer = $('#ch-regex-entries-container');
    }

    // 移除空状态提示
    if (regexEntriesContainer && regexEntriesContainer.length > 0) {
        regexEntriesContainer.find('.st-chatu8-entries-empty').remove();
    }

    const newEntry = createNewRegexEntry();
    addRegexEntryDOM(newEntry);

    // 滚动到新添加的条目
    if (regexEntriesContainer && regexEntriesContainer[0]) {
        const container = regexEntriesContainer[0];
        container.scrollTop = container.scrollHeight;
    }

    // 自动打开编辑弹窗
    const $newEntry = regexEntriesContainer.find('.st-chatu8-preset-entry').last();
    showRegexEntryEditModal($newEntry);
}

/**
 * 删除正则条目
 * @param {jQuery} $entryElement - 条目元素
 */
function deleteRegexEntry($entryElement) {
    $entryElement.remove();
    toastr.info('已删除正则条目');

    // 确保使用当前 DOM 中的正确容器
    const containerInDocument = regexEntriesContainer && $.contains(document, regexEntriesContainer[0]);
    if (!containerInDocument) {
        regexEntriesContainer = $('#ch-regex-entries-container');
    }

    // 如果删除后没有条目了，显示空状态
    if (!regexEntriesContainer || regexEntriesContainer.length === 0) {
        return;
    }
    const $entries = regexEntriesContainer.find('.st-chatu8-preset-entry');
    if ($entries.length === 0) {
        regexEntriesContainer.html(`
            <div class="st-chatu8-entries-empty">
                <i class="fa-solid fa-inbox"></i>
                <p>暂无正则条目，点击上方按钮添加</p>
            </div>
        `);
    }

    saveRegexEntriesToProfile();
}

/**
 * 切换正则条目启用状态
 * @param {jQuery} $entryElement - 条目元素
 * @param {boolean} enabled - 是否启用
 */
function toggleRegexEntry($entryElement, enabled) {
    const entryData = $entryElement.data('entryData') || {};
    entryData.disabled = !enabled;
    $entryElement.data('entryData', entryData);

    if (enabled) {
        $entryElement.removeClass('disabled');
    } else {
        $entryElement.addClass('disabled');
    }

    saveRegexEntriesToProfile();
}

/**
 * 导出单个正则条目
 * @param {jQuery} $entryElement - 条目元素
 */
function exportRegexEntry($entryElement) {
    const entryData = $entryElement.data('entryData');
    if (!entryData) {
        toastr.warning('无法导出：条目数据不存在');
        return;
    }

    const exportData = exportToSTRegexFormat(entryData);
    const scriptName = entryData.scriptName || '未命名正则';
    const safeFileName = scriptName.replace(/[^a-zA-Z0-9\u4e00-\u9fa5]/g, '_');

    const blob = new Blob([JSON.stringify(exportData, null, 4)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `st_regex_${safeFileName}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    toastr.success(`已导出正则条目: ${scriptName}`);
}

// ==================== 正则条目导入功能 ====================

/**
 * 导入正则条目（从 JSON 文件）
 */
function importRegexEntries() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.multiple = true;
    input.onchange = async (event) => {
        const files = event.target.files;
        if (!files || files.length === 0) return;

        let importedCount = 0;
        const readPromises = [];

        for (const file of files) {
            const promise = new Promise((resolve) => {
                const reader = new FileReader();
                reader.onload = (e) => {
                    try {
                        const data = JSON.parse(e.target.result);
                        const entry = parseSTRegexFormat(data);
                        if (entry && validateRegexEntry(entry)) {
                            // 移除空状态提示
                            regexEntriesContainer.find('.st-chatu8-entries-empty').remove();
                            addRegexEntryDOM(entry);
                            importedCount++;
                        }
                    } catch (error) {
                        console.warn(`解析文件 ${file.name} 失败:`, error);
                    }
                    resolve();
                };
                reader.onerror = () => resolve();
                reader.readAsText(file);
            });
            readPromises.push(promise);
        }

        await Promise.all(readPromises);

        if (importedCount > 0) {
            saveRegexEntriesToProfile();
            toastr.success(`成功导入 ${importedCount} 个正则条目`);
        } else {
            toastr.warning('没有有效的正则条目可导入');
        }
    };
    input.click();
}

/**
 * 从 ST 正则引擎导入条目
 */
async function importRegexEntriesFromEngine() {
    let regexEngine;
    try {
        regexEngine = await import('../../../../../extensions/regex/engine.js');
    } catch (importError) {
        console.error('无法加载正则引擎模块:', importError);
        toastr.error('无法加载ST正则引擎模块，请确保正则扩展已启用');
        return;
    }

    try {
        // 检查必需的函数和常量是否存在（兼容性检测）
        if (typeof regexEngine.getScriptsByType !== 'function') {
            toastr.error('ST正则引擎版本过旧，缺少 getScriptsByType 函数。\n请更新 SillyTavern 到最新版本。');
            console.warn('regexEngine 对象缺少 getScriptsByType 函数。可用的导出:', Object.keys(regexEngine));
            return;
        }
        if (!regexEngine.SCRIPT_TYPES) {
            toastr.error('ST正则引擎版本过旧，缺少 SCRIPT_TYPES 常量。\n请更新 SillyTavern 到最新版本。');
            console.warn('regexEngine 对象缺少 SCRIPT_TYPES 常量。可用的导出:', Object.keys(regexEngine));
            return;
        }

        const globalScripts = regexEngine.getScriptsByType(regexEngine.SCRIPT_TYPES.GLOBAL) || [];
        const scopedScripts = regexEngine.getScriptsByType(regexEngine.SCRIPT_TYPES.SCOPED) || [];
        const presetScripts = regexEngine.getScriptsByType(regexEngine.SCRIPT_TYPES.PRESET) || [];

        // 过滤条件：
        // 1. 未禁用
        // 2. 有 findRegex
        // 3. minDepth === 0 或 null 或 undefined
        // 4. markdownOnly === true
        // 5. placement 包含 2
        const filterScripts = (scripts) => scripts.filter(script => {
            if (script.disabled) return false;
            if (!script.findRegex) return false;

            const minDepthValid = script.minDepth === 0 || script.minDepth === null || script.minDepth === undefined;
            const markdownOnlyValid = script.markdownOnly === true;
            const placementValid = Array.isArray(script.placement) && script.placement.includes(2);

            return minDepthValid && markdownOnlyValid && placementValid;
        });

        const scriptsByType = {
            global: filterScripts(globalScripts),
            scoped: filterScripts(scopedScripts),
            preset: filterScripts(presetScripts)
        };

        const totalCount = scriptsByType.global.length + scriptsByType.scoped.length + scriptsByType.preset.length;

        if (totalCount === 0) {
            toastr.warning('没有符合条件的正则脚本可导入。\n条件: 未禁用, minDepth=0或null, markdownOnly=true, placement包含2');
            return;
        }

        // 显示选择对话框（复用现有的）
        const selectedScripts = await showRegexEntrySelectionDialog(scriptsByType);

        if (selectedScripts.length > 0) {
            // 移除空状态提示
            regexEntriesContainer.find('.st-chatu8-entries-empty').remove();

            selectedScripts.forEach(script => {
                const entry = parseSTRegexFormat(script);
                if (entry) {
                    addRegexEntryDOM(entry);
                }
            });

            saveRegexEntriesToProfile();
            toastr.success(`成功导入 ${selectedScripts.length} 个正则条目`);
        } else {
            toastr.info('未选择任何正则脚本');
        }
    } catch (error) {
        console.error('加载正则引擎模块失败:', error);
        toastr.error('加载ST正则引擎模块失败，请确保正则扩展已启用');
    }
}

/**
 * 获取正则条目导入选择弹窗 HTML 模板
 * @param {string} listHtml - 条目列表 HTML
 * @returns {string} 弹窗 HTML
 */
function getRegexEntryImportModalHTML(listHtml) {
    return `
        <div class="st-chatu8-entry-edit-modal-backdrop" id="ch-regex-entry-import-modal">
            <div class="st-chatu8-entry-edit-modal">
                <div class="st-chatu8-entry-edit-modal-header">
                    <h4>选择要导入的正则条目</h4>
                    <span class="st-chatu8-entry-edit-modal-close">&times;</span>
                </div>
                <div class="st-chatu8-entry-edit-modal-body">
                    <div class="st-chatu8-modal-field st-chatu8-import-toolbar">
                        <button type="button" class="st-chatu8-btn" id="st-regex-entry-select-all">
                            <i class="fa-solid fa-check-double"></i> 全选
                        </button>
                        <button type="button" class="st-chatu8-btn" id="st-regex-entry-deselect-all">
                            <i class="fa-solid fa-xmark"></i> 取消全选
                        </button>
                    </div>
                    <div class="st-chatu8-modal-field st-chatu8-import-list">
                        ${listHtml}
                    </div>
                </div>
                <div class="st-chatu8-entry-edit-modal-footer">
                    <button class="st-chatu8-btn st-chatu8-modal-cancel-btn">取消</button>
                    <button class="st-chatu8-btn st-chatu8-btn-primary st-chatu8-modal-save-btn">
                        <i class="fa-solid fa-file-import"></i> 导入选中
                    </button>
                </div>
            </div>
        </div>
    `;
}

/**
 * 显示正则条目选择对话框（用于从引擎导入）
 * @param {Object} scriptsByType - 按类型分组的脚本
 * @returns {Promise<Array>} - 选中的完整脚本对象数组
 */
function showRegexEntrySelectionDialog(scriptsByType) {
    return new Promise((resolve) => {
        const typeLabels = {
            global: '全局正则',
            scoped: '角色正则',
            preset: '预设正则'
        };

        let listHtml = '';
        for (const [type, scripts] of Object.entries(scriptsByType)) {
            if (scripts.length === 0) continue;

            listHtml += `
                <div class="st-chatu8-import-type-group">
                    <h5 class="st-chatu8-import-type-header">${typeLabels[type] || type} <span class="st-chatu8-import-count">(${scripts.length})</span></h5>
            `;

            scripts.forEach((script, index) => {
                const scriptId = `st-regex-entry-${type}-${index}`;
                const scriptName = script.scriptName || `未命名正则 ${index + 1}`;
                listHtml += `
                    <div class="st-chatu8-import-item">
                        <label class="st-chatu8-import-label">
                            <input type="checkbox" class="st-chatu8-import-checkbox" id="${scriptId}" 
                                   data-type="${type}" data-index="${index}" checked>
                            <span class="st-chatu8-import-name">${escapeHtmlForRegex(scriptName)}</span>
                        </label>
                    </div>
                `;
            });

            listHtml += `</div>`;
        }

        // 如果弹窗已存在，先移除
        $('#ch-regex-entry-import-modal').remove();

        $('body').append(getRegexEntryImportModalHTML(listHtml));
        const $modal = $('#ch-regex-entry-import-modal');

        // 全选/取消全选
        $modal.find('#st-regex-entry-select-all').on('click', () => {
            $modal.find('.st-chatu8-import-checkbox').prop('checked', true);
        });
        $modal.find('#st-regex-entry-deselect-all').on('click', () => {
            $modal.find('.st-chatu8-import-checkbox').prop('checked', false);
        });

        // 确认导入
        $modal.find('.st-chatu8-modal-save-btn').on('click', () => {
            const selectedScripts = [];
            $modal.find('.st-chatu8-import-checkbox:checked').each(function () {
                const type = $(this).data('type');
                const index = $(this).data('index');
                const script = scriptsByType[type][index];
                if (script) {
                    selectedScripts.push(script);
                }
            });
            $modal.fadeOut(200, () => $modal.remove());
            resolve(selectedScripts);
        });

        // 取消/关闭
        $modal.find('.st-chatu8-modal-cancel-btn, .st-chatu8-entry-edit-modal-close').on('click', () => {
            $modal.fadeOut(200, () => $modal.remove());
            resolve([]);
        });

        // 点击遮罩关闭
        $modal.on('click', (e) => {
            if ($(e.target).hasClass('st-chatu8-entry-edit-modal-backdrop')) {
                $modal.fadeOut(200, () => $modal.remove());
                resolve([]);
            }
        });

        // 显示弹窗
        $modal.fadeIn(200);
    });
}

// ==================== 正则条目数据持久化 ====================

/**
 * 从 UI 收集所有正则条目数据
 * @returns {Array} 条目数组
 */
function collectRegexEntriesFromUI() {
    const entries = [];

    // 调试：检查容器状态
    const containerInDocument = regexEntriesContainer && $.contains(document, regexEntriesContainer[0]);
    const freshContainer = $('#ch-regex-entries-container');
    const freshEntryCount = freshContainer.find('.st-chatu8-preset-entry').length;

    console.log('[st-chatu8] collectRegexEntriesFromUI 调试:', {
        缓存容器存在: !!regexEntriesContainer,
        缓存容器在文档中: containerInDocument,
        新选择器找到的容器: freshContainer.length > 0,
        新选择器找到的条目数: freshEntryCount,
        缓存容器找到的条目数: regexEntriesContainer ? regexEntriesContainer.find('.st-chatu8-preset-entry').length : 0
    });

    // 如果缓存的容器不在文档中，使用新选择的容器
    const activeContainer = containerInDocument ? regexEntriesContainer : freshContainer;

    if (!activeContainer || activeContainer.length === 0) {
        console.warn('[st-chatu8] 正则条目容器不存在！');
        return entries;
    }

    activeContainer.find('.st-chatu8-preset-entry').each(function () {
        const $entry = $(this);
        const entryData = $entry.data('entryData');
        if (entryData) {
            entries.push(entryData);
        }
    });

    return entries;
}

/**
 * 保存正则条目到当前配置
 */
function saveRegexEntriesToProfile() {
    const profileName = profileSelect.val();
    if (!profileName) return;

    const profiles = extension_settings[extensionName].regex_profiles;
    if (!profiles[profileName]) {
        profiles[profileName] = {};
    }

    profiles[profileName].regexEntries = collectRegexEntriesFromUI();
    saveSettingsDebounced();
}

/**
 * 从配置加载正则条目
 */
function loadRegexEntriesFromProfile() {
    const profileName = profileSelect.val();
    if (!profileName) return;

    const profiles = extension_settings[extensionName].regex_profiles;
    const profile = profiles[profileName];

    console.log('[st-chatu8] 加载正则配置:', {
        配置名称: profileName,
        配置是否存在: !!profile,
        条目数量: profile?.regexEntries?.length || 0
    });

    if (profile && Array.isArray(profile.regexEntries)) {
        renderRegexEntries(profile.regexEntries);
    } else {
        renderRegexEntries([]);
    }
}

// ==================== 正则条目事件绑定 ====================

/**
 * 绑定正则条目拖拽事件
 */
function bindRegexEntryDragEvents() {
    if (!regexEntriesContainer) return;

    let draggedEntry = null;
    let autoScrollInterval = null;
    const SCROLL_SPEED = 8;
    const SCROLL_ZONE = 50; // 距离边缘多少像素时触发滚动

    /**
     * 停止自动滚动
     */
    function stopAutoScroll() {
        if (autoScrollInterval) {
            clearInterval(autoScrollInterval);
            autoScrollInterval = null;
        }
    }

    /**
     * 根据鼠标位置自动滚动容器
     * @param {number} clientY - 鼠标 Y 坐标
     */
    function handleAutoScroll(clientY) {
        const container = regexEntriesContainer[0];
        if (!container) return;

        const rect = container.getBoundingClientRect();
        const topEdge = rect.top;
        const bottomEdge = rect.bottom;

        stopAutoScroll();

        // 鼠标在顶部边缘区域 - 向上滚动
        if (clientY < topEdge + SCROLL_ZONE && clientY >= topEdge) {
            autoScrollInterval = setInterval(() => {
                container.scrollTop -= SCROLL_SPEED;
            }, 16);
        }
        // 鼠标在底部边缘区域 - 向下滚动
        else if (clientY > bottomEdge - SCROLL_ZONE && clientY <= bottomEdge) {
            autoScrollInterval = setInterval(() => {
                container.scrollTop += SCROLL_SPEED;
            }, 16);
        }
    }

    regexEntriesContainer.on('dragstart', '.st-chatu8-preset-entry', function (e) {
        draggedEntry = this;
        $(this).addClass('dragging');
        e.originalEvent.dataTransfer.effectAllowed = 'move';
    });

    regexEntriesContainer.on('dragend', '.st-chatu8-preset-entry', function () {
        $(this).removeClass('dragging');
        regexEntriesContainer.find('.st-chatu8-preset-entry').removeClass('drag-over');
        draggedEntry = null;
        stopAutoScroll();
    });

    regexEntriesContainer.on('dragover', '.st-chatu8-preset-entry', function (e) {
        e.preventDefault();
        e.originalEvent.dataTransfer.dropEffect = 'move';

        if (this !== draggedEntry) {
            regexEntriesContainer.find('.st-chatu8-preset-entry').removeClass('drag-over');
            $(this).addClass('drag-over');
        }

        // 处理自动滚动
        handleAutoScroll(e.originalEvent.clientY);
    });

    // 在容器上也监听 dragover，处理拖到空白区域时的滚动
    regexEntriesContainer.on('dragover', function (e) {
        if (draggedEntry) {
            e.preventDefault();
            handleAutoScroll(e.originalEvent.clientY);
        }
    });

    regexEntriesContainer.on('drop', '.st-chatu8-preset-entry', function (e) {
        e.preventDefault();
        stopAutoScroll();

        if (this !== draggedEntry && draggedEntry) {
            const $target = $(this);
            const $dragged = $(draggedEntry);

            const targetRect = this.getBoundingClientRect();
            const mouseY = e.originalEvent.clientY;
            const insertAfter = mouseY > targetRect.top + targetRect.height / 2;

            if (insertAfter) {
                $target.after($dragged);
            } else {
                $target.before($dragged);
            }

            saveRegexEntriesToProfile();
        }

        regexEntriesContainer.find('.st-chatu8-preset-entry').removeClass('drag-over');
    });

    // 拖拽离开容器时停止滚动
    regexEntriesContainer.on('dragleave', function (e) {
        // 检查是否真的离开了容器（而不是进入子元素）
        const rect = this.getBoundingClientRect();
        const x = e.originalEvent.clientX;
        const y = e.originalEvent.clientY;

        if (x < rect.left || x > rect.right || y < rect.top || y > rect.bottom) {
            stopAutoScroll();
        }
    });
}

/**
 * 绑定正则条目交互事件
 */
function bindRegexEntryEvents() {
    if (!regexEntriesContainer) return;

    // 编辑按钮
    regexEntriesContainer.on('click', '.st-chatu8-entry-edit', function (e) {
        e.stopPropagation();
        const $entry = $(this).closest('.st-chatu8-preset-entry');
        showRegexEntryEditModal($entry);
    });

    // 启用/禁用切换
    regexEntriesContainer.on('change', '.st-chatu8-entry-toggle input', function () {
        const $entry = $(this).closest('.st-chatu8-preset-entry');
        toggleRegexEntry($entry, $(this).is(':checked'));
    });

    // 导出按钮
    regexEntriesContainer.on('click', '.st-chatu8-entry-export', function (e) {
        e.stopPropagation();
        const $entry = $(this).closest('.st-chatu8-preset-entry');
        exportRegexEntry($entry);
    });

    // 删除按钮
    regexEntriesContainer.on('click', '.st-chatu8-entry-delete', function (e) {
        e.stopPropagation();
        const $entry = $(this).closest('.st-chatu8-preset-entry');
        deleteRegexEntry($entry);
    });

    // 双击打开编辑弹窗
    regexEntriesContainer.on('dblclick', '.st-chatu8-preset-entry', function (e) {
        if ($(e.target).closest('.st-chatu8-entry-actions, .st-chatu8-entry-drag-handle').length) {
            return;
        }
        showRegexEntryEditModal($(this));
    });

    // 危险正则警告点击显示详情（方便手机用户）
    regexEntriesContainer.on('click', '.st-chatu8-entry-danger-warning', function (e) {
        e.stopPropagation();
        const warningText = $(this).attr('title');
        if (warningText) {
            toastr.error(warningText.replace(/\n/g, '<br>'), '⚠️ 危险正则警告', {
                timeOut: 8000,
                extendedTimeOut: 3000,
                escapeHtml: false
            });
        }
    });

    // 普通警告点击显示详情（方便手机用户）
    regexEntriesContainer.on('click', '.st-chatu8-entry-warning', function (e) {
        e.stopPropagation();
        const warningText = $(this).attr('title');
        if (warningText) {
            toastr.warning(warningText, '替换字符串警告');
        }
    });
}

/**
 * Loads regex profiles from settings and populates the dropdown.
 */
export function loadRegexProfiles() {
    const profiles = extension_settings[extensionName].regex_profiles || {};
    const currentProfileName = extension_settings[extensionName].current_regex_profile;

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
 * Handles the change event of the profile selection dropdown.
 */
function onProfileSelectChange() {
    const profileName = $(this).val();
    if (!profileName) return;

    const profiles = extension_settings[extensionName].regex_profiles;
    const profile = profiles[profileName];

    if (profile) {
        beforeAfterEditor.val(profile.beforeAfterRegex || '');
        textEditor.val(profile.textRegex || '');
        extension_settings[extensionName].current_regex_profile = profileName;
        saveSettingsDebounced();

        // 加载正则条目
        loadRegexEntriesFromProfile();
    }
}

/**
 * Saves the current editor content to the selected profile.
 */
function onSaveProfileClick() {
    const profileName = profileSelect.val();
    if (!profileName) {
        toastr.warning("没有选中的配置。");
        return;
    }

    const profiles = extension_settings[extensionName].regex_profiles;

    // 保留现有的 regexEntries，同时更新其他字段
    const existingEntries = profiles[profileName]?.regexEntries || [];
    profiles[profileName] = {
        beforeAfterRegex: beforeAfterEditor.val(),
        textRegex: textEditor.val(),
        regexEntries: existingEntries
    };

    saveSettingsDebounced();
    toastr.success(`配置 "${profileName}" 已保存。`);
}

/**
 * Saves the current editor content as a new empty profile.
 */
function onNewProfileClick() {
    stylInput("请输入新的正则配置名称").then((newName) => {
        if (!newName || newName.trim() === '') return;

        const profiles = extension_settings[extensionName].regex_profiles;
        if (profiles[newName]) {
            toastr.error(`配置 "${newName}" 已存在。`);
            return;
        }

        profiles[newName] = {
            beforeAfterRegex: '',
            textRegex: '',
            regexEntries: []
        };
        extension_settings[extensionName].current_regex_profile = newName;
        saveSettingsDebounced();
        loadRegexProfiles();
        toastr.success(`空配置 "${newName}" 已创建并选中。`);
    });
}

/**
 * Saves the current profile as a new profile.
 */
function onSaveAsProfileClick() {
    stylInput("请输入另存为的配置名称").then((newName) => {
        if (!newName || newName.trim() === '') return;

        const profiles = extension_settings[extensionName].regex_profiles;
        if (profiles[newName]) {
            toastr.error(`配置 "${newName}" 已存在。`);
            return;
        }

        const currentName = profileSelect.val();
        const currentProfile = profiles[currentName] || {};

        profiles[newName] = {
            beforeAfterRegex: currentProfile.beforeAfterRegex || '',
            textRegex: currentProfile.textRegex || '',
            regexEntries: JSON.parse(JSON.stringify(currentProfile.regexEntries || []))
        };
        extension_settings[extensionName].current_regex_profile = newName;
        saveSettingsDebounced();
        loadRegexProfiles();
        toastr.success(`配置已另存为 "${newName}"。`);
    });
}

function onRenameProfileClick() {
    const currentName = profileSelect.val();
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
            const profiles = extension_settings[extensionName].regex_profiles;
            if (profiles[newName]) {
                toastr.error(`配置 "${newName}" 已存在，请换一个名称。`);
                return;
            }
            
            profiles[newName] = profiles[currentName];
            delete profiles[currentName];
            
            extension_settings[extensionName].current_regex_profile = newName;
            
            saveSettingsDebounced();
            loadRegexProfiles();
            toastr.success(`配置已重命名为 "${newName}"`);
        }
    });
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

    if (Object.keys(extension_settings[extensionName].regex_profiles).length <= 1) {
        toastr.error("不能删除最后一个配置。");
        return;
    }

    if (confirm(`你确定要删除配置 "${profileName}" 吗？`)) {
        delete extension_settings[extensionName].regex_profiles[profileName];
        extension_settings[extensionName].current_regex_profile = Object.keys(extension_settings[extensionName].regex_profiles)[0];
        saveSettingsDebounced();
        loadRegexProfiles();
        toastr.success(`配置 "${profileName}" 已删除。`);
    }
}

/**
 * Exports the selected regex profile to a JSON file.
 */
function onExportProfileClick() {
    const profileName = profileSelect.val();
    if (!profileName) {
        toastr.warning("没有选中的配置可导出。");
        return;
    }
    const profile = extension_settings[extensionName].regex_profiles[profileName];
    const exportData = { [profileName]: profile };
    const blob = new Blob([JSON.stringify(exportData, null, 4)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `st_is_regex_profile_${profileName}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

/**
 * Imports regex profiles from a JSON file.
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
                            extension_settings[extensionName].regex_profiles[name] = importedProfiles[name];
                            importedCount++;
                        }
                    }
                    saveSettingsDebounced();
                    loadRegexProfiles();
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
 * Imports findRegex from multiple ST regex JSON files.
 * Filters by: minDepth == 0 or null, markdownOnly == true, placement includes 2
 */
function onImportSTRegexClick() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.multiple = true;
    input.onchange = async (event) => {
        const files = event.target.files;
        if (!files || files.length === 0) return;

        const importedRegexes = [];
        const readPromises = [];

        for (const file of files) {
            const promise = new Promise((resolve) => {
                const reader = new FileReader();
                reader.onload = (e) => {
                    try {
                        const data = JSON.parse(e.target.result);
                        // Check filter conditions
                        const minDepthValid = data.minDepth === 0 || data.minDepth === null;
                        const markdownOnlyValid = data.markdownOnly === true;
                        const placementValid = Array.isArray(data.placement) && data.placement.includes(2);

                        if (minDepthValid && markdownOnlyValid && placementValid) {
                            if (data.findRegex) {
                                importedRegexes.push(data.findRegex);
                            }
                        }
                    } catch (error) {
                        console.warn(`解析文件 ${file.name} 失败:`, error);
                    }
                    resolve();
                };
                reader.onerror = () => resolve();
                reader.readAsText(file);
            });
            readPromises.push(promise);
        }

        await Promise.all(readPromises);

        if (importedRegexes.length > 0) {
            // Append to existing text editor content
            const currentContent = textEditor.val().trim();
            const newContent = currentContent
                ? currentContent + '\n' + importedRegexes.join('\n')
                : importedRegexes.join('\n');
            textEditor.val(newContent);
            toastr.success(`成功导入 ${importedRegexes.length} 条正则表达式。`);
        } else {
            toastr.warning(`没有符合条件的正则表达式可导入。\n条件: minDepth=0或null, markdownOnly=true, placement包含2`);
        }
    };
    input.click();
}

/**
 * Checks if a regex script is eligible for import based on filter criteria.
 * @param {Object} script - The regex script object from ST engine.
 * @returns {boolean} True if the script meets all filter conditions.
 */
function isScriptEligibleForImport(script) {
    const minDepthValid = script.minDepth === 0 || script.minDepth === null || script.minDepth === undefined;
    const markdownOnlyValid = script.markdownOnly === true;
    const placementValid = Array.isArray(script.placement) && script.placement.includes(2);
    return minDepthValid && markdownOnlyValid && placementValid;
}

/**
 * 获取文字正则导入选择弹窗 HTML 模板
 * @param {string} listHtml - 条目列表 HTML
 * @returns {string} 弹窗 HTML
 */
function getRegexSelectionModalHTML(listHtml) {
    return `
        <div class="st-chatu8-entry-edit-modal-backdrop" id="ch-regex-selection-modal">
            <div class="st-chatu8-entry-edit-modal">
                <div class="st-chatu8-entry-edit-modal-header">
                    <h4>选择要导入的正则表达式</h4>
                    <span class="st-chatu8-entry-edit-modal-close">&times;</span>
                </div>
                <div class="st-chatu8-entry-edit-modal-body">
                    <div class="st-chatu8-modal-field st-chatu8-import-toolbar">
                        <button type="button" class="st-chatu8-btn" id="st-regex-select-all">
                            <i class="fa-solid fa-check-double"></i> 全选
                        </button>
                        <button type="button" class="st-chatu8-btn" id="st-regex-deselect-all">
                            <i class="fa-solid fa-xmark"></i> 取消全选
                        </button>
                    </div>
                    <div class="st-chatu8-modal-field st-chatu8-import-list">
                        ${listHtml}
                    </div>
                </div>
                <div class="st-chatu8-entry-edit-modal-footer">
                    <button class="st-chatu8-btn st-chatu8-modal-cancel-btn">取消</button>
                    <button class="st-chatu8-btn st-chatu8-btn-primary st-chatu8-modal-save-btn">
                        <i class="fa-solid fa-file-import"></i> 导入选中
                    </button>
                </div>
            </div>
        </div>
    `;
}

/**
 * Shows a selection dialog for regex scripts grouped by type.
 * @param {Object} scriptsByType - Scripts grouped by type (global, scoped, preset)
 * @returns {Promise<Array>} - Selected scripts' findRegex values
 */
function showRegexSelectionDialog(scriptsByType) {
    return new Promise((resolve) => {
        const typeLabels = {
            global: '全局正则',
            scoped: '角色正则',
            preset: '预设正则'
        };

        let listHtml = '';
        for (const [type, scripts] of Object.entries(scriptsByType)) {
            if (scripts.length === 0) continue;

            listHtml += `
                <div class="st-chatu8-import-type-group">
                    <h5 class="st-chatu8-import-type-header">${typeLabels[type] || type} <span class="st-chatu8-import-count">(${scripts.length})</span></h5>
            `;

            scripts.forEach((script, index) => {
                const scriptId = `st-regex-${type}-${index}`;
                const scriptName = script.scriptName || `未命名正则 ${index + 1}`;
                listHtml += `
                    <div class="st-chatu8-import-item">
                        <label class="st-chatu8-import-label">
                            <input type="checkbox" class="st-chatu8-import-checkbox" id="${scriptId}" 
                                   data-type="${type}" data-index="${index}" checked>
                            <span class="st-chatu8-import-name">${escapeHtmlForRegex(scriptName)}</span>
                        </label>
                    </div>
                `;
            });

            listHtml += `</div>`;
        }

        // 如果弹窗已存在，先移除
        $('#ch-regex-selection-modal').remove();

        $('body').append(getRegexSelectionModalHTML(listHtml));
        const $modal = $('#ch-regex-selection-modal');

        // 全选/取消全选
        $modal.find('#st-regex-select-all').on('click', () => {
            $modal.find('.st-chatu8-import-checkbox').prop('checked', true);
        });
        $modal.find('#st-regex-deselect-all').on('click', () => {
            $modal.find('.st-chatu8-import-checkbox').prop('checked', false);
        });

        // 确认导入
        $modal.find('.st-chatu8-modal-save-btn').on('click', () => {
            const selectedRegexes = [];
            $modal.find('.st-chatu8-import-checkbox:checked').each(function () {
                const type = $(this).data('type');
                const index = $(this).data('index');
                const script = scriptsByType[type][index];
                if (script && script.findRegex) {
                    selectedRegexes.push(script.findRegex);
                }
            });
            $modal.fadeOut(200, () => $modal.remove());
            resolve(selectedRegexes);
        });

        // 取消/关闭
        $modal.find('.st-chatu8-modal-cancel-btn, .st-chatu8-entry-edit-modal-close').on('click', () => {
            $modal.fadeOut(200, () => $modal.remove());
            resolve([]);
        });

        // 点击遮罩关闭
        $modal.on('click', (e) => {
            if ($(e.target).hasClass('st-chatu8-entry-edit-modal-backdrop')) {
                $modal.fadeOut(200, () => $modal.remove());
                resolve([]);
            }
        });

        // 显示弹窗
        $modal.fadeIn(200);
    });
}

/**
 * Imports regex patterns from SillyTavern's built-in regex engine module.
 * Dynamically loads the engine and extracts findRegex from eligible scripts.
 */
async function onImportSTRegexEngineClick() {
    try {
        // Dynamically import the regex engine module
        const regexEngine = await import('../../../../../extensions/regex/engine.js');

        // Get scripts by type
        const globalScripts = regexEngine.getScriptsByType(regexEngine.SCRIPT_TYPES.GLOBAL) || [];
        const scopedScripts = regexEngine.getScriptsByType(regexEngine.SCRIPT_TYPES.SCOPED) || [];
        const presetScripts = regexEngine.getScriptsByType(regexEngine.SCRIPT_TYPES.PRESET) || [];

        // Filter: remove disabled scripts and apply eligibility filter
        const filterScripts = (scripts) => scripts.filter(script =>
            !script.disabled && isScriptEligibleForImport(script) && script.findRegex
        );

        const scriptsByType = {
            global: filterScripts(globalScripts),
            scoped: filterScripts(scopedScripts),
            preset: filterScripts(presetScripts)
        };

        const totalCount = scriptsByType.global.length + scriptsByType.scoped.length + scriptsByType.preset.length;

        if (totalCount === 0) {
            toastr.warning(`没有符合条件的正则表达式可导入。\n条件: 未禁用, minDepth=0或null, markdownOnly=true, placement包含2`);
            return;
        }

        // Show selection dialog
        const selectedRegexes = await showRegexSelectionDialog(scriptsByType);

        if (selectedRegexes.length > 0) {
            // Append to existing text editor content
            const currentContent = textEditor.val().trim();
            const newContent = currentContent
                ? currentContent + '\n' + selectedRegexes.join('\n')
                : selectedRegexes.join('\n');
            textEditor.val(newContent);
            toastr.success(`成功从ST正则引擎导入 ${selectedRegexes.length} 条正则表达式。`);
        } else {
            toastr.info('未选择任何正则表达式。');
        }
    } catch (error) {
        console.error('加载正则引擎模块失败:', error);
        toastr.error('加载ST正则引擎模块失败，请确保正则扩展已启用。');
    }
}

/**
 * 危险正则模式检测规则
 * 用于识别可能导致灾难性回溯 (catastrophic backtracking) 的正则表达式
 */
const DANGEROUS_REGEX_PATTERNS = [
    {
        // 嵌套量词: (a+)+, (a*)+, (a+)*, (.+)+, (.*)+, etc.
        pattern: /\([^)]*[+*][^)]*\)[+*]/,
        name: '嵌套量词',
        description: '如 (a+)+, (.+)+ 会导致指数级回溯'
    },
    {
        // 连续通配量词: .*.*,  .+.+, .*?.+, etc.
        pattern: /\.\*\.\*|\.\+\.\+|\.\*\?\.\+|\.\+\?\.\*/,
        name: '连续通配符',
        description: '如 .*.*, .+.+ 会导致大量回溯'
    },
    {
        // 贪婪匹配后跟随相似模式: .*\w, .+\w, .*\S, .+\S
        pattern: /\.\+[^?].*\.\+|\.\*[^?].*\.\*/,
        name: '多重贪婪匹配',
        description: '多个贪婪匹配可能导致性能问题'
    },
    {
        // 空匹配循环: ()*, ()+, ()?+
        pattern: /\(\s*\)[+*]/,
        name: '空匹配循环',
        description: '空括号加量词会导致无限循环'
    },
    {
        // 复杂嵌套组合: ((a+)+)+, (((.*)+)+)+
        pattern: /\(\([^)]*[+*][^)]*\)[+*]\)/,
        name: '深层嵌套量词',
        description: '多层嵌套量词风险极高'
    },
    {
        // 交替匹配与量词组合: (a|b+)+, (a*|b)+
        pattern: /\([^)]*\|[^)]*[+*][^)]*\)[+*]|\([^)]*[+*][^)]*\|[^)]*\)[+*]/,
        name: '交替量词组合',
        description: '如 (a|b+)+ 可能导致回溯'
    }
];

/**
 * 检测正则表达式是否包含危险模式
 * @param {string} regexStr - 正则表达式字符串
 * @returns {{isDangerous: boolean, warnings: Array<{name: string, description: string}>}} 检测结果
 */
function detectDangerousRegex(regexStr) {
    if (!regexStr || typeof regexStr !== 'string') {
        return { isDangerous: false, warnings: [] };
    }

    const warnings = [];

    // 检查各种危险模式
    for (const rule of DANGEROUS_REGEX_PATTERNS) {
        if (rule.pattern.test(regexStr)) {
            warnings.push({
                name: rule.name,
                description: rule.description
            });
        }
    }

    // 检查正则长度（过长的正则可能有性能问题）
    if (regexStr.length > 500) {
        warnings.push({
            name: '过长正则',
            description: `正则长度 ${regexStr.length} 字符，可能影响性能`
        });
    }

    // 检查量词数量（太多量词可能有问题）
    const quantifierCount = (regexStr.match(/[+*?]|\{\d+,?\d*\}/g) || []).length;
    if (quantifierCount > 10) {
        warnings.push({
            name: '过多量词',
            description: `包含 ${quantifierCount} 个量词，可能影响性能`
        });
    }

    return {
        isDangerous: warnings.length > 0,
        warnings
    };
}

/**
 * 生成危险正则警告的 HTML
 * @param {Array<{name: string, description: string}>} warnings - 警告列表
 * @returns {string} 警告 HTML
 */
function generateDangerousRegexWarningHTML(warnings) {
    if (!warnings || warnings.length === 0) return '';

    const warningText = warnings.map(w => `${w.name}: ${w.description}`).join('\n');
    return `<span class="st-chatu8-entry-danger-warning" title="${warningText}"><i class="fa-solid fa-skull-crossbones"></i></span>`;
}

/**
 * Escapes special characters in a string for use in a regular expression.
 * @param {string} str The string to escape.
 * @returns {string} The escaped string.
 */
function escapeRegex(str) {
    // Escape characters with special meaning in regular expressions.
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Checks if a string is a valid regex literal (e.g., /pattern/flags).
 * Supports formats like /pattern/, /pattern/g, /pattern/gi, etc.
 * @param {string} str The string to check.
 * @returns {boolean} True if it's a regex literal, false otherwise.
 */
function isRegexLiteral(str) {
    // Check if it starts with / and ends with / or /flags (like /g, /gi, /gim, etc.)
    const regexLiteralPattern = /^\/(.+)\/([gimsuy]*)$/;
    return regexLiteralPattern.test(str);
}

/**
 * Parses a regex literal string and returns a RegExp object.
 * @param {string} str The regex literal string (e.g., /pattern/flags).
 * @returns {RegExp|null} The RegExp object or null if parsing fails.
 */
function parseRegexLiteral(str) {
    const regexLiteralPattern = /^\/(.+)\/([gimsuy]*)$/;
    const match = str.match(regexLiteralPattern);
    if (match) {
        try {
            const pattern = match[1];
            let flags = match[2];
            // Ensure 'g' flag is present for matchAll to work
            if (!flags.includes('g')) {
                flags += 'g';
            }
            return new RegExp(pattern, flags);
        } catch (e) {
            console.error(`Invalid regex pattern: ${str}`, e);
            return null;
        }
    }
    return null;
}

/**
 * Merges overlapping or adjacent ranges.
 * @param {Array<{start: number, end: number}>} ranges - An array of ranges.
 * @returns {Array<{start: number, end: number}>} A new array with merged ranges.
 */
function mergeRanges(ranges) {
    if (ranges.length < 2) return ranges;

    // Sort by start index
    ranges.sort((a, b) => a.start - b.start);

    const merged = [ranges[0]];

    for (let i = 1; i < ranges.length; i++) {
        const last = merged[merged.length - 1];
        const current = ranges[i];

        if (current.start <= last.end) {
            // Overlap or adjacent, merge them
            last.end = Math.max(last.end, current.end);
        } else {
            // No overlap, add new range
            merged.push(current);
        }
    }

    return merged;
}


/**
 * Applies the regex from the editors to the test text, tracking removed indices.
 * @param {string} [requestId] - 来自事件调用的请求 ID（手动点击时为空）
 * @param {object} [options] - 处理选项
 * @param {boolean} [options.keepImageTag] - 为 true 时保护 <image>...</image> 块不被任何正则清除
 */
async function onTestRegexClick(requestId, options = {}) {
    const timer = debugTimer('regex.onTestRegexClick', '正则处理流程');
    const keepImageTag = options.keepImageTag === true;

    const sourceText = originalText.val();
    const beforeAfterRegexStr = beforeAfterEditor.val().trim();
    const textRegexStr = textEditor.val();
    let allRemovedRanges = [];

    debugLog('regex.onTestRegexClick', '开始正则处理', {
        请求ID: requestId || '(手动测试)',
        原文长度: sourceText?.length || 0,
        保护image标签: keepImageTag
    });

    // 记录原始文本内容
    debugContent('regex.onTestRegexClick', '原始文本', sourceText, 300);

    try {
        let textToProcess = sourceText || '';
        let baseOffset = 0;

        // ★ 保护 <image> 标签：在所有正则处理之前，用唯一占位符替换整个 <image>...</image> 块
        // 由调用方通过 REGEX_TEST_MESSAGE 的 keepImageTag 参数开启（当前仅正文生图的历史消息路径会传）
        const imgPlaceholders = [];
        const imgProtectPrefix = `@@CHATU8_IMG_${Date.now()}_${Math.random().toString(36).slice(2, 8)}_`;
        if (keepImageTag) {
            textToProcess = textToProcess.replace(
                /<image\b[^>]*>[\s\S]*?<\/image>/gi,
                (match) => {
                    const token = `${imgProtectPrefix}${imgPlaceholders.length}@@`;
                    imgPlaceholders.push({ token, original: match });
                    return token;
                }
            );
            if (imgPlaceholders.length > 0) {
                debugLog('regex.onTestRegexClick', '🛡️ 已保护 <image> 标签', {
                    数量: imgPlaceholders.length
                });
            }
        }

        // 1. Apply "正则预设编辑器" entries (regexEntries) - find/replace operations
        // This runs FIRST before any other processing
        const regexEntries = collectRegexEntriesFromUI();

        // 获取当前配置名称
        const currentProfileName = profileSelect ? profileSelect.val() : '(未知)';

        debugLog('regex.onTestRegexClick', '正则条目列表', {
            当前配置: currentProfileName,
            总条目数: regexEntries.length,
            启用条目数: regexEntries.filter(e => !e.disabled).length,
            条目名称列表: regexEntries.map((e, i) => `${i + 1}. ${e.scriptName || '(无名称)'}${e.disabled ? ' [禁用]' : ''}`).join('\n')
        });

        // 使用 for...of 循环以支持 await
        for (let index = 0; index < regexEntries.length; index++) {
            const entry = regexEntries[index];
            // Skip disabled entries
            if (entry.disabled) {
                debugBranch('onTestRegexClick', `条目 ${index + 1} "${entry.scriptName}" 已禁用`, true, {
                    索引: index,
                    名称: entry.scriptName
                });
                continue;
            }
            // Skip entries without findRegex
            if (!entry.findRegex) {
                debugBranch('onTestRegexClick', `条目 ${index + 1} "${entry.scriptName}" 无findRegex`, true);
                continue;
            }

            // 检测超级危险的正则模式 - 跳过可能导致卡死的正则
            const dangerCheck = detectDangerousRegex(entry.findRegex);
            const hasCriticalDanger = dangerCheck.warnings.some(w =>
                w.name === '嵌套量词' ||
                w.name === '深层嵌套量词' ||
                w.name === '空匹配循环'
            );

            if (hasCriticalDanger) {
                const warningNames = dangerCheck.warnings.map(w => w.name).join(', ');
                debugLog('regex.onTestRegexClick', `⚠️ 跳过危险正则: ${entry.scriptName}`, {
                    危险类型: warningNames,
                    正则: entry.findRegex.substring(0, 50)
                });
                console.warn(`[st-chatu8] 跳过危险正则 "${entry.scriptName}": ${warningNames}`);
                toastr.warning(`跳过危险正则 "${entry.scriptName}"<br>原因: ${warningNames}`, '正则安全检查', {
                    timeOut: 5000,
                    escapeHtml: false
                });
                continue;
            }

            const beforeLength = textToProcess.length;

            try {
                const findRegexStr = entry.findRegex.trim();
                let pattern, flags;

                // Check if findRegex is a regex literal (e.g., /pattern/flags)
                if (isRegexLiteral(findRegexStr)) {
                    const regexLiteralPattern = /^\/(.+)\/([gimsuy]*)$/;
                    const match = findRegexStr.match(regexLiteralPattern);
                    if (!match) {
                        debugLog('regex.onTestRegexClick', `条目 "${entry.scriptName}" 正则解析失败`, {
                            findRegex: findRegexStr
                        });
                        console.warn(`正则条目 "${entry.scriptName}" 的 findRegex 解析失败: ${findRegexStr}`);
                        continue;
                    }
                    pattern = match[1];
                    flags = match[2] || '';
                    // Ensure 'g' flag is present
                    if (!flags.includes('g')) {
                        flags += 'g';
                    }
                } else {
                    // Treat as plain regex pattern, add global flag
                    pattern = findRegexStr;
                    flags = 'g';
                }

                const replaceString = entry.replaceString || '';

                // 使用超时检查执行匹配
                const matchResult = await executeRegexWithTimeout('match', textToProcess, pattern, flags);
                if (!matchResult.success) {
                    if (matchResult.timeout) {
                        debugLog('regex.onTestRegexClick', `⏱️ 正则超时: ${entry.scriptName}`, {
                            正则: findRegexStr.substring(0, 50)
                        });
                        console.warn(`[st-chatu8] 正则条目 "${entry.scriptName}" 匹配超时`);
                        toastr.warning(`正则条目 "${entry.scriptName}" 执行超时 (>1000ms)，已跳过`, '正则超时', {
                            timeOut: 5000
                        });
                    } else {
                        console.warn(`正则条目 "${entry.scriptName}" 匹配失败:`, matchResult.error);
                    }
                    continue;
                }
                const matchCount = matchResult.result?.matches?.length || 0;

                // 使用超时检查执行替换
                const replaceResult = await executeRegexWithTimeout('replace', textToProcess, pattern, flags, replaceString);
                if (!replaceResult.success) {
                    if (replaceResult.timeout) {
                        debugLog('regex.onTestRegexClick', `⏱️ 正则替换超时: ${entry.scriptName}`, {
                            正则: findRegexStr.substring(0, 50)
                        });
                        console.warn(`[st-chatu8] 正则条目 "${entry.scriptName}" 替换超时`);
                        toastr.warning(`正则条目 "${entry.scriptName}" 替换超时 (>1000ms)，已跳过`, '正则超时', {
                            timeOut: 5000
                        });
                    } else {
                        console.warn(`正则条目 "${entry.scriptName}" 替换失败:`, replaceResult.error);
                    }
                    continue;
                }
                // 确保 result 不为 null
                if (replaceResult.result == null) {
                    console.warn(`正则条目 "${entry.scriptName}" 替换结果为空`);
                    continue;
                }
                textToProcess = replaceResult.result;

                const afterLength = textToProcess.length;
                const lengthDiff = afterLength - beforeLength;

                // 只有当有实际匹配时才记录日志
                if (matchCount > 0 || lengthDiff !== 0) {
                    debugLog('regex.onTestRegexClick', `正则条目处理: ${entry.scriptName}`, {
                        索引: index + 1,
                        名称: entry.scriptName,
                        正则: findRegexStr.substring(0, 50) + (findRegexStr.length > 50 ? '...' : ''),
                        替换为: replaceString.substring(0, 30) + (replaceString.length > 30 ? '...' : ''),
                        匹配数: matchCount,
                        长度变化: lengthDiff,
                        处理前长度: beforeLength,
                        处理后长度: afterLength
                    });
                }
            } catch (e) {
                debugLog('regex.onTestRegexClick', `条目 "${entry.scriptName}" 执行失败`, {
                    错误: e.message
                });
                console.warn(`正则条目 "${entry.scriptName}" 执行失败:`, e);
            }
        }


        // 2. Apply "前后正则" (Context trimming) - 带超时检查
        debugLog('regex.onTestRegexClick', '前后正则处理开始', {
            输入值: beforeAfterRegexStr,
            输入长度: beforeAfterRegexStr.length,
            包含分隔符: beforeAfterRegexStr.includes('|')
        });

        if (beforeAfterRegexStr.includes('|')) {
            const parts = beforeAfterRegexStr.split('|');
            debugLog('regex.onTestRegexClick', '前后正则分割结果', {
                分割数量: parts.length,
                前边界: parts[0] || '(空)',
                后边界: parts[1] || '(空)',
                完整分割: parts
            });

            if (parts.length === 2) {
                const before = parts[0] === '^' ? '^' : escapeRegex(parts[0]);
                const after = parts[1] === '$' ? '$' : escapeRegex(parts[1]);
                const contextPattern = `${before}([\\s\\S]*?)${after}`;

                // 关键调试：检查文本是否实际包含前后边界
                const containsBefore = parts[0] === '^' ? true : textToProcess.includes(parts[0]);
                const containsAfter = parts[1] === '$' ? true : textToProcess.includes(parts[1]);
                debugLog('regex.onTestRegexClick', '🔍 前后正则匹配前检查', {
                    待处理文本长度: textToProcess.length,
                    文本预览前200字符: textToProcess.substring(0, 200),
                    文本预览后200字符: textToProcess.substring(Math.max(0, textToProcess.length - 200)),
                    前边界原值: parts[0],
                    后边界原值: parts[1],
                    文本包含前边界: containsBefore,
                    文本包含后边界: containsAfter
                });
                console.log('[st-chatu8] 前后正则匹配前文本预览:', textToProcess.substring(0, 300));

                debugLog('regex.onTestRegexClick', '前后正则模式生成', {
                    前边界转义: before,
                    后边界转义: after,
                    完整模式: contextPattern,
                    待匹配文本长度: textToProcess.length
                });

                // 使用超时检查执行匹配
                const matchResult = await executeRegexWithTimeout('match', textToProcess, contextPattern, 'i');

                debugLog('regex.onTestRegexClick', '前后正则匹配结果', {
                    成功: matchResult.success,
                    超时: matchResult.timeout || false,
                    错误: matchResult.error || null,
                    有结果: !!matchResult.result,
                    结果类型: matchResult.result ? typeof matchResult.result : 'undefined',
                    匹配数组长度: matchResult.result?.matches ? matchResult.result.matches.length : 0,
                    匹配数组内容: matchResult.result?.matches ? JSON.stringify(matchResult.result.matches) : 'N/A',
                    matches0类型: matchResult.result?.matches ? typeof matchResult.result.matches[0] : 'N/A',
                    matches1类型: matchResult.result?.matches ? typeof matchResult.result.matches[1] : 'N/A',
                    matches1值: matchResult.result?.matches?.[1] !== undefined ? String(matchResult.result.matches[1]).substring(0, 50) : 'undefined'
                });
                console.log('[st-chatu8] 完整 matchResult:', JSON.stringify(matchResult, null, 2));

                // 新格式: matchResult.result = { matches: [...], index: number, input: string }
                if (matchResult.success && matchResult.result && matchResult.result.matches && typeof matchResult.result.matches[1] === 'string') {
                    const match = matchResult.result;
                    const content = match.matches[1];
                    const contentStart = match.index + match.matches[0].indexOf(content);
                    const contentEnd = contentStart + content.length;

                    debugLog('regex.onTestRegexClick', '前后正则匹配成功', {
                        匹配开始位置: match.index,
                        提取内容长度: content.length,
                        内容开始: contentStart,
                        内容结束: contentEnd,
                        原文长度: textToProcess.length
                    });
                    debugContent('regex.onTestRegexClick', '前后正则提取内容', content, 200);

                    if (contentStart > 0) {
                        allRemovedRanges.push({ start: 0, end: contentStart });
                    }
                    if (contentEnd < textToProcess.length) {
                        allRemovedRanges.push({ start: contentEnd, end: textToProcess.length });
                    }

                    textToProcess = content;
                    baseOffset = contentStart;
                } else if (matchResult.timeout) {
                    console.warn('[st-chatu8] 前后正则匹配超时');
                    toastr.warning('前后正则匹配超时 (>1000ms)，已跳过', '正则超时', { timeOut: 5000 });
                } else {
                    // 匹配失败但没有超时 - 记录详细信息
                    debugLog('regex.onTestRegexClick', '⚠️ 前后正则未能匹配', {
                        原因: !matchResult.success ? '执行失败' :
                            !matchResult.result ? '结果为空' :
                                !matchResult.result.matches ? '无匹配数组' :
                                    typeof matchResult.result.matches[1] !== 'string' ? '捕获组不是字符串' : '未知',
                        错误信息: matchResult.error || null,
                        正则模式: contextPattern,
                        文本预览: textToProcess.substring(0, 100) + (textToProcess.length > 100 ? '...' : '')
                    });
                    console.warn('[st-chatu8] 前后正则未能匹配文本。模式:', contextPattern);
                }
            } else {
                debugLog('regex.onTestRegexClick', '⚠️ 前后正则格式错误', {
                    原因: `分割后部分数量为 ${parts.length}，期望为 2`,
                    提示: '格式应为: 前边界|后边界'
                });
                console.warn('[st-chatu8] 前后正则格式错误: 期望 1 个分隔符 |，实际分割为', parts.length, '部分');
            }
        } else if (beforeAfterRegexStr.trim()) {
            // 有输入但没有分隔符
            debugLog('regex.onTestRegexClick', '⚠️ 前后正则缺少分隔符', {
                输入: beforeAfterRegexStr,
                提示: '格式应为: 前边界|后边界，使用 | 作为分隔符'
            });
            console.warn('[st-chatu8] 前后正则缺少分隔符 |，格式应为: 前边界|后边界');
        } else {
            debugBranch('onTestRegexClick', '前后正则为空，跳过', true);
        }

        // 3. Apply built-in default filters (内置默认过滤规则) - 带超时警告
        // Filter out <image>...</image> tags and dynamically configured marker tags
        const settings = extension_settings[extensionName];
        const startTag = settings?.startTag || 'image###';
        const endTag = settings?.endTag || '###';
        const escapedStart = startTag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const escapedEnd = endTag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

        const builtInFilters = [
            // ★ 保护模式下跳过内置的 <image> 过滤器
            ...(keepImageTag ? [] : [{ pattern: /<image>[\s\S]*?<\/image>/g, desc: '过滤 <image> 标签' }]),
            { pattern: new RegExp(`${escapedStart}[\\s\\S]*?${escapedEnd}`, 'g'), desc: `过滤 ${startTag} 标记` },
            { pattern: /<!--[\s\S]*?-->/g, desc: '过滤 HTML 注释 <!-- -->' }
        ];
        // 如果用户自定义了标签，为了兼容性依然保留旧版过滤
        if (startTag !== 'image###') {
            builtInFilters.push({ pattern: /image###[\s\S]*?###/g, desc: '过滤旧的 image### 标记' });
        }
        for (const filter of builtInFilters) {
            textToProcess = executeRegexWithWarning(
                () => textToProcess.replace(filter.pattern, ''),
                filter.desc
            );
        }

        // 3.5 Apply "词汇简单替换" (Word replacement) - 正文替换
        textToProcess = applyWordReplacement(textToProcess, 'text');

        // 4. Apply "文字正则" (Text removal) and collect ranges - 带超时检查
        let relativeRanges = [];
        if (textRegexStr.trim()) {
            const lines = textRegexStr.split('\n');
            for (const line of lines) {
                const trimmedLine = line.trim();
                if (!trimmedLine) continue;

                let pattern, flags;

                // Check if this line is a true regex literal (e.g., /pattern/g)
                if (isRegexLiteral(trimmedLine)) {
                    const regexLiteralPattern = /^\/(.+)\/([gimsuy]*)$/;
                    const literalMatch = trimmedLine.match(regexLiteralPattern);
                    if (!literalMatch) {
                        console.warn(`Failed to parse regex literal: ${trimmedLine}`);
                        continue; // Skip this line if parsing fails
                    }
                    pattern = literalMatch[1];
                    flags = literalMatch[2] || '';
                    // Ensure 'g' flag is present for matchAll
                    if (!flags.includes('g')) {
                        flags += 'g';
                    }
                } else if (trimmedLine.includes('|')) {
                    // Legacy pipe-separated format: start|end
                    const parts = trimmedLine.split('|');
                    if (parts.length === 2) {
                        const start = parts[0] === '^' ? '^' : escapeRegex(parts[0]);
                        const end = parts[1] === '$' ? '$' : escapeRegex(parts[1]);
                        pattern = `${start}[\\s\\S]*?${end}`;
                        flags = 'g';
                    } else {
                        continue;
                    }
                } else {
                    // Plain text - escape and match literally
                    pattern = escapeRegex(trimmedLine);
                    flags = 'g';
                }

                // 使用超时检查执行 matchAll
                const matchAllResult = await executeRegexWithTimeout('matchAll', textToProcess, pattern, flags);
                if (matchAllResult.success && matchAllResult.result) {
                    for (const matchItem of matchAllResult.result) {
                        if (matchItem && matchItem.match != null) {
                            relativeRanges.push({
                                start: matchItem.index,
                                end: matchItem.index + matchItem.match.length
                            });
                        }
                    }
                } else if (matchAllResult.timeout) {
                    console.warn(`[st-chatu8] 文字正则匹配超时: ${trimmedLine.substring(0, 30)}`);
                    toastr.warning(`文字正则匹配超时 (>1000ms)，已跳过: ${trimmedLine.substring(0, 30)}...`, '正则超时', {
                        timeOut: 5000
                    });
                }
            }
        }

        // 5. Merge relative ranges and generate final text
        const mergedRelativeRanges = mergeRanges(relativeRanges);
        let final_text = '';
        let lastIndex = 0;
        mergedRelativeRanges.forEach(range => {
            final_text += textToProcess.substring(lastIndex, range.start);
            lastIndex = range.end;
        });
        final_text += textToProcess.substring(lastIndex);

        // 6. Adjust relative ranges to be absolute and add to the main list
        const absoluteTextRanges = mergedRelativeRanges.map(range => ({
            start: range.start + baseOffset,
            end: range.end + baseOffset
        }));
        allRemovedRanges.push(...absoluteTextRanges);

        // 7. Final merge of all ranges
        const finalRemovedRanges = mergeRanges(allRemovedRanges);

        // ★ 还原被保护的 <image> 标签
        if (keepImageTag && imgPlaceholders.length > 0) {
            for (const { token, original } of imgPlaceholders) {
                final_text = final_text.split(token).join(original);
            }
            debugLog('regex.onTestRegexClick', '🛡️ 已还原 <image> 标签', {
                数量: imgPlaceholders.length
            });
        }

        // ★ 新增：经过所有的正常正则之后，最后经过这个内置正则
        if (!keepImageTag) {
            final_text = final_text.replace(/<image>[\s\S]*?<\/image>/g, '');
        }

        final_text = final_text.trim();
        resultText.val(final_text);

        // 记录处理结果到调试日志
        debugLog('regex.onTestRegexClick', '正则处理完成', {
            原始长度: sourceText?.length || 0,
            最终长度: final_text?.length || 0,
            长度变化: (final_text?.length || 0) - (sourceText?.length || 0),
            移除范围数: finalRemovedRanges.length
        });
        debugContent('regex.onTestRegexClick', '处理后文本', final_text, 300);

        // 8. 添加处理后文本到日志
        addLog(`[Regex 处理后文本]\n${final_text}`);

        // 9. Emit result
        const isAutomatedCall = !!requestId;
        const isTestMode = extension_settings[extensionName].regexTestMode;

        if (isAutomatedCall || !isTestMode) {
            debugBranch('onTestRegexClick', '发送正则处理结果', true, {
                是自动调用: isAutomatedCall,
                测试模式: isTestMode
            });
            eventSource.emit(eventNames.REGEX_RESULT_MESSAGE, {
                message: final_text,
                removedRanges: finalRemovedRanges, // Include the ranges
                id: requestId
            });
        }

        timer.end(`处理完成 - 原文${sourceText?.length || 0}字 → 最终${final_text?.length || 0}字`);
    } catch (e) {
        debugLog('regex.onTestRegexClick', '正则处理失败', {
            错误: e.message
        });
        timer.end(`处理失败: ${e.message}`);
        toastr.error(`正则表达式错误: ${e.message}`);
        resultText.val(`错误: ${e.message}`);
    }
}


/**
 * Handles the change event of the test mode switch.
 */
function onRegexTestModeChange() {
    extension_settings[extensionName].regexTestMode = $(this).is(':checked');
    saveSettingsDebounced();
}

function onGestureEnabledChange() {
    const enabled = $(this).is(':checked');
    extension_settings[extensionName].gestureEnabled = enabled;
    saveSettingsDebounced();

    // 根据开关状态启动或停止手势监控
    if (enabled) {
        initGestureMonitor();
    } else {
        stopGestureMonitor();
    }
}

function onClickTriggerEnabledChange() {
    const enabled = $(this).is(':checked');
    extension_settings[extensionName].clickTriggerEnabled = enabled;
    saveSettingsDebounced();

    // 根据开关状态启动或停止点击触发监控
    if (enabled) {
        initClickTriggerMonitor();
    } else {
        stopClickTriggerMonitor();
    }
}

function onGestureShowRecognitionChange() {
    extension_settings[extensionName].gestureShowRecognition = $(this).is(':checked');
    saveSettingsDebounced();
}

function onGestureShowTrailChange() {
    extension_settings[extensionName].gestureShowTrail = $(this).is(':checked');
    saveSettingsDebounced();
}

function onGestureTrailColorChange() {
    extension_settings[extensionName].gestureTrailColor = $(this).val();
    saveSettingsDebounced();
}

function onImageGenDemandEnabledChange() {
    extension_settings[extensionName].imageGenDemandEnabled = $(this).is(':checked');
    saveSettingsDebounced();
}

function onGestureMatchThresholdChange() {
    const value = $(this).val();
    gestureMatchThresholdValue.text(`${value}%`);
    extension_settings[extensionName].gestureMatchThreshold = parseInt(value, 10);
    saveSettingsDebounced();
}

function onDefaultCharDemandChange() {
    extension_settings[extensionName].defaultCharDemand = $(this).val();
    saveSettingsDebounced();
}

function onDefaultImageDemandChange() {
    extension_settings[extensionName].defaultImageDemand = $(this).val();
    saveSettingsDebounced();
}

/**
 * Initializes the regex settings tab.
 */
export function initRegexSettings() {
    // Cache DOM elements
    profileSelect = $('#ch-regex-profile-select');
    beforeAfterEditor = $('#ch-regex-before-after-editor');
    textEditor = $('#ch-regex-text-editor');
    originalText = $('#ch-regex-test-original-text');
    resultText = $('#ch-regex-test-result-text');
    regexTestModeSwitch = $('#ch-regex-test-mode');
    gestureEnabledSwitch = $('#ch-gesture-enabled');
    clickTriggerEnabledSwitch = $('#ch-click-trigger-enabled');
    gestureShowRecognitionSwitch = $('#ch-gesture-show-recognition');
    gestureShowTrailSwitch = $('#ch-gesture-show-trail');
    gestureTrailColorPicker = $('#ch-gesture-trail-color');
    gestureMatchThresholdSlider = $('#ch-gesture-match-threshold');
    gestureMatchThresholdValue = $('#ch-gesture-match-threshold-value');
    imageGenDemandEnabledSwitch = $('#ch-image-gen-demand-enabled');
    defaultCharDemandTextarea = $('#ch-default-char-demand');
    defaultImageDemandTextarea = $('#ch-default-image-demand');

    // Load initial state
    regexTestModeSwitch.prop('checked', extension_settings[extensionName].regexTestMode ?? false);
    gestureEnabledSwitch.prop('checked', extension_settings[extensionName].gestureEnabled ?? false);
    clickTriggerEnabledSwitch.prop('checked', extension_settings[extensionName].clickTriggerEnabled ?? true);
    gestureShowRecognitionSwitch.prop('checked', extension_settings[extensionName].gestureShowRecognition ?? true);
    gestureShowTrailSwitch.prop('checked', extension_settings[extensionName].gestureShowTrail ?? true);
    gestureTrailColorPicker.val(extension_settings[extensionName].gestureTrailColor ?? '#00ff00');
    const threshold = extension_settings[extensionName].gestureMatchThreshold ?? 60;
    gestureMatchThresholdSlider.val(threshold);
    gestureMatchThresholdValue.text(`${threshold}%`);
    imageGenDemandEnabledSwitch.prop('checked', extension_settings[extensionName].imageGenDemandEnabled ?? false);
    defaultCharDemandTextarea.val(extension_settings[extensionName].defaultCharDemand ?? '');
    defaultImageDemandTextarea.val(extension_settings[extensionName].defaultImageDemand ?? '');


    // Bind event listeners
    $('#ch-new-regex-profile-button').on('click', onNewProfileClick);
    $('#ch-rename-regex-profile-button').on('click', onRenameProfileClick);
    $('#ch-save-regex-profile-button').on('click', onSaveProfileClick);
    $('#ch-save-as-regex-profile-button').on('click', onSaveAsProfileClick);
    $('#ch-delete-regex-profile-button').on('click', onDeleteProfileClick);
    $('#ch-import-regex-profile-button').on('click', onImportProfileClick);
    $('#ch-export-regex-profile-button').on('click', onExportProfileClick);
    $('#ch-test-regex-button').on('click', () => onTestRegexClick()); // Pass no argument for manual click
    profileSelect.on('change', onProfileSelectChange);
    regexTestModeSwitch.on('change', onRegexTestModeChange);
    gestureEnabledSwitch.on('change', onGestureEnabledChange);
    clickTriggerEnabledSwitch.on('change', onClickTriggerEnabledChange);
    gestureShowRecognitionSwitch.on('change', onGestureShowRecognitionChange);
    gestureShowTrailSwitch.on('change', onGestureShowTrailChange);
    gestureTrailColorPicker.on('input', onGestureTrailColorChange);
    gestureMatchThresholdSlider.on('input', onGestureMatchThresholdChange);
    imageGenDemandEnabledSwitch.on('change', onImageGenDemandEnabledChange);
    defaultCharDemandTextarea.on('input', onDefaultCharDemandChange);
    defaultImageDemandTextarea.on('input', onDefaultImageDemandChange);

    // Gesture recording buttons
    $('#ch-gesture-1-button').on('click', () => onRecordGestureClick('gesture1'));
    $('#ch-gesture-2-button').on('click', () => onRecordGestureClick('gesture2'));

    // Listen for the custom event from eventSource to update the test text
    eventSource.on(eventNames.REGEX_TEST_MESSAGE, (data) => {
        const { message, id, keepImageTag } = data;
        if (originalText && message) {
            // 清除日志并添加原始文本
            clearLog();
            addLog(`[Regex 原始文本]\n${message}`);
            originalText.val(message);
            // Automatically trigger the test, passing the request ID 与选项
            onTestRegexClick(id, { keepImageTag: keepImageTag === true });
        }
    });

    // 初始化正则预设编辑器（必须在 loadRegexProfiles 之前设置）
    regexEntriesContainer = $('#ch-regex-entries-container');

    // 绑定正则条目按钮事件
    $('#ch-add-regex-entry-button').on('click', addNewRegexEntry);
    $('#ch-import-regex-entry-button').on('click', importRegexEntries);
    $('#ch-import-regex-entry-engine-button').on('click', importRegexEntriesFromEngine);

    // 绑定正则条目拖拽和交互事件
    bindRegexEntryDragEvents();
    bindRegexEntryEvents();

    // Initial load of profiles（会触发 change 事件，从而通过 onProfileSelectChange 加载正则条目）
    loadRegexProfiles();

    // 初始化词汇简单替换模块
    initWordReplacementSettings();
}


/**
 * Handles the click event for recording a gesture.
 * @param {'gesture1' | 'gesture2'} gestureKey - The key for the gesture to be recorded.
 */
async function onRecordGestureClick(gestureKey) {
    try {
        const newPattern = await recordGesture();
        if (newPattern) {
            extension_settings[extensionName][gestureKey] = newPattern;
            saveSettingsDebounced();
            toastr.success(`手势 "${gestureKey === 'gesture1' ? '一' : '二'}" 已更新。`);
        }
    } catch (error) {
        toastr.error("录制手势失败。");
        console.error("Gesture recording failed:", error);
    }
}

// ==================== AI 桥接接口 ====================

/**
 * 获取正则测试区域的当前状态
 * @returns {object} 正则测试区域状态
 */
function getRegexTestStatus() {
    const testMode = extension_settings[extensionName].regexTestMode ?? false;

    // 缓存的 jQuery 引用在面板重新渲染后会指向脱离文档的旧 DOM，
    // 导致读到陈旧/空值。这里若检测到脱离文档则用实时选择器兜底。
    const live = (cached, selector) => {
        if (cached && cached.length && cached[0] && $.contains(document, cached[0])) {
            return cached;
        }
        return $(selector);
    };
    const $profile = live(profileSelect, '#ch-regex-profile-select');
    const $orig = live(originalText, '#ch-regex-test-original-text');
    const $res = live(resultText, '#ch-regex-test-result-text');
    const $ba = live(beforeAfterEditor, '#ch-regex-before-after-editor');
    const $te = live(textEditor, '#ch-regex-text-editor');

    const currentProfile = $profile.length ? $profile.val() : '';
    const origText = $orig.length ? $orig.val() : '';
    const resText = $res.length ? $res.val() : '';
    const baEditor = $ba.length ? $ba.val() : '';
    const tEditor = $te.length ? $te.val() : '';

    // 收集当前正则条目
    const entries = collectRegexEntriesFromUI();
    const entrySummary = entries.map((e, i) => ({
        index: i + 1,
        name: e.scriptName || '(无名称)',
        disabled: !!e.disabled,
        findRegex: (e.findRegex || '').substring(0, 60),
        replaceString: (e.replaceString || '').substring(0, 60)
    }));

    // 手势和点击功能状态
    const gestureEnabled = extension_settings[extensionName].gestureEnabled ?? false;
    const clickTriggerEnabled = extension_settings[extensionName].clickTriggerEnabled ?? false;

    return {
        testMode,
        currentProfile,
        originalText: origText ? origText.substring(0, 30000) : '(空)',
        resultText: resText ? resText.substring(0, 30000) : '(空)',
        beforeAfterRegex: baEditor || '(空)',
        textRegex: tEditor || '(空)',
        regexEntries: entrySummary,
        entryCount: entries.length,
        gestureEnabled,
        clickTriggerEnabled
    };
}

/**
 * AI 设置原文框的文本
 * @param {string} text - 要设置的文本
 * @returns {string} 操作结果
 */
function setRegexOriginalText(text) {
    if (!originalText || originalText.length === 0) {
        return '❌ 原文框不存在，请先切换到正则页面。';
    }
    originalText.val(text || '');
    return `✅ 已设置原文 (${(text || '').length} 字符)`;
}

/**
 * AI 设置前后正则和文字正则编辑器内容
 * @param {string} beforeAfter - 前后正则内容
 * @param {string} textRegex - 文字正则内容
 * @returns {string} 操作结果
 */
function setRegexEditors(beforeAfter, textRegex) {
    const results = [];
    if (beforeAfter !== undefined && beforeAfter !== null) {
        if (!beforeAfterEditor || beforeAfterEditor.length === 0) {
            results.push('❌ 前后正则编辑器不存在');
        } else {
            beforeAfterEditor.val(beforeAfter);
            results.push(`✅ 前后正则已设置`);
        }
    }
    if (textRegex !== undefined && textRegex !== null) {
        if (!textEditor || textEditor.length === 0) {
            results.push('❌ 文字正则编辑器不存在');
        } else {
            textEditor.val(textRegex);
            results.push(`✅ 文字正则已设置`);
        }
    }
    return results.join('\n');
}

/**
 * AI 通过数据创建正则条目
 * @param {object} data - 正则条目数据 {scriptName, findRegex, replaceString, disabled}
 * @returns {string} 操作结果
 */
function createRegexEntryByAI(data) {
    if (!data || !data.findRegex) {
        return '❌ 必须提供 findRegex 字段。';
    }

    // 确保容器存在
    const containerInDocument = regexEntriesContainer && $.contains(document, regexEntriesContainer[0]);
    if (!containerInDocument) {
        regexEntriesContainer = $('#ch-regex-entries-container');
    }
    if (!regexEntriesContainer || regexEntriesContainer.length === 0) {
        return '❌ 正则条目容器不存在，请先切换到正则页面。';
    }

    // 移除空状态提示
    regexEntriesContainer.find('.st-chatu8-entries-empty').remove();

    const newEntry = {
        ...DEFAULT_REGEX_ENTRY,
        id: generateRegexEntryId(),
        scriptName: data.scriptName || 'AI创建的正则',
        findRegex: data.findRegex,
        replaceString: data.replaceString || '',
        disabled: data.disabled === true
    };

    addRegexEntryDOM(newEntry);
    saveRegexEntriesToProfile();

    return `✅ 已创建正则条目: "${newEntry.scriptName}"\n   查找: ${newEntry.findRegex.substring(0, 80)}\n   替换: ${(newEntry.replaceString || '(空)').substring(0, 80)}`;
}

/**
 * AI 触发正则测试
 * @returns {Promise<string>} 测试结果
 */
async function triggerRegexTest() {
    try {
        await onTestRegexClick();
        // 等待一小段时间让 UI 更新
        await new Promise(resolve => setTimeout(resolve, 300));
        const resText = resultText ? resultText.val() : '';
        return `✅ 正则测试完成。\n结果文本:\n${resText ? resText.substring(0, 30000) : '(空)'}`;
    } catch (e) {
        return `❌ 正则测试失败: ${e.message}`;
    }
}

/**
 * AI 开关正则测试模式
 * @param {boolean} enabled - 是否开启
 * @returns {string} 操作结果
 */
function setRegexTestMode(enabled) {
    if (!regexTestModeSwitch || regexTestModeSwitch.length === 0) {
        return '❌ 测试模式开关不存在，请先切换到正则页面。';
    }
    regexTestModeSwitch.prop('checked', !!enabled).trigger('change');
    return `✅ 正则测试模式已${enabled ? '开启' : '关闭'}`;
}

/**
 * 获取正则测试结果文本
 * @returns {string} 结果文本
 */
function getRegexResultText() {
    const resText = resultText ? resultText.val() : '';
    return resText || '(空)';
}

/**
 * AI 开关手势功能
 * @param {boolean} enabled - 是否开启
 * @returns {string} 操作结果
 */
function setGestureEnabled(enabled) {
    if (!gestureEnabledSwitch || gestureEnabledSwitch.length === 0) {
        return '❌ 手势功能开关不存在，请先切换到正则页面。';
    }
    gestureEnabledSwitch.prop('checked', !!enabled).trigger('change');
    return `✅ 手势功能已${enabled ? '开启' : '关闭'}`;
}

/**
 * AI 开关点击触发功能
 * @param {boolean} enabled - 是否开启
 * @returns {string} 操作结果
 */
function setClickTriggerEnabled(enabled) {
    if (!clickTriggerEnabledSwitch || clickTriggerEnabledSwitch.length === 0) {
        return '❌ 点击触发开关不存在，请先切换到正则页面。';
    }
    clickTriggerEnabledSwitch.prop('checked', !!enabled).trigger('change');
    return `✅ 点击触发已${enabled ? '开启' : '关闭'}`;
}

/**
 * AI 清除所有正则条目
 * @returns {string} 操作结果
 */
function clearAllRegexEntries() {
    const containerInDocument = regexEntriesContainer && $.contains(document, regexEntriesContainer[0]);
    if (!containerInDocument) {
        regexEntriesContainer = $('#ch-regex-entries-container');
    }
    if (!regexEntriesContainer || regexEntriesContainer.length === 0) {
        return '❌ 正则条目容器不存在，请先切换到正则页面。';
    }

    const count = regexEntriesContainer.find('.st-chatu8-preset-entry').length;
    regexEntriesContainer.empty();
    regexEntriesContainer.html(`
        <div class="st-chatu8-entries-empty">
            <i class="fa-solid fa-inbox"></i>
            <p>暂无正则条目，点击上方按钮添加</p>
        </div>
    `);
    saveRegexEntriesToProfile();
    return `✅ 已清除全部 ${count} 个正则条目`;
}

// 暴露 AI 桥接接口到 window 
window.regexAIBridge = {
    getStatus: getRegexTestStatus,
    setOriginalText: setRegexOriginalText,
    setEditors: setRegexEditors,
    createEntry: createRegexEntryByAI,
    triggerTest: triggerRegexTest,
    setTestMode: setRegexTestMode,
    getResultText: getRegexResultText,
    setGestureEnabled: setGestureEnabled,
    setClickTriggerEnabled: setClickTriggerEnabled,
    clearAllEntries: clearAllRegexEntries
};

