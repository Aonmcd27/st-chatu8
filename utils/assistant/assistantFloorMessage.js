/**
 * assistantFloorMessage.js
 * 
 * 酒馆楼层信息收集模块 —— 通过 ClickTrigger 双击收集酒馆聊天楼层元素，
 * 在 AI 助手发送消息时通过 {{楼层信息}} 模板变量注入最近 N 条楼层消息。
 * 
 * 两种收集模式：
 *   - auto（自动模式）：元素位于 .mes[mesid] 容器内，每次动态查找最新 N 层楼
 *   - manual（手动模式）：元素不在 .mes 容器内，使用固定 DOM 引用
 * 
 * 状态仅存内存，刷新即失。
 */

import { dom } from './assistantContext.js';
import { extension_settings } from "../../../../../extensions.js";
import { extensionName, eventNames } from '../config.js';
import { getContext } from "../../../../../st-context.js";
import { eventSource } from "../../../../../../script.js";
import { isMobileDevice } from '../utils.js';

// ═══════════════════════════════════════════════════════════
//  内存状态（刷新即失）
// ═══════════════════════════════════════════════════════════

/** 收集的目标元素 DOM 引用 */
let floorTargetElement = null;

/** 收集模式：'auto' | 'manual' | null */
let floorCollectionMode = null;

/** 自动模式下的 .mes 容器元素引用 */
let floorContainerElement = null;

/** 手动模式下收集的多条消息（支持同一楼层的不同内容） */
let manualCollectedMessages = [];

// ═══════════════════════════════════════════════════════════
//  元素收集 API
// ═══════════════════════════════════════════════════════════

/**
 * 设置楼层信息收集的目标元素。
 * 判断元素是否在 .mes[mesid] 容器内以决定收集模式。
 * @param {HTMLElement} element - 被双击的 DOM 元素
 * @returns {object} 返回收集结果 { success: boolean, message: string, isDuplicate: boolean }
 */
export function setFloorTargetElement(element) {
    if (!element) {
        console.warn('[FloorMessage] 目标元素为空');
        return { success: false, message: '目标元素为空', isDuplicate: false };
    }

    floorTargetElement = element;

    // 检查元素是否在 .mes[mesid] 容器内
    const mesContainer = element.closest('.mes[mesid]');
    if (mesContainer) {
        floorCollectionMode = 'auto';
        floorContainerElement = mesContainer;
        console.log('[FloorMessage] 自动模式：检测到 mes 容器, mesid =', mesContainer.getAttribute('mesid'));

        // 更新 UI 状态
        updateFloorStatusIndicator(true);
        updateFloorIndicator(true);

        return { success: true, message: '已收集楼层信息（自动模式）', isDuplicate: false };
    } else {
        // 手动模式：收集当前元素的文本内容
        floorCollectionMode = 'manual';
        floorContainerElement = null;

        // 提取并清洗文本内容
        const rawText = element.innerText || '';
        const cleanedText = cleanFloorText(rawText);

        if (!cleanedText) {
            console.warn('[FloorMessage] 手动模式：元素文本为空');
            return { success: false, message: '元素文本为空，无法收集', isDuplicate: false };
        }

        // 获取 mesId 和角色名（如果有）
        let mesId = '0';
        let charName = '手动收集';

        const mesParent = element.closest('.mes[mesid]');
        if (mesParent) {
            mesId = mesParent.getAttribute('mesid') || '0';
            charName = mesParent.getAttribute('ch_name') ||
                mesParent.querySelector('.name_text')?.textContent?.trim() ||
                '手动收集';
        }

        // 检查是否已存在相同内容（通过文本内容对比，而非 mesId）
        const isDuplicate = manualCollectedMessages.some(msg => msg.text === cleanedText);

        if (isDuplicate) {
            console.log('[FloorMessage] 手动模式：内容已存在，跳过重复收集');
            return { success: false, message: '该内容已收集过，未重复添加', isDuplicate: true };
        }

        // 添加到手动收集列表
        manualCollectedMessages.push({
            mesId,
            charName,
            text: cleanedText,
            timestamp: Date.now()
        });

        // 获取配置的楼层数量限制
        const settings = extension_settings[extensionName]?.chatu8_ai_assistant;
        const maxCount = settings?.floor_count || 1;

        // 如果超过限制，从前面淘汰旧消息（保留最新的 N 条）
        if (manualCollectedMessages.length > maxCount) {
            const removed = manualCollectedMessages.splice(0, manualCollectedMessages.length - maxCount);
            console.log('[FloorMessage] 手动模式：超过数量限制，已淘汰', removed.length, '条旧消息');
        }

        console.log('[FloorMessage] 手动模式：已添加消息', {
            mesId,
            charName,
            textLength: cleanedText.length,
            totalCount: manualCollectedMessages.length,
            maxCount
        });

        // 更新 UI 状态
        updateFloorStatusIndicator(true);
        updateFloorIndicator(true);

        return {
            success: true,
            message: `已收集楼层信息（手动模式，共 ${manualCollectedMessages.length}/${maxCount} 条）`,
            isDuplicate: false
        };
    }
}

/**
 * 获取当前收集的目标元素
 * @returns {HTMLElement|null}
 */
export function getFloorTargetElement() {
    return floorTargetElement;
}

/**
 * 获取手动收集的消息列表（用于面板交互）
 * @returns {Array}
 */
export function getManualCollectedMessages() {
    return manualCollectedMessages;
}

/**
 * 检查是否已收集楼层元素
 * @returns {boolean}
 */
export function isFloorElementCollected() {
    return floorTargetElement !== null;
}

/**
 * 获取当前收集模式
 * @returns {string|null} 'auto' | 'manual' | null
 */
export function getFloorCollectionMode() {
    return floorCollectionMode;
}

/**
 * 清除已收集的楼层元素
 */
export function clearFloorTargetElement() {
    floorTargetElement = null;
    floorCollectionMode = null;
    floorContainerElement = null;
    manualCollectedMessages = [];  // 清空手动收集的消息列表

    updateFloorStatusIndicator(false);
    updateFloorIndicator(false);

    console.log('[FloorMessage] 已清除楼层信息收集');
}

// ═══════════════════════════════════════════════════════════
//  楼层消息收集与构建
// ═══════════════════════════════════════════════════════════

/**
 * 清洗楼层消息文本
 * - 移除图片标记 [st-chatu8-image...]
 * - 折叠多余空行
 * - trim 首尾空白
 * @param {string} text - 原始文本
 * @returns {string} 清洗后的文本
 */
function cleanFloorText(text) {
    if (!text) return '';

    let cleaned = text;

    // 移除图片标记
    cleaned = cleaned.replace(/\[st-chatu8-image[^\]]*\]/g, '');

    // 折叠连续空行为单个空行
    cleaned = cleaned.replace(/\n{3,}/g, '\n\n');

    // trim 首尾空白
    cleaned = cleaned.trim();

    return cleaned;
}

/**
 * 收集楼层消息
 * @param {number} count - 要收集的楼层数量
 * @returns {Array<{mesId: string, charName: string, text: string}>} 收集到的消息数组
 */
function collectFloorMessages(count) {
    const messages = [];

    if (!floorTargetElement) {
        console.warn('[FloorMessage] 未设置目标元素');
        return messages;
    }

    if (floorCollectionMode === 'auto') {
        // 自动模式：从对话容器中动态查找最新 N 个 .mes 元素
        const chatContainer = document.getElementById('chat');
        if (!chatContainer) {
            console.warn('[FloorMessage] 未找到 #chat 容器');
            return messages;
        }

        const allMesElements = chatContainer.querySelectorAll('.mes[mesid]');
        const totalMessages = allMesElements.length;
        const startIndex = Math.max(0, totalMessages - count);

        for (let i = startIndex; i < totalMessages; i++) {
            const mesEl = allMesElements[i];
            const mesId = mesEl.getAttribute('mesid') || '?';
            const charName = mesEl.getAttribute('ch_name') || mesEl.querySelector('.name_text')?.textContent?.trim() || '未知';
            const mesTextEl = mesEl.querySelector('.mes_text');
            const rawText = mesTextEl ? mesTextEl.innerText : '';
            const cleanedText = cleanFloorText(rawText);

            if (cleanedText) {
                messages.push({ mesId, charName, text: cleanedText });
            }
        }
    } else if (floorCollectionMode === 'manual') {
        // 手动模式：返回所有手动收集的消息（已在收集时做了数量限制）
        return [...manualCollectedMessages];
    }

    return messages;
}

/**
 * 【异步版本】从原始聊天数据收集楼层消息，经正则处理。
 * 用于世界书触发——与 getElContext() 的数据路径保持一致：
 *   auto 模式 → context.chat[mesId].mes → REGEX_TEST_MESSAGE → 干净文本
 *   manual 模式 → 从后往前取最近 N 条手动收集的消息
 * @param {number} count - 要收集的楼层数量
 * @returns {Promise<Array<{mesId: string, charName: string, text: string}>>}
 */
async function collectFloorMessagesFromContext(count) {
    const messages = [];

    if (!floorTargetElement) return messages;

    if (floorCollectionMode === 'auto') {
        const chatContainer = document.getElementById('chat');
        if (!chatContainer) return messages;

        const context = getContext();
        const allMesElements = chatContainer.querySelectorAll('.mes[mesid]');
        const totalMessages = allMesElements.length;
        const startIndex = Math.max(0, totalMessages - count);

        for (let i = startIndex; i < totalMessages; i++) {
            const mesEl = allMesElements[i];
            const mesId = mesEl.getAttribute('mesid') || '?';
            const mesIdNum = parseInt(mesId, 10);
            const charName = mesEl.getAttribute('ch_name') ||
                mesEl.querySelector('.name_text')?.textContent?.trim() || '未知';

            // ★ 从 context.chat 读取原始数据（而非 DOM innerText）
            const rawText = context.chat?.[mesIdNum]?.mes || '';

            // ★ 经正则处理（与 chatDataUtils.getElContext 路径一致）
            const processedText = await processTextThroughRegex(rawText);
            const cleanedText = cleanFloorText(processedText);

            if (cleanedText) {
                messages.push({ mesId, charName, text: cleanedText });
            }
        }
    } else if (floorCollectionMode === 'manual') {
        // manual 模式：返回所有手动收集的消息（已在收集时做了数量限制，已经是清洗过的文本）
        return [...manualCollectedMessages];
    }

    return messages;
}

/**
 * 通过正则事件总线处理文本（与 chatDataUtils.getElContext 相同的路径）
 * @param {string} text - 原始文本
 * @returns {Promise<string>} 正则处理后的文本
 */
function processTextThroughRegex(text) {
    return new Promise((resolve) => {
        if (!text) { resolve(''); return; }

        const requestId = `floorMsg-${Date.now()}-${Math.random().toString(36).slice(2)}`;

        const timeoutId = setTimeout(() => {
            eventSource.removeListener(eventNames.REGEX_RESULT_MESSAGE, listener);
            console.warn('[FloorMessage] 正则处理超时，使用原始文本');
            resolve(text);
        }, 5000);

        const listener = (data) => {
            if (data.id === requestId) {
                clearTimeout(timeoutId);
                eventSource.removeListener(eventNames.REGEX_RESULT_MESSAGE, listener);
                resolve(data.message);
            }
        };

        eventSource.on(eventNames.REGEX_RESULT_MESSAGE, listener);
        eventSource.emit(eventNames.REGEX_TEST_MESSAGE, { message: text, id: requestId });
    });
}

/**
 * 构建楼层上下文字符串，用于替换 {{楼层信息}} 模板变量。
 * ★ 异步版本：使用 collectFloorMessagesFromContext() 从原始聊天数据获取，避免 DOM innerText 混入 UI 文字
 * @returns {Promise<string>} 格式化后的楼层信息文本
 */
export async function buildFloorContext() {
    // 检查功能是否启用
    const settings = extension_settings[extensionName]?.chatu8_ai_assistant;
    if (!settings?.floor_message_enabled) {
        return '';
    }

    if (!isFloorElementCollected()) {
        return '';
    }

    const count = settings.floor_count || 1;
    const messages = await collectFloorMessagesFromContext(count);

    if (messages.length === 0) {
        return '';
    }

    // 构建格式化输出
    const header = `[最近 ${messages.length} 条酒馆楼层消息]`;
    const body = messages.map(msg =>
        `#${msg.mesId} ${msg.charName}:\n${msg.text}`
    ).join('\n\n');

    return `${header}\n${body}`;
}

// ═══════════════════════════════════════════════════════════
//  UI 状态更新
// ═══════════════════════════════════════════════════════════

/**
 * 更新设置面板中的楼层状态指示灯
 * @param {boolean} collected - 是否已收集
 */
export function updateFloorStatusIndicator(collected) {
    if (dom.floorStatus) {
        if (collected) {
            dom.floorStatus.css('background-color', '#4CAF50');
            dom.floorStatus.attr('title', '已收集楼层元素（模式: ' + (floorCollectionMode || '未知') + '）');
        } else {
            dom.floorStatus.css('background-color', '#999');
            dom.floorStatus.attr('title', '未收集楼层元素');
        }
    }
}

/**
 * 更新头部/底部的楼层指示图标显示状态
 * @param {boolean} show - 是否显示
 */
export function updateFloorIndicator(show) {
    if (dom.floorIndicator) {
        dom.floorIndicator.toggle(!!show);
    }
}

// ═══════════════════════════════════════════════════════════
//  楼层信息查看面板
// ═══════════════════════════════════════════════════════════

/**
 * 显示楼层信息查看面板（含世界书触发内容）
 */
async function showFloorInfoPanel() {
    if (!isFloorElementCollected()) {
        console.warn('[FloorMessage] 未收集楼层信息');
        return;
    }

    const settings = extension_settings[extensionName]?.chatu8_ai_assistant;
    const count = settings?.floor_count || 1;
    const messages = await collectFloorMessagesFromContext(count);

    if (messages.length === 0) {
        console.warn('[FloorMessage] 未收集到有效楼层消息');
        return;
    }

    // ── 异步获取世界书触发内容 ──
    let worldBookHtml = '';
    try {
        const { processWorldBooksWithTriggerStructured } = await import('../worldbookProcessor.js');
        const rawMessages = await collectFloorMessagesFromContext(count);
        const triggerLines = rawMessages.map(msg => `#${msg.mesId} ${msg.charName}:\n${msg.text}`);

        console.log('[FloorMessage] 世界书触发：使用原始聊天数据，共', rawMessages.length, '条');

        // 获取结构化的世界书数据
        const worldBooksData = await processWorldBooksWithTriggerStructured(triggerLines);

        if (worldBooksData && worldBooksData.length > 0) {
            const stCtx = getContext();
            const username = stCtx?.name1 || '';

            let worldBooksHtml = '';

            // 遍历每个世界书
            worldBooksData.forEach((worldBook, worldIndex) => {
                const worldId = `world-${worldIndex}`;
                const worldName = worldBook.worldName || '未命名世界书';
                const entries = worldBook.entries || [];

                if (entries.length === 0) return;

                // 构建条目列表
                let entriesHtml = '';
                entries.forEach((entry, entryIndex) => {
                    const entryId = `${worldId}-entry-${entryIndex}`;
                    const entryName = entry.comment || '未命名条目';
                    let entryContent = entry.content || '';

                    // 替换占位符
                    entryContent = entryContent.replaceAll('{{user}}', username);
                    entryContent = entryContent.replaceAll('<user>', username);

                    const previewLength = 150;
                    const entryPreview = entryContent.substring(0, previewLength);
                    const hasMore = entryContent.length > previewLength;

                    entriesHtml += `
                        <div class="wb-entry-item" data-world-name="${worldName}" data-entry-uid="${entry.uid || ''}" style="
                            margin-bottom: 8px;
                            padding: 8px 10px;
                            background: rgba(66, 165, 245, 0.05);
                            border-left: 2px solid rgba(66, 165, 245, 0.3);
                            border-radius: 4px;
                        ">
                            <div style="
                                font-weight: bold;
                                color: #64b5f6;
                                font-size: 12px;
                                margin-bottom: 6px;
                                display: flex;
                                align-items: center;
                                justify-content: space-between;
                                gap: 6px;
                            ">
                                <div style="display: flex; align-items: center; gap: 6px; flex: 1;">
                                    <i class="fa-solid fa-bookmark" style="font-size: 10px;"></i>
                                    <span>${entryName}</span>
                                </div>
                                <div style="display: flex; align-items: center; gap: 4px;">
                                    <button class="wb-entry-disable-btn" data-world-name="${worldName}" data-entry-uid="${entry.uid || ''}" style="
                                        padding: 2px 8px;
                                        background: rgba(255, 152, 0, 0.15);
                                        border: 1px solid rgba(255, 152, 0, 0.3);
                                        border-radius: 3px;
                                        color: #ff9800;
                                        cursor: pointer;
                                        font-size: 10px;
                                        transition: all 0.2s;
                                    " title="禁用此条目（影响发送数据设置）">
                                        <i class="fa-solid fa-ban"></i> 禁用
                                    </button>
                                    ${hasMore ? `
                                    <button class="wb-entry-toggle-top" data-entry-id="${entryId}" style="
                                        padding: 2px 8px;
                                        background: rgba(66, 165, 245, 0.15);
                                        border: 1px solid rgba(66, 165, 245, 0.3);
                                        border-radius: 3px;
                                        color: #42a5f5;
                                        cursor: pointer;
                                        font-size: 10px;
                                        transition: all 0.2s;
                                        display: none;
                                    ">
                                        <i class="fa-solid fa-chevron-up"></i> 收起
                                    </button>
                                    ` : ''}
                                </div>
                            </div>
                            <div class="wb-entry-preview" style="
                                white-space: pre-wrap;
                                line-height: 1.5;
                                font-size: 13px;
                                color: #ddd;
                                ${hasMore ? 'cursor: pointer;' : ''}
                            " data-entry-id="${entryId}">
                                ${hasMore ? entryPreview + '...' : entryContent}
                            </div>
                            <div class="wb-entry-full" id="${entryId}-full" style="
                                white-space: pre-wrap;
                                line-height: 1.5;
                                font-size: 13px;
                                color: #ddd;
                                display: none;
                            ">
                                ${entryContent}
                            </div>
                            ${hasMore ? `
                            <button class="wb-entry-toggle" data-entry-id="${entryId}" style="
                                margin-top: 6px;
                                padding: 3px 10px;
                                background: rgba(66, 165, 245, 0.15);
                                border: 1px solid rgba(66, 165, 245, 0.3);
                                border-radius: 3px;
                                color: #42a5f5;
                                cursor: pointer;
                                font-size: 11px;
                                transition: all 0.2s;
                            ">
                                <i class="fa-solid fa-chevron-down"></i> 展开条目
                            </button>
                            ` : ''}
                        </div>
                    `;
                });

                worldBooksHtml += `
                    <div class="wb-world-item" style="
                        margin-bottom: 12px;
                        border: 1px solid rgba(66, 165, 245, 0.2);
                        border-radius: 6px;
                        overflow: hidden;
                        background: rgba(66, 165, 245, 0.03);
                    ">
                        <div class="wb-world-header" data-world-id="${worldId}" style="
                            padding: 10px 12px;
                            background: rgba(66, 165, 245, 0.1);
                            cursor: pointer;
                            display: flex;
                            align-items: center;
                            justify-content: space-between;
                            user-select: none;
                            transition: background 0.2s;
                        ">
                            <div style="display: flex; align-items: center; gap: 8px;">
                                <i class="fa-solid fa-chevron-right wb-world-icon" style="
                                    color: #42a5f5;
                                    font-size: 12px;
                                    transition: transform 0.2s;
                                "></i>
                                <span style="font-weight: bold; color: #42a5f5; font-size: 13px;">
                                    📖 ${worldName}
                                </span>
                            </div>
                            <span style="font-size: 11px; color: #888;">
                                ${entries.length} 个条目
                            </span>
                        </div>
                        <div class="wb-world-content" id="${worldId}-content" style="
                            padding: 10px;
                            display: none;
                        ">
                            ${entriesHtml}
                        </div>
                    </div>
                `;
            });

            if (worldBooksHtml) {
                worldBookHtml = `
                    <div style="margin-bottom: 18px;">
                        <div style="
                            font-size: 14px;
                            font-weight: bold;
                            color: #90caf9;
                            margin-bottom: 10px;
                            display: flex;
                            align-items: center;
                            gap: 6px;
                        ">
                            <span>🌐 世界书触发内容</span>
                            <button id="wb-expand-all" style="
                                padding: 3px 10px;
                                background: rgba(66, 165, 245, 0.2);
                                border: 1px solid rgba(66, 165, 245, 0.4);
                                border-radius: 4px;
                                color: #42a5f5;
                                cursor: pointer;
                                font-size: 11px;
                                margin-left: auto;
                            ">
                                <i class="fa-solid fa-expand"></i> 全部展开
                            </button>
                            <button id="wb-collapse-all" style="
                                padding: 3px 10px;
                                background: rgba(66, 165, 245, 0.2);
                                border: 1px solid rgba(66, 165, 245, 0.4);
                                border-radius: 4px;
                                color: #42a5f5;
                                cursor: pointer;
                                font-size: 11px;
                            ">
                                <i class="fa-solid fa-compress"></i> 全部收起
                            </button>
                        </div>
                        ${worldBooksHtml}
                    </div>
                    <hr style="border: none; border-top: 1px solid rgba(255,255,255,0.1); margin: 0 0 18px 0;">
                `;
            }
        } else {
            worldBookHtml = `
                <div style="margin-bottom: 18px;">
                    <div style="font-size: 14px; font-weight: bold; color: #90caf9; margin-bottom: 8px;">🌐 世界书触发内容</div>
                    <div style="color: #888; font-size: 13px; font-style: italic;">（无条目被触发）</div>
                </div>
                <hr style="border: none; border-top: 1px solid rgba(255,255,255,0.1); margin: 0 0 18px 0;">
            `;
        }
    } catch (err) {
        console.warn('[FloorMessage] 获取世界书触发内容失败:', err);
        worldBookHtml = `
            <div style="margin-bottom: 18px;">
                <div style="font-size: 14px; font-weight: bold; color: #90caf9; margin-bottom: 8px;">🌐 世界书触发内容</div>
                <div style="color: #f48fb1; font-size: 13px;">⚠️ 获取失败: ${err.message || '未知错误'}</div>
            </div>
            <hr style="border: none; border-top: 1px solid rgba(255,255,255,0.1); margin: 0 0 18px 0;">
        `;
    }

    // ── 移动端检测和定位计算（参考 personaGen.js 的弹窗定位逻辑）──
    const isMobile = isMobileDevice();
    let panelTop = '50%';
    let panelLeft = '50%';
    let panelTransform = 'translate(-50%, -50%)';
    let panelMaxHeight = '82vh';
    let panelWidth = '680px';
    if (isMobile) {
        const topSettingsHolder = document.querySelector('#top-settings-holder');
        let topOffset = 10;
        if (topSettingsHolder) {
            const rect = topSettingsHolder.getBoundingClientRect();
            topOffset = Math.max(10, Math.min(rect.bottom + 10, window.innerHeight * 0.5));
        }
        const availableHeight = Math.max(200, window.innerHeight - topOffset - 20);
        panelTop = `${topOffset}px`;
        panelLeft = '50%';
        panelTransform = 'translateX(-50%)';
        panelMaxHeight = `${availableHeight}px`;
        panelWidth = '96vw';
    }

    // ── 构建楼层消息内容（支持折叠、拖拽排序、删除）──
    const floorContent = messages.map((msg, index) => {
        const previewLength = 100;
        const textPreview = msg.text.substring(0, previewLength);
        const hasMore = msg.text.length > previewLength;
        const fullText = msg.text;

        return `
        <div class="st-chatu8-floor-item" data-index="${index}" style="
            margin-bottom: 12px; 
            padding: 12px; 
            background: rgba(255,255,255,0.05); 
            border-radius: 8px;
            border: 1px solid rgba(255,255,255,0.08);
            transition: all 0.2s;
        ">
            <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 8px;">
                <div class="floor-drag-handle" style="
                    cursor: grab;
                    color: #888;
                    font-size: 16px;
                    padding: 4px;
                    user-select: none;
                " title="拖拽排序">
                    <i class="fa-solid fa-grip-vertical"></i>
                </div>
                <div style="flex: 1; font-weight: bold; color: #4CAF50;">
                    #${msg.mesId} ${msg.charName}
                </div>
                ${hasMore ? `
                <button class="floor-toggle-top-btn" data-index="${index}" style="
                    padding: 3px 10px;
                    background: rgba(76, 175, 80, 0.2);
                    border: 1px solid rgba(76, 175, 80, 0.4);
                    border-radius: 4px;
                    color: #4CAF50;
                    cursor: pointer;
                    font-size: 11px;
                    transition: all 0.2s;
                    display: none;
                ">
                    <i class="fa-solid fa-chevron-up"></i> 收起
                </button>
                ` : ''}
                <button class="floor-remove-btn" data-index="${index}" style="
                    padding: 4px 8px;
                    background: rgba(244, 67, 54, 0.2);
                    border: 1px solid rgba(244, 67, 54, 0.4);
                    border-radius: 4px;
                    color: #f44336;
                    cursor: pointer;
                    font-size: 12px;
                    transition: all 0.2s;
                " title="移除此消息">
                    <i class="fa-solid fa-trash"></i>
                </button>
            </div>
            <div class="floor-text-content" style="position: relative;">
                <div class="floor-text-preview" style="
                    white-space: pre-wrap; 
                    line-height: 1.5;
                    color: #ddd;
                    ${hasMore ? 'max-height: 80px; overflow: hidden;' : ''}
                ">
                    ${hasMore ? textPreview + '...' : fullText}
                </div>
                <div class="floor-text-full" style="
                    white-space: pre-wrap; 
                    line-height: 1.5;
                    color: #ddd;
                    display: none;
                ">
                    ${fullText}
                </div>
                ${hasMore ? `
                <button class="floor-toggle-btn" data-index="${index}" style="
                    margin-top: 8px;
                    padding: 4px 12px;
                    background: rgba(76, 175, 80, 0.2);
                    border: 1px solid rgba(76, 175, 80, 0.4);
                    border-radius: 4px;
                    color: #4CAF50;
                    cursor: pointer;
                    font-size: 12px;
                    transition: all 0.2s;
                ">
                    <i class="fa-solid fa-chevron-down"></i> 展开
                </button>
                ` : ''}
            </div>
        </div>
        `;
    }).join('');

    // ── 创建弹窗 ──
    const panelHtml = `
        <div id="st-chatu8-floor-info-panel" style="
            position: fixed;
            top: ${panelTop};
            left: ${panelLeft};
            transform: ${panelTransform};
            width: ${panelWidth};
            max-width: 96vw;
            max-height: ${panelMaxHeight};
            background: rgba(22, 22, 33, 0.98);
            border: 1px solid rgba(255, 255, 255, 0.18);
            border-radius: 12px;
            box-shadow: 0 8px 32px rgba(0, 0, 0, 0.6);
            z-index: 10001;
            display: flex;
            flex-direction: column;
            backdrop-filter: blur(12px);
        ">
            <div style="
                padding: 15px 20px;
                border-bottom: 1px solid rgba(255, 255, 255, 0.1);
                display: flex;
                justify-content: space-between;
                align-items: center;
            ">
                <div style="font-size: 16px; font-weight: bold; color: #fff;">
                    楼层信息 (${messages.length} 条)
                </div>
                <div style="display: flex; gap: 10px;">
                    <button id="st-chatu8-floor-clear-btn" style="
                        padding: 5px 15px;
                        background: rgba(244, 67, 54, 0.8);
                        border: none;
                        border-radius: 6px;
                        color: white;
                        cursor: pointer;
                        font-size: 14px;
                    ">清除全部</button>
                    <button id="st-chatu8-floor-close-btn" style="
                        padding: 5px 15px;
                        background: rgba(255, 255, 255, 0.1);
                        border: none;
                        border-radius: 6px;
                        color: white;
                        cursor: pointer;
                        font-size: 14px;
                    ">关闭</button>
                </div>
            </div>
            <div id="st-chatu8-floor-content" style="
                padding: 20px;
                overflow-y: auto;
                flex: 1;
                color: #ddd;
            ">
                ${worldBookHtml}
                <div style="font-size: 14px; font-weight: bold; color: #a5d6a7; margin-bottom: 10px; display: flex; align-items: center; gap: 6px;">
                    <span>📋 楼层消息</span>
                    <span style="font-size: 12px; color: #888; font-weight: normal;">(可拖拽排序)</span>
                </div>
                <div id="st-chatu8-floor-list">
                    ${floorContent}
                </div>
            </div>
        </div>
    `;

    // 移除已存在的面板
    $('#st-chatu8-floor-info-panel').remove();

    // 添加到页面
    $('body').append(panelHtml);

    // ── 绑定世界书折叠/展开事件 ──
    // 点击世界书标题展开/收起
    $('#st-chatu8-floor-content').on('click', '.wb-world-header', function () {
        const worldId = $(this).data('world-id');
        const $content = $(`#${worldId}-content`);
        const $icon = $(this).find('.wb-world-icon');

        if ($content.is(':visible')) {
            $content.slideUp(200);
            $icon.css('transform', 'rotate(0deg)');
        } else {
            $content.slideDown(200);
            $icon.css('transform', 'rotate(90deg)');
        }
    });

    // 点击条目展开/收起（底部按钮）
    $('#st-chatu8-floor-content').on('click', '.wb-entry-toggle', function (e) {
        e.stopPropagation();
        const entryId = $(this).data('entry-id');
        const $item = $(this).closest('.wb-entry-item');
        const $preview = $item.find('.wb-entry-preview');
        const $full = $(`#${entryId}-full`);
        const $topBtn = $item.find('.wb-entry-toggle-top');

        if ($full.is(':visible')) {
            $full.hide();
            $preview.show();
            $(this).html('<i class="fa-solid fa-chevron-down"></i> 展开条目');
            $topBtn.hide();
        } else {
            $preview.hide();
            $full.show();
            $(this).html('<i class="fa-solid fa-chevron-up"></i> 收起条目');
            $topBtn.show();
        }
    });

    // 点击条目展开/收起（顶部按钮）
    $('#st-chatu8-floor-content').on('click', '.wb-entry-toggle-top', function (e) {
        e.stopPropagation();
        const entryId = $(this).data('entry-id');
        const $item = $(this).closest('.wb-entry-item');
        const $preview = $item.find('.wb-entry-preview');
        const $full = $(`#${entryId}-full`);
        const $bottomBtn = $item.find('.wb-entry-toggle');

        // 收起
        $full.hide();
        $preview.show();
        $bottomBtn.html('<i class="fa-solid fa-chevron-down"></i> 展开条目');
        $(this).hide();
    });

    // 点击条目预览文本也可以展开（如果有更多内容）
    $('#st-chatu8-floor-content').on('click', '.wb-entry-preview', function (e) {
        const entryId = $(this).data('entry-id');
        if (!entryId) return;

        const $toggle = $(this).siblings('.wb-entry-toggle');
        if ($toggle.length > 0) {
            $toggle.click();
        }
    });

    // 禁用条目按钮
    $('#st-chatu8-floor-content').on('click', '.wb-entry-disable-btn', async function (e) {
        e.stopPropagation();
        const worldName = $(this).data('world-name');
        const entryUid = $(this).data('entry-uid');

        if (!worldName || entryUid === undefined || entryUid === null) {
            console.warn('[FloorMessage] 禁用条目失败：缺少必要参数', { worldName, entryUid });
            return;
        }

        try {
            // 动态导入 send_data.js 的函数
            const { toggleWorldEntryState, getWorldEntryState } = await import('../settings/send_data.js');

            // 获取当前状态
            const currentState = getWorldEntryState(worldName, entryUid);

            // 切换为禁用状态
            const newState = toggleWorldEntryState(worldName, entryUid, false);

            console.log('[FloorMessage] 已禁用条目:', {
                worldName,
                entryUid,
                原状态: currentState,
                新状态: newState
            });

            // 更新按钮状态
            const $btn = $(this);
            if (newState === false) {
                $btn.html('<i class="fa-solid fa-check"></i> 已禁用');
                $btn.css({
                    'background': 'rgba(76, 175, 80, 0.15)',
                    'border-color': 'rgba(76, 175, 80, 0.3)',
                    'color': '#4CAF50'
                });
                $btn.prop('disabled', true);
                toastr.success(`已禁用条目（世界书: ${worldName}）`);
            }
        } catch (err) {
            console.error('[FloorMessage] 禁用条目失败:', err);
            toastr.error('禁用条目失败: ' + (err.message || '未知错误'));
        }
    });

    // 全部展开按钮
    $('#wb-expand-all').on('click', function () {
        $('.wb-world-content').slideDown(200);
        $('.wb-world-icon').css('transform', 'rotate(90deg)');

        // 展开所有条目
        $('.wb-entry-full').show();
        $('.wb-entry-preview').hide();
        $('.wb-entry-toggle').html('<i class="fa-solid fa-chevron-up"></i> 收起条目');
        $('.wb-entry-toggle-top').show();
    });

    // 全部收起按钮
    $('#wb-collapse-all').on('click', function () {
        $('.wb-world-content').slideUp(200);
        $('.wb-world-icon').css('transform', 'rotate(0deg)');

        // 收起所有条目
        $('.wb-entry-full').hide();
        $('.wb-entry-preview').show();
        $('.wb-entry-toggle').html('<i class="fa-solid fa-chevron-down"></i> 展开条目');
        $('.wb-entry-toggle-top').hide();
    });

    // ── 绑定楼层消息折叠/展开事件 ──
    $('#st-chatu8-floor-list').on('click', '.floor-toggle-btn', function () {
        const $item = $(this).closest('.st-chatu8-floor-item');
        const $content = $item.find('.floor-text-content');
        const $preview = $content.find('.floor-text-preview');
        const $full = $content.find('.floor-text-full');
        const $topBtn = $item.find('.floor-toggle-top-btn');

        if ($full.is(':visible')) {
            // 收起
            $full.hide();
            $preview.show();
            $(this).html('<i class="fa-solid fa-chevron-down"></i> 展开');
            $topBtn.hide();
        } else {
            // 展开
            $preview.hide();
            $full.show();
            $(this).html('<i class="fa-solid fa-chevron-up"></i> 收起');
            $topBtn.show();
        }
    });

    // 顶部收起按钮
    $('#st-chatu8-floor-list').on('click', '.floor-toggle-top-btn', function () {
        const $item = $(this).closest('.st-chatu8-floor-item');
        const $content = $item.find('.floor-text-content');
        const $preview = $content.find('.floor-text-preview');
        const $full = $content.find('.floor-text-full');
        const $bottomBtn = $item.find('.floor-toggle-btn');

        // 收起
        $full.hide();
        $preview.show();
        $bottomBtn.html('<i class="fa-solid fa-chevron-down"></i> 展开');
        $(this).hide();
    });

    // ── 绑定删除事件 ──
    $('#st-chatu8-floor-list').on('click', '.floor-remove-btn', function () {
        const index = parseInt($(this).data('index'));

        if (floorCollectionMode === 'manual' && manualCollectedMessages.length > 0) {
            // 从数组中移除
            manualCollectedMessages.splice(index, 1);
            console.log('[FloorMessage] 已移除消息，剩余:', manualCollectedMessages.length);

            // 如果全部移除，清空状态
            if (manualCollectedMessages.length === 0) {
                clearFloorTargetElement();
                $('#st-chatu8-floor-info-panel').remove();
                toastr.info('已移除所有楼层消息');
                return;
            }

            // 重新渲染面板
            $('#st-chatu8-floor-info-panel').remove();
            showFloorInfoPanel();
            toastr.success('已移除该消息');
        } else {
            toastr.warning('自动模式下不支持删除单条消息');
        }
    });

    // ── 绑定拖拽排序事件 ──
    const floorList = document.getElementById('st-chatu8-floor-list');
    let draggedElement = null;
    let draggedIndex = null;
    let lastTargetElement = null; // 缓存上次的目标元素，避免重复 DOM 操作

    // 使元素可拖拽（必须在事件监听前设置）
    floorList.querySelectorAll('.st-chatu8-floor-item').forEach(item => {
        item.draggable = true;
    });

    // 拖拽开始
    floorList.addEventListener('dragstart', function (e) {
        const item = e.target.closest('.st-chatu8-floor-item');
        if (!item) return;

        draggedElement = item;
        draggedIndex = parseInt(item.dataset.index);
        lastTargetElement = null;

        // 设置拖拽数据
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', draggedIndex);

        // 延迟设置样式，避免拖拽预览显示半透明
        setTimeout(() => {
            item.classList.add('dragging');
            item.style.opacity = '0.4';
        }, 0);
    });

    // 拖拽经过 - 使用节流优化性能
    let dragOverTimeout = null;
    floorList.addEventListener('dragover', function (e) {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';

        if (!draggedElement) return;

        // 节流：每 50ms 最多执行一次 DOM 操作
        if (dragOverTimeout) return;

        dragOverTimeout = setTimeout(() => {
            dragOverTimeout = null;
        }, 50);

        const afterElement = getDragAfterElement(floorList, e.clientY);

        // 只有当目标位置改变时才操作 DOM
        if (afterElement !== lastTargetElement) {
            lastTargetElement = afterElement;

            if (afterElement == null) {
                floorList.appendChild(draggedElement);
            } else {
                floorList.insertBefore(draggedElement, afterElement);
            }
        }
    });

    // 拖拽进入
    floorList.addEventListener('dragenter', function (e) {
        e.preventDefault();
    });

    // 拖拽结束
    floorList.addEventListener('dragend', function (e) {
        if (!draggedElement) return;

        draggedElement.classList.remove('dragging');
        draggedElement.style.opacity = '1';

        // 计算新位置
        const items = Array.from(floorList.querySelectorAll('.st-chatu8-floor-item'));
        const newIndex = items.indexOf(draggedElement);

        if (newIndex !== -1 && newIndex !== draggedIndex && floorCollectionMode === 'manual') {
            // 更新数组顺序
            const [movedItem] = manualCollectedMessages.splice(draggedIndex, 1);
            manualCollectedMessages.splice(newIndex, 0, movedItem);

            console.log('[FloorMessage] 已调整顺序:', draggedIndex, '->', newIndex);

            // 重新渲染以更新索引
            $('#st-chatu8-floor-info-panel').remove();
            showFloorInfoPanel();
            toastr.success('已调整顺序');
        } else if (floorCollectionMode !== 'manual') {
            toastr.warning('自动模式下不支持排序');
        }

        draggedElement = null;
        draggedIndex = null;
        lastTargetElement = null;
    });

    // 放置
    floorList.addEventListener('drop', function (e) {
        e.preventDefault();
        e.stopPropagation();
    });

    function getDragAfterElement(container, y) {
        const draggableElements = [...container.querySelectorAll('.st-chatu8-floor-item:not(.dragging)')];

        return draggableElements.reduce((closest, child) => {
            const box = child.getBoundingClientRect();
            const offset = y - box.top - box.height / 2;

            if (offset < 0 && offset > closest.offset) {
                return { offset: offset, element: child };
            } else {
                return closest;
            }
        }, { offset: Number.NEGATIVE_INFINITY }).element;
    }

    // ── 绑定关闭按钮 ──
    $('#st-chatu8-floor-close-btn').on('click', () => {
        $('#st-chatu8-floor-info-panel').remove();
    });

    // ── 绑定清除按钮 ──
    $('#st-chatu8-floor-clear-btn').on('click', () => {
        clearFloorTargetElement();
        $('#st-chatu8-floor-info-panel').remove();
        toastr.success('已清除所有楼层信息');
        console.log('[FloorMessage] 已清除楼层信息收集');
    });

    // ── 点击面板外部关闭 ──
    $('#st-chatu8-floor-info-panel').on('click', function (e) {
        if (e.target === this) {
            $(this).remove();
        }
    });

    // ── 添加悬停样式 ──
    const style = document.createElement('style');
    style.textContent = `
        .st-chatu8-floor-item {
            cursor: move;
        }
        .st-chatu8-floor-item:hover {
            background: rgba(255,255,255,0.08) !important;
            border-color: rgba(255,255,255,0.15) !important;
        }
        .st-chatu8-floor-item.dragging {
            opacity: 0.4 !important;
            border: 2px dashed rgba(76, 175, 80, 0.6) !important;
            background: rgba(76, 175, 80, 0.1) !important;
        }
        .floor-remove-btn:hover {
            background: rgba(244, 67, 54, 0.4) !important;
            border-color: rgba(244, 67, 54, 0.6) !important;
        }
        .floor-toggle-btn:hover, .floor-toggle-top-btn:hover {
            background: rgba(76, 175, 80, 0.4) !important;
            border-color: rgba(76, 175, 80, 0.6) !important;
        }
        .floor-drag-handle {
            cursor: grab;
        }
        .floor-drag-handle:active {
            cursor: grabbing !important;
        }
        .wb-world-header:hover {
            background: rgba(66, 165, 245, 0.15) !important;
        }
        .wb-entry-toggle:hover, .wb-entry-toggle-top:hover {
            background: rgba(66, 165, 245, 0.25) !important;
            border-color: rgba(66, 165, 245, 0.5) !important;
        }
        .wb-entry-disable-btn:hover:not(:disabled) {
            background: rgba(255, 152, 0, 0.3) !important;
            border-color: rgba(255, 152, 0, 0.5) !important;
        }
        .wb-entry-disable-btn:disabled {
            cursor: not-allowed;
            opacity: 0.7;
        }
        .wb-entry-preview[data-entry-id]:hover {
            background: rgba(66, 165, 245, 0.08);
        }
        #wb-expand-all:hover, #wb-collapse-all:hover {
            background: rgba(66, 165, 245, 0.3) !important;
            border-color: rgba(66, 165, 245, 0.6) !important;
        }
    `;
    document.head.appendChild(style);
}

// ═══════════════════════════════════════════════════════════
//  事件绑定
// ═══════════════════════════════════════════════════════════

/**
 * 初始化楼层信息相关的 UI 事件。
 * 在 initDialogEvents() 中调用。
 */
export function initFloorMessageEvents() {
    // 楼层指示图标的点击事件 —— 点击后显示查看面板
    if (dom.floorIndicator) {
        dom.floorIndicator.off('click.floorMessage').on('click.floorMessage', () => {
            showFloorInfoPanel();
            console.log('[FloorMessage] 显示楼层信息查看面板');
        });
    }
}

/**
 * 绑定楼层指示图标的点击事件（可在 initAiAssistant 中调用）
 */
export function bindFloorIndicatorClick() {
    initFloorMessageEvents();
}
