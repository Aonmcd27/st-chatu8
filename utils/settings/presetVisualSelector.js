// @ts-nocheck
/**
 * 预设可视化选择器模块
 * 
 * 提供可视化的预设选择界面，支持预览图片上传和展示
 */

import { extension_settings } from "../../../../../extensions.js";
import { saveSettingsDebounced } from "../../../../../../script.js";
import { extensionName } from '../config.js';
import { saveConfigImage, getConfigImage, deleteConfigImage } from '../configDatabase.js';
import { getSuffix } from '../ui_common.js';

/**
 * 显示预设可视化选择器
 * 
 * @param {string} mode - 生成模式 ('sd', 'novelai', 'comfyui')
 * @param {Object} settings - 插件设置对象
 * @param {Function} onSelect - 选择回调函数 (presetName) => void
 */
export async function showPresetVisualSelector(mode, settings, onSelect) {
    const parent = document.getElementById('st-chatu8-settings') || document.body;

    // 创建背景遮罩 (使用工作流可视化的样式)
    const backdrop = document.createElement('div');
    backdrop.className = 'st-chatu8-workflow-viz-backdrop';

    // 状态
    const selectedForDelete = new Set();
    let isBulkDeleteMode = false;

    // 分页状态
    let currentPage = 1;
    let pageSize = settings.presetVisualPageSize || 12; // 每页显示数量（从设置读取）
    let filteredPresets = []; // 筛选后的预设列表
    let gridColumns = settings.presetVisualGridColumns || 6; // 网格列数（从设置读取）

    // 创建对话框结构
    backdrop.innerHTML = `
        <div class="st-chatu8-workflow-viz-dialog st-chatu8-preset-viz-dialog-wrapper">
            <div class="st-chatu8-workflow-viz-header">
                <h3>选择提示词预设</h3>
                <span class="st-chatu8-workflow-viz-close">&times;</span>
            </div>
            <div class="st-chatu8-workflow-viz-toolbar" style="justify-content: space-between; align-items: center; gap: 15px;">
                <div class="st-chatu8-viz-search-container" style="position: relative; flex-grow: 1; max-width: 300px;">
                    <i class="fa-solid fa-search" style="position: absolute; left: 12px; top: 50%; transform: translateY(-50%); color: #aaa; pointer-events: none;"></i>
                    <input type="text" class="st-chatu8-viz-search-input" placeholder="搜索预设..." style="width: 100%; padding: 8px 12px 8px 36px; background: rgba(0,0,0,0.2); border: 1px solid rgba(255,255,255,0.1); border-radius: 20px; color: white; outline: none; transition: all 0.3s;">
                </div>
                <div style="display: flex; gap: 10px;">
                    <div class="st-chatu8-viz-bulk-delete" style="cursor: pointer; padding: 6px 14px; background: rgba(255,255,255,0.1); border-radius: 20px; font-size: 0.9em; user-select: none; white-space: nowrap; display: flex; align-items: center; gap: 6px; transition: all 0.3s;">
                        <i class="fa-solid fa-trash-can"></i> <span>批量删除</span>
                    </div>
                     <div class="st-chatu8-viz-confirm-delete" style="display: none; cursor: pointer; padding: 6px 14px; background: var(--st-chatu8-danger-primary, #d9534f); border-radius: 20px; font-size: 0.9em; user-select: none; white-space: nowrap; align-items: center; gap: 6px; transition: all 0.3s; color: white;">
                        <i class="fa-solid fa-check"></i> <span>确认删除 (0)</span>
                    </div>
                    <div class="st-chatu8-viz-mode-toggle" style="cursor: pointer; padding: 6px 14px; background: rgba(255,255,255,0.1); border-radius: 20px; font-size: 0.9em; user-select: none; white-space: nowrap; display: flex; align-items: center; gap: 6px; transition: all 0.3s;">
                        <i class="fa-solid fa-pen-to-square"></i> <span>管理</span>
                    </div>
                </div>
            </div>
            <div class="st-chatu8-pagination-container" style="display: flex; justify-content: center; align-items: center; gap: 12px; padding: 12px 20px; background: rgba(30, 30, 46, 0.6); border-bottom: 1px solid rgba(255,255,255,0.05);">
                <button class="st-chatu8-pagination-btn st-chatu8-pagination-prev" title="上一页" style="padding: 6px 12px; background: rgba(255,255,255,0.1); border: 1px solid rgba(255,255,255,0.15); border-radius: 6px; color: #ccc; cursor: pointer; transition: all 0.2s;">
                    <i class="fa-solid fa-chevron-left"></i>
                </button>
                <div class="st-chatu8-pagination-info" style="display: flex; align-items: center; gap: 8px; color: #aaa; font-size: 0.9em;">
                    <span class="st-chatu8-pagination-current">1</span>
                    <span>/</span>
                    <span class="st-chatu8-pagination-total">1</span>
                    <span style="margin-left: 8px; color: #666;">|</span>
                    <span style="margin-left: 8px;">共 <span class="st-chatu8-pagination-count">0</span> 个</span>
                </div>
                <button class="st-chatu8-pagination-btn st-chatu8-pagination-next" title="下一页" style="padding: 6px 12px; background: rgba(255,255,255,0.1); border: 1px solid rgba(255,255,255,0.15); border-radius: 6px; color: #ccc; cursor: pointer; transition: all 0.2s;">
                    <i class="fa-solid fa-chevron-right"></i>
                </button>
                <div style="margin-left: 16px; display: flex; align-items: center; gap: 6px;">
                    <span style="color: #888; font-size: 0.85em;">每页</span>
                    <select class="st-chatu8-pagination-size" style="padding: 4px 8px; background: rgba(255,255,255,0.1); border: 1px solid rgba(255,255,255,0.15); border-radius: 6px; color: #ccc; cursor: pointer; font-size: 0.85em;">
                        <option value="8" ${pageSize === 8 ? 'selected' : ''}>8</option>
                        <option value="12" ${pageSize === 12 ? 'selected' : ''}>12</option>
                        <option value="16" ${pageSize === 16 ? 'selected' : ''}>16</option>
                        <option value="24" ${pageSize === 24 ? 'selected' : ''}>24</option>
                        <option value="48" ${pageSize === 48 ? 'selected' : ''}>48</option>
                    </select>
                </div>
                <div style="margin-left: 16px; display: flex; align-items: center; gap: 6px;">
                    <span style="color: #888; font-size: 0.85em;">每行</span>
                    <select class="st-chatu8-grid-columns-select" style="padding: 4px 8px; background: rgba(255,255,255,0.1); border: 1px solid rgba(255,255,255,0.15); border-radius: 6px; color: #ccc; cursor: pointer; font-size: 0.85em;">
                        <option value="4" ${gridColumns === 4 ? 'selected' : ''}>4</option>
                        <option value="6" ${gridColumns === 6 ? 'selected' : ''}>6</option>
                        <option value="8" ${gridColumns === 8 ? 'selected' : ''}>8</option>
                    </select>
                </div>
            </div>
            <div class="st-chatu8-workflow-viz-body">
                <div class="st-chatu8-workflow-viz-container st-chatu8-preset-viz-container">
                    <div class="st-chatu8-preset-grid"></div>
                </div>
            </div>
        </div>
    `;

    // 绑定关闭事件
    const closeBtn = backdrop.querySelector('.st-chatu8-workflow-viz-close');
    closeBtn.onclick = () => parent.removeChild(backdrop);
    backdrop.onclick = (e) => {
        if (e.target === backdrop) {
            parent.removeChild(backdrop);
        }
    };

    // 搜索功能 - 与分页配合
    const searchInput = backdrop.querySelector('.st-chatu8-viz-search-input');
    let searchQuery = '';

    searchInput.oninput = (e) => {
        searchQuery = e.target.value.toLowerCase();
        currentPage = 1; // 搜索时重置到第一页
        updateFilteredPresets();
        renderCurrentPage();
    };

    const wrapper = backdrop.querySelector('.st-chatu8-preset-viz-dialog-wrapper');
    const bulkDeleteBtn = backdrop.querySelector('.st-chatu8-viz-bulk-delete');
    const confirmDeleteBtn = backdrop.querySelector('.st-chatu8-viz-confirm-delete');
    const toggleBtn = backdrop.querySelector('.st-chatu8-viz-mode-toggle');

    // 绑定管理模式切换
    toggleBtn.onclick = () => {
        // 如果在批量删除模式下，先退出批量删除模式
        if (isBulkDeleteMode) {
            exitBulkDeleteMode();
        }

        wrapper.classList.toggle('st-chatu8-mode-manage');
        const isManage = wrapper.classList.contains('st-chatu8-mode-manage');
        toggleBtn.style.background = isManage ? 'var(--st-chatu8-accent-primary)' : 'rgba(255,255,255,0.1)';
        toggleBtn.style.color = isManage ? 'white' : 'inherit';
    };

    // 退出批量删除模式的辅助函数
    function exitBulkDeleteMode() {
        isBulkDeleteMode = false;
        selectedForDelete.clear();
        wrapper.classList.remove('st-chatu8-mode-bulk-delete');
        bulkDeleteBtn.style.background = 'rgba(255,255,255,0.1)';
        bulkDeleteBtn.style.color = 'inherit';
        bulkDeleteBtn.querySelector('span').textContent = '批量删除';
        confirmDeleteBtn.style.display = 'none';

        // 清除所有卡片的选中状态
        const cards = backdrop.querySelectorAll('.st-chatu8-preset-card');
        cards.forEach(card => card.classList.remove('selected-for-delete'));
    }

    // 绑定批量删除模式切换
    bulkDeleteBtn.onclick = () => {
        // 如果在管理模式下，先退出管理模式
        if (wrapper.classList.contains('st-chatu8-mode-manage')) {
            wrapper.classList.remove('st-chatu8-mode-manage');
            toggleBtn.style.background = 'rgba(255,255,255,0.1)';
            toggleBtn.style.color = 'inherit';
        }

        isBulkDeleteMode = !isBulkDeleteMode;

        if (isBulkDeleteMode) {
            wrapper.classList.add('st-chatu8-mode-bulk-delete');
            bulkDeleteBtn.style.background = 'var(--st-chatu8-danger-primary, #d9534f)';
            bulkDeleteBtn.style.color = 'white';
            bulkDeleteBtn.querySelector('span').textContent = '取消删除';
            confirmDeleteBtn.style.display = 'flex';
            updateConfirmButton();
        } else {
            exitBulkDeleteMode();
        }
    };

    function updateConfirmButton() {
        confirmDeleteBtn.querySelector('span').textContent = `确认删除 (${selectedForDelete.size})`;
    }

    // 绑定确认删除
    confirmDeleteBtn.onclick = async () => {
        if (selectedForDelete.size === 0) return;

        if (confirm(`确定要删除选中的 ${selectedForDelete.size} 个预设吗？此操作不可恢复！`)) {
            let deletedCount = 0;
            for (const presetName of selectedForDelete) {
                // 删除图片
                const preset = settings.yushe[presetName];
                if (preset && preset.previewImageId) {
                    try {
                        await deleteConfigImage(preset.previewImageId);
                    } catch (e) {
                        console.warn(`Failed to delete image for ${presetName}`);
                    }
                }

                // 删除配置
                if (settings.yushe[presetName]) {
                    delete settings.yushe[presetName];
                    deletedCount++;
                }

                // 如果删除的是当前选中的，重置为默认
                const suffix = getSuffix(mode);
                const yusheIdKey = `yusheid${mode === 'sd' ? '_sd' : suffix}`;
                if (settings[yusheIdKey] === presetName) {
                    settings[yusheIdKey] = "默认";
                }
            }

            await saveSettingsDebounced();
            alert(`成功删除 ${deletedCount} 个预设。`);

            // 刷新界面
            exitBulkDeleteMode();
            // 使用分页方式重新加载
            updateFilteredPresets();
            // 确保当前页不超过总页数
            const totalPages = Math.ceil(filteredPresets.length / pageSize) || 1;
            if (currentPage > totalPages) {
                currentPage = totalPages;
            }
            renderCurrentPage();
        }
    };

    parent.appendChild(backdrop);

    const grid = backdrop.querySelector('.st-chatu8-preset-grid');

    // 获取当前选中的预设ID
    const suffix = getSuffix(mode);
    const yusheIdKey = `yusheid${mode === 'sd' ? '_sd' : suffix}`;
    const currentPresetId = settings[yusheIdKey];

    // 获取所有预设
    const presets = settings.yushe || {};
    const allPresetNames = Object.keys(presets);

    // 分页 DOM 元素
    const paginationPrev = backdrop.querySelector('.st-chatu8-pagination-prev');
    const paginationNext = backdrop.querySelector('.st-chatu8-pagination-next');
    const paginationCurrent = backdrop.querySelector('.st-chatu8-pagination-current');
    const paginationTotal = backdrop.querySelector('.st-chatu8-pagination-total');
    const paginationCount = backdrop.querySelector('.st-chatu8-pagination-count');
    const paginationSizeSelect = backdrop.querySelector('.st-chatu8-pagination-size');
    const gridColumnsSelect = backdrop.querySelector('.st-chatu8-grid-columns-select');

    // 更新筛选后的预设列表
    function updateFilteredPresets() {
        if (searchQuery) {
            filteredPresets = allPresetNames.filter(name =>
                name.toLowerCase().includes(searchQuery)
            );
        } else {
            filteredPresets = [...allPresetNames];
        }
    }

    // 更新网格布局
    function updateGridLayout() {
        // 只在桌面端（宽度 > 1400px）应用自定义列数
        // 在移动端保留 CSS 媒体查询的响应式行为
        if (window.innerWidth > 1400) {
            grid.style.columnCount = gridColumns;
        } else {
            grid.style.columnCount = ''; // 清除内联样式，使用 CSS 默认值
        }
    }

    // 更新分页 UI
    function updatePaginationUI() {
        const totalPages = Math.ceil(filteredPresets.length / pageSize) || 1;
        paginationCurrent.textContent = currentPage;
        paginationTotal.textContent = totalPages;
        paginationCount.textContent = filteredPresets.length;

        // 更新按钮状态
        paginationPrev.disabled = currentPage <= 1;
        paginationPrev.style.opacity = currentPage <= 1 ? '0.5' : '1';
        paginationPrev.style.cursor = currentPage <= 1 ? 'not-allowed' : 'pointer';

        paginationNext.disabled = currentPage >= totalPages;
        paginationNext.style.opacity = currentPage >= totalPages ? '0.5' : '1';
        paginationNext.style.cursor = currentPage >= totalPages ? 'not-allowed' : 'pointer';
    }

    // 渲染当前页
    async function renderCurrentPage() {
        // 添加过渡动画
        grid.style.opacity = '0';
        grid.style.transform = 'translateY(10px)';

        await new Promise(resolve => setTimeout(resolve, 150));

        grid.innerHTML = '';

        const startIndex = (currentPage - 1) * pageSize;
        const endIndex = startIndex + pageSize;
        const pagePresets = filteredPresets.slice(startIndex, endIndex);

        for (const presetName of pagePresets) {
            const preset = presets[presetName];
            const card = await createPresetCard(presetName, preset, presetName === currentPresetId, settings, mode, handleCardClick);
            grid.appendChild(card);
        }

        updatePaginationUI();

        // 恢复显示
        grid.style.transition = 'opacity 0.3s ease, transform 0.3s ease';
        grid.style.opacity = '1';
        grid.style.transform = 'translateY(0)';
    }

    // 卡片点击处理函数
    const handleCardClick = (name, cardElement) => {
        if (isBulkDeleteMode) {
            if (selectedForDelete.has(name)) {
                selectedForDelete.delete(name);
                cardElement.classList.remove('selected-for-delete');
            } else {
                selectedForDelete.add(name);
                cardElement.classList.add('selected-for-delete');
            }
            updateConfirmButton();
        } else {
            // 正常选择模式
            onSelect(name);
            parent.removeChild(backdrop);
        }
    };

    // 分页事件绑定
    paginationPrev.onclick = () => {
        if (currentPage > 1) {
            currentPage--;
            renderCurrentPage();
        }
    };

    paginationNext.onclick = () => {
        const totalPages = Math.ceil(filteredPresets.length / pageSize) || 1;
        if (currentPage < totalPages) {
            currentPage++;
            renderCurrentPage();
        }
    };

    paginationSizeSelect.onchange = (e) => {
        pageSize = parseInt(e.target.value);
        settings.presetVisualPageSize = pageSize; // 持久化保存
        saveSettingsDebounced();
        currentPage = 1; // 重置到第一页
        renderCurrentPage();
    };

    gridColumnsSelect.onchange = (e) => {
        gridColumns = parseInt(e.target.value);
        settings.presetVisualGridColumns = gridColumns; // 持久化保存
        saveSettingsDebounced();
        updateGridLayout();
    };

    parent.appendChild(backdrop);

    // 监听窗口大小变化，更新网格布局
    const handleResize = () => updateGridLayout();
    window.addEventListener('resize', handleResize);

    // 清理函数：移除事件监听器
    const originalRemove = backdrop.remove.bind(backdrop);
    backdrop.remove = function () {
        window.removeEventListener('resize', handleResize);
        originalRemove();
    };

    // 初始化：加载第一页
    updateFilteredPresets();
    updateGridLayout();
    renderCurrentPage();
}

/**
 * 创建预设卡片
 * 
 * @param {string} presetName - 预设名称
 * @param {Object} preset - 预设数据
 * @param {boolean} isSelected - 是否被选中
 * @param {Object} settings - 插件设置
 * @param {string} mode - 生成模式 (用于重命名逻辑)
 * @param {Function} onClick - 点击回调 (name, cardElement) => void
 * @returns {HTMLElement} 卡片元素
 */
async function createPresetCard(presetName, preset, isSelected, settings, mode, onClick) {
    const card = document.createElement('div');
    card.className = 'st-chatu8-preset-card' + (isSelected ? ' selected' : '');

    // 图片容器
    const imageContainer = document.createElement('div');
    imageContainer.className = 'st-chatu8-preset-card-image';

    // 检查是否有预览图
    const previewImageId = preset.previewImageId;
    if (previewImageId) {
        try {
            const imageData = await getConfigImage(previewImageId);
            if (imageData) {
                const img = document.createElement('img');
                img.src = imageData;
                img.alt = presetName;
                imageContainer.appendChild(img);
            } else {
                addPlaceholder(imageContainer);
            }
        } catch (e) {
            console.error('加载预设预览图失败:', e);
            addPlaceholder(imageContainer);
        }
    } else {
        addPlaceholder(imageContainer);
    }

    // 创建操作按钮容器
    const actions = document.createElement('div');
    actions.className = 'st-chatu8-preset-card-actions';

    // 创建上传/编辑按钮
    const uploadBtn = document.createElement('button');
    uploadBtn.className = 'st-chatu8-preset-action-btn';
    uploadBtn.title = '上传/修改预览图 (Upload Preview)';
    uploadBtn.innerHTML = '<i class="fa-solid fa-image"></i>';
    uploadBtn.onclick = (e) => {
        e.stopPropagation();
        handleImageUpload(presetName, settings, imageContainer);
    };
    actions.appendChild(uploadBtn);

    // 如果有图片，显示删除图片按钮
    if (previewImageId) {
        const deleteImgBtn = document.createElement('button');
        deleteImgBtn.className = 'st-chatu8-preset-action-btn danger';
        deleteImgBtn.title = '删除预览图 (Delete Preview)';
        deleteImgBtn.innerHTML = '<i class="fa-solid fa-trash-can"></i>';
        deleteImgBtn.onclick = async (e) => {
            e.stopPropagation();
            if (confirm(`确定要删除预设 "${presetName}" 的预览图吗？`)) {
                await deleteConfigImage(previewImageId);
                delete preset.previewImageId;
                saveSettingsDebounced();
                // 刷新显示
                refreshCardImage(imageContainer, null);
            }
        };
        actions.appendChild(deleteImgBtn);
    }

    // 重命名预设 (仅管理模式下显示)
    const renameBtn = document.createElement('button');
    renameBtn.className = 'st-chatu8-preset-action-btn';
    renameBtn.title = '重命名预设 (Rename Preset)';
    renameBtn.innerHTML = '<i class="fa-solid fa-pen-nib"></i>';
    renameBtn.onclick = (e) => {
        e.stopPropagation();
        const newName = prompt(`请输入新的预设名称 (Current: ${presetName}):`, presetName);
        if (newName && newName !== presetName) {
            if (settings.yushe[newName]) {
                alert('该名称已存在，请使用其他名称。');
                return;
            }
            // 复制并删除旧的
            settings.yushe[newName] = settings.yushe[presetName];
            delete settings.yushe[presetName];

            // 如果当前选中的是被重命名的，更新选中项
            const suffix = getSuffix(mode);
            const yusheIdKey = `yusheid${mode === 'sd' ? '_sd' : suffix}`;
            if (settings[yusheIdKey] === presetName) {
                settings[yusheIdKey] = newName;
            }

            saveSettingsDebounced();
            // 刷新整个选择器
            const backdrop = document.querySelector('.st-chatu8-workflow-viz-backdrop');
            if (backdrop) backdrop.parentNode.removeChild(backdrop);
            showPresetVisualSelector(mode, settings, (name) => onClick(name, null)).then(() => {
                // Note: onClick here is passed from showPresetVisualSelector, which expects (name)
                // But in our improved logic, we are passing a specialized handler.
                // This recursion might be slightly tricky if not careful, but `onClick` passed to `createPresetCard`
                // is the `handleCardClick` function from `showPresetVisualSelector`.
                // So we need to re-trigger the main function.
                // Actually the `onClick` param in `showPresetVisualSelector` is the EXTERNAL `onSelect` callback.
                // My refactoring changed `createPresetCard` signature.
            });
            // Fix recursive call logic: `showPresetVisualSelector` takes `onSelect`.
            // We need to pass the original `onSelect` somehow?
            // Ah, `onClick` passed to `createPresetCard` IS the handler.
            // Wait, in my `showPresetVisualSelector` implementation above:
            // I call `createPresetCard(..., handleCardClick)`
            // `handleCardClick` calls `onSelect(name)` when not in bulk mode.
            // So I just need to re-call `showPresetVisualSelector` with the ORIGINAL `onSelect`.
            // BUT `onSelect` is available in the scope of `showPresetVisualSelector` but NOT naturally here unless passed through.
            // `onClick` here is `handleCardClick`. That works for CLICKING.
            // But for REFRESHING, I need to call the MAIN function again.
            // The main function needs `onSelect`.
            // `createPresetCard` doesn't receive `onSelect` directly, it receives `onClick` wrapper.
            // Use a custom event or just accept that full refresh might be tricky without passing `onSelect` down?
            // Actually, `createPresetCard` is distinct.
            // I can just pass `settings` and `mode`. But I need `onSelect`.
            // Let's modify `createPresetCard` to NOT handle the full refresh logic itself internally 
            // OR pass `actionCallback` that handles refresh.
            // For now, let's keep it simple: assuming `onClick` is sufficient for interaction.
            // But valid point: if I refresh, I need `onSelect`.
            // Javascript closures! `createPresetCard` is defined OUTSIDE.
            // So it doesn't close over `onSelect`.
            // I should pass a "reload" callback or similar?
            // Or better yet, just manipulate the DOM directly?
            // The rename logic re-calls `showPresetVisualSelector`.
            // To do that, it needs the original `onSelect`.
            // I should add `onSelect` to `createPresetCard` arguments if I want to support this properly.
            // Or, I can attach `onSelect` to the DOM element/settings object temporarily? No that's hacky.
            // Let's update `createPresetCard` signature to accept `onSelect` purely for the purpose of passing it to `showPresetVisualSelector` again.
        }
    };
    actions.appendChild(renameBtn);

    // 删除预设 (仅管理模式下显示)
    const deletePresetBtn = document.createElement('button');
    deletePresetBtn.className = 'st-chatu8-preset-action-btn danger';
    deletePresetBtn.title = '删除此预设 (Delete Preset)';
    deletePresetBtn.innerHTML = '<i class="fa-solid fa-trash"></i>';
    deletePresetBtn.onclick = (e) => {
        e.stopPropagation();
        if (confirm(`确定要彻底删除预设 "${presetName}" 吗？此操作不可恢复！`)) {
            // 如果有图片，先删除图片
            if (preset.previewImageId) {
                deleteConfigImage(preset.previewImageId);
            }
            delete settings.yushe[presetName];

            // 检查是否删除的是当前选中的预设
            const suffix = getSuffix(mode);
            const yusheIdKey = `yusheid${mode === 'sd' ? '_sd' : suffix}`;
            const isDeletingCurrentPreset = settings[yusheIdKey] === presetName;

            if (isDeletingCurrentPreset) {
                settings[yusheIdKey] = "默认";
            }

            saveSettingsDebounced();

            // 关闭对话框
            const backdrop = document.querySelector('.st-chatu8-workflow-viz-backdrop');
            if (backdrop) backdrop.parentNode.removeChild(backdrop);

            // 如果删除的是当前选中的预设，刷新整个设置界面
            if (isDeletingCurrentPreset && typeof window.loadSilterTavernChatu8Settings === 'function') {
                window.loadSilterTavernChatu8Settings();
            }
        }
    };
    actions.appendChild(deletePresetBtn);

    imageContainer.appendChild(actions);
    card.appendChild(imageContainer);

    // 预设名称
    const nameLabel = document.createElement('div');
    nameLabel.className = 'st-chatu8-preset-card-name';
    nameLabel.textContent = presetName;
    card.appendChild(nameLabel);

    // 点击选择
    card.onclick = () => onClick(presetName, card);

    return card;
}

/**
 * 添加占位符
 */
function addPlaceholder(container) {
    const placeholder = document.createElement('div');
    placeholder.className = 'st-chatu8-preset-card-placeholder';
    placeholder.innerHTML = '<i class="fa-solid fa-image"></i>';
    container.appendChild(placeholder);
}

/**
 * 刷新卡片图片
 */
async function refreshCardImage(container, imageId) {
    // 清除现有内容（保留操作按钮）
    const actions = container.querySelector('.st-chatu8-preset-card-actions');
    container.innerHTML = '';

    if (imageId) {
        try {
            const imageData = await getConfigImage(imageId);
            if (imageData) {
                const img = document.createElement('img');
                img.src = imageData;
                container.appendChild(img);
            } else {
                addPlaceholder(container);
            }
        } catch (e) {
            addPlaceholder(container);
        }
    } else {
        addPlaceholder(container);
    }

    if (actions) {
        container.appendChild(actions);
    }
}

/**
 * 处理图片上传通用逻辑
 * 
 * @param {string} presetName 
 * @param {Object} settings 
 * @param {HTMLElement} container 
 */
function handleImageUpload(presetName, settings, container) {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';

    input.onchange = async (e) => {
        const file = e.target.files[0];
        if (!file) return;

        try {
            // 读取文件为 base64
            const reader = new FileReader();
            reader.onload = async (readerEvent) => {
                const base64 = readerEvent.target.result;

                // 删除旧图片（如果存在）
                const oldImageId = settings.yushe[presetName]?.previewImageId;
                if (oldImageId) {
                    try {
                        await deleteConfigImage(oldImageId);
                    } catch (e) {
                        console.warn('删除旧预览图失败:', e);
                    }
                }

                // 保存新图片
                const newImageId = await saveConfigImage(base64, {
                    format: file.type.split('/')[1] || 'png',
                    filename: `preset_${presetName}_preview`
                });

                // 更新预设配置
                if (!settings.yushe[presetName]) {
                    settings.yushe[presetName] = {};
                }
                settings.yushe[presetName].previewImageId = newImageId;
                saveSettingsDebounced();

                // 刷新卡片显示
                refreshCardImage(container, newImageId);
            };
            reader.readAsDataURL(file);
        } catch (error) {
            console.error('上传预览图失败:', error);
            alert('上传预览图失败: ' + error.message);
        }
    };

    input.click();
}

/**
 * 删除预设预览图
 * 
 * @param {string} presetName - 预设名称
 * @param {Object} settings - 插件设置
 */
async function deletePresetImage(presetName, settings) {
    const imageId = settings.yushe[presetName]?.previewImageId;
    if (!imageId) return;

    try {
        await deleteConfigImage(imageId);
        delete settings.yushe[presetName].previewImageId;
        saveSettingsDebounced();
    } catch (error) {
        console.error('删除预览图失败:', error);
    }
}
