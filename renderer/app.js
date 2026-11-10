'use strict';
/* 高考倒计时 · 渲染进程逻辑
   倒计时 / 每日幸运签 / 签运簿 / 设置 / 桌面宠物 / 签卡导出 */

const $ = (id) => document.getElementById(id);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

const SIGNS = Array.isArray(window.SIGNS) ? window.SIGNS : [];
const SIGN_TOTAL = 280;
const LEVEL_ATTR = { '上上签': 'top', '上签': 'high', '中签': 'mid', '静心签': 'calm', '节气签': 'top' };
const SUBJECT_META = [
  { id: 'chinese', name: '语文', color: '#dca0a0' },
  { id: 'math', name: '数学', color: '#b9a8e6' },
  { id: 'english', name: '英语', color: '#9fd0e8' },
  { id: 'japanese', name: '日语', color: '#e3b393' },
  { id: 'physics', name: '物理', color: '#8fc3e8' },
  { id: 'chemistry', name: '化学', color: '#d9b64a' },
  { id: 'biology', name: '生物', color: '#a3d29a' },
  { id: 'politics', name: '政治', color: '#e0a878' },
  { id: 'history', name: '历史', color: '#cfb08a' },
  { id: 'geography', name: '地理', color: '#9cc9a8' }
];
const DEFAULT_SUBJECTS = ['chinese', 'math', 'english', 'physics', 'chemistry', 'biology'];
const SKIN_META = [
  { id: 'board', name: '黑板粉笔', c: ['#22332c', '#d9b64a'] },
  { id: 'starry', name: '星河夜航', c: ['#18203a', '#e6c96c'] },
  { id: 'warm', name: '晨光纸卷', c: ['#efe4cc', '#b07d2b'] },
  { id: 'bamboo', name: '青竹小院', c: ['#dfe9dc', '#6f8a46'] }
];

const state = {
  targetDate: '2027-06-07',
  skin: 'board',
  petScale: 1,
  autoLaunch: false,
  history: [],
  today: '',
  isFirstToday: false,
  mode: 'panel',
  lastDays: null,
  currentEntry: null,
  shaking: false,
  debug: false,
  debugPreview: false,
  onboarded: false,
  onboardAutoLaunch: false,
  weather: null,
  weatherCity: '',
  updateUrl: '',
  updateInfo: null,
  updateDownload: { phase: 'idle', percent: 0, filePath: '', version: '' },
  updateAutoCheck: true,
  updateAutoDownload: true,
  updateLastCheck: '',
  updateBannerDismissed: '',
  updateDeferred: false,
  updateInstallStarted: false,
  version: '',
  selectedSubjects: [],
  historyExpanded: false,
  events: [],
  timetable: null,
  backupAuto: true,
  lastBackupDate: '',
  backupInfo: { count: 0, latest: '' },
  lastCourseKey: ''
};

const bridge = window.gaokao || createMockBridge();

/* ---------------- 小工具 ---------------- */
function pad2(n) { return String(n).padStart(2, '0'); }
function dateKey(d = new Date()) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
function escapeHtml(v) {
  return String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

function fmtTargetCN(target) {
  const wk = '日一二三四五六'[target.getDay()];
  return `${target.getFullYear()}年${target.getMonth() + 1}月${target.getDate()}日 · 周${wk}`;
}
function fmtShort(d) {
  return `${d.getFullYear()}.${pad2(d.getMonth() + 1)}.${pad2(d.getDate())}`;
}
function fmtDayLabel(d = new Date()) {
  const wk = '日一二三四五六'[d.getDay()];
  return `${pad2(d.getMonth() + 1)}.${pad2(d.getDate())} · 周${wk}`;
}
function parseTarget() {
  const [y, m, d] = state.targetDate.split('-').map(Number);
  return new Date(y, m - 1, d, 0, 0, 0, 0);
}

function calc() {
  const now = new Date();
  const target = parseTarget();
  const diff = target.getTime() - now.getTime();
  const secs = Math.max(0, Math.floor(diff / 1000));
  const days = Math.max(0, Math.ceil(diff / 86400000));
  const clock = `${pad2(Math.floor(secs / 3600) % 24)} : ${pad2(Math.floor(secs / 60) % 60)} : ${pad2(secs % 60)}`;
  const start = new Date(target);
  start.setFullYear(start.getFullYear() - 1);
  const total = target.getTime() - start.getTime();
  const progress = total > 0 ? Math.min(100, Math.max(0, ((now - start) / total) * 100)) : 100;
  return { days, clock, progress, target, start, diff };
}

/* 倒计时天数 → 签池索引：13 与 280 互质，280 天内逐日不重复 */
function signIndexFor(days) {
  const d = ((days % SIGN_TOTAL) + SIGN_TOTAL) % SIGN_TOTAL;
  return (d * 13 + 7) % SIGN_TOTAL;
}
function todaySignObj() {
  const term = todayTerm();
  if (term) {
    return {
      no: 0,
      level: '节气签',
      poem: term.poem,
      wish: term.wish,
      tag: '节气',
      term: term.name
    };
  }
  const days = calc().days;
  return SIGNS[signIndexFor(days)] || null;
}
function todayEntry() {
  return state.history.find((h) => h.date === state.today) || null;
}

/* ---------------- 初始化 ---------------- */
async function boot() {
  let init;
  try {
    init = await bridge.getInit();
  } catch (e) {
    console.error('init failed', e);
    init = { store: {}, today: dateKey(), isFirstToday: false, logs: [], powers: [] };
  }
  const s = init.store || {};
  state.targetDate = s.targetDate || '2027-06-07';
  state.skin = s.skin || 'board';
  state.petScale = Number(s.petScale) || 1;
  state.autoLaunch = !!s.autoLaunch;
  state.history = Array.isArray(s.history) ? s.history : [];
  state.today = init.today || dateKey();
  state.isFirstToday = !!init.isFirstToday;
  state.mode = init.mode || 'panel';
  state.updateUrl = s.updateUrl || '';
  state.weatherCity = s.weatherCity || '';
  state.version = init.version || '1.0.0';
  const sel = Array.isArray(s.selectedSubjects) ? s.selectedSubjects : [];
  state.selectedSubjects = sel
    .map((id) => (id === 'foreign' ? 'english' : id))
    .filter((id) => SUBJECT_META.some((x) => x.id === id))
    .slice(0, 6);
  if (!state.selectedSubjects.length) state.selectedSubjects = DEFAULT_SUBJECTS.slice();
  state.events = Array.isArray(s.events) ? s.events.filter((e) => e && e.name && e.date) : [];
  state.timetable = s.timetable && Array.isArray(s.timetable.periods) ? s.timetable : null;
  state.backupAuto = s.backupAuto !== false;
  state.lastBackupDate = s.lastBackupDate || '';
  state.backupInfo = s.backupInfo || { count: 0, latest: '' };
  state.debug = !!s.debugMode;
  state.onboarded = !!s.onboarded;
  state.onboardAutoLaunch = state.autoLaunch;
  state.updateAutoCheck = s.updateAutoCheck !== false;
  state.updateAutoDownload = s.updateAutoDownload !== false;
  try { state.updateBannerDismissed = localStorage.getItem('gk-update-dismissed') || ''; } catch (e) { /* 忽略 */ }

  applySkin(state.skin);
  renderVersion(init.version);
  bindEvents();
  renderSkinGrid();
  renderAll();
  tick();

  bridge.onModeChanged((data) => onModeChanged(data));
  bridge.onSkinChanged((data) => {
    state.skin = data.skin;
    applySkin(state.skin);
    renderSkinGrid();
  });
  bridge.onScaleChanged((data) => {
    state.petScale = Number(data.scale) || state.petScale;
    $('inputScale').value = String(state.petScale);
    $('scaleLabel').textContent = Math.round(state.petScale * 100) + '%';
  });
  bridge.onDebugChanged((data) => {
    state.debug = !!(data && data.on);
  });
  bridge.onDebugPreview(() => {
    state.debugPreview = true;
    state.shaking = false;
    $('drawModal').hidden = true;
    $('firstDraw').hidden = true;
    setTimeout(() => showFirstDraw(true), 80);
  });
  bridge.onUpdateProgress((data) => {
    if (!data) return;
    state.updateDownload.phase = 'downloading';
    state.updateDownload.percent = Number(data.percent) || 0;
    state.updateDownload.version = data.version || state.updateDownload.version;
    renderUpdateUI();
  });
  bridge.onUpdateDownloaded((data) => {
    if (!data) return;
    state.updateDownload.phase = 'ready';
    state.updateDownload.percent = 100;
    state.updateDownload.filePath = data.filePath || '';
    state.updateDownload.version = data.version || state.updateDownload.version;
    renderUpdateUI();
    if (!state.updateInstallStarted && !state.updateDeferred) {
      showUpdateReadyDialog();
    }
  });
  bridge.onUpdateError(() => {
    state.updateDownload.phase = 'error';
    renderUpdateUI();
  });

  setInterval(tick, 1000);

  refreshWeather();
  setInterval(() => refreshWeather(), 10 * 60 * 1000);
  // 自动检测更新（可在设置中关闭），每 6 小时静默检测一次
  if (state.updateAutoCheck) {
    setTimeout(() => checkUpdates(true), 1800);
  }
  setInterval(() => {
    if (state.updateAutoCheck) checkUpdates(true);
  }, 6 * 60 * 60 * 1000);

  // 首次使用先完成配置；之后每天启动若今日尚未抽签，弹出全屏首抽引导
  if (!state.onboarded) {
    setTimeout(() => openOnboarding(), 600);
  } else {
    setTimeout(() => {
      if (todayEntry()) return;
      if (state.mode === 'pet') {
        // 开机自启以桌面宠物启动时，首抽先切回主面板全屏引导
        Promise.resolve(bridge.setPetMode(false)).then(() => {
          setTimeout(() => showFirstDraw(), 300);
        });
      } else {
        showFirstDraw();
      }
    }, 900);
  }
}

/* ---------------- 渲染：倒计时 ---------------- */
function milestoneText(days) {
  if (days <= 0) return '高考已至 · 从容落笔';
  if (days === 1) return '明天就是高考 · 今晚好好休息';
  if (days <= 10) return `最后 ${days} 天 · 回归基础，稳住节奏`;
  if (days <= 30) return `最后一个月 · 专注眼前这一页`;
  if (days <= 100) return `百日之内 · 每天一小步`;
  return '';
}

/* 今天剩余时间（到本地零点） */
function todayRemainClock() {
  const now = new Date();
  const end = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 0, 0);
  const secs = Math.max(0, Math.floor((end.getTime() - now.getTime()) / 1000));
  return `${pad2(Math.floor(secs / 3600))} : ${pad2(Math.floor(secs / 60) % 60)} : ${pad2(secs % 60)}`;
}

function renderCountdown() {
  const c = calc();
  $('daysNum').textContent = c.days;
  $('clock').textContent = todayRemainClock();
  $('targetLabel').textContent = fmtTargetCN(c.target);
  $('progressText').textContent = Math.round(c.progress) + '%';
  $('progressFill').style.width = c.progress.toFixed(1) + '%';
  $('startLabel').textContent = '起点 · ' + fmtShort(c.start);
  $('endLabel').textContent = `${c.target.getMonth() + 1}月${c.target.getDate()}日`;

  const m = milestoneText(c.days);
  const box = $('milestone');
  if (m) {
    if (box.textContent !== m) box.textContent = m;
    box.hidden = false;
  } else {
    box.hidden = true;
  }
  return c;
}

/* ---------------- 渲染：今日签 ---------------- */
function fillSignCard(entry) {
  const levelEl = $('signLevel');
  $('signLevel').textContent = entry.level;
  levelEl.setAttribute('data-level', LEVEL_ATTR[entry.level] || 'mid');
  $('signNo').textContent = entry.term ? entry.term : `第 ${entry.no} 签`;
  const stamp = $('signTermStamp');
  stamp.hidden = !entry.term;
  if (entry.term) stamp.textContent = entry.term;
  const parts = String(entry.poem).split('，');
  $('signPoem').innerHTML = parts.map((p) => `<span>${p}</span>`).join('');
  $('signWish').textContent = entry.wish;
  $('signTag').textContent = entry.tag;
}

function renderToday() {
  const entry = todayEntry();
  $('todayDate').textContent = fmtDayLabel();

  if (entry) {
    $('todayEmpty').hidden = true;
    $('todaySign').hidden = false;
    fillSignCard(entry);
    $('btnDraw').textContent = '查看今日签';
  } else {
    $('todayEmpty').hidden = false;
    $('todaySign').hidden = true;
    $('btnDraw').textContent = '现在就抽取';
  }

  // 由倒计时天数反推点亮的签数：每天点亮一支，到高考当天 280 支全亮
  const days = calc().days;
  const pending = Math.max(0, Math.min(SIGN_TOTAL, days));
  const lit = SIGN_TOTAL - pending;
  $('openCount').textContent = pending === 0
    ? `全部点亮 ${SIGN_TOTAL} / ${SIGN_TOTAL}`
    : `已开启 ${lit} / ${SIGN_TOTAL}`;
  $('waitCount').textContent = pending === 0 ? '待开启 0' : `待开启 ${pending}`;
  $('openCount').setAttribute('data-all', pending === 0 ? '1' : '0');
}

/* ---------------- 渲染：签运簿 ---------------- */
function renderHistory() {
  const list = state.history
    .slice()
    .sort((a, b) => String(b.date).localeCompare(String(a.date)) || (b.ts || 0) - (a.ts || 0));
  $('historyCount').textContent = `${list.length} 条`;

  const box = $('historyList');
  const wrap = box.parentElement;
  const oldMore = wrap ? wrap.querySelector('.history__more') : null;
  if (oldMore) oldMore.remove();
  box.innerHTML = '';

  if (!list.length) {
    box.hidden = true;
    $('historyEmpty').hidden = false;
    return;
  }
  box.hidden = false;
  $('historyEmpty').hidden = true;

  const visible = state.historyExpanded ? list : list.slice(0, 4);
  const frag = document.createDocumentFragment();
  visible.forEach((entry) => {
    const btn = document.createElement('button');
    btn.className = 'hist-item';
    const noLabel = entry.term
      ? `节气 · ${entry.term}`
      : (entry.no ? `第 ${entry.no} 签` : '签');
    btn.innerHTML =
      '<span class="hist-item__top"><span>' +
      entry.date.replace(/-/g, '.') +
      '</span><span class="hist-item__level">' +
      entry.level + ' · ' + noLabel +
      '</span></span>' +
      '<span class="hist-item__poem">' +
      entry.poem +
      '</span>';
    btn.addEventListener('click', () => openSignDetail(entry));
    frag.appendChild(btn);
  });
  box.appendChild(frag);

  if (list.length > 4 && wrap) {
    const more = document.createElement('button');
    more.className = 'history__more';
    more.textContent = state.historyExpanded ? '收起' : `展开更多 ${list.length - 4} 条`;
    more.addEventListener('click', () => {
      state.historyExpanded = !state.historyExpanded;
      renderHistory();
    });
    wrap.appendChild(more);
  }
}

/* ---------------- 渲染：宠物 ---------------- */
/* ---------------- 渲染：重要日子 ---------------- */
function eventDayText(dateStr) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const [y, m, d] = String(dateStr).split('-').map(Number);
  const target = new Date(y, m - 1, d);
  const diff = Math.round((target.getTime() - today.getTime()) / 86400000);
  if (diff === 0) return '今天';
  if (diff === 1) return '明天';
  if (diff > 1) return `${diff} 天后`;
  return `已过 ${-diff} 天`;
}

function sortedEvents() {
  return state.events.slice().sort((a, b) => String(a.date).localeCompare(String(b.date)));
}

function renderEvents() {
  const box = $('eventsList');
  if (!box) return;
  const list = sortedEvents().filter((e) => !eventDayText(e.date).startsWith('已过'));
  box.innerHTML = '';
  if (!list.length) {
    box.innerHTML = '<span class="events-empty">还没有添加事件，点击「管理」添加</span>';
    return;
  }
  list.slice(0, 3).forEach((e) => {
    const row = document.createElement('div');
    row.className = 'event-row' + (eventDayText(e.date) === '今天' ? ' on' : '');
    row.innerHTML =
      `<b>${escapeHtml(e.name)}</b>` +
      `<span>${e.date.replace(/-/g, '.')}</span>` +
      `<em>${eventDayText(e.date)}</em>`;
    box.appendChild(row);
  });
  if (list.length > 3) {
    const more = document.createElement('button');
    more.className = 'events-more';
    more.textContent = `还有 ${list.length - 3} 个事件`;
    more.addEventListener('click', openEventsModal);
    box.appendChild(more);
  }
}

function renderEventManage() {
  const box = $('eventManageList');
  if (!box) return;
  box.innerHTML = '';
  const list = sortedEvents();
  if (!list.length) {
    box.innerHTML = '<p class="hint">还没有添加事件</p>';
    return;
  }
  list.forEach((e) => {
    const row = document.createElement('div');
    row.className = 'event-manage-row';
    row.innerHTML =
      `<span><b>${escapeHtml(e.name)}</b><i>${e.date.replace(/-/g, '.')} · ${eventDayText(e.date)}</i></span>` +
      '<button class="btn-ghost btn-small">删除</button>';
    row.querySelector('button').addEventListener('click', async () => {
      state.events = state.events.filter((x) => x.id !== e.id);
      await persistEvents();
      renderEventManage();
      renderEvents();
      toast('已删除：' + e.name);
    });
    box.appendChild(row);
  });
}

async function persistEvents() {
  try {
    const res = await bridge.saveEvents(state.events);
    if (res && res.ok && Array.isArray(res.events)) state.events = res.events;
  } catch (e) {
    toast('事件保存失败，请重试');
  }
}

function openEventsModal() {
  renderEventManage();
  $('eventsModal').hidden = false;
}

function closeEventsModal() {
  $('eventsModal').hidden = true;
}

async function addEvent() {
  const name = $('eventName').value.trim();
  const date = $('eventDate').value;
  if (!name) return toast('请填写事件名称');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return toast('请选择事件日期');
  if (state.events.length >= 30) return toast('最多添加 30 个事件');
  state.events.push({ id: 'e' + Date.now().toString(36), name: name.slice(0, 30), date });
  $('eventName').value = '';
  await persistEvents();
  renderEvents();
  renderEventManage();
  toast('已添加：' + name);
}

/* ---------------- 渲染：桌面宠物课程 ---------------- */
const PET_MOTTOS = Array.isArray(window.PET_MOTTOS) ? window.PET_MOTTOS : [];

function parseCourseRange(text) {
  const m = String(text || '').match(/(\d{1,2})\s*[:：]\s*(\d{2})\s*[-~—至]\s*(\d{1,2})\s*[:：]\s*(\d{2})/);
  if (!m) return null;
  return { start: Number(m[1]) * 60 + Number(m[2]), end: Number(m[3]) * 60 + Number(m[4]) };
}

function dayPeriods(dayIdx) {
  const t = state.timetable;
  if (!t || !Array.isArray(t.periods)) return [];
  return t.periods.map((p, i) => {
    const subject = String((p.cells && p.cells[dayIdx]) || '').trim();
    const range = parseCourseRange(p.time);
    if (!subject || !range) return null;
    return {
      label: p.label || `第${i + 1}节`,
      subject,
      time: String(p.time),
      start: range.start,
      end: range.end
    };
  }).filter(Boolean).sort((a, b) => a.start - b.start);
}

function petMotto() {
  if (!PET_MOTTOS.length) return '今天也辛苦了，早点休息。';
  const now = new Date();
  const seed = now.getFullYear() * 372 + (now.getMonth() + 1) * 31 + now.getDate();
  return PET_MOTTOS[seed % PET_MOTTOS.length];
}

function courseRowHtml(tag, course, extraClass) {
  return (
    `<div class="pet-course__row${extraClass ? ' ' + extraClass : ''}">` +
    `<span class="pet-course__tag">${tag}</span>` +
    `<b>${escapeHtml(course.subject)}</b>` +
    `<i>${escapeHtml(course.time)}</i>` +
    '</div>'
  );
}

function renderPetCourse() {
  const listEl = $('petCourseList');
  if (!listEl) return;
  const now = new Date();
  const dayIdx = (now.getDay() + 6) % 7;
  const nowMin = now.getHours() * 60 + now.getMinutes();
  const key = `${dayIdx}-${nowMin}-${state.timetable ? state.timetable.periods.length : 0}`;
  if (key === state.lastCourseKey) return;
  state.lastCourseKey = key;

  const today = dayPeriods(dayIdx);
  if (!today.length) {
    $('petCourseDay').textContent = '今天';
    listEl.innerHTML = '<div class="pet-course__empty">今天没有课程，好好休息</div>';
    return;
  }

  const currentIdx = today.findIndex((p) => nowMin >= p.start && nowMin < p.end);
  const upcoming = today.filter((p) => p.start > nowMin);
  const tomorrow = dayPeriods((dayIdx + 1) % 7);
  const rows = [];

  if (currentIdx >= 0) {
    rows.push(courseRowHtml('本节课', today[currentIdx], 'now'));
    const rest = today.slice(currentIdx + 1);
    if (rest.length) {
      rest.slice(0, 2).forEach((p, i) => rows.push(courseRowHtml(i === 0 ? '下节课' : '随后', p, '')));
    } else if (tomorrow.length) {
      rows.push(courseRowHtml('明天', tomorrow[0], 'next-day'));
    }
  } else if (upcoming.length) {
    upcoming.slice(0, 3).forEach((p, i) => rows.push(courseRowHtml(i === 0 ? '下节课' : '随后', p, '')));
  } else {
    // 今日课程全部结束
    $('petCourseDay').textContent = '今天';
    listEl.innerHTML =
      '<div class="pet-course__done"><b>今日课程已完成</b>' +
      `<span>${escapeHtml(petMotto())}</span></div>`;
    return;
  }

  $('petCourseDay').textContent = '今天';
  listEl.innerHTML = rows.join('');
}

function renderPet() {
  const c = calc();
  $('petDays').textContent = c.days;
  $('petTarget').textContent = `${c.target.getFullYear()}.${pad2(c.target.getMonth() + 1)}.${pad2(c.target.getDate())}`;
  const entry = todayEntry();
  if (entry) {
    $('petSignLevel').textContent = entry.term
      ? `节气签 · ${entry.term}`
      : `${entry.level} · 第${entry.no}签`;
    $('petSignPoem').textContent = entry.poem;
  } else {
    $('petSignLevel').textContent = '今日签 · 待开启';
    $('petSignPoem').textContent = '摇一签，看看今天的气运';
  }
  renderPetCourse();
}

function renderVersion(v) {
  if (v) $('versionLabel').textContent = 'v' + v;
}

function renderAll() {
  state.lastDays = null;
  state.lastCourseKey = '';
  renderCountdown();
  renderToday();
  renderHistory();
  renderEvents();
  renderPet();
}

/* ---------------- 每秒心跳 ---------------- */
function tick() {
  const c = renderCountdown();

  const today = dateKey();
  if (today !== state.today) {
    state.today = today;
    renderToday();
    renderHistory();
    renderPet();
    toast('新的一天，今日签已更新');
    maybeAllSignsEgg(c.days);
  } else if (c.days !== state.lastDays) {
    state.lastDays = c.days;
    renderToday();
    renderHistory();
    renderPet();
    maybeAllSignsEgg(c.days);
  } else {
    renderPet();
  }
}

/* 高考当天：280 签全部点亮的彩蛋（同一考试日期只触发一次） */
function maybeAllSignsEgg(days) {
  if (days > 0) return;
  const key = 'gk-all-signs-' + state.targetDate;
  try {
    if (localStorage.getItem(key)) return;
    localStorage.setItem(key, '1');
  } catch (e) {
    return;
  }
  $('egg').hidden = false;
  requestAnimationFrame(() => $('egg').classList.add('show'));
  bridge.log('ALL_SIGNS_LIT', { targetDate: state.targetDate });
}

/* ---------------- 抽签 ---------------- */
let pendingSign = null;

function startDrawFlow(force) {
  const entry = todayEntry();
  if (entry && !force) {
    openSignDetail(entry);
    return;
  }
  const sign = todaySignObj();
  if (!sign) {
    toast('签诗未加载，请检查程序文件');
    return;
  }
  pendingSign = sign;
  state.currentEntry = null;
  $('drawStage').hidden = false;
  $('drawResult').hidden = true;
  $('btnShake').hidden = false;
  $('drawHint').textContent = '静心，凝神，摇一签';
  $('tube').classList.remove('shaking');
  $('drawModal').hidden = false;
}

async function shakeDraw() {
  if (state.shaking || !pendingSign) return;
  state.shaking = true;
  $('btnShake').hidden = true;
  $('drawHint').textContent = '签筒轻摇，气运渐显……';
  if (window.GkSound) GkSound.playShake();
  swayBell($('windbell'));
  $('tube').classList.add('shaking');
  await wait(880);
  $('tube').classList.remove('shaking');

  const sign = pendingSign;
  const days = calc().days;
  const entry = {
    date: state.today,
    daysLeft: days,
    no: sign.no,
    level: sign.level,
    poem: sign.poem,
    wish: sign.wish,
    tag: sign.tag,
    term: sign.term || '',
    ts: Date.now()
  };

  state.currentEntry = entry;
  $('drawStage').hidden = true;
  $('drawResult').hidden = false;
  fillResult(entry, true);
  if (window.GkSound) GkSound.playDrawDone();

  if (!state.debugPreview) {
    bridge.log('CLIENT_DRAW', { date: entry.date, no: entry.no });
    state.history = [entry].concat(state.history.filter((h) => h.date !== entry.date));
    renderToday();
    renderHistory();
    renderPet();

    try {
      const res = await bridge.addHistory(entry);
      if (res && Array.isArray(res.history)) {
        state.history = res.history;
        renderToday();
        renderHistory();
      }
    } catch (e) {
      console.error('addHistory failed', e);
    }
  }
  state.shaking = false;
}

function fillResult(entry, isNew) {
  const ribbon = $('resLevel');
  ribbon.textContent = entry.level;
  ribbon.setAttribute('data-level', LEVEL_ATTR[entry.level] || 'mid');
  $('resNo').textContent = entry.term ? entry.term : `第 ${entry.no} 签`;
  const resStamp = $('resTermStamp');
  resStamp.hidden = !entry.term;
  if (entry.term) resStamp.textContent = entry.term;
  const parts = String(entry.poem).split('，');
  $('resPoem').innerHTML = parts.map((p) => `<span>${p}</span>`).join('');
  $('resWish').textContent = entry.wish;
  $('resTag').textContent = entry.tag;
  const termTip = termLabel();
  $('resDays').textContent = termTip
    ? `距高考 ${entry.daysLeft} 天 · ${termTip}`
    : `距高考 ${entry.daysLeft} 天`;
  $('btnDrawDone').textContent = isNew ? '收下这一签' : '合上签簿';
}

function openSignDetail(entry) {
  if (!entry) return;
  state.currentEntry = entry;
  pendingSign = null;
  $('drawStage').hidden = true;
  $('drawResult').hidden = false;
  $('btnShake').hidden = true;
  $('drawHint').textContent = '';
  fillResult(entry, false);
  $('drawModal').hidden = false;
}

function closeDrawModal() {
  if (state.shaking) return;
  $('drawModal').hidden = true;
  pendingSign = null;
  state.debugPreview = false;
}

/* ---------------- 首次启动问候 ---------------- */
/* ---------------- 每日首抽 · 全屏引导 ---------------- */
function showFirstDraw(force) {
  if (!force && todayEntry()) return;
  const el = $('firstDraw');
  el.hidden = false;
  requestAnimationFrame(() => el.classList.add('show'));
}

function hideFirstDraw() {
  const el = $('firstDraw');
  el.classList.remove('show');
  setTimeout(() => { el.hidden = true; }, 320);
}

function swayBell(el) {
  if (!el) return;
  el.classList.remove('sway');
  void el.offsetWidth;
  el.classList.add('sway');
  setTimeout(() => el.classList.remove('sway'), 1400);
}

function beginFirstDraw() {
  if (state.shaking) return;
  if (window.GkSound) GkSound.unlock();
  swayBell($('firstBell'));
  hideFirstDraw();
  setTimeout(() => {
    startDrawFlow(state.debugPreview);
    setTimeout(() => { shakeDraw(); }, 350);
  }, 320);
}

/* ---------------- 设置 ---------------- */
/* ---------------- 天气 ---------------- */
const WEEK_LABELS = ['今天', '明天', '后天'];

function renderWeather(w) {
  const card = $('weatherCard');
  const daysBox = $('weatherDays');
  let days = Array.isArray(w.days) ? w.days.slice(0, 3) : [];
  if (!days.length && Number.isFinite(Number(w.temp))) {
    days = [{ date: dateKey(), desc: w.desc || '天气', max: Math.round(Number(w.temp)), min: Math.round(Number(w.temp)) }];
  }

  $('weatherCity').textContent = w.city || '本地';
  $('weatherNowTemp').textContent = `${w.temp}°`;
  $('weatherNowDesc').textContent = w.desc || '天气';
  daysBox.innerHTML = '';
  days.forEach((d, i) => {
    const date = new Date(d.date + 'T00:00:00');
    const label = WEEK_LABELS[i] || `${date.getMonth() + 1}.${date.getDate()}`;
    const el = document.createElement('div');
    el.className = 'w-day';
    el.innerHTML =
      `<span class="w-day__label">${label}</span>` +
      `<span class="w-day__desc">${d.desc}</span>` +
      `<span class="w-day__temp"><b>${d.max}°</b> / ${d.min}°</span>`;
    daysBox.appendChild(el);
  });
  card.hidden = !days.length;

  const mini = $('petWeatherMini');
  if (days.length) {
    mini.hidden = false;
    $('petTemp').textContent = `${w.temp}°`;
    $('petDesc').textContent = w.desc || days[0].desc;
    $('petHighLow').textContent = `${days[0].max}°/${days[0].min}°`;
  } else {
    mini.hidden = true;
  }
}

async function refreshWeather() {
  if (!bridge.getWeather) return false;
  try {
    const w = await bridge.getWeather();
    if (w && w.ok) {
      state.weather = w;
      renderWeather(w);
      $('weatherStatus').textContent = state.weatherCity ? state.weatherCity : '自动定位';
      if (!Array.isArray(w.hours) || !w.hours.length) loadHourlyForecast();
      return true;
    }
    $('weatherCard').hidden = true;
    $('petWeatherMini').hidden = true;
    $('weatherStatus').textContent = w && w.error ? '获取失败' : '自动定位';
    return false;
  } catch (e) {
    return false;
  }
}

async function loadHourlyForecast() {
  if (!bridge.getWeatherHourly) return;
  try {
    const res = await bridge.getWeatherHourly();
    if (res && res.ok && Array.isArray(res.hours) && res.hours.length) {
      if (state.weather) state.weather.hours = res.hours;
      if (!$('weatherModal').hidden && state.weather) renderHourlyForecast(state.weather);
    }
  } catch (e) { /* 逐小时失败不影响主天气 */ }
}

/* ---------------- 天气详情与建议 ---------------- */
function weatherDaysOf(w) {
  if (Array.isArray(w.days) && w.days.length) return w.days.slice(0, 3);
  if (Number.isFinite(Number(w.temp))) {
    return [{ date: dateKey(), desc: w.desc || '天气', max: Math.round(Number(w.temp)), min: Math.round(Number(w.temp)) }];
  }
  return [];
}

function buildWeatherAdvice(w) {
  const list = [];
  const days = weatherDaysOf(w);
  const today = days[0] || {};
  const max = Number(today.max);
  const min = Number(today.min);
  const desc = String(today.desc || w.desc || '');

  if (Number.isFinite(max) && Number.isFinite(min)) {
    if (max >= 30) list.push(`今日最高 ${max}°，天气炎热，注意防暑补水，尽量避开正午户外。`);
    else if (max <= 5) list.push(`今日最高仅 ${max}°，注意保暖，外出戴好围巾手套。`);
    else list.push(`今日 ${min}~${max}°，体感${max >= 25 ? '偏热' : max <= 12 ? '偏凉' : '舒适'}，按需增减衣物。`);
    const diff = max - min;
    if (diff >= 8) list.push(`昼夜温差 ${diff}°，早晚各加一件外套，避免着凉。`);
  }
  if (/雷/.test(desc)) {
    list.push('有雷雨天气，尽量减少户外活动，远离大树与金属栏杆。');
  } else if (/雨|雪/.test(desc)) {
    list.push(/雪/.test(desc)
      ? '有降雪，出门带伞，路面湿滑注意慢行。'
      : '有降水，出门带伞，注意路面湿滑。');
  }
  const rainy = days
    .map((d, i) => (/雨|雪|雷/.test(String(d.desc || '')) ? (WEEK_LABELS[i] || '') : ''))
    .filter(Boolean);
  if (rainy.length) list.push(`${rainy.join('、')}有降水，提前把伞放进书包。`);

  if (w.aqi >= 150) list.push(`空气质量较差（AQI ${w.aqi}），减少户外运动，必要时戴好口罩。`);
  else if (w.aqi >= 100) list.push(`空气质量一般（AQI ${w.aqi}），敏感人群减少剧烈运动。`);

  if (w.humidity >= 85 && max >= 26) list.push('湿度较大，体感闷热，注意室内通风。');
  if (w.wind >= 25) list.push('风力较大，注意高空坠物，骑行放慢速度。');
  if (list.length < 2) list.push('天气整体平稳，适合按计划复习，课间到户外走一走。');
  return list.slice(0, 5);
}

function openWeatherDetail() {
  const w = state.weather;
  if (!w || !w.ok) {
    toast('天气还在获取中，请稍候');
    return;
  }
  $('wCity').textContent = w.city || '本地';
  $('wTemp').textContent = `${w.temp}°`;
  $('wDesc').textContent = w.desc || '天气';

  const meta = [];
  if (w.humidity) meta.push(`湿度 ${w.humidity}%`);
  if (w.windDir) meta.push(`${w.windDir} ${w.wind}km/h`);
  if (w.aqi) meta.push(`AQI ${w.aqi}`);
  $('wMeta').textContent = meta.join(' · ') || '实时天气';

  const box = $('wDays');
  box.innerHTML = '';
  weatherDaysOf(w).forEach((d, i) => {
    const date = new Date(d.date + 'T00:00:00');
    const label = `${WEEK_LABELS[i] || ''} ${date.getMonth() + 1}.${pad2(date.getDate())}`;
    const el = document.createElement('div');
    el.className = 'w-detail-day';
    el.innerHTML =
      `<span class="w-detail-day__label">${label}</span>` +
      `<span class="w-detail-day__desc">${d.desc || '天气'}</span>` +
      `<span class="w-detail-day__temp"><b>${d.max}°</b> / ${d.min}°</span>` +
      `<span class="w-detail-day__wind">${[d.windDir, d.windLevel].filter(Boolean).join(' ') || '风力 —'}</span>`;
    box.appendChild(el);
  });

  if (Array.isArray(w.hours) && w.hours.length) {
    renderHourlyForecast(w);
  } else {
    const hourBox = $('wHourlyBox');
    if (hourBox) hourBox.hidden = false;
    const note = $('wHourlyNote');
    if (note) note.textContent = '加载中…';
    const list = $('wHours');
    if (list) list.innerHTML = '<div class="w-hour-loading">正在获取逐小时天气…</div>';
    loadHourlyForecast();
  }

  const ul = $('wAdvice');
  ul.innerHTML = '';
  buildWeatherAdvice(w).forEach((text) => {
    const li = document.createElement('li');
    li.textContent = text;
    ul.appendChild(li);
  });

  const t = new Date(w.updatedAt || Date.now());
  const sourceName = w.source === 'weather.com.cn' ? '中国天气网' : 'Open-Meteo';
  $('wUpdated').textContent = `更新于 ${pad2(t.getHours())}:${pad2(t.getMinutes())} · ${sourceName}`;
  $('weatherModal').hidden = false;
}

/* 逐小时预报（24 小时） */
function renderHourlyForecast(w) {
  const box = $('wHourlyBox');
  const list = $('wHours');
  if (!box || !list) return;
  const hours = Array.isArray(w.hours) ? w.hours.slice(0, 24) : [];
  list.innerHTML = '';
  if (!hours.length) {
    box.hidden = true;
    return;
  }
  box.hidden = false;
  $('wHourlyNote').textContent = `未来 ${hours.length} 小时`;
  hours.forEach((h) => {
    const el = document.createElement('div');
    el.className = 'w-hour';
    el.innerHTML =
      `<span class="w-hour__label">${escapeHtml(h.label)}</span>` +
      `<span class="w-hour__desc">${escapeHtml(h.desc || '天气')}</span>` +
      `<span class="w-hour__temp">${h.temp}°</span>` +
      `<span class="w-hour__pop">${h.pop ? '降水 ' + h.pop + '%' : '—'}</span>`;
    list.appendChild(el);
  });
}

function closeWeatherDetail() {
  $('weatherModal').hidden = true;
}

/* ---------------- 二十四节气 ---------------- */
const TERMS = Array.isArray(window.SOLAR_TERMS) ? window.SOLAR_TERMS : [];

function termDateStr(t) {
  return `${pad2(t.m)}.${pad2(t.d)}`;
}
function todayTerm(now = new Date()) {
  const m = now.getMonth() + 1;
  const d = now.getDate();
  return TERMS.find((t) => t.m === m && t.d === d) || null;
}
function nextTerm(now = new Date()) {
  const base = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  let best = null;
  for (const y of [now.getFullYear(), now.getFullYear() + 1]) {
    for (const t of TERMS) {
      const dt = new Date(y, t.m - 1, t.d);
      if (dt >= base && (!best || dt < best.dt)) best = { term: t, dt };
    }
  }
  return best;
}
function daysFromToday(dt, now = new Date()) {
  const base = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((dt.getTime() - base.getTime()) / 86400000);
}
function termLabel() {
  if (!TERMS.length) return '';
  const now = new Date();
  const t = todayTerm(now);
  if (t) return `今日${t.name}`;
  const n = nextTerm(now);
  return n ? `${n.term.name} ${daysFromToday(n.dt, now)} 天` : '';
}
function openTermModal(randomMode) {
  if (!TERMS.length) {
    toast('节气签尚未加载');
    return;
  }
  const now = new Date();
  let term;
  if (randomMode) {
    term = TERMS[Math.floor(Math.random() * TERMS.length)];
  } else {
    const t = todayTerm(now);
    const n = nextTerm(now);
    term = t || (n ? n.term : TERMS[0]);
  }
  $('termName').textContent = term.name;
  $('termDate').textContent = termDateStr(term);
  $('termPoem').textContent = term.poem;
  $('termWish').textContent = term.wish;
  $('termIdea').textContent = '宜：' + term.idea;
  const t = todayTerm(now);
  const n = nextTerm(now);
  if (t && t.name === term.name) {
    $('termNav').textContent = `今日 · ${term.name}`;
  } else if (n) {
    $('termNav').textContent = `下一个节气 · ${n.term.name} ${daysFromToday(n.dt, now)} 天`;
  } else {
    $('termNav').textContent = '二十四节气';
  }
  $('termModal').hidden = false;
}
function closeTermModal() {
  $('termModal').hidden = true;
}

/* ---------------- 版本更新（自动检测 + 后台下载 + 手动安装） ---------------- */
function updateHighlights() {
  const info = state.updateInfo;
  if (!info) return [];
  if (Array.isArray(info.highlights) && info.highlights.length) return info.highlights.slice(0, 7);
  if (info.notesFull) return String(info.notesFull).split(/[；;。]\s*/).map((s) => s.trim()).filter(Boolean).slice(0, 6);
  return info.notes ? [info.notes] : [];
}

function renderUpdateBanner() {
  const box = $('updateBanner');
  if (!box) return;
  const info = state.updateInfo;
  const dl = state.updateDownload;
  if (!info || !info.ok || !info.hasUpdate || state.updateBannerDismissed === info.latest) {
    box.hidden = true;
    return;
  }
  box.hidden = false;
  $('updateBannerTitle').textContent = `发现新版本 v${info.latest}`;
  const list = $('updateBannerList');
  const items = updateHighlights();
  list.innerHTML = items.length
    ? items.map((text) => `<li>${escapeHtml(text)}</li>`).join('')
    : '<li>本次更新带来了一些改进与修复</li>';

  let statusText = '可立即更新，或稍后再试';
  if (dl.phase === 'downloading' || info.downloading) statusText = `正在后台下载 ${dl.percent || 0}%`;
  else if (dl.phase === 'ready') statusText = '安装包已下载完成';
  else if (dl.phase === 'error') statusText = '下载失败，可点击重试';
  else if (info.notes) statusText = info.notes.slice(0, 46);
  $('updateBannerStatus').textContent = statusText;

  const nowBtn = $('btnUpdateNow');
  nowBtn.disabled = dl.phase === 'downloading';
  nowBtn.textContent = dl.phase === 'ready'
    ? '立即安装'
    : (dl.phase === 'downloading' ? '下载中…' : '现在更新');
}

function dismissUpdateBanner() {
  const info = state.updateInfo;
  if (info && info.latest) {
    state.updateBannerDismissed = info.latest;
    try { localStorage.setItem('gk-update-dismissed', info.latest); } catch (e) { /* 忽略 */ }
  }
  renderUpdateBanner();
}

function showUpdateReadyDialog() {
  const dl = state.updateDownload;
  if (!dl.filePath) return;
  $('readyVersion').textContent = dl.version || (state.updateInfo && state.updateInfo.latest) || '';
  $('updateReadyModal').hidden = false;
}

function hideUpdateReadyDialog() {
  $('updateReadyModal').hidden = true;
}

function renderUpdateUI() {
  renderUpdateBanner();
  const info = state.updateInfo;
  const dl = state.updateDownload;
  const btn = $('btnDownloadUpdate');
  const progress = $('updateProgress');
  const fill = $('updateProgressFill');
  const ptext = $('updateProgressText');
  const status = $('updateStatus');
  const manualLink = $('manualDownloadLink');
  if (manualLink) manualLink.hidden = true;
  if (!btn || !progress) return;

  if (!info || !info.ok) {
    btn.hidden = true;
    progress.hidden = true;
    if (status && info && !info.ok) status.textContent = '暂时无法连接更新服务，稍后会自动重试';
    return;
  }

  if (!info.hasUpdate) {
    btn.hidden = true;
    progress.hidden = true;
    $('updateDot').hidden = true;
    if (status) status.textContent = `已是最新版本 v${info.current}`;
    return;
  }

  $('updateDot').hidden = false;
  if (dl.phase === 'downloading' || info.downloading) {
    const pct = Math.max(0, Math.min(99, dl.percent || 0));
    progress.hidden = false;
    fill.style.width = pct + '%';
    ptext.textContent = `正在后台下载 ${pct}%`;
    btn.hidden = true;
    if (status) status.textContent = `发现新版本 v${info.latest}，正在自动下载安装包…`;
    return;
  }
  if (dl.phase === 'ready') {
    progress.hidden = false;
    fill.style.width = '100%';
    ptext.textContent = '安装包已就绪';
    btn.hidden = false;
    btn.textContent = '立即安装';
    if (status) status.textContent = `新版本 v${info.latest} 已下载完成，点击「立即安装」`;
    return;
  }
  if (dl.phase === 'error') {
    progress.hidden = true;
    btn.hidden = false;
    btn.textContent = info.setupMirrors && info.setupMirrors.length ? '重新下载安装包' : '手动下载新版本';
    if (status) status.textContent = `新版本 v${info.latest} 下载失败，可能被杀毒软件拦截，可尝试手动下载`;
    const manual = $('manualDownloadLink');
    if (manual) manual.hidden = false;
    return;
  }

  progress.hidden = true;
  btn.hidden = false;
  btn.textContent = info.setupMirrors && info.setupMirrors.length
    ? '获取安装包'
    : (info.portableMirrors && info.portableMirrors.length ? '下载新版本' : '打开发布页');
  if (status) status.textContent = `发现新版本 v${info.latest}${info.notes ? ' · ' + info.notes : ''}`;
}

async function startUpdateDownload(info) {
  if (!info || !info.setupMirrors || !info.setupMirrors.length) return;
  if (state.updateDownload.phase === 'downloading') return;
  state.updateDownload = { phase: 'downloading', percent: 0, filePath: '', version: info.latest };
  renderUpdateUI();
  try {
    const res = await bridge.downloadUpdatePackage({ version: info.latest, urls: info.setupMirrors });
    if (res && res.ok) {
      state.updateDownload.phase = 'ready';
      state.updateDownload.percent = 100;
      state.updateDownload.filePath = res.filePath || '';
      renderUpdateUI();
    } else if (!(res && res.downloading)) {
      state.updateDownload.phase = 'error';
      renderUpdateUI();
    }
  } catch (e) {
    state.updateDownload.phase = 'error';
    renderUpdateUI();
  }
}

async function checkUpdates(silent) {
  const status = $('updateStatus');
  if (status && !silent) status.textContent = '正在检查…';
  // 手动检查时重新显示更新公告
  if (!silent) {
    state.updateBannerDismissed = '';
    try { localStorage.removeItem('gk-update-dismissed'); } catch (e) { /* 忽略 */ }
  }
  try {
    const res = await bridge.checkUpdate();
    const now = new Date();
    state.updateLastCheck = `${pad2(now.getHours())}:${pad2(now.getMinutes())}`;
    const lastEl = $('updateLastCheck');
    if (lastEl) lastEl.textContent = `上次检查：${state.updateLastCheck}`;
    if (!res || !res.configured) {
      if (status) status.textContent = '更新服务未配置';
      return;
    }
    if (!res.ok) {
      if (status) status.textContent = '暂时无法连接更新服务，稍后会自动重试';
      $('updateDot').hidden = true;
      return;
    }
    state.updateInfo = res;
    if (!res.hasUpdate) {
      state.updateDownload = { phase: 'idle', percent: 0, filePath: '', version: '' };
      renderUpdateUI();
      return;
    }
    if (res.downloaded && res.downloadFilePath) {
      state.updateDownload = { phase: 'ready', percent: 100, filePath: res.downloadFilePath, version: res.latest };
      renderUpdateUI();
    } else if (res.setupMirrors && res.setupMirrors.length && state.updateAutoDownload) {
      // 自动下载开启时，在后台静默下载安装包
      startUpdateDownload(res);
    } else {
      state.updateDownload = { phase: 'idle', percent: 0, filePath: '', version: '' };
      renderUpdateUI();
    }
    if (!silent) toast(`发现新版本 v${res.latest}`);
  } catch (e) {
    if (status) status.textContent = '暂时无法连接更新服务，稍后会自动重试';
  }
}

function openSettings() {
  $('inputTarget').value = state.targetDate;
  setAutoLaunchUI(state.autoLaunch);
  $('inputWeatherCity').value = state.weatherCity;
  $('weatherStatus').textContent = state.weatherCity || '自动定位';
  $('curVersionLabel').textContent = 'v' + state.version;
  renderUpdateUI();
  syncUpdatePrefsUI();
  $('updateLastCheck').textContent = `上次检查：${state.updateLastCheck || '—'}`;
  $('inputScale').value = String(state.petScale);
  $('scaleLabel').textContent = Math.round(state.petScale * 100) + '%';
  renderSkinGrid();
  renderSubjectGrid();
  $('settings').hidden = false;
}

/* ---------------- 首次配置 ---------------- */
async function openOnboarding() {
  if (state.mode === 'pet') {
    try { await bridge.setPetMode(false); } catch (e) { /* 忽略 */ }
  }
  $('onboardDate').value = state.targetDate;
  state.onboardAutoLaunch = state.autoLaunch;
  setOnboardAutoLaunchUI(state.onboardAutoLaunch);
  renderOnboardSubjects();
  $('onboard').hidden = false;
}

function setOnboardAutoLaunchUI(on) {
  const el = $('onboardAutoLaunch');
  if (!el) return;
  el.classList.toggle('on', !!on);
  el.setAttribute('aria-pressed', String(!!on));
}

async function completeOnboarding() {
  const v = $('onboardDate').value;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) {
    toast('请选择高考日期');
    return;
  }
  state.targetDate = v;
  try {
    const res = await bridge.saveSettings({
      targetDate: v,
      selectedSubjects: state.selectedSubjects,
      onboarded: true
    });
    if (res && Array.isArray(res.selectedSubjects)) state.selectedSubjects = res.selectedSubjects;
  } catch (e) {
    toast('保存失败，请重试');
    return;
  }
  try {
    const res = await bridge.setAutoLaunch(state.onboardAutoLaunch);
    state.autoLaunch = !!(res && res.enabled);
  } catch (e) { /* 忽略 */ }
  state.onboarded = true;
  $('onboard').hidden = true;
  renderAll();
  toast('配置完成，祝你每天都有好签');
  setTimeout(() => {
    if (!todayEntry()) showFirstDraw();
  }, 500);
}

/* 知识点选科：九大学科最多选 6 科 */
function renderSubjectChips(grid, countEl) {
  if (!grid) return;
  grid.innerHTML = '';
  const full = state.selectedSubjects.length >= 6;
  SUBJECT_META.forEach((s) => {
    const on = state.selectedSubjects.includes(s.id);
    const btn = document.createElement('button');
    btn.className = 'subject-chip' + (on ? ' on' : '') + (!on && full ? ' disabled' : '');
    btn.style.setProperty('--c', s.color);
    btn.setAttribute('aria-pressed', String(on));
    btn.innerHTML = `<i></i><span>${s.name}</span>`;
    btn.addEventListener('click', () => toggleSubject(s.id));
    grid.appendChild(btn);
  });
  if (countEl) countEl.textContent = `已选 ${state.selectedSubjects.length} / 6`;
}

function renderSubjectGrid() {
  renderSubjectChips($('subjectGrid'), $('subjectCount'));
}

function renderOnboardSubjects() {
  renderSubjectChips($('onboardSubjects'), $('onboardSubjectCount'));
}

async function toggleSubject(id) {
  const idx = state.selectedSubjects.indexOf(id);
  if (idx >= 0) {
    if (state.selectedSubjects.length <= 1) {
      toast('至少保留一科');
      return;
    }
    state.selectedSubjects.splice(idx, 1);
  } else {
    if (state.selectedSubjects.length >= 6) {
      toast('最多选择 6 科');
      return;
    }
    state.selectedSubjects.push(id);
  }
  renderSubjectGrid();
  renderOnboardSubjects();
  // 首次配置阶段先不落盘，点“完成配置”时统一保存
  if (!$('onboard').hidden) return;
  try {
    const res = await bridge.saveSettings({ selectedSubjects: state.selectedSubjects });
    if (res && Array.isArray(res.selectedSubjects)) {
      state.selectedSubjects = res.selectedSubjects;
      renderSubjectGrid();
      renderOnboardSubjects();
    }
    toast('科目选择已保存');
  } catch (e) {
    toast('保存失败，请重试');
  }
}

function closeSettings() {
  $('settings').hidden = true;
  $('settingsBackdrop').hidden = false;
}

function applySkin(id) {
  const valid = SKIN_META.some((s) => s.id === id) ? id : 'board';
  document.body.setAttribute('data-skin', valid);
}
function renderSkinGrid() {
  const grid = $('skinGrid');
  if (!grid) return;
  grid.innerHTML = '';
  SKIN_META.forEach((skin) => {
    const btn = document.createElement('button');
    btn.className = 'skin-opt' + (state.skin === skin.id ? ' on' : '');
    btn.innerHTML =
      `<span class="skin-swatch" style="background:linear-gradient(140deg,${skin.c[0]},${skin.c[1]})"></span>` +
      `<span>${skin.name}</span>`;
    btn.addEventListener('click', async () => {
      state.skin = skin.id;
      applySkin(skin.id);
      renderSkinGrid();
      try {
        await bridge.saveSettings({ skin: skin.id });
      } catch (e) { /* 忽略 */ }
    });
    grid.appendChild(btn);
  });
}

function setAutoLaunchUI(on) {
  const el = $('switchAutoLaunch');
  el.classList.toggle('on', !!on);
  el.setAttribute('aria-pressed', String(!!on));
}

function syncUpdatePrefsUI() {
  const check = $('switchUpdateCheck');
  if (check) {
    check.classList.toggle('on', state.updateAutoCheck);
    check.setAttribute('aria-pressed', String(state.updateAutoCheck));
  }
  const dl = $('switchUpdateDownload');
  if (dl) {
    dl.classList.toggle('on', state.updateAutoDownload);
    dl.setAttribute('aria-pressed', String(state.updateAutoDownload));
  }
}

/* ---------------- 桌面宠物操作 ---------------- */
function onModeChanged(data) {
  if (!data) return;
  state.mode = data.mode || 'panel';
  if (data.scale) state.petScale = Number(data.scale) || state.petScale;
  document.body.setAttribute('data-mode', state.mode);
  $('panelView').hidden = state.mode === 'pet';
  $('petView').hidden = state.mode !== 'pet';
  if (state.mode === 'pet') {
    renderPet();
    $('settings').hidden = true;
  } else {
    renderCountdown();
    renderToday();
  }
}

async function enterPetMode() {
  try {
    await bridge.setPetMode(true);
  } catch (e) {
    toast('桌面宠物模式不可用');
  }
}

/* ---------------- 签卡导出（Canvas） ---------------- */
function wrapText(ctx, text, x, y, maxW, lh) {
  let line = '';
  const lines = [];
  for (const ch of String(text)) {
    if (ctx.measureText(line + ch).width > maxW) {
      lines.push(line);
      line = ch;
    } else {
      line += ch;
    }
  }
  if (line) lines.push(line);
  lines.forEach((l, i) => ctx.fillText(l, x, y + i * lh));
  return y + (lines.length - 1) * lh;
}

async function exportSignCard(entry) {
  if (!entry) return;
  const W = 900;
  const H = 600;
  const cv = document.createElement('canvas');
  cv.width = W;
  cv.height = H;
  const ctx = cv.getContext('2d');

  // 宣纸底
  const bg = ctx.createLinearGradient(0, 0, W, H);
  bg.addColorStop(0, '#fbf4e1');
  bg.addColorStop(0.6, '#f5ecd6');
  bg.addColorStop(1, '#e8dab6');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);

  // 纸纹噪点
  for (let i = 0; i < 1500; i++) {
    ctx.fillStyle = `rgba(120,95,60,${Math.random() * 0.05})`;
    ctx.fillRect(Math.random() * W, Math.random() * H, 1.5, 1.5);
  }

  // 双线红框
  ctx.strokeStyle = 'rgba(168,50,50,.5)';
  ctx.lineWidth = 2;
  ctx.strokeRect(28, 28, W - 56, H - 56);
  ctx.strokeStyle = 'rgba(168,50,50,.22)';
  ctx.lineWidth = 1;
  ctx.strokeRect(40, 40, W - 80, H - 80);

  // 页眉
  const titleFont = '20px "KaiTi","Kaiti SC","STKaiti",serif';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = 'rgba(58,46,30,.62)';
  ctx.font = titleFont;
  ctx.fillText('高考倒计时 · 每日一签', 64, 82);
  ctx.textAlign = 'right';
  const noLabel = entry.term ? entry.term : `第 ${entry.no} 签`;
  ctx.fillText(`${String(entry.date).replace(/-/g, '.')} · ${noLabel}`, W - 64, 82);

  // 签等标签
  const levelColors = { '上上签': '#a83232', '上签': '#8a6a1e', '中签': '#5c6f45', '静心签': '#3f6b68' };
  ctx.textAlign = 'center';
  ctx.fillStyle = levelColors[entry.level] || '#a83232';
  ctx.font = 'bold 26px "KaiTi","Kaiti SC","STKaiti",serif';
  ctx.fillText(entry.level, W / 2, 146);

  // 诗句
  const poemLines = String(entry.poem).split('，');
  ctx.fillStyle = '#33281a';
  ctx.font = 'bold 64px "KaiTi","Kaiti SC","STKaiti",serif';
  ctx.textAlign = 'center';
  ctx.fillText(poemLines[0] || '', W / 2, 262);
  if (poemLines[1]) ctx.fillText(poemLines[1], W / 2, 352);

  // 分隔
  ctx.strokeStyle = 'rgba(58,46,30,.18)';
  ctx.beginPath();
  ctx.moveTo(W / 2 - 120, 392);
  ctx.lineTo(W / 2 + 120, 392);
  ctx.stroke();

  // 解签
  ctx.fillStyle = 'rgba(58,46,30,.78)';
  ctx.font = '24px "KaiTi","Kaiti SC","STKaiti",serif';
  ctx.textAlign = 'center';
  wrapText(ctx, entry.wish, W / 2, 440, 620, 38);

  // 底部信息
  ctx.fillStyle = 'rgba(58,46,30,.55)';
  ctx.font = '18px "KaiTi","Kaiti SC","STKaiti",serif';
  ctx.textAlign = 'left';
  ctx.fillText(`距高考 ${entry.daysLeft} 天 · ${entry.tag}`, 64, H - 62);
  ctx.textAlign = 'right';
  ctx.fillText('落签为证 · 每日一签', W - 64, H - 62);

  // 印章
  ctx.save();
  ctx.translate(W - 116, H - 158);
  ctx.rotate(-0.12);
  ctx.strokeStyle = 'rgba(168,32,32,.55)';
  ctx.lineWidth = 3;
  ctx.strokeRect(0, 0, 64, 64);
  ctx.fillStyle = 'rgba(168,32,32,.62)';
  ctx.font = 'bold 20px "KaiTi","Kaiti SC","STKaiti",serif';
  ctx.textAlign = 'center';
  ctx.fillText('今 日', 32, 26);
  ctx.fillText('已 启', 32, 50);
  ctx.restore();

  const dataUrl = cv.toDataURL('image/png');
  const fileName = entry.term
    ? `节气签_${entry.date}_${entry.term}.png`
    : `幸运签_${entry.date}_第${entry.no}签.png`;
  try {
    const res = await bridge.saveImage(dataUrl, fileName);
    if (res && res.ok) toast('签卡已保存');
    else if (res && !res.canceled) toast('保存失败');
  } catch (e) {
    const a = document.createElement('a');
    a.download = fileName;
    a.href = dataUrl;
    a.click();
    toast('签卡已保存到下载目录');
  }
}

/* ---------------- Toast ---------------- */
let toastTimer = null;
function toast(msg) {
  const el = $('toast');
  el.textContent = msg;
  el.hidden = false;
  requestAnimationFrame(() => el.classList.add('show'));
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    el.classList.remove('show');
    setTimeout(() => { el.hidden = true; }, 280);
  }, 2400);
}

async function copyAuthorMail() {
  const email = '3270423617@qq.com';
  let ok = false;
  try {
    if (bridge.copyText) {
      const res = await bridge.copyText(email);
      ok = !!(res && res.ok);
    }
  } catch (e) { /* 尝试浏览器剪贴板 */ }
  if (!ok) {
    try {
      await navigator.clipboard.writeText(email);
      ok = true;
    } catch (e) { /* 复制失败 */ }
  }
  toast(ok ? '邮箱已复制：' + email : '复制失败，请手动选择邮箱');
}

function closeAgreementModal() {
  $('agreementModal').hidden = true;
}

/* ---------------- 事件绑定 ---------------- */
function bindEvents() {
  $('btnDraw').addEventListener('click', () => startDrawFlow(false));
  $('btnDrawSide').addEventListener('click', () => startDrawFlow(false));
  $('btnKnowledge').addEventListener('click', () => bridge.openKnowledge());
  $('btnTimetable').addEventListener('click', () => bridge.openTimetable());
  $('btnClassroom').addEventListener('click', () => bridge.openClassroom());
  $('btnTerm').addEventListener('click', () => openTermModal(false));
  $('btnTermRandom').addEventListener('click', () => openTermModal(true));
  $('btnTermClose').addEventListener('click', closeTermModal);
  $('termModal').querySelector('.modal__backdrop').addEventListener('click', closeTermModal);
  $('btnEggClose').addEventListener('click', () => {
    $('egg').classList.remove('show');
    setTimeout(() => { $('egg').hidden = true; }, 350);
  });
  $('btnShake').addEventListener('click', shakeDraw);
  $('btnDrawDone').addEventListener('click', closeDrawModal);
  $('btnSaveCard').addEventListener('click', () => exportSignCard(state.currentEntry));
  $('btnSaveCard2').addEventListener('click', () => exportSignCard(todayEntry()));

  // 抽签弹窗点击遮罩关闭
  $('drawModal').querySelector('.modal__backdrop').addEventListener('click', closeDrawModal);

  // 每日首抽引导：点击任意位置抽签 / 右上角跳过
  $('firstDraw').addEventListener('click', beginFirstDraw);
  $('btnFirstSkip').addEventListener('click', (e) => {
    e.stopPropagation();
    hideFirstDraw();
    state.debugPreview = false;
    bridge.log('FIRST_DRAW_SKIP', { date: state.today });
    toast('今天也可以在主页点「现在就抽取」');
  });

  // 窗口按钮
  $('btnHide').addEventListener('click', () => bridge.hideToTray());
  // 点 × 关闭主界面时收进桌面宠物，而不是退出
  $('btnClose').addEventListener('click', async () => {
    $('settings').hidden = true;
    $('drawModal').hidden = true;
    $('firstDraw').hidden = true;
    state.debugPreview = false;
    await enterPetMode();
    toast('已收进桌面宠物');
  });
  $('btnPet').addEventListener('click', enterPetMode);
  $('btnSettings').addEventListener('click', openSettings);

  // 宠物
  $('petView').addEventListener('contextmenu', (e) => {
    e.preventDefault();
    bridge.petMenu();
  });
  $('petView').addEventListener('dblclick', (e) => {
    if (e.target.closest('.pet-actions')) return;
    bridge.setPetMode(false);
  });
  $$('.pet-actions button').forEach((btn) => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const act = btn.dataset.petAct;
      if (act === 'plus') await bridge.changeScale(0.1);
      else if (act === 'minus') await bridge.changeScale(-0.1);
      else if (act === 'panel') await bridge.setPetMode(false);
      else if (act === 'menu') bridge.petMenu();
    });
  });

  // 设置
  $('btnCloseSettings').addEventListener('click', closeSettings);
  $('btnSettingsDone').addEventListener('click', closeSettings);
  $('settingsBackdrop').addEventListener('click', closeSettings);
  $('btnEnterPet').addEventListener('click', () => { closeSettings(); enterPetMode(); });
  $('inputTarget').addEventListener('change', async (e) => {
    const v = e.target.value;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return;
    state.targetDate = v;
    renderAll();
    try {
      await bridge.saveSettings({ targetDate: v });
      toast('高考日期已更新');
    } catch (err) {
      toast('保存失败，请重试');
    }
  });
  $('switchAutoLaunch').addEventListener('click', async () => {
    const next = !state.autoLaunch;
    state.autoLaunch = next;
    setAutoLaunchUI(next);
    try {
      const res = await bridge.setAutoLaunch(next);
      if (res && res.ok) {
        if (next && !res.actual) toast('已开启，安装版开机后生效');
        else toast(next ? '已开启开机自动启动' : '已关闭开机自动启动');
      } else {
        state.autoLaunch = !next;
        setAutoLaunchUI(state.autoLaunch);
        toast('设置失败');
      }
    } catch (err) {
      toast('设置失败');
    }
  });

  $('inputWeatherCity').addEventListener('change', async (e) => {
    const v = e.target.value.trim();
    state.weatherCity = v;
    try { await bridge.saveSettings({ weatherCity: v }); } catch (err) { /* 忽略 */ }
    $('weatherStatus').textContent = v || '自动定位';
    await refreshWeather();
    toast(v ? `天气已切换到 ${v}` : '已切换为自动定位');
  });
  $('btnWeatherRefresh').addEventListener('click', async () => {
    $('weatherStatus').textContent = '更新中…';
    const ok = await refreshWeather();
    toast(ok ? '天气已更新' : '天气获取失败，请检查网络或城市名');
  });
  $('weatherCard').addEventListener('click', openWeatherDetail);
  $('weatherCard').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      openWeatherDetail();
    }
  });
  $('btnWeatherClose').addEventListener('click', closeWeatherDetail);
  $('weatherModal').querySelector('.modal__backdrop').addEventListener('click', closeWeatherDetail);
  $('btnCheckUpdate').addEventListener('click', () => checkUpdates(false));
  $('btnDownloadUpdate').addEventListener('click', async () => {
    const info = state.updateInfo;
    if (!info) return;
    const dl = state.updateDownload;
    // 安装包已下载：退出应用并进入安装程序
    if (dl.phase === 'ready' && dl.filePath) {
      toast('即将退出程序并启动安装向导…');
      const res = await bridge.installUpdate(dl.filePath);
      if (!res || !res.ok) toast((res && res.error) || '无法启动安装程序');
      return;
    }
    // 有安装包则继续后台下载
    if (info.setupMirrors && info.setupMirrors.length) {
      startUpdateDownload(info);
      return;
    }
    // 没有安装包时退回浏览器下载
    const urls = [];
    if (Array.isArray(info.portableMirrors)) urls.push(...info.portableMirrors);
    if (Array.isArray(info.mirrors)) urls.push(...info.mirrors);
    if (info.url) urls.push(info.url);
    if (!urls.length) {
      toast('版本清单未提供下载地址');
      return;
    }
    const res = await bridge.downloadUpdate(urls);
    if (res && res.ok) toast('已打开下载链接，如速度慢会自动切换镜像');
    else toast('下载链接打开失败，请稍后重试');
  });
  $('repoLink').addEventListener('click', (e) => {
    e.preventDefault();
    bridge.openExternal('https://github.com/luoleiyong/gaokao-countdown');
  });
  $('manualDownloadLink').addEventListener('click', (e) => {
    e.preventDefault();
    const info = state.updateInfo;
    const url = (info && (info.pageUrl || info.url)) ||
      'https://github.com/luoleiyong/gaokao-countdown/releases/latest';
    bridge.openExternal(url);
  });

  // 首页更新公告
  $('btnUpdateBannerClose').addEventListener('click', dismissUpdateBanner);
  $('btnUpdateBannerLater').addEventListener('click', () => {
    dismissUpdateBanner();
    toast('已收起更新公告，可在设置中更新');
  });
  $('btnUpdateNow').addEventListener('click', async () => {
    const info = state.updateInfo;
    const dl = state.updateDownload;
    if (!info) return;
    if (dl.phase === 'downloading') return toast('安装包正在下载，请稍候');
    if (dl.phase === 'ready') return showUpdateReadyDialog();
    if (info.setupMirrors && info.setupMirrors.length) {
      startUpdateDownload(info);
      toast('已开始后台下载更新');
      return;
    }
    const urls = [];
    if (Array.isArray(info.portableMirrors)) urls.push(...info.portableMirrors);
    if (Array.isArray(info.mirrors)) urls.push(...info.mirrors);
    if (info.url) urls.push(info.url);
    if (urls.length) bridge.downloadUpdate(urls);
    else toast('版本清单未提供下载地址');
  });

  // 更新下载完成弹窗
  $('btnUpdateRestart').addEventListener('click', async () => {
    const dl = state.updateDownload;
    if (!dl.filePath) return;
    state.updateInstallStarted = true;
    hideUpdateReadyDialog();
    toast('正在退出并启动安装程序…');
    const res = await bridge.installUpdate(dl.filePath);
    if (!res || !res.ok) {
      state.updateInstallStarted = false;
      toast((res && res.error) || '无法启动安装程序');
    }
  });
  $('btnUpdateLater').addEventListener('click', async () => {
    const dl = state.updateDownload;
    if (!dl.filePath) return;
    state.updateDeferred = true;
    hideUpdateReadyDialog();
    const res = await bridge.deferInstall(dl.filePath);
    toast(res && res.ok ? '将在退出程序后自动安装' : '稍后安装设置失败');
  });

  // 更新设置
  $('switchUpdateCheck').addEventListener('click', async () => {
    state.updateAutoCheck = !state.updateAutoCheck;
    syncUpdatePrefsUI();
    try { await bridge.saveSettings({ updateAutoCheck: state.updateAutoCheck }); } catch (e) { /* 忽略 */ }
    toast(state.updateAutoCheck ? '已开启自动检测更新' : '已关闭自动检测更新');
    if (state.updateAutoCheck) checkUpdates(true);
  });
  $('switchUpdateDownload').addEventListener('click', async () => {
    state.updateAutoDownload = !state.updateAutoDownload;
    syncUpdatePrefsUI();
    try { await bridge.saveSettings({ updateAutoDownload: state.updateAutoDownload }); } catch (e) { /* 忽略 */ }
    toast(state.updateAutoDownload ? '已开启自动下载更新' : '已关闭自动下载更新');
  });

  // 连续点击版本号 5 次进入管理员模式
  let versionClicks = 0;
  let versionClickTimer = null;
  $('curVersionLabel').addEventListener('click', () => {
    versionClicks += 1;
    clearTimeout(versionClickTimer);
    versionClickTimer = setTimeout(() => { versionClicks = 0; }, 2500);
    if (versionClicks >= 5) {
      versionClicks = 0;
      clearTimeout(versionClickTimer);
      closeSettings();
      bridge.openClassroomAdmin();
      toast('正在进入管理员模式');
    }
  });

  // 首次配置
  $('onboardAutoLaunch').addEventListener('click', () => {
    state.onboardAutoLaunch = !state.onboardAutoLaunch;
    setOnboardAutoLaunchUI(state.onboardAutoLaunch);
  });
  $('btnOnboardDone').addEventListener('click', completeOnboarding);
  $('onboardDate').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') completeOnboarding();
  });

  $('inputScale').addEventListener('input', (e) => {
    const v = Number(e.target.value);
    state.petScale = v;
    $('scaleLabel').textContent = Math.round(v * 100) + '%';
  });
  $('inputScale').addEventListener('change', async (e) => {
    const v = Number(e.target.value);
    await bridge.saveSettings({ petScale: v });
    toast('宠物大小已保存');
  });
  $('authorMail').addEventListener('click', copyAuthorMail);
  $('btnEventsManage').addEventListener('click', openEventsModal);
  $('btnAddEvent').addEventListener('click', addEvent);
  $('eventName').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') addEvent();
  });
  $('eventDate').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') addEvent();
  });
  document.querySelectorAll('[data-close="events"]').forEach((el) => {
    el.addEventListener('click', closeEventsModal);
  });

  // 数据与备份
  $('switchBackup').classList.toggle('on', state.backupAuto);
  $('switchBackup').setAttribute('aria-pressed', String(state.backupAuto));
  $('switchBackup').addEventListener('click', async () => {
    state.backupAuto = !state.backupAuto;
    $('switchBackup').classList.toggle('on', state.backupAuto);
    $('switchBackup').setAttribute('aria-pressed', String(state.backupAuto));
    try { await bridge.saveSettings({ backupAuto: state.backupAuto }); } catch (e) { /* 忽略 */ }
    toast(state.backupAuto ? '已开启每日自动备份' : '已关闭自动备份');
  });
  const backupText = state.backupInfo && state.backupInfo.latest
    ? `最近备份：${state.backupInfo.latest}（共 ${state.backupInfo.count} 份）`
    : '每天启动时自动备份，保留最近 7 天';
  $('backupStatus').textContent = backupText;
  $('btnExportData').addEventListener('click', async () => {
    const res = await bridge.exportData();
    if (res && res.ok) toast('数据已导出');
    else if (res && !res.canceled) toast((res && res.error) || '导出失败');
  });
  $('btnImportData').addEventListener('click', async () => {
    const res = await bridge.importData();
    if (res && res.ok) {
      toast('数据已导入，正在刷新…');
      setTimeout(() => location.reload(), 700);
    } else if (res && !res.canceled) {
      toast((res && res.error) || '导入失败');
    }
  });
  $('btnAgreement').addEventListener('click', () => { $('agreementModal').hidden = false; });
  $('btnAgreementCancel').addEventListener('click', closeAgreementModal);
  $('btnAgreementOk').addEventListener('click', closeAgreementModal);
  const agreementBackdrop = document.querySelector('[data-close="agreement"]');
  if (agreementBackdrop) agreementBackdrop.addEventListener('click', closeAgreementModal);
  $('btnQuit').addEventListener('click', () => bridge.quit());

  // 键盘
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (!$('agreementModal').hidden) closeAgreementModal();
      else if (!$('eventsModal').hidden) closeEventsModal();
      else if (!$('updateReadyModal').hidden) hideUpdateReadyDialog();
      else if (!$('settings').hidden) closeSettings();
      else if (!$('drawModal').hidden) closeDrawModal();
      else if (!$('weatherModal').hidden) closeWeatherDetail();
      else if (!$('termModal').hidden) closeTermModal();
      else if (!$('firstDraw').hidden) {
        hideFirstDraw();
        state.debugPreview = false;
        bridge.log('FIRST_DRAW_SKIP', { date: state.today, via: 'esc' });
      }
    }
  });
}

/* ---------------- 浏览器预览兜底（无 Electron 时） ---------------- */
function createMockBridge() {
  const KEY = 'gaokao-mock-store';
  let store = {};
  try {
    store = JSON.parse(localStorage.getItem(KEY) || 'null') || {};
  } catch (e) { store = {}; }
  store = Object.assign(
    { targetDate: '2027-06-07', skin: 'board', petScale: 1, autoLaunch: false, history: [], lastLaunchDate: '', debugMode: false, onboarded: true, updateAutoCheck: true, updateAutoDownload: true, events: [], timetable: null, backupAuto: true },
    store
  );
  const today = dateKey();
  const first = store.lastLaunchDate !== today;
  store.lastLaunchDate = today;
  const save = () => localStorage.setItem(KEY, JSON.stringify(store));
  save();
  return {
    getInit: async () => ({
      store,
      isFirstToday: first,
      today,
      mode: 'panel',
      logs: ['[preview] 浏览器预览模式，桌面功能不可用'],
      version: '1.0.0-dev',
      platform: 'preview'
    }),
    saveSettings: async (patch) => Object.assign(store, patch) && save(),
    saveEvents: async (list) => {
      store.events = list;
      save();
      return { ok: true, events: list };
    },
    exportData: async () => ({ ok: false, error: '浏览器预览不支持导出' }),
    importData: async () => ({ ok: false, error: '浏览器预览不支持导入' }),
    setFullScreen: async () => ({ ok: false }),
    openTimetable: () => {
      window.open('timetable.html', '_blank', 'width=1180,height=780');
    },
    closeTimetable: () => {},
    setAutoLaunch: async (v) => ({ ok: true, enabled: v, actual: false }),
    addHistory: async (entry) => {
      store.history = [entry].concat(store.history.filter((h) => h.date !== entry.date));
      save();
      return { ok: true, history: store.history };
    },
    getWeather: async () => {
      const base = new Date();
      const descs = ['多云', '晴', '小雨'];
      const winds = ['东南风 2级', '南风 3级', '北风 3级'];
      const dirs = ['东南风', '南风', '北风'];
      const days = [0, 1, 2].map((i) => {
        const d = new Date(base.getFullYear(), base.getMonth(), base.getDate() + i);
        return {
          date: dateKey(d),
          desc: descs[i],
          max: 22 + i,
          min: 12 + i,
          windDir: dirs[i],
          windLevel: winds[i].split(' ')[1]
        };
      });
      const hours = Array.from({ length: 24 }, (_, i) => ({
        label: i === 0 ? '现在' : `${String((base.getHours() + i) % 24).padStart(2, '0')}时`,
        desc: descs[i % descs.length],
        temp: 18 + Math.round(Math.sin(i / 3) * 3),
        pop: i % 4 === 0 ? 20 : 0
      }));
      return {
        ok: true, city: '杭州', temp: 18, humidity: 62, wind: 8, windDir: '东南风',
        aqi: 42, code: 2, desc: '多云', days, hours, updatedAt: Date.now()
      };
    },
    getWeatherHourly: async () => ({
      ok: true,
      hours: Array.from({ length: 24 }, (_, i) => ({
        label: i === 0 ? '现在' : `${String(i).padStart(2, '0')}时`,
        desc: i % 3 === 0 ? '多云' : (i % 3 === 1 ? '晴' : '小雨'),
        temp: 18 + Math.round(Math.sin(i / 3) * 3),
        pop: i % 4 === 0 ? 20 : 0
      }))
    }),
    checkUpdate: async () => ({ configured: true, ok: true, current: '1.0.0-dev', latest: '1.0.0-dev', hasUpdate: false }),
    downloadUpdate: async () => ({ ok: true }),
    downloadUpdatePackage: async () => ({ ok: false, error: '浏览器预览不支持自动下载' }),
    installUpdate: async () => ({ ok: false, error: '浏览器预览不支持安装' }),
    deferInstall: async () => ({ ok: false, error: '浏览器预览不支持安装' }),
    onUpdateProgress: () => {},
    onUpdateDownloaded: () => {},
    onUpdateError: () => {},
    openClassroom: () => {
      window.open('classroom.html', '_blank', 'width=1120,height=760');
    },
    openClassroomAdmin: () => {
      window.open('classroom.html?admin=1', '_blank', 'width=1120,height=760');
    },
    openExternal: () => {},
    copyText: async () => ({ ok: true }),
    saveImage: async (dataUrl, name) => {
      const a = document.createElement('a');
      a.href = dataUrl;
      a.download = name;
      a.click();
      return { ok: true };
    },
    log: () => {},
    setPetMode: async () => ({ mode: 'panel' }),
    changeScale: async () => ({ scale: store.petScale }),
    openKnowledge: () => {
      window.open('knowledge.html', '_blank', 'width=920,height=680');
    },
    closeKnowledge: () => {},
    petMenu: () => {},
    hideToTray: () => {},
    quit: () => {},
    onModeChanged: () => {},
    onSkinChanged: () => {},
    onScaleChanged: () => {},
    onDebugChanged: () => {},
    onDebugPreview: () => {}
  };
}

boot();
