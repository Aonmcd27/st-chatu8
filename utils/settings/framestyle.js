/**
 * 图片相框样式模块
 * 用于设置图片展示的相框效果
 * 所有样式都使用外边框/阴影/轮廓，确保不影响图片内容展示
 */

import { extension_settings } from "../../../../../extensions.js";
import { extensionName } from '../config.js';

// 缓存当前生成的框架样式 CSS，用于注入到 iframe
let currentFrameStyleCSS = '';

/**
 * 将框架样式注入到指定文档（用于 iframe）
 * @param {Document} targetDoc - 目标文档对象
 */
export function injectFrameStyleToDocument(targetDoc) {
    if (!targetDoc || !currentFrameStyleCSS) return;

    const styleId = 'st-chatu8-image-frame-style';
    let styleEl = targetDoc.getElementById(styleId);

    if (!styleEl) {
        styleEl = targetDoc.createElement('style');
        styleEl.id = styleId;
        // 尝试插入到 head，如果没有则插入到 documentElement
        const target = targetDoc.head || targetDoc.documentElement;
        if (target) {
            target.appendChild(styleEl);
        } else {
            return; // 无法注入
        }
    }

    // 只有当内容不同时才更新，避免不必要的重绘
    if (styleEl.textContent !== currentFrameStyleCSS) {
        styleEl.textContent = currentFrameStyleCSS;
    }
}

export function applyImageFrameStyle(styleName, isDark = true) {
    const styleId = 'st-chatu8-image-frame-style';
    let styleEl = document.getElementById(styleId);
    if (!styleEl) {
        styleEl = document.createElement('style');
        styleEl.id = styleId;
        document.head.appendChild(styleEl);
    }

    // 获取图片对齐设置，默认居中
    const settings = extension_settings[extensionName];
    const alignment = settings?.imageAlignment || 'center';
    const imageSizeScale = settings?.imageSizeScale || '100';

    let css = '';
    const containerSelector = '.st-chatu8-image-container';
    const imgSelector = `${containerSelector} img, ${containerSelector} video`;

    // 基础样式：确保图片容器占据整行，不影响文字排版
    css += `
        ${containerSelector} {
            display: block;
            position: relative;
            line-height: 0;
            text-align: ${alignment};
            margin: 0.5em 0;
        }
        ${containerSelector} img,
        ${containerSelector} video {
            display: inline-block !important;
            max-width: ${imageSizeScale}% !important;
            height: auto !important;
            vertical-align: middle;
        }
    `;

    switch (styleName) {
        case '无样式':
        default:
            // 无任何边框效果
            css += `
                ${imgSelector} {
                    border: none !important;
                    box-shadow: none !important;
                    outline: none !important;
                    border-radius: 0 !important;
                }
            `;
            break;

        case '简约白边':
            css += `
                ${imgSelector} {
                    border: 3px solid rgba(255, 255, 255, 0.9) !important;
                    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15) !important;
                    border-radius: 2px !important;
                }
            `;
            if (!isDark) {
                css += `
                    ${imgSelector} {
                        border-color: rgba(30, 30, 30, 0.85) !important;
                    }
                `;
            }
            break;

        case '柔和阴影':
            css += `
                ${imgSelector} {
                    border: none !important;
                    box-shadow: 
                        0 4px 12px rgba(0, 0, 0, 0.15),
                        0 2px 4px rgba(0, 0, 0, 0.1) !important;
                    border-radius: 4px !important;
                }
            `;
            break;

        case '圆角相框':
            css += `
                ${imgSelector} {
                    border: 2px solid rgba(128, 128, 128, 0.3) !important;
                    box-shadow: 0 2px 6px rgba(0, 0, 0, 0.1) !important;
                    border-radius: 12px !important;
                }
            `;
            break;

        case '复古画框':
            css += `
                ${imgSelector} {
                    border: 4px solid #8B7355 !important;
                    box-shadow: 
                        inset 0 0 0 1px rgba(255, 255, 255, 0.2),
                        0 4px 12px rgba(0, 0, 0, 0.3),
                        2px 2px 0 #6B5344,
                        4px 4px 0 #5A4436 !important;
                    border-radius: 2px !important;
                }
            `;
            break;

        case '科技边框':
            css += `
                ${imgSelector} {
                    border: 2px solid rgba(0, 255, 255, 0.6) !important;
                    box-shadow: 
                        0 0 8px rgba(0, 255, 255, 0.3),
                        0 0 2px rgba(0, 255, 255, 0.5),
                        inset 0 0 12px rgba(0, 255, 255, 0.05) !important;
                    border-radius: 4px !important;
                }
            `;
            break;

        case '霓虹光晕':
            css += `
                ${imgSelector} {
                    border: 2px solid rgba(255, 0, 128, 0.7) !important;
                    box-shadow: 
                        0 0 10px rgba(255, 0, 128, 0.4),
                        0 0 20px rgba(0, 200, 255, 0.2),
                        0 0 4px rgba(255, 255, 255, 0.3) !important;
                    border-radius: 4px !important;
                }
            `;
            break;

        case '玻璃质感':
            css += `
                ${imgSelector} {
                    border: 1px solid rgba(255, 255, 255, 0.25) !important;
                    box-shadow: 
                        0 8px 32px rgba(0, 0, 0, 0.12),
                        inset 0 1px 0 rgba(255, 255, 255, 0.1) !important;
                    border-radius: 8px !important;
                }
            `;
            if (!isDark) {
                css += `
                    ${imgSelector} {
                        border-color: rgba(0, 0, 0, 0.1) !important;
                    }
                `;
            }
            break;

        case '渐变边框':
            css += `
                ${containerSelector} {
                    padding: 3px !important;
                    background: linear-gradient(135deg, #667eea 0%, #764ba2 50%, #f093fb 100%) !important;
                    border-radius: 6px !important;
                }
                ${imgSelector} {
                    border: none !important;
                    border-radius: 4px !important;
                    box-shadow: none !important;
                }
            `;
            break;

        case '金色画框':
            css += `
                ${imgSelector} {
                    border: 4px solid #C9A227 !important;
                    box-shadow: 
                        inset 0 0 0 1px rgba(255, 215, 0, 0.3),
                        0 0 0 1px #8B6914,
                        0 4px 12px rgba(0, 0, 0, 0.25) !important;
                    border-radius: 2px !important;
                }
            `;
            break;

        case '极简线条':
            css += `
                ${imgSelector} {
                    border: 1px solid rgba(128, 128, 128, 0.4) !important;
                    box-shadow: none !important;
                    border-radius: 0 !important;
                }
            `;
            break;

        case '浮雕效果':
            css += `
                ${imgSelector} {
                    border: 3px solid transparent !important;
                    box-shadow: 
                        3px 3px 6px rgba(0, 0, 0, 0.2),
                        -2px -2px 4px rgba(255, 255, 255, 0.1),
                        inset 0 0 0 1px rgba(255, 255, 255, 0.05) !important;
                    border-radius: 4px !important;
                }
            `;
            break;

        case '漫画风格':
            css += `
                ${imgSelector} {
                    border: 3px solid #1a1a1a !important;
                    box-shadow: 
                        4px 4px 0 #1a1a1a !important;
                    border-radius: 2px !important;
                }
            `;
            if (!isDark) {
                // 保持黑色边框在亮色模式下也好看
            }
            break;

        case '胶片边框':
            css += `
                ${containerSelector} {
                    padding: 8px 4px !important;
                    background: #1a1a1a !important;
                    border-radius: 2px !important;
                    position: relative !important;
                }
                ${containerSelector}::before,
                ${containerSelector}::after {
                    content: '';
                    position: absolute;
                    top: 0;
                    bottom: 0;
                    width: 8px;
                    background: 
                        repeating-linear-gradient(
                            to bottom,
                            transparent 0px,
                            transparent 4px,
                            rgba(255, 255, 255, 0.3) 4px,
                            rgba(255, 255, 255, 0.3) 8px
                        );
                }
                ${containerSelector}::before {
                    left: -4px;
                }
                ${containerSelector}::after {
                    right: -4px;
                }
                ${imgSelector} {
                    border: none !important;
                    box-shadow: none !important;
                    border-radius: 0 !important;
                }
            `;
            break;
    }

    styleEl.textContent = css;

    // 缓存当前 CSS 用于 iframe 注入
    currentFrameStyleCSS = css;
}
