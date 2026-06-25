// @ts-nocheck
/**
 * Gork 生成视频模块
 * 基于图片生成视频的对话框，UI 和 Banana 修图对话框一致
 */

import { createUnifiedDialog, createUnifiedInput, createButtonContainer } from './dialogs.js';

// 延迟导入，避免循环依赖
let _triggerGeneration = null;

/**
 * 设置 triggerGeneration 函数引用
 * @param {Function} fn - triggerGeneration 函数
 */
export function setGorkTriggerGeneration(fn) {
    _triggerGeneration = fn;
}

/**
 * 检测移动设备
 * @returns {boolean}
 */
function isMobileDeviceDialog() {
    return window.top.innerWidth <= 768 ||
        /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
}

/**
 * 显示 Gork 生成视频对话框
 * @param {HTMLImageElement} originalImgElement - 聊天界面中的原始图片元素
 * @param {HTMLButtonElement} originalButton - 原始的"生成图片"按钮
 */
export function showGorkVideoDialog(originalImgElement, originalButton) {
    const imageUrl = originalImgElement.src; // 获取当前图片
    const isMobile = isMobileDeviceDialog();

    // --- 使用统一对话框工厂函数创建对话框 ---
    const { backdrop, dialog, closeDialog } = createUnifiedDialog({
        title: '🎬 Gork 生成视频',
        isMobile: isMobile
    });

    // 图片预览
    const imagePreview = document.createElement('img');
    imagePreview.src = imageUrl;
    imagePreview.style.display = 'block';
    imagePreview.style.maxWidth = '100%';
    imagePreview.style.maxHeight = '30vh';
    imagePreview.style.objectFit = 'contain';
    imagePreview.style.margin = '0 auto 15px auto';
    imagePreview.style.borderRadius = '8px';

    // 视频生成提示词输入框 - 使用统一输入框创建函数
    const input = createUnifiedInput({
        placeholder: '输入视频生成指令，例如："让人物挥手微笑"',
        value: originalButton.dataset.videoPrompt || '',
        rows: 2
    });

    // 发送按钮处理函数
    const handleSend = () => {
        const videoPrompt = input.value.trim();
        if (!videoPrompt) {
            toastr.warning('请输入视频生成指令。');
            return;
        }

        // 将视频指令和图片URL存储到 dataset 中，供 banana.js 读取
        originalButton.dataset.videoPrompt = videoPrompt;
        originalButton.dataset.videoImage = imageUrl;

        // 将视频标记一起设置为 change 数据
        if (!originalButton.dataset.change) {
            originalButton.dataset.change = originalButton.dataset.link;
        }
        originalButton.dataset.change = `${originalButton.dataset.change}{视频}`;

        toastr.info('正在准备生成视频...');

        // 触发标准生成流程
        if (_triggerGeneration) {
            _triggerGeneration(originalButton);
        }

        // 关闭对话框
        closeDialog();
    };

    // 使用统一按钮容器创建函数
    const buttonContainer = createButtonContainer([
        {
            text: '发送',
            className: 'send',
            onClick: handleSend
        },
        {
            text: '取消',
            className: 'cancel',
            onClick: closeDialog
        }
    ]);

    // --- 组装 UI ---
    dialog.appendChild(imagePreview);
    dialog.appendChild(input);
    dialog.appendChild(buttonContainer);

    input.focus();
}
