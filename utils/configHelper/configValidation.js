/* eslint-disable no-undef */
// @ts-nocheck
import { extension_settings } from "../../../../../extensions.js";
import { extensionName } from '../config.js';
import { saveSettingsDebounced } from "../../../../../../script.js";
import { getLog } from '../utils.js';
import { refreshAffectedUI } from './configUIRefresh.js';

/**
 * 获取当前的全局配置（便于 AI 读取所有设置，包括 API Key 等，以便全面排错）
 * @returns {Object} 包含当前所有参数键值对的对象
 */
export function getExposedSettings() {
    const rawSettings = extension_settings[extensionName];
    if (!rawSettings) return {};

    // 深度拷贝以防直接修改影响内存对象
    const safeSettings = JSON.parse(JSON.stringify(rawSettings));

    // （可选）为了防止上下文过长，可以剔除一些过长且基本没用的嵌套缓存数据发给 AI
    // 避免Token浪费，其余所有的 API key、token 都原样保留给 AI 读取
    delete safeSettings.themes;
    delete safeSettings.fabThemes;

    // comfyuiCache 和 sdCache 已迁移到 configDatabase，不再存在于 settings 中

    return safeSettings;
}

/**
 * 接收 AI 的修改要求以局部覆盖现有的 Settings
 * @param {Object} newSettings - 要修改的键值对的对象，例如 {"comfyuiUrl": "http://127.0.0.1:8188", "novelaiApi": "123456"}
 * @returns {boolean} 是否成功应用了至少一项修改
 */
export function updateSettingSafely(newSettings) {
    if (!newSettings || typeof newSettings !== 'object') return false;

    const currentSettings = extension_settings[extensionName];
    if (!currentSettings) return false;

    let isModified = false;

    for (const [key, value] of Object.entries(newSettings)) {
        // 只要此配置项属于已知参数 (存在于原设置中) 就允许覆盖（包括 API Key、Token 等）
        // 如果你需要允许 AI 创建全新字段，也可以移除这个 check，但这通常不推荐
        if (Object.prototype.hasOwnProperty.call(currentSettings, key)) {
            currentSettings[key] = value;
            isModified = true;
            console.log(`[AI Config Helper] 已将配置 [${key}] 修改为:`, value);
        } else {
            console.warn(`[AI Config Helper] 警告：AI 尝试修改未知或不存在的字段 [${key}]，已忽略。`);
        }
    }

    if (isModified) {
        // 通知主系统去保存到硬盘 (SillyTavern 原生方法)
        saveSettingsDebounced();

        // 触发 UI 重载事件（可以在其他模块中监听该事件以即时刷新UI控件）
        document.dispatchEvent(new CustomEvent('st-chatu8-config-updated', { detail: { changed: newSettings } }));

        // 智能刷新 UI（只刷新受影响的部分，避免丢失用户正在编辑的内容）
        refreshAffectedUI(newSettings);

        return true;
    }

    return false;
}

/**
 * 便捷的 AI 诊断打包接口，供底层或其他模块自动抓取并发给大语言模型进行报错分析
 * @param {number} maxLogLines 保留的最近报错日志行数，避免 Token 爆炸
 * @returns {string} 可直接提供给大模型的环境报告 JSON/文本
 */
export function getAiDiagnosticPackage(maxLogLines = 150) {
    const settings = getExposedSettings();
    let currentLogs = "";

    try {
        currentLogs = getLog() || "";
    } catch (e) {
        currentLogs = "无法获取日志: " + e.message;
    }

    const logArray = currentLogs.split('\n');
    const recentLogs = logArray.slice(Math.max(logArray.length - maxLogLines, 0)).join('\n');

    const diagPackage = `========== AI 诊断包裹 ==========
请基于以下状态来进行诊断、逻辑排错或建议修改参数。

【当前插件设置数据 (Settings/Config)】
${JSON.stringify(settings, null, 2)}

【近期运行日志流 (Recent Logs)】
${recentLogs}
=================================`;

    return diagPackage;
}

/**
 * 专门为 AI 提供"大块设置（比如包含所有的工作流对象等）"的可用键列表
 * AI 可以拿到所有的顶层键名（哪怕是不在 ConfigDescriptions 白名单里的复杂对象），并尝试去查询它们内部的字段
 * @returns {Array<string>} 现有的所有配置根节点名称
 */
export function getDetailedConfigKeys() {
    const rawSettings = extension_settings[extensionName];
    if (!rawSettings) return [];

    // 返回所有键名，包括 yushe, workers 等
    return Object.keys(rawSettings);
}

/**
 * 专门给 AI 用来查询某一个特定设置里完整详细数据的方法
 * @param {string} key - 需要查询的配置项根键，如 "workers" 或 "yushe" 或其他未在白名单里的键
 * @returns {string} 压缩后的 JSON 字符串，如果是对象或者数组
 */
export function getSpecificConfigData(key) {
    const rawSettings = extension_settings[extensionName];
    if (!rawSettings || !(key in rawSettings)) {
        return `[获取失败] 所有的设置中不存在键名为: ${key} 的数据。`;
    }

    const data = rawSettings[key];

    if (typeof data === 'object' && data !== null) {
        // AI 在查看具体对象的全部数据，提供 JSON 表达
        try {
            return JSON.stringify(data);
        } catch (e) {
            return `[获取失败] 该数据无法转换为 JSON: ${e.message}`;
        }
    }

    return String(data);
}

/**
 * 部分关键配置参数的可选值列表，方便 AI 提示用户可以选择哪些值。
 */
export const ConfigOptions = {
    mode: {
        desc: '图像生成后端',
        options: ['comfyui', 'novelai', 'sd', 'banana']
    },
    novelaimode: {
        desc: 'NovelAI 模型版本',
        options: [
            'nai-diffusion-4-5-full',
            'nai-diffusion-4-5-curated',
            'nai-diffusion-3',
            'nai-diffusion-furry-3'
        ]
    },
    novelai_sampler: {
        desc: 'NovelAI 采样器',
        options: ['k_euler', 'k_euler_ancestral',
            'k_dpmpp_2s_ancestral', 'k_dpmpp_2m',
            'k_dpmpp_sde', 'ddim_v3']
    },
    Schedule: {
        desc: 'NovelAI 调度器',
        options: ['native', 'karras', 'exponential',
            'polyexponential']
    },
    imageAlignment: {
        desc: '图片对齐方式',
        options: ['left', 'center', 'right']
    },
    imageSizeScale: {
        desc: '图片显示大小',
        options: ['100', '75', '50', '25']
    },
    displayMode: {
        desc: '图片显示模式',
        options: ['默认', '大图', '缩略图']
    },
};

/**
 * 检查当前必要配置是否已完成
 * @returns {string} 配置状态报告
 */
export function checkRequiredConfigs() {
    const s = extension_settings[extensionName];
    if (!s) return '❌ 插件配置尚未初始化。';

    const results = [];
    const mode = s.mode || 'comfyui';

    // 通用必配项
    results.push({
        name: '生图后端 (mode)',
        ok: ['comfyui', 'novelai', 'sd', 'banana'].includes(mode),
        value: mode
    });
    results.push({
        name: '插件已启用 (scriptEnabled)',
        ok: s.scriptEnabled === true || s.scriptEnabled === 'true',
        value: String(s.scriptEnabled)
    });

    // 根据 mode 检查对应后端配置
    if (mode === 'comfyui') {
        results.push({
            name: 'ComfyUI 地址',
            ok: !!s.comfyuiUrl && s.comfyuiUrl !== '',
            value: s.comfyuiUrl || '(未填)'
        });
    } else if (mode === 'sd') {
        results.push({
            name: 'SD WebUI 地址',
            ok: !!s.sdUrl && s.sdUrl !== '',
            value: s.sdUrl || '(未填)'
        });
    } else if (mode === 'novelai') {
        results.push({
            name: 'NovelAI API Key',
            ok: !!s.novelaiApi && s.novelaiApi !== '000000',
            value: s.novelaiApi ? '(已配置)' : '(未填)'
        });
    } else if (mode === 'banana') {
        const b = s.banana || {};
        results.push({
            name: 'Banana API 地址',
            ok: !!b.apiUrl,
            value: b.apiUrl || '(未填)'
        });
        results.push({
            name: 'Banana API Key',
            ok: !!b.apiKey && b.apiKey !== '123456',
            value: b.apiKey ? '(已配置)' : '(未填)'
        });
    }

    // LLM 配置检查
    const llmProfile = s.llm_profiles?.[s.current_llm_profile || '默认'];
    if (llmProfile) {
        results.push({
            name: 'LLM API 地址',
            ok: !!llmProfile.api_url,
            value: llmProfile.api_url || '(未填)'
        });
        results.push({
            name: 'LLM API Key',
            ok: !!llmProfile.api_key,
            value: llmProfile.api_key ? '(已配置)' : '(未填)'
        });
        results.push({
            name: 'LLM 模型',
            ok: !!llmProfile.model,
            value: llmProfile.model || '(未选择)'
        });
    }

    // 格式化输出
    let report = '📋 必要配置检查报告:\n';
    for (const r of results) {
        const icon = r.ok ? '✅' : '❌';
        report += `${icon} ${r.name}: ${r.value}\n`;
    }

    const allOk = results.every(r => r.ok);
    if (allOk) {
        report += '\n🎉 所有必要配置已完成！';
    } else {
        const missing = results.filter(r => !r.ok)
            .map(r => r.name).join(', ');
        report += `\n⚠️ 仍需配置: ${missing}`;
    }

    return report;
}
