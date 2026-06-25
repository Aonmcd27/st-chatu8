// @ts-nocheck
/**
 * taskQueue.js - 任务队列管理模块
 * 
 * 管理按钮点击任务和 ComfyUI 生图任务
 */

import { eventSource } from '../../../../../script.js';

/**
 * 任务状态枚举
 */
export const TaskStatus = {
    QUEUED: 'queued',
    RUNNING: 'running',
    COMPLETED: 'completed',
    CANCELLED: 'cancelled',
    FAILED: 'failed'
};

/**
 * 任务类型枚举
 */
export const TaskType = {
    BUTTON: 'button',
    COMFYUI: 'comfyui',
    NOVELAI: 'novelai',
    AUTO_CLICK: 'auto_click',
    SD: 'sd',
    LLM: 'llm',
    BANANA: 'banana'
};

/**
 * 任务队列类
 */
class TaskQueue {
    constructor() {
        this.tasks = new Map();
        this.listeners = [];
        this.maxHistory = 50;
    }

    /**
     * 生成唯一任务ID
     * @returns {string}
     */
    generateId() {
        return Date.now().toString(36) + Math.random().toString(36).substr(2, 5);
    }

    /**
     * 添加任务到队列
     * @param {object} task 任务信息
     * @param {string} task.name 任务名称
     * @param {string} task.type 任务类型 (button | comfyui)
     * @param {string} [task.prompt] 完整 prompt
     * @param {HTMLElement} [task.buttonElement] 按钮元素引用
     * @returns {string} 任务ID
     */
    addTask(task) {
        const id = this.generateId();
        const newTask = {
            id,
            name: task.name || '未命名任务',
            type: task.type || TaskType.BUTTON,
            prompt: task.prompt || '',
            buttonElement: task.buttonElement || null,
            status: TaskStatus.QUEUED,
            createdAt: Date.now(),
            startedAt: null,
            completedAt: null
        };

        this.tasks.set(id, newTask);
        this.notify();
        console.log(`[TaskQueue] 任务已添加: ${id} - ${newTask.name}`);
        return id;
    }

    /**
     * 更新任务状态
     * @param {string} id 任务ID
     * @param {string} status 新状态
     */
    updateStatus(id, status) {
        const task = this.tasks.get(id);
        if (task) {
            task.status = status;
            if (status === TaskStatus.RUNNING) {
                task.startedAt = Date.now();
            }
            if (status === TaskStatus.COMPLETED || status === TaskStatus.FAILED || status === TaskStatus.CANCELLED) {
                task.completedAt = Date.now();
            }
            this.notify();
            console.log(`[TaskQueue] 任务状态更新: ${id} -> ${status}`);
        }
    }

    /**
     * 检查任务是否在队列中（未被取消）
     * @param {string} id 任务ID
     * @returns {boolean}
     */
    isTaskInQueue(id) {
        const task = this.tasks.get(id);
        return task && (task.status === TaskStatus.QUEUED || task.status === TaskStatus.RUNNING);
    }

    /**
     * 取消任务
     * @param {string} id 任务ID
     * @returns {boolean} 是否需要中断正在运行的任务
     */
    cancelTask(id) {
        const task = this.tasks.get(id);
        if (!task) return false;

        const wasRunning = task.status === TaskStatus.RUNNING;
        task.status = TaskStatus.CANCELLED;
        task.completedAt = Date.now();
        this.notify();

        console.log(`[TaskQueue] 任务已取消: ${id}`);

        // 触发取消事件
        eventSource.emit('st_chatu8_task_cancelled', { taskId: id });

        return wasRunning;
    }

    /**
     * 完成任务
     * @param {string} id 任务ID
     * @param {boolean} success 是否成功
     */
    completeTask(id, success = true) {
        this.updateStatus(id, success ? TaskStatus.COMPLETED : TaskStatus.FAILED);
        this.cleanupHistory();
    }

    /**
     * 获取所有任务（按时间倒序）
     * @returns {Array}
     */
    getAllTasks() {
        return Array.from(this.tasks.values())
            .sort((a, b) => b.createdAt - a.createdAt)
            .slice(0, this.maxHistory);
    }

    /**
     * 获取正在运行的任务数量
     * @returns {number}
     */
    getRunningCount() {
        return Array.from(this.tasks.values())
            .filter(t => t.status === TaskStatus.RUNNING).length;
    }

    /**
     * 获取排队中的任务数量
     * @returns {number}
     */
    getQueuedCount() {
        return Array.from(this.tasks.values())
            .filter(t => t.status === TaskStatus.QUEUED).length;
    }

    /**
     * 取消所有排队中的任务
     */
    cancelAllQueued() {
        for (const [id, task] of this.tasks) {
            if (task.status === TaskStatus.QUEUED) {
                this.cancelTask(id);
            }
        }
    }

    /**
     * 清空已完成的任务
     */
    clearCompleted() {
        for (const [id, task] of this.tasks) {
            if (task.status === TaskStatus.COMPLETED ||
                task.status === TaskStatus.FAILED ||
                task.status === TaskStatus.CANCELLED) {
                this.tasks.delete(id);
            }
        }
        this.notify();
    }

    /**
     * 清理历史任务（保留最近的 maxHistory 条）
     */
    cleanupHistory() {
        const allTasks = this.getAllTasks();
        if (allTasks.length > this.maxHistory) {
            const toRemove = allTasks.slice(this.maxHistory);
            for (const task of toRemove) {
                if (task.status !== TaskStatus.QUEUED && task.status !== TaskStatus.RUNNING) {
                    this.tasks.delete(task.id);
                }
            }
        }
    }

    /**
     * 通知所有监听器
     */
    notify() {
        const tasks = this.getAllTasks();
        this.listeners.forEach(fn => {
            try {
                fn(tasks);
            } catch (e) {
                console.error('[TaskQueue] 监听器执行错误:', e);
            }
        });
    }

    /**
     * 订阅任务列表更新
     * @param {Function} fn 回调函数
     * @returns {Function} 取消订阅函数
     */
    subscribe(fn) {
        this.listeners.push(fn);
        // 立即触发一次
        fn(this.getAllTasks());
        return () => {
            this.listeners = this.listeners.filter(l => l !== fn);
        };
    }
}

// 全局单例
export const taskQueue = new TaskQueue();
