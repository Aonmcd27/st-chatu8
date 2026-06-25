// @ts-nocheck
/**
 * personaService.js - 人设数据服务模块
 * 提供人设数据获取、提示词构建等功能，供 AI 集成使用
 */

import { extension_settings } from "../../../../../../extensions.js";
import { extensionName } from '../../config.js';
import { PERSONA_FIELDS, PERSONA_FIELD_LABELS } from './personaPreset.js';

/**
 * 检查人设功能是否启用
 * @returns {boolean}
 */
export function isPersonaEnabled() {
    const profiles = extension_settings[extensionName]?.personaProfiles;
    if (!profiles) return false;
    return profiles.enabled === true && !!profiles.currentPresetId && !!profiles.presets?.[profiles.currentPresetId];
}

/**
 * 获取当前人设数据对象
 * @returns {Object|null} 当前预设的人设数据，或 null
 */
export function getCurrentPersona() {
    const profiles = extension_settings[extensionName]?.personaProfiles;
    if (!profiles || !profiles.currentPresetId) return null;
    return profiles.presets?.[profiles.currentPresetId] || null;
}

/**
 * 获取当前预设名称
 * @returns {string}
 */
export function getCurrentPersonaPresetName() {
    return extension_settings[extensionName]?.personaProfiles?.currentPresetId || '';
}

/**
 * 获取注入模式（固定为常驻注入）
 * @returns {'alwaysOn'}
 */
export function getPersonaInjectionMode() {
    return 'alwaysOn';
}

// ==================== 辅助函数 ====================

/**
 * 从人设数据中构建指定字段的行列表
 * @param {Object} persona - 人设数据对象
 * @param {string[]} fields - 字段名数组
 * @returns {string[]} 非空字段的 "标签: 值" 行数组
 */
function buildFieldLines(persona, fields) {
    const lines = [];
    for (const field of fields) {
        const value = (persona[field] || '').trim();
        if (!value) continue;
        const label = PERSONA_FIELD_LABELS[field] || field;
        lines.push(`${label}: ${value}`);
    }
    return lines;
}

// ==================== 核心构建函数 ====================

/**
 * 获取当前人设的指定字段值
 * @param {string} fieldName - 字段名（如 'name', 'background' 等）
 * @returns {string} 字段值，如果不存在或未启用返回空字符串
 */
export function getPersonaFieldValue(fieldName) {
    if (!isPersonaEnabled()) return '';
    const persona = getCurrentPersona();
    if (!persona) return '';
    return (persona[fieldName] || '').trim();
}

/**
 * 构建人设提示词文本（分类结构化输出）
 * 将当前选中的人设数据格式化为按分类包裹的结构化文本，便于 LLM 理解各字段层次
 * @returns {string} 格式化后的人设文本，若无数据则返回空字符串
 */
export function buildPersonaPromptContent() {
    if (!isPersonaEnabled()) return '';

    const persona = getCurrentPersona();
    if (!persona) return '';

    const sections = [];

    // ★ 基础信息
    const basicFields = ['name', 'age', 'gender', 'race'];
    const basicLines = buildFieldLines(persona, basicFields);
    if (basicLines.length > 0) {
        sections.push(`<基础信息>\n${basicLines.join('\n')}\n</基础信息>`);
    }

    // ★ 外貌与身材
    const appearanceFields = ['bodyType', 'appearance'];
    const appearanceLines = buildFieldLines(persona, appearanceFields);
    if (appearanceLines.length > 0) {
        sections.push(`<外貌与身材>\n${appearanceLines.join('\n')}\n</外貌与身材>`);
    }

    // ★ 性格与能力
    const personalityFields = ['personality', 'abilities', 'speechStyle'];
    const personalityLines = buildFieldLines(persona, personalityFields);
    if (personalityLines.length > 0) {
        sections.push(`<性格与能力>\n${personalityLines.join('\n')}\n</性格与能力>`);
    }

    // ★ 背景故事
    const bgFields = ['background', 'hobbies', 'relationships'];
    const bgLines = buildFieldLines(persona, bgFields);
    if (bgLines.length > 0) {
        sections.push(`<背景故事>\n${bgLines.join('\n')}\n</背景故事>`);
    }

    // ★ 穿越认知（次元穿越相关）
    const isekaiFields = ['isekai_origin', 'isekai_method', 'isekai_reaction', 'isekai_goal'];
    const isekaiLines = buildFieldLines(persona, isekaiFields);
    if (isekaiLines.length > 0) {
        sections.push(`<穿越认知>\n${isekaiLines.join('\n')}\n</穿越认知>`);
    }

    // ★ 补充信息
    const notesValue = (persona.notes || '').trim();
    if (notesValue) {
        sections.push(`<补充信息>\n${notesValue}\n</补充信息>`);
    }

    // 若所有分类都为空，返回空
    if (sections.length === 0) return '';

    return sections.join('\n\n');
}

/**
 * 构建人设摘要（用于按需模式的可查询列表）
 * @returns {string} 摘要文本
 */
export function buildPersonaSummary() {
    const persona = getCurrentPersona();
    if (!persona) return '';

    const name = (persona.name || '').trim();
    const presetName = getCurrentPersonaPresetName();

    const parts = [];
    if (name) parts.push(name);
    if (persona.race) parts.push(persona.race);
    if (persona.gender) parts.push(persona.gender);
    if (persona.age) parts.push(persona.age);

    const summary = parts.length > 0 ? parts.join('，') : presetName;
    return `角色人设「${presetName}」: ${summary}`;
}
