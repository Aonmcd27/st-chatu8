// @ts-nocheck
/**
 * 简化的数据存储模块
 * 
 * 设计思路：
 * 1. 直接将 JSON 数据转换为 base64
 * 2. 添加 "data:image/png;base64," 前缀伪装成 PNG
 * 3. 服务器端保存时使用 .png 后缀
 */

export class ImageSteganography {
    constructor() {
        this.MIME_TYPE = 'data:image/png;base64,';
    }

    /**
     * 编码：将 JSON 数据编码为伪装的 PNG base64
     * @param {Object} jsonData - 要编码的 JSON 数据
     * @returns {Promise<string>} Base64 编码的"PNG"数据
     */
    async encode(jsonData) {
        try {
            // 1. 序列化为 JSON 字符串
            const jsonStr = JSON.stringify(jsonData);


            // 2. 转换为 base64
            const base64Data = this.stringToBase64(jsonStr);

            // 3. 添加 PNG MIME 类型前缀
            const result = this.MIME_TYPE + base64Data;


            return result;

        } catch (error) {
            console.error('[Stego] 编码失败:', error);
            throw error;
        }
    }

    /**
     * 解码：从伪装的 PNG base64 中提取 JSON 数据
     * @param {string} imageBase64 - Base64 编码的"PNG"数据
     * @returns {Promise<Object>} 解码后的 JSON 对象
     */
    async decode(imageBase64) {
        try {
            // 1. 移除 MIME 类型前缀
            let base64Data = imageBase64;
            if (base64Data.startsWith(this.MIME_TYPE)) {
                base64Data = base64Data.substring(this.MIME_TYPE.length);
            } else if (base64Data.startsWith('data:')) {
                // 处理其他 data URL 格式
                const commaIndex = base64Data.indexOf(',');
                if (commaIndex !== -1) {
                    base64Data = base64Data.substring(commaIndex + 1);
                }
            }

            // 2. Base64 解码为字符串
            const jsonStr = this.base64ToString(base64Data);

            // 3. 解析 JSON
            const jsonData = JSON.parse(jsonStr);


            return jsonData;

        } catch (error) {
            console.error('[Stego] 解码失败:', error);
            throw error;
        }
    }

    /**
     * 字符串转 Base64
     * @param {string} str 
     * @returns {string}
     */
    stringToBase64(str) {
        const encoder = new TextEncoder();
        const uint8Array = encoder.encode(str);
        return this.uint8ArrayToBase64(uint8Array);
    }

    /**
     * Base64 转字符串
     * @param {string} base64 
     * @returns {string}
     */
    base64ToString(base64) {
        const uint8Array = this.base64ToUint8Array(base64);
        const decoder = new TextDecoder();
        return decoder.decode(uint8Array);
    }

    /**
     * Uint8Array 转 Base64
     * @param {Uint8Array} uint8Array 
     * @returns {string}
     */
    uint8ArrayToBase64(uint8Array) {
        let binary = '';
        const len = uint8Array.byteLength;
        for (let i = 0; i < len; i++) {
            binary += String.fromCharCode(uint8Array[i]);
        }
        return window.btoa(binary);
    }

    /**
     * Base64 转 Uint8Array
     * @param {string} base64 
     * @returns {Uint8Array}
     */
    base64ToUint8Array(base64) {
        const binaryString = window.atob(base64);
        const len = binaryString.length;
        const bytes = new Uint8Array(len);
        for (let i = 0; i < len; i++) {
            bytes[i] = binaryString.charCodeAt(i);
        }
        return bytes;
    }

    /**
     * 验证数据完整性
     * @param {string} imageBase64 - Base64 编码的数据
     * @returns {Promise<boolean>}
     */
    async verify(imageBase64) {
        try {
            await this.decode(imageBase64);
            return true;
        } catch {
            return false;
        }
    }
}
