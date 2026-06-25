// @ts-nocheck
import { json, json2, json3, jsonvae, jsonweilinvae, jsonweldf, editwk } from "./settings/workers.js";
import { themePresets } from "./settings/themePresets.js";

export const extensionName = "st-chatu8";
export const extensionFolderPath = `scripts/extensions/third-party/${extensionName}`;

export const EventType = {
    GENERATE_IMAGE_REQUEST: 'generate-image-request',
    GENERATE_IMAGE_RESPONSE: 'generate-image-response',
};

export const eventNames = {
    REGEX_TEST_MESSAGE: 'regex-st-chatu8-test-message',
    REGEX_RESULT_MESSAGE: 'regex-st-chatu8-result-message',
    // LLM 相关事件
    LLM_TEST_RESULT: 'ch-llm-test-result',
    LLM_GET_PROMPT_REQUEST: 'ch-llm-get-prompt-request',
    LLM_GET_PROMPT_RESPONSE: 'ch-llm-get-prompt-response',
    LLM_EXECUTE_REQUEST: 'ch-llm-execute-request',
    LLM_EXECUTE_RESPONSE: 'ch-llm-execute-response',

    // 四种 LLM 请求类型事件
    // 正文图片生成
    LLM_IMAGE_GEN_REQUEST: 'ch-llm-image-gen-request',
    LLM_IMAGE_GEN_RESPONSE: 'ch-llm-image-gen-response',
    LLM_IMAGE_GEN_GET_PROMPT_REQUEST: 'ch-llm-image-gen-get-prompt-request',
    LLM_IMAGE_GEN_GET_PROMPT_RESPONSE: 'ch-llm-image-gen-get-prompt-response',
    // 角色设计和服装设计
    LLM_CHAR_DESIGN_REQUEST: 'ch-llm-char-design-request',
    LLM_CHAR_DESIGN_RESPONSE: 'ch-llm-char-design-response',
    LLM_CHAR_DESIGN_GET_PROMPT_REQUEST: 'ch-llm-char-design-get-prompt-request',
    LLM_CHAR_DESIGN_GET_PROMPT_RESPONSE: 'ch-llm-char-design-get-prompt-response',
    // 角色和服装展示
    LLM_CHAR_DISPLAY_REQUEST: 'ch-llm-char-display-request',
    LLM_CHAR_DISPLAY_RESPONSE: 'ch-llm-char-display-response',
    LLM_CHAR_DISPLAY_GET_PROMPT_REQUEST: 'ch-llm-char-display-get-prompt-request',
    LLM_CHAR_DISPLAY_GET_PROMPT_RESPONSE: 'ch-llm-char-display-get-prompt-response',
    // 角色/服装修改
    LLM_CHAR_MODIFY_REQUEST: 'ch-llm-char-modify-request',
    LLM_CHAR_MODIFY_RESPONSE: 'ch-llm-char-modify-response',
    LLM_CHAR_MODIFY_GET_PROMPT_REQUEST: 'ch-llm-char-modify-get-prompt-request',
    LLM_CHAR_MODIFY_GET_PROMPT_RESPONSE: 'ch-llm-char-modify-get-prompt-response',
    // 翻译请求事件
    LLM_TRANSLATION_REQUEST: 'ch-llm-translation-request',
    LLM_TRANSLATION_RESPONSE: 'ch-llm-translation-response',
    LLM_TRANSLATION_GET_PROMPT_REQUEST: 'ch-llm-translation-get-prompt-request',
    LLM_TRANSLATION_GET_PROMPT_RESPONSE: 'ch-llm-translation-get-prompt-response',
    // Tag修改请求事件
    LLM_TAG_MODIFY_REQUEST: 'ch-llm-tag-modify-request',
    LLM_TAG_MODIFY_RESPONSE: 'ch-llm-tag-modify-response',
    LLM_TAG_MODIFY_GET_PROMPT_REQUEST: 'ch-llm-tag-modify-get-prompt-request',
    LLM_TAG_MODIFY_GET_PROMPT_RESPONSE: 'ch-llm-tag-modify-get-prompt-response',
    // 人设生成
    LLM_PERSONA_GEN_REQUEST: 'ch-llm-persona-gen-request',
    LLM_PERSONA_GEN_RESPONSE: 'ch-llm-persona-gen-response',
    LLM_PERSONA_GEN_GET_PROMPT_REQUEST: 'ch-llm-persona-gen-get-prompt-request',
    LLM_PERSONA_GEN_GET_PROMPT_RESPONSE: 'ch-llm-persona-gen-get-prompt-response',
    // User 人设生成
    LLM_USER_PERSONA_GEN_REQUEST: 'ch-llm-user-persona-gen-request',
    LLM_USER_PERSONA_GEN_RESPONSE: 'ch-llm-user-persona-gen-response',
    LLM_USER_PERSONA_GEN_GET_PROMPT_REQUEST: 'ch-llm-user-persona-gen-get-prompt-request',
    LLM_USER_PERSONA_GEN_GET_PROMPT_RESPONSE: 'ch-llm-user-persona-gen-get-prompt-response',
    // TTS 语音合成事件
    TTS_REQUEST: 'ch-tts-request',
    TTS_RESPONSE: 'ch-tts-response',
    TTS_STOP: 'ch-tts-stop',
    TTS_STATE_CHANGED: 'ch-tts-state-changed',
    // ASR 语音输入事件
    ASR_START: 'ch-asr-start',
    ASR_STOP: 'ch-asr-stop',
    ASR_RESULT: 'ch-asr-result',
    ASR_STATE_CHANGED: 'ch-asr-state-changed',
    ASR_VOLUME: 'ch-asr-volume',
    ASR_ERROR: 'ch-asr-error',
    // 角色/服装数据外部录入接口
    CHAR_DATA_IMPORT_REQUEST: 'ch-char-data-import-request',
    CHAR_DATA_IMPORT_RESPONSE: 'ch-char-data-import-response',
};

// LLM 请求类型枚举
export const LLMRequestTypes = {
    IMAGE_GEN: 'image_gen',         // 正文图片生成
    CHAR_DESIGN: 'char_design',     // 角色设计和服装设计
    CHAR_DISPLAY: 'char_display',   // 角色和服装展示
    CHAR_MODIFY: 'char_modify',     // 角色/服装修改
    TRANSLATION: 'translation',     // 翻译
    TAG_MODIFY: 'tag_modify',       // Tag修改
    AI_ASSISTANT: 'ai_assistant',   // 智绘姬助手（自定义模式）
    PERSONA_GEN: 'persona_gen',     // 角色人设生成
    USER_PERSONA_GEN: 'user_persona_gen', // User 人设生成
    CHAT_SUMMARY: 'chat_summary',   // 聊天总结
};



// 导出主题预设供其他模块使用
export const defaultThemes = themePresets;

export const defaultSettings = {
    theme_id: '默认-夜间',
    themes: defaultThemes,
    generate_btn_style: '默认',
    image_frame_style: '无样式',
    collapse_style: '默认',
    scriptEnabled: false,
    helpTipsEnabled: 'true', // 设置项帮助提示开关，默认开启
    characterAI: { model: "mistral", temperature: 0.8, systemPrompt: "", lastPrompt: "" },
    outfitAI: { model: "mistral", temperature: 0.8, systemPrompt: "", lastPrompt: "" },

    newlineFixEnabled: "true",
    yushe: { "默认": { "fixedPrompt": '', "fixedPrompt_end": '', "negativePrompt": '' }, "小马模型默认": { "fixedPrompt": 'score_9,score_8_up,score_7_up,anime', "fixedPrompt_end": '', "negativePrompt": 'score_4,score_3,score_2,score_1,score_5' } },
    yusheid_sd: "默认",
    yusheid_novelai: "默认",
    yusheid_comfyui: "默认",
    randomYushe: "false",
    aiAutonomousResolution: true,  // AI自主分辨率：开启后，从提示词中提取到的尺寸会覆盖设置中的分辨率参数
    prompt_replace: { "默认": { "text": '触发词1=前置前|插入词1\n触发词2=前置后|插入词2\n触发词3=替换|替换词3\n触发词4=替换|\n触发词5=替换分角色|替换词5\n触发词6=后置前|插入词6\n触发词7=后置后|插入词7\n触发词8=最后置|插入词8' } },
    prompt_replace_id: "默认",
    vibePresets: { "默认": { model: "nai-diffusion-4-5-curated", infoExtract: 1.0, strength: 0.6, imageId: null, vibeDataId: null } },
    vibePresetId: "默认",
    regex_profiles: { "默认": { beforeAfterRegex: '', textRegex: '' } },
    current_regex_profile: "默认",
    word_replacement_profiles: {
        "默认": {
            textReplacement: "肉棒=🥒\n小穴=🌸\n女孩=♀👶🏻\n少女=♀🧒🏻\n男孩=♂👶🏻\n正太=♂👶🏻\n小孩子=👧🏻\n乱伦=⚠️💘\n色情=🔞\n岁=🎄\n小学=🏬\n小学生=🧒🏻\n女儿=👧🏼\n儿子=👦🏼\n萝莉=♀👶🏻\n幼女=♀👶🏻\n萝莉=♀👶🏻",
            aiReplacement: "sf_=\nsāfe&="
        }
    },
    current_word_replacement_profile: "默认",
    regexTestMode: false,
    mode: 'comfyui',
    client: 'browser',
    cache: "1",
    sdUrl: 'http://localhost:7860',
    st_chatu8_sd_auth: '',
    comfyuiUrl: 'http://localhost:8188',
    novelaiApi: '000000',
    novelaiApi_id: '000000',
    startTag: 'image###',
    endTag: '###',
    nai3Scale: '10',
    sdCfgScale: '7',
    sm: "true",
    dyn: 'true',
    cfg_rescale: '0.18',
    AQT_sd: 'best quality, amazing quality, very aesthetic, absurdres',
    UCP_sd: 'bad proportions, out of focus, username, text, bad anatomy, lowres, worstquality, watermark, cropped, bad body, deformed, mutated, disfigured, poorly drawn face, malformed hands, extra arms, extra limb, missing limb, too many fingers, extra legs, bad feet, missing fingers, fused fingers, acnes, floating limbs, disconnected limbs, long neck, long body, mutation, ugly, blurry, low quality, sketches, normal quality, monochrome, grayscale, signature, logo, jpeg artifacts, unfinished, displeasing, chromatic aberration, extra digits, artistic error, scan, abstract, photo, realism, screencap',
    AQT_novelai: 'best quality, amazing quality, very aesthetic, absurdres',
    UCP_novelai: 'Heavy',
    addFurryDataset: 'false',
    AQT_comfyui: 'best quality, amazing quality, very aesthetic, absurdres',
    UCP_comfyui: 'bad proportions, out of focus, username, text, bad anatomy, lowres, worstquality, watermark, cropped, bad body, deformed, mutated, disfigured, poorly drawn face, malformed hands, extra arms, extra limb, missing limb, too many fingers, extra legs, bad feet, missing fingers, fused fingers, acnes, floating limbs, disconnected limbs, long neck, long body, mutation, ugly, blurry, low quality, sketches, normal quality, monochrome, grayscale, signature, logo, jpeg artifacts, unfinished, displeasing, chromatic aberration, extra digits, artistic error, scan, abstract, photo, realism, screencap',
    sd_csteps: '28',
    sd_cwidth: '1024',
    sd_cheight: '1024',
    sd_cseed: '-1',
    novelai_steps: '28',
    novelai_width: '1024',
    novelai_height: '1024',
    novelai_seed: '0',
    comfyui_steps: '28',
    comfyui_width: '1024',
    comfyui_height: '1024',
    comfyui_seed: '0',
    // ComfyUI 局部重绘配置
    inpaint_denoise: '0.75',
    // 新版weilin节点的lora报错修复
    weilin_lora_fix: 'false',
    inpaint_brush_size: 30,
    inpaint_positive_prompt: '',      // 局部重绘正面提示词
    inpaint_negative_prompt: '',      // 局部重绘负面提示词
    cfg_comfyui: '6',
    sd_cchatu_8_model: '连接后选择',
    sd_cchatu_8_vae: 'Automatic',
    sd_cchatu_8_scheduler: '连接后选择',
    sd_cchatu_8_upscaler: 'Latent',
    sd_cupscale_factor: '1',
    sd_chires_fix: 'false',
    sd_chires_steps: '0',
    sd_cdenoising_strength: '0.7',
    sd_cclip_skip: '2',
    sd_cadetailer: 'false',
    restoreFaces: 'false',
    sd_cchatu_8_samplerName: 'DPM++ 2M',
    comfyuisamplerName: '连接后选择',
    comfyuiCLIPName: '连接后选择',
    comfyui_scheduler: '连接后选择',
    comfyui_vae: '连接后选择',
    novelai_sampler: "k_euler",
    zidongdianji: "false",
    zidongdianji2: "false",
    longPressToEdit: "false",
    clickToPreview: "true",
    nai3VibeTransfer: "false",
    enableVibeGroupTransfer: "false",
    normalizeRefStrength: "false",
    nai3CharRef: "false",
    nai3StylePerception: "false",
    InformationExtracted: '0.3',
    ReferenceStrength: "0.6",
    nai3Deceisp: "true",
    nai3Variety: "true",
    Schedule: "karras",
    MODEL_NAME: "连接后选择",
    c_fenwei: "0.8",
    c_xijie: "0.8",
    c_idquanzhong: "1.10",
    c_quanzhong: "0.8",
    ipa: "STANDARD (medium strength)",
    dbclike: "false",
    collapseImage: "false",
    workers: {
        "默认": json,
        "默认-独立VAE": jsonvae,
        "默认人物一致": json2,
        "面部细化": json3,
        "新版默认": jsonweldf,
        "新weilin-vae": jsonweilinvae,
        "图像编辑": editwk
    },
    workerid: "新版默认",
    worker: jsonweldf,
    // 修图预设配置
    editWorkerid: "图像编辑",
    editWorker: editwk,
    novelaimode: "nai-diffusion-4-5-full",
    novelaisite: "官网",
    novelaiOtherSite: "http://localhost:9696/get-new-token",
    enableCloudQueue: 'false',
    cloudQueueUrl: 'https://st-chatu-novelai-queue.hf.space',
    cloudQueueGreeting: '努力生成中~',
    showQueueGreeting: 'true',
    displayMode: "默认",
    heavyFrontendMode: "false",
    insertOriginalText: "false",
    tagthinkEcho: "false",  // tagthink回显：是否在图片标签前显示思考内容（不含regex行）
    historyKeepImageTag: false,  // 仅对生图请求生效：历史消息中保留 <image> 标签原文作为参考（当前正文仍按正则清理）
    enablePregen: "false",
    autoLLMImageGen: "false",  // 自动LLM请求生图
    imageAlignment: 'center',  // 图片对齐方式：left（靠左）、center（居中）、right（靠右）
    imageSizeScale: '100',  // 图片显示大小：100（自适应）、75（3/4）、50（1/2）、25（1/4）
    imageGenInterval: 100,  // 生图间隔时间（毫秒），默认为 0（无延迟）

    ai_temperature: 1,
    ai_top_p: 1.0,
    ai_presence_penalty: 0.0,
    ai_frequency_penalty: 0.0,
    ai_stream: 'false',
    ai_private: 'true',
    ai_token: '',
    ai_test_system: 'You are a helpful assistant.',
    ai_test_user: 'What is the capital of France?',
    ai_test_output: '',

    // 智绘姬专属配置
    chatu8_ai_assistant: {
        api_url: '',
        api_key: '',
        model: 'mistral',
        bypass_proxy: false, // 默认使用酒馆代理
        stream: true,        // 默认开启流式
        system_prompt: '你是智绘姬，一个可爱、聪明的AI助手，请用中文简短地回答用户的问题。'
    },

    // 智绘姬编号（初次使用时生成）
    chatu8_code: '',  // 存储智绘姬编号，如 "A3B9"

    // ASR 语音输入配置
    asr: {
        enabled: false,                    // 默认关闭，用户手动开启
        asrServerUrl: 'https://qwen-qwen3-asr-demo.ms.show',
        mode: 'vad',                       // vad=自动检测 / ptt=按住说话
        silenceTimeout: 1200,              // 静音超时 ms（500-3000）
        vadThreshold: 0.02,                // VAD 灵敏度（0.005-0.1）
        maxKeepDuration: 10,               // 最大保留时长 秒，截取末尾N秒（5-60）
        language: 'auto',                  // 识别语言
        appendMode: true,                  // true=追加 false=替换
        autoSend: true,                    // 识别后是否自动发送（false=仅填入输入框不发送）
        conversationMode: false,           // 多轮对话模式：自动发送+自动禁音+自动重新录音
    },

    // 资料库功能（新版：引用酒馆世界书，与 send_data 的 worldBookConfig 完全独立）
    knowledgeBaseConfig: {
        enabled: false,
        triggerDepth: 1,               // 触发深度：0=只用最后用户消息，N=向上再取N条历史消息
        worldBookSelections: {},
        worldEntrySelections: {}
    },

    llm_history_depth: 2,  // 发送历史层数，0表示不发送历史

    // 生图生涯统计
    imageGenStats: {
        backends: {
            sd: { success: 0, fail: 0 },
            comfyui: { success: 0, fail: 0 },
            banana: { success: 0, fail: 0 },
            novelai: { success: 0, fail: 0 }
        },
        total: { success: 0, fail: 0 },
        firstGenTime: null,
        lastGenTime: null,
        daily: {}
    },

    llm_profiles: {
        "默认": {
            api_url: "",
            api_key: "",
            model: "",
            temperature: 1.0,
            top_p: 1.0,
            max_tokens: 30000,
            stream: false,
            bypass_proxy: false  // 不通过酒馆代理，默认 false（使用代理）
        }
    },
    current_llm_profile: "默认",

    // 请求类型档案管理 - 保存多套请求类型配置方案
    llm_request_type_profiles: {
        "默认": {
            image_gen: { api_profile: "默认", context_profile: "默认" },
            char_design: { api_profile: "默认", context_profile: "默认" },
            char_display: { api_profile: "默认", context_profile: "默认" },
            char_modify: { api_profile: "默认", context_profile: "默认" },
            translation: { api_profile: "默认", context_profile: "默认" },
            tag_modify: { api_profile: "默认", context_profile: "默认" },
            ai_assistant: { api_profile: "默认", context_profile: "默认" },
            persona_gen: { api_profile: "默认", context_profile: "默认" },
            user_persona_gen: { api_profile: "默认", context_profile: "默认" },
            chat_summary: { api_profile: "默认", context_profile: "默认" }
        }
    },
    current_llm_request_type_profile: "默认",

    // 四种请求类型的配置 - 通过选择预设来配置
    llm_request_type_configs: {
        // 正文图片生成
        image_gen: {
            api_profile: "默认",      // 选择的 LLM API 配置预设名称
            context_profile: "默认"   // 选择的测试上下文预设名称
        },
        // 角色设计和服装设计
        char_design: {
            api_profile: "默认",
            context_profile: "默认"
        },
        // 角色和服装展示
        char_display: {
            api_profile: "默认",
            context_profile: "默认"
        },
        // 角色/服装修改
        char_modify: {
            api_profile: "默认",
            context_profile: "默认"
        },
        // 翻译
        translation: {
            api_profile: "默认",
            context_profile: "默认"
        },
        // Tag修改
        tag_modify: {
            api_profile: "默认",
            context_profile: "默认"
        },
        // 智绘姬助手（自定义模式）
        ai_assistant: {
            api_profile: "默认",
            context_profile: "默认"
        },
        // 人设生成
        persona_gen: {
            api_profile: "默认",
            context_profile: "默认"
        },
        // User 人设生成
        user_persona_gen: {
            api_profile: "默认",
            context_profile: "默认"
        },
        // 聊天总结
        chat_summary: {
            api_profile: "默认",
            context_profile: "默认"
        }
    },

    // 测试上下文配置(独立于LLM配置) - 新版本使用条目列表
    test_context_profiles: {
        "默认": {
            entries: [
                {
                    id: 'entry_1',
                    name: '系统提示',
                    role: 'system',      // 'system' | 'user' | 'assistant'
                    content: '',
                    enabled: true,
                    triggerMode: 'always', // 'always' | 'trigger'
                    triggerWords: '',      // 触发词（逗号分隔），仅在 triggerMode 为 'trigger' 时使用
                    andTriggerWords: ''    // 并列触发词（逗号分隔）
                }
            ]
        }
    },
    current_test_context_profile: "默认",

    // 翻译设置
    translation_model: 'mistral',
    translation_system_prompt: '你是标签翻译助手。将输入的英文标签翻译成中文。\n\n输出格式：JSON对象 {"英文":"中文", ...}\n\n规则：\n1. 保持输入顺序\n2. 只输出JSON，不加任何解释\n3. 确保JSON格式正确\n\n示例：\n输入：1girl, long hair, blue eyes\n输出：{"1girl":"一个女孩","long hair":"长发","blue eyes":"蓝色眼睛"}',

    AI_use_coords: "true",

    // 悬浮球主题预设
    fabThemes: {
        "自定义": {
            bgColor: '#ADD8E6',
            iconColor: '#FFFFFF',
            opacity: 1
        },
        "天空蓝": {
            bgColor: '#87CEEB',
            iconColor: '#FFFFFF',
            opacity: 0.9
        },
        "薄荷绿": {
            bgColor: '#98FB98',
            iconColor: '#2F4F4F',
            opacity: 0.85
        },
        "樱花粉": {
            bgColor: '#FFB7C5',
            iconColor: '#FFFFFF',
            opacity: 0.9
        },
        "暗夜紫": {
            bgColor: '#6A5ACD',
            iconColor: '#FFFFFF',
            opacity: 0.85
        },
        "琥珀橙": {
            bgColor: '#FFBF00',
            iconColor: '#4A3728',
            opacity: 0.9
        },
        "深邃黑": {
            bgColor: '#2C3E50',
            iconColor: '#ECF0F1',
            opacity: 0.9
        },
        "玻璃态": {
            bgColor: '#FFFFFF',
            iconColor: '#333333',
            opacity: 0.5
        },
        "荧光绿": {
            bgColor: '#39FF14',
            iconColor: '#000000',
            opacity: 0.8
        },
        "玫瑰金": {
            bgColor: '#B76E79',
            iconColor: '#FFFFFF',
            opacity: 0.9
        }
    },
    chatu8_fab_theme: '自定义',

    enable_chatu8_fab: true,
    enable_chatu8_fab_video: false,  // 默认禁用视频模式
    enable_chatu8_desktop_pet: false,  // 默认禁用独立窗口模式（需要 Electron 环境）
    chatu8_fab_bg_color: '#ADD8E6',
    chatu8_fab_icon_color: '#FFFFFF',
    chatu8_fab_icon_image_id: '',
    chatu8_fab_opacity: 1,
    chatu8_fab_size: {
        desktop: 50,
        mobile: 40
    },
    chatu8_fab_position: {
        desktop: { top: '65vh', left: '20px' },
        mobile: { top: '80vh', left: '10px' }
    },
    chatu8_fab_video_paths: {
        idle: `${extensionFolderPath}/html/settings/idle.chatu8`,
        dragging: `${extensionFolderPath}/html/settings/dragging.chatu8`
    },
    lastTab: 'main',
    // comfyuiCache 和 sdCache 已迁移到 configDatabase 独立存储
    // 不再存储在 settings.json 中以减小文件体积
    cacheStorageMigrated: false,  // 标记是否已完成迁移
    worldBookEnabled: "false",
    worldBookList: { "默认添加末尾": { "content": "" } },
    worldBookList_id: "默认添加末尾",
    vocabulary_search_startswith: "false",
    vocabulary_search_limit: 100,
    vocabulary_search_sort: 'hot_desc',
    jiuguanchucun: "false",
    vibeJiuguanchucun: "true",
    convertToJpegStorage: "false",
    jiuguanStorage: {},
    banana: {
        apiKey: '123456',
        apiUrl: 'http://localhost:8008',
        model: '',
        editModel: '',
        videoModel: '',
        aspectRatio: '1:1',
        useGrokFormat: "false",
        conversationPresetId: '默认',
        editPresetId: '默认',
        videoPresetId: '默认',
        conversationPresets: {
            "默认": {
                fixedPrompt: '',
                postfixPrompt: '',
                conversation: [
                    { user: { text: '', image: '' }, model: { text: '', image: '' } },
                    { user: { text: '', image: '' }, model: { text: '', image: '' } },
                    { user: { text: '', image: '' }, model: { text: '', image: '' } }
                ]
            }
        },
        // Banana 专属替换词设置
        prompt_replace: { "默认": { "text": '触发词1=前置前|插入词1\n触发词2=前置后|插入词2\n触发词3=替换|替换词3' } },
        prompt_replace_id: "默认",
    },
    bananaCharacterPresets: {
        "默认": {
            triggers: "触发词1|触发词2",
            conversation: {
                user: { text: '', image: '' },
                model: { text: '', image: '' }
            }
        }
    },
    bananaCharacterPresetId: '默认',
    gestureEnabled: false,
    clickTriggerEnabled: true,
    gesture1: [
        '1100000000',
        '1100000000',
        '1100000000',
        '1100000000',
        '1100000000',
        '1100000000',
        '1100000000',
        '1111111111',
        '1111111111',
        '0000000000',
    ],
    gesture2: [
        '0000000000',
        '1111111111',
        '1111111111',
        '1100000000',
        '1100000000',
        '1100000000',
        '1100000000',
        '1100000000',
        '1100000000',
        '1100000000',
    ],
    gestureShowRecognition: true,
    gestureShowTrail: true,
    gestureTrailColor: '#00ff00',
    gestureMatchThreshold: 60,
    defaultCharDemand: '',
    defaultImageDemand: '',

    // NovelAI 配置档案
    novelai_profiles: {
        "默认": {
            // NovelAI 设置
            novelaiApi: '000000',
            novelaisite: '官网',
            novelaiOtherSite: '',
            enableCloudQueue: 'false',
            cloudQueueUrl: '',
            cloudQueueGreeting: '',
            showQueueGreeting: 'true',
            novelaimode: 'nai-diffusion-4-5-full',
            novelai_sampler: 'k_euler',
            Schedule: 'karras',
            nai3Scale: '10',
            cfg_rescale: '0.18',
            AI_use_coords: 'true',
            sm: 'true',
            dyn: 'true',
            nai3Variety: 'true',
            nai3Deceisp: 'true',
            // Vibe Transfer
            enableVibeGroupTransfer: 'false',
            normalizeRefStrength: 'false',
            // 生成参数
            novelai_width: '1024',
            novelai_height: '1024',
            novelai_steps: '28',
            novelai_seed: '0'
        }
    },
    novelai_profile_id: "默认",

    // ComfyUI 配置档案
    comfyui_profiles: {
        "默认": {
            // 工作流
            workerid: '新版默认',
            worker: '',
            // 修图预设
            editWorkerid: '新版默认',
            editWorker: '',
            // ComfyUI 设置
            comfyuiUrl: 'http://localhost:8188',
            // 其他设置
            MODEL_NAME: '连接后选择',
            comfyuisamplerName: '连接后选择',
            comfyui_vae: '连接后选择',
            comfyui_scheduler: '连接后选择',
            comfyuiCLIPName: '连接后选择',
            // 生成参数
            comfyui_width: '1024',
            comfyui_height: '1024',
            comfyui_steps: '28',
            comfyui_seed: '0',
            cfg_comfyui: '6'
        }
    },
    comfyui_profile_id: "默认",
};

export const aiModels = [{ "name": "deepseek", "description": "DeepSeek V3.1 (Google Vertex AI)", "tier": "seed", "community": false, "aliases": ["deepseek-v3", "deepseek-v3.1", "deepseek-ai/deepseek-v3.1-maas"], "input_modalities": ["text"], "output_modalities": ["text"], "tools": true, "vision": false, "audio": false }, { "name": "deepseek-reasoning", "description": "DeepSeek R1 0528", "maxInputChars": 5000, "reasoning": true, "tier": "seed", "community": false, "aliases": ["deepseek-r1-0528", "us.deepseek.r1-v1:0"], "input_modalities": ["text"], "output_modalities": ["text"], "tools": false, "vision": false, "audio": false }, { "name": "gemini", "description": "Gemini 2.5 Flash Lite (Vertex AI)", "tier": "seed", "community": false, "aliases": ["gemini-2.5-flash-lite"], "input_modalities": ["text", "image"], "output_modalities": ["text"], "tools": true, "vision": true, "audio": false }, { "name": "gemini-search", "description": "Gemini 2.5 Flash with Google Search (Google Vertex AI)", "tier": "seed", "community": false, "aliases": ["searchgpt", "geminisearch"], "input_modalities": ["text", "image"], "output_modalities": ["text"], "tools": true, "vision": true, "audio": false }, { "name": "mistral", "description": "Mistral Small 3.1 24B", "tier": "anonymous", "community": false, "aliases": ["mistral-small-3.1-24b-instruct", "mistral-small-3.1-24b-instruct-2503"], "input_modalities": ["text"], "output_modalities": ["text"], "tools": true, "vision": false, "audio": false }, { "name": "nova-fast", "description": "Amazon Nova Micro", "community": false, "tier": "anonymous", "aliases": ["nova-micro-v1"], "input_modalities": ["text"], "output_modalities": ["text"], "tools": true, "vision": false, "audio": false }, { "name": "openai", "description": "OpenAI GPT-5 Mini", "tier": "anonymous", "community": false, "aliases": ["gpt-5-mini"], "input_modalities": ["text", "image"], "output_modalities": ["text"], "tools": true, "maxInputChars": 7000, "vision": true, "audio": false }, { "name": "openai-audio", "description": "OpenAI GPT-4o Mini Audio Preview", "maxInputChars": 10000, "voices": ["alloy", "echo", "fable", "onyx", "nova", "shimmer", "coral", "verse", "ballad", "ash", "sage", "amuch", "dan"], "tier": "seed", "community": false, "aliases": ["gpt-4o-mini-audio-preview"], "input_modalities": ["text", "image", "audio"], "output_modalities": ["audio", "text"], "tools": true, "vision": true, "audio": true }, { "name": "openai-fast", "description": "OpenAI GPT-5 Nano", "tier": "anonymous", "community": false, "aliases": ["gpt-5-nano"], "input_modalities": ["text", "image"], "output_modalities": ["text"], "tools": true, "maxInputChars": 5000, "vision": true, "audio": false }, { "name": "openai-large", "description": "OpenAI GPT-5 Chat", "maxInputChars": 10000, "tier": "seed", "community": false, "aliases": ["gpt-5-chat"], "input_modalities": ["text", "image"], "output_modalities": ["text"], "tools": true, "vision": true, "audio": false }, { "name": "openai-reasoning", "description": "OpenAI o4-mini (Azure Myceli)", "tier": "seed", "community": false, "aliases": ["o4-mini"], "reasoning": true, "supportsSystemMessages": false, "input_modalities": ["text", "image"], "output_modalities": ["text"], "tools": true, "vision": true, "audio": false }, { "name": "qwen-coder", "description": "Qwen 2.5 Coder 32B", "tier": "anonymous", "community": false, "aliases": ["qwen2.5-coder-32b-instruct"], "input_modalities": ["text"], "output_modalities": ["text"], "tools": true, "vision": false, "audio": false }, { "name": "roblox-rp", "description": "Llama 3.1 8B Instruct (Cross-Region)", "tier": "seed", "community": false, "aliases": ["llama-roblox", "llama-fast-roblox"], "input_modalities": ["text"], "output_modalities": ["text"], "tools": true, "vision": false, "audio": false }, { "name": "bidara", "description": "BIDARA (Biomimetic Designer and Research Assistant by NASA)", "tier": "anonymous", "community": true, "input_modalities": ["text", "image"], "output_modalities": ["text"], "tools": true, "vision": true, "audio": false }, { "name": "chickytutor", "description": "ChickyTutor AI Language Tutor - (chickytutor.com)", "tier": "anonymous", "community": true, "input_modalities": ["text"], "output_modalities": ["text"], "tools": true, "vision": false, "audio": false }, { "name": "evil", "description": "Evil", "uncensored": true, "tier": "seed", "community": true, "input_modalities": ["text", "image"], "output_modalities": ["text"], "tools": true, "vision": true, "audio": false }, { "name": "midijourney", "description": "MIDIjourney", "tier": "anonymous", "community": true, "input_modalities": ["text"], "output_modalities": ["text"], "tools": true, "vision": false, "audio": false }, { "name": "rtist", "description": "Rtist", "tier": "seed", "community": true, "input_modalities": ["text"], "output_modalities": ["text"], "tools": true, "vision": false, "audio": false }, { "name": "unity", "description": "Unity Unrestricted Agent", "uncensored": true, "tier": "seed", "community": true, "input_modalities": ["text", "image"], "output_modalities": ["text"], "tools": true, "vision": true, "audio": false }];
