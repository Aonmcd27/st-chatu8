// @ts-nocheck
/**
 * 生图生涯统计模块
 * 集中记录各后端生图成功/失败次数，持久化到 extension_settings
 */
import { extension_settings } from "../../../../extensions.js";
import { saveSettingsDebounced, eventSource } from "../../../../../script.js";
import { extensionName, EventType } from './config.js';

const KNOWN_BACKENDS = ['sd', 'comfyui', 'banana', 'novelai'];
// 用于去重（部分后端会 emit 两次同一事件）
const processedIds = new Set();

// ==================== 内部工具 ====================

function createDefaultStats() {
    const backends = {};
    for (const b of KNOWN_BACKENDS) {
        backends[b] = { success: 0, fail: 0 };
    }
    return {
        backends,
        total: { success: 0, fail: 0 },
        firstGenTime: null,
        lastGenTime: null,
        daily: {} // { "2025-04-13": { sd: 2, comfyui: 1, ... } }
    };
}

function getStats() {
    if (!extension_settings[extensionName]) return createDefaultStats();
    if (!extension_settings[extensionName].imageGenStats) {
        extension_settings[extensionName].imageGenStats = createDefaultStats();
    }
    const stats = extension_settings[extensionName].imageGenStats;
    // 兼容旧数据：确保 backends 字段存在
    if (!stats.backends) stats.backends = {};
    if (!stats.total) stats.total = { success: 0, fail: 0 };
    if (!stats.daily) stats.daily = {};
    for (const b of KNOWN_BACKENDS) {
        if (!stats.backends[b]) stats.backends[b] = { success: 0, fail: 0 };
    }
    return stats;
}

/**
 * 记录一次生图结果
 */
function recordGeneration(backend, success) {
    const stats = getStats();

    // 确保后端字段存在
    if (!stats.backends[backend]) {
        stats.backends[backend] = { success: 0, fail: 0 };
    }

    if (success) {
        stats.backends[backend].success++;
        stats.total.success++;
    } else {
        stats.backends[backend].fail++;
        stats.total.fail++;
    }

    const now = Date.now();
    stats.lastGenTime = now;
    if (!stats.firstGenTime) {
        stats.firstGenTime = now;
    }

    // 每日统计（仅记录成功）
    if (success) {
        const today = new Date().toISOString().slice(0, 10);
        if (!stats.daily[today]) stats.daily[today] = {};
        stats.daily[today][backend] = (stats.daily[today][backend] || 0) + 1;
    }

    saveSettingsDebounced();
}

// ==================== 事件处理 ====================

function handleImageResponse(_responseData) {
    // 各后端已在生图完成时直接调用 recordImageGeneration()，此处不再重复记录
}

// ==================== 公开 API ====================

/**
 * 直接记录一次生图结果（供各后端直接调用）
 */
export function recordImageGeneration(backend, success) {
    recordGeneration(backend, success);
}

/**
 * 获取当前统计数据（只读快照）
 */
export function getImageGenStats() {
    return getStats();
}

/**
 * 重置所有统计
 */
export function resetImageGenStats() {
    extension_settings[extensionName].imageGenStats = createDefaultStats();
    saveSettingsDebounced();
}

/**
 * 初始化事件监听
 */
export function initImageGenStatsListener() {
    eventSource.on(EventType.GENERATE_IMAGE_RESPONSE, handleImageResponse);
    console.log(`[${extensionName}] 生图生涯统计监听器已初始化`);
}
