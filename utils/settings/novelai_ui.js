// @ts-nocheck
import { extension_settings } from "../../../../../extensions.js";
import { saveSettingsDebounced } from "../../../../../../script.js";
import { extensionName } from '../config.js';

function updateNai3OptionsVisibility() {
    const novelaiModeSelect = document.getElementById('novelaimode');
    const smField = document.getElementById('st-chatu8-nai3-sm-field');
    const dynField = document.getElementById('st-chatu8-nai3-dyn-field');
    const deceispField = document.getElementById('st-chatu8-nai3-deceisp-field');

    if (!novelaiModeSelect || !smField || !dynField || !deceispField) return;

    const selectedModel = novelaiModeSelect.value;
    const isNai3 = selectedModel === 'nai-diffusion-3';

    smField.style.display = isNai3 ? 'flex' : 'none';
    dynField.style.display = isNai3 ? 'flex' : 'none';
    deceispField.style.display = isNai3 ? 'flex' : 'none';
}

function updateNovelaiReferenceSectionsVisibility() {
    const novelaiModeSelect = document.getElementById('novelaimode');
    const vibeSection = document.getElementById('nai-vibe-transfer-section');
    const charRefSection = document.getElementById('nai-char-ref-section');

    if (!novelaiModeSelect || !vibeSection || !charRefSection) return;

    const selectedModel = novelaiModeSelect.value;

    vibeSection.style.display = selectedModel === 'nai-diffusion-3' ? 'block' : 'none';

    const isCharRefVisible = selectedModel === 'nai-diffusion-4-5-curated' || selectedModel === 'nai-diffusion-4-5-full';
    charRefSection.style.display = isCharRefVisible ? 'block' : 'none';
}

function updateNovelaiUcpOptions() {
    const settings = extension_settings[extensionName];
    const novelaiModeSelect = document.getElementById('novelaimode');
    const ucpSelect = document.getElementById('UCP_novelai');

    if (!novelaiModeSelect || !ucpSelect) return;

    const selectedModel = novelaiModeSelect.value;
    const currentValue = settings.UCP_novelai;
    ucpSelect.innerHTML = '';

    const options = {
        '无': '',
        'Heavy': 'Heavy',
        'Light': 'Light',
    };

    if (selectedModel === 'nai-diffusion-3' || selectedModel === 'nai-diffusion-4-5-full') {
        options['Human Focus'] = 'Human Focus';
    }
    if (selectedModel === 'nai-diffusion-4-5-full') {
        options['Furry Focus'] = 'Furry Focus';
    }

    options['作者预设'] = 'bad proportions, out of focus, username, text, bad anatomy, lowres, worstquality, watermark, cropped, bad body, deformed, mutated, disfigured, poorly drawn face, malformed hands, extra arms, extra limb, missing limb, too many fingers, extra legs, bad feet, missing fingers, fused fingers, acnes, floating limbs, disconnected limbs, long neck, long body, mutation, ugly, blurry, low quality, sketches, normal quality, monochrome, grayscale, signature, logo, jpeg artifacts, unfinished, displeasing, chromatic aberration, extra digits, artistic error, scan, abstract, photo, realism, screencap';
    options['作者预set 2'] = 'negativeXL_D, negativeXL, source_furry, extra limbs, deformations, long fingers, fused fingers, inaccurate_anatomy, bad proportions, poorly drawn hands, bad hands, extra_fingers, extra_hand, extra_arm, distorted fingers, ugly hands, creepy hands, six fingers, malformed fingers, long_fingers, interlocked fingers:1.2, ugly, deformed, uneven, asymmetrical, unnatural, missing fingers, extra digit, fewer digits, opaque eyes, small eyes, ugly eyes, blurred eyes, bad face, (bad anatomy, ugly face:1.2), (worst quality, low quality, not detailed, low resolution:1.2), motion_blur, blur, blur_censor, blurry, simple_background, text, error, cropped, normal quality, jpeg artifacts, watermark, logo, signature, username, artist name';

    for (const [text, value] of Object.entries(options)) {
        const option = new Option(text, value);
        ucpSelect.add(option);
    }

    ucpSelect.value = currentValue;
    if (ucpSelect.selectedIndex === -1) {
        ucpSelect.value = 'Heavy';
        settings.UCP_novelai = 'Heavy';
        saveSettingsDebounced();
    }
}

function updateNovelaiModelSchedule() {
    const settings = extension_settings[extensionName];
    const novelaiModeSelect = document.getElementById('novelaimode');
    const scheduleSelect = document.getElementById('Schedule');
    const samplerSelect = document.getElementById('novelai_sampler');

    if (!novelaiModeSelect || !scheduleSelect || !samplerSelect) return;

    updateNai3OptionsVisibility();
    updateNovelaiUcpOptions();
    updateNovelaiReferenceSectionsVisibility();

    const selectedModel = novelaiModeSelect.value;
    const nativeOption = [...scheduleSelect.options].find(opt => opt.value === 'native');
    const ddimOption = [...samplerSelect.options].find(opt => opt.value === 'ddim_v3');

    if (selectedModel === 'nai-diffusion-3') {
        if (ddimOption) ddimOption.style.display = '';

        if (!nativeOption) {
            const option = new Option('native', 'native');
            scheduleSelect.insertBefore(option, scheduleSelect.firstChild);
            if (settings.Schedule === 'native') {
                scheduleSelect.value = 'native';
            }
        }
    } else {
        if (ddimOption) {
            ddimOption.style.display = 'none';
            if (samplerSelect.value === 'ddim_v3') {
                samplerSelect.value = 'k_euler';
                $(samplerSelect).trigger('change');
            }
        }

        if (nativeOption) {
            if (scheduleSelect.value === 'native') {
                scheduleSelect.value = 'karras';
                $(scheduleSelect).trigger('change');
            }
            nativeOption.remove();
        }
    }
}

function updateNovelaiOtherSiteVisibility() {
    const clientSelect = document.getElementById('client');
    const novelaiSiteSelect = document.getElementById('novelaisite');
    const otherSiteField = document.getElementById('novelai-other-site-field');

    if (!clientSelect || !novelaiSiteSelect || !otherSiteField) return;

    const shouldShow = clientSelect.value !== 'jiuguan' && novelaiSiteSelect.value !== '官网';
    otherSiteField.style.display = shouldShow ? 'flex' : 'none';
}

function updateNovelaiScheduleVisibility() {
    const sampler = document.getElementById('novelai_sampler');
    const scheduleField = document.querySelector('#Schedule')?.closest('.st-chatu8-field');
    const scheduleSelect = document.getElementById('Schedule');

    if (!sampler || !scheduleField || !scheduleSelect) return;

    const selectedSampler = sampler.value;

    if (selectedSampler === 'ddim_v3') {
        scheduleField.style.display = 'none';
    } else {
        scheduleField.style.display = 'flex';
        $(scheduleSelect).trigger('change');
    }
}

export function initNovelaiUI(settingsModal) {
    settingsModal.find('#novelai_sampler').on('change', updateNovelaiScheduleVisibility);
    settingsModal.find('#novelaimode').on('change', updateNovelaiModelSchedule);
    settingsModal.find('#client').on('change', updateNovelaiOtherSiteVisibility);
    settingsModal.find('#novelaisite').on('change', updateNovelaiOtherSiteVisibility);

    settingsModal.find('#novelaiApiToggle').on('click', function () {
        const input = settingsModal.find('#novelaiApi')[0];
        const icon = $(this).find('i');
        if (input.type === 'password') {
            input.type = 'text';
            icon.removeClass('fa-eye').addClass('fa-eye-slash');
        } else {
            input.type = 'password';
            icon.removeClass('fa-eye-slash').addClass('fa-eye');
        }
    });

    // Initial calls
    updateNovelaiScheduleVisibility();
    updateNovelaiModelSchedule();
    updateNovelaiOtherSiteVisibility();
}
