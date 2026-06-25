// @ts-nocheck
/**
 * 图片预览对话框和下载功能
 */

import { getItemImg, updateImageIndex, deleteImage, getItemBlob, dbs } from '../database.js';
import { showEditDialog } from './dialogs.js';
import { createAndShowImage, triggerGeneration } from './generation.js';
import { fixMp4Faststart } from '../utils.js';

/**
 * 将 data URL 分块解码为 Blob URL 并设置到视频元素，支持流式播放。
 * 与 generation.js 的 _dataUrlToBlob 逻辑相同（局部实现，避免跨模块依赖）。
 */
async function applyVideoSrc(videoEl, dataUrl, originalUrl = '') {
    if (videoEl.src && videoEl.src.startsWith('blob:')) {
        URL.revokeObjectURL(videoEl.src);
    }
    try {
        const commaIdx = dataUrl.indexOf(',');
        const mimeType = dataUrl.slice(5, dataUrl.indexOf(';'));
        const base64 = dataUrl.slice(commaIdx + 1);
        const CHUNK = 512 * 1024;
        const parts = [];
        for (let i = 0; i < base64.length; i += CHUNK) {
            const chunk = base64.slice(i, i + CHUNK);
            const binaryStr = atob(chunk);
            const bytes = new Uint8Array(binaryStr.length);
            for (let j = 0; j < binaryStr.length; j++) bytes[j] = binaryStr.charCodeAt(j);
            parts.push(bytes);
            if (parts.length % 5 === 0) await new Promise(r => setTimeout(r, 0));
        }
        const rawBlob = new Blob(parts, { type: mimeType });
        const blob = await fixMp4Faststart(rawBlob);
        const blobUrl = URL.createObjectURL(blob);
        videoEl.dataset.blobUrl = blobUrl;
        videoEl.src = blobUrl;

        // 如果 BlobURL 播放失败，回退到原始 URL
        if (originalUrl) {
            const onErr = function () {
                videoEl.removeEventListener('error', onErr);
                if (originalUrl && videoEl.src !== originalUrl) {
                    console.log('[imagePreview] BlobURL 失败，回退到原始 URL:', originalUrl);
                    videoEl.src = originalUrl;
                }
            };
            videoEl.addEventListener('error', onErr);
        }
    } catch (e) {
        console.warn('[imagePreview] applyVideoSrc 失败，回退:', e);
        // 优先用原始网络 URL（流媒体），其次用 dataUrl
        videoEl.src = originalUrl || dataUrl;
    }
}

/**
 * Helper function to safely trigger a download from a blob
 * @param {Blob} blob - 要下载的 Blob
 * @param {string} filename - 下载文件名
 */
export async function downloadBlob(blob, filename) {
    // Use the top window's objects for consistency
    const topDoc = window.top.document;
    const topURL = window.top['URL'];

    if (!topURL) {
        console.error("window.top.URL is not available.");
        toastr.error("浏览器不支持下载功能。");
        return;
    }

    const url = topURL.createObjectURL(blob);
    const link = topDoc.createElement('a');

    link.href = url;
    link.download = filename;

    // The link must be in the document for the click to work on some browsers
    link.style.display = 'none';
    topDoc.body.appendChild(link);

    link.click();

    // Clean up the link element
    topDoc.body.removeChild(link);

    // Use a timeout to ensure the download has started before revoking the URL.
    // This is a crucial step to prevent race conditions and ensure stability.
    setTimeout(() => {
        topURL.revokeObjectURL(url);
    }, 150);
}

/**
 * 显示图片预览对话框
 * @param {HTMLImageElement|HTMLVideoElement} img - 图片或视频元素
 * @param {HTMLButtonElement} button - 按钮元素
 */
export function showImagePreview(img, button) {
    const doc = window.top.document;
    const currentTag = button.dataset.link;

    // Create backdrop - 模仿 worker.js 的全屏弹窗方式
    const backdrop = doc.createElement('div');
    backdrop.className = 'st-chatu8-preview-backdrop';
    // 使用与 worker.js 相同的样式
    backdrop.style.cssText = `
        position: fixed;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        height: 100dvh;
        background-color: rgba(0, 0, 0, 0.95);
        display: flex;
        align-items: center;
        justify-content: center;
        z-index: 10000;
    `;

    // Create dialog - 全屏对话框
    const dialog = doc.createElement('div');
    dialog.className = 'st-chatu8-preview-dialog';
    dialog.addEventListener('click', (e) => e.stopPropagation());

    // 使用 100dvh 实现真正的移动端全屏
    dialog.style.cssText = `
        display: flex;
        flex-direction: column;
        width: 100vw;
        height: 100vh;
        height: 100dvh;
        max-width: 100vw;
        max-height: 100vh;
        max-height: 100dvh;
        padding: 5px;
        box-sizing: border-box;
        border-radius: 0;
        background-color: #1a1a2e;
        overflow: hidden;
    `;

    // Close button
    const closeButton = doc.createElement('div');
    closeButton.className = 'st-chatu8-preview-close';
    closeButton.innerHTML = '&times;';
    closeButton.onclick = () => {
        // 使用闭包内的 currentIndex 作为权威来源；轮播 track 中有 3 个 slot
        // 都带有 .st-chatu8-preview-large-image 类，querySelector 会返回第一个
        // （prev 槽），导致拿到错误的索引、外部图片不会真正切换。
        if (!images || images.length === 0 || !(currentIndex >= 0 && currentIndex < images.length)) {
            backdrop.remove();
            return;
        }
        const newIndex = currentIndex;
        updateImageIndex(currentTag, newIndex); // This is async but we don't need to wait

        // Detect if the media type changed (image ↔ video)
        const selectedIsVideo = mediaInfos[newIndex]?.isVideo || false;
        const originalIsVideo = img.tagName === 'VIDEO';

        // Get the persistent base64 URL from the database to update the chat element
        getItemImg(currentTag, newIndex).then(([newSrc, change, , isVideo, origUrl]) => {
            if (!newSrc) return;

            if (selectedIsVideo !== originalIsVideo) {
                const collapseWrapper = img.closest('.st-chatu8-collapse-wrapper');
                const imageContainer = img.closest('.st-chatu8-image-container');
                const spanContainer = collapseWrapper
                    ? collapseWrapper.parentElement
                    : imageContainer?.parentElement;

                if (spanContainer) {
                    createAndShowImage(spanContainer, newSrc, 'Generated Image', button, change, isVideo, origUrl || '');
                }
            } else {
                if (img.tagName === 'VIDEO' && newSrc.startsWith('data:')) {
                    applyVideoSrc(img, newSrc, origUrl || '');
                } else {
                    img.src = newSrc;
                }
            }
        });

        // Revoke all created blob URLs to prevent memory leaks
        dialog.querySelectorAll('img').forEach(imageEl => {
            if (imageEl.src && imageEl.src.startsWith('blob:')) {
                window.top['URL'].revokeObjectURL(imageEl.src);
            }
        });
        dialog.querySelectorAll('video').forEach(videoEl => {
            if (videoEl.src && videoEl.src.startsWith('blob:')) {
                window.top['URL'].revokeObjectURL(videoEl.src);
            }
        });
        backdrop.remove();
    };

    // Image/Video container
    const imageContainer = doc.createElement('div');
    imageContainer.className = 'st-chatu8-preview-image-container';
    // 添加样式确保容器正确填充可用空间并能限制图片大小
    imageContainer.style.cssText = `
        position: relative;
        flex: 1;
        min-height: 0;
        overflow: hidden;
    `;

    // Create a placeholder for the large image/video (will be populated dynamically)
    let largeMedia = null;
    // viewport（裁切区） + track（滑轨，包含 prev / current / next 三个 slide）
    const largeMediaWrapper = doc.createElement('div');
    largeMediaWrapper.className = 'st-chatu8-preview-large-wrapper';
    largeMediaWrapper.style.cssText = `
        position: absolute;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        overflow: hidden;
    `;
    const track = doc.createElement('div');
    track.className = 'st-chatu8-preview-track';
    // track 宽度 = 3 个 slide，transform 默认偏移 -1/3 让中间 slide 显示
    track.style.cssText = `
        display: flex;
        width: 300%;
        height: 100%;
        will-change: transform;
        transform: translate3d(-33.3333%, 0, 0);
    `;
    largeMediaWrapper.appendChild(track);

    imageContainer.appendChild(largeMediaWrapper);

    // 图片计数器 - 显示当前/总数（更紧凑）
    const imageCounter = doc.createElement('div');
    imageCounter.className = 'st-chatu8-preview-counter';
    imageCounter.style.cssText = `
        position: absolute;
        top: 8px;
        left: 50%;
        transform: translateX(-50%);
        background: rgba(0, 0, 0, 0.7);
        color: #fff;
        padding: 5px 14px;
        border-radius: 15px;
        font-size: 12px;
        font-weight: 500;
        z-index: 10;
        backdrop-filter: blur(10px);
        border: 1px solid rgba(255, 255, 255, 0.1);
    `;
    imageCounter.textContent = '0 / 0';
    imageContainer.appendChild(imageCounter);

    // 左右导航按钮 - 紧凑样式
    const navButtonStyle = `
        position: absolute;
        top: 50%;
        transform: translateY(-50%);
        width: 36px;
        height: 36px;
        background: linear-gradient(135deg, rgba(74, 144, 226, 0.8) 0%, rgba(123, 97, 255, 0.8) 100%);
        color: white;
        font-size: 14px;
        font-weight: bold;
        border-radius: 50%;
        display: flex;
        align-items: center;
        justify-content: center;
        cursor: pointer;
        z-index: 10;
        transition: all 0.3s ease;
        box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
        border: 1px solid rgba(255, 255, 255, 0.2);
        user-select: none;
    `;

    const prevButton = doc.createElement('div');
    prevButton.className = 'st-chatu8-preview-nav prev';
    prevButton.innerHTML = '&#10094;';
    prevButton.style.cssText = navButtonStyle + 'left: 10px;';
    prevButton.onmouseenter = () => { prevButton.style.transform = 'translateY(-50%) scale(1.1)'; };
    prevButton.onmouseleave = () => { prevButton.style.transform = 'translateY(-50%)'; };
    prevButton.onclick = () => {
        if (images.length <= 1) return;
        updateLargeImage((currentIndex - 1 + images.length) % images.length);
    };

    const nextButton = doc.createElement('div');
    nextButton.className = 'st-chatu8-preview-nav next';
    nextButton.innerHTML = '&#10095;';
    nextButton.style.cssText = navButtonStyle + 'right: 10px;';
    nextButton.onmouseenter = () => { nextButton.style.transform = 'translateY(-50%) scale(1.1)'; };
    nextButton.onmouseleave = () => { nextButton.style.transform = 'translateY(-50%)'; };
    nextButton.onclick = () => {
        if (images.length <= 1) return;
        updateLargeImage((currentIndex + 1) % images.length);
    };

    imageContainer.appendChild(prevButton);
    imageContainer.appendChild(nextButton);

    // ===== 轮播式滑动切换（拖动时相邻图片同时露出） =====
    const TRANSITION = 'transform 0.3s cubic-bezier(0.25, 0.1, 0.25, 1)';
    const CENTER = 'translate3d(-33.3333%, 0, 0)';
    let slotWidth = 0;
    let dragging = false;
    let animating = false;
    let startX = 0;
    let startY = 0;
    let startT = 0;
    let dragDx = 0;
    let horizontal = null;     // null / true / false

    /** 以动画方式切换到下一/上一张，dir = 1 (next) | -1 (prev)
     *  关键点：动画结束后做"原地位移"——只删一侧的旧 slot + 补另一侧的新 slot，
     *  当前可见的 slot 始终保留在 DOM 中，避免整屏重建造成的闪烁。 */
    function navigate(dir) {
        if (animating || images.length <= 1) return;
        animating = true;
        // 同步更新 currentIndex，避免在动画结束前关闭预览时读取到上一张索引（锁定上一张的 bug）
        const n = images.length;
        const newIndex = (currentIndex + dir + n) % n;
        currentIndex = newIndex;
        track.style.transition = TRANSITION;
        track.style.transform = dir > 0
            ? 'translate3d(-66.6666%, 0, 0)'
            : 'translate3d(0, 0, 0)';
        const onEnd = () => {
            track.removeEventListener('transitionend', onEnd);

            // —— 以下所有 DOM 变更都是同步的，浏览器会把最终状态一次性绘制，无中间帧闪烁 ——
            if (dir > 0) {
                // 动画后 visible = slot[2]（新 current）。移除 slot[0]（旧 prev），追加新 next。
                const toRemove = track.children[0];
                const newNextSlot = buildSlot((newIndex + 1) % n);
                track.style.transition = 'none';
                track.appendChild(newNextSlot);
                toRemove.remove();
                track.style.transform = CENTER;
                revokeSlotBlobUrls(toRemove);
            } else {
                // 动画后 visible = slot[0]（新 current）。移除 slot[2]（旧 next），前插新 prev。
                const toRemove = track.children[track.children.length - 1];
                const newPrevSlot = buildSlot((newIndex - 1 + n) % n);
                track.style.transition = 'none';
                track.insertBefore(newPrevSlot, track.firstChild);
                toRemove.remove();
                track.style.transform = CENTER;
                revokeSlotBlobUrls(toRemove);
            }

            currentIndex = newIndex;
            imageCounter.textContent = `${currentIndex + 1} / ${images.length}`;

            // 更新 largeMedia 指针（下载/删除逻辑依赖它）
            const currentSlot = track.children[1];
            largeMedia = currentSlot.querySelector('img, video');
            if (typeof imageContainer.__resetZoom === 'function') {
                imageContainer.__resetZoom();
            }
            if (largeMedia && largeMedia.tagName === 'VIDEO') {
                try { largeMedia.play(); } catch (_) { /* noop */ }
            }

            // 缩略图高亮
            const thumbnails = thumbnailContainer.querySelectorAll('.st-chatu8-preview-thumbnail');
            thumbnails.forEach((t, i) => t.classList.toggle('active', i === currentIndex));
            if (thumbnails[currentIndex]) {
                thumbnails[currentIndex].scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
            }

            animating = false;
        };
        track.addEventListener('transitionend', onEnd);
    }

    /** 回收单个 slot 内所有 blob: URL 并暂停视频 */
    function revokeSlotBlobUrls(slotEl) {
        if (!slotEl) return;
        slotEl.querySelectorAll('img, video').forEach((el) => {
            if (el.src && el.src.startsWith('blob:')) {
                try { window.top['URL'].revokeObjectURL(el.src); } catch (_) { /* noop */ }
            }
            if (el.tagName === 'VIDEO') {
                try { el.pause(); el.src = ''; el.load(); } catch (_) { /* noop */ }
            }
        });
    }

    imageContainer.addEventListener('touchstart', (e) => {
        if (animating || e.touches.length !== 1 || images.length <= 1) return;
        dragging = true;
        horizontal = null;
        const t = e.touches[0];
        startX = t.clientX;
        startY = t.clientY;
        startT = Date.now();
        dragDx = 0;
        slotWidth = imageContainer.offsetWidth || 1;
        track.style.transition = 'none';
    }, { passive: true });

    imageContainer.addEventListener('touchmove', (e) => {
        if (!dragging) return;
        const t = e.touches[0];
        const rawDx = t.clientX - startX;
        const rawDy = t.clientY - startY;
        if (horizontal === null) {
            if (Math.abs(rawDx) < 6 && Math.abs(rawDy) < 6) return;
            horizontal = Math.abs(rawDx) > Math.abs(rawDy);
            if (!horizontal) {
                // 判定为竖向滚动，放弃拖拽并复位
                dragging = false;
                track.style.transition = TRANSITION;
                track.style.transform = CENTER;
                return;
            }
        }
        dragDx = rawDx;
        if (e.cancelable) e.preventDefault();
        const pct = -33.3333 + (dragDx / slotWidth) * 33.3333;
        track.style.transform = `translate3d(${pct}%, 0, 0)`;
    }, { passive: false });

    imageContainer.addEventListener('touchend', () => {
        if (!dragging) return;
        dragging = false;
        if (!horizontal) return;
        const dt = Math.max(1, Date.now() - startT);
        const velocity = dragDx / dt;                   // px/ms
        const distThreshold = slotWidth * 0.2;          // 20% 宽度
        const velThreshold = 0.4;                       // 快速轻扫也触发
        if (dragDx <= -distThreshold || velocity <= -velThreshold) {
            navigate(1);
        } else if (dragDx >= distThreshold || velocity >= velThreshold) {
            navigate(-1);
        } else {
            // 未过阈值，弹回中间
            track.style.transition = TRANSITION;
            track.style.transform = CENTER;
        }
    });

    imageContainer.addEventListener('touchcancel', () => {
        if (!dragging) return;
        dragging = false;
        track.style.transition = TRANSITION;
        track.style.transform = CENTER;
    });

    // ===== 鼠标滚轮缩放 + 左键拖拽平移（桌面端） =====
    const MIN_ZOOM = 1;
    const MAX_ZOOM = 8;
    let zoomScale = 1;
    let zoomTx = 0;
    let zoomTy = 0;
    let panning = false;
    let panStartX = 0;
    let panStartY = 0;
    let panStartTx = 0;
    let panStartTy = 0;

    function applyZoomTransform(smooth = false) {
        if (!largeMedia || largeMedia.tagName === 'VIDEO') return;
        largeMedia.style.transform = `translate3d(${zoomTx}px, ${zoomTy}px, 0) scale(${zoomScale})`;
        largeMedia.style.cursor = zoomScale > 1 ? (panning ? 'grabbing' : 'grab') : '';
        // 滚轮/拖拽时不做 transition，避免连续事件产生"滑行"错觉；仅双击时用短过渡
        largeMedia.style.transition = smooth ? 'transform 0.18s ease-out' : 'none';
    }

    /** 在切图时调用，重置当前可见元素的缩放/平移状态 */
    function resetZoom() {
        zoomScale = 1;
        zoomTx = 0;
        zoomTy = 0;
        panning = false;
        if (largeMedia) {
            largeMedia.style.transform = '';
            largeMedia.style.cursor = '';
            largeMedia.style.transition = '';
        }
    }
    // 暴露给外层以便切图时调用（挂到 imageContainer 上以便闭包访问）
    imageContainer.__resetZoom = resetZoom;

    imageContainer.addEventListener('wheel', (e) => {
        if (!largeMedia || largeMedia.tagName === 'VIDEO') return;
        e.preventDefault();
        // 相对于图片中心的光标偏移（因为 transform-origin 默认在中心）
        const rect = largeMedia.getBoundingClientRect();
        const cx = e.clientX - (rect.left + rect.width / 2);
        const cy = e.clientY - (rect.top + rect.height / 2);

        const factor = e.deltaY < 0 ? 1.2 : 1 / 1.2;
        let newScale = zoomScale * factor;
        newScale = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, newScale));
        if (newScale === zoomScale) return;

        // 保持光标下的点在缩放前后位置不变：
        //   tx_new = tx_old + cx * (1 - ratio)     （cx 为光标相对当前显示中心的偏移）
        const ratio = newScale / zoomScale;
        zoomTx = zoomTx + cx * (1 - ratio);
        zoomTy = zoomTy + cy * (1 - ratio);
        zoomScale = newScale;
        if (zoomScale <= 1.001) {
            zoomScale = 1;
            zoomTx = 0;
            zoomTy = 0;
        }
        applyZoomTransform();
    }, { passive: false });

    imageContainer.addEventListener('pointerdown', (e) => {
        if (e.pointerType !== 'mouse' || e.button !== 0) return;
        if (zoomScale <= 1) return;
        if (e.target.closest('.st-chatu8-preview-nav')) return;
        e.preventDefault();
        panning = true;
        panStartX = e.clientX;
        panStartY = e.clientY;
        panStartTx = zoomTx;
        panStartTy = zoomTy;
        try { imageContainer.setPointerCapture(e.pointerId); } catch (_) { /* noop */ }
        applyZoomTransform();
    });

    imageContainer.addEventListener('pointermove', (e) => {
        if (!panning) return;
        zoomTx = panStartTx + (e.clientX - panStartX);
        zoomTy = panStartTy + (e.clientY - panStartY);
        applyZoomTransform();
    });

    const endPan = () => {
        if (!panning) return;
        panning = false;
        applyZoomTransform();
    };
    imageContainer.addEventListener('pointerup', endPan);
    imageContainer.addEventListener('pointercancel', endPan);

    // 双击还原到原始大小
    imageContainer.addEventListener('dblclick', (e) => {
        if (!largeMedia || largeMedia.tagName === 'VIDEO') return;
        if (e.target.closest('.st-chatu8-preview-nav')) return;
        if (zoomScale > 1) {
            resetZoom();
        } else {
            // 放大到 2x 并对准双击位置
            const rect = largeMedia.getBoundingClientRect();
            const cx = e.clientX - (rect.left + rect.width / 2);
            const cy = e.clientY - (rect.top + rect.height / 2);
            zoomScale = 2;
            zoomTx = -cx;
            zoomTy = -cy;
            applyZoomTransform(true);
        }
    });

    // ===== 键盘导航（桌面端） =====
    const keyHandler = (e) => {
        if (!doc.body.contains(backdrop)) return;
        if (e.key === 'ArrowLeft' && images.length > 1) {
            e.preventDefault();
            updateLargeImage((currentIndex - 1 + images.length) % images.length);
        } else if (e.key === 'ArrowRight' && images.length > 1) {
            e.preventDefault();
            updateLargeImage((currentIndex + 1) % images.length);
        } else if (e.key === 'Escape') {
            e.preventDefault();
            closeButton.click();
        }
    };
    doc.addEventListener('keydown', keyHandler);
    // 在 backdrop 被移除时解绑键盘监听，避免泄漏
    const mo = new MutationObserver(() => {
        if (!doc.body.contains(backdrop)) {
            doc.removeEventListener('keydown', keyHandler);
            mo.disconnect();
        }
    });
    mo.observe(doc.body, { childList: true });

    // Thumbnail container
    const thumbnailContainer = doc.createElement('div');
    thumbnailContainer.className = 'st-chatu8-preview-thumbnail-container';

    // Action buttons container - 更紧凑的横向布局
    const actionContainer = doc.createElement('div');
    actionContainer.className = 'st-chatu8-preview-actions';

    const downloadButton = doc.createElement('button');
    downloadButton.innerHTML = '<i class="fa-solid fa-download"></i><span>下载当前媒体</span>';
    downloadButton.className = 'st-chatu8-preview-action-button';
    downloadButton.title = '下载当前媒体';
    downloadButton.onclick = async () => {
        try {
            toastr.info('正在准备下载...');
            const blob = await getItemBlob(currentTag, currentIndex);
            if (blob) {
                // 根据当前媒体类型确定扩展名
                const mediaInfo = mediaInfos[currentIndex];
                const ext = (mediaInfo && mediaInfo.isVideo) ? 'mp4' : 'png';
                const filename = `${currentTag.replace(/[^a-z0-9]/gi, '_').substring(0, 50)}-${currentIndex}.${ext}`;
                await downloadBlob(blob, filename);
            } else {
                toastr.error('无法加载图片数据进行下载。');
                console.error('Failed to get image blob for download.');
            }
        } catch (error) {
            toastr.error('下载过程中发生错误。');
            console.error('Error during download:', error);
        }
    };

    const deleteButton = doc.createElement('button');
    deleteButton.innerHTML = '<i class="fa-solid fa-trash-can"></i><span>删除当前媒体</span>';
    deleteButton.className = 'st-chatu8-preview-action-button danger';
    deleteButton.title = '删除当前媒体';

    actionContainer.appendChild(downloadButton);
    actionContainer.appendChild(deleteButton);

    dialog.appendChild(closeButton);
    dialog.appendChild(imageContainer);
    dialog.appendChild(actionContainer);
    // 不再添加缩略图容器，让图片占据更多空间
    // thumbnailContainer 变量保留供后续代码使用但不添加到 DOM
    backdrop.appendChild(dialog);
    doc.body.appendChild(backdrop);

    let images = [];
    let mediaInfos = []; // 存储每个媒体的 isVideo 信息
    let currentIndex = 0;

    deleteButton.onclick = async () => {
        if (!window.top.confirm('确定要删除这张图片吗？')) {
            return;
        }

        const tag = currentTag;
        const indexToDelete = currentIndex;

        await deleteImage(tag, indexToDelete);
        toastr.success('图片已删除');

        // Re-fetch all images for the tag using merged data
        const md5 = CryptoJS.MD5(tag).toString();
        const merged = await dbs.getMergedAndSortedImages(md5);

        if (merged.images.length === 0) {
            // If all images are gone, close the dialog and update the original chat message
            // 优先删除折叠容器（如果存在），否则删除图片容器
            const collapseWrapper = img.closest('.st-chatu8-collapse-wrapper');
            const parentContainer = img.closest('.st-chatu8-image-container');
            if (collapseWrapper) {
                collapseWrapper.remove();
            } else if (parentContainer) {
                parentContainer.remove();
            }
            if (button) {
                button.style.display = 'inline-block';
                button.textContent = '生成图片';
                button.disabled = false;
            }
            backdrop.remove();
            return;
        }

        // 更新 mediaInfos
        mediaInfos = merged.images.map(entry => ({
            isVideo: entry.isVideo || false
        }));

        // 获取原始媒体 blobs
        const blobPromises = merged.images.map(async (imageEntry) => {
            const isVideo = imageEntry.isVideo || false;
            if (imageEntry.source === 'server' && imageEntry.path) {
                try {
                    const response = await fetch(imageEntry.path);
                    if (response.ok) {
                        return await response.blob();
                    }
                } catch (error) {
                    console.error('Failed to fetch media blob:', error);
                }
            } else if (imageEntry.source === 'db' && imageEntry.uuid) {
                const imageData = await dbs.storeReadOnly(imageEntry.uuid);
                if (imageData && imageData.data) {
                    const mimeType = isVideo ? 'video/mp4' : 'image/png';
                    return new Blob([imageData.data], { type: mimeType });
                }
            }
            return null;
        });

        const allBlobs = await Promise.all(blobPromises);
        const validIndices = [];
        images = allBlobs.filter((b, i) => {
            if (b !== null) {
                validIndices.push(i);
                return true;
            }
            return false;
        });
        mediaInfos = validIndices.map(i => mediaInfos[i]);

        // Clear existing thumbnails and revoke old URLs
        thumbnailContainer.querySelectorAll('img').forEach(thumb => {
            if (thumb.src && thumb.src.startsWith('blob:')) {
                window.top['URL'].revokeObjectURL(thumb.src);
            }
        });
        thumbnailContainer.innerHTML = '';

        // Re-populate thumbnails with proper video thumbnail handling
        const filteredMergedImages = validIndices.map(i => merged.images[i]);

        const thumbnailPromises = filteredMergedImages.map(async (imageEntry, index) => {
            const isVideo = imageEntry.isVideo || false;

            if (isVideo) {
                // 优先使用服务器缩略图路径
                if (imageEntry.source === 'server' && imageEntry.thumbnail_path) {
                    try {
                        const response = await fetch(imageEntry.thumbnail_path);
                        if (response.ok) {
                            return await response.blob();
                        }
                    } catch (error) {
                        console.warn('[iframe] Failed to fetch video thumbnail from server:', error);
                    }
                }

                // 其次使用 IndexedDB 中的缩略图
                if (imageEntry.thumbnail_uuid) {
                    const thumbnailBlob = await dbs.getImageThumbnailBlobByUUID(imageEntry.thumbnail_uuid);
                    if (thumbnailBlob) {
                        return thumbnailBlob;
                    }
                }

                return null;
            }

            return images[index];
        });

        const thumbnailBlobs = await Promise.all(thumbnailPromises);

        thumbnailBlobs.forEach((thumbnailBlob, index) => {
            const thumb = doc.createElement('img');
            if (thumbnailBlob) {
                thumb.src = window.top['URL'].createObjectURL(thumbnailBlob);
            } else {
                // 视频没有缩略图时使用占位图
                thumb.src = 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMTI4IiBoZWlnaHQ9IjEyOCIgdmlld0JveD0iMCAwIDEyOCAxMjgiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+PHJlY3Qgd2lkdGg9IjEyOCIgaGVpZ2h0PSIxMjgiIGZpbGw9IiMxYTFhMmUiLz48cG9seWdvbiBwb2ludHM9IjUwLDQwIDUwLDg4IDkwLDY0IiBmaWxsPSJyZ2JhKDI1NSwyNTUsMjU1LDAuNSkiLz48dGV4dCB4PSI2NCIgeT0iMTEwIiBmb250LWZhbWlseT0iQXJpYWwiIGZvbnQtc2l6ZT0iMTIiIGZpbGw9InJnYmEoMjU1LDI1NSwyNTUsMC41KSIgdGV4dC1hbmNob3I9Im1pZGRsZSI+VklERU88L3RleHQ+PC9zdmc+';
                thumb.alt = 'Video';
            }
            thumb.className = 'st-chatu8-preview-thumbnail';
            thumb.dataset.index = String(index);
            thumb.onclick = () => updateLargeImage(index);
            thumbnailContainer.appendChild(thumb);
        });

        // 删除后重新获取当前应该显示的图片
        if (images.length > 0) {
            let newIndex = currentIndex;
            if (newIndex >= images.length) {
                newIndex = images.length - 1;
            }
            updateLargeImage(newIndex);

            // 同时更新聊天中的元素（检查类型是否变化）
            const [newImgSrc, change, , isVideoNew, origUrl] = await getItemImg(tag, newIndex);
            if (newImgSrc) {
                const newIsVideo = isVideoNew || false;
                const originalIsVideo = img.tagName === 'VIDEO';

                if (newIsVideo !== originalIsVideo) {
                    const collapseWrapper = img.closest('.st-chatu8-collapse-wrapper');
                    const imageContainer = img.closest('.st-chatu8-image-container');
                    const spanContainer = collapseWrapper
                        ? collapseWrapper.parentElement
                        : imageContainer?.parentElement;

                    if (spanContainer) {
                        createAndShowImage(spanContainer, newImgSrc, 'Generated Image', button, change, newIsVideo, origUrl || '');
                    }
                } else {
                    if (img.tagName === 'VIDEO' && newImgSrc.startsWith('data:')) {
                        applyVideoSrc(img, newImgSrc, origUrl || '');
                    } else {
                        img.src = newImgSrc;
                    }
                }
            }
        }
    };

    /**
     * 构建一个 slide 槽位（prev / current / next 各一个）。index 为 null 表示空槽。
     * @param {number|null} index
     * @returns {HTMLDivElement}
     */
    function buildSlot(index) {
        const slot = doc.createElement('div');
        slot.className = 'st-chatu8-preview-slot';
        slot.style.cssText = `
            flex: 0 0 33.3333%;
            width: 33.3333%;
            height: 100%;
            display: flex;
            align-items: center;
            justify-content: center;
            overflow: hidden;
            box-sizing: border-box;
        `;
        if (index === null || index < 0 || index >= images.length) return slot;
        const blob = images[index];
        if (!blob) return slot;
        const isVideo = !!(mediaInfos[index] && mediaInfos[index].isVideo);
        const blobUrl = window.top['URL'].createObjectURL(blob);
        let el;
        if (isVideo) {
            el = doc.createElement('video');
            el.src = blobUrl;
            el.controls = true;
            el.loop = true;
            el.muted = true;
            el.playsInline = true;
            // 仅中间 slot（即当前）自动播放，由调用方设置
            el.onerror = function () {
                console.warn('[iframe] Preview video cannot be played');
                const fallback = doc.createElement('div');
                fallback.style.cssText = `
                    display: flex;
                    flex-direction: column;
                    align-items: center;
                    justify-content: center;
                    background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%);
                    border-radius: 8px;
                    padding: 40px;
                    min-height: 200px;
                    color: #fff;
                    text-align: center;
                `;
                fallback.innerHTML = `
                    <div style="font-size: 64px; margin-bottom: 15px;">🎬</div>
                    <div style="margin-bottom: 15px; opacity: 0.8;">视频格式不支持浏览器播放</div>
                    <a href="${blobUrl}" download="video.mp4"
                       style="background: rgba(255,255,255,0.2); padding: 12px 24px; border-radius: 4px; color: #fff; text-decoration: none;"
                       onclick="event.stopPropagation()">
                        📥 下载视频
                    </a>
                `;
                fallback.className = 'st-chatu8-preview-large-image';
                fallback.dataset.index = String(index);
                if (el.parentNode) el.parentNode.replaceChild(fallback, el);
            };
        } else {
            el = doc.createElement('img');
            el.src = blobUrl;
            el.draggable = false;
        }
        el.className = 'st-chatu8-preview-large-image';
        el.style.cssText = `
            max-width: 100%;
            max-height: 100%;
            object-fit: contain;
            border-radius: 8px;
            user-select: none;
            -webkit-user-drag: none;
        `;
        el.dataset.index = String(index);
        slot.appendChild(el);
        return slot;
    }

    /** 回收 track 中所有 blob: URL，避免内存泄漏 */
    function revokeTrackBlobUrls() {
        track.querySelectorAll('img, video').forEach((el) => {
            if (el.src && el.src.startsWith('blob:')) {
                try { window.top['URL'].revokeObjectURL(el.src); } catch (_) { /* noop */ }
            }
            if (el.tagName === 'VIDEO') {
                try { el.pause(); el.src = ''; el.load(); } catch (_) { /* noop */ }
            }
        });
    }

    // 切换请求 token：快速连点时只保留最新一次
    let updateToken = 0;

    async function updateLargeImage(index) {
        if (!(index >= 0 && index < images.length)) return;
        const myToken = ++updateToken;

        // 同步更新 currentIndex，避免在解码完成前关闭预览时读取到上一张索引（锁定上一张的 bug）
        // 多次快速切换时由 token 机制兜底，最终 currentIndex 与最后一次意图一致。
        currentIndex = index;

        const n = images.length;
        const prevIdx = n > 1 ? (index - 1 + n) % n : null;
        const nextIdx = n > 1 ? (index + 1) % n : null;

        // 先把新中心 slot 离屏构建出来，并等待其图片解码完成（视频直接跳过）
        const currentSlot = buildSlot(index);
        const centerMedia = currentSlot.querySelector('img, video');
        if (centerMedia && centerMedia.tagName === 'IMG') {
            try {
                if (typeof centerMedia.decode === 'function') {
                    await centerMedia.decode();
                } else if (!centerMedia.complete) {
                    await new Promise((resolve) => {
                        centerMedia.onload = resolve;
                        centerMedia.onerror = resolve;
                    });
                }
            } catch (_) { /* decode 失败时照常继续，避免永久卡住 */ }
        }

        // 期间若有更新的切换请求到来，丢弃当前结果并回收其 blob URL
        if (myToken !== updateToken) {
            revokeSlotBlobUrls(currentSlot);
            return;
        }

        currentIndex = index;

        // 更新计数器
        imageCounter.textContent = `${currentIndex + 1} / ${images.length}`;

        // 更新导航按钮可见性（只有一张图时隐藏）
        const showNav = images.length > 1;
        prevButton.style.display = showNav ? 'flex' : 'none';
        nextButton.style.display = showNav ? 'flex' : 'none';

        // 一次性替换 track 内容：由于中心图已解码，浏览器合并后绘制不会出现空白帧
        revokeTrackBlobUrls();
        track.innerHTML = '';
        track.appendChild(buildSlot(prevIdx));
        track.appendChild(currentSlot);
        track.appendChild(buildSlot(nextIdx));

        // 复位 track 到中间，无过渡
        track.style.transition = 'none';
        track.style.transform = CENTER;
        // 强制回流使下次 transition 生效
        void track.offsetWidth;

        // 指向当前 slide 的媒体元素，供下载/删除逻辑使用
        largeMedia = centerMedia;
        // 重置缩放/平移状态（新图默认 1x 居中）
        if (typeof imageContainer.__resetZoom === 'function') {
            imageContainer.__resetZoom();
        }
        if (largeMedia && largeMedia.tagName === 'VIDEO') {
            try { largeMedia.play(); } catch (_) { /* noop */ }
        }

        /** @type {NodeListOf<HTMLImageElement>} */
        const thumbnails = thumbnailContainer.querySelectorAll('.st-chatu8-preview-thumbnail');
        thumbnails.forEach((thumb, i) => {
            thumb.classList.toggle('active', i === index);
        });
        if (thumbnails[index]) {
            thumbnails[index].scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
        }
    }

    // Click handlers for prev/next buttons are now inside the !isMobile block

    // 使用合并排序后的图片数组
    (async () => {
        const md5 = CryptoJS.MD5(currentTag).toString();
        const merged = await dbs.getMergedAndSortedImages(md5);

        if (merged.images.length === 0) {
            return;
        }

        // 填充 mediaInfos 数组
        mediaInfos = merged.images.map(entry => ({
            isVideo: entry.isVideo || false
        }));

        // 按时间排序后，获取每个图片/视频的 Blob
        const blobPromises = merged.images.map(async (imageEntry) => {
            const isVideo = imageEntry.isVideo || false;
            if (imageEntry.source === 'server' && imageEntry.path) {
                try {
                    const response = await fetch(imageEntry.path);
                    if (response.ok) {
                        return await response.blob();
                    }
                } catch (error) {
                    console.error('Failed to fetch media blob:', error);
                }
            } else if (imageEntry.source === 'db' && imageEntry.uuid) {
                const imageData = await dbs.storeReadOnly(imageEntry.uuid);
                if (imageData && imageData.data) {
                    // 根据是否为视频设置正确的 MIME 类型
                    const mimeType = isVideo ? 'video/mp4' : 'image/png';
                    return new Blob([imageData.data], { type: mimeType });
                }
            }
            return null;
        });

        const allBlobs = await Promise.all(blobPromises);

        // 过滤掉 null 值，同时保持 mediaInfos 同步
        const validIndices = [];
        images = allBlobs.filter((b, i) => {
            if (b !== null) {
                validIndices.push(i);
                return true;
            }
            return false;
        });
        mediaInfos = validIndices.map(i => mediaInfos[i]);

        if (images.length > 0) {
            // 获取正确的缩略图：视频需要使用 thumbnail_uuid 或 thumbnail_path，图片可以直接使用原图
            const filteredMergedImages = validIndices.map(i => merged.images[i]);

            const thumbnailPromises = filteredMergedImages.map(async (imageEntry, index) => {
                const isVideo = imageEntry.isVideo || false;

                // 如果是视频，必须使用缩略图
                if (isVideo) {
                    // 优先使用服务器缩略图路径
                    if (imageEntry.source === 'server' && imageEntry.thumbnail_path) {
                        try {
                            const response = await fetch(imageEntry.thumbnail_path);
                            if (response.ok) {
                                return await response.blob();
                            }
                        } catch (error) {
                            console.warn('[iframe] Failed to fetch video thumbnail from server:', error);
                        }
                    }

                    // 其次使用 IndexedDB 中的缩略图
                    if (imageEntry.thumbnail_uuid) {
                        const thumbnailBlob = await dbs.getImageThumbnailBlobByUUID(imageEntry.thumbnail_uuid);
                        if (thumbnailBlob) {
                            return thumbnailBlob;
                        }
                    }

                    // 没有缩略图，返回 null（会使用默认占位图）
                    console.warn('[iframe] No thumbnail available for video, index:', index);
                    return null;
                }

                // 图片可以直接使用原图作为缩略图
                return images[index];
            });

            const thumbnailBlobs = await Promise.all(thumbnailPromises);

            thumbnailBlobs.forEach((thumbnailBlob, index) => {
                const thumb = doc.createElement('img');
                if (thumbnailBlob) {
                    thumb.src = window.top['URL'].createObjectURL(thumbnailBlob);
                } else {
                    // 视频没有缩略图时使用占位图
                    thumb.src = 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMTI4IiBoZWlnaHQ9IjEyOCIgdmlld0JveD0iMCAwIDEyOCAxMjgiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+PHJlY3Qgd2lkdGg9IjEyOCIgaGVpZ2h0PSIxMjgiIGZpbGw9IiMxYTFhMmUiLz48cG9seWdvbiBwb2ludHM9IjUwLDQwIDUwLDg4IDkwLDY0IiBmaWxsPSJyZ2JhKDI1NSwyNTUsMjU1LDAuNSkiLz48dGV4dCB4PSI2NCIgeT0iMTEwIiBmb250LWZhbWlseT0iQXJpYWwiIGZvbnQtc2l6ZT0iMTIiIGZpbGw9InJnYmEoMjU1LDI1NSwyNTUsMC41KSIgdGV4dC1hbmNob3I9Im1pZGRsZSI+VklERU88L3RleHQ+PC9zdmc+';
                    thumb.alt = 'Video';
                }
                thumb.className = 'st-chatu8-preview-thumbnail';
                thumb.dataset.index = String(index);
                thumb.onclick = () => updateLargeImage(index);
                thumbnailContainer.appendChild(thumb);
            });

            // 使用合并后的 currentIndex
            updateLargeImage(merged.currentIndex);
        }
    })();
}
