import { getExposedSettings, updateSettingSafely, ConfigDescriptions, getDetailedConfigKeys, getSpecificConfigData, browseConfigPath, readConfigPath, writeConfigPath, executeUIAction, getCurrentUIContext, checkRequiredConfigs, ConfigOptions, ProjectDescription, getRegexStatus, setRegexOriginalText, setRegexEditors, createRegexEntry, triggerRegexTest, setRegexTestMode, getRegexResultText, setGestureEnabled, setClickTriggerEnabled, clearAllRegexEntries, getWorkflowList, readWorkflow, scanWorkflowVariables, replaceWorkflowVariable, saveWorkflow, listWorkflowNodes, readWorkflowNode, updateWorkflowNodeInput, batchUpdateWorkflowNodes, deleteWorkflowNode, addWorkflowNode } from './aiConfigHelper.js';
import { getModulePrompt, getAvailableModuleKeys } from './aiPromptModules.js';
import { listOnDemandKnowledgeBases, readKnowledgeBase, searchKnowledge, readKnowledgeEntry } from './knowledgeBaseService.js';
import { toggleDebug, getDebugLog, exportDebugLog } from './debugLogger.js';
import { getRecentErrors, getErrorStats, exportErrors } from './errorCollector.js';
import { getLog } from './utils.js';
import { refreshAiAssistantSettings } from './aiAssistant.js';
import { requestImageGeneration, getImageGenerationStatus } from './aiImageGeneration.js';
import { createTask, updateTask, updateStep, addSteps, completeTask, failTask, getCurrentTask, getTaskHistory, getTaskStatusPrompt, getTaskInfo, clearAll as clearTaskManager, serialize as serializeTaskManager, restore as restoreTaskManager } from './aiTaskManager.js';

/**
 * 获取用于系统提示词的关键配置摘要（精简版，仅包含最关键的几个配置）
 * 完整配置可通过 browse 指令按需逐层查看
 * @returns {string} 包含关键配置的短文本，用于替换 {settings}
 */
export function getSettingsContextPrompt() {
    const settings = getExposedSettings();

    // 仅在系统提示词中注入最关键的少量配置，其余由 AI 按需 browse
    const criticalKeys = [
        'mode', 'scriptEnabled', 'sdUrl', 'comfyuiUrl',
        'current_llm_profile',
        'workerid', 'novelaimode'
    ];

    let contextStr = "【当前插件关键配置摘要】\n";

    for (const key of criticalKeys) {
        if (!(key in settings)) continue;
        const value = settings[key];
        if (typeof value === 'object' || typeof value === 'function') continue;
        const desc = ConfigDescriptions[key] || '';
        const descPart = desc ? ` (${desc})` : '';
        contextStr += `- ${key}: ${String(value)}${descPart}\n`;
    }

    // 追加当前后端对应的 API 状态
    const mode = settings.mode || 'comfyui';
    if (mode === 'novelai') {
        contextStr += `- novelaiApi: ${settings.novelaiApi ? '(已配置)' : '(未填)'}\n`;
    } else if (mode === 'banana') {
        const b = settings.banana || {};
        contextStr += `- banana.apiUrl: ${b.apiUrl || '(未填)'}\n`;
        contextStr += `- banana.apiKey: ${b.apiKey ? '(已配置)' : '(未填)'}\n`;
        contextStr += `- banana.model: ${b.model || '(未选择)'}\n`;
    }

    // 追加 LLM 当前预设摘要
    const llmProfileName = settings.current_llm_profile || '默认';
    const llmProfile = settings.llm_profiles?.[llmProfileName];
    if (llmProfile) {
        contextStr += `\n【当前LLM预设: ${llmProfileName}】\n`;
        contextStr += `- api_url: ${llmProfile.api_url || '(未填)'}\n`;
        contextStr += `- api_key: ${llmProfile.api_key ? '(已配置)' : '(未填)'}\n`;
        contextStr += `- model: ${llmProfile.model || '(未选择)'}\n`;
    }

    // 追加必配项检查报告
    contextStr += "\n" + checkRequiredConfigs() + "\n";

    // 追加当前页面信息
    try {
        const uiCtx = getCurrentUIContext();
        contextStr += "\n【当前UI状态】\n" + uiCtx + "\n";
    } catch (e) {
        // DOM 不可用时忽略
    }

    contextStr += "\n提示：以上仅为关键摘要。你可以使用 browse/read/write 指令逐层浏览和修改配置，使用 ui_action 操作按钮，使用 check_config 检查配置状态。\n";

    // 注入当前任务状态（如果有活动任务）
    const taskStatus = getTaskStatusPrompt();
    if (taskStatus) {
        contextStr += "\n" + taskStatus + "\n";
    }

    return contextStr;
}

// 重新导出任务管理器函数，供 aiAssistant.js 使用
export { clearTaskManager, serializeTaskManager, restoreTaskManager };

/**
 * 动态构建尾部提醒（system role），注入到 LLM prompt 末尾
 * 根据是否有活动任务切换两种模式：
 *   - 无任务时：通用提醒 + 对复杂请求建议创建任务
 *   - 有任务时：注入任务进度 + 引导执行下一步 + 结构化思考指引
 * @param {string} lastUserText - 用户最后一条消息的文本内容
 * @returns {string} 构建好的尾部提醒文本
 */
export function buildTailReminder(lastUserText) {
    const task = getCurrentTask();
    const safeUserText = lastUserText || '';

    if (!task) {
        // 无活动任务时的通用提醒
        return `提示:智绘姬，你使用中文为主要语言，你可以操作和修改插件内的任意内容，只是还没读取到相关模块！比如和comfyui相关则必须载入comfyui设置模块！最优先的应该是载入相关提示词模块！而不是急着回答相关疑问和回答我不行。上面是对话历史，智绘姬，你必须使用<think>标签进行思考，判断用户的行为需求，加载相应模块进行回复和操作，你的知识在提示词模块当中。结束思考必须使用</think>来结束思考！继续之前的对话吧！

💡 如果用户的请求涉及 3 个以上步骤的复杂操作（如"从头配置ComfyUI"、"帮我排查所有问题"），建议使用 task_create 创建结构化任务来跟踪进度。

用户最新的消息是：${safeUserText}`;
    }

    // 有活动任务时：注入任务进度 + 结构化思考指引
    const taskPrompt = getTaskStatusPrompt();
    const currentStep = task.steps.find(s => s.status === 'in_progress');
    const nextStepHint = currentStep ? `当前应执行：步骤 ${currentStep.order}「${currentStep.title}」` : '所有步骤已处理，请检查是否可以 task_complete 完成任务。';

    return `提示:智绘姬，你使用中文为主要语言。上面是对话历史。你必须使用<think>标签进行思考，结束思考必须使用</think>来结束思考！

${taskPrompt}
${nextStepHint}

【结构化思考指引】在 <think> 中按以下流程思考：
1. 回顾目标：当前任务是「${task.title}」
2. 检查进度：${nextStepHint}
3. 执行决策：这一步需要什么操作？需要加载哪个模块？
4. 完成后更新：执行完毕后用 step_update 更新步骤状态

用户最新的消息是：${safeUserText}`;
}

/**
 * 从文本中移除所有 think 块内容，保留其余部分
 * @param {string} text 
 * @returns {string}
 */
export function removeThinkBlocks(text) {
    if (!text) return '';
    let cleaned = text
        // 移除完整的 <think>...</think> 配对块
        .replace(/<think>[\s\S]*?<\/think>/gi, '')
        // 移除没有开标签的 </think>（如 Gemini 等模型的格式：思考内容直接以 </think> 结束）
        .replace(/^[\s\S]*?<\/think>/i, '')
        // 移除未闭合的尾部 <think> 块
        .replace(/<think>[\s\S]*$/gi, '')
        .trim();
    return cleaned;
}

/**
 * 检测文本中是否包含系统命令
 * @param {string} text - AI 回复文本
 * @returns {boolean} 是否包含命令
 */
export function hasSystemCommand(text) {
    if (!text) return false;

    let cleanedText = removeThinkBlocks(text);

    const queryMatch = cleanedText.match(/<SystemQuery>([\s\S]*?)<\/SystemQuery>/gi);
    const updateMatch = cleanedText.match(/<UpdateSettings>([\s\S]*?)<\/UpdateSettings>/gi);
    return !!(queryMatch || updateMatch);
}

/**
 * 解析AI回复中可能存在的 <UpdateSettings> JSON指令，并执行更新
 * @param {string} aiReply - AI返回给用户的完整文本片段
 */
export function parseAndApplySettings(aiReply) {
    if (!aiReply) return;

    let cleanedReply = removeThinkBlocks(aiReply);

    // 正则匹配 <UpdateSettings> 开头 </UpdateSettings> 结尾之间所有的内容
    // ([\s\S]*?) 代表非贪婪匹配所有的字符(包括换行)
    const regex = /<UpdateSettings>([\s\S]*?)<\/UpdateSettings>/gi;
    let match;

    while ((match = regex.exec(cleanedReply)) !== null) {
        let jsonStr = match[1].trim();
        try {
            const newSettings = JSON.parse(jsonStr);

            // 特殊处理：调试模式开关（不存储在 extension_settings 中）
            if ('debugMode' in newSettings) {
                const enabled = newSettings.debugMode;
                toggleDebug(enabled);
                delete newSettings.debugMode; // 从设置对象中移除，避免尝试保存

                if (typeof toastr !== 'undefined') {
                    toastr.success(enabled ? '调试模式已开启' : '调试模式已关闭');
                }
            }

            // 处理其他常规设置
            if (Object.keys(newSettings).length > 0) {
                const success = updateSettingSafely(newSettings);

                if (success) {
                    // 如果有修改，全局提示用户
                    if (typeof toastr !== 'undefined') {
                        toastr.success('智绘姬已帮你自动更新了设置项！');
                    }

                    // 刷新 AI 助手设置面板显示
                    try {
                        refreshAiAssistantSettings();
                    } catch (e) {
                        // 如果 AI 助手未初始化，忽略错误
                        console.debug('[AI Settings Bridge] AI 助手设置面板刷新跳过（可能未初始化）');
                    }
                }
            }
        } catch (e) {
            console.error('[AI Settings Bridge] AI 尝解析/修改配置 JSON 时发生错误：', e, '原始内容:', jsonStr);
        }
    }
}

/**
 * 解析AI要求查询额外系统大块数据的指令（如工作流等对象，或者直接查全部顶级对象池列表）
 * 如果有需要拦截的查询工具命令，在这里直接把它拦截出来，返回查到的信息。
 * 
 * @param {string} aiReply AI 本轮的所有字面上回复
 * @returns {string|null} 如果没有拦截查询，返回 null；如果有指令，返回要继续塞给大模型的系统文字
 */
export async function parseQuerySettings(aiReply) {
    if (!aiReply) return null;

    console.log('[AI Settings Bridge] parseQuerySettings called, reply length:', aiReply.length);

    let cleanedReply = removeThinkBlocks(aiReply);

    console.log('[AI Settings Bridge] cleanedReply length:', cleanedReply.length);

    const regex = /<SystemQuery>([\s\S]*?)<\/SystemQuery>/gi;
    const allMatches = [...cleanedReply.matchAll(regex)];

    if (allMatches.length === 0) return null;

    console.log('[AI Settings Bridge] 检测到', allMatches.length, '个 SystemQuery 指令');

    // 逐条执行所有 SystemQuery 指令，收集结果
    const results = [];

    for (const match of allMatches) {
        let jsonStr = match[1].trim();
        console.log('[AI Settings Bridge] 解析 SystemQuery:', jsonStr.substring(0, 200));

        try {
            const queryData = JSON.parse(jsonStr);
            console.log('[AI Settings Bridge] JSON 解析成功:', queryData.type);
            const result = await executeSingleQuery(queryData);
            results.push(result);
        } catch (e) {
            console.error('[AI Settings Bridge] SystemQuery JSON 解析失败:', e.message);
            console.error('[AI Settings Bridge] 原始内容:', jsonStr);
            results.push("【系统自动回复检索】 查询指令传入了无效 JSON 格式，请检查。原始内容: " + jsonStr.substring(0, 100));
        }
    }

    // 用分隔线串联多条结果
    return results.join('\n───────────────\n');
}

/**
 * 执行单条 SystemQuery 指令
 * @param {object} queryData - 解析后的查询数据对象
 * @returns {Promise<string>} 执行结果文本
 */
async function executeSingleQuery(queryData) {
    // ========== 新版渐进式浏览 API ==========

    if (queryData.type === 'browse') {
        const result = browseConfigPath(queryData.path || '');
        return `【系统自动回复 - 配置浏览】\n${result}`;
    }

    if (queryData.type === 'read' && queryData.path) {
        const result = readConfigPath(queryData.path);
        return `【系统自动回复 - 配置读取】\n${result}`;
    }

    if (queryData.type === 'write' && queryData.path) {
        const result = writeConfigPath(queryData.path, queryData.value);
        return `【系统自动回复 - 配置修改】\n${result}`;
    }

    // ========== UI 操作 API ==========

    if (queryData.type === 'ui_action' && queryData.action) {
        const result = executeUIAction(queryData.action);
        return `【系统自动回复 - UI操作】\n${result}`;
    }

    if (queryData.type === 'ui_context') {
        const result = getCurrentUIContext();
        return `【系统自动回复 - 当前界面】\n${result}`;
    }

    if (queryData.type === 'check_config') {
        const result = checkRequiredConfigs();
        return `【系统自动回复 - 配置检查】\n${result}`;
    }

    // ========== 知识模块加载 API ==========

    if (queryData.type === 'load_module' && queryData.module) {
        const moduleContent = getModulePrompt(queryData.module);
        if (moduleContent) {
            let extra = '';
            // 正则模块：自动切换到正则页面，并附带当前正则状态，节省 AI 的读取步骤
            if (queryData.module === 'regex') {
                let switchMsg = '';
                try {
                    switchMsg = executeUIAction('switch_tab_regex');
                } catch (e) {
                    switchMsg = `切换失败: ${e && e.message ? e.message : e}`;
                }
                let statusMsg = '';
                try {
                    statusMsg = getRegexStatus();
                } catch (e) {
                    statusMsg = `获取状态失败: ${e && e.message ? e.message : e}`;
                }
                extra = `\n\n【系统附加 - 已自动切换到正则页面】\n${switchMsg}\n\n【系统附加 - 当前正则状态】\n${statusMsg}`;
            }
            return `【系统自动回复 - 加载模块: ${queryData.module}】\n${moduleContent}${extra}`;
        } else {
            const available = getAvailableModuleKeys().join(', ');
            return `【系统自动回复 - 模块不存在】 未找到模块 "${queryData.module}"。当前可用模块: ${available}`;
        }
    }

    // ========== 正则 AI 操作 API ==========

    if (queryData.type === 'regex_status') {
        const result = getRegexStatus();
        return `【系统自动回复 - 正则状态】\n${result}`;
    }

    if (queryData.type === 'regex_set_original' && queryData.text !== undefined) {
        const result = setRegexOriginalText(queryData.text);
        return `【系统自动回复 - 设置原文】\n${result}`;
    }

    if (queryData.type === 'regex_set_editors') {
        const result = setRegexEditors(queryData.beforeAfter, queryData.textRegex);
        return `【系统自动回复 - 设置正则编辑器】\n${result}`;
    }

    if (queryData.type === 'regex_create_entry' && queryData.data) {
        const result = createRegexEntry(queryData.data);
        return `【系统自动回复 - 创建正则条目】\n${result}`;
    }

    if (queryData.type === 'regex_test') {
        const result = await triggerRegexTest();
        return `【系统自动回复 - 正则测试】\n${result}`;
    }

    if (queryData.type === 'regex_test_mode') {
        const result = setRegexTestMode(queryData.enabled !== false);
        return `【系统自动回复 - 测试模式】\n${result}`;
    }

    if (queryData.type === 'regex_result') {
        const result = getRegexResultText();
        return `【系统自动回复 - 正则结果】\n${result}`;
    }

    // AI 请求：开关手势功能
    if (queryData.type === 'gesture_enabled') {
        const result = setGestureEnabled(queryData.enabled !== false);
        return `【系统自动回复 - 手势功能】\n${result}`;
    }

    // AI 请求：开关点击触发功能
    if (queryData.type === 'click_trigger_enabled') {
        const result = setClickTriggerEnabled(queryData.enabled !== false);
        return `【系统自动回复 - 点击触发】\n${result}`;
    }

    // AI 请求：清除所有正则条目
    if (queryData.type === 'regex_clear_entries') {
        const result = clearAllRegexEntries();
        return `【系统自动回复 - 清除正则条目】\n${result}`;
    }

    // ========== 工作流 AI 操作 API ==========

    if (queryData.type === 'workflow_list') {
        const result = getWorkflowList();
        return `【系统自动回复 - 工作流列表】\n${result}`;
    }

    if (queryData.type === 'workflow_read' && queryData.name) {
        const result = readWorkflow(queryData.name);
        return `【系统自动回复 - 读取工作流】\n${result}`;
    }

    if (queryData.type === 'workflow_variables' && queryData.name) {
        const result = scanWorkflowVariables(queryData.name);
        return `【系统自动回复 - 工作流变量】\n${result}`;
    }

    if (queryData.type === 'workflow_replace_var' && queryData.name && queryData.variable) {
        const result = replaceWorkflowVariable(queryData.name, queryData.variable, queryData.value);
        return `【系统自动回复 - 替换工作流变量】\n${result}`;
    }

    if (queryData.type === 'workflow_save' && queryData.name && queryData.content) {
        const result = saveWorkflow(queryData.name, queryData.content);
        return `【系统自动回复 - 保存工作流】\n${result}`;
    }

    if (queryData.type === 'generate_image' && queryData.prompt) {
        try {
            console.log('[AI Settings Bridge] 开始生图请求...');
            const imageData = await requestImageGeneration(queryData.prompt, queryData.negative_prompt, queryData.options);
            console.log('[AI Settings Bridge] 生图完成，准备显示图片:', { imageUrlLength: imageData.imageUrl?.length });

            // 触发自定义事件，让 AI 助手显示图片
            const event = new CustomEvent('ai-show-generated-image', {
                detail: {
                    imageUrl: imageData.imageUrl,
                    prompt: queryData.prompt
                }
            });
            window.dispatchEvent(event);
            console.log('[AI Settings Bridge] 已触发显示图片事件');

            // 返回简单的成功消息（图片已经通过事件显示了）
            return `【系统自动回复 - 生图完成】\n✅ 图片生成成功！提示词: ${queryData.prompt}`;
        } catch (error) {
            console.error('[AI Settings Bridge] 生图失败:', error);
            return `【系统自动回复 - 生图失败】\n❌ ${error.message}`;
        }
    }

    if (queryData.type === 'image_status' && queryData.generationId) {
        const result = getImageGenerationStatus(queryData.generationId);
        return `【系统自动回复 - 生图状态】\n${result}`;
    }

    // ========== 工作流节点编辑 API ==========

    if (queryData.type === 'workflow_list_nodes' && queryData.name) {
        const result = listWorkflowNodes(queryData.name);
        return `【系统自动回复 - 工作流节点列表】\n${result}`;
    }

    if (queryData.type === 'workflow_read_node' && queryData.name && queryData.nodeId) {
        const result = readWorkflowNode(queryData.name, queryData.nodeId);
        return `【系统自动回复 - 读取节点】\n${result}`;
    }

    if (queryData.type === 'workflow_update_node' && queryData.name && queryData.nodeId && queryData.inputKey) {
        const result = updateWorkflowNodeInput(queryData.name, queryData.nodeId, queryData.inputKey, queryData.value);
        return `【系统自动回复 - 修改节点参数】\n${result}`;
    }

    if (queryData.type === 'workflow_batch_update' && queryData.name && queryData.updates) {
        const result = batchUpdateWorkflowNodes(queryData.name, queryData.updates);
        return `【系统自动回复 - 批量修改节点】\n${result}`;
    }

    if (queryData.type === 'workflow_delete_node' && queryData.name && queryData.nodeId) {
        const result = deleteWorkflowNode(queryData.name, queryData.nodeId);
        return `【系统自动回复 - 删除节点】\n${result}`;
    }

    if (queryData.type === 'workflow_add_node' && queryData.name && queryData.nodeId && queryData.nodeData) {
        const result = addWorkflowNode(queryData.name, queryData.nodeId, queryData.nodeData);
        return `【系统自动回复 - 添加节点】\n${result}`;
    }

    // ========== 诊断与日志 API ==========

    if (queryData.type === 'get_logs') {
        const lines = queryData.lines || 50;
        const fullLog = getLog();
        if (!fullLog || fullLog.trim() === '') {
            return `【系统自动回复 - 运行日志】\n暂无日志记录。`;
        }

        const logLines = fullLog.split('\n').filter(line => line.trim());
        const recentLines = logLines.slice(-lines);
        const result = recentLines.join('\n');

        return `【系统自动回复 - 运行日志】（最近 ${recentLines.length} 行）\n${result}`;
    }

    if (queryData.type === 'get_errors') {
        const count = queryData.count || 10;
        const errors = getRecentErrors(count);

        if (errors.length === 0) {
            return `【系统自动回复 - 错误记录】\n暂无错误记录。`;
        }

        let result = `【系统自动回复 - 错误记录】（最近 ${errors.length} 条）\n\n`;

        for (const error of errors) {
            const time = new Date(error.timestamp).toLocaleString();
            result += `[${time}] ${error.type.toUpperCase()}\n`;
            result += `  类型: ${error.message}\n`;

            // 显示 context 中的实际错误消息
            if (error.context && error.context.message) {
                result += `  内容: ${error.context.message}\n`;
            }

            if (error.errorMessage) {
                result += `  详情: ${error.errorMessage}\n`;
            }

            if (error.errorName) {
                result += `  错误名: ${error.errorName}\n`;
            }

            if (error.stack) {
                const stackLines = error.stack.split('\n').slice(0, 3);
                result += `  堆栈: ${stackLines.join(' | ')}\n`;
            }

            result += '\n';
        }

        return result;
    }

    if (queryData.type === 'get_error_stats') {
        const stats = getErrorStats();

        let result = `【系统自动回复 - 错误统计】\n\n`;
        result += `总错误数: ${stats.total}\n`;
        result += `最近 1 小时: ${stats.recentHour} 个错误\n`;
        result += `最近 24 小时: ${stats.recent24h} 个错误\n\n`;

        if (Object.keys(stats.byType).length > 0) {
            result += `按类型分布:\n`;
            for (const [type, count] of Object.entries(stats.byType)) {
                result += `  - ${type}: ${count}\n`;
            }
        }

        return result;
    }

    if (queryData.type === 'get_debug_log') {
        const lines = queryData.lines || 30;
        const debugLog = getDebugLog();

        if (debugLog.length === 0) {
            return `【系统自动回复 - 调试日志】\n调试日志为空。可能调试模式未启用。`;
        }

        const recentEntries = debugLog.slice(-lines);
        let result = `【系统自动回复 - 调试日志】（最近 ${recentEntries.length} 条）\n\n`;

        for (const entry of recentEntries) {
            const time = new Date(entry.timestamp).toLocaleString();
            const elapsed = entry.elapsed !== undefined ? ` [+${entry.elapsed}ms]` : '';
            result += `[${time}]${elapsed} ${entry.type} - ${entry.functionName}\n`;
            result += `  ${entry.message}\n`;
            if (entry.duration !== undefined) {
                result += `  耗时: ${entry.duration}ms\n`;
            }
            result += '\n';
        }

        return result;
    }

    if (queryData.type === 'get_system_status') {
        const fullLog = getLog();
        const logLineCount = fullLog ? fullLog.split('\n').filter(l => l.trim()).length : 0;
        const errorStats = getErrorStats();
        const debugLog = getDebugLog();

        let result = `【系统自动回复 - 系统状态】\n\n`;
        result += `运行日志: ${logLineCount} 行\n`;
        result += `错误记录: ${errorStats.total} 条（最近1小时: ${errorStats.recentHour}）\n`;
        result += `调试日志: ${debugLog.length} 条\n`;
        result += `调试模式: ${debugLog.length > 0 ? '已启用' : '未启用'}\n`;

        return result;
    }

    // ========== 任务管理 API ==========

    if (queryData.type === 'task_create' && queryData.title) {
        const steps = Array.isArray(queryData.steps) ? queryData.steps : [];
        const result = createTask(queryData.title, steps);
        return `【系统自动回复 - 创建任务】\n${result}`;
    }

    if (queryData.type === 'task_update') {
        const result = updateTask({ title: queryData.title, status: queryData.status });
        return `【系统自动回复 - 更新任务】\n${result}`;
    }

    if (queryData.type === 'task_add_steps' && Array.isArray(queryData.steps)) {
        const result = addSteps(queryData.steps);
        return `【系统自动回复 - 追加步骤】\n${result}`;
    }

    if (queryData.type === 'step_update' && queryData.stepId) {
        const result = updateStep(queryData.stepId, { status: queryData.status, result: queryData.result });
        return `【系统自动回复 - 更新步骤】\n${result}`;
    }

    if (queryData.type === 'task_complete') {
        const result = completeTask(queryData.summary || '');
        return `【系统自动回复 - 完成任务】\n${result}`;
    }

    if (queryData.type === 'task_info') {
        const result = getTaskInfo();
        return `【系统自动回复 - 任务信息】\n${result}`;
    }

    // ========== 资料库查询 API ==========

    if (queryData.type === 'list_knowledge') {
        const result = await listOnDemandKnowledgeBases();
        return `【系统自动回复 - 资料库列表】\n${result}`;
    }

    if (queryData.type === 'read_knowledge' && queryData.worldName) {
        const result = await readKnowledgeBase(queryData.worldName);
        return `【系统自动回复 - 资料库内容】\n${result}`;
    }

    if (queryData.type === 'search_knowledge' && queryData.keyword) {
        const result = await searchKnowledge(queryData.keyword);
        return `【系统自动回复 - 资料库搜索】\n${result}`;
    }

    if (queryData.type === 'read_entry' && queryData.worldName && queryData.uid) {
        const result = await readKnowledgeEntry(queryData.worldName, queryData.uid);
        return `【系统自动回复 - 条目内容】\n${result}`;
    }

    // ========== 酒馆输入框操作 API ==========

    if (queryData.type === 'tavern_input') {
        const text = queryData.text;
        if (text === undefined || text === null) {
            return `【系统自动回复 - 酒馆输入】\n❌ 缺少 text 参数`;
        }
        const mode = queryData.mode || 'overwrite'; // 'overwrite' | 'append'
        try {
            const textarea = document.querySelector('#send_textarea');
            if (!textarea) {
                return `【系统自动回复 - 酒馆输入】\n❌ 未找到酒馆输入框 #send_textarea，请确认酒馆页面已加载`;
            }

            if (mode === 'append') {
                // 追加模式：在现有内容后追加
                const currentText = textarea.value || '';
                if (currentText.trim()) {
                    textarea.value = currentText.trimEnd() + '\n' + text;
                } else {
                    textarea.value = text;
                }
            } else {
                // 覆盖模式（默认）：替换全部内容
                textarea.value = text;
            }

            // 触发 input 事件，确保 SillyTavern 检测到变化
            textarea.dispatchEvent(new Event('input', { bubbles: true }));
            textarea.focus();

            // 自动调整输入框高度
            textarea.style.height = 'auto';
            textarea.style.height = textarea.scrollHeight + 'px';

            const modeLabel = mode === 'append' ? '追加' : '覆盖';
            const preview = textarea.value.length > 100 ? textarea.value.substring(0, 100) + '...' : textarea.value;
            return `【系统自动回复 - 酒馆输入】\n✅ 已${modeLabel}输入文字到酒馆输入框。\n当前输入框内容预览: ${preview}`;
        } catch (error) {
            return `【系统自动回复 - 酒馆输入】\n❌ 操作失败: ${error.message}`;
        }
    }

    if (queryData.type === 'tavern_read_input') {
        try {
            const textarea = document.querySelector('#send_textarea');
            if (!textarea) {
                return `【系统自动回复 - 读取酒馆输入】\n❌ 未找到酒馆输入框 #send_textarea`;
            }
            const currentText = textarea.value || '';
            if (!currentText.trim()) {
                return `【系统自动回复 - 读取酒馆输入】\n输入框当前为空。`;
            }
            return `【系统自动回复 - 读取酒馆输入】\n当前输入框内容:\n${currentText}`;
        } catch (error) {
            return `【系统自动回复 - 读取酒馆输入】\n❌ 读取失败: ${error.message}`;
        }
    }

    // ========== 旧版兼容 API ==========

    if (queryData.type === 'keys_list') {
        const keys = getDetailedConfigKeys();
        return "【系统自动回复检索】\n数据库内存在以下数据名列表可以继续深入查询：\n" + JSON.stringify(keys);
    }

    if (queryData.type === 'query_key' && queryData.key) {
        const details = getSpecificConfigData(queryData.key);
        return `【系统自动回复检索】\n针对数据项 "${queryData.key}" 的内容如下：\n` + details;
    }

    return "【系统自动回复检索】 未知的查询类型: " + (queryData.type || '空');
}
