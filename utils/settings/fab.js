// @ts-nocheck
import { extension_settings } from "../../../../../extensions.js";
import { saveSettingsDebounced } from "../../../../../../script.js";
import { extensionName } from '../config.js';
import { showSettingsPanel, applyFabSettings, getGlobalVideoPlayer, getGlobalVideoController } from '../ui_common.js';
import { createVideoPlayer, checkWebGLSupport } from './fabVideoPlayerWebGL.js';
import { initVideoController } from './fabVideoController.js';

/**
 * ✅ 检测 FAB 中心是否落在视口外，若是则重置回屏幕中心并保存
 * 触发场景：仅在初次加载（initFab）时调用一次
 *  - 处理"用户上次保存的位置在当前屏幕已不可见"的情况（例如更换设备/分辨率变化）
 *
 * 不在 resize / orientationchange / visibilitychange 中调用，避免：
 *  - 用户故意把球放在边缘时被反复重置
 *  - 拖动/旋转过程中频繁跳位
 */
function ensureFabCenterInViewport() {
    const fab = document.getElementById('st-chatu8-fab');
    if (!fab) return;

    // FAB 没启用时不处理
    const settings = extension_settings[extensionName];
    if (!settings || String(settings.enable_chatu8_fab) !== 'true') return;

    const rect = fab.getBoundingClientRect();

    // 容器尺寸为 0 通常是 display:none / 正在初始化，跳过
    if (rect.width === 0 || rect.height === 0) return;

    const screenWidth = window.innerWidth;
    const screenHeight = window.innerHeight;

    // ✅ 检测 FAB 是否完整落在视口内（允许 2px 容差，避免亚像素抖动误触）
    // 任意一边超出 → 视为"被折叠/裁切"，重置回屏幕中心
    const tolerance = 2;
    const fullyInside =
        rect.left >= -tolerance &&
        rect.top >= -tolerance &&
        rect.right <= screenWidth + tolerance &&
        rect.bottom <= screenHeight + tolerance;

    if (fullyInside) return;

    console.warn('[FAB] 检测到 FAB 部分超出视口，重置到屏幕中心', {
        rect: { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom },
        viewport: { w: screenWidth, h: screenHeight }
    });

    // 计算新的左上角坐标，使 FAB 居中
    const newLeft = Math.max(0, (screenWidth - rect.width) / 2);
    const newTop = Math.max(0, (screenHeight - rect.height) / 2);

    fab.style.left = `${newLeft}px`;
    fab.style.top = `${newTop}px`;

    // 持久化保存到对应设备
    if (!settings.chatu8_fab_position) {
        settings.chatu8_fab_position = { desktop: {}, mobile: {} };
    }
    const isMobile = window.innerWidth <= 768;
    const target = isMobile ? settings.chatu8_fab_position.mobile : settings.chatu8_fab_position.desktop;
    if (target) {
        target.top = fab.style.top;
        target.left = fab.style.left;
        saveSettingsDebounced();
    }
}

export function initFab() {
    let fab = document.getElementById('st-chatu8-fab');
    if (!fab) return;

    let isDragging = false;
    let hasMoved = false;
    let offsetX, offsetY;

    // 长按检测相关的状态变量
    let longPressTimeout = null;
    let isLongPress = false;
    let startX = 0, startY = 0;

    // ✅ 性能优化：使用 RAF 节流拖动更新
    let rafId = null;
    let pendingPosition = null;

    /**
     * ✅ 辅助函数：判断坐标是否落在 FAB 容器的 boundingRect 内
     */
    const isPointInFabRect = (clientX, clientY) => {
        const rect = fab.getBoundingClientRect();
        return (
            clientX >= rect.left &&
            clientX <= rect.right &&
            clientY >= rect.top &&
            clientY <= rect.bottom
        );
    };

    /**
     * ✅ 辅助函数：检测 FAB 是否与 AI 对话框在视觉上重合
     */
    const isFabOverlappingDialog = () => {
        const aiDialog = document.getElementById('st-chatu8-ai-dialog');
        if (!aiDialog || !aiDialog.classList.contains('active')) {
            return false;
        }

        const fabRect = fab.getBoundingClientRect();
        const dialogRect = aiDialog.getBoundingClientRect();

        // 检测矩形是否重叠
        return !(
            fabRect.right < dialogRect.left ||
            fabRect.left > dialogRect.right ||
            fabRect.bottom < dialogRect.top ||
            fabRect.top > dialogRect.bottom
        );
    };

    /**
     * ✅ 辅助函数：判断当前是否为视频模式
     * 视频模式下 FAB 有 pointer-events: none，需要通过 document 级事件处理
     */
    const isVideoMode = () => {
        return fab.classList.contains('st-chatu8-fab-video-mode');
    };

    /**
     * ✅ 辅助函数：事件目标是否来自设置面板（含外层 #st-chatu8-settings 和模态 #ch-settings-modal）
     * 视频模式下 FAB 走 document 级监听，会吃掉设置面板内的点击，需在此拦截。
     */
    const isEventFromSettingsPanel = (e) => {
        const target = e.target;
        if (!target || typeof target.closest !== 'function') return false;
        return !!target.closest('#ch-settings-modal, #st-chatu8-settings');
    };

    const dragStart = (e) => {
        // ✅ 优先级控制：只有当 FAB 与 AI 面板重合时才阻止交互
        if (isFabOverlappingDialog()) {
            return;
        }

        // ✅ 修复：视频模式下事件来自 document，需要检查坐标是否在 FAB 区域内
        const clientX = e.type === 'touchstart' ? e.touches[0].clientX : e.clientX;
        const clientY = e.type === 'touchstart' ? e.touches[0].clientY : e.clientY;

        const videoPlayer = getGlobalVideoPlayer();

        // 如果启用了视频模式，检查点击位置是否在不透明区域
        if (videoPlayer) {
            // 先检查是否在 FAB 的 boundingRect 内
            if (!isPointInFabRect(clientX, clientY)) {
                return;
            }

            const isHit = videoPlayer.hitTest(clientX, clientY);

            if (!isHit) {
                // 点击在透明区域，不响应，让事件穿透到下层页面
                return;
            }

            // ✅ 视频模式命中不透明区域：阻止事件传播，防止影响下层元素
            e.preventDefault();
            e.stopPropagation();
        }

        const rect = fab.getBoundingClientRect();

        isDragging = true;
        hasMoved = false;
        isLongPress = false;
        fab.style.cursor = 'grabbing';
        fab.classList.add('st-chatu8-fab-dragging');

        // 记录初始按下坐标，用于防抖判断
        startX = clientX;
        startY = clientY;
        offsetX = clientX - rect.left;
        offsetY = clientY - rect.top;

        // 启动长按定时(500 毫秒)
        longPressTimeout = setTimeout(() => {
            if (!hasMoved) {
                isLongPress = true;
                // 若设备支持，提供手机端触觉反馈
                if (navigator.vibrate) {
                    navigator.vibrate(50);
                }

                // 触发智绘姬面板
                const triggerBtn = document.getElementById('st-chatu8-ai-trigger');
                if (triggerBtn) {
                    triggerBtn.click(); // 通过模拟点击触发已有 AI 面板唤出事件
                } else {
                    // 降级方案：直接操作对话框
                    const dialog = document.getElementById('st-chatu8-ai-dialog');
                    if (dialog && !dialog.classList.contains('active')) {
                        // 初次打开时，计算居中位置
                        const dialogWidth = dialog.offsetWidth;
                        const dialogHeight = dialog.offsetHeight;
                        const viewportWidth = window.innerWidth;
                        const viewportHeight = window.innerHeight;

                        // 计算居中位置（左上角坐标）
                        const centerLeft = (viewportWidth - dialogWidth) / 2;
                        const centerTop = (viewportHeight - dialogHeight) / 2;

                        dialog.style.left = Math.max(0, centerLeft) + 'px';
                        dialog.style.top = Math.max(0, centerTop) + 'px';

                        dialog.classList.add('active');
                        setTimeout(() => {
                            const inputArea = document.getElementById('st-chatu8-ai-input');
                            if (inputArea) inputArea.focus();
                        }, 300);
                    }
                }
            }
        }, 500);

        document.addEventListener('mousemove', dragMove);
        document.addEventListener('touchmove', dragMove, { passive: false });
        document.addEventListener('mouseup', dragEnd);
        document.addEventListener('touchend', dragEnd);
    };

    const dragMove = (e) => {
        if (!isDragging) return;
        if (e.type === 'touchmove') e.preventDefault();

        const clientX = e.type === 'touchmove' ? e.touches[0].clientX : e.clientX;
        const clientY = e.type === 'touchmove' ? e.touches[0].clientY : e.clientY;

        // 【5px 防抖阈值】若滑动距离极短（手抖），不算拖动
        if (!hasMoved) {
            const moveDistance = Math.sqrt(Math.pow(clientX - startX, 2) + Math.pow(clientY - startY, 2));
            if (moveDistance > 5) {
                hasMoved = true;
                // 一旦判定为拖动，立即清理长按定时器
                if (longPressTimeout) {
                    clearTimeout(longPressTimeout);
                    longPressTimeout = null;
                }

                // 通知视频控制器开始拖动
                const videoController = getGlobalVideoController();
                if (videoController) {
                    videoController.onDragStart();
                }
            }
        }

        // 真正判定为拖拽后，才执行位置更新
        if (hasMoved) {
            // ✅ 优化：计算新位置但不立即应用，使用 RAF 批量更新
            let newLeft = clientX - offsetX;
            let newTop = clientY - offsetY;

            const fabWidth = fab.offsetWidth;
            const fabHeight = fab.offsetHeight;
            const screenWidth = window.innerWidth;
            const screenHeight = window.innerHeight;

            // 允许 FAB 部分超出屏幕，只保留最小可见区域（例如 20px）
            const minVisibleSize = 20;
            const maxLeft = screenWidth - minVisibleSize;
            const maxTop = screenHeight - minVisibleSize;
            const minLeft = -(fabWidth - minVisibleSize);
            const minTop = -(fabHeight - minVisibleSize);

            if (newLeft < minLeft) newLeft = minLeft;
            if (newTop < minTop) newTop = minTop;
            if (newLeft > maxLeft) newLeft = maxLeft;
            if (newTop > maxTop) newTop = maxTop;

            // ✅ 优化：保存待更新的位置，使用 RAF 统一更新
            pendingPosition = { left: newLeft, top: newTop };

            // 如果还没有 RAF 在运行，启动一个
            if (!rafId) {
                rafId = requestAnimationFrame(updateFabPosition);
            }
        }
    };

    // ✅ 新增：使用 RAF 批量更新位置，避免频繁触发重排
    const updateFabPosition = () => {
        if (pendingPosition) {
            // 直接更新 left/top，通过 RAF 批量处理减少重排
            fab.style.left = `${pendingPosition.left}px`;
            fab.style.top = `${pendingPosition.top}px`;

            pendingPosition = null;
        }
        rafId = null;
    };

    const dragEnd = (e) => {
        // 清理长按定时器，防止误触
        if (longPressTimeout) {
            clearTimeout(longPressTimeout);
            longPressTimeout = null;
        }

        // ✅ 优化：清理 RAF
        if (rafId) {
            cancelAnimationFrame(rafId);
            rafId = null;
        }

        // 如果有待更新的位置，立即应用
        if (pendingPosition) {
            fab.style.left = `${pendingPosition.left}px`;
            fab.style.top = `${pendingPosition.top}px`;
            pendingPosition = null;
        }

        if (!isDragging) return;
        isDragging = false;
        fab.style.cursor = 'grab';
        fab.classList.remove('st-chatu8-fab-dragging');

        // ✅ 视频模式下：dragEnd 时触发 click 逻辑（因为 pointer-events: none 导致原生 click 不会触发）
        if (isVideoMode() && !hasMoved && !isLongPress) {
            const clientX = e.type === 'touchend' ? (e.changedTouches?.[0]?.clientX ?? startX) : e.clientX;
            const clientY = e.type === 'touchend' ? (e.changedTouches?.[0]?.clientY ?? startY) : e.clientY;
            handleFabClick(clientX, clientY);
        }

        // 通知视频控制器结束拖动（控制器会根据加载状态决定切换到哪个视频）
        const videoController = getGlobalVideoController();
        if (videoController && hasMoved) {
            videoController.onDragEnd();
        }

        if (hasMoved) {
            const settings = extension_settings[extensionName];
            const isMobile = window.innerWidth <= 768;
            if (isMobile) {
                settings.chatu8_fab_position.mobile.top = fab.style.top;
                settings.chatu8_fab_position.mobile.left = fab.style.left;
            } else {
                settings.chatu8_fab_position.desktop.top = fab.style.top;
                settings.chatu8_fab_position.desktop.left = fab.style.left;
            }
            saveSettingsDebounced();
        }

        document.removeEventListener('mousemove', dragMove);
        document.removeEventListener('touchmove', dragMove);
        document.removeEventListener('mouseup', dragEnd);
        document.removeEventListener('touchend', dragEnd);
    };

    /**
     * ✅ 提取的 click 处理逻辑（供传统模式的 click 事件和视频模式的 dragEnd 共用）
     */
    const handleFabClick = (clientX, clientY) => {
        const videoPlayer = getGlobalVideoPlayer();

        // 如果启用了视频模式，检查点击位置是否在不透明区域
        if (videoPlayer) {
            const isHit = videoPlayer.hitTest(clientX, clientY);

            if (!isHit) {
                // 点击在透明区域，不响应
                return;
            }

            // ✅ 检测是否点击头部区域（上方1/3）
            const rect = fab.getBoundingClientRect();
            const relativeY = clientY - rect.top;
            const headHeight = rect.height / 3;

            if (relativeY <= headHeight) {
                // 点击头部区域，播放摸头视频
                if (videoPlayer.playHeadPatVideo) {
                    videoPlayer.playHeadPatVideo();
                    return; // 播放摸头视频，不打开设置面板
                }
            }
        }

        // 展示配置面板
        if (window.showChatuSettingsPanel) {
            window.showChatuSettingsPanel();
        } else {
            showSettingsPanel();
        }
    };

    // ✅ 传统模式：FAB 元素级事件监听（pointer-events 正常）
    fab.addEventListener('mousedown', dragStart);
    fab.addEventListener('touchstart', dragStart, { passive: false });

    fab.addEventListener('click', (e) => {
        // ✅ 优先级控制：只有当 FAB 与 AI 面板重合时才阻止点击
        if (isFabOverlappingDialog()) {
            return;
        }

        // 视频模式下 click 事件由 dragEnd 中手动触发 handleFabClick，此处跳过
        if (isVideoMode()) return;

        // 需同时确保不是拖拽，且不是因为长按触发的点击，才展示配置面板
        if (!hasMoved && !isLongPress) {
            handleFabClick(e.clientX, e.clientY);
        }
    });

    // ✅ 视频模式：document 级事件监听（因为 FAB 设置了 pointer-events: none）
    document.addEventListener('mousedown', (e) => {
        if (!isVideoMode()) return;

        // ✅ 设置面板打开时，面板内的点击不应触发 FAB（防止点击穿透）
        if (isEventFromSettingsPanel(e)) {
            return;
        }

        // ✅ 优先级控制：只有当 FAB 与 AI 面板重合时才阻止交互
        if (isFabOverlappingDialog()) {
            return;
        }

        dragStart(e);
    });
    document.addEventListener('touchstart', (e) => {
        if (!isVideoMode()) return;

        // ✅ 设置面板打开时，面板内的点击不应触发 FAB（防止点击穿透）
        if (isEventFromSettingsPanel(e)) {
            return;
        }

        // ✅ 优先级控制：只有当 FAB 与 AI 面板重合时才阻止交互
        if (isFabOverlappingDialog()) {
            return;
        }

        dragStart(e);
    }, { passive: false });

    // 动态改变鼠标样式（根据是否在不透明区域）- 添加节流优化
    // ✅ 修复：视频模式下监听 document 级 mousemove 来更新 cursor
    let cursorUpdateRafId = null;
    let lastCursorX = 0;
    let lastCursorY = 0;

    document.addEventListener('mousemove', (e) => {
        const videoPlayer = getGlobalVideoPlayer();
        if (isDragging || !videoPlayer || !isVideoMode()) return;

        // ✅ 优先级控制：只有当 FAB 与 AI 面板重合时才不修改 cursor
        if (isFabOverlappingDialog()) {
            // 清除可能残留的 cursor 样式
            if (document.body.style.cursor === 'grab' || document.body.style.cursor === 'grabbing') {
                document.body.style.cursor = '';
            }
            return;
        }

        // 检查是否在 FAB 区域内
        if (!isPointInFabRect(e.clientX, e.clientY)) {
            // 不在 FAB 区域内，不需要处理 cursor
            return;
        }

        // ✅ 优化：记录最新坐标，但只在RAF中处理
        lastCursorX = e.clientX;
        lastCursorY = e.clientY;

        // 使用 RAF 节流，避免频繁更新 cursor
        if (!cursorUpdateRafId) {
            cursorUpdateRafId = requestAnimationFrame(() => {
                // 视频模式下通过修改 body 的 cursor 来显示手型（因为 FAB 本身是 pointer-events: none）
                document.body.style.cursor = videoPlayer.hitTest(lastCursorX, lastCursorY) ? 'grab' : '';
                cursorUpdateRafId = null;
            });
        }
    });

    // ✅ 当鼠标离开 FAB 区域时，恢复 body 的默认 cursor
    document.addEventListener('mousemove', (e) => {
        if (!isVideoMode()) return;
        if (!isPointInFabRect(e.clientX, e.clientY)) {
            if (document.body.style.cursor === 'grab' || document.body.style.cursor === 'grabbing') {
                document.body.style.cursor = '';
            }
        }
    });

    // 传统模式下的 FAB mousemove（非视频模式）
    fab.addEventListener('mousemove', (e) => {
        const videoPlayer = getGlobalVideoPlayer();
        if (isDragging || !videoPlayer || isVideoMode()) return;

        // ✅ 优先级控制：只有当 FAB 与 AI 面板重合时才不修改 cursor
        if (isFabOverlappingDialog()) {
            return;
        }

        lastCursorX = e.clientX;
        lastCursorY = e.clientY;

        if (!cursorUpdateRafId) {
            cursorUpdateRafId = requestAnimationFrame(() => {
                fab.style.cursor = videoPlayer.hitTest(lastCursorX, lastCursorY) ? 'grab' : 'default';
                cursorUpdateRafId = null;
            });
        }
    });

    applyFabSettings();

    // ✅ 初始化时检查：如果用户上次保存的位置导致 FAB 中心已落在屏幕外，重置回屏幕中心
    // 延迟执行确保 applyFabSettings 应用的 vh/vw/px 已经布局完成
    setTimeout(() => {
        ensureFabCenterInViewport();
    }, 50);

    // 添加防抖的 resize 处理
    let resizeTimeout = null;
    let lastIsMobile = window.innerWidth <= 768;

    window.addEventListener('resize', () => {
        if (String(extension_settings[extensionName].enable_chatu8_fab) === 'true') {
            const rect = fab.getBoundingClientRect();
            const screenWidth = window.innerWidth;
            const screenHeight = window.innerHeight;
            const currentIsMobile = screenWidth <= 768;

            let newLeft = rect.left;
            let newTop = rect.top;

            // ✅ 修改：允许 FAB 部分超出屏幕，只保留最小可见区域
            const minVisibleSize = 20;
            const maxLeft = screenWidth - minVisibleSize;
            const maxTop = screenHeight - minVisibleSize;
            const minLeft = -(rect.width - minVisibleSize);
            const minTop = -(rect.height - minVisibleSize);

            if (newLeft > maxLeft) newLeft = maxLeft;
            if (newTop > maxTop) newTop = maxTop;
            if (newLeft < minLeft) newLeft = minLeft;
            if (newTop < minTop) newTop = minTop;

            fab.style.left = `${newLeft}px`;
            fab.style.top = `${newTop}px`;

            // 检测设备类型切换（桌面端 ↔ 移动端）
            if (currentIsMobile !== lastIsMobile) {
                lastIsMobile = currentIsMobile;

                // 防抖：延迟更新设置面板和应用设置
                clearTimeout(resizeTimeout);
                resizeTimeout = setTimeout(() => {
                    // 重新应用设置（会根据新的设备类型加载对应的尺寸和位置）
                    applyFabSettings();

                    // 如果设置面板打开，更新滑块显示的值
                    const settingsPanel = document.getElementById('st-chatu8-settings-panel');
                    if (settingsPanel && settingsPanel.classList.contains('active')) {
                        const settings = extension_settings[extensionName];
                        if (typeof settings.chatu8_fab_size === 'object') {
                            const newSize = currentIsMobile
                                ? (settings.chatu8_fab_size.mobile ?? 40)
                                : (settings.chatu8_fab_size.desktop ?? 50);

                            const sizeSlider = document.getElementById('chatu8_fab_size');
                            const sizeInput = document.getElementById('chatu8_fab_size_value');
                            if (sizeSlider) sizeSlider.value = newSize;
                            if (sizeInput) sizeInput.value = newSize;

                            // ✅ 修复：同步更新视频播放器尺寸
                            const videoPlayer = getGlobalVideoPlayer();
                            if (videoPlayer) {
                                videoPlayer.updateSize(newSize);
                            }
                        }
                    }
                }, 300); // 300ms 防抖
            }
        }
    });

    // 导出清理函数（如果需要）
    window.cleanupFabVideo = () => {
        const videoController = getGlobalVideoController();
        const videoPlayer = getGlobalVideoPlayer();

        if (videoController) {
            videoController.cleanup();
        }
        if (videoPlayer) {
            videoPlayer.destroy();
        }
    };
}

/**
 * 启动悬浮球加载动画
 */
export function startFabLoading() {
    const fab = document.getElementById('st-chatu8-fab');
    if (!fab) return;

    // ✅ 设置加载状态标记
    fab.dataset.isLoading = 'true';

    const videoPlayer = getGlobalVideoPlayer();

    // ✅ 检查是否正在播放说话视频（TTS 播放中）
    if (videoPlayer) {
        const state = videoPlayer.getState();
        if (state && state.isPlayingTalk) {
            // 正在播放 TTS，不切换到思考视频，保持说话视频
            return;
        }
    }

    // 如果启用了视频模式，播放思考视频
    if (videoPlayer && videoPlayer.playThinkingVideo) {
        videoPlayer.playThinkingVideo();
    } else {
        // 传统模式：添加转圈动画类
        fab.classList.add('st-chatu8-fab-loading');
    }
}

/**
 * 停止悬浮球加载动画
 */
export function stopFabLoading() {
    const fab = document.getElementById('st-chatu8-fab');
    if (!fab) return;

    // ✅ 清除加载状态标记
    fab.dataset.isLoading = 'false';

    const videoPlayer = getGlobalVideoPlayer();

    // ✅ 检查是否正在播放说话视频（TTS 播放中）
    if (videoPlayer) {
        const state = videoPlayer.getState();
        if (state && state.isPlayingTalk) {
            // 正在播放 TTS，不切换视频，保持说话视频
            return;
        }
    }

    // 如果启用了视频模式，停止思考视频
    if (videoPlayer && videoPlayer.stopThinkingVideo) {
        videoPlayer.stopThinkingVideo();
    } else {
        // 传统模式：移除转圈动画类
        fab.classList.remove('st-chatu8-fab-loading');
    }
}
