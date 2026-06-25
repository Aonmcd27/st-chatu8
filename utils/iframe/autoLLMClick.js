// @ts-nocheck
/**
 * autoLLMClick.js - 自动LLM请求生图点击模块
 * 模仿 window.zidongdianji 的事件触发逻辑，但不包含消息滑动触发
 * 用于实现 config 中的 autoLLMImageGen 自动LLM请求生图功能
 */

import { eventSource, event_types } from "../../../../../../script.js";
import { extension_settings } from "../../../../../extensions.js";
import { extensionName } from '../config.js';
import { getContext } from "../../../../../st-context.js";
import { handlePromptRequest } from '../promptReq.js';
import { debugLog, debugBranch, debugTimer, debugStartSession, debugContent, debugElement, debugMilestone } from '../debugLogger.js';

// 全局变量
let autoLLMClickTimer = null;
window.autoLLMClick = false;

// 生成开始时记录的数据，供 GENERATION_ENDED 使用
let generationStartChatLength = 0;
let generationStartSwipesLength = 0;

/**
 * 检查插件是否开启（兼容 boolean 和字符串类型）
 * @returns {boolean}
 */
function isPluginEnabled() {
    const scriptEnabled = extension_settings[extensionName]?.scriptEnabled;
    const enabled = scriptEnabled === true || scriptEnabled === "true";
    debugLog('autoLLMClick.isPluginEnabled', '检查插件是否启用', {
        scriptEnabled: scriptEnabled,
        结果: enabled
    });
    return enabled;
}

/**
 * 检查是否启用了自动LLM请求生图功能
 * 需要同时满足：插件已开启 且 autoLLMImageGen 已开启
 * @returns {boolean}
 */
function isAutoLLMEnabled() {
    if (!isPluginEnabled()) {
        debugBranch('autoLLMClick.isAutoLLMEnabled', '插件未启用', true, {
            条件: 'isPluginEnabled()'
        });
        return false;
    }
    const autoLLMImageGen = extension_settings[extensionName]?.autoLLMImageGen;
    const enabled = autoLLMImageGen === true || autoLLMImageGen === "true";
    debugLog('autoLLMClick.isAutoLLMEnabled', '检查自动LLM生图是否启用', {
        autoLLMImageGen: autoLLMImageGen,
        结果: enabled
    });
    return enabled;
}

/**
 * 查找真实的 mes_text 元素
 * 等待 100ms 后再查找，确保 DOM 已渲染完成
 * @param {number} messageId - 消息 ID
 * @returns {Promise<HTMLElement|null>} mes_text 元素或 null
 */
async function findElement(messageId) {
    const timer = debugTimer('autoLLMClick.findElement', '查找目标元素');

    // 非阻塞等待 100ms，让页面完成渲染
    await new Promise(resolve => setTimeout(resolve, 1000));

    // 查找真实的 DOM 元素
    const realMesText = document.querySelector(`div.mes[mesid="${messageId}"] .mes_text`);

    if (realMesText) {
        console.log('[st-chatu8] Found real mes_text element for messageId:', messageId);
        debugBranch('autoLLMClick.findElement', '找到真实DOM元素', true, {
            messageId: messageId
        });
        debugElement('autoLLMClick.findElement', '真实mes_text元素', realMesText);
        timer.end('找到真实元素');
        return realMesText;
    }

    // 找不到真实元素，返回 null
    console.log('[st-chatu8] Real mes_text not found for messageId:', messageId);
    debugBranch('autoLLMClick.findElement', '未找到DOM元素', false, {
        messageId: messageId
    });
    timer.end('未找到元素');
    return null;
}

/**
 * 激活自动LLM点击状态
 */
function activateAutoLLMClick() {
    debugLog('autoLLMClick.activateAutoLLMClick', '尝试激活自动LLM点击状态');

    if (!isAutoLLMEnabled()) {
        debugBranch('autoLLMClick.activateAutoLLMClick', '自动LLM未启用-跳过激活', true);
        return;
    }

    window.autoLLMClick = true;
    debugLog('autoLLMClick.activateAutoLLMClick', '已设置 window.autoLLMClick = true');

    // 清除之前的定时器
    if (autoLLMClickTimer) {
        clearTimeout(autoLLMClickTimer);
        debugLog('autoLLMClick.activateAutoLLMClick', '清除之前的定时器');
    }

    // 5秒后自动关闭（除非 zidongdianji2 为 true 保持常开）
    autoLLMClickTimer = setTimeout(() => {
        window.autoLLMClick = false;
        autoLLMClickTimer = null;
        debugLog('autoLLMClick.activateAutoLLMClick', '5秒超时 - 自动关闭 autoLLMClick');
    }, 8000);

    debugMilestone('autoLLMClick.activateAutoLLMClick', '自动LLM点击状态已激活，5秒后自动关闭');
}

// 事件监听：生成开始
eventSource.on(event_types.GENERATION_STARTED, (data) => {
    console.log('[st-chatu8] GENERATION_STARTED data:', data);

    // 开始新的调试会话
    debugStartSession('自动LLM图片生成');
    debugLog('autoLLMClick.GENERATION_STARTED', 'LLM生成开始事件触发', {
        eventData: data
    });

    const context = getContext();
    const chat = context?.chat;

    if (chat && chat.length > 0) {
        generationStartChatLength = chat.length;
        const lastMessage = chat[generationStartChatLength - 1];
        generationStartSwipesLength = lastMessage?.swipes?.length || 0;

        console.log('[st-chatu8] Chat array length:', generationStartChatLength);
        console.log('[st-chatu8] Last message swipes length:', generationStartSwipesLength);

        debugLog('autoLLMClick.GENERATION_STARTED', '记录生成开始时的状态', {
            chatLength: generationStartChatLength,
            swipesLength: generationStartSwipesLength
        });
    } else {
        generationStartChatLength = 0;
        generationStartSwipesLength = 0;
        console.log('[st-chatu8] Chat array is empty or not available');

        debugBranch('autoLLMClick.GENERATION_STARTED', 'Chat为空', true, {
            chatExists: !!chat,
            chatLength: chat?.length
        });
    }
});

// 事件监听：生成结束
eventSource.on(event_types.GENERATION_ENDED, async (data) => {
    const timer = debugTimer('autoLLMClick.GENERATION_ENDED', '处理LLM生成结束事件');

    console.log('[st-chatu8] GENERATION_ENDED data:', data);
    console.log('[st-chatu8] Start chat length:', generationStartChatLength, 'Start swipes length:', generationStartSwipesLength);

    debugLog('autoLLMClick.GENERATION_ENDED', 'LLM生成结束事件触发', {
        eventData: data,
        startChatLength: generationStartChatLength,
        startSwipesLength: generationStartSwipesLength
    });

    // 重新获取当前 chat 和 swipes 长度
    const context = getContext();
    const chat = context?.chat;
    const currentChatLength = chat?.length || 0;
    const currentLastMessage = chat && chat.length > 0 ? chat[chat.length - 1] : null;
    const currentSwipesLength = currentLastMessage?.swipes?.length || 0;

    console.log('[st-chatu8] Current chat length:', currentChatLength, 'Current swipes length:', currentSwipesLength);

    debugLog('autoLLMClick.GENERATION_ENDED', '获取当前状态', {
        currentChatLength: currentChatLength,
        currentSwipesLength: currentSwipesLength
    });

    // 判断 chat 数组是否增加
    const isChatIncreased = currentChatLength > generationStartChatLength;

    // 只有当 chat 长度不变时，才检查 swipes 是否增加（比较的是同一条消息）
    // swipes 可能为 undefined/null/空数组，用 || 0 处理
    const isSwipesIncreased = !isChatIncreased && currentSwipesLength > generationStartSwipesLength;

    console.log('[st-chatu8] Chat increased:', isChatIncreased, 'Swipes increased:', isSwipesIncreased);

    debugBranch('autoLLMClick.GENERATION_ENDED', 'Chat或Swipes变化检测', isChatIncreased || isSwipesIncreased, {
        isChatIncreased: isChatIncreased,
        isSwipesIncreased: isSwipesIncreased,
        chatDelta: currentChatLength - generationStartChatLength,
        swipesDelta: currentSwipesLength - generationStartSwipesLength
    });

    // 如果 chat 没有增加 且 swipes 也没有增加，则跳过
    if (!isChatIncreased && !isSwipesIncreased) {
        console.log('[st-chatu8] No chat or swipes increase detected, skipping');
        debugLog('autoLLMClick.GENERATION_ENDED', '无变化 - 跳过处理', {
            原因: 'Chat和Swipes均未增加'
        });
        timer.end('跳过 - 无变化');
        return;
    }

    // 检查是否启用自动 LLM 请求生图
    if (!isAutoLLMEnabled()) {
        console.log('[st-chatu8] autoLLMImageGen is disabled, skipping');
        debugBranch('autoLLMClick.GENERATION_ENDED', '自动LLM生图未启用', true, {
            条件: 'isAutoLLMEnabled()'
        });
        timer.end('跳过 - 功能未启用');
        return;
    }

    // data 就是消息索引，-1 后为实际的消息 id
    const messageId = data - 1;
    debugLog('autoLLMClick.GENERATION_ENDED', '计算消息ID', {
        eventData: data,
        messageId: messageId
    });

    if (messageId >= 0) {
        const context = getContext();
        const chat = context?.chat;

        if (chat && chat[messageId]) {
            const messageContent = chat[messageId].mes;
            console.log('[st-chatu8] Message ID:', messageId);
            console.log('[st-chatu8] Message content:', messageContent);

            debugContent('autoLLMClick.GENERATION_ENDED', '消息内容', messageContent, 300);

            // 检查消息内容长度，必须大于 200 才继续
            if (!messageContent || messageContent.length <= 200) {
                console.log('[st-chatu8] Message content too short (<=200), skipping. Length:', messageContent?.length || 0);
                debugBranch('autoLLMClick.GENERATION_ENDED', '消息长度检查', false, {
                    条件: 'messageContent.length > 200',
                    实际长度: messageContent?.length || 0,
                    要求: '> 200'
                });
                timer.end('跳过 - 消息过短');
                return;
            }

            debugBranch('autoLLMClick.GENERATION_ENDED', '消息长度检查通过', true, {
                消息长度: messageContent.length
            });

            // 消息大于200时，自动开启"插入原文(非同层)"开关
            if (extension_settings[extensionName]?.insertOriginalText !== 'true') {
                extension_settings[extensionName].insertOriginalText = 'true';
                console.log('[st-chatu8] Auto-enabled insertOriginalText due to message length > 200');

                debugLog('autoLLMClick.GENERATION_ENDED', '自动启用 insertOriginalText', {
                    原因: '消息长度 > 200'
                });

                // 同步 UI 开关状态
                const insertTextSwitch = document.getElementById('insertOriginalText');
                if (insertTextSwitch) {
                    insertTextSwitch.checked = true;
                }

                // 触发正则脚本创建
                try {
                    const { saveSettingsDebounced } = await import('../../../../../../script.js');
                    saveSettingsDebounced();
                } catch (e) {
                    console.warn('[st-chatu8] Failed to save settings:', e);
                }
            }

            // 等待 100ms 后查找真实元素
            const el = await findElement(messageId);

            // 如果找不到元素，跳过处理
            if (!el) {
                console.log('[st-chatu8] Element not found for messageId:', messageId, '- skipping');
                debugBranch('autoLLMClick.GENERATION_ENDED', '元素查找失败', false, {
                    messageId: messageId,
                    原因: 'DOM元素未找到'
                });
                return;
            }

            console.log('[st-chatu8] Got element for messageId:', messageId, 'isConnected:', el.isConnected);
            debugElement('autoLLMClick.GENERATION_ENDED', '目标元素', el);

            // 调用 handlePromptRequest，手势 ID 为 "gesture1"（手势一）
            try {
                console.log('[st-chatu8] Triggering handlePromptRequest with gesture1');
                debugMilestone('autoLLMClick.GENERATION_ENDED', '开始触发 handlePromptRequest');
                debugLog('autoLLMClick.GENERATION_ENDED', '调用 handlePromptRequest', {
                    gestureId: 'gesture1',
                    messageId: messageId,
                    elementConnected: el.isConnected
                });
                handlePromptRequest(el, 'gesture1');
            } catch (error) {
                console.error('[st-chatu8] handlePromptRequest failed:', error);
                debugLog('autoLLMClick.GENERATION_ENDED', 'handlePromptRequest 调用失败', {
                    error: error.message
                });
            }
        } else {
            console.log('[st-chatu8] No message found for ID:', messageId);
            debugBranch('autoLLMClick.GENERATION_ENDED', '消息查找', false, {
                messageId: messageId,
                chatExists: !!chat,
                原因: '消息不存在'
            });
        }
    } else {
        debugBranch('autoLLMClick.GENERATION_ENDED', 'messageId有效性检查', false, {
            messageId: messageId,
            原因: 'messageId < 0'
        });
    }

    activateAutoLLMClick();
    timer.end('处理完成');
});

// 事件监听：JS 生成结束
eventSource.on("js_generation_ended", async (data) => {
    debugLog('autoLLMClick.js_generation_ended', 'JS生成结束事件触发', {
        eventData: data
    });
    activateAutoLLMClick();
});

// 注意：不包含 MESSAGE_SWIPED 事件监听，按用户要求少一个消息滑动触发

/**
 * 手动设置自动LLM点击状态
 * @param {boolean} state - 状态
 */
export function setAutoLLMClick(state) {
    window.autoLLMClick = state;
}

/**
 * 获取当前自动LLM点击状态
 * @returns {boolean}
 */
export function getAutoLLMClick() {
    return window.autoLLMClick;
}

/**
 * 初始化自动LLM点击模块
 * 可在需要时调用此函数进行初始化
 */
export function initAutoLLMClick() {
    // 模块加载时自动注册事件监听
    // 初始化时可以添加额外的逻辑
    console.log('[st-chatu8] autoLLMClick module initialized');
    debugLog('autoLLMClick.initAutoLLMClick', 'autoLLMClick 模块已初始化');
}
