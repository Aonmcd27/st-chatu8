/**
 * 提示词替换功能教程模块
 */

export const promptReplacementModule = {
    name: '提示词替换功能教程',
    summary: '详细讲解提示词替换功能的使用方法。当用户询问如何替换提示词、触发词设置、提示词插入位置、触发Lora、画师串触发等问题时必须加载此模块。',

    commands: `
【提示词替换可用的命令】

■ 配置查询命令

读取当前提示词替换配置：
<SystemQuery>{"type": "read", "path": "prompt_replacement"}</SystemQuery>

读取特定触发词配置：
<SystemQuery>{"type": "read", "path": "prompt_replacement.trigger_rules"}</SystemQuery>

■ 配置设置命令

设置触发词规则：
<UpdateSettings>
{
  "prompt_replacement": {
    "trigger_rules": [
      {"trigger": "触发词", "type": "前置前", "replacement": "插入内容"},
      {"trigger": "触发词2", "type": "替换", "replacement": "替换内容"}
    ]
  }
}
</UpdateSettings>

■ UI 操作命令

切换到提示词替换设置页面：
<SystemQuery>{"type": "ui_action", "action": "switch_tab_prompt_replacement"}</SystemQuery>
`.trim(),

    knowledge: `
【提示词替换功能知识库】

■ 功能概述

提示词替换功能允许你通过设置触发词来自动替换、插入或修改 AI 生成的提示词。这个功能在 SD、NovelAI 和 ComfyUI 中都可以使用。

核心语法格式：
触发词=操作类型|插入/替换内容

例如：
sad=前置前|smile
nsfw=前置前|<lora:hentai:1>
1girl=替换|1boy


■ 操作类型详解

提示词的最终位置关系：
前置前 + 固定正面 + 前置后 + AI提示词[可替换] + 后置前 + 后置固定提示词 + 后置后 + 质量预设 + 最后置

1. 前置前（触发词1）
   - 在所有内容之前插入
   - 用途：添加最优先的 Lora、画师串等
   - 示例：nsfw=前置前|<lora:hentai:1>
   - 效果：<lora:hentai:1>, [其他所有内容]

2. 前置后（触发词2）
   - 在固定正面提示词之后插入
   - 用途：在固定提示词后添加特定内容
   - 示例：outdoor=前置后|nature, forest
   - 效果：[固定正面], nature, forest, [AI提示词]

3. 替换（触发词3、触发词4）
   - 直接替换 AI 生成的提示词中的内容
   - 用途：修改情绪、动作、表情等
   - 示例1：sad=替换|smile
   - 示例2：sad=前置前|smile （触发但不替换，在前面添加）
   - 效果示例1：AI生成 "1girl, sad" → 变成 "1girl, smile"
   - 效果示例2：AI生成 "1girl, sad" → 变成 "smile, 1girl, sad"

4. 替换分角色（触发词5）
   - 专门用于 NovelAI 4 的分角色功能
   - 可以替换 Character 1 Prompt、Character 2 Prompt
   - 只支持替换操作，不支持插入
   - 注意：Scene Composition 按 AI 提示词（可替换部分）计算

5. 后置前（触发词6）
   - 在后置固定提示词之前插入
   - 用途：在质量标签前添加特定内容

6. 后置后（触发词7）
   - 在后置固定提示词之后插入
   - 用途：在质量标签后添加内容

7. 最后置（触发词8）
   - 在所有内容的最后插入
   - 用途：添加最后的修饰词或参数


■ 实用案例

案例1：触发色色 Lora
需求：当 AI 生成包含 "nsfw" 的提示词时，自动添加色色 Lora，但保留 nsfw 关键词
配置：nsfw=前置前|<lora:hentai:1>
效果：AI生成 "nsfw, 1girl" → 变成 "<lora:hentai:1>, nsfw, 1girl"

案例2：替换情绪表情
需求：将悲伤表情改为微笑，并放在最前面
配置：sad=替换|smile
效果：AI生成 "1girl, sad" → 变成 "1girl, smile"

案例3：触发女孩画师
需求：当出现 "1girl" 时，自动添加特定画师风格
配置：1girl=前置前|artist:wlop, artist:guweiz
效果：AI生成 "1girl, standing" → 变成 "artist:wlop, artist:guweiz, 1girl, standing"

案例4：触发特定姿势的 Lora
需求：当出现 "sitting" 时，添加坐姿 Lora
配置：sitting=前置前|<lora:sitting_pose:0.8>
效果：AI生成 "1girl, sitting" → 变成 "<lora:sitting_pose:0.8>, 1girl, sitting"

案例5：替换但不删除触发词
需求：当出现 "angry" 时，在前面添加 "intense"，但保留 angry
配置：angry=前置前|intense
效果：AI生成 "1girl, angry" → 变成 "intense, 1girl, angry"

案例6：完全替换触发词
需求：将 "happy" 完全替换为 "joyful, smiling"
配置：happy=替换|joyful, smiling
效果：AI生成 "1girl, happy" → 变成 "1girl, joyful, smiling"


■ 配置方法

1. 打开插件设置界面
2. 找到"提示词替换"或"触发词设置"选项
3. 按照格式添加规则：
   触发词=操作类型|内容
4. 每行一个规则
5. 保存配置


■ 调试方法

查看最终发送的提示词：
1. 打开插件日志功能
2. 生成一张图片
3. 在日志中查看"最后发送的信息"
4. 检查触发词是否正确替换/插入
5. 根据实际效果调整配置


■ 注意事项

1. 触发词区分大小写
2. 触发词匹配是精确匹配，不是模糊匹配
3. 多个规则可以同时生效
4. 替换操作会删除原触发词，前置/后置操作会保留
5. 分角色替换仅适用于 NovelAI 4
6. 建议先在日志中测试效果，再正式使用
7. Lora 格式：<lora:名称:权重>，权重范围通常 0.1-1.0


■ 常见问题

Q: 触发词不生效怎么办？
A: 检查以下几点：
   - 触发词拼写是否正确（区分大小写）
   - 操作类型是否正确
   - 格式是否符合：触发词=类型|内容
   - 查看日志确认 AI 是否生成了该触发词

Q: 如何让触发词消失？
A: 使用"替换"类型，例如：sad=替换|smile

Q: 如何让触发词保留？
A: 使用"前置前"、"前置后"等插入类型

Q: 可以同时触发多个规则吗？
A: 可以，所有匹配的触发词都会生效

Q: 分角色替换和普通替换有什么区别？
A: 分角色替换专门用于 NovelAI 4 的多角色功能，只能替换角色提示词，不能插入
`.trim(),

    workflow: `
【提示词替换配置流程】

■ 基础配置流程
1. 确定需求
   - 想要触发什么效果？
   - 需要替换还是插入？
   - 触发词是什么？

2. 编写规则
   - 按照格式：触发词=类型|内容
   - 选择合适的操作类型

3. 添加到配置
   - 打开设置界面
   - 添加规则
   - 保存配置

4. 测试验证
   - 开启日志功能
   - 生成测试图片
   - 查看日志中的最终提示词
   - 根据效果调整


■ 高级配置流程
1. 组合多个规则
   - 可以设置多个触发词
   - 不同触发词可以有不同的操作

2. 优化触发时机
   - 根据位置关系选择合适的类型
   - 考虑与固定提示词的配合

3. 调试优化
   - 通过日志查看实际效果
   - 微调插入位置和内容
   - 测试不同场景下的表现
`.trim(),

    examples: `
【实用配置示例集】

■ Lora 触发配置
# 色色场景触发
nsfw=前置前|<lora:hentai:1>
nude=前置前|<lora:nude:0.9>

# 画风 Lora 触发
anime=前置前|<lora:anime_style:0.8>
realistic=前置前|<lora:realistic:1>

# 姿势 Lora 触发
sitting=前置前|<lora:sitting_pose:0.8>
lying=前置前|<lora:lying_pose:0.7>


■ 画师串触发配置
# 女孩画师
1girl=前置前|artist:wlop, artist:guweiz, artist:sakimichan

# 男孩画师
1boy=前置前|artist:ilya_kuvshinov

# 风景画师
landscape=前置前|artist:makoto_shinkai, artist:studio_ghibli


■ 表情情绪替换配置
# 替换负面情绪
sad=替换|smile, happy
angry=替换|calm, peaceful
crying=替换|laughing, joyful

# 增强正面情绪
happy=前置前|very happy, cheerful
smile=前置前|bright smile, joyful


■ 场景增强配置
# 户外场景
outdoor=前置后|nature, blue sky, sunlight
forest=前置后|trees, green, natural lighting

# 室内场景
indoor=前置后|room, furniture, indoor lighting
bedroom=前置后|bed, cozy, warm lighting


■ 质量增强配置
# 高质量触发
masterpiece=最后置|best quality, ultra detailed, 8k
highres=最后置|high resolution, detailed


■ 组合配置示例
# 完整的色色场景配置
nsfw=前置前|<lora:hentai:1>, <lora:detailed_body:0.8>
nude=前置前|nsfw, explicit
1girl=前置前|artist:sakimichan, artist:wlop
bedroom=前置后|bed, dim lighting, intimate atmosphere
`.trim()
};
