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
  updateNotesDismissed: '',
  pendingUpdateNotes: false,
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
  lastCourseKey: '',
  lastHomeCourseKey: ''
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
  applyPetScaleVar();
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
  try { state.updateNotesDismissed = localStorage.getItem('gk-update-dismissed') || ''; } catch (e) { /* 忽略 */ }

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
    applyPetScaleVar();
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
    hideUpdateNotes();
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
const FISH_CLASS_LINES = Array.isArray(window.FISH_CLASS_LINES) ? window.FISH_CLASS_LINES : [];
const FISH_CHEER_LINES = Array.isArray(window.FISH_CHEER_LINES) ? window.FISH_CHEER_LINES : [];
const FISH_IDLE_LINES = Array.isArray(window.FISH_IDLE_LINES) ? window.FISH_IDLE_LINES : [];
const FISH_HEAD_LINES = Array.isArray(window.FISH_HEAD_LINES) ? window.FISH_HEAD_LINES : [];
const FISH_POKE_LINES = Array.isArray(window.FISH_POKE_LINES) ? window.FISH_POKE_LINES : [];
const FISH_TAIL_LINES = Array.isArray(window.FISH_TAIL_LINES) ? window.FISH_TAIL_LINES : [];
const FISH_ACTOR_W = 56;
const fishState = {
  phase: '', spokenAt: 0, last: '', hideTimer: null,
  idleAt: 0, idleBusy: false, idleTimer: null, idleMode: '',
  actionBusy: false, actionVideo: null, actionTimer: null, actionMode: '',
  hwFrames: [], hwLoaded: 0, hwFailed: 0, hwLoading: false, hwReady: false, hwRaf: 0, hwStart: 0, hwCtx: null,
  hwAction: null, hwActionLoading: false,
  clickAt: 0, reactionTimer: null, videoMode: ''
};

const HW_FRAME_COUNT = 169;
const HW_FPS = 24;
const HW_ACTION_FRAMES = 121;

/* 放学写作业：气泡台词命中时播放对应的动作片段 */
const HOMEWORK_ACTIONS = [
  { key: 'stretch', lines: ['累了就伸个懒腰', '肩膀放松一点', '写不下去就休息三分钟'] },
  { key: 'water', lines: ['喝口水，再继续'] },
  { key: 'eyes', lines: ['眼睛也要休息'] },
  { key: 'snack', lines: ['想吃点什么就吃点', '夜宵别吃太撑'] },
  { key: 'tidy', lines: ['桌面收拾一下心也静了', '书包整理好再睡'] },
  { key: 'window', lines: ['窗外的风替你加油', '今晚的月亮也在陪你'] },
  { key: 'cheer', lines: ['你可以的', '加油，少年', '今天的你也很棒'] }
];

const IDLE_CLASSES = ['is-idle-look', 'is-idle-hop', 'is-idle-stretch', 'is-idle-wag', 'is-idle-yawn', 'is-idle-snack'];
const FISH_CLIP_IDS = ['petFishStretch', 'petFishYawn', 'petFishEat'];
const FISH_BASE_IDS = ['petFishRun', 'petFishHomework', 'petFishIdle'];
const fishBags = new WeakMap();

/* 词库按乱序抽完再重新洗牌，保证一轮内不重复 */
function fishPickLine(lines) {
  if (!Array.isArray(lines) || !lines.length) return '';
  if (lines.length === 1) return lines[0];
  let bag = fishBags.get(lines);
  if (!bag || !bag.length) {
    bag = lines.slice();
    for (let i = bag.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      const tmp = bag[i];
      bag[i] = bag[j];
      bag[j] = tmp;
    }
    // 新一轮第一句不要和上一句相同
    if (bag[bag.length - 1] === fishState.last) {
      const tmp = bag[bag.length - 1];
      bag[bag.length - 1] = bag[0];
      bag[0] = tmp;
    }
    fishBags.set(lines, bag);
  }
  const line = bag.pop();
  fishState.last = line;
  return line;
}

function fishSay(text) {
  const bubble = $('petFishBubble');
  if (!bubble || !text) return;
  bubble.textContent = text;
  bubble.hidden = false;
  clearTimeout(fishState.hideTimer);
  fishState.hideTimer = setTimeout(() => { bubble.hidden = true; }, 9000);
  fishMaybeHomeworkAction(text);
}

function fishAllVideos() {
  return FISH_BASE_IDS.concat(FISH_CLIP_IDS).map((id) => $(id)).filter(Boolean);
}

function fishPauseVideos(except) {
  fishAllVideos().forEach((video) => {
    if (video !== except && !video.paused) video.pause();
  });
}

/* 播放参考项目里的真实待机动画片段，结束后恢复当前状态 */
function fishPlayClip(video, mode) {
  const wrap = $('petFish');
  if (!wrap || !video || video.readyState < 2 || video.error) return false;
  fishStopAction(false);
  fishState.actionBusy = true;
  fishState.actionVideo = video;
  fishState.actionMode = mode;
  wrap.dataset.action = 'on';
  fishPauseVideos(video);
  video.classList.add('on');
  try { video.currentTime = 0; } catch (e) { /* 忽略 */ }
  const p = video.play();
  if (p && p.catch) p.catch(() => fishStopAction(true));
  const dur = Number.isFinite(video.duration) && video.duration > 0 ? video.duration * 1000 : 10000;
  clearTimeout(fishState.actionTimer);
  fishState.actionTimer = setTimeout(() => fishStopAction(true), dur + 150);
  return true;
}

function fishStopAction(resume) {
  const wrap = $('petFish');
  clearTimeout(fishState.actionTimer);
  fishState.actionTimer = null;
  FISH_CLIP_IDS.forEach((id) => {
    const video = $(id);
    if (!video) return;
    video.classList.remove('on');
    if (!video.paused) video.pause();
    try { video.currentTime = 0; } catch (e) { /* 忽略 */ }
  });
  fishState.actionBusy = false;
  fishState.actionVideo = null;
  fishState.actionMode = '';
  if (wrap) wrap.dataset.action = 'off';
  if (resume !== false) {
    const mode = wrap ? wrap.dataset.mode : 'idle';
    fishSyncVideo(mode);
    fishState.idleAt = Date.now() + (mode === 'idle' ? 22000 + Math.random() * 20000 : 45000 + Math.random() * 35000);
  }
}

/* 待机小动作：优先播放真实动画片段（伸懒腰 / 打哈欠 / 吃 Token），再退回 CSS 小动作 */
function fishIdleAction() {
  const actor = $('petFishActor');
  if (!actor || fishState.idleBusy || fishState.actionBusy || fishState.hwAction || fishState.hwActionLoading) return;
  const wrap = $('petFish');
  const mode = wrap ? wrap.dataset.mode : 'idle';
  if (mode === 'idle' || mode === 'crawl') {
    const clips = FISH_CLIP_IDS
      .map((id) => $(id))
      .filter((v) => v && v.readyState >= 2 && !v.error);
    if (clips.length) {
      const video = clips[Math.floor(Math.random() * clips.length)];
      if (fishPlayClip(video, mode)) {
        fishSay(fishPickLine(FISH_IDLE_LINES));
        return;
      }
    }
  }
  const actions = mode === 'crawl'
    ? ['is-idle-look', 'is-idle-stretch', 'is-idle-wag', 'is-idle-yawn']
    : (mode === 'homework'
      ? ['is-idle-look', 'is-idle-stretch', 'is-idle-yawn', 'is-idle-snack']
      : IDLE_CLASSES);
  const cls = actions[Math.floor(Math.random() * actions.length)];
  actor.classList.remove.apply(actor.classList, IDLE_CLASSES);
  void actor.offsetWidth;
  actor.classList.add(cls);
  fishState.idleBusy = true;
  if (mode === 'idle' || Math.random() < 0.5) fishSay(fishPickLine(FISH_IDLE_LINES));
  clearTimeout(fishState.idleTimer);
  fishState.idleTimer = setTimeout(() => {
    actor.classList.remove(cls);
    fishState.idleBusy = false;
    fishState.idleAt = Date.now() + (mode === 'idle' ? 18000 + Math.random() * 18000 : 30000 + Math.random() * 30000);
  }, 1900);
}

/* 写作业逐帧动画：用无损 WebP 帧代替带 alpha 的视频，彻底避免绿边闪烁 */
function fishLoadHwFrames() {
  if (fishState.hwLoading || fishState.hwReady || fishState.hwFailed) return;
  fishState.hwLoading = true;
  fishState.hwFrames = [];
  let done = 0;
  const finish = () => {
    done++;
    if (done < HW_FRAME_COUNT) return;
    fishState.hwLoading = false;
    const wrap = $('petFish');
    if (fishState.hwFailed || fishState.hwFrames.length !== HW_FRAME_COUNT) {
      if (wrap) wrap.dataset.hwframes = 'off';
      return;
    }
    fishState.hwReady = true;
    if (wrap) wrap.dataset.hwframes = 'on';
    if (wrap && wrap.dataset.mode === 'homework') fishSyncVideo('homework');
  };
  for (let i = 1; i <= HW_FRAME_COUNT; i++) {
    const img = new Image();
    img.onload = finish;
    img.onerror = () => { fishState.hwFailed++; finish(); };
    img.src = 'assets/hw/f' + String(i).padStart(3, '0') + '.webp';
    fishState.hwFrames.push(img);
  }
}

function fishStartHwFrames() {
  if (fishState.hwRaf || !fishState.hwReady) return;
  const canvas = $('petFishHwFrames');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  fishState.hwCtx = ctx;
  fishState.hwStart = 0;
  const tick = (ts) => {
    const wrap = $('petFish');
    if (!fishState.hwReady || !wrap || wrap.dataset.mode !== 'homework' || wrap.dataset.action === 'on') {
      fishState.hwRaf = 0;
      return;
    }
    let img = null;
    if (fishState.hwAction) {
      const act = fishState.hwAction;
      if (!act.start) act.start = ts;
      const idx = Math.floor(((ts - act.start) / 1000) * HW_FPS);
      if (idx >= act.count) {
        fishState.hwAction = null;
        fishState.hwStart = 0;
        img = fishState.hwFrames[0];
      } else {
        img = act.frames[idx];
      }
    } else {
      if (!fishState.hwStart) fishState.hwStart = ts;
      const idx = Math.floor(((ts - fishState.hwStart) / 1000) * HW_FPS) % HW_FRAME_COUNT;
      img = fishState.hwFrames[idx];
    }
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (img && img.complete && img.naturalWidth) ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    fishState.hwRaf = requestAnimationFrame(tick);
  };
  fishState.hwRaf = requestAnimationFrame(tick);
}

function fishStopHwFrames() {
  if (fishState.hwRaf) cancelAnimationFrame(fishState.hwRaf);
  fishState.hwRaf = 0;
  fishState.hwStart = 0;
  fishState.hwAction = null;
  const canvas = $('petFishHwFrames');
  if (!canvas || !fishState.hwCtx) return;
  fishState.hwCtx.clearRect(0, 0, canvas.width, canvas.height);
}

/* 台词命中后加载对应动作帧，播完自动回到写作业循环 */
function fishMaybeHomeworkAction(text) {
  const wrap = $('petFish');
  if (!wrap || wrap.dataset.mode !== 'homework' || !fishState.hwReady) return;
  if (fishState.hwAction || fishState.hwActionLoading) return;
  let key = '';
  for (const action of HOMEWORK_ACTIONS) {
    if (action.lines.indexOf(text) >= 0) {
      key = action.key;
      break;
    }
  }
  if (key) fishLoadHomeworkAction(key);
}

function fishLoadHomeworkAction(key) {
  fishState.hwActionLoading = true;
  const frames = [];
  let done = 0;
  let failed = false;
  const finish = () => {
    if (done < HW_ACTION_FRAMES) return;
    fishState.hwActionLoading = false;
    const wrap = $('petFish');
    if (failed || !fishState.hwReady || !wrap || wrap.dataset.mode !== 'homework') return;
    fishState.hwAction = { key, frames, count: HW_ACTION_FRAMES, start: 0 };
  };
  for (let i = 1; i <= HW_ACTION_FRAMES; i++) {
    const img = new Image();
    img.onload = () => { done++; finish(); };
    img.onerror = () => { failed = true; done++; finish(); };
    img.src = 'assets/hwact/' + key + '/f' + String(i).padStart(3, '0') + '.webp';
    frames.push(img);
  }
}

/* 上课播放 AI 奔跑视频，放学播放写作业视频，空闲播放 breathing 动画 */
function fishSyncVideo(mode) {
  const actionOn = fishState.actionBusy;
  const play = (video, on) => {
    if (!video) return;
    if (on) {
      if (video.paused) {
        const p = video.play();
        if (p && p.catch) p.catch(() => { /* 等用户交互或加载完成 */ });
      }
    } else if (!video.paused) {
      video.pause();
    }
  };
  const hwFramesOn = fishState.hwReady && !actionOn && mode === 'homework';
  play($('petFishRun'), !actionOn && mode === 'crawl');
  play($('petFishHomework'), !actionOn && mode === 'homework' && !hwFramesOn);
  play($('petFishIdle'), !actionOn && mode === 'idle');
  if (hwFramesOn) fishStartHwFrames();
  else fishStopHwFrames();
}

/* 大肥鱼：上课时沿顶部边框爬行表示课堂进度，放学到家后坐在课桌前写作业 */
function renderFish() {
  const wrap = $('petFish');
  const actor = $('petFishActor');
  const track = $('petFishTrack');
  if (!wrap || !actor) return;
  const plan = coursePlan();
  const now = new Date();
  const nowMin = now.getHours() * 60 + now.getMinutes() + now.getSeconds() / 60;
  const first = plan.rows[0];
  let mode = 'idle';
  let progress = 0;
  let phase = '';
  let lines = plan.status === 'empty' ? FISH_IDLE_LINES : FISH_CLASS_LINES;

  if (plan.status === 'done' || plan.status === 'holiday') {
    mode = 'homework';
    phase = 'homework-' + dateKey(now);
    lines = FISH_CHEER_LINES;
  } else if (first && first.tag === '本节课') {
    const course = first.course;
    const span = Math.max(1, course.end - course.start);
    mode = 'crawl';
    progress = Math.min(1, Math.max(0, (nowMin - course.start) / span));
    phase = `class-${course.start}-${course.end}-${course.subject}`;
  } else {
    phase = 'idle-' + (first ? first.course.label + first.course.time : dateKey(now));
  }

  if (fishState.actionBusy && mode !== fishState.actionMode) fishStopAction(false);
  wrap.dataset.mode = mode;
  if (mode === 'homework' && !fishState.hwReady && !fishState.hwLoading && !fishState.hwFailed) fishLoadHwFrames();
  fishSyncVideo(mode);
  const width = wrap.clientWidth || 300;
  const maxLeft = Math.max(4, width - FISH_ACTOR_W - 6);
  const left = mode === 'homework'
    ? Math.round((width - FISH_ACTOR_W) / 2)
    : Math.round(4 + (maxLeft - 4) * progress);

  if (!fishState.actionBusy) {
    if (phase !== fishState.phase) {
      // 新的一节课或刚放学：先归位再恢复过渡，避免从右往左倒着滑
      actor.style.transition = 'none';
      actor.style.left = left + 'px';
      void actor.offsetWidth;
      actor.style.transition = '';
    } else {
      actor.style.left = left + 'px';
    }
  }
  if (track) track.style.width = mode === 'crawl' ? Math.round(progress * 100) + '%' : '0%';

  const bubble = $('petFishBubble');
  if (bubble) {
    if (mode === 'homework') bubble.style.left = '';
    else bubble.style.left = Math.max(6, Math.min(left - 8, width - 200)) + 'px';
  }

  const nowTs = Date.now();
  const interval = mode === 'homework' ? 150000 : 90000;
  if (mode !== fishState.idleMode) {
    fishState.idleMode = mode;
    fishState.idleAt = 0;
  }
  if (!fishState.idleBusy) {
    if (!fishState.idleAt) {
      fishState.idleAt = nowTs + (mode === 'idle' ? 12000 + Math.random() * 10000 : 22000 + Math.random() * 18000);
    } else if (nowTs >= fishState.idleAt) {
      fishIdleAction();
    }
  }
  if (phase !== fishState.phase) {
    fishState.phase = phase;
    fishState.spokenAt = nowTs;
    fishSay(fishPickLine(lines));
  } else if (nowTs - fishState.spokenAt > interval) {
    fishState.spokenAt = nowTs;
    fishSay(fishPickLine(lines));
  }
}

function parseCourseRange(text) {
  const m = String(text || '').match(/(\d{1,2})\s*[:：]\s*(\d{2})\s*[-~—至]\s*(\d{1,2})\s*[:：]\s*(\d{2})/);
  if (!m) return null;
  return { start: Number(m[1]) * 60 + Number(m[2]), end: Number(m[3]) * 60 + Number(m[4]) };
}

const WEEKEND_HOLIDAY_RE = /(放假|假期|休息|黄金周末|黄金周|不上课|停课)/;
function isHolidayText(v) {
  return WEEKEND_HOLIDAY_RE.test(String(v == null ? '' : v));
}
function courseLabelNo(label) {
  const m = String(label || '').match(/(\d+)/);
  return m ? Number(m[1]) : 0;
}

function weekdayCourses(dayIdx, t) {
  return t.periods.map((p, i) => {
    const subject = String((p.cells && p.cells[dayIdx]) || '').trim();
    const range = parseCourseRange(p.time);
    if (!subject || !range) return null;
    return {
      label: p.label || `第${i + 1}节`,
      subject,
      time: String(p.time),
      start: range.start,
      end: range.end,
      holiday: false
    };
  }).filter(Boolean).sort((a, b) => a.start - b.start);
}

/* 标记节假日：从出现关键词的那一节起按放假处理，重新排了具体课程则恢复上课 */
function markWeekendHoliday(list) {
  let on = false;
  list.forEach((p) => {
    const subject = String(p.subject || '').trim();
    if (isHolidayText(subject)) on = true;
    else if (subject) on = false;
    p.holiday = on;
  });
  return list;
}

function entrySortStart(time, label) {
  const range = parseCourseRange(time);
  if (range) return range.start;
  const no = courseLabelNo(label);
  return no ? no * 60 : Number.MAX_SAFE_INTEGER;
}

function weekendDayCourses(dayIdx, date, t) {
  const w = t.weekend && typeof t.weekend === 'object' ? t.weekend : null;
  if (!w || !w.enabled || dayIdx < 5) return null;
  const col = dayIdx - 5;
  const fixed = Array.isArray(w.periods) ? w.periods : [];
  const entries = Array.isArray(w.entries) ? w.entries : [];

  if (w.variable && date) {
    const dayEntries = entries.filter((e) => e && e.date === date && String(e.subject || '').trim());
    if (dayEntries.length) {
      const list = dayEntries.map((e, i) => {
        const fixedPeriod = fixed.find((p) => p.label === e.label) || fixed[i] || null;
        const times = fixedPeriod && Array.isArray(fixedPeriod.times) ? fixedPeriod.times : [];
        const time = String(e.time || times[col] || '');
        const range = parseCourseRange(time);
        const label = e.label || (fixedPeriod && fixedPeriod.label) || `第${i + 1}节`;
        return {
          label,
          subject: String(e.subject).trim(),
          time,
          start: range ? range.start : Number.MAX_SAFE_INTEGER,
          end: range ? range.end : Number.MAX_SAFE_INTEGER,
          sort: entrySortStart(time, label),
          holiday: false
        };
      });
      list.sort((a, b) => a.sort - b.sort);
      return markWeekendHoliday(list);
    }
  }

  const list = fixed.map((p, i) => {
    const subject = String((p.cells && p.cells[col]) || '').trim();
    const times = Array.isArray(p.times) ? p.times : [];
    const time = String(times[col] || '');
    const range = parseCourseRange(time);
    const holiday = isHolidayText(subject);
    // 放假关键词即使没有填写时间也要保留，后面统一按放假处理
    if (!subject || (!range && !holiday)) return null;
    return {
      label: p.label || `第${i + 1}节`,
      subject,
      time,
      start: range ? range.start : Number.MAX_SAFE_INTEGER,
      end: range ? range.end : Number.MAX_SAFE_INTEGER,
      holiday: false
    };
  }).filter(Boolean);
  return markWeekendHoliday(list);
}

function dayPeriods(dayIdx, date) {
  const t = state.timetable;
  if (!t || !Array.isArray(t.periods)) return [];
  const weekend = weekendDayCourses(dayIdx, date, t);
  if (weekend) return weekend;
  return weekdayCourses(dayIdx, t);
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

function timetableHasCourses() {
  const t = state.timetable;
  if (!t) return false;
  if (Array.isArray(t.periods) && t.periods.some((p) => Array.isArray(p.cells) && p.cells.some((c) => String(c || '').trim()))) {
    return true;
  }
  const w = t.weekend;
  if (w && w.enabled) {
    if (Array.isArray(w.periods) && w.periods.some((p) => Array.isArray(p.cells) && p.cells.some((c) => String(c || '').trim()))) {
      return true;
    }
    if (Array.isArray(w.entries) && w.entries.some((e) => e && String(e.subject || '').trim())) {
      return true;
    }
  }
  return false;
}

/* 今日课程安排：本节课 / 未来三节 / 今日无课 / 今日已结束 / 假期愉快 */
function coursePlan() {
  const now = new Date();
  const dayIdx = (now.getDay() + 6) % 7;
  const nowMin = now.getHours() * 60 + now.getMinutes();
  const todayKey = dateKey(now);
  const tomorrowDate = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  const today = dayPeriods(dayIdx, todayKey);
  const tomorrow = dayPeriods((dayIdx + 1) % 7, dateKey(tomorrowDate));
  if (!timetableHasCourses() || !today.length) return { status: 'empty', rows: [] };

  const hasHoliday = today.some((p) => p.holiday);
  const active = today.filter((p) => !p.holiday);
  if (!active.length) return { status: hasHoliday ? 'holiday' : 'done', rows: [] };

  const currentIdx = active.findIndex((p) => nowMin >= p.start && nowMin < p.end);
  const upcoming = active.filter((p) => p.start > nowMin);

  if (currentIdx >= 0) {
    const rows = [{ tag: '本节课', course: active[currentIdx], extraClass: 'now' }];
    const rest = active.slice(currentIdx + 1);
    if (rest.length) {
      rest.slice(0, 2).forEach((p, i) => rows.push({
        tag: i === 0 ? '下节课' : '随后',
        course: p,
        extraClass: ''
      }));
    } else {
      const currentPos = today.indexOf(active[currentIdx]);
      const holidayLater = today.some((p, i) => p.holiday && i > currentPos);
      const nextDay = tomorrow.find((p) => !p.holiday);
      if (holidayLater) {
        rows.push({ tag: '下节课', course: { subject: '假期愉快', time: '放假' }, extraClass: 'holiday' });
      } else if (nextDay) {
        rows.push({ tag: '明天', course: nextDay, extraClass: 'next-day' });
      }
    }
    return { status: 'ok', rows };
  }

  if (upcoming.length) {
    return {
      status: 'ok',
      rows: upcoming.slice(0, 3).map((p, i) => ({
        tag: i === 0 ? '下节课' : '随后',
        course: p,
        extraClass: ''
      }))
    };
  }

  return { status: hasHoliday ? 'holiday' : 'done', rows: [] };
}

function homeCourseRowHtml(row) {
  return (
    `<div class="home-course__row${row.extraClass ? ' ' + row.extraClass : ''}">` +
    `<span class="home-course__tag">${row.tag}</span>` +
    `<b>${escapeHtml(row.course.subject)}</b>` +
    `<i>${escapeHtml(row.course.time)}</i>` +
    '</div>'
  );
}

function renderPetCourse() {
  const listEl = $('petCourseList');
  if (!listEl) return;
  const plan = coursePlan();
  const key = `${dateKey()}-${plan.status}-${plan.rows.map((r) => r.tag + r.course.subject + r.course.time).join('|')}`;
  if (key === state.lastCourseKey) return;
  state.lastCourseKey = key;
  $('petCourseDay').textContent = plan.rows.some((r) => r.tag === '明天') ? '明天' : '今天';

  if (plan.status === 'empty') {
    listEl.innerHTML =
      '<div class="pet-course__empty"><b>今日没有课程</b>' +
      `<span>${escapeHtml(petMotto())}</span></div>`;
    return;
  }
  if (plan.status === 'done') {
    listEl.innerHTML =
      '<div class="pet-course__done"><b>今日课程已完成</b>' +
      `<span>${escapeHtml(petMotto())}</span></div>`;
    return;
  }
  if (plan.status === 'holiday') {
    listEl.innerHTML =
      '<div class="pet-course__done pet-course__holiday"><b>假期愉快</b>' +
      `<span>${escapeHtml(petMotto())}</span></div>`;
    return;
  }
  listEl.innerHTML = plan.rows.map((r) => courseRowHtml(r.tag, r.course, r.extraClass)).join('');
}

function renderHomeCourse() {
  const listEl = $('homeCourseList');
  if (!listEl) return;
  const plan = coursePlan();
  const key = `${dateKey()}-${plan.status}-${plan.rows.map((r) => r.tag + r.course.subject + r.course.time).join('|')}`;
  if (key === state.lastHomeCourseKey) return;
  state.lastHomeCourseKey = key;
  $('homeCourseDay').textContent = plan.rows.some((r) => r.tag === '明天') ? '明天' : '今天';

  if (plan.status === 'empty') {
    listEl.innerHTML =
      '<div class="home-course__empty"><b>今日没有课程</b>' +
      `<span>${escapeHtml(petMotto())}</span>` +
      '<em>点击卡片添加课程表</em></div>';
    return;
  }
  if (plan.status === 'done') {
    listEl.innerHTML =
      '<div class="home-course__done"><b>今日课程已完成</b>' +
      `<span>${escapeHtml(petMotto())}</span></div>`;
    return;
  }
  if (plan.status === 'holiday') {
    listEl.innerHTML =
      '<div class="home-course__done home-course__holiday"><b>假期愉快</b>' +
      `<span>${escapeHtml(petMotto())}</span></div>`;
    return;
  }
  listEl.innerHTML = plan.rows.map(homeCourseRowHtml).join('');
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
  renderHomeCourse();
  renderFish();
}

function renderVersion(v) {
  if (v) $('versionLabel').textContent = 'v' + v;
}

/* 桌宠尺寸变化时，字体与布局通过 zoom 一起放大或缩小 */
function applyPetScaleVar() {
  const scale = Number(state.petScale) || 1;
  document.body.style.setProperty('--pet-scale', String(scale));
}

function renderAll() {
  state.lastDays = null;
  state.lastCourseKey = '';
  state.lastHomeCourseKey = '';
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
  setTimeout(() => { if (state.pendingUpdateNotes) maybeShowUpdateNotes(); }, 400);
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
  setTimeout(() => { if (state.pendingUpdateNotes) maybeShowUpdateNotes(); }, 420);
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

function updateNotesOpen() {
  const modal = $('updateNotesModal');
  return !!modal && !modal.hidden;
}

/* 宠物模式下窗口只有 320×428 且不可聚焦，更新弹窗会被裁掉或点不到；
   需要用户操作的更新提示先切回主界面再显示 */
async function ensurePanelForUpdate() {
  if (state.mode !== 'pet') return;
  try { await bridge.setPetMode(false); } catch (e) { /* 忽略 */ }
  await wait(150);
}

async function showUpdateNotes() {
  await ensurePanelForUpdate();
  const info = state.updateInfo;
  if (!info || !info.ok || !info.hasUpdate) return;
  $('updateNotesVersion').textContent = info.latest || '';
  const list = $('updateNotesList');
  const items = updateHighlights();
  list.innerHTML = items.length
    ? items.map((text) => `<li>${escapeHtml(text)}</li>`).join('')
    : '<li>本次更新带来了一些改进与修复</li>';
  $('updateNotesModal').hidden = false;
  renderUpdateNotes();
}

function hideUpdateNotes() {
  $('updateNotesModal').hidden = true;
}

function renderUpdateNotes() {
  if (!updateNotesOpen()) return;
  const info = state.updateInfo;
  const dl = state.updateDownload;
  if (!info || !info.ok || !info.hasUpdate) {
    hideUpdateNotes();
    return;
  }
  const status = $('updateNotesStatus');
  const btn = $('btnUpdateNotesNow');
  const progress = $('updateNotesProgress');
  const fill = $('updateNotesProgressFill');
  if (dl.phase === 'downloading' || info.downloading) {
    const pct = Math.max(0, Math.min(99, dl.percent || 0));
    progress.hidden = false;
    fill.style.width = pct + '%';
    status.textContent = `正在后台下载安装包 ${pct}%`;
    btn.disabled = true;
    btn.textContent = '下载中…';
    return;
  }
  progress.hidden = true;
  btn.disabled = false;
  if (dl.phase === 'ready') {
    status.textContent = '安装包已下载完成，点击「立即安装」重启更新';
    btn.textContent = '立即安装';
    return;
  }
  if (dl.phase === 'error') {
    status.textContent = '下载失败，可重试或在设置中手动下载';
    btn.textContent = '重新下载';
    return;
  }
  status.textContent = '可立即更新，或稍后再试';
  btn.textContent = '现在更新';
}

function dismissUpdateNotes() {
  const info = state.updateInfo;
  if (info && info.latest) {
    state.updateNotesDismissed = info.latest;
    try { localStorage.setItem('gk-update-dismissed', info.latest); } catch (e) { /* 忽略 */ }
  }
  hideUpdateNotes();
}

function maybeShowUpdateNotes(force) {
  const info = state.updateInfo;
  if (!info || !info.ok || !info.hasUpdate) return;
  if (!force && state.updateNotesDismissed === info.latest) return;
  if (!force) {
    const busy = !$('onboard').hidden || !$('firstDraw').hidden || !$('drawModal').hidden;
    if (busy) {
      state.pendingUpdateNotes = true;
      return;
    }
  }
  state.pendingUpdateNotes = false;
  showUpdateNotes();
}

async function showUpdateReadyDialog() {
  const dl = state.updateDownload;
  if (!dl.filePath) return;
  await ensurePanelForUpdate();
  $('readyVersion').textContent = dl.version || (state.updateInfo && state.updateInfo.latest) || '';
  $('updateReadyModal').hidden = false;
}

function hideUpdateReadyDialog() {
  $('updateReadyModal').hidden = true;
}

function renderUpdateUI() {
  renderUpdateNotes();
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
  // 手动检查时重新显示更新内容
  if (!silent) {
    state.updateNotesDismissed = '';
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
    maybeShowUpdateNotes(!silent);
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
  setTimeout(() => { if (state.pendingUpdateNotes) maybeShowUpdateNotes(); }, 1000);
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
  applyPetScaleVar();
  document.body.setAttribute('data-mode', state.mode);
  if (state.mode !== 'pet') {
    if (fishState.actionBusy) fishStopAction(false);
    fishState.hwActionLoading = false;
    fishStopHwFrames();
    fishPauseVideos();
  }
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
  const fishVideos = ['petFishRun', 'petFishHomework']
    .map((id) => $(id))
    .filter(Boolean);
  if (fishVideos.length) {
    const wrap = $('petFish');
    const ready = new Set();
    const mark = () => {
      if (!wrap) return;
      wrap.dataset.video = ready.size === fishVideos.length ? 'on' : 'off';
    };
    fishVideos.forEach((video) => {
      const id = video.id;
      const on = () => { if (video.readyState >= 2) { ready.add(id); mark(); } };
      const off = () => { ready.delete(id); mark(); };
      video.addEventListener('loadeddata', on);
      video.addEventListener('error', off);
      if (video.readyState >= 2) ready.add(id);
    });
    mark();
  }
  const idleVideo = $('petFishIdle');
  if (idleVideo) {
    const wrap = $('petFish');
    const markIdle = () => {
      if (wrap) wrap.dataset.idlevideo = idleVideo.readyState >= 2 && !idleVideo.error ? 'on' : 'off';
    };
    idleVideo.addEventListener('loadeddata', markIdle);
    idleVideo.addEventListener('error', markIdle);
    markIdle();
  }
  FISH_CLIP_IDS.forEach((id) => {
    const video = $(id);
    if (!video) return;
    video.addEventListener('ended', () => {
      if (fishState.actionVideo === video) fishStopAction(true);
    });
  });
  document.querySelectorAll('.pet-fish__hit').forEach((el) => {
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      if (state.mode !== 'pet') return;
      if (Date.now() - fishState.clickAt < 1200) return;
      fishState.clickAt = Date.now();
      const part = el.dataset.fishPart || 'body';
      const lines = part === 'head' ? FISH_HEAD_LINES : (part === 'tail' ? FISH_TAIL_LINES : FISH_POKE_LINES);
      const cls = part === 'head' ? 'is-pet-head' : (part === 'tail' ? 'is-pet-tail' : 'is-pet-body');
      const actor = $('petFishActor');
      if (!actor) return;
      actor.classList.remove.apply(actor.classList, ['is-pet-head', 'is-pet-body', 'is-pet-tail'].concat(IDLE_CLASSES));
      void actor.offsetWidth;
      actor.classList.add(cls);
      fishSay(fishPickLine(lines));
      clearTimeout(fishState.reactionTimer);
      fishState.reactionTimer = setTimeout(() => actor.classList.remove(cls), 800);
    });
  });
  $('btnDraw').addEventListener('click', () => startDrawFlow(false));
  $('btnDrawSide').addEventListener('click', () => startDrawFlow(false));
  $('btnKnowledge').addEventListener('click', () => bridge.openKnowledge());
  const openTimetable = () => bridge.openTimetable();
  $('homeCourseCard').addEventListener('click', openTimetable);
  $('homeCourseCard').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      openTimetable();
    }
  });
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

  // 更新内容弹窗
  $('btnUpdateNotesClose').addEventListener('click', dismissUpdateNotes);
  $('btnUpdateNotesLater').addEventListener('click', () => {
    dismissUpdateNotes();
    toast('已收起更新内容，可在设置中更新');
  });
  $('btnUpdateNotesNow').addEventListener('click', async () => {
    const info = state.updateInfo;
    const dl = state.updateDownload;
    if (!info) return;
    if (dl.phase === 'downloading') return toast('安装包正在下载，请稍候');
    if (dl.phase === 'ready') {
      hideUpdateNotes();
      showUpdateReadyDialog();
      return;
    }
    if (info.setupMirrors && info.setupMirrors.length) {
      startUpdateDownload(info);
      toast('已开始后台下载更新');
      return;
    }
    const urls = [];
    if (Array.isArray(info.portableMirrors)) urls.push(...info.portableMirrors);
    if (Array.isArray(info.mirrors)) urls.push(...info.mirrors);
    if (urls.length) bridge.downloadUpdate(urls);
    else if (info.pageUrl) bridge.openExternal(info.pageUrl);
    else toast('版本清单未提供下载地址');
  });
  document.querySelectorAll('[data-close="updateNotes"]').forEach((el) => {
    el.addEventListener('click', dismissUpdateNotes);
  });

  // 更新下载完成弹窗
  $('btnUpdateRestart').addEventListener('click', async () => {
    const dl = state.updateDownload;
    if (!dl.filePath) return;
    state.updateInstallStarted = true;
    hideUpdateReadyDialog();
    toast('正在自动安装并重启…');
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
      else if (!$('updateNotesModal').hidden) dismissUpdateNotes();
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
