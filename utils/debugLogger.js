// @ts-nocheck
/**
 * debugLogger.js - 独立的调试日志系统
 * 
 * 功能：
 * - 内存级开关（无持久化）
 * - 性能计时器
 * - 分支追踪
 * - 格式化导出（易读的 TXT 格式）
 * 
 * 与 addLog() 分离，仅用于详细调试
 */

// ==================== 日志存储 ====================

/** @type {Array<{timestamp: number, type: string, functionName: string, message: string, context?: object, duration?: number, elapsed?: number}>} */
let debugLogEntries = [];

/** @type {boolean} 调试模式开关（内存级，默认关闭） */
let debugModeEnabled = false;

/** @type {number|null} 全局会话起始时间戳（用于计算总耗时） */
let globalSessionStartTime = null;

/** @type {string} 当前会话名称 */
let currentSessionName = '';

// ==================== 开关管理 ====================

/**
 * 检查调试模式是否启用
 * @returns {boolean}
 */
export function isDebugEnabled() {
    return debugModeEnabled;
}

/**
 * 切换调试模式
 * @param {boolean} [enabled] 可选，指定开关状态；不传则切换
 * @returns {boolean} 当前状态
 */
export function toggleDebug(enabled) {
    if (typeof enabled === 'boolean') {
        debugModeEnabled = enabled;
    } else {
        debugModeEnabled = !debugModeEnabled;
    }

    if (debugModeEnabled) {
        debugLogEntries.push({
            timestamp: Date.now(),
            type: 'system',
            functionName: 'debugLogger',
            message: '🔧 调试模式已启用'
        });
    }

    return debugModeEnabled;
}

// ==================== 会话管理 ====================

/**
 * 开始新的调试会话（重置全局计时器）
 * 用于追踪从流程开始的总耗时
 * 
 * @param {string} sessionName - 会话名称（如：'正文图片生成'）
 * 
 * @example
 * debugStartSession('正文图片生成');
 */
export function debugStartSession(sessionName) {
    globalSessionStartTime = Date.now();
    currentSessionName = sessionName || '调试会话';

    if (debugModeEnabled) {
        debugLogEntries.push({
            timestamp: globalSessionStartTime,
            type: 'session_start',
            functionName: 'debugLogger',
            message: `🚀 会话开始: ${currentSessionName}`,
            elapsed: 0
        });
    }
}

/**
 * 获取当前会话已耗时（毫秒）
 * @returns {number} 距离会话开始的毫秒数，如果没有会话则返回 0
 */
export function getSessionElapsed() {
    if (!globalSessionStartTime) return 0;
    return Date.now() - globalSessionStartTime;
}

// ==================== 核心日志函数 ====================

/**
 * 记录调试日志
 * 
 * @param {string} functionName - 函数名（建议格式：ModuleName.functionName）
 * @param {string} message - 日志描述
 * @param {object} [context] - 上下文数据（参数、状态等）
 * 
 * @example
 * debugLog('promptReq.handlePromptRequest', '开始处理图片生成请求', { gestureId: 'gesture1' });
 */
export function debugLog(functionName, message, context) {
    if (!debugModeEnabled) return;

    debugLogEntries.push({
        timestamp: Date.now(),
        type: 'log',
        functionName,
        message,
        context,
        elapsed: getSessionElapsed()
    });
}

/**
 * 记录分支进入
 * 
 * @param {string} functionName - 函数名
 * @param {string} branchName - 分支描述
 * @param {boolean} entered - 是否进入该分支
 * @param {object} [conditionDetails] - 条件判断的详细信息（可选）
 * 
 * @example
 * debugBranch('handlePromptRequest', '显示用户需求弹窗', imageGenDemandEnabled, {
 *     条件: 'imageGenDemandEnabled',
 *     值: imageGenDemandEnabled
 * });
 */
export function debugBranch(functionName, branchName, entered, conditionDetails) {
    if (!debugModeEnabled) return;

    const context = { entered: !!entered };
    if (conditionDetails) {
        context.条件详情 = conditionDetails;
    }

    debugLogEntries.push({
        timestamp: Date.now(),
        type: 'branch',
        functionName,
        message: `分支: ${branchName}`,
        context,
        elapsed: getSessionElapsed()
    });
}

// ==================== 性能计时器 ====================

/**
 * 创建性能计时器
 * 
 * @param {string} functionName - 函数名
 * @param {string} [description] - 可选描述
 * @returns {{end: (info?: string) => number}} 返回带有 end() 方法的对象
 * 
 * @example
 * const timer = debugTimer('LLM_IMAGE_GEN');
 * // ... 执行操作 ...
 * timer.end('请求完成');
 */
export function debugTimer(functionName, description) {
    const startTime = Date.now();
    const startElapsed = getSessionElapsed();

    if (debugModeEnabled) {
        debugLogEntries.push({
            timestamp: startTime,
            type: 'timer_start',
            functionName,
            message: description || '⏱️ 开始计时',
            elapsed: startElapsed
        });
    }

    return {
        /**
         * 结束计时并记录耗时
         * @param {string} [info] - 结束时的额外信息
         * @returns {number} 耗时（毫秒）
         */
        end(info) {
            const endTime = Date.now();
            const duration = endTime - startTime;
            const endElapsed = getSessionElapsed();

            if (debugModeEnabled) {
                debugLogEntries.push({
                    timestamp: endTime,
                    type: 'timer_end',
                    functionName,
                    message: info || '⏱️ 计时结束',
                    duration,
                    elapsed: endElapsed
                });
            }

            return duration;
        }
    };
}

// ==================== 日志获取与清空 ====================

/**
 * 获取调试日志数组
 * @returns {Array}
 */
export function getDebugLog() {
    return debugLogEntries;
}

/**
 * 获取调试日志条数
 * @returns {number}
 */
export function getDebugLogCount() {
    return debugLogEntries.length;
}

/**
 * 清空调试日志
 */
export function clearDebugLog() {
    debugLogEntries = [];
}

// ==================== 格式化导出 ====================

/**
 * 导出格式化的调试日志文本（易读格式）
 * @returns {string}
 */
export function exportDebugLog() {
    if (debugLogEntries.length === 0) {
        return '调试日志为空。';
    }

    const lines = [];
    const now = new Date();

    // 计算总耗时
    const firstEntry = debugLogEntries[0];
    const lastEntry = debugLogEntries[debugLogEntries.length - 1];
    const totalDuration = lastEntry.timestamp - firstEntry.timestamp;

    // 头部
    lines.push('========================================');
    lines.push('🔧 调试日志导出');
    lines.push(`生成时间: ${formatTimestamp(now.getTime())}`);
    lines.push(`总条数: ${debugLogEntries.length}`);
    lines.push(`总耗时: ${totalDuration}ms`);
    if (currentSessionName) {
        lines.push(`会话名称: ${currentSessionName}`);
    }
    lines.push('========================================');
    lines.push('');

    // 辅助函数：格式化耗时显示
    const formatElapsed = (elapsed) => {
        if (elapsed === undefined || elapsed === null) return '';
        return ` [+${elapsed}ms]`;
    };

    // 辅助函数：格式化上下文
    const formatContext = (context) => {
        if (!context) return '';
        return JSON.stringify(context, null, 2).split('\n').map((l, i) => i === 0 ? l : '    ' + l).join('\n');
    };

    // 日志条目
    for (const entry of debugLogEntries) {
        const timeStr = formatTimestamp(entry.timestamp);
        const elapsedStr = formatElapsed(entry.elapsed);

        switch (entry.type) {
            case 'session_start':
                lines.push(`[${timeStr}]${elapsedStr} 🚀 ${entry.message}`);
                lines.push('----------------------------------------');
                lines.push('');
                break;

            case 'log':
                lines.push(`[${timeStr}]${elapsedStr} 📝 ${entry.functionName}`);
                lines.push(`  描述: ${entry.message}`);
                if (entry.context) {
                    lines.push(`  上下文: ${formatContext(entry.context)}`);
                }
                lines.push('');
                break;

            case 'branch':
                const symbol = entry.context?.entered ? '✓' : '✗';
                lines.push(`[${timeStr}]${elapsedStr} ⤷ ${entry.message} ${symbol}`);
                if (entry.context?.条件详情) {
                    lines.push(`  条件详情: ${formatContext(entry.context.条件详情)}`);
                }
                lines.push('');
                break;

            case 'timer_start':
                lines.push(`[${timeStr}]${elapsedStr} ⏱️ ${entry.functionName} 开始`);
                if (entry.message && entry.message !== '⏱️ 开始计时') {
                    lines.push(`  描述: ${entry.message}`);
                }
                lines.push('');
                break;

            case 'timer_end':
                lines.push(`[${timeStr}]${elapsedStr} ⏱️ ${entry.functionName} 结束 (耗时: ${entry.duration}ms)`);
                if (entry.message && entry.message !== '⏱️ 计时结束') {
                    lines.push(`  结果: ${entry.message}`);
                }
                lines.push('');
                break;

            case 'content':
                lines.push(`[${timeStr}]${elapsedStr} ${entry.message}`);
                if (entry.context?.内容) {
                    lines.push(`  内容: ${entry.context.内容}`);
                }
                if (entry.context?.原始长度) {
                    lines.push(`  长度: ${entry.context.原始长度} 字符${entry.context.已截断 ? ' (已截断)' : ''}`);
                }
                lines.push('');
                break;

            case 'element':
                lines.push(`[${timeStr}]${elapsedStr} ${entry.message}`);
                if (entry.context) {
                    lines.push(`  元素信息: ${formatContext(entry.context)}`);
                }
                lines.push('');
                break;

            case 'milestone':
                lines.push(`[${timeStr}]${elapsedStr} ${entry.message}`);
                lines.push('');
                break;

            case 'error':
                lines.push(`[${timeStr}]${elapsedStr} ${entry.message}`);
                if (entry.context) {
                    lines.push(`  错误详情: ${formatContext(entry.context)}`);
                }
                lines.push('');
                break;

            case 'system':
                lines.push(`[${timeStr}]${elapsedStr} 🔧 ${entry.message}`);
                lines.push('');
                break;

            default:
                lines.push(`[${timeStr}]${elapsedStr} ${entry.functionName}: ${entry.message}`);
                if (entry.context) {
                    lines.push(`  上下文: ${formatContext(entry.context)}`);
                }
                lines.push('');
        }
    }

    // 尾部
    lines.push('========================================');
    lines.push(`日志结束 - 总耗时: ${totalDuration}ms`);
    lines.push('========================================');

    return lines.join('\n');
}

/**
 * 格式化时间戳为可读字符串
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
    const ms = String(date.getMilliseconds()).padStart(3, '0');

    return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}.${ms}`;
}

// ==================== 便捷函数 ====================

/**
 * 记录错误
 * @param {string} functionName 
 * @param {string} message 
 * @param {Error|object} [error] 
 */
export function debugError(functionName, message, error) {
    if (!debugModeEnabled) return;

    const context = error instanceof Error
        ? { errorName: error.name, errorMessage: error.message }
        : error;

    debugLogEntries.push({
        timestamp: Date.now(),
        type: 'error',
        functionName,
        message: `❌ ${message}`,
        context,
        elapsed: getSessionElapsed()
    });
}

/**
 * 记录重要里程碑
 * @param {string} functionName 
 * @param {string} milestone 
 */
export function debugMilestone(functionName, milestone) {
    if (!debugModeEnabled) return;

    debugLogEntries.push({
        timestamp: Date.now(),
        type: 'milestone',
        functionName,
        message: `🎯 ${milestone}`,
        elapsed: getSessionElapsed()
    });
}

/**
 * 记录文本内容（自动截断超长文本）
 * 用于记录正文、上下文、用户需求等具体文本
 * 
 * @param {string} functionName - 函数名
 * @param {string} label - 内容标签（如：'正文内容'、'用户需求'）
 * @param {string} content - 文本内容
 * @param {number} [maxLength=200] - 最大显示长度，超过则截断
 * 
 * @example
 * debugContent('handlePromptRequest', '正文内容', nowtxt, 300);
 */
export function debugContent(functionName, label, content, maxLength = 200) {
    if (!debugModeEnabled) return;

    const contentStr = String(content || '');
    const truncated = contentStr.length > maxLength;
    const displayContent = truncated
        ? contentStr.substring(0, maxLength) + `... [截断，原长度: ${contentStr.length}]`
        : contentStr;

    debugLogEntries.push({
        timestamp: Date.now(),
        type: 'content',
        functionName,
        message: `📝 ${label}`,
        context: {
            内容: displayContent,
            原始长度: contentStr.length,
            已截断: truncated
        },
        elapsed: getSessionElapsed()
    });
}

/**
 * 记录 DOM 元素关键信息
 * 用于记录触发元素、目标元素等的关键属性
 * 
 * @param {string} functionName - 函数名
 * @param {string} label - 标签（如：'触发元素'、'目标 mes_text'）
 * @param {HTMLElement} element - DOM 元素
 * 
 * @example
 * debugElement('handleDoubleClick', '触发元素', targetElement);
 */
export function debugElement(functionName, label, element) {
    if (!debugModeEnabled) return;

    if (!element) {
        debugLogEntries.push({
            timestamp: Date.now(),
            type: 'element',
            functionName,
            message: `🔲 ${label}: null/undefined`,
            context: { 元素: null },
            elapsed: getSessionElapsed()
        });
        return;
    }

    // 提取元素关键信息
    const elementInfo = {
        标签名: element.tagName,
        类名: element.className || '(无)',
        ID: element.id || '(无)',
        mesId: element.getAttribute?.('mesid') || element.closest?.('.mes')?.getAttribute?.('mesid') || '(无)',
        文本预览: (element.textContent || '').substring(0, 50) + (element.textContent?.length > 50 ? '...' : ''),
        文本长度: element.textContent?.length || 0,
        是否为mes_text: element.classList?.contains?.('mes_text') || false,
        在iframe中: element.ownerDocument !== document
    };

    debugLogEntries.push({
        timestamp: Date.now(),
        type: 'element',
        functionName,
        message: `🔲 ${label}`,
        context: elementInfo,
        elapsed: getSessionElapsed()
    });
}
