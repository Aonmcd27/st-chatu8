// @ts-nocheck
/**
 * ComfyUI 保活模块
 * 当插件启用且模式为 comfyui 时，定期发送 ping 请求保活
 */

import { extension_settings } from "../../../../extensions.js";
import { extensionName } from './config.js';
import { getRequestHeaders } from './utils.js';

// 保活定时器
let keepAliveTimer = null;

// 保活间隔（毫秒）- 默认 30 秒
const KEEP_ALIVE_INTERVAL = 30000;

// Ping 超时时间（毫秒）- 5 秒
const PING_TIMEOUT = 5000;

// Ping 失败计数统计，达到两次即停止
let consecutiveErrors = 0;
// 是否已经被挂起（达到失败阈值后将停止尝试）
let keepAliveSuspended = false;

/**
 * 检查插件是否启用且模式为 comfyui
 * @returns {boolean}
 */
function shouldKeepAlive() {
    const settings = extension_settings[extensionName];
    if (!settings) return false;

    // 检查插件是否启用
    const isEnabled = settings.scriptEnabled === true || settings.scriptEnabled === "true";
    // 检查模式是否为 comfyui
    const isComfyUIMode = settings.mode === 'comfyui';

    return isEnabled && isComfyUIMode && !keepAliveSuspended;
}

/**
 * 向 SillyTavern 后端发送 ping 请求（通过酒馆后端代理）
 */
function pingViaSillyTavern() {
    const comfyUrl = extension_settings[extensionName]?.comfyuiUrl?.trim();
    if (!comfyUrl) {
        return;
    }

    // Fire-and-forget: 使用 AbortController 实现超时，不等待响应
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), PING_TIMEOUT);

    fetch('/api/sd/comfy/ping', {
        method: 'POST',
        headers: getRequestHeaders(window.token),
        body: JSON.stringify({ url: comfyUrl }),
        signal: controller.signal,
    }).then(res => {
        if (!res.ok) {
            throw new Error(`[ComfyUI KeepAlive] HTTP error! status: ${res.status}`);
        }
        // 成功时重置错误计数
        consecutiveErrors = 0;
    }).catch((err) => {
        // 记录错误并增加计数
        console.warn('[ComfyUI KeepAlive] Ping 请求失败:', err);
        consecutiveErrors++;
        checkErrorCountAndSuspend();
    }).finally(() => {
        clearTimeout(timeoutId);
    });
}

/**
 * 直接向 ComfyUI 发送 ping 请求（浏览器端直连）
 */
function pingDirect() {
    const comfyUrl = extension_settings[extensionName]?.comfyuiUrl?.trim();
    if (!comfyUrl) {
        return;
    }

    // Fire-and-forget: 使用 AbortController 实现超时，不等待响应
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), PING_TIMEOUT);

    fetch(`${comfyUrl}/system_stats`, {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
    }).then(res => {
        if (!res.ok) {
            throw new Error(`[ComfyUI KeepAlive] HTTP error! status: ${res.status}`);
        }
        // 成功时重置错误计数
        consecutiveErrors = 0;
    }).catch((err) => {
        // 记录错误并增加计数
        console.warn('[ComfyUI KeepAlive] Direct Ping 请求失败:', err);
        consecutiveErrors++;
        checkErrorCountAndSuspend();
    }).finally(() => {
        clearTimeout(timeoutId);
    });
}

/**
 * 检查错误次数，达到两次则挂起保活
 */
function checkErrorCountAndSuspend() {
    if (consecutiveErrors >= 2) {
        console.log('[ComfyUI KeepAlive] 连续 2 次请求失败，已自动暂停保活检测。如需恢复检测，请修改地址或重新点击测试。');
        keepAliveSuspended = true;
        stopKeepAlive();
    }
}

/**
 * 执行保活 ping
 * 根据 client 配置决定使用哪种方式
 */
function doPing() {
    if (!shouldKeepAlive()) {
        return;
    }

    const client = extension_settings[extensionName]?.client;

    if (client === 'jiuguan') {
        // 通过酒馆后端代理 (fire-and-forget)
        pingViaSillyTavern();
    } else {
        // 浏览器直连 (fire-and-forget)
        pingDirect();
    }
}

/**
 * 启动保活定时器
 */
export function startKeepAlive() {
    // 如果已经有定时器在运行，先停止，防止重复请求
    stopKeepAlive();

    if (!shouldKeepAlive()) {
        console.log('[ComfyUI KeepAlive] 条件不满足或已暂停，不启动保活');
        return;
    }

    console.log('[ComfyUI KeepAlive] 启动保活定时器，间隔:', KEEP_ALIVE_INTERVAL, 'ms');

    // 立即执行一次
    doPing();

    // 设置定时器
    keepAliveTimer = setInterval(doPing, KEEP_ALIVE_INTERVAL);
}

/**
 * 停止保活定时器
 */
export function stopKeepAlive() {
    if (keepAliveTimer) {
        console.log('[ComfyUI KeepAlive] 停止保活定时器');
        clearInterval(keepAliveTimer);
        keepAliveTimer = null;
    }
}

/**
 * 更新保活状态
 * 当设置变更时调用此函数
 */
export function updateKeepAliveStatus() {
    if (shouldKeepAlive()) {
        // 如果定时器已经在运行，不需要重启
        if (!keepAliveTimer) {
            startKeepAlive();
        }
    } else {
        stopKeepAlive();
    }
}

/**
 * 初始化保活模块
 */
export function initializeKeepAlive() {
    console.log('[ComfyUI KeepAlive] 初始化保活模块');
    updateKeepAliveStatus();
}

/**
 * 重置保活状态并重新开始检测
 * 暴露给外部使用 (如设置面板发生改动或手动点击测试)
 */
export function resetKeepAliveState() {
    console.log('[ComfyUI KeepAlive] 状态已重置，重新开始保活检测');
    consecutiveErrors = 0;
    keepAliveSuspended = false;
    updateKeepAliveStatus();
}
