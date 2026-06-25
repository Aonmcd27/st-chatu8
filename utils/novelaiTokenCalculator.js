import { extensionFolderPath } from './config.js';

let transformersLoadPromise = null;
let tokenizer = null;

// 隔离加载 transformers，防止被其他插件定义的全局变量影响
async function loadTransformersIsolated() {
    if (transformersLoadPromise) return transformersLoadPromise;

    const scriptSrc = `${extensionFolderPath}/transformers.min.js`;
    const absoluteScriptSrc = new URL(scriptSrc, window.location.href).href;

    // 为了尽可能缩短屏蔽全局变量的时间，先触发并等待资源加载到缓存
    try {
        await fetch(absoluteScriptSrc);
    } catch (e) {
        console.warn("[st-chatu8] transformers pre-fetch failed, falling back to direct import", e);
    }

    // 1. 临时保存并屏蔽全局的模块加载器变量，防止 transformers 被它们劫持
    const originalDefine = window.define;
    const originalModule = window.module;
    const originalExports = window.exports;
    
    window.define = undefined;
    window.module = undefined;
    window.exports = undefined;

    try {
        // 由于已经 pre-fetch，这里的 import 执行会非常快
        const transformers = await import(absoluteScriptSrc);
        transformersLoadPromise = transformers;
        return transformers;
    } catch (error) {
        console.error('[st-chatu8] transformers load failed', error);
        transformersLoadPromise = null;
        throw error;
    } finally {
        // 2. 加载成功或失败后，立即恢复全局变量，不影响别人的使用
        window.define = originalDefine;
        window.module = originalModule;
        window.exports = originalExports;
    }
}

// 初始化分词器
export async function initNovelAITokenizer() {
    if (tokenizer) return;
    try {
        const transformers = await loadTransformersIsolated();
        const { AutoTokenizer, env } = transformers;
        
        env.allowLocalModels = false;
        const modelPath = "Xenova/t5-small";
        tokenizer = await AutoTokenizer.from_pretrained(modelPath);
    } catch (error) {
        console.error("[st-chatu8] 加载分词器失败:", error);
    }
}

// 计算 Token 数量 (严格对齐官网 T5 算法)
export async function calculateNovelAITokens(prompt) {
    if (!tokenizer) await initNovelAITokenizer();
    if (!tokenizer || !prompt) return 0;
    
    // 匹配官网 T5 算法的预处理逻辑
    let processedPrompt = prompt.replace(/[-+]?\d*\.?\d+::/g, ''); 
    processedPrompt = processedPrompt.replace(/::/g, ''); 
    processedPrompt = processedPrompt.replace(/[\r\n]+/g, ' ');

    try {
        const encoded = await tokenizer(processedPrompt);
        const tokenIds = Array.from(encoded.input_ids.data);
        return tokenIds.length; // 官网结果包含了结尾符 </s>，不需要减1
    } catch (error) {
        console.error("[st-chatu8] 计算 Token 时发生错误:", error);
        return 0;
    }
}

// 提取当前设置下的 AQT 和 UCP
export function getNovelAIQualityPresetsText(settings) {
    let aqt = "";
    if (settings.AQT_novelai != '' && settings.novelaimode == "nai-diffusion-4-curated-preview") {
        aqt = "rating:general, best quality, very aesthetic, absurdres";
    } else if (settings.AQT_novelai != '' && settings.novelaimode == "nai-diffusion-4-full") {
        aqt = "no text, best quality, very aesthetic, absurdres";
    } else if (settings.AQT_novelai != '' && settings.novelaimode == "nai-diffusion-4-5-full") {
        aqt = "very aesthetic, masterpiece, no text";
    } else if (settings.AQT_novelai != '' && settings.novelaimode == "nai-diffusion-4-5-curated") {
        aqt = "very aesthetic, masterpiece, no text, -0.8::feet::, rating:general";
    } else if (settings.AQT_novelai != '' && settings.novelaimode == "nai-diffusion-3") {
        aqt = "best quality, amazing quality, very aesthetic, absurdres";
    }

    let ucp = "";
    if (settings.novelaimode == "nai-diffusion-3" && settings.UCP_novelai == 'Heavy') {
        ucp = "lowres, {bad}, error, fewer, extra, missing, worst quality, jpeg artifacts, bad quality, watermark, unfinished, displeasing, chromatic aberration, signature, extra digits, artistic error, username, scan, [abstract]"
    } else if (settings.novelaimode == "nai-diffusion-3" && settings.UCP_novelai == 'Light') {
        ucp = "lowres, jpeg artifacts, worst quality, watermark, blurry, very displeasing"
    } else if (settings.novelaimode == "nai-diffusion-3" && settings.UCP_novelai == 'Human Focus') {
        ucp = "lowres, {bad}, error, fewer, extra, missing, worst quality, jpeg artifacts, bad quality, watermark, unfinished, displeasing, chromatic aberration, signature, extra digits, artistic error, username, scan, [abstract], bad anatomy, bad hands, @_@, mismatched pupils, heart-shaped pupils, glowing eyes"
    } else if (settings.novelaimode == "nai-diffusion-4-full" && settings.UCP_novelai == 'Heavy') {
        ucp = "blurry, lowres, error, film grain, scan artifacts, worst quality, bad quality, jpeg artifacts, very displeasing, chromatic aberration, multiple views, logo, too many watermarks, white blank page, blank page"
    } else if (settings.novelaimode == "nai-diffusion-4-full" && settings.UCP_novelai == 'Light') {
        ucp = "blurry, lowres, error, worst quality, bad quality, jpeg artifacts, very displeasing, white blank page, blank page"
    } else if (settings.novelaimode == "nai-diffusion-4-curated-preview" && settings.UCP_novelai == 'Heavy') {
        ucp = "blurry, lowres, error, film grain, scan artifacts, worst quality, bad quality, jpeg artifacts, very displeasing, chromatic aberration, logo, dated, signature, multiple views, gigantic breasts, white blank page, blank page"
    } else if (settings.novelaimode == "nai-diffusion-4-curated-preview" && settings.UCP_novelai == 'Light') {
        ucp = "blurry, lowres, error, worst quality, bad quality, jpeg artifacts, very displeasing, logo, dated, signature, white blank page, blank page"
    } else if (settings.novelaimode == "nai-diffusion-4-5-curated" && settings.UCP_novelai == 'Human Focus') {
        ucp = "blurry, lowres, upscaled, artistic error, film grain, scan artifacts, bad anatomy, bad hands, worst quality, bad quality, jpeg artifacts, very displeasing, chromatic aberration, halftone, multiple views, logo, too many watermarks, @_@, mismatched pupils, glowing eyes, negative space, blank page"
    } else if (settings.novelaimode == "nai-diffusion-4-5-curated" && settings.UCP_novelai == 'Heavy') {
        ucp = "blurry, lowres, upscaled, artistic error, film grain, scan artifacts, worst quality, bad quality, jpeg artifacts, very displeasing, chromatic aberration, halftone, multiple views, logo, too many watermarks, negative space, blank page"
    } else if (settings.novelaimode == "nai-diffusion-4-5-curated" && settings.UCP_novelai == 'Light') {
        ucp = "blurry, lowres, upscaled, artistic error, film grain, scan artifacts, worst quality, bad quality, jpeg artifacts, very displeasing, chromatic aberration, halftone, multiple views, logo, too many watermarks, negative space, blank page"
    } else if (settings.novelaimode == "nai-diffusion-4-5-full" && settings.UCP_novelai == 'Human Focus') {
        ucp = "lowres, artistic error, film grain, scan artifacts, worst quality, bad quality, jpeg artifacts, very displeasing, chromatic aberration, dithering, halftone, screentone, multiple views, logo, too many watermarks, negative space, blank page, @_@, mismatched pupils, glowing eyes, bad anatomy"
    } else if (settings.novelaimode == "nai-diffusion-4-5-full" && settings.UCP_novelai == 'Heavy') {
        ucp = "lowres, artistic error, film grain, scan artifacts, worst quality, bad quality, jpeg artifacts, very displeasing, chromatic aberration, dithering, halftone, screentone, multiple views, logo, too many watermarks, negative space, blank page"
    } else if (settings.novelaimode == "nai-diffusion-4-5-full" && settings.UCP_novelai == 'Light') {
        ucp = "lowres, artistic error, scan artifacts, worst quality, bad quality, jpeg artifacts, multiple views, very displeasing, too many watermarks, negative space, blank page"
    } else if (settings.novelaimode == "nai-diffusion-4-5-full" && settings.UCP_novelai == 'Furry Focus') {
        ucp = "{worst quality}, distracting watermark, unfinished, bad quality, {widescreen}, upscale, {sequence}, {{grandfathered content}}, blurred foreground, chromatic aberration, sketch, everyone, [sketch background], simple, [flat colors], ych (character), outline, multiple scenes, [[horror (theme)]], comic"
    }
    return { aqt, ucp };
}
