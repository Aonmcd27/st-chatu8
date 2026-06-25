// @ts-nocheck
/**
 * 设置面板开场视频播放模块
 * 在用户打开设置面板时全屏播放登场视频，然后生成智绘姬专属编号
 */

import { extensionFolderPath } from '../config.js';
import { addLog } from '../utils.js';
import { extension_settings } from "../../../../../extensions.js";
import { saveSettingsDebounced } from "../../../../../../script.js";
import { extensionName } from '../config.js';

let hasPlayedOnce = false; // 标记是否已播放过（每次刷新页面只播放一次）
let videoContainer = null;

/**
 * 生成4位随机编号（字母+数字）
 */
function generateRandomCode() {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let code = '';
    for (let i = 0; i < 4; i++) {
        code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return code;
}

/**
 * 显示智绘姬编号生成动画
 */
function showCodeGenerationAnimation() {
    const container = videoContainer;
    if (!container) return;

    // 移动端检测
    const isMobile = window.innerWidth <= 768;

    // 创建动画容器（半透明背景，显示视频最后一帧）
    const animationContainer = document.createElement('div');
    animationContainer.style.cssText = `
        position: absolute;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        display: flex;
        flex-direction: column;
        justify-content: center;
        align-items: center;
        background: linear-gradient(135deg, rgba(135, 206, 235, 0.85) 0%, rgba(176, 224, 230, 0.85) 50%, rgba(224, 246, 255, 0.85) 100%);
        z-index: 100002;
        animation: fadeIn 0.5s ease-in;
        padding: 20px;
        box-sizing: border-box;
    `;

    // 标题
    const title = document.createElement('div');
    title.textContent = '🎨 初次见面，让我们建立连接吧 ✨';
    title.style.cssText = `
        font-size: ${isMobile ? '18px' : '24px'};
        font-weight: bold;
        color: #2C5F8D;
        margin-bottom: ${isMobile ? '10px' : '15px'};
        text-shadow: 0 2px 8px rgba(255, 255, 255, 0.8);
        font-family: "Microsoft YaHei", "PingFang SC", sans-serif;
        animation: pulse 1.5s ease-in-out infinite;
        text-align: center;
    `;

    // 副标题
    const subtitle = document.createElement('div');
    subtitle.textContent = '每个构筑师都有专属的智绘姬编号哦~';
    subtitle.style.cssText = `
        font-size: ${isMobile ? '14px' : '16px'};
        color: #4A90C8;
        margin-bottom: ${isMobile ? '20px' : '30px'};
        font-family: "Microsoft YaHei", "PingFang SC", sans-serif;
        text-align: center;
    `;

    // 编号显示区域
    const codeDisplay = document.createElement('div');
    codeDisplay.style.cssText = `
        font-size: ${isMobile ? '48px' : '72px'};
        font-weight: bold;
        color: #4A90E2;
        letter-spacing: ${isMobile ? '10px' : '15px'};
        text-shadow: 0 0 20px rgba(74, 144, 226, 0.6),
                     0 0 40px rgba(74, 144, 226, 0.3),
                     0 4px 8px rgba(255, 255, 255, 0.8);
        font-family: "Courier New", monospace;
        margin-bottom: ${isMobile ? '30px' : '40px'};
        min-width: ${isMobile ? '200px' : '300px'};
        text-align: center;
        animation: glow 1s ease-in-out infinite alternate;
    `;
    codeDisplay.textContent = '????';

    // 点击按钮
    const clickButton = document.createElement('button');
    clickButton.innerHTML = '<i class="fa-solid fa-wand-magic-sparkles"></i> 生成专属智绘姬编号';
    clickButton.style.cssText = `
        padding: ${isMobile ? '12px 30px' : '15px 40px'};
        font-size: ${isMobile ? '16px' : '20px'};
        font-weight: bold;
        color: white;
        background: linear-gradient(45deg, #5DADE2, #3498DB);
        border: none;
        border-radius: 50px;
        cursor: pointer;
        box-shadow: 0 8px 20px rgba(52, 152, 219, 0.4);
        transition: all 0.3s ease;
        font-family: "Microsoft YaHei", "PingFang SC", sans-serif;
        animation: bounce 2s ease-in-out infinite;
        text-align: center;
    `;

    clickButton.onmouseover = () => {
        clickButton.style.transform = 'scale(1.1)';
        clickButton.style.boxShadow = '0 12px 30px rgba(52, 152, 219, 0.6)';
    };
    clickButton.onmouseout = () => {
        clickButton.style.transform = 'scale(1)';
        clickButton.style.boxShadow = '0 8px 20px rgba(52, 152, 219, 0.4)';
    };

    // 点击事件：生成编号动画
    clickButton.onclick = () => {
        clickButton.disabled = true;
        clickButton.style.opacity = '0.5';
        clickButton.style.cursor = 'not-allowed';

        // 随机滚动动画
        let rollCount = 0;
        const maxRolls = 20;
        const rollInterval = setInterval(() => {
            codeDisplay.textContent = generateRandomCode();
            rollCount++;

            if (rollCount >= maxRolls) {
                clearInterval(rollInterval);

                // ✅ 最终编号从已保存的设置中读取（进入流程时就已生成），避免中途出错导致每次重走
                const settings = extension_settings[extensionName];
                const finalCode = (settings && settings.chatu8_code) || generateRandomCode();

                // 若此前未成功保存（极端情况），此处兜底保存一次
                if (settings && !settings.chatu8_code) {
                    settings.chatu8_code = finalCode;
                    saveSettingsDebounced();
                    addLog(`[OpeningVideo] 智绘姬编号兜底保存: ${finalCode}`);
                }

                codeDisplay.textContent = finalCode;

                // 添加闪光效果
                codeDisplay.style.animation = 'flash 0.5s ease-in-out 3';

                addLog(`[OpeningVideo] 揭晓智绘姬编号: ${finalCode}`);

                // 显示确认信息
                setTimeout(() => {
                    const confirmText = document.createElement('div');
                    confirmText.innerHTML = `
                        <div style="font-size: ${isMobile ? '18px' : '24px'}; color: #2C5F8D; margin-top: 20px; animation: fadeIn 0.5s ease-in; text-align: center; font-weight: bold;">
                            ✨ 你的专属智绘姬编号是：<span style="color: #4A90E2; font-weight: bold; text-shadow: 0 2px 8px rgba(74, 144, 226, 0.4);">${finalCode}</span>
                        </div>
                        <div style="font-size: ${isMobile ? '14px' : '16px'}; color: #5DADE2; margin-top: 15px; text-align: center; line-height: 1.6;">
                            从现在开始，我会陪伴你使用这个插件！<br>
                            有任何疑问都可以问我哦~ 💖
                        </div>
                    `;
                    animationContainer.appendChild(confirmText);

                    // 创建确认按钮（仪式感满满）
                    setTimeout(() => {
                        const confirmButton = document.createElement('button');
                        confirmButton.innerHTML = '<i class="fa-solid fa-comments"></i> 开始与智绘姬对话';
                        confirmButton.style.cssText = `
                            margin-top: 30px;
                            padding: ${isMobile ? '12px 35px' : '15px 45px'};
                            font-size: ${isMobile ? '16px' : '20px'};
                            font-weight: bold;
                            color: white;
                            background: linear-gradient(45deg, #5DADE2, #3498DB);
                            border: 2px solid rgba(255, 255, 255, 0.5);
                            border-radius: 50px;
                            cursor: pointer;
                            box-shadow: 0 8px 25px rgba(52, 152, 219, 0.5);
                            transition: all 0.3s ease;
                            font-family: "Microsoft YaHei", "PingFang SC", sans-serif;
                            animation: fadeIn 0.5s ease-in, glow 2s ease-in-out infinite alternate;
                        `;

                        confirmButton.onmouseover = () => {
                            confirmButton.style.transform = 'scale(1.05) translateY(-2px)';
                            confirmButton.style.boxShadow = '0 12px 35px rgba(52, 152, 219, 0.7)';
                        };
                        confirmButton.onmouseout = () => {
                            confirmButton.style.transform = 'scale(1) translateY(0)';
                            confirmButton.style.boxShadow = '0 8px 25px rgba(52, 152, 219, 0.5)';
                        };

                        confirmButton.onclick = () => {
                            // 添加点击特效
                            confirmButton.style.transform = 'scale(0.95)';
                            confirmButton.disabled = true;
                            confirmButton.style.opacity = '0.5';

                            // 淡出当前内容
                            confirmText.style.animation = 'fadeOut 0.5s ease-out';
                            confirmButton.style.animation = 'fadeOut 0.5s ease-out';

                            setTimeout(() => {
                                confirmText.remove();
                                confirmButton.remove();

                                // 显示智绘姬的自我介绍
                                const greetingText = document.createElement('div');
                                greetingText.innerHTML = `
                                    <div style="font-size: ${isMobile ? '20px' : '28px'}; color: #2C5F8D; margin-bottom: 20px; animation: fadeIn 0.8s ease-in; text-align: center; font-weight: bold;">
                                        你好，构筑师！👋
                                    </div>
                                    <div style="font-size: ${isMobile ? '16px' : '20px'}; color: #4A90E2; margin-bottom: 15px; animation: fadeIn 1s ease-in; text-align: center; line-height: 1.8;">
                                        我是编号 <span style="color: #3498DB; font-weight: bold; letter-spacing: 2px;">${finalCode}</span> 的智绘姬<br>
                                        很高兴认识你！✨
                                    </div>
                                    <div style="font-size: ${isMobile ? '14px' : '16px'}; color: #5DADE2; margin-top: 20px; animation: fadeIn 1.2s ease-in; text-align: center; line-height: 1.8;">
                                        以后你可以通过以下方式召唤我：<br>
                                        📍 点击设置界面左上角的头像<br>
                                        📍 长按悬浮球（智绘姬图标）<br><br>
                                        现在，让我们先配置一下我的 API 吧~ 💖
                                    </div>
                                `;
                                animationContainer.appendChild(greetingText);

                                // 3秒后显示"开始设置"按钮
                                setTimeout(() => {
                                    const startButton = document.createElement('button');
                                    startButton.innerHTML = '<i class="fa-solid fa-gear"></i> 开始设置 API';
                                    startButton.style.cssText = `
                                        margin-top: 30px;
                                        padding: ${isMobile ? '12px 35px' : '15px 45px'};
                                        font-size: ${isMobile ? '16px' : '20px'};
                                        font-weight: bold;
                                        color: white;
                                        background: linear-gradient(45deg, #5DADE2, #3498DB);
                                        border: 2px solid rgba(255, 255, 255, 0.5);
                                        border-radius: 50px;
                                        cursor: pointer;
                                        box-shadow: 0 8px 25px rgba(52, 152, 219, 0.5);
                                        transition: all 0.3s ease;
                                        font-family: "Microsoft YaHei", "PingFang SC", sans-serif;
                                        animation: fadeIn 0.5s ease-in, glow 2s ease-in-out infinite alternate;
                                    `;

                                    startButton.onmouseover = () => {
                                        startButton.style.transform = 'scale(1.05) translateY(-2px)';
                                        startButton.style.boxShadow = '0 12px 35px rgba(52, 152, 219, 0.7)';
                                    };
                                    startButton.onmouseout = () => {
                                        startButton.style.transform = 'scale(1) translateY(0)';
                                        startButton.style.boxShadow = '0 8px 25px rgba(52, 152, 219, 0.5)';
                                    };

                                    startButton.onclick = () => {
                                        startButton.style.transform = 'scale(0.95)';

                                        // 播放退出动画
                                        setTimeout(() => {
                                            animationContainer.style.animation = 'fadeOut 0.8s ease-out';
                                            setTimeout(() => {
                                                animationContainer.remove();
                                                closeVideo();

                                                // 打开智绘姬AI助手对话框和API设置面板
                                                setTimeout(() => {
                                                    const aiDialog = document.getElementById('st-chatu8-ai-dialog');
                                                    if (aiDialog && !aiDialog.classList.contains('active')) {
                                                        // 计算居中位置
                                                        const dialogWidth = aiDialog.offsetWidth;
                                                        const dialogHeight = aiDialog.offsetHeight;
                                                        const viewportWidth = window.innerWidth;
                                                        const viewportHeight = window.innerHeight;

                                                        const centerLeft = (viewportWidth - dialogWidth) / 2;
                                                        const centerTop = (viewportHeight - dialogHeight) / 2;

                                                        aiDialog.style.left = Math.max(0, centerLeft) + 'px';
                                                        aiDialog.style.top = Math.max(0, centerTop) + 'px';

                                                        aiDialog.classList.add('active');

                                                        // 打开API设置面板
                                                        const settingsPanel = document.getElementById('st-chatu8-ai-settings-panel');
                                                        if (settingsPanel) {
                                                            settingsPanel.classList.add('active');
                                                            addLog('[OpeningVideo] 已打开智绘姬AI助手API设置面板');
                                                        }
                                                    }
                                                }, 300);
                                            }, 800);
                                        }, 200);
                                    };

                                    animationContainer.appendChild(startButton);
                                }, 3000);
                            }, 500);
                        };

                        animationContainer.appendChild(confirmButton);
                    }, 800);
                }, 500);
            }
        }, 100);
    };

    // 添加所有元素
    animationContainer.appendChild(title);
    animationContainer.appendChild(subtitle);
    animationContainer.appendChild(codeDisplay);
    animationContainer.appendChild(clickButton);
    container.appendChild(animationContainer);
}

/**
 * 创建全屏视频容器
 */
function createVideoContainer() {
    if (videoContainer) return videoContainer;

    videoContainer = document.createElement('div');
    videoContainer.id = 'st-chatu8-opening-video-container';
    videoContainer.style.cssText = `
        position: fixed;
        top: 0;
        left: 0;
        width: 100vw;
        height: 100vh;
        background: rgba(0, 0, 0, 0.95);
        z-index: 99999;
        display: none;
        justify-content: center;
        align-items: center;
    `;

    // 添加动画样式
    const style = document.createElement('style');
    style.textContent = `
        @keyframes fadeIn {
            from { opacity: 0; }
            to { opacity: 1; }
        }
        @keyframes fadeOut {
            from { opacity: 1; }
            to { opacity: 0; }
        }
        @keyframes pulse {
            0%, 100% { transform: scale(1); }
            50% { transform: scale(1.05); }
        }
        @keyframes glow {
            from { text-shadow: 0 0 15px rgba(74, 144, 226, 0.4), 0 0 30px rgba(74, 144, 226, 0.2); }
            to { text-shadow: 0 0 20px rgba(74, 144, 226, 0.6), 0 0 40px rgba(74, 144, 226, 0.3); }
        }
        @keyframes bounce {
            0%, 100% { transform: translateY(0); }
            50% { transform: translateY(-10px); }
        }
        @keyframes flash {
            0%, 100% { opacity: 1; transform: scale(1); }
            50% { opacity: 0.5; transform: scale(1.2); }
        }
    `;
    document.head.appendChild(style);

    const video = document.createElement('video');
    video.id = 'st-chatu8-opening-video';
    video.style.cssText = `
        max-width: 100%;
        max-height: 100%;
        object-fit: contain;
    `;
    video.autoplay = true;
    video.playsInline = true;

    // 移动端检测
    const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);

    // 移动端默认静音以绕过自动播放限制
    video.muted = isMobile;

    // 添加音量控制按钮（移动端）
    let volumeButton = null;
    if (isMobile) {
        volumeButton = document.createElement('button');
        volumeButton.innerHTML = '<i class="fa-solid fa-volume-xmark"></i>';
        volumeButton.style.cssText = `
            position: absolute;
            top: 20px;
            left: 20px;
            padding: 10px 15px;
            background: rgba(255, 255, 255, 0.2);
            color: white;
            border: 1px solid rgba(255, 255, 255, 0.5);
            border-radius: 5px;
            cursor: pointer;
            font-size: 18px;
            transition: background 0.3s;
            z-index: 100000;
        `;
        volumeButton.onclick = () => {
            video.muted = !video.muted;
            volumeButton.innerHTML = video.muted
                ? '<i class="fa-solid fa-volume-xmark"></i>'
                : '<i class="fa-solid fa-volume-high"></i>';
        };
    }

    // ✅ 修改：防劫持视频路径，优先拉取伪装的 .chatu8 文件并作为 Blob URL 注入
    const chatu8Path = `${extensionFolderPath}/html/settings/enter.chatu8`;
    fetch(chatu8Path)
        .then(res => {
            if (!res.ok) throw new Error('enter.chatu8 load failed');
            return res.blob();
        })
        .then(blob => {
            // 修正MIME类型，欺骗浏览器以防其拒绝播放
            if (blob.type !== 'video/mp4') {
                video.src = URL.createObjectURL(new Blob([blob], { type: 'video/mp4' }));
            } else {
                video.src = URL.createObjectURL(blob);
            }
        })
        .catch(err => {
            console.warn('[OpeningVideo] 新版视频格式加载失败或未更新，尝试回退:', err);
            // 降级尝试加载不同格式的原版视频
            const videoFormats = ['mp4', 'webm', 'ogg'];
            for (const format of videoFormats) {
                const source = document.createElement('source');
                const encodedFileName = encodeURIComponent('登场') + '.' + format;
                source.src = `${extensionFolderPath}/html/settings/${encodedFileName}`;
                source.type = `video/${format}`;
                video.appendChild(source);
            }
        });

    // 跳过按钮
    const skipButton = document.createElement('button');
    skipButton.textContent = '跳过 (ESC)';
    skipButton.style.cssText = `
        position: absolute;
        top: 20px;
        right: 20px;
        padding: 10px 20px;
        background: rgba(255, 255, 255, 0.2);
        color: white;
        border: 1px solid rgba(255, 255, 255, 0.5);
        border-radius: 5px;
        cursor: pointer;
        font-size: 14px;
        transition: background 0.3s;
        z-index: 100000;
    `;
    skipButton.onmouseover = () => {
        skipButton.style.background = 'rgba(255, 255, 255, 0.4)';
    };
    skipButton.onmouseout = () => {
        skipButton.style.background = 'rgba(255, 255, 255, 0.2)';
    };

    videoContainer.appendChild(video);
    if (volumeButton) {
        videoContainer.appendChild(volumeButton);
    }
    videoContainer.appendChild(skipButton);
    document.body.appendChild(videoContainer);

    // 视频播放结束后显示编号生成动画（保持视频最后一帧作为背景）
    video.addEventListener('ended', () => {
        // 不隐藏视频，保持最后一帧
        // 只隐藏跳过按钮和音量按钮
        skipButton.style.display = 'none';
        if (volumeButton) {
            volumeButton.style.display = 'none';
        }

        // 显示编号生成动画（叠加在视频上方）
        showCodeGenerationAnimation();
    });

    // 点击跳过按钮 - 跳过视频直接进入编号生成（保持视频最后一帧）
    skipButton.addEventListener('click', (e) => {
        e.stopPropagation();

        // 暂停视频并跳到最后一帧
        video.pause();
        video.currentTime = video.duration;

        // 只隐藏按钮，保持视频显示
        skipButton.style.display = 'none';
        if (volumeButton) {
            volumeButton.style.display = 'none';
        }

        // 显示编号生成动画
        showCodeGenerationAnimation();
    });

    // 按 ESC 键跳过视频（保持视频最后一帧）
    const escHandler = (e) => {
        if (e.key === 'Escape' && videoContainer.style.display === 'flex') {
            // 暂停视频并跳到最后一帧
            video.pause();
            video.currentTime = video.duration;

            // 只隐藏按钮，保持视频显示
            skipButton.style.display = 'none';
            if (volumeButton) {
                volumeButton.style.display = 'none';
            }

            // 显示编号生成动画
            showCodeGenerationAnimation();
        }
    };
    document.addEventListener('keydown', escHandler);

    // 点击视频外区域跳过（保持视频最后一帧）
    videoContainer.addEventListener('click', (e) => {
        if (e.target === videoContainer) {
            // 暂停视频并跳到最后一帧
            video.pause();
            video.currentTime = video.duration;

            // 只隐藏按钮，保持视频显示
            skipButton.style.display = 'none';
            if (volumeButton) {
                volumeButton.style.display = 'none';
            }

            // 显示编号生成动画
            showCodeGenerationAnimation();
        }
    });

    return videoContainer;
}

/**
 * 播放开场视频
 */
export function playOpeningVideo() {
    // 检查是否已有智绘姬编号，如果有则跳过整个流程
    const settings = extension_settings[extensionName];
    if (settings && settings.chatu8_code) {
        addLog(`[OpeningVideo] 已有智绘姬编号 ${settings.chatu8_code}，跳过开场视频`);
        return;
    }

    // 每次刷新页面只播放一次
    if (hasPlayedOnce) {
        addLog('[OpeningVideo] 本次会话已播放过开场视频，跳过');
        return;
    }

    // ✅ 编号前置：进入流程时就立即生成并保存。
    // 即便视频黑屏/加载失败/用户中途关闭，刷新后也不会再次触发首次流程。
    // 后续的动画只是"揭晓"这个已保存的编号。
    if (settings && !settings.chatu8_code) {
        const preGeneratedCode = generateRandomCode();
        settings.chatu8_code = preGeneratedCode;
        saveSettingsDebounced();
        addLog(`[OpeningVideo] 编号前置生成并保存: ${preGeneratedCode}`);
    }

    try {
        const container = createVideoContainer();
        const video = container.querySelector('video');

        if (!video) {
            console.error('[OpeningVideo] 视频元素未找到');
            return;
        }

        // 显示容器
        container.style.display = 'flex';

        // 移动端检测
        const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);

        // 监听视频是否可以播放
        const canPlayHandler = () => {
            video.removeEventListener('canplay', canPlayHandler);

            // 尝试播放视频
            const playPromise = video.play();
            if (playPromise !== undefined) {
                playPromise
                    .then(() => {
                        addLog('[OpeningVideo] 开场视频播放成功');
                        hasPlayedOnce = true;

                        // 移动端提示可以开启声音
                        if (isMobile && video.muted) {
                            const toast = document.createElement('div');
                            toast.textContent = '点击左上角图标开启声音';
                            toast.style.cssText = `
                                position: absolute;
                                bottom: 80px;
                                left: 50%;
                                transform: translateX(-50%);
                                padding: 10px 20px;
                                background: rgba(0, 0, 0, 0.7);
                                color: white;
                                border-radius: 5px;
                                font-size: 14px;
                                z-index: 100001;
                                animation: fadeOut 3s forwards;
                            `;
                            container.appendChild(toast);
                            setTimeout(() => toast.remove(), 3000);
                        }
                    })
                    .catch((error) => {
                        console.error('[OpeningVideo] 视频播放失败:', error);
                        addLog('[OpeningVideo] 视频播放失败: ' + error.message);

                        // 移动端如果自动播放失败，尝试用户交互后播放
                        if (isMobile) {
                            const playButton = document.createElement('button');
                            playButton.innerHTML = '<i class="fa-solid fa-play"></i> 点击播放';
                            playButton.style.cssText = `
                                position: absolute;
                                top: 50%;
                                left: 50%;
                                transform: translate(-50%, -50%);
                                padding: 15px 30px;
                                background: rgba(255, 255, 255, 0.9);
                                color: #333;
                                border: none;
                                border-radius: 8px;
                                cursor: pointer;
                                font-size: 18px;
                                font-weight: bold;
                                z-index: 100001;
                            `;
                            playButton.onclick = () => {
                                video.play().then(() => {
                                    playButton.remove();
                                    hasPlayedOnce = true;
                                }).catch(err => {
                                    console.error('[OpeningVideo] 手动播放也失败:', err);
                                    closeVideo();
                                });
                            };
                            container.appendChild(playButton);
                        } else {
                            closeVideo();
                        }
                    });
            }
        };

        // 监听加载错误
        const errorHandler = (e) => {
            // 检查是否所有 source 都失败了
            const sources = video.querySelectorAll('source');
            const allFailed = Array.from(sources).every(source => {
                return source.error !== null;
            });

            if (allFailed) {
                console.warn('[OpeningVideo] 所有视频格式都加载失败，视频文件可能不存在');
                addLog('[OpeningVideo] 视频文件未找到，已跳过播放');
                closeVideo();
                video.removeEventListener('error', errorHandler);
            }
        };

        video.addEventListener('canplay', canPlayHandler);
        video.addEventListener('error', errorHandler);

        // 设置超时，如果 3 秒内视频还没加载成功，就放弃
        setTimeout(() => {
            if (container.style.display === 'flex' && video.paused && !container.querySelector('button[onclick]')) {
                addLog('[OpeningVideo] 视频加载超时，已跳过');
                closeVideo();
            }
        }, 3000);

    } catch (error) {
        console.error('[OpeningVideo] 播放开场视频时出错:', error);
        closeVideo();
    }
}

/**
 * 关闭视频容器（保持视频最后一帧，只是隐藏容器）
 */
function closeVideo() {
    if (!videoContainer) return;

    // 添加淡出动画后隐藏
    videoContainer.style.animation = 'fadeOut 0.5s ease-out';
    setTimeout(() => {
        videoContainer.style.display = 'none';
        videoContainer.style.animation = '';
    }, 500);

    addLog('[OpeningVideo] 开场视频已关闭');
}

/**
 * 重置播放状态（用于测试或特殊场景）
 */
export function resetOpeningVideoState() {
    hasPlayedOnce = false;
    addLog('[OpeningVideo] 播放状态已重置');
}
