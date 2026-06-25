// @ts-nocheck
/**
 * 点击触发模块 - 模仿手势触发功能
 * 
 * 通过双击 mes_text 元素弹出操作选择对话框，
 * 触发与手势相同的功能（图片生成、角色设计）
 */
import { getContext } from "../../../../../st-context.js";
import { extension_settings } from "../../../../../extensions.js";
import { extensionName } from "../config.js";
import { handlePromptRequest } from "../promptReq.js";
import { handleCharacterDesignRequest } from "../characterGen.js";
import { handlePersonaGenFromClick } from "../settings/knowledgeBase/personaGen.js";
import { deleteImagesForElement, lockAllTagsForElement, unlockAllTagsForElement } from "../imageInserter.js";
import { debugLog, debugBranch, debugTimer, debugStartSession, debugContent, debugElement } from "../debugLogger.js";
import { setFloorTargetElement } from '../assistant/assistantFloorMessage.js';

/**
 * 收集元素的详细调试信息
 * @param {HTMLElement} element - 目标元素
 * @param {string} [label] - 标签说明
 * @returns {object} 元素详细信息对象
 */
function collectElementInfo(element, label) {
    if (!element) return { label, element: null };

    const mesParent = element.closest?.('.mes');
    const mesId = element.getAttribute?.('mesid')
        || mesParent?.getAttribute?.('mesid')
        || '(无)';
    const charName = mesParent?.getAttribute?.('ch_name')
        || mesParent?.querySelector?.('.name_text')?.textContent?.trim()
        || '(未知角色)';
    const isUser = mesParent?.getAttribute?.('is_user') === 'true'
        || mesParent?.classList?.contains?.('user_mes')
        || false;
    const rect = element.getBoundingClientRect?.() || {};
    const textContent = element.textContent || '';
    const textPreview = textContent.substring(0, 80) + (textContent.length > 80 ? '...' : '');

    return {
        label: label || '元素',
        tagName: element.tagName,
        className: element.className || '(无)',
        id: element.id || '(无)',
        mesId,
        角色名: charName,
        是否用户消息: isUser,
        是否mes_text: element.classList?.contains?.('mes_text') || false,
        在iframe中: element.ownerDocument !== document,
        尺寸: {
            width: Math.round(rect.width || 0),
            height: Math.round(rect.height || 0),
            top: Math.round(rect.top || 0),
            left: Math.round(rect.left || 0)
        },
        文本长度: textContent.length,
        文本预览: textPreview,
        子元素数量: element.children?.length || 0,
        含图片数量: element.querySelectorAll?.('img')?.length || 0,
        含st_chatu8图片: element.querySelectorAll?.('.st-chatu8-image-container, [data-st-chatu8]')?.length || 0
    };
}

/**
 * 在控制台以分组格式打印元素详细信息
 * @param {string} prefix - 日志前缀
 * @param {HTMLElement} element - 目标元素
 * @param {string} [label] - 标签说明
 * @param {object} [extra] - 额外要打印的信息
 */
function logElementDetails(prefix, element, label, extra) {
    const info = collectElementInfo(element, label);
    console.groupCollapsed(`${prefix} 📋 ${label || '元素详情'} [mesId=${info.mesId}, 角色=${info.角色名}]`);
    console.log('基础信息:', {
        tagName: info.tagName,
        className: info.className,
        id: info.id,
        mesId: info.mesId,
    });
    console.log('消息信息:', {
        角色名: info.角色名,
        是否用户消息: info.是否用户消息,
        是否mes_text: info.是否mes_text,
        在iframe中: info.在iframe中,
    });
    console.log('布局信息:', info.尺寸);
    console.log('内容信息:', {
        文本长度: info.文本长度,
        子元素数量: info.子元素数量,
        含图片数量: info.含图片数量,
        含st_chatu8图片: info.含st_chatu8图片,
        文本预览: info.文本预览,
    });
    if (extra) {
        console.log('附加信息:', extra);
    }
    console.log('DOM 元素引用:', element);
    console.groupEnd();
}

// 轮询定时器
let clickPollingTimer = null;

// 存储已绑定的元素（使用 WeakSet 避免内存泄漏）
let boundElements = new WeakSet();

// 存储当前显示的 overlay（用于关闭）
let currentOverlay = null;

// 存储当前显示的 bubble（与 overlay 分离后需单独管理）
let currentBubble = null;

/**
 * 设备检测 - 判断是否为移动设备
 */
function isMobile() {
    const touchSupported = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
    const screenSmall = window.innerWidth < 768;
    return touchSupported && screenSmall;
}

/**
 * 检测是否为 iOS 设备
 */
function isIOS() {
    return /iPad|iPhone|iPod/.test(navigator.userAgent) ||
        (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

/**
 * 获取事件坐标（相对于主页面视口）
 * @param {MouseEvent|TouchEvent} e 
 * @param {Document} doc - 事件所在的文档对象
 * @returns {{x: number, y: number}}
 */
function getEventPoint(e, doc = document) {
    let x, y;

    if (e.touches && e.touches.length > 0) {
        x = e.touches[0].clientX;
        y = e.touches[0].clientY;
    } else if (e.changedTouches && e.changedTouches.length > 0) {
        x = e.changedTouches[0].clientX;
        y = e.changedTouches[0].clientY;
    } else {
        x = e.clientX;
        y = e.clientY;
    }

    // 如果事件来自 iframe，需要将坐标转换为主页面坐标
    // doc.defaultView 是 iframe 的 window 对象
    // doc.defaultView.frameElement 是 iframe 元素本身
    if (doc.defaultView && doc.defaultView.frameElement) {
        const iframe = doc.defaultView.frameElement;
        const iframeRect = iframe.getBoundingClientRect();

        // 加上 iframe 相对于主页面视口的偏移量
        x += iframeRect.left;
        y += iframeRect.top;

        console.log('[点击触发] iframe 坐标转换:', {
            原始X: x - iframeRect.left,
            原始Y: y - iframeRect.top,
            iframe偏移: { left: iframeRect.left, top: iframeRect.top },
            转换后X: x,
            转换后Y: y
        });
    }

    return { x, y };
}

/**
 * 关闭当前显示的 action bubble
 */
function closeActionBubble() {
    if (currentOverlay) {
        currentOverlay.classList.add('closing');
        // 同时隐藏 bubble
        if (currentBubble) {
            currentBubble.style.opacity = '0';
            currentBubble.style.transform = 'scale(0.85)';
        }
        setTimeout(() => {
            if (currentOverlay && currentOverlay.parentNode) {
                currentOverlay.remove();
            }
            if (currentBubble && currentBubble.parentNode) {
                currentBubble.remove();
            }
            currentOverlay = null;
            currentBubble = null;
        }, 150);
    }
}

/**
 * 显示操作选择对话框
 * @param {{x: number, y: number}} point - 点击坐标（已预先提取，防止外部干扰）
 * @param {HTMLElement} targetElement - 触发的目标元素
 */
function showClickActionBubble(point, targetElement) {
    // 移除已存在的 bubble
    closeActionBubble();

    // 创建 overlay
    const overlay = document.createElement('div');
    overlay.className = 'st-chatu8-click-trigger-overlay';
    currentOverlay = overlay;

    // 创建 bubble
    const bubble = document.createElement('div');
    bubble.className = 'st-chatu8-click-trigger-bubble';
    currentBubble = bubble;

    // 标题
    const title = document.createElement('div');
    title.className = 'st-chatu8-click-trigger-title';
    title.textContent = '选择操作';
    bubble.appendChild(title);

    // 按钮配置
    const buttons = [
        {
            text: '图片生成',
            icon: 'fa-solid fa-image',
            description: '生成当前场景相关的图片',
            action: () => {
                console.log('[点击触发] 触发图片生成');
                handlePromptRequest(targetElement, 'gesture1');
            }
        },
        {
            text: '角色/服装设计',
            icon: 'fa-solid fa-user-pen',
            description: '生成角色或服装设计',
            action: () => {
                console.log('[点击触发] 触发角色/服装设计');
                handleCharacterDesignRequest(targetElement);
            }
        },
        {
            text: '人设生成',
            icon: 'fa-solid fa-id-card',
            description: '根据当前角色卡生成人设数据',
            action: () => {
                console.log('[点击触发] 触发人设生成');
                handlePersonaGenFromClick(targetElement);
            }
        },
        {
            text: '删除非锁定图片',
            icon: 'fa-solid fa-trash',
            description: '删除当前元素的图片',
            action: async () => {
                console.log('[点击触发] 触发删除图片');
                const result = await deleteImagesForElement(targetElement);
                if (result?.lockedCount > 0) {
                    toastr.info(`已跳过 ${result.lockedCount} 个锁定的图片`);
                }
            }
        },
        {
            text: '锁定所有Tag',
            icon: 'fa-solid fa-lock',
            description: '锁定当前元素的所有图片标签',
            action: async () => {
                console.log('[点击触发] 触发锁定所有Tag');
                const result = await lockAllTagsForElement(targetElement);
                if (result.success) {
                    toastr.success(result.message);
                } else {
                    toastr.warning(result.message);
                }
            }
        },
        {
            text: '解锁所有Tag',
            icon: 'fa-solid fa-unlock',
            description: '解锁当前元素的所有图片标签',
            action: async () => {
                console.log('[点击触发] 触发解锁所有Tag');
                const result = await unlockAllTagsForElement(targetElement);
                if (result.success) {
                    toastr.success(result.message);
                } else {
                    toastr.warning(result.message);
                }
            }
        },
        {
            text: '收集楼层信息',
            icon: 'fa-solid fa-layer-group',
            description: '收集当前酒馆楼层消息用于AI提示词',
            action: () => {
                console.log('[点击触发] 触发收集楼层信息');
                const result = setFloorTargetElement(targetElement);
                if (result.success) {
                    toastr.success(result.message + '，可在AI助手中使用 {{楼层信息}} 模板变量');
                } else if (result.isDuplicate) {
                    toastr.info(result.message);
                } else {
                    toastr.warning(result.message);
                }
            }
        },
        {
            text: '取消',
            icon: 'fa-solid fa-xmark',
            isCancel: true,
            action: () => {
                console.log('[点击触发] 用户取消');
            }
        }
    ];

    // 创建按钮
    buttons.forEach(btnInfo => {
        const button = document.createElement('button');
        button.className = 'st-chatu8-click-trigger-button';
        if (btnInfo.isCancel) {
            button.classList.add('cancel');
        }
        button.innerHTML = `<i class="${btnInfo.icon}"></i><span>${btnInfo.text}</span>`;
        button.onclick = () => {
            console.group(`[点击触发] 🎯 用户选择操作: ${btnInfo.text}`);
            debugLog('ClickTrigger.buttonClick', `用户选择操作: ${btnInfo.text}`, {
                操作: btnInfo.text,
                功能说明: btnInfo.description || '无描述'
            });
            logElementDetails('[点击触发][操作]', targetElement, `操作目标元素 (${btnInfo.text})`, {
                操作: btnInfo.text,
                功能说明: btnInfo.description || '无描述',
                是否取消: !!btnInfo.isCancel,
            });
            console.groupEnd();
            closeActionBubble();
            btnInfo.action();

            // 清除文字选中
            if (window.getSelection) {
                const selection = window.getSelection();
                if (selection.rangeCount > 0) {
                    selection.removeAllRanges();
                }
            }
        };
        bubble.appendChild(button);
    });

    // 【修复】将 bubble 放回 overlay 内部
    // Overlay 是 fixed 且铺满视口的，所以内部的 absolute 定位天然就是相对于视口的
    overlay.appendChild(bubble);
    document.body.appendChild(overlay);

    // 【修复】先设置 absolute 定位和初始位置（屏幕外），强制触发布局
    // 重置 margin 和 transform 防止外部干扰
    bubble.style.position = 'absolute';
    bubble.style.margin = '0';
    bubble.style.transform = 'none';
    bubble.style.left = '-9999px';
    bubble.style.top = '-9999px';
    bubble.style.visibility = 'hidden';

    // 【修复】使用 requestAnimationFrame 确保浏览器完成布局后再计算位置
    requestAnimationFrame(() => {
        const bubbleRect = bubble.getBoundingClientRect();

        // Overlay 铺满视口，所以可用空间就是视口大小
        const viewportWidth = window.innerWidth;
        const viewportHeight = window.innerHeight;
        const margin = 10;

        // 因为 Overlay 是 fixed 且铺满视口，bubble 是 absolute
        // 所以直接使用 Client 坐标 (相对于视口)，不需要加 scroll
        let targetX = point.x;
        let targetY = point.y;

        console.log('[点击触发] 定位信息(Overlay内部):', {
            targetX,
            targetY,
            viewportWidth,
            viewportHeight,
            bubbleWidth: bubbleRect.width,
            bubbleHeight: bubbleRect.height
        });

        // 验证坐标是否有效
        const isValidCoord = (
            Number.isFinite(targetX) && Number.isFinite(targetY) &&
            targetX >= 0 && targetX <= viewportWidth &&
            targetY >= 0 && targetY <= viewportHeight
        );

        let newLeft, newTop;

        if (isValidCoord) {
            // 默认：弹窗显示在点击位置的右下方
            newLeft = targetX + 5;
            newTop = targetY + 5;

            // 智能调整：检查是否超出视口边界

            // 1. 右侧溢出检测
            if (newLeft + bubbleRect.width > viewportWidth - margin) {
                // 尝试放在左侧
                newLeft = targetX - bubbleRect.width - 5;
            }

            // 2. 底部溢出检测
            if (newTop + bubbleRect.height > viewportHeight - margin) {
                // 尝试放在上方
                newTop = targetY - bubbleRect.height - 5;
            }

            // 3. 左侧/顶部 再次检查
            if (newLeft < margin) {
                newLeft = margin;
            }
            if (newTop < margin) {
                newTop = margin;
            }
        } else {
            // 居中显示
            console.warn('[点击触发] 坐标异常，使用居中定位', { targetX, targetY });
            newLeft = (viewportWidth - bubbleRect.width) / 2;
            newTop = (viewportHeight - bubbleRect.height) / 2;
        }

        console.log('[点击触发] 最终定位(Overlay内部):', { newLeft, newTop });

        bubble.style.left = `${newLeft}px`;
        bubble.style.top = `${newTop}px`;
        bubble.style.visibility = 'visible';
    });


    // 不再通过点击 overlay 关闭，只能通过取消按钮或 ESC 键关闭

    // ESC 键关闭
    const escHandler = (evt) => {
        if (evt.key === 'Escape') {
            closeActionBubble();
            document.removeEventListener('keydown', escHandler);
        }
    };
    document.addEventListener('keydown', escHandler);
}

/**
 * 处理双击事件
 * 
 * 功能说明：处理用户在mes_text元素上的双击事件，显示操作选择弹窗
 * 
 * @param {MouseEvent|TouchEvent} e - 原始事件对象
 * @param {HTMLElement} targetElement - 触发事件的目标元素
 * @param {{x: number, y: number}} clickPoint - 点击坐标
 */
function handleDoubleClick(e, targetElement, clickPoint) {
    // 开始新的调试会话
    debugStartSession('点击触发图片生成');

    const timer = debugTimer('ClickTrigger.handleDoubleClick', '处理双击事件 - 显示操作选择弹窗');

    debugLog('ClickTrigger.handleDoubleClick', '双击事件触发', {
        坐标: clickPoint,
        事件类型: e.type,
        功能说明: '检测双击事件，验证条件后显示操作选择弹窗'
    });

    // 记录目标元素详细信息
    debugElement('ClickTrigger.handleDoubleClick', '触发元素', targetElement);

    // 记录实际点击的元素
    debugElement('ClickTrigger.handleDoubleClick', '实际点击元素', e.target);

    // 如果弹窗已显示，忽略新的双击事件
    if (currentOverlay) {
        debugBranch('handleDoubleClick', '弹窗已存在 - 忽略事件', true, {
            条件: 'currentOverlay 是否存在',
            值: !!currentOverlay
        });
        console.log('[点击触发] 弹窗已显示，忽略双击');
        logElementDetails('[点击触发][忽略]', targetElement, '被忽略的触发元素(弹窗已存在)', { 坐标: clickPoint });
        timer.end('已忽略 - 弹窗已存在');
        return;
    }

    // 检查插件是否启用
    const clickTriggerEnabled = extension_settings[extensionName]?.clickTriggerEnabled;
    if (!clickTriggerEnabled) {
        debugBranch('handleDoubleClick', '点击触发功能未启用', true, {
            条件: 'clickTriggerEnabled',
            设置值: clickTriggerEnabled,
            插件名: extensionName
        });
        console.log('[点击触发] 功能未启用');
        logElementDetails('[点击触发][未启用]', targetElement, '被忽略的触发元素(功能未启用)', { 坐标: clickPoint });
        timer.end('已忽略 - 功能未启用');
        return;
    }
    debugBranch('handleDoubleClick', '点击触发功能已启用', true, {
        条件: 'clickTriggerEnabled',
        设置值: clickTriggerEnabled
    });

    // 排除不应触发的元素
    const excludedTags = new Set(['IMG', 'BUTTON', 'SELECT', 'INPUT', 'TEXTAREA', 'A', 'VIDEO', 'AUDIO', 'CANVAS', 'SVG']);
    const targetTagName = e.target.tagName?.toUpperCase();
    if (excludedTags.has(targetTagName)) {
        debugBranch('handleDoubleClick', `排除元素类型: ${targetTagName}`, true, {
            条件: '点击元素是否在排除列表中',
            排除列表: Array.from(excludedTags),
            实际元素: targetTagName
        });
        console.log(`[点击触发] 点击的是 ${targetTagName} 元素，忽略`);
        logElementDetails('[点击触发][排除]', e.target, `被排除的点击元素 (${targetTagName})`, { 坐标: clickPoint });
        logElementDetails('[点击触发][排除]', targetElement, '原始目标元素 (mes_text)');
        timer.end(`已忽略 - 排除的元素类型: ${targetTagName}`);
        return;
    }

    // 记录目标元素的文本内容预览
    const elementText = targetElement?.textContent || '';
    debugContent('ClickTrigger.handleDoubleClick', '元素文本预览', elementText, 150);

    debugLog('ClickTrigger.handleDoubleClick', '条件验证通过，显示操作弹窗');
    console.group('[点击触发] ✅ 双击触发成功');
    console.log('坐标:', clickPoint, '| 事件类型:', e.type);
    logElementDetails('[点击触发]', targetElement, '将展示弹窗的目标元素');
    const stContext = getContext();
    console.log('[点击触发] SillyTavern 上下文:', {
        chatLength: stContext?.chat?.length,
        characterName: stContext?.name2,
        userName: stContext?.name1,
        chatId: stContext?.chatId,
    });
    console.groupEnd();
    showClickActionBubble(clickPoint, targetElement);
    timer.end('弹窗已显示');
}

/**
 * 绑定双击事件到元素
 * @param {HTMLElement} element 
 * @param {Document} doc 
 */
function bindClickTrigger(element, doc = document) {
    if (boundElements.has(element)) return;
    boundElements.add(element);

    // 动态查找 mes_text 元素（模仿 Drawing.js 的逻辑）
    function findTargetElement(e) {
        // 先尝试从 e.target 查找 mes_text
        let targetEl = e.target.closest('.mes_text');

        // 如果在 iframe 中且没有找到 mes_text，查找最近的 div
        if (!targetEl && doc.defaultView?.frameElement) {
            let currentEl = e.target;
            if (currentEl.tagName !== 'DIV') {
                currentEl = currentEl.closest('div');
            }
            if (currentEl) {
                targetEl = currentEl;
            }
        }

        // 兜底：使用绑定的元素
        return targetEl || element;
    }

    // 桌面端：原生 dblclick，使用捕获模式确保能捕获到事件
    element.addEventListener('dblclick', (e) => {
        // 移动端使用触摸三连击，忽略 dblclick 事件
        if (isMobile() || isIOS()) {
            console.log('[点击触发] 移动端忽略 dblclick，使用触摸三连击');
            return;
        }
        // 立即提取坐标，防止事件对象被外部修改
        // 传入 doc 参数以便正确转换 iframe 内的坐标
        const clickPoint = getEventPoint(e, doc);
        const targetEl = findTargetElement(e);

        // 详细打印触发元素信息
        console.group('[点击触发] 🖱️ 桌面端双击事件');
        console.log('事件类型:', e.type, '| 坐标:', clickPoint);
        logElementDetails('[点击触发]', targetEl, '目标元素 (mes_text)', {
            绑定元素tagName: element.tagName,
            绑定元素className: element.className,
        });
        logElementDetails('[点击触发]', e.target, '实际点击元素 (e.target)');
        const context = getContext();
        console.log('[点击触发] SillyTavern Context:', {
            chatLength: context?.chat?.length,
            characterName: context?.name2,
            userName: context?.name1,
            chatId: context?.chatId,
        });
        console.groupEnd();

        handleDoubleClick(e, targetEl, clickPoint);
    }, true);  // capture: true

    // 移动端：触摸三连击检测（避免误触）
    let lastTapTime = 0;
    let lastTapPoint = { x: 0, y: 0 };
    let tapCount = 0;  // 连续点击计数
    let touchStartPoint = { x: 0, y: 0 };  // 记录触摸起始位置，用于检测滑动
    // 连击时间阈值：iOS 需要更长的间隔时间（iOS Safari 有 300ms 延迟）
    const tapThreshold = isIOS() ? 400 : 350;
    const tapDistance = 30;   // 连续触摸的最大距离阈值（像素）
    const swipeThreshold = 15;  // 滑动检测阈值：手指移动超过此距离视为滑动

    // 排除的元素列表 - 这些元素有自己的触摸事件处理逻辑
    const excludedTags = new Set(['IMG', 'BUTTON', 'SELECT', 'INPUT', 'TEXTAREA', 'A', 'VIDEO', 'AUDIO', 'CANVAS', 'SVG']);

    // 记录触摸起始位置
    element.addEventListener('touchstart', (e) => {
        if (e.touches.length === 1) {
            touchStartPoint = {
                x: e.touches[0].clientX,
                y: e.touches[0].clientY
            };
        }
    }, { capture: true, passive: true });

    element.addEventListener('touchend', (e) => {
        // 只响应单指触摸
        if (e.changedTouches.length !== 1) {
            return;
        }

        // 立即检查：如果是排除的元素，完全不处理，让元素自身的事件处理器工作
        // 这确保图片的长按和双击功能不受干扰
        if (excludedTags.has(e.target.tagName?.toUpperCase())) {
            console.log(`[点击触发] 触摸的是 ${e.target.tagName?.toUpperCase()} 元素，跳过 ClickTrigger 处理`);
            return;
        }

        // 检测是否为滑动：计算从 touchstart 到 touchend 的移动距离
        const endX = e.changedTouches[0].clientX;
        const endY = e.changedTouches[0].clientY;
        const swipeDistance = Math.sqrt(
            Math.pow(endX - touchStartPoint.x, 2) +
            Math.pow(endY - touchStartPoint.y, 2)
        );

        if (swipeDistance > swipeThreshold) {
            // 是滑动，重置连击计数并忽略
            console.log(`[点击触发] 检测到滑动 (距离: ${swipeDistance.toFixed(1)}px)，忽略`);
            tapCount = 0;
            lastTapTime = 0;
            return;
        }

        const currentTime = Date.now();
        // 传入 doc 参数以便正确转换 iframe 内的坐标
        const currentPoint = getEventPoint(e, doc);
        const timeSinceLastTap = currentTime - lastTapTime;

        // 计算两次触摸的距离
        const distance = Math.sqrt(
            Math.pow(currentPoint.x - lastTapPoint.x, 2) +
            Math.pow(currentPoint.y - lastTapPoint.y, 2)
        );

        // 检查是否在有效的连击范围内（时间和距离）
        if (timeSinceLastTap < tapThreshold && timeSinceLastTap > 0 && distance < tapDistance) {
            tapCount++;
            console.log(`[点击触发] 移动端连击计数: ${tapCount}`);

            // 达到三连击时触发
            if (tapCount >= 3) {
                // 阻止浏览器默认行为
                e.preventDefault();

                // 使用当前触摸点作为弹窗位置
                const targetEl = findTargetElement(e);

                // 详细打印触发元素信息
                console.group('[点击触发] 📱 移动端三连击事件');
                console.log('事件类型:', e.type, '| 坐标:', currentPoint);
                logElementDetails('[点击触发]', targetEl, '目标元素 (mes_text)');
                logElementDetails('[点击触发]', e.target, '实际触摸元素 (e.target)');
                console.groupEnd();

                handleDoubleClick(e, targetEl, currentPoint);

                // 重置计数
                tapCount = 0;
                lastTapTime = 0;
                lastTapPoint = { x: 0, y: 0 };
            } else {
                // 更新最后点击时间和位置
                lastTapTime = currentTime;
                lastTapPoint = currentPoint;
            }
        } else {
            // 超时或距离过远，重置为第一次点击
            tapCount = 1;
            lastTapTime = currentTime;
            lastTapPoint = currentPoint;
        }
    }, { capture: true, passive: false });  // passive: false 允许调用 preventDefault

    console.log('[点击触发] ✓ 已绑定:', element.className || element.tagName);
}

/**
 * 扫描并绑定 mes_text 元素
 */
function scanClickTriggerElements() {
    const mesTextElements = document.getElementsByClassName('mes_text');
    let count = 0;
    let alreadyBound = 0;

    for (const element of mesTextElements) {
        if (!boundElements.has(element)) {
            bindClickTrigger(element, document);
            count++;
        } else {
            alreadyBound++;
        }
    }

    //console.log(`[点击触发] 扫描: 总共${mesTextElements.length}个mes_text, 新绑定${count}个, 已绑定${alreadyBound}个`);

    // 扫描 iframe
    const iframes = document.querySelectorAll('iframe');
    iframes.forEach(iframe => {
        try {
            const iframeDoc = iframe.contentDocument;
            if (!iframeDoc || !iframeDoc.body) return;

            if (!boundElements.has(iframeDoc.body)) {
                bindClickTrigger(iframeDoc.body, iframeDoc);
                count++;
            }

            const iframeMesTexts = iframeDoc.getElementsByClassName('mes_text');
            for (const element of iframeMesTexts) {
                if (!boundElements.has(element)) {
                    bindClickTrigger(element, iframeDoc);
                    count++;
                }
            }
        } catch (e) {
            // 跨域忽略
        }
    });

    if (count > 0) {
        // console.log(`[点击触发] 本次扫描绑定了 ${count} 个元素`);
    }
}

/**
 * 初始化点击触发监控
 */
function initClickTriggerMonitor() {
    console.log('[点击触发] ====== 初始化点击触发监控 ======');

    if (clickPollingTimer) {
        console.log('[点击触发] 已在运行');
        return;
    }

    // 先设置轮询定时器，确保一定会被设置
    clickPollingTimer = setInterval(() => {
        try {
            scanClickTriggerElements();
        } catch (e) {
            console.error('[点击触发] 扫描出错:', e);
        }
    }, 3000);

    // 然后立即执行一次扫描
    try {
        scanClickTriggerElements();
    } catch (e) {
        console.error('[点击触发] 初始扫描出错:', e);
    }

    console.log('[点击触发] ✓ 已启动');
}

/**
 * 停止点击触发监控
 */
function stopClickTriggerMonitor() {
    console.log('[点击触发] ====== 停止监控 ======');

    if (clickPollingTimer) {
        clearInterval(clickPollingTimer);
        clickPollingTimer = null;
    }

    // 重新创建 WeakSet，清除所有绑定记录，以便下次可以重新绑定
    boundElements = new WeakSet();

    // 关闭当前 bubble
    closeActionBubble();

    console.log('[点击触发] ✓ 已停止');
}

/**
 * 自动启动监控
 */
function startClickTriggerMonitor() {
    // 延迟启动，等待 SillyTavern 完全加载
    const startWithDelay = () => {
        setTimeout(() => {
            console.log('[点击触发] 延迟启动...');
            initClickTriggerMonitor();
        }, 3000);  // 延迟3秒等待页面稳定
    };

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', startWithDelay);
    } else {
        startWithDelay();
    }
}

// 模块加载时自动启动
startClickTriggerMonitor();

export { initClickTriggerMonitor, stopClickTriggerMonitor, scanClickTriggerElements };
