/**
 * 角色管理设置助手模块
 */

export const charRefSettingsModule = {
  name: '角色管理设置助手',
  summary: '帮助用户管理角色参考图预设和角色组。包括角色参考图上传、预设管理、角色组编辑、参数配置等。当用户提到角色参考、角色组、character reference、参考图管理等需求时加载此模块。',

  commands: `
【角色管理模块可用命令】

■ 基础操作命令

切换到 NovelAI 设置页面：
<SystemQuery>{"type": "ui_action", "action": "switch_tab_novelai"}</SystemQuery>

打开角色参考图预设管理对话框：
<SystemQuery>{"type": "ui_action", "action": "open_char_ref_upload_dialog"}</SystemQuery>

打开角色组编辑器对话框：
<SystemQuery>{"type": "ui_action", "action": "open_char_ref_group_editor"}</SystemQuery>

■ 角色参考图预设管理命令

查询当前选中的角色参考图预设：
<SystemQuery>{"type": "read", "path": "novelai.charRefPresetId"}</SystemQuery>

查询所有角色参考图预设列表：
<SystemQuery>{"type": "read", "path": "novelai.charRefPresets"}</SystemQuery>

切换到指定的角色参考图预设：
<SystemQuery>{"type": "write", "path": "novelai.charRefPresetId", "value": "预设名称"}</SystemQuery>

创建新的角色参考图预设：
<SystemQuery>{"type": "ui_action", "action": "char_ref_preset_create", "presetName": "新预设名称"}</SystemQuery>

删除指定的角色参考图预设：
<SystemQuery>{"type": "ui_action", "action": "char_ref_preset_delete", "presetName": "预设名称"}</SystemQuery>

导出当前角色参考图预设：
<SystemQuery>{"type": "ui_action", "action": "char_ref_preset_export_current"}</SystemQuery>

导出所有角色参考图预设：
<SystemQuery>{"type": "ui_action", "action": "char_ref_preset_export_all"}</SystemQuery>

■ 角色组管理命令

查询当前选中的角色组：
<SystemQuery>{"type": "read", "path": "novelai.charRefGroupId"}</SystemQuery>

查询所有角色组列表：
<SystemQuery>{"type": "read", "path": "novelai.charRefGroups"}</SystemQuery>

切换到指定的角色组：
<SystemQuery>{"type": "write", "path": "novelai.charRefGroupId", "value": "组名称"}</SystemQuery>

创建新的角色组：
<SystemQuery>{"type": "ui_action", "action": "char_ref_group_create", "groupName": "新组名称"}</SystemQuery>

删除指定的角色组：
<SystemQuery>{"type": "ui_action", "action": "char_ref_group_delete", "groupName": "组名称"}</SystemQuery>

查询指定角色组的详细信息：
<SystemQuery>{"type": "read", "path": "novelai.charRefGroups.组名称"}</SystemQuery>

■ 参数配置命令

启用/禁用角色参考功能：
<SystemQuery>{"type": "write", "path": "novelai.reference_image_active", "value": true}</SystemQuery>

设置角色参考信息强度（0-1）：
<SystemQuery>{"type": "write", "path": "novelai.reference_information_extracted", "value": 0.8}</SystemQuery>

设置角色参考强度（0-1）：
<SystemQuery>{"type": "write", "path": "novelai.reference_strength", "value": 0.6}</SystemQuery>
`.trim(),

  knowledge: `
【角色管理功能说明】

■ 角色参考图预设系统
- 功能概述：管理单个角色参考图的预设
- 每个预设包含：
  * imageId：图片在数据库中的唯一标识
  * createdAt：创建时间戳
  * updatedAt：更新时间戳
- 预设操作：
  * 新建预设：创建新的角色参考图预设
  * 选择图片：上传 PNG、JPEG 或 WebP 格式的图片
  * 移除图片：删除当前预设的参考图
  * 删除预设：永久删除预设（默认预设不可删除）
  * 导出预设：导出单个或全部预设为 JSON 文件
  * 导入预设：从 JSON 文件导入预设
- 图片存储：
  * 使用 IndexedDB (configDatabase) 存储图片数据
  * 支持大尺寸图片存储
  * 自动管理图片生命周期
- 预设切换：
  * 通过下拉框快速切换预设
  * 切换时自动加载对应的参考图
  * 当前选中的预设会保存到配置中

■ 角色组编辑器
- 功能概述：管理包含多个角色参考的组合（最多4个）
- 每个角色组包含：
  * references：参考图数组（最多4个）
  * createdAt：创建时间戳
  * updatedAt：更新时间戳
- 每个参考图包含：
  * imageId：图片ID（关联到角色参考图预设）
  * type：参考类型（character/character_style/style）
  * strength：强度参数（0-2，默认0.6）
  * fidelity：保真度参数（0-2，默认0.6）
- 参考类型说明：
  * character：仅参考角色特征
  * character_style：同时参考角色和风格
  * style：仅参考风格特征
- 组操作：
  * 新建组：创建新的角色组
  * 保存组：保存当前组的配置
  * 删除组：删除指定组（默认组不可删除）
  * 添加参考：从图片库选择参考图添加到组
  * 移除参考：从组中移除指定的参考图
- 参数调整：
  * Strength：控制参考图对生成结果的影响强度
  * Fidelity：控制对参考图的保真程度
  * 支持滑块和数字输入框双向同步
  * 实时保存参数变化

■ 图片库选择器
- 功能：从所有角色参考图预设中选择图片
- 特性：
  * 网格布局展示所有预设的缩略图
  * 支持搜索功能（按预设名称）
  * 分页显示（可调整每页数量：8/12/16/24）
  * 点击卡片选择图片
  * 显示预设名称和缩略图
- 使用场景：
  * 在角色组编辑器中添加参考图时调用
  * 快速浏览和选择已上传的参考图

■ NovelAI 角色参考参数说明
- reference_image_active（启用角色参考）：
  * 类型：布尔值
  * 默认：false
  * 说明：是否启用角色参考功能
- reference_information_extracted（信息提取强度）：
  * 类型：数字（0-1）
  * 默认：1.0
  * 说明：从参考图中提取信息的强度
  * 值越高，提取的角色特征越多
- reference_strength（参考强度）：
  * 类型：数字（0-1）
  * 默认：0.6
  * 说明：参考图对生成结果的整体影响强度
  * 值越高，生成结果越接近参考图

■ 数据存储结构
- charRefPresets（角色参考图预设）：
  * 结构：{ "预设名": { imageId, createdAt, updatedAt } }
  * 存储位置：extension_settings[extensionName].charRefPresets
- charRefPresetId（当前预设ID）：
  * 类型：字符串
  * 存储位置：extension_settings[extensionName].charRefPresetId
- charRefGroups（角色组）：
  * 结构：{ "组名": { references: [], createdAt, updatedAt } }
  * 存储位置：extension_settings[extensionName].charRefGroups
- charRefGroupId（当前组ID）：
  * 类型：字符串
  * 存储位置：extension_settings[extensionName].charRefGroupId

■ 重要概念说明
- 预设 vs 组：
  * 预设：单个角色参考图的管理单元
  * 组：多个角色参考图的组合（最多4个）
  * 预设用于上传和管理图片，组用于配置多图参考
- 图片复用：
  * 同一个预设的图片可以被多个组引用
  * 删除预设会影响引用该图片的所有组
  * 删除组不会删除预设中的图片
- 参数优先级：
  * 组内每个参考图有独立的 type、strength、fidelity
  * NovelAI 全局参数（reference_strength 等）作为基础值
  * 实际效果由两者共同决定
`.trim(),

  workflow: `
【角色管理引导流程】

■ 首次使用流程：
1. 切换到 NovelAI 设置页面
2. 打开角色参考图预设管理对话框
3. 创建新预设或使用默认预设
4. 上传角色参考图（PNG/JPEG/WebP）
5. 打开角色组编辑器
6. 创建新组或使用默认组
7. 从图片库添加参考图到组
8. 调整参考类型和参数
9. 保存组配置

■ 上传角色参考图流程：
1. 打开角色参考图预设管理对话框
2. 选择现有预设或创建新预设
3. 点击"选择图片"按钮
4. 选择图片文件（支持 PNG、JPEG、WebP）
5. 等待图片上传和保存
6. 预览区会显示上传的图片
7. 图片自动保存到 IndexedDB

■ 创建角色组流程：
1. 打开角色组编辑器对话框
2. 点击"新建组"按钮（加号图标）
3. 输入新组名称
4. 确认创建
5. 新组会自动切换为当前组
6. 开始添加角色参考图

■ 添加参考图到组流程：
1. 在角色组编辑器中选择目标组
2. 点击"添加角色参考"按钮
3. 在图片库选择器中浏览预设
4. 可使用搜索功能快速查找
5. 点击目标图片卡片选择
6. 参考图自动添加到组中
7. 调整参考类型（character/character_style/style）
8. 调整 Strength 和 Fidelity 参数
9. 重复步骤添加更多参考（最多4个）

■ 调整参考图参数流程：
1. 在角色组编辑器中查看参考图列表
2. 每个参考图显示缩略图和控制面板
3. 调整参考类型下拉框：
   - character：仅参考角色
   - character_style：角色+风格
   - style：仅参考风格
4. 调整 Strength 滑块或输入框（0-2）
5. 调整 Fidelity 滑块或输入框（0-2）
6. 参数实时保存到配置
7. 点击"保存当前组"确保保存

■ 管理预设流程：
1. 打开角色参考图预设管理对话框
2. 通过下拉框切换预设
3. 查看当前预设的参考图
4. 操作选项：
   - 新建预设：创建新的空预设
   - 删除预设：删除当前预设（默认预设除外）
   - 导出当前：导出当前预设为 JSON
   - 导出全部：导出所有预设为 JSON
   - 导入预设：从 JSON 文件导入
5. 切换预设会自动更新预览

■ 导出导入预设流程：
1. 导出单个预设：
   - 选择目标预设
   - 点击"导出当前预设"按钮
   - 下载 JSON 文件（包含图片数据）
2. 导出全部预设：
   - 点击"导出全部预设"按钮
   - 下载包含所有预设的 JSON 文件
3. 导入预设：
   - 点击"导入预设"按钮
   - 选择 JSON 文件
   - 如果预设名重复，选择是否覆盖
   - 图片自动导入到数据库

■ 删除参考图流程：
1. 在角色组编辑器中找到目标参考图
2. 点击参考图下方的"移除"按钮
3. 参考图从组中移除
4. 原预设中的图片不受影响
5. 点击"保存当前组"确保保存

■ 删除组流程：
1. 在角色组编辑器中选择目标组
2. 点击"删除当前组"按钮（垃圾桶图标）
3. 确认删除操作
4. 组被删除，自动切换到默认组
5. 组内引用的图片预设不受影响

■ 配置 NovelAI 参数流程：
1. 切换到 NovelAI 设置页面
2. 找到角色参考相关设置
3. 启用"reference_image_active"
4. 调整"reference_information_extracted"（信息提取强度）
5. 调整"reference_strength"（参考强度）
6. 保存设置
7. 参数会影响所有角色参考的生成效果

■ 使用角色参考生成图片流程：
1. 确保已上传角色参考图
2. 创建并配置角色组
3. 在 NovelAI 设置中启用角色参考
4. 选择要使用的角色组
5. 调整全局参考参数
6. 在主界面输入提示词
7. 点击生成按钮
8. NovelAI 会根据参考图生成图片

■ 优化参考效果流程：
1. 如果生成结果不理想：
   - 调整组内各参考图的 Strength
   - 调整组内各参考图的 Fidelity
   - 尝试不同的参考类型
   - 调整全局 reference_strength
   - 调整全局 reference_information_extracted
2. 多次测试找到最佳参数组合
3. 保存配置以便后续使用
`.trim(),

  errorGuide: `
【角色管理常见问题】

■ 上传问题
- 上传失败：
  * 检查图片格式（仅支持 PNG、JPEG、WebP）
  * 确认图片大小是否过大（建议小于 10MB）
  * 查看浏览器控制台错误信息
  * 尝试刷新页面后重新上传
- 图片不显示：
  * 确认图片已成功保存到数据库
  * 检查 imageId 是否有效
  * 尝试重新上传图片
  * 清除浏览器缓存后重试
- 存储空间不足：
  * IndexedDB 存储空间已满
  * 删除不常用的参考图预设
  * 清理浏览器数据释放空间
  * 压缩图片后重新上传

■ 预设管理问题
- 预设列表为空：
  * 首次使用会自动创建默认预设
  * 检查 extension_settings 是否正常
  * 尝试刷新页面重新加载
- 切换预设无效：
  * 确认预设是否存在
  * 检查 charRefPresetId 配置
  * 刷新页面后重试
- 删除预设失败：
  * 默认预设不可删除
  * 确认预设是否被组引用
  * 查看浏览器控制台错误信息
- 导出预设失败：
  * 检查预设是否包含有效图片
  * 确认浏览器支持文件下载
  * 尝试导出单个预设而非全部
- 导入预设失败：
  * 检查 JSON 文件格式是否正确
  * 确认文件包含必要的字段
  * 图片数据可能已损坏
  * 尝试重新导出源文件

■ 角色组问题
- 组列表为空：
  * 首次使用会自动创建默认组
  * 检查 charRefGroups 配置
  * 尝试刷新页面重新加载
- 添加参考失败：
  * 确认组未达到上限（4个）
  * 检查图片库是否有可用图片
  * 确认 imageId 是否有效
  * 查看浏览器控制台错误信息
- 参考图不显示：
  * 确认 imageId 对应的图片存在
  * 检查图片是否已从数据库删除
  * 尝试重新添加参考图
- 参数调整无效：
  * 确认参数范围（0-2）
  * 检查滑块和输入框是否同步
  * 点击"保存当前组"按钮
  * 刷新页面后重新调整
- 删除组失败：
  * 默认组不可删除
  * 确认不是唯一的组
  * 查看浏览器控制台错误信息
- 保存组失败：
  * 检查组数据是否有效
  * 确认 references 数组格式正确
  * 查看浏览器控制台错误信息
  * 尝试刷新页面后重新保存

■ 图片库选择器问题
- 图片库为空：
  * 确认已上传角色参考图预设
  * 检查预设是否包含有效 imageId
  * 尝试刷新页面重新加载
- 搜索无结果：
  * 检查搜索关键词是否正确
  * 尝试使用部分关键词
  * 清空搜索框查看全部
- 图片加载失败：
  * 图片可能已从数据库删除
  * imageId 无效或损坏
  * 尝试重新上传图片
- 选择图片无反应：
  * 检查是否已达到组上限（4个）
  * 确认点击事件是否正常触发
  * 刷新页面后重试

■ 参数配置问题
- 参数不生效：
  * 确认已启用 reference_image_active
  * 检查参数值是否在有效范围内
  * 保存设置后重新生成图片
  * 尝试调整参数值观察变化
- 滑块和输入框不同步：
  * 刷新页面重新加载
  * 手动输入数值后按回车
  * 查看浏览器控制台错误信息
- 全局参数 vs 组内参数：
  * 全局参数影响所有参考图
  * 组内参数针对单个参考图
  * 两者共同作用于生成结果
  * 优先调整组内参数微调效果

■ 生成效果问题
- 参考图影响不明显：
  * 增加 reference_strength 值
  * 增加组内参考图的 Strength
  * 增加 reference_information_extracted
  * 检查参考图是否清晰
- 生成结果过于接近参考图：
  * 降低 reference_strength 值
  * 降低组内参考图的 Fidelity
  * 尝试使用 style 类型而非 character
  * 调整提示词增加变化
- 多参考图冲突：
  * 减少参考图数量
  * 调整各参考图的 Strength 权重
  * 使用相似风格的参考图
  * 尝试不同的参考类型组合
- 参考类型选择建议：
  * character：保留角色特征，适合角色一致性
  * character_style：平衡角色和风格
  * style：仅参考风格，适合风格迁移

■ 数据管理问题
- 数据丢失：
  * 清除浏览器数据会删除所有配置
  * 定期导出预设和组配置
  * 使用云同步功能（如果可用）
  * 重要预设建议备份 JSON 文件
- 数据损坏：
  * 检查 extension_settings 结构
  * 尝试删除损坏的预设或组
  * 重新创建配置
  * 从备份文件恢复
- IndexedDB 错误：
  * 浏览器不支持 IndexedDB
  * 隐私模式可能限制存储
  * 尝试使用其他浏览器
  * 清除浏览器数据后重试

■ 性能优化建议
- 图片优化：
  * 上传前压缩图片（推荐 1024x1024 以下）
  * 使用 WebP 格式减小文件大小
  * 避免上传过多高分辨率图片
- 预设管理：
  * 定期清理不使用的预设
  * 合理组织预设命名
  * 避免创建过多预设
- 组管理：
  * 每个组最多4个参考图
  * 避免创建过多组
  * 定期清理不使用的组
- 内存优化：
  * 关闭不使用的对话框
  * 定期刷新页面释放内存
  * 避免同时打开多个编辑器

■ 兼容性问题
- 浏览器兼容性：
  * 需要支持 IndexedDB
  * 需要支持 ES6+ 语法
  * 推荐使用 Chrome、Firefox、Edge
- 移动端兼容性：
  * 触摸操作可能不流畅
  * 存储空间可能受限
  * 建议在桌面端管理预设
- NovelAI API 兼容性：
  * 确认 API 版本支持角色参考
  * 检查参数名称是否正确
  * 参考 NovelAI 官方文档

■ 调试技巧
- 查看配置数据：
  * 使用 SystemQuery 读取配置
  * 检查 extension_settings 结构
  * 验证 imageId 是否有效
- 查看数据库：
  * 打开浏览器开发者工具
  * 进入 Application > IndexedDB
  * 查看 configDatabase 中的图片数据
- 日志输出：
  * 查看浏览器控制台
  * 搜索 [CharRef] 标签的日志
  * 记录错误信息以便排查
`.trim()
};
