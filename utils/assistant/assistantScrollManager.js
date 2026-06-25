/**
 * assistantScrollManager.js
 * 
 * 聊天记录滚动管理器：
 * - 分页渲染消息（默认显示最后 100 条）
 * - 向上滚动自动加载更多历史消息
 * - "回到底部"浮动按钮
 * - 未读消息徽章
 */

import { dom, activeChat } from './assistantContext.js';
import { getChatImagesBatch } from '../configDatabase.js';

// ═══════════════════════════════════════════════════════════
//  状态管理
// ═══════════════════════════════════════════════════════════

/**
 * 滚动状态管理对象
 */
const scrollState = {
    totalMessages: 0,        // 总消息数
    renderedStart: 0,        // 已渲染的起始索引
    renderedEnd: 0,          // 已渲染的结束索引
    pageSize: 100,           // 每页消息数
    isLoading: false,        // 是否正在加载
    hasMore: true,           // 是否还有更多消息
    scrollLocked: false,     // 滚动位置锁定（加载时使用）
    unreadCount: 0           // 未读消息数（用户不在底部时）
};

/**
 * 编辑消息后外科手术式更新滚动状态
 * @param {number} newTotal - 编辑后的消息总数
 */
export function updateScrollStateAfterEdit(newTotal) {
    scrollState.totalMessages = newTotal;
    if (scrollState.renderedEnd > newTotal) {
        scrollState.renderedEnd = newTotal;
    }
    if (scrollState.renderedStart >= newTotal) {
        scrollState.renderedStart = Math.max(0, newTotal - scrollState.pageSize);
    }
    scrollState.hasMore = scrollState.renderedStart > 0;
}

/**
 * 重置滚动状态
 */
export function resetScrollState() {
    scrollState.totalMessages = 0;
    scrollState.renderedStart = 0;
    scrollState.renderedEnd = 0;
    scrollState.isLoading = false;
    scrollState.hasMore = true;
    scrollState.scrollLocked = false;
    scrollState.unreadCount = 0;
}

// ═══════════════════════════════════════════════════════════
//  消息渲染辅助函数
// ═══════════════════════════════════════════════════════════

/**
 * 创建单条消息元素（不添加到 DOM）
 * @param {Object} msg - 消息对象
 * @param {number} absoluteIndex - 消息在完整数组中的索引
 * @param {Function} appendMessage - 消息渲染函数
 * @param {Object} imageCache - 图片缓存对象
 * @returns {Promise<jQuery>} 消息元素
 */
async function createMessageElement(msg, absoluteIndex, appendMessage, imageCache = {}) {
    if (!msg || typeof msg !== 'object') {
        return null;
    }

    let content = '';
    let images = null;

    // 处理消息内容和图片
    if (Array.isArray(msg.imageRefs) && msg.imageRefs.length > 0) {
        // V2 格式：content 是纯文本，图片通过 imageRefs 引用
        content = msg.content || '';
        images = msg.imageRefs
            .filter(refId => imageCache[refId])
            .map(refId => ({
                data: imageCache[refId],
                name: '图片'
            }));
        if (images.length === 0) images = null;
    } else if (Array.isArray(msg.content)) {
        // V1 兼容：多模态格式（content 是数组）
        const textPart = msg.content.find(c => c.type === 'text');
        content = textPart?.text || '';

        const imageParts = msg.content.filter(c => c.type === 'image_url');
        if (imageParts.length > 0) {
            images = imageParts.map(img => ({
                data: img.image_url?.url || img.image_url,
                name: '生成的图片'
            }));
        }
    } else {
        // 纯文本格式
        content = msg.content || '';
        images = msg.images || null;
    }

    // 临时容器用于创建消息元素
    const $tempContainer = $('<div>');
    const originalChatBody = dom.chatBody;

    // 临时替换 dom.chatBody 以捕获 appendMessage 创建的元素
    dom.chatBody = $tempContainer;

    try {
        await appendMessage(msg.role, content, images, absoluteIndex, true, {});
        const $msgElement = $tempContainer.children().first();
        return $msgElement;
    } finally {
        // 恢复原始 dom.chatBody
        dom.chatBody = originalChatBody;
    }
}

// ═══════════════════════════════════════════════════════════
//  分页渲染核心函数
// ═══════════════════════════════════════════════════════════

/**
 * 分页渲染消息列表
 * @param {Array} messages - 完整的消息数组
 * @param {Function} appendMessage - 消息渲染函数
 * @param {boolean} scrollToEnd - 是否滚动到底部
 */
export async function renderMessagesWithPagination(messages, appendMessage, scrollToEnd = true) {
    const validMessages = Array.isArray(messages)
        ? messages.filter(msg => msg && typeof msg === 'object')
        : [];

    console.log('[ScrollManager] 开始分页渲染，总消息数:', validMessages.length);

    resetScrollState();
    scrollState.totalMessages = validMessages.length;

    if (validMessages.length === 0) {
        return;
    }

    // 批量收集所有需要的 imageRefs
    const allImageRefs = [];
    validMessages.forEach(msg => {
        if (Array.isArray(msg.imageRefs)) {
            allImageRefs.push(...msg.imageRefs);
        }
    });

    let imageCache = {};
    if (allImageRefs.length > 0) {
        try {
            imageCache = await getChatImagesBatch(allImageRefs);
            console.log('[ScrollManager] 批量加载图片完成，共', Object.keys(imageCache).length, '张');
        } catch (err) {
            console.error('[ScrollManager] 批量加载图片失败:', err);
        }
    }

    if (validMessages.length <= scrollState.pageSize) {
        // 消息数量少，直接全部渲染
        console.log('[ScrollManager] 消息数 <= pageSize，全部渲染');
        scrollState.renderedStart = 0;
        scrollState.renderedEnd = validMessages.length;
        scrollState.hasMore = false;

        for (const [index, msg] of validMessages.entries()) {
            let content = '';
            let images = null;

            if (Array.isArray(msg.imageRefs) && msg.imageRefs.length > 0) {
                content = msg.content || '';
                images = msg.imageRefs
                    .filter(refId => imageCache[refId])
                    .map(refId => ({
                        data: imageCache[refId],
                        name: '图片'
                    }));
                if (images.length === 0) images = null;
            } else if (Array.isArray(msg.content)) {
                const textPart = msg.content.find(c => c.type === 'text');
                content = textPart?.text || '';

                const imageParts = msg.content.filter(c => c.type === 'image_url');
                if (imageParts.length > 0) {
                    images = imageParts.map(img => ({
                        data: img.image_url?.url || img.image_url,
                        name: '生成的图片'
                    }));
                }
            } else {
                content = msg.content || '';
                images = msg.images || null;
            }

            await appendMessage(msg.role, content, images, index, true, {});
        }
    } else {
        // 只渲染最后 pageSize 条消息
        console.log('[ScrollManager] 消息数 > pageSize，渲染最后', scrollState.pageSize, '条');
        scrollState.renderedStart = validMessages.length - scrollState.pageSize;
        scrollState.renderedEnd = validMessages.length;
        scrollState.hasMore = scrollState.renderedStart > 0;

        // 添加"加载更多"提示
        if (scrollState.hasMore) {
            prependLoadMoreIndicator();
        }

        const visibleMessages = validMessages.slice(scrollState.renderedStart, scrollState.renderedEnd);
        for (const [relativeIndex, msg] of visibleMessages.entries()) {
            const absoluteIndex = scrollState.renderedStart + relativeIndex;
            let content = '';
            let images = null;

            if (Array.isArray(msg.imageRefs) && msg.imageRefs.length > 0) {
                content = msg.content || '';
                images = msg.imageRefs
                    .filter(refId => imageCache[refId])
                    .map(refId => ({
                        data: imageCache[refId],
                        name: '图片'
                    }));
                if (images.length === 0) images = null;
            } else if (Array.isArray(msg.content)) {
                const textPart = msg.content.find(c => c.type === 'text');
                content = textPart?.text || '';

                const imageParts = msg.content.filter(c => c.type === 'image_url');
                if (imageParts.length > 0) {
                    images = imageParts.map(img => ({
                        data: img.image_url?.url || img.image_url,
                        name: '生成的图片'
                    }));
                }
            } else {
                content = msg.content || '';
                images = msg.images || null;
            }

            await appendMessage(msg.role, content, images, absoluteIndex, true, {});
        }
    }

    if (scrollToEnd) {
        // 使用 requestAnimationFrame 确保 DOM 更新后再滚动
        requestAnimationFrame(() => {
            dom.chatBody.scrollTop(dom.chatBody[0].scrollHeight);
            console.log('[ScrollManager] 滚动到底部完成');
        });
    }

    console.log('[ScrollManager] 分页渲染完成，已渲染:', scrollState.renderedStart, '-', scrollState.renderedEnd);
}

/**
 * 加载更多历史消息
 * @param {Array} messages - 完整的消息数组
 * @param {Function} appendMessage - 消息渲染函数
 */
export async function loadMoreMessages(messages, appendMessage) {
    if (scrollState.isLoading || !scrollState.hasMore) {
        return;
    }

    const validMessages = Array.isArray(messages)
        ? messages.filter(msg => msg && typeof msg === 'object')
        : [];

    console.log('[ScrollManager] 开始加载更多消息...');
    scrollState.isLoading = true;
    updateLoadMoreIndicator('正在加载...');

    // 保存当前滚动位置
    const oldScrollHeight = dom.chatBody[0].scrollHeight;
    const oldScrollTop = dom.chatBody[0].scrollTop;

    // 计算要加载的消息范围
    const newStart = Math.max(0, scrollState.renderedStart - scrollState.pageSize);
    const loadCount = scrollState.renderedStart - newStart;

    if (loadCount === 0) {
        scrollState.hasMore = false;
        updateLoadMoreIndicator('已到达顶部');
        scrollState.isLoading = false;
        console.log('[ScrollManager] 已到达顶部，无更多消息');
        return;
    }

    console.log('[ScrollManager] 加载消息范围:', newStart, '-', scrollState.renderedStart);

    // 批量收集新消息的 imageRefs
    const newMessages = validMessages.slice(newStart, scrollState.renderedStart);
    const imageRefs = [];
    newMessages.forEach(msg => {
        if (Array.isArray(msg.imageRefs)) {
            imageRefs.push(...msg.imageRefs);
        }
    });

    let imageCache = {};
    if (imageRefs.length > 0) {
        try {
            imageCache = await getChatImagesBatch(imageRefs);
        } catch (err) {
            console.error('[ScrollManager] 加载图片失败:', err);
        }
    }

    // 渲染新消息（插入到顶部，在加载提示之后）
    const $loadMoreIndicator = dom.chatBody.find('.st-chatu8-ai-load-more-indicator');

    // 收集所有新消息元素（保持顺序）
    const $newElements = [];

    for (const [relativeIndex, msg] of newMessages.entries()) {
        const absoluteIndex = newStart + relativeIndex;
        let content = '';
        let images = null;

        if (Array.isArray(msg.imageRefs) && msg.imageRefs.length > 0) {
            content = msg.content || '';
            images = msg.imageRefs
                .filter(refId => imageCache[refId])
                .map(refId => ({
                    data: imageCache[refId],
                    name: '图片'
                }));
            if (images.length === 0) images = null;
        } else if (Array.isArray(msg.content)) {
            const textPart = msg.content.find(c => c.type === 'text');
            content = textPart?.text || '';
            const imageParts = msg.content.filter(c => c.type === 'image_url');
            if (imageParts.length > 0) {
                images = imageParts.map(img => ({
                    data: img.image_url?.url || img.image_url,
                    name: '生成的图片'
                }));
            }
        } else {
            content = msg.content || '';
            images = msg.images || null;
        }

        // 创建临时容器
        const $tempContainer = $('<div>');
        const originalChatBody = dom.chatBody;
        dom.chatBody = $tempContainer;

        try {
            await appendMessage(msg.role, content, images, absoluteIndex, true, {});
            const $msgElement = $tempContainer.children().first();
            $newElements.push($msgElement);
        } finally {
            dom.chatBody = originalChatBody;
        }
    }

    // 一次性按顺序插入所有新消息
    if ($loadMoreIndicator.length) {
        $loadMoreIndicator.after($newElements);
    } else {
        dom.chatBody.prepend($newElements);
    }

    // 更新状态
    scrollState.renderedStart = newStart;
    scrollState.hasMore = newStart > 0;

    // 恢复滚动位置（保持用户视角不变）
    requestAnimationFrame(() => {
        const newScrollHeight = dom.chatBody[0].scrollHeight;
        const scrollDiff = newScrollHeight - oldScrollHeight;
        dom.chatBody[0].scrollTop = oldScrollTop + scrollDiff;
        console.log('[ScrollManager] 滚动位置已恢复，偏移:', scrollDiff);
    });

    // 更新提示
    if (!scrollState.hasMore) {
        updateLoadMoreIndicator('已到达顶部');
    } else {
        updateLoadMoreIndicator('向上滚动加载更多历史消息...');
    }

    scrollState.isLoading = false;
    console.log('[ScrollManager] 加载完成，当前已渲染:', scrollState.renderedStart, '-', scrollState.renderedEnd);
}

// ═══════════════════════════════════════════════════════════
//  滚动控制函数
// ═══════════════════════════════════════════════════════════

/**
 * 平滑滚动到底部
 * @param {boolean} smooth - 是否使用平滑滚动
 */
export function scrollToBottom(smooth = true) {
    if (!dom.chatBody || !dom.chatBody[0]) return;

    if (smooth) {
        dom.chatBody.animate({
            scrollTop: dom.chatBody[0].scrollHeight
        }, 300);
    } else {
        dom.chatBody.scrollTop(dom.chatBody[0].scrollHeight);
    }

    // 清除未读计数
    scrollState.unreadCount = 0;
    updateUnreadBadge(0);
}

/**
 * 检查是否在底部附近
 * @param {number} threshold - 阈值（像素）
 * @returns {boolean}
 */
export function isNearBottom(threshold = 100) {
    if (!dom.chatBody || !dom.chatBody[0]) return true;

    const scrollTop = dom.chatBody[0].scrollTop;
    const scrollHeight = dom.chatBody[0].scrollHeight;
    const clientHeight = dom.chatBody[0].clientHeight;

    return (scrollHeight - scrollTop - clientHeight) < threshold;
}

// ═══════════════════════════════════════════════════════════
//  "加载更多"提示
// ═══════════════════════════════════════════════════════════

/**
 * 在聊天区域顶部添加"加载更多"提示
 */
function prependLoadMoreIndicator() {
    // 避免重复添加
    if (dom.chatBody.find('.st-chatu8-ai-load-more-indicator').length > 0) {
        return;
    }

    const $indicator = $(`
        <div class="st-chatu8-ai-load-more-indicator">
            <i class="fa-solid fa-arrow-up"></i>
            <span>向上滚动加载更多历史消息...</span>
        </div>
    `);
    dom.chatBody.prepend($indicator);
}

/**
 * 更新"加载更多"提示文本
 * @param {string} text - 提示文本
 */
function updateLoadMoreIndicator(text) {
    const $indicator = dom.chatBody.find('.st-chatu8-ai-load-more-indicator span');
    if ($indicator.length) {
        $indicator.text(text);
    }
}

// ═══════════════════════════════════════════════════════════
//  "回到底部"按钮
// ═══════════════════════════════════════════════════════════

/**
 * 初始化"回到底部"按钮
 */
export function initScrollToBottomButton() {
    // 避免重复初始化
    if ($('#st-chatu8-ai-scroll-to-bottom').length > 0) {
        return;
    }

    const $button = $(`
        <button id="st-chatu8-ai-scroll-to-bottom" class="st-chatu8-ai-scroll-to-bottom" style="display: none;">
            <i class="fa-solid fa-arrow-down"></i>
            <span class="unread-badge" style="display: none;">0</span>
        </button>
    `);

    dom.dialog.append($button);

    $button.on('click', function () {
        scrollToBottom(true);
    });

    console.log('[ScrollManager] "回到底部"按钮已初始化');
}

/**
 * 更新"回到底部"按钮的显示状态
 * @param {number} distanceFromBottom - 距离底部的距离（px）
 */
export function updateScrollToBottomButton(distanceFromBottom) {
    const $button = $('#st-chatu8-ai-scroll-to-bottom');
    if (!$button.length) return;

    // 计算大约相当于多少条消息的高度
    // 假设每条消息平均高度约 80px
    const avgMessageHeight = 80;
    const messagesFromBottom = Math.floor(distanceFromBottom / avgMessageHeight);

    if (messagesFromBottom > 6) {
        $button.fadeIn(200);
    } else {
        $button.fadeOut(200);
    }
}

/**
 * 更新未读消息徽章
 * @param {number} count - 未读消息数
 */
export function updateUnreadBadge(count) {
    const $badge = $('#st-chatu8-ai-scroll-to-bottom .unread-badge');
    if (!$badge.length) return;

    if (count > 0) {
        $badge.text(count).show();
    } else {
        $badge.hide();
    }
}

/**
 * 增加未读消息计数
 */
export function incrementUnreadCount() {
    if (!isNearBottom()) {
        scrollState.unreadCount++;
        updateUnreadBadge(scrollState.unreadCount);
    }
}

// ═══════════════════════════════════════════════════════════
//  滚动事件监听
// ═══════════════════════════════════════════════════════════

/**
 * 初始化滚动事件监听
 * @param {Function} appendMessage - 消息渲染函数
 */
export function initScrollListener(appendMessage) {
    if (!dom.chatBody) {
        console.warn('[ScrollManager] dom.chatBody 不存在，无法初始化滚动监听');
        return;
    }

    let scrollTimeout;

    // 移除旧的监听器（如果存在）
    dom.chatBody.off('scroll.scrollManager');

    dom.chatBody.on('scroll.scrollManager', function () {
        clearTimeout(scrollTimeout);
        scrollTimeout = setTimeout(() => {
            if (!activeChat || !activeChat.messages) return;

            const scrollTop = dom.chatBody[0].scrollTop;
            const scrollHeight = dom.chatBody[0].scrollHeight;
            const clientHeight = dom.chatBody[0].clientHeight;

            // 检查是否需要加载更多
            if (scrollTop < 200 && scrollState.hasMore && !scrollState.isLoading) {
                loadMoreMessages(activeChat.messages, appendMessage);
            }

            // 检查是否需要显示/隐藏"回到底部"按钮
            const distanceFromBottom = scrollHeight - scrollTop - clientHeight;
            updateScrollToBottomButton(distanceFromBottom);
        }, 100);
    });

    console.log('[ScrollManager] 滚动监听器已初始化');
}

/**
 * 清理滚动监听器
 */
export function cleanupScrollListener() {
    if (dom.chatBody) {
        dom.chatBody.off('scroll.scrollManager');
    }
}
