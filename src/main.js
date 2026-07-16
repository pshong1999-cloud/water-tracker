// ===== 喝了吗水 =====

import * as XLSX from 'xlsx';
import { save as dialogSave } from '@tauri-apps/plugin-dialog';
import { writeFile as fsWriteFile, readTextFile as fsReadText, writeTextFile as fsWriteText, exists as fsExists, mkdir as fsMkdir } from '@tauri-apps/plugin-fs';
import { appDataDir } from '@tauri-apps/api/path';

const GOAL = 8;
const KEY = 'wt-';  // 仅用于localStorage迁移
const DATA_FILE = 'water-data.json';

let level = 100;
let data = null;
let allData = null;  // { days: { "2026-07-06": { records, level, total }, ... } }
let dataDir = null;
let saveTimer = null;

function today() {
  const d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0');
}

// ===== 文件存储 =====
async function initStorage() {
  try {
    dataDir = await appDataDir();
  } catch(e) {
    console.error('获取数据目录失败:', e);
    dataDir = null;
  }

  if (dataDir) {
    try {
      const filePath = dataDir + DATA_FILE;
      const fileExists = await fsExists(filePath);
      if (fileExists) {
        const content = await fsReadText(filePath);
        const parsed = JSON.parse(content);
        if (parsed && parsed.days) {
          allData = parsed;
        } else {
          allData = { days: {} };
          await migrateFromLocalStorage();
          const saved = await writeDataFile();
          if (saved) clearOldLocalStorage();
        }
      } else {
        allData = { days: {} };
        await migrateFromLocalStorage();
        const saved = await writeDataFile();
        if (saved) clearOldLocalStorage();
      }
    } catch(e) {
      console.error('initStorage失败:', e.message || e);
      allData = { days: {} };
      await migrateFromLocalStorage();
    }
  } else {
    allData = { days: {} };
    loadFromLocalStorage();
  }
}

async function migrateFromLocalStorage() {
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (k.startsWith(KEY)) {
      try {
        const dayData = JSON.parse(localStorage.getItem(k));
        const dateStr = k.replace(KEY, '');
        if (!allData.days[dateStr]) {
          allData.days[dateStr] = dayData;
        }
      } catch(e) {}
    }
  }
}

function clearOldLocalStorage() {
  const keysToRemove = [];
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (k.startsWith(KEY)) keysToRemove.push(k);
  }
  keysToRemove.forEach(k => localStorage.removeItem(k));
}

function loadFromLocalStorage() {
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (k.startsWith(KEY)) {
      try {
        const dayData = JSON.parse(localStorage.getItem(k));
        const dateStr = k.replace(KEY, '');
        allData.days[dateStr] = dayData;
      } catch(e) {}
    }
  }
}

async function writeDataFile() {
  if (!dataDir || !allData) return false;
  try {
    await fsMkdir(dataDir, { recursive: true });
    await fsWriteText(dataDir + DATA_FILE, JSON.stringify(allData));
    return true;
  } catch(e) {
    console.error('写入数据文件失败:', e);
    return false;
  }
}

function load() {
  const dateStr = today();
  if (allData && allData.days[dateStr]) {
    data = allData.days[dateStr];
    level = data.level || 100;
  } else {
    data = { records: [], level: 100, total: 0 };
    level = 100;
  }
  if (allData) {
    allData.days[dateStr] = data;
  }
}

function save() {
  data.level = level;
  if (allData) {
    allData.days[today()] = data;
  }
  // 延迟写入文件，避免频繁IO
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(async function() {
    await writeDataFile();
  }, 500);
}

async function saveNow() {
  data.level = level;
  if (allData) {
    allData.days[today()] = data;
  }
  if (saveTimer) clearTimeout(saveTimer);
  await writeDataFile();
}

function render() {
  // 水位
  document.getElementById('water').style.height = level + '%';
  document.getElementById('slider-fill').style.height = level + '%';
  document.getElementById('slider-handle').style.bottom = 'calc(' + level + '% - 5px)';
  // 拖动时显示百分比
  const sp = document.getElementById('slider-percent');
  sp.textContent = level + '%';
  if (dragging) {
    sp.classList.add('visible');
  } else {
    sp.classList.remove('visible');
  }

  // 加水按钮
  const rb = document.getElementById('refill-btn');
  rb.classList.toggle('visible', level < 100);

  // 进度
  const pct = Math.min(data.total / GOAL * 100, 100);
  document.getElementById('progress-fill').style.width = pct + '%';
  const tc = document.getElementById('today-count');
  tc.textContent = data.total === 0 ? '0杯' : (Number.isInteger(data.total) ? data.total + '杯' : data.total.toFixed(2) + '杯');

  // 记录
  const rl = document.getElementById('record-list');
  if (data.records.length === 0) {
    rl.innerHTML = '<div class="empty-state">还没有记录，喝点水吧</div>';
    save();
    return;
  }

  // 倒序显示记录，每条记录后面加一个删除按钮
  let html = '';
  for (let i = data.records.length - 1; i >= 0; i--) {
    const r = data.records[i];
    const txt = r.amount === 1 ? '1杯' : (Number.isInteger(r.amount) ? r.amount + '杯' : r.amount.toFixed(2) + '杯');
    const rid = r.time + '_' + r.amount;
    html += '<div class="record-item">'
      + '<span class="time">' + r.time + '</span>'
      + '<span class="amount">' + txt + '</span>'
      + '<span class="del" data-rid="' + rid + '">×</span>'
      + '</div>';
  }
  rl.innerHTML = html;

  save();
}

// ===== 删除记录 =====
function initDelete() {
  const rl = document.getElementById('record-list');

  rl.addEventListener('mousedown', function(e) {
    const del = e.target.closest('.del');
    if (!del) return;
    del.classList.add('pressing');
  });

  rl.addEventListener('mouseup', function(e) {
    const del = e.target.closest('.del');
    if (!del) {
      rl.querySelectorAll('.del.pressing').forEach(d => d.classList.remove('pressing'));
      return;
    }
    if (!del.classList.contains('pressing')) return;
    del.classList.remove('pressing');

    const rid = del.dataset.rid;
    for (let i = 0; i < data.records.length; i++) {
      const r = data.records[i];
      if (r.time + '_' + r.amount === rid) {
        data.total -= r.amount;
        if (data.total < 0) data.total = 0;
        data.records.splice(i, 1);
        saveNow(); // 删除记录立即保存
        render();
        return;
      }
    }
  });
}

function setLevel(v) {
  level = Math.max(0, Math.min(100, Math.round(v)));
  render();
}

function refill() {
  if (level >= 100) return;
  const drank = (100 - level) / 100;
  const now = new Date();
  const t = String(now.getHours()).padStart(2,'0') + ':' + String(now.getMinutes()).padStart(2,'0');
  data.records.push({ time: t, amount: drank });
  data.total += drank;
  level = 100;
  render();
  saveNow(); // 喝水记录立即保存
}

// ===== 拖动条 =====
let dragging = false;

function initSlider() {
  const track = document.getElementById('slider-track');

  function fromY(clientY) {
    const rect = track.getBoundingClientRect();
    return Math.round((1 - (clientY - rect.top) / rect.height) * 100);
  }

  track.addEventListener('mousedown', function(e) {
    dragging = true;
    e.preventDefault();
    setLevel(fromY(e.clientY));
  });

  window.addEventListener('mousemove', function(e) {
    if (!dragging) return;
    e.preventDefault();
    setLevel(fromY(e.clientY));
  });

  window.addEventListener('mouseup', function() {
    if (dragging) {
      dragging = false;
      render();
    }
  });

  track.addEventListener('touchstart', function(e) {
    dragging = true;
    e.preventDefault();
    setLevel(fromY(e.touches[0].clientY));
  }, { passive: false });

  window.addEventListener('touchmove', function(e) {
    if (!dragging) return;
    e.preventDefault();
    setLevel(fromY(e.touches[0].clientY));
  }, { passive: false });

  window.addEventListener('touchend', function() {
    if (dragging) {
      dragging = false;
      render();
    }
  });
}

function initButtons() {
  document.querySelectorAll('.quick-btn').forEach(function(btn) {
    btn.addEventListener('click', function() {
      setLevel(parseInt(btn.dataset.level));
    });
  });
  document.getElementById('refill-btn').addEventListener('click', refill);
}

// ===== 通知 =====
let lastAction = Date.now();

function initNotify() {
  try {
    const n = window.__TAURI__.notification;
    n.isPermissionGranted().then(function(ok) {
      if (!ok) {
        n.requestPermission().then(function(p) { if (p === 'granted') startRemind(); });
      } else {
        startRemind();
      }
    });
  } catch(e) {}
}

function startRemind() {
  setInterval(function() {
    if (Date.now() - lastAction >= 7200000 && level < 100) {
      try { window.__TAURI__.notification.sendNotification({ title: '喝水提醒', body: '该加水了' }); } catch(e) {}
    }
  }, 300000);
}

// ===== 导出Excel =====
async function exportExcel() {
  try {
    // 直接从allData收集所有天的数据（不再遍历localStorage）
    const allDays = [];
    if (allData && allData.days) {
      for (const [dateStr, dayData] of Object.entries(allData.days)) {
        allDays.push({ date: dateStr, data: dayData });
      }
    }

    // 按日期排序
    allDays.sort(function(a, b) { return a.date.localeCompare(b.date); });

    if (allDays.length === 0) {
      try {
        window.__TAURI__.dialog.message('还没有任何喝水记录，无法导出', { title: '提示', kind: 'info' });
      } catch(e2) {
        alert('还没有任何喝水记录，无法导出');
      }
      return;
    }

    // 生成表格数据
    const rows = [];
    rows.push(['日期', '时间', '喝水量(杯)', '当日累计(杯)']);

    for (const day of allDays) {
      let cum = 0;
      for (const r of day.data.records) {
        cum += r.amount;
        rows.push([day.date, r.time, r.amount, cum.toFixed(2)]);
      }
      if (day.data.records.length === 0 && day.data.total > 0) {
        rows.push([day.date, '汇总', day.data.total.toFixed(2), day.data.total.toFixed(2)]);
      }
    }

    // 用SheetJS生成xlsx
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet(rows);
    ws['!cols'] = [{ wch: 12 }, { wch: 8 }, { wch: 14 }, { wch: 14 }];
    XLSX.utils.book_append_sheet(wb, ws, '喝水记录');

    const buf = XLSX.write(wb, { type: 'array', bookType: 'xlsx' });
    const uint8 = new Uint8Array(buf);

    // 用Tauri对话框让用户选保存位置
    const filePath = await dialogSave({
      defaultPath: '喝水记录.xlsx',
      filters: [{ name: 'Excel', extensions: ['xlsx'] }]
    });

    if (!filePath) return;

    await fsWriteFile(filePath, uint8);

    // 导出成功提示
    try {
      window.__TAURI__.dialog.message('导出成功！', { title: '提示', kind: 'info' });
    } catch(e2) {}
  } catch(e) {
    console.error('导出Excel失败:', e);
    try {
      window.__TAURI__.dialog.message('导出Excel失败: ' + (e.message || e), { title: '错误', kind: 'error' });
    } catch(e2) {
      alert('导出Excel失败: ' + (e.message || e));
    }
  }
}

function initExport() {
  document.getElementById('export-btn').addEventListener('mousedown', function(e) {
    e.target.classList.add('pressing');
  });
  document.getElementById('export-btn').addEventListener('mouseup', function(e) {
    if (!e.target.classList.contains('pressing')) return;
    e.target.classList.remove('pressing');
    exportExcel();
  });
}

// ===== 历史折线图 =====
let historyVisible = false;
let historyDays = 10;
let historyData = null; // { labels, values }
let hoveredIdx = -1;

async function toggleHistory() {
  historyVisible = !historyVisible;
  const btn = document.getElementById('history-btn');
  const section = document.getElementById('history-section');

  if (historyVisible) {
    btn.textContent = '📈 收起趋势';
    btn.classList.add('active');
    section.style.display = 'block';
    renderHistory();
    // 展开后滚动到图表区域，确保X轴标签可见
    setTimeout(function() {
      section.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }, 100);
  } else {
    btn.textContent = '📈 近' + historyDays + '天趋势';
    btn.classList.remove('active');
    section.style.display = 'none';
  }
}

function renderHistory() {
  document.getElementById('history-title').textContent = '近' + historyDays + '天趋势';
  const btn = document.getElementById('history-btn');
  btn.textContent = '📈 收起趋势';

  // 生成最近N天的标签和数据
  const now = new Date();
  const labels = [];
  const values = [];
  for (let d = historyDays - 1; d >= 0; d--) {
    const dt = new Date(now);
    dt.setDate(dt.getDate() - d);
    const key = dt.getFullYear() + '-' + String(dt.getMonth()+1).padStart(2,'0') + '-' + String(dt.getDate()).padStart(2,'0');
    const mm = dt.getMonth()+1;
    const dd = dt.getDate();
    if (d === 0) {
      labels.push({ top: '今天', bottom: mm + '/' + dd });
    } else if (d === 1) {
      labels.push({ top: '昨天', bottom: mm + '/' + dd });
    } else if (d <= 6) {
      labels.push({ top: d + '天前', bottom: mm + '/' + dd });
    } else {
      labels.push({ top: mm + '/' + dd, bottom: '' });
    }
    const dayData = (allData && allData.days[key]) ? allData.days[key] : null;
    values.push(dayData ? (dayData.total || 0) : 0);
  }

  historyData = { labels, values };
  hoveredIdx = -1;
  // 等一帧确保layout完成后再画canvas
  requestAnimationFrame(drawChart);
}

function drawChart() {
  const canvas = document.getElementById('history-chart');
  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  const W = rect.width;
  const H = rect.height;

  // canvas尺寸为0时跳过（布局未完成）
  if (W === 0 || H === 0) {
    requestAnimationFrame(drawChart);
    return;
  }

  // 设置canvas实际像素尺寸（高清屏适配）
  canvas.width = W * dpr;
  canvas.height = H * dpr;
  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);

  if (!historyData) return;
  const { labels, values } = historyData;
  const n = values.length;

  // 布局参数
  const padTop = 20;
  const padBottom = 36;
  const padLeft = 36;
  const padRight = 12;
  const chartW = W - padLeft - padRight;
  const chartH = H - padTop - padBottom;

  // Y轴范围
  const maxVal = Math.max(Math.ceil(Math.max(...values) + 1), 8);

  // 清空
  ctx.clearRect(0, 0, W, H);

  // ===== Y轴 =====
  ctx.font = '10px -apple-system, "Segoe UI", "Microsoft YaHei", sans-serif';
  ctx.fillStyle = '#95A5A6';
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';
  for (let i = 0; i <= maxVal; i++) {
    const y = padTop + chartH - (i / maxVal) * chartH;
    ctx.fillText(i + '杯', padLeft - 4, y);
    // 网格线
    ctx.strokeStyle = 'rgba(0,0,0,0.06)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(padLeft, y);
    ctx.lineTo(W - padRight, y);
    ctx.stroke();
  }

  // ===== X轴基线 =====
  ctx.strokeStyle = 'rgba(0,0,0,0.12)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(padLeft, padTop + chartH);
  ctx.lineTo(W - padRight, padTop + chartH);
  ctx.stroke();

  // ===== 数据点坐标 =====
  const stepX = chartW / (n - 1 || 1);
  const points = values.map((v, i) => ({
    x: padLeft + i * stepX,
    y: padTop + chartH - (v / maxVal) * chartH,
    val: v
  }));

  // ===== 面积填充 =====
  ctx.beginPath();
  ctx.moveTo(points[0].x, padTop + chartH);
  for (const p of points) {
    ctx.lineTo(p.x, p.y);
  }
  ctx.lineTo(points[points.length-1].x, padTop + chartH);
  ctx.closePath();
  const grad = ctx.createLinearGradient(0, padTop, 0, padTop + chartH);
  grad.addColorStop(0, 'rgba(126,200,227,0.25)');
  grad.addColorStop(1, 'rgba(126,200,227,0.03)');
  ctx.fillStyle = grad;
  ctx.fill();

  // ===== 折线 =====
  ctx.beginPath();
  ctx.moveTo(points[0].x, points[0].y);
  for (let i = 1; i < points.length; i++) {
    // 贝塞尔曲线让折线平滑
    const prev = points[i-1];
    const curr = points[i];
    const cpx = (prev.x + curr.x) / 2;
    ctx.bezierCurveTo(cpx, prev.y, cpx, curr.y, curr.x, curr.y);
  }
  ctx.strokeStyle = '#5B9BD5';
  ctx.lineWidth = 2;
  ctx.stroke();

  // ===== 数据点圆圈 =====
  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    ctx.beginPath();
    ctx.arc(p.x, p.y, 3.5, 0, Math.PI * 2);
    ctx.fillStyle = i === hoveredIdx ? '#4A8BC2' : '#5B9BD5';
    ctx.fill();
    ctx.strokeStyle = 'white';
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }

  // ===== hover 数值标签 =====
  if (hoveredIdx >= 0 && hoveredIdx < points.length) {
    const p = points[hoveredIdx];
    const valTxt = p.val === 0 ? '0杯' : (Number.isInteger(p.val) ? p.val + '杯' : p.val.toFixed(2) + '杯');
    ctx.font = 'bold 11px -apple-system, "Segoe UI", "Microsoft YaHei", sans-serif';
    ctx.fillStyle = '#4A8BC2';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    ctx.fillText(valTxt, p.x, p.y - 8);
  }

  // ===== X轴标签（两行：天数前 + 日期）=====
  ctx.font = '10px -apple-system, "Segoe UI", "Microsoft YaHei", sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';

  for (let i = 0; i < labels.length; i++) {
    const x = points[i].x;
    const lab = labels[i];
    // 第一行：今天/昨天/N天前（或日期）
    ctx.fillStyle = i === hoveredIdx ? '#4A8BC2' : '#95A5A6';
    if (lab.top) {
      ctx.fillText(lab.top, x, padTop + chartH + 4);
    }
    // 第二行：日期
    if (lab.bottom) {
      ctx.fillStyle = '#B8C4CC';
      ctx.font = '9px -apple-system, "Segoe UI", "Microsoft YaHei", sans-serif';
      ctx.fillText(lab.bottom, x, padTop + chartH + 17);
      ctx.font = '10px -apple-system, "Segoe UI", "Microsoft YaHei", sans-serif';
    }
  }
}

function initHistory() {
  const canvas = document.getElementById('history-chart');

  // 鼠标hover显示数值
  canvas.addEventListener('mousemove', function(e) {
    if (!historyData) return;
    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const W = rect.width;
    const padLeft = 36;
    const padRight = 12;
    const chartW = W - padLeft - padRight;
    const n = historyData.values.length;
    const stepX = chartW / (n - 1 || 1);

    // 找最近的数据点
    let closest = -1;
    let minDist = Infinity;
    for (let i = 0; i < n; i++) {
      const px = padLeft + i * stepX;
      const dist = Math.abs(mx - px);
      if (dist < minDist) {
        minDist = dist;
        closest = i;
      }
    }
    // 只在距离足够近时显示
    if (minDist < stepX * 0.6) {
      hoveredIdx = closest;
    } else {
      hoveredIdx = -1;
    }
    drawChart();
  });

  canvas.addEventListener('mouseleave', function() {
    hoveredIdx = -1;
    drawChart();
  });

  // 按钮事件（mousedown/mouseup防抖）
  document.getElementById('history-btn').addEventListener('mousedown', function(e) {
    e.target.classList.add('pressing');
  });
  document.getElementById('history-btn').addEventListener('mouseup', function(e) {
    if (!e.target.classList.contains('pressing')) return;
    e.target.classList.remove('pressing');
    toggleHistory();
  });

  // 关闭按钮
  document.getElementById('history-close').addEventListener('mousedown', function(e) {
    e.target.classList.add('pressing');
  });
  document.getElementById('history-close').addEventListener('mouseup', function(e) {
    if (!e.target.classList.contains('pressing')) return;
    e.target.classList.remove('pressing');
    historyVisible = false;
    document.getElementById('history-section').style.display = 'none';
    const btn = document.getElementById('history-btn');
    btn.textContent = '📈 近' + historyDays + '天趋势';
    btn.classList.remove('active');
    historyData = null;
  });

  // 天数选项
  document.querySelectorAll('.day-opt').forEach(function(opt) {
    opt.addEventListener('mousedown', function(e) {
      e.target.classList.add('pressing');
    });
    opt.addEventListener('mouseup', function(e) {
      if (!e.target.classList.contains('pressing')) return;
      e.target.classList.remove('pressing');

      historyDays = parseInt(opt.dataset.days);
      document.querySelectorAll('.day-opt').forEach(function(o) { o.classList.remove('active'); });
      opt.classList.add('active');

      const btn = document.getElementById('history-btn');
      btn.textContent = '📈 近' + historyDays + '天趋势';
      renderHistory();
    });
  });
}

// ===== 启动 =====
window.addEventListener('DOMContentLoaded', async function() {
  await initStorage();
  load();
  render();
  initSlider();
  initButtons();
  initDelete();
  initExport();
  initHistory();
  initNotify();

  document.addEventListener('mousedown', function() { lastAction = Date.now(); });
  document.addEventListener('keydown', function() { lastAction = Date.now(); });

});
