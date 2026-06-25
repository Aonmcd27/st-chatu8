// @ts-nocheck
import { extension_settings } from "../../../../extensions.js";
import { saveSettingsDebounced } from "../../../../../script.js";
import { extensionName, defaultSettings } from './config.js';
import { getConfigImage } from './configDatabase.js';
import { createVideoPlayer, checkWebGLSupport } from './settings/fabVideoPlayerWebGL.js';
import { initVideoController } from './settings/fabVideoController.js';

// 全局变量存储视频播放器和控制器
let globalVideoPlayer = null;
let globalVideoController = null;
let fabIconLoadToken = 0;

function getFabCustomIconElement(fabElement) {
    let img = fabElement.querySelector('.st-chatu8-fab-custom-icon');
    if (!img) {
        img = document.createElement('img');
        img.className = 'st-chatu8-fab-custom-icon';
        img.alt = '悬浮球图标';
        fabElement.appendChild(img);
    }
    return img;
}

function clearFabCustomIcon(fab, size) {
    fabIconLoadToken++;
    const icon = fab.find('i');
    const img = fab[0]?.querySelector('.st-chatu8-fab-custom-icon');
    if (img) {
        img.removeAttribute('src');
        img.style.display = 'none';
    }
    icon.css('font-size', `${Math.round(size * 0.48)}px`);
    icon.show();
}

function showFabCustomIcon(fab, src, onError) {
    const img = getFabCustomIconElement(fab[0]);
    img.onerror = onError || null;
    img.src = src;
    img.style.display = 'block';
    fab.find('i').hide();
}

function fallbackLoadFabIcon(fab, settings, size, imageId, token) {
    getConfigImage(imageId)
        .then((src) => {
            if (token !== fabIconLoadToken) return;
            if (src) {
                showFabCustomIcon(fab, src);
                return;
            }

            settings.chatu8_fab_icon_image_id = '';
            saveSettingsDebounced();
            clearFabCustomIcon(fab, size);
        })
        .catch((error) => {
            if (token !== fabIconLoadToken) return;
            console.error('[st-chatu8] 加载悬浮球自定义图标失败:', error);
            clearFabCustomIcon(fab, size);
        });
}

function applyFabIconImage(fab, settings, size) {
    const imageId = settings.chatu8_fab_icon_image_id;
    if (!imageId) {
        clearFabCustomIcon(fab, size);
        return;
    }

    const serverPath = settings.configImageStorage?.[imageId]?.path;
    if (serverPath) {
        const token = ++fabIconLoadToken;
        showFabCustomIcon(fab, serverPath, () => fallbackLoadFabIcon(fab, settings, size, imageId, token));
        return;
    }

    const token = ++fabIconLoadToken;
    fallbackLoadFabIcon(fab, settings, size, imageId, token);
}

// 导出 getter 函数供其他模块使用
export function getGlobalVideoPlayer() {
    return globalVideoPlayer;
}

export function getGlobalVideoController() {
    return globalVideoController;
}

export function getSuffix(mode) {
    if (mode === 'sd') return '';
    return `_${mode}`;
}

export function isValidUrl(string) {
    if (!string || string.trim() === '') return true;
    const urlRegex = /^(https?:\/\/)?(localhost|([a-zA-Z0-9-]+\.)+[a-zA-Z]{2,}|(\d{1,3}\.){3}\d{1,3})(:\d+)?(\/.*)*$/;
    return urlRegex.test(string);
}

export function validateUrlInput(inputElement) {
    if (!inputElement) return;
    const parentGroup = inputElement.closest('.st-chatu8-input-group');
    if (!parentGroup) return;

    const isValid = isValidUrl(inputElement.value);
    parentGroup.classList.toggle('invalid', !isValid);
}



export function size_change(prefix) {
    if (prefix == "sd") {
        prefix = "sd_c"
    } else {
        prefix = prefix + "_"
    }

    const width = document.getElementById(`${prefix}width`);
    const height = document.getElementById(`${prefix}height`);
    const selectElement = document.getElementById(`${prefix}size`);
    if (width && height && selectElement) {
        const [selectElementwidth, selectElementheight] = selectElement.value.split("x");
        width.value = selectElementwidth;
        height.value = selectElementheight;
        $(width).trigger('input');
        $(height).trigger('input');
    }
}

export function stylInput(message, defaultValue = '') {
    return new Promise((resolve) => {
        const parent = document.getElementById('st-chatu8-settings') || document.body;

        const backdrop = document.createElement('div');
        backdrop.className = 'st-chatu8-confirm-backdrop';

        const confirmBox = document.createElement('div');
        confirmBox.className = 'st-chatu8-confirm-box';

        const messageText = document.createElement('p');
        messageText.textContent = message;
        messageText.className = 'st-chatu8-confirm-message';
        confirmBox.appendChild(messageText);

        const messageinput = document.createElement('input');
        messageinput.className = 'st-chatu8-text-input';
        messageinput.value = defaultValue;
        confirmBox.appendChild(messageinput);

        const buttonContainer = document.createElement('div');
        buttonContainer.className = 'st-chatu8-confirm-buttons';
        confirmBox.appendChild(buttonContainer);

        const cancelButton = document.createElement('button');
        cancelButton.textContent = '取消';
        cancelButton.className = 'st-chatu8-btn';
        buttonContainer.appendChild(cancelButton);

        const confirmButton = document.createElement('button');
        confirmButton.textContent = '确定';
        confirmButton.className = 'st-chatu8-btn';
        buttonContainer.appendChild(confirmButton);

        backdrop.appendChild(confirmBox);
        parent.appendChild(backdrop);

        const close = (value) => {
            parent.removeChild(backdrop);
            resolve(value);
        };

        cancelButton.addEventListener('click', () => close(false));
        confirmButton.addEventListener('click', () => close(messageinput.value));
        messageinput.focus();
    });
}

export function stylishConfirm(message) {
    return new Promise((resolve) => {
        const parent = document.getElementById('st-chatu8-settings') || document.body;

        const backdrop = document.createElement('div');
        backdrop.className = 'st-chatu8-confirm-backdrop';
        backdrop.style.zIndex = '99999';

        const confirmBox = document.createElement('div');
        confirmBox.className = 'st-chatu8-confirm-box';

        const messageText = document.createElement('p');
        messageText.textContent = message;
        messageText.className = 'st-chatu8-confirm-message';
        confirmBox.appendChild(messageText);

        const buttonContainer = document.createElement('div');
        buttonContainer.className = 'st-chatu8-confirm-buttons';
        confirmBox.appendChild(buttonContainer);

        const cancelButton = document.createElement('button');
        cancelButton.textContent = '取消';
        cancelButton.className = 'st-chatu8-btn';
        buttonContainer.appendChild(cancelButton);

        const confirmButton = document.createElement('button');
        confirmButton.textContent = '确定';
        confirmButton.className = 'st-chatu8-btn';
        buttonContainer.appendChild(confirmButton);

        backdrop.appendChild(confirmBox);
        parent.appendChild(backdrop);

        const close = (value) => {
            parent.removeChild(backdrop);
            resolve(value);
        };

        cancelButton.addEventListener('click', () => close(false));
        confirmButton.addEventListener('click', () => close(true));
        confirmButton.focus();
    });
}

function logJSZipStatus() {
    const jszipScripts = Array.from(document.querySelectorAll('script[src]'))
        .map(script => script.getAttribute('src'))
        .filter(src => typeof src === 'string' && src.toLowerCase().includes('jszip'));

    const pluginScopedJSZip = window.stChatu8JSZip;
    const globalJSZip = window.JSZip;
    const jszipConstructor = pluginScopedJSZip || globalJSZip;
    const canInstantiate = typeof jszipConstructor === 'function';
    console.log('[st-chatu8] JSZip panel check', {
        hasDefine: typeof globalThis.define === 'function',
        hasDefineAmd: Boolean(globalThis.define?.amd),
        defineType: typeof globalThis.define,
        hasRequire: typeof globalThis.require === 'function',
        requireType: typeof globalThis.require,
        hasModule: typeof globalThis.module !== 'undefined',
        moduleType: typeof globalThis.module,
        hasExports: typeof globalThis.exports !== 'undefined',
        exportsType: typeof globalThis.exports,
        hasPluginScopedJSZip: typeof pluginScopedJSZip === 'function',
        pluginScopedJszipType: typeof pluginScopedJSZip,
        pluginScopedJszipName: pluginScopedJSZip?.name,
        hasWindowJSZip: typeof globalJSZip !== 'undefined',
        jszipType: typeof globalJSZip,
        jszipName: globalJSZip?.name,
        canInstantiate,
        hasFileMethod: typeof jszipConstructor?.prototype?.file === 'function',
        hasGenerateAsyncMethod: typeof jszipConstructor?.prototype?.generateAsync === 'function',
        jszipScriptsCount: jszipScripts.length,
        jszipScripts,
    });

    if (!canInstantiate) {
        return;
    }

    try {
        const zip = new jszipConstructor();
        zip.file('st-chatu8-jszip-test.txt', `panel-check-${Date.now()}`);
        zip.generateAsync({ type: 'blob' })
            .then(blob => {
                console.log('[st-chatu8] JSZip compression test passed', {
                    constructorSource: pluginScopedJSZip ? 'plugin-scoped' : 'window',
                    resultType: Object.prototype.toString.call(blob),
                    resultSize: blob?.size,
                });
            })
            .catch(error => {
                console.error('[st-chatu8] JSZip compression test failed', error);
            });
    } catch (error) {
        console.error('[st-chatu8] JSZip instantiation test failed', error);
    }
}

export function showSettingsPanel() {
    const settings = extension_settings[extensionName];
    const panel = $('#ch-settings-modal');
    if (!panel.length) {
        console.error("Settings panel not found!");
        return;
    }

    logJSZipStatus();

    const lastTab = settings.lastTab || 'main';
    const lastTabLink = panel.find(`.st-chatu8-nav-link[data-tab="${lastTab}"]`);

    if (lastTabLink.length) {
        lastTabLink.click();
    } else {
        panel.find('.st-chatu8-nav-link[data-tab="main"]').click();
    }

    const content = panel.find('.st-chatu8-modal-content');
    if (window.innerWidth <= 768) {
        const buttonHeight = $('#ai-config-button').outerHeight(true) || 0;
        panel.css({ 'align-items': 'start' });

        const sendForm = document.getElementById('leftSendForm');
        const sendFormTop = sendForm ? sendForm.getBoundingClientRect().top : window.innerHeight;
        const newHeight = sendFormTop - buttonHeight - 15; // 15px for padding

        content.css({
            'margin-top': `${buttonHeight}px`,
            'height': `${newHeight}px`
        });
    } else {
        panel.css({ 'align-items': '' });
        content.css({
            'margin-top': '',
            'height': ''
        });
    }
    panel.css('display', 'grid');
    panel.find('.st-chatu8-modal-content').focus();
}

export function hideSettingsPanel() {
    const panel = $('#ch-settings-modal');
    panel.hide();
    panel.css({ 'align-items': '', 'padding-top': '' });
    panel.find('.st-chatu8-modal-content').css({
        'margin-top': '',
        'height': ''
    });
}

export function showToast(message, type = 'info', duration = 3000) {
    if (typeof toastr === 'undefined') {
        console.warn('toastr is not defined, fallback to console.log');
        console.log(`[${type}] ${message}`);
        return;
    }

    toastr.options = {
        ...toastr.options,
        "timeOut": duration,
        "progressBar": true,
        "preventDuplicates": true,
        "newestOnTop": true
    };

    if (toastr[type]) {
        toastr[type](message);
    } else {
        toastr.info(message);
    }
}

export function applyFabSettings() {
    const settings = extension_settings[extensionName];
    const fab = $('#st-chatu8-fab');
    if (!fab.length) {
        console.error('FAB element not found in DOM');
        return;
    }

    console.log('=== applyFabSettings called ===');
    console.log('enable_chatu8_fab:', settings.enable_chatu8_fab, 'Type:', typeof settings.enable_chatu8_fab);
    console.log('enable_chatu8_fab_video:', settings.enable_chatu8_fab_video, 'Type:', typeof settings.enable_chatu8_fab_video);
    console.log('chatu8_fab_video_paths:', settings.chatu8_fab_video_paths);

    if (String(settings.enable_chatu8_fab) === 'true') {
        fab.show();

        // 检查是否启用视频模式（兼容布尔值和字符串）
        const videoModeEnabled = settings.enable_chatu8_fab_video === true || settings.enable_chatu8_fab_video === 'true';

        if (videoModeEnabled) {
            // 视频模式：添加视频模式类，移除传统样式
            fab.addClass('st-chatu8-fab-video-mode');
            fab.css('background-color', 'transparent');
            fab.css('opacity', 1); // 确保完全不透明
            fab.find('i').css('display', 'none');

            // ✅ 简化逻辑：只检查播放器是否存在
            if (!globalVideoPlayer) {
                console.log('Creating video player...');
                console.log('WebGL support:', checkWebGLSupport());

                // ✅ 清理可能残留的旧 canvas 元素（插件重装场景）
                const staleCanvas = fab[0].querySelector('#st-chatu8-fab-video-canvas');
                if (staleCanvas) {
                    staleCanvas.parentNode.removeChild(staleCanvas);
                    console.log('[st-chatu8] Cleaned up stale canvas element');
                }

                // ✅ 自动迁移：视频路径配置迁移
                if (settings.chatu8_fab_video_paths) {
                    let needsSave = false;

                    // 迁移 1: .webm → .mp4
                    if (settings.chatu8_fab_video_paths.idle && settings.chatu8_fab_video_paths.idle.endsWith('.webm')) {
                        settings.chatu8_fab_video_paths.idle = settings.chatu8_fab_video_paths.idle.replace('.webm', '.mp4');
                        needsSave = true;
                        console.log('Migrated idle video path to .mp4');
                    }
                    if (settings.chatu8_fab_video_paths.dragging && settings.chatu8_fab_video_paths.dragging.endsWith('.webm')) {
                        settings.chatu8_fab_video_paths.dragging = settings.chatu8_fab_video_paths.dragging.replace('.webm', '.mp4');
                        needsSave = true;
                        console.log('Migrated dragging video path to .mp4');
                    }

                    // 迁移 2: 验证路径是否有效，无效则使用默认值
                    const defaultPaths = defaultSettings.chatu8_fab_video_paths;
                    if (!settings.chatu8_fab_video_paths.idle || settings.chatu8_fab_video_paths.idle.trim() === '') {
                        settings.chatu8_fab_video_paths.idle = defaultPaths.idle;
                        needsSave = true;
                        console.log('Reset idle video path to default');
                    }
                    if (!settings.chatu8_fab_video_paths.dragging || settings.chatu8_fab_video_paths.dragging.trim() === '') {
                        settings.chatu8_fab_video_paths.dragging = defaultPaths.dragging;
                        needsSave = true;
                        console.log('Reset dragging video path to default');
                    }

                    if (needsSave) {
                        saveSettingsDebounced();
                        console.log('Settings saved after migration');
                    }
                } else {
                    // 如果完全没有配置，使用默认值
                    settings.chatu8_fab_video_paths = JSON.parse(JSON.stringify(defaultSettings.chatu8_fab_video_paths));
                    saveSettingsDebounced();
                    console.log('Initialized video paths with default values');
                }

                console.log('Video paths:', settings.chatu8_fab_video_paths);

                if (!checkWebGLSupport()) {
                    console.error('WebGL not supported by browser');
                    showToast('浏览器不支持 WebGL', 'error');
                    return;
                }

                if (!settings.chatu8_fab_video_paths || !settings.chatu8_fab_video_paths.idle || !settings.chatu8_fab_video_paths.dragging) {
                    console.error('Video paths not configured');
                    showToast('视频路径未配置', 'error');
                    return;
                }

                // 创建新的视频播放器（带错误恢复机制）
                try {
                    globalVideoPlayer = createVideoPlayer(fab[0], {
                        idleVideoSrc: settings.chatu8_fab_video_paths.idle,
                        draggingVideoSrc: settings.chatu8_fab_video_paths.dragging,
                        onError: (errorType, videoSrc) => {
                            console.error(`Video load error (${errorType}):`, videoSrc);

                            // 如果视频加载失败，尝试使用默认路径
                            const defaultPaths = defaultSettings.chatu8_fab_video_paths;
                            let needsRetry = false;

                            if (errorType === 'idle' && settings.chatu8_fab_video_paths.idle !== defaultPaths.idle) {
                                console.log('Attempting to use default idle video path');
                                settings.chatu8_fab_video_paths.idle = defaultPaths.idle;
                                needsRetry = true;
                            }

                            if (errorType === 'dragging' && settings.chatu8_fab_video_paths.dragging !== defaultPaths.dragging) {
                                console.log('Attempting to use default dragging video path');
                                settings.chatu8_fab_video_paths.dragging = defaultPaths.dragging;
                                needsRetry = true;
                            }

                            if (needsRetry) {
                                saveSettingsDebounced();
                                showToast('视频路径已重置为默认值，请刷新页面', 'warning');
                            }
                        }
                    });

                    globalVideoController = initVideoController(globalVideoPlayer, {
                        isLoadingFn: () => {
                            const fabEl = document.getElementById('st-chatu8-fab');
                            return fabEl && fabEl.dataset.isLoading === 'true';
                        }
                    });
                    console.log('Video player created successfully');

                    // ✅ 修复：视频播放器创建后，立即应用尺寸设置
                    // 延迟一小段时间确保 DOM 已更新
                    setTimeout(() => {
                        const isMobile = window.innerWidth <= 768;
                        const size = isMobile
                            ? (settings.chatu8_fab_size?.mobile ?? settings.chatu8_fab_size ?? 40)
                            : (settings.chatu8_fab_size?.desktop ?? settings.chatu8_fab_size ?? 50);

                        console.log('[st-chatu8] Applying initial size to video player:', size);
                        if (globalVideoPlayer) {
                            globalVideoPlayer.updateSize(size);
                        }
                    }, 100);
                } catch (error) {
                    console.error('Failed to create video player:', error);
                    showToast('视频播放器创建失败: ' + error.message, 'error');
                }
            } else {
                console.log('Video player already exists, skipping creation');
            }
        } else {
            // 传统模式：移除视频模式类，应用传统样式
            fab.removeClass('st-chatu8-fab-video-mode');
            fab.css('background-color', settings.chatu8_fab_bg_color || '#ADD8E6');
            fab.find('i').css('color', settings.chatu8_fab_icon_color || '#FFFFFF');
            fab.css('opacity', settings.chatu8_fab_opacity ?? 1);

            // 清理视频播放器
            if (globalVideoPlayer) {
                globalVideoPlayer.destroy();
                globalVideoPlayer = null;
            }
            if (globalVideoController) {
                globalVideoController.cleanup();
                globalVideoController = null;
            }
        }

        // 应用尺寸设置（两种模式都需要）
        const isMobile = window.innerWidth <= 768;
        const size = isMobile
            ? (settings.chatu8_fab_size?.mobile ?? settings.chatu8_fab_size ?? 40)
            : (settings.chatu8_fab_size?.desktop ?? settings.chatu8_fab_size ?? 50);

        fab.css('width', `${size}px`);
        fab.css('height', `${size}px`);

        // 根据模式设置图标
        if (videoModeEnabled) {
            // 视频模式：更新视频尺寸并确保图标隐藏
            if (globalVideoPlayer) {
                globalVideoPlayer.updateSize(size);
            }
            // 强制隐藏图标（放在最后确保不被覆盖）
            fab.find('i').hide();
        } else {
            // 传统模式：设置默认图标或自定义图片
            applyFabIconImage(fab, settings, size);
        }

        // 应用位置设置
        const position = isMobile
            ? (settings.chatu8_fab_position.mobile || defaultSettings.chatu8_fab_position.mobile)
            : (settings.chatu8_fab_position.desktop || defaultSettings.chatu8_fab_position.desktop);

        fab.css('top', position.top);
        fab.css('left', position.left);
    } else {
        fab.hide();

        // 暂停视频播放（如果有）
        if (globalVideoPlayer) {
            globalVideoPlayer.pause();
        }
    }
}

// 专门用于更新FAB尺寸的函数（不重新创建视频播放器）
// 注意：此函数只负责更新视觉效果，不负责保存设置
export function updateFabSize(size) {
    console.log('[updateFabSize] Called with size:', size);

    const settings = extension_settings[extensionName];
    const fab = $('#st-chatu8-fab');
    if (!fab.length) {
        console.error('[updateFabSize] FAB element not found!');
        return;
    }

    const videoModeEnabled = settings.enable_chatu8_fab_video === true || settings.enable_chatu8_fab_video === 'true';
    console.log('[updateFabSize] Video mode enabled:', videoModeEnabled);
    console.log('[updateFabSize] Global video player exists:', !!globalVideoPlayer);

    // 临时禁用 transition，确保尺寸立即生效
    const originalTransition = fab[0].style.transition;
    fab[0].style.transition = 'none';

    // 设置容器尺寸
    fab.css('width', `${size}px`);
    fab.css('height', `${size}px`);

    // 强制回流
    void fab[0].offsetWidth;
    console.log('[updateFabSize] FAB container size set to:', fab[0].offsetWidth, 'x', fab[0].offsetHeight);

    if (videoModeEnabled) {
        // 视频模式：更新视频播放器尺寸
        if (globalVideoPlayer) {
            console.log('[updateFabSize] Calling videoPlayer.updateSize...');
            globalVideoPlayer.updateSize(size);
        } else {
            console.warn('[updateFabSize] Video player not initialized!');
        }
        fab.find('i').hide();
    } else {
        // 图标模式：更新默认图标或自定义图片
        console.log('[updateFabSize] Icon mode, updating icon display');
        fab.find('i').css('color', settings.chatu8_fab_icon_color || '#FFFFFF');
        applyFabIconImage(fab, settings, size);
    }

    // 恢复 transition
    requestAnimationFrame(() => {
        fab[0].style.transition = originalTransition;
    });

    console.log('[updateFabSize] Completed');
}
