// @ts-nocheck
/**
 * Tag 自动补全模块
 * 处理角色设定和服装管理的 tag 自动补全功能
 */

import { extension_settings } from "../../../../../../extensions.js";
import { extensionName } from '../../config.js';
import { dbs } from '../../database.js';

// ========== Tag 自动补全功能 ==========

/**
 * 处理tag自动补全
 */
async function handleAutocomplete(inputEl, resultsEl) {
    const text = inputEl.value;
    const cursorPosition = inputEl.selectionStart;

    // 找到光标前后的逗号位置
    const textBeforeCursor = text.substring(0, cursorPosition);
    const textAfterCursor = text.substring(cursorPosition);

    const lastCommaBefore = Math.max(textBeforeCursor.lastIndexOf(','), textBeforeCursor.lastIndexOf('，'));
    const nextCommaAfter = textAfterCursor.search(/[,，]/);

    const startIndex = lastCommaBefore + 1;
    const endIndex = nextCommaAfter !== -1 ? cursorPosition + nextCommaAfter : text.length;

    const query = text.substring(startIndex, endIndex).trim();

    if (query.length < 1) {
        resultsEl.style.display = 'none';
        return;
    }

    try {
        // 从设置中读取搜索选项
        const settings = extension_settings[extensionName];
        const startsWith = String(settings.vocabulary_search_startswith) === 'true';
        const limit = parseInt(settings.vocabulary_search_limit, 10);
        const sortBy = settings.vocabulary_search_sort;

        const results = await dbs.searchTags(query, { startsWith, limit, sortBy });
        resultsEl.innerHTML = '';

        if (results.length > 0) {
            results.forEach(tag => {
                const item = document.createElement('div');
                item.className = 'ch-autocomplete-item';
                item.textContent = `${tag.name} (${tag.translation})`;
                // 存储 tag 数据到元素上，用于事件委托
                item.dataset.tagName = tag.name;
                item.dataset.tagTranslation = tag.translation;
                resultsEl.appendChild(item);
            });
            resultsEl.style.display = 'block';
        } else {
            resultsEl.style.display = 'none';
        }
    } catch (error) {
        console.error('Tag search failed:', error);
        resultsEl.style.display = 'none';
    }
}

/**
 * 处理补全结果点击
 */
function handleResultClick(inputEl, resultsEl, tag) {
    const text = inputEl.value;
    const cursorPosition = inputEl.selectionStart;

    // 找到光标前后的逗号位置
    const textBeforeCursor = text.substring(0, cursorPosition);
    const textAfterCursor = text.substring(cursorPosition);

    const lastCommaBefore = Math.max(textBeforeCursor.lastIndexOf(','), textBeforeCursor.lastIndexOf('，'));
    const nextCommaAfter = textAfterCursor.search(/[,，]/);

    const startIndex = lastCommaBefore + 1;
    const endIndex = nextCommaAfter !== -1 ? cursorPosition + nextCommaAfter : text.length;

    // tag参数是完整的tag对象
    const newTagText = `${tag.name}（${tag.translation}）`;

    // 构建新文本
    const textBefore = text.substring(0, startIndex);
    const textAfter = text.substring(endIndex);

    // 保留前导空格
    const leadingSpace = text.substring(startIndex, startIndex + 1) === ' ' ? ' ' : '';

    // 检查后面是否有内容，如果有且不是逗号开头则添加逗号
    const trimmedTextAfter = textAfter.trim();
    const trailingComma = trimmedTextAfter.length > 0 && !trimmedTextAfter.startsWith(',') ? ', ' : '';

    const newText = `${textBefore.trim() ? textBefore : ''}${leadingSpace}${newTagText}${trailingComma}${textAfter.trim() ? textAfter : ''}`;

    // 转换中文逗号为英文逗号
    inputEl.value = newText.replace(/，/g, ',');
    resultsEl.style.display = 'none';
    inputEl.focus();

    // 设置光标位置到插入的 tag 之后
    const newCursorPosition = (textBefore + leadingSpace + newTagText + trailingComma).length;
    setTimeout(() => inputEl.setSelectionRange(newCursorPosition, newCursorPosition), 0);

    // 触发input事件以更新未保存警告
    $(inputEl).trigger('input');
}

/**
 * 初始化tag自动补全
 */
export function initTagAutocomplete() {
    console.log('[Character] Initializing tag autocomplete...');

    // 关闭点击外部时隐藏自动补全 - 只绑定一次
    document.addEventListener('click', (event) => {
        // 检查点击是否在textarea或补全结果内
        if (!event.target.closest('.st-chatu8-field-col') && !event.target.closest('.ch-autocomplete-results')) {
            $('.ch-autocomplete-results').hide();
        }
    });

    // 角色设定的输入框 - 包含所有带自动补全的字段
    const characterFields = [
        'char_photo_prompt',
        'char_characterTraits',
        'char_facialFeatures',
        'char_facialFeaturesBack',
        'char_upperBodySFW',
        'char_upperBodySFWBack',
        'char_fullBodySFW',
        'char_fullBodySFWBack',
        'char_upperBodyNSFW',
        'char_upperBodyNSFWBack',
        'char_fullBodyNSFW',
        'char_fullBodyNSFWBack'
    ];
    characterFields.forEach(fieldId => {
        const textarea = document.getElementById(fieldId);
        const resultsContainer = document.getElementById(`${fieldId}-results`);
        console.log(`[Character] Field ${fieldId}: textarea=${!!textarea}, results=${!!resultsContainer}`);
        if (textarea && resultsContainer) {
            // 使用带命名空间的 off 防止误删其他绑定（如 token 计数器）
            $(textarea).off('input.autocomplete').on('input.autocomplete', () => handleAutocomplete(textarea, resultsContainer));
            // 防止点击textarea时关闭补全
            $(textarea).off('click').on('click', (event) => event.stopPropagation());

            // 使用事件委托处理补全项点击
            $(resultsContainer).off('click').on('click', '.ch-autocomplete-item', function (event) {
                event.stopPropagation();
                const tagName = $(this).data('tagName');
                const tagTranslation = $(this).data('tagTranslation');
                if (tagName && tagTranslation !== undefined) {
                    handleResultClick(textarea, resultsContainer, { name: tagName, translation: tagTranslation });
                }
            });
            console.log(`[Character] Successfully bound autocomplete to ${fieldId}`);
        } else {
            console.warn(`[Character] Could not find elements for ${fieldId}`);
        }
    });

    // 服装管理的输入框 - 包含所有带自动补全的字段
    const outfitFields = [
        'outfit_upperBody',
        'outfit_upperBodyBack',
        'outfit_fullBody',
        'outfit_fullBodyBack'
    ];
    outfitFields.forEach(fieldId => {
        const textarea = document.getElementById(fieldId);
        const resultsContainer = document.getElementById(`${fieldId}-results`);
        console.log(`[Character] Field ${fieldId}: textarea=${!!textarea}, results=${!!resultsContainer}`);
        if (textarea && resultsContainer) {
            // 使用带命名空间的 off 防止误删其他绑定（如 token 计数器）
            $(textarea).off('input.autocomplete').on('input.autocomplete', () => handleAutocomplete(textarea, resultsContainer));
            // 防止点击textarea时关闭补全
            $(textarea).off('click').on('click', (event) => event.stopPropagation());

            // 使用事件委托处理补全项点击
            $(resultsContainer).off('click').on('click', '.ch-autocomplete-item', function (event) {
                event.stopPropagation();
                const tagName = $(this).data('tagName');
                const tagTranslation = $(this).data('tagTranslation');
                if (tagName && tagTranslation !== undefined) {
                    handleResultClick(textarea, resultsContainer, { name: tagName, translation: tagTranslation });
                }
            });
            console.log(`[Character] Successfully bound autocomplete to ${fieldId}`);
        } else {
            console.warn(`[Character] Could not find elements for ${fieldId}`);
        }
    });

    console.log('[Character] Tag autocomplete initialized');
}
