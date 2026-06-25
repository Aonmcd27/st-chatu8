/* eslint-disable no-undef */
// @ts-nocheck
import { extension_settings } from "../../../../../extensions.js";
import { extensionName } from '../config.js';
import { saveSettingsDebounced } from "../../../../../../script.js";
import { ConfigDescriptions } from './configDescriptions.js';

// ==================== 渐进式配置浏览 API ====================

/**
 * 辅助函数：按 dot path 定位到配置树中的某个节点
 * @param {string} dotPath - 用点号分隔的路径，如 "workers.myFlow.steps"，空字符串表示根
 * @returns {{target: *, error: string|null}} 定位结果
 */
function resolveConfigPath(dotPath) {
    const rawSettings = extension_settings[extensionName];
    if (!rawSettings) return { target: null, error: '[错误] 插件配置尚未初始化。' };

    if (!dotPath || dotPath === '') {
        return { target: rawSettings, error: null };
    }

    // 特殊处理：llm.* 路径映射到当前 LLM 配置文件
    // 例如：llm.api_url -> llm_profiles.默认.api_url
    if (dotPath.startsWith('llm.')) {
        const currentProfile = rawSettings.current_llm_profile || '默认';
        const subPath = dotPath.substring(4); // 去掉 "llm."

        // 特殊处理：llm.current_profile 直接映射到 current_llm_profile
        if (subPath === 'current_profile') {
            dotPath = 'current_llm_profile';
        }
        // llm.request_types.* 映射到 llm_request_type_configs.*
        else if (subPath.startsWith('request_types.')) {
            dotPath = subPath.replace('request_types.', 'llm_request_type_configs.');
        }
        // 其他 llm.* 路径映射到当前配置文件
        else {
            dotPath = `llm_profiles.${currentProfile}.${subPath}`;
        }
    }

    const parts = dotPath.split('.');
    let current = rawSettings;

    for (let i = 0; i < parts.length; i++) {
        const key = parts[i];
        if (current === null || current === undefined || typeof current !== 'object') {
            return { target: null, error: `[错误] 路径 "${parts.slice(0, i).join('.')}" 不是对象，无法继续访问 "${key}"。` };
        }
        if (!(key in current)) {
            return { target: null, error: `[错误] 在路径 "${parts.slice(0, i).join('.') || '根'}" 下不存在键 "${key}"。` };
        }
        current = current[key];
    }

    return { target: current, error: null };
}

/**
 * 获取值的大小描述
 * @param {*} value 任意值
 * @returns {string} 人类可读的大小信息
 */
function getValueSizeDesc(value) {
    if (value === null || value === undefined) return '空';
    if (Array.isArray(value)) return `${value.length}项`;
    if (typeof value === 'object') return `${Object.keys(value).length}个子键`;
    const str = String(value);
    return `${str.length}字符`;
}

/**
 * 渐进式浏览配置 —— 只返回指定路径下一层子键的"摘要"（键名、类型、大小、描述）
 * AI 可以根据摘要决定是否继续往下层钻取
 *
 * @param {string} dotPath - 用点号分隔的路径，空字符串 "" 表示浏览根目录
 * @returns {string} 格式化的浏览结果文本
 */
export function browseConfigPath(dotPath) {
    // 保存原始路径用于显示
    const originalPath = dotPath;

    const { target, error } = resolveConfigPath(dotPath);
    if (error) return error;

    // 如果是叶子值（非对象），直接返回值信息
    if (target === null || target === undefined || typeof target !== 'object') {
        const valType = target === null ? 'null' : typeof target;
        const strVal = String(target);
        if (strVal.length > 2000) {
            return `路径 "${originalPath}" 是一个 ${valType} 类型的叶子值 (${strVal.length}字符)，内容过长已截断。前 2000 字符预览:\n${strVal.substring(0, 2000)}\n... [已截断，请使用 read 指令查看完整内容]`;
        }
        return `路径 "${originalPath}" 是一个 ${valType} 类型的叶子值: ${strVal}`;
    }

    const displayPath = originalPath || '(根目录)';
    const keys = Array.isArray(target) ? target.map((_, i) => String(i)) : Object.keys(target);

    if (keys.length === 0) {
        return `路径 "${displayPath}" 是一个空的 ${Array.isArray(target) ? '数组' : '对象'}。`;
    }

    let result = `📂 路径: ${displayPath}  |  类型: ${Array.isArray(target) ? '数组' : '对象'}  |  共 ${keys.length} 项\n`;
    result += '─'.repeat(50) + '\n';

    for (const key of keys) {
        const child = target[key];
        const childType = child === null ? 'null' : Array.isArray(child) ? 'array' : typeof child;
        const size = getValueSizeDesc(child);

        // 尝试从 ConfigDescriptions 获取描述 (支持顶级 key 和当前路径+key)
        const fullKey = originalPath ? `${originalPath}.${key}` : key;
        const desc = ConfigDescriptions[key] || ConfigDescriptions[fullKey] || '';

        // 对简单值附带预览（截断到80字符）
        let preview = '';
        if (childType === 'string' || childType === 'number' || childType === 'boolean') {
            const val = String(child);
            preview = val.length > 80 ? ` = "${val.substring(0, 80)}..."` : ` = "${val}"`;
        }

        const descPart = desc ? `  // ${desc}` : '';
        result += `  ${key}  [${childType}, ${size}]${preview}${descPart}\n`;
    }

    return result;
}

/**
 * 读取指定路径的配置值
 *
 * @param {string} dotPath - 用点号分隔的路径
 * @returns {string} 值的字符串表示
 */
export function readConfigPath(dotPath) {
    if (!dotPath) return '[错误] read 操作需要指定路径，不能为空。';

    // 保存原始路径用于显示
    const originalPath = dotPath;

    const { target, error } = resolveConfigPath(dotPath);
    if (error) return error;

    if (target === null || target === undefined) {
        return `路径 "${originalPath}" 的值为: ${String(target)}`;
    }

    if (typeof target === 'object') {
        // 对象/数组：返回 JSON，但限制大小
        try {
            const jsonStr = JSON.stringify(target, null, 2);
            if (jsonStr.length > 30000) {
                return `路径 "${originalPath}" 的内容过大 (${jsonStr.length}字符)，建议使用 browse 逐层查看。以下是前 15000 字符预览:\n${jsonStr.substring(0, 15000)}\n... [已截断]`;
            }
            return `路径 "${originalPath}" 的完整内容:\n${jsonStr}`;
        } catch (e) {
            return `[错误] 无法序列化: ${e.message}`;
        }
    }

    return `路径 "${originalPath}" 的值为: ${String(target)}`;
}

/**
 * 修改指定路径的配置值（支持深层路径写入）
 *
 * @param {string} dotPath - 用点号分隔的路径
 * @param {*} newValue - 新值
 * @returns {string} 操作结果描述
 */
export function writeConfigPath(dotPath, newValue) {
    if (!dotPath) return '[错误] write 操作需要指定路径。';

    const rawSettings = extension_settings[extensionName];
    if (!rawSettings) return '[错误] 插件配置尚未初始化。';

    const parts = dotPath.split('.');
    const lastKey = parts.pop();
    const parentPath = parts.join('.');

    // 定位到父节点
    const { target: parent, error } = resolveConfigPath(parentPath);
    if (error) return error;

    if (parent === null || parent === undefined || typeof parent !== 'object') {
        return `[错误] 父路径 "${parentPath || '根'}" 不是对象，无法写入键 "${lastKey}"。`;
    }

    const isNewKey = !(lastKey in parent);

    // 禁止在顶层创建不存在的配置项（防止 AI 幻想出错误的属性名）
    if (isNewKey && !parentPath) {
        return `❌ 写入失败：顶层配置项 "${lastKey}" 不存在。\n请勿猜测属性名！请先使用 browse 查看实际存在的配置项：\n<SystemQuery>{"type": "browse", "path": ""}</SystemQuery>`;
    }

    // 禁止在非集合类对象中创建不存在的子级属性（防止 AI 幻想出错误的子属性名）
    // 只有动态集合路径（如预设、配置文件的集合）才允许创建新键
    if (isNewKey && parentPath) {
        // 这些路径是"动态集合"，允许在其下创建新的子项（预设/配置文件等）
        const DYNAMIC_COLLECTION_PATHS = new Set([
            'llm_profiles', 'test_context_profiles', 'workers', 'yushe',
            'prompt_replace', 'vibePresets', 'regex_profiles', 'themes',
            'fabThemes', 'worldBookList', 'bananaCharacterPresets',
            'novelai_profiles', 'comfyui_profiles', 'jiuguanStorage',
            'banana.conversationPresets',
        ]);

        // 规范化 parentPath（处理 llm.* 快捷路径映射）
        let normalizedParent = parentPath;
        if (parentPath.startsWith('llm.')) {
            const sub = parentPath.substring(4);
            if (sub.startsWith('request_types.')) {
                normalizedParent = sub.replace('request_types.', 'llm_request_type_configs.');
            }
        }

        if (!DYNAMIC_COLLECTION_PATHS.has(normalizedParent) && !DYNAMIC_COLLECTION_PATHS.has(parentPath)) {
            const existingKeys = Object.keys(parent).join(', ');
            return `❌ 写入失败：路径 "${dotPath}" 中属性 "${lastKey}" 不存在。\n该对象已有的属性: [${existingKeys}]\n请检查属性名是否正确！不要猜测属性名，请先使用 browse 查看：\n<SystemQuery>{"type": "browse", "path": "${parentPath}"}</SystemQuery>`;
        }
    }

    const oldValue = isNewKey ? undefined : parent[lastKey];
    parent[lastKey] = newValue;

    // 保存到硬盘
    saveSettingsDebounced();

    // 触发 UI 刷新事件
    document.dispatchEvent(new CustomEvent('st-chatu8-config-updated', {
        detail: { changed: { [dotPath]: newValue } }
    }));

    // 刷新设置页面 UI
    if (typeof window.loadSilterTavernChatu8Settings === 'function') {
        try { window.loadSilterTavernChatu8Settings(); } catch (e) {
            console.warn('[AI Config Helper] 刷新设置页面失败:', e);
        }
    }

    // 特殊处理：如果修改的是 LLM 配置，需要刷新 LLM 页面的输入框
    // 注意：dotPath 可能是原始的 llm.* 路径，也可能是映射后的 llm_profiles.* 路径
    const isLLMConfig = dotPath.startsWith('llm.') ||
        dotPath.startsWith('llm_profiles.') ||
        dotPath === 'current_llm_profile' ||
        dotPath.startsWith('request_types.') ||
        dotPath.startsWith('llm_request_type_configs.');

    if (isLLMConfig) {
        try {
            // 动态导入 LLM 模块并刷新配置显示
            import('../settings/llm.js').then(llmModule => {
                if (llmModule.loadLLMProfiles) {
                    llmModule.loadLLMProfiles();
                    console.log('[AI Config Helper] 已刷新 LLM 配置显示');
                }
                // 如果修改的是请求类型配置，也需要刷新请求类型下拉框
                if ((dotPath.startsWith('request_types.') || dotPath.startsWith('llm_request_type_configs.')) && llmModule.populateRequestTypeSelects) {
                    llmModule.populateRequestTypeSelects();
                    console.log('[AI Config Helper] 已刷新请求类型配置显示');
                }
            }).catch(err => {
                console.warn('[AI Config Helper] 无法加载 LLM 模块刷新配置:', err);
            });
        } catch (e) {
            console.warn('[AI Config Helper] 刷新 LLM 配置时出错:', e);
        }
    }

    // 特殊处理：样式设置需要立即应用
    if (dotPath === 'generate_btn_style' || dotPath === 'image_frame_style' || dotPath === 'collapse_style') {
        try {
            // 动态导入主题模块并应用样式
            import('../settings/theme.js').then(themeModule => {
                const currentTheme = rawSettings.themes?.[rawSettings.theme_id] || {};
                const isDark = themeModule.isThemeDark ? themeModule.isThemeDark(currentTheme) : true;

                if (dotPath === 'generate_btn_style' && themeModule.applyGenerateButtonStyle) {
                    themeModule.applyGenerateButtonStyle(newValue, isDark);
                    console.log('[AI Config Helper] 已自动应用生成按钮样式:', newValue);
                } else if (dotPath === 'image_frame_style' && themeModule.applyImageFrameStyle) {
                    themeModule.applyImageFrameStyle(newValue, isDark);
                    console.log('[AI Config Helper] 已自动应用图片边框样式:', newValue);
                } else if (dotPath === 'collapse_style' && themeModule.applyCollapseStyle) {
                    themeModule.applyCollapseStyle(newValue, isDark);
                    console.log('[AI Config Helper] 已自动应用折叠样式:', newValue);
                }

                // 更新设置页面的下拉框显示
                const selectId = dotPath === 'generate_btn_style' ? 'theme_generate_btn_style' :
                    dotPath === 'image_frame_style' ? 'theme_image_frame_style' :
                        'theme_collapse_style';
                const selectEl = document.getElementById(selectId);
                if (selectEl) {
                    selectEl.value = newValue;
                    console.log('[AI Config Helper] 已更新下拉框显示:', selectId, '=', newValue);
                }
            }).catch(err => {
                console.warn('[AI Config Helper] 无法加载主题模块应用样式:', err);
            });
        } catch (e) {
            console.warn('[AI Config Helper] 应用样式时出错:', e);
        }
    }

    const oldStr = isNewKey ? '(不存在)' : (typeof oldValue === 'object' ? JSON.stringify(oldValue).substring(0, 100) : String(oldValue));
    const newStr = typeof newValue === 'object' ? JSON.stringify(newValue).substring(0, 100) : String(newValue);

    const action = isNewKey ? '创建' : '修改';
    console.log(`[AI Config Helper] 路径 [${dotPath}] 已${action}: ${oldStr} → ${newStr}`);
    return `✅ 已成功${action}: "${dotPath}"\n   旧值: ${oldStr}\n   新值: ${newStr}`;
}

// ==================== UI 按钮操作注册表 ====================

/**
 * AI 可以点击的按钮白名单。
 * AI 通过语义化的 action 名来操作，不允许使用任意 CSS 选择器。
 * 数据填写/修改请使用 write 指令，这里只注册"按钮点击"类操作。
 */
export const UIActionRegistry = {
    // === 左侧导航栏 - 切换设置标签页 ===
    'switch_tab_main': { selector: '.st-chatu8-nav-link[data-tab="main"]', desc: '切换到「主要设置」页 — 后端模式选择、开关、标记、缓存管理' },
    'switch_tab_sd': { selector: '.st-chatu8-nav-link[data-tab="sd"]', desc: '切换到「SD」设置页 — Stable Diffusion WebUI 的提示词、API地址、模型、生成参数' },
    'switch_tab_novelai': { selector: '.st-chatu8-nav-link[data-tab="novelai"]', desc: '切换到「NovelAI」设置页 — NAI API Key、模型、采样器、Vibe参考图等' },
    'switch_tab_comfyui': { selector: '.st-chatu8-nav-link[data-tab="comfyui"]', desc: '切换到「ComfyUI」设置页 — ComfyUI API地址、工作流、模型、采样器、生成参数' },
    'switch_tab_banana': { selector: '.st-chatu8-nav-link[data-tab="banana"]', desc: '切换到「Banana/grok」设置页 — Banana API配置、模型、多轮对话预设' },
    'switch_tab_llm': { selector: '.st-chatu8-nav-link[data-tab="llm"]', desc: '切换到「LLM」设置页 — 大语言模型API配置、上下文预设、请求类型分配' },
    'switch_tab_vocabulary': { selector: '.st-chatu8-nav-link[data-tab="vocabulary"]', desc: '切换到「词库」设置页 — 自动完成词库搜索设置' },
    'switch_tab_knowledgeBase': { selector: '.st-chatu8-nav-link[data-tab="knowledgeBase"]', desc: '切换到「资料库」设置页 — 用户自定义知识资料库管理' },
    'switch_tab_character': { selector: '.st-chatu8-nav-link[data-tab="character"]', desc: '切换到「角色管理」设置页 — 角色设计和服装管理' },
    'switch_tab_theme': { selector: '.st-chatu8-nav-link[data-tab="theme"]', desc: '切换到「主题设置」页 — UI外观主题切换' },
    'switch_tab_fab': { selector: '.st-chatu8-nav-link[data-tab="fab"]', desc: '切换到「悬浮球」设置页 — 快捷操作浮动按钮的外观和行为' },
    'switch_tab_image_cache': { selector: '.st-chatu8-nav-link[data-tab="image-cache"]', desc: '切换到「图片缓存」设置页 — 图片缓存查看和管理' },
    'switch_tab_regex': { selector: '.st-chatu8-nav-link[data-tab="regex"]', desc: '切换到「正则」设置页 — 正则表达式替换规则管理' },
    'switch_tab_about': { selector: '.st-chatu8-nav-link[data-tab="about"]', desc: '切换到「关于」页 — 版本信息、更新检查' },
    'switch_tab_log': { selector: '.st-chatu8-nav-link[data-tab="log"]', desc: '切换到「日志」页 — 运行日志查看' },
    'switch_tab_send_data': { selector: '.st-chatu8-nav-link[data-tab="send_data"]', desc: '切换到「发送数据」页 — 查看最近发送的请求数据' },

    // === 后端连接 / 获取数据按钮 ===
    'connect_sd': { selector: '#testSd', desc: '连接 SD WebUI 并刷新模型/采样器数据（需先切到SD页面）' },
    'connect_comfyui': { selector: '#testComfyui', desc: '连接 ComfyUI 并刷新模型/采样器数据（需先切到ComfyUI页面）' },
    'llm_fetch_models': { selector: '#ch-llm_fetch_models_button', desc: '连接 LLM API 并获取可用模型列表（需先切到LLM页面）' },
    'ai_fetch_models': { selector: '#chatu8-ai-fetch-models', desc: '获取智绘姬 AI 助手可用模型列表' },
    'banana_fetch_models': { selector: '#st-chatu8-banana-fetch-models', desc: '获取 Banana 可用图像模型列表（需先切到Banana页面）' },

    // === 保存按钮 ===
    'llm_save_profile': { selector: '#ch-save_llm_profile_button', desc: '保存当前 LLM 配置预设' },
    'ai_save_settings': { selector: '#st-chatu8-ai-save-settings', desc: '保存智绘姬 AI 助手配置' },

    // === 测试按钮 ===
    'ai_test_connection': { selector: '#ai-test-connection', desc: '测试 AI 核心设置页面的 API 连接' },
    'llm_test_request': { selector: '#ch-llm_test_button', desc: '发送 LLM 测试请求' },

    // === 缓存管理按钮 (需先切到主要设置页面) ===
    'clear_image_cache': { selector: '#Clear-Cache', desc: '清除图片缓存（需先切到主要设置页面,并选择缓存清除范围）' },
    'sync_server_images': { selector: '#sync-server-images-btn', desc: '同步服务器图片到本地缓存' },
    'migrate_vibe_storage': { selector: '#migrate-vibe-storage-btn', desc: '迁移 Vibe 数据到酒馆存储' },
    'migrate_database': { selector: '#migrate-database-btn', desc: '执行数据库迁移' },

    // === 正则页面操作 ===
    'regex_test_run': { selector: '#ch-test-regex-button', desc: '执行正则测试 —— 应用当前配置的正则并测试（需先切到正则页面）' },
    'regex_add_entry': { selector: '#ch-add-regex-entry-button', desc: '新建一个正则条目（需先切到正则页面）' },
    'regex_save_profile': { selector: '#ch-save-regex-profile-button', desc: '保存当前正则配置（需先切到正则页面）' },

    // === 日志页面操作 ===
    'export_log': { selector: '#ch-export-log', desc: '导出运行日志到文件（需先切到日志页面）' },
    'clear_log': { selector: '#ch-clear-log', desc: '清空所有运行日志（需先切到日志页面）' },
    'download_debug_log': { selector: '#ch-download-debug-log', desc: '下载调试日志到文件（需先切到日志页面）' },
    'clear_debug_log': { selector: '#ch-clear-debug-log', desc: '清空调试日志（需先切到日志页面）' },

    // === 全局设置操作 ===
    'export_settings': { selector: '#ch-export-settings', desc: '导出当前所有插件设置到文件' },
    'import_settings': { selector: '#ch-import-settings', desc: '从文件导入插件设置' },
    'restore_settings': { selector: '#ch-restore-settings', desc: '重置所有插件设置为默认值（⚠️慎用）' },
};

/**
 * 执行一个白名单中的 UI 按钮操作
 * @param {string} actionName - UIActionRegistry 中注册的操作名
 * @returns {string} 操作结果描述
 */
export function executeUIAction(actionName) {
    if (!actionName) return '❌ 未指定操作名称。';

    const action = UIActionRegistry[actionName];
    if (!action) {
        const available = Object.keys(UIActionRegistry).join(', ');
        return `❌ 未知操作: "${actionName}"。可用: ${available}`;
    }

    try {
        const $el = $(action.selector);
        if (!$el.length) {
            return `❌ 未找到元素 (${action.desc})，请先切换到对应标签页。`;
        }
        $el.click();
        console.log(`[AI Config] UI操作: ${actionName} → ${action.desc}`);
        return `✅ 已执行: ${action.desc}`;
    } catch (e) {
        return `❌ 执行失败: ${e.message}`;
    }
}

/**
 * 获取用户当前的 UI 上下文信息（正在查看哪个标签页等）
 * @returns {string} 当前界面状态描述
 */
export function getCurrentUIContext() {
    const tabNameMap = {
        main: '主要设置', sd: 'SD', novelai: 'NovelAI',
        comfyui: 'ComfyUI', banana: 'Banana/grok', llm: 'LLM设置',
        vocabulary: '词库', character: '角色管理', theme: '主题设置',
        fab: '悬浮球', 'image-cache': '图片缓存', regex: '正则',
        about: '关于', log: '日志', send_data: '发送数据'
    };

    const activeTab = $('.st-chatu8-nav-link.active').data('tab') || '未知';
    const tabLabel = tabNameMap[activeTab] || activeTab;
    const panelOpen = $('#ch-settings-modal').is(':visible');

    let result = `当前标签页: ${tabLabel} (${activeTab})`;
    result += `\n设置面板: ${panelOpen ? '已打开' : '未打开'}`;

    // 可用的按钮操作列表
    const actions = Object.entries(UIActionRegistry)
        .map(([k, v]) => `  - ${k}: ${v.desc}`)
        .join('\n');
    result += `\n\n可用的按钮操作:\n${actions}`;

    return result;
}
