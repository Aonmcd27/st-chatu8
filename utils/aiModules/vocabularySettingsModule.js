/**
 * 词库设置助手模块
 */

export const vocabularySettingsModule = {
    name: '词库设置助手',
    summary: '帮助用户管理和使用词库（标签库），包括词库安装/卸载、标签浏览器、标签搜索、手动标签管理等。当用户提到词库、标签库、tag、标签搜索、标签翻译、词库安装等需求时加载此模块。',

    commands: `
【词库模块可用命令】

■ 基础操作命令

切换到词库设置页面：
<SystemQuery>{"type": "ui_action", "action": "switch_tab_vocabulary"}</SystemQuery>

■ 词库管理命令

安装指定词库文件：
<SystemQuery>{"type": "ui_action", "action": "vocabulary_install", "fileName": "danbooru_001.json"}</SystemQuery>

卸载指定词库文件：
<SystemQuery>{"type": "ui_action", "action": "vocabulary_uninstall", "fileName": "danbooru_001.json"}</SystemQuery>

安装所有词库：
<SystemQuery>{"type": "ui_action", "action": "vocabulary_install_all"}</SystemQuery>

卸载所有词库：
<SystemQuery>{"type": "ui_action", "action": "vocabulary_uninstall_all"}</SystemQuery>

查询已安装的词库列表：
<SystemQuery>{"type": "read", "path": "vocabulary.installed_list"}</SystemQuery>

■ 标签搜索命令

搜索标签（支持模糊匹配）：
<SystemQuery>{"type": "ui_action", "action": "vocabulary_search", "keyword": "girl", "startsWith": false, "limit": 50, "sortBy": "hot_desc"}</SystemQuery>

搜索标签（开头匹配）：
<SystemQuery>{"type": "ui_action", "action": "vocabulary_search", "keyword": "girl", "startsWith": true, "limit": 50, "sortBy": "hot_desc"}</SystemQuery>

■ 手动标签管理命令

添加手动标签：
<SystemQuery>{"type": "ui_action", "action": "vocabulary_add_manual_tag", "name": "custom_tag", "translation": "自定义标签"}</SystemQuery>

删除手动标签：
<SystemQuery>{"type": "ui_action", "action": "vocabulary_delete_manual_tag", "name": "custom_tag"}</SystemQuery>

查询手动添加的标签列表：
<SystemQuery>{"type": "read", "path": "vocabulary.manual_tags"}</SystemQuery>

■ 搜索设置命令

设置搜索是否开头匹配：
<SystemQuery>{"type": "write", "path": "vocabulary.search_startswith", "value": true}</SystemQuery>

设置搜索最大结果数：
<SystemQuery>{"type": "write", "path": "vocabulary.search_limit", "value": 100}</SystemQuery>

设置搜索排序方式：
<SystemQuery>{"type": "write", "path": "vocabulary.search_sort", "value": "hot_desc"}</SystemQuery>
`.trim(),

    knowledge: `
【词库页面功能说明】

■ 词库管理区域
- 词库文件：包含大量预定义的标签及其翻译
- 可用词库列表：
  * danbooru_001.json ~ danbooru_025.json：Danbooru 标签库（共25个文件）
  * tags.json：结构化标签树数据（用于标签浏览器）
  * tag_NSFW001.json：NSFW 标签库
- 安装/卸载：
  * 安装：将词库文件加载到本地数据库（IndexedDB）
  * 卸载：从本地数据库删除词库数据
  * 批量操作：一键安装或卸载所有词库
- 移动端建议：手机用户安装 3-4 个词库即可，避免占用过多存储空间

■ 标签浏览器区域
- 前置条件：必须先安装 tags.json 才能使用标签浏览器
- 功能：以树形结构展示标签分类
  * 一级分类：大类（如"角色"、"服装"、"场景"等）
  * 二级分类：子类（如"发型"、"眼睛"、"表情"等）
  * 三级标签：具体标签（如"long hair"、"blue eyes"等）
- 交互方式：
  * 点击分类名称展开/折叠子项
  * 点击具体标签将其添加到选择框
- 选择框操作：
  * 回退：删除最后一个标签
  * 清空：清空所有已选标签
  * 复制：将标签复制到剪贴板（自动转换括号格式）

■ 手动标签管理区域
- 功能：用户可以添加自定义标签及其翻译
- 添加标签：
  * 标签原文：英文标签名（必填）
  * 标签翻译：中文翻译（可选）
  * 点击"添加"按钮或按 Enter 键提交
- 标签列表：
  * 显示所有手动添加的标签
  * 每个标签旁有"删除"按钮
  * 点击"刷新列表"更新显示
- 用途：补充词库中没有的标签，或添加个人常用标签

■ 搜索设置区域
- vocabulary.search_startswith（开头匹配）：
  * 启用：只匹配以关键词开头的标签（如搜索"girl"只匹配"girl"、"girlfriend"等）
  * 禁用：模糊匹配（如搜索"girl"可匹配"girl"、"schoolgirl"、"magical girl"等）
- vocabulary.search_limit（最大结果数）：
  * 范围：1-1000
  * 默认：50
  * 用途：限制搜索结果数量，避免返回过多结果
- vocabulary.search_sort（排序方式）：
  * hot_asc：按热度升序（冷门标签在前）
  * hot_desc：按热度降序（热门标签在前，推荐）
  * key_asc：按英文名升序（字母顺序）

■ 测试区域
- 搜索功能：
  * 输入关键词后点击"搜索"或按 Enter 键
  * 搜索结果显示标签名和翻译
  * 点击搜索结果可复制标签名到剪贴板
- 用途：快速测试搜索功能和查找标签

■ 重要概念说明
- 词库文件 vs 手动标签：
  * 词库文件：预定义的大量标签，需要安装后才能使用
  * 手动标签：用户自定义的标签，直接存储在数据库中
- 标签格式：
  * 原始格式：tag_name(翻译)
  * 复制格式：tag_name（翻译）（自动转换为中文括号）
- 数据存储：
  * 使用 IndexedDB 存储词库数据
  * 支持离线使用，无需网络连接
- 加密存储：
  * 词库文件使用 AES 加密存储
  * 安装时自动解密并导入数据库

■ 标签浏览器树形结构示例
▶ 角色 (Character)
  ▶ 发型 (Hairstyle)
    - long hair (长发)
    - short hair (短发)
    - twintails (双马尾)
  ▶ 眼睛 (Eyes)
    - blue eyes (蓝眼睛)
    - red eyes (红眼睛)
▶ 服装 (Clothing)
  ▶ 上衣 (Top)
    - shirt (衬衫)
    - dress (连衣裙)
`.trim(),

    workflow: `
【词库设置引导流程】

■ 首次使用流程：
1. 切换到词库设置页面
2. 根据需求安装词库文件：
   - 移动端：安装 3-4 个 danbooru 文件 + tags.json
   - 桌面端：可以安装全部词库
3. 必须安装 tags.json 以启用标签浏览器
4. 测试搜索功能确认安装成功

■ 安装词库流程：
1. 查看可用词库列表
2. 点击词库文件旁的"安装"按钮
3. 等待安装完成（会显示标签数量）
4. 安装 tags.json 后标签浏览器会自动加载

■ 使用标签浏览器流程：
1. 确保已安装 tags.json
2. 在标签浏览器中展开分类
3. 点击具体标签添加到选择框
4. 使用"回退"、"清空"、"复制"按钮管理标签
5. 复制标签后可粘贴到其他地方使用

■ 搜索标签流程：
1. 在搜索框输入关键词
2. 根据需要调整搜索设置：
   - 开头匹配：精确查找
   - 模糊匹配：广泛查找
   - 调整最大结果数
   - 选择排序方式（推荐"按热度降序"）
3. 点击"搜索"或按 Enter
4. 点击搜索结果复制标签名

■ 添加手动标签流程：
1. 在"标签原文"输入框输入英文标签名
2. 在"标签翻译"输入框输入中文翻译（可选）
3. 点击"添加"按钮或按 Enter
4. 在手动标签列表中查看新添加的标签
5. 如需删除，点击标签旁的"删除"按钮

■ 优化搜索设置流程：
1. 根据使用习惯调整搜索设置：
   - 精确查找：启用"开头匹配"
   - 广泛查找：禁用"开头匹配"
2. 设置合适的最大结果数：
   - 快速查找：50-100
   - 详细浏览：200-500
3. 选择排序方式：
   - 查找热门标签：按热度降序
   - 查找冷门标签：按热度升序
   - 字母顺序浏览：按英文名升序

■ 卸载词库流程：
1. 在词库列表中找到已安装的词库
2. 点击"卸载"按钮
3. 确认卸载操作
4. 如果卸载 tags.json，标签浏览器会显示提示信息

■ 批量操作流程：
1. 批量安装：点击"安装全部"按钮，等待所有词库安装完成
2. 批量卸载：点击"卸载全部"按钮，确认后清空所有词库

■ 标签使用建议：
1. 图像生成提示词：
   - 使用标签浏览器选择标签
   - 按分类组织标签（角色、服装、场景等）
   - 复制后粘贴到提示词输入框
2. 标签翻译：
   - 搜索英文标签查看中文翻译
   - 添加常用标签到手动标签库
3. 标签学习：
   - 浏览标签树了解标签分类
   - 使用搜索功能探索相关标签
   - 查看热度了解标签流行度
`.trim(),

    errorGuide: `
【词库常见问题】

■ 安装问题
- 安装失败：
  * 检查网络连接是否正常
  * 确认词库文件是否存在
  * 查看浏览器控制台错误信息
  * 尝试刷新页面后重新安装
- 解密失败：
  * 词库文件可能已损坏
  * 加密密钥不匹配
  * 尝试重新下载词库文件
- 安装速度慢：
  * 词库文件较大，需要耐心等待
  * 移动端建议只安装必要的词库
  * 避免同时安装多个大型词库

■ 标签浏览器问题
- 标签浏览器不显示：
  * 确认是否已安装 tags.json
  * 刷新页面重新加载
  * 检查浏览器控制台错误信息
- 标签树加载失败：
  * tags.json 可能未正确安装
  * 尝试卸载后重新安装 tags.json
  * 清除浏览器缓存后重试
- 点击标签无反应：
  * 检查选择框是否正常显示
  * 刷新页面重试
  * 查看浏览器控制台错误信息

■ 搜索问题
- 搜索无结果：
  * 确认是否已安装词库
  * 检查关键词拼写是否正确
  * 尝试禁用"开头匹配"使用模糊搜索
  * 增加最大结果数
- 搜索结果太多：
  * 启用"开头匹配"精确查找
  * 减少最大结果数
  * 使用更具体的关键词
- 搜索速度慢：
  * 减少最大结果数
  * 使用"开头匹配"提高效率
  * 考虑卸载不常用的词库

■ 手动标签问题
- 添加标签失败：
  * 检查标签原文是否为空
  * 确认标签是否已存在
  * 查看浏览器控制台错误信息
- 标签列表不更新：
  * 点击"刷新列表"按钮
  * 刷新页面重新加载
- 删除标签失败：
  * 确认标签是否存在
  * 刷新页面后重试
  * 查看浏览器控制台错误信息

■ 复制功能问题
- 复制失败：
  * 浏览器不支持剪贴板 API
  * 使用 HTTPS 协议访问页面
  * 手动选择文本复制
- 括号格式不正确：
  * 复制功能会自动转换括号格式
  * 英文括号 () 转换为中文括号 （）
  * 如需原始格式，手动选择文本复制

■ 存储问题
- 存储空间不足：
  * 卸载不常用的词库
  * 清理浏览器缓存
  * 移动端只安装必要的词库（3-4个）
- 数据丢失：
  * 清除浏览器数据会删除词库
  * 定期导出重要的手动标签
  * 重新安装词库恢复数据
- IndexedDB 错误：
  * 浏览器不支持 IndexedDB
  * 浏览器隐私模式可能限制存储
  * 尝试使用其他浏览器

■ 性能优化建议
- 移动端优化：
  * 只安装 3-4 个常用词库
  * 使用"开头匹配"提高搜索速度
  * 限制搜索结果数量（50-100）
- 桌面端优化：
  * 可以安装全部词库
  * 使用虚拟滚动处理大量数据
  * 合理设置搜索参数
- 内存优化：
  * 标签树数据会缓存在内存中
  * 卸载 tags.json 会清除缓存
  * 刷新页面释放内存

■ 兼容性问题
- 浏览器兼容性：
  * 需要支持 IndexedDB
  * 需要支持 ES6+ 语法
  * 推荐使用现代浏览器（Chrome、Firefox、Edge）
- 移动端兼容性：
  * iOS Safari 可能有存储限制
  * Android Chrome 推荐使用
  * 避免安装过多词库
- HTTPS 要求：
  * 剪贴板 API 需要 HTTPS
  * 本地开发可使用 localhost
  * 生产环境必须使用 HTTPS
`.trim()
};
