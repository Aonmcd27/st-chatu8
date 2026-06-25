// @ts-nocheck
/**
 * NovelAI Vibe Group Editor
 * 
 * Allows users to create and manage groups of up to 4 Vibe transfer presets.
 * Each group stores references to Vibe presets (by ID) along with individual
 * Reference Strength values, enabling efficient storage and flexible combination
 * of atmospheric references.
 */

import { extension_settings } from "../../../../../extensions.js";
import { saveSettingsDebounced } from "../../../../../../script.js";
import { extensionName } from '../config.js';
import { saveConfigImage, getConfigImage, deleteConfigImage, saveConfigText, getConfigText } from '../configDatabase.js';
import { ensureVibeDataStoredByPreference, getVibeStorageOptions } from './vibeStorageMigration.js';

/**
 * Ensure Vibe group presets storage structure exists
 * Initializes vibeGroups and vibeGroupId in extension_settings if not present
 * Provides fallback to empty state if data is corrupted
 * 
 * @returns {Object} The vibeGroups object from extension_settings
 */
export function ensureVibeGroupPresets() {
    const settings = extension_settings[extensionName];

    // Initialize vibeGroups if it doesn't exist or is corrupted
    if (!settings.vibeGroups || typeof settings.vibeGroups !== 'object' || Array.isArray(settings.vibeGroups)) {
        if (settings.vibeGroups) {
            console.error('[VibeGroup] Corrupted vibeGroups data detected, resetting to default:', settings.vibeGroups);
        }
        settings.vibeGroups = {
            "默认组": {
                vibes: [],
                createdAt: Date.now(),
                updatedAt: Date.now()
            }
        };
        console.log('[VibeGroup] Initialized vibeGroups with default group');
    }

    // Validate and fix each group
    for (const groupName in settings.vibeGroups) {
        const group = settings.vibeGroups[groupName];

        // Handle corrupted group data
        if (!group || typeof group !== 'object') {
            console.error('[VibeGroup] Corrupted group data for:', groupName, '- removing');
            delete settings.vibeGroups[groupName];
            continue;
        }

        // Ensure vibes array exists
        if (!Array.isArray(group.vibes)) {
            console.warn('[VibeGroup] Group missing vibes array:', groupName, '- initializing');
            group.vibes = [];
        }

        // Ensure timestamps exist
        if (typeof group.createdAt !== 'number') {
            group.createdAt = Date.now();
        }
        if (typeof group.updatedAt !== 'number') {
            group.updatedAt = Date.now();
        }
    }

    // Ensure at least one group exists
    if (Object.keys(settings.vibeGroups).length === 0) {
        console.warn('[VibeGroup] No valid groups found, creating default group');
        settings.vibeGroups["默认组"] = {
            vibes: [],
            createdAt: Date.now(),
            updatedAt: Date.now()
        };
    }

    // Initialize vibeGroupId if it doesn't exist or references non-existent group
    if (!settings.vibeGroupId || !settings.vibeGroups[settings.vibeGroupId]) {
        const firstGroupName = Object.keys(settings.vibeGroups)[0];
        settings.vibeGroupId = firstGroupName || "默认组";
        console.log('[VibeGroup] Set vibeGroupId to:', settings.vibeGroupId);
    }

    return settings.vibeGroups;
}

/**
 * Show Vibe Group Editor Dialog
 * Creates and displays the main dialog UI for managing Vibe groups
 */
export function showVibeGroupEditorDialog() {
    const parent = document.getElementById('st-chatu8-settings') || document.body;
    const settings = extension_settings[extensionName];
    ensureVibeGroupPresets();
    void warmMissingVibePresetThumbnails();

    // Create backdrop
    const backdrop = document.createElement('div');
    backdrop.className = 'st-chatu8-workflow-viz-backdrop';

    // Build dialog HTML structure
    backdrop.innerHTML = `
        <div class="st-chatu8-workflow-viz-dialog st-chatu8-vibe-group-editor-dialog">
            <div class="st-chatu8-workflow-viz-header">
                <h3>Vibe 组编辑器</h3>
                <span class="st-chatu8-workflow-viz-close">&times;</span>
            </div>
            <div class="st-chatu8-workflow-viz-body" style="padding: 2rem;">
                <div class="st-chatu8-vibe-group-editor-content">
                    <!-- Group Preset Selector -->
                    <div class="st-chatu8-field" style="margin-bottom: 1.2rem;">
                        <label for="vibe-group-select">Vibe 组预设</label>
                        <div class="st-chatu8-profile-controls">
                            <select id="vibe-group-select" class="st-chatu8-select"></select>
                            <button class="st-chatu8-icon-btn" id="vibe-group-visual-select" title="可视化选择">
                                <i class="fa-solid fa-grip"></i>
                            </button>
                            <button class="st-chatu8-icon-btn" id="vibe-group-new" title="新建组">
                                <i class="fa-solid fa-plus"></i>
                            </button>
                            <button class="st-chatu8-icon-btn" id="vibe-group-save" title="保存当前组">
                                <i class="fa-solid fa-save"></i>
                            </button>
                            <button class="st-chatu8-icon-btn" id="vibe-group-export-current" title="导出当前组">
                                <i class="fa-solid fa-upload"></i>
                            </button>
                            <button class="st-chatu8-icon-btn" id="vibe-group-export-all" title="导出全部组">
                                <i class="fa-solid fa-file-export"></i>
                            </button>
                            <button class="st-chatu8-icon-btn" id="vibe-group-import" title="导入组">
                                <i class="fa-solid fa-download"></i>
                            </button>
                            <button class="st-chatu8-icon-btn danger" id="vibe-group-delete" title="删除当前组">
                                <i class="fa-solid fa-trash"></i>
                            </button>
                        </div>
                    </div>

                    <!-- Add Vibe Button -->
                    <button type="button" class="st-chatu8-btn" id="vibe-group-add-vibe" style="width: 100%; padding: 1rem; font-size: 16px; font-weight: 600; margin-bottom: 1.5rem;">
                        <i class="fa-solid fa-plus"></i> 添加 Vibe (0/4)
                    </button>

                    <!-- Vibe Slots Container -->
                    <div id="vibe-slots-container" class="st-chatu8-vibe-slots">
                        <!-- Dynamically rendered slots (0-4) -->
                    </div>

                    <!-- Status Message Area -->
                    <div id="vibe-group-status" style="margin-top: 1.5rem; padding: 1rem; border-radius: 6px; font-size: 0.9rem; display: none; line-height: 1.4;"></div>
                </div>
            </div>
        </div>
    `;

    parent.appendChild(backdrop);

    // Bind close events
    const closeBtn = backdrop.querySelector('.st-chatu8-workflow-viz-close');
    closeBtn.onclick = () => parent.removeChild(backdrop);
    backdrop.onclick = (e) => {
        if (e.target === backdrop) {
            parent.removeChild(backdrop);
        }
    };

    // Get DOM elements
    const groupSelect = document.getElementById('vibe-group-select');
    const visualSelectBtn = document.getElementById('vibe-group-visual-select');
    const newBtn = document.getElementById('vibe-group-new');
    const saveBtn = document.getElementById('vibe-group-save');
    const deleteBtn = document.getElementById('vibe-group-delete');
    const exportCurrentBtn = document.getElementById('vibe-group-export-current');
    const exportAllBtn = document.getElementById('vibe-group-export-all');
    const importBtn = document.getElementById('vibe-group-import');
    const addVibeBtn = document.getElementById('vibe-group-add-vibe');
    const slotsContainer = document.getElementById('vibe-slots-container');
    const statusDiv = document.getElementById('vibe-group-status');

    // Load preset list
    loadGroupPresetList(groupSelect);

    // Bind visual selector button
    visualSelectBtn.onclick = () => {
        showVibeGroupVisualSelector((selectedPresetName) => {
            // Update the selected group
            settings.vibeGroupId = selectedPresetName;

            // Update the dropdown
            groupSelect.value = selectedPresetName;

            // Re-render the Vibe slots for the newly selected group
            renderVibeSlots(slotsContainer, groupSelect, addVibeBtn);

            // Save settings with error handling
            try {
                saveSettingsDebounced();
                console.log('[VibeGroup] Selected preset from visual selector:', selectedPresetName);
            } catch (error) {
                console.error('[VibeGroup] Failed to save settings after preset selection:', {
                    error: error.message,
                    errorName: error.name,
                    presetName: selectedPresetName,
                    timestamp: new Date().toISOString(),
                    stack: error.stack
                });
                alert(`保存设置失败: ${error.message}`);
            }
        });
    };

    // Bind new group button
    newBtn.onclick = () => createNewGroup(groupSelect, statusDiv, slotsContainer, addVibeBtn);

    // Bind save group button
    saveBtn.onclick = () => saveCurrentGroup(groupSelect, statusDiv);

    // Bind delete group button
    deleteBtn.onclick = () => deleteCurrentGroup(groupSelect, statusDiv);

    // Bind add Vibe button (implemented in task 6.2)
    addVibeBtn.onclick = () => {
        const settings = extension_settings[extensionName];
        const vibeGroups = settings.vibeGroups || {};
        const currentGroupId = groupSelect.value;
        const currentGroup = vibeGroups[currentGroupId];

        if (!currentGroup) {
            showStatus(statusDiv, '错误: 未选择组。请先选择或创建一个组。', 'error');
            console.error('[VibeGroup] No group selected when attempting to add Vibe');
            return;
        }

        const vibes = currentGroup.vibes || [];
        if (vibes.length >= 4) {
            showStatus(statusDiv, '已达到最大数量 (4个)。每个组最多可包含 4 个 Vibe。', 'error');
            console.warn('[VibeGroup] Maximum Vibe limit reached for group:', currentGroupId);
            return;
        }

        // Open visual selector
        try {
            showVibeVisualSelector((vibeDataId) => {
                try {
                    // Validate vibeDataId
                    if (!vibeDataId || typeof vibeDataId !== 'string') {
                        showStatus(statusDiv, '错误: 无效的 Vibe 数据 ID', 'error');
                        console.error('[VibeGroup] Invalid vibeDataId received:', vibeDataId);
                        return;
                    }

                    // Add Vibe ID to group
                    currentGroup.vibes.push({
                        vibeDataId: vibeDataId,
                        strength: 0.6 // Default strength
                    });

                    // Update timestamp
                    currentGroup.updatedAt = Date.now();

                    // Save settings with error handling
                    try {
                        saveSettingsDebounced();
                    } catch (error) {
                        console.error('[VibeGroup] Failed to save settings after adding Vibe:', {
                            vibeDataId: vibeDataId.substring(0, 12) + '...',
                            error: error.message,
                            errorName: error.name,
                            groupId: currentGroupId,
                            timestamp: new Date().toISOString(),
                            stack: error.stack
                        });
                        showStatus(statusDiv, `错误: 保存设置失败 - ${error.message}`, 'error');
                        return;
                    }

                    // Re-render slots
                    renderVibeSlots(slotsContainer, groupSelect, addVibeBtn);

                    showStatus(statusDiv, 'Vibe 已成功添加到组', 'success');
                    console.log('[VibeGroup] Successfully added Vibe to group:', currentGroupId, vibeDataId);
                } catch (error) {
                    console.error('[VibeGroup] Error adding Vibe to group:', {
                        error: error.message,
                        errorName: error.name,
                        groupId: currentGroupId,
                        timestamp: new Date().toISOString(),
                        stack: error.stack
                    });
                    showStatus(statusDiv, `错误: 添加 Vibe 失败 - ${error.message}`, 'error');
                }
            });
        } catch (error) {
            console.error('[VibeGroup] Error opening visual selector:', {
                error: error.message,
                errorName: error.name,
                timestamp: new Date().toISOString(),
                stack: error.stack
            });
            showStatus(statusDiv, `错误: 无法打开 Vibe 选择器 - ${error.message}`, 'error');
        }
    };

    // Bind export current button
    exportCurrentBtn.onclick = async () => {
        const currentGroupId = groupSelect.value;

        if (!currentGroupId) {
            showStatus(statusDiv, '错误: 未选择组。请先选择要导出的组。', 'error');
            console.error('[VibeGroup] No group selected for export');
            return;
        }

        try {
            // Show status message during export
            showStatus(statusDiv, '正在导出...', 'info');

            await exportVibeGroup(currentGroupId);

            showStatus(statusDiv, `已成功导出组 "${currentGroupId}"`, 'success');
            console.log('[VibeGroup] Successfully exported group:', currentGroupId);
        } catch (error) {
            // Handle errors gracefully with detailed message
            const errorMessage = error.message || '未知错误';
            console.error('[VibeGroup] Export failed:', {
                groupId: currentGroupId,
                error: error.message,
                errorName: error.name,
                timestamp: new Date().toISOString(),
                stack: error.stack
            });
            showStatus(statusDiv, `导出失败: ${errorMessage}。请检查控制台以获取详细信息。`, 'error');
        }
    };

    // Bind export all button
    exportAllBtn.onclick = async () => {
        const settings = extension_settings[extensionName];
        const vibeGroups = settings.vibeGroups || {};
        const groupCount = Object.keys(vibeGroups).length;

        if (groupCount === 0) {
            showStatus(statusDiv, '错误: 没有可导出的组。请先创建至少一个组。', 'error');
            console.warn('[VibeGroup] No groups available for export');
            return;
        }

        try {
            // Show status message during export
            showStatus(statusDiv, `正在导出 ${groupCount} 个组...`, 'info');

            await exportAllVibeGroups();

            showStatus(statusDiv, `已成功导出全部 ${groupCount} 个组`, 'success');
            console.log('[VibeGroup] Successfully exported all groups:', groupCount);
        } catch (error) {
            // Handle errors gracefully with detailed message
            const errorMessage = error.message || '未知错误';
            console.error('[VibeGroup] Export all failed:', {
                groupCount: groupCount,
                error: error.message,
                errorName: error.name,
                timestamp: new Date().toISOString(),
                stack: error.stack
            });
            showStatus(statusDiv, `导出失败: ${errorMessage}。请检查控制台以获取详细信息。`, 'error');
        }
    };

    // Bind import button click handler
    importBtn.onclick = () => {
        // Create file input element
        const fileInput = document.createElement('input');
        fileInput.type = 'file';
        fileInput.accept = '.json';
        fileInput.style.display = 'none';

        // Trigger file selection
        fileInput.onchange = async (e) => {
            const file = e.target.files[0];
            if (!file) {
                return;
            }

            try {
                // Show status message during import
                showStatus(statusDiv, '正在导入...', 'info');

                // Read file as text
                const fileContent = await readFileAsText(file);

                // Call importVibeGroup()
                const result = await importVibeGroup(fileContent);

                // Show success/error messages
                if (result.success) {
                    let message = `成功导入 ${result.groupsImported} 个组、${result.vibesImported} 个 Vibe、${result.presetsImported} 个预设`;

                    if (result.warnings.length > 0) {
                        message += `\n\n警告 (${result.warnings.length} 个):\n`;
                        // Show first 3 warnings in the UI
                        const displayWarnings = result.warnings.slice(0, 3);
                        message += displayWarnings.map(w => `• ${w}`).join('\n');
                        if (result.warnings.length > 3) {
                            message += `\n• ... 还有 ${result.warnings.length - 3} 个警告`;
                        }
                        message += '\n\n请查看控制台以获取完整的警告列表。';
                        console.warn('[VibeGroup] Import warnings:', result.warnings);
                    }

                    showStatus(statusDiv, message, result.warnings.length > 0 ? 'info' : 'success');

                    // Refresh group list
                    loadGroupPresetList(groupSelect);

                    // Re-render slots for current group
                    renderVibeSlots(slotsContainer, groupSelect, addVibeBtn);
                } else {
                    let errorMessage = '导入失败';
                    if (result.errors.length > 0) {
                        errorMessage += ':\n\n';
                        errorMessage += result.errors.map(e => `• ${e}`).join('\n');
                        errorMessage += '\n\n请检查文件格式是否正确。';
                    }
                    showStatus(statusDiv, errorMessage, 'error');
                    console.error('[VibeGroup] Import errors:', result.errors);
                }
            } catch (error) {
                console.error('[VibeGroup] Import error:', {
                    error: error.message,
                    errorName: error.name,
                    fileSize: file.size,
                    fileName: file.name,
                    timestamp: new Date().toISOString(),
                    stack: error.stack
                });
                const errorMessage = `导入失败: ${error.message || '未知错误'}。\n\n可能的原因:\n• 文件格式不正确\n• 文件已损坏\n• 浏览器存储空间不足\n\n请检查控制台以获取详细信息。`;
                showStatus(statusDiv, errorMessage, 'error');
            } finally {
                // Clean up file input
                document.body.removeChild(fileInput);
            }
        };

        // Add to DOM and trigger click
        document.body.appendChild(fileInput);
        fileInput.click();
    };

    // Initial render of Vibe slots
    renderVibeSlots(slotsContainer, groupSelect, addVibeBtn);

    // Bind group select change event to re-render slots
    groupSelect.onchange = () => {
        settings.vibeGroupId = groupSelect.value;
        renderVibeSlots(slotsContainer, groupSelect, addVibeBtn);
    };

    console.log('[VibeGroup] Dialog opened');
}

/**
 * Load group preset list into select element
 * Populates the select element with sorted group names and sets current selection
 * 
 * @param {HTMLSelectElement} selectElement - The select element to populate
 */
function loadGroupPresetList(selectElement) {
    const settings = extension_settings[extensionName];
    const vibeGroups = settings.vibeGroups || {};
    const currentGroupId = settings.vibeGroupId || "默认组";

    // Clear existing options
    selectElement.innerHTML = '';

    // Get sorted group names
    const groupNames = Object.keys(vibeGroups).sort((a, b) => {
        // Sort alphabetically, but keep "默认组" at the top
        if (a === "默认组") return -1;
        if (b === "默认组") return 1;
        return a.localeCompare(b, 'zh-CN');
    });

    // Populate select element
    groupNames.forEach(groupName => {
        const option = document.createElement('option');
        option.value = groupName;
        option.textContent = groupName;
        if (groupName === currentGroupId) {
            option.selected = true;
        }
        selectElement.appendChild(option);
    });

    console.log('[VibeGroup] Loaded preset list:', groupNames.length, 'groups');
}

/**
 * Create a new Vibe group
 * Prompts user for group name, validates uniqueness, and initializes empty group
 * 
 * @param {HTMLSelectElement} selectElement - The select element to update
 * @param {HTMLElement} statusDiv - The status message div
 * @param {HTMLElement} slotsContainer - The container element for Vibe slots
 * @param {HTMLButtonElement} addVibeBtn - The "添加 Vibe" button element
 */
function createNewGroup(selectElement, statusDiv, slotsContainer, addVibeBtn) {
    const settings = extension_settings[extensionName];
    const vibeGroups = settings.vibeGroups || {};

    // Prompt for group name
    const groupName = prompt('请输入新组名称:');

    // Validate input
    if (!groupName) {
        return; // User cancelled
    }

    const trimmedName = groupName.trim();
    if (!trimmedName) {
        showStatus(statusDiv, '组名不能为空', 'error');
        return;
    }

    // Check for uniqueness
    if (vibeGroups[trimmedName]) {
        showStatus(statusDiv, `组名 "${trimmedName}" 已存在`, 'error');
        return;
    }

    // Initialize empty group with timestamp
    vibeGroups[trimmedName] = {
        vibes: [],
        createdAt: Date.now(),
        updatedAt: Date.now()
    };

    // Set as current group
    settings.vibeGroupId = trimmedName;

    // Save settings with error handling
    try {
        saveSettingsDebounced();
    } catch (error) {
        console.error('[VibeGroup] Failed to save settings after creating new group:', {
            groupName: trimmedName,
            error: error.message,
            errorName: error.name,
            timestamp: new Date().toISOString(),
            stack: error.stack
        });
        showStatus(statusDiv, `创建成功但保存失败: ${error.message}`, 'error');
        return;
    }

    // Reload preset list
    loadGroupPresetList(selectElement);

    // Clear Vibe slots for the new empty group
    renderVibeSlots(slotsContainer, selectElement, addVibeBtn);

    showStatus(statusDiv, `已创建新组 "${trimmedName}"`, 'success');
    console.log('[VibeGroup] Created new group:', trimmedName);
}

/**
 * Save current Vibe group
 * Updates group data in extension_settings and persists to storage
 * 
 * @param {HTMLSelectElement} selectElement - The select element
 * @param {HTMLElement} statusDiv - The status message div
 */
function saveCurrentGroup(selectElement, statusDiv) {
    const settings = extension_settings[extensionName];
    const vibeGroups = settings.vibeGroups || {};
    const currentGroupId = selectElement.value;

    if (!currentGroupId) {
        showStatus(statusDiv, '未选择组', 'error');
        return;
    }

    const currentGroup = vibeGroups[currentGroupId];
    if (!currentGroup) {
        showStatus(statusDiv, '当前组不存在', 'error');
        return;
    }

    // Update timestamp
    currentGroup.updatedAt = Date.now();

    // Update current group ID in settings
    settings.vibeGroupId = currentGroupId;

    // Save settings with error handling
    try {
        saveSettingsDebounced();
    } catch (error) {
        console.error('[VibeGroup] Failed to save settings after saving group:', {
            groupId: currentGroupId,
            error: error.message,
            errorName: error.name,
            timestamp: new Date().toISOString(),
            stack: error.stack
        });
        showStatus(statusDiv, `保存失败: ${error.message}`, 'error');
        return;
    }

    showStatus(statusDiv, `已保存组 "${currentGroupId}"`, 'success');
    console.log('[VibeGroup] Saved group:', currentGroupId);
}

/**
 * Delete current Vibe group
 * Confirms deletion with user, removes group from storage, and switches to default group
 * 
 * @param {HTMLSelectElement} selectElement - The select element
 * @param {HTMLElement} statusDiv - The status message div
 */
function deleteCurrentGroup(selectElement, statusDiv) {
    const settings = extension_settings[extensionName];
    const vibeGroups = settings.vibeGroups || {};
    const currentGroupId = selectElement.value;

    if (!currentGroupId) {
        showStatus(statusDiv, '未选择组', 'error');
        return;
    }

    // Prevent deleting the default group if it's the only one
    if (currentGroupId === "默认组" && Object.keys(vibeGroups).length === 1) {
        showStatus(statusDiv, '不能删除唯一的组', 'error');
        return;
    }

    // Confirm deletion
    const confirmed = confirm(`确定要删除组 "${currentGroupId}" 吗？此操作无法撤销。`);
    if (!confirmed) {
        return;
    }

    // Remove group from storage
    delete vibeGroups[currentGroupId];

    // Switch to default group or first available group
    if (vibeGroups["默认组"]) {
        settings.vibeGroupId = "默认组";
    } else {
        const remainingGroups = Object.keys(vibeGroups);
        settings.vibeGroupId = remainingGroups.length > 0 ? remainingGroups[0] : "默认组";

        // If no groups remain, create default group
        if (remainingGroups.length === 0) {
            vibeGroups["默认组"] = {
                vibes: [],
                createdAt: Date.now(),
                updatedAt: Date.now()
            };
            settings.vibeGroupId = "默认组";
        }
    }

    // Save settings with error handling
    try {
        saveSettingsDebounced();
    } catch (error) {
        console.error('[VibeGroup] Failed to save settings after deleting group:', {
            groupId: currentGroupId,
            error: error.message,
            errorName: error.name,
            timestamp: new Date().toISOString(),
            stack: error.stack
        });
        showStatus(statusDiv, `删除成功但保存失败: ${error.message}`, 'error');
        // Don't return - still reload the list
    }

    // Reload preset list
    loadGroupPresetList(selectElement);

    // Re-render Vibe slots to show the new group's content
    const slotsContainer = document.getElementById('vibe-group-slots');
    const addVibeBtn = document.getElementById('vibe-group-add-vibe');
    if (slotsContainer && addVibeBtn) {
        renderVibeSlots(slotsContainer, selectElement, addVibeBtn);
    }

    showStatus(statusDiv, `已删除组 "${currentGroupId}"`, 'success');
    console.log('[VibeGroup] Deleted group:', currentGroupId);
}

/**
 * Show status message
 * 
 * @param {HTMLElement} statusDiv - The status message div
 * @param {string} message - The message to display
 * @param {string} type - The message type ('success', 'error', 'info')
 */
function showStatus(statusDiv, message, type = 'info') {
    statusDiv.textContent = message;
    statusDiv.style.display = 'block';

    // Set background color based on type
    if (type === 'success') {
        statusDiv.style.backgroundColor = 'rgba(76, 175, 80, 0.1)';
        statusDiv.style.color = '#4caf50';
        statusDiv.style.border = '1px solid rgba(76, 175, 80, 0.3)';
    } else if (type === 'error') {
        statusDiv.style.backgroundColor = 'rgba(244, 67, 54, 0.1)';
        statusDiv.style.color = '#f44336';
        statusDiv.style.border = '1px solid rgba(244, 67, 54, 0.3)';
    } else {
        statusDiv.style.backgroundColor = 'rgba(33, 150, 243, 0.1)';
        statusDiv.style.color = '#2196f3';
        statusDiv.style.border = '1px solid rgba(33, 150, 243, 0.3)';
    }

    // Auto-hide after 5 seconds
    setTimeout(() => {
        statusDiv.style.display = 'none';
    }, 5000);
}

/**
 * Render Vibe slots for the current group
 * Clears the slots container and creates slot HTML for each Vibe (0-4)
 * 
 * @param {HTMLElement} slotsContainer - The container element for Vibe slots
 * @param {HTMLSelectElement} groupSelect - The group selector element
 * @param {HTMLButtonElement} addVibeBtn - The "添加 Vibe" button element
 */
async function renderVibeSlots(slotsContainer, groupSelect, addVibeBtn) {
    const settings = extension_settings[extensionName];
    const vibeGroups = settings.vibeGroups || {};
    const currentGroupId = groupSelect.value;
    const currentGroup = vibeGroups[currentGroupId];

    // Clear slots container
    slotsContainer.innerHTML = '';

    if (!currentGroup) {
        console.warn('[VibeGroup] Current group not found:', currentGroupId);
        // Provide fallback to empty state
        slotsContainer.innerHTML = `
            <div style="text-align: center; padding: 3rem; color: rgba(255, 255, 255, 0.5);">
                <i class="fa-solid fa-exclamation-circle" style="font-size: 3rem; margin-bottom: 1rem; display: block;"></i>
                <p>无法加载组数据</p>
                <p style="font-size: 0.9rem; margin-top: 0.5rem;">请尝试选择其他组或创建新组</p>
            </div>
        `;
        addVibeBtn.disabled = true;
        addVibeBtn.style.opacity = '0.5';
        return;
    }

    // Handle corrupted group data - ensure vibes is an array
    if (!Array.isArray(currentGroup.vibes)) {
        console.error('[VibeGroup] Corrupted group data - vibes is not an array:', currentGroupId, currentGroup);
        // Attempt to fix corrupted data by initializing empty array
        currentGroup.vibes = [];
        currentGroup.updatedAt = Date.now();
        saveSettingsDebounced();
        console.log('[VibeGroup] Fixed corrupted group data by initializing empty vibes array');
    }

    const vibes = currentGroup.vibes;

    // Iterate through group vibes (0-4) and filter out invalid entries
    const validVibes = [];
    for (let i = 0; i < vibes.length; i++) {
        const vibeRef = vibes[i];

        // Validate Vibe reference structure
        if (!vibeRef || typeof vibeRef !== 'object') {
            console.warn('[VibeGroup] Invalid Vibe reference at index', i, '- skipping:', vibeRef);
            continue;
        }

        if (!vibeRef.vibeDataId || typeof vibeRef.vibeDataId !== 'string') {
            console.warn('[VibeGroup] Missing vibeDataId at index', i, '- skipping:', vibeRef);
            continue;
        }

        if (typeof vibeRef.strength !== 'number') {
            console.warn('[VibeGroup] Invalid strength at index', i, '- using default:', vibeRef);
            vibeRef.strength = 0.6; // Fix with default value
        }

        validVibes.push(vibeRef);
    }

    // If we filtered out invalid vibes, update the group
    if (validVibes.length !== vibes.length) {
        console.log('[VibeGroup] Cleaned up corrupted Vibe references:', vibes.length, '->', validVibes.length);
        currentGroup.vibes = validVibes;
        currentGroup.updatedAt = Date.now();
        saveSettingsDebounced();
    }

    // Calculate count AFTER filtering to get accurate count
    const vibeCount = validVibes.length;

    // Update "添加 Vibe" button counter
    addVibeBtn.innerHTML = `<i class="fa-solid fa-plus"></i> 添加 Vibe (${vibeCount}/4)`;

    // Disable button if at maximum capacity
    if (vibeCount >= 4) {
        addVibeBtn.disabled = true;
        addVibeBtn.style.opacity = '0.5';
        addVibeBtn.style.cursor = 'not-allowed';
    } else {
        addVibeBtn.disabled = false;
        addVibeBtn.style.opacity = '1';
        addVibeBtn.style.cursor = 'pointer';
    }

    // Render valid vibes
    for (let i = 0; i < validVibes.length; i++) {
        const vibeRef = validVibes[i];
        await updateVibeSlot(slotsContainer, i, vibeRef, groupSelect, addVibeBtn);
    }

    console.log('[VibeGroup] Rendered', validVibes.length, 'Vibe slots');
}

/**
 * Parse Vibe data from data URL format
 * Handles data URLs in the format: data:application/json;base64,<base64data>
 * 
 * @param {string|Object} dataUrlOrObject - Data URL string or already-parsed object
 * @returns {Object|null} Parsed Vibe data object or null if parsing fails
 */
function parseVibeDataFromDataUrl(dataUrlOrObject) {
    try {
        // If input is already an object, return it directly (pass-through)
        if (dataUrlOrObject && typeof dataUrlOrObject === 'object' && !Array.isArray(dataUrlOrObject)) {
            return dataUrlOrObject;
        }

        // If input is not a string, log warning and return null
        if (typeof dataUrlOrObject !== 'string') {
            console.warn('[VibeGroup] parseVibeDataFromDataUrl: Invalid input type:', typeof dataUrlOrObject);
            return null;
        }

        const trimmedInput = dataUrlOrObject.trim();
        if (trimmedInput.startsWith('{') || trimmedInput.startsWith('[')) {
            try {
                return JSON.parse(trimmedInput);
            } catch (parseError) {
                console.error('[VibeGroup] parseVibeDataFromDataUrl: JSON parse failed:', {
                    error: parseError.message,
                    jsonPrefix: trimmedInput.substring(0, 100),
                    jsonLength: trimmedInput.length
                });
                return null;
            }
        }

        // Check if input is a data URL (starts with "data:")
        if (!dataUrlOrObject.startsWith('data:')) {
            console.warn('[VibeGroup] parseVibeDataFromDataUrl: Input is not a data URL, length:', dataUrlOrObject.length);
            return null;
        }

        // Split on first comma to separate header from data
        const commaIndex = dataUrlOrObject.indexOf(',');
        if (commaIndex === -1) {
            console.error('[VibeGroup] parseVibeDataFromDataUrl: Missing comma in data URL, length:', dataUrlOrObject.length);
            return null;
        }

        // Extract base64 portion after comma
        const base64Data = dataUrlOrObject.substring(commaIndex + 1);
        if (!base64Data) {
            console.error('[VibeGroup] parseVibeDataFromDataUrl: Empty base64 data after comma');
            return null;
        }

        // Decode data URL to UTF-8 string
        let jsonString;
        try {
            jsonString = dataUrlOrObject.substring(0, commaIndex).includes(';base64')
                ? decodeURIComponent(escape(atob(base64Data)))
                : decodeURIComponent(base64Data);
        } catch (decodeError) {
            console.error('[VibeGroup] parseVibeDataFromDataUrl: Data URL decode failed:', {
                error: decodeError.message,
                dataUrlPrefix: dataUrlOrObject.substring(0, 100),
                base64Length: base64Data.length
            });
            return null;
        }

        // Parse JSON string to object using JSON.parse()
        let vibeData;
        try {
            vibeData = JSON.parse(jsonString);
        } catch (parseError) {
            console.error('[VibeGroup] parseVibeDataFromDataUrl: JSON parse failed:', {
                error: parseError.message,
                jsonPrefix: jsonString.substring(0, 100),
                jsonLength: jsonString.length
            });
            return null;
        }

        return vibeData;

    } catch (error) {
        // Catch any unexpected errors
        console.error('[VibeGroup] parseVibeDataFromDataUrl: Unexpected error:', {
            error: error.message,
            errorName: error.name,
            stack: error.stack,
            timestamp: new Date().toISOString()
        });
        return null;
    }
}

function appendThumbnailImage(container, src, alt = 'Vibe preview') {
    if (!src) return false;

    const img = document.createElement('img');
    img.src = src;
    img.alt = alt;
    img.style.cssText = `
        max-width: 100%;
        max-height: 100%;
        object-fit: contain;
    `;
    container.appendChild(img);
    return true;
}

function extractJsonStringField(jsonText, fieldName) {
    if (typeof jsonText !== 'string') return null;

    const fieldIndex = jsonText.indexOf(`"${fieldName}"`);
    if (fieldIndex === -1) return null;

    const colonIndex = jsonText.indexOf(':', fieldIndex);
    if (colonIndex === -1) return null;

    let quoteIndex = colonIndex + 1;
    while (quoteIndex < jsonText.length && /\s/.test(jsonText[quoteIndex])) {
        quoteIndex++;
    }
    if (jsonText[quoteIndex] !== '"') return null;

    let value = '';
    let escaped = false;
    for (let i = quoteIndex + 1; i < jsonText.length; i++) {
        const char = jsonText[i];
        if (escaped) {
            value += `\\${char}`;
            escaped = false;
            continue;
        }
        if (char === '\\') {
            escaped = true;
            continue;
        }
        if (char === '"') {
            try {
                return JSON.parse(`"${value}"`);
            } catch {
                return null;
            }
        }
        value += char;
    }

    return null;
}

const vibeThumbnailCache = new Map();
const vibeThumbnailPending = new Map();

async function resolveStoredVibeThumbnail(vibeDataId) {
    if (!vibeDataId) return null;
    if (vibeThumbnailCache.has(vibeDataId)) {
        return vibeThumbnailCache.get(vibeDataId);
    }
    if (vibeThumbnailPending.has(vibeDataId)) {
        return vibeThumbnailPending.get(vibeDataId);
    }

    const pending = (async () => {
        const rawText = await getConfigText(vibeDataId);
        const thumbnail = extractJsonStringField(rawText, 'thumbnail');
        if (thumbnail) {
            vibeThumbnailCache.set(vibeDataId, thumbnail);
            return thumbnail;
        }

        vibeThumbnailCache.set(vibeDataId, null);
        return null;
    })().finally(() => {
        vibeThumbnailPending.delete(vibeDataId);
    });

    vibeThumbnailPending.set(vibeDataId, pending);
    return pending;
}

let vibeThumbnailWarmupPromise = null;

function waitForIdle() {
    return new Promise((resolve) => {
        if (typeof requestIdleCallback === 'function') {
            requestIdleCallback(() => resolve(), { timeout: 500 });
        } else {
            setTimeout(resolve, 16);
        }
    });
}

function createCoverDataUrl(file) {
    return new Promise((resolve, reject) => {
        const url = URL.createObjectURL(file);
        const img = new Image();

        img.onload = () => {
            try {
                const maxDim = 512;
                const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
                const width = Math.max(1, Math.round(img.width * scale));
                const height = Math.max(1, Math.round(img.height * scale));
                const canvas = document.createElement('canvas');
                canvas.width = width;
                canvas.height = height;

                const ctx = canvas.getContext('2d');
                ctx.drawImage(img, 0, 0, width, height);

                resolve({
                    dataUrl: canvas.toDataURL('image/jpeg', 0.82),
                    format: 'jpeg'
                });
            } catch (error) {
                reject(error);
            } finally {
                URL.revokeObjectURL(url);
            }
        };

        img.onerror = () => {
            URL.revokeObjectURL(url);
            reject(new Error('图片解码失败'));
        };

        img.src = url;
    });
}

function warmMissingVibePresetThumbnails() {
    if (vibeThumbnailWarmupPromise) {
        return vibeThumbnailWarmupPromise;
    }

    vibeThumbnailWarmupPromise = (async () => {
        const settings = extension_settings[extensionName];
        const vibePresets = settings.vibePresets || {};
        let updatedCount = 0;

        for (const presetName of Object.keys(vibePresets)) {
            const preset = vibePresets[presetName];
            if (!preset || preset.thumbnail || !preset.vibeDataId) {
                continue;
            }

            await waitForIdle();

            try {
                const thumbnail = await resolveStoredVibeThumbnail(preset.vibeDataId);
                if (thumbnail && !preset.thumbnail) {
                    preset.thumbnail = thumbnail;
                    updatedCount++;

                    if (updatedCount % 5 === 0) {
                        saveSettingsDebounced();
                    }
                }
            } catch (error) {
                console.warn('[VibeGroup] Failed to warm Vibe thumbnail:', {
                    presetName,
                    vibeDataId: preset.vibeDataId?.substring(0, 12) + '...',
                    error: error.message
                });
            }
        }

        if (updatedCount > 0) {
            saveSettingsDebounced();
            console.log('[VibeGroup] Warmed Vibe preset thumbnails:', updatedCount);
        }
    })().finally(() => {
        vibeThumbnailWarmupPromise = null;
    });

    return vibeThumbnailWarmupPromise;
}

/**
 * Update a single Vibe slot
 * Creates or updates slot HTML with Vibe info, thumbnail, and strength controls
 * 
 * @param {HTMLElement} slotsContainer - The container element for Vibe slots
 * @param {number} slotIndex - The index of the slot (0-3)
 * @param {Object} vibeRef - The Vibe reference object {vibeDataId, strength}
 * @param {HTMLSelectElement} groupSelect - The group selector element
 * @param {HTMLButtonElement} addVibeBtn - The "添加 Vibe" button element
 */
async function updateVibeSlot(slotsContainer, slotIndex, vibeRef, groupSelect, addVibeBtn) {
    const { vibeDataId, strength } = vibeRef;

    // Create slot element
    const slotDiv = document.createElement('div');
    slotDiv.className = 'st-chatu8-vibe-slot';
    slotDiv.dataset.slotIndex = slotIndex;
    slotDiv.style.cssText = `
        border: 1px solid rgba(255, 255, 255, 0.1);
        border-radius: 8px;
        padding: 1rem;
        margin-bottom: 1rem;
        background: rgba(0, 0, 0, 0.2);
    `;

    // Create slot header
    const headerDiv = document.createElement('div');
    headerDiv.className = 'st-chatu8-vibe-slot-header';
    headerDiv.style.cssText = `
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: 0.8rem;
    `;

    const titleSpan = document.createElement('span');
    titleSpan.className = 'st-chatu8-vibe-slot-title';
    titleSpan.textContent = `Vibe ${slotIndex + 1}`;
    titleSpan.style.cssText = `
        font-weight: 600;
        font-size: 1rem;
    `;

    const removeBtn = document.createElement('button');
    removeBtn.className = 'st-chatu8-icon-btn danger st-chatu8-vibe-slot-remove';
    removeBtn.innerHTML = '<i class="fa-solid fa-times"></i>';
    removeBtn.title = '移除此 Vibe';
    removeBtn.onclick = () => removeVibeFromSlot(slotIndex, slotsContainer, groupSelect, addVibeBtn);

    headerDiv.appendChild(titleSpan);
    headerDiv.appendChild(removeBtn);

    // Create preview container
    const previewDiv = document.createElement('div');
    previewDiv.className = 'st-chatu8-vibe-slot-preview';
    previewDiv.style.cssText = `
        width: 100%;
        height: 200px;
        border-radius: 6px;
        overflow: hidden;
        background: rgba(0, 0, 0, 0.3);
        display: flex;
        align-items: center;
        justify-content: center;
        margin-bottom: 1rem;
    `;

    // Load thumbnail without parsing the full Vibe JSON.
    try {
        const thumbnail = await resolveStoredVibeThumbnail(vibeDataId);
        if (!appendThumbnailImage(previewDiv, thumbnail)) {
            // Show "no thumbnail" placeholder
            previewDiv.innerHTML = `
                <div style="text-align: center; color: rgba(255, 255, 255, 0.5);">
                    <i class="fa-solid fa-image" style="font-size: 3rem; opacity: 0.3; display: block; margin-bottom: 0.5rem;"></i>
                    <div style="font-size: 0.85rem;">无缩略图</div>
                </div>
            `;
            console.warn('[VibeGroup] No thumbnail field in Vibe data:', {
                vibeDataId: vibeDataId.substring(0, 12) + '...',
                timestamp: new Date().toISOString()
            });
        }
    } catch (error) {
        // Show database error placeholder with detailed message and specific error handling
        let errorMessage = 'Vibe 数据加载失败';
        let errorType = error.name || 'Error';

        if (error.name === 'QuotaExceededError' || error.message.includes('quota')) {
            errorMessage = '存储空间已满';
            errorType = 'QuotaExceededError';
        } else if (error.name === 'NotFoundError') {
            errorMessage = 'Vibe 数据未找到';
            errorType = 'NotFoundError';
        } else if (error.name === 'InvalidStateError') {
            errorMessage = '数据库状态无效';
            errorType = 'InvalidStateError';
        }

        previewDiv.innerHTML = `
            <div style="text-align: center; color: #f44336;">
                <i class="fa-solid fa-exclamation-triangle" style="font-size: 3rem; opacity: 0.5; display: block; margin-bottom: 0.5rem;"></i>
                <div style="font-size: 0.85rem; font-weight: 600;">${errorMessage}</div>
                <div style="font-size: 0.75rem; margin-top: 0.3rem; opacity: 0.7;">${errorType}</div>
                <div style="font-size: 0.75rem; margin-top: 0.3rem; opacity: 0.7;">ID: ${vibeDataId.substring(0, 12)}...</div>
            </div>
        `;
        previewDiv.title = `加载失败: ${error.message}`;
        console.error('[VibeGroup] Failed to load Vibe data from database:', {
            vibeDataId: vibeDataId.substring(0, 12) + '...',
            error: error.message,
            errorName: error.name,
            slotIndex: slotIndex,
            timestamp: new Date().toISOString(),
            stack: error.stack
        });
    }

    // Create strength control field
    const fieldDiv = document.createElement('div');
    fieldDiv.className = 'st-chatu8-field';
    fieldDiv.style.marginBottom = '0';

    const label = document.createElement('label');
    label.innerHTML = `Reference Strength: <span class="strength-value">${strength.toFixed(2)}</span>`;

    const rangeContainer = document.createElement('div');
    rangeContainer.className = 'st-chatu8-range-container';
    rangeContainer.style.cssText = `
        display: flex;
        gap: 0.5rem;
        align-items: center;
        margin-top: 0.5rem;
    `;

    const rangeSlider = document.createElement('input');
    rangeSlider.type = 'range';
    rangeSlider.className = 'st-chatu8-range-slider vibe-strength-range';
    rangeSlider.min = '0';
    rangeSlider.max = '1';
    rangeSlider.step = '0.01';
    rangeSlider.value = strength.toString();
    rangeSlider.style.flex = '1';

    const numberInput = document.createElement('input');
    numberInput.type = 'number';
    numberInput.className = 'st-chatu8-range-input vibe-strength-num';
    numberInput.min = '0';
    numberInput.max = '1';
    numberInput.step = '0.01';
    numberInput.value = strength.toString();
    numberInput.style.width = '80px';

    // Set up strength slider synchronization
    setupStrengthSliderSync(rangeSlider, numberInput, label, slotIndex, groupSelect);

    rangeContainer.appendChild(rangeSlider);
    rangeContainer.appendChild(numberInput);

    fieldDiv.appendChild(label);
    fieldDiv.appendChild(rangeContainer);

    // Assemble slot
    slotDiv.appendChild(headerDiv);
    slotDiv.appendChild(previewDiv);
    slotDiv.appendChild(fieldDiv);

    slotsContainer.appendChild(slotDiv);
}

/**
 * Set up strength slider synchronization
 * Syncs range slider with number input and updates display value in real-time
 * 
 * @param {HTMLInputElement} rangeSlider - The range slider input
 * @param {HTMLInputElement} numberInput - The number input
 * @param {HTMLLabelElement} label - The label containing the strength value display
 * @param {number} slotIndex - The index of the slot
 * @param {HTMLSelectElement} groupSelect - The group selector element
 */
function setupStrengthSliderSync(rangeSlider, numberInput, label, slotIndex, groupSelect) {
    const settings = extension_settings[extensionName];

    // Update function to sync values and update storage
    const updateStrength = (value) => {
        // Clamp value to [0, 1] range
        let clampedValue = Math.max(0, Math.min(1, parseFloat(value) || 0));

        // Update both inputs
        rangeSlider.value = clampedValue.toString();
        numberInput.value = clampedValue.toString();

        // Update display value
        const strengthValueSpan = label.querySelector('.strength-value');
        if (strengthValueSpan) {
            strengthValueSpan.textContent = clampedValue.toFixed(2);
        }

        // Update in storage
        const vibeGroups = settings.vibeGroups || {};
        const currentGroupId = groupSelect.value;
        const currentGroup = vibeGroups[currentGroupId];

        if (currentGroup && currentGroup.vibes[slotIndex]) {
            currentGroup.vibes[slotIndex].strength = clampedValue;
            currentGroup.updatedAt = Date.now();

            // Save settings with error handling
            try {
                saveSettingsDebounced();
            } catch (error) {
                console.error('[VibeGroup] Failed to save settings after strength update:', {
                    slotIndex: slotIndex,
                    strength: clampedValue,
                    error: error.message,
                    errorName: error.name,
                    timestamp: new Date().toISOString()
                });
                // Don't show alert for strength changes as they happen frequently
            }
        }
    };

    // Sync range slider with number input
    rangeSlider.oninput = () => {
        updateStrength(rangeSlider.value);
    };

    // Sync number input with range slider
    numberInput.oninput = () => {
        updateStrength(numberInput.value);
    };

    // Also handle blur event to ensure value is clamped
    numberInput.onblur = () => {
        updateStrength(numberInput.value);
    };
}

/**
 * Remove Vibe from slot
 * Removes the Vibe at the specified index, maintains order of remaining Vibes,
 * and re-renders all slots
 * 
 * @param {number} slotIndex - The index of the slot to remove
 * @param {HTMLElement} slotsContainer - The container element for Vibe slots
 * @param {HTMLSelectElement} groupSelect - The group selector element
 * @param {HTMLButtonElement} addVibeBtn - The "添加 Vibe" button element
 */
function removeVibeFromSlot(slotIndex, slotsContainer, groupSelect, addVibeBtn) {
    const settings = extension_settings[extensionName];
    const vibeGroups = settings.vibeGroups || {};
    const currentGroupId = groupSelect.value;
    const currentGroup = vibeGroups[currentGroupId];

    if (!currentGroup) {
        console.warn('[VibeGroup] Current group not found:', currentGroupId);
        return;
    }

    // Remove Vibe at specified index
    currentGroup.vibes.splice(slotIndex, 1);

    // Update timestamp
    currentGroup.updatedAt = Date.now();

    // Save settings with error handling
    try {
        saveSettingsDebounced();
    } catch (error) {
        console.error('[VibeGroup] Failed to save settings after removing Vibe:', {
            slotIndex: slotIndex,
            groupId: currentGroupId,
            error: error.message,
            errorName: error.name,
            timestamp: new Date().toISOString(),
            stack: error.stack
        });
        // Still re-render to show the change in UI
    }

    // Re-render all slots
    renderVibeSlots(slotsContainer, groupSelect, addVibeBtn);

    console.log('[VibeGroup] Removed Vibe from slot', slotIndex);
}

/**
 * Show Vibe Visual Selector
 * Creates and displays a visual grid selector for choosing Vibe presets
 * 
 * @param {Function} onSelect - Callback function called when a Vibe is selected (vibeDataId) => void
 */
async function showVibeVisualSelector(onSelect) {
    const parent = document.getElementById('st-chatu8-settings') || document.body;
    const settings = extension_settings[extensionName];
    const vibePresets = settings.vibePresets || {};
    void warmMissingVibePresetThumbnails();

    // Pagination state
    let currentPage = 1;
    let pageSize = 12; // Default page size
    let filteredPresets = []; // Filtered preset names
    let searchQuery = '';
    let renderSerial = 0;

    // Create backdrop
    const backdrop = document.createElement('div');
    backdrop.className = 'st-chatu8-workflow-viz-backdrop';

    // Build dialog HTML structure with pagination
    backdrop.innerHTML = `
        <div class="st-chatu8-workflow-viz-dialog st-chatu8-vibe-visual-selector-dialog">
            <div class="st-chatu8-workflow-viz-header">
                <h3>选择 Vibe 预设</h3>
                <span class="st-chatu8-workflow-viz-close">&times;</span>
            </div>
            <div class="st-chatu8-workflow-viz-toolbar" style="justify-content: space-between; align-items: center; gap: 15px; padding: 12px 20px; background: rgba(30, 30, 46, 0.6); border-bottom: 1px solid rgba(255,255,255,0.05);">
                <div class="st-chatu8-viz-search-container" style="position: relative; flex-grow: 1; max-width: 300px;">
                    <i class="fa-solid fa-search" style="position: absolute; left: 12px; top: 50%; transform: translateY(-50%); color: #aaa; pointer-events: none;"></i>
                    <input type="text" class="st-chatu8-viz-search-input" placeholder="搜索 Vibe..." style="width: 100%; padding: 8px 12px 8px 36px; background: rgba(0,0,0,0.2); border: 1px solid rgba(255,255,255,0.1); border-radius: 20px; color: white; outline: none; transition: all 0.3s;">
                </div>
            </div>
            <div class="st-chatu8-pagination-container">
                <button class="st-chatu8-pagination-btn st-chatu8-pagination-prev" title="上一页">
                    <i class="fa-solid fa-chevron-left"></i>
                </button>
                <div class="st-chatu8-pagination-info">
                    <span class="st-chatu8-pagination-current">1</span>
                    <span>/</span>
                    <span class="st-chatu8-pagination-total">1</span>
                    <span style="margin-left: 8px; color: #666;">|</span>
                    <span style="margin-left: 8px;">共 <span class="st-chatu8-pagination-count">0</span> 个</span>
                </div>
                <button class="st-chatu8-pagination-btn st-chatu8-pagination-next" title="下一页">
                    <i class="fa-solid fa-chevron-right"></i>
                </button>
                <div class="st-chatu8-pagination-size-container">
                    <span class="st-chatu8-pagination-size-label">每页</span>
                    <select class="st-chatu8-pagination-size">
                        <option value="8">8</option>
                        <option value="12" selected>12</option>
                        <option value="16">16</option>
                        <option value="24">24</option>
                    </select>
                </div>
            </div>
            <div class="st-chatu8-workflow-viz-body">
                <div class="st-chatu8-vibe-visual-selector-grid">
                    <!-- Vibe cards will be inserted here -->
                </div>
            </div>
        </div>
    `;

    parent.appendChild(backdrop);

    // Bind close events
    const closeBtn = backdrop.querySelector('.st-chatu8-workflow-viz-close');
    closeBtn.onclick = () => parent.removeChild(backdrop);
    backdrop.onclick = (e) => {
        if (e.target === backdrop) {
            parent.removeChild(backdrop);
        }
    };

    const gridContainer = backdrop.querySelector('.st-chatu8-vibe-visual-selector-grid');
    const searchInput = backdrop.querySelector('.st-chatu8-viz-search-input');
    const paginationPrev = backdrop.querySelector('.st-chatu8-pagination-prev');
    const paginationNext = backdrop.querySelector('.st-chatu8-pagination-next');
    const paginationCurrent = backdrop.querySelector('.st-chatu8-pagination-current');
    const paginationTotal = backdrop.querySelector('.st-chatu8-pagination-total');
    const paginationCount = backdrop.querySelector('.st-chatu8-pagination-count');
    const paginationSizeSelect = backdrop.querySelector('.st-chatu8-pagination-size');

    // Get all preset names (sorted)
    const allPresetNames = Object.keys(vibePresets)
        .filter(name => vibePresets[name].vibeDataId) // Only include presets with Vibe data
        .sort((a, b) => {
            // Sort alphabetically, but keep "默认" at the top
            if (a === "默认") return -1;
            if (b === "默认") return 1;
            return a.localeCompare(b, 'zh-CN');
        });

    // Update filtered presets based on search query
    function updateFilteredPresets() {
        if (searchQuery) {
            filteredPresets = allPresetNames.filter(name =>
                name.toLowerCase().includes(searchQuery)
            );
        } else {
            filteredPresets = [...allPresetNames];
        }
    }

    // Update pagination UI
    function updatePaginationUI() {
        const totalPages = Math.ceil(filteredPresets.length / pageSize) || 1;
        paginationCurrent.textContent = currentPage;
        paginationTotal.textContent = totalPages;
        paginationCount.textContent = filteredPresets.length;

        // Update button states
        paginationPrev.disabled = currentPage <= 1;
        paginationPrev.style.opacity = currentPage <= 1 ? '0.5' : '1';
        paginationPrev.style.cursor = currentPage <= 1 ? 'not-allowed' : 'pointer';

        paginationNext.disabled = currentPage >= totalPages;
        paginationNext.style.opacity = currentPage >= totalPages ? '0.5' : '1';
        paginationNext.style.cursor = currentPage >= totalPages ? 'not-allowed' : 'pointer';
    }

    function setVibeCardImage(thumbnailDiv, src, presetName) {
        thumbnailDiv.innerHTML = '';
        const img = document.createElement('img');
        img.src = src;
        img.alt = presetName;
        thumbnailDiv.appendChild(img);
    }

    function setVibeCardPlaceholder(thumbnailDiv, label = '加载中...') {
        thumbnailDiv.innerHTML = `
            <div class="st-chatu8-vibe-card-placeholder">
                <i class="fa-solid fa-image"></i>
                <div>${label}</div>
            </div>
        `;
    }

    async function resolveVibePresetThumbnail(presetName, preset, markBackfilled) {
        if (preset.thumbnail) {
            return preset.thumbnail;
        }

        if (preset.vibeDataId) {
            const thumbnail = await resolveStoredVibeThumbnail(preset.vibeDataId);
            if (thumbnail) {
                preset.thumbnail = thumbnail;
                markBackfilled();
                return thumbnail;
            }
        }

        if (preset.imageId) {
            return await getConfigImage(preset.imageId);
        }

        return null;
    }

    // Render current page
    async function renderCurrentPage() {
        const renderId = ++renderSerial;
        let thumbnailsBackfilled = false;
        const markBackfilled = () => {
            thumbnailsBackfilled = true;
        };

        // Render immediately; thumbnails load asynchronously below.
        gridContainer.style.opacity = '0';
        gridContainer.style.transform = 'translateY(10px)';
        if (renderId !== renderSerial) return;

        gridContainer.innerHTML = '';

        // Check if there are any presets
        if (filteredPresets.length === 0) {
            gridContainer.innerHTML = `
                <div style="
                    grid-column: 1 / -1;
                    text-align: center;
                    padding: 3rem;
                    color: rgba(255, 255, 255, 0.5);
                ">
                    <i class="fa-solid fa-inbox" style="font-size: 3rem; margin-bottom: 1rem; display: block;"></i>
                    <p>${searchQuery ? '没有找到匹配的 Vibe 预设' : '没有可用的 Vibe 预设'}</p>
                    <p style="font-size: 0.9rem; margin-top: 0.5rem;">${searchQuery ? '请尝试其他搜索词' : '请先在 Vibe 生成器中创建 Vibe 预设'}</p>
                </div>
            `;
            updatePaginationUI();
            gridContainer.style.transition = 'opacity 0.3s ease, transform 0.3s ease';
            gridContainer.style.opacity = '1';
            gridContainer.style.transform = 'translateY(0)';
            return;
        }

        const startIndex = (currentPage - 1) * pageSize;
        const endIndex = startIndex + pageSize;
        const pagePresets = filteredPresets.slice(startIndex, endIndex);
        const thumbnailTasks = [];

        // Display Vibe cards for current page
        for (const presetName of pagePresets) {
            const preset = vibePresets[presetName];

            // Create card element
            const card = document.createElement('div');
            card.className = 'st-chatu8-vibe-card';

            // Create thumbnail container
            const thumbnailDiv = document.createElement('div');
            thumbnailDiv.className = 'st-chatu8-vibe-card-thumbnail';

            if (preset.thumbnail) {
                setVibeCardImage(thumbnailDiv, preset.thumbnail, presetName);
            } else {
                setVibeCardPlaceholder(thumbnailDiv);
            }

            // Create info section
            const infoDiv = document.createElement('div');
            infoDiv.className = 'st-chatu8-vibe-card-info';

            // Preset name
            const nameDiv = document.createElement('div');
            nameDiv.className = 'st-chatu8-vibe-card-name';
            nameDiv.textContent = presetName;

            // Model info
            const modelDiv = document.createElement('div');
            modelDiv.className = 'st-chatu8-vibe-card-model';
            const modelName = preset.model || 'Unknown';
            const modelDisplay = modelName.replace('nai-diffusion-', 'V').replace('-', ' ');
            modelDiv.textContent = modelDisplay;

            infoDiv.appendChild(nameDiv);
            infoDiv.appendChild(modelDiv);

            // Assemble card
            card.appendChild(thumbnailDiv);
            card.appendChild(infoDiv);

            // Add click handler to select Vibe
            card.onclick = () => {
                // Call onSelect callback with vibeDataId
                onSelect(preset.vibeDataId);

                // Close dialog
                parent.removeChild(backdrop);

                console.log('[VibeGroup] Selected Vibe:', presetName, preset.vibeDataId);
            };

            gridContainer.appendChild(card);

            if (!preset.thumbnail) {
                const task = resolveVibePresetThumbnail(presetName, preset, markBackfilled)
                    .then((thumbnail) => {
                        if (renderId !== renderSerial || !thumbnailDiv.isConnected) return;

                        if (thumbnail) {
                            setVibeCardImage(thumbnailDiv, thumbnail, presetName);
                        } else {
                            setVibeCardPlaceholder(thumbnailDiv, '无图像');
                        }
                    })
                    .catch((error) => {
                        if (renderId !== renderSerial || !thumbnailDiv.isConnected) return;

                        thumbnailDiv.innerHTML = `
                            <div class="st-chatu8-vibe-card-error">
                                <i class="fa-solid fa-exclamation-triangle"></i>
                                <div>加载失败</div>
                            </div>
                        `;
                        thumbnailDiv.title = `加载失败: ${error.message}`;
                        console.error('[VibeGroup] Failed to load Vibe thumbnail:', {
                            vibeDataId: preset.vibeDataId?.substring(0, 12) + '...',
                            presetName,
                            error: error.message,
                            errorName: error.name || 'Error',
                            timestamp: new Date().toISOString(),
                            stack: error.stack
                        });
                    });
                thumbnailTasks.push(task);
            }
        }

        updatePaginationUI();

        // Restore display with animation
        gridContainer.style.transition = 'opacity 0.3s ease, transform 0.3s ease';
        gridContainer.style.opacity = '1';
        gridContainer.style.transform = 'translateY(0)';

        if (thumbnailTasks.length > 0) {
            Promise.allSettled(thumbnailTasks).then(() => {
                if (thumbnailsBackfilled) {
                    saveSettingsDebounced();
                }
            });
        }
    }

    // Search functionality
    searchInput.oninput = (e) => {
        searchQuery = e.target.value.toLowerCase();
        currentPage = 1; // Reset to first page on search
        updateFilteredPresets();
        renderCurrentPage();
    };

    // Pagination event bindings
    paginationPrev.onclick = () => {
        if (currentPage > 1) {
            currentPage--;
            renderCurrentPage();
        }
    };

    paginationNext.onclick = () => {
        const totalPages = Math.ceil(filteredPresets.length / pageSize) || 1;
        if (currentPage < totalPages) {
            currentPage++;
            renderCurrentPage();
        }
    };

    paginationSizeSelect.onchange = (e) => {
        pageSize = parseInt(e.target.value);
        currentPage = 1; // Reset to first page
        renderCurrentPage();
    };

    // Initialize: load first page
    updateFilteredPresets();
    renderCurrentPage();

    console.log('[VibeGroup] Visual selector opened with', allPresetNames.length, 'presets');
}

/**
 * Export a single Vibe group
 * Creates a JSON file containing the group configuration and referenced Vibe data
 * 
 * @param {string} groupId - The ID of the group to export
 * @returns {Promise<void>}
 */
async function exportVibeGroup(groupId) {
    const settings = extension_settings[extensionName];
    const vibeGroups = settings.vibeGroups || {};
    const group = vibeGroups[groupId];

    if (!group) {
        throw new Error(`Group "${groupId}" not found`);
    }

    // Collect all Vibe IDs from the group
    const vibeIds = group.vibes.map(v => v.vibeDataId);
    const vibeIdSet = new Set(vibeIds);

    // Resolve all Vibe IDs to full Vibe data from configDatabase
    const vibeData = {};
    for (const vibeId of vibeIds) {
        try {
            const rawData = await getConfigText(vibeId);
            if (rawData) {
                // Parse data URL to JSON object for proper export
                const parsedData = parseVibeDataFromDataUrl(rawData);
                if (parsedData) {
                    vibeData[vibeId] = parsedData;
                } else {
                    console.warn('[VibeGroup] Failed to parse Vibe data for export:', vibeId);
                }
            } else {
                console.warn('[VibeGroup] Vibe data not found for ID:', vibeId);
            }
        } catch (error) {
            // Enhanced error logging with specific error type handling
            let errorType = error.name || 'Error';
            if (error.name === 'QuotaExceededError' || error.message.includes('quota')) {
                errorType = 'QuotaExceededError';
            } else if (error.name === 'NotFoundError') {
                errorType = 'NotFoundError';
            } else if (error.name === 'InvalidStateError') {
                errorType = 'InvalidStateError';
            }

            console.error('[VibeGroup] Failed to load Vibe data for export:', {
                vibeDataId: vibeId.substring(0, 12) + '...',
                error: error.message,
                errorName: errorType,
                timestamp: new Date().toISOString(),
                stack: error.stack
            });
        }
    }

    // Collect related vibePresets that reference vibeDataIds in this group
    const relatedPresets = {};
    const allPresets = settings.vibePresets || {};
    for (const presetName in allPresets) {
        const preset = allPresets[presetName];
        if (preset.vibeDataId && vibeIdSet.has(preset.vibeDataId)) {
            relatedPresets[presetName] = { ...preset };
        }
    }

    // Collect preset preview images from configDatabase
    const presetImages = {};
    for (const presetName in relatedPresets) {
        const preset = relatedPresets[presetName];
        if (preset.imageId) {
            try {
                const imageData = await getConfigImage(preset.imageId);
                if (imageData) {
                    presetImages[preset.imageId] = imageData;
                }
            } catch (error) {
                console.warn('[VibeGroup] Failed to load preset image for export:', preset.imageId, error.message);
            }
        }
    }

    // Build export JSON structure
    const exportData = {
        groups: {
            [groupId]: {
                vibes: group.vibes,
                createdAt: group.createdAt,
                updatedAt: group.updatedAt
            }
        },
        vibeData: vibeData,
        vibePresets: relatedPresets,
        presetImages: presetImages
    };

    // Create Blob and download link
    const jsonString = JSON.stringify(exportData, null, 2);
    const blob = new Blob([jsonString], { type: 'application/json' });
    const url = URL.createObjectURL(blob);

    // Create download link and trigger download
    const a = document.createElement('a');
    a.href = url;
    a.download = `vibe-group-${groupId}-${Date.now()}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);

    // Clean up URL object
    URL.revokeObjectURL(url);

    console.log('[VibeGroup] Exported group:', groupId, 'with', vibeIds.length, 'Vibes,', Object.keys(relatedPresets).length, 'presets');
}

/**
 * Export all Vibe groups
 * Creates a JSON file containing all groups and their referenced Vibe data
 * 
 * @returns {Promise<void>}
 */
async function exportAllVibeGroups() {
    const settings = extension_settings[extensionName];
    const vibeGroups = settings.vibeGroups || {};

    // Collect all unique Vibe IDs from all groups
    const allVibeIds = new Set();
    for (const groupId in vibeGroups) {
        const group = vibeGroups[groupId];
        if (group.vibes) {
            group.vibes.forEach(v => allVibeIds.add(v.vibeDataId));
        }
    }

    // Resolve all Vibe IDs to full data
    const vibeData = {};
    for (const vibeId of allVibeIds) {
        try {
            const rawData = await getConfigText(vibeId);
            if (rawData) {
                // Parse data URL to JSON object for proper export
                const parsedData = parseVibeDataFromDataUrl(rawData);
                if (parsedData) {
                    vibeData[vibeId] = parsedData;
                } else {
                    console.warn('[VibeGroup] Failed to parse Vibe data for export all:', vibeId);
                }
            } else {
                console.warn('[VibeGroup] Vibe data not found for ID:', vibeId);
            }
        } catch (error) {
            // Enhanced error logging with specific error type handling
            let errorType = error.name || 'Error';
            if (error.name === 'QuotaExceededError' || error.message.includes('quota')) {
                errorType = 'QuotaExceededError';
            } else if (error.name === 'NotFoundError') {
                errorType = 'NotFoundError';
            } else if (error.name === 'InvalidStateError') {
                errorType = 'InvalidStateError';
            }

            console.error('[VibeGroup] Failed to load Vibe data for export all:', {
                vibeDataId: vibeId.substring(0, 12) + '...',
                error: error.message,
                errorName: errorType,
                timestamp: new Date().toISOString(),
                stack: error.stack
            });
        }
    }

    // Collect related vibePresets that reference any vibeDataId in the groups
    const relatedPresets = {};
    const allPresets = settings.vibePresets || {};
    for (const presetName in allPresets) {
        const preset = allPresets[presetName];
        if (preset.vibeDataId && allVibeIds.has(preset.vibeDataId)) {
            relatedPresets[presetName] = { ...preset };
        }
    }

    // Collect preset preview images from configDatabase
    const presetImages = {};
    for (const presetName in relatedPresets) {
        const preset = relatedPresets[presetName];
        if (preset.imageId) {
            try {
                const imageData = await getConfigImage(preset.imageId);
                if (imageData) {
                    presetImages[preset.imageId] = imageData;
                }
            } catch (error) {
                console.warn('[VibeGroup] Failed to load preset image for export all:', preset.imageId, error.message);
            }
        }
    }

    // Build export JSON with all groups
    const exportData = {
        groups: vibeGroups,
        vibeData: vibeData,
        vibePresets: relatedPresets,
        presetImages: presetImages
    };

    // Create Blob and download link
    const jsonString = JSON.stringify(exportData, null, 2);
    const blob = new Blob([jsonString], { type: 'application/json' });
    const url = URL.createObjectURL(blob);

    // Trigger download
    const a = document.createElement('a');
    a.href = url;
    a.download = `vibe-groups-all-${Date.now()}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);

    // Clean up URL object
    URL.revokeObjectURL(url);

    console.log('[VibeGroup] Exported all groups:', Object.keys(vibeGroups).length, 'groups with', allVibeIds.size, 'unique Vibes,', Object.keys(relatedPresets).length, 'presets');
}

/**
 * Read file as text
 * Helper function to read a File object and return its content as text
 * 
 * @param {File} file - The file to read
 * @returns {Promise<string>} The file content as text
 */
function readFileAsText(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (e) => resolve(e.target.result);
        reader.onerror = (e) => reject(new Error('文件读取失败'));
        reader.readAsText(file);
    });
}

/**
 * Import Vibe group(s) from JSON file
 * Parses imported JSON, validates structure, saves Vibe data to configDatabase,
 * and creates group entries with Vibe IDs
 * 
 * @param {string} jsonString - The JSON string to import
 * @returns {Promise<Object>} Import result with success status and details
 */
async function importVibeGroup(jsonString) {
    const result = {
        success: false,
        groupsImported: 0,
        vibesImported: 0,
        presetsImported: 0,
        errors: [],
        warnings: []
    };

    try {
        // Parse imported JSON file
        let importData;
        try {
            importData = JSON.parse(jsonString);
        } catch (parseError) {
            result.errors.push('文件格式错误: 无效的 JSON 格式');
            console.error('[VibeGroup] JSON parse error:', {
                error: parseError.message,
                errorName: parseError.name,
                position: parseError.message.match(/position (\d+)/)?.[1] || 'unknown',
                fileSize: jsonString.length,
                timestamp: new Date().toISOString()
            });
            console.error('[VibeGroup] First 200 characters of file:', jsonString.substring(0, 200));
            return result;
        }

        // Validate JSON structure - check for required fields
        if (!importData || typeof importData !== 'object') {
            result.errors.push('文件格式错误: 根对象无效');
            return result;
        }

        if (!importData.groups || typeof importData.groups !== 'object') {
            result.errors.push('文件格式错误: 缺少 groups 字段');
            return result;
        }

        if (!importData.vibeData || typeof importData.vibeData !== 'object') {
            result.errors.push('文件格式错误: 缺少 vibeData 字段');
            return result;
        }

        const settings = extension_settings[extensionName];
        const vibeGroups = settings.vibeGroups || {};

        // Save Vibe data to configDatabase
        const savedVibeIds = new Set(); // Track successfully saved Vibe IDs (after remapping)
        const vibeDataKeys = Object.keys(importData.vibeData);
        for (const vibeId of vibeDataKeys) {
            const vibeData = importData.vibeData[vibeId];

            // Validate Vibe data structure
            if (!validateVibeData(vibeData)) {
                result.warnings.push(`跳过无效的 Vibe 数据: ${vibeId}`);
                console.warn('[VibeGroup] Invalid Vibe data structure:', vibeId, vibeData);
                continue;
            }

            try {
                // Use duplicate prevention when saving
                // This will reuse existing Vibe IDs if the data already exists
                const savedVibeId = await saveVibeDataWithDuplicatePrevention(vibeData);

                // If the saved ID is different from the import ID, we need to remap references
                if (savedVibeId !== vibeId) {
                    console.log('[VibeGroup] Remapping Vibe ID:', vibeId, '->', savedVibeId);

                    // Update all references in the import data (groups)
                    for (const groupName in importData.groups) {
                        const groupData = importData.groups[groupName];
                        if (groupData.vibes && Array.isArray(groupData.vibes)) {
                            groupData.vibes.forEach(vibeRef => {
                                if (vibeRef.vibeDataId === vibeId) {
                                    vibeRef.vibeDataId = savedVibeId;
                                }
                            });
                        }
                    }

                    // Update all references in the import data (vibePresets)
                    if (importData.vibePresets && typeof importData.vibePresets === 'object') {
                        for (const presetName in importData.vibePresets) {
                            const preset = importData.vibePresets[presetName];
                            if (preset.vibeDataId === vibeId) {
                                preset.vibeDataId = savedVibeId;
                            }
                        }
                    }
                }

                result.vibesImported++;
                savedVibeIds.add(savedVibeId);
                console.log('[VibeGroup] Imported Vibe data:', savedVibeId);
            } catch (error) {
                result.warnings.push(`保存 Vibe 数据失败: ${vibeId}`);

                // Enhanced error logging with specific error type handling
                let errorType = error.name || 'Error';
                if (error.name === 'QuotaExceededError' || error.message.includes('quota')) {
                    errorType = 'QuotaExceededError';
                } else if (error.name === 'NotFoundError') {
                    errorType = 'NotFoundError';
                } else if (error.name === 'InvalidStateError') {
                    errorType = 'InvalidStateError';
                }

                console.error('[VibeGroup] Failed to save Vibe data:', {
                    vibeDataId: vibeId.substring(0, 12) + '...',
                    error: error.message,
                    errorName: errorType,
                    timestamp: new Date().toISOString(),
                    stack: error.stack
                });
            }
        }

        // Create group entries with Vibe IDs
        const groupNames = Object.keys(importData.groups);
        for (const groupName of groupNames) {
            const groupData = importData.groups[groupName];

            // Validate group data structure
            if (!groupData || typeof groupData !== 'object') {
                result.warnings.push(`跳过无效的组: ${groupName}`);
                console.warn('[VibeGroup] Invalid group data:', groupName, groupData);
                continue;
            }

            if (!Array.isArray(groupData.vibes)) {
                result.warnings.push(`跳过无效的组 (vibes 不是数组): ${groupName}`);
                console.warn('[VibeGroup] Group vibes is not an array:', groupName, groupData);
                continue;
            }

            // Handle name conflicts
            let finalGroupName = groupName;
            let counter = 1;
            while (vibeGroups[finalGroupName]) {
                finalGroupName = `${groupName} (${counter})`;
                counter++;
            }

            if (finalGroupName !== groupName) {
                result.warnings.push(`组名冲突: "${groupName}" 已重命名为 "${finalGroupName}"`);
                console.log('[VibeGroup] Group name conflict, renamed:', groupName, '->', finalGroupName);
            }

            // Filter out Vibes with missing data
            const validVibes = [];
            for (const vibeRef of groupData.vibes) {
                // Validate Vibe reference structure
                if (!vibeRef || typeof vibeRef !== 'object' || !vibeRef.vibeDataId) {
                    result.warnings.push(`跳过无效的 Vibe 引用 (组: ${finalGroupName})`);
                    continue;
                }

                // Check if Vibe data was successfully saved during import
                if (!savedVibeIds.has(vibeRef.vibeDataId)) {
                    result.warnings.push(`跳过缺失的 Vibe: ${vibeRef.vibeDataId} (组: ${finalGroupName})`);
                    console.warn('[VibeGroup] Vibe data not successfully imported:', vibeRef.vibeDataId);
                    continue;
                }

                // Validate and clamp strength value
                let strength = parseFloat(vibeRef.strength);
                if (isNaN(strength) || strength < 0 || strength > 1) {
                    strength = 0.6; // Default strength
                    result.warnings.push(`Vibe 强度值无效，已重置为默认值 (组: ${finalGroupName})`);
                }

                validVibes.push({
                    vibeDataId: vibeRef.vibeDataId,
                    strength: strength
                });
            }

            // Create group entry
            vibeGroups[finalGroupName] = {
                vibes: validVibes,
                createdAt: groupData.createdAt || Date.now(),
                updatedAt: Date.now() // Update timestamp on import
            };

            result.groupsImported++;
            console.log('[VibeGroup] Imported group:', finalGroupName, 'with', validVibes.length, 'Vibes');
        }

        // Import vibePresets if present (optional, for backward compatibility)
        if (importData.vibePresets && typeof importData.vibePresets === 'object') {
            // Import preset preview images first (if present)
            const imageIdMap = {}; // old imageId -> new imageId
            if (importData.presetImages && typeof importData.presetImages === 'object') {
                for (const oldImageId in importData.presetImages) {
                    try {
                        const imageData = importData.presetImages[oldImageId];
                        if (imageData && typeof imageData === 'string') {
                            const newImageId = await saveConfigImage(imageData, getVibeStorageOptions());
                            imageIdMap[oldImageId] = newImageId;
                            console.log('[VibeGroup] Imported preset image:', oldImageId, '->', newImageId);
                        }
                    } catch (error) {
                        console.warn('[VibeGroup] Failed to import preset image:', oldImageId, error.message);
                    }
                }
            }

            const existingPresets = settings.vibePresets || {};
            const presetNames = Object.keys(importData.vibePresets);

            for (const presetName of presetNames) {
                const presetData = importData.vibePresets[presetName];

                // Validate preset data structure
                if (!presetData || typeof presetData !== 'object') {
                    result.warnings.push(`跳过无效的预设: ${presetName}`);
                    console.warn('[VibeGroup] Invalid preset data:', presetName, presetData);
                    continue;
                }

                // Handle name conflicts
                let finalPresetName = presetName;
                let counter = 1;
                while (existingPresets[finalPresetName]) {
                    finalPresetName = `${presetName} (${counter})`;
                    counter++;
                }

                if (finalPresetName !== presetName) {
                    result.warnings.push(`预设名冲突: "${presetName}" 已重命名为 "${finalPresetName}"`);
                    console.log('[VibeGroup] Preset name conflict, renamed:', presetName, '->', finalPresetName);
                }

                // Remap imageId if it was re-imported
                const mappedImageId = presetData.imageId ? (imageIdMap[presetData.imageId] || presetData.imageId) : null;

                // Create preset entry with safe defaults
                existingPresets[finalPresetName] = {
                    model: presetData.model || 'nai-diffusion-4-5-curated',
                    infoExtract: typeof presetData.infoExtract === 'number' ? presetData.infoExtract : 1.0,
                    strength: typeof presetData.strength === 'number' ? presetData.strength : 0.6,
                    imageId: mappedImageId,
                    vibeDataId: presetData.vibeDataId || null
                };

                result.presetsImported++;
                console.log('[VibeGroup] Imported preset:', finalPresetName);
            }

            settings.vibePresets = existingPresets;
        }

        // Save settings
        saveSettingsDebounced();

        result.success = true;
        return result;

    } catch (error) {
        result.errors.push(`导入失败: ${error.message}`);
        console.error('[VibeGroup] Import error:', {
            error: error.message,
            errorName: error.name,
            timestamp: new Date().toISOString(),
            stack: error.stack
        });
        return result;
    }
}

/**
 * Validate Vibe data structure
 * Checks if the Vibe data has all required fields
 * 
 * @param {Object} vibeData - The Vibe data to validate
 * @returns {boolean} True if valid, false otherwise
 */
function validateVibeData(vibeData) {
    if (!vibeData || typeof vibeData !== 'object') {
        return false;
    }

    // Check for required fields according to .naiv4vibe format
    if (vibeData.identifier !== 'novelai-vibe-transfer') {
        return false;
    }

    if (vibeData.version !== 1) {
        return false;
    }

    if (vibeData.image && typeof vibeData.image !== 'string') {
        return false;
    }

    if (!vibeData.encodings || typeof vibeData.encodings !== 'object') {
        return false;
    }

    // Optional but recommended fields
    if (!vibeData.id || typeof vibeData.id !== 'string') {
        console.warn('[VibeGroup] Vibe data missing id field');
    }

    return true;
}

/**
 * Validate that a Vibe group stores only IDs and strengths
 * Checks if the group data structure is correct and logs warnings for invalid data
 * 
 * @param {Object} group - The Vibe group to validate
 * @param {string} groupName - The name of the group (for logging)
 * @returns {boolean} True if valid, false otherwise
 */
function validateVibeGroupStorage(group, groupName) {
    if (!group || typeof group !== 'object') {
        console.warn('[VibeGroup] Invalid group structure:', groupName);
        return false;
    }

    if (!Array.isArray(group.vibes)) {
        console.warn('[VibeGroup] Group vibes is not an array:', groupName);
        return false;
    }

    let isValid = true;

    // Verify groups store only IDs and strengths
    for (let i = 0; i < group.vibes.length; i++) {
        const vibeRef = group.vibes[i];

        // Check if vibeRef is an object
        if (!vibeRef || typeof vibeRef !== 'object') {
            console.warn(`[VibeGroup] Invalid Vibe reference at index ${i} in group "${groupName}"`);
            isValid = false;
            continue;
        }

        // Check for required fields
        if (!vibeRef.vibeDataId || typeof vibeRef.vibeDataId !== 'string') {
            console.warn(`[VibeGroup] Missing or invalid vibeDataId at index ${i} in group "${groupName}"`);
            isValid = false;
        }

        if (typeof vibeRef.strength !== 'number') {
            console.warn(`[VibeGroup] Missing or invalid strength at index ${i} in group "${groupName}"`);
            isValid = false;
        }

        // Check for invalid fields (should only have vibeDataId and strength)
        const allowedFields = ['vibeDataId', 'strength'];
        const actualFields = Object.keys(vibeRef);
        const extraFields = actualFields.filter(field => !allowedFields.includes(field));

        if (extraFields.length > 0) {
            console.warn(`[VibeGroup] Group "${groupName}" contains extra fields in Vibe reference at index ${i}:`, extraFields);
            console.warn('[VibeGroup] Groups should only store vibeDataId and strength, not full Vibe data');
            isValid = false;
        }

        // Validate strength range
        if (typeof vibeRef.strength === 'number' && (vibeRef.strength < 0 || vibeRef.strength > 1)) {
            console.warn(`[VibeGroup] Strength value out of range [0, 1] at index ${i} in group "${groupName}": ${vibeRef.strength}`);
            isValid = false;
        }
    }

    return isValid;
}

/**
 * Validate all Vibe groups in storage
 * Iterates through all groups and validates their structure
 * 
 * @returns {Object} Validation result with counts and issues
 */
export function validateAllVibeGroups() {
    const settings = extension_settings[extensionName];
    const vibeGroups = settings.vibeGroups || {};

    const result = {
        totalGroups: 0,
        validGroups: 0,
        invalidGroups: 0,
        issues: []
    };

    const groupNames = Object.keys(vibeGroups);
    result.totalGroups = groupNames.length;

    for (const groupName of groupNames) {
        const group = vibeGroups[groupName];
        const isValid = validateVibeGroupStorage(group, groupName);

        if (isValid) {
            result.validGroups++;
        } else {
            result.invalidGroups++;
            result.issues.push(groupName);
        }
    }

    console.log('[VibeGroup] Validation complete:', result);
    return result;
}

// In-memory cache for resolved Vibe data
const vibeDataCache = new Map();

/**
 * Resolve Vibe data from ID
 * Loads Vibe data from configDatabase by ID and caches it in memory
 * 
 * @param {string} vibeDataId - The Vibe data ID to resolve
 * @param {boolean} useCache - Whether to use cached data (default: true)
 * @returns {Promise<Object|null>} The resolved Vibe data or null if not found
 */
export async function resolveVibeData(vibeDataId, useCache = true) {
    if (!vibeDataId || typeof vibeDataId !== 'string') {
        console.warn('[VibeGroup] Invalid vibeDataId provided to resolveVibeData:', vibeDataId);
        return null;
    }

    // Check cache first if enabled
    if (useCache && vibeDataCache.has(vibeDataId)) {
        console.log('[VibeGroup] Resolved Vibe data from cache:', vibeDataId);
        return vibeDataCache.get(vibeDataId);
    }

    // Load Vibe data from configDatabase by ID
    try {
        const rawData = await getConfigText(vibeDataId);

        if (!rawData) {
            console.warn('[VibeGroup] Vibe data not found in configDatabase:', vibeDataId);
            return null;
        }

        const vibeData = parseVibeDataFromDataUrl(rawData);
        if (!vibeData) {
            console.warn('[VibeGroup] Failed to parse Vibe data:', vibeDataId);
            return null;
        }

        // Validate the loaded data
        if (!validateVibeData(vibeData)) {
            console.warn('[VibeGroup] Loaded Vibe data is invalid:', vibeDataId);
            return null;
        }

        // Cache resolved data in memory
        vibeDataCache.set(vibeDataId, vibeData);
        console.log('[VibeGroup] Resolved and cached Vibe data:', vibeDataId);

        return vibeData;
    } catch (error) {
        // Handle missing Vibe data gracefully with detailed error logging
        console.error('[VibeGroup] ConfigDatabase access error while loading Vibe data:', {
            vibeDataId: vibeDataId,
            error: error.message,
            stack: error.stack,
            timestamp: new Date().toISOString()
        });

        // Check for specific error types
        if (error.name === 'QuotaExceededError' || error.message.includes('quota')) {
            console.error('[VibeGroup] Storage quota exceeded. Consider deleting unused Vibes or clearing cache.');
        } else if (error.name === 'NotFoundError') {
            console.error('[VibeGroup] Vibe data not found in database:', vibeDataId);
        } else if (error.name === 'InvalidStateError') {
            console.error('[VibeGroup] Database is in an invalid state. Try refreshing the page.');
        }

        return null;
    }
}

/**
 * Resolve multiple Vibe data IDs
 * Efficiently loads multiple Vibe data objects from configDatabase
 * 
 * @param {string[]} vibeDataIds - Array of Vibe data IDs to resolve
 * @param {boolean} useCache - Whether to use cached data (default: true)
 * @returns {Promise<Object>} Map of vibeDataId to resolved Vibe data (null for missing)
 */
export async function resolveMultipleVibeData(vibeDataIds, useCache = true) {
    const results = {};

    // Resolve all Vibe IDs in parallel
    const promises = vibeDataIds.map(async (vibeDataId) => {
        const vibeData = await resolveVibeData(vibeDataId, useCache);
        results[vibeDataId] = vibeData;
    });

    await Promise.all(promises);

    return results;
}

/**
 * Clear Vibe data cache
 * Clears the in-memory cache of resolved Vibe data
 * 
 * @param {string} [vibeDataId] - Optional specific ID to clear, or clear all if not provided
 */
export function clearVibeDataCache(vibeDataId) {
    if (vibeDataId) {
        vibeDataCache.delete(vibeDataId);
        console.log('[VibeGroup] Cleared cache for Vibe:', vibeDataId);
    } else {
        vibeDataCache.clear();
        console.log('[VibeGroup] Cleared all Vibe data cache');
    }
}

/**
 * Get cache statistics
 * Returns information about the current cache state
 * 
 * @returns {Object} Cache statistics
 */
export function getVibeDataCacheStats() {
    return {
        size: vibeDataCache.size,
        keys: Array.from(vibeDataCache.keys())
    };
}

/**
 * Check if Vibe data already exists in configDatabase
 * Compares Vibe data to find if an identical Vibe is already stored
 * 
 * @param {Object} vibeData - The Vibe data to check
 * @returns {Promise<string|null>} The existing Vibe ID if found, null otherwise
 */
export async function findExistingVibeData(vibeData) {
    if (!vibeData || typeof vibeData !== 'object') {
        return null;
    }

    // Get all Vibe IDs from all groups
    const settings = extension_settings[extensionName];
    const vibeGroups = settings.vibeGroups || {};
    const vibePresets = settings.vibePresets || {};

    const allVibeIds = new Set();

    // Collect Vibe IDs from groups
    for (const groupName in vibeGroups) {
        const group = vibeGroups[groupName];
        if (group.vibes && Array.isArray(group.vibes)) {
            group.vibes.forEach(v => {
                if (v.vibeDataId) {
                    allVibeIds.add(v.vibeDataId);
                }
            });
        }
    }

    // Collect Vibe IDs from presets
    for (const presetName in vibePresets) {
        const preset = vibePresets[presetName];
        if (preset.vibeDataId) {
            allVibeIds.add(preset.vibeDataId);
        }
    }

    // Check each existing Vibe to see if it matches
    for (const vibeId of allVibeIds) {
        try {
            const existingVibeData = await resolveVibeData(vibeId, true);

            if (existingVibeData && areVibesEqual(vibeData, existingVibeData)) {
                console.log('[VibeGroup] Found existing Vibe data:', vibeId);
                return vibeId;
            }
        } catch (error) {
            console.warn('[VibeGroup] Error checking Vibe:', {
                vibeDataId: vibeId.substring(0, 12) + '...',
                error: error.message,
                errorName: error.name,
                timestamp: new Date().toISOString()
            });
        }
    }

    return null;
}

/**
 * Compare two Vibe data objects for equality
 * Checks if two Vibe objects are functionally identical
 * 
 * @param {Object} vibe1 - First Vibe data object
 * @param {Object} vibe2 - Second Vibe data object
 * @returns {boolean} True if Vibes are equal, false otherwise
 */
function areVibesEqual(vibe1, vibe2) {
    if (!vibe1 || !vibe2) {
        return false;
    }

    // Compare key fields that define a unique Vibe
    // We compare the image data and encodings, which are the core of a Vibe

    // Compare image data
    if (vibe1.image !== vibe2.image) {
        return false;
    }

    // Compare encodings (deep comparison)
    if (!vibe1.encodings || !vibe2.encodings) {
        return false;
    }

    const encodings1Keys = Object.keys(vibe1.encodings).sort();
    const encodings2Keys = Object.keys(vibe2.encodings).sort();

    if (encodings1Keys.length !== encodings2Keys.length) {
        return false;
    }

    for (let i = 0; i < encodings1Keys.length; i++) {
        if (encodings1Keys[i] !== encodings2Keys[i]) {
            return false;
        }

        // Compare encoding values (stringify for deep comparison)
        const encoding1 = JSON.stringify(vibe1.encodings[encodings1Keys[i]]);
        const encoding2 = JSON.stringify(vibe2.encodings[encodings2Keys[i]]);

        if (encoding1 !== encoding2) {
            return false;
        }
    }

    // If we get here, the Vibes are functionally identical
    return true;
}

/**
 * Save Vibe data with duplicate prevention
 * Checks if Vibe already exists before saving, reuses existing ID if found
 * 
 * @param {Object} vibeData - The Vibe data to save
 * @returns {Promise<string>} The Vibe data ID (existing or new)
 */
export async function saveVibeDataWithDuplicatePrevention(vibeData) {
    if (!vibeData || typeof vibeData !== 'object') {
        const error = new Error('Invalid Vibe data provided');
        console.error('[VibeGroup] Validation error:', {
            error: error.message,
            vibeData: vibeData,
            timestamp: new Date().toISOString()
        });
        throw error;
    }

    try {
        // Check if Vibe already exists
        const existingVibeId = await findExistingVibeData(vibeData);

        if (existingVibeId) {
            console.log('[VibeGroup] Reusing existing Vibe ID:', existingVibeId);
            await ensureVibeDataStoredByPreference(existingVibeId);
            return existingVibeId;
        }

        // Vibe doesn't exist, save it as new text data.
        const vibeDataId = await saveConfigText(JSON.stringify(vibeData), {
            filename: `vibe_group_${Date.now()}`,
            ...getVibeStorageOptions()
        });

        console.log('[VibeGroup] Saved new Vibe data:', vibeDataId);

        // Add to cache
        vibeDataCache.set(vibeDataId, vibeData);

        return vibeDataId;
    } catch (error) {
        // Enhanced error logging for ConfigDatabase save errors
        console.error('[VibeGroup] ConfigDatabase save error:', {
            error: error.message,
            errorName: error.name,
            stack: error.stack,
            vibeDataSize: JSON.stringify(vibeData).length,
            timestamp: new Date().toISOString()
        });

        // Check for specific error types
        if (error.name === 'QuotaExceededError' || error.message.includes('quota')) {
            console.error('[VibeGroup] Storage quota exceeded error. Database is full.');
            console.error('[VibeGroup] Suggested actions:');
            console.error('[VibeGroup]   1. Delete unused Vibe presets');
            console.error('[VibeGroup]   2. Clear browser cache');
            console.error('[VibeGroup]   3. Export important data before clearing');
            throw new Error('存储空间已满。请删除未使用的 Vibe 或清除缓存。');
        } else if (error.name === 'InvalidStateError') {
            console.error('[VibeGroup] Database is in an invalid state');
            throw new Error('数据库状态无效。请刷新页面后重试。');
        } else if (error.name === 'DataError') {
            console.error('[VibeGroup] Data format error');
            throw new Error('数据格式错误。请检查 Vibe 数据是否有效。');
        }

        // Re-throw the original error if it's not a known type
        throw error;
    }
}

/**
 * Get reference count for a Vibe
 * Counts how many groups and presets reference a specific Vibe ID
 * 
 * @param {string} vibeDataId - The Vibe data ID to check
 * @returns {Object} Reference count information
 */
export function getVibeReferenceCount(vibeDataId) {
    const settings = extension_settings[extensionName];
    const vibeGroups = settings.vibeGroups || {};
    const vibePresets = settings.vibePresets || {};

    let groupReferences = 0;
    let presetReferences = 0;
    const referencingGroups = [];
    const referencingPresets = [];

    // Count references in groups
    for (const groupName in vibeGroups) {
        const group = vibeGroups[groupName];
        if (group.vibes && Array.isArray(group.vibes)) {
            const hasReference = group.vibes.some(v => v.vibeDataId === vibeDataId);
            if (hasReference) {
                groupReferences++;
                referencingGroups.push(groupName);
            }
        }
    }

    // Count references in presets
    for (const presetName in vibePresets) {
        const preset = vibePresets[presetName];
        if (preset.vibeDataId === vibeDataId) {
            presetReferences++;
            referencingPresets.push(presetName);
        }
    }

    return {
        total: groupReferences + presetReferences,
        groupReferences,
        presetReferences,
        referencingGroups,
        referencingPresets
    };
}

/**
 * Show Vibe Group Visual Selector Dialog
 * Creates and displays a visual grid selector for Vibe group presets
 * 
 * @param {Function} onSelect - Optional callback when a preset is selected (presetName) => void
 */
export async function showVibeGroupVisualSelector(onSelect) {
    const parent = document.getElementById('st-chatu8-settings') || document.body;
    const settings = extension_settings[extensionName];
    ensureVibeGroupPresets();

    // Pagination state
    let currentPage = 1;
    let pageSize = 12; // Default page size
    let filteredPresetNames = []; // Filtered preset names

    // Search state
    let searchQuery = '';

    // Mode state
    let isBulkDeleteMode = false;
    let selectedForDelete = new Set();

    // Create backdrop
    const backdrop = document.createElement('div');
    backdrop.className = 'st-chatu8-workflow-viz-backdrop st-chatu8-preset-viz-dialog-wrapper';

    // Build dialog HTML structure with header, toolbar, pagination, and body
    backdrop.innerHTML = `
        <div class="st-chatu8-workflow-viz-dialog st-chatu8-vibe-group-visual-selector-dialog">
            <div class="st-chatu8-workflow-viz-header">
                <h3>选择 Vibe 组预设</h3>
                <span class="st-chatu8-workflow-viz-close">&times;</span>
            </div>
            <div class="st-chatu8-workflow-viz-toolbar" style="justify-content: space-between; align-items: center; gap: 15px; padding: 12px 20px; background: rgba(30, 30, 46, 0.6); border-bottom: 1px solid rgba(255,255,255,0.05);">
                <div class="st-chatu8-viz-search-container" style="position: relative; flex-grow: 1; max-width: 300px;">
                    <i class="fa-solid fa-search" style="position: absolute; left: 12px; top: 50%; transform: translateY(-50%); color: #aaa; pointer-events: none;"></i>
                    <input type="text" class="st-chatu8-viz-search-input" placeholder="搜索 Vibe 组..." style="width: 100%; padding: 8px 12px 8px 36px; background: rgba(0,0,0,0.2); border: 1px solid rgba(255,255,255,0.1); border-radius: 20px; color: white; outline: none; transition: all 0.3s;">
                </div>
                <div class="st-chatu8-viz-mode-controls" style="display: flex; gap: 8px;">
                    <button class="st-chatu8-btn st-chatu8-btn-secondary st-chatu8-mode-toggle-manage" title="管理模式">
                        <i class="fa-solid fa-cog"></i> 管理
                    </button>
                    <button class="st-chatu8-btn st-chatu8-btn-danger st-chatu8-mode-toggle-bulk-delete" title="批量删除模式">
                        <i class="fa-solid fa-trash"></i> 批量删除
                    </button>
                </div>
            </div>
            <div class="st-chatu8-pagination-container">
                <button class="st-chatu8-pagination-btn st-chatu8-pagination-prev" title="上一页">
                    <i class="fa-solid fa-chevron-left"></i>
                </button>
                <div class="st-chatu8-pagination-info">
                    <span class="st-chatu8-pagination-current">1</span>
                    <span>/</span>
                    <span class="st-chatu8-pagination-total">1</span>
                    <span style="margin-left: 8px; color: #666;">|</span>
                    <span style="margin-left: 8px;">共 <span class="st-chatu8-pagination-count">0</span> 个</span>
                </div>
                <button class="st-chatu8-pagination-btn st-chatu8-pagination-next" title="下一页">
                    <i class="fa-solid fa-chevron-right"></i>
                </button>
                <div class="st-chatu8-pagination-size-container">
                    <span class="st-chatu8-pagination-size-label">每页</span>
                    <select class="st-chatu8-pagination-size">
                        <option value="8">8</option>
                        <option value="12" selected>12</option>
                        <option value="16">16</option>
                        <option value="24">24</option>
                    </select>
                </div>
            </div>
            <div class="st-chatu8-workflow-viz-body">
                <div class="st-chatu8-preset-grid">
                    <!-- Vibe group preset cards will be inserted here -->
                </div>
            </div>
        </div>
    `;

    parent.appendChild(backdrop);

    // Bind close button handler
    const closeBtn = backdrop.querySelector('.st-chatu8-workflow-viz-close');
    closeBtn.onclick = () => parent.removeChild(backdrop);

    // Bind backdrop click handler
    backdrop.onclick = (e) => {
        if (e.target === backdrop) {
            parent.removeChild(backdrop);
        }
    };

    /**
     * Update filtered presets based on search query
     * Loads presets from extension_settings.vibeGroups, applies search filtering (case-insensitive),
     * and sorts preset names alphabetically
     */
    function updateFilteredPresets() {
        const vibeGroups = settings.vibeGroups || {};

        // Load all preset names from vibeGroups
        let allPresetNames = Object.keys(vibeGroups);

        // Apply search filtering (case-insensitive)
        if (searchQuery && searchQuery.trim() !== '') {
            const lowerQuery = searchQuery.toLowerCase();
            allPresetNames = allPresetNames.filter(name =>
                name.toLowerCase().includes(lowerQuery)
            );
        }

        // Sort preset names alphabetically (with special handling for default group)
        allPresetNames.sort((a, b) => {
            // Keep "默认组" at the top
            if (a === "默认组") return -1;
            if (b === "默认组") return 1;
            // Sort others alphabetically using Chinese locale
            return a.localeCompare(b, 'zh-CN');
        });

        // Update filtered presets array
        filteredPresetNames = allPresetNames;

        console.log('[VibeGroupVisualSelector] Filtered presets:', filteredPresetNames.length, 'of', Object.keys(vibeGroups).length);
    }

    /**
     * Update pagination UI elements
     * Calculates total pages from filtered presets, updates pagination display elements,
     * and enables/disables prev/next buttons based on current page
     */
    function updatePaginationUI() {
        // Get pagination elements
        const paginationCurrent = backdrop.querySelector('.st-chatu8-pagination-current');
        const paginationTotal = backdrop.querySelector('.st-chatu8-pagination-total');
        const paginationCount = backdrop.querySelector('.st-chatu8-pagination-count');
        const paginationPrev = backdrop.querySelector('.st-chatu8-pagination-prev');
        const paginationNext = backdrop.querySelector('.st-chatu8-pagination-next');

        // Calculate total pages from filtered presets
        const totalPages = Math.max(1, Math.ceil(filteredPresetNames.length / pageSize));

        // Ensure current page is within valid range
        if (currentPage > totalPages) {
            currentPage = totalPages;
        }
        if (currentPage < 1) {
            currentPage = 1;
        }

        // Update pagination display elements
        paginationCurrent.textContent = currentPage;
        paginationTotal.textContent = totalPages;
        paginationCount.textContent = filteredPresetNames.length;

        // Enable/disable prev button based on current page
        if (currentPage <= 1) {
            paginationPrev.disabled = true;
            paginationPrev.style.opacity = '0.5';
            paginationPrev.style.cursor = 'not-allowed';
        } else {
            paginationPrev.disabled = false;
            paginationPrev.style.opacity = '1';
            paginationPrev.style.cursor = 'pointer';
        }

        // Enable/disable next button based on current page
        if (currentPage >= totalPages) {
            paginationNext.disabled = true;
            paginationNext.style.opacity = '0.5';
            paginationNext.style.cursor = 'not-allowed';
        } else {
            paginationNext.disabled = false;
            paginationNext.style.opacity = '1';
            paginationNext.style.cursor = 'pointer';
        }

        console.log('[VibeGroupVisualSelector] Pagination updated:', {
            currentPage,
            totalPages,
            totalPresets: filteredPresetNames.length,
            pageSize
        });
    }

    // Get pagination elements for event binding
    const paginationPrev = backdrop.querySelector('.st-chatu8-pagination-prev');
    const paginationNext = backdrop.querySelector('.st-chatu8-pagination-next');
    const paginationSizeSelect = backdrop.querySelector('.st-chatu8-pagination-size');

    /**
     * Create a Vibe group preset card element
     * Creates card element with proper structure, adds selected class if preset is currently selected,
     * creates image container, and creates preset name label
     * 
     * @param {Object} config - Configuration object
     * @param {string} config.presetName - Name of the preset
     * @param {Object} config.preset - Preset data object
     * @param {boolean} config.isSelected - Whether this preset is currently selected
     * @param {Function} config.onCardClick - Click handler (name, cardElement) => void
     * @param {Function} config.onRefreshGrid - Callback to refresh the grid
     * @returns {Promise<HTMLElement>} The card element
     */
    async function createVibeGroupPresetCard(config) {
        const { presetName, preset, isSelected, onCardClick, onRefreshGrid } = config;

        // Create card element with proper structure
        const card = document.createElement('div');
        card.className = 'st-chatu8-preset-card';
        card.dataset.presetName = presetName;

        // Add selected class if preset is currently selected
        if (isSelected) {
            card.classList.add('selected');
        }

        // Create image container
        const imageContainer = document.createElement('div');
        imageContainer.className = 'st-chatu8-preset-card-image';

        // Check for coverImageId in preset data
        if (preset.coverImageId) {
            try {
                // Load image from Config_Database using getConfigImage
                const imageData = await getConfigImage(preset.coverImageId);

                if (imageData) {
                    // Display image
                    const img = document.createElement('img');
                    img.src = imageData;
                    img.alt = presetName;
                    img.style.cssText = `
                        width: 100%;
                        height: 100%;
                        object-fit: cover;
                    `;
                    imageContainer.appendChild(img);
                } else {
                    // Display placeholder if image not found (missing from database)
                    imageContainer.innerHTML = `
                        <div class="st-chatu8-preset-card-placeholder">
                            <i class="fa-solid fa-image"></i>
                            <div>图像未找到</div>
                        </div>
                    `;
                    console.warn('[VibeGroupVisualSelector] Cover image not found in database:', preset.coverImageId);
                }
            } catch (error) {
                // Handle loading errors gracefully with specific error messages
                let errorMessage = '加载失败';

                if (error.name === 'QuotaExceededError' || error.message.includes('quota')) {
                    errorMessage = '存储已满';
                } else if (error.name === 'NotFoundError') {
                    errorMessage = '图像未找到';
                } else if (error.name === 'InvalidStateError') {
                    errorMessage = '数据库错误';
                }

                imageContainer.innerHTML = `
                    <div class="st-chatu8-preset-card-error">
                        <i class="fa-solid fa-exclamation-triangle"></i>
                        <div>${errorMessage}</div>
                    </div>
                `;
                imageContainer.title = `加载失败: ${error.message}`;
                console.error('[VibeGroupVisualSelector] Failed to load cover image:', preset.coverImageId, {
                    error: error.message,
                    errorName: error.name,
                    presetName: presetName,
                    timestamp: new Date().toISOString()
                });
            }
        } else {
            // Display placeholder if no coverImageId
            imageContainer.innerHTML = `
                <div class="st-chatu8-preset-card-placeholder">
                    <i class="fa-solid fa-image"></i>
                    <div>无图像</div>
                </div>
            `;
        }

        // Create preset name label
        const nameLabel = document.createElement('div');
        nameLabel.className = 'st-chatu8-preset-card-name';
        nameLabel.textContent = presetName;
        nameLabel.title = presetName; // Add tooltip for long names

        // Assemble card
        card.appendChild(imageContainer);
        card.appendChild(nameLabel);

        // Add click handler
        card.onclick = () => {
            if (onCardClick) {
                onCardClick(presetName, card);
            }
        };

        return card;
    }

    /**
     * Create action buttons for management mode
     * Creates upload, delete image (conditional), rename, and delete preset buttons
     * 
     * @param {string} presetName - Name of the preset
     * @param {Object} preset - Preset data object
     * @param {HTMLElement} imageContainer - Image container element
     * @param {Function} onRefreshGrid - Callback to refresh the grid
     * @returns {HTMLElement} The action buttons container
     */
    function createActionButtons(presetName, preset, imageContainer, onRefreshGrid) {
        // Create action buttons container
        const actionsDiv = document.createElement('div');
        actionsDiv.className = 'st-chatu8-preset-card-actions';

        // Create upload button
        const uploadBtn = document.createElement('button');
        uploadBtn.className = 'st-chatu8-preset-action-btn st-chatu8-preset-action-upload';
        uploadBtn.innerHTML = '<i class="fa-solid fa-camera"></i>';
        uploadBtn.title = '上传封面图';
        uploadBtn.onclick = (e) => {
            e.stopPropagation(); // Prevent card click
            handleCoverImageUpload(presetName, imageContainer, onRefreshGrid);
        };

        // Create delete image button (conditional - only if preset has coverImageId)
        const deleteImageBtn = document.createElement('button');
        deleteImageBtn.className = 'st-chatu8-preset-action-btn st-chatu8-preset-action-delete-image';
        deleteImageBtn.innerHTML = '<i class="fa-solid fa-image-slash"></i>';
        deleteImageBtn.title = '删除封面图';
        deleteImageBtn.onclick = (e) => {
            e.stopPropagation(); // Prevent card click
            deleteCoverImage(presetName, imageContainer);
        };

        // Only show delete image button if preset has a cover image
        if (!preset.coverImageId) {
            deleteImageBtn.style.display = 'none';
        }

        // Create rename button
        const renameBtn = document.createElement('button');
        renameBtn.className = 'st-chatu8-preset-action-btn st-chatu8-preset-action-rename';
        renameBtn.innerHTML = '<i class="fa-solid fa-pen"></i>';
        renameBtn.title = '重命名';
        renameBtn.onclick = (e) => {
            e.stopPropagation(); // Prevent card click
            handlePresetRename(presetName, onRefreshGrid);
        };

        // Create delete preset button
        const deleteBtn = document.createElement('button');
        deleteBtn.className = 'st-chatu8-preset-action-btn st-chatu8-preset-action-delete';
        deleteBtn.innerHTML = '<i class="fa-solid fa-trash"></i>';
        deleteBtn.title = '删除预设';
        deleteBtn.onclick = (e) => {
            e.stopPropagation(); // Prevent card click
            handlePresetDelete(presetName, onRefreshGrid);
        };

        // Add buttons to container
        actionsDiv.appendChild(uploadBtn);
        actionsDiv.appendChild(deleteImageBtn);
        actionsDiv.appendChild(renameBtn);
        actionsDiv.appendChild(deleteBtn);

        return actionsDiv;
    }

    /**
     * Handle cover image upload for a Vibe group preset
     * 
     * @param {string} presetName - Name of the preset
     * @param {HTMLElement} imageContainer - Container element for the image
     * @param {Function} onRefreshGrid - Callback to refresh the grid
     */
    async function handleCoverImageUpload(presetName, imageContainer, onRefreshGrid) {
        console.log('[VibeGroupVisualSelector] Cover image upload clicked for:', presetName);

        // Create file input element
        const fileInput = document.createElement('input');
        fileInput.type = 'file';
        fileInput.accept = 'image/*';
        fileInput.style.display = 'none';

        // Handle file selection
        fileInput.onchange = async (e) => {
            const file = e.target.files[0];
            if (!file) {
                return;
            }

            try {
                const { dataUrl: coverDataUrl, format: imageFormat } = await createCoverDataUrl(file);

                const vibeGroups = settings.vibeGroups || {};
                const preset = vibeGroups[presetName];

                if (!preset) {
                    console.error('[VibeGroupVisualSelector] Preset not found:', presetName);
                    alert('错误: 预设不存在');
                    return;
                }

                // Delete old cover image if exists
                if (preset.coverImageId) {
                    try {
                        await deleteConfigImage(preset.coverImageId);
                        console.log('[VibeGroupVisualSelector] Deleted old cover image:', preset.coverImageId);
                    } catch (error) {
                        console.warn('[VibeGroupVisualSelector] Failed to delete old cover image:', error);
                        // Continue with upload even if deletion fails
                    }
                }

                // Save new image to Config_Database
                const newImageId = await saveConfigImage(coverDataUrl, {
                    format: imageFormat,
                    filename: `vibe_group_cover_${presetName}_${Date.now()}`,
                    ...getVibeStorageOptions()
                });

                console.log('[VibeGroupVisualSelector] Saved new cover image:', newImageId);

                // Update preset coverImageId
                preset.coverImageId = newImageId;
                preset.updatedAt = Date.now();

                // Save settings with error handling
                try {
                    saveSettingsDebounced();
                } catch (error) {
                    console.error('[VibeGroupVisualSelector] Failed to save settings after cover image upload:', error);
                    alert(`图片已上传但保存设置失败: ${error.message}`);
                    return;
                }

                // Refresh card display
                await refreshCardImage(imageContainer, coverDataUrl);

                console.log('[VibeGroupVisualSelector] Cover image uploaded successfully for:', presetName);

            } catch (error) {
                console.error('[VibeGroupVisualSelector] Failed to upload cover image:', error);

                // Handle specific error types
                if (error.name === 'QuotaExceededError' || error.message.includes('quota')) {
                    alert('存储空间已满。请删除未使用的图片或清除缓存。');
                } else {
                    alert(`上传失败: ${error.message}`);
                }
            } finally {
                // Clean up file input
                document.body.removeChild(fileInput);
            }
        };

        // Add to DOM and trigger click
        document.body.appendChild(fileInput);
        fileInput.click();
    }

    /**
     * Delete cover image from a Vibe group preset
     * 
     * @param {string} presetName - Name of the preset
     * @param {HTMLElement} imageContainer - Container element for the image
     */
    async function deleteCoverImage(presetName, imageContainer) {
        console.log('[VibeGroupVisualSelector] Delete cover image clicked for:', presetName);

        // Prompt for confirmation
        const confirmed = confirm(`确定要删除 "${presetName}" 的封面图吗？`);
        if (!confirmed) {
            return;
        }

        try {
            const vibeGroups = settings.vibeGroups || {};
            const preset = vibeGroups[presetName];

            if (!preset) {
                console.error('[VibeGroupVisualSelector] Preset not found:', presetName);
                alert('错误: 预设不存在');
                return;
            }

            if (!preset.coverImageId) {
                console.warn('[VibeGroupVisualSelector] No cover image to delete for:', presetName);
                alert('该预设没有封面图');
                return;
            }

            // Delete image from Config_Database
            try {
                await deleteConfigImage(preset.coverImageId);
                console.log('[VibeGroupVisualSelector] Deleted cover image from database:', preset.coverImageId);
            } catch (error) {
                console.error('[VibeGroupVisualSelector] Failed to delete image from database:', error);
                // Continue with removing the reference even if database deletion fails
            }

            // Remove coverImageId from preset
            delete preset.coverImageId;
            preset.updatedAt = Date.now();

            // Save settings with error handling
            try {
                saveSettingsDebounced();
            } catch (error) {
                console.error('[VibeGroupVisualSelector] Failed to save settings after deleting cover image:', error);
                alert(`图片已删除但保存设置失败: ${error.message}`);
                return;
            }

            // Refresh card display
            await refreshCardImage(imageContainer, null);

            console.log('[VibeGroupVisualSelector] Cover image deleted successfully for:', presetName);

        } catch (error) {
            console.error('[VibeGroupVisualSelector] Failed to delete cover image:', error);
            alert(`删除失败: ${error.message}`);
        }
    }

    /**
     * Handle preset renaming
     * 
     * @param {string} oldName - Current preset name
     * @param {Function} onRefreshGrid - Callback to refresh the grid
     */
    async function handlePresetRename(oldName, onRefreshGrid) {
        const vibeGroups = settings.vibeGroups || {};

        // Prompt for new name
        const newName = prompt('请输入新的组名称:', oldName);

        // User cancelled
        if (newName === null) {
            return;
        }

        // Validate name is not empty
        const trimmedName = newName.trim();
        if (!trimmedName) {
            alert('组名不能为空');
            console.warn('[VibeGroupVisualSelector] Rename failed: empty name');
            return;
        }

        // Check if name is unchanged
        if (trimmedName === oldName) {
            console.log('[VibeGroupVisualSelector] Rename cancelled: name unchanged');
            return;
        }

        // Validate name is unique
        if (vibeGroups[trimmedName]) {
            alert(`组名 "${trimmedName}" 已存在`);
            console.warn('[VibeGroupVisualSelector] Rename failed: name already exists:', trimmedName);
            return;
        }

        // Update vibeGroups with new name
        const groupData = vibeGroups[oldName];
        vibeGroups[trimmedName] = groupData;
        delete vibeGroups[oldName];

        // Update timestamp
        groupData.updatedAt = Date.now();

        // Update vibeGroupId if renamed preset was selected
        if (settings.vibeGroupId === oldName) {
            settings.vibeGroupId = trimmedName;
            console.log('[VibeGroupVisualSelector] Updated vibeGroupId to:', trimmedName);
        }

        // Save settings with error handling
        try {
            saveSettingsDebounced();
        } catch (error) {
            console.error('[VibeGroupVisualSelector] Failed to save settings after renaming preset:', error);
            alert(`重命名成功但保存设置失败: ${error.message}`);
            // Still refresh grid to show the change
        }

        console.log('[VibeGroupVisualSelector] Renamed preset:', oldName, '->', trimmedName);

        // Refresh grid
        if (onRefreshGrid) {
            onRefreshGrid();
        }
    }

    /**
     * Handle single preset deletion
     * 
     * @param {string} presetName - Name of the preset to delete
     * @param {Function} onRefreshGrid - Callback to refresh the grid
     */
    async function handlePresetDelete(presetName, onRefreshGrid) {
        const vibeGroups = settings.vibeGroups || {};
        const preset = vibeGroups[presetName];

        if (!preset) {
            console.error('[VibeGroupVisualSelector] Preset not found:', presetName);
            alert(`错误: 预设 "${presetName}" 不存在`);
            return;
        }

        // Prevent deletion of default group if it's the only one
        const groupCount = Object.keys(vibeGroups).length;
        if (presetName === "默认组" && groupCount === 1) {
            alert('不能删除唯一的组');
            console.warn('[VibeGroupVisualSelector] Cannot delete the only group');
            return;
        }

        // Prompt for confirmation
        const confirmed = confirm(`确定要删除组 "${presetName}" 吗？此操作无法撤销。`);
        if (!confirmed) {
            console.log('[VibeGroupVisualSelector] Deletion cancelled by user');
            return;
        }

        try {
            // Delete cover image if exists
            if (preset.coverImageId) {
                try {
                    await deleteConfigImage(preset.coverImageId);
                    console.log('[VibeGroupVisualSelector] Deleted cover image:', preset.coverImageId);
                } catch (error) {
                    console.warn('[VibeGroupVisualSelector] Failed to delete cover image:', preset.coverImageId, error);
                    // Continue with preset deletion even if image deletion fails
                }
            }

            // Delete preset from vibeGroups
            delete vibeGroups[presetName];
            console.log('[VibeGroupVisualSelector] Deleted preset:', presetName);

            // Switch to default group if deleted preset was selected
            if (settings.vibeGroupId === presetName) {
                // Try to switch to default group first
                if (vibeGroups["默认组"]) {
                    settings.vibeGroupId = "默认组";
                } else {
                    // If no default group, switch to first available group
                    const remainingGroups = Object.keys(vibeGroups);
                    if (remainingGroups.length > 0) {
                        settings.vibeGroupId = remainingGroups[0];
                    } else {
                        // If no groups remain, create default group
                        vibeGroups["默认组"] = {
                            vibes: [],
                            createdAt: Date.now(),
                            updatedAt: Date.now()
                        };
                        settings.vibeGroupId = "默认组";
                        console.log('[VibeGroupVisualSelector] Created default group after deleting last group');
                    }
                }
                console.log('[VibeGroupVisualSelector] Switched to group:', settings.vibeGroupId);
            }

            // Save settings with error handling
            try {
                saveSettingsDebounced();
            } catch (error) {
                console.error('[VibeGroupVisualSelector] Failed to save settings after deleting preset:', error);
                alert(`删除成功但保存设置失败: ${error.message}`);
                // Still refresh grid/close dialog
            }

            // Refresh grid or close dialog
            if (Object.keys(vibeGroups).length === 0) {
                // If no groups remain, close dialog
                console.log('[VibeGroupVisualSelector] No groups remaining, closing dialog');
                parent.removeChild(backdrop);
            } else {
                // Refresh grid to show updated list
                onRefreshGrid();
            }

            console.log('[VibeGroupVisualSelector] Successfully deleted preset:', presetName);
        } catch (error) {
            console.error('[VibeGroupVisualSelector] Error deleting preset:', error);
            alert(`删除失败: ${error.message}`);
        }
    }

    /**
     * Refresh card image display
     * Clears existing image content, displays new image or placeholder,
     * and preserves action buttons
     * 
     * @param {HTMLElement} container - Image container element
     * @param {string|null} imageData - Base64 image data or null for placeholder
     */
    async function refreshCardImage(container, imageData) {
        // Preserve action buttons if they exist
        const actions = container.querySelector('.st-chatu8-preset-card-actions');

        // Clear existing image content
        container.innerHTML = '';

        // Display new image or placeholder based on result
        if (imageData) {
            // Display image
            const img = document.createElement('img');
            img.src = imageData;
            img.alt = 'Cover image';
            img.style.cssText = `
                width: 100%;
                height: 100%;
                object-fit: cover;
            `;
            container.appendChild(img);
        } else {
            // Display placeholder
            container.innerHTML = `
                <div class="st-chatu8-preset-card-placeholder">
                    <i class="fa-solid fa-image"></i>
                    <div>无图像</div>
                </div>
            `;
        }

        // Preserve action buttons by re-appending them
        if (actions) {
            container.appendChild(actions);
        }

        console.log('[VibeGroupVisualSelector] Card image refreshed');
    }

    /**
     * Render current page of preset cards
     * Calculates start and end indices for current page, clears grid container,
     * creates cards for current page presets, and adds fade-in animation
     */
    async function renderCurrentPage() {
        const gridContainer = backdrop.querySelector('.st-chatu8-preset-grid');
        const vibeGroups = settings.vibeGroups || {};
        const currentGroupId = settings.vibeGroupId;

        // Add fade-out animation
        gridContainer.style.opacity = '0';
        gridContainer.style.transform = 'translateY(10px)';
        gridContainer.style.transition = 'opacity 0.3s ease, transform 0.3s ease';

        // Clear grid container
        gridContainer.innerHTML = '';

        // Check if there are any presets
        if (filteredPresetNames.length === 0) {
            // Display empty state
            gridContainer.innerHTML = `
                <div style="
                    grid-column: 1 / -1;
                    text-align: center;
                    padding: 3rem;
                    color: rgba(255, 255, 255, 0.5);
                ">
                    <i class="fa-solid fa-inbox" style="font-size: 3rem; margin-bottom: 1rem; display: block;"></i>
                    <p>${searchQuery ? '没有找到匹配的 Vibe 组预设' : '没有可用的 Vibe 组预设'}</p>
                    <p style="font-size: 0.9rem; margin-top: 0.5rem;">${searchQuery ? '请尝试其他搜索词' : '请先创建 Vibe 组预设'}</p>
                </div>
            `;

            // Add fade-in animation
            gridContainer.style.opacity = '1';
            gridContainer.style.transform = 'translateY(0)';

            console.log('[VibeGroupVisualSelector] Displayed empty state');
            return;
        }

        // Calculate start and end indices for current page
        const startIndex = (currentPage - 1) * pageSize;
        const endIndex = Math.min(startIndex + pageSize, filteredPresetNames.length);

        console.log('[VibeGroupVisualSelector] Rendering page', currentPage, 'presets', startIndex, 'to', endIndex - 1);

        // Create cards for current page presets
        const pagePresetNames = filteredPresetNames.slice(startIndex, endIndex);

        for (const presetName of pagePresetNames) {
            const preset = vibeGroups[presetName];
            const isSelected = presetName === currentGroupId;

            // Create card using createVibeGroupPresetCard
            const card = await createVibeGroupPresetCard({
                presetName,
                preset,
                isSelected,
                onCardClick: (name, cardElement) => {
                    // Check current mode (normal, management, bulk delete)
                    const isManagementMode = backdrop.classList.contains('st-chatu8-mode-manage');

                    if (isBulkDeleteMode) {
                        // In bulk delete mode: toggle selection
                        if (selectedForDelete.has(name)) {
                            selectedForDelete.delete(name);
                            cardElement.classList.remove('bulk-selected');
                            console.log('[VibeGroupVisualSelector] Deselected for bulk delete:', name);
                        } else {
                            selectedForDelete.add(name);
                            cardElement.classList.add('bulk-selected');
                            console.log('[VibeGroupVisualSelector] Selected for bulk delete:', name);
                        }

                        // Update bulk delete button count
                        const bulkDeleteBtn = backdrop.querySelector('.st-chatu8-mode-toggle-bulk-delete');
                        if (bulkDeleteBtn && selectedForDelete.size > 0) {
                            bulkDeleteBtn.innerHTML = `<i class="fa-solid fa-trash"></i> 确认删除 (${selectedForDelete.size})`;
                        } else if (bulkDeleteBtn) {
                            bulkDeleteBtn.innerHTML = `<i class="fa-solid fa-trash"></i> 批量删除`;
                        }
                    } else if (isManagementMode) {
                        // In management mode: do nothing (action buttons handle operations)
                        console.log('[VibeGroupVisualSelector] Card clicked in management mode - no action');
                    } else {
                        // In normal mode: update vibeGroupId and close dialog
                        console.log('[VibeGroupVisualSelector] Card clicked in normal mode:', name);

                        // Update vibeGroupId
                        settings.vibeGroupId = name;

                        // Save settings with error handling
                        try {
                            saveSettingsDebounced();
                        } catch (error) {
                            console.error('[VibeGroupVisualSelector] Failed to save settings after preset selection:', error);
                            alert(`选择成功但保存设置失败: ${error.message}`);
                            // Still call callback and close dialog
                        }

                        // Call onSelect callback if provided
                        if (onSelect) {
                            onSelect(name);
                        }

                        // Close dialog
                        parent.removeChild(backdrop);

                        console.log('[VibeGroupVisualSelector] Preset selected and dialog closed:', name);
                    }
                },
                onRefreshGrid: () => {
                    // Refresh grid callback (will be used in management mode)
                    renderCurrentPage();
                }
            });

            // Add action buttons to card in management mode
            const isManagementMode = backdrop.classList.contains('st-chatu8-mode-manage');
            if (isManagementMode) {
                const imageContainer = card.querySelector('.st-chatu8-preset-card-image');
                const actionButtons = createActionButtons(presetName, preset, imageContainer, () => {
                    // Refresh grid callback
                    updateFilteredPresets();
                    updatePaginationUI();
                    renderCurrentPage();
                });
                imageContainer.appendChild(actionButtons);
            }

            gridContainer.appendChild(card);
        }

        // Add fade-in animation
        gridContainer.style.opacity = '1';
        gridContainer.style.transform = 'translateY(0)';

        console.log('[VibeGroupVisualSelector] Rendered', pagePresetNames.length, 'cards');
    }

    /**
     * Bind prev button click handler
     * Decrements current page and re-renders if not on first page
     */
    paginationPrev.onclick = () => {
        if (currentPage > 1) {
            currentPage--;
            updatePaginationUI();
            renderCurrentPage();
            console.log('[VibeGroupVisualSelector] Navigate to previous page:', currentPage);
        }
    };

    /**
     * Bind next button click handler
     * Increments current page and re-renders if not on last page
     */
    paginationNext.onclick = () => {
        const totalPages = Math.max(1, Math.ceil(filteredPresetNames.length / pageSize));
        if (currentPage < totalPages) {
            currentPage++;
            updatePaginationUI();
            renderCurrentPage();
            console.log('[VibeGroupVisualSelector] Navigate to next page:', currentPage);
        }
    };

    /**
     * Bind page size select change handler
     * Updates page size, resets to page 1, and re-renders
     */
    paginationSizeSelect.onchange = (e) => {
        pageSize = parseInt(e.target.value, 10);
        currentPage = 1; // Reset to first page when changing page size
        updatePaginationUI();
        renderCurrentPage();
        console.log('[VibeGroupVisualSelector] Page size changed to:', pageSize);
    };

    // Initialize filtered presets and pagination
    updateFilteredPresets();
    updatePaginationUI();

    // Render initial page
    renderCurrentPage();

    // Bind search input handler
    const searchInput = backdrop.querySelector('.st-chatu8-viz-search-input');
    searchInput.oninput = (e) => {
        searchQuery = e.target.value.trim();
        currentPage = 1; // Reset to first page on search
        updateFilteredPresets();
        updatePaginationUI();
        renderCurrentPage();
        console.log('[VibeGroupVisualSelector] Search query changed:', searchQuery);
    };

    // Bind management mode toggle button
    const manageModeBtn = backdrop.querySelector('.st-chatu8-mode-toggle-manage');
    let isManagementMode = false;

    manageModeBtn.onclick = () => {
        // Toggle management mode state
        isManagementMode = !isManagementMode;

        // Add/remove management mode class
        if (isManagementMode) {
            backdrop.classList.add('st-chatu8-mode-manage');
            // Update button styling to show active state
            manageModeBtn.classList.add('active');
            manageModeBtn.style.backgroundColor = 'rgba(33, 150, 243, 0.2)';
            manageModeBtn.style.borderColor = '#2196f3';
            console.log('[VibeGroupVisualSelector] Entered management mode');
        } else {
            backdrop.classList.remove('st-chatu8-mode-manage');
            // Update button styling to show inactive state
            manageModeBtn.classList.remove('active');
            manageModeBtn.style.backgroundColor = '';
            manageModeBtn.style.borderColor = '';
            console.log('[VibeGroupVisualSelector] Exited management mode');
        }

        // Exit bulk delete mode if active
        if (isBulkDeleteMode) {
            isBulkDeleteMode = false;
            backdrop.classList.remove('st-chatu8-mode-bulk-delete');
            selectedForDelete.clear();

            // Reset bulk delete button
            const bulkDeleteBtn = backdrop.querySelector('.st-chatu8-mode-toggle-bulk-delete');
            if (bulkDeleteBtn) {
                bulkDeleteBtn.classList.remove('active');
                bulkDeleteBtn.style.backgroundColor = '';
                bulkDeleteBtn.style.borderColor = '';
                bulkDeleteBtn.innerHTML = `<i class="fa-solid fa-trash"></i> 批量删除`;
            }

            console.log('[VibeGroupVisualSelector] Exited bulk delete mode (switched to management mode)');
        }

        // Re-render to show/hide action buttons
        renderCurrentPage();
    };

    // Bind bulk delete mode toggle button
    const bulkDeleteBtn = backdrop.querySelector('.st-chatu8-mode-toggle-bulk-delete');

    bulkDeleteBtn.onclick = () => {
        // Check if we're in bulk delete mode and have selections
        if (isBulkDeleteMode && selectedForDelete.size > 0) {
            // If in bulk delete mode with selections, trigger bulk delete
            handleBulkDelete(selectedForDelete, () => {
                // Refresh grid callback
                updateFilteredPresets();
                updatePaginationUI();
                renderCurrentPage();
            });
        } else {
            // Toggle bulk delete mode state
            isBulkDeleteMode = !isBulkDeleteMode;

            // Add/remove bulk delete mode class
            if (isBulkDeleteMode) {
                backdrop.classList.add('st-chatu8-mode-bulk-delete');
                // Update button styling to show active state
                bulkDeleteBtn.classList.add('active');
                bulkDeleteBtn.style.backgroundColor = 'rgba(244, 67, 54, 0.2)';
                bulkDeleteBtn.style.borderColor = '#f44336';
                // Initialize selectedForDelete set
                selectedForDelete.clear();
                console.log('[VibeGroupVisualSelector] Entered bulk delete mode');
            } else {
                backdrop.classList.remove('st-chatu8-mode-bulk-delete');
                // Update button styling to show inactive state
                bulkDeleteBtn.classList.remove('active');
                bulkDeleteBtn.style.backgroundColor = '';
                bulkDeleteBtn.style.borderColor = '';
                bulkDeleteBtn.innerHTML = `<i class="fa-solid fa-trash"></i> 批量删除`;
                // Clear selectedForDelete set
                selectedForDelete.clear();
                console.log('[VibeGroupVisualSelector] Exited bulk delete mode');
            }

            // Exit management mode if active
            if (isManagementMode) {
                isManagementMode = false;
                backdrop.classList.remove('st-chatu8-mode-manage');
                // Reset management mode button
                manageModeBtn.classList.remove('active');
                manageModeBtn.style.backgroundColor = '';
                manageModeBtn.style.borderColor = '';
                console.log('[VibeGroupVisualSelector] Exited management mode (switched to bulk delete mode)');
            }

            // Re-render to update card states
            renderCurrentPage();
        }
    };

    console.log('[VibeGroupVisualSelector] Dialog opened');
}

/**
 * Handle bulk preset deletion
 * Prompts for confirmation, deletes all selected presets and their cover images,
 * updates vibeGroupId if any selected preset was current, saves settings,
 * exits bulk delete mode, and refreshes grid
 * 
 * @param {Set<string>} selectedPresets - Set of preset names to delete
 * @param {Function} onRefreshGrid - Callback to refresh the grid
 */
async function handleBulkDelete(selectedPresets, onRefreshGrid) {
    const settings = extension_settings[extensionName];
    const vibeGroups = settings.vibeGroups || {};
    const currentGroupId = settings.vibeGroupId;

    // Prompt for confirmation
    const confirmed = confirm(`确定要删除选中的 ${selectedPresets.size} 个 Vibe 组预设吗？此操作无法撤销。`);
    if (!confirmed) {
        console.log('[VibeGroupVisualSelector] Bulk delete cancelled by user');
        return;
    }

    console.log('[VibeGroupVisualSelector] Starting bulk delete of', selectedPresets.size, 'presets');

    let deletedCount = 0;
    let errorCount = 0;
    const errors = [];

    // Delete all selected presets and their cover images
    for (const presetName of selectedPresets) {
        try {
            const preset = vibeGroups[presetName];

            // Delete cover image if exists
            if (preset && preset.coverImageId) {
                try {
                    await deleteConfigImage(preset.coverImageId);
                    console.log('[VibeGroupVisualSelector] Deleted cover image for preset:', presetName);
                } catch (imageError) {
                    console.warn('[VibeGroupVisualSelector] Failed to delete cover image for preset:', presetName, imageError);
                    // Continue with preset deletion even if image deletion fails
                }
            }

            // Delete preset from vibeGroups
            delete vibeGroups[presetName];
            deletedCount++;
            console.log('[VibeGroupVisualSelector] Deleted preset:', presetName);
        } catch (error) {
            errorCount++;
            errors.push({ presetName, error: error.message });
            console.error('[VibeGroupVisualSelector] Failed to delete preset:', presetName, error);
        }
    }

    // Update vibeGroupId if any selected preset was current
    if (selectedPresets.has(currentGroupId)) {
        // Switch to default group or first available group
        if (vibeGroups["默认组"]) {
            settings.vibeGroupId = "默认组";
        } else {
            const remainingGroups = Object.keys(vibeGroups);
            if (remainingGroups.length > 0) {
                settings.vibeGroupId = remainingGroups[0];
            } else {
                // If no groups remain, create default group
                vibeGroups["默认组"] = {
                    vibes: [],
                    createdAt: Date.now(),
                    updatedAt: Date.now()
                };
                settings.vibeGroupId = "默认组";
            }
        }
        console.log('[VibeGroupVisualSelector] Current group was deleted, switched to:', settings.vibeGroupId);
    }

    // Save settings with error handling
    try {
        saveSettingsDebounced();
    } catch (error) {
        console.error('[VibeGroupVisualSelector] Failed to save settings after bulk delete:', error);
        alert(`批量删除完成但保存设置失败: ${error.message}\n\n成功删除: ${deletedCount} 个\n失败: ${errorCount} 个`);
        // Still refresh grid
    }

    // Show result message
    if (errorCount > 0) {
        alert(`批量删除完成。\n成功删除: ${deletedCount} 个\n失败: ${errorCount} 个\n\n请查看控制台以获取详细错误信息。`);
        console.error('[VibeGroupVisualSelector] Bulk delete errors:', errors);
    } else {
        console.log('[VibeGroupVisualSelector] Bulk delete completed successfully:', deletedCount, 'presets deleted');
    }

    // Exit bulk delete mode
    // Note: This will be handled by the calling code through re-rendering

    // Refresh grid
    if (onRefreshGrid) {
        onRefreshGrid();
    }

    console.log('[VibeGroupVisualSelector] Bulk delete operation completed');
}

/**
 * Initialize Vibe Group Editor
 * Sets up event handlers and UI integration
 * 
 * @param {jQuery} settingsModal - The settings modal jQuery object
 */
export function initVibeGroupEditor(settingsModal) {
    // Ensure storage structure exists
    ensureVibeGroupPresets();
    void warmMissingVibePresetThumbnails();

    // Validate all groups on initialization
    validateAllVibeGroups();

    // Bind button click handler
    const vibeGroupEditorBtn = settingsModal.find('#novelai-vibe-group-editor-btn');
    if (vibeGroupEditorBtn.length) {
        vibeGroupEditorBtn.on('click', () => {
            showVibeGroupEditorDialog();
        });
    }
}
