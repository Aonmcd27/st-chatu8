// @ts-nocheck
import { extension_settings } from "../../../../../extensions.js";
import { saveSettingsDebounced } from "../../../../../../script.js";
import { extensionName } from '../config.js';
import { processUploadedImage, processUploadedImageToBlob, addLog } from '../utils.js';
import { dbs } from '../database.js';

// Keys for IndexedDB cache
const NAI_VIBE_CACHE_KEY = 'cache_novelai_vibe_transfer_image';
const NAI_CHAR_REF_CACHE_KEY = 'cache_novelai_char_ref_image';
const COMFYUI_REF_CACHE_KEY = 'cache_comfyui_ref_image';

// Globals to hold image data during session
let nai3VibeTransferImageMimeType = 'image/png';
let nai3CharRefImageMimeType = 'image/png';
let comfyuiImageObjectURL = null;

function updateNovelaiImagePreview(src) {
    const previewImg = document.getElementById('previewImage_novelai');
    const placeholder = document.querySelector('#novelai-image-preview-container .st-chatu8-image-placeholder');
    const removeBtn = document.getElementById('novelai-remove-image-btn');

    if (src && src.startsWith('data:image')) {
        previewImg.src = src;
        previewImg.style.display = 'block';
        placeholder.style.display = 'none';
        removeBtn.style.display = 'inline-flex';
        const parts = src.split(',');
        const meta = parts[0].split(':')[1].split(';')[0];
        nai3VibeTransferImageMimeType = meta;
        window.nai3VibeTransferImage = parts[1];
        dbs.storeReadWrite({ id: NAI_VIBE_CACHE_KEY, data: src });
    } else {
        previewImg.src = '';
        previewImg.style.display = 'none';
        placeholder.style.display = 'flex';
        removeBtn.style.display = 'none';
        window.nai3VibeTransferImage = null;
    }
}

function removeNovelaiImage() {
    updateNovelaiImagePreview(null);
    dbs.storeDelete(NAI_VIBE_CACHE_KEY);
}

async function handleNovelaiImageUpload(event) {
    const file = event.target.files[0];
    if (!file) return;
    try {
        const base64Image = await processUploadedImage(file, true);
        updateNovelaiImagePreview(base64Image);
    } catch (error) {
        console.error("Error processing NovelAI image:", error);
        alert("图片处理失败: " + error.message);
    }
}

function updateNovelaiCharRefImagePreview(src) {
    const previewImg = document.getElementById('previewImage_nai_char_ref');
    const placeholder = document.querySelector('#novelai-char-ref-image-preview-container .st-chatu8-image-placeholder');
    const removeBtn = document.getElementById('novelai-remove-char-ref-image-btn');

    // Check if elements exist (they were removed in the new character reference system)
    if (!previewImg || !placeholder || !removeBtn) {
        console.log('[CharRef] Old character reference UI elements not found - using new system');
        return;
    }

    if (src && src.startsWith('data:image')) {
        previewImg.src = src;
        previewImg.style.display = 'block';
        placeholder.style.display = 'none';
        removeBtn.style.display = 'inline-flex';
        const parts = src.split(',');
        const meta = parts[0].split(':')[1].split(';')[0];
        nai3CharRefImageMimeType = meta;
        window.nai3CharRefImage = parts[1];
        dbs.storeReadWrite({ id: NAI_CHAR_REF_CACHE_KEY, data: src });
    } else {
        previewImg.src = '';
        previewImg.style.display = 'none';
        placeholder.style.display = 'flex';
        removeBtn.style.display = 'none';
        window.nai3CharRefImage = null;
    }
}

function removeNovelaiCharRefImage() {
    updateNovelaiCharRefImagePreview(null);
    dbs.storeDelete(NAI_CHAR_REF_CACHE_KEY);
}

async function handleNovelaiCharRefImageUpload(event) {
    const file = event.target.files[0];
    if (!file) return;
    try {
        const base64Image = await processUploadedImage(file);
        updateNovelaiCharRefImagePreview(base64Image);
    } catch (error) {
        console.error("Error processing NovelAI char ref image:", error);
        alert("图片处理失败: " + error.message);
    }
}

function updateComfyUIImagePreview(src) {
    const previewImg = document.getElementById('previewImage2');
    const placeholder = document.querySelector('#comfyui-image-preview-container .st-chatu8-image-placeholder');
    const removeBtn = document.getElementById('comfyui-remove-image-btn');

    if (previewImg.src && previewImg.src.startsWith('blob:') && previewImg.src !== src) {
        URL.revokeObjectURL(previewImg.src);
    }

    if (src) {
        previewImg.src = src;
        previewImg.style.display = 'block';
        placeholder.style.display = 'none';
        removeBtn.style.display = 'inline-flex';
    } else {
        previewImg.src = '';
        previewImg.style.display = 'none';
        placeholder.style.display = 'flex';
        removeBtn.style.display = 'none';
        window.comfyuicankaotupian = null;
        comfyuiImageObjectURL = null;
    }
}

function removeComfyUIImage() {
    updateComfyUIImagePreview(null);
    dbs.storeDelete(COMFYUI_REF_CACHE_KEY);
}

async function handleImageUpload2(event) {
    const settings = extension_settings[extensionName];
    const file = event.target.files[0];
    if (!file) return;

    try {
        const imageBlob = await processUploadedImageToBlob(file);
        const objectURL = URL.createObjectURL(imageBlob);
        comfyuiImageObjectURL = objectURL;
        updateComfyUIImagePreview(objectURL);

        const formData = new FormData();
        formData.append('image', imageBlob, file.name);

        let url111 = settings.comfyuiUrl.trim();
        if (!url111) {
            alert("请先设置ComfyUI API地址。");
            removeComfyUIImage();
            return;
        }

        const response = await fetch(`${url111}/upload/image`, {
            method: 'POST',
            body: formData,
        });

        if (response.ok) {
            const result = await response.json();
            window.comfyuicankaotupian = result.name;
            addLog(`图片上传成功, 服务器返回数据: ${JSON.stringify(result)}`);
            console.log("上传成功, 服务器返回数据:", result);

            // Cache the image data and the server-returned filename
            const reader = new FileReader();
            reader.onloadend = () => {
                const base64data = reader.result;
                const cachePayload = { data: base64data, serverFileName: result.name };
                dbs.storeReadWrite({ id: COMFYUI_REF_CACHE_KEY, data: cachePayload });
            };
            reader.readAsDataURL(imageBlob);
        } else {
            const errorText = await response.text();
            alert("上传失败: " + errorText);
            addLog(`图片上传失败, 错误详情: ${errorText}`);
            console.error("错误详情:", errorText);
            removeComfyUIImage();
        }
    } catch (error) {
        alert("图片处理或上传时出错: " + error.message);
        console.error("图片处理或上传时出错:", error);
        addLog(`图片上传失败, 错误详情: ${JSON.stringify(error)}`);
        removeComfyUIImage();
    }
}

async function loadCachedImages() {
    await dbs.openDB(); // Ensure DB is open

    // Load NovelAI Vibe Transfer Image
    try {
        const naiVibeRecord = await dbs.storeReadOnly(NAI_VIBE_CACHE_KEY);
        if (naiVibeRecord && naiVibeRecord.data) {
            updateNovelaiImagePreview(naiVibeRecord.data);
        }
    } catch (error) {
        console.error("Error loading cached NovelAI Vibe image:", error);
    }

    // Load NovelAI Char Ref Image
    try {
        const naiCharRefRecord = await dbs.storeReadOnly(NAI_CHAR_REF_CACHE_KEY);
        if (naiCharRefRecord && naiCharRefRecord.data) {
            updateNovelaiCharRefImagePreview(naiCharRefRecord.data);
        }
    } catch (error) {
        console.error("Error loading cached NovelAI Char Ref image:", error);
    }

    // Load ComfyUI Image
    try {
        const comfyRecord = await dbs.storeReadOnly(COMFYUI_REF_CACHE_KEY);
        // Check for the new cache structure
        if (comfyRecord && comfyRecord.data && comfyRecord.data.data && comfyRecord.data.serverFileName) {
            const cachePayload = comfyRecord.data;

            // Restore preview from base64 data
            const res = await fetch(cachePayload.data);
            const blob = await res.blob();
            const objectURL = URL.createObjectURL(blob);
            updateComfyUIImagePreview(objectURL);
            comfyuiImageObjectURL = objectURL;

            // Restore server filename
            window.comfyuicankaotupian = cachePayload.serverFileName;
            addLog(`从缓存加载ComfyUI图片: ${cachePayload.serverFileName}`);
            console.log(`Loaded ComfyUI image from cache: ${cachePayload.serverFileName}`);
        }
        // Backward compatibility for old cache format
        else if (comfyRecord && typeof comfyRecord.data === 'string') {
            const res = await fetch(comfyRecord.data);
            const blob = await res.blob();
            const objectURL = URL.createObjectURL(blob);
            updateComfyUIImagePreview(objectURL);
            comfyuiImageObjectURL = objectURL;
            console.warn("Loaded ComfyUI image from old cache format. Please re-upload to update cache to the new format.");
        }
    } catch (error) {
        console.error("Error loading cached ComfyUI image:", error);
    }
}

export function initImageUpload(settingsModal) {
    // Load cached images on init
    loadCachedImages();

    // NovelAI Image Upload
    settingsModal.find('#novelai-select-image-btn').on('click', () => {
        document.getElementById('imageInput_novelai').click();
    });
    settingsModal.find('#imageInput_novelai').on('change', handleNovelaiImageUpload);
    settingsModal.find('#novelai-remove-image-btn').on('click', () => {
        removeNovelaiImage();
    });

    // NovelAI Char Ref Image Upload
    settingsModal.find('#novelai-select-char-ref-image-btn').on('click', () => {
        document.getElementById('imageInput_nai_char_ref').click();
    });
    settingsModal.find('#imageInput_nai_char_ref').on('change', handleNovelaiCharRefImageUpload);
    settingsModal.find('#novelai-remove-char-ref-image-btn').on('click', () => {
        removeNovelaiCharRefImage();
    });

    // ComfyUI Image Upload
    settingsModal.find('#comfyui-select-image-btn').on('click', () => {
        document.getElementById('imageInput2').click();
    });
    settingsModal.find('#imageInput2').on('change', handleImageUpload2);
    settingsModal.find('#comfyui-remove-image-btn').on('click', () => {
        removeComfyUIImage();
    });
}

export {
    updateNovelaiImagePreview,
    updateNovelaiCharRefImagePreview,
    updateComfyUIImagePreview,
    nai3VibeTransferImageMimeType,
    nai3CharRefImageMimeType,
    comfyuiImageObjectURL
};
