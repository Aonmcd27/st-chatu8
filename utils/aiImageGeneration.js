/**
 * AI 助手生图功能模块
 * 通过事件系统触发图片生成请求
 */

import { EventType } from './config.js';
import { eventSource } from '../../../../../script.js';

// 生图请求队列管理
const imageGenerationQueue = new Map();
let imageGenerationIdCounter = 0;

/**
 * 请求生成图片（等待完成后返回结果）
 * @param {string} prompt - 正面提示词
 * @param {string} negative_prompt - 负面提示词
 * @param {object} options - 生图选项（宽高、步数等）
 * @returns {Promise<object>} 包含 imageUrl 的对象
 */
export async function requestImageGeneration(prompt, negative_prompt = '', options = {}) {
    console.log('[AI Image Generation] 收到生图请求:', { prompt, negative_prompt, options });

    const generationId = `ai_gen_${++imageGenerationIdCounter}_${Date.now()}`;

    // 创建生图请求记录
    imageGenerationQueue.set(generationId, {
        id: generationId,
        prompt,
        negative_prompt,
        options,
        status: 'pending',
        timestamp: Date.now(),
        imageUrl: null,
        error: null
    });

    // 创建 Promise 用于等待生图完成
    const completionPromise = new Promise((resolve, reject) => {
        // 设置超时（5分钟）
        const timeout = setTimeout(() => {
            eventSource.removeListener(EventType.GENERATE_IMAGE_RESPONSE, responseHandler);
            imageGenerationQueue.delete(generationId);
            reject(new Error('生图请求超时（5分钟）'));
        }, 5 * 60 * 1000);

        // 注册响应监听器
        const responseHandler = (responseData) => {
            if (responseData.id !== generationId) return;

            console.log('[AI Image Generation] 收到响应:', responseData);

            // 清除超时
            clearTimeout(timeout);

            // 移除监听器
            eventSource.removeListener(EventType.GENERATE_IMAGE_RESPONSE, responseHandler);

            const record = imageGenerationQueue.get(generationId);
            if (!record) {
                console.warn('[AI Image Generation] 未找到生图记录:', generationId);
                reject(new Error('未找到生图记录'));
                return;
            }

            if (responseData.success) {
                record.status = 'completed';
                // 兼容不同的响应字段名：imageData 或 imageUrl
                record.imageUrl = responseData.imageData || responseData.imageUrl;

                console.log('[AI Image Generation] 生图成功，imageUrl长度:', record.imageUrl?.length);

                // 直接返回图片数据
                resolve({
                    generationId: generationId,
                    imageUrl: record.imageUrl,
                    prompt: prompt
                });
            } else {
                record.status = 'failed';
                record.error = responseData.error || '生成失败';

                console.log('[AI Image Generation] 生图失败:', record.error);
                reject(new Error(`生图失败: ${record.error}`));
            }
        };

        eventSource.on(EventType.GENERATE_IMAGE_RESPONSE, responseHandler);
        console.log('[AI Image Generation] 已注册响应监听器:', generationId);
    });

    // 构建请求数据
    const requestData = {
        id: generationId,
        prompt: prompt,
        width: options.width || null,
        height: options.height || null
    };

    // 直接传递负面提示词字段
    if (negative_prompt) {
        requestData.negative_prompt = negative_prompt;
    }

    // 发送生图请求事件
    console.log('[AI Image Generation] 发送生图请求:', requestData);
    eventSource.emit(EventType.GENERATE_IMAGE_REQUEST, requestData);

    // 等待生图完成
    try {
        const result = await completionPromise;
        return result;
    } catch (error) {
        // 清理记录
        imageGenerationQueue.delete(generationId);
        throw error;
    }
}

// notifyImageGenerated 函数已移除，不再需要事件通知

/**
 * 获取生图状态
 * @param {string} generationId - 生图ID
 * @returns {string} 状态信息
 */
export function getImageGenerationStatus(generationId) {
    const record = imageGenerationQueue.get(generationId);
    if (!record) {
        return `未找到生图请求: ${generationId}`;
    }

    let status = `生图ID: ${generationId}\n`;
    status += `状态: ${record.status}\n`;
    status += `提示词: ${record.prompt}\n`;

    if (record.status === 'completed' && record.imageUrl) {
        status += `图片URL: ${record.imageUrl}\n`;
    } else if (record.status === 'failed' && record.error) {
        status += `错误: ${record.error}\n`;
    }

    return status;
}
