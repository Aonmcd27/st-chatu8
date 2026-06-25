/**
 * Stable Diffusion 设置助手模块
 * 
 * TODO: 从 utils/aiPromptModules.js 的 sd_settings 对象提取内容
 * 位置: 约第 400-800 行
 * 
 * 提取步骤:
 * 1. 打开 utils/aiPromptModules.js
 * 2. 找到 sd_settings: { ... } 对象
 * 3. 复制 name, summary, commands, knowledge, workflow, errorGuide 的完整内容
 * 4. 粘贴到下面的 sdSettingsModule 对象中
 * 5. 确保所有反引号和字符串正确闭合
 */

export const sdSettingsModule = {
   name: 'Stable Diffusion 设置助手',
   summary: '帮助用户配置 Stable Diffusion WebUI 的各项参数，包括 API 连接、模型选择、采样参数、提示词预设、LORA、高清修复等。当用户提到 SD 设置、模型切换、采样器、提示词预设、LORA 等需求时加载此模块。',

   commands: `
【SD 模块可用命令】

■ 基础配置命令

切换到 SD 设置页面：
<SystemQuery>{"type": "ui_action", "action": "switch_tab_sd"}</SystemQuery>

设置 SD API 地址：
<SystemQuery>{"type": "write", "path": "sdUrl", "value": "http://127.0.0.1:7860"}</SystemQuery>

设置 SD 身份验证（格式：用户名:密码）：
<SystemQuery>{"type": "write", "path": "st_chatu8_sd_auth", "value": "username:password"}</SystemQuery>

连接并刷新 SD 数据（获取模型、采样器等列表）：
<SystemQuery>{"type": "ui_action", "action": "click_button", "selector": "#testSd"}</SystemQuery>

■ 模型与采样器配置

设置当前使用的模型：
<SystemQuery>{"type": "write", "path": "sd_cchatu_8_model", "value": "模型名称.safetensors"}</SystemQuery>

设置 VAE：
<SystemQuery>{"type": "write", "path": "sd_cchatu_8_vae", "value": "vae名称.safetensors"}</SystemQuery>

设置采样方法：
<SystemQuery>{"type": "write", "path": "sd_cchatu_8_samplerName", "value": "DPM++ 2M"}</SystemQuery>

设置调度器：
<SystemQuery>{"type": "write", "path": "sd_cchatu_8_scheduler", "value": "Karras"}</SystemQuery>

■ 生成参数配置

设置图片宽度：
<SystemQuery>{"type": "write", "path": "sd_cwidth", "value": 1024}</SystemQuery>

设置图片高度：
<SystemQuery>{"type": "write", "path": "sd_cheight", "value": 1024}</SystemQuery>

设置采样步数：
<SystemQuery>{"type": "write", "path": "sd_csteps", "value": 30}</SystemQuery>

设置 CFG Scale：
<SystemQuery>{"type": "write", "path": "sdCfgScale", "value": 7.0}</SystemQuery>

设置 Clip Skip：
<SystemQuery>{"type": "write", "path": "sd_cclip_skip", "value": 2}</SystemQuery>

设置种子（-1 为随机）：
<SystemQuery>{"type": "write", "path": "sd_cseed", "value": -1}</SystemQuery>

■ 高清修复配置

开启/关闭高清修复：
<SystemQuery>{"type": "write", "path": "sd_chires_fix", "value": "true"}</SystemQuery>

设置高清修复步数：
<SystemQuery>{"type": "write", "path": "sd_chires_steps", "value": 20}</SystemQuery>

设置放大器：
<SystemQuery>{"type": "write", "path": "sd_cchatu_8_upscaler", "value": "R-ESRGAN 4x+"}</SystemQuery>

设置放大倍数：
<SystemQuery>{"type": "write", "path": "sd_cupscale_factor", "value": 2.0}</SystemQuery>

设置去噪强度：
<SystemQuery>{"type": "write", "path": "sd_cdenoising_strength", "value": 0.7}</SystemQuery>

■ 修复功能配置

开启/关闭面部修复：
<SystemQuery>{"type": "write", "path": "restoreFaces", "value": "true"}</SystemQuery>

开启/关闭 ADetailer 脸部修复：
<SystemQuery>{"type": "write", "path": "sd_cadetailer", "value": "true"}</SystemQuery>

■ 提示词预设配置

查看当前提示词预设：
<SystemQuery>{"type": "read", "path": "yusheid_sd"}</SystemQuery>

切换提示词预设：
<SystemQuery>{"type": "write", "path": "yusheid_sd", "value": "预设名称"}</SystemQuery>

查看当前预设的固定正面提示词：
<SystemQuery>{"type": "read", "path": "yushe[yusheid_sd].fixedPrompt"}</SystemQuery>

修改固定正面提示词：
<SystemQuery>{"type": "write", "path": "yushe[yusheid_sd].fixedPrompt", "value": "masterpiece, best quality"}</SystemQuery>

修改后置固定正面提示词：
<SystemQuery>{"type": "write", "path": "yushe[yusheid_sd].fixedPrompt_end", "value": "highly detailed"}</SystemQuery>

修改固定负面提示词：
<SystemQuery>{"type": "write", "path": "yushe[yusheid_sd].negativePrompt", "value": "lowres, bad anatomy"}</SystemQuery>

■ 质量预设配置

设置正面质量预设：
<SystemQuery>{"type": "write", "path": "AQT_sd", "value": "best quality, amazing quality, very aesthetic, absurdres"}</SystemQuery>

设置负面质量预设：
<SystemQuery>{"type": "write", "path": "UCP_sd", "value": "bad proportions, lowres, bad anatomy"}</SystemQuery>
`.trim(),

   knowledge: `
【SD 页面功能说明】

■ API 连接区域
- sdUrl：SD WebUI 的 API 地址，通常为 http://127.0.0.1:7860
- st_chatu8_sd_auth：如果 SD WebUI 开启了身份验证，需要填写"用户名:密码"格式
- 连接刷新数据按钮：点击后会连接 SD API 并获取可用的模型、VAE、采样器、放大器等列表；（如果失败那么可以调用诊断与日志模块读取错误信息）

■ 提示词预设区域
- yusheid_sd：当前选中的提示词预设名称
- fixedPrompt：固定正面提示词（前置），会添加在生成提示词的最前面
- fixedPrompt_end：后置固定正面提示词，会添加在生成提示词的最后面
- negativePrompt：固定负面提示词，用于排除不想要的元素
- 提示词预设支持保存、另存为、导出、导入等操作

■ LORA 区域
- 可以从下拉列表中选择 LORA 并添加到提示词中
- LORA 格式通常为 <lora:名称:权重>

■ 提示词替换区域
- prompt_replace_id：提示词替换规则预设
- 支持定义替换规则，在生图前自动替换提示词中的特定文本

■ 质量预设区域
- AQT_sd：正面质量预设，启用后会自动添加高质量相关的标签
- UCP_sd：负面质量预设，提供多个预设选项用于排除低质量元素

■ 模型与采样器区域
- sd_cchatu_8_model：当前使用的 Stable Diffusion 模型
- sd_cchatu_8_vae：VAE 模型，用于图像编码解码
- sd_cchatu_8_samplerName：采样方法，如 DPM++ 2M、Euler a 等
- sd_cchatu_8_scheduler：调度器，如 Karras、Exponential 等

■ 生成参数区域
- sd_csize：预设尺寸下拉框，选择后会自动设置宽度和高度
- sd_cwidth / sd_cheight：图片的宽度和高度（像素）
- sd_csteps：采样步数，越高质量越好但速度越慢（通常 20-40）
- sdCfgScale：CFG Scale，控制提示词的引导强度（通常 7-12）
- sd_cclip_skip：Clip Skip，跳过 CLIP 的最后几层（通常 1-2）
- sd_cseed：随机种子，-1 表示随机，固定值可复现相同图片

■ 高清修复区域
- sd_chires_fix：是否启用高清修复（Hires Fix）
- sd_chires_steps：高清修复的采样步数
- sd_cchatu_8_upscaler：使用的放大算法（如 R-ESRGAN 4x+）
- sd_cupscale_factor：放大倍数（如 2.0 表示放大 2 倍）
- sd_cdenoising_strength：去噪强度，控制高清修复时的变化程度（0.0-1.0）

■ 修复功能区域
- restoreFaces：面部修复开关，使用 SD 内置的面部修复功能
- sd_cadetailer：ADetailer 脸部修复，使用 ADetailer 扩展进行更精细的面部修复

■ 重要概念说明
- 采样步数（steps）：生成图片的迭代次数，越多细节越好但越慢
- CFG Scale：提示词引导强度，过低图片随机性强，过高可能过度饱和
- 去噪强度（denoising_strength）：高清修复时的重绘幅度，越高变化越大
- Clip Skip：跳过 CLIP 最后几层，某些模型（如动漫模型）推荐设为 2
- 种子（seed）：控制随机性，相同种子+相同参数=相同图片
`.trim(),

   workflow: `
【SD 设置引导流程】（当用户需要配置 SD 设置时按此顺序引导）

■ 首次配置流程：
1. 切换到 SD 设置页面：
   <SystemQuery>{"type": "ui_action", "action": "switch_tab_sd"}</SystemQuery>
2. 确认主要设置中 mode 已设为 "sd"：
   <SystemQuery>{"type": "read", "path": "mode"}</SystemQuery>
   如果不是，则设置：
   <SystemQuery>{"type": "write", "path": "mode", "value": "sd"}</SystemQuery>
3. 设置 SD API 地址（如果用户未提供，使用默认值）：
   <SystemQuery>{"type": "write", "path": "sdUrl", "value": "http://127.0.0.1:7860"}</SystemQuery>
4. 如果需要身份验证，设置认证信息：
   <SystemQuery>{"type": "write", "path": "st_chatu8_sd_auth", "value": "用户名:密码"}</SystemQuery>
5. 点击连接刷新数据按钮，获取可用的模型和参数列表：
   <SystemQuery>{"type": "ui_action", "action": "click_button", "selector": "#testSd"}</SystemQuery>
6. 等待刷新完成后，选择模型（需要用户确认或从列表中选择）
7. 配置基础生成参数（宽度、高度、步数等）

■ 调整生成参数流程：
1. 根据用户需求设置图片尺寸：
   - 方形图标：1024x1024
   - 横向图片：1216x832
   - 纵向图片：832x1216
2. 设置采样步数（推荐 20-40）：
   <SystemQuery>{"type": "write", "path": "sd_csteps", "value": 30}</SystemQuery>
3. 设置 CFG Scale（推荐 7-12）：
   <SystemQuery>{"type": "write", "path": "sdCfgScale", "value": 7.5}</SystemQuery>
4. 如果是动漫模型，设置 Clip Skip 为 2：
   <SystemQuery>{"type": "write", "path": "sd_cclip_skip", "value": 2}</SystemQuery>

■ 配置高清修复流程：
1. 开启高清修复：
   <SystemQuery>{"type": "write", "path": "sd_chires_fix", "value": "true"}</SystemQuery>
2. 设置放大倍数（通常 1.5-2.0）：
   <SystemQuery>{"type": "write", "path": "sd_cupscale_factor", "value": 2.0}</SystemQuery>
3. 设置去噪强度（0.4-0.7，越高变化越大）：
   <SystemQuery>{"type": "write", "path": "sd_cdenoising_strength", "value": 0.5}</SystemQuery>
4. 设置高清修复步数（通常为主步数的一半）：
   <SystemQuery>{"type": "write", "path": "sd_chires_steps", "value": 15}</SystemQuery>

■ 配置提示词预设流程：
1. 查看当前提示词预设：
   <SystemQuery>{"type": "read", "path": "yusheid_sd"}</SystemQuery>
2. 如果需要修改固定提示词，先读取当前内容：
   <SystemQuery>{"type": "read", "path": "yushe[yusheid_sd].fixedPrompt"}</SystemQuery>
3. 修改固定正面提示词（添加画质、风格等标签）：
   <SystemQuery>{"type": "write", "path": "yushe[yusheid_sd].fixedPrompt", "value": "masterpiece, best quality, highres"}</SystemQuery>
4. 修改固定负面提示词（排除不想要的元素）：
   <SystemQuery>{"type": "write", "path": "yushe[yusheid_sd].negativePrompt", "value": "lowres, bad anatomy, bad hands, text, error"}</SystemQuery>

■ 优化图片质量流程：
1. 开启面部修复（如果图片包含人物）：
   <SystemQuery>{"type": "write", "path": "restoreFaces", "value": "true"}</SystemQuery>
2. 如果安装了 ADetailer，开启脸部精修：
   <SystemQuery>{"type": "write", "path": "sd_cadetailer", "value": "true"}</SystemQuery>
3. 启用正面质量预设：
   <SystemQuery>{"type": "write", "path": "AQT_sd", "value": "best quality, amazing quality, very aesthetic, absurdres"}</SystemQuery>
4. 选择合适的负面质量预设（根据模型类型选择）

■ 切换模型流程：
1. 确保已连接 SD 并刷新了数据
2. 读取可用模型列表（通过 browse 查看 sd_cchatu_8_model 的选项）
3. 设置新模型：
   <SystemQuery>{"type": "write", "path": "sd_cchatu_8_model", "value": "新模型名称.safetensors"}</SystemQuery>
4. 根据模型类型调整参数（如动漫模型设置 Clip Skip 为 2）

■ 测试生图流程：
1. 确认所有必要配置已完成：
   <SystemQuery>{"type": "check_config"}</SystemQuery>
2. 提示用户可以在聊天中使用触发标记测试生图
3. 如果生图失败，检查 SD WebUI 是否正常运行，API 地址是否正确 （如果失败那么可以调用诊断与日志模块读取错误信息）
`.trim(),

   errorGuide: `
【SD 常见问题】

■ 连接问题
- 无法连接 SD API：检查 sdUrl 是否正确，SD WebUI 是否已启动，是否开启了 --api 参数 （如果失败那么可以调用诊断与日志模块读取错误信息）
- 身份验证失败：确认 st_chatu8_sd_auth 格式为"用户名:密码"，与 SD WebUI 的认证设置一致
- 跨域错误：SD WebUI 需要添加 --cors-allow-origins 参数允许跨域访问
- 连接超时：检查防火墙设置，确保端口未被占用

■ 模型问题
- 模型列表为空：点击"连接刷新数据"按钮重新获取，确认 SD WebUI 的 models 目录中有模型文件
- 模型切换失败：确认模型文件名正确（包括 .safetensors 或 .ckpt 后缀）
- 模型加载慢：大模型（如 SDXL）加载需要时间，耐心等待
- 显存不足：降低图片尺寸或关闭高清修复，或使用 --medvram 参数启动 SD WebUI

■ 生成参数问题
- 图片质量差：增加采样步数（30-50），调整 CFG Scale（7-12），检查提示词质量
- 图片过度饱和/扭曲：降低 CFG Scale（5-8），检查负面提示词是否过多
- 生成速度慢：降低采样步数，减小图片尺寸，关闭高清修复
- 种子不生效：确认 sd_cseed 设置为具体数值（非 -1），且其他参数完全相同

■ 高清修复问题
- 高清修复后图片变差：降低 sd_cdenoising_strength（0.3-0.5）
- 高清修复后细节丢失：增加 sd_chires_steps（20-30）
- 显存不足：降低 sd_cupscale_factor（1.5 或更低）
- 放大器列表为空：确认 SD WebUI 已安装放大器扩展

■ 面部修复问题
- 面部修复效果不明显：同时开启 restoreFaces 和 sd_cadetailer
- ADetailer 不可用：确认 SD WebUI 已安装 ADetailer 扩展
- 面部过度修复：调整 ADetailer 的检测阈值和修复强度（需在 SD WebUI 中配置）

■ 提示词问题
- 提示词不生效：检查提示词格式，确认没有语法错误
- 中文提示词无效：SD 需要英文提示词
- LORA 不生效：确认 LORA 格式正确 <lora:名称:权重>，LORA 文件在正确目录
- 提示词过长：SD 有 75 token 限制（SDXL 为 77），过长会被截断

■ 客户端模式问题
- 出现跨域无法连接：修改客户端为jiuguan。如果需要浏览器直连。那么需要sd启动器添加跨域参数。
- 酒馆模式图片丢失：确认酒馆后端正常运行，jiuguanchucun 已开启
- 浏览器模式缓存满：定期清理图片缓存

■ 性能优化建议
- 首次生图慢：模型加载需要时间，后续会快很多
- 批量生图：调大 imageGenInterval 避免请求过于频繁
- 降低显存占用：使用较小的图片尺寸（512x512 或 768x768）
- 加快生成速度：使用快速采样器（如 DPM++ 2M）+ 较少步数（20-25）
`.trim()
};

