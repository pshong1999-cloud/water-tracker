// ===== 喝了吗水 =====

import * as XLSX from 'xlsx';
import { save as dialogSave } from '@tauri-apps/plugin-dialog';
import { writeFile as fsWriteFile } from '@tauri-apps/plugin-fs';

const GOAL = 8;
const KEY = 'wt-';

let level = 100;
let data = null;

function today() {
  const d = new Date();
  return KEY + d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0');
}

function load() {
  const raw = localStorage.getItem(today());
  if (raw) {
    data = JSON.parse(raw);
    level = data.level || 100;
  } else {
    data = { records: [], level: 100, total: 0 };
    level = 100;
  }
}

function save() {
  data.level = level;
  localStorage.setItem(today(), JSON.stringify(data));
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
  // 用 data-rid 标记记录的唯一id（时间+量），不依赖索引
  let html = '';
  for (let i = data.records.length - 1; i >= 0; i--) {
    const r = data.records[i];
    const txt = r.amount === 1 ? '1杯' : (Number.isInteger(r.amount) ? r.amount + '杯' : r.amount.toFixed(2) + '杯');
    // 用时间+量作为唯一标识，避免索引问题
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

// ===== 删除记录 - 用mousedown+mouseup模拟click，绕过所有click问题 =====
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
      // 清除所有pressing状态
      rl.querySelectorAll('.del.pressing').forEach(d => d.classList.remove('pressing'));
      return;
    }
    if (!del.classList.contains('pressing')) return;
    del.classList.remove('pressing');

    // 执行删除
    const rid = del.dataset.rid;
    for (let i = 0; i < data.records.length; i++) {
      const r = data.records[i];
      if (r.time + '_' + r.amount === rid) {
        data.total -= r.amount;
        if (data.total < 0) data.total = 0;
        data.records.splice(i, 1);
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
    // 收集所有天的数据
    const allDays = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k.startsWith(KEY)) {
        const dayData = JSON.parse(localStorage.getItem(k));
        const dateStr = k.replace(KEY, '');
        allDays.push({ date: dateStr, data: dayData });
      }
    }

    // 按日期排序
    allDays.sort(function(a, b) { return a.date.localeCompare(b.date); });

    // 生成表格数据
    const rows = [];
    rows.push(['日期', '时间', '喝水量(杯)', '当日累计(杯)']);

    for (const day of allDays) {
      let cum = 0;
      for (const r of day.data.records) {
        cum += r.amount;
        rows.push([day.date, r.time, r.amount, cum.toFixed(2)]);
      }
      // 如果这天没有记录但有total，加一行汇总
      if (day.data.records.length === 0 && day.data.total > 0) {
        rows.push([day.date, '汇总', day.data.total.toFixed(2), day.data.total.toFixed(2)]);
      }
    }

    // 用SheetJS生成xlsx（静态导入，打包时直接包含）
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet(rows);

    // 设置列宽
    ws['!cols'] = [{ wch: 12 }, { wch: 8 }, { wch: 14 }, { wch: 14 }];

    XLSX.utils.book_append_sheet(wb, ws, '喝水记录');

    // 生成二进制数据
    const buf = XLSX.write(wb, { type: 'array', bookType: 'xlsx' });
    const uint8 = new Uint8Array(buf);

    // 用Tauri ES module API让用户选保存位置
    const filePath = await dialogSave({
      defaultPath: '喝水记录.xlsx',
      filters: [{ name: 'Excel', extensions: ['xlsx'] }]
    });

    if (!filePath) return; // 用户取消了

    // 写入文件（ES module API正确处理Uint8Array二进制数据）
    await fsWriteFile(filePath, uint8);
  } catch(e) {
    console.error('导出Excel失败:', e);
    // 用Tauri对话框提示错误
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
let historyChart = null;
let historyVisible = false;
let historyDays = 7;

async function toggleHistory() {
  historyVisible = !historyVisible;
  const btn = document.getElementById('history-btn');
  const section = document.getElementById('history-section');

  if (historyVisible) {
    btn.textContent = '📈 收起趋势';
    btn.classList.add('active');
    section.style.display = 'block';
    await renderHistory();
  } else {
    btn.textContent = '📈 近' + historyDays + '天趋势';
    btn.classList.remove('active');
    section.style.display = 'none';
  }
}

async function renderHistory() {
  // 收集所有天的数据
  const days = [];
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (k.startsWith(KEY)) {
      const dayData = JSON.parse(localStorage.getItem(k));
      days.push({ date: k.replace(KEY, ''), total: dayData.total || 0 });
    }
  }

  // 标题
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
    labels.push(String(dt.getMonth()+1) + '/' + String(dt.getDate()));
    const found = days.find(function(x) { return x.date === key; });
    values.push(found ? found.total : 0);
  }

  const Chart = await import('chart.js');
  const ctx = document.getElementById('history-chart').getContext('2d');

  if (historyChart) {
    historyChart.destroy();
  }

  historyChart = new Chart.default(ctx, {
    type: 'line',
    data: {
      labels: labels,
      datasets: [{
        label: '杯数',
        data: values,
        borderColor: '#5B9BD5',
        backgroundColor: 'rgba(126,200,227,0.15)',
        fill: true,
        tension: 0.3,
        pointRadius: 3,
        pointBackgroundColor: '#5B9BD5'
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: function(ctx) { return ctx.parsed.y.toFixed(2) + '杯'; }
          }
        }
      },
      scales: {
        y: {
          beginAtZero: true,
          suggestedMax: 10,
          ticks: {
          stepSize: 1,
            callback: function(v) { return v + '杯'; }
          },
          grid: { color: 'rgba(0,0,0,0.05)' }
        },
        x: {
          ticks: { maxRotation: 0 },
          grid: { display: false }
        }
      }
    }
  });
}

function initHistory() {
  document.getElementById('history-btn').addEventListener('mousedown', function(e) {
    e.target.classList.add('pressing');
  });
  document.getElementById('history-btn').addEventListener('mouseup', function(e) {
    if (!e.target.classList.contains('pressing')) return;
    e.target.classList.remove('pressing');
    toggleHistory();
  });

  // 关闭按钮 - 用mousedown/mouseup
  document.getElementById('history-close').addEventListener('mousedown', function(e) {
    e.target.classList.add('pressing');
  });
  document.getElementById('history-close').addEventListener('mouseup', function(e) {
    if (!e.target.classList.contains('pressing')) return;
    e.target.classList.remove('pressing');
    // 收起折线图
    historyVisible = false;
    document.getElementById('history-section').style.display = 'none';
    const btn = document.getElementById('history-btn');
    btn.textContent = '📈 近' + historyDays + '天趋势';
    btn.classList.remove('active');
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
window.addEventListener('DOMContentLoaded', function() {
  // 清除之前的脏数据（可能有错误的localStorage数据）
  localStorage.removeItem('water-tracker-2026-06-26');

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
