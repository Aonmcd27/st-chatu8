// @ts-nocheck
import { extension_settings } from "../../../../extensions.js";
import { extensionName, EventType } from './config.js';
import { eventSource } from "../../../../../script.js";
import { addLog } from './utils.js';
import { isGenerating, startGenerating, stopGenerating } from './generation_status.js';

// A simple hashing function to create a stable, predictable ID from a string.
// Copied from iframe.js to ensure consistency.
function generateStableId(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
        const char = str.charCodeAt(i);
        hash = ((hash << 5) - hash) + char;
        hash |= 0; // Convert to 32bit integer
    }
    // Prepend a string to ensure it's a valid selector and doesn't start with a number.
    return 'chatu8-id-' + Math.abs(hash).toString(36);
}

// 使用Map存储任务，以prompt为键，方便快速查找和去重。
const pregenQueue = new Map();
let isProcessing = false;

// 定义任务的几种状态
const TaskStatus = {
    QUEUED: 'queued',
    PROCESSING: 'processing',
    COMPLETED: 'completed',
    FAILED: 'failed',
    CANCELLED: 'cancelled'
};

/**
 * 为预生成任务直接触发图像生成过程。
 * 此函数不依赖于点击DOM按钮，而是发出必要的事件来启动后端生成过程。
 * @param {object} task - 队列中的任务对象
 */
async function triggerButtonForTask(task) {
    const { prompt } = task;

    return new Promise((resolve, reject) => {
        if (isGenerating(prompt)) {
            addLog(`[Pregen] Image generation is already in progress, skipping: ${prompt}`);
            task.status = TaskStatus.COMPLETED;
            return resolve();
        }

        const requestId = generateStableId(prompt);
        startGenerating(prompt);

        const imageResponseHandler = (responseData) => {
            if (responseData.id !== requestId) return;

            eventSource.removeListener(EventType.GENERATE_IMAGE_RESPONSE, imageResponseHandler);
            addLog(`[Pregen] Response listener removed for ID: ${requestId}`);

            const { success, error, prompt: responsePrompt } = responseData;
            
            if (responsePrompt) {
                stopGenerating(responsePrompt);
            }

            if (success) {
                addLog(`[Pregen] Image generated successfully for: ${responsePrompt}`);
                task.status = TaskStatus.COMPLETED;
                resolve();
            } else {
                addLog(`[Pregen] Image generation failed for: ${responsePrompt}. Error: ${error}`);
                task.status = TaskStatus.FAILED;
                reject(new Error(error || 'Unknown generation error'));
            }
        };

        eventSource.on(EventType.GENERATE_IMAGE_RESPONSE, imageResponseHandler);
        addLog(`[Pregen] Response listener created for ID: ${requestId}`);

        const requestData = { id: requestId, prompt: prompt };
        eventSource.emit(EventType.GENERATE_IMAGE_REQUEST, requestData);
        addLog(`[Pregen] Emitted image generation request for ID: ${requestId}`);
    });
}

/**
 * 核心队列处理器。
 * 检查队列中是否有待处理的任务，并逐一执行。
 */
async function processQueue() {
    if (isProcessing) return;

    const nextTask = Array.from(pregenQueue.values()).find(task => task.status === TaskStatus.QUEUED);
    if (!nextTask) {
        isProcessing = false;
        return;
    }

    isProcessing = true;
    nextTask.status = TaskStatus.PROCESSING;
    addLog(`[Pregen] 开始处理任务: ${nextTask.prompt}`);

    try {
        await triggerButtonForTask(nextTask);
        // triggerButtonForTask 内部已将任务状态设置为COMPLETED或FAILED
    } catch (error) {
        console.error(`[Pregen] 处理任务失败 ${nextTask.prompt}:`, error);
        nextTask.status = TaskStatus.FAILED;
    } finally {
        isProcessing = false;
        // 立即尝试处理下一个任务
        setTimeout(processQueue, 100);
    }
}

/**
 * 向队列中添加新的生图任务。
 * @param {string[]} prompts - 从流式文本中解析出的prompt数组
 */
function add(prompts) {
    if (!Array.isArray(prompts)) return;

    let addedNew = false;
    prompts.forEach(prompt => {
        // 只有当任务不存在时才添加，避免重复
        if (!pregenQueue.has(prompt)) {
            pregenQueue.set(prompt, {
                prompt: prompt,
                status: TaskStatus.QUEUED
            });
            addedNew = true;
            addLog(`[Pregen] 添加到队列: ${prompt}`);
        }
    });

    if (addedNew) {
        processQueue();
    }
}

/**
 * 在新消息开始时清空队列。
 */
function clear() {
    pregenQueue.clear();
    isProcessing = false;
    addLog('[Pregen] 队列已清空。');
}

export const pregenManager = {
    add,
    clear
};
