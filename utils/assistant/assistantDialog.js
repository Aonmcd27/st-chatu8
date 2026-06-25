/**
 * assistantDialog.js
 * 
 * 对话框拖拽、缩放功能，以及设置面板的 UI 交互逻辑。
 * 包含：makeDraggable、makeResizable、refreshSettingsPanel、
 *       checkAndShowSettings、autoSaveSettings、设置面板事件绑定、
 *       模型获取、ASR 控件绑定等。
 */

import { dom, setRefreshSettingsPanelFn, isAiGenerating, ttsButtonState } from './assistantContext.js';
import { extensionName, eventNames } from '../config.js';
import { extension_settings } from "../../../../../extensions.js";
import { eventSource, saveSettingsDebounced } from "../../../../../../script.js";
import { getRequestHeaders } from '../utils.js';
import { systemPrompts, defaultSystemPromptKey } from '../aiPrompts.js';
import { setASREnabled, isASREnabled, getASRConfig, saveASRConfig, startConversationMode, stopConversationMode, isConversationMode, startMicTest, stopMicTest } from '../asr.js';
import { setTTSEngineType, getEdgeVoices, getEdgeVoiceStyles, pingAndRefreshServers, getQwenVoices } from '../tts.js';
import { isKnowledgeBaseEnabled, setKnowledgeBaseEnabled } from '../knowledgeBaseService.js';
import { escapeHTML } from './assistantUtils.js';
import { showSummaryPanel, hideSummaryPanel } from './assistantSummary.js';
import { getGlobalVideoPlayer, applyFabSettings } from '../ui_common.js';

// ═══════════════════════════════════════════════════════════
//  拖拽功能
// ═══════════════════════════════════════════════════════════

/**
 * 通用拖拽绑定函数（支持鼠标和触摸）
 * @param {jQuery} element - 要拖拽的元素
 * @param {jQuery} handle - 拖拽手柄
 * @param {string} excludeSelector - 排除的选择器
 * @returns {Function} 返回一个函数，调用后返回是否发生过移动
 */
export function makeDraggable(element, handle, excludeSelector) {
    let isDragging = false;
    let startClientX, startClientY;
    let startLeft, startTop;
    let hasMoved = false;
    let isInitialized = false;

    // 统一的开始拖拽处理
    function handleDragStart(clientX, clientY, target) {
        if (excludeSelector && $(target).closest(excludeSelector).length > 0) return false;

        isDragging = true;
        hasMoved = false;

        startClientX = clientX;
        startClientY = clientY;

        // 获取当前元素的左上角位置
        if (!isInitialized) {
            const rect = element[0].getBoundingClientRect();
            startLeft = rect.left;
            startTop = rect.top;
            isInitialized = true;
        } else {
            const computedStyle = window.getComputedStyle(element[0]);
            startLeft = parseFloat(computedStyle.left) || 0;
            startTop = parseFloat(computedStyle.top) || 0;
        }

        element.css('transition', 'none');
        return true;
    }

    // 统一的拖拽移动处理
    function handleDragMove(clientX, clientY) {
        if (!isDragging) return;
        hasMoved = true;

        let newLeft = startLeft + (clientX - startClientX);
        let newTop = startTop + (clientY - startClientY);

        // 边界限制（基于左上角坐标）
        const elementWidth = element.outerWidth();
        const elementHeight = element.outerHeight();

        newLeft = Math.max(0, Math.min(newLeft, window.innerWidth - elementWidth));
        newTop = Math.max(0, Math.min(newTop, window.innerHeight - elementHeight));

        element.css({
            left: newLeft + 'px',
            top: newTop + 'px',
            right: 'auto',
            bottom: 'auto'
        });
    }

    // 统一的拖拽结束处理
    function handleDragEnd() {
        if (isDragging) {
            isDragging = false;
            // 用 setTimeout 防止立即触发 click
            setTimeout(() => hasMoved = false, 50);
            element.css('transition', ''); // 清除内联 transition，恢复 CSS 默认
        }
    }

    // 鼠标事件（使用命名空间防止重复绑定累积）
    handle.off('mousedown.aiDrag').on('mousedown.aiDrag', function (e) {
        handleDragStart(e.clientX, e.clientY, e.target);
    });

    $(document).off('mousemove.aiDrag').on('mousemove.aiDrag', function (e) {
        handleDragMove(e.clientX, e.clientY);
    });

    $(document).off('mouseup.aiDrag').on('mouseup.aiDrag', function () {
        handleDragEnd();
    });

    // 触摸事件（使用命名空间防止重复绑定累积）
    handle.off('touchstart.aiDrag').on('touchstart.aiDrag', function (e) {
        const touch = e.originalEvent.touches[0];
        if (handleDragStart(touch.clientX, touch.clientY, e.target)) {
            e.preventDefault(); // 防止页面滚动
        }
    });

    // 使用原生 addEventListener + passive: false，仅在拖拽进行时才注册
    // 避免常驻的非 passive touchmove 监听器阻塞手机端页面滚动
    let dragMoveHandler = null;
    let dragEndHandler = null;

    const originalDragStart = handleDragStart;
    handleDragStart = function (clientX, clientY, target) {
        const result = originalDragStart(clientX, clientY, target);
        if (result && !dragMoveHandler) {
            dragMoveHandler = function (e) {
                if (isDragging) {
                    const touch = e.touches[0];
                    handleDragMove(touch.clientX, touch.clientY);
                    e.preventDefault();
                }
            };
            dragEndHandler = function () {
                handleDragEnd();
                // 拖拽结束后移除监听器，恢复页面正常滚动
                if (dragMoveHandler) {
                    document.removeEventListener('touchmove', dragMoveHandler);
                    document.removeEventListener('touchend', dragEndHandler);
                    document.removeEventListener('touchcancel', dragEndHandler);
                    dragMoveHandler = null;
                    dragEndHandler = null;
                }
            };
            document.addEventListener('touchmove', dragMoveHandler, { passive: false });
            document.addEventListener('touchend', dragEndHandler);
            document.addEventListener('touchcancel', dragEndHandler);
        }
        return result;
    };

    return () => hasMoved;
}

// ═══════════════════════════════════════════════════════════
//  缩放功能
// ═══════════════════════════════════════════════════════════

/**
 * 为元素添加调整大小功能
 * @param {jQuery} element - 要调整大小的元素
 */
export function makeResizable(element) {
    // 创建调整大小手柄
    const resizeHandle = $('<div class="st-chatu8-ai-resize-handle"><i class="fa-solid fa-grip-lines"></i></div>');
    element.append(resizeHandle);

    let isResizing = false;
    let startX, startY, startWidth, startHeight;

    // 统一的开始调整处理
    function handleResizeStart(clientX, clientY) {
        isResizing = true;
        startX = clientX;
        startY = clientY;
        startWidth = element.outerWidth();
        startHeight = element.outerHeight();
        element.css('transition', 'none');
        $('body').css('user-select', 'none');
    }

    // 统一的调整移动处理
    function handleResizeMove(clientX, clientY) {
        if (!isResizing) return;

        const deltaX = clientX - startX;
        const deltaY = clientY - startY;

        let newWidth = startWidth + deltaX;
        let newHeight = startHeight + deltaY;

        // 最小尺寸限制
        const minWidth = 300;
        const minHeight = 400;
        newWidth = Math.max(minWidth, newWidth);
        newHeight = Math.max(minHeight, newHeight);

        // 最大尺寸限制（不超过视口）
        const maxWidth = window.innerWidth - 50;
        const maxHeight = window.innerHeight - 50;
        newWidth = Math.min(maxWidth, newWidth);
        newHeight = Math.min(maxHeight, newHeight);

        element.css({
            width: newWidth + 'px',
            height: newHeight + 'px',
            'max-height': 'none',
            'max-width': 'none'
        });
    }

    // 统一的调整结束处理
    function handleResizeEnd() {
        if (isResizing) {
            isResizing = false;
            element.css('transition', '');
            $('body').css('user-select', '');
        }
    }

    // 鼠标事件（使用命名空间防止重复绑定累积）
    resizeHandle.off('mousedown.aiResize').on('mousedown.aiResize', function (e) {
        e.preventDefault();
        e.stopPropagation();
        handleResizeStart(e.clientX, e.clientY);
    });

    $(document).off('mousemove.aiResize').on('mousemove.aiResize', function (e) {
        handleResizeMove(e.clientX, e.clientY);
    });

    $(document).off('mouseup.aiResize').on('mouseup.aiResize', function () {
        handleResizeEnd();
    });

    // 触摸事件：仅在 resize 开始时注册 touchmove，结束时移除
    // 避免常驻的非 passive touchmove 阻塞手机端页面滚动
    let resizeMoveHandler = null;
    let resizeEndHandler = null;

    resizeHandle.off('touchstart.aiResize').on('touchstart.aiResize', function (e) {
        e.preventDefault();
        e.stopPropagation();
        const touch = e.originalEvent.touches[0];
        handleResizeStart(touch.clientX, touch.clientY);

        if (!resizeMoveHandler) {
            resizeMoveHandler = function (ev) {
                if (isResizing) {
                    const t = ev.touches[0];
                    handleResizeMove(t.clientX, t.clientY);
                    ev.preventDefault();
                }
            };
            resizeEndHandler = function () {
                handleResizeEnd();
                if (resizeMoveHandler) {
                    document.removeEventListener('touchmove', resizeMoveHandler);
                    document.removeEventListener('touchend', resizeEndHandler);
                    document.removeEventListener('touchcancel', resizeEndHandler);
                    resizeMoveHandler = null;
                    resizeEndHandler = null;
                }
            };
            document.addEventListener('touchmove', resizeMoveHandler, { passive: false });
            document.addEventListener('touchend', resizeEndHandler);
            document.addEventListener('touchcancel', resizeEndHandler);
        }
    });
}

// ═══════════════════════════════════════════════════════════
//  Qwen TTS 辅助函数
// ═══════════════════════════════════════════════════════════

/** 填充 Qwen 声音下拉列表 */
function populateQwenVoices(selectedVoice) {
    const voices = getQwenVoices();
    dom.ttsQwenVoiceSelect.empty();
    voices.forEach(v => {
        dom.ttsQwenVoiceSelect.append(`<option value="${v}">${v}</option>`);
    });
    if (selectedVoice) {
        dom.ttsQwenVoiceSelect.val(selectedVoice);
    }
}

// ═══════════════════════════════════════════════════════════
//  Edge TTS 辅助函数
// ═══════════════════════════════════════════════════════════

/** 填充 Edge 声音下拉列表 */
function populateEdgeVoices(selectedVoiceId) {
    const voices = getEdgeVoices();
    dom.ttsEdgeVoiceSelect.empty();
    voices.forEach(v => {
        const genderTag = v.gender === 'female' ? '♀' : '♂';
        dom.ttsEdgeVoiceSelect.append(`<option value="${v.id}">${genderTag} ${v.name}</option>`);
    });
    if (selectedVoiceId) {
        dom.ttsEdgeVoiceSelect.val(selectedVoiceId);
    }
}

/** 填充 Edge 风格下拉列表 */
function populateEdgeStyles(voiceId, selectedStyle) {
    const styles = voiceId ? getEdgeVoiceStyles(voiceId) : [];
    dom.ttsEdgeStyleSelect.empty();
    if (styles.length === 0) {
        dom.ttsEdgeStyleSelect.append('<option value="general">通用 (默认)</option>');
    } else {
        styles.forEach(s => {
            dom.ttsEdgeStyleSelect.append(`<option value="${s.id}">${s.name}</option>`);
        });
    }
    if (selectedStyle) {
        dom.ttsEdgeStyleSelect.val(selectedStyle);
    }
}

/** 更新 Ping 状态显示 */
function updatePingStatusDisplay(pingData) {
    if (!pingData) {
        dom.ttsEdgePingStatus.text('未检测').css('color', '');
        return;
    }
    const { available, total, bestName, bestLatency } = pingData;
    if (available > 0) {
        dom.ttsEdgePingStatus.text(`${available}/${total} 可用，最快: ${bestName} (${bestLatency}ms)`).css('color', '#4CAF50');
    } else {
        dom.ttsEdgePingStatus.text(`${available}/${total} 可用，所有服务器不可达`).css('color', '#f44336');
    }
}

// ═══════════════════════════════════════════════════════════
//  设置面板刷新
// ═══════════════════════════════════════════════════════════

/**
 * 刷新设置面板显示（从 extension_settings 读取最新值）
 */
export function refreshSettingsPanel() {
    const aiConfig = extension_settings[extensionName]?.chatu8_ai_assistant || {};
    dom.inputApiUrl.val(aiConfig.api_url || '');
    dom.inputApiKey.val(aiConfig.api_key || '');
    dom.inputModel.val(aiConfig.model || 'mistral');
    dom.selectSystemPrompt.val(aiConfig.system_prompt_key || defaultSystemPromptKey);
    dom.checkBypassProxy.prop('checked', !!aiConfig.bypass_proxy);
    dom.checkSendImages.prop('checked', aiConfig.send_images !== false);
    dom.checkStream.prop('checked', false); // 强制显示为关闭
    dom.checkAutoExecute.prop('checked', !!aiConfig.auto_execute_commands);
    dom.checkKnowledgeBase.prop('checked', isKnowledgeBaseEnabled());
    // 楼层信息
    const floorEnabled = !!aiConfig.floor_message_enabled;
    dom.checkFloorMessage.prop('checked', floorEnabled);
    dom.floorCount.val(aiConfig.floor_count ?? 1);
    dom.dialog.find('#chatu8-ai-floor-settings').toggle(floorEnabled);
    dom.checkTTSEnabled.prop('checked', !!aiConfig.tts_enabled);
    // TTS 设置面板刷新
    const ttsEnabled = !!aiConfig.tts_enabled;
    dom.ttsSettingsPanel.toggle(ttsEnabled);
    dom.ttsScopeSelect.val(aiConfig.tts_scope || 'dialogue');
    const savedEngine = aiConfig.tts_engine || 'edge';
    dom.ttsEngineSelect.val(savedEngine);
    setTTSEngineType(savedEngine);
    dom.ttsQwenOptions.toggle(savedEngine === 'qwen');
    dom.ttsEdgeOptions.toggle(savedEngine === 'edge');
    if (savedEngine === 'qwen') {
        populateQwenVoices(aiConfig.tts_qwen_voice);
    } else if (savedEngine === 'edge') {
        populateEdgeVoices(aiConfig.tts_edge_voice);
        populateEdgeStyles(aiConfig.tts_edge_voice, aiConfig.tts_edge_style);
        dom.ttsEdgeRateSlider.val(aiConfig.tts_edge_rate ?? 0);
        dom.ttsEdgeRateVal.text(aiConfig.tts_edge_rate ?? 0);
        dom.ttsEdgePitchSlider.val(aiConfig.tts_edge_pitch ?? 0);
        dom.ttsEdgePitchVal.text(aiConfig.tts_edge_pitch ?? 0);
        // 恢复上次保存的 Ping 结果
        if (aiConfig.tts_edge_ping) {
            updatePingStatusDisplay(aiConfig.tts_edge_ping);
        }
    }
    // ASR 参数刷新
    const asrEnabled = isASREnabled();
    dom.checkASREnabled.prop('checked', asrEnabled);
    dom.asrSettingsPanel.toggle(asrEnabled);
    const asrCfg = getASRConfig();
    // 根据对话模式设置决定麦克风按钮显示、标题和图标
    const isConvModeSetting = asrCfg.conversationMode;
    dom.asrMicBtn.toggle(asrEnabled);
    const $micIcon = dom.asrMicBtn.find('i');
    if (asrEnabled && isConvModeSetting) {
        dom.asrMicBtn.attr('title', '多轮对话（点击开始/停止）');
        $micIcon.removeClass('fa-microphone fa-stop fa-spinner fa-spin').addClass('fa-comments');
    } else {
        dom.asrMicBtn.attr('title', '语音输入（单次）');
        $micIcon.removeClass('fa-comments fa-stop fa-spinner fa-spin').addClass('fa-microphone');
    }
    // 恢复多轮对话按钮的激活状态
    if (isConversationMode()) {
        dom.asrMicBtn.addClass('conv-active');
    } else {
        dom.asrMicBtn.removeClass('conv-active');
    }
    dom.asrConvModeSelect.val(isConvModeSetting ? 'conversation' : 'single');
    dom.asrSilenceSlider.val(asrCfg.silenceTimeout); dom.asrSilenceVal.text(asrCfg.silenceTimeout);
    dom.asrVadSlider.val(asrCfg.vadThreshold); dom.asrVadVal.text(asrCfg.vadThreshold);
    dom.asrMaxKeepSlider.val(asrCfg.maxKeepDuration); dom.asrMaxKeepVal.text(asrCfg.maxKeepDuration);
    dom.asrLanguageSelect.val(asrCfg.language || 'auto');
    dom.asrAppendSelect.val(String(asrCfg.appendMode !== false));
    dom.asrAutoSendCheckbox.prop('checked', asrCfg.autoSend !== false);

    dom.inputMaxTokens.val(aiConfig.max_tokens ?? 40000);
    dom.inputTemperature.val(aiConfig.temperature ?? 0.8);
    dom.inputTopP.val(aiConfig.top_p ?? 1.0);
}

/**
 * 首次打开检查是否配置 API
 */
export function checkAndShowSettings() {
    const aiConfig = extension_settings[extensionName]?.chatu8_ai_assistant || {};
    if (!aiConfig.api_key) {
        dom.settingsPanel.addClass('active');
        toastr?.info('初次使用请先配置好 API 和 模型信息哦~');
    }
    // 无论是否有配置，都刷新显示
    refreshSettingsPanel();
}

// ═══════════════════════════════════════════════════════════
//  自动保存设置
// ═══════════════════════════════════════════════════════════

/**
 * 自动保存设置函数
 */
export function autoSaveSettings() {
    if (!extension_settings[extensionName].chatu8_ai_assistant) {
        extension_settings[extensionName].chatu8_ai_assistant = {};
    }

    const aiConfig = extension_settings[extensionName].chatu8_ai_assistant;
    aiConfig.api_url = dom.inputApiUrl.val().trim();
    aiConfig.api_key = dom.inputApiKey.val().trim();
    aiConfig.model = dom.inputModel.val().trim();
    aiConfig.system_prompt_key = dom.selectSystemPrompt.val();

    // 清理一下旧的系统提示词文本配置 (如果存在的话)
    if (aiConfig.system_prompt !== undefined) {
        delete aiConfig.system_prompt;
    }

    aiConfig.bypass_proxy = dom.checkBypassProxy.is(':checked');
    aiConfig.send_images = dom.checkSendImages.is(':checked');
    aiConfig.stream = false; // 强制关闭流式传输
    aiConfig.auto_execute_commands = dom.checkAutoExecute.is(':checked');
    aiConfig.floor_message_enabled = dom.checkFloorMessage.is(':checked');
    const floorCount = parseInt(dom.floorCount.val());
    aiConfig.floor_count = !isNaN(floorCount) ? floorCount : 1;
    aiConfig.tts_enabled = dom.checkTTSEnabled.is(':checked');
    // TTS 引擎设置保存
    aiConfig.tts_scope = dom.ttsScopeSelect.val();
    aiConfig.tts_engine = dom.ttsEngineSelect.val();
    if (aiConfig.tts_engine === 'qwen') {
        aiConfig.tts_qwen_voice = dom.ttsQwenVoiceSelect.val();
    } else if (aiConfig.tts_engine === 'edge') {
        aiConfig.tts_edge_voice = dom.ttsEdgeVoiceSelect.val();
        aiConfig.tts_edge_style = dom.ttsEdgeStyleSelect.val();
        aiConfig.tts_edge_rate = parseInt(dom.ttsEdgeRateSlider.val()) || 0;
        aiConfig.tts_edge_pitch = parseInt(dom.ttsEdgePitchSlider.val()) || 0;
    }

    const maxT = parseInt(dom.inputMaxTokens.val());
    aiConfig.max_tokens = !isNaN(maxT) ? maxT : 40000;

    const temp = parseFloat(dom.inputTemperature.val());
    aiConfig.temperature = !isNaN(temp) ? temp : 0.8;

    const topP = parseFloat(dom.inputTopP.val());
    aiConfig.top_p = !isNaN(topP) ? topP : 1.0;

    saveSettingsDebounced();
}

// ═══════════════════════════════════════════════════════════
//  初始化设置面板事件绑定
// ═══════════════════════════════════════════════════════════

/**
 * 初始化对话框的所有设置面板交互事件。
 * 在 initAiAssistant 中调用。
 */
export function initDialogEvents() {
    const {
        dialog, header, settingsBtn, settingsPanel, settingsCloseBtn,
        saveSettingsBtn, inputApiUrl, inputApiKey, inputModel, selectModel,
        selectSystemPrompt, fetchModelsBtn, checkBypassProxy, checkSendImages,
        checkAutoExecute, checkTTSEnabled, checkASREnabled,
        ttsSettingsPanel, ttsEngineSelect, ttsQwenOptions, ttsQwenVoiceSelect,
        ttsEdgeOptions, ttsEdgeVoiceSelect, ttsEdgeStyleSelect, ttsEdgeRateSlider,
        ttsEdgeRateVal, ttsEdgePitchSlider, ttsEdgePitchVal,
        ttsEdgePingBtn, ttsEdgePingStatus, asrSettingsPanel, asrMicBtn, asrConvModeSelect,
        asrSilenceSlider, asrSilenceVal, asrVadSlider, asrVadVal,
        asrMaxKeepSlider, asrMaxKeepVal, asrLanguageSelect, asrAppendSelect, asrAutoSendCheckbox,
        asrMicTestBtn, asrMicTestMeter, asrMicTestBar, asrMicTestVadLine, asrMicTestLabel, asrMicTestStatus,
        historyPanel, inputMaxTokens, inputTemperature, inputTopP,
        checkKnowledgeBase, checkDesktopPet, closeBtn
    } = dom;

    // 初始化预设角色下拉框
    selectSystemPrompt.empty();
    Object.entries(systemPrompts).forEach(([key, value]) => {
        selectSystemPrompt.append(new Option(value.name, key));
    });

    // 拖拽 & 缩放
    makeDraggable(dialog, header, '#st-chatu8-ai-close, #st-chatu8-ai-settings-btn, #st-chatu8-ai-new-chat, #st-chatu8-ai-history-btn, #st-chatu8-ai-summary-btn');
    makeResizable(dialog);

    // 将刷新函数暴露给外部
    setRefreshSettingsPanelFn(refreshSettingsPanel);

    // ----- 聊天总结面板（独立弹窗） -----
    dom.summaryBtn.on('click', function () {
        historyPanel.removeClass('active');
        settingsPanel.removeClass('active');
        const $sm = dom.summaryManager;
        if ($sm && $sm.length) {
            if ($sm.is(':visible')) {
                hideSummaryPanel();
            } else {
                showSummaryPanel();
            }
        }
    });

    // ----- 设置面板交互 -----
    settingsBtn.on('click', function () {
        historyPanel.removeClass('active'); // 互斥关闭历史
        hideSummaryPanel(); // 互斥关闭总结
        checkAndShowSettings();
        settingsPanel.addClass('active');
    });

    settingsCloseBtn.on('click', function () {
        settingsPanel.removeClass('active');
    });

    // 为所有输入字段添加自动保存监听器
    inputApiUrl.on('input', autoSaveSettings);
    inputApiKey.on('input', autoSaveSettings);
    inputModel.on('input', autoSaveSettings);
    selectSystemPrompt.on('change', function () {
        autoSaveSettings();
        // 切换为自定义预设时自动开启资料库功能
        if ($(this).val() === 'custom' && !isKnowledgeBaseEnabled()) {
            setKnowledgeBaseEnabled(true);
            checkKnowledgeBase.prop('checked', true);
            // 同步侧边栏 tab 可见性
            const $kbNavLink = $('.st-chatu8-nav-link[data-tab="knowledgeBase"]');
            if ($kbNavLink.length) {
                $kbNavLink.show();
            }
            toastr?.info('已自动开启资料库功能（自定义预设推荐搭配资料库使用）');
        }
    });
    checkBypassProxy.on('change', autoSaveSettings);
    checkSendImages.on('change', autoSaveSettings);
    checkAutoExecute.on('change', autoSaveSettings);
    checkTTSEnabled.on('change', function () {
        const enabled = $(this).prop('checked');
        ttsSettingsPanel.toggle(enabled);
        autoSaveSettings();
    });

    // ── TTS 朗读范围切换 ──
    dom.ttsScopeSelect.on('change', autoSaveSettings);

    // ── TTS 引擎切换 & 设置交互 ──
    ttsEngineSelect.on('change', function () {
        const engine = $(this).val();
        setTTSEngineType(engine);
        ttsQwenOptions.toggle(engine === 'qwen');
        ttsEdgeOptions.toggle(engine === 'edge');
        const aiConfig = extension_settings[extensionName]?.chatu8_ai_assistant || {};
        if (engine === 'qwen') {
            populateQwenVoices(aiConfig.tts_qwen_voice);
        } else if (engine === 'edge') {
            populateEdgeVoices(aiConfig.tts_edge_voice);
            populateEdgeStyles(ttsEdgeVoiceSelect.val(), aiConfig.tts_edge_style);
            // 恢复已保存的 Ping 检测结果
            if (aiConfig.tts_edge_ping) {
                updatePingStatusDisplay(aiConfig.tts_edge_ping);
            } else {
                updatePingStatusDisplay(null);
            }
        }
        autoSaveSettings();
    });

    ttsQwenVoiceSelect.on('change', autoSaveSettings);

    ttsEdgeVoiceSelect.on('change', function () {
        const voiceId = $(this).val();
        populateEdgeStyles(voiceId);
        autoSaveSettings();
    });

    ttsEdgeStyleSelect.on('change', autoSaveSettings);

    ttsEdgeRateSlider.on('input', function () {
        ttsEdgeRateVal.text($(this).val());
    });
    ttsEdgeRateSlider.on('change', autoSaveSettings);

    ttsEdgePitchSlider.on('input', function () {
        ttsEdgePitchVal.text($(this).val());
    });
    ttsEdgePitchSlider.on('change', autoSaveSettings);

    // Ping 按钮
    ttsEdgePingBtn.on('click', async function () {
        const $btn = $(this);
        const $icon = $btn.find('i');
        $btn.prop('disabled', true);
        $icon.removeClass('fa-signal').addClass('fa-spinner fa-spin');
        ttsEdgePingStatus.text('检测中...').css('color', '');
        try {
            const result = await pingAndRefreshServers();
            const pingData = {
                available: result.available,
                total: result.total,
                bestName: result.servers.length > 0 ? result.servers[0].name : '',
                bestLatency: result.servers.length > 0 ? result.servers[0].latency : 0,
                timestamp: result.timestamp
            };
            // 保存 ping 结果到 settings
            if (!extension_settings[extensionName].chatu8_ai_assistant) {
                extension_settings[extensionName].chatu8_ai_assistant = {};
            }
            extension_settings[extensionName].chatu8_ai_assistant.tts_edge_ping = pingData;
            saveSettingsDebounced();
            updatePingStatusDisplay(pingData);
        } catch (e) {
            ttsEdgePingStatus.text('检测失败: ' + e.message).css('color', '#f44336');
        } finally {
            $btn.prop('disabled', false);
            $icon.removeClass('fa-spinner fa-spin').addClass('fa-signal');
        }
    });

    // ASR 事件
    checkASREnabled.on('change', function () {
        const enabled = $(this).prop('checked');
        setASREnabled(enabled);
        asrSettingsPanel.toggle(enabled);
        asrMicBtn.toggle(enabled);
        if (!enabled) {
            // 关闭 ASR 时停止多轮对话模式
            stopConversationMode();
            asrMicBtn.removeClass('conv-active conv-recording');
        }
    });

    // 对话模式选择器
    asrConvModeSelect.on('change', function () {
        const mode = $(this).val();
        const isConv = mode === 'conversation';
        saveASRConfig({ conversationMode: isConv });

        // 如果正在多轮对话中，先停止
        if (isConversationMode()) {
            stopConversationMode();
            asrMicBtn.removeClass('conv-active conv-recording');
        }

        // 更新按钮外观
        const $icon = asrMicBtn.find('i');
        if (isConv) {
            asrMicBtn.attr('title', '多轮对话（点击开始/停止）');
            $icon.removeClass('fa-microphone fa-stop fa-spinner fa-spin').addClass('fa-comments');
        } else {
            asrMicBtn.attr('title', '语音输入（单次）');
            $icon.removeClass('fa-comments fa-stop fa-spinner fa-spin').addClass('fa-microphone');
        }
    });

    asrMicBtn.on('click', function () {
        const asrCfg = getASRConfig();
        const isConvModeSetting = asrCfg.conversationMode;

        if (isConvModeSetting) {
            // 多轮对话模式
            if (isConversationMode()) {
                // 正在对话中 → 停止
                stopConversationMode();
                asrMicBtn.removeClass('conv-active conv-recording');
                const $icon = asrMicBtn.find('i');
                $icon.removeClass('fa-microphone fa-stop fa-spinner fa-spin').addClass('fa-comments');
                toastr?.info('多轮对话模式已关闭');
            } else {
                // 开启多轮对话
                const autoSendFn = () => {
                    if (dom.sendBtn && dom.sendBtn.length) {
                        dom.sendBtn.trigger('click');
                    }
                };
                // 检测是否需要以禁音状态启动（AI正在生成 或 TTS正在播放/加载）
                const isBusy = isAiGenerating || ttsButtonState !== 'idle';
                startConversationMode(autoSendFn, isBusy);
                asrMicBtn.addClass('conv-active');
                if (isBusy) {
                    toastr?.success('多轮对话模式已开启，等待当前任务完成后自动开始录音...');
                } else {
                    toastr?.success('多轮对话模式已开启，开始录音...');
                }
            }
        } else {
            // 单次输入模式
            const $btn = $(this);
            if ($btn.hasClass('asr-recording')) {
                eventSource.emit(eventNames.ASR_STOP);
            } else {
                eventSource.emit(eventNames.ASR_START, { mode: 'vad', targetInput: '#st-chatu8-ai-input' });
            }
        }
    });

    eventSource.on(eventNames.ASR_STATE_CHANGED, (data) => {
        const $icon = asrMicBtn.find('i');
        const inConvMode = isConversationMode();
        const asrCfg = getASRConfig();
        const isConvModeSetting = asrCfg.conversationMode;

        switch (data?.state) {
            case 'recording':
                if (inConvMode || isConvModeSetting) {
                    // 多轮对话模式录音中
                    asrMicBtn.addClass('asr-recording conv-recording');
                    $icon.removeClass('fa-comments fa-spinner fa-spin').addClass('fa-microphone');
                    asrMicBtn.css('color', '');
                } else {
                    // 单次模式录音中
                    asrMicBtn.addClass('asr-recording');
                    $icon.removeClass('fa-microphone fa-spinner fa-spin').addClass('fa-stop');
                    asrMicBtn.css('color', '#ff4444');
                }
                break;
            case 'processing':
                asrMicBtn.removeClass('asr-recording conv-recording');
                $icon.removeClass('fa-microphone fa-stop fa-comments').addClass('fa-spinner fa-spin');
                asrMicBtn.css('color', '');
                break;
            default: // idle
                asrMicBtn.removeClass('asr-recording conv-recording');
                asrMicBtn.css('color', '');
                if (inConvMode) {
                    // 仍在对话模式中（等待 TTS 等）
                    $icon.removeClass('fa-microphone fa-stop fa-spinner fa-spin').addClass('fa-comments');
                } else if (isConvModeSetting) {
                    // 设置为对话模式但未激活
                    $icon.removeClass('fa-microphone fa-stop fa-spinner fa-spin').addClass('fa-comments');
                    asrMicBtn.removeClass('conv-active');
                } else {
                    // 单次模式
                    $icon.removeClass('fa-stop fa-spinner fa-spin fa-comments').addClass('fa-microphone');
                }
                break;
        }
    });

    asrSilenceSlider.on('input', function () {
        const v = parseInt($(this).val());
        asrSilenceVal.text(v);
        saveASRConfig({ silenceTimeout: v });
    });
    asrVadSlider.on('input', function () {
        const v = parseFloat($(this).val());
        asrVadVal.text(v);
        saveASRConfig({ vadThreshold: v });
    });
    asrMaxKeepSlider.on('input', function () {
        const v = parseInt($(this).val());
        asrMaxKeepVal.text(v);
        saveASRConfig({ maxKeepDuration: v });
    });
    asrLanguageSelect.on('change', function () {
        saveASRConfig({ language: $(this).val() });
    });
    asrAppendSelect.on('change', function () {
        saveASRConfig({ appendMode: $(this).val() === 'true' });
    });
    asrAutoSendCheckbox.on('change', function () {
        saveASRConfig({ autoSend: $(this).prop('checked') });
    });

    // ── 麦克风测试 ─────────────────────────────────────────
    let micTestActive = false;
    asrMicTestBtn.on('click', async function () {
        if (micTestActive) {
            // 停止测试
            stopMicTest();
            micTestActive = false;
            asrMicTestMeter.hide();
            asrMicTestBtn.html('<i class="fa-solid fa-wave-square"></i> 开始测试');
            asrMicTestBtn.css('background', '');
            return;
        }
        // 启动测试
        asrMicTestBtn.html('<i class="fa-solid fa-spinner fa-spin"></i> 连接麦克风...');
        const ok = await startMicTest((rms, vadThreshold) => {
            // 将 RMS 映射到百分比（使用对数缩放使小值更可见）
            // RMS 通常在 0~0.3 范围，映射到 0~100%
            const displayMax = 0.3;
            const pct = Math.min(100, (rms / displayMax) * 100);
            const vadPct = Math.min(100, (vadThreshold / displayMax) * 100);

            asrMicTestBar.css('width', pct + '%');
            asrMicTestVadLine.css('left', vadPct + '%');
            asrMicTestLabel.text(`RMS: ${rms.toFixed(4)} / VAD: ${vadThreshold.toFixed(4)}`);

            // 状态文字
            if (rms > vadThreshold) {
                asrMicTestStatus.text('🟢 检测到语音').css('color', '#4CAF50');
            } else if (rms > vadThreshold * 0.5) {
                asrMicTestStatus.text('🟡 接近阈值').css('color', '#FFC107');
            } else {
                asrMicTestStatus.text('⚫ 静音/底噪').css('color', '#888');
            }
        });

        if (!ok) {
            asrMicTestBtn.html('<i class="fa-solid fa-wave-square"></i> 开始测试');
            toastr?.error('无法访问麦克风，请检查权限');
            return;
        }
        micTestActive = true;
        asrMicTestMeter.show();
        asrMicTestBtn.html('<i class="fa-solid fa-stop"></i> 停止测试');
        asrMicTestBtn.css('background', '#ff4444');
    });

    // VAD 滑块变更时实时更新测试面板中的阈值线
    asrVadSlider.on('input', function () {
        if (micTestActive) {
            const v = parseFloat($(this).val());
            const displayMax = 0.3;
            const vadPct = Math.min(100, (v / displayMax) * 100);
            asrMicTestVadLine.css('left', vadPct + '%');
        }
    });

    // 设置面板关闭时自动停止测试
    settingsCloseBtn.on('click', function () {
        if (micTestActive) {
            stopMicTest();
            micTestActive = false;
            asrMicTestMeter.hide();
            asrMicTestBtn.html('<i class="fa-solid fa-wave-square"></i> 开始测试');
            asrMicTestBtn.css('background', '');
        }
    });

    // ── 独立窗口开关（不持久化，自动切换视频模式 + 画中画） ──
    let pipVideoElement = null;

    checkDesktopPet.on('change', async function () {
        const checked = $(this).prop('checked');
        const settings = extension_settings[extensionName];

        if (checked) {
            try {
                // 1. 自动开启视频模式（如果尚未开启）
                const videoModeWasOff = !(settings.enable_chatu8_fab_video === true || settings.enable_chatu8_fab_video === 'true');
                if (videoModeWasOff) {
                    settings.enable_chatu8_fab_video = true;
                    // 同步悬浮球设置页的视频模式开关
                    $('#enable_chatu8_fab_video').prop('checked', true).trigger('change');
                    // 重新应用 FAB 设置以初始化视频播放器
                    applyFabSettings();
                    // 等待视频播放器初始化完成
                    await new Promise(r => setTimeout(r, 1500));
                }

                // 2. 获取视频播放器实例
                const videoPlayer = getGlobalVideoPlayer();
                if (!videoPlayer || !videoPlayer.setPipBackground) {
                    toastr.error('未找到视频播放器，请先在悬浮球设置中启用视频形象', '独立窗口');
                    $(this).prop('checked', false);
                    return;
                }

                // 3. 查找 WebGL Canvas 元素
                const glCanvas = document.getElementById('st-chatu8-fab-video-canvas');
                if (!glCanvas) {
                    toastr.error('未找到视频画布元素，请先在悬浮球设置中启用视频形象', '独立窗口');
                    $(this).prop('checked', false);
                    return;
                }

                // 4. 让 WebGL 渲染器使用不透明背景色
                videoPlayer.setPipBackground(true);

                // 5. 从 WebGL Canvas 捕获视频流
                const stream = glCanvas.captureStream(30);

                // 6. 创建隐藏的 video 元素用于 PiP
                pipVideoElement = document.createElement('video');
                pipVideoElement.id = 'st-chatu8-pip-video-assistant';
                pipVideoElement.srcObject = stream;
                pipVideoElement.muted = true;
                pipVideoElement.autoplay = true;
                pipVideoElement.playsInline = true;
                pipVideoElement.style.cssText = 'display:none;position:fixed;opacity:0;pointer-events:none;';
                pipVideoElement.width = glCanvas.width || 200;
                pipVideoElement.height = glCanvas.height || 200;
                document.body.appendChild(pipVideoElement);

                // 7. 等待视频可以播放
                await pipVideoElement.play();

                // 8. 请求画中画
                await pipVideoElement.requestPictureInPicture();

                // 9. 监听退出画中画事件
                pipVideoElement.addEventListener('leavepictureinpicture', () => {
                    const vp = getGlobalVideoPlayer();
                    if (vp && vp.setPipBackground) {
                        vp.setPipBackground(false);
                    }
                    if (pipVideoElement) {
                        pipVideoElement.srcObject = null;
                        pipVideoElement.remove();
                        pipVideoElement = null;
                    }
                    checkDesktopPet.prop('checked', false);
                    toastr.info('画中画已关闭，智绘姬回到浏览器内', '独立窗口');
                });

                toastr.success('智绘姬已弹出到画中画窗口，可置顶显示在其他应用上方', '独立窗口');
            } catch (err) {
                console.error('[st-chatu8] 智绘姬AI助手创建画中画失败:', err);
                const vp = getGlobalVideoPlayer();
                if (vp && vp.setPipBackground) {
                    vp.setPipBackground(false);
                }
                if (pipVideoElement) {
                    pipVideoElement.srcObject = null;
                    pipVideoElement.remove();
                    pipVideoElement = null;
                }
                $(this).prop('checked', false);

                if (err.name === 'NotAllowedError') {
                    toastr.warning('画中画请求被拒绝。请确保通过用户操作（如点击）触发，且浏览器允许画中画。', '独立窗口', { timeOut: 5000 });
                } else {
                    toastr.error('创建画中画失败：' + err.message, '独立窗口', { timeOut: 5000 });
                }
            }
        } else {
            // 关闭画中画
            if (document.pictureInPictureElement) {
                await document.exitPictureInPicture().catch(() => { });
            }
            const vp = getGlobalVideoPlayer();
            if (vp && vp.setPipBackground) {
                vp.setPipBackground(false);
            }
            if (pipVideoElement) {
                pipVideoElement.srcObject = null;
                pipVideoElement.remove();
                pipVideoElement = null;
            }
            toastr.info('智绘姬画中画已关闭', '独立窗口');
        }
    });

    // 楼层信息开关
    dom.checkFloorMessage.on('change', function () {
        const enabled = $(this).prop('checked');
        dom.dialog.find('#chatu8-ai-floor-settings').toggle(enabled);
        autoSaveSettings();
    });
    dom.floorCount.on('input', autoSaveSettings);

    checkKnowledgeBase.on('change', function () {
        const enabled = $(this).prop('checked');
        setKnowledgeBaseEnabled(enabled);
        // 控制侧边栏"资料库"tab 的可见性
        const $kbNavLink = $('.st-chatu8-nav-link[data-tab="knowledgeBase"]');
        if ($kbNavLink.length) {
            $kbNavLink.toggle(enabled);
        }
        if (enabled) {
            toastr?.success('资料库功能已开启！请前往左侧设置面板的「资料库」页面添加和管理你的参考资料。');
        }
    });

    // ── 设置面板分页标签切换 ──
    settingsPanel.on('click', '.st-chatu8-ai-settings-tab', function () {
        const tabName = $(this).data('settings-tab');
        settingsPanel.find('.st-chatu8-ai-settings-tab').removeClass('active');
        $(this).addClass('active');
        settingsPanel.find('.st-chatu8-ai-settings-tab-content').removeClass('active');
        settingsPanel.find(`.st-chatu8-ai-settings-tab-content[data-settings-tab-content="${tabName}"]`).addClass('active');
    });

    inputMaxTokens.on('input', autoSaveSettings);
    inputTemperature.on('input', autoSaveSettings);
    inputTopP.on('input', autoSaveSettings);

    saveSettingsBtn.on('click', function () {
        autoSaveSettings();
        settingsPanel.removeClass('active');
    });

    // 右上角关闭按钮
    closeBtn.on('click', function () {
        dialog.removeClass('active');
    });

    // 模型列表下拉框变化时同步到输入框
    selectModel.on('change', function () {
        const selectedModel = $(this).val();
        if (selectedModel) {
            inputModel.val(selectedModel);
            inputModel.trigger('input');
        }
    });

    // 获取模型列表
    fetchModelsBtn.on('click', async function () {
        const baseUrl = inputApiUrl.val().trim();
        const apiKey = inputApiKey.val().trim();
        const bypassProxy = dom.checkBypassProxy.is(':checked');

        if (!baseUrl || !apiKey) {
            toastr?.warning("请先配置 API 地址和 API Key。");
            return;
        }

        const originalHtml = fetchModelsBtn.html();
        fetchModelsBtn.html('<i class="fa-solid fa-spinner fa-spin"></i>');
        fetchModelsBtn.prop('disabled', true);

        try {
            let response;
            let data;

            if (bypassProxy) {
                const modelsUrl = baseUrl.replace(/\/$/, '') + '/v1/models';
                response = await fetch(modelsUrl, {
                    method: 'GET',
                    headers: {
                        'Authorization': `Bearer ${apiKey}`,
                        'Content-Type': 'application/json'
                    }
                });
                if (!response.ok) {
                    throw new Error(`获取模型列表失败: ${response.status} ${response.statusText}`);
                }
                data = await response.json();
            } else {
                const proxyUrl = '/api/backends/chat-completions/status';
                const customApiUrl = baseUrl.replace(/\/$/, '');
                response = await fetch(proxyUrl, {
                    method: 'POST',
                    headers: getRequestHeaders(window.token),
                    body: JSON.stringify({
                        chat_completion_source: 'custom',
                        custom_url: customApiUrl,
                        custom_include_headers: `Authorization: "Bearer ${apiKey}"`
                    })
                });
                data = await response.json();
                if (data.error) {
                    throw new Error(data.error.message || JSON.stringify(data.error));
                }
                if (!response.ok) {
                    throw new Error(`获取模型列表失败: ${response.status} ${response.statusText}`);
                }
            }

            const models = data.data || [];
            models.sort((a, b) => a.id.localeCompare(b.id));

            selectModel.empty();
            selectModel.append('<option value="">(请先获取并选择模型)</option>');
            models.forEach(model => {
                selectModel.append(new Option(model.id, model.id));
            });

            toastr?.success(`成功获取 ${models.length} 个模型。`);
        } catch (error) {
            toastr?.error(`获取模型失败: ${error.message}`);
        } finally {
            fetchModelsBtn.html(originalHtml);
            fetchModelsBtn.prop('disabled', false);
        }
    });
}
