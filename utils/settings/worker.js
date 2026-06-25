// @ts-nocheck
import { extension_settings } from "../../../../../extensions.js";
import { saveSettingsDebounced } from "../../../../../../script.js";
import { extensionName } from '../config.js';
import { stylInput, stylishConfirm } from '../ui_common.js';

function eidtJSON(obj) {
    for (let key in obj) {
        if (obj.hasOwnProperty(key)) {
            if (typeof obj[key] === 'object' && obj[key] !== null) {
                eidtJSON(obj[key]);
            } else {
                if (key.includes("seed")) { obj[key] = "%seed%"; }
                if (key == "steps") { obj[key] = "%steps%"; }
                if (key == "cfg") { obj[key] = "%cfg_scale%"; }
                if (key == "sampler_name") { obj[key] = "%sampler_name%"; }
                if (key == "width") { obj[key] = "%width%"; }
                if (key == "height") { obj[key] = "%height%"; }
                if (key == "ckpt_name") { obj[key] = "%MODEL_NAME%"; }
                if (key == "positive") { obj[key] = "%prompt%"; }
                if (key == "negative") { obj[key] = "%negative_prompt%"; }
                if (key == "text" && obj[key] == "正面") { obj[key] = "%prompt%"; }
                if (key == "text" && obj[key] == "负面") { obj[key] = "%negative_prompt%"; }
            }
        }
    }
    return obj;
}

export function eidtwork() {
    alert("请在导出时设置为正面提示词“正面”，负面设置为”负面”，情况复杂，不保证可用性。会简易的替换：模型名称、提示词、步数、cfg、采样器、宽度、高度、seed。");
    let el = document.getElementById("worker");
    try {
        let textrejsons = JSON.parse(el.value.trim());
        textrejsons = eidtJSON(textrejsons);
        el.value = JSON.stringify(textrejsons, null, 2);
    } catch (e) {
        alert("请输入正确的json" + e);
    }
}

/**
 * 占位符映射表 - 定义可用的占位符及其匹配规则
 */
const PLACEHOLDER_MAP = [
    { placeholder: '%seed%', label: '种子 (seed)', matchKeys: ['seed'], type: 'number' },
    { placeholder: '%steps%', label: '步数 (steps)', matchKeys: ['steps'], type: 'number' },
    { placeholder: '%cfg_scale%', label: 'CFG (cfg)', matchKeys: ['cfg', 'cfg_scale'], type: 'number' },
    { placeholder: '%sampler_name%', label: '采样器 (sampler)', matchKeys: ['sampler_name', 'sampler'], type: 'string' },
    { placeholder: '%scheduler%', label: '调度器 (scheduler)', matchKeys: ['scheduler'], type: 'string' },
    { placeholder: '%width%', label: '宽度 (width)', matchKeys: ['width'], type: 'number' },
    { placeholder: '%height%', label: '高度 (height)', matchKeys: ['height'], type: 'number' },
    { placeholder: '%prompt%', label: '正面提示词 (prompt)', matchKeys: ['positive', 'text'], type: 'string' },
    { placeholder: '%negative_prompt%', label: '负面提示词 (negative)', matchKeys: ['negative'], type: 'string' },
    { placeholder: '%MODEL_NAME%', label: '模型 (ckpt_name)', matchKeys: ['ckpt_name'], type: 'string' },
    { placeholder: '%vae%', label: 'VAE', matchKeys: ['vae_name', 'vae'], type: 'string' },
    { placeholder: '%clip%', label: 'CLIP', matchKeys: ['clip_name'], type: 'string' },
    { placeholder: '%c_quanzhong%', label: 'IPA权重', matchKeys: ['c_quanzhong'], type: 'number' },
    { placeholder: '%c_idquanzhong%', label: 'FaceID权重', matchKeys: ['c_idquanzhong'], type: 'number' },
    { placeholder: '%c_xijie%', label: '细节强度', matchKeys: ['c_xijie'], type: 'number' },
    { placeholder: '%c_fenwei%', label: '氛围强度', matchKeys: ['c_fenwei'], type: 'number' },
    { placeholder: '%comfyuicankaotupian%', label: '参考图', matchKeys: ['comfyuicankaotupian', 'image'], type: 'string' },
    { placeholder: '%ipa%', label: 'IPA类型', matchKeys: ['ipa'], type: 'string' },
    // 局部重绘占位符
    { placeholder: '%inpaint_image%', label: '重绘原图', matchKeys: ['inpaint_image'], type: 'string' },
    { placeholder: '%inpaint_mask%', label: '重绘遮罩', matchKeys: ['inpaint_mask'], type: 'string' },
    { placeholder: '%inpaint_denoise%', label: '重绘强度', matchKeys: ['inpaint_denoise', 'denoise'], type: 'number' },
    { placeholder: '%inpaint_positive%', label: '重绘正面提示词', matchKeys: ['inpaint_positive'], type: 'string' },
    { placeholder: '%inpaint_negative%', label: '重绘负面提示词', matchKeys: ['inpaint_negative'], type: 'string' },
];

/**
 * 检查节点是否可以被跳过
 * @param {string} nodeId - 节点ID
 * @param {Object} workflow - 工作流对象
 * @param {Array} connections - 连接数组
 * @param {Object} objectInfo - ComfyUI节点类型定义（可选，用于类型匹配验证）
 * @returns {{ canSkip: boolean, reason?: string, supportsTypeMatch?: boolean }}
 */
function checkNodeSkippable(nodeId, workflow, connections, objectInfo = {}) {
    // 找出该节点的所有输入连接
    const inputConnections = connections.filter(c => c.to === nodeId);

    // 过滤掉上游节点已跳过的连接 → 得到有效输入连接
    const validInputConnections = inputConnections.filter(c => {
        const sourceNode = workflow[c.from];
        return sourceNode && !sourceNode._skip;
    });

    // 找出依赖该节点输出的下游连接数
    const outputConnections = connections.filter(c => c.from === nodeId);
    const validOutputConnections = outputConnections.filter(c => {
        const targetNode = workflow[c.to];
        return targetNode && !targetNode._skip;
    });

    // 如果有效输入连接 <= 1，直接可跳过
    if (validInputConnections.length <= 1) {
        return {
            canSkip: true,
            supportsTypeMatch: false
        };
    }

    // 有多个有效输入连接时，检查是否可以通过类型匹配
    const node = workflow[nodeId];
    const hasObjectInfo = objectInfo && Object.keys(objectInfo).length > 0 && node && objectInfo[node.class_type];

    if (hasObjectInfo) {
        // 获取所有输入连接的类型
        const inputTypes = new Set();
        for (const conn of validInputConnections) {
            const sourceNode = workflow[conn.from];
            if (sourceNode) {
                const sourceTypeInfo = objectInfo[sourceNode.class_type];
                if (sourceTypeInfo && sourceTypeInfo.output && sourceTypeInfo.output[conn.fromOutput]) {
                    inputTypes.add(sourceTypeInfo.output[conn.fromOutput]);
                }
            }
        }

        // 如果每个输入连接的类型都不同，可以通过类型匹配跳过
        if (inputTypes.size === validInputConnections.length) {
            return {
                canSkip: true,
                supportsTypeMatch: true,
                reason: `支持类型匹配：${validInputConnections.length} 个不同类型的输入`
            };
        }
    }

    // 不可跳过
    return {
        canSkip: false,
        reason: `此节点有 ${validInputConnections.length} 个输入连接${hasObjectInfo ? '（含相同类型）' : ''}，跳过后无法自动确定连线走向，因此暂不支持跳过`
    };
}

/**
 * 处理跳过节点 - 重映射连接并删除跳过的节点
 * 支持类型匹配：如果节点有多个输入，通过类型匹配找到正确的上游连接
 * @param {Object} workflow - 工作流对象
 * @param {Object} objectInfo - ComfyUI节点类型定义（可选，用于类型匹配）
 * @returns {Object} 处理后的工作流
 */
export function processSkippedNodes(workflow, objectInfo = {}) {
    // 深拷贝工作流以便修改
    const processedWorkflow = JSON.parse(JSON.stringify(workflow));

    // 找出所有被跳过的节点ID
    const skippedNodeIds = Object.keys(processedWorkflow).filter(id => processedWorkflow[id]._skip);

    if (skippedNodeIds.length === 0) {
        // 清理所有节点的 _skip 属性
        for (const nodeId of Object.keys(processedWorkflow)) {
            delete processedWorkflow[nodeId]._skip;
        }
        return processedWorkflow;
    }

    /**
     * 获取节点输出的类型
     * @param {string} nodeId 
     * @param {number} outputIndex 
     * @returns {string|null}
     */
    const getOutputType = (nodeId, outputIndex) => {
        const node = processedWorkflow[nodeId];
        if (!node) return null;
        const nodeTypeInfo = objectInfo[node.class_type];
        if (nodeTypeInfo && nodeTypeInfo.output && nodeTypeInfo.output[outputIndex]) {
            return nodeTypeInfo.output[outputIndex];
        }
        return null;
    };

    /**
     * 获取节点输入期望的类型
     * @param {string} nodeId 
     * @param {string} inputKey 
     * @returns {string|null}
     */
    const getInputType = (nodeId, inputKey) => {
        const node = processedWorkflow[nodeId];
        if (!node) return null;
        const nodeTypeInfo = objectInfo[node.class_type];
        if (!nodeTypeInfo) return null;

        const allInputs = { ...nodeTypeInfo.input?.required, ...nodeTypeInfo.input?.optional };
        const inputDef = allInputs[inputKey];
        if (Array.isArray(inputDef) && inputDef[0]) {
            // 类型可能是字符串或数组
            return typeof inputDef[0] === 'string' ? inputDef[0] : null;
        }
        return null;
    };

    // 构建类型匹配的输入源映射
    // { skippedNodeId: { inputKey: { from, fromOutput, outputType } } }
    const inputSourceMap = {};

    for (const skippedId of skippedNodeIds) {
        const skippedNode = processedWorkflow[skippedId];
        inputSourceMap[skippedId] = {};

        // 收集所有输入连接及其类型信息
        for (const [inputKey, inputValue] of Object.entries(skippedNode.inputs || {})) {
            if (Array.isArray(inputValue) && inputValue.length === 2 && typeof inputValue[0] === 'string') {
                let sourceId = inputValue[0];
                let sourceOutput = inputValue[1];

                // 如果输入源也是被跳过的节点，递归追溯
                const visited = new Set();
                while (skippedNodeIds.includes(sourceId) && !visited.has(sourceId)) {
                    visited.add(sourceId);
                    const sourceNode = processedWorkflow[sourceId];
                    let found = false;
                    // 从被跳过的源节点找对应的输入
                    for (const [srcInputKey, srcInputValue] of Object.entries(sourceNode.inputs || {})) {
                        if (Array.isArray(srcInputValue) && srcInputValue.length === 2 && typeof srcInputValue[0] === 'string') {
                            sourceId = srcInputValue[0];
                            sourceOutput = srcInputValue[1];
                            found = true;
                            break;
                        }
                    }
                    if (!found) break;
                }

                if (!skippedNodeIds.includes(sourceId)) {
                    const outputType = getOutputType(sourceId, sourceOutput);
                    inputSourceMap[skippedId][inputKey] = {
                        from: sourceId,
                        fromOutput: sourceOutput,
                        outputType: outputType
                    };
                }
            }
        }
    }

    // 重映射：更新所有依赖跳过节点的下游节点
    for (const nodeId of Object.keys(processedWorkflow)) {
        if (skippedNodeIds.includes(nodeId)) continue;

        const node = processedWorkflow[nodeId];
        for (const [inputKey, inputValue] of Object.entries(node.inputs || {})) {
            if (Array.isArray(inputValue) && inputValue.length === 2 && typeof inputValue[0] === 'string') {
                let sourceId = inputValue[0];
                const sourceOutput = inputValue[1];

                if (skippedNodeIds.includes(sourceId)) {
                    // 输入来自被跳过的节点，需要重映射
                    const skipNodeSources = inputSourceMap[sourceId];

                    if (skipNodeSources && Object.keys(skipNodeSources).length > 0) {
                        // 获取当前输入期望的类型
                        const expectedType = getInputType(nodeId, inputKey);

                        // 尝试类型匹配
                        let bestMatch = null;

                        for (const [srcKey, srcInfo] of Object.entries(skipNodeSources)) {
                            if (expectedType && srcInfo.outputType && srcInfo.outputType === expectedType) {
                                // 找到类型匹配
                                bestMatch = srcInfo;
                                break;
                            }
                        }

                        // 如果没有类型匹配，使用第一个有效的输入
                        if (!bestMatch) {
                            const firstSource = Object.values(skipNodeSources)[0];
                            if (firstSource) {
                                bestMatch = firstSource;
                            }
                        }

                        if (bestMatch) {
                            node.inputs[inputKey] = [bestMatch.from, bestMatch.fromOutput];
                        }
                    }
                }
            }
        }
    }

    // 删除跳过的节点
    for (const skippedId of skippedNodeIds) {
        delete processedWorkflow[skippedId];
    }

    // 清理剩余节点的 _skip 属性
    for (const nodeId of Object.keys(processedWorkflow)) {
        delete processedWorkflow[nodeId]._skip;
    }

    return processedWorkflow;
}

/**
 * 根据属性名获取推荐的占位符
 */
function getRecommendedPlaceholder(inputName) {
    const lowerName = inputName.toLowerCase();
    for (const item of PLACEHOLDER_MAP) {
        for (const key of item.matchKeys) {
            if (lowerName === key.toLowerCase() || lowerName.includes(key.toLowerCase())) {
                return item.placeholder;
            }
        }
    }
    return null;
}

/**
 * 创建带占位符按钮的输入控件包裹器
 * @param {HTMLElement} inputElement - 输入控件元素
 * @param {string} inputName - 输入名称
 * @param {Function} onChange - 值变化回调
 * @param {string} defaultValue - 清除占位符时使用的默认值（可选）
 */
function wrapWithPlaceholderButton(inputElement, inputName, onChange, defaultValue = '') {
    const wrapper = document.createElement('div');
    wrapper.className = 'st-chatu8-workflow-viz-input-wrapper';

    wrapper.appendChild(inputElement);

    // 创建占位符按钮
    const placeholderBtn = document.createElement('button');
    placeholderBtn.type = 'button';
    placeholderBtn.className = 'st-chatu8-placeholder-btn';
    placeholderBtn.innerHTML = '<i class="fa-solid fa-code"></i>';
    placeholderBtn.title = '替换为占位符';

    const recommendedPlaceholder = getRecommendedPlaceholder(inputName);

    placeholderBtn.onclick = (e) => {
        e.stopPropagation();
        showPlaceholderMenu(e.target.closest('button'), inputElement, inputName, recommendedPlaceholder, onChange, defaultValue);
    };

    wrapper.appendChild(placeholderBtn);

    return wrapper;
}

/**
 * 显示占位符选择菜单
 */
function showPlaceholderMenu(buttonElement, inputElement, inputName, recommendedPlaceholder, onChange, defaultValue = '') {
    if (!buttonElement) return;

    // 移除已存在的菜单
    const existingMenu = document.querySelector('.st-chatu8-placeholder-menu');
    if (existingMenu) existingMenu.remove();

    const menu = document.createElement('div');
    menu.className = 'st-chatu8-placeholder-menu';

    PLACEHOLDER_MAP.forEach(item => {
        const menuItem = document.createElement('div');
        menuItem.className = 'st-chatu8-placeholder-menu-item';
        if (item.placeholder === recommendedPlaceholder) {
            menuItem.classList.add('recommended');
        }

        menuItem.innerHTML = `
            <span class="placeholder-code">${item.placeholder}</span>
            <span class="placeholder-label">${item.label}</span>
        `;

        menuItem.onclick = () => {
            const wrapper = inputElement.closest('.st-chatu8-workflow-viz-input-wrapper');

            // 对于数字输入框和下拉框，需要替换为文本输入框才能显示占位符字符串
            if (inputElement.tagName === 'SELECT' ||
                (inputElement.tagName === 'INPUT' && inputElement.type === 'number')) {
                // 创建新的文本输入框替换原元素
                const newInput = document.createElement('input');
                newInput.type = 'text';
                newInput.value = item.placeholder;
                newInput.className = inputElement.className;
                newInput.onchange = () => onChange(newInput.value);

                // 替换元素
                if (wrapper) {
                    wrapper.replaceChild(newInput, inputElement);
                    // 更新 inputElement 引用，以便后续操作
                    inputElement = newInput;
                } else {
                    inputElement.parentNode.replaceChild(newInput, inputElement);
                }
            } else if (inputElement.tagName === 'INPUT' || inputElement.tagName === 'TEXTAREA') {
                inputElement.value = item.placeholder;
            }

            onChange(item.placeholder);
            menu.remove();
        };

        menu.appendChild(menuItem);
    });

    // 添加"清除占位符"选项
    const clearItem = document.createElement('div');
    clearItem.className = 'st-chatu8-placeholder-menu-item st-chatu8-placeholder-clear';
    clearItem.innerHTML = `
        <span class="placeholder-code" style="color: #e74c3c;">🗑️ 清除占位符</span>
        <span class="placeholder-label">恢复为默认值${defaultValue ? ': ' + defaultValue : ''}</span>
    `;
    clearItem.onclick = () => {
        // 清除占位符，使用默认值更新工作流数据
        if (inputElement.tagName === 'INPUT' || inputElement.tagName === 'TEXTAREA') {
            inputElement.value = defaultValue;
            onChange(defaultValue);
        }
        menu.remove();
    };
    menu.appendChild(clearItem);

    // 定位菜单 - 确保不溢出屏幕
    const btnRect = buttonElement.getBoundingClientRect();
    const menuWidth = 220; // 菜单预估宽度
    const menuHeight = 350; // 菜单预估高度

    let left = btnRect.left;
    let top = btnRect.bottom + 5;

    // 检查右侧是否溢出
    if (left + menuWidth > window.innerWidth) {
        left = window.innerWidth - menuWidth - 10;
    }
    // 确保不会溢出左侧
    if (left < 10) {
        left = 10;
    }
    // 检查底部是否溢出，如果溢出则显示在按钮上方
    if (top + menuHeight > window.innerHeight) {
        top = btnRect.top - menuHeight - 5;
        if (top < 10) top = 10; // 确保不会溢出顶部
    }

    menu.style.position = 'fixed';
    menu.style.top = `${top}px`;
    menu.style.left = `${left}px`;
    menu.style.maxWidth = `${window.innerWidth - 20}px`; // 移动端限制最大宽度

    document.body.appendChild(menu);

    // 点击外部关闭菜单
    const closeHandler = (e) => {
        if (!menu.contains(e.target) && e.target !== buttonElement) {
            menu.remove();
            document.removeEventListener('click', closeHandler);
        }
    };
    setTimeout(() => document.addEventListener('click', closeHandler), 0);
}

function worker_change() {
    const settings = extension_settings[extensionName];
    const worker = document.getElementById("worker");
    const selectElement = document.getElementById("workerid");
    settings["workerid"] = selectElement.value;
    settings.worker = settings.workers[settings.workerid];
    saveSettingsDebounced();

    worker.value = settings["workers"][settings["workerid"]];
    $(worker).trigger('input');
}

function worker_new() {
    const settings = extension_settings[extensionName];
    stylInput("请输入新工作流预设的名称").then((newName) => {
        if (newName && newName.trim() !== '') {
            if (settings.workers.hasOwnProperty(newName)) {
                alert("该名称已存在，请换一个名称。");
                return;
            }
            const selectElement = document.getElementById("workerid");
            let newOption = new Option(newName, newName);
            newOption.title = newName;
            selectElement.add(newOption);
            
            const editSelectElement = document.getElementById("editWorkerid");
            if (editSelectElement) {
                let editOption = new Option(newName, newName);
                editOption.title = newName;
                editSelectElement.add(editOption);
            }

            selectElement.value = newName;
            settings.workerid = newName;
            settings.workers[newName] = "";
            settings.worker = "";
            const worker = document.getElementById("worker");
            worker.value = "";
            saveSettingsDebounced();
            toastr.success(`已创建空预设 "${newName}"`);
        }
    });
}

function worker_rename() {
    const settings = extension_settings[extensionName];
    const currentName = settings.workerid;
    if (['默认', '默认人物一致', '面部细化', '新版默认', '默认-独立VAE', '新weilin-vae'].includes(currentName) || !settings.workers[currentName]) {
        alert("默认预设或不存在的预设不能重命名。");
        return;
    }
    
    stylInput("请输入新的工作流预设名称", currentName).then((newName) => {
        if (newName && newName.trim() !== '' && newName !== currentName) {
            if (settings.workers.hasOwnProperty(newName)) {
                alert("该名称已存在，请换一个名称。");
                return;
            }
            
            settings.workers[newName] = settings.workers[currentName];
            delete settings.workers[currentName];
            
            settings.workerid = newName;
            
            // 如果修图预设选中的也是这个，同步更新
            if (settings.editWorkerid === currentName) {
                settings.editWorkerid = newName;
            }

            saveSettingsDebounced();
            try {
                if (typeof window.loadSilterTavernChatu8Settings === 'function') {
                    window.loadSilterTavernChatu8Settings();
                }
            } catch (error) {
                console.warn('Failed to refresh UI after renaming preset:', error);
            }
            toastr.success(`工作流已重命名为 "${newName}"`);
        }
    });
}

function worker_save() {
    const settings = extension_settings[extensionName];
    stylInput("请输入配置名称").then((result) => {
        if (result) {
            const worker = document.getElementById("worker");
            const selectElement = document.getElementById("workerid");
            let newOption = new Option(result, result);
            newOption.title = result;

            if (!settings.workers.hasOwnProperty(result)) {
                selectElement.add(newOption);
            }
            selectElement.value = result;
            settings.workerid = result;
            settings.workers[result] = worker.value;
            settings.worker = worker.value;
            saveSettingsDebounced();
        }
    });
}

function worker_delete() {
    const settings = extension_settings[extensionName];
    stylishConfirm("是否确定删除").then((result) => {
        if (result) {
            const worker = document.getElementById("worker");
            const selectElement = document.getElementById("workerid");
            const valueToDelete = selectElement.value;
            if (valueToDelete === "默认" || valueToDelete === "默认人物一致" || valueToDelete === "面部细化") {
                alert("默认配置不能删除");
                return;
            }
            Reflect.deleteProperty(settings["workers"], valueToDelete);
            selectElement.remove(selectElement.selectedIndex);
            selectElement.value = "默认";
            settings.workerid = "默认";
            settings.worker = settings["workers"][settings["workerid"]];
            worker.value = settings["workers"][settings["workerid"]];
            saveSettingsDebounced();
        }
    });
}

function worker_update() {
    const settings = extension_settings[extensionName];
    const presetName = settings.workerid;

    if (!presetName || !settings.workers[presetName]) {
        alert("没有活动的工作流可保存。请先“另存为”一个新工作流。");
        return;
    }

    if (['默认', '默认人物一致', '面部细化'].includes(presetName)) {
        alert(`默认工作流 "${presetName}" 不能被修改。请使用“另存为”创建一个副本。`);
        return;
    }

    stylishConfirm(`确定要覆盖当前工作流 "${presetName}" 吗？`).then(confirmed => {
        if (confirmed) {
            const workerValue = document.getElementById("worker").value;
            settings.workers[presetName] = workerValue;
            if (settings.workerid === presetName) {
                settings.worker = workerValue;
            }
            saveSettingsDebounced();
            // alert(`工作流 "${presetName}" 已更新。`);
        }
    });
}

function worker_export_current() {
    const settings = extension_settings[extensionName];
    const selectedId = settings.workerid;
    if (!selectedId || !settings.workers[selectedId]) {
        alert("没有选中的工作流可导出。");
        return;
    }
    const dataToExport = { [selectedId]: settings.workers[selectedId] };
    const dataStr = JSON.stringify(dataToExport, null, 2);
    const blob = new Blob([dataStr], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `st-chatu8-workflow-${selectedId}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

function worker_export_all() {
    const settings = extension_settings[extensionName];
    if (!settings.workers || Object.keys(settings.workers).length === 0) {
        alert("没有工作流可导出。");
        return;
    }
    const dataStr = JSON.stringify(settings.workers, null, 2);
    const blob = new Blob([dataStr], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "st-chatu8-workflows-all.json";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

/**
 * 检测是否为ComfyUI完整工作流格式（包含UI信息，不支持导入）
 * 完整格式: { "nodes": [...], "links": [...], "id": "...", ... }
 */
function isComfyUIFullWorkflow(data) {
    if (typeof data !== 'object' || data === null || Array.isArray(data)) {
        return false;
    }

    // 检测完整工作流格式（包含 UI 信息）
    // 特征：包含 nodes 数组，且 nodes 中的元素有 type 字段
    if (data.hasOwnProperty('nodes') && Array.isArray(data.nodes)) {
        if (data.nodes.length > 0 && data.nodes.some(node => node && node.type)) {
            return true;
        }
    }

    return false;
}

/**
 * 检测是否为原始ComfyUI API工作流格式（支持导入）
 * API格式: { "1": { "class_type": "...", "inputs": {...} }, "2": {...} }
 * 配置文件格式: { "工作流名称": "JSON字符串" } 或 { "工作流名称": {...} }
 */
function isRawComfyUIWorkflow(data) {
    if (typeof data !== 'object' || data === null || Array.isArray(data)) {
        return false;
    }

    const keys = Object.keys(data);
    if (keys.length === 0) {
        return false;
    }

    // 检查是否所有顶层键的值都是对象且包含 class_type 字段
    // 这是原始ComfyUI API工作流的特征
    let hasClassType = false;
    for (const key of keys) {
        const value = data[key];
        if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
            if (value.hasOwnProperty('class_type')) {
                hasClassType = true;
            }
        } else if (typeof value === 'string') {
            // 如果值是字符串，说明是配置文件格式
            return false;
        }
    }

    return hasClassType;
}

async function worker_import() {
    const settings = extension_settings[extensionName];
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.onchange = async e => {
        const file = e.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = async readerEvent => {
            try {
                const importedData = JSON.parse(readerEvent.target.result);

                // 先检测是否为完整工作流格式（不支持）
                if (isComfyUIFullWorkflow(importedData)) {
                    alert("检测到ComfyUI完整工作流格式（包含UI信息）。\n\n请在ComfyUI中打开此工作流，然后导出为API格式后再导入。\n\n");
                    return;
                }

                // 检测是否为原始ComfyUI API工作流
                if (isRawComfyUIWorkflow(importedData)) {
                    // 原始工作流 - 让用户命名
                    const defaultName = file.name.replace(/\.json$/i, '') || '导入的工作流';
                    const workflowName = await stylInput(`检测到原始ComfyUI API工作流，请为其命名：`, defaultName);

                    if (workflowName && workflowName.trim()) {
                        const name = workflowName.trim();
                        const workflowData = JSON.stringify(importedData, null, 2);

                        const isNew = !settings.workers.hasOwnProperty(name);
                        settings.workers[name] = workflowData;

                        // 更新工作流预设下拉选择框
                        const selectElement = document.getElementById("workerid");
                        if (selectElement && isNew) {
                            const newOption = new Option(name, name);
                            newOption.title = name;
                            selectElement.add(newOption);
                        }
                        selectElement.value = name;
                        settings.workerid = name;
                        settings.worker = workflowData;

                        // 同时更新修图预设下拉选择框
                        const editSelectElement = document.getElementById("editWorkerid");
                        if (editSelectElement && isNew) {
                            const editOption = new Option(name, name);
                            editOption.title = name;
                            editSelectElement.add(editOption);
                        }

                        // 更新工作流文本框
                        const workerTextarea = document.getElementById("worker");
                        if (workerTextarea) {
                            workerTextarea.value = workflowData;
                        }

                        saveSettingsDebounced();
                        alert(`成功导入原始ComfyUI工作流，已保存为: "${name}"`);
                    } else {
                        alert("导入已取消。");
                    }
                } else {
                    // 配置文件格式 - 原有逻辑
                    let newWorkflowsCount = 0;
                    const selectElement = document.getElementById("workerid");
                    const editSelectElement = document.getElementById("editWorkerid");

                    for (const key in importedData) {
                        if (importedData.hasOwnProperty(key)) {
                            const workflowData = typeof importedData[key] === 'string'
                                ? importedData[key]
                                : JSON.stringify(importedData[key], null, 2);

                            const isNew = !settings.workers.hasOwnProperty(key);
                            if (isNew) {
                                newWorkflowsCount++;
                                // 添加到工作流预设下拉列表
                                if (selectElement) {
                                    const newOption = new Option(key, key);
                                    newOption.title = key;
                                    selectElement.add(newOption);
                                }
                                // 同时添加到修图预设下拉列表
                                if (editSelectElement) {
                                    const editOption = new Option(key, key);
                                    editOption.title = key;
                                    editSelectElement.add(editOption);
                                }
                            }
                            settings.workers[key] = workflowData;
                        }
                    }
                    saveSettingsDebounced();
                    //loadSettingsIntoUI();
                    alert(`成功导入 ${Object.keys(importedData).length} 个工作流，其中 ${newWorkflowsCount} 个是全新的。`);
                }
            } catch (err) {
                alert("导入失败，请确保文件是正确的JSON格式。");
                console.error("Error importing workflows:", err);
            }
        };
        reader.readAsText(file);
    };
    input.click();
}

/**
 * 渲染节点属性面板
 * @param {HTMLElement} panel - 属性面板容器
 * @param {Object} node - 节点数据
 * @param {Object} workflow - 工作流对象（用于修改）
 * @param {Object} objectInfo - ComfyUI 节点类型定义
 * @param {Array} connections - 连接数组
 * @param {Function} onUpdate - 更新回调
 * @param {Function} onSkipChange - 跳过状态变化回调
 */
function renderNodeProperties(panel, node, workflow, objectInfo, connections, onUpdate, onSkipChange) {
    const nodeTypeInfo = objectInfo[node.classType] || {};
    const inputDefs = nodeTypeInfo.input || {};
    const requiredInputs = inputDefs.required || {};
    const optionalInputs = inputDefs.optional || {};

    const displayName = node.meta.title || node.classType;

    // 检查节点是否可以被跳过（使用objectInfo进行类型匹配验证）
    const skipCheck = checkNodeSkippable(node.id, workflow, connections, objectInfo);
    const isSkipped = workflow[node.id]._skip === true;

    panel.innerHTML = `
        <div class="st-chatu8-workflow-viz-properties-header">
            <h4>${displayName}</h4>
            <span class="node-id">#${node.id} · ${node.classType}</span>
        </div>
        <div class="st-chatu8-workflow-viz-skip-section" id="viz-skip-section"></div>
        <div class="st-chatu8-workflow-viz-properties-content" id="viz-properties-inputs"></div>
    `;

    // 渲染跳过开关区域
    const skipSection = panel.querySelector('#viz-skip-section');
    const skipGroup = document.createElement('div');
    skipGroup.className = 'st-chatu8-workflow-viz-skip-group';

    const skipLabel = document.createElement('label');
    skipLabel.className = 'st-chatu8-workflow-viz-skip-label';

    const skipCheckbox = document.createElement('input');
    skipCheckbox.type = 'checkbox';
    skipCheckbox.checked = isSkipped;
    skipCheckbox.disabled = !skipCheck.canSkip && !isSkipped; // 如果不可跳过且当前未跳过，则禁用

    const skipText = document.createElement('span');
    skipText.textContent = '跳过此节点';

    skipLabel.appendChild(skipCheckbox);
    skipLabel.appendChild(skipText);
    skipGroup.appendChild(skipLabel);

    // 显示跳过状态说明
    const skipStatus = document.createElement('div');
    skipStatus.className = 'st-chatu8-workflow-viz-skip-status';

    if (!skipCheck.canSkip && !isSkipped) {
        skipStatus.className += ' not-skippable';
        skipStatus.innerHTML = `<i class="fa-solid fa-circle-info"></i> ${skipCheck.reason}`;
    } else if (isSkipped) {
        skipStatus.className += ' skipped';
        const typeMatchNote = skipCheck.supportsTypeMatch ? '（类型匹配）' : '';
        skipStatus.innerHTML = `<i class="fa-solid fa-forward"></i> 节点将被跳过，执行时将重映射连接${typeMatchNote}`;
    } else if (skipCheck.supportsTypeMatch) {
        skipStatus.className += ' can-skip type-match';
        skipStatus.innerHTML = `<i class="fa-solid fa-check-double"></i> ${skipCheck.reason}`;
    } else {
        skipStatus.className += ' can-skip';
        skipStatus.innerHTML = '<i class="fa-solid fa-check"></i> 可以跳过';
    }

    skipGroup.appendChild(skipStatus);
    skipSection.appendChild(skipGroup);

    // 跳过开关事件
    skipCheckbox.onchange = () => {
        workflow[node.id]._skip = skipCheckbox.checked;
        if (onSkipChange) onSkipChange(node.id, skipCheckbox.checked);
        if (onUpdate) onUpdate();
        // 重新渲染以更新状态显示
        renderNodeProperties(panel, node, workflow, objectInfo, connections, onUpdate, onSkipChange);
    };

    const inputsContainer = panel.querySelector('#viz-properties-inputs');

    // 渲染所有输入
    const allInputDefs = { ...requiredInputs, ...optionalInputs };

    for (const [inputName, inputDef] of Object.entries(allInputDefs)) {
        const currentValue = node.inputs[inputName];
        const isConnection = Array.isArray(currentValue) && currentValue.length === 2 && typeof currentValue[0] === 'string';

        const group = document.createElement('div');
        group.className = 'st-chatu8-workflow-viz-property-group';

        const label = document.createElement('label');
        label.textContent = inputName;
        if (isConnection) {
            const badge = document.createElement('span');
            badge.className = 'connection-badge';
            badge.textContent = '连接';
            label.appendChild(badge);
        }
        group.appendChild(label);

        if (isConnection) {
            // 显示连接信息（不可编辑）
            const connectionDisplay = document.createElement('div');
            connectionDisplay.className = 'connection-display';
            connectionDisplay.textContent = `← 节点 #${currentValue[0]} 输出 ${currentValue[1]}`;
            group.appendChild(connectionDisplay);
        } else {
            // 根据输入类型渲染对应控件
            const control = createInputControl(inputName, inputDef, currentValue, (newValue) => {
                workflow[node.id].inputs[inputName] = newValue;
                node.inputs[inputName] = newValue;
                if (onUpdate) onUpdate();
            });
            group.appendChild(control);
        }

        inputsContainer.appendChild(group);
    }

    // 如果没有输入定义，显示当前值
    if (Object.keys(allInputDefs).length === 0 && Object.keys(node.inputs).length > 0) {
        for (const [inputName, currentValue] of Object.entries(node.inputs)) {
            const isConnection = Array.isArray(currentValue) && currentValue.length === 2 && typeof currentValue[0] === 'string';

            const group = document.createElement('div');
            group.className = 'st-chatu8-workflow-viz-property-group';

            const label = document.createElement('label');
            label.textContent = inputName;
            if (isConnection) {
                const badge = document.createElement('span');
                badge.className = 'connection-badge';
                badge.textContent = '连接';
                label.appendChild(badge);
            }
            group.appendChild(label);

            if (isConnection) {
                const connectionDisplay = document.createElement('div');
                connectionDisplay.className = 'connection-display';
                connectionDisplay.textContent = `← 节点 #${currentValue[0]} 输出 ${currentValue[1]}`;
                group.appendChild(connectionDisplay);
            } else {
                // 没有类型定义时，根据值类型推断控件
                const control = createInputControlByValue(inputName, currentValue, (newValue) => {
                    workflow[node.id].inputs[inputName] = newValue;
                    node.inputs[inputName] = newValue;
                    if (onUpdate) onUpdate();
                });
                group.appendChild(control);
            }

            inputsContainer.appendChild(group);
        }
    }
}

/**
 * 检测值是否为占位符字符串
 */
function isPlaceholderValue(value) {
    if (typeof value !== 'string') return false;
    return value.startsWith('%') && value.endsWith('%');
}

/**
 * 根据输入定义创建控件
 */
function createInputControl(inputName, inputDef, currentValue, onChange) {
    // inputDef 格式: [类型, 配置] 或 [[选项数组], 配置]
    const typeInfo = Array.isArray(inputDef) ? inputDef[0] : inputDef;
    const config = Array.isArray(inputDef) && inputDef[1] ? inputDef[1] : {};

    // 如果当前值是占位符，优先使用文本输入框
    if (isPlaceholderValue(currentValue)) {
        const textInput = document.createElement('input');
        textInput.type = 'text';
        textInput.value = currentValue;
        textInput.onchange = () => onChange(textInput.value);
        return wrapWithPlaceholderButton(textInput, inputName, onChange);
    }

    // 如果是数组，说明是枚举选项
    if (Array.isArray(typeInfo)) {
        const select = document.createElement('select');
        let hasMatch = false;
        typeInfo.forEach(option => {
            const opt = document.createElement('option');
            opt.value = option;
            opt.textContent = option;
            if (option === currentValue) {
                opt.selected = true;
                hasMatch = true;
            }
            select.appendChild(opt);
        });

        // 如果当前值为空或不在选项列表中，自动选中第一个选项并更新数据
        if (!hasMatch && typeInfo.length > 0) {
            select.value = typeInfo[0];
            // 延迟调用 onChange，确保控件已添加到 DOM
            setTimeout(() => onChange(typeInfo[0]), 0);
        }

        select.onchange = () => onChange(select.value);
        // 传递第一个选项作为清除占位符时的默认值
        const defaultVal = typeInfo.length > 0 ? typeInfo[0] : '';
        return wrapWithPlaceholderButton(select, inputName, onChange, defaultVal);
    }

    // 根据类型名称创建控件
    switch (typeInfo) {
        case 'INT':
            const intInput = document.createElement('input');
            intInput.type = 'number';
            intInput.step = '1';
            intInput.value = currentValue ?? config.default ?? 0;
            if (config.min !== undefined) intInput.min = config.min;
            if (config.max !== undefined) intInput.max = config.max;
            intInput.onchange = () => onChange(parseInt(intInput.value, 10));
            return wrapWithPlaceholderButton(intInput, inputName, onChange);

        case 'FLOAT':
            const floatInput = document.createElement('input');
            floatInput.type = 'number';
            floatInput.step = config.step || '0.01';
            floatInput.value = currentValue ?? config.default ?? 0;
            if (config.min !== undefined) floatInput.min = config.min;
            if (config.max !== undefined) floatInput.max = config.max;
            floatInput.onchange = () => onChange(parseFloat(floatInput.value));
            return wrapWithPlaceholderButton(floatInput, inputName, onChange);

        case 'BOOLEAN':
            const checkWrapper = document.createElement('div');
            checkWrapper.className = 'checkbox-wrapper';
            const checkbox = document.createElement('input');
            checkbox.type = 'checkbox';
            checkbox.checked = currentValue ?? config.default ?? false;
            checkbox.onchange = () => onChange(checkbox.checked);
            checkWrapper.appendChild(checkbox);
            const checkLabel = document.createElement('span');
            checkLabel.textContent = checkbox.checked ? '是' : '否';
            checkbox.onchange = () => {
                onChange(checkbox.checked);
                checkLabel.textContent = checkbox.checked ? '是' : '否';
            };
            checkWrapper.appendChild(checkLabel);
            return checkWrapper;

        case 'STRING':
            if (config.multiline) {
                const textarea = document.createElement('textarea');
                textarea.value = currentValue ?? config.default ?? '';
                textarea.onchange = () => onChange(textarea.value);
                return wrapWithPlaceholderButton(textarea, inputName, onChange);
            } else {
                const textInput = document.createElement('input');
                textInput.type = 'text';
                textInput.value = currentValue ?? config.default ?? '';
                textInput.onchange = () => onChange(textInput.value);
                return wrapWithPlaceholderButton(textInput, inputName, onChange);
            }

        default:
            // 默认作为字符串处理
            return createInputControlByValue(inputName, currentValue, onChange);
    }
}

/**
 * 根据值类型推断控件
 */
function createInputControlByValue(inputName, currentValue, onChange) {
    if (typeof currentValue === 'boolean') {
        const checkWrapper = document.createElement('div');
        checkWrapper.className = 'checkbox-wrapper';
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.checked = currentValue;
        const checkLabel = document.createElement('span');
        checkLabel.textContent = checkbox.checked ? '是' : '否';
        checkbox.onchange = () => {
            onChange(checkbox.checked);
            checkLabel.textContent = checkbox.checked ? '是' : '否';
        };
        checkWrapper.appendChild(checkbox);
        checkWrapper.appendChild(checkLabel);
        return checkWrapper;
    } else if (typeof currentValue === 'number') {
        const numInput = document.createElement('input');
        numInput.type = 'number';
        numInput.step = Number.isInteger(currentValue) ? '1' : '0.01';
        numInput.value = currentValue;
        numInput.onchange = () => onChange(Number.isInteger(currentValue) ? parseInt(numInput.value, 10) : parseFloat(numInput.value));
        return wrapWithPlaceholderButton(numInput, inputName, onChange);
    } else {
        // 字符串或其他
        const strValue = String(currentValue ?? '');
        if (strValue.length > 50 || strValue.includes('\n')) {
            const textarea = document.createElement('textarea');
            textarea.value = strValue;
            textarea.onchange = () => onChange(textarea.value);
            return wrapWithPlaceholderButton(textarea, inputName, onChange);
        } else {
            const textInput = document.createElement('input');
            textInput.type = 'text';
            textInput.value = strValue;
            textInput.onchange = () => onChange(textInput.value);
            return wrapWithPlaceholderButton(textInput, inputName, onChange);
        }
    }
}

/**
 * 可视化工作流 - 将 ComfyUI 工作流以节点图的形式展示
 */
export async function visualizeWorkflow() {
    const settings = extension_settings[extensionName];
    const workerEl = document.getElementById("worker");
    if (!workerEl || !workerEl.value.trim()) {
        alert("没有工作流可以可视化。请先输入或选择一个工作流。");
        return;
    }

    let workflow;
    try {
        workflow = JSON.parse(workerEl.value.trim());
    } catch (e) {
        alert("工作流 JSON 格式不正确: " + e.message);
        return;
    }

    // 创建可视化弹窗
    const backdrop = document.createElement('div');
    backdrop.className = 'st-chatu8-workflow-viz-backdrop';
    backdrop.innerHTML = `
        <div class="st-chatu8-workflow-viz-dialog">
            <div class="st-chatu8-workflow-viz-header">
                <h3>工作流可视化</h3>
                <span class="st-chatu8-workflow-viz-close">&times;</span>
            </div>
            <div class="st-chatu8-workflow-viz-toolbar">
                <button class="st-chatu8-btn" id="viz-zoom-in"><i class="fa-solid fa-magnifying-glass-plus"></i></button>
                <button class="st-chatu8-btn" id="viz-zoom-out"><i class="fa-solid fa-magnifying-glass-minus"></i></button>
                <button class="st-chatu8-btn" id="viz-zoom-reset"><i class="fa-solid fa-expand"></i> 重置</button>
                <button class="st-chatu8-btn" id="viz-save-workflow"><i class="fa-solid fa-save"></i> 保存修改</button>
                <span class="st-chatu8-workflow-viz-stats"></span>
            </div>
            <div class="st-chatu8-workflow-viz-body">
                <div class="st-chatu8-workflow-viz-container">
                    <div class="st-chatu8-workflow-viz-svg-wrapper">
                        <svg class="st-chatu8-workflow-viz-svg"></svg>
                    </div>
                </div>
                <div class="st-chatu8-workflow-viz-properties" id="viz-properties-panel">
                    <div class="st-chatu8-workflow-viz-properties-placeholder">
                        <i class="fa-solid fa-mouse-pointer"></i>
                        <p>点击节点查看属性</p>
                    </div>
                </div>
            </div>
        </div>
    `;
    document.body.appendChild(backdrop);

    const closeBtn = backdrop.querySelector('.st-chatu8-workflow-viz-close');
    const container = backdrop.querySelector('.st-chatu8-workflow-viz-container');
    const svgWrapper = backdrop.querySelector('.st-chatu8-workflow-viz-svg-wrapper');
    const svg = backdrop.querySelector('.st-chatu8-workflow-viz-svg');
    const statsEl = backdrop.querySelector('.st-chatu8-workflow-viz-stats');
    const propertiesPanel = backdrop.querySelector('#viz-properties-panel');

    // 获取缓存的 objectInfo
    const { getComfyuiCache } = await import('../configDatabase.js');
    const objectInfo = await getComfyuiCache('objectinfo') || {};

    // 当前选中的节点
    let selectedNodeId = null;
    let hasModifications = false;

    // 关闭按钮
    closeBtn.onclick = () => backdrop.remove();

    // 移动端属性面板显示/隐藏逻辑
    const isMobile = window.innerWidth <= 768;

    // 移动端添加关闭按钮的函数（每次渲染后调用）
    const addMobileCloseButton = () => {
        if (!isMobile) return;
        // 移除已存在的关闭按钮
        const existing = propertiesPanel.querySelector('.st-chatu8-workflow-viz-properties-close-mobile');
        if (existing) existing.remove();

        const mobileCloseBtn = document.createElement('span');
        mobileCloseBtn.className = 'st-chatu8-workflow-viz-properties-close-mobile';
        mobileCloseBtn.innerHTML = '&times;';
        mobileCloseBtn.onclick = (e) => {
            e.stopPropagation();
            propertiesPanel.classList.remove('visible');
        };
        propertiesPanel.insertBefore(mobileCloseBtn, propertiesPanel.firstChild);
    };

    const togglePropertiesPanel = (forceShow = null) => {
        if (!isMobile) return;
        if (forceShow !== null) {
            propertiesPanel.classList.toggle('visible', forceShow);
        } else {
            propertiesPanel.classList.toggle('visible');
        }
    };

    // 解析节点
    const nodes = [];
    const nodeMap = {};
    const connections = [];

    for (const nodeId in workflow) {
        if (workflow.hasOwnProperty(nodeId)) {
            const nodeData = workflow[nodeId];
            const node = {
                id: nodeId,
                classType: nodeData.class_type || '未知',
                inputs: nodeData.inputs || {},
                meta: nodeData._meta || {}
            };
            nodes.push(node);
            nodeMap[nodeId] = node;
        }
    }

    // 提取连接关系
    for (const node of nodes) {
        for (const inputKey in node.inputs) {
            const inputValue = node.inputs[inputKey];
            // ComfyUI 连接格式: [源节点ID, 输出索引]
            if (Array.isArray(inputValue) && inputValue.length === 2 && typeof inputValue[0] === 'string') {
                connections.push({
                    from: inputValue[0],
                    fromOutput: inputValue[1],
                    to: node.id,
                    toInput: inputKey
                });
            }
        }
    }

    // 更新统计信息
    statsEl.textContent = `节点: ${nodes.length} | 连接: ${connections.length}`;

    // 布局计算 - 使用简单的分层布局
    const nodeWidth = 180;
    const nodeHeight = 60;
    const horizontalGap = 80;
    const verticalGap = 30;

    // 计算节点层级 (拓扑排序)
    const inDegree = {};
    const levels = {};

    nodes.forEach(n => { inDegree[n.id] = 0; });
    connections.forEach(c => {
        if (inDegree[c.to] !== undefined) inDegree[c.to]++;
    });

    // BFS 分层
    let queue = nodes.filter(n => inDegree[n.id] === 0).map(n => n.id);
    let level = 0;
    const processed = new Set();

    while (queue.length > 0) {
        const nextQueue = [];
        for (const nodeId of queue) {
            if (processed.has(nodeId)) continue;
            processed.add(nodeId);
            levels[nodeId] = level;

            connections.filter(c => c.from === nodeId).forEach(c => {
                if (!processed.has(c.to)) {
                    nextQueue.push(c.to);
                }
            });
        }
        queue = nextQueue;
        level++;
    }

    // 未处理的节点放在最后一层
    nodes.forEach(n => {
        if (levels[n.id] === undefined) {
            levels[n.id] = level;
        }
    });

    // 按层级分组
    const levelGroups = {};
    nodes.forEach(n => {
        const l = levels[n.id];
        if (!levelGroups[l]) levelGroups[l] = [];
        levelGroups[l].push(n);
    });

    // 计算位置
    const positions = {};
    let maxX = 0, maxY = 0;

    Object.keys(levelGroups).sort((a, b) => a - b).forEach(l => {
        const levelNodes = levelGroups[l];
        const x = parseInt(l) * (nodeWidth + horizontalGap) + 50;
        levelNodes.forEach((n, i) => {
            const y = i * (nodeHeight + verticalGap) + 50;
            positions[n.id] = { x, y };
            maxX = Math.max(maxX, x + nodeWidth);
            maxY = Math.max(maxY, y + nodeHeight);
        });
    });

    // 设置 SVG 大小
    const svgWidth = maxX + 100;
    const svgHeight = maxY + 100;
    svg.setAttribute('width', svgWidth);
    svg.setAttribute('height', svgHeight);
    svg.setAttribute('viewBox', `0 0 ${svgWidth} ${svgHeight}`);

    // 定义颜色映射
    const classColors = {};
    const colorPalette = ['#4a90e2', '#50c878', '#f5a623', '#d0021b', '#9b59b6', '#3498db', '#e74c3c', '#2ecc71', '#f39c12', '#1abc9c'];
    let colorIndex = 0;
    const getClassColor = (classType) => {
        if (!classColors[classType]) {
            classColors[classType] = colorPalette[colorIndex % colorPalette.length];
            colorIndex++;
        }
        return classColors[classType];
    };

    // 绘制连接线
    const defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
    defs.innerHTML = `
        <marker id="arrowhead" markerWidth="10" markerHeight="7" refX="10" refY="3.5" orient="auto">
            <polygon points="0 0, 10 3.5, 0 7" fill="#888" />
        </marker>
    `;
    svg.appendChild(defs);

    connections.forEach(conn => {
        const fromPos = positions[conn.from];
        const toPos = positions[conn.to];
        if (!fromPos || !toPos) return;

        const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        const startX = fromPos.x + nodeWidth;
        const startY = fromPos.y + nodeHeight / 2;
        const endX = toPos.x;
        const endY = toPos.y + nodeHeight / 2;
        const ctrlOffset = Math.abs(endX - startX) / 2;

        path.setAttribute('d', `M ${startX} ${startY} C ${startX + ctrlOffset} ${startY}, ${endX - ctrlOffset} ${endY}, ${endX} ${endY}`);
        path.setAttribute('stroke', '#666');
        path.setAttribute('stroke-width', '2');
        path.setAttribute('fill', 'none');
        path.setAttribute('marker-end', 'url(#arrowhead)');
        path.classList.add('st-chatu8-workflow-viz-connection');
        svg.appendChild(path);
    });

    // 绘制节点
    nodes.forEach(node => {
        const pos = positions[node.id];
        if (!pos) return;

        const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        g.classList.add('st-chatu8-workflow-viz-node');
        g.setAttribute('transform', `translate(${pos.x}, ${pos.y})`);

        // 检查是否被跳过
        const isSkipped = workflow[node.id]._skip === true;
        if (isSkipped) {
            g.classList.add('skipped');
        }

        const color = getClassColor(node.classType);

        // 节点背景
        const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
        rect.setAttribute('width', nodeWidth);
        rect.setAttribute('height', nodeHeight);
        rect.setAttribute('rx', '8');
        rect.setAttribute('fill', isSkipped ? '#1a1a2e' : '#2a2a3e');
        rect.setAttribute('stroke', color);
        rect.setAttribute('stroke-width', '2');
        rect.setAttribute('stroke-dasharray', isSkipped ? '5,5' : 'none');
        g.appendChild(rect);

        // 节点 ID
        const idText = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        idText.setAttribute('x', '10');
        idText.setAttribute('y', '18');
        idText.setAttribute('fill', '#aaa');
        idText.setAttribute('font-size', '11');
        idText.textContent = `#${node.id}`;
        g.appendChild(idText);

        // 节点类型
        const typeText = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        typeText.setAttribute('x', '10');
        typeText.setAttribute('y', '38');
        typeText.setAttribute('fill', color);
        typeText.setAttribute('font-size', '13');
        typeText.setAttribute('font-weight', 'bold');
        const displayName = node.meta.title || node.classType;
        typeText.textContent = displayName.length > 20 ? displayName.substring(0, 18) + '...' : displayName;
        g.appendChild(typeText);

        // 显示输入数量
        const inputCount = Object.keys(node.inputs).length;
        const inputText = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        inputText.setAttribute('x', '10');
        inputText.setAttribute('y', '54');
        inputText.setAttribute('fill', '#777');
        inputText.setAttribute('font-size', '10');
        inputText.textContent = `输入: ${inputCount}`;
        g.appendChild(inputText);

        // 鼠标悬停显示详情
        const title = document.createElementNS('http://www.w3.org/2000/svg', 'title');
        const inputDetails = Object.entries(node.inputs)
            .map(([k, v]) => `  ${k}: ${Array.isArray(v) ? `[${v[0]}:${v[1]}]` : JSON.stringify(v).substring(0, 30)}`)
            .join('\n');
        title.textContent = `节点 #${node.id}\n类型: ${node.classType}\n标题: ${node.meta.title || '无'}\n\n输入:\n${inputDetails || '  无'}`;
        g.appendChild(title);

        // 节点点击事件 - 显示属性面板
        g.setAttribute('data-node-id', node.id);
        g.onclick = (e) => {
            e.stopPropagation();

            // 移除之前选中的节点样式
            svg.querySelectorAll('.st-chatu8-workflow-viz-node.selected').forEach(el => {
                el.classList.remove('selected');
            });

            // 选中当前节点
            g.classList.add('selected');
            selectedNodeId = node.id;

            // 渲染属性面板
            renderNodeProperties(propertiesPanel, node, workflow, objectInfo, connections, () => {
                hasModifications = true;
            }, (nodeId, skipped) => {
                // 更新节点视觉样式
                const nodeEl = svg.querySelector(`[data-node-id="${nodeId}"]`);
                if (nodeEl) {
                    if (skipped) {
                        nodeEl.classList.add('skipped');
                        const nodeRect = nodeEl.querySelector('rect');
                        if (nodeRect) {
                            nodeRect.setAttribute('fill', '#1a1a2e');
                            nodeRect.setAttribute('stroke-dasharray', '5,5');
                        }
                    } else {
                        nodeEl.classList.remove('skipped');
                        const nodeRect = nodeEl.querySelector('rect');
                        if (nodeRect) {
                            nodeRect.setAttribute('fill', '#2a2a3e');
                            nodeRect.setAttribute('stroke-dasharray', 'none');
                        }
                    }
                }
                hasModifications = true;
            });

            // 移动端添加关闭按钮并展开属性面板
            addMobileCloseButton();
            togglePropertiesPanel(true);
        };

        svg.appendChild(g);
    });

    // 缩放控制
    let scale = 1;
    const baseSvgWidth = svgWidth;
    const baseSvgHeight = svgHeight;
    const updateScale = () => {
        svg.style.transform = `scale(${scale})`;
        svg.style.transformOrigin = 'top left';
        // 更新wrapper尺寸以触发滚动条
        svgWrapper.style.width = `${baseSvgWidth * scale}px`;
        svgWrapper.style.height = `${baseSvgHeight * scale}px`;
    };
    // 初始化wrapper尺寸
    svgWrapper.style.width = `${baseSvgWidth}px`;
    svgWrapper.style.height = `${baseSvgHeight}px`;

    backdrop.querySelector('#viz-zoom-in').onclick = () => { scale = Math.min(scale + 0.2, 3); updateScale(); };
    backdrop.querySelector('#viz-zoom-out').onclick = () => { scale = Math.max(scale - 0.2, 0.3); updateScale(); };
    backdrop.querySelector('#viz-zoom-reset').onclick = () => { scale = 1; updateScale(); container.scrollTop = 0; container.scrollLeft = 0; };

    // 拖动平移功能
    let isDragging = false;
    let dragStartX = 0;
    let dragStartY = 0;
    let scrollStartX = 0;
    let scrollStartY = 0;

    container.addEventListener('mousedown', (e) => {
        // 如果点击的不是节点，则启用拖动
        const clickedNode = e.target.closest('.st-chatu8-workflow-viz-node');
        if (!clickedNode) {
            isDragging = true;
            dragStartX = e.clientX;
            dragStartY = e.clientY;
            scrollStartX = container.scrollLeft;
            scrollStartY = container.scrollTop;
            container.style.cursor = 'grabbing';
            e.preventDefault();
        }
    });

    container.addEventListener('mousemove', (e) => {
        if (!isDragging) return;
        const dx = e.clientX - dragStartX;
        const dy = e.clientY - dragStartY;
        container.scrollLeft = scrollStartX - dx;
        container.scrollTop = scrollStartY - dy;
    });

    container.addEventListener('mouseup', () => {
        if (isDragging) {
            isDragging = false;
            container.style.cursor = 'grab';
        }
    });

    container.addEventListener('mouseleave', () => {
        if (isDragging) {
            isDragging = false;
            container.style.cursor = 'grab';
        }
    });

    // 触摸设备支持
    let touchStartX = 0;
    let touchStartY = 0;
    let touchScrollStartX = 0;
    let touchScrollStartY = 0;

    container.addEventListener('touchstart', (e) => {
        if (e.touches.length === 1) {
            const touch = e.touches[0];
            touchStartX = touch.clientX;
            touchStartY = touch.clientY;
            touchScrollStartX = container.scrollLeft;
            touchScrollStartY = container.scrollTop;
        }
    }, { passive: true });

    container.addEventListener('touchmove', (e) => {
        if (e.touches.length === 1) {
            const touch = e.touches[0];
            const dx = touch.clientX - touchStartX;
            const dy = touch.clientY - touchStartY;
            container.scrollLeft = touchScrollStartX - dx;
            container.scrollTop = touchScrollStartY - dy;
        }
    }, { passive: true });

    // 保存按钮 - 直接保存到当前预设（保留跳过标记，执行时再处理）
    backdrop.querySelector('#viz-save-workflow').onclick = async () => {
        try {
            const skippedCount = Object.values(workflow).filter(n => n._skip).length;
            const workflowJson = JSON.stringify(workflow, null, 2);
            workerEl.value = workflowJson;
            $(workerEl).trigger('input');

            const presetName = settings.workerid;

            // 如果是默认预设，弹出另存为对话框
            if (!presetName || ['默认', '默认人物一致', '面部细化'].includes(presetName)) {
                const newName = await stylInput("默认工作流不能被修改，请输入新的配置名称：");
                if (newName && newName.trim()) {
                    const name = newName.trim();
                    const selectElement = document.getElementById("workerid");

                    if (!settings.workers.hasOwnProperty(name)) {
                        const newOption = new Option(name, name);
                        newOption.title = name;
                        selectElement.add(newOption);
                    }
                    selectElement.value = name;
                    settings.workerid = name;
                    settings.workers[name] = workflowJson;
                    settings.worker = workflowJson;
                    saveSettingsDebounced();
                    hasModifications = false;
                    if (skippedCount > 0) {
                        toastr.success(`工作流已保存为 "${name}"（含 ${skippedCount} 个跳过节点，执行时生效）`);
                    } else {
                        toastr.success(`工作流已保存为 "${name}"`);
                    }
                }
            } else {
                // 直接保存到当前预设
                settings.workers[presetName] = workflowJson;
                settings.worker = workflowJson;
                saveSettingsDebounced();
                hasModifications = false;
                if (skippedCount > 0) {
                    toastr.success(`工作流 "${presetName}" 已保存（含 ${skippedCount} 个跳过节点，执行时生效）`);
                } else {
                    toastr.success(`工作流 "${presetName}" 已保存`);
                }
            }
        } catch (e) {
            alert('保存失败: ' + e.message);
        }
    };
}

// ==================== 修图预设管理函数 ====================

function editWorker_change() {
    const settings = extension_settings[extensionName];
    const editWorker = document.getElementById("editWorker");
    const selectElement = document.getElementById("editWorkerid");
    settings["editWorkerid"] = selectElement.value;
    settings.editWorker = settings.workers[settings.editWorkerid];
    saveSettingsDebounced();

    editWorker.value = settings["workers"][settings["editWorkerid"]];
    $(editWorker).trigger('input');
}

function editWorker_new() {
    const settings = extension_settings[extensionName];
    stylInput("请输入新修图工作流预设的名称").then((newName) => {
        if (newName && newName.trim() !== '') {
            if (settings.workers.hasOwnProperty(newName)) {
                alert("该名称已存在，请换一个名称。");
                return;
            }
            const selectElement = document.getElementById("editWorkerid");
            let newOption = new Option(newName, newName);
            newOption.title = newName;
            selectElement.add(newOption);
            
            const workerSelectElement = document.getElementById("workerid");
            if (workerSelectElement) {
                let workerOption = new Option(newName, newName);
                workerOption.title = newName;
                workerSelectElement.add(workerOption);
            }

            selectElement.value = newName;
            settings.editWorkerid = newName;
            settings.workers[newName] = "";
            settings.editWorker = "";
            const editWorker = document.getElementById("editWorker");
            editWorker.value = "";
            saveSettingsDebounced();
            toastr.success(`已创建空预设 "${newName}"`);
        }
    });
}

function editWorker_rename() {
    const settings = extension_settings[extensionName];
    const currentName = settings.editWorkerid;
    if (['默认', '默认人物一致', '面部细化', '新版默认', '默认-独立VAE', '新weilin-vae'].includes(currentName) || !settings.workers[currentName]) {
        alert("默认预设或不存在的预设不能重命名。");
        return;
    }
    
    stylInput("请输入新的修图工作流预设名称", currentName).then((newName) => {
        if (newName && newName.trim() !== '' && newName !== currentName) {
            if (settings.workers.hasOwnProperty(newName)) {
                alert("该名称已存在，请换一个名称。");
                return;
            }
            
            settings.workers[newName] = settings.workers[currentName];
            delete settings.workers[currentName];
            
            settings.editWorkerid = newName;
            
            // 如果主预设选中的也是这个，同步更新
            if (settings.workerid === currentName) {
                settings.workerid = newName;
            }

            saveSettingsDebounced();
            try {
                if (typeof window.loadSilterTavernChatu8Settings === 'function') {
                    window.loadSilterTavernChatu8Settings();
                }
            } catch (error) {
                console.warn('Failed to refresh UI after renaming preset:', error);
            }
            toastr.success(`修图工作流已重命名为 "${newName}"`);
        }
    });
}

function editWorker_save() {
    const settings = extension_settings[extensionName];
    stylInput("请输入配置名称").then((result) => {
        if (result) {
            const editWorker = document.getElementById("editWorker");
            const selectElement = document.getElementById("editWorkerid");
            const workerSelectElement = document.getElementById("workerid");
            let newOption = new Option(result, result);
            newOption.title = result;

            if (!settings.workers.hasOwnProperty(result)) {
                selectElement.add(newOption);
                // 同时更新主工作流选择器
                if (workerSelectElement) {
                    let workerOption = new Option(result, result);
                    workerOption.title = result;
                    workerSelectElement.add(workerOption);
                }
            }
            selectElement.value = result;
            settings.editWorkerid = result;
            settings.workers[result] = editWorker.value;
            settings.editWorker = editWorker.value;
            saveSettingsDebounced();
        }
    });
}

function editWorker_delete() {
    const settings = extension_settings[extensionName];
    stylishConfirm("是否确定删除").then((result) => {
        if (result) {
            const editWorker = document.getElementById("editWorker");
            const selectElement = document.getElementById("editWorkerid");
            const workerSelectElement = document.getElementById("workerid");
            const valueToDelete = selectElement.value;

            if (valueToDelete === "默认" || valueToDelete === "默认人物一致" || valueToDelete === "面部细化" ||
                valueToDelete === "新版默认" || valueToDelete === "默认-独立VAE" || valueToDelete === "新weilin-vae") {
                alert("默认配置不能删除");
                return;
            }

            // 检查主工作流是否也在使用
            if (settings.workerid === valueToDelete) {
                if (!confirm(`主工作流也在使用 "${valueToDelete}"，删除后将重置为默认工作流。是否继续？`)) {
                    return;
                }
                settings.workerid = "新版默认";
                settings.worker = settings.workers["新版默认"];
                if (workerSelectElement) {
                    workerSelectElement.value = "新版默认";
                    const workerTextarea = document.getElementById("worker");
                    if (workerTextarea) {
                        workerTextarea.value = settings.workers["新版默认"];
                    }
                }
            }

            Reflect.deleteProperty(settings["workers"], valueToDelete);

            // 从两个选择器中移除
            selectElement.remove(selectElement.selectedIndex);
            if (workerSelectElement) {
                for (let i = 0; i < workerSelectElement.options.length; i++) {
                    if (workerSelectElement.options[i].value === valueToDelete) {
                        workerSelectElement.remove(i);
                        break;
                    }
                }
            }

            selectElement.value = "新版默认";
            settings.editWorkerid = "新版默认";
            settings.editWorker = settings["workers"][settings["editWorkerid"]];
            editWorker.value = settings["workers"][settings["editWorkerid"]];
            saveSettingsDebounced();
        }
    });
}

function editWorker_update() {
    const settings = extension_settings[extensionName];
    const presetName = settings.editWorkerid;

    if (!presetName || !settings.workers[presetName]) {
        alert("没有活动的工作流可保存。请先\"另存为\"一个新工作流。");
        return;
    }

    if (['默认', '默认人物一致', '面部细化', '新版默认', '默认-独立VAE', '新weilin-vae'].includes(presetName)) {
        alert(`默认工作流 "${presetName}" 不能被修改。请使用\"另存为\"创建一个副本。`);
        return;
    }

    stylishConfirm(`确定要覆盖当前工作流 "${presetName}" 吗？`).then(confirmed => {
        if (confirmed) {
            const editWorkerValue = document.getElementById("editWorker").value;
            settings.workers[presetName] = editWorkerValue;
            if (settings.editWorkerid === presetName) {
                settings.editWorker = editWorkerValue;
            }
            // 如果主工作流也在使用这个预设，同步更新
            if (settings.workerid === presetName) {
                settings.worker = editWorkerValue;
                const workerTextarea = document.getElementById("worker");
                if (workerTextarea) {
                    workerTextarea.value = editWorkerValue;
                }
            }
            saveSettingsDebounced();
        }
    });
}

function editWorker_export_current() {
    const settings = extension_settings[extensionName];
    const selectedId = settings.editWorkerid;
    if (!selectedId || !settings.workers[selectedId]) {
        alert("没有选中的工作流可导出。");
        return;
    }
    const dataToExport = { [selectedId]: settings.workers[selectedId] };
    const dataStr = JSON.stringify(dataToExport, null, 2);
    const blob = new Blob([dataStr], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `st-chatu8-edit-workflow-${selectedId}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

function editWorker_export_all() {
    worker_export_all(); // 直接调用现有函数，因为共享同一个 workers 对象
}

async function editWorker_import() {
    const settings = extension_settings[extensionName];
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.onchange = async e => {
        const file = e.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = async readerEvent => {
            try {
                const importedData = JSON.parse(readerEvent.target.result);

                // 先检测是否为完整工作流格式（不支持）
                if (isComfyUIFullWorkflow(importedData)) {
                    alert("检测到ComfyUI完整工作流格式（包含UI信息）。\n\n请在ComfyUI中打开此工作流，然后使用 \"Save (API Format)\" 导出为API格式后再导入。\n\n提示：在ComfyUI界面中右键点击空白处，选择 \"Save (API Format)\" 即可导出API格式的工作流。");
                    return;
                }

                if (isRawComfyUIWorkflow(importedData)) {
                    const defaultName = file.name.replace(/\.json$/i, '') || '导入的修图工作流';
                    const workflowName = await stylInput(`检测到原始ComfyUI API工作流，请为其命名：`, defaultName);

                    if (workflowName && workflowName.trim()) {
                        const name = workflowName.trim();
                        const workflowData = JSON.stringify(importedData, null, 2);

                        const isNew = !settings.workers.hasOwnProperty(name);
                        settings.workers[name] = workflowData;

                        // 更新修图预设下拉选择框
                        const selectElement = document.getElementById("editWorkerid");
                        const workerSelectElement = document.getElementById("workerid");
                        if (selectElement && isNew) {
                            const newOption = new Option(name, name);
                            newOption.title = name;
                            selectElement.add(newOption);
                            // 同时更新主工作流选择器
                            if (workerSelectElement) {
                                const workerOption = new Option(name, name);
                                workerOption.title = name;
                                workerSelectElement.add(workerOption);
                            }
                        }
                        selectElement.value = name;
                        settings.editWorkerid = name;
                        settings.editWorker = workflowData;

                        // 更新修图工作流文本框
                        const editWorkerTextarea = document.getElementById("editWorker");
                        if (editWorkerTextarea) {
                            editWorkerTextarea.value = workflowData;
                        }

                        saveSettingsDebounced();
                        alert(`成功导入原始ComfyUI工作流，已保存为: "${name}"`);
                    } else {
                        alert("导入已取消。");
                    }
                } else {
                    // 配置文件格式
                    let newWorkflowsCount = 0;
                    const selectElement = document.getElementById("editWorkerid");
                    const workerSelectElement = document.getElementById("workerid");
                    for (const key in importedData) {
                        if (importedData.hasOwnProperty(key)) {
                            const workflowData = typeof importedData[key] === 'string'
                                ? importedData[key]
                                : JSON.stringify(importedData[key], null, 2);

                            const isNew = !settings.workers.hasOwnProperty(key);
                            if (isNew) {
                                newWorkflowsCount++;
                                if (selectElement) {
                                    const newOption = new Option(key, key);
                                    newOption.title = key;
                                    selectElement.add(newOption);
                                }
                                // 同时更新主工作流选择器
                                if (workerSelectElement) {
                                    const workerOption = new Option(key, key);
                                    workerOption.title = key;
                                    workerSelectElement.add(workerOption);
                                }
                            }
                            settings.workers[key] = workflowData;
                        }
                    }
                    saveSettingsDebounced();
                    alert(`成功导入 ${Object.keys(importedData).length} 个工作流，其中 ${newWorkflowsCount} 个是全新的。`);
                }
            } catch (err) {
                alert("导入失败，请确保文件是正确的JSON格式。");
                console.error("Error importing workflows:", err);
            }
        };
        reader.readAsText(file);
    };
    input.click();
}

// ==================== 事件绑定 ====================

export function initWorkerControls(settingsModal) {
    // 主工作流控件绑定
    settingsModal.find('#eidtwork').on('click', eidtwork);
    settingsModal.find('#visualize_workflow').on('click', visualizeWorkflow);
    settingsModal.find('#workerid').on('change', worker_change);
    settingsModal.find('#worker_new').on('click', worker_new);
    settingsModal.find('#worker_rename').on('click', worker_rename);
    settingsModal.find('#worker_update_style').on('click', worker_update);
    settingsModal.find('#worker_save_style').on('click', worker_save);
    settingsModal.find('#worker_delete_style').on('click', worker_delete);
    settingsModal.find('#worker_export_current').on('click', worker_export_current);
    settingsModal.find('#worker_export_all').on('click', worker_export_all);
    settingsModal.find('#worker_import').on('click', worker_import);

    // 修图预设控件绑定
    settingsModal.find('#editWorkerid').on('change', editWorker_change);
    settingsModal.find('#edit_worker_new').on('click', editWorker_new);
    settingsModal.find('#edit_worker_rename').on('click', editWorker_rename);
    settingsModal.find('#edit_worker_save_style').on('click', editWorker_save);
    settingsModal.find('#edit_worker_delete_style').on('click', editWorker_delete);
    settingsModal.find('#edit_worker_update_style').on('click', editWorker_update);
    settingsModal.find('#edit_worker_export_current').on('click', editWorker_export_current);
    settingsModal.find('#edit_worker_export_all').on('click', editWorker_export_all);
    settingsModal.find('#edit_worker_import').on('click', editWorker_import);

    // 修图预设简易修改按钮
    settingsModal.find('#eidtEditWork').on('click', () => {
        const el = document.getElementById("editWorker");
        try {
            let textrejsons = JSON.parse(el.value.trim());
            textrejsons = eidtJSON(textrejsons);
            el.value = JSON.stringify(textrejsons, null, 2);
        } catch (e) {
            alert("请输入正确的json: " + e);
        }
    });

    // 修图预设可视化按钮
    settingsModal.find('#visualize_edit_workflow').on('click', () => {
        const settings = extension_settings[extensionName];
        // 临时切换到修图工作流进行可视化
        const originalWorker = settings.worker;
        const originalWorkerId = settings.workerid;

        settings.worker = settings.editWorker;
        settings.workerid = settings.editWorkerid;

        // 触发可视化（复用现有功能）
        visualizeWorkflow();

        // 恢复原始工作流
        setTimeout(() => {
            settings.worker = originalWorker;
            settings.workerid = originalWorkerId;
        }, 100);
    });
}
