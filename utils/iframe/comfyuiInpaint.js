// @ts-nocheck
/**
 * ComfyUI 局部重绘模块
 * 包含遮罩编辑器和重绘对话框
 */

import { extension_settings } from '../../../../../extensions.js';
import { extensionName } from '../config.js';
import { addLog, stripChineseAnnotations } from '../utils.js';
import { handleAutocomplete } from './autocomplete.js';
import { createUnifiedDialog, createUnifiedInput, createButtonContainer } from './dialogs.js';

/**
 * 遮罩编辑器类
 */
class MaskEditor {
    constructor(containerEl, imageUrl) {
        this.container = containerEl;
        this.imageUrl = imageUrl;
        this.brushSize = extension_settings[extensionName]?.inpaint_brush_size || 30;
        this.featherRadius = 10; // 羽化半径（默认值 10）
        this.mode = 'draw'; // 'draw' | 'erase'
        this.isDrawing = false;
        this.history = [];
        this.historyIndex = -1;
        this.maxHistory = 20;

        this.init();
    }

    async init() {
        // 创建容器结构
        this.container.style.cssText = 'position: relative; display: flex; flex-direction: column; align-items: center;';

        // 加载原图获取尺寸
        this.originalImage = new Image();
        this.originalImage.crossOrigin = 'anonymous';

        await new Promise((resolve, reject) => {
            this.originalImage.onload = resolve;
            this.originalImage.onerror = reject;
            this.originalImage.src = this.imageUrl;
        });

        // 检测是否为移动设备
        const isMobile = window.top.innerWidth <= 768;

        // 移动端：限制最大宽度为视口宽度减去 padding 和滚动条
        // 桌面端：限制最大宽度为 800px
        const maxWidth = isMobile
            ? Math.min(this.originalImage.width, window.top.innerWidth - 60) // 60px = padding + scrollbar
            : Math.min(this.originalImage.width, 800);

        const scale = maxWidth / this.originalImage.width;
        this.displayWidth = Math.floor(this.originalImage.width * scale);
        this.displayHeight = Math.floor(this.originalImage.height * scale);

        // 创建Canvas容器
        this.canvasContainer = document.createElement('div');
        this.canvasContainer.style.cssText = `position: relative; width: ${this.displayWidth}px; height: ${this.displayHeight}px;`;

        // 原图Canvas（底层）
        this.imageCanvas = document.createElement('canvas');
        this.imageCanvas.width = this.displayWidth;
        this.imageCanvas.height = this.displayHeight;
        this.imageCanvas.style.cssText = 'position: absolute; top: 0; left: 0;';
        const imgCtx = this.imageCanvas.getContext('2d');
        imgCtx.drawImage(this.originalImage, 0, 0, this.displayWidth, this.displayHeight);

        // 遮罩Canvas（上层）
        this.maskCanvas = document.createElement('canvas');
        this.maskCanvas.width = this.displayWidth;
        this.maskCanvas.height = this.displayHeight;
        this.maskCanvas.style.cssText = 'position: absolute; top: 0; left: 0; cursor: crosshair; opacity: 0.6;';
        this.maskCtx = this.maskCanvas.getContext('2d');

        // 初始化为黑色背景
        this.maskCtx.fillStyle = '#000000';
        this.maskCtx.fillRect(0, 0, this.displayWidth, this.displayHeight);

        this.canvasContainer.appendChild(this.imageCanvas);
        this.canvasContainer.appendChild(this.maskCanvas);
        this.container.appendChild(this.canvasContainer);

        // 绑定绘制事件
        this.bindEvents();

        // 保存初始状态
        this.saveState();
    }

    bindEvents() {
        const getPos = (e) => {
            const rect = this.maskCanvas.getBoundingClientRect();
            const clientX = e.touches ? e.touches[0].clientX : e.clientX;
            const clientY = e.touches ? e.touches[0].clientY : e.clientY;
            return {
                x: clientX - rect.left,
                y: clientY - rect.top
            };
        };

        const startDraw = (e) => {
            e.preventDefault();
            this.isDrawing = true;
            this.lastPos = getPos(e);
            this.draw(this.lastPos);
        };

        const draw = (e) => {
            if (!this.isDrawing) return;
            e.preventDefault();
            const pos = getPos(e);
            this.drawLine(this.lastPos, pos);
            this.lastPos = pos;
        };

        const endDraw = (e) => {
            if (this.isDrawing) {
                this.isDrawing = false;
                this.saveState();
            }
        };

        // 鼠标事件
        this.maskCanvas.addEventListener('mousedown', startDraw);
        this.maskCanvas.addEventListener('mousemove', draw);
        this.maskCanvas.addEventListener('mouseup', endDraw);
        this.maskCanvas.addEventListener('mouseleave', endDraw);

        // 触摸事件
        this.maskCanvas.addEventListener('touchstart', startDraw, { passive: false });
        this.maskCanvas.addEventListener('touchmove', draw, { passive: false });
        this.maskCanvas.addEventListener('touchend', endDraw);
        this.maskCanvas.addEventListener('touchcancel', endDraw);
    }

    draw(pos) {
        this.maskCtx.beginPath();
        this.maskCtx.arc(pos.x, pos.y, this.brushSize / 2, 0, Math.PI * 2);
        this.maskCtx.fillStyle = this.mode === 'draw' ? '#FFFFFF' : '#000000';
        this.maskCtx.fill();
    }

    drawLine(from, to) {
        this.maskCtx.beginPath();
        this.maskCtx.moveTo(from.x, from.y);
        this.maskCtx.lineTo(to.x, to.y);
        this.maskCtx.strokeStyle = this.mode === 'draw' ? '#FFFFFF' : '#000000';
        this.maskCtx.lineWidth = this.brushSize;
        this.maskCtx.lineCap = 'round';
        this.maskCtx.lineJoin = 'round';
        this.maskCtx.stroke();
    }

    saveState() {
        // 删除当前位置之后的历史
        this.history = this.history.slice(0, this.historyIndex + 1);
        // 保存当前状态
        this.history.push(this.maskCanvas.toDataURL());
        if (this.history.length > this.maxHistory) {
            this.history.shift();
        }
        this.historyIndex = this.history.length - 1;
    }

    setBrushSize(size) {
        this.brushSize = Math.max(5, Math.min(100, size));
    }

    /**
     * 设置羽化半径
     * @param {number} radius - 羽化半径（0-50像素）
     */
    setFeatherRadius(radius) {
        this.featherRadius = Math.max(0, Math.min(50, radius));
    }

    setMode(mode) {
        this.mode = mode; // 'draw' | 'erase'
    }

    undo() {
        if (this.historyIndex > 0) {
            this.historyIndex--;
            this.restoreState(this.history[this.historyIndex]);
        }
    }

    redo() {
        if (this.historyIndex < this.history.length - 1) {
            this.historyIndex++;
            this.restoreState(this.history[this.historyIndex]);
        }
    }

    restoreState(dataUrl) {
        const img = new Image();
        img.onload = () => {
            this.maskCtx.clearRect(0, 0, this.displayWidth, this.displayHeight);
            this.maskCtx.drawImage(img, 0, 0);
        };
        img.src = dataUrl;
    }

    clear() {
        this.maskCtx.fillStyle = '#000000';
        this.maskCtx.fillRect(0, 0, this.displayWidth, this.displayHeight);
        this.saveState();
    }

    /**
     * 获取原图Blob（按原始尺寸）
     */
    async getOriginalBlob() {
        const canvas = document.createElement('canvas');
        canvas.width = this.originalImage.width;
        canvas.height = this.originalImage.height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(this.originalImage, 0, 0);

        return new Promise(resolve => {
            canvas.toBlob(resolve, 'image/png');
        });
    }

    /**
     * 对遮罩应用向外羽化（膨胀+渐变）
     * @param {HTMLCanvasElement} sourceCanvas - 源遮罩画布
     * @param {number} radius - 羽化半径
     * @returns {HTMLCanvasElement} 羽化后的画布
     */
    applyGaussianBlur(sourceCanvas, radius) {
        try {
            if (radius === 0) return sourceCanvas;

            const width = sourceCanvas.width;
            const height = sourceCanvas.height;

            // 获取源画布数据
            const srcCtx = sourceCanvas.getContext('2d');
            const srcData = srcCtx.getImageData(0, 0, width, height);
            const src = srcData.data;

            // 创建输出画布
            const canvas = document.createElement('canvas');
            canvas.width = width;
            canvas.height = height;
            const ctx = canvas.getContext('2d');
            const dstData = ctx.createImageData(width, height);
            const dst = dstData.data;

            // 计算距离场：每个像素到最近白色像素的距离
            const distanceField = new Float32Array(width * height);
            const maxDist = radius;

            // 初始化距离场
            for (let i = 0; i < distanceField.length; i++) {
                distanceField[i] = maxDist + 1;
            }

            // 第一遍：找到所有白色像素（遮罩内部）
            const whitePixels = [];
            for (let y = 0; y < height; y++) {
                for (let x = 0; x < width; x++) {
                    const idx = (y * width + x) * 4;
                    const brightness = src[idx]; // R通道

                    if (brightness > 128) { // 白色像素
                        whitePixels.push({ x, y });
                        distanceField[y * width + x] = 0;
                    }
                }
            }

            // 第二遍：计算每个非白色像素到最近白色像素的距离
            for (let y = 0; y < height; y++) {
                for (let x = 0; x < width; x++) {
                    const idx = y * width + x;

                    if (distanceField[idx] === 0) continue; // 已经是白色

                    let minDist = maxDist + 1;

                    // 只检查附近的像素（优化性能）
                    const searchRadius = Math.min(maxDist + 1, Math.max(width, height));
                    for (let dy = -searchRadius; dy <= searchRadius; dy++) {
                        for (let dx = -searchRadius; dx <= searchRadius; dx++) {
                            const nx = x + dx;
                            const ny = y + dy;

                            if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;

                            const nidx = ny * width + nx;
                            if (distanceField[nidx] === 0) {
                                const dist = Math.sqrt(dx * dx + dy * dy);
                                minDist = Math.min(minDist, dist);
                            }
                        }
                    }

                    distanceField[idx] = minDist;
                }
            }

            // 第三遍：根据距离场生成羽化遮罩
            for (let y = 0; y < height; y++) {
                for (let x = 0; x < width; x++) {
                    const idx = (y * width + x) * 4;
                    const dist = distanceField[y * width + x];

                    let alpha;
                    if (dist === 0) {
                        // 遮罩内部：完全白色
                        alpha = 255;
                    } else if (dist <= maxDist) {
                        // 羽化区域：根据距离线性渐变
                        alpha = Math.round(255 * (1 - dist / maxDist));
                    } else {
                        // 外部区域：完全黑色
                        alpha = 0;
                    }

                    dst[idx] = alpha;     // R
                    dst[idx + 1] = alpha; // G
                    dst[idx + 2] = alpha; // B
                    dst[idx + 3] = 255;   // A
                }
            }

            ctx.putImageData(dstData, 0, 0);
            return canvas;

        } catch (err) {
            console.error('[Feathering] 羽化处理失败:', err);
            addLog('[Feathering] 羽化处理失败，使用原始遮罩');
            // 降级：返回原始画布
            return sourceCanvas;
        }
    }

    /**
     * 获取羽化后的遮罩Blob（按原始尺寸）
     */
    async getMaskBlobWithFeathering() {
        // 创建临时画布，缩放到原始尺寸
        const tempCanvas = document.createElement('canvas');
        tempCanvas.width = this.originalImage.width;
        tempCanvas.height = this.originalImage.height;
        const tempCtx = tempCanvas.getContext('2d');
        tempCtx.drawImage(this.maskCanvas, 0, 0, this.originalImage.width, this.originalImage.height);

        // 应用羽化
        const featheredCanvas = this.applyGaussianBlur(tempCanvas, this.featherRadius);

        return new Promise(resolve => {
            featheredCanvas.toBlob(resolve, 'image/png');
        });
    }

    /**
     * 获取遮罩Blob（按原始尺寸缩放）
     */
    async getMaskBlob() {
        return this.getMaskBlobWithFeathering();
    }

    destroy() {
        this.container.innerHTML = '';
    }
}

/**
 * Helper function to detect mobile devices
 * @returns {boolean} True if mobile device
 */
function isMobileDevice() {
    return window.top.innerWidth <= 768 ||
        /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
}

/**
 * Create responsive toolbar container
 * @param {boolean} isMobile - Whether device is mobile
 * @param {HTMLElement} toolbar - Toolbar element
 * @param {HTMLElement} denoiseGroup - Denoise slider group element
 * @returns {HTMLElement} Container element
 */
function createToolbarContainer(isMobile, toolbar, denoiseGroup) {
    const container = document.createElement('div');
    container.className = 'st-chatu8-inpaint-toolbar-container';

    if (isMobile) {
        container.classList.add('mobile');
        // Max height will be set dynamically based on available space
    } else {
        container.classList.add('desktop');
    }

    container.appendChild(toolbar);
    container.appendChild(denoiseGroup);

    return container;
}

/**
 * Calculate maximum height for toolbar container on mobile
 * @param {HTMLElement} dialog - Dialog element
 * @param {HTMLElement} editorContainer - Canvas editor container
 * @param {HTMLElement} promptSection - Prompt section element
 * @param {HTMLElement} buttonContainer - Button container element
 * @returns {number} Maximum height in pixels
 */
function calculateToolbarMaxHeight(dialog, editorContainer, promptSection, buttonContainer) {
    // Get actual heights of elements, with fallbacks if elements don't exist
    const dialogHeight = dialog?.clientHeight || 0;
    const editorHeight = editorContainer?.clientHeight || 0;
    const promptHeight = promptSection?.clientHeight || 0;
    const buttonHeight = buttonContainer?.clientHeight || 0;

    // Approximate title height and padding/margins
    const titleHeight = 50;
    const padding = 40;

    // Calculate available height
    const availableHeight = dialogHeight - editorHeight - promptHeight - buttonHeight - titleHeight - padding;

    // Ensure minimum height of 100px
    return Math.max(100, availableHeight);
}

/**
 * 显示ComfyUI局部重绘对话框
 * @param {HTMLImageElement} img - 要重绘的图片元素
 * @param {HTMLElement} button - 触发按钮元素
 */
export async function showComfyUIInpaintDialog(img, button) {
    const doc = document;
    const isMobile = isMobileDevice();

    // --- 使用统一对话框工厂函数创建对话框 ---
    const { backdrop, dialog, closeDialog } = createUnifiedDialog({
        title: '🎨 ComfyUI 局部重绘',
        isMobile: isMobile
    });

    // 编辑器容器
    const editorContainer = doc.createElement('div');
    editorContainer.id = 'inpaint-editor-container';
    editorContainer.className = 'st-chatu8-inpaint-editor-container';
    dialog.appendChild(editorContainer);

    // 读取保存的配置（使用默认值作为降级）
    const savedPositive = extension_settings[extensionName]?.inpaint_positive_prompt || '';
    const savedNegative = extension_settings[extensionName]?.inpaint_negative_prompt || '';
    const savedDenoise = extension_settings[extensionName]?.inpaint_denoise || '0.75';
    const savedFeatherRadius = extension_settings[extensionName]?.inpaint_feather_radius || 0;

    // 工具栏
    const toolbar = doc.createElement('div');
    toolbar.className = 'st-chatu8-inpaint-toolbar';
    toolbar.innerHTML = `
        <button id="tool-draw" class="st-chatu8-tool-btn active" title="画笔">🖌️ 画笔</button>
        <button id="tool-erase" class="st-chatu8-tool-btn" title="橡皮">🧽 橡皮</button>
        <button id="tool-undo" class="st-chatu8-tool-btn" title="撤销">⤺ 撤销</button>
        <button id="tool-redo" class="st-chatu8-tool-btn" title="重做">⤻ 重做</button>
        <button id="tool-clear" class="st-chatu8-tool-btn" title="清空">🗑️ 清空</button>
        <label class="st-chatu8-inpaint-brush-label">
            画笔大小: <input type="range" id="brush-size" min="5" max="100" value="30" class="st-chatu8-inpaint-brush-slider">
            <span id="brush-size-value">30</span>px
        </label>
        <label class="st-chatu8-inpaint-brush-label">
            羽化强度: <input type="range" id="feather-radius" min="0" max="50" value="${savedFeatherRadius}" class="st-chatu8-inpaint-brush-slider">
            <span id="feather-radius-value">${savedFeatherRadius}</span>px
        </label>
    `;

    // 样式
    const style = doc.createElement('style');
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
        
        /* Ensure toolbar items wrap properly */
        .st-chatu8-inpaint-toolbar {
            flex-wrap: wrap;
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
    `;
    dialog.appendChild(style);

    // Denoise slider group HTML (to be added to toolbar container)
    const denoiseGroupHTML = `
        <div class="st-chatu8-inpaint-denoise-group">
            <label class="st-chatu8-inpaint-denoise-label">重绘幅度：</label>
            <input type="range" id="inpaint-denoise" min="0" max="1" step="0.05" value="${savedDenoise}" 
                class="st-chatu8-inpaint-denoise-slider">
            <span id="denoise-value" class="st-chatu8-inpaint-denoise-value">${savedDenoise}</span>
        </div>
    `;

    // Create denoise group element
    const denoiseGroup = doc.createElement('div');
    denoiseGroup.innerHTML = denoiseGroupHTML;

    // Create toolbar container with toolbar and denoise group
    const toolbarContainer = createToolbarContainer(isMobile, toolbar, denoiseGroup);
    dialog.appendChild(toolbarContainer);

    // Prompt section (without denoise slider)
    const promptSection = doc.createElement('div');
    promptSection.className = 'st-chatu8-inpaint-prompt-section';
    promptSection.innerHTML = `
        <div class="st-chatu8-inpaint-prompt-group">
            <label>正面提示词（可选）：</label>
            <textarea id="inpaint-positive-prompt" rows="2" placeholder="描述重绘区域想要的内容..."
                class="st-chatu8-edit-input">${savedPositive}</textarea>
            <div class="ch-autocomplete-results" id="positive-autocomplete"></div>
        </div>
        <div class="st-chatu8-inpaint-prompt-group">
            <label>负面提示词（可选）：</label>
            <textarea id="inpaint-negative-prompt" rows="2" placeholder="描述不想出现的内容..."
                class="st-chatu8-edit-input">${savedNegative}</textarea>
            <div class="ch-autocomplete-results" id="negative-autocomplete"></div>
        </div>
    `;
    dialog.appendChild(promptSection);

    // 按钮区 - 使用统一按钮容器创建函数
    const submitHandler = async () => {
        try {
            // 获取提示词并去除中文括号
            const positivePrompt = stripChineseAnnotations(dialog.querySelector('#inpaint-positive-prompt').value.trim());
            const negativePrompt = stripChineseAnnotations(dialog.querySelector('#inpaint-negative-prompt').value.trim());
            const denoise = parseFloat(dialog.querySelector('#inpaint-denoise').value);
            const submitBtn = dialog.querySelector('#inpaint-submit');
            submitBtn.disabled = true;
            submitBtn.textContent = '上传中...';

            // 获取Blob
            const originalBlob = await editor.getOriginalBlob();
            const maskBlob = await editor.getMaskBlob();

            addLog('[Inpaint] 准备上传图片和遮罩到ComfyUI...');

            // 上传到ComfyUI
            const comfyuiUrl = extension_settings[extensionName]?.comfyuiUrl?.trim();
            if (!comfyuiUrl) {
                throw new Error('请先在设置中配置ComfyUI地址');
            }

            const imageName = await uploadToComfyUI(originalBlob, 'inpaint_image.png', comfyuiUrl);
            const maskName = await uploadToComfyUI(maskBlob, 'inpaint_mask.png', comfyuiUrl);

            addLog(`[Inpaint] 上传成功: image=${imageName}, mask=${maskName}`);

            // 存储服务器文件名到window（供comfyui.js使用）
            window.comfyuiInpaintImage = imageName;
            window.comfyuiInpaintMask = maskName;

            // 存储提示词和重绘幅度到window
            window.comfyuiInpaintPositivePrompt = positivePrompt;
            window.comfyuiInpaintNegativePrompt = negativePrompt;
            window.comfyuiInpaintDenoise = denoise;

            // 保存配置到设置（便于下次使用）
            if (extension_settings[extensionName]) {
                extension_settings[extensionName].inpaint_positive_prompt = positivePrompt;
                extension_settings[extensionName].inpaint_negative_prompt = negativePrompt;
                extension_settings[extensionName].inpaint_denoise = denoise.toString();
            }

            // 标记为ComfyUI局部重绘模式（支持跨模式转发）
            const currentChange = button.dataset.change || '';
            if (!currentChange.includes('{ComfyUI局部重绘}')) {
                button.dataset.change = currentChange + ' {ComfyUI局部重绘}';
            }

            addLog('[Inpaint] 准备触发生成');

            // 关闭对话框
            closeDialog();

            // 触发生成
            button.click();

        } catch (err) {
            console.error('发送重绘失败:', err);
            addLog(`[Inpaint] 发送失败: ${err.message}`);
            const submitBtn = dialog.querySelector('#inpaint-submit');
            submitBtn.disabled = false;
            submitBtn.textContent = '发送重绘';
            if (typeof toastr !== 'undefined') {
                toastr.error('发送重绘失败: ' + err.message);
            }
        }
    };

    const buttonContainer = createButtonContainer([
        {
            text: '发送重绘',
            className: 'send',
            onClick: submitHandler
        },
        {
            text: '取消',
            className: 'cancel',
            onClick: closeDialog
        }
    ]);
    buttonContainer.querySelector('.st-chatu8-edit-button.send').id = 'inpaint-submit';
    dialog.appendChild(buttonContainer);

    backdrop.appendChild(dialog);
    doc.body.appendChild(backdrop);

    // 桌面端：根据图片宽度调整对话框宽度（在编辑器初始化后）
    // 手机端：不需要为工具栏容器设置单独的滚动条，使用对话框的统一滚动

    // 初始化遮罩编辑器
    let editor = null;
    try {
        editor = new MaskEditor(editorContainer, img.src);
        await new Promise(resolve => setTimeout(resolve, 100)); // 等待初始化

        // 设置保存的羽化半径
        editor.setFeatherRadius(savedFeatherRadius);

        // 根据图片显示宽度调整对话框宽度（桌面端）
        if (!isMobile && editor.displayWidth) {
            // 对话框宽度 = 图片宽度 + padding (20px * 2) + 一些额外空间
            const dialogWidth = editor.displayWidth + 60; // 40px padding + 20px extra
            dialog.style.width = `${dialogWidth}px`;
            dialog.style.maxWidth = '95vw'; // 确保不超过视口宽度
        }
    } catch (err) {
        console.error('遮罩编辑器初始化失败:', err);
        addLog(`[Inpaint] 编辑器初始化失败: ${err.message}`);
        backdrop.remove();
        if (typeof toastr !== 'undefined') {
            toastr.error('遮罩编辑器初始化失败');
        }
        return;
    }

    // 工具栏事件
    const drawBtn = dialog.querySelector('#tool-draw');
    const eraseBtn = dialog.querySelector('#tool-erase');
    const brushSizeInput = dialog.querySelector('#brush-size');
    const brushSizeValue = dialog.querySelector('#brush-size-value');

    drawBtn.onclick = () => {
        editor.setMode('draw');
        drawBtn.classList.add('active');
        eraseBtn.classList.remove('active');
    };

    eraseBtn.onclick = () => {
        editor.setMode('erase');
        eraseBtn.classList.add('active');
        drawBtn.classList.remove('active');
    };

    dialog.querySelector('#tool-undo').onclick = () => editor.undo();
    dialog.querySelector('#tool-redo').onclick = () => editor.redo();
    dialog.querySelector('#tool-clear').onclick = () => editor.clear();

    brushSizeInput.oninput = (e) => {
        const size = parseInt(e.target.value);
        editor.setBrushSize(size);
        brushSizeValue.textContent = size;
    };

    // 羽化强度滑块事件
    const featherInput = dialog.querySelector('#feather-radius');
    const featherValue = dialog.querySelector('#feather-radius-value');
    featherInput.oninput = (e) => {
        const radius = parseInt(e.target.value);
        editor.setFeatherRadius(radius);
        featherValue.textContent = radius;

        // 保存到设置
        if (extension_settings[extensionName]) {
            extension_settings[extensionName].inpaint_feather_radius = radius;
        }
    };

    // 重绘幅度滑块事件
    const denoiseInput = dialog.querySelector('#inpaint-denoise');
    const denoiseValue = dialog.querySelector('#denoise-value');
    denoiseInput.oninput = (e) => {
        const value = parseFloat(e.target.value);
        denoiseValue.textContent = value.toFixed(2);
    };

    // 自动补全功能
    const positiveInput = dialog.querySelector('#inpaint-positive-prompt');
    const negativeInput = dialog.querySelector('#inpaint-negative-prompt');
    const positiveResults = dialog.querySelector('#positive-autocomplete');
    const negativeResults = dialog.querySelector('#negative-autocomplete');

    // 更新自动补全位置的辅助函数
    const updateAutocompletePosition = (inputEl, resultsEl) => {
        if (resultsEl.style.display === 'none') return;
        resultsEl.style.top = `${inputEl.offsetTop + inputEl.offsetHeight + 2}px`;
        resultsEl.style.left = `${inputEl.offsetLeft}px`;
        resultsEl.style.width = `${inputEl.offsetWidth}px`;
    };

    // 正面提示词自动补全
    positiveInput.addEventListener('input', () => {
        // 实时替换全角逗号为半角逗号
        const originalValue = positiveInput.value;
        let newValue = originalValue.replace(/，/g, ',');

        if (originalValue !== newValue) {
            const selectionStart = positiveInput.selectionStart;
            positiveInput.value = newValue;
            positiveInput.setSelectionRange(selectionStart, selectionStart);
        }
        handleAutocomplete(positiveInput, positiveResults).then(() => {
            updateAutocompletePosition(positiveInput, positiveResults);
        });
    });

    positiveInput.addEventListener('blur', () => {
        setTimeout(() => {
            if (!positiveResults.matches(':hover')) {
                positiveResults.style.display = 'none';
            }
        }, 150);
    });

    // 负面提示词自动补全
    negativeInput.addEventListener('input', () => {
        // 实时替换全角逗号为半角逗号
        const originalValue = negativeInput.value;
        let newValue = originalValue.replace(/，/g, ',');

        if (originalValue !== newValue) {
            const selectionStart = negativeInput.selectionStart;
            negativeInput.value = newValue;
            negativeInput.setSelectionRange(selectionStart, selectionStart);
        }
        handleAutocomplete(negativeInput, negativeResults).then(() => {
            updateAutocompletePosition(negativeInput, negativeResults);
        });
    });

    negativeInput.addEventListener('blur', () => {
        setTimeout(() => {
            if (!negativeResults.matches(':hover')) {
                negativeResults.style.display = 'none';
            }
        }, 150);
    });

    // // 关闭/取消
    // const closeDialog = () => {
    //     editor?.destroy();
    //     overlay.remove();
    // };

    dialog.querySelector('#inpaint-close').onclick = closeDialog;
    dialog.querySelector('#inpaint-cancel').onclick = closeDialog;
    overlay.onclick = (e) => {
        if (e.target === overlay) closeDialog();
    };

    // 发送重绘
    dialog.querySelector('#inpaint-submit').onclick = async () => {
        try {
            // 获取提示词并去除中文括号
            const positivePrompt = stripChineseAnnotations(dialog.querySelector('#inpaint-positive-prompt').value.trim());
            const negativePrompt = stripChineseAnnotations(dialog.querySelector('#inpaint-negative-prompt').value.trim());
            const denoise = parseFloat(dialog.querySelector('#inpaint-denoise').value);
            const submitBtn = dialog.querySelector('#inpaint-submit');
            submitBtn.disabled = true;
            submitBtn.textContent = '上传中...';

            // 获取Blob
            const originalBlob = await editor.getOriginalBlob();
            const maskBlob = await editor.getMaskBlob();

            addLog('[Inpaint] 准备上传图片和遮罩到ComfyUI...');

            // 上传到ComfyUI
            const comfyuiUrl = extension_settings[extensionName]?.comfyuiUrl?.trim();
            if (!comfyuiUrl) {
                throw new Error('请先在设置中配置ComfyUI地址');
            }

            const imageName = await uploadToComfyUI(originalBlob, 'inpaint_image.png', comfyuiUrl);
            const maskName = await uploadToComfyUI(maskBlob, 'inpaint_mask.png', comfyuiUrl);

            addLog(`[Inpaint] 上传成功: image=${imageName}, mask=${maskName}`);

            // 存储服务器文件名到window（供comfyui.js使用）
            window.comfyuiInpaintImage = imageName;
            window.comfyuiInpaintMask = maskName;

            // 存储提示词和重绘幅度到window
            window.comfyuiInpaintPositivePrompt = positivePrompt;
            window.comfyuiInpaintNegativePrompt = negativePrompt;
            window.comfyuiInpaintDenoise = denoise;

            // 保存配置到设置（便于下次使用）
            if (extension_settings[extensionName]) {
                extension_settings[extensionName].inpaint_positive_prompt = positivePrompt;
                extension_settings[extensionName].inpaint_negative_prompt = negativePrompt;
                extension_settings[extensionName].inpaint_denoise = denoise.toString();
            }

            // 标记为ComfyUI局部重绘模式（支持跨模式转发）
            const currentChange = button.dataset.change || '';
            if (!currentChange.includes('{ComfyUI局部重绘}')) {
                button.dataset.change = currentChange + ' {ComfyUI局部重绘}';
            }

            addLog('[Inpaint] 准备触发生成');

            // 关闭对话框
            closeDialog();

            // 触发生成
            button.click();

        } catch (err) {
            console.error('发送重绘失败:', err);
            addLog(`[Inpaint] 发送失败: ${err.message}`);
            const submitBtn = dialog.querySelector('#inpaint-submit');
            submitBtn.disabled = false;
            submitBtn.textContent = '发送重绘';
            if (typeof toastr !== 'undefined') {
                toastr.error('发送重绘失败: ' + err.message);
            }
        }
    };
}

/**
 * 上传图片到ComfyUI
 */
async function uploadToComfyUI(blob, filename, comfyuiUrl) {
    const formData = new FormData();
    formData.append('image', blob, filename);

    const response = await fetch(`${comfyuiUrl}/upload/image`, {
        method: 'POST',
        body: formData
    });

    if (!response.ok) {
        const text = await response.text();
        throw new Error(`上传失败: ${text}`);
    }

    const result = await response.json();
    return result.name;
}

/**
 * Blob转Base64
 */
function blobToBase64(blob) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result);
        reader.onerror = reject;
        reader.readAsDataURL(blob);
    });
}
