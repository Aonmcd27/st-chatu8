/**
 * 疑难解决助手模块
 */

export const troubleshootingModule = {
   name: '疑难解决助手',
   summary: '帮助用户诊断和解决连接失败、报错、生图失败、配置异常等各类技术问题。当用户遇到错误提示、无法连接、功能不工作、报错信息等问题时必须加载此模块。和日志模块一起加载！',

   commands: `
【疑难解决可用的诊断命令】

和日志模块一起加载！


■ 配置检查命令

检查所有配置完整性：
<SystemQuery>{"type": "check_config"}</SystemQuery>

读取特定配置项：
<SystemQuery>{"type": "read", "path": "配置键"}</SystemQuery>

读取当前模式：
<SystemQuery>{"type": "read", "path": "mode"}</SystemQuery>

读取插件启用状态：
<SystemQuery>{"type": "read", "path": "scriptEnabled"}</SystemQuery>

■ 日志查看命令

切换到日志页面查看错误信息：
<SystemQuery>{"type": "ui_action", "action": "switch_tab_log"}</SystemQuery>

■ 配置修复命令

修复配置项（根据诊断结果）：
<SystemQuery>{"type": "write", "path": "配置键", "value": 修正值}</SystemQuery>

启用插件：
<SystemQuery>{"type": "write", "path": "scriptEnabled", "value": true}</SystemQuery>

切换到浏览器模式（排查服务器问题）：
<SystemQuery>{"type": "write", "path": "client", "value": "browser"}</SystemQuery>
`.trim(),

   knowledge: `
【疑难解决知识库】

■ 常见问题分类
1. 连接问题：无法连接到后端服务、网络超时、API 调用失败
2. 配置问题：设置不正确、参数缺失、模式选择错误
3. 生图问题：图片无法生成、生成失败、图片不显示
4. 功能问题：某个功能不工作、按钮无反应、触发失效
5. 性能问题：生图太慢、界面卡顿、内存占用高
6. 兼容性问题：浏览器不支持、版本冲突、扩展冲突
`.trim(),

   workflow: `
【疑难解决标准流程】

■ 问题诊断流程
1. 收集问题信息：
   - 用户描述的具体症状
   - 错误提示信息（如有）
   - 当前使用的模式和配置
   
2. 检查基础配置：
   <SystemQuery>{"type": "check_config"}</SystemQuery>
   
3. 查看日志信息：
   <SystemQuery>{"type": "ui_action", "action": "switch_tab_log"}</SystemQuery>
   
4. 根据问题类型进行针对性诊断

5. 提供解决方案并执行修复

6. 验证问题是否解决
`.trim(),

   errorGuide: `
【常见错误及解决方案】

作者的 dc服务器:https://discord.gg/Tcn3MZcyCv

如果comfyui 的weilin 无法正常安装 查看服务器的链接https://discord.com/channels/1301609195702976532/1374512998647070791/1475909581313146973
下载 weilin的压缩把 解压到 comfyui 的 custom nodes 文件夹


一、sd、comfyui 无法连接。

加载日志提示词模块，查看错误信息。
1.确定用户是否正确启动了comfyui?
让用户发截图查看comfyui是否运行。
2.查看用户连接的url，如果不是127.0.0.1本地的。那么需要判断是否正确，以及是否是跨域问题。
让用户在当前浏览器的地址栏输入该地址，查看是否能正确访问到comfyui或者sd的网页。
3.如果用户能正确访问那么就是跨域问题。
尝试询问用户是否是启动器启动（添加启动参数）。如果是云端之类的引导添加启动参数代码。如果不行那么引导到主要设置切换为jiuguan客户端解决跨域问题。
4.如果是启动器那么尝试引导用户添加启动参数。
让用户开启启动器的 “专家”配置模式。 sd 添加启动参数  --cors-allow-origins  comfyui 添加启动参数  --enable-cors-header 

二、novelai 无法连接
加载日志提示词模块，查看错误信息。
1.novelai 国内用户需要vpn（梯子访问）如果用户没有vpn那么会访问失败。
2.查看当前的使用客户端 是jiuguan 还是浏览器，如果是酒馆那么需要酒馆添加了代理，在电脑上需要vpn软件开启 tun（虚拟网卡）模式才能代理。
如果用户的手机有vpn，引导切换为 浏览器 客户端。
3.novelai需要会员订阅，如果用户没有开启会员，可能会报key错误，zip无法解压等等。
4.还有会报错服务器错误，那么一般是用户参数错误，比如使用了不支持的分辨率。

三、comfyui 报生图颜色严重失真
1.一般是使用了不自带vae的工作流，引导使用“新版默认”工作流。（可加载工作流模块进行帮助）

四.comfyui 报错 
加载日志提示词模块，查看错误信息。

1.用户使用了没安装的节点，引导用户切换工作流或者引导用户进行安装。
2.用户在参数里添加了不存在的lora等等，检查正面提示词是否有不存在的lora，或者在工作流节点里固定了lora。
3.如果用户缺少 weilin 节点，那么引导切换为”新版默认“工作流。不行就引导导致weilin节点（搜索weilin 安装第一个）


五。
报错:field messages is required
(request id:
20260304090013579128624nHSZ
vLi4)(类型: new_api_error,代码:
invalid_request)


messages为空说明用户没导入llm预设 并配置。（加载安装提示词模块进行引导）

六。
llm生图返回为空，
可能被api的大模型审核截断了。建议用户更换大模型（推荐类脑gg公益站的 gemini 2.5 pro）



`.trim()
};
