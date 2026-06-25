// @ts-nocheck
/**
 * iframe.js - 薄导入层
 * 保持向后兼容，将功能委托给 iframe/ 子目录下的模块
 */

// 重导出主要公共 API
export {
    processAllImagePlaceholders,
    initializeImageProcessing
} from './iframe/index.js';
