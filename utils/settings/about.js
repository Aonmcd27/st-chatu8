// @ts-nocheck
/**
 * About页面内容模块
 * 将关键声明内容嵌入JS，防止HTML被篡改
 */

// 免责声明内容 - 嵌入JS中以防篡改
const DISCLAIMER_CONTENT = `
    <div class="st-chatu8-settings-section">
        <h3>⚖️ 正当使用声明</h3>
        <div class="st-chatu8-disclaimer">
            <p><strong>本插件仅供以下用途：</strong></p>
            <ul>
                <li>🎨 个人创作与艺术探索</li>
                <li>📚 学习研究与技术测试</li>
                <li>🎮 角色扮演与娱乐互动</li>
            </ul>
            <p>用户应当遵守所在地区的相关法律法规，合理、合法地使用本插件。</p>
        </div>
    </div>
    <div class="st-chatu8-settings-section">
        <h3>⚠️ 免责声明</h3>
        <div class="st-chatu8-disclaimer">
            <p><strong>关于内容责任：</strong></p>
            <ul>
                <li>本插件仅作为图像生成的桥接工具，不直接生成任何图像内容</li>
                <li>所有生成的图像均由用户选择的第三方AI服务提供</li>
                <li>用户生成的所有内容由用户自行负责，与插件作者无关</li>
            </ul>
            <p><strong>关于使用风险：</strong></p>
            <ul>
                <li>用户应确保生成内容符合所在地区法律法规</li>
                <li>禁止使用本插件生成任何违法违规内容</li>
                <li>禁止将生成内容用于任何非法用途或未经授权的商业用途</li>
                <li>因使用本插件产生的任何法律责任或后果，由用户自行承担</li>
            </ul>
            <p style="color: var(--SmartThemeQuoteColor); font-style: italic; margin-top: 10px;">
                使用本插件即表示您已阅读并同意上述声明。
            </p>
        </div>
    </div>
    <div class="st-chatu8-settings-section">
        <h3>💰 关于收费</h3>
        <div class="st-chatu8-disclaimer">
            <p><strong>本插件完全免费！</strong></p>
            <ul>
                <li>🆓 本插件为免费软件，任何人都可以免费使用</li>
                <li>🚫 如果您是通过付费渠道获得本插件，您已被骗</li>
                <li>⚠️ 请勿将本插件用于任何形式的倒卖或收费分发</li>
                <li>💝 如果觉得好用，欢迎通过"支持作者"链接自愿打赏</li>
            </ul>
        </div>
    </div>
`;

/**
 * 获取完整的About页面HTML内容
 * 将基础内容和受保护的声明内容合并
 * @returns {string} 完整的About页面HTML
 */
export function getAboutPageContent() {
    // 基础内容（可以从HTML文件加载，也可以直接嵌入）
    const baseContent = `
<div id="ch-tab-about">
    <div class="st-chatu8-settings-section">
        <h3>关于 智绘姬 🖼️</h3>
        <p>插件作者: 从前跟你一样</p>
        <div class="st-chatu8-about-links">
            <a href="https://afdian.com/a/cqgnyy" target="_blank" class="st-chatu8-about-link support">
                <i class="fa-solid fa-heart"></i>
                <span>支持作者</span>
                <span class="st-chatu8-cute-emoji">💖</span>
            </a>
            <a href="https://gxcgf4l6b2y.feishu.cn/wiki/UXtHw83pmiHnx1k4WpwcIn79nec?from=from_copylink" target="_blank" class="st-chatu8-about-link help">
                <i class="fa-solid fa-circle-question"></i>
                <span>查看帮助</span>
                <span class="st-chatu8-cute-emoji">❓</span>
            </a>
        </div>
    </div>
    <div class="st-chatu8-settings-section">
        <h3>🌟 站点推荐</h3>
        <div class="st-chatu8-about-links" style="flex-direction: column; gap: 10px;">
            <a href="https://spell.novelai.dev/" target="_blank" class="st-chatu8-about-link" style="width: 100%; justify-content: flex-start;">
                <i class="fa-solid fa-wand-magic-sparkles" style="min-width: 20px; text-align: center;"></i>
                <div style="display: flex; flex-direction: column; align-items: flex-start; text-align: left; margin-left: 10px;">
                    <span style="font-weight: bold;">Spell</span>
                    <span style="font-size: 0.85em; opacity: 0.8; font-weight: normal;">可以解析图片的 novelai 的 tag 和 comfyui 的工作流</span>
                </div>
            </a>
            <a href="https://novelai-tag.pages.dev/" target="_blank" class="st-chatu8-about-link" style="width: 100%; justify-content: flex-start;">
                <i class="fa-solid fa-tags" style="min-width: 20px; text-align: center;"></i>
                <div style="display: flex; flex-direction: column; align-items: flex-start; text-align: left; margin-left: 10px;">
                    <span style="font-weight: bold;">NovelAI Tag</span>
                    <span style="font-size: 0.85em; opacity: 0.8; font-weight: normal;">novelai 的画师串分享站点</span>
                </div>
            </a>
        </div>
    </div>
    <div class="st-chatu8-settings-section">
        <h3>📋 更新日志</h3>
        <div class="st-chatu8-update-header">
            <button id="ch-check-update" class="st-chatu8-btn">检查更新</button>
            <span id="ch-update-status" class="st-chatu8-update-status"></span>
        </div>
        <div id="ch-update-notes" class="st-chatu8-changelog-container">
            <div class="st-chatu8-changelog-loading">正在获取更新日志...</div>
        </div>
    </div>
    ${DISCLAIMER_CONTENT}
</div>
`;
    return baseContent;
}

/**
 * 注入受保护的声明内容到About页面
 * 用于确保即使HTML被篡改，声明内容也会被恢复
 * @param {HTMLElement} container - About页面的容器元素
 */
export function injectProtectedDisclaimer(container) {
    if (!container) return;

    const aboutTab = container.querySelector('#ch-tab-about');
    if (!aboutTab) return;

    // 检查是否已存在声明内容
    const existingDisclaimer = aboutTab.querySelectorAll('.st-chatu8-disclaimer');

    // 移除可能被篡改的声明
    existingDisclaimer.forEach(el => {
        const parentSection = el.closest('.st-chatu8-settings-section');
        if (parentSection) {
            parentSection.remove();
        }
    });

    // 注入受保护的声明内容
    aboutTab.insertAdjacentHTML('beforeend', DISCLAIMER_CONTENT);
}

/**
 * 初始化About页面的保护机制
 * 使用MutationObserver监控DOM变化
 * @param {HTMLElement} container - 设置面板容器
 */
export function initAboutProtection(container) {
    if (!container) return;

    const aboutTab = container.querySelector('#st-chatu8-tab-about');
    if (!aboutTab) return;

    // 首次注入受保护内容
    injectProtectedDisclaimer(aboutTab);

    // 使用MutationObserver监控DOM变化
    const observer = new MutationObserver((mutations) => {
        let needsRestore = false;

        for (const mutation of mutations) {
            // 检查是否有节点被删除
            if (mutation.removedNodes.length > 0) {
                for (const node of mutation.removedNodes) {
                    if (node.nodeType === Node.ELEMENT_NODE) {
                        const el = /** @type {Element} */ (node);
                        if (el.classList?.contains('st-chatu8-disclaimer') ||
                            el.querySelector?.('.st-chatu8-disclaimer')) {
                            needsRestore = true;
                            break;
                        }
                    }
                }
            }

            // 检查内容是否被修改
            if (mutation.type === 'characterData') {
                const parent = mutation.target.parentElement;
                if (parent?.closest('.st-chatu8-disclaimer')) {
                    needsRestore = true;
                }
            }
        }

        if (needsRestore) {
            console.warn('[About] 检测到声明内容被修改，正在恢复...');
            injectProtectedDisclaimer(aboutTab);
        }
    });

    observer.observe(aboutTab, {
        childList: true,
        subtree: true,
        characterData: true
    });
}
