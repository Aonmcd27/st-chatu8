// @ts-nocheck
/**
 * NovelAI 局部重绘模块
 * 提供基于 NovelAI Infill API 的图像局部重绘功能
 * 
 * 主要功能:
 * - 画布遮罩编辑器
 * - 8x8 像素网格对齐
 * - NovelAI API 集成
 * 
 * @module novelaiInpaint
 */

import { createUnifiedDialog, createButtonContainer } from './dialogs.js';
import { handleAutocomplete } from './autocomplete.js';
import { stripChineseAnnotations } from '../utils.js';

/**
 * 处理生成按钮点击事件
 * 
 * 应用网格对齐、编码图像和遮罩为 Base64，
 * 将数据存储到 window 对象，标记按钮并触发生成。
 * 
 * @param {MaskEditorState} state - 编辑器状态对象
 * @param {HTMLElement} button - 触发按钮元素
 * @param {Function} closeDialog - 关闭对话框的函数
 * @param {HTMLElement} statusDiv - 状态显示区域元素
 * 
 * @private
 */
async function handleGenerate(state, button, closeDialog, statusDiv) {
    try {
        // Validate image exists
        if (!state.originalImage || !state.imageCanvas) {
            showError(statusDiv, '无效的图片元素');
            return;
        }

        // Validate prompt is not empty
        if (!state.prompt || state.prompt.trim() === '') {
            showError(statusDiv, '请输入生成提示词');
            return;
        }

        // Validate strength is in range 0-1
        if (state.strength < 0 || state.strength > 1) {
            showError(statusDiv, '强度必须在 0 到 1 之间');
            return;
        }

        // Apply grid alignment to data mask (使用数据遮罩画布)
        const alignedImageData = applyGridAlignment(state.dataMaskCanvas);

        if (!alignedImageData) {
            console.error('[NovelAI Inpaint] Failed to generate aligned mask');
            showError(statusDiv, 'Mask 生成失败');
            return;
        }

        // Create temporary canvas for aligned mask
        const alignedCanvas = document.createElement('canvas');
        alignedCanvas.width = state.dataMaskCanvas.width;
        alignedCanvas.height = state.dataMaskCanvas.height;
        const alignedCtx = alignedCanvas.getContext('2d');
        alignedCtx.putImageData(alignedImageData, 0, 0);

        // Encode image and mask to Base64
        const imageBase64 = await canvasToBase64(state.imageCanvas);
        const maskBase64 = await canvasToBase64(alignedCanvas);

        // Process prompts: remove Chinese annotations
        const processedPrompt = stripChineseAnnotations(state.prompt.trim());
        const processedNegativePrompt = stripChineseAnnotations(state.negativePrompt.trim());

        // Store data in window object (including original image dimensions)
        window.novelaiInpaintImage = imageBase64;
        window.novelaiInpaintMask = maskBase64;
        window.novelaiInpaintPrompt = processedPrompt;
        window.novelaiInpaintNegativePrompt = processedNegativePrompt;
        window.novelaiInpaintStrength = state.strength;
        window.novelaiInpaintWidth = state.originalImage.width;
        window.novelaiInpaintHeight = state.originalImage.height;

        console.log('[NovelAI Inpaint] 存储参数:', {
            imageSize: `${state.originalImage.width}x${state.originalImage.height}`,
            maskSize: `${alignedCanvas.width}x${alignedCanvas.height}`,
            prompt: processedPrompt,
            negativePrompt: processedNegativePrompt,
            strength: state.strength
        });

        // Mark button with NovelAI inpaint flag
        const currentChange = button.dataset.change || '';
        if (!currentChange.includes('{NovelAI局部重绘}')) {
            button.dataset.change = currentChange + ' {NovelAI局部重绘}';
        }

        // Trigger button click (will be handled by novelai.js)
        button.click();

        // Close dialog
        closeDialog();

    } catch (error) {
        console.error('[NovelAI Inpaint] Error during generation:', error);
        showError(statusDiv, '生成失败: ' + error.message);
    }
}

/**
 * 显示 NovelAI 局部重绘对话框
 * 
 * 创建一个交互式对话框，允许用户在图像上绘制遮罩并使用 NovelAI Infill API 进行局部重绘。
 * 遮罩会自动对齐到 8x8 像素网格以满足 NovelAI API 要求。
 * 
 * @param {HTMLImageElement} img - 要重绘的图片元素
 * @param {HTMLElement} button - 触发按钮元素（用于标记和触发生成）
 * 
 * @example
 * // 从图片编辑菜单调用
 * showNovelAIInpaintDialog(imageElement, generateButton);
 */
export async function showNovelAIInpaintDialog(img, button) {
    // Validate image before opening dialog
    if (!img || !img.src) {
        console.error('[NovelAI Inpaint] Invalid image element');
        if (typeof toastr !== 'undefined') {
            toastr.error('无效的图片元素');
        }
        return;
    }

    // Additional validation: check if image source is accessible
    try {
        const testImage = new Image();
        testImage.crossOrigin = 'anonymous';
        await new Promise((resolve, reject) => {
            testImage.onload = resolve;
            testImage.onerror = () => reject(new Error('图片加载失败'));
            testImage.src = img.src;
        });
    } catch (error) {
        console.error('[NovelAI Inpaint] Image validation failed:', error);
        if (typeof toastr !== 'undefined') {
            toastr.error('图片加载失败，请检查图片源');
        }
        return;
    }

    const isMobile = isMobileDevice();

    // Create dialog using unified dialog system
    const { backdrop, dialog, closeDialog } = createUnifiedDialog({
        title: '🎨 NovelAI 局部重绘',
        isMobile: isMobile
    });

    // Create canvas container for dual-canvas system
    const canvasContainer = await createCanvasContainer(img, isMobile);
    // Add canvas container FIRST (matching ComfyUI order)
    dialog.appendChild(canvasContainer);

    // 桌面端：根据图片宽度调整对话框宽度（完全模仿 ComfyUI）
    if (!isMobile) {
        const displayWidth = parseInt(canvasContainer.dataset.displayWidth);
        if (displayWidth) {
            // 对话框宽度 = 图片宽度 + padding (20px * 2) + 一些额外空间
            const dialogWidth = displayWidth + 60; // 40px padding + 20px extra
            dialog.style.width = `${dialogWidth}px`;
            dialog.style.maxWidth = '95vw'; // 确保不超过视口宽度
        }
    }

    // Add CSS styles for toolbar container
    const style = document.createElement('style');
    style.textContent = `
        /* Toolbar container base styles */
        .st-chatu8-inpaint-toolbar-container {
            display: flex;
            flex-direction: column;
            gap: 10px;
            padding: 10px;
            background-color: var(--st-chatu8-bg-secondary, #2a2a4a);
            border-radius: 8px;
            margin-bottom: 15px;
        }
        
        /* Mobile-specific styles - no separate scrollbar */
        .st-chatu8-inpaint-toolbar-container.mobile {
            overflow: visible;
            /* Let the dialog handle scrolling */
        }
        
        /* Desktop-specific styles */
        .st-chatu8-inpaint-toolbar-container.desktop {
            overflow: visible;
            max-height: none;
        }
        
        /* Toolbar styles */
        .st-chatu8-inpaint-toolbar {
            display: flex;
            gap: 10px;
            align-items: center;
            flex-wrap: wrap;
        }
        
        .st-chatu8-inpaint-brush-label {
            display: flex;
            align-items: center;
            gap: 8px;
        }
        
        .st-chatu8-inpaint-brush-slider {
            width: 100px;
        }
        
        .st-chatu8-tool-btn {
            padding: 8px 12px;
            border: 1px solid var(--st-chatu8-border-color, #444);
            border-radius: 6px;
            background: var(--st-chatu8-bg-secondary, #2a2a4a);
            color: var(--st-chatu8-text-primary, #fff);
            cursor: pointer;
            transition: all 0.2s;
        }
        .st-chatu8-tool-btn:hover {
            background: var(--st-chatu8-accent-secondary, #3a3a5a);
        }
        .st-chatu8-tool-btn.active {
            background: var(--st-chatu8-accent-primary, #4a4a8a);
            border-color: var(--st-chatu8-accent-primary, #6a6aaa);
        }
        
        /* Denoise/Strength slider styles (matching ComfyUI) */
        .st-chatu8-inpaint-denoise-group {
            display: flex;
            align-items: center;
            gap: 10px;
        }
        
        .st-chatu8-inpaint-denoise-label {
            flex-shrink: 0;
        }
        
        .st-chatu8-inpaint-denoise-slider {
            flex: 1;
            min-width: 100px;
        }
        
        .st-chatu8-inpaint-denoise-value {
            min-width: 40px;
            text-align: right;
        }
        
        /* Autocomplete styles for inpaint dialog */
        .st-chatu8-edit-backdrop .ch-autocomplete-results {
            display: none;
            position: absolute;
            background-color: var(--st-chatu8-dropdown-list-bg, #2a2a4a);
            border: 1px solid var(--st-chatu8-border-color, #444);
            border-radius: 6px;
            max-height: 150px;
            overflow-y: auto;
            z-index: 10;
            box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
            max-width: 100%;
        }
        .st-chatu8-edit-backdrop .ch-autocomplete-item {
            padding: 8px 12px;
            cursor: pointer;
            color: var(--st-chatu8-dropdown-text, #fff);
            font-size: 0.9em;
        }
        .st-chatu8-edit-backdrop .ch-autocomplete-item:hover {
            background-color: var(--st-chatu8-accent-secondary, #3a3a5a);
            color: var(--st-chatu8-text-highlight, #fff);
        }
        
        /* Prompt section styles */
        .st-chatu8-inpaint-prompt-section {
            display: flex;
            flex-direction: column;
            gap: 10px;
            position: relative;
        }
        
        .st-chatu8-inpaint-prompt-group {
            display: flex;
            flex-direction: column;
            gap: 5px;
            position: relative;
        }
    `;
    dialog.appendChild(style);

    // Initialize drawing state management
    const state = new MaskEditorState();
    state.displayWidth = parseInt(canvasContainer.dataset.displayWidth);
    state.displayHeight = parseInt(canvasContainer.dataset.displayHeight);
    state.imageCanvas = canvasContainer._imageCanvas;
    state.displayMaskCanvas = canvasContainer._displayMaskCanvas;
    state.dataMaskCanvas = canvasContainer._dataMaskCanvas;
    state.displayMaskCtx = state.displayMaskCanvas.getContext('2d', { willReadFrequently: true });
    state.dataMaskCtx = state.dataMaskCanvas.getContext('2d', { willReadFrequently: true });

    // Load original image reference
    const originalImage = new Image();
    originalImage.crossOrigin = 'anonymous';
    await new Promise((resolve) => {
        originalImage.onload = resolve;
        originalImage.src = img.src;
    });
    state.originalImage = originalImage;

    // Set up brush size (default 32px, range 8-150px, step 8)
    state.brushSize = 32;

    // Set up drawing mode (draw/erase)
    state.mode = 'draw';

    // Set up mouse/touch event handlers for drawing
    setupDrawingEvents(state);

    // 初始化历史记录：保存初始的空白遮罩状态
    // 使用 setTimeout 确保画布已完全渲染
    setTimeout(() => {
        saveState(state);
    }, 0);

    // Create toolbar controls
    const toolbar = createToolbar(state);

    // Create parameter inputs (prompt and strength)
    const parameterInputs = createParameterInputs(state);

    // Create toolbar container with toolbar and parameters
    const toolbarContainer = createToolbarContainer(isMobile, toolbar, parameterInputs);
    dialog.appendChild(toolbarContainer);

    // Create error display area
    const statusDiv = createStatusDiv();
    dialog.appendChild(statusDiv);

    // Create action buttons
    const generateButton = {
        text: '生成',
        className: 'send',
        onClick: async () => {
            // Hide any previous errors
            hideError(statusDiv);

            // Disable button during generation
            const btnElement = buttonContainer.querySelector('.send');
            if (btnElement) {
                btnElement.disabled = true;
                btnElement.style.opacity = '0.6';
                btnElement.style.cursor = 'not-allowed';
            }

            try {
                await handleGenerate(state, button, closeDialog, statusDiv);
            } finally {
                // Re-enable button after generation (success or error)
                if (btnElement) {
                    btnElement.disabled = false;
                    btnElement.style.opacity = '1';
                    btnElement.style.cursor = 'pointer';
                }
            }
        }
    };

    const buttonContainer = createButtonContainer([
        generateButton,
        {
            text: '关闭',
            className: 'cancel',
            onClick: closeDialog
        }
    ]);
    dialog.appendChild(buttonContainer);
}

/**
 * 遮罩编辑器状态管理类
 * 
 * 管理画布绘制状态、画笔设置和用户交互。
 * 
 * @private
 */
class MaskEditorState {
    constructor() {
        /** @type {Image} 原始图像对象 */
        this.originalImage = null;

        /** @type {number} 显示宽度（缩放后） */
        this.displayWidth = 0;

        /** @type {number} 显示高度（缩放后） */
        this.displayHeight = 0;

        /** @type {number} 画笔大小（像素） */
        this.brushSize = 32;

        /** @type {'draw'|'erase'} 绘制模式 */
        this.mode = 'draw';

        /** @type {boolean} 是否正在绘制 */
        this.isDrawing = false;

        /** @type {{x: number, y: number}|null} 上一个绘制位置 */
        this.lastPos = null;

        /** @type {HTMLCanvasElement} 图像画布 */
        this.imageCanvas = null;

        /** @type {HTMLCanvasElement} 显示遮罩画布（用于视觉显示） */
        this.displayMaskCanvas = null;

        /** @type {HTMLCanvasElement} 数据遮罩画布（用于 API 提交） */
        this.dataMaskCanvas = null;

        /** @type {CanvasRenderingContext2D} 显示遮罩画布上下文 */
        this.displayMaskCtx = null;

        /** @type {CanvasRenderingContext2D} 数据遮罩画布上下文 */
        this.dataMaskCtx = null;

        /** @type {string} 生成提示词 */
        this.prompt = 'blue eyes, highly detailed, masterpiece';

        /** @type {string} 负面提示词 */
        this.negativePrompt = '';

        /** @type {number} 图像强度（0-1） */
        this.strength = 0.54;

        /** @type {string[]} 历史记录数组（Base64 PNG 字符串） */
        this.history = [];

        /** @type {number} 当前历史记录索引 */
        this.historyIndex = -1;

        /** @type {number} 最大历史记录数量 */
        this.maxHistory = 20;

        /** @type {Function|null} 历史变化回调 */
        this.onHistoryChange = null;
    }
}

/**
 * 设置画布绘制事件处理器
 * 
 * 为遮罩画布添加鼠标和触摸事件监听器，支持桌面和移动设备。
 * 实现连续绘制和线条插值以确保笔画连续性。
 * 
 * @param {MaskEditorState} state - 编辑器状态对象
 * 
 * @private
 */
function setupDrawingEvents(state) {
    const canvas = state.displayMaskCanvas; // 使用显示遮罩画布

    /**
     * 获取画布相对坐标（带缩放转换）
     * 
     * @param {MouseEvent|Touch} event - 鼠标或触摸事件
     * @returns {{x: number, y: number}} 原始画布坐标
     */
    function getCanvasCoords(event) {
        if (!canvas) return { x: 0, y: 0 };
        const rect = canvas.getBoundingClientRect();
        // 关键：将显示坐标转换为原始坐标
        const x = (event.clientX - rect.left) * (canvas.width / rect.width);
        const y = (event.clientY - rect.top) * (canvas.height / rect.height);
        return { x, y };
    }

    /**
     * 开始绘制
     * 
     * @param {MouseEvent|TouchEvent} event - 鼠标或触摸事件
     */
    function startDrawing(event) {
        event.preventDefault();
        state.isDrawing = true;

        // Get coordinates from mouse or touch event
        const coords = event.touches
            ? getCanvasCoords(event.touches[0])
            : getCanvasCoords(event);

        state.lastPos = coords;
        drawBrush(state, coords.x, coords.y);
    }

    /**
     * 继续绘制
     * 
     * @param {MouseEvent|TouchEvent} event - 鼠标或触摸事件
     */
    function continueDrawing(event) {
        if (!state.isDrawing) return;
        event.preventDefault();

        // Get coordinates from mouse or touch event
        const coords = event.touches
            ? getCanvasCoords(event.touches[0])
            : getCanvasCoords(event);

        // Draw line from last position to current position for continuity
        if (state.lastPos) {
            drawLine(state, state.lastPos.x, state.lastPos.y, coords.x, coords.y);
        } else {
            drawBrush(state, coords.x, coords.y);
        }

        state.lastPos = coords;
    }

    /**
     * 停止绘制
     * 
     * @param {MouseEvent|TouchEvent} event - 鼠标或触摸事件
     */
    function stopDrawing(event) {
        if (state.isDrawing) {
            event.preventDefault();

            // 保存当前状态到历史记录
            saveState(state);
        }
        state.isDrawing = false;
        state.lastPos = null;
    }

    // Mouse events
    canvas.addEventListener('mousedown', startDrawing);
    canvas.addEventListener('mousemove', continueDrawing);
    canvas.addEventListener('mouseup', stopDrawing);
    canvas.addEventListener('mouseleave', stopDrawing);

    // Touch events for mobile
    canvas.addEventListener('touchstart', startDrawing, { passive: false });
    canvas.addEventListener('touchmove', continueDrawing, { passive: false });
    canvas.addEventListener('touchend', stopDrawing, { passive: false });
    canvas.addEventListener('touchcancel', stopDrawing, { passive: false });
}

/**
 * 应用 8x8 网格对齐到遮罩
 * 
 * NovelAI Infill API 要求遮罩按 8x8 像素块对齐。
 * 此函数将自由绘制的遮罩转换为网格对齐的遮罩。
 * 
 * 算法：
 * 1. 将遮罩划分为 8x8 像素块
 * 2. 对于每个块，检查是否有任何像素为白色（> 128）
 * 3. 如果有白色像素，将整个块填充为白色（255）
 * 4. 如果没有白色像素，将整个块填充为黑色（0）
 * 5. 正确处理图像边缘的部分块
 * 
 * @param {HTMLCanvasElement} maskCanvas - 源遮罩画布
 * @param {number} [gridSize=8] - 网格大小（默认 8 像素）
 * @returns {ImageData} 对齐后的图像数据
 * 
 * @private
 */
function applyGridAlignment(maskCanvas, gridSize = 8) {
    const width = maskCanvas.width;
    const height = maskCanvas.height;
    const ctx = maskCanvas.getContext('2d', { willReadFrequently: true });
    const imageData = ctx.getImageData(0, 0, width, height);
    const data = imageData.data;

    // Create new ImageData for aligned mask
    const aligned = new ImageData(width, height);
    const alignedData = aligned.data;

    // Process each 8x8 block
    for (let blockY = 0; blockY < height; blockY += gridSize) {
        for (let blockX = 0; blockX < width; blockX += gridSize) {
            // Check if any pixel in block is white (> 128)
            let hasWhite = false;

            // Scan all pixels in the current block
            for (let dy = 0; dy < gridSize && (blockY + dy) < height; dy++) {
                for (let dx = 0; dx < gridSize && (blockX + dx) < width; dx++) {
                    const px = blockX + dx;
                    const py = blockY + dy;
                    const i = (py * width + px) * 4;

                    // Check RGB channels (any channel > 128 means white)
                    if (data[i] > 128 || data[i + 1] > 128 || data[i + 2] > 128) {
                        hasWhite = true;
                        break;
                    }
                }
                if (hasWhite) break;
            }

            // Fill entire block with white (255) or black (0)
            const color = hasWhite ? 255 : 0;

            // Fill all pixels in the block (handle partial blocks at edges)
            for (let dy = 0; dy < gridSize && (blockY + dy) < height; dy++) {
                for (let dx = 0; dx < gridSize && (blockX + dx) < width; dx++) {
                    const px = blockX + dx;
                    const py = blockY + dy;
                    const i = (py * width + px) * 4;

                    alignedData[i] = color;         // R
                    alignedData[i + 1] = color;     // G
                    alignedData[i + 2] = color;     // B
                    alignedData[i + 3] = 255;       // A (fully opaque)
                }
            }
        }
    }

    return aligned;
}

/**
 * 在画布上绘制圆形画笔
 * 
 * 根据当前模式（绘制/擦除）在指定位置绘制圆形画笔标记。
 * 同时在显示层和数据层绘制。
 * - 显示层：红色半透明（视觉反馈）
 * - 数据层：纯黑白（API 提交）
 * 
 * @param {MaskEditorState} state - 编辑器状态对象
 * @param {number} x - X 坐标（原始画布坐标系）
 * @param {number} y - Y 坐标（原始画布坐标系）
 * 
 * @private
 */
function drawBrush(state, x, y) {
    // 显示层：红色半透明（用于视觉反馈）
    state.displayMaskCtx.fillStyle = state.mode === 'draw'
        ? 'rgba(255, 0, 0, 0.5)'  // 绘制：红色半透明
        : 'rgba(0, 0, 0, 1)';      // 擦除：黑色不透明

    state.displayMaskCtx.beginPath();
    state.displayMaskCtx.arc(x, y, state.brushSize / 2, 0, Math.PI * 2);
    state.displayMaskCtx.fill();

    // 数据层：纯黑白（用于 API 提交）
    state.dataMaskCtx.fillStyle = state.mode === 'draw' ? '#FFFFFF' : '#000000';

    state.dataMaskCtx.beginPath();
    state.dataMaskCtx.arc(x, y, state.brushSize / 2, 0, Math.PI * 2);
    state.dataMaskCtx.fill();
}

/**
 * 在两点之间绘制插值线
 * 
 * 通过在两点之间插值多个点来确保连续的笔画，避免快速移动时出现间隙。
 * 
 * @param {MaskEditorState} state - 编辑器状态对象
 * @param {number} x0 - 起始点 X 坐标
 * @param {number} y0 - 起始点 Y 坐标
 * @param {number} x1 - 结束点 X 坐标
 * @param {number} y1 - 结束点 Y 坐标
 * 
 * @private
 */
function drawLine(state, x0, y0, x1, y1) {
    const distance = Math.sqrt((x1 - x0) ** 2 + (y1 - y0) ** 2);
    const steps = Math.max(1, Math.ceil(distance / (state.brushSize / 4)));

    for (let i = 0; i <= steps; i++) {
        const t = i / steps;
        const x = x0 + (x1 - x0) * t;
        const y = y0 + (y1 - y0) * t;
        drawBrush(state, x, y);
    }
}

/**
 * 保存当前遮罩状态到历史记录
 * 
 * 将当前遮罩画布转换为 Base64 PNG 并保存到历史数组。
 * 如果在撤销后进行新编辑，将丢弃所有重做历史。
 * 如果历史记录超过最大限制，将删除最旧的状态。
 * 
 * @param {MaskEditorState} state - 编辑器状态对象
 * 
 * @private
 */
function saveState(state) {
    // 移除当前位置之后的所有重做历史
    state.history = state.history.slice(0, state.historyIndex + 1);

    // 保存当前数据遮罩状态为 Base64
    const base64Data = state.dataMaskCanvas.toDataURL('image/png');
    state.history.push(base64Data);

    // 限制历史记录大小
    if (state.history.length > state.maxHistory) {
        state.history.shift();
        state.historyIndex = state.history.length - 1; // 修复溢出时的 index
    } else {
        state.historyIndex++;
    }

    console.log('[NovelAI Inpaint] State saved. History length:', state.history.length, 'Index:', state.historyIndex);

    // 通知 UI 更新
    if (state.onHistoryChange) {
        state.onHistoryChange();
    }
}

/**
 * 从 Base64 数据恢复遮罩状态
 * 
 * 加载 Base64 PNG 图像并绘制到两个遮罩画布上。
 * 
 * @param {MaskEditorState} state - 编辑器状态对象
 * @param {string} base64Data - Base64 编码的 PNG 数据
 * 
 * @private
 */
function restoreState(state, base64Data) {
    const img = new Image();
    img.onload = () => {
        // 恢复显示遮罩（红色半透明）
        state.displayMaskCtx.clearRect(0, 0, state.displayMaskCanvas.width, state.displayMaskCanvas.height);
        state.displayMaskCtx.globalCompositeOperation = 'source-over';
        state.displayMaskCtx.drawImage(img, 0, 0);

        // 将黑白遮罩转换为红色半透明显示
        const imageData = state.displayMaskCtx.getImageData(0, 0, state.displayMaskCanvas.width, state.displayMaskCanvas.height);
        const data = imageData.data;
        for (let i = 0; i < data.length; i += 4) {
            if (data[i] > 128) { // 白色区域
                data[i] = 255;     // R
                data[i + 1] = 0;   // G
                data[i + 2] = 0;   // B
                data[i + 3] = 128; // A (半透明)
            }
        }
        state.displayMaskCtx.putImageData(imageData, 0, 0);

        // 恢复数据遮罩（纯黑白）
        state.dataMaskCtx.clearRect(0, 0, state.dataMaskCanvas.width, state.dataMaskCanvas.height);
        state.dataMaskCtx.drawImage(img, 0, 0);
    };
    img.src = base64Data;
}

/**
 * 撤销上一次遮罩编辑
 * 
 * 将遮罩恢复到历史记录中的前一个状态。
 * 如果已经在历史记录的开头，则不执行任何操作。
 * 
 * @param {MaskEditorState} state - 编辑器状态对象
 * 
 * @private
 */
function undo(state) {
    console.log('[NovelAI Inpaint] Undo called. Current index:', state.historyIndex, 'History length:', state.history.length);
    if (state.historyIndex > 0) {
        state.historyIndex--;
        restoreState(state, state.history[state.historyIndex]);
        console.log('[NovelAI Inpaint] Undo executed. New index:', state.historyIndex);

        // 通知 UI 更新
        if (state.onHistoryChange) {
            state.onHistoryChange();
        }
    } else {
        console.log('[NovelAI Inpaint] Cannot undo - at beginning of history');
    }
}

/**
 * 重做下一次遮罩编辑
 * 
 * 将遮罩恢复到历史记录中的下一个状态。
 * 如果已经在历史记录的末尾，则不执行任何操作。
 * 
 * @param {MaskEditorState} state - 编辑器状态对象
 * 
 * @private
 */
function redo(state) {
    if (state.historyIndex < state.history.length - 1) {
        state.historyIndex++;
        restoreState(state, state.history[state.historyIndex]);

        // 通知 UI 更新
        if (state.onHistoryChange) {
            state.onHistoryChange();
        }
    }
}

/**
 * 将画布转换为 Base64 编码的 PNG
 * 
 * @param {HTMLCanvasElement} canvas - 要编码的画布
 * @returns {Promise<string>} Base64 编码的 PNG 数据 URL
 * 
 * @private
 */
function canvasToBase64(canvas) {
    return new Promise((resolve) => {
        canvas.toBlob((blob) => {
            const reader = new FileReader();
            reader.onloadend = () => resolve(reader.result);
            reader.readAsDataURL(blob);
        }, 'image/png');
    });
}

/**
 * Create responsive toolbar container
 * @param {boolean} isMobile - Whether device is mobile
 * @param {HTMLElement} toolbar - Toolbar element
 * @param {HTMLElement} parameterInputs - Parameter inputs element
 * @returns {HTMLElement} Container element
 */
function createToolbarContainer(isMobile, toolbar, parameterInputs) {
    const container = document.createElement('div');
    container.className = 'st-chatu8-inpaint-toolbar-container';
    container.style.position = 'relative';
    container.style.zIndex = '1';

    if (isMobile) {
        container.classList.add('mobile');
    } else {
        container.classList.add('desktop');
    }

    container.appendChild(toolbar);
    container.appendChild(parameterInputs);

    return container;
}

/**
 * 创建工具栏控件
 * 
 * 创建包含画笔大小滑块、绘制/擦除模式切换、清空遮罩和预览按钮的工具栏。
 * 
 * @param {MaskEditorState} state - 编辑器状态对象
 * @returns {HTMLElement} 工具栏容器元素
 * 
 * @private
 */
function createToolbar(state) {
    const toolbar = document.createElement('div');
    toolbar.className = 'st-chatu8-inpaint-toolbar';
    toolbar.innerHTML = `
        <button id="tool-draw" class="st-chatu8-tool-btn active" title="画笔">🖌️ 画笔</button>
        <button id="tool-erase" class="st-chatu8-tool-btn" title="橡皮">🧽 橡皮</button>
        <button id="tool-undo" class="st-chatu8-tool-btn" title="撤销">⤺ 撤销</button>
        <button id="tool-redo" class="st-chatu8-tool-btn" title="重做">⤻ 重做</button>
        <button id="tool-clear" class="st-chatu8-tool-btn" title="清空">🗑️ 清空</button>
        <button id="tool-preview" class="st-chatu8-tool-btn" title="预览蒙版">👁️ 预览</button>
        <label class="st-chatu8-inpaint-brush-label">
            画笔: <input type="range" id="brush-size" min="8" max="150" step="8" value="${state.brushSize}" class="st-chatu8-inpaint-brush-slider">
            <span id="brush-size-value">${state.brushSize}</span>px
        </label>
    `;

    // 绑定事件
    setTimeout(() => {
        const drawBtn = toolbar.querySelector('#tool-draw');
        const eraseBtn = toolbar.querySelector('#tool-erase');
        const undoBtn = toolbar.querySelector('#tool-undo');
        const redoBtn = toolbar.querySelector('#tool-redo');
        const clearBtn = toolbar.querySelector('#tool-clear');
        const previewBtn = toolbar.querySelector('#tool-preview');
        const brushSizeInput = toolbar.querySelector('#brush-size');
        const brushSizeValue = toolbar.querySelector('#brush-size-value');

        let maskVisible = true;

        // 更新撤销/重做按钮状态
        function updateUndoRedoButtons() {
            undoBtn.disabled = state.historyIndex <= 0;
            redoBtn.disabled = state.historyIndex >= state.history.length - 1;

            // 视觉反馈
            undoBtn.style.opacity = undoBtn.disabled ? '0.5' : '1';
            undoBtn.style.cursor = undoBtn.disabled ? 'not-allowed' : 'pointer';
            redoBtn.style.opacity = redoBtn.disabled ? '0.5' : '1';
            redoBtn.style.cursor = redoBtn.disabled ? 'not-allowed' : 'pointer';
        }

        // 注册回调，这样每次历史变化都会更新按钮状态
        state.onHistoryChange = updateUndoRedoButtons;

        drawBtn.onclick = () => {
            state.mode = 'draw';
            drawBtn.classList.add('active');
            eraseBtn.classList.remove('active');
        };

        eraseBtn.onclick = () => {
            state.mode = 'erase';
            eraseBtn.classList.add('active');
            drawBtn.classList.remove('active');
        };

        // 撤销按钮 - 不再需要手动调用 updateUndoRedoButtons
        undoBtn.onclick = () => {
            undo(state);
        };

        // 重做按钮 - 不再需要手动调用 updateUndoRedoButtons
        redoBtn.onclick = () => {
            redo(state);
        };

        // clearBtn 也不需要手动调用了，因为 saveState 会触发
        clearBtn.onclick = () => {
            // 清空显示遮罩（红色半透明）
            state.displayMaskCtx.fillStyle = '#000000';
            state.displayMaskCtx.fillRect(0, 0, state.displayMaskCanvas.width, state.displayMaskCanvas.height);

            // 清空数据遮罩（纯黑白）
            state.dataMaskCtx.fillStyle = '#000000';
            state.dataMaskCtx.fillRect(0, 0, state.dataMaskCanvas.width, state.dataMaskCanvas.height);

            saveState(state);
        };

        previewBtn.onclick = () => {
            maskVisible = !maskVisible;
            state.displayMaskCanvas.style.opacity = maskVisible ? '0.6' : '0';
            previewBtn.textContent = maskVisible ? '👁️ 预览蒙版' : '👁️‍🗨️ 显示蒙版';
        };

        brushSizeInput.oninput = (e) => {
            state.brushSize = parseInt(e.target.value);
            brushSizeValue.textContent = state.brushSize;
        };

        // 初始化按钮状态
        updateUndoRedoButtons();
    }, 0);

    return toolbar;
}

/**
 * 创建参数输入区域
 * 
 * 创建包含正面/负面提示词文本框和强度滑块的参数配置区域。
 * 
 * @param {MaskEditorState} state - 编辑器状态对象
 * @returns {HTMLElement} 参数输入容器元素
 * 
 * @private
 */
function createParameterInputs(state) {
    const container = document.createElement('div');
    container.className = 'st-chatu8-inpaint-prompt-section';
    container.style.cssText = `
        display: flex;
        flex-direction: column;
        gap: 10px;
        position: relative;
    `;

    // Positive prompt textarea with autocomplete
    const positivePromptContainer = document.createElement('div');
    positivePromptContainer.className = 'st-chatu8-inpaint-prompt-group';
    positivePromptContainer.style.cssText = `
        display: flex;
        flex-direction: column;
        gap: 5px;
        position: relative;
    `;
    positivePromptContainer.innerHTML = `
        <label style="display: block;">正面提示词:</label>
        <textarea id="novelai-prompt" rows="2" placeholder="输入生成提示词，例如: blue eyes, highly detailed, masterpiece" 
            class="st-chatu8-edit-input" style="resize: vertical; box-sizing: border-box;">${state.prompt}</textarea>
        <div class="ch-autocomplete-results" id="positive-autocomplete"></div>
    `;

    // Negative prompt textarea with autocomplete
    const negativePromptContainer = document.createElement('div');
    negativePromptContainer.className = 'st-chatu8-inpaint-prompt-group';
    negativePromptContainer.style.cssText = `
        display: flex;
        flex-direction: column;
        gap: 5px;
        position: relative;
    `;
    negativePromptContainer.innerHTML = `
        <label style="display: block;">负面提示词:</label>
        <textarea id="novelai-negative-prompt" rows="2" placeholder="描述不想出现的内容..." 
            class="st-chatu8-edit-input" style="resize: vertical; box-sizing: border-box;">${state.negativePrompt || ''}</textarea>
        <div class="ch-autocomplete-results" id="negative-autocomplete"></div>
    `;

    // Strength slider (matching ComfyUI's denoise slider style)
    const strengthContainer = document.createElement('div');
    strengthContainer.className = 'st-chatu8-inpaint-denoise-group';
    strengthContainer.innerHTML = `
        <label class="st-chatu8-inpaint-denoise-label">强度：</label>
        <input type="range" id="novelai-strength" min="0" max="1" step="0.01" value="${state.strength}" 
            class="st-chatu8-inpaint-denoise-slider">
        <span id="strength-value" class="st-chatu8-inpaint-denoise-value">${state.strength.toFixed(2)}</span>
    `;

    container.appendChild(positivePromptContainer);
    container.appendChild(negativePromptContainer);
    container.appendChild(strengthContainer);

    // 绑定事件
    setTimeout(() => {
        const promptTextarea = container.querySelector('#novelai-prompt');
        const negativePromptTextarea = container.querySelector('#novelai-negative-prompt');
        const strengthSlider = container.querySelector('#novelai-strength');
        const strengthValue = container.querySelector('#strength-value');
        const positiveResults = container.querySelector('#positive-autocomplete');
        const negativeResults = container.querySelector('#negative-autocomplete');

        // 更新自动补全位置的辅助函数
        const updateAutocompletePosition = (inputEl, resultsEl) => {
            if (resultsEl.style.display === 'none') return;
            resultsEl.style.top = `${inputEl.offsetTop + inputEl.offsetHeight + 2}px`;
            resultsEl.style.left = `${inputEl.offsetLeft}px`;
            resultsEl.style.width = `${inputEl.offsetWidth}px`;
        };

        // 正面提示词输入事件
        promptTextarea.addEventListener('input', (e) => {
            state.prompt = e.target.value;

            // 实时替换全角逗号为半角逗号
            const originalValue = promptTextarea.value;
            let newValue = originalValue.replace(/，/g, ',');

            if (originalValue !== newValue) {
                const selectionStart = promptTextarea.selectionStart;
                promptTextarea.value = newValue;
                promptTextarea.setSelectionRange(selectionStart, selectionStart);
                state.prompt = newValue;
            }

            // 触发自动补全
            handleAutocomplete(promptTextarea, positiveResults).then(() => {
                updateAutocompletePosition(promptTextarea, positiveResults);
            });
        });

        promptTextarea.addEventListener('blur', () => {
            setTimeout(() => {
                if (!positiveResults.matches(':hover')) {
                    positiveResults.style.display = 'none';
                }
            }, 150);
        });

        // 负面提示词输入事件
        negativePromptTextarea.addEventListener('input', (e) => {
            state.negativePrompt = e.target.value;

            // 实时替换全角逗号为半角逗号
            const originalValue = negativePromptTextarea.value;
            let newValue = originalValue.replace(/，/g, ',');

            if (originalValue !== newValue) {
                const selectionStart = negativePromptTextarea.selectionStart;
                negativePromptTextarea.value = newValue;
                negativePromptTextarea.setSelectionRange(selectionStart, selectionStart);
                state.negativePrompt = newValue;
            }

            // 触发自动补全
            handleAutocomplete(negativePromptTextarea, negativeResults).then(() => {
                updateAutocompletePosition(negativePromptTextarea, negativeResults);
            });
        });

        negativePromptTextarea.addEventListener('blur', () => {
            setTimeout(() => {
                if (!negativeResults.matches(':hover')) {
                    negativeResults.style.display = 'none';
                }
            }, 150);
        });

        // 强度滑块事件
        strengthSlider.addEventListener('input', (e) => {
            state.strength = parseFloat(e.target.value);
            strengthValue.textContent = state.strength.toFixed(2);
        });
    }, 0);

    return container;
}

/**
 * 创建状态显示区域
 * 
 * 创建用于显示错误消息的状态区域，默认隐藏。
 * 
 * @returns {HTMLElement} 状态显示容器元素
 * 
 * @private
 */
function createStatusDiv() {
    const statusDiv = document.createElement('div');
    statusDiv.style.cssText = `
        margin: 0 auto 15px auto;
        padding: 10px;
        background: #ef9a9a;
        color: #c62828;
        border-radius: 4px;
        font-weight: bold;
        text-align: center;
        display: none;
    `;
    return statusDiv;
}

/**
 * 显示错误消息
 * 
 * 在状态区域显示用户友好的错误消息。
 * 
 * @param {HTMLElement} statusDiv - 状态显示区域元素
 * @param {string} message - 错误消息文本
 * 
 * @private
 */
function showError(statusDiv, message) {
    statusDiv.textContent = message;
    statusDiv.style.display = 'block';
}

/**
 * 隐藏错误消息
 * 
 * 隐藏状态区域的错误消息。
 * 
 * @param {HTMLElement} statusDiv - 状态显示区域元素
 * 
 * @private
 */
function hideError(statusDiv) {
    statusDiv.style.display = 'none';
    statusDiv.textContent = '';
}

/**
 * 检测是否为移动设备
 * 
 * 根据视口宽度判断设备类型：
 * - 移动设备：window.innerWidth <= 768
 * - 桌面设备：window.innerWidth > 768
 * 
 * @returns {boolean} 如果是移动设备返回 true
 * 
 * @private
 */
function isMobileDevice() {
    return window.innerWidth <= 768;
}

/**
 * 创建双画布容器（图像层 + 遮罩层）
 * 
 * 完全模仿 HTML 示例的正确做法：
 * - 所有画布使用原始尺寸（canvas.width/height）
 * - 通过 CSS 缩放显示（style.width/height）
 * - 三层画布：图像层 + 显示遮罩层 + 数据遮罩层
 * 
 * @param {HTMLImageElement} img - 原始图片元素
 * @param {boolean} isMobile - 是否为移动设备
 * @returns {Promise<HTMLElement>} 包含三层画布的容器元素
 * 
 * @private
 */
async function createCanvasContainer(img, isMobile) {
    // Load and validate image
    const originalImage = new Image();
    originalImage.crossOrigin = 'anonymous';

    await new Promise((resolve, reject) => {
        originalImage.onload = resolve;
        originalImage.onerror = () => reject(new Error('图片加载失败'));
        originalImage.src = img.src;
    });

    // 原始尺寸
    const originalWidth = originalImage.width;
    const originalHeight = originalImage.height;

    // Calculate responsive display dimensions
    // Mobile: viewport width - 60px (padding + scrollbar)
    // Desktop: max 800px width
    const maxWidth = isMobile
        ? Math.min(originalWidth, window.innerWidth - 60)
        : Math.min(originalWidth, 800);

    const scale = maxWidth / originalWidth;
    const displayWidth = Math.floor(originalWidth * scale);
    const displayHeight = Math.floor(originalHeight * scale);

    console.log('[NovelAI Inpaint] Canvas setup:', {
        original: `${originalWidth}x${originalHeight}`,
        display: `${displayWidth}x${displayHeight}`,
        scale: scale
    });

    // Create canvas container
    const container = document.createElement('div');
    container.style.cssText = `
        position: relative;
        width: ${displayWidth}px;
        height: ${displayHeight}px;
        flex-shrink: 0;
        align-self: center;
        z-index: 0;
        overflow: hidden;
        box-sizing: content-box;
    `;
    container.className = 'st-chatu8-inpaint-editor-container';

    // Layer 1: Image canvas (原始尺寸，CSS 缩放显示)
    const imageCanvas = document.createElement('canvas');
    imageCanvas.width = originalWidth;   // ← 原始尺寸
    imageCanvas.height = originalHeight;
    imageCanvas.style.cssText = `
        position: absolute; 
        top: 0; 
        left: 0;
        width: ${displayWidth}px;    
        height: ${displayHeight}px;
    `;

    const imgCtx = imageCanvas.getContext('2d');
    imgCtx.drawImage(originalImage, 0, 0); // 原始尺寸绘制

    // Layer 2: Display mask canvas (原始尺寸，CSS 缩放，用于视觉显示)
    const displayMaskCanvas = document.createElement('canvas');
    displayMaskCanvas.width = originalWidth;   // ← 原始尺寸
    displayMaskCanvas.height = originalHeight;
    displayMaskCanvas.style.cssText = `
        position: absolute; 
        top: 0; 
        left: 0;
        width: ${displayWidth}px;    
        height: ${displayHeight}px;
        cursor: crosshair; 
        opacity: 0.6;
    `;

    const displayMaskCtx = displayMaskCanvas.getContext('2d', { willReadFrequently: true });
    displayMaskCtx.fillStyle = '#000000';
    displayMaskCtx.fillRect(0, 0, originalWidth, originalHeight);

    // Layer 3: Data mask canvas (原始尺寸，不显示，用于 API 提交)
    const dataMaskCanvas = document.createElement('canvas');
    dataMaskCanvas.width = originalWidth;   // ← 原始尺寸
    dataMaskCanvas.height = originalHeight;
    // 不添加到 DOM，仅用于数据

    const dataMaskCtx = dataMaskCanvas.getContext('2d', { willReadFrequently: true });
    dataMaskCtx.fillStyle = '#000000';
    dataMaskCtx.fillRect(0, 0, originalWidth, originalHeight);

    // Assemble container with proper layering
    container.appendChild(imageCanvas);
    container.appendChild(displayMaskCanvas);

    // Store references for later use
    container.dataset.displayWidth = displayWidth;
    container.dataset.displayHeight = displayHeight;
    container.dataset.originalWidth = originalWidth;
    container.dataset.originalHeight = originalHeight;

    // Store canvas references
    container._imageCanvas = imageCanvas;
    container._displayMaskCanvas = displayMaskCanvas;
    container._dataMaskCanvas = dataMaskCanvas;

    return container;
}
