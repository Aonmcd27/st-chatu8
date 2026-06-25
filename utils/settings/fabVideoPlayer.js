// @ts-nocheck

/**
 * 创建隐藏�?video 元素
 */
function createHiddenVideo(src, id) {
    const video = document.createElement('video');
    video.id = id;
    video.style.display = 'none';
    video.loop = false; // �?不循环，播放到最后一帧暂�?
    video.muted = true;
    video.autoplay = false;
    video.playsInline = true;
    video.preload = 'auto';

    // 正确编码 URL 中的中文字符
    // 将路径分割，只编码文件名部分
    const pathParts = src.split('/');
    const encodedParts = pathParts.map((part, index) => {
        // 最后一部分是文件名，需要编码
        if (index === pathParts.length - 1) {
            return encodeURIComponent(part);
        }
        return part;
    });
    video.src = encodedParts.join('/');

    // �?强制确认 loop 属�?
    //console.log(`[Create] 创建视频元素: ${id}, loop=${video.loop}`);

    // �?监听所有可能的事件来调�?
    video.addEventListener('ended', () => {
        //console.log(`[Event] 🎬 ENDED 事件触发: ${id}`);
        //console.log(`[Event] 当前状�?- currentTime: ${video.currentTime}, duration: ${video.duration}, paused: ${video.paused}, loop: ${video.loop}`);
    });

    video.addEventListener('pause', () => {
        //console.log(`[Event] ⏸️  PAUSE 事件触发: ${id}, currentTime: ${video.currentTime.toFixed(3)}s`);
    });

    video.addEventListener('play', () => {
        //console.log(`[Event] ▶️  PLAY 事件触发: ${id}, currentTime: ${video.currentTime.toFixed(3)}s`);
    });

    video.addEventListener('seeking', () => {
        //console.log(`[Event] 🔍 SEEKING 事件触发: ${id}, currentTime: ${video.currentTime.toFixed(3)}s`);
    });

    video.addEventListener('seeked', () => {
        //console.log(`[Event] �?SEEKED 事件触发: ${id}, currentTime: ${video.currentTime.toFixed(3)}s`);
    });

    document.body.appendChild(video);

    // �?再次确认 loop 属性没有被改变
    setTimeout(() => {
        if (video.loop !== false) {
            //console.error(`[Create] �?警告: ${id} �?loop 属性被改变了！现在�?${video.loop}`);
            video.loop = false;
        }
    }, 100);

    return video;
}

/**
 * 视频播放器组件（Canvas 渲染版本�?
 * 使用 Canvas 逐帧渲染视频，支持透明度检测和精确点击
 * 使用�?video 元素预加载方案，实现即时切换
 */

export function createVideoPlayer(container, options) {
    const { idleVideoSrc, draggingVideoSrc, onError } = options;

    // �?创建两个 video 元素，预加载两个视频
    const idleVideo = createHiddenVideo(idleVideoSrc, 'st-chatu8-fab-video-idle');
    const draggingVideo = createHiddenVideo(draggingVideoSrc, 'st-chatu8-fab-video-dragging');

    // 创建 canvas 元素用于渲染
    const canvasElement = document.createElement('canvas');
    canvasElement.id = 'st-chatu8-fab-video-canvas';
    canvasElement.className = 'st-chatu8-fab-video';

    // 应用 CSS 样式 - 让 canvas 填满容器，但通过 hitTest 只响应视频内容区域
    canvasElement.style.width = '100%';
    canvasElement.style.height = '100%';
    canvasElement.style.position = 'absolute';
    canvasElement.style.top = '0';
    canvasElement.style.left = '0';
    canvasElement.style.pointerEvents = 'none';
    canvasElement.style.display = 'block';
    canvasElement.style.zIndex = '2';

    //console.log('Canvas element created with styles:', {
    //     width: canvasElement.style.width,
    //     height: canvasElement.style.height,
    //     position: canvasElement.style.position,
    //     display: canvasElement.style.display
    // });

    // 获取 2D 上下文，启用频繁读取优化
    const ctx = canvasElement.getContext('2d', {
        willReadFrequently: true,
        alpha: true
    });

    // �?离屏 canvas 用于双缓冲（防止空帧闪烁�?
    const offscreen = document.createElement('canvas');
    const offCtx = offscreen.getContext('2d', { alpha: true });

    // �?方案二：为每个视频创建克隆，用于无缝切换
    const idleVideoClone = createHiddenVideo(idleVideoSrc, 'st-chatu8-fab-video-idle-clone');
    const draggingVideoClone = createHiddenVideo(draggingVideoSrc, 'st-chatu8-fab-video-dragging-clone');

    // 内部状�?
    const state = {
        currentVideo: 'idle',
        isPlaying: false,
        isLoaded: false,
        hasError: false,
        idleVideoSrc,
        draggingVideoSrc,
        container,
        idleVideo,           // �?静息视频元素
        draggingVideo,       // �?拖动视频元素
        idleVideoClone,      // �?静息视频克隆（用于切换）
        draggingVideoClone,  // �?拖动视频克隆（用于切换）
        activeVideo: idleVideo, // �?当前活跃的视频源
        canvasElement,
        ctx,
        offscreen,           // �?离屏 canvas
        offCtx,              // �?离屏 context
        rafId: null,
        resolution: 2, // 高清屏倍数
        loadedCount: 0 // 已加载的视频数量
    };

    // 统一的加载完成处�?
    const onVideoLoaded = (video) => {
        //console.log(`[Load] �?视频加载成功: ${video.id}`);
        //console.log(`[Load] 视频信息 - 尺寸: ${video.videoWidth}x${video.videoHeight}, 时长: ${video.duration.toFixed(3)}s`);
        //console.log(`[Load] 视频状�?- readyState: ${video.readyState}, networkState: ${video.networkState}`);

        state.loadedCount++;
        //console.log(`[Load] 加载进度: ${state.loadedCount}/4`);

        // �?四个视频都加载完成后才开始渲染（主视�?+ 克隆视频�?
        if (state.loadedCount === 4 && !state.isLoaded) {
            state.isLoaded = true;
            state.hasError = false;

            //console.log(`\n[Load] 🎉 所有视频加载完成！`);

            // 设置 canvas 尺寸
            updateCanvasSize(state);

            // 隐藏占位符图�?
            const icon = container.querySelector('i');
            if (icon) {
                icon.style.display = 'none';
                //console.log('[Load] �?占位符图标已隐藏');
            }

            // 开始播�?
            state.isPlaying = true;
            //console.log('[Load] �?isPlaying = true');

            // �?播放静息视频，其他视频预加载到第一帧待�?
            //console.log(`\n╔═══════════════════════════════════════════════════════════╗`);
            //console.log(`�?             所有视频加载完�?- 开始初始化                 ║`);
            //console.log(`╚═══════════════════════════════════════════════════════════╝`);

            idleVideo.play().then(() => {
                // //console.log(`[Init] �?静息视频开始播�? ${idleVideo.id}`);
                // //console.log(`[Init] 视频状�?- duration: ${idleVideo.duration.toFixed(3)}s, readyState: ${idleVideo.readyState}`);
                // //console.log(`[Init] 当前 activeVideo: ${state.activeVideo.id}`);

                // //console.log(`\n[Init] 🎨 启动渲染循环...`);
                startRenderLoop(state);
            }).catch(err => {
                //console.error('[Init] �?静息视频播放失败:', err);
                state.isPlaying = false;
            });

            // �?预加载所有克隆视频到第一�?
            //console.log(`\n[Init] 📦 预加载克隆视频到第一�?..`);
            preloadVideoToFirstFrame(idleVideoClone);
            preloadVideoToFirstFrame(draggingVideo);
            preloadVideoToFirstFrame(draggingVideoClone);

            //console.log(`\n[Init] �?所有视频初始化完成！`);
            //console.log(`[Init] 视频状态总览:`);
            //console.log(`  - ${idleVideo.id}: 播放中`);
            //console.log(`  - ${idleVideoClone.id}: 待命`);
            //console.log(`  - ${draggingVideo.id}: 待命`);
            //console.log(`  - ${draggingVideoClone.id}: 待命\n`);
        }
    };

    // 为四个视频添加事件监�?
    idleVideo.addEventListener('loadeddata', () => onVideoLoaded(idleVideo));
    draggingVideo.addEventListener('loadeddata', () => onVideoLoaded(draggingVideo));
    idleVideoClone.addEventListener('loadeddata', () => onVideoLoaded(idleVideoClone));
    draggingVideoClone.addEventListener('loadeddata', () => onVideoLoaded(draggingVideoClone));

    idleVideo.addEventListener('error', () => onVideoError(idleVideo));
    draggingVideo.addEventListener('error', () => onVideoError(draggingVideo));
    idleVideoClone.addEventListener('error', () => onVideoError(idleVideoClone));
    draggingVideoClone.addEventListener('error', () => onVideoError(draggingVideoClone));

    // �?监听视频播放结束事件，切换到克隆视频
    const setupEndedHandler = (video, clone) => {
        video.addEventListener('ended', () => {
            //console.log(`\n`);
            //console.log(`╔═══════════════════════════════════════════════════════════╗`);
            //console.log(`�?          视频播放结束 - 准备切换                          ║`);
            //console.log(`╚═══════════════════════════════════════════════════════════╝`);
            //console.log(`[Ended] 🎬 视频播放完毕: ${video.id}`);
            //console.log(`[Ended] 视频时长: ${video.duration.toFixed(3)}s`);
            //console.log(`[Ended] 当前时间: ${video.currentTime.toFixed(3)}s`);
            //console.log(`[Ended] readyState: ${video.readyState}`);
            //console.log(`[Ended] paused: ${video.paused}`);
            //console.log(`\n[Switch] 🔄 准备切换到克隆视�? ${clone.id}`);
            //console.log(`[Switch] 克隆视频状�?- currentTime: ${clone.currentTime.toFixed(3)}s, readyState: ${clone.readyState}, paused: ${clone.paused}`);

            // 切换到克隆视�?
            const oldActive = state.activeVideo;
            state.activeVideo = clone;
            //console.log(`[Switch] �?activeVideo 已切�? ${oldActive.id} �?${clone.id}`);

            clone.currentTime = 0;
            //console.log(`[Switch] 克隆视频重置到开�? currentTime = 0`);

            clone.play().then(() => {
                //console.log(`[Switch] �?克隆视频开始播�? ${clone.id}`);
                //console.log(`[Switch] 播放状�?- currentTime: ${clone.currentTime.toFixed(3)}s, readyState: ${clone.readyState}, paused: ${clone.paused}`);
                //console.log(`[Switch] 当前 activeVideo: ${state.activeVideo.id}`);

                // 重置旧视频到第一帧待�?
                setTimeout(() => {
                    //console.log(`\n[Cleanup] 🧹 开始清理旧视频: ${video.id}`);
                    preloadVideoToFirstFrame(video);
                    //console.log(`[Cleanup] �?旧视频已准备好下次循环\n`);
                }, 100);
            }).catch(err => {
                //console.error(`[Switch] �?克隆视频播放失败: ${clone.id}`);
                //console.error(`[Switch] 错误信息:`, err);
                //console.log(`[Switch] 克隆视频状�?- currentTime: ${clone.currentTime.toFixed(3)}s, readyState: ${clone.readyState}, paused: ${clone.paused}`);
            });
        });
    };

    //console.log(`\n[Setup] 📋 配置视频 ended 事件监听�?..`);

    // �?添加测试：验证事件监听器是否正确设置
    const testEndedEvent = (video) => {
        //console.log(`[Setup] 🧪 测试 ${video.id} �?ended 事件...`);
        const listeners = video.addEventListener ? 'supported' : 'not supported';
        //console.log(`[Setup] addEventListener: ${listeners}`);
        //console.log(`[Setup] 当前 loop 属�? ${video.loop}`);
    };

    setupEndedHandler(idleVideo, idleVideoClone);
    testEndedEvent(idleVideo);
    //console.log(`[Setup] �?${idleVideo.id} �?${idleVideoClone.id}`);

    setupEndedHandler(idleVideoClone, idleVideo);
    testEndedEvent(idleVideoClone);
    //console.log(`[Setup] �?${idleVideoClone.id} �?${idleVideo.id}`);

    setupEndedHandler(draggingVideo, draggingVideoClone);
    testEndedEvent(draggingVideo);
    //console.log(`[Setup] �?${draggingVideo.id} �?${draggingVideoClone.id}`);

    setupEndedHandler(draggingVideoClone, draggingVideo);
    testEndedEvent(draggingVideoClone);
    //console.log(`[Setup] �?${draggingVideoClone.id} �?${draggingVideo.id}\n`);

    // �?额外测试：手动触发一个测试事�?
    //console.log(`[Setup] 🧪 测试事件系统...`);
    idleVideo.addEventListener('timeupdate', () => {
        if (!state._timeUpdateLogged) {
            //console.log(`[Setup] �?timeupdate 事件正常工作`);
            state._timeUpdateLogged = true;
        }
    }, { once: true });

    // 统一的错误处理
    const onVideoError = (video) => {
        // 忽略初始化时的空 src 错误
        if (!video.src || video.src === window.location.href) {
            return;
        }

        const error = video.error;
        //console.error('Failed to load FAB video:', video.src);
        //console.error('Error code:', error ? error.code : 'unknown');
        //console.error('Error message:', error ? error.message : 'unknown');
        state.hasError = true;
        state.isLoaded = false;

        // 调用错误回调
        if (onError && typeof onError === 'function') {
            // 判断是哪个视频出错
            const videoType = video.src.includes(idleVideoSrc) ? 'idle' : 'dragging';
            onError(videoType, video.src);
        }

        // 回退到传统模式
        fallbackToTraditionalMode(state);
    };

    // �?移除备用循环机制，改用双视频交替播放
    // setupFallbackLoop(idleVideo);
    // setupFallbackLoop(draggingVideo);

    // �?canvas 添加到容�?
    container.appendChild(canvasElement);

    //console.log('Canvas appended to container:', {
    //     containerId: container.id,
    //     canvasInDOM: document.contains(canvasElement),
    //     canvasParent: canvasElement.parentElement?.id
    // });

    // 开始加载四个视�?
    //console.log('Loading videos:', idleVideoSrc, draggingVideoSrc);
    idleVideo.load();
    draggingVideo.load();
    idleVideoClone.load();
    draggingVideoClone.load();

    // 返回播放器实�?
    return {
        switchToIdleVideo: () => switchToIdleVideo(state),
        switchToDraggingVideo: () => switchToDraggingVideo(state),
        pause: () => pause(state),
        resume: () => resume(state),
        destroy: () => destroy(state),
        updateSize: (size) => updateSize(state, size),
        hitTest: (x, y) => hitTest(state, x, y),
        getState: () => state
    };
}

/**
 * 更新 Canvas 尺寸
 */
function updateCanvasSize(state) {
    //console.log('=== updateCanvasSize called ===');
    const container = state.container;
    const canvas = state.canvasElement;

    // �?强制回流，确保拿到最新的布局尺寸
    void container.offsetWidth;

    // 获取容器尺寸
    const containerWidth = container.offsetWidth;
    const containerHeight = container.offsetHeight;
    //console.log('Container dimensions:', containerWidth, 'x', containerHeight);

    // 保护：容器尺寸为 0 时跳�?
    if (containerWidth === 0 || containerHeight === 0) {
        //console.warn('Container has zero size, skipping canvas resize');
        return;
    }

    // 计算目标尺寸
    const targetWidth = containerWidth * state.resolution;
    const targetHeight = containerHeight * state.resolution;
    //console.log('Target canvas dimensions:', targetWidth, 'x', targetHeight);
    //console.log('Current canvas dimensions:', canvas.width, 'x', canvas.height);

    // �?避免无意义的重复更新
    if (canvas.width === targetWidth && canvas.height === targetHeight) {
        // 尺寸未变化，但仍然更�?CSS 样式（防止外部修改）
        canvas.style.width = containerWidth + 'px';
        canvas.style.height = containerHeight + 'px';
        //console.log('Canvas size unchanged, only updating CSS');
        return false; // 返回 false 表示尺寸未改�?
    }

    // �?先渲染当前帧到临�?canvas，避免闪�?
    let tempCanvas = null;
    if (state.activeVideo && state.activeVideo.readyState >= 2) {
        tempCanvas = document.createElement('canvas');
        tempCanvas.width = canvas.width;
        tempCanvas.height = canvas.height;
        const tempCtx = tempCanvas.getContext('2d');
        tempCtx.drawImage(canvas, 0, 0);
        //console.log('Saved current frame to temp canvas');
    }

    // 设置 canvas 显示尺寸
    canvas.style.width = containerWidth + 'px';
    canvas.style.height = containerHeight + 'px';

    // 设置 canvas 实际分辨率（高清屏）
    canvas.width = targetWidth;
    canvas.height = targetHeight;

    // �?同步离屏 canvas 尺寸
    state.offscreen.width = targetWidth;
    state.offscreen.height = targetHeight;

    // �?立即绘制临时保存的帧（缩放到新尺寸），避免空�?
    if (tempCanvas) {
        state.ctx.drawImage(tempCanvas, 0, 0, targetWidth, targetHeight);
        //console.log('Drew temp frame to resized canvas');
    }

    //console.log(`Canvas size updated: ${canvas.width}x${canvas.height} (display: ${containerWidth}x${containerHeight})`);
    //console.log('=== updateCanvasSize completed ===');
    return true; // 返回 true 表示尺寸已改�?
}

/**
 * 开始渲染循环（�?简化版：视频自动在 ended 事件中切换）
 */
function startRenderLoop(state) {
    if (state.rafId) {
        cancelAnimationFrame(state.rafId);
        state.rafId = null;
    }

    //console.log(`[Render] 🎬 启动渲染循环`);
    //console.log(`[Render] 初始 activeVideo: ${state.activeVideo.id}`);

    let frameCount = 0;
    let lastLogTime = Date.now();
    let lastVideoTime = 0;

    const render = () => {
        if (state.hasError || !state.isPlaying) {
            //console.log(`[Render] ⏹️  渲染循环停止`);
            //console.log(`[Render] 原因 - hasError: ${state.hasError}, isPlaying: ${state.isPlaying}`);
            return;
        }

        const video = state.activeVideo;

        // �?关键调试：检测视频是否接近结束或已结�?
        if (video.duration > 0) {
            const timeRemaining = video.duration - video.currentTime;

            // 当视频接近结束时（最�?.5秒），每帧都打印日志
            if (timeRemaining < 0.5) {
                //console.log(`[Render] ⚠️  视频接近结束: ${video.id}, 剩余: ${timeRemaining.toFixed(3)}s, ended: ${video.ended}, paused: ${video.paused}`);
            }

            // 检测视频是否已经结束但 ended 事件没触�?
            if (video.currentTime >= video.duration - 0.01 && !video.paused) {
                //console.warn(`[Render] 🚨 视频已到达末尾但未暂�? ${video.id}`);
                //console.warn(`[Render] currentTime: ${video.currentTime.toFixed(3)}s, duration: ${video.duration.toFixed(3)}s`);
                //console.warn(`[Render] ended: ${video.ended}, paused: ${video.paused}, loop: ${video.loop}`);
            }
        }

        renderSingleFrame(state);

        // �?300 帧或�?5 秒输出一次详细日�?
        const now = Date.now();
        if (frameCount % 300 === 0 || now - lastLogTime > 5000) {
            //console.log(`\n[Render] 📊 渲染状态报�?(Frame ${frameCount})`);
            //console.log(`[Render] 当前视频: ${video.id}`);
            //console.log(`[Render] 播放进度: ${video.currentTime.toFixed(3)}s / ${video.duration.toFixed(3)}s (${((video.currentTime / video.duration) * 100).toFixed(1)}%)`);
            //console.log(`[Render] 视频状�? readyState=${video.readyState}, paused=${video.paused}, ended=${video.ended}, loop=${video.loop}`);
            //console.log(`[Render] Canvas尺寸: ${state.canvasElement.width}x${state.canvasElement.height}`);
            //console.log(`[Render] 视频尺寸: ${video.videoWidth}x${video.videoHeight}\n`);
            lastLogTime = now;
        }

        frameCount++;
        lastVideoTime = video.currentTime;

        state.rafId = requestAnimationFrame(render);
    };

    render();
    //console.log(`[Render] �?渲染循环已启动\n`);
}

/**
 * 预加载视频到第一帧（暂停状态）
 */
function preloadVideoToFirstFrame(video) {
    //console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    //console.log(`[Preload] 开始预加载视频: ${video.id}`);
    //console.log(`[Preload] 当前状�?- currentTime: ${video.currentTime.toFixed(3)}s, readyState: ${video.readyState}, paused: ${video.paused}`);

    video.currentTime = 0;
    video.pause();

    //console.log(`[Preload] �?${video.id} 已重置到第一帧并暂停`);
    //console.log(`[Preload] 新状�?- currentTime: ${video.currentTime.toFixed(3)}s, readyState: ${video.readyState}, paused: ${video.paused}`);
    //console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
}

/**
 * 获取视频的克隆配�?
 */
function getCloneVideo(state, video) {
    if (video === state.idleVideo) return state.idleVideoClone;
    if (video === state.idleVideoClone) return state.idleVideo;
    if (video === state.draggingVideo) return state.draggingVideoClone;
    if (video === state.draggingVideoClone) return state.draggingVideo;
    return null;
}

/**
 * 渲染单帧（✅ 修复版：使用 globalCompositeOperation 避免空白帧）
 */
function renderSingleFrame(state) {
    const { ctx, canvasElement, activeVideo, offscreen, offCtx } = state;

    // 视频未就绪，保留上一帧（关键：不做任何操作）
    if (activeVideo.readyState < 2) {
        // 只在第一次遇到未就绪状态时打印警告
        if (!state._lastNotReadyWarning || Date.now() - state._lastNotReadyWarning > 1000) {
            //console.warn(`[Render] ⚠️  视频未就�? ${activeVideo.id}, readyState=${activeVideo.readyState}`);
            state._lastNotReadyWarning = Date.now();
        }
        return;
    }

    const videoWidth = activeVideo.videoWidth;
    const videoHeight = activeVideo.videoHeight;
    const canvasWidth = canvasElement.width;
    const canvasHeight = canvasElement.height;

    // 保护：视频尺寸无�?
    if (videoWidth === 0 || videoHeight === 0) {
        if (!state._lastInvalidSizeWarning || Date.now() - state._lastInvalidSizeWarning > 1000) {
            //console.warn(`[Render] ⚠️  视频尺寸无效: ${activeVideo.id}, ${videoWidth}x${videoHeight}`);
            state._lastInvalidSizeWarning = Date.now();
        }
        return;
    }

    // 计算缩放比例，保持宽高比
    const videoAspect = videoWidth / videoHeight;
    const canvasAspect = canvasWidth / canvasHeight;

    let drawWidth, drawHeight, offsetX, offsetY;

    if (videoAspect > canvasAspect) {
        drawWidth = canvasWidth;
        drawHeight = canvasWidth / videoAspect;
        offsetX = 0;
        offsetY = (canvasHeight - drawHeight) / 2;
    } else {
        drawHeight = canvasHeight;
        drawWidth = canvasHeight * videoAspect;
        offsetX = (canvasWidth - drawWidth) / 2;
        offsetY = 0;
    }

    // �?修复：先在离�?canvas 绘制
    offCtx.clearRect(0, 0, canvasWidth, canvasHeight);
    offCtx.drawImage(activeVideo, offsetX, offsetY, drawWidth, drawHeight);

    // �?关键修复：使�?'copy' 模式，单次原子操作替换整个画�?
    // 避免 clearRect + drawImage 之间的空白窗�?
    ctx.globalCompositeOperation = 'copy';
    ctx.drawImage(offscreen, 0, 0);
    ctx.globalCompositeOperation = 'source-over'; // 恢复默认
}

/**
 * 停止渲染循环
 */
function stopRenderLoop(state) {
    if (state.rafId) {
        cancelAnimationFrame(state.rafId);
        state.rafId = null;
    }
}

/**
 * 像素级命中检�?
 * @param {number} clientX - 鼠标事件�?clientX
 * @param {number} clientY - 鼠标事件�?clientY
 * @returns {boolean} - 是否命中不透明区域
 */
function hitTest(state, clientX, clientY) {
    if (state.hasError || !state.isLoaded) {
        //console.log('HitTest: not ready', { hasError: state.hasError, isLoaded: state.isLoaded });
        return true;
    }

    const { canvasElement, ctx } = state;
    if (!canvasElement) return false;
    const rect = canvasElement.getBoundingClientRect();

    // �?client 坐标转换到相对于 canvas 的坐�?
    const relX = clientX - rect.left;
    const relY = clientY - rect.top;

    // 转换�?canvas 像素坐标
    const canvasX = Math.floor((relX / rect.width) * canvasElement.width);
    const canvasY = Math.floor((relY / rect.height) * canvasElement.height);

    // 边界检�?
    if (canvasX < 0 || canvasY < 0 || canvasX >= canvasElement.width || canvasY >= canvasElement.height) {
        //console.log(`HitTest: out of bounds at client(${clientX.toFixed(0)}, ${clientY.toFixed(0)}) -> canvas(${canvasX}, ${canvasY})`);
        return false;
    }

    try {
        // 读取像素 alpha �?
        const imageData = ctx.getImageData(canvasX, canvasY, 1, 1);
        const alpha = imageData.data[3];

        // alpha 阈值：10-30 之间，处理视频压缩导致的边缘半透明
        const alphaThreshold = 15;
        const isHit = alpha > alphaThreshold;

        // 调试日志
        //console.log(`HitTest at client(${clientX.toFixed(0)}, ${clientY.toFixed(0)}) -> canvas(${canvasX}, ${canvasY}), alpha: ${alpha}, hit: ${isHit}`);

        return isHit;
    } catch (error) {
        //console.warn('Failed to perform hit test:', error);
        return true; // 出错时默认命�?
    }
}

/**
 * 切换到静息视频（�?简化版：直接切换并预加载克隆）
 */
function switchToIdleVideo(state) {
    if (state.hasError || state.currentVideo === 'idle') return;

    //console.log(`\n`);
    //console.log(`╔═══════════════════════════════════════════════════════════╗`);
    //console.log(`�?             切换到静息视�?(Idle)                         ║`);
    //console.log(`╚═══════════════════════════════════════════════════════════╝`);
    //console.log(`[Switch] 🔄 �?${state.currentVideo} 切换�?idle`);
    //console.log(`[Switch] 当前 activeVideo: ${state.activeVideo.id}`);

    state.currentVideo = 'idle';

    // 暂停拖动视频�?
    //console.log(`[Switch] ⏸️  暂停拖动视频�?..`);
    state.draggingVideo.pause();
    state.draggingVideoClone.pause();
    //console.log(`[Switch] �?${state.draggingVideo.id} 已暂停`);
    //console.log(`[Switch] �?${state.draggingVideoClone.id} 已暂停`);

    // 播放静息视频
    //console.log(`[Switch] ▶️  准备播放静息视频: ${state.idleVideo.id}`);
    state.idleVideo.currentTime = 0;
    //console.log(`[Switch] 重置 currentTime = 0`);

    state.idleVideo.play().then(() => {
        //console.log(`[Switch] �?${state.idleVideo.id} 开始播放`);
        //console.log(`[Switch] 视频状�?- currentTime: ${state.idleVideo.currentTime.toFixed(3)}s, readyState: ${state.idleVideo.readyState}, paused: ${state.idleVideo.paused}`);
    }).catch(err => {
        //console.error(`[Switch] �?播放失败:`, err);
    });

    // 切换活跃视频�?
    const oldActive = state.activeVideo;
    state.activeVideo = state.idleVideo;
    //console.log(`[Switch] �?activeVideo 已切�? ${oldActive.id} �?${state.activeVideo.id}`);

    // 预加载克隆到第一�?
    //console.log(`[Switch] 📦 预加载克隆视�?..`);
    preloadVideoToFirstFrame(state.idleVideoClone);
    //console.log(`[Switch] �?切换完成\n`);
}

/**
 * 切换到拖动视频（�?简化版：直接切换并预加载克隆）
 */
function switchToDraggingVideo(state) {
    if (state.hasError || state.currentVideo === 'dragging') return;

    //console.log(`\n`);
    //console.log(`╔═══════════════════════════════════════════════════════════╗`);
    //console.log(`�?             切换到拖动视�?(Dragging)                     ║`);
    //console.log(`╚═══════════════════════════════════════════════════════════╝`);
    //console.log(`[Switch] 🔄 �?${state.currentVideo} 切换�?dragging`);
    //console.log(`[Switch] 当前 activeVideo: ${state.activeVideo.id}`);

    state.currentVideo = 'dragging';

    // 暂停静息视频�?
    //console.log(`[Switch] ⏸️  暂停静息视频�?..`);
    state.idleVideo.pause();
    state.idleVideoClone.pause();
    //console.log(`[Switch] �?${state.idleVideo.id} 已暂停`);
    //console.log(`[Switch] �?${state.idleVideoClone.id} 已暂停`);

    // 播放拖动视频
    //console.log(`[Switch] ▶️  准备播放拖动视频: ${state.draggingVideo.id}`);
    state.draggingVideo.currentTime = 0;
    //console.log(`[Switch] 重置 currentTime = 0`);

    state.draggingVideo.play().then(() => {
        //console.log(`[Switch] �?${state.draggingVideo.id} 开始播放`);
        //console.log(`[Switch] 视频状�?- currentTime: ${state.draggingVideo.currentTime.toFixed(3)}s, readyState: ${state.draggingVideo.readyState}, paused: ${state.draggingVideo.paused}`);
    }).catch(err => {
        //console.error(`[Switch] �?播放失败:`, err);
    });

    // 切换活跃视频�?
    const oldActive = state.activeVideo;
    state.activeVideo = state.draggingVideo;
    //console.log(`[Switch] �?activeVideo 已切�? ${oldActive.id} �?${state.activeVideo.id}`);

    // 预加载克隆到第一�?
    //console.log(`[Switch] 📦 预加载克隆视�?..`);
    preloadVideoToFirstFrame(state.draggingVideoClone);
    //console.log(`[Switch] �?切换完成\n`);
}

/**
 * 重新注册 requestVideoFrameCallback 到当前活跃视�?
 * �?简化版不使�?RVFC
 */
function reRegisterRVFC(state) {
    // 不需�?
    return;
}

/**
 * 暂停视频播放
 */
function pause(state) {
    if (state.hasError) return;

    // �?只暂停当前活跃的视频
    state.activeVideo.pause();
    state.isPlaying = false;
    stopRenderLoop(state);
}

/**
 * 恢复视频播放
 */
function resume(state) {
    if (state.hasError) return;

    // �?只恢复当前活跃的视频
    state.activeVideo.play().then(() => {
        state.isPlaying = true;
        startRenderLoop(state);
    }).catch(err => {
        //console.error('Failed to resume video:', err);
    });
}

/**
 * 销毁视频播放器
 */
function destroy(state) {
    stopRenderLoop(state);

    // 清理四个视频元素
    const videos = [state.idleVideo, state.draggingVideo, state.idleVideoClone, state.draggingVideoClone];

    videos.forEach(video => {
        if (video) {
            video.pause();
            video.src = '';
            if (video.parentNode) {
                video.parentNode.removeChild(video);
            }
        }
    });

    if (state.canvasElement && state.canvasElement.parentNode) {
        state.canvasElement.parentNode.removeChild(state.canvasElement);
    }

    // 恢复显示图标
    const icon = state.container.querySelector('i');
    if (icon) {
        icon.style.display = '';
    }
}

/**
 * 更新视频播放器尺寸（修复：主动设置容器尺寸并立即重绘）
 */
function updateSize(state, size) {
    console.log('[videoPlayer.updateSize] Called with size:', size);
    console.log('[videoPlayer.updateSize] State.isLoaded:', state.isLoaded);
    console.log('[videoPlayer.updateSize] State.isPlaying:', state.isPlaying);

    const container = state.container;
    console.log('[videoPlayer.updateSize] Container before update:', container.offsetWidth, 'x', container.offsetHeight);

    // 如果传入了 size，设置容器尺寸（外部可能已经设置，这里确保同步）
    if (size) {
        console.log('[videoPlayer.updateSize] Setting container size to:', size + 'px');
        container.style.width = size + 'px';
        container.style.height = size + 'px';
    }

    // 强制浏览器回流，确保 offsetWidth/offsetHeight 已更新
    void container.offsetWidth;
    console.log('[videoPlayer.updateSize] Container after reflow:', container.offsetWidth, 'x', container.offsetHeight);

    // 更新 Canvas 尺寸（返回值表示尺寸是否改变）
    console.log('[videoPlayer.updateSize] Calling updateCanvasSize...');
    const sizeChanged = updateCanvasSize(state);
    console.log('[videoPlayer.updateSize] Size changed:', sizeChanged);

    // 只有在尺寸真正改变时才重绘，避免不必要的闪烁
    if (sizeChanged && state.isLoaded && state.activeVideo && state.activeVideo.readyState >= 2) {
        console.log('[videoPlayer.updateSize] Size changed, rendering single frame...');
        renderSingleFrame(state);
        console.log('[videoPlayer.updateSize] Single frame rendered');
    } else if (!sizeChanged) {
        console.log('[videoPlayer.updateSize] Size unchanged, skipping render');
    } else {
        console.warn('[videoPlayer.updateSize] Cannot render frame:', {
            sizeChanged,
            isLoaded: state.isLoaded,
            hasActiveVideo: !!state.activeVideo,
            readyState: state.activeVideo?.readyState
        });
    }

    console.log('[videoPlayer.updateSize] Completed');
}

/**
 * 回退到传统图标模�?
 */
function fallbackToTraditionalMode(state) {
    //console.warn('Falling back to traditional icon mode');

    stopRenderLoop(state);

    // 隐藏 canvas 元素
    if (state.canvasElement) {
        state.canvasElement.style.display = 'none';
    }

    // 显示传统图标
    const icon = state.container.querySelector('i');
    if (icon) {
        icon.style.display = '';
    }
}

/**
 * 检测浏览器是否支持WebM格式
 */
export function checkWebMSupport() {
    const video = document.createElement('video');
    const canPlayWebM = video.canPlayType('video/webm; codecs="vp8"') !== '';
    const canPlayWebMVP9 = video.canPlayType('video/webm; codecs="vp9"') !== '';

    return canPlayWebM || canPlayWebMVP9;
}
