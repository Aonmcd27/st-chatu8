// @ts-nocheck
import { extension_settings } from "../../../../../extensions.js";
import { saveSettingsDebounced } from "../../../../../../script.js";
import { getSuffix } from '../ui_common.js';
import { extensionName } from "../config.js";

function ComfyuiaddLORA() {
    const activeTab = $('.st-chatu8-tab-content.active');
    const fixedPrompt = activeTab.find('#fixedPrompt_comfyui');
    const loraSelect = document.getElementById("ComfyuiLORA");

    if (!loraSelect.value || loraSelect.value.trim() === '' || loraSelect.disabled) {
        if (extension_settings[extensionName].client == "jiuguan") {
            alert("抱歉酒馆客户端无法支持lora获取,请参考文档尝试使用浏览器客户端");
        } else {
            alert("请先连接ComfyUI获取lora");
        }
        return;
    }
    // if (loraSelect.value.includes("\\")) {
    //     alert("LORA名称无效，请不要选择文件夹内的LORA。");
    //     return;
    // }

    const currentVal = fixedPrompt.val();
    const separator = currentVal.trim() === '' ? '' : ', ';
    fixedPrompt.val(currentVal + separator + `<lora:${loraSelect.value}:1>`);
    fixedPrompt.trigger('input');
}

function sd_add_lora() {
    const activeTab = $('.st-chatu8-tab-content.active');
    const fixedPrompt = activeTab.find('#fixedPrompt');
    const loraSelect = document.getElementById("sd_cchatu_8_lora");

    if (!loraSelect.value || loraSelect.value.trim() === '' || loraSelect.disabled) {
        if (extension_settings[extensionName].client == "jiuguan") {
            alert("抱歉酒馆客户端无法支持lora获取,请参考文档尝试使用浏览器客户端");
        } else {
            alert("请先连接SD获取lora");
        }
        return;
    }

    const currentVal = fixedPrompt.val();
    const separator = currentVal.trim() === '' ? '' : ', ';
    fixedPrompt.val(currentVal + separator + `<lora:${loraSelect.value}:1>`);
    fixedPrompt.trigger('input');
}

export function initLoraControls(settingsModal) {
    settingsModal.find('#ComfyuiaddLORA').on('click', ComfyuiaddLORA);
    settingsModal.find('#sd_add_lora').on('click', sd_add_lora);
}
