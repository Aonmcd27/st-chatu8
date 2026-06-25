import { extension_settings } from "../../../../../extensions.js";
import { saveSettingsDebounced } from "../../../../../../script.js";
import { extensionName, extensionFolderPath } from '../config.js';
import { dbs } from "../database.js";
import { showToast } from "../ui_common.js";

let VOCABULARY_FILE_LIST,
    VOCABULARY_INSTALL_ALL_BTN,
    VOCABULARY_UNINSTALL_ALL_BTN,
    VOCABULARY_SEARCH_INPUT,
    VOCABULARY_SEARCH_BTN,
    VOCABULARY_SEARCH_RESULTS,
    VOCABULARY_TREE_CONTAINER,
    VOCABULARY_SEARCH_STARTSWITH,
    VOCABULARY_SEARCH_LIMIT,
    VOCABULARY_SEARCH_SORT,
    VOCABULARY_SELECTED_TAGS,
    VOCABULARY_TAG_BACKSPACE,
    VOCABULARY_TAG_CLEAR,
    VOCABULARY_TAG_COPY,
    VOCABULARY_MANUAL_TAG_ORIGINAL_INPUT,
    VOCABULARY_MANUAL_TAG_TRANSLATION_INPUT,
    VOCABULARY_MANUAL_TAG_ADD_BTN,
    VOCABULARY_MANUAL_TAGS_LIST,
    VOCABULARY_MANUAL_TAGS_REFRESH_BTN,
    VOCABULARY_MANUAL_TAGS_EXPORT_BTN,
    VOCABULARY_MANUAL_TAGS_IMPORT_BTN,
    VOCABULARY_MANUAL_TAGS_IMPORT_INPUT,
    VOCABULARY_MANUAL_TAGS_FILTER_INPUT;

let cachedTagTreeData = null;

const TAG_DATA_PATH = `${extensionFolderPath}/tagData/`;
// WARNING: This is a simple key for demonstration. For real security, use a more secure key management method.
const encryptionKey = 'a-very-secret-key-that-is-not-so-secret';

async function buildTagTree() {
    try {
        const installed = await dbs.getInstalledVocabularies();
        const tagsJsonInstalled = installed.some(item => item.fileName === 'tags.json');

        if (!tagsJsonInstalled) {
            cachedTagTreeData = null; // Ensure cache is cleared if uninstalled
            VOCABULARY_TREE_CONTAINER.innerHTML = '<p>请先从上方列表中安装 <code>tags.json</code> 以启用标签浏览器。</p>';
            return;
        }

        let data;
        if (cachedTagTreeData) {
            data = cachedTagTreeData;
        } else {
            data = await dbs.getTagsTreeData();
            if (!data || !data.tag_groups) {
                throw new Error('无法从数据库加载结构化标签数据。');
            }
            cachedTagTreeData = data; // Cache the data
        }
        
        const { tag_groups, tag_tags } = data;

        const tagsBySubgroupId = tag_tags.reduce((acc, tag) => {
            if (!acc[tag.subgroup_id]) {
                acc[tag.subgroup_id] = [];
            }
            acc[tag.subgroup_id].push(tag);
            return acc;
        }, {});

        const tree = document.createElement('ul');
        tree.className = 'st-chatu8-tree';

        tag_groups.forEach(group => {
            const groupItem = document.createElement('li');
            groupItem.className = 'st-chatu8-tree-item';
            
            const groupToggle = document.createElement('span');
            groupToggle.className = 'st-chatu8-tree-toggle';
            groupToggle.textContent = '▶ ';
            
            const groupName = document.createElement('span');
            groupName.textContent = group.name;
            groupName.className = 'st-chatu8-tree-group';

            const groupContent = document.createElement('div');
            groupContent.className = 'st-chatu8-tree-content';
            groupContent.appendChild(groupToggle);
            groupContent.appendChild(groupName);
            
            groupItem.appendChild(groupContent);
            
            const subgroupList = document.createElement('ul');
            subgroupList.className = 'st-chatu8-tree-sublist';
            subgroupList.style.display = 'none';

            if (group.subgroups && group.subgroups.length > 0) {
                group.subgroups.forEach(subgroup => {
                    const subgroupItem = document.createElement('li');
                    subgroupItem.className = 'st-chatu8-tree-item';

                    const subgroupToggle = document.createElement('span');
                    subgroupToggle.className = 'st-chatu8-tree-toggle';
                    subgroupToggle.textContent = '▶ ';
                    
                    const subgroupName = document.createElement('span');
                    subgroupName.textContent = subgroup.name;
                    subgroupName.className = 'st-chatu8-tree-subgroup';

                    const subgroupContent = document.createElement('div');
                    subgroupContent.className = 'st-chatu8-tree-content';
                    subgroupContent.appendChild(subgroupToggle);
                    subgroupContent.appendChild(subgroupName);
                    
                    subgroupItem.appendChild(subgroupContent);
                    
                    const tagList = document.createElement('ul');
                    tagList.className = 'st-chatu8-tree-taglist';
                    tagList.style.display = 'none';

                    const tags = tagsBySubgroupId[subgroup.id_index] || [];
                    tags.forEach(tag => {
                        const tagItem = document.createElement('li');
                        tagItem.className = 'st-chatu8-tree-tag';
                        tagItem.textContent = `${tag.text} (${tag.desc})`;
                        tagItem.onclick = () => {
                            const currentTags = VOCABULARY_SELECTED_TAGS.value.trim();
                            const newTag = `${tag.text}(${tag.desc})`;
                            if (currentTags) {
                                VOCABULARY_SELECTED_TAGS.value = `${currentTags}, ${newTag}`;
                            } else {
                                VOCABULARY_SELECTED_TAGS.value = newTag;
                            }
                        };
                        tagList.appendChild(tagItem);
                    });

                    if (tags.length > 0) {
                        subgroupItem.appendChild(tagList);
                        subgroupContent.onclick = () => {
                            const isExpanded = tagList.style.display === 'block';
                            tagList.style.display = isExpanded ? 'none' : 'block';
                            subgroupToggle.textContent = isExpanded ? '▶ ' : '▼ ';
                        };
                    } else {
                        subgroupToggle.style.visibility = 'hidden';
                    }
                    
                    subgroupList.appendChild(subgroupItem);
                });
            }
            
            groupItem.appendChild(subgroupList);
            groupContent.onclick = () => {
                const isExpanded = subgroupList.style.display === 'block';
                subgroupList.style.display = isExpanded ? 'none' : 'block';
                groupToggle.textContent = isExpanded ? '▶ ' : '▼ ';
            };

            tree.appendChild(groupItem);
        });

        VOCABULARY_TREE_CONTAINER.innerHTML = '';
        VOCABULARY_TREE_CONTAINER.appendChild(tree);

    } catch (error) {
        console.error('Error building tag tree:', error);
        VOCABULARY_TREE_CONTAINER.textContent = '加载标签浏览器失败。';
        showToast('加载标签浏览器失败', 'error');
    }
}

async function fetchTagDataFiles() {
    try {
        const fileNames = [
            "danbooru_001.json", "danbooru_002.json", "danbooru_003.json", "danbooru_004.json", "danbooru_005.json",
            "danbooru_006.json", "danbooru_007.json", "danbooru_008.json", "danbooru_009.json", "danbooru_010.json",
            "danbooru_011.json", "danbooru_012.json", "danbooru_013.json", "danbooru_014.json", "danbooru_015.json",
            "danbooru_016.json", "danbooru_017.json", "danbooru_018.json", "danbooru_019.json", "danbooru_020.json",
            "danbooru_021.json", "danbooru_022.json", "danbooru_023.json", "danbooru_024.json", "danbooru_025.json",
            "tags.json",
            "tag_NSFW001.json"
        ];
        return fileNames.map(name => ({ name }));
    } catch (error) {
        console.error('Error fetching tag data files:', error);
        showToast('无法加载词库文件列表', 'error');
        return [];
    }
}

async function renderVocabularyList() {
    const [files, installed] = await Promise.all([
        fetchTagDataFiles(),
        dbs.getInstalledVocabularies()
    ]);

    const installedFiles = new Set(installed.map(item => item.fileName));
    VOCABULARY_FILE_LIST.innerHTML = '';

    if (files.length === 0) {
        VOCABULARY_FILE_LIST.textContent = '没有可用的词库文件。';
        return;
    }

    const ul = document.createElement('ul');
    ul.className = 'st-chatu8-vocabulary-ul';

    files.forEach(file => {
        const li = document.createElement('li');
        li.className = 'st-chatu8-vocabulary-item';

        const fileNameSpan = document.createElement('span');
        fileNameSpan.textContent = file.name;
        li.appendChild(fileNameSpan);

        const actionsDiv = document.createElement('div');
        actionsDiv.className = 'st-chatu8-vocabulary-actions';

        if (installedFiles.has(file.name)) {
            const tagCount = installed.find(i => i.fileName === file.name)?.tagCount || 0;
            const installedSpan = document.createElement('span');
            installedSpan.textContent = `已安装 (${tagCount} tags)`;
            installedSpan.className = 'st-chatu8-installed-label';
            actionsDiv.appendChild(installedSpan);

            const uninstallBtn = document.createElement('button');
            uninstallBtn.textContent = '卸载';
            uninstallBtn.className = 'st-chatu8-btn danger small';
            uninstallBtn.onclick = () => uninstallVocabulary(file.name);
            actionsDiv.appendChild(uninstallBtn);
        } else {
            const installBtn = document.createElement('button');
            installBtn.textContent = '安装';
            installBtn.className = 'st-chatu8-btn small';
            installBtn.onclick = () => installVocabulary(file.name);
            actionsDiv.appendChild(installBtn);
        }
        li.appendChild(actionsDiv);
        ul.appendChild(li);
    });

    VOCABULARY_FILE_LIST.appendChild(ul);
}


async function installVocabulary(fileName) {
    if (!fileName) {
        showToast('无效的文件名', 'warning');
        return;
    }

    try {
        showToast(`正在安装 ${fileName}...`, 'info');
        const response = await fetch(`${TAG_DATA_PATH}${fileName}`);
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        const encryptedText = await response.text();
        const decryptedBytes = CryptoJS.AES.decrypt(encryptedText, encryptionKey);
        const decryptedText = decryptedBytes.toString(CryptoJS.enc.Utf8);
        
        if (!decryptedText) {
            throw new Error('解密失败，内容为空。可能是密钥不匹配或文件已损坏。');
        }

        const data = JSON.parse(decryptedText);

        await dbs.installVocabulary(fileName, data);
        
        const installedVocab = await dbs.getInstalledVocabularies();
        const vocabInfo = installedVocab.find(v => v.fileName === fileName);
        const tagCount = vocabInfo ? vocabInfo.tagCount : 0;

        showToast(`${fileName} 安装成功，包含 ${tagCount} 个标签`, 'success');
        await renderVocabularyList();
        
        if (fileName === 'tags.json') {
            cachedTagTreeData = null; // Clear cache to force reload from DB
            await buildTagTree();
        }

    } catch (error) {
        console.error(`Error installing vocabulary ${fileName}:`, error);
        showToast(`安装失败: ${error.message}`, 'error');
    }
}

async function uninstallVocabulary(fileName) {
    if (!fileName) {
        showToast('无效的文件名', 'warning');
        return;
    }

    try {
        await dbs.uninstallVocabulary(fileName);
        showToast(`${fileName} 卸载成功`, 'success');
        await renderVocabularyList();
        if (fileName === 'tags.json') {
            await buildTagTree();
        }
    } catch (error) {
        console.error(`Error uninstalling vocabulary ${fileName}:`, error);
        showToast(`卸载失败: ${error.message}`, 'error');
    }
}

async function installAllVocabularies() {
    showToast('开始批量安装所有未安装的词库...', 'info');
    const [files, installed] = await Promise.all([
        fetchTagDataFiles(),
        dbs.getInstalledVocabularies()
    ]);
    const installedFiles = new Set(installed.map(item => item.fileName));
    const filesToInstall = files.filter(file => !installedFiles.has(file.name));

    if (filesToInstall.length === 0) {
        showToast('所有词库均已安装。', 'success');
        return;
    }

    for (const file of filesToInstall) {
        await installVocabulary(file.name);
    }
    showToast('批量安装完成！', 'success');
}

async function uninstallAllVocabularies() {
    showToast('开始批量卸载所有已安装的词库...', 'info');
    const installed = await dbs.getInstalledVocabularies();
    
    if (installed.length === 0) {
        showToast('没有已安装的词库。', 'success');
        return;
    }

    for (const item of installed) {
        await uninstallVocabulary(item.fileName);
    }
    showToast('批量卸载完成！', 'success');
}


async function searchTags() {
    const keyword = VOCABULARY_SEARCH_INPUT.value.trim();
    if (!keyword) {
        VOCABULARY_SEARCH_RESULTS.innerHTML = '';
        return;
    }

    const startsWith = VOCABULARY_SEARCH_STARTSWITH.checked;
    const limit = parseInt(VOCABULARY_SEARCH_LIMIT.value, 10);
    const sortBy = VOCABULARY_SEARCH_SORT.value;

    try {
        const results = await dbs.searchTags(keyword, { startsWith, limit, sortBy });
        VOCABULARY_SEARCH_RESULTS.innerHTML = '';
        if (results.length === 0) {
            VOCABULARY_SEARCH_RESULTS.textContent = '未找到匹配的标签。';
        } else {
            results.forEach(tag => {
                const div = document.createElement('div');
                const tagName = typeof tag === 'object' ? `${tag.name} (${tag.translation || '无翻译'})` : tag;
                div.textContent = tagName;
                div.className = 'st-chatu8-search-result-item';
                div.onclick = () => {
                    // 复制到剪贴板的功能
                    navigator.clipboard.writeText(tag.name).then(() => {
                        showToast(`已复制: ${tag.name}`, 'success');
                    });
                };
                VOCABULARY_SEARCH_RESULTS.appendChild(div);
            });
        }
    } catch (error) {
        console.error('Error searching tags:', error);
        showToast('搜索失败', 'error');
    }
}

// Helper functions for the tag browser actions
function handleTagBackspace() {
    const currentValue = VOCABULARY_SELECTED_TAGS.value;
    // Split by comma, trim spaces, and filter out any empty entries
    let tags = currentValue.split(',').map(tag => tag.trim()).filter(tag => tag);
    tags.pop(); // Remove the last tag
    VOCABULARY_SELECTED_TAGS.value = tags.join(', ');
}

function handleTagClear() {
    VOCABULARY_SELECTED_TAGS.value = '';
}

// 兼容的剪贴板复制函数
function copyToClipboard(text) {
    // 优先使用现代的 Clipboard API
    if (navigator.clipboard && window.isSecureContext) {
        navigator.clipboard.writeText(text).then(() => {
            showToast(`已复制: "${text}"`, 'success');
        }).catch(err => {
            console.error('使用 Clipboard API 复制失败: ', err);
            fallbackCopyTextToClipboard(text); // 失败时尝试后备方法
        });
    } else {
        // 后备方法，用于 HTTP 或不支持的浏览器
        fallbackCopyTextToClipboard(text);
    }
}

// 后备的复制文本方法
function fallbackCopyTextToClipboard(text) {
    const textArea = document.createElement('textarea');
    textArea.value = text;

    // 避免在屏幕上闪烁
    textArea.style.position = 'fixed';
    textArea.style.top = '0';
    textArea.style.left = '0';
    textArea.style.width = '2em';
    textArea.style.height = '2em';
    textArea.style.padding = '0';
    textArea.style.border = 'none';
    textArea.style.outline = 'none';
    textArea.style.boxShadow = 'none';
    textArea.style.background = 'transparent';

    document.body.appendChild(textArea);
    textArea.focus();
    textArea.select();

    try {
        const successful = document.execCommand('copy');
        if (successful) {
            showToast(`已复制: "${text}"`, 'success');
        } else {
            showToast('复制失败，浏览器不支持此操作', 'error');
        }
    } catch (err) {
        console.error('后备复制方法失败: ', err);
        showToast('复制失败，发生未知错误', 'error');
    }

    document.body.removeChild(textArea);
}

function handleTagCopy() {
    const rawText = VOCABULARY_SELECTED_TAGS.value.trim();
    if (!rawText) {
        showToast('输入框内没有标签可以复制', 'info');
        return;
    }
    
    // 将英文括号替换为中文括号
    const result = rawText.replace(/\(/g, '（').replace(/\)/g, '）');

    if (!result) {
        showToast('没有可以复制的标签', 'info');
        return;
    }

    copyToClipboard(result);
}

async function renderManualTags() {
    try {
        let manualTags = await dbs.getManualTags();
        VOCABULARY_MANUAL_TAGS_LIST.innerHTML = '';

        const filterQuery = VOCABULARY_MANUAL_TAGS_FILTER_INPUT ? VOCABULARY_MANUAL_TAGS_FILTER_INPUT.value.trim().toLowerCase() : '';

        if (filterQuery) {
            manualTags = manualTags.filter(tag => 
                tag.name.toLowerCase().includes(filterQuery) || 
                (tag.translation && tag.translation.toLowerCase().includes(filterQuery))
            );
        }

        if (manualTags.length === 0) {
            VOCABULARY_MANUAL_TAGS_LIST.textContent = filterQuery ? '没有找到匹配的标签。' : '没有手动添加的标签。';
            return;
        }

        const ul = document.createElement('ul');
        ul.className = 'st-chatu8-vocabulary-ul';

        manualTags.forEach(tag => {
            const li = document.createElement('li');
            li.className = 'st-chatu8-vocabulary-item';

            const tagInfoSpan = document.createElement('span');
            tagInfoSpan.textContent = `${tag.name} -> ${tag.translation || '(无翻译)'}`;
            li.appendChild(tagInfoSpan);

            const actionsDiv = document.createElement('div');
            actionsDiv.className = 'st-chatu8-vocabulary-actions';

            const deleteBtn = document.createElement('button');
            deleteBtn.textContent = '删除';
            deleteBtn.className = 'st-chatu8-btn danger small';
            deleteBtn.onclick = async () => {
                if (confirm(`确定要删除标签 "${tag.name}" 吗？`)) {
                    try {
                        await dbs.deleteTagByName(tag.name);
                        showToast(`标签 "${tag.name}" 已删除`, 'success');
                        await renderManualTags(); // Refresh the list
                    } catch (error) {
                        console.error('Error deleting tag:', error);
                        showToast(`删除失败: ${error.message}`, 'error');
                    }
                }
            };
            actionsDiv.appendChild(deleteBtn);
            li.appendChild(actionsDiv);
            ul.appendChild(li);
        });

        VOCABULARY_MANUAL_TAGS_LIST.appendChild(ul);
    } catch (error) {
        console.error('Error rendering manual tags:', error);
        VOCABULARY_MANUAL_TAGS_LIST.textContent = '加载手动标签列表失败。';
        showToast('加载手动标签列表失败', 'error');
    }
}

async function handleManualTagAdd() {
    const original = VOCABULARY_MANUAL_TAG_ORIGINAL_INPUT.value.trim();
    const translation = VOCABULARY_MANUAL_TAG_TRANSLATION_INPUT.value.trim();

    if (!original) {
        showToast('标签原文不能为空', 'info');
        return;
    }

    try {
        const existingTags = await dbs.searchTags(original, { startsWith: false, limit: 1 });
        if (existingTags.some(t => t.name.toLowerCase() === original.toLowerCase())) {
            showToast(`标签 "${original}" 已存在`, 'warning');
            return;
        }

        await dbs.addTag({ name: original, translation: translation, hot: 0, fileName: 'manual' });

        VOCABULARY_MANUAL_TAG_ORIGINAL_INPUT.value = '';
        VOCABULARY_MANUAL_TAG_TRANSLATION_INPUT.value = '';
        showToast(`成功添加标签: ${original}`, 'success');

        await renderManualTags(); // Refresh the list after adding
    } catch (error) {
        console.error('Error adding manual tag:', error);
        showToast(`添加失败: ${error.message}`, 'error');
    }
}
async function handleManualTagsExport() {
    try {
        const manualTags = await dbs.getManualTags();
        if (manualTags.length === 0) {
            showToast('没有可以导出的标签', 'info');
            return;
        }
        const exportData = manualTags.map(tag => ({ name: tag.name, translation: tag.translation }));
        const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(exportData, null, 2));
        const downloadAnchorNode = document.createElement('a');
        downloadAnchorNode.setAttribute("href", dataStr);
        downloadAnchorNode.setAttribute("download", "st-chatu8_manual_tags.json");
        document.body.appendChild(downloadAnchorNode);
        downloadAnchorNode.click();
        downloadAnchorNode.remove();
        showToast('导出成功', 'success');
    } catch (error) {
        console.error('Error exporting manual tags:', error);
        showToast(`导出失败: ${error.message}`, 'error');
    }
}

async function handleManualTagsImport(event) {
    const file = event.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (e) => {
        try {
            const importedData = JSON.parse(e.target.result);
            if (!Array.isArray(importedData)) {
                throw new Error("文件格式不正确，应为包含标签对象的数组");
            }

            const existingTags = await dbs.getManualTags();
            const existingTagNames = new Set(existingTags.map(t => t.name.toLowerCase()));
            let addedCount = 0;
            let skippedCount = 0;

            showToast('开始导入标签...', 'info');

            for (const tag of importedData) {
                if (!tag.name || typeof tag.name !== 'string') {
                    continue;
                }
                const original = tag.name.trim();
                const translation = tag.translation ? String(tag.translation).trim() : '';

                if (existingTagNames.has(original.toLowerCase())) {
                    skippedCount++;
                    continue;
                }

                await dbs.addTag({ name: original, translation: translation, hot: 0, fileName: 'manual' });
                existingTagNames.add(original.toLowerCase());
                addedCount++;
            }

            showToast(`导入完成: 成功添加 ${addedCount} 个, 去重跳过 ${skippedCount} 个`, 'success');
            await renderManualTags();
            VOCABULARY_MANUAL_TAGS_IMPORT_INPUT.value = '';
        } catch (error) {
            console.error('Error importing manual tags:', error);
            showToast(`导入失败: ${error.message}`, 'error');
            VOCABULARY_MANUAL_TAGS_IMPORT_INPUT.value = '';
        }
    };
    reader.readAsText(file);
}


export function init() {
    VOCABULARY_FILE_LIST = document.getElementById('vocabulary-file-list');
    VOCABULARY_INSTALL_ALL_BTN = document.getElementById('vocabulary-install-all-btn');
    VOCABULARY_UNINSTALL_ALL_BTN = document.getElementById('vocabulary-uninstall-all-btn');
    VOCABULARY_SEARCH_INPUT = document.getElementById('vocabulary-search-input');
    VOCABULARY_SEARCH_BTN = document.getElementById('vocabulary-search-btn');
    VOCABULARY_SEARCH_RESULTS = document.getElementById('vocabulary-search-results');
    VOCABULARY_TREE_CONTAINER = document.getElementById('vocabulary-tree-container');
    VOCABULARY_SEARCH_STARTSWITH = document.getElementById('vocabulary_search_startswith');
    VOCABULARY_SEARCH_LIMIT = document.getElementById('vocabulary_search_limit');
    VOCABULARY_SEARCH_SORT = document.getElementById('vocabulary_search_sort');
    VOCABULARY_SELECTED_TAGS = document.getElementById('vocabulary-selected-tags');
    VOCABULARY_TAG_BACKSPACE = document.getElementById('vocabulary-tag-backspace');
    VOCABULARY_TAG_CLEAR = document.getElementById('vocabulary-tag-clear');
    VOCABULARY_TAG_COPY = document.getElementById('vocabulary-tag-copy');
    VOCABULARY_MANUAL_TAG_ORIGINAL_INPUT = document.getElementById('vocabulary-manual-tag-original-input');
    VOCABULARY_MANUAL_TAG_TRANSLATION_INPUT = document.getElementById('vocabulary-manual-tag-translation-input');
    VOCABULARY_MANUAL_TAG_ADD_BTN = document.getElementById('vocabulary-manual-tag-add-btn');
    VOCABULARY_MANUAL_TAGS_LIST = document.getElementById('vocabulary-manual-tags-list');
    VOCABULARY_MANUAL_TAGS_REFRESH_BTN = document.getElementById('vocabulary-manual-tags-refresh-btn');
    VOCABULARY_MANUAL_TAGS_EXPORT_BTN = document.getElementById('vocabulary-manual-tags-export-btn');
    VOCABULARY_MANUAL_TAGS_IMPORT_BTN = document.getElementById('vocabulary-manual-tags-import-btn');
    VOCABULARY_MANUAL_TAGS_IMPORT_INPUT = document.getElementById('vocabulary-manual-tags-import-input');
    VOCABULARY_MANUAL_TAGS_FILTER_INPUT = document.getElementById('vocabulary-manual-tags-filter-input');


    VOCABULARY_INSTALL_ALL_BTN.addEventListener('click', installAllVocabularies);
    VOCABULARY_UNINSTALL_ALL_BTN.addEventListener('click', uninstallAllVocabularies);
    VOCABULARY_SEARCH_BTN.addEventListener('click', searchTags);
    VOCABULARY_SEARCH_INPUT.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            searchTags();
        }
    });

    VOCABULARY_TAG_BACKSPACE.addEventListener('click', handleTagBackspace);
    VOCABULARY_TAG_CLEAR.addEventListener('click', handleTagClear);
    VOCABULARY_TAG_COPY.addEventListener('click', handleTagCopy);
    VOCABULARY_MANUAL_TAG_ADD_BTN.addEventListener('click', handleManualTagAdd);
    VOCABULARY_MANUAL_TAGS_REFRESH_BTN.addEventListener('click', renderManualTags);
    VOCABULARY_MANUAL_TAGS_EXPORT_BTN.addEventListener('click', handleManualTagsExport);
    VOCABULARY_MANUAL_TAGS_IMPORT_BTN.addEventListener('click', () => VOCABULARY_MANUAL_TAGS_IMPORT_INPUT.click());
    VOCABULARY_MANUAL_TAGS_IMPORT_INPUT.addEventListener('change', handleManualTagsImport);
    VOCABULARY_MANUAL_TAGS_FILTER_INPUT.addEventListener('input', renderManualTags);

    const manualTagEnterHandler = (e) => {
        if (e.key === 'Enter') {
            handleManualTagAdd();
        }
    };
    VOCABULARY_MANUAL_TAG_ORIGINAL_INPUT.addEventListener('keypress', manualTagEnterHandler);
    VOCABULARY_MANUAL_TAG_TRANSLATION_INPUT.addEventListener('keypress', manualTagEnterHandler);

    renderVocabularyList();
    buildTagTree();
    renderManualTags();
}
