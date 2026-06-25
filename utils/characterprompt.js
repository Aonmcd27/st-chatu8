/**
 * 角色和服装prompt处理工具
 * 用于解析和替换prompt中的角色/服装标记
 */


import { extension_settings } from "../../../../extensions.js";
import { extensionName } from './config.js';
import { parsePromptStringWithCoordinates } from './utils.js';

/**
 * 标准化名称：统一单引号、移除连字符等，用于匹配比较
 * @param {string} name - 原始名称
 * @returns {string} - 标准化后的名称
 */
function normalizeName(name) {
    return name
        .toLowerCase()
        .replace(/-/g, ' ')
        .replace(/[''`´]/g, "'")  // 统一各种单引号
        .replace(/\s+/g, ' ')     // 统一多个空格为单个
        .trim();
}

/**
 * 计算输入名称与预设名称之间的匹配分数
 * 分数越高表示匹配度越好
 * 
 * 评分规则：
 * - 完全匹配（inputName === presetName）: 1000 + presetName.length
 * - 输入包含预设（inputName.includes(presetName)）: 100 + presetName.length
 * - 预设包含输入（presetName.includes(inputName)）: 50 + inputName.length
 * - 无匹配: 0
 * 
 * @param {string} inputName - 标准化后的输入名称
 * @param {string} presetName - 标准化后的预设名称
 * @returns {number} - 匹配分数，0表示无匹配
 * 
 * @example
 * calculateMatchScore("abcd", "abcd") // 返回 1004 (完全匹配)
 * calculateMatchScore("abcd", "ab")   // 返回 102 (输入包含预设)
 * calculateMatchScore("ab", "abcd")   // 返回 52 (预设包含输入)
 * calculateMatchScore("xyz", "abcd")  // 返回 0 (无匹配)
 */
function calculateMatchScore(inputName, presetName) {
    // 处理空值或无效输入
    if (!inputName || !presetName || typeof inputName !== 'string' || typeof presetName !== 'string') {
        return 0;
    }

    // 完全匹配：最高优先级
    if (inputName === presetName) {
        return 1000 + presetName.length;
    }

    // 输入包含预设：例如 "abcd" 包含 "ab"
    if (inputName.includes(presetName)) {
        return 100 + presetName.length;
    }

    // 预设包含输入：例如 "abcd" 包含 "ab"
    if (presetName.includes(inputName)) {
        return 50 + inputName.length;
    }

    // 无匹配
    return 0;
}

/**
 * 收集所有匹配的角色候选项及其分数
 * 
 * @param {string} inputName - 标准化后的输入名称
 * @param {Object} characterPresets - 角色预设对象映射 {presetId: presetData}
 * @param {string[]} characterIds - 要搜索的角色ID数组
 * @returns {Array<{preset: Object, score: number, matchedName: string}>} - 候选项数组
 * 
 * @example
 * const candidates = collectCharacterCandidates("abcd", characterPresets, enabledCharacters);
 * // 返回: [{preset: {...}, score: 1004, matchedName: "abcd"}, ...]
 */
function collectCharacterCandidates(inputName, characterPresets, characterIds) {
    const candidates = [];

    // 遍历所有指定的角色ID
    for (const charId of characterIds) {
        const char = characterPresets[charId];
        if (!char) continue;

        // 检查英文名称
        if (char.nameEN) {
            const names = char.nameEN.split('|');
            for (const name of names) {
                const trimmedName = name.trim();
                if (!trimmedName) continue;

                const normalizedName = normalizeName(trimmedName);
                const score = calculateMatchScore(inputName, normalizedName);

                if (score > 0) {
                    candidates.push({
                        preset: char,
                        score: score,
                        matchedName: trimmedName
                    });
                }
            }
        }

        // 检查中文名称
        if (char.nameCN) {
            const names = char.nameCN.split('|');
            for (const name of names) {
                const trimmedName = name.trim();
                if (!trimmedName) continue;

                const normalizedName = normalizeName(trimmedName);
                const score = calculateMatchScore(inputName, normalizedName);

                if (score > 0) {
                    candidates.push({
                        preset: char,
                        score: score,
                        matchedName: trimmedName
                    });
                }
            }
        }
    }

    return candidates;
}

/**
 * 收集所有匹配的服装候选项及其分数
 * 
 * @param {string} inputName - 标准化后的输入名称
 * @param {Object} outfitPresets - 服装预设对象映射 {presetId: presetData}
 * @param {string[]} outfitIds - 要搜索的服装ID数组
 * @returns {Array<{preset: Object, score: number, matchedName: string}>} - 候选项数组
 * 
 * @example
 * const candidates = collectOutfitCandidates("school uniform", outfitPresets, enabledOutfits);
 * // 返回: [{preset: {...}, score: 1014, matchedName: "school uniform"}, ...]
 */
function collectOutfitCandidates(inputName, outfitPresets, outfitIds) {
    const candidates = [];

    // 遍历所有指定的服装ID
    for (const outfitId of outfitIds) {
        const outfit = outfitPresets[outfitId];
        if (!outfit) continue;

        // 检查英文名称
        if (outfit.nameEN) {
            const names = outfit.nameEN.split('|');
            for (const name of names) {
                const trimmedName = name.trim();
                if (!trimmedName) continue;

                const normalizedName = normalizeName(trimmedName);
                const score = calculateMatchScore(inputName, normalizedName);

                if (score > 0) {
                    candidates.push({
                        preset: outfit,
                        score: score,
                        matchedName: trimmedName
                    });
                }
            }
        }

        // 检查中文名称
        if (outfit.nameCN) {
            const names = outfit.nameCN.split('|');
            for (const name of names) {
                const trimmedName = name.trim();
                if (!trimmedName) continue;

                const normalizedName = normalizeName(trimmedName);
                const score = calculateMatchScore(inputName, normalizedName);

                if (score > 0) {
                    candidates.push({
                        preset: outfit,
                        score: score,
                        matchedName: trimmedName
                    });
                }
            }
        }
    }

    return candidates;
}

/**
 * 查找最佳匹配的角色预设
 * 使用优先级顺序搜索：启用角色 → 通用角色 → 所有角色
 * 
 * @param {string} inputName - 标准化后的输入名称
 * @param {Object} characterPresets - 所有角色预设对象映射
 * @param {string[]} enabledCharacters - 启用的角色ID数组（优先级1）
 * @param {string[]} commonCharacters - 通用角色ID数组（优先级2）
 * @returns {Object|null} - 最佳匹配的角色预设，如果没有匹配则返回null
 * 
 * @example
 * const match = findBestCharacterMatch("abcd", characterPresets, enabledChars, commonChars);
 * if (match) {
 *   console.log("Matched character:", match.nameEN);
 * }
 */
function findBestCharacterMatch(inputName, characterPresets, enabledCharacters, commonCharacters) {
    // 处理空值或无效输入
    if (!inputName || typeof inputName !== 'string') {
        return null;
    }

    // 优先级1：搜索启用的角色
    let candidates = collectCharacterCandidates(inputName, characterPresets, enabledCharacters);
    if (candidates.length > 0) {
        // 找到分数最高的候选项
        const bestMatch = candidates.reduce((best, current) =>
            current.score > best.score ? current : best
        );
        console.log('[CharacterPrompt] Best character match from enabled characters:',
            bestMatch.matchedName, 'with score:', bestMatch.score);
        return bestMatch.preset;
    }

    // 优先级2：搜索通用角色
    candidates = collectCharacterCandidates(inputName, characterPresets, commonCharacters);
    if (candidates.length > 0) {
        const bestMatch = candidates.reduce((best, current) =>
            current.score > best.score ? current : best
        );
        console.log('[CharacterPrompt] Best character match from common characters:',
            bestMatch.matchedName, 'with score:', bestMatch.score);
        return bestMatch.preset;
    }

    // 优先级3：搜索所有角色（兜底）
    const allCharacterIds = Object.keys(characterPresets);
    candidates = collectCharacterCandidates(inputName, characterPresets, allCharacterIds);
    if (candidates.length > 0) {
        const bestMatch = candidates.reduce((best, current) =>
            current.score > best.score ? current : best
        );
        console.log('[CharacterPrompt] Best character match from all presets (fallback):',
            bestMatch.matchedName, 'with score:', bestMatch.score);
        return bestMatch.preset;
    }

    // 没有找到任何匹配
    return null;
}

export function inspectCharacterPromptTrigger(input) {
    if (!input || typeof input !== 'string') {
        return {
            matched: false,
            extractedName: '',
            normalizedName: '',
            matchedDisplayName: '',
            format: 'invalid'
        };
    }

    const trimmedInput = input.trim();
    const unwrappedInput = trimmedInput.startsWith('$') && trimmedInput.endsWith('$')
        ? trimmedInput.slice(1, -1).trim()
        : trimmedInput;

    let extractedName = unwrappedInput;
    let format = 'plain';

    try {
        if (unwrappedInput.startsWith('{') && unwrappedInput.endsWith('}')) {
            const parsed = JSON.parse(unwrappedInput);
            if (parsed.name) {
                extractedName = parsed.name;
                format = parsed.angle !== undefined ? 'json-character' : 'json';
            }
        }
    } catch (error) {
    }

    if (format === 'plain') {
        const characterFormats = [
            '-sfw-upperbody-sfw-lowerbody',
            '-sfw-upperbody-nsfw-lowerbody',
            '-nsfw-upperbody-sfw-lowerbody',
            '-nsfw-upperbody-nsfw-lowerbody',
            '-sfw-upperbody-sfw-fullbody',
            '-sfw-upperbody-nsfw-fullbody',
            '-nsfw-upperbody-sfw-fullbody',
            '-nsfw-upperbody-nsfw-fullbody',
            '-sfw-upperbody',
            '-nsfw-upperbody',
            '-sfw-lowerbody',
            '-nsfw-lowerbody'
        ];

        for (const pattern of characterFormats) {
            if (unwrappedInput.toLowerCase().endsWith(pattern)) {
                extractedName = unwrappedInput.slice(0, -pattern.length).trim();
                format = 'legacy-character';
                break;
            }
        }
    }

    const normalizedName = normalizeName(extractedName);
    const defaultCharacterSettings = extension_settings[extensionName] || {};
    const characterPresets = defaultCharacterSettings.characterPresets || {};
    const characterEnablePresetId = defaultCharacterSettings.characterEnablePresetId;
    const characterCommonPresetId = defaultCharacterSettings.characterCommonPresetId;
    const enabledCharacters = characterEnablePresetId && defaultCharacterSettings.characterEnablePresets?.[characterEnablePresetId]?.characters || [];
    const commonCharacters = characterCommonPresetId && defaultCharacterSettings.characterCommonPresets?.[characterCommonPresetId]?.characters || [];
    const character = findBestCharacterMatch(normalizedName, characterPresets, enabledCharacters, commonCharacters);
    const matchedDisplayName = character?.nameCN || character?.nameEN || '';

    // 反查命中的预设 ID，以判断其来源（启用列表 / 通用列表 / 全局兜底）
    let matchedPresetId = '';
    if (character) {
        for (const id of Object.keys(characterPresets)) {
            if (characterPresets[id] === character) {
                matchedPresetId = id;
                break;
            }
        }
    }

    let matchSource = 'none';
    if (character) {
        if (matchedPresetId && enabledCharacters.includes(matchedPresetId)) {
            matchSource = 'enabled';
        } else if (matchedPresetId && commonCharacters.includes(matchedPresetId)) {
            matchSource = 'common';
        } else {
            matchSource = 'fallback-all';
        }
    }

    return {
        matched: Boolean(character),
        extractedName,
        normalizedName,
        matchedDisplayName,
        matchedPresetId,
        matchSource,
        format
    };
}

/**
 * 扫描一段文本里所有 $...$ 片段，逐个做名字匹配检测。
 * 如果输入里没有 $...$，则把整段作为一个片段处理。
 * @param {string} input
 * @returns {{segment: string, result: ReturnType<typeof inspectCharacterPromptTrigger>}[]}
 */
export function inspectCharacterPromptTriggers(input) {
    if (!input || typeof input !== 'string') {
        return [];
    }

    const segments = [];
    const regex = /\$([^$]+)\$/g;
    let match;
    while ((match = regex.exec(input)) !== null) {
        segments.push(match[1].trim());
    }

    if (segments.length === 0) {
        segments.push(input.trim());
    }

    return segments
        .filter(seg => seg.length > 0)
        .map(seg => ({
            segment: seg,
            result: inspectCharacterPromptTrigger(seg)
        }));
}

/**
 * 查找最佳匹配的服装预设
 * 使用优先级顺序搜索：启用服装 → 所有服装
 * 
 * @param {string} inputName - 标准化后的输入名称
 * @param {Object} outfitPresets - 所有服装预设对象映射
 * @param {string[]} enabledOutfits - 启用的服装ID数组（优先级1）
 * @param {string[]} allOutfitIds - 所有服装ID数组（优先级2，兜底）
 * @returns {Object|null} - 最佳匹配的服装预设，如果没有匹配则返回null
 * 
 * @example
 * const match = findBestOutfitMatch("school uniform", outfitPresets, enabledOutfits, allOutfitIds);
 * if (match) {
 *   console.log("Matched outfit:", match.nameEN);
 * }
 */
function findBestOutfitMatch(inputName, outfitPresets, enabledOutfits, allOutfitIds) {
    // 处理空值或无效输入
    if (!inputName || typeof inputName !== 'string') {
        return null;
    }

    // 优先级1：搜索启用的服装
    let candidates = collectOutfitCandidates(inputName, outfitPresets, enabledOutfits);
    if (candidates.length > 0) {
        // 找到分数最高的候选项
        const bestMatch = candidates.reduce((best, current) =>
            current.score > best.score ? current : best
        );
        console.log('[CharacterPrompt] Best outfit match from enabled outfits:',
            bestMatch.matchedName, 'with score:', bestMatch.score);
        return bestMatch.preset;
    }

    // 优先级2：搜索所有服装（兜底）
    candidates = collectOutfitCandidates(inputName, outfitPresets, allOutfitIds);
    if (candidates.length > 0) {
        const bestMatch = candidates.reduce((best, current) =>
            current.score > best.score ? current : best
        );
        console.log('[CharacterPrompt] Best outfit match from all presets (fallback):',
            bestMatch.matchedName, 'with score:', bestMatch.score);
        return bestMatch.preset;
    }

    // 没有找到任何匹配
    return null;
}

/**
 * 处理prompt字符串，替换角色和服装标记
 * @param {string} prompt - 原始prompt字符串
 * @returns {string} - 处理后的prompt字符串
 */
export function processCharacterPrompt(prompt) {
    if (!prompt || typeof prompt !== 'string') {
        return prompt;
    }

    // 初始化全局负面提示词存储
    window.collectedCharacterNegatives = '';

    // 检测是否为分角色模式
    if (prompt.includes('Scene Composition')) {
        console.log('[CharacterPrompt] 检测到分角色模式');
        return processMultiCharacterPrompt(prompt);
    }

    // 非分角色模式：继续使用现有逻辑
    console.log('[CharacterPrompt] 使用非分角色模式');

    const defaultCharacterSettings = extension_settings[extensionName];
    console.log('[CharacterPrompt] Processing prompt:', prompt);

    // 获取配置数据
    const characterPresets = defaultCharacterSettings.characterPresets || {};

    const outfitPresets = defaultCharacterSettings.outfitPresets || {};
    const characterEnablePresetId = defaultCharacterSettings.characterEnablePresetId;
    const characterCommonPresetId = defaultCharacterSettings.characterCommonPresetId;
    const outfitEnablePresetId = defaultCharacterSettings.outfitEnablePresetId;

    // 获取启用的角色和通用角色列表
    const enabledCharacters = characterEnablePresetId && defaultCharacterSettings.characterEnablePresets?.[characterEnablePresetId]?.characters || [];
    const commonCharacters = characterCommonPresetId && defaultCharacterSettings.characterCommonPresets?.[characterCommonPresetId]?.characters || [];

    // 获取启用的服装列表
    const enabledOutfits = outfitEnablePresetId && defaultCharacterSettings.outfitEnablePresets?.[outfitEnablePresetId]?.outfits || [];

    // 收集启用角色中的服装列表
    const characterOutfits = enabledCharacters.flatMap(charId => characterPresets[charId]?.outfits || []);

    // 合并所有可用的服装预设ID
    const allAvailableOutfits = [...new Set([...enabledOutfits, ...characterOutfits])];

    // 构建服装名称到预设的映射表（同时支持中英文）
    const outfitNameMap = new Map();
    for (const outfitId of allAvailableOutfits) {
        const outfit = outfitPresets[outfitId];
        if (outfit) {
            // 添加英文名称
            if (outfit.nameEN) {
                const names = outfit.nameEN.split('|');
                for (const name of names) {
                    const trimmedName = name.trim();
                    if (trimmedName) {
                        outfitNameMap.set(trimmedName, outfit);
                    }
                }
            }
            // 添加中文名称
            if (outfit.nameCN) {
                const names = outfit.nameCN.split('|');
                for (const name of names) {
                    const trimmedName = name.trim();
                    if (trimmedName) {
                        outfitNameMap.set(trimmedName, outfit);
                    }
                }
            }
        }
    }

    // 用于在同一次处理中共享镜头角度信息
    let sharedCameraAngle = null;
    let sharedIsFromBehind = false;

    // ========== JSON 格式解析函数 ==========
    const parseJsonFormat = (content) => {
        // 尝试解析 JSON 格式: {"name":"xiao hong", "angle":"from front", "upperBody":"nsfw", "lowerBody":"nsfw"}
        try {
            if (content.startsWith('{') && content.endsWith('}')) {
                const parsed = JSON.parse(content);
                if (parsed.name) {
                    return {
                        isJson: true,
                        hasAngle: 'angle' in parsed,  // 用于区分角色(有angle)和服装(无angle)
                        name: parsed.name,
                        angle: parsed.angle || '',
                        upperBody: parsed.upperBody || 'hidden',  // hidden 表示不处理
                        lowerBody: parsed.lowerBody || 'hidden'   // hidden 表示不处理
                    };
                }
            }
        } catch (e) {
            // 不是 JSON 格式，继续使用旧格式解析
        }
        return { isJson: false };
    };

    const processedPrompt = prompt.replace(/\$([^$]+)\$/g, (match, content) => {
        const trimmedContent = content.trim();

        // ========== 尝试解析 JSON 格式 ==========
        const jsonData = parseJsonFormat(trimmedContent);
        if (jsonData.isJson) {
            const normalizedCharacterName = normalizeName(jsonData.name);
            const cameraAngle = jsonData.angle;
            const isFromBehind = cameraAngle.toLowerCase().includes('from behind');

            // 共享镜头信息
            sharedCameraAngle = cameraAngle;
            sharedIsFromBehind = isFromBehind;

            // 判断上半身和下半身状态
            const upperState = jsonData.upperBody.toLowerCase();
            const lowerState = jsonData.lowerBody.toLowerCase();

            // 通过 hasAngle 区分角色和服装：
            // - 角色有 angle 字段
            // - 服装没有 angle 字段
            if (jsonData.hasAngle) {
                // ========== JSON 角色标记处理 ==========
                // 使用新的最佳匹配函数替代内联匹配逻辑
                const character = findBestCharacterMatch(
                    normalizedCharacterName,
                    characterPresets,
                    enabledCharacters,
                    commonCharacters
                );

                if (character) {
                    let replacement = '';

                    // 角色特征（100%开启，始终添加）
                    if (character.characterTraits) {
                        replacement = character.characterTraits;
                    }

                    // 处理上半身 (非 hidden 时处理)
                    if (upperState !== 'hidden') {
                        // 先添加面部特征
                        const facialField = isFromBehind ? (character.facialFeaturesBack || '') : (character.facialFeatures || '');
                        if (facialField) replacement += (replacement ? ', ' : '') + facialField;

                        if (upperState === 'sfw') {
                            const field = isFromBehind ? character.upperBodySFWBack : character.upperBodySFW;
                            if (field) replacement += (replacement ? ', ' : '') + field;
                        } else if (upperState === 'nsfw') {
                            const field = isFromBehind ? character.upperBodyNSFWBack : character.upperBodyNSFW;
                            if (field) replacement += (replacement ? ', ' : '') + field;
                        }
                    }

                    // 处理下半身 (非 hidden 时处理)
                    if (lowerState !== 'hidden') {
                        if (lowerState === 'sfw') {
                            const field = isFromBehind ? character.fullBodySFWBack : character.fullBodySFW;
                            if (field) replacement += (replacement ? ', ' : '') + field;
                        } else if (lowerState === 'nsfw') {
                            const field = isFromBehind ? character.fullBodyNSFWBack : character.fullBodyNSFW;
                            if (field) replacement += (replacement ? ', ' : '') + field;
                        }
                    }

                    // 收集负面提示词
                    if (character.negative) {
                        collectNegativeToGlobal(character.negative);
                    }

                    console.log('[CharacterPrompt] JSON Character replacement result:', replacement);
                    return replacement;
                }
                return match; // 未找到角色则返回原始标记
            } else {
                // ========== JSON 服装标记处理 ==========
                const normalizedOutfitName = normalizeName(jsonData.name);

                // 使用新的最佳匹配函数替代内联匹配逻辑
                const allOutfitIds = Object.keys(outfitPresets);
                const outfit = findBestOutfitMatch(
                    normalizedOutfitName,
                    outfitPresets,
                    allAvailableOutfits,
                    allOutfitIds
                );

                if (outfit) {
                    let replacement = '';

                    // 处理上半身 (visible 时处理)
                    if (upperState === 'visible') {
                        const field = sharedIsFromBehind ? outfit.upperBodyBack : outfit.upperBody;
                        if (field) replacement = field;
                    }

                    // 处理下半身 (visible 时处理)
                    if (lowerState === 'visible') {
                        const field = sharedIsFromBehind ? outfit.fullBodyBack : outfit.fullBody;
                        if (field) replacement += (replacement ? ', ' : '') + field;
                    }

                    console.log('[CharacterPrompt] JSON Outfit replacement result:', replacement);
                    return replacement;
                }
                return match; // 未找到服装则返回原始标记
            }
        }

        // ========== 旧格式：角色标记处理 ==========
        const characterFormats = [
            { pattern: '-sfw-upperbody-sfw-lowerbody', upper: 'sfw', lower: 'sfw' },
            { pattern: '-sfw-upperbody-nsfw-lowerbody', upper: 'sfw', lower: 'nsfw' },
            { pattern: '-nsfw-upperbody-sfw-lowerbody', upper: 'nsfw', lower: 'sfw' },
            { pattern: '-nsfw-upperbody-nsfw-lowerbody', upper: 'nsfw', lower: 'nsfw' },
            { pattern: '-sfw-upperbody-sfw-fullbody', upper: 'sfw', lower: 'sfw' },
            { pattern: '-sfw-upperbody-nsfw-fullbody', upper: 'sfw', lower: 'nsfw' },
            { pattern: '-nsfw-upperbody-sfw-fullbody', upper: 'nsfw', lower: 'sfw' },
            { pattern: '-nsfw-upperbody-nsfw-fullbody', upper: 'nsfw', lower: 'nsfw' },
            { pattern: '-sfw-upperbody', upper: 'sfw', lower: null },
            { pattern: '-nsfw-upperbody', upper: 'nsfw', lower: null },
            { pattern: '-sfw-lowerbody', upper: null, lower: 'sfw' },
            { pattern: '-nsfw-lowerbody', upper: null, lower: 'nsfw' }
        ];

        for (const format of characterFormats) {
            if (trimmedContent.toLowerCase().endsWith(format.pattern)) {
                const nameAndAngle = trimmedContent.slice(0, -format.pattern.length).trim();
                const normalizedCharacterName = normalizeName(nameAndAngle);
                const cameraAngle = nameAndAngle;
                const isFromBehind = cameraAngle.toLowerCase().includes('from behind');



                // 共享镜头信息
                sharedCameraAngle = cameraAngle;
                sharedIsFromBehind = isFromBehind;

                // 使用新的最佳匹配函数替代内联匹配逻辑
                const character = findBestCharacterMatch(
                    normalizedCharacterName,
                    characterPresets,
                    enabledCharacters,
                    commonCharacters
                );

                if (character) {
                    let replacement = '';

                    // 角色特征（100%开启，始终添加）
                    if (character.characterTraits) {
                        replacement = character.characterTraits;
                    }

                    if (format.upper) {
                        const facialField = isFromBehind ? (character.facialFeaturesBack || '') : (character.facialFeatures || '');
                        if (facialField) replacement += (replacement ? ', ' : '') + facialField;
                    }
                    if (format.upper === 'sfw') {
                        const field = isFromBehind ? character.upperBodySFWBack : character.upperBodySFW;
                        if (field) replacement += (replacement ? ', ' : '') + field;
                    } else if (format.upper === 'nsfw') {
                        const field = isFromBehind ? character.upperBodyNSFWBack : character.upperBodyNSFW;
                        if (field) replacement += (replacement ? ', ' : '') + field;
                    }
                    if (format.lower === 'sfw') {
                        const field = isFromBehind ? character.fullBodySFWBack : character.fullBodySFW;
                        if (field) replacement += (replacement ? ', ' : '') + field;
                    } else if (format.lower === 'nsfw') {
                        const field = isFromBehind ? character.fullBodyNSFWBack : character.fullBodyNSFW;
                        if (field) replacement += (replacement ? ', ' : '') + field;
                    }

                    // 收集负面提示词
                    if (character.negative) {
                        collectNegativeToGlobal(character.negative);
                    }

                    console.log('[CharacterPrompt] Character replacement result:', replacement);
                    return replacement;
                }
                return match; // 未找到角色则返回原始标记
            }
        }

        // ========== 服装标记处理 ==========
        const outfitFormats = [
            { pattern: '-upperbody-lowerbody', hasUpper: true, hasLower: true },
            { pattern: '-upperbody', hasUpper: true, hasLower: false },
            { pattern: '-lowerbody', hasUpper: false, hasLower: true }
        ];

        for (const format of outfitFormats) {
            if (trimmedContent.toLowerCase().endsWith(format.pattern)) {
                const rawOutfitName = trimmedContent.slice(0, -format.pattern.length).trim();
                const normalizedOutfitName = normalizeName(rawOutfitName);

                // 使用新的最佳匹配函数替代内联匹配逻辑
                const allOutfitIds = Object.keys(outfitPresets);
                const outfit = findBestOutfitMatch(
                    normalizedOutfitName,
                    outfitPresets,
                    allAvailableOutfits,
                    allOutfitIds
                );

                if (outfit) {
                    let replacement = '';
                    if (format.hasUpper) {
                        const field = sharedIsFromBehind ? outfit.upperBodyBack : outfit.upperBody;
                        if (field) replacement = field;
                    }
                    if (format.hasLower) {
                        const field = sharedIsFromBehind ? outfit.fullBodyBack : outfit.fullBody;
                        if (field) replacement += (replacement ? ', ' : '') + field;
                    }
                    console.log('[CharacterPrompt] Outfit replacement result:', replacement);
                    return replacement;
                }
                return match; // 未找到服装则返回原始标记
            }
        }

        // 如果不匹配任何已知格式，返回原始标记
        return match;
    });

    // 清理多余的逗号和空格
    return processedPrompt.replace(/, \s*,/g, ',').replace(/,+/g, ',').replace(/^, |, $/g, '').trim();
}

/**
 * 批量处理多个prompt
 * @param {string[]} prompts - prompt数组
 * @returns {string[]} - 处理后的prompt数组
 */
export function processCharacterPrompts(prompts) {
    if (!Array.isArray(prompts)) {
        return prompts;
    }

    return prompts.map(prompt => processCharacterPrompt(prompt));
}

// ========== 辅助函数：负面提示词处理 ==========

/**
 * 将负面提示词添加到全局变量
 * @param {string} negative - 负面提示词
 */
function collectNegativeToGlobal(negative) {
    if (!negative || typeof negative !== 'string') {
        return;
    }

    const trimmed = negative.trim();
    if (!trimmed) {
        return;
    }

    if (window.collectedCharacterNegatives) {
        window.collectedCharacterNegatives += ', ' + trimmed;
    } else {
        window.collectedCharacterNegatives = trimmed;
    }

    console.log('[CharacterPrompt] 收集负面提示词到全局:', trimmed);
}

/**
 * 处理分角色模式的 prompt
 * @param {string} prompt - 包含 "Scene Composition" 的 prompt 字符串
 * @returns {string} - 处理后的 prompt 字符串
 */
function processMultiCharacterPrompt(prompt) {
    try {
        // 解析 prompt
        const prompt_data = parsePromptStringWithCoordinates(prompt);
        console.log('[CharacterPrompt] 解析后的 prompt_data:', prompt_data);

        // 获取配置数据
        const defaultCharacterSettings = extension_settings[extensionName];
        const characterPresets = defaultCharacterSettings.characterPresets || {};
        const outfitPresets = defaultCharacterSettings.outfitPresets || {};
        const characterEnablePresetId = defaultCharacterSettings.characterEnablePresetId;
        const characterCommonPresetId = defaultCharacterSettings.characterCommonPresetId;
        const outfitEnablePresetId = defaultCharacterSettings.outfitEnablePresetId;

        const enabledCharacters = characterEnablePresetId && defaultCharacterSettings.characterEnablePresets?.[characterEnablePresetId]?.characters || [];
        const commonCharacters = characterCommonPresetId && defaultCharacterSettings.characterCommonPresets?.[characterCommonPresetId]?.characters || [];
        const enabledOutfits = outfitEnablePresetId && defaultCharacterSettings.outfitEnablePresets?.[outfitEnablePresetId]?.outfits || [];

        const characterOutfits = enabledCharacters.flatMap(charId => characterPresets[charId]?.outfits || []);
        const allAvailableOutfits = [...new Set([...enabledOutfits, ...characterOutfits])];

        // 遍历角色 1-4
        for (let i = 1; i <= 4; i++) {
            const promptKey = `Character ${i} Prompt`;
            const ucKey = `Character ${i} UC`;

            if (prompt_data[promptKey]) {
                console.log(`[CharacterPrompt] 处理 ${promptKey}:`, prompt_data[promptKey]);

                // 收集该角色的负面提示词
                const negatives = [];

                // 用于共享镜头角度信息
                let sharedIsFromBehind = false;

                // 替换角色变量，同时收集负面
                const replacedPrompt = prompt_data[promptKey].replace(/\$([^$]+)\$/g, (match, content) => {
                    const trimmedContent = content.trim();

                    // 解析 JSON 格式
                    const parseJsonFormat = (content) => {
                        try {
                            if (content.startsWith('{') && content.endsWith('}')) {
                                const parsed = JSON.parse(content);
                                if (parsed.name) {
                                    return {
                                        isJson: true,
                                        hasAngle: 'angle' in parsed,
                                        name: parsed.name,
                                        angle: parsed.angle || '',
                                        upperBody: parsed.upperBody || 'hidden',
                                        lowerBody: parsed.lowerBody || 'hidden'
                                    };
                                }
                            }
                        } catch (e) {
                            // 不是 JSON 格式
                        }
                        return { isJson: false };
                    };

                    const jsonData = parseJsonFormat(trimmedContent);

                    if (jsonData.isJson && jsonData.hasAngle) {
                        // JSON 角色处理
                        const normalizedCharacterName = normalizeName(jsonData.name);
                        const isFromBehind = jsonData.angle.toLowerCase().includes('from behind');
                        sharedIsFromBehind = isFromBehind;

                        const character = findBestCharacterMatch(
                            normalizedCharacterName,
                            characterPresets,
                            enabledCharacters,
                            commonCharacters
                        );

                        if (character) {
                            // 收集负面提示词
                            if (character.negative) {
                                negatives.push(character.negative.trim());
                                console.log(`[CharacterPrompt] 收集负面提示词:`, character.negative.trim());
                            }

                            // 生成替换内容（与原逻辑相同）
                            let replacement = '';
                            if (character.characterTraits) {
                                replacement = character.characterTraits;
                            }

                            const upperState = jsonData.upperBody.toLowerCase();
                            const lowerState = jsonData.lowerBody.toLowerCase();

                            if (upperState !== 'hidden') {
                                const facialField = isFromBehind ? (character.facialFeaturesBack || '') : (character.facialFeatures || '');
                                if (facialField) replacement += (replacement ? ', ' : '') + facialField;

                                if (upperState === 'sfw') {
                                    const field = isFromBehind ? character.upperBodySFWBack : character.upperBodySFW;
                                    if (field) replacement += (replacement ? ', ' : '') + field;
                                } else if (upperState === 'nsfw') {
                                    const field = isFromBehind ? character.upperBodyNSFWBack : character.upperBodyNSFW;
                                    if (field) replacement += (replacement ? ', ' : '') + field;
                                }
                            }

                            if (lowerState !== 'hidden') {
                                if (lowerState === 'sfw') {
                                    const field = isFromBehind ? character.fullBodySFWBack : character.fullBodySFW;
                                    if (field) replacement += (replacement ? ', ' : '') + field;
                                } else if (lowerState === 'nsfw') {
                                    const field = isFromBehind ? character.fullBodyNSFWBack : character.fullBodyNSFW;
                                    if (field) replacement += (replacement ? ', ' : '') + field;
                                }
                            }

                            return replacement;
                        }
                    } else if (jsonData.isJson && !jsonData.hasAngle) {
                        // ========== JSON 服装标记处理 ==========
                        const normalizedOutfitName = normalizeName(jsonData.name);
                        const allOutfitIds = Object.keys(outfitPresets);

                        const outfit = findBestOutfitMatch(
                            normalizedOutfitName,
                            outfitPresets,
                            allAvailableOutfits,
                            allOutfitIds
                        );

                        if (outfit) {
                            let replacement = '';
                            const upperState = jsonData.upperBody.toLowerCase();
                            const lowerState = jsonData.lowerBody.toLowerCase();

                            // 处理上半身 (visible 时处理)
                            if (upperState === 'visible') {
                                const field = sharedIsFromBehind ? outfit.upperBodyBack : outfit.upperBody;
                                if (field) replacement = field;
                            }

                            // 处理下半身 (visible 时处理)
                            if (lowerState === 'visible') {
                                const field = sharedIsFromBehind ? outfit.fullBodyBack : outfit.fullBody;
                                if (field) replacement += (replacement ? ', ' : '') + field;
                            }

                            console.log('[CharacterPrompt] JSON Outfit replacement result (multi-char mode):', replacement);
                            return replacement;
                        }
                        return match; // 未找到服装则返回原始标记
                    } else {
                        // 旧格式角色处理
                        const characterFormats = [
                            { pattern: '-sfw-upperbody-sfw-lowerbody', upper: 'sfw', lower: 'sfw' },
                            { pattern: '-sfw-upperbody-nsfw-lowerbody', upper: 'sfw', lower: 'nsfw' },
                            { pattern: '-nsfw-upperbody-sfw-lowerbody', upper: 'nsfw', lower: 'sfw' },
                            { pattern: '-nsfw-upperbody-nsfw-lowerbody', upper: 'nsfw', lower: 'nsfw' },
                            { pattern: '-sfw-upperbody-sfw-fullbody', upper: 'sfw', lower: 'sfw' },
                            { pattern: '-sfw-upperbody-nsfw-fullbody', upper: 'sfw', lower: 'nsfw' },
                            { pattern: '-nsfw-upperbody-sfw-fullbody', upper: 'nsfw', lower: 'sfw' },
                            { pattern: '-nsfw-upperbody-nsfw-fullbody', upper: 'nsfw', lower: 'nsfw' },
                            { pattern: '-sfw-upperbody', upper: 'sfw', lower: null },
                            { pattern: '-nsfw-upperbody', upper: 'nsfw', lower: null },
                            { pattern: '-sfw-lowerbody', upper: null, lower: 'sfw' },
                            { pattern: '-nsfw-lowerbody', upper: null, lower: 'nsfw' }
                        ];

                        for (const format of characterFormats) {
                            if (trimmedContent.toLowerCase().endsWith(format.pattern)) {
                                const nameAndAngle = trimmedContent.slice(0, -format.pattern.length).trim();
                                const normalizedCharacterName = normalizeName(nameAndAngle);
                                const isFromBehind = nameAndAngle.toLowerCase().includes('from behind');
                                sharedIsFromBehind = isFromBehind;

                                const character = findBestCharacterMatch(
                                    normalizedCharacterName,
                                    characterPresets,
                                    enabledCharacters,
                                    commonCharacters
                                );

                                if (character) {
                                    // 收集负面提示词
                                    if (character.negative) {
                                        negatives.push(character.negative.trim());
                                        console.log(`[CharacterPrompt] 收集负面提示词:`, character.negative.trim());
                                    }

                                    // 生成替换内容（与原逻辑相同）
                                    let replacement = '';
                                    if (character.characterTraits) {
                                        replacement = character.characterTraits;
                                    }

                                    if (format.upper) {
                                        const facialField = isFromBehind ? (character.facialFeaturesBack || '') : (character.facialFeatures || '');
                                        if (facialField) replacement += (replacement ? ', ' : '') + facialField;
                                    }
                                    if (format.upper === 'sfw') {
                                        const field = isFromBehind ? character.upperBodySFWBack : character.upperBodySFW;
                                        if (field) replacement += (replacement ? ', ' : '') + field;
                                    } else if (format.upper === 'nsfw') {
                                        const field = isFromBehind ? character.upperBodyNSFWBack : character.upperBodyNSFW;
                                        if (field) replacement += (replacement ? ', ' : '') + field;
                                    }
                                    if (format.lower === 'sfw') {
                                        const field = isFromBehind ? character.fullBodySFWBack : character.fullBodySFW;
                                        if (field) replacement += (replacement ? ', ' : '') + field;
                                    } else if (format.lower === 'nsfw') {
                                        const field = isFromBehind ? character.fullBodyNSFWBack : character.fullBodyNSFW;
                                        if (field) replacement += (replacement ? ', ' : '') + field;
                                    }

                                    return replacement;
                                }
                                return match;
                            }
                        }

                        // 服装处理（不收集负面）
                        const outfitFormats = [
                            { pattern: '-upperbody-lowerbody', hasUpper: true, hasLower: true },
                            { pattern: '-upperbody', hasUpper: true, hasLower: false },
                            { pattern: '-lowerbody', hasUpper: false, hasLower: true }
                        ];

                        for (const format of outfitFormats) {
                            if (trimmedContent.toLowerCase().endsWith(format.pattern)) {
                                const rawOutfitName = trimmedContent.slice(0, -format.pattern.length).trim();
                                const normalizedOutfitName = normalizeName(rawOutfitName);
                                const allOutfitIds = Object.keys(outfitPresets);

                                const outfit = findBestOutfitMatch(
                                    normalizedOutfitName,
                                    outfitPresets,
                                    allAvailableOutfits,
                                    allOutfitIds
                                );

                                if (outfit) {
                                    let replacement = '';
                                    if (format.hasUpper) {
                                        const field = sharedIsFromBehind ? outfit.upperBodyBack : outfit.upperBody;
                                        if (field) replacement = field;
                                    }
                                    if (format.hasLower) {
                                        const field = sharedIsFromBehind ? outfit.fullBodyBack : outfit.fullBody;
                                        if (field) replacement += (replacement ? ', ' : '') + field;
                                    }
                                    return replacement;
                                }
                                return match;
                            }
                        }
                    }

                    return match;
                });

                // 更新 prompt
                prompt_data[promptKey] = replacedPrompt;

                // 添加负面到 UC
                if (negatives.length > 0) {
                    const negativesStr = negatives.join(', ');
                    if (prompt_data[ucKey]) {
                        prompt_data[ucKey] += ', ' + negativesStr;
                    } else {
                        prompt_data[ucKey] = negativesStr;
                    }
                    console.log(`[CharacterPrompt] 添加负面到 ${ucKey}:`, negativesStr);
                }
            }
        }

        // 重新组合为字符串
        return reconstructPromptString(prompt_data);

    } catch (error) {
        console.error('[CharacterPrompt] 分角色模式处理失败:', error);
        // 降级到非分角色模式
        console.log('[CharacterPrompt] 降级到非分角色模式');
        return processCharacterPrompt(prompt.replace('Scene Composition', 'SceneComposition'));
    }
}

/**
 * 将 prompt_data 对象重新组合为字符串
 * @param {Object} prompt_data - parsePromptStringWithCoordinates 返回的对象
 * @returns {string} - 重组后的 prompt 字符串
 */
function reconstructPromptString(prompt_data) {
    if (!prompt_data || typeof prompt_data !== 'object') {
        console.error('[CharacterPrompt] prompt_data 无效');
        return '';
    }

    let result = '';

    // Scene Composition
    if (prompt_data['Scene Composition']) {
        result += `Scene Composition: ${prompt_data['Scene Composition']};`;
    }

    // Characters 1-4
    for (let i = 1; i <= 4; i++) {
        const promptKey = `Character ${i} Prompt`;
        const ucKey = `Character ${i} UC`;
        const centersKey = `Character ${i} centers`;

        if (prompt_data[promptKey]) {
            result += ` ${promptKey}: ${prompt_data[promptKey]}`;

            if (prompt_data[centersKey]) {
                result += `|centers:${prompt_data[centersKey]}`;
            }

            result += ';';
        }

        if (prompt_data[ucKey]) {
            result += ` ${ucKey}: ${prompt_data[ucKey]};`;
        }
    }

    const finalResult = result.trim();
    console.log('[CharacterPrompt] 重组后的 prompt:', finalResult);
    return finalResult;
}
