// @ts-nocheck
import { extension_settings } from "../../../../extensions.js";
import { extensionName } from './config.js';
import { setItemImg, getItemImg } from './database.js';
import { eventSource } from "../../../../../script.js";
import { EventType } from './config.js';
import { getLogIndex, getLogSessionData, saveLogIndex, saveLogSessionData, deleteLogSessionData } from './configDatabase.js';
/**
 * A collection of utility functions.
 */

// Constants for skip_cfg_above_sigma (Variety+) calculation
const REFERENCE_PIXEL_COUNT = 1011712;   // 832 * 1216 reference image size
const SIGMA_MAGIC_NUMBER = 19;           // Base sigma multiplier for V3 and V4 models
const SIGMA_MAGIC_NUMBER_V4_5 = 58;      // Base sigma multiplier for V4.5 models
const LOG_RETENTION_MS = 24 * 60 * 60 * 1000;
const MAX_PERSISTED_LOG_SESSIONS = 30;
let logPersistenceStatePromise = null;
let logWriteQueue = Promise.resolve();
/** 初始化是否已完成（异步初始化前 addLog 不得创建新会话） */
let _logInitialized = false;
/** 初始化完成前积累的日志条目缓冲区 */
let _pendingLogBuffer = [];
/** 防抖持久化 timer（减少上传次数） */
let _persistDebounceTimer = null;
/** 防抖延迟：5秒内的多次 addLog 合并为一次持久化 */
const LOG_PERSIST_DEBOUNCE_MS = 5000;

function generateLogSessionId() {
    if (crypto && crypto.randomUUID) {
        return `log_${crypto.randomUUID()}`;
    }
    return `log_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

function getNow() {
    return Date.now();
}

function getDefaultLogIndex() {
    return {
        version: 1,
        activeSessionId: '',
        sessions: []
    };
}

function ensureLogStateContainer() {
    if (!extension_settings[extensionName].logState || typeof extension_settings[extensionName].logState !== 'object') {
        extension_settings[extensionName].logState = getDefaultLogIndex();
    }
    if (!Array.isArray(extension_settings[extensionName].logState.sessions)) {
        extension_settings[extensionName].logState.sessions = [];
    }
    return extension_settings[extensionName].logState;
}

function cleanupExpiredSessionMeta(indexData, now = getNow()) {
    const cutoff = now - LOG_RETENTION_MS;
    indexData.sessions = (indexData.sessions || []).filter(session => (session.updatedAt || session.createdAt || 0) >= cutoff);
    if (indexData.sessions.length > MAX_PERSISTED_LOG_SESSIONS) {
        indexData.sessions = indexData.sessions
            .sort((a, b) => (b.updatedAt || b.createdAt || 0) - (a.updatedAt || a.createdAt || 0))
            .slice(0, MAX_PERSISTED_LOG_SESSIONS);
    }
    return indexData;
}

function getSessionMeta(sessionId) {
    const state = ensureLogStateContainer();
    return (state.sessions || []).find(session => session.id === sessionId) || null;
}

function updateSessionMeta(sessionId, updater) {
    const state = ensureLogStateContainer();
    const sessions = state.sessions || [];
    let session = sessions.find(item => item.id === sessionId);
    if (!session) {
        session = { id: sessionId, createdAt: getNow(), updatedAt: getNow(), entryCount: 0 };
        sessions.push(session);
    }
    updater(session);
    state.sessions = sessions;
    return session;
}

function createSessionMeta() {
    const now = getNow();
    return {
        id: generateLogSessionId(),
        createdAt: now,
        updatedAt: now,
        entryCount: 0
    };
}

function queueLogPersistence(task) {
    logWriteQueue = logWriteQueue.then(task).catch(error => {
        console.error('[LogPersistence] 日志持久化失败:', error);
    });
    return logWriteQueue;
}

/**
 * 防抖持久化：将多次 addLog 触发的持久化合并为一次上传。
 * 在 LOG_PERSIST_DEBOUNCE_MS 毫秒内的连续调用只执行最后一次。
 * 页面关闭前（beforeunload）会立即触发一次强制持久化。
 */
function schedulePersist() {
    if (_persistDebounceTimer !== null) {
        clearTimeout(_persistDebounceTimer);
    }
    _persistDebounceTimer = setTimeout(() => {
        _persistDebounceTimer = null;
        queueLogPersistence(() => persistActiveLogSession());
    }, LOG_PERSIST_DEBOUNCE_MS);
}

async function removeExpiredLogSessions(indexData) {
    const existingIds = new Set((indexData.sessions || []).map(session => session.id));
    const persisted = extension_settings[extensionName].logState?.sessions || [];
    const staleIds = persisted.map(item => item.id).filter(id => !existingIds.has(id));
    for (const sessionId of staleIds) {
        try {
            await deleteLogSessionData(sessionId);
        } catch (error) {
            console.warn('[LogPersistence] 删除过期日志会话失败:', sessionId, error);
        }
    }
}

async function persistLogIndex() {
    const state = ensureLogStateContainer();
    const normalized = cleanupExpiredSessionMeta({
        version: 1,
        activeSessionId: state.activeSessionId || '',
        sessions: [...(state.sessions || [])]
    });

    state.activeSessionId = normalized.activeSessionId;
    state.sessions = normalized.sessions;
    await removeExpiredLogSessions(normalized);
    await saveLogIndex(normalized);
}

async function persistActiveLogSession() {
    const state = ensureLogStateContainer();
    const activeSessionId = state.activeSessionId;
    if (!activeSessionId) return;
    const meta = getSessionMeta(activeSessionId);
    if (!meta) return;

    await saveLogSessionData(activeSessionId, {
        id: activeSessionId,
        createdAt: meta.createdAt,
        updatedAt: meta.updatedAt,
        entryCount: meta.entryCount || 0,
        content: extension_settings[extensionName].log || ''
    });
    await persistLogIndex();
}

async function ensureActiveLogSession() {
    const state = ensureLogStateContainer();
    if (state.activeSessionId && getSessionMeta(state.activeSessionId)) {
        return state.activeSessionId;
    }

    const meta = createSessionMeta();
    state.activeSessionId = meta.id;
    state.sessions.push(meta);
    if (typeof extension_settings[extensionName].log !== 'string') {
        extension_settings[extensionName].log = '';
    }
    await persistActiveLogSession();
    return meta.id;
}

async function rotateLogSession() {
    const state = ensureLogStateContainer();
    await ensureActiveLogSession();
    await persistActiveLogSession();

    const nextMeta = createSessionMeta();
    state.activeSessionId = nextMeta.id;
    state.sessions.push(nextMeta);
    extension_settings[extensionName].log = '';
    await persistActiveLogSession();
}

export async function initializeLogPersistence() {
    if (!logPersistenceStatePromise) {
        logPersistenceStatePromise = (async () => {
            const storedIndex = await getLogIndex();
            const merged = cleanupExpiredSessionMeta(storedIndex && typeof storedIndex === 'object'
                ? {
                    version: storedIndex.version || 1,
                    activeSessionId: storedIndex.activeSessionId || '',
                    sessions: Array.isArray(storedIndex.sessions) ? storedIndex.sessions : []
                }
                : getDefaultLogIndex());

            extension_settings[extensionName].logState = merged;

            if (merged.activeSessionId) {
                const activeData = await getLogSessionData(merged.activeSessionId);
                extension_settings[extensionName].log = activeData?.content || extension_settings[extensionName].log || '';
                if (activeData) {
                    updateSessionMeta(merged.activeSessionId, session => {
                        session.createdAt = activeData.createdAt || session.createdAt;
                        session.updatedAt = activeData.updatedAt || session.updatedAt;
                        session.entryCount = activeData.entryCount || session.entryCount || 0;
                    });
                }
            } else if (typeof extension_settings[extensionName].log === 'string' && extension_settings[extensionName].log.trim() !== '') {
                const initialMeta = createSessionMeta();
                initialMeta.entryCount = extension_settings[extensionName].log.split('\n').filter(Boolean).length;
                merged.activeSessionId = initialMeta.id;
                merged.sessions.push(initialMeta);
                await persistActiveLogSession();
            } else {
                extension_settings[extensionName].log = '';
                await ensureActiveLogSession();
            }

            await persistLogIndex();

            // Flush 缓冲区：将初始化前积累的日志追加到活跃会话
            _logInitialized = true;
            if (_pendingLogBuffer.length > 0) {
                const buffered = _pendingLogBuffer.join('');
                _pendingLogBuffer = [];
                extension_settings[extensionName].log = (extension_settings[extensionName].log || '') + buffered;
                const state = ensureLogStateContainer();
                const lineCount = buffered.split('\n').filter(Boolean).length;
                if (state.activeSessionId) {
                    updateSessionMeta(state.activeSessionId, session => {
                        session.updatedAt = getNow();
                        session.entryCount = (session.entryCount || 0) + lineCount;
                    });
                }
                // 刷新 UI
                const logTextarea = document.getElementById('ch-log-textarea');
                if (logTextarea) {
                    logTextarea.value = extension_settings[extensionName].log || '';
                    logTextarea.scrollTop = 0;
                }
            }
            // 注册 beforeunload：页面关闭时强制立即持久化（防止防抖期间关闭导致丢失）
            window.addEventListener('beforeunload', () => {
                if (_persistDebounceTimer !== null) {
                    clearTimeout(_persistDebounceTimer);
                    _persistDebounceTimer = null;
                }
                // 同步触发（beforeunload 内只能同步操作）
                queueLogPersistence(() => persistActiveLogSession());
            }, { once: true });
            // 初始化结束后，用防抖方式写入一次（合并 flush 内容）
            schedulePersist();
        })().catch(error => {
            logPersistenceStatePromise = null;
            console.error('[LogPersistence] 初始化失败:', error);
        });
    }

    return logPersistenceStatePromise;
}

async function getRecentPersistedLogSessions() {
    await initializeLogPersistence();
    const state = ensureLogStateContainer();
    const cutoff = getNow() - LOG_RETENTION_MS;
    const sessions = [...(state.sessions || [])]
        .filter(session => (session.updatedAt || session.createdAt || 0) >= cutoff)
        .sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));

    const result = [];
    for (const session of sessions) {
        if (session.id === state.activeSessionId) {
            result.push({
                id: session.id,
                createdAt: session.createdAt,
                updatedAt: session.updatedAt,
                entryCount: session.entryCount || 0,
                content: extension_settings[extensionName].log || ''
            });
            continue;
        }

        const sessionData = await getLogSessionData(session.id);
        if (sessionData && sessionData.content) {
            result.push({
                id: session.id,
                createdAt: sessionData.createdAt || session.createdAt,
                updatedAt: sessionData.updatedAt || session.updatedAt,
                entryCount: sessionData.entryCount || session.entryCount || 0,
                content: sessionData.content
            });
        }
    }
    return result;
}

function formatLogSessionTimestamp(timestamp) {
    return new Date(timestamp).toLocaleString();
}

export async function exportLogsWithHistory() {
    const sessions = await getRecentPersistedLogSessions();
    const validSessions = sessions.filter(session => typeof session.content === 'string' && session.content.trim() !== '');
    if (validSessions.length === 0) {
        return '';
    }

    const lines = [];
    lines.push('========================================');
    lines.push('📋 st-chatu8 日志导出');
    lines.push(`生成时间: ${formatLogSessionTimestamp(getNow())}`);
    lines.push(`包含日志会话: ${validSessions.length}`);
    lines.push('范围: 当前会话 + 最近 24 小时历史会话');
    lines.push('========================================');
    lines.push('');

    validSessions.forEach((session, index) => {
        const isActive = ensureLogStateContainer().activeSessionId === session.id;
        lines.push(`【日志会话 ${index + 1}】${isActive ? '（当前会话）' : '（历史会话）'}`);
        lines.push(`会话 ID: ${session.id}`);
        lines.push(`开始时间: ${formatLogSessionTimestamp(session.createdAt)}`);
        lines.push(`最后更新: ${formatLogSessionTimestamp(session.updatedAt)}`);
        lines.push(`条目数: ${session.entryCount || 0}`);
        lines.push('----------------------------------------');
        lines.push(session.content.trimEnd());
        lines.push('');
    });

    lines.push('========================================');
    lines.push('日志导出结束');
    lines.push('========================================');
    return lines.join('\n');
}


export function isValidUrl(string) {
    // An empty string is considered valid to not show an error initially.
    if (!string || string.trim() === '') return true;
    // This regex allows http/https, localhost, IP addresses, and domain names, with optional port and path.
    const urlRegex = /^(https?:\/\/)?(localhost|([a-zA-Z0-9-]+\.)+[a-zA-Z]{2,}|(\d{1,3}\.){3}\d{1,3})(:\d+)?(\/.*)*$/;
    return urlRegex.test(string);
}


export function checkSendBuClass() {
    const sendButton = document.getElementById('send_but');
    const stopButton = document.getElementById('mes_stop');
    const isSendHidden = !sendButton || getComputedStyle(sendButton).display === 'none';
    const isStopVisible = stopButton && getComputedStyle(stopButton).display !== 'none';
    return isSendHidden || isStopVisible;
}


// 使用 TextEncoder 和 TextDecoder
function stringToBase64(str) {
    const bytes = new TextEncoder().encode(str);
    const binString = Array.from(bytes, (byte) =>
        String.fromCodePoint(byte)
    ).join('');
    return btoa(binString);
}
export function getsdAuth() {

    return `Basic ${stringToBase64(extension_settings[extensionName].st_chatu8_sd_auth)}`


}







export async function getSDMode(sdurl) {
    try {
        const url = new URL(sdurl);
        url.pathname = '/sdapi/v1/options';

        const result = await fetch(url, {
            method: 'GET',
            headers: { "Authorization": getsdAuth() },
        });

        if (!result.ok) {
            const errorText = await result.text();
            throw new Error(`获取 SD 选项失败，状态码: ${result.status}, 响应: ${errorText}`);
        }

        /** @type {any} */
        const data = await result.json();
        const model = data['sd_model_checkpoint'];
        addLog(`当前 SD 模型: ${model}`);
        return model;
    } catch (error) {
        addLog(`获取 SD 模型失败: ${error.message}`);
        throw error;
    }
};



export async function setSDMode(sdurl, model) {
    try {
        async function getProgress(sdurl2) {
            const url = new URL(sdurl2);
            url.pathname = '/sdapi/v1/progress';

            const result = await fetch(url, {
                method: 'GET',
                headers: { "Authorization": getsdAuth() },
            });
            return await result.json();
        }

        toastr.info(`正在切换模型...为${model}`);
        addLog(`开始切换 SD 模型为: ${model}`);

        const url = new URL(sdurl);
        url.pathname = '/sdapi/v1/options';

        const options = {
            sd_model_checkpoint: model,
        };

        const result = await fetch(url, {
            method: 'POST',
            body: JSON.stringify(options),
            headers: {
                'Content-Type': 'application/json'
            },
        });

        if (!result.ok) {
            const errorText = await result.text();
            addLog(`切换 SD 模型 API 请求失败。状态码: ${result.status}, 响应: ${errorText}`);
            throw new Error(`SD WebUI returned an error. Status: ${result.status}`);
        }

        const MAX_ATTEMPTS = 10;
        const CHECK_INTERVAL = 2000;

        for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
            /** @type {any} */
            const progressState = await getProgress(sdurl);

            const progress = progressState['progress'];
            const jobCount = progressState['state']['job_count'];
            if (progress === 0.0 && jobCount === 0) {
                break;
            }

            console.info(`Waiting for SD WebUI to finish model loading... Progress: ${progress}; Job count: ${jobCount}`);
            await delay(CHECK_INTERVAL);
        }

        toastr.info(`切换模型成功...为${model}`);
        addLog(`SD model switched to: ${model}`);
    } catch (error) {
        addLog(`切换 SD 模型失败: ${error.message}`);
        toastr.error(`切换模型失败: ${error.message}`);
        throw error;
    }
};

/**
 * Delays the current async function by the given amount of milliseconds.
 * @param {number} ms Milliseconds to wait
 * @returns {Promise<void>} Promise that resolves after the given amount of milliseconds
 */
export function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Determines if a value is an object.
 * @param {any} item The item to check.
 * @returns {boolean} True if the item is an object, false otherwise.
 */
function isObject(item) {
    return (item && typeof item === 'object' && !Array.isArray(item));
}

/**
 * Merges properties of two objects. If the property is an object, it will be merged recursively.
 * @param {object} target The target object
 * @param {object} source The source object
 * @returns {object} Merged object
 */
export function deepMerge(target, source) {
    let output = Object.assign({}, target);
    if (isObject(target) && isObject(source)) {
        Object.keys(source).forEach(key => {
            if (isObject(source[key])) {
                if (!(key in target))
                    Object.assign(output, { [key]: source[key] });
                else
                    output[key] = deepMerge(target[key], source[key]);
            } else {
                Object.assign(output, { [key]: source[key] });
            }
        });
    }
    return output;
}

/**
 * 处理输入的base64图像，使其符合指定的大分辨率之一
 * @param {string} inputBase64 - 输入的base64字符串
 * @returns {Promise<string>} - 返回处理后的base64字符串
 */
export async function processReferenceImage(inputBase64) {
    addLog('开始处理参考图...');
    return new Promise((resolve, reject) => {
        const img = new Image();

        img.onload = function () {
            // 原始尺寸
            const originalWidth = img.width;
            const originalHeight = img.height;
            const aspectRatio = originalWidth / originalHeight;
            addLog(`参考图原始尺寸: ${originalWidth}x${originalHeight}, 宽高比: ${aspectRatio.toFixed(2)}`);

            // 三个目标分辨率
            const targetSizes = [
                { width: 1024, height: 1536, ratio: 1024 / 1536 },  // 竖图
                { width: 1472, height: 1472, ratio: 1 },             // 方图
                { width: 1536, height: 1024, ratio: 1536 / 1024 }   // 横图
            ];

            // 选择最接近原图宽高比的目标尺寸
            let selectedSize = targetSizes[0];
            let minDiff = Math.abs(aspectRatio - targetSizes[0].ratio);

            for (let i = 1; i < targetSizes.length; i++) {
                const diff = Math.abs(aspectRatio - targetSizes[i].ratio);
                if (diff < minDiff) {
                    minDiff = diff;
                    selectedSize = targetSizes[i];
                }
            }

            //  addLog(`参考图选择的目标尺寸: ${selectedSize.width}x${selectedSize.height}`);

            // 创建canvas进行处理
            const canvas = document.createElement('canvas');
            canvas.width = selectedSize.width;
            canvas.height = selectedSize.height;
            const ctx = canvas.getContext('2d');

            // 高质量缩放
            ctx.imageSmoothingEnabled = true;
            ctx.imageSmoothingQuality = 'high';
            ctx.drawImage(img, 0, 0, selectedSize.width, selectedSize.height);

            addLog(`正在缩放参考图...`);

            let processedBase64;
            if (isMobileDevice()) {
                // 手机端：使用JPEG格式和0.3的质量进行压缩
                processedBase64 = canvas.toDataURL('image/jpeg', 0.3).replace(/^data:image\/jpeg;base64,/, '');
                //  addLog(`参考图处理完成 (移动端)！输出尺寸: ${selectedSize.width}x${selectedSize.height}, 格式: JPEG, 质量: 0.3`);
            } else {
                // 电脑端：不压缩，使用PNG格式
                processedBase64 = canvas.toDataURL('image/png').replace(/^data:image\/png;base64,/, '');
                // addLog(`参考图处理完成 (桌面端)！输出尺寸: ${selectedSize.width}x${selectedSize.height}, 格式: PNG`);
            }

            resolve(processedBase64);
        };

        img.onerror = (err) => {
            const errorMessage = err instanceof Error ? err.message : '未知错误';
            addLog(`参考图加载失败: ${errorMessage}`);
            reject(new Error('图片加载失败'));
        };


        let imgSrc = inputBase64;
        if (inputBase64 && !inputBase64.startsWith('data:image')) {
            addLog('输入为原始base64，正在添加Data URL前缀...');
            imgSrc = 'data:image/png;base64,' + inputBase64;
        }
        img.src = imgSrc;
    });
}





export function calculateSkipCfgAboveSigma(width, height, modelName) {
    addLog(`计算 skip_cfg_above_sigma... 宽度: ${width}, 高度: ${height}, 模型: ${modelName}`);
    const magicConstant = modelName?.includes('nai-diffusion-4-5')
        ? SIGMA_MAGIC_NUMBER_V4_5
        : SIGMA_MAGIC_NUMBER;
    addLog(`使用的 magicConstant: ${magicConstant}`);

    const pixelCount = width * height;
    const ratio = pixelCount / REFERENCE_PIXEL_COUNT;
    addLog(`像素: ${pixelCount}, 比例: ${ratio.toFixed(4)}`);

    const result = Math.pow(ratio, 0.5) * magicConstant;
    addLog(`计算结果 skip_cfg_above_sigma: ${result}`);
    return result;
}

function getBaseTag(tag) {
    let base = tag.toLowerCase();
    let prev;
    do {
        prev = base;
        // Strip leading/trailing brackets
        base = base.replace(/^[([{<]+/, '');
        base = base.replace(/[)\]}>]+$/, '');
        // Strip leading numeric weights e.g. 1.3::
        base = base.replace(/^[\d.]+::/, '');
        // Strip trailing double colons
        base = base.replace(/::$/, '');
        // Strip trailing SD weights e.g. :1.2
        base = base.replace(/:(?:\d*\.\d+|\d+)$/, '');
        base = base.trim();
    } while (base !== prev);
    
    return base;
}

function hasWeight(tag) {
    return tag.toLowerCase() !== getBaseTag(tag);
}

/**
 * Deduplicates tags in a comma-separated string (case-insensitive)
 * @param {string} tagString - Comma-separated tags
 * @returns {string} - Deduplicated comma-separated tags
 */
export function deduplicateTags(tagString) {
    // Handle empty or invalid input
    if (!tagString || typeof tagString !== 'string') {
        return '';
    }

    // Split by comma and trim whitespace
    const tags = tagString.split(',').map(tag => tag.trim()).filter(tag => tag.length > 0);

    if (tags.length === 0) {
        return '';
    }

    // Use Map for case-insensitive deduplication while preserving original casing
    const uniqueTags = new Map();
    for (const tag of tags) {
        const baseTag = getBaseTag(tag);
        
        if (!uniqueTags.has(baseTag)) {
            uniqueTags.set(baseTag, tag);
        } else {
            // Priority: keep the one with weights, or if both/none have weights, keep the first one
            const existingTag = uniqueTags.get(baseTag);
            const isNewWeighted = hasWeight(tag);
            const isExistingWeighted = hasWeight(existingTag);
            
            if (!isExistingWeighted && isNewWeighted) {
                uniqueTags.set(baseTag, tag);
            }
        }
    }

    // Join back with comma and space
    const result = Array.from(uniqueTags.values()).join(', ');

    // Log deduplication if duplicates were removed
    if (tags.length !== uniqueTags.size) {
        addLog(`[去重] ${tags.length} 个标签 → ${uniqueTags.size} 个标签 (移除 ${tags.length - uniqueTags.size} 个重复)`);
    }

    return result;
}

// Function to parse the string
export function parsePromptStringWithCoordinates(promptString) {
    addLog(`解析场景构图字符串: ${promptString}`);
    // 创建结果对象
    const result = {
        'Scene Composition': '',
        'Character 1 Prompt': '',
        'Character 1 UC': '',
        'Character 2 Prompt': '',
        'Character 2 UC': '',
        'Character 3 Prompt': '',
        'Character 3 UC': '',
        'Character 4 Prompt': '',
        'Character 4 UC': '',
        'Character 1 centers': '',
        'Character 2 centers': '',
        'Character 3 centers': '',
        'Character 4 centers': '',
        'Character 1 coordinates': {},
        'Character 2 coordinates': {},
        'Character 3 coordinates': {},
        'Character 4 coordinates': {}
    };

    // 提取场景组成
    const sceneMatch = promptString.match(/Scene Composition:([^;]+);/);
    if (sceneMatch) {
        result['Scene Composition'] = deduplicateTags(sceneMatch[1].trim());
    }

    // 提取角色信息
    for (let i = 1; i <= 4; i++) {
        // 提取角色提示
        const promptMatch = promptString.match(new RegExp(`Character ${i} Prompt:(.*?)(?:\\s*\\|\\s*centers:([^;\\s]+))?\\s*;`));

        if (promptMatch) {
            result[`Character ${i} Prompt`] = deduplicateTags(promptMatch[1].trim());
            if (promptMatch[2]) {
                result[`Character ${i} centers`] = promptMatch[2].trim();
                result[`Character ${i} coordinates`] = centersToCoordinates(promptMatch[2].trim());
            } else {
                result[`Character ${i} coordinates`] = {
                    // x:  0.5,
                    // y: y2
                }
            }
        }

        // 提取角色UC
        const ucMatch = promptString.match(new RegExp(`Character ${i} UC:([^;]+);`));
        if (ucMatch) {
            result[`Character ${i} UC`] = ucMatch[1].trim();
        }
    }
    addLog(`解析结果: ${JSON.stringify(result, null, 2)}`);
    return result;
}

/**
 * Creates a stylish input prompt.
 * @param {string} message The message to display in the prompt.
 * @returns {Promise<string|false>} A promise that resolves with the input value or false if canceled.
 */
export function stylInput(message) {
    return new Promise((resolve) => {
        const overlay = document.createElement('div');
        overlay.style.cssText = 'position: fixed; top: 0; left: 0; width: 100%; height: 100%; background-color: rgba(0, 0, 0, 0.5); z-index: 9999;';
        document.body.appendChild(overlay);

        const confirmBox = document.createElement('div');
        confirmBox.style.cssText = 'position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%); background-color: #fff; padding: 20px; border-radius: 5px; box-shadow: 0 2px 10px rgba(0, 0, 0, 0.2); z-index: 10000;';
        document.body.appendChild(confirmBox);

        const messageText = document.createElement('p');
        messageText.textContent = message;
        messageText.style.cssText = 'margin-bottom: 20px; color: #333;';
        confirmBox.appendChild(messageText);

        const messageinput = document.createElement('input');
        messageinput.style.cssText = 'margin-bottom: 20px; color: #333; width: 100%; padding: 5px;';
        confirmBox.appendChild(messageinput);

        const buttonContainer = document.createElement('div');
        buttonContainer.style.textAlign = 'right';
        confirmBox.appendChild(buttonContainer);

        const cancelButton = document.createElement('button');
        cancelButton.textContent = '取消';
        cancelButton.style.cssText = 'margin-right: 10px; padding: 10px 20px; background-color: #6c757d; color: #fff; border: none; border-radius: 5px; cursor: pointer;';
        buttonContainer.appendChild(cancelButton);

        const confirmButton = document.createElement('button');
        confirmButton.textContent = '确定';
        confirmButton.style.cssText = 'padding: 10px 20px; background-color: #007bff; color: #fff; border: none; border-radius: 5px; cursor: pointer;';
        buttonContainer.appendChild(confirmButton);

        cancelButton.addEventListener('click', () => {
            document.body.removeChild(overlay);
            document.body.removeChild(confirmBox);
            resolve(false);
        });

        confirmButton.addEventListener('click', () => {
            document.body.removeChild(overlay);
            document.body.removeChild(confirmBox);
            resolve(messageinput.value);
        });
    });
}

// 将centers值转换为坐标
function centersToCoordinates(centers) {
    if (!centers) return {};

    // 从centers提取列和行
    const match = centers.match(/([a-e])([1-5])/i);
    if (!match) return {};

    const column = match[1].toLowerCase();
    const row = parseInt(match[2]);

    // 将列字母转换为0到1之间的x坐标
    const columnMap = {
        'a': 0.1,
        'b': 0.3,
        'c': 0.5,
        'd': 0.7,
        'e': 0.9
    };

    // 将行数字转换为0到1之间的y坐标
    const rowMap = {
        1: 0.1,
        2: 0.3,
        3: 0.5,
        4: 0.7,
        5: 0.9
    };

    return {
        x: columnMap[column] || 0.5,
        y: rowMap[row] || 0.5
    };
}

export async function convertImageToBase64(link, imageBlob) {
    const reader = new FileReader();
    reader.onload = function (e) {
        const base64Image = e.target.result;
        setItemImg(link, base64Image);
        // Process the base64 image data here
    };
    reader.readAsDataURL(imageBlob);
}


/**
 * Creates a stylish confirmation dialog.
 * @param {string} message The message to display in the dialog.
 * @returns {Promise<boolean>} A promise that resolves with true if confirmed, false otherwise.
 */
export function stylishConfirm(message) {
    return new Promise((resolve) => {
        const overlay = document.createElement('div');
        overlay.style.cssText = 'position: fixed; top: 0; left: 0; width: 100%; height: 100%; background-color: rgba(0, 0, 0, 0.5); z-index: 9999;';
        document.body.appendChild(overlay);

        const confirmBox = document.createElement('div');
        confirmBox.style.cssText = 'position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%); background-color: #fff; padding: 20px; border-radius: 5px; box-shadow: 0 2px 10px rgba(0, 0, 0, 0.2); z-index: 10000;';
        document.body.appendChild(confirmBox);

        const messageText = document.createElement('p');
        messageText.textContent = message;
        messageText.style.cssText = 'margin-bottom: 20px; color: #333;';
        confirmBox.appendChild(messageText);

        const buttonContainer = document.createElement('div');
        buttonContainer.style.textAlign = 'right';
        confirmBox.appendChild(buttonContainer);

        const cancelButton = document.createElement('button');
        cancelButton.textContent = '取消';
        cancelButton.style.cssText = 'margin-right: 10px; padding: 10px 20px; background-color: #6c757d; color: #fff; border: none; border-radius: 5px; cursor: pointer;';
        buttonContainer.appendChild(cancelButton);

        const confirmButton = document.createElement('button');
        confirmButton.textContent = '确定';
        confirmButton.style.cssText = 'padding: 10px 20px; background-color: #007bff; color: #fff; border: none; border-radius: 5px; cursor: pointer;';
        buttonContainer.appendChild(confirmButton);

        cancelButton.addEventListener('click', () => {
            document.body.removeChild(overlay);
            document.body.removeChild(confirmBox);
            resolve(false);
        });

        confirmButton.addEventListener('click', () => {
            document.body.removeChild(overlay);
            document.body.removeChild(confirmBox);
            resolve(true);
        });
    });
}

/**
 * Removes the trailing slash from a string.
 * @param {string} str The input string.
 * @returns {string} The string without a trailing slash.
 */
export function removeTrailingSlash(str) {
    return str.endsWith('/') ? str.slice(0, -1) : str;
}

/**
 * Escapes special characters in a string for use in a regular expression.
 * @param {string} string The input string.
 * @returns {string} The escaped string.
 */
export function escapeRegExp(string) {
    return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Pauses execution for a specified number of milliseconds.
 * @param {number} ms The number of milliseconds to sleep.
 * @returns {Promise<void>} A promise that resolves after the specified time.
 */
export function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * 等待生图锁释放(基于事件监听，避免轮询)
 * 修复竞争条件：多个等待者收到事件时，需要再次检查锁状态，确保真正获取到锁才返回
 * @returns {Promise<void>} 当锁可用时解析
 */
export function waitForLock() {
    return new Promise(resolve => {
        const tryAcquire = () => {
            // 再次检查锁是否可用（防止多个等待者同时通过）
            if (window.xiancheng) {
                // 锁可用，移除监听器并返回
                window.removeEventListener('xianchengReleased', tryAcquire);
                resolve();
            }
            // 如果锁不可用（被其他等待者抢先获取），继续等待下一次事件
        };

        // 首先检查锁是否可用
        if (window.xiancheng) {
            resolve();
            return;
        }

        // 监听锁释放事件
        window.addEventListener('xianchengReleased', tryAcquire);
    });
}

/**
 * 释放生图锁并触发事件通知等待者
 */
export function releaseLock() {
    window.xiancheng = true;
    window.dispatchEvent(new Event('xianchengReleased'));
}

/**
 * 获取生图锁
 */
export function acquireLock() {
    window.xiancheng = false;
}

/**
 * Adds a smooth shake effect to an element.
 * @param {HTMLElement} imgElement The element to shake.
 */
export function addSmoothShakeEffect(imgElement) {
    if (getComputedStyle(imgElement).position === 'static') {
        imgElement.style.position = 'relative';
    }

    const startTime = Date.now();
    const duration = 300; // ms
    const amplitude = 3; // pixels

    function shake() {
        const elapsed = Date.now() - startTime;
        if (elapsed < duration) {
            const offset = amplitude * Math.sin(elapsed / duration * Math.PI * 10);
            imgElement.style.left = `${offset}px`;
            requestAnimationFrame(shake);
        } else {
            imgElement.style.left = '0px';
        }
    }
    requestAnimationFrame(shake);
}

/**
 * Generates a random seed.
 * @returns {number} A random integer.
 */
export function generateRandomSeed() {
    return Math.floor(Math.random() * 10000000000);
}

/**
 * Gets a random yushe preset ID from available presets.
 * When randomYushe is enabled, this function randomly selects one preset from the yushe collection.
 * @param {string} modeKey - The yusheid key for the current mode (e.g., 'yusheid_novelai', 'yusheid_comfyui', 'yusheid_sd')
 * @returns {string} The selected yushe preset ID (either random or the configured one)
 */
export function getRandomYusheId(modeKey) {
    const settings = extension_settings[extensionName];
    if (settings.randomYushe !== 'true') {
        return settings[modeKey];
    }
    const yushe = settings.yushe;
    if (!yushe || typeof yushe !== 'object') {
        return settings[modeKey];
    }
    const keys = Object.keys(yushe);
    if (keys.length === 0) {
        return settings[modeKey];
    }
    const randomKey = keys[Math.floor(Math.random() * keys.length)];
    addLog(`[随机预设] 从 ${keys.length} 个预设中随机选中: "${randomKey}" (原预设: "${settings[modeKey]}")`);
    toastr.info(`随机选中预设: "${randomKey}"`, '随机提示词预设');
    return randomKey;
}

/**
 * Checks if the user agent string indicates a mobile device.
 * @returns {boolean} True if it's a mobile device, false otherwise.
 */
export function isMobileDevice() {
    return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
}

/**
 * Concatenates positive prompts.
 * @param {string} text The base text.
 * @param {string} prom The prompt to add.
 * @param {string} AQT The quality modifier prompt.
 * @returns {string} The combined prompt.
 */
export async function zhengmian(fixedPrompt, mainPrompt, fixedPrompt_end, aqt, insertions) {

    fixedPrompt = await stripChineseAnnotations(fixedPrompt);
    mainPrompt = await stripChineseAnnotations(mainPrompt);
    fixedPrompt_end = await stripChineseAnnotations(fixedPrompt_end);
    aqt = await stripChineseAnnotations(aqt);

    addLog(`组合正面提示词 (复杂规则):`);
    addLog(`  - 前置前: ${insertions['前置前']}`);
    addLog(`  - 固定提示词 (前): ${fixedPrompt}`);
    addLog(`  - 前置后: ${insertions['前置后']}`);
    addLog(`  - 主要提示词: ${mainPrompt}`);
    addLog(`  - 后置前: ${insertions['后置前']}`);
    addLog(`  - 固定提示词 (后): ${fixedPrompt_end}`);
    addLog(`  - 后置后: ${insertions['后置后']}`);
    addLog(`  - 质量标签 (AQT): ${aqt}`);
    addLog(`  - 最后置: ${insertions['最后置']}`);

    const parts = [
        insertions['前置前'],
        fixedPrompt,
        insertions['前置后'],
        mainPrompt,
        insertions['后置前'],
        fixedPrompt_end,
        insertions['后置后'],
        aqt,
        insertions['最后置']
    ];

    const finalPrompt = parts.filter(p => p && p.trim()).join(', ');
    addLog(`组合后的正面提示词: ${finalPrompt}`);
    return finalPrompt;
}

/**
 * Concatenates negative prompts.
 * @param {string} text The base negative prompt.
 * @param {string} UCP The user-defined negative prompt.
 * @returns {string} The combined negative prompt.
 */
export async function fumian(text, UCP) {

    text = await stripChineseAnnotations(text);
    addLog(`组合负面提示词:`);
    addLog(`  - 固定负面提示词: ${text}`);
    addLog(`  - UCP 负面提示词: ${UCP}`);

    let finalNegativePrompt;
    if (text === "") {
        finalNegativePrompt = UCP;
    } else if (UCP === "") {
        finalNegativePrompt = text;
    } else {
        finalNegativePrompt = UCP + ", " + text;
    }
    addLog(`组合后的负面提示词: ${finalNegativePrompt}`);
    return finalNegativePrompt;
}



/**
 * 从规则的 value 末尾抽取可选的 `@if(<expr>)` 条件后缀。
 * - 若末尾存在合法的 @if(...)（括号配平、闭合到行尾），返回 { value: 去掉@if后的value, condition: 表达式字符串 }
 * - 若末尾没有 @if 或解析失败，返回 { value: 原始value, condition: null }
 * @param {string} rawValue
 * @returns {{ value: string, condition: string | null }}
 */
function extractIfCondition(rawValue) {
    if (typeof rawValue !== 'string') return { value: rawValue, condition: null };
    const trimmedRight = rawValue.replace(/\s+$/, '');
    if (!trimmedRight.endsWith(')')) return { value: rawValue, condition: null };

    // 从右向左做括号配平，找到与末尾 ')' 匹配的 '('
    let depth = 0;
    let openIdx = -1;
    for (let i = trimmedRight.length - 1; i >= 0; i--) {
        const ch = trimmedRight[i];
        if (ch === ')') depth++;
        else if (ch === '(') {
            depth--;
            if (depth === 0) { openIdx = i; break; }
        }
    }
    if (openIdx <= 0) return { value: rawValue, condition: null };

    // '(' 之前必须紧跟 @if（允许中间空格）
    const head = trimmedRight.substring(0, openIdx);
    const m = head.match(/@if\s*$/i);
    if (!m) return { value: rawValue, condition: null };

    const condition = trimmedRight.substring(openIdx + 1, trimmedRight.length - 1).trim();
    if (!condition) return { value: rawValue, condition: null };

    const valuePart = head.substring(0, head.length - m[0].length).replace(/\s+$/, '');
    return { value: valuePart, condition };
}

/**
 * 对 @if 表达式求值。叶子节点 = 不区分大小写的子串包含检测。
 * 支持: && (AND), || (OR), ! (NOT), () 分组, "..." 字面量。
 * 优先级: ! > && > ||
 * @param {string} expr
 * @param {string} haystack 检索源（如 allPrompts）
 * @returns {boolean}
 */
function evaluateCondition(expr, haystack) {
    const src = String(expr);
    const hay = String(haystack).toLowerCase();
    let pos = 0;

    const skipWs = () => { while (pos < src.length && /\s/.test(src[pos])) pos++; };

    // expression := orExpr
    // orExpr  := andExpr ('||' andExpr)*
    // andExpr := unary  ('&&' unary)*
    // unary   := '!' unary | primary
    // primary := '(' orExpr ')' | '"..."' | bareWord
    const parseOr = () => {
        let left = parseAnd();
        skipWs();
        while (src.startsWith('||', pos)) {
            pos += 2;
            const right = parseAnd();
            left = left || right;
            skipWs();
        }
        return left;
    };
    const parseAnd = () => {
        let left = parseUnary();
        skipWs();
        while (src.startsWith('&&', pos)) {
            pos += 2;
            const right = parseUnary();
            left = left && right;
            skipWs();
        }
        return left;
    };
    const parseUnary = () => {
        skipWs();
        if (src[pos] === '!') {
            pos++;
            return !parseUnary();
        }
        return parsePrimary();
    };
    const parsePrimary = () => {
        skipWs();
        if (src[pos] === '(') {
            pos++;
            const v = parseOr();
            skipWs();
            if (src[pos] === ')') pos++;
            else throw new Error('@if 表达式缺少右括号');
            return v;
        }
        if (src[pos] === '"') {
            pos++;
            let buf = '';
            while (pos < src.length && src[pos] !== '"') {
                if (src[pos] === '\\' && pos + 1 < src.length) { buf += src[pos + 1]; pos += 2; }
                else buf += src[pos++];
            }
            if (src[pos] !== '"') throw new Error('@if 表达式缺少右引号');
            pos++;
            return hay.includes(buf.toLowerCase());
        }
        // bareWord: 读到 && / || / ! / ( / ) / 空白 为止
        let start = pos;
        while (pos < src.length) {
            const ch = src[pos];
            if (ch === '(' || ch === ')' || ch === '!' || /\s/.test(ch)) break;
            if ((ch === '&' && src[pos + 1] === '&') || (ch === '|' && src[pos + 1] === '|')) break;
            pos++;
        }
        const word = src.substring(start, pos).trim();
        if (!word) throw new Error('@if 表达式存在空的触发词');
        return hay.includes(word.toLowerCase());
    };

    const result = parseOr();
    skipWs();
    if (pos < src.length) throw new Error(`@if 表达式存在未解析片段: "${src.substring(pos)}"`);
    return result;
}

/**
 * 安全求值 @if 条件：解析失败时记日志并返回 false（整行规则跳过），避免静默错配。
 * @param {string} condition
 * @param {string} haystack
 * @param {string} ctxLabel
 * @returns {boolean}
 */
function safeEvaluateIf(condition, haystack, ctxLabel = '') {
    try {
        return evaluateCondition(condition, haystack);
    } catch (e) {
        addLog(`${ctxLabel}@if 条件解析失败，跳过该规则。表达式: "${condition}"，错误: ${e.message}`);
        return false;
    }
}

/**
 * Parses complex prompt replacement rules and applies them.
 * @param {string} originalPrompt The initial prompt to be transformed.
 * @returns {Promise<{modifiedPrompt: string, insertions: object}>}
 */
export async function prompt_replace(originalPrompt, other_prompt = "") {
    const prompt_replace_id = extension_settings[extensionName].prompt_replace_id;
    const prompt_replace_texts = extension_settings[extensionName].prompt_replace;
    // Use optional chaining and nullish coalescing for safety
    const rulesText = prompt_replace_texts?.[prompt_replace_id]?.text ?? '';

    addLog(`原始 Prompt (用于替换): ${originalPrompt}`);

    if (rulesText.trim() === "") {
        addLog(`无有效替换规则，返回原始 Prompt。`);
        return {
            modifiedPrompt: originalPrompt,
            insertions: { '前置前': '', '前置后': '', '后置前': '', '后置后': '', '最后置': '' }
        };
    }

    addLog(`使用的替换规则内容:\n${rulesText}`);

    const insertions = { '前置前': [], '前置后': [], '后置前': [], '后置后': [], '最后置': [] };
    let modifiedPrompt = originalPrompt;
    let allPrompts = originalPrompt + other_prompt;

    const rules = rulesText.split('\n');

    for (const line of rules) {
        if (line.trim() === '') continue;
        const parts = line.split('=');
        if (parts.length < 2) continue;

        const trigger = parts[0].trim();
        if (!trigger) continue;

        const ruleContent = parts.slice(1).join('=');
        // The rule must contain a pipe to separate type and value
        if (!ruleContent.includes('|')) continue;

        const pipeIndex = ruleContent.indexOf('|');
        const type = ruleContent.substring(0, pipeIndex).trim();
        const value = ruleContent.substring(pipeIndex + 1).trim();

        // 解析可选的 @if(...) 条件后缀
        const { value: realValue, condition } = extractIfCondition(value);

        // 不区分大小写的匹配
        if (allPrompts.toLowerCase().includes(trigger.toLowerCase())) {
            if (condition && !safeEvaluateIf(condition, allPrompts, '')) {
                addLog(`@if 未通过，跳过规则: "${trigger}" 条件="${condition}"`);
                continue;
            }
            if (condition) addLog(`@if 通过: "${trigger}" 条件="${condition}"`);
            if (type === '替换') {
                addLog(`Prompt 替换: "${trigger}" -> "${realValue}"`);
                // 使用正则表达式进行不区分大小写的替换
                const regex = new RegExp(trigger.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
                modifiedPrompt = modifiedPrompt.replace(regex, realValue);
            } else if (insertions.hasOwnProperty(type)) {
                addLog(`发现插入: 类型="${type}", 触发词="${trigger}", 内容="${realValue}"`);
                insertions[type].push(realValue);
            }
        }
    }

    const finalInsertions = {};
    for (const key in insertions) {
        finalInsertions[key] = insertions[key].join(', ');
    }


    addLog(`替换/删除后的 Prompt: ${modifiedPrompt}`);
    addLog(`解析出的插入内容: ${JSON.stringify(finalInsertions)}`);

    return { modifiedPrompt, insertions: finalInsertions };

}

/**
 * Banana/Grok 专属的提示词替换规则处理
 * @param {string} originalPrompt 原始提示词
 * @param {string} other_prompt 其他提示词（用于触发检测）
 * @returns {Promise<{modifiedPrompt: string, insertions: Object}>} 替换后的提示词和插入内容
 */
export async function prompt_replace_banana(originalPrompt, other_prompt = "") {
    const bananaSettings = extension_settings[extensionName].banana || {};
    const prompt_replace_id = bananaSettings.prompt_replace_id || '默认';
    const prompt_replace_texts = bananaSettings.prompt_replace || {};
    const rulesText = prompt_replace_texts?.[prompt_replace_id]?.text ?? '';

    addLog(`[Banana] 原始 Prompt (用于替换): ${originalPrompt}`);

    if (rulesText.trim() === "") {
        addLog(`[Banana] 无有效替换规则，返回原始 Prompt。`);
        return {
            modifiedPrompt: originalPrompt,
            insertions: { '前置前': '', '前置后': '', '后置前': '', '后置后': '', '最后置': '' }
        };
    }

    addLog(`[Banana] 使用的替换规则内容:\n${rulesText}`);

    const insertions = { '前置前': [], '前置后': [], '后置前': [], '后置后': [], '最后置': [] };
    let modifiedPrompt = originalPrompt;
    let allPrompts = originalPrompt + other_prompt;

    const rules = rulesText.split('\n');

    for (const line of rules) {
        if (line.trim() === '') continue;
        const parts = line.split('=');
        if (parts.length < 2) continue;

        const trigger = parts[0].trim();
        if (!trigger) continue;

        const ruleContent = parts.slice(1).join('=');
        if (!ruleContent.includes('|')) continue;

        const pipeIndex = ruleContent.indexOf('|');
        const type = ruleContent.substring(0, pipeIndex).trim();
        const value = ruleContent.substring(pipeIndex + 1).trim();

        // 解析可选的 @if(...) 条件后缀
        const { value: realValue, condition } = extractIfCondition(value);

        // 不区分大小写的匹配
        if (allPrompts.toLowerCase().includes(trigger.toLowerCase())) {
            if (condition && !safeEvaluateIf(condition, allPrompts, '[Banana] ')) {
                addLog(`[Banana] @if 未通过，跳过规则: "${trigger}" 条件="${condition}"`);
                continue;
            }
            if (condition) addLog(`[Banana] @if 通过: "${trigger}" 条件="${condition}"`);
            if (type === '替换') {
                addLog(`[Banana] Prompt 替换: "${trigger}" -> "${realValue}"`);
                const regex = new RegExp(trigger.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
                modifiedPrompt = modifiedPrompt.replace(regex, realValue);
            } else if (insertions.hasOwnProperty(type)) {
                addLog(`[Banana] 发现插入: 类型="${type}", 触发词="${trigger}", 内容="${realValue}"`);
                insertions[type].push(realValue);
            }
        }
    }

    const finalInsertions = {};
    for (const key in insertions) {
        finalInsertions[key] = insertions[key].join(', ');
    }

    addLog(`[Banana] 替换/删除后的 Prompt: ${modifiedPrompt}`);
    addLog(`[Banana] 解析出的插入内容: ${JSON.stringify(finalInsertions)}`);

    return { modifiedPrompt, insertions: finalInsertions };
}

/**
 * Banana/Grok 专属的分角色提示词替换
 * @param {string} originalPrompt 原始角色提示词
 * @param {string} [fullContext] 可选的全文上下文，仅供 @if(...) 求值使用；未传则回退为当前角色片段
 * @returns {string} 替换后的角色提示词
 */
export function prompt_replace_banana_for_character(originalPrompt, fullContext) {
    const bananaSettings = extension_settings[extensionName].banana || {};
    const prompt_replace_id = bananaSettings.prompt_replace_id || '默认';
    const prompt_replace_texts = bananaSettings.prompt_replace || {};
    const rulesText = prompt_replace_texts?.[prompt_replace_id]?.text ?? '';

    addLog(`[Banana] 原始角色 Prompt (用于分角色替换): ${originalPrompt}`);

    if (rulesText.trim() === "" || !originalPrompt) {
        addLog(`[Banana] 无有效替换规则或空Prompt，返回原始Prompt。`);
        return originalPrompt;
    }

    let modifiedPrompt = originalPrompt;
    const rules = rulesText.split('\n');

    for (const line of rules) {
        if (line.trim() === '') continue;
        const parts = line.split('=');
        if (parts.length < 2) continue;

        const trigger = parts[0].trim();
        if (!trigger) continue;

        const ruleContent = parts.slice(1).join('=');
        if (!ruleContent.includes('|')) continue;

        const pipeIndex = ruleContent.indexOf('|');
        const type = ruleContent.substring(0, pipeIndex).trim();
        const value = ruleContent.substring(pipeIndex + 1);

        // 解析可选的 @if(...) 条件后缀（注意 value 末尾可能带空格/换行，先 trimEnd 后再判定）
        const { value: realValue, condition } = extractIfCondition(value);

        if ((type === '替换分角色' || type === '替换') && modifiedPrompt.toLowerCase().includes(trigger.toLowerCase())) {
            const ifHaystack = (typeof fullContext === 'string' && fullContext.length > 0) ? fullContext : modifiedPrompt;
            if (condition && !safeEvaluateIf(condition, ifHaystack, '[Banana] 分角色 ')) {
                addLog(`[Banana] 分角色 @if 未通过，跳过规则: "${trigger}" 条件="${condition}"`);
                continue;
            }
            addLog(`[Banana] 分角色 Prompt 替换: "${trigger}" -> "${realValue}"`);
            const regex = new RegExp(trigger.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
            modifiedPrompt = modifiedPrompt.replace(regex, realValue);
        }
    }

    addLog(`[Banana] 分角色替换后的 Prompt: ${modifiedPrompt}`);
    return modifiedPrompt;
}

/**
 * Applies specific replacement rules for character prompts in multi-character mode.
 * @param {string} originalPrompt The initial character prompt.
 * @param {string} [fullContext] 可选的全文上下文，仅供 @if(...) 求值使用；未传则回退为当前角色片段
 * @returns {Promise<string>} The modified character prompt.
 */
export function prompt_replace_for_character(originalPrompt, fullContext) {
    const prompt_replace_id = extension_settings[extensionName].prompt_replace_id;
    const prompt_replace_texts = extension_settings[extensionName].prompt_replace;
    // Use optional chaining and nullish coalescing for safety
    const rulesText = prompt_replace_texts?.[prompt_replace_id]?.text ?? '';

    addLog(`原始角色 Prompt (用于分角色替换): ${originalPrompt}`);

    if (rulesText.trim() === "" || !originalPrompt) {
        addLog(`无有效替换规则或空Prompt，返回原始Prompt。`);
        return originalPrompt;
    }

    addLog(`使用的替换规则内容 (分角色):\n${rulesText}`);

    let modifiedPrompt = originalPrompt;

    const rules = rulesText.split('\n');

    for (const line of rules) {
        if (line.trim() === '') continue;
        const parts = line.split('=');
        if (parts.length < 2) continue;

        const trigger = parts[0].trim();
        if (!trigger) continue;

        const ruleContent = parts.slice(1).join('=');
        // The rule must contain a pipe to separate type and value
        if (!ruleContent.includes('|')) continue;

        const pipeIndex = ruleContent.indexOf('|');
        const type = ruleContent.substring(0, pipeIndex).trim();
        const value = ruleContent.substring(pipeIndex + 1);

        // 解析可选的 @if(...) 条件后缀
        const { value: realValue, condition } = extractIfCondition(value);

        // 不区分大小写的匹配
        if ((type === '替换分角色' || type === '替换') && modifiedPrompt.toLowerCase().includes(trigger.toLowerCase())) {
            const ifHaystack = (typeof fullContext === 'string' && fullContext.length > 0) ? fullContext : modifiedPrompt;
            if (condition && !safeEvaluateIf(condition, ifHaystack, '分角色 ')) {
                addLog(`分角色 @if 未通过，跳过规则: "${trigger}" 条件="${condition}"`);
                continue;
            }
            addLog(`分角色 Prompt 替换: "${trigger}" -> "${realValue}"`);
            // 使用正则表达式进行不区分大小写的替换
            const regex = new RegExp(trigger.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
            modifiedPrompt = modifiedPrompt.replace(regex, realValue);
        }
    }

    addLog(`分角色替换后的 Prompt: ${modifiedPrompt}`);
    return modifiedPrompt;
}

/**
 * Generates a unique ID.
 * @returns {string} A unique ID string.
 */
export function generateUniqueId() {
    return Date.now().toString(36) + Math.random().toString(36).substring(2);
}

/**
 * Extracts a prompt from a string between start and end markers.
 * @param {string} str The input string.
 * @param {string} start The start marker (unused in current implementation).
 * @param {string} end The end marker (unused in current implementation).
 * @returns {string} The extracted prompt.
 */
export function extractPrompt(str, start, end) {
    return str;
}

/**
 * A wrapper around the fetch API to mimic GM_xmlhttpRequest.
 * @param {object} options The request options.
 * @returns {Promise<Response>} A promise that resolves with the response.
 */
export function request(options) {
    const { method, url, headers, data, responseType } = options;

    const fetchOptions = {
        method: method || 'GET',
        headers: headers,
        body: data,
    };
    // For pure JS, we might need to handle CORS.
    // fetchOptions.mode = 'cors';

    return fetch(url, fetchOptions).then(async response => {
        let responseData;
        switch (responseType) {
            case 'json':
                responseData = await response.json();
                break;
            case 'arraybuffer':
                responseData = await response.arrayBuffer();
                break;
            case 'blob':
                responseData = await response.blob();
                break;
            default:
                responseData = await response.text();
        }

        return {
            status: response.status,
            statusText: response.statusText,
            response: responseData,
            responseText: typeof responseData === 'string' ? responseData : JSON.stringify(responseData),
        };
    });
}


export function getRequestHeaders(token) {
    return {
        'Content-Type': 'application/json',
        'X-CSRF-Token': token,
    };
}

/**
 * 通用 Token 计数函数 —— 通过酒馆内置 tokenizer API 统计 token 数量
 *
 * @param {Array<{role: string, content: string}>} messages - 消息数组，格式与 OpenAI Chat 一致
 * @param {string} [model] - 模型名称，用于选择 tokenizer（如 "gemini-2.5-pro"）；
 *                           不传时取当前 LLM 默认配置的 model
 * @returns {Promise<number>} token 数量；请求失败时返回 -1
 */
export async function countTokens(messages, model) {
    try {
        if (!model) {
            // 尝试从当前 LLM 配置中获取 model
            const { extension_settings: es } = await import('../../../../extensions.js');
            const settings = es?.['st-chatu8'];
            const profileName = settings?.current_llm_profile || '默认';
            model = settings?.llm_profiles?.[profileName]?.model || 'gpt-4';
        }

        const url = `/api/tokenizers/openai/count?model=${encodeURIComponent(model)}`;
        const response = await fetch(url, {
            method: 'POST',
            headers: getRequestHeaders(window.token),
            body: JSON.stringify(messages),
        });

        if (!response.ok) {
            console.error(`[countTokens] 请求失败: ${response.status} ${response.statusText}`);
            return -1;
        }

        const data = await response.json();
        return data.token_count ?? -1;
    } catch (err) {
        console.error('[countTokens] 统计 token 失败:', err);
        return -1;
    }
}

/**
 * Adds a message to the log.
 * @param {string} message The message to log.
 */
export function addLog(message) {
    const timestamp = new Date().toLocaleString();
    const logEntry = `[${timestamp}] ${message}\n`;

    const MAX_LOG_LENGTH = 100000;
    const TRIM_TARGET_LENGTH = 80000;

    // 初始化尚未完成：将日志条目存入缓冲区，不创建新会话
    if (!_logInitialized) {
        _pendingLogBuffer.push(logEntry);
        if (_pendingLogBuffer.length > 1000) {
            _pendingLogBuffer = _pendingLogBuffer.slice(-800);
        }
        // 仍然尝试更新 UI（若 textarea 已存在）
        const logTextarea = document.getElementById('ch-log-textarea');
        if (logTextarea) {
            logTextarea.value += logEntry;
            if (logTextarea.value.length > MAX_LOG_LENGTH) {
                let trimmedVal = logTextarea.value.substring(logTextarea.value.length - TRIM_TARGET_LENGTH);
                const newlineIdx = trimmedVal.indexOf('\n');
                if (newlineIdx !== -1) trimmedVal = trimmedVal.substring(newlineIdx + 1);
                logTextarea.value = trimmedVal;
            }
            logTextarea.scrollTop = logTextarea.scrollHeight;
        }
        return;
    }

    // 初始化已完成：走正常写入路径
    if (!extension_settings[extensionName].log) {
        extension_settings[extensionName].log = '';
    }
    extension_settings[extensionName].log += logEntry;

    const state = ensureLogStateContainer();
    // 此时 activeSessionId 由 initializeLogPersistence() 保证已存在，直接更新 meta
    if (state.activeSessionId) {
        updateSessionMeta(state.activeSessionId, session => {
            session.updatedAt = getNow();
            session.entryCount = (session.entryCount || 0) + 1;
        });
    }

    const logTextarea = document.getElementById('ch-log-textarea');
    if (logTextarea) {
        let displayLog = getLog();
        if (displayLog.length > MAX_LOG_LENGTH) {
            let trimmedVal = displayLog.substring(displayLog.length - TRIM_TARGET_LENGTH);
            const newlineIdx = trimmedVal.indexOf('\n');
            if (newlineIdx !== -1) trimmedVal = trimmedVal.substring(newlineIdx + 1);
            logTextarea.value = "（前面的日志已折叠，请导出查看完整日志）\n" + trimmedVal;
        } else {
            logTextarea.value = displayLog;
        }
        logTextarea.scrollTop = logTextarea.scrollHeight;
    }

    // 防抖持久化：合并 5 秒内的多次写入为一次上传
    schedulePersist();

    // 自动检测并收集错误日志（已禁用，避免循环和性能问题）
    // const msgStr = String(message || '');\r
    // const isError = /失败|错误|Error|Failed|异常|Exception|无法|不能|问题|报错/i.test(msgStr);\r
    // if (isError) {\r
    //     import('./errorCollector.js').then(({ collectError }) => {\r
    //         collectError('log', '日志中的错误', { message: msgStr });\r
    //     }).catch(() => {});\r
    // }
}

/**
 * 轮转日志会话（生图开始时调用）。
 *
 * 语义：结束当前会话，持久化保留，开始新的空白会话。
 * 历史会话仍保留在 DB 中（导出时可见）。
 *
 * 方案B 核心：同步完成 activeSessionId 切换，
 * 异步只做持久化，彻底消除后续 addLog 被覆盖的竞争。
 */
export function clearLog() {
    // 1. 快照旧日志 & 旧会话 ID
    const oldLog = extension_settings[extensionName].log || '';
    const state = _logInitialized ? ensureLogStateContainer() : null;
    const oldSessionId = state?.activeSessionId || null;

    // 2. 同步完成会话轮转：立刻切换到新会话（仅在初始化已完成时）
    if (_logInitialized && state) {
        const nextMeta = createSessionMeta();
        state.activeSessionId = nextMeta.id;
        state.sessions.push(nextMeta);
    }

    // 3. 立刻清空 log（新会话从空白开始）
    extension_settings[extensionName].log = '';

    // 4. 同步清空 UI textarea
    const logTextarea = document.getElementById('ch-log-textarea');
    if (logTextarea) {
        logTextarea.value = '';
    }

    // 5. 异步：把旧日志持久化到旧会话 DB（不修改 log / activeSessionId）
    queueLogPersistence(async () => {
        await initializeLogPersistence();

        if (oldSessionId && oldLog) {
            const curState = ensureLogStateContainer();
            const oldMeta = (curState.sessions || []).find(s => s.id === oldSessionId);
            if (oldMeta) {
                await saveLogSessionData(oldSessionId, {
                    id: oldSessionId,
                    createdAt: oldMeta.createdAt,
                    updatedAt: oldMeta.updatedAt,
                    entryCount: oldMeta.entryCount || 0,
                    content: oldLog
                });
            }
        }

        await persistLogIndex();
    });
}

/**
 * 彻底清空所有日志（清空按钮调用）。
 *
 * 语义：删除所有历史会话的 DB 数据，开始一个全新的空白会话。
 * 导出后只会有当前空会话。
 */
export function clearAllLogs() {
    // 1. 收集所有旧会话 ID（将被删除）
    const state = _logInitialized ? ensureLogStateContainer() : null;
    const oldSessionIds = state ? [...(state.sessions || []).map(s => s.id)] : [];

    // 2. 同步完成会话轮转：立刻切换到新会话
    if (_logInitialized && state) {
        const nextMeta = createSessionMeta();
        state.activeSessionId = nextMeta.id;
        state.sessions = [nextMeta]; // 索引里只保留新会话
    }

    // 3. 立刻清空 log
    extension_settings[extensionName].log = '';

    // 4. 同步清空 UI textarea
    const logTextarea = document.getElementById('ch-log-textarea');
    if (logTextarea) {
        logTextarea.value = '';
    }

    // 5. 异步：彻底删除所有旧会话的 DB 数据
    queueLogPersistence(async () => {
        await initializeLogPersistence();

        const curState = ensureLogStateContainer();
        for (const sessionId of oldSessionIds) {
            if (sessionId === curState.activeSessionId) continue; // 跳过当前活跃会话
            try {
                await deleteLogSessionData(sessionId);
            } catch (e) {
                console.warn('[clearAllLogs] 删除旧会话失败:', sessionId, e);
            }
        }

        await persistLogIndex();
    });
}

/**
 * Retrieves the current log content.
 * @returns {string} The log content.
 */
export function getLog() {
    return extension_settings[extensionName].log || '';
}


/**
 * Processes an uploaded image file and returns a base64 data URL.
 * On mobile, it compresses the image to JPEG with 0.3 quality.
 * @param {File} file The image file to process.
 * @returns {Promise<string>} A promise that resolves with the base64 data URL.
 */
export async function processUploadedImage(file, is = false) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (e) => {
            if (isMobileDevice() && !is) {
                const img = new Image();
                img.onload = () => {
                    const canvas = document.createElement('canvas');
                    canvas.width = img.width;
                    canvas.height = img.height;
                    const ctx = canvas.getContext('2d');
                    ctx.drawImage(img, 0, 0);
                    const dataUrl = canvas.toDataURL('image/jpeg', 0.3);
                    addLog(`图片已在移动端压缩 (JPEG 质量 0.3).`);
                    resolve(dataUrl);
                };
                img.onerror = (err) => reject(new Error('图片加载失败.'));
                img.src = e.target.result;
            } else {
                addLog(`桌面端图片已加载.`);
                resolve(e.target.result);
            }
        };
        reader.onerror = (err) => reject(new Error('文件读取失败.'));
        reader.readAsDataURL(file);
    });
}

/**
 * Processes an uploaded image file into a Blob.
 * On mobile, it compresses the image to a JPEG Blob with 0.3 quality.
 * @param {File} file The image file to process.
 * @returns {Promise<Blob>} A promise that resolves with the processed image blob.
 */
export async function processUploadedImageToBlob(file) {
    if (isMobileDevice()) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = (e) => {
                const img = new Image();
                img.onload = () => {
                    const canvas = document.createElement('canvas');
                    canvas.width = img.width;
                    canvas.height = img.height;
                    const ctx = canvas.getContext('2d');
                    ctx.drawImage(img, 0, 0);
                    canvas.toBlob(
                        (blob) => {
                            if (blob) {
                                addLog(`图片已在移动端压缩 (JPEG 质量 0.5). 原始大小: ${file.size} bytes, 压缩后大小: ${blob.size} bytes`);
                                resolve(blob);
                            } else {
                                reject(new Error('Canvas to Blob 转换失败.'));
                            }
                        },
                        'image/jpeg',
                        0.5
                    );
                };
                img.onerror = (err) => reject(new Error('图片加载失败.'));
                img.src = e.target.result;
            };
            reader.onerror = (err) => reject(new Error('文件读取失败.'));
            reader.readAsDataURL(file);
        });
    } else {
        addLog(`桌面端图片已加载. 大小: ${file.size} bytes`);
        return Promise.resolve(file); // On desktop, return original file
    }
}
/**
 * 移除文本中的 <thinking>...</thinking> 标签及其内容
 * 用于在解析 AI 返回内容前先清理掉思考过程
 * @param {string} text - 输入文本
 * @returns {string} 移除 thinking 标签后的文本
 */
export function removeThinkingTags(text) {
    if (!text || typeof text !== 'string') return text || '';
    // 使用正则匹配 <thinking>...</thinking> 标签及其内容（支持多行和大小写）
    return text.replace(/<thinking>[\s\S]*?<\/thinking>/gi, '').trim();
}

export function stripChineseAnnotations(text) {
    if (!text) return '';
    // 移除所有中文全角括号及其中内容（支持嵌套括号）
    // 使用循环从最内层括号开始逐层移除
    let result = text;
    let prevResult;
    do {
        prevResult = result;
        // 匹配不包含括号的最内层内容并移除
        result = result.replace(/（[^（）]*）/g, '');
    } while (result !== prevResult);
    return result;
}

function blobToDataURL(blob) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = reject;
        reader.readAsDataURL(blob);
    });
}

/**
 * Converts an image to JPEG format with 0.78 quality.
 * @param {File|string} input - The image file or base64 data URL to convert.
 * @returns {Promise<string>} A promise that resolves with the JPEG base64 data URL.
 */
export async function convertImageToJpeg(input) {
    const img = await loadImage(input);

    const canvas = new OffscreenCanvas(img.width, img.height);
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0);

    const blob = await canvas.convertToBlob({
        type: 'image/jpeg',
        quality: 0.98  // 无损
    });


    return blobToDataURL(blob);
}

function loadImage(input) {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = () => reject(new Error('图片加载失败'));

        if (input instanceof File) {
            img.src = URL.createObjectURL(input);
        } else if (typeof input === 'string') {
            img.src = input;
        }
    });
}

/**
 * 递归更新 moov box 内所有 stco/co64 中的块偏移量
 * @param {Uint8Array} data  - moov box 的完整字节数组（含 box header）
 * @param {number}     start - 从 data 的哪个字节开始解析（跳过当前 box 的 header）
 * @param {number}     delta - 需要增加的字节数（即 moov box 的大小）
 */
function _addToStcoOffsets(data, start, end, delta) {
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    let pos = start;
    while (pos + 8 <= end) {
        const size = view.getUint32(pos);
        if (size < 8 || pos + size > end) break;
        const type = String.fromCharCode(data[pos + 4], data[pos + 5], data[pos + 6], data[pos + 7]);
        if (type === 'stco') {
            const count = view.getUint32(pos + 12);
            for (let i = 0; i < count; i++) {
                const p = pos + 16 + i * 4;
                view.setUint32(p, view.getUint32(p) + delta);
            }
        } else if (type === 'co64') {
            const count = view.getUint32(pos + 12);
            for (let i = 0; i < count; i++) {
                const p = pos + 16 + i * 8;
                const hi = view.getUint32(p);
                const lo = view.getUint32(p + 4);
                const val = (BigInt(hi) << 32n) | BigInt(lo >>> 0);
                const nv = val + BigInt(delta);
                view.setUint32(p, Number(nv >> 32n));
                view.setUint32(p + 4, Number(nv & 0xFFFFFFFFn));
            }
        } else if (['trak', 'mdia', 'minf', 'stbl', 'edts', 'dinf', 'udta'].includes(type)) {
            _addToStcoOffsets(data, pos + 8, pos + size, delta);
        }
        pos += size;
    }
}

/**
 * 修复 MP4 moov 原子位置（faststart）
 * FFmpeg 默认将 moov 写在文件末尾，手机浏览器需要 moov 在 mdat 前才能流式播放。
 * 此函数在 JS 端重排 boxes 并修正 stco 偏移，无需服务端处理。
 * @param {Blob} blob - 原始 MP4 Blob
 * @returns {Promise<Blob>} 修复后的 Blob（moov 移到前面），或原 Blob（无需修复/失败时）
 */
export async function fixMp4Faststart(blob) {
    try {
        const buffer = await blob.arrayBuffer();
        const bytes = new Uint8Array(buffer);
        const view = new DataView(buffer);

        const boxes = [];
        let pos = 0;
        while (pos + 8 <= bytes.length) {
            let size = view.getUint32(pos);
            const type = String.fromCharCode(bytes[pos + 4], bytes[pos + 5], bytes[pos + 6], bytes[pos + 7]);
            if (size === 0) { size = bytes.length - pos; }
            if (size < 8) break;
            boxes.push({ type, size, data: bytes.slice(pos, pos + size) });
            pos += size;
        }

        const moovIdx = boxes.findIndex(b => b.type === 'moov');
        const mdatIdx = boxes.findIndex(b => b.type === 'mdat');

        if (moovIdx === -1 || mdatIdx === -1 || moovIdx < mdatIdx) {
            return blob; // 无需修复
        }

        console.log('[mp4fix] moov 在 mdat 之后，执行 faststart 修复...');
        const moovBox = boxes[moovIdx];
        const moovSize = moovBox.size;

        const moovData = moovBox.data.slice();
        _addToStcoOffsets(moovData, 8, moovSize, moovSize);

        const parts = [];
        for (let i = 0; i < boxes.length; i++) {
            if (i === moovIdx) continue;
            if (i === mdatIdx) parts.push(moovData);
            parts.push(boxes[i].data);
        }

        console.log('[mp4fix] faststart 修复完成，moov 已移至文件头部');
        return new Blob(parts, { type: 'video/mp4' });
    } catch (e) {
        console.warn('[mp4fix] faststart 修复失败，使用原始 Blob:', e);
        return blob;
    }
}
