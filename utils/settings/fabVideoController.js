// @ts-nocheck

/**
 * 视频状态控制器
 * 根据拖动状态控制视频切换
 */

export function initVideoController(videoPlayer, options = {}) {
    let isDragging = false;
    let switchTimeout = null;
    let wasThinking = false; // ✅ 记录拖动前是否在思考状态
    const { isLoadingFn } = options; // ✅ 通过回调获取加载状态，解耦 DOM 依赖

    const controller = {
        onDragStart: () => {
            // 清除可能存在的延迟切换
            if (switchTimeout) {
                clearTimeout(switchTimeout);
                switchTimeout = null;
            }

            // ✅ 记录拖动前的状态
            const state = videoPlayer.getState();
            wasThinking = state.isPlayingThinking;

            // 防抖：延迟50ms切换，避免误触
            switchTimeout = setTimeout(() => {
                if (!isDragging) {
                    isDragging = true;
                    videoPlayer.switchToDraggingVideo();
                }
            }, 50);
        },

        onDragEnd: () => {
            // 清除可能存在的延迟切换
            if (switchTimeout) {
                clearTimeout(switchTimeout);
                switchTimeout = null;
            }

            // 立即切换回静息视频或思考视频
            if (isDragging) {
                isDragging = false;

                // ✅ 检查是否正在播放说话视频（TTS 播放中）
                const state = videoPlayer.getState();
                if (state && state.isPlayingTalk) {
                    // 正在播放 TTS，切换回说话视频
                    videoPlayer.playTalkVideo();
                    wasThinking = false;
                    return;
                }

                // ✅ 优化：优先使用记录的状态，其次通过回调检查当前加载状态
                const isLoading = isLoadingFn ? isLoadingFn() : false;

                if ((wasThinking || isLoading) && videoPlayer.playThinkingVideo) {
                    // 拖动前在思考或当前正在加载，切换到思考视频
                    videoPlayer.playThinkingVideo();
                } else {
                    // 不在加载，切换到静息视频
                    videoPlayer.switchToIdleVideo();
                }

                // 重置状态
                wasThinking = false;
            }
        },

        cleanup: () => {
            if (switchTimeout) {
                clearTimeout(switchTimeout);
                switchTimeout = null;
            }
            isDragging = false;
            wasThinking = false;
        }
    };

    return controller;
}
