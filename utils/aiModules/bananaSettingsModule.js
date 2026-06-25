/**
 * Banana/Grok 设置助手模块
 */

export const bananaSettingsModule = {
    name: 'Banana/Grok 设置助手',
    summary: '帮助用户配置 Banana/Grok 图像生成后端，包括 API 连接、模型选择（Gemini/Imagen）、对话预设、角色预设、修图和视频生成功能。当用户提到 Banana、Grok、Gemini 图像生成、修图、视频生成等需求时加载此模块。',

    commands: `
【Banana/Grok 模块可用命令】

■ 基础配置命令

切换到 Banana 设置页面：
<SystemQuery>{"type": "ui_action", "action": "switch_tab_banana"}</SystemQuery>

设置 Banana API 地址：
<SystemQuery>{"type": "write", "path": "banana.apiUrl", "value": "https://generativelanguage.googleapis.com"}</SystemQuery>

设置 Banana API Key：
<SystemQuery>{"type": "write", "path": "banana.apiKey", "value": "your-api-key-here"}</SystemQuery>

获取可用模型列表：
<SystemQuery>{"type": "ui_action", "action": "banana_fetch_models"}</SystemQuery>

■ 模型配置命令

设置图像生成模型：
<SystemQuery>{"type": "write", "path": "banana.model", "value": "gemini-2.0-flash-exp"}</SystemQuery>

设置视频生成模型：
<SystemQuery>{"type": "write", "path": "banana.videoModel", "value": "gemini-2.0-flash-exp"}</SystemQuery>

设置图片宽高比：
<SystemQuery>{"type": "write", "path": "banana.aspectRatio", "value": "1:1"}</SystemQuery>

■ 对话预设配置

查看当前对话预设：
<SystemQuery>{"type": "read", "path": "banana.conversationPresetId"}</SystemQuery>

切换对话预设：
<SystemQuery>{"type": "write", "path": "banana.conversationPresetId", "value": "预设名称"}</SystemQuery>

设置修图预设：
<SystemQuery>{"type": "write", "path": "banana.editPresetId", "value": "预设名称"}</SystemQuery>

设置视频预设：
<SystemQuery>{"type": "write", "path": "banana.videoPresetId", "value": "预设名称"}</SystemQuery>

■ 角色预设配置

查看当前角色预设：
<SystemQuery>{"type": "read", "path": "bananaCharacterPresetId"}</SystemQuery>

切换角色预设：
<SystemQuery>{"type": "write", "path": "bananaCharacterPresetId", "value": "角色名称"}</SystemQuery>
`.trim(),

    knowledge: `
【Banana/Grok 页面功能说明】

■ API 连接区域
- banana.apiUrl：Banana/Grok API 的地址，通常为 Google Generative Language API 地址
- banana.apiKey：API 密钥，用于身份验证
- 获取模型按钮：点击后会连接 API 并获取可用的模型列表

■ 模型选择区域
- banana.model：用于图像生成的模型，支持 Gemini 和 Imagen 系列
- banana.videoModel：用于视频生成的模型，通常使用 Gemini 2.0 系列
- banana.aspectRatio：生成图片的宽高比，可选 1:1、16:9、9:16 等

■ 对话预设区域
- conversationPresetId：当前选中的对话预设，用于图像生成
- editPresetId：修图模式使用的预设
- videoPresetId：视频生成模式使用的预设
- 对话预设包含多轮对话历史和固定提示词，用于引导模型生成特定风格的图像

■ 角色预设区域
- bananaCharacterPresetId：当前选中的角色预设
- 角色预设包含触发词和参考对话，当提示词中包含触发词时自动应用

■ 重要概念说明
- Gemini 模型：支持多模态对话，可以理解图片和文本，适合复杂的图像生成任务
- Imagen 模型：专门的图像生成模型，使用单轮提示词生成
- 对话预设：通过多轮对话示例引导模型理解你想要的风格
- 修图模式：使用 {修图} 标记，可以基于现有图片进行修改
- 视频模式：使用 {视频} 标记，可以生成短视频
`.trim(),

    workflow: `
【Banana/Grok 设置引导流程】

■ 首次配置流程：
1. 切换到 Banana 设置页面
2. 确认主要设置中 mode 已设为 "banana"
3. 设置 API 地址和密钥
4. 点击获取模型列表
5. 选择合适的图像生成模型
6. 配置对话预设（可选）
7. 测试生成图片

■ 使用修图功能流程：
1. 确保已配置好基础设置
2. 设置修图预设（editPresetId）
3. 在提示词中使用 {修图} 标记
4. 提供要修改的图片和修改指令

■ 使用视频生成流程：
1. 确保已配置好基础设置
2. 设置视频模型（videoModel）
3. 设置视频预设（videoPresetId）
4. 在提示词中使用 {视频} 标记
5. 提供视频描述和参考图片（可选）
`.trim(),

    errorGuide: `
【Banana/Grok 常见问题】

■ 连接问题
- 无法连接 API：检查 apiUrl 和 apiKey 是否正确
- 认证失败：确认 API Key 有效且有足够的配额
- 跨域错误：使用 client="jiuguan" 模式通过酒馆代理

■ 模型问题
- 模型列表为空：点击获取模型按钮重新获取
- 模型不支持图像生成：确认选择的是 Gemini 2.0 或 Imagen 系列

■ 生成问题
- 图片质量不佳：调整对话预设，添加更详细的风格描述
- 修图功能无效：确认使用了 {修图} 标记且提供了图片
- 视频生成失败：确认模型支持视频生成（如 gemini-2.0-flash-exp）
`.trim()
};
