// ═══════════════════════════════════════════════════════════
//  ASR 语音输入模块 (utils/asr.js)
//  从 tts示例/通话.html 提取 ASR 功能，改造为 eventSource 事件驱动模块
//  核心思路：麦克风录音 → VAD检测 → 尾部截取 → 降采样WAV → ASR识别 → 填入输入框
// ═══════════════════════════════════════════════════════════

import { eventSource, saveSettingsDebounced } from '../../../../../script.js';
import { eventNames, extensionName, defaultSettings } from './config.js';
import { extension_settings } from '../../../../extensions.js';
import { getTTSState } from './tts.js';
import { isAiGenerating } from './assistant/assistantContext.js';

// ── 日志 ──────────────────────────────────────────────────
function log(msg) {
    console.log('[ASR]', msg);
}

// ── 配置读取 ──────────────────────────────────────────────
export function getASRConfig() {
    const settings = extension_settings[extensionName];
    const defaults = defaultSettings.asr;
    return {
        ...defaults,
        ...(settings?.asr || {}),
    };
}

export function saveASRConfig(partial) {
    if (!extension_settings[extensionName]) return;
    if (!extension_settings[extensionName].asr) {
        extension_settings[extensionName].asr = { ...defaultSettings.asr };
    }
    Object.assign(extension_settings[extensionName].asr, partial);
    saveSettingsDebounced();
}

// ── 全局状态 ──────────────────────────────────────────────
let state = 'idle'; // 'idle' | 'recording' | 'processing'
let currentMode = 'vad'; // 'vad' | 'ptt'
let currentTargetInput = null; // 指定ASR结果填入的输入框选择器 (如 '#st-chatu8-ai-input')

// 麦克风持久化
let persistentStream = null;
let audioCtx = null;
let analyserNode = null;
let micSource = null;

// 录音器
let mediaRecorder = null;
let audioChunks = [];
let recordingStartTime = 0;

// VAD
let silenceTimer = null;
let isSpeaking = false;
let hasSpoken = false;
let vadRunning = false;

// 最大录音超时定时器
let maxDurationTimer = null;

// 麦克风按钮引用
let micBtnEl = null;

// ── 多轮对话模式状态 ─────────────────────────────────────
let conversationModeActive = false;  // 多轮对话模式是否激活（运行时开关）
let conversationMuted = false;       // 当前是否处于自动禁音状态（AI生成或TTS播放中）
let conversationAutoSendFn = null;   // 自动发送回调（由智绘姬AI对话界面注册）
let conversationResumeTimer = null;  // TTS结束后延迟恢复录音的定时器
let conversationWatchdogInterval = null; // 周期性看门狗：检测 LLM/TTS 是否已结束但 ASR 仍被禁音

// ═══════════════════════════════════════════════════════════
//  麦克风管理
// ═══════════════════════════════════════════════════════════
async function ensureMic() {
    if (persistentStream && persistentStream.active) return true;

    // ── 安全上下文检查（移动端 HTTP 下 mediaDevices 完全不可用） ──
    if (typeof window !== 'undefined' && window.isSecureContext === false) {
        log('❌ 非安全上下文（需要 HTTPS），无法使用麦克风');
        showMobileToast('需要 HTTPS 才能使用麦克风，请确保通过 HTTPS 访问');
        eventSource.emit(eventNames.ASR_ERROR, {
            message: '需要 HTTPS 才能使用麦克风，请确保通过 HTTPS 访问',
            code: 'INSECURE_CONTEXT',
        });
        return false;
    }

    // ── API 存在性检查 ──
    if (!navigator.mediaDevices || typeof navigator.mediaDevices.getUserMedia !== 'function') {
        log('❌ 浏览器不支持 mediaDevices.getUserMedia（可能为非安全上下文或旧版浏览器）');
        showMobileToast('当前浏览器或环境不支持麦克风，请使用 HTTPS 访问');
        eventSource.emit(eventNames.ASR_ERROR, {
            message: '当前浏览器不支持麦克风功能，请确认使用 HTTPS 访问且浏览器版本支持',
            code: 'NOT_SUPPORTED',
        });
        return false;
    }

    // ── 先创建/恢复 AudioContext（在用户手势同步上下文中，对移动端至关重要） ──
    // 移动端要求 AudioContext 必须在用户交互的同步调用栈中创建或 resume
    // 如果放在 await getUserMedia() 之后，已脱离手势上下文，会导致 AudioContext 永久 suspended
    if (!audioCtx) {
        audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        log('🔊 AudioContext 已创建, state=' + audioCtx.state);
    }
    if (audioCtx.state === 'suspended') {
        try {
            await audioCtx.resume();
            log('🔊 AudioContext 已恢复, state=' + audioCtx.state);
        } catch (e) {
            log('⚠️ AudioContext resume 失败: ' + e.message);
        }
    }

    // ── 请求麦克风权限 ──
    try {
        persistentStream = await navigator.mediaDevices.getUserMedia({ audio: true });
        log('✅ 麦克风权限已获取');
    } catch (e) {
        log('❌ 麦克风权限被拒: ' + e.message);
        showMobileToast('麦克风权限被拒绝，请在浏览器设置中允许');
        eventSource.emit(eventNames.ASR_ERROR, {
            message: '麦克风权限被拒绝，请允许后重试',
            code: 'MIC_DENIED',
        });
        return false;
    }

    // ── getUserMedia 成功后再次确保 AudioContext 处于 running 状态 ──
    // 某些移动浏览器在获得麦克风权限后才真正允许 AudioContext resume
    if (audioCtx.state === 'suspended') {
        try {
            await audioCtx.resume();
            log('🔊 AudioContext 二次恢复, state=' + audioCtx.state);
        } catch (e) {
            log('⚠️ AudioContext 二次 resume 失败: ' + e.message);
        }
    }

    micSource = audioCtx.createMediaStreamSource(persistentStream);
    analyserNode = audioCtx.createAnalyser();
    analyserNode.fftSize = 2048;
    micSource.connect(analyserNode);
    return true;
}

/**
 * 在页面上短暂显示 Toast 提示（主要用于移动端错误反馈）
 * @param {string} msg - 提示文字
 * @param {number} [duration=3000] - 显示时长 ms
 */
function showMobileToast(msg, duration = 3000) {
    try {
        // 如果 SillyTavern 有 toastr，优先使用
        if (typeof toastr !== 'undefined' && toastr.warning) {
            toastr.warning(msg, 'ASR');
            return;
        }
        // 降级：创建简单 toast
        const toast = document.createElement('div');
        toast.textContent = msg;
        Object.assign(toast.style, {
            position: 'fixed',
            bottom: '80px',
            left: '50%',
            transform: 'translateX(-50%)',
            background: 'rgba(0,0,0,0.8)',
            color: '#fff',
            padding: '10px 20px',
            borderRadius: '8px',
            fontSize: '14px',
            zIndex: '99999',
            maxWidth: '85vw',
            textAlign: 'center',
            pointerEvents: 'none',
            transition: 'opacity 0.3s',
        });
        document.body.appendChild(toast);
        setTimeout(() => {
            toast.style.opacity = '0';
            setTimeout(() => toast.remove(), 300);
        }, duration);
    } catch (e) {
        // 静默忽略 toast 失败
    }
}

function releaseMic() {
    if (micSource) { try { micSource.disconnect(); } catch (e) { /* ignore */ } micSource = null; }
    if (analyserNode) { analyserNode = null; }
    if (persistentStream) {
        persistentStream.getTracks().forEach(t => t.stop());
        persistentStream = null;
    }
    if (audioCtx) {
        try { audioCtx.close(); } catch (e) { /* ignore */ }
        audioCtx = null;
    }
    log('🎤 麦克风已释放');
}

// ═══════════════════════════════════════════════════════════
//  VAD 语音活动检测
// ═══════════════════════════════════════════════════════════
function runVAD() {
    if (!analyserNode || state !== 'recording' || currentMode !== 'vad') {
        vadRunning = false;
        return;
    }
    vadRunning = true;
    const buf = new Float32Array(analyserNode.fftSize);
    const config = getASRConfig();

    function tick() {
        if (state !== 'recording' || currentMode !== 'vad') {
            vadRunning = false;
            return;
        }
        analyserNode.getFloatTimeDomainData(buf);
        let sum = 0;
        for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
        const rms = Math.sqrt(sum / buf.length);

        const threshold = config.vadThreshold;
        const timeout = config.silenceTimeout;

        if (rms > threshold) {
            isSpeaking = true;
            hasSpoken = true;
            if (silenceTimer) { clearTimeout(silenceTimer); silenceTimer = null; }
        } else if (isSpeaking) {
            isSpeaking = false;
            if (!silenceTimer && hasSpoken) {
                silenceTimer = setTimeout(() => {
                    silenceTimer = null;
                    if (state === 'recording') {
                        log('🔇 静音检测 → 自动停止');
                        stopRecording();
                    }
                }, timeout);
            }
        }
        requestAnimationFrame(tick);
    }
    requestAnimationFrame(tick);
}

// ═══════════════════════════════════════════════════════════
//  录音控制
// ═══════════════════════════════════════════════════════════
async function startRecording() {
    if (state === 'recording') return;
    if (state === 'processing') return;

    const config = getASRConfig();
    currentMode = config.mode || 'vad';

    const ok = await ensureMic();
    if (!ok) return;

    audioChunks = [];
    const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus' : 'audio/webm';
    mediaRecorder = new MediaRecorder(persistentStream, { mimeType });
    mediaRecorder.ondataavailable = e => { if (e.data.size > 0) audioChunks.push(e.data); };
    mediaRecorder.onstop = async () => {
        // 清理定时器
        if (maxDurationTimer) { clearTimeout(maxDurationTimer); maxDurationTimer = null; }
        if (silenceTimer) { clearTimeout(silenceTimer); silenceTimer = null; }

        const duration = Date.now() - recordingStartTime;

        if (!hasSpoken || audioChunks.length === 0) {
            log('⚠️ 未检测到语音，跳过');
            setState('idle');
            return;
        }

        const blob = new Blob(audioChunks, { type: mimeType });
        log(`🎤 录音完成: ${(blob.size / 1024).toFixed(1)}KB, ${(duration / 1000).toFixed(1)}s`);

        setState('processing');
        processAudio(blob, duration);
    };

    mediaRecorder.start(100);
    recordingStartTime = Date.now();
    hasSpoken = false;
    isSpeaking = false;
    setState('recording');

    if (currentMode === 'vad' && !vadRunning) runVAD();

    // 安全超时：60秒强制停止（防止忘记停止）
    maxDurationTimer = setTimeout(() => {
        maxDurationTimer = null;
        if (state === 'recording') {
            log('⏰ 录音超时60s → 强制停止');
            stopRecording();
        }
    }, 60000);

    log('🎙️ 录音开始 [' + currentMode.toUpperCase() + ']');
}

function stopRecording() {
    if (state !== 'recording' || !mediaRecorder || mediaRecorder.state === 'inactive') return;
    if (silenceTimer) { clearTimeout(silenceTimer); silenceTimer = null; }
    isSpeaking = false;
    mediaRecorder.stop();
}

// ═══════════════════════════════════════════════════════════
//  ASR 结果有效性验证
// ═══════════════════════════════════════════════════════════
/**
 * 检查 ASR 返回的文本是否为有效的语音识别结果。
 * 过滤掉服务端错误信息、状态提示等非语音内容。
 * @param {string} text - ASR 返回的文本
 * @returns {boolean} - 是否为有效的识别结果
 */
function isValidASRResult(text) {
    if (!text || typeof text !== 'string') return false;
    const trimmed = text.trim();
    if (!trimmed) return false;

    // 已知的服务端错误/状态消息模式
    // 注意：避免匹配正常语音中可能出现的词汇，仅匹配典型的服务端错误格式
    const invalidPatterns = [
        /响应.*不完整/,
        /结构.*不完整/,
        /服务[器端].*错误/,
        /服务不可用/,
        /请求超时/,
        /连接.*失败/,
        /^error$/i,
        /^failed$/i,
        /^timeout$/i,
        /internal.?server.?error/i,
        /service.?unavailable/i,
        /bad.?gateway/i,
        /rate.?limit/i,
        /too.?many.?requests/i,
        /traceback\s*\(/i,      // Python 错误堆栈
        /exception\s*:/i,       // 异常信息格式
        /^\s*\{.*"error".*\}\s*$/,  // JSON 错误对象
        /^\s*\[.*\]\s*$/,           // 纯 JSON 数组（无文本内容）
    ];

    for (const pattern of invalidPatterns) {
        if (pattern.test(trimmed)) {
            log(`⚠️ ASR 结果被过滤（匹配无效模式 ${pattern}）: "${trimmed}"`);
            return false;
        }
    }

    return true;
}

// ═══════════════════════════════════════════════════════════
//  音频处理：尾部截取 + 降采样 + WAV转换
// ═══════════════════════════════════════════════════════════
async function processAudio(blob, duration) {
    try {
        if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        if (audioCtx.state === 'suspended') await audioCtx.resume();

        const arrBuf = await blob.arrayBuffer();
        let buffer;
        try {
            buffer = await audioCtx.decodeAudioData(arrBuf);
        } catch (e) {
            log('⚠️ 音频解码失败: ' + e.message);
            eventSource.emit(eventNames.ASR_ERROR, { message: '音频解码失败', code: 'DECODE_ERROR' });
            setState('idle');
            return;
        }

        const config = getASRConfig();
        const maxKeep = config.maxKeepDuration || 10;
        const totalDuration = buffer.duration;

        // ── 尾部截取 ──
        let bufferToConvert = buffer;
        if (totalDuration > maxKeep) {
            const keepSamples = Math.floor(maxKeep * buffer.sampleRate);
            const startSample = buffer.length - keepSamples;
            const trimmedBuffer = audioCtx.createBuffer(
                buffer.numberOfChannels,
                keepSamples,
                buffer.sampleRate
            );
            for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
                const src = buffer.getChannelData(ch);
                const dst = trimmedBuffer.getChannelData(ch);
                dst.set(src.subarray(startSample));
            }
            bufferToConvert = trimmedBuffer;
            log(`✂️ 尾部截取: ${totalDuration.toFixed(1)}s → 保留末尾 ${maxKeep}s`);
        }

        // ── 降采样 + WAV转换 ──
        const wavBlob = toWavFromBuffer(bufferToConvert, 16000);
        const wavFile = new File([wavBlob], `asr_${Date.now()}.wav`, { type: 'audio/wav' });
        log(`📦 WAV 文件: ${(wavFile.size / 1024).toFixed(1)}KB (16kHz)`);

        // ── ASR识别 ──
        const text = await runASR(wavFile);

        if (text && isValidASRResult(text)) {
            log(`🔤 识别结果: "${text}"`);
            const target = currentTargetInput || '#send_textarea';
            eventSource.emit(eventNames.ASR_RESULT, {
                text,
                target,
                success: true,
                duration,
            });
            fillTextToInput(text, target);

            // 多轮对话模式：自动发送（仅限智绘姬AI界面的输入框，且 autoSend 开启）
            if (conversationModeActive && conversationAutoSendFn && target === '#st-chatu8-ai-input' && config.autoSend !== false) {
                log('🔄 多轮对话模式：自动发送');
                // 稍微延迟以确保 input 事件已处理
                setTimeout(() => {
                    if (conversationModeActive && conversationAutoSendFn) {
                        conversationAutoSendFn();
                    }
                }, 100);
            }

            currentTargetInput = null; // 重置
        } else {
            log('⚠️ ASR 响应结构不完整或未返回有效结果，不填入文字');
            eventSource.emit(eventNames.ASR_RESULT, {
                text: '',
                target: currentTargetInput || '#send_textarea',
                success: false,
                duration,
            });

            // 无论是否为多轮对话模式，识别失败时都自动重新开始录音
            // （多轮对话模式额外检查 conversationMuted 状态）
            const shouldRestart = conversationModeActive
                ? !conversationMuted
                : (currentMode === 'vad'); // 非对话模式下仅 VAD 模式自动重录
            if (shouldRestart) {
                log('🔄 ASR 识别失败，自动重新开始录音');
                setTimeout(() => {
                    if (state === 'idle') {
                        // 多轮对话模式下需再次确认未被禁音
                        if (conversationModeActive && conversationMuted) return;
                        startRecording();
                    }
                }, 500);
            }
        }

        setState('idle');
    } catch (e) {
        log('❌ 音频处理失败: ' + e.message);
        eventSource.emit(eventNames.ASR_ERROR, { message: e.message, code: 'PROCESS_ERROR' });
        setState('idle');

        // 处理失败时也尝试自动重新开始录音
        const shouldRestart = conversationModeActive
            ? !conversationMuted
            : (currentMode === 'vad');
        if (shouldRestart) {
            log('🔄 音频处理失败，自动重新开始录音');
            setTimeout(() => {
                if (state === 'idle') {
                    if (conversationModeActive && conversationMuted) return;
                    startRecording();
                }
            }, 500);
        }
    }
}

// ═══════════════════════════════════════════════════════════
//  WAV 转换（降采样到16kHz单声道）
// ═══════════════════════════════════════════════════════════
function toWavFromBuffer(buffer, targetSampleRate = 16000) {
    const origSR = buffer.sampleRate;
    const origLen = buffer.length;
    const ch = buffer.numberOfChannels;

    // 1. 混合为单声道
    const mono = new Float32Array(origLen);
    for (let i = 0; i < origLen; i++) {
        let s = 0;
        for (let c = 0; c < ch; c++) s += buffer.getChannelData(c)[i];
        mono[i] = s / ch;
    }

    // 2. 降采样（线性插值）
    const ratio = origSR / targetSampleRate;
    const newLen = Math.floor(origLen / ratio);
    const resampled = new Float32Array(newLen);
    for (let i = 0; i < newLen; i++) {
        const srcIdx = i * ratio;
        const idx0 = Math.floor(srcIdx);
        const idx1 = Math.min(idx0 + 1, origLen - 1);
        const frac = srcIdx - idx0;
        resampled[i] = mono[idx0] * (1 - frac) + mono[idx1] * frac;
    }

    // 3. Float32 → Int16 PCM
    const pcm = new Int16Array(newLen);
    for (let i = 0; i < newLen; i++) {
        pcm[i] = Math.max(-32768, Math.min(32767, Math.round(resampled[i] * 32767)));
    }

    // 4. WAV header + data
    const wav = new ArrayBuffer(44 + pcm.byteLength);
    const v = new DataView(wav);
    const ws = (o, str) => { for (let i = 0; i < str.length; i++) v.setUint8(o + i, str.charCodeAt(i)); };
    ws(0, 'RIFF');
    v.setUint32(4, 36 + pcm.byteLength, true);
    ws(8, 'WAVE');
    ws(12, 'fmt ');
    v.setUint32(16, 16, true);           // PCM format chunk size
    v.setUint16(20, 1, true);            // Audio format: PCM
    v.setUint16(22, 1, true);            // Channels: 1 (mono)
    v.setUint32(24, targetSampleRate, true); // Sample rate
    v.setUint32(28, targetSampleRate * 2, true); // Byte rate
    v.setUint16(32, 2, true);            // Block align
    v.setUint16(34, 16, true);           // Bits per sample
    ws(36, 'data');
    v.setUint32(40, pcm.byteLength, true);
    new Uint8Array(wav, 44).set(new Uint8Array(pcm.buffer));

    return new Blob([wav], { type: 'audio/wav' });
}

// ═══════════════════════════════════════════════════════════
//  文件上传
// ═══════════════════════════════════════════════════════════
async function uploadFile(file, baseUrl) {
    const fd = new FormData();
    fd.append('files', file);
    const r = await fetch(`${baseUrl}/gradio_api/upload`, { method: 'POST', body: fd });
    if (!r.ok) throw new Error(`上传失败 ${r.status}`);
    const j = await r.json();
    return Array.isArray(j) ? j[0] : j;
}

// ═══════════════════════════════════════════════════════════
//  ASR 识别请求
// ═══════════════════════════════════════════════════════════
async function runASR(file) {
    const config = getASRConfig();
    const asrBase = (config.asrServerUrl || 'https://qwen-qwen3-asr-demo.ms.show').replace(/\/+$/, '');

    try {
        log('🔤 ASR 上传中...');
        const path = await uploadFile(file, asrBase);

        const postBody = {
            data: [
                {
                    path,
                    orig_name: file.name,
                    size: file.size,
                    mime_type: file.type || 'audio/wav',
                    meta: { _type: 'gradio.FileData' },
                },
                '',                        // context
                config.language || 'auto', // language
                false,                     // ITN
            ],
        };

        const postResp = await fetch(`${asrBase}/gradio_api/call/asr_inference`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(postBody),
        });
        if (!postResp.ok) throw new Error(`ASR 提交失败 ${postResp.status}`);

        let postJson;
        try {
            postJson = await postResp.json();
        } catch (e) {
            throw new Error('ASR 响应结构不完整：无法解析提交响应 JSON');
        }
        const { event_id } = postJson;
        if (!event_id) {
            throw new Error('ASR 响应结构不完整：缺少 event_id');
        }

        log(`📋 ASR 任务 ${event_id}`);

        const getResp = await fetch(`${asrBase}/gradio_api/call/asr_inference/${event_id}`);
        if (!getResp.ok) throw new Error(`ASR 获取结果失败 ${getResp.status}`);

        const text = await getResp.text();
        if (!text || !text.trim()) {
            throw new Error('ASR 响应结构不完整：返回内容为空');
        }

        // 按 Gradio SSE 规范解析：event: 行指定事件类型，data: 行是数据
        // 只接受 event: complete 的 data，拒绝 event: error 等
        let currentEventType = null;
        let foundDataLine = false;
        let errorMessage = null;

        for (const line of text.split('\n')) {
            const trimmed = line.trim();
            if (!trimmed) {
                // 空行重置事件类型（SSE 规范：空行分隔事件）
                currentEventType = null;
                continue;
            }
            if (trimmed.startsWith('event:')) {
                currentEventType = trimmed.slice(6).trim();
                log(`📡 ASR SSE 事件类型: ${currentEventType}`);
                continue;
            }
            if (trimmed.startsWith('data:')) {
                foundDataLine = true;
                const rawPayload = trimmed.slice(5).trim();

                // 如果是 error 事件，记录错误信息
                if (currentEventType === 'error') {
                    log('⚠️ ASR 服务端返回 error 事件');
                    try {
                        const errData = JSON.parse(rawPayload);
                        errorMessage = typeof errData === 'string' ? errData : JSON.stringify(errData);
                    } catch {
                        errorMessage = rawPayload || '未知服务端错误';
                    }
                    continue;
                }

                // 仅接受 complete 事件的 data（或无 event 类型时兼容旧格式）
                if (currentEventType && currentEventType !== 'complete') {
                    log(`📡 ASR 跳过非 complete 事件: ${currentEventType}`);
                    continue;
                }

                if (!rawPayload) {
                    log('⚠️ ASR data: 行内容为空，跳过');
                    continue;
                }
                let data;
                try {
                    data = JSON.parse(rawPayload);
                } catch {
                    log('⚠️ ASR data: 行 JSON 解析失败，跳过');
                    continue;
                }
                if (!Array.isArray(data)) {
                    log('⚠️ ASR 响应数据不是数组，跳过');
                    continue;
                }
                if (data[0] && typeof data[0] === 'string' && data[0].trim()) {
                    return data[0];
                }
            }
        }

        if (errorMessage) {
            throw new Error(`ASR 服务端错误: ${errorMessage}`);
        }
        if (!foundDataLine) {
            throw new Error('ASR 响应结构不完整：未找到 data: 行');
        }
        throw new Error('ASR 响应结构不完整：未返回有效识别文本');
    } catch (e) {
        log('⚠️ ASR 失败: ' + e.message);
        eventSource.emit(eventNames.ASR_ERROR, {
            message: 'ASR 识别失败: ' + e.message,
            code: 'ASR_FAILED',
        });
        return null;
    }
}

// ═══════════════════════════════════════════════════════════
//  填入输入框
// ═══════════════════════════════════════════════════════════
function fillTextToInput(text, target = '#send_textarea') {
    // target 支持 CSS 选择器 (如 '#send_textarea' 或 '#st-chatu8-ai-input')
    const selector = target.startsWith('#') ? target : `#${target}`;
    const textarea = document.querySelector(selector);
    if (!textarea) {
        log('⚠️ 未找到输入框 #' + target);
        return;
    }

    const config = getASRConfig();
    if (config.appendMode && textarea.value.trim()) {
        textarea.value = textarea.value.trimEnd() + ' ' + text;
    } else {
        textarea.value = text;
    }

    // 触发 input 事件，确保 SillyTavern 检测到变化
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
    textarea.focus();

    // 自动调整输入框高度
    textarea.style.height = 'auto';
    textarea.style.height = textarea.scrollHeight + 'px';

    log('✅ 文字已填入输入框');
}

// ═══════════════════════════════════════════════════════════
//  状态管理
// ═══════════════════════════════════════════════════════════
function setState(s) {
    state = s;
    eventSource.emit(eventNames.ASR_STATE_CHANGED, {
        state: s,
        mode: currentMode,
    });
    updateMicButton();
}

function updateMicButton() {
    if (!micBtnEl) return;
    const icon = micBtnEl.querySelector('i');
    if (!icon) return;

    // 移除所有状态类
    micBtnEl.classList.remove('ch-asr-recording', 'ch-asr-processing');

    switch (state) {
        case 'idle':
            icon.className = 'fa-solid fa-microphone';
            micBtnEl.title = currentMode === 'ptt' ? '按住说话' : '点击开始语音输入';
            break;
        case 'recording':
            icon.className = 'fa-solid fa-microphone';
            micBtnEl.classList.add('ch-asr-recording');
            micBtnEl.title = '正在录音...';
            break;
        case 'processing':
            icon.className = 'fa-solid fa-spinner fa-spin';
            micBtnEl.classList.add('ch-asr-processing');
            micBtnEl.title = '正在识别...';
            break;
    }
}

// ═══════════════════════════════════════════════════════════
//  麦克风按钮注入
// ═══════════════════════════════════════════════════════════
function injectMicButton() {
    if (micBtnEl) return; // 已注入

    const sendForm = document.querySelector('#send_form');
    if (!sendForm) {
        log('⚠️ 未找到 #send_form，延迟注入');
        setTimeout(injectMicButton, 2000);
        return;
    }

    // 注入样式
    if (!document.querySelector('#ch-asr-styles')) {
        const style = document.createElement('style');
        style.id = 'ch-asr-styles';
        style.textContent = `
            .ch-asr-mic-btn {
                width: 36px;
                height: 36px;
                min-width: 44px;
                min-height: 44px;
                border: 1px solid var(--SmartThemeBorderColor, #555);
                background: var(--SmartThemeBlurTintColor, #2a2a2a);
                border-radius: 8px;
                color: inherit;
                opacity: 0.8;
                cursor: pointer;
                font-size: 16px;
                display: flex;
                align-items: center;
                justify-content: center;
                transition: all 0.2s;
                flex-shrink: 0;
                margin-right: 4px;
                -webkit-tap-highlight-color: transparent;
                touch-action: manipulation;
                user-select: none;
                -webkit-user-select: none;
            }
            .ch-asr-mic-btn:hover {
                border-color: var(--SmartThemeQuoteColor, #4a9eff);
                color: var(--SmartThemeQuoteColor, #4a9eff);
            }
            .ch-asr-mic-btn.ch-asr-recording {
                background: rgba(214, 48, 49, 0.2);
                border-color: #d63031;
                color: #d63031;
                animation: ch-asr-pulse 1.5s infinite;
            }
            .ch-asr-mic-btn.ch-asr-processing {
                background: rgba(9, 132, 227, 0.15);
                border-color: #0984e3;
                color: #0984e3;
            }
            @keyframes ch-asr-pulse {
                0% { box-shadow: 0 0 0 0 rgba(214, 48, 49, 0.5); }
                70% { box-shadow: 0 0 0 8px rgba(214, 48, 49, 0); }
                100% { box-shadow: 0 0 0 0 rgba(214, 48, 49, 0); }
            }
        `;
        document.head.appendChild(style);
    }

    // 创建按钮
    micBtnEl = document.createElement('div');
    micBtnEl.id = 'ch-asr-mic-btn';
    micBtnEl.className = 'ch-asr-mic-btn';
    micBtnEl.title = '点击开始语音输入';
    micBtnEl.innerHTML = '<i class="fa-solid fa-microphone"></i>';

    // 事件绑定
    // 使用标志位防止 touch 和 mouse/click 重复触发
    let touchHandled = false;

    micBtnEl.addEventListener('touchstart', (e) => {
        touchHandled = true;
        onMicDown(e);
    }, { passive: false });

    micBtnEl.addEventListener('touchend', (e) => {
        onMicUp(e);
        // 延迟重置标志位，阻止随后的 mouse/click 事件
        setTimeout(() => { touchHandled = false; }, 300);
    }, { passive: false });

    micBtnEl.addEventListener('mousedown', (e) => {
        if (touchHandled) return; // 已由 touch 处理
        onMicDown(e);
    });

    micBtnEl.addEventListener('mouseup', (e) => {
        if (touchHandled) return;
        onMicUp(e);
    });

    // click 作为后备（部分移动浏览器 touchstart 不可靠时）
    micBtnEl.addEventListener('click', (e) => {
        if (touchHandled) return; // 已由 touch 处理
        e.preventDefault();
        // click 仅处理 VAD 模式的切换（PTT 需要 down/up 配对）
        const config = getASRConfig();
        const mode = config.mode || 'vad';
        if (mode === 'vad') {
            if (state === 'processing') return;
            if (state === 'idle') startRecording();
            else if (state === 'recording') stopRecording();
        }
    });

    micBtnEl.addEventListener('contextmenu', e => e.preventDefault());

    // 插入到 send_textarea 前面（或 send_form 内合适位置）
    const textarea = sendForm.querySelector('#send_textarea');
    if (textarea && textarea.parentNode) {
        textarea.parentNode.insertBefore(micBtnEl, textarea);
    } else {
        sendForm.insertBefore(micBtnEl, sendForm.firstChild);
    }

    log('🎤 麦克风按钮已注入');
    updateMicButton();
}

function removeMicButton() {
    if (micBtnEl) {
        // 因为现在使用匿名包装函数绑定事件，直接移除 DOM 即可
        // 事件监听器会随元素一起被垃圾回收
        micBtnEl.remove();
        micBtnEl = null;
        log('🎤 麦克风按钮已移除');
    }
}

// ═══════════════════════════════════════════════════════════
//  按钮交互
// ═══════════════════════════════════════════════════════════
function onMicDown(e) {
    e.preventDefault();
    if (state === 'processing') return;

    const config = getASRConfig();
    currentMode = config.mode || 'vad';

    if (currentMode === 'ptt') {
        // 按住说话模式
        startRecording();
    } else {
        // VAD模式：点击切换
        if (state === 'idle') startRecording();
        else if (state === 'recording') stopRecording();
    }
}

function onMicUp(e) {
    e.preventDefault();
    if (currentMode === 'ptt' && state === 'recording') {
        stopRecording();
    }
}

// ═══════════════════════════════════════════════════════════
//  设置界面联动
// ═══════════════════════════════════════════════════════════
function initSettingsUI() {
    // 等待设置面板加载完成
    const checkAndBind = () => {
        const enabledCheckbox = document.querySelector('#asr_enabled');
        if (!enabledCheckbox) {
            // 设置面板可能还没加载，稍后再试
            setTimeout(checkAndBind, 1000);
            return;
        }

        const config = getASRConfig();

        // 初始化开关状态
        enabledCheckbox.checked = config.enabled;
        toggleAdvancedSettings(config.enabled);

        // 开关事件
        enabledCheckbox.addEventListener('change', () => {
            const enabled = enabledCheckbox.checked;
            saveASRConfig({ enabled });
            toggleAdvancedSettings(enabled);
            if (enabled) {
                injectMicButton();
            } else {
                if (state === 'recording') stopRecording();
                removeMicButton();
                releaseMic();
            }
        });

        // 静音超时
        bindRangeControl('asr_silence_timeout', 'silenceTimeout', config.silenceTimeout);

        // VAD灵敏度
        bindRangeControl('asr_vad_threshold', 'vadThreshold', config.vadThreshold);

        // 最大保留时长
        bindRangeControl('asr_max_keep_duration', 'maxKeepDuration', config.maxKeepDuration);

        // 录音模式
        const modeSelect = document.querySelector('#asr_mode');
        if (modeSelect) {
            modeSelect.value = config.mode || 'vad';
            modeSelect.addEventListener('change', () => {
                saveASRConfig({ mode: modeSelect.value });
                currentMode = modeSelect.value;
                updateMicButton();
            });
        }

        // 识别语言
        const langSelect = document.querySelector('#asr_language');
        if (langSelect) {
            langSelect.value = config.language || 'auto';
            langSelect.addEventListener('change', () => {
                saveASRConfig({ language: langSelect.value });
            });
        }

        // 输入模式
        const appendSelect = document.querySelector('#asr_append_mode');
        if (appendSelect) {
            appendSelect.value = String(config.appendMode !== false);
            appendSelect.addEventListener('change', () => {
                saveASRConfig({ appendMode: appendSelect.value === 'true' });
            });
        }

        log('⚙️ 设置界面已绑定');
    };

    checkAndBind();
}

function bindRangeControl(baseId, configKey, initialValue) {
    const slider = document.querySelector(`#${baseId}`);
    const numberInput = document.querySelector(`#${baseId}_value`);

    if (slider) {
        slider.value = initialValue;
        slider.addEventListener('input', () => {
            const val = parseFloat(slider.value);
            if (numberInput) numberInput.value = val;
            saveASRConfig({ [configKey]: val });
        });
    }
    if (numberInput) {
        numberInput.value = initialValue;
        numberInput.addEventListener('input', () => {
            const val = parseFloat(numberInput.value);
            if (slider) slider.value = val;
            saveASRConfig({ [configKey]: val });
        });
    }
}

function toggleAdvancedSettings(show) {
    const advanced = document.querySelector('#asr-advanced-settings');
    if (advanced) {
        advanced.style.display = show ? '' : 'none';
    }
}

// ═══════════════════════════════════════════════════════════
//  初始化 & 销毁
// ═══════════════════════════════════════════════════════════

/**
 * 初始化 ASR 模块
 */
export function initializeASR() {
    // 注册事件监听
    eventSource.on(eventNames.ASR_START, (data) => {
        if (data?.mode) currentMode = data.mode;
        if (data?.targetInput) currentTargetInput = data.targetInput;
        startRecording();
    });

    eventSource.on(eventNames.ASR_STOP, () => {
        if (state === 'recording') stopRecording();
    });

    // ── 多轮对话模式：监听 TTS 状态变化 ──
    eventSource.on(eventNames.TTS_STATE_CHANGED, (data) => {
        if (!conversationModeActive) return;
        const ttsState = data?.state;

        if (ttsState === 'active') {
            // TTS 开始播放 → 禁音（停止录音）
            conversationMuted = true;
            if (state === 'recording') {
                log('🔇 多轮对话：TTS 播放中，暂停录音');
                stopRecording();
            }
            if (conversationResumeTimer) {
                clearTimeout(conversationResumeTimer);
                conversationResumeTimer = null;
            }
        } else if (ttsState === 'idle') {
            // TTS 播放结束 → 延迟恢复录音
            conversationMuted = false;
            clearWatchdog(); // TTS 正常结束，清理看门狗
            if (conversationModeActive) {
                log('🔊 多轮对话：TTS 播放结束，延迟恢复录音');
                if (conversationResumeTimer) {
                    clearTimeout(conversationResumeTimer);
                }
                conversationResumeTimer = setTimeout(() => {
                    conversationResumeTimer = null;
                    if (!conversationModeActive || conversationMuted) return;
                    if (state === 'idle') {
                        log('🎙️ 多轮对话：自动恢复录音');
                        currentTargetInput = '#st-chatu8-ai-input';
                        startRecording();
                    } else if (state === 'processing') {
                        // ASR 正在处理上一次录音结果，等处理完成后会自动判断是否重新录音
                        log('🎙️ 多轮对话：ASR 正在处理中，等待处理完成后自动恢复');
                    }
                    // state === 'recording' 时无需操作，已在录音中
                }, 800); // 延迟 800ms 避免录到 TTS 尾音
            }
        }
    });

    // 检查是否启用，如果启用则注入按钮
    const config = getASRConfig();
    if (config.enabled) {
        // 等待 DOM 就绪
        if (document.readyState === 'complete') {
            injectMicButton();
        } else {
            window.addEventListener('load', () => injectMicButton());
        }
    }

    // 初始化设置UI联动
    initSettingsUI();

    log('✅ ASR 语音输入模块已初始化');
}

/**
 * 外部切换 ASR 启用/禁用 (供智绘姬AI助手设置面板调用)
 * @param {boolean} enabled
 */
export function setASREnabled(enabled) {
    saveASRConfig({ enabled });
    if (enabled) {
        injectMicButton();
    } else {
        if (state === 'recording') stopRecording();
        removeMicButton();
        releaseMic();
    }
    // 同步 ai.html 中的设置面板复选框 (如果已加载)
    const settingsCheckbox = document.querySelector('#asr_enabled');
    if (settingsCheckbox) {
        settingsCheckbox.checked = enabled;
        toggleAdvancedSettings(enabled);
    }
    log(enabled ? '✅ ASR 已启用' : '⛔ ASR 已禁用');
}

/**
 * 获取 ASR 当前启用状态
 * @returns {boolean}
 */
export function isASREnabled() {
    return getASRConfig().enabled;
}

// ═══════════════════════════════════════════════════════════
//  多轮对话模式 API
// ═══════════════════════════════════════════════════════════

/**
 * 开启多轮对话模式
 * @param {Function} autoSendFn - 自动发送回调（由智绘姬AI对话界面提供）
 * @param {boolean} [startMuted=false] - 是否以禁音状态启动（AI正在生成或TTS正在播放时）
 */
export function startConversationMode(autoSendFn, startMuted = false) {
    conversationModeActive = true;
    conversationMuted = startMuted;
    conversationAutoSendFn = autoSendFn || null;
    if (conversationResumeTimer) {
        clearTimeout(conversationResumeTimer);
        conversationResumeTimer = null;
    }

    if (startMuted) {
        log('🗣️ 多轮对话模式已开启（等待中：AI生成或TTS播放尚未结束）');
    } else {
        log('🗣️ 多轮对话模式已开启');
        // 立即开始录音（目标：智绘姬AI输入框）
        currentTargetInput = '#st-chatu8-ai-input';
        if (state === 'idle') {
            startRecording();
        }
    }
}

/**
 * 停止多轮对话模式
 */
export function stopConversationMode() {
    conversationModeActive = false;
    conversationMuted = false;
    conversationAutoSendFn = null;
    clearWatchdog(); // 清理看门狗
    if (conversationResumeTimer) {
        clearTimeout(conversationResumeTimer);
        conversationResumeTimer = null;
    }
    if (state === 'recording') {
        stopRecording();
    }
    log('🔇 多轮对话模式已关闭');
}

/**
 * 获取多轮对话模式当前状态
 * @returns {boolean}
 */
export function isConversationMode() {
    return conversationModeActive;
}

/**
 * 通知 ASR 模块：AI 开始生成（外部调用，用于禁音）
 */
export function notifyAiGenerating() {
    if (!conversationModeActive) return;
    conversationMuted = true;
    if (state === 'recording') {
        log('🔇 多轮对话：AI 生成中，暂停录音');
        stopRecording();
    }
}

/**
 * 通知 ASR 模块：AI 生成完毕（外部调用）
 * 注意：不在此处恢复录音，因为后续通常会有 TTS 播放
 * TTS 播放结束后会通过 TTS_STATE_CHANGED 事件自动恢复
 */
export function notifyAiGenerationDone() {
    if (!conversationModeActive) return;
    const settings = extension_settings[extensionName];
    const aiConfig = settings?.chatu8_ai_assistant || {};
    if (!aiConfig.tts_enabled) {
        conversationMuted = false;
        clearWatchdog();
        log('🔊 多轮对话：AI 生成完毕（TTS 未启用），延迟恢复录音');
        conversationResumeTimer = setTimeout(() => {
            conversationResumeTimer = null;
            if (conversationModeActive && !conversationMuted && state === 'idle') {
                currentTargetInput = '#st-chatu8-ai-input';
                startRecording();
            }
        }, 500);
    } else {
        log('🔊 多轮对话：AI 生成完毕，等待 TTS 播放结束后恢复（已启动看门狗）');
        startWatchdog();
    }
}

/**
 * 启动周期性看门狗：每 3 秒检查 LLM/TTS 是否均已结束但 ASR 仍被禁音
 * 如果检测到两者都已空闲，则强制恢复录音，防止 ASR 永久卡死
 */
function startWatchdog() {
    clearWatchdog();
    conversationWatchdogInterval = setInterval(() => {
        if (!conversationModeActive) { clearWatchdog(); return; }
        if (!conversationMuted) { clearWatchdog(); return; }

        const aiStillGenerating = isAiGenerating;
        let ttsStillActive = false;
        try {
            const ttsInfo = getTTSState();
            ttsStillActive = ttsInfo?.state === 'active';
        } catch (e) {
            log('⚠️ 看门狗：获取 TTS 状态失败: ' + e.message);
        }

        log(`🔍 看门狗检查：isAiGenerating=${aiStillGenerating}, ttsActive=${ttsStillActive}, conversationMuted=${conversationMuted}`);

        if (!aiStillGenerating && !ttsStillActive) {
            log('⚠️ 看门狗：LLM 和 TTS 均已结束但 ASR 仍被禁音，强制恢复录音');
            conversationMuted = false;
            clearWatchdog();
            if (state === 'idle') {
                currentTargetInput = '#st-chatu8-ai-input';
                startRecording();
            }
        }
    }, 3000);
}

/**
 * 清理看门狗定时器
 */
function clearWatchdog() {
    if (conversationWatchdogInterval) {
        clearInterval(conversationWatchdogInterval);
        conversationWatchdogInterval = null;
    }
}

/**
 * 获取 ASR 当前状态
 * @returns {'idle'|'recording'|'processing'}
 */
export function getASRState() {
    return state;
}

// ═══════════════════════════════════════════════════════════
//  麦克风测试（实时音量 + VAD 阈值可视化）
// ═══════════════════════════════════════════════════════════
let micTestRunning = false;
let micTestStream = null;
let micTestAudioCtx = null;
let micTestAnalyser = null;
let micTestSource = null;
let micTestRafId = null;

/**
 * 启动麦克风测试，持续回调 RMS 音量值
 * @param {(rms: number, vadThreshold: number) => void} onTick - 每帧回调
 * @returns {Promise<boolean>} 是否成功启动
 */
export async function startMicTest(onTick) {
    if (micTestRunning) return true;
    try {
        micTestStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (e) {
        log('❌ 麦克风测试 - 权限被拒: ' + e.message);
        return false;
    }
    micTestAudioCtx = new (window.AudioContext || window.webkitAudioContext)();
    if (micTestAudioCtx.state === 'suspended') await micTestAudioCtx.resume();
    micTestSource = micTestAudioCtx.createMediaStreamSource(micTestStream);
    micTestAnalyser = micTestAudioCtx.createAnalyser();
    micTestAnalyser.fftSize = 2048;
    micTestSource.connect(micTestAnalyser);
    micTestRunning = true;

    const buf = new Float32Array(micTestAnalyser.fftSize);
    function tick() {
        if (!micTestRunning) return;
        micTestAnalyser.getFloatTimeDomainData(buf);
        let sum = 0;
        for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
        const rms = Math.sqrt(sum / buf.length);
        const config = getASRConfig();
        if (onTick) onTick(rms, config.vadThreshold);
        micTestRafId = requestAnimationFrame(tick);
    }
    micTestRafId = requestAnimationFrame(tick);
    log('🎤 麦克风测试已启动');
    return true;
}

/**
 * 停止麦克风测试
 */
export function stopMicTest() {
    micTestRunning = false;
    if (micTestRafId) { cancelAnimationFrame(micTestRafId); micTestRafId = null; }
    if (micTestSource) { try { micTestSource.disconnect(); } catch (e) { /* ignore */ } micTestSource = null; }
    micTestAnalyser = null;
    if (micTestStream) {
        micTestStream.getTracks().forEach(t => t.stop());
        micTestStream = null;
    }
    if (micTestAudioCtx) {
        try { micTestAudioCtx.close(); } catch (e) { /* ignore */ }
        micTestAudioCtx = null;
    }
    log('🎤 麦克风测试已停止');
}

/**
 * 销毁 ASR 模块
 */
export function destroyASR() {
    stopConversationMode();
    clearWatchdog(); // 额外保险：确保看门狗被清理
    stopMicTest();
    if (state === 'recording') stopRecording();
    removeMicButton();
    releaseMic();
    if (maxDurationTimer) { clearTimeout(maxDurationTimer); maxDurationTimer = null; }
    if (silenceTimer) { clearTimeout(silenceTimer); silenceTimer = null; }
    log('🛑 ASR 模块已销毁');
}
