/**
 * assistantScreenCapture.js
 * 
 * 屏幕截图模块 —— 提供两种截图能力：
 *   1. 电脑屏幕共享（getDisplayMedia）—— 持续共享，每次发消息自动截帧
 *   2. 浏览器界面截图（getDisplayMedia 即时截取）—— 每次发消息时快速截一帧后释放
 * 
 * ⚠ 旧版使用 html2canvas（DOM 遍历重绘）会导致复杂页面卡死，
 *    现已全部改用原生 getDisplayMedia + Canvas 截帧，性能优异、不阻塞 UI。
 * 
 * 在用户发送消息时自动截取最新画面，作为图片附加到消息中。
 */

// ═══════════════════════════════════════════════════════════
//  状态管理
// ═══════════════════════════════════════════════════════════

/** 电脑屏幕共享是否开启 */
let screenShareEnabled = false;

/** 浏览器界面共享是否开启 */
let browserCaptureEnabled = false;

/** 活跃的屏幕共享 MediaStream（电脑屏幕共享 - 持续保持） */
let screenStream = null;

/** 活跃的浏览器标签页共享 MediaStream（浏览器界面共享 - 持续保持） */
let browserStream = null;

// ═══════════════════════════════════════════════════════════
//  Getter / Setter
// ═══════════════════════════════════════════════════════════

export function getScreenShareEnabled() { return screenShareEnabled; }
export function getBrowserCaptureEnabled() { return browserCaptureEnabled; }

export function setScreenShareEnabled(val) { screenShareEnabled = val; }
export function setBrowserCaptureEnabled(val) { browserCaptureEnabled = val; }

// ═══════════════════════════════════════════════════════════
//  平台检测
// ═══════════════════════════════════════════════════════════

/**
 * 检测当前浏览器是否支持 getDisplayMedia（屏幕共享）
 * @returns {boolean}
 */
export function isScreenShareSupported() {
    return !!(navigator.mediaDevices && navigator.mediaDevices.getDisplayMedia);
}

// ═══════════════════════════════════════════════════════════
//  图片压缩
// ═══════════════════════════════════════════════════════════

/**
 * 将 base64 图片压缩到指定质量和最大宽度
 * @param {string} base64 - 原始 base64 图片
 * @param {number} quality - JPEG 质量 (0-1)
 * @param {number} maxWidth - 最大宽度
 * @returns {Promise<string>} - 压缩后的 base64
 */
function compressImage(base64, quality = 0.6, maxWidth = 1920) {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => {
            let { width, height } = img;

            // 按比例缩小
            if (width > maxWidth) {
                height = Math.round(height * (maxWidth / width));
                width = maxWidth;
            }

            const canvas = document.createElement('canvas');
            canvas.width = width;
            canvas.height = height;

            const ctx = canvas.getContext('2d');
            ctx.drawImage(img, 0, 0, width, height);

            const compressed = canvas.toDataURL('image/jpeg', quality);
            resolve(compressed);
        };
        img.onerror = () => reject(new Error('图片压缩失败'));
        img.src = base64;
    });
}

// ═══════════════════════════════════════════════════════════
//  通用：从 MediaStream 截取一帧
// ═══════════════════════════════════════════════════════════

/**
 * 从 MediaStream 的视频轨道截取一帧图片
 * @param {MediaStream} stream - 活跃的 MediaStream
 * @param {number} jpegQuality - 初始 JPEG 质量
 * @param {number} compressQuality - 压缩后 JPEG 质量
 * @param {number} compressMaxWidth - 压缩后最大宽度
 * @returns {Promise<string|null>} base64 图片，失败返回 null
 */
async function captureFrameFromStream(stream, jpegQuality = 0.8, compressQuality = 0.6, compressMaxWidth = 1920) {
    if (!stream) return null;

    const track = stream.getVideoTracks()[0];
    if (!track || track.readyState !== 'live') {
        return null;
    }

    try {
        // 优先使用 ImageCapture API（更快、不需要创建 video 元素）
        if (typeof ImageCapture !== 'undefined') {
            const imageCapture = new ImageCapture(track);
            const bitmap = await imageCapture.grabFrame();

            const canvas = document.createElement('canvas');
            canvas.width = bitmap.width;
            canvas.height = bitmap.height;
            canvas.getContext('2d').drawImage(bitmap, 0, 0);
            bitmap.close();

            const raw = canvas.toDataURL('image/jpeg', jpegQuality);
            return await compressImage(raw, compressQuality, compressMaxWidth);
        }

        // Fallback: 使用 video 元素截帧
        return await captureFrameViaVideo(track, jpegQuality, compressQuality, compressMaxWidth);
    } catch (err) {
        console.warn('[ScreenCapture] ImageCapture 截帧失败，尝试 video fallback:', err.message);
        try {
            return await captureFrameViaVideo(track, jpegQuality, compressQuality, compressMaxWidth);
        } catch (err2) {
            console.error('[ScreenCapture] video fallback 截帧也失败:', err2.message);
            return null;
        }
    }
}

/**
 * 通过创建 video 元素的方式截取帧（ImageCapture 不可用时的 fallback）
 * @param {MediaStreamTrack} track
 * @param {number} jpegQuality
 * @param {number} compressQuality
 * @param {number} compressMaxWidth
 * @returns {Promise<string>} base64
 */
function captureFrameViaVideo(track, jpegQuality = 0.8, compressQuality = 0.6, compressMaxWidth = 1920) {
    return new Promise((resolve, reject) => {
        const video = document.createElement('video');
        video.srcObject = new MediaStream([track]);
        video.muted = true;
        video.playsInline = true;

        // 设置超时避免永远等待
        const timeout = setTimeout(() => {
            video.srcObject = null;
            reject(new Error('video 截帧超时'));
        }, 3000);

        video.onloadedmetadata = () => {
            video.play().then(() => {
                // 等一帧确保画面渲染
                requestAnimationFrame(() => {
                    const canvas = document.createElement('canvas');
                    canvas.width = video.videoWidth;
                    canvas.height = video.videoHeight;
                    canvas.getContext('2d').drawImage(video, 0, 0);

                    video.pause();
                    video.srcObject = null;
                    clearTimeout(timeout);

                    const raw = canvas.toDataURL('image/jpeg', jpegQuality);
                    compressImage(raw, compressQuality, compressMaxWidth).then(resolve).catch(reject);
                });
            }).catch(err => {
                clearTimeout(timeout);
                video.srcObject = null;
                reject(err);
            });
        };

        video.onerror = () => {
            clearTimeout(timeout);
            video.srcObject = null;
            reject(new Error('video 元素加载失败'));
        };
    });
}

// ═══════════════════════════════════════════════════════════
//  电脑屏幕共享（getDisplayMedia - 持续共享）
// ═══════════════════════════════════════════════════════════

/**
 * 启动电脑屏幕共享
 * 调用 getDisplayMedia 让用户选择共享源，保持 MediaStream 活跃。
 * @returns {Promise<boolean>} 是否成功启动
 */
export async function startScreenShare() {
    if (!isScreenShareSupported()) {
        console.warn('[ScreenCapture] 当前浏览器不支持 getDisplayMedia');
        toastr?.warning('当前浏览器不支持屏幕共享功能');
        return false;
    }

    // 如果已有流，先关闭
    if (screenStream) {
        stopScreenShare();
    }

    try {
        screenStream = await navigator.mediaDevices.getDisplayMedia({
            video: {
                frameRate: { max: 2 }, // 低帧率，仅用于截图
                width: { ideal: 1920 },
                height: { ideal: 1080 }
            },
            audio: false
        });

        // 监听用户在浏览器层面停止共享（比如点击 "停止共享" 按钮）
        const track = screenStream.getVideoTracks()[0];
        if (track) {
            track.onended = () => {
                console.log('[ScreenCapture] 用户停止了屏幕共享');
                screenShareEnabled = false;
                screenStream = null;
                // 触发自定义事件通知 UI 更新
                window.dispatchEvent(new CustomEvent('screen-share-stopped'));
            };
        }

        screenShareEnabled = true;
        console.log('[ScreenCapture] 屏幕共享已启动');
        return true;
    } catch (err) {
        console.warn('[ScreenCapture] 用户拒绝或无法启动屏幕共享:', err.message);
        if (err.name === 'NotAllowedError') {
            toastr?.info('已取消屏幕共享');
        } else {
            toastr?.error(`屏幕共享启动失败: ${err.message}`);
        }
        return false;
    }
}

/**
 * 停止电脑屏幕共享
 */
export function stopScreenShare() {
    if (screenStream) {
        screenStream.getTracks().forEach(track => track.stop());
        screenStream = null;
    }
    screenShareEnabled = false;
    console.log('[ScreenCapture] 屏幕共享已停止');
}

/**
 * 从活跃的电脑屏幕共享 MediaStream 中截取一帧画面
 * @returns {Promise<string|null>} base64 图片，失败返回 null
 */
async function captureScreenFrame() {
    if (!screenStream || !screenShareEnabled) return null;

    const track = screenStream.getVideoTracks()[0];
    if (!track || track.readyState !== 'live') {
        console.warn('[ScreenCapture] 屏幕共享 track 已失效');
        stopScreenShare();
        window.dispatchEvent(new CustomEvent('screen-share-stopped'));
        return null;
    }

    return captureFrameFromStream(screenStream, 0.8, 0.6, 1920);
}

// ═══════════════════════════════════════════════════════════
//  浏览器界面截图（getDisplayMedia - 持续共享当前标签页）
// ═══════════════════════════════════════════════════════════

/**
 * 启动浏览器界面共享。
 * 
 * 使用 getDisplayMedia 让用户选择共享当前浏览器标签页，
 * 保持 MediaStream 活跃，每次发消息时直接从流中截帧。
 * 
 * 相比旧版 html2canvas（遍历 DOM 重绘）：
 *   - 不阻塞 UI，不会卡顿
 *   - 截图速度极快（毫秒级）
 *   - 截取的是真实渲染画面（含 CSS 动画、canvas、video 等）
 * 
 * @returns {Promise<boolean>} 是否成功
 */
export async function startBrowserCapture() {
    if (!isScreenShareSupported()) {
        console.warn('[ScreenCapture] 当前浏览器不支持 getDisplayMedia');
        toastr?.warning('当前浏览器不支持界面截图功能');
        return false;
    }

    // 如果已有流，先关闭
    if (browserStream) {
        stopBrowserCapture();
    }

    try {
        // preferCurrentTab: true 让浏览器优先提示用户共享当前标签页
        const displayMediaOptions = {
            video: {
                frameRate: { max: 2 },
                width: { ideal: 1920 },
                height: { ideal: 1080 }
            },
            audio: false,
            // Chrome 107+ 支持 preferCurrentTab
            preferCurrentTab: true
        };

        // 部分浏览器支持 selfBrowserSurface 参数
        // 用于控制是否在共享选择器中包含当前标签页
        try {
            // @ts-ignore - selfBrowserSurface 是较新的 API
            displayMediaOptions.selfBrowserSurface = 'include';
        } catch (_) { /* 忽略不支持的浏览器 */ }

        browserStream = await navigator.mediaDevices.getDisplayMedia(displayMediaOptions);

        // 监听用户停止共享
        const track = browserStream.getVideoTracks()[0];
        if (track) {
            track.onended = () => {
                console.log('[ScreenCapture] 用户停止了浏览器界面共享');
                browserCaptureEnabled = false;
                browserStream = null;
                window.dispatchEvent(new CustomEvent('browser-capture-stopped'));
            };
        }

        browserCaptureEnabled = true;
        console.log('[ScreenCapture] 浏览器界面共享已启动（原生 getDisplayMedia）');
        return true;
    } catch (err) {
        console.warn('[ScreenCapture] 用户拒绝或无法启动浏览器界面共享:', err.message);
        if (err.name === 'NotAllowedError') {
            toastr?.info('已取消浏览器界面共享');
        } else {
            toastr?.error(`浏览器界面共享启动失败: ${err.message}`);
        }
        return false;
    }
}

/**
 * 停止浏览器界面共享
 */
export function stopBrowserCapture() {
    if (browserStream) {
        browserStream.getTracks().forEach(track => track.stop());
        browserStream = null;
    }
    browserCaptureEnabled = false;
    console.log('[ScreenCapture] 浏览器界面共享已停止');
}

/**
 * 从活跃的浏览器标签页共享 MediaStream 中截取一帧画面。
 * 
 * 截图过程完全在 GPU/合成器层面完成，不会遍历 DOM，
 * 因此不会阻塞 UI 线程，不会导致页面卡顿。
 * 
 * @returns {Promise<string|null>} base64 图片，失败返回 null
 */
async function captureBrowserPage() {
    if (!browserCaptureEnabled || !browserStream) return null;

    const track = browserStream.getVideoTracks()[0];
    if (!track || track.readyState !== 'live') {
        console.warn('[ScreenCapture] 浏览器界面共享 track 已失效');
        stopBrowserCapture();
        window.dispatchEvent(new CustomEvent('browser-capture-stopped'));
        return null;
    }

    return captureFrameFromStream(browserStream, 0.7, 0.5, 1280);
}

// ═══════════════════════════════════════════════════════════
//  统一截图入口（供 handleSend 调用）
// ═══════════════════════════════════════════════════════════

/**
 * 根据当前开关状态，获取需要自动附加的截图。
 * 返回的图片数组格式兼容 selectedImages：{ name, type, data }
 * 
 * @returns {Promise<Array<{name: string, type: string, data: string}>>}
 */
export async function captureForMessage() {
    const captures = [];

    // 并行截取（两个操作相互独立）
    const promises = [];

    if (screenShareEnabled && screenStream) {
        promises.push(
            captureScreenFrame()
                .then(base64 => {
                    if (base64) {
                        captures.push({
                            name: `屏幕截图_${Date.now()}.jpg`,
                            type: 'image/jpeg',
                            data: base64
                        });
                    }
                })
                .catch(err => {
                    console.warn('[ScreenCapture] 电脑屏幕截图失败:', err.message);
                })
        );
    }

    if (browserCaptureEnabled && browserStream) {
        promises.push(
            captureBrowserPage()
                .then(base64 => {
                    if (base64) {
                        captures.push({
                            name: `浏览器截图_${Date.now()}.jpg`,
                            type: 'image/jpeg',
                            data: base64
                        });
                    }
                })
                .catch(err => {
                    console.warn('[ScreenCapture] 浏览器界面截图失败:', err.message);
                })
        );
    }

    if (promises.length > 0) {
        await Promise.all(promises);
    }

    return captures;
}

// ═══════════════════════════════════════════════════════════
//  初始化
// ═══════════════════════════════════════════════════════════

/**
 * 初始化屏幕截图模块的事件监听。
 * 在 initAiAssistant() 中调用。
 */
export function initScreenCaptureEvents() {
    // 监听屏幕共享停止事件（来自 track.onended）
    window.addEventListener('screen-share-stopped', () => {
        const checkbox = document.getElementById('chatu8-ai-screen-share');
        if (checkbox) {
            checkbox.checked = false;
        }
        // 更新状态指示图标
        updateScreenShareIndicator(false);
    });

    // 监听浏览器界面共享停止事件（来自 track.onended）
    window.addEventListener('browser-capture-stopped', () => {
        const checkbox = document.getElementById('chatu8-ai-browser-capture');
        if (checkbox) {
            checkbox.checked = false;
        }
        updateBrowserCaptureIndicator(false);
    });

    // 绑定设置面板中的开关事件
    bindScreenShareToggle();
    bindBrowserCaptureToggle();

    // 手机端自动隐藏不支持的开关
    if (!isScreenShareSupported()) {
        const screenShareItem = document.getElementById('chatu8-ai-screen-share-item');
        if (screenShareItem) {
            screenShareItem.style.display = 'none';
        }
        // 浏览器界面截图也依赖 getDisplayMedia，不支持时也隐藏
        const browserCaptureItem = document.getElementById('chatu8-ai-browser-capture-item');
        if (browserCaptureItem) {
            browserCaptureItem.style.display = 'none';
        }
    }

    console.log('[ScreenCapture] 模块初始化完成',
        `| getDisplayMedia: ${isScreenShareSupported() ? '✓' : '✗'}`);
}

/**
 * 绑定"共享电脑屏幕"开关事件
 */
function bindScreenShareToggle() {
    const checkbox = document.getElementById('chatu8-ai-screen-share');
    if (!checkbox) return;

    checkbox.addEventListener('change', async function () {
        if (this.checked) {
            const success = await startScreenShare();
            if (!success) {
                this.checked = false;
            }
        } else {
            stopScreenShare();
        }
        updateScreenShareIndicator(this.checked);
    });
}

/**
 * 绑定"共享浏览器界面"开关事件
 */
function bindBrowserCaptureToggle() {
    const checkbox = document.getElementById('chatu8-ai-browser-capture');
    if (!checkbox) return;

    checkbox.addEventListener('change', async function () {
        if (this.checked) {
            const success = await startBrowserCapture();
            if (!success) {
                this.checked = false;
            }
        } else {
            stopBrowserCapture();
        }
        updateBrowserCaptureIndicator(this.checked);
    });
}

// ═══════════════════════════════════════════════════════════
//  状态指示图标更新
// ═══════════════════════════════════════════════════════════

/**
 * 更新电脑屏幕共享指示图标
 * @param {boolean} active
 */
export function updateScreenShareIndicator(active) {
    const indicator = document.getElementById('st-chatu8-ai-screen-share-indicator');
    if (indicator) {
        indicator.style.display = active ? 'inline-flex' : 'none';
        indicator.title = active ? '电脑屏幕共享中（点击关闭）' : '';
    }
}

/**
 * 更新浏览器界面共享指示图标
 * @param {boolean} active
 */
export function updateBrowserCaptureIndicator(active) {
    const indicator = document.getElementById('st-chatu8-ai-browser-capture-indicator');
    if (indicator) {
        indicator.style.display = active ? 'inline-flex' : 'none';
        indicator.title = active ? '浏览器界面共享中（点击关闭）' : '';
    }
}

/**
 * 绑定指示图标的点击事件（点击可快速关闭共享）
 */
export function bindIndicatorClickEvents() {
    const screenIndicator = document.getElementById('st-chatu8-ai-screen-share-indicator');
    if (screenIndicator) {
        screenIndicator.addEventListener('click', () => {
            stopScreenShare();
            updateScreenShareIndicator(false);
            const checkbox = document.getElementById('chatu8-ai-screen-share');
            if (checkbox) checkbox.checked = false;
        });
    }

    const browserIndicator = document.getElementById('st-chatu8-ai-browser-capture-indicator');
    if (browserIndicator) {
        browserIndicator.addEventListener('click', () => {
            stopBrowserCapture();
            updateBrowserCaptureIndicator(false);
            const checkbox = document.getElementById('chatu8-ai-browser-capture');
            if (checkbox) checkbox.checked = false;
        });
    }
}
