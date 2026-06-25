// @ts-nocheck
/**
 * avatarConfig.js - 头像配置模块
 * 定义默认头像路径和相关配置
 */

import { extensionFolderPath } from './config.js';

/**
 * 默认头像配置
 */
export const DEFAULT_AVATARS = {
    // 人设默认头像（智绘姬头像）
    persona: `${extensionFolderPath}/html/settings/智绘姬头像.png`,
    // User 默认头像
    user: `${extensionFolderPath}/html/settings/default-user-avatar.png`
};

/**
 * 头像上传配置
 */
export const AVATAR_CONFIG = {
    // 最大文件大小（5MB）
    maxFileSize: 5 * 1024 * 1024,
    // 支持的图片格式
    acceptedFormats: ['image/jpeg', 'image/png', 'image/webp', 'image/gif'],
    // 压缩后的最大尺寸
    maxWidth: 512,
    maxHeight: 512,
    // 压缩质量
    quality: 0.9
};
