/**
 * 新手安装教程模块
 */

export const installationGuideModule = {
  name: '新手安装教程',
  summary: '为新手用户提供详细的安装和初始配置指导。当用户询问如何安装、首次配置、环境搭建、依赖安装等问题时必须加载此模块。',

  commands: `
【新手安装可用的命令】

■ 配置检查命令

检查所有配置完整性：
<SystemQuery>{"type": "check_config"}</SystemQuery>

读取特定配置项：
<SystemQuery>{"type": "read", "path": "配置键"}</SystemQuery>

■ 配置设置命令

设置配置项：
<SystemQuery>{"type": "write", "path": "配置键", "value": 值}</SystemQuery>

■ UI 操作命令

切换到主要设置页面：
<SystemQuery>{"type": "ui_action", "action": "switch_tab_main"}</SystemQuery>
`.trim(),

  knowledge: `
【新手安装知识库】

■ 安装前准备
1.确定用户需要选择的生图工具

1. NovelAI
网址：https://novelai.net/
模型由 NovelAI 公司训练，专注于二次元生成。通过提示词和画师串来生成不同风格的图片。
- 优点：
  - 不需要高端显卡支持，API 调用随时随地。
  - 门槛低，无需深入研究，复制粘贴画师串即可达到不错效果。
- 缺点：
  - 需要充值（25 刀高级会员才能无限生图）。
  - 扩展性弱，无法更换底图和 LoRA。

2. SDWebUI (Stable Diffusion WebUI)

- 优点：
  - 对新手友好，安装即用，简单易懂。
  - 功能丰富，可以更换不同的模型和 LoRA。
- 缺点：
  - 相比 ComfyUI，最新扩展适应较慢。
  - 相同参数下，速度比 ComfyUI 慢约 40%。
  - 注意：酒馆生图更推荐使用 ComfyUI。



3. ComfyUI （推荐 ⭐）

通过工作流（Nodes）来生图，自由度极高，商业生图首选。
- 优点：
  - 生图速度快，扩展性极强，自由度高。
  - 可快捷复制高手的工作流，复现率高。
  - 酒馆生图强烈推荐。
- 缺点：
  - 上手有一定难度，有学习成本（但插件已内置简单工作流，按教程操作即可）。



4. Banana （Google Imagen）

（支持反重力反代和一些公益站渠道）
谷歌开发的生图模型，当前通过 AIStudio 应用代理连接到 Banana 使用。（支持反重力反代和一些公益站渠道）
- 前提条件：必须拥有至少一个谷歌账号。
- 注意：当前教程仅包含电脑端。
- 优点：
  - 免费。一个账号每天约 100 多次生图。
  - 一致性保持得非常好（体验和爱豆/吴彦祖拍摄剧情）。
  - 支持图片编辑，非常智能。
- 缺点：
  - 需要一定动手能力。
  - 需要准备多个账号。
  - ⚠️ 严禁色色！ 审核非常敏感，拒绝一切有害提示词。

📚 相关教程：
- Banana 安装教程（自己搭建AIStudio ）
- Banana 生图使用教程（反重力反代和公益站看这个就行）
- Banana 编辑图片教程

5. Grok Imagine

（支持公益站渠道）
Grok Imagine 是由埃隆·马斯克旗下人工智能公司 xAI 推出的 AI 图像与视频生成工具，集成于 Grok 聊天机器人平台中。该功能于 2025年8月4日 正式向付费用户开放，最初在 X（原推特）的 iOS 应用上对 SuperGrok 和 Premium+ 订阅用户发布。
- 注意：无法真正的色色，可以擦边
- 优点：
  - 免费。公益站供应
  - 图生图一致性保持得不错，大香蕉的替代品
  - 支持图生视频。还自动配置声音
- 缺点：
  - 仅擦边和露点
  - 生图的质量可能不及其他




novelai 需要大会员，可以和小伙伴一起共享。或者某宝或者某鱼寻找渠道。

comfyui 需要本地显卡支持（https://my.feishu.cn/wiki/YYcNwCa1IifyuOkuAZScTF5gnZf）(本地comfyui安装教程)，或者使用云端comfyui:https://my.feishu.cn/wiki/GSlvwopWwiJb7ukK4hgcXWbCn2f (这是腾讯云端教程链接)

sd 类似 不过更推荐comfyui。sd安装教程:https://my.feishu.cn/docx/SxuGdNWDLoKPQjxcPSvcI2nenfe

Banana 可以自己反代，或者使用公益站

Grok 也需要公益站。请用户自己寻找渠道


第二步 

首先建议全程搭配作者的插件文字教程来操作:https://my.feishu.cn/wiki/UXtHw83pmiHnx1k4WpwcIn79nec


novelai：如果用户有账号，引导获取key教程地址:(https://my.feishu.cn/wiki/BSuZws5qrigVs6kwHcacp7vjnXb)
用户有了key:加载novelai 设置界面的模块进行引导添加。

comfyui:
用户安装完成，那么加载comfyui设置模块进行配置填写。
如果用户不清楚局域网的链接那么comfyui链接教程：（https://my.feishu.cn/wiki/VTjzwIivGiyDwEkychNcGaoCnde）
本地就是http://127.0.0.1:8188
链接成功之后，引导用户选择正确的模型进行使用。

sd:
用户安装完成，那么加载sd设置模块进行配置填写。
如果用户不清楚局域网的链接那么sd链接教程：（https://my.feishu.cn/docx/SxuGdNWDLoKPQjxcPSvcI2nenfe?from=from_copylink）
本地就是http://127.0.0.1:7860
链接成功之后，引导用户选择正确的模型进行使用。


Banana/Grok:
用户有渠道，那么加载 banana/grok 设置模块进行配置填写




第三步:测试生图
（确定插件是启用的）
引导用户在ai消息里填写“对应前缀+1girl+对应后缀”（默认前缀是image###，后缀是###） 测试教程:https://my.feishu.cn/wiki/MFpXwUfnnilemokB1FCcZkMTn5c
在用户点击之后反应是否出图。
如果没有出图，那么加载日志和答疑模块进行处理.



第四步:引导进行自动生成tag

插件有两种生成tag的方式。（二选一）
1.是在酒馆里加载开启 全局世界书 让ai在生成剧情的时候一起生成tag。

世界书在 类脑:(https://discord.com/channels/1134557553011998840/1299478642270666853/1299478642270666853
)获取。或者加入作者的 dc服务器:https://discord.gg/Tcn3MZcyCv

教程:https://my.feishu.cn/wiki/I1cewGZBki6fbnkL57VcjKAonpb

2.配置llm 在生成正文之后，用户点击正文进行提取文本，由ai生成并插入原文。（在正则设置界面配置）

教程:https://my.feishu.cn/wiki/IVLXwa9g3iew9WkM2OZcaQFunNe

需要引导用户配置 llm 和 正则设置。
加载llm对用户进行帮助。
llm测试畅通，那么加载 正则设置模块对用户进行帮助。


第五步:
加载主要设置模块，对插件进行主要的设置。比如点击图片查看，长按编辑图片tag等等。


■ 安装步骤
（在此编写详细的安装步骤）

■ 初始配置
（在此编写首次配置的指导）

■ 常见问题
（在此编写安装过程中的常见问题）
`.trim(),

  workflow: `
【新手安装标准流程】

■ 安装引导流程
1. 确认用户环境和需求
   
2. 提供对应的安装步骤
   
3. 协助完成初始配置
   
4. 验证安装是否成功
`.trim(),

  installGuide: `
【详细安装指南】

（在此编写详细的安装教程内容）
`.trim()
};
