/**
 * rollProcessor.js - Roll 占位符处理模块
 * 
 * 处理 prompt 中的 {{roll N}} 占位符，将其替换为基于种子的随机字符串
 */

import { getContext } from "../../../../../st-context.js";

// ==================== 配置常量 ====================

const CHARSET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
const DEFAULT_SEED_MAX = 100000;
const DEFAULT_STRING_LENGTH = 8;

// 匹配 {{roll N}} 和 {{roll 1dN}} 格式的正则表达式
const ROLL_PATTERN = /\{\{roll\s+(?:1d)?(\d+)\}\}/gi;

// ==================== 随机数生成 ====================

/**
 * 创建基于种子的伪随机数生成器 (Mulberry32 算法)
 * @param {number} seed - 种子值
 * @returns {function} 返回 0-1 之间随机数的函数
 */
function createSeededRandom(seed) {
    return function () {
        let t = seed += 0x6D2B79F5;
        t = Math.imul(t ^ t >>> 15, t | 1);
        t ^= t + Math.imul(t ^ t >>> 7, t | 61);
        return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
}

/**
 * 基于种子生成固定长度的随机字符串
 * @param {number} seed - 随机种子
 * @param {number} length - 字符串长度，默认 8
 * @returns {string} 随机字符串
 */
export function seededRandomString(seed, length = DEFAULT_STRING_LENGTH) {
    const random = createSeededRandom(seed);
    let result = '';
    for (let i = 0; i < length; i++) {
        const index = Math.floor(random() * CHARSET.length);
        result += CHARSET[index];
    }
    return result;
}

// ==================== 占位符处理 ====================

/**
 * 处理单个内容字符串中的 {{roll N}} 占位符
 * @param {string} content - 包含占位符的内容
 * @returns {string} 替换后的内容
 */
export function processRollInContent(content) {
    // 处理空值和非字符串
    if (content == null || typeof content !== 'string') {
        return content;
    }

    // 处理空字符串
    if (content === '') {
        return content;
    }

    // 替换所有 {{roll N}} 和 {{roll 1dN}} 占位符
    return content.replace(ROLL_PATTERN, (match, seedMaxStr) => {
        let seedMax = parseInt(seedMaxStr, 10);

        // 处理无效的种子上限
        if (isNaN(seedMax) || seedMax <= 0) {
            seedMax = DEFAULT_SEED_MAX;
        }

        const isDice = match.toLowerCase().includes('1d');

        // 获取角色 ID 生成固定种子 (已临时屏蔽，使用真随机)
        let seed = Math.floor(Math.random() * (seedMax + 1));

        // 临时修改：无论是否 isDice，都返回随机字符串
        return seededRandomString(seed);
    });
}

/**
 * 处理消息数组中所有的 {{roll N}} 占位符
 * @param {Array} messages - 消息数组 [{role, content}, ...]
 * @returns {Array} 处理后的消息数组
 */
export function processRollPlaceholders(messages) {
    // 处理空数组或非数组
    if (!Array.isArray(messages) || messages.length === 0) {
        return messages;
    }

    return messages.map(message => {
        // 跳过无效消息
        if (!message || typeof message !== 'object') {
            return message;
        }

        // 处理 content 字段
        if (typeof message.content === 'string') {
            return {
                ...message,
                content: processRollInContent(message.content)
            };
        }

        // 处理多模态内容（数组格式）
        if (Array.isArray(message.content)) {
            return {
                ...message,
                content: message.content.map(part => {
                    if (part && part.type === 'text' && typeof part.text === 'string') {
                        return {
                            ...part,
                            text: processRollInContent(part.text)
                        };
                    }
                    return part;
                })
            };
        }

        return message;
    });
}
