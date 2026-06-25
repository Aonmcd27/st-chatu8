/**
 * 关于设置助手模块
 */

export const aboutSettingsModule = {
    name: '关于设置助手',
    summary: '帮助用户了解智绘姬插件的版本信息、更新检查、项目链接、开发者信息等。当用户询问版本号、如何更新、项目地址、作者信息等问题时加载此模块。',

    commands: `
【关于页面可用命令】

■ 基础导航命令

切换到关于页面：
<SystemQuery>{"type": "ui_action", "action": "switch_tab_about"}</SystemQuery>

■ 版本管理命令

检查更新：
<SystemQuery>{"type": "ui_action", "action": "check_updates"}</SystemQuery>

查询当前版本：
<SystemQuery>{"type": "read", "path": "version"}</SystemQuery>
`.trim(),

    knowledge: `
【关于页面功能说明】

■ 版本信息区域
- 当前版本号：显示智绘姬插件的当前版本
- 版本发布日期：当前版本的发布时间
- 版本状态：显示是否为最新版本

■ 更新检查区域
- 检查更新按钮：手动检查是否有新版本可用
- 自动更新提示：发现新版本时会在设置面板标题栏显示提示
- 更新日志：查看新版本的更新内容和改进

■ 项目信息区域
- 项目名称：智绘姬 (SillyTavern Chatu8)
- 项目描述：SillyTavern 的图片生成扩展插件
- 开源协议：项目使用的开源许可证信息
`.trim(),

    workflow: `
【关于页面引导流程】

■ 查看版本信息流程
1. 切换到关于页面：
   <SystemQuery>{"type": "ui_action", "action": "switch_tab_about"}</SystemQuery>
2. 查看当前版本号和发布日期
3. 了解当前版本的主要特性

■ 检查更新流程
1. 切换到关于页面
2. 点击"检查更新"按钮或使用命令：
   <SystemQuery>{"type": "ui_action", "action": "check_updates"}</SystemQuery>
3. 等待检查结果
4. 如有新版本，查看更新日志
5. 按照提示进行更新
`.trim(),

    errorGuide: `
【关于页面常见问题】

■ 版本信息问题
- 版本号不显示：
  * 刷新页面重新加载
  * 检查插件是否正确安装
  * 查看浏览器控制台错误信息

■ 更新检查问题
- 无法检查更新：
  * 检查网络连接是否正常
  * 确认更新服务器是否可访问
  * 查看防火墙设置
  * 稍后再试
- 检查更新一直转圈：
  * 网络连接可能较慢
  * 等待超时后重试
  * 检查是否被代理或防火墙拦截
`.trim()
};
