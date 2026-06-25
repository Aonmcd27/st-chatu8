/**
 * AI 提示词知识模块注册中心 - 模块索引
 * 
 * 每个模块包含：
 * - name: 模块显示名称
 * - summary: 一句话摘要（会出现在主提示词中，让 AI 知道何时需要加载此模块）
 * - commands: 该模块可用的所有 SystemQuery 命令文档
 * - knowledge: 业务知识（页面功能说明、概念解释等）
 * - workflow: 引导流程（操作步骤指南）
 * - errorGuide: 常见错误和处理方法
 */

import { regexModule } from './regexModule.js';
import { mainSettingsModule } from './mainSettingsModule.js';
import { comfyuiWorkflowModule } from './comfyuiWorkflowModule.js';
import { sdSettingsModule } from './sdSettingsModule.js';
import { novelaiSettingsModule } from './novelaiSettingsModule.js';
import { comfyuiSettingsModule } from './comfyuiSettingsModule.js';
import { bananaSettingsModule } from './bananaSettingsModule.js';
import { llmSettingsModule } from './llmSettingsModule.js';
import { vocabularySettingsModule } from './vocabularySettingsModule.js';
import { charRefSettingsModule } from './charRefSettingsModule.js';
import { themeSettingsModule } from './themeSettingsModule.js';
import { fabSettingsModule } from './fabSettingsModule.js';
import { imageCacheSettingsModule } from './imageCacheSettingsModule.js';
import { settingsPageModule } from './settingsPageModule.js';
import { aboutSettingsModule } from './aboutSettingsModule.js';
import { logSettingsModule } from './logSettingsModule.js';
import { troubleshootingModule } from './troubleshootingModule.js';
import { diagnosticsModule } from './diagnosticsModule.js';
import { installationGuideModule } from './installationGuideModule.js';
import { promptReplacementModule } from './promptReplacementModule.js';
import { sendDataSettingsModule } from './sendDataSettingsModule.js';

export const promptModules = {
    regex: regexModule,
    main_settings: mainSettingsModule,
    comfyui_workflow: comfyuiWorkflowModule,
    sd_settings: sdSettingsModule,
    novelai_settings: novelaiSettingsModule,
    comfyui_settings: comfyuiSettingsModule,
    banana_settings: bananaSettingsModule,
    llm_settings: llmSettingsModule,
    vocabulary_settings: vocabularySettingsModule,
    char_ref_settings: charRefSettingsModule,
    theme_settings: themeSettingsModule,
    fab_settings: fabSettingsModule,
    image_cache_settings: imageCacheSettingsModule,
    settings_page: settingsPageModule,
    about_settings: aboutSettingsModule,
    log_settings: logSettingsModule,
    troubleshooting: troubleshootingModule,
    diagnostics: diagnosticsModule,
    installation_guide: installationGuideModule,
    prompt_replacement: promptReplacementModule,
    send_data_settings: sendDataSettingsModule,
};

/**
 * 获取所有已注册模块的摘要列表（用于注入主提示词）
 * @returns {string} 模块摘要文本
 */
export function getModuleSummaries() {
    const lines = ['【可加载的知识模块】（使用 load_module 按需获取详细信息）'];
    for (const [key, mod] of Object.entries(promptModules)) {
        lines.push(`- ${key}: ${mod.name} — ${mod.summary}`);
    }
    lines.push('');
    lines.push('当你需要操作某个模块的功能时，请先加载对应模块获取详细命令和知识：');
    lines.push('<SystemQuery>{"type": "load_module", "module": "模块名"}</SystemQuery>');
    return lines.join('\n');
}

/**
 * 获取指定模块的完整提示词内容
 * @param {string} moduleName - 模块键名，如 "regex"
 * @returns {string|null} 完整的模块提示词内容，模块不存在时返回 null
 */
export function getModulePrompt(moduleName) {
    const mod = promptModules[moduleName];
    if (!mod) return null;

    const sections = [];
    sections.push(`===== ${mod.name} 模块详细知识 =====`);
    sections.push('');

    if (mod.commands) {
        sections.push(mod.commands);
        sections.push('');
    }

    if (mod.knowledge) {
        sections.push(mod.knowledge);
        sections.push('');
    }

    if (mod.workflow) {
        sections.push(mod.workflow);
        sections.push('');
    }

    if (mod.errorGuide) {
        sections.push(mod.errorGuide);
        sections.push('');
    }

    sections.push(`===== ${mod.name} 模块结束 =====`);

    return sections.join('\n');
}

/**
 * 获取所有可用模块的键名列表
 * @returns {string[]} 模块键名数组
 */
export function getAvailableModuleKeys() {
    return Object.keys(promptModules);
}
