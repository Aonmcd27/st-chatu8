/**
 * assistantUtils.js
 * 
 * 通用工具函数：throttle、debounce、marked.js 动态加载、
 * HTML 转义、Markdown 渲染、思考面板渲染等。
 * 
 * 这些函数不依赖 DOM 引用，可以被任何子模块安全导入。
 */

import { markedLoaded, markedLoadPromise, setMarkedLoaded, setMarkedLoadPromise } from './assistantContext.js';
import { getAssistantDisplayName } from './assistantAvatar.js';

function getMarkedInstance() {
    return window.stChatu8Marked || window.marked;
}

async function loadMarkedIsolated(scriptSrc) {
    const response = await fetch(scriptSrc, { cache: 'no-cache' });
    if (!response.ok) {
        throw new Error(`[AI Assistant] Failed to fetch marked.js: ${response.status} ${response.statusText}`);
    }

    const source = await response.text();
    const isolatedGlobal = {};
    isolatedGlobal.window = isolatedGlobal;
    isolatedGlobal.global = isolatedGlobal;
    isolatedGlobal.self = isolatedGlobal;
    isolatedGlobal.globalThis = isolatedGlobal;

    const isolatedLoader = new Function(
        'window',
        'global',
        'self',
        'globalThis',
        'define',
        'module',
        'exports',
        `${source}\nreturn this.marked || window.marked || globalThis.marked || self.marked || global.marked;`,
    );

    const markedInstance = isolatedLoader.call(
        isolatedGlobal,
        isolatedGlobal,
        isolatedGlobal,
        isolatedGlobal,
        isolatedGlobal,
        undefined,
        undefined,
        undefined,
    );

    if (!markedInstance) {
        throw new Error('[AI Assistant] Isolated marked.js evaluation completed but no library was returned');
    }

    return markedInstance;
}

// ═══════════════════════════════════════════════════════════
//  Marked.js 动态加载
// ═══════════════════════════════════════════════════════════

/**
 * 动态加载 marked.js 用于 Markdown 渲染
 * @returns {Promise<void>}
 */
export function loadMarked() {
    if (markedLoaded && getMarkedInstance()) return Promise.resolve();
    if (markedLoadPromise) return markedLoadPromise;

    const existingMarked = getMarkedInstance();
    if (existingMarked) {
        existingMarked.setOptions?.({
            breaks: true,
            gfm: true,
        });
        setMarkedLoaded(true);
        return Promise.resolve();
    }

    const promise = loadMarkedIsolated('https://cdn.jsdelivr.net/npm/marked@11.1.1/marked.min.js')
        .then(markedInstance => {
            window.stChatu8Marked = markedInstance;
            if (!window.marked) {
                window.marked = markedInstance;
            }
            markedInstance.setOptions?.({
                breaks: true,
                gfm: true,
            });
            setMarkedLoaded(true);
        })
        .catch(error => {
            setMarkedLoaded(false);
            setMarkedLoadPromise(null);
            console.warn('[AI Assistant] 加载 marked.js 失败，将使用纯文本显示');
            console.warn('[AI Assistant] marked.js isolated load error', error);
            throw error;
        });

    setMarkedLoadPromise(promise);
    return promise;
}

// ═══════════════════════════════════════════════════════════
//  性能优化工具函数
// ═══════════════════════════════════════════════════════════

/**
 * 创建节流函数（throttle），在指定时间间隔内最多执行一次
 * trailing: true 确保最后一次调用也会被执行
 * @param {Function} fn - 要节流的函数
 * @param {number} delay - 节流间隔（毫秒）
 * @returns {Function} 节流后的函数
 */
export function createThrottle(fn, delay) {
    let lastCall = 0;
    let timer = null;
    let lastArgs = null;

    function throttled(...args) {
        lastArgs = args;
        const now = Date.now();
        const remaining = delay - (now - lastCall);

        if (remaining <= 0) {
            if (timer) {
                clearTimeout(timer);
                timer = null;
            }
            lastCall = now;
            fn.apply(this, args);
        } else if (!timer) {
            timer = setTimeout(() => {
                lastCall = Date.now();
                timer = null;
                fn.apply(this, lastArgs);
            }, remaining);
        }
    }

    throttled.cancel = () => {
        if (timer) {
            clearTimeout(timer);
            timer = null;
        }
    };

    throttled.flush = () => {
        if (timer) {
            clearTimeout(timer);
            timer = null;
            lastCall = Date.now();
            if (lastArgs) fn.apply(null, lastArgs);
        }
    };

    return throttled;
}

/**
 * 创建防抖函数（debounce），在最后一次调用后延迟执行
 * @param {Function} fn - 要防抖的函数
 * @param {number} delay - 防抖延迟（毫秒）
 * @returns {Function} 防抖后的函数
 */
export function createDebounce(fn, delay) {
    let timer = null;

    function debounced(...args) {
        if (timer) clearTimeout(timer);
        timer = setTimeout(() => {
            timer = null;
            fn.apply(this, args);
        }, delay);
    }

    debounced.cancel = () => {
        if (timer) {
            clearTimeout(timer);
            timer = null;
        }
    };

    debounced.flush = () => {
        if (timer) {
            clearTimeout(timer);
            timer = null;
            fn.apply(null);
        }
    };

    return debounced;
}

// ═══════════════════════════════════════════════════════════
//  HTML 转义 & Markdown 渲染
// ═══════════════════════════════════════════════════════════

/**
 * 防止XSS（纯HTML实体转义，不处理换行）
 * @param {string} str
 * @returns {string}
 */
export function escapeHTML(str) {
    if (!str) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

/**
 * HTML转义并将换行转为<br>（用于需要换行显示的场景）
 * @param {string} str
 * @returns {string}
 */
export function escapeHTMLWithBreaks(str) {
    if (!str) return '';
    return escapeHTML(str).replace(/\n/g, '<br>');
}

/**
 * 渲染 Markdown 文本
 * @param {string} text - 要渲染的文本
 * @returns {string} HTML 字符串
 */
export function renderMarkdown(text) {
    if (!text) return '';

    // 如果 marked 已加载，使用 Markdown 渲染
    const markedInstance = getMarkedInstance();
    if (markedLoaded && markedInstance) {
        try {
            const html = markedInstance.parse(text);
            // 将所有链接设置为在新窗口打开
            const tempDiv = document.createElement('div');
            tempDiv.innerHTML = html;
            const links = tempDiv.querySelectorAll('a');
            links.forEach(link => {
                link.setAttribute('target', '_blank');
                link.setAttribute('rel', 'noopener noreferrer');
            });
            return tempDiv.innerHTML;
        } catch (error) {
            console.warn('[AI Assistant] Markdown 解析失败，使用纯文本显示', error);
            return escapeHTML(text).replace(/\n/g, '<br>');
        }
    }

    // 降级方案：使用纯文本显示
    return escapeHTML(text).replace(/\n/g, '<br>');
}

// ═══════════════════════════════════════════════════════════
//  思考面板渲染
// ═══════════════════════════════════════════════════════════

/**
 * Render a complete thinking panel
 * @param {string} content - The thinking content
 * @returns {string} HTML string
 */
export function renderThinkingPanel(content) {
    const escapedContent = escapeHTML(content);
    return `
        <details class="st-chatu8-ai-thinking-panel">
            <summary class="st-chatu8-ai-thinking-summary">
                <span class="thinking-icon">💭</span>
                <span class="thinking-label">${getAssistantDisplayName()}的思考过程</span>
                <span class="thinking-toggle">▼</span>
            </summary>
            <div class="st-chatu8-ai-thinking-content">
                ${escapedContent}
            </div>
        </details>
    `;
}

/**
 * Render an incomplete thinking indicator (for streaming)
 * @param {string} partialContent - Partial thinking content
 * @returns {string} HTML string
 */
export function renderThinkingIndicator(partialContent) {
    return `
        <div class="st-chatu8-ai-thinking-indicator">
            <span class="thinking-icon">💭</span>
            <span class="thinking-label">思考中</span>
            <span class="thinking-dots">
                <span class="dot"></span>
                <span class="dot"></span>
                <span class="dot"></span>
            </span>
        </div>
    `;
}

// ═══════════════════════════════════════════════════════════
//  滚动辅助
// ═══════════════════════════════════════════════════════════

/** 节流滚动 RAF 标志 */
let _scrollRAFPending = false;

/**
 * 节流版滚动到底部：使用 requestAnimationFrame 避免强制同步回流
 * 注意：此函数已移至 assistantMessage.js 中，因为它直接依赖 dom 引用。
 * 此处保留空实现以避免导入断裂，但不应被直接调用。
 * @deprecated 请使用 assistantMessage.js 中的 throttledScrollToBottom
 */
export function throttledScrollToBottom() {
    // 实际实现在 assistantMessage.js 中，此处为兼容存根
    console.warn('[assistantUtils] throttledScrollToBottom 已移至 assistantMessage.js');
}
