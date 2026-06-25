// @ts-nocheck
/**
 * 插件配置图片数据库管理模块
 * 
 * 用于存储插件配置相关的少量图片（如角色头像、预设图片等）。
 * 独立于聊天图片数据库（database.js），提供简化的 API。
 * 
 * 存储策略：
 * - jiuguanchucun === "true" → 存储到酒馆服务器
 * - 否则 → 存储到浏览器 IndexedDB
 */

import { extension_settings } from "../../../../extensions.js";
import { extensionName } from './config.js';
import { saveSettingsDebounced } from "../../../../../script.js";
import { getRequestHeaders } from './utils.js';

// IndexedDB 配置
const CONFIG_DB_NAME = 'chatu8_config_images';
const CONFIG_DB_VERSION = 2;
const CONFIG_STORE_NAME = 'config_images';

let configDb = null;

// ===================== 辅助函数 =====================

/**
 * 生成 UUID
 */
function generateUUID() {
    if (crypto && crypto.randomUUID) {
        return crypto.randomUUID();
    }
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
        var r = Math.random() * 16 | 0, v = c == 'x' ? r : (r & 0x3 | 0x8);
        return v.toString(16);
    });
}

/**
 * 生成配置图片的 ID 前缀
 * 格式：cfgimg_<uuid>
 */
function generateConfigImageId() {
    return `cfgimg_${generateUUID()}`;
}

/**
 * Base64 转 ArrayBuffer
 */
function base64ToArrayBuffer(base64) {
    const binaryString = window.atob(base64);
    const len = binaryString.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
        bytes[i] = binaryString.charCodeAt(i);
    }
    return bytes.buffer;
}

/**
 * ArrayBuffer 转 Base64
 */
function arrayBufferToBase64(buffer) {
    const bytes = new Uint8Array(buffer);
    const chunkSize = 0x8000;
    let binary = '';

    for (let i = 0; i < bytes.byteLength; i += chunkSize) {
        const chunk = bytes.subarray(i, i + chunkSize);
        binary += String.fromCharCode.apply(null, chunk);
    }

    return window.btoa(binary);
}

/**
 * Blob 转 Base64
 */
function blobToBase64(blob) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result);
        reader.onerror = reject;
        reader.readAsDataURL(blob);
    });
}

// ===================== IndexedDB 操作 =====================

/**
 * 打开配置图片数据库
 */
async function openConfigDB() {
    if (configDb) {
        return configDb;
    }

    return new Promise((resolve, reject) => {
        const request = indexedDB.open(CONFIG_DB_NAME, CONFIG_DB_VERSION);

        request.onupgradeneeded = (event) => {
            const db = event.target.result;
            if (!db.objectStoreNames.contains(CONFIG_STORE_NAME)) {
                db.createObjectStore(CONFIG_STORE_NAME, { keyPath: 'id' });
                console.log(`[ConfigDB] Object store '${CONFIG_STORE_NAME}' created.`);
            }
        };

        request.onerror = (event) => {
            console.error('[ConfigDB] 打开数据库失败:', event.target.error);
            reject(event.target.error);
        };

        request.onsuccess = (event) => {
            configDb = event.target.result;
            console.log(`[ConfigDB] 数据库 '${CONFIG_DB_NAME}' 打开成功。`);
            resolve(configDb);
        };
    });
}

/**
 * 写入配置图片到 IndexedDB
 */
async function dbWriteConfigImage(id, imageBuffer) {
    const db = await openConfigDB();
    const transaction = db.transaction([CONFIG_STORE_NAME], 'readwrite');
    const store = transaction.objectStore(CONFIG_STORE_NAME);

    return new Promise((resolve, reject) => {
        const request = store.put({ id, data: imageBuffer, date: Date.now() });
        request.onsuccess = () => resolve();
        request.onerror = (event) => reject(event.target.error);
    });
}

/**
 * 从 IndexedDB 读取配置图片
 */
async function dbReadConfigImage(id) {
    const db = await openConfigDB();
    const transaction = db.transaction([CONFIG_STORE_NAME], 'readonly');
    const store = transaction.objectStore(CONFIG_STORE_NAME);

    return new Promise((resolve, reject) => {
        const request = store.get(id);
        request.onsuccess = (event) => resolve(event.target.result);
        request.onerror = (event) => reject(event.target.error);
    });
}

/**
 * 从 IndexedDB 删除配置图片
 */
async function dbDeleteConfigImage(id) {
    const db = await openConfigDB();
    const transaction = db.transaction([CONFIG_STORE_NAME], 'readwrite');
    const store = transaction.objectStore(CONFIG_STORE_NAME);

    return new Promise((resolve, reject) => {
        const request = store.delete(id);
        request.onsuccess = () => resolve(true);
        request.onerror = (event) => reject(event.target.error);
    });
}

// ===================== 服务器存储操作 =====================

/**
 * 确保服务器存储对象存在
 */
function ensureServerStorage() {
    if (!extension_settings[extensionName].configImageStorage) {
        extension_settings[extensionName].configImageStorage = {};
    }
    return extension_settings[extensionName].configImageStorage;
}

// ===================== 公开 API =====================

/**
 * 保存配置图片
 * 
 * @param {string} imageBase64 - 图片的 Base64 字符串（可带或不带 data:image 前缀）
 * @param {Object} [options] - 可选参数
 * @param {string} [options.format='png'] - 图片格式
 * @param {string} [options.filename] - 文件名
 * @param {string} [options.id] - 指定存储 ID（迁移时用于保留旧引用）
 * @param {boolean} [options.forceServer=false] - 强制保存到酒馆服务器
 * @param {boolean} [options.forceIndexedDB=false] - 强制保存到 IndexedDB
 * @returns {Promise<string>} - 返回图片的唯一标识符 (ID)
 */
export async function saveConfigImage(imageBase64, options = {}) {
    const { format = 'png', filename, id: providedId, forceServer = false, forceIndexedDB = false } = options;
    const id = providedId || generateConfigImageId();
    const base64Data = imageBase64.split(',')[1] || imageBase64;

    if (!forceIndexedDB && (forceServer || extension_settings[extensionName].jiuguanchucun === "true")) {
        // 存储到服务器
        try {
            const uploadBody = {
                image: base64Data,
                format: format,
                ch_name: 'chatu8_config'
            };
            if (filename) {
                uploadBody.filename = filename;
            }

            const response = await fetch('/api/images/upload', {
                method: 'POST',
                headers: getRequestHeaders(window.token),
                body: JSON.stringify(uploadBody)
            });

            if (!response.ok) {
                throw new Error(`Upload failed: ${response.statusText}`);
            }

            const result = await response.json();
            const imagePath = result.path;

            // 存储元数据到 extension_settings
            const storage = ensureServerStorage();
            storage[id] = {
                path: imagePath,
                date: Date.now()
            };

            saveSettingsDebounced();
            console.log(`[ConfigDB] 配置图片已保存到服务器: ${id}`);
            return id;

        } catch (error) {
            console.error('[ConfigDB] 上传配置图片到服务器失败:', error);
            throw error;
        }

    } else {
        // 存储到 IndexedDB
        const imageBuffer = base64ToArrayBuffer(base64Data);
        await dbWriteConfigImage(id, imageBuffer);
        console.log(`[ConfigDB] 配置图片已保存到 IndexedDB: ${id}`);
        return id;
    }
}

/**
 * 保存配置文本数据，避免大 JSON 先转 base64 再解码回字节。
 *
 * @param {string} text - UTF-8 文本内容
 * @param {Object} [options]
 * @param {string} [options.filename]
 * @param {string} [options.id] - 指定存储 ID（迁移时用于保留旧引用）
 * @param {boolean} [options.forceServer=false] - 强制保存到酒馆服务器
 * @param {boolean} [options.forceIndexedDB=false] - 强制保存到 IndexedDB
 * @returns {Promise<string>} 唯一存储 ID
 */
export async function saveConfigText(text, options = {}) {
    const { filename, id: providedId, forceServer = false, forceIndexedDB = false } = options;
    const id = providedId || generateConfigImageId();

    if (!forceIndexedDB && (forceServer || extension_settings[extensionName].jiuguanchucun === "true")) {
        try {
            const uploadBody = {
                image: utf8ToBase64(text),
                format: 'png',
                ch_name: 'chatu8_config'
            };
            if (filename) {
                uploadBody.filename = filename;
            }

            const response = await fetch('/api/images/upload', {
                method: 'POST',
                headers: getRequestHeaders(window.token),
                body: JSON.stringify(uploadBody)
            });

            if (!response.ok) {
                throw new Error(`Upload failed: ${response.statusText}`);
            }

            const result = await response.json();
            const storage = ensureServerStorage();
            storage[id] = {
                path: result.path,
                date: Date.now(),
                type: 'text'
            };

            saveSettingsDebounced();
            console.log(`[ConfigDB] 配置文本已保存到服务器: ${id}`);
            return id;
        } catch (error) {
            console.error('[ConfigDB] 上传配置文本到服务器失败:', error);
            throw error;
        }
    }

    await dbWriteConfigImage(id, text);
    console.log(`[ConfigDB] 配置文本已保存到 IndexedDB: ${id}`);
    return id;
}

function decodeDataUrlText(dataUrl) {
    const commaIndex = dataUrl.indexOf(',');
    if (commaIndex === -1) return '';

    const header = dataUrl.substring(0, commaIndex);
    const data = dataUrl.substring(commaIndex + 1);
    if (header.includes(';base64')) {
        return base64ToUtf8(data);
    }
    return decodeURIComponent(data);
}

/**
 * 读取配置文本数据。兼容旧的 base64/ArrayBuffer 存储格式。
 *
 * @param {string} id
 * @returns {Promise<string|null>}
 */
export async function getConfigText(id) {
    if (!id) return null;

    const serverStorage = extension_settings[extensionName].configImageStorage || {};
    const serverEntry = serverStorage[id];

    if (serverEntry && serverEntry.path) {
        try {
            const response = await fetch(serverEntry.path);
            if (response.ok) {
                const text = await response.text();
                if (text.startsWith('data:')) {
                    return decodeDataUrlText(text);
                }

                const trimmed = text.trim();
                if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
                    return text;
                }

                try {
                    return base64ToUtf8(trimmed);
                } catch {
                    return text;
                }
            }
        } catch (error) {
            console.error('[ConfigDB] 从服务器获取配置文本失败:', error);
        }
    }

    try {
        const dbEntry = await dbReadConfigImage(id);
        if (dbEntry && dbEntry.data) {
            if (typeof dbEntry.data === 'string') {
                return dbEntry.data.startsWith('data:') ? decodeDataUrlText(dbEntry.data) : dbEntry.data;
            }

            if (dbEntry.data instanceof ArrayBuffer) {
                return new TextDecoder().decode(new Uint8Array(dbEntry.data));
            }
        }
    } catch (error) {
        console.error('[ConfigDB] 从 IndexedDB 获取配置文本失败:', error);
    }

    return null;
}

/**
 * 获取配置图片
 * 
 * @param {string} id - 图片的唯一标识符
 * @returns {Promise<string|null>} - 返回 Base64 图片字符串，或 null（如果不存在）
 */
export async function getConfigImage(id) {
    if (!id) return null;

    // 先检查服务器存储
    const serverStorage = extension_settings[extensionName].configImageStorage || {};
    const serverEntry = serverStorage[id];

    if (serverEntry && serverEntry.path) {
        try {
            const response = await fetch(serverEntry.path);
            if (response.ok) {
                const blob = await response.blob();
                const base64 = await blobToBase64(blob);
                return base64;
            }
        } catch (error) {
            console.error('[ConfigDB] 从服务器获取配置图片失败:', error);
        }
    }

    // 回退到 IndexedDB
    try {
        const dbEntry = await dbReadConfigImage(id);
        if (dbEntry && dbEntry.data) {
            if (typeof dbEntry.data === 'string') {
                return "data:application/json;base64," + utf8ToBase64(dbEntry.data);
            }
            return "data:image/png;base64," + arrayBufferToBase64(dbEntry.data);
        }
    } catch (error) {
        console.error('[ConfigDB] 从 IndexedDB 获取配置图片失败:', error);
    }

    return null;
}

/**
 * 删除配置图片
 * 
 * @param {string} id - 图片的唯一标识符
 * @returns {Promise<boolean>} - 返回是否删除成功
 */
export async function deleteConfigImage(id) {
    if (!id) return false;

    let deleted = false;

    // 检查并删除服务器存储
    const serverStorage = extension_settings[extensionName].configImageStorage || {};
    const serverEntry = serverStorage[id];

    if (serverEntry) {
        if (serverEntry.path) {
            try {
                const response = await fetch('/api/images/delete', {
                    method: 'POST',
                    headers: getRequestHeaders(window.token),
                    body: JSON.stringify({ path: serverEntry.path })
                });
                if (!response.ok) {
                    console.error('[ConfigDB] 删除服务器图片失败:', response.statusText);
                }
            } catch (error) {
                console.error('[ConfigDB] 删除服务器图片失败:', error);
            }
        }
        delete serverStorage[id];
        saveSettingsDebounced();
        deleted = true;
        console.log(`[ConfigDB] 配置图片已从服务器删除: ${id}`);
    }

    // 检查并删除 IndexedDB 存储
    try {
        const dbEntry = await dbReadConfigImage(id);
        if (dbEntry) {
            await dbDeleteConfigImage(id);
            deleted = true;
            console.log(`[ConfigDB] 配置图片已从 IndexedDB 删除: ${id}`);
        }
    } catch (error) {
        console.error('[ConfigDB] 从 IndexedDB 删除配置图片失败:', error);
    }

    return deleted;
}

/**
 * 检查配置图片是否存在
 * 
 * @param {string} id - 图片的唯一标识符
 * @returns {Promise<boolean>} - 返回图片是否存在
 */
export async function hasConfigImage(id) {
    if (!id) return false;

    // 检查服务器存储
    const serverStorage = extension_settings[extensionName].configImageStorage || {};
    if (serverStorage[id]) {
        return true;
    }

    // 检查 IndexedDB
    try {
        const dbEntry = await dbReadConfigImage(id);
        return !!dbEntry;
    } catch (error) {
        return false;
    }
}

/**
 * 获取所有配置图片的 ID 列表
 * 
 * @returns {Promise<string[]>} - 返回所有配置图片的 ID 数组
 */
export async function listConfigImageIds() {
    const ids = new Set();

    // 获取服务器存储的 ID
    const serverStorage = extension_settings[extensionName].configImageStorage || {};
    Object.keys(serverStorage).forEach(id => ids.add(id));

    // 获取 IndexedDB 的 ID
    try {
        const db = await openConfigDB();
        const transaction = db.transaction([CONFIG_STORE_NAME], 'readonly');
        const store = transaction.objectStore(CONFIG_STORE_NAME);

        const dbIds = await new Promise((resolve, reject) => {
            const request = store.getAllKeys();
            request.onsuccess = () => resolve(request.result);
            request.onerror = (event) => reject(event.target.error);
        });

        dbIds.forEach(id => ids.add(id));
    } catch (error) {
        console.error('[ConfigDB] 获取 IndexedDB ID 列表失败:', error);
    }

    return Array.from(ids);
}

// ===================== 文本/JSON 数据操作 =====================

/**
 * 把 UTF-8 字符串转换为 Base64
 */
function utf8ToBase64(str) {
    return window.btoa(unescape(encodeURIComponent(str)));
}

/**
 * 把 Base64 转换为 UTF-8 字符串
 */
function base64ToUtf8(str) {
    return decodeURIComponent(escape(window.atob(str)));
}

/**
 * 保存 AI 聊天历史
 * @param {Array} historyArray 聊天记录数组
 */
export async function saveAiChatHistory(historyArray) {
    const id = 'ai_chat_history';
    const jsonString = JSON.stringify(historyArray);
    const base64Data = utf8ToBase64(jsonString);

    if (extension_settings[extensionName].jiuguanchucun === "true") {
        try {
            const uploadBody = {
                image: base64Data,
                format: 'png',
                ch_name: 'chatu8_config',
                filename: 'ai_chat_history.png'
            };

            const response = await fetch('/api/images/upload', {
                method: 'POST',
                headers: getRequestHeaders(window.token),
                body: JSON.stringify(uploadBody)
            });

            if (!response.ok) {
                throw new Error(`Upload failed: ${response.statusText}`);
            }

            const result = await response.json();

            const storage = ensureServerStorage();
            storage[id] = {
                path: result.path,
                date: Date.now()
            };

            saveSettingsDebounced();
            console.log(`[ConfigDB] 聊天记录已保存到服务器: ${id}`);
        } catch (error) {
            console.error('[ConfigDB] 上传聊天记录到服务器失败:', error);
        }
    } else {
        try {
            const imageBuffer = base64ToArrayBuffer(base64Data);
            await dbWriteConfigImage(id, imageBuffer);
            console.log(`[ConfigDB] 聊天记录已保存到 IndexedDB: ${id}`);
        } catch (e) {
            console.error('[ConfigDB] 聊天记录存入 IndexedDB 失败:', e);
        }
    }
}

/**
 * 获取 AI 聊天历史
 * @returns {Promise<Array>} 返回聊天记录数组
 */
export async function getAiChatHistory() {
    const id = 'ai_chat_history';

    // 优先从服务器获取（设置超时，避免手机端网络慢时长时间阻塞）
    const serverStorage = extension_settings[extensionName].configImageStorage || {};
    const serverEntry = serverStorage[id];

    if (serverEntry && serverEntry.path) {
        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 5000); // 5秒超时
            const response = await fetch(serverEntry.path, { signal: controller.signal });
            clearTimeout(timeoutId);
            if (response.ok) {
                const text = await response.text();
                try {
                    // 首先尝试直接解析 (可能后端已经转为二进制原样落盘变成了明文)
                    return JSON.parse(text) || [];
                } catch (e) {
                    // 如果不是 JSON，说明服务端原样把 Base64 字符串存成文件了，我们需要先解码
                    try {
                        const decodedStr = base64ToUtf8(text.trim());
                        return JSON.parse(decodedStr) || [];
                    } catch (err2) {
                        console.warn('[ConfigDB] 服务器端记录JSON解析及Base64解码均失败:', err2);
                    }
                }
            }
        } catch (error) {
            if (error.name === 'AbortError') {
                console.warn('[ConfigDB] 从服务器获取聊天历史超时，回退到 IndexedDB');
            } else {
                console.error('[ConfigDB] 从服务器获取聊天历史失败:', error);
            }
        }
    }

    // 后备：从 IndexedDB 获取
    try {
        const dbEntry = await dbReadConfigImage(id);
        if (dbEntry && dbEntry.data) {
            const base64Data = arrayBufferToBase64(dbEntry.data);
            const jsonString = base64ToUtf8(base64Data);
            return JSON.parse(jsonString) || [];
        }
    } catch (e) {
        console.error('[ConfigDB] 获取 IndexedDB 聊天历史失败:', e);
    }

    return [];
}

/**
 * 清除 AI 聊天历史
 */
export async function clearAiChatHistory() {
    await deleteConfigImage('ai_chat_history');
}

// ===================== 资料库内容存储 =====================

/**
 * 保存资料库内容数据
 * @param {string} baseId 资料库 ID
 * @param {Object} contentObj 内容对象 { baseId, entries: [...] }
 */
export async function saveKnowledgeBaseContent(baseId, contentObj) {
    const id = `kb_content_${baseId}`;
    const jsonString = JSON.stringify(contentObj);
    const base64Data = utf8ToBase64(jsonString);

    if (extension_settings[extensionName].jiuguanchucun === "true") {
        // 存储到酒馆服务器（同 saveAiChatHistory 逻辑）
        try {
            const uploadBody = {
                image: base64Data,
                format: 'png',
                ch_name: 'chatu8_config',
                filename: `${id}.png`
            };
            const response = await fetch('/api/images/upload', {
                method: 'POST',
                headers: getRequestHeaders(window.token),
                body: JSON.stringify(uploadBody)
            });
            if (!response.ok) throw new Error(`Upload failed: ${response.statusText}`);
            const result = await response.json();
            const storage = ensureServerStorage();
            const isNewPath = !storage[id] || storage[id].path !== result.path;
            storage[id] = { path: result.path, date: Date.now() };
            if (isNewPath) saveSettingsDebounced();
            console.log(`[ConfigDB] 资料库内容已保存到服务器: ${id}`);
        } catch (error) {
            console.error('[ConfigDB] 上传资料库内容到服务器失败:', error);
        }
    } else {
        // 存储到 IndexedDB
        try {
            const imageBuffer = base64ToArrayBuffer(base64Data);
            await dbWriteConfigImage(id, imageBuffer);
            console.log(`[ConfigDB] 资料库内容已保存到 IndexedDB: ${id}`);
        } catch (e) {
            console.error('[ConfigDB] 资料库内容存入 IndexedDB 失败:', e);
        }
    }
}

/**
 * 获取资料库内容数据
 * @param {string} baseId 资料库 ID
 * @returns {Promise<Object|null>} 内容对象 { baseId, entries: [...] } 或 null
 */
export async function getKnowledgeBaseContent(baseId) {
    const id = `kb_content_${baseId}`;

    // 优先从服务器获取
    const serverStorage = extension_settings[extensionName].configImageStorage || {};
    const serverEntry = serverStorage[id];

    if (serverEntry && serverEntry.path) {
        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 5000);
            const response = await fetch(serverEntry.path, { signal: controller.signal });
            clearTimeout(timeoutId);
            if (response.ok) {
                const text = await response.text();
                try {
                    return JSON.parse(text) || null;
                } catch (e) {
                    try {
                        const decodedStr = base64ToUtf8(text.trim());
                        return JSON.parse(decodedStr) || null;
                    } catch (err2) {
                        console.warn('[ConfigDB] 资料库内容解析失败:', err2);
                    }
                }
            }
        } catch (error) {
            if (error.name === 'AbortError') {
                console.warn('[ConfigDB] 从服务器获取资料库内容超时，回退到 IndexedDB');
            } else {
                console.error('[ConfigDB] 从服务器获取资料库内容失败:', error);
            }
        }
    }

    // 后备：从 IndexedDB 获取
    try {
        const dbEntry = await dbReadConfigImage(id);
        if (dbEntry && dbEntry.data) {
            const base64Data = arrayBufferToBase64(dbEntry.data);
            const jsonString = base64ToUtf8(base64Data);
            return JSON.parse(jsonString) || null;
        }
    } catch (e) {
        console.error('[ConfigDB] 获取 IndexedDB 资料库内容失败:', e);
    }

    return null;
}

/**
 * 删除资料库内容数据
 * @param {string} baseId 资料库 ID
 */
export async function deleteKnowledgeBaseContent(baseId) {
    await deleteConfigImage(`kb_content_${baseId}`);
}

// ===================== AI 聊天三层分离存储 V2 =====================

/**
 * 生成聊天图片 ID
 * 格式：chatimg_<uuid>
 */
function generateChatImageId() {
    return `chatimg_${generateUUID()}`;
}

/**
 * 内部辅助：保存 JSON 数据（索引层/会话层通用）
 * 复用 saveAiChatHistory 的双存储模式
 * @param {string} storageKey - 存储键名
 * @param {Object} data - 要序列化保存的对象
 */
async function _saveJsonData(storageKey, data) {
    const jsonString = JSON.stringify(data);
    const base64Data = utf8ToBase64(jsonString);

    if (extension_settings[extensionName].jiuguanchucun === "true") {
        try {
            const uploadBody = {
                image: base64Data,
                format: 'png',
                ch_name: 'chatu8_config',
                filename: `${storageKey}.png`
            };

            const response = await fetch('/api/images/upload', {
                method: 'POST',
                headers: getRequestHeaders(window.token),
                body: JSON.stringify(uploadBody)
            });

            if (!response.ok) {
                throw new Error(`Upload failed: ${response.statusText}`);
            }

            const result = await response.json();
            const storage = ensureServerStorage();
            const isNewPath = !storage[storageKey] || storage[storageKey].path !== result.path;
            storage[storageKey] = {
                path: result.path,
                date: Date.now()
            };
            if (isNewPath) saveSettingsDebounced();
            console.log(`[ConfigDB] JSON 数据已保存到服务器: ${storageKey}`);
        } catch (error) {
            console.error(`[ConfigDB] 上传 JSON 数据到服务器失败 (${storageKey}):`, error);
            throw error;
        }
    } else {
        try {
            const imageBuffer = base64ToArrayBuffer(base64Data);
            await dbWriteConfigImage(storageKey, imageBuffer);
            console.log(`[ConfigDB] JSON 数据已保存到 IndexedDB: ${storageKey}`);
        } catch (e) {
            console.error(`[ConfigDB] JSON 数据存入 IndexedDB 失败 (${storageKey}):`, e);
            throw e;
        }
    }
}

/**
 * 内部辅助：读取 JSON 数据（索引层/会话层通用）
 * 复用 getAiChatHistory 的双存储模式
 * @param {string} storageKey - 存储键名
 * @returns {Promise<Object|null>} 解析后的对象或 null
 */
async function _getJsonData(storageKey) {
    // 优先从服务器获取
    const serverStorage = extension_settings[extensionName].configImageStorage || {};
    const serverEntry = serverStorage[storageKey];

    if (serverEntry && serverEntry.path) {
        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 5000);
            const response = await fetch(serverEntry.path, { signal: controller.signal });
            clearTimeout(timeoutId);
            if (response.ok) {
                const text = await response.text();
                try {
                    return JSON.parse(text);
                } catch (e) {
                    try {
                        const decodedStr = base64ToUtf8(text.trim());
                        return JSON.parse(decodedStr);
                    } catch (err2) {
                        console.warn(`[ConfigDB] JSON 数据解析失败 (${storageKey}):`, err2);
                    }
                }
            }
        } catch (error) {
            if (error.name === 'AbortError') {
                console.warn(`[ConfigDB] 从服务器获取数据超时 (${storageKey})，回退到 IndexedDB`);
            } else {
                console.error(`[ConfigDB] 从服务器获取数据失败 (${storageKey}):`, error);
            }
        }
    }

    // 后备：从 IndexedDB 获取
    try {
        const dbEntry = await dbReadConfigImage(storageKey);
        if (dbEntry && dbEntry.data) {
            const base64Data = arrayBufferToBase64(dbEntry.data);
            const jsonString = base64ToUtf8(base64Data);
            return JSON.parse(jsonString);
        }
    } catch (e) {
        console.error(`[ConfigDB] 获取 IndexedDB 数据失败 (${storageKey}):`, e);
    }

    return null;
}

/**
 * 内部辅助：删除存储的数据（索引层/会话层/图片层通用）
 * @param {string} storageKey - 存储键名
 * @returns {Promise<boolean>} 是否删除成功
 */
async function _deleteStorageData(storageKey) {
    return deleteConfigImage(storageKey);
}

// ===== 索引层 API =====

/**
 * 保存聊天索引
 * @param {Object} indexData - 索引数据 { version, activeChatId, chatList }
 */
export async function saveChatIndex(indexData) {
    // 确保版本号
    if (!indexData.version) {
        indexData.version = 2;
    }
    await _saveJsonData('ai_chat_index', indexData);
}

/**
 * 获取聊天索引
 * @returns {Promise<Object|null>} 索引数据 { version, activeChatId, chatList } 或 null
 */
export async function getChatIndex() {
    return await _getJsonData('ai_chat_index');
}

// ===== 会话层 API =====

/**
 * 保存单个会话数据
 * @param {string} chatId - 会话 ID
 * @param {Object} chatData - 会话数据 { id, title, updatedAt, taskData, messages }
 */
export async function saveChatData(chatId, chatData) {
    if (!chatId) {
        throw new Error('[ConfigDB] saveChatData: chatId 不能为空');
    }
    const storageKey = `ai_chat_data_${chatId}`;
    await _saveJsonData(storageKey, chatData);
}

/**
 * 获取单个会话数据
 * @param {string} chatId - 会话 ID
 * @returns {Promise<Object|null>} 会话数据或 null
 */
export async function getChatData(chatId) {
    if (!chatId) return null;
    const storageKey = `ai_chat_data_${chatId}`;
    return await _getJsonData(storageKey);
}

/**
 * 删除单个会话数据
 * @param {string} chatId - 会话 ID
 * @returns {Promise<boolean>} 是否删除成功
 */
export async function deleteChatData(chatId) {
    if (!chatId) return false;
    const storageKey = `ai_chat_data_${chatId}`;
    return await _deleteStorageData(storageKey);
}

export async function saveLogIndex(indexData) {
    if (!indexData.version) {
        indexData.version = 1;
    }
    await _saveJsonData('log_session_index', indexData);
}

export async function getLogIndex() {
    return await _getJsonData('log_session_index');
}

export async function saveLogSessionData(sessionId, sessionData) {
    if (!sessionId) {
        throw new Error('[ConfigDB] saveLogSessionData: sessionId 不能为空');
    }
    const storageKey = `log_session_data_${sessionId}`;
    await _saveJsonData(storageKey, sessionData);
}

export async function getLogSessionData(sessionId) {
    if (!sessionId) return null;
    const storageKey = `log_session_data_${sessionId}`;
    return await _getJsonData(storageKey);
}

export async function deleteLogSessionData(sessionId) {
    if (!sessionId) return false;
    const storageKey = `log_session_data_${sessionId}`;
    return await _deleteStorageData(storageKey);
}

// ===== 图片层 API =====

/**
 * 保存聊天图片
 * 
 * @param {string} imageBase64 - 图片的 Base64 字符串（可带或不带 data:image 前缀）
 * @param {Object} [opts] - 可选参数
 * @param {string} [opts.mimeType='image/png'] - 图片 MIME 类型
 * @param {string} [opts.name=''] - 图片文件名/描述
 * @param {string} [opts.chatId=''] - 所属会话 ID（便于批量清理）
 * @returns {Promise<string>} - 返回图片 ID (chatimg_xxx)
 */
export async function saveChatImage(imageBase64, opts = {}) {
    const { mimeType = 'image/png', name = '', chatId = '' } = opts;
    const id = generateChatImageId();
    const base64Data = imageBase64.split(',')[1] || imageBase64;

    // 从 mimeType 提取格式用于服务器上传
    const format = mimeType.split('/')[1] || 'png';

    if (extension_settings[extensionName].jiuguanchucun === "true") {
        // 存储到服务器
        try {
            const uploadBody = {
                image: base64Data,
                format: format,
                ch_name: 'chatu8_config'
            };
            if (name) {
                uploadBody.filename = name;
            }

            const response = await fetch('/api/images/upload', {
                method: 'POST',
                headers: getRequestHeaders(window.token),
                body: JSON.stringify(uploadBody)
            });

            if (!response.ok) {
                throw new Error(`Upload failed: ${response.statusText}`);
            }

            const result = await response.json();
            const imagePath = result.path;

            // 存储元数据到 extension_settings
            const storage = ensureServerStorage();
            storage[id] = {
                path: imagePath,
                mimeType: mimeType,
                name: name,
                chatId: chatId,
                date: Date.now()
            };

            saveSettingsDebounced();
            console.log(`[ConfigDB] 聊天图片已保存到服务器: ${id}`);
            return id;

        } catch (error) {
            console.error('[ConfigDB] 上传聊天图片到服务器失败:', error);
            throw error;
        }

    } else {
        // 存储到 IndexedDB
        // 注意：dbWriteConfigImage 会将第二参数存入 { id, data: <第二参数>, date } 中
        // 所以我们传入包含元数据的对象，读取时需要解析嵌套结构
        const imageBuffer = base64ToArrayBuffer(base64Data);
        const record = {
            imageData: imageBuffer,
            mimeType: mimeType,
            name: name,
            chatId: chatId,
            createdAt: Date.now()
        };
        await dbWriteConfigImage(id, record);
        console.log(`[ConfigDB] 聊天图片已保存到 IndexedDB: ${id}`);
        return id;
    }
}

/**
 * 获取聊天图片
 * 
 * @param {string} imageId - 图片 ID (chatimg_xxx)
 * @returns {Promise<string|null>} - 返回带 data: 前缀的 Base64 图片字符串，或 null
 */
export async function getChatImage(imageId) {
    if (!imageId) return null;

    // 先检查服务器存储
    const serverStorage = extension_settings[extensionName].configImageStorage || {};
    const serverEntry = serverStorage[imageId];

    if (serverEntry && serverEntry.path) {
        try {
            const response = await fetch(serverEntry.path);
            if (response.ok) {
                const blob = await response.blob();
                const base64 = await blobToBase64(blob);
                return base64;
            }
        } catch (error) {
            console.error(`[ConfigDB] 从服务器获取聊天图片失败 (${imageId}):`, error);
        }
    }

    // 回退到 IndexedDB
    try {
        const dbEntry = await dbReadConfigImage(imageId);
        if (dbEntry && dbEntry.data) {
            // dbWriteConfigImage 存储格式: { id, data: <传入的第二参数>, date }
            // saveChatImage 传入的是对象 { imageData: ArrayBuffer, mimeType, name, chatId, createdAt }
            // 所以 dbEntry.data 是该对象
            const innerData = dbEntry.data;

            if (innerData instanceof ArrayBuffer) {
                // 直接是 ArrayBuffer（兼容旧格式或其他调用方式）
                return `data:image/png;base64,${arrayBufferToBase64(innerData)}`;
            } else if (innerData && innerData.imageData instanceof ArrayBuffer) {
                // 新格式：包含元数据的对象
                const mimeType = innerData.mimeType || 'image/png';
                return `data:${mimeType};base64,${arrayBufferToBase64(innerData.imageData)}`;
            }
        }
    } catch (error) {
        console.error(`[ConfigDB] 从 IndexedDB 获取聊天图片失败 (${imageId}):`, error);
    }

    return null;
}

/**
 * 删除单张聊天图片
 * 
 * @param {string} imageId - 图片 ID (chatimg_xxx)
 * @returns {Promise<boolean>} - 是否删除成功
 */
export async function deleteChatImage(imageId) {
    if (!imageId) return false;
    return await _deleteStorageData(imageId);
}

/**
 * 批量删除某个会话的所有聊天图片
 * 
 * @param {string} chatId - 会话 ID
 * @returns {Promise<number>} - 删除的图片数量
 */
export async function deleteChatImagesByChatId(chatId) {
    if (!chatId) return 0;

    let deletedCount = 0;

    // 1. 删除服务器存储中属于该会话的图片
    const serverStorage = extension_settings[extensionName].configImageStorage || {};
    const serverIdsToDelete = [];

    for (const [id, entry] of Object.entries(serverStorage)) {
        if (id.startsWith('chatimg_') && entry.chatId === chatId) {
            serverIdsToDelete.push(id);
        }
    }

    for (const id of serverIdsToDelete) {
        try {
            const entry = serverStorage[id];
            if (entry && entry.path) {
                await fetch('/api/images/delete', {
                    method: 'POST',
                    headers: getRequestHeaders(window.token),
                    body: JSON.stringify({ path: entry.path })
                });
            }
            delete serverStorage[id];
            deletedCount++;
        } catch (error) {
            console.error(`[ConfigDB] 删除服务器聊天图片失败 (${id}):`, error);
        }
    }

    if (serverIdsToDelete.length > 0) {
        saveSettingsDebounced();
    }

    // 2. 删除 IndexedDB 中属于该会话的图片
    try {
        const db = await openConfigDB();
        const transaction = db.transaction([CONFIG_STORE_NAME], 'readonly');
        const store = transaction.objectStore(CONFIG_STORE_NAME);

        // 获取所有 chatimg_ 开头的记录
        const allKeys = await new Promise((resolve, reject) => {
            const request = store.getAllKeys();
            request.onsuccess = () => resolve(request.result);
            request.onerror = (event) => reject(event.target.error);
        });

        const chatImgKeys = allKeys.filter(key => typeof key === 'string' && key.startsWith('chatimg_'));

        for (const key of chatImgKeys) {
            try {
                // 读取记录检查 chatId
                const entry = await new Promise((resolve, reject) => {
                    const tx = db.transaction([CONFIG_STORE_NAME], 'readonly');
                    const s = tx.objectStore(CONFIG_STORE_NAME);
                    const req = s.get(key);
                    req.onsuccess = () => resolve(req.result);
                    req.onerror = (event) => reject(event.target.error);
                });

                // dbEntry.data 是 { imageData, mimeType, name, chatId, createdAt }
                const innerData = entry && entry.data;
                const entryChatId = innerData && innerData.chatId;

                if (entryChatId === chatId) {
                    await new Promise((resolve, reject) => {
                        const tx = db.transaction([CONFIG_STORE_NAME], 'readwrite');
                        const s = tx.objectStore(CONFIG_STORE_NAME);
                        const req = s.delete(key);
                        req.onsuccess = () => resolve();
                        req.onerror = (event) => reject(event.target.error);
                    });
                    deletedCount++;
                }
            } catch (error) {
                console.error(`[ConfigDB] 删除 IndexedDB 聊天图片失败 (${key}):`, error);
            }
        }
    } catch (error) {
        console.error(`[ConfigDB] 批量删除 IndexedDB 聊天图片失败 (chatId=${chatId}):`, error);
    }

    console.log(`[ConfigDB] 已删除会话 ${chatId} 的 ${deletedCount} 张聊天图片`);
    return deletedCount;
}

/**
 * 批量获取多张聊天图片
 * 
 * @param {string[]} imageIds - 图片 ID 列表
 * @returns {Promise<Object>} - { imageId: base64DataUrl, ... } 获取失败的不包含在内
 */
export async function getChatImagesBatch(imageIds) {
    if (!imageIds || imageIds.length === 0) return {};

    const results = {};

    // 并行获取所有图片
    const promises = imageIds.map(async (imageId) => {
        try {
            const base64 = await getChatImage(imageId);
            if (base64) {
                results[imageId] = base64;
            }
        } catch (error) {
            console.error(`[ConfigDB] 批量获取图片失败 (${imageId}):`, error);
        }
    });

    await Promise.all(promises);
    return results;
}

/**
 * 批量获取多张聊天图片的元数据（name, mimeType, chatId 等）
 * 
 * @param {string[]} imageIds - 图片 ID 列表
 * @returns {Promise<Object>} - { imageId: { name, mimeType, chatId, createdAt }, ... }
 */
export async function getChatImagesMetadataBatch(imageIds) {
    if (!imageIds || imageIds.length === 0) return {};

    const results = {};

    // 并行获取所有图片的元数据
    const promises = imageIds.map(async (imageId) => {
        try {
            // 先检查服务器存储
            const serverStorage = extension_settings[extensionName].configImageStorage || {};
            const serverEntry = serverStorage[imageId];

            if (serverEntry) {
                results[imageId] = {
                    name: serverEntry.name || '',
                    mimeType: serverEntry.mimeType || 'image/png',
                    chatId: serverEntry.chatId || '',
                    createdAt: serverEntry.date || 0
                };
                return;
            }

            // 回退到 IndexedDB
            const dbEntry = await dbReadConfigImage(imageId);
            if (dbEntry && dbEntry.data) {
                const innerData = dbEntry.data;
                if (innerData && typeof innerData === 'object' && innerData.imageData) {
                    results[imageId] = {
                        name: innerData.name || '',
                        mimeType: innerData.mimeType || 'image/png',
                        chatId: innerData.chatId || '',
                        createdAt: innerData.createdAt || dbEntry.date || 0
                    };
                }
            }
        } catch (error) {
            console.error(`[ConfigDB] 批量获取图片元数据失败 (${imageId}):`, error);
        }
    });

    await Promise.all(promises);
    return results;
}

// ===== 迁移 API =====

/**
 * 从旧格式 (V1) 迁移到新的三层分离存储格式 (V2)
 * 
 * V1: 所有会话存储在单一 ai_chat_history 中，图片以 Base64 内嵌
 * V2: 索引层 + 会话层 + 图片层 分离存储
 * 
 * @returns {Promise<{success: boolean, migratedChats: number, migratedImages: number, error?: string}>}
 */
export async function migrateV1ToV2() {
    console.log('[ConfigDB] 开始 V1 → V2 迁移...');

    try {
        // 1. 读取旧数据
        const oldData = await getAiChatHistory();

        if (!oldData || (Array.isArray(oldData) && oldData.length === 0)) {
            console.log('[ConfigDB] 无旧数据需要迁移');
            return { success: true, migratedChats: 0, migratedImages: 0 };
        }

        // 旧数据可能是数组（消息列表，单会话模式）或对象（chatSessions 多会话模式）
        let chatSessions;

        if (Array.isArray(oldData)) {
            // 旧的单会话模式：消息数组 → 包装为单个会话
            const chatId = `chat_${generateUUID()}`;
            chatSessions = {
                activeChatId: chatId,
                chats: {
                    [chatId]: {
                        id: chatId,
                        title: '对话记录',
                        updatedAt: Date.now(),
                        messages: oldData,
                        taskData: null
                    }
                }
            };
        } else if (oldData && oldData.chats) {
            // 多会话模式
            chatSessions = oldData;
        } else {
            console.warn('[ConfigDB] 旧数据格式无法识别，跳过迁移');
            return { success: false, migratedChats: 0, migratedImages: 0, error: '旧数据格式无法识别' };
        }

        let migratedChats = 0;
        let migratedImages = 0;
        const chatList = [];

        // 2. 遍历每个会话
        for (const [chatId, chat] of Object.entries(chatSessions.chats || {})) {
            try {
                const newMessages = [];

                // 3. 遍历每条消息，提取图片
                for (const msg of (chat.messages || [])) {
                    const newMsg = {
                        role: msg.role,
                        content: '',
                        timestamp: msg.timestamp || undefined
                    };

                    const imageRefs = [];
                    // 用于跨 content 和 images 去重的 Base64 指纹集合
                    const processedBase64Set = new Set();

                    // 处理多模态 content（数组格式）
                    if (Array.isArray(msg.content)) {
                        const textParts = [];

                        for (const part of msg.content) {
                            if (part.type === 'text') {
                                textParts.push(part.text || '');
                            } else if (part.type === 'image_url' && part.image_url && part.image_url.url) {
                                const imgUrl = part.image_url.url;
                                if (imgUrl.startsWith('data:')) {
                                    const base64Body = imgUrl.split(',')[1] || '';
                                    const fingerprint = base64Body.substring(0, 100);

                                    if (base64Body && !processedBase64Set.has(fingerprint)) {
                                        processedBase64Set.add(fingerprint);

                                        const mimeMatch = imgUrl.match(/^data:([^;]+);/);
                                        const mimeType = mimeMatch ? mimeMatch[1] : 'image/png';

                                        try {
                                            const imageId = await saveChatImage(imgUrl, {
                                                mimeType: mimeType,
                                                name: `migrated_${migratedImages}`,
                                                chatId: chatId
                                            });
                                            imageRefs.push(imageId);
                                            migratedImages++;
                                        } catch (imgErr) {
                                            console.error(`[ConfigDB] 迁移图片失败:`, imgErr);
                                        }
                                    }
                                }
                            }
                        }

                        newMsg.content = textParts.join('\n');
                    } else {
                        // 纯文本 content
                        newMsg.content = msg.content || '';
                    }

                    // 处理 images 数组（旧格式中的冗余图片数据）
                    if (Array.isArray(msg.images) && msg.images.length > 0) {
                        for (const img of msg.images) {
                            const imgData = img.data || img.url || '';
                            if (imgData && imgData.startsWith('data:')) {
                                const base64Body = imgData.split(',')[1] || '';
                                const fingerprint = base64Body.substring(0, 100);

                                // 使用指纹去重，避免 content 和 images 中的同一张图片被保存两次
                                if (base64Body && !processedBase64Set.has(fingerprint)) {
                                    processedBase64Set.add(fingerprint);

                                    const mimeMatch = imgData.match(/^data:([^;]+);/);
                                    const mimeType = mimeMatch ? mimeMatch[1] : 'image/png';

                                    try {
                                        const imageId = await saveChatImage(imgData, {
                                            mimeType: mimeType,
                                            name: img.name || `migrated_img_${migratedImages}`,
                                            chatId: chatId
                                        });
                                        imageRefs.push(imageId);
                                        migratedImages++;
                                    } catch (imgErr) {
                                        console.error(`[ConfigDB] 迁移 images[] 图片失败:`, imgErr);
                                    }
                                }
                            }
                        }
                    }

                    if (imageRefs.length > 0) {
                        newMsg.imageRefs = imageRefs;
                    }

                    newMessages.push(newMsg);
                }

                // 4. 保存新格式的会话数据
                const chatData = {
                    id: chatId,
                    title: chat.title || '未命名对话',
                    updatedAt: chat.updatedAt || Date.now(),
                    taskData: chat.taskData || null,
                    messages: newMessages
                };

                await saveChatData(chatId, chatData);
                migratedChats++;

                // 5. 记录索引条目
                chatList.push({
                    id: chatId,
                    title: chatData.title,
                    updatedAt: chatData.updatedAt,
                    messageCount: newMessages.length
                });

            } catch (chatErr) {
                console.error(`[ConfigDB] 迁移会话 ${chatId} 失败:`, chatErr);
            }
        }

        // 6. 按 updatedAt 排序索引
        chatList.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));

        // 7. 保存索引
        const indexData = {
            version: 2,
            activeChatId: chatSessions.activeChatId || (chatList.length > 0 ? chatList[0].id : null),
            chatList: chatList
        };

        await saveChatIndex(indexData);

        // 8. 迁移成功后删除旧数据
        try {
            await clearAiChatHistory();
            console.log('[ConfigDB] 旧数据 ai_chat_history 已清除');
        } catch (delErr) {
            console.warn('[ConfigDB] 清除旧数据失败（非致命）:', delErr);
        }

        console.log(`[ConfigDB] V1 → V2 迁移完成: ${migratedChats} 个会话, ${migratedImages} 张图片`);
        return { success: true, migratedChats, migratedImages };

    } catch (error) {
        console.error('[ConfigDB] V1 → V2 迁移失败:', error);
        return { success: false, migratedChats: 0, migratedImages: 0, error: error.message };
    }
}

// ===================== ComfyUI/SD Cache 存储 API =====================

/**
 * 保存 ComfyUI Cache 数据
 * @param {string} cacheKey - cache 键名（如 'models', 'objectinfo'）
 * @param {any} data - 要保存的数据
 */
export async function saveComfyuiCache(cacheKey, data) {
    const storageKey = `comfyui_cache_${cacheKey}`;
    await _saveJsonData(storageKey, data);
}

/**
 * 获取 ComfyUI Cache 数据
 * @param {string} cacheKey - cache 键名
 * @returns {Promise<any|null>}
 */
export async function getComfyuiCache(cacheKey) {
    const storageKey = `comfyui_cache_${cacheKey}`;
    return await _getJsonData(storageKey);
}

/**
 * 保存 SD Cache 数据
 * @param {string} cacheKey - cache 键名
 * @param {any} data - 要保存的数据
 */
export async function saveSdCache(cacheKey, data) {
    const storageKey = `sd_cache_${cacheKey}`;
    await _saveJsonData(storageKey, data);
}

/**
 * 获取 SD Cache 数据
 * @param {string} cacheKey - cache 键名
 * @returns {Promise<any|null>}
 */
export async function getSdCache(cacheKey) {
    const storageKey = `sd_cache_${cacheKey}`;
    return await _getJsonData(storageKey);
}

/**
 * 获取完整的 ComfyUI Cache 对象
 * @returns {Promise<Object>}
 */
export async function getFullComfyuiCache() {
    const keys = ['models', 'samplers', 'vaes', 'schedulers', 'loras', 'clips', 'objectinfo'];
    const cache = {};

    await Promise.all(keys.map(async (key) => {
        const data = await getComfyuiCache(key);
        if (data !== null) {
            // 特殊处理：clips 在 settings 中是 CLIPs（大写）
            const settingsKey = key === 'clips' ? 'CLIPs' : key;
            // objectinfo 在 settings 中是 objectInfo（驼峰）
            const finalKey = key === 'objectinfo' ? 'objectInfo' : settingsKey;
            cache[finalKey] = data;
        }
    }));

    return cache;
}

/**
 * 获取完整的 SD Cache 对象
 * @returns {Promise<Object>}
 */
export async function getFullSdCache() {
    const keys = ['models', 'samplers', 'vaes', 'schedulers', 'upscalers', 'loras'];
    const cache = {};

    await Promise.all(keys.map(async (key) => {
        const data = await getSdCache(key);
        if (data !== null) {
            cache[key] = data;
        }
    }));

    return cache;
}

/**
 * 保存完整的 ComfyUI Cache 对象
 * @param {Object} cacheObj - 完整的 cache 对象
 */
export async function saveFullComfyuiCache(cacheObj) {
    const keyMap = {
        'models': 'models',
        'samplers': 'samplers',
        'vaes': 'vaes',
        'schedulers': 'schedulers',
        'loras': 'loras',
        'CLIPs': 'clips',
        'objectInfo': 'objectinfo'
    };

    await Promise.all(Object.entries(keyMap).map(async ([settingsKey, storageKey]) => {
        if (cacheObj[settingsKey] !== undefined) {
            await saveComfyuiCache(storageKey, cacheObj[settingsKey]);
        }
    }));
}

/**
 * 保存完整的 SD Cache 对象
 * @param {Object} cacheObj - 完整的 cache 对象
 */
export async function saveFullSdCache(cacheObj) {
    const keys = ['models', 'samplers', 'vaes', 'schedulers', 'upscalers', 'loras'];

    await Promise.all(keys.map(async (key) => {
        if (cacheObj[key] !== undefined) {
            await saveSdCache(key, cacheObj[key]);
        }
    }));
}

/**
 * 从 settings.json 迁移 cache 数据到 configDatabase
 * @returns {Promise<{success: boolean, migratedComfyui: boolean, migratedSd: boolean}>}
 */
export async function migrateCacheToDatabase() {
    console.log('[ConfigDB] 开始 Cache 迁移...');

    const settings = extension_settings[extensionName];
    let migratedComfyui = false;
    let migratedSd = false;

    try {
        // 迁移 ComfyUI Cache
        if (settings.comfyuiCache && Object.keys(settings.comfyuiCache).length > 0) {
            console.log('[ConfigDB] 检测到 comfyuiCache，开始迁移...');
            await saveFullComfyuiCache(settings.comfyuiCache);

            // 删除旧数据
            delete settings.comfyuiCache;
            migratedComfyui = true;
            console.log('[ConfigDB] comfyuiCache 迁移完成');
        }

        // 迁移 SD Cache
        if (settings.sdCache && Object.keys(settings.sdCache).length > 0) {
            console.log('[ConfigDB] 检测到 sdCache，开始迁移...');
            await saveFullSdCache(settings.sdCache);

            // 删除旧数据
            delete settings.sdCache;
            migratedSd = true;
            console.log('[ConfigDB] sdCache 迁移完成');
        }

        // 标记迁移完成
        if (migratedComfyui || migratedSd) {
            settings.cacheStorageMigrated = true;
            saveSettingsDebounced();
            console.log('[ConfigDB] Cache 迁移完成');
        }

        return { success: true, migratedComfyui, migratedSd };

    } catch (error) {
        console.error('[ConfigDB] Cache 迁移失败:', error);
        return { success: false, migratedComfyui: false, migratedSd: false };
    }
}
