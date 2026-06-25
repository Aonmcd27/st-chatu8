/**
 * assistantContext.js
 * 
 * 共享上下文对象 —— 所有 assistant/ 子模块通过此对象访问 DOM 引用、全局状态和跨模块函数。
 * initAiAssistant() 创建 modal 后，会填充此 ctx 并传递给各子模块的 init 函数。
 */

// ═══════════════════════════════════════════════════════════
//  全局状态（在 initAiAssistant 之前就需要存在的顶层变量）
// ═══════════════════════════════════════════════════════════

/** 多会话状态（V1 兼容层，仍被部分模块引用） */
export let chatSessions = {
    activeChatId: null,
    chats: {}
};

// ═══════════════════════════════════════════════════════════
//  V2 三层分离存储状态
// ═══════════════════════════════════════════════════════════

/** V2 聊天索引（索引层）：{ version, activeChatId, chatList } */
export let chatIndex = { version: 2, activeChatId: null, chatList: [] };

/** V2 当前活动会话的完整数据（会话层）：{ id, title, updatedAt, taskData, messages } */
export let activeChat = null;

/** V2 是否已完成迁移/初始化 */
export let v2Ready = false;

/** 是否已初始化过会话 */
export let initialized = false;

/** AI 是否正在生成回复 */
export let isAiGenerating = false;

/** 用于外部调用的刷新函数引用 */
export let refreshSettingsPanelFn = null;

/** 生图监控：generationId → messageElement */
export const pendingImageGenerations = new Map();

// ═══════════════════════════════════════════════════════════
//  TTS 状态管理 & 内存缓存
// ═══════════════════════════════════════════════════════════

/** TTS 音频缓存：key = messageIndex, value = { dialogue, blobUrls: string[], totalSegments } */
export const ttsAudioCache = new Map();

/** 当前正在进行 TTS 的消息索引（-1 表示无） */
export let ttsActiveMessageIndex = -1;

/** 当前 TTS 请求 ID（用于匹配事件回调） */
export let ttsCurrentRequestId = '';

/** 当前 TTS 状态：'idle' | 'loading' | 'playing' */
export let ttsButtonState = 'idle';

/** 收集当前请求的 blobUrl（用于缓存） */
export let ttsCollectingBlobUrls = [];

/** 当前请求的总段数（用于验证缓存完整性） */
export let ttsCollectingTotalSegments = 0;

// ═══════════════════════════════════════════════════════════
//  流式输出状态
// ═══════════════════════════════════════════════════════════

/** 当前正在接收回复的消息气泡 jQuery 元素 */
export let currentSystemMsgElement = null;

/** 当前正在接收回复的消息内容区域 jQuery 元素 */
export let currentSystemMsgContent = null;

// ═══════════════════════════════════════════════════════════
//  图片上传状态
// ═══════════════════════════════════════════════════════════

/** 已选择的图片数组 */
export let selectedImages = [];

// ═══════════════════════════════════════════════════════════
//  命令执行状态
// ═══════════════════════════════════════════════════════════

/** 待执行的命令对象 */
export let pendingCommand = null;

// ═══════════════════════════════════════════════════════════
//  Marked.js 状态
// ═══════════════════════════════════════════════════════════

/** marked.js 是否已加载 */
export let markedLoaded = false;

/** marked.js 加载 Promise */
export let markedLoadPromise = null;

// ═══════════════════════════════════════════════════════════
//  状态设置器（因为 ES module 的 export let 是只读绑定，
//  其他模块不能直接赋值，需要通过 setter 函数修改）
// ═══════════════════════════════════════════════════════════

export function setChatSessions(val) { chatSessions = val; }
export function setChatIndex(val) { chatIndex = val; }
export function setActiveChat(val) {
    activeChat = val;
    // 同步 V1 兼容层：保持 chatSessions.activeChatId 和当前 chat 指针同步
    if (val) {
        chatSessions.activeChatId = val.id;
        chatSessions.chats[val.id] = val;
    }
}
export function setV2Ready(val) { v2Ready = val; }
export function setInitialized(val) { initialized = val; }
export function setIsAiGenerating(val) { isAiGenerating = val; }
export function setRefreshSettingsPanelFn(val) { refreshSettingsPanelFn = val; }

export function setTtsActiveMessageIndex(val) { ttsActiveMessageIndex = val; }
export function setTtsCurrentRequestId(val) { ttsCurrentRequestId = val; }
export function setTtsButtonState(val) { ttsButtonState = val; }
export function setTtsCollectingBlobUrls(val) { ttsCollectingBlobUrls = val; }
export function setTtsCollectingTotalSegments(val) { ttsCollectingTotalSegments = val; }

export function setCurrentSystemMsgElement(val) { currentSystemMsgElement = val; }
export function setCurrentSystemMsgContent(val) { currentSystemMsgContent = val; }

export function setSelectedImages(val) { selectedImages = val; }
export function setPendingCommand(val) { pendingCommand = val; }

export function setMarkedLoaded(val) { markedLoaded = val; }
export function setMarkedLoadPromise(val) { markedLoadPromise = val; }

// ═══════════════════════════════════════════════════════════
//  DOM 引用容器（在 initAiAssistant 中由编排入口填充）
// ═══════════════════════════════════════════════════════════

/**
 * DOM 引用对象，在 initAiAssistant 中初始化后填充。
 * 所有子模块通过 `ctx.dom.xxx` 访问 DOM 元素。
 */
export const dom = {
    // 主对话框
    dialog: null,
    chatBody: null,
    header: null,
    closeBtn: null,
    sendBtn: null,
    inputArea: null,
    triggerBtn: null,

    // 图片相关
    imageBtn: null,
    imageInput: null,
    imagePreview: null,

    // 设置面板
    settingsBtn: null,
    settingsPanel: null,
    settingsCloseBtn: null,
    saveSettingsBtn: null,
    inputApiUrl: null,
    inputApiKey: null,
    inputModel: null,
    selectModel: null,
    selectSystemPrompt: null,
    fetchModelsBtn: null,
    checkBypassProxy: null,
    checkSendImages: null,
    checkStream: null,
    inputMaxTokens: null,
    inputTemperature: null,
    inputTopP: null,
    checkAutoExecute: null,
    checkKnowledgeBase: null,
    checkTTSEnabled: null,
    checkASREnabled: null,

    // TTS 设置
    ttsSettingsPanel: null,
    ttsScopeSelect: null,
    ttsEngineSelect: null,
    ttsQwenOptions: null,
    ttsQwenVoiceSelect: null,
    ttsEdgeOptions: null,
    ttsEdgeVoiceSelect: null,
    ttsEdgeStyleSelect: null,
    ttsEdgeRateSlider: null,
    ttsEdgeRateVal: null,
    ttsEdgePitchSlider: null,
    ttsEdgePitchVal: null,
    ttsEdgePingBtn: null,
    ttsEdgePingStatus: null,

    // ASR 设置
    asrSettingsPanel: null,
    asrMicBtn: null,
    asrConvModeSelect: null,
    asrSilenceSlider: null,
    asrSilenceVal: null,
    asrVadSlider: null,
    asrVadVal: null,
    asrMaxKeepSlider: null,
    asrMaxKeepVal: null,
    asrLanguageSelect: null,
    asrAppendSelect: null,
    // ASR 麦克风测试
    asrMicTestBtn: null,
    asrMicTestMeter: null,
    asrMicTestBar: null,
    asrMicTestVadLine: null,
    asrMicTestLabel: null,
    asrMicTestStatus: null,

    // 独立窗口
    checkDesktopPet: null,

    // 屏幕共享
    checkScreenShare: null,
    checkBrowserCapture: null,
    screenShareIndicator: null,
    browserCaptureIndicator: null,

    // 楼层信息
    checkFloorMessage: null,
    floorStatus: null,
    floorCount: null,
    floorIndicator: null,

    // 历史记录面板
    newChatBtn: null,
    historyBtn: null,
    historyPanel: null,
    historyCloseBtn: null,
    historyList: null,
    exportChatBtn: null,
    selectAllBtn: null,
    deselectAllBtn: null,

    // 聊天总结
    summaryBtn: null,
    summaryManager: null,
};

/**
 * 从 jQuery dialog 对象中初始化所有 DOM 引用。
 * 在 initAiAssistant(modal) 中调用。
 * @param {jQuery} dialog - 主对话框 jQuery 对象
 */
export function initDomRefs(dialog) {
    dom.dialog = dialog;
    dom.triggerBtn = $('#st-chatu8-ai-trigger');
    dom.chatBody = dialog.find('#st-chatu8-ai-chat-body');
    dom.header = dialog.find('.st-chatu8-ai-dialog-header');
    dom.closeBtn = dialog.find('#st-chatu8-ai-close');
    dom.sendBtn = dialog.find('#st-chatu8-ai-send');
    dom.inputArea = dialog.find('#st-chatu8-ai-input');

    // 图片
    dom.imageBtn = dialog.find('#st-chatu8-ai-image-btn');
    dom.imageInput = dialog.find('#st-chatu8-ai-image-input');
    dom.imagePreview = dialog.find('#st-chatu8-ai-image-preview');

    // 设置面板
    dom.settingsBtn = dialog.find('#st-chatu8-ai-settings-btn');
    dom.settingsPanel = dialog.find('#st-chatu8-ai-settings-panel');
    dom.settingsCloseBtn = dialog.find('#st-chatu8-ai-settings-close');
    dom.saveSettingsBtn = dialog.find('#st-chatu8-ai-save-settings');
    dom.inputApiUrl = dialog.find('#chatu8-ai-api-url');
    dom.inputApiKey = dialog.find('#chatu8-ai-api-key');
    dom.inputModel = dialog.find('#chatu8-ai-model');
    dom.selectModel = dialog.find('#chatu8-ai-model-select');
    dom.selectSystemPrompt = dialog.find('#chatu8-ai-system-prompt');
    dom.fetchModelsBtn = dialog.find('#chatu8-ai-fetch-models');
    dom.checkBypassProxy = dialog.find('#chatu8-ai-bypass-proxy');
    dom.checkSendImages = dialog.find('#chatu8-ai-send-images');
    dom.checkStream = dialog.find('#chatu8-ai-stream');
    dom.inputMaxTokens = dialog.find('#chatu8-ai-max-tokens');
    dom.inputTemperature = dialog.find('#chatu8-ai-temperature');
    dom.inputTopP = dialog.find('#chatu8-ai-top-p');
    dom.checkAutoExecute = dialog.find('#chatu8-ai-auto-execute');
    dom.checkKnowledgeBase = dialog.find('#chatu8-ai-knowledge-base');
    dom.checkTTSEnabled = dialog.find('#chatu8-ai-tts-enabled');
    dom.checkASREnabled = dialog.find('#chatu8-ai-asr-enabled');

    // TTS
    dom.ttsSettingsPanel = dialog.find('#chatu8-ai-tts-settings');
    dom.ttsScopeSelect = dialog.find('#chatu8-ai-tts-scope');
    dom.ttsEngineSelect = dialog.find('#chatu8-ai-tts-engine');
    dom.ttsQwenOptions = dialog.find('#chatu8-ai-tts-qwen-options');
    dom.ttsQwenVoiceSelect = dialog.find('#chatu8-ai-tts-qwen-voice');
    dom.ttsEdgeOptions = dialog.find('#chatu8-ai-tts-edge-options');
    dom.ttsEdgeVoiceSelect = dialog.find('#chatu8-ai-tts-edge-voice');
    dom.ttsEdgeStyleSelect = dialog.find('#chatu8-ai-tts-edge-style');
    dom.ttsEdgeRateSlider = dialog.find('#chatu8-ai-tts-edge-rate');
    dom.ttsEdgeRateVal = dialog.find('#chatu8-ai-tts-edge-rate-val');
    dom.ttsEdgePitchSlider = dialog.find('#chatu8-ai-tts-edge-pitch');
    dom.ttsEdgePitchVal = dialog.find('#chatu8-ai-tts-edge-pitch-val');
    dom.ttsEdgePingBtn = dialog.find('#chatu8-ai-tts-edge-ping');
    dom.ttsEdgePingStatus = dialog.find('#chatu8-ai-tts-edge-ping-status');

    // ASR
    dom.asrSettingsPanel = dialog.find('#chatu8-ai-asr-settings');
    dom.asrMicBtn = dialog.find('#st-chatu8-ai-mic-btn');
    dom.asrConvModeSelect = dialog.find('#chatu8-ai-asr-conv-mode');
    dom.asrSilenceSlider = dialog.find('#chatu8-ai-asr-silence-timeout');
    dom.asrSilenceVal = dialog.find('#chatu8-ai-asr-silence-timeout-val');
    dom.asrVadSlider = dialog.find('#chatu8-ai-asr-vad-threshold');
    dom.asrVadVal = dialog.find('#chatu8-ai-asr-vad-threshold-val');
    dom.asrMaxKeepSlider = dialog.find('#chatu8-ai-asr-max-keep');
    dom.asrMaxKeepVal = dialog.find('#chatu8-ai-asr-max-keep-val');
    dom.asrLanguageSelect = dialog.find('#chatu8-ai-asr-language');
    dom.asrAppendSelect = dialog.find('#chatu8-ai-asr-append');
    dom.asrAutoSendCheckbox = dialog.find('#chatu8-ai-asr-auto-send');
    // ASR 麦克风测试
    dom.asrMicTestBtn = dialog.find('#chatu8-ai-asr-mic-test-btn');
    dom.asrMicTestMeter = dialog.find('#chatu8-ai-asr-mic-test-meter');
    dom.asrMicTestBar = dialog.find('#chatu8-ai-asr-meter-bar');
    dom.asrMicTestVadLine = dialog.find('#chatu8-ai-asr-meter-vad-line');
    dom.asrMicTestLabel = dialog.find('#chatu8-ai-asr-meter-label');
    dom.asrMicTestStatus = dialog.find('#chatu8-ai-asr-meter-status');

    // 独立窗口
    dom.checkDesktopPet = dialog.find('#chatu8-ai-desktop-pet');

    // 屏幕共享
    dom.checkScreenShare = dialog.find('#chatu8-ai-screen-share');
    dom.checkBrowserCapture = dialog.find('#chatu8-ai-browser-capture');
    dom.screenShareIndicator = dialog.find('#st-chatu8-ai-screen-share-indicator');
    dom.browserCaptureIndicator = dialog.find('#st-chatu8-ai-browser-capture-indicator');

    // 楼层信息
    dom.checkFloorMessage = dialog.find('#chatu8-ai-floor-message');
    dom.floorStatus = dialog.find('#chatu8-ai-floor-status');
    dom.floorCount = dialog.find('#chatu8-ai-floor-count');
    dom.floorIndicator = dialog.find('#st-chatu8-ai-floor-indicator');

    // 历史记录
    dom.newChatBtn = dialog.find('#st-chatu8-ai-new-chat');
    dom.historyBtn = dialog.find('#st-chatu8-ai-history-btn');
    dom.historyPanel = dialog.find('#st-chatu8-ai-history-panel');
    dom.historyCloseBtn = dialog.find('#st-chatu8-ai-history-close');
    dom.historyList = dialog.find('#st-chatu8-ai-history-list');
    dom.exportChatBtn = dialog.find('#st-chatu8-ai-export-chat');
    dom.selectAllBtn = dialog.find('#st-chatu8-ai-select-all');
    dom.deselectAllBtn = dialog.find('#st-chatu8-ai-deselect-all');

    // 聊天总结
    dom.summaryBtn = dialog.find('#st-chatu8-ai-summary-btn');
    dom.summaryManager = dialog.find('#st-chatu8-summary-manager');
}
