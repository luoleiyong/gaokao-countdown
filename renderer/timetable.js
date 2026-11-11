'use strict';
/* 课程表 · 独立页面（支持晚自习 / 周末作息 / 不固定周末课程） */

const $ = (id) => document.getElementById(id);
const DAYS = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];
const HOLIDAY_RE = /(放假|假期|休息|黄金周末|黄金周|不上课|停课)/;
const bridge = window.gaokao || null;

const state = {
  data: null,
  ttRows: null,
  ttSheets: null,
  ttFile: null,
  showNight: true,
  saveTimer: null,
  importTarget: 'weekday'
};

function esc(v) {
  return String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}
function pad2(n) {
  return String(n).padStart(2, '0');
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

function isHolidayText(v) {
  return HOLIDAY_RE.test(String(v == null ? '' : v));
}
function timeStart(text) {
  const m = String(text || '').match(/(\d{1,2})\s*[:：]\s*(\d{2})/);
  return m ? Number(m[1]) * 60 + Number(m[2]) : Number.MAX_SAFE_INTEGER;
}
function labelNo(label) {
  const m = String(label || '').match(/(\d+)/);
  return m ? Number(m[1]) : 0;
}
function normalizeTime(raw) {
  const m = String(raw == null ? '' : raw).match(/(\d{1,2})\s*[:：]\s*(\d{2})\s*[-~—至]\s*(\d{1,2})\s*[:：]\s*(\d{2})/);
  if (m) return `${pad2(m[1])}:${m[2]}-${pad2(m[3])}:${m[4]}`;
  return String(raw == null ? '' : raw).trim().slice(0, 24);
}
function splitTimeRange(text) {
  const m = String(text == null ? '' : text).match(/(\d{1,2})\s*[:：]\s*(\d{2})\s*[-~—至]\s*(\d{1,2})\s*[:：]\s*(\d{2})/);
  if (!m) return ['', ''];
  return [`${pad2(m[1])}:${m[2]}`, `${pad2(m[3])}:${m[4]}`];
}
function joinTimeRange(start, end) {
  const s = String(start == null ? '' : start).trim();
  const e = String(end == null ? '' : end).trim();
  if (s && e) return `${s}-${e}`;
  return s || e;
}
function normalizeLabel(raw, fallback) {
  const s = String(raw == null ? '' : raw).replace(/\s/g, '');
  const m = s.match(/第?(\d+)节/);
  if (m) return `第${m[1]}节`;
  return (s || `第${fallback}节`).slice(0, 12);
}
function normalizeDateValue(v) {
  const s = String(v == null ? '' : v).trim();
  let m = s.match(/(\d{4})\s*[-/.年]\s*(\d{1,2})\s*[-/.月]\s*(\d{1,2})/);
  if (m) return `${m[1]}-${pad2(m[2])}-${pad2(m[3])}`;
  m = s.match(/^(\d{1,2})\s*[-/.月]\s*(\d{1,2})\s*日?$/);
  if (m) return `${new Date().getFullYear()}-${pad2(m[1])}-${pad2(m[2])}`;
  return '';
}
function cleanRows(rows) {
  return (rows || [])
    .map((r) => (Array.isArray(r) ? r.map((c) => String(c == null ? '' : c).trim()) : []))
    .filter((r) => r.some(Boolean));
}
function defaultWeekendSeed() {
  const times = ['08:20-09:00', '09:10-09:50', '10:00-10:40', '10:50-11:20', '14:10-14:50', '15:00-15:40', '15:50-16:30', '16:40-17:20'];
  return {
    enabled: false,
    variable: false,
    periods: times.map((time, i) => ({
      id: 'w' + (i + 1),
      label: `第${i + 1}节`,
      times: [time, time],
      cells: ['', '']
    })),
    entries: []
  };
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
    state.data.timetable = {
      title: '我的课程表',
      days: DAYS.slice(),
      periods: [],
      weekend: defaultWeekendSeed()
    };
  }
  ensureWeekend();
  renderAll();
  bind();
}

function periods() {
  return (state.data && state.data.timetable && state.data.timetable.periods) || [];
}

function ensureWeekend() {
  const t = state.data && state.data.timetable;
  if (!t) return defaultWeekendSeed();
  if (!t.weekend || typeof t.weekend !== 'object') t.weekend = defaultWeekendSeed();
  if (!Array.isArray(t.weekend.periods)) t.weekend.periods = defaultWeekendSeed().periods;
  if (!Array.isArray(t.weekend.entries)) t.weekend.entries = [];
  const stamp = Date.now().toString(36);
  t.weekend.periods.forEach((p, i) => {
    if (!p.id) p.id = `w${i}_${stamp}`;
  });
  t.weekend.entries.forEach((e, i) => {
    if (!e.id) e.id = `we${i}_${stamp}`;
  });
  return t.weekend;
}
function weekendPeriods() {
  return ensureWeekend().periods || [];
}
function weekendEntries() {
  return ensureWeekend().entries || [];
}

function renderAll() {
  renderTable();
  renderWeekend();
}

function renderTable() {
  const t = state.data.timetable;
  const w = ensureWeekend();
  const enabled = !!w.enabled;
  $('ttTitle').value = t.title || '我的课程表';
  $('weekendEnabled').checked = enabled;
  $('weekendVariable').checked = !!w.variable;
  $('weekendBadge').hidden = !enabled;
  document.body.classList.toggle('tt-has-weekend', enabled);
  $('ttWeekdayLabel').textContent = enabled ? '周一至周五' : '周一至周日';
  $('ttWeekdayTip').textContent = enabled ? '工作日固定课程 · 周末已单独启用' : '固定课程（未启用周末作息）';

  const list = periods();
  const shown = list.filter((p) => state.showNight || !p.night).length;
  let countText = `工作日 ${shown} 节`;
  if (enabled) {
    countText += ` · 周末 ${weekendPeriods().length} 节`;
    if (w.variable) countText += ` · 课程不固定 ${weekendEntries().length} 条`;
  }
  $('ttCount').textContent = countText;

  const cols = enabled ? 5 : 7;
  const shownDays = DAYS.slice(0, cols);
  const head = `<thead><tr>
      <th>节次</th><th>时间</th>
      ${shownDays.map((d) => `<th>${d}</th>`).join('')}
      <th></th>
    </tr></thead>`;

  const body = list.map((p, pi) => {
    if (p.night && !state.showNight) return '';
    return `<tr data-pi="${pi}" class="${p.night ? 'tt-night' : ''}">
      <td><input class="tt-input tt-input--label" data-role="label" value="${esc(p.label)}" />${p.night ? '<i class="tt-night-flag">晚</i>' : ''}</td>
      <td><input class="tt-input tt-input--time" data-role="time" value="${esc(p.time)}" placeholder="08:00-08:45" /></td>
      ${shownDays.map((d, di) => `<td><input class="tt-input tt-input--cell" data-role="cell" data-di="${di}" value="${esc((p.cells && p.cells[di]) || '')}" /></td>`).join('')}
      <td><button class="tt-del" data-role="del" title="删除这一节">×</button></td>
    </tr>`;
  }).join('');

  $('ttTable').innerHTML = head + `<tbody>${body || `<tr><td colspan="${cols + 3}" class="tt-empty">还没有课次，点击右上角「＋ 加一节」</td></tr>`}</tbody>`;
  $('ttWeekend').hidden = !enabled;
}

function renderWeekend() {
  const w = ensureWeekend();
  if (!w.enabled) {
    $('ttWeekendVariablePanel').hidden = true;
    return;
  }
  $('ttWeekendVariablePanel').hidden = !w.variable;

  const list = weekendPeriods();
  const satFlags = holidayFlags(list, 0);
  const sunFlags = holidayFlags(list, 1);
  const head = `<thead><tr>
      <th>节次</th><th>周六时间</th><th>周日时间</th><th>周六课程</th><th>周日课程</th><th></th>
    </tr></thead>`;
  const body = list.map((p, pi) => {
    const satH = satFlags[pi];
    const sunH = sunFlags[pi];
    const times = Array.isArray(p.times) ? p.times : [];
    const cells = Array.isArray(p.cells) ? p.cells : [];
    const satRange = splitTimeRange(times[0]);
    const sunRange = splitTimeRange(times[1]);
    return `<tr data-wpi="${pi}">
      <td><input class="tt-input tt-input--label" data-role="label" value="${esc(p.label)}" />${satH || sunH ? '<i class="tt-holiday-flag">假</i>' : ''}</td>
      <td class="tt-time-cell">
        <input class="tt-input tt-input--time-part" type="time" data-role="satStart" value="${esc(satRange[0])}" aria-label="周六开始时间" />
        <span class="tt-time-dash">-</span>
        <input class="tt-input tt-input--time-part" type="time" data-role="satEnd" value="${esc(satRange[1])}" aria-label="周六结束时间" />
      </td>
      <td class="tt-time-cell">
        <input class="tt-input tt-input--time-part" type="time" data-role="sunStart" value="${esc(sunRange[0])}" aria-label="周日开始时间" />
        <span class="tt-time-dash">-</span>
        <input class="tt-input tt-input--time-part" type="time" data-role="sunEnd" value="${esc(sunRange[1])}" aria-label="周日结束时间" />
      </td>
      <td class="${satH ? 'tt-holiday-cell' : ''}"><input class="tt-input tt-input--cell" data-role="satCell" value="${esc(cells[0] || '')}" /></td>
      <td class="${sunH ? 'tt-holiday-cell' : ''}"><input class="tt-input tt-input--cell" data-role="sunCell" value="${esc(cells[1] || '')}" /></td>
      <td><button class="tt-del" data-role="del" title="删除这一节">×</button></td>
    </tr>`;
  }).join('');
  $('ttWeekendTable').innerHTML = head + `<tbody>${body || `<tr><td colspan="6" class="tt-empty">还没有周末课次，点击「＋ 周末课次」</td></tr>`}</tbody>`;

  const entries = markEntryHolidays(weekendEntries());
  $('ttWeekendDatesCount').textContent = `共 ${entries.length} 条`;
  const dateHead = `<thead><tr>
      <th>日期</th><th>节次</th><th>时间</th><th>课程</th><th></th>
    </tr></thead>`;
  const dateBody = entries.map(({ entry, holiday }) => {
    const range = splitTimeRange(entry.time);
    return `<tr data-eid="${esc(entry.id)}">
      <td><input class="tt-input tt-input--date" type="date" data-role="date" value="${esc(entry.date)}" /></td>
      <td><input class="tt-input tt-input--label" data-role="label" value="${esc(entry.label)}" /></td>
      <td class="tt-time-cell">
        <input class="tt-input tt-input--time-part" type="time" data-role="startTime" value="${esc(range[0])}" aria-label="开始时间" />
        <span class="tt-time-dash">-</span>
        <input class="tt-input tt-input--time-part" type="time" data-role="endTime" value="${esc(range[1])}" aria-label="结束时间" />
      </td>
      <td class="${holiday ? 'tt-holiday-cell' : ''}"><input class="tt-input tt-input--cell" data-role="subject" value="${esc(entry.subject)}" /></td>
      <td><button class="tt-del" data-role="del" title="删除这一条">×</button></td>
    </tr>`;
  }).join('');
  $('ttWeekendDatesTable').innerHTML = dateHead + `<tbody>${dateBody || '<tr><td colspan="5" class="tt-empty">还没有按日期登记的周末课程</td></tr>'}</tbody>`;
}

/* 从放假关键词开始标假；重新排了具体课程的那一节起恢复上课 */
function holidayFlags(list, col) {
  let on = false;
  return (list || []).map((p) => {
    const text = String((p.cells && p.cells[col]) || '').trim();
    if (isHolidayText(text)) on = true;
    else if (text) on = false;
    return on;
  });
}

function entrySortKey(entry) {
  const start = timeStart(entry.time);
  if (start !== Number.MAX_SAFE_INTEGER) return start;
  const no = labelNo(entry.label);
  return no ? no * 60 : Number.MAX_SAFE_INTEGER;
}

function markEntryHolidays(list) {
  const sorted = (list || []).slice().sort((a, b) =>
    String(a.date).localeCompare(String(b.date)) ||
    (entrySortKey(a) - entrySortKey(b))
  );
  const groups = {};
  sorted.forEach((e) => {
    if (!groups[e.date]) groups[e.date] = [];
    groups[e.date].push(e);
  });
  const flags = new Map();
  Object.keys(groups).forEach((date) => {
    let on = false;
    groups[date].forEach((e) => {
      const subject = String(e.subject || '').trim();
      if (isHolidayText(subject)) on = true;
      else if (subject) on = false;
      flags.set(e, on);
    });
  });
  return sorted.map((entry) => ({ entry, holiday: !!flags.get(entry) }));
}

function scheduleSave() {
  clearTimeout(state.saveTimer);
  state.saveTimer = setTimeout(saveTimetable, 450);
}

async function saveTimetable() {
  if (!state.data || !state.data.timetable) return;
  const before = [periods().length, weekendPeriods().length, weekendEntries().length].join('|');
  try {
    const res = await bridge.classroomSaveTimetable(state.data.timetable);
    if (res && res.ok && res.timetable) {
      state.data.timetable = res.timetable;
      ensureWeekend();
      const after = [periods().length, weekendPeriods().length, weekendEntries().length].join('|');
      // 主进程归一化可能删除无效日期或超出上限的课次，数量变化时同步刷新
      if (before !== after) renderAll();
    }
  } catch (e) { /* 下次编辑会重试 */ }
}

function bind() {
  let leaving = false;
  const goHome = () => {
    if (leaving) return;
    leaving = true;
    try { bridge.closeTimetable(); } catch (e) { /* 忽略 */ }
  };
  $('btnBackHome').addEventListener('click', goHome);
  // 触摸屏 / 部分输入法下 click 可能不触发，补一个 pointerup 兜底
  $('btnBackHome').addEventListener('pointerup', goHome);

  $('showNight').addEventListener('change', (e) => {
    state.showNight = !!e.target.checked;
    try { localStorage.setItem('tt-show-night', state.showNight ? '1' : '0'); } catch (err) { /* 忽略 */ }
    renderTable();
  });

  $('weekendEnabled').addEventListener('change', (e) => {
    const w = ensureWeekend();
    w.enabled = !!e.target.checked;
    if (w.enabled && !w.periods.length) w.periods = defaultWeekendSeed().periods;
    renderAll();
    saveTimetable();
    toast(w.enabled ? '已启用周末作息，工作日与周末分开显示' : '已关闭周末作息');
  });

  $('weekendVariable').addEventListener('change', (e) => {
    const w = ensureWeekend();
    const on = !!e.target.checked;
    w.variable = on;
    if (on && !w.enabled) {
      w.enabled = true;
      toast('已启用周末课程不固定，可导入按日期的周末课程');
    } else {
      toast(on ? '已启用周末课程不固定' : '已关闭周末课程不固定');
    }
    renderAll();
    saveTimetable();
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

  $('btnWeekendAdd').addEventListener('click', () => {
    const w = ensureWeekend();
    w.periods.push({
      id: 'w' + Date.now().toString(36),
      label: `第${w.periods.length + 1}节`,
      times: ['', ''],
      cells: ['', '']
    });
    renderWeekend();
    scheduleSave();
  });

  const wTable = $('ttWeekendTable');
  wTable.addEventListener('change', (e) => {
    const tr = e.target.closest('tr[data-wpi]');
    if (!tr) return;
    const p = weekendPeriods()[Number(tr.dataset.wpi)];
    if (!p) return;
    const role = e.target.dataset.role;
    if (role === 'label') p.label = e.target.value.slice(0, 12);
    else if (role === 'satStart' || role === 'satEnd' || role === 'sunStart' || role === 'sunEnd') {
      if (!Array.isArray(p.times)) p.times = ['', ''];
      const idx = role === 'satStart' || role === 'satEnd' ? 0 : 1;
      const [start, end] = splitTimeRange(p.times[idx]);
      const nextStart = role === 'satStart' || role === 'sunStart' ? e.target.value : start;
      const nextEnd = role === 'satEnd' || role === 'sunEnd' ? e.target.value : end;
      p.times[idx] = joinTimeRange(nextStart, nextEnd);
    } else if (role === 'satCell' || role === 'sunCell') {
      if (!Array.isArray(p.cells)) p.cells = ['', ''];
      const idx = role === 'satCell' ? 0 : 1;
      const before = isHolidayText(p.cells[idx]);
      p.cells[idx] = e.target.value.slice(0, 30);
      if (before !== isHolidayText(p.cells[idx])) renderWeekend();
    }
    scheduleSave();
  });

  wTable.addEventListener('click', (e) => {
    if (e.target.dataset.role !== 'del') return;
    const tr = e.target.closest('tr[data-wpi]');
    if (!tr) return;
    const idx = Number(tr.dataset.wpi);
    if (!weekendPeriods()[idx]) return;
    weekendPeriods().splice(idx, 1);
    renderWeekend();
    scheduleSave();
  });

  const dTable = $('ttWeekendDatesTable');
  dTable.addEventListener('change', (e) => {
    const tr = e.target.closest('tr[data-eid]');
    if (!tr) return;
    const entry = weekendEntries().find((x) => x.id === tr.dataset.eid);
    if (!entry) return;
    const role = e.target.dataset.role;
    if (role === 'date') {
      entry.date = normalizeDateValue(e.target.value);
      if (!entry.date) {
        toast('日期格式应为 2026-11-14');
        e.target.value = '';
        return;
      }
      renderWeekend();
    } else if (role === 'label') {
      entry.label = e.target.value.slice(0, 12);
      renderWeekend();
    } else if (role === 'startTime' || role === 'endTime') {
      const [start, end] = splitTimeRange(entry.time);
      const nextStart = role === 'startTime' ? e.target.value : start;
      const nextEnd = role === 'endTime' ? e.target.value : end;
      entry.time = joinTimeRange(nextStart, nextEnd);
      renderWeekend();
    } else if (role === 'subject') {
      const before = isHolidayText(entry.subject);
      entry.subject = e.target.value.slice(0, 30);
      if (before !== isHolidayText(entry.subject)) renderWeekend();
    }
    scheduleSave();
  });

  dTable.addEventListener('click', (e) => {
    if (e.target.dataset.role !== 'del') return;
    const tr = e.target.closest('tr[data-eid]');
    if (!tr) return;
    const list = weekendEntries();
    const idx = list.findIndex((x) => x.id === tr.dataset.eid);
    if (idx < 0) return;
    list.splice(idx, 1);
    renderWeekend();
    scheduleSave();
  });

  $('btnTtImport').addEventListener('click', () => openImport('weekday'));
  $('btnWeekendImportFixed').addEventListener('click', () => openImport('weekend-fixed'));
  $('btnWeekendImportVariable').addEventListener('click', () => openImport('weekend-variable'));
  $('btnWeekendImportVariable2').addEventListener('click', () => openImport('weekend-variable'));
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
    state.ttSheets = null;
    $('ttFileName').textContent = file.name;
    const ext = (file.name.split('.').pop() || '').toLowerCase();
    if (ext === 'xlsx' || ext === 'xls') {
      const filePath = bridge.getFilePath ? bridge.getFilePath(file) : '';
      const res = await bridge.classroomParseSheet(filePath);
      if (res && res.ok) {
        state.ttRows = res.rows;
        state.ttSheets = Array.isArray(res.sheets) ? res.sheets : null;
        $('ttImportText').value = '';
        const count = state.ttSheets ? state.ttSheets.length : 1;
        toast(count > 1 ? `已读取 ${count} 个工作表，点击「导入」应用` : '已读取表格，点击「导入」应用');
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
const IMPORT_META = {
  weekday: {
    title: '一键导入工作日课程表',
    target: '工作日课程表',
    desc: '粘贴课表内容，或选择 csv / txt / xlsx 文件。第一行需要包含星期。同一文件带有「周末固定作息」工作表时会一起导入。',
    demo: '节次,时间,周一,周二,周三,周四,周五\n第1节,08:00-08:45,语文,数学,英语,物理,化学\n\n格式二（逐行）：\n周一 第1节 08:00-08:45 语文'
  },
  'weekend-fixed': {
    title: '导入课程固定的周末作息',
    target: '课程固定',
    desc: '每周六、周日课程都一样时使用。支持“周六时间 / 周日时间 / 周六课程 / 周日课程”分列，也可以每行写周六或周日。',
    demo: '节次,周六时间,周日时间,周六课程,周日课程\n第1节,08:20-09:00,08:20-09:00,语文,数学\n第5节,14:10-14:50,14:10-14:50,物理,黄金周末\n\n格式二（逐行）：\n周六 第1节 08:20-09:00 语文\n周日 第5节 14:10-14:50 黄金周末'
  },
  'weekend-variable': {
    title: '导入课程不固定的周末课程',
    target: '课程不固定',
    desc: '每一行填写具体日期、节次、时间和课程，可一次导入整个学期；到对应日期会自动显示当天课程。',
    demo: '日期,节次,时间,课程\n2026-11-14,第1节,08:20-09:00,语文\n2026-11-14,第2节,09:10-09:50,数学\n2026-11-15,第5节,14:10-14:50,黄金周末\n\n格式二（逐行）：\n2026-11-21 第1节 08:20-09:00 英语'
  }
};

function openImport(target) {
  const meta = IMPORT_META[target] || IMPORT_META.weekday;
  state.importTarget = target;
  state.ttRows = null;
  state.ttSheets = null;
  state.ttFile = null;
  $('ttImportTitle').textContent = meta.title;
  $('ttImportTargetLabel').textContent = meta.target;
  $('ttImportDesc').textContent = meta.desc;
  $('ttImportDemo').textContent = meta.demo;
  $('ttImportText').value = '';
  $('ttFileName').textContent = '未选择文件';
  $('ttImportModal').hidden = false;
}

function closeImport() {
  $('ttImportModal').hidden = true;
}

function parseTimetableRows(rows) {
  const clean = cleanRows(rows);
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
      label: normalizeLabel(labelRaw, list.length + 1),
      time: normalizeTime(time),
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
      label: normalizeLabel(labelMatch ? labelMatch[0] : '', list.length + 1),
      time: normalizeTime(timeMatch ? timeMatch[0] : ''),
      night: false,
      cells
    });
  });
  return list;
}

function fixedHeaderMap(header) {
  const map = { label: -1, satTime: -1, sunTime: -1, sharedTime: -1, sat: -1, sun: -1 };
  header.forEach((raw, i) => {
    const c = String(raw || '').replace(/\s/g, '');
    if (/节次|课次/.test(c)) map.label = i;
    else if (/周六.*时间|星期六.*时间/.test(c)) map.satTime = i;
    else if (/周日.*时间|星期日.*时间|周天.*时间/.test(c)) map.sunTime = i;
    else if (/周六|星期六/.test(c)) map.sat = i;
    else if (/周日|星期日|周天/.test(c)) map.sun = i;
    else if (/时间/.test(c)) map.sharedTime = i;
  });
  return map;
}

function parseWeekendFixedRows(rows) {
  const clean = cleanRows(rows);
  if (!clean.length) return [];
  const headerIdx = clean.findIndex((r) =>
    r.some((c) => /周六|星期六|周日|星期日|周天/.test(c)) &&
    r.some((c) => /节次|课次|时间|课程/.test(c))
  );
  if (headerIdx < 0) return [];
  const map = fixedHeaderMap(clean[headerIdx]);
  if (map.sat < 0 && map.sun < 0 && map.satTime < 0 && map.sunTime < 0) return [];

  const list = [];
  for (let i = headerIdx + 1; i < clean.length; i++) {
    const row = clean[i];
    const labelRaw = map.label >= 0
      ? row[map.label]
      : (row.find((c) => /第?\s*\d+\s*节/.test(c)) || '');
    const sharedTime = map.sharedTime >= 0 ? row[map.sharedTime] : '';
    const satTime = normalizeTime(map.satTime >= 0 ? row[map.satTime] : sharedTime);
    const sunTime = normalizeTime(map.sunTime >= 0 ? row[map.sunTime] : sharedTime);
    const satCell = (map.sat >= 0 ? row[map.sat] : '').slice(0, 30);
    const sunCell = (map.sun >= 0 ? row[map.sun] : '').slice(0, 30);
    if (!satCell && !sunCell && !satTime && !sunTime) continue;
    list.push({
      id: 'w' + i + '_' + Date.now().toString(36),
      label: normalizeLabel(labelRaw, list.length + 1),
      times: [satTime, sunTime],
      cells: [satCell, sunCell]
    });
  }
  return list;
}

function parseWeekendFixedText(text) {
  const lines = String(text || '').replace(/\r\n?/g, '\n').split('\n').map((l) => l.trim()).filter(Boolean);
  if (!lines.length) return [];
  const rows = lines.map((l) => l.split(/[,\t，]/).map((c) => c.trim()));
  const grid = parseWeekendFixedRows(rows);
  if (grid.length) return grid;

  const map = new Map();
  lines.forEach((line) => {
    let day = -1;
    if (/周六|星期六/.test(line)) day = 0;
    else if (/周日|星期日|周天/.test(line)) day = 1;
    if (day < 0) return;
    const labelMatch = line.match(/第?\s*\d+\s*节/);
    const timeMatch = line.match(/\d{1,2}\s*[:：]\s*\d{2}\s*[-~—至]\s*\d{1,2}\s*[:：]\s*\d{2}/);
    const label = normalizeLabel(labelMatch ? labelMatch[0] : '', map.size + 1);
    let subject = line
      .replace(/周六|星期六|周日|星期日|周天/g, ' ')
      .replace(/\d{1,2}\s*[:：]\s*\d{2}\s*[-~—至]\s*\d{1,2}\s*[:：]\s*\d{2}/g, ' ')
      .replace(/第?\s*\d+\s*节/g, ' ')
      .replace(/[\s,，;；\t]+/g, ' ')
      .trim()
      .slice(0, 30);
    if (!map.has(label)) {
      map.set(label, { id: 'w_' + map.size + '_' + Date.now().toString(36), label, times: ['', ''], cells: ['', ''] });
    }
    const p = map.get(label);
    p.times[day] = normalizeTime(timeMatch ? timeMatch[0] : '');
    p.cells[day] = subject;
  });
  return Array.from(map.values()).sort((a, b) => labelNo(a.label) - labelNo(b.label));
}

function parseWeekendEntryRows(rows) {
  const clean = cleanRows(rows);
  if (!clean.length) return [];
  let headerIdx = -1;
  const map = { date: -1, label: -1, time: -1, subject: -1 };
  for (let i = 0; i < Math.min(clean.length, 8); i++) {
    const h = clean[i].map((c) => c.replace(/\s/g, ''));
    if (!h.some((c) => /日期|date/i.test(c)) && !h.some((c) => /课程|科目|内容|学科/.test(c))) continue;
    headerIdx = i;
    h.forEach((c, j) => {
      if (/日期|date/i.test(c)) map.date = j;
      else if (/节次|课次/.test(c)) map.label = j;
      else if (/时间/.test(c)) map.time = j;
      else if (/课程|科目|内容|学科/.test(c)) map.subject = j;
    });
    break;
  }

  const list = [];
  const seen = new Set();
  const start = headerIdx >= 0 ? headerIdx + 1 : 0;
  for (let i = start; i < clean.length; i++) {
    const row = clean[i];
    let date = map.date >= 0 ? normalizeDateValue(row[map.date]) : '';
    let dateIdx = map.date;
    if (!date) {
      row.forEach((c, idx) => {
        if (date) return;
        const d = normalizeDateValue(c);
        if (d) {
          date = d;
          dateIdx = idx;
        }
      });
    }
    if (!date) continue;
    const rest = row.filter((c, idx) => idx !== dateIdx && c);
    const label = map.label >= 0
      ? normalizeLabel(row[map.label], list.length + 1)
      : normalizeLabel((rest.find((c) => /第?\s*\d+\s*节/.test(c)) || ''), list.length + 1);
    const time = normalizeTime(map.time >= 0 ? row[map.time] : (rest.find((c) => /\d{1,2}\s*[:：]\s*\d{2}/.test(c)) || ''));
    let subject = map.subject >= 0 ? String(row[map.subject] || '') : '';
    if (!subject) {
      subject = rest
        .filter((c) => !/第?\s*\d+\s*节/.test(c) && !/\d{1,2}\s*[:：]\s*\d{2}/.test(c))
        .join(' ');
    }
    subject = subject.trim().slice(0, 30);
    if (!subject && !time) continue;
    const key = `${date}|${label}|${time}|${subject}`;
    if (seen.has(key)) continue;
    seen.add(key);
    list.push({
      id: 'we' + i + '_' + Date.now().toString(36),
      date,
      label,
      time,
      subject
    });
  }
  return list.sort((a, b) =>
    a.date.localeCompare(b.date) ||
    (timeStart(a.time) - timeStart(b.time)) ||
    (labelNo(a.label) - labelNo(b.label))
  );
}

function parseWeekendEntryText(text) {
  const lines = String(text || '').replace(/\r\n?/g, '\n').split('\n').map((l) => l.trim()).filter(Boolean);
  if (!lines.length) return [];
  const rows = lines.map((l) => l.split(/[,\t，]/).map((c) => c.trim()));
  const grid = parseWeekendEntryRows(rows);
  if (grid.length) return grid;

  const list = [];
  lines.forEach((line, i) => {
    const dm = line.match(/(\d{4})\s*[-/.年]\s*(\d{1,2})\s*[-/.月]\s*(\d{1,2})/);
    if (!dm) return;
    const date = normalizeDateValue(dm[0]);
    if (!date) return;
    const labelMatch = line.match(/第?\s*\d+\s*节/);
    const timeMatch = line.match(/\d{1,2}\s*[:：]\s*\d{2}\s*[-~—至]\s*\d{1,2}\s*[:：]\s*\d{2}/);
    const subject = line
      .replace(dm[0], ' ')
      .replace(/\d{1,2}\s*[:：]\s*\d{2}\s*[-~—至]\s*\d{1,2}\s*[:：]\s*\d{2}/g, ' ')
      .replace(/第?\s*\d+\s*节/g, ' ')
      .replace(/[\s,，;；\t]+/g, ' ')
      .trim()
      .slice(0, 30);
    if (!subject) return;
    list.push({
      id: 'we' + i + '_' + Date.now().toString(36),
      date,
      label: normalizeLabel(labelMatch ? labelMatch[0] : '', list.length + 1),
      time: normalizeTime(timeMatch ? timeMatch[0] : ''),
      subject
    });
  });
  return list;
}

function importSheets() {
  if (state.ttSheets && state.ttSheets.length) {
    return state.ttSheets.map((s) => ({ name: s.name || '', rows: Array.isArray(s.rows) ? s.rows : [] }));
  }
  if (state.ttRows) return [{ name: '', rows: state.ttRows }];
  return [];
}

function parseSheetForTarget(rows, target) {
  if (target === 'weekday') return parseTimetableRows(rows);
  if (target === 'weekend-fixed') return parseWeekendFixedRows(rows);
  return parseWeekendEntryRows(rows);
}

function parseTextForTarget(text, target) {
  if (target === 'weekday') return parseTimetableText(text);
  if (target === 'weekend-fixed') return parseWeekendFixedText(text);
  return parseWeekendEntryText(text);
}

async function doImport() {
  const target = state.importTarget;
  const sheets = importSheets();
  const text = $('ttImportText').value;
  let list = [];

  if (sheets.length) {
    for (const sheet of sheets) {
      list = parseSheetForTarget(sheet.rows, target);
      if (!list.length) list = parseTextForTarget(sheet.rows.map((r) => r.join(' ')).join('\n'), target);
      if (list.length) break;
    }
  } else {
    list = parseTextForTarget(text, target);
  }

  if (!list.length) {
    toast('没有解析到课程，请检查格式后重试');
    return;
  }

  let weekendFixed = [];
  if (target === 'weekday' && sheets.length) {
    // 一键导入工作日表格时，如果同一文件里带有“周末固定作息”工作表，一并导入
    for (const sheet of sheets) {
      if (parseTimetableRows(sheet.rows).length) continue;
      weekendFixed = parseWeekendFixedRows(sheet.rows);
      if (weekendFixed.length) break;
    }
  }

  if (target === 'weekday') {
    state.data.timetable.periods = list;
    if (weekendFixed.length) {
      const w = ensureWeekend();
      w.periods = weekendFixed;
      w.enabled = true;
    }
  } else if (target === 'weekend-fixed') {
    const w = ensureWeekend();
    w.periods = list;
    w.enabled = true;
  } else {
    const w = ensureWeekend();
    w.entries = list;
    w.enabled = true;
    w.variable = true;
  }

  renderAll();
  await saveTimetable();
  closeImport();
  if (target === 'weekday' && weekendFixed.length) {
    toast(`已导入工作日 ${list.length} 节 + 周末 ${weekendFixed.length} 节`);
  } else {
    const unit = target === 'weekend-variable' ? '条周末课程' : '节课程';
    toast(`已导入 ${list.length} ${unit}`);
  }
}

boot();
