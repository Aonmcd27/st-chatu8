// @ts-nocheck
/**
 * userService.js - User人设数据服务模块
 * 提供 User 人设数据获取、提示词构建等功能，供 AI 集成使用
 * 与 personaService.js 结构一致，但读取 currentUserPresetId / userEnabled / userInjectionMode
 */

import { extension_settings } from "../../../../../../extensions.js";
import { extensionName } from '../../config.js';
import { PERSONA_FIELDS, PERSONA_FIELD_LABELS } from './personaPreset.js';

/**
 * 检查 User 人设功能是否启用
 * @returns {boolean}
 */
export function isUserEnabled() {
    const profiles = extension_settings[extensionName]?.personaProfiles;
    if (!profiles) return false;
    return profiles.userEnabled === true && !!profiles.currentUserPresetId && !!profiles.presets?.[profiles.currentUserPresetId];
}

/**
 * 获取当前 User 人设数据对象
 * @returns {Object|null} 当前预设的 User 人设数据，或 null
 */
export function getCurrentUser() {
    const profiles = extension_settings[extensionName]?.personaProfiles;
    if (!profiles || !profiles.currentUserPresetId) return null;
    return profiles.presets?.[profiles.currentUserPresetId] || null;
}

/**
 * 获取当前 User 预设名称
 * @returns {string}
 */
export function getCurrentUserPresetName() {
    return extension_settings[extensionName]?.personaProfiles?.currentUserPresetId || '';
}

/**
 * 获取 User 注入模式（固定为常驻注入）
 * @returns {'alwaysOn'}
 */
export function getUserInjectionMode() {
    return 'alwaysOn';
}

// ==================== 字段级获取函数 ====================

/**
 * 获取当前 User 人设的指定字段值
 * @param {string} fieldName - 字段名（如 'name', 'gender' 等）
 * @returns {string} 字段值，如果不存在或未启用返回空字符串
 */
export function getUserFieldValue(fieldName) {
    if (!isUserEnabled()) return '';
    const user = getCurrentUser();
    if (!user) return '';
    return (user[fieldName] || '').trim();
}

// ==================== 辅助函数 ====================

/**
 * 从人设数据中构建指定字段的行列表
 * @param {Object} data - 人设数据对象
 * @param {string[]} fields - 字段名数组
 * @returns {string[]} 非空字段的 "标签: 值" 行数组
 */
function buildFieldLines(data, fields) {
    const lines = [];
    for (const field of fields) {
        const value = (data[field] || '').trim();
        if (!value) continue;
        const label = PERSONA_FIELD_LABELS[field] || field;
        lines.push(`${label}: ${value}`);
    }
    return lines;
}

// ==================== 核心构建函数 ====================

/**
 * 构建 User 人设提示词文本（分类结构化输出）
 * 将当前选中的 User 人设数据格式化为按分类包裹的结构化文本，便于 LLM 理解各字段层次
 * @returns {string} 格式化后的 User 人设文本，若无数据则返回空字符串
 */
export function buildUserPromptContent() {
    if (!isUserEnabled()) return '';

    const user = getCurrentUser();
    if (!user) return '';

    const sections = [];

    // ★ 基础信息
    const basicFields = ['name', 'age', 'gender', 'race'];
    const basicLines = buildFieldLines(user, basicFields);
    if (basicLines.length > 0) {
        sections.push(`<基础信息>\n${basicLines.join('\n')}\n</基础信息>`);
    }

    // ★ 外貌与身材
    const appearanceFields = ['bodyType', 'appearance'];
    const appearanceLines = buildFieldLines(user, appearanceFields);
    if (appearanceLines.length > 0) {
        sections.push(`<外貌与身材>\n${appearanceLines.join('\n')}\n</外貌与身材>`);
    }

    // ★ 性格与能力
    const personalityFields = ['personality', 'abilities', 'speechStyle'];
    const personalityLines = buildFieldLines(user, personalityFields);
    if (personalityLines.length > 0) {
        sections.push(`<性格与能力>\n${personalityLines.join('\n')}\n</性格与能力>`);
    }

    // ★ 背景故事
    const bgFields = ['background', 'hobbies', 'relationships'];
    const bgLines = buildFieldLines(user, bgFields);
    if (bgLines.length > 0) {
        sections.push(`<背景故事>\n${bgLines.join('\n')}\n</背景故事>`);
    }

    // ★ 穿越认知（次元穿越相关）
    const isekaiFields = ['isekai_origin', 'isekai_method', 'isekai_reaction', 'isekai_goal'];
    const isekaiLines = buildFieldLines(user, isekaiFields);
    if (isekaiLines.length > 0) {
        sections.push(`<穿越认知>\n${isekaiLines.join('\n')}\n</穿越认知>`);
    }

    // ★ 补充信息
    const notesValue = (user.notes || '').trim();
    if (notesValue) {
        sections.push(`<补充信息>\n${notesValue}\n</补充信息>`);
    }

    // 若所有分类都为空，返回空
    if (sections.length === 0) return '';

    return sections.join('\n\n');
}

/**
 * 构建 User 人设摘要（用于按需模式的可查询列表）
 * @returns {string} 摘要文本
 */
export function buildUserSummary() {
    const user = getCurrentUser();
    if (!user) return '';

    const name = (user.name || '').trim();
    const presetName = getCurrentUserPresetName();

    const parts = [];
    if (name) parts.push(name);
    if (user.race) parts.push(user.race);
    if (user.gender) parts.push(user.gender);
    if (user.age) parts.push(user.age);

    const summary = parts.length > 0 ? parts.join('，') : presetName;
    return `User人设「${presetName}」: ${summary}`;
}
