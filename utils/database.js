// @ts-nocheck
import { extension_settings } from "../../../../extensions.js";
import { extensionName } from './config.js';
import { saveSettingsDebounced } from "../../../../../script.js";
import { getRequestHeaders } from './utils.js';
import { ImageSteganography } from './steganography.js';


const objectStoreName = 'tupianhuancun';
const metadataId = 'tupianshuju';

let db;

// --- 辅助函数 ---
// Base64 to ArrayBuffer
function base64ToArrayBuffer(base64) {
    const binaryString = window.atob(base64);
    const len = binaryString.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
        bytes[i] = binaryString.charCodeAt(i);
    }
    return bytes.buffer;
}

// ArrayBuffer to Base64
function arrayBufferToBase64(buffer) {
    let binary = '';
    const bytes = new Uint8Array(buffer);
    const len = bytes.byteLength;
    for (let i = 0; i < len; i++) {
        binary += String.fromCharCode(bytes[i]);
    }
    return window.btoa(binary);
}

/**
 * 将 Blob 转换为 Base64
 * @param {Blob} blob 
 * @returns {Promise<string>}
 */
function blobToBase64(blob) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result);
        reader.onerror = reject;
        reader.readAsDataURL(blob);
    });
}

// UUID 生成器
function generateUUID() {
    if (crypto && crypto.randomUUID) {
        return crypto.randomUUID();
    }
    // Fallback for older environments
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
        var r = Math.random() * 16 | 0, v = c == 'x' ? r : (r & 0x3 | 0x8);
        return v.toString(16);
    });
}

// --- 新增辅助函数 ---

/**
 * 合并并按时间排序两端存储的图片数据
 * @param {string} md5 - 图片的 md5
 * @returns {Promise<{images: Array, currentIndex: number, hasServer: boolean, hasDB: boolean}>}
 */
async function getMergedAndSortedImages(md5) {
    const result = {
        images: [],
        currentIndex: 0,
        hasServer: false,
        hasDB: false
    };

    // 1. 获取服务器存储的图片
    const storage = extension_settings[extensionName].jiuguanStorage || {};
    const serverEntry = storage[md5];

    let serverIndex = 0;

    // let serverCurrentUUID = null;
    if (serverEntry && Array.isArray(serverEntry.images) && serverEntry.images.length > 0) {
        result.hasServer = true;
        serverIndex = serverEntry.index || 0;
        // 记录服务器当前选中的图片 UUID
        // if (serverIndex >= 0 && serverIndex < serverEntry.images.length) {
        //     serverCurrentUUID = serverEntry.images[serverIndex].uuid;
        // }
        serverEntry.images.forEach(img => {
            result.images.push({
                ...img,
                source: 'server',
                date: img.date || 0
            });
        });
    }

    // 2. 获取 IndexedDB 的图片
    const metadata = await getMetadata();
    const dbEntry = metadata[md5];

    let dbCurrentUUID = null;
    if (dbEntry && Array.isArray(dbEntry.images) && dbEntry.images.length > 0) {
        result.hasDB = true;

        if (serverIndex == 0) {
            serverIndex = dbEntry.index;
        }
        // 记录 DB 当前选中的图片 UUID
        dbEntry.images.forEach(img => {
            result.images.push({
                ...img,
                source: 'db',
                date: img.date || 0
            });
        });
    }

    // 3. 按时间排序（从旧到新）
    result.images.sort((a, b) => a.date - b.date);

    // 4. 确定当前应该选中的图片在合并数组中的索引
    // 优先使用 jiuguanStorage 的选择
    // const targetUUID = serverCurrentUUID || dbCurrentUUID;

    result.currentIndex = serverIndex;


    return result;
}

/**
 * 修正并同步 index 到两端存储
 * @param {string} md5 - 图片的 md5
 * @param {number} globalIndex - 合并排序后数组中的索引
 * @param {Array} sortedImages - 已排序的图片数组
 */
async function syncIndexToStorage(md5, globalIndex, sortedImages) {
    // 修正 globalIndex 范围
    let correctedIndex = globalIndex;
    if (correctedIndex < 0) correctedIndex = 0;
    if (correctedIndex >= sortedImages.length) correctedIndex = sortedImages.length - 1;

    let jiuguanStorageModified = false;

    // 更新服务器存储
    const storage = extension_settings[extensionName].jiuguanStorage;
    if (storage && storage[md5]) {
        // 只有当索引实际发生变化时才更新
        if (storage[md5].index !== correctedIndex) {
            storage[md5].index = correctedIndex;
            saveSettingsDebounced();
            jiuguanStorageModified = true;
        }
    }

    // 更新 IndexedDB
    const metadata = await getMetadata();
    if (metadata[md5]) {
        // 只有当索引实际发生变化时才更新
        if (metadata[md5].index !== correctedIndex) {
            metadata[md5].index = correctedIndex;
            await setMetadata(metadata);
        }
    }

    // 只有当 jiuguanStorage 被修改时才更新隐写图片
    if (jiuguanStorageModified) {
        await updateStegoImage();
    }

    return correctedIndex;
}

/**
 * 从 ArrayBuffer 创建缩略图 Blob
 * @param {ArrayBuffer} buffer - 图片的 ArrayBuffer
 * @param {number} [maxWidth=256] - 缩略图最大宽度
 * @param {number} [maxHeight=256] - 缩略图最大高度
 * @returns {Promise<Blob>}
 */
function createThumbnailFromBuffer(buffer, maxWidth = 256, maxHeight = 256) {
    return new Promise((resolve, reject) => {
        const blob = new Blob([buffer]);
        const img = new Image();
        const url = URL.createObjectURL(blob);

        img.onload = () => {
            URL.revokeObjectURL(url); // 释放内存
            const canvas = document.createElement('canvas');
            const ctx = canvas.getContext('2d');

            let width = img.width;
            let height = img.height;

            if (width > height) {
                if (width > maxWidth) {
                    height *= maxWidth / width;
                    width = maxWidth;
                }
            } else {
                if (height > maxHeight) {
                    width *= maxHeight / height;
                    height = maxHeight;
                }
            }

            canvas.width = width;
            canvas.height = height;
            ctx.drawImage(img, 0, 0, width, height);

            canvas.toBlob(thumbnailBlob => {
                if (thumbnailBlob) {
                    resolve(thumbnailBlob);
                } else {
                    reject(new Error('Canvas to Blob conversion failed for thumbnail.'));
                }
            }, 'image/jpeg', 0.85);
        };
        img.onerror = (err) => {
            URL.revokeObjectURL(url);
            reject(err);
        };
        img.src = url;
    });
}

/**
 * 生成默认的视频占位图缩略图
 * 当无法从视频提取帧时使用
 * @param {number} [width=256] - 缩略图宽度
 * @param {number} [height=256] - 缩略图高度
 * @returns {Promise<Blob>}
 */
function createDefaultVideoThumbnail(width = 256, height = 256) {
    return new Promise((resolve, reject) => {
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');

        // 绘制深色背景
        ctx.fillStyle = '#1a1a2e';
        ctx.fillRect(0, 0, width, height);

        // 绘制渐变背景
        const gradient = ctx.createRadialGradient(width / 2, height / 2, 0, width / 2, height / 2, width / 2);
        gradient.addColorStop(0, '#16213e');
        gradient.addColorStop(1, '#0f0f23');
        ctx.fillStyle = gradient;
        ctx.fillRect(0, 0, width, height);

        // 绘制播放按钮圆形背景
        const centerX = width / 2;
        const centerY = height / 2;
        const circleRadius = Math.min(width, height) * 0.3;

        ctx.beginPath();
        ctx.arc(centerX, centerY, circleRadius, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(255, 255, 255, 0.2)';
        ctx.fill();

        // 绘制播放三角形
        const triangleSize = circleRadius * 0.6;
        ctx.beginPath();
        ctx.moveTo(centerX - triangleSize * 0.4, centerY - triangleSize * 0.6);
        ctx.lineTo(centerX - triangleSize * 0.4, centerY + triangleSize * 0.6);
        ctx.lineTo(centerX + triangleSize * 0.6, centerY);
        ctx.closePath();
        ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
        ctx.fill();

        // 添加 "VIDEO" 文字标识
        ctx.font = `bold ${Math.floor(width * 0.1)}px Arial`;
        ctx.fillStyle = 'rgba(255, 255, 255, 0.5)';
        ctx.textAlign = 'center';
        ctx.fillText('VIDEO', centerX, height - 10);

        canvas.toBlob(blob => {
            if (blob) {
                console.log('[DB] Default video thumbnail created successfully');
                resolve(blob);
            } else {
                reject(new Error('Failed to create default video thumbnail'));
            }
        }, 'image/jpeg', 0.85);
    });
}

/**
 * 从视频 data URL 提取第一帧作为缩略图
 * 如果提取失败，会自动生成默认的视频占位图
 * @param {string} videoDataUrl - 视频的 data URL
 * @param {number} [maxWidth=256] - 缩略图最大宽度
 * @param {number} [maxHeight=256] - 缩略图最大高度
 * @returns {Promise<Blob>}
 */
async function createThumbnailFromVideo(videoDataUrl, maxWidth = 256, maxHeight = 256) {
    try {
        // 尝试从视频提取帧
        const thumbnailBlob = await extractVideoFrame(videoDataUrl, maxWidth, maxHeight);
        return thumbnailBlob;
    } catch (error) {
        console.warn('[DB] 无法从视频提取缩略图，使用默认占位图:', error.message);
        // 生成并返回默认的视频占位图
        return await createDefaultVideoThumbnail(maxWidth, maxHeight);
    }
}

/**
 * 尝试从视频提取帧（内部函数）
 * @param {string} videoDataUrl - 视频的 data URL
 * @param {number} maxWidth - 最大宽度
 * @param {number} maxHeight - 最大高度
 * @returns {Promise<Blob>}
 */
function extractVideoFrame(videoDataUrl, maxWidth, maxHeight) {
    // 修正非标准 MIME 类型的 data URL
    const correctedDataUrl = correctVideoMimeType(videoDataUrl);

    return new Promise((resolve, reject) => {
        const video = document.createElement('video');
        video.muted = true;
        video.playsInline = true;
        video.preload = 'auto';
        video.crossOrigin = 'anonymous';

        let resolved = false;
        let timeoutId = null;

        const cleanup = () => {
            if (timeoutId) {
                clearTimeout(timeoutId);
                timeoutId = null;
            }
            // 移除事件处理器，避免在清理时触发额外的错误
            video.onloadeddata = null;
            video.onseeked = null;
            video.onerror = null;
            // 暂停视频并释放资源
            video.pause();
            video.src = '';
            video.removeAttribute('src');
        };

        const captureFrame = () => {
            if (resolved) return;

            try {
                const canvas = document.createElement('canvas');
                const ctx = canvas.getContext('2d');

                let width = video.videoWidth || 256;
                let height = video.videoHeight || 256;

                // 缩放逻辑
                if (width > height) {
                    if (width > maxWidth) {
                        height *= maxWidth / width;
                        width = maxWidth;
                    }
                } else {
                    if (height > maxHeight) {
                        width *= maxHeight / height;
                        height = maxHeight;
                    }
                }

                canvas.width = width;
                canvas.height = height;
                ctx.drawImage(video, 0, 0, width, height);

                canvas.toBlob(thumbnailBlob => {
                    cleanup();
                    resolved = true;
                    if (thumbnailBlob && thumbnailBlob.size > 0) {
                        console.log('[DB] Video thumbnail captured successfully');
                        resolve(thumbnailBlob);
                    } else {
                        reject(new Error('Canvas to Blob conversion failed for video thumbnail.'));
                    }
                }, 'image/jpeg', 0.85);
            } catch (err) {
                cleanup();
                resolved = true;
                reject(err);
            }
        };

        video.onloadeddata = () => {
            console.log('[DB] Video loaded, attempting to seek...');
            try {
                // 尝试跳转到稍后的帧避免黑帧
                const targetTime = Math.min(0.5, video.duration / 4);
                video.currentTime = targetTime;
            } catch (e) {
                // 如果无法 seek，直接捕获当前帧
                console.log('[DB] Cannot seek, capturing current frame');
                captureFrame();
            }
        };

        video.onseeked = () => {
            console.log('[DB] Video seeked, capturing frame...');
            captureFrame();
        };

        video.onerror = (err) => {
            console.error('[DB] Video load error:', err);
            cleanup();
            if (!resolved) {
                resolved = true;
                reject(new Error('Video load failed'));
            }
        };

        // 设置更短的超时时间（3秒），快速失败并使用默认图
        timeoutId = setTimeout(() => {
            console.warn('[DB] Video thumbnail extraction timeout');
            if (!resolved) {
                cleanup();
                resolved = true;
                reject(new Error('Video thumbnail extraction timeout.'));
            }
        }, 3000);

        video.src = correctedDataUrl;
        video.load();
    });
}

/**
 * 修正视频 data URL 中的非标准 MIME 类型
 * 将 video/h264-mp4 等非标准格式转换为 video/mp4
 * @param {string} dataUrl - 视频的 data URL
 * @returns {string} - 修正后的 data URL
 */
function correctVideoMimeType(dataUrl) {
    if (!dataUrl || !dataUrl.startsWith('data:')) {
        return dataUrl;
    }

    // 提取 MIME 类型部分
    const commaIndex = dataUrl.indexOf(',');
    if (commaIndex === -1) {
        return dataUrl;
    }

    const header = dataUrl.substring(5, commaIndex); // 去掉 'data:' 前缀
    const base64Data = dataUrl.substring(commaIndex + 1);

    // 检查是否包含非标准视频 MIME 类型
    let correctedMimeType = null;
    if (header.includes('video/h264-mp4') || header.includes('video/h264')) {
        correctedMimeType = 'video/mp4';
    } else if (header.includes('video/') && !header.includes('video/mp4') && !header.includes('video/webm') && !header.includes('video/ogg')) {
        // 其他非标准视频格式，尝试使用 mp4
        if (header.includes('mp4')) {
            correctedMimeType = 'video/mp4';
        } else if (header.includes('webm')) {
            correctedMimeType = 'video/webm';
        } else {
            // 默认尝试 mp4
            correctedMimeType = 'video/mp4';
        }
    }

    if (correctedMimeType) {
        // 保留 base64 标记
        const hasBase64 = header.includes(';base64');
        const newHeader = hasBase64 ? `${correctedMimeType};base64` : correctedMimeType;
        console.log(`[DB] 修正视频 MIME 类型: ${header} -> ${newHeader}`);
        return `data:${newHeader},${base64Data}`;
    }

    return dataUrl;
}


// --- 数据库核心操作 ---

/**
 * 迁移旧版 chatu8 油猴脚本的设置
 */
export async function migrateOldSettings() {

    if (window.chatu8_old_settings) {
        alert('[Settings Migration] 检测到旧版 chatu8 设置，开始迁移...');
        try {
            const oldSettings = window.chatu8_old_settings;

            // 1. 提取需要的设置
            const { yushe, novelaiApi, startTag, endTag, workers } = oldSettings;

            // 2. 重命名 yushe 和 workers 中的键
            const newYushe = {};
            if (yushe && typeof yushe === 'object') {
                for (const key in yushe) {
                    if (Object.hasOwnProperty.call(yushe, key)) {
                        newYushe[`old-${key}`] = yushe[key];
                    }
                }
            }

            const newWorkers = {};
            if (workers && typeof workers === 'object') {
                for (const key in workers) {
                    if (Object.hasOwnProperty.call(workers, key)) {
                        newWorkers[`old-${key}`] = workers[key];
                    }
                }
            }
            console.log(newWorkers)

            // 3. 合并到新插件的设置中
            // 我们只更新在旧设置中存在的值
            if (Object.keys(newYushe).length > 0) {
                Object.assign(extension_settings[extensionName].yushe, newYushe);
            }
            if (Object.keys(newWorkers).length > 0) {
                Object.assign(extension_settings[extensionName].workers, newWorkers);
            }
            if (novelaiApi) {
                extension_settings[extensionName].novelaiApi = novelaiApi;
            }
            if (startTag) {
                extension_settings[extensionName].startTag = startTag;
            }
            if (endTag) {
                extension_settings[extensionName].endTag = endTag;
            }

            // 4. 保存设置
            saveSettingsDebounced();

            // 5. 设置迁移完成标志
            localStorage.setItem(migrationFlag, 'true');

            alert('成功从旧版 chatu8 脚本迁移了设置！\n预设和工作流已被重命名，格式为 "old-名称" 以避免冲突。');
            console.log('[Settings Migration] 设置迁移成功！', {
                yushe: newYushe,
                workers: newWorkers,
                novelaiApi,
                startTag,
                endTag
            });

        } catch (error) {
            console.error('[Settings Migration] 迁移设置时发生错误:', error);
            alert('迁移旧版 chatu8 设置失败，请查看控制台了解详情。');
            // 即使失败也设置标志，防止重复弹窗
            localStorage.setItem(migrationFlag, 'true');
        }
    } else {
        // console.log('[Settings Migration] 未检测到旧版 chatu8 设置。');
        // 即使没检测到，也标记为完成，避免每次都检查
        localStorage.setItem(migrationFlag, 'true');
    }
}


const oldDbName = 'tupian';
const dbName = 'chatu8_gallery'; // 新数据库名
const dbVersion = 6; // 新数据库版本
const migrationFlag = 'chatu8_gallery_migration_v1_done';
const migrationDecisionKey = 'chatu8_migration_user_decision'; // 新增，用于在旧数据库中记录用户决定

/**
 * 为分批迁移处理数据。
 * @param {Array} batchData - 从旧数据库读取的一批条目。
 * @param {Object} oldMetadata - 从旧元数据记录解析的完整元数据对象。
 * @param {Array<string>} existingMd5s - 新数据库中已存在的 MD5 列表。
 * @returns {{items: Array, metadataFragment: Object}} - 返回包含图片实体和元数据片段的对象。
 */
function processMigrationDataForBatch(batchData, oldMetadata, existingMd5s = []) {
    const items = [];
    const metadataFragment = {};

    for (const item of batchData) {
        // 只处理 pre-v7 格式的图片数据 (ID 为 32 位 MD5)
        if (item.id.length === 32 && item.id !== metadataId && item.tupian) {
            const md5 = item.id;

            if (existingMd5s.includes(md5)) {
                continue; // 跳过已存在的图片
            }

            let imageBuffer;
            if (typeof item.tupian === 'string') {
                const base64Data = item.tupian.split(',')[1] || item.tupian;
                imageBuffer = base64ToArrayBuffer(base64Data);
            } else {
                imageBuffer = item.tupian; // 假定已经是 ArrayBuffer
            }

            const uuid = generateUUID();
            const date = (oldMetadata[md5] && oldMetadata[md5][0]) || new Date().getTime();

            items.push({ id: uuid, data: imageBuffer });

            if (!metadataFragment[md5]) {
                metadataFragment[md5] = {
                    images: [],
                    index: 0,
                    change: ''
                };
            }
            metadataFragment[md5].images.push({
                uuid: uuid,
                thumbnail_uuid: null, // 缩略图将在之后生成
                date: date
            });
        }
    }
    return { items, metadataFragment };
}


/**
 * [重构后] 执行从旧数据库到新数据库的一次性迁移（分批处理模式）。
 * 这个版本修复了内存问题，确保了真正的分批处理。
 */
async function performMigration() {
    console.log('[DB Migration] 开始数据库迁移 (分批模式)...');
    let oldDb;
    const batchSize = 50; // 可以适当调整批次大小

    try {
        const dbs = await indexedDB.databases();
        if (!dbs.some(db => db.name === oldDbName)) {
            console.log('[DB Migration] 未找到旧数据库。跳过迁移。');
            alert('未找到旧版图库数据，无需迁移。');
            localStorage.setItem(migrationFlag, 'true');
            return;
        }

        console.log('[DB Migration] 发现旧数据库，正在准备迁移...');
        oldDb = await new Promise((resolve, reject) => {
            const request = indexedDB.open(oldDbName);
            request.onsuccess = e => resolve(e.target.result);
            request.onerror = e => reject(e.target.error);
        });

        if (!oldDb.objectStoreNames.contains(objectStoreName)) {
            console.log('[DB Migration] 旧数据库中没有数据可迁移。');
            oldDb.close();
            localStorage.setItem(migrationFlag, 'true');
            if (confirm('旧数据库为空，是否删除它以清理空间？')) {
                await indexedDB.deleteDatabase(oldDbName);
            }
            return;
        }

        // 1. 预先读取新旧数据库的元数据和键
        const newDb = await openDB();
        const oldTransaction = oldDb.transaction(objectStoreName, 'readonly');
        const oldStore = oldTransaction.objectStore(objectStoreName);

        const [oldMetadataRecord, totalCount] = await Promise.all([
            new Promise((resolve, reject) => {
                const getRequest = oldStore.get(metadataId);
                getRequest.onsuccess = e => resolve(e.target.result);
                getRequest.onerror = e => reject(e.target.error);
            }),
            new Promise((resolve, reject) => {
                const countRequest = oldStore.count();
                countRequest.onsuccess = e => resolve(e.target.result);
                countRequest.onerror = e => reject(e.target.error);
            })
        ]);

        const oldMetadata = oldMetadataRecord ? JSON.parse(oldMetadataRecord.shuju) : {};

        const existingMetadataRecord = await storeReadOnly(metadataId);
        const finalMetadata = existingMetadataRecord ? JSON.parse(existingMetadataRecord.shuju) : {};
        const existingMd5s = Object.keys(finalMetadata);
        console.log(`[DB Migration] 在新数据库中找到 ${existingMd5s.length} 个已存在的 MD5。`);

        if (totalCount === 0 || (totalCount - 1) <= existingMd5s.length) { // -1 for metadata entry
            console.log('[DB Migration] 旧数据库为空或没有新数据。');
            oldDb.close();
            localStorage.setItem(migrationFlag, 'true');
            if (confirm('旧数据库为空或没有新数据，是否删除它？')) {
                await indexedDB.deleteDatabase(oldDbName);
            }
            return;
        }

        // 2. 使用游标分批处理 (重构后的核心逻辑)
        console.log(`[DB Migration] 旧数据库总项目数: ${totalCount}。开始迁移...`);
        let processedCount = 0;
        let totalMigratedImages = 0;

        const cursorTransaction = oldDb.transaction(objectStoreName, 'readonly');
        const cursorStore = cursorTransaction.objectStore(objectStoreName);
        const request = cursorStore.openCursor();
        let batchData = [];

        // 这是一个辅助函数，用于处理并写入一个批次的数据
        const handleBatchAndWrite = async (batch) => {
            if (batch.length === 0) return;

            const { items, metadataFragment } = processMigrationDataForBatch(batch, oldMetadata, existingMd5s);

            if (items.length > 0) {
                const newTransaction = newDb.transaction(objectStoreName, 'readwrite');
                const newStore = newTransaction.objectStore(objectStoreName);
                items.forEach(item => newStore.put(item));

                await new Promise((resolve, reject) => {
                    newTransaction.oncomplete = resolve;
                    newTransaction.onerror = e => reject(e.target.error);
                });

                Object.assign(finalMetadata, metadataFragment);
                totalMigratedImages += items.length;
            }
            processedCount += batch.length;
            console.log(`[DB Migration] 已处理 ${processedCount}/${totalCount}...`);
        };

        await new Promise((resolve, reject) => {
            request.onerror = e => reject(e.target.error);
            request.onsuccess = async (e) => {
                const cursor = e.target.result;
                if (cursor) {
                    // 过滤掉元数据本身
                    if (cursor.value && cursor.value.id !== metadataId) {
                        batchData.push(cursor.value);
                    }

                    if (batchData.length >= batchSize) {
                        try {
                            await handleBatchAndWrite(batchData);
                            batchData = []; // 清空批次
                        } catch (err) {
                            reject(err);
                            return;
                        }
                    }
                    cursor.continue();
                } else {
                    // 游标结束，处理最后一个批次
                    try {
                        if (batchData.length > 0) {
                            await handleBatchAndWrite(batchData);
                        }
                        resolve();
                    } catch (err) {
                        reject(err);
                    }
                }
            };
        });

        oldDb.close();

        // 3. 如果有迁移，则最后统一写入元数据
        if (totalMigratedImages > 0) {
            console.log(`[DB Migration] 迁移完成！总共迁移了 ${totalMigratedImages} 张新图片。正在更新最终元数据...`);
            await setMetadata(finalMetadata);
        } else {
            console.log('[DB Migration] 没有发现可迁移的新图片。');
        }

        // 4. 迁移后操作
        localStorage.setItem(migrationFlag, 'true');
        if (confirm(
            `数据迁移完成！共迁移 ${totalMigratedImages} 张新图片。\n\n` +
            '是否删除旧的数据库以释放磁盘空间？\n\n' +
            '- 删除后不可恢复。\n' +
            '- 如果不确定，可以选择“取消”。'
        )) {
            await indexedDB.deleteDatabase(oldDbName);
            console.log('[DB Migration] 旧数据库已删除。');
        } else {
            console.log('[DB Migration] 用户选择保留旧数据库。');
        }

        if (totalMigratedImages > 0 && confirm('是否为新迁移的图片生成缩略图？(推荐)')) {
            console.log('[DB Migration] 开始生成缩略图...');
            await generateMissingThumbnails();
        }

        console.log('[DB Migration] 数据库迁移流程完成。');

    } catch (error) {
        console.error('[DB Migration] 数据库迁移过程中发生错误:', error);
        alert(`数据库迁移失败: ${error.message}\n\n请检查控制台获取详细信息。`);
        if (oldDb) oldDb.close();
        localStorage.setItem(migrationFlag, 'true'); // 防止无限循环
    }
}

/**
 * 3. 获取图片 (使用合并排序逻辑)
 * @param {string} tag - 图片标签
 * @param {number | null} [index=null] - 可选，要获取的图片索引（按时间排序后的序号）。如果为 null，则返回当前索引的图片。
 * @returns {Promise<[string|false, string|false, number|false, boolean]>} - 返回 [base64图片, change数据, 索引, isVideo] 或 [false, false, false, false]
 */
export async function getItemImg(tag, index = null) {
    const md5 = CryptoJS.MD5(tag).toString();

    // 使用合并排序逻辑获取所有图片
    const merged = await getMergedAndSortedImages(md5);

    if (merged.images.length === 0) {
        return [false, false, false, false];
    }

    console.log(`[DB] 获取图片 ${tag}...`, merged.currentIndex);

    // 确定最终 index（基于合并排序后的数组）
    let finalIndex = index;
    if (finalIndex === null || finalIndex === undefined) {
        // 使用当前记录的索引（已经是合并数组中的位置，优先 jiuguanStorage）
        finalIndex = merged.currentIndex;
    }

    // 修正 index 溢出
    if (finalIndex < 0) finalIndex = 0;
    if (finalIndex >= merged.images.length) finalIndex = merged.images.length - 1;

    // 同步 index 到两端存储（将合并数组的索引转换为各自存储的索引）
    await syncIndexToStorage(md5, finalIndex, merged.images);

    const imageEntry = merged.images[finalIndex];
    if (!imageEntry) return [false, false, false, false];

    // 获取 isVideo 标志和 originalUrl
    const isVideo = imageEntry.isVideo || false;
    const originalUrl = imageEntry.originalUrl || '';

    // 获取 change 数据 (优先从服务器获取)
    const storage = extension_settings[extensionName].jiuguanStorage || {};
    const serverEntry = storage[md5];
    const metadata = await getMetadata();
    const dbEntry = metadata[md5];
    const change = (serverEntry && serverEntry.change) || (dbEntry && dbEntry.change) || '';

    // 根据来源获取图片/视频
    if (imageEntry.source === 'server' && imageEntry.path) {
        try {
            const response = await fetch(imageEntry.path);
            if (response.ok) {
                const blob = await response.blob();
                const base64 = await blobToBase64(blob);
                return [base64, change, finalIndex, isVideo, originalUrl];
            }
        } catch (error) {
            console.error('Failed to fetch image from server:', error);
        }
    } else if (imageEntry.source === 'db' && imageEntry.uuid) {
        const imageData = await storeReadOnly(imageEntry.uuid);
        if (imageData && imageData.data) {
            // 根据是否为视频选择正确的 MIME 类型
            const mimeType = isVideo ? 'video/mp4' : 'image/png';
            const mediaBase64 = `data:${mimeType};base64,` + arrayBufferToBase64(imageData.data);
            return [mediaBase64, change, finalIndex, isVideo, originalUrl];
        }
    }

    return [false, false, false, false, ''];
}

let cleanupRunning = false;

export async function setItemImg(tag, imgBase64, options = { format: 'png', }) {
    const { change = '', characterName = "chatu8", filename, format, isVideo = false, originalUrl = '' } = options;

    if (extension_settings[extensionName].jiuguanchucun === "true") {
        // 方案：存储到服务器,元数据存入 extension_settings
        const md5 = CryptoJS.MD5(tag).toString();
        const uuid = generateUUID();
        const thumbnailUUID = generateUUID();
        const newDate = new Date().getTime();

        // 准备上传参数
        const base64Data = imgBase64.split(',')[1] || imgBase64;
        // 根据是否为视频设置正确的格式
        let uploadFormat = 'png';
        if (isVideo) {
            // 视频格式：从 MIME 类型（如 video/h264-mp4）提取扩展名
            if (format && format.includes('mp4')) {
                uploadFormat = 'mp4';
            } else if (format && format.includes('webm')) {
                uploadFormat = 'webm';
            } else {
                uploadFormat = 'mp4'; // 默认视频格式
            }
        } else if (format && !format.startsWith('video/') && !format.startsWith('image')) {
            // 如果是简单的扩展名（如 png, jpg），直接使用
            uploadFormat = format;
        }
        const uploadBody = {
            image: base64Data,
            format: uploadFormat
        };

        if (characterName) {
            uploadBody.ch_name = characterName;
        }
        if (filename) {
            uploadBody.filename = filename;
        }

        console.log(`[DB] Uploading ${isVideo ? 'video' : 'image'} to server, format: ${uploadFormat}, size: ${base64Data.length} chars`);

        // 调用服务器 API 上传原图
        try {
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

            // 生成并上传缩略图
            let thumbnailPath = null;
            try {
                let thumbnailBlob;
                if (isVideo) {
                    // 视频：从第一帧提取缩略图
                    thumbnailBlob = await createThumbnailFromVideo(imgBase64);
                } else {
                    // 图片：使用原有方法
                    const imageBuffer = base64ToArrayBuffer(base64Data);
                    thumbnailBlob = await createThumbnailFromBuffer(imageBuffer);
                }
                const thumbnailBase64 = await blobToBase64(thumbnailBlob);
                const thumbnailData = thumbnailBase64.split(',')[1] || thumbnailBase64;

                const thumbnailUploadBody = {
                    image: thumbnailData,
                    format: 'jpeg' // 缩略图使用 JPEG 格式以减小文件大小
                };

                if (characterName) {
                    thumbnailUploadBody.ch_name = characterName;
                }
                if (filename) {
                    thumbnailUploadBody.filename = `thumb_${filename || uuid}`;
                }

                const thumbnailResponse = await fetch('/api/images/upload', {
                    method: 'POST',
                    headers: getRequestHeaders(window.token),
                    body: JSON.stringify(thumbnailUploadBody)
                });

                if (thumbnailResponse.ok) {
                    const thumbnailResult = await thumbnailResponse.json();
                    thumbnailPath = thumbnailResult.path;
                } else {
                    console.error('Failed to upload thumbnail:', thumbnailResponse.statusText);
                }
            } catch (thumbnailError) {
                console.error('Failed to create or upload thumbnail:', thumbnailError);
            }

            // 存储元数据到 extension_settings（在调用 getMergedAndSortedImages 之前）
            if (!extension_settings[extensionName].jiuguanStorage) {
                extension_settings[extensionName].jiuguanStorage = {};
            }
            const storage = extension_settings[extensionName].jiuguanStorage;

            const newImageEntry = {
                uuid: uuid,
                path: imagePath,
                thumbnail_uuid: thumbnailUUID,
                thumbnail_path: thumbnailPath,
                date: newDate,
                isVideo: isVideo,
                originalUrl: originalUrl || ''
            };

            // 先添加新图片到存储
            const entry = storage[md5];
            if (entry) {
                if (!entry.images) entry.images = [];
                entry.images.push(newImageEntry);
                entry.change = change;
            } else {
                storage[md5] = {
                    images: [newImageEntry],
                    index: 0,
                    change: change
                };
            }

            // 然后获取合并后的图片数量来设置正确的索引
            const merged = await getMergedAndSortedImages(md5);
            storage[md5].index = merged.images.length > 0 ? merged.images.length - 1 : 0;

            // 保存设置并等待完成
            saveSettingsDebounced();
            // 给一个小延迟确保设置已保存
            await new Promise(resolve => setTimeout(resolve, 50));

            if (!window.imagesid) window.imagesid = {};
            window.imagesid[md5] = newDate;

            // 更新隐写图片
            await updateStegoImage();

            return imagePath;
        } catch (error) {
            console.error('Failed to upload image to server:', error);
            throw error;
        }

    } else {
        // 原始方案：所有东西存入 IndexedDB
        const md5 = CryptoJS.MD5(tag).toString();
        const imageBuffer = base64ToArrayBuffer(imgBase64.split(',')[1] || imgBase64);
        const uuid = generateUUID();
        const newDate = new Date().getTime();

        const thumbnailUUID = generateUUID();
        try {
            let thumbnailBlob;
            if (isVideo) {
                // 视频：从第一帧提取缩略图
                thumbnailBlob = await createThumbnailFromVideo(imgBase64);
            } else {
                // 图片：使用原有方法
                thumbnailBlob = await createThumbnailFromBuffer(imageBuffer);
            }
            const thumbnailBuffer = await thumbnailBlob.arrayBuffer();
            await storeReadWrite({ id: thumbnailUUID, data: thumbnailBuffer });
        } catch (error) {
            console.error("Failed to create or store thumbnail:", error);
        }

        await storeReadWrite({ id: uuid, data: imageBuffer });

        const metadata = await getMetadata();
        const entry = metadata[md5];

        const newImageEntry = {
            uuid: uuid,
            thumbnail_uuid: thumbnailUUID,
            date: newDate,
            isVideo: isVideo,
            originalUrl: originalUrl || ''
        };

        if (entry) {
            if (!entry.images) entry.images = [];
            entry.images.push(newImageEntry);

            const merged = await getMergedAndSortedImages(md5);
            entry.change = change;
            entry.index = merged.images.length || 0
        } else {
            const merged = await getMergedAndSortedImages(md5);
            metadata[md5] = {
                images: [newImageEntry],
                index: merged.images.length || 0,
                change: change
            };
        }

        await setMetadata(metadata);

        if (!window.imagesid) window.imagesid = {};
        window.imagesid[md5] = newDate;
        return 'indexeddb_saved';
    }
}

/**
 * 打开 IndexedDB 数据库
 */
export async function openDB() {
    if (db) {
        return db;
    }

    return new Promise((resolve, reject) => {
        const request = indexedDB.open(dbName, dbVersion);

        request.onupgradeneeded = (event) => {
            const tempDb = event.target.result;
            console.log(`[DB] 数据库升级: 旧版本 ${event.oldVersion} -> 新版本 ${event.newVersion}`);

            // Create object stores if they don't exist
            if (!tempDb.objectStoreNames.contains(objectStoreName)) {
                tempDb.createObjectStore(objectStoreName, { keyPath: 'id' });
                console.log(`[DB] Object store '${objectStoreName}' created.`);
            }

            if (!tempDb.objectStoreNames.contains('vocabularies')) {
                tempDb.createObjectStore('vocabularies', { keyPath: 'fileName' });
                console.log('[DB] Object store "vocabularies" created.');
            }

            if (!tempDb.objectStoreNames.contains('groups')) {
                const groupsStore = tempDb.createObjectStore('groups', { keyPath: 'id_index' });
                groupsStore.createIndex('fileName', 'fileName', { unique: false });
                console.log('[DB] Object store "groups" created with fileName index.');
            }

            if (!tempDb.objectStoreNames.contains('subgroups')) {
                const subgroupsStore = tempDb.createObjectStore('subgroups', { keyPath: 'id_index' });
                subgroupsStore.createIndex('fileName', 'fileName', { unique: false });
                console.log('[DB] Object store "subgroups" created with fileName index.');
            }

            if (!tempDb.objectStoreNames.contains('tags')) {
                const tagsStore = tempDb.createObjectStore('tags', { autoIncrement: true });
                tagsStore.createIndex('fileName', 'fileName', { unique: false });
                tagsStore.createIndex('hot', 'hot', { unique: false });
                console.log('[DB] Object store "tags" created with fileName and hot indexes.');
            }

            if (event.oldVersion < 5) {
                if (tempDb.objectStoreNames.contains('tags')) {
                    const tagsStore = event.target.transaction.objectStore('tags');
                    if (!tagsStore.indexNames.contains('hot')) {
                        tagsStore.createIndex('hot', 'hot', { unique: false });
                        console.log('[DB] Index "hot" created for "tags" store.');
                    }
                }
            }

            if (event.oldVersion < 6) {
                console.log('[DB] Upgrading to v6: Add default hot value to tags.json entries.');
                const tagsStore = event.target.transaction.objectStore('tags');
                const index = tagsStore.index('fileName');
                const request = index.openCursor(IDBKeyRange.only('tags.json'));
                request.onsuccess = (e) => {
                    const cursor = e.target.result;
                    if (cursor) {
                        const record = cursor.value;
                        if (record.hot === undefined) {
                            record.hot = -1;
                        }
                        cursor.update(record);
                        cursor.continue();
                    } else {
                        console.log('[DB] v6 upgrade complete for tags.json.');
                    }
                };
            }
        };

        request.onerror = (event) => {
            console.error('[DB] 打开数据库失败:', event.target.error);
            reject(event.target.error);
        };

        request.onsuccess = (event) => {
            db = event.target.result;
            console.log(`[DB] 数据库 '${dbName}' v${dbVersion} 打开成功。`);
            resolve(db);
        };
    });
}

export async function storeReadWrite(data) {
    // This function might be called during migration, where db is not yet set.
    // It should handle its own DB connection if needed.
    const dbInstance = db || await openDB();
    const transaction = dbInstance.transaction([objectStoreName], 'readwrite');
    const objectStore = transaction.objectStore(objectStoreName);
    return new Promise((resolve, reject) => {
        const request = objectStore.put(data);
        request.onsuccess = () => resolve();
        request.onerror = (event) => reject(event.target.error);
    });
}

async function getManualTags() {
    const db = await openDB();
    const transaction = db.transaction('tags', 'readonly');
    const store = transaction.objectStore('tags');
    const index = store.index('fileName');
    const request = index.getAll(IDBKeyRange.only('manual'));

    return new Promise((resolve, reject) => {
        request.onsuccess = () => resolve(request.result);
        request.onerror = (event) => reject(event.target.error);
    });
}

async function deleteTagByName(tagName) {
    const db = await openDB();
    const transaction = db.transaction('tags', 'readwrite');
    const store = transaction.objectStore('tags');

    // We need to find the primary key of the tag first
    const request = store.openCursor();
    let keyToDelete = null;

    await new Promise((resolve, reject) => {
        request.onsuccess = (event) => {
            const cursor = event.target.result;
            if (cursor) {
                if (cursor.value.name === tagName && cursor.value.fileName === 'manual') {
                    keyToDelete = cursor.primaryKey;
                    cursor.delete(); // Delete the record
                    resolve(); // Found and deleted, so we can resolve
                    return;
                }
                cursor.continue();
            } else {
                resolve(); // Cursor finished
            }
        };
        request.onerror = (event) => reject(event.target.error);
    });

    return new Promise((resolve, reject) => {
        transaction.oncomplete = () => {
            if (keyToDelete !== null) {
                resolve(true); // Deletion was successful
            } else {
                resolve(false); // Tag not found
            }
        };
        transaction.onerror = (event) => reject(event.target.error);
    });
}

export async function storeReadOnly(id) {
    const db = await openDB();
    const transaction = db.transaction([objectStoreName], 'readonly');
    const objectStore = transaction.objectStore(objectStoreName);
    return new Promise((resolve, reject) => {
        const request = objectStore.get(id);
        request.onsuccess = (event) => resolve(event.target.result);
        request.onerror = (event) => reject(event.target.error);
    });
}

export async function storeDelete(id) {
    // This function might be called during migration, where db is not yet set.
    const dbInstance = db || await openDB();
    const transaction = dbInstance.transaction([objectStoreName], 'readwrite');
    const objectStore = transaction.objectStore(objectStoreName);
    return new Promise((resolve, reject) => {
        const request = objectStore.delete(id);
        request.onsuccess = () => resolve();
        request.onerror = (event) => reject(event.target.error);
    });
}

// --- 新的公开 API ---

/**
 * 获取并解析元数据
 * @returns {Promise<Object>}
 */
async function getMetadata() {
    const data = await storeReadOnly(metadataId);
    if (data && data.shuju) {
        try {
            return JSON.parse(data.shuju);
        } catch (e) {
            console.error("Failed to parse image metadata:", e);
        }
    }
    return {};
}

/**
 * 写入元数据
 * @param {Object} metadata 
 */
async function setMetadata(metadata) {
    await storeReadWrite({ id: metadataId, shuju: JSON.stringify(metadata) });
}

/**
 * 缓慢生成缺失的缩略图
 */
export async function generateMissingThumbnails() {
    console.log('Checking for missing thumbnails...');
    const metadata = await getMetadata();
    let updated = false;
    let needsGeneration = false;

    // First, check if any thumbnails need to be generated at all.
    for (const md5 in metadata) {
        const entry = metadata[md5];
        if (entry && entry.images) {
            if (entry.images.some(image => !image.thumbnail_uuid)) {
                needsGeneration = true;
                break;
            }
        }
    }

    if (!needsGeneration) {
        console.log('No missing thumbnails found. Aborting generation.');
        return;
    }

    for (const md5 in metadata) {
        const entry = metadata[md5];
        if (entry && entry.images) {
            for (const image of entry.images) {
                if (!image.thumbnail_uuid) {
                    console.log(`Generating thumbnail for image ${image.uuid}...`);
                    try {
                        const imageData = await storeReadOnly(image.uuid);
                        if (imageData && imageData.data) {
                            const thumbnailBlob = await createThumbnailFromBuffer(imageData.data);
                            const thumbnailBuffer = await thumbnailBlob.arrayBuffer();
                            const thumbnailUUID = generateUUID();

                            await storeReadWrite({ id: thumbnailUUID, data: thumbnailBuffer });
                            image.thumbnail_uuid = thumbnailUUID;
                            updated = true;
                            console.log(`Thumbnail ${thumbnailUUID} created for image ${image.uuid}.`);
                        }
                    } catch (err) {
                        console.error(`Failed to generate thumbnail for ${image.uuid}:`, err);
                    }
                    // 在每个缩略图生成之间稍作停顿，以减少 CPU 占用
                    await new Promise(resolve => setTimeout(resolve, 2000));
                }
            }
        }
    }

    if (updated) {
        console.log('Finished generating missing thumbnails. Saving metadata...');
        await setMetadata(metadata);
    }
}


/**
 * 3b. 获取图片 Blob
 * @param {string} tag - 图片标签
 * @param {number | null} [index=null] - 可选，要获取的图片索引。如果为 null，则返回当前索引的图片。
 * @returns {Promise<Blob|null>} - 返回 Blob 对象或 null
 */
export async function getItemBlob(tag, index = null) {
    const md5 = CryptoJS.MD5(tag).toString();

    // 优先检查服务器存储
    const storage = extension_settings[extensionName].jiuguanStorage || {};
    const serverEntry = storage[md5];

    if (serverEntry && Array.isArray(serverEntry.images) && serverEntry.images.length > 0) {
        let finalIndex = index;
        if (finalIndex === null || finalIndex === undefined) {
            finalIndex = serverEntry.index || 0;
        }
        if (finalIndex < 0 || finalIndex >= serverEntry.images.length) {
            finalIndex = serverEntry.images.length - 1;
        }
        const imageEntry = serverEntry.images[finalIndex];
        if (imageEntry && imageEntry.path) {
            try {
                const response = await fetch(imageEntry.path);
                if (response.ok) {
                    return await response.blob();
                }
            } catch (error) {
                console.error('Failed to fetch image blob from server:', error);
            }
        }
    }

    // 回退到 IndexedDB
    const metadata = await getMetadata();
    const dbEntry = metadata[md5];

    if (dbEntry && Array.isArray(dbEntry.images) && dbEntry.images.length > 0) {
        let finalIndex = index;
        if (finalIndex === null || finalIndex === undefined) {
            finalIndex = dbEntry.index || 0;
        }
        if (finalIndex < 0 || finalIndex >= dbEntry.images.length) {
            finalIndex = dbEntry.images.length - 1;
        }

        const imageEntry = dbEntry.images[finalIndex];
        if (!imageEntry) return null;
        const uuid = imageEntry.uuid;
        const imageData = await storeReadOnly(uuid);

        if (imageData && imageData.data) {
            return new Blob([imageData.data], { type: 'image/png' });
        }
    }

    return null;
}

/**
 * 4. 修改当前图片序号
 * @param {string} tag - 图片标签
 * @param {number} index - 新的当前图片索引（基于合并排序后的数组）
 */
export async function updateImageIndex(tag, index) {
    const md5 = CryptoJS.MD5(tag).toString();

    // 获取合并排序后的图片数组
    const merged = await getMergedAndSortedImages(md5);

    if (merged.images.length === 0) {
        console.error(`No images found for tag ${tag}`);
        return;
    }

    // 使用 syncIndexToStorage 将合并数组的索引同步到两端存储
    await syncIndexToStorage(md5, index, merged.images);

    // 更新隐写图片（索引变化也需要同步）
    await updateStegoImage();
}

/**
 * 5. 删除指定索引的图片（修复版本：基于合并排序后的索引正确删除）
 * @param {string} tag - 图片标签
 * @param {number} index - 要删除的图片索引（基于合并排序后的数组）
 */
export async function deleteImage(tag, index) {
    const md5 = CryptoJS.MD5(tag).toString();

    // 1. 获取合并排序后的图片数组
    const merged = await getMergedAndSortedImages(md5);

    if (!merged.images || merged.images.length === 0) {
        console.warn(`No images found for tag: ${tag}`);
        return;
    }

    if (index < 0 || index >= merged.images.length) {
        console.error(`Index ${index} out of bounds for tag ${tag}`);
        return;
    }

    // 2. 找到要删除的图片及其来源
    const imageToDelete = merged.images[index];
    const source = imageToDelete.source; // 'server' or 'db'

    // 3. 根据来源删除对应的图片
    if (source === 'server') {
        const storage = extension_settings[extensionName].jiuguanStorage;
        const serverEntry = storage?.[md5];

        if (serverEntry && Array.isArray(serverEntry.images)) {
            // 在服务器数组中找到对应的图片（通过 uuid 匹配）
            const serverIndex = serverEntry.images.findIndex(img => img.uuid === imageToDelete.uuid);

            if (serverIndex !== -1) {
                const [deleted] = serverEntry.images.splice(serverIndex, 1);

                // 调用服务器 API 删除图片文件和缩略图
                const pathsToDelete = [];
                if (deleted.path) pathsToDelete.push(deleted.path);
                if (deleted.thumbnail_path) pathsToDelete.push(deleted.thumbnail_path);

                for (const path of pathsToDelete) {
                    try {
                        const response = await fetch('/api/images/delete', {
                            method: 'POST',
                            headers: getRequestHeaders(window.token),
                            body: JSON.stringify({ path })
                        });
                        if (!response.ok) {
                            console.error(`Failed to delete image from server: ${response.statusText}`);
                        }
                    } catch (error) {
                        console.error('Failed to delete image from server:', error);
                    }
                }

                // 更新服务器存储元数据
                if (serverEntry.images.length === 0) {
                    delete storage[md5];
                } else {
                    // 重新计算索引（基于服务器数组）
                    if (serverEntry.index >= serverEntry.images.length) {
                        serverEntry.index = serverEntry.images.length - 1;
                    }
                }
                saveSettingsDebounced();

                // 更新隐写图片
                await updateStegoImage();
            }
        }
    } else if (source === 'db') {
        const metadata = await getMetadata();
        const dbEntry = metadata[md5];

        if (dbEntry && Array.isArray(dbEntry.images)) {
            // 在 DB 数组中找到对应的图片（通过 uuid 匹配）
            const dbIndex = dbEntry.images.findIndex(img => img.uuid === imageToDelete.uuid);

            if (dbIndex !== -1) {
                const [deleted] = dbEntry.images.splice(dbIndex, 1);

                // 从数据库中删除图片和缩略图实体
                if (deleted.uuid) {
                    await storeDelete(deleted.uuid);
                }
                if (deleted.thumbnail_uuid) {
                    await storeDelete(deleted.thumbnail_uuid);
                }

                // 更新 IndexedDB 元数据
                if (dbEntry.images.length === 0) {
                    delete metadata[md5];
                } else {
                    // 重新计算索引（基于 DB 数组）
                    if (dbEntry.index >= dbEntry.images.length) {
                        dbEntry.index = dbEntry.images.length - 1;
                    }
                }
                await setMetadata(metadata);
            }
        }
    }

    // 4. 更新全局 imagesid 缓存
    if (window.imagesid && window.imagesid[md5]) {
        // 重新获取合并后的图片来更新时间戳
        const updatedMerged = await getMergedAndSortedImages(md5);
        if (updatedMerged.images.length === 0) {
            delete window.imagesid[md5];
        } else {
            const dates = updatedMerged.images.map(img => img.date).filter(d => d);
            if (dates.length > 0) {
                window.imagesid[md5] = Math.max(...dates);
            } else {
                delete window.imagesid[md5];
            }
        }
    }
}

/**
 * 6. 触发数据库迁移（如果需要）
 */
export async function migrateDatabase() {
    console.log("Manual database migration triggered...");
    try {

        await migrateOldSettings();


        if (confirm('是否查找迁移数据库(缓存图片)？')) {
            await performMigration();
        }


        // 在数据库成功打开后，尝试进行设置迁移


        console.log("Database migration check complete.");
    } catch (error) {
        console.error("Error during manual migration trigger:", error);
    }
}

/**
 * 7. 获取一个标签下的所有图片（兼容模式：合并服务器和IndexedDB的结果）
 * @param {string} md5ORtag - 图片的 md5 或 tag
 * @returns {Promise<string[]>} - 返回图片数组（服务器返回路径，IndexedDB返回Base64）
 */
export async function getAllImages(md5ORtag) {
    const results = [];
    let md5 = md5ORtag;

    // 尝试作为 MD5 或计算 MD5
    if (md5ORtag.length !== 32) {
        md5 = CryptoJS.MD5(md5ORtag).toString();
    }

    // 1. 从服务器存储获取并转换为 base64
    const storage = extension_settings[extensionName].jiuguanStorage || {};
    const serverEntry = storage[md5] || storage[md5ORtag];

    if (serverEntry && Array.isArray(serverEntry.images)) {
        const serverImagePromises = serverEntry.images.map(async (imageEntry) => {
            if (imageEntry.path) {
                try {
                    const response = await fetch(imageEntry.path);
                    if (response.ok) {
                        const blob = await response.blob();
                        return await blobToBase64(blob);
                    }
                } catch (error) {
                    console.error('Failed to fetch image:', error);
                }
            }
            return null;
        });
        const serverImages = await Promise.all(serverImagePromises);
        results.push(...serverImages.filter(img => img !== null));
    }

    // 2. 从 IndexedDB 获取
    const metadata = await getMetadata();
    const dbEntry = metadata[md5] || metadata[md5ORtag];

    if (dbEntry && Array.isArray(dbEntry.images)) {
        const imagePromises = dbEntry.images.map(async (imageEntry) => {
            const imageData = await storeReadOnly(imageEntry.uuid);
            if (imageData && imageData.data) {
                return "data:image/png;base64," + arrayBufferToBase64(imageData.data);
            }
            return null;
        });
        const dbImages = await Promise.all(imagePromises);
        results.push(...dbImages.filter(img => img !== null));
    }

    return results;
}

/**
 * 7b. 获取一个标签下的所有图片 Blob（兼容模式：合并服务器和IndexedDB的结果）
 * @param {string} md5ORtag - 图片的 md5 或 tag
 * @returns {Promise<Blob[]>} - 返回 Blob 对象数组
 */
export async function getAllImageBlobs(md5ORtag) {
    const results = [];
    let md5 = md5ORtag;

    // 尝试作为 MD5 或计算 MD5
    if (md5ORtag.length !== 32) {
        md5 = CryptoJS.MD5(md5ORtag).toString();
    }

    // 1. 从服务器存储获取
    const storage = extension_settings[extensionName].jiuguanStorage || {};
    const serverEntry = storage[md5] || storage[md5ORtag];

    if (serverEntry && Array.isArray(serverEntry.images)) {
        const blobPromises = serverEntry.images.map(async (imageEntry) => {
            if (imageEntry.path) {
                try {
                    const response = await fetch(imageEntry.path);
                    if (response.ok) {
                        return await response.blob();
                    }
                } catch (error) {
                    console.error('Failed to fetch image blob:', error);
                }
            }
            return null;
        });
        const serverBlobs = await Promise.all(blobPromises);
        results.push(...serverBlobs.filter(b => b !== null));
    }

    // 2. 从 IndexedDB 获取
    const metadata = await getMetadata();
    const dbEntry = metadata[md5] || metadata[md5ORtag];

    if (dbEntry && Array.isArray(dbEntry.images)) {
        const blobPromises = dbEntry.images.map(async (imageEntry) => {
            const imageData = await storeReadOnly(imageEntry.uuid);
            if (imageData && imageData.data) {
                return new Blob([imageData.data], { type: 'image/png' });
            }
            return null;
        });
        const dbBlobs = await Promise.all(blobPromises);
        results.push(...dbBlobs.filter(b => b !== null));
    }

    return results;
}

/**
 * 获取单个图片
 * @param {string} uuid - 图片的 uuid
 * @returns {Promise<string|null>} - 返回 Base64 图片字符串
 */
export async function getImageByUUID(uuid) {
    const imageData = await storeReadOnly(uuid);
    if (imageData && imageData.data) {
        return "data:image/png;base64," + arrayBufferToBase64(imageData.data);
    }
    return null;
}

/**
 * 获取单个图片 Blob (兼容模式)
 * @param {string} uuid - 图片的 uuid
 * @returns {Promise<Blob|null>} - 返回 Blob 对象或 null
 */
export async function getImageBlobByUUID(uuid) {
    // 1. 优先从 IndexedDB 获取
    const imageData = await storeReadOnly(uuid);
    if (imageData && imageData.data) {
        return new Blob([imageData.data], { type: 'image/png' });
    }

    // 2. 如果 DB 中没有，则在服务器存储中查找
    const serverStorage = extension_settings[extensionName].jiuguanStorage || {};
    for (const md5 in serverStorage) {
        const entry = serverStorage[md5];
        if (entry && Array.isArray(entry.images)) {
            const imageEntry = entry.images.find(img => img.uuid === uuid);
            if (imageEntry && imageEntry.path) {
                try {
                    const response = await fetch(imageEntry.path);
                    if (response.ok) {
                        return await response.blob();
                    } else {
                        console.error(`Failed to fetch image from server: ${response.statusText}`);
                    }
                } catch (error) {
                    console.error(`Failed to fetch image blob from server for uuid ${uuid}:`, error);
                }
            }
        }
    }

    // 3. 如果都找不到
    return null;
}

/**
 * 获取单个图片缩略图 Blob
 * @param {string} thumbnail_uuid - 缩略图的 uuid
 * @returns {Promise<Blob|null>} - 返回 Blob 对象或 null
 */
export async function getImageThumbnailBlobByUUID(thumbnail_uuid) {
    if (!thumbnail_uuid) return null;
    const imageData = await storeReadOnly(thumbnail_uuid);
    if (imageData && imageData.data) {
        const uint = new Uint8Array(imageData.data);
        let mimeType = 'image/png'; // Default to original format
        // Check for JPEG magic numbers
        if (uint[0] === 0xFF && uint[1] === 0xD8 && uint[2] === 0xFF) {
            mimeType = 'image/jpeg';
        }
        return new Blob([imageData.data], { type: mimeType });
    }
    return null;
}

/**
 * 8. 获取所有图片元数据（兼容模式：合并服务器和IndexedDB的元数据，并标记来源）
 * @returns {Promise<Object>} - 返回合并后的元数据对象，每个图片条目包含 source 字段
 */
export async function getAllImageMetadata() {
    const mergedMetadata = {};

    // 1. 获取服务器存储的元数据并标记来源
    const serverStorage = extension_settings[extensionName].jiuguanStorage || {};
    for (const md5 in serverStorage) {
        const entry = serverStorage[md5];
        if (entry && entry.images) {
            mergedMetadata[md5] = {
                ...entry,
                images: entry.images.map(img => ({
                    ...img,
                    source: 'server' // 标记为服务器来源
                }))
            };
        }
    }

    // 2. 获取 IndexedDB 的元数据并标记来源
    const dbMetadata = await getMetadata();
    for (const md5 in dbMetadata) {
        const entry = dbMetadata[md5];
        if (entry && entry.images) {
            if (!mergedMetadata[md5]) {
                // 如果服务器没有这个 md5，直接使用 DB 的数据
                mergedMetadata[md5] = {
                    ...entry,
                    images: entry.images.map(img => ({
                        ...img,
                        source: 'db' // 标记为数据库来源
                    }))
                };
            } else {
                // 如果服务器已有这个 md5，将 DB 的图片追加到现有数组
                mergedMetadata[md5].images.push(...entry.images.map(img => ({
                    ...img,
                    source: 'db'
                })));
            }
        }
    }

    return mergedMetadata;
}

/**
 * 9. 批量删除图片（兼容模式：同时删除服务器和IndexedDB）
 * @param {string[]} md5s - 要删除的图片ID (md5) 数组
 */
export async function deleteMultipleImages(md5s) {
    if (!Array.isArray(md5s) || md5s.length === 0) {
        return;
    }

    // 1. 尝试从服务器存储删除
    const storage = extension_settings[extensionName].jiuguanStorage;
    if (storage) {
        const pathsToDelete = [];

        md5s.forEach(md5 => {
            const entry = storage[md5];
            if (entry && entry.images) {
                // 收集所有需要删除的路径（包括主图和缩略图）
                entry.images.forEach(imageEntry => {
                    if (imageEntry.path) {
                        pathsToDelete.push(imageEntry.path);
                    }
                    if (imageEntry.thumbnail_path) {
                        pathsToDelete.push(imageEntry.thumbnail_path);
                    }
                });
                // 从元数据中删除
                delete storage[md5];
                if (window.imagesid && window.imagesid[md5]) {
                    delete window.imagesid[md5];
                }
            }
        });

        // 批量调用服务器 API 删除（404 视为已删除，正常继续）
        for (const path of pathsToDelete) {
            try {
                const response = await fetch('/api/images/delete', {
                    method: 'POST',
                    headers: getRequestHeaders(window.token),
                    body: JSON.stringify({ path })
                });
                if (!response.ok && response.status !== 404) {
                    console.error(`Failed to delete image from server: ${path} (status ${response.status})`);
                }
            } catch (error) {
                console.error(`Failed to delete image from server: ${path}`, error);
            }
        }

        // 保存元数据
        saveSettingsDebounced();

        // 更新隐写图片
        await updateStegoImage();
    }

    // 2. 尝试从 IndexedDB 删除
    const metadata = await getMetadata();
    const allUuidsToDelete = [];
    let metadataUpdated = false;

    md5s.forEach(md5 => {
        const entry = metadata[md5];
        if (entry && entry.images) {
            entry.images.forEach(imageEntry => {
                if (imageEntry.uuid) allUuidsToDelete.push(imageEntry.uuid);
                if (imageEntry.thumbnail_uuid) allUuidsToDelete.push(imageEntry.thumbnail_uuid);
            });
            delete metadata[md5];
            metadataUpdated = true;
            if (window.imagesid && window.imagesid[md5]) {
                delete window.imagesid[md5];
            }
        }
    });

    // 批量从数据库删除图片实体
    if (allUuidsToDelete.length > 0) {
        const db = await openDB();
        const transaction = db.transaction([objectStoreName], 'readwrite');
        const objectStore = transaction.objectStore(objectStoreName);
        const deletePromises = allUuidsToDelete.map(uuid => {
            if (!uuid) return Promise.resolve();
            return new Promise((resolve, reject) => {
                const request = objectStore.delete(uuid);
                request.onsuccess = resolve;
                request.onerror = reject;
            });
        });
        await Promise.all(deletePromises);
    }

    // 写回更新后的元数据
    if (metadataUpdated) {
        await setMetadata(metadata);
    }
}

/**
 * 批量删除图片 (by UUID)（兼容模式：同时删除服务器和IndexedDB）
 * @param {string[]} uuids - 要删除的图片 UUID 数组
 */
export async function deleteImagesByUuids(uuids) {
    if (!Array.isArray(uuids) || uuids.length === 0) {
        return;
    }

    // 1. 尝试从服务器存储删除
    const storage = extension_settings[extensionName].jiuguanStorage;
    if (storage) {
        const pathsToDelete = [];

        // 创建 UUID -> md5 的映射（不再缓存 index，避免 splice 后索引失效）
        const uuidToMd5Map = new Map();
        for (const [md5, entry] of Object.entries(storage)) {
            if (entry.images && Array.isArray(entry.images)) {
                entry.images.forEach((img) => {
                    uuidToMd5Map.set(img.uuid, md5);
                });
            }
        }

        // 处理删除（每次都用当前数组的 findIndex，避免索引错乱）
        uuids.forEach(uuid => {
            const md5 = uuidToMd5Map.get(uuid);
            if (md5) {
                const entry = storage[md5];

                if (entry && entry.images) {
                    const idx = entry.images.findIndex(img => img.uuid === uuid);
                    if (idx === -1) return;
                    const [removed] = entry.images.splice(idx, 1);
                    const path = removed && removed.path;
                    const thumbnail_path = removed && removed.thumbnail_path;
                    if (path) pathsToDelete.push(path);
                    if (thumbnail_path) pathsToDelete.push(thumbnail_path);

                    if (entry.images.length === 0) {
                        delete storage[md5];
                        if (window.imagesid && window.imagesid[md5]) {
                            delete window.imagesid[md5];
                        }
                    } else {
                        // 调整索引
                        if (entry.index >= entry.images.length) {
                            entry.index = entry.images.length - 1;
                        }
                        // 更新时间戳
                        if (window.imagesid && window.imagesid[md5]) {
                            const dates = entry.images.map(img => img.date).filter(d => d);
                            if (dates.length > 0) {
                                window.imagesid[md5] = Math.max(...dates);
                            } else {
                                delete window.imagesid[md5];
                            }
                        }
                    }
                }
            }
        });

        // 批量删除服务器图片（404 视为已删除，正常继续）
        for (const path of pathsToDelete) {
            try {
                const response = await fetch('/api/images/delete', {
                    method: 'POST',
                    headers: getRequestHeaders(window.token),
                    body: JSON.stringify({ path })
                });
                if (!response.ok && response.status !== 404) {
                    console.error(`Failed to delete image from server: ${path} (status ${response.status})`);
                }
            } catch (error) {
                console.error(`Failed to delete image from server: ${path}`, error);
            }
        }

        // 保存元数据
        saveSettingsDebounced();

        // 同步到服务器隐写存储文件（关键：不调用会导致刷新后幽灵复活）
        if (pathsToDelete.length > 0) {
            try {
                await updateStegoImage();
            } catch (e) {
                console.error('[deleteImagesByUuids] updateStegoImage failed:', e);
            }
        }
    }

    // 2. 尝试从 IndexedDB 删除
    const metadata = await getMetadata();
    let metadataUpdated = false;
    const allUuidsToDelete = new Set();

    // Create a reverse map from uuid to md5 for quick lookup
    const uuidToMd5Map = new Map();
    for (const [md5, meta] of Object.entries(metadata)) {
        if (meta.images && Array.isArray(meta.images)) {
            meta.images.forEach(imageEntry => uuidToMd5Map.set(imageEntry.uuid, md5));
        }
    }

    // Process deletions by modifying the metadata object
    uuids.forEach(uuid => {
        const md5 = uuidToMd5Map.get(uuid);
        if (md5 && metadata[md5]) {
            const entry = metadata[md5];
            const imageIndex = entry.images.findIndex(img => img.uuid === uuid);

            if (imageIndex > -1) {
                const [imageToDelete] = entry.images.splice(imageIndex, 1);

                if (imageToDelete.uuid) allUuidsToDelete.add(imageToDelete.uuid);
                if (imageToDelete.thumbnail_uuid) allUuidsToDelete.add(imageToDelete.thumbnail_uuid);

                metadataUpdated = true;

                if (entry.images.length === 0) {
                    delete metadata[md5];
                    if (window.imagesid && window.imagesid[md5]) {
                        delete window.imagesid[md5];
                    }
                } else {
                    // Adjust index if it's out of bounds
                    if (entry.index >= entry.images.length) {
                        entry.index = entry.images.length - 1;
                    }
                    // Update the cache timestamp to the latest one
                    if (window.imagesid && window.imagesid[md5]) {
                        const dates = entry.images.map(img => img.date).filter(d => d);
                        if (dates.length > 0) {
                            window.imagesid[md5] = Math.max(...dates);
                        } else {
                            delete window.imagesid[md5];
                        }
                    }
                }
            }
        }
    });

    // Batch delete image data from DB
    if (allUuidsToDelete.size > 0) {
        const db = await openDB();
        const transaction = db.transaction([objectStoreName], 'readwrite');
        const objectStore = transaction.objectStore(objectStoreName);
        const deletePromises = Array.from(allUuidsToDelete).map(uuid => {
            return new Promise((resolve, reject) => {
                const request = objectStore.delete(uuid);
                request.onsuccess = resolve;
                request.onerror = reject;
            });
        });
        await Promise.all(deletePromises);
    }

    // Write back updated metadata
    if (metadataUpdated) {
        await setMetadata(metadata);
    }
}

// --- Vocabulary Functions ---

async function installVocabulary(fileName, data) {
    const db = await openDB();

    // Determine the type of file and prepare stores
    const isHierarchical = (data.tag_groups && data.tag_groups.length > 0) || (data.tag_tags && data.tag_tags.length > 0);
    const storesToClear = isHierarchical ? ['vocabularies', 'groups', 'subgroups', 'tags'] : ['vocabularies', 'tags'];
    const transaction = db.transaction(storesToClear, 'readwrite');

    const vocabStore = transaction.objectStore('vocabularies');
    const tagsStore = transaction.objectStore('tags');
    const groupsStore = isHierarchical ? transaction.objectStore('groups') : null;
    const subgroupsStore = isHierarchical ? transaction.objectStore('subgroups') : null;

    // --- Step 1: Clear existing data for this vocabulary ---
    for (const storeName of storesToClear) {
        // We only clear this specific file's data, not the whole store
        if (storeName === 'vocabularies') {
            await new Promise((resolve, reject) => {
                const req = transaction.objectStore(storeName).delete(fileName);
                req.onsuccess = resolve;
                req.onerror = reject;
            });
        } else {
            const store = transaction.objectStore(storeName);
            const index = store.index('fileName');
            let cursorReq = index.openKeyCursor(IDBKeyRange.only(fileName));
            await new Promise(async (resolve, reject) => {
                const keysToDelete = [];
                cursorReq.onsuccess = (event) => {
                    const cursor = event.target.result;
                    if (cursor) {
                        keysToDelete.push(cursor.primaryKey);
                        cursor.continue();
                    } else {
                        // All keys collected, now delete them
                        Promise.all(keysToDelete.map(key => store.delete(key)))
                            .then(resolve)
                            .catch(reject);
                    }
                };
                cursorReq.onerror = (event) => reject(event.target.error);
            });
        }
    }

    // --- Step 2: Add new data ---
    let totalTags = 0;
    if (isHierarchical) {
        const { tag_groups, tag_tags } = data;

        // 特殊处理只有一个 group 且没有 subgroup 的情况
        if (tag_groups && tag_groups.length === 1 && (!tag_groups[0].subgroups || tag_groups[0].subgroups.length === 0)) {
            const group = tag_groups[0];
            const virtualSubgroup = {
                id_index: group.id_index, // 复用 group 的 id_index
                group_id: group.id_index,
                name: group.name, // 复用 group 的 name
                fileName
            };
            subgroupsStore.put(virtualSubgroup);

            // 将所有 tag 归到这个虚拟 subgroup
            if (tag_tags) {
                totalTags = tag_tags.length;
                for (const tag of tag_tags) {
                    const newTag = {
                        name: tag.text,
                        translation: tag.desc,
                        subgroup_id: virtualSubgroup.id_index, // 强制关联
                        hot: -1,
                        fileName
                    };
                    tagsStore.put(newTag);
                }
            }
            // 存储 group 本身
            const { subgroups, ...groupData } = group;
            groupsStore.put({ ...groupData, fileName });

        } else { // 正常处理
            if (tag_groups) {
                for (const group of tag_groups) {
                    // Store subgroups first, adding the group_id for relation
                    if (group.subgroups && Array.isArray(group.subgroups)) {
                        for (const subgroup of group.subgroups) {
                            subgroupsStore.put({ ...subgroup, group_id: group.id_index, fileName });
                        }
                    }
                    // Store the group itself, but without the nested subgroups array
                    const { subgroups, ...groupData } = group;
                    groupsStore.put({ ...groupData, fileName });
                }
            }
            if (tag_tags) {
                totalTags = tag_tags.length;
                for (const tag of tag_tags) {
                    const newTag = {
                        name: tag.text,
                        translation: tag.desc,
                        subgroup_id: tag.subgroup_id,
                        hot: -1,
                        fileName
                    };
                    tagsStore.put(newTag);
                }
            }
        }
    } else { // Simple tag list
        let tags = [];
        if (data.danbooru_tag) tags = data.danbooru_tag;
        else if (Array.isArray(data)) tags = data;

        totalTags = tags.length;
        for (const tag of tags) {
            const newTag = {
                name: typeof tag === 'object' ? tag.tag || tag.name : tag,
                translation: typeof tag === 'object' ? tag.translate || tag.translation : '',
                hot: typeof tag === 'object' ? tag.hot || 0 : 0,
                fileName
            };
            tagsStore.put(newTag);
        }
    }

    // --- Step 3: Update vocabularies metadata ---
    vocabStore.put({ fileName, tagCount: totalTags, installedDate: new Date() });

    return new Promise((resolve, reject) => {
        transaction.oncomplete = () => resolve();
        transaction.onerror = (event) => reject(event.target.error);
    });
}

async function uninstallVocabulary(fileName) {
    const db = await openDB();
    // Determine which stores to include in the transaction
    const isHierarchical = fileName === 'tags.json';
    const storesToClear = isHierarchical ? ['vocabularies', 'groups', 'subgroups', 'tags'] : ['vocabularies', 'tags'];
    const transaction = db.transaction(storesToClear, 'readwrite');

    for (const storeName of storesToClear) {
        if (storeName === 'vocabularies') {
            await new Promise((resolve, reject) => {
                const req = transaction.objectStore(storeName).delete(fileName);
                req.onsuccess = resolve;
                req.onerror = reject;
            });
        } else {
            const store = transaction.objectStore(storeName);
            const index = store.index('fileName');
            const request = index.openCursor(IDBKeyRange.only(fileName));
            await new Promise((resolve, reject) => {
                request.onsuccess = (event) => {
                    const cursor = event.target.result;
                    if (cursor) {
                        cursor.delete();
                        cursor.continue();
                    } else {
                        resolve();
                    }
                };
                request.onerror = (event) => reject(event.target.error);
            });
        }
    }

    return new Promise((resolve, reject) => {
        transaction.oncomplete = () => resolve();
        transaction.onerror = (event) => reject(event.target.error);
    });
}

async function getInstalledVocabularies() {
    const db = await openDB();
    const transaction = db.transaction('vocabularies', 'readonly');
    const store = transaction.objectStore('vocabularies');
    const request = store.getAll();

    return new Promise((resolve, reject) => {
        request.onsuccess = () => {
            resolve(request.result);
        };
        request.onerror = (event) => {
            reject(event.target.error);
        };
    });
}

async function getTagsTreeData() {
    const db = await openDB();
    const transaction = db.transaction(['groups', 'subgroups', 'tags'], 'readonly');

    const groupsStore = transaction.objectStore('groups');
    const subgroupsStore = transaction.objectStore('subgroups');
    const tagsStore = transaction.objectStore('tags');

    const [groups, subgroups, tags] = await Promise.all([
        new Promise((res, rej) => { const r = groupsStore.getAll(); r.onsuccess = () => res(r.result); r.onerror = rej; }),
        new Promise((res, rej) => { const r = subgroupsStore.getAll(); r.onsuccess = () => res(r.result); r.onerror = rej; }),
        new Promise((res, rej) => { const r = tagsStore.getAll(); r.onsuccess = () => res(r.result); r.onerror = rej; }),
    ]);

    // Reconstruct the nested structure
    const subgroupsByGroup = subgroups.reduce((acc, sg) => {
        if (!acc[sg.group_id]) acc[sg.group_id] = [];
        acc[sg.group_id].push(sg);
        return acc;
    }, {});

    const tagsBySubgroup = tags.reduce((acc, tag) => {
        if (!acc[tag.subgroup_id]) acc[tag.subgroup_id] = [];
        acc[tag.subgroup_id].push({ text: tag.name, desc: tag.translation }); // match original format
        return acc;
    }, {});

    const finalTree = {
        tag_groups: groups.map(g => ({
            ...g,
            subgroups: (subgroupsByGroup[g.id_index] || []).map(sg => ({
                ...sg,
                tags: tagsBySubgroup[sg.id_index] || []
            }))
        })),
        tag_tags: tags.map(t => ({
            text: t.name,
            desc: t.translation,
            subgroup_id: t.subgroup_id
        }))
    };

    return finalTree;
}

async function searchTags(keyword, options = {}) {
    if (!keyword) {
        return [];
    }
    const { startsWith = false, limit = 100, sortBy = 'hot_asc' } = options;
    const lowerCaseKeyword = keyword.toLowerCase();

    const db = await openDB();
    const transaction = db.transaction('tags', 'readonly');
    const store = transaction.objectStore('tags');

    const allMatches = new Map();

    const processCursor = (cursor) => {
        if (cursor) {
            const tag = cursor.value;
            let nameMatch = false;
            let translationMatch = false;

            if (startsWith) {
                nameMatch = tag.name && tag.name.toLowerCase().startsWith(lowerCaseKeyword);
                translationMatch = tag.translation && tag.translation.toLowerCase().startsWith(lowerCaseKeyword);
            } else {
                nameMatch = tag.name && tag.name.toLowerCase().includes(lowerCaseKeyword);
                translationMatch = tag.translation && tag.translation.toLowerCase().includes(lowerCaseKeyword);
            }

            if ((nameMatch || translationMatch) && !allMatches.has(tag.name)) {
                allMatches.set(tag.name, tag);
            }
            cursor.continue();
        }
    };

    // Iterate through all tags and collect matches
    await new Promise((resolve, reject) => {
        const request = store.openCursor();
        request.onerror = (event) => reject(event.target.error);
        request.onsuccess = (event) => {
            const cursor = event.target.result;
            if (cursor) {
                processCursor(cursor);
            } else {
                resolve();
            }
        };
    });

    let results = Array.from(allMatches.values());

    // Custom sorting logic
    results.sort((a, b) => {
        // tags.json tags (hot: -1) always come first
        if (a.hot === -1 && b.hot !== -1) return -1;
        if (a.hot !== -1 && b.hot === -1) return 1;

        // If both are from tags.json, sort by name alphabetically
        if (a.hot === -1 && b.hot === -1) {
            return a.name.localeCompare(b.name);
        }

        // For other tags, sort based on sortBy option
        if (sortBy === 'hot_desc') {
            return b.hot - a.hot;
        }
        if (sortBy === 'hot_asc') {
            return a.hot - b.hot;
        }
        if (sortBy === 'key_asc') {
            return a.name.localeCompare(b.name);
        }

        // Default fallback (should not be reached if sortBy is one of the above)
        return 0;
    });

    return results.slice(0, limit);
}

async function addTag(tag) {
    const db = await openDB();
    const transaction = db.transaction('tags', 'readwrite');
    const store = transaction.objectStore('tags');

    const newTag = {
        name: tag.name,
        translation: tag.translation || '',
        hot: tag.hot || 0,
        fileName: tag.fileName || 'manual' // Default to 'manual' if not provided
    };

    return new Promise((resolve, reject) => {
        const request = store.put(newTag);
        request.onsuccess = () => resolve(request.result);
        request.onerror = (event) => reject(event.target.error);
    });
}

/**
 * 同步服务器图片文件夹与插件存储的图片信息
 * 删除服务器上存在但插件存储中不存在的图片
 * @param {string} folderName - 要同步的文件夹名称（默认为 'chatu8'）
 * @param {Function} onProgress - 进度回调函数 (current, total, message)
 * @returns {Promise<{deletedCount: number, errors: Array}>}
 */
export async function syncServerImagesWithStorage(folderName = 'chatu8', onProgress = null) {
    const result = {
        deletedCount: 0,
        removedGhostCount: 0,
        errors: []
    };

    try {
        if (onProgress) onProgress(0, 100, '正在获取服务器图片列表...');
        // 1. 获取服务器文件夹中的所有图片（返回的是文件名列表，不带路径）
        const response = await fetch('/api/images/list', {
            method: 'POST',
            headers: getRequestHeaders(window.token),
            body: JSON.stringify({ folder: folderName })
        });

        if (!response.ok) {
            throw new Error(`获取服务器图片列表失败: ${response.statusText}`);
        }

        const serverImageNames = await response.json();

        if (!Array.isArray(serverImageNames)) {
            console.log('[Sync] 服务器返回数据格式异常，无需同步');
            if (onProgress) onProgress(100, 100, '服务器返回数据异常');
            return result;
        }
        // 注意：即使服务器列表为空，也要继续执行反向清理，以便清掉列表里所有的服务器幽灵

        if (onProgress) onProgress(10, 100, '正在清理列表中已不存在于服务器的条目...');

        // 1.5 反向清理：列表里有 path 但服务器实际已不存在的"幽灵条目"
        const serverFileSet = new Set(serverImageNames);
        const storage = extension_settings[extensionName].jiuguanStorage || {};
        const metadata = await getMetadata();

        // 统计 path 数量供调试
        let totalStoragePaths = 0;
        for (const md5 in storage) {
            if (storage[md5]?.images) {
                storage[md5].images.forEach(img => { if (img.path) totalStoragePaths++; });
            }
        }
        let totalMetadataPaths = 0;
        for (const md5 in metadata) {
            if (metadata[md5]?.images) {
                metadata[md5].images.forEach(img => { if (img.path) totalMetadataPaths++; });
            }
        }
        console.log(`[Sync] 服务器实际文件数: ${serverImageNames.length}, jiuguanStorage 中带path条目: ${totalStoragePaths}, IndexedDB metadata 中带path条目: ${totalMetadataPaths}`);

        let storageChanged = false;
        let metadataChanged = false;
        const ghostUuidsToDelete = new Set();

        // 判定幽灵：只要条目有服务器路径(path)，且对应文件名已不在服务器列表中，即为幽灵
        // 注意：原始存储里 source 字段是 getAllImageMetadata 读取时临时合成的，
        //       jiuguanStorage / IndexedDB metadata 的 entry 上一般没有 source 字段，所以不能靠 source 判定。
        const isGhost = (img) => {
            if (!img || !img.path) return false;
            const fileName = img.path.split('/').pop();
            return !!fileName && !serverFileSet.has(fileName);
        };

        // 清理 jiuguanStorage 中的幽灵
        for (const md5 of Object.keys(storage)) {
            const entry = storage[md5];
            if (!entry || !Array.isArray(entry.images)) continue;
            const before = entry.images.length;
            entry.images = entry.images.filter(img => !isGhost(img));
            const removed = before - entry.images.length;
            if (removed > 0) {
                storageChanged = true;
                result.removedGhostCount += removed;
                if (entry.images.length === 0) {
                    delete storage[md5];
                    if (window.imagesid && window.imagesid[md5]) {
                        delete window.imagesid[md5];
                    }
                } else {
                    if (entry.index >= entry.images.length) {
                        entry.index = entry.images.length - 1;
                    }
                    if (window.imagesid && window.imagesid[md5]) {
                        const dates = entry.images.map(img => img.date).filter(d => d);
                        if (dates.length > 0) {
                            window.imagesid[md5] = Math.max(...dates);
                        } else {
                            delete window.imagesid[md5];
                        }
                    }
                }
            }
        }

        // 清理 IndexedDB metadata 中的幽灵
        for (const md5 of Object.keys(metadata)) {
            const entry = metadata[md5];
            if (!entry || !Array.isArray(entry.images)) continue;
            const before = entry.images.length;
            const removedItems = [];
            entry.images = entry.images.filter(img => {
                if (isGhost(img)) {
                    removedItems.push(img);
                    return false;
                }
                return true;
            });
            if (removedItems.length > 0) {
                metadataChanged = true;
                result.removedGhostCount += removedItems.length;
                removedItems.forEach(img => {
                    if (img.uuid) ghostUuidsToDelete.add(img.uuid);
                    if (img.thumbnail_uuid) ghostUuidsToDelete.add(img.thumbnail_uuid);
                });
                if (entry.images.length === 0) {
                    delete metadata[md5];
                    if (window.imagesid && window.imagesid[md5]) {
                        delete window.imagesid[md5];
                    }
                } else {
                    if (entry.index >= entry.images.length) {
                        entry.index = entry.images.length - 1;
                    }
                }
            }
        }

        // 删除幽灵条目对应的 IndexedDB 实体（一般 source='server' 不会有 blob，但保险起见尝试）
        if (ghostUuidsToDelete.size > 0) {
            try {
                const db = await openDB();
                const tx = db.transaction([objectStoreName], 'readwrite');
                const store = tx.objectStore(objectStoreName);
                await Promise.all(Array.from(ghostUuidsToDelete).map(uuid => new Promise((resolve) => {
                    const req = store.delete(uuid);
                    req.onsuccess = resolve;
                    req.onerror = resolve; // 忽略单个失败
                })));
            } catch (_) { /* noop */ }
        }

        if (storageChanged) {
            saveSettingsDebounced();
            // 同步到服务器隐写存储文件，否则幽灵会在刷新后复活
            try {
                await updateStegoImage();
            } catch (e) {
                console.error('[Sync] updateStegoImage failed:', e);
            }
        }
        if (metadataChanged) await setMetadata(metadata);

        if (result.removedGhostCount > 0) {
            console.log(`[Sync] 反向清理：从列表中移除了 ${result.removedGhostCount} 个服务器已不存在的幽灵条目`);
        }

        if (onProgress) onProgress(20, 100, '正在分析插件存储...');

        // 2. 获取插件存储的所有图片信息（重新读取已清理后的数据）

        // 3. 收集所有在插件存储中的图片文件名（从完整路径中提取文件名）
        const storedFileNames = new Set();

        // 从服务器存储收集文件名
        for (const md5 in storage) {
            const entry = storage[md5];
            if (entry && entry.images) {
                entry.images.forEach(img => {
                    if (img.path) {
                        // 从路径中提取文件名：user/images/chatu8/xxx.png -> xxx.png
                        const fileName = img.path.split('/').pop();
                        storedFileNames.add(fileName);
                    }
                    if (img.thumbnail_path) {
                        const fileName = img.thumbnail_path.split('/').pop();
                        storedFileNames.add(fileName);
                    }
                });
            }
        }

        // 从 IndexedDB 元数据收集文件名（如果有的话）
        for (const md5 in metadata) {
            const entry = metadata[md5];
            if (entry && entry.images) {
                entry.images.forEach(img => {
                    if (img.path) {
                        const fileName = img.path.split('/').pop();
                        storedFileNames.add(fileName);
                    }
                    if (img.thumbnail_path) {
                        const fileName = img.thumbnail_path.split('/').pop();
                        storedFileNames.add(fileName);
                    }
                });
            }
        }

        console.log(`[Sync] 服务器图片总数: ${serverImageNames.length}, 插件存储文件名数: ${storedFileNames.size}`);

        // 4. 找出服务器上存在但插件存储中不存在的图片文件名
        const fileNamesToDelete = serverImageNames.filter(fileName => !storedFileNames.has(fileName));

        console.log(`[Sync] 找到 ${fileNamesToDelete.length} 个需要删除的图片`);

        if (fileNamesToDelete.length === 0) {
            if (onProgress) onProgress(100, 100, '所有图片已同步，无需删除');
            return result;
        }

        // 5. 删除这些图片
        const totalToDelete = fileNamesToDelete.length;
        for (let i = 0; i < fileNamesToDelete.length; i++) {
            const fileName = fileNamesToDelete[i];
            const progress = Math.floor(20 + (i / totalToDelete) * 80);
            if (onProgress) onProgress(progress, 100, `正在删除 (${i + 1}/${totalToDelete}): ${fileName}`);
            try {
                // 构造完整路径：user/images/folderName/fileName
                const fullPath = `user/images/${folderName}/${fileName}`;

                const deleteResponse = await fetch('/api/images/delete', {
                    method: 'POST',
                    headers: getRequestHeaders(window.token),
                    body: JSON.stringify({ path: fullPath })
                });

                if (deleteResponse.ok) {
                    result.deletedCount++;
                    console.log(`[Sync] 已删除: ${fullPath}`);
                } else if (deleteResponse.status === 404) {
                    // 服务器上已不存在，视为已清理
                    result.deletedCount++;
                    console.log(`[Sync] 已不存在(视为已删除): ${fullPath}`);
                } else {
                    const error = `删除失败 (${deleteResponse.status}): ${fullPath}`;
                    result.errors.push(error);
                    console.error(`[Sync] ${error}`);
                }
            } catch (error) {
                const errorMsg = `删除异常: ${fileName} - ${error.message}`;
                result.errors.push(errorMsg);
                console.error(`[Sync] ${errorMsg}`);
            }

            // 添加小延迟避免过快请求
            await new Promise(resolve => setTimeout(resolve, 50));
        }

        if (onProgress) onProgress(100, 100, '同步完成');
        console.log(`[Sync] 同步完成。删除 ${result.deletedCount} 个图片，失败 ${result.errors.length} 个`);
        return result;

    } catch (error) {
        console.error('[Sync] 同步过程发生错误:', error);
        result.errors.push(error.message);
        return result;
    }
}

// ========== 隐写术存储功能 ==========

const STEGO_FOLDER = 'chatu8List';
const STEGO_FILENAME = '图片缓存列表'; // 注意：服务器会自动添加 .png 扩展名

/**
 * 初始化 jiuguanStorage - 从隐写图片加载
 * 在 UI 初始化时调用
 */
export async function initJiuguanStorage() {
    const stego = new ImageSteganography();

    try {
        console.log('[Stego] 开始初始化 jiuguanStorage...');

        // 1. 尝试从服务器获取隐写图片
        const imageBase64 = await fetchStegoImage();

        if (imageBase64) {
            console.log('[Stego] 找到隐写图片，开始解码...');

            try {
                // 2. 解码图片，获取数据
                const data = await stego.decode(imageBase64);

                // 3. 同步到 extension_settings (以图片为准)
                if (!extension_settings[extensionName].jiuguanStorage) {
                    extension_settings[extensionName].jiuguanStorage = {};
                }
                extension_settings[extensionName].jiuguanStorage = data;
                console.log('[Stego] 从隐写图片加载数据成功，共', Object.keys(data).length, '个条目');
            } catch (decodeError) {
                console.warn('[Stego] 隐写图片解码失败（可能是旧格式或已损坏），将使用 extension_settings 中的数据重建:', decodeError.message);

                // 解码失败，使用 extension_settings 中的现有数据
                if (!extension_settings[extensionName].jiuguanStorage) {
                    extension_settings[extensionName].jiuguanStorage = {};
                }

                const currentData = extension_settings[extensionName].jiuguanStorage;

                // 如果有数据，尝试重建隐写图片
                if (currentData && Object.keys(currentData).length > 0) {
                    console.log('[Stego] 检测到现有数据，尝试重建隐写图片...');
                    try {
                        await deleteStegoImage(); // 删除损坏的旧图片
                        await createStegoImage(); // 用现有数据创建新图片
                        console.log('[Stego] 隐写图片重建成功');
                    } catch (rebuildError) {
                        console.error('[Stego] 重建隐写图片失败:', rebuildError);
                    }
                } else {
                    console.log('[Stego] 无现有数据可用于重建');
                    // 删除损坏的图片
                    try {
                        await deleteStegoImage();
                    } catch (delError) {
                        console.warn('[Stego] 删除损坏图片失败:', delError);
                    }
                }
            }
        } else {
            // 4. 图片不存在 - 检查是否需要创建
            console.log('[Stego] 隐写图片不存在，检查是否需要创建...');

            // 初始化存储对象（如果不存在）
            if (!extension_settings[extensionName].jiuguanStorage) {
                extension_settings[extensionName].jiuguanStorage = {};
            }

            const currentData = extension_settings[extensionName].jiuguanStorage;
            if (currentData && Object.keys(currentData).length > 0) {
                console.log('[Stego] 发现现有数据，创建隐写图片...');
                await createStegoImage();
            } else {
                console.log('[Stego] 无需创建隐写图片（数据为空）');
            }
        }
    } catch (error) {
        console.error('[Stego] 初始化失败:', error);
        // 5. 降级方案：使用现有 extension_settings 数据
        if (!extension_settings[extensionName].jiuguanStorage) {
            extension_settings[extensionName].jiuguanStorage = {};
        }
        console.log('[Stego] 使用现有设置数据作为降级方案');
    }
}

/**
 * ArrayBuffer 转 Base64 Data URL
 * @param {ArrayBuffer} buffer 
 * @returns {string}
 */
function arrayBufferToBase64DataURL(buffer) {
    const bytes = new Uint8Array(buffer);
    let binary = '';
    for (let i = 0; i < bytes.byteLength; i++) {
        binary += String.fromCharCode(bytes[i]);
    }
    const base64 = window.btoa(binary);
    return `data:image/png;base64,${base64}`;
}

/**
 * 从服务器获取隐写图片
 * @returns {Promise<string|null>} Base64 图片数据
 */
async function fetchStegoImage() {
    try {
        // 直接通过 GET 请求获取固定路径的图片
        const imagePath = `user/images/${STEGO_FOLDER}/${STEGO_FILENAME}.png`;
        const response = await fetch(`/${imagePath}`, {
            method: 'GET',
            headers: getRequestHeaders(window.token)
        });

        if (response.ok) {
            // 使用 ArrayBuffer 避免 Blob 的重编码问题
            const arrayBuffer = await response.arrayBuffer();
            return arrayBufferToBase64DataURL(arrayBuffer);
        }
        return null;
    } catch (error) {
        console.error('[Stego] 获取图片失败:', error);
        return null;
    }
}

/**
 * 创建新的隐写图片并上传
 * 使用当前 extension_settings 中的数据
 */
async function createStegoImage() {
    const stego = new ImageSteganography();
    const currentData = extension_settings[extensionName].jiuguanStorage || {};

    try {
        // 1. 编码数据到图片
        const imageBase64 = await stego.encode(currentData);

        // 2. 上传到服务器
        await uploadStegoImage(imageBase64);

        console.log('[Stego] 新隐写图片创建并上传成功');
    } catch (error) {
        console.error('[Stego] 创建隐写图片失败:', error);
        throw error;
    }
}

/**
 * 更新隐写图片
 * 当 jiuguanStorage 数据变化时调用
 * 操作：删除旧图 → 编码新数据 → 上传新图
 */
export async function updateStegoImage() {
    const stego = new ImageSteganography();

    try {
        // 1. 获取最新数据
        const currentData = extension_settings[extensionName].jiuguanStorage || {};

        // 即使数据为空也创建隐写图片（用于标记存在）
        // 不再删除隐写图片，避免意料之外的错误
        console.log('[Stego] 准备更新隐写图片，数据条目数:', Object.keys(currentData).length);

        // 2. 编码为图片（空对象也会被编码）
        const imageBase64 = await stego.encode(currentData);

        // 3. 删除旧图片
        await deleteStegoImage();

        // 4. 上传新图片
        await uploadStegoImage(imageBase64);

        console.log('[Stego] 隐写图片更新成功');
    } catch (error) {
        console.error('[Stego] 更新隐写图片失败:', error);
        // 不抛出错误，确保主流程继续
    }
}

/**
 * 上传隐写图片到服务器
 * @param {string} imageBase64 - Base64 图片数据
 */
async function uploadStegoImage(imageBase64) {
    const base64Data = imageBase64.split(',')[1] || imageBase64;

    const response = await fetch('/api/images/upload', {
        method: 'POST',
        headers: getRequestHeaders(window.token),
        body: JSON.stringify({
            image: base64Data,
            format: 'png',
            ch_name: STEGO_FOLDER,
            filename: STEGO_FILENAME
        })
    });

    if (!response.ok) {
        throw new Error(`上传失败: ${response.statusText}`);
    }

    const result = await response.json();
    console.log('[Stego] 图片上传成功:', result.path);
    return result.path;
}

/**
 * 删除服务器上的隐写图片
 */
async function deleteStegoImage() {
    try {
        const response = await fetch('/api/images/delete', {
            method: 'POST',
            headers: getRequestHeaders(window.token),
            body: JSON.stringify({
                path: `user/images/${STEGO_FOLDER}/${STEGO_FILENAME}.png`
            })
        });

        if (response.ok) {
            console.log('[Stego] 旧图片删除成功');
        }
    } catch (error) {
        // 忽略删除错误（文件可能不存在）
        console.warn('[Stego] 删除旧图片失败（可能不存在）:', error);
    }
}

// ========== 导出 API ==========

export const dbs = {
    openDB,
    migrateDatabase,
    setItemImg,
    getItemImg,
    getItemBlob,
    updateImageIndex,
    deleteImage,
    getAllImages,
    getAllImageBlobs,
    getImageByUUID,
    getImageBlobByUUID,
    getImageThumbnailBlobByUUID,
    getAllImageMetadata,
    deleteMultipleImages,
    deleteImagesByUuids,
    getMergedAndSortedImages,
    syncServerImagesWithStorage,
    storeReadOnly,
    storeReadWrite,
    storeDelete,
    // 隐写术功能
    initJiuguanStorage,
    updateStegoImage,
    // Vocabulary functions
    installVocabulary,
    uninstallVocabulary,
    getInstalledVocabularies,
    getTagsTreeData,
    searchTags,
    addTag,
    getManualTags,
    deleteTagByName,
};
