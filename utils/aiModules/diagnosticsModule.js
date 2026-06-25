/**
 * AI 提示词模块 - 诊断与日志
 * 
 * 提供日志查询和错误诊断功能
 */

export const diagnosticsModule = {
   name: '诊断与日志',
   summary: '查询运行日志、错误记录、调试信息，帮助诊断问题',

   commands: `
【诊断模块可用命令】

1. 查询运行日志
<SystemQuery>{"type": "get_logs", "lines": 50}</SystemQuery>
- lines: 可选，获取最近 N 行日志（默认 50 行）
- 返回：最近的运行日志内容

2. 查询错误记录
<SystemQuery>{"type": "get_errors", "count": 10}</SystemQuery>
- count: 可选，获取最近 N 条错误（默认 10 条）
- 返回：错误记录列表，包含时间、类型、消息、堆栈等

3. 获取错误统计
<SystemQuery>{"type": "get_error_stats"}</SystemQuery>
- 返回：错误统计信息（总数、按类型分布、时间分布等）

4. 查询调试日志
<SystemQuery>{"type": "get_debug_log", "lines": 30}</SystemQuery>
- lines: 可选，获取最近 N 条调试记录（默认 30 条）
- 返回：详细的调试日志（如果调试模式已启用）

5. 获取系统状态
<SystemQuery>{"type": "get_system_status"}</SystemQuery>
- 返回：当前系统运行状态（日志数量、错误数量、调试模式状态等）
`,

   knowledge: `
【日志系统说明】

1. 运行日志 (addLog)
   - 记录插件的常规操作和状态变化
   - 存储在 extension_settings 中
   - 可以被用户手动清除
   - 格式：[时间戳] 消息内容

2. 错误收集器 (errorCollector)
   - 独立的错误记录系统
   - 不受日志清除影响
   - 自动捕获运行时错误
   - 包含错误堆栈和上下文信息
   - 最多保存 500 条错误记录

3. 调试日志 (debugLogger)
   - 详细的性能和流程追踪
   - 内存级存储（不持久化）
   - 包含计时器、分支追踪、性能分析
   - 需要手动启用调试模式

【错误类型】
- runtime: 运行时错误
- api: API 调用失败
- validation: 数据验证错误
- config: 配置错误
- unhandled_promise: 未处理的 Promise 拒绝
- global: 全局错误
- alert: Alert 弹窗中的错误提示（自动捕获）
- toastr: Toastr 通知中的错误（自动捕获）
- console: Console.error 输出的错误（自动捕获）
- log: 日志中检测到的错误（自动捕获）

【自动错误收集】
系统会自动拦截和记录以下来源的错误：
1. Alert 弹窗中包含"失败"、"错误"等关键词的提示
2. Toastr.error 错误通知
3. Console.error 输出
4. addLog 日志中包含错误关键词的记录
5. 未处理的异常和 Promise 拒绝

这意味着即使代码中没有显式调用 collectError，
大部分错误也会被自动捕获并记录。
`,

   workflow: `
【诊断工作流程】

1. 用户报告问题时
   ① 先查询错误记录：get_errors
   ② 查看错误统计：get_error_stats
   ③ 如果需要更多上下文，查询运行日志：get_logs
   ④ 如果启用了调试模式，查询调试日志：get_debug_log

2. 分析错误模式
   - 查看错误类型分布
   - 检查错误发生时间（是否集中在某个时段）
   - 查看错误堆栈定位问题代码
   - 结合运行日志了解操作上下文

3. 提供解决方案
   - 根据错误类型给出针对性建议
   - 如果是配置问题，引导用户修改配置
   - 如果是 API 问题，检查网络和服务状态
   - 如果是代码 bug，说明问题并建议临时解决方案
`,

   errorGuide: `
【常见错误诊断】

1. API 调用失败
   - 检查 API 地址和密钥配置
   - 查看网络连接状态
   - 确认 API 服务是否正常

2. 配置错误
   - 验证配置格式是否正确
   - 检查必填字段是否完整
   - 确认配置值是否在有效范围内

3. 运行时错误
   - 查看错误堆栈定位问题
   - 检查是否有未处理的异常
   - 确认操作顺序是否正确

4. 性能问题
   - 启用调试模式查看详细计时
   - 检查是否有长时间运行的操作
   - 查看是否有重复的 API 调用
`
};
