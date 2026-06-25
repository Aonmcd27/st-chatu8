/**
 * 主要设置助手模块
 */

export const mainSettingsModule = {
   name: '主要设置助手',
   summary: '帮助用户了解和配置插件主要设置页面中的各项功能开关与参数，包括插件启用、后端模式、触发标记、图片行为、缓存管理等。当用户询问如何开启/关闭功能、配置后端模式、修改标记、清理缓存等主要设置相关问题时加载此模块。',

   commands: `
【主要设置页可用的配置修改命令】

所有设置均通过 write 指令修改，格式：
<SystemQuery>{"type": "write", "path": "配置键", "value": 新值}</SystemQuery>

可修改的配置项及其路径：
- scriptEnabled: 布尔值, 启用/禁用插件
- mode: 字符串, 可选 "sd" / "novelai" / "comfyui" / "banana"
- client: 字符串, 可选 "browser" / "jiuguan"
- dbclike: 布尔字符串 "true"/"false", 隐藏按钮模式
- collapseImage: 布尔字符串 "true"/"false", 折叠图片
- zidongdianji: 布尔字符串 "true"/"false", 自动点击生成
- zidongdianji2: 布尔字符串 "true"/"false", 自动点击(高级/不建议打开)
- longPressToEdit: 布尔字符串 "true"/"false", 长按图片修改tag(打开更多功能必须)
- clickToPreview: 布尔字符串 "true"/"false", 单击图片预览
- newlineFixEnabled: 布尔字符串 "true"/"false", 换行修复
- enablePregen: 布尔字符串 "true"/"false", 流式预生成
- autoLLMImageGen: 布尔字符串 "true"/"false", 自动LLM请求生图
- imageGenInterval: 数字, 生图间隔时间（毫秒）
- randomYushe: 布尔字符串 "true"/"false", 随机提示词预设（每次生图随机选择预设）
- aiAutonomousResolution: 布尔值 true/false, AI自主分辨率（控制是否用提示词中的分辨率覆盖设置）
- imageAlignment: 字符串, 可选 "left" / "center" / "right"
- startTag: 字符串, 图片触发的开始标记
- endTag: 字符串, 图片触发的结束标记
- insertOriginalText: 布尔字符串 "true"/"false", 插入原文
- jiuguanchucun: 布尔字符串 "true"/"false", 缓存图片到酒馆
- vibeJiuguanchucun: 布尔字符串 "true"/"false", 缓存 Vibe 到酒馆
- convertToJpegStorage: 布尔字符串 "true"/"false", 转JPEG储存

缓存管理相关按钮操作（需先切到主要设置页面）：
<SystemQuery>{"type": "ui_action", "action": "switch_tab_main"}</SystemQuery>
<SystemQuery>{"type": "ui_action", "action": "clear_image_cache"}</SystemQuery>
<SystemQuery>{"type": "ui_action", "action": "sync_server_images"}</SystemQuery>
<SystemQuery>{"type": "ui_action", "action": "migrate_database"}</SystemQuery>
`.trim(),

   knowledge: `
【主要设置页面功能说明】

■ 主要设置区域
- scriptEnabled（启用插件）：总开关，关闭后插件不会拦截消息和生成图片。
- mode（模式）：选择图像生成后端。SD = Stable Diffusion WebUI (本地)；NovelAI = 在线付费API；ComfyUI = 本地节点式工作流；Banana = 基于API的云端生图,grok模型生图也选这个。
- client（客户端）：选择生图请求的代理方式。browser = 在浏览器端直接访问生图的api（可能会碰到跨域问题。需要疑难解答模块）；jiuguan = 通过酒馆后端代理进行访问。
- dbclike（隐藏按钮）：开启后隐藏聊天界面中的生图按钮，改为双击图片触发重新生成。适合不想看到额外按钮的用户。
- collapseImage（折叠图片）：开启后生成的图片默认折叠显示，点击后展开。适用于不想让图片占据大量聊天空间的场景。
- zidongdianji（自动点击生成）：开启后当检测到触发标记时自动点击生成按钮，无需手动点击。
- zidongdianji2（自动点击-高级）：更激进的自动点击模式，一般不建议开启，可能导致频繁触发。
- longPressToEdit（长按图片修改tag）：开启后长按已生成的图片可以展开编辑框，使用更多编辑功能。
- clickToPreview（单击图片预览）：开启后单击图片上半部分，会弹出大图预览，还可以切换查看其他图片。
- newlineFixEnabled（换行修复）：修复某些情况下文本标记"###"会单独开一行的异常问题。
- enablePregen（流式预生成）：在流式接收消息的过程中，提前开始生成图片，减少等待时间。（仅世界书模式支持）
- autoLLMImageGen（自动LLM请求生图）：开启后当非同层消息匹配到触发标记时，自动调用 LLM 将文本发送给ai并生成图片提示词。
- randomYushe（随机提示词预设）：开启后每次生图时从所有提示词预设中随机选择一个使用，而非使用当前固定的预设。适合希望每次生图风格多变的场景。
- aiAutonomousResolution（AI自主分辨率）：开启后，当生图脚本从提示词中提取到尺寸（如 832x1216）时，将自动使用该尺寸覆盖固定分辨率设置。关闭时不再覆盖，但仍会从提示词中删除该尺寸标记。默认开启。
- imageGenInterval（生图间隔时间）：连续生图之间的最小间隔（毫秒），防止请求过于频繁。设为 0 则不限制。
- imageAlignment（图片对齐方式）：控制生成图片在聊天框中的对齐方向，可选靠左、居中、靠右。

■ 标记区域
- startTag（开始标记）：触发图片生成的起始标记符，默认为 "image###"。AI/角色消息中包含此标记时会被插件拦截用于生图。
- endTag（结束标记）：触发图片生成的结束标记符，默认为 "###"。startTag 和 endTag 之间的内容会作为图片提示词。

■ 储存tag模式区域
- insertOriginalText（插入原文）：开启后在生成的生图tag将会插入原始的标记文本内容（非同层模式下有效）。

■ 缓存管理区域
- cache（缓存清除选项）：选择清除多久之前的缓存图片，可选不缓存/一天/一周/一月/一年。
- jiuguanchucun（缓存图片到酒馆）：开启后图片会通过酒馆后端保存到服务器，方便跨设备访问。
- vibeJiuguanchucun（缓存 Vibe 到酒馆）：开启后仅 Vibe 数据、预览图和 Vibe 组封面保存到酒馆，不影响普通生成图缓存。
- convertToJpegStorage（转JPEG储存）：将 PNG 格式的图片转换为 JPEG 储存，节省约70%空间，但图片质量会有所下降（噪点增加）。
- 同步服务器图片按钮：将服务器端不被记录的异常图片进行清除。
- 清除图片缓存按钮：根据所选缓存清除选项清除对应时间范围的缓存图片。
- 数据迁移按钮：用于数据库格式升级时迁移旧数据。
`.trim(),

   workflow: `
【主要设置引导流程】（当用户需要配置主要设置时按此顺序引导）

1. 切换到主要设置页面：
   <SystemQuery>{"type": "ui_action", "action": "switch_tab_main"}</SystemQuery>
2. 确认插件已启用（scriptEnabled 为 true），如未启用则开启：
   <SystemQuery>{"type": "write", "path": "scriptEnabled", "value": true}</SystemQuery>
3. 询问用户使用哪个生图后端，设置 mode：
   <SystemQuery>{"type": "write", "path": "mode", "value": "comfyui"}</SystemQuery>
4. 确认标记配置：默认 startTag="image###"、endTag="###"，如果用户需要更改可以在设置中修改。
5. 根据用户场景推荐开关设置：
   - 希望自动生图 → 开启 zidongdianji
   - 需要 LLM 自动请求生成tag → 开启 autoLLMImageGen
   - 流式对话想更快 → 开启 enablePregen
   - 图片太多占空间 → 开启 collapseImage
6. 如需配置缓存，引导用户区分普通图片缓存（jiuguanchucun）和 Vibe 独立缓存（vibeJiuguanchucun），再决定是否转JPEG（convertToJpegStorage）。
7. 使用 check_config 确认所有必要配置已完成：
   <SystemQuery>{"type": "check_config"}</SystemQuery>
`.trim(),

   errorGuide: `
【主要设置常见问题】

- 插件没有反应/不生图：检查 scriptEnabled 是否为 true，以及 mode 是否正确选择了对应的后端。
- 标记无法触发：确认 startTag 和 endTag 是否与角色卡/世界书中设定的标记一致。注意大小写和特殊字符。
- 连接后端api生图失败：检查 client 设置。如果选了 "browser" 可能会有跨域问题，建议先尝试“jiuguan”进行代理（会损失一些功能）。
- 生图太频繁/重复触发：调大 imageGenInterval（如设为 2000 毫秒），或关闭 zidongdianji2。
- 图片占用空间太大：开启 convertToJpegStorage 可节省约70%空间，但会有画质损失。也可以定期使用缓存清除功能。
- 缓存图片丢失：如果使用 "browser" 客户端，图片缓存在浏览器本地，清除浏览器数据会导致丢失。建议开启 jiuguanchucun 持久化到酒馆服务器。
- Vibe 换设备不可用：开启 vibeJiuguanchucun，并点击“迁移 Vibe 到酒馆”迁移已有 Vibe。
- 流式预生成(enablePregen)不生效：需要聊天模式本身支持流式输出，且后端响应速度足够快才能体现预生成的优势。
- autoLLMImageGen 无效：需要确保 LLM 配置（LLM页面的 api_url、api_key、model）已正确填写，且非同层模式下才生效。
`.trim()
};
