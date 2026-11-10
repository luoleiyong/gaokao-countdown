'use strict';
/* 课程表 · 独立页面（支持晚自习课次） */

const $ = (id) => document.getElementById(id);
const DAYS = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];
const bridge = window.gaokao || null;

const state = {
  data: null,
  ttRows: null,
  ttFile: null,
  showNight: true,
  saveTimer: null
};

function esc(v) {
  return String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

let toastTimer = null;
function toast(msg) {
  const el = $('ttToast');
  if (!el) return;
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, 2400);
}

async function boot() {
  try {
    state.showNight = localStorage.getItem('tt-show-night') !== '0';
  } catch (e) { state.showNight = true; }
  $('showNight').checked = state.showNight;

  if (!bridge) {
    document.body.innerHTML = '<p style="padding:40px;color:#f2efe9">请在桌面程序中使用课程表</p>';
    return;
  }
  try {
    state.data = await bridge.classroomGet();
  } catch (e) {
    state.data = { timetable: null };
  }
  if (!state.data || !state.data.timetable) {
    state.data = state.data || {};
    state.data.timetable = { title: '我的课程表', days: DAYS.slice(), periods: [] };
  }
  renderAll();
  bind();
}

function periods() {
  return (state.data && state.data.timetable && state.data.timetable.periods) || [];
}

function renderAll() {
  renderTable();
}

function renderTable() {
  const t = state.data.timetable;
  $('ttTitle').value = t.title || '我的课程表';
  const list = periods();
  $('ttCount').textContent = `共 ${list.length} 节${state.showNight ? '' : '（已隐藏晚自习）'}`;

  const head = `<thead><tr>
      <th>节次</th><th>时间</th>
      ${DAYS.map((d) => `<th>${d}</th>`).join('')}
      <th></th>
    </tr></thead>`;

  const body = list.map((p, pi) => {
    if (p.night && !state.showNight) return '';
    return `<tr data-pi="${pi}" class="${p.night ? 'tt-night' : ''}">
      <td><input class="tt-input tt-input--label" data-role="label" value="${esc(p.label)}" />${p.night ? '<i class="tt-night-flag">晚</i>' : ''}</td>
      <td><input class="tt-input tt-input--time" data-role="time" value="${esc(p.time)}" placeholder="08:00-08:45" /></td>
      ${DAYS.map((d, di) => `<td><input class="tt-input tt-input--cell" data-role="cell" data-di="${di}" value="${esc((p.cells && p.cells[di]) || '')}" /></td>`).join('')}
      <td><button class="tt-del" data-role="del" title="删除这一节">×</button></td>
    </tr>`;
  }).join('');

  $('ttTable').innerHTML = head + `<tbody>${body}</tbody>`;
}

function scheduleSave() {
  clearTimeout(state.saveTimer);
  state.saveTimer = setTimeout(saveTimetable, 450);
}

async function saveTimetable() {
  if (!state.data || !state.data.timetable) return;
  try {
    const res = await bridge.classroomSaveTimetable(state.data.timetable);
    if (res && res.ok && res.timetable) state.data.timetable = res.timetable;
  } catch (e) { /* 下次编辑会重试 */ }
}

function bind() {
  $('btnBackHome').addEventListener('click', () => bridge.closeTimetable());

  $('showNight').addEventListener('change', (e) => {
    state.showNight = !!e.target.checked;
    try { localStorage.setItem('tt-show-night', state.showNight ? '1' : '0'); } catch (err) { /* 忽略 */ }
    renderTable();
  });

  const table = $('ttTable');
  table.addEventListener('change', (e) => {
    const tr = e.target.closest('tr[data-pi]');
    if (!tr) return;
    const p = periods()[Number(tr.dataset.pi)];
    if (!p) return;
    const role = e.target.dataset.role;
    if (role === 'label') p.label = e.target.value.slice(0, 12);
    else if (role === 'time') p.time = e.target.value.slice(0, 24);
    else if (role === 'cell') {
      if (!Array.isArray(p.cells)) p.cells = ['', '', '', '', '', '', ''];
      p.cells[Number(e.target.dataset.di)] = e.target.value.slice(0, 30);
    }
    scheduleSave();
  });

  table.addEventListener('click', (e) => {
    if (e.target.dataset.role !== 'del') return;
    const tr = e.target.closest('tr[data-pi]');
    if (!tr) return;
    const idx = Number(tr.dataset.pi);
    if (!periods()[idx]) return;
    periods().splice(idx, 1);
    renderTable();
    scheduleSave();
  });

  $('ttTitle').addEventListener('input', (e) => {
    state.data.timetable.title = e.target.value.slice(0, 40);
    scheduleSave();
  });

  $('btnTtAdd').addEventListener('click', () => {
    const t = state.data.timetable;
    t.periods.push({
      id: 'p' + Date.now().toString(36),
      label: `第${t.periods.filter((p) => !p.night).length + 1}节`,
      time: '',
      night: false,
      cells: ['', '', '', '', '', '', '']
    });
    renderTable();
    scheduleSave();
  });

  $('btnAddNight').addEventListener('click', () => {
    const t = state.data.timetable;
    const nightCount = t.periods.filter((p) => p.night).length;
    t.periods.push({
      id: 'p' + Date.now().toString(36),
      label: `晚自习${nightCount + 1}`,
      time: '19:00-21:30',
      night: true,
      cells: ['', '', '', '', '', '', '']
    });
    if (!state.showNight) {
      state.showNight = true;
      $('showNight').checked = true;
    }
    renderTable();
    scheduleSave();
    toast('已添加晚自习课次');
  });

  $('btnTtImport').addEventListener('click', openImport);
  $('btnDoImportTt').addEventListener('click', doImport);
  $('btnPickTtFile').addEventListener('click', () => $('fileTimetable').click());
  document.querySelectorAll('[data-close="tt"]').forEach((el) => {
    el.addEventListener('click', closeImport);
  });

  $('fileTimetable').addEventListener('change', async (e) => {
    const file = e.target.files && e.target.files[0];
    e.target.value = '';
    if (!file) return;
    state.ttFile = file;
    state.ttRows = null;
    $('ttFileName').textContent = file.name;
    const ext = (file.name.split('.').pop() || '').toLowerCase();
    if (ext === 'xlsx' || ext === 'xls') {
      const filePath = bridge.getFilePath ? bridge.getFilePath(file) : '';
      const res = await bridge.classroomParseSheet(filePath);
      if (res && res.ok) {
        state.ttRows = res.rows;
        $('ttImportText').value = '';
        toast('已读取表格，点击「导入」应用');
      } else {
        toast((res && res.error) || '读取表格失败');
      }
    } else {
      const text = await file.text();
      $('ttImportText').value = text;
      toast('已读取文件，点击「导入」应用');
    }
  });

  window.addEventListener('dragover', (e) => e.preventDefault());
  window.addEventListener('drop', (e) => e.preventDefault());

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (!$('ttImportModal').hidden) closeImport();
      else bridge.closeTimetable();
    }
  });
}

/* ---------------- 导入 ---------------- */
function openImport() {
  state.ttRows = null;
  state.ttFile = null;
  $('ttImportText').value = '';
  $('ttFileName').textContent = '未选择文件';
  $('ttImportModal').hidden = false;
}

function closeImport() {
  $('ttImportModal').hidden = true;
}

function parseTimetableRows(rows) {
  const clean = (rows || [])
    .map((r) => (Array.isArray(r) ? r.map((c) => String(c == null ? '' : c).trim()) : []))
    .filter((r) => r.some(Boolean));
  if (!clean.length) return [];
  const headerIdx = clean.findIndex((r) => r.filter((c) => DAYS.includes(c.replace(/\s/g, ''))).length >= 2);
  if (headerIdx < 0) return [];
  const header = clean[headerIdx];
  const map = {};
  header.forEach((c, i) => {
    const d = DAYS.indexOf(c.replace(/\s/g, ''));
    if (d >= 0) map[i] = d;
  });
  const list = [];
  for (let i = headerIdx + 1; i < clean.length; i++) {
    const row = clean[i];
    const cells = Array(7).fill('');
    Object.keys(map).forEach((col) => {
      cells[map[col]] = String(row[Number(col)] || '').slice(0, 30);
    });
    const free = row.filter((c, idx) => map[idx] === undefined && c);
    const time = free.find((c) => /\d{1,2}\s*[:：]\s*\d{2}/.test(c)) || '';
    const labelRaw = free.find((c) => /第?\s*\d+\s*节/.test(c)) || '';
    if (!cells.some(Boolean) && !time) continue;
    list.push({
      id: 'p' + i + '_' + Date.now().toString(36),
      label: (labelRaw || `第${list.length + 1}节`).replace(/\s/g, '').slice(0, 12),
      time: time.replace(/：/g, ':').slice(0, 24),
      night: false,
      cells
    });
  }
  return list;
}

function parseTimetableText(text) {
  const lines = String(text || '').replace(/\r\n?/g, '\n').split('\n').map((l) => l.trim()).filter(Boolean);
  if (!lines.length) return [];
  const rows = lines.map((l) => l.split(/[,\t，]/).map((c) => c.trim()));
  const grid = parseTimetableRows(rows);
  if (grid.length) return grid;

  const list = [];
  lines.forEach((line, i) => {
    const day = DAYS.find((d) => line.includes(d));
    if (!day) return;
    const timeMatch = line.match(/\d{1,2}\s*[:：]\s*\d{2}\s*[-~—至]\s*\d{1,2}\s*[:：]\s*\d{2}/);
    const labelMatch = line.match(/第?\s*\d+\s*节/);
    let subject = '';
    line.split(/[\s,，;；\t]+/).forEach((tok) => {
      if (!tok) return;
      if (DAYS.includes(tok)) return;
      if (/\d{1,2}[:：]\d{2}/.test(tok)) return;
      if (/^第?\d+节$/.test(tok) || tok === '第' || tok === '节') return;
      subject = tok;
    });
    if (!subject) return;
    const cells = Array(7).fill('');
    cells[DAYS.indexOf(day)] = subject.slice(0, 30);
    list.push({
      id: 'p' + i + '_' + Date.now().toString(36),
      label: (labelMatch ? labelMatch[0].replace(/\s/g, '') : `第${list.length + 1}节`).slice(0, 12),
      time: timeMatch ? timeMatch[0].replace(/：/g, ':').replace(/[~—至]/g, '-') : '',
      night: false,
      cells
    });
  });
  return list;
}

async function doImport() {
  let list = [];
  if (state.ttRows) {
    list = parseTimetableRows(state.ttRows);
    if (!list.length) list = parseTimetableText(state.ttRows.map((r) => r.join(' ')).join('\n'));
  } else {
    list = parseTimetableText($('ttImportText').value);
  }
  if (!list.length) {
    toast('没有解析到课程，请检查格式后重试');
    return;
  }
  state.data.timetable.periods = list;
  renderTable();
  await saveTimetable();
  closeImport();
  toast(`课程表已导入，共 ${list.length} 节`);
}

boot();
