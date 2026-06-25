// @ts-nocheck
/**
 * knowledgeBase.js - 资料库设置界面逻辑（新版）
 *
 * 新版：资料库管理子标签页改为世界书选择 UI，参照 send_data.js 实现。
 * 数据存储在独立字段 knowledgeBaseConfig（与 send_data 的 worldBookConfig 完全隔离）。
 *
 * 人设管理、User管理子标签页代码保持不变。
 */

import { extension_settings } from '../../../../../extensions.js';
import { saveSettingsDebounced } from '../../../../../../script.js';
import { getrWorlds, getWorldEntries } from '../chatDataUtils.js';
import { extensionName } from '../config.js';
import { isKnowledgeBaseEnabled, setKnowledgeBaseEnabled } from '../knowledgeBaseService.js';
import { initPersonaSettings, refreshPersonaSettings, initUserSettings, refreshUserSettings } from './knowledgeBase/index.js';

// ========== 资料库配置读写 ==========

function getKBConfig() {
    const settings = extension_settings[extensionName];
    if (!settings.knowledgeBaseConfig) {
        settings.knowledgeBaseConfig = {
            enabled: false,
            skipConstant: true,
            worldBookSelections: {},
            worldEntrySelections: {}
        };
    }
    // 兼容旧配置：补充默认值
    if (settings.knowledgeBaseConfig.skipConstant === undefined) {
        settings.knowledgeBaseConfig.skipConstant = true;
    }
    return settings.knowledgeBaseConfig;
}

function saveKBConfig() {
    saveSettingsDebounced();
}

// ========== 模块状态 ==========

let kbWorldList = [];
let kbActiveWorld = null; // 当前右侧显示哪个世界书的条目

// ========== 初始化入口 ==========

/**
 * 初始化资料库设置界面
 * @param {jQuery} settingsModal 设置面板的 jQuery 对象
 */
export function initKnowledgeBaseSettings(settingsModal) {
    setupSubNavigation(settingsModal);
    initKBWorldBookUI(settingsModal);

    // 初始化人设模块
    initPersonaSettings(settingsModal);

    // 初始化 User 人设模块
    initUserSettings(settingsModal);
}

// ========== 子导航切换 ==========

function setupSubNavigation(container) {
    container.find('.st-chatu8-sub-nav-link').off('click').on('click', function (e) {
        e.preventDefault();
        const subTabId = $(this).data('sub-tab');

        container.find('.st-chatu8-sub-nav-link').removeClass('active');
        $(this).addClass('active');

        container.find('.st-chatu8-sub-tab-content').css('display', 'none');
        container.find(`#${subTabId}`).css('display', 'block');

        if (subTabId === 'ch-sub-tab-kb-persona') {
            refreshPersonaSettings();
        }
        if (subTabId === 'ch-sub-tab-kb-user') {
            refreshUserSettings();
        }
    });

    // 初始化：显示第一个子标签页
    const allSubNavLinks = container.find('.st-chatu8-sub-nav-link');
    const firstLink = allSubNavLinks.first();
    if (firstLink.length) {
        firstLink.addClass('active');
        const firstSubTabId = firstLink.data('sub-tab');
        container.find('.st-chatu8-sub-tab-content').css('display', 'none');
        container.find(`#${firstSubTabId}`).css('display', 'block');
    }
}

// ========== 资料库世界书选择 UI ==========

function initKBWorldBookUI(settingsModal) {
    const worldListContainer = settingsModal.find('#ch-kb2-world-list');
    const entryListContainer = settingsModal.find('#ch-kb2-entry-list');
    const worldSearchInput = settingsModal.find('#ch-kb2-world-search');
    const entrySearchInput = settingsModal.find('#ch-kb2-entry-search');
    const enabledSwitch = settingsModal.find('#ch-kb2-enabled');

    // ── 全局开关 ──
    enabledSwitch.prop('checked', isKnowledgeBaseEnabled());
    enabledSwitch.off('change').on('change', function () {
        setKnowledgeBaseEnabled($(this).prop('checked'));
    });

    // ── 触发深度 ──
    const triggerDepthInput = settingsModal.find('#ch-kb2-trigger-depth');
    const savedDepth = typeof getKBConfig().triggerDepth === 'number' ? getKBConfig().triggerDepth : 1;
    triggerDepthInput.val(savedDepth);
    triggerDepthInput.off('change input').on('change', function () {
        const val = parseInt($(this).val(), 10);
        getKBConfig().triggerDepth = isNaN(val) || val < 0 ? 0 : val;
        saveKBConfig();
    });

    // ── 跳过常开 ──
    const skipConstantSwitch = settingsModal.find('#ch-kb2-skip-constant');
    skipConstantSwitch.prop('checked', getKBConfig().skipConstant !== false);
    skipConstantSwitch.off('change').on('change', function () {
        getKBConfig().skipConstant = $(this).prop('checked');
        saveKBConfig();
    });

    // ── 加载并渲染世界书列表 ──
    async function loadAndRenderWorlds() {
        const config = getKBConfig();

        kbWorldList = await getrWorlds();

        // 如果当前没有 active，默认选第一个
        if (!kbActiveWorld && kbWorldList.length > 0) {
            kbActiveWorld = kbWorldList[0];
        }

        renderWorldList();
        renderEntryList();
    }

    function renderWorldList() {
        worldListContainer.empty();
        const fragment = document.createDocumentFragment();
        const searchTerm = worldSearchInput.val().toLowerCase();
        const config = getKBConfig();

        kbWorldList
            .filter(worldName => worldName.toLowerCase().includes(searchTerm))
            .forEach(worldName => {
                const worldItem = $('<div></div>')
                    .addClass('st-chatu8-list-item')
                    .data('worldName', worldName);

                // 勾选框：表示该世界书在资料库中是否启用
                const checkboxWrapper = $('<span></span>')
                    .addClass('st-chatu8-world-checkbox')
                    .css({
                        position: 'relative',
                        marginRight: '10px',
                        display: 'inline-block',
                        width: '16px',
                        height: '16px'
                    });

                const textSpan = $('<span></span>').text(worldName);

                // 启用则加 world-selected 类
                if (config.worldBookSelections[worldName]) {
                    worldItem.addClass('world-selected');
                }

                // 高亮当前 active
                if (worldName === kbActiveWorld) {
                    worldItem.addClass('active');
                }

                worldItem.append(checkboxWrapper).append(textSpan);
                fragment.appendChild(worldItem[0]);
            });

        worldListContainer.append(fragment);
    }

    async function renderEntryList() {
        entryListContainer.empty();
        if (!kbActiveWorld) {
            entryListContainer.html('<div style="padding:10px; color:#888;">请先在左侧选择一个世界书。</div>');
            return;
        }

        const config = getKBConfig();
        const searchTerm = entrySearchInput.val().toLowerCase();
        const entries = await getWorldEntries(kbActiveWorld);

        entryListContainer.empty();
        const fragment = document.createDocumentFragment();

        if (entries) {
            const currentWorldSelections = config.worldEntrySelections[kbActiveWorld] || {};
            const entriesArray = Array.isArray(entries) ? entries : Object.values(entries);

            const filteredEntries = entriesArray.filter(entry => {
                const comment = (entry.comment || '').toLowerCase();
                const keys = (Array.isArray(entry.key)
                    ? entry.key.join(' ')
                    : String(entry.key || '')).toLowerCase();
                return comment.includes(searchTerm) || keys.includes(searchTerm);
            });

            if (filteredEntries.length === 0) {
                entryListContainer.html('<div style="padding:10px; color:#888;">没有找到匹配的条目。</div>');
                return;
            }

            filteredEntries.forEach(entry => {
                const entryKey = entry.uid;
                const displayName = entry.comment || `条目 ${entryKey}`;
                const isConstant = entry.constant === true;

                const entryItem = $('<div></div>')
                    .addClass('st-chatu8-list-item')
                    .data('entryKey', entryKey)
                    .data('entryContent', entry.content || '');

                // 如果是常开条目，添加特殊类
                if (isConstant) {
                    entryItem.addClass('constant-entry');
                }

                // 创建文本容器
                const textSpan = $('<span></span>')
                    .addClass('st-chatu8-entry-text')
                    .text(displayName);

                // 如果是常开条目，添加"常开"徽章
                if (isConstant) {
                    const constantBadge = $('<span></span>')
                        .addClass('st-chatu8-constant-badge')
                        .text('常开')
                        .css({
                            marginLeft: '6px',
                            padding: '2px 6px',
                            background: 'rgba(255, 193, 7, 0.2)',
                            border: '1px solid rgba(255, 193, 7, 0.4)',
                            borderRadius: '3px',
                            color: '#ffc107',
                            fontSize: '9px',
                            fontWeight: 'normal'
                        });
                    textSpan.append(constantBadge);
                }

                // 获取触发关键词
                const keys = Array.isArray(entry.key) ? entry.key : (entry.key ? [entry.key] : []);
                if (keys.length > 0) {
                    const keyDisplay = keys.slice(0, 3).join(', ') + (keys.length > 3 ? '...' : '');
                    const keyBadge = $('<span></span>')
                        .addClass('st-chatu8-key-badge')
                        .text('🔑 ' + keyDisplay)
                        .attr('title', keys.join(', '))
                        .css({
                            marginLeft: '6px',
                            padding: '2px 6px',
                            background: 'rgba(33, 150, 243, 0.15)',
                            border: '1px solid rgba(33, 150, 243, 0.3)',
                            borderRadius: '3px',
                            color: '#42a5f5',
                            fontSize: '9px',
                            fontWeight: 'normal',
                            maxWidth: '150px',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                            display: 'inline-block',
                            verticalAlign: 'middle'
                        });
                    textSpan.append(keyBadge);
                }

                // 眼睛图标：查看内容
                const eyeIcon = $('<i></i>')
                    .addClass('fa fa-eye st-chatu8-entry-view-icon')
                    .attr('title', '查看内容')
                    .on('click', function (e) {
                        e.stopPropagation();
                        showEntryContentModal(displayName, entry.content || '', entry.key || [], isConstant);
                    });

                // 创建复选框点击区域
                const checkboxSpan = $('<span></span>').addClass('st-chatu8-entry-checkbox');

                entryItem.append(checkboxSpan).append(textSpan).append(eyeIcon);

                // 根据状态添加样式
                const entryState = currentWorldSelections[entryKey];
                if (entryState === 'force') {
                    entryItem.addClass('selected force-enabled');
                } else if (entryState === true) {
                    entryItem.addClass('selected');
                }

                fragment.appendChild(entryItem[0]);
            });
        } else {
            entryListContainer.html('<div style="padding:10px; color:#888;">这个世界书是空的。</div>');
        }

        entryListContainer.append(fragment);
    }

    // ── 事件：点击左侧世界书 ──
    function handleWorldClick(event) {
        const target = $(event.target).closest('.st-chatu8-list-item');
        if (!target.length) return;

        const worldName = target.data('worldName');
        if (!worldName) return;

        const checkboxArea = $(event.target).closest('.st-chatu8-world-checkbox');

        if (checkboxArea.length) {
            // 点击勾选框：切换世界书在资料库中的启用状态
            const config = getKBConfig();
            if (!config.worldBookSelections) config.worldBookSelections = {};
            config.worldBookSelections[worldName] = !config.worldBookSelections[worldName];
            saveKBConfig();
            renderWorldList();
        } else {
            // 点击文本：切换 active 显示条目
            if (worldName !== kbActiveWorld) {
                kbActiveWorld = worldName;
                renderWorldList();
                renderEntryList();
            }
        }
    }

    // 长按计时器
    let longPressTimer = null;
    let isLongPress = false;
    const LONG_PRESS_DURATION = 500;

    function handleEntryMouseDown(event) {
        const target = $(event.target).closest('.st-chatu8-list-item');
        if (!target.length || !kbActiveWorld) return;
        if ($(event.target).closest('.st-chatu8-entry-view-icon').length) return;

        // 只有点击复选框区域才启动长按
        if (!$(event.target).closest('.st-chatu8-entry-checkbox').length) return;

        isLongPress = false;
        longPressTimer = setTimeout(() => {
            isLongPress = true;
            handleForceToggle(target);
        }, LONG_PRESS_DURATION);
    }

    function handleEntryMouseUp() {
        if (longPressTimer) {
            clearTimeout(longPressTimer);
            longPressTimer = null;
        }
    }

    // ── 事件：点击右侧条目 ──
    function handleEntryClick(event) {
        const target = $(event.target).closest('.st-chatu8-list-item');
        if (!target.length || !kbActiveWorld) return;
        if ($(event.target).closest('.st-chatu8-entry-view-icon').length) return;

        // 只有点击复选框区域才切换状态
        if (!$(event.target).closest('.st-chatu8-entry-checkbox').length) return;

        const entryKey = target.data('entryKey');
        if (entryKey === undefined || entryKey === null) return;

        // 右键：切换强制启用
        if (event.type === 'contextmenu') {
            event.preventDefault();
            handleForceToggle(target);
            return;
        }

        if (isLongPress) {
            isLongPress = false;
            return;
        }

        const config = getKBConfig();
        if (!config.worldEntrySelections[kbActiveWorld]) {
            config.worldEntrySelections[kbActiveWorld] = {};
        }

        const currentState = config.worldEntrySelections[kbActiveWorld][entryKey];

        if (currentState === true || currentState === 'force' || currentState === undefined) {
            config.worldEntrySelections[kbActiveWorld][entryKey] = false;
        } else {
            config.worldEntrySelections[kbActiveWorld][entryKey] = true;
        }

        saveKBConfig();
        renderEntryList();
        renderWorldList();
    }

    function handleForceToggle(target) {
        const entryKey = target.data('entryKey');
        if (entryKey === undefined || entryKey === null) return;

        const config = getKBConfig();
        if (!config.worldEntrySelections[kbActiveWorld]) {
            config.worldEntrySelections[kbActiveWorld] = {};
        }

        const currentState = config.worldEntrySelections[kbActiveWorld][entryKey];
        if (currentState === 'force') {
            config.worldEntrySelections[kbActiveWorld][entryKey] = true;
            toastr.info('已取消强制启用');
        } else {
            config.worldEntrySelections[kbActiveWorld][entryKey] = 'force';
            toastr.success('已设为强制启用');
        }

        saveKBConfig();
        renderEntryList();
        renderWorldList();
    }

    // ── 全选 / 取消全选 ──
    async function handleSelectAll() {
        if (!kbActiveWorld) return;
        const entries = await getWorldEntries(kbActiveWorld);
        if (!entries) return;

        const config = getKBConfig();
        if (!config.worldEntrySelections[kbActiveWorld]) {
            config.worldEntrySelections[kbActiveWorld] = {};
        }

        const searchTerm = entrySearchInput.val().toLowerCase();
        const entriesArray = Array.isArray(entries) ? entries : Object.values(entries);
        const filteredEntries = entriesArray.filter(entry => {
            const comment = (entry.comment || '').toLowerCase();
            const keys = (Array.isArray(entry.key) ? entry.key.join(' ') : String(entry.key || '')).toLowerCase();
            return comment.includes(searchTerm) || keys.includes(searchTerm);
        });

        filteredEntries.forEach(entry => {
            const entryKey = entry.uid;
            if (entryKey !== undefined && entryKey !== null) {
                config.worldEntrySelections[kbActiveWorld][entryKey] = true;
            }
        });

        saveKBConfig();
        renderWorldList();
        renderEntryList();
    }

    async function handleDeselectAll() {
        if (!kbActiveWorld) return;
        const entries = await getWorldEntries(kbActiveWorld);
        if (!entries) return;

        const config = getKBConfig();
        if (!config.worldEntrySelections[kbActiveWorld]) {
            config.worldEntrySelections[kbActiveWorld] = {};
        }

        const searchTerm = entrySearchInput.val().toLowerCase();
        const entriesArray = Array.isArray(entries) ? entries : Object.values(entries);
        const filteredEntries = entriesArray.filter(entry => {
            const comment = (entry.comment || '').toLowerCase();
            const keys = (Array.isArray(entry.key) ? entry.key.join(' ') : String(entry.key || '')).toLowerCase();
            return comment.includes(searchTerm) || keys.includes(searchTerm);
        });

        filteredEntries.forEach(entry => {
            const entryKey = entry.uid;
            if (entryKey !== undefined && entryKey !== null) {
                config.worldEntrySelections[kbActiveWorld][entryKey] = false;
            }
        });

        saveKBConfig();
        renderWorldList();
        renderEntryList();
    }

    // ── 刷新世界书按钮 ──
    async function handleRefreshWorlds() {
        const refreshButton = settingsModal.find('#ch-kb2-refresh-worlds');
        const originalHtml = refreshButton.html();
        refreshButton.prop('disabled', true).html('<i class="fa fa-spinner fa-spin"></i>');
        try {
            await loadAndRenderWorlds();
            toastr.success('世界书已刷新');
        } catch (error) {
            console.error('[KnowledgeBase] 刷新世界书失败:', error);
            toastr.error('刷新失败: ' + error.message);
        } finally {
            refreshButton.prop('disabled', false).html(originalHtml);
        }
    }

    // ── 条目内容预览弹窗 ──
    function showEntryContentModal(title, content, keys = [], isConstant = false) {
        document.querySelector('.st-chatu8-entry-content-backdrop')?.remove();
        const backdrop = document.createElement('div');
        backdrop.className = 'st-chatu8-workflow-viz-backdrop st-chatu8-entry-content-backdrop';

        // 构建关键词显示
        let keywordsHtml = '';
        if (keys && keys.length > 0) {
            const keysList = Array.isArray(keys) ? keys : [keys];
            const keysDisplay = keysList.map(k => `<span style="
                display: inline-block;
                margin: 2px 4px;
                padding: 3px 8px;
                background: rgba(33, 150, 243, 0.2);
                border: 1px solid rgba(33, 150, 243, 0.4);
                border-radius: 4px;
                color: #42a5f5;
                font-size: 12px;
            ">${$('<div>').text(k).html()}</span>`).join('');

            keywordsHtml = `
                <div style="
                    padding: 10px 15px;
                    background: rgba(33, 150, 243, 0.05);
                    border-bottom: 1px solid rgba(255, 255, 255, 0.1);
                ">
                    <div style="color: #888; font-size: 11px; margin-bottom: 5px;">🔑 触发关键词：</div>
                    <div style="display: flex; flex-wrap: wrap; gap: 4px;">
                        ${keysDisplay}
                    </div>
                </div>
            `;
        }

        // 构建常开标记
        let constantBadge = '';
        if (isConstant) {
            constantBadge = `<span style="
                margin-left: 10px;
                padding: 3px 8px;
                background: rgba(255, 193, 7, 0.2);
                border: 1px solid rgba(255, 193, 7, 0.4);
                border-radius: 4px;
                color: #ffc107;
                font-size: 12px;
            ">常开</span>`;
        }

        backdrop.innerHTML = `
            <div class="st-chatu8-workflow-viz-dialog st-chatu8-entry-content-dialog">
                <div class="st-chatu8-workflow-viz-header">
                    <h3>${$('<div>').text(title).html()}${constantBadge}</h3>
                    <span class="st-chatu8-workflow-viz-close">&times;</span>
                </div>
                ${keywordsHtml}
                <div class="st-chatu8-entry-content-body">
                    <pre class="st-chatu8-entry-content-text">${$('<div>').text(content || '(无内容)').html()}</pre>
                </div>
            </div>
        `;
        document.body.appendChild(backdrop);

        backdrop.querySelector('.st-chatu8-workflow-viz-close').onclick = () => backdrop.remove();
        const escHandler = (e) => {
            if (e.key === 'Escape') { backdrop.remove(); document.removeEventListener('keydown', escHandler); }
        };
        document.addEventListener('keydown', escHandler);
    }

    // ── 绑定所有事件 ──
    worldListContainer.off('click').on('click', handleWorldClick);
    entryListContainer
        .off('click contextmenu mousedown mouseup mouseleave touchstart touchend touchcancel')
        .on('click', handleEntryClick)
        .on('contextmenu', handleEntryClick)
        .on('mousedown touchstart', handleEntryMouseDown)
        .on('mouseup mouseleave touchend touchcancel', handleEntryMouseUp);

    worldSearchInput.off('input').on('input', renderWorldList);
    entrySearchInput.off('input').on('input', renderEntryList);

    settingsModal.find('#ch-kb2-select-all').off('click').on('click', handleSelectAll);
    settingsModal.find('#ch-kb2-deselect-all').off('click').on('click', handleDeselectAll);
    settingsModal.find('#ch-kb2-refresh-worlds').off('click').on('click', handleRefreshWorlds);
    settingsModal.find('#ch-kb2-test-trigger').off('click').on('click', handleTestTrigger);

    // 初始加载
    loadAndRenderWorlds();
}

// ========== 测试触发功能 ==========

/**
 * 测试资料库触发功能
 */
async function handleTestTrigger() {
    // 创建输入弹窗
    const backdrop = document.createElement('div');
    backdrop.className = 'st-chatu8-workflow-viz-backdrop';
    backdrop.style.zIndex = '10002';

    backdrop.innerHTML = `
        <div class="st-chatu8-workflow-viz-dialog" style="width: 90%; max-width: 1000px; max-height: 85vh;">
            <div class="st-chatu8-workflow-viz-header">
                <h3>🧪 测试资料库触发</h3>
                <span class="st-chatu8-workflow-viz-close">&times;</span>
            </div>
            <div style="padding: 20px; display: flex; flex-direction: column; gap: 15px; overflow-y: auto; max-height: calc(85vh - 60px);">
                <div>
                    <label style="display: block; margin-bottom: 8px; color: #ddd; font-weight: bold;">
                        输入触发文本（可选，留空则使用默认测试文本）：
                    </label>
                    <textarea id="test-kb-trigger-input" style="
                        width: 100%;
                        min-height: 100px;
                        padding: 10px;
                        background: rgba(255,255,255,0.05);
                        border: 1px solid rgba(255,255,255,0.2);
                        border-radius: 6px;
                        color: #ddd;
                        font-family: monospace;
                        resize: vertical;
                    " placeholder="例如：角色名、地点、物品等关键词..."></textarea>
                </div>
                <div style="display: flex; gap: 10px;">
                    <button id="test-kb-trigger-run" style="
                        flex: 1;
                        padding: 10px 20px;
                        background: rgba(76, 175, 80, 0.3);
                        border: 1px solid rgba(76, 175, 80, 0.5);
                        border-radius: 6px;
                        color: #4CAF50;
                        cursor: pointer;
                        font-size: 14px;
                        font-weight: bold;
                    ">
                        <i class="fa fa-play"></i> 开始测试
                    </button>
                </div>
                <div id="test-kb-trigger-result" style="display: none;">
                    <!-- 测试结果将显示在这里 -->
                </div>
            </div>
        </div>
    `;

    document.body.appendChild(backdrop);

    // 关闭按钮
    const closeBtn = backdrop.querySelector('.st-chatu8-workflow-viz-close');
    closeBtn.onclick = () => backdrop.remove();

    // ESC键关闭
    const escHandler = (e) => {
        if (e.key === 'Escape') {
            backdrop.remove();
            document.removeEventListener('keydown', escHandler);
        }
    };
    document.addEventListener('keydown', escHandler);

    // 运行测试按钮
    const runBtn = backdrop.querySelector('#test-kb-trigger-run');
    const inputArea = backdrop.querySelector('#test-kb-trigger-input');
    const resultDiv = backdrop.querySelector('#test-kb-trigger-result');

    runBtn.onclick = async () => {
        const triggerText = inputArea.value.trim() || '你好';

        runBtn.disabled = true;
        runBtn.innerHTML = '<i class="fa fa-spinner fa-spin"></i> 测试中...';

        try {
            // 调用资料库测试触发函数
            const { testKnowledgeBaseTrigger } = await import('../knowledgeBaseService.js');
            const knowledgeBaseData = await testKnowledgeBaseTrigger(triggerText);

            // 显示结果
            displayKBTestResult(resultDiv, knowledgeBaseData, triggerText);

        } catch (error) {
            console.error('[KnowledgeBase] 测试触发失败:', error);
            resultDiv.innerHTML = `
                <div style="padding: 15px; background: rgba(244, 67, 54, 0.1); border: 1px solid rgba(244, 67, 54, 0.3); border-radius: 6px; color: #f44336;">
                    <i class="fa fa-times-circle"></i> 测试失败: ${error.message || '未知错误'}
                </div>
            `;
            resultDiv.style.display = 'block';
        } finally {
            runBtn.disabled = false;
            runBtn.innerHTML = '<i class="fa fa-play"></i> 开始测试';
        }
    };
}

/**
 * 显示资料库测试结果
 */
function displayKBTestResult(container, knowledgeBaseData, triggerText) {
    container.style.display = 'block';

    if (!knowledgeBaseData || knowledgeBaseData.length === 0) {
        container.innerHTML = `
            <div style="padding: 15px; background: rgba(255, 255, 255, 0.05); border: 1px solid rgba(255, 255, 255, 0.1); border-radius: 6px;">
                <div style="color: #888; text-align: center;">
                    <i class="fa fa-info-circle"></i> 没有触发任何资料库条目
                </div>
            </div>
        `;
        return;
    }

    // 统计总数
    const totalEntries = knowledgeBaseData.reduce((sum, wb) => sum + wb.entries.length, 0);

    let html = `
        <div style="margin-bottom: 15px; padding: 12px; background: rgba(76, 175, 80, 0.1); border: 1px solid rgba(76, 175, 80, 0.3); border-radius: 6px;">
            <div style="color: #4CAF50; font-weight: bold; margin-bottom: 8px;">
                <i class="fa fa-check-circle"></i> 测试完成
            </div>
            <div style="color: #ddd; font-size: 13px;">
                触发了 <strong>${knowledgeBaseData.length}</strong> 个世界书，共 <strong>${totalEntries}</strong> 个条目
            </div>
            <div style="color: #888; font-size: 12px; margin-top: 5px;">
                触发文本: ${$('<div>').text(triggerText).html()}
            </div>
        </div>
    `;

    // 显示每个世界书的触发结果
    knowledgeBaseData.forEach((worldBook, worldIndex) => {
        const worldId = `test-kb-world-${worldIndex}`;
        const worldName = worldBook.worldName || '未命名世界书';
        const entries = worldBook.entries || [];

        let entriesHtml = '';
        entries.forEach((entry, entryIndex) => {
            const entryId = `${worldId}-entry-${entryIndex}`;
            const entryName = entry.comment || '未命名条目';
            const entryContent = entry.content || '';
            const previewLength = 150;
            const entryPreview = entryContent.substring(0, previewLength);
            const hasMore = entryContent.length > previewLength;

            // 判断是否为常开条目
            const isConstant = entry.constant === true;

            // 获取触发关键词
            const keys = Array.isArray(entry.key) ? entry.key : (entry.key ? [entry.key] : []);
            const keyDisplay = keys.length > 0 ? keys.slice(0, 5).join(', ') + (keys.length > 5 ? '...' : '') : '';

            // ★ HTML 转义：防止条目内容中的 HTML 标签破坏结构
            const escapeHtml = (text) => $('<div>').text(text).html();
            const escapedContent = escapeHtml(entryContent);
            const escapedPreview = escapeHtml(entryPreview);
            const escapedName = escapeHtml(entryName);
            const escapedKeyDisplay = escapeHtml(keyDisplay);
            const escapedKeysTitle = escapeHtml(keys.join(', '));

            // 根据是否常开选择不同的颜色
            const borderColor = isConstant ? 'rgba(255, 193, 7, 0.4)' : 'rgba(156, 39, 176, 0.3)';
            const bgColor = isConstant ? 'rgba(255, 193, 7, 0.08)' : 'rgba(156, 39, 176, 0.05)';
            const titleColor = isConstant ? '#ffc107' : '#ba68c8';
            const badgeBg = isConstant ? 'rgba(255, 193, 7, 0.2)' : 'rgba(156, 39, 176, 0.2)';
            const badgeColor = isConstant ? '#ffc107' : '#ba68c8';

            entriesHtml += `
                <div class="test-kb-entry-item" style="
                    margin-bottom: 8px;
                    padding: 8px 10px;
                    background: ${bgColor};
                    border-left: 2px solid ${borderColor};
                    border-radius: 4px;
                ">
                    <div style="
                        font-weight: bold;
                        color: ${titleColor};
                        font-size: 12px;
                        margin-bottom: 6px;
                        display: flex;
                        align-items: center;
                        justify-content: space-between;
                        gap: 6px;
                    ">
                        <div style="display: flex; align-items: center; gap: 6px; flex: 1; flex-wrap: wrap;">
                            <i class="fa-solid fa-bookmark" style="font-size: 10px;"></i>
                            <span>${escapedName}</span>
                            ${isConstant ? `
                            <span style="
                                padding: 2px 6px;
                                background: ${badgeBg};
                                border: 1px solid ${borderColor};
                                border-radius: 3px;
                                color: ${badgeColor};
                                font-size: 9px;
                                font-weight: normal;
                            ">常开</span>
                            ` : ''}
                            ${keyDisplay ? `
                            <span style="
                                padding: 2px 6px;
                                background: rgba(33, 150, 243, 0.15);
                                border: 1px solid rgba(33, 150, 243, 0.3);
                                border-radius: 3px;
                                color: #42a5f5;
                                font-size: 9px;
                                font-weight: normal;
                                max-width: 300px;
                                overflow: hidden;
                                text-overflow: ellipsis;
                                white-space: nowrap;
                            " title="${escapedKeysTitle}">🔑 ${escapedKeyDisplay}</span>
                            ` : ''}
                        </div>
                        <div style="display: flex; align-items: center; gap: 4px;">
                            <button class="test-kb-entry-disable-btn" data-world-name="${worldName}" data-entry-uid="${entry.uid || ''}" style="
                                padding: 2px 8px;
                                background: rgba(255, 152, 0, 0.15);
                                border: 1px solid rgba(255, 152, 0, 0.3);
                                border-radius: 3px;
                                color: #ff9800;
                                cursor: pointer;
                                font-size: 10px;
                                transition: all 0.2s;
                            " title="禁用此条目">
                                <i class="fa-solid fa-ban"></i> 禁用
                            </button>
                            ${hasMore ? `
                            <button class="test-kb-entry-toggle-top" data-entry-id="${entryId}" style="
                                padding: 2px 8px;
                                background: rgba(156, 39, 176, 0.15);
                                border: 1px solid rgba(156, 39, 176, 0.3);
                                border-radius: 3px;
                                color: #ba68c8;
                                cursor: pointer;
                                font-size: 10px;
                                transition: all 0.2s;
                                display: none;
                            ">
                                <i class="fa-solid fa-chevron-up"></i> 收起
                            </button>
                            ` : ''}
                        </div>
                    </div>
                    <div class="test-kb-entry-preview" style="
                        white-space: pre-wrap;
                        line-height: 1.5;
                        font-size: 13px;
                        color: #ddd;
                        ${hasMore ? 'cursor: pointer;' : ''}
                    " data-entry-id="${entryId}">
                        ${hasMore ? escapedPreview + '...' : escapedContent}
                    </div>
                    <div class="test-kb-entry-full" id="${entryId}-full" style="
                        white-space: pre-wrap;
                        line-height: 1.5;
                        font-size: 13px;
                        color: #ddd;
                        display: none;
                    ">
                        ${escapedContent}
                    </div>
                    ${hasMore ? `
                    <button class="test-kb-entry-toggle" data-entry-id="${entryId}" style="
                        margin-top: 6px;
                        padding: 3px 10px;
                        background: rgba(156, 39, 176, 0.15);
                        border: 1px solid rgba(156, 39, 176, 0.3);
                        border-radius: 3px;
                        color: #ba68c8;
                        cursor: pointer;
                        font-size: 11px;
                        transition: all 0.2s;
                    ">
                        <i class="fa-solid fa-chevron-down"></i> 展开
                    </button>
                    ` : ''}
                </div>
            `;
        });

        html += `
            <div class="test-kb-world-item" style="
                margin-bottom: 12px;
                border: 1px solid rgba(156, 39, 176, 0.2);
                border-radius: 6px;
                overflow: hidden;
                background: rgba(156, 39, 176, 0.03);
            ">
                <div class="test-kb-world-header" data-world-id="${worldId}" style="
                    padding: 10px 12px;
                    background: rgba(156, 39, 176, 0.1);
                    cursor: pointer;
                    display: flex;
                    align-items: center;
                    justify-content: space-between;
                    user-select: none;
                    transition: background 0.2s;
                ">
                    <div style="display: flex; align-items: center; gap: 8px;">
                        <i class="fa-solid fa-chevron-right test-kb-world-icon" style="
                            color: #ba68c8;
                            font-size: 12px;
                            transition: transform 0.2s;
                        "></i>
                        <span style="font-weight: bold; color: #ba68c8; font-size: 13px;">
                            📚 ${worldName}
                        </span>
                    </div>
                    <span style="font-size: 11px; color: #888;">
                        ${entries.length} 个条目
                    </span>
                </div>
                <div class="test-kb-world-content" id="${worldId}-content" style="
                    padding: 10px;
                    display: none;
                ">
                    ${entriesHtml}
                </div>
            </div>
        `;
    });

    container.innerHTML = html;

    // 绑定展开/收起事件
    $(container).off('click').on('click', '.test-kb-world-header', function () {
        const worldId = $(this).data('world-id');
        const $content = $(`#${worldId}-content`);
        const $icon = $(this).find('.test-kb-world-icon');

        if ($content.is(':visible')) {
            $content.slideUp(200);
            $icon.css('transform', 'rotate(0deg)');
        } else {
            $content.slideDown(200);
            $icon.css('transform', 'rotate(90deg)');
        }
    });

    // 底部展开/收起按钮
    $(container).on('click', '.test-kb-entry-toggle', function (e) {
        e.stopPropagation();
        const entryId = $(this).data('entry-id');
        const $item = $(this).closest('.test-kb-entry-item');
        const $preview = $item.find('.test-kb-entry-preview');
        const $full = $(`#${entryId}-full`);
        const $topBtn = $item.find('.test-kb-entry-toggle-top');

        if ($full.is(':visible')) {
            $full.hide();
            $preview.show();
            $(this).html('<i class="fa-solid fa-chevron-down"></i> 展开');
            $topBtn.hide();
        } else {
            $preview.hide();
            $full.show();
            $(this).html('<i class="fa-solid fa-chevron-up"></i> 收起');
            $topBtn.show();
        }
    });

    // 顶部收起按钮
    $(container).on('click', '.test-kb-entry-toggle-top', function (e) {
        e.stopPropagation();
        const entryId = $(this).data('entry-id');
        const $item = $(this).closest('.test-kb-entry-item');
        const $preview = $item.find('.test-kb-entry-preview');
        const $full = $(`#${entryId}-full`);
        const $bottomBtn = $item.find('.test-kb-entry-toggle');

        $full.hide();
        $preview.show();
        $bottomBtn.html('<i class="fa-solid fa-chevron-down"></i> 展开');
        $(this).hide();
    });

    // 点击预览文本展开
    $(container).on('click', '.test-kb-entry-preview', function (e) {
        const entryId = $(this).data('entry-id');
        if (!entryId) return;

        const $toggle = $(this).siblings('.test-kb-entry-toggle');
        if ($toggle.length > 0) {
            $toggle.click();
        }
    });

    // 禁用条目按钮
    $(container).on('click', '.test-kb-entry-disable-btn', async function (e) {
        e.stopPropagation();
        const worldName = $(this).data('world-name');
        const entryUid = $(this).data('entry-uid');

        if (!worldName || entryUid === undefined || entryUid === null) {
            console.warn('[KnowledgeBase] 切换条目状态失败：缺少必要参数', { worldName, entryUid });
            return;
        }

        try {
            const config = getKBConfig();
            if (!config.worldEntrySelections[worldName]) {
                config.worldEntrySelections[worldName] = {};
            }

            // 获取当前状态
            const currentState = config.worldEntrySelections[worldName][entryUid];

            // 切换状态：如果当前是禁用(false)，则启用(true)；否则禁用(false)
            const newState = (currentState === false) ? true : false;
            config.worldEntrySelections[worldName][entryUid] = newState;
            saveKBConfig();

            console.log('[KnowledgeBase] 已切换条目状态:', {
                worldName,
                entryUid,
                原状态: currentState,
                新状态: newState
            });

            // 更新按钮状态
            const $btn = $(this);
            if (newState === false) {
                // 禁用状态
                $btn.html('<i class="fa-solid fa-check-circle"></i> 已禁用');
                $btn.css({
                    'background': 'rgba(158, 158, 158, 0.15)',
                    'border-color': 'rgba(158, 158, 158, 0.3)',
                    'color': '#9e9e9e'
                });
                $btn.attr('title', '点击启用此条目');
                toastr.info(`已禁用条目（世界书: ${worldName}）`);
            } else {
                // 启用状态
                $btn.html('<i class="fa-solid fa-ban"></i> 禁用');
                $btn.css({
                    'background': 'rgba(255, 152, 0, 0.15)',
                    'border-color': 'rgba(255, 152, 0, 0.3)',
                    'color': '#ff9800'
                });
                $btn.attr('title', '禁用此条目');
                toastr.success(`已启用条目（世界书: ${worldName}）`);
            }
        } catch (err) {
            console.error('[KnowledgeBase] 切换条目状态失败:', err);
            toastr.error('操作失败: ' + (err.message || '未知错误'));
        }
    });
}
