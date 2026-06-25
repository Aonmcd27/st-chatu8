// @ts-nocheck
/**
 * taskManager.js - 任务管理器 UI 逻辑
 */

import { taskQueue, TaskStatus, TaskType } from '../taskQueue.js';
import { eventSource } from '../../../../../../script.js';
import { extension_settings } from '../../../../../extensions.js';
import { extensionName } from '../config.js';

/**
 * 状态图标映射
 */
const statusIcons = {
    [TaskStatus.QUEUED]: '⏳',
    [TaskStatus.RUNNING]: '🔄',
    [TaskStatus.COMPLETED]: '✅',
    [TaskStatus.CANCELLED]: '❌',
    [TaskStatus.FAILED]: '⚠️'
};

/**
 * 状态文本映射
 */
const statusTexts = {
    [TaskStatus.QUEUED]: '排队中',
    [TaskStatus.RUNNING]: '运行中',
    [TaskStatus.COMPLETED]: '已完成',
    [TaskStatus.CANCELLED]: '已取消',
    [TaskStatus.FAILED]: '失败'
};

/**
 * 类型文本映射
 */
const typeTexts = {
    [TaskType.BUTTON]: '按钮',
    [TaskType.COMFYUI]: 'ComfyUI',
    [TaskType.NOVELAI]: 'NovelAI',
    [TaskType.AUTO_CLICK]: '自动点击',
    [TaskType.LLM]: 'LLM',
    [TaskType.BANANA]: 'Banana'
};

/**
 * 渲染任务列表
 * @param {Array} tasks 任务数组
 */
function renderTaskList(tasks) {
    const container = document.getElementById('ch-task-list');
    if (!container) return;

    if (tasks.length === 0) {
        container.innerHTML = '<div class="st-chatu8-task-empty">暂无任务</div>';
        return;
    }

    const html = tasks.map(task => {
        const icon = statusIcons[task.status] || '❓';
        const statusText = statusTexts[task.status] || task.status;
        const typeText = typeTexts[task.type] || task.type;
        const canCancel = task.status === TaskStatus.QUEUED || task.status === TaskStatus.RUNNING;

        return `
            <div class="st-chatu8-task-item" data-task-id="${task.id}">
                <span class="task-icon">${icon}</span>
                <span class="task-info">
                    <span class="task-name" title="${task.prompt || task.name}">${task.name}</span>
                    <span class="task-meta">${typeText} · ${statusText}</span>
                </span>
                ${canCancel ? `<button class="task-cancel-btn" data-task-id="${task.id}" title="取消任务">❌</button>` : ''}
            </div>
        `;
    }).join('');

    container.innerHTML = html;

    // 绑定取消按钮事件
    container.querySelectorAll('.task-cancel-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const taskId = btn.getAttribute('data-task-id');
            handleCancelTask(taskId);
        });
    });
}

/**
 * 处理取消任务
 * @param {string} taskId 任务ID
 */
function handleCancelTask(taskId) {
    const task = taskQueue.tasks.get(taskId);
    if (!task) return;

    const wasRunning = taskQueue.cancelTask(taskId);

    // 如果任务正在运行，需要中断
    if (wasRunning) {
        // 根据任务类型选择取消方式
        if (task.type === TaskType.AUTO_CLICK) {
            // 自动点击任务：设置全局变量停止后续点击
            window.zidongdianji = false;
            console.log('[TaskManager] 已停止自动点击任务');
        } else if (task.type === TaskType.LLM) {
            // LLM 任务：触发取消事件，由 llmService.js 处理
            eventSource.emit('st_chatu8_cancel_llm_task', { taskId });
            console.log('[TaskManager] 已触发 LLM 取消事件');
        } else if (task.type === TaskType.NOVELAI) {
            // NovelAI 任务：触发取消事件，由 novelai.js 处理
            eventSource.emit('st_chatu8_cancel_novelai_task', { taskId });
            console.log('[TaskManager] 已触发 NovelAI 取消事件');
        } else if (task.type === TaskType.BANANA) {
            // Banana 任务：触发取消事件，由 banana.js 处理
            eventSource.emit('st_chatu8_cancel_banana_task', { taskId });
            console.log('[TaskManager] 已触发 Banana 取消事件');
        } else if (extension_settings[extensionName]?.client === 'jiuguan') {
            // 通知酒馆取消
            eventSource.emit('sd_stop_generation');
            console.log('[TaskManager] 已通知酒馆取消任务');
        } else {
            // 直连模式：触发自定义取消事件，由 comfyui.js 处理
            eventSource.emit('st_chatu8_cancel_task', { taskId });
            console.log('[TaskManager] 已触发直连取消事件');
        }
    }

    toastr.info('任务已取消');
}

/**
 * 处理全部取消
 */
function handleCancelAll() {
    const runningTasks = Array.from(taskQueue.tasks.values())
        .filter(t => t.status === TaskStatus.RUNNING);

    // 先取消所有排队的
    taskQueue.cancelAllQueued();

    // 再取消运行中的
    for (const task of runningTasks) {
        handleCancelTask(task.id);
    }

    toastr.info('已取消所有任务');
}

/**
 * 处理清空已完成
 */
function handleClearCompleted() {
    taskQueue.clearCompleted();
    toastr.info('已清空已完成任务');
}

/**
 * 更新统计信息
 * @param {Array} tasks 任务数组
 */
function updateStats(tasks) {
    const statsEl = document.getElementById('ch-task-stats');
    if (!statsEl) return;

    const running = tasks.filter(t => t.status === TaskStatus.RUNNING).length;
    const queued = tasks.filter(t => t.status === TaskStatus.QUEUED).length;

    if (running > 0 || queued > 0) {
        statsEl.textContent = `运行中: ${running} | 排队中: ${queued}`;
        statsEl.style.display = 'block';
    } else {
        statsEl.style.display = 'none';
    }
}

/**
 * 初始化任务管理器
 * @param {JQuery} settingsModal 设置模态框
 */
export function initTaskManager(settingsModal) {
    // 订阅任务列表更新
    taskQueue.subscribe((tasks) => {
        renderTaskList(tasks);
        updateStats(tasks);
    });

    // 绑定按钮事件
    settingsModal.find('#ch-cancel-all-tasks').on('click', handleCancelAll);
    settingsModal.find('#ch-clear-completed').on('click', handleClearCompleted);

    console.log('[TaskManager] 初始化完成');
}

/**
 * 更新任务管理器视图（用于 tab 切换时刷新）
 */
export function updateTaskManagerView() {
    const tasks = taskQueue.getAllTasks();
    renderTaskList(tasks);
    updateStats(tasks);
}
