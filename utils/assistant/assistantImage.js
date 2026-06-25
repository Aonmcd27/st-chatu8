/**
 * assistantImage.js
 * 
 * 图片上传、粘贴、预览、清空等功能。
 */

import { dom, selectedImages, setSelectedImages } from './assistantContext.js';
import { escapeHTML } from './assistantUtils.js';

// ═══════════════════════════════════════════════════════════
//  图片预览渲染
// ═══════════════════════════════════════════════════════════

/**
 * 渲染图片预览区域
 */
export function renderImagePreview() {
    dom.imagePreview.empty();

    if (selectedImages.length === 0) {
        dom.imagePreview.hide();
        return;
    }

    dom.imagePreview.show();

    selectedImages.forEach((img, index) => {
        const previewItem = $(`
            <div class="st-chatu8-ai-image-preview-item">
                <img src="${img.data}" alt="${escapeHTML(img.name)}" />
                <button class="st-chatu8-ai-image-remove" data-index="${index}" title="移除图片">
                    <i class="fa-solid fa-times"></i>
                </button>
            </div>
        `);

        previewItem.find('.st-chatu8-ai-image-remove').on('click', function () {
            const idx = parseInt($(this).data('index'));
            selectedImages.splice(idx, 1);
            renderImagePreview();
        });

        dom.imagePreview.append(previewItem);
    });
}

// ═══════════════════════════════════════════════════════════
//  清空图片选择
// ═══════════════════════════════════════════════════════════

/**
 * 清空已选择的图片
 */
export function clearImageSelection() {
    setSelectedImages([]);
    renderImagePreview();
}

// ═══════════════════════════════════════════════════════════
//  初始化图片事件
// ═══════════════════════════════════════════════════════════

/**
 * 初始化图片上传和粘贴相关事件
 */
export function initImageEvents() {
    // 图片按钮点击事件
    dom.imageBtn.on('click', function () {
        dom.imageInput.click();
    });

    // 图片选择事件
    dom.imageInput.on('change', function (e) {
        const files = Array.from(e.target.files);
        if (files.length === 0) return;

        files.forEach(file => {
            if (!file.type.startsWith('image/')) {
                toastr?.warning(`文件 ${file.name} 不是图片格式`);
                return;
            }

            const reader = new FileReader();
            reader.onload = function (event) {
                const imageData = {
                    name: file.name,
                    type: file.type,
                    data: event.target.result
                };
                selectedImages.push(imageData);
                renderImagePreview();
            };
            reader.readAsDataURL(file);
        });

        // 清空 input 以允许重复选择同一文件
        dom.imageInput.val('');
    });

    // 输入框粘贴图片事件
    dom.inputArea.on('paste', function (e) {
        const clipboardData = e.originalEvent.clipboardData || window.clipboardData;
        if (!clipboardData) return;

        const items = clipboardData.items;
        if (!items) return;

        let hasImage = false;

        for (let i = 0; i < items.length; i++) {
            const item = items[i];

            if (item.type.startsWith('image/')) {
                hasImage = true;
                e.preventDefault();

                const file = item.getAsFile();
                if (!file) continue;

                const reader = new FileReader();
                reader.onload = function (event) {
                    const imageData = {
                        name: `粘贴图片_${Date.now()}.${file.type.split('/')[1] || 'png'}`,
                        type: file.type,
                        data: event.target.result
                    };
                    selectedImages.push(imageData);
                    renderImagePreview();
                    toastr?.success('图片已添加');
                };
                reader.readAsDataURL(file);
            }
        }
    });
}
