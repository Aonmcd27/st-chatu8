/**
 * LLM 设置助手模块
 */

export const llmSettingsModule = {
  name: 'LLM 设置助手',
  summary: '帮助用户配置 LLM（大语言模型）设置，包括 API 连接、模型选择、参数调优（温度、top_p、最大令牌数）、配置文件管理、请求类型配置、上下文预设等。当用户提到 LLM 配置、API 设置、模型参数、温度调整、配置文件导入导出等需求时加载此模块。',

  commands: `
【LLM 模块可用命令】

■ 基础配置命令

切换到 LLM 设置页面：
<SystemQuery>{"type": "ui_action", "action": "switch_tab_llm"}</SystemQuery>

设置 LLM API 地址：
<SystemQuery>{"type": "write", "path": "llm.api_url", "value": "https://api.openai.com/v1"}</SystemQuery>

设置 LLM API Key：
<SystemQuery>{"type": "write", "path": "llm.api_key", "value": "your-api-key-here"}</SystemQuery>

设置 LLM 模型：
<SystemQuery>{"type": "write", "path": "llm.model", "value": "gpt-4"}</SystemQuery>

获取可用模型列表：
<SystemQuery>{"type": "ui_action", "action": "llm_fetch_models"}</SystemQuery>

■ 参数配置命令

设置温度（Temperature）：
<SystemQuery>{"type": "write", "path": "llm.temperature", "value": 0.8}</SystemQuery>

设置 Top P：
<SystemQuery>{"type": "write", "path": "llm.top_p", "value": 1.0}</SystemQuery>

设置最大令牌数（Max Tokens）：
<SystemQuery>{"type": "write", "path": "llm.max_tokens", "value": 4000}</SystemQuery>

设置历史深度：
<SystemQuery>{"type": "write", "path": "llm.history_depth", "value": 10}</SystemQuery>

■ 开关配置命令

启用/禁用流式输出：
<SystemQuery>{"type": "write", "path": "llm.stream", "value": true}</SystemQuery>

启用/禁用代理绕过：
<SystemQuery>{"type": "write", "path": "llm.bypass_proxy", "value": false}</SystemQuery>

■ 配置文件管理命令

浏览所有 LLM 配置文件：
<SystemQuery>{"type": "browse", "path": "llm_profiles"}</SystemQuery>

查看特定配置文件的详细信息：
<SystemQuery>{"type": "read", "path": "llm_profiles.默认"}</SystemQuery>

查看当前配置文件名称：
<SystemQuery>{"type": "read", "path": "current_llm_profile"}</SystemQuery>

切换配置文件（注意：这会改变当前使用的 API 配置）：
<SystemQuery>{"type": "write", "path": "current_llm_profile", "value": "配置文件名称"}</SystemQuery>

■ 上下文预设管理命令

浏览所有上下文预设：
<SystemQuery>{"type": "browse", "path": "test_context_profiles"}</SystemQuery>

查看特定上下文预设的详细信息：
<SystemQuery>{"type": "read", "path": "test_context_profiles.默认"}</SystemQuery>

查看当前使用的上下文预设：
<SystemQuery>{"type": "read", "path": "current_test_context_profile"}</SystemQuery>

切换当前上下文预设：
<SystemQuery>{"type": "write", "path": "current_test_context_profile", "value": "预设名称"}</SystemQuery>

■ 请求类型配置命令

⚠️ 重要：请求类型对象的属性名是固定的，只有 api_profile 和 context_profile 两个属性。
不要猜测其他名称（如 context_preset 等），否则写入会失败。如有疑问请先 browse 查看。

浏览所有请求类型配置：
<SystemQuery>{"type": "browse", "path": "llm_request_type_configs"}</SystemQuery>

查看特定请求类型的配置：
<SystemQuery>{"type": "read", "path": "llm_request_type_configs.image_gen"}</SystemQuery>

设置图像生成请求的 API 配置和上下文预设：
<SystemQuery>{"type": "write", "path": "llm_request_type_configs.image_gen.api_profile", "value": "配置文件名称"}</SystemQuery>
<SystemQuery>{"type": "write", "path": "llm_request_type_configs.image_gen.context_profile", "value": "预设名称"}</SystemQuery>

设置角色设计请求的配置：
<SystemQuery>{"type": "write", "path": "llm_request_type_configs.char_design.api_profile", "value": "配置文件名称"}</SystemQuery>
<SystemQuery>{"type": "write", "path": "llm_request_type_configs.char_design.context_profile", "value": "预设名称"}</SystemQuery>

设置角色展示请求的配置：
<SystemQuery>{"type": "write", "path": "llm_request_type_configs.char_display.api_profile", "value": "配置文件名称"}</SystemQuery>
<SystemQuery>{"type": "write", "path": "llm_request_type_configs.char_display.context_profile", "value": "预设名称"}</SystemQuery>

设置角色修改请求的配置：
<SystemQuery>{"type": "write", "path": "llm_request_type_configs.char_modify.api_profile", "value": "配置文件名称"}</SystemQuery>
<SystemQuery>{"type": "write", "path": "llm_request_type_configs.char_modify.context_profile", "value": "预设名称"}</SystemQuery>

设置翻译请求的配置：
<SystemQuery>{"type": "write", "path": "llm_request_type_configs.translation.api_profile", "value": "配置文件名称"}</SystemQuery>
<SystemQuery>{"type": "write", "path": "llm_request_type_configs.translation.context_profile", "value": "预设名称"}</SystemQuery>

设置标签修改请求的配置：
<SystemQuery>{"type": "write", "path": "llm_request_type_configs.tag_modify.api_profile", "value": "配置文件名称"}</SystemQuery>
<SystemQuery>{"type": "write", "path": "llm_request_type_configs.tag_modify.context_profile", "value": "预设名称"}</SystemQuery>
`.trim(),

  knowledge: `
【LLM 页面功能说明】

■ API 连接区域
- llm.api_url：LLM API 的地址，支持 OpenAI 兼容的 API 端点
- llm.api_key：API 密钥，用于身份验证
- llm.model：使用的模型名称，如 gpt-4、claude-3-opus 等
- 获取模型按钮：点击后会连接 API 并获取可用的模型列表

■ 参数调优区域
- llm.temperature（温度）：控制输出的随机性，范围 0.0-2.0
  * 0.0-0.3：非常确定性，适合翻译、代码生成等需要精确输出的任务
  * 0.4-0.7：平衡创造性和一致性，适合大多数对话场景
  * 0.8-1.2：较高创造性，适合创意写作、头脑风暴
  * 1.3-2.0：极高随机性，输出可能不稳定
- llm.top_p（核采样）：控制采样范围，范围 0.0-1.0
  * 1.0：考虑所有可能的词（默认推荐）
  * 0.9：只考虑累积概率前 90% 的词，输出更聚焦
  * 0.5：更严格的筛选，输出更保守
- llm.max_tokens（最大令牌数）：单次请求的最大输出长度
  * 建议根据模型上下文窗口设置，如 GPT-4 可设 4000-8000
  * 设置过小会导致输出被截断
  * 设置过大会增加成本和延迟
- llm.history_depth（历史深度）：上下文中包含的历史消息轮数
  * 0：不包含历史，每次都是全新对话
  * 5-10：适合大多数场景，保持上下文连贯
  * 20+：长期记忆，但会增加 token 消耗

■ 开关配置区域
- llm.stream（流式输出）：启用后逐字输出结果，提升用户体验
- llm.bypass_proxy（绕过代理）：直接连接 API，不通过酒馆代理

■ 配置文件管理区域
- 配置文件（Profile）：保存一组完整的 API 配置（URL、Key、模型、参数）
- 可以创建多个配置文件，用于不同的模型或场景
- 支持导入/导出配置文件，方便备份和分享
- 切换配置文件会立即应用该配置的所有设置

■ 请求类型配置区域
- 不同类型的 LLM 请求可以使用不同的配置文件和上下文预设
- 支持的请求类型：
  * image_gen：图像生成提示词优化
  * char_design：角色设计
  * char_display：角色展示
  * char_modify：角色修改
  * translation：翻译
  * tag_modify：标签修改
- 每个请求类型可以独立配置：
  * API 配置文件：选择使用哪个配置文件的 API 设置
  * 上下文预设：选择使用哪个上下文预设（包含系统提示词和示例对话）

■ 上下文预设区域
- 上下文预设（Context Preset）：包含系统提示词和示例对话的模板
- 每个预设包含多个条目（Entry），每个条目有：
  * 名称：条目的标识
  * 角色：system（系统）、user（用户）、assistant（助手）
  * 内容：提示词或对话内容
  * 触发模式：常开（always）或触发（trigger）
  * 触发词：当触发模式为"触发"时，只有用户输入包含触发词才会包含此条目
  * 启用状态：是否启用此条目
- 可以创建、编辑、删除、导入、导出预设
- 支持虚拟滚动，高效处理大量条目

■ 重要概念说明
- API 配置文件 vs 上下文预设：
  * API 配置文件：定义"如何连接"和"使用什么模型"
  * 上下文预设：定义"如何引导模型"和"提供什么示例"
- 请求类型配置：将特定任务与特定配置关联
  * 例如：图像生成使用 GPT-4 + 图像优化预设
  * 翻译使用 Claude + 翻译预设
- 温度和 Top P 的关系：
  * 通常只需要调整其中一个
  * 温度更直观，Top P 更精确
  * 建议：先调温度，如果效果不理想再调 Top P
`.trim(),

  workflow: `
【LLM 设置引导流程】

■ 首次配置流程：
1. 切换到 LLM 设置页面
2. 设置 API 地址和密钥
3. 点击获取模型列表
4. 选择合适的模型
5. 调整参数（温度、Top P、最大令牌数）
6. 保存为配置文件（可选）
7. 测试连接

■ 创建配置文件流程：
1. 填写完整的 API 配置
2. 点击"保存为新配置文件"按钮
3. 输入配置文件名称
4. 确认保存

■ 配置请求类型流程：
1. 确保已创建至少一个配置文件
2. 确保已创建至少一个上下文预设
3. 在请求类型配置区域选择对应的配置文件和预设
4. 保存设置

■ 导入上下文预设流程：
建议用户到作者相关的教程或者社区里获取上下文预设进行导入
教程地址:https://my.feishu.cn/wiki/IVLXwa9g3iew9WkM2OZcaQFunNe#share-Qkked94PjowvKWxeMKycMRtonc4
引导用户在上下文配置中导入预设文件
作者预设的上下文推荐配置:
comfyui：

 正文图片生成 : 设计师comfyui生图变量
  角色/服装设计：设计师角色设计
  角色/服装展示 :设计师生图展示
 角色/服装修改:设计师角色服装修改
  翻译：翻译
 Tag修改:设计师comfyui tag修改

 novelai 的不同:
  
正文图片生成：nai生图变量

Tag修改：nai tag 修改变量

■ 参数调优建议：
1. 图像生成提示词优化：temperature=0.7, top_p=1.0
2. 翻译任务：temperature=0.3, top_p=0.9
3. 创意写作：temperature=0.9, top_p=1.0
4. 代码生成：temperature=0.2, top_p=0.95
5. 对话聊天：temperature=0.8, top_p=1.0

■ 导入导出流程：
1. 导出配置文件：点击配置文件旁的导出按钮，下载 JSON 文件
2. 导入配置文件：点击导入按钮，选择 JSON 文件
3. 导出上下文预设：点击预设旁的导出按钮
4. 导入上下文预设：点击导入按钮，选择 JSON 文件
`.trim(),

  errorGuide: `
【LLM 常见问题】

■ 连接问题
- 无法连接 API：检查 api_url 和 api_key 是否正确
- 认证失败：确认 API Key 有效且有足够的配额
- 跨域错误：尝试启用 bypass_proxy 或使用酒馆代理
- 超时：检查网络连接，或增加超时时间

■ 模型问题
- 模型列表为空：点击获取模型按钮重新获取
- 模型不支持：确认 API 端点支持所选模型
- 模型响应慢：尝试切换到更快的模型或减少 max_tokens

■ 参数问题
- 输出太随机/不稳定：降低 temperature（如 0.7 → 0.5）
- 输出太死板/重复：提高 temperature（如 0.5 → 0.8）
- 输出被截断：增加 max_tokens
- Token 消耗过大：减少 history_depth 或 max_tokens

■ 配置文件问题
- 配置文件丢失：检查浏览器本地存储，或重新导入备份
- 切换配置文件无效：确认已保存设置，刷新页面重试
- 导入失败：检查 JSON 文件格式是否正确

■ 上下文预设问题
- 预设不生效：检查条目是否启用，触发词是否匹配
- 条目过多导致卡顿：启用虚拟滚动（默认已启用）
- 触发词不工作：确认触发模式设为"触发"，且触发词拼写正确

■ 请求类型配置问题
- 特定请求类型不工作：检查该类型是否配置了有效的配置文件和预设
- 使用了错误的配置：确认请求类型配置中选择的配置文件正确

■ 性能优化建议
- 减少不必要的历史消息：降低 history_depth
- 使用更快的模型：如 gpt-3.5-turbo 代替 gpt-4
- 启用流式输出：提升用户体验
- 合理设置 max_tokens：避免浪费
- 使用触发模式的条目：减少不必要的上下文
`.trim()
};
