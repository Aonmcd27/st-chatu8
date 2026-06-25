// @ts-nocheck
/**
 * 图片生成触发和显示
 * 包含：triggerGeneration, createAndShowImage
 */

import { eventSource } from "../../../../../../script.js";
import { extension_settings } from "../../../../../extensions.js";
import { EventType, extensionName } from '../config.js';
import { addLog, addSmoothShakeEffect, fixMp4Faststart } from '../utils.js';
import { showEditDialog } from './dialogs.js';
import { isGenerating, startGenerating, stopGenerating } from '../generation_status.js';
import { getItemImg } from '../database.js';

/**
 * 将 data URL 分块 atob 解码为 Blob，避免一次性解码大文件撑满移动端内存。
 * base64 每 4 字符解码 3 字节，分块大小必须是 4 的整数倍。
 * 得到的 Blob 可以 createObjectURL，浏览器将以 Range 请求实现流式播放。
 * @param {string} dataUrl - "data:mime;base64,xxx" 格式
 * @returns {Promise<Blob>}
 */
async function _dataUrlToBlob(dataUrl) {
    const commaIdx = dataUrl.indexOf(',');
    const meta = dataUrl.slice(0, commaIdx);                 // "data:video/mp4;base64"
    const mimeType = meta.slice(5, meta.indexOf(';'));        // "video/mp4"
    const base64 = dataUrl.slice(commaIdx + 1);

    // 512 * 1024 = 524288，恰好是 4 的倍数，每块独立解码均合法
    const CHUNK = 512 * 1024;
    const parts = [];

    for (let i = 0; i < base64.length; i += CHUNK) {
        const chunk = base64.slice(i, i + CHUNK);
        const binaryStr = atob(chunk);
        const bytes = new Uint8Array(binaryStr.length);
        for (let j = 0; j < binaryStr.length; j++) {
            bytes[j] = binaryStr.charCodeAt(j);
        }
        parts.push(bytes);
        // 每 5 块让出事件循环一次，避免长时间阻塞 UI
        if (parts.length % 5 === 0) {
            await new Promise(r => setTimeout(r, 0));
        }
    }

    return new Blob(parts, { type: mimeType });
}

// 延迟导入，避免循环依赖
let _showImagePreview = null;

/**
 * 设置 showImagePreview 函数引用
 * @param {Function} fn - showImagePreview 函数
 */
export function setShowImagePreview(fn) {
    _showImagePreview = fn;
}


/**
 * 创建并显示图片/视频元素
 * @param {HTMLElement} container - 容器元素
 * @param {string} imageUrl - 图片/视频 URL
 * @param {string} alt - 替代文本
 * @param {HTMLButtonElement} button - 按钮元素
 * @param {string} change - 变更数据
 * @param {boolean} isVideo - 是否为视频
 * @param {string} originalUrl - 视频原始远程 URL（备用流式播放）
 */
export function createAndShowImage(container, imageUrl, alt, button, change, isVideo = false, originalUrl = '') {
    const doc = container.ownerDocument;
    if (!doc) return;
    const div = doc.createElement('div');
    div.className = 'st-chatu8-image-container';

    // Create either video or img element based on media type
    let media;
    if (isVideo) {
        media = doc.createElement('video');
        media.controls = true;
        media.loop = true;
        media.muted = true; // Start muted to allow autoplay
        media.playsInline = true;
        media.dataset.isVideo = 'true';
        media.autoplay = true;
        // 分块 atob 解码 → Blob → fixMp4Faststart（moov 移到头部）→ Blob URL
        // Blob URL 支持浏览器 Range 请求，实现流式播放，解决移动端 Edge 无法加载大文件的问题
        // 必须用 atob 分块而非 fetch()：fetch(data URL) 在 SillyTavern iframe 沙盒中受限制会失败
        if (imageUrl.startsWith('data:')) {
            _dataUrlToBlob(imageUrl)
                .then(rawBlob => fixMp4Faststart(rawBlob))
                .then(blob => {
                    const blobUrl = URL.createObjectURL(blob);
                    media.dataset.blobUrl = blobUrl;
                    media.src = blobUrl;
                })
                .catch(e => {
                    console.warn('[video] Blob URL 创建失败，回退使用 data URL:', e);
                    media.src = imageUrl;
                });
        } else {
            media.src = imageUrl;
        }

        // 添加错误处理：当视频无法播放时显示下载链接占位符
        media.onerror = function () {
            const errCode = this.error?.code;
            console.error(`[iframe] Video onerror: code=${errCode}, msg=${this.error?.message}`);

            // 如果有原始 URL，优先直接用它播放（网络流媒体，完全绕过内存问题）
            if (originalUrl && this.src !== originalUrl) {
                console.log('[iframe] 尝试使用原始 URL 備用播放:', originalUrl);
                this.src = originalUrl;
                return; // 等待再次 onerror 或成功播放
            }

            // 备用方案也失败，显示下载提示条
            const notice = doc.createElement('div');
            notice.className = 'st-chatu8-video-notice';
            notice.style.cssText = `
                display: flex;
                flex-direction: column;
                align-items: center;
                gap: 8px;
                padding: 10px;
                background: rgba(0,0,0,0.5);
                border-radius: 0 0 8px 8px;
                color: #fff;
                font-size: 13px;
                text-align: center;
            `;

            // 说明文字
            const text = doc.createElement('div');
            text.textContent = '⚠️ 视频在当前浏览器环境中无法播放，请下载后用视频播放器观看';
            text.style.opacity = '0.9';

            // 下载按钮 - 使用 Blob URL（比 data URL 更可靠）
            const downloadBtn = doc.createElement('a');
            const blobSrc = media.dataset.blobUrl || imageUrl;
            downloadBtn.href = blobSrc;
            downloadBtn.download = 'video.mp4';
            downloadBtn.textContent = '📥 下载视频';
            downloadBtn.style.cssText = `
                background: rgba(255,255,255,0.25);
                padding: 7px 18px;
                border-radius: 4px;
                color: #fff;
                text-decoration: none;
                cursor: pointer;
                font-size: 14px;
            `;
            downloadBtn.onclick = (e) => e.stopPropagation();

            notice.appendChild(text);
            notice.appendChild(downloadBtn);

            // 追加到视频父容器，不替换视频本身
            if (media.parentNode) {
                media.parentNode.appendChild(notice);
            }
        };
    } else {
        media = doc.createElement('img');
        media.src = imageUrl;
        media.alt = alt;
    }

    if (change) {
        button.dataset.change = change ? change : '';
    }

    let clickTimer = null;
    let pressTimer = null;
    let isLongPress = false;
    const doubleClickThreshold = 300;
    const longPressThreshold = 1200;

    // 视频的 click/touch 会被原生控件拦截，需要透明遮罩承接事件
    // 遮罩覆盖视频上半部（70%），不挡底部控件条
    let eventTarget;
    if (isVideo) {
        const overlay = doc.createElement('div');
        overlay.style.cssText = [
            'position:absolute',
            'top:0',
            'left:0',
            'width:100%',
            'height:25%',
            'z-index:1',
            'cursor:pointer',
        ].join(';');
        div.style.position = 'relative';
        // overlay 在 media append 之后再插入，保证层叠顺序正确
        div._pendingOverlay = overlay;
        eventTarget = overlay;
    } else {
        eventTarget = media;
    }

    const handlePressStart = (e) => {
        if (e.type === 'mousedown' && e.button !== 0) return;
        isLongPress = false;
        pressTimer = setTimeout(() => {
            pressTimer = null;
            isLongPress = true;
            if (clickTimer) { clearTimeout(clickTimer); clickTimer = null; }
            if (button && extension_settings[extensionName].longPressToEdit == "true") {
                showEditDialog(media, button);
            }
        }, longPressThreshold);
    };

    const handlePressEnd = (e) => {
        if (pressTimer) { clearTimeout(pressTimer); pressTimer = null; }
    };

    const handleClick = (e) => {
        if (isLongPress) return;
        if (clickTimer) {
            clearTimeout(clickTimer);
            clickTimer = null;
            if (extension_settings[extensionName].dbclike === "true" && button) {
                addSmoothShakeEffect(media);
                triggerGeneration(button);
            }
        } else {
            clickTimer = setTimeout(() => {
                clickTimer = null;
                if (button && extension_settings[extensionName].clickToPreview === "true") {
                    if (_showImagePreview) { _showImagePreview(media, button); }
                }
            }, doubleClickThreshold);
        }
    };

    eventTarget.addEventListener('click', handleClick);
    eventTarget.addEventListener('mousedown', handlePressStart);
    eventTarget.addEventListener('mouseup', handlePressEnd);
    eventTarget.addEventListener('mouseleave', handlePressEnd);
    eventTarget.addEventListener('touchstart', handlePressStart, { passive: true });
    eventTarget.addEventListener('touchend', handlePressEnd);
    eventTarget.addEventListener('touchcancel', handlePressEnd);
    eventTarget.addEventListener('contextmenu', (e) => {
        if (extension_settings[extensionName].longPressToEdit == "true") {
            e.preventDefault();
            e.stopPropagation();
        }
    });

    div.appendChild(media);
    // 如果有待插入的 overlay（视频遮罩），在 media 之后 append
    if (div._pendingOverlay) {
        div.appendChild(div._pendingOverlay);
        delete div._pendingOverlay;
    }

    // 检查是否启用折叠功能
    if (String(extension_settings[extensionName]?.collapseImage) === 'true') {
        // 创建折叠包裹容器
        const wrapper = doc.createElement('div');
        wrapper.className = 'st-chatu8-collapse-wrapper';
        wrapper.dataset.mediaType = isVideo ? 'video' : 'image';
        wrapper.dataset.collapsed = 'true'; // 默认折叠

        // 创建折叠标题栏
        const header = doc.createElement('div');
        header.className = 'st-chatu8-collapse-header';

        // 折叠图标
        const icon = doc.createElement('span');
        icon.className = 'st-chatu8-collapse-icon';
        icon.textContent = '▼';

        // 标题文字
        const title = doc.createElement('span');
        title.className = 'st-chatu8-collapse-title';
        title.textContent = isVideo ? '📹 点击展开视频' : '📷 点击展开图片';

        // 状态标签
        const badge = doc.createElement('span');
        badge.className = 'st-chatu8-collapse-badge';
        badge.textContent = '已折叠';

        header.appendChild(icon);
        header.appendChild(title);
        header.appendChild(badge);

        // 创建内容区域
        const content = doc.createElement('div');
        content.className = 'st-chatu8-collapse-content';
        content.appendChild(div);

        // 点击标题栏切换折叠状态
        header.addEventListener('click', (e) => {
            e.stopPropagation();
            const isCollapsed = wrapper.dataset.collapsed === 'true';

            if (isCollapsed) {
                // 展开
                wrapper.dataset.collapsed = 'false';
                badge.textContent = '已展开';
                title.textContent = isVideo ? '📹 点击收起视频' : '📷 点击收起图片';
            } else {
                // 折叠
                wrapper.dataset.collapsed = 'true';
                badge.textContent = '已折叠';
                title.textContent = isVideo ? '📹 点击展开视频' : '📷 点击展开图片';
            }
        });

        wrapper.appendChild(header);
        wrapper.appendChild(content);

        container.replaceChildren(wrapper);
    } else {
        container.replaceChildren(div);
    }
}

/**
 * 触发图片生成
 * @param {HTMLButtonElement} button - 生成按钮元素
 */
export const triggerGeneration = (button) => {
    // 按钮级别防重检测：如果按钮已在加载中，直接返回
    if (button.hasAttribute('data-loading')) {
        addLog(`按钮已在加载中，跳过重复点击: ${button.dataset.link?.substring(0, 50)}`);
        return;
    }

    const link = button.dataset.link;
    const requestId = button.dataset.requestId;

    const startGenerationProcess = () => {
        console.log('Triggering generation for button:', button);

        // 检查是否已在生成中
        const alreadyGenerating = isGenerating(link);

        if (alreadyGenerating) {
            addLog(`图像生成请求已在进行中，等待响应: ${link}`);
            button.setAttribute('data-loading', 'true');
            button.textContent = '加载中...';
            // 不再 return，继续注册监听器以接收响应
        }

        const imageResponseHandler = (responseData) => {
            if (responseData.id !== requestId) return;

            console.log('Image response:', responseData);

            eventSource.removeListener(EventType.GENERATE_IMAGE_RESPONSE, imageResponseHandler);
            addLog(`图像响应监听器已销毁 (ID: ${requestId})`);

            const { success, imageData, error, prompt, change, isVideo, originalUrl } = responseData;

            if (prompt) stopGenerating(prompt);

            const docs = [document, ...Array.from(document.querySelectorAll('iframe')).map(f => f.contentDocument).filter(Boolean)];

            // 失败时全局只 toast 一次，避免每个 doc 重复弹
            if (!success) {
                addLog(`图像生成失败 (ID: ${requestId}): ${error}`);
                toastr.error(`生成失败: ${error || '未知错误'}`);
            }

            docs.forEach(doc => {
                const spans = doc.querySelectorAll(`span[data-request-id="${requestId}"]`);
                const buttons = doc.querySelectorAll(`button[data-request-id="${requestId}"]`);

                // 1) 成功时：把图片插入到所有匹配到的 span
                if (success && spans.length > 0) {
                    addLog(`${isVideo ? '视频' : '图像'}生成成功 (ID: ${requestId}), targeting ${spans.length} element(s).`);
                    spans.forEach(span => {
                        const associatedButton = span.previousElementSibling;
                        if (associatedButton && associatedButton.matches(`button[data-request-id="${requestId}"]`)) {
                            createAndShowImage(span, imageData, 'Generated Image', associatedButton, change, isVideo, originalUrl || '');
                        } else {
                            createAndShowImage(span, imageData, 'Generated Image', null, change, isVideo, originalUrl || '');
                        }
                    });
                }

                // 2) 无论成功/失败，无论 span 是否存在，都必须清理按钮的 loading 状态，
                //    否则 placeholder.js 会因为 `data-loading="true"` 残留而一直 "skipping processing"
                buttons.forEach(b => {
                    b.removeAttribute('data-loading');
                    if (success && extension_settings[extensionName].dbclike == "true") {
                        b.style.setProperty('display', 'none', 'important');
                    } else {
                        b.disabled = false;
                        b.textContent = '生成图片';
                    }
                });
            });
        };

        eventSource.on(EventType.GENERATE_IMAGE_RESPONSE, imageResponseHandler);
        addLog(`图像响应监听器已创建 (ID: ${requestId})`);

        // 只有当不是已在生成中时，才发送新的生成请求
        if (!alreadyGenerating) {
            button.setAttribute('data-loading', 'true');
            button.textContent = '加载中...';
            startGenerating(link);

            const buttonChange = button.dataset.change;
            
            // === 从 prompt 和 change 中提取分辨率 ===
            let requestPrompt = link;
            let requestChange = buttonChange;
            let finalWidth = button.dataset.width || null;
            let finalHeight = button.dataset.height || null;
            let isSizeExplicitlySet = !!button.dataset.width; // 标识是否由 popup 明确设置了大小

            const sizeRegex = /,?\s*(\d{2,4})x(\d{2,4})(?=[;\s]|$)/i;

            // 1. 优先从 change 中提取（如果用户编辑了 tag）
            if (requestChange) {
                const changeMatch = requestChange.match(sizeRegex);
                if (changeMatch) {
                    if (String(extension_settings[extensionName].aiAutonomousResolution) !== 'false') {
                        finalWidth = changeMatch[1];
                        finalHeight = changeMatch[2];
                    }
                    // 根据要求，不在生成前从原文剔除，保留给 change_
                    isSizeExplicitlySet = true; // 编辑中的新 tag 优先级最高，相当于明确设置
                }
            }

            // 2. 然后从原始 link 中提取
            const linkMatch = requestPrompt.match(sizeRegex);
            if (linkMatch) {
                // 仅当用户没有在 popup 中明确设置，且 change 里也没提取到时，才使用 link 中的大小
                if (!isSizeExplicitlySet) {
                    if (String(extension_settings[extensionName].aiAutonomousResolution) !== 'false') {
                        finalWidth = linkMatch[1];
                        finalHeight = linkMatch[2];
                    }
                }
                // 根据要求，不在生成前从原文剔除，保留给 change_
            }
            // === 提取结束 ===

            const requestData = { id: requestId, prompt: requestPrompt, width: finalWidth, height: finalHeight };
            if (requestChange) {
                requestData.change = requestChange;
                // 如果是修图请求，添加修图指令和图片数据
                if (requestChange.includes('{修图}')) {
                    requestData.retouchPrompt = button.dataset.retouchPrompt || '';
                    requestData.retouchImage = button.dataset.retouchImage || '';
                    // 发送后移除修图标记，以免影响后续的普通"重新生成"
                    button.dataset.change = button.dataset.change.replaceAll('{修图}', '');
                }
                if (requestChange.includes('{视频}')) {
                    requestData.videoPrompt = button.dataset.videoPrompt || '';
                    requestData.videoImage = button.dataset.videoImage || '';
                    // 发送后移除视频标记，以免影响后续的普通"重新生成"
                    button.dataset.change = button.dataset.change.replaceAll('{视频}', '');
                }
            }
            eventSource.emit(EventType.GENERATE_IMAGE_REQUEST, requestData);
            addLog(`发出图像生成请求 (ID: ${requestData.id})`);
        }
    };

    const docs = [document, ...Array.from(document.querySelectorAll('iframe')).map(f => f.contentDocument).filter(Boolean)];
    let imageExistsInDom = false;
    for (const doc of docs) {
        const span = doc.querySelector(`span[data-request-id="${requestId}"]`);
        if (span && span.querySelector('img, video, .st-chatu8-video-fallback')) {
            console.log('Media already exists in DOM. Triggering regeneration.');
            imageExistsInDom = true;
            break;
        }
    }

    if (imageExistsInDom) {
        startGenerationProcess();
    } else {
        getItemImg(link).then(([imageUrl, dbChange, , isVideo, dbOriginalUrl]) => {
            if (imageUrl) {
                addLog(`Image for "${link}" already exists in DB. Skipping generation.`);
                for (const doc of docs) {
                    const spans = doc.querySelectorAll(`span[data-request-id="${requestId}"]`);
                    for (const span of spans) {
                        const associatedButton = span.previousElementSibling;
                        if (associatedButton && associatedButton.matches(`button[data-request-id="${requestId}"]`)) {
                            createAndShowImage(span, imageUrl, 'Generated Image', associatedButton, dbChange, isVideo, dbOriginalUrl || '');
                            associatedButton.removeAttribute('data-loading');
                            if (extension_settings[extensionName].dbclike === "true") {
                                associatedButton.style.setProperty('display', 'none', 'important');
                            } else {
                                associatedButton.disabled = false;
                                associatedButton.textContent = '生成图片';
                            }
                        }
                    }
                }
                // ★ 发送响应事件，让自动点击队列的等待 Promise 能正常结束
                eventSource.emit(EventType.GENERATE_IMAGE_RESPONSE, {
                    id: requestId,
                    success: true,
                    imageData: imageUrl,
                    prompt: link,
                    change: dbChange,
                    isVideo: isVideo,
                    fromCache: true  // 标记来自缓存
                });
            } else {
                startGenerationProcess();
            }
        });
    }
};
