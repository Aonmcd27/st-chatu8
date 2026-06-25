// @ts-nocheck
/**
 * 角色设置模块入口文件
 * 整合所有角色相关子模块并导出主要函数供 ui.js 调用
 */

import { extension_settings } from "../../../../../../extensions.js";
import { extensionName } from '../../config.js';
import { defaultCharacterSettings } from '../../character_config.js';

// 导入所有子模块
import { setupCharacterControls, loadCharacterPresetList, loadCharacterPreset } from './characterPreset.js';
import { setupOutfitControls, loadOutfitPresetList, loadOutfitPreset } from './outfitPreset.js';
import { setupCharacterEnableControls, loadCharacterEnablePresetList, loadCharacterEnablePreset, loadCharacterSelector } from './characterEnable.js';
import { setupOutfitEnableControls, loadOutfitEnablePresetList, loadOutfitEnablePreset, loadOutfitEnableSelector } from './outfitEnable.js';
import { setupCharacterCommonControls, loadCharacterCommonPresetList, loadCharacterCommonPreset, loadCharacterCommonSelector } from './characterCommon.js';
import { setupBananaCharacterControls, loadBananaCharacterPresetList, loadBananaCharacterPreset } from './bananaCharacter.js';
import { initTagAutocomplete } from './tagAutocomplete.js';
import { initAllSelectSearch, refreshAllSelectSearch } from './selectSearch.js';

// 用于跟踪是否已经初始化
let isCharacterInitialized = false;

// ========== 主要导出函数 ==========

/**
 * 初始化角色设置(仅绑定事件,只执行一次)
 * 由 ui.js 在初始化时调用
 */
export function initCharacterSettings(container) {
    console.log('[Character] Initializing character settings...');

    // 确保配置存在
    ensureCharacterSettings();

    // 只在第一次初始化时绑定事件
    if (!isCharacterInitialized) {
        // 绑定子导航切换
        setupSubNavigation(container);

        // 绑定角色设定功能
        setupCharacterControls(container);

        // 绑定服装管理功能
        setupOutfitControls(container);

        // 绑定角色启用管理功能
        setupCharacterEnableControls(container);

        // 绑定通用服装列表管理功能
        setupOutfitEnableControls(container);

        // 绑定通用角色列表管理功能
        setupCharacterCommonControls(container);

        // 绑定 Banana 角色管理功能
        setupBananaCharacterControls(container);

        // 初始化tag自动补全(只执行一次)
        initTagAutocomplete();

        // 初始化选择器搜索功能
        initAllSelectSearch(container);

        isCharacterInitialized = true;
    }

    console.log('[Character] Character settings initialized');
}

/**
 * 刷新角色设置UI（每次进入标签页时调用）
 * 由 ui.js 在标签页激活时调用
 */
export function refreshCharacterSettings(container) {
    console.log('[Character] Refreshing character settings...');

    // 确保配置存在
    ensureCharacterSettings();

    // 刷新角色预设
    loadCharacterPresetList();
    loadCharacterPreset();

    // 刷新服装预设
    loadOutfitPresetList();
    loadOutfitPreset();

    // 刷新角色启用管理
    loadCharacterEnablePresetList();
    loadCharacterEnablePreset();
    loadCharacterSelector();

    // 刷新通用服装列表
    loadOutfitEnablePresetList();
    loadOutfitEnablePreset();
    loadOutfitEnableSelector();

    // 刷新通用角色列表
    loadCharacterCommonPresetList();
    loadCharacterCommonPreset();
    loadCharacterCommonSelector();

    // 刷新 Banana 角色管理
    loadBananaCharacterPresetList();
    loadBananaCharacterPreset();

    // 刷新所有选择器搜索
    refreshAllSelectSearch();

    // 重置子导航到第一个标签
    resetSubNavigation(container);

    console.log('[Character] Character settings refreshed');
}

// ========== 内部辅助函数 ==========

/**
 * 确保配置存在
 */
function ensureCharacterSettings() {
    const settings = extension_settings[extensionName];

    // 初始化角色预设
    if (!settings.characterPresets) {
        settings.characterPresets = JSON.parse(JSON.stringify(defaultCharacterSettings.characterPresets));
    }
    if (!settings.characterPresetId) {
        settings.characterPresetId = defaultCharacterSettings.characterPresetId;
    }

    // 初始化服装预设
    if (!settings.outfitPresets) {
        settings.outfitPresets = JSON.parse(JSON.stringify(defaultCharacterSettings.outfitPresets));
    }
    if (!settings.outfitPresetId) {
        settings.outfitPresetId = defaultCharacterSettings.outfitPresetId;
    }

    // 初始化 AI 设置
    if (!settings.characterAI) {
        settings.characterAI = JSON.parse(JSON.stringify(defaultCharacterSettings.characterAI));
    }
    if (!settings.outfitAI) {
        settings.outfitAI = JSON.parse(JSON.stringify(defaultCharacterSettings.outfitAI));
    }

    // 初始化角色启用预设
    if (!settings.characterEnablePresets) {
        settings.characterEnablePresets = JSON.parse(JSON.stringify(defaultCharacterSettings.characterEnablePresets));
    }
    if (!settings.characterEnablePresetId) {
        settings.characterEnablePresetId = defaultCharacterSettings.characterEnablePresetId;
    }

    // 初始化通用服装列表预设
    if (!settings.outfitEnablePresets) {
        settings.outfitEnablePresets = JSON.parse(JSON.stringify(defaultCharacterSettings.outfitEnablePresets));
    }
    if (!settings.outfitEnablePresetId) {
        settings.outfitEnablePresetId = defaultCharacterSettings.outfitEnablePresetId;
    }

    // 初始化通用角色列表预设
    if (!settings.characterCommonPresets) {
        settings.characterCommonPresets = JSON.parse(JSON.stringify(defaultCharacterSettings.characterCommonPresets));
    }
    if (!settings.characterCommonPresetId) {
        settings.characterCommonPresetId = defaultCharacterSettings.characterCommonPresetId;
    }

    // 初始化 Banana 角色预设
    if (!settings.bananaCharacterPresets) {
        settings.bananaCharacterPresets = {
            "默认": {
                triggers: "触发词1|触发词2",
                conversation: {
                    user: { text: '', image: '' },
                    model: { text: '', image: '' }
                }
            }
        };
    }
    if (!settings.bananaCharacterPresetId) {
        settings.bananaCharacterPresetId = '默认';
    }
}

/**
 * 设置子导航
 */
function setupSubNavigation(container) {
    // 绑定点击事件（使用 .off() 防止重复绑定）
    container.find('.st-chatu8-sub-nav-link').off('click').on('click', function (e) {
        e.preventDefault();
        const subTabId = $(this).data('sub-tab');

        // 更新激活状态（只在当前容器内）
        container.find('.st-chatu8-sub-nav-link').removeClass('active');
        $(this).addClass('active');

        // 显示/隐藏内容 - 使用 CSS 样式控制
        container.find('.st-chatu8-sub-tab-content').css('display', 'none');
        container.find(`#${subTabId}`).css('display', 'block');
    });

    // 初始化：重置并显示第一个子标签页
    const allSubNavLinks = container.find('.st-chatu8-sub-nav-link');
    const firstLink = allSubNavLinks.first();

    if (firstLink.length > 0) {
        // 重置所有链接的激活状态
        allSubNavLinks.removeClass('active');
        firstLink.addClass('active');

        // 隐藏所有子标签内容，然后显示第一个
        const firstSubTabId = firstLink.data('sub-tab');
        container.find('.st-chatu8-sub-tab-content').css('display', 'none');
        container.find(`#${firstSubTabId}`).css('display', 'block');
    }
}

/**
 * 重置子导航状态（不重新绑定事件）
 */
function resetSubNavigation(container) {
    const allSubNavLinks = container.find('.st-chatu8-sub-nav-link');
    const firstLink = allSubNavLinks.first();

    if (firstLink.length > 0) {
        // 重置所有链接的激活状态
        allSubNavLinks.removeClass('active');
        firstLink.addClass('active');

        // 隐藏所有子标签内容，然后显示第一个
        const firstSubTabId = firstLink.data('sub-tab');
        container.find('.st-chatu8-sub-tab-content').css('display', 'none');
        container.find(`#${firstSubTabId}`).css('display', 'block');
    }
}

// ========== 导出子模块供外部调用 ==========

// 重新导出加密模块给其他可能需要的模块
export * from './crypto.js';

// 重新导出预设列表加载函数供其他模块调用
export {
    loadCharacterPresetList,
    loadCharacterPreset,
    loadOutfitPresetList,
    loadOutfitPreset,
    loadCharacterEnablePresetList,
    loadCharacterEnablePreset,
    loadCharacterSelector,
    loadOutfitEnablePresetList,
    loadOutfitEnablePreset,
    loadOutfitEnableSelector,
    loadCharacterCommonPresetList,
    loadCharacterCommonPreset,
    loadCharacterCommonSelector,
    loadBananaCharacterPresetList,
    loadBananaCharacterPreset
};
