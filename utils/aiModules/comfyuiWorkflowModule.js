/**
 * ComfyUI 工作流助手模块
 */

export const comfyuiWorkflowModule = {
   name: 'ComfyUI 工作流助手',
   summary: '帮助用户查看、理解和修改 ComfyUI 工作流中的变量参数（%xxx% 占位符）和节点配置，包括列出工作流、扫描变量、替换参数值、精确修改节点等。当用户提到工作流、ComfyUI变量、占位符替换、工作流参数、节点编辑等需求时加载此模块。',

   commands: `
【工作流模块可用命令】

■ 工作流管理命令

列出所有已保存的工作流预设名称：
<SystemQuery>{"type": "workflow_list"}</SystemQuery>

读取指定工作流的完整 JSON 内容（⚠️ 仅在需要查看完整结构时使用，通常应使用节点级别操作）：
<SystemQuery>{"type": "workflow_read", "name": "工作流名称"}</SystemQuery>

扫描指定工作流中的所有 %xxx% 占位符变量，返回变量列表及其当前替换值来源：
<SystemQuery>{"type": "workflow_variables", "name": "工作流名称"}</SystemQuery>

在指定工作流中替换某个占位符的值（全局替换所有出现的位置）：
<SystemQuery>{"type": "workflow_replace_var", "name": "工作流名称", "variable": "%prompt%", "value": "新的值"}</SystemQuery>

切换当前使用的工作流预设：
<SystemQuery>{"type": "write", "path": "workerid", "value": "工作流名称"}</SystemQuery>

■ 节点级别操作命令（推荐使用，更精确高效）

⚠️ 重要警告：修改节点参数时，只修改指定的 inputKey，不要修改其他字段！
节点的 inputs 对象可能包含多个字段，只修改需要改的那个字段。

列出工作流中的所有节点（显示节点ID、类型和标题）：
<SystemQuery>{"type": "workflow_list_nodes", "name": "工作流名称"}</SystemQuery>

读取指定节点的完整信息（包括所有输入参数和配置）：
<SystemQuery>{"type": "workflow_read_node", "name": "工作流名称", "nodeId": "3"}</SystemQuery>

修改指定节点的单个输入参数（⚠️ 只修改指定的 inputKey，保留其他字段）：
<SystemQuery>{"type": "workflow_update_node", "name": "工作流名称", "nodeId": "3", "inputKey": "seed", "value": 42}</SystemQuery>

批量修改多个节点的参数（一次性修改多个节点，更高效）：
<SystemQuery>{"type": "workflow_batch_update", "name": "工作流名称", "updates": [
  {"nodeId": "3", "inputKey": "seed", "value": 42},
  {"nodeId": "3", "inputKey": "steps", "value": 30},
  {"nodeId": "6", "inputKey": "text", "value": "新的提示词"}
]}</SystemQuery>

删除指定节点：
<SystemQuery>{"type": "workflow_delete_node", "name": "工作流名称", "nodeId": "15"}</SystemQuery>

添加新节点到工作流：
<SystemQuery>{"type": "workflow_add_node", "name": "工作流名称", "nodeId": "99", "nodeData": {
  "class_type": "KSampler",
  "inputs": {
    "seed": 0,
    "steps": 20,
    "cfg": 7.0
  },
  "_meta": {
    "title": "新采样器"
  }
}}</SystemQuery>

保存修改后的工作流内容（⚠️ 通常不需要手动调用，节点操作会自动保存）：
<SystemQuery>{"type": "workflow_save", "name": "工作流名称", "content": "完整的工作流JSON字符串"}</SystemQuery>
`.trim(),

   knowledge: `
【工作流变量占位符说明】

ComfyUI 工作流 JSON 中使用 "%变量名%" 作为占位符，在生图时自动替换为实际参数值。

■ 数值类型变量（替换时会去掉引号，变为纯数字）：
- %seed% → 随机种子（来自 comfyui_seed，0/-1 时自动随机生成）
- %steps% → 采样步数（来自 comfyui_steps）
- %cfg_scale% → CFG 引导比例（来自 cfg_comfyui）
- %width% → 图片宽度（来自 comfyui_width 或请求参数）
- %height% → 图片高度（来自 comfyui_height 或请求参数）
- %c_quanzhong% → 权重（来自 c_quanzhong）
- %c_idquanzhong% → ID权重（来自 c_idquanzhong）
- %c_xijie% → 细节（来自 c_xijie）
- %c_fenwei% → 氛围（来自 c_fenwei）
- %inpaint_denoise% → 局部重绘幅度（来自 inpaint_denoise，默认 0.75）

■ 字符串类型变量（替换时保留引号）：
- %prompt% → 正面提示词（经过预设、替换规则、角色提示词等处理后的最终提示词）
- %negative_prompt% → 负面提示词
- %sampler_name% → 采样器名称（来自 comfyuisamplerName）
- %MODEL_NAME% → 模型名称（来自 MODEL_NAME）
- %comfyuicankaotupian% → 参考图片路径
- %ipa% → IP-Adapter 参考图
- %scheduler% → 调度器名称（来自 comfyui_scheduler）
- %vae% → VAE 模型名称（来自 comfyui_vae）
- %clip% → CLIP 模型名称（来自 comfyuiCLIPName）

■ 局部重绘专用变量（仅在局部重绘模式下有值）：
- %inpaint_image% → 重绘原图 base64
- %inpaint_mask% → 重绘蒙版 base64
- %inpaint_positive% → 重绘正面提示词
- %inpaint_negative% → 重绘负面提示词

■ 工作流数据结构说明：
- settings.workers 是一个对象，key 为工作流预设名称（如"新版默认"），value 为工作流 JSON 字符串。
- settings.workerid 是当前选中的工作流预设名称。
- settings.worker 是当前工作流的实际内容（JSON 字符串）。
- settings.editWorker 是局部重绘时使用的工作流。

■ 工作流节点结构说明：
- 工作流是一个 JSON 对象，每个键是节点ID（如 "3", "6", "15"），值是节点对象。
- 节点对象包含：
  - class_type: 节点类型（如 "KSampler", "CLIPTextEncode", "CheckpointLoaderSimple"）
  - inputs: 输入参数对象，包含该节点的所有配置参数
  - _meta: 元数据，包含 title（节点标题）等信息
- 节点之间通过输入参数中的数组引用连接，如 ["3", 0] 表示连接到节点3的第0个输出。

■ 节点操作最佳实践：
1. 先用 workflow_list_nodes 查看所有节点，了解节点ID和类型
2. 用 workflow_read_node 读取需要修改的节点详情
3. 使用 workflow_update_node 或 workflow_batch_update 精确修改参数
4. 避免使用 workflow_read 读取完整工作流（内容太长且不必要）
5. 批量修改时优先使用 workflow_batch_update，一次性完成多个修改
`.trim(),

   workflow: `
【工作流操作引导流程】（当用户需要查看或修改工作流参数时按此顺序执行）

■ 基础查看流程：
1. 切换到 ComfyUI 设置页面：
   <SystemQuery>{"type": "ui_action", "action": "switch_tab_comfyui"}</SystemQuery>
2. 列出所有工作流预设，了解有哪些可用：
   <SystemQuery>{"type": "workflow_list"}</SystemQuery>
3. 确认当前使用的工作流：
   <SystemQuery>{"type": "read", "path": "workerid"}</SystemQuery>

■ 变量占位符操作流程：
1. 扫描工作流中的变量占位符：
   <SystemQuery>{"type": "workflow_variables", "name": "目标工作流名"}</SystemQuery>
2. 根据用户需求，使用 workflow_replace_var 全局替换变量值

■ 节点级别操作流程（推荐）：
1. 列出工作流中的所有节点：
   <SystemQuery>{"type": "workflow_list_nodes", "name": "目标工作流名"}</SystemQuery>
2. 读取需要修改的节点详情：
   <SystemQuery>{"type": "workflow_read_node", "name": "目标工作流名", "nodeId": "3"}</SystemQuery>
3. 根据用户需求修改节点参数：
   - 单个修改：使用 workflow_update_node
   - 批量修改：使用 workflow_batch_update（更高效）
4. 修改会自动保存，无需手动调用保存命令

■ 常见修改场景示例：

场景1：修改采样器参数（如种子、步数、CFG）
1. 找到 KSampler 节点（通常是节点3）
2. 批量修改：
   <SystemQuery>{"type": "workflow_batch_update", "name": "新版默认", "updates": [
     {"nodeId": "3", "inputKey": "seed", "value": 12345},
     {"nodeId": "3", "inputKey": "steps", "value": 30},
     {"nodeId": "3", "inputKey": "cfg", "value": 8.0}
   ]}</SystemQuery>

场景2：修改提示词节点
1. 找到 CLIPTextEncode 节点（正面提示词通常是节点6，负面提示词通常是节点7）
2. 修改提示词：
   <SystemQuery>{"type": "workflow_update_node", "name": "新版默认", "nodeId": "6", "inputKey": "text", "value": "新的提示词内容"}</SystemQuery>

场景3：更换模型
1. 找到 CheckpointLoaderSimple 节点（通常是节点4）
2. 修改模型名称：
   <SystemQuery>{"type": "workflow_update_node", "name": "新版默认", "nodeId": "4", "inputKey": "ckpt_name", "value": "新模型.safetensors"}</SystemQuery>
`.trim(),

   errorGuide: `
【工作流常见问题】

- 变量没有被替换：检查占位符格式是否为 "%变量名%"（含引号），如 \"%prompt%\"。注意 JSON 中变量需要被引号包裹。
- 工作流保存后不生效：确认 workerid 指向了正确的工作流名称，可用 read 检查当前值。
- 数值变量格式错误：数值类变量（如 %seed%, %steps%）在 JSON 中应写为 \"%seed%\"（带引号），替换时系统会自动去掉引号变为数字。
- 字符串变量转义问题：%prompt% 中的双引号会被自动转义为 \\"，不需要手动处理。
- 找不到变量：使用 workflow_variables 扫描实际存在的变量，避免凭记忆猜测。
- 局部重绘变量无值：%inpaint_image% 等变量仅在用户使用局部重绘功能时有值，普通生图时为空字符串。
- 节点ID不存在：使用 workflow_list_nodes 查看实际存在的节点ID，不要猜测。
- 修改节点后不生效：确认修改的是当前使用的工作流（workerid 指向的工作流）。
- 节点参数键名错误：使用 workflow_read_node 查看节点的实际参数结构，确认正确的键名。
- 批量修改部分失败：检查返回结果中的错误信息，通常是节点ID或参数键名不正确。
- 添加节点后工作流无法运行：确保新节点的 class_type 正确，且所有必需的输入参数都已提供。
- 删除节点后工作流报错：删除节点前确认没有其他节点依赖它的输出，否则需要同时修改依赖节点的连接。

建议基础修改:

  模型名称、种子、高度、宽度、正面提示词、负面提示词。


`.trim()
};
