// @ts-nocheck
/**
 * 标签自动补全逻辑
 */

import { extension_settings } from "../../../../../extensions.js";
import { extensionName } from '../config.js';
import { dbs } from '../database.js';

/**
 * 处理自动补全搜索
 * @param {HTMLTextAreaElement} inputEl - 输入元素
 * @param {HTMLElement} resultsEl - 结果容器元素
 */
export async function handleAutocomplete(inputEl, resultsEl) {
    const text = inputEl.value;
    const cursorPosition = inputEl.selectionStart;

    // Find the boundaries of the tag under the cursor
    const textBeforeCursor = text.substring(0, cursorPosition);
    const textAfterCursor = text.substring(cursorPosition);

    // Since we replace "，" with "," on input, we only need to look for ","
    const lastCommaBefore = textBeforeCursor.lastIndexOf(',');
    const nextCommaAfter = textAfterCursor.indexOf(',');

    const startIndex = lastCommaBefore + 1;
    const endIndex = nextCommaAfter !== -1 ? cursorPosition + nextCommaAfter : text.length;

    const currentTag = text.substring(startIndex, endIndex).trim();

    if (currentTag.length < 1) {
        resultsEl.style.display = 'none';
        return;
    }

    try {
        if (!extension_settings || !extension_settings[extensionName]) {
            console.warn("extension_settings not available.");
            return;
        }

        const settings = extension_settings[extensionName];
        const startsWith = String(settings.vocabulary_search_startswith) === 'true';
        const limit = parseInt(settings.vocabulary_search_limit, 10);
        const sortBy = settings.vocabulary_search_sort;

        // Use the dbs object from the top window context if available, otherwise fallback
        const searcher = dbs;
        const results = await searcher.searchTags(currentTag, { startsWith, limit, sortBy });

        resultsEl.innerHTML = '';

        if (results.length > 0) {
            results.forEach(tag => {
                const item = document.createElement('div');
                item.className = 'ch-autocomplete-item';
                item.textContent = `${tag.name} (${tag.translation})`;
                item.addEventListener('mousedown', (e) => { // Use mousedown to prevent focus loss
                    e.preventDefault();
                    handleResultClick(inputEl, resultsEl, tag.name + "（" + tag.translation + "）", startIndex, endIndex);
                });
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
 * 处理自动补全结果点击
 * @param {HTMLTextAreaElement} inputEl - 输入元素
 * @param {HTMLElement} resultsEl - 结果容器元素
 * @param {string} tag - 选中的标签
 * @param {number} startIndex - 替换起始位置
 * @param {number} endIndex - 替换结束位置
 */
export function handleResultClick(inputEl, resultsEl, tag, startIndex, endIndex) {
    const originalText = inputEl.value;
    const textBefore = originalText.substring(0, startIndex);
    const textAfter = originalText.substring(endIndex);

    // Preserve leading/trailing spaces if they exist
    const leadingSpace = originalText.substring(startIndex, startIndex + 1) === ' ' ? ' ' : '';

    // Check if there is content after the replaced tag.
    // Add a comma only if the content exists and doesn't already start with a comma.
    const trimmedTextAfter = textAfter.trim();
    const trailingComma = trimmedTextAfter.length > 0 && !trimmedTextAfter.startsWith(',') ? ', ' : '';

    const newText = `${textBefore.trim() ? textBefore : ''}${leadingSpace}${tag}${trailingComma}${textAfter.trim() ? textAfter : ''}`;

    inputEl.value = newText; // No need for comma replacement here, as it's handled live on input
    // Trigger the input event so that token counts and other listeners update
    inputEl.dispatchEvent(new Event('input', { bubbles: true }));
    resultsEl.style.display = 'none';
    // 恢复对话框大小
    if (typeof resultsEl.restoreDialogSize === 'function') {
        resultsEl.restoreDialogSize();
    }
    inputEl.focus();

    // Set cursor position after the inserted tag
    const newCursorPosition = (textBefore + leadingSpace + tag + trailingComma).length;
    setTimeout(() => inputEl.setSelectionRange(newCursorPosition, newCursorPosition), 0);
}
