/* global toastr */
// @ts-nocheck
/**
 * imageInserter.js - 图片插入模块
 * 
 * 图片解析和 DOM 插入逻辑
 */

import { setcharData, getcharData } from "./chatDataUtils.js";
import { getContext } from "../../../../st-context.js";
import { saveChatConditional, chat, messageFormatting, eventSource, event_types } from "../../../../../script.js";
import { extension_settings } from "../../../../extensions.js";
import { extensionName } from "./config.js";
import { debugLog, debugBranch, debugTimer, debugContent, debugElement } from "./debugLogger.js";
import { applyWordReplacement } from './settings/wordReplacement.js';

// --- images 块规范化常量 ---
const IMAGES_OPEN_RE = /<images>/i;
const IMAGES_CLOSE_RE = /<\/images>|<\\images>/i;
const IMAGE_CLOSE_RE = /<\/image>|<\\image>/gi;
const REGEX_MARKER_RE = /regex\s*:/i;
const REGEX_MARKER_GLOBAL_RE = /regex\s*:/gi;
const IMAGE_PROMPT_MARKER_RE = /image###/i;
const PROMPT_CLOSE_RE = /###/g;

/**
 * 排除思考文本（</thinking> 或 </think> 之前的内容）和已插入的图片标签
 * 使用贪婪模式匹配，确保排除所有思考内容
 * @param {string} text - 原始文本
 * @returns {string} 排除思考文本和图片标签后的内容
 */
function removeThinkingText(text) {
    if (!text || typeof text !== 'string') return text;

    let result = text;

    // 1. 移除 <think>...</think> 或 <thinking>...</thinking> 标签及其内容（全局匹配）
    const thinkTagRegex = /<think(?:ing)?[\s\S]*?<\/think(?:ing)?>/gi;
    result = result.replace(thinkTagRegex, '');

    // 2. 处理没有开始标签只有结束标签的情况（例如由于开头补全导致）
    // 使用非贪婪模式匹配从开头到第一个 </thinking> 或 </think> 的所有内容
    const thinkingRegex = /^[\s\S]*?<\/think(?:ing)?>/i;
    const beforeThinking = result;
    result = result.replace(thinkingRegex, '');

    if (result !== beforeThinking) {
        console.log('[imageInserter] Removed thinking text, length:', beforeThinking.length, '-> new length:', result.length);
    }

    // 2.5 移除 HTML 注释 <!-- ... -->
    const beforeCommentRemoval = result;
    result = result.replace(/<!--[\s\S]*?-->/g, '');
    if (result !== beforeCommentRemoval) {
        console.log('[imageInserter] Removed HTML comments, length:', beforeCommentRemoval.length, '-> new length:', result.length);
    }

    // 3. 移除已插入的 <image>...</image> 外层标签及其关联的 <font> 和 <Tag_think> 内容（全局匹配）
    // 新格式：<font color="steelblue">[描述]</font>\n<Tag_think>...</Tag_think>\n<image>...</image>
    const beforeOuterRemoval = result;
    result = result.replace(
        /(?:<font[^>]*>\[[^\]]*\]<\/font>\s*)?(?:<Tag_think>[\s\S]*?<\/Tag_think>\s*)?<image>[\s\S]*?<\/image>/g,
        ''
    );

    if (result !== beforeOuterRemoval) {
        console.log('[imageInserter] Removed <image> blocks (with font/Tag_think), length:', beforeOuterRemoval.length, '-> new length:', result.length);
    }

    // 4. 移除已插入的图片标签 image###...###（使用配置的前后缀，处理没有外层 <image> 的情况）
    const { startTag, endTag } = getImageTags();
    const escapedStart = startTag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const escapedEnd = endTag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const imageTagRegex = new RegExp(`${escapedStart}[\\s\\S]*?${escapedEnd}`, 'g');
    const beforeImageRemoval = result;
    result = result.replace(imageTagRegex, '');

    if (result !== beforeImageRemoval) {
        console.log('[imageInserter] Removed existing image### tags, length:', beforeImageRemoval.length, '-> new length:', result.length);
    }

    return result;
}

/**
 * 仅排除思考文本（</thinking> 或 </think> 之前的内容）
 * 不移除图片标签，保持文本位置与原始 DOM 一致
 * @param {string} text - 原始文本
 * @returns {string} 排除思考文本后的内容
 */
export function removeThinkingTextOnly(text) {
    if (!text || typeof text !== 'string') return text;

    let result = text;

    // 1. 移除 <think>...</think> 或 <thinking>...</thinking> 标签及其内容（全局匹配）
    const thinkTagRegex = /<think(?:ing)?[\s\S]*?<\/think(?:ing)?>/gi;
    result = result.replace(thinkTagRegex, '');

    // 2. 处理没有开始标签只有结束标签的情况（例如由于开头补全导致）
    // 使用非贪婪模式匹配从开头到第一个 </thinking> 或 </think> 的所有内容
    const thinkingRegex = /^[\s\S]*?<\/think(?:ing)?>/i;
    const beforeThinking = result;
    result = result.replace(thinkingRegex, '');

    if (result !== beforeThinking) {
        console.log('[imageInserter] Removed thinking text only, length:', beforeThinking.length, '-> new length:', result.length);
    }

    // 2.5 移除 HTML 注释 <!-- ... -->
    const beforeCommentRemoval = result;
    result = result.replace(/<!--[\s\S]*?-->/g, '');
    if (result !== beforeCommentRemoval) {
        console.log('[imageInserter] Removed HTML comments, length:', beforeCommentRemoval.length, '-> new length:', result.length);
    }

    return result;
}

/**
 * 获取配置的标签前缀和后缀，带容错
 * @returns {{startTag: string, endTag: string}}
 */
function getImageTags() {
    const settings = extension_settings[extensionName];
    const startTag = settings?.startTag || 'image###';
    const endTag = settings?.endTag || '###';
    return { startTag, endTag };
}

/**
 * 基于行匹配的模糊定位
 * 利用换行符作为天然的分隔点，找到最相似的行
 * @param {string} logicalText - 完整的逻辑文本
 * @param {string} targetSnippet - AI 提供的字符串（可能有幻觉）
 * @param {number} minSimilarity - 最低相似度阈值，默认 0.5
 * @returns {{lineIndex: number, endIndex: number, similarity: number, matchedLine: string} | null}
 */
export function fuzzyMatchLine(logicalText, targetSnippet, minSimilarity = 0.5) {
    // 按换行分割成行
    const lines = logicalText.split('\n');

    // 规范化目标字符串（移除首尾空格）
    const normalizedTarget = targetSnippet.trim();
    if (!normalizedTarget) return null;

    let bestMatch = null;
    let bestScore = 0;
    let currentIndex = 0;

    // 调试：记录前5名候选行
    const topCandidates = [];

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const lineEnd = currentIndex + line.length;

        // 计算相似度
        const score = calculateLineSimilarity(line, normalizedTarget);

        // 记录候选行（保留前5名）
        if (score > 0) {
            topCandidates.push({
                lineIndex: i,
                score: score,
                preview: line.substring(0, 50) + (line.length > 50 ? '...' : '')
            });
            topCandidates.sort((a, b) => b.score - a.score);
            if (topCandidates.length > 5) topCandidates.pop();
        }

        if (score > bestScore) {
            bestScore = score;
            bestMatch = {
                lineIndex: i,
                endIndex: lineEnd,  // 行末位置（换行符之前）
                similarity: score,
                matchedLine: line
            };
        }

        // 更新索引（+1 是换行符）
        currentIndex = lineEnd + 1;
    }

    // 调试输出：显示匹配过程
    if (topCandidates.length > 0) {
        console.log('[fuzzyMatchLine] Target:', normalizedTarget.substring(0, 40) + (normalizedTarget.length > 40 ? '...' : ''));
        console.log('[fuzzyMatchLine] Top 5 candidates:');
        topCandidates.forEach((c, idx) => {
            const isSelected = bestMatch && c.lineIndex === bestMatch.lineIndex;
            console.log(`  ${idx + 1}. [Line ${c.lineIndex}] Score: ${(c.score * 100).toFixed(1)}% ${isSelected ? '✓ SELECTED' : ''}`);
            console.log(`     "${c.preview}"`);
        });
    }

    // 总是返回概率最高的匹配，不再需要阈值检查
    if (bestMatch) {
        return bestMatch;
    }

    return null;
}

/**
 * 计算两个字符串的相似度
 * 结合多种策略：包含关系、字符频率重叠、n-gram 相似度
 * @param {string} line - 原文行
 * @param {string} target - AI 提供的目标字符串
 * @returns {number} 0-1 之间的相似度分数
 */
export function calculateLineSimilarity(line, target) {
    const normLine = line.trim().toLowerCase();
    const normTarget = target.trim().toLowerCase();

    if (!normLine || !normTarget) return 0;

    // 1. 精确包含：如果 target 是 line 的子串（加入长度惩罚）
    if (normLine.includes(normTarget)) {
        const lengthRatio = normTarget.length / normLine.length;
        return 0.9 + lengthRatio * 0.1;  // 0.9-1.0 之间，越接近长度越高分
    }
    if (normTarget.includes(normLine) && normLine.length > 10) return 0.95;

    // 2. 字符频率重叠率（修复：考虑字符重复次数）
    const charOverlap = calculateCharOverlapWithFrequency(normLine, normTarget);

    // 3. 字符级别的 n-gram 相似度（修复：动态调整 n 值）
    const ngramScore = calculateNgramSimilarity(normLine, normTarget, 3);

    // 综合评分：字符重叠和 n-gram 各占一半
    return charOverlap * 0.5 + ngramScore * 0.5;
}

/**
 * 计算字符重叠率（考虑字符频率）
 * 修复原有 Set 去重导致的问题
 * @param {string} line - 原文行
 * @param {string} target - 目标字符串
 * @returns {number} 0-1 之间的重叠率
 */
function calculateCharOverlapWithFrequency(line, target) {
    const lineChars = line.split('').filter(c => c.trim());
    const targetChars = target.split('').filter(c => c.trim());

    if (targetChars.length === 0) return 0;

    // 构建字符频率映射
    const lineFreq = {};
    for (const char of lineChars) {
        lineFreq[char] = (lineFreq[char] || 0) + 1;
    }

    // 计算匹配的字符数（考虑频率）
    let matched = 0;
    for (const char of targetChars) {
        if (lineFreq[char] > 0) {
            matched++;
            lineFreq[char]--;  // 消耗一次，避免重复计数
        }
    }

    return matched / targetChars.length;
}

/**
 * 计算 n-gram 相似度（Jaccard 相似度）
 * 修复：动态调整 n 值以支持短文本
 * @param {string} str1 - 字符串1
 * @param {string} str2 - 字符串2
 * @param {number} n - n-gram 的 n 值（默认3，会根据文本长度自动调整）
 * @returns {number} 0-1 之间的相似度分数
 */
export function calculateNgramSimilarity(str1, str2, n = 3) {
    // 动态调整 n 值：取两个字符串最小长度和 n 的较小值
    const minLen = Math.min(str1.length, str2.length);
    const actualN = Math.max(1, Math.min(n, minLen));

    const getNgrams = (str) => {
        const ngrams = new Set();
        for (let i = 0; i <= str.length - actualN; i++) {
            ngrams.add(str.substring(i, i + actualN));
        }
        return ngrams;
    };

    const ngrams1 = getNgrams(str1);
    const ngrams2 = getNgrams(str2);

    if (ngrams1.size === 0 || ngrams2.size === 0) return 0;

    let intersection = 0;
    for (const ng of ngrams1) {
        if (ngrams2.has(ng)) intersection++;
    }

    // Jaccard 相似度
    const union = ngrams1.size + ngrams2.size - intersection;
    return intersection / union;
}

// ============================================================
// images 块规范化函数
// ============================================================

export function normalizeImagesReply(input) {
    const source = typeof input === 'string' ? input : '';
    const extracted = extractImagesSection(source);

    if (!extracted.found) {
        return {
            changed: false,
            foundImagesBlock: false,
            keptEntries: 0,
            droppedEntries: 0,
            warnings: ['No <images> block found.'],
            output: source,
        };
    }

    const normalizedBlock = normalizeImagesBlock(extracted.block);
    const output =
        source.slice(0, extracted.start) +
        normalizedBlock.block +
        source.slice(extracted.end);

    const result = {
        changed: output !== source,
        foundImagesBlock: true,
        keptEntries: normalizedBlock.keptEntries,
        droppedEntries: normalizedBlock.droppedEntries,
        warnings: normalizedBlock.warnings,
        output,
    };

    if (result.changed) {
        console.log(
            '[imageBlockNormalizer] repaired image block:',
            `kept=${result.keptEntries}`,
            `dropped=${result.droppedEntries}`,
            result.warnings.length ? `warnings=${JSON.stringify(result.warnings)}` : '',
        );
    }

    return result;
}

export function extractImagesSection(input) {
    const openMatch = IMAGES_OPEN_RE.exec(input);

    if (!openMatch) {
        return { found: false, start: -1, end: -1, block: '' };
    }

    const start = openMatch.index;
    const bodyStart = start + openMatch[0].length;
    const rest = input.slice(bodyStart);
    const closeMatch = IMAGES_CLOSE_RE.exec(rest);
    const end = closeMatch ? bodyStart + closeMatch.index + closeMatch[0].length : input.length;
    const block = input.slice(start, end);

    return { found: true, start, end, block };
}

export function normalizeImagesBlock(block) {
    const warnings = [];
    const openMatch = IMAGES_OPEN_RE.exec(block);

    if (!openMatch) {
        return {
            block,
            keptEntries: 0,
            droppedEntries: 0,
            warnings: ['Malformed images block: missing <images>.'],
        };
    }

    const openEnd = openMatch.index + openMatch[0].length;
    const rest = block.slice(openEnd);
    const closeMatch = IMAGES_CLOSE_RE.exec(rest);
    const rawBody = closeMatch ? rest.slice(0, closeMatch.index) : rest;

    if (!closeMatch) {
        warnings.push('Missing </images>; auto-closed block.');
    }

    const entries = _splitEntries(rawBody);
    const normalizedEntries = [];
    let droppedEntries = 0;

    for (const entry of entries) {
        const normalizedEntry = _normalizeEntry(entry);
        if (!normalizedEntry) {
            droppedEntries += 1;
            continue;
        }
        normalizedEntries.push(normalizedEntry);
    }

    if (entries.length === 0) {
        warnings.push('No candidate image entries found inside <images>.');
    }

    if (droppedEntries > 0) {
        warnings.push(`Dropped ${droppedEntries} malformed image entr${droppedEntries === 1 ? 'y' : 'ies'}.`);
    }

    const body = normalizedEntries.join('\n');
    const normalizedBlock = body
        ? `<images>\n${body}\n</images>`
        : '<images>\n</images>';

    return {
        block: normalizedBlock,
        keptEntries: normalizedEntries.length,
        droppedEntries,
        warnings,
    };
}

function _splitEntries(rawBody) {
    const body = rawBody
        .replace(/<\\images>/gi, '')
        .replace(/<image>/gi, '')
        .replace(/<\\image>/gi, '</image>')
        .replace(/<\/image>/gi, '')
        .trim();

    if (!body) {
        return [];
    }

    const regexPositions = _collectMatchIndexes(body, REGEX_MARKER_GLOBAL_RE);
    if (regexPositions.length > 0) {
        const chunks = [];
        const firstRegexIndex = regexPositions[0];
        const leadingChunk = body.slice(0, firstRegexIndex).trim();

        if (leadingChunk) {
            chunks.push(leadingChunk);
        }

        return chunks.concat(_sliceByPositions(body, regexPositions));
    }

    return [body];
}

function _normalizeEntry(entry) {
    const cleaned = entry
        .replace(IMAGE_CLOSE_RE, '')
        .replace(/<\/images>|<\\images>/gi, '')
        .replace(/<\/?tr>/gi, '')
        .replace(/<\/?table>/gi, '')
        .trim();

    if (!cleaned) {
        return null;
    }

    const regexIndex = cleaned.search(REGEX_MARKER_RE);
    const imagePromptIndex = cleaned.search(IMAGE_PROMPT_MARKER_RE);

    if (regexIndex === -1 || imagePromptIndex === -1) {
        return null;
    }

    const regexPart = _extractRegexPart(cleaned.slice(regexIndex, imagePromptIndex));
    const middlePart = cleaned.slice(regexIndex + regexPart.length, imagePromptIndex).trim();
    const imagePromptPart = _normalizeImagePromptPart(cleaned.slice(imagePromptIndex));

    if (!REGEX_MARKER_RE.test(regexPart) || !IMAGE_PROMPT_MARKER_RE.test(imagePromptPart)) {
        return null;
    }

    const inner = [regexPart, middlePart, imagePromptPart].filter(Boolean).join('\n');
    return `<image>\n${inner}\n</image>`;
}

function _extractRegexPart(text) {
    const trimmed = text.trim();
    const firstLine = trimmed
        .split('\n')
        .map((line) => line.trim())
        .find((line) => REGEX_MARKER_RE.test(line));
    return firstLine || trimmed;
}

function _normalizeImagePromptPart(text) {
    const trimmed = text.trim();
    const markerIndex = trimmed.search(IMAGE_PROMPT_MARKER_RE);

    if (markerIndex === -1) {
        return '';
    }

    const fromMarker = trimmed.slice(markerIndex).trim();
    const afterMarker = fromMarker.slice('image###'.length);
    const closeMatch = PROMPT_CLOSE_RE.exec(afterMarker);
    PROMPT_CLOSE_RE.lastIndex = 0;

    if (closeMatch) {
        const content = afterMarker.slice(0, closeMatch.index).trim();
        return `image### ${content} ###`;
    }

    const content = afterMarker.trim();
    return `image### ${content} ###`;
}

function _collectMatchIndexes(text, regex) {
    const indexes = [];
    regex.lastIndex = 0;
    let match = regex.exec(text);
    while (match) {
        indexes.push(match.index);
        match = regex.exec(text);
    }
    regex.lastIndex = 0;
    return indexes;
}

function _sliceByPositions(text, positions) {
    const chunks = [];
    for (let i = 0; i < positions.length; i += 1) {
        const start = positions[i];
        const end = i + 1 < positions.length ? positions[i + 1] : text.length;
        const chunk = text.slice(start, end).trim();
        if (chunk) {
            chunks.push(chunk);
        }
    }
    return chunks;
}

/**
 * 将新版的纯 XML 图片格式转换为旧版格式
 * @param {string} text - 原始文本
 * @returns {string} 转换后的文本
 */
export function convertNewXmlFormatToOld(text) {
    if (!text || typeof text !== 'string') return text;
    
    // 提取所有的 <images> 块
    const imagesMatches = [...text.matchAll(/<images>([\s\S]*?)<\/images>/gi)];
    if (imagesMatches.length === 0) return text;
    
    // 目标：只处理最后一个 <images> 块
    const lastMatch = imagesMatches[imagesMatches.length - 1];
    const rawImagesInner = lastMatch[1];
    
    // 检查是否为新版格式（是否包含 <prompts> 或 <title_styled>）
    if (!/<prompts>|<title_styled>/i.test(rawImagesInner)) {
        return text;
    }
    
    // 是新格式，进行转换
    const newInner = rawImagesInner.replace(/<image>([\s\S]*?)<\/image>/gi, (match, imageInner) => {
        // 提取 regex
        const regexMatch = imageInner.match(/<regex>([\s\S]*?)<\/regex>/i);
        const regexStr = regexMatch ? `regex:${regexMatch[1].trim()}` : '';
        
        // 提取 title_styled
        const titleMatch = imageInner.match(/<title_styled>([\s\S]*?)<\/title_styled>/i);
        const titleStr = titleMatch ? `<font color="steelblue">[${titleMatch[1].trim()}]</font>` : '';
        
        // 提取 Tag_think
        const tagThinkMatch = imageInner.match(/<Tag_think>([\s\S]*?)<\/Tag_think>/i);
        const tagThinkStr = tagThinkMatch ? `<Tag_think>\n${tagThinkMatch[1].trim()}\n</Tag_think>` : '';
        
        // 提取 size，支持中英文逗号分割取最后一项
        const sizeMatch = imageInner.match(/<size>([\s\S]*?)<\/size>/i);
        let sizeResolution = '';
        if (sizeMatch) {
            // 将中文逗号替换为英文逗号并分割
            const sizeParts = sizeMatch[1].trim().replace(/，/g, ',').split(',');
            if (sizeParts.length > 0) {
                // 取逗号最后一部分作为纯分辨率（例如 1024x1024）
                sizeResolution = sizeParts[sizeParts.length - 1].trim();
            }
        }
        
        // 提取 prompts
        const promptsMatch = imageInner.match(/<prompts>([\s\S]*?)<\/prompts>/i);
        let promptStr = '';
        if (promptsMatch) {
            const promptsInner = promptsMatch[1];
            
            // 提取 scene_composition 和 character_X
            const sceneMatch = promptsInner.match(/<scene_composition>([\s\S]*?)<\/scene_composition>/i);
            const charRegex = /<character_(\d+)>([\s\S]*?)<\/character_\1>/gi;
            const charMatches = [...promptsInner.matchAll(charRegex)];
            
            // 如果存在 scene_composition 或 character_X，说明是复杂格式
            if (sceneMatch || charMatches.length > 0) {
                let sceneContent = sceneMatch ? sceneMatch[1].trim() : '';
                
                // 如果解析到了分辨率，将其加在 scene_composition 末尾
                if (sizeResolution) {
                    if (sceneContent && !sceneContent.endsWith(',')) {
                        sceneContent += ',';
                    }
                    sceneContent += sizeResolution;
                }
                const sceneStr = sceneContent ? `Scene Composition:${sceneContent};` : '';
                
                let charactersStr = '';
                for (const charMatch of charMatches) {
                    const charIndex = charMatch[1];
                    const charInner = charMatch[2];
                    
                    const cPromptMatch = charInner.match(/<prompt>([\s\S]*?)<\/prompt>/i);
                    const cPrompt = cPromptMatch ? cPromptMatch[1].trim() : '';
                    
                    const centersMatch = charInner.match(/<centers>([\s\S]*?)<\/centers>/i);
                    const centers = centersMatch ? centersMatch[1].trim() : '';
                    
                    const ucMatch = charInner.match(/<uc>([\s\S]*?)<\/uc>/i);
                    const uc = ucMatch ? ucMatch[1].trim() : '';
                    
                    if (cPrompt || centers) {
                        charactersStr += `Character ${charIndex} Prompt:${cPrompt}|centers:${centers};\n`;
                    }
                    if (uc) {
                        charactersStr += `Character ${charIndex} UC:${uc};\n`;
                    }
                }
                
                // 拼接提示词块
                const combinedPrompts = [sceneStr, charactersStr].filter(s => s.trim()).join('\n').trim();
                if (combinedPrompts) {
                    promptStr = `image###${combinedPrompts}###`;
                }
            } else {
                // 否则认为是简易无分角色格式
                let rawPrompts = promptsInner.trim();
                
                // 如果解析到了分辨率，将其加在 tag 末尾
                if (sizeResolution) {
                    if (rawPrompts && !rawPrompts.endsWith(',')) {
                        rawPrompts += ',';
                    }
                    rawPrompts += sizeResolution;
                }
                
                if (rawPrompts) {
                    promptStr = `image###${rawPrompts}###`;
                }
            }
        }
        
        // 把转换后的内容拼在一起
        const finalImageInner = [regexStr, titleStr, tagThinkStr, promptStr].filter(s => s.trim()).join('\n');
        return `<image>\n${finalImageInner}\n</image>`;
    });
    
    const newImagesBlock = `<images>\n${newInner}\n</images>`;
    
    // 只替换最后一个块
    const beforeLast = text.substring(0, lastMatch.index);
    const afterLast = text.substring(lastMatch.index + lastMatch[0].length);
    
    return beforeLast + newImagesBlock + afterLast;
}

/**
 * 从 LLM 输出中解析 images
 * 解析流程：
 * 1. 先提取 <images>...</images> 区域（如果存在）
 * 2. 在该区域内用 <image>...</image> 分割出各个图片块
 * 3. 在每个图片块内解析 regex: 和 image###...###
 * @param {string} text - LLM 输出的文本
 * @returns {Array<{regex: string, tag: string}>} 解析出的 images 数组
 */
export function parseImagesFromPrompt(text) {
    const timer = debugTimer('imageInserter.parseImagesFromPrompt', '解析 LLM 输出中的图片标签');
    const images = [];

    if (!text || typeof text !== 'string') {
        debugBranch('parseImagesFromPrompt', '输入无效 - 跳过', true, {
            输入类型: typeof text,
            是否为空: !text
        });
        timer.end('输入无效');
        return images;
    }

    // 词汇替换（AI返回替换）- 替代原本的 safe_ 硬编码移除，根据用户配置执行纯文本替换
    text = applyWordReplacement(text, 'ai');

    // ========== 新增此行：在一切解析开始前，先剥离掉思考块内容 ==========
    text = removeThinkingTextOnly(text);

    debugLog('imageInserter.parseImagesFromPrompt', '开始解析', {
        文本长度: text.length
    });
    debugContent('parseImagesFromPrompt', 'LLM 原始输出', text, 500);

    console.log('[parseImagesFromPrompt] 开始解析，文本长度:', text.length);

    // 首先执行新版 XML 格式到旧版格式的转换
    const convertedText = convertNewXmlFormatToOld(text);
    if (convertedText !== text) {
        text = convertedText;
        console.log('[parseImagesFromPrompt] 检测到新版 XML 格式并转换为旧版兼容格式，新长度:', text.length);
        debugBranch('parseImagesFromPrompt', '格式转换', true, {
            备注: '将新版 XML 图片格式转换为兼容格式'
        });
    }

    // 预处理：规范化 <images> 块（修复 <\images>、缺失闭合标签、<table>/<tr> 包裹等问题）
    const _normResult = normalizeImagesReply(text);
    if (_normResult.changed) {
        text = _normResult.output;
        console.log('[parseImagesFromPrompt] images 块已规范化，新长度:', text.length,
            _normResult.warnings.length ? `warnings=${JSON.stringify(_normResult.warnings)}` : '');
    }

    // 第一步：提取 <images>...</images> 区域（如果存在多个，合并所有内容）
    let searchText = text;
    const imagesContainerRegex = /<images>([\s\S]*?)<\/images>/g;
    const allImagesMatches = [...text.matchAll(imagesContainerRegex)];

    if (allImagesMatches.length > 0) {
        // 合并所有 <images> 块的内容
        searchText = allImagesMatches.map(match => match[1]).join('\n');
        debugBranch('parseImagesFromPrompt', '找到 <images> 容器', true, {
            容器数量: allImagesMatches.length,
            合并后长度: searchText.length
        });
        console.log('[parseImagesFromPrompt] 找到', allImagesMatches.length, '个 <images> 容器，已合并所有内容（总长度:', searchText.length, '）');
    } else {
        debugBranch('parseImagesFromPrompt', '未找到 <images> 容器 - 使用完整文本', true);
        console.log('[parseImagesFromPrompt] 未找到 <images> 容器，使用完整文本');
    }

    // 第二步：在 <images> 区域内匹配所有 <image>...</image> 标签
    const imageRegex = /<image>([\s\S]*?)<\/image>/g;
    const imageBlocks = [];
    let imageMatch;

    while ((imageMatch = imageRegex.exec(searchText)) !== null) {
        imageBlocks.push({
            fullMatch: imageMatch[0],
            content: imageMatch[1],
            startIndex: imageMatch.index
        });
    }

    debugLog('imageInserter.parseImagesFromPrompt', '找到 <image> 块', {
        块数量: imageBlocks.length
    });
    console.log('[parseImagesFromPrompt] 找到', imageBlocks.length, '个 <image> 块');

    // 第二步：在每个 <image> 块内解析
    for (let i = 0; i < imageBlocks.length; i++) {
        const block = imageBlocks[i];
        const imageContent = block.content;

        console.log(`[parseImagesFromPrompt] 解析第 ${i + 1} 个 <image> 块，内容长度: ${imageContent.length}`);

        // 解析 regex: 后面的文本
        // 优先从 <imgthink> 标签内获取，如果没有则直接从 <image> 内容中获取
        let regexText = '';
        const imgthinkRegex = /<imgthink>([\s\S]*?)<\/imgthink>/;
        const imgthinkMatch = imageContent.match(imgthinkRegex);

        if (imgthinkMatch) {
            const imgthinkContent = imgthinkMatch[1];
            // 匹配 regex: 后面的内容（直到换行或标签结束）
            const regexLineMatch = imgthinkContent.match(/regex:(.*?)(?:\n|$)/);
            if (regexLineMatch) {
                regexText = regexLineMatch[1].trim();
            }
        }

        // 如果 imgthink 中没有找到 regex，则直接从 image 内容中查找
        if (!regexText) {
            const directRegexMatch = imageContent.match(/regex:(.*?)(?:\n|$)/);
            if (directRegexMatch) {
                regexText = directRegexMatch[1].trim();
            }
        }

        // 第三步：根据 tagthinkEcho 设置决定 tag 内容
        // tagthinkEcho 关闭时：仅提取 image@@@...@@@ 里的内容，并重新包裹
        // tagthinkEcho 开启时：保留整个 <image> 内容（去掉 regex: 行）
        const tagthinkEchoEnabled = String(extension_settings[extensionName]?.tagthinkEcho) === 'true';
        const { startTag, endTag } = getImageTags();
        let tag;

        if (!tagthinkEchoEnabled) {
            // 仅提取 image@@@...@@@ 里的内容，然后重新包裹
            const escapedStart = startTag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            const escapedEnd = endTag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            const pureTagRegex = new RegExp(`${escapedStart}([\\s\\S]*?)${escapedEnd}`);
            const pureTagMatch = imageContent.match(pureTagRegex);
            const pureContent = pureTagMatch ? pureTagMatch[1].trim() : '';
            // 重新用 startTag 和 endTag 包裹（insertOriginalText 模式需要带前后缀）
            tag = pureContent ? `${startTag}${pureContent}${endTag}` : '';
            console.log(`[parseImagesFromPrompt] tagthinkEcho=false, 仅提取纯 tag: "${tag.substring(0, 50)}..."`);
        } else {
            // 保留整个内容，只移除 regex: 行
            tag = imageContent.replace(/regex:.*?(?:\n|$)/g, '').trim();
            console.log(`[parseImagesFromPrompt] tagthinkEcho=true, 保留完整内容: "${tag.substring(0, 50)}..."`);
        }

        console.log(`[parseImagesFromPrompt] 块 ${i + 1} 结果: regex="${regexText.substring(0, 30)}...", tag="${tag.substring(0, 50)}..."`);

        // 记录每个块的解析结果
        debugLog('imageInserter.parseImagesFromPrompt', `块 ${i + 1} 解析结果`, {
            索引: i + 1,
            有regex: !!regexText,
            regex预览: regexText ? regexText.substring(0, 40) : '(无)',
            有tag: !!tag,
            tag长度: tag.length
        });

        // 只有当 regex 和 tag 都有值时才添加到数组
        if (regexText && tag) {
            // 对生成的提示词（tag）进行中文符号的安全清洗
            tag = tag.replace(/，/g, ',').replace(/；/g, ';').replace(/：/g, ':');

            images.push({
                regex: regexText,
                tag: tag
            });
            debugBranch('parseImagesFromPrompt', `块 ${i + 1} 有效 - 已添加`, true);
        } else {
            debugBranch('parseImagesFromPrompt', `块 ${i + 1} 无效 - 跳过`, true, {
                原因: !regexText ? '缺少regex' : '缺少tag'
            });
        }
    }

    console.log('[parseImagesFromPrompt] 解析完成，共', images.length, '个有效图片');

    // ★ 详细打印每个解析结果，方便调试
    console.group('[parseImagesFromPrompt] 解析结果详情');
    for (let i = 0; i < images.length; i++) {
        console.group(`图片 ${i + 1}`);
        console.log('regex:', images[i].regex);
        console.log('tag 完整内容:');
        console.log(images[i].tag);
        console.groupEnd();
    }
    console.groupEnd();

    debugLog('imageInserter.parseImagesFromPrompt', '解析完成', {
        总块数: imageBlocks.length,
        有效图片数: images.length
    });
    timer.end(`解析到 ${images.length} 个有效图片`);

    // ★ 添加解析失败的 toastr 提示
    if (imageBlocks.length > 0 && images.length === 0) {
        toastr.warning(`LLM 输出解析失败：检测到 <image> 标签但未能解析出有效数据。请检查 LLM 输出格式是否包含 regex: 行。`);
    }

    return images;
}

/**
 * 将 images 插入到 el 元素的文本节点中
 * 使用 image 里的 regex 定位文本位置，在匹配文本后面插入 image 标签
 * 标签由 iframe.js 的 findAndReplaceInElement 函数统一处理生成按钮
 * @param {HTMLElement} rootElement - 要处理的根元素
 * @param {Array<{regex: string, tag: string}>} images - 解析出的 images 数组
 */
export async function insertImagesIntoElement(rootElement, images) {
    const timer = debugTimer('imageInserter.insertImagesIntoElement', '将图片标签插入到 DOM');

    if (!rootElement || !images || images.length === 0) {
        debugBranch('insertImagesIntoElement', '输入无效 - 跳过', true, {
            有rootElement: !!rootElement,
            有images: !!images,
            images数量: images?.length || 0
        });
        timer.end('输入无效');
        return;
    }

    debugLog('imageInserter.insertImagesIntoElement', '开始插入图片标签', {
        待插入数量: images.length
    });
    debugElement('insertImagesIntoElement', '目标根元素', rootElement);

    const doc = rootElement.ownerDocument || document;

    // 0. 删除已存在的 image 相关元素（重 roll 时清理旧的）
    // 删除 image-tag-button 按钮
    const existingButtons = rootElement.querySelectorAll('.image-tag-button, .st-chatu8-image-button');
    existingButtons.forEach(btn => btn.remove());

    // 删除 st-chatu8-image-span 容器
    const existingSpans = rootElement.querySelectorAll('.st-chatu8-image-span');
    existingSpans.forEach(span => span.remove());

    // 删除 st-chatu8-image-container 容器
    const existingContainers = rootElement.querySelectorAll('.st-chatu8-image-container');
    existingContainers.forEach(container => container.remove());

    // 删除 st-chatu8-collapse-wrapper 折叠容器
    const existingCollapseWrappers = rootElement.querySelectorAll('.st-chatu8-collapse-wrapper');
    existingCollapseWrappers.forEach(wrapper => wrapper.remove());

    debugLog('imageInserter.insertImagesIntoElement', '清理旧元素完成', {
        清理按钮数: existingButtons.length,
        清理容器数: existingContainers.length + existingSpans.length + existingCollapseWrappers.length
    });
    console.log('[insertImagesIntoElement] Cleaned up existing image elements');

    // ========== insertOriginalText 快速路径 ==========
    // 如果 insertOriginalText 开启且 mes.length >= 100，直接用原文匹配，跳过 DOM 逻辑
    const insertOriginalTextEnabled = String(extension_settings[extensionName]?.insertOriginalText) === 'true';
    if (insertOriginalTextEnabled) {
        const mesText = findMesTextFromElement(rootElement);
        if (mesText) {
            const mesBlock = mesText.closest('.mes');
            const mesId = parseInt(mesBlock?.getAttribute('mesid'), 10);
            if (!isNaN(mesId) && chat[mesId] && chat[mesId].mes && chat[mesId].mes.length >= 100) {
                console.log('[insertImagesIntoElement] insertOriginalText 快速路径 - 直接用原文匹配');
                debugLog('imageInserter.insertImagesIntoElement', 'insertOriginalText 快速路径', {
                    mesId: mesId,
                    mes长度: chat[mesId].mes.length
                });
                // 直接调用 saveImageGroup，它会用 chat[mesId].mes 原文匹配并插入，然后 renderMessage 渲染
                await saveImageGroup(images, '', rootElement);
                timer.end('insertOriginalText 快速路径完成');
                return;
            } else {
                console.log('[insertImagesIntoElement] insertOriginalText 条件不满足，退回 DOM 逻辑');
            }
        }
    }

    // 1. 使用 TreeWalker 构建文本节点列表和逻辑文本
    // ★ 非 insertOriginalText 模式下，标记第一个直接子 <div> 元素，后续匹配时排除其文本范围
    const firstDirectDiv = !insertOriginalTextEnabled ? rootElement.querySelector(':scope > div') : null;
    if (firstDirectDiv) {
        console.log('[insertImagesIntoElement] Will exclude first direct <div> from matching:', firstDirectDiv.textContent?.substring(0, 50));
    }

    const nodeInfos = [];
    let logicalText = '';
    let firstDivStartOffset = -1;  // 第一个 <div> 在 logicalText 中的起始位置
    let firstDivEndOffset = -1;    // 第一个 <div> 在 logicalText 中的结束位置
    const walker = doc.createTreeWalker(rootElement, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT, {
        acceptNode: function (node) {
            const parentTag = node.parentElement?.tagName;
            if (node.nodeType === Node.ELEMENT_NODE && node.tagName !== 'BR') {
                return NodeFilter.FILTER_SKIP;
            }
            if (parentTag === 'SCRIPT' || parentTag === 'STYLE' || parentTag === 'BUTTON' ||
                node.parentElement?.classList.contains('image-tag-button') ||
                node.parentElement?.classList.contains('st-chatu8-image-span')) {
                return NodeFilter.FILTER_REJECT;
            }
            return NodeFilter.FILTER_ACCEPT;
        }
    });

    let n;
    while (n = walker.nextNode()) {
        const start = logicalText.length;
        let text = '';
        if (n.nodeType === Node.TEXT_NODE) {
            text = n.textContent;
        } else if (n.tagName === 'BR') {
            text = '\n';
        }

        // ★ 追踪第一个直接子 <div> 的文本范围
        if (firstDirectDiv && text.length > 0) {
            // 检查当前节点是否在第一个直接子 <div> 内部
            const isInFirstDiv = (n === firstDirectDiv || firstDirectDiv.contains(n));
            if (isInFirstDiv) {
                if (firstDivStartOffset === -1) {
                    firstDivStartOffset = start;
                }
                firstDivEndOffset = start + text.length;
            }
        }

        logicalText += text;
        nodeInfos.push({ node: n, start: start, end: logicalText.length });
    }

    if (logicalText.length === 0) return;

    if (firstDirectDiv && firstDivStartOffset !== -1) {
        console.log(`[insertImagesIntoElement] First <div> text range in logicalText: [${firstDivStartOffset}, ${firstDivEndOffset})`);
    }

    // 1.6 排除思考文本（</thinking> 或 </think> 之前的内容）和第一个 <div> 的内容
    // 避免思考文本中出现的原文片段导致图片标签插入到错误位置
    // 注意：不移除已插入的图片标签，因为那会导致 endIndex 与 nodeInfos 不一致

    // ★ 非 insertOriginalText 模式下，先从 logicalText 中移除第一个直接子 <div> 的内容
    // 再排除思考文本。这确保偏移量基于原始 logicalText，不会因为思考文本移除而错位
    let logicalTextForMatch = logicalText;
    if (firstDirectDiv && firstDivStartOffset !== -1 && firstDivEndOffset > firstDivStartOffset) {
        const beforeDiv = logicalTextForMatch.substring(0, firstDivStartOffset);
        const afterDiv = logicalTextForMatch.substring(firstDivEndOffset);
        logicalTextForMatch = beforeDiv + afterDiv;
        console.log(`[insertImagesIntoElement] Excluded first <div> text from matching (removed ${firstDivEndOffset - firstDivStartOffset} chars)`);
    }
    logicalTextForMatch = removeThinkingTextOnly(logicalTextForMatch);

    // ★ 计算思考文本在原始 logicalText 中的结束位置
    // 用于重映射时从思考文本之后开始搜索，避免匹配到思考文本中的相同内容
    let thinkingEndOffsetDOM = 0;
    {
        let tempText = logicalText;
        tempText = tempText.replace(/<think(?:ing)?[\s\S]*?<\/think(?:ing)?>/gi, '');
        const thinkEndMatch = tempText.match(/^[\s\S]*<\/think(?:ing)?>/i);
        if (thinkEndMatch) {
            thinkingEndOffsetDOM = thinkEndMatch[0].length;
        }
        if (thinkingEndOffsetDOM === 0) {
            const originalThinkMatch = logicalText.match(/^[\s\S]*<\/think(?:ing)?>/i);
            if (originalThinkMatch) {
                thinkingEndOffsetDOM = originalThinkMatch[0].length;
            }
        }
    }

    // 1.5 对于 image_groups 的情况，获取锁定的旧 tag 并合并到 images 中一起插入
    // 这确保锁定的 tag 在重新生成时不会丢失
    const elKey = generateElKey(logicalText);
    if (elKey) {
        try {
            const imageGroups = await getcharData('image_groups') || {};
            const existingImages = imageGroups[elKey] || [];
            const lockedImages = existingImages.filter(img => img.locked === true);

            if (lockedImages.length > 0) {
                console.log('[insertImagesIntoElement] Found', lockedImages.length, 'locked images in image_groups, merging...');
                // 将锁定的旧 tag 添加到 images 数组的开头（确保它们也被插入）
                // 过滤掉与新 images 中重复的 tag
                const newTags = new Set(images.map(img => img.tag?.trim()));
                const lockedToAdd = lockedImages.filter(img => !newTags.has(img.tag?.trim()));
                images = [...lockedToAdd, ...images];
                console.log('[insertImagesIntoElement] After merging locked images:', images.length, 'total');
            }
        } catch (e) {
            console.warn('[insertImagesIntoElement] Error getting locked images from image_groups:', e);
        }
    }

    // 2. 为每个 image 使用模糊匹配找到最相似的行
    const matches = [];
    for (const image of images) {
        if (!image.regex || !image.tag) {
            debugBranch('insertImagesIntoElement', `跳过无效 image (缺少regex或tag)`, true);
            continue;
        }

        // 使用模糊行匹配代替精确正则匹配
        // 注意：使用排除思考文本后的 logicalTextForMatch 进行匹配
        const matchResult = fuzzyMatchLine(logicalTextForMatch, image.regex, 0.5);

        if (matchResult) {
            // ★ 关键修复：matchResult.endIndex 是相对于 logicalTextForMatch 的位置
            // 需要用匹配到的行内容在原始 logicalText 中重新定位 endIndex
            let correctEndIndex = matchResult.endIndex;
            const matchedLine = matchResult.matchedLine;

            // 在原始 logicalText 中查找该行的位置（跳过思考文本和第一个 div 的范围）
            const searchStartOffset = Math.max(thinkingEndOffsetDOM, firstDivEndOffset > 0 ? firstDivEndOffset : 0);
            let lineIndexInOriginal = logicalText.indexOf(matchedLine, searchStartOffset);
            // 备选：如果在排除区域之后找不到，尝试全文搜索
            if (lineIndexInOriginal === -1) {
                lineIndexInOriginal = logicalText.indexOf(matchedLine);
            }
            if (lineIndexInOriginal !== -1) {
                // 找到了，计算正确的 endIndex（行末位置）
                correctEndIndex = lineIndexInOriginal + matchedLine.length;
                console.log(`[insertImagesIntoElement] Remapped endIndex: ${matchResult.endIndex} -> ${correctEndIndex}`);
            } else {
                console.warn(`[insertImagesIntoElement] Could not find matched line in original logicalText, using original endIndex`);
            }

            matches.push({
                endIndex: correctEndIndex,
                tag: image.tag,
                matchText: matchResult.matchedLine,  // 使用实际匹配到的行（正确的文本）
                similarity: matchResult.similarity,
                aiRegex: image.regex  // 保留 AI 原始的 regex 用于调试
            });
            debugLog('imageInserter.insertImagesIntoElement', '模糊匹配成功', {
                相似度: `${(matchResult.similarity * 100).toFixed(1)}%`,
                AI_regex: image.regex.substring(0, 40),
                匹配行: matchResult.matchedLine.substring(0, 40),
                位置: correctEndIndex
            });
            console.log(`[insertImagesIntoElement] Fuzzy matched with ${(matchResult.similarity * 100).toFixed(1)}% similarity`);
            console.log(`  AI regex: "${image.regex}"`);
            console.log(`  Matched line: "${matchResult.matchedLine}"`);
        } else {
            debugBranch('insertImagesIntoElement', `模糊匹配失败`, true, {
                AI_regex: image.regex
            });
            console.warn('[insertImagesIntoElement] No fuzzy match found for:', image.regex);
            // 输出完整原文和分割后的行，帮助调试
            console.group('[insertImagesIntoElement] 模糊匹配调试信息');
            console.log('目标 regex:', image.regex);
            console.log('logicalTextForMatch 总长度:', logicalTextForMatch.length);
            console.log('logicalTextForMatch 完整内容:', logicalTextForMatch);
            const debugLines = logicalTextForMatch.split('\n');
            console.log('分割后行数:', debugLines.length);
            console.log('每行内容:');
            debugLines.forEach((line, idx) => {
                // 检查该行是否包含 regex 中的关键字
                const contains = line.includes(image.regex) || image.regex.includes(line);
                console.log(`  [${idx}]${contains ? ' ★' : ''}: "${line}"`);
            });
            console.groupEnd();
        }
    }

    if (matches.length === 0) {
        debugBranch('insertImagesIntoElement', '没有任何匹配 - 结束', true);
        timer.end('没有匹配');
        console.log('[insertImagesIntoElement] No matches found for any image regex');
        toastr.warning('图片标签全部无法插入：所有 regex 都未能在原文中找到匹配位置。请检查 LLM 生成的定位文本是否存在于当前消息中。');
        return;
    }

    // 2.5 对 matches 进行去重（基于 regex 或 tag 相同）
    const seenRegex = new Set();
    const seenTags = new Set();
    const uniqueMatches = [];
    for (const match of matches) {
        const regexKey = match.aiRegex?.trim().toLowerCase();
        const tagKey = match.tag?.trim().toLowerCase();
        // 如果 regex 或 tag 已存在，则跳过
        if ((regexKey && seenRegex.has(regexKey)) || (tagKey && seenTags.has(tagKey))) {
            console.log(`[insertImagesIntoElement] Skipping duplicate - regex: "${match.aiRegex}", tag: "${match.tag}"`);
            continue;
        }
        if (regexKey) seenRegex.add(regexKey);
        if (tagKey) seenTags.add(tagKey);
        uniqueMatches.push(match);
    }

    debugLog('imageInserter.insertImagesIntoElement', '去重完成', {
        去重前: matches.length,
        去重后: uniqueMatches.length
    });
    console.log(`[insertImagesIntoElement] After deduplication: ${uniqueMatches.length} unique matches (from ${matches.length})`);

    // 替换 matches 为去重后的数组
    matches.length = 0;
    matches.push(...uniqueMatches);

    // 收集位置信息用于保存（使用匹配行的最后 40 个字符作为 regex，确保在 iframe 的 50 字符窗口内可以匹配）
    const positionedImages = matches.map(m => {
        // 截取匹配行的最后 40 个字符，确保足够短以在 50 字符窗口内找到
        const maxRegexLen = 40;
        const regexToSave = m.matchText.length > maxRegexLen
            ? m.matchText.slice(-maxRegexLen)
            : m.matchText;
        return {
            endIndex: m.endIndex,
            regex: regexToSave,  // 使用截取后的字符串作为 regex
            tag: m.tag
        };
    });

    // 按 endIndex 降序排序，从后往前处理避免索引偏移
    matches.sort((a, b) => b.endIndex - a.endIndex);

    console.log('[insertImagesIntoElement] Found matches:', matches);

    // ★ 非 insertOriginalText 模式：只保存数据，不插入 DOM
    // 让 iframe/placeholder.js 的轮询机制统一处理插入，避免重复插入
    // 注意：insertOriginalTextEnabled 已在函数开头（约第 501 行）声明
    if (!insertOriginalTextEnabled) {
        debugLog('imageInserter.insertImagesIntoElement', '非 insertOriginalText 模式 - 只保存数据，跳过 DOM 插入', {
            匹配数量: matches.length
        });
        console.log('[insertImagesIntoElement] Non-insertOriginalText mode - saving data only, skipping DOM insertion');

        // 保存位置信息（传入 rootElement 用于判断保存位置，传入 logicalText 用于检查重 roll 覆盖）
        await saveImageGroup(positionedImages, logicalText, rootElement);

        timer.end(`保存 ${positionedImages.length} 个图片数据（跳过 DOM 插入）`);
        console.log('[insertImagesIntoElement] Saved image group with', positionedImages.length, 'images (DOM insertion skipped)');
        return;
    }

    // 3. insertOriginalText 模式：在匹配文本后面插入 image 标签文本
    let insertedCount = 0;
    let skippedCount = 0;

    for (const matchInfo of matches) {
        // 找到包含 endIndex 的节点
        let targetNodeInfo = null;
        for (const info of nodeInfos) {
            if (matchInfo.endIndex > info.start && matchInfo.endIndex <= info.end) {
                targetNodeInfo = info;
                break;
            }
        }

        // 如果 endIndex 刚好在某个节点的 end 位置，使用该节点
        if (!targetNodeInfo) {
            for (const info of nodeInfos) {
                if (matchInfo.endIndex === info.end) {
                    targetNodeInfo = info;
                    break;
                }
            }
        }

        if (!targetNodeInfo) {
            debugBranch('insertImagesIntoElement', `找不到目标节点 - 跳过`, true, {
                endIndex: matchInfo.endIndex
            });
            skippedCount++;
            console.warn('[insertImagesIntoElement] Could not find target node for match:', matchInfo);
            continue;
        }

        // 4. 构建 image 标签文本
        // 注意：<image> 标签只在确定插入正文时才使用（insertOriginalText 模式）
        // 这里是 DOM 临时显示，不使用 <image> 标签包裹
        const tag = matchInfo.tag;
        const { startTag, endTag } = getImageTags();
        // tag 可能已经带前后缀（tagthinkEcho=true 时 tag 可能是 <imgthink>...</imgthink>\nimage@@@...@@@）
        // 检查 tag 是否包含前后缀（不仅是开头结尾），避免重复包裹
        const alreadyWrapped = tag.includes(startTag) && tag.includes(endTag);
        const imageTagText = alreadyWrapped ? tag : `${startTag}${tag}${endTag}`;

        // ★ 详细打印插入数据
        console.group(`[insertImagesIntoElement] 准备插入第 ${insertedCount + 1} 个标签`);
        console.log('匹配位置 endIndex:', matchInfo.endIndex);
        console.log('匹配的原文:', matchInfo.matchText);
        console.log('AI regex:', matchInfo.aiRegex);
        console.log('tag 完整内容:');
        console.log(tag);
        console.log('将要插入的完整文本:');
        console.log(imageTagText);
        console.groupEnd();

        // 检查该标签是否已存在于文本中
        if (logicalText.includes(imageTagText)) {
            debugBranch('insertImagesIntoElement', `标签已存在 - 跳过`, true, {
                tag预览: tag.substring(0, 30)
            });
            skippedCount++;
            console.log('[insertImagesIntoElement] Tag already exists in text:', tag);
            continue;
        }

        // 5. 使用 Range API 在匹配文本后插入标签文本
        const range = doc.createRange();
        try {
            const targetNode = targetNodeInfo.node;
            const offsetInNode = matchInfo.endIndex - targetNodeInfo.start;

            if (targetNode.nodeType === Node.TEXT_NODE) {
                range.setStart(targetNode, offsetInNode);
                range.setEnd(targetNode, offsetInNode);
            } else {
                // 对于 BR 等元素节点，在其后插入
                range.setStartAfter(targetNode);
                range.setEndAfter(targetNode);
            }
        } catch (e) {
            debugLog('imageInserter.insertImagesIntoElement', 'Range 设置失败', {
                错误: e.message
            });
            skippedCount++;
            console.error('[insertImagesIntoElement] Error setting range:', e, matchInfo);
            continue;
        }

        // 6. 创建文本节点并插入
        const textNode = doc.createTextNode(imageTagText);
        range.insertNode(textNode);
        insertedCount++;

        debugLog('imageInserter.insertImagesIntoElement', '插入标签成功', {
            tag预览: tag.substring(0, 40),
            位置: matchInfo.endIndex
        });
        console.log('[insertImagesIntoElement] Inserted image tag for:', tag);
    }

    debugLog('imageInserter.insertImagesIntoElement', '插入完成', {
        成功插入: insertedCount,
        跳过: skippedCount,
        总计: matches.length
    });

    // 保存位置信息（传入 rootElement 用于判断保存位置，传入 logicalText 用于检查重 roll 覆盖）
    await saveImageGroup(positionedImages, logicalText, rootElement);

    timer.end(`插入 ${insertedCount} 个标签`);
    console.log('[insertImagesIntoElement] Saved image group with', positionedImages.length, 'images');
}

/**
 * 生成 el 的主键：取文本中间 20 个字符
 * @param {string} text - 逻辑文本
 * @returns {string} 主键
 */
export function generateElKey(text) {
    if (!text || text.length === 0) return '';
    const len = text.length;
    const keyLen = 20;
    const start = Math.max(0, Math.floor(len / 2) - Math.floor(keyLen / 2));
    return text.substring(start, start + keyLen);
}

/**
 * 获取去除 placeholder.js 生成元素后的纯文本
 * 用于生成 elKey 时确保与保存时一致
 * @param {HTMLElement} el - 目标元素
 * @returns {string} 干净的逻辑文本
 */
export function getCleanLogicalText(el) {
    if (!el) return '';

    // 克隆元素以避免修改原始 DOM
    const clone = el.cloneNode(true);

    // 需要去除的 placeholder.js 生成的元素选择器
    const selectorsToRemove = [
        '.st-chatu8-image-button',
        '.image-tag-button',
        '.st-chatu8-image-span',
        '.st-chatu8-image-container',
        '.st-chatu8-collapse-wrapper'
    ];

    // 删除这些元素
    for (const selector of selectorsToRemove) {
        const elements = clone.querySelectorAll(selector);
        elements.forEach(elem => elem.remove());
    }

    return clone.textContent || '';
}

/**
 * 在所有 image_groups 中按 tag 内容搜索
 * 用于当通过 elKey 无法定位时的备选方案
 * @param {string} tagToFind - 要查找的 tag 内容
 * @returns {Promise<{elKey: string, images: Array, index: number}|null>} 找到的条目信息，包含 elKey、images 数组和 tag 在数组中的索引
 */
export async function findTagInImageGroups(tagToFind) {
    if (!tagToFind) return null;

    const imageGroups = await getcharData('image_groups') || {};

    for (const [elKey, images] of Object.entries(imageGroups)) {
        if (!Array.isArray(images)) continue;

        for (let i = 0; i < images.length; i++) {
            if (images[i].tag === tagToFind) {
                return { elKey, images, index: i };
            }
        }
    }

    return null;
}

/**
 * 保存一组 images 的位置信息
 * 根据 el 类型选择保存位置：
 * - mes_text 元素：保存到 getContext().chat[id].extra.images
 * - 非 mes_text 元素：保存到 chatMetadata['st-chatu8']['data']['image_groups']
 * @param {Array<{endIndex: number, regex: string, tag: string}>} images
 * @param {string} logicalText - 逻辑文本，用于生成主键（非 mes_text 元素使用）
 * @param {HTMLElement} el - DOM 元素，用于判断保存位置
 */
/**
 * 从元素定位 mes_text
 * 支持三种情况：直接 mes_text、iframe 内元素、普通元素
 * @param {HTMLElement} el - 需要定位的元素
 * @returns {HTMLElement|null} - mes_text 元素或 null
 */
function findMesTextFromElement(el) {
    // 情况 1: el 本身就是 mes_text
    if (el && el.classList && el.classList.contains('mes_text')) {
        return el;
    }

    // 情况 2: el 在 iframe 内，需要查找外部的 mes_text
    const elDoc = el?.ownerDocument;
    if (elDoc && elDoc !== document) {
        // 在父页面找到对应的 iframe
        for (const iframe of document.querySelectorAll('iframe')) {
            if (iframe.contentDocument === elDoc) {
                return iframe.closest('.mes_text');
            }
        }
    }

    // 情况 3: 普通元素，直接向上查找
    return el?.closest?.('.mes_text');
}

/**
 * 在字符串指定位置插入内容
 * @param {string} str - 原字符串
 * @param {number} index - 插入位置
 * @param {string} insertion - 要插入的内容
 * @returns {string} - 插入后的字符串
 */
function insertAt(str, index, insertion) {
    return str.slice(0, index) + insertion + str.slice(index);
}

/**
 * 重新渲染消息（复用自 newline_fix.js 的逻辑）
 * @param {number} messageId - 消息 ID
 */
async function renderMessage(messageId) {
    console.log('[imageInserter] Rendering message:', messageId);
    const mesHtml = document.querySelector(`div.mes[mesid="${messageId}"]`);
    if (!mesHtml) {
        return;
    }

    const chatMessage = chat[messageId];
    if (!chatMessage) {
        return;
    }

    if (chatMessage.swipes) {
        const swipesCounter = mesHtml.querySelector('.swipes-counter');
        if (swipesCounter) {
            swipesCounter.textContent = `${chatMessage.swipe_id + 1}\u200b/\u200b${chatMessage.swipes.length}`;
        }
    }

    const mesText = mesHtml.querySelector('.mes_text');
    if (mesText) {
        mesText.innerHTML = messageFormatting(
            chatMessage.mes,
            chatMessage.name,
            chatMessage.is_system,
            chatMessage.is_user,
            messageId,
        );
    }

    await eventSource.emit(
        chatMessage.is_user ? event_types.USER_MESSAGE_RENDERED : event_types.CHARACTER_MESSAGE_RENDERED,
        messageId,
    );
}

export async function saveImageGroup(images, logicalText, el) {
    const timer = debugTimer('imageInserter.saveImageGroup', '保存图片组位置信息');

    if (!images || images.length === 0) {
        debugBranch('saveImageGroup', '无图片 - 跳过保存', true);
        timer.end('无图片');
        return;
    }

    debugLog('imageInserter.saveImageGroup', '开始保存', {
        图片数量: images.length
    });
    debugElement('saveImageGroup', '目标元素', el);

    // ========== 详细调试信息 ==========
    console.group('[imageInserter] saveImageGroup - el 详细信息');
    console.log('el 对象:', el);
    console.log('el.tagName:', el?.tagName);
    console.log('el.className:', el?.className);
    console.log('el.id:', el?.id);
    console.log('el 是否在 document 中:', el?.isConnected);
    console.log('el.ownerDocument:', el?.ownerDocument === document ? '主文档' : 'iframe 文档');

    // 获取父元素链
    const parentChain = [];
    let parent = el?.parentElement;
    for (let i = 0; i < 5 && parent; i++) {
        parentChain.push(`${parent.tagName}${parent.id ? '#' + parent.id : ''}${parent.className ? '.' + parent.className.split(' ')[0] : ''}`);
        parent = parent.parentElement;
    }
    console.log('父元素链:', parentChain.join(' → '));

    // 文本特征
    const textLen = el?.textContent?.length || 0;
    const midPos = Math.floor(textLen / 2);
    const startPos = Math.max(0, midPos - 10);
    const textSignature = el?.textContent?.substring(startPos, startPos + 20) || '';
    console.log('textContent 长度:', textLen);
    console.log('textContent 中间 20 字特征:', JSON.stringify(textSignature));

    // iframe 相关信息
    if (el?.ownerDocument !== document) {
        const iframeDoc = el?.ownerDocument;
        console.log('iframe document.URL:', iframeDoc?.URL);
        console.log('iframe body 子 div 数量:', iframeDoc?.body?.querySelectorAll(':scope > div').length);
    }

    // 检查 mes_text 相关
    console.log('是 mes_text:', el?.classList?.contains('mes_text'));
    console.log('data-mesid:', el?.getAttribute?.('data-mesid'));
    console.groupEnd();

    // ========== insertOriginalText 模式 ==========
    const insertOriginalTextEnabled = String(extension_settings[extensionName]?.insertOriginalText) === 'true';
    debugLog('imageInserter.saveImageGroup', '检查储存模式', {
        insertOriginalText设置: extension_settings[extensionName]?.insertOriginalText,
        是否启用: insertOriginalTextEnabled
    });

    if (insertOriginalTextEnabled) {
        debugBranch('saveImageGroup', 'insertOriginalText 模式已启用', true);

        const mesText = findMesTextFromElement(el);
        if (mesText) {
            const mesBlock = mesText.closest('.mes');
            const mesId = parseInt(mesBlock?.getAttribute('mesid'), 10);

            debugLog('imageInserter.saveImageGroup', 'insertOriginalText 定位结果', {
                找到mes_text: true,
                mesId: mesId,
                mesId有效: !isNaN(mesId)
            });

            if (!isNaN(mesId) && chat[mesId]) {
                let mes = chat[mesId].mes;

                // 如果 mes 长度小于 100，退回到原有存储逻辑
                if (mes && mes.length >= 100) {
                    debugBranch('saveImageGroup', 'insertOriginalText 模式执行', true, {
                        mesId: mesId,
                        mes长度: mes.length,
                        储存位置: 'chat[mesId].mes'
                    });
                    console.log('[imageInserter] insertOriginalText mode - mesId:', mesId, 'mes.length:', mes.length);

                    // 获取锁定的 tag 列表
                    const lockedTags = new Set(chat[mesId].extra?.lockedTags || []);
                    console.log('[imageInserter] Locked tags:', Array.from(lockedTags));

                    // 步骤 1: 先删除未锁定的 <image> 标签
                    const { startTag, endTag } = getImageTags();
                    const escapedStart = startTag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                    const escapedEnd = endTag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                    const pureTagRegex = new RegExp(`${escapedStart}([\\s\\S]*?)${escapedEnd}`);

                    if (lockedTags.size === 0) {
                        // 没有锁定的，全部删除
                        mes = mes.replace(/<image>[\s\S]*?<\/image>/g, '');
                    } else {
                        // 有锁定的，只删除未锁定的
                        mes = mes.replace(/<image>([\s\S]*?)<\/image>/g, (match, content) => {
                            // 从 <image> 内容中提取纯 tag（image@@@...@@@ 里面的内容）
                            const pureTagMatch = content.match(pureTagRegex);
                            console.log('[imageInserter] <image> content preview:', content.substring(0, 150));
                            console.log('[imageInserter] pureTagRegex:', pureTagRegex);
                            console.log('[imageInserter] pureTagMatch:', pureTagMatch ? 'found' : 'null');

                            if (pureTagMatch) {
                                const pureTag = pureTagMatch[1].trim();
                                // 标准化：和 button.dataset.link 的处理方式一致
                                const pureTagNormalized = pureTag.replaceAll("《", "<").replaceAll("》", ">").replaceAll("\n", "");
                                console.log('[imageInserter] Extracted pureTag:', pureTagNormalized.substring(0, 150));

                                // 检查纯 tag 是否匹配任何锁定的 tag
                                // 使用前 100 字符前缀匹配，避免长字符串细微差异导致不匹配
                                const pureTagPrefix = pureTagNormalized.substring(0, 100);
                                for (const lockedTag of lockedTags) {
                                    const lockedTagPrefix = lockedTag.substring(0, 100);
                                    console.log('[imageInserter] Comparing pureTagPrefix:', pureTagPrefix.substring(0, 80));
                                    console.log('[imageInserter] With lockedTagPrefix:', lockedTagPrefix.substring(0, 80));
                                    // 前缀匹配或完整包含
                                    if (pureTagPrefix === lockedTagPrefix ||
                                        pureTagNormalized.startsWith(lockedTagPrefix) ||
                                        lockedTag.startsWith(pureTagPrefix)) {
                                        console.log('[imageInserter] Keeping locked <image>, matched pureTag with:', lockedTag.substring(0, 50));
                                        return match; // 保留锁定的
                                    }
                                }
                                console.log('[imageInserter] No match for pureTag:', pureTagNormalized.substring(0, 80));
                            } else {
                                console.log('[imageInserter] No pureTag found in <image>, content preview:', content.substring(0, 100));
                            }
                            return ''; // 删除未锁定的
                        });
                    }

                    // 步骤 2: 提取锁定的 <image> 内容和位置（用前面的文字作为 regex）
                    const lockedImages = [];
                    const imageBlockRegex = /<image>([\s\S]*?)<\/image>/g;
                    let blockMatch;
                    while ((blockMatch = imageBlockRegex.exec(mes)) !== null) {
                        const content = blockMatch[1];
                        const imageStartIndex = blockMatch.index;

                        // 取 <image> 之前的文字作为 regex
                        // 由于插入时会在 <image> 前加 \n\n，所以需要往前多找几行
                        const textBefore = mes.substring(0, imageStartIndex);
                        const lines = textBefore.split('\n');

                        // 从后往前找第一个非空行
                        let lastLine = '';
                        for (let i = lines.length - 1; i >= 0; i--) {
                            const trimmed = lines[i].trim();
                            if (trimmed) {
                                lastLine = trimmed;
                                break;
                            }
                        }
                        const regex = lastLine.slice(-50); // 取最后 50 个字符

                        // tag 就是整个 content（去掉 regex 行）
                        const tag = content.replace(/regex:.*?(?:\n|$)/g, '').trim();

                        console.log('[imageInserter] Step 2 extraction: regex=', regex.substring(0, 30), ', tag preview=', tag.substring(0, 50));

                        if (regex && tag) {
                            lockedImages.push({ regex, tag });
                            console.log('[imageInserter] Extracted locked image, regex:', regex.substring(0, 30));
                        } else if (tag) {
                            // regex 为空时，使用 tag 的前 50 字符作为备用 regex
                            const fallbackRegex = tag.substring(0, 50);
                            lockedImages.push({ regex: fallbackRegex, tag });
                            console.log('[imageInserter] Extracted locked image with fallback regex:', fallbackRegex.substring(0, 30));
                        } else {
                            console.warn('[imageInserter] Skipped locked image: tag is empty');
                        }
                    }

                    // 步骤 3: 删除所有剩余的 <image> 标签（锁定的也删掉，后面统一重新插入）
                    mes = mes.replace(/<image>[\s\S]*?<\/image>/g, '');

                    // 也删除旧格式的 image###...### 标签（复用步骤1的变量）
                    mes = mes.replace(new RegExp(`${escapedStart}[\\s\\S]*?${escapedEnd}`, 'g'), '');

                    // 步骤 3.5: 暂存 HTML 注释 <!-- ... -->，避免 indexOf 重映射失败并在最后还原
                    const htmlComments = [];
                    mes = mes.replace(/<!--[\s\S]*?-->/g, (match) => {
                        const placeholder = `___HTML_COMMENT_${htmlComments.length}___`;
                        htmlComments.push(match);
                        return placeholder;
                    });

                    // 步骤 4: 修复换行问题
                    mes = mes.replace(/\n{3,}/g, '\n\n');

                    // 步骤 5: 合并锁定的和新的 images
                    const allImages = [...lockedImages, ...images];
                    console.log('[imageInserter] Total images to insert:', allImages.length, '(locked:', lockedImages.length, ', new:', images.length, ')');

                    // 步骤 6: 在清理后的 mes 上重新匹配位置
                    const mesForMatch = removeThinkingText(mes);

                    // ★ 关键修复：计算思考文本在原始 mes 中的结束位置
                    // 这样在重映射时，从思考文本之后开始搜索匹配行，避免匹配到思考文本中的内容
                    let thinkingEndOffset = 0;
                    {
                        // 与 removeThinkingText 的逻辑一致：
                        // 1. 先移除 <think>...</think> 或 <thinking>...</thinking> 标签
                        let tempText = mes;
                        tempText = tempText.replace(/<think(?:ing)?[\s\S]*?<\/think(?:ing)?>/gi, '');
                        // 2. 贪婪模式：匹配从开头到最后一个 </thinking> 或 </think>
                        const thinkingEndMatch = tempText.match(/^[\s\S]*<\/think(?:ing)?>/i);
                        if (thinkingEndMatch) {
                            // tempText 中思考文本的结束位置
                            thinkingEndOffset = thinkingEndMatch[0].length;
                        }
                        // 如果第一步没有移除任何内容，直接在原始 mes 上查找
                        if (thinkingEndOffset === 0) {
                            const originalThinkMatch = mes.match(/^[\s\S]*<\/think(?:ing)?>/i);
                            if (originalThinkMatch) {
                                thinkingEndOffset = originalThinkMatch[0].length;
                            }
                        }
                        console.log('[imageInserter] insertOriginalText: thinkingEndOffset =', thinkingEndOffset);
                    }

                    // 收集所有匹配结果
                    const matchResults = [];
                    for (const img of allImages) {
                        const matchResult = fuzzyMatchLine(mesForMatch, img.regex, 0.5);
                        if (matchResult) {
                            // ★ 关键修复：matchResult.endIndex 是相对于 mesForMatch（已移除思考文本）的位置
                            // 需要用匹配到的行内容在原始 mes 中重新定位 endIndex
                            // 从 thinkingEndOffset 之后开始搜索，避免匹配到思考文本中的相同内容
                            let correctEndIndex = matchResult.endIndex;
                            const matchedLine = matchResult.matchedLine;

                            const lineIndexInOriginal = mes.indexOf(matchedLine, thinkingEndOffset);
                            if (lineIndexInOriginal !== -1) {
                                correctEndIndex = lineIndexInOriginal + matchedLine.length;
                                console.log(`[imageInserter] insertOriginalText: Remapped endIndex: ${matchResult.endIndex} -> ${correctEndIndex} (searchFrom: ${thinkingEndOffset})`);
                            } else {
                                // 备选：如果在思考文本之后找不到，尝试全文搜索
                                const fallbackIndex = mes.indexOf(matchedLine);
                                if (fallbackIndex !== -1) {
                                    correctEndIndex = fallbackIndex + matchedLine.length;
                                    console.warn(`[imageInserter] insertOriginalText: Fallback full search, endIndex: ${correctEndIndex}`);
                                } else {
                                    console.warn(`[imageInserter] insertOriginalText: Could not find matched line in original mes, using original endIndex`);
                                }
                            }

                            matchResults.push({
                                endIndex: correctEndIndex,
                                tag: img.tag,
                                regex: img.regex
                            });
                        } else {
                            console.warn('[imageInserter] No match found for regex:', img.regex.substring(0, 50));
                        }
                    }

                    // 按 endIndex 降序排序，从后往前插入避免位置偏移
                    matchResults.sort((a, b) => b.endIndex - a.endIndex);

                    // 从后往前插入
                    let insertedCount = 0;
                    for (const match of matchResults) {
                        const insertTag = `\n\n<image>${match.tag}</image>`;
                        mes = insertAt(mes, match.endIndex, insertTag);
                        insertedCount++;
                        console.log('[imageInserter] Inserted tag at position', match.endIndex, 'for regex:', match.regex.substring(0, 30));
                    }

                    // 步骤 3.6: 还原 HTML 注释
                    if (htmlComments.length > 0) {
                        mes = mes.replace(/___HTML_COMMENT_(\d+)___/g, (match, index) => {
                            return htmlComments[index] || match;
                        });
                    }

                    // 步骤 3: 保存并重新渲染
                    chat[mesId].mes = mes;

                    // ★ 清除旧的 extra.images 数据（非插入模式遗留），避免 placeholder.js 读取旧数据覆盖新 tag
                    const context = getContext();
                    if (context.chat[mesId]?.extra?.images) {
                        const swipeKey = context.chat[mesId].swipe_id ?? 0;
                        if (context.chat[mesId].extra.images[swipeKey]) {
                            console.log('[imageInserter] insertOriginalText: clearing old extra.images[' + swipeKey + '] to avoid conflict');
                            delete context.chat[mesId].extra.images[swipeKey];
                        }
                    }

                    await saveChatConditional();
                    await renderMessage(mesId);

                    debugLog('imageInserter.saveImageGroup', 'insertOriginalText 保存完成', {
                        mesId: mesId,
                        插入数量: insertedCount,
                        储存位置: 'chat[mesId].mes'
                    });
                    timer.end(`insertOriginalText 模式 - 插入 ${insertedCount} 个标签`);
                    console.log('[imageInserter] Saved to chat[' + mesId + '].mes (insertOriginalText mode)');
                    return; // 不执行原有保存逻辑
                } else {
                    debugBranch('saveImageGroup', 'mes 长度不足 - 退回原有逻辑', true, {
                        mes长度: mes?.length || 0,
                        阈值: 100
                    });
                    console.log('[imageInserter] mes.length < 100, falling back to original storage');
                }
            } else {
                debugBranch('saveImageGroup', 'mesId 无效或 chat 不存在', true, {
                    mesId: mesId,
                    chat存在: !!chat[mesId]
                });
            }
        } else {
            debugBranch('saveImageGroup', '未找到 mes_text 元素', true);
        }
    } else {
        debugBranch('saveImageGroup', 'insertOriginalText 模式未启用', true);
    }

    // ========== 原有保存逻辑 ==========
    // 判断是否是 mes_text 元素
    const isMesText = el && el.classList && el.classList.contains('mes_text');
    debugLog('imageInserter.saveImageGroup', '进入原有保存逻辑', {
        是mes_text: isMesText
    });

    if (isMesText) {
        debugBranch('saveImageGroup', '保存到 chat[id].extra.images', true);

        // ===== mes_text 元素：保存到 chat[id].extra.images =====
        // 获取消息 ID
        const grandParent = el.parentElement?.parentElement;
        const idStr = grandParent?.getAttribute('mesid');

        if (!idStr) {
            debugBranch('saveImageGroup', 'mesid 未找到 - 退回 metadata', true);
            console.warn('[imageInserter] mes_text element but mesid not found, falling back to chatMetadata');
            await saveToMetadata(images, logicalText);
            timer.end('保存到 metadata (mesid未找到)');
            return;
        }

        const id = parseInt(idStr, 10);
        const context = getContext();

        if (!context.chat || !context.chat[id]) {
            debugBranch('saveImageGroup', 'chat 消息不存在 - 退回 metadata', true, {
                id: id
            });
            console.warn('[imageInserter] chat message not found for id:', id, ', falling back to chatMetadata');
            await saveToMetadata(images, logicalText);
            timer.end('保存到 metadata (chat不存在)');
            return;
        }

        // 确保 extra 对象存在
        if (!context.chat[id].extra) {
            context.chat[id].extra = {};
        }

        // 确保 extra.images 对象存在
        if (!context.chat[id].extra.images) {
            context.chat[id].extra.images = {};
        }

        // 获取 swipe_id 作为 key，如果不存在则默认为 0
        const key = context.chat[id].swipe_id ?? 0;

        // 获取旧数据中锁定的条目
        const oldImages = context.chat[id].extra.images[key] || [];
        const lockedImages = oldImages.filter(img => img.locked === true);

        // 过滤新 images，移除与锁定 tag 重复的条目
        const lockedTags = new Set(lockedImages.map(img => img.tag));
        const newImagesFiltered = images.filter(img => !lockedTags.has(img.tag));

        // 合并锁定的旧条目和新条目
        const mergedImages = [...lockedImages, ...newImagesFiltered];

        // 保存到 extra.images[key]（按 swipe_id 覆盖）
        const isOverride = !!context.chat[id].extra.images[key];
        context.chat[id].extra.images[key] = mergedImages;

        // 保存聊天记录
        saveChatConditional();

        debugLog('imageInserter.saveImageGroup', '保存到 extra.images 完成', {
            mesId: id,
            swipeId: key,
            保存数量: mergedImages.length,
            锁定数量: lockedImages.length,
            新增数量: newImagesFiltered.length,
            是否覆盖: isOverride,
            储存位置: `chat[${id}].extra.images[${key}]`
        });
        timer.end(`extra.images - ${mergedImages.length} 个`);

        console.log('[imageInserter] Saved to chat[' + id + '].extra.images[' + key + ']:', mergedImages,
            isOverride ? '(overridden)' : '(new)',
            lockedImages.length > 0 ? `(preserved ${lockedImages.length} locked)` : '');

        // 如果 mes 长度 > 100 且有锁定的 tag，触发 renderMessage 刷新页面
        // 这确保 mes 中的锁定 tag 能正确显示
        if (context.chat[id].mes && context.chat[id].mes.length > 100 && lockedImages.length > 0) {
            console.log('[imageInserter] Forcing re-render to display locked tags in mes');
            await renderMessage(id);
        }
    } else {
        // ===== 非 mes_text 元素：保存到 chatMetadata =====
        debugBranch('saveImageGroup', '保存到 chatMetadata (非 mes_text)', true);
        await saveToMetadata(images, logicalText);
        timer.end('保存到 metadata');
    }
}

/**
 * 内部函数：保存到 chatMetadata（原有逻辑）
 * @param {Array<{endIndex: number, regex: string, tag: string}>} images
 * @param {string} logicalText - 逻辑文本，用于生成主键
 */
async function saveToMetadata(images, logicalText) {
    // 获取现有数据
    const imageGroups = await getcharData('image_groups') || {};

    // 使用中间 20 字符作为主键（O(1) 查找和覆盖）
    const elKey = generateElKey(logicalText);

    if (!elKey) {
        console.warn('[imageInserter] Cannot generate elKey, logicalText too short');
        toastr.warning('图片组无法存储：文本内容过短，无法生成唯一标识。');
        return;
    }

    // 获取旧数据中锁定的条目
    const oldImages = imageGroups[elKey] || [];
    const lockedImages = oldImages.filter(img => img.locked === true);

    // 过滤新 images，移除与锁定 tag 重复的条目
    const lockedTags = new Set(lockedImages.map(img => img.tag));
    const newImagesFiltered = images.filter(img => !lockedTags.has(img.tag));

    // 合并锁定的旧条目和新条目
    const mergedImages = [...lockedImages, ...newImagesFiltered];

    const isOverride = !!imageGroups[elKey];

    // 保存合并后的数据
    imageGroups[elKey] = mergedImages;

    await setcharData('image_groups', imageGroups);

    console.log('[imageInserter] Saved to chatMetadata:', elKey, mergedImages,
        isOverride ? '(overridden)' : '(new)',
        lockedImages.length > 0 ? `(preserved ${lockedImages.length} locked)` : '');
}

/**
 * 生成稳定的 ID
 * @param {string} str - 输入字符串
 * @returns {string} 稳定的 ID
 */
export function generateStableId(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
        const char = str.charCodeAt(i);
        hash = ((hash << 5) - hash) + char;
        hash |= 0;
    }
    return 'chatu8-id-' + Math.abs(hash).toString(36);
}

/**
 * 删除 el 元素关联的图片数据和 DOM 元素
 * @param {HTMLElement} el - 目标元素
 */
export async function deleteImagesForElement(el) {
    if (!el) {
        console.warn('[imageInserter] deleteImagesForElement: el is null');
        return;
    }

    console.log('[imageInserter] deleteImagesForElement called for:', el.tagName, el.className);

    // 判断是否在 iframe 内
    const isInIframe = el.ownerDocument !== document;

    // 找到 mes_text 元素（用于后续存储删除）
    const mesText = findMesTextFromElement(el);

    // 1. 删除 DOM 元素 - 根据上下文选择正确的搜索范围
    let searchRoot = el;

    if (mesText && !isInIframe) {
        // 如果是 mes_text 或其内部元素，在 mes_text 范围内搜索
        searchRoot = mesText;
    }

    // 只删除图片相关的元素，不影响其他结构
    const imageSelectors = [
        '.image-tag-button',
        '.st-chatu8-image-button',
        '.st-chatu8-image-span',
        '.st-chatu8-image-container',
        '.st-chatu8-collapse-wrapper'
    ];

    let removedCount = 0;
    let lockedCount = 0;

    // 0. 先获取锁定的 tag 列表（需要在删除 DOM 之前获取）
    let lockedTagSet = new Set();
    if (mesText) {
        const mesBlock = mesText.closest('.mes');
        const id = parseInt(mesBlock?.getAttribute('mesid'), 10);
        const context = getContext();

        if (!isNaN(id) && context.chat[id]) {
            // 方式 1: 从 extra.images 获取锁定的 tag
            if (context.chat[id].extra?.images) {
                const key = context.chat[id].swipe_id ?? 0;
                const existingImages = context.chat[id].extra.images[key] || [];
                existingImages.filter(img => img.locked === true).forEach(img => {
                    lockedTagSet.add(img.tag);
                });
            }

            // 方式 2: 从 extra.lockedTags 获取锁定的 tag (insertOriginalText 模式)
            const lockedTagsArray = context.chat[id].extra?.lockedTags || [];
            lockedTagsArray.forEach(tag => lockedTagSet.add(tag));

            // 方式 3: 解析 mes 正文中的 tag，检查它们是否在锁定列表中
            // 无论当前是否使用 insertOriginalText 模式，都要检查正文中的 tag
            // 因为 mes 中可能有之前插入的锁定 tag
            if (context.chat[id].mes) {
                const { startTag, endTag } = getImageTags();
                const escapedStart = startTag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                const escapedEnd = endTag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                
                // 1. 检查旧格式 startTag...endTag
                const mesTagRegex = new RegExp(`${escapedStart}([\\s\\S]*?)${escapedEnd}`, 'g');
                let match;
                while ((match = mesTagRegex.exec(context.chat[id].mes)) !== null) {
                    const tagInMes = match[1].trim();
                    // 如果这个 tag 在 lockedTags 列表中，确保它被添加到 lockedTagSet
                    if (lockedTagsArray.includes(tagInMes)) {
                        lockedTagSet.add(tagInMes);
                        console.log('[imageInserter] Found locked tag in mes (old format):', tagInMes.substring(0, 30));
                    }
                }

                // 2. 检查新格式 <image>...</image>
                const imageBlockRegex = /<image>([\s\S]*?)<\/image>/g;
                let imgMatch;
                while ((imgMatch = imageBlockRegex.exec(context.chat[id].mes)) !== null) {
                    let tagInMes = imgMatch[1];
                    // 尝试移除可能嵌套的 startTag/endTag
                    const tagMatch = tagInMes.match(new RegExp(`${escapedStart}([\\s\\S]*?)${escapedEnd}`));
                    tagInMes = (tagMatch ? tagMatch[1] : tagInMes).trim();

                    if (lockedTagsArray.includes(tagInMes)) {
                        lockedTagSet.add(tagInMes);
                        console.log('[imageInserter] Found locked tag in mes (<image> format):', tagInMes.substring(0, 30));
                    }
                }
            }

            console.log('[imageInserter] Total locked tags:', lockedTagSet.size,
                'from extra.lockedTags:', lockedTagsArray.length);
        }
    }
    lockedCount = lockedTagSet.size;
    console.log('[imageInserter] Locked tags for deletion check:', Array.from(lockedTagSet));

    // 辅助函数：检查元素是否对应锁定的 tag
    const isElementLocked = (elem) => {
        // 辅助函数：检查 tag 是否匹配锁定列表
        const isTagLocked = (tag) => {
            if (!tag) return false;
            const tagTrimmed = tag.trim();
            if (lockedTagSet.has(tagTrimmed)) return true;
            for (const lockedTag of lockedTagSet) {
                if (lockedTag.trim() === tagTrimmed ||
                    tagTrimmed.includes(lockedTag.trim()) ||
                    lockedTag.trim().includes(tagTrimmed)) {
                    return true;
                }
            }
            return false;
        };

        // 1. 检查元素自身的 data-link 属性
        const link = elem.dataset?.link || elem.getAttribute?.('data-link');
        if (isTagLocked(link)) {
            console.log('[imageInserter] Element locked (self):', link?.substring(0, 30));
            return true;
        }

        // 2. 检查父级按钮的 data-link
        const parentButton = elem.closest?.('.st-chatu8-image-button, .image-tag-button');
        if (parentButton && parentButton !== elem) {
            const parentLink = parentButton.dataset?.link || parentButton.getAttribute?.('data-link');
            if (isTagLocked(parentLink)) {
                console.log('[imageInserter] Element locked via parent:', parentLink?.substring(0, 30));
                return true;
            }
        }

        // 3. 检查兄弟按钮 (针对 st-chatu8-image-span 等元素)
        const parent = elem.parentElement;
        if (parent) {
            const siblingButtons = parent.querySelectorAll('.st-chatu8-image-button, .image-tag-button');
            for (const sibBtn of siblingButtons) {
                const sibLink = sibBtn.dataset?.link || sibBtn.getAttribute?.('data-link');
                if (isTagLocked(sibLink)) {
                    console.log('[imageInserter] Element locked via sibling:', sibLink?.substring(0, 30));
                    return true;
                }
            }
        }

        // 4. 检查前一个兄弟元素是否是锁定的按钮
        const prevSibling = elem.previousElementSibling;
        if (prevSibling?.classList?.contains('st-chatu8-image-button') ||
            prevSibling?.classList?.contains('image-tag-button')) {
            const prevLink = prevSibling.dataset?.link || prevSibling.getAttribute?.('data-link');
            if (isTagLocked(prevLink)) {
                console.log('[imageInserter] Element locked via prev sibling:', prevLink?.substring(0, 30));
                return true;
            }
        }

        return false;
    };

    // 0.5 收集 el 范围内要删除的 tag 列表（在删除 DOM 之前）
    const deletedTags = new Set();
    const collectTagsFromElement = (elem) => {
        const link = elem.dataset?.link || elem.getAttribute?.('data-link');
        if (link && !isElementLocked(elem)) {
            deletedTags.add(link.trim());
        }
    };

    // 先收集所有要删除的 tag
    try {
        const allButtons = searchRoot.querySelectorAll('.st-chatu8-image-button, .image-tag-button');
        allButtons.forEach(btn => collectTagsFromElement(btn));
        console.log('[imageInserter] Tags to delete from storage:', Array.from(deletedTags));
    } catch (e) {
        console.warn('[imageInserter] Error collecting tags:', e);
    }

    // 0.6 在删除 DOM 之前生成 elKey（因为删除后 textContent 会改变）
    // 重要：使用 el 本身（而非 mesText）生成 elKey，因为 saveImageGroup 也是用 el 来生成 key 的
    const elKeyForImageGroups = generateElKey(getCleanLogicalText(el));
    console.log('[imageInserter] Pre-computed elKey for image_groups:', elKeyForImageGroups);

    // 1. 删除 DOM 元素（跳过锁定的）
    // 特殊处理折叠容器：如果容器内有任何锁定的按钮，保留整个容器
    try {
        const collapseWrappers = searchRoot.querySelectorAll('.st-chatu8-collapse-wrapper');
        collapseWrappers.forEach(wrapper => {
            // 检查是否有任何一个按钮被锁定
            const buttons = wrapper.querySelectorAll('.st-chatu8-image-button, .image-tag-button');
            const hasAnyLocked = Array.from(buttons).some(btn => isElementLocked(btn));

            if (hasAnyLocked) {
                // 有锁定的按钮，保留整个容器但删除容器内未锁定的按钮
                console.log('[imageInserter] Collapse wrapper has locked buttons, keeping wrapper');
                buttons.forEach(btn => {
                    if (!isElementLocked(btn)) {
                        btn.remove();
                        removedCount++;
                        console.log('[imageInserter] Removed unlocked button inside wrapper');
                    }
                });
            } else if (buttons.length === 0) {
                // 没有按钮，删除空容器
                wrapper.remove();
                removedCount++;
                console.log('[imageInserter] Removed empty collapse wrapper');
            } else {
                // 没有锁定的按钮，删除整个容器
                wrapper.remove();
                removedCount++;
                console.log('[imageInserter] Removed collapse wrapper (no locked buttons)');
            }
        });
    } catch (e) {
        console.warn('[imageInserter] Error removing collapse wrappers:', e);
    }

    for (const selector of imageSelectors) {
        // 跳过已经处理过的 collapse-wrapper
        if (selector === '.st-chatu8-collapse-wrapper') {
            continue;
        }
        try {
            const elements = searchRoot.querySelectorAll(selector);
            elements.forEach(elem => {
                // 检查元素自身是否锁定
                if (isElementLocked(elem)) {
                    console.log('[imageInserter] Skipped locked element:', selector);
                    return; // 跳过锁定的元素
                }

                // 检查元素内部是否有锁定的按钮（针对容器类元素）
                const innerButtons = elem.querySelectorAll?.('.st-chatu8-image-button, .image-tag-button');
                if (innerButtons && innerButtons.length > 0) {
                    const hasLockedInside = Array.from(innerButtons).some(btn => isElementLocked(btn));
                    if (hasLockedInside) {
                        console.log('[imageInserter] Skipped container with locked buttons inside:', selector);
                        return; // 跳过包含锁定按钮的容器
                    }
                }

                // ★ tagthinkEcho: 删除按钮前，检查并移除关联的 <p> 元素（包含 <image> tagthink 内容）
                if (elem.classList?.contains('image-tag-button') || elem.classList?.contains('st-chatu8-image-button')) {
                    // 情况 1: <p> 是按钮的前一个兄弟元素（按钮在 <p> 外部）
                    const prevSib = elem.previousElementSibling;
                    if (prevSib && prevSib.tagName === 'P' && prevSib.querySelector('image')) {
                        prevSib.remove();
                        console.log('[imageInserter] Removed tagthink <p> element above button');
                    }

                    // 情况 2: 按钮在 <p> 内部（如截图所示的 DOM 结构）
                    // 如果按钮的父元素是 <p>，且 <p> 内包含 <image>/<img>/<font> 等图片标记相关元素，
                    // 并且没有已生成的图片（st-chatu8-image-container 为空），则删除整个 <p>
                    const parentP = elem.parentElement;
                    if (parentP && parentP.tagName === 'P') {
                        const hasImageTag = parentP.querySelector('image') || parentP.querySelector('img');
                        const hasFontTag = parentP.querySelector('font');
                        const hasGeneratedImage = parentP.querySelector('.st-chatu8-image-container img, .st-chatu8-image-container video');
                        if ((hasImageTag || hasFontTag) && !hasGeneratedImage) {
                            parentP.remove();
                            removedCount++;
                            console.log('[imageInserter] Removed parent <p> element containing button (no generated image)');
                            return; // 父 <p> 已被删除，按钮也随之删除，无需再 elem.remove()
                        }
                    }
                }
                elem.remove();
                removedCount++;
            });
        } catch (e) {
            console.warn('[imageInserter] Error removing elements with selector:', selector, e);
        }
    }

    console.log('[imageInserter] Removed', removedCount, 'image-related DOM elements, skipped', lockedCount, 'locked');

    // 2. 根据 el 类型删除存储数据（lockedCount 已在前面计算）

    if (mesText) {
        // mes_text 或其内部元素: 删除 chat[id].extra.images[key]
        const mesBlock = mesText.closest('.mes');
        const id = parseInt(mesBlock?.getAttribute('mesid'), 10);
        const context = getContext();

        if (!isNaN(id) && context.chat[id]) {
            // 删除 extra.images 中的数据（保留锁定的）
            if (context.chat[id].extra?.images) {
                const key = context.chat[id].swipe_id ?? 0;
                const existingImages = context.chat[id].extra.images[key] || [];
                const lockedImages = existingImages.filter(img => img.locked === true);
                lockedCount = lockedImages.length;

                if (lockedImages.length > 0) {
                    // 有锁定的图片，只保留锁定的
                    context.chat[id].extra.images[key] = lockedImages;
                    console.log('[imageInserter] Preserved', lockedCount, 'locked images, deleted others');
                } else {
                    // 没有锁定的图片，全部删除
                    delete context.chat[id].extra.images[key];
                    console.log('[imageInserter] Deleted chat[' + id + '].extra.images[' + key + ']');
                }
            }

            // ★ 在 mes 清理和 renderMessage 之前删除 image_groups
            // 这确保了 renderMessage 触发 placeholder.js 重新处理时，image_groups 数据已经被删除
            console.log('[imageInserter] Deleting from image_groups BEFORE renderMessage...');
            const elKey = elKeyForImageGroups;

            if (elKey && deletedTags.size > 0) {
                const imageGroups = await getcharData('image_groups') || {};
                if (imageGroups[elKey]) {
                    const existingImages = imageGroups[elKey] || [];

                    // 精确过滤：保留锁定的 + 不在 deletedTags 中的
                    const remainingImages = existingImages.filter(img => {
                        if (img.locked === true) return true;
                        if (!deletedTags.has(img.tag?.trim())) return true;
                        console.log('[imageInserter] Deleting tag from image_groups:', img.tag?.substring(0, 30));
                        return false;
                    });

                    const deletedCount = existingImages.length - remainingImages.length;

                    if (deletedCount > 0) {
                        if (remainingImages.length > 0) {
                            imageGroups[elKey] = remainingImages;
                            await setcharData('image_groups', imageGroups);
                            console.log('[imageInserter] image_groups: deleted', deletedCount, ', remaining', remainingImages.length);
                        } else {
                            delete imageGroups[elKey];
                            await setcharData('image_groups', imageGroups);
                            console.log('[imageInserter] image_groups: deleted all, removed key:', elKey);
                        }
                    } else {
                        console.log('[imageInserter] image_groups: no matching tags to delete');
                    }
                } else {
                    console.log('[imageInserter] image_groups: no data found for key:', elKey);
                }
            }

            // 清理 mes 中的标签 - 新逻辑：
            // 从 mes 中提取所有 <image>...</image> 标签块，
            // 使用前后缀（startTag/endTag）提取其中的 tag 内容来判断是否锁定，
            // 删除非锁定的 <image> 块及其前方关联的 <font> 和 <Tag_think> 内容。
            // 注意：使用前面已经构建好的 lockedTagSet（包含 extra.images 和 extra.lockedTags 两个来源）
            const { startTag, endTag } = getImageTags();
            const escapedStart = startTag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            const escapedEnd = endTag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

            if (context.chat[id].mes) {
                let mes = context.chat[id].mes;
                const oldLen = mes.length;

                // 新逻辑：匹配 <font color="steelblue">[...]</font> + <Tag_think>...</Tag_think> + <image>...</image> 整体块
                // 三部分都是可选的，但 <image> 是必须的锚点
                // 格式示例：
                //   <font color="steelblue">[描述文字]</font>\n<Tag_think>\n思考内容\n</Tag_think>\n<image>image@@@...@@@</image>
                // 需要一起删除的部分：<font>标签 + <Tag_think>块 + <image>块

                // 构建正则：匹配可选的 <font> + 可选的 <Tag_think> + 必须的 <image> 块
                // (?:<font[^>]*>[\s\S]*?<\/font>\s*)? - 可选的 font 标签
                // (?:<Tag_think>[\s\S]*?<\/Tag_think>\s*)? - 可选的 Tag_think 块
                // <image>[\s\S]*?<\/image> - 必须的 image 块
                const fullBlockRegex = new RegExp(
                    `(?:<font[^>]*>\\[[^\\]]*\\]<\\/font>\\s*)?` +
                    `(?:<Tag_think>[\\s\\S]*?<\\/Tag_think>\\s*)?` +
                    `<image>([\\s\\S]*?)<\\/image>`,
                    'g'
                );

                mes = mes.replace(fullBlockRegex, (match, imageContent) => {
                    // 从 <image> 内容中提取 tag
                    const tagRegex = new RegExp(`${escapedStart}([\\s\\S]*?)${escapedEnd}`);
                    const tagMatch = imageContent.match(tagRegex);
                    // 如果内部有 startTag/endTag 就提取它，否则直接取 imageContent 的全部文本
                    const tag = tagMatch ? tagMatch[1].trim() : imageContent.trim();

                    // 检查是否锁定
                    if (tag && lockedTagSet.size > 0) {
                        // 检查精确匹配和包含匹配
                        let isLocked = lockedTagSet.has(tag);
                        if (!isLocked) {
                            for (const lockedTag of lockedTagSet) {
                                if (lockedTag.trim() === tag ||
                                    tag.includes(lockedTag.trim()) ||
                                    lockedTag.trim().includes(tag)) {
                                    isLocked = true;
                                    break;
                                }
                            }
                        }
                        if (isLocked) {
                            console.log('[imageInserter] Keeping locked <image> block, tag:', tag.substring(0, 50));
                            return match; // 保留锁定的
                        }
                    }

                    console.log('[imageInserter] Deleting unlocked <image> block with associated content, tag:', tag.substring(0, 50));
                    return ''; // 删除未锁定的（连同 <font> 和 <Tag_think>）
                });

                // 兜底：删除没有 <image> 包裹的独立 startTag...endTag 标签（旧格式兼容）
                mes = mes.replace(new RegExp(`${escapedStart}([\\s\\S]*?)${escapedEnd}`, 'g'), (match, tag) => {
                    if (lockedTagSet.size > 0) {
                        const tagTrimmed = tag.trim();
                        let isLocked = lockedTagSet.has(tagTrimmed);
                        if (!isLocked) {
                            for (const lockedTag of lockedTagSet) {
                                if (lockedTag.trim() === tagTrimmed ||
                                    tagTrimmed.includes(lockedTag.trim()) ||
                                    lockedTag.trim().includes(tagTrimmed)) {
                                    isLocked = true;
                                    break;
                                }
                            }
                        }
                        if (isLocked) return match; // 保留锁定的
                    }
                    return ''; // 删除未锁定的
                });

                // 清理多余换行
                mes = mes.replace(/\n{3,}/g, '\n\n');
                context.chat[id].mes = mes;

                const newLen = mes.length;
                console.log('[imageInserter] Cleaned mes content, removed', oldLen - newLen, 'chars',
                    lockedTagSet.size > 0 ? `(preserved ${lockedTagSet.size} locked tags)` : '(no locked tags)');

                // 重新渲染消息
                // 始终调用 renderMessage 以刷新页面元素（即使 mes 长度没变，DOM 元素也可能已被删除）
                if (oldLen !== newLen || removedCount > 0) {
                    if (lockedTagSet.size > 0 && mes.length > 100) {
                        console.log('[imageInserter] Forcing re-render to restore locked elements');
                    }
                    console.log('[imageInserter] Calling renderMessage to refresh page elements, mesChanged:', oldLen !== newLen, ', domRemoved:', removedCount);
                    await renderMessage(id);
                }
            }

            await saveChatConditional();
            console.log('[imageInserter] Saved chat after deletion');
        }
    }

    // 对于非 mesText 场景，需在此处执行 image_groups 删除逻辑
    // 模仿 lockAllTagsForElement 的方式：支持两种删除模式
    // 1. 精确模式：deletedTags 不为空时，只删除指定的 tag
    // 2. 全量模式：deletedTags 为空时（如 iframe 场景无法获取 DOM），删除所有非锁定的图片
    if (!mesText && elKeyForImageGroups) {
        console.log('[imageInserter] Non-mesText scenario: deleting from image_groups...');
        const imageGroups = await getcharData('image_groups') || {};
        if (imageGroups[elKeyForImageGroups]) {
            const existingImages = imageGroups[elKeyForImageGroups] || [];

            let remainingImages;
            if (deletedTags.size > 0) {
                // 精确模式：只删除指定的 tag
                remainingImages = existingImages.filter(img => {
                    if (img.locked === true) return true;
                    if (!deletedTags.has(img.tag?.trim())) return true;
                    console.log('[imageInserter] Deleting tag from image_groups:', img.tag?.substring(0, 30));
                    return false;
                });
            } else {
                // 全量模式：删除所有非锁定的图片（用于 iframe 等无法获取 DOM 的场景）
                console.log('[imageInserter] Fallback mode: deleting all unlocked images from image_groups');
                remainingImages = existingImages.filter(img => {
                    if (img.locked === true) {
                        console.log('[imageInserter] Keeping locked image:', img.tag?.substring(0, 30));
                        return true;
                    }
                    console.log('[imageInserter] Deleting unlocked image from image_groups:', img.tag?.substring(0, 30));
                    return false;
                });
            }

            const deletedCount = existingImages.length - remainingImages.length;

            if (deletedCount > 0) {
                if (remainingImages.length > 0) {
                    imageGroups[elKeyForImageGroups] = remainingImages;
                    await setcharData('image_groups', imageGroups);
                    console.log('[imageInserter] image_groups: deleted', deletedCount, ', remaining', remainingImages.length);
                } else {
                    delete imageGroups[elKeyForImageGroups];
                    await setcharData('image_groups', imageGroups);
                    console.log('[imageInserter] image_groups: deleted all, removed key:', elKeyForImageGroups);
                }
            } else {
                console.log('[imageInserter] image_groups: no images to delete (all locked or empty)');
            }
        } else {
            console.log('[imageInserter] image_groups: no data found for key:', elKeyForImageGroups);
        }
    }

    console.log('[imageInserter] deleteImagesForElement completed, locked count:', lockedCount);
    return { lockedCount };
}

/**
 * 锁定指定 tag
 * @param {HTMLElement} el - 元素（用于定位存储位置）
 * @param {string} tagToLock - 要锁定的 tag 内容
 * @returns {Promise<{success: boolean, message: string}>}
 */
export async function lockTagForElement(el, tagToLock) {
    if (!el || !tagToLock) {
        return { success: false, message: '参数无效' };
    }

    const mesText = findMesTextFromElement(el);

    if (mesText) {
        const mesBlock = mesText.closest('.mes');
        const id = parseInt(mesBlock?.getAttribute('mesid'), 10);
        const context = getContext();

        if (!isNaN(id) && context.chat[id]) {
            // 确保 extra 存在
            if (!context.chat[id].extra) {
                context.chat[id].extra = {};
            }

            // 方式1: 尝试在 extra.images 中锁定
            if (context.chat[id].extra.images) {
                const key = context.chat[id].swipe_id ?? 0;
                const images = context.chat[id].extra.images[key] || [];

                let found = false;
                for (const img of images) {
                    if (img.tag === tagToLock) {
                        img.locked = true;
                        found = true;
                    }
                }

                if (found) {
                    await saveChatConditional();
                    console.log('[imageInserter] Locked tag in extra.images:', tagToLock);
                    return { success: true, message: 'Tag 已锁定' };
                }
            }

            // 方式2: insertOriginalText 模式 - 使用 extra.lockedTags
            // 检查 mes 中是否存在该 tag（支持新格式 <image>tag</image> 和旧格式 image###tag###）
            const mes = context.chat[id].mes || '';
            const { startTag, endTag } = getImageTags();
            // 标准化 tag 用于比较（去掉换行）
            const tagNormalized = tagToLock.replaceAll("\n", "");
            const mesNormalized = mes.replaceAll("\n", "");
            // 检查新格式 <image>...</image> 或旧格式 startTag...endTag
            const hasTag = mesNormalized.includes(tagNormalized) ||
                mes.includes(`${startTag}${tagToLock}${endTag}`) ||
                mes.includes(`<image>${tagToLock}</image>`);
            if (hasTag) {
                // 初始化 lockedTags 数组
                if (!context.chat[id].extra.lockedTags) {
                    context.chat[id].extra.lockedTags = [];
                }

                // 添加到锁定列表（避免重复）
                if (!context.chat[id].extra.lockedTags.includes(tagToLock)) {
                    context.chat[id].extra.lockedTags.push(tagToLock);
                }

                await saveChatConditional();
                console.log('[imageInserter] Locked tag in extra.lockedTags:', tagToLock);
                return { success: true, message: 'Tag 已锁定' };
            }

            // 方式3: 备选 - 在 image_groups 中按 tag 全局搜索
            const searchResult = await findTagInImageGroups(tagToLock);
            if (searchResult) {
                const imageGroups = await getcharData('image_groups') || {};
                const images = imageGroups[searchResult.elKey];
                if (images && images[searchResult.index]) {
                    images[searchResult.index].locked = true;
                    await setcharData('image_groups', imageGroups);
                    console.log('[imageInserter] Locked tag in image_groups (fallback from mesText):', tagToLock);
                    return { success: true, message: 'Tag 已锁定' };
                }
            }

            return { success: false, message: '未找到匹配的 tag' };
        }
    } else {
        // chatMetadata - 优先使用 elKey 定位，失败则按 tag 全局搜索
        const logicalText = getCleanLogicalText(el);
        const elKey = generateElKey(logicalText);

        if (elKey) {
            const imageGroups = await getcharData('image_groups') || {};
            const images = imageGroups[elKey] || [];

            let found = false;
            for (const img of images) {
                if (img.tag === tagToLock) {
                    img.locked = true;
                    found = true;
                }
            }

            if (found) {
                imageGroups[elKey] = images;
                await setcharData('image_groups', imageGroups);
                console.log('[imageInserter] Locked tag in metadata:', tagToLock);
                return { success: true, message: 'Tag 已锁定' };
            }
        }

        // 备选方案：按 tag 内容全局搜索 image_groups
        const searchResult = await findTagInImageGroups(tagToLock);
        if (searchResult) {
            const imageGroups = await getcharData('image_groups') || {};
            const images = imageGroups[searchResult.elKey];
            if (images && images[searchResult.index]) {
                images[searchResult.index].locked = true;
                await setcharData('image_groups', imageGroups);
                console.log('[imageInserter] Locked tag in metadata (global search):', tagToLock);
                return { success: true, message: 'Tag 已锁定' };
            }
        }
    }

    return { success: false, message: '未找到匹配的 tag' };
}

/**
 * 解锁指定 tag
 * @param {HTMLElement} el - 元素（用于定位存储位置）
 * @param {string} tagToUnlock - 要解锁的 tag 内容
 * @returns {Promise<{success: boolean, message: string}>}
 */
export async function unlockTagForElement(el, tagToUnlock) {
    if (!el || !tagToUnlock) {
        return { success: false, message: '参数无效' };
    }

    const mesText = findMesTextFromElement(el);

    if (mesText) {
        const mesBlock = mesText.closest('.mes');
        const id = parseInt(mesBlock?.getAttribute('mesid'), 10);
        const context = getContext();

        if (!isNaN(id) && context.chat[id]) {
            // 方式1: 尝试在 extra.images 中解锁
            if (context.chat[id].extra?.images) {
                const key = context.chat[id].swipe_id ?? 0;
                const images = context.chat[id].extra.images[key] || [];

                let found = false;
                for (const img of images) {
                    if (img.tag === tagToUnlock) {
                        img.locked = false;
                        found = true;
                    }
                }

                if (found) {
                    await saveChatConditional();
                    console.log('[imageInserter] Unlocked tag in extra.images:', tagToUnlock);
                    return { success: true, message: 'Tag 已解锁' };
                }
            }

            // 方式2: insertOriginalText 模式 - 从 extra.lockedTags 中移除
            if (context.chat[id].extra?.lockedTags) {
                // 使用和 isTagLocked 一样的匹配逻辑来寻找要删除的索引
                const { startTag, endTag } = getImageTags();
                const escapedStart = startTag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                const escapedEnd = endTag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                const pureTagRegex = new RegExp(`${escapedStart}([\\s\\S]*?)${escapedEnd}`);
                const pureTagMatch = tagToUnlock.match(pureTagRegex);

                let tagNormalized;
                if (pureTagMatch) {
                    tagNormalized = pureTagMatch[1].trim().replaceAll("《", "<").replaceAll("》", ">").replaceAll("\n", "");
                } else {
                    tagNormalized = tagToUnlock.replaceAll("《", "<").replaceAll("》", ">").replaceAll("\n", "");
                }

                const tagPrefix = tagNormalized.substring(0, 100);
                let foundIdx = -1;

                for (let i = 0; i < context.chat[id].extra.lockedTags.length; i++) {
                    const lockedTag = context.chat[id].extra.lockedTags[i];
                    const lockedTagPrefix = lockedTag.substring(0, 100);
                    if (tagPrefix === lockedTagPrefix ||
                        tagNormalized.startsWith(lockedTagPrefix) ||
                        lockedTag.startsWith(tagPrefix)) {
                        foundIdx = i;
                        break;
                    }
                }

                if (foundIdx !== -1) {
                    const removedTag = context.chat[id].extra.lockedTags.splice(foundIdx, 1)[0];
                    await saveChatConditional();
                    console.log('[imageInserter] Unlocked tag from extra.lockedTags:', removedTag);
                    return { success: true, message: 'Tag 已解锁' };
                }
            }

            // 方式3: 备选 - 在 image_groups 中按 tag 全局搜索
            const searchResult = await findTagInImageGroups(tagToUnlock);
            if (searchResult) {
                const imageGroups = await getcharData('image_groups') || {};
                const images = imageGroups[searchResult.elKey];
                if (images && images[searchResult.index]) {
                    images[searchResult.index].locked = false;
                    await setcharData('image_groups', imageGroups);
                    console.log('[imageInserter] Unlocked tag in image_groups (fallback from mesText):', tagToUnlock);
                    return { success: true, message: 'Tag 已解锁' };
                }
            }

            return { success: false, message: '未找到匹配的 tag' };
        }
    } else {
        // chatMetadata - 优先使用 elKey 定位，失败则按 tag 全局搜索
        const logicalText = getCleanLogicalText(el);
        const elKey = generateElKey(logicalText);

        if (elKey) {
            const imageGroups = await getcharData('image_groups') || {};
            const images = imageGroups[elKey] || [];

            let found = false;
            for (const img of images) {
                if (img.tag === tagToUnlock) {
                    img.locked = false;
                    found = true;
                }
            }

            if (found) {
                imageGroups[elKey] = images;
                await setcharData('image_groups', imageGroups);
                console.log('[imageInserter] Unlocked tag in metadata:', tagToUnlock);
                return { success: true, message: 'Tag 已解锁' };
            }
        }

        // 备选方案：按 tag 内容全局搜索 image_groups
        const searchResult = await findTagInImageGroups(tagToUnlock);
        if (searchResult) {
            const imageGroups = await getcharData('image_groups') || {};
            const images = imageGroups[searchResult.elKey];
            if (images && images[searchResult.index]) {
                images[searchResult.index].locked = false;
                await setcharData('image_groups', imageGroups);
                console.log('[imageInserter] Unlocked tag in metadata (global search):', tagToUnlock);
                return { success: true, message: 'Tag 已解锁' };
            }
        }
    }

    return { success: false, message: '未找到匹配的 tag' };
}

/**
 * 检查指定 tag 是否已锁定
 * @param {HTMLElement} el - 元素（用于定位存储位置）
 * @param {string} tagToCheck - 要检查的 tag 内容
 * @returns {Promise<boolean>}
 */
export async function isTagLocked(el, tagToCheck) {
    if (!el || !tagToCheck) {
        return false;
    }

    const mesText = findMesTextFromElement(el);

    if (mesText) {
        const mesBlock = mesText.closest('.mes');
        const id = parseInt(mesBlock?.getAttribute('mesid'), 10);
        const context = getContext();

        if (!isNaN(id) && context.chat[id]) {
            // 方式1: 检查 extra.images
            if (context.chat[id].extra?.images) {
                const key = context.chat[id].swipe_id ?? 0;
                const images = context.chat[id].extra.images[key] || [];

                for (const img of images) {
                    if (img.tag === tagToCheck) {
                        return img.locked === true;
                    }
                }
            }

            // 方式2: 检查 extra.lockedTags (insertOriginalText 模式)
            if (context.chat[id].extra?.lockedTags) {
                // 从 tagToCheck 中提取纯 tag（image@@@...@@@ 里面的内容）
                const { startTag, endTag } = getImageTags();
                const escapedStart = startTag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                const escapedEnd = endTag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                const pureTagRegex = new RegExp(`${escapedStart}([\\s\\S]*?)${escapedEnd}`);
                const pureTagMatch = tagToCheck.match(pureTagRegex);

                let tagNormalized;
                if (pureTagMatch) {
                    // 有纯 tag，使用纯 tag
                    tagNormalized = pureTagMatch[1].trim().replaceAll("《", "<").replaceAll("》", ">").replaceAll("\n", "");
                } else {
                    // 没有纯 tag，直接标准化整个 tagToCheck
                    tagNormalized = tagToCheck.replaceAll("《", "<").replaceAll("》", ">").replaceAll("\n", "");
                }

                // 使用前 100 字符前缀匹配
                const tagPrefix = tagNormalized.substring(0, 100);
                for (const lockedTag of context.chat[id].extra.lockedTags) {
                    const lockedTagPrefix = lockedTag.substring(0, 100);
                    // 前缀匹配
                    if (tagPrefix === lockedTagPrefix ||
                        tagNormalized.startsWith(lockedTagPrefix) ||
                        lockedTag.startsWith(tagPrefix)) {
                        return true;
                    }
                }
            }

            // 方式3: 备选 - 在 image_groups 中按 tag 全局搜索
            const searchResult = await findTagInImageGroups(tagToCheck);
            if (searchResult) {
                return searchResult.images[searchResult.index]?.locked === true;
            }
        }
    } else {
        // chatMetadata - 优先使用 elKey 定位，失败则按 tag 全局搜索
        const logicalText = getCleanLogicalText(el);
        const elKey = generateElKey(logicalText);

        if (elKey) {
            const imageGroups = await getcharData('image_groups') || {};
            const images = imageGroups[elKey] || [];

            for (const img of images) {
                if (img.tag === tagToCheck) {
                    return img.locked === true;
                }
            }
        }

        const searchResult = await findTagInImageGroups(tagToCheck);
        if (searchResult) {
            return searchResult.images[searchResult.index]?.locked === true;
        }
    }

    return false;
}

export async function lockAllTagsForElement(el) {
    if (!el) {
        return { success: false, message: '参数无效', count: 0 };
    }

    const mesText = findMesTextFromElement(el);
    let lockedCount = 0;

    if (mesText) {
        const mesBlock = mesText.closest('.mes');
        const id = parseInt(mesBlock?.getAttribute('mesid'), 10);
        const context = getContext();

        if (!isNaN(id) && context.chat[id]) {
            if (context.chat[id].extra?.images) {
                const key = context.chat[id].swipe_id ?? 0;
                const images = context.chat[id].extra.images[key] || [];
                for (const img of images) {
                    if (!img.locked) {
                        img.locked = true;
                        lockedCount++;
                    }
                }
            }

            if (!context.chat[id].extra) {
                context.chat[id].extra = {};
            }
            if (!Array.isArray(context.chat[id].extra.lockedTags)) {
                context.chat[id].extra.lockedTags = [];
            }

            // 新增从 mes 正文中读取 tag 逻辑（支持 insertOriginalText 模式）
            if (context.chat[id].mes) {
                const { startTag, endTag } = getImageTags();
                const escapedStart = startTag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                const escapedEnd = endTag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

                // 1. 检查旧格式 startTag...endTag
                const mesTagRegex = new RegExp(`${escapedStart}([\\s\\S]*?)${escapedEnd}`, 'g');
                let match;
                while ((match = mesTagRegex.exec(context.chat[id].mes)) !== null) {
                    const tagInMes = match[1].trim();
                    if (!context.chat[id].extra.lockedTags.includes(tagInMes)) {
                        context.chat[id].extra.lockedTags.push(tagInMes);
                        lockedCount++;
                    }
                }

                // 2. 检查新格式 <image>...</image>
                const imageBlockRegex = /<image>([\s\S]*?)<\/image>/g;
                let imgMatch;
                while ((imgMatch = imageBlockRegex.exec(context.chat[id].mes)) !== null) {
                    let tagInMes = imgMatch[1];
                    const tagMatch = tagInMes.match(new RegExp(`${escapedStart}([\\s\\S]*?)${escapedEnd}`));
                    tagInMes = (tagMatch ? tagMatch[1] : tagInMes).trim();

                    if (!context.chat[id].extra.lockedTags.includes(tagInMes)) {
                        context.chat[id].extra.lockedTags.push(tagInMes);
                        lockedCount++;
                    }
                }
            }

            const logicalText = getCleanLogicalText(el);
            const elKey = generateElKey(logicalText);
            if (elKey) {
                const imageGroups = await getcharData('image_groups') || {};
                const imagesInGroups = imageGroups[elKey] || [];
                for (const img of imagesInGroups) {
                    if (!img.locked) {
                        img.locked = true;
                        lockedCount++;
                    }
                    if (img.tag && !context.chat[id].extra.lockedTags.includes(img.tag)) {
                        context.chat[id].extra.lockedTags.push(img.tag);
                    }
                }

                if (imagesInGroups.length > 0) {
                    imageGroups[elKey] = imagesInGroups;
                    await setcharData('image_groups', imageGroups);
                    console.log('[imageInserter] Also locked tags in image_groups, elKey:', elKey);
                }
            }

            if (lockedCount > 0) {
                await saveChatConditional();
                console.log('[imageInserter] Locked all tags for element, count:', lockedCount);
                return { success: true, message: `已锁定 ${lockedCount} 个 Tag`, count: lockedCount };
            }

            return { success: false, message: '没有找到可锁定的 Tag', count: 0 };
        }
    } else {
        const logicalText = getCleanLogicalText(el);
        const elKey = generateElKey(logicalText);

        if (elKey) {
            const imageGroups = await getcharData('image_groups') || {};
            const images = imageGroups[elKey] || [];

            for (const img of images) {
                if (!img.locked) {
                    img.locked = true;
                    lockedCount++;
                }
            }

            if (lockedCount > 0) {
                imageGroups[elKey] = images;
                await setcharData('image_groups', imageGroups);
                console.log('[imageInserter] Locked all tags in metadata, count:', lockedCount);
                return { success: true, message: `已锁定 ${lockedCount} 个 Tag`, count: lockedCount };
            }
        }
    }

    return { success: false, message: '没有找到可锁定的 Tag', count: 0 };
}

/**
 * 解锁元素关联的所有 tag
 * @param {HTMLElement} el - 元素（用于定位存储位置）
 * @returns {Promise<{success: boolean, message: string, count: number}>}
 */
export async function unlockAllTagsForElement(el) {
    if (!el) {
        return { success: false, message: '参数无效', count: 0 };
    }

    const mesText = findMesTextFromElement(el);
    let unlockedCount = 0;

    if (mesText) {
        const mesBlock = mesText.closest('.mes');
        const id = parseInt(mesBlock?.getAttribute('mesid'), 10);
        const context = getContext();

        if (!isNaN(id) && context.chat[id]) {
            // 方式1: 解锁 extra.images 中的所有 tag
            if (context.chat[id].extra?.images) {
                const key = context.chat[id].swipe_id ?? 0;
                const images = context.chat[id].extra.images[key] || [];

                for (const img of images) {
                    if (img.locked) {
                        img.locked = false;
                        unlockedCount++;
                    }
                }
            }

            // 方式2: 清空 lockedTags 数组
            if (context.chat[id].extra?.lockedTags && context.chat[id].extra.lockedTags.length > 0) {
                unlockedCount += context.chat[id].extra.lockedTags.length;
                context.chat[id].extra.lockedTags = [];
            }

            // 方式3: 同时解锁 image_groups 中的 tag
            const logicalText = getCleanLogicalText(el);
            const elKey = generateElKey(logicalText);
            if (elKey) {
                const imageGroups = await getcharData('image_groups') || {};
                const imagesInGroups = imageGroups[elKey] || [];

                for (const img of imagesInGroups) {
                    if (img.locked) {
                        img.locked = false;
                        unlockedCount++;
                    }
                }

                if (imagesInGroups.length > 0) {
                    imageGroups[elKey] = imagesInGroups;
                    await setcharData('image_groups', imageGroups);
                    console.log('[imageInserter] Also unlocked tags in image_groups, elKey:', elKey);
                }
            }

            if (unlockedCount > 0) {
                await saveChatConditional();
                console.log('[imageInserter] Unlocked all tags for element, count:', unlockedCount);
                return { success: true, message: `已解锁 ${unlockedCount} 个 Tag`, count: unlockedCount };
            }

            return { success: false, message: '没有找到已锁定的 Tag', count: 0 };
        }
    } else {
        // chatMetadata
        const logicalText = getCleanLogicalText(el);
        const elKey = generateElKey(logicalText);

        if (elKey) {
            const imageGroups = await getcharData('image_groups') || {};
            const images = imageGroups[elKey] || [];

            for (const img of images) {
                if (img.locked) {
                    img.locked = false;
                    unlockedCount++;
                }
            }

            if (unlockedCount > 0) {
                imageGroups[elKey] = images;
                await setcharData('image_groups', imageGroups);
                console.log('[imageInserter] Unlocked all tags in metadata, count:', unlockedCount);
                return { success: true, message: `已解锁 ${unlockedCount} 个 Tag`, count: unlockedCount };
            }
        }
    }

    return { success: false, message: '没有找到已锁定的 Tag', count: 0 };
}

/**
 * 删除指定的单个 tag
 * 从 extra.images、extra.lockedTags、image_groups 三个位置删除
 * @param {HTMLElement} el - 元素（用于定位存储位置）
 * @param {string} tag - 要删除的 tag 内容
 * @returns {Promise<{success: boolean, message: string}>}
 */
export async function deleteTagForElement(el, tag) {
    if (!el || !tag) {
        return { success: false, message: '参数无效' };
    }

    const tagToDelete = tag.trim();
    let deletedFromAny = false;

    const mesText = findMesTextFromElement(el);

    if (mesText) {
        const mesBlock = mesText.closest('.mes');
        const id = parseInt(mesBlock?.getAttribute('mesid'), 10);
        const context = getContext();

        if (!isNaN(id) && context.chat[id]) {
            // 1. 从 extra.images 中删除
            if (context.chat[id].extra?.images) {
                const key = context.chat[id].swipe_id ?? 0;
                const images = context.chat[id].extra.images[key] || [];
                const originalLength = images.length;
                context.chat[id].extra.images[key] = images.filter(img => img.tag?.trim() !== tagToDelete);
                if (context.chat[id].extra.images[key].length < originalLength) {
                    deletedFromAny = true;
                    console.log('[imageInserter] Deleted tag from extra.images');
                }
            }

            // 2. 从 extra.lockedTags 中删除
            if (context.chat[id].extra?.lockedTags) {
                const originalLength = context.chat[id].extra.lockedTags.length;
                context.chat[id].extra.lockedTags = context.chat[id].extra.lockedTags.filter(t => t.trim() !== tagToDelete);
                if (context.chat[id].extra.lockedTags.length < originalLength) {
                    deletedFromAny = true;
                    console.log('[imageInserter] Deleted tag from extra.lockedTags');
                }
            }

            // 3. 从正文 mes 中删除 tag（insertOriginalText 模式）
            if (context.chat[id].mes) {
                const { startTag, endTag } = getImageTags();
                const escapedStart = escapeRegExp(startTag);
                const escapedEnd = escapeRegExp(endTag);
                const tagPattern = new RegExp(`\\n*<image>${escapedStart}${escapeRegExp(tagToDelete)}${escapedEnd}<\\/image>`, 'g');
                const tagPattern2 = new RegExp(`\\n*${escapedStart}${escapeRegExp(tagToDelete)}${escapedEnd}`, 'g');
                const originalMes = context.chat[id].mes;
                let newMes = originalMes.replace(tagPattern, '');
                newMes = newMes.replace(tagPattern2, '');
                if (newMes !== originalMes) {
                    context.chat[id].mes = newMes;
                    deletedFromAny = true;
                    console.log('[imageInserter] Deleted tag from mes content');
                }
            }

            if (deletedFromAny) {
                await saveChatConditional();
                // 刷新消息显示以更新 DOM
                await renderMessage(id);
            }

            // 方式4: 备选 - 在 image_groups 中按 tag 全局搜索（模仿 lockTagForElement）
            // 用于 extra.images 和 mes 都没有该 tag 的场景
            if (!deletedFromAny) {
                const searchResult = await findTagInImageGroups(tagToDelete);
                if (searchResult) {
                    const imageGroups = await getcharData('image_groups') || {};
                    const images = imageGroups[searchResult.elKey];
                    if (images && images[searchResult.index]) {
                        // 删除找到的 tag
                        images.splice(searchResult.index, 1);
                        if (images.length > 0) {
                            imageGroups[searchResult.elKey] = images;
                        } else {
                            delete imageGroups[searchResult.elKey];
                        }
                        await setcharData('image_groups', imageGroups);
                        deletedFromAny = true;
                        console.log('[imageInserter] Deleted tag from image_groups (fallback from mesText):', tagToDelete.substring(0, 30));
                    }
                }
            }

            if (!deletedFromAny) {
                return { success: false, message: '未找到匹配的 tag' };
            }
        }
    }

    // 4. 从 image_groups 中删除
    const logicalText = getCleanLogicalText(el);
    const elKey = generateElKey(logicalText);
    if (elKey) {
        const imageGroups = await getcharData('image_groups') || {};
        const images = imageGroups[elKey] || [];
        const originalLength = images.length;
        const filteredImages = images.filter(img => img.tag?.trim() !== tagToDelete);

        if (filteredImages.length < originalLength) {
            imageGroups[elKey] = filteredImages;
            await setcharData('image_groups', imageGroups);
            deletedFromAny = true;
            console.log('[imageInserter] Deleted tag from image_groups');
        }
    }

    // 备选方案：按 tag 内容全局搜索 image_groups（模仿 lockTagForElement 的方式3）
    // 用于 elKey 无法正确生成的场景（如 iframe 内触发）
    if (!deletedFromAny) {
        const searchResult = await findTagInImageGroups(tagToDelete);
        if (searchResult) {
            const imageGroups = await getcharData('image_groups') || {};
            const images = imageGroups[searchResult.elKey];
            if (images && images[searchResult.index]) {
                // 删除找到的 tag
                images.splice(searchResult.index, 1);
                if (images.length > 0) {
                    imageGroups[searchResult.elKey] = images;
                } else {
                    delete imageGroups[searchResult.elKey];
                }
                await setcharData('image_groups', imageGroups);
                deletedFromAny = true;
                console.log('[imageInserter] Deleted tag from image_groups (global search fallback):', tagToDelete.substring(0, 30));
            }
        }
    }

    if (deletedFromAny) {
        return { success: true, message: 'Tag 已删除' };
    }

    return { success: false, message: '未找到该 Tag' };
}

/**
 * 转义正则表达式特殊字符
 * @param {string} string - 要转义的字符串
 * @returns {string} 转义后的字符串
 */
function escapeRegExp(string) {
    return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
