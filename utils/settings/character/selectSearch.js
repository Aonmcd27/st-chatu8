// @ts-nocheck
/**
 * 选择器搜索模块
 * 为下拉选择器添加搜索功能
 */

import { extension_settings } from "../../../../../../extensions.js";
import { extensionName } from '../../config.js';

/**
 * 配置项定义
 * 每个选择器的搜索配置
 */
const SEARCH_CONFIG = {
    // 预设选择器配置
    presets: [
        {
            selectId: 'character_preset_id',
            searchId: 'character_preset_search',
            placeholder: '搜索角色预设...',
            dataSource: 'characterPresets',
            hasNames: true,
            defaultOption: '-- 无 --'
        },
        {
            selectId: 'outfit_preset_id',
            searchId: 'outfit_preset_search',
            placeholder: '搜索服装预设...',
            dataSource: 'outfitPresets',
            hasNames: true,
            defaultOption: '-- 无 --'
        },
        {
            selectId: 'character_enable_preset_id',
            searchId: 'character_enable_preset_search',
            placeholder: '搜索角色启用预设...',
            dataSource: 'characterEnablePresets',
            hasNames: false,
            defaultOption: '-- 无 --'
        },
        {
            selectId: 'outfit_enable_preset_id',
            searchId: 'outfit_enable_preset_search',
            placeholder: '搜索服装启用预设...',
            dataSource: 'outfitEnablePresets',
            hasNames: false,
            defaultOption: '-- 无 --'
        },
        {
            selectId: 'character_common_preset_id',
            searchId: 'character_common_preset_search',
            placeholder: '搜索通用角色预设...',
            dataSource: 'characterCommonPresets',
            hasNames: false,
            defaultOption: '-- 无 --'
        },
        {
            selectId: 'banana_char_preset_id',
            searchId: 'banana_char_preset_search',
            placeholder: '搜索Banana角色预设...',
            dataSource: 'bananaCharacterPresets',
            hasNames: false,
            defaultOption: '-- 无 --'
        }
    ],
    // 添加选择器配置
    selectors: [
        {
            selectId: 'char_outfit_selector',
            searchId: 'char_outfit_selector_search',
            placeholder: '搜索服装...',
            dataSource: 'outfitPresets',
            hasNames: true,
            defaultOption: '-- 选择服装 --'
        },
        {
            selectId: 'character_enable_selector',
            searchId: 'character_enable_selector_search',
            placeholder: '搜索角色...',
            dataSource: 'characterPresets',
            hasNames: true,
            defaultOption: '-- 选择角色 --'
        },
        {
            selectId: 'outfit_enable_selector',
            searchId: 'outfit_enable_selector_search',
            placeholder: '搜索服装...',
            dataSource: 'outfitPresets',
            hasNames: true,
            defaultOption: '-- 选择服装 --'
        },
        {
            selectId: 'character_common_selector',
            searchId: 'character_common_selector_search',
            placeholder: '搜索角色...',
            dataSource: 'characterPresets',
            hasNames: true,
            defaultOption: '-- 选择角色 --'
        }
    ]
};

/**
 * 创建搜索输入框并插入到适当位置
 * @param {HTMLSelectElement} select - 选择器元素
 * @param {Object} config - 配置对象
 * @returns {HTMLInputElement} - 创建的搜索输入框
 */
function createSearchInput(select, config) {
    // 检查是否已存在搜索框
    let searchInput = document.getElementById(config.searchId);
    if (searchInput) {
        return searchInput;
    }

    // 创建搜索输入框
    searchInput = document.createElement('input');
    searchInput.type = 'text';
    searchInput.id = config.searchId;
    searchInput.className = 'st-chatu8-text-input st-chatu8-select-search';
    searchInput.placeholder = config.placeholder;

    // 查找父容器并决定插入位置
    const selectParent = select.parentElement;
    if (!selectParent) return searchInput;

    // 检查是否在 profile-controls 中（预设选择器）
    if (selectParent.classList.contains('st-chatu8-profile-controls')) {
        // 预设选择器 - 将搜索框插入到 profile-controls 前面
        const grandParent = selectParent.parentElement;
        if (grandParent) {
            grandParent.insertBefore(searchInput, selectParent);
        }
    } else {
        // 添加选择器 - 将搜索框插入到包含 select 的 flex 容器前面
        const grandParent = selectParent.parentElement;
        if (grandParent) {
            grandParent.insertBefore(searchInput, selectParent);
        }
    }

    return searchInput;
}

/**
 * 检查预设是否匹配搜索关键词
 * @param {string} presetName - 预设名称
 * @param {Object} presetData - 预设数据
 * @param {string} keyword - 搜索关键词
 * @param {boolean} hasNames - 是否有中英文名称字段
 * @returns {boolean} - 是否匹配
 */
function matchesSearch(presetName, presetData, keyword, hasNames) {
    const lowerKeyword = keyword.toLowerCase();

    // 匹配预设名称
    if (presetName.toLowerCase().includes(lowerKeyword)) {
        return true;
    }

    // 如果有中英文名称字段，也进行匹配
    if (hasNames && presetData) {
        if (presetData.nameCN && presetData.nameCN.toLowerCase().includes(lowerKeyword)) {
            return true;
        }
        if (presetData.nameEN && presetData.nameEN.toLowerCase().includes(lowerKeyword)) {
            return true;
        }
    }

    return false;
}

/**
 * 过滤并刷新选择器选项
 * @param {HTMLSelectElement} select - 选择器元素
 * @param {Object} config - 配置对象
 * @param {string} keyword - 搜索关键词
 */
function filterSelectOptions(select, config, keyword) {
    const settings = extension_settings[extensionName];
    const presets = settings[config.dataSource] || {};
    const currentValue = select.value;

    // 清空选择器
    select.innerHTML = '';

    // 如果有默认选项，先添加
    if (config.defaultOption) {
        const defaultOpt = document.createElement('option');
        defaultOpt.value = '';
        defaultOpt.textContent = config.defaultOption;
        select.add(defaultOpt);
    }

    // 收集匹配的选项
    const matchedOptions = [];

    // 过滤并添加匹配的选项
    for (const presetName in presets) {
        const presetData = presets[presetName];

        // 如果没有关键词或者匹配搜索
        if (!keyword || matchesSearch(presetName, presetData, keyword, config.hasNames)) {
            const option = document.createElement('option');
            option.value = presetName;

            // 如果有中英文名称，在选项文本中显示
            if (config.hasNames && presetData && (presetData.nameCN || presetData.nameEN)) {
                const nameParts = [presetName];
                if (presetData.nameCN || presetData.nameEN) {
                    const names = [presetData.nameCN, presetData.nameEN].filter(Boolean).join(' / ');
                    nameParts.push(`(${names})`);
                }
                option.textContent = nameParts.join(' ');
            } else {
                option.textContent = presetName;
            }

            select.add(option);
            matchedOptions.push(presetName);
        }
    }

    // 设置选中值
    if (keyword && config.defaultOption) {
        // 有搜索关键词且有默认选项时，默认选中空值，这样用户选择搜索结果才能触发 change 事件
        select.value = '';
    } else if (currentValue && matchedOptions.includes(currentValue)) {
        // 恢复之前的选择
        select.value = currentValue;
    } else if (keyword && matchedOptions.length === 1) {
        // 如果有搜索关键词且只有一个匹配结果，自动选中它
        select.value = matchedOptions[0];
    } else if (select.options.length > 0) {
        select.selectedIndex = 0;
    }
}

/**
 * 初始化单个选择器的搜索功能
 * @param {Object} config - 配置对象
 */
function initSelectSearch(config) {
    const select = document.getElementById(config.selectId);
    if (!select) return;

    const searchInput = createSearchInput(select, config);

    // 监听搜索输入
    searchInput.addEventListener('input', (e) => {
        const keyword = e.target.value.trim();
        filterSelectOptions(select, config, keyword);
    });

    // 初始化时刷新一次（显示完整名称）
    // 延迟 500ms 确保预设数据加载完成
    setTimeout(() => {
        filterSelectOptions(select, config, '');
    }, 500);
}

/**
 * 初始化所有选择器的搜索功能
 * @param {HTMLElement} container - 容器元素
 */
export function initAllSelectSearch(container) {
    // 初始化预设选择器搜索
    SEARCH_CONFIG.presets.forEach(config => {
        initSelectSearch(config);
    });

    // 初始化添加选择器搜索
    SEARCH_CONFIG.selectors.forEach(config => {
        initSelectSearch(config);
    });
}

/**
 * 刷新指定选择器的搜索结果
 * @param {string} selectId - 选择器ID
 */
export function refreshSelectSearch(selectId) {
    // 查找对应的配置
    const allConfigs = [...SEARCH_CONFIG.presets, ...SEARCH_CONFIG.selectors];
    const config = allConfigs.find(c => c.selectId === selectId);

    if (!config) return;

    const searchInput = document.getElementById(config.searchId);
    const select = document.getElementById(config.selectId);

    if (!select) return;

    const keyword = searchInput ? searchInput.value.trim() : '';
    filterSelectOptions(select, config, keyword);
}

/**
 * 清除指定选择器的搜索
 * @param {string} selectId - 选择器ID
 */
export function clearSelectSearch(selectId) {
    const allConfigs = [...SEARCH_CONFIG.presets, ...SEARCH_CONFIG.selectors];
    const config = allConfigs.find(c => c.selectId === selectId);

    if (!config) return;

    const searchInput = document.getElementById(config.searchId);
    if (searchInput) {
        searchInput.value = '';
    }

    refreshSelectSearch(selectId);
}

/**
 * 刷新所有选择器的搜索结果
 */
export function refreshAllSelectSearch() {
    const allConfigs = [...SEARCH_CONFIG.presets, ...SEARCH_CONFIG.selectors];
    allConfigs.forEach(config => {
        const searchInput = document.getElementById(config.searchId);
        const select = document.getElementById(config.selectId);

        if (!select) return;

        const keyword = searchInput ? searchInput.value.trim() : '';
        filterSelectOptions(select, config, keyword);
    });
}
