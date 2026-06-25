// @ts-nocheck
/**
 * knowledgeBase/index.js - 人设模块入口
 * 整合人设子模块，提供统一的初始化和刷新接口
 */

import { setupPersonaControls, loadPersonaPresetList, loadPersonaPresetData } from './personaPreset.js';
import { setupPersonaGen } from './personaGen.js';
import { setupUserControls, loadUserPresetList, loadUserPresetData } from './userPreset.js';

let _initialized = false;
let _userInitialized = false;

/**
 * 初始化人设设置模块（仅执行一次）
 * @param {jQuery} container - 设置面板的 jQuery 对象
 */
export function initPersonaSettings(container) {
    if (_initialized) return;
    _initialized = true;

    setupPersonaControls(container);
    setupPersonaGen();
    console.log('[KnowledgeBase/Persona] 人设模块已初始化');
}

/**
 * 刷新人设设置 UI（每次切换到人设标签页时可调用）
 */
export function refreshPersonaSettings() {
    if (!_initialized) return;
    loadPersonaPresetList();
    loadPersonaPresetData();
}

/**
 * 初始化 User 人设设置模块（仅执行一次）
 * @param {jQuery} container - 设置面板的 jQuery 对象
 */
export function initUserSettings(container) {
    if (_userInitialized) return;
    _userInitialized = true;

    setupUserControls(container);
    console.log('[KnowledgeBase/User] User人设模块已初始化');
}

/**
 * 刷新 User 人设设置 UI（每次切换到 user 标签页时可调用）
 */
export function refreshUserSettings() {
    if (!_userInitialized) return;
    loadUserPresetList();
    loadUserPresetData();
}

// 重新导出服务层接口，供外部模块使用
export {
    isPersonaEnabled,
    getCurrentPersona,
    getCurrentPersonaPresetName,
    getPersonaInjectionMode,
    buildPersonaPromptContent,
    buildPersonaSummary,
    getPersonaFieldValue
} from './personaService.js';

export {
    isUserEnabled,
    getCurrentUser,
    getCurrentUserPresetName,
    getUserInjectionMode,
    buildUserPromptContent,
    buildUserSummary,
    getUserFieldValue
} from './userService.js';
