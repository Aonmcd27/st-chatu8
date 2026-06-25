// @ts-nocheck
import { extensionFolderPath } from '../config.js';

/**
 * 将更新日志文本解析为结构化的版本条目数组
 * 通过检测版本号行来分割，兼容任何换行格式
 * @param {string} rawText - 原始更新日志文本
 * @returns {Array<{version: string, changes: string[]}>} 版本条目数组
 */
function parseChangelog(rawText) {
    if (!rawText) return [];

    // 统一按行分割，逐行扫描版本号
    const lines = rawText.split('\n');
    const entries = [];
    let currentEntry = null;

    for (const rawLine of lines) {
        const line = rawLine.trim();
        if (!line) continue; // 跳过空行

        // 检测是否是版本号行（如 v.2.5.3、v2.5.3、v.2.5.3:xxx、v.2.5.3：xxx）
        const versionMatch = line.match(/^(v\.?[\d]+(?:\.[\d]+)*)[\s:：]*(.*)/);

        if (versionMatch) {
            // 新版本块
            currentEntry = {
                version: versionMatch[1],
                changes: []
            };
            entries.push(currentEntry);
            // 如果版本号行后面还有内容（如 "v.2.4.6:修复comfyui返回视频问题"）
            if (versionMatch[2] && versionMatch[2].trim()) {
                currentEntry.changes.push(versionMatch[2].trim());
            }
        } else if (currentEntry) {
            // 普通变更行，归入当前版本
            // 移除开头的序号 如 "1." "2." 等
            currentEntry.changes.push(line.replace(/^\d+\.\s*/, ''));
        }
    }

    return entries;
}

/**
 * 将解析后的版本条目渲染为美化的 HTML
 * @param {Array<{version: string, changes: string[]}>} entries - 版本条目数组
 * @param {string} [currentVersion] - 当前本地版本号（用于高亮）
 * @returns {string} HTML 字符串
 */
function renderChangelog(entries, currentVersion) {
    if (!entries || entries.length === 0) {
        return '<div class="st-chatu8-changelog-empty">暂无更新日志</div>';
    }

    let html = '';
    for (let i = 0; i < entries.length; i++) {
        const entry = entries[i];
        const isLatest = i === 0;
        const isCurrent = currentVersion && (
            entry.version === `v.${currentVersion}` ||
            entry.version === `v${currentVersion}` ||
            entry.version === currentVersion
        );

        let badgeHtml = '';
        if (isLatest) {
            badgeHtml = '<span class="st-chatu8-changelog-badge latest">最新</span>';
        } else if (isCurrent) {
            badgeHtml = '<span class="st-chatu8-changelog-badge current">当前</span>';
        }

        const changesHtml = entry.changes.map(change => {
            // 为不同类型的变更添加图标
            let icon = '•';
            const lowerChange = change.toLowerCase();
            if (/^(修复|fix)/.test(change)) {
                icon = '🔧';
            } else if (/^(新增|添加|新加|支持|add)/.test(change)) {
                icon = '✨';
            } else if (/^(优化|改进|improve)/.test(change)) {
                icon = '⚡';
            } else if (/^(更新|update)/.test(change)) {
                icon = '📦';
            } else if (/^(移除|删除|取消|remove)/.test(change)) {
                icon = '🗑️';
            } else if (/^(更名|重命名|rename)/.test(change)) {
                icon = '📝';
            }
            return `<li><span class="st-chatu8-changelog-icon">${icon}</span><span>${escapeHtml(change)}</span></li>`;
        }).join('');

        html += `
        <div class="st-chatu8-changelog-entry${isLatest ? ' latest' : ''}${isCurrent ? ' current' : ''}">
            <div class="st-chatu8-changelog-version-row">
                <span class="st-chatu8-changelog-version">${escapeHtml(entry.version)}</span>
                ${badgeHtml}
            </div>
            ${entry.changes.length > 0 ? `<ul class="st-chatu8-changelog-changes">${changesHtml}</ul>` : ''}
        </div>`;
    }

    return html;
}

/**
 * HTML 转义
 */
function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

/**
 * 将更新日志渲染到指定容器
 * @param {string} rawText - 原始更新日志文本
 * @param {string} [currentVersion] - 当前本地版本号
 */
function displayChangelog(rawText, currentVersion) {
    const container = document.getElementById('ch-update-notes');
    if (!container) return;

    if (!rawText) {
        container.innerHTML = '<div class="st-chatu8-changelog-empty">无法获取更新日志，请点击"检查更新"按钮重试。</div>';
        return;
    }

    const entries = parseChangelog(rawText);
    container.innerHTML = renderChangelog(entries, currentVersion);
}

async function checkForUpdates() {
    // Always try to fetch and display local version first.
    try {
        const localManifestResponse = await fetch(`${extensionFolderPath}/manifest.json?t=${new Date().getTime()}`, { cache: 'no-cache' });
        if (localManifestResponse.ok) {
            const localManifest = await localManifestResponse.json();
            const localVersion = localManifest.version;
            window.chatu8LocalVersion = localVersion;
        } else {
            console.error('Failed to fetch local manifest for version check.');
        }
    } catch (error) {
        console.error('Error fetching local manifest:', error);
    }

    // Now, check for remote updates.
    const updateStatusElement = document.getElementById('ch-update-status');

    console.log("Checking for updates...");
    try {
        // Fetch remote manifest
        const remoteManifestUrl = `https://raw.githubusercontent.com/damoshen123/st-chatu8/master/manifest.json?t=${new Date().getTime()}`;
        const response = await fetch(remoteManifestUrl, { cache: 'no-cache' });
        if (!response.ok) {
            console.error('Failed to fetch remote manifest for update check.');
            displayChangelog(null);
            if (updateStatusElement) {
                updateStatusElement.textContent = '❌ 无法连接到更新服务器';
                updateStatusElement.className = 'st-chatu8-update-status error';
            }
            window.chatu8UpdateAvailable = false;
            return;
        }
        const remoteManifest = await response.json();
        const remoteVersion = remoteManifest.version;

        // Store remote version for UI
        window.chatu8RemoteVersion = remoteVersion;

        if (remoteManifest.updata) {
            displayChangelog(remoteManifest.updata, window.chatu8LocalVersion);
        }

        // Compare versions if local version is available
        if (window.chatu8LocalVersion) {
            if (remoteVersion.localeCompare(window.chatu8LocalVersion, undefined, { numeric: true, sensitivity: 'base' }) > 0) {
                console.log(`New version available: ${remoteVersion} (current: ${window.chatu8LocalVersion})`);
                window.chatu8UpdateAvailable = true;
                if (updateStatusElement) {
                    updateStatusElement.textContent = `🎉 发现新版本 v${remoteVersion}（当前 v${window.chatu8LocalVersion}）`;
                    updateStatusElement.className = 'st-chatu8-update-status available';
                }
            } else {
                console.log('Extension is up to date.');
                window.chatu8UpdateAvailable = false;
                if (updateStatusElement) {
                    updateStatusElement.textContent = `✅ 已是最新版本 v${window.chatu8LocalVersion}`;
                    updateStatusElement.className = 'st-chatu8-update-status uptodate';
                }
            }
        } else {
            window.chatu8UpdateAvailable = false;
        }
    } catch (error) {
        console.error('Error checking for updates:', error);
        displayChangelog(null);
        if (updateStatusElement) {
            updateStatusElement.textContent = '❌ 检查更新失败，请稍后重试';
            updateStatusElement.className = 'st-chatu8-update-status error';
        }
        window.chatu8UpdateAvailable = false;
    }
}

function updateVersionInfo() {
    const versionDisplay = document.getElementById('ch-version-display');
    if (versionDisplay && window.chatu8LocalVersion) {
        versionDisplay.textContent = `v${window.chatu8LocalVersion}`;
    }

    const updateIndicator = document.getElementById('ch-update-indicator');
    const titleUpdateNotification = document.getElementById('ch-title-update-notification');

    if (window.chatu8UpdateAvailable) {
        if (updateIndicator) {
            updateIndicator.style.display = 'inline';
        }
        if (titleUpdateNotification) {
            titleUpdateNotification.style.display = 'inline';
        }
    }
}

export async function initUpdateCheck(settingsModal, check_update_func) {
    settingsModal.find('#ch-check-update').on('click', async function () {
        const btn = $(this);
        btn.prop('disabled', true).text('检查中...');
        const statusEl = document.getElementById('ch-update-status');
        if (statusEl) {
            statusEl.textContent = '⏳ 正在检查更新...';
            statusEl.className = 'st-chatu8-update-status checking';
        }
        try {
            await check_update_func();
        } finally {
            btn.prop('disabled', false).text('检查更新');
        }
    });

    // 监听 index.js 防篡改代码触发的更新事件，重新渲染美化的更新日志
    const container = document.getElementById('ch-update-notes');
    if (container) {
        container.addEventListener('chatu8-changelog-update', (e) => {
            const { rawText, currentVersion } = e.detail || {};
            if (rawText) {
                displayChangelog(rawText, currentVersion);
            }
        });
    }

    await checkForUpdates();
    updateVersionInfo();
}
