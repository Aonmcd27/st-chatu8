// @ts-nocheck
/**
 * iframe 模块主入口
 * 初始化和事件监听
 */

import { eventSource, event_types } from "../../../../../../script.js";
import { extension_settings } from "../../../../../extensions.js";
import { extensionName } from '../config.js';
import { getContext } from "../../../../../st-context.js";
import { applyGenerateButtonStyle, applyImageFrameStyle, isThemeDark } from '../settings/theme.js';
import { debounce, isElementVisible } from './utils.js';
import { processMesTextElements, processIframes } from './chatProcessor.js';
import { findAndReplaceInElement } from './placeholder.js';
import { setTriggerGeneration } from './dialogs.js';
import { setGorkTriggerGeneration } from './gorkVideo.js';
import { triggerGeneration, setShowImagePreview } from './generation.js';
import { showImagePreview } from './imagePreview.js';

// 全局变量
let autoClickTimer = null;
window.zidongdianji = false;

const iframeObserverState = new Map();
let mainDocumentObserver = null;
const PLUGIN_MANAGED_SELECTOR = '.image-tag-button, .st-chatu8-image-button, .st-chatu8-image-span, .st-chatu8-image-container, .st-chatu8-collapse-wrapper';

function isPluginManagedNode(node) {
    if (!node) {
        return false;
    }

    let targetNode = node;
    if (targetNode.nodeType === Node.TEXT_NODE) {
        targetNode = targetNode.parentElement;
    }

    if (!targetNode || targetNode.nodeType !== Node.ELEMENT_NODE) {
        return false;
    }

    return Boolean(targetNode.matches?.(PLUGIN_MANAGED_SELECTOR) || targetNode.closest?.(PLUGIN_MANAGED_SELECTOR));
}

function shouldIgnoreIframeMutations(mutations) {
    if (!Array.isArray(mutations) || mutations.length === 0) {
        return true;
    }

    return mutations.every(mutation => {
        if (mutation.type === 'characterData' || mutation.type === 'attributes') {
            return isPluginManagedNode(mutation.target);
        }

        const changedNodes = [...mutation.addedNodes, ...mutation.removedNodes];
        if (changedNodes.length === 0) {
            return isPluginManagedNode(mutation.target);
        }

        return changedNodes.every(isPluginManagedNode) && isPluginManagedNode(mutation.target);
    });
}

function cleanupDetachedIframeObservers() {
    for (const [iframe, state] of iframeObserverState.entries()) {
        if (!document.contains(iframe)) {
            state.observer?.disconnect();
            iframeObserverState.delete(iframe);
        }
    }
}

function observeIframeContent(iframe) {
    if (!iframe) {
        return;
    }

    const attachObserver = () => {
        try {
            const iframeDoc = iframe.contentDocument;
            const iframeBody = iframeDoc?.body;
            if (!iframeBody) {
                return;
            }

            const existingState = iframeObserverState.get(iframe);
            if (existingState?.doc === iframeDoc) {
                return;
            }

            existingState?.observer?.disconnect();

            const scheduleReprocess = debounce(() => {
                if (!document.contains(iframe)) {
                    return;
                }

                try {
                    const latestDoc = iframe.contentDocument;
                    if (!latestDoc?.body) {
                        return;
                    }
                    processIframes();
                } catch (error) {
                    console.warn('[iframe] Failed to re-process observed iframe:', error?.message || error);
                }
            }, 180);

            const observer = new MutationObserver((mutations) => {
                if (shouldIgnoreIframeMutations(mutations)) {
                    return;
                }
                scheduleReprocess();
            });

            observer.observe(iframeBody, {
                childList: true,
                subtree: true,
                characterData: true,
            });

            iframeObserverState.set(iframe, {
                observer,
                doc: iframeDoc,
            });
        } catch (error) {
            console.warn('[iframe] Failed to observe iframe content:', error?.message || error);
        }
    };

    try {
        const iframeDoc = iframe.contentDocument;
        if (iframeDoc?.readyState === 'complete' && iframeDoc.body) {
            attachObserver();
            return;
        }
    } catch (error) {
        console.warn('[iframe] Failed to access iframe during observer setup:', error?.message || error);
    }

    iframe.addEventListener('load', attachObserver, { once: true });
}

function observeAllIframes() {
    cleanupDetachedIframeObservers();
    const iframes = document.querySelectorAll('iframe');
    iframes.forEach(iframe => observeIframeContent(iframe));
}

function initializeMainDocumentObserver() {
    if (mainDocumentObserver) {
        return;
    }

    const startObserving = () => {
        if (mainDocumentObserver) {
            return;
        }

        const root = document.body || document.documentElement;
        if (!root) {
            return;
        }

        mainDocumentObserver = new MutationObserver((mutations) => {
            const hasIframeMutation = mutations.some((mutation) => {
                const changedNodes = [...mutation.addedNodes, ...mutation.removedNodes];
                return changedNodes.some(node => {
                    if (!node || node.nodeType !== Node.ELEMENT_NODE) {
                        return false;
                    }
                    return node.tagName === 'IFRAME' || Boolean(node.querySelector?.('iframe'));
                });
            });

            if (!hasIframeMutation) {
                return;
            }

            observeAllIframes();
            debouncedProcessVisible();
        });

        mainDocumentObserver.observe(root, {
            childList: true,
            subtree: true,
        });
    };

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', startObserving, { once: true });
    } else {
        startObserving();
    }
}

// 设置循环依赖的函数引用
setTriggerGeneration(triggerGeneration);
setGorkTriggerGeneration(triggerGeneration);
setShowImagePreview(showImagePreview);

// 防抖版的处理函数，用于滚动事件
const debouncedProcessVisible = debounce(() => {
    processMesTextElements();
    processIframes();
}, 200);

// 事件监听：生成结束
eventSource.on(event_types.GENERATION_ENDED, async (data) => {
    window.zidongdianji = true;

    if (autoClickTimer) {
        clearTimeout(autoClickTimer);
    }

    if (extension_settings[extensionName].zidongdianji2 !== "true") {

        autoClickTimer = setTimeout(() => {
            window.zidongdianji = false;
            autoClickTimer = null;
        }, 5000);

    }
});

// 事件监听：消息滑动
eventSource.on(event_types.MESSAGE_SWIPED, async (data) => {
    window.zidongdianji = true;

    if (autoClickTimer) {
        clearTimeout(autoClickTimer);
    }

    if (extension_settings[extensionName].zidongdianji2 !== "true") {

        autoClickTimer = setTimeout(() => {
            window.zidongdianji = false;
            autoClickTimer = null;
        }, 5000);

    }
});

// 事件监听：JS 生成结束
eventSource.on("js_generation_ended", async (data) => {
    window.zidongdianji = true;

    if (autoClickTimer) {
        clearTimeout(autoClickTimer);
    }

    if (extension_settings[extensionName].zidongdianji2 !== "true") {

        autoClickTimer = setTimeout(() => {
            window.zidongdianji = false;
            autoClickTimer = null;
        }, 5000);

    }
});

/**
 * 处理所有图片占位符
 */
export function processAllImagePlaceholders() {
    // Process .mes_text elements in the main document
    processMesTextElements();

    // Process iframes separately
    processIframes();
    observeAllIframes();

    // New logic to process recent chats and add collapsible UI
    // try {
    //     const context = getContext();
    //     if (context && Array.isArray(context.chat)) {
    //         processRecentChats(context.chat);
    //     }
    // } catch (e) {
    //     console.error("st-chatu8: Error processing recent chats:", e);
    // }
}

/**
 * 仅处理指定元素内的图片占位符，避免自动点击时全量扫描历史消息
 * @param {HTMLElement} targetElement
 */
export function processImagePlaceholdersForElement(targetElement) {
    if (!targetElement) {
        return;
    }
    if (!isElementVisible(targetElement, 0)) {
        return;
    }

    findAndReplaceInElement(targetElement);
}

/**
 * Global listener for new iframes and main document mutations
 * 初始化图片处理
 */
export function initializeImageProcessing() {
    // Apply button style on init
    if (extension_settings[extensionName]) {
        const currentTheme = extension_settings[extensionName].themes?.[extension_settings[extensionName].theme_id] || {};
        applyGenerateButtonStyle(extension_settings[extensionName].generate_btn_style || '默认', isThemeDark(currentTheme));
        applyImageFrameStyle(extension_settings[extensionName].image_frame_style || '无样式', isThemeDark(currentTheme));
    }

    // Initial processing
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', processAllImagePlaceholders);
    } else {
        processAllImagePlaceholders();
    }

    initializeMainDocumentObserver();
}
