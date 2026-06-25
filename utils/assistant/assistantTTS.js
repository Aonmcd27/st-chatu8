/**
 * assistantTTS.js
 * 
 * TTS 语音朗读完整管线：对话文本提取、Edge TTS 参数获取、
 * 风格标注注入、按钮状态管理、缓存播放、事件监听等。
 */

import {
    dom, activeChat,
    ttsAudioCache, ttsActiveMessageIndex, ttsCurrentRequestId,
    ttsButtonState, ttsCollectingBlobUrls, ttsCollectingTotalSegments,
    setTtsActiveMessageIndex, setTtsCurrentRequestId,
    setTtsButtonState, setTtsCollectingBlobUrls, setTtsCollectingTotalSegments
} from './assistantContext.js';
import { extensionName, eventNames } from '../config.js';
import { extension_settings } from "../../../../../extensions.js";
import { eventSource } from "../../../../../../script.js";
import { getEdgeVoiceStyles } from '../tts.js';

// ═══════════════════════════════════════════════════════════
//  对话文本提取
// ═══════════════════════════════════════════════════════════

/**
 * 从 AI 回复中提取「」（直角引号）内的对话文本
 * 先去除思维链 <think>...</think> 和系统命令标签，再匹配「」
 * @param {string} rawReply - AI 的完整回复
 * @param {string} scope - 朗读范围：'dialogue' 仅语音，'full' 全文
 * @returns {{ text: string, segments: Array<{text: string, style: string|null}> }} 拼接后的对话文本
 */
export function extractDialogueForTTS(rawReply, scope = 'dialogue') {
    if (!rawReply || typeof rawReply !== 'string') return '';

    // 1. 去除思维链
    let cleaned = rawReply;
    const lastThinkClose = cleaned.lastIndexOf('</think>');
    if (lastThinkClose !== -1) {
        cleaned = cleaned.substring(lastThinkClose + 8).trim();
    }
    cleaned = cleaned.replace(/<think>[\s\S]*/gi, '');

    // 2. 去除系统命令标签
    cleaned = cleaned.replace(/<SystemQuery>[\s\S]*?<\/SystemQuery>/gi, '');
    cleaned = cleaned.replace(/<UpdateSettings>[\s\S]*?<\/UpdateSettings>/gi, '');

    // 3. 去除 AskChoice 标签
    cleaned = cleaned.replace(/<AskChoice>[\s\S]*?<\/AskChoice>/gi, '');

    // 4. 根据朗读范围提取内容
    if (scope === 'full') {
        // 全文模式：去除风格标注后返回全部文本
        // 移除所有 (styleId) 标注
        const textWithoutStyles = cleaned.replace(/」\s*\((\w[\w-]*)\)/g, '」');
        console.log('[AI Assistant TTS] 全文模式，提取文本长度:', textWithoutStyles.length);
        return { text: textWithoutStyles, segments: [{ text: textWithoutStyles, style: null }] };
    }

    // 仅语音模式：提取所有「」内的内容，同时捕获可选的 (styleId) 标注
    const matches = [];
    const regex = /「([^」]+)」(?:\s*\((\w[\w-]*)\))?/g;
    let match;
    while ((match = regex.exec(cleaned)) !== null) {
        const text = match[1].trim();
        const style = match[2] || null;
        if (text) matches.push({ text, style });
    }

    // 5. 去重
    const unique = [];
    const seen = new Set();
    for (const seg of matches) {
        const normalized = seg.text.replace(/[-~·・]/g, '').replace(/\s+/g, '');
        if (!seen.has(normalized)) {
            seen.add(normalized);
            unique.push(seg);
        }
    }

    console.log('[AI Assistant TTS] extractDialogueForTTS cleaned:', cleaned.substring(0, 200));
    console.log('[AI Assistant TTS] 提取到', unique.length, '段对话');

    // 6. 构建返回结果
    const joinedText = unique.map(seg => `"${seg.text}"`).join('\n');
    const segments = unique.map(seg => ({ text: `"${seg.text}"`, style: seg.style }));

    return { text: joinedText, segments };
}

// ═══════════════════════════════════════════════════════════
//  Edge TTS 参数
// ═══════════════════════════════════════════════════════════

/**
 * 获取当前 Edge TTS 参数（从 extension_settings 读取）
 * @returns {object}
 */
export function getEdgeTTSParams() {
    const aiConfig = extension_settings[extensionName]?.chatu8_ai_assistant || {};
    if (aiConfig.tts_engine !== 'edge') return {};
    return {
        edgeVoice: aiConfig.tts_edge_voice,
        edgeStyle: aiConfig.tts_edge_style,
        edgeRate: aiConfig.tts_edge_rate,
        edgePitch: aiConfig.tts_edge_pitch
    };
}

/**
 * 使用 TTS 播放一段错误/提示消息（不关联任何气泡按钮）
 * @param {string} text - 要朗读的文本
 */
export function speakNotification(text) {
    const aiConfig = extension_settings[extensionName]?.chatu8_ai_assistant || {};
    if (!aiConfig.tts_enabled || !text) return;

    eventSource.emit(eventNames.TTS_STOP);

    const reqId = 'tts-notify-' + Date.now();
    const edgeParams = getEdgeTTSParams();
    eventSource.emit(eventNames.TTS_REQUEST, { id: reqId, text, ...edgeParams });
}

// ═══════════════════════════════════════════════════════════
//  TTS 风格标注注入
// ═══════════════════════════════════════════════════════════

/**
 * 将 TTS 逐句风格标注指令注入到系统提示词中
 * @param {string} systemPromptStr - 原始系统提示词
 * @returns {string} 注入风格标注后的系统提示词
 */
export function injectTTSStyleInstruction(systemPromptStr) {
    const aiConfig = extension_settings[extensionName]?.chatu8_ai_assistant || {};
    if (!aiConfig.tts_enabled || aiConfig.tts_engine !== 'edge') return systemPromptStr;
    const voiceId = aiConfig.tts_edge_voice || 'zh-CN-XiaoxiaoNeural';
    const styles = getEdgeVoiceStyles(voiceId);
    if (!styles || styles.length <= 1) return systemPromptStr;

    const styleList = styles.map(s => `${s.id}（${s.name}）`).join('、');

    const originalSection = `◆ 对话格式规范（非常重要！）
你对用户说的每一句话，都必须用「」（直角引号）括起来，就像你真的在"说话"一样。
说话时要自然地带上语气助词（额、啊、哦、呢、嘛、吧、呀、哇、唔、嗯）和情感标点（！、……、～、——、？），还原真实的口语感和情绪。

正确示例：
「额……让我看看啊，这个配置好像有点问题呢！」
「哦哦！找到了找到了～就是这个参数嘛！」
「唔……你确定要这样改吗？算了算了，我来帮你微调一下吧！」
「搞定了哦！哼，也就这种程度而已啦……才不是为了你呢。」
「呜哇！对不起对不起！额……请再给我一次机会啊！」
「嗯嗯，我明白了！那就……全功率启动——！」`;

    const enhancedSection = `◆ 对话格式规范（非常重要！）
你对用户说的每一句话，都必须用「」（直角引号）括起来，就像你真的在"说话"一样。
说话时要自然地带上语气助词（额、啊、哦、呢、嘛、吧、呀、哇、唔、嗯）和情感标点（！、……、～、——、？），还原真实的口语感和情绪。

🔊 TTS 语音风格标注（当前已启用）：
每句「」对话后面，必须紧跟一个英文小括号标注语音风格，格式：「对话内容」(风格ID)
风格标记紧跟」号，中间不要有换行或空格。每句对话都必须标注，不要遗漏。
当前可用风格：${styleList}
根据对话内容的情感选择最匹配的风格，不确定时用 general。

正确示例（注意每句后面都有风格标注）：
「额……让我看看啊，这个配置好像有点问题呢！」(gentle)
「哦哦！找到了找到了～就是这个参数嘛！」(cheerful)
「唔……你确定要这样改吗？算了算了，我来帮你微调一下吧！」(calm)
「搞定了哦！哼，也就这种程度而已啦……才不是为了你呢。」(disgruntled)
「呜哇！对不起对不起！额……请再给我一次机会啊！」(sad)
「嗯嗯，我明白了！那就……全功率启动——！」(cheerful)`;

    if (systemPromptStr.includes(originalSection)) {
        return systemPromptStr.replace(originalSection, enhancedSection);
    }

    // 降级方案：追加到末尾
    return systemPromptStr + `\n\n🔊 TTS 语音风格标注（当前已启用）：\n每句「」对话后面，必须紧跟英文小括号标注语音风格：「对话内容」(风格ID)\n当前可用风格：${styleList}\n根据情感选择最匹配的风格，不确定时用 general。每句都必须标注。\n示例：「你好呀！」(cheerful)　「唔……好奇怪呢」(gentle)　「什么？！」(angry)\n`;
}

// ═══════════════════════════════════════════════════════════
//  TTS 按钮状态管理
// ═══════════════════════════════════════════════════════════

/**
 * 更新所有 TTS 按钮的图标状态
 * @param {number} messageIndex - 消息索引（-1 表示重置所有按钮）
 * @param {'idle'|'loading'|'playing'} newState - 新状态
 */
export function updateTTSButtonIcon(messageIndex, newState) {
    const dialog = $('#st-chatu8-ai-dialog');
    let buttons;
    if (messageIndex >= 0) {
        buttons = dialog.find(`.st-chatu8-ai-msg-tts[data-index="${messageIndex}"]`);
    } else {
        buttons = dialog.find('.st-chatu8-ai-msg-tts');
    }

    buttons.each(function () {
        const $btn = $(this);
        const $icon = $btn.find('i');
        $icon.removeClass('fa-volume-up fa-spinner fa-spin fa-stop');

        switch (newState) {
            case 'loading':
                $icon.addClass('fa-spinner fa-spin');
                $btn.attr('title', '正在请求语音...');
                break;
            case 'playing':
                $icon.addClass('fa-stop');
                $btn.attr('title', '停止朗读');
                break;
            case 'idle':
            default:
                $icon.addClass('fa-volume-up');
                $btn.attr('title', '朗读此回复');
                break;
        }
    });
}

// ═══════════════════════════════════════════════════════════
//  缓存播放
// ═══════════════════════════════════════════════════════════

/**
 * 使用缓存的 blobUrl 列表直接播放音频（不经过 tts.js 网络请求）
 * @param {string[]} blobUrls - 缓存的 blob URL 数组
 * @param {number} messageIndex - 消息索引
 */
export function playCachedAudio(blobUrls, messageIndex) {
    if (!blobUrls || blobUrls.length === 0) return;

    setTtsActiveMessageIndex(messageIndex);
    setTtsButtonState('playing');
    updateTTSButtonIcon(messageIndex, 'playing');

    let currentIdx = 0;
    let currentAudio = null;
    let stopped = false;

    const onStop = () => {
        stopped = true;
        if (currentAudio) {
            try { currentAudio.pause(); currentAudio.currentTime = 0; } catch { }
            currentAudio = null;
        }
        cleanup();
    };
    eventSource.on(eventNames.TTS_STOP, onStop);

    function cleanup() {
        eventSource.removeListener(eventNames.TTS_STOP, onStop);
        setTtsActiveMessageIndex(-1);
        setTtsButtonState('idle');
        setTtsCurrentRequestId('');
        updateTTSButtonIcon(messageIndex, 'idle');
    }

    function playNext() {
        if (stopped || currentIdx >= blobUrls.length) {
            if (!stopped) cleanup();
            return;
        }

        const url = blobUrls[currentIdx];
        currentIdx++;
        let advanced = false;

        try {
            const audio = new Audio(url);
            currentAudio = audio;

            audio.onended = () => {
                if (advanced) return;
                advanced = true;
                currentAudio = null;
                playNext();
            };
            audio.onerror = () => {
                if (advanced) return;
                advanced = true;
                console.warn('[AI Assistant TTS] 缓存音频播放出错, 跳过段落', currentIdx);
                currentAudio = null;
                playNext();
            };
            audio.play().catch(e => {
                if (advanced) return;
                advanced = true;
                console.warn('[AI Assistant TTS] 缓存音频播放失败:', e.message);
                currentAudio = null;
                playNext();
            });
        } catch (e) {
            if (!advanced) {
                advanced = true;
                console.warn('[AI Assistant TTS] 创建缓存音频失败:', e.message);
                playNext();
            }
        }
    }

    console.log(`[AI Assistant TTS] 使用缓存播放 ${blobUrls.length} 段音频`);
    playNext();
}

// ═══════════════════════════════════════════════════════════
//  TTS 触发
// ═══════════════════════════════════════════════════════════

/**
 * 如果 TTS 开关开启，从 AI 回复中提取「」对话并发起 TTS 请求
 * @param {string} accumulatedReply - AI 的完整回复
 * @param {number} [messageIndex=-1] - 对应的消息索引，用于联动气泡上的喇叭按钮
 */
export function tryPlayTTS(accumulatedReply, messageIndex = -1) {
    const aiConfig = extension_settings[extensionName]?.chatu8_ai_assistant || {};
    if (!aiConfig.tts_enabled) return;

    const scope = aiConfig.tts_scope || 'dialogue';
    const result = extractDialogueForTTS(accumulatedReply, scope);
    if (!result || !result.text) return;

    console.log('[AI Assistant TTS] 提取到对话文本，准备朗读:', result.text.substring(0, 100));

    eventSource.emit(eventNames.TTS_STOP);

    const reqId = 'tts-auto-' + Date.now();
    const edgeParams = getEdgeTTSParams();

    // 设置 TTS 状态，联动气泡上的喇叭按钮
    if (messageIndex >= 0) {
        setTtsActiveMessageIndex(messageIndex);
        setTtsCurrentRequestId(reqId);
        setTtsButtonState('loading');
        setTtsCollectingBlobUrls([]);
        setTtsCollectingTotalSegments(0);
        updateTTSButtonIcon(messageIndex, 'loading');
    }

    const hasPerSegmentStyle = result.segments.some(s => s.style);
    if (hasPerSegmentStyle && aiConfig.tts_engine === 'edge') {
        eventSource.emit(eventNames.TTS_REQUEST, {
            id: reqId,
            text: result.text,
            segments: result.segments,
            ...edgeParams
        });
    } else {
        eventSource.emit(eventNames.TTS_REQUEST, { id: reqId, text: result.text, ...edgeParams });
    }
}

// ═══════════════════════════════════════════════════════════
//  TTS 按钮点击处理
// ═══════════════════════════════════════════════════════════

/**
 * 统一的 TTS 按钮点击处理函数
 * @param {number} messageIndex - 消息索引
 */
export function handleTTSButtonClick(messageIndex) {
    if (!activeChat || !activeChat.messages[messageIndex]) return;

    // 1. 如果当前正在播放/加载此消息的 TTS → 停止
    if (ttsActiveMessageIndex === messageIndex && ttsButtonState !== 'idle') {
        console.log('[AI Assistant TTS] 停止当前消息的 TTS');
        eventSource.emit(eventNames.TTS_STOP);
        setTtsActiveMessageIndex(-1);
        setTtsButtonState('idle');
        setTtsCurrentRequestId('');
        updateTTSButtonIcon(messageIndex, 'idle');
        return;
    }

    // 2. 如果其他消息正在 TTS → 先停止
    if (ttsActiveMessageIndex >= 0 && ttsButtonState !== 'idle') {
        const prevIndex = ttsActiveMessageIndex;
        eventSource.emit(eventNames.TTS_STOP);
        updateTTSButtonIcon(prevIndex, 'idle');
    }

    // 3. 提取对话文本
    const msgContent = activeChat.messages[messageIndex].content;
    const rawText = typeof msgContent === 'string' ? msgContent : '';
    if (!rawText) return;

    const aiConfig = extension_settings[extensionName]?.chatu8_ai_assistant || {};
    const scope = aiConfig.tts_scope || 'dialogue';
    const result = extractDialogueForTTS(rawText, scope);
    if (!result || !result.text) {
        console.log('[AI Assistant TTS] 该消息中未找到可朗读内容');
        return;
    }

    // 4. 检查缓存
    const cached = ttsAudioCache.get(messageIndex);
    if (cached && cached.dialogue === result.text && cached.blobUrls.length > 0) {
        const isComplete = !cached.totalSegments || cached.blobUrls.length >= cached.totalSegments;
        if (isComplete) {
            console.log(`[AI Assistant TTS] 缓存命中（${cached.blobUrls.length}/${cached.totalSegments || '?'} 段），直接播放`);
            eventSource.emit(eventNames.TTS_STOP);
            playCachedAudio(cached.blobUrls, messageIndex);
            return;
        } else {
            console.log(`[AI Assistant TTS] 缓存不完整 (${cached.blobUrls.length}/${cached.totalSegments})，重新请求`);
            ttsAudioCache.delete(messageIndex);
        }
    }

    // 5. 发起新的 TTS 请求
    const reqId = 'tts-msg-' + messageIndex + '-' + Date.now();
    setTtsActiveMessageIndex(messageIndex);
    setTtsCurrentRequestId(reqId);
    setTtsButtonState('loading');
    setTtsCollectingBlobUrls([]);
    setTtsCollectingTotalSegments(0);
    updateTTSButtonIcon(messageIndex, 'loading');

    const edgeParams = getEdgeTTSParams();

    const hasPerSegmentStyle = result.segments.some(s => s.style);
    if (hasPerSegmentStyle && aiConfig.tts_engine === 'edge' && scope === 'dialogue') {
        console.log('[AI Assistant TTS] 手动朗读(逐句风格):', result.text.substring(0, 100), 'reqId:', reqId);
        eventSource.emit(eventNames.TTS_REQUEST, {
            id: reqId,
            text: result.text,
            segments: result.segments,
            ...edgeParams
        });
    } else {
        console.log('[AI Assistant TTS] 手动朗读:', result.text.substring(0, 100), 'reqId:', reqId);
        eventSource.emit(eventNames.TTS_REQUEST, { id: reqId, text: result.text, ...edgeParams });
    }
}

// ═══════════════════════════════════════════════════════════
//  TTS 事件监听器
// ═══════════════════════════════════════════════════════════

/**
 * 初始化 TTS 事件监听器（在 initAiAssistant 内调用）
 */
export function setupTTSEventListeners() {
    // 监听 TTS 状态变化
    eventSource.on(eventNames.TTS_STATE_CHANGED, (data) => {
        const { state: ttsState } = data;

        if (ttsState === 'idle') {
            if (ttsActiveMessageIndex >= 0) {
                const collectedCount = ttsCollectingBlobUrls.filter(Boolean).length;
                if (collectedCount > 0 && ttsActiveMessageIndex >= 0) {
                    if (activeChat && activeChat.messages[ttsActiveMessageIndex]) {
                        const msgContent = activeChat.messages[ttsActiveMessageIndex].content;
                        const rawText = typeof msgContent === 'string' ? msgContent : '';
                        const aiConfig = extension_settings[extensionName]?.chatu8_ai_assistant || {};
                        const scope = aiConfig.tts_scope || 'dialogue';
                        const cacheResult = extractDialogueForTTS(rawText, scope);
                        if (cacheResult && cacheResult.text) {
                            const isComplete = ttsCollectingTotalSegments > 0 && collectedCount >= ttsCollectingTotalSegments;
                            if (isComplete) {
                                ttsAudioCache.set(ttsActiveMessageIndex, {
                                    dialogue: cacheResult.text,
                                    blobUrls: ttsCollectingBlobUrls.filter(Boolean),
                                    totalSegments: ttsCollectingTotalSegments
                                });
                                console.log(`[AI Assistant TTS] 已缓存消息 #${ttsActiveMessageIndex} 的 ${collectedCount}/${ttsCollectingTotalSegments} 段音频（完整）`);
                            } else {
                                console.log(`[AI Assistant TTS] 消息 #${ttsActiveMessageIndex} 音频不完整 (${collectedCount}/${ttsCollectingTotalSegments})，不缓存`);
                            }
                        }
                    }
                }

                const prevIndex = ttsActiveMessageIndex;
                setTtsActiveMessageIndex(-1);
                setTtsButtonState('idle');
                setTtsCurrentRequestId('');
                setTtsCollectingBlobUrls([]);
                setTtsCollectingTotalSegments(0);
                updateTTSButtonIcon(prevIndex, 'idle');
            }
        } else if (ttsState === 'active') {
            // TTS 开始工作 - 保持 loading 状态直到第一个段落开始播放
        }
    });

    // 监听 TTS 响应事件，收集 blobUrl 用于缓存 & 更新按钮状态
    eventSource.on(eventNames.TTS_RESPONSE, (data) => {
        const { status, blobUrl, totalSegments, segIndex } = data;

        if (totalSegments > 0 && ttsActiveMessageIndex >= 0) {
            setTtsCollectingTotalSegments(totalSegments);
        }

        if (blobUrl && status === 'ready' && ttsActiveMessageIndex >= 0) {
            if (typeof segIndex === 'number' && segIndex >= 0) {
                ttsCollectingBlobUrls[segIndex] = blobUrl;
            } else {
                ttsCollectingBlobUrls.push(blobUrl);
            }
        }

        if (status === 'playing' && ttsActiveMessageIndex >= 0 && ttsButtonState !== 'playing') {
            setTtsButtonState('playing');
            updateTTSButtonIcon(ttsActiveMessageIndex, 'playing');
        }
    });
}
