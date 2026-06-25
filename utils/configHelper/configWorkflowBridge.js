/* eslint-disable no-undef */
// @ts-nocheck
import { extension_settings } from "../../../../../extensions.js";
import { extensionName } from '../config.js';
import { saveSettingsDebounced } from "../../../../../../script.js";
import { refreshWorkflowSelectors } from './configUIRefresh.js';

// ==================== 工作流 AI 桥接函数 ====================

/**
 * 列出所有已保存的工作流预设名称
 * @returns {string} 格式化的工作流列表
 */
export function getWorkflowList() {
    const s = extension_settings[extensionName];
    if (!s || !s.workers) return '❌ 未找到工作流数据。';

    const names = Object.keys(s.workers);
    const current = s.workerid || '(未选择)';

    let result = `📂 工作流预设列表 (共 ${names.length} 个)：\n`;
    result += `当前使用: ${current}\n`;
    result += '─'.repeat(40) + '\n';

    for (const name of names) {
        const isCurrent = name === current ? ' ← 当前' : '';
        const content = s.workers[name] || '';
        const size = content.length;
        result += `  - ${name} (${size}字符)${isCurrent}\n`;
    }

    return result;
}

/**
 * 读取指定工作流的完整 JSON 内容
 * @param {string} name - 工作流名称
 * @returns {string} 工作流 JSON 内容
 */
export function readWorkflow(name) {
    const s = extension_settings[extensionName];
    if (!s || !s.workers) return '❌ 未找到工作流数据。';
    if (!name) return '❌ 请指定工作流名称。';

    if (!(name in s.workers)) {
        const available = Object.keys(s.workers).join(', ');
        return `❌ 工作流 "${name}" 不存在。可用: ${available}`;
    }

    const content = s.workers[name];
    if (!content) return `工作流 "${name}" 内容为空。`;

    return `📄 工作流 "${name}" 的完整内容 (${content.length}字符)：\n${content}`;
}

/**
 * 扫描工作流中的 %xxx% 变量占位符
 * @param {string} name - 工作流名称
 * @returns {string} 变量列表
 */
export function scanWorkflowVariables(name) {
    const s = extension_settings[extensionName];
    if (!s || !s.workers) return '❌ 未找到工作流数据。';
    if (!name) return '❌ 请指定工作流名称。';

    if (!(name in s.workers)) {
        const available = Object.keys(s.workers).join(', ');
        return `❌ 工作流 "${name}" 不存在。可用: ${available}`;
    }

    const content = s.workers[name];
    if (!content) return `工作流 "${name}" 内容为空，无变量。`;

    // 匹配所有 "%xxx%" 形式的占位符（含引号包裹）
    const regex = /"%([^%"]+)%"/g;
    const found = new Map();
    let match;

    while ((match = regex.exec(content)) !== null) {
        const varName = match[1];
        if (!found.has(varName)) {
            found.set(varName, 0);
        }
        found.set(varName, found.get(varName) + 1);
    }

    if (found.size === 0) {
        return `工作流 "${name}" 中未发现 %xxx% 格式的变量占位符。`;
    }

    // 变量含义映射
    const varDescMap = {
        'seed': '随机种子 (数值)',
        'steps': '采样步数 (数值)',
        'cfg_scale': 'CFG引导比例 (数值)',
        'width': '图片宽度 (数值)',
        'height': '图片高度 (数值)',
        'prompt': '正面提示词 (字符串)',
        'negative_prompt': '负面提示词 (字符串)',
        'sampler_name': '采样器 (字符串)',
        'MODEL_NAME': '模型名称 (字符串)',
        'c_quanzhong': '权重 (数值)',
        'c_idquanzhong': 'ID权重 (数值)',
        'c_xijie': '细节 (数值)',
        'c_fenwei': '氛围 (数值)',
        'comfyuicankaotupian': '参考图片 (字符串)',
        'ipa': 'IP-Adapter (字符串)',
        'scheduler': '调度器 (字符串)',
        'vae': 'VAE模型 (字符串)',
        'clip': 'CLIP模型 (字符串)',
        'inpaint_image': '重绘原图 (字符串)',
        'inpaint_mask': '重绘蒙版 (字符串)',
        'inpaint_denoise': '重绘幅度 (数值)',
        'inpaint_positive': '重绘正面词 (字符串)',
        'inpaint_negative': '重绘负面词 (字符串)',
    };

    let result = `🔍 工作流 "${name}" 中的变量占位符 (共 ${found.size} 种)：\n`;
    result += '─'.repeat(50) + '\n';

    for (const [varName, count] of found) {
        const desc = varDescMap[varName] || '(自定义变量)';
        result += `  %${varName}% — ${desc}  (出现 ${count} 次)\n`;
    }

    return result;
}

/**
 * 在工作流中替换指定变量的值
 * @param {string} name - 工作流名称
 * @param {string} variable - 变量名（含或不含 %）
 * @param {*} value - 新值
 * @returns {string} 操作结果
 */
export function replaceWorkflowVariable(name, variable, value) {
    const s = extension_settings[extensionName];
    if (!s || !s.workers) return '❌ 未找到工作流数据。';
    if (!name) return '❌ 请指定工作流名称。';
    if (!variable) return '❌ 请指定变量名。';

    if (!(name in s.workers)) {
        return `❌ 工作流 "${name}" 不存在。`;
    }

    let content = s.workers[name];
    if (!content) return `❌ 工作流 "${name}" 内容为空。`;

    // 统一变量名格式
    const cleanVar = variable.replace(/%/g, '');
    const placeholder = `"%${cleanVar}%"`;

    if (!content.includes(placeholder)) {
        return `❌ 工作流 "${name}" 中未找到变量 ${placeholder}。请先用 workflow_variables 确认。`;
    }

    // 根据值类型决定替换格式
    let replacement;
    if (typeof value === 'number' || !isNaN(Number(value))) {
        replacement = String(Number(value));
    } else {
        replacement = `"${String(value).replace(/"/g, '\\"')}"`;
    }

    const count = (content.match(new RegExp(placeholder.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')) || []).length;
    content = content.replaceAll(placeholder, replacement);

    s.workers[name] = content;

    // 如果修改的是当前工作流，同步更新 worker
    if (s.workerid === name) {
        s.worker = content;
    }

    saveSettingsDebounced();

    return `✅ 已在工作流 "${name}" 中替换 ${placeholder} → ${replacement} (${count} 处)`;
}

/**
 * 保存工作流内容
 * @param {string} name - 工作流名称
 * @param {string} content - 完整工作流 JSON 字符串
 * @returns {string} 操作结果
 */
export function saveWorkflow(name, content) {
    const s = extension_settings[extensionName];
    if (!s) return '❌ 插件配置尚未初始化。';
    if (!name) return '❌ 请指定工作流名称。';
    if (!content) return '❌ 请提供工作流内容。';

    // 验证 JSON 合法性
    try {
        JSON.parse(content);
    } catch (e) {
        return `❌ 工作流内容不是合法的 JSON: ${e.message}`;
    }

    if (!s.workers) s.workers = {};

    const isNew = !(name in s.workers);
    s.workers[name] = content;

    // 如果是当前工作流，同步更新
    if (s.workerid === name) {
        s.worker = content;
    }

    saveSettingsDebounced();

    // 刷新工作流选择器 UI
    refreshWorkflowSelectors(s);

    return `✅ 工作流 "${name}" 已${isNew ? '创建' : '保存'} (${content.length}字符)`;
}

/**
 * 列出工作流中的所有节点（仅显示节点ID、类型和标题）
 * @param {string} name - 工作流名称
 * @returns {string} 节点列表
 */
export function listWorkflowNodes(name) {
    const s = extension_settings[extensionName];
    if (!s || !s.workers) return '❌ 未找到工作流数据。';
    if (!name) return '❌ 请指定工作流名称。';

    if (!(name in s.workers)) {
        const available = Object.keys(s.workers).join(', ');
        return `❌ 工作流 "${name}" 不存在。可用: ${available}`;
    }

    const content = s.workers[name];
    if (!content) return `工作流 "${name}" 内容为空。`;

    let workflow;
    try {
        workflow = JSON.parse(content);
    } catch (e) {
        return `❌ 工作流 "${name}" JSON 解析失败: ${e.message}`;
    }

    if (!workflow || typeof workflow !== 'object') {
        return `❌ 工作流 "${name}" 格式不正确。`;
    }

    const nodeIds = Object.keys(workflow).sort((a, b) => Number(a) - Number(b));

    if (nodeIds.length === 0) {
        return `工作流 "${name}" 中没有节点。`;
    }

    let result = `📋 工作流 "${name}" 的节点列表 (共 ${nodeIds.length} 个节点)：\n`;
    result += '─'.repeat(60) + '\n';

    for (const nodeId of nodeIds) {
        const node = workflow[nodeId];
        const classType = node.class_type || '(未知类型)';
        const title = node._meta?.title || classType;
        result += `  [${nodeId}] ${title} (${classType})\n`;
    }

    return result;
}

/**
 * 读取指定节点的完整信息
 * @param {string} name - 工作流名称
 * @param {string} nodeId - 节点ID
 * @returns {string} 节点详细信息
 */
export function readWorkflowNode(name, nodeId) {
    const s = extension_settings[extensionName];
    if (!s || !s.workers) return '❌ 未找到工作流数据。';
    if (!name) return '❌ 请指定工作流名称。';
    if (!nodeId) return '❌ 请指定节点ID。';

    if (!(name in s.workers)) {
        return `❌ 工作流 "${name}" 不存在。`;
    }

    const content = s.workers[name];
    if (!content) return `❌ 工作流 "${name}" 内容为空。`;

    let workflow;
    try {
        workflow = JSON.parse(content);
    } catch (e) {
        return `❌ 工作流 "${name}" JSON 解析失败: ${e.message}`;
    }

    if (!(nodeId in workflow)) {
        const available = Object.keys(workflow).sort((a, b) => Number(a) - Number(b)).join(', ');
        return `❌ 节点 "${nodeId}" 不存在。可用节点: ${available}`;
    }

    const node = workflow[nodeId];
    const title = node._meta?.title || node.class_type || '(未命名)';

    let result = `🔍 节点 [${nodeId}] ${title} 的详细信息：\n`;
    result += '─'.repeat(60) + '\n';
    result += JSON.stringify(node, null, 2);

    return result;
}

/**
 * 修改指定节点的输入参数
 * @param {string} name - 工作流名称
 * @param {string} nodeId - 节点ID
 * @param {string} inputKey - 输入参数的键名
 * @param {*} value - 新值
 * @returns {string} 操作结果
 */
export function updateWorkflowNodeInput(name, nodeId, inputKey, value) {
    const s = extension_settings[extensionName];
    if (!s || !s.workers) return '❌ 未找到工作流数据。';
    if (!name) return '❌ 请指定工作流名称。';
    if (!nodeId) return '❌ 请指定节点ID。';
    if (!inputKey) return '❌ 请指定输入参数键名。';

    if (!(name in s.workers)) {
        return `❌ 工作流 "${name}" 不存在。`;
    }

    const content = s.workers[name];
    if (!content) return `❌ 工作流 "${name}" 内容为空。`;

    let workflow;
    try {
        workflow = JSON.parse(content);
    } catch (e) {
        return `❌ 工作流 "${name}" JSON 解析失败: ${e.message}`;
    }

    if (!(nodeId in workflow)) {
        return `❌ 节点 "${nodeId}" 不存在。`;
    }

    const node = workflow[nodeId];
    if (!node.inputs) {
        node.inputs = {};
    }

    // 记录修改前的所有 inputs 字段（用于调试）
    const inputKeys = Object.keys(node.inputs);
    const oldValue = node.inputs[inputKey];

    // 只修改指定的字段，保留其他所有字段
    node.inputs[inputKey] = value;

    // 验证其他字段是否被保留
    const preservedKeys = Object.keys(node.inputs);
    const lostKeys = inputKeys.filter(k => !preservedKeys.includes(k));

    // 保存修改后的工作流 - 不使用格式化以保持原始结构
    const newContent = JSON.stringify(workflow);
    s.workers[name] = newContent;

    // 如果修改的是当前工作流，同步更新 worker
    if (s.workerid === name) {
        s.worker = newContent;
    }

    saveSettingsDebounced();

    const title = node._meta?.title || node.class_type || '(未命名)';
    let result = `✅ 已修改节点 [${nodeId}] ${title} 的参数：\n  ${inputKey}: ${JSON.stringify(oldValue)} → ${JSON.stringify(value)}`;

    // 如果有字段丢失，添加警告
    if (lostKeys.length > 0) {
        result += `\n⚠️ 警告：以下字段在修改过程中丢失: ${lostKeys.join(', ')}`;
    }

    // 添加调试信息：显示节点当前的所有字段
    result += `\n📋 节点当前字段: ${preservedKeys.join(', ')}`;

    return result;
}

/**
 * 批量修改多个节点的输入参数
 * @param {string} name - 工作流名称
 * @param {Array<{nodeId: string, inputKey: string, value: any}>} updates - 更新列表
 * @returns {string} 操作结果
 */
export function batchUpdateWorkflowNodes(name, updates) {
    const s = extension_settings[extensionName];
    if (!s || !s.workers) return '❌ 未找到工作流数据。';
    if (!name) return '❌ 请指定工作流名称。';
    if (!Array.isArray(updates) || updates.length === 0) {
        return '❌ 请提供有效的更新列表（数组格式）。';
    }

    if (!(name in s.workers)) {
        return `❌ 工作流 "${name}" 不存在。`;
    }

    const content = s.workers[name];
    if (!content) return `❌ 工作流 "${name}" 内容为空。`;

    let workflow;
    try {
        workflow = JSON.parse(content);
    } catch (e) {
        return `❌ 工作流 "${name}" JSON 解析失败: ${e.message}`;
    }

    const results = [];
    let successCount = 0;
    const warnings = [];

    for (const update of updates) {
        const { nodeId, inputKey, value } = update;

        if (!nodeId || !inputKey) {
            results.push(`⚠️ 跳过无效更新: ${JSON.stringify(update)}`);
            continue;
        }

        if (!(nodeId in workflow)) {
            results.push(`❌ 节点 "${nodeId}" 不存在`);
            continue;
        }

        const node = workflow[nodeId];
        if (!node.inputs) {
            node.inputs = {};
        }

        // 记录修改前的所有 inputs 字段
        const inputKeysBefore = Object.keys(node.inputs);
        const oldValue = node.inputs[inputKey];

        // 只修改指定的字段，保留其他所有字段
        node.inputs[inputKey] = value;

        // 验证其他字段是否被保留
        const inputKeysAfter = Object.keys(node.inputs);
        const lostKeys = inputKeysBefore.filter(k => !inputKeysAfter.includes(k));

        if (lostKeys.length > 0) {
            warnings.push(`⚠️ 节点 [${nodeId}] 丢失字段: ${lostKeys.join(', ')}`);
        }

        const title = node._meta?.title || node.class_type || '(未命名)';
        results.push(`✅ [${nodeId}] ${title}.${inputKey}: ${JSON.stringify(oldValue)} → ${JSON.stringify(value)}`);
        successCount++;
    }

    // 保存修改后的工作流
    const newContent = JSON.stringify(workflow);
    s.workers[name] = newContent;

    // 如果修改的是当前工作流，同步更新 worker
    if (s.workerid === name) {
        s.worker = newContent;
    }

    saveSettingsDebounced();

    let result = `📝 批量修改工作流 "${name}" (成功 ${successCount}/${updates.length})：\n`;
    result += '─'.repeat(60) + '\n';
    result += results.join('\n');

    // 添加警告信息
    if (warnings.length > 0) {
        result += '\n\n' + warnings.join('\n');
    }

    return result;
}

/**
 * 删除指定节点
 * @param {string} name - 工作流名称
 * @param {string} nodeId - 节点ID
 * @returns {string} 操作结果
 */
export function deleteWorkflowNode(name, nodeId) {
    const s = extension_settings[extensionName];
    if (!s || !s.workers) return '❌ 未找到工作流数据。';
    if (!name) return '❌ 请指定工作流名称。';
    if (!nodeId) return '❌ 请指定节点ID。';

    if (!(name in s.workers)) {
        return `❌ 工作流 "${name}" 不存在。`;
    }

    const content = s.workers[name];
    if (!content) return `❌ 工作流 "${name}" 内容为空。`;

    let workflow;
    try {
        workflow = JSON.parse(content);
    } catch (e) {
        return `❌ 工作流 "${name}" JSON 解析失败: ${e.message}`;
    }

    if (!(nodeId in workflow)) {
        return `❌ 节点 "${nodeId}" 不存在。`;
    }

    const node = workflow[nodeId];
    const title = node._meta?.title || node.class_type || '(未命名)';

    delete workflow[nodeId];

    // 保存修改后的工作流
    const newContent = JSON.stringify(workflow);
    s.workers[name] = newContent;

    // 如果修改的是当前工作流，同步更新 worker
    if (s.workerid === name) {
        s.worker = newContent;
    }

    saveSettingsDebounced();

    return `✅ 已删除节点 [${nodeId}] ${title}`;
}

/**
 * 添加新节点到工作流
 * @param {string} name - 工作流名称
 * @param {string} nodeId - 新节点ID
 * @param {object} nodeData - 节点数据
 * @returns {string} 操作结果
 */
export function addWorkflowNode(name, nodeId, nodeData) {
    const s = extension_settings[extensionName];
    if (!s || !s.workers) return '❌ 未找到工作流数据。';
    if (!name) return '❌ 请指定工作流名称。';
    if (!nodeId) return '❌ 请指定节点ID。';
    if (!nodeData || typeof nodeData !== 'object') {
        return '❌ 请提供有效的节点数据（对象格式）。';
    }

    if (!(name in s.workers)) {
        return `❌ 工作流 "${name}" 不存在。`;
    }

    const content = s.workers[name];
    if (!content) return `❌ 工作流 "${name}" 内容为空。`;

    let workflow;
    try {
        workflow = JSON.parse(content);
    } catch (e) {
        return `❌ 工作流 "${name}" JSON 解析失败: ${e.message}`;
    }

    if (nodeId in workflow) {
        return `❌ 节点 "${nodeId}" 已存在，请使用其他ID或先删除现有节点。`;
    }

    workflow[nodeId] = nodeData;

    // 保存修改后的工作流
    const newContent = JSON.stringify(workflow);
    s.workers[name] = newContent;

    // 如果修改的是当前工作流，同步更新 worker
    if (s.workerid === name) {
        s.worker = newContent;
    }

    saveSettingsDebounced();

    const title = nodeData._meta?.title || nodeData.class_type || '(未命名)';
    return `✅ 已添加节点 [${nodeId}] ${title}`;
}
