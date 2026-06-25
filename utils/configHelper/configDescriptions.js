/* eslint-disable no-undef */
// @ts-nocheck

/**
 * 插件配置参数的解释说明字典。
 * AI 助手在读取配置或者设置配置时，可以参考这里的含义来理解各项设置的作用。
 */
export const ConfigDescriptions = {
   // 基础显示和UI配置
   theme_id: "当前使用的主题预设ID（例如：'默认-夜间'）",
   generate_btn_style: "生成图片的按钮样式",
   image_frame_style: "发送到聊天框里的图片边框样式",
   collapse_style: "配置面板的折叠样式",
   displayMode: "展示模式，决定图片在聊天框中的显示效果",
   imageAlignment: "聊天框内的图片对齐方式 ('left', 'center', 'right')",
   imageSizeScale: "聊天框内的图片显示大小百分比 ('100', '75', '50', '25')",
   collapseImage: "是否默认折叠大图片 (布尔字符串 'true'/'false')",

   // 后端工作模式
   mode: "当前选择的图像生成后端，可选值为：'comfyui', 'novelai', 'sd', 'banana'",
   client: "客户端环境标识，常规为 'browser','jiuguan'决定了从哪里发起生图请求，如果从浏览器发情请求可能会碰到跨域问题",
   scriptEnabled: "主插件功能是否已开启 (布尔值)",

   // API 连接地址
   sdUrl: "Stable Diffusion WebUI (A1111) 的 API 地址",
   comfyuiUrl: "ComfyUI 的 API 服务地址",
   novelaiApi: "[敏感信息，不应返回/修改] NovelAI 的访问凭证 (API Key)",
   novelaiApi_id: "当前选择的 NovelAI 凭据别名，用于多账号管理",

   // 文本提取与触发词
   startTag: "图片触发时的起始标识符，如 'image###'",
   endTag: "图片触发时的结束标识符，如 '###'",
   insertOriginalText: "是否在生成的图片后保留插入原始内容 (布尔字符串)",
   enablePregen: "是否启用智能预生成机制以加快响应，在ai流式返回的途中捕获生图关键词立即预生成图片，加快生图进度，仅支持酒馆全局世界书的模式 (布尔字符串)",

   // 核心生成参数 - 尺寸和步数
   sd_csteps: "Stable Diffusion (SD) 生成步数",
   sd_cwidth: "Stable Diffusion (SD) 生成宽度",
   sd_cheight: "Stable Diffusion (SD) 生成高度",
   sd_cseed: "Stable Diffusion (SD) 随机种子（-1代表随机）",

   novelai_steps: "NovelAI (NAI) 生成步数",
   novelai_width: "NovelAI (NAI) 生成宽度",
   novelai_height: "NovelAI (NAI) 生成高度",
   novelai_seed: "NovelAI (NAI) 随机种子（0代表随机）",

   comfyui_steps: "ComfyUI 生成步数",
   comfyui_width: "ComfyUI 生成宽度",
   comfyui_height: "ComfyUI 生成高度",
   comfyui_seed: "ComfyUI 随机种子（0代表随机）",

   // 核心生成参数 - 采样、权重
   sdCfgScale: "SD 提示词引导比例 (CFG Scale)",
   cfg_comfyui: "ComfyUI 提示词引导比例 (CFG Scale)",
   nai3Scale: "NAI 提示词引导比例 (Scale)",
   cfg_rescale: "NAI 高级参数：CFG Rescale 比例",
   AQT_comfyui: "ComfyUI 默认质量正面提示词",
   UCP_comfyui: "ComfyUI 默认质量负面提示词",

   workerid: "使用的 ComfyUI 工作流预设 ID",
   editWorkerid: "使用的 ComfyUI 局部重绘/编辑工作流预设 ID",
   MODEL_NAME: "ComfyUI 选定的 Checkpoint 大模型名称",
   comfyuisamplerName: "ComfyUI 选定的采样器名称",
   comfyui_scheduler: "ComfyUI 选定的调度器名称",
   comfyui_vae: "ComfyUI 选定的 VAE 模型名称",

   sd_cchatu_8_model: "SD 选定的 Checkpoint 大模型名称",
   sd_cchatu_8_samplerName: "SD 选定的采样器名称",
   sd_cchatu_8_vae: "SD 选定的 VAE 模型名称（'Automatic' 表示自动选择）",
   sd_cchatu_8_scheduler: "SD 选定的调度器名称",
   sd_cchatu_8_upscaler: "SD 选定的放大算法（如 'Latent'）",
   sd_cupscale_factor: "SD 放大倍率（'1' 表示不放大）",
   sd_chires_fix: "SD 是否启用高清修复 Hires Fix (布尔字符串 'true'/'false')",
   sd_chires_steps: "SD 高清修复的额外步数（'0' 使用默认）",
   sd_cdenoising_strength: "SD 高清修复/图生图的去噪强度 (0-1)",
   sd_cclip_skip: "SD CLIP Skip 层数（常用 '1' 或 '2'）",
   sd_cadetailer: "SD 是否启用 ADetailer 面部细节修复 (布尔字符串 'true'/'false')",
   restoreFaces: "SD 是否启用内置面部修复 Restore Faces (布尔字符串 'true'/'false')",
   st_chatu8_sd_auth: "SD WebUI 的认证信息（用户名:密码格式，用于需要身份验证的情况）",

   novelaimode: "NAI 生图模型版本，如 'nai-diffusion-4-5-full'",
   novelai_sampler: "NAI 选定的采样器，如 'k_euler'",

   // NAI Vibe Transfer / 风格参考参数
   nai3VibeTransfer: "NAI 是否开启 Vibe Transfer 风格转换 (布尔字符串 'true'/'false')",
   InformationExtracted: "NAI Vibe 提取信息比例 (0-1)",
   ReferenceStrength: "NAI Vibe 参考强度 (0-1)",
   nai3Variety: "NAI 高级参数：多样性提升 Variety (布尔字符串 'true'/'false')",
   nai3Deceisp: "NAI 高级参数：细节提升 Deceisp (布尔字符串 'true'/'false')",
   enableVibeGroupTransfer: "NAI 是否启用 Vibe 组合转换（多个 Vibe 同时生效）(布尔字符串 'true'/'false')",
   normalizeRefStrength: "NAI 是否归一化 Vibe 参考强度 (布尔字符串 'true'/'false')",
   nai3CharRef: "NAI 是否启用角色参考功能 (布尔字符串 'true'/'false')",
   nai3StylePerception: "NAI 是否启用风格感知功能 (布尔字符串 'true'/'false')",
   AI_use_coords: "NAI 是否使用ai自动坐标区域来控制生成内容的位置 true代表使用ai而不是设置的坐标 (布尔字符串 'true'/'false')",
   novelaisite: "NAI 站点选择：'官网' 使用官方服务器，其他值使用第三方站点",
   novelaiOtherSite: "NAI 第三方站点地址（仅当 novelaisite 不为'官网'时有效）",
   enableCloudQueue: "是否启用云队列模式（排队生图）,当所有拥有相同key的用户请求请求会在云端进行排队，避免拥堵长生novelai的429报错(布尔字符串 'true'/'false')",
   cloudQueueUrl: "云队列服务的 URL 地址",
   cloudQueueGreeting: "云队列等待中的提示文字",
   showQueueGreeting: "是否显示云队列等待提示 (布尔字符串 'true'/'false')",
   addFurryDataset: "NAI 是否添加 Furry 数据集支持 (布尔字符串 'true'/'false')",

   // 正则与替换
   prompt_replace_id: "当前选用的文本替换规则预设 ID",
   current_regex_profile: "当前选用的正则表达式预设 ID",

   // 修图 / 图生图设置
   inpaint_denoise: "ComfyUI 局部重绘的重绘幅度 (Denoise)",
   inpaint_brush_size: "局部重绘的笔刷像素大小",
   inpaint_positive_prompt: "ComfyUI 局部重绘的正面提示词（描述想要重绘成什么）",
   inpaint_negative_prompt: "ComfyUI 局部重绘的负面提示词（描述不想要的内容）",
   c_fenwei: "ComfyUI IP-Adapter 氛围权重 (0-2)，控制参考图的氛围影响程度",
   c_xijie: "ComfyUI IP-Adapter 细节权重 (0-2)，控制参考图的细节还原程度",
   c_idquanzhong: "ComfyUI IP-Adapter ID权重 (0-2)，控制人物身份一致性的强度",
   c_quanzhong: "ComfyUI IP-Adapter 一般权重 (0-2)，控制整体参考强度",
   ipa: "ComfyUI IP-Adapter 模式，如 'STANDARD (medium strength)'",
   comfyuiCLIPName: "ComfyUI 选定的 CLIP 模型名称",

   // 大语言模型 (LLM) 智能生图与翻译相关
   autoLLMImageGen: "是否自动请求 LLM 来解析提示词并生图，当正文生成完毕，插件会自动调用llm来生成绘图提示词，仅支持非同层的角色卡游玩。同层 ：所以信息显示在一个酒馆楼层，又角色卡作者管理所有消息。 (布尔字符串 'true'/'false')",

   ai_temperature: "LLM 随机性参数 Temperature (0-2)",
   current_llm_profile: "当前使用的 LLM 接口及参数配置文件名",
   translation_model: "Tag 翻译选择的 LLM 模型名",
   ai_private: "是否将 LLM 提示词标记为 Private (布尔字符串 'true'/'false')",
   ai_top_p: "LLM Top P 采样参数 (0-1)，控制候选词的概率范围",
   ai_presence_penalty: "LLM 存在惩罚 (0-2)，降低已出现过词汇的概率",
   ai_frequency_penalty: "LLM 频率惩罚 (0-2)，降低高频词汇的重复概率",
   ai_stream: "LLM 是否启用流式输出 (布尔字符串 'true'/'false')",
   ai_token: "[敏感信息] LLM 的 API Token / 密钥",
   ai_test_system: "LLM 测试用的系统消息内容",
   ai_test_user: "LLM 测试用的用户消息内容",
   ai_test_output: "LLM 上一次测试的输出结果",
   llm_history_depth: "LLM 发送历史对话的层数（0表示不发送历史，数字越大上下文越多但 Token 消耗越大）",
   translation_system_prompt: "Tag 翻译功能使用的系统提示词模板",
   llm_request_type_configs: "四种 LLM 请求类型的配置集合（image_gen/char_design/char_display/char_modify/translation/tag_modify），每种可分配不同的 API 配置预设和上下文预设",
   test_context_profiles: "LLM 测试上下文预设集合，每个预设包含多个消息条目（角色、内容、触发模式等）",
   current_test_context_profile: "当前选用的 LLM 测试上下文预设名称",
   chatu8_ai_assistant: "智绘姬 AI 助手专属配置对象，包含 api_url(API地址)、api_key(密钥)、model(模型)、bypass_proxy(是否绕过代理)、stream(是否流式)、system_prompt(系统提示词)",

   // 手势与快捷功能
   gestureEnabled: "是否开启手势操作功能 (布尔值)",
   clickToPreview: "是否允许点击图片进入放大预览 (布尔字符串 'true'/'false')",
   longPressToEdit: "是否开启长按图片进行编辑 (布尔字符串 'true'/'false')",
   enable_chatu8_fab: "是否开启悬浮球操作 (布尔值)",
   enable_chatu8_desktop_pet: "是否启用智绘姬独立窗口模式，使用 Document Picture-in-Picture API 将角色弹出到始终置顶的画中画窗口显示（需要 Chrome 116+ / Edge 116+）(布尔值)",
   clickTriggerEnabled: "是否开启点击触发功能，电脑双击正文，或者手机三击正文，捕获文字进行生图（点击屏幕区域触发操作）(布尔值)",
   gestureShowRecognition: "是否显示手势识别提示信息 (布尔值)",
   gestureShowTrail: "是否显示手势轨迹线 (布尔值)",
   gestureTrailColor: "手势轨迹线的颜色（CSS颜色值，如 '#00ff00'）",
   gestureMatchThreshold: "手势匹配阈值 (0-100)，越低越容易匹配",
   gesture1: "手势模板1的网格数据（10x10 二值矩阵）",
   gesture2: "手势模板2的网格数据（10x10 二值矩阵）",
   zidongdianji: "自动点击生图功能开关 (布尔字符串 'true'/'false')",
   zidongdianji2: "自动点击生图功能2开关 (布尔字符串 'true'/'false')",

   // 扩展功能
   dbclike: "开启后当用户生成图片之后会隐藏生成图片的点击按钮，用双击图片重新生图的方式取代 (布尔字符串 'true'/'false')",
   newlineFixEnabled: "是否启用换行符修复功能 (布尔字符串 'true'/'false')",
    cache: "缓存模式设置（'1' 启用缓存）",
    jiuguanchucun: "是否使用酒馆存储来保存图片 (布尔字符串 'true'/'false')",
    vibeJiuguanchucun: "是否使用酒馆存储来保存 Vibe 数据、Vibe 预览图和 Vibe 组封面 (布尔字符串 'true'/'false')",
    convertToJpegStorage: "是否将图片转换为 JPEG 格式存储以减小体积 (布尔字符串 'true'/'false')",
   jiuguanStorage: "酒馆存储的数据对象",
   imageGenInterval: "连续生图的间隔时间（毫秒），防止请求过快，默认 100",
   defaultCharDemand: "默认的角色需求描述文本，仅在用户未输入任何内容时生效",
   defaultImageDemand: "默认的图片需求描述文本，仅在用户未输入任何内容时生效",

   // 大对象/集合类配置（供 browse 时附带说明）
   workers: "ComfyUI 工作流预设集合，包含用户定义的所有工作流配置",
   yushe: "提示词预设集合，包含正面/负面提示词等配置模板",
   themes: "UI 主题预设集合",
   fabThemes: "悬浮球主题预设集合",
   cacheStorageMigrated: "标记 cache 数据是否已迁移到 configDatabase（comfyuiCache 和 sdCache 已不再存储在 settings.json 中）",
   prompt_replace: "文本替换规则集合",
   regex_profiles: "正则表达式替换规则集合",
   llm_profiles: "LLM 接口配置集合，包含多个 API 端点/密钥配置",

   // Banana / grok 配置
   banana: "Banana/grok 图像生成的完整配置对象，包含 apiKey、apiUrl、model、videoModel、aspectRatio、对话预设等",
   bananaCharacterPresets: "Banana 角色预设集合，每个预设包含触发词和参考对话",
   bananaCharacterPresetId: "当前选用的 Banana 角色预设 ID",

   // 配置档案系统
   novelai_profiles: "NovelAI 配置档案集合，每个档案包含完整的 NAI 参数（API Key、模型、采样器、Vibe等）",
   novelai_profile_id: "当前选用的 NovelAI 配置档案 ID",
   comfyui_profiles: "ComfyUI 配置档案集合，每个档案包含完整的 ComfyUI 参数（地址、模型、采样器、工作流等）",
   comfyui_profile_id: "当前选用的 ComfyUI 配置档案 ID",

   // Vibe 预设
   vibePresets: "Vibe Transfer 预设集合，每个预设包含模型、信息提取率、强度、参考图等",
   vibePresetId: "当前选用的 Vibe Transfer 预设 ID",

   // 悬浮球详细配置
   chatu8_fab_theme: "悬浮球当前使用的主题名称",
   chatu8_fab_bg_color: "悬浮球背景颜色（CSS颜色值）",
   chatu8_fab_icon_color: "悬浮球图标颜色（CSS颜色值）",
   chatu8_fab_icon_image_id: "悬浮球自定义图片图标的配置图片 ID，图片保存到酒馆存储",
   chatu8_fab_opacity: "悬浮球不透明度 (0-1)",
   chatu8_fab_size: "悬浮球大小配置对象，包含 desktop（桌面端像素）和 mobile（移动端像素）",
   chatu8_fab_position: "悬浮球位置配置对象，包含桌面端和移动端的 top/left 坐标",

   // 词库搜索设置
   vocabulary_search_startswith: "词库搜索是否使用前缀匹配模式 (布尔字符串 'true'/'false')",
   vocabulary_search_limit: "词库搜索最大返回结果数量",
   vocabulary_search_sort: "词库搜索排序方式（如 'hot_desc' 按热度降序）",

   // 世界书与正则
   worldBookList: "世界设定书条目集合",
   worldBookList_id: "当前选用的世界设定书条目 ID",
   regexTestMode: "正则测试模式是否开启 (布尔值)",

   // 角色AI 与 服装AI
   characterAI: "角色 AI 配置对象，包含 model(模型)、temperature(温度)、systemPrompt(系统提示词)、lastPrompt(上次提示词)",
   outfitAI: "服装 AI 配置对象，包含 model(模型)、temperature(温度)、systemPrompt(系统提示词)、lastPrompt(上次提示词)",

   // 其他杂项
   lastTab: "记住上次打开的设置标签页名称",
};

/**
 * st-chatu8 插件的详细项目说明，供 AI 理解本项目的功能和架构。
 */
export const ProjectDescription = `
【项目名称】st-chatu8 (智绘姬)
【项目类型】SillyTavern (酒馆) 第三方扩展插件
【核心功能】在 SillyTavern 聊天过程中自动/手动生成图片（AI绘图）

【支持的图像生成后端 (mode)】
1. ComfyUI — 本地部署的节点式AI绘图工具，支持自定义工作流，功能最强大
   - 需要配置: comfyuiUrl（ComfyUI服务地址，默认 http://localhost:8188）
   - 需要连接后选择: 模型(MODEL_NAME)、采样器、VAE、调度器
   - 需要配置工作流预设(workerid)
2. NovelAI (NAI) — 在线AI绘图服务，需要付费API Key
   - 需要配置: novelaiApi（API Key）
   - 可选模型: nai-diffusion-4-5-full / nai-diffusion-4-5-curated 等
3. Stable Diffusion WebUI (SD/A1111) — 本地部署的SD界面
   - 需要配置: sdUrl（SD WebUI地址，默认 http://localhost:7860）
   - 需要连接后选择: 模型、采样器
4. Banana/grok — 基于 Gemini 等模型的图像生成
   - 需要配置: banana.apiUrl, banana.apiKey, banana.model

【LLM (大语言模型) 功能】
- 用于将聊天文本自动翻译成绘图提示词(prompt)
- 支持多个 LLM 配置预设(llm_profiles)，可以配置不同的API端点
- 每个配置包含: api_url, api_key, model, temperature, top_p, max_tokens 等
- 支持多种请求类型: 正文图片生成、角色设计、服装展示、翻译、Tag修改

【设置面板标签页 → 关键控件映射】
- 主要设置(main): scriptEnabled(开关), mode(后端选择), startTag/endTag(触发标记), imageAlignment(图片对齐), autoLLMImageGen(自动LLM生图), enablePregen(流式预生成)
- SD(sd): sdUrl(API地址), testSd按钮(连接), sd_cchatu_8_model(模型), sd_cchatu_8_samplerName(采样器), sd_cwidth/cheight/csteps/cseed(尺寸步数种子), sdCfgScale(CFG)
- NovelAI(novelai): novelaiApi(API Key), novelaimode(模型版本), novelai_sampler(采样器), Schedule(噪点表), nai3Scale(引导比例), novelai_width/height/steps/seed, nai3VibeTransfer(Vibe参考)
- ComfyUI(comfyui): comfyuiUrl(API地址), testComfyui按钮(连接), MODEL_NAME(模型), comfyuisamplerName(采样器), comfyui_vae(VAE), workerid(工作流预设), comfyui_width/height/steps/seed, cfg_comfyui(CFG)
- Banana(banana): banana.apiUrl(API地址), banana.apiKey(密钥), banana.model(模型)
- LLM(llm): llm_profiles(配置预设集合), current_llm_profile(当前预设), 每个预设含api_url/api_key/model/temperature/top_p/max_tokens

【新手配置引导流程（按优先级）】
1. 先在「主要设置」将 scriptEnabled 开启，选择 mode（后端）
2. 切到对应后端页面(SD/NovelAI/ComfyUI/Banana)，填写 API 地址或密钥
3. 点击连接按钮获取模型列表，选择模型和采样器
4. 切到「LLM」页面配置大语言模型（用于翻译提示词），填写 api_url、api_key、model
5. 保存配置，测试生图

【关键配置路径示例】
- mode: 当前后端模式
- scriptEnabled: 插件是否启用
- comfyuiUrl / sdUrl: 后端地址
- llm_profiles.默认.api_url: LLM API地址
- llm_profiles.默认.api_key: LLM API密钥
- llm_profiles.默认.model: LLM 模型名称
- workers: ComfyUI工作流预设集合
- yushe: 提示词预设集合
`.trim();
