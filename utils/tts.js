// ═══════════════════════════════════════════════════════════
//  TTS 语音合成模块 (utils/tts.js)
//  基于 tts示例 移植，改造为 eventSource 事件驱动模块
//  支持双引擎：Qwen（鹦鹉学舌）和 Edge（微软语音）
//  核心思路：文字输入 → 断句 → TTS引擎请求 → 流式音频播放
//  所有配置直接写在模块内，方便更新
// ═══════════════════════════════════════════════════════════

import { extension_settings } from '../../../../extensions.js';
import { eventSource, saveSettingsDebounced } from '../../../../../script.js';
import { eventNames, extensionName } from './config.js';
import { getGlobalVideoPlayer } from './ui_common.js';

// ── TTS 默认配置（直接写在模块内，方便更新） ──────────────
const TTS_CONFIG = {
    enabled: true,
    lbServerUrl: 'https://st-chatu-load-balancer.hf.space',
    chatServerUrls: '',        // 备用服务地址（换行分隔）
    voice: 'Cherry / 芊悦',    // 默认声音角色
    systemPrompt: '你是一只鹦鹉。你唯一的任务就是逐字逐句地重复用户所说的话。不要添加、删除或修改任何内容。不要解释、评论或以任何其他方式回应。只需原封不动地将用户的消息重复回去。',
    temperature: 0.1,
    topP: 0.5,
    minSegLen: 10,
    maxSegLen: 80,
    newlineOnly: false,
    inlineAudio: true,
    maxConcurrency: 20,
    maxRetries: 2,             // TTS 段落失败最大重试次数
    retryDelay: 1000,          // 重试间隔（毫秒）
    TOTP_SECRET: 'EFPCO3YIHIXUYTCD',
};

// ── 超时配置（统一 3 分钟） ──────────────────────────────
const TIMEOUT_MS = 180000; // 180 秒 = 3 分钟

// ── 可用声音角色列表 ─────────────────────────────────────
const AVAILABLE_VOICES = [
    // 基础角色
    'Cherry / 芊悦', 'Serena / 苏瑶', 'Ethan / 晨煦', 'Chelsie / 千雪',
    'Momo / 茉兔', 'Vivian / 十三', 'Moon / 月白', 'Maia / 四月',
    'Kai / 凯', 'Nofish / 不吃鱼', 'Bella / 萌宝', 'Jennifer / 詹妮弗',
    'Ryan / 甜茶', 'Katerina / 卡捷琳娜', 'Aiden / 艾登',
    // 多语种
    'Bodega / 西班牙语-博德加', 'Alek / 俄语-阿列克', 'Dolce / 意大利语-多尔切',
    'Sohee / 韩语-素熙', 'Ono Anna / 日语-小野杏', 'Lenn / 德语-莱恩',
    'Sonrisa / 西班牙语拉美-索尼莎', 'Emilien / 法语-埃米尔安',
    'Andre / 葡萄牙语欧-安德雷', 'Radio Gol / 葡萄牙语巴-拉迪奥·戈尔',
    // 精品百人 & 特色
    'Eldric Sage / 精品百人-沧明子', 'Mia / 精品百人-乖小妹', 'Mochi / 精品百人-沙小弥',
    'Bellona / 精品百人-燕铮莺', 'Vincent / 精品百人-田叔', 'Bunny / 精品百人-萌小姬',
    'Neil / 精品百人-阿闻', 'Elias / 墨讲师', 'Arthur / 精品百人-徐大爷',
    'Nini / 精品百人-邻家妹妹', 'Ebona / 精品百人-诡婆婆', 'Seren / 精品百人-小婉',
    'Pip / 精品百人-调皮小新', 'Stella / 精品百人-美少女阿月',
    // 方言
    'Li / 南京-老李', 'Marcus / 陕西-秦川', 'Roy / 闽南-阿杰',
    'Peter / 天津-李彼得', 'Eric / 四川-程川', 'Rocky / 粤语-阿强',
    'Kiki / 粤语-阿清', 'Sunny / 四川-晴儿', 'Jada / 上海-阿珍', 'Dylan / 北京-晓东',
];

// ── 当前引擎类型（运行时切换） ────────────────────────────
let currentEngine = 'qwen';  // 'qwen' | 'edge'

// ── Edge TTS 配置 ─────────────────────────────────────────
const EDGE_TTS_CONFIG = {
    proxyServers: [
        { name: '中国', url: 'http://t.leftsite.cn/tts' },
        { name: '中国北京', url: 'http://60.205.243.148:8080/tts' },
        { name: '新加坡', url: 'http://5.45.99.149:8075/tts' },
        { name: '甲骨文首尔', url: 'http://193.122.107.44:9090/tts' },
        { name: '美国旧金山', url: 'http://104.214.168.83:8080/tts' },
        { name: '美国纽约', url: 'http://74.48.40.244:8010/tts' },
        { name: '阿里云东南亚', url: 'http://47.79.92.215:18080/tts' },
    ],
    voice: 'zh-CN-XiaoxiaoNeural',
    style: 'general',
    rate: 0,
    pitch: 0,
    volume: 50,
    format: 'audio-24khz-96kbitrate-mono-mp3',
    pingTimeout: 5000,
};

// ── Edge TTS 风格名称中英文映射 ──────────────────────────
const EDGE_STYLE_MAP = {
    'general': '通用',
    'assistant': '助手',
    'chat': '闲聊',
    'customerservice': '客服',
    'newscast': '新闻播报',
    'affectionate': '亲切',
    'angry': '愤怒',
    'calm': '平静',
    'cheerful': '开朗',
    'disgruntled': '不满',
    'fearful': '恐惧',
    'gentle': '温柔',
    'lyrical': '抒情',
    'sad': '悲伤',
    'serious': '严肃',
    'poetry-reading': '诗歌朗诵',
    'livecommercial': '直播带货',
    'embarrassed': '尴尬',
    'depressed': '低落',
    'envious': '嫉妒',
    'narration-relaxed': '旁白-轻松',
    'sports-commentary': '体育解说',
    'sports-commentary-excited': '体育解说-激动',
    'narration-professional': '旁白-专业',
    'newscast-casual': '新闻-随意',
    'newscast-formal': '新闻-正式',
    'advertisement-upbeat': '广告-欢快',
    'documentary-narration': '纪录片旁白',
    'excited': '兴奋',
    'friendly': '友好',
    'terrified': '惊恐',
    'shouting': '喊叫',
    'unfriendly': '冷淡',
    'whispering': '耳语',
    'hopeful': '期待',
    'empathetic': '共情',
};

// ── Edge TTS 可用音色列表 ─────────────────────────────────
const EDGE_VOICES = [
    // 中文（普通话）- 女声
    { id: 'zh-CN-XiaoxiaoNeural', name: '晓晓', gender: 'Female', styles: ['general', 'assistant', 'chat', 'customerservice', 'newscast', 'affectionate', 'angry', 'calm', 'cheerful', 'disgruntled', 'fearful', 'gentle', 'lyrical', 'sad', 'serious', 'poetry-reading'] },
    { id: 'zh-CN-XiaoyiNeural', name: '晓伊', gender: 'Female', styles: ['general', 'angry', 'disgruntled', 'affectionate', 'cheerful', 'fearful', 'gentle', 'sad', 'serious'] },
    { id: 'zh-CN-XiaochenNeural', name: '晓辰', gender: 'Female', styles: ['general', 'livecommercial'] },
    { id: 'zh-CN-XiaohanNeural', name: '晓涵', gender: 'Female', styles: ['general', 'calm', 'fearful', 'cheerful', 'disgruntled', 'serious', 'angry', 'sad', 'gentle', 'affectionate', 'embarrassed'] },
    { id: 'zh-CN-XiaomengNeural', name: '晓梦', gender: 'Female', styles: ['general', 'chat'] },
    { id: 'zh-CN-XiaomoNeural', name: '晓墨', gender: 'Female', styles: ['general', 'embarrassed', 'calm', 'fearful', 'cheerful', 'disgruntled', 'serious', 'angry', 'sad', 'depressed', 'affectionate', 'gentle', 'envious'] },
    { id: 'zh-CN-XiaoqiuNeural', name: '晓秋', gender: 'Female', styles: ['general'] },
    { id: 'zh-CN-XiaoruiNeural', name: '晓睿', gender: 'Female', styles: ['general', 'calm', 'fearful', 'angry', 'sad'] },
    { id: 'zh-CN-XiaoshuangNeural', name: '晓双（儿童）', gender: 'Female', styles: ['general', 'chat'] },
    { id: 'zh-CN-XiaoxuanNeural', name: '晓萱', gender: 'Female', styles: ['general', 'calm', 'fearful', 'cheerful', 'disgruntled', 'serious', 'angry', 'gentle', 'depressed'] },
    { id: 'zh-CN-XiaoyanNeural', name: '晓颜', gender: 'Female', styles: ['general'] },
    { id: 'zh-CN-XiaozhenNeural', name: '晓甄', gender: 'Female', styles: ['general', 'angry', 'disgruntled', 'cheerful', 'fearful', 'sad', 'serious'] },
    // 中文（普通话）- 男声
    { id: 'zh-CN-YunxiNeural', name: '云希', gender: 'Male', styles: ['general', 'narration-relaxed', 'embarrassed', 'fearful', 'cheerful', 'disgruntled', 'serious', 'angry', 'sad', 'depressed', 'chat', 'assistant', 'newscast'] },
    { id: 'zh-CN-YunjianNeural', name: '云健', gender: 'Male', styles: ['general', 'narration-relaxed', 'sports-commentary', 'sports-commentary-excited'] },
    { id: 'zh-CN-YunyangNeural', name: '云扬', gender: 'Male', styles: ['general', 'customerservice', 'narration-professional', 'newscast-casual'] },
    { id: 'zh-CN-YunyeNeural', name: '云野', gender: 'Male', styles: ['general', 'embarrassed', 'calm', 'fearful', 'cheerful', 'disgruntled', 'serious', 'angry', 'sad'] },
    { id: 'zh-CN-YunzeNeural', name: '云泽', gender: 'Male', styles: ['general', 'calm', 'fearful', 'cheerful', 'disgruntled', 'serious', 'angry', 'sad', 'depressed', 'documentary-narration'] },
    { id: 'zh-CN-YunhaoNeural', name: '云皓', gender: 'Male', styles: ['general', 'advertisement-upbeat'] },
    { id: 'zh-CN-YunfengNeural', name: '云枫', gender: 'Male', styles: ['general', 'angry', 'disgruntled', 'cheerful', 'fearful', 'sad', 'serious'] },
    { id: 'zh-CN-YunxiaNeural', name: '云夏（儿童）', gender: 'Male', styles: ['general'] },
    // 中文（台湾）
    { id: 'zh-TW-HsiaoChenNeural', name: '曉臻（台湾女）', gender: 'Female', styles: ['general'] },
    { id: 'zh-TW-YunJheNeural', name: '雲哲（台湾男）', gender: 'Male', styles: ['general'] },
    { id: 'zh-TW-HsiaoYuNeural', name: '曉雨（台湾女）', gender: 'Female', styles: ['general'] },
    // 粤语
    { id: 'zh-HK-HiuGaaiNeural', name: '曉佳（粤语女）', gender: 'Female', styles: ['general'] },
    { id: 'zh-HK-WanLungNeural', name: '雲龍（粤语男）', gender: 'Male', styles: ['general'] },
    { id: 'zh-HK-HiuMaanNeural', name: '曉曼（粤语女）', gender: 'Female', styles: ['general'] },
    // 英语
    { id: 'en-US-JennyNeural', name: 'Jenny（英语女）', gender: 'Female', styles: ['general', 'assistant', 'chat', 'customerservice', 'newscast', 'angry', 'cheerful', 'sad', 'excited', 'friendly', 'terrified', 'shouting', 'unfriendly', 'whispering', 'hopeful'] },
    { id: 'en-US-GuyNeural', name: 'Guy（英语男）', gender: 'Male', styles: ['general', 'newscast', 'angry', 'cheerful', 'sad', 'excited', 'friendly', 'terrified', 'shouting', 'unfriendly', 'whispering', 'hopeful'] },
    { id: 'en-US-AriaNeural', name: 'Aria（英语女）', gender: 'Female', styles: ['general', 'chat', 'customerservice', 'narration-professional', 'newscast-casual', 'newscast-formal', 'cheerful', 'empathetic', 'angry', 'sad', 'excited', 'friendly', 'terrified', 'shouting', 'unfriendly', 'whispering', 'hopeful'] },
    // 日语
    { id: 'ja-JP-NanamiNeural', name: '七海（日语女）', gender: 'Female', styles: ['general', 'chat', 'customerservice', 'cheerful'] },
    { id: 'ja-JP-KeitaNeural', name: '圭太（日语男）', gender: 'Male', styles: ['general'] },
    // 韩语
    { id: 'ko-KR-SunHiNeural', name: 'SunHi（韩语女）', gender: 'Female', styles: ['general', 'cheerful'] },
    { id: 'ko-KR-InJoonNeural', name: 'InJoon（韩语男）', gender: 'Male', styles: ['general'] },
];

// ── Edge TTS 服务器管理 ───────────────────────────────────
let availableEdgeServers = [];  // ping 后的可用服务器列表
let edgeServerIndex = 0;        // 当前轮换索引
let edgePingInProgress = false;  // 是否正在 ping
let edgePingPromise = null;     // 当前 ping 的共享 Promise（解决并发竞态）
let lastEdgePingResult = null;   // 上次 ping 结果（供 UI 显示）
let lastEdgePingTime = 0;       // 上次 ping 成功的时间戳（仅供显示）

// ── 持久化辅助函数 ───────────────────────────────────────

/**
 * 将 Edge ping 结果保存到插件设置（持久化）
 */
function saveEdgePingToSettings() {
    if (!extension_settings[extensionName]) return;
    extension_settings[extensionName].edgePingCache = {
        servers: availableEdgeServers.map(s => ({ name: s.name, url: s.url, latency: s.latency })),
        pingResult: lastEdgePingResult,
        pingTime: lastEdgePingTime,
    };
    saveSettingsDebounced();
    log('💾 Edge ping 结果已保存到插件设置 (edgePingCache)');
}

/**
 * 从插件设置中加载之前保存的 Edge ping 结果
 * @returns {boolean} 是否成功加载了有效的缓存
 */
function loadEdgePingFromSettings() {
    if (!extension_settings[extensionName]) return false;
    const cache = extension_settings[extensionName].edgePingCache;
    if (!cache || !cache.servers || !cache.pingTime) return false;

    // 永久缓存：只要有保存的数据就直接恢复，不检查过期
    availableEdgeServers = cache.servers.map(s => ({ name: s.name, url: s.url, latency: s.latency }));
    edgeServerIndex = 0;
    lastEdgePingResult = cache.pingResult;
    lastEdgePingTime = cache.pingTime;

    const ageMinutes = Math.round((Date.now() - cache.pingTime) / 60000);
    log(`📂 已从插件设置加载 Edge ping 缓存: ${availableEdgeServers.length} 个可用服务器 (缓存于 ${ageMinutes} 分钟前)`);
    return true;
}

// ── TOTP 验证 ────────────────────────────────────────────

function b32Decode(s) {
    const A = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
    s = s.replace(/=+$/, '').toUpperCase();
    let bits = '';
    for (const c of s) { const v = A.indexOf(c); if (v >= 0) bits += v.toString(2).padStart(5, '0'); }
    const out = new Uint8Array(Math.floor(bits.length / 8));
    for (let i = 0; i < out.length; i++) out[i] = parseInt(bits.slice(i * 8, i * 8 + 8), 2);
    return out;
}

async function hmacSha1(key, data) {
    const ck = await crypto.subtle.importKey('raw', key, { name: 'HMAC', hash: 'SHA-1' }, false, ['sign']);
    const sig = await crypto.subtle.sign('HMAC', ck, data);
    return new Uint8Array(sig);
}

async function generateTOTP(secret) {
    const key = b32Decode(secret);
    const epoch = Math.floor(Date.now() / 1000);
    const counter = Math.floor(epoch / 30);
    const buf = new ArrayBuffer(8);
    const view = new DataView(buf);
    view.setUint32(4, counter, false);
    const hmac = await hmacSha1(key, new Uint8Array(buf));
    const offset = hmac[hmac.length - 1] & 0x0f;
    const code = (
        ((hmac[offset] & 0x7f) << 24) |
        ((hmac[offset + 1] & 0xff) << 16) |
        ((hmac[offset + 2] & 0xff) << 8) |
        (hmac[offset + 3] & 0xff)
    ) % 1000000;
    return code.toString().padStart(6, '0');
}

// ── 生成静音 WAV（鹦鹉学舌请求的占位音频）──────────────────

function createSilentWav() {
    const sampleRate = 16000;
    const numSamples = Math.floor(sampleRate * 0.1);
    const pcm = new Int16Array(numSamples);
    const wav = new ArrayBuffer(44 + pcm.byteLength);
    const v = new DataView(wav);
    const ws = (o, str) => { for (let i = 0; i < str.length; i++) v.setUint8(o + i, str.charCodeAt(i)); };
    ws(0, 'RIFF');
    v.setUint32(4, 36 + pcm.byteLength, true);
    ws(8, 'WAVE');
    ws(12, 'fmt ');
    v.setUint32(16, 16, true);
    v.setUint16(20, 1, true);
    v.setUint16(22, 1, true);
    v.setUint32(24, sampleRate, true);
    v.setUint32(28, sampleRate * 2, true);
    v.setUint16(32, 2, true);
    v.setUint16(34, 16, true);
    ws(36, 'data');
    v.setUint32(40, pcm.byteLength, true);
    new Uint8Array(wav, 44).set(new Uint8Array(pcm.buffer));
    return new Blob([wav], { type: 'audio/wav' });
}

const SILENT_WAV = createSilentWav();

// ── 全局状态 ─────────────────────────────────────────────

let state = 'idle';  // 'idle' | 'active'
let audioQueue = [];            // [{text, segIdx, status, url, blobUrl, sessionId}]
let isAudioPlaying = false;
let nextPlayIdx = 0;
let currentAudio = null;
let currentSessionId = '';
let currentRequestId = '';
let currentAutoPlay = true;

// TTS 并发控制
let activeTtsCount = 0;
let ttsWaitQueue = [];

// 负载均衡器缓存
let lbCache = { url: null, expires: 0 };
const LB_CACHE_TTL = 15000; // 缓存 15 秒

// ── 工具函数 ─────────────────────────────────────────────

function log(msg) {
    console.log('[TTS]', msg);
}

function tryParseJSON(str) {
    try { return JSON.parse(str); } catch { return null; }
}

function getChatServerList() {
    const raw = TTS_CONFIG.chatServerUrls;
    return raw.split(/[\n,]+/).map(s => s.trim().replace(/\/+$/, '')).filter(Boolean);
}

function getLbServerUrl() {
    return TTS_CONFIG.lbServerUrl.trim().replace(/\/+$/, '');
}

function resolveAudioUrl(url, base) {
    if (!url) return null;
    if (/^https?:\/\//i.test(url)) return url;
    if (base) return base.replace(/\/+$/, '') + (url.startsWith('/') ? '' : '/') + url;
    if (location.protocol.startsWith('http')) return location.origin + (url.startsWith('/') ? '' : '/') + url;
    log('⚠️ 音频地址为相对路径但未配置 Chat 服务地址');
    return url;
}

// ── 负载均衡器 ───────────────────────────────────────────

async function getChatServerFromLB() {
    const lbUrl = getLbServerUrl();
    if (!lbUrl) return null;

    // 检查缓存
    if (lbCache.url && Date.now() < lbCache.expires) {
        log(`⚡ 使用缓存的均衡节点: ${lbCache.url}`);
        return lbCache.url;
    }

    try {
        const totp = await generateTOTP(TTS_CONFIG.TOTP_SECRET);
        const res = await fetch(`${lbUrl}/api/pick-server`, {
            headers: { 'X-TOTP-Code': totp },
            signal: AbortSignal.timeout(TIMEOUT_MS),
        });
        const data = await res.json();

        if (data.success && data.server && data.server.url) {
            const serverUrl = data.server.url.replace(/\/+$/, '');
            lbCache = { url: serverUrl, expires: Date.now() + LB_CACHE_TTL };
            log(`⚖️ 均衡器分配: ${data.server.name || serverUrl} (延迟${data.server.latency}ms, 策略:${data.stats.strategy})`);
            return serverUrl;
        } else {
            log(`⚠️ 均衡器返回: ${data.error || '无可用节点'}`);
            return null;
        }
    } catch (e) {
        log(`⚠️ 均衡器请求失败: ${e.message}`);
        return null;
    }
}

async function getChatServer() {
    // 优先使用负载均衡器
    const lbResult = await getChatServerFromLB();
    if (lbResult) return lbResult;

    // 回退到手动配置的备用地址
    const list = getChatServerList();
    if (list.length > 0) {
        const fallback = list[Math.floor(Math.random() * list.length)];
        log(`🔄 回退到备用地址: ${fallback}`);
        return fallback;
    }

    return '';
}

// ═══════════════════════════════════════════════════════════
//  断句引擎
// ═══════════════════════════════════════════════════════════

/**
 * 将长文本切分为适合 TTS 朗读的段落
 * @param {string} text - 原始文本
 * @param {number} minLen - 最小段落字数（短段合并）
 * @param {number} maxLen - 最大段落字数（长段切分）
 * @param {boolean} newlineOnly - 仅按换行分段
 * @returns {string[]} 段落数组
 */
function splitTextToSegments(text, minLen, maxLen, newlineOnly = false) {
    if (!text || !text.trim()) return [];

    // 仅换行分段模式
    if (newlineOnly) {
        return text.split('\n').map(s => s.trim()).filter(s => s.length > 0);
    }

    // Step 1: 用一级分隔符切分
    // 用一级分隔符切分（保留分隔符在段尾）。
    // 不使用 lookbehind 以兼容 iOS Safari < 16.4（否则正则字面量解析失败会导致整个扩展加载失败）。
    const rawParts = text.replace(/([。！？；\n!?;])/g, '$1\u0000').split('\u0000').filter(s => s.length > 0);

    // Step 2: 合并过短段落
    const merged = [];
    let buffer = '';
    for (const part of rawParts) {
        buffer += part;
        if (buffer.trim().length >= minLen) {
            merged.push(buffer.trim());
            buffer = '';
        }
    }
    if (buffer.trim()) {
        if (merged.length > 0 && buffer.trim().length < minLen) {
            merged[merged.length - 1] += buffer;
        } else {
            merged.push(buffer.trim());
        }
    }

    // Step 3: 切分过长段落
    const result = [];
    for (const seg of merged) {
        if (seg.length <= maxLen) {
            result.push(seg);
        } else {
            const subParts = seg.replace(/([，、：…—,:\-])/g, '$1\u0000').split('\u0000').filter(s => s.length > 0);
            let sub = '';
            for (const sp of subParts) {
                if ((sub + sp).length > maxLen && sub.trim()) {
                    result.push(sub.trim());
                    sub = sp;
                } else {
                    sub += sp;
                }
            }
            if (sub.trim()) result.push(sub.trim());
        }
    }

    // Step 4: 最终过滤 + 强制切分
    const final = [];
    for (const seg of result) {
        if (!seg) continue;
        if (seg.length <= maxLen) {
            final.push(seg);
        } else {
            for (let i = 0; i < seg.length; i += maxLen) {
                const chunk = seg.slice(i, i + maxLen).trim();
                if (chunk) final.push(chunk);
            }
        }
    }

    return final;
}

// ═══════════════════════════════════════════════════════════
//  鹦鹉学舌 TTS 请求
// ═══════════════════════════════════════════════════════════

async function requestParrotTTS(text, segIdx, requestParams) {
    const chatBase = await getChatServer();
    if (!chatBase) throw new Error('无可用服务节点');

    const voice = requestParams.voice || TTS_CONFIG.voice;
    const systemPrompt = TTS_CONFIG.systemPrompt;
    const temperature = requestParams.temperature || TTS_CONFIG.temperature;
    const topP = requestParams.topP || TTS_CONFIG.topP;
    const useInline = TTS_CONFIG.inlineAudio;

    const fd = new FormData();
    const silentFile = new File([SILENT_WAV], 'silent.wav', { type: 'audio/wav' });
    fd.append('audio', silentFile);
    fd.append('history', JSON.stringify([{ role: 'user', content: text }]));
    fd.append('systemPrompt', systemPrompt);
    fd.append('voice', voice);
    fd.append('temperature', String(temperature));
    fd.append('topP', String(topP));
    fd.append('enableAudio', 'true');
    fd.append('enableThinking', 'false');
    if (useInline) fd.append('inlineAudio', 'true');

    const totp = await generateTOTP(TTS_CONFIG.TOTP_SECRET);

    log(`🦜 TTS #${segIdx + 1} 请求中... "${text.slice(0, 20)}${text.length > 20 ? '...' : ''}" → ${chatBase}`);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

    let resp;
    try {
        resp = await fetch(`${chatBase}/api/chat`, {
            method: 'POST',
            body: fd,
            headers: { 'X-TOTP-Code': totp },
            signal: controller.signal
        });
    } catch (e) {
        clearTimeout(timeout);
        if (e.name === 'AbortError') throw new Error('TTS 请求超时(180s)');
        throw e;
    }
    if (!resp.ok) {
        clearTimeout(timeout);
        throw new Error(`TTS 请求失败 ${resp.status}`);
    }

    // 读取 SSE 流，提取音频 URL 或内联 base64
    const reader = resp.body.getReader();
    const dec = new TextDecoder();
    let sseBuf = '';
    let audioUrl = null;
    let audioDataUri = null;
    let evType = null;

    while (true) {
        const { done, value } = await reader.read();
        if (!done) {
            sseBuf += dec.decode(value, { stream: true });
        } else {
            sseBuf += dec.decode();
        }

        const lines = sseBuf.split('\n');
        sseBuf = done ? '' : lines.pop();

        for (const line of lines) {
            if (line.startsWith('event:')) {
                evType = line.slice(6).trim();
                continue;
            }
            if (!line.startsWith('data:')) continue;
            const pl = line.slice(5).trim();
            if (!evType) continue;

            if (evType === 'audio') {
                const p = tryParseJSON(pl);
                if (p && p.data) {
                    audioDataUri = p.data;
                } else {
                    audioUrl = resolveAudioUrl(p ? p.url : pl, chatBase);
                }
            } else if (evType === 'done') {
                const p = tryParseJSON(pl);
                if (p && p.audioUrl && !audioUrl) {
                    audioUrl = resolveAudioUrl(p.audioUrl, chatBase);
                }
            }
            evType = null;
        }

        if (done) break;
    }

    clearTimeout(timeout);
    log(`🦜 TTS #${segIdx + 1} SSE完成, audioDataUri=${audioDataUri ? '有(' + audioDataUri.length + '字符)' : '无'}, audioUrl=${audioUrl ? '有' : '无'}`);

    if (audioDataUri) {
        return { inline: true, dataUri: audioDataUri };
    }
    return audioUrl ? { inline: false, url: audioUrl } : null;
}

// ═══════════════════════════════════════════════════════════
//  Edge TTS 引擎
// ═══════════════════════════════════════════════════════════

/**
 * Ping 所有 Edge TTS 代理服务器，返回可用服务器列表（按延迟排序）
 * @returns {Promise<Array<{name: string, url: string, latency: number}>>}
 */
async function pingEdgeServers(force = false) {
    // 如果有正在进行的 ping，等待它完成（而不是跳过）
    if (edgePingInProgress && edgePingPromise) {
        log('⏳ Edge 服务器检测已在进行中，等待结果...');
        return edgePingPromise;
    }

    // 如果不是强制刷新，且已有可用服务器，直接返回（永久缓存，不自动过期）
    if (!force && availableEdgeServers.length > 0) {
        log(`⚡ 使用缓存的 Edge 服务器列表 (${availableEdgeServers.length} 个可用)`);
        return availableEdgeServers;
    }

    edgePingInProgress = true;
    log('🔍 开始检测 Edge TTS 代理服务器...');

    // 创建共享 Promise，让并发调用者可以等待
    edgePingPromise = (async () => {
        try {
            const results = await Promise.allSettled(
                EDGE_TTS_CONFIG.proxyServers.map(async (server) => {
                    const start = Date.now();
                    const controller = new AbortController();
                    const timeout = setTimeout(() => controller.abort(), EDGE_TTS_CONFIG.pingTimeout);

                    try {
                        // 发送一个极短文本的 GET 测试请求
                        const testUrl = `${server.url}?t=test&v=zh-CN-XiaoxiaoNeural&r=0&p=0&vol=100`;
                        const resp = await fetch(testUrl, {
                            signal: controller.signal,
                            headers: { 'User-Agent': 'TTS-Client/1.0', 'Accept': 'audio/*' }
                        });
                        clearTimeout(timeout);

                        if (resp.ok) {
                            const latency = Date.now() - start;
                            log(`  ✅ ${server.name} (${latency}ms)`);
                            return { name: server.name, url: server.url, latency };
                        }
                        throw new Error(`HTTP ${resp.status}`);
                    } catch (e) {
                        clearTimeout(timeout);
                        const latency = Date.now() - start;
                        log(`  ❌ ${server.name} (${latency}ms) - ${e.name === 'AbortError' ? '超时' : e.message}`);
                        throw e;
                    }
                })
            );

            availableEdgeServers = results
                .filter(r => r.status === 'fulfilled')
                .map(r => r.value)
                .sort((a, b) => a.latency - b.latency);

            edgeServerIndex = 0;
            lastEdgePingTime = Date.now();

            // 保存结果供 UI 显示
            lastEdgePingResult = {
                timestamp: Date.now(),
                available: availableEdgeServers.map(s => ({ name: s.name, latency: s.latency })),
                failed: results
                    .map((r, i) => r.status === 'rejected' ? EDGE_TTS_CONFIG.proxyServers[i].name : null)
                    .filter(Boolean),
            };

            log(`🔍 Edge 服务器检测完成: ${availableEdgeServers.length}/${EDGE_TTS_CONFIG.proxyServers.length} 可用`);

            // 持久化保存 ping 结果到插件设置
            saveEdgePingToSettings();

            return availableEdgeServers;
        } finally {
            edgePingInProgress = false;
            edgePingPromise = null;
        }
    })();

    return edgePingPromise;
}

/**
 * 获取下一个可用的 Edge 服务器（轮换）
 */
function getNextEdgeServer() {
    if (availableEdgeServers.length === 0) return null;
    const server = availableEdgeServers[edgeServerIndex % availableEdgeServers.length];
    edgeServerIndex++;
    return server;
}

/**
 * 标记某个 Edge 服务器为失败，从可用列表中移除
 */
function markEdgeServerFailed(server) {
    const idx = availableEdgeServers.findIndex(s => s.url === server.url);
    if (idx >= 0) {
        availableEdgeServers.splice(idx, 1);
        log(`🚫 已移除失败的 Edge 服务器: ${server.name}, 剩余 ${availableEdgeServers.length} 个`);
        // 持久化保存更新后的服务器列表，避免下次启动时又加载已失败的服务器
        saveEdgePingToSettings();
    }
}

/**
 * 通过代理服务器请求 Edge TTS 音频（带自动重试：当一个服务器失败时自动尝试下一个）
 * @param {string} text - 要合成的文本
 * @param {number} segIdx - 段落索引
 * @param {Object} requestParams - 请求参数覆盖
 * @returns {Promise<{inline: boolean, url?: string, isBlob?: boolean} | null>}
 */
async function requestEdgeTTS(text, segIdx, requestParams) {
    // 仅在完全没有可用服务器时才自动 ping（永久缓存，不自动过期）
    if (availableEdgeServers.length === 0) {
        await pingEdgeServers();
    }

    if (availableEdgeServers.length === 0) {
        throw new Error('无可用 Edge TTS 代理服务器');
    }

    const voice = requestParams.edgeVoice || EDGE_TTS_CONFIG.voice;
    const style = requestParams.edgeStyle || EDGE_TTS_CONFIG.style;
    const rate = requestParams.edgeRate !== undefined ? requestParams.edgeRate : EDGE_TTS_CONFIG.rate;
    const pitch = requestParams.edgePitch !== undefined ? requestParams.edgePitch : EDGE_TTS_CONFIG.pitch;
    const volume = (requestParams.edgeVolume !== undefined ? requestParams.edgeVolume : EDGE_TTS_CONFIG.volume) + 50;

    const encodedText = encodeURIComponent(text);

    // 记录已尝试的服务器，避免重复尝试同一个
    const triedServers = new Set();
    let lastError = null;

    // 循环尝试所有可用服务器，直到成功或全部失败
    while (true) {
        const server = getNextEdgeServer();
        if (!server || triedServers.has(server.url)) {
            // 所有可用服务器都已尝试过，或无可用服务器
            break;
        }
        triedServers.add(server.url);

        const url = `${server.url}?t=${encodedText}&v=${voice}&r=${rate}&p=${pitch}&s=${style}&vol=${volume}`;

        log(`🔊 Edge TTS #${segIdx + 1} 请求中... "${text.slice(0, 20)}${text.length > 20 ? '...' : ''}" → ${server.name}`);

        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

        try {
            const resp = await fetch(url, {
                signal: controller.signal,
                headers: { 'User-Agent': 'TTS-Client/1.0', 'Accept': 'audio/*' }
            });
            clearTimeout(timeout);

            if (!resp.ok) {
                throw new Error(`Edge TTS 请求失败 HTTP-${resp.status}`);
            }

            const contentType = resp.headers.get('Content-Type') || '';
            if (contentType && !contentType.includes('audio')) {
                const errorText = await resp.text();
                throw new Error(`Edge TTS 返回非音频: ${errorText.slice(0, 100)}`);
            }

            const blob = await resp.blob();
            const blobUrl = URL.createObjectURL(blob);
            log(`🔊 Edge TTS #${segIdx + 1} 完成, blobUrl 已创建 (服务器: ${server.name})`);
            return { inline: false, url: blobUrl, isBlob: true };
        } catch (e) {
            clearTimeout(timeout);
            // 标记该服务器失败并从可用列表移除
            markEdgeServerFailed(server);
            lastError = e.name === 'AbortError' ? new Error(`Edge TTS 请求超时(${TIMEOUT_MS / 1000}s) - ${server.name}`) : e;
            log(`⚠️ Edge TTS #${segIdx + 1} 服务器 ${server.name} 失败: ${lastError.message}, 尝试下一个服务器...`);

            // 如果还有剩余可用服务器，继续重试
            if (availableEdgeServers.length > 0) {
                continue;
            }
            break;
        }
    }

    // 所有服务器都失败了，尝试重新 ping 一次
    if (availableEdgeServers.length === 0 && triedServers.size > 0) {
        log(`🔄 所有 Edge 服务器均失败，尝试重新检测...`);
        await pingEdgeServers(true);

        // 重新 ping 后如果有可用服务器，再尝试一轮（只尝试新发现的服务器）
        if (availableEdgeServers.length > 0) {
            const retryServer = getNextEdgeServer();
            if (retryServer && !triedServers.has(retryServer.url)) {
                const url = `${retryServer.url}?t=${encodedText}&v=${voice}&r=${rate}&p=${pitch}&s=${style}&vol=${volume}`;
                log(`🔊 Edge TTS #${segIdx + 1} 重新检测后重试 → ${retryServer.name}`);

                const controller = new AbortController();
                const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

                try {
                    const resp = await fetch(url, {
                        signal: controller.signal,
                        headers: { 'User-Agent': 'TTS-Client/1.0', 'Accept': 'audio/*' }
                    });
                    clearTimeout(timeout);

                    if (resp.ok) {
                        const contentType = resp.headers.get('Content-Type') || '';
                        if (!contentType || contentType.includes('audio')) {
                            const blob = await resp.blob();
                            const blobUrl = URL.createObjectURL(blob);
                            log(`🔊 Edge TTS #${segIdx + 1} 重试成功! (服务器: ${retryServer.name})`);
                            return { inline: false, url: blobUrl, isBlob: true };
                        }
                    }
                    markEdgeServerFailed(retryServer);
                } catch (retryErr) {
                    clearTimeout(timeout);
                    markEdgeServerFailed(retryServer);
                }
            }
        }
    }

    // 最终失败
    throw lastError || new Error('无可用 Edge TTS 代理服务器');
}

// ── 获取音频 Blob URL ────────────────────────────────────

async function fetchAudioBlob(url) {
    const resp = await fetch(url, {
        credentials: 'include',
        signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!resp.ok) throw new Error(`音频请求失败 ${resp.status}`);
    const blob = await resp.blob();
    return URL.createObjectURL(blob);
}

// ═══════════════════════════════════════════════════════════
//  核心：处理 TTS 请求
// ═══════════════════════════════════════════════════════════

async function handleTTSRequest(requestData) {
    const { id, text, segments: preSegments, voice, autoPlay = true, temperature, topP, minSegLen, maxSegLen, newlineOnly, edgeVoice, edgeStyle, edgeRate, edgePitch, edgeVolume } = requestData;

    if (!text || !text.trim()) {
        emitResponse(id, { success: false, segIndex: 0, totalSegments: 0, status: 'error', error: '文本为空' });
        return;
    }

    // 如果正在播放，先停止
    if (state === 'active') {
        stopAll();
    }

    let segments;
    let segmentStyles = null;  // 每段的风格覆盖（仅预分段模式）

    if (preSegments && Array.isArray(preSegments) && preSegments.length > 0) {
        // 预分段模式：使用调用方提供的分段（含风格信息）
        segments = preSegments.map(s => s.text);
        segmentStyles = preSegments.map(s => {
            // 风格验证：确保 AI 返回的 style 在当前声音支持列表中
            if (!s.style) return null;
            const voiceId = edgeVoice || EDGE_TTS_CONFIG.voice;
            return validateEdgeStyle(s.style, voiceId);
        });
        log(`📝 使用预分段: ${segments.length} 段 (含逐句风格标记)`);
        for (let i = 0; i < segments.length; i++) {
            const styleTag = segmentStyles[i] ? ` [style=${segmentStyles[i]}]` : '';
            log(`   段${i + 1}: "${segments[i].slice(0, 40)}${segments[i].length > 40 ? '...' : ''}" (${segments[i].length}字)${styleTag}`);
        }
    } else {
        // 传统模式：内部断句
        const segMinLen = minSegLen || TTS_CONFIG.minSegLen;
        const segMaxLen = maxSegLen || TTS_CONFIG.maxSegLen;
        const segNewlineOnly = newlineOnly !== undefined ? newlineOnly : TTS_CONFIG.newlineOnly;
        segments = splitTextToSegments(text.trim(), segMinLen, segMaxLen, segNewlineOnly);

        if (segments.length === 0) {
            emitResponse(id, { success: false, segIndex: 0, totalSegments: 0, status: 'error', error: '断句后无有效段落' });
            return;
        }

        log(`📝 断句完成: ${segments.length} 段 (min=${segMinLen}, max=${segMaxLen})`);
        for (let i = 0; i < segments.length; i++) {
            log(`   段${i + 1}: "${segments[i].slice(0, 40)}${segments[i].length > 40 ? '...' : ''}" (${segments[i].length}字)`);
        }
    }

    // 重置队列 & 进入 active 状态
    resetAudioQueue();
    currentSessionId = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    currentRequestId = id;
    currentAutoPlay = autoPlay;
    setState('active');

    // 基础请求参数（用于覆盖默认值）
    const requestParams = { voice, temperature, topP, edgeVoice, edgeStyle, edgeRate, edgePitch, edgeVolume };

    // 为每段创建队列项 + 发起 TTS
    const sid = currentSessionId;
    for (let i = 0; i < segments.length; i++) {
        const seg = segments[i];
        const queueItem = { text: seg, segIdx: i, status: 'pending', url: null, blobUrl: null, sessionId: sid };
        audioQueue.push(queueItem);

        // 通知调用方：段落已创建，状态 pending
        emitResponse(id, { success: true, segIndex: i, totalSegments: segments.length, status: 'pending' });

        // 如果有逐句风格，为该段创建独立的 requestParams
        let segRequestParams = requestParams;
        if (segmentStyles && segmentStyles[i]) {
            segRequestParams = { ...requestParams, edgeStyle: segmentStyles[i] };
        }

        // 提交到并发控制器
        enqueueTTSTask(seg, i, queueItem, sid, segRequestParams);
    }
}

/**
 * 验证 Edge TTS 风格 ID 是否在指定声音的支持列表中
 * @param {string} styleId - AI 标注的风格 ID
 * @param {string} voiceId - 当前 Edge 声音 ID
 * @returns {string|null} 有效的风格 ID，无效时返回 null（降级为全局默认风格）
 */
function validateEdgeStyle(styleId, voiceId) {
    if (!styleId) return null;
    const voice = EDGE_VOICES.find(v => v.id === voiceId);
    if (!voice) return null;
    return voice.styles.includes(styleId) ? styleId : null;
}

// ═══════════════════════════════════════════════════════════
//  TTS 并发控制
// ═══════════════════════════════════════════════════════════

function enqueueTTSTask(text, segIdx, queueItem, sessionId, requestParams) {
    const maxRetries = TTS_CONFIG.maxRetries || 2;
    const retryDelay = TTS_CONFIG.retryDelay || 1000;

    const task = async () => {
        let attempt = 0;
        let lastError = null;

        while (attempt <= maxRetries) {
            try {
                if (state !== 'active' || currentSessionId !== sessionId) return;

                if (attempt > 0) {
                    log(`🔄 段落 #${segIdx + 1} 第 ${attempt} 次重试...`);
                    queueItem.status = 'pending'; // 重置状态以便重试
                }

                // 根据当前引擎分发请求
                const result = currentEngine === 'edge'
                    ? await requestEdgeTTS(text, segIdx, requestParams)
                    : await requestParrotTTS(text, segIdx, requestParams);

                if (state !== 'active' || currentSessionId !== sessionId) return;

                if (!result) {
                    lastError = `段落 #${segIdx + 1} TTS 无音频`;
                    attempt++;
                    if (attempt <= maxRetries) {
                        log(`⚠️ ${lastError}，${retryDelay}ms 后重试 (${attempt}/${maxRetries})`);
                        await new Promise(r => setTimeout(r, retryDelay));
                        continue;
                    }
                    // 超过最大重试次数
                    queueItem.status = 'error';
                    emitResponse(currentRequestId, { success: false, segIndex: segIdx, totalSegments: audioQueue.length, status: 'error', error: lastError });
                    log(`⚠️ ${lastError}（已重试 ${maxRetries} 次）`);
                    skipIfCurrent(segIdx);
                    return;
                }

                let blobUrl;
                if (result.isBlob) {
                    // Edge TTS 已返回 blobUrl，无需二次 fetch
                    blobUrl = result.url;
                    log(`📥 段落 #${segIdx + 1} Edge 音频就绪`);
                } else if (result.inline) {
                    log(`📥 段落 #${segIdx + 1} 内联音频转换中...`);
                    const resp = await fetch(result.dataUri);
                    const blob = await resp.blob();
                    blobUrl = URL.createObjectURL(blob);
                } else {
                    log(`📥 段落 #${segIdx + 1} 预缓存音频...`);
                    blobUrl = await fetchAudioBlob(result.url);
                }

                if (state !== 'active' || currentSessionId !== sessionId) {
                    URL.revokeObjectURL(blobUrl);
                    return;
                }

                queueItem.url = result.inline ? '(inline)' : result.url;
                queueItem.blobUrl = blobUrl;
                queueItem.status = 'ready';
                emitResponse(currentRequestId, { success: true, segIndex: segIdx, totalSegments: audioQueue.length, status: 'ready', blobUrl: blobUrl });
                log(`✅ 段落 #${segIdx + 1} 已缓存就绪${attempt > 0 ? `（第 ${attempt} 次重试成功）` : ''}`);

                // 尝试播放
                if (currentAutoPlay) tryPlayNext();
                return; // 成功，退出重试循环

            } catch (e) {
                if (state !== 'active' || currentSessionId !== sessionId) return;
                lastError = e.message;
                attempt++;
                if (attempt <= maxRetries) {
                    log(`⚠️ 段落 #${segIdx + 1} TTS 失败: ${e.message}，${retryDelay}ms 后重试 (${attempt}/${maxRetries})`);
                    await new Promise(r => setTimeout(r, retryDelay));
                    continue;
                }
                // 超过最大重试次数，标记为错误
                queueItem.status = 'error';
                emitResponse(currentRequestId, { success: false, segIndex: segIdx, totalSegments: audioQueue.length, status: 'error', error: `段落 #${segIdx + 1} TTS 失败: ${e.message}（已重试 ${maxRetries} 次）` });
                log(`⚠️ 段落 #${segIdx + 1} TTS 失败: ${e.message}（已重试 ${maxRetries} 次）`);
                skipIfCurrent(segIdx);
            }
        }
        // while 循环正常结束（不应到达此处，但作为安全保障）
        if (queueItem.status === 'pending') {
            queueItem.status = 'error';
            skipIfCurrent(segIdx);
        }
    };

    // 包装 task 以确保 finally 块始终执行（activeTtsCount 在此层管理）
    const wrappedTask = async () => {
        activeTtsCount++;
        try {
            await task();
        } finally {
            activeTtsCount--;
            drainTTSWaitQueue();
            checkAllDone();
        }
    };

    if (activeTtsCount < TTS_CONFIG.maxConcurrency) {
        wrappedTask();
    } else {
        ttsWaitQueue.push(wrappedTask);
    }
}

function drainTTSWaitQueue() {
    while (ttsWaitQueue.length > 0 && activeTtsCount < TTS_CONFIG.maxConcurrency) {
        const next = ttsWaitQueue.shift();
        next();
    }
}

function skipIfCurrent(segIdx) {
    if (nextPlayIdx === segIdx) {
        nextPlayIdx++;
        if (currentAutoPlay) tryPlayNext();
    }
}

// ═══════════════════════════════════════════════════════════
//  音频播放队列
// ═══════════════════════════════════════════════════════════

function resetAudioQueue() {
    stopPlayback();
    audioQueue = [];
    isAudioPlaying = false;
    nextPlayIdx = 0;
    activeTtsCount = 0;
    ttsWaitQueue = [];
    currentAudio = null;
}

function tryPlayNext() {
    if (isAudioPlaying) return;
    if (state !== 'active') return;

    const item = audioQueue.find(q => q.segIdx === nextPlayIdx);
    if (!item) {
        checkAllDone();
        return;
    }

    if (item.status === 'ready') {
        playSegment(item);
    } else if (item.status === 'error') {
        nextPlayIdx++;
        tryPlayNext();
    }
    // pending: 等 TTS 完成后会再调 tryPlayNext
}

async function playSegment(item) {
    isAudioPlaying = true;
    item.status = 'playing';
    emitResponse(currentRequestId, { success: true, segIndex: item.segIdx, totalSegments: audioQueue.length, status: 'playing' });

    // ✅ 新增：播放 TTS 时切换到说话视频
    const videoPlayer = getGlobalVideoPlayer();
    if (videoPlayer && videoPlayer.playTalkVideo) {
        videoPlayer.playTalkVideo();
    }

    try {
        const audio = new Audio(item.blobUrl);
        currentAudio = audio;

        audio.onended = () => {
            item.status = 'done';
            // 先保存 requestId，因为 checkAllDone → setState('idle') 会清空 currentRequestId
            const reqId = currentRequestId;
            emitResponse(reqId, { success: true, segIndex: item.segIdx, totalSegments: audioQueue.length, status: 'done' });
            isAudioPlaying = false;
            currentAudio = null;
            nextPlayIdx++;
            checkAllDone();
            if (state === 'active') tryPlayNext();
        };

        audio.onerror = () => {
            log(`⚠️ 段落 #${item.segIdx + 1} 播放出错`);
            item.status = 'error';
            // 先保存 requestId，因为 checkAllDone → setState('idle') 会清空 currentRequestId
            const reqId = currentRequestId;
            emitResponse(reqId, { success: false, segIndex: item.segIdx, totalSegments: audioQueue.length, status: 'error', error: '播放出错' });
            isAudioPlaying = false;
            currentAudio = null;
            nextPlayIdx++;
            checkAllDone();
            if (state === 'active') tryPlayNext();
        };

        await audio.play();
        log(`▶️ 播放段落 #${item.segIdx + 1}: "${item.text.slice(0, 20)}..."`);
    } catch (e) {
        log(`⚠️ 段落 #${item.segIdx + 1} 播放失败: ${e.message}`);
        item.status = 'error';
        const reqId = currentRequestId;
        emitResponse(reqId, { success: false, segIndex: item.segIdx, totalSegments: audioQueue.length, status: 'error', error: `播放失败: ${e.message}` });
        isAudioPlaying = false;
        currentAudio = null;
        nextPlayIdx++;
        checkAllDone();
        if (state === 'active') tryPlayNext();
    }
}

function checkAllDone() {
    if (audioQueue.length === 0) return;
    const allDone = audioQueue.every(q => q.status === 'done' || q.status === 'error');
    if (allDone) {
        const successCount = audioQueue.filter(q => q.status === 'done').length;
        log(`🔇 全部播放完毕 (${successCount}/${audioQueue.length} 成功)`);

        // ✅ 新增：停止说话视频，切回静息视频
        const videoPlayer = getGlobalVideoPlayer();
        if (videoPlayer && videoPlayer.stopTalkVideo) {
            videoPlayer.stopTalkVideo();
        }

        // 注意：不再释放 Blob URL，由调用方通过 TTS_RESPONSE 事件获取并管理缓存
        // 调用方可以在不需要时自行调用 URL.revokeObjectURL
        setState('idle');
    }
}

function stopPlayback() {
    if (currentAudio) {
        try {
            currentAudio.pause();
            currentAudio.currentTime = 0;
        } catch { }
        currentAudio = null;
    }
    isAudioPlaying = false;
}

function stopAll() {
    stopPlayback();

    // ✅ 新增：停止说话视频
    const videoPlayer = getGlobalVideoPlayer();
    if (videoPlayer && videoPlayer.stopTalkVideo) {
        videoPlayer.stopTalkVideo();
    }

    // 注意：不再释放 Blob URL，由调用方管理缓存生命周期
    // 调用方可在不需要时自行调用 URL.revokeObjectURL
    ttsWaitQueue = [];
    audioQueue = [];
    nextPlayIdx = 0;
    activeTtsCount = 0;
    setState('idle');
    log('⏹️ 已停止所有 TTS');
}

// ═══════════════════════════════════════════════════════════
//  状态管理 & 事件发射
// ═══════════════════════════════════════════════════════════

function setState(s) {
    state = s;
    eventSource.emit(eventNames.TTS_STATE_CHANGED, {
        state: s,
        requestId: currentRequestId || undefined,
    });
    if (s === 'idle') {
        currentRequestId = '';
        currentSessionId = '';
    }
}

function emitResponse(id, data) {
    eventSource.emit(eventNames.TTS_RESPONSE, {
        id: id,
        ...data,
    });
}

// ═══════════════════════════════════════════════════════════
//  事件监听器处理
// ═══════════════════════════════════════════════════════════

function onTTSRequest(requestData) {
    handleTTSRequest(requestData).catch(e => {
        log(`❌ TTS 请求处理异常: ${e.message}`);
        emitResponse(requestData.id, { success: false, segIndex: 0, totalSegments: 0, status: 'error', error: e.message });
        // 确保异常时恢复到 idle 状态，避免卡在 active 导致 ASR 永远不恢复
        if (state === 'active') {
            log('⚠️ TTS 异常后强制恢复 idle 状态');
            setState('idle');
        }
    });
}

function onTTSStop(data) {
    if (data && data.id) {
        // 停止指定请求
        if (currentRequestId === data.id) {
            stopAll();
        }
    } else {
        // 停止所有
        stopAll();
    }
}

// ═══════════════════════════════════════════════════════════
//  模块导出：初始化 & 销毁
// ═══════════════════════════════════════════════════════════

/**
 * 初始化 TTS 模块
 * - 注册 eventSource 事件监听器
 */
export function initializeTTS() {
    eventSource.on(eventNames.TTS_REQUEST, onTTSRequest);
    eventSource.on(eventNames.TTS_STOP, onTTSStop);

    // 从插件设置加载之前保存的 Edge ping 结果
    const loaded = loadEdgePingFromSettings();
    if (loaded) {
        log('📂 已恢复上次 Edge ping 结果，无需重新检测');
    }

    log('✅ TTS 语音合成模块已初始化');
    log(`   当前引擎: ${currentEngine}`);
    log(`   Qwen 默认声音: ${TTS_CONFIG.voice}`);
    log(`   Edge 默认声音: ${EDGE_TTS_CONFIG.voice}`);
    log(`   负载均衡器: ${TTS_CONFIG.lbServerUrl}`);
    log(`   最大并发: ${TTS_CONFIG.maxConcurrency}`);
    log(`   超时: ${TIMEOUT_MS / 1000}秒`);
}

/**
 * 销毁 TTS 模块（清理监听器）
 */
export function destroyTTS() {
    stopAll();
    eventSource.removeListener(eventNames.TTS_REQUEST, onTTSRequest);
    eventSource.removeListener(eventNames.TTS_STOP, onTTSStop);
    log('🔇 TTS 语音合成模块已销毁');
}

/**
 * 获取可用声音角色列表（根据当前引擎返回对应列表）
 * @returns {Array}
 */
export function getAvailableVoices() {
    if (currentEngine === 'edge') {
        return EDGE_VOICES.map(v => ({
            id: v.id,
            name: v.name,
            gender: v.gender,
            styles: v.styles.map(s => ({ id: s, name: EDGE_STYLE_MAP[s] || s }))
        }));
    }
    return [...AVAILABLE_VOICES];
}

/**
 * 获取 Qwen TTS 声音列表（用于设置面板下拉框）
 * @returns {Array<string>} 声音角色名称数组
 */
export function getQwenVoices() {
    return [...AVAILABLE_VOICES];
}

/**
 * 获取当前 TTS 状态
 * @returns {{ state: string, requestId: string }}
 */
export function getTTSState() {
    return { state, requestId: currentRequestId };
}

// ═══════════════════════════════════════════════════════════
//  Edge TTS 扩展导出
// ═══════════════════════════════════════════════════════════

/**
 * 设置 TTS 引擎类型
 * @param {'qwen'|'edge'} engineType
 */
export function setTTSEngineType(engineType) {
    if (engineType !== 'qwen' && engineType !== 'edge') {
        log(`⚠️ 无效引擎类型: ${engineType}，保持当前引擎: ${currentEngine}`);
        return;
    }
    if (currentEngine === engineType) return;
    // 切换引擎前停止当前播放
    stopAll();
    currentEngine = engineType;
    log(`🔄 TTS 引擎已切换为: ${currentEngine}`);
}

/**
 * 获取当前 TTS 引擎类型
 * @returns {'qwen'|'edge'}
 */
export function getTTSEngineType() {
    return currentEngine;
}

/**
 * 获取 Edge TTS 声音列表
 * @returns {Array<{id: string, name: string, gender: string, styles: Array<{id: string, name: string}>}>}
 */
export function getEdgeVoices() {
    return EDGE_VOICES.map(v => ({
        id: v.id,
        name: v.name,
        gender: v.gender,
        styles: v.styles.map(s => ({ id: s, name: EDGE_STYLE_MAP[s] || s }))
    }));
}

/**
 * 获取指定 Edge 声音的可用风格列表
 * @param {string} voiceId - 声音 ID
 * @returns {Array<{id: string, name: string}>} 风格列表，不存在则返回空数组
 */
export function getEdgeVoiceStyles(voiceId) {
    const voice = EDGE_VOICES.find(v => v.id === voiceId);
    return voice ? voice.styles.map(s => ({ id: s, name: EDGE_STYLE_MAP[s] || s })) : [];
}

/**
 * 触发 Edge TTS 服务器 Ping 并刷新可用列表
 * @returns {Promise<{servers: Array, total: number, available: number, timestamp: number}>}
 */
export async function pingAndRefreshServers() {
    const result = await pingEdgeServers(true);
    return {
        servers: result.map(s => ({ name: s.name, url: s.url, latency: s.latency })),
        total: EDGE_TTS_CONFIG.proxyServers.length,
        available: availableEdgeServers.length,
        timestamp: Date.now()
    };
}

/**
 * 获取上一次 Ping 结果（无需重新 Ping）
 * @returns {{ servers: Array, total: number, available: number, timestamp: number } | null}
 */
export function getEdgePingResult() {
    if (!lastEdgePingResult) return null;
    return {
        servers: lastEdgePingResult.available.map(s => ({ name: s.name, latency: s.latency })),
        total: EDGE_TTS_CONFIG.proxyServers.length,
        available: availableEdgeServers.length,
        timestamp: lastEdgePingResult.timestamp
    };
}

/**
 * 获取 Edge TTS 默认配置
 * @returns {{ voice: string, style: string, rate: number, pitch: number, volume: number }}
 */
export function getEdgeDefaultConfig() {
    return {
        voice: EDGE_TTS_CONFIG.voice,
        style: EDGE_TTS_CONFIG.style,
        rate: EDGE_TTS_CONFIG.rate,
        pitch: EDGE_TTS_CONFIG.pitch,
        volume: EDGE_TTS_CONFIG.volume
    };
}
