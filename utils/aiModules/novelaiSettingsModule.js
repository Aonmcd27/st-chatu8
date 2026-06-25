/**
 * NovelAI 设置助手模块
 * 
 * TODO: 从 utils/aiPromptModules.js 的 novelai_settings 对象提取内容
 * 位置: 约第 800-1400 行
 * 
 * 提取步骤:
 * 1. 打开 utils/aiPromptModules.js
 * 2. 找到 novelai_settings: { ... } 对象
 * 3. 复制 name, summary, commands, knowledge, workflow, errorGuide 的完整内容
 * 4. 粘贴到下面的 novelaiSettingsModule 对象中
 * 5. 确保所有反引号和字符串正确闭合
 */

export const novelaiSettingsModule = {
   name: 'NovelAI 设置助手',
   summary: '帮助用户配置 NovelAI 的各项参数，包括 API 连接、模型选择、采样参数、提示词预设、氛围转移(Vibe Transfer)、角色参考等。当用户提到 NovelAI 设置、NAI 模型、采样器、Vibe、角色参考等需求时加载此模块。',

   commands: `
【NovelAI 模块可用命令】

■ 基础配置命令

切换到 NovelAI 设置页面：
<SystemQuery>{"type": "ui_action", "action": "switch_tab_novelai"}</SystemQuery>

设置 NovelAI API Key：
<SystemQuery>{"type": "write", "path": "novelaiApi", "value": "pst-xxx..."}</SystemQuery>

设置站点（官网/其他站点）：
<SystemQuery>{"type": "write", "path": "novelaisite", "value": "官网"}</SystemQuery>

设置其他站点地址（当站点选择"其他站点"时）：
<SystemQuery>{"type": "write", "path": "novelaiOtherSite", "value": "https://xxx.com"}</SystemQuery>

启用/关闭云端队列：
<SystemQuery>{"type": "write", "path": "enableCloudQueue", "value": "true"}</SystemQuery>

设置云端队列服务地址：
<SystemQuery>{"type": "write", "path": "cloudQueueUrl", "value": "https://xxx.hf.space"}</SystemQuery>

设置排队个性语（15字以内）：
<SystemQuery>{"type": "write", "path": "cloudQueueGreeting", "value": "正在生成中~"}</SystemQuery>

显示/隐藏他人个性语：
<SystemQuery>{"type": "write", "path": "showQueueGreeting", "value": "true"}</SystemQuery>

■ 模型与采样器配置

设置模型：
<SystemQuery>{"type": "write", "path": "novelaimode", "value": "nai-diffusion-4-5-curated"}</SystemQuery>
可选值：nai-diffusion-3 / nai-diffusion-4-full / nai-diffusion-4-curated-preview / nai-diffusion-4-5-curated / nai-diffusion-4-5-full

设置采样方法：
<SystemQuery>{"type": "write", "path": "novelai_sampler", "value": "k_euler"}</SystemQuery>
可选值：k_euler / ddim_v3 / k_dpmpp_2s_ancestral / k_dpmpp_2m / k_euler_ancestral / k_dpmpp_2m_sde / k_dpmpp_sde

设置噪点表（Noise Schedule）：
<SystemQuery>{"type": "write", "path": "Schedule", "value": "native"}</SystemQuery>
可选值：native / exponential / polyexponential / karras

设置 Prompt Guidance（提示词关联性）：
<SystemQuery>{"type": "write", "path": "nai3Scale", "value": 5.0}</SystemQuery>

设置 Prompt Guidance Rescale（关联性调整）：
<SystemQuery>{"type": "write", "path": "cfg_rescale", "value": 0.0}</SystemQuery>

启用/关闭 AI 默认角色位置：
<SystemQuery>{"type": "write", "path": "AI_use_coords", "value": "false"}</SystemQuery>

启用/关闭 SMEA（仅 NAI3）：
<SystemQuery>{"type": "write", "path": "sm", "value": "true"}</SystemQuery>

启用/关闭 SMEA DYN（仅 NAI3）：
<SystemQuery>{"type": "write", "path": "dyn", "value": "true"}</SystemQuery>

启用/关闭多样性（Variety）：
<SystemQuery>{"type": "write", "path": "nai3Variety", "value": "true"}</SystemQuery>

启用/关闭减少伪影（Decrisp，仅 NAI3）：
<SystemQuery>{"type": "write", "path": "nai3Deceisp", "value": "true"}</SystemQuery>

■ 生成参数配置

设置图片宽度：
<SystemQuery>{"type": "write", "path": "novelai_width", "value": 1024}</SystemQuery>

设置图片高度：
<SystemQuery>{"type": "write", "path": "novelai_height", "value": 1024}</SystemQuery>

设置生成步数：
<SystemQuery>{"type": "write", "path": "novelai_steps", "value": 28}</SystemQuery>

设置种子（0/-1 为随机）：
<SystemQuery>{"type": "write", "path": "novelai_seed", "value": 0}</SystemQuery>

■ 提示词预设配置

查看当前提示词预设：
<SystemQuery>{"type": "read", "path": "yusheid_novelai"}</SystemQuery>

切换提示词预设：
<SystemQuery>{"type": "write", "path": "yusheid_novelai", "value": "预设名称"}</SystemQuery>

查看当前预设的固定正面提示词：
<SystemQuery>{"type": "read", "path": "yushe[yusheid_novelai].fixedPrompt"}</SystemQuery>

修改固定正面提示词：
<SystemQuery>{"type": "write", "path": "yushe[yusheid_novelai].fixedPrompt", "value": "masterpiece, best quality"}</SystemQuery>

修改后置固定正面提示词：
<SystemQuery>{"type": "write", "path": "yushe[yusheid_novelai].fixedPrompt_end", "value": "highly detailed"}</SystemQuery>

修改固定负面提示词：
<SystemQuery>{"type": "write", "path": "yushe[yusheid_novelai].negativePrompt", "value": "lowres, bad anatomy"}</SystemQuery>

■ 质量预设配置

启用/关闭福瑞数据集：
<SystemQuery>{"type": "write", "path": "addFurryDataset", "value": "true"}</SystemQuery>

设置正面质量预设（AQT）：
<SystemQuery>{"type": "write", "path": "AQT_novelai", "value": "best quality, amazing quality, very aesthetic, absurdres"}</SystemQuery>

设置负面质量预设（UCP）：
<SystemQuery>{"type": "write", "path": "UCP_novelai", "value": "Heavy"}</SystemQuery>
可选值：Heavy / Light / Human Focus / Furry Focus（根据模型不同可用选项不同）

■ 氛围转移（Vibe Transfer）配置

启用/关闭单个氛围参考（仅 NAI3）：
<SystemQuery>{"type": "write", "path": "nai3VibeTransfer", "value": "true"}</SystemQuery>

设置氛围提取信息（Information Extracted，0-1）：
<SystemQuery>{"type": "write", "path": "InformationExtracted", "value": 1.0}</SystemQuery>

设置氛围强度（Reference Strength，0-1）：
<SystemQuery>{"type": "write", "path": "ReferenceStrength", "value": 0.6}</SystemQuery>

启用/关闭 Vibe 组氛围转移（NAI4/4.5）：
<SystemQuery>{"type": "write", "path": "enableVibeGroupTransfer", "value": "true"}</SystemQuery>

启用/关闭归一化参考强度值：
<SystemQuery>{"type": "write", "path": "normalizeRefStrength", "value": "true"}</SystemQuery>

打开 Vibe 生成器（UI 操作）：
<SystemQuery>{"type": "ui_action", "action": "click_button", "selector": "#novelai-vibe-generator-btn"}</SystemQuery>

打开 Vibe 组编辑器（UI 操作）：
<SystemQuery>{"type": "ui_action", "action": "click_button", "selector": "#novelai-vibe-group-editor-btn"}</SystemQuery>

■ 角色参考配置

启用/关闭角色参考（仅 NAI4.5）：
<SystemQuery>{"type": "write", "path": "nai3CharRef", "value": "true"}</SystemQuery>

打开角色参考图上传（UI 操作）：
<SystemQuery>{"type": "ui_action", "action": "click_button", "selector": "#novelai-char-ref-upload-btn"}</SystemQuery>

打开角色组编辑器（UI 操作）：
<SystemQuery>{"type": "ui_action", "action": "click_button", "selector": "#novelai-char-ref-group-editor-btn"}</SystemQuery>

■ 配置档案管理

查看当前配置档案：
<SystemQuery>{"type": "read", "path": "novelai_profile_id"}</SystemQuery>

切换配置档案：
<SystemQuery>{"type": "write", "path": "novelai_profile_id", "value": "配置名称"}</SystemQuery>

读取配置档案（UI 操作）：
<SystemQuery>{"type": "ui_action", "action": "click_button", "selector": "#novelai_profile_load"}</SystemQuery>

新建配置档案（UI 操作）：
<SystemQuery>{"type": "ui_action", "action": "click_button", "selector": "#novelai_profile_new"}</SystemQuery>

删除配置档案（UI 操作）：
<SystemQuery>{"type": "ui_action", "action": "click_button", "selector": "#novelai_profile_delete"}</SystemQuery>
`.trim(),

   knowledge: `
【NovelAI 页面功能说明】

■ API 连接区域
- novelaiApi：NovelAI 的 API Key，格式为 "pst-xxx..."，可在 NovelAI 官网账户设置中获取（需要用户拥有novelai的会员）
- novelaisite：选择使用官网还是其他站点（镜像站）
- novelaiOtherSite：当选择"其他站点"时填写的自定义 API 地址
- enableCloudQueue：启用云端队列功能，多人共享 API Key 时排队使用
- cloudQueueUrl：云端队列服务的地址（通常是 Hugging Face Space）默认(https://st-chatu-novelai-queue.hf.space)
- cloudQueueGreeting：排队时显示的个性化问候语（最多15字）
- showQueueGreeting：是否显示其他用户的个性语

■ 模型选择区域
- novelaimode：选择 NovelAI 的图像生成模型
  - nai-diffusion-3：NAI3 模型，适合动漫风格
  - nai-diffusion-4-full：NAI4 完整版，无内容过滤
  - nai-diffusion-4-curated-preview：NAI4 精选版，有内容过滤
  - nai-diffusion-4-5-curated：NAI4.5 精选版，最新模型
  - nai-diffusion-4-5-full：NAI4.5 完整版（推荐），无内容过滤

■ 采样器与调度器区域
- novelai_sampler：采样方法，影响图像生成的算法
  - k_euler：Euler 采样器（快速，适合大多数场景）
  - ddim_v3：DDIM 采样器（稳定）
  - k_dpmpp_2s_ancestral：DPM++ 2S Ancestral（高质量）
  - k_dpmpp_2m：DPM++ 2M（平衡速度和质量）
  - k_euler_ancestral：Euler Ancestral（更多随机性）
  - k_dpmpp_2m_sde：DPM++ 2M SDE（高质量，较慢）
  - k_dpmpp_sde：DPM++ SDE（最高质量，最慢）
- Schedule：噪点表，控制去噪过程
  - native：原生调度
  - exponential：指数调度
  - polyexponential：多项式指数调度
  - karras：Karras 调度（推荐用于高质量）（默认）

■ 提示词引导参数
- nai3Scale：Prompt Guidance，控制提示词对图像的影响强度（通常 3-7）
- cfg_rescale：Prompt Guidance Rescale，调整 CFG 的缩放（通常 0-0.3）
- AI_use_coords：是否使用 AI 默认的角色位置坐标（分角色模式相关）

■ NAI3 特有参数
- sm：SMEA（Sampling Method Enhancement Algorithm），增强采样方法
- dyn：SMEA DYN，动态 SMEA，进一步优化采样
- nai3Deceisp：Decrisp，减少图像伪影和过度锐化
- nai3Variety：Variety，增加图像多样性（通过 skip_cfg_above_sigma 实现）

■ 生成参数区域
- novelai_size：预设尺寸下拉框，快速选择常用尺寸（这些都算是小图，novelai的大会员默认不收取点数。并且分辨率不能随意调整，否则会报错。）
  - 512x512：小图标（1:1）
  - 640x640：中图标（1:1）
  - 512x768：垂直图（2:3）
  - 768x512：水平图（3:2）
  - 1024x1024：SDXL 标准尺寸（1:1）
  - 1216x832：超高清水平（19:13）
  - 832x1216：超高清垂直（13:19）
- novelai_width / novelai_height：图片的宽度和高度（像素）
- novelai_steps：采样步数，越高质量越好但速度越慢（通常 20-40）（大会员在小于等于28步不收取点数。）
- novelai_seed：随机种子，0 或 -1 表示随机，固定值可复现相同图片

■ 提示词预设区域
- yusheid_novelai：当前选中的提示词预设名称
- fixedPrompt：固定正面提示词（前置），会添加在生成提示词的最前面
- fixedPrompt_end：后置固定正面提示词，会添加在生成提示词的最后面
- negativePrompt：固定负面提示词，用于排除不想要的元素
- 提示词预设支持保存、另存为、导出、导入等操作

■ 提示词替换区域
- prompt_replace_id_novelai：提示词替换规则预设
- prompt_replace_text_novelai：替换规则文本，支持定义替换规则，在生图前自动替换提示词中的特定文本

■ 质量预设区域
- addFurryDataset：是否添加福瑞（Furry）数据集标签
- AQT_novelai：正面质量预设，启用后会根据模型自动添加高质量相关的标签
  - NAI3：best quality, amazing quality, very aesthetic, absurdres
  - NAI4 Full：no text, best quality, very aesthetic, absurdres
  - NAI4.5：very aesthetic, masterpiece, no text
- UCP_novelai：负面质量预设，提供多个预设选项用于排除低质量元素
  - Heavy：重度过滤（最多负面标签）
  - Light：轻度过滤（较少负面标签）
  - Human Focus：人物焦点（针对人物优化）
  - Furry Focus：福瑞焦点（仅 NAI4.5 Full）

■ 氛围转移（Vibe Transfer）区域（仅 NAI3 支持）
- nai3VibeTransfer：启用单个氛围参考图（仅 NAI3 支持）
- InformationExtracted：氛围提取信息强度（0-1），控制从参考图中提取多少信息
- ReferenceStrength：氛围强度（0-1），控制参考图对生成图像的影响程度
- 图片预览：显示当前选择的参考图
- 选择图片/移除图片：上传或移除氛围参考图

■ Vibe 组氛围转移区域（NAI4/4.5）
- Vibe 文件生成器：生成官方兼容的 .naiv4vibe 文件，可导入 NovelAI 官网
- Vibe 组编辑器：管理 Vibe 组预设，最多可包含 4 个 Vibe
- enableVibeGroupTransfer：启用 Vibe 组氛围转移（与单个 Vibe 互斥）（注意nai4以上的氛围转移使用这个）
- normalizeRefStrength：归一化参考强度值，使所有 Vibe 的强度总和为 1.0

■ 角色参考区域（NAI4.5）
- nai3CharRef：启用角色参考功能（⚠️ 每张参考图额外收费 5 点）
- 角色参考图管理：上传角色参考图片到库中
- 角色组编辑器：创建和管理最多包含 4 个角色参考的组合预设
- 角色参考类型：
  - character：角色（外观和风格）
  - character_style：角色和风格
  - style：仅风格

■ 配置档案区域
- novelai_profile_id：当前配置档案名称
- 读取/新建/删除：管理配置档案，可保存多套参数配置快速切换

■ 重要概念说明
- 采样步数（steps）：生成图片的迭代次数，越多细节越好但越慢（推荐 28）
- Prompt Guidance：提示词引导强度，过低图片随机性强，过高可能过度饱和（推荐 5）
- 种子（seed）：控制随机性，相同种子+相同参数=相同图片
- Vibe Transfer：氛围转移，使用参考图的风格和氛围影响生成图像
- Character Reference：角色参考，使用参考图中的角色外观影响生成图像（NAI4.5 独有）
- 分角色模式：当提示词包含 "Scene Composition" 时启用，支持多角色定位
`.trim(),

   workflow: `
【NovelAI 设置引导流程】（当用户需要配置 NovelAI 设置时按此顺序引导）

■ 首次配置流程：
1. 切换到 NovelAI 设置页面：
   <SystemQuery>{"type": "ui_action", "action": "switch_tab_novelai"}</SystemQuery>
2. 确认主要设置中 mode 已设为 "novelai"：
   <SystemQuery>{"type": "read", "path": "mode"}</SystemQuery>
   如果不是，则设置：
   <SystemQuery>{"type": "write", "path": "mode", "value": "novelai"}</SystemQuery>
3. 设置 NovelAI API Key（必须）：
   <SystemQuery>{"type": "write", "path": "novelaiApi", "value": "pst-xxx..."}</SystemQuery>
4. 选择模型（推荐 NAI4.5 完整版）：
   <SystemQuery>{"type": "write", "path": "novelaimode", "value": "nai-diffusion-4-5-curated"}</SystemQuery>
5. 配置基础生成参数（宽度、高度、步数等）
6. 测试生图确认配置正确

■ 调整生成参数流程：
1. 根据用户需求设置图片尺寸：
   - 方形图标：1024x1024
   - 横向图片：1216x832
   - 纵向图片：832x1216
2. 设置采样步数（推荐 28）：
   <SystemQuery>{"type": "write", "path": "novelai_steps", "value": 28}</SystemQuery>
3. 设置 Prompt Guidance（推荐 5）：
   <SystemQuery>{"type": "write", "path": "nai3Scale", "value": 5.0}</SystemQuery>
4. 如果是 NAI3 模型，建议开启 SMEA 和 DYN：
   <SystemQuery>{"type": "write", "path": "sm", "value": "true"}</SystemQuery>
   <SystemQuery>{"type": "write", "path": "dyn", "value": "true"}</SystemQuery>
5. 开启多样性（Variety）增加图像变化：
   <SystemQuery>{"type": "write", "path": "nai3Variety", "value": "true"}</SystemQuery>

■ 配置提示词预设流程：
1. 查看当前提示词预设：
   <SystemQuery>{"type": "read", "path": "yusheid_novelai"}</SystemQuery>
2. 如果需要修改固定提示词，先读取当前内容：
   <SystemQuery>{"type": "read", "path": "yushe[yusheid_novelai].fixedPrompt"}</SystemQuery>
3. 修改固定正面提示词（添加画质、风格等标签）：
   <SystemQuery>{"type": "write", "path": "yushe[yusheid_novelai].fixedPrompt", "value": "masterpiece, best quality"}</SystemQuery>
4. 修改固定负面提示词（排除不想要的元素）：
   <SystemQuery>{"type": "write", "path": "yushe[yusheid_novelai].negativePrompt", "value": "lowres, bad anatomy"}</SystemQuery>
5. 启用正面质量预设（AQT）：
   <SystemQuery>{"type": "write", "path": "AQT_novelai", "value": "best quality, amazing quality, very aesthetic, absurdres"}</SystemQuery>
6. 选择合适的负面质量预设（UCP）：
   <SystemQuery>{"type": "write", "path": "UCP_novelai", "value": "Heavy"}</SystemQuery>

■ 配置氛围转移流程（NAI3 单个 Vibe）：
1. 确认使用 NAI3 模型：
   <SystemQuery>{"type": "read", "path": "novelaimode"}</SystemQuery>
2. 启用氛围参考：
   <SystemQuery>{"type": "write", "path": "nai3VibeTransfer", "value": "true"}</SystemQuery>
3. 提示用户上传参考图（需要通过 UI 操作）
4. 设置氛围提取信息（推荐 1.0）：
   <SystemQuery>{"type": "write", "path": "InformationExtracted", "value": 1.0}</SystemQuery>
5. 设置氛围强度（推荐 0.6）：
   <SystemQuery>{"type": "write", "path": "ReferenceStrength", "value": 0.6}</SystemQuery>

■ 配置 Vibe 组氛围转移流程（NAI4/4.5）：
1. 确认使用 NAI4 或 NAI4.5 模型
2. 打开 Vibe 生成器创建 Vibe 文件：
   <SystemQuery>{"type": "ui_action", "action": "click_button", "selector": "#novelai-vibe-generator-btn"}</SystemQuery>
3. 提示用户上传参考图并生成 Vibe 文件
4. 打开 Vibe 组编辑器：
   <SystemQuery>{"type": "ui_action", "action": "click_button", "selector": "#novelai-vibe-group-editor-btn"}</SystemQuery>
5. 提示用户创建 Vibe 组并添加 Vibe（最多 4 个）
6. 启用 Vibe 组氛围转移：
   <SystemQuery>{"type": "write", "path": "enableVibeGroupTransfer", "value": "true"}</SystemQuery>
7. 建议启用归一化强度值：
   <SystemQuery>{"type": "write", "path": "normalizeRefStrength", "value": "true"}</SystemQuery>

■ 配置角色参考流程（NAI4.5）：
1. 确认使用 NAI4.5 模型（curated 或 full）
2. ⚠️ 提醒用户：每次每张角色参考图额外收费 5 点
3. 打开角色参考图上传：
   <SystemQuery>{"type": "ui_action", "action": "click_button", "selector": "#novelai-char-ref-upload-btn"}</SystemQuery>
4. 提示用户上传角色参考图到库中
5. 打开角色组编辑器：
   <SystemQuery>{"type": "ui_action", "action": "click_button", "selector": "#novelai-char-ref-group-editor-btn"}</SystemQuery>
6. 提示用户创建角色组并添加参考图（最多 4 个）
7. 启用角色参考：
   <SystemQuery>{"type": "write", "path": "nai3CharRef", "value": "true"}</SystemQuery>

■ 切换模型流程：
1. 根据用户需求选择合适的模型：
   - 动漫风格 + 需要 SMEA → NAI3
   - 高质量 + 无过滤 → NAI4.5 Full （推荐）
   - 高质量 + 有过滤 → NAI4.5 Curated
2. 设置模型：
   <SystemQuery>{"type": "write", "path": "novelaimode", "value": "nai-diffusion-4-5-curated"}</SystemQuery>
3. 根据模型调整参数：
   - NAI3：开启 sm、dyn、nai3Deceisp
   - NAI4/4.5：关闭 NAI3 特有参数
4. 调整质量预设（AQT 和 UCP 会根据模型自动适配）

■ 云端队列配置流程（多人共享 API）：
1. 启用云端队列：
   <SystemQuery>{"type": "write", "path": "enableCloudQueue", "value": "true"}</SystemQuery>
2. 设置队列服务地址：
   <SystemQuery>{"type": "write", "path": "cloudQueueUrl", "value": "https://xxx.hf.space"}</SystemQuery>
3. 设置个性化问候语（可选）：
   <SystemQuery>{"type": "write", "path": "cloudQueueGreeting", "value": "正在生成中~"}</SystemQuery>
4. 选择是否显示他人问候语：
   <SystemQuery>{"type": "write", "path": "showQueueGreeting", "value": "true"}</SystemQuery>

■ 配置档案管理流程：
1. 查看当前配置档案：
   <SystemQuery>{"type": "read", "path": "novelai_profile_id"}</SystemQuery>
2. 新建配置档案（保存当前设置）：
   <SystemQuery>{"type": "ui_action", "action": "click_button", "selector": "#novelai_profile_new"}</SystemQuery>
3. 切换配置档案：
   <SystemQuery>{"type": "write", "path": "novelai_profile_id", "value": "配置名称"}</SystemQuery>
   <SystemQuery>{"type": "ui_action", "action": "click_button", "selector": "#novelai_profile_load"}</SystemQuery>

■ 测试生图流程：
1. 确认所有必要配置已完成：
   <SystemQuery>{"type": "check_config"}</SystemQuery>
2. 提示用户可以在聊天中使用触发标记测试生图
3. 如果生图失败，检查 API Key 是否正确，余额是否充足
`.trim(),

   errorGuide: `
【NovelAI 常见问题】

■ API 连接问题
- API Key 无效：确认 novelaiApi 格式正确（pst- 开头），检查是否过期或余额不足
- 无法连接官网：检查网络连接，浏览器是否开启的vpn（梯子/魔法），如果是jiuguan客户端那么如果是电脑，需要vpn开启tun（虚拟网卡）模式，或者在酒馆的配置里设置代理。
- 镜像站无法使用：确认 novelaiOtherSite 地址正确，包含完整的 URL，仅支持镜像站，如果是其他的第三放接口不同可能无法支持。
- 429报错：是其他人在同时使用报错了。

■ 模型选择问题
- 不知道选哪个模型：
  - 新手推荐：nai-diffusion-4-5-curated
  - 动漫风格：nai-diffusion-3（支持 SMEA）
  - 无过滤需求：nai-diffusion-4-5-full（最新）
- 模型切换后效果变差：不同模型需要不同的参数配置，切换模型后需调整 AQT/UCP 预设
- NAI3 特有功能不可用：SMEA、SMEA DYN、Decrisp 仅在 NAI3 模型下可用

■ 生成参数问题
- 图片质量差：增加采样步数（28），调整 Prompt Guidance（5-7），检查提示词质量
- 图片过度饱和/扭曲：降低 Prompt Guidance（3-5），检查负面提示词是否过多
- 生成速度慢：降低采样步数（20-25），减小图片尺寸，使用快速采样器（k_euler）
- 种子不生效：确认 novelai_seed 设置为具体数值（非 0/-1），且其他参数完全相同
- 图片尺寸限制：NovelAI 对不同模型有尺寸限制，超出范围会报错

■ 提示词问题
- 提示词不生效：检查提示词格式，确认没有语法错误
- 中文提示词无效：NovelAI 需要英文提示词
- 提示词过长：NovelAI 有 token 限制，过长会被截断，精简提示词
- 固定提示词未生效：确认 yusheid_novelai 指向正确的预设，检查 fixedPrompt 内容

■ 质量预设问题
- AQT 不生效：确认 AQT_novelai 已启用（非空值），不同模型的 AQT 内容不同
- UCP 选项不匹配：不同模型支持的 UCP 选项不同，切换模型后需重新选择
- 负面提示词冲突：固定负面提示词和 UCP 可能有重复，但通常不影响效果

■ 氛围转移问题（Vibe Transfer）
- 单个 Vibe 不生效：
  - 确认使用 NAI3 模型（NAI4/4.5 不支持单个 Vibe）
  - 确认 nai3VibeTransfer 已启用
  - 检查是否已上传参考图
- Vibe 组不生效：
  - 确认使用 NAI4 或 NAI4.5 模型（NAI3 不支持 Vibe 组）
  - 确认 enableVibeGroupTransfer 已启用
  - 检查 Vibe 组是否已创建并选中
  - 确认 Vibe 文件已正确生成并添加到组中
- 参考图影响太强/太弱：调整 ReferenceStrength（0.4-0.8），或调整 InformationExtracted
- Vibe 强度总和超过 1.0：启用 normalizeRefStrength 自动归一化
- Vibe 文件生成失败：检查参考图格式（支持 PNG、JPG），图片不能太大

■ 角色参考问题（Character Reference）
- 角色参考不生效：
  - 确认使用 NAI4.5 模型（NAI3/NAI4 不支持角色参考）
  - 确认 nai3CharRef 已启用
  - 检查角色组是否已创建并选中
  - 确认客户端模式为 "browser"（酒馆端不支持）
- 角色参考收费问题：每张角色参考图每次生图额外收费 5 点，使用前需确认余额充足
- 角色参考效果不理想：调整参考图的 strength（0.4-0.8），或更换参考图类型（character/style）
- 角色组无法添加更多参考：最多支持 4 个角色参考，超出需删除旧的

■ 云端队列问题
- 队列服务无法连接：检查 cloudQueueUrl 是否正确，服务是否在线
- 排队时间过长：可能是使用人数过多，耐心等待或考虑使用独立 API Key
- 个性语不显示：确认 showQueueGreeting 已启用，且其他用户设置了个性语

■ 配置档案问题
- 配置档案切换失败：确认配置档案名称正确，点击"读取"按钮加载配置
- 配置档案丢失：配置档案保存在浏览器本地，清除浏览器数据会导致丢失
- 新建配置档案无效：新建后需要手动保存当前设置到新配置中

■ 客户端模式问题
- 图片不显示：检查 client 设置（browser 或 jiuguan）
- 酒馆模式图片丢失：确认酒馆后端正常运行，jiuguanchucun 已开启
- 浏览器模式缓存满：定期清理图片缓存
- 酒馆端不支持某些功能：角色参考、Vibe 组等高级功能仅支持 browser 模式

■ 性能优化建议
- 首次生图慢：模型加载需要时间，后续会快很多
- 批量生图：调大 imageGenInterval 避免请求过于频繁
- 降低成本：使用较小的图片尺寸（832x1216），减少采样步数（20-25）
- 加快生成速度：使用快速采样器（k_euler）+ 较少步数（20-25）
- 节省 API 额度：关闭角色参考（每张图额外收费），使用 Vibe 组代替

■ 分角色模式问题
- 分角色模式不生效：确认提示词包含 "Scene Composition" 关键字
- 角色位置不准确：调整 AI_use_coords 开关，或手动指定坐标
- 角色负面提示词未生效：确认使用分角色模式，且每个角色都设置了 UC（负面提示词）

■ 其他常见问题
- 生图失败但不报错：检查浏览器控制台日志，可能是网络问题或参数错误
- 图片与提示词不符：检查提示词是否被替换规则修改，查看实际发送的提示词
- 随机性太强：降低 Variety（关闭 nai3Variety），增加 Prompt Guidance
- 图片重复性太高：开启 Variety，使用随机种子（seed 设为 0/-1）
`.trim()
};
