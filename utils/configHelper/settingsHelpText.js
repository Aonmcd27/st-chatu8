/* eslint-disable no-undef */
// @ts-nocheck

/**
 * 设置项帮助文案字典（面向最终用户，支持 Markdown）
 *
 * 用法：
 *   key   : 设置项 <input>/<select> 的 id（与 label[for] 对应）
 *   value : 字符串（短文案，走小气泡 tooltip）
 *     或   : { short?: string, long?: string }
 *           - short 存在时，小气泡显示 short
 *           - long 存在时，点击问号打开模态弹框显示 long（支持 Markdown）
 *           - 只写 short   → 只弹小气泡
 *           - 只写 long    → 只弹模态弹框
 *           - 两者都写     → 悬停显示 short，点击显示 long
 *
 * Markdown 支持：long 字段支持完整 Markdown（项目内置 marked.js）
 *   - **加粗**  *斜体*  `代码`
 *   - 列表 - xxx
 *   - [链接](https://...)
 *   - ``` 代码块 ```
 *   - > 引用
 *
 * 未在此字典中的 id 不会显示问号图标，可渐进补充。
 */
export const SettingsHelpText = {
    // ===== 主要设置（main.html） =====

    scriptEnabled: {
        short: '插件总开关',
        long: `### 启用插件

插件的**总开关**。关闭后：
- 不会拦截聊天中的触发标记
- 不会自动生成图片
`
    },

    mode: {
        short: '选择图像生成后端',
        long: `### 生成模式

选择使用哪个**图像生成后端**：

- **SD** — Stable Diffusion WebUI (A1111) 本地部署
- **NovelAI** — NovelAI 在线服务（需付费订阅 + API Key）
- **ComfyUI** — 本地节点式工作流（自由度最高）
- **Banana / Grok** — 基于云端 API 的生图服务

> 不同模式会切换到对应的设置页面配置参数。`
    },

    client: {
        short: '选择请求发起方（浏览器 / 酒馆后端）',
        long: `### 客户端

决定生图 API 请求**从哪里发出**：

- **浏览器** — 前端直接请求图像生成 API
  - 优点：功能完整
  - 缺点：可能遇到跨域（CORS）问题

- **酒馆** — 通过 SillyTavern 后端代理转发
  - 优点：无跨域问题
  - 缺点：部分高级功能可能受限

> 💡 遇到跨域错误时切换到"酒馆"试试。`
    },

    dbclike: '开启后隐藏聊天里的生图按钮，改为**双击图片**触发重新生成',

    collapseImage: '开启后生成的图片默认折叠，会有一个折叠框点击后再展开',

    zidongdianji: '检测到触发标记时**自动点击**生成按钮，无需手动操作',

    zidongdianji2: {
        short: '激进版自动点击（一般不建议开启）',
        long: `### 自动点击（高级）

⚠️ **不建议常规开启**

比普通自动点击更激进的触发模式，可能导致：
- 频繁重复触发
- 意外消耗 API 额度

只在你**明确知道自己在做什么**时才开启。`
    },

    longPressToEdit: '**长按**已生成的图片，弹出编辑框以修改 tag（开启更多功能的前置项）',

    clickToPreview: '**单击**图片上半部分弹出大图预览，可左右切换查看其他图片',

    newlineFixEnabled: '修复某些情况下 `###` 结束标记会单独占一行的显示异常',

    enablePregen: {
        short: '流式返回过程中提前开始生图，加快整体速度（仅世界书模式）',
        long: `### 流式预生成

在 AI **流式输出**的过程中，一旦检测到生图关键词就**立即开始生成图片**，
而不是等整条消息输出完毕后再生成。

**收益**：可节省数秒到十数秒的等待时间。

**限制**：
- 仅支持**酒馆全局世界书**的触发模式
- 需要后端响应足够快才能体现优势`
    },

    autoLLMImageGen: {
        short: '非同层模式下，自动请求 LLM 生成图片提示词',
        long: `### 自动 LLM 请求生图（非同层）

开启后，当**非同层消息**匹配到触发标记时，会自动：
1. 把上下文发给 LLM
2. 让 LLM 生成合适的图片提示词
3. 用提示词生图

> ⚠️ 需要先在 **LLM** 页面正确填写 api_url、api_key、model。`
    },

    imageGenInterval: {
        short: '连续生图之间的最小间隔（毫秒），防止请求过于频繁',
        long: `### 生图间隔时间（毫秒）

两次生图请求之间的**最小间隔**。

- 设为 \`0\` 不限制
- 推荐 \`2000\`（2 秒）以避免被 API 限流
- 如果有频率需求，调大此值`
    },

    imageAlignment: '聊天框内图片的对齐方式：靠左 / 居中 / 靠右',

    imageSizeScale: '聊天框内图片的显示大小百分比（100% = 自适应）',

    // ===== 标记 =====
    startTag: {
        short: '图片触发的起始标记符，默认 `image###`',
        long: `### 开始标记

AI 或角色消息中，**包含此标记**时会被插件捕获并用于生图。

- 默认值：\`image###\`
- 配合 **结束标记** 使用，两者之间的内容作为图片提示词
- 需要和**角色卡 / 世界书**里约定的标记保持一致`
    },

    endTag: {
        short: '图片触发的结束标记符，默认 `###`',
        long: `### 结束标记

与**开始标记**配对使用：

\`\`\`
image### 1girl, solo, blue hair ###
         ↑                        ↑
       开始标记                  结束标记
\`\`\`

中间的内容 \`1girl, solo, blue hair\` 会作为图片提示词送去生成。`
    },

    // ===== 储存 tag 模式 =====
    insertOriginalText: '开启后生成图片时会把tag插入到原始文本内容（仅非同层模式）',

    // ===== 缓存管理 =====
    cache: '选择要清除多久之前的缓存图片（点击下方按钮才真正执行）如果不保存那么将不再储存生成的图片',

    jiuguanchucun: {
        short: '把图片通过酒馆后端保存到服务器，方便跨设备访问',
        long: `### 缓存图片到酒馆

开启后，生成的图片会通过酒馆后端**持久化到服务器**。

**优点**：
- 跨设备访问同一份缓存
- 清浏览器数据不丢图
- 需要到酒馆加载图片消耗流量
- 需要消耗酒馆服务器的储存空间
**不开启**：
- 图片仅缓存在浏览器本地（IndexedDB）
- 换设备或清浏览器数据会丢失
- 云酒馆不建议开启！！可能报错，无法储存！
`
    },

    vibeJiuguanchucun: {
        short: '只把 Vibe 数据保存到酒馆，不影响普通生成图缓存',
        long: `### 缓存 Vibe 到酒馆

开启后，Vibe 文件数据、Vibe 预览图和 Vibe 组封面会通过酒馆后端保存到服务器。

**影响范围**：
- 只影响 Vibe Transfer / Vibe 组
- 不会让普通生成图片自动缓存到酒馆
- 换设备时仍需要同步/导入插件设置中的 Vibe 引用信息

**关闭后**：
- 新导入或新生成的 Vibe 只保存在当前浏览器 IndexedDB
- 换设备或清浏览器数据后可能不可用`
    },

    convertToJpegStorage: {
        short: '转 JPEG 存储可节省 ~70% 空间，但画质会有损失',
        long: `### 转 JPEG 储存

开启后，储存时会将 PNG 图片转为 JPEG 格式。

| 对比项 | PNG（关闭） | JPEG（开启） |
|--------|:---------:|:----------:|
| 文件大小 | 100% | **~30%** |
| 画质 | 无损 | 有损（**噪点增加**） |
| 透明背景 | 支持 | 不支持 |

> 💡 如果图片很多导致空间紧张，可以开启。追求画质请关闭。`
    },

    helpTipsEnabled: '开启后，设置项旁边会显示 **?** 帮助气泡（默认开启）',

    randomYushe: '开启后，每次生图时将从所有提示词预设中**随机选择**一个使用，而非使用当前固定的预设。适合希望每次生图风格多变的场景。',

    // ===== Stable Diffusion 页（sd.html） =====
    yusheid: '提示词预设档位，可保存多组固定正/负面词组合切换使用',
    fixedPrompt: '会被**前置**添加到每次生图提示词最前面（固定正面词）',
    fixedPrompt_end: '会被**追加**到每次生图提示词最后（后置固定正面词）',
    negativePrompt: '固定的**负面提示词**，防止生成不希望出现的内容',
    AQT_sd: '是否自动追加**通用质量词**（best quality, amazing quality...）',
    UCP_sd: '负面质量预设档位，统一应用反面词防止劣质生成',
    prompt_replace_id: '提示词替换规则预设档位',
    prompt_replace_text: {
        short: '触发词匹配规则：`触发词=前置前|插入词` 等多种格式',
        long: `### 替换规则语法

每行一条规则，格式：\`触发词=动作|插入词\`

**动作说明**：
- \`前置前\` — 插入到生图提示词最前
- \`前置后\` — 插入到固定正面词之后
- \`替换\` — 把触发词本身替换为插入词
- \`替换|\`（留空插入词）— 删除触发词
- \`替换分角色\` — 按角色分别替换
- \`后置前\` / \`后置后\` / \`最后置\` — 插入到末尾不同位置`
    },
    sdUrl: 'SD WebUI（A1111）的 API 地址，默认 `http://127.0.0.1:7860`',
    st_chatu8_sd_auth: 'SD WebUI 启用 `--api-auth` 时填写 `用户名:密码`',
    sd_cchatu_8_model: '当前使用的 **Checkpoint 模型**（需先点右侧"连接刷新数据"）',
    sd_cchatu_8_vae: 'VAE 解码器，影响色彩和细节（选 `Automatic` 让 SD 自动选）',
    sd_cchatu_8_samplerName: '采样器，影响出图风格与速度（常用：Euler a / DPM++ 2M Karras）',
    sd_cchatu_8_scheduler: '采样调度器（Karras / Automatic / Normal 等）',
    sd_cchatu_8_upscaler: '超分辨率模型，配合 Hires.fix 使用',
    sd_cchatu_8_lora: '选择后点 "+" 追加 LoRA 到固定正面词',
    sd_cwidth: '生成图片**宽度**（像素，建议 512 或 1024 的倍数）',
    sd_cheight: '生成图片**高度**（像素，建议 512 或 1024 的倍数）',
    sd_csteps: '采样步数，**越大越精细但越慢**（常用 20~40）',
    sd_cseed: '随机种子，`-1` 表示每次随机；固定值可复现同张图',
    sdCfgScale: 'CFG Scale：提示词遵循强度，常用 `5~9`（越大越贴提示词但越死板）',
    restoreFaces: '启用面部修复后处理（对写实人脸有帮助）',
    sd_cclip_skip: 'CLIP Skip 层数，动漫模型常用 `2`，写实模型常用 `1`',
    sd_cadetailer: '启用 ADetailer 自动检测并重绘面部/手部（需安装对应扩展）',
    sd_chires_fix: '启用 Hires.fix 两阶段生成：先低分辨率再超分到高清',
    sd_chires_steps: 'Hires.fix 第二阶段的采样步数（`0` = 用主步数）',
    sd_cdenoising_strength: 'Hires.fix 重绘强度 `0~1`，小=保留原图，大=重画',
    sd_cupscale_factor: 'Hires.fix 超分倍数（`2` 表示长宽各放大 2 倍）',

    // ===== NovelAI 页（novelai.html） =====
    // 固定提示词
    yusheid_novelai: 'NovelAI 专用的提示词预设档位，可保存多组固定正/负面词组合切换使用',
    fixedPrompt_novelai: '会被**前置**添加到每次生图提示词最前面（NovelAI 固定正面词）',
    fixedPrompt_end_novelai: '会被**追加**到每次生图提示词最后（NovelAI 后置固定正面词）',
    negativePrompt_novelai: 'NovelAI 固定的**负面提示词**，防止生成不希望出现的内容',
    prompt_replace_id_novelai: 'NovelAI 提示词替换规则预设档位',
    prompt_replace_text_novelai: {
        short: 'NovelAI 触发词匹配规则：`触发词=前置前|插入词` 等多种格式',
        long: `### 替换规则语法（NovelAI）

每行一条规则，格式：\`触发词=动作|插入词\`

**动作说明**：
- \`前置前\` — 插入到生图提示词最前
- \`前置后\` — 插入到固定正面词之后
- \`替换\` — 把触发词本身替换为插入词
- \`替换|\`（留空插入词）— 删除触发词
- \`替换分角色\` — 按角色分别替换
- \`后置前\` / \`后置后\` / \`最后置\` — 插入到末尾不同位置`
    },

    // 配置档案
    novelai_profile_id: '随时保存和切换以下的这些设置',
    comfyui_profile_id: '随时保存和切换以下的这些设置',

    novelaiApi: 'NovelAI Persistent API Token（在账号订阅页获取）',
    novelaimode: 'NovelAI 模型版本（v3 / v4 / v4.5，**v4.5 Curated** 最新）',
    novelaisite: '请求走哪个站点：官方 / 第三方代理（仅支持官网格式）（注意要切换为主要设置的客户端为浏览器，否则不支持！）',
    novelaiOtherSite: '自定义第三方 NovelAI 兼容站点 URL',
    enableCloudQueue: '当有多个小伙伴同时使用一个key时，官网会429报错，开启后会自动排队，让你们依次生图。（不会发送任何敏感数据）',
    cloudQueueUrl: '云端队列服务地址（自部署或社区公共节点）',
    cloudQueueGreeting: '云队列首次连接时的问候语（社区礼仪）',
    showQueueGreeting: '在队列等待时是否显示问候语提示',
    novelai_sampler: 'NovelAI 采样器（Euler / Euler Ancestral / DPM++ 等）',
    Schedule: '采样调度表（Native / Karras / Exponential 等）',
    nai3Scale: 'Prompt Guidance：提示词引导强度，常用 `5~10`',
    cfg_rescale: 'CFG Rescale：消除高 Scale 导致的过饱和，推荐 `0.15~0.3`',
    sm: 'SMEA：光滑采样，生成更精细但速度稍慢',
    dyn: 'SMEA DYN：动态 SMEA，进一步优化（需先开 SMEA）',
    nai3Variety: 'Variety Plus：增强画面多样性（v4 系列专用）',
    nai3Deceisp: 'Decrisper：减少高 CFG 下的焦脆感',
    AI_use_coords: '不使用当前的而是自动依照官网默认角色坐标（v4 系列多角色定位）',
    novelai_width: '图片宽度（像素），NovelAI 建议用官方预设分辨率（自定义分辨率可能会报错）',
    novelai_height: '图片高度（像素），NovelAI 建议用官方预设分辨率（自定义分辨率可能会报错）',
    novelai_steps: '采样步数，NovelAI 订阅限制最高 28，高了会收费！',
    novelai_seed: '随机种子，`-1` 随机；固定值可复现',
    nai3VibeTransfer: '启用 Vibe Transfer（参考图控制画风）',
    enableVibeGroupTransfer: '启用 Vibe **组**（多张参考图分组切换）',
    normalizeRefStrength: '多张参考图时归一化强度，避免叠加过猛',
    InformationExtracted: '信息提取度 `0~1`，越大越多地使用参考图的细节',
    ReferenceStrength: '参考强度 `0~1`，越大越贴近参考图',
    nai3CharRef: '启用 Character Reference（角色一致性参考，每张 +5 点）',
    nai3StylePerception: 'Style Perception：参考图的画风感知强度',
    addFurryDataset: '启用 NovelAI 的 Furry 数据集（兽人风格）',
    AQT_novelai: '正面质量预设（best quality, amazing quality...）',
    UCP_novelai: '负面质量预设档位，自动添加通用负面（Heavy / Light / None）',

    // ===== ComfyUI 页（comfyui.html） =====
    comfyuiUrl: 'ComfyUI 服务地址，默认 `http://127.0.0.1:8188`',
    worker: '当前使用的 ComfyUI **工作流**（生图）',
    workerid: '生图工作流预设档位，非需要不要使用带vae的工作流（会鬼图！）',
    editWorker: '图像编辑使用的工作流',
    editWorkerid: '编辑工作流预设档位',
    MODEL_NAME: '工作流中 **Checkpoint** 节点使用的模型名',
    comfyui_width: '图片宽度（像素）',
    comfyui_height: '图片高度（像素）',
    comfyui_steps: '采样步数',
    comfyui_seed: '随机种子，`-1` 随机',
    cfg_comfyui: 'CFG Scale：提示词遵循强度',
    ipa: '请配合相关的工作流，并替换参数来使用！！！',
    c_fenwei: '"分为" 权重（多角色/分区绘制相关）',
    c_xijie: '"细节" 权重',
    c_quanzhong: '整体权重',
    c_idquanzhong: '角色 ID 权重',
    weilin_lora_fix: '修复最新的weilin节点 LoRA 的报错问题（最新的weilin的lora需要三个参数）',
    comfyui_scheduler: '采样调度器',
    comfyui_vae: 'VAE 模型（`Automatic` = 用模型自带的）',
    comfyuiCLIPName: 'CLIP 编码器名称',
    ComfyuiLORA: '选择 LoRA 追加到提示词',
    comfyuisamplerName: '采样器（Euler / DPM++ 等）',
    AQT_comfyui: '正面质量预设',
    UCP_comfyui: '负面质量预设',
    fixedPrompt_comfyui: 'ComfyUI 专用的前置固定正面词',
    fixedPrompt_end_comfyui: 'ComfyUI 专用的后置固定正面词',
    negativePrompt_comfyui: 'ComfyUI 专用的固定负面词',
    yusheid_comfyui: 'ComfyUI 提示词预设档位',
    prompt_replace_id_comfyui: 'ComfyUI 替换规则预设档位',
    prompt_replace_text_comfyui: {
        short: '触发词匹配规则：`触发词=前置前|插入词` 等多种格式',
        long: `### 替换规则语法

每行一条规则，格式：\`触发词=动作|插入词\`

**动作说明**：
- \`前置前\` — 插入到生图提示词最前
- \`前置后\` — 插入到固定正面词之后
- \`替换\` — 把触发词本身替换为插入词
- \`替换|\`（留空插入词）— 删除触发词
- \`替换分角色\` — 按角色分别替换
- \`后置前\` / \`后置后\` / \`最后置\` — 插入到末尾不同位置`
    },


    // ===== Banana/Grok 页（banana.html） =====
    'st-chatu8-banana-api-url': 'Banana/Grok 兼容 API openai格式的服务地址',
    'st-chatu8-banana-api-key': 'API Key（请妥善保管，避免泄露）',
    'st-chatu8-banana-model-select': '生图模型选择',
    'st-chatu8-banana-video-model-select': '视频生成模型（若服务支持）',
    'st-chatu8-banana-aspect-ratio': '输出画面的宽高比（1:1 / 16:9 / 9:16 等）（仅教程的自部署生效）',
    'st-chatu8-banana-fixed-prompt': '固定**前置**提示词',
    'st-chatu8-banana-postfix-prompt': '固定**后置**提示词',
    'st-chatu8-banana-prompt-replace-id': '替换规则预设档位',
    'st-chatu8-banana-prompt-replace-text': {
        short: '触发词匹配规则：`触发词=前置前|插入词` 等多种格式',
        long: `### 替换规则语法

每行一条规则，格式：\`触发词=动作|插入词\`

**动作说明**：
- \`前置前\` — 插入到生图提示词最前
- \`前置后\` — 插入到固定正面词之后
- \`替换\` — 把触发词本身替换为插入词
- \`替换|\`（留空插入词）— 删除触发词
- \`替换分角色\` — 按角色分别替换
- \`后置前\` / \`后置后\` / \`最后置\` — 插入到末尾不同位置`
    },
    'st-chatu8-banana-conversation-preset-id': '对话型生图预设档位',
    'st-chatu8-banana-edit-preset': '图像编辑预设',
    'st-chatu8-banana-video-preset': '视频生成预设',

    // ===== 悬浮球 / 智绘姬（fab.html） =====
    enable_chatu8_fab: '显示**智绘姬悬浮球**（屏幕上的可拖动入口）',
    enable_chatu8_fab_video: '启用视频形象模式（替代简单图标）',
    enable_chatu8_desktop_pet: {
        short: '把智绘姬拆到独立的画中画窗口（像桌宠一样）',
        long: `### 独立窗口（画中画）

开启后会用浏览器的 **Picture-in-Picture** API 把智绘姬视频放到独立小窗。

**要求**：
- 必须先启用"视频形象"
- 浏览器需支持 PiP（Chrome/Edge ✅，Firefox 部分版本 ✅）
- HTTPS 或 localhost 环境

> ⚠️ 用户手势触发，首次开启会请求权限。`
    },
    chatu8_fab_theme: '悬浮球预设主题（颜色/透明度一键组合）',
    chatu8_fab_bg_color: '悬浮球背景色（传统模式；视频模式忽略）',
    chatu8_fab_icon_color: '悬浮球图标颜色（传统模式；视频模式忽略）',
    chatu8_fab_icon_image_id: '悬浮球自定义图片图标（上传后保存到酒馆；视频模式忽略）',
    chatu8_fab_opacity: '悬浮球不透明度 `0~1`（传统模式下）',
    chatu8_fab_size: '悬浮球尺寸（像素），桌面/移动端分别记忆',

    // ===== 主题（theme.html） =====
    theme_id: '当前使用的主题预设（插件 UI 配色）',
    theme_generate_btn_style: '聊天中"生成"按钮的样式',
    theme_image_frame_style: '图片相框样式（边框/阴影）',
    theme_collapse_style: '折叠框视觉样式',

    // ===== LLM 设置（llm.html） =====
    'ch-llm_profile_select': 'LLM 连接配置档位，可保存多套 `url+key+model` 切换（生图分为酒馆全局世界书生成和使用此处的llm另外生成，需要配合正则设置的点击正文，双击后弹出按钮）',
    'ch-llm_api_url': 'OpenAI 兼容 API 的 Base URL（例：`https://api.openai.com/v1`）',
    'ch-llm_api_key': 'API Key。**不会在前端日志里打印**，请放心填写',
    'ch-llm_model_select': '使用的模型名（从 API 拉取或手动填写）',
    'ch-llm_temperature': '温度 `0~2`，越高越发散。创意内容用 `0.7~1.0`，稳定输出用 `0.2~0.5`',
    'ch-llm_top_p': 'Top-P 核采样 `0~1`，`1` = 不限制；与 temperature 二选一调',
    'ch-llm_max_tokens': '单次生成的**最大 token 数**上限（是生成的不是发送的）',
    'ch-llm_stream': '启用流式输出（容易截断，不建议）',
    'ch-llm_bypass_proxy': '绕过酒馆的代理直连 用于解决和其他插件同时请求会造成冲突（比如数据库）',
    'ch-llm_retry_count': '失败自动重试次数',
    'ch-llm_history_depth': '发送给 LLM 的上下文**深度**（近 N 条消息）',
    'ch-llm_combined_prompt': '发给ai的具体请求内容',
    'ch-llm_merge_system_user': '把 system 与 user 合并成一条（某些模型要求）',
    'ch-llm_send_images': '是否将消息中的**图片**（多模态 `image_url`）一并发送给 LLM。关闭后图片会被剥离，仅发送文本。**默认关闭**请确认支持多模态，例如ds不支持',
    'ch-tagthink_echo': '开启后在生图的tag上面会有think思维链（需要正则去除）',
    'ch-history_keep_image_tag': '**仅对「正文图片生成」请求生效**。开启后，历史消息（非当前正文）中的 `<image>...</image>` 块在正则处理时被保护，原文保留作为 LLM 上下文参考；当前正文仍按正则完整清理',

    // ===== 正则 / 手势（regex.html） =====
    'ch-regex-profile-select': '正则配置档位',
    'ch-regex-test-mode': '测试模式：开启后生成图片的请求会被拦截（避免不必要的api请求）',
    'ch-regex-test-original-text': '测试用的原始文本',
    'ch-regex-test-result-text': '匹配替换后的结果（需要仅保留干净的正文）',
    'ch-regex-text-editor': '用选择不需要的，格式为  前置文字|后置文字',
    'ch-regex-before-after-editor': '前后处理正则，可以用来框到需要的，格式为  前置文字|后置文字',
    'ch-click-trigger-enabled': '启用**点击触发**：在聊天中点击正文元素触发生图，电脑两下，手机要点三下（会有一个按钮弹窗）',
    'ch-default-char-demand': '默认角色设计的时候的需求（生图需求关闭时使用）',
    'ch-default-image-demand': '默认生成图片的时候的需求（生图需求关闭时使用）',
    'ch-image-gen-demand-enabled': '启用"生图需求"弹窗：生成前提示补充需求',
    'ch-gesture-enabled': '启用**手势识别**：屏幕上画指定形状触发动作',
    'ch-gesture-1-button': '手势 1 绑定的动作',
    'ch-gesture-2-button': '手势 2 绑定的动作',
    'ch-gesture-match-threshold': '手势匹配阈值 `0~1`，越高越严格',
    'ch-gesture-show-recognition': '识别中显示当前轨迹识别度',
    'ch-gesture-show-trail': '画手势时显示轨迹线',
    'ch-gesture-trail-color': '手势轨迹线的颜色',

    // ===== 角色管理（character.html） =====
    char_nameCN: '需要完全匹配正文里的名字；多个名字用 `|` 分割（如 `小明|明明`，任一命中即视为触发）用于匹配正文的名字',
    char_nameEN: '需要完全匹配正文里的名字；多个名字用 `|` 分割（如 `xiaoming|ming`，任一命中即视为触发）用于ai生成tag',

    character_enable_test_input: {
        short: '测试角色名字匹配：输入纯名字或者含 `$...$` 标记的文本，看会命中启用列表里的哪些角色（用于 从tag到角色数据的环节，比如${"name":"小明","angle":"from front","upperBody":"sfw","lowerBody":"hidden"}$ 到具体的角色数据tag）',
        long: `### 触发词测试

用来**调试角色名字匹配**：输入一段含角色标记的文本，点下方按钮查看会被识别为哪些角色。
比{"name":"小明","angle":"from front","upperBody":"sfw","lowerBody":"hidden"} 到具体的角色数据tag

具体为两个步骤，1.下方的正文触发 启用的角色 列表发送给ai  ai生成带名字的tag  2.触发调用角色列表里的数据

**支持的输入格式**：
- **旧格式角色标记**：\`$角色名字-sfw-upperbody$\`、\`$角色名字-nsfw-upperbody-sfw-lowerbody$\`
- **JSON 角色标记**：\`\${"name":"角色名字","angle":"from front","upperBody":"sfw","lowerBody":"hidden"}$\`
- **多角色**（一段 tags 里多个 \`$...$\`）：\`$小红-sfw-upperbody$, standing, $小蓝-sfw-upperbody$, smiling\`
- 调试用 · 仅识别名字：\`角色名字\`、\`角色名字[当前]\`（实际替换流程不认这种裸名字）

> 测试**只做名字匹配**，不会执行完整替换流程。
> 正式解析要求 \`$...$\` 内必须是「名字 + 旧格式后缀」或 JSON 对象；裸名字在实际替换时会被原样保留。`
    },

    character_list_test_input: {
        short: '测试 `{{角色启用列表}}` 触发：粘贴一段文本，查看启用列表里哪些角色会被包含，用于正文里的名字是否可以触发启用列表里的人物，比如 "小明"  要能触发小明的角色（名字要完全匹配）',
        long: `### {{角色启用列表}} 触发测试

用于正文里的名字是否可以触发启用列表里的人物，比如 "小明"  要能触发小明的角色（名字要完全匹配）

粘贴一段触发文本（用户需求 / 上下文 / 世界书触发内容），查看**启用列表**里哪些角色会被包含进 \`{{角色启用列表}}\` 宏。

**触发规则**：
- **触发来源**：仅扫描当前「角色启用预设」里登记的角色，**不会**走通用列表，**不会**走全局预设兜底
- **匹配方式**：对每个启用角色的中文名 / 英文名做**子串包含**
- **名字分割**：名字支持用 \`|\` 分割多个别名，任意一个命中即视为触发
- **大小写 / 空格**：均已忽略（触发文本和名字都会去掉空白并转小写后比较）
- **结果数量**：一次可命中多个角色；所有命中角色都会被包含进 \`{{角色启用列表}}\` 文本

**与「角色触发（\`$...$\` 替换）」的区别**：
- 「角色触发」是把生图 tag 里的 \`$角色名字-...$\` 替换成对应外观
- 这里测试的是 \`{{角色启用列表}}\` 宏，用于把命中的角色名拼成一段文本注入到 LLM 上下文`
    },

    // ===== 词汇表（vocabulary.html） =====
    vocabulary_search_startswith: '开启后只匹配**以关键词开头**的词条（更精准）',
    vocabulary_search_limit: '单次搜索返回的最大结果数（1~1000）',
    vocabulary_search_sort: '结果排序方式（热度升降 / 字典序等）',

    // ===== 知识库（knowledgeBase.html）关键开关 =====
    'ch-kb2-enabled': '注意仅对智绘姬ai的自定义llm预设生效',
    'ch-kb2-skip-constant': '跳过 constant（蓝灯常驻）条目以节省 token',
    'ch-kb2-trigger-depth': '从最近 N 条消息中检索世界书触发词',
    'ch-persona-enabled': '启用角色的人设（persona）注入',
    'ch-user-enabled': '启用用户的人设注入',
    'ch-persona-preset-id': '角色人设预设档位',
    'ch-user-preset-id': '用户人设预设档位',
};

/**
 * 获取指定 id 的帮助配置（归一化为 {short, long}）
 * @param {string} id
 * @returns {{short?: string, long?: string} | null}
 * 
 */
export function getHelpEntry(id) {
    const raw = SettingsHelpText[id];
    if (!raw) return null;
    if (typeof raw === 'string') return { short: raw };
    if (typeof raw === 'object' && (raw.short || raw.long)) return raw;
    return null;
}
