// @ts-nocheck
/**
 * llmRequest.js - LLM 请求模块
 * 
 * 包含所有 LLM 相关的请求函数：GET_PROMPT 和 EXECUTE
 */

import { eventSource } from "../../../../../script.js";
import { eventNames } from "./config.js";
import { debugLog, debugBranch, debugTimer } from "./debugLogger.js";

/**
 * Generates a unique ID, falling back to a custom implementation if crypto.randomUUID is not available.
 * @returns {string}
 */
export function generateRequestId() {
    if (crypto && crypto.randomUUID) {
        return crypto.randomUUID();
    }
    // Fallback for older browsers/environments that don't support crypto.randomUUID
    return Date.now().toString(36) + Math.random().toString(36).substring(2);
}

export function LLM_GET_PROMPT() {
    return new Promise((resolve, reject) => {
        const promptRequestId = generateRequestId();
        console.log(`插图吧：请求获取 LLM 提示词 (ID: ${promptRequestId})`);

        const handler = (promptData) => {
            if (promptData.id !== promptRequestId) return;

            eventSource.removeListener(eventNames.LLM_GET_PROMPT_RESPONSE, handler);

            const { prompt } = promptData;
            console.log(`插图吧：已获取 LLM 提示词 (ID: ${promptRequestId}):`, prompt);

            resolve(prompt);
        };

        eventSource.on(eventNames.LLM_GET_PROMPT_RESPONSE, handler);
        eventSource.emit(eventNames.LLM_GET_PROMPT_REQUEST, { id: promptRequestId });

        setTimeout(() => {
            eventSource.removeListener(eventNames.LLM_GET_PROMPT_RESPONSE, handler);
            reject(new Error("获取 prompt 超时"));
        }, 10000);
    });
}

/**
 * 获取正文图片生成的提示词
 * @returns {Promise<Array>} 消息数组
 */
export function LLM_IMAGE_GEN_GET_PROMPT() {
    return new Promise((resolve, reject) => {
        const promptRequestId = generateRequestId();
        console.log(`插图吧：请求获取正文图片生成提示词 (ID: ${promptRequestId})`);

        const handler = (promptData) => {
            if (promptData.id !== promptRequestId) return;

            eventSource.removeListener(eventNames.LLM_IMAGE_GEN_GET_PROMPT_RESPONSE, handler);

            const { prompt } = promptData;
            console.log(`插图吧：已获取正文图片生成提示词 (ID: ${promptRequestId}):`, prompt);

            resolve(prompt);
        };

        eventSource.on(eventNames.LLM_IMAGE_GEN_GET_PROMPT_RESPONSE, handler);
        eventSource.emit(eventNames.LLM_IMAGE_GEN_GET_PROMPT_REQUEST, { id: promptRequestId });

        setTimeout(() => {
            eventSource.removeListener(eventNames.LLM_IMAGE_GEN_GET_PROMPT_RESPONSE, handler);
            reject(new Error("获取正文图片生成提示词超时"));
        }, 10000);
    });
}

/**
 * 获取角色/服装设计的提示词
 * @returns {Promise<Array>} 消息数组
 */
export function LLM_CHAR_DESIGN_GET_PROMPT() {
    return new Promise((resolve, reject) => {
        const promptRequestId = generateRequestId();
        console.log(`插图吧：请求获取角色/服装设计提示词 (ID: ${promptRequestId})`);

        const handler = (promptData) => {
            if (promptData.id !== promptRequestId) return;

            eventSource.removeListener(eventNames.LLM_CHAR_DESIGN_GET_PROMPT_RESPONSE, handler);

            const { prompt } = promptData;
            console.log(`插图吧：已获取角色/服装设计提示词 (ID: ${promptRequestId}):`, prompt);

            resolve(prompt);
        };

        eventSource.on(eventNames.LLM_CHAR_DESIGN_GET_PROMPT_RESPONSE, handler);
        eventSource.emit(eventNames.LLM_CHAR_DESIGN_GET_PROMPT_REQUEST, { id: promptRequestId });

        setTimeout(() => {
            eventSource.removeListener(eventNames.LLM_CHAR_DESIGN_GET_PROMPT_RESPONSE, handler);
            reject(new Error("获取角色/服装设计提示词超时"));
        }, 10000);
    });
}

/**
 * 获取角色/服装展示的提示词
 * @returns {Promise<Array>} 消息数组
 */
export function LLM_CHAR_DISPLAY_GET_PROMPT() {
    return new Promise((resolve, reject) => {
        const promptRequestId = generateRequestId();
        console.log(`插图吧：请求获取角色/服装展示提示词 (ID: ${promptRequestId})`);

        const handler = (promptData) => {
            if (promptData.id !== promptRequestId) return;

            eventSource.removeListener(eventNames.LLM_CHAR_DISPLAY_GET_PROMPT_RESPONSE, handler);

            const { prompt } = promptData;
            console.log(`插图吧：已获取角色/服装展示提示词 (ID: ${promptRequestId}):`, prompt);

            resolve(prompt);
        };

        eventSource.on(eventNames.LLM_CHAR_DISPLAY_GET_PROMPT_RESPONSE, handler);
        eventSource.emit(eventNames.LLM_CHAR_DISPLAY_GET_PROMPT_REQUEST, { id: promptRequestId });

        setTimeout(() => {
            eventSource.removeListener(eventNames.LLM_CHAR_DISPLAY_GET_PROMPT_RESPONSE, handler);
            reject(new Error("获取角色/服装展示提示词超时"));
        }, 10000);
    });
}

/**
 * 获取角色/服装修改的提示词
 * @returns {Promise<Array>} 消息数组
 */
export function LLM_CHAR_MODIFY_GET_PROMPT() {
    return new Promise((resolve, reject) => {
        const promptRequestId = generateRequestId();
        console.log(`插图吧：请求获取角色/服装修改提示词 (ID: ${promptRequestId})`);

        const handler = (promptData) => {
            if (promptData.id !== promptRequestId) return;

            eventSource.removeListener(eventNames.LLM_CHAR_MODIFY_GET_PROMPT_RESPONSE, handler);

            const { prompt } = promptData;
            console.log(`插图吧：已获取角色/服装修改提示词 (ID: ${promptRequestId}):`, prompt);

            resolve(prompt);
        };

        eventSource.on(eventNames.LLM_CHAR_MODIFY_GET_PROMPT_RESPONSE, handler);
        eventSource.emit(eventNames.LLM_CHAR_MODIFY_GET_PROMPT_REQUEST, { id: promptRequestId });

        setTimeout(() => {
            eventSource.removeListener(eventNames.LLM_CHAR_MODIFY_GET_PROMPT_RESPONSE, handler);
            reject(new Error("获取角色/服装修改提示词超时"));
        }, 10000);
    });
}

/**
 * 获取Tag修改的提示词
 * @returns {Promise<Array>} 消息数组
 */
export function LLM_TAG_MODIFY_GET_PROMPT() {
    return new Promise((resolve, reject) => {
        const promptRequestId = generateRequestId();
        console.log(`插图吧：请求获取Tag修改提示词 (ID: ${promptRequestId})`);

        const handler = (promptData) => {
            if (promptData.id !== promptRequestId) return;

            eventSource.removeListener(eventNames.LLM_TAG_MODIFY_GET_PROMPT_RESPONSE, handler);

            const { prompt } = promptData;
            console.log(`插图吧：已获取Tag修改提示词 (ID: ${promptRequestId}):`, prompt);

            resolve(prompt);
        };

        eventSource.on(eventNames.LLM_TAG_MODIFY_GET_PROMPT_RESPONSE, handler);
        eventSource.emit(eventNames.LLM_TAG_MODIFY_GET_PROMPT_REQUEST, { id: promptRequestId });

        setTimeout(() => {
            eventSource.removeListener(eventNames.LLM_TAG_MODIFY_GET_PROMPT_RESPONSE, handler);
            reject(new Error("获取Tag修改提示词超时"));
        }, 10000);
    });
}

// ==================== LLM 执行函数 ====================

export function LLM_EXECUTE(prompt, { timeoutMs = 600000 } = {}) {
    return new Promise((resolve, reject) => {
        const executeRequestId = generateRequestId();
        console.log(`声临其境：请求执行 LLM (ID: ${executeRequestId})`);

        let timeoutTimer = null;

        const cleanup = () => {
            eventSource.removeListener(eventNames.LLM_EXECUTE_RESPONSE, executeResponseHandler);
            if (timeoutTimer) clearTimeout(timeoutTimer);
        };

        const executeResponseHandler = (executeData) => {
            if (executeData.id !== executeRequestId) return;

            cleanup();

            console.log(`声临其境：已收到 LLM 执行结果 (ID: ${executeRequestId}):`, executeData);

            if (executeData.success) {
                resolve(executeData.result);
            } else {
                if (executeData.error && executeData.error.name === 'AbortError') {
                    const err = new Error(executeData.error.message);
                    err.name = 'AbortError';
                    reject(err);
                } else {
                    reject(new Error(executeData.result));
                }
            }
        };

        eventSource.on(eventNames.LLM_EXECUTE_RESPONSE, executeResponseHandler);
        eventSource.emit(eventNames.LLM_EXECUTE_REQUEST, { prompt, id: executeRequestId });

        timeoutTimer = setTimeout(() => {
            cleanup();
            reject(new Error(`LLM 执行超时（${timeoutMs}ms）`));
        }, timeoutMs);
    });
}

/**
 * 执行正文图片生成 LLM 请求
 * 
 * 功能说明：
 * - 生成唯一请求ID
 * - 通过事件系统发送LLM请求
 * - 等待响应或超时
 * - 返回生成结果或错误
 * 
 * @param {Array} prompt - 提示词数组
 * @param {Object} options - 选项
 * @param {number} options.timeoutMs - 超时时间（毫秒）
 * @returns {Promise<string>} LLM 响应结果
 */
export function LLM_IMAGE_GEN(prompt, { timeoutMs = 600000 } = {}) {
    return new Promise((resolve, reject) => {
        const executeRequestId = generateRequestId();
        const timer = debugTimer('llmRequest.LLM_IMAGE_GEN', '正文图片生成 LLM 请求');

        debugLog('llmRequest.LLM_IMAGE_GEN', 'LLM请求开始', {
            请求ID: executeRequestId,
            超时设置: `${timeoutMs}ms`,
            消息数量: prompt?.length || 0,
            功能说明: '通过事件系统发送LLM图片生成请求'
        });

        console.log(`插图吧：请求正文图片生成 LLM (ID: ${executeRequestId})`);

        let timeoutTimer = null;

        const cleanup = () => {
            eventSource.removeListener(eventNames.LLM_IMAGE_GEN_RESPONSE, executeResponseHandler);
            if (timeoutTimer) clearTimeout(timeoutTimer);
        };

        const executeResponseHandler = (executeData) => {
            if (executeData.id !== executeRequestId) return;

            cleanup();

            debugLog('llmRequest.LLM_IMAGE_GEN', 'LLM响应收到', {
                请求ID: executeRequestId,
                成功: executeData.success,
                测试模式: executeData.testMode || false,
                结果长度: executeData.result?.length || 0
            });

            console.log(`插图吧：已收到正文图片生成 LLM 执行结果 (ID: ${executeRequestId}):`, executeData);

            if (executeData.success) {
                debugBranch('LLM_IMAGE_GEN', '成功分支', true);
                // 检查是否为测试模式
                if (executeData.testMode) {
                    debugBranch('LLM_IMAGE_GEN', '测试模式响应', true);
                    timer.end('测试模式成功');
                    resolve({ result: executeData.result, testMode: true });
                } else {
                    timer.end(`成功 - 结果长度: ${executeData.result?.length || 0}`);
                    resolve({ result: executeData.result, testMode: false });
                }
            } else {
                debugBranch('LLM_IMAGE_GEN', '失败分支', true);
                debugLog('llmRequest.LLM_IMAGE_GEN', 'LLM请求失败', {
                    错误类型: executeData.error?.name || 'Unknown',
                    错误消息: executeData.error?.message || executeData.result
                });
                timer.end('失败');

                if (executeData.error && executeData.error.name === 'AbortError') {
                    debugBranch('LLM_IMAGE_GEN', '请求被中止', true);
                    const err = new Error(executeData.error.message);
                    err.name = 'AbortError';
                    reject(err);
                } else {
                    reject(new Error(executeData.result));
                }
            }
        };

        eventSource.on(eventNames.LLM_IMAGE_GEN_RESPONSE, executeResponseHandler);
        eventSource.emit(eventNames.LLM_IMAGE_GEN_REQUEST, { prompt, id: executeRequestId });

        debugLog('llmRequest.LLM_IMAGE_GEN', '已发送请求事件，等待响应', {
            事件名: eventNames.LLM_IMAGE_GEN_REQUEST
        });

        timeoutTimer = setTimeout(() => {
            cleanup();
            debugBranch('LLM_IMAGE_GEN', '超时', true);
            debugLog('llmRequest.LLM_IMAGE_GEN', 'LLM请求超时', {
                超时时间: `${timeoutMs}ms`
            });
            timer.end('超时');
            reject(new Error(`正文图片生成 LLM 执行超时（${timeoutMs}ms）`));
        }, timeoutMs);
    });
}

/**
 * 执行角色/服装设计 LLM 请求
 * @param {Array} prompt - 提示词数组
 * @param {Object} options - 选项
 * @param {number} options.timeoutMs - 超时时间（毫秒）
 * @returns {Promise<string>} LLM 响应结果
 */
export function LLM_CHAR_DESIGN(prompt, { timeoutMs = 600000 } = {}) {
    return new Promise((resolve, reject) => {
        const executeRequestId = generateRequestId();
        console.log(`插图吧：请求角色/服装设计 LLM (ID: ${executeRequestId})`);

        let timeoutTimer = null;

        const cleanup = () => {
            eventSource.removeListener(eventNames.LLM_CHAR_DESIGN_RESPONSE, executeResponseHandler);
            if (timeoutTimer) clearTimeout(timeoutTimer);
        };

        const executeResponseHandler = (executeData) => {
            if (executeData.id !== executeRequestId) return;

            cleanup();

            console.log(`插图吧：已收到角色/服装设计 LLM 执行结果 (ID: ${executeRequestId}):`, executeData);

            if (executeData.success) {
                // 检查是否为测试模式
                if (executeData.testMode) {
                    resolve({ result: executeData.result, testMode: true });
                } else {
                    resolve({ result: executeData.result, testMode: false });
                }
            } else {
                if (executeData.error && executeData.error.name === 'AbortError') {
                    const err = new Error(executeData.error.message);
                    err.name = 'AbortError';
                    reject(err);
                } else {
                    reject(new Error(executeData.result));
                }
            }
        };

        eventSource.on(eventNames.LLM_CHAR_DESIGN_RESPONSE, executeResponseHandler);
        eventSource.emit(eventNames.LLM_CHAR_DESIGN_REQUEST, { prompt, id: executeRequestId });

        timeoutTimer = setTimeout(() => {
            cleanup();
            reject(new Error(`角色/服装设计 LLM 执行超时（${timeoutMs}ms）`));
        }, timeoutMs);
    });
}

/**
 * 执行角色/服装展示 LLM 请求
 * @param {Array} prompt - 提示词数组
 * @param {Object} options - 选项
 * @param {number} options.timeoutMs - 超时时间（毫秒）
 * @returns {Promise<string>} LLM 响应结果
 */
export function LLM_CHAR_DISPLAY(prompt, { timeoutMs = 600000 } = {}) {
    return new Promise((resolve, reject) => {
        const executeRequestId = generateRequestId();
        console.log(`插图吧：请求角色/服装展示 LLM (ID: ${executeRequestId})`);

        let timeoutTimer = null;

        const cleanup = () => {
            eventSource.removeListener(eventNames.LLM_CHAR_DISPLAY_RESPONSE, executeResponseHandler);
            if (timeoutTimer) clearTimeout(timeoutTimer);
        };

        const executeResponseHandler = (executeData) => {
            if (executeData.id !== executeRequestId) return;

            cleanup();

            console.log(`插图吧：已收到角色/服装展示 LLM 执行结果 (ID: ${executeRequestId}):`, executeData);

            if (executeData.success) {
                // 检查是否为测试模式
                if (executeData.testMode) {
                    resolve({ result: executeData.result, testMode: true });
                } else {
                    resolve({ result: executeData.result, testMode: false });
                }
            } else {
                if (executeData.error && executeData.error.name === 'AbortError') {
                    const err = new Error(executeData.error.message);
                    err.name = 'AbortError';
                    reject(err);
                } else {
                    reject(new Error(executeData.result));
                }
            }
        };

        eventSource.on(eventNames.LLM_CHAR_DISPLAY_RESPONSE, executeResponseHandler);
        eventSource.emit(eventNames.LLM_CHAR_DISPLAY_REQUEST, { prompt, id: executeRequestId });

        timeoutTimer = setTimeout(() => {
            cleanup();
            reject(new Error(`角色/服装展示 LLM 执行超时（${timeoutMs}ms）`));
        }, timeoutMs);
    });
}

/**
 * 执行角色/服装修改 LLM 请求
 * @param {Array} prompt - 提示词数组
 * @param {Object} options - 选项
 * @param {number} options.timeoutMs - 超时时间（毫秒）
 * @returns {Promise<string>} LLM 响应结果
 */
export function LLM_CHAR_MODIFY(prompt, { timeoutMs = 600000 } = {}) {
    return new Promise((resolve, reject) => {
        const executeRequestId = generateRequestId();
        console.log(`插图吧：请求角色/服装修改 LLM (ID: ${executeRequestId})`);

        let timeoutTimer = null;

        const cleanup = () => {
            eventSource.removeListener(eventNames.LLM_CHAR_MODIFY_RESPONSE, executeResponseHandler);
            if (timeoutTimer) clearTimeout(timeoutTimer);
        };

        const executeResponseHandler = (executeData) => {
            if (executeData.id !== executeRequestId) return;

            cleanup();

            console.log(`插图吧：已收到角色/服装修改 LLM 执行结果 (ID: ${executeRequestId}):`, executeData);

            if (executeData.success) {
                // 检查是否为测试模式
                if (executeData.testMode) {
                    resolve({ result: executeData.result, testMode: true });
                } else {
                    resolve({ result: executeData.result, testMode: false });
                }
            } else {
                if (executeData.error && executeData.error.name === 'AbortError') {
                    const err = new Error(executeData.error.message);
                    err.name = 'AbortError';
                    reject(err);
                } else {
                    reject(new Error(executeData.result));
                }
            }
        };

        eventSource.on(eventNames.LLM_CHAR_MODIFY_RESPONSE, executeResponseHandler);
        eventSource.emit(eventNames.LLM_CHAR_MODIFY_REQUEST, { prompt, id: executeRequestId });

        timeoutTimer = setTimeout(() => {
            cleanup();
            reject(new Error(`角色/服装修改 LLM 执行超时（${timeoutMs}ms）`));
        }, timeoutMs);
    });
}

/**
 * 执行Tag修改 LLM 请求
 * @param {Array} prompt - 提示词数组
 * @param {Object} options - 选项
 * @param {number} options.timeoutMs - 超时时间（毫秒）
 * @returns {Promise<string>} LLM 响应结果
 */
export function LLM_TAG_MODIFY(prompt, { timeoutMs = 600000 } = {}) {
    return new Promise((resolve, reject) => {
        const executeRequestId = generateRequestId();
        console.log(`插图吧：请求Tag修改 LLM (ID: ${executeRequestId})`);

        let timeoutTimer = null;

        const cleanup = () => {
            eventSource.removeListener(eventNames.LLM_TAG_MODIFY_RESPONSE, executeResponseHandler);
            if (timeoutTimer) clearTimeout(timeoutTimer);
        };

        const executeResponseHandler = (executeData) => {
            if (executeData.id !== executeRequestId) return;

            cleanup();

            console.log(`插图吧：已收到Tag修改 LLM 执行结果 (ID: ${executeRequestId}):`, executeData);

            if (executeData.success) {
                // 检查是否为测试模式
                if (executeData.testMode) {
                    resolve({ result: executeData.result, testMode: true });
                } else {
                    resolve({ result: executeData.result, testMode: false });
                }
            } else {
                if (executeData.error && executeData.error.name === 'AbortError') {
                    const err = new Error(executeData.error.message);
                    err.name = 'AbortError';
                    reject(err);
                } else {
                    reject(new Error(executeData.result));
                }
            }
        };

        eventSource.on(eventNames.LLM_TAG_MODIFY_RESPONSE, executeResponseHandler);
        eventSource.emit(eventNames.LLM_TAG_MODIFY_REQUEST, { prompt, id: executeRequestId });

        timeoutTimer = setTimeout(() => {
            cleanup();
            reject(new Error(`Tag修改 LLM 执行超时（${timeoutMs}ms）`));
        }, timeoutMs);
    });
}
