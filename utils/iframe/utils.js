// @ts-nocheck
/**
 * iframe 模块工具函数
 * 包含：防抖、节流、可见性检测、二分查找等性能优化工具
 */

/**
 * 二分查找：在 nodeInfos 中找到包含指定位置的节点
 * @param {Array<{node: Node, start: number, end: number}>} nodeInfos - 按 start 升序排列的节点信息
 * @param {number} position - 要查找的位置
 * @returns {{node: Node, start: number, end: number} | null} 包含该位置的节点信息
 */
export function findNodeAtPosition(nodeInfos, position) {
    if (!nodeInfos || nodeInfos.length === 0) return null;

    let left = 0;
    let right = nodeInfos.length - 1;

    while (left <= right) {
        const mid = Math.floor((left + right) / 2);
        const info = nodeInfos[mid];

        // position 在 (start, end] 范围内，或正好在边界上
        if ((position > info.start && position <= info.end) || position === info.end) {
            return info;
        } else if (position <= info.start) {
            right = mid - 1;
        } else {
            left = mid + 1;
        }
    }

    return null;
}

/**
 * 检测元素是否在视口中可见（或接近可见）
 * @param {Element} element - 要检测的元素
 * @param {number} margin - 额外的边距（像素），用于预加载
 * @returns {boolean} 是否可见
 */
export function isElementVisible(element, margin = 200) {
    if (!element || !element.getBoundingClientRect) return false;

    const rect = element.getBoundingClientRect();
    const windowHeight = window.innerHeight || document.documentElement.clientHeight;
    const windowWidth = window.innerWidth || document.documentElement.clientWidth;

    // 检查元素是否在扩展的视口范围内
    const verticalVisible = rect.bottom >= -margin && rect.top <= windowHeight + margin;
    const horizontalVisible = rect.right >= -margin && rect.left <= windowWidth + margin;

    return verticalVisible && horizontalVisible;
}

/**
 * 检测 iframe 是否在视口中可见
 * @param {HTMLIFrameElement} iframe - 要检测的 iframe
 * @param {number} margin - 额外的边距
 * @returns {boolean} 是否可见
 */
export function isIframeVisible(iframe, margin = 200) {
    return isElementVisible(iframe, margin);
}

/**
 * 防抖函数：在连续调用停止后的指定时间才执行
 * @param {Function} fn - 要执行的函数
 * @param {number} delay - 延迟时间（毫秒）
 * @returns {Function} 防抖后的函数
 */
export function debounce(fn, delay = 150) {
    let timeoutId = null;
    return function (...args) {
        if (timeoutId) {
            clearTimeout(timeoutId);
        }
        timeoutId = setTimeout(() => {
            fn.apply(this, args);
            timeoutId = null;
        }, delay);
    };
}

/**
 * 节流函数：在指定时间间隔内最多执行一次
 * @param {Function} fn - 要执行的函数
 * @param {number} interval - 间隔时间（毫秒）
 * @returns {Function} 节流后的函数
 */
export function throttle(fn, interval = 150) {
    let lastTime = 0;
    let timeoutId = null;
    return function (...args) {
        const now = Date.now();
        const remaining = interval - (now - lastTime);
        if (remaining <= 0) {
            if (timeoutId) {
                clearTimeout(timeoutId);
                timeoutId = null;
            }
            lastTime = now;
            fn.apply(this, args);
        } else if (!timeoutId) {
            timeoutId = setTimeout(() => {
                lastTime = Date.now();
                timeoutId = null;
                fn.apply(this, args);
            }, remaining);
        }
    };
}

/**
 * A simple hashing function to create a stable, predictable ID from a string.
 * @param {string} str - 输入字符串
 * @returns {string} 稳定的 ID
 */
export function generateStableId(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
        const char = str.charCodeAt(i);
        hash = ((hash << 5) - hash) + char;
        hash |= 0; // Convert to 32bit integer
    }
    // Prepend a string to ensure it's a valid selector and doesn't start with a number.
    return 'chatu8-id-' + Math.abs(hash).toString(36);
}

/**
 * 生成 el 的主键：取文本中间 20 个字符
 * @param {string} text - 逻辑文本
 * @returns {string} 主键
 */
export function generateElKey(text) {
    if (!text || text.length === 0) return '';
    const len = text.length;
    const keyLen = 20;
    const start = Math.max(0, Math.floor(len / 2) - Math.floor(keyLen / 2));
    return text.substring(start, start + keyLen);
}
