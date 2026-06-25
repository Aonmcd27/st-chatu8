// @ts-nocheck
import { extension_settings } from "../../../../../extensions.js";
import { extensionName } from '../config.js';
import { eventSource, event_types } from "../../../../../../script.js";
import { pregenManager } from "../pregen_manager.js";

/**
 * 从文本中解析出所有符合生图格式的 prompts。
 * @param {string} text - 要解析的文本
 * @returns {string[]} - 解析出的 prompt 数组
 */
function parsePrompts(text) {
    const settings = extension_settings[extensionName];
    if (!settings.startTag || !settings.endTag) return [];

    const escapeRegExp = (string) => {
        return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    };

    const start = escapeRegExp(settings.startTag);
    const end = escapeRegExp(settings.endTag);
    const pattern = new RegExp(`${start}([\\s\\S]*?)${end}`, 'g');
    
    const matches = [...text.matchAll(pattern)];
    // 清理和规范化匹配到的内容
    return matches.map(match => match[1].trim().replaceAll("《", "<").replaceAll("》", ">").replaceAll("\n", ""));

}

// 监听 AI 回复的开始，用于清空上一轮的队列
eventSource.on(event_types.generation_started, () => {
    if (String(extension_settings[extensionName].enablePregen) !== 'true') return;
    pregenManager.clear();
});

// 监听流式收到的每一个文本片段
// 根据用户反馈，'text' 参数是到当前为止的完整累积文本
eventSource.on(event_types.STREAM_TOKEN_RECEIVED, (text) => {
    if (String(extension_settings[extensionName].enablePregen) !== 'true' || !text) return;
    
    const prompts = parsePrompts(text);
    if (prompts.length > 0) {
        pregenManager.add(prompts);
    }
});
