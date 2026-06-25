// @ts-nocheck
import { getrWorlds, getWorldEntries, getcharWorld } from '../promptReq.js';
import { eventSource, event_types, saveSettingsDebounced, saveChatConditional } from '../../../../../../script.js';
import { extension_settings } from '../../../../../extensions.js';
import { extensionName } from '../config.js';
import { getContext } from "../../../../../st-context.js";

let worldList = [];
let worldEntrySelections = {}; // 结构: { worldName: { entryKey: boolean } }
let worldBookSelections = {}; // 结构: { worldName: boolean } - 左侧世界书的启用状态
let activeWorld = null; // 当前左侧高亮的世界书
let currentCharWorldName = null; // 当前角色的世界书名称

/**
 * 获取插件配置中的世界书设置
 * @returns {Object} 世界书配置对象
 */
function getWorldBookConfig() {
    const settings = extension_settings[extensionName];
    if (!settings.worldBookConfig) {
        settings.worldBookConfig = {
            worldBookSelections: {},  // 世界书开启状态（不包含当前角色世界书）
            worldEntrySelections: {}  // 条目开启信息（所有世界书）
        };
    }
    return settings.worldBookConfig;
}

/**
 * 保存世界书配置到插件设置
 * 当前角色世界书只保存条目信息，不保存世界书开启状态
 */
function saveWorldBookConfig() {
    const config = getWorldBookConfig();

    // 保存条目开启信息（所有世界书都保存）
    config.worldEntrySelections = { ...worldEntrySelections };

    // 保存世界书开启状态
    // 当前角色世界书不保存开启状态（避免跨角色卡影响）
    const newWorldBookSelections = {};
    for (const worldName in worldBookSelections) {
        if (worldName !== currentCharWorldName) {
            // 非当前角色世界书：保存开启状态
            newWorldBookSelections[worldName] = worldBookSelections[worldName];
        }
        // 当前角色世界书：不保存开启状态（跳过）
    }
    config.worldBookSelections = newWorldBookSelections;

    saveSettingsDebounced();
}

/**
 * 切换世界书条目的启用状态（供外部调用）
 * @param {string} worldName - 世界书名称
 * @param {string} entryUid - 条目 UID
 * @param {boolean|'force'|null} newState - 新状态：true(启用), false(禁用), 'force'(强制启用), null(切换)
 * @returns {boolean|'force'} 返回新的状态
 */
export function toggleWorldEntryState(worldName, entryUid, newState = null) {
    // 初始化该世界书的数据结构
    if (!worldEntrySelections[worldName]) {
        worldEntrySelections[worldName] = {};
    }

    const currentState = worldEntrySelections[worldName][entryUid];

    // 如果指定了新状态，直接设置
    if (newState !== null) {
        worldEntrySelections[worldName][entryUid] = newState;
    } else {
        // 否则切换状态：启用 <-> 禁用
        if (currentState === true || currentState === 'force' || currentState === undefined) {
            worldEntrySelections[worldName][entryUid] = false;
        } else {
            worldEntrySelections[worldName][entryUid] = true;
        }
    }

    // 保存配置
    saveWorldBookConfig();

    return worldEntrySelections[worldName][entryUid];
}

/**
 * 获取世界书条目的当前状态（供外部调用）
 * @param {string} worldName - 世界书名称
 * @param {string} entryUid - 条目 UID
 * @returns {boolean|'force'|undefined} 条目状态
 */
export function getWorldEntryState(worldName, entryUid) {
    if (!worldEntrySelections[worldName]) {
        return undefined;
    }
    return worldEntrySelections[worldName][entryUid];
}

/**
 * 检测条目是否为新条目
 * @param {string} worldName - 世界书名称
 * @param {string} entryKey - 条目唯一标识
 * @returns {boolean} 如果条目在 worldEntrySelections 中为 undefined，返回 true
 */
function isNewEntry(worldName, entryKey) {
    const worldSelections = worldEntrySelections[worldName];
    if (!worldSelections) return true;
    return worldSelections[entryKey] === undefined;
}

export function initSendData(settingsModal) {
    const worldListContainer = settingsModal.find('#ch-send-data-world-list');
    const entryListContainer = settingsModal.find('#ch-send-data-entry-list');
    const worldSearchInput = settingsModal.find('#ch-send-data-world-search');
    const entrySearchInput = settingsModal.find('#ch-send-data-entry-search');

    async function loadAndRenderWorlds() {
        worldList = await getrWorlds();
        currentCharWorldName = await getcharWorld();
        const config = getWorldBookConfig();

        console.log('[send_data] 当前角色世界书:', currentCharWorldName);
        console.log('[send_data] 插件配置:', config);

        // 加载条目开启信息
        worldEntrySelections = { ...(config.worldEntrySelections || {}) };

        // 加载世界书开启状态（不包含当前角色世界书）
        worldBookSelections = { ...(config.worldBookSelections || {}) };

        // 处理当前角色世界书
        if (currentCharWorldName) {
            const hasCharWorldEntrySettings =
                worldEntrySelections[currentCharWorldName] &&
                Object.keys(worldEntrySelections[currentCharWorldName]).length > 0;

            if (!hasCharWorldEntrySettings) {
                // 插件配置中没有当前角色世界书的条目记录
                // 默认开启世界书但条目全部禁用
                console.log('[send_data] 当前角色世界书无条目记录，初始化默认设置');
                worldBookSelections[currentCharWorldName] = true;

                const charWorldEntries = await getWorldEntries(currentCharWorldName);
                if (charWorldEntries) {
                    worldEntrySelections[currentCharWorldName] = {};
                    const entriesArray = Array.isArray(charWorldEntries)
                        ? charWorldEntries
                        : Object.values(charWorldEntries);
                    entriesArray.forEach(entry => {
                        const entryKey = entry.uid;
                        if (entryKey !== undefined && entryKey !== null) {
                            worldEntrySelections[currentCharWorldName][entryKey] = false;
                        }
                    });
                }

                // 保存初始化的条目设置
                saveWorldBookConfig();
            } else {
                // 有条目记录，默认开启该世界书
                console.log('[send_data] 当前角色世界书有条目记录，默认开启');
                worldBookSelections[currentCharWorldName] = true;
            }
        }

        // 如果当前没有选中的世界书，且列表不为空，默认选第一个
        if (!activeWorld && worldList.length > 0) {
            activeWorld = worldList[0];
        }

        renderWorldList();
        renderEntryList(); // 初始加载右侧
    }

    function renderWorldList() {
        worldListContainer.empty();
        const fragment = document.createDocumentFragment();
        const searchTerm = worldSearchInput.val().toLowerCase();

        worldList
            .filter(worldName => worldName.toLowerCase().includes(searchTerm))
            .forEach(worldName => {
                const worldItem = $('<div></div>')
                    .addClass('st-chatu8-list-item')
                    .data('worldName', worldName);

                // 创建勾选框容器（使用与右侧相同的样式）
                const checkboxWrapper = $('<span></span>')
                    .addClass('st-chatu8-world-checkbox')
                    .css({
                        position: 'relative',
                        marginRight: '10px',
                        display: 'inline-block',
                        width: '16px',
                        height: '16px'
                    });

                // 创建文本内容
                const textSpan = $('<span></span>').text(worldName);

                // 如果是当前角色世界书，添加标记
                if (worldName === currentCharWorldName) {
                    textSpan.append($('<span></span>')
                        .text(' (角色)')
                        .css({ color: '#4CAF50', fontSize: '0.85em' }));
                }

                // 如果世界书被启用，添加 selected 类
                if (worldBookSelections[worldName]) {
                    worldItem.addClass('world-selected');
                }

                // 状态1: Active (当前正在右侧查看)
                if (worldName === activeWorld) {
                    worldItem.addClass('active');
                }

                worldItem.append(checkboxWrapper).append(textSpan);
                fragment.appendChild(worldItem[0]);
            });
        worldListContainer.append(fragment);
    }

    async function renderEntryList() {
        entryListContainer.empty();
        if (!activeWorld) {
            entryListContainer.html('<div style="padding:10px; color:#888;">请先在左侧选择一个世界书。</div>');
            // 隐藏新条目按钮
            settingsModal.find('#ch-send-data-new-entry-buttons').hide();
            return;
        }

        // 显示加载中状态（可选）
        // entryListContainer.text('加载中...'); 

        const searchTerm = entrySearchInput.val().toLowerCase();
        const entries = await getWorldEntries(activeWorld);

        entryListContainer.empty(); // 清除加载文字
        const fragment = document.createDocumentFragment();

        let hasNewEntries = false; // 标记是否有新条目

        if (entries) {
            // 获取当前世界书的选中状态
            const currentWorldSelections = worldEntrySelections[activeWorld] || {};

            // 注意：getWorldEntries 返回的通常是对象或数组，这里假设是对象
            // 如果 entries 是数组，请直接用 entries.filter...
            const entriesArray = Array.isArray(entries) ? entries : Object.values(entries);

            const filteredEntries = entriesArray.filter(entry => {
                // 搜索逻辑：同时匹配 key 和 comment
                const key = entry.key || entry.uid || "";
                const comment = entry.comment || "";
                return String(key).toLowerCase().includes(searchTerm) ||
                    String(comment).toLowerCase().includes(searchTerm);
            });

            if (filteredEntries.length === 0) {
                entryListContainer.html('<div style="padding:10px; color:#888;">没有找到匹配的条目。</div>');
                // 隐藏新条目按钮
                settingsModal.find('#ch-send-data-new-entry-buttons').hide();
                return;
            }

            filteredEntries.forEach(entry => {
                const entryKey = entry.uid; // 使用 uid 作为唯一标识
                const displayName = entry.comment || `条目 ${entryKey}`; // 优先显示 comment
                const isConstant = entry.constant === true;

                const entryItem = $('<div></div>')
                    .addClass('st-chatu8-list-item')
                    .data('entryKey', entryKey)
                    .data('entryContent', entry.content || '');

                // 检查是否为新条目
                const isNew = isNewEntry(activeWorld, entryKey);
                if (isNew) {
                    entryItem.addClass('new-entry');
                    hasNewEntries = true; // 标记有新条目
                }

                // 如果是常开条目，添加特殊类
                if (isConstant) {
                    entryItem.addClass('constant-entry');
                }

                // 创建文本容器
                const textSpan = $('<span></span>')
                    .addClass('st-chatu8-entry-text')
                    .text(displayName);

                // 如果是新条目，添加"新"徽章
                if (isNew) {
                    const newBadge = $('<span></span>')
                        .addClass('st-chatu8-new-badge')
                        .text('新');
                    textSpan.append(newBadge);
                }

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

                // 创建眼睛图标
                const eyeIcon = $('<i></i>')
                    .addClass('fa fa-eye st-chatu8-entry-view-icon')
                    .attr('title', '查看内容')
                    .on('click', function (e) {
                        e.stopPropagation(); // 防止触发条目选中
                        showEntryContentModal(displayName, entry.content || '', entry.key || [], isConstant);
                    });

                // 创建复选框点击区域
                const checkboxSpan = $('<span></span>').addClass('st-chatu8-entry-checkbox');

                entryItem.append(checkboxSpan).append(textSpan).append(eyeIcon);

                // 根据状态添加对应的类
                const entryState = currentWorldSelections[entryKey];
                if (entryState === 'force') {
                    entryItem.addClass('selected force-enabled');
                } else if (entryState === true) {
                    entryItem.addClass('selected');
                }
                // 注意：移除了 entryState === undefined 的情况，因为新逻辑中 undefined 应该是禁用状态
                fragment.appendChild(entryItem[0]);
            });
        } else {
            entryListContainer.html('<div style="padding:10px; color:#888;">这个世界书是空的。</div>');
        }
        entryListContainer.append(fragment);

        // 根据是否有新条目显示/隐藏批量操作按钮
        const newEntryButtons = settingsModal.find('#ch-send-data-new-entry-buttons');
        if (hasNewEntries) {
            newEntryButtons.show();
        } else {
            newEntryButtons.hide();
        }
    }

    // --- 事件处理 ---

    function handleWorldClick(event) {
        const target = $(event.target).closest('.st-chatu8-list-item');
        if (!target.length) return;

        const worldName = target.data('worldName');
        if (!worldName) return;

        // 检查是否点击的是勾选框区域
        const checkboxArea = $(event.target).closest('.st-chatu8-world-checkbox');

        if (checkboxArea.length) {
            // 点击勾选框：切换世界书启用状态
            worldBookSelections[worldName] = !worldBookSelections[worldName];

            // 保存配置到插件设置
            saveWorldBookConfig();

            // 刷新左侧列表
            renderWorldList();
        } else {
            // 点击文本区域：切换选中的世界书
            if (worldName !== activeWorld) {
                activeWorld = worldName;
                renderWorldList(); // 刷新左侧高亮
                renderEntryList(); // 加载右侧内容
            }
        }
    }

    // 长按计时器和状态
    let longPressTimer = null;
    let isLongPress = false;
    const LONG_PRESS_DURATION = 500; // 长按阈值：500ms

    function handleEntryMouseDown(event) {
        const target = $(event.target).closest('.st-chatu8-list-item');
        if (!target.length || !activeWorld) return;

        // 排除眼睛图标点击
        if ($(event.target).closest('.st-chatu8-entry-view-icon').length) return;

        // 只有点击复选框区域才启动长按
        if (!$(event.target).closest('.st-chatu8-entry-checkbox').length) return;

        isLongPress = false;

        // 开始长按计时
        longPressTimer = setTimeout(() => {
            isLongPress = true;
            // 长按触发：切换强制启用状态
            handleForceToggle(target);
        }, LONG_PRESS_DURATION);
    }

    function handleEntryMouseUp(event) {
        // 清除长按计时器
        if (longPressTimer) {
            clearTimeout(longPressTimer);
            longPressTimer = null;
        }
    }

    function handleEntryClick(event) {
        const target = $(event.target).closest('.st-chatu8-list-item');
        if (!target.length || !activeWorld) return;

        // 排除眼睛图标点击
        if ($(event.target).closest('.st-chatu8-entry-view-icon').length) return;

        // 只有点击复选框区域才切换状态
        if (!$(event.target).closest('.st-chatu8-entry-checkbox').length) return;

        const entryKey = target.data('entryKey');
        if (entryKey === undefined || entryKey === null) return;

        // 右键点击：切换强制启用
        if (event.type === 'contextmenu') {
            event.preventDefault();
            handleForceToggle(target);
            return;
        }

        // 如果是长按触发的，不处理普通点击
        if (isLongPress) {
            isLongPress = false;
            return;
        }

        // 初始化该世界书的数据结构
        if (!worldEntrySelections[activeWorld]) {
            worldEntrySelections[activeWorld] = {};
        }

        const currentState = worldEntrySelections[activeWorld][entryKey];

        // 短按：在启用和禁用之间切换
        if (currentState === true || currentState === 'force' || currentState === undefined) {
            worldEntrySelections[activeWorld][entryKey] = false;
        } else {
            worldEntrySelections[activeWorld][entryKey] = true;
        }

        // 保存配置到插件设置
        saveWorldBookConfig();

        // 重新渲染条目列表以更新视觉状态
        renderEntryList();
        renderWorldList();
    }

    function handleForceToggle(target) {
        const entryKey = target.data('entryKey');
        if (entryKey === undefined || entryKey === null) return;

        // 初始化该世界书的数据结构
        if (!worldEntrySelections[activeWorld]) {
            worldEntrySelections[activeWorld] = {};
        }

        const currentState = worldEntrySelections[activeWorld][entryKey];

        // 切换强制启用状态
        if (currentState === 'force') {
            // 已经是强制启用，切换回普通启用
            worldEntrySelections[activeWorld][entryKey] = true;
            toastr.info('已取消强制启用');
        } else {
            // 切换到强制启用
            worldEntrySelections[activeWorld][entryKey] = 'force';
            toastr.success('已设为强制启用');
        }

        // 保存配置到插件设置
        saveWorldBookConfig();

        // 重新渲染条目列表以更新视觉状态
        renderEntryList();
        renderWorldList();
    }

    // 全选按钮处理 - 只对当前显示的条目生效
    async function handleSelectAll() {
        if (!activeWorld) return;

        const entries = await getWorldEntries(activeWorld);
        if (!entries) return;

        // 初始化该世界书的数据结构
        if (!worldEntrySelections[activeWorld]) {
            worldEntrySelections[activeWorld] = {};
        }

        // 获取当前搜索词,使用与 renderEntryList 相同的过滤逻辑
        const searchTerm = entrySearchInput.val().toLowerCase();
        const entriesArray = Array.isArray(entries) ? entries : Object.values(entries);

        // 过滤出当前显示的条目
        const filteredEntries = entriesArray.filter(entry => {
            const key = entry.key || entry.uid || "";
            const comment = entry.comment || "";
            return String(key).toLowerCase().includes(searchTerm) ||
                String(comment).toLowerCase().includes(searchTerm);
        });

        // 只对显示的条目执行全选
        filteredEntries.forEach(entry => {
            const entryKey = entry.uid;
            if (entryKey !== undefined && entryKey !== null) {
                worldEntrySelections[activeWorld][entryKey] = true;
            }
        });

        // 保存配置到插件设置
        saveWorldBookConfig();
        renderWorldList();
        renderEntryList();
    }

    // 取消全选按钮处理 - 只对当前显示的条目生效
    async function handleDeselectAll() {
        if (!activeWorld) return;

        const entries = await getWorldEntries(activeWorld);
        if (!entries) return;

        // 初始化该世界书的数据结构
        if (!worldEntrySelections[activeWorld]) {
            worldEntrySelections[activeWorld] = {};
        }

        // 获取当前搜索词,使用与 renderEntryList 相同的过滤逻辑
        const searchTerm = entrySearchInput.val().toLowerCase();
        const entriesArray = Array.isArray(entries) ? entries : Object.values(entries);

        // 过滤出当前显示的条目
        const filteredEntries = entriesArray.filter(entry => {
            const key = entry.key || entry.uid || "";
            const comment = entry.comment || "";
            return String(key).toLowerCase().includes(searchTerm) ||
                String(comment).toLowerCase().includes(searchTerm);
        });

        // 只对显示的条目执行取消全选
        filteredEntries.forEach(entry => {
            const entryKey = entry.uid;
            if (entryKey !== undefined && entryKey !== null) {
                worldEntrySelections[activeWorld][entryKey] = false;
            }
        });

        // 保存配置到插件设置
        saveWorldBookConfig();
        renderWorldList();
        renderEntryList();
    }

    // 批量启用新条目
    async function handleEnableNewEntries() {
        if (!activeWorld) return;

        try {
            const entries = await getWorldEntries(activeWorld);
            if (!entries) return;

            // 初始化该世界书的数据结构
            if (!worldEntrySelections[activeWorld]) {
                worldEntrySelections[activeWorld] = {};
            }

            const entriesArray = Array.isArray(entries) ? entries : Object.values(entries);
            let count = 0;

            // 遍历所有条目，启用新条目
            entriesArray.forEach(entry => {
                const entryKey = entry.uid;
                if (entryKey !== undefined && entryKey !== null && isNewEntry(activeWorld, entryKey)) {
                    worldEntrySelections[activeWorld][entryKey] = true;
                    count++;
                }
            });

            if (count > 0) {
                // 保存配置并刷新UI
                saveWorldBookConfig();
                renderWorldList();
                renderEntryList();
                toastr.success(`已启用 ${count} 个新条目`);
            } else {
                toastr.info('没有新条目');
            }
        } catch (error) {
            console.error('[send_data] 批量启用新条目失败:', error);
            toastr.error('操作失败: ' + error.message);
        }
    }

    // 批量禁用新条目
    async function handleDisableNewEntries() {
        if (!activeWorld) return;

        try {
            const entries = await getWorldEntries(activeWorld);
            if (!entries) return;

            // 初始化该世界书的数据结构
            if (!worldEntrySelections[activeWorld]) {
                worldEntrySelections[activeWorld] = {};
            }

            const entriesArray = Array.isArray(entries) ? entries : Object.values(entries);
            let count = 0;

            // 遍历所有条目，禁用新条目
            entriesArray.forEach(entry => {
                const entryKey = entry.uid;
                if (entryKey !== undefined && entryKey !== null && isNewEntry(activeWorld, entryKey)) {
                    worldEntrySelections[activeWorld][entryKey] = false;
                    count++;
                }
            });

            if (count > 0) {
                // 保存配置并刷新UI
                saveWorldBookConfig();
                renderWorldList();
                renderEntryList();
                toastr.success(`已禁用 ${count} 个新条目`);
            } else {
                toastr.info('没有新条目');
            }
        } catch (error) {
            console.error('[send_data] 批量禁用新条目失败:', error);
            toastr.error('操作失败: ' + error.message);
        }
    }

    // 显示条目内容弹窗 - 模仿 worker.js 的可视化弹窗实现
    function showEntryContentModal(title, content, keys = [], isConstant = false) {
        // 移除已存在的弹窗
        document.querySelector('.st-chatu8-entry-content-backdrop')?.remove();

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

        // 创建弹窗 - 使用与 worker.js 相同的结构
        const backdrop = document.createElement('div');
        backdrop.className = 'st-chatu8-workflow-viz-backdrop st-chatu8-entry-content-backdrop';
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
    }

    // 绑定事件
    // 使用 off() 防止重复绑定 (如果 initSendData 会被多次调用)
    worldListContainer.off('click').on('click', handleWorldClick);
    entryListContainer
        .off('click contextmenu mousedown mouseup mouseleave touchstart touchend touchcancel')
        .on('click', handleEntryClick)
        .on('contextmenu', handleEntryClick)
        .on('mousedown touchstart', handleEntryMouseDown)
        .on('mouseup mouseleave touchend touchcancel', handleEntryMouseUp);

    worldSearchInput.off('input').on('input', renderWorldList);
    entrySearchInput.off('input').on('input', renderEntryList);

    // 刷新世界书按钮处理
    async function handleRefreshWorlds() {
        const refreshButton = settingsModal.find('#ch-send-data-refresh-worlds');
        const originalHtml = refreshButton.html();

        // 显示加载状态
        refreshButton.prop('disabled', true).html('<i class="fa fa-spinner fa-spin"></i> 刷新中...');

        try {
            // 重新加载世界书列表
            await loadAndRenderWorlds();

            // 显示成功提示
            toastr.success('世界书已刷新');
        } catch (error) {
            console.error('[send_data] 刷新世界书失败:', error);
            toastr.error('刷新世界书失败: ' + error.message);
        } finally {
            // 恢复按钮状态
            refreshButton.prop('disabled', false).html(originalHtml);
        }
    }

    // 绑定全选/取消全选按钮
    settingsModal.find('#ch-send-data-select-all').off('click').on('click', handleSelectAll);
    settingsModal.find('#ch-send-data-deselect-all').off('click').on('click', handleDeselectAll);

    // 绑定批量处理新条目按钮
    settingsModal.find('#ch-send-data-enable-new-entries').off('click').on('click', handleEnableNewEntries);
    settingsModal.find('#ch-send-data-disable-new-entries').off('click').on('click', handleDisableNewEntries);

    // 绑定刷新世界书按钮
    settingsModal.find('#ch-send-data-refresh-worlds').off('click').on('click', handleRefreshWorlds);

    // 绑定测试触发按钮
    settingsModal.find('#ch-send-data-test-trigger').off('click').on('click', handleTestTrigger);

    // 监听聊天加载事件
    eventSource.on(event_types.GENERATION_STARTED, loadAndRenderWorlds);


    const intervalId = setInterval(async () => {
        let conet = getContext()
        const settings = extension_settings[extensionName];
        if (conet && conet.chatId) {

            conet.chatMetadata.variables.zhihuiji = settings.scriptEnabled

            await saveChatConditional();

            clearInterval(intervalId)
        }
    }, 2000)


    eventSource.on(event_types.CHAT_CHANGED, async () => {

        let conet = getContext()
        const settings = extension_settings[extensionName];
        if (conet && conet.chatId) {

            conet.chatMetadata.variables.zhihuiji = settings.scriptEnabled


            console.log("1231", conet)

            // 自动根据当前角色卡切换角色启用预设
            if (conet.name2 && settings.characterEnablePresets) {
                let matchedPresets = [];
                for (const presetName in settings.characterEnablePresets) {
                    const preset = settings.characterEnablePresets[presetName];
                    if (preset.bindCharacterCard === conet.name2) {
                        matchedPresets.push({ name: presetName, preset: preset });
                    }
                }
                
                let matchedPresetId = null;
                if (matchedPresets.length > 0) {
                    if (matchedPresets.length === 1) {
                        matchedPresetId = matchedPresets[0].name;
                    } else {
                        // 多个预设，进一步判断 chatId
                        let chatMatched = matchedPresets.find(p => p.preset.bindChatId === conet.chatId);
                        if (chatMatched) {
                            matchedPresetId = chatMatched.name;
                        } else {
                            // 没有匹配的 chatId，判断当前预设是否在其中
                            let currentBelongs = matchedPresets.find(p => p.name === settings.characterEnablePresetId);
                            if (currentBelongs) {
                                // 属于则不变
                                matchedPresetId = null;
                            } else {
                                // 不属于，随机选取
                                let randomIndex = Math.floor(Math.random() * matchedPresets.length);
                                matchedPresetId = matchedPresets[randomIndex].name;
                            }
                        }
                    }
                }
                
                if (matchedPresetId && settings.characterEnablePresetId !== matchedPresetId) {
                    settings.characterEnablePresetId = matchedPresetId;
                    toastr.success(`已自动切换角色启用预设至：${matchedPresetId}`);
                    
                    // 更新UI (如果设置面板处于打开状态)
                    const select = document.getElementById('character_enable_preset_id');
                    if (select) {
                        select.value = matchedPresetId;
                        // 触发 change 事件以更新下面的文本框
                        $(select).trigger('change');
                    }
                }
            }

            await saveChatConditional();

        }

    });

    // 立即加载一次
    //loadAndRenderWorlds();
}

/**
 * 测试世界书触发功能
 */
async function handleTestTrigger() {
    // 创建输入弹窗
    const backdrop = document.createElement('div');
    backdrop.className = 'st-chatu8-workflow-viz-backdrop';
    backdrop.style.zIndex = '10002';

    backdrop.innerHTML = `
        <div class="st-chatu8-workflow-viz-dialog" style="width: 90%; max-width: 1000px; max-height: 85vh;">
            <div class="st-chatu8-workflow-viz-header">
                <h3>🧪 测试世界书触发</h3>
                <span class="st-chatu8-workflow-viz-close">&times;</span>
            </div>
            <div style="padding: 20px; display: flex; flex-direction: column; gap: 15px; overflow-y: auto; max-height: calc(85vh - 60px);">
                <div>
                    <label style="display: block; margin-bottom: 8px; color: #ddd; font-weight: bold;">
                        输入触发文本（可选，留空则使用最近的聊天消息）：
                    </label>
                    <textarea id="test-trigger-input" style="
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
                    <button id="test-trigger-run" style="
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
                <div id="test-trigger-result" style="display: none;">
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
    const runBtn = backdrop.querySelector('#test-trigger-run');
    const inputArea = backdrop.querySelector('#test-trigger-input');
    const resultDiv = backdrop.querySelector('#test-trigger-result');

    runBtn.onclick = async () => {
        const triggerText = inputArea.value.trim();

        runBtn.disabled = true;
        runBtn.innerHTML = '<i class="fa fa-spinner fa-spin"></i> 测试中...';

        try {
            // 动态导入世界书处理函数
            const { processWorldBooksWithTriggerStructured } = await import('../worldbookProcessor.js');

            // 如果没有输入文本，使用默认文本"你好"
            let contextElements = [];
            if (triggerText) {
                contextElements = [triggerText];
            } else {
                // 使用默认测试文本
                contextElements = ['你好'];
                console.log('[send_data] 使用默认测试文本: "你好"');
            }

            // 调用世界书触发处理
            const worldBooksData = await processWorldBooksWithTriggerStructured(contextElements);

            // 显示结果
            displayTestResult(resultDiv, worldBooksData, contextElements);

        } catch (error) {
            console.error('[send_data] 测试触发失败:', error);
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
 * 显示测试结果
 */
function displayTestResult(container, worldBooksData, contextElements) {
    container.style.display = 'block';

    if (!worldBooksData || worldBooksData.length === 0) {
        container.innerHTML = `
            <div style="padding: 15px; background: rgba(255, 255, 255, 0.05); border: 1px solid rgba(255, 255, 255, 0.1); border-radius: 6px;">
                <div style="color: #888; text-align: center;">
                    <i class="fa fa-info-circle"></i> 没有触发任何世界书条目
                </div>
            </div>
        `;
        return;
    }

    // 统计总数
    const totalEntries = worldBooksData.reduce((sum, wb) => sum + wb.entries.length, 0);

    let html = `
        <div style="margin-bottom: 15px; padding: 12px; background: rgba(76, 175, 80, 0.1); border: 1px solid rgba(76, 175, 80, 0.3); border-radius: 6px;">
            <div style="color: #4CAF50; font-weight: bold; margin-bottom: 8px;">
                <i class="fa fa-check-circle"></i> 测试完成
            </div>
            <div style="color: #ddd; font-size: 13px;">
                触发了 <strong>${worldBooksData.length}</strong> 个世界书，共 <strong>${totalEntries}</strong> 个条目
            </div>
            <div style="color: #888; font-size: 12px; margin-top: 5px;">
                触发文本长度: ${contextElements.join('\n').length} 字符
            </div>
        </div>
    `;

    // 显示每个世界书的触发结果
    worldBooksData.forEach((worldBook, worldIndex) => {
        const worldId = `test-world-${worldIndex}`;
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
            const borderColor = isConstant ? 'rgba(255, 193, 7, 0.4)' : 'rgba(66, 165, 245, 0.3)';
            const bgColor = isConstant ? 'rgba(255, 193, 7, 0.08)' : 'rgba(66, 165, 245, 0.05)';
            const titleColor = isConstant ? '#ffc107' : '#64b5f6';
            const badgeBg = isConstant ? 'rgba(255, 193, 7, 0.2)' : 'rgba(66, 165, 245, 0.2)';
            const badgeColor = isConstant ? '#ffc107' : '#64b5f6';

            entriesHtml += `
                <div class="test-wb-entry-item" style="
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
                            <button class="test-wb-entry-disable-btn" data-world-name="${worldName}" data-entry-uid="${entry.uid || ''}" style="
                                padding: 2px 8px;
                                background: rgba(255, 152, 0, 0.15);
                                border: 1px solid rgba(255, 152, 0, 0.3);
                                border-radius: 3px;
                                color: #ff9800;
                                cursor: pointer;
                                font-size: 10px;
                                transition: all 0.2s;
                            " title="禁用此条目（影响发送数据设置）">
                                <i class="fa-solid fa-ban"></i> 禁用
                            </button>
                            ${hasMore ? `
                            <button class="test-wb-entry-toggle-top" data-entry-id="${entryId}" style="
                                padding: 2px 8px;
                                background: rgba(66, 165, 245, 0.15);
                                border: 1px solid rgba(66, 165, 245, 0.3);
                                border-radius: 3px;
                                color: #42a5f5;
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
                    <div class="test-wb-entry-preview" style="
                        white-space: pre-wrap;
                        line-height: 1.5;
                        font-size: 13px;
                        color: #ddd;
                        ${hasMore ? 'cursor: pointer;' : ''}
                    " data-entry-id="${entryId}">
                        ${hasMore ? escapedPreview + '...' : escapedContent}
                    </div>
                    <div class="test-wb-entry-full" id="${entryId}-full" style="
                        white-space: pre-wrap;
                        line-height: 1.5;
                        font-size: 13px;
                        color: #ddd;
                        display: none;
                    ">
                        ${escapedContent}
                    </div>
                    ${hasMore ? `
                    <button class="test-wb-entry-toggle" data-entry-id="${entryId}" style="
                        margin-top: 6px;
                        padding: 3px 10px;
                        background: rgba(66, 165, 245, 0.15);
                        border: 1px solid rgba(66, 165, 245, 0.3);
                        border-radius: 3px;
                        color: #42a5f5;
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
            <div class="test-wb-world-item" style="
                margin-bottom: 12px;
                border: 1px solid rgba(66, 165, 245, 0.2);
                border-radius: 6px;
                overflow: hidden;
                background: rgba(66, 165, 245, 0.03);
            ">
                <div class="test-wb-world-header" data-world-id="${worldId}" style="
                    padding: 10px 12px;
                    background: rgba(66, 165, 245, 0.1);
                    cursor: pointer;
                    display: flex;
                    align-items: center;
                    justify-content: space-between;
                    user-select: none;
                    transition: background 0.2s;
                ">
                    <div style="display: flex; align-items: center; gap: 8px;">
                        <i class="fa-solid fa-chevron-right test-wb-world-icon" style="
                            color: #42a5f5;
                            font-size: 12px;
                            transition: transform 0.2s;
                        "></i>
                        <span style="font-weight: bold; color: #42a5f5; font-size: 13px;">
                            📖 ${worldName}
                        </span>
                    </div>
                    <span style="font-size: 11px; color: #888;">
                        ${entries.length} 个条目
                    </span>
                </div>
                <div class="test-wb-world-content" id="${worldId}-content" style="
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
    $(container).off('click').on('click', '.test-wb-world-header', function () {
        const worldId = $(this).data('world-id');
        const $content = $(`#${worldId}-content`);
        const $icon = $(this).find('.test-wb-world-icon');

        if ($content.is(':visible')) {
            $content.slideUp(200);
            $icon.css('transform', 'rotate(0deg)');
        } else {
            $content.slideDown(200);
            $icon.css('transform', 'rotate(90deg)');
        }
    });

    // 底部展开/收起按钮
    $(container).on('click', '.test-wb-entry-toggle', function (e) {
        e.stopPropagation();
        const entryId = $(this).data('entry-id');
        const $item = $(this).closest('.test-wb-entry-item');
        const $preview = $item.find('.test-wb-entry-preview');
        const $full = $(`#${entryId}-full`);
        const $topBtn = $item.find('.test-wb-entry-toggle-top');

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
    $(container).on('click', '.test-wb-entry-toggle-top', function (e) {
        e.stopPropagation();
        const entryId = $(this).data('entry-id');
        const $item = $(this).closest('.test-wb-entry-item');
        const $preview = $item.find('.test-wb-entry-preview');
        const $full = $(`#${entryId}-full`);
        const $bottomBtn = $item.find('.test-wb-entry-toggle');

        // 收起
        $full.hide();
        $preview.show();
        $bottomBtn.html('<i class="fa-solid fa-chevron-down"></i> 展开');
        $(this).hide();
    });

    // 点击预览文本展开
    $(container).on('click', '.test-wb-entry-preview', function (e) {
        const entryId = $(this).data('entry-id');
        if (!entryId) return;

        const $toggle = $(this).siblings('.test-wb-entry-toggle');
        if ($toggle.length > 0) {
            $toggle.click();
        }
    });

    // 禁用条目按钮
    $(container).on('click', '.test-wb-entry-disable-btn', async function (e) {
        e.stopPropagation();
        const worldName = $(this).data('world-name');
        const entryUid = $(this).data('entry-uid');

        if (!worldName || entryUid === undefined || entryUid === null) {
            console.warn('[send_data] 切换条目状态失败：缺少必要参数', { worldName, entryUid });
            return;
        }

        try {
            // 获取当前状态
            const currentState = getWorldEntryState(worldName, entryUid);

            // 切换状态：如果当前是禁用(false)，则启用(true)；否则禁用(false)
            const newState = (currentState === false) ? true : false;
            toggleWorldEntryState(worldName, entryUid, newState);

            console.log('[send_data] 已切换条目状态:', {
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
                $btn.attr('title', '禁用此条目（影响发送数据设置）');
                toastr.success(`已启用条目（世界书: ${worldName}）`);
            }
        } catch (err) {
            console.error('[send_data] 切换条目状态失败:', err);
            toastr.error('操作失败: ' + (err.message || '未知错误'));
        }
    });
}
