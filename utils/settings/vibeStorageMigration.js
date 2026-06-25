// @ts-nocheck
import { extension_settings } from "../../../../../extensions.js";
import { saveSettingsDebounced } from "../../../../../../script.js";
import { extensionName } from '../config.js';
import { getConfigImage, getConfigText, saveConfigImage, saveConfigText } from '../configDatabase.js';

function getSettings() {
    return extension_settings[extensionName];
}

export function shouldStoreVibeInServer() {
    return getSettings().vibeJiuguanchucun !== "false";
}

export function getVibeStorageOptions() {
    const useServer = shouldStoreVibeInServer();
    return {
        forceServer: useServer,
        forceIndexedDB: !useServer
    };
}

export async function ensureVibeDataStoredByPreference(vibeDataId) {
    if (!vibeDataId || !shouldStoreVibeInServer()) {
        return false;
    }

    const serverStorage = getSettings().configImageStorage || {};
    if (serverStorage[vibeDataId]?.path) {
        return true;
    }

    const text = await getConfigText(vibeDataId);
    if (!text) {
        return false;
    }

    await saveConfigText(text, {
        id: vibeDataId,
        forceServer: true,
        filename: `vibe_data_${vibeDataId}`
    });

    return true;
}

function setServerStorageEnabled() {
    const settings = getSettings();
    settings.vibeJiuguanchucun = "true";

    const checkbox = document.getElementById('vibeJiuguanchucun');
    if (checkbox) {
        checkbox.checked = true;
    }

    saveSettingsDebounced();
}

function addStringId(targetSet, value) {
    if (typeof value === 'string' && value.trim()) {
        targetSet.add(value);
    }
}

function collectVibeStorageIds() {
    const settings = getSettings();
    const vibeDataIds = new Set();
    const imageIds = new Set();

    const vibePresets = settings.vibePresets || {};
    for (const preset of Object.values(vibePresets)) {
        if (!preset || typeof preset !== 'object') continue;
        addStringId(vibeDataIds, preset.vibeDataId);
        addStringId(imageIds, preset.imageId);
    }

    const vibeGroups = settings.vibeGroups || {};
    for (const group of Object.values(vibeGroups)) {
        if (!group || typeof group !== 'object') continue;
        addStringId(imageIds, group.coverImageId);

        if (Array.isArray(group.vibes)) {
            for (const vibe of group.vibes) {
                addStringId(vibeDataIds, vibe?.vibeDataId);
            }
        }
    }

    return {
        vibeDataIds: Array.from(vibeDataIds),
        imageIds: Array.from(imageIds)
    };
}

function getServerStorage() {
    const settings = getSettings();
    if (!settings.configImageStorage) {
        settings.configImageStorage = {};
    }
    return settings.configImageStorage;
}

function getImageFormatFromDataUrl(dataUrl) {
    if (typeof dataUrl !== 'string') return 'png';

    const match = dataUrl.match(/^data:image\/([^;,]+)/i);
    if (!match) return 'png';

    const format = match[1].toLowerCase();
    return format === 'jpeg' ? 'jpg' : format;
}

function createEmptyResult() {
    return {
        success: true,
        cancelled: false,
        totalVibeData: 0,
        totalImages: 0,
        migratedVibeData: 0,
        migratedImages: 0,
        skippedAlreadyServer: 0,
        missing: 0,
        errors: []
    };
}

function reportProgress(onProgress, current, total, message) {
    if (typeof onProgress === 'function') {
        onProgress(current, total, message);
    }
}

export function formatVibeStorageMigrationResult(result) {
    if (result.cancelled) {
        return '已取消 Vibe 酒馆存储迁移。';
    }

    const lines = [
        'Vibe 酒馆存储迁移完成。',
        `Vibe 数据: ${result.migratedVibeData}/${result.totalVibeData} 个已迁移`,
        `图片/封面: ${result.migratedImages}/${result.totalImages} 个已迁移`
    ];

    if (result.skippedAlreadyServer > 0) {
        lines.push(`已在酒馆存储中，跳过 ${result.skippedAlreadyServer} 个`);
    }

    if (result.missing > 0) {
        lines.push(`本地未找到 ${result.missing} 个引用，请检查是否已清理浏览器缓存`);
    }

    if (result.errors.length > 0) {
        lines.push(`失败 ${result.errors.length} 个，详情见控制台。`);
    }

    return lines.join('\n');
}

export async function migrateVibeStorageToServer(options = {}) {
    const { promptEnable = false, onProgress = null } = options;
    const result = createEmptyResult();

    if (!shouldStoreVibeInServer()) {
        if (promptEnable) {
            const shouldEnable = confirm(
                '当前没有开启“缓存 Vibe 到酒馆”。\n\n' +
                '迁移 Vibe 需要先开启它。开启后，Vibe 数据会上传到酒馆服务器；普通生成图缓存不受影响；本地 IndexedDB 会保留为回退。\n\n' +
                '是否现在开启并继续迁移？'
            );

            if (!shouldEnable) {
                result.success = false;
                result.cancelled = true;
                return result;
            }
        }

        setServerStorageEnabled();
    }

    const { vibeDataIds, imageIds } = collectVibeStorageIds();
    result.totalVibeData = vibeDataIds.length;
    result.totalImages = imageIds.length;

    const total = vibeDataIds.length + imageIds.length;
    let current = 0;
    const serverStorage = getServerStorage();

    for (const vibeDataId of vibeDataIds) {
        current++;
        reportProgress(onProgress, current, total, `正在迁移 Vibe 数据 ${current}/${total}`);

        if (serverStorage[vibeDataId]?.path) {
            result.skippedAlreadyServer++;
            continue;
        }

        try {
            const text = await getConfigText(vibeDataId);
            if (!text) {
                result.missing++;
                result.errors.push({ id: vibeDataId, type: 'vibeData', error: '本地未找到 Vibe 数据' });
                continue;
            }

            await saveConfigText(text, {
                id: vibeDataId,
                forceServer: true,
                filename: `vibe_data_${vibeDataId}`
            });
            result.migratedVibeData++;
        } catch (error) {
            result.errors.push({ id: vibeDataId, type: 'vibeData', error: error.message });
            console.error('[VibeStorage] 迁移 Vibe 数据失败:', vibeDataId, error);
        }
    }

    for (const imageId of imageIds) {
        current++;
        reportProgress(onProgress, current, total, `正在迁移 Vibe 图片 ${current}/${total}`);

        if (serverStorage[imageId]?.path) {
            result.skippedAlreadyServer++;
            continue;
        }

        try {
            const imageData = await getConfigImage(imageId);
            if (!imageData) {
                result.missing++;
                result.errors.push({ id: imageId, type: 'image', error: '本地未找到图片' });
                continue;
            }

            await saveConfigImage(imageData, {
                id: imageId,
                forceServer: true,
                format: getImageFormatFromDataUrl(imageData),
                filename: `vibe_image_${imageId}`
            });
            result.migratedImages++;
        } catch (error) {
            result.errors.push({ id: imageId, type: 'image', error: error.message });
            console.error('[VibeStorage] 迁移 Vibe 图片失败:', imageId, error);
        }
    }

    saveSettingsDebounced();
    result.success = result.errors.length === 0;
    reportProgress(onProgress, total || 1, total || 1, 'Vibe 酒馆存储迁移完成');
    return result;
}
