// @ts-nocheck
import { extension_settings } from "../../../../../extensions.js";
import { saveSettingsDebounced } from "../../../../../../script.js";
import { getLog, clearLog, clearAllLogs, exportLogsWithHistory, initializeLogPersistence } from '../utils.js';
import { stylishConfirm } from '../ui_common.js';
import { initTaskManager, updateTaskManagerView } from './taskManager.js';
import {
    isDebugEnabled,
    toggleDebug,
    getDebugLogCount,
    clearDebugLog,
    exportDebugLog
} from '../debugLogger.js';
import {
    getAllErrors,
    getErrorStats,
    clearErrors,
    exportErrors
} from '../errorCollector.js';
import {
    getImageGenStats,
    resetImageGenStats
} from '../imageGenStats.js';

// --- Log Management ---
function updateLogView() {
    const logTextarea = document.getElementById('ch-log-textarea');
    if (logTextarea) {
        let displayLog = getLog();
        const MAX_LOG_LENGTH = 100000;
        const TRIM_TARGET_LENGTH = 80000;
        if (displayLog.length > MAX_LOG_LENGTH) {
            let trimmedVal = displayLog.substring(displayLog.length - TRIM_TARGET_LENGTH);
            const newlineIdx = trimmedVal.indexOf('\n');
            if (newlineIdx !== -1) trimmedVal = trimmedVal.substring(newlineIdx + 1);
            logTextarea.value = "（前面的日志已折叠，请导出查看完整日志）\n" + trimmedVal;
        } else {
            logTextarea.value = displayLog;
        }
        // Scroll to top to show the latest logs first
        logTextarea.scrollTop = 0;
    }
    // 同时更新任务管理器
    updateTaskManagerView();
    // 更新调试状态
    updateDebugStatus();
}

async function handleExportLog() {
    const logContent = await exportLogsWithHistory();
    if (!logContent || logContent.trim() === '') {
        alert("日志为空。");
        return;
    }
    const blob = new Blob([logContent], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `st-chatu8-log-${new Date().toISOString().slice(0, 19).replace(/:/g, '-')}.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

function handleClearLog() {
    stylishConfirm("确定要清空所有日志吗？此操作将彻底删除所有历史日志，不可撤销。").then(confirmed => {
        if (confirmed) {
            clearAllLogs();
            saveSettingsDebounced();
            updateLogView();
            toastr.success("日志已全部清空。");
        }
    });
}

// --- Image Gen Stats ---

const BACKEND_LABELS = {
    sd: { name: 'SD WebUI', icon: '🖼️', color: '#42A5F5' },
    comfyui: { name: 'ComfyUI', icon: '🔧', color: '#AB47BC' },
    banana: { name: 'Banana / Grok', icon: '🍌', color: '#FFA726' },
    novelai: { name: 'NovelAI', icon: '✨', color: '#66BB6A' }
};

let _currentPeriod = 'day';

/**
 * 计算 ISO 周 key，如 "2025-W15"
 */
function getISOWeekKey(date) {
    const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
    const day = d.getUTCDay() || 7;
    d.setUTCDate(d.getUTCDate() + 4 - day);
    const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
    const weekNo = Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
    return `${d.getUTCFullYear()}-W${String(weekNo).padStart(2, '0')}`;
}

/**
 * 按周期聚合每日数据
 * 返回 [{ label, bucketKey, data: { backend: count } }]
 */
function aggregateBuckets(stats, period) {
    const daily = stats.daily || {};

    if (period === 'day') {
        const result = [];
        for (let i = 29; i >= 0; i--) {
            const d = new Date();
            d.setDate(d.getDate() - i);
            const key = d.toISOString().slice(0, 10);
            result.push({ label: `${d.getMonth() + 1}/${d.getDate()}`, bucketKey: key, data: { ...(daily[key] || {}) } });
        }
        return result;
    }

    if (period === 'week') {
        const weekMap = new Map();
        for (let i = 83; i >= 0; i--) {
            const d = new Date();
            d.setDate(d.getDate() - i);
            const dayKey = d.toISOString().slice(0, 10);
            const wk = getISOWeekKey(d);
            if (!weekMap.has(wk)) {
                const mon = new Date(d);
                mon.setDate(d.getDate() - ((d.getDay() || 7) - 1));
                weekMap.set(wk, { label: `${mon.getMonth() + 1}/${mon.getDate()}`, bucketKey: wk, data: {} });
            }
            for (const [b, c] of Object.entries(daily[dayKey] || {})) {
                const e = weekMap.get(wk);
                e.data[b] = (e.data[b] || 0) + c;
            }
        }
        return [...weekMap.values()].slice(-12);
    }

    if (period === 'month') {
        const monthMap = new Map();
        const now = new Date();
        for (let i = 23; i >= 0; i--) {
            const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
            const key = d.toISOString().slice(0, 7);
            monthMap.set(key, { label: `${d.getMonth() + 1}月`, bucketKey: key, data: {} });
        }
        for (const [dayKey, dayData] of Object.entries(daily)) {
            const mk = dayKey.slice(0, 7);
            if (!monthMap.has(mk)) continue;
            const e = monthMap.get(mk);
            for (const [b, c] of Object.entries(dayData)) e.data[b] = (e.data[b] || 0) + c;
        }
        return [...monthMap.values()];
    }

    if (period === 'year') {
        const yearMap = new Map();
        for (const [dayKey, dayData] of Object.entries(daily)) {
            const yr = dayKey.slice(0, 4);
            if (!yearMap.has(yr)) yearMap.set(yr, { label: `${yr}年`, bucketKey: yr, data: {} });
            const e = yearMap.get(yr);
            for (const [b, c] of Object.entries(dayData)) e.data[b] = (e.data[b] || 0) + c;
        }
        return [...yearMap.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([, v]) => v);
    }

    return [];
}

/**
 * 渲染汇总卡片
 */
function renderSummary(stats) {
    const el = document.getElementById('ch-gen-summary');
    if (!el) return;
    const totalGen = stats.total.success + stats.total.fail;
    if (totalGen === 0) {
        el.innerHTML = '<span style="opacity:0.5;">暂无生图记录，开始你的创作之旅吧！</span>';
        return;
    }
    const successRate = ((stats.total.success / totalGen) * 100).toFixed(1);
    const rateColor = Number(successRate) >= 90 ? '#4CAF50' : Number(successRate) >= 70 ? '#FFA726' : '#f44336';
    const items = [
        { val: stats.total.success, unit: '张', label: '累计生成', color: '#4CAF50' },
        { val: `${successRate}%`, label: '成功率', color: rateColor },
    ];
    if (stats.firstGenTime) {
        const days = Math.max(1, Math.ceil((Date.now() - stats.firstGenTime) / 864e5));
        items.push({ val: days, unit: '天', label: '创作天数', color: '#64B5F6' });
        items.push({ val: (stats.total.success / days).toFixed(1), label: '日均张数', color: '#FFB74D' });
    }
    if (stats.total.fail > 0) {
        items.push({ val: stats.total.fail, label: '失败次数', color: '#ef5350' });
    }
    let html = '<div style="display:flex; gap:12px; flex-wrap:wrap; padding:8px 12px; background:rgba(255,255,255,0.05); border-radius:6px;">';
    for (const item of items) {
        html += `<div style="text-align:center; min-width:48px;">`;
        html += `<div style="font-size:18px; font-weight:bold; color:${item.color};">${item.val}`;
        if (item.unit) html += `<span style="font-size:11px; margin-left:1px;">${item.unit}</span>`;
        html += `</div><div style="font-size:10px; opacity:0.55; margin-top:1px;">${item.label}</div></div>`;
    }
    html += '</div>';
    el.innerHTML = html;
}

/**
 * 渲染图例
 */
function renderLegend() {
    const el = document.getElementById('ch-gen-legend');
    if (!el) return;
    let html = '<div style="display:flex; gap:10px; flex-wrap:wrap; align-items:center;">';
    // 总计线（白色）
    html += `<span style="display:flex; align-items:center; gap:4px; font-size:11px; opacity:0.75;">`;
    html += `<svg width="14" height="8" style="flex-shrink:0;"><line x1="0" y1="4" x2="14" y2="4" stroke="rgba(255,255,255,0.85)" stroke-width="2.4" stroke-linecap="round"/></svg>`;
    html += `总计</span>`;
    // 各后端（色块）
    for (const [, meta] of Object.entries(BACKEND_LABELS)) {
        html += `<span style="display:flex; align-items:center; gap:4px; font-size:11px; opacity:0.75;">`;
        html += `<svg width="14" height="8" style="flex-shrink:0;"><line x1="0" y1="4" x2="14" y2="4" stroke="${meta.color}" stroke-width="1.6" stroke-linecap="round"/></svg>`;
        html += `${meta.icon} ${meta.name}</span>`;
    }
    html += '</div>';
    el.innerHTML = html;
}

/**
 * 构建光滑贝塞尔折线路径
 */
function buildLinePath(values, xOf, yOf) {
    if (values.length === 0) return '';
    const pts = values.map((v, i) => [xOf(i), yOf(v)]);
    let d = `M ${pts[0][0].toFixed(1)} ${pts[0][1].toFixed(1)}`;
    for (let i = 0; i < pts.length - 1; i++) {
        const dx = pts[i + 1][0] - pts[i][0];
        const t = 0.38;
        d += ` C ${(pts[i][0] + dx * t).toFixed(1)} ${pts[i][1].toFixed(1)} ${(pts[i + 1][0] - dx * t).toFixed(1)} ${pts[i + 1][1].toFixed(1)} ${pts[i + 1][0].toFixed(1)} ${pts[i + 1][1].toFixed(1)}`;
    }
    return d;
}

/**
 * 渲染多线股票风格折线图（总计 + 各后端独立颜色）
 */
function renderChart(period) {
    const el = document.getElementById('ch-gen-chart');
    if (!el) return;

    // 更新 tab 高亮
    document.querySelectorAll('.ch-period-btn').forEach(btn => {
        const active = btn.dataset.period === period;
        btn.style.background = active ? 'rgba(79,195,247,0.18)' : 'transparent';
        btn.style.color = active ? '#4FC3F7' : 'inherit';
        btn.style.borderColor = active ? 'rgba(79,195,247,0.6)' : 'currentColor';
        btn.style.fontWeight = active ? 'bold' : 'normal';
        btn.style.opacity = active ? '1' : '0.5';
    });

    const stats = getImageGenStats();
    const buckets = aggregateBuckets(stats, period);
    const totals = buckets.map(b => Object.values(b.data).reduce((s, v) => s + v, 0));

    if (buckets.length === 0 || totals.every(t => t === 0)) {
        el.innerHTML = '<div style="text-align:center; opacity:0.5; padding:24px 0; font-size:13px;">暂无数据</div>';
        return;
    }

    const maxVal = Math.max(...totals, 1);
    const n = buckets.length;

    // SVG 布局参数
    const SW = 560, SH = 170;
    const PL = 36, PR = 10, PT = 12, PB = 30;
    const pw = SW - PL - PR;
    const ph = SH - PT - PB;

    const xOf = i => PL + (n <= 1 ? pw / 2 : (i / (n - 1)) * pw);
    const yOf = v => PT + ph - (v / maxVal) * ph;
    const baseY = (PT + ph).toFixed(1);

    // 构建数据系列：总计（白色主线）+ 各有数据的后端
    const TOTAL_COLOR = 'rgba(255,255,255,0.85)';
    const series = [
        { key: 'total', name: '总计', color: TOTAL_COLOR, values: totals, width: 2.4, isTotal: true }
    ];
    for (const [backend, meta] of Object.entries(BACKEND_LABELS)) {
        const values = buckets.map(b => b.data[backend] || 0);
        if (values.some(v => v > 0)) {
            series.push({ key: backend, name: meta.name, color: meta.color, values, width: 1.6, isTotal: false });
        }
    }

    // 水平网格线 + Y 轴标签
    const GRID_COUNT = 4;
    let gridSvg = '';
    for (let g = 0; g <= GRID_COUNT; g++) {
        const y = PT + (g / GRID_COUNT) * ph;
        const val = Math.round(maxVal * (1 - g / GRID_COUNT));
        gridSvg += `<line x1="${PL}" y1="${y.toFixed(1)}" x2="${SW - PR}" y2="${y.toFixed(1)}" stroke="currentColor" stroke-opacity="${g === GRID_COUNT ? '0.2' : '0.08'}" stroke-width="1" stroke-dasharray="${g === GRID_COUNT ? 'none' : '3,3'}"/>`;
        if (val >= 0) {
            gridSvg += `<text x="${PL - 4}" y="${(y + 3.5).toFixed(1)}" text-anchor="end" style="fill:currentColor; opacity:0.45;" font-size="9">${val}</text>`;
        }
    }

    // X 轴标签（智能稀释）
    const showEvery = n > 20 ? Math.ceil(n / 10) : n > 10 ? 2 : 1;
    let xLabelsSvg = '';
    for (let i = 0; i < n; i++) {
        if (i % showEvery !== 0 && i !== n - 1) continue;
        xLabelsSvg += `<text x="${xOf(i).toFixed(1)}" y="${SH - 5}" text-anchor="middle" style="fill:currentColor; opacity:0.45;" font-size="9">${buckets[i].label}</text>`;
    }

    // 渐变填充（仅总计线下方）
    const totalLinePath = buildLinePath(totals, xOf, yOf);
    const totalAreaPath = `${totalLinePath} L ${xOf(n - 1).toFixed(1)} ${baseY} L ${xOf(0).toFixed(1)} ${baseY} Z`;
    const GRAD_ID = 'chGenGrad';
    const gradDef = `<linearGradient id="${GRAD_ID}" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="${TOTAL_COLOR}" stop-opacity="0.18"/>
      <stop offset="100%" stop-color="${TOTAL_COLOR}" stop-opacity="0.01"/>
    </linearGradient>`;

    // 各系列折线 SVG（先画后端细线，再画总计粗线压在最上面）
    const backendSeriesSvg = series.filter(s => !s.isTotal).map(s => {
        const lp = buildLinePath(s.values, xOf, yOf);
        if (!lp) return '';
        return `<path d="${lp}" fill="none" stroke="${s.color}" stroke-width="${s.width}" stroke-linecap="round" stroke-linejoin="round" stroke-opacity="0.85"/>`;
    }).join('\n  ');

    // 数据点（各系列，数据量少时才显示）
    let dotsSvg = '';
    if (n <= 31) {
        for (const s of series) {
            for (let i = 0; i < n; i++) {
                const v = s.values[i];
                if (v === 0) continue;
                const tip = `${s.name} | ${buckets[i].bucketKey}: ${v}张`;
                const r = s.isTotal ? 3 : 2.5;
                dotsSvg += `<circle cx="${xOf(i).toFixed(1)}" cy="${yOf(v).toFixed(1)}" r="${r}" fill="${s.color}" stroke="rgba(0,0,0,0.35)" stroke-width="1"><title>${tip}</title></circle>`;
            }
        }
    }

    // 最高点标注（总计）
    const maxIdx = totals.indexOf(Math.max(...totals));
    let peakSvg = '';
    if (totals[maxIdx] > 0) {
        const px = xOf(maxIdx), py = yOf(totals[maxIdx]);
        const lblX = Math.min(Math.max(px, PL + 14), SW - PR - 14);
        peakSvg = `<text x="${lblX.toFixed(1)}" y="${(py - 7).toFixed(1)}" text-anchor="middle" fill="${TOTAL_COLOR}" font-size="10" font-weight="bold" opacity="0.9">${totals[maxIdx]}</text>`;
    }

    // 右侧最新值标注（各系列，纵向排开）
    let rightLabelsSvg = '';
    const labeledSeries = [...series].reverse();
    const usedY = [];
    for (const s of labeledSeries) {
        const lastVal = s.values[n - 1];
        if (lastVal === 0) continue;
        let ly = yOf(lastVal) + 4;
        // 避免标签重叠
        for (const uy of usedY) {
            if (Math.abs(ly - uy) < 11) ly = uy + 11;
        }
        usedY.push(ly);
        rightLabelsSvg += `<text x="${(SW - PR + 3).toFixed(1)}" y="${ly.toFixed(1)}" fill="${s.color}" font-size="9" font-weight="bold" opacity="0.9">${lastVal}</text>`;
    }

    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${SW} ${SH}" style="width:100%; height:auto; display:block; overflow:visible;">
  <defs>${gradDef}</defs>
  ${gridSvg}
  <path d="${totalAreaPath}" fill="url(#${GRAD_ID})"/>
  ${backendSeriesSvg}
  <path d="${totalLinePath}" fill="none" stroke="${TOTAL_COLOR}" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>
  ${peakSvg}
  ${dotsSvg}
  ${xLabelsSvg}
  ${rightLabelsSvg}
</svg>`;

    el.innerHTML = svg;
}

/**
 * 渲染后端进度条明细
 */
function renderBackends(stats) {
    const el = document.getElementById('ch-gen-backends');
    if (!el) return;
    let maxSuccess = 0;
    for (const [, data] of Object.entries(stats.backends)) {
        if (data.success > maxSuccess) maxSuccess = data.success;
    }
    let html = '<div style="display:flex; flex-direction:column; gap:5px;">';
    for (const [backend, meta] of Object.entries(BACKEND_LABELS)) {
        const data = stats.backends[backend] || { success: 0, fail: 0 };
        if (data.success + data.fail === 0) continue;
        const pct = maxSuccess > 0 ? (data.success / maxSuccess) * 100 : 0;
        html += `<div style="display:flex; align-items:center; gap:8px;">`;
        html += `<span style="width:120px; font-size:12px; white-space:nowrap;">${meta.icon} ${meta.name}</span>`;
        html += `<div style="flex:1; height:14px; background:rgba(128,128,128,0.15); border-radius:7px; overflow:hidden;">`;
        html += `<div style="height:100%; width:${pct}%; background:${meta.color}; border-radius:7px; transition:width 0.3s;"></div></div>`;
        html += `<span style="width:76px; text-align:right; font-size:12px;"><strong>${data.success}</strong>`;
        if (data.fail > 0) html += ` <span style="color:#ef5350; font-size:11px;">(${data.fail}✗)</span>`;
        html += '</span></div>';
    }
    // 未知后端
    for (const [backend, data] of Object.entries(stats.backends)) {
        if (BACKEND_LABELS[backend] || data.success + data.fail === 0) continue;
        html += `<div style="font-size:12px; opacity:0.6;">🔹 ${backend}: ${data.success} 成功 / ${data.fail} 失败</div>`;
    }
    html += '</div>';
    el.innerHTML = html;
}

function updateImageGenStats() {
    const stats = getImageGenStats();
    renderSummary(stats);
    renderLegend();
    renderChart(_currentPeriod);
    renderBackends(stats);
}

function handlePeriodChange(period) {
    _currentPeriod = period;
    renderChart(period);
}

function handleResetGenStats() {
    stylishConfirm("确定要重置所有生图统计数据吗？此操作不可撤销。").then(confirmed => {
        if (confirmed) {
            resetImageGenStats();
            _currentPeriod = 'day';
            updateImageGenStats();
            toastr.info("生图统计已重置。");
        }
    });
}

// --- Debug Log Management ---

/**
 * 更新调试模式状态显示
 */
function updateDebugStatus() {
    const enabled = isDebugEnabled();
    const logCount = getDebugLogCount();

    const toggle = document.getElementById('ch-debug-mode-toggle');
    const status = document.getElementById('ch-debug-status');
    const downloadBtn = document.getElementById('ch-download-debug-log');
    const clearBtn = document.getElementById('ch-clear-debug-log');

    if (toggle) {
        toggle.checked = enabled;
    }

    if (status) {
        if (enabled) {
            status.textContent = `已启用 (${logCount} 条记录)`;
            status.style.color = '#4CAF50';
        } else {
            status.textContent = logCount > 0 ? `已禁用 (${logCount} 条记录)` : '已禁用';
            status.style.color = '#999';
        }
    }

    if (downloadBtn) {
        downloadBtn.disabled = logCount === 0;
    }

    if (clearBtn) {
        clearBtn.disabled = logCount === 0;
    }
}

/**
 * 更新错误统计显示
 */
function updateErrorStats() {
    const stats = getErrorStats();
    const statsElement = document.getElementById('ch-error-stats');
    const downloadBtn = document.getElementById('ch-download-errors');
    const clearBtn = document.getElementById('ch-clear-errors');

    if (statsElement) {
        if (stats.total === 0) {
            statsElement.innerHTML = '<span style="color: #4CAF50;">✓ 暂无错误记录</span>';
        } else {
            let html = `<div>总错误数: <strong>${stats.total}</strong> <span style="opacity:0.65;">（去重后 ${stats.unique} 条）</span></div>`;
            html += `<div>最近 1 小时: <strong style="color: ${stats.recentHour > 0 ? '#f44336' : '#4CAF50'}">${stats.recentHour}</strong></div>`;
            html += `<div>最近 24 小时: <strong>${stats.recent24h}</strong></div>`;

            if (Object.keys(stats.byType).length > 0) {
                html += '<div style="margin-top: 5px;">按类型分布:</div>';
                html += '<div style="margin-left: 10px;">';
                for (const [type, count] of Object.entries(stats.byType)) {
                    html += `<div>• ${type}: ${count}</div>`;
                }
                html += '</div>';
            }

            if (Object.keys(stats.byScope || {}).length > 0) {
                html += '<div style="margin-top: 5px;">按来源分布:</div>';
                html += '<div style="margin-left: 10px;">';
                for (const [scope, count] of Object.entries(stats.byScope)) {
                    const scopeLabel = scope === 'plugin' ? '本插件相关' : scope === 'external' ? '外部来源' : '未知来源';
                    html += `<div>• ${scopeLabel}: ${count}</div>`;
                }
                html += '</div>';
            }

            statsElement.innerHTML = html;
        }
    }

    if (downloadBtn) {
        downloadBtn.disabled = stats.total === 0;
    }

    if (clearBtn) {
        clearBtn.disabled = stats.total === 0;
    }
}

// --- Debug Log Management ---

/**
 * 处理调试模式开关切换
 */
function handleDebugToggle(event) {
    const enabled = event.target.checked;
    toggleDebug(enabled);
    updateDebugStatus();

    if (enabled) {
        toastr.info('🔧 调试模式已启用，开始记录详细日志');
    } else {
        toastr.info('调试模式已禁用');
    }
}

/**
 * 处理下载调试日志
 */
function handleDownloadDebugLog() {
    const logContent = exportDebugLog();
    if (!logContent || logContent === '调试日志为空。') {
        alert("调试日志为空。");
        return;
    }

    const blob = new Blob([logContent], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `st-chatu8-debug-${new Date().toISOString().slice(0, 19).replace(/:/g, '-')}.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    toastr.success('调试日志已下载');
}

/**
 * 处理清空调试日志
 */
function handleClearDebugLog() {
    stylishConfirm("确定要清空调试日志吗？").then(confirmed => {
        if (confirmed) {
            clearDebugLog();
            updateDebugStatus();
            toastr.info("调试日志已清空。");
        }
    });
}

/**
 * 查看错误详情
 */
function handleViewErrors() {
    const errors = getAllErrors();

    if (errors.length === 0) {
        alert("暂无错误记录。");
        return;
    }

    // 创建模态框显示错误详情
    const overlay = document.createElement('div');
    overlay.style.cssText = 'position: fixed; top: 0; left: 0; width: 100%; height: 100%; background-color: rgba(0, 0, 0, 0.7); z-index: 9999; display: flex; align-items: center; justify-content: center;';

    const modal = document.createElement('div');
    modal.style.cssText = 'background: white; border-radius: 8px; padding: 20px; max-width: 800px; max-height: 80vh; overflow-y: auto; box-shadow: 0 4px 20px rgba(0,0,0,0.3);';

    let html = '<h3 style="margin-top: 0;">错误详情</h3>';
    html += '<div style="font-family: monospace; font-size: 12px; line-height: 1.6;">';

    // 显示最近 20 条错误
    const recentErrors = errors.slice(-20).reverse();
    for (const error of recentErrors) {
        const time = new Date(error.lastSeen || error.timestamp).toLocaleString();
        const firstSeen = new Date(error.firstSeen || error.timestamp).toLocaleString();
        const scopeLabel = error.sourceScope === 'plugin' ? '本插件相关' : error.sourceScope === 'external' ? '外部来源' : '未知来源';
        html += `<div style="border-bottom: 1px solid #eee; padding: 10px 0;">`;
        html += `<div style="color: #f44336; font-weight: bold;">[${time}] ${error.type.toUpperCase()} <span style="color:#666; font-weight:normal;">(${scopeLabel})</span></div>`;
        html += `<div style="margin: 5px 0;"><strong>类型:</strong> ${escapeHtml(error.message)}</div>`;
        html += `<div style="margin: 5px 0;"><strong>次数:</strong> ${error.count || 1}</div>`;
        html += `<div style="margin: 5px 0;"><strong>首次出现:</strong> ${escapeHtml(firstSeen)}</div>`;

        if (error.source) {
            html += `<div style="margin: 5px 0;"><strong>文件:</strong> ${escapeHtml(error.source)}</div>`;
        }

        if (error.lineno != null || error.colno != null) {
            html += `<div style="margin: 5px 0;"><strong>位置:</strong> ${escapeHtml(`${error.lineno ?? '?'}:${error.colno ?? '?'}`)}</div>`;
        }

        // 显示 context 中的实际错误消息
        if (error.context && error.context.message) {
            html += `<div style="margin: 5px 0;"><strong>内容:</strong> ${escapeHtml(error.context.message)}</div>`;
        }

        if (error.context && error.context.title) {
            html += `<div style="margin: 5px 0;"><strong>标题:</strong> ${escapeHtml(error.context.title)}</div>`;
        }

        if (error.errorMessage) {
            html += `<div style="margin: 5px 0;"><strong>详情:</strong> ${escapeHtml(error.errorMessage)}</div>`;
        }

        if (error.errorName) {
            html += `<div style="margin: 5px 0;"><strong>错误名:</strong> ${escapeHtml(error.errorName)}</div>`;
        }

        if (error.stack) {
            const stackLines = error.stack.split('\n').slice(0, 3);
            html += `<div style="margin: 5px 0;"><strong>堆栈:</strong></div>`;
            html += `<pre style="background: #f5f5f5; padding: 5px; overflow-x: auto; font-size: 11px;">${escapeHtml(stackLines.join('\n'))}</pre>`;
        }

        html += '</div>';
    }

    html += '</div>';
    html += '<div style="text-align: right; margin-top: 15px;"><button id="close-error-modal" style="padding: 8px 16px; background: #2196F3; color: white; border: none; border-radius: 4px; cursor: pointer;">关闭</button></div>';

    modal.innerHTML = html;
    overlay.appendChild(modal);
    document.body.appendChild(overlay);

    document.getElementById('close-error-modal').addEventListener('click', () => {
        document.body.removeChild(overlay);
    });

    overlay.addEventListener('click', (e) => {
        if (e.target === overlay) {
            document.body.removeChild(overlay);
        }
    });
}

/**
 * 下载错误日志
 */
async function handleDownloadErrors() {
    const logContent = await exportErrors();
    if (!logContent || logContent === '暂无错误记录。') {
        alert("错误记录为空，无法导出诊断包。");
        return;
    }

    const blob = new Blob([logContent], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `st-chatu8-diagnostics-${new Date().toISOString().slice(0, 19).replace(/:/g, '-')}.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    toastr.success('诊断包已下载（包含错误记录和最近 24 小时日志）');
}

/**
 * 清空错误记录
 */
function handleClearErrors() {
    stylishConfirm("确定要清空所有错误记录吗？").then(confirmed => {
        if (confirmed) {
            clearErrors();
            updateErrorStats();
            toastr.info("错误记录已清空。");
        }
    });
}

/**
 * HTML 转义
 */
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

export function initLogSettings(settingsModal) {
    initializeLogPersistence().then(() => {
        updateLogView();
    }).catch(error => {
        console.error('[LogSettings] 初始化日志持久化失败:', error);
    });

    // 普通日志
    settingsModal.find('#ch-export-log').on('click', handleExportLog);
    settingsModal.find('#ch-clear-log').on('click', handleClearLog);

    // 调试日志
    settingsModal.find('#ch-debug-mode-toggle').on('change', handleDebugToggle);
    settingsModal.find('#ch-download-debug-log').on('click', handleDownloadDebugLog);
    settingsModal.find('#ch-clear-debug-log').on('click', handleClearDebugLog);

    // 错误收集器
    settingsModal.find('#ch-view-errors').on('click', handleViewErrors);
    settingsModal.find('#ch-download-errors').on('click', handleDownloadErrors);
    settingsModal.find('#ch-clear-errors').on('click', handleClearErrors);

    // 生图生涯
    settingsModal.find('.ch-period-btn').on('click', function () {
        handlePeriodChange(this.dataset.period);
    });
    settingsModal.find('#ch-refresh-gen-stats').on('click', () => {
        updateImageGenStats();
        toastr.info('统计已刷新');
    });
    settingsModal.find('#ch-reset-gen-stats').on('click', handleResetGenStats);

    // 初始化任务管理器
    initTaskManager(settingsModal);

    // 初始化状态显示
    updateDebugStatus();
    updateErrorStats();
    updateImageGenStats();
}

// Export for use in tab switching
export { updateLogView, updateDebugStatus, updateErrorStats, updateImageGenStats };

