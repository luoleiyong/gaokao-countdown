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
  importTarget: 'weekday',
  ttAi: { images: [], text: '', parsed: null, target: 'weekday', busy: false, model: '' }
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
  // Excel 日期序列号（未套用日期格式时会出现）
  if (/^\d{5}(\.\d+)?$/.test(s)) {
    const d = new Date(Date.UTC(1899, 11, 30) + Math.floor(Number(s)) * 86400000);
    if (!Number.isNaN(d.getTime())) {
      return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
    }
  }
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
    const range = splitTimeRange(p.time);
    return `<tr data-pi="${pi}" class="${p.night ? 'tt-night' : ''}">
      <td><input class="tt-input tt-input--label" data-role="label" value="${esc(p.label)}" />${p.night ? '<i class="tt-night-flag">晚</i>' : ''}</td>
      <td class="tt-time-cell">
        <input class="tt-input tt-input--time-part" type="time" data-role="startTime" value="${esc(range[0])}" aria-label="开始时间" />
        <span class="tt-time-dash">-</span>
        <input class="tt-input tt-input--time-part" type="time" data-role="endTime" value="${esc(range[1])}" aria-label="结束时间" />
      </td>
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
      <td><input class="tt-input tt-input--label" data-role="label" value="${esc(p.label)}" /></td>
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
    else if (role === 'startTime' || role === 'endTime') {
      const [start, end] = splitTimeRange(p.time);
      const nextStart = role === 'startTime' ? e.target.value : start;
      const nextEnd = role === 'endTime' ? e.target.value : end;
      p.time = joinTimeRange(nextStart, nextEnd);
    } else if (role === 'cell') {
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
  $('btnTtAiImport').addEventListener('click', openTtAi);
  $('btnTtAiAdd').addEventListener('click', () => $('ttAiFile').click());
  $('ttAiDrop').addEventListener('click', () => $('ttAiFile').click());
  $('btnTtAiRepick').addEventListener('click', () => {
    if (state.ttAi.busy) return;
    state.ttAi.images = [];
    resetTtAiResult();
    ttAiRenderImages();
    ttAiStep(1);
    setTtAiStatus('图片只在识别时发送给免费模型，识别后不会留存。', '');
  });
  $('btnTtAiRefreshModels').addEventListener('click', async () => {
    const btn = $('btnTtAiRefreshModels');
    btn.disabled = true;
    ttAiModelsLoaded = false;
    await loadTtAiModels(true);
    btn.disabled = false;
    toast('模型清单已刷新');
  });
  $('ttAiFile').addEventListener('change', async (e) => {
    const files = e.target.files ? Array.from(e.target.files) : [];
    e.target.value = '';
    if (files.length) await ttAiAttachFiles(files);
  });
  $('btnTtAiRun').addEventListener('click', runTtAi);
  $('btnTtAiApply').addEventListener('click', applyTtAi);
  $('btnTtAiToText').addEventListener('click', ttAiToText);
  $('ttAiModelBtn').addEventListener('click', () => toggleTtAiModelMenu());
  document.addEventListener('click', (e) => {
    const picker = $('ttAiPicker');
    if (picker && !picker.contains(e.target)) closeTtAiModelMenu();
  });
  $('ttAiStripTeacher').addEventListener('change', () => {
    if (!state.ttAi.text) return;
    state.ttAi.parsed = ttAiCleanList(parseTextForTarget(state.ttAi.text, state.ttAi.target), state.ttAi.target);
    if (state.ttAi.parsed.length) {
      $('ttAiResult').textContent = '✓ 已识别 ' + state.ttAi.parsed.length + ' 节';
      $('btnTtAiApply').hidden = false;
      setTtAiStatus('已按当前设置重新整理，共 ' + state.ttAi.parsed.length + ' 节。', 'ok');
    }
  });
  document.querySelectorAll('#ttAiTarget button').forEach((b) => {
    b.addEventListener('click', () => {
      state.ttAi.target = b.dataset.target || 'weekday';
      document.querySelectorAll('#ttAiTarget button').forEach((x) => x.classList.toggle('is-on', x === b));
      resetTtAiResult();
      if (state.ttAi.images.length) setTtAiStatus('已切换导入目标，点「开始识别」重新识别。', '');
    });
  });
  document.querySelectorAll('[data-close="tt-ai"]').forEach((el) => {
    el.addEventListener('click', closeTtAi);
  });
  const aiStage = $('ttAiStage');
  aiStage.addEventListener('dragover', (e) => { e.preventDefault(); aiStage.classList.add('is-drag'); });
  aiStage.addEventListener('dragleave', () => aiStage.classList.remove('is-drag'));
  aiStage.addEventListener('drop', async (e) => {
    e.preventDefault();
    aiStage.classList.remove('is-drag');
    const files = e.dataTransfer && e.dataTransfer.files ? Array.from(e.dataTransfer.files) : [];
    if (files.length) await ttAiAttachFiles(files);
  });
  document.addEventListener('paste', (e) => {
    if ($('ttAiModal').hidden) return;
    const items = e.clipboardData && e.clipboardData.items;
    if (!items) return;
    const files = [];
    for (let i = 0; i < items.length; i++) {
      if (items[i].type && items[i].type.indexOf('image/') === 0) {
        const file = items[i].getAsFile();
        if (file) files.push(file);
      }
    }
    if (files.length) ttAiAttachFiles(files);
  });
  $('btnImportTips').addEventListener('click', openTips);
  $('btnCopyTips').addEventListener('click', copyTips);
  document.querySelectorAll('[data-close="tips"]').forEach((el) => {
    el.addEventListener('click', closeTips);
  });
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
      if (!$('ttAiModelMenu').hidden) closeTtAiModelMenu();
      else if (!$('ttAiModal').hidden) closeTtAi();
      else if (!$('ttTipsModal').hidden) closeTips();
      else if (!$('ttImportModal').hidden) closeImport();
      else bridge.closeTimetable();
    }
  });
}

/* ---------------- AI 识图导入 ---------------- */
let ttAiModelsLoaded = false;
const TT_AI_MAX_IMAGES = 4;
const TT_SUBJECT_WORDS = [
  '语文', '数学', '英语', '外语', '物理', '化学', '生物', '政治', '历史', '地理',
  '体育', '音乐', '美术', '信息', '通用', '日语', '俄语', '班会', '自习', '劳动',
  '心理', '综合', '校本', '科学', '道德', '法治', '编程', '阅读', '写作', '答疑',
  '社团', '活动', '技术', '艺术'
];
const TT_KEEP_TAIL = /^(教育|健康|课|课程|课表|活动|实践|实验|社团|讲座|辅导|训练|竞赛|考试|测试|自习|阅读|写作|劳动|跑操|锻炼|欣赏|设计|技术|基础|复习|讲评|练习|研讨|拓展|选修|必修|班会|答疑|心理|安全|德育|美育|体育|音乐|美术|信息|通用|综合|科学|道德|法治|编程|口语|听力|作文|操作|实训|实习|研学|军训|升旗|例会|值日)/;

function setTtAiStatus(text, kind) {
  const el = $('ttAiStatus');
  if (!el) return;
  el.innerHTML = '<i></i>' + esc(text);
  el.classList.toggle('is-busy', kind === 'busy');
  el.classList.toggle('is-ok', kind === 'ok');
  el.classList.toggle('is-err', kind === 'err');
}

function ttAiStep(n) {
  const box = $('ttAiSteps');
  if (!box) return;
  box.querySelectorAll('span').forEach((s) => {
    const step = Number(s.dataset.step);
    s.classList.toggle('is-on', step === n);
    s.classList.toggle('is-done', step < n);
  });
}

/* 模型下拉：自绘列表，避免原生 select 弹层与主题不一致 */
function closeTtAiModelMenu() {
  const menu = $('ttAiModelMenu');
  const picker = $('ttAiPicker');
  const btn = $('ttAiModelBtn');
  if (!menu || menu.hidden) return;
  menu.hidden = true;
  if (picker) picker.classList.remove('is-open');
  if (btn) btn.setAttribute('aria-expanded', 'false');
}

function toggleTtAiModelMenu(force) {
  const menu = $('ttAiModelMenu');
  const picker = $('ttAiPicker');
  const btn = $('ttAiModelBtn');
  if (!menu || !picker || !btn) return;
  const open = typeof force === 'boolean' ? force : menu.hidden;
  menu.hidden = !open;
  picker.classList.toggle('is-open', open);
  btn.setAttribute('aria-expanded', open ? 'true' : 'false');
  if (open) {
    const on = menu.querySelector('.tt-ai-picker__opt.is-on');
    if (on && on.scrollIntoView) on.scrollIntoView({ block: 'nearest' });
  }
}

function setTtAiModel(id) {
  state.ttAi.model = String(id || '');
  try { localStorage.setItem('tt-ai-model', state.ttAi.model); } catch (e) { /* 忽略 */ }
  const label = $('ttAiModelLabel');
  const found = (state.ttAi.modelOptions || []).find((m) => m.id === state.ttAi.model);
  if (label) label.textContent = found ? found.name : '自动选择（推荐）';
  document.querySelectorAll('#ttAiModelMenu [data-model]').forEach((el) => {
    const on = el.dataset.model === state.ttAi.model;
    el.classList.toggle('is-on', on);
    el.setAttribute('aria-selected', on ? 'true' : 'false');
  });
}

/* 模型清单：本机已知的视觉模型 + 自定义模型 + 网关实时清单，任一来源失败都不影响其它来源 */
async function loadTtAiModels(force) {
  if (!bridge) return;
  if (ttAiModelsLoaded && !force) return;
  const menu = $('ttAiModelMenu');
  if (!menu) return;
  ttAiModelsLoaded = true;
  let saved = '';
  try { saved = localStorage.getItem('tt-ai-model') || ''; } catch (e) { saved = ''; }
  const prev = state.ttAi.model || saved;
  const groups = new Map();
  const seen = new Set();
  const add = (label, id, name, free) => {
    const mid = String(id || '').trim();
    if (!mid || seen.has(mid)) return;
    seen.add(mid);
    if (!groups.has(label)) groups.set(label, []);
    groups.get(label).push({ id: mid, name: String(name || mid), free: !!free });
  };
  try {
    const cfg = await bridge.aiConfig();
    if (cfg && cfg.ok !== false) {
      (cfg.providers || []).forEach((p) => {
        (p.models || []).forEach((m) => {
          if (m && m.vision) add('免费视觉模型', m.id, m.name, m.free);
        });
      });
      (cfg.customModels || []).forEach((id) => add('自定义模型', id, id));
      if (cfg.model) add('当前设置', cfg.model, cfg.model);
    }
  } catch (e) { /* 忽略 */ }
  try {
    const res = await bridge.aiListModels();
    if (res && res.ok && Array.isArray(res.models)) {
      res.models.filter((m) => m && m.id && m.vision)
        .forEach((m) => add('网关视觉模型', m.id, m.name, m.free));
    }
  } catch (e) { /* 忽略 */ }

  state.ttAi.modelOptions = [{ id: '', name: '自动选择（推荐）' }]
    .concat(Array.from(groups.values()).flat());
  const frag = document.createDocumentFragment();
  const makeOpt = (it) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'tt-ai-picker__opt';
    b.dataset.model = it.id;
    b.setAttribute('role', 'option');
    b.setAttribute('aria-selected', 'false');
    const check = document.createElement('span');
    check.className = 'tt-ai-picker__check';
    check.textContent = '✓';
    const name = document.createElement('span');
    name.className = 'tt-ai-picker__name';
    name.textContent = it.name;
    b.appendChild(check);
    b.appendChild(name);
    if (it.free) {
      const free = document.createElement('em');
      free.textContent = '免费';
      b.appendChild(free);
    }
    b.addEventListener('click', () => {
      setTtAiModel(it.id);
      closeTtAiModelMenu();
      const btn = $('ttAiModelBtn');
      if (btn) btn.focus();
    });
    return b;
  };
  frag.appendChild(makeOpt({ id: '', name: '自动选择（推荐）' }));
  groups.forEach((items, label) => {
    const head = document.createElement('div');
    head.className = 'tt-ai-picker__group';
    head.textContent = label;
    frag.appendChild(head);
    items.forEach((it) => frag.appendChild(makeOpt(it)));
  });
  menu.innerHTML = '';
  menu.appendChild(frag);
  if (prev && state.ttAi.modelOptions.some((m) => m.id === prev)) setTtAiModel(prev);
  else setTtAiModel('');
  if (!groups.size) setTtAiStatus('模型清单没拉到时也能用「自动选择」识别。', '');
}

function openTtAi() {
  $('ttAiModal').hidden = false;
  closeTtAiModelMenu();
  loadTtAiModels(false);
  ttAiStep(state.ttAi.images.length ? (state.ttAi.parsed && state.ttAi.parsed.length ? 3 : 2) : 1);
  if (!state.ttAi.images.length) setTtAiStatus('图片只在识别时发送给免费模型，识别后不会留存。', '');
}

function closeTtAi() {
  if (state.ttAi.busy) { toast('正在识别，请稍候'); return; }
  closeTtAiModelMenu();
  $('ttAiModal').hidden = true;
}
function closeTtAiForce() {
  state.ttAi.busy = false;
  closeTtAiModelMenu();
  $('ttAiModal').hidden = true;
}

function ttAiReadImage(file) {
  return new Promise((resolve) => {
    if (!file || !/^image\//.test(String(file.type || ''))) { resolve(''); return; }
    if (file.size > 6 * 1024 * 1024) { toast('图片超过 6 MB，换一张小一点的'); resolve(''); return; }
    const fr = new FileReader();
    fr.onload = () => resolve(String(fr.result || ''));
    fr.onerror = () => resolve('');
    fr.readAsDataURL(file);
  });
}

/* 长边压到 1600 px，减少识别耗时，也避免网关拒收大图 */
function ttAiShrink(dataUrl) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const max = 1600;
      const scale = Math.min(1, max / Math.max(img.width || 1, img.height || 1));
      if (scale >= 1 && dataUrl.length < 1.6 * 1024 * 1024) { resolve(dataUrl); return; }
      try {
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(img.width * scale));
        canvas.height = Math.max(1, Math.round(img.height * scale));
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL('image/jpeg', 0.86));
      } catch (e) { resolve(dataUrl); }
    };
    img.onerror = () => resolve(dataUrl);
    img.src = dataUrl;
  });
}

function resetTtAiResult() {
  state.ttAi.text = '';
  state.ttAi.parsed = null;
  if ($('ttAiResult')) $('ttAiResult').textContent = '';
  if ($('btnTtAiApply')) $('btnTtAiApply').hidden = true;
  if ($('btnTtAiRun')) $('btnTtAiRun').hidden = false;
  if ($('ttAiRaw')) $('ttAiRaw').hidden = true;
  if ($('btnTtAiToText')) $('btnTtAiToText').hidden = true;
}

function ttAiRenderImages() {
  const grid = $('ttAiGrid');
  if (!grid) return;
  grid.innerHTML = '';
  state.ttAi.images.forEach((img, i) => {
    const cell = document.createElement('div');
    cell.className = 'tt-ai-thumb';
    const el = document.createElement('img');
    el.src = img.dataUrl;
    el.alt = img.name;
    const del = document.createElement('button');
    del.type = 'button';
    del.className = 'tt-ai-thumb__del';
    del.textContent = '×';
    del.title = '移除这张';
    del.addEventListener('click', (e) => { e.stopPropagation(); ttAiRemoveImage(i); });
    cell.appendChild(el);
    cell.appendChild(del);
    grid.appendChild(cell);
  });
  $('ttAiPreview').hidden = !state.ttAi.images.length;
  $('ttAiDrop').hidden = state.ttAi.images.length > 0;
  if (state.ttAi.images.length) ttAiStep(state.ttAi.parsed && state.ttAi.parsed.length ? 3 : 2);
}

async function ttAiAttachFiles(files) {
  const arr = Array.from(files || []);
  if (!arr.length) return;
  for (const file of arr) {
    if (state.ttAi.images.length >= TT_AI_MAX_IMAGES) {
      toast('最多 ' + TT_AI_MAX_IMAGES + ' 张图片');
      break;
    }
    const raw = await ttAiReadImage(file);
    if (!raw) continue;
    const dataUrl = await ttAiShrink(raw);
    state.ttAi.images.push({ dataUrl, name: String(file.name || '课程表图片') });
  }
  if (!state.ttAi.images.length) return;
  resetTtAiResult();
  ttAiRenderImages();
  setTtAiStatus('已选 ' + state.ttAi.images.length + ' 张图片，点「开始识别」交给视觉模型。', '');
}

function ttAiRemoveImage(i) {
  if (state.ttAi.busy) return;
  state.ttAi.images.splice(i, 1);
  resetTtAiResult();
  ttAiRenderImages();
  if (!state.ttAi.images.length) {
    ttAiStep(1);
    setTtAiStatus('图片只在识别时发送给免费模型，识别后不会留存。', '');
  } else {
    setTtAiStatus('已选 ' + state.ttAi.images.length + ' 张图片，点「开始识别」交给视觉模型。', '');
  }
}

function cleanTtAiText(text) {
  let s = String(text || '').replace(/\r\n?/g, '\n').trim();
  s = s.replace(/\x60\x60\x60[a-zA-Z]*\s*/g, '').replace(/\x60\x60\x60/g, '').trim();
  const start = s.search(/节次|日期/);
  if (start > 0) s = s.slice(start);
  return s.trim();
}

/* 去掉「语文 王文静」「外语-时平」里的老师姓名，只留课程 */
function stripTtTeacher(v) {
  let s = String(v == null ? '' : v).trim().replace(/\s+/g, ' ');
  if (!s) return '';
  if (s.length > 30) s = s.slice(0, 30);
  s = s.replace(/[（(]\s*[\u4e00-\u9fa5]{2,4}\s*[)）]\s*$/, '').trim();
  const parts = s.split(/[\s/／|·、\-—–]+/).filter(Boolean);
  if (parts.length >= 2) {
    const tail = parts[1];
    if (/^[\u4e00-\u9fa5]{2,4}$/.test(tail) && !TT_KEEP_TAIL.test(tail)) s = parts[0];
  }
  for (const subj of TT_SUBJECT_WORDS) {
    if (s.startsWith(subj)) {
      const rest = s.slice(subj.length);
      if (/^[\u4e00-\u9fa5]{2,4}$/.test(rest) && !TT_KEEP_TAIL.test(rest)) return subj;
      break;
    }
  }
  return s;
}

function ttAiCleanList(list, target) {
  let on = true;
  try { on = $('ttAiStripTeacher').checked; } catch (e) { on = true; }
  if (!on) return list;
  if (target === 'weekend-variable') list.forEach((e) => { e.subject = stripTtTeacher(e.subject); });
  else list.forEach((p) => { p.cells = (p.cells || []).map((c) => stripTtTeacher(c)); });
  return list;
}

async function runTtAi() {
  if (!bridge || !bridge.timetableAiImport) { toast('当前版本不支持 AI 识图'); return; }
  if (!state.ttAi.images.length) { toast('请先选择课程表图片'); return; }
  if (state.ttAi.busy) return;
  state.ttAi.busy = true;
  $('btnTtAiRun').disabled = true;
  $('btnTtAiApply').hidden = true;
  $('ttAiRaw').hidden = true;
  $('btnTtAiToText').hidden = true;
  $('ttAiResult').textContent = '';
  $('ttAiPreview').classList.add('is-scanning');
  ttAiStep(2);
  setTtAiStatus('正在识别 ' + state.ttAi.images.length + ' 张课程表，通常 10–40 秒…', 'busy');
  try {
    const res = await bridge.timetableAiImport({
      images: state.ttAi.images.map((x) => x.dataUrl),
      target: state.ttAi.target,
      model: state.ttAi.model,
      note: $('ttAiNote').value.trim(),
      stripTeacher: !!$('ttAiStripTeacher').checked
    });
    if (!res || !res.ok) {
      setTtAiStatus((res && res.error) || '识别失败，请稍后再试', 'err');
      $('btnTtAiRun').hidden = false;
      return;
    }
    const text = cleanTtAiText(res.text);
    state.ttAi.text = text;
    const list = ttAiCleanList(parseTextForTarget(text, state.ttAi.target), state.ttAi.target);
    state.ttAi.parsed = list;
    if (list.length) {
      setTtAiStatus('识别完成：' + (res.modelName || res.model || '视觉模型') + '，共 ' + list.length + ' 节，确认无误后应用。', 'ok');
      $('ttAiResult').textContent = '✓ 已识别 ' + list.length + ' 节';
      $('btnTtAiApply').hidden = false;
      $('btnTtAiRun').hidden = true;
      ttAiStep(3);
    } else {
      setTtAiStatus('识别完成，但没能解析成课程表格式；可以查看识别文本后手动导入。', 'err');
      $('ttAiRaw').textContent = text.slice(0, 4000);
      $('ttAiRaw').hidden = false;
      $('btnTtAiToText').hidden = false;
      $('btnTtAiRun').hidden = false;
    }
  } catch (e) {
    setTtAiStatus('识别失败：' + e.message, 'err');
    $('btnTtAiRun').hidden = false;
  } finally {
    state.ttAi.busy = false;
    $('btnTtAiRun').disabled = false;
    $('ttAiPreview').classList.remove('is-scanning');
  }
}

function applyTtAi() {
  const list = state.ttAi.parsed || [];
  if (!list.length) { toast('没有可应用的课程'); return; }
  state.importTarget = state.ttAi.target;
  state.ttRows = null;
  state.ttSheets = null;
  state.ttFile = null;
  $('ttImportText').value = state.ttAi.text;
  closeTtAiForce();
  doImport();
}

function ttAiToText() {
  if (!state.ttAi.text) return;
  const target = state.ttAi.target;
  closeTtAiForce();
  openImport(target);
  $('ttImportText').value = state.ttAi.text;
  toast('识别文本已放进导入框，可直接导入');
}


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
    desc: '每一行填写具体日期、节次、时间和课程，可一次导入整个学期；到对应日期会自动显示当天课程。某天只填前几节时，后面的节次会自动按放假处理。',
    demo: '日期,节次,时间,课程\n2026-11-14,第1节,08:20-09:00,物理\n2026-11-14,第2节,09:10-09:50,物理\n2026-11-15,第4节,10:50-11:20,生物\n2026-11-15,第5节,14:10-14:50,放假\n\n格式二（逐行）：\n2026-11-21 第1节 08:20-09:00 英语'
  }
};

const IMPORT_TIPS = `你是课程表整理助手。我会发给你一张课程表图片（或 Excel、PDF、截图）。请把它整理成可以直接导入「高考倒计时」桌面程序的表格：优先输出 CSV 文本；如果平台支持生成 xlsx，请按下面的工作表分别建表，列名必须完全一致。

通用规则：
1. 节次统一写成「第1节、第2节……」，晚自习写「晚自习1」。
2. 时间统一写成 08:00-08:45 这种 24 小时格式，用短横线连接。
3. 同一格有多个科目时用 / 连接；看不清的格子留空，不要猜测。
4. 只输出表格内容和必要的工作表名，不要解释。

【工作表一：工作日】周一至周五固定课程
列名：节次,时间,周一,周二,周三,周四,周五
示例：
节次,时间,周一,周二,周三,周四,周五
第1节,08:00-08:45,语文,数学,英语,物理,化学
第2节,08:55-09:40,数学,语文,物理,英语,生物
说明：一行一节；某天没有课就留空。

【工作表二：周末固定作息】仅当每周六、周日课程完全一样时使用（可选）
列名：节次,周六时间,周日时间,周六课程,周日课程
示例：
节次,周六时间,周日时间,周六课程,周日课程
第1节,08:20-09:00,08:20-09:00,语文,数学
第5节,14:10-14:50,14:10-14:50,物理,黄金周末
说明：某天下午开始放假时，在放假的节次写「放假」，后面的节次不用再写。

【工作表三：周末不固定课程】每周周末课不同、按日期登记时使用（推荐）
列名：日期,节次,时间,课程
示例：
日期,节次,时间,课程
2026-11-14,第1节,08:20-09:00,物理
2026-11-14,第2节,09:10-09:50,物理
2026-11-14,第3节,10:00-10:40,化学
2026-11-14,第4节,10:50-11:20,化学
2026-11-14,第5节,14:10-14:50,生物
2026-11-14,第6节,15:00-15:40,生物
2026-11-14,第7节,15:50-16:30,外语
2026-11-14,第8节,16:40-17:20,外语
2026-11-15,第1节,08:20-09:00,化学
2026-11-15,第2节,09:10-09:50,化学
2026-11-15,第3节,10:00-10:40,生物
2026-11-15,第4节,10:50-11:20,生物
2026-11-15,第5节,14:10-14:50,放假

说明：
- 日期统一写成 2026-11-14 这种格式，每个有课的周末日期都要单独列出。
- 不同周次同一节次的时间保持一致，按学校的周末作息填写。
- 某天只有前几节有课、后面放假：在第一节没课的节次写一条「放假」即可，后面的节次不用再列（程序会自动按放假处理）。
- 如果放假之后晚上还有课，继续正常列出课程，程序会自动恢复上课。
- 整天放假：写一条「第1节,...,放假」即可。
- 如果平台只能生成一个工作表，请优先输出【工作表三】；如果学校周末课程每周相同，输出【工作表二】并说明。
- 只输出我能直接复制的 CSV 文本（或 xlsx 文件），不要输出与表格无关的内容。`;

function openTips() {
  const pre = $('ttTipsText');
  if (pre) pre.textContent = IMPORT_TIPS;
  $('ttTipsModal').hidden = false;
}

function closeTips() {
  $('ttTipsModal').hidden = true;
}

async function copyTips() {
  const text = $('ttTipsText').textContent || '';
  if (!text) return;
  let ok = false;
  try {
    if (bridge && bridge.copyText) {
      const res = await bridge.copyText(text);
      ok = !!(res && res.ok);
    }
  } catch (e) { /* 尝试浏览器剪贴板 */ }
  if (!ok) {
    try {
      await navigator.clipboard.writeText(text);
      ok = true;
    } catch (e) { /* 复制失败 */ }
  }
  toast(ok ? '提示词已复制，粘贴给 AI 即可' : '复制失败，请手动选择文本');
}

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

/* 某天后面没有登记课程时，自动补一条「放假」，让当天剩余节次按放假显示 */
function fillWeekendHolidayEntries(list) {
  if (!list.length) return list;
  const periods = weekendPeriods()
    .slice()
    .sort((a, b) => labelNo(a.label) - labelNo(b.label));
  if (!periods.length) return list;
  const byDate = new Map();
  list.forEach((e) => {
    if (!byDate.has(e.date)) byDate.set(e.date, []);
    byDate.get(e.date).push(e);
  });
  const out = list.slice();
  byDate.forEach((items, date) => {
    const concrete = items.filter((e) => String(e.subject || '').trim() && !isHolidayText(e.subject));
    if (!concrete.length) return;
    const lastNo = Math.max.apply(null, concrete.map((e) => labelNo(e.label)));
    const hasHoliday = items.some((e) => isHolidayText(e.subject) && labelNo(e.label) > lastNo);
    if (hasHoliday) return;
    const next = periods.find((p) => labelNo(p.label) > lastNo);
    if (!next) return;
    const dayIdx = new Date(date + 'T00:00:00').getDay() === 0 ? 1 : 0;
    const times = Array.isArray(next.times) ? next.times : [];
    out.push({
      id: 'we_holiday_' + date + '_' + labelNo(next.label),
      date,
      label: normalizeLabel(next.label, labelNo(next.label)),
      time: normalizeTime(times[dayIdx] || times[0] || ''),
      subject: '放假'
    });
  });
  return out.sort((a, b) =>
    a.date.localeCompare(b.date) ||
    (timeStart(a.time) - timeStart(b.time)) ||
    (labelNo(a.label) - labelNo(b.label))
  );
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
    list = fillWeekendHolidayEntries(list);
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
