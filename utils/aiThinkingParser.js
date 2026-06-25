/**
 * AI Thinking Tag Parser
 * 
 * This module provides functions to parse and extract <think> tags from AI responses.
 * The thinking content represents the AI's internal reasoning process and is displayed
 * separately from the main response in a collapsible UI panel.
 */

/**
 * Parse thinking content from AI response
 * @param {string} text - The AI response text
 * @returns {Object} Parsed result with thinking blocks and cleaned text
 */
export function parseThinkingContent(text) {
    if (!text || typeof text !== 'string') {
        return {
            hasThinking: false,
            thinkingBlocks: [],
            cleanedText: text || ''
        };
    }

    const thinkingBlocks = [];
    let cleanedText = text;

    // 贪婪匹配：找到最后一个 </think> 标签
    // 从开头到最后一个 </think> 的所有内容都是思考内容
    const lastCloseIndex = text.lastIndexOf('</think>');

    if (lastCloseIndex !== -1) {
        // 从开头到最后一个 </think> 都是思考内容（贪婪匹配）
        const thinkingContent = text.substring(0, lastCloseIndex).trim();

        if (thinkingContent.length > 0) {
            // 移除可能存在的 <think> 标签（只保留纯内容）
            const cleanThinkingContent = thinkingContent.replace(/<\/?think>/gi, '').trim();

            if (cleanThinkingContent.length > 0) {
                // Truncate large content (>10KB)
                const truncatedContent = cleanThinkingContent.length > 10240
                    ? cleanThinkingContent.substring(0, 10240) + '\n...(内容过长已截断)'
                    : cleanThinkingContent;

                thinkingBlocks.push({
                    content: truncatedContent,
                    startIndex: 0,
                    index: 0
                });
            }
        }

        // 清理后的文本从最后一个 </think> 之后开始
        cleanedText = text.substring(lastCloseIndex + 8).trim(); // 8 = '</think>'.length
    }

    return {
        hasThinking: thinkingBlocks.length > 0,
        thinkingBlocks: thinkingBlocks,
        cleanedText: cleanedText
    };
}

/**
 * Check if text contains incomplete think tag (for streaming)
 * @param {string} text - Partial AI response
 * @returns {Object} Status of think tags
 */
export function checkIncompleteThinking(text) {
    if (!text || typeof text !== 'string') {
        return {
            hasOpenTag: false,
            hasCloseTag: false,
            isComplete: true
        };
    }

    // Count opening and closing tags
    const openMatches = text.match(/<think>/gi);
    const closeMatches = text.match(/<\/think>/gi);

    const openCount = openMatches ? openMatches.length : 0;
    const closeCount = closeMatches ? closeMatches.length : 0;

    const hasOpenTag = openCount > 0;
    const hasCloseTag = closeCount > 0;
    const isComplete = openCount === closeCount;

    return {
        hasOpenTag,
        hasCloseTag,
        isComplete
    };
}

/**
 * Extract thinking content for streaming updates
 * @param {string} text - Current accumulated text
 * @returns {Array<Object>} Thinking blocks with completion status
 */
export function extractStreamingThinking(text) {
    if (!text || typeof text !== 'string') {
        return [];
    }

    const blocks = [];

    // 贪婪匹配：找到最后一个 </think> 标签
    const lastCloseIndex = text.lastIndexOf('</think>');

    if (lastCloseIndex !== -1) {
        // 从开头到最后一个 </think> 都是思考内容（贪婪匹配）
        const thinkingContent = text.substring(0, lastCloseIndex).trim();

        if (thinkingContent.length > 0) {
            // 移除可能存在的 <think> 标签（只保留纯内容）
            const cleanThinkingContent = thinkingContent.replace(/<\/?think>/gi, '').trim();

            if (cleanThinkingContent.length > 0) {
                blocks.push({
                    content: cleanThinkingContent,
                    isComplete: true,
                    index: 0
                });
            }
        }
    } else {
        // 没有找到 </think>，说明还在流式输出思考内容
        // 移除开头可能存在的 <think> 标签
        const cleanContent = text.replace(/^<think>/i, '').trim();

        if (cleanContent.length > 0) {
            blocks.push({
                content: cleanContent,
                isComplete: false,
                index: 0
            });
        }
    }

    return blocks;
}
