/* eslint-disable no-undef */
// @ts-nocheck

// ==================== 正则 AI 桥接函数 ====================

/**
 * 获取正则测试区域的当前状态（通过 window.regexAIBridge 调用）
 * @returns {string} 格式化的状态文本
 */
export function getRegexStatus() {
    if (!window.regexAIBridge) {
        return '❌ 正则模块尚未加载，请先切换到正则页面。';
    }
    try {
        const status = window.regexAIBridge.getStatus();
        let result = '📋 正则测试区域状态:\n';
        result += `- 测试模式: ${status.testMode ? '✅ 已开启' : '❌ 未开启'}\n`;
        result += `- 当前配置: ${status.currentProfile || '(无)'}\n`;
        result += `- 手势功能: ${status.gestureEnabled ? '✅ 已开启' : '❌ 未开启'}\n`;
        result += `- 点击触发: ${status.clickTriggerEnabled ? '✅ 已开启' : '❌ 未开启'}\n`;
        result += `- 前后正则: ${status.beforeAfterRegex}\n`;
        result += `- 文字正则: ${status.textRegex}\n`;
        result += `- 原文: ${status.originalText}\n`;
        result += `- 正则后文本: ${status.resultText}\n`;
        result += `- 正则条目 (${status.entryCount}个):\n`;
        if (status.regexEntries.length > 0) {
            status.regexEntries.forEach(e => {
                const flag = e.disabled ? '[禁用]' : '[启用]';
                result += `  ${e.index}. ${flag} ${e.name} | 查找: ${e.findRegex} | 替换: ${e.replaceString}\n`;
            });
        } else {
            result += '  (暂无条目)\n';
        }
        return result;
    } catch (e) {
        return `❌ 获取正则状态失败: ${e.message}`;
    }
}

/**
 * AI 设置正则原文
 * @param {string} text
 * @returns {string}
 */
export function setRegexOriginalText(text) {
    if (!window.regexAIBridge) return '❌ 正则模块未加载。';
    return window.regexAIBridge.setOriginalText(text);
}

/**
 * AI 设置前后正则和文字正则
 * @param {string} beforeAfter
 * @param {string} textRegex
 * @returns {string}
 */
export function setRegexEditors(beforeAfter, textRegex) {
    if (!window.regexAIBridge) return '❌ 正则模块未加载。';
    return window.regexAIBridge.setEditors(beforeAfter, textRegex);
}

/**
 * AI 创建正则条目
 * @param {object} data - {scriptName, findRegex, replaceString, disabled}
 * @returns {string}
 */
export function createRegexEntry(data) {
    if (!window.regexAIBridge) return '❌ 正则模块未加载。';
    return window.regexAIBridge.createEntry(data);
}

/**
 * AI 触发正则测试
 * @returns {Promise<string>}
 */
export async function triggerRegexTest() {
    if (!window.regexAIBridge) return '❌ 正则模块未加载。';
    return await window.regexAIBridge.triggerTest();
}

/**
 * AI 开关正则测试模式
 * @param {boolean} enabled
 * @returns {string}
 */
export function setRegexTestMode(enabled) {
    if (!window.regexAIBridge) return '❌ 正则模块未加载。';
    return window.regexAIBridge.setTestMode(enabled);
}

/**
 * AI 获取正则测试结果
 * @returns {string}
 */
export function getRegexResultText() {
    if (!window.regexAIBridge) return '❌ 正则模块未加载。';
    return window.regexAIBridge.getResultText();
}

/**
 * AI 开关手势功能
 * @param {boolean} enabled
 * @returns {string}
 */
export function setGestureEnabled(enabled) {
    if (!window.regexAIBridge) return '❌ 正则模块未加载。';
    return window.regexAIBridge.setGestureEnabled(enabled);
}

/**
 * AI 开关点击触发功能
 * @param {boolean} enabled
 * @returns {string}
 */
export function setClickTriggerEnabled(enabled) {
    if (!window.regexAIBridge) return '❌ 正则模块未加载。';
    return window.regexAIBridge.setClickTriggerEnabled(enabled);
}

/**
 * AI 清除所有正则条目
 * @returns {string}
 */
export function clearAllRegexEntries() {
    if (!window.regexAIBridge) return '❌ 正则模块未加载。';
    return window.regexAIBridge.clearAllEntries();
}
