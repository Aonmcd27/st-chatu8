// @ts-nocheck
/**
 * personaGen.js - 人设生成核心逻辑
 *
 * 通过 LLM 事件系统自动生成角色人设数据，
 * 并将结果填充到人设管理界面的各字段中。
 *
 * 参考 characterGen.js 的调用模式实现，包含完整的占位符替换流程。
 */

import { eventSource } from '../../../../../../../script.js';
import { getContext } from '../../../../../../st-context.js';
import { extension_settings } from '../../../../../../extensions.js';
import { eventNames, extensionName, LLMRequestTypes } from '../../config.js';
import { PERSONA_FIELDS, PERSONA_FIELD_LABELS, createPersonaPreset } from './personaPreset.js';

// ★ 导入占位符替换和 prompt 构建所需的模块（参考 characterGen.js）
import { getElContext, processWorldBooksWithTrigger } from '../../promptReq.js';
import {
    generateCharacterListText,
    generateOutfitEnableListText,
    generateCommonCharacterListText,
} from '../worldbook.js';
import { buildPromptForRequestType, getMergeOptionsForRequestType } from '../llmService.js';
import { mergeAdjacentMessages, replaceAllPlaceholders } from '../../promptProcessor.js';
import { updateCombinedPrompt } from '../llm.js';
import { buildFloorContext } from '../../assistant/assistantFloorMessage.js';
import { isMobileDevice } from '../../utils.js';
import { showToast } from '../../ui_common.js';

// 生成请求 ID 计数器
let requestIdCounter = 0;

// 管理页面上传的参考图片存储
let managementPageImages = [];

function generateRequestId() {
    return `persona-gen-${Date.now()}-${++requestIdCounter}`;
}

// ===================== 初始化 =====================

/**
 * 初始化人设生成功能
 */
export function setupPersonaGen() {
    bindPersonaGenButton();
    bindManagementPageImageUpload();
    console.log('[PersonaGen] 人设生成模块已初始化');
}

// ===================== 从 ClickTrigger 触发 =====================

/**
 * 从 ClickTrigger 双击菜单触发人设生成
 * @param {HTMLElement} el - 触发的消息元素
 */
export async function handlePersonaGenFromClick(el) {
    console.log('[PersonaGen] 从 ClickTrigger 触发人设生成');

    let messageText = '';
    try {
        messageText = getVisibleTextContent(el)?.trim() || '';
        if (messageText.length > 500) {
            messageText = messageText.substring(0, 500) + '...';
        }
    } catch (e) {
        console.warn('[PersonaGen] 提取消息文本失败:', e);
    }

    // 先询问生成类型
    const typeChoice = await showTypeSelectionPopup();
    if (typeChoice === null) {
        console.log('[PersonaGen] 用户取消了类型选择');
        return;
    }

    const popupResult = await showPersonaGenDemandPopup(messageText, typeChoice);
    if (popupResult === null) {
        console.log('[PersonaGen] 用户取消了人设生成');
        return;
    }

    const demandText = popupResult.text || '';
    const referenceImages = popupResult.images || [];
    const generationType = popupResult.type || 'character';

    console.log('[PersonaGen] 用户需求:', demandText);
    console.log('[PersonaGen] 参考图片数量:', referenceImages.length);
    console.log('[PersonaGen] 生成类型:', generationType);

    await handlePersonaGenRequest(el, messageText, demandText, referenceImages, generationType);
}

// ===================== 核心请求函数（含变量替换） =====================

/**
 * 执行人设生成请求 - 参考 characterGen.js 的 handleCharacterDesignRequest 流程
 * @param {HTMLElement|null} el - 触发元素（用于获取聊天上下文），管理页面触发时为 null
 * @param {string} extraContext - 额外上下文文本
 * @param {string|undefined} overrideDemand - 覆盖的需求文本
 * @param {Array} referenceImages - 参考图片数组
 * @param {string} generationType - 生成类型：'character' 或 'user'，默认为 'character'
 */
async function handlePersonaGenRequest(el = null, extraContext = '', overrideDemand = undefined, referenceImages = [], generationType = 'character') {
    const statusEl = document.getElementById('ch-persona-gen-status');
    const btnEl = document.getElementById('ch-persona-gen-btn');
    try {
        if (btnEl) btnEl.disabled = true;
        setStatus(statusEl, '正在构建提示词...');

        const demandText = overrideDemand !== undefined
            ? overrideDemand
            : (document.getElementById('ch-persona-gen-demand')?.value?.trim() || '');

        // ★ 1. 获取聊天上下文（如果有触发元素）
        let contextElements = [];
        let nowtxt = extraContext || '';
        if (el) {
            const historyDepth = (extension_settings[extensionName]?.llm_history_depth ?? 2) + 1;
            contextElements = await getElContext(el, historyDepth) || [];
            if (contextElements.length > 0) {
                nowtxt = contextElements[contextElements.length - 1];
            }
        }

        // ★ 2. 处理世界书触发
        setStatus(statusEl, '正在处理世界书触发...');
        let triggeredContent = '';
        if (contextElements.length > 0) {
            const triggerElements = demandText ? [...contextElements, demandText] : contextElements;
            triggeredContent = await processWorldBooksWithTrigger(triggerElements);
            console.log('[PersonaGen] 世界书触发内容:', triggeredContent);
        }

        // ★ 3. 构建上下文数据
        const contextWithoutBody = contextElements.length > 1 ? contextElements.slice(0, -1) : [];

        // 条目触发文本：用户需求 + 正文
        const entryTriggerTextParts = [];
        if (demandText) entryTriggerTextParts.push(demandText);
        if (nowtxt) entryTriggerTextParts.push(nowtxt);
        const entryTriggerText = entryTriggerTextParts.join('\n');

        // 角色触发文本：用户需求 + 完整上下文 + 世界书触发
        const characterTriggerTextParts = [];
        if (demandText) characterTriggerTextParts.push(demandText);
        if (contextElements.length > 0) characterTriggerTextParts.push(contextElements.join('\n'));
        if (triggeredContent) characterTriggerTextParts.push(triggeredContent);
        const characterTriggerText = characterTriggerTextParts.join('\n');

        // ★ 4. 构建 prompt 模板
        setStatus(statusEl, '正在获取预设提示词...');
        // 根据生成类型选择不同的请求类型
        const requestType = generationType === 'user' ? 'user_persona_gen' : 'persona_gen';
        let prompt = buildPromptForRequestType(requestType, entryTriggerText);
        if (!prompt || prompt.length === 0) {
            const typeName = generationType === 'user' ? 'User 人设生成' : '人设生成';
            throw new Error(`未能获取到提示词，请检查 LLM 设置中"${typeName}"的上下文预设配置`);
        }

        // ★ 5. 生成角色列表
        const characterListText = generateCharacterListText(characterTriggerText);
        const outfitEnableListText = generateOutfitEnableListText();
        const commonCharacterListText = generateCommonCharacterListText();

        const stContext = getContext();
        const variables = stContext.chatMetadata?.variables || {};

        // ★ 6. 合并相邻消息
        prompt = mergeAdjacentMessages(prompt, getMergeOptionsForRequestType('persona_gen'));

        // ★ 7. 构建用户需求（含输出格式说明）
        const userDemandParts = [];
        if (demandText) userDemandParts.push(demandText);
        if (extraContext && extraContext !== nowtxt) userDemandParts.push(`【参考消息】\n${extraContext}`);
        userDemandParts.push(buildOutputFormatText());
        const fullUserDemand = userDemandParts.join('\n\n');

        // ★ 8. 替换所有占位符
        const floorContext = await buildFloorContext(); // 获取楼层信息（异步，从原始聊天数据获取）
        const contextData = {
            context: contextWithoutBody.join('\n'),
            body: nowtxt,
            worldBookContent: triggeredContent,
            variables: variables,
            userDemand: fullUserDemand,
            characterListText,
            outfitEnableListText,
            commonCharacterListText,
            floorContext, // 添加楼层信息
        };
        const { messages: processedMessages, replacedVariables } = await replaceAllPlaceholders(prompt, contextData);
        prompt = processedMessages;
        console.log('[PersonaGen] 占位符替换完成，已替换:', [...replacedVariables].join(', '));

        // ★ 9. 附加参考图片
        if (referenceImages && referenceImages.length > 0) {
            const userMsgIdx = findLastUserMessageIndex(prompt);
            if (userMsgIdx >= 0) {
                prompt = attachImagesToMessage(prompt, userMsgIdx, referenceImages, '参考图片');
            }
        }

        // 更新调试显示
        let diagnosticText = '';
        if (replacedVariables.size > 0) {
            diagnosticText = `诊断：检测到以下变量被使用：${[...replacedVariables].join('、')}\n`;
        }
        updateCombinedPrompt(prompt, diagnosticText);

        // ★ 10. 检查正则测试模式
        const isRegexTestMode = extension_settings[extensionName]?.regexTestMode ?? false;
        if (isRegexTestMode) {
            setStatus(statusEl, '🧪 正则测试模式：已停止 LLM 请求，仅展示 Prompt');
            console.log('[PersonaGen] 正则测试模式 - LLM 请求已跳过');

            // 自动关闭正则测试模式（一次性消耗）
            extension_settings[extensionName].regexTestMode = false;
            $('#ch-regex-test-mode').prop('checked', false);
            console.log('[PersonaGen] 正则测试模式已自动关闭（一次性触发）');

            if (btnEl) btnEl.disabled = false;
            return;
        }

        // ★ 11. 执行 LLM 请求
        setStatus(statusEl, '正在调用 LLM 生成人设...');
        // 根据生成类型选择不同的 LLM 请求函数
        const llmResult = generationType === 'user'
            ? await LLM_USER_PERSONA_GEN(prompt, { timeoutMs: 300000 })
            : await LLM_PERSONA_GEN(prompt, { timeoutMs: 300000 });
        const rawOutput = llmResult.result;
        if (!rawOutput) throw new Error('LLM 返回为空');

        setStatus(statusEl, '正在解析结果...');
        const personaData = parsePersonaGenOutput(rawOutput);
        if (!personaData) {
            console.error('[PersonaGen] 原始输出:', rawOutput);
            throw new Error('无法从 LLM 输出中解析出有效的人设 JSON');
        }

        populatePersonaFields(personaData);
        const charName = personaData.name || personaData['角色名'] || personaData['名字'] || '新角色';
        const typeLabel = generationType === 'user' ? 'User 人设' : '人设';
        setStatus(statusEl, `✅ ${typeLabel}生成完成！`);
        showToast(`✅ ${typeLabel}「${charName}」生成完成，已录入预设`, 'success', 5000);
        setTimeout(() => setStatus(statusEl, ''), 3000);
    } catch (error) {
        console.error('[PersonaGen] 生成失败:', error);
        setStatus(statusEl, `❌ 生成失败: ${error.message}`);
        const failLabel = generationType === 'user' ? 'User 人设' : '人设';
        showToast(`❌ ${failLabel}生成失败: ${error.message}`, 'error', 5000);
    } finally {
        if (btnEl) btnEl.disabled = false;
    }
}

// ===================== LLM 事件请求 =====================

/**
 * 通过事件系统执行人设生成 LLM 请求（参考 LLM_CHAR_DESIGN）
 * @param {Array} prompt - 消息数组
 * @param {Object} options - 选项
 * @returns {Promise<{result: string, testMode: boolean}>}
 */
function LLM_PERSONA_GEN(prompt, options = {}) {
    return new Promise((resolve, reject) => {
        const requestId = generateRequestId();
        const timeoutMs = options.timeoutMs || 60000;
        let timeoutTimer = null;

        console.log(`[PersonaGen] Executing LLM request (ID: ${requestId})`);

        const cleanup = () => {
            eventSource.removeListener(eventNames.LLM_PERSONA_GEN_RESPONSE, handler);
            if (timeoutTimer) {
                clearTimeout(timeoutTimer);
                timeoutTimer = null;
            }
        };

        const handler = (responseData) => {
            if (responseData.id !== requestId) return;
            cleanup();
            if (responseData.success) {
                resolve({ result: responseData.result, testMode: !!responseData.testMode });
            } else {
                reject(new Error(responseData.result || 'LLM 请求失败'));
            }
        };

        eventSource.on(eventNames.LLM_PERSONA_GEN_RESPONSE, handler);
        eventSource.emit(eventNames.LLM_PERSONA_GEN_REQUEST, { prompt, id: requestId });

        timeoutTimer = setTimeout(() => {
            cleanup();
            reject(new Error('人设生成 LLM 请求超时'));
        }, timeoutMs);
    });
}

/**
 * 通过事件系统执行 User 人设生成 LLM 请求
 * @param {Array} prompt - 消息数组
 * @param {Object} options - 选项
 * @returns {Promise<{result: string, testMode: boolean}>}
 */
function LLM_USER_PERSONA_GEN(prompt, options = {}) {
    return new Promise((resolve, reject) => {
        const requestId = generateRequestId();
        const timeoutMs = options.timeoutMs || 60000;
        let timeoutTimer = null;

        console.log(`[PersonaGen] Executing User LLM request (ID: ${requestId})`);

        const cleanup = () => {
            eventSource.removeListener(eventNames.LLM_USER_PERSONA_GEN_RESPONSE, handler);
            if (timeoutTimer) {
                clearTimeout(timeoutTimer);
                timeoutTimer = null;
            }
        };

        const handler = (responseData) => {
            if (responseData.id !== requestId) return;
            cleanup();
            if (responseData.success) {
                resolve({ result: responseData.result, testMode: !!responseData.testMode });
            } else {
                reject(new Error(responseData.result || 'User 人设生成 LLM 请求失败'));
            }
        };

        eventSource.on(eventNames.LLM_USER_PERSONA_GEN_RESPONSE, handler);
        eventSource.emit(eventNames.LLM_USER_PERSONA_GEN_REQUEST, { prompt, id: requestId });

        timeoutTimer = setTimeout(() => {
            cleanup();
            reject(new Error('User 人设生成 LLM 请求超时'));
        }, timeoutMs);
    });
}

// ===================== 输出解析 =====================

/**
 * 解析 LLM 输出的人设 JSON 数据
 * @param {string} rawOutput - LLM 原始输出
 * @returns {Object|null} 解析后的人设数据，失败返回 null
 */
function parsePersonaGenOutput(rawOutput) {
    try {
        // 尝试从 markdown 代码块中提取 JSON
        let jsonStr = rawOutput;
        const codeBlockMatch = rawOutput.match(/```(?:json)?\s*\n?([\s\S]*?)```/);
        if (codeBlockMatch) {
            jsonStr = codeBlockMatch[1].trim();
        }

        const parsed = JSON.parse(jsonStr);

        // 支持 chatu8_persona_profile 格式
        if (parsed.type === 'chatu8_persona_profile' && parsed.data) {
            const characterNames = Object.keys(parsed.data);
            if (characterNames.length > 0) {
                const firstCharData = parsed.data[characterNames[0]];
                return { name: characterNames[0], ...firstCharData };
            }
        }

        // 直接返回 parsed 如果包含人设字段
        if (parsed && typeof parsed === 'object') {
            return parsed;
        }

        return null;
    } catch (e) {
        console.error('[PersonaGen] JSON 解析失败:', e);

        // 尝试宽松解析：查找第一个 { 到最后一个 }
        try {
            const firstBrace = rawOutput.indexOf('{');
            const lastBrace = rawOutput.lastIndexOf('}');
            if (firstBrace >= 0 && lastBrace > firstBrace) {
                const jsonStr = rawOutput.substring(firstBrace, lastBrace + 1);
                const parsed = JSON.parse(jsonStr);
                if (parsed.type === 'chatu8_persona_profile' && parsed.data) {
                    const characterNames = Object.keys(parsed.data);
                    if (characterNames.length > 0) {
                        return { name: characterNames[0], ...parsed.data[characterNames[0]] };
                    }
                }
                return parsed;
            }
        } catch (e2) {
            console.error('[PersonaGen] 宽松解析也失败:', e2);
        }
        return null;
    }
}

// ===================== UI 填充 =====================

/**
 * 将生成的人设数据填充到界面字段中
 * @param {Object} personaData - 人设数据对象
 */
function populatePersonaFields(personaData) {
    if (!personaData) return;
    console.log('[PersonaGen] 填充人设数据:', personaData);

    // 如果有角色名，创建新的预设
    const charName = personaData.name || personaData['角色名'] || personaData['名字'] || '新角色';

    // 尝试创建预设（如果函数可用）
    try {
        createPersonaPreset(charName, personaData);
    } catch (e) {
        console.warn('[PersonaGen] 创建预设失败，尝试直接填充:', e);
    }

    // 直接填充各字段
    for (const field of PERSONA_FIELDS) {
        const value = personaData[field];
        if (value !== undefined && value !== null) {
            const inputEl = document.querySelector(`[data-persona-field="${field}"]`)
                || document.getElementById(`ch-persona-${field}`);
            if (inputEl) {
                if (inputEl.tagName === 'TEXTAREA' || inputEl.tagName === 'INPUT') {
                    inputEl.value = String(value);
                    inputEl.dispatchEvent(new Event('input', { bubbles: true }));
                }
            }
        }
    }
}

// ===================== 管理页面绑定 =====================

/**
 * 绑定管理页面的人设生成按钮
 */
function bindPersonaGenButton() {
    const btn = document.getElementById('ch-persona-gen-btn');
    if (!btn) return;

    btn.addEventListener('click', async () => {
        console.log('[PersonaGen] 管理页面触发人设生成');

        // 获取生成类型
        const typeSelect = document.getElementById('ch-persona-gen-type');
        const generationType = typeSelect?.value || 'character';

        console.log('[PersonaGen] 生成类型:', generationType);

        // 传递生成类型参数
        await handlePersonaGenRequest(
            null,
            '',
            undefined,
            [...managementPageImages],
            generationType
        );
    });
}

/**
 * 绑定管理页面的参考图片上传
 */
function bindManagementPageImageUpload() {
    const uploadBtn = document.getElementById('ch-persona-gen-upload-btn');
    const fileInput = document.getElementById('ch-persona-gen-upload-input');
    const previewContainer = document.getElementById('ch-persona-gen-preview');

    if (uploadBtn && fileInput) {
        uploadBtn.addEventListener('click', () => fileInput.click());
        fileInput.addEventListener('change', async (e) => {
            const files = e.target.files;
            if (!files || files.length === 0) return;
            for (const file of files) {
                if (!file.type.startsWith('image/')) continue;
                try {
                    const base64 = await readFileAsBase64(file);
                    managementPageImages.push({ base64, name: file.name });
                } catch (err) {
                    console.error('[PersonaGen] 读取图片失败:', err);
                }
            }
            updateManagementImagePreview(previewContainer);
            fileInput.value = '';
        });
    }

    // 清除按钮
    const clearBtn = document.getElementById('ch-persona-gen-clear-images');
    if (clearBtn) {
        clearBtn.addEventListener('click', () => {
            managementPageImages = [];
            updateManagementImagePreview(previewContainer);
        });
    }
}

function updateManagementImagePreview(container) {
    if (!container) return;
    container.innerHTML = '';
    if (managementPageImages.length === 0) {
        const emptyHint = document.createElement('div');
        emptyHint.className = 'ch-persona-gen-empty-hint';
        emptyHint.textContent = '点击上方按钮添加参考图片，AI 将根据图片内容辅助生成人设';
        container.appendChild(emptyHint);
        return;
    }
    managementPageImages.forEach((imgObj, idx) => {
        const wrapper = document.createElement('div');
        wrapper.style.cssText = 'display:inline-block;margin:4px;position:relative;';
        const img = document.createElement('img');
        img.src = imgObj.base64;
        img.style.cssText = 'width:60px;height:60px;object-fit:cover;border-radius:4px;';
        const delBtn = document.createElement('button');
        delBtn.textContent = '×';
        delBtn.style.cssText = 'position:absolute;top:-4px;right:-4px;background:red;color:white;border:none;border-radius:50%;width:16px;height:16px;font-size:10px;cursor:pointer;line-height:16px;padding:0;';
        delBtn.addEventListener('click', () => {
            managementPageImages.splice(idx, 1);
            updateManagementImagePreview(container);
        });
        wrapper.appendChild(img);
        wrapper.appendChild(delBtn);
        container.appendChild(wrapper);
    });
}

// ===================== 弹窗 UI =====================

/**
 * 显示生成类型选择弹窗
 * @returns {Promise<'character'|'user'|null>}
 */
function showTypeSelectionPopup() {
    return new Promise((resolve) => {
        // 移动端检测和定位计算（参考 promptReq.js 的 showUserDemandPopup）
        const isMobile = isMobileDevice();
        let topOffset = 10;
        let maxHeight = 'none';
        if (isMobile) {
            const topSettingsHolder = document.querySelector('#top-settings-holder');
            if (topSettingsHolder) {
                const rect = topSettingsHolder.getBoundingClientRect();
                // 确保 topOffset 在有效范围内（最小10px，最大不超过视口高度的一半）
                topOffset = Math.max(10, Math.min(rect.bottom + 10, window.innerHeight * 0.5));
            }
            // 计算可用高度，确保至少有 200px 的高度
            const availableHeight = Math.max(200, window.innerHeight - topOffset - 20);
            maxHeight = `${availableHeight}px`;
        }

        const overlay = document.createElement('div');
        overlay.className = 'st-chatu8-popup-overlay';

        const bubble = document.createElement('div');
        bubble.className = 'st-chatu8-popup-bubble';
        bubble.style.maxWidth = '400px';
        if (isMobile) {
            bubble.classList.add('mobile');
            bubble.style.top = `${topOffset}px`;
            bubble.style.maxHeight = maxHeight;
        }

        const title = document.createElement('div');
        title.className = 'st-chatu8-popup-title';
        title.textContent = '选择生成类型';
        bubble.appendChild(title);

        const hint = document.createElement('div');
        hint.className = 'st-chatu8-popup-hint';
        hint.textContent = '请选择要生成的人设类型：';
        bubble.appendChild(hint);

        const buttons = document.createElement('div');
        buttons.className = 'st-chatu8-popup-buttons';
        buttons.style.flexDirection = 'column';
        buttons.style.gap = '8px';

        const characterBtn = document.createElement('button');
        characterBtn.className = 'st-chatu8-popup-btn-confirm';
        characterBtn.innerHTML = '🎭 角色人设<br><small>包含次元穿越设定</small>';
        characterBtn.style.padding = '12px';
        buttons.appendChild(characterBtn);

        const userBtn = document.createElement('button');
        userBtn.className = 'st-chatu8-popup-btn-confirm';
        userBtn.innerHTML = '👤 User 人设<br><small>不包含穿越设定</small>';
        userBtn.style.padding = '12px';
        buttons.appendChild(userBtn);

        const cancelBtn = document.createElement('button');
        cancelBtn.className = 'st-chatu8-popup-btn-cancel';
        cancelBtn.textContent = '取消';
        buttons.appendChild(cancelBtn);

        bubble.appendChild(buttons);
        overlay.appendChild(bubble);
        document.body.appendChild(overlay);

        function closePopup(result) {
            overlay.remove();
            resolve(result);
        }

        characterBtn.addEventListener('click', () => closePopup('character'));
        userBtn.addEventListener('click', () => closePopup('user'));
        cancelBtn.addEventListener('click', () => closePopup(null));
        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) closePopup(null);
        });
    });
}

/**
 * 显示人设生成需求输入弹窗（含图片上传功能）
 * @param {string} messagePreview - 消息文本预览
 * @param {string} generationType - 生成类型：'character' 或 'user'
 * @returns {Promise<{text: string, images: Array, type: string}|null>}
 */
function showPersonaGenDemandPopup(messagePreview, generationType = 'character') {
    return new Promise((resolve) => {
        const uploadedImages = [];

        // 移动端检测和定位计算（参考 promptReq.js 的 showUserDemandPopup）
        const isMobile = isMobileDevice();
        let topOffset = 10;
        let maxHeight = 'none';
        if (isMobile) {
            const topSettingsHolder = document.querySelector('#top-settings-holder');
            if (topSettingsHolder) {
                const rect = topSettingsHolder.getBoundingClientRect();
                // 确保 topOffset 在有效范围内（最小10px，最大不超过视口高度的一半）
                topOffset = Math.max(10, Math.min(rect.bottom + 10, window.innerHeight * 0.5));
            }
            // 计算可用高度，确保至少有 200px 的高度
            const availableHeight = Math.max(200, window.innerHeight - topOffset - 20);
            maxHeight = `${availableHeight}px`;
        }

        const overlay = document.createElement('div');
        overlay.className = 'st-chatu8-popup-overlay';

        const bubble = document.createElement('div');
        bubble.className = 'st-chatu8-popup-bubble';
        if (isMobile) {
            bubble.classList.add('mobile');
            bubble.style.top = `${topOffset}px`;
            bubble.style.maxHeight = maxHeight;
        }

        // 标题根据类型调整
        const title = document.createElement('div');
        title.className = 'st-chatu8-popup-title';
        title.textContent = generationType === 'user' ? 'User 人设生成' : '角色人设生成';
        bubble.appendChild(title);

        // 提示根据类型调整
        const hint = document.createElement('div');
        hint.className = 'st-chatu8-popup-hint';
        hint.textContent = generationType === 'user'
            ? '请输入 User 人设生成需求（可选），留空则根据上下文自动生成'
            : '请输入角色人设生成需求（可选），留空则根据角色卡信息自动生成';
        bubble.appendChild(hint);

        // 参考消息预览
        if (messagePreview) {
            const preview = document.createElement('div');
            preview.className = 'st-chatu8-popup-hint';
            preview.style.cssText = 'font-size:12px;opacity:0.6;margin-bottom:8px;max-height:60px;overflow:hidden;text-overflow:ellipsis;';
            preview.textContent = `📝 参考消息: ${messagePreview.substring(0, 100)}${messagePreview.length > 100 ? '...' : ''}`;
            bubble.appendChild(preview);
        }

        // 需求输入框
        const textarea = document.createElement('textarea');
        textarea.className = 'st-chatu8-popup-textarea';
        textarea.placeholder = '例如：生成一个温柔的猫娘角色人设，性格害羞但内心善良...';
        textarea.style.minHeight = '100px';
        bubble.appendChild(textarea);

        // 图片上传区域
        const imageSection = document.createElement('div');
        imageSection.className = 'st-chatu8-popup-upload-section';

        const uploadHeader = document.createElement('div');
        uploadHeader.className = 'st-chatu8-popup-upload-header';

        const uploadLabel = document.createElement('span');
        uploadLabel.textContent = '📎 参考图片（可选）';
        uploadLabel.className = 'st-chatu8-popup-upload-label';

        const fileInput = document.createElement('input');
        fileInput.type = 'file';
        fileInput.accept = 'image/*';
        fileInput.multiple = true;
        fileInput.style.display = 'none';

        const uploadBtn = document.createElement('button');
        uploadBtn.type = 'button';
        uploadBtn.innerHTML = '<i class="fa-solid fa-plus"></i> 添加图片';
        uploadBtn.className = 'st-chatu8-popup-upload-btn';
        uploadBtn.addEventListener('click', () => fileInput.click());

        uploadHeader.appendChild(uploadLabel);
        uploadHeader.appendChild(uploadBtn);

        const imagePreviewContainer = document.createElement('div');
        imagePreviewContainer.className = 'st-chatu8-popup-preview-container';

        const emptyHint = document.createElement('div');
        emptyHint.textContent = '点击上方按钮添加参考图片';
        emptyHint.className = 'st-chatu8-popup-empty-hint';
        imagePreviewContainer.appendChild(emptyHint);

        function updateImagePreviews() {
            imagePreviewContainer.innerHTML = '';
            if (uploadedImages.length === 0) {
                const h = document.createElement('div');
                h.textContent = '点击上方按钮添加参考图片';
                h.className = 'st-chatu8-popup-empty-hint';
                imagePreviewContainer.appendChild(h);
                return;
            }
            uploadedImages.forEach((imgObj, index) => {
                const itemContainer = document.createElement('div');
                itemContainer.className = 'st-chatu8-popup-img-item';

                const imgWrapper = document.createElement('div');
                imgWrapper.className = 'st-chatu8-popup-img-wrapper';
                const img = document.createElement('img');
                img.src = imgObj.base64;
                const deleteBtn = document.createElement('button');
                deleteBtn.type = 'button';
                deleteBtn.innerHTML = '×';
                deleteBtn.className = 'st-chatu8-popup-img-delete';
                deleteBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    uploadedImages.splice(index, 1);
                    updateImagePreviews();
                });
                imgWrapper.appendChild(img);
                imgWrapper.appendChild(deleteBtn);

                const nameInput = document.createElement('input');
                nameInput.type = 'text';
                nameInput.placeholder = `图${index + 1}`;
                nameInput.value = imgObj.name || '';
                nameInput.className = 'st-chatu8-popup-img-name';
                nameInput.addEventListener('input', (e) => {
                    uploadedImages[index].name = e.target.value;
                });

                itemContainer.appendChild(imgWrapper);
                itemContainer.appendChild(nameInput);
                imagePreviewContainer.appendChild(itemContainer);
            });

            const countLabel = document.createElement('div');
            countLabel.textContent = `已添加 ${uploadedImages.length} 张图片`;
            countLabel.className = 'st-chatu8-popup-img-count';
            imagePreviewContainer.appendChild(countLabel);
        }

        fileInput.addEventListener('change', async (e) => {
            const files = e.target.files;
            if (!files || files.length === 0) return;
            for (const file of files) {
                if (!file.type.startsWith('image/')) continue;
                try {
                    const base64 = await readFileAsBase64(file);
                    uploadedImages.push({ base64, name: '' });
                } catch (err) {
                    console.error('[PersonaGen] 读取图片失败:', err);
                }
            }
            updateImagePreviews();
            fileInput.value = '';
        });

        imageSection.appendChild(uploadHeader);
        imageSection.appendChild(fileInput);
        imageSection.appendChild(imagePreviewContainer);
        bubble.appendChild(imageSection);

        // 按钮
        const buttons = document.createElement('div');
        buttons.className = 'st-chatu8-popup-buttons';

        const cancelBtn = document.createElement('button');
        cancelBtn.className = 'st-chatu8-popup-btn-cancel';
        cancelBtn.textContent = '取消';
        buttons.appendChild(cancelBtn);

        const confirmBtn = document.createElement('button');
        confirmBtn.className = 'st-chatu8-popup-btn-confirm';
        confirmBtn.textContent = '开始生成';
        buttons.appendChild(confirmBtn);

        bubble.appendChild(buttons);
        overlay.appendChild(bubble);
        document.body.appendChild(overlay);

        setTimeout(() => textarea.focus(), 100);

        function closePopup(result) {
            overlay.remove();
            resolve(result);
        }

        cancelBtn.addEventListener('click', () => closePopup(null));
        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) closePopup(null);
        });
        confirmBtn.addEventListener('click', () => {
            closePopup({
                text: textarea.value.trim(),
                images: [...uploadedImages],
                type: generationType
            });
        });
        textarea.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                closePopup({
                    text: textarea.value.trim(),
                    images: [...uploadedImages],
                    type: generationType
                });
            }
            if (e.key === 'Escape') closePopup(null);
        });
    });
}

// ===================== 辅助函数 =====================

/**
 * 构建输出格式说明文本
 */
function buildOutputFormatText() {
    const fieldList = PERSONA_FIELDS.map(f => `- ${f}: ${PERSONA_FIELD_LABELS[f] || f}`).join('\n');
    return `【输出要求】\n请以 JSON 格式输出角色人设数据。支持以下字段：\n${fieldList}\n\n请输出如下格式：\n\`\`\`json\n{\n    "type": "chatu8_persona_profile",\n    "version": "1.0",\n    "data": {\n        "角色名": {\n            ${PERSONA_FIELDS.map(f => `"${f}": "..."`).join(',\n            ')}\n        }\n    }\n}\n\`\`\``;
}

/**
 * 查找最后一条 user 角色消息的索引
 */
function findLastUserMessageIndex(messages) {
    for (let i = messages.length - 1; i >= 0; i--) {
        if (messages[i].role === 'user') return i;
    }
    return -1;
}

/**
 * 将图片附加到消息中（OpenAI 多模态格式）
 */
function attachImagesToMessage(messages, messageIndex, images, imageLabel = '参考图片') {
    if (!images || images.length === 0 || messageIndex < 0 || messageIndex >= messages.length) return messages;
    const result = [...messages];
    const targetMsg = result[messageIndex];
    const contentParts = [];

    if (typeof targetMsg.content === 'string') {
        contentParts.push({ type: 'text', text: targetMsg.content });
    } else if (Array.isArray(targetMsg.content)) {
        contentParts.push(...targetMsg.content);
    }

    if (images.length > 0) {
        contentParts.push({ type: 'text', text: `\n[以下是用户上传的${images.length}张${imageLabel}]` });
    }

    images.forEach((imgItem, idx) => {
        const imgBase64 = typeof imgItem === 'string' ? imgItem : imgItem.base64;
        const imgName = typeof imgItem === 'object' && imgItem.name ? imgItem.name : `${imageLabel}${idx + 1}`;
        contentParts.push({ type: 'text', text: `[${imgName}]` });
        let imageUrl = imgBase64;
        if (!imgBase64.startsWith('data:')) imageUrl = `data:image/png;base64,${imgBase64}`;
        contentParts.push({ type: 'image_url', image_url: { url: imageUrl, detail: 'auto' } });
    });

    result[messageIndex] = { ...targetMsg, content: contentParts };
    return result;
}

/**
 * 设置状态文本
 */
function setStatus(el, text) {
    if (el) el.textContent = text;
}

/**
 * 提取元素的可见文本内容（排除 style/script 标签）
 */
function getVisibleTextContent(el) {
    if (!el) return '';
    const clone = el.cloneNode(true);
    clone.querySelectorAll('style, script').forEach(s => s.remove());
    return clone.textContent || '';
}

/**
 * 读取文件为 base64
 */
function readFileAsBase64(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(file);
    });
}
