// @ts-nocheck
import { extension_settings } from "../../../../extensions.js";
import { getContext } from "../../../../st-context.js";
import { saveSettingsDebounced } from "../../../../../script.js";
import { defaultSettings, extensionName, extensionFolderPath, defaultThemes, aiModels } from './config.js';
import { storeDelete, storeReadOnly, getAllImageMetadata, getAllImages, deleteMultipleImages, getImageByUUID, deleteImagesByUuids, getImageBlobByUUID, getImageThumbnailBlobByUUID, migrateDatabase, generateMissingThumbnails, syncServerImagesWithStorage, initJiuguanStorage } from './database.js';
import { deleteConfigImage, getConfigImage, getFullComfyuiCache, getFullSdCache, migrateCacheToDatabase, saveConfigImage } from './configDatabase.js';
import {
    getSuffix,
    size_change,
    hideSettingsPanel,
    applyFabSettings,
    updateFabSize,
    isValidUrl,
    validateUrlInput,
    stylishConfirm,
    showToast,
    getGlobalVideoPlayer
} from './ui_common.js';
import { removeTrailingSlash, getRequestHeaders, getLog, clearLog, addLog, processUploadedImage, processUploadedImageToBlob, getsdAuth } from './utils.js';
// 导入 editwk 用于迁移检测
import { editwk } from './settings/workers.js';
// AI 设置已统一到 LLM 设置页面，不再需要单独导入 initAiSettings
import { initPromptReplaceControls } from './settings/prompt_replace.js';
import { initLogSettings, updateLogView, updateErrorStats, updateImageGenStats } from './settings/log.js';
import { initWorldBookControls, refreshWorldBookSettings, setupWorldBookEventListener } from './settings/worldbook.js';
import { initUpdateCheck } from './settings/update.js';
import { showSettingsPanel } from "./ui_common.js";
import { initWorkerControls, eidtwork } from './settings/worker.js';
import { initThemeSettings, applyTheme, applyImageFrameStyle, isThemeDark } from './settings/theme.js';
import { initPromptSettings } from './settings/prompt.js';
import {
    initImageUpload,
    updateNovelaiImagePreview,
    updateNovelaiCharRefImagePreview,
    updateComfyUIImagePreview,
    nai3VibeTransferImageMimeType,
    nai3CharRefImageMimeType,
    comfyuiImageObjectURL
} from './settings/image_upload.js';
import { initApiConnectionTests } from './settings/api_connections.js';
import { initLoraControls } from './settings/lora.js';
import { initGeneralSettings } from './settings/general.js';
import { initFab } from './settings/fab.js';
import { initImageCache } from './settings/image_cache.js';
import { initNovelaiUI } from './settings/novelai_ui.js';
import { initVibeGenerator } from './settings/vibeTransferGenerator.js';
import { initVibeGroupEditor } from './settings/vibeGroupEditor.js';
import { formatVibeStorageMigrationResult, migrateVibeStorageToServer } from './settings/vibeStorageMigration.js';
import { initCharRefGroupEditor } from './settings/charRefGroupEditor.js';
import { init as initVocabulary } from './settings/vocabulary.js';
import { initCharacterSettings, refreshCharacterSettings } from './settings/character/index.js';
import { initBananaUI } from './settings/bananaui.js';
import { initRegexSettings } from './settings/regex.js';
import { initLLMSettings } from './settings/llm.js';
import { initSendData } from './settings/send_data.js';
import { initKnowledgeBaseSettings } from './settings/knowledgeBase.js';
import { isKnowledgeBaseEnabled } from './knowledgeBaseService.js';
import { getAboutPageContent, initAboutProtection } from './settings/about.js';
import { initProfileControls, refreshNovelaiProfileSelect, refreshComfyuiProfileSelect } from './settings/profile.js';
import { initAiAssistant } from './aiAssistant.js';
import { playOpeningVideo } from './settings/openingVideo.js';
import { injectHelpTips, removeHelpTips, initHelpTipInteractions } from './configHelper/helpTipInjector.js';

// Backend reconcilers
import { replaceWithSd } from './sd.js';
import { replaceWithnovelai } from './novelai.js';
import { replaceWithcomfyui } from './comfyui.js';
import { replaceWithBanana } from './banana.js';
import { initGestureMonitor } from './settings/Drawing.js';
import { initClickTriggerMonitor } from './settings/ClickTrigger.js';
import { initAutoLLMClick } from './iframe/autoLLMClick.js';
import { initializeKeepAlive, updateKeepAliveStatus } from './comfyuiKeepAlive.js';

let settings;
let currentPreviewTheme = {};
const generationTabs = ['sd', 'novelai', 'comfyui'];
// 注意: 'worldbook' 已从 tabIds 移除，世界书功能暂时隐藏
const tabIds = ['main', 'sd', 'novelai', 'comfyui', 'banana', 'llm', 'vocabulary', 'knowledgeBase', 'character', 'theme', 'fab', 'image-cache', 'regex', 'send_data', 'about', 'log'];
const FAB_ICON_ACCEPTED_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
const FAB_ICON_MAX_FILE_SIZE = 5 * 1024 * 1024;
const FAB_ICON_MAX_DIMENSION = 512;
const FAB_ICON_QUALITY = 0.9;
let fabIconPreviewToken = 0;

function normalizeBackslashPath(value) {
    return value == null ? '' : String(value).trim().replace(/\\{2,}/g, '\\');
}

function readFileAsDataUrl(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => reject(reader.error || new Error('读取图片失败'));
        reader.readAsDataURL(file);
    });
}

function getFabIconFormat(file) {
    return file.type.split('/')[1] || 'png';
}

function compressFabIconImage(dataUrl, file) {
    if (file.type === 'image/gif') {
        return Promise.resolve(dataUrl);
    }

    return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => {
            let { width, height } = img;
            if (width > FAB_ICON_MAX_DIMENSION || height > FAB_ICON_MAX_DIMENSION) {
                const ratio = Math.min(FAB_ICON_MAX_DIMENSION / width, FAB_ICON_MAX_DIMENSION / height);
                width = Math.max(1, Math.round(width * ratio));
                height = Math.max(1, Math.round(height * ratio));
            }

            const canvas = document.createElement('canvas');
            canvas.width = width;
            canvas.height = height;
            const ctx = canvas.getContext('2d');
            if (!ctx) {
                reject(new Error('无法处理图片'));
                return;
            }

            ctx.drawImage(img, 0, 0, width, height);
            resolve(canvas.toDataURL(file.type, FAB_ICON_QUALITY));
        };
        img.onerror = () => reject(new Error('图片加载失败'));
        img.src = dataUrl;
    });
}

function setFabIconPreview(src) {
    const preview = document.getElementById('chatu8_fab_icon_preview');
    const img = document.getElementById('chatu8_fab_icon_preview_img');
    const removeBtn = document.getElementById('chatu8_fab_icon_remove_btn');
    if (!preview || !img || !removeBtn) return;

    if (src) {
        img.src = src;
        preview.classList.add('has-image');
        removeBtn.style.display = '';
    } else {
        img.removeAttribute('src');
        preview.classList.remove('has-image');
        removeBtn.style.display = 'none';
    }
}

async function refreshFabIconPreview(src) {
    const token = ++fabIconPreviewToken;
    const imageId = settings?.chatu8_fab_icon_image_id;

    if (src) {
        setFabIconPreview(src);
        return;
    }

    if (!imageId) {
        setFabIconPreview('');
        return;
    }

    const serverPath = settings.configImageStorage?.[imageId]?.path;
    if (serverPath) {
        setFabIconPreview(serverPath);
        return;
    }

    try {
        const imageData = await getConfigImage(imageId);
        if (token !== fabIconPreviewToken) return;
        setFabIconPreview(imageData || '');
    } catch (error) {
        if (token !== fabIconPreviewToken) return;
        console.error('[st-chatu8] 加载悬浮球图标预览失败:', error);
        setFabIconPreview('');
    }
}

async function handleFabIconUpload(event) {
    const input = event.target;
    const file = input.files?.[0];
    if (!file) return;

    if (!FAB_ICON_ACCEPTED_TYPES.includes(file.type)) {
        toastr.error('请选择 JPG、PNG、WebP 或 GIF 图片。');
        input.value = '';
        return;
    }

    if (file.size > FAB_ICON_MAX_FILE_SIZE) {
        toastr.error('图片文件过大，请选择小于 5MB 的图片。');
        input.value = '';
        return;
    }

    const uploadBtn = document.getElementById('chatu8_fab_icon_upload_btn');
    if (uploadBtn) uploadBtn.disabled = true;

    try {
        const dataUrl = await readFileAsDataUrl(file);
        const iconData = await compressFabIconImage(dataUrl, file);
        const oldImageId = settings.chatu8_fab_icon_image_id;
        const imageId = await saveConfigImage(iconData, {
            format: getFabIconFormat(file),
            filename: `fab_icon_${Date.now()}`,
            forceServer: true
        });

        settings.chatu8_fab_icon_image_id = imageId;
        saveSettingsDebounced();
        await refreshFabIconPreview(iconData);
        applyFabSettings();

        if (oldImageId && oldImageId !== imageId) {
            deleteConfigImage(oldImageId).catch(error => {
                console.warn('[st-chatu8] 删除旧悬浮球图标失败:', error);
            });
        }

        toastr.success('悬浮球图标上传成功，已保存到酒馆。');
    } catch (error) {
        console.error('[st-chatu8] 上传悬浮球图标失败:', error);
        toastr.error('悬浮球图标上传失败：' + error.message);
    } finally {
        if (uploadBtn) uploadBtn.disabled = false;
        input.value = '';
    }
}

async function removeFabIconImage() {
    const imageId = settings?.chatu8_fab_icon_image_id;
    if (!imageId) {
        setFabIconPreview('');
        applyFabSettings();
        return;
    }

    try {
        await deleteConfigImage(imageId);
    } catch (error) {
        console.warn('[st-chatu8] 删除悬浮球图标失败:', error);
    }

    settings.chatu8_fab_icon_image_id = '';
    saveSettingsDebounced();
    await refreshFabIconPreview('');
    applyFabSettings();
    toastr.success('已恢复默认悬浮球图标。');
}

async function loadAllTabsContent(container) {
    if (!container) {
        console.error("Chatu8 UI Error: Tab content container not found.");
        return false;
    }
    try {
        // 对于about标签页，使用JS模块中的内容（防篡改保护）
        const fetchPromises = tabIds.map(tabId => {
            if (tabId === 'about') {
                // about页面内容从JS模块获取，防止HTML被篡改
                const aboutContent = getAboutPageContent();

                // 校验关键声明内容是否存在（防止伪造about.js）
                const requiredBlocks = [
                    // 作者信息块（完整HTML）
                    `<div class="st-chatu8-settings-section">
        <h3>关于 智绘姬 🖼️</h3>
        <p>插件作者: 从前跟你一样</p>
        <div class="st-chatu8-about-links">
            <a href="https://afdian.com/a/cqgnyy" target="_blank" class="st-chatu8-about-link support">
                <i class="fa-solid fa-heart"></i>
                <span>支持作者</span>
                <span class="st-chatu8-cute-emoji">💖</span>
            </a>
            <a href="https://gxcgf4l6b2y.feishu.cn/wiki/UXtHw83pmiHnx1k4WpwcIn79nec?from=from_copylink" target="_blank" class="st-chatu8-about-link help">
                <i class="fa-solid fa-circle-question"></i>
                <span>查看帮助</span>
                <span class="st-chatu8-cute-emoji">❓</span>
            </a>
        </div>
    </div>`,
                    // 关键免责声明句子
                    '免责声明',
                    '本插件仅作为图像生成的桥接工具',
                    '用户生成的所有内容由用户自行负责',
                    '禁止使用本插件生成任何违法违规内容',
                    '因使用本插件产生的任何法律责任或后果',
                    // 免费声明关键句子
                    '本插件完全免费',
                    '本插件为免费软件',
                    '如果您是通过付费渠道获得本插件，您已被骗'
                ];

                const missingBlocks = requiredBlocks.filter(block => !aboutContent.includes(block));
                if (missingBlocks.length > 0) {
                    console.error('[Chatu8] 关键声明内容缺失，插件无法加载');
                    alert('⚠️ 文生图插件检测到关键文件被篡改，无法加载。\n\n请重新安装原版插件。');
                    throw new Error('声明内容校验失败');
                }

                return Promise.resolve(aboutContent);
            }
            return fetch(`${extensionFolderPath}/html/settings/${tabId}.html`).then(res => {
                if (!res.ok) throw new Error(`Failed to fetch ${tabId}.html`);
                return res.text();
            });
        });

        const htmlContents = await Promise.all(fetchPromises);

        const finalHtml = htmlContents.map((html, index) => {
            const tabId = tabIds[index];
            return `<div id="st-chatu8-tab-${tabId}" class="st-chatu8-tab-content" data-tab-id="${tabId}">${html}</div>`;
        }).join('');

        container.innerHTML = finalHtml;

        // AI/翻译设置已统一到 LLM 设置页面，不再需要单独加载 translate.html

        // 注入设置项帮助提示（问号图标 + tooltip/modal）
        try {
            initHelpTipInteractions();
            injectHelpTips(container);
        } catch (e) {
            console.warn('[Chatu8] injectHelpTips failed:', e);
        }

        return true;
    } catch (error) {
        console.error("Chatu8 UI Error: Could not load all tab contents.", error);
        container.innerHTML = `<p class="error" style="color:red; text-align:center; margin-top: 20px;">错误：无法加载设置页面。请检查浏览器控制台获取详细信息。</p>`;
        return false;
    }
}

function updateGenerationModeHandlers() {

    // These functions will internally check the current mode and
    // add/remove the event listener accordingly.
    replaceWithSd();

    replaceWithnovelai();
    replaceWithcomfyui();
    replaceWithBanana();
    addLog('[UI] Generation mode handlers updated for mode: ' + extension_settings[extensionName].mode);
}

export async function initUI({ check_update }) {
    const existingPanel = document.getElementById('st-chatu8-settings');
    if (existingPanel) {
        existingPanel.remove();
    }
    settings = extension_settings[extensionName];

    // 初始化 jiuguanStorage（从隐写图片加载）
    try {
        await initJiuguanStorage();
    } catch (error) {
        console.error('[UI] 初始化 jiuguanStorage 失败:', error);
    }

    // Apply initial theme is now handled in loadSettingsIntoUI,
    // which is called when the panel is shown.
    // applyTheme(settings.theme_id);

    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.type = 'text/css';
    link.href = `${extensionFolderPath}/style.css`;
    document.head.appendChild(link);


    try {
        const response = await fetch(`${extensionFolderPath}/settings.html`);
        if (!response.ok) throw new Error('Failed to fetch settings.html');
        const settingsHtml = await response.text();
        document.body.insertAdjacentHTML('beforeend', settingsHtml);
    } catch (error) {
        console.error("Chatu8 UI Error: Could not load main settings panel.", error);
        return;
    }

    const tabContentContainer = document.querySelector('#ch-settings-modal .st-chatu8-content');
    if (!await loadAllTabsContent(tabContentContainer)) {
        return;
    }

    async function loadSettingsIntoUI() {
        settings = extension_settings[extensionName];

        if (settings.vibeJiuguanchucun === undefined) {
            settings.vibeJiuguanchucun = defaultSettings.vibeJiuguanchucun;
            saveSettingsDebounced();
        }

        // 检查是否需要迁移 cache 数据
        if (!settings.cacheStorageMigrated) {
            console.log('[UI] 检测到未迁移的 cache 数据，开始迁移...');
            const result = await migrateCacheToDatabase();
            if (result.success) {
                console.log('[UI] Cache 迁移完成:', result);
                if (result.migratedComfyui || result.migratedSd) {
                    toastr.success('缓存数据已优化存储，settings.json 文件体积已减小', 'Cache 迁移完成');
                }
            }
        }

        // Resolve conflicts between Character Reference and Vibe Transfer on settings load
        // Character Reference takes priority
        if (settings.nai3CharRef === 'true' && settings.enableVibeGroupTransfer === 'true') {
            settings.enableVibeGroupTransfer = 'false';
            addLog('[CharRef] Conflict resolved on load: Character Reference takes priority over Vibe Transfer');
            console.warn('[CharRef] Conflict detected: Both Character Reference and Vibe Transfer were enabled. Disabling Vibe Transfer (Character Reference takes priority).');
            toastr.warning('检测到冲突：角色参考优先，Vibe Transfer 已禁用', '功能冲突');
            saveSettingsDebounced();
        }

        // Fallback for very first run
        if (!settings.themes) {
            settings.themes = JSON.parse(JSON.stringify(defaultThemes));
        }

        if (!settings.theme_id || !settings.themes[settings.theme_id]) {
            settings.theme_id = '默认-白天';
        }

        applyTheme(settings.themes[settings.theme_id]);

        // Load main settings that are not duplicated
        const mainKeys = ['scriptEnabled', 'helpTipsEnabled', 'newlineFixEnabled', 'mode', 'client', 'displayMode', 'heavyFrontendMode', 'insertOriginalText', 'dbclike', 'collapseImage', 'zidongdianji', 'zidongdianji2', 'longPressToEdit', 'clickToPreview', 'startTag', 'endTag', 'cache', 'sdUrl', 'st_chatu8_sd_auth', 'comfyuiUrl', 'novelaiApi', 'novelaisite', 'novelaiOtherSite', 'enableCloudQueue', 'cloudQueueUrl', 'cloudQueueGreeting', 'showQueueGreeting', 'novelaimode', 'novelai_sampler', 'Schedule', 'nai3Scale', 'cfg_rescale', 'AI_use_coords', 'sm', 'dyn', 'nai3Variety', 'nai3Deceisp', 'sd_cwidth', 'sd_cheight', 'sd_csteps', 'sd_cseed', 'sdCfgScale', 'restoreFaces', 'novelai_width', 'novelai_height', 'novelai_steps', 'novelai_seed', 'nai3VibeTransfer', 'enableVibeGroupTransfer', 'normalizeRefStrength', 'InformationExtracted', 'ReferenceStrength', 'nai3CharRef', 'nai3StylePerception', 'comfyui_width', 'comfyui_height', 'comfyui_steps', 'comfyui_seed', 'cfg_comfyui', 'worker', 'ipa', 'c_fenwei', 'c_xijie', 'c_quanzhong', 'c_idquanzhong', 'AQT_sd', 'UCP_sd', 'AQT_novelai', 'UCP_novelai', 'AQT_comfyui', 'UCP_comfyui', 'addFurryDataset', 'sd_cupscale_factor', 'sd_chires_fix', 'sd_chires_steps', 'sd_cdenoising_strength', 'sd_cclip_skip', 'sd_cadetailer', 'worldBookEnabled', 'ai_temperature', 'ai_top_p', 'ai_presence_penalty', 'ai_frequency_penalty', 'ai_stream', 'ai_private', 'ai_token', 'vocabulary_search_startswith', 'vocabulary_search_limit', 'vocabulary_search_sort', 'enablePregen', 'autoLLMImageGen', 'randomYushe', 'aiAutonomousResolution', 'imageAlignment', 'imageSizeScale', 'imageGenInterval', 'translation_system_prompt', 'ai_test_system', 'ai_test_user', "ai_test_output", "jiuguanchucun", "vibeJiuguanchucun", "convertToJpegStorage", "weilin_lora_fix"];
        mainKeys.forEach(key => {
            const element = document.getElementById(key);
            if (element) {
                if (element.type === 'checkbox') {
                    element.checked = String(settings[key]) === 'true';
                } else {
                    element.value = settings[key];
                }
            }
        });

        // 加载视频模式设置（兼容布尔值和字符串）
        const videoModeCheckbox = document.getElementById('enable_chatu8_fab_video');
        if (videoModeCheckbox) {
            const videoEnabled = settings.enable_chatu8_fab_video === true || settings.enable_chatu8_fab_video === 'true';
            videoModeCheckbox.checked = videoEnabled;
            // 初始化传统设置的显示状态
            const traditionalSettings = document.getElementById('fab-traditional-settings');
            if (traditionalSettings) {
                traditionalSettings.style.display = videoEnabled ? 'none' : '';
            }
        }

        // 加载独立窗口模式设置
        const desktopPetCheckbox = document.getElementById('enable_chatu8_desktop_pet');
        if (desktopPetCheckbox) {
            const desktopPetEnabled = settings.enable_chatu8_desktop_pet === true || settings.enable_chatu8_desktop_pet === 'true';
            desktopPetCheckbox.checked = desktopPetEnabled;
            // 独立窗口依赖视频模式，如果视频模式未启用则隐藏独立窗口选项
            const desktopPetSettings = document.getElementById('fab-desktop-pet-settings');
            if (desktopPetSettings) {
                const videoEnabled = settings.enable_chatu8_fab_video === true || settings.enable_chatu8_fab_video === 'true';
                desktopPetSettings.style.display = videoEnabled ? '' : 'none';
            }
        }

        // AI settings are now loaded in LLM settings page
        // AI 和翻译模型设置已经移到 LLM 设置页面，不再在此处加载

        // Sync sliders with number inputs for NovelAI Vibe Transfer
        const infoExtracted = document.getElementById('InformationExtracted');
        const infoExtractedRange = document.getElementById('InformationExtracted_range');
        if (infoExtracted && infoExtractedRange) {
            infoExtractedRange.value = infoExtracted.value;
        }
        const refStrength = document.getElementById('ReferenceStrength');
        const refStrengthRange = document.getElementById('ReferenceStrength_range');
        if (refStrength && refStrengthRange) {
            refStrengthRange.value = refStrength.value;
        }

        // Images are now session-only and not loaded from settings.
        // Restore images from memory if they exist
        if (window.nai3VibeTransferImage) {
            updateNovelaiImagePreview(`data:${nai3VibeTransferImageMimeType};base64,${window.nai3VibeTransferImage}`);
        } else {
            updateNovelaiImagePreview(null);
        }
        if (window.nai3CharRefImage) {
            updateNovelaiCharRefImagePreview(`data:${nai3CharRefImageMimeType};base64,${window.nai3CharRefImage}`);
        } else {
            updateNovelaiCharRefImagePreview(null);
        }
        updateComfyUIImagePreview(comfyuiImageObjectURL);

        // Validate URLs on load
        validateUrlInput(document.getElementById('sdUrl'));
        validateUrlInput(document.getElementById('comfyuiUrl'));

        // 从 configDatabase 加载 SD cache 并填充下拉选择器
        const sdCache = await getFullSdCache();
        const hasSdCache = sdCache && sdCache.models && sdCache.models.length > 0;

        const sdSelects = [
            { id: 'sd_cchatu_8_model', cacheKey: 'models', settingKey: 'sd_cchatu_8_model', nameField: 'model_name' },
            { id: 'sd_cchatu_8_vae', cacheKey: 'vaes', settingKey: 'sd_cchatu_8_vae', nameField: 'model_name' },
            { id: 'sd_cchatu_8_samplerName', cacheKey: 'samplers', settingKey: 'sd_cchatu_8_samplerName', nameField: 'name' },
            { id: 'sd_cchatu_8_scheduler', cacheKey: 'schedulers', settingKey: 'sd_cchatu_8_scheduler', nameField: 'name' },
            { id: 'sd_cchatu_8_upscaler', cacheKey: 'upscalers', settingKey: 'sd_cchatu_8_upscaler', nameField: 'name' },
            { id: 'sd_cchatu_8_lora', cacheKey: 'loras', settingKey: 'sd_cchatu_8_lora', nameField: 'name' }
        ];

        if (hasSdCache) {
            sdSelects.forEach(({ id, cacheKey, settingKey, nameField }) => {
                const selectEl = document.getElementById(id);
                if (selectEl) {
                    selectEl.innerHTML = '';
                    selectEl.disabled = false;
                    if (id === 'sd_cchatu_8_vae') {
                        selectEl.add(new Option('NONE', 'NONE'));
                    }
                    if (sdCache[cacheKey]) {
                        sdCache[cacheKey].forEach(item => {
                            const name = item;
                            const option = new Option(name, name);
                            option.title = name;

                            selectEl.add(option);
                        });
                    }
                    selectEl.value = settings[settingKey];
                    if (selectEl.selectedIndex === -1 && selectEl.options.length > 0) {
                        selectEl.selectedIndex = 0;
                        settings[settingKey] = selectEl.value;
                    }
                }
            });
        } else {
            sdSelects.forEach(({ id, settingKey }) => {
                const selectEl = document.getElementById(id);
                if (selectEl) {
                    selectEl.innerHTML = `<option value="${settings[settingKey]}">${settings[settingKey]}</option>`;
                    selectEl.disabled = true;
                }
            });
        }

        // 从 configDatabase 加载 ComfyUI cache 并填充下拉选择器
        const comfyCache = await getFullComfyuiCache();
        const hasCache = comfyCache && comfyCache.models && comfyCache.models.length > 0;

        const modelSelect = document.getElementById('MODEL_NAME');
        const vaeSelect = document.getElementById('comfyui_vae');
        const schedulerSelect = document.getElementById('comfyui_scheduler');
        const samplerSelect = document.getElementById('comfyuisamplerName');
        const loraSelect = document.getElementById('ComfyuiLORA');
        const CLIPSelect = document.getElementById('comfyuiCLIPName');

        if (hasCache) {
            // Populate from cache and enable
            [modelSelect, vaeSelect, schedulerSelect, samplerSelect, loraSelect, CLIPSelect].forEach(el => {
                if (el) {
                    el.innerHTML = '';
                    el.disabled = false;
                }
            });

            comfyCache.models.forEach(model => {
                const text = (typeof model === 'object' && model !== null) ? (model.text || model.value || String(model)) : String(model);
                const value = (typeof model === 'object' && model !== null) ? (model.value || String(model)) : String(model);
                const option = new Option(text, normalizeBackslashPath(value));
                option.title = text;
                if (modelSelect) modelSelect.add(option);
            });

            comfyCache.vaes.forEach(vaeName => {
                const name = typeof vaeName === 'object' ? vaeName.value : vaeName;
                const option = new Option(name, name);
                option.title = name;
                if (vaeSelect) vaeSelect.add(option);
            });

            comfyCache.schedulers.forEach(schedulerName => {
                const name = typeof schedulerName === 'object' ? (schedulerName.value || schedulerName.name || String(schedulerName)) : String(schedulerName);
                const option = new Option(name, name);
                option.title = name;
                if (schedulerSelect) schedulerSelect.add(option);
            });

            comfyCache.samplers.forEach(samplerName => {
                const name = typeof samplerName === 'object' ? (samplerName.value || samplerName.name || String(samplerName)) : String(samplerName);
                const option = new Option(name, name);
                option.title = name;
                if (samplerSelect) samplerSelect.add(option);
            });

            if (comfyCache.CLIPs) {
                comfyCache.CLIPs.forEach(CLIPName => {
                    const name = typeof CLIPName === 'object' ? (CLIPName.value || CLIPName.name || String(CLIPName)) : String(CLIPName);
                    const option = new Option(name, name);
                    option.title = name;
                    if (CLIPSelect) CLIPSelect.add(option);
                });
            }

            if (loraSelect && comfyCache.loras && comfyCache.loras.length > 0) {
                comfyCache.loras.forEach(loraName => {
                    const name = typeof loraName === 'object' ? (loraName.value || loraName.name || String(loraName)) : String(loraName);
                    const option = new Option(name.replace(".safetensors", ""), name.replace(".safetensors", ""));
                    option.title = name;
                    loraSelect.add(option);
                });
            } else if (loraSelect) {
                loraSelect.innerHTML = '<option>无</option>';
                loraSelect.disabled = true;
            }

            // Set selected values
            if (modelSelect) {
                settings.MODEL_NAME = normalizeBackslashPath(settings.MODEL_NAME);
                modelSelect.value = settings.MODEL_NAME;
                if (modelSelect.selectedIndex === -1 && modelSelect.options.length > 0) {
                    modelSelect.selectedIndex = 0;
                    settings.MODEL_NAME = normalizeBackslashPath(modelSelect.value);
                }
            }
            if (vaeSelect) {
                vaeSelect.value = settings.comfyui_vae;
                if (vaeSelect.selectedIndex === -1 && vaeSelect.options.length > 0) {
                    vaeSelect.selectedIndex = 0;
                    settings.comfyui_vae = vaeSelect.value;
                }
            }
            if (schedulerSelect) {
                schedulerSelect.value = settings.comfyui_scheduler;
                if (schedulerSelect.selectedIndex === -1 && schedulerSelect.options.length > 0) {
                    schedulerSelect.selectedIndex = 0;
                    settings.comfyui_scheduler = schedulerSelect.value;
                }
            }
            if (samplerSelect) {
                samplerSelect.value = settings.comfyuisamplerName;
                if (samplerSelect.selectedIndex === -1 && samplerSelect.options.length > 0) {
                    samplerSelect.selectedIndex = 0;
                    settings.comfyuisamplerName = samplerSelect.value;
                }
            }

            if (CLIPSelect) {
                CLIPSelect.value = settings.comfyuiCLIPName;
                if (CLIPSelect.selectedIndex === -1 && CLIPSelect.options.length > 0) {
                    CLIPSelect.selectedIndex = 0;
                    settings.comfyuiCLIPName = CLIPSelect.value;
                }
            }
        } else {
            // Disable and show placeholder text
            const selects = [
                { el: modelSelect, setting: 'MODEL_NAME' },
                { el: vaeSelect, setting: 'comfyui_vae' },
                { el: schedulerSelect, setting: 'comfyui_scheduler' },
                { el: samplerSelect, setting: 'comfyuisamplerName' },
                { el: CLIPSelect, setting: 'comfyuiCLIPName' }
            ];

            selects.forEach(({ el, setting }) => {
                if (el) {
                    el.innerHTML = '';
                    const option = new Option(settings[setting] || "未连接", settings[setting]);
                    option.title = settings[setting];
                    el.add(option);
                    el.value = settings[setting];
                    el.disabled = true;
                }
            });
            if (loraSelect) {
                loraSelect.innerHTML = '<option>未连接</option>';
                loraSelect.disabled = true;
            }
        }

        // Load settings for each duplicated prompt section
        generationTabs.forEach(mode => {
            const suffix = getSuffix(mode);
            const yusheSelect = document.getElementById('yusheid' + suffix);
            const yusheIdKey = `yusheid${mode === 'sd' ? '_sd' : suffix}`;

            if (yusheSelect) {
                yusheSelect.innerHTML = '';
                const sortedKeys = Object.keys(settings.yushe).sort((a, b) => a.localeCompare(b, 'zh-CN'));
                for (const key of sortedKeys) {
                    const option = new Option(key, key);
                    option.title = key;
                    yusheSelect.add(option);
                }
                yusheSelect.value = settings[yusheIdKey];
            }

            const currentPresetId = settings[yusheIdKey] || '默认';
            const currentPreset = settings.yushe[currentPresetId] || {};
            const fields = ['fixedPrompt', 'fixedPrompt_end', 'negativePrompt'];
            fields.forEach(field => {
                const textarea = document.getElementById(field + suffix);
                if (textarea) {
                    textarea.value = currentPreset[field] ?? '';
                    const warning = textarea.closest('.st-chatu8-field-col').querySelector('.st-chatu8-unsaved-warning');
                    if (warning) $(warning).hide();
                }
            });
        });

        // Load theme settings
        // initThemeSettings(settings, currentPreviewTheme);

        // Ensure prompt_replace settings exist
        if (!settings.prompt_replace) {
            settings.prompt_replace = { "默认": { "text": '' } };
        }
        if (!settings.prompt_replace_id) {
            settings.prompt_replace_id = "默认";
        }

        // Load settings for each duplicated prompt replace section
        generationTabs.forEach(mode => {
            const suffix = getSuffix(mode);
            const replaceSelect = document.getElementById('prompt_replace_id' + suffix);
            if (replaceSelect) {
                replaceSelect.innerHTML = '';
                for (const key in settings.prompt_replace) {
                    const option = new Option(key, key);
                    option.title = key;
                    replaceSelect.add(option);
                }
                replaceSelect.value = settings.prompt_replace_id;
            }

            const currentPreset = settings.prompt_replace[settings.prompt_replace_id] || {};
            const textarea = document.getElementById('prompt_replace_text' + suffix);
            if (textarea) {
                textarea.value = currentPreset.text ?? '';
                const warning = textarea.closest('.st-chatu8-field-col').querySelector('.st-chatu8-unsaved-warning');
                if (warning) $(warning).hide();
            }
        });

        // Load worker settings
        // 确保 workers 对象存在
        if (!settings.workers) {
            settings.workers = {};
        }

        // 检测并添加 "图像编辑" 预设（如果不存在）
        if (!settings.workers["图像编辑"]) {
            settings.workers["图像编辑"] = editwk;
            console.log('[Chatu8] 已自动添加 "图像编辑" 工作流预设');
            saveSettingsDebounced();
        }

        // 确保 editWorkerid 存在，如果不存在则设置为 "图像编辑"
        if (!settings.editWorkerid) {
            settings.editWorkerid = "图像编辑";
            saveSettingsDebounced();
        }

        // 确保 editWorker 存在
        if (!settings.editWorker && settings.workers[settings.editWorkerid]) {
            settings.editWorker = settings.workers[settings.editWorkerid];
            saveSettingsDebounced();
        }

        // Ensure worldBookList settings exist
        if (!settings.worldBookList) {
            settings.worldBookList = { "默认": { "content": "" } };
        }
        if (!settings.worldBookList_id) {
            settings.worldBookList_id = "默认";
        }

        // Load world book settings
        const worldBookSelect = document.getElementById('worldBookList_id');
        if (worldBookSelect) {
            worldBookSelect.innerHTML = '';
            for (const key in settings.worldBookList) {
                const option = new Option(key, key);
                option.title = key;
                worldBookSelect.add(option);
            }
            worldBookSelect.value = settings.worldBookList_id;
        }

        const currentWorldBookPreset = settings.worldBookList[settings.worldBookList_id] || {};
        const worldBookTextarea = document.getElementById('worldbook_content');
        if (worldBookTextarea) {
            worldBookTextarea.value = currentWorldBookPreset.content ?? '';
            const warning = worldBookTextarea.closest('.st-chatu8-field-col').querySelector('.st-chatu8-unsaved-warning');
            if (warning) $(warning).hide();
        }

        const workerSelect = document.getElementById('workerid');
        if (workerSelect) {
            workerSelect.innerHTML = '';
            for (const key in settings.workers) {
                const option = new Option(key, key);
                option.title = key;
                workerSelect.add(option);
            }
            workerSelect.value = settings.workerid;
        }

        // 加载修图预设选择器
        const editWorkerSelect = document.getElementById('editWorkerid');
        if (editWorkerSelect) {
            editWorkerSelect.innerHTML = '';
            for (const key in settings.workers) {
                const option = new Option(key, key);
                option.title = key;
                editWorkerSelect.add(option);
            }
            editWorkerSelect.value = settings.editWorkerid;
        }

        // 加载修图工作流内容
        const editWorkerTextarea = document.getElementById('editWorker');
        if (editWorkerTextarea) {
            editWorkerTextarea.value = settings.editWorker || settings.workers[settings.editWorkerid] || '';
        }

        // Load float ball settings
        // --- Migration for FAB position ---
        if (!settings.chatu8_fab_position) {
            settings.chatu8_fab_position = {
                desktop: { top: settings.chatu8_fab_top || '65vh', left: settings.chatu8_fab_left || '20px' },
                mobile: { top: '80vh', left: '10px' }
            };
            delete settings.chatu8_fab_top;
            delete settings.chatu8_fab_left;
        }
        // Ensure both desktop and mobile objects exist
        if (!settings.chatu8_fab_position.desktop) {
            settings.chatu8_fab_position.desktop = { top: '65vh', left: '20px' };
        }
        if (!settings.chatu8_fab_position.mobile) {
            settings.chatu8_fab_position.mobile = { top: '80vh', left: '10px' };
        }

        $("#enable_chatu8_fab").prop("checked", String(settings.enable_chatu8_fab) === 'true');

        // 初始化悬浮球主题预设
        if (!settings.fabThemes) {
            settings.fabThemes = JSON.parse(JSON.stringify(defaultSettings.fabThemes));
        }
        if (!settings.chatu8_fab_theme) {
            settings.chatu8_fab_theme = '自定义';
        }
        const fabThemeSelect = $("#chatu8_fab_theme");
        if (fabThemeSelect.length) {
            fabThemeSelect.empty();
            for (const themeName in settings.fabThemes) {
                const option = new Option(themeName, themeName);
                option.title = themeName;
                fabThemeSelect.append(option);
            }
            fabThemeSelect.val(settings.chatu8_fab_theme);
        }

        $("#chatu8_fab_bg_color").val(settings.chatu8_fab_bg_color || '#ADD8E6');
        $("#chatu8_fab_icon_color").val(settings.chatu8_fab_icon_color || '#FFFFFF');
        if (typeof settings.chatu8_fab_icon_image_id !== 'string') {
            settings.chatu8_fab_icon_image_id = '';
        }
        refreshFabIconPreview();
        $("#chatu8_fab_opacity").val(settings.chatu8_fab_opacity ?? 1);
        $("#chatu8_fab_opacity_value").val(settings.chatu8_fab_opacity ?? 1);

        // 兼容旧版本：将单一数值转换为对象
        if (typeof settings.chatu8_fab_size === 'number' || typeof settings.chatu8_fab_size === 'string') {
            const numValue = typeof settings.chatu8_fab_size === 'string' ? parseInt(settings.chatu8_fab_size, 10) : settings.chatu8_fab_size;
            settings.chatu8_fab_size = {
                desktop: numValue,
                mobile: numValue
            };
        }

        // 根据当前设备类型显示对应的尺寸
        const isMobile = window.innerWidth <= 768;
        const floatBallSize = isMobile
            ? (settings.chatu8_fab_size?.mobile ?? 40)
            : (settings.chatu8_fab_size?.desktop ?? 50);
        $("#chatu8_fab_size").val(floatBallSize);
        $("#chatu8_fab_size_value").val(floatBallSize);

        // 初始化视频路径（如果不存在）
        if (!settings.chatu8_fab_video_paths) {
            settings.chatu8_fab_video_paths = JSON.parse(JSON.stringify(defaultSettings.chatu8_fab_video_paths));
        }

        applyFabSettings();

        // 刷新角色设置相关模块(如果角色标签页是当前激活的标签页)
        const activeTabId = $('.st-chatu8-nav-link.active').data('tab');
        if (activeTabId === 'character') {
            const characterTab = $('#st-chatu8-tab-character');
            if (characterTab.length) {
                refreshCharacterSettings(characterTab);
            }
        }
    }

    loadSettingsIntoUI();

    updateGenerationModeHandlers(); // Set initial handler based on loaded settings

    initFab(); // Initialize the float ball

    const settingsModal = $('#ch-settings-modal');
    initUpdateCheck(settingsModal, check_update);

    // Defer thumbnail generation to avoid blocking UI thread
    setTimeout(() => generateMissingThumbnails(), 5000);

    // 包装 showSettingsPanel 函数，在打开设置面板前播放开场视频
    const originalShowSettingsPanel = showSettingsPanel;
    const wrappedShowSettingsPanel = function () {
        playOpeningVideo();
        // 短暂延迟后显示设置面板
        setTimeout(() => {
            originalShowSettingsPanel();
        }, 100);
    };

    window.showChatuSettingsPanel = wrappedShowSettingsPanel;
    window.loadSilterTavernChatu8Settings = loadSettingsIntoUI;
    window.refreshNovelaiProfileSelect = refreshNovelaiProfileSelect;
    window.refreshComfyuiProfileSelect = refreshComfyuiProfileSelect;

    initNovelaiUI(settingsModal);
    initVibeGenerator(settingsModal);
    initVibeGroupEditor(settingsModal);
    initCharRefGroupEditor(settingsModal);

    settingsModal.find('#ch-settings-modal-close').on('click', hideSettingsPanel);

    // Initialize modular settings

    if (extension_settings[extensionName].gestureEnabled == true || extension_settings[extensionName].gestureEnabled === "true") {
        initGestureMonitor();
    }

    // 初始化自动LLM点击模块
    initAutoLLMClick();

    // 初始化 ComfyUI 保活模块
    initializeKeepAlive();

    // initClickTriggerMonitor 已在模块导入时自动启动，无需重复调用
    initGeneralSettings(settingsModal);
    initLogSettings(settingsModal);
    // AI 设置已统一到 LLM 设置页面
    initThemeSettings(settingsModal, settings, currentPreviewTheme);
    initPromptSettings(settingsModal, settings);

    settingsModal.on('click', '.st-chatu8-toggle', function () {
        const checkbox = $(this).find('input[type="checkbox"]');
        if (checkbox.length) {
            checkbox.prop('checked', !checkbox.prop('checked')).trigger('change');
        }
    });

    settingsModal.find('.st-chatu8-nav-link').on('click', function (e) {
        e.preventDefault();
        const tabId = $(this).data('tab');

        // Do nothing if clicking the already active tab. This prevents reloading when the panel is first opened.
        if ($(this).hasClass('active')) {
            return;
        }

        // 标签页切换时不重新加载 cache，只刷新必要的 UI
        // Cache 数据已在首次打开设置面板时加载，无需重复加载

        // Update nav links' active state
        settingsModal.find('.st-chatu8-nav-link').removeClass('active');
        $(this).addClass('active');

        // Hide all tab content panels, then show the target one
        const tabContents = settingsModal.find('.st-chatu8-content > .st-chatu8-tab-content');
        tabContents.removeClass('active'); // No need to hide, CSS handles it

        const targetTab = settingsModal.find(`#st-chatu8-tab-${tabId}`);
        if (targetTab.length) {
            targetTab.addClass('active');
            if (tabId === 'log') {
                updateLogView();
                updateErrorStats();
                updateImageGenStats();
            } else if (tabId === 'character') {
                // 刷新角色设置UI（包括角色启用管理）
                refreshCharacterSettings(targetTab);
            }
            // 世界书标签页刷新已禁用（功能暂时隐藏）
            // else if (tabId === 'worldbook') {
            //     refreshWorldBookSettings(targetTab);
            // }
        }

        // Update last tab (will be saved when other settings trigger save)
        settings.lastTab = tabId;
    });

    // Activate the last opened tab, or default to 'main'
    const lastTabId = settings.lastTab || 'main';
    const initialTabLink = settingsModal.find(`.st-chatu8-nav-link[data-tab="${lastTabId}"]`);

    if (initialTabLink.length && !initialTabLink.hasClass('active')) {
        // Manually set the active classes without triggering click,
        // because loadSettingsIntoUI() has already been called.
        settingsModal.find('.st-chatu8-nav-link').removeClass('active');
        initialTabLink.addClass('active');

        settingsModal.find('.st-chatu8-content > .st-chatu8-tab-content').removeClass('active');
        const initialTabContent = settingsModal.find(`#st-chatu8-tab-${lastTabId}`);
        initialTabContent.addClass('active');

        if (lastTabId === 'log') {
            updateLogView();
            updateErrorStats();
            updateImageGenStats();
        }
    } else if (settingsModal.find('.st-chatu8-nav-link.active').length === 0) {
        // Fallback if saved tab is invalid or no tab is active
        const firstLink = settingsModal.find('.st-chatu8-nav-link').first();
        firstLink.addClass('active');
        const firstTabId = firstLink.data('tab');
        settingsModal.find(`#st-chatu8-tab-${firstTabId}`).addClass('active');
    }

    // Bind events for duplicated prompt replace controls
    initPromptReplaceControls(settingsModal);
    // 世界书控件初始化已禁用（功能暂时隐藏）
    // initWorldBookControls(settingsModal);
    // 但仍需注册事件监听器，以支持 {{角色启用列表}} 等占位符替换
    setupWorldBookEventListener();
    // Bind events for character settings
    initCharacterSettings(settingsModal);
    initWorkerControls(settingsModal);
    initProfileControls(settingsModal);

    // Bind other controls
    initApiConnectionTests(settingsModal);
    initLoraControls(settingsModal);
    settingsModal.find('#eidtwork').on('click', eidtwork);

    initImageUpload(settingsModal);
    initImageCache(settingsModal);
    initVocabulary(settingsModal);
    initBananaUI(settingsModal);
    initRegexSettings(settingsModal);
    initLLMSettings(settingsModal);
    initSendData(settingsModal);
    initKnowledgeBaseSettings(settingsModal);
    // 根据资料库开关状态控制侧边栏导航链接可见性
    const $kbNavLink = settingsModal.find('.st-chatu8-nav-link[data-tab="knowledgeBase"]');
    if ($kbNavLink.length) {
        $kbNavLink.toggle(isKnowledgeBaseEnabled());
    }
    initAboutProtection(settingsModal[0]);
    initAiAssistant(settingsModal);

    settingsModal.find('#migrate-database-btn').on('click', migrateDatabase);

    settingsModal.find('#migrate-vibe-storage-btn').on('click', async function () {
        const button = $(this);
        const originalText = button.text();

        button.prop('disabled', true).text('准备迁移...');

        try {
            const result = await migrateVibeStorageToServer({
                promptEnable: true,
                onProgress: (current, total, message) => {
                    button.text(`${message} (${current}/${total})`);
                }
            });

            alert(formatVibeStorageMigrationResult(result));
        } catch (error) {
            console.error('[VibeStorage] 迁移失败:', error);
            alert(`Vibe 酒馆存储迁移失败: ${error.message}`);
        } finally {
            button.prop('disabled', false).text(originalText);
        }
    });

    // 同步服务器图片按钮
    settingsModal.find('#sync-server-images-btn').on('click', async function () {
        const button = $(this);
        const originalText = button.text();

        // 创建进度条模态框
        const progressModal = $(`
            <div class="st-chatu8-progress-modal" style="
                position: fixed;
                top: 0;
                left: 0;
                width: 100%;
                height: 100%;
                background: rgba(0, 0, 0, 0.7);
                display: flex;
                align-items: center;
                justify-content: center;
                z-index: 10001;
            ">
                <div class="st-chatu8-progress-container" style="
                    background: white;
                    border-radius: 8px;
                    padding: 24px;
                    min-width: 400px;
                    max-width: 500px;
                    box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
                ">
                    <h3 style="margin: 0 0 16px 0; color: #333;">同步服务器图片</h3>
                    <div class="st-chatu8-progress-bar" style="
                        width: 100%;
                        height: 24px;
                        background: #f0f0f0;
                        border-radius: 12px;
                        overflow: hidden;
                        margin-bottom: 12px;
                    ">
                        <div class="st-chatu8-progress-fill" style="
                            height: 100%;
                            background: linear-gradient(90deg, #4CAF50, #45a049);
                            width: 0%;
                            transition: width 0.3s ease;
                            border-radius: 12px;
                        "></div>
                    </div>
                    <div class="st-chatu8-progress-text" style="
                        text-align: center;
                        color: #666;
                        font-size: 14px;
                        min-height: 20px;
                    ">准备开始...</div>
                    <div class="st-chatu8-progress-percentage" style="
                        text-align: center;
                        color: #333;
                        font-weight: bold;
                        margin-top: 8px;
                    ">0%</div>
                </div>
            </div>
        `);

        $('body').append(progressModal);
        button.prop('disabled', true).text('同步中...');

        try {
            const result = await syncServerImagesWithStorage('chatu8', (current, total, message) => {
                const percentage = Math.floor((current / total) * 100);
                progressModal.find('.st-chatu8-progress-fill').css('width', `${percentage}%`);
                progressModal.find('.st-chatu8-progress-text').text(message);
                progressModal.find('.st-chatu8-progress-percentage').text(`${percentage}%`);
            });

            // 移除进度条
            progressModal.remove();

            // 显示结果
            const ghost = result.removedGhostCount || 0;
            if (result.deletedCount > 0 || ghost > 0 || result.errors.length > 0) {
                const lines = ['同步完成！'];
                if (result.deletedCount > 0) lines.push(`删除了 ${result.deletedCount} 个服务器孤儿图片`);
                if (ghost > 0) lines.push(`从列表清理了 ${ghost} 个服务器已不存在的幽灵条目`);
                if (result.errors.length > 0) lines.push(`失败 ${result.errors.length} 个`);
                alert(lines.join('\n'));
            } else {
                alert('同步完成！所有图片都已同步，无需清理。');
            }
        } catch (error) {
            console.error('[Sync] 同步失败:', error);
            progressModal.remove();
            alert(`同步失败: ${error.message}`);
        } finally {
            button.prop('disabled', false).text(originalText);
        }
    });

    settingsModal.find('#sd_csize').on('change', () => size_change('sd'));
    settingsModal.find('#novelai_size').on('change', () => size_change('novelai'));
    settingsModal.find('#comfyui_size').on('change', () => size_change('comfyui'));

    // Auto-save settings on change for all other inputs
    const allIDs = Object.keys(defaultSettings);
    const ignoreIDs = ['yushe', 'yusheid', 'fixedPrompt', 'fixedPrompt_end', 'negativePrompt', 'workers', 'workerid', 'worker', 'themes', 'theme_id', 'prompt_replace', 'prompt_replace_id', 'prompt_replace_text', 'UCP', 'AQT', 'nai3CharRef', 'worldBookList', 'worldBookList_id', 'worldbook_content', 'insertOriginalText', 'convertToJpegStorage', 'randomYushe'];

    // Slider and number input sync for NovelAI
    $('#InformationExtracted, #InformationExtracted_range').on('input', (event) => {
        const value = $(event.target).val();
        $('#InformationExtracted').val(value);
        $('#InformationExtracted_range').val(value);
        settings.InformationExtracted = value;
        saveSettingsDebounced();
    });
    $('#ReferenceStrength, #ReferenceStrength_range').on('input', (event) => {
        const value = $(event.target).val();
        $('#ReferenceStrength').val(value);
        $('#ReferenceStrength_range').val(value);
        settings.ReferenceStrength = value;
        saveSettingsDebounced();
    });

    // insertOriginalText 开关的特殊处理：联动 ST 全局正则
    const CHATU8_IMAGE_REGEX_SCRIPT_NAME = 'st-chatu8-不发送image标签';
    const CHATU8_IMAGE_REGEX_SCRIPT = {
        scriptName: CHATU8_IMAGE_REGEX_SCRIPT_NAME,
        findRegex: '/<image>[\\s\\S]*?<\\/image>/g',
        replaceString: '',
        trimStrings: [],
        placement: [1, 2],
        disabled: false,
        markdownOnly: false,
        promptOnly: true,
        runOnEdit: true,
        substituteRegex: 0,
        minDepth: null,
        maxDepth: null
    };

    // 隐藏 imgthink 标签的正则脚本
    const CHATU8_IMGTHINK_REGEX_SCRIPT_NAME = 'st-chatu8-隐藏imgthink';
    const CHATU8_IMGTHINK_REGEX_SCRIPT = {
        scriptName: CHATU8_IMGTHINK_REGEX_SCRIPT_NAME,
        findRegex: '/<imgthink>[\\s\\S]*?<\\/imgthink>/g',
        replaceString: '',
        trimStrings: [],
        placement: [2],
        disabled: false,
        markdownOnly: true,
        promptOnly: true,
        runOnEdit: true,
        substituteRegex: 0,
        minDepth: null,
        maxDepth: null
    };

    /**
     * 创建 ST 全局正则脚本（仅在开启时创建，不会删除）
     * @param {boolean} enable - 是否启用
     */
    async function handleInsertOriginalTextRegex(enable) {
        if (!enable) return; // 关闭时不做任何操作

        try {
            const regexEngine = await import('../../../regex/engine.js');

            if (!regexEngine.getScriptsByType || !regexEngine.SCRIPT_TYPES) {
                console.warn('[Chatu8] ST 正则引擎版本过旧，无法自动管理正则脚本');
                return;
            }

            const globalScripts = regexEngine.getScriptsByType(regexEngine.SCRIPT_TYPES.GLOBAL) || [];
            const existingImageScript = globalScripts.find(s => s.scriptName === CHATU8_IMAGE_REGEX_SCRIPT_NAME);
            const existingImgthinkScript = globalScripts.find(s => s.scriptName === CHATU8_IMGTHINK_REGEX_SCRIPT_NAME);

            let needsSave = false;
            const createdScripts = [];

            // 如果 image 正则不存在，则创建
            if (!existingImageScript) {
                const newScript = {
                    ...CHATU8_IMAGE_REGEX_SCRIPT,
                    id: (typeof crypto !== 'undefined' && crypto.randomUUID) ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).substr(2)
                };
                globalScripts.push(newScript);
                needsSave = true;
                createdScripts.push(CHATU8_IMAGE_REGEX_SCRIPT_NAME);
                console.log('[Chatu8] 已创建全局正则脚本:', CHATU8_IMAGE_REGEX_SCRIPT_NAME);
            }

            // 如果 imgthink 正则不存在，则创建
            if (!existingImgthinkScript) {
                const newScript = {
                    ...CHATU8_IMGTHINK_REGEX_SCRIPT,
                    id: (typeof crypto !== 'undefined' && crypto.randomUUID) ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).substr(2)
                };
                globalScripts.push(newScript);
                needsSave = true;
                createdScripts.push(CHATU8_IMGTHINK_REGEX_SCRIPT_NAME);
                console.log('[Chatu8] 已创建全局正则脚本:', CHATU8_IMGTHINK_REGEX_SCRIPT_NAME);
            }

            if (needsSave) {
                await regexEngine.saveScriptsByType(globalScripts, regexEngine.SCRIPT_TYPES.GLOBAL);

                // 触发 ST 设置保存和刷新
                const { saveSettingsDebounced: stSaveSettings } = await import('../../../../../../script.js');
                stSaveSettings();

                toastr.success('已创建全局正则：' + createdScripts.join('、') + '（刷新页面或重新打开正则面板可见）');
            } else {
                toastr.info('全局正则已存在');
            }
        } catch (error) {
            console.error('[Chatu8] 创建 ST 正则脚本失败:', error);
        }
    }

    // 绑定 helpTipsEnabled 开关：切换时动态添加/移除问号图标
    // 用事件委托绑定，避免任何时序问题
    settingsModal.on('change', '#helpTipsEnabled', function () {
        const isEnabled = $(this).prop('checked');
        settings.helpTipsEnabled = isEnabled ? 'true' : 'false';
        saveSettingsDebounced();
        const container = settingsModal[0]?.querySelector('.st-chatu8-content');
        if (!container) return;
        if (isEnabled) {
            injectHelpTips(container);
        } else {
            removeHelpTips(container);
        }
    });

    // 绑定 insertOriginalText 开关事件
    settingsModal.find('#insertOriginalText').on('change', async function () {
        const isEnabled = $(this).prop('checked');
        settings.insertOriginalText = isEnabled.toString();
        saveSettingsDebounced();
        await handleInsertOriginalTextRegex(isEnabled);
    });

    // 绑定 convertToJpegStorage 开关事件
    settingsModal.find('#convertToJpegStorage').on('change', function () {
        const isEnabled = $(this).prop('checked');
        settings.convertToJpegStorage = isEnabled.toString();
        saveSettingsDebounced();

        if (isEnabled) {
            toastr.info('新图片将以JPEG格式储存，可节省约70%空间', 'JPEG储存已启用');
            addLog('[缓存] JPEG储存已启用，质量: 0.78');
        } else {
            addLog('[缓存] JPEG储存已关闭');
        }
    });

    // 绑定 autoLLMImageGen 开关事件：联动开启 insertOriginalText 并关闭 imageGenDemandEnabled
    settingsModal.find('#autoLLMImageGen').on('change', async function () {
        const isEnabled = $(this).prop('checked');
        settings.autoLLMImageGen = isEnabled.toString();
        saveSettingsDebounced();

        if (isEnabled) {
            const changes = [];

            // 1. 自动开启 insertOriginalText
            const insertTextSwitch = settingsModal.find('#insertOriginalText');
            if (insertTextSwitch.length && !insertTextSwitch.prop('checked')) {
                insertTextSwitch.prop('checked', true);
                settings.insertOriginalText = 'true';
                saveSettingsDebounced();
                await handleInsertOriginalTextRegex(true);
                changes.push('已开启"插入原文(非同层)"');
            }

            // 2. 自动关闭 imageGenDemandEnabled
            if (extension_settings[extensionName]?.imageGenDemandEnabled) {
                extension_settings[extensionName].imageGenDemandEnabled = false;
                const imageGenDemandSwitch = $('#ch-image-gen-demand-enabled');
                if (imageGenDemandSwitch.length) {
                    imageGenDemandSwitch.prop('checked', false);
                }
                saveSettingsDebounced();
                changes.push('已关闭"生图需求弹窗"');
            }

            // 显示联动通知
            if (changes.length > 0) {
                toastr.info(changes.join('，'), '自动LLM请求生图已启用');
            }
        }
    });

    // 绑定 randomYushe 开关事件
    settingsModal.find('#randomYushe').on('change', function () {
        const isEnabled = $(this).prop('checked');
        settings.randomYushe = isEnabled.toString();
        saveSettingsDebounced();

        if (isEnabled) {
            const yusheKeys = Object.keys(settings.yushe || {});
            toastr.info(`当前共有 ${yusheKeys.length} 个提示词预设，每次生图将随机选择`, '随机预设已启用');
            addLog('[随机预设] 已启用，每次生图将从预设中随机选择');
        } else {
            addLog('[随机预设] 已关闭，将使用固定预设');
        }
    });

    // Float ball settings listeners
    $('#enable_chatu8_fab').on('change', (event) => {
        settings.enable_chatu8_fab = $(event.target).prop('checked').toString();
        saveSettingsDebounced();
        applyFabSettings();
    });

    // 视频模式开关
    $('#enable_chatu8_fab_video').on('change', (event) => {
        settings.enable_chatu8_fab_video = $(event.target).prop('checked');
        saveSettingsDebounced();

        // 切换传统设置的显示/隐藏
        toggleTraditionalFabSettings();

        // 重新应用FAB设置
        applyFabSettings();
    });

    // 智绘姬独立窗口开关（传统 Video Picture-in-Picture）
    // ✅ 优化方案：直接在 WebGL 渲染器中切换 gl.clearColor，零额外开销
    // 通过 videoPlayer.setPipBackground(true) 让 renderFrame 使用不透明背景色
    // 然后直接从 WebGL canvas captureStream，无需中间 composite canvas
    let pipVideoElement = null; // 用于 PiP 的 video 元素

    $('#enable_chatu8_desktop_pet').on('change', async (event) => {
        const checked = $(event.target).prop('checked');

        settings.enable_chatu8_desktop_pet = checked;
        saveSettingsDebounced();

        if (checked) {
            try {
                // 获取视频播放器实例
                const videoPlayer = getGlobalVideoPlayer();
                if (!videoPlayer || !videoPlayer.setPipBackground) {
                    toastr.error('未找到视频播放器，请先启用视频形象', '独立窗口');
                    $(event.target).prop('checked', false);
                    settings.enable_chatu8_desktop_pet = false;
                    saveSettingsDebounced();
                    return;
                }

                // 查找 WebGL Canvas 元素
                const glCanvas = document.getElementById('st-chatu8-fab-video-canvas');
                if (!glCanvas) {
                    toastr.error('未找到视频画布元素，请先启用视频形象', '独立窗口');
                    $(event.target).prop('checked', false);
                    settings.enable_chatu8_desktop_pet = false;
                    saveSettingsDebounced();
                    return;
                }

                // ✅ 关键：让 WebGL 渲染器使用不透明背景色
                // 这样 captureStream 捕获到的就是有背景的画面，无需额外合成
                videoPlayer.setPipBackground(true);

                // 直接从 WebGL Canvas 捕获视频流（零额外开销）
                const stream = glCanvas.captureStream(30); // 30fps

                // 创建隐藏的 video 元素用于 PiP
                pipVideoElement = document.createElement('video');
                pipVideoElement.id = 'st-chatu8-pip-video';
                pipVideoElement.srcObject = stream;
                pipVideoElement.muted = true;
                pipVideoElement.autoplay = true;
                pipVideoElement.playsInline = true;
                pipVideoElement.style.display = 'none';
                pipVideoElement.style.position = 'fixed';
                pipVideoElement.style.opacity = '0';
                pipVideoElement.style.pointerEvents = 'none';
                pipVideoElement.width = glCanvas.width || 200;
                pipVideoElement.height = glCanvas.height || 200;
                document.body.appendChild(pipVideoElement);

                // 等待视频可以播放
                await pipVideoElement.play();

                // 请求画中画
                await pipVideoElement.requestPictureInPicture();

                // 监听退出画中画事件
                pipVideoElement.addEventListener('leavepictureinpicture', () => {
                    // ✅ 恢复 WebGL 透明背景
                    const vp = getGlobalVideoPlayer();
                    if (vp && vp.setPipBackground) {
                        vp.setPipBackground(false);
                    }
                    // 清理 PiP video 元素
                    if (pipVideoElement) {
                        pipVideoElement.srcObject = null;
                        pipVideoElement.remove();
                        pipVideoElement = null;
                    }
                    // 同步更新开关状态
                    settings.enable_chatu8_desktop_pet = false;
                    $('#enable_chatu8_desktop_pet').prop('checked', false);
                    saveSettingsDebounced();
                    toastr.info('画中画已关闭，智绘姬回到浏览器内', '独立窗口');
                });

                toastr.success('智绘姬已弹出到画中画窗口，可置顶显示在其他应用上方', '独立窗口');
            } catch (err) {
                console.error('[st-chatu8] 创建画中画失败:', err);
                // ✅ 恢复 WebGL 透明背景
                const vp = getGlobalVideoPlayer();
                if (vp && vp.setPipBackground) {
                    vp.setPipBackground(false);
                }
                // 清理 PiP video 元素
                if (pipVideoElement) {
                    pipVideoElement.srcObject = null;
                    pipVideoElement.remove();
                    pipVideoElement = null;
                }
                $(event.target).prop('checked', false);
                settings.enable_chatu8_desktop_pet = false;
                saveSettingsDebounced();

                if (err.name === 'NotAllowedError') {
                    toastr.warning(
                        '画中画请求被拒绝。请确保通过用户操作（如点击）触发，且浏览器允许画中画。',
                        '独立窗口',
                        { timeOut: 5000 }
                    );
                } else {
                    toastr.error(
                        '创建画中画失败：' + err.message,
                        '独立窗口',
                        { timeOut: 5000 }
                    );
                }
            }
        } else {
            // 关闭画中画
            if (document.pictureInPictureElement) {
                await document.exitPictureInPicture().catch(() => { });
            }
            // ✅ 恢复 WebGL 透明背景
            const vp = getGlobalVideoPlayer();
            if (vp && vp.setPipBackground) {
                vp.setPipBackground(false);
            }
            if (pipVideoElement) {
                pipVideoElement.srcObject = null;
                pipVideoElement.remove();
                pipVideoElement = null;
            }
            toastr.info('智绘姬画中画已关闭', '独立窗口');
        }
    });

    // 切换传统FAB设置的显示/隐藏
    function toggleTraditionalFabSettings() {
        const videoEnabled = settings.enable_chatu8_fab_video === true;
        const traditionalSettings = $('#fab-traditional-settings');
        const desktopPetSettings = $('#fab-desktop-pet-settings');

        if (videoEnabled) {
            traditionalSettings.hide();
            desktopPetSettings.show();  // 视频模式启用时显示独立窗口选项
        } else {
            traditionalSettings.show();
            desktopPetSettings.hide();  // 视频模式关闭时隐藏独立窗口选项
            // 同时关闭独立窗口
            if (settings.enable_chatu8_desktop_pet) {
                settings.enable_chatu8_desktop_pet = false;
                $('#enable_chatu8_desktop_pet').prop('checked', false);
                saveSettingsDebounced();
                // 关闭画中画
                if (document.pictureInPictureElement) {
                    document.exitPictureInPicture().catch(() => { });
                }
                // 清理合成 Canvas 和 RAF
                if (pipVideoElement && pipVideoElement._compositeRafId) {
                    cancelAnimationFrame(pipVideoElement._compositeRafId);
                }
                if (pipVideoElement && pipVideoElement._compositeCanvas) {
                    pipVideoElement._compositeCanvas.remove();
                }
                if (pipVideoElement) {
                    pipVideoElement.srcObject = null;
                    pipVideoElement.remove();
                    pipVideoElement = null;
                }
            }
        }
    }

    // 悬浮球主题预设选择
    $('#chatu8_fab_theme').on('change', (event) => {
        const themeName = $(event.target).val();
        settings.chatu8_fab_theme = themeName;

        // 如果不是"自定义"，则应用预设的颜色和透明度
        if (themeName !== '自定义' && settings.fabThemes && settings.fabThemes[themeName]) {
            const theme = settings.fabThemes[themeName];
            settings.chatu8_fab_bg_color = theme.bgColor;
            settings.chatu8_fab_icon_color = theme.iconColor;
            settings.chatu8_fab_opacity = theme.opacity;

            // 更新UI
            $('#chatu8_fab_bg_color').val(theme.bgColor);
            $('#chatu8_fab_icon_color').val(theme.iconColor);
            $('#chatu8_fab_opacity').val(theme.opacity);
            $('#chatu8_fab_opacity_value').val(theme.opacity);
        }

        saveSettingsDebounced();
        applyFabSettings();
    });

    $('#chatu8_fab_bg_color').on('change', (event) => {
        settings.chatu8_fab_bg_color = $(event.target).val();
        // 手动修改颜色时，自动切换到"自定义"主题
        if (settings.chatu8_fab_theme !== '自定义') {
            settings.chatu8_fab_theme = '自定义';
            // 保存当前自定义值到自定义预设
            if (settings.fabThemes && settings.fabThemes['自定义']) {
                settings.fabThemes['自定义'].bgColor = settings.chatu8_fab_bg_color;
            }
            $('#chatu8_fab_theme').val('自定义');
        }
        saveSettingsDebounced();
        applyFabSettings();
    });
    $('#chatu8_fab_icon_color').on('change', (event) => {
        settings.chatu8_fab_icon_color = $(event.target).val();
        // 手动修改颜色时，自动切换到"自定义"主题
        if (settings.chatu8_fab_theme !== '自定义') {
            settings.chatu8_fab_theme = '自定义';
            // 保存当前自定义值到自定义预设
            if (settings.fabThemes && settings.fabThemes['自定义']) {
                settings.fabThemes['自定义'].iconColor = settings.chatu8_fab_icon_color;
            }
            $('#chatu8_fab_theme').val('自定义');
        }
        saveSettingsDebounced();
        applyFabSettings();
    });

    $('#chatu8_fab_icon_upload_btn').on('click', () => {
        document.getElementById('chatu8_fab_icon_upload_input')?.click();
    });
    $('#chatu8_fab_icon_upload_input').on('change', handleFabIconUpload);
    $('#chatu8_fab_icon_remove_btn').on('click', removeFabIconImage);

    $('#chatu8_fab_opacity, #chatu8_fab_opacity_value').on('input', (event) => {
        const value = parseFloat($(event.target).val());
        $('#chatu8_fab_opacity').val(value);
        $('#chatu8_fab_opacity_value').val(value);
        settings.chatu8_fab_opacity = value;
        // 手动修改透明度时，自动切换到"自定义"主题
        if (settings.chatu8_fab_theme !== '自定义') {
            settings.chatu8_fab_theme = '自定义';
            // 保存当前自定义值到自定义预设
            if (settings.fabThemes && settings.fabThemes['自定义']) {
                settings.fabThemes['自定义'].opacity = value;
            }
            $('#chatu8_fab_theme').val('自定义');
        }
        saveSettingsDebounced();
        applyFabSettings();
    });

    // 通用的居中函数
    function centerFabPosition() {
        const fab = document.getElementById('st-chatu8-fab');
        if (!fab) return;

        const fabWidth = fab.offsetWidth;
        const fabHeight = fab.offsetHeight;
        const screenWidth = window.innerWidth;
        const screenHeight = window.innerHeight;

        // 计算居中位置
        const centerLeft = (screenWidth - fabWidth) / 2;
        const centerTop = (screenHeight - fabHeight) / 2;

        // 应用位置
        fab.style.left = `${centerLeft}px`;
        fab.style.top = `${centerTop}px`;

        // 保存位置到设置
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

    $('#chatu8_fab_size, #chatu8_fab_size_value').on('input', (event) => {
        const value = parseInt($(event.target).val(), 10);
        $('#chatu8_fab_size').val(value);
        $('#chatu8_fab_size_value').val(value);

        // 兼容旧版本：将单一数值转换为对象
        if (typeof settings.chatu8_fab_size === 'number' || typeof settings.chatu8_fab_size === 'string') {
            const numValue = typeof settings.chatu8_fab_size === 'string' ? parseInt(settings.chatu8_fab_size, 10) : settings.chatu8_fab_size;
            settings.chatu8_fab_size = {
                desktop: numValue,
                mobile: numValue
            };
        }

        // 根据当前设备类型保存尺寸
        const isMobile = window.innerWidth <= 768;
        if (isMobile) {
            settings.chatu8_fab_size.mobile = value;
        } else {
            settings.chatu8_fab_size.desktop = value;
        }

        saveSettingsDebounced();

        // 使用专门的尺寸更新函数
        updateFabSize(value);

        // ✅ 调整大小后自动重置到屏幕中央
        setTimeout(() => {
            centerFabPosition();
        }, 50); // 延迟50ms确保尺寸已更新
    });

    // 重置悬浮球位置到屏幕中央
    $('#chatu8_fab_reset_position').on('click', () => {
        centerFabPosition();
        showToast('智绘姬位置已重置到屏幕中央', 'success');
    });

    allIDs.forEach(key => {
        if (ignoreIDs.includes(key)) return;
        const selector = generationTabs.reduce((acc, mode) => {
            const suffix = getSuffix(mode);
            if (document.getElementById(key + suffix)) {
                acc.push(`#${key}${suffix}`);
            }
            return acc;
        }, [`#${key}`]).join(', ');

        const element = $(selector);
        if (element.length) {
            const elType = element.prop('type');
            const event = (elType === 'text' || elType === 'number' || element.is('textarea')) ? 'input' : 'change';

            element.on(event, function () {
                let value;
                if (elType === 'checkbox') {
                    value = $(this).prop('checked').toString();
                } else {
                    value = $(this).val();
                }

                if (key === "sdUrl" || key === "comfyuiUrl") {
                    value = removeTrailingSlash(value);
                    validateUrlInput(this);
                }

                if (key === 'MODEL_NAME') {
                    value = normalizeBackslashPath(value);
                    $(this).val(value);
                }

                // For duplicated fields, they all write to the same setting
                const settingKey = key;
                settings[settingKey] = value;

                if (settingKey == "scriptEnabled") {

                    let conet = getContext()
                    const settings = extension_settings[extensionName];
                    if (conet && conet.chatId) {

                        conet.chatMetadata.variables.zhihuiji = settings.scriptEnabled

                    }

                }
                saveSettingsDebounced();

                // If the generation mode is changed, re-initialize the event handlers
                if (settingKey === 'mode') {
                    updateGenerationModeHandlers();
                    // 更新 ComfyUI 保活状态
                    updateKeepAliveStatus();
                }

                // If image alignment is changed, re-apply the image frame style
                if (settingKey === 'imageAlignment' || settingKey === 'imageSizeScale') {
                    const currentTheme = settings.themes?.[settings.theme_id] || {};
                    applyImageFrameStyle(settings.image_frame_style || '无样式', isThemeDark(currentTheme));
                }

                // If it's a duplicated field, sync the others
                if (element.length > 1) {
                    element.not(this).val(value);
                }
            });
        }
    });

    settingsModal.find('#nai3CharRef').on('change', function () {
        const checkbox = $(this);
        if (checkbox.prop('checked')) {
            stylishConfirm("不建议使用，每多一张参考图片就多收费5点，每次生图收费一次！")
                .then(confirmed => {
                    if (confirmed) {
                        settings.nai3CharRef = 'true';

                        // Mutual exclusivity: disable Vibe Transfer if Character Reference is enabled
                        if (settings.enableVibeGroupTransfer === 'true') {
                            settings.enableVibeGroupTransfer = 'false';
                            const vibeToggle = settingsModal.find('#enableVibeGroupTransfer');
                            if (vibeToggle.length) {
                                vibeToggle.prop('checked', false);
                            }
                            toastr.info('Vibe Transfer 已自动关闭，因为角色参考已启用', '角色参考');
                            addLog('[CharRef] Vibe Transfer disabled due to Character Reference activation');
                        }

                        saveSettingsDebounced();
                    } else {
                        checkbox.prop('checked', false);
                    }
                });
        } else {
            settings.nai3CharRef = 'false';
            saveSettingsDebounced();
        }
    });

    // Vibe Group Transfer toggle handler
    settingsModal.find('#enableVibeGroupTransfer').on('change', function () {
        const isEnabled = $(this).prop('checked');
        settings.enableVibeGroupTransfer = isEnabled ? 'true' : 'false';

        // Mutual exclusivity: disable single Vibe transfer if group transfer is enabled
        if (isEnabled && settings.nai3VibeTransfer === 'true') {
            settings.nai3VibeTransfer = 'false';
            const singleVibeToggle = settingsModal.find('#nai3VibeTransfer');
            if (singleVibeToggle.length) {
                singleVibeToggle.prop('checked', false);
            }
            console.log('[VibeGroup] Disabled single Vibe transfer (mutual exclusivity)');
        }

        // Mutual exclusivity: disable Character Reference if Vibe Transfer is enabled
        if (isEnabled && settings.nai3CharRef === 'true') {
            settings.nai3CharRef = 'false';
            const charRefToggle = settingsModal.find('#nai3CharRef');
            if (charRefToggle.length) {
                charRefToggle.prop('checked', false);
            }
            toastr.info('角色参考已自动关闭，因为 Vibe Transfer 已启用', 'Vibe Transfer');
            addLog('[VibeTransfer] Character Reference disabled due to Vibe Transfer activation');
        }

        saveSettingsDebounced();
        console.log('[VibeGroup] Vibe group transfer:', settings.enableVibeGroupTransfer);
    });

    // Single Vibe Transfer toggle handler (with mutual exclusivity)
    settingsModal.find('#nai3VibeTransfer').on('change', function () {
        const isEnabled = $(this).prop('checked');
        settings.nai3VibeTransfer = isEnabled ? 'true' : 'false';

        // Mutual exclusivity: disable group Vibe transfer if single transfer is enabled
        if (isEnabled && settings.enableVibeGroupTransfer === 'true') {
            settings.enableVibeGroupTransfer = 'false';
            const groupVibeToggle = settingsModal.find('#enableVibeGroupTransfer');
            if (groupVibeToggle.length) {
                groupVibeToggle.prop('checked', false);
            }
            console.log('[VibeGroup] Disabled Vibe group transfer (mutual exclusivity)');
        }

        saveSettingsDebounced();
        console.log('[NovelAI] Single Vibe transfer:', settings.nai3VibeTransfer);
    });

    // 监听 cache 更新事件
    window.addEventListener('comfyui-cache-updated', async (event) => {
        const cacheData = event.detail;

        // 不再存储到 settings，直接刷新 UI
        const changedSettings = { comfyuiCache: cacheData };
        const { refreshAffectedUI } = await import('./configHelper/configUIRefresh.js');
        refreshAffectedUI(changedSettings);

        console.log('[UI] ComfyUI cache 已更新并刷新 UI');
    });

    window.addEventListener('sd-cache-updated', async (event) => {
        const cacheData = event.detail;

        // 不再存储到 settings，直接刷新 UI
        const changedSettings = { sdCache: cacheData };
        const { refreshAffectedUI } = await import('./configHelper/configUIRefresh.js');
        refreshAffectedUI(changedSettings);

        console.log('[UI] SD cache 已更新并刷新 UI');
    });
}
