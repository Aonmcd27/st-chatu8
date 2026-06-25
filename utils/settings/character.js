// @ts-nocheck
import { extension_settings } from "../../../../../extensions.js";
import { saveSettingsDebounced } from "../../../../../../script.js";
import { extensionName } from '../config.js';
import { defaultCharacterSettings } from '../character_config.js';
import { stylInput, stylishConfirm } from '../ui_common.js';
import { dbs } from '../database.js';

// 用于跟踪是否已经初始化
let isCharacterInitialized = false;

// ========== Base64 加密工具函数 ==========

/**
 * Base64 加密文本(支持 UTF-8 中文)
 * @param {string} text - 要加密的文本
 * @returns {string} Base64 编码后的文本
 */
function encryptBase64(text) {
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
function decryptBase64(encodedText) {
    if (!encodedText) return '';
    try {
        return decodeURIComponent(escape(atob(encodedText)));
    } catch (e) {
        console.error('Base64 解密失败:', e);
        return encodedText;
    }
}

/**
 * 加密对象中的文本字段
 * @param {Object} obj - 要加密的对象
 * @param {Array<string>} fields - 需要加密的字段名数组
 * @returns {Object} 加密后的对象
 */
function encryptObjectFields(obj, fields) {
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
function decryptObjectFields(obj, fields) {
    const decrypted = JSON.parse(JSON.stringify(obj)); // 深拷贝
    fields.forEach(field => {
        if (decrypted[field]) {
            decrypted[field] = decryptBase64(decrypted[field]);
        }
    });
    return decrypted;
}

/**
 * 加密角色预设
 * @param {Object} preset - 角色预设对象
 * @returns {Object} 加密后的角色预设
 */
function encryptCharacterPreset(preset) {
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
function decryptCharacterPreset(preset) {
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
function encryptOutfitPreset(preset) {
    const fields = ['nameCN', 'nameEN', 'upperBody', 'upperBodyBack', 'fullBody', 'fullBodyBack'];
    return encryptObjectFields(preset, fields);
}

/**
 * 解密服装预设
 * @param {Object} preset - 加密的服装预设对象
 * @returns {Object} 解密后的服装预设
 */
function decryptOutfitPreset(preset) {
    const fields = ['nameCN', 'nameEN', 'upperBody', 'upperBodyBack', 'fullBody', 'fullBodyBack'];
    return decryptObjectFields(preset, fields);
}

/**
 * 加密列表预设(角色启用/通用角色/通用服装列表)
 * @param {Object} preset - 列表预设对象
 * @param {string} listKey - 列表字段名('characters' 或 'outfits')
 * @returns {Object} 加密后的列表预设
 */
function encryptListPreset(preset, listKey) {
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
function decryptListPreset(preset, listKey) {
    const decrypted = JSON.parse(JSON.stringify(preset));
    if (preset[listKey] && Array.isArray(preset[listKey])) {
        decrypted[listKey] = preset[listKey].map(name => decryptBase64(name));
    }
    return decrypted;
}

/**
 * 检测数据是否已加密
 * @param {Object} data - 要检测的数据对象
 * @returns {boolean} 是否已加密
 */
function isEncryptedData(data) {
    return data && data._encrypted === true;
}

/**
 * 创建预设名称映射并加密
 * @param {Object} presets - 预设对象
 * @param {string} prefix - ID前缀 (如 'CHAR_', 'OUTFIT_')
 * @returns {Object} { encryptedPresets, nameMap }
 */
function encryptPresetNames(presets, prefix) {
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
function decryptPresetNames(encryptedPresets, nameMap) {
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
function replaceNameReferences(obj, nameMap) {
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
function restoreNameReferences(obj, reverseMap) {
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

/**
 * 通用加密导出助手 - 询问用户并加密数据
 * @param {Object} dataToExport - 要导出的数据对象
 * @returns {Promise<Object>} 加密后的数据对象
 */
async function encryptExportData(dataToExport) {
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
function decryptImportData(importedData) {
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

/**
 * 初始化角色设置(仅绑定事件,只执行一次)
 */
export function initCharacterSettings(container) {
    console.log('[Character] Initializing character settings...');
    
    // 确保配置存在
    ensureCharacterSettings();
    
    // 只在第一次初始化时绑定事件
    if (!isCharacterInitialized) {
        // 绑定子导航切换
        setupSubNavigation(container);
        
        // 绑定角色设定功能
        setupCharacterControls(container);
        
        // 绑定服装管理功能
        setupOutfitControls(container);
        
        // 绑定角色启用管理功能
        setupCharacterEnableControls(container);
        
        // 绑定通用服装列表管理功能
        setupOutfitEnableControls(container);
        
        // 绑定通用角色列表管理功能
        setupCharacterCommonControls(container);

        // 绑定 Banana 角色管理功能
        setupBananaCharacterControls(container);
        
        // 初始化tag自动补全(只执行一次)
        initTagAutocomplete();
        
        isCharacterInitialized = true;
    }
    
    console.log('[Character] Character settings initialized');
}

/**
 * 刷新角色设置UI（每次进入标签页时调用）
 */
export function refreshCharacterSettings(container) {
    console.log('[Character] Refreshing character settings...');
    
    // 确保配置存在
    ensureCharacterSettings();
    
    // 刷新角色预设
    loadCharacterPresetList();
    loadCharacterPreset();
    
    // 刷新服装预设
    loadOutfitPresetList();
    loadOutfitPreset();
    
    // 刷新角色启用管理
    loadCharacterEnablePresetList();
    loadCharacterEnablePreset();
    loadCharacterSelector();
    
    // 刷新通用服装列表
    loadOutfitEnablePresetList();
    loadOutfitEnablePreset();
    loadOutfitEnableSelector();
    
    // 刷新通用角色列表
    loadCharacterCommonPresetList();
    loadCharacterCommonPreset();
    loadCharacterCommonSelector();

    // 刷新 Banana 角色管理
    loadBananaCharacterPresetList();
    loadBananaCharacterPreset();
    
    // 重置子导航到第一个标签
    resetSubNavigation(container);
    
    console.log('[Character] Character settings refreshed');
}

/**
 * 重置子导航状态（不重新绑定事件）
 */
function resetSubNavigation(container) {
    const allSubNavLinks = container.find('.st-chatu8-sub-nav-link');
    const firstLink = allSubNavLinks.first();
    
    if (firstLink.length > 0) {
        // 重置所有链接的激活状态
        allSubNavLinks.removeClass('active');
        firstLink.addClass('active');
        
        // 隐藏所有子标签内容，然后显示第一个
        const firstSubTabId = firstLink.data('sub-tab');
        container.find('.st-chatu8-sub-tab-content').css('display', 'none');
        container.find(`#${firstSubTabId}`).css('display', 'block');
    }
}

/**
 * 确保配置存在
 */
function ensureCharacterSettings() {
    const settings = extension_settings[extensionName];
    
    // 初始化角色预设
    if (!settings.characterPresets) {
        settings.characterPresets = JSON.parse(JSON.stringify(defaultCharacterSettings.characterPresets));
    }
    if (!settings.characterPresetId) {
        settings.characterPresetId = defaultCharacterSettings.characterPresetId;
    }
    
    // 初始化服装预设
    if (!settings.outfitPresets) {
        settings.outfitPresets = JSON.parse(JSON.stringify(defaultCharacterSettings.outfitPresets));
    }
    if (!settings.outfitPresetId) {
        settings.outfitPresetId = defaultCharacterSettings.outfitPresetId;
    }
    
    // 初始化 AI 设置
    if (!settings.characterAI) {
        settings.characterAI = JSON.parse(JSON.stringify(defaultCharacterSettings.characterAI));
    }
    if (!settings.outfitAI) {
        settings.outfitAI = JSON.parse(JSON.stringify(defaultCharacterSettings.outfitAI));
    }
    
    // 初始化角色启用预设
    if (!settings.characterEnablePresets) {
        settings.characterEnablePresets = JSON.parse(JSON.stringify(defaultCharacterSettings.characterEnablePresets));
    }
    if (!settings.characterEnablePresetId) {
        settings.characterEnablePresetId = defaultCharacterSettings.characterEnablePresetId;
    }
    
    // 初始化通用服装列表预设
    if (!settings.outfitEnablePresets) {
        settings.outfitEnablePresets = JSON.parse(JSON.stringify(defaultCharacterSettings.outfitEnablePresets));
    }
    if (!settings.outfitEnablePresetId) {
        settings.outfitEnablePresetId = defaultCharacterSettings.outfitEnablePresetId;
    }
    
    // 初始化通用角色列表预设
    if (!settings.characterCommonPresets) {
        settings.characterCommonPresets = JSON.parse(JSON.stringify(defaultCharacterSettings.characterCommonPresets));
    }
    if (!settings.characterCommonPresetId) {
        settings.characterCommonPresetId = defaultCharacterSettings.characterCommonPresetId;
    }

    // 初始化 Banana 角色预设
    if (!settings.bananaCharacterPresets) {
        settings.bananaCharacterPresets = {
            "默认": {
                triggers: "触发词1|触发词2",
                conversation: {
                    user: { text: '', image: '' },
                    model: { text: '', image: '' }
                }
            }
        };
    }
    if (!settings.bananaCharacterPresetId) {
        settings.bananaCharacterPresetId = '默认';
    }
}

/**
 * 设置子导航
 */
function setupSubNavigation(container) {
    // 绑定点击事件（使用 .off() 防止重复绑定）
    container.find('.st-chatu8-sub-nav-link').off('click').on('click', function(e) {
        e.preventDefault();
        const subTabId = $(this).data('sub-tab');
        
        // 更新激活状态（只在当前容器内）
        container.find('.st-chatu8-sub-nav-link').removeClass('active');
        $(this).addClass('active');
        
        // 显示/隐藏内容 - 使用 CSS 样式控制
        container.find('.st-chatu8-sub-tab-content').css('display', 'none');
        container.find(`#${subTabId}`).css('display', 'block');
    });
    
    // 初始化：重置并显示第一个子标签页
    const allSubNavLinks = container.find('.st-chatu8-sub-nav-link');
    const firstLink = allSubNavLinks.first();
    
    if (firstLink.length > 0) {
        // 重置所有链接的激活状态
        allSubNavLinks.removeClass('active');
        firstLink.addClass('active');
        
        // 隐藏所有子标签内容，然后显示第一个
        const firstSubTabId = firstLink.data('sub-tab');
        container.find('.st-chatu8-sub-tab-content').css('display', 'none');
        container.find(`#${firstSubTabId}`).css('display', 'block');
    }
}

/**
 * 设置角色控件
 */
function setupCharacterControls(container) {
    const settings = extension_settings[extensionName];
    
    // 加载预设列表
    loadCharacterPresetList();
    
    // 绑定预设选择
    container.find('#character_preset_id').on('change', loadCharacterPreset);
    
    // 绑定按钮
    container.find('#character_update').on('click', updateCharacterPreset);
    container.find('#character_save_as').on('click', saveCharacterPresetAs);
    container.find('#character_export').on('click', exportCharacterPreset);
    container.find('#character_export_all').on('click', exportAllCharacterPresets);
    container.find('#character_import').on('click', importCharacterPreset);
    container.find('#character_delete').on('click', deleteCharacterPreset);
    
    // 绑定服装相关按钮
    container.find('#char_outfit_check').on('click', checkCharacterOutfitList);
    container.find('#char_outfit_add').on('click', addOutfitFromSelector);
    container.find('#char_outfit_refresh').on('click', loadCharacterOutfitSelector);
    
    // 绑定括号替换按钮
    container.find('#char_replace_brackets').on('click', replaceEnglishBrackets);
    
    // 绑定字段变化监听
    bindCharacterFieldListeners();
    
    // 加载当前预设
    loadCharacterPreset();
}

/**
 * 设置服装控件
 */
function setupOutfitControls(container) {
    const settings = extension_settings[extensionName];
    
    // 加载预设列表
    loadOutfitPresetList();
    
    // 绑定预设选择
    container.find('#outfit_preset_id').on('change', loadOutfitPreset);
    
    // 绑定按钮
    container.find('#outfit_update').on('click', updateOutfitPreset);
    container.find('#outfit_save_as').on('click', saveOutfitPresetAs);
    container.find('#outfit_export').on('click', exportOutfitPreset);
    container.find('#outfit_export_all').on('click', exportAllOutfitPresets);
    container.find('#outfit_import').on('click', importOutfitPreset);
    container.find('#outfit_delete').on('click', deleteOutfitPreset);
    
    // 绑定括号替换按钮
    container.find('#outfit_replace_brackets').on('click', replaceOutfitEnglishBrackets);
    
    // 绑定字段变化监听
    bindOutfitFieldListeners();
    
    // 加载当前预设
    loadOutfitPreset();
}

// ========== 角色预设管理 ==========

function loadCharacterPresetList() {
    const settings = extension_settings[extensionName];
    const select = document.getElementById('character_preset_id');
    
    if (!select) return;
    
    select.innerHTML = '';
    
    for (const presetName in settings.characterPresets) {
        const option = document.createElement('option');
        option.value = presetName;
        option.textContent = presetName;
        select.add(option);
    }
    
    select.value = settings.characterPresetId;
}

function loadCharacterPreset() {
    const settings = extension_settings[extensionName];
    const select = document.getElementById('character_preset_id');
    if (!select) return;
    
    const newPresetId = select.value;
    const currentPresetId = settings.characterPresetId;
    
    // 检查是否有未保存的更改
    if (currentPresetId && currentPresetId !== newPresetId) {
        const currentPreset = settings.characterPresets[currentPresetId] || {};
        const fields = ['nameCN', 'nameEN', 'facialFeatures', 'upperBodySFW', 'fullBodySFW', 'upperBodyNSFW', 'fullBodyNSFW'];
        
        let isDirty = false;
        for (const field of fields) {
            const element = document.getElementById(`char_${field}`);
            if (element && element.value !== (currentPreset[field] || '')) {
                isDirty = true;
                break;
            }
        }
        
        if (isDirty) {
            stylishConfirm("您有未保存的角色数据。要放弃这些更改并切换预设吗？").then(confirmed => {
                if (confirmed) {
                    settings.characterPresetId = newPresetId;
                    loadCharacterPresetData(newPresetId);
                    saveSettingsDebounced();
                } else {
                    select.value = currentPresetId;
                }
            });
            return;
        }
    }
    
    settings.characterPresetId = newPresetId;
    loadCharacterPresetData(newPresetId);
    saveSettingsDebounced();
}

function loadCharacterPresetData(presetId) {
    const settings = extension_settings[extensionName];
    const preset = settings.characterPresets[presetId];
    
    if (!preset) return;
    
    const fields = ['nameCN', 'nameEN', 'facialFeatures', 'facialFeaturesBack', 'upperBodySFW', 'upperBodySFWBack', 'fullBodySFW', 'fullBodySFWBack', 'upperBodyNSFW', 'upperBodyNSFWBack', 'fullBodyNSFW', 'fullBodyNSFWBack'];
    fields.forEach(field => {
        const element = document.getElementById(`char_${field}`);
        if (element) {
            element.value = preset[field] || '';
            // 隐藏未保存警告
            const warning = element.closest('.st-chatu8-field-col')?.querySelector('.st-chatu8-unsaved-warning');
            if (warning) $(warning).hide();
        }
    });
    
    // 加载服装列表
    const outfitListElement = document.getElementById('char_outfit_list');
    if (outfitListElement) {
        outfitListElement.value = (preset.outfits || []).join('\n');
    }
    
    // 加载服装选择器
    loadCharacterOutfitSelector();
}

function updateCharacterPreset() {
    const settings = extension_settings[extensionName];
    const presetId = settings.characterPresetId;
    
    if (!presetId || !settings.characterPresets[presetId]) {
        alert('没有活动的角色预设可保存。请先"另存为"一个新预设。');
        return;
    }
    
    stylishConfirm(`确定要覆盖当前角色预设 "${presetId}" 吗？`).then(confirmed => {
        if (confirmed) {
            saveCurrentCharacterData(presetId);
            alert(`角色预设 "${presetId}" 已更新。`);
        }
    });
}

function saveCharacterPresetAs() {
    stylInput("请输入新角色预设的名称").then((result) => {
        if (result && result.trim() !== '') {
            const settings = extension_settings[extensionName];
            saveCurrentCharacterData(result);
            settings.characterPresetId = result;
            loadCharacterPresetList();
            alert(`角色预设 "${result}" 已保存。`);
        }
    });
}

function saveCurrentCharacterData(presetId) {
    const settings = extension_settings[extensionName];
    const preset = {};

    // 保存所有新字段
    const fields = ['nameCN', 'nameEN', 'facialFeatures', 'facialFeaturesBack', 'upperBodySFW', 'upperBodySFWBack', 'fullBodySFW', 'fullBodySFWBack', 'upperBodyNSFW', 'upperBodyNSFWBack', 'fullBodyNSFW', 'fullBodyNSFWBack'];
    fields.forEach(field => {
        const element = document.getElementById(`char_${field}`);
        if (element) {
            preset[field] = element.value || '';
        }
    });
    
    // 保存服装列表
    const outfitListElement = document.getElementById('char_outfit_list');
    if (outfitListElement) {
        preset.outfits = outfitListElement.value
            .split('\n')
            .map(line => line.trim())
            .filter(line => line.length > 0);
    } else {
        preset.outfits = [];
    }

    settings.characterPresets[presetId] = preset;
    saveSettingsDebounced();
}

function deleteCharacterPreset() {
    const settings = extension_settings[extensionName];
    const presetId = document.getElementById('character_preset_id')?.value;
    
    if (presetId === "默认角色") {
        alert("默认预设不能删除");
        return;
    }
    
    stylishConfirm("是否确定删除该角色预设").then((result) => {
        if (result) {
            delete settings.characterPresets[presetId];
            settings.characterPresetId = "默认角色";
            loadCharacterPresetList();
            loadCharacterPreset();
            saveSettingsDebounced();
        }
    });
}

async function exportCharacterPreset() {
    const settings = extension_settings[extensionName];
    const presetId = settings.characterPresetId;
    const preset = settings.characterPresets[presetId];
    
    if (!preset) {
        alert("没有选中的角色预设可导出。");
        return;
    }
    
    // 检查是否有关联的服装列表
    const relatedOutfits = preset.outfits || [];
    
    let dataToExport = {
        characters: { [presetId]: preset }
    };
    
    // 如果有关联服装,询问用户是否一起导出
    if (relatedOutfits.length > 0) {
        const confirmMessage = `检测到该角色包含 ${relatedOutfits.length} 个服装:\n${relatedOutfits.join('\n')}\n\n是否一起导出相关服装?`;
        const includeOutfits = await stylishConfirm(confirmMessage);
        
        if (includeOutfits) {
            dataToExport.outfits = {};
            relatedOutfits.forEach(outfitName => {
                if (settings.outfitPresets[outfitName]) {
                    dataToExport.outfits[outfitName] = settings.outfitPresets[outfitName];
                }
            });
        }
    }
    
    // 使用统一的加密导出函数
    dataToExport = await encryptExportData(dataToExport);
    
    const dataStr = JSON.stringify(dataToExport, null, 2);
    const blob = new Blob([dataStr], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `st-chatu8-角色-${presetId}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

async function exportAllCharacterPresets() {
    const settings = extension_settings[extensionName];
    if (!settings.characterPresets || Object.keys(settings.characterPresets).length === 0) {
        alert("没有角色预设可导出。");
        return;
    }
    
    // 收集所有角色和关联的服装
    const allOutfits = new Set();
    
    for (const charName in settings.characterPresets) {
        const charPreset = settings.characterPresets[charName];
        const charOutfits = charPreset.outfits || [];
        charOutfits.forEach(outfitName => allOutfits.add(outfitName));
    }
    
    let dataToExport = {
        characters: settings.characterPresets
    };
    
    // 如果有关联服装,询问用户是否一起导出
    if (allOutfits.size > 0) {
        const confirmMessage = `检测到所有角色共包含 ${allOutfits.size} 个不同的服装:\n${Array.from(allOutfits).join('\n')}\n\n是否一起导出相关服装?`;
        const includeOutfits = await stylishConfirm(confirmMessage);
        
        if (includeOutfits) {
            dataToExport.outfits = {};
            allOutfits.forEach(outfitName => {
                if (settings.outfitPresets[outfitName]) {
                    dataToExport.outfits[outfitName] = settings.outfitPresets[outfitName];
                }
            });
        }
    }
    
    // 使用统一的加密导出函数
    dataToExport = await encryptExportData(dataToExport);
    
    const dataStr = JSON.stringify(dataToExport, null, 2);
    const blob = new Blob([dataStr], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "st-chatu8-角色-全部.json";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

function importCharacterPreset() {
    const settings = extension_settings[extensionName];
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.onchange = async e => {
        const file = e.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = async readerEvent => {
            try {
                let importedData = JSON.parse(readerEvent.target.result);
                
                // 自动检测并解密数据
                importedData = decryptImportData(importedData);
                
                // 检查新格式(包含characters和outfits)或旧格式(直接是预设对象)
                let charactersToImport = {};
                let outfitsToImport = {};
                
                if (importedData.characters) {
                    // 新格式
                    charactersToImport = importedData.characters;
                    outfitsToImport = importedData.outfits || {};
                } else {
                    // 旧格式,直接是角色预设
                    charactersToImport = importedData;
                }
                
                // 如果有关联的服装,询问用户是否一起导入
                let importOutfits = false;
                if (Object.keys(outfitsToImport).length > 0) {
                    const outfitNames = Object.keys(outfitsToImport);
                    const confirmMessage = `检测到 ${outfitNames.length} 个相关服装:\n${outfitNames.join('\n')}\n\n是否一起导入?`;
                    importOutfits = await stylishConfirm(confirmMessage);
                }
                
                // 导入角色
                let newCharactersCount = 0;
                for (const key in charactersToImport) {
                    if (charactersToImport.hasOwnProperty(key)) {
                        if (!settings.characterPresets.hasOwnProperty(key)) {
                            newCharactersCount++;
                        }
                        settings.characterPresets[key] = charactersToImport[key];
                    }
                }
                
                // 导入服装(如果用户确认)
                let newOutfitsCount = 0;
                if (importOutfits) {
                    for (const key in outfitsToImport) {
                        if (outfitsToImport.hasOwnProperty(key)) {
                            if (!settings.outfitPresets.hasOwnProperty(key)) {
                                newOutfitsCount++;
                            }
                            settings.outfitPresets[key] = outfitsToImport[key];
                        }
                    }
                }
                
                saveSettingsDebounced();
                loadCharacterPresetList();
                if (importOutfits) {
                    loadOutfitPresetList();
                }
                
                // 自动选择第一个导入的预设
                const firstImportedKey = Object.keys(charactersToImport)[0];
                if (firstImportedKey) {
                    settings.characterPresetId = firstImportedKey;
                    const select = document.getElementById('character_preset_id');
                    if (select) select.value = firstImportedKey;
                    loadCharacterPresetData(firstImportedKey);
                }
                
                let message = `成功导入 ${Object.keys(charactersToImport).length} 个角色预设，其中 ${newCharactersCount} 个是全新的。`;
                if (importOutfits) {
                    message += `\n同时导入 ${Object.keys(outfitsToImport).length} 个服装预设，其中 ${newOutfitsCount} 个是全新的。`;
                }
                alert(message);
            } catch (err) {
                alert("导入失败，请确保文件是正确的JSON格式。\n错误信息: " + err.message);
                console.error("Error importing character presets:", err);
            }
        };
        reader.readAsText(file);
    };
    input.click();
}

function bindCharacterFieldListeners() {
    // 监听所有字段变化，显示/隐藏未保存警告
    const fields = ['nameCN', 'nameEN', 'facialFeatures', 'upperBodySFW', 'fullBodySFW', 'upperBodyNSFW', 'fullBodyNSFW'];
    fields.forEach(field => {
        const element = document.getElementById(`char_${field}`);
        if (element) {
            $(element).on('input', function() {
                const settings = extension_settings[extensionName];
                const presetName = settings.characterPresetId;
                const currentPreset = settings.characterPresets[presetName] || {};
                const isDirty = $(this).val() !== (currentPreset[field] || '');
                const warning = $(this).closest('.st-chatu8-field-col').find('.st-chatu8-unsaved-warning');
                
                if (isDirty) {
                    $(warning).show();
                } else {
                    $(warning).hide();
                }
            });
        }
    });
}

// ========== 服装预设管理 ==========

function loadOutfitPresetList() {
    const settings = extension_settings[extensionName];
    const select = document.getElementById('outfit_preset_id');
    
    if (!select) return;
    
    select.innerHTML = '';
    
    for (const presetName in settings.outfitPresets) {
        const option = document.createElement('option');
        option.value = presetName;
        option.textContent = presetName;
        select.add(option);
    }
    
    select.value = settings.outfitPresetId;
}

function loadOutfitPreset() {
    const settings = extension_settings[extensionName];
    const select = document.getElementById('outfit_preset_id');
    if (!select) return;
    
    const newPresetId = select.value;
    const currentPresetId = settings.outfitPresetId;
    
    // 检查是否有未保存的更改
    if (currentPresetId && currentPresetId !== newPresetId) {
        const currentPreset = settings.outfitPresets[currentPresetId] || {};
        const fields = ['nameCN', 'nameEN', 'upperBody', 'fullBody'];
        
        let isDirty = false;
        for (const field of fields) {
            const element = document.getElementById(`outfit_${field}`);
            if (element && element.value !== (currentPreset[field] || '')) {
                isDirty = true;
                break;
            }
        }
        
        if (isDirty) {
            stylishConfirm("您有未保存的服装数据。要放弃这些更改并切换预设吗？").then(confirmed => {
                if (confirmed) {
                    settings.outfitPresetId = newPresetId;
                    loadOutfitPresetData(newPresetId);
                    saveSettingsDebounced();
                } else {
                    select.value = currentPresetId;
                }
            });
            return;
        }
    }
    
    settings.outfitPresetId = newPresetId;
    loadOutfitPresetData(newPresetId);
    saveSettingsDebounced();
}

function loadOutfitPresetData(presetId) {
    const settings = extension_settings[extensionName];
    const preset = settings.outfitPresets[presetId];
    
    if (!preset) return;
    
    const fields = ['nameCN', 'nameEN', 'upperBody', 'upperBodyBack', 'fullBody', 'fullBodyBack'];
    fields.forEach(field => {
        const element = document.getElementById(`outfit_${field}`);
        if (element) {
            element.value = preset[field] || '';
            // 隐藏未保存警告
            const warning = element.closest('.st-chatu8-field-col')?.querySelector('.st-chatu8-unsaved-warning');
            if (warning) $(warning).hide();
        }
    });
}

function updateOutfitPreset() {
    const settings = extension_settings[extensionName];
    const presetId = settings.outfitPresetId;
    
    if (!presetId || !settings.outfitPresets[presetId]) {
        alert('没有活动的服装预设可保存。请先"另存为"一个新预设。');
        return;
    }
    
    stylishConfirm(`确定要覆盖当前服装预设 "${presetId}" 吗？`).then(confirmed => {
        if (confirmed) {
            saveCurrentOutfitData(presetId);
            alert(`服装预设 "${presetId}" 已更新。`);
        }
    });
}

function saveOutfitPresetAs() {
    stylInput("请输入新服装预设的名称").then((result) => {
        if (result && result.trim() !== '') {
            const settings = extension_settings[extensionName];
            saveCurrentOutfitData(result);
            settings.outfitPresetId = result;
            loadOutfitPresetList();
            alert(`服装预设 "${result}" 已保存。`);
        }
    });
}

function saveCurrentOutfitData(presetId) {
    const settings = extension_settings[extensionName];
    const preset = {};

    // 保存所有新字段
    const fields = ['nameCN', 'nameEN', 'upperBody', 'upperBodyBack', 'fullBody', 'fullBodyBack'];
    fields.forEach(field => {
        const element = document.getElementById(`outfit_${field}`);
        if (element) {
            preset[field] = element.value || '';
        }
    });

    settings.outfitPresets[presetId] = preset;
    saveSettingsDebounced();
}

function deleteOutfitPreset() {
    const settings = extension_settings[extensionName];
    const presetId = document.getElementById('outfit_preset_id')?.value;
    
    if (presetId === "默认服装") {
        alert("默认预设不能删除");
        return;
    }
    
    stylishConfirm("是否确定删除该服装预设").then((result) => {
        if (result) {
            delete settings.outfitPresets[presetId];
            settings.outfitPresetId = "默认服装";
            loadOutfitPresetList();
            loadOutfitPreset();
            saveSettingsDebounced();
        }
    });
}

async function exportOutfitPreset() {
    const settings = extension_settings[extensionName];
    const presetId = settings.outfitPresetId;
    const preset = settings.outfitPresets[presetId];
    
    if (!preset) {
        alert("没有选中的服装预设可导出。");
        return;
    }
    
    let dataToExport = {
        outfits: { [presetId]: preset }
    };
    
    // 使用统一的加密导出函数
    dataToExport = await encryptExportData(dataToExport);
    
    const dataStr = JSON.stringify(dataToExport, null, 2);
    const blob = new Blob([dataStr], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `st-chatu8-服装-${presetId}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

async function exportAllOutfitPresets() {
    const settings = extension_settings[extensionName];
    if (!settings.outfitPresets || Object.keys(settings.outfitPresets).length === 0) {
        alert("没有服装预设可导出。");
        return;
    }
    
    // 收集所有使用这些服装的角色
    const allOutfitNames = new Set(Object.keys(settings.outfitPresets));
    const relatedCharacters = {};
    
    for (const charName in settings.characterPresets) {
        const charPreset = settings.characterPresets[charName];
        const charOutfits = charPreset.outfits || [];
        
        // 检查该角色是否使用了要导出的任何服装
        const hasRelatedOutfit = charOutfits.some(outfitName => allOutfitNames.has(outfitName));
        if (hasRelatedOutfit) {
            relatedCharacters[charName] = charPreset;
        }
    }
    
    let dataToExport = {
        outfits: settings.outfitPresets
    };
    
    // 如果有使用这些服装的角色,询问用户是否一起导出
    if (Object.keys(relatedCharacters).length > 0) {
        const confirmMessage = `检测到 ${Object.keys(relatedCharacters).length} 个角色使用了这些服装:\n${Object.keys(relatedCharacters).join('\n')}\n\n是否一起导出相关角色?`;
        const includeCharacters = await stylishConfirm(confirmMessage);
        
        if (includeCharacters) {
            dataToExport.characters = relatedCharacters;
        }
    }
    
    // ✅ 使用统一的加密导出函数
    dataToExport = await encryptExportData(dataToExport);
    
    const dataStr = JSON.stringify(dataToExport, null, 2);
    const blob = new Blob([dataStr], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "st-chatu8-服装-全部.json";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

function importOutfitPreset() {
    const settings = extension_settings[extensionName];
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.onchange = e => {
        const file = e.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = readerEvent => {
            try {
                let importedData = JSON.parse(readerEvent.target.result);
                
                // 自动检测并解密数据
                importedData = decryptImportData(importedData);
                
                // 检查新格式(包含outfits)或旧格式(直接是预设对象)
                let outfitsToImport = {};
                
                if (importedData.outfits) {
                    // 新格式
                    outfitsToImport = importedData.outfits;
                } else {
                    // 旧格式,直接是服装预设
                    outfitsToImport = importedData;
                }
                
                let newPresetsCount = 0;
                for (const key in outfitsToImport) {
                    if (outfitsToImport.hasOwnProperty(key)) {
                        if (!settings.outfitPresets.hasOwnProperty(key)) {
                            newPresetsCount++;
                        }
                        settings.outfitPresets[key] = outfitsToImport[key];
                    }
                }
                saveSettingsDebounced();
                loadOutfitPresetList();
                
                // 自动选择第一个导入的预设
                const firstImportedKey = Object.keys(outfitsToImport)[0];
                if (firstImportedKey) {
                    settings.outfitPresetId = firstImportedKey;
                    const select = document.getElementById('outfit_preset_id');
                    if (select) select.value = firstImportedKey;
                    loadOutfitPresetData(firstImportedKey);
                }
                
                alert(`成功导入 ${Object.keys(outfitsToImport).length} 个服装预设，其中 ${newPresetsCount} 个是全新的。`);
            } catch (err) {
                alert("导入失败，请确保文件是正确的JSON格式。\n错误信息: " + err.message);
                console.error("Error importing outfit presets:", err);
            }
        };
        reader.readAsText(file);
    };
    input.click();
}

function bindOutfitFieldListeners() {
    // 监听所有字段变化，显示/隐藏未保存警告
    const fields = ['nameCN', 'nameEN', 'upperBody', 'fullBody'];
    fields.forEach(field => {
        const element = document.getElementById(`outfit_${field}`);
        if (element) {
            $(element).on('input', function() {
                const settings = extension_settings[extensionName];
                const presetName = settings.outfitPresetId;
                const currentPreset = settings.outfitPresets[presetName] || {};
                const isDirty = $(this).val() !== (currentPreset[field] || '');
                const warning = $(this).closest('.st-chatu8-field-col').find('.st-chatu8-unsaved-warning');
                
                if (isDirty) {
                    $(warning).show();
                } else {
                    $(warning).hide();
                }
            });
        }
    });
}

// ========== 角色启用管理 ==========

/**
 * 设置角色启用管理控件
 */
function setupCharacterEnableControls(container) {
    // 加载预设列表
    loadCharacterEnablePresetList();
    
    // 绑定预设选择
    container.find('#character_enable_preset_id').on('change', loadCharacterEnablePreset);
    
    // 绑定按钮
    container.find('#character_enable_update').on('click', updateCharacterEnablePreset);
    container.find('#character_enable_save_as').on('click', saveCharacterEnablePresetAs);
    container.find('#character_enable_export').on('click', exportCharacterEnablePreset);
    container.find('#character_enable_export_all').on('click', exportAllCharacterEnablePresets);
    container.find('#character_enable_import').on('click', importCharacterEnablePreset);
    container.find('#character_enable_delete').on('click', deleteCharacterEnablePreset);
    container.find('#character_enable_check').on('click', checkCharacterList);
    container.find('#character_enable_add').on('click', addCharacterFromSelector);
    container.find('#character_enable_refresh').on('click', loadCharacterSelector);
    
    // 加载当前预设
    loadCharacterEnablePreset();
    
    // 加载角色选择器
    loadCharacterSelector();
}

function loadCharacterEnablePresetList() {
    const settings = extension_settings[extensionName];
    const select = document.getElementById('character_enable_preset_id');
    
    if (!select) return;
    
    select.innerHTML = '';
    
    for (const presetName in settings.characterEnablePresets) {
        const option = document.createElement('option');
        option.value = presetName;
        option.textContent = presetName;
        select.add(option);
    }
    
    select.value = settings.characterEnablePresetId;
}

function loadCharacterEnablePreset() {
    const settings = extension_settings[extensionName];
    const select = document.getElementById('character_enable_preset_id');
    if (!select) return;
    
    const presetId = select.value;
    settings.characterEnablePresetId = presetId;
    
    const preset = settings.characterEnablePresets[presetId];
    const textarea = document.getElementById('character_enable_list');
    
    if (textarea && preset) {
        // 将角色数组转换为换行分割的字符串
        textarea.value = (preset.characters || []).join('\n');
    }
    
    saveSettingsDebounced();
}

function updateCharacterEnablePreset() {
    const settings = extension_settings[extensionName];
    const presetId = settings.characterEnablePresetId;
    
    if (!presetId || !settings.characterEnablePresets[presetId]) {
        alert('没有活动的角色启用预设可保存。请先"另存为"一个新预设。');
        return;
    }
    
    stylishConfirm(`确定要覆盖当前角色启用预设 "${presetId}" 吗？`).then(confirmed => {
        if (confirmed) {
            saveCurrentCharacterEnableData(presetId);
            alert(`角色启用预设 "${presetId}" 已更新。`);
        }
    });
}

function saveCharacterEnablePresetAs() {
    stylInput("请输入新角色启用预设的名称").then((result) => {
        if (result && result.trim() !== '') {
            const settings = extension_settings[extensionName];
            saveCurrentCharacterEnableData(result);
            settings.characterEnablePresetId = result;
            loadCharacterEnablePresetList();
            alert(`角色启用预设 "${result}" 已保存。`);
        }
    });
}

function saveCurrentCharacterEnableData(presetId) {
    const settings = extension_settings[extensionName];
    const textarea = document.getElementById('character_enable_list');
    
    if (!textarea) return;
    
    // 将文本框内容按行分割，过滤空行
    const characters = textarea.value
        .split('\n')
        .map(line => line.trim())
        .filter(line => line.length > 0);
    
    settings.characterEnablePresets[presetId] = {
        characters: characters
    };
    
    saveSettingsDebounced();
}

function deleteCharacterEnablePreset() {
    const settings = extension_settings[extensionName];
    const presetId = document.getElementById('character_enable_preset_id')?.value;
    
    if (presetId === "默认启用列表") {
        alert("默认预设不能删除");
        return;
    }
    
    stylishConfirm("是否确定删除该角色启用预设").then((result) => {
        if (result) {
            delete settings.characterEnablePresets[presetId];
            settings.characterEnablePresetId = "默认启用列表";
            loadCharacterEnablePresetList();
            loadCharacterEnablePreset();
            saveSettingsDebounced();
        }
    });
}

async function exportCharacterEnablePreset() {
    const settings = extension_settings[extensionName];
    const presetId = settings.characterEnablePresetId;
    const preset = settings.characterEnablePresets[presetId];
    
    if (!preset) {
        alert("没有选中的角色启用预设可导出。");
        return;
    }
    
    // 检查是否有关联的角色列表
    const relatedCharacters = preset.characters || [];
    
    let dataToExport = {
        characterEnablePresets: { [presetId]: preset }
    };
    
    // 如果有关联角色,询问用户是否一起导出
    if (relatedCharacters.length > 0) {
        const confirmMessage = `检测到该列表包含 ${relatedCharacters.length} 个角色:\n${relatedCharacters.join('\n')}\n\n是否一起导出相关角色?`;
        const includeCharacters = await stylishConfirm(confirmMessage);
        
        if (includeCharacters) {
            dataToExport.characters = {};
            relatedCharacters.forEach(charName => {
                if (settings.characterPresets[charName]) {
                    const charPreset = settings.characterPresets[charName];
                    dataToExport.characters[charName] = charPreset;
                    
                    // 同时收集该角色的服装
                    const charOutfits = charPreset.outfits || [];
                    if (charOutfits.length > 0) {
                        if (!dataToExport.outfits) {
                            dataToExport.outfits = {};
                        }
                        charOutfits.forEach(outfitName => {
                            if (settings.outfitPresets[outfitName]) {
                                dataToExport.outfits[outfitName] = settings.outfitPresets[outfitName];
                            }
                        });
                    }
                }
            });
        }
    }
    
    // ✅ 使用统一的加密导出函数（包含预设名称加密）
    dataToExport = await encryptExportData(dataToExport);
    
    const dataStr = JSON.stringify(dataToExport, null, 2);
    const blob = new Blob([dataStr], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `st-chatu8-角色启用列表-${presetId}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

async function exportAllCharacterEnablePresets() {
    const settings = extension_settings[extensionName];
    if (!settings.characterEnablePresets || Object.keys(settings.characterEnablePresets).length === 0) {
        alert("没有角色启用预设可导出。");
        return;
    }
    
    // 收集所有角色启用预设中的角色和关联的服装
    const allCharacters = new Set();
    const allOutfits = new Set();
    
    for (const presetName in settings.characterEnablePresets) {
        const preset = settings.characterEnablePresets[presetName];
        const characters = preset.characters || [];
        characters.forEach(charName => {
            allCharacters.add(charName);
            // 收集该角色的服装
            if (settings.characterPresets[charName]) {
                const charOutfits = settings.characterPresets[charName].outfits || [];
                charOutfits.forEach(outfitName => allOutfits.add(outfitName));
            }
        });
    }
    
    let dataToExport = {
        characterEnablePresets: settings.characterEnablePresets
    };
    
    // 如果有关联角色,询问用户是否一起导出
    if (allCharacters.size > 0) {
        const confirmMessage = `检测到所有列表共包含 ${allCharacters.size} 个不同的角色:\n${Array.from(allCharacters).join('\n')}\n\n是否一起导出相关角色?`;
        const includeCharacters = await stylishConfirm(confirmMessage);
        
        if (includeCharacters) {
            dataToExport.characters = {};
            allCharacters.forEach(charName => {
                if (settings.characterPresets[charName]) {
                    dataToExport.characters[charName] = settings.characterPresets[charName];
                }
            });
            
            // 如果导出角色,询问是否也导出服装
            if (allOutfits.size > 0) {
                const confirmOutfits = `同时检测到这些角色包含 ${allOutfits.size} 个不同的服装:\n${Array.from(allOutfits).join('\n')}\n\n是否也一起导出?`;
                const includeOutfits = await stylishConfirm(confirmOutfits);
                
                if (includeOutfits) {
                    dataToExport.outfits = {};
                    allOutfits.forEach(outfitName => {
                        if (settings.outfitPresets[outfitName]) {
                            dataToExport.outfits[outfitName] = settings.outfitPresets[outfitName];
                        }
                    });
                }
            }
        }
    }
    
    // ✅ 使用统一的加密导出函数
    dataToExport = await encryptExportData(dataToExport);
    
    const dataStr = JSON.stringify(dataToExport, null, 2);
    const blob = new Blob([dataStr], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "st-chatu8-角色启用列表-全部.json";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

function importCharacterEnablePreset() {
    const settings = extension_settings[extensionName];
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.onchange = async e => {
        const file = e.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = async readerEvent => {
            try {
                let importedData = JSON.parse(readerEvent.target.result);
                
                // 自动检测并解密数据
                importedData = decryptImportData(importedData);
                
                // 检查新格式或旧格式
                let enablePresetsToImport = {};
                let charactersToImport = {};
                let outfitsToImport = {};
                
                if (importedData.characterEnablePresets) {
                    // 新格式
                    enablePresetsToImport = importedData.characterEnablePresets;
                    charactersToImport = importedData.characters || {};
                    outfitsToImport = importedData.outfits || {};
                } else {
                    // 旧格式
                    enablePresetsToImport = importedData;
                }
                
                // 如果有关联的角色,询问用户是否一起导入
                let importCharacters = false;
                if (Object.keys(charactersToImport).length > 0) {
                    const characterNames = Object.keys(charactersToImport);
                    const confirmMessage = `检测到 ${characterNames.length} 个相关角色:\n${characterNames.join('\n')}\n\n是否一起导入?`;
                    importCharacters = await stylishConfirm(confirmMessage);
                }
                
                // 导入角色启用预设
                let newEnablePresetsCount = 0;
                for (const key in enablePresetsToImport) {
                    if (enablePresetsToImport.hasOwnProperty(key)) {
                        if (!settings.characterEnablePresets.hasOwnProperty(key)) {
                            newEnablePresetsCount++;
                        }
                        settings.characterEnablePresets[key] = enablePresetsToImport[key];
                    }
                }
                
                // 导入角色(如果用户确认)
                let newCharactersCount = 0;
                let newOutfitsCount = 0;
                if (importCharacters) {
                    for (const key in charactersToImport) {
                        if (charactersToImport.hasOwnProperty(key)) {
                            if (!settings.characterPresets.hasOwnProperty(key)) {
                                newCharactersCount++;
                            }
                            settings.characterPresets[key] = charactersToImport[key];
                        }
                    }
                    
                    // 同时导入服装
                    for (const key in outfitsToImport) {
                        if (outfitsToImport.hasOwnProperty(key)) {
                            if (!settings.outfitPresets.hasOwnProperty(key)) {
                                newOutfitsCount++;
                            }
                            settings.outfitPresets[key] = outfitsToImport[key];
                        }
                    }
                }
                
                saveSettingsDebounced();
                loadCharacterEnablePresetList();
                if (importCharacters) {
                    loadCharacterPresetList();
                    loadOutfitPresetList();
                }
                
                // 自动选择第一个导入的预设
                const firstImportedKey = Object.keys(enablePresetsToImport)[0];
                if (firstImportedKey) {
                    settings.characterEnablePresetId = firstImportedKey;
                    const select = document.getElementById('character_enable_preset_id');
                    if (select) select.value = firstImportedKey;
                    loadCharacterEnablePreset();
                }
                
                let message = `成功导入 ${Object.keys(enablePresetsToImport).length} 个角色启用预设，其中 ${newEnablePresetsCount} 个是全新的。`;
                if (importCharacters) {
                    message += `\n同时导入 ${Object.keys(charactersToImport).length} 个角色预设(${newCharactersCount} 个全新)`;
                    message += `和 ${Object.keys(outfitsToImport).length} 个服装预设(${newOutfitsCount} 个全新)。`;
                }
                alert(message);
            } catch (err) {
                alert("导入失败，请确保文件是正确的JSON格式。\n错误信息: " + err.message);
                console.error("Error importing character enable presets:", err);
            }
        };
        reader.readAsText(file);
    };
    input.click();
}

/**
 * 加载角色选择器
 */
function loadCharacterSelector() {
    const settings = extension_settings[extensionName];
    const select = document.getElementById('character_enable_selector');
    
    if (!select) return;
    
    select.innerHTML = '<option value="">-- 选择角色 --</option>';
    
    // 从角色预设中加载所有角色 - 使用预设名称作为判定
    for (const presetName in settings.characterPresets) {
        const option = document.createElement('option');
        option.value = presetName;
        option.textContent = presetName;
        select.add(option);
    }
}

/**
 * 从选择器添加角色
 */
function addCharacterFromSelector() {
    const select = document.getElementById('character_enable_selector');
    const textarea = document.getElementById('character_enable_list');
    
    if (!select || !textarea) return;
    
    const selectedCharacter = select.value;
    if (!selectedCharacter) {
        alert('请先选择一个角色');
        return;
    }
    
    // 获取当前文本框内容
    const currentText = textarea.value.trim();
    const lines = currentText ? currentText.split('\n') : [];
    
    // 检查是否已存在
    if (lines.includes(selectedCharacter)) {
        alert('该角色已在列表中');
        return;
    }
    
    // 添加角色
    lines.push(selectedCharacter);
    textarea.value = lines.join('\n');
}

// ========== 角色服装列表管理 ==========

/**
 * 加载角色的服装选择器
 */
function loadCharacterOutfitSelector() {
    const settings = extension_settings[extensionName];
    const select = document.getElementById('char_outfit_selector');
    
    if (!select) return;
    
    select.innerHTML = '<option value="">-- 选择服装 --</option>';
    
    // 从服装预设中加载所有服装 - 使用预设名称作为判定
    for (const presetName in settings.outfitPresets) {
        const option = document.createElement('option');
        option.value = presetName;
        option.textContent = presetName;
        select.add(option);
    }
}

/**
 * 从选择器添加服装到角色
 */
function addOutfitFromSelector() {
    const select = document.getElementById('char_outfit_selector');
    const textarea = document.getElementById('char_outfit_list');
    
    if (!select || !textarea) return;
    
    const selectedOutfit = select.value;
    if (!selectedOutfit) {
        alert('请先选择一个服装');
        return;
    }
    
    // 获取当前文本框内容
    const currentText = textarea.value.trim();
    const lines = currentText ? currentText.split('\n') : [];
    
    // 检查是否已存在
    if (lines.includes(selectedOutfit)) {
        alert('该服装已在列表中');
        return;
    }
    
    // 添加服装
    lines.push(selectedOutfit);
    textarea.value = lines.join('\n');
}

/**
 * 检测角色服装列表中的服装是否存在
 */
function checkCharacterOutfitList() {
    const settings = extension_settings[extensionName];
    const textarea = document.getElementById('char_outfit_list');
    const resultDiv = document.getElementById('char_outfit_check_result');
    const contentDiv = document.getElementById('char_outfit_check_content');
    
    if (!textarea || !resultDiv || !contentDiv) return;
    
    // 获取输入的服装列表
    const inputOutfits = textarea.value
        .split('\n')
        .map(line => line.trim())
        .filter(line => line.length > 0);
    
    if (inputOutfits.length === 0) {
        alert('请先输入服装名称');
        return;
    }
    
    // 获取所有可用的服装预设名称
    const availableOutfits = new Set();
    for (const presetName in settings.outfitPresets) {
        availableOutfits.add(presetName);
    }
    
    // 检测结果
    const results = {
        found: [],
        notFound: []
    };
    
    inputOutfits.forEach(outfit => {
        if (availableOutfits.has(outfit)) {
            results.found.push(outfit);
        } else {
            results.notFound.push(outfit);
        }
    });
    
    // 显示结果
    let html = '<div style="margin-bottom: 10px;">';
    html += `<strong>总计：</strong>${inputOutfits.length} 个服装`;
    html += `<br><strong>找到：</strong>${results.found.length} 个`;
    html += `<br><strong>未找到：</strong>${results.notFound.length} 个`;
    html += '</div>';
    
    if (results.found.length > 0) {
        html += '<div style="margin-bottom: 10px;">';
        html += '<strong style="color: #28a745;">✓ 已存在的服装：</strong>';
        html += '<ul style="margin: 5px 0; padding-left: 20px;">';
        results.found.forEach(outfit => {
            html += `<li>${outfit}</li>`;
        });
        html += '</ul></div>';
    }
    
    if (results.notFound.length > 0) {
        html += '<div>';
        html += '<strong style="color: #dc3545;">✗ 未找到的服装：</strong>';
        html += '<ul style="margin: 5px 0; padding-left: 20px;">';
        results.notFound.forEach(outfit => {
            html += `<li>${outfit}</li>`;
        });
        html += '</ul></div>';
    }
    
    contentDiv.innerHTML = html;
    $(resultDiv).show();
}

// ========== 通用服装列表管理 ==========

/**
 * 设置通用服装列表管理控件
 */
function setupOutfitEnableControls(container) {
    // 加载预设列表
    loadOutfitEnablePresetList();
    
    // 绑定预设选择
    container.find('#outfit_enable_preset_id').on('change', loadOutfitEnablePreset);
    
    // 绑定按钮
    container.find('#outfit_enable_update').on('click', updateOutfitEnablePreset);
    container.find('#outfit_enable_save_as').on('click', saveOutfitEnablePresetAs);
    container.find('#outfit_enable_export').on('click', exportOutfitEnablePreset);
    container.find('#outfit_enable_export_all').on('click', exportAllOutfitEnablePresets);
    container.find('#outfit_enable_import').on('click', importOutfitEnablePreset);
    container.find('#outfit_enable_delete').on('click', deleteOutfitEnablePreset);
    container.find('#outfit_enable_check').on('click', checkOutfitEnableList);
    container.find('#outfit_enable_add').on('click', addOutfitFromEnableSelector);
    container.find('#outfit_enable_refresh').on('click', loadOutfitEnableSelector);
    
    // 加载当前预设
    loadOutfitEnablePreset();
    
    // 加载服装选择器
    loadOutfitEnableSelector();
}

function loadOutfitEnablePresetList() {
    const settings = extension_settings[extensionName];
    const select = document.getElementById('outfit_enable_preset_id');
    
    if (!select) return;
    
    select.innerHTML = '';
    
    for (const presetName in settings.outfitEnablePresets) {
        const option = document.createElement('option');
        option.value = presetName;
        option.textContent = presetName;
        select.add(option);
    }
    
    select.value = settings.outfitEnablePresetId;
}

function loadOutfitEnablePreset() {
    const settings = extension_settings[extensionName];
    const select = document.getElementById('outfit_enable_preset_id');
    if (!select) return;
    
    const presetId = select.value;
    settings.outfitEnablePresetId = presetId;
    
    const preset = settings.outfitEnablePresets[presetId];
    const textarea = document.getElementById('outfit_enable_list');
    
    if (textarea && preset) {
        textarea.value = (preset.outfits || []).join('\n');
    }
    
    saveSettingsDebounced();
}

function updateOutfitEnablePreset() {
    const settings = extension_settings[extensionName];
    const presetId = settings.outfitEnablePresetId;
    
    if (!presetId || !settings.outfitEnablePresets[presetId]) {
        alert('没有活动的通用服装列表预设可保存。请先"另存为"一个新预设。');
        return;
    }
    
    stylishConfirm(`确定要覆盖当前通用服装列表预设 "${presetId}" 吗？`).then(confirmed => {
        if (confirmed) {
            saveCurrentOutfitEnableData(presetId);
            alert(`通用服装列表预设 "${presetId}" 已更新。`);
        }
    });
}

function saveOutfitEnablePresetAs() {
    stylInput("请输入新通用服装列表预设的名称").then((result) => {
        if (result && result.trim() !== '') {
            const settings = extension_settings[extensionName];
            saveCurrentOutfitEnableData(result);
            settings.outfitEnablePresetId = result;
            loadOutfitEnablePresetList();
            alert(`通用服装列表预设 "${result}" 已保存。`);
        }
    });
}

function saveCurrentOutfitEnableData(presetId) {
    const settings = extension_settings[extensionName];
    const textarea = document.getElementById('outfit_enable_list');
    
    if (!textarea) return;
    
    const outfits = textarea.value
        .split('\n')
        .map(line => line.trim())
        .filter(line => line.length > 0);
    
    settings.outfitEnablePresets[presetId] = {
        outfits: outfits
    };
    
    saveSettingsDebounced();
}

function deleteOutfitEnablePreset() {
    const settings = extension_settings[extensionName];
    const presetId = document.getElementById('outfit_enable_preset_id')?.value;
    
    if (presetId === "默认服装列表") {
        alert("默认预设不能删除");
        return;
    }
    
    stylishConfirm("是否确定删除该通用服装列表预设").then((result) => {
        if (result) {
            delete settings.outfitEnablePresets[presetId];
            settings.outfitEnablePresetId = "默认服装列表";
            loadOutfitEnablePresetList();
            loadOutfitEnablePreset();
            saveSettingsDebounced();
        }
    });
}

async function exportOutfitEnablePreset() {
    const settings = extension_settings[extensionName];
    const presetId = settings.outfitEnablePresetId;
    const preset = settings.outfitEnablePresets[presetId];
    
    if (!preset) {
        alert("没有选中的通用服装列表预设可导出。");
        return;
    }
    
    // 检查是否有关联的服装列表
    const relatedOutfits = preset.outfits || [];
    
    let dataToExport = {
        outfitEnablePresets: { [presetId]: preset }
    };
    
    // 如果有关联服装,询问用户是否一起导出
    if (relatedOutfits.length > 0) {
        const confirmMessage = `检测到该列表包含 ${relatedOutfits.length} 个服装:\n${relatedOutfits.join('\n')}\n\n是否一起导出相关服装?`;
        const includeOutfits = await stylishConfirm(confirmMessage);
        
        if (includeOutfits) {
            dataToExport.outfits = {};
            relatedOutfits.forEach(outfitName => {
                if (settings.outfitPresets[outfitName]) {
                    dataToExport.outfits[outfitName] = settings.outfitPresets[outfitName];
                }
            });
        }
    }
    
    // ✅ 使用统一的加密导出函数（包含预设名称加密）
    dataToExport = await encryptExportData(dataToExport);
    
    const dataStr = JSON.stringify(dataToExport, null, 2);
    const blob = new Blob([dataStr], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `st-chatu8-通用服装列表-${presetId}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

async function exportAllOutfitEnablePresets() {
    const settings = extension_settings[extensionName];
    if (!settings.outfitEnablePresets || Object.keys(settings.outfitEnablePresets).length === 0) {
        alert("没有通用服装列表预设可导出。");
        return;
    }
    
    // 收集所有通用服装列表预设中的服装
    const allOutfits = new Set();
    
    for (const presetName in settings.outfitEnablePresets) {
        const preset = settings.outfitEnablePresets[presetName];
        const outfits = preset.outfits || [];
        outfits.forEach(outfitName => allOutfits.add(outfitName));
    }
    
    let dataToExport = {
        outfitEnablePresets: settings.outfitEnablePresets
    };
    
    // 如果有关联服装,询问用户是否一起导出
    if (allOutfits.size > 0) {
        const confirmMessage = `检测到所有列表共包含 ${allOutfits.size} 个不同的服装:\n${Array.from(allOutfits).join('\n')}\n\n是否一起导出相关服装?`;
        const includeOutfits = await stylishConfirm(confirmMessage);
        
        if (includeOutfits) {
            dataToExport.outfits = {};
            allOutfits.forEach(outfitName => {
                if (settings.outfitPresets[outfitName]) {
                    dataToExport.outfits[outfitName] = settings.outfitPresets[outfitName];
                }
            });
        }
    }
    
    // ✅ 使用统一的加密导出函数
    dataToExport = await encryptExportData(dataToExport);
    
    const dataStr = JSON.stringify(dataToExport, null, 2);
    const blob = new Blob([dataStr], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "st-chatu8-通用服装列表-全部.json";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

function importOutfitEnablePreset() {
    const settings = extension_settings[extensionName];
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.onchange = async e => {
        const file = e.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = async readerEvent => {
            try {
                let importedData = JSON.parse(readerEvent.target.result);
                
                // 自动检测并解密数据
                importedData = decryptImportData(importedData);
                
                // 检查新格式或旧格式
                let enablePresetsToImport = {};
                let outfitsToImport = {};
                
                if (importedData.outfitEnablePresets) {
                    // 新格式
                    enablePresetsToImport = importedData.outfitEnablePresets;
                    outfitsToImport = importedData.outfits || {};
                } else {
                    // 旧格式
                    enablePresetsToImport = importedData;
                }
                
                // 如果有关联的服装,询问用户是否一起导入
                let importOutfits = false;
                if (Object.keys(outfitsToImport).length > 0) {
                    const outfitNames = Object.keys(outfitsToImport);
                    const confirmMessage = `检测到 ${outfitNames.length} 个相关服装:\n${outfitNames.join('\n')}\n\n是否一起导入?`;
                    importOutfits = await stylishConfirm(confirmMessage);
                }
                
                // 导入服装启用预设
                let newEnablePresetsCount = 0;
                for (const key in enablePresetsToImport) {
                    if (enablePresetsToImport.hasOwnProperty(key)) {
                        if (!settings.outfitEnablePresets.hasOwnProperty(key)) {
                            newEnablePresetsCount++;
                        }
                        settings.outfitEnablePresets[key] = enablePresetsToImport[key];
                    }
                }
                
                // 导入服装(如果用户确认)
                let newOutfitsCount = 0;
                if (importOutfits) {
                    for (const key in outfitsToImport) {
                        if (outfitsToImport.hasOwnProperty(key)) {
                            if (!settings.outfitPresets.hasOwnProperty(key)) {
                                newOutfitsCount++;
                            }
                            settings.outfitPresets[key] = outfitsToImport[key];
                        }
                    }
                }
                
                saveSettingsDebounced();
                loadOutfitEnablePresetList();
                if (importOutfits) {
                    loadOutfitPresetList();
                }
                
                // 自动选择第一个导入的预设
                const firstImportedKey = Object.keys(enablePresetsToImport)[0];
                if (firstImportedKey) {
                    settings.outfitEnablePresetId = firstImportedKey;
                    const select = document.getElementById('outfit_enable_preset_id');
                    if (select) select.value = firstImportedKey;
                    loadOutfitEnablePreset();
                }
                
                let message = `成功导入 ${Object.keys(enablePresetsToImport).length} 个通用服装列表预设，其中 ${newEnablePresetsCount} 个是全新的。`;
                if (importOutfits) {
                    message += `\n同时导入 ${Object.keys(outfitsToImport).length} 个服装预设，其中 ${newOutfitsCount} 个是全新的。`;
                }
                alert(message);
            } catch (err) {
                alert("导入失败，请确保文件是正确的JSON格式。\n错误信息: " + err.message);
                console.error("Error importing outfit enable presets:", err);
            }
        };
        reader.readAsText(file);
    };
    input.click();
}

function loadOutfitEnableSelector() {
    const settings = extension_settings[extensionName];
    const select = document.getElementById('outfit_enable_selector');
    
    if (!select) return;
    
    select.innerHTML = '<option value="">-- 选择服装 --</option>';
    
    for (const presetName in settings.outfitPresets) {
        const option = document.createElement('option');
        option.value = presetName;
        option.textContent = presetName;
        select.add(option);
    }
}

function addOutfitFromEnableSelector() {
    const select = document.getElementById('outfit_enable_selector');
    const textarea = document.getElementById('outfit_enable_list');
    
    if (!select || !textarea) return;
    
    const selectedOutfit = select.value;
    if (!selectedOutfit) {
        alert('请先选择一个服装');
        return;
    }
    
    const currentText = textarea.value.trim();
    const lines = currentText ? currentText.split('\n') : [];
    
    if (lines.includes(selectedOutfit)) {
        alert('该服装已在列表中');
        return;
    }
    
    lines.push(selectedOutfit);
    textarea.value = lines.join('\n');
}

function checkOutfitEnableList() {
    const settings = extension_settings[extensionName];
    const textarea = document.getElementById('outfit_enable_list');
    const resultDiv = document.getElementById('outfit_enable_check_result');
    const contentDiv = document.getElementById('outfit_enable_check_content');
    
    if (!textarea || !resultDiv || !contentDiv) return;
    
    const inputOutfits = textarea.value
        .split('\n')
        .map(line => line.trim())
        .filter(line => line.length > 0);
    
    if (inputOutfits.length === 0) {
        alert('请先输入服装名称');
        return;
    }
    
    const availableOutfits = new Set();
    for (const presetName in settings.outfitPresets) {
        availableOutfits.add(presetName);
    }
    
    const results = { found: [], notFound: [] };
    
    inputOutfits.forEach(outfit => {
        if (availableOutfits.has(outfit)) {
            results.found.push(outfit);
        } else {
            results.notFound.push(outfit);
        }
    });
    
    let html = '<div style="margin-bottom: 10px;">';
    html += `<strong>总计：</strong>${inputOutfits.length} 个服装`;
    html += `<br><strong>找到：</strong>${results.found.length} 个`;
    html += `<br><strong>未找到：</strong>${results.notFound.length} 个`;
    html += '</div>';
    
    if (results.found.length > 0) {
        html += '<div style="margin-bottom: 10px;">';
        html += '<strong style="color: #28a745;">✓ 已存在的服装：</strong>';
        html += '<ul style="margin: 5px 0; padding-left: 20px;">';
        results.found.forEach(outfit => {
            html += `<li>${outfit}</li>`;
        });
        html += '</ul></div>';
    }
    
    if (results.notFound.length > 0) {
        html += '<div>';
        html += '<strong style="color: #dc3545;">✗ 未找到的服装：</strong>';
        html += '<ul style="margin: 5px 0; padding-left: 20px;">';
        results.notFound.forEach(outfit => {
            html += `<li>${outfit}</li>`;
        });
        html += '</ul></div>';
    }
    
    contentDiv.innerHTML = html;
    $(resultDiv).show();
}

// ========== 通用角色列表管理 ==========

/**
 * 设置通用角色列表管理控件
 */
function setupCharacterCommonControls(container) {
    // 加载预设列表
    loadCharacterCommonPresetList();
    
    // 绑定预设选择
    container.find('#character_common_preset_id').on('change', loadCharacterCommonPreset);
    
    // 绑定按钮
    container.find('#character_common_update').on('click', updateCharacterCommonPreset);
    container.find('#character_common_save_as').on('click', saveCharacterCommonPresetAs);
    container.find('#character_common_export').on('click', exportCharacterCommonPreset);
    container.find('#character_common_export_all').on('click', exportAllCharacterCommonPresets);
    container.find('#character_common_import').on('click', importCharacterCommonPreset);
    container.find('#character_common_delete').on('click', deleteCharacterCommonPreset);
    container.find('#character_common_check').on('click', checkCharacterCommonList);
    container.find('#character_common_add').on('click', addCharacterFromCommonSelector);
    container.find('#character_common_refresh').on('click', loadCharacterCommonSelector);
    
    // 加载当前预设
    loadCharacterCommonPreset();
    
    // 加载角色选择器
    loadCharacterCommonSelector();
}

function loadCharacterCommonPresetList() {
    const settings = extension_settings[extensionName];
    const select = document.getElementById('character_common_preset_id');
    
    if (!select) return;
    
    select.innerHTML = '';
    
    for (const presetName in settings.characterCommonPresets) {
        const option = document.createElement('option');
        option.value = presetName;
        option.textContent = presetName;
        select.add(option);
    }
    
    select.value = settings.characterCommonPresetId;
}

function loadCharacterCommonPreset() {
    const settings = extension_settings[extensionName];
    const select = document.getElementById('character_common_preset_id');
    if (!select) return;
    
    const presetId = select.value;
    settings.characterCommonPresetId = presetId;
    
    const preset = settings.characterCommonPresets[presetId];
    const textarea = document.getElementById('character_common_list');
    
    if (textarea && preset) {
        textarea.value = (preset.characters || []).join('\n');
    }
    
    saveSettingsDebounced();
}

function updateCharacterCommonPreset() {
    const settings = extension_settings[extensionName];
    const presetId = settings.characterCommonPresetId;
    
    if (!presetId || !settings.characterCommonPresets[presetId]) {
        alert('没有活动的通用角色列表预设可保存。请先"另存为"一个新预设。');
        return;
    }
    
    stylishConfirm(`确定要覆盖当前通用角色列表预设 "${presetId}" 吗？`).then(confirmed => {
        if (confirmed) {
            saveCurrentCharacterCommonData(presetId);
            alert(`通用角色列表预设 "${presetId}" 已更新。`);
        }
    });
}

function saveCharacterCommonPresetAs() {
    stylInput("请输入新通用角色列表预设的名称").then((result) => {
        if (result && result.trim() !== '') {
            const settings = extension_settings[extensionName];
            saveCurrentCharacterCommonData(result);
            settings.characterCommonPresetId = result;
            loadCharacterCommonPresetList();
            alert(`通用角色列表预设 "${result}" 已保存。`);
        }
    });
}

function saveCurrentCharacterCommonData(presetId) {
    const settings = extension_settings[extensionName];
    const textarea = document.getElementById('character_common_list');
    
    if (!textarea) return;
    
    const characters = textarea.value
        .split('\n')
        .map(line => line.trim())
        .filter(line => line.length > 0);
    
    settings.characterCommonPresets[presetId] = {
        characters: characters
    };
    
    saveSettingsDebounced();
}

function deleteCharacterCommonPreset() {
    const settings = extension_settings[extensionName];
    const presetId = document.getElementById('character_common_preset_id')?.value;
    
    if (presetId === "默认通用角色列表") {
        alert("默认预设不能删除");
        return;
    }
    
    stylishConfirm("是否确定删除该通用角色列表预设").then((result) => {
        if (result) {
            delete settings.characterCommonPresets[presetId];
            settings.characterCommonPresetId = "默认通用角色列表";
            loadCharacterCommonPresetList();
            loadCharacterCommonPreset();
            saveSettingsDebounced();
        }
    });
}

async function exportCharacterCommonPreset() {
    const settings = extension_settings[extensionName];
    const presetId = settings.characterCommonPresetId;
    const preset = settings.characterCommonPresets[presetId];
    
    if (!preset) {
        alert("没有选中的通用角色列表预设可导出。");
        return;
    }
    
    // 检查是否有关联的角色列表
    const relatedCharacters = preset.characters || [];
    
    let dataToExport = {
        characterCommonPresets: { [presetId]: preset }
    };
    
    // 如果有关联角色,询问用户是否一起导出
    if (relatedCharacters.length > 0) {
        const confirmMessage = `检测到该列表包含 ${relatedCharacters.length} 个角色:\n${relatedCharacters.join('\n')}\n\n是否一起导出相关角色?`;
        const includeCharacters = await stylishConfirm(confirmMessage);
        
        if (includeCharacters) {
            dataToExport.characters = {};
            relatedCharacters.forEach(charName => {
                if (settings.characterPresets[charName]) {
                    const charPreset = settings.characterPresets[charName];
                    dataToExport.characters[charName] = charPreset;
                    
                    // 同时收集该角色的服装
                    const charOutfits = charPreset.outfits || [];
                    if (charOutfits.length > 0) {
                        if (!dataToExport.outfits) {
                            dataToExport.outfits = {};
                        }
                        charOutfits.forEach(outfitName => {
                            if (settings.outfitPresets[outfitName]) {
                                dataToExport.outfits[outfitName] = settings.outfitPresets[outfitName];
                            }
                        });
                    }
                }
            });
        }
    }
    
    // ✅ 使用统一的加密导出函数（包含预设名称加密）
    dataToExport = await encryptExportData(dataToExport);
    
    const dataStr = JSON.stringify(dataToExport, null, 2);
    const blob = new Blob([dataStr], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `st-chatu8-通用角色列表-${presetId}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

async function exportAllCharacterCommonPresets() {
    const settings = extension_settings[extensionName];
    if (!settings.characterCommonPresets || Object.keys(settings.characterCommonPresets).length === 0) {
        alert("没有通用角色列表预设可导出。");
        return;
    }
    
    // 收集所有通用角色列表预设中的角色和关联的服装
    const allCharacters = new Set();
    const allOutfits = new Set();
    
    for (const presetName in settings.characterCommonPresets) {
        const preset = settings.characterCommonPresets[presetName];
        const characters = preset.characters || [];
        characters.forEach(charName => {
            allCharacters.add(charName);
            // 收集该角色的服装
            if (settings.characterPresets[charName]) {
                const charOutfits = settings.characterPresets[charName].outfits || [];
                charOutfits.forEach(outfitName => allOutfits.add(outfitName));
            }
        });
    }
    
    let dataToExport = {
        characterCommonPresets: settings.characterCommonPresets
    };
    
    // 如果有关联角色,询问用户是否一起导出
    if (allCharacters.size > 0) {
        const confirmMessage = `检测到所有列表共包含 ${allCharacters.size} 个不同的角色:\n${Array.from(allCharacters).join('\n')}\n\n是否一起导出相关角色?`;
        const includeCharacters = await stylishConfirm(confirmMessage);
        
        if (includeCharacters) {
            dataToExport.characters = {};
            allCharacters.forEach(charName => {
                if (settings.characterPresets[charName]) {
                    dataToExport.characters[charName] = settings.characterPresets[charName];
                }
            });
            
            // 如果导出角色,询问是否也导出服装
            if (allOutfits.size > 0) {
                const confirmOutfits = `同时检测到这些角色包含 ${allOutfits.size} 个不同的服装:\n${Array.from(allOutfits).join('\n')}\n\n是否也一起导出?`;
                const includeOutfits = await stylishConfirm(confirmOutfits);
                
                if (includeOutfits) {
                    dataToExport.outfits = {};
                    allOutfits.forEach(outfitName => {
                        if (settings.outfitPresets[outfitName]) {
                            dataToExport.outfits[outfitName] = settings.outfitPresets[outfitName];
                        }
                    });
                }
            }
        }
    }
    
    // ✅ 使用统一的加密导出函数
    dataToExport = await encryptExportData(dataToExport);
    
    const dataStr = JSON.stringify(dataToExport, null, 2);
    const blob = new Blob([dataStr], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "st-chatu8-通用角色列表-全部.json";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

function importCharacterCommonPreset() {
    const settings = extension_settings[extensionName];
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.onchange = async e => {
        const file = e.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = async readerEvent => {
            try {
                let importedData = JSON.parse(readerEvent.target.result);
                
                // 自动检测并解密数据
                importedData = decryptImportData(importedData);
                
                // 检查新格式或旧格式
                let commonPresetsToImport = {};
                let charactersToImport = {};
                let outfitsToImport = {};
                
                if (importedData.characterCommonPresets) {
                    // 新格式
                    commonPresetsToImport = importedData.characterCommonPresets;
                    charactersToImport = importedData.characters || {};
                    outfitsToImport = importedData.outfits || {};
                } else {
                    // 旧格式
                    commonPresetsToImport = importedData;
                }
                
                // 如果有关联的角色,询问用户是否一起导入
                let importCharacters = false;
                if (Object.keys(charactersToImport).length > 0) {
                    const characterNames = Object.keys(charactersToImport);
                    const confirmMessage = `检测到 ${characterNames.length} 个相关角色:\n${characterNames.join('\n')}\n\n是否一起导入?`;
                    importCharacters = await stylishConfirm(confirmMessage);
                }
                
                // 导入通用角色列表预设
                let newCommonPresetsCount = 0;
                for (const key in commonPresetsToImport) {
                    if (commonPresetsToImport.hasOwnProperty(key)) {
                        if (!settings.characterCommonPresets.hasOwnProperty(key)) {
                            newCommonPresetsCount++;
                        }
                        settings.characterCommonPresets[key] = commonPresetsToImport[key];
                    }
                }
                
                // 导入角色(如果用户确认)
                let newCharactersCount = 0;
                let newOutfitsCount = 0;
                if (importCharacters) {
                    for (const key in charactersToImport) {
                        if (charactersToImport.hasOwnProperty(key)) {
                            if (!settings.characterPresets.hasOwnProperty(key)) {
                                newCharactersCount++;
                            }
                            settings.characterPresets[key] = charactersToImport[key];
                        }
                    }
                    
                    // 同时导入服装
                    for (const key in outfitsToImport) {
                        if (outfitsToImport.hasOwnProperty(key)) {
                            if (!settings.outfitPresets.hasOwnProperty(key)) {
                                newOutfitsCount++;
                            }
                            settings.outfitPresets[key] = outfitsToImport[key];
                        }
                    }
                }
                
                saveSettingsDebounced();
                loadCharacterCommonPresetList();
                if (importCharacters) {
                    loadCharacterPresetList();
                    loadOutfitPresetList();
                }
                
                const firstImportedKey = Object.keys(commonPresetsToImport)[0];
                if (firstImportedKey) {
                    settings.characterCommonPresetId = firstImportedKey;
                    const select = document.getElementById('character_common_preset_id');
                    if (select) select.value = firstImportedKey;
                    loadCharacterCommonPreset();
                }
                
                let message = `成功导入 ${Object.keys(commonPresetsToImport).length} 个通用角色列表预设，其中 ${newCommonPresetsCount} 个是全新的。`;
                if (importCharacters) {
                    message += `\n同时导入 ${Object.keys(charactersToImport).length} 个角色预设(${newCharactersCount} 个全新)`;
                    message += `和 ${Object.keys(outfitsToImport).length} 个服装预设(${newOutfitsCount} 个全新)。`;
                }
                alert(message);
            } catch (err) {
                alert("导入失败，请确保文件是正确的JSON格式。\n错误信息: " + err.message);
                console.error("Error importing character common presets:", err);
            }
        };
        reader.readAsText(file);
    };
    input.click();
}

function loadCharacterCommonSelector() {
    const settings = extension_settings[extensionName];
    const select = document.getElementById('character_common_selector');
    
    if (!select) return;
    
    select.innerHTML = '<option value="">-- 选择角色 --</option>';
    
    for (const presetName in settings.characterPresets) {
        const option = document.createElement('option');
        option.value = presetName;
        option.textContent = presetName;
        select.add(option);
    }
}

function addCharacterFromCommonSelector() {
    const select = document.getElementById('character_common_selector');
    const textarea = document.getElementById('character_common_list');
    
    if (!select || !textarea) return;
    
    const selectedCharacter = select.value;
    if (!selectedCharacter) {
        alert('请先选择一个角色');
        return;
    }
    
    const currentText = textarea.value.trim();
    const lines = currentText ? currentText.split('\n') : [];
    
    if (lines.includes(selectedCharacter)) {
        alert('该角色已在列表中');
        return;
    }
    
    lines.push(selectedCharacter);
    textarea.value = lines.join('\n');
}

function checkCharacterCommonList() {
    const settings = extension_settings[extensionName];
    const textarea = document.getElementById('character_common_list');
    const resultDiv = document.getElementById('character_common_check_result');
    const contentDiv = document.getElementById('character_common_check_content');
    
    if (!textarea || !resultDiv || !contentDiv) return;
    
    const inputCharacters = textarea.value
        .split('\n')
        .map(line => line.trim())
        .filter(line => line.length > 0);
    
    if (inputCharacters.length === 0) {
        alert('请先输入角色名称');
        return;
    }
    
    const availableCharacters = new Set();
    for (const presetName in settings.characterPresets) {
        availableCharacters.add(presetName);
    }
    
    const results = { found: [], notFound: [] };
    
    inputCharacters.forEach(char => {
        if (availableCharacters.has(char)) {
            results.found.push(char);
        } else {
            results.notFound.push(char);
        }
    });
    
    let html = '<div style="margin-bottom: 10px;">';
    html += `<strong>总计：</strong>${inputCharacters.length} 个角色`;
    html += `<br><strong>找到：</strong>${results.found.length} 个`;
    html += `<br><strong>未找到：</strong>${results.notFound.length} 个`;
    html += '</div>';
    
    if (results.found.length > 0) {
        html += '<div style="margin-bottom: 10px;">';
        html += '<strong style="color: #28a745;">✓ 已存在的角色：</strong>';
        html += '<ul style="margin: 5px 0; padding-left: 20px;">';
        results.found.forEach(char => {
            html += `<li>${char}</li>`;
        });
        html += '</ul></div>';
    }
    
    if (results.notFound.length > 0) {
        html += '<div>';
        html += '<strong style="color: #dc3545;">✗ 未找到的角色：</strong>';
        html += '<ul style="margin: 5px 0; padding-left: 20px;">';
        results.notFound.forEach(char => {
            html += `<li>${char}</li>`;
        });
        html += '</ul></div>';
    }
    
    contentDiv.innerHTML = html;
    $(resultDiv).show();
}

/**
 * 替换英文括号为中文括号
 * 替换五官外貌、上半身SFW、全身SFW、上半身NSFW、全身NSFW的输入框中的英文括号
 */
function replaceEnglishBrackets() {
    // 需要替换的字段列表
    const fields = ['facialFeatures', 'upperBodySFW', 'fullBodySFW', 'upperBodyNSFW', 'fullBodyNSFW'];
    
    let replacedCount = 0;
    
    fields.forEach(field => {
        const element = document.getElementById(`char_${field}`);
        if (element && element.value) {
            const originalValue = element.value;
            // 替换英文括号为中文括号
            const newValue = originalValue
                .replace(/\(/g, '（')
                .replace(/\)/g, '）');
            
            if (originalValue !== newValue) {
                element.value = newValue;
                replacedCount++;
                
                // 触发input事件以更新未保存警告
                $(element).trigger('input');
            }
        }
    });
    
    if (replacedCount > 0) {
        alert(`已替换 ${replacedCount} 个输入框中的英文括号为中文括号。`);
    } else {
        alert('没有找到需要替换的英文括号。');
    }
}

/**
 * 替换服装管理页面的英文括号为中文括号
 * 替换上半身、全身服装的输入框中的英文括号
 */
function replaceOutfitEnglishBrackets() {
    // 需要替换的字段列表
    const fields = ['upperBody', 'fullBody'];
    
    let replacedCount = 0;
    
    fields.forEach(field => {
        const element = document.getElementById(`outfit_${field}`);
        if (element && element.value) {
            const originalValue = element.value;
            // 替换英文括号为中文括号
            const newValue = originalValue
                .replace(/\(/g, '（')
                .replace(/\)/g, '）');
            
            if (originalValue !== newValue) {
                element.value = newValue;
                replacedCount++;
                
                // 触发input事件以更新未保存警告
                $(element).trigger('input');
            }
        }
    });
    
    if (replacedCount > 0) {
        alert(`已替换 ${replacedCount} 个输入框中的英文括号为中文括号。`);
    } else {
        alert('没有找到需要替换的英文括号。');
    }
}

/**
 * 检测角色列表中的角色是否存在
 */
function checkCharacterList() {
    const settings = extension_settings[extensionName];
    const textarea = document.getElementById('character_enable_list');
    const resultDiv = document.getElementById('character_enable_check_result');
    const contentDiv = document.getElementById('character_enable_check_content');
    
    if (!textarea || !resultDiv || !contentDiv) return;
    
    // 获取输入的角色列表
    const inputCharacters = textarea.value
        .split('\n')
        .map(line => line.trim())
        .filter(line => line.length > 0);
    
    if (inputCharacters.length === 0) {
        alert('请先输入角色名称');
        return;
    }
    
    // 获取所有可用的角色预设名称
    const availableCharacters = new Set();
    for (const presetName in settings.characterPresets) {
        availableCharacters.add(presetName);
    }
    
    // 检测结果
    const results = {
        found: [],
        notFound: []
    };
    
    inputCharacters.forEach(char => {
        if (availableCharacters.has(char)) {
            results.found.push(char);
        } else {
            results.notFound.push(char);
        }
    });
    
    // 显示结果
    let html = '<div style="margin-bottom: 10px;">';
    html += `<strong>总计：</strong>${inputCharacters.length} 个角色`;
    html += `<br><strong>找到：</strong>${results.found.length} 个`;
    html += `<br><strong>未找到：</strong>${results.notFound.length} 个`;
    html += '</div>';
    
    if (results.found.length > 0) {
        html += '<div style="margin-bottom: 10px;">';
        html += '<strong style="color: #28a745;">✓ 已存在的角色：</strong>';
        html += '<ul style="margin: 5px 0; padding-left: 20px;">';
        results.found.forEach(char => {
            html += `<li>${char}</li>`;
        });
        html += '</ul></div>';
    }
    
    if (results.notFound.length > 0) {
        html += '<div>';
        html += '<strong style="color: #dc3545;">✗ 未找到的角色：</strong>';
        html += '<ul style="margin: 5px 0; padding-left: 20px;">';
        results.notFound.forEach(char => {
            html += `<li>${char}</li>`;
        });
        html += '</ul></div>';
    }
    
    contentDiv.innerHTML = html;
    $(resultDiv).show();
}

// ========== Tag 自动补全功能 ==========

/**
 * 处理tag自动补全
 */
async function handleAutocomplete(inputEl, resultsEl) {
    const text = inputEl.value;
    const cursorPosition = inputEl.selectionStart;

    // 找到光标前后的逗号位置
    const textBeforeCursor = text.substring(0, cursorPosition);
    const textAfterCursor = text.substring(cursorPosition);

    const lastCommaBefore = Math.max(textBeforeCursor.lastIndexOf(','), textBeforeCursor.lastIndexOf('，'));
    const nextCommaAfter = textAfterCursor.search(/[,，]/);

    const startIndex = lastCommaBefore + 1;
    const endIndex = nextCommaAfter !== -1 ? cursorPosition + nextCommaAfter : text.length;
    
    const query = text.substring(startIndex, endIndex).trim();

    if (query.length < 1) {
        resultsEl.style.display = 'none';
        return;
    }

    try {
        // 从设置中读取搜索选项
        const settings = extension_settings[extensionName];
        const startsWith = String(settings.vocabulary_search_startswith) === 'true';
        const limit = parseInt(settings.vocabulary_search_limit, 10);
        const sortBy = settings.vocabulary_search_sort;

        const results = await dbs.searchTags(query, { startsWith, limit, sortBy });
        resultsEl.innerHTML = '';

        if (results.length > 0) {
            results.forEach(tag => {
                const item = document.createElement('div');
                item.className = 'ch-autocomplete-item';
                item.textContent = `${tag.name} (${tag.translation})`;
                item.addEventListener('click', () => handleResultClick(inputEl, resultsEl, tag));
                resultsEl.appendChild(item);
            });
            resultsEl.style.display = 'block';
        } else {
            resultsEl.style.display = 'none';
        }
    } catch (error) {
        console.error('Tag search failed:', error);
        resultsEl.style.display = 'none';
    }
}

/**
 * 处理补全结果点击
 */
function handleResultClick(inputEl, resultsEl, tag) {
    const text = inputEl.value;
    const cursorPosition = inputEl.selectionStart;

    // 找到光标前后的逗号位置
    const textBeforeCursor = text.substring(0, cursorPosition);
    const textAfterCursor = text.substring(cursorPosition);

    const lastCommaBefore = Math.max(textBeforeCursor.lastIndexOf(','), textBeforeCursor.lastIndexOf('，'));
    const nextCommaAfter = textAfterCursor.search(/[,，]/);

    const startIndex = lastCommaBefore + 1;
    const endIndex = nextCommaAfter !== -1 ? cursorPosition + nextCommaAfter : text.length;

    // tag参数是完整的tag对象
    const newTagText = `${tag.name}（${tag.translation}）`;

    // 构建新文本
    const textBefore = text.substring(0, startIndex);
    const textAfter = text.substring(endIndex);

    // 保留前导空格
    const leadingSpace = text.substring(startIndex, startIndex + 1) === ' ' ? ' ' : '';
    
    // 检查后面是否有内容，如果有且不是逗号开头则添加逗号
    const trimmedTextAfter = textAfter.trim();
    const trailingComma = trimmedTextAfter.length > 0 && !trimmedTextAfter.startsWith(',') ? ', ' : '';

    const newText = `${textBefore.trim() ? textBefore : ''}${leadingSpace}${newTagText}${trailingComma}${textAfter.trim() ? textAfter : ''}`;
    
    // 转换中文逗号为英文逗号
    inputEl.value = newText.replace(/，/g, ',');
    resultsEl.style.display = 'none';
    inputEl.focus();

    // 设置光标位置到插入的 tag 之后
    const newCursorPosition = (textBefore + leadingSpace + newTagText + trailingComma).length;
    setTimeout(() => inputEl.setSelectionRange(newCursorPosition, newCursorPosition), 0);
    
    // 触发input事件以更新未保存警告
    $(inputEl).trigger('input');
}

/**
 * 初始化tag自动补全
 */
function initTagAutocomplete() {
    console.log('[Character] Initializing tag autocomplete...');
    
    // 关闭点击外部时隐藏自动补全 - 只绑定一次
    document.addEventListener('click', (event) => {
        // 检查点击是否在textarea或补全结果内
        if (!event.target.closest('.st-chatu8-field-col') && !event.target.closest('.ch-autocomplete-results')) {
            $('.ch-autocomplete-results').hide();
        }
    });

    // 角色设定的输入框 - 包含所有带自动补全的字段
    const characterFields = [
        'char_facialFeatures',
        'char_facialFeaturesBack',
        'char_upperBodySFW',
        'char_upperBodySFWBack',
        'char_fullBodySFW',
        'char_fullBodySFWBack',
        'char_upperBodyNSFW',
        'char_upperBodyNSFWBack',
        'char_fullBodyNSFW',
        'char_fullBodyNSFWBack'
    ];
    characterFields.forEach(fieldId => {
        const textarea = document.getElementById(fieldId);
        const resultsContainer = document.getElementById(`${fieldId}-results`);
        if (textarea && resultsContainer) {
            // 使用 off 防止重复绑定
            $(textarea).off('input').on('input', () => handleAutocomplete(textarea, resultsContainer));
            // 防止点击textarea时关闭补全
            $(textarea).off('click').on('click', (event) => event.stopPropagation());
            
            // 为补全结果容器添加点击阻止传播
            $(resultsContainer).off('click').on('click', (event) => event.stopPropagation());
        }
    });

    // 服装管理的输入框 - 包含所有带自动补全的字段
    const outfitFields = [
        'outfit_upperBody',
        'outfit_upperBodyBack',
        'outfit_fullBody',
        'outfit_fullBodyBack'
    ];
    outfitFields.forEach(fieldId => {
        const textarea = document.getElementById(fieldId);
        const resultsContainer = document.getElementById(`${fieldId}-results`);
        if (textarea && resultsContainer) {
            // 使用 off 防止重复绑定
            $(textarea).off('input').on('input', () => handleAutocomplete(textarea, resultsContainer));
            // 防止点击textarea时关闭补全
            $(textarea).off('click').on('click', (event) => event.stopPropagation());
            
            // 为补全结果容器添加点击阻止传播
            $(resultsContainer).off('click').on('click', (event) => event.stopPropagation());
        }
    });
    
    console.log('[Character] Tag autocomplete initialized');
}

// ========== Banana 角色管理 ==========

/**
 * 设置 Banana 角色管理控件
 */
function setupBananaCharacterControls(container) {
    // 加载预设列表
    loadBananaCharacterPresetList();
    
    // 绑定预设选择
    container.find('#banana_char_preset_id').on('change', loadBananaCharacterPreset);
    
    // 绑定按钮
    container.find('#banana_char_update').on('click', updateBananaCharacterPreset);
    container.find('#banana_char_save_as').on('click', saveBananaCharacterPresetAs);
    container.find('#banana_char_delete').on('click', deleteBananaCharacterPreset);

    // 绑定图片上传
    setupBananaImageUpload('user');
    setupBananaImageUpload('model');

    // 加载当前预设
    loadBananaCharacterPreset();
}

function loadBananaCharacterPresetList() {
    const settings = extension_settings[extensionName];
    const select = document.getElementById('banana_char_preset_id');
    
    if (!select) return;
    
    select.innerHTML = '';
    
    for (const presetName in settings.bananaCharacterPresets) {
        const option = document.createElement('option');
        option.value = presetName;
        option.textContent = presetName;
        select.add(option);
    }
    
    select.value = settings.bananaCharacterPresetId;
}

function loadBananaCharacterPreset() {
    const settings = extension_settings[extensionName];
    const select = document.getElementById('banana_char_preset_id');
    if (!select) return;
    
    const presetId = select.value;
    settings.bananaCharacterPresetId = presetId;
    
    const preset = settings.bananaCharacterPresets[presetId];
    if (!preset) return;

    document.getElementById('banana_char_triggers').value = preset.triggers || '';
    
    const conversation = preset.conversation || { user: { text: '', image: '' }, model: { text: '', image: '' } };
    document.getElementById('banana_char_user_text').value = conversation.user.text || '';
    document.getElementById('banana_char_model_text').value = conversation.model.text || '';

    updateBananaImageUI('user', conversation.user.image);
    updateBananaImageUI('model', conversation.model.image);
    
    saveSettingsDebounced();
}

function updateBananaCharacterPreset() {
    const settings = extension_settings[extensionName];
    const presetId = settings.bananaCharacterPresetId;
    
    if (!presetId || !settings.bananaCharacterPresets[presetId]) {
        alert('没有活动的 Banana 角色预设可保存。请先"另存为"一个新预设。');
        return;
    }
    
    stylishConfirm(`确定要覆盖当前 Banana 角色预设 "${presetId}" 吗？`).then(confirmed => {
        if (confirmed) {
            saveCurrentBananaCharacterData(presetId);
            alert(`Banana 角色预设 "${presetId}" 已更新。`);
        }
    });
}

function saveBananaCharacterPresetAs() {
    stylInput("请输入新 Banana 角色预设的名称").then((result) => {
        if (result && result.trim() !== '') {
            const settings = extension_settings[extensionName];
            saveCurrentBananaCharacterData(result);
            settings.bananaCharacterPresetId = result;
            loadBananaCharacterPresetList();
            alert(`Banana 角色预设 "${result}" 已保存。`);
        }
    });
}

function saveCurrentBananaCharacterData(presetId) {
    const settings = extension_settings[extensionName];
    
    const userImgSrc = document.getElementById('banana_char_user_image').src;
    const modelImgSrc = document.getElementById('banana_char_model_image').src;

    const preset = {
        triggers: document.getElementById('banana_char_triggers').value,
        conversation: {
            user: {
                text: document.getElementById('banana_char_user_text').value,
                image: userImgSrc.startsWith('data:image') ? userImgSrc : ''
            },
            model: {
                text: document.getElementById('banana_char_model_text').value,
                image: modelImgSrc.startsWith('data:image') ? modelImgSrc : ''
            }
        }
    };
    
    settings.bananaCharacterPresets[presetId] = preset;
    saveSettingsDebounced();
}

function deleteBananaCharacterPreset() {
    const settings = extension_settings[extensionName];
    const presetId = document.getElementById('banana_char_preset_id')?.value;
    
    if (Object.keys(settings.bananaCharacterPresets).length <= 1) {
        alert("不能删除最后一个预设。");
        return;
    }
    
    stylishConfirm(`是否确定删除该 Banana 角色预设 "${presetId}"`).then((result) => {
        if (result) {
            delete settings.bananaCharacterPresets[presetId];
            settings.bananaCharacterPresetId = Object.keys(settings.bananaCharacterPresets)[0];
            loadBananaCharacterPresetList();
            loadBananaCharacterPreset();
            saveSettingsDebounced();
        }
    });
}

const setupBananaImageUpload = (role) => {
    const container = document.getElementById(`banana_char_${role}_image_container`);
    const img = document.getElementById(`banana_char_${role}_image`);
    const placeholder = container.querySelector('.st-chatu8-image-placeholder');
    const removeBtn = document.getElementById(`banana_char_${role}_image_remove`);
    const input = document.getElementById(`banana_char_${role}_image_input`);

    if (!container || !img || !placeholder || !removeBtn || !input) return;

    container.addEventListener('click', (event) => {
        if (event.target !== removeBtn && !removeBtn.contains(event.target)) {
            input.click();
        }
    });

    input.addEventListener('change', () => {
        if (input.files && input.files[0]) {
            const reader = new FileReader();
            reader.onload = (e) => {
                img.src = e.target.result;
                img.style.display = 'block';
                placeholder.style.display = 'none';
                removeBtn.style.display = 'block';
            };
            reader.readAsDataURL(input.files[0]);
        }
    });

    removeBtn.addEventListener('click', () => {
        img.src = '';
        img.style.display = 'none';
        placeholder.style.display = 'block';
        removeBtn.style.display = 'none';
        input.value = '';
    });
};

const updateBananaImageUI = (role, imageData) => {
    const img = document.getElementById(`banana_char_${role}_image`);
    const container = document.getElementById(`banana_char_${role}_image_container`);
    if (!img || !container) return;

    const placeholder = container.querySelector('.st-chatu8-image-placeholder');
    const removeBtn = document.getElementById(`banana_char_${role}_image_remove`);

    if (imageData) {
        img.src = imageData;
        img.style.display = 'block';
        placeholder.style.display = 'none';
        removeBtn.style.display = 'block';
    } else {
        img.src = '';
        img.style.display = 'none';
        placeholder.style.display = 'block';
        removeBtn.style.display = 'none';
    }
};
