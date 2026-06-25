// @ts-nocheck
import { saveSettingsDebounced, eventSource, event_types, saveChatConditional, chat, messageFormatting } from "../../../../../script.js";
import { EventType, extensionName } from './config.js';
import { generateUniqueId, addLog, addSmoothShakeEffect } from './utils.js';
import { extension_settings } from "../../../../extensions.js";
import { checkSendBuClass } from './utils.js';
import { getContext } from "../../../../st-context.js";
import { stylishConfirm } from './ui_common.js';
import { refreshCharacterSettings } from './settings/character/index.js';

/**
 * Initializes the newline fixer functionality.
 * It listens for new messages and corrects malformed newlines before rendering.
 * @param {Function} renderFunction - The function to call to re-render the message in the UI.
 */
export function initializeNewlineFixer() {
    eventSource.on(event_types.MESSAGE_RECEIVED, async function (id) {
        // Only run if the setting is explicitly enabled.
        if (String(extension_settings[extensionName].newlineFixEnabled) !== 'true') {
            return;
        }

        // Ensure the message and its content exist.
        if (!chat[id] || typeof chat[id].mes !== 'string') {
            return;
        }

        const originalMessage = chat[id].mes;
        let newMessage = originalMessage.replaceAll("\n###", "###");
        newMessage = newMessage.replace(/<image>\n*###\n*/g, "<image>image###");

        // 如果存在错误的中文符号进行修复 (基于 startTag 和 endTag)
        const settings = extension_settings[extensionName];
        const startTag = settings?.startTag || 'image###';
        const endTag = settings?.endTag || '###';

        // 为了在正则中使用，转义标签
        const escapeRegExp = (string) => string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const tagBlockRegex = new RegExp(`${escapeRegExp(startTag)}([\\s\\S]*?)${escapeRegExp(endTag)}`, 'g');

        newMessage = newMessage.replace(tagBlockRegex, (match, innerContent) => {
            // 将内部的中文标点替换为英文标点
            const sanitizedContent = innerContent
                .replace(/，/g, ',')
                .replace(/；/g, ';')
                .replace(/：/g, ':');
            return `${startTag}${sanitizedContent}${endTag}`;
        });

        // If a change was made, save it and re-render the message.
        if (originalMessage !== newMessage) {
            console.log(`ChatU8: Fixed newlines & symbols for message ID: ${id}`);
            chat[id].mes = newMessage;
            await saveChatConditional();
            render(id);
        }
    });

    // 监听消息以捕获人物和服装信息
    eventSource.on(event_types.MESSAGE_RECEIVED, async function (id) {
        // Ensure the message and its content exist.
        console.log(`ChatU8: Extracting character and outfit tags for message ID: ${id}`);
        if (!chat[id] || typeof chat[id].mes !== 'string') {
            return;
        }



        const originalMessage = chat[id].mes;

        // 提取人物和服装标签
        const extracted = extractCharacterAndOutfitTags(originalMessage);

        if (extracted.characters.length === 0 && extracted.outfits.length === 0) {
            return; // 没有检测到标签,静默跳过
        }

        // 显示检测到的内容并询问是否录入
        await handleExtractedData(extracted);
    });

    // 监听消息以捕获人物和服装信息
    eventSource.on(event_types.MESSAGE_EDITED, async function (id) {
        // Ensure the message and its content exist.
        console.log(`ChatU8: Extracting character and outfit tags for message ID: ${id}`);
        if (!chat[id] || typeof chat[id].mes !== 'string') {
            return;
        }

        const originalMessage = chat[id].mes;

        // 提取人物和服装标签
        const extracted = extractCharacterAndOutfitTags(originalMessage);

        if (extracted.characters.length === 0 && extracted.outfits.length === 0) {
            return; // 没有检测到标签,静默跳过
        }

        // 显示检测到的内容并询问是否录入
        await handleExtractedData(extracted);
    });
}
function highlight_code(element) {
    const $node = $(element);
    if ($node.hasClass('hljs') || $node.text().includes('<body')) {
        return;
    }

    hljs.highlightElement(element);
    $node.append(
        $(`<i class="fa-solid fa-copy code-copy interactable" title="Copy code"></i>`)
            .on('click', function (e) {
                e.stopPropagation();
            })
            .on('pointerup', async function () {
                navigator.clipboard.writeText($(element).text());
                toastr.info(`已复制!`, '', { timeOut: 2000 });
            }),
    );
}

const render = async (message_id) => {


    console.log("rendering message:", message_id);
    const mes_html = document.querySelector(`div.mes[mesid="${message_id}"]`);
    if (!mes_html) {
        return;
    }

    const chat_message = chat[message_id];
    if (chat_message.swipes) {
        const swipesCounter = mes_html.querySelector('.swipes-counter');
        if (swipesCounter) {
            swipesCounter.textContent = `${chat_message.swipe_id + 1}\u200b/\u200b${chat_message.swipes.length}`;
        }
    }

    const mesText = mes_html.querySelector('.mes_text');
    if (mesText) {
        mesText.innerHTML = messageFormatting(
            chat_message.mes,
            chat_message.name,
            chat_message.is_system,
            chat_message.is_user,
            message_id,
        );
    }

    mes_html.querySelectorAll('pre code').forEach(element => {
        highlight_code(element);
    });

    await eventSource.emit(
        chat_message.is_user ? event_types.USER_MESSAGE_RENDERED : event_types.CHARACTER_MESSAGE_RENDERED,
        message_id,
    );
};

// ========== 人物和服装信息提取功能 ==========

/**
 * 提取消息中的人物和服装标签
 * 按位置顺序匹配：服装会自动关联到前面最近的人物
 */
export function extractCharacterAndOutfitTags(message) {
    const items = []; // 按位置顺序存储所有项目

    // 使用联合正则一次性提取所有标签，保留位置信息
    const combinedRegex = /<(人物|服装)>([\s\S]*?)<\/\1>/g;
    let match;
    while ((match = combinedRegex.exec(message)) !== null) {
        const type = match[1]; // "人物" 或 "服装"
        const content = preprocessTagContent(match[2]);
        const position = match.index;

        if (type === '人物') {
            const parsed = parseCharacterData(content);
            if (parsed) {
                items.push({ type: 'character', data: parsed, position, matchedOutfits: [] });
            }
        } else if (type === '服装') {
            const parsed = parseOutfitData(content);
            if (parsed) {
                items.push({ type: 'outfit', data: parsed, position });
            }
        }
    }

    // 按位置排序
    items.sort((a, b) => a.position - b.position);

    // 将服装分配给前面最近的人物
    let currentCharacter = null;
    const characters = [];
    const orphanOutfits = []; // 没有对应人物的服装（出现在第一个人物之前）

    for (const item of items) {
        if (item.type === 'character') {
            currentCharacter = item;
            characters.push(item);
        } else if (item.type === 'outfit') {
            if (currentCharacter) {
                currentCharacter.matchedOutfits.push(item.data);
            } else {
                orphanOutfits.push(item.data);
            }
        }
    }

    // 返回结果：角色包含 matchedOutfits 数组，orphanOutfits 是没有对应人物的服装
    return {
        characters: characters.map(c => ({ ...c.data, matchedOutfits: c.matchedOutfits })),
        outfits: orphanOutfits
    };
}

/**
 * 预处理标签内容
 * 1. 将中文冒号替换为英文冒号
 * 2. 将中文逗号替换为英文逗号
 * 3. 修正常见的字段名拼写错误
 */
function preprocessTagContent(content) {
    let processed = content
        .replace(/：/g, ':')  // 中文冒号 -> 英文冒号
        .replace(/，/g, ','); // 中文逗号 -> 英文逗号

    // 修正常见的字段名拼写错误
    processed = processed.replace(/下半身NSWebcam:/g, '下半身NSFW背面:');
    processed = processed.replace(/下半身NSFW_背面:/g, '下半身NSFW背面:');
    processed = processed.replace(/上半身NSFW_背面:/g, '上半身NSFW背面:');

    return processed;
}

/**
 * 解析人物数据
 */
function parseCharacterData(content) {
    const lines = content.split('\n').map(line => line.trim()).filter(line => line);
    const data = {
        nameCN: '',
        nameEN: '',
        characterTraits: '',  // 角色特征
        facialFeatures: '',
        facialFeaturesBack: '',
        upperBodySFW: '',
        upperBodySFWBack: '',
        fullBodySFW: '',
        fullBodySFWBack: '',
        upperBodyNSFW: '',
        upperBodyNSFWBack: '',
        fullBodyNSFW: '',
        fullBodyNSFWBack: ''
    };

    const fieldMap = {
        '中文名称': 'nameCN',
        '英文名称': 'nameEN',
        '角色特征': 'characterTraits',
        '五官外貌': 'facialFeatures',
        '五官外貌背面': 'facialFeaturesBack',
        '上半身SFW': 'upperBodySFW',
        '上半身SFW背面': 'upperBodySFWBack',
        '下半身SFW': 'fullBodySFW',
        '下半身SFW背面': 'fullBodySFWBack',
        '上半身NSFW': 'upperBodyNSFW',
        '上半身NSFW背面': 'upperBodyNSFWBack',
        '下半身NSFW': 'fullBodyNSFW',
        '下半身NSFW背面': 'fullBodyNSFWBack'
    };

    for (const line of lines) {
        const colonIndex = line.indexOf(':');
        if (colonIndex === -1) continue;

        const key = line.substring(0, colonIndex).trim();
        const value = line.substring(colonIndex + 1).trim();

        if (fieldMap[key]) {
            data[fieldMap[key]] = value;
        } else if (key && value) {
            // 记录未识别的字段以便调试
            console.log(`ChatU8: 未识别的人物字段 "${key}"`);
        }
    }

    // 必须有中文名称才算有效
    if (!data.nameCN) {
        return null;
    }

    // 输出调试信息
    console.log('ChatU8: 解析到的人物数据:', data);

    return data;
}

/**
 * 解析服装数据
 */
function parseOutfitData(content) {
    const lines = content.split('\n').map(line => line.trim()).filter(line => line);
    const data = {
        nameCN: '',
        nameEN: '',
        owner: '',  // 归属人（英文名称）
        upperBody: '',
        upperBodyBack: '',
        fullBody: '',
        fullBodyBack: ''
    };

    const fieldMap = {
        '归属人': 'owner',
        '中文名称': 'nameCN',
        '英文名称': 'nameEN',
        '上半身': 'upperBody',
        '上半身背面': 'upperBodyBack',
        '下半身': 'fullBody',
        '下半身背面': 'fullBodyBack'
    };

    for (const line of lines) {
        const colonIndex = line.indexOf(':');
        if (colonIndex === -1) continue;

        const key = line.substring(0, colonIndex).trim();
        const value = line.substring(colonIndex + 1).trim();

        if (fieldMap[key]) {
            data[fieldMap[key]] = value;
        } else if (key && value) {
            // 记录未识别的字段以便调试
            console.log(`ChatU8: 未识别的服装字段 "${key}"`);
        }
    }

    // 必须有中文名称才算有效
    if (!data.nameCN) {
        return null;
    }

    // 输出调试信息
    console.log('ChatU8: 解析到的服装数据:', data);

    return data;
}

/**
 * 处理提取的数据
 */
export async function handleExtractedData(extracted, metadata = {}) {
    const { characters, outfits } = extracted;
    const { generationContext = '', generationWorldBook = '', generationVariables = {} } = metadata;

    // 构建确认消息
    let message = '检测到以下内容:\n\n';

    if (characters.length > 0) {
        message += `人物 (${characters.length}个):\n`;
        characters.forEach(char => {
            message += `  • ${char.nameCN} (${char.nameEN || '无英文名'})\n`;
        });
        message += '\n';
    }

    if (outfits.length > 0) {
        message += `服装 (${outfits.length}套):\n`;
        outfits.forEach(outfit => {
            message += `  • ${outfit.nameCN} (${outfit.nameEN || '无英文名'})\n`;
        });
        message += '\n';
    }

    message += '是否录入这些数据?';

    const confirmed = await stylishConfirm(message);
    if (!confirmed) {
        return;
    }

    // 保存数据
    const settings = extension_settings[extensionName];
    const createdCharacters = [];
    const createdOutfits = [];

    // 获取当前角色卡名称作为前缀
    const stContext = getContext();
    const cardPrefix = stContext?.name2 ? `[${stContext.name2}]` : '';

    // 收集所有服装及其归属信息，用于后续处理跨角色归属
    const outfitOwnershipMap = {};  // 服装名称 -> 归属角色名称（英文）

    // 创建服装预设（孤立服装，没有对应人物的）
    for (const outfitData of outfits) {
        const presetName = cardPrefix ? `${cardPrefix}${outfitData.nameCN}` : outfitData.nameCN;

        // 检查是否已存在
        if (settings.outfitPresets[presetName]) {
            const overwrite = await stylishConfirm(`服装 "${presetName}" 已存在,是否覆盖?`);
            if (!overwrite) continue;
        }

        settings.outfitPresets[presetName] = {
            nameCN: outfitData.nameCN,
            nameEN: outfitData.nameEN,
            owner: outfitData.owner || '',
            upperBody: outfitData.upperBody,
            upperBodyBack: outfitData.upperBodyBack,
            fullBody: outfitData.fullBody,
            fullBodyBack: outfitData.fullBodyBack
        };

        console.log(`ChatU8: 已保存服装预设 "${presetName}":`, settings.outfitPresets[presetName]);

        createdOutfits.push(presetName);

        // 如果有归属人，加入归属处理
        if (outfitData.owner && outfitData.owner.trim()) {
            outfitOwnershipMap[presetName] = outfitData.owner.trim();
        }
    }

    // 创建角色预设（同时处理该角色匹配的服装）
    for (const charData of characters) {
        const presetName = cardPrefix ? `${cardPrefix}${charData.nameCN}` : charData.nameCN;

        // 检查是否已存在
        if (settings.characterPresets[presetName]) {
            const overwrite = await stylishConfirm(`角色 "${presetName}" 已存在,是否覆盖?`);
            if (!overwrite) continue;
        }

        // 先创建该角色匹配的服装预设
        const matchedOutfitNames = [];
        if (charData.matchedOutfits && charData.matchedOutfits.length > 0) {
            for (const outfitData of charData.matchedOutfits) {
                const outfitName = cardPrefix ? `${cardPrefix}${outfitData.nameCN}` : outfitData.nameCN;

                // 检查服装是否已存在
                if (settings.outfitPresets[outfitName]) {
                    const overwrite = await stylishConfirm(`服装 "${outfitName}" 已存在,是否覆盖?`);
                    if (!overwrite) continue;
                }

                settings.outfitPresets[outfitName] = {
                    nameCN: outfitData.nameCN,
                    nameEN: outfitData.nameEN,
                    owner: outfitData.owner || '',
                    upperBody: outfitData.upperBody,
                    upperBodyBack: outfitData.upperBodyBack,
                    fullBody: outfitData.fullBody,
                    fullBodyBack: outfitData.fullBodyBack
                };

                console.log(`ChatU8: 已保存服装预设 "${outfitName}" (关联到 ${presetName}):`, settings.outfitPresets[outfitName]);
                createdOutfits.push(outfitName);

                // 检查服装的归属人字段
                if (outfitData.owner && outfitData.owner.trim()) {
                    // 有指定归属人，记录下来后续处理
                    outfitOwnershipMap[outfitName] = outfitData.owner.trim();
                } else {
                    // 没有指定归属人，按位置归属到当前角色
                    matchedOutfitNames.push(outfitName);
                }
            }
        }

        settings.characterPresets[presetName] = {
            nameCN: charData.nameCN,
            nameEN: charData.nameEN,
            characterTraits: charData.characterTraits,  // 角色特征
            facialFeatures: charData.facialFeatures,
            facialFeaturesBack: charData.facialFeaturesBack,
            upperBodySFW: charData.upperBodySFW,
            upperBodySFWBack: charData.upperBodySFWBack,
            fullBodySFW: charData.fullBodySFW,
            fullBodySFWBack: charData.fullBodySFWBack,
            upperBodyNSFW: charData.upperBodyNSFW,
            upperBodyNSFWBack: charData.upperBodyNSFWBack,
            fullBodyNSFW: charData.fullBodyNSFW,
            fullBodyNSFWBack: charData.fullBodyNSFWBack,
            outfits: matchedOutfitNames,  // 只关联没有指定归属人或归属当前角色的服装
            generationContext: generationContext,      // 存储生成时的上下文
            generationWorldBook: generationWorldBook,  // 存储生成时的世界书触发
            generationVariables: generationVariables   // 存储生成时使用的 getvar 变量
        };

        console.log(`ChatU8: 已保存角色预设 "${presetName}" (关联服装: ${matchedOutfitNames.join(', ')}):`, settings.characterPresets[presetName]);

        createdCharacters.push(presetName);
    }

    // 标准化名称：转小写并去除所有空格
    const normalizeOwnerName = (name) => {
        if (!name) return '';
        return name.toLowerCase().replace(/\s+/g, '');
    };

    // 处理服装归属：根据 owner 字段将服装归属到对应的角色（支持多个同名角色）
    for (const [outfitName, ownerNameEN] of Object.entries(outfitOwnershipMap)) {
        const normalizedOwner = normalizeOwnerName(ownerNameEN);
        let matchCount = 0;

        // 收集所有匹配的角色预设名称（包括刚创建的和已有的）
        const matchedPresetNames = new Set();

        // 在刚创建的角色中查找（使用带前缀的预设名称）
        for (const charData of characters) {
            if (charData.nameEN && normalizeOwnerName(charData.nameEN) === normalizedOwner) {
                const presetName = cardPrefix ? `${cardPrefix}${charData.nameCN}` : charData.nameCN;
                matchedPresetNames.add(presetName);
            }
        }

        // 在所有已有的角色预设中查找
        for (const [presetName, preset] of Object.entries(settings.characterPresets)) {
            if (preset.nameEN && normalizeOwnerName(preset.nameEN) === normalizedOwner) {
                matchedPresetNames.add(presetName);
            }
        }

        // 将服装绑定到所有匹配的角色
        for (const targetName of matchedPresetNames) {
            const targetPreset = settings.characterPresets[targetName];
            if (targetPreset) {
                if (!targetPreset.outfits) {
                    targetPreset.outfits = [];
                }
                if (!targetPreset.outfits.includes(outfitName)) {
                    targetPreset.outfits.push(outfitName);
                    matchCount++;
                    console.log(`ChatU8: 服装 "${outfitName}" 已归属到角色 "${targetName}" (via owner: ${ownerNameEN})`);
                }
            }
        }

        if (matchCount === 0) {
            console.warn(`ChatU8: 无法找到归属人 "${ownerNameEN}" 对应的角色,服装 "${outfitName}" 未归属`);
        } else if (matchCount > 1) {
            console.log(`ChatU8: 服装 "${outfitName}" 已归属到 ${matchCount} 个同名角色`);
        }
    }

    // 刷新角色设置UI
    const characterTab = $('#st-chatu8-tab-character');
    if (characterTab.length) {
        refreshCharacterSettings(characterTab);
    }

    // 服装已在创建角色时按位置顺序自动关联，保存设置
    if (createdOutfits.length > 0) {
        saveSettingsDebounced();
    }

    // 询问是否启用角色
    if (createdCharacters.length > 0) {
        const enable = await stylishConfirm(
            `是否在当前角色启用列表中启用这 ${createdCharacters.length} 个角色?`
        );

        if (enable) {
            const currentPresetId = settings.characterEnablePresetId;
            if (currentPresetId && settings.characterEnablePresets[currentPresetId]) {
                const enablePreset = settings.characterEnablePresets[currentPresetId];
                enablePreset.characters = [...new Set([...enablePreset.characters, ...createdCharacters])];
                saveSettingsDebounced();
            }
        }
    }

    // 显示完成消息
    let summary = '录入完成!\n\n';
    if (createdCharacters.length > 0) {
        summary += `✓ 已创建 ${createdCharacters.length} 个角色预设\n`;
    }
    if (createdOutfits.length > 0) {
        summary += `✓ 已创建 ${createdOutfits.length} 个服装预设\n`;
    }

    toastr.success(summary, '数据录入成功', { timeOut: 3000 });
}
