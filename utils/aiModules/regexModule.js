/**
 * 正则配置助手模块
 */

export const regexModule = {
    name: '正则配置助手',
    summary: '帮助用户配置文本匹配和替换的正则规则（前后正则、文字正则、正则条目），包含测试工具和手势/点击捕获文本功能。当用户提到正则、文本替换、文本提取、去除思维链/状态栏等需求时加载此模块。',

    commands: `
【正则模块可用命令】

查看当前正则测试区域状态（测试模式、原文、结果、条目等）：
<SystemQuery>{"type": "regex_status"}</SystemQuery>

开启/关闭正则测试模式（开启后点击/手势捕获的文本会自动填入原文框）：
<SystemQuery>{"type": "regex_test_mode", "enabled": true}</SystemQuery>

创建正则条目（在正则预设编辑器中新建一个 find/replace 规则）：
<SystemQuery>{"type": "regex_create_entry", "data": {"scriptName": "规则名称", "findRegex": "/正则表达式/gi", "replaceString": "替换内容"}}</SystemQuery>

执行正则测试（应用当前配置并返回结果）：
<SystemQuery>{"type": "regex_test"}</SystemQuery>

获取正则测试结果文本：
<SystemQuery>{"type": "regex_result"}</SystemQuery>

开启/关闭手势功能（用于手势捕获文本）：
<SystemQuery>{"type": "gesture_enabled", "enabled": true}</SystemQuery>

开启/关闭点击触发功能（用于双击/三击正文捕获文本）：
<SystemQuery>{"type": "click_trigger_enabled", "enabled": true}</SystemQuery>

清除所有正则条目（重新开始正则配置时使用）：
<SystemQuery>{"type": "regex_clear_entries"}</SystemQuery>
`.trim(),

    knowledge: `
【正则页面功能说明】

- 正则页面有两种正则编辑器：「前后正则」用于切掉文本的前后部分，「文字正则」用于替换文本内容。
- 「正则预设编辑器」是一个条目列表，每个条目包含 findRegex（查找正则）和 replaceString（替换字符串），按顺序逐条对文本执行替换。
- 测试模式开启后，用户可以通过点击正文（双击 mes_text）或使用手势来捕获文本，捕获的文本会自动流入原文框并触发测试。
- 手势功能需要在手势录制区域开启「手势功能开关」。
- 点击触发需要开启「点击触发开关」。
- 电脑是双击而手机是点击三下触发，然后点击一下生成图片按钮。
- 捕获文本后，点击「应用正则并测试」按钮可以看到正则处理后的结果。
`.trim(),

    workflow: `
【正则引导流程】（当用户请求帮助配置正则时按此顺序执行）

⚠️ 注意：加载本模块时系统已经自动完成了「切换到正则页面」和「获取当前正则状态」两个步骤，并把状态附带在本次回复末尾，请直接查阅，无需再次发送 switch_tab_regex 或 regex_status。

1. 查阅附带的「当前正则状态」，判断测试模式、点击触发、已有条目等情况
2. 开启正则测试模式（如果状态显示未开启）：regex_test_mode enabled=true
3. 开启点击触发功能（用于双击/三击正文捕获文本，如未开启）：click_trigger_enabled enabled=true
4. 提示用户：请点击正文中的消息（双击）或使用手势来捕获你想处理的文本（建议把触发修改为点击，手势可以后面让用户继续了解。）
5. 等待用户捕获文本后，再次 regex_status 获取原文内容
6. 根据原文内容，分析文本结构，生成合适的正则表达式（保留故事的真正文本，需要去除思维链、状态栏、数据更新等等）
注意事项:
1.思维链不一定是完整的<thinking>标签。有可能是没有开头的。需要使用开头到</thinking>贪婪正则
2.仅保留中间的正文故事部分，状态栏summary之类需要去除
3.如果正文前后有特定标签，直接框选正文，而不是关注于去除其他！比如正文在 content 标签里，那么仅保留content 内容即可。

7. 使用 regex_create_entry 创建正则条目（可创建多个）（建议如果正文前后有特定标签，直接框选正文，而不是关注于去除其他！）
8. 触发 regex_test 执行测试
9. 检查 regex_result 获取结果，验证正则是否正确
10. 记得关闭正则测试模式，否则会造成每次生成图片命令都被拦截停止流程。点击触发无需关闭，留着给用户使用。（之前已经被捕获到的正文不会改变和消失，不影响继续调试）
11. 如果结果不理想，调整正则并重新测试（如果已经调整了多次，建议使用 regex_clear_entries 清除所有正则条目，重新开始正则配置）
12. 确认配置正确后，保存配置
`.trim(),

    errorGuide: `
【正则常见问题】

- 正则不匹配：检查正则表达式语法是否正确，注意转义字符。可以用 regex_test 反复测试。
- 捕获不到文本：确认测试模式和点击触发都已开启，电脑端使用双击，手机端使用三击。
- 正则条目顺序影响结果：条目按顺序执行，前面的替换结果会影响后面的匹配。
- 前后正则 vs 文字正则：前后正则用于裁剪文本边界（去掉开头/结尾），文字正则用于内部内容替换。
`.trim()
};
