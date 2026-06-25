/* eslint-disable no-undef */
// @ts-nocheck

/**
 * 设置项帮助提示注入器（v2：修复移动端点击、仿项目弹窗定位）
 *
 * - 扫描 rootEl 内 label[for]，在匹配字典的 label 末尾追加 "?" 图标
 * - 图标直接绑定事件（不走 document 委托），避免被 label 默认激活吞掉
 * - Tooltip（悬停 or 短文案 tap）、Modal（长文案 tap，Markdown）
 * - 模态挂到 #st-chatu8-settings，移动端按 leftSendForm 边界定位 top/height
 *
 * 用法：
 *   initHelpTipInteractions();        // 幂等，第一次调用时初始化一次性 DOM/全局监听
 *   injectHelpTips(containerElement); // 每次设置面板渲染后调用
 */

import { getHelpEntry } from './settingsHelpText.js';
import { loadMarked, renderMarkdown } from '../assistant/assistantUtils.js';
import { extension_settings } from '../../../../../extensions.js';
import { extensionName } from '../config.js';

const INJECTED_FLAG = 'chatu8HelpTipInjected';
let globalsInitialized = false;
let markedLoadingTriggered = false;

/** 读开关（默认开启；兼容 'true'/'false' 字符串与布尔） */
function isHelpTipsEnabled() {
    const v = extension_settings?.[extensionName]?.helpTipsEnabled;
    if (v === undefined || v === null) return true; // 默认开启
    if (typeof v === 'boolean') return v;
    return String(v).toLowerCase() !== 'false';
}

/* ═════════════════════════════════════════════════════════════
 *  注入：扫描 label 并追加问号图标
 * ═════════════════════════════════════════════════════════════ */

/**
 * @param {HTMLElement | Document} rootEl
 */
export function injectHelpTips(rootEl) {
    if (!rootEl || typeof rootEl.querySelectorAll !== 'function') return;
    if (!isHelpTipsEnabled()) return; // 开关关闭 → 不注入

    if (!markedLoadingTriggered) {
        markedLoadingTriggered = true;
        try { loadMarked?.().catch(() => { }); } catch (_) { /* noop */ }
    }

    const labels = rootEl.querySelectorAll('label[for]');
    labels.forEach((label) => {
        if (label.dataset[INJECTED_FLAG] === '1') return;
        const id = label.getAttribute('for');
        if (!id) return;
        const entry = getHelpEntry(id);
        if (!entry) return;

        const icon = document.createElement('span');
        icon.className = 'st-chatu8-help-icon';
        icon.setAttribute('role', 'button');
        icon.setAttribute('tabindex', '0');
        icon.setAttribute('aria-label', '查看说明');
        icon.dataset.helpId = id;
        icon.textContent = '?';
        // 不加原生 title 属性：浏览器会显示白色系统 tooltip 与我们的自定义气泡重叠

        bindIconEvents(icon);

        label.appendChild(document.createTextNode(' '));
        label.appendChild(icon);
        label.dataset[INJECTED_FLAG] = '1';
    });
}

/**
 * 移除指定容器内所有已注入的问号图标；供开关关闭时调用
 * @param {HTMLElement | Document} rootEl
 */
export function removeHelpTips(rootEl) {
    if (!rootEl || typeof rootEl.querySelectorAll !== 'function') return;
    rootEl.querySelectorAll('.st-chatu8-help-icon').forEach(el => el.remove());
    rootEl.querySelectorAll(`label[data-${INJECTED_FLAG.replace(/[A-Z]/g, m => '-' + m.toLowerCase())}="1"]`)
        .forEach(l => { delete l.dataset[INJECTED_FLAG]; });
    // 关闭时顺手隐藏已打开的气泡
    hideHelpTooltip();
}

/**
 * 将事件直接绑定到图标元素上，彻底避免 label 吞事件 / 激活控件的问题
 */
function bindIconEvents(icon) {
    const trigger = (e) => {
        // 关键：阻止事件进一步冒泡到 <label>，从而避免触发 label 关联 input 的默认动作
        e.preventDefault();
        e.stopPropagation();
        if (typeof e.stopImmediatePropagation === 'function') e.stopImmediatePropagation();

        const id = icon.dataset.helpId;
        const entry = id ? getHelpEntry(id) : null;
        if (!entry) return;

        // 统一：点击都显示 sticky 小气泡（Markdown 渲染，无弹窗）
        const text = entry.long || entry.short || '';
        showHelpTooltip(icon, text, /*sticky*/ true);
    };

    // 使用 mousedown / touchstart 提前吃掉事件，避免 iOS/Android 把 click 派发到 label 控件
    const earlySwallow = (e) => {
        // 不 preventDefault（否则 focus 会丢）——仅阻止冒泡
        e.stopPropagation();
        if (typeof e.stopImmediatePropagation === 'function') e.stopImmediatePropagation();
    };

    icon.addEventListener('mousedown', earlySwallow);
    icon.addEventListener('touchstart', earlySwallow, { passive: true });

    icon.addEventListener('click', trigger);
    // 某些环境下（如某些 Android 浏览器）click 可能晚于 touchend 被父 label 吞掉：
    icon.addEventListener('touchend', (e) => {
        // 只处理纯 tap（没有明显滑动）
        trigger(e);
    });

    // Hover 小气泡（仅桌面）—— 悬停优先用 short，没有就用 long
    icon.addEventListener('mouseenter', () => {
        const id = icon.dataset.helpId;
        const entry = id ? getHelpEntry(id) : null;
        if (!entry) return;
        const text = entry.short || entry.long || '';
        if (text) showHelpTooltip(icon, text, /*sticky*/ false);
    });
    icon.addEventListener('mouseleave', () => {
        if (!tooltipSticky) hideHelpTooltip();
    });

    // 键盘可达性
    icon.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            e.stopPropagation();
            trigger(e);
        }
    });
}

/* ═════════════════════════════════════════════════════════════
 *  全局一次性初始化（ESC、窗口尺寸变化、点击外部关闭 tooltip）
 * ═════════════════════════════════════════════════════════════ */

export function initHelpTipInteractions() {
    if (globalsInitialized) return;
    globalsInitialized = true;

    document.addEventListener('keydown', (e) => {
        if (e.key !== 'Escape') return;
        if (overlayEl && overlayEl.style.display !== 'none') hideHelpModal();
        if (tooltipSticky) hideHelpTooltip();
    });

    // 点击外部关闭 sticky tooltip
    document.addEventListener('click', (e) => {
        if (!tooltipSticky) return;
        if (e.target && e.target.closest && e.target.closest('.st-chatu8-help-tooltip')) return;
        if (e.target && e.target.closest && e.target.closest('.st-chatu8-help-icon')) return;
        hideHelpTooltip();
    });

    // 尺寸变化时，重新定位已打开的模态
    window.addEventListener('resize', () => {
        if (overlayEl && overlayEl.style.display !== 'none') repositionHelpModal();
    });
}

/* ═════════════════════════════════════════════════════════════
 *  Tooltip
 * ═════════════════════════════════════════════════════════════ */

let tooltipEl = null;
let tooltipSticky = false;

function ensureTooltipEl() {
    if (tooltipEl) return tooltipEl;
    tooltipEl = document.createElement('div');
    tooltipEl.className = 'st-chatu8-help-tooltip';
    tooltipEl.style.display = 'none';
    document.body.appendChild(tooltipEl);
    return tooltipEl;
}

export function showHelpTooltip(anchor, text, sticky = false) {
    const el = ensureTooltipEl();
    tooltipSticky = !!sticky;
    // Markdown 渲染（marked 未加载时降级为转义 + <br>）
    try {
        el.innerHTML = renderMarkdown(text || '');
        el.querySelectorAll('a').forEach(a => {
            a.setAttribute('target', '_blank');
            a.setAttribute('rel', 'noopener noreferrer');
        });
    } catch (_) {
        el.textContent = text || '';
    }
    el.classList.toggle('st-chatu8-help-tooltip--sticky', tooltipSticky);
    el.style.display = 'block';
    el.style.visibility = 'hidden';

    const rect = anchor.getBoundingClientRect();
    const tipRect = el.getBoundingClientRect();
    const margin = 8;

    let top = rect.bottom + window.scrollY + margin;
    let left = rect.left + window.scrollX + rect.width / 2 - tipRect.width / 2;

    const maxLeft = window.scrollX + window.innerWidth - tipRect.width - margin;
    const minLeft = window.scrollX + margin;
    if (left > maxLeft) left = maxLeft;
    if (left < minLeft) left = minLeft;

    if (rect.bottom + tipRect.height + margin > window.innerHeight) {
        top = rect.top + window.scrollY - tipRect.height - margin;
    }

    el.style.top = `${Math.round(top)}px`;
    el.style.left = `${Math.round(left)}px`;
    el.style.visibility = 'visible';
}

export function hideHelpTooltip() {
    tooltipSticky = false;
    if (tooltipEl) tooltipEl.style.display = 'none';
}

/* ═════════════════════════════════════════════════════════════
 *  Modal（完全复用项目的 st-chatu8-popup-overlay / bubble）
 *  定位参照 iframe/dialogs.js 的 showImageSizePopup：
 *    - 移动端 topBound = #top-settings-holder.bottom + 10
 *    - 移动端 bottomBound = #send_form.top - 10
 *    - bubble.style.top / maxHeight 设置到 bubble 内层
 * ═════════════════════════════════════════════════════════════ */

let overlayEl = null;
let bubbleEl = null;
let bodyEl = null;
let titleEl = null;

function ensureModalEl() {
    if (overlayEl && overlayEl.isConnected) return overlayEl;

    overlayEl = document.createElement('div');
    overlayEl.className = 'st-chatu8-popup-overlay st-chatu8-help-overlay';
    overlayEl.style.display = 'none';

    bubbleEl = document.createElement('div');
    bubbleEl.className = 'st-chatu8-popup-bubble st-chatu8-help-bubble';

    // 标题行：标题文字 + 关闭按钮
    const headerEl = document.createElement('div');
    headerEl.className = 'st-chatu8-help-header';

    titleEl = document.createElement('div');
    titleEl.className = 'st-chatu8-popup-title st-chatu8-help-title';

    const closeBtn = document.createElement('span');
    closeBtn.className = 'st-chatu8-help-close';
    closeBtn.setAttribute('role', 'button');
    closeBtn.setAttribute('tabindex', '0');
    closeBtn.setAttribute('aria-label', '关闭');
    closeBtn.innerHTML = '&times;';
    closeBtn.addEventListener('click', hideHelpModal);

    headerEl.appendChild(titleEl);
    headerEl.appendChild(closeBtn);

    bodyEl = document.createElement('div');
    bodyEl.className = 'st-chatu8-help-body';

    bubbleEl.appendChild(headerEl);
    bubbleEl.appendChild(bodyEl);
    overlayEl.appendChild(bubbleEl);

    // 点击遮罩关闭
    overlayEl.addEventListener('click', (e) => {
        if (e.target === overlayEl) hideHelpModal();
    });

    document.body.appendChild(overlayEl);
    return overlayEl;
}

export function showHelpModal(id, entry) {
    ensureModalEl();
    hideHelpTooltip();

    titleEl.textContent = resolveTitleById(id) || id;

    const md = entry.long || entry.short || '';
    try {
        bodyEl.innerHTML = renderMarkdown(md);
        bodyEl.querySelectorAll('a').forEach(a => {
            a.setAttribute('target', '_blank');
            a.setAttribute('rel', 'noopener noreferrer');
        });
    } catch (_) {
        bodyEl.textContent = md;
    }

    overlayEl.style.display = 'flex'; // 与 .st-chatu8-popup-overlay 默认一致
    repositionHelpModal();
}

/**
 * 参考 iframe/dialogs.js::showImageSizePopup 的定位方式
 */
function repositionHelpModal() {
    if (!overlayEl || !bubbleEl) return;

    // 先清掉上一次的 mobile 样式
    bubbleEl.classList.remove('mobile');
    bubbleEl.style.top = '';
    bubbleEl.style.maxHeight = '';

    const isMobile = window.innerWidth <= 768;
    if (!isMobile) return; // 桌面：overlay 自带 flex center 居中

    let topBound = 10;
    let bottomBound = window.innerHeight - 10;

    const topSettingsHolder = document.querySelector('#top-settings-holder');
    if (topSettingsHolder) {
        const r = topSettingsHolder.getBoundingClientRect();
        topBound = r.bottom + 10;
    }
    const sendForm = document.querySelector('#send_form');
    if (sendForm) {
        const r = sendForm.getBoundingClientRect();
        bottomBound = r.top - 10;
    }

    const availableHeight = Math.max(120, bottomBound - topBound);

    bubbleEl.classList.add('mobile');
    bubbleEl.style.top = `${topBound}px`;
    bubbleEl.style.maxHeight = `${availableHeight}px`;
}

export function hideHelpModal() {
    if (overlayEl) overlayEl.style.display = 'none';
}

function resolveTitleById(id) {
    try {
        const label = document.querySelector(`label[for="${CSS.escape(id)}"]`);
        if (!label) return '';
        const clone = label.cloneNode(true);
        clone.querySelectorAll('.st-chatu8-help-icon').forEach(n => n.remove());
        return clone.textContent.trim();
    } catch (_) {
        return '';
    }
}
