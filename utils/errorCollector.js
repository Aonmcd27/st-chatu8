// @ts-nocheck
/**
 * errorCollector.js - 插件错误收集系统
 * 
 * 功能：
 * - 捕获并记录插件运行时错误
 * - 提供错误历史查询
 * - 支持错误统计和分析
 * - 独立于普通日志系统，不受日志清除影响
 */

import { extensionFolderPath, extensionName } from './config.js';
import { exportLogsWithHistory } from './utils.js';

// ==================== 错误存储 ====================

/** @type {Array<{timestamp: number, type: string, message: string, stack?: string, context?: object}>} */
let errorEntries = [];

/** @type {number} 最大错误记录数（防止内存溢出） */
const MAX_ERROR_ENTRIES = 500;
const ERROR_DEDUPE_WINDOW_MS = 15000;
const PLUGIN_MARKERS = [
    extensionName.toLowerCase(),
    extensionFolderPath.toLowerCase(),
    `/scripts/extensions/third-party/${extensionName}`.toLowerCase(),
    `scripts/extensions/third-party/${extensionName}`.toLowerCase()
];

function toSafeString(value) {
    if (value == null) return '';
    return String(value);
}

function containsPluginMarker(value) {
    const text = toSafeString(value).toLowerCase();
    return PLUGIN_MARKERS.some(marker => text.includes(marker));
}

function extractErrorDetails(error) {
    const details = {};

    if (error instanceof Error) {
        details.stack = error.stack;
        details.errorName = error.name;
        details.errorMessage = error.message;
        return details;
    }

    if (!error || typeof error !== 'object') {
        return details;
    }

    details.context = error;

    if (typeof error.stack === 'string') details.stack = error.stack;
    if (typeof error.name === 'string') details.errorName = error.name;
    if (typeof error.message === 'string') details.errorMessage = error.message;
    if (typeof error.source === 'string') details.source = error.source;
    if (Number.isFinite(error.lineno)) details.lineno = error.lineno;
    if (Number.isFinite(error.colno)) details.colno = error.colno;

    if (error.error instanceof Error) {
        if (!details.stack) details.stack = error.error.stack;
        if (!details.errorName) details.errorName = error.error.name;
        if (!details.errorMessage) details.errorMessage = error.error.message;
    }

    return details;
}

function inferSourceScope(type, details) {
    if (type === 'api' || type === 'validation' || type === 'config' || type === 'runtime') {
        return 'plugin';
    }

    const candidates = [
        details.source,
        details.stack,
        details.errorMessage,
        details.context?.message,
        details.context?.title,
        details.context?.source
    ];

    if (candidates.some(containsPluginMarker)) {
        return 'plugin';
    }

    if (details.source || details.stack) {
        return 'external';
    }

    return 'unknown';
}

function getEntrySignature(type, message, details) {
    const stackLine = toSafeString(details.stack).split('\n').map(line => line.trim()).find(Boolean) || '';
    return [
        toSafeString(type),
        toSafeString(message),
        toSafeString(details.source),
        toSafeString(details.lineno),
        toSafeString(details.colno),
        toSafeString(details.errorMessage),
        stackLine
    ].join('|');
}

function mergeEntry(target, details, timestamp) {
    target.timestamp = timestamp;
    target.lastSeen = timestamp;
    target.count = (target.count || 1) + 1;
    if (!target.stack && details.stack) target.stack = details.stack;
    if (!target.errorName && details.errorName) target.errorName = details.errorName;
    if (!target.errorMessage && details.errorMessage) target.errorMessage = details.errorMessage;
    if (!target.source && details.source) target.source = details.source;
    if (target.lineno == null && details.lineno != null) target.lineno = details.lineno;
    if (target.colno == null && details.colno != null) target.colno = details.colno;
    if (!target.context && details.context) target.context = details.context;
}

// ==================== 错误捕获 ====================

/**
 * 记录错误
 * @param {string} type - 错误类型（如：'runtime', 'api', 'validation'）
 * @param {string} message - 错误消息
 * @param {Error|object} [error] - 错误对象或上下文信息
 */
export function collectError(type, message, error) {
    const timestamp = Date.now();
    const details = extractErrorDetails(error);
    const signature = getEntrySignature(type, message, details);
    const sourceScope = inferSourceScope(type, details);

    for (let i = errorEntries.length - 1; i >= 0; i--) {
        const existing = errorEntries[i];
        if (existing.signature === signature && (timestamp - (existing.lastSeen || existing.timestamp)) <= ERROR_DEDUPE_WINDOW_MS) {
            mergeEntry(existing, details, timestamp);
            console.error(`[${extensionName}] ${type}: ${message}`, error);
            return;
        }
    }

    const entry = {
        timestamp,
        firstSeen: timestamp,
        lastSeen: timestamp,
        type: type || 'unknown',
        message: message || '未知错误',
        count: 1,
        sourceScope,
        signature
    };

    if (details.stack) entry.stack = details.stack;
    if (details.errorName) entry.errorName = details.errorName;
    if (details.errorMessage) entry.errorMessage = details.errorMessage;
    if (details.context) entry.context = details.context;
    if (details.source) entry.source = details.source;
    if (details.lineno != null) entry.lineno = details.lineno;
    if (details.colno != null) entry.colno = details.colno;

    errorEntries.push(entry);

    // 限制数组大小
    if (errorEntries.length > MAX_ERROR_ENTRIES) {
        errorEntries.shift();
    }

    // 同时输出到控制台
    console.error(`[${extensionName}] ${type}: ${message}`, error);
}

/**
 * 包装函数以自动捕获错误
 * @param {Function} fn - 要包装的函数
 * @param {string} functionName - 函数名称（用于错误上下文）
 * @returns {Function} 包装后的函数
 */
export function wrapWithErrorHandler(fn, functionName) {
    return async function (...args) {
        try {
            return await fn.apply(this, args);
        } catch (error) {
            collectError('runtime', `函数 ${functionName} 执行失败`, error);
            throw error; // 重新抛出以保持原有错误处理流程
        }
    };
}

// ==================== 全局错误监听 ====================

let globalErrorHandlerInstalled = false;

/**
 * 安装全局错误处理器
 */
export function installGlobalErrorHandler() {
    if (globalErrorHandlerInstalled) return;

    // 捕获未处理的 Promise 拒绝
    window.addEventListener('unhandledrejection', (event) => {
        try {
            collectError('unhandled_promise', '未处理的 Promise 拒绝', event.reason);
        } catch (e) {
            // 静默失败
        }
    });

    // 捕获全局错误
    const originalErrorHandler = window.onerror;
    window.onerror = function (message, source, lineno, colno, error) {
        try {
            collectError('global', `全局错误: ${message}`, {
                source,
                lineno,
                colno,
                error
            });
        } catch (e) {
            // 静默失败，避免循环
        }

        if (originalErrorHandler) {
            return originalErrorHandler.apply(this, arguments);
        }
        return false;
    };

    // 注意：不拦截 console.error，避免性能问题和循环

    // 拦截 alert（捕获错误提示）
    const originalAlert = window.alert;
    window.alert = function (message) {
        try {
            const msgStr = String(message || '');

            // 检测是否为错误提示（包含"失败"、"错误"、"Error"等关键词）
            const isError = /失败|错误|Error|Failed|异常|Exception|无法|不能|问题/i.test(msgStr);

            if (isError) {
                collectError('alert', 'Alert 错误提示', { message: msgStr });
            }
        } catch (e) {
            // 静默失败，确保 alert 正常工作
        }

        // 调用原始 alert
        return originalAlert.call(window, message);
    };

    // 拦截 toastr.error（如果存在）
    if (window.toastr && typeof window.toastr.error === 'function') {
        const originalToastrError = window.toastr.error;
        window.toastr.error = function (message, title, options) {
            try {
                collectError('toastr', title || 'Toastr 错误', {
                    message: String(message || ''),
                    title: String(title || '')
                });
            } catch (e) {
                // 静默失败
            }
            return originalToastrError.call(window.toastr, message, title, options);
        };
    }

    globalErrorHandlerInstalled = true;
    console.log(`[${extensionName}] 全局错误处理器已安装`);
}

// ==================== 错误查询 ====================

/**
 * 获取所有错误记录
 * @returns {Array} 错误记录数组
 */
export function getAllErrors() {
    return [...errorEntries];
}

/**
 * 获取最近的错误记录
 * @param {number} count - 要获取的错误数量
 * @returns {Array} 错误记录数组
 */
export function getRecentErrors(count = 10) {
    return errorEntries.slice(-count);
}

/**
 * 按类型获取错误
 * @param {string} type - 错误类型
 * @returns {Array} 错误记录数组
 */
export function getErrorsByType(type) {
    return errorEntries.filter(e => e.type === type);
}

/**
 * 获取错误统计
 * @returns {object} 错误统计信息
 */
export function getErrorStats() {
    const stats = {
        total: 0,
        unique: errorEntries.length,
        byType: {},
        byScope: {},
        recent24h: 0,
        recentHour: 0
    };

    const now = Date.now();
    const hour = 60 * 60 * 1000;
    const day = 24 * hour;

    for (const entry of errorEntries) {
        const count = entry.count || 1;
        stats.total += count;

        // 按类型统计
        stats.byType[entry.type] = (stats.byType[entry.type] || 0) + count;
        stats.byScope[entry.sourceScope || 'unknown'] = (stats.byScope[entry.sourceScope || 'unknown'] || 0) + count;

        // 时间范围统计
        const age = now - (entry.lastSeen || entry.timestamp);
        if (age < hour) stats.recentHour += count;
        if (age < day) stats.recent24h += count;
    }

    return stats;
}

/**
 * 清空错误记录
 */
export function clearErrors() {
    errorEntries = [];
    console.log(`[${extensionName}] 错误记录已清空`);
}

/**
 * 导出错误日志为文本
 * @returns {string} 格式化的错误日志
 */
export async function exportErrors() {
    if (errorEntries.length === 0) {
        return '暂无错误记录。';
    }

    const lines = [];
    const now = new Date();
    const logExport = await exportLogsWithHistory();
    const stats = getErrorStats();

    // 头部
    lines.push('========================================');
    lines.push('🚨 错误与日志诊断导出');
    lines.push(`生成时间: ${formatTimestamp(now.getTime())}`);
    lines.push(`总错误数: ${stats.total}`);
    lines.push(`去重后记录数: ${stats.unique}`);
    lines.push('========================================');
    lines.push('');
    lines.push('【说明】');
    lines.push('以下错误记录来自浏览器全局监听，可能来自 SillyTavern 主程序、其他插件、页面脚本或本插件本身。');
    lines.push('请结合本文件后附的运行日志一起判断问题来源。');
    lines.push('');

    // 统计信息
    lines.push('【错误统计】');
    lines.push(`最近 1 小时: ${stats.recentHour} 个错误`);
    lines.push(`最近 24 小时: ${stats.recent24h} 个错误`);
    lines.push('按类型分布:');
    for (const [type, count] of Object.entries(stats.byType)) {
        lines.push(`  - ${type}: ${count}`);
    }
    if (Object.keys(stats.byScope).length > 0) {
        lines.push('按来源分布:');
        for (const [scope, count] of Object.entries(stats.byScope)) {
            lines.push(`  - ${scope}: ${count}`);
        }
    }
    lines.push('');
    lines.push('========================================');
    lines.push('');

    // 错误详情
    for (const entry of errorEntries) {
        const timeStr = formatTimestamp(entry.lastSeen || entry.timestamp);
        lines.push(`[${timeStr}] ❌ ${entry.type.toUpperCase()} (${entry.sourceScope || 'unknown'})`);
        lines.push(`  消息: ${entry.message}`);
        lines.push(`  次数: ${entry.count || 1}`);
        lines.push(`  首次出现: ${formatTimestamp(entry.firstSeen || entry.timestamp)}`);
        lines.push(`  最近出现: ${formatTimestamp(entry.lastSeen || entry.timestamp)}`);

        if (entry.errorName) {
            lines.push(`  错误名: ${entry.errorName}`);
        }
        if (entry.errorMessage) {
            lines.push(`  错误详情: ${entry.errorMessage}`);
        }
        if (entry.source) {
            lines.push(`  文件: ${entry.source}`);
        }
        if (entry.lineno != null || entry.colno != null) {
            lines.push(`  位置: ${entry.lineno ?? '?'}:${entry.colno ?? '?'}`);
        }
        if (entry.stack) {
            lines.push(`  堆栈:`);
            const stackLines = entry.stack.split('\n').slice(0, 5); // 只显示前5行
            stackLines.forEach(line => lines.push(`    ${line}`));
        }
        if (entry.context) {
            lines.push(`  上下文: ${JSON.stringify(entry.context, null, 2)}`);
        }

        lines.push('');
    }

    lines.push('========================================');
    lines.push('');
    lines.push('【运行日志（当前会话 + 最近 24 小时历史会话）】');
    if (logExport && logExport.trim() !== '') {
        lines.push(logExport.trimEnd());
    } else {
        lines.push('当前与历史运行日志均为空。');
    }
    lines.push('');

    // 尾部
    lines.push('========================================');
    lines.push(`错误日志结束 - 共 ${stats.total} 个错误，去重后 ${stats.unique} 条记录`);
    lines.push('========================================');

    return lines.join('\n');
}

/**
 * 格式化时间戳
 * @param {number} timestamp 
 * @returns {string}
 */
function formatTimestamp(timestamp) {
    const date = new Date(timestamp);
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    const seconds = String(date.getSeconds()).padStart(2, '0');

    return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
}

// ==================== 便捷函数 ====================

/**
 * 记录 API 错误
 * @param {string} apiName - API 名称
 * @param {Error|object} error - 错误对象
 */
export function collectApiError(apiName, error) {
    collectError('api', `API 调用失败: ${apiName}`, error);
}

/**
 * 记录验证错误
 * @param {string} field - 字段名
 * @param {string} reason - 错误原因
 */
export function collectValidationError(field, reason) {
    collectError('validation', `验证失败: ${field}`, { reason });
}

/**
 * 记录配置错误
 * @param {string} configKey - 配置键
 * @param {string} reason - 错误原因
 */
export function collectConfigError(configKey, reason) {
    collectError('config', `配置错误: ${configKey}`, { reason });
}
