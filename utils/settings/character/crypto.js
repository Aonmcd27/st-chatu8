// @ts-nocheck
/**
 * Base64 加密/解密工具模块
 * 用于角色和服装预设的导入/导出加密
 */

import { stylishConfirm } from '../../ui_common.js';

// ========== 基础加密函数 ==========

/**
 * Base64 加密文本(支持 UTF-8 中文)
 * @param {string} text - 要加密的文本
 * @returns {string} Base64 编码后的文本
 */
export function encryptBase64(text) {
    if (!text) return '';
    try {
        return btoa(unescape(encodeURIComponent(text)));
    } catch (e) {
        console.error('Base64 加密失败:', e);
        return text;
    }
}

/**
 * Base64 解密文本(支持 UTF-8 中文)
 * @param {string} encodedText - Base64 编码的文本
 * @returns {string} 解密后的文本
 */
export function decryptBase64(encodedText) {
    if (!encodedText) return '';
    try {
        return decodeURIComponent(escape(atob(encodedText)));
    } catch (e) {
        console.error('Base64 解密失败:', e);
        return encodedText;
    }
}

// ========== 对象字段加密 ==========

/**
 * 加密对象中的文本字段
 * @param {Object} obj - 要加密的对象
 * @param {Array<string>} fields - 需要加密的字段名数组
 * @returns {Object} 加密后的对象
 */
export function encryptObjectFields(obj, fields) {
    const encrypted = JSON.parse(JSON.stringify(obj)); // 深拷贝
    fields.forEach(field => {
        if (encrypted[field]) {
            encrypted[field] = encryptBase64(encrypted[field]);
        }
    });
    return encrypted;
}

/**
 * 解密对象中的文本字段
 * @param {Object} obj - 要解密的对象
 * @param {Array<string>} fields - 需要解密的字段名数组
 * @returns {Object} 解密后的对象
 */
export function decryptObjectFields(obj, fields) {
    const decrypted = JSON.parse(JSON.stringify(obj)); // 深拷贝
    fields.forEach(field => {
        if (decrypted[field]) {
            decrypted[field] = decryptBase64(decrypted[field]);
        }
    });
    return decrypted;
}

// ========== 预设加密函数 ==========

/**
 * 加密角色预设
 * @param {Object} preset - 角色预设对象
 * @returns {Object} 加密后的角色预设
 */
export function encryptCharacterPreset(preset) {
    const fields = ['nameCN', 'nameEN', 'facialFeatures', 'facialFeaturesBack',
        'upperBodySFW', 'upperBodySFWBack', 'fullBodySFW', 'fullBodySFWBack',
        'upperBodyNSFW', 'upperBodyNSFWBack', 'fullBodyNSFW', 'fullBodyNSFWBack'];
    const encrypted = encryptObjectFields(preset, fields);
    // 加密服装列表
    if (preset.outfits && Array.isArray(preset.outfits)) {
        encrypted.outfits = preset.outfits.map(name => encryptBase64(name));
    }
    return encrypted;
}

/**
 * 解密角色预设
 * @param {Object} preset - 加密的角色预设对象
 * @returns {Object} 解密后的角色预设
 */
export function decryptCharacterPreset(preset) {
    const fields = ['nameCN', 'nameEN', 'facialFeatures', 'facialFeaturesBack',
        'upperBodySFW', 'upperBodySFWBack', 'fullBodySFW', 'fullBodySFWBack',
        'upperBodyNSFW', 'upperBodyNSFWBack', 'fullBodyNSFW', 'fullBodyNSFWBack'];
    const decrypted = decryptObjectFields(preset, fields);
    // 解密服装列表
    if (preset.outfits && Array.isArray(preset.outfits)) {
        decrypted.outfits = preset.outfits.map(name => decryptBase64(name));
    }
    return decrypted;
}

/**
 * 加密服装预设
 * @param {Object} preset - 服装预设对象
 * @returns {Object} 加密后的服装预设
 */
export function encryptOutfitPreset(preset) {
    const fields = ['nameCN', 'nameEN', 'upperBody', 'upperBodyBack', 'fullBody', 'fullBodyBack'];
    return encryptObjectFields(preset, fields);
}

/**
 * 解密服装预设
 * @param {Object} preset - 加密的服装预设对象
 * @returns {Object} 解密后的服装预设
 */
export function decryptOutfitPreset(preset) {
    const fields = ['nameCN', 'nameEN', 'upperBody', 'upperBodyBack', 'fullBody', 'fullBodyBack'];
    return decryptObjectFields(preset, fields);
}

/**
 * 加密列表预设(角色启用/通用角色/通用服装列表)
 * @param {Object} preset - 列表预设对象
 * @param {string} listKey - 列表字段名('characters' 或 'outfits')
 * @returns {Object} 加密后的列表预设
 */
export function encryptListPreset(preset, listKey) {
    const encrypted = JSON.parse(JSON.stringify(preset));
    if (preset[listKey] && Array.isArray(preset[listKey])) {
        encrypted[listKey] = preset[listKey].map(name => encryptBase64(name));
    }
    return encrypted;
}

/**
 * 解密列表预设
 * @param {Object} preset - 加密的列表预设对象
 * @param {string} listKey - 列表字段名('characters' 或 'outfits')
 * @returns {Object} 解密后的列表预设
 */
export function decryptListPreset(preset, listKey) {
    const decrypted = JSON.parse(JSON.stringify(preset));
    if (preset[listKey] && Array.isArray(preset[listKey])) {
        decrypted[listKey] = preset[listKey].map(name => decryptBase64(name));
    }
    return decrypted;
}

// ========== 加密检测和名称映射 ==========

/**
 * 检测数据是否已加密
 * @param {Object} data - 要检测的数据对象
 * @returns {boolean} 是否已加密
 */
export function isEncryptedData(data) {
    return data && data._encrypted === true;
}

/**
 * 创建预设名称映射并加密
 * @param {Object} presets - 预设对象
 * @param {string} prefix - ID前缀 (如 'CHAR_', 'OUTFIT_')
 * @returns {Object} { encryptedPresets, nameMap }
 */
export function encryptPresetNames(presets, prefix) {
    const nameMap = {};
    const encryptedPresets = {};
    let counter = 1;

    for (const name in presets) {
        const encId = `${prefix}${String(counter).padStart(3, '0')}`;
        nameMap[encId] = name;  // 映射: 加密ID -> 原始名称
        encryptedPresets[encId] = presets[name];
        counter++;
    }

    return { encryptedPresets, nameMap };
}

/**
 * 解密预设名称映射
 * @param {Object} encryptedPresets - 加密的预设对象
 * @param {Object} nameMap - 名称映射表
 * @returns {Object} 恢复原始名称的预设对象
 */
export function decryptPresetNames(encryptedPresets, nameMap) {
    const decryptedPresets = {};

    for (const encId in encryptedPresets) {
        const originalName = nameMap[encId];
        if (originalName) {
            decryptedPresets[originalName] = encryptedPresets[encId];
        }
    }

    return decryptedPresets;
}

/**
 * 替换对象中的名称引用
 * @param {any} obj - 要处理的对象/数组/值
 * @param {Object} nameMap - 名称映射表 (原始名称 -> 加密ID)
 * @returns {any} 替换后的对象
 */
export function replaceNameReferences(obj, nameMap) {
    if (Array.isArray(obj)) {
        // 数组：替换每个元素
        return obj.map(item => {
            if (typeof item === 'string' && nameMap[item]) {
                return nameMap[item];
            }
            return replaceNameReferences(item, nameMap);
        });
    } else if (obj && typeof obj === 'object') {
        // 对象：递归处理所有属性
        const result = {};
        for (const key in obj) {
            result[key] = replaceNameReferences(obj[key], nameMap);
        }
        return result;
    }
    // 基本类型：直接返回
    return obj;
}

/**
 * 恢复对象中的名称引用
 * @param {any} obj - 要处理的对象/数组/值
 * @param {Object} reverseMap - 反向映射表 (加密ID -> 原始名称)
 * @returns {any} 恢复后的对象
 */
export function restoreNameReferences(obj, reverseMap) {
    if (Array.isArray(obj)) {
        // 数组：恢复每个元素
        return obj.map(item => {
            if (typeof item === 'string' && reverseMap[item]) {
                return reverseMap[item];
            }
            return restoreNameReferences(item, reverseMap);
        });
    } else if (obj && typeof obj === 'object') {
        // 对象：递归处理所有属性
        const result = {};
        for (const key in obj) {
            result[key] = restoreNameReferences(obj[key], reverseMap);
        }
        return result;
    }
    // 基本类型：直接返回
    return obj;
}

// ========== 导出导入加密 ==========

/**
 * 通用加密导出助手 - 询问用户并加密数据
 * @param {Object} dataToExport - 要导出的数据对象
 * @returns {Promise<Object>} 加密后的数据对象
 */
export async function encryptExportData(dataToExport) {
    // 询问是否加密导出
    const shouldEncrypt = await stylishConfirm("是否对导出内容进行 Base64 加密保护?\n\n加密后可防止文本编辑器直接查看敏感内容。");

    if (shouldEncrypt) {
        // 创建所有名称映射表
        const allNameMaps = {};

        // 第一步：创建所有名称映射表
        const charForwardMap = {};  // 原始名称 -> 加密ID
        const outfitForwardMap = {};

        // 加密角色数据
        if (dataToExport.characters) {
            const { encryptedPresets: encChars, nameMap: charMap } = encryptPresetNames(dataToExport.characters, 'CHAR_');
            allNameMaps.characters = charMap;

            // 创建正向映射
            for (const encId in charMap) {
                charForwardMap[charMap[encId]] = encId;
            }
        }

        // 加密服装数据（先创建映射，稍后加密内容）
        if (dataToExport.outfits) {
            const { encryptedPresets: encOutfits, nameMap: outfitMap } = encryptPresetNames(dataToExport.outfits, 'OUTFIT_');
            allNameMaps.outfits = outfitMap;

            // 创建正向映射
            for (const encId in outfitMap) {
                outfitForwardMap[outfitMap[encId]] = encId;
            }
        }

        // 第二步：加密角色内容并替换服装引用
        if (dataToExport.characters) {
            const { encryptedPresets: encChars, nameMap: charMap } = encryptPresetNames(dataToExport.characters, 'CHAR_');

            const encryptedCharacters = {};
            for (const encId in encChars) {
                const charPreset = encChars[encId];
                // 加密角色内容
                let encrypted = encryptCharacterPreset(charPreset);

                // 替换服装名称引用
                if (encrypted.outfits && encrypted.outfits.length > 0) {
                    encrypted.outfits = encrypted.outfits.map(name => {
                        const decrypted = decryptBase64(name);
                        const encryptedId = outfitForwardMap[decrypted] || decrypted;
                        return encryptBase64(encryptedId);
                    });
                }

                encryptedCharacters[encId] = encrypted;
            }
            dataToExport.characters = encryptedCharacters;
        }

        // 第三步：加密服装内容
        if (dataToExport.outfits) {
            const { encryptedPresets: encOutfits } = encryptPresetNames(dataToExport.outfits, 'OUTFIT_');

            const encryptedOutfits = {};
            for (const encId in encOutfits) {
                encryptedOutfits[encId] = encryptOutfitPreset(encOutfits[encId]);
            }
            dataToExport.outfits = encryptedOutfits;
        }

        // 第四步：加密角色启用列表
        if (dataToExport.characterEnablePresets) {
            const { encryptedPresets: encPresets, nameMap: presetMap } = encryptPresetNames(dataToExport.characterEnablePresets, 'CHAR_EN_');
            allNameMaps.characterEnablePresets = presetMap;

            const encryptedPresets = {};
            for (const encId in encPresets) {
                const preset = encPresets[encId];
                // 加密列表内容
                let encrypted = encryptListPreset(preset, 'characters');
                // 替换角色名称引用
                if (encrypted.characters) {
                    encrypted.characters = encrypted.characters.map(name => {
                        const decrypted = decryptBase64(name);
                        return encryptBase64(charForwardMap[decrypted] || decrypted);
                    });
                }
                encryptedPresets[encId] = encrypted;
            }
            dataToExport.characterEnablePresets = encryptedPresets;
        }

        // 加密服装启用列表
        if (dataToExport.outfitEnablePresets) {
            const { encryptedPresets: encPresets, nameMap: presetMap } = encryptPresetNames(dataToExport.outfitEnablePresets, 'OUTFIT_EN_');
            allNameMaps.outfitEnablePresets = presetMap;

            const encryptedPresets = {};
            for (const encId in encPresets) {
                const preset = encPresets[encId];
                let encrypted = encryptListPreset(preset, 'outfits');
                // 替换服装名称引用
                if (encrypted.outfits) {
                    encrypted.outfits = encrypted.outfits.map(name => {
                        const decrypted = decryptBase64(name);
                        return encryptBase64(outfitForwardMap[decrypted] || decrypted);
                    });
                }
                encryptedPresets[encId] = encrypted;
            }
            dataToExport.outfitEnablePresets = encryptedPresets;
        }

        // 加密通用角色列表
        if (dataToExport.characterCommonPresets) {
            const { encryptedPresets: encPresets, nameMap: presetMap } = encryptPresetNames(dataToExport.characterCommonPresets, 'CHAR_COM_');
            allNameMaps.characterCommonPresets = presetMap;

            const encryptedPresets = {};
            for (const encId in encPresets) {
                const preset = encPresets[encId];
                let encrypted = encryptListPreset(preset, 'characters');
                // 替换角色名称引用
                if (encrypted.characters) {
                    encrypted.characters = encrypted.characters.map(name => {
                        const decrypted = decryptBase64(name);
                        return encryptBase64(charForwardMap[decrypted] || decrypted);
                    });
                }
                encryptedPresets[encId] = encrypted;
            }
            dataToExport.characterCommonPresets = encryptedPresets;
        }

        // 加密名称映射表并添加到导出数据
        dataToExport._nameMap = encryptBase64(JSON.stringify(allNameMaps));

        // 添加加密标识
        dataToExport._encrypted = true;
        dataToExport._version = "1.0";
    }

    return dataToExport;
}

/**
 * 通用解密导入助手 - 自动检测并解密数据
 * @param {Object} importedData - 导入的数据对象
 * @returns {Object} 解密后的数据对象
 */
export function decryptImportData(importedData) {
    // 检测是否为加密数据
    if (!isEncryptedData(importedData)) {
        console.log('[Character] 导入数据未加密,直接返回');
        return importedData;
    }

    console.log('[Character] 检测到加密数据,开始解密...');
    const decryptedData = JSON.parse(JSON.stringify(importedData)); // 深拷贝

    // 解密名称映射表
    let allNameMaps = {};
    if (decryptedData._nameMap) {
        try {
            allNameMaps = JSON.parse(decryptBase64(decryptedData._nameMap));
            console.log('[Character] 名称映射表解密成功');
        } catch (e) {
            console.error('[Character] 名称映射表解密失败:', e);
        }
    }

    // 创建反向映射表（加密ID -> 原始名称）
    const charReverseMap = {};
    const outfitReverseMap = {};

    if (allNameMaps.characters) {
        for (const encId in allNameMaps.characters) {
            charReverseMap[encId] = allNameMaps.characters[encId];
        }
    }
    if (allNameMaps.outfits) {
        for (const encId in allNameMaps.outfits) {
            outfitReverseMap[encId] = allNameMaps.outfits[encId];
        }
    }

    // 解密角色数据
    if (decryptedData.characters) {
        const decryptedCharacters = {};
        for (const charKey in decryptedData.characters) {
            const originalName = allNameMaps.characters ? allNameMaps.characters[charKey] : charKey;
            let charPreset = decryptCharacterPreset(decryptedData.characters[charKey]);

            // 恢复服装名称引用
            if (charPreset.outfits && charPreset.outfits.length > 0) {
                charPreset.outfits = charPreset.outfits.map(name => outfitReverseMap[name] || name);
            }

            decryptedCharacters[originalName] = charPreset;
        }
        decryptedData.characters = decryptedCharacters;
    }

    // 解密服装数据
    if (decryptedData.outfits) {
        const decryptedOutfits = {};
        for (const outfitKey in decryptedData.outfits) {
            const originalName = allNameMaps.outfits ? allNameMaps.outfits[outfitKey] : outfitKey;
            decryptedOutfits[originalName] = decryptOutfitPreset(decryptedData.outfits[outfitKey]);
        }
        decryptedData.outfits = decryptedOutfits;
    }

    // 解密角色启用列表
    if (decryptedData.characterEnablePresets) {
        const decryptedPresets = {};
        for (const presetKey in decryptedData.characterEnablePresets) {
            const originalName = allNameMaps.characterEnablePresets ? allNameMaps.characterEnablePresets[presetKey] : presetKey;
            let preset = decryptListPreset(decryptedData.characterEnablePresets[presetKey], 'characters');

            // 恢复角色名称引用
            if (preset.characters) {
                preset.characters = preset.characters.map(name => charReverseMap[name] || name);
            }

            decryptedPresets[originalName] = preset;
        }
        decryptedData.characterEnablePresets = decryptedPresets;
    }

    // 解密服装启用列表
    if (decryptedData.outfitEnablePresets) {
        const decryptedPresets = {};
        for (const presetKey in decryptedData.outfitEnablePresets) {
            const originalName = allNameMaps.outfitEnablePresets ? allNameMaps.outfitEnablePresets[presetKey] : presetKey;
            let preset = decryptListPreset(decryptedData.outfitEnablePresets[presetKey], 'outfits');

            // 恢复服装名称引用
            if (preset.outfits) {
                preset.outfits = preset.outfits.map(name => outfitReverseMap[name] || name);
            }

            decryptedPresets[originalName] = preset;
        }
        decryptedData.outfitEnablePresets = decryptedPresets;
    }

    // 解密通用角色列表
    if (decryptedData.characterCommonPresets) {
        const decryptedPresets = {};
        for (const presetKey in decryptedData.characterCommonPresets) {
            const originalName = allNameMaps.characterCommonPresets ? allNameMaps.characterCommonPresets[presetKey] : presetKey;
            let preset = decryptListPreset(decryptedData.characterCommonPresets[presetKey], 'characters');

            // 恢复角色名称引用
            if (preset.characters) {
                preset.characters = preset.characters.map(name => charReverseMap[name] || name);
            }

            decryptedPresets[originalName] = preset;
        }
        decryptedData.characterCommonPresets = decryptedPresets;
    }

    // 移除加密标识和名称映射
    delete decryptedData._encrypted;
    delete decryptedData._version;
    delete decryptedData._nameMap;

    console.log('[Character] 数据解密完成');
    return decryptedData;
}
