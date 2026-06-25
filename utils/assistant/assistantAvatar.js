// @ts-nocheck
/**
 * assistantAvatar.js - AI 助手头像管理模块
 * 
 * 根据当前预设动态获取和显示 AI (char) 和 User 头像
 */

import { extension_settings } from "../../../../../extensions.js";
import { extensionName } from '../config.js';
import { getPersonaAvatarById } from '../settings/knowledgeBase/personaPreset.js';
import { getUserAvatarById } from '../settings/knowledgeBase/userPreset.js';
import { DEFAULT_AVATARS } from '../avatarConfig.js';

// 头像缓存（按 presetId 缓存，避免批量渲染时重复读取数据库）
let _charAvatarCache = { key: null, value: null };
let _userAvatarCache = { key: null, value: null };

/**
 * 清除头像缓存（预设切换时调用）
 */
export function clearAvatarCache() {
    _charAvatarCache = { key: null, value: null };
    _userAvatarCache = { key: null, value: null };
}

/**
 * 获取当前应该使用的 AI (char) 头像
 * @returns {Promise<string>} Base64 图片字符串或默认头像路径
 */
export async function getCurrentCharAvatar() {
    const aiConfig = extension_settings[extensionName]?.chatu8_ai_assistant || {};
    const systemPromptKey = aiConfig.system_prompt_key || 'default';

    // 只有在自定义预设模式下才使用人设头像
    if (systemPromptKey !== 'custom') {
        return DEFAULT_AVATARS.persona;
    }

    // 获取当前人设预设
    const personaProfiles = extension_settings[extensionName]?.personaProfiles;
    if (!personaProfiles || !personaProfiles.enabled) {
        return DEFAULT_AVATARS.persona;
    }

    const currentPresetId = personaProfiles.currentPresetId;
    if (!currentPresetId) {
        return DEFAULT_AVATARS.persona;
    }

    // 缓存命中：presetId 未变则直接返回缓存值
    if (_charAvatarCache.key === currentPresetId && _charAvatarCache.value !== null) {
        return _charAvatarCache.value;
    }

    // 尝试获取人设头像并写入缓存
    const avatarBase64 = await getPersonaAvatarById(currentPresetId);
    const result = avatarBase64 || DEFAULT_AVATARS.persona;
    _charAvatarCache = { key: currentPresetId, value: result };
    return result;
}

/**
 * 获取当前应该使用的 User 头像
 * @returns {Promise<string>} Base64 图片字符串或默认头像路径
 */
export async function getCurrentUserAvatar() {
    const aiConfig = extension_settings[extensionName]?.chatu8_ai_assistant || {};
    const systemPromptKey = aiConfig.system_prompt_key || 'default';

    // 只有在自定义预设模式下才使用 User 头像
    if (systemPromptKey !== 'custom') {
        return DEFAULT_AVATARS.user;
    }

    // 获取当前 User 预设
    const personaProfiles = extension_settings[extensionName]?.personaProfiles;
    if (!personaProfiles || !personaProfiles.userEnabled) {
        return DEFAULT_AVATARS.user;
    }

    const currentUserPresetId = personaProfiles.currentUserPresetId;
    if (!currentUserPresetId) {
        return DEFAULT_AVATARS.user;
    }

    // 缓存命中：presetId 未变则直接返回缓存值
    if (_userAvatarCache.key === currentUserPresetId && _userAvatarCache.value !== null) {
        return _userAvatarCache.value;
    }

    // 尝试获取 User 头像并写入缓存
    const avatarBase64 = await getUserAvatarById(currentUserPresetId);
    const result = avatarBase64 || DEFAULT_AVATARS.user;
    _userAvatarCache = { key: currentUserPresetId, value: result };
    return result;
}

/**
 * 获取当前 AI 助手的显示名称
 * - 自定义预设模式：使用人设的 name 字段
 * - 默认模式：返回 "智绘姬"
 * @returns {string}
 */
export function getAssistantDisplayName() {
    const aiConfig = extension_settings[extensionName]?.chatu8_ai_assistant || {};
    const systemPromptKey = aiConfig.system_prompt_key || 'default';

    if (systemPromptKey === 'custom') {
        const personaProfiles = extension_settings[extensionName]?.personaProfiles;
        if (personaProfiles?.enabled) {
            const presetId = personaProfiles.currentPresetId;
            const preset = presetId ? personaProfiles.presets?.[presetId] : null;
            if (preset?.name) {
                return preset.name;
            }
        }
    }
    return '智绘姬';
}

/**
 * 生成头像 HTML
 * @param {string} avatarSrc - 头像图片源（Base64 或 URL）
 * @param {string} alt - 替代文本
 * @returns {string} HTML 字符串
 */
export function generateAvatarHTML(avatarSrc, alt = 'Avatar') {
    return `<img src="${avatarSrc}" alt="${alt}" style="width: 100%; height: 100%; object-fit: cover; border-radius: 50%; image-rendering: -webkit-optimize-contrast; image-rendering: crisp-edges;">`;
}

/**
 * 更新对话框标题栏的显示名称
 */
export function updateDialogTitle() {
    const name = getAssistantDisplayName();
    const $title = $('#st-chatu8-ai-dialog-title');
    if ($title.length) {
        $title.text(`${name} AI 助手`);
    }
}

/**
 * 更新对话界面中的所有头像显示
 * @param {jQuery} chatBody - 聊天消息容器
 */
export async function updateChatAvatars(chatBody) {
    if (!chatBody || !chatBody.length) return;

    const charAvatar = await getCurrentCharAvatar();
    const userAvatar = await getCurrentUserAvatar();

    const charAvatarHTML = generateAvatarHTML(charAvatar, '智绘姬');
    const userAvatarHTML = generateAvatarHTML(userAvatar, 'User');

    // 更新所有 AI 消息的头像
    chatBody.find('.st-chatu8-ai-msg.system-msg .msg-avatar').html(charAvatarHTML);

    // 更新所有 User 消息的头像
    chatBody.find('.st-chatu8-ai-msg.user-msg .msg-avatar').html(userAvatarHTML);
}

/**
 * 为新消息设置头像
 * @param {jQuery} msgElement - 消息元素
 * @param {string} role - 'user' 或 'assistant'
 */
export async function setMessageAvatar(msgElement, role) {
    if (!msgElement || !msgElement.length) return;

    const avatar = role === 'user'
        ? await getCurrentUserAvatar()
        : await getCurrentCharAvatar();

    const alt = role === 'user' ? 'User' : '智绘姬';
    const avatarHTML = generateAvatarHTML(avatar, alt);

    msgElement.find('.msg-avatar').html(avatarHTML);
}


/**
 * 初始化头像更新监听器
 * 当人设或 User 预设切换时，自动更新对话界面的头像
 * @param {jQuery} chatBody - 聊天消息容器
 */
export function initAvatarUpdateListener(chatBody) {
    if (!chatBody || !chatBody.length) return;

    // 监听 settings 变化
    const checkInterval = setInterval(async () => {
        const personaProfiles = extension_settings[extensionName]?.personaProfiles;
        if (!personaProfiles) return;

        // 检查是否需要更新头像
        const currentPresetId = personaProfiles.currentPresetId;
        const currentUserPresetId = personaProfiles.currentUserPresetId;
        const aiConfig = extension_settings[extensionName]?.chatu8_ai_assistant || {};
        const currentPromptKey = aiConfig.system_prompt_key || 'default';

        // 使用数据属性存储上次的预设 ID 和模式
        const lastPresetId = chatBody.data('last-persona-preset-id');
        const lastUserPresetId = chatBody.data('last-user-preset-id');
        const lastPromptKey = chatBody.data('last-prompt-key');

        if (currentPresetId !== lastPresetId || currentUserPresetId !== lastUserPresetId || currentPromptKey !== lastPromptKey) {
            // 预设或模式已切换，清除缓存并更新头像和标题
            clearAvatarCache();
            await updateChatAvatars(chatBody);
            updateDialogTitle();
            chatBody.data('last-persona-preset-id', currentPresetId);
            chatBody.data('last-user-preset-id', currentUserPresetId);
            chatBody.data('last-prompt-key', currentPromptKey);
        }
    }, 500); // 每 500ms 检查一次

    // 返回清理函数
    return () => clearInterval(checkInterval);
}
