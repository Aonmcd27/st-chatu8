/**
 * ComfyUI 设置助手模块
 * 
 * TODO: 从 utils/aiPromptModules.js 的 comfyui_settings 对象提取内容
 * 位置: 约第 1400-1800 行
 * 
 * 提取步骤:
 * 1. 打开 utils/aiPromptModules.js
 * 2. 找到 comfyui_settings: { ... } 对象
 * 3. 复制 name, summary, commands, knowledge, workflow, errorGuide 的完整内容
 * 4. 粘贴到下面的 comfyuiSettingsModule 对象中
 * 5. 确保所有反引号和字符串正确闭合
 */

export const comfyuiSettingsModule = {

   name: 'ComfyUI 设置助手',
   summary: '帮助用户配置 ComfyUI 的各项参数，包括 API 连接、工作流管理、模型选择、采样参数、提示词预设、参考图等。当用户提到 ComfyUI 设置、工作流、模型切换、采样器、参考图等需求时加载此模块。',

   commands: `
【ComfyUI 模块可用命令】

■ 基础配置命令

切换到 ComfyUI 设置页面：
<SystemQuery>{"type": "ui_action", "action": "switch_tab_comfyui"}</SystemQuery>

设置 ComfyUI API 地址：
<SystemQuery>{"type": "write", "path": "comfyuiUrl", "value": "http://127.0.0.1:8188"}</SystemQuery>

连接并刷新 ComfyUI 数据（获取模型、采样器等列表）：
<SystemQuery>{"type": "ui_action", "action": "click_button", "selector": "#testComfyui"}</SystemQuery>

■ 工作流管理命令

查看当前使用的工作流预设名称：
<SystemQuery>{"type": "read", "path": "workerid"}</SystemQuery>

切换工作流预设：
<SystemQuery>{"type": "write", "path": "workerid", "value": "工作流名称"}</SystemQuery>

查看当前工作流内容：
<SystemQuery>{"type": "read", "path": "worker"}</SystemQuery>

修改工作流内容（完整 JSON）：
<SystemQuery>{"type": "write", "path": "worker", "value": "完整的工作流JSON字符串"}</SystemQuery>

查看修图工作流预设名称：
<SystemQuery>{"type": "read", "path": "editWorkerid"}</SystemQuery>

切换修图工作流预设：
<SystemQuery>{"type": "write", "path": "editWorkerid", "value": "修图工作流名称"}</SystemQuery>

查看修图工作流内容：
<SystemQuery>{"type": "read", "path": "editWorker"}</SystemQuery>

修改修图工作流内容：
<SystemQuery>{"type": "write", "path": "editWorker", "value": "完整的修图工作流JSON字符串"}</SystemQuery>

打开工作流简易修改器（UI 操作）：
<SystemQuery>{"type": "ui_action", "action": "click_button", "selector": "#eidtwork"}</SystemQuery>

打开工作流可视化编辑器（UI 操作）：
<SystemQuery>{"type": "ui_action", "action": "click_button", "selector": "#visualize_workflow"}</SystemQuery>

■ 模型与采样器配置

设置模型文件：
<SystemQuery>{"type": "write", "path": "MODEL_NAME", "value": "模型名称.safetensors"}</SystemQuery>

设置采样方法：
<SystemQuery>{"type": "write", "path": "comfyuisamplerName", "value": "euler"}</SystemQuery>

设置 VAE：
<SystemQuery>{"type": "write", "path": "comfyui_vae", "value": "vae名称.safetensors"}</SystemQuery>

设置调度器（Scheduler）：
<SystemQuery>{"type": "write", "path": "comfyui_scheduler", "value": "normal"}</SystemQuery>

设置 CLIP：
<SystemQuery>{"type": "write", "path": "comfyuiCLIPName", "value": "clip名称"}</SystemQuery>

■ 生成参数配置

设置图片宽度：
<SystemQuery>{"type": "write", "path": "comfyui_width", "value": 1024}</SystemQuery>

设置图片高度：
<SystemQuery>{"type": "write", "path": "comfyui_height", "value": 1024}</SystemQuery>

设置生成步数：
<SystemQuery>{"type": "write", "path": "comfyui_steps", "value": 20}</SystemQuery>

设置种子（0/-1 为随机）：
<SystemQuery>{"type": "write", "path": "comfyui_seed", "value": 0}</SystemQuery>

设置 CFG Scale：
<SystemQuery>{"type": "write", "path": "cfg_comfyui", "value": 7.0}</SystemQuery>

■ 提示词预设配置

查看当前提示词预设：
<SystemQuery>{"type": "read", "path": "yusheid_comfyui"}</SystemQuery>

切换提示词预设：
<SystemQuery>{"type": "write", "path": "yusheid_comfyui", "value": "预设名称"}</SystemQuery>

查看当前预设的固定正面提示词：
<SystemQuery>{"type": "read", "path": "yushe[yusheid_comfyui].fixedPrompt"}</SystemQuery>

修改固定正面提示词：
<SystemQuery>{"type": "write", "path": "yushe[yusheid_comfyui].fixedPrompt", "value": "masterpiece, best quality"}</SystemQuery>

修改后置固定正面提示词：
<SystemQuery>{"type": "write", "path": "yushe[yusheid_comfyui].fixedPrompt_end", "value": "highly detailed"}</SystemQuery>

修改固定负面提示词：
<SystemQuery>{"type": "write", "path": "yushe[yusheid_comfyui].negativePrompt", "value": "lowres, bad anatomy"}</SystemQuery>

设置正面质量预设（AQT）：
<SystemQuery>{"type": "write", "path": "AQT_comfyui", "value": "best quality, amazing quality, very aesthetic, absurdres"}</SystemQuery>

设置负面质量预设（UCP）：
<SystemQuery>{"type": "write", "path": "UCP_comfyui", "value": "作者预设"}</SystemQuery>

查看提示词替换规则预设：
<SystemQuery>{"type": "read", "path": "prompt_replace_id_comfyui"}</SystemQuery>

切换提示词替换规则：
<SystemQuery>{"type": "write", "path": "prompt_replace_id_comfyui", "value": "替换规则名称"}</SystemQuery>

查看替换规则内容：
<SystemQuery>{"type": "read", "path": "prompt_replace_text_comfyui"}</SystemQuery>

修改替换规则内容：
<SystemQuery>{"type": "write", "path": "prompt_replace_text_comfyui", "value": "替换规则文本"}</SystemQuery>

■ 参考图配置

打开参考图选择（UI 操作）：
<SystemQuery>{"type": "ui_action", "action": "click_button", "selector": "#comfyui-select-image-btn"}</SystemQuery>

移除参考图（UI 操作）：
<SystemQuery>{"type": "ui_action", "action": "click_button", "selector": "#comfyui-remove-image-btn"}</SystemQuery>

设置 IPA 类型：
<SystemQuery>{"type": "write", "path": "ipa", "value": "STANDARD (medium strength)"}</SystemQuery>

设置氛围强度：
<SystemQuery>{"type": "write", "path": "c_fenwei", "value": 1.0}</SystemQuery>

设置细节强度：
<SystemQuery>{"type": "write", "path": "c_xijie", "value": 1.0}</SystemQuery>

设置权重：
<SystemQuery>{"type": "write", "path": "c_quanzhong", "value": 1.0}</SystemQuery>

设置 FaceID 权重：
<SystemQuery>{"type": "write", "path": "c_idquanzhong", "value": 1.0}</SystemQuery>

■ 配置档案管理

查看当前配置档案：
<SystemQuery>{"type": "read", "path": "comfyui_profile_id"}</SystemQuery>

切换配置档案：
<SystemQuery>{"type": "write", "path": "comfyui_profile_id", "value": "配置名称"}</SystemQuery>

读取配置档案（UI 操作）：
<SystemQuery>{"type": "ui_action", "action": "click_button", "selector": "#comfyui_profile_load"}</SystemQuery>

新建配置档案（UI 操作）：
<SystemQuery>{"type": "ui_action", "action": "click_button", "selector": "#comfyui_profile_new"}</SystemQuery>

删除配置档案（UI 操作）：
<SystemQuery>{"type": "ui_action", "action": "click_button", "selector": "#comfyui_profile_delete"}</SystemQuery>`.trim(),

   knowledge: `
【ComfyUI 页面功能说明】

■ API 连接区域
- comfyuiUrl：ComfyUI 的 API 地址，通常为 http://127.0.0.1:8188
- 连接刷新数据按钮：点击后会连接 ComfyUI API 并获取可用的模型、采样器、VAE、调度器、CLIP 等列表

■ 工作流区域
- workerid：当前使用的工作流预设名称
- worker：工作流的完整 JSON 内容，包含所有节点和连接
- 工作流预设支持保存、另存为、导出、导入等操作
- 简易修改按钮：不推荐使用！
- 可视化按钮：以图形化方式查看工作流结构
- editWorkerid：修图工作流预设名称（用于局部重绘）
- editWorker：修图工作流的 JSON 内容

■ 工作流占位符系统
ComfyUI 工作流使用 "%变量名%" 作为占位符，在生图时自动替换为实际参数值。
详细的占位符说明请参考 comfyui_workflow 模块（使用 load_module 加载）。

■ 模型与采样器区域
- MODEL_NAME：当前使用的 Stable Diffusion 模型文件名（.safetensors 或 .ckpt）
- comfyuisamplerName：采样方法，如 euler、dpmpp_2m、ddim 等
- comfyui_vae：VAE 模型，用于图像编码解码
- comfyui_scheduler：调度器，控制去噪过程，如 normal、karras、exponential 等
- comfyuiCLIPName：CLIP 模型，用于文本编码

■ 生成参数区域
- comfyui_size：预设尺寸下拉框，选择后会自动设置宽度和高度
  - 512x512：小图标（1:1）
  - 640x640：中图标（1:1）
  - 512x768：垂直图（2:3）
  - 768x512：水平图（3:2）
  - 1024x1024：SDXL 标准尺寸（1:1）
  - 1216x832：超高清水平（19:13）
  - 832x1216：超高清垂直（13:19）
- comfyui_width：图片宽度（像素）
- comfyui_height：图片高度（像素）
- comfyui_steps：采样步数，越高质量越好但速度越慢（通常 20-40）
- comfyui_seed：随机种子，0 或 -1 表示随机，固定值可复现相同图片
- cfg_comfyui：CFG Scale，控制提示词的引导强度（通常 7-12）

■ 提示词预设区域
- yusheid_comfyui：当前选中的提示词预设名称
- fixedPrompt_comfyui：固定正面提示词（前置），会添加在生成提示词的最前面
- fixedPrompt_end_comfyui：后置固定正面提示词，会添加在生成提示词的最后面
- negativePrompt_comfyui：固定负面提示词，用于排除不想要的元素
- 提示词预设支持保存、另存为、导出、导入等操作
- 翻译按钮：可以将中文提示词翻译为英文

■ LORA 区域
- ComfyuiLORA：LORA 模型下拉列表
- 添加 LORA 按钮：将选中的 LORA 添加到提示词中
- LORA 格式：<lora:名称:权重>，如 <lora:detail_tweaker:0.8>

■ 提示词替换区域
- prompt_replace_id_comfyui：提示词替换规则预设
- prompt_replace_text_comfyui：替换规则文本，支持定义替换规则，在生图前自动替换提示词中的特定文本
- 替换规则格式：每行一条规则，格式为 "原文本 -> 新文本"

■ 质量预设区域
- AQT_comfyui：正面质量预设，启用后会自动添加高质量相关的标签
  - 启用：best quality, amazing quality, very aesthetic, absurdres
  - 禁用：不添加质量标签
- UCP_comfyui：负面质量预设，提供多个预设选项用于排除低质量元素
  - 无：不添加负面质量标签
  - 作者预设：包含常见的负面标签（bad anatomy、lowres 等）
  - 作者预设 2：更强的负面过滤（包含更多负面标签）

■ 参考图区域（需要特定的工作流支持。全参数那么不建议使用，参考图片可以在工作流中使用。）
- 图片预览：显示当前选择的参考图
- 选择图片按钮：上传参考图片
- 移除图片按钮：移除当前参考图
- ipa：IPA（IP-Adapter）类型，控制参考图的应用方式
  - STANDARD (medium strength)：标准强度
  - LIGHT - SD1.5 only (low strength)：低强度（仅 SD1.5）
  - VIT-G (medium strength)：VIT-G 模型
  - PLUS (high strength)：高强度
  - PLUS FACE (portraits)：人像专用
  - FULL FACE - SD1.5 only (portraits stronger)：强人像（仅 SD1.5）
- c_fenwei：氛围强度，控制参考图的氛围影响程度（0-1）
- c_xijie：细节强度，控制参考图的细节影响程度（0-1）
- c_quanzhong：权重，控制参考图的整体影响权重（0-1）
- c_idquanzhong：FaceID 权重，控制面部特征的影响权重（0-1）

■ 配置档案区域
- comfyui_profile_id：当前配置档案名称
- 读取按钮：加载选中的配置档案
- 新建按钮：创建新的配置档案
- 删除按钮：删除当前配置档案
- 配置档案可保存多套参数配置，方便快速切换不同的生图设置

■ 重要概念说明
- 采样步数（steps）：生成图片的迭代次数，越多细节越好但越慢
- CFG Scale：提示词引导强度，过低图片随机性强，过高可能过度饱和
- 种子（seed）：控制随机性，相同种子+相同参数=相同图片
- 工作流（workflow）：ComfyUI 的节点式工作流，定义了完整的图像生成流程
- 占位符（placeholder）：工作流中的 %变量名%，在生图时自动替换为实际值
- 参考图（reference image）：通过 IP-Adapter 影响生成图像的风格和内容`.trim(),

   workflow: `
【ComfyUI 设置引导流程】（当用户需要配置 ComfyUI 设置时按此顺序引导）

■ 首次配置流程：
1. 切换到 ComfyUI 设置页面：
   <SystemQuery>{"type": "ui_action", "action": "switch_tab_comfyui"}</SystemQuery>
2. 确认主要设置中 mode 已设为 "comfyui"：
   <SystemQuery>{"type": "read", "path": "mode"}</SystemQuery>
   如果不是，则设置：
   <SystemQuery>{"type": "write", "path": "mode", "value": "comfyui"}</SystemQuery>
3. 设置 ComfyUI API 地址（如果用户未提供，使用默认值）：
   <SystemQuery>{"type": "write", "path": "comfyuiUrl", "value": "http://127.0.0.1:8188"}</SystemQuery>
4. 点击连接刷新数据按钮，获取可用的模型和参数列表：
   <SystemQuery>{"type": "ui_action", "action": "click_button", "selector": "#testComfyui"}</SystemQuery>
5. 等待刷新完成后，选择模型和工作流（需要用户确认或从列表中选择）
6. 配置基础生成参数（宽度、高度、步数等）

（更多引导流程将在后续步骤添加）

■ 调整生成参数流程：
1. 根据用户需求设置图片尺寸：
   - 方形图标：1024x1024
   - 横向图片：1216x832
   - 纵向图片：832x1216
2. 设置采样步数（推荐 20-30）：
   <SystemQuery>{"type": "write", "path": "comfyui_steps", "value": 20}</SystemQuery>
3. 设置 CFG Scale（推荐 7-10）：
   <SystemQuery>{"type": "write", "path": "cfg_comfyui", "value": 7.0}</SystemQuery>
4. 如需固定种子复现图片，设置具体数值：
   <SystemQuery>{"type": "write", "path": "comfyui_seed", "value": 12345}</SystemQuery>

■ 配置提示词预设流程：
1. 查看当前提示词预设：
   <SystemQuery>{"type": "read", "path": "yusheid_comfyui"}</SystemQuery>
2. 如果需要修改固定提示词，先读取当前内容：
   <SystemQuery>{"type": "read", "path": "yushe[yusheid_comfyui].fixedPrompt"}</SystemQuery>
3. 修改固定正面提示词（添加画质、风格等标签）：
   <SystemQuery>{"type": "write", "path": "yushe[yusheid_comfyui].fixedPrompt", "value": "masterpiece, best quality, highres"}</SystemQuery>
4. 修改固定负面提示词（排除不想要的元素）：
   <SystemQuery>{"type": "write", "path": "yushe[yusheid_comfyui].negativePrompt", "value": "lowres, bad anatomy, bad hands"}</SystemQuery>
5. 启用正面质量预设（AQT）：
   <SystemQuery>{"type": "write", "path": "AQT_comfyui", "value": "best quality, amazing quality, very aesthetic, absurdres"}</SystemQuery>
6. 选择合适的负面质量预设（UCP）：
   <SystemQuery>{"type": "write", "path": "UCP_comfyui", "value": "作者预设"}</SystemQuery>

■ 切换工作流流程：
1. 查看当前工作流：
   <SystemQuery>{"type": "read", "path": "workerid"}</SystemQuery>
2. 切换到新的工作流预设：
   <SystemQuery>{"type": "write", "path": "workerid", "value": "新工作流名称"}</SystemQuery>
3. 如需修改工作流参数，建议使用 comfyui_workflow 模块的节点操作命令
4. 如需查看工作流变量，使用 workflow_variables 命令

■ 配置参考图流程：
1. 提示用户上传参考图（需要通过 UI 操作）：
   <SystemQuery>{"type": "ui_action", "action": "click_button", "selector": "#comfyui-select-image-btn"}</SystemQuery>
2. 选择合适的 IPA 类型（根据需求选择）：
   <SystemQuery>{"type": "write", "path": "ipa", "value": "STANDARD (medium strength)"}</SystemQuery>
3. 调整参考图影响强度（推荐值 0.6-1.0）：
   <SystemQuery>{"type": "write", "path": "c_fenwei", "value": 0.8}</SystemQuery>
   <SystemQuery>{"type": "write", "path": "c_xijie", "value": 0.8}</SystemQuery>
   <SystemQuery>{"type": "write", "path": "c_quanzhong", "value": 1.0}</SystemQuery>
4. 如果是人像，可以调整 FaceID 权重：
   <SystemQuery>{"type": "write", "path": "c_idquanzhong", "value": 0.8}</SystemQuery>

■ 切换模型流程：
1. 确保已连接 ComfyUI 并刷新了数据
2. 读取可用模型列表（通过 browse 查看 MODEL_NAME 的选项）
3. 设置新模型：
   <SystemQuery>{"type": "write", "path": "MODEL_NAME", "value": "新模型.safetensors"}</SystemQuery>
4. 根据模型类型调整参数（如 SDXL 模型推荐 1024x1024 尺寸）
5. 确认工作流与模型兼容（某些工作流专为特定模型设计）

■ 配置档案管理流程：
1. 查看当前配置档案：
   <SystemQuery>{"type": "read", "path": "comfyui_profile_id"}</SystemQuery>
2. 新建配置档案（保存当前设置）：
   <SystemQuery>{"type": "ui_action", "action": "click_button", "selector": "#comfyui_profile_new"}</SystemQuery>
3. 切换配置档案：
   <SystemQuery>{"type": "write", "path": "comfyui_profile_id", "value": "配置名称"}</SystemQuery>
   <SystemQuery>{"type": "ui_action", "action": "click_button", "selector": "#comfyui_profile_load"}</SystemQuery>

■ 测试生图流程：
1. 确认所有必要配置已完成：
   <SystemQuery>{"type": "check_config"}</SystemQuery>
2. 提示用户可以在聊天中使用触发标记测试生图
3. 如果生图失败，检查 ComfyUI 是否正常运行，API 地址是否正确`.trim(),

   errorGuide: `
【ComfyUI 常见问题】

■ 连接问题
- 无法连接 ComfyUI API：检查 comfyuiUrl 是否正确，ComfyUI 是否已启动
- 连接超时：检查防火墙设置，确保端口未被占用
- 跨域错误：ComfyUI 需要配置允许跨域访问，在启动器里添加  --enable-cors-header 启动参数

■ 提示词问题
- 提示词不生效：检查提示词格式，确认没有语法错误
- LORA 不生效：确认 LORA 格式正确 <lora:名称:权重>，LORA 文件在正确目录（调用comfyui的缓存查看是否有lora存在）
- 提示词过长：某些 CLIP 模型有 token 限制，过长会被截断
- 固定提示词未生效：确认 yusheid_comfyui 指向正确的预设，检查 fixedPrompt 内容
- 提示词替换规则不生效：检查 prompt_replace_text_comfyui 格式是否正确

■ 配置档案问题
- 配置档案切换失败：确认配置档案名称正确，点击"读取"按钮加载配置
- 配置档案丢失：配置档案保存在浏览器本地，清除浏览器数据会导致丢失
- 新建配置档案无效：新建后需要手动保存当前设置到新配置中

■ 客户端模式问题
- 图片不显示：检查主要设置中的 client 设置（browser 或 jiuguan）
- 酒馆模式图片丢失：确认酒馆后端正常运行，jiuguanchucun 已开启
- 浏览器模式缓存满：定期清理图片缓存
- 直连模式连接失败：确认 ComfyUI 允许外部访问，检查防火墙设置

■ 性能优化建议
- 首次生图慢：模型加载需要时间，后续会快很多
- 批量生图：调大 imageGenInterval 避免请求过于频繁
- 降低显存占用：使用较小的图片尺寸（512x512 或 768x768）
- 加快生成速度：使用快速采样器（euler）+ 较少步数（15-20）
- 工作流优化：移除不必要的节点，使用 _skip 标记跳过某些节点

■ 局部重绘问题
- 局部重绘不生效：确认 editWorker 已配置，且提示词包含 {局部重绘} 标记
- 蒙版不准确：检查工作流中的蒙版处理节点配置
- 重绘幅度不合适：调整 inpaint_denoise 参数（0.3-0.9）

■ 其他常见问题
- 生图失败但不报错：检查浏览器控制台日志，可能是网络问题或参数错误
- 图片与提示词不符：检查提示词是否被替换规则修改，查看实际发送的提示词
- 随机性太强：增加 CFG Scale，使用固定种子
- 图片重复性太高：使用随机种子（seed 设为 0/-1），降低 CFG Scale
- 工作流可视化无法打开：确认浏览器支持，检查工作流 JSON 格式是否正确

■ 工作流问题
- 工作流加载失败：检查 worker 内容是否为有效的 JSON 格式
- 占位符未被替换：确认占位符格式为 "%变量名%"（含引号），如 "%prompt%"
- 工作流执行失败：检查工作流中的节点连接是否正确，模型文件是否存在
- 跳过节点处理失败：某些节点被标记为 _skip 时，系统会自动重映射连接，如果失败可能是节点类型不兼容
- 工作流与模型不兼容：某些工作流专为特定模型设计（如 SDXL），切换模型后可能需要调整工作流

■ 生成参数问题
- 图片质量差：增加采样步数（30-40），调整 CFG Scale（7-10），检查提示词质量
- 图片过度饱和/扭曲：降低 CFG Scale（5-7），检查负面提示词是否过多
- 生成速度慢：降低采样步数（15-20），减小图片尺寸，使用快速采样器（euler）
- 种子不生效：确认 comfyui_seed 设置为具体数值（非 0/-1），且其他参数完全相同
- 图片尺寸异常：检查工作流中是否正确使用了 %width% 和 %height% 占位符

■ 模型问题
- 模型列表为空：点击"连接刷新数据"按钮重新获取，确认 ComfyUI 的 models 目录中有模型文件
- 模型切换失败：确认模型文件名正确（包括 .safetensors 或 .ckpt 后缀）
- 模型加载慢：大模型（如 SDXL）加载需要时间，耐心等待
- 显存不足：降低图片尺寸，或在 ComfyUI 启动时添加 --lowvram 参数
- VAE 不生效：确认 comfyui_vae 已设置，且工作流中有使用 %vae% 占位符的节点

■ 参考图问题
- 参考图不生效：确认工作流中包含 IP-Adapter 相关节点，且使用了 %comfyuicankaotupian% 占位符
- 参考图影响太强/太弱：调整 c_fenwei、c_xijie、c_quanzhong 参数（0.4-1.0）
- IPA 类型选择错误：根据模型版本选择（SD1.5 或 SDXL），人像推荐使用 PLUS FACE
- 参考图格式不支持：确保图片为常见格式（PNG、JPG），图片不能太大
- FaceID 不生效：确认工作流中包含 FaceID 节点，且使用了 %c_idquanzhong% 占位符`.trim()
};

