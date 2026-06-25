// @ts-nocheck
/**
 * NovelAI 云端队列服务
 * 处理与 HF Space 队列服务的交互
 */

import { extension_settings } from '../../../../extensions.js';
import { extensionName } from './config.js';
import { addLog } from './utils.js';

const POLL_INTERVAL = 1000; // 轮询间隔 1 秒
const MAX_POLL_RETRIES = 3; // 单次轮询最大重试次数

/**
 * 获取用户唯一标识
 * 使用 localStorage 生成持久化 ID
 */
export function getUserId() {
    let id = localStorage.getItem('chatu8_uid');
    if (!id) {
        id = (typeof crypto !== 'undefined' && crypto.randomUUID) ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).substr(2);
        localStorage.setItem('chatu8_uid', id);
    }
    return id;
}

/**
 * 计算 API Key 的 SHA-256 hash
 * @param {string} key - NovelAI API Key
 * @returns {Promise<string>} - hex 编码的 hash
 */
export async function hashKey(key) {
    // 检查 crypto.subtle 是否可用（仅在安全上下文 HTTPS 或 localhost 中可用）
    if (crypto && crypto.subtle && typeof crypto.subtle.digest === 'function') {
        const encoder = new TextEncoder();
        const data = encoder.encode(key);
        const hashBuffer = await crypto.subtle.digest('SHA-256', data);
        const hashArray = Array.from(new Uint8Array(hashBuffer));
        return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
    } else {
        // Fallback: 使用 CryptoJS（非安全上下文，如 HTTP 环境）
        // CryptoJS 应该已在全局加载（通过 crypto-js.min.js）
        if (typeof CryptoJS !== 'undefined' && CryptoJS.SHA256) {
            const hash = CryptoJS.SHA256(key);
            return hash.toString(CryptoJS.enc.Hex);
        } else {
            // 如果 CryptoJS 也不可用，使用简单的 hash 函数（不安全，仅作为最后手段）
            console.warn('[queueService] crypto.subtle 和 CryptoJS 都不可用，使用简单 hash');
            let hash = 0;
            for (let i = 0; i < key.length; i++) {
                const char = key.charCodeAt(i);
                hash = ((hash << 5) - hash) + char;
                hash = hash & hash; // Convert to 32bit integer
            }
            return Math.abs(hash).toString(16).padStart(8, '0');
        }
    }
}

/**
 * 获取队列服务基础 URL
 */
function getQueueBaseUrl() {
    return extension_settings[extensionName].cloudQueueUrl || '';
}

/**
 * 加入队列
 * @param {string} keyHash - API Key 的 hash
 * @param {string} userId - 用户 ID
 * @param {string} taskId - 任务 ID
 * @returns {Promise<{position: number, estimated_wait: number, lock_token?: string}>}
 */
export async function joinQueue(keyHash, userId, taskId) {
    const baseUrl = getQueueBaseUrl();
    if (!baseUrl) {
        throw new Error('云端队列服务地址未配置');
    }

    addLog(`[队列] 正在加入队列... (taskId: ${taskId.substring(0, 8)}...)`);

    // 获取个性语（限制 15 字符）
    const greeting = (extension_settings[extensionName].cloudQueueGreeting || '').substring(0, 15);

    const response = await fetch(`${baseUrl}/join-queue`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key_hash: keyHash, user_id: userId, task_id: taskId, greeting: greeting || null })
    });

    if (!response.ok) {
        const error = await response.text();
        throw new Error(`加入队列失败: ${response.status} - ${error}`);
    }

    const result = await response.json();
    addLog(`[队列] 已加入队列，位置: ${result.position + 1}/${result.queue_size || '?'}`);
    return result;
}

/**
 * 检查是否轮到自己
 * @param {string} keyHash - API Key 的 hash
 * @param {string} userId - 用户 ID
 * @param {string} taskId - 任务 ID
 * @returns {Promise<{is_my_turn: boolean, position: number, lock_token?: string}>}
 */
export async function checkMyTurn(keyHash, userId, taskId) {
    const baseUrl = getQueueBaseUrl();
    if (!baseUrl) {
        throw new Error('云端队列服务地址未配置');
    }

    const response = await fetch(`${baseUrl}/my-turn?key_hash=${encodeURIComponent(keyHash)}&user_id=${encodeURIComponent(userId)}&task_id=${encodeURIComponent(taskId)}`);

    if (!response.ok) {
        const error = await response.text();
        throw new Error(`检查队列状态失败: ${response.status} - ${error}`);
    }

    return await response.json();
}

/**
 * 完成生成，释放锁
 * @param {string} keyHash - API Key 的 hash
 * @param {string} userId - 用户 ID
 * @param {string} taskId - 任务 ID
 * @param {string} lockToken - 锁 token
 */
export async function completeQueue(keyHash, userId, taskId, lockToken) {
    const baseUrl = getQueueBaseUrl();
    if (!baseUrl) return;

    addLog(`[队列] 正在释放锁...`);

    try {
        const response = await fetch(`${baseUrl}/complete`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ key_hash: keyHash, user_id: userId, task_id: taskId, lock_token: lockToken })
        });

        if (response.ok) {
            addLog(`[队列] 锁已释放`);
        } else {
            const error = await response.text();
            addLog(`[队列] 释放锁失败: ${error}`);
        }
    } catch (error) {
        addLog(`[队列] 释放锁时出错: ${error.message}`);
    }
}

/**
 * 主动退出队列
 * @param {string} keyHash - API Key 的 hash
 * @param {string} userId - 用户 ID
 * @param {string} taskId - 任务 ID
 * @param {string} lockToken - 锁 token（可选）
 */
export async function leaveQueue(keyHash, userId, taskId, lockToken = null) {
    const baseUrl = getQueueBaseUrl();
    if (!baseUrl) return;

    addLog(`[队列] 正在退出队列...`);

    try {
        const response = await fetch(`${baseUrl}/leave-queue`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ key_hash: keyHash, user_id: userId, task_id: taskId, lock_token: lockToken })
        });

        if (response.ok) {
            addLog(`[队列] 已退出队列`);
        } else {
            const error = await response.text();
            addLog(`[队列] 退出队列失败: ${error}`);
        }
    } catch (error) {
        addLog(`[队列] 退出队列时出错: ${error.message}`);
    }
}

/**
 * 等待轮到自己（带轮询），配合任务系统检测取消
 * @param {string} keyHash - API Key 的 hash
 * @param {string} userId - 用户 ID
 * @param {string} taskId - 任务 ID（用于检测取消和队列排队）
 * @param {object} taskQueue - 任务队列对象
 * @returns {Promise<{lockToken: string}>}
 */
export async function waitForTurn(keyHash, userId, taskId, taskQueue) {
    // 先加入队列（使用 taskId）
    const joinResult = await joinQueue(keyHash, userId, taskId);

    // 如果直接获得锁（position 为 0），返回 token
    if (joinResult.position === 0 && joinResult.lock_token) {
        addLog(`[队列] 直接获得锁，无需等待`);
        toastr.success('获得锁，开始生成', '队列');
        return { lockToken: joinResult.lock_token };
    }

    // 显示初始队列位置
    toastr.info(`排队中: 第 ${joinResult.position + 1}/${joinResult.queue_size || '?'} 位`, '队列', { timeOut: 5000 });

    // 轮询等待
    let retryCount = 0;
    let shownGreeting = false; // 当次请求是否已显示过个性语
    let lastPosition = joinResult.position; // 记录上次位置用于检测变化
    while (true) {
        // 检查任务是否被取消
        if (taskQueue && !taskQueue.isTaskInQueue(taskId)) {
            addLog(`[队列] 任务已被取消，退出队列`);
            await leaveQueue(keyHash, userId, taskId, null);
            throw new Error('任务已取消');
        }

        await sleep(POLL_INTERVAL);

        try {
            const status = await checkMyTurn(keyHash, userId, taskId);
            retryCount = 0; // 重置重试计数

            if (status.is_my_turn && status.lock_token) {
                addLog(`[队列] 轮到我了，开始生成`);
                toastr.success('轮到你了，开始生成！', '队列');
                return { lockToken: status.lock_token };
            }

            // 显示队列信息
            let logMsg = `[队列] 等待中... 位置: ${status.position + 1}/${status.queue_size || '?'}`;

            // 位置变化时显示 toastr 通知
            if (status.position !== lastPosition) {
                toastr.info(`排队中: 第 ${status.position + 1}/${status.queue_size || '?'} 位`, '队列', { timeOut: 3000 });
                lastPosition = status.position;
            }

            // 仅在当次请求第一次轮询时显示个性语（如果启用）
            if (!shownGreeting && status.current_greeting && extension_settings[extensionName].showQueueGreeting === 'true') {
                logMsg += ` | 前方用户: "${status.current_greeting}"`;
                toastr.info(`前方用户: "${status.current_greeting}"`, '队列', { timeOut: 5000 });
                shownGreeting = true;
            }
            addLog(logMsg);
        } catch (error) {
            retryCount++;
            addLog(`[队列] 轮询失败 (${retryCount}/${MAX_POLL_RETRIES}): ${error.message}`);

            if (retryCount >= MAX_POLL_RETRIES) {
                toastr.error(`队列服务不可用: ${error.message}`, '队列');
                throw new Error(`队列服务不可用: ${error.message}`);
            }
        }
    }
}

/**
 * 辅助函数：延时
 */
function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}
