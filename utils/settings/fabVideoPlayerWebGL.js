// @ts-nocheck

/**
 * Stacked Alpha Video Player (WebGL 方案)
 * 支持上下拼接的透明视频（上半部分为颜色，下半部分为 Alpha 通道）
 * 使用 WebGL Shader 实现高性能透明视频播放
 */

/**
 * 获取视频的 Blob URL，支持 fallback（降级）
 */
async function loadVideoAsBlobUrl(src) {
    try {
        const res = await fetch(src);
        if (!res.ok) throw new Error(`HTTP error! status: ${res.status}`);
        const blob = await res.blob();
        if (blob.type !== 'video/mp4') {
            return URL.createObjectURL(new Blob([blob], { type: 'video/mp4' }));
        }
        return URL.createObjectURL(blob);
    } catch (err) {
        console.warn(`[st-chatu8] 无法加载 ${src}，尝试回退...`, err);
        let fallbackSrc = src;
        if (src.includes('idle.chatu8')) fallbackSrc = src.replace('idle.chatu8', '静息画面.mp4');
        else if (src.includes('dragging.chatu8')) fallbackSrc = src.replace('dragging.chatu8', '拖动.mp4');
        else if (src.includes('headpat.chatu8')) fallbackSrc = src.replace('headpat.chatu8', '摸头.mp4');
        else if (src.includes('thinking.chatu8')) fallbackSrc = src.replace('thinking.chatu8', '思考.mp4');
        else if (src.includes('.chatu8')) fallbackSrc = src.replace('.chatu8', '.mp4');

        if (fallbackSrc !== src) {
            try {
                const res2 = await fetch(fallbackSrc);
                if (!res2.ok) throw new Error(`HTTP error! status: ${res2.status}`);
                const blob2 = await res2.blob();
                return URL.createObjectURL(new Blob([blob2], { type: 'video/mp4' }));
            } catch (err2) {
                console.error(`[st-chatu8] 回退加载也失败: ${fallbackSrc}`, err2);
                throw err2;
            }
        }
        throw err;
    }
}

/**
 * 创建隐藏的 video 元素
 * ✅ 修复：返回 Promise，确保事件监听器在 src 设置前注册，避免竞态条件
 */
function createHiddenVideo(src, id) {
    // 清理可能残留的同 ID 旧元素（插件重装场景）
    const existingVideo = document.getElementById(id);
    if (existingVideo) {
        existingVideo.pause();
        // 释放旧的 Blob URL
        if (existingVideo.src && existingVideo.src.startsWith('blob:')) {
            URL.revokeObjectURL(existingVideo.src);
        }
        existingVideo.src = '';
        existingVideo.removeAttribute('src');
        existingVideo.parentNode?.removeChild(existingVideo);
        console.log(`[st-chatu8] Cleaned up stale video element: ${id}`);
    }

    const video = document.createElement('video');
    video.id = id;
    video.style.display = 'none';
    video.loop = false;
    video.muted = true;
    video.autoplay = false;
    video.playsInline = true;
    video.preload = 'auto';

    video.dataset.originalSrc = src; // 记录原始路径用于报错和验证

    const pathParts = src.split('/');
    const encodedSrc = pathParts.map((part, index) => {
        if (index === pathParts.length - 1) return encodeURIComponent(part);
        return part;
    }).join('/');

    // ✅ 修复：不在这里设置 src，改为存储 Promise 供外部在注册监听器后调用
    video._loadPromise = loadVideoAsBlobUrl(encodedSrc);
    video._encodedSrc = encodedSrc;

    document.body.appendChild(video);
    return video;
}

/**
 * ✅ 新增：启动视频加载（在事件监听器注册后调用）
 */
function startVideoLoad(video) {
    if (!video._loadPromise) {
        console.error(`[st-chatu8] Video ${video.id} has no load promise`);
        return;
    }

    video._loadPromise
        .then(blobUrl => {
            video.src = blobUrl;
            // ✅ 设置 src 后显式调用 load() 确保触发加载
            video.load();
        })
        .catch(err => {
            console.error(`[st-chatu8] Failed to load video as Blob: ${video.dataset.originalSrc}`, err);
            // 触发人为生成的错误事件，让外部捕获
            video.dispatchEvent(new Event('error'));
        });
}

/**
 * 创建 WebGL 着色器
 */
function createShader(gl, type, source) {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);

    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        console.error('Shader compilation error:', gl.getShaderInfoLog(shader));
        gl.deleteShader(shader);
        return null;
    }

    return shader;
}

/**
 * 创建 WebGL 程序
 */
function createProgram(gl, vsSource, fsSource) {
    const vs = createShader(gl, gl.VERTEX_SHADER, vsSource);
    const fs = createShader(gl, gl.FRAGMENT_SHADER, fsSource);

    if (!vs || !fs) return null;

    const program = gl.createProgram();
    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.linkProgram(program);

    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
        console.error('Program linking error:', gl.getProgramInfoLog(program));
        gl.deleteProgram(program);
        return null;
    }

    return program;
}

/**
 * 初始化 WebGL 上下文和着色器
 */
function initWebGL(canvas) {
    const gl = canvas.getContext('webgl', {
        alpha: true,
        premultipliedAlpha: false,
        preserveDrawingBuffer: true // ✅ 保留帧缓冲内容，确保 readPixels 在任意时刻可读
    });

    if (!gl) {
        console.error('WebGL not supported');
        return null;
    }

    // 顶点着色器
    const vsSource = `
        attribute vec2 a_position;
        attribute vec2 a_texCoord;
        varying vec2 v_texCoord;
        
        void main() {
            gl_Position = vec4(a_position, 0.0, 1.0);
            v_texCoord = a_texCoord;
        }
    `;

    // 片元着色器：上半部分取颜色，下半部分取 alpha
    const fsSource = `
        precision mediump float;
        uniform sampler2D u_frame;
        varying vec2 v_texCoord;
        
        void main() {
            // 上半部分（0.0 - 0.5）为颜色
            vec2 colorCoord = vec2(v_texCoord.x, v_texCoord.y * 0.5);
            // 下半部分（0.5 - 1.0）为 alpha
            vec2 alphaCoord = vec2(v_texCoord.x, 0.5 + v_texCoord.y * 0.5);
            
            vec4 color = texture2D(u_frame, colorCoord);
            float alpha = texture2D(u_frame, alphaCoord).r;
            
            gl_FragColor = vec4(color.rgb, alpha);
        }
    `;

    const program = createProgram(gl, vsSource, fsSource);
    if (!program) return null;

    gl.useProgram(program);

    // 设置顶点坐标和纹理坐标
    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
        // x, y, u, v
        -1, -1, 0, 1,
        1, -1, 1, 1,
        -1, 1, 0, 0,
        1, 1, 1, 0,
    ]), gl.STATIC_DRAW);

    const aPosition = gl.getAttribLocation(program, 'a_position');
    gl.enableVertexAttribArray(aPosition);
    gl.vertexAttribPointer(aPosition, 2, gl.FLOAT, false, 16, 0);

    const aTexCoord = gl.getAttribLocation(program, 'a_texCoord');
    gl.enableVertexAttribArray(aTexCoord);
    gl.vertexAttribPointer(aTexCoord, 2, gl.FLOAT, false, 16, 8);

    // 创建纹理
    const texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);

    // 开启透明混合
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

    return { gl, program, texture };
}

/**
 * 创建 WebGL 视频播放器
 */
export function createVideoPlayer(container, options) {
    const { idleVideoSrc, draggingVideoSrc, onError } = options;

    // 创建两个视频元素
    const idleVideo = createHiddenVideo(idleVideoSrc, 'st-chatu8-fab-video-idle');
    const draggingVideo = createHiddenVideo(draggingVideoSrc, 'st-chatu8-fab-video-dragging');

    // 创建克隆视频用于无缝循环
    const idleVideoClone = createHiddenVideo(idleVideoSrc, 'st-chatu8-fab-video-idle-clone');
    const draggingVideoClone = createHiddenVideo(draggingVideoSrc, 'st-chatu8-fab-video-dragging-clone');

    // ✅ 优化：可选视频（摸头/思考/说话）记录路径，延迟到首次使用时加载
    const headPatVideoSrc = idleVideoSrc.replace(/[^/]+\.(mp4|chatu8)$/, 'headpat.chatu8');
    const thinkingVideoSrc = idleVideoSrc.replace(/[^/]+\.(mp4|chatu8)$/, 'thinking.chatu8');
    const talkVideoSrc = idleVideoSrc.replace(/[^/]+\.(mp4|chatu8)$/, 'talk.chatu8');

    // 创建 canvas 元素
    const canvasElement = document.createElement('canvas');
    canvasElement.id = 'st-chatu8-fab-video-canvas';
    canvasElement.className = 'st-chatu8-fab-video';
    canvasElement.style.width = '100%';
    canvasElement.style.height = '100%';
    canvasElement.style.position = 'absolute';
    canvasElement.style.top = '0';
    canvasElement.style.left = '0';
    canvasElement.style.pointerEvents = 'none';
    canvasElement.style.display = 'block';
    canvasElement.style.zIndex = '2';

    // 初始化 WebGL
    const webgl = initWebGL(canvasElement);
    if (!webgl) {
        console.error('Failed to initialize WebGL');
        fallbackToTraditionalMode(container);
        return null;
    }

    const { gl, program, texture } = webgl;

    // 内部状态
    const state = {
        currentVideo: 'idle',
        isPlaying: false,
        isLoaded: false,
        hasError: false,
        container,
        idleVideo,
        draggingVideo,
        idleVideoClone,
        draggingVideoClone,
        headPatVideo: null, // ✅ 懒加载：首次使用时才创建
        thinkingVideo: null, // ✅ 懒加载：首次使用时才创建
        talkVideo: null, // ✅ 懒加载：首次使用时才创建
        headPatVideoSrc, // ✅ 记录路径用于懒加载
        thinkingVideoSrc, // ✅ 记录路径用于懒加载
        talkVideoSrc, // ✅ 记录路径用于懒加载
        headPatVideoLoading: false, // ✅ 懒加载中标记
        thinkingVideoLoading: false, // ✅ 懒加载中标记
        talkVideoLoading: false, // ✅ 懒加载中标记
        activeVideo: idleVideo,
        canvasElement,
        gl,
        program,
        texture,
        rafId: null,
        loadedCount: 0,
        alphaCache: null, // 用于 hitTest 的 alpha 缓存
        alphaCacheDirty: true, // 标记 alpha 缓存是否需要更新
        lastAlphaCacheTime: 0, // 上次更新 alpha 缓存的时间戳
        lastVideoTime: -1, // 上一次上传到纹理的视频 currentTime（用于跳过重复帧）
        isPlayingHeadPat: false, // ✅ 新增：标记是否正在播放摸头视频
        isPlayingThinking: false, // ✅ 新增：标记是否正在播放思考视频
        thinkingRequested: false, // ✅ 新增：标记是否已请求播放思考视频（用于取消异步加载）
        isPlayingTalk: false, // ✅ 新增：标记是否正在播放说话视频
        pipBackgroundEnabled: false // ✅ PiP 模式：启用时 clearColor 使用不透明背景色
    };

    // 视频加载完成处理
    const onVideoLoaded = (video) => {
        state.loadedCount++;

        const requiredVideosCount = 4; // idle, dragging 及其克隆

        if (state.loadedCount >= requiredVideosCount && !state.isLoaded) {
            state.isLoaded = true;
            state.hasError = false;

            // ✅ 修复：确保容器尺寸已正确应用后再设置 canvas 尺寸
            // 延迟一小段时间让浏览器完成布局
            setTimeout(() => {
                // 设置 canvas 尺寸（带重试机制）
                const sizeSuccess = updateCanvasSize(state);

                if (!sizeSuccess) {
                    console.warn('[st-chatu8] Initial canvas size update failed, will retry automatically');
                }

                // 隐藏占位符图标
                const icon = container.querySelector('i');
                if (icon) {
                    icon.style.display = 'none';
                }

                // 开始播放
                state.isPlaying = true;
                const playPromise = idleVideo.play();
                if (playPromise !== undefined) {
                    playPromise.catch(err => {
                        if (err.name !== 'AbortError') {
                            console.error('Failed to play idle video:', err);
                            state.isPlaying = false;
                        }
                    });
                }
                startRenderLoop(state);

                // 预加载其他视频到第一帧
                preloadVideoToFirstFrame(idleVideoClone);
                preloadVideoToFirstFrame(draggingVideo);
                preloadVideoToFirstFrame(draggingVideoClone);
            }, 50); // 延迟 50ms 确保容器尺寸已应用
        }
    };

    // 视频错误处理
    const onVideoError = (video) => {
        const originalSrc = video.dataset.originalSrc || video.src;
        if (!originalSrc || originalSrc === window.location.href) {
            return;
        }

        console.error('Failed to load video:', originalSrc);
        state.hasError = true;
        state.isLoaded = false;

        // 调用错误回调
        if (onError && typeof onError === 'function') {
            // 判断是哪个视频出错
            const videoType = originalSrc.includes(idleVideoSrc) ? 'idle' : 'dragging';
            onError(videoType, originalSrc);
        }

        fallbackToTraditionalMode(container);
    };

    // 添加事件监听（仅核心视频，可选视频在懒加载时注册）
    // ✅ 修复竞态条件：先注册监听器，再启动加载，确保不会错过 loadeddata 事件
    [idleVideo, draggingVideo, idleVideoClone, draggingVideoClone].forEach(video => {
        video.addEventListener('loadeddata', () => onVideoLoaded(video));
        video.addEventListener('error', () => onVideoError(video));
    });

    // 设置视频循环切换
    setupEndedHandler(idleVideo, idleVideoClone, state);
    setupEndedHandler(idleVideoClone, idleVideo, state);
    setupEndedHandler(draggingVideo, draggingVideoClone, state);
    setupEndedHandler(draggingVideoClone, draggingVideo, state);

    // 添加到容器
    container.appendChild(canvasElement);

    // ✅ 修复：在事件监听器注册后才启动视频加载，确保不会错过事件
    startVideoLoad(idleVideo);
    startVideoLoad(draggingVideo);
    startVideoLoad(idleVideoClone);
    startVideoLoad(draggingVideoClone);

    // ✅ 修复：处理 WebGL 上下文丢失（安卓浏览器最小化后常见）
    const handleContextLost = (e) => {
        e.preventDefault(); // 允许浏览器后续恢复上下文
        console.log('[st-chatu8] WebGL context lost, stopping render loop...');
        stopRenderLoop(state);
        state.isPlaying = false;
    };

    const handleContextRestored = () => {
        console.log('[st-chatu8] WebGL context restored, reinitializing WebGL pipeline...');

        // 重新初始化 WebGL 着色器、缓冲区、纹理
        const newWebgl = initWebGL(canvasElement);
        if (!newWebgl) {
            console.error('[st-chatu8] Failed to reinitialize WebGL after context restore');
            fallbackToTraditionalMode(container);
            return;
        }

        // 更新 state 中的 WebGL 引用
        state.gl = newWebgl.gl;
        state.program = newWebgl.program;
        state.texture = newWebgl.texture;

        // 恢复 canvas 尺寸和视口
        updateCanvasSize(state);

        // 重置渲染状态，强制下一帧重新上传纹理
        state.lastVideoTime = -1;
        state.alphaCacheDirty = true;

        // 恢复视频播放
        if (state.isLoaded && !state.hasError) {
            const video = state.activeVideo;
            if (video) {
                state.isPlaying = true;
                if (video.paused && video.readyState >= 2) {
                    video.play().catch(err => {
                        console.warn('[st-chatu8] Failed to resume video after context restore:', err);
                    });
                }
                startRenderLoop(state);
                // 立即渲染一帧
                if (video.readyState >= 2) {
                    renderFrame(state);
                }
            }
        }
    };

    canvasElement.addEventListener('webglcontextlost', handleContextLost);
    canvasElement.addEventListener('webglcontextrestored', handleContextRestored);
    state.handleContextLost = handleContextLost;
    state.handleContextRestored = handleContextRestored;

    // ✅ 修复：监听页面可见性变化，处理手机浏览器后台切换
    const handleVisibilityChange = () => {
        if (document.visibilityState === 'visible') {
            // 页面重新可见，恢复视频播放和渲染循环
            if (state.isLoaded && !state.hasError) {
                console.log('[st-chatu8] Page became visible, resuming video playback...');
                console.log('[st-chatu8] activeVideo:', state.activeVideo?.id, 'readyState:', state.activeVideo?.readyState, 'paused:', state.activeVideo?.paused);

                // 延迟一小段时间让浏览器完成恢复
                setTimeout(() => {
                    if (!state.isLoaded || state.hasError) return;

                    // ✅ 安卓：检查 WebGL 上下文是否丢失，如果丢失则等待 webglcontextrestored 事件恢复
                    if (state.gl && state.gl.isContextLost()) {
                        console.log('[st-chatu8] WebGL context is lost, deferring resume to contextrestored handler');
                        return;
                    }

                    const video = state.activeVideo;
                    if (!video) {
                        console.warn('[st-chatu8] No active video found!');
                        return;
                    }

                    console.log('[st-chatu8] After delay - readyState:', video.readyState, 'paused:', video.paused);

                    // ✅ 修复：检查并修复 canvas 尺寸（防止刷新后尺寸异常）
                    const canvas = state.canvasElement;
                    if (canvas && (canvas.width === 0 || canvas.height === 0 ||
                        state.container.offsetWidth === 0 || state.container.offsetHeight === 0)) {
                        console.log('[st-chatu8] Canvas/container size is invalid, triggering updateCanvasSize...');
                        updateCanvasSize(state);
                    }

                    // 强制重置 lastVideoTime 确保下一帧会渲染
                    state.lastVideoTime = -1;
                    state.alphaCacheDirty = true;

                    // 如果视频 readyState 低于 2，可能需要重新 load
                    if (video.readyState < 2) {
                        console.log('[st-chatu8] Video not ready, attempting to reload...');
                        video.load();
                    }

                    // 尝试播放视频
                    if (video.paused) {
                        console.log('[st-chatu8] Video is paused, attempting to play...');
                        const playPromise = video.play();
                        if (playPromise !== undefined) {
                            playPromise.then(() => {
                                console.log('[st-chatu8] Video play successful');
                                state.isPlaying = true;
                                startRenderLoop(state);
                            }).catch(err => {
                                console.error('[st-chatu8] Failed to resume video:', err);
                                // 尝试用户交互后的自动恢复
                                const autoResume = () => {
                                    video.play().then(() => {
                                        state.isPlaying = true;
                                        startRenderLoop(state);
                                    }).catch(() => { });
                                    document.removeEventListener('touchstart', autoResume);
                                    document.removeEventListener('click', autoResume);
                                };
                                document.addEventListener('touchstart', autoResume, { once: true });
                                document.addEventListener('click', autoResume, { once: true });
                            });
                        }
                    } else {
                        // 视频已经在播放，只需重启渲染循环
                        console.log('[st-chatu8] Video already playing, just restarting render loop');
                        state.isPlaying = true;
                        startRenderLoop(state);
                    }

                    // 无论如何都强制渲染一帧
                    if (video.readyState >= 2) {
                        renderFrame(state);
                    }
                }, 100);
            }
        } else {
            // 页面进入后台，停止渲染循环以节省资源（视频会被浏览器自动暂停）
            console.log('[st-chatu8] Page became hidden, stopping render loop...');
            stopRenderLoop(state);
        }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);

    // ✅ iOS Safari 兼容：监听 pageshow 事件（从 bfcache 恢复时触发）
    const handlePageShow = (event) => {
        if (event.persisted) {
            console.log('[st-chatu8] Page restored from bfcache, triggering visibility handler...');
            handleVisibilityChange();
        }
    };
    window.addEventListener('pageshow', handlePageShow);
    state.handlePageShow = handlePageShow;

    // ✅ 安卓兼容：监听 window focus 事件作为 visibilitychange 的补充
    // 部分安卓浏览器最小化后恢复时不触发 visibilitychange，但会触发 focus
    let lastFocusResumeTime = 0;
    const handleWindowFocus = () => {
        // 仅在页面可见时处理（避免与 visibilitychange 重复执行）
        if (document.visibilityState !== 'visible') return;
        if (!state.isLoaded || state.hasError) return;

        // 防抖：如果 visibilitychange 刚执行过，跳过
        const now = Date.now();
        if (now - lastFocusResumeTime < 500) return;
        lastFocusResumeTime = now;

        const video = state.activeVideo;
        if (!video) return;

        // 检查 WebGL 上下文是否丢失
        if (state.gl && state.gl.isContextLost()) {
            console.log('[st-chatu8] Focus: WebGL context is lost, waiting for restore...');
            return; // webglcontextrestored 会处理恢复
        }

        // 如果视频暂停或渲染循环停止，尝试恢复
        if (video.paused || !state.isPlaying) {
            console.log('[st-chatu8] Window focused, video paused:', video.paused, 'isPlaying:', state.isPlaying);
            state.lastVideoTime = -1;
            state.alphaCacheDirty = true;

            if (video.paused && video.readyState >= 2) {
                const playPromise = video.play();
                if (playPromise !== undefined) {
                    playPromise.then(() => {
                        state.isPlaying = true;
                        startRenderLoop(state);
                    }).catch(err => {
                        console.warn('[st-chatu8] Focus resume play failed:', err);
                    });
                }
            } else if (!state.isPlaying) {
                state.isPlaying = true;
                startRenderLoop(state);
            }
        }
    };

    window.addEventListener('focus', handleWindowFocus);
    state.handleWindowFocus = handleWindowFocus;

    // ✅ 兜底心跳监控：每 2 秒主动检查视频是否真的在播放
    // 解决某些安卓浏览器 visibilitychange/focus/pageshow 都不触发的场景
    // （例如：浏览器进后台被系统静默挂起，回前台后只是渲染恢复但事件已丢）
    const healthMonitor = () => {
        if (!state.isLoaded || state.hasError) return;
        if (document.visibilityState !== 'visible') return; // 后台时不处理

        // WebGL 上下文丢失时由 contextrestored 处理，不重复
        if (state.gl && state.gl.isContextLost()) return;

        const video = state.activeVideo;
        if (!video) return;

        const reasons = [];

        // 异常 1：应在播放但视频被暂停
        if (state.isPlaying && video.paused && !video.ended) {
            reasons.push('paused');
        }

        // 异常 2：应在播放但渲染循环已停（rafId 为 null 且不是用 rVFC）
        // rVFC 路径不依赖 rafId，所以只检查 paused + 时间停滞
        if (state.isPlaying && !state.rafId && !state._usingRVFC) {
            reasons.push('no-rAF');
        }

        // 异常 3：currentTime 长时间不推进（卡死）
        const now = Date.now();
        if (state.isPlaying && !video.paused && video.readyState >= 2) {
            if (state._healthLastTime !== undefined) {
                const elapsed = now - state._healthLastWall;
                const advanced = video.currentTime - state._healthLastTime;
                if (elapsed > 3000 && Math.abs(advanced) < 0.05) {
                    reasons.push('stuck');
                }
            }
            state._healthLastTime = video.currentTime;
            state._healthLastWall = now;
        } else {
            // 重置基线，避免暂停期间误报
            state._healthLastTime = video.currentTime;
            state._healthLastWall = now;
        }

        if (reasons.length === 0) return;

        console.warn(`[st-chatu8][HealthMonitor] 检测到视频异常: ${reasons.join(', ')}, 尝试恢复 ${video.id}`);

        state.lastVideoTime = -1;
        state.alphaCacheDirty = true;

        // 尝试 play
        if (video.paused && video.readyState >= 2) {
            const p = video.play();
            if (p && p.catch) {
                p.then(() => {
                    state.isPlaying = true;
                    startRenderLoop(state);
                }).catch(err => {
                    if (err.name !== 'AbortError') {
                        console.warn('[st-chatu8][HealthMonitor] 恢复播放失败:', err);
                    }
                });
            }
        }

        // 渲染循环未运行则重启
        if (!state.rafId && !state._usingRVFC) {
            state.isPlaying = true;
            startRenderLoop(state);
        }
    };
    state.healthMonitorInterval = setInterval(healthMonitor, 2000);

    // 保存引用以便销毁时移除监听器
    state.handleVisibilityChange = handleVisibilityChange;

    return {
        switchToIdleVideo: () => switchToIdleVideo(state),
        switchToDraggingVideo: () => switchToDraggingVideo(state),
        playHeadPatVideo: () => playHeadPatVideo(state), // ✅ 新增
        playThinkingVideo: () => playThinkingVideo(state), // ✅ 新增
        stopThinkingVideo: () => stopThinkingVideo(state), // ✅ 新增
        playTalkVideo: () => playTalkVideo(state), // ✅ 新增：播放说话视频
        stopTalkVideo: () => stopTalkVideo(state), // ✅ 新增：停止说话视频
        pause: () => pause(state),
        resume: () => resume(state),
        destroy: () => destroy(state),
        updateSize: (size) => updateSize(state, size),
        hitTest: (x, y) => hitTest(state, x, y),
        getState: () => state,
        // ✅ PiP 背景控制：启用时 renderFrame 使用不透明背景色，关闭时恢复透明
        setPipBackground: (enabled) => {
            state.pipBackgroundEnabled = !!enabled;
            // 立即触发一次重绘，让背景色变化即时生效
            state.lastVideoTime = -1;
        }
    };
}

/**
 * 更新 Canvas 尺寸
 * @param {boolean} scheduleRetry - 如果容器尺寸为 0，是否安排重试（默认 true）
 */
function updateCanvasSize(state, scheduleRetry = true) {
    const container = state.container;
    const canvas = state.canvasElement;
    const video = state.activeVideo;

    void container.offsetWidth;

    const containerWidth = container.offsetWidth;
    const containerHeight = container.offsetHeight;

    if (containerWidth === 0 || containerHeight === 0) {
        console.warn('[st-chatu8] Container size is 0 (width:', containerWidth, 'height:', containerHeight, ')');

        // ✅ 修复：如果容器尺寸为 0，安排延迟重试
        if (scheduleRetry && !state._sizeRetryScheduled) {
            state._sizeRetryScheduled = true;
            state._sizeRetryCount = (state._sizeRetryCount || 0) + 1;

            // 最多重试 20 次，前 5 次快速重试（50ms），后续递增（100ms, 200ms...）
            if (state._sizeRetryCount <= 20) {
                const delay = state._sizeRetryCount <= 5 ? 50 : (state._sizeRetryCount - 5) * 100;
                console.log(`[st-chatu8] Scheduling retry #${state._sizeRetryCount} in ${delay}ms`);
                setTimeout(() => {
                    state._sizeRetryScheduled = false;
                    const success = updateCanvasSize(state, true);
                    // 如果成功且视频已加载，重新渲染一帧
                    if (success && state.isLoaded && state.activeVideo && state.activeVideo.readyState >= 2) {
                        console.log('[st-chatu8] Canvas size updated successfully after retry');
                        renderFrame(state);
                        updateAlphaCache(state);
                        state.alphaCacheDirty = false;
                        state.lastAlphaCacheTime = performance.now();
                    }
                }, delay);
            } else {
                console.error('[st-chatu8] Max retry count reached for updateCanvasSize, giving up');
            }
        }
        return false;
    }

    // 成功获取尺寸，重置重试计数器
    state._sizeRetryCount = 0;
    state._sizeRetryScheduled = false;

    // 视频实际高度是原高的一半（因为上下拼接）
    const videoWidth = video.videoWidth || 1;
    const videoHeight = (video.videoHeight || 1) / 2;

    // 计算保持宽高比的尺寸
    const videoAspect = videoWidth / videoHeight;
    const containerAspect = containerWidth / containerHeight;

    let displayWidth, displayHeight;
    if (videoAspect > containerAspect) {
        displayWidth = containerWidth;
        displayHeight = containerWidth / videoAspect;
    } else {
        displayHeight = containerHeight;
        displayWidth = containerHeight * videoAspect;
    }

    // 设置 canvas 显示尺寸
    canvas.style.width = displayWidth + 'px';
    canvas.style.height = displayHeight + 'px';

    // 设置 canvas 实际分辨率
    canvas.width = videoWidth;
    canvas.height = videoHeight;

    // 更新 WebGL 视口
    state.gl.viewport(0, 0, canvas.width, canvas.height);

    console.log('[st-chatu8] Canvas size updated:', {
        containerSize: `${containerWidth}x${containerHeight}`,
        displaySize: `${displayWidth}x${displayHeight}`,
        resolution: `${canvas.width}x${canvas.height}`
    });

    return true;
}

/**
 * 停止渲染循环
 */
function stopRenderLoop(state) {
    if (state.rafId) {
        cancelAnimationFrame(state.rafId);
        state.rafId = null;
    }
    // ✅ 递增 generation，使旧的 rVFC 回调链自动失效
    state.renderGeneration = (state.renderGeneration || 0) + 1;
}

/**
 * 开始渲染循环
 * ✅ 优化：优先使用 requestVideoFrameCallback 精确在新帧到达时才渲染
 * 不支持时回退到 requestAnimationFrame + 跳帧逻辑
 */
function startRenderLoop(state) {
    stopRenderLoop(state);

    // 检测是否支持 requestVideoFrameCallback
    if (state.activeVideo &&
        typeof state.activeVideo.requestVideoFrameCallback === 'function') {
        // ✅ 使用 requestVideoFrameCallback：精确在视频新帧到达时才触发渲染
        state._usingRVFC = true; // ✅ 标记当前使用 rVFC 路径，供健康监控判断
        startVideoFrameLoop(state);
    } else {
        // 回退到 requestAnimationFrame（配合 renderFrame 内的跳帧逻辑）
        state._usingRVFC = false;
        startRafLoop(state);
    }
}

/**
 * requestVideoFrameCallback 驱动的渲染循环
 * 仅在视频解码出新帧时才触发，省电且精确
 */
function startVideoFrameLoop(state) {
    if (state.hasError || !state.isPlaying) return;

    // 记录当前 generation，用于检测是否被新的循环取代
    const myGeneration = state.renderGeneration || 0;

    const onVideoFrame = (now, metadata) => {
        // ✅ 如果 generation 已变化，说明新的渲染循环已启动，旧回调链自动退出
        if (state.renderGeneration !== myGeneration) return;
        if (state.hasError || !state.isPlaying) return;

        renderFrame(state);

        // 递归注册下一帧回调（必须在当前活跃视频上注册）
        if (state.activeVideo && !state.activeVideo.paused &&
            typeof state.activeVideo.requestVideoFrameCallback === 'function') {
            state.activeVideo.requestVideoFrameCallback(onVideoFrame);
        }
    };

    if (state.activeVideo && !state.activeVideo.paused) {
        state.activeVideo.requestVideoFrameCallback(onVideoFrame);
    }
}

/**
 * requestAnimationFrame 回退渲染循环
 * 配合 renderFrame 内的 lastVideoTime 跳帧逻辑，避免冗余纹理上传
 */
function startRafLoop(state) {
    const render = () => {
        if (state.hasError || !state.isPlaying) {
            return;
        }

        renderFrame(state);
        state.rafId = requestAnimationFrame(render);
    };

    render();
}

/**
 * 渲染单帧
 * ✅ 优化：移除定期 readPixels，alpha 缓存改为按需更新
 * ✅ 优化：跳过重复帧，避免无效的纹理上传
 */
function renderFrame(state) {
    const { gl, texture, activeVideo } = state;

    // ✅ 安卓兼容：如果 WebGL 上下文已丢失，跳过渲染
    if (gl.isContextLost()) {
        return;
    }

    if (activeVideo.readyState < 2) {
        return;
    }

    // ✅ 优化：跳过重复帧 — 如果视频时间没变，不需要重新上传纹理
    const currentTime = activeVideo.currentTime;
    if (currentTime === state.lastVideoTime) {
        return;
    }
    state.lastVideoTime = currentTime;

    // 标记 alpha 缓存为脏（视频帧变化了）
    state.alphaCacheDirty = true;

    // 更新纹理
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, activeVideo);

    // 清空画布
    // ✅ PiP 模式下使用不透明背景色，避免 captureStream 时透明通道变黑
    if (state.pipBackgroundEnabled) {
        gl.clearColor(0.102, 0.102, 0.180, 1.0); // #1a1a2e 深色背景
    } else {
        gl.clearColor(0, 0, 0, 0); // 正常模式：透明背景
    }
    gl.clear(gl.COLOR_BUFFER_BIT);

    // 绘制
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
}

/**
 * 更新 alpha 缓存（用于 hitTest）
 */
function updateAlphaCache(state) {
    const { gl, canvasElement } = state;
    const width = canvasElement.width;
    const height = canvasElement.height;

    try {
        const pixels = new Uint8Array(width * height * 4);
        gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
        state.alphaCache = { pixels, width, height };
    } catch (error) {
        console.warn('Failed to update alpha cache:', error);
    }
}

/**
 * 预加载视频到第一帧
 */
function preloadVideoToFirstFrame(video) {
    video.currentTime = 0;
    video.pause();
}

/**
 * ✅ 新增：懒加载视频辅助函数
 * 首次调用时创建视频元素并加载，后续调用直接返回已加载的视频
 * @param {object} state - 播放器状态
 * @param {string} videoKey - state 中的视频属性名（如 'headPatVideo'）
 * @param {string} srcKey - state 中的视频路径属性名（如 'headPatVideoSrc'）
 * @param {string} id - 视频元素 ID
 * @returns {Promise<HTMLVideoElement>} 已加载的视频元素
 */
function ensureVideoLoaded(state, videoKey, srcKey, id) {
    return new Promise((resolve, reject) => {
        // 已加载完成，直接返回
        if (state[videoKey] && state[videoKey].readyState >= 2) {
            resolve(state[videoKey]);
            return;
        }

        // 正在加载中，等待完成
        const loadingKey = videoKey + 'Loading';
        if (state[loadingKey] && state[videoKey]) {
            const onLoaded = () => {
                state[videoKey].removeEventListener('loadeddata', onLoaded);
                state[videoKey].removeEventListener('error', onError);
                resolve(state[videoKey]);
            };
            const onError = () => {
                state[videoKey].removeEventListener('loadeddata', onLoaded);
                state[videoKey].removeEventListener('error', onError);
                reject(new Error(`可选视频 ${id} 加载失败`));
            };
            state[videoKey].addEventListener('loadeddata', onLoaded);
            state[videoKey].addEventListener('error', onError);
            return;
        }

        // 首次加载：创建视频元素
        state[loadingKey] = true;
        const video = createHiddenVideo(state[srcKey], id);
        state[videoKey] = video;

        // ✅ 修复：先注册监听器，再启动加载
        video.addEventListener('loadeddata', () => {
            state[loadingKey] = false;
            resolve(video);
        });
        video.addEventListener('error', () => {
            state[loadingKey] = false;
            console.warn(`[st-chatu8] 可选视频 ${id} 加载失败，功能不可用`);
            reject(new Error(`可选视频 ${id} 加载失败`));
        });

        // ✅ 修复：使用新的加载函数，确保事件监听器已注册
        startVideoLoad(video);
    });
}

/**
 * ✅ 新增：为摸头视频注册 ended 事件处理器
 * 在懒加载完成后调用，确保事件绑定到正确的视频元素
 */
function setupHeadPatEndedHandler(state) {
    if (!state.headPatVideo) return;

    state.headPatVideo.addEventListener('ended', () => {
        if (state.isPlayingHeadPat) {
            state.isPlayingHeadPat = false;

            // 检查是否正在加载
            const fab = document.getElementById('st-chatu8-fab');
            const isLoading = fab && fab.dataset.isLoading === 'true';

            if (isLoading && state.thinkingVideo && state.thinkingVideo.readyState >= 2) {
                // 正在加载且思考视频可用，切换到思考视频
                state.currentVideo = 'thinking';
                state.isPlayingThinking = true;
                state.alphaCacheDirty = true;
                state.lastVideoTime = -1;
                state.activeVideo = state.thinkingVideo;

                state.thinkingVideo.currentTime = 0;
                state.thinkingVideo.play().catch(err => {
                    console.error('Failed to play thinking video after head pat:', err);
                    state.isPlayingThinking = false;
                    switchToIdleVideo(state);
                });
                startRenderLoop(state);
            } else {
                // 不在加载或思考视频不可用，切换到静息视频
                switchToIdleVideo(state);
            }
        }
    });
}

/**
 * ✅ 新增：为思考视频注册 ended 事件处理器（循环播放）
 * 在懒加载完成后调用
 */
function setupThinkingEndedHandler(state) {
    if (!state.thinkingVideo) return;

    state.thinkingVideo.addEventListener('ended', () => {
        if (state.isPlayingThinking) {
            state.thinkingVideo.currentTime = 0;
            const playPromise = state.thinkingVideo.play();
            if (playPromise !== undefined) {
                playPromise.catch(err => {
                    if (err.name !== 'AbortError') {
                        console.error('Failed to loop thinking video:', err);
                    }
                });
            }
        }
    });
}

/**
 * ✅ 新增：暂停所有视频（统一管理，确保只有一个视频播放）
 */
function pauseAllVideos(state) {
    const videos = [
        state.idleVideo,
        state.idleVideoClone,
        state.draggingVideo,
        state.draggingVideoClone,
        state.thinkingVideo,
        state.headPatVideo,
        state.talkVideo
    ];

    videos.forEach(video => {
        if (video && !video.paused) {
            video.pause();
        }
    });
}

/**
 * 设置视频结束处理
 */
function setupEndedHandler(video, clone, state) {
    video.addEventListener('ended', () => {
        const oldActive = state.activeVideo;
        state.activeVideo = clone;
        state.alphaCacheDirty = true; // ✅ 视频切换，标记缓存需要更新
        state.lastVideoTime = -1; // ✅ 强制下一帧上传纹理

        clone.currentTime = 0;
        const playPromise = clone.play();
        if (playPromise !== undefined) {
            playPromise.then(() => {
                // ✅ 视频切换后重新启动渲染循环（rVFC 需要注册到新的视频上）
                startRenderLoop(state);
                setTimeout(() => {
                    preloadVideoToFirstFrame(video);
                }, 100);
            }).catch(err => {
                if (err.name !== 'AbortError') {
                    console.error('Failed to play clone video:', err);
                }
            });
        }
    });
}

/**
 * 像素级命中检测
 * ✅ 优化：alpha 缓存改为按需更新，带 200ms 节流，避免渲染循环中频繁 readPixels
 */
function hitTest(state, clientX, clientY) {
    if (state.hasError || !state.isLoaded) {
        return true;
    }

    // ✅ 按需更新 alpha 缓存：仅在缓存为空、标记为脏、或超过 200ms 时更新
    const now = performance.now();
    if (!state.alphaCache || state.alphaCacheDirty || (now - state.lastAlphaCacheTime > 200)) {
        updateAlphaCache(state);
        state.alphaCacheDirty = false;
        state.lastAlphaCacheTime = now;
    }

    if (!state.alphaCache) {
        return true; // 缓存更新失败，默认命中
    }

    const { canvasElement, alphaCache } = state;
    if (!canvasElement) return false;
    const rect = canvasElement.getBoundingClientRect();

    const relX = clientX - rect.left;
    const relY = clientY - rect.top;

    const canvasX = Math.floor((relX / rect.width) * alphaCache.width);
    const canvasY = Math.floor((relY / rect.height) * alphaCache.height);

    if (canvasX < 0 || canvasY < 0 || canvasX >= alphaCache.width || canvasY >= alphaCache.height) {
        return false;
    }

    const index = (canvasY * alphaCache.width + canvasX) * 4 + 3; // alpha 通道
    const alpha = alphaCache.pixels[index];

    return alpha > 15; // alpha 阈值
}

/**
 * 切换到静息视频
 */
function switchToIdleVideo(state) {
    if (state.hasError || state.currentVideo === 'idle') return;

    state.currentVideo = 'idle';

    // ✅ 优化：先暂停所有视频，确保只有一个视频播放
    pauseAllVideos(state);

    // 清除状态标记
    state.isPlayingThinking = false;
    state.isPlayingHeadPat = false;
    state.isPlayingTalk = false;
    state.alphaCacheDirty = true; // ✅ 视频切换，标记缓存需要更新
    state.lastVideoTime = -1; // ✅ 强制下一帧上传纹理

    state.idleVideo.currentTime = 0;
    const playPromise = state.idleVideo.play();
    if (playPromise !== undefined) {
        playPromise.catch(err => {
            if (err.name !== 'AbortError') {
                console.error('Failed to play idle video:', err);
            }
        });
    }

    state.activeVideo = state.idleVideo;
    preloadVideoToFirstFrame(state.idleVideoClone);

    // ✅ 重启渲染循环（rVFC 需要注册到新的活跃视频上）
    startRenderLoop(state);
}

/**
 * 切换到拖动视频
 */
function switchToDraggingVideo(state) {
    if (state.hasError || state.currentVideo === 'dragging') return;

    state.currentVideo = 'dragging';

    // ✅ 优化：先暂停所有视频，确保只有一个视频播放
    // 注意：不清除 isPlayingThinking 和 isPlayingHeadPat，拖动结束后需要恢复
    pauseAllVideos(state);
    state.alphaCacheDirty = true; // ✅ 视频切换，标记缓存需要更新
    state.lastVideoTime = -1; // ✅ 强制下一帧上传纹理

    state.draggingVideo.currentTime = 0;
    const playPromise = state.draggingVideo.play();
    if (playPromise !== undefined) {
        playPromise.catch(err => {
            if (err.name !== 'AbortError') {
                console.error('Failed to play dragging video:', err);
            }
        });
    }

    state.activeVideo = state.draggingVideo;
    preloadVideoToFirstFrame(state.draggingVideoClone);

    // ✅ 重启渲染循环（rVFC 需要注册到新的活跃视频上）
    startRenderLoop(state);
}

/**
 * ✅ 新增：播放摸头视频（懒加载版本）
 */
async function playHeadPatVideo(state) {
    if (state.hasError || state.isPlayingHeadPat) return;

    // ✅ 懒加载：首次使用时才创建和加载摸头视频
    try {
        const video = await ensureVideoLoaded(
            state, 'headPatVideo', 'headPatVideoSrc',
            'st-chatu8-fab-video-headpat'
        );

        // 首次加载成功后注册 ended 事件处理器
        if (!video._endedHandlerRegistered) {
            setupHeadPatEndedHandler(state);
            video._endedHandlerRegistered = true;
        }
    } catch (err) {
        console.warn('摸头视频不可用');
        return;
    }

    // 检查摸头视频是否加载成功
    if (!state.headPatVideo || state.headPatVideo.readyState < 2) {
        console.warn('Head pat video not ready');
        return;
    }

    state.isPlayingHeadPat = true;
    state.currentVideo = 'headpat';

    // ✅ 优化：先暂停所有视频，确保只有一个视频播放
    pauseAllVideos(state);
    state.alphaCacheDirty = true; // ✅ 视频切换，标记缓存需要更新
    state.lastVideoTime = -1; // ✅ 强制下一帧上传纹理

    // 播放摸头视频
    state.headPatVideo.currentTime = 0;
    const playPromise = state.headPatVideo.play();
    if (playPromise !== undefined) {
        playPromise.catch(err => {
            if (err.name === 'AbortError') return;
            console.error('Failed to play head pat video:', err);
            state.isPlayingHeadPat = false;
            // 播放失败，切回静息视频
            switchToIdleVideo(state);
        });
    }

    state.activeVideo = state.headPatVideo;

    // ✅ 重启渲染循环（rVFC 需要注册到新的活跃视频上）
    startRenderLoop(state);
}

/**
 * ✅ 新增：播放思考视频（循环播放，懒加载版本）
 */
async function playThinkingVideo(state) {
    if (state.hasError) return;

    // ✅ 标记播放意图，防止异步加载期间被 stop 后仍继续播放导致视频卡在思考状态
    state.thinkingRequested = true;

    // ✅ 懒加载：首次使用时才创建和加载思考视频
    try {
        const video = await ensureVideoLoaded(
            state, 'thinkingVideo', 'thinkingVideoSrc',
            'st-chatu8-fab-video-thinking'
        );

        // 异步加载期间可能已被 stopThinkingVideo 取消
        if (!state.thinkingRequested) return;

        // 首次加载成功后注册 ended 事件处理器
        if (!video._endedHandlerRegistered) {
            setupThinkingEndedHandler(state);
            video._endedHandlerRegistered = true;
        }
    } catch (err) {
        console.warn('思考视频不可用，使用传统加载动画');
        // 回退到传统 CSS 加载动画（仅在仍有播放意图时）
        if (state.thinkingRequested) {
            const fab = document.getElementById('st-chatu8-fab');
            if (fab) fab.classList.add('st-chatu8-fab-loading');
        }
        return;
    }

    // 再次检查意图（防御性）
    if (!state.thinkingRequested) return;

    // 检查思考视频是否加载成功
    if (!state.thinkingVideo || state.thinkingVideo.readyState < 2) {
        console.warn('Thinking video not ready');
        return;
    }

    // ✅ 优化：如果已经在播放思考视频且视频正在播放，只需恢复播放
    if (state.isPlayingThinking && state.currentVideo === 'thinking') {
        if (state.thinkingVideo.paused) {
            const playPromise = state.thinkingVideo.play();
            if (playPromise !== undefined) {
                playPromise.catch(err => {
                    if (err.name !== 'AbortError') {
                        console.error('Failed to resume thinking video:', err);
                    }
                });
            }
        }
        return;
    }

    state.isPlayingThinking = true;
    state.currentVideo = 'thinking';

    // ✅ 优化：先暂停所有视频，确保只有一个视频播放
    pauseAllVideos(state);
    state.alphaCacheDirty = true; // ✅ 视频切换，标记缓存需要更新
    state.lastVideoTime = -1; // ✅ 强制下一帧上传纹理

    // 确保清除摸头状态
    state.isPlayingHeadPat = false;

    // 播放思考视频（从头开始）
    state.thinkingVideo.currentTime = 0;
    const playPromise = state.thinkingVideo.play();
    if (playPromise !== undefined) {
        playPromise.catch(err => {
            if (err.name === 'AbortError') {
                return; // 忽略中断错误
            }
            console.error('Failed to play thinking video:', err);
            state.isPlayingThinking = false;
            // 播放失败，切回静息视频
            switchToIdleVideo(state);
        });
    }

    state.activeVideo = state.thinkingVideo;

    // ✅ 重启渲染循环（rVFC 需要注册到新的活跃视频上）
    startRenderLoop(state);
}

/**
 * ✅ 新增：停止思考视频，切回静息视频
 */
function stopThinkingVideo(state) {
    // ✅ 始终清除播放意图，取消仍在异步加载的 playThinkingVideo 调用
    const wasRequested = state.thinkingRequested;
    state.thinkingRequested = false;

    // 移除传统 CSS 加载动画（如果有）
    const fab = document.getElementById('st-chatu8-fab');
    if (fab) fab.classList.remove('st-chatu8-fab-loading');

    if (!state.isPlayingThinking) {
        // 当前未实际播放思考视频；若之前只是请求过（异步加载中被取消），无需切换视频
        return;
    }

    state.isPlayingThinking = false;
    if (state.thinkingVideo) {
        state.thinkingVideo.pause();
    }

    // 切回静息视频
    switchToIdleVideo(state);
}

/**
 * ✅ 新增：播放说话视频（循环播放，懒加载版本）
 */
async function playTalkVideo(state) {
    if (state.hasError) return;

    // ✅ 懒加载：首次使用时才创建和加载说话视频
    try {
        const video = await ensureVideoLoaded(
            state, 'talkVideo', 'talkVideoSrc',
            'st-chatu8-fab-video-talk'
        );

        // 首次加载成功后注册 ended 事件处理器（循环播放）
        if (!video._endedHandlerRegistered) {
            video.addEventListener('ended', () => {
                if (state.isPlayingTalk) {
                    console.log('[st-chatu8] Talk video ended, looping...');
                    video.currentTime = 0;
                    const playPromise = video.play();
                    if (playPromise !== undefined) {
                        playPromise.then(() => {
                            console.log('[st-chatu8] Talk video loop successful');
                            // ✅ 修复：循环播放后重启渲染循环，确保 rVFC 回调链不中断
                            startRenderLoop(state);
                        }).catch(err => {
                            if (err.name !== 'AbortError') {
                                console.error('[st-chatu8] Failed to loop talk video:', err);
                                // ✅ 修复：循环失败时清除状态并切回静息视频
                                state.isPlayingTalk = false;
                                switchToIdleVideo(state);
                            }
                        });
                    }
                }
            });
            video._endedHandlerRegistered = true;
        }
    } catch (err) {
        console.warn('说话视频不可用');
        return;
    }

    // 检查说话视频是否加载成功
    if (!state.talkVideo || state.talkVideo.readyState < 2) {
        console.warn('Talk video not ready');
        return;
    }

    // ✅ 优化：如果已经在播放说话视频且视频正在播放，只需恢复播放
    if (state.isPlayingTalk && state.currentVideo === 'talk') {
        if (state.talkVideo.paused) {
            console.log('[st-chatu8] Resuming paused talk video');
            const playPromise = state.talkVideo.play();
            if (playPromise !== undefined) {
                playPromise.then(() => {
                    // ✅ 修复：恢复播放后重启渲染循环
                    startRenderLoop(state);
                }).catch(err => {
                    if (err.name !== 'AbortError') {
                        console.error('Failed to resume talk video:', err);
                        // ✅ 修复：恢复失败时清除状态
                        state.isPlayingTalk = false;
                        switchToIdleVideo(state);
                    }
                });
            }
        }
        return;
    }

    console.log('[st-chatu8] Starting talk video playback');
    state.isPlayingTalk = true;
    state.currentVideo = 'talk';

    // ✅ 优化：先暂停所有视频，确保只有一个视频播放
    pauseAllVideos(state);
    state.alphaCacheDirty = true; // ✅ 视频切换，标记缓存需要更新
    state.lastVideoTime = -1; // ✅ 强制下一帧上传纹理

    // 确保清除其他状态
    state.isPlayingThinking = false;
    state.isPlayingHeadPat = false;

    // ✅ 修复：清除可能存在的健康检查定时器
    if (state.talkVideoHealthCheckInterval) {
        clearInterval(state.talkVideoHealthCheckInterval);
        state.talkVideoHealthCheckInterval = null;
    }

    // 播放说话视频（从头开始）
    state.talkVideo.currentTime = 0;
    const playPromise = state.talkVideo.play();
    if (playPromise !== undefined) {
        playPromise.then(() => {
            console.log('[st-chatu8] Talk video play successful');
            // ✅ 新增：启动健康检查，监控视频是否真的在播放
            state.talkVideoHealthCheckInterval = setInterval(() => {
                if (state.isPlayingTalk && state.talkVideo) {
                    // 检查视频是否意外暂停
                    if (state.talkVideo.paused && state.talkVideo.readyState >= 2) {
                        console.warn('[st-chatu8] Talk video unexpectedly paused, attempting to resume...');
                        state.talkVideo.play().catch(err => {
                            console.error('[st-chatu8] Failed to resume talk video in health check:', err);
                            state.isPlayingTalk = false;
                            clearInterval(state.talkVideoHealthCheckInterval);
                            state.talkVideoHealthCheckInterval = null;
                            switchToIdleVideo(state);
                        });
                    }
                    // 检查渲染循环是否还在运行
                    if (!state.isPlaying) {
                        console.warn('[st-chatu8] Render loop stopped unexpectedly, restarting...');
                        state.isPlaying = true;
                        startRenderLoop(state);
                    }
                }
            }, 2000); // 每 2 秒检查一次
        }).catch(err => {
            if (err.name === 'AbortError') {
                return; // 忽略中断错误
            }
            console.error('Failed to play talk video:', err);
            state.isPlayingTalk = false;
            // 播放失败，切回静息视频
            switchToIdleVideo(state);
        });
    }

    state.activeVideo = state.talkVideo;

    // ✅ 重启渲染循环（rVFC 需要注册到新的活跃视频上）
    startRenderLoop(state);
}

/**
 * ✅ 新增：停止说话视频，切回静息视频
 */
function stopTalkVideo(state) {
    if (!state.isPlayingTalk) return;

    console.log('[st-chatu8] Stopping talk video');
    state.isPlayingTalk = false;

    // ✅ 修复：清除健康检查定时器
    if (state.talkVideoHealthCheckInterval) {
        clearInterval(state.talkVideoHealthCheckInterval);
        state.talkVideoHealthCheckInterval = null;
    }

    if (state.talkVideo) {
        state.talkVideo.pause();
    }

    // 切回静息视频
    switchToIdleVideo(state);
}

/**
 * 暂停播放
 */
function pause(state) {
    if (state.hasError) return;

    state.activeVideo.pause();
    state.isPlaying = false;
    stopRenderLoop(state);
}

/**
 * 恢复播放
 */
function resume(state) {
    if (state.hasError) return;

    const playPromise = state.activeVideo.play();
    if (playPromise !== undefined) {
        playPromise.then(() => {
            state.isPlaying = true;
            startRenderLoop(state);
        }).catch(err => {
            if (err.name !== 'AbortError') {
                console.error('Failed to resume video:', err);
            }
        });
    }
}

/**
 * 销毁播放器
 */
function destroy(state) {
    stopRenderLoop(state);

    // ✅ 清除健康检查定时器
    if (state.talkVideoHealthCheckInterval) {
        clearInterval(state.talkVideoHealthCheckInterval);
        state.talkVideoHealthCheckInterval = null;
    }

    // ✅ 清除主视频心跳监控定时器
    if (state.healthMonitorInterval) {
        clearInterval(state.healthMonitorInterval);
        state.healthMonitorInterval = null;
    }

    // ✅ 移除 visibilitychange 事件监听器，避免内存泄漏
    if (state.handleVisibilityChange) {
        document.removeEventListener('visibilitychange', state.handleVisibilityChange);
        state.handleVisibilityChange = null;
    }

    // ✅ 移除 pageshow 事件监听器
    if (state.handlePageShow) {
        window.removeEventListener('pageshow', state.handlePageShow);
        state.handlePageShow = null;
    }

    // ✅ 移除 WebGL 上下文丢失/恢复事件监听器
    if (state.canvasElement) {
        if (state.handleContextLost) {
            state.canvasElement.removeEventListener('webglcontextlost', state.handleContextLost);
            state.handleContextLost = null;
        }
        if (state.handleContextRestored) {
            state.canvasElement.removeEventListener('webglcontextrestored', state.handleContextRestored);
            state.handleContextRestored = null;
        }
    }

    // ✅ 移除 window focus 事件监听器
    if (state.handleWindowFocus) {
        window.removeEventListener('focus', state.handleWindowFocus);
        state.handleWindowFocus = null;
    }

    state.isPlaying = false;
    state.isLoaded = false;
    state.isPlayingHeadPat = false;
    state.isPlayingThinking = false;
    state.isPlayingTalk = false;

    [state.idleVideo, state.draggingVideo, state.idleVideoClone, state.draggingVideoClone, state.headPatVideo, state.thinkingVideo, state.talkVideo].forEach(video => {
        if (video) {
            video.pause();
            // 释放 Blob URL 防止内存泄漏
            if (video.src && video.src.startsWith('blob:')) {
                URL.revokeObjectURL(video.src);
            }
            video.src = '';
            video.removeAttribute('src');
            video.load(); // 强制释放解码器资源
            if (video.parentNode) {
                video.parentNode.removeChild(video);
            }
        }
    });

    if (state.canvasElement && state.canvasElement.parentNode) {
        state.canvasElement.parentNode.removeChild(state.canvasElement);
    }

    // 清理 WebGL 上下文
    if (state.gl) {
        const ext = state.gl.getExtension('WEBGL_lose_context');
        if (ext) ext.loseContext();
    }

    // 清理 alpha 缓存
    state.alphaCache = null;

    const icon = state.container.querySelector('i');
    if (icon) {
        icon.style.display = '';
    }
}

/**
 * 更新尺寸
 */
function updateSize(state, size) {
    const container = state.container;

    if (size) {
        container.style.width = size + 'px';
        container.style.height = size + 'px';
    }

    void container.offsetWidth;

    const sizeChanged = updateCanvasSize(state);

    if (sizeChanged && state.isLoaded && state.activeVideo && state.activeVideo.readyState >= 2) {
        renderFrame(state);
        updateAlphaCache(state);
        state.alphaCacheDirty = false;
        state.lastAlphaCacheTime = performance.now();
    }
}

/**
 * 回退到传统图标模式
 */
function fallbackToTraditionalMode(container) {
    console.warn('Falling back to traditional icon mode');

    const canvas = container.querySelector('canvas');
    if (canvas) {
        canvas.style.display = 'none';
    }

    const icon = container.querySelector('i');
    if (icon) {
        icon.style.display = '';
    }
}

/**
 * 检测浏览器是否支持 WebGL
 */
export function checkWebGLSupport() {
    try {
        const canvas = document.createElement('canvas');
        return !!(canvas.getContext('webgl') || canvas.getContext('experimental-webgl'));
    } catch (e) {
        return false;
    }
}
