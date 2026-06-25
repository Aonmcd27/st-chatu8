/**
 * 智绘姬 AI 助手 —— 对话级任务管理器
 *
 * 任务状态跟随聊天会话一起持久化存储，切换/加载对话时自动恢复。
 * 单一活动任务模式（创建新任务自动归档旧任务）。
 * 为 AI 助手提供结构化的任务规划、步骤分解和进度跟踪能力。
 *
 * 数据结构：
 *   Task: { id, title, status, createdAt, updatedAt, summary, steps[] }
 *   Step: { id, title, status, result, order }
 */

// ========== 内部状态 ==========

/** @type {object|null} 当前活动任务 */
let currentTask = null;

/** @type {Array<object>} 历史任务列表（已完成/已失败/被归档的任务） */
let taskHistory = [];

/** 任务ID自增计数器 */
let taskIdCounter = 0;

/** 步骤ID自增计数器 */
let stepIdCounter = 0;

// ========== 内部辅助函数 ==========

/**
 * 生成唯一的任务ID
 * @returns {string}
 */
function generateTaskId() {
    taskIdCounter++;
    return `task_${taskIdCounter}_${Date.now()}`;
}

/**
 * 生成唯一的步骤ID
 * @returns {string}
 */
function generateStepId() {
    stepIdCounter++;
    return `step_${stepIdCounter}`;
}

/**
 * 将当前活动任务归档到历史记录
 */
function archiveCurrentTask() {
    if (currentTask) {
        // 如果任务还在进行中，标记为被归档
        if (currentTask.status === 'pending' || currentTask.status === 'in_progress') {
            currentTask.status = 'archived';
            currentTask.updatedAt = Date.now();
        }
        taskHistory.push(currentTask);
        // 只保留最近 10 个历史任务
        if (taskHistory.length > 10) {
            taskHistory = taskHistory.slice(-10);
        }
        currentTask = null;
    }
}

/**
 * 截断文本到指定长度
 * @param {string} text
 * @param {number} maxLen
 * @returns {string}
 */
function truncateText(text, maxLen = 50) {
    if (!text) return '';
    if (text.length <= maxLen) return text;
    return text.substring(0, maxLen - 3) + '...';
}

// ========== 导出函数 ==========

/**
 * 创建新任务（自动归档旧任务）
 * @param {string} title - 任务标题
 * @param {Array<string>} steps - 步骤标题列表
 * @returns {string} 格式化的创建结果
 */
export function createTask(title, steps = []) {
    // 归档当前活动任务
    archiveCurrentTask();

    const taskId = generateTaskId();
    const now = Date.now();

    currentTask = {
        id: taskId,
        title: title,
        status: 'in_progress',
        createdAt: now,
        updatedAt: now,
        summary: '',
        steps: steps.map((stepTitle, index) => ({
            id: generateStepId(),
            title: stepTitle,
            status: 'pending',
            result: '',
            order: index + 1
        }))
    };

    // 如果有步骤，自动将第一步标记为进行中
    if (currentTask.steps.length > 0) {
        currentTask.steps[0].status = 'in_progress';
    }

    let result = `✅ 任务创建成功！\n`;
    result += `任务: ${title}\n`;
    result += `步骤数: ${steps.length}\n`;
    if (steps.length > 0) {
        result += `步骤列表:\n`;
        currentTask.steps.forEach(s => {
            result += `  ${s.id}. ${s.title}\n`;
        });
    }

    return result;
}

/**
 * 更新当前任务的元信息
 * @param {object} fields - 要更新的字段 { title?, status? }
 * @returns {string} 格式化的更新结果
 */
export function updateTask(fields = {}) {
    if (!currentTask) {
        return '⚠️ 当前没有活动任务。请先使用 task_create 创建任务。';
    }

    if (fields.title) {
        currentTask.title = fields.title;
    }
    if (fields.status && ['pending', 'in_progress', 'completed', 'failed'].includes(fields.status)) {
        currentTask.status = fields.status;
    }
    currentTask.updatedAt = Date.now();

    return `✅ 任务已更新: ${currentTask.title} (${currentTask.status})`;
}

/**
 * 更新指定步骤的状态和结果
 * @param {string} stepId - 步骤ID
 * @param {object} fields - 要更新的字段 { status?, result? }
 * @returns {string} 格式化的更新结果
 */
export function updateStep(stepId, fields = {}) {
    if (!currentTask) {
        return '⚠️ 当前没有活动任务。';
    }

    const step = currentTask.steps.find(s => s.id === stepId);
    if (!step) {
        return `⚠️ 未找到步骤 ${stepId}。当前步骤: ${currentTask.steps.map(s => s.id).join(', ')}`;
    }

    if (fields.status && ['pending', 'in_progress', 'completed', 'failed', 'skipped'].includes(fields.status)) {
        step.status = fields.status;

        // 如果当前步骤完成，自动将下一个 pending 步骤设为 in_progress
        if (fields.status === 'completed' || fields.status === 'skipped') {
            const nextPending = currentTask.steps.find(s => s.status === 'pending');
            if (nextPending) {
                nextPending.status = 'in_progress';
            }
        }
    }
    if (fields.result !== undefined) {
        step.result = truncateText(String(fields.result), 50);
    }
    currentTask.updatedAt = Date.now();

    const statusIcon = { pending: '○', in_progress: '→', completed: '✓', failed: '✗', skipped: '⊘' };
    return `${statusIcon[step.status] || '?'} 步骤 ${step.order}「${step.title}」已更新为 ${step.status}${step.result ? ' | ' + step.result : ''}`;
}

/**
 * 追加新步骤到当前任务
 * @param {Array<string>} steps - 新步骤标题列表
 * @returns {string} 格式化的追加结果
 */
export function addSteps(steps = []) {
    if (!currentTask) {
        return '⚠️ 当前没有活动任务。请先使用 task_create 创建任务。';
    }

    const startOrder = currentTask.steps.length + 1;
    const newSteps = steps.map((title, index) => ({
        id: generateStepId(),
        title: title,
        status: 'pending',
        result: '',
        order: startOrder + index
    }));

    currentTask.steps.push(...newSteps);
    currentTask.updatedAt = Date.now();

    let result = `✅ 已追加 ${newSteps.length} 个新步骤:\n`;
    newSteps.forEach(s => {
        result += `  ${s.id}. ${s.title}\n`;
    });

    return result;
}

/**
 * 标记当前任务为已完成
 * @param {string} summary - 完成摘要
 * @returns {string} 格式化的完成结果
 */
export function completeTask(summary = '') {
    if (!currentTask) {
        return '⚠️ 当前没有活动任务。';
    }

    currentTask.status = 'completed';
    currentTask.summary = summary;
    currentTask.updatedAt = Date.now();

    // 将所有 pending/in_progress 的步骤标记为 completed
    currentTask.steps.forEach(s => {
        if (s.status === 'pending' || s.status === 'in_progress') {
            s.status = 'completed';
        }
    });

    const title = currentTask.title;
    // 归档到历史
    taskHistory.push(currentTask);
    if (taskHistory.length > 10) {
        taskHistory = taskHistory.slice(-10);
    }
    currentTask = null;

    return `🎉 任务「${title}」已完成！${summary ? '\n摘要: ' + summary : ''}`;
}

/**
 * 标记当前任务为失败
 * @param {string} reason - 失败原因
 * @returns {string} 格式化的失败结果
 */
export function failTask(reason = '') {
    if (!currentTask) {
        return '⚠️ 当前没有活动任务。';
    }

    currentTask.status = 'failed';
    currentTask.summary = reason;
    currentTask.updatedAt = Date.now();

    const title = currentTask.title;
    // 归档到历史
    taskHistory.push(currentTask);
    if (taskHistory.length > 10) {
        taskHistory = taskHistory.slice(-10);
    }
    currentTask = null;

    return `❌ 任务「${title}」已标记为失败。${reason ? '\n原因: ' + reason : ''}`;
}

/**
 * 获取当前活动任务
 * @returns {object|null}
 */
export function getCurrentTask() {
    return currentTask;
}

/**
 * 获取历史任务列表
 * @returns {Array<object>}
 */
export function getTaskHistory() {
    return taskHistory;
}

/**
 * 关键函数：生成紧凑的任务状态文本，用于 prompt 注入
 *
 * 输出示例（约 50-100 tokens）：
 * 【当前任务】从头配置ComfyUI (进行中, 2/6步已完成)
 *   ✓ 1. 加载ComfyUI设置模块
 *   ✓ 2. 检查并配置连接地址
 *   → 3. 连接ComfyUI服务 (执行中)
 *   ○ 4. 选择工作流
 *   ○ 5. 配置工作流变量
 *   ○ 6. 测试生图
 *
 * @returns {string} 任务状态文本，无活动任务时返回空字符串
 */
export function getTaskStatusPrompt() {
    if (!currentTask) return '';

    const statusIcon = {
        pending: '○',
        in_progress: '→',
        completed: '✓',
        failed: '✗',
        skipped: '⊘'
    };

    const statusLabel = {
        pending: '待执行',
        in_progress: '进行中',
        completed: '已完成',
        failed: '已失败'
    };

    const completedCount = currentTask.steps.filter(s => s.status === 'completed' || s.status === 'skipped').length;
    const totalCount = currentTask.steps.length;

    let prompt = `【当前任务】${currentTask.title} (${statusLabel[currentTask.status] || currentTask.status}`;
    if (totalCount > 0) {
        prompt += `, ${completedCount}/${totalCount}步已完成`;
    }
    prompt += ')\n';

    // Token 控制策略：步骤超过 15 个只显示最近执行的 10 个
    let displaySteps = currentTask.steps;
    if (displaySteps.length > 15) {
        // 找到当前 in_progress 的步骤索引
        const activeIdx = displaySteps.findIndex(s => s.status === 'in_progress');
        const centerIdx = activeIdx >= 0 ? activeIdx : completedCount;
        const start = Math.max(0, centerIdx - 3);
        const end = Math.min(displaySteps.length, start + 10);

        if (start > 0) {
            prompt += `  ... (前 ${start} 步已省略)\n`;
        }
        displaySteps = displaySteps.slice(start, end);
        if (end < currentTask.steps.length) {
            // 会在后面添加省略提示
        }
    }

    for (const step of displaySteps) {
        const icon = statusIcon[step.status] || '?';
        const resultPart = step.result ? ` (${step.result})` : '';
        const activeMark = step.status === 'in_progress' ? ' (执行中)' : '';
        prompt += `  ${icon} ${step.order}. ${step.title}${activeMark}${resultPart}\n`;
    }

    // 如果有省略的尾部步骤
    if (currentTask.steps.length > 15) {
        const shownEnd = displaySteps[displaySteps.length - 1]?.order || 0;
        if (shownEnd < currentTask.steps.length) {
            prompt += `  ... (后 ${currentTask.steps.length - shownEnd} 步已省略)\n`;
        }
    }

    return prompt;
}

/**
 * 清空所有任务数据（对话重置时调用）
 */
export function clearAll() {
    currentTask = null;
    taskHistory = [];
    // 不重置计数器，避免 ID 冲突
}

/**
 * 序列化当前任务状态为 JSON-safe 对象，用于跟随聊天记录持久化存储
 * @returns {object|null} 序列化后的任务数据，无任务时返回 null
 */
export function serialize() {
    // 如果没有任何数据，返回 null（不占用存储空间）
    if (!currentTask && taskHistory.length === 0) {
        return null;
    }

    return {
        version: 1,
        currentTask: currentTask ? { ...currentTask, steps: currentTask.steps.map(s => ({ ...s })) } : null,
        taskHistory: taskHistory.map(t => ({ ...t, steps: t.steps.map(s => ({ ...s })) })),
        taskIdCounter,
        stepIdCounter
    };
}

/**
 * 从序列化数据恢复任务状态（切换/加载对话时调用）
 * @param {object|null} data - serialize() 返回的数据，null 表示清空
 */
export function restore(data) {
    if (!data || typeof data !== 'object' || !data.version) {
        // 数据为空或无效，清空状态
        currentTask = null;
        taskHistory = [];
        return;
    }

    currentTask = data.currentTask || null;
    taskHistory = Array.isArray(data.taskHistory) ? data.taskHistory : [];

    // 恢复计数器（确保新建的 ID 不会和已有的冲突）
    if (typeof data.taskIdCounter === 'number' && data.taskIdCounter > taskIdCounter) {
        taskIdCounter = data.taskIdCounter;
    }
    if (typeof data.stepIdCounter === 'number' && data.stepIdCounter > stepIdCounter) {
        stepIdCounter = data.stepIdCounter;
    }
}

/**
 * 获取当前任务的摘要信息（用于 task_info 查询返回）
 * @returns {string} 格式化的任务信息
 */
export function getTaskInfo() {
    let result = '';

    if (currentTask) {
        result += '【当前活动任务】\n';
        result += `ID: ${currentTask.id}\n`;
        result += `标题: ${currentTask.title}\n`;
        result += `状态: ${currentTask.status}\n`;
        result += `步骤数: ${currentTask.steps.length}\n`;

        const completedCount = currentTask.steps.filter(s => s.status === 'completed' || s.status === 'skipped').length;
        result += `已完成: ${completedCount}/${currentTask.steps.length}\n`;

        result += '\n步骤详情:\n';
        for (const step of currentTask.steps) {
            result += `  [${step.id}] ${step.order}. ${step.title} — ${step.status}${step.result ? ' | ' + step.result : ''}\n`;
        }
    } else {
        result += '当前没有活动任务。\n';
    }

    if (taskHistory.length > 0) {
        result += `\n【历史任务】（共 ${taskHistory.length} 个）\n`;
        for (const task of taskHistory.slice(-5)) {
            const completedCount = task.steps.filter(s => s.status === 'completed' || s.status === 'skipped').length;
            result += `- ${task.title} [${task.status}] (${completedCount}/${task.steps.length}步)${task.summary ? ' — ' + task.summary : ''}\n`;
        }
    }

    return result;
}
