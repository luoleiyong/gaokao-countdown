'use strict';
/* 高考倒计时 · 渲染进程逻辑
   倒计时 / 每日幸运签 / 签运簿 / 设置 / 桌面宠物 / 签卡导出 */

const $ = (id) => document.getElementById(id);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

const SIGNS = Array.isArray(window.SIGNS) ? window.SIGNS : [];
/* 签池总数由 signs.js 决定，主页不直接展示总数 */
const SIGN_TOTAL = SIGNS.length || 280;
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
/* 桌宠台词与动作频率：以当前（慢）为 1 倍，整体缩放各类触发间隔 */
const PET_FREQ_META = [
  { id: 'quiet', name: '安静', mult: 3 },
  { id: 'slow', name: '慢', mult: 1 },
  { id: 'fast', name: '快', mult: 0.55 },
  { id: 'ultra', name: '极快', mult: 0.3 }
];

const state = {
  targetDate: '2027-06-07',
  skin: 'board',
  petScale: 1,
  petFreq: 'slow',
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
  testPetState: '',
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
  backupPath: '',
  backupCustom: false,
  backupFallback: false,
  backupDefaultPath: '',
  lastCourseKey: '',
  lastHomeCourseKey: '',
  aiEnabled: false,
  aiProvider: 'kilo',
  aiProviderName: 'Kilo 免费池',
  aiBaseUrl: '',
  aiModel: '',
  aiModelUsed: '',
  aiTopic: '每日热点',
  aiHasKey: false,
  aiNoKey: false,
  aiAutoModel: true,
  aiCustomModels: [],
  aiModels: [],
  aiLoginUrl: '',
  aiKeyUrl: '',
  aiAuthUrl: '',
  aiReady: true,
  aiReadyError: '',
  aiProviders: [],
  aiModelList: [],
  aiCustomDraft: null,
  aiKeyDraft: '',
  aiTesting: false,
  /* AI 助手抽屉的两个开关：初值 true，打开抽屉时按 aiConfig() 校准 */
  aiThink: true,
  aiWeb: true
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

/* 测试版：更新检查走假数据，不访问 GitHub */
function isTestBuildClient() {
  return !!state.testMode || /-test/i.test(state.version);
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

/* 倒计时天数 → 签池索引：13 与签池总数互质，一个完整周期内逐日不重复 */
function signIndexFor(days) {
  const d = ((days % SIGN_TOTAL) + SIGN_TOTAL) % SIGN_TOTAL;
  return (d * 13 + 7) % SIGN_TOTAL;
}
function todaySignObj() {
  // 彩蛋当天的签文主题与当天动画主题保持一致
  const eggDay = todayEggDay();
  if (eggDay != null) {
    const meta = MILESTONE_EGGS[eggDay];
    const pool = SIGNS.filter((s) => s.tag === meta.signPick);
    if (pool.length) {
      const days = calc().days;
      const idx = ((days % pool.length) + pool.length) % pool.length;
      return Object.assign({}, pool[idx], { tag: meta.signTag });
    }
  }
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
  state.petFreq = PET_FREQ_META.some((f) => f.id === s.petFreq) ? s.petFreq : 'slow';
  applyPetScaleVar();
  state.autoLaunch = !!s.autoLaunch;
  state.history = Array.isArray(s.history) ? s.history : [];
  state.today = init.today || dateKey();
  state.isFirstToday = !!init.isFirstToday;
  state.mode = init.mode || 'panel';
  state.updateUrl = s.updateUrl || '';
  state.weatherCity = s.weatherCity || '';
  state.version = init.version || '1.0.0';
  state.testMode = !!init.testMode;
  window.__gkTestMode = state.testMode;
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
  state.backupPath = s.backupPath || '';
  state.backupCustom = !!s.backupCustom;
  state.backupFallback = !!s.backupFallback;
  state.backupDefaultPath = s.backupDefaultPath || '';
  state.aiEnabled = s.aiEnabled !== false;
  state.aiProvider = s.aiProvider || 'zhipu';
  state.aiProviderName = s.aiProviderName || '智谱 GLM';
  state.aiBaseUrl = s.aiBaseUrl || '';
  state.aiModel = s.aiModel || '';
  state.aiTopic = s.aiTopic || '每日热点';
  state.aiHasKey = !!s.aiHasKey;
  state.aiLoginUrl = s.aiLoginUrl || '';
  state.aiKeyUrl = s.aiKeyUrl || '';
  state.aiAuthUrl = s.aiAuthUrl || '';
  state.aiReady = s.aiReady !== false;
  state.aiReadyError = s.aiReadyError || '';
  state.debug = !!s.debugMode;
  state.onboarded = !!s.onboarded;
  state.onboardAutoLaunch = state.autoLaunch;
  state.updateAutoCheck = s.updateAutoCheck !== false;
  state.updateAutoDownload = s.updateAutoDownload !== false;
  try { state.updateNotesDismissed = localStorage.getItem('gk-update-dismissed') || ''; } catch (e) { /* 忽略 */ }

  applySkin(state.skin);
  renderVersion(init.version);
  bindEvents();
  // 测试版才加载控制面板脚本，正式版包内不会出现入口
  if (state.testMode) {
    const script = document.createElement('script');
    script.src = 'testpanel.js';
    document.body.appendChild(script);
  }
  renderSkinGrid();
  renderPetFreq();
  renderAll();
  tick();

  bridge.onModeChanged((data) => { closePetMenu(); onModeChanged(data); });
  bridge.onSkinChanged((data) => {
    state.skin = data.skin;
    applySkin(state.skin);
    renderSkinGrid();
  });
  bridge.onScaleChanged((data) => {
    closePetMenu();
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
  // 自动检测更新（可在设置中关闭），每 6 小时静默检测一次；测试版不自动联网检查
  if (state.updateAutoCheck && !isTestBuildClient()) {
    setTimeout(() => checkUpdates(true), 1800);
  }
  setInterval(() => {
    if (state.updateAutoCheck && !isTestBuildClient()) checkUpdates(true);
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
  // 倒计时里程碑彩蛋：今天正好命中 200 / 100 / 30 天或高考日时展示
  setTimeout(maybeTodayEgg, 2600);
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

  // 由倒计时天数反推点亮的签数；主页只显示已开启数量，不暴露签池总数
  const days = calc().days;
  const pending = Math.max(0, Math.min(SIGN_TOTAL, days));
  const lit = SIGN_TOTAL - pending;
  $('openCount').textContent = pending === 0 ? '今日全签点亮' : `已开启 ${lit} 签`;
  $('waitCount').textContent = pending === 0 ? '愿你所求皆如愿' : '今日一签 · 静待落笔';
  $('openCount').setAttribute('data-all', pending === 0 ? '1' : '0');

  // 当天命中彩蛋时才显示入口，其他时间隐藏
  const eggDay = todayEggDay();
  const dayEggBtn = $('btnDayEgg');
  if (dayEggBtn) {
    dayEggBtn.hidden = eggDay == null;
    dayEggBtn.dataset.eggDay = eggDay == null ? '' : String(eggDay);
  }
  const eggResetBtn = $('btnEggReset');
  if (eggResetBtn) {
    eggResetBtn.hidden = eggDay == null;
    eggResetBtn.dataset.eggDay = eggDay == null ? '' : String(eggDay);
  }
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
const FISH_EGG_PREVIEW_LINES = (window.FISH_EGG_PREVIEW_LINES && typeof window.FISH_EGG_PREVIEW_LINES === 'object')
  ? window.FISH_EGG_PREVIEW_LINES
  : {};
const FISH_ACTOR_W = 56;
const fishState = {
  phase: '', spokenAt: 0, last: '', hideTimer: null,
  idleAt: 0, idleBusy: false, idleTimer: null, idleMode: '',
  actionBusy: false, actionVideo: null, actionTimer: null, actionMode: '',
  hwFrames: [], hwLoaded: 0, hwFailed: 0, hwLoading: false, hwReady: false, hwRaf: 0, hwStart: 0, hwCtx: null,
  hwAction: null, hwActionLoading: false, hwActionAt: 0, hwActionBag: [], hwLastTs: 0,
  hwActionCache: new Map(), panelPaused: false,
  clickAt: 0, reactionTimer: null, videoMode: ''
};

const HW_FRAME_COUNT = 169;
const HW_FPS = 24;
const HW_ACTION_FRAMES = 121;
/* 互动动作统一放慢到 20fps，整段约 6 秒，避免动作一闪而过 */
const HW_ACTION_FPS = 20;

/* 放学写作业：气泡台词命中时播放对应的动作片段 */
const HOMEWORK_ACTIONS = [
  { key: 'stretch', lines: ['累了就伸个懒腰', '肩膀放松一点', '写不下去就休息三分钟'] },
  { key: 'water', lines: ['喝口水，再继续'] },
  { key: 'eyes', lines: ['眼睛也要休息'] },
  { key: 'think', lines: ['这道题怎么想不出来', '让我再想想', '这一步卡住了'] },
  { key: 'ponder', lines: ['先理一理思路', '托腮想一想', '换个角度试试'] },
  { key: 'snack', lines: ['想吃点什么就吃点', '夜宵别吃太撑'] },
  { key: 'hungry', lines: ['肚子有点饿了', '什么时候开饭', '有点想吃东西了'] },
  { key: 'crave', lines: ['抽屉里好像还有零食', '偷偷吃一口', '写完这页就吃点'] },
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

/* 明天命中彩蛋时，气泡会和正常台词一样随机出现预告，不限次数 */
function fishPickScheduledLine(lines) {
  const egg = tomorrowEggDay();
  if (egg != null) {
    const pool = FISH_EGG_PREVIEW_LINES[egg];
    if (Array.isArray(pool) && pool.length && Math.random() < 0.5) {
      return fishPickLine(pool);
    }
  }
  return fishPickLine(lines);
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
    fishState.idleAt = Date.now() + petFreqDelay(mode === 'idle' ? 22000 + Math.random() * 20000 : 45000 + Math.random() * 35000);
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
    fishState.idleAt = Date.now() + petFreqDelay(mode === 'idle' ? 18000 + Math.random() * 18000 : 30000 + Math.random() * 30000);
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
  fishState.hwLastTs = 0;
  const tick = (ts) => {
    const wrap = $('petFish');
    if (!fishState.hwReady || !wrap || wrap.dataset.mode !== 'homework' || wrap.dataset.action === 'on') {
      fishState.hwRaf = 0;
      return;
    }
    /* 窗口被遮挡/最小化时 rAF 会暂停，恢复后跳过间隔而不是把动作直接播完 */
    if (fishState.hwLastTs && ts - fishState.hwLastTs > 500) {
      const gap = ts - fishState.hwLastTs;
      if (fishState.hwAction) fishState.hwAction.start += gap;
      if (fishState.hwStart) fishState.hwStart += gap;
    }
    fishState.hwLastTs = ts;
    let img = null;
    if (fishState.hwAction) {
      const act = fishState.hwAction;
      if (!act.start) act.start = ts;
      const idx = Math.floor(((ts - act.start) / 1000) * HW_ACTION_FPS);
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
  fishState.hwLastTs = 0;
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
  if (key) {
    // 台词本身命中时也顺延下一次定时动作，避免连续播放
    fishState.hwActionAt = Date.now() + petFreqDelay(95000 + Math.random() * 45000);
    fishLoadHomeworkAction(key);
  }
}

/* 定时动作按一轮洗牌抽取，保证 7 个动作轮流出现，不会长时间只重复一个 */
function fishPickHomeworkAction() {
  if (!fishState.hwActionBag || !fishState.hwActionBag.length) {
    const bag = HOMEWORK_ACTIONS.map((a) => a.key);
    for (let i = bag.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      const tmp = bag[i];
      bag[i] = bag[j];
      bag[j] = tmp;
    }
    fishState.hwActionBag = bag;
  }
  const key = fishState.hwActionBag.pop();
  return HOMEWORK_ACTIONS.find((a) => a.key === key) || HOMEWORK_ACTIONS[0];
}

/* 动作帧缓存：同一组动作命中第二次时直接复用已解码的帧，省掉 121 次加载与解码。
   每组约 34MB 解码内存，只保留最近 2 组，避免常驻占用过高。 */
const HW_ACTION_CACHE_MAX = 2;

function fishUseHomeworkActionFrames(key, frames) {
  const wrap = $('petFish');
  if (!fishState.hwReady || !wrap || wrap.dataset.mode !== 'homework') return;
  fishState.hwAction = { key, frames, count: frames.length, start: 0 };
}

function fishLoadHomeworkAction(key) {
  const cache = fishState.hwActionCache;
  const cached = cache.get(key);
  if (cached) {
    // 命中后移到队尾，保证最近使用的最后被淘汰
    cache.delete(key);
    cache.set(key, cached);
    fishState.hwActionLoading = false;
    fishUseHomeworkActionFrames(key, cached);
    return;
  }
  fishState.hwActionLoading = true;
  const frames = [];
  let done = 0;
  let failed = false;
  const finish = () => {
    if (done < HW_ACTION_FRAMES) return;
    fishState.hwActionLoading = false;
    if (failed || !fishState.hwReady) return;
    cache.set(key, frames);
    while (cache.size > HW_ACTION_CACHE_MAX) {
      const oldest = cache.keys().next().value;
      cache.delete(oldest);
    }
    fishUseHomeworkActionFrames(key, frames);
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

/* 写作业台词：通用鼓励 + 设置中勾选科目的知识提醒，科目变化时重新合并 */
let homeworkLineCache = null;
let homeworkLineKey = '';
function homeworkLines() {
  const key = state.selectedSubjects.join(',');
  if (homeworkLineCache && homeworkLineKey === key) return homeworkLineCache;
  homeworkLineKey = key;
  const extra = [];
  const table = window.FISH_SUBJECT_LINES || {};
  state.selectedSubjects.forEach((id) => {
    const list = Array.isArray(table[id]) ? table[id] : [];
    list.forEach((line) => { if (line) extra.push(line); });
  });
  homeworkLineCache = FISH_CHEER_LINES.concat(extra);
  return homeworkLineCache;
}

/* 大肥鱼：上课时沿顶部边框爬行表示课堂进度，放学到家后坐在课桌前写作业 */
function renderFish() {
  const wrap = $('petFish');
  const actor = $('petFishActor');
  const track = $('petFishTrack');
  if (!wrap || !actor) return;
  /* 主界面模式下宠物整块不可见：停掉逐帧 canvas 与视频，避免后台白跑动画 */
  if (state.mode !== 'pet') {
    if (!fishState.panelPaused) {
      fishState.panelPaused = true;
      if (fishState.hwRaf) fishStopHwFrames();
      fishPauseVideos();
    }
    return;
  }
  fishState.panelPaused = false;
  const plan = coursePlan();
  const now = new Date();
  const nowMin = now.getHours() * 60 + now.getMinutes() + now.getSeconds() / 60;
  const first = plan.rows[0];
  let mode = 'idle';
  let progress = 0;
  let phase = '';
  let lines = plan.status === 'empty' ? FISH_IDLE_LINES : FISH_CLASS_LINES;

  if (plan.status === 'done' || plan.status === 'holiday' || plan.status === 'empty') {
    mode = 'homework';
    phase = 'homework-' + dateKey(now);
    lines = homeworkLines();
  } else if (first && first.tag === '本节课') {
    const course = first.course;
    const span = Math.max(1, course.end - course.start);
    mode = 'crawl';
    progress = Math.min(1, Math.max(0, (nowMin - course.start) / span));
    phase = `class-${course.start}-${course.end}-${course.subject}`;
  } else {
    phase = 'idle-' + (first ? first.course.label + first.course.time : dateKey(now));
  }

  // 测试面板：强制上课 / 放学状态，便于演示与验收
  if (state.testPetState === 'crawl') {
    mode = 'crawl';
    progress = 0.5;
    phase = 'test-crawl';
    lines = FISH_CLASS_LINES;
  } else if (state.testPetState === 'homework') {
    mode = 'homework';
    phase = 'test-homework';
    lines = homeworkLines();
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
  const interval = petFreqDelay(mode === 'homework' ? 150000 : 90000);
  if (mode !== fishState.idleMode) {
    fishState.idleMode = mode;
    fishState.idleAt = 0;
  }
  if (!fishState.idleBusy) {
    if (!fishState.idleAt) {
      fishState.idleAt = nowTs + petFreqDelay(mode === 'idle' ? 12000 + Math.random() * 10000 : 22000 + Math.random() * 18000);
    } else if (nowTs >= fishState.idleAt) {
      fishIdleAction();
    }
  }
  if (phase !== fishState.phase) {
    fishState.phase = phase;
    fishState.spokenAt = nowTs;
    fishSay(fishPickScheduledLine(lines));
  } else if (nowTs - fishState.spokenAt > interval) {
    fishState.spokenAt = nowTs;
    fishSay(fishPickScheduledLine(lines));
  }

  /* 写作业动作定时出现：按当前频率档位缩放，保证实际使用时能看到动作 */
  if (mode === 'homework') {
    if (!fishState.hwReady) {
      fishState.hwActionAt = 0;
    } else if (!fishState.hwAction && !fishState.hwActionLoading && !fishState.idleBusy && !fishState.actionBusy) {
      if (!fishState.hwActionAt) {
        fishState.hwActionAt = nowTs + petFreqDelay(35000 + Math.random() * 15000);
      } else if (nowTs >= fishState.hwActionAt) {
        fishState.hwActionAt = nowTs + petFreqDelay(95000 + Math.random() * 45000);
        const action = fishPickHomeworkAction();
        fishState.spokenAt = nowTs;
        fishSay(action.lines[Math.floor(Math.random() * action.lines.length)]);
      }
    }
  } else {
    fishState.hwActionAt = 0;
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

/* 桌宠频率：按当前档位缩放间隔，最低 8 秒，避免极快档过于频繁 */
function petFreqMult() {
  const meta = PET_FREQ_META.find((f) => f.id === state.petFreq);
  return meta ? meta.mult : 1;
}
function petFreqDelay(base) {
  return Math.max(8000, Math.round(base * petFreqMult()));
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
    maybeTodayEgg();
  } else if (c.days !== state.lastDays) {
    state.lastDays = c.days;
    renderToday();
    renderHistory();
    renderPet();
    maybeTodayEgg();
  } else {
    renderPet();
  }
}

/* 当天命中的彩蛋：高考日 0 天，或 200 / 100 / 30 天 */
function isExamDay() {
  return dateKey() === state.targetDate;
}

function todayEggDay() {
  if (isExamDay()) return 0;
  const days = calc().days;
  if (days === 0) return null;
  return MILESTONE_EGGS[days] ? days : null;
}

/* 明天命中的彩蛋日：用于桌宠提前一天暗示 */
function tomorrowEggDay() {
  const t = new Date();
  t.setHours(0, 0, 0, 0);
  t.setDate(t.getDate() + 1);
  if (dateKey(t) === state.targetDate) return 0;
  const days = calc().days - 1;
  if (days <= 0) return null;
  return MILESTONE_EGGS[days] ? days : null;
}

/* 彩蛋可以重复触发：自动只在当天播一次，之后通过按钮手动重播 */
function maybeTodayEgg() {
  const days = todayEggDay();
  if (days == null) return;
  if (msEggPending != null || !$('msEgg').hidden) return;
  const key = 'gk-egg-auto-' + days + '-' + state.targetDate;
  // 刚点过「重置彩蛋播放」的当天不立即补弹，留到下次打开程序
  if (msEggResetHold === key) return;
  try {
    if (localStorage.getItem(key)) return;
  } catch (e) {
    return;
  }
  msEggAutoKey = key;
  msEggPending = days;
  setTimeout(tryShowMilestoneEgg, 0);
}

/* 真正展示后记下当天已自动播过，避免切换页面或 renderAll 后重复弹出 */
function markAutoEggShown() {
  if (!msEggAutoKey) return;
  try { localStorage.setItem(msEggAutoKey, '1'); } catch (e) { /* 忽略 */ }
  msEggAutoKey = '';
}

/* ---------------- 倒计时里程碑 / 高考日彩蛋 ---------------- */
const MILESTONE_EGGS = {
  0: {
    eyebrow: '高考日 · 全部签',
    title: '今日，去赴那场笃定的约',
    sub: '从第一支签到最后一支签，每一页都算数。',
    seal: '全',
    button: '收下这份笃定',
    tone: '#d9b64a',
    fx: 'star',
    stars: true,
    signTag: '赴约',
    signPick: '考场'
  },
  200: {
    eyebrow: '倒计时 200 天',
    title: '二百日 · 已在半山',
    sub: '回头看，你已经走了这么远；往前看，峰顶的光正在等你。',
    seal: '进',
    button: '收下这份底气',
    tone: '#9fc0ff',
    fx: 'star',
    signTag: '半山',
    signPick: '坚持'
  },
  100: {
    eyebrow: '倒计时 100 天',
    title: '百日 · 万卷归一',
    sub: '一百天，足够把会的变稳，把稳的变成分数。',
    seal: '破',
    button: '收下这份锐气',
    tone: '#d9b64a',
    fx: 'petal',
    signTag: '万卷',
    signPick: '学业'
  },
  30: {
    eyebrow: '倒计时 30 天',
    title: '三十日 · 落笔如收剑',
    sub: '不追新题，不惧旧错，把每一天过成考场上的一分从容。',
    seal: '定',
    button: '收下这份从容',
    tone: '#d98a6a',
    fx: 'ember',
    signTag: '收剑',
    signPick: '技巧'
  }
};
let msEggPending = null;
let msEggAutoKey = '';
let msEggResetHold = '';
let msEggFullscreen = false;
let msEggFxRaf = 0;
let msEggDays = 0;
let msEggStage = 'idle';
let msEggGuardTimer = null;
/* 彩蛋背景视频：加载成功用视频，失败时回退到 Canvas 粒子 */
const MS_EGG_VIDEO = {
  0: 'assets/ms/ms-0.mp4',
  200: 'assets/ms/ms-200.mp4',
  100: 'assets/ms/ms-100.mp4',
  30: 'assets/ms/ms-30.mp4'
};

/* 准备背景视频：只显示首帧，等用户点击后再播放 */
function setupMsEggVideo(el, days) {
  const video = $('msEggVideo');
  if (!video) return;
  el.removeAttribute('data-video');
  const src = MS_EGG_VIDEO[days];
  if (!src) return;
  // 先把已有的首帧状态记下来：跳回 0 秒会让 readyState 短暂下降
  const hadFrame = video.readyState >= 2 || video.videoWidth > 0;
  video.onplaying = () => {
    if (!$('msEgg').hidden) el.setAttribute('data-video', 'on');
  };
  video.onseeked = () => {
    if (!$('msEgg').hidden) el.setAttribute('data-video', 'on');
  };
  video.onloadeddata = () => {
    if ($('msEgg').hidden) return;
    el.setAttribute('data-video', 'on');
    // 卡片已经弹出时视频才加载好，停掉兜底粒子，避免后台空转
    if (msEggStage === 'card') msEggStopFx();
  };
  video.onended = () => showMsEggCard();
  video.onerror = () => {
    el.removeAttribute('data-video');
    if (msEggStage === 'card') {
      const meta = MILESTONE_EGGS[msEggDays];
      if (meta) msEggStartFx(meta.fx, meta.tone);
    } else {
      showMsEggCard();
    }
  };
  if (video.getAttribute('src') !== src) {
    video.setAttribute('src', src);
    try { video.load(); } catch (e) { /* 忽略 */ }
  } else {
    try { video.currentTime = 0; } catch (e) { /* 忽略 */ }
    if (hadFrame) el.setAttribute('data-video', 'on');
  }
  try { video.pause(); } catch (e) { /* 忽略 */ }
}

/* 点击任意位置后播放视频，播完再弹出卡片 */
function playMsEggVideo() {
  const el = $('msEgg');
  if (!el || el.hidden || msEggStage !== 'ready') return;
  const video = $('msEggVideo');
  msEggStage = 'playing';
  el.setAttribute('data-stage', 'playing');
  if (!video || !video.getAttribute('src') || video.error) {
    showMsEggCard();
    return;
  }
  video.loop = false;
  try { video.currentTime = 0; } catch (e) { /* 忽略 */ }
  // 用户点击后再播放，可安全开启视频自带的环境音乐
  video.muted = false;
  video.volume = 0.65;
  if (window.GkSound) {
    try {
      GkSound.unlock();
      GkSound.playEggStart();
    } catch (e) { /* 忽略音效失败 */ }
  }
  const p = video.play();
  if (p && p.catch) p.catch(() => showMsEggCard());
  clearTimeout(msEggGuardTimer);
  msEggGuardTimer = setTimeout(() => {
    if (msEggStage === 'playing') showMsEggCard();
  }, 15000);
}

/* 彩蛋先用全屏展示，播放结束或关闭后恢复原来的窗口 */
async function enterEggFullscreen() {
  msEggFullscreen = true;
  try { await bridge.setEggFullscreen(true); } catch (e) { /* 忽略 */ }
  await wait(240);
}

function exitEggFullscreen() {
  if (!msEggFullscreen) return;
  msEggFullscreen = false;
  try { bridge.setEggFullscreen(false); } catch (e) { /* 忽略 */ }
}

/* 排队展示：首抽、抽签、设置等弹窗打开时先等它们关闭 */
function tryShowMilestoneEgg() {
  if (msEggPending == null || !MILESTONE_EGGS[msEggPending]) return;
  const days = msEggPending;
  if (state.shaking) return;
  if (!$('onboard').hidden || !$('firstDraw').hidden || !$('drawModal').hidden) return;
  if (!$('msEgg').hidden) return;
  const show = async () => {
    markAutoEggShown();
    await enterEggFullscreen();
    showMilestoneEgg(days, false);
  };
  if (state.mode === 'pet') {
    Promise.resolve(bridge.setPetMode(false)).then(() => {
      setTimeout(show, 420);
    });
    return;
  }
  show();
}

function msEggStopFx() {
  if (msEggFxRaf) cancelAnimationFrame(msEggFxRaf);
  msEggFxRaf = 0;
  const canvas = $('msEggFx');
  if (!canvas || !canvas.getContext) return;
  const ctx = canvas.getContext('2d');
  if (ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
}

/* 彩蛋粒子：200 天星光、100 天金瓣、30 天余烬 */
function msEggStartFx(kind, tone) {
  msEggStopFx();
  if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const canvas = $('msEggFx');
  if (!canvas || !canvas.getContext) return;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const fit = () => {
    const w = Math.floor(window.innerWidth * dpr);
    const h = Math.floor(window.innerHeight * dpr);
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
  };
  fit();
  const W = () => canvas.width / dpr;
  const H = () => canvas.height / dpr;
  const rand = (a, b) => a + Math.random() * (b - a);
  const count = kind === 'petal' ? 34 : (kind === 'ember' ? 44 : 58);
  const parts = [];
  for (let i = 0; i < count; i++) {
    parts.push({
      x: rand(0, W()),
      y: rand(0, H()),
      r: rand(1.1, kind === 'petal' ? 4.4 : 2.4),
      vx: rand(-0.35, 0.35),
      vy: kind === 'ember' ? rand(-0.9, -0.35) : (kind === 'petal' ? rand(0.3, 0.75) : rand(-0.25, -0.06)),
      rot: rand(0, Math.PI * 2),
      vr: rand(-0.03, 0.03),
      a: rand(0.3, 0.85),
      ph: rand(0, Math.PI * 2)
    });
  }
  let shoot = null;
  let last = performance.now();
  const draw = (now) => {
    if ($('msEgg').hidden) { msEggFxRaf = 0; return; }
    fit();
    const dt = Math.min(48, now - last) / 16.7;
    last = now;
    const w = W();
    const h = H();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    for (const p of parts) {
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.rot += p.vr * dt;
      if (p.x < -24) p.x = w + 24;
      else if (p.x > w + 24) p.x = -24;
      if (kind === 'ember') {
        if (p.y < -24) { p.y = h + 24; p.x = rand(0, w); }
      } else if (p.y > h + 24) {
        p.y = -24;
        p.x = rand(0, w);
      } else if (p.y < -24) {
        p.y = h + 24;
        p.x = rand(0, w);
      }
      const twinkle = kind === 'star' ? 0.55 + 0.45 * Math.sin(now / 620 + p.ph) : 1;
      ctx.globalAlpha = Math.max(0, Math.min(1, p.a * twinkle));
      ctx.fillStyle = tone;
      if (kind === 'petal') {
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot);
        ctx.beginPath();
        ctx.ellipse(0, 0, p.r, p.r * 0.45, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      } else {
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    if (kind === 'star') {
      if (!shoot && Math.random() < 0.009) {
        shoot = {
          x: rand(w * 0.12, w * 0.82),
          y: rand(-30, h * 0.22),
          vx: rand(2.6, 4.2),
          vy: rand(1.1, 1.9),
          life: 1
        };
      }
      if (shoot) {
        shoot.x += shoot.vx * dt;
        shoot.y += shoot.vy * dt;
        shoot.life -= 0.012 * dt;
        if (shoot.life <= 0 || shoot.x > w + 60 || shoot.y > h + 60) {
          shoot = null;
        } else {
          ctx.globalAlpha = Math.max(0, shoot.life) * 0.85;
          ctx.strokeStyle = tone;
          ctx.lineWidth = 1.4;
          ctx.beginPath();
          ctx.moveTo(shoot.x, shoot.y);
          ctx.lineTo(shoot.x - shoot.vx * 12, shoot.y - shoot.vy * 12);
          ctx.stroke();
        }
      }
    }
    ctx.globalAlpha = 1;
    msEggFxRaf = requestAnimationFrame(draw);
  };
  msEggFxRaf = requestAnimationFrame(draw);
}

/* preview=true 用于测试面板预览（只影响日志）；autoplay=true 点击按钮后直接播放 */
function showMilestoneEgg(days, preview, autoplay) {
  const meta = MILESTONE_EGGS[days];
  const el = $('msEgg');
  if (!meta || !el) return;
  msEggPending = null;
  const reduce = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  msEggDays = days;
  msEggStage = 'ready';
  clearTimeout(msEggGuardTimer);
  el.classList.remove('is-settled');
  el.setAttribute('data-stage', 'ready');
  $('msEggEyebrow').textContent = meta.eyebrow;
  $('msEggSub').textContent = meta.sub;
  $('msEggStars').hidden = !meta.stars;
  $('msEggSeal').textContent = meta.seal;
  $('btnMsEggClose').textContent = meta.button;
  // 标题等卡片阶段再逐字出现
  $('msEggTitle').innerHTML = '';
  $('msEggNum').textContent = '0';
  const arc = $('msEggArc');
  if (arc) {
    const len = 2 * Math.PI * 58;
    arc.style.strokeDasharray = String(len);
    arc.style.strokeDashoffset = String(len);
    arc.style.stroke = meta.tone;
  }
  el.setAttribute('data-fx', meta.fx);
  setupMsEggVideo(el, days);
  el.hidden = false;
  requestAnimationFrame(() => el.classList.add('show'));
  if (reduce) showMsEggCard();
  else if (autoplay) playMsEggVideo();
  bridge.log('MILESTONE_EGG', { days, targetDate: state.targetDate, preview: !!preview });
}

/* 视频播完（或点击跳过）后弹出里程碑卡片 */
function showMsEggCard() {
  const el = $('msEgg');
  const meta = MILESTONE_EGGS[msEggDays];
  if (!el || el.hidden || !meta || msEggStage === 'card') return;
  msEggStage = 'card';
  clearTimeout(msEggGuardTimer);
  el.setAttribute('data-stage', 'card');
  // 全屏彩蛋在视频结束后回到原来的窗口，最后画面让位给粒子背景
  if (msEggFullscreen) {
    el.removeAttribute('data-video');
    exitEggFullscreen();
  }
  setTimeout(() => {
    if (msEggStage === 'card' && !el.hidden) el.classList.add('is-settled');
  }, 1500);
  const video = $('msEggVideo');
  if (video) {
    try { video.pause(); } catch (e) { /* 忽略 */ }
  }
  const reduce = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  if (!reduce && window.GkSound) {
    try {
      GkSound.unlock();
      GkSound.playEggReveal();
    } catch (e) { /* 忽略音效失败 */ }
  }
  if (!reduce && el.getAttribute('data-video') !== 'on') {
    msEggStartFx(meta.fx, meta.tone);
  }
  const titleEl = $('msEggTitle');
  titleEl.innerHTML = Array.from(meta.title).map((ch, i) => (
    reduce
      ? `<span>${escapeHtml(ch)}</span>`
      : `<span style="animation-delay:${(0.35 + i * 0.055).toFixed(2)}s">${escapeHtml(ch)}</span>`
  )).join('');
  const numEl = $('msEggNum');
  const arc = $('msEggArc');
  if (arc) {
    requestAnimationFrame(() => { arc.style.strokeDashoffset = '0'; });
  }
  if (reduce) {
    numEl.textContent = String(msEggDays);
    return;
  }
  const target = msEggDays;
  const t0 = performance.now();
  const tickNum = (ts) => {
    if (el.hidden || msEggStage !== 'card') return;
    const p = Math.min(1, (ts - t0) / 1500);
    const eased = 1 - Math.pow(1 - p, 3);
    numEl.textContent = String(Math.round(target * eased));
    if (p < 1) requestAnimationFrame(tickNum);
  };
  requestAnimationFrame(tickNum);
  // 窗口被遮挡时 rAF 会暂停，用定时器保证最终数字一定到位
  setTimeout(() => {
    if (msEggStage === 'card' && !el.hidden) numEl.textContent = String(target);
  }, 1700);
}

function closeMilestoneEgg() {
  const el = $('msEgg');
  if (!el || el.hidden) return;
  clearTimeout(msEggGuardTimer);
  if (msEggFullscreen) {
    el.removeAttribute('data-video');
    exitEggFullscreen();
  }
  const video = $('msEggVideo');
  if (video) {
    try { video.pause(); } catch (e) { /* 忽略 */ }
  }
  el.removeAttribute('data-video');
  el.classList.remove('show');
  msEggStopFx();
  msEggStage = 'idle';
  setTimeout(() => { el.hidden = true; }, 420);
  setTimeout(() => { if (state.pendingUpdateNotes) maybeShowUpdateNotes(); }, 460);
  setTimeout(tryShowMilestoneEgg, 520);
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
  setTimeout(tryShowMilestoneEgg, 460);
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
  setTimeout(tryShowMilestoneEgg, 480);
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
  renderAiPanel();
  loadAiConfig();
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
  setTimeout(tryShowMilestoneEgg, 1100);
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
/* ---------------- AI 知识助手（设置页状态行 + 配置弹窗） ---------------- */
const AI_FALLBACK_PROVIDER = { id: 'kilo', name: 'Kilo 免费池', model: 'kilo-auto/free', presets: [], noKey: true };

function aiProviderMeta(id) {
  const list = (state.aiProviders && state.aiProviders.length)
    ? state.aiProviders
    : [AI_FALLBACK_PROVIDER];
  return list.find((p) => p.id === id) || list[0];
}

/* Kilo 免费池的短名：去掉厂商前缀与 :free 后缀，kilo-auto 这类路由名保留原样 */
function aiModelLabel(id) { return String(id || '').replace(/:free$/, ''); }
function aiModelShort(id) {
  const full = String(id || '');
  if (!full) return '';
  if (/^kilo-auto\b/.test(full)) return full;
  const seg = aiModelLabel(full).split('/');
  return seg[seg.length - 1] || full;
}

function aiIsNoKey() {
  const meta = aiProviderMeta(state.aiProvider);
  return !!state.aiNoKey || meta.noKey === true;
}

/* 设置页只渲染一行：金点=可用，红点=缺密钥或未就绪，灰点=未配置 */
function renderAiPanel() {
  const meta = aiProviderMeta(state.aiProvider);
  const modelName = state.aiModel || meta.model || '';
  const noKey = !!state.aiNoKey || meta.noKey === true;
  const configured = noKey || !!state.aiHasKey;
  const ready = configured && state.aiReady !== false;
  const dot = $('aiRowDot');
  if (dot) dot.setAttribute('data-state', ready ? 'on' : (configured ? 'warn' : 'off'));
  if ($('aiStatusLabel')) $('aiStatusLabel').textContent = ready ? '已启用' : (configured ? '待测试' : '未配置');

  const title = $('aiRowTitle');
  if (title) {
    title.textContent = configured
      ? (meta.name || 'AI') + '　·　' + (modelName || '未选模型')
      : '未配置模型';
  }
  const sub = $('aiRowSub');
  if (sub) {
    const bits = [];
    if (noKey && configured) bits.push('免密钥');
    if (!configured) bits.push('点击选择供应商，Kilo 免费池开箱可用');
    else if (state.aiReady === false) bits.push(state.aiReadyError || '配置还没填完整');
    else bits.push('AI 检索已可用');
    if (state.aiModelUsed && state.aiModelUsed !== modelName) {
      bits.push('实际使用：' + aiModelShort(state.aiModelUsed));
    }
    sub.textContent = bits.join('　·　');
    sub.title = sub.textContent;
  }
  const act = document.querySelector('.ai-row__act');
  if (act) act.textContent = configured ? '修改' : '配置';
}

async function loadAiConfig() {
  if (!bridge.aiConfig) return;
  try {
    const res = await bridge.aiConfig();
    if (!res || !res.ok) return;
    state.aiEnabled = res.enabled !== false;
    state.aiProvider = res.provider || 'kilo';
    state.aiProviderName = res.providerName || 'Kilo 免费池';
    state.aiBaseUrl = res.baseUrl || '';
    state.aiModel = res.model || '';
    state.aiModelUsed = res.modelUsed || '';
    state.aiTopic = res.topic || '每日热点';
    state.aiHasKey = !!res.hasKey;
    state.aiNoKey = !!res.noKey;
    state.aiAutoModel = res.autoModel !== false;
    state.aiThink = res.think !== false;
    state.aiWeb = res.web !== false;
    state.aiCustomModels = Array.isArray(res.customModels) ? res.customModels : [];
    state.aiModels = Array.isArray(res.models) ? res.models : [];
    state.aiLoginUrl = res.loginUrl || '';
    state.aiKeyUrl = res.keyUrl || '';
    state.aiAuthUrl = res.authUrl || '';
    state.aiReady = res.ready !== false;
    state.aiReadyError = res.readyError || '';
    state.aiProviders = (Array.isArray(res.providers) && res.providers.length) ? res.providers : state.aiProviders;
    renderAiPanel();
  } catch (e) { /* 读取失败时保持默认展示 */ }
}

/* 错误就地显示在地址框下方，不再只丢 toast */
function aiSaveError(text) {
  const box = $('aiBaseErr');
  if (!box) return;
  box.textContent = text ? String(text) : '';
  box.hidden = !text;
}

function aiSetupTip(text, isErr) {
  const box = $('aiSetupTip');
  if (!box) return;
  box.textContent = text || '';
  box.hidden = !text;
  box.classList.toggle('is-err', !!isErr);
}

/* 测试结果：成功金色，失败红色；title 里放全文 */
function aiTestLine(shortText, isErr, fullText) {
  const box = $('aiTestResult');
  if (!box) return;
  box.textContent = shortText || '';
  box.hidden = !shortText;
  box.setAttribute('data-state', isErr ? 'err' : 'ok');
  box.title = fullText || shortText || '';
}

function aiFormValues() {
  const keyEl = $('aiInputKey');
  if (keyEl) state.aiKeyDraft = keyEl.value;
  return {
    base: $('aiInputBase') ? $('aiInputBase').value.trim() : '',
    model: $('aiInputModel') ? $('aiInputModel').value.trim() : '',
    key: keyEl ? keyEl.value.trim() : ''
  };
}

/* 地址与模型都填了才允许保存；缺哪个就在输入框下面说清楚 */
function refreshAiSaveState() {
  const { base, model } = aiFormValues();
  const isCustom = state.aiProvider === 'custom';
  const missing = [];
  if (isCustom && !base) missing.push('接口地址');
  if (!model) missing.push('模型名');
  const btn = $('btnAi2Save');
  if (btn) btn.disabled = missing.length > 0;
  const hint = $('aiFormHint');
  if (hint) {
    hint.hidden = !missing.length;
    hint.textContent = missing.length ? '还需要填写：' + missing.join('、') + '；填完才能保存。' : '';
  }
  return missing;
}

/* 供应商卡片：Kilo 免费池带「免密钥」角标与「了解 Kilo」外链 */
function renderAiProviderCards() {
  const box = $('aiProviderList');
  if (!box) return;
  box.innerHTML = '';
  (state.aiProviders || []).forEach((p) => {
    const on = p.id === state.aiProvider;
    const isKilo = p.id === 'kilo' && p.noKey === true;
    const card = document.createElement('div');
    card.className = 'ai-provider' + (on ? ' is-on' : '');
    card.setAttribute('role', 'radio');
    card.setAttribute('aria-checked', String(on));
    card.setAttribute('tabindex', '0');
    card.dataset.provider = p.id;

    const name = document.createElement('span');
    name.className = 'ai-provider__name';
    name.textContent = isKilo ? 'Kilo 免费池' : (p.name || p.id);
    if (p.noKey) {
      const tag = document.createElement('i');
      tag.className = 'ai-provider__tag';
      tag.textContent = '免密钥';
      name.appendChild(tag);
    }
    const sub = document.createElement('span');
    sub.className = 'ai-provider__sub';
    sub.textContent = isKilo
      ? '无需密钥，直连免费模型；高峰期自动换模型'
      : (p.hint || (p.model ? '默认模型 ' + p.model : '填写接口地址与模型名'));
    card.appendChild(name);
    card.appendChild(sub);

    if (isKilo && p.keyUrl) {
      const link = document.createElement('span');
      link.className = 'ai-provider__link';
      link.textContent = '了解 Kilo';
      link.title = p.keyUrl;
      link.addEventListener('click', (e) => {
        e.stopPropagation();
        bridge.openExternal(p.keyUrl);
      });
      card.appendChild(link);
    }

    card.addEventListener('click', () => selectAiProvider(p.id));
    card.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); selectAiProvider(p.id); }
    });
    box.appendChild(card);
  });
}

/* 切换供应商：先切主进程再回读，才能拿到这家供应商自己那一桶密钥的状态 */
async function selectAiProvider(id) {
  if (!id || id === state.aiProvider) return;
  const prevIsCustom = state.aiProvider === 'custom';
  if (prevIsCustom) {
    state.aiCustomDraft = {
      baseUrl: $('aiInputBase') ? $('aiInputBase').value.trim() : state.aiBaseUrl,
      model: $('aiInputModel') ? $('aiInputModel').value.trim() : state.aiModel
    };
  }

  state.aiProvider = id;
  state.aiModelList = [];
  state.aiKeyDraft = '';
  aiSaveError('');
  aiTestLine('');
  aiSetupTip('');

  if (id === 'custom' && state.aiCustomDraft) {
    state.aiBaseUrl = state.aiCustomDraft.baseUrl || '';
    state.aiModel = state.aiCustomDraft.model || '';
  } else {
    const p = aiProviderMeta(id);
    state.aiBaseUrl = p.baseUrl || state.aiBaseUrl || '';
    state.aiModel = p.model || '';
  }
  renderAiSetup();

  try {
    const res = await bridge.aiSaveConfig({ provider: id });
    if (res && res.ok === false) {
      aiSaveError(res.error || '切换供应商失败');
      return;
    }
    /* 自定义供应商的草稿要回写 store，aiConfig 才会把用户填的值还回来 */
    if (id === 'custom' && state.aiCustomDraft) {
      const patch = { provider: 'custom' };
      if (state.aiCustomDraft.baseUrl) patch.baseUrl = state.aiCustomDraft.baseUrl;
      if (state.aiCustomDraft.model) patch.model = state.aiCustomDraft.model;
      await bridge.aiSaveConfig(patch);
    }
    await loadAiConfig();
    renderAiSetup();
    const meta = aiProviderMeta(id);
    if (meta.noKey) aiSetupTip('「' + (meta.name || 'AI') + '」免密钥，直接点「测试连通性」就能用。');
    else if (!state.aiHasKey) aiSetupTip('「' + (meta.name || 'AI') + '」还没有密钥；各供应商的密钥分别保存，填一次即可。');
    else aiSetupTip('已切换到「' + (meta.name || 'AI') + '」，本机已保存过它的密钥。');
  } catch (e) {
    aiSaveError('切换供应商失败：' + e.message);
  }
}

/* 点选模型：写进输入框、记住到「已保存的模型」，并立刻持久化 */
async function pickAiModel(id) {
  const name = String(id || '').trim();
  if (!name) return;
  state.aiModel = name;
  if ($('aiInputModel')) $('aiInputModel').value = name;
  aiSaveError('');
  renderAiSetup();
  try {
    const res = await bridge.aiSaveConfig({ model: name, rememberModel: name });
    if (!res || !res.ok) {
      aiSaveError((res && res.error) || '模型没保存成功，请重试');
      return;
    }
    state.aiCustomModels = Array.isArray(res.customModels) ? res.customModels : state.aiCustomModels;
    if (res.model) state.aiModel = res.model;
    renderAiSetup();
    aiSetupTip('已选中并记住「' + aiModelShort(name) + '」，保存后生效。');
  } catch (e) {
    aiSaveError('模型没保存成功：' + e.message);
  }
}

/* 删除已保存的模型：只动 customModels，不动当前选中项（主进程会在同一模型时置空） */
async function forgetAiModel(name) {
  try {
    const res = await bridge.aiSaveConfig({ forgetModel: name });
    if (!res || !res.ok) {
      aiSaveError((res && res.error) || '删除失败，请重试');
      return;
    }
    state.aiCustomModels = Array.isArray(res.customModels) ? res.customModels : state.aiCustomModels.filter((m) => m !== name);
    if (typeof res.model === 'string') state.aiModel = res.model;
    if ($('aiInputModel')) $('aiInputModel').value = state.aiModel || '';
    renderAiSetup();
    aiSetupTip('已删除「' + aiModelLabel(name) + '」。');
  } catch (e) {
    aiSaveError('删除失败：' + e.message);
  }
}

function renderAiModelChips(meta) {
  const chips = $('aiModelChips');
  const empty = $('aiCatalogEmpty');
  const source = (Array.isArray(state.aiModelList) && state.aiModelList.length)
    ? state.aiModelList
    : ((Array.isArray(meta.models) && meta.models.length)
      ? meta.models
      : (Array.isArray(meta.presets) ? meta.presets.map((id) => ({ id, name: id })) : []));

  if (chips) {
    chips.innerHTML = '';
    source.forEach((m) => {
      const id = String((m && m.id) || m || '');
      if (!id) return;
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'ai-chip' + (state.aiModel === id ? ' is-on' : '');
      btn.textContent = aiModelShort(id);
      btn.title = ((m && m.name) ? m.name + '　·　' : '') + id + ((m && m.ctx) ? '　·　上下文 ' + m.ctx : '');
      btn.addEventListener('click', () => pickAiModel(id));
      chips.appendChild(btn);
    });
    chips.hidden = !chips.childElementCount;
    if (empty) empty.hidden = !!chips.childElementCount;
  }

  const box = $('aiCustomModelsBox');
  const saved = $('aiCustomModelChips');
  const names = Array.isArray(state.aiCustomModels) ? state.aiCustomModels : [];
  if (saved) {
    saved.innerHTML = '';
    names.forEach((name) => {
      const wrap = document.createElement('span');
      wrap.className = 'ai-chip ai-chip--saved' + (state.aiModel === name ? ' is-on' : '');
      const pick = document.createElement('button');
      pick.type = 'button';
      pick.className = 'ai-chip__pick';
      pick.textContent = aiModelLabel(name);
      pick.title = name;
      pick.addEventListener('click', () => pickAiModel(name));
      const del = document.createElement('button');
      del.type = 'button';
      del.className = 'ai-chip__del';
      del.textContent = '×';
      del.title = '删除已保存的模型：' + name;
      del.setAttribute('aria-label', '删除已保存的模型 ' + name);
      del.addEventListener('click', (e) => {
        e.stopPropagation();
        forgetAiModel(name);
      });
      wrap.appendChild(pick);
      wrap.appendChild(del);
      saved.appendChild(wrap);
    });
  }
  if (box) box.hidden = !names.length;
}

function renderAiSetup() {
  const meta = aiProviderMeta(state.aiProvider);
  const isCustom = state.aiProvider === 'custom';
  const noKey = !!state.aiNoKey || meta.noKey === true;

  renderAiProviderCards();
  if ($('aiProviderHint')) $('aiProviderHint').textContent = meta.hint || '';

  if ($('aiFieldBase')) $('aiFieldBase').hidden = !isCustom;
  if ($('aiInputBase')) $('aiInputBase').value = state.aiBaseUrl || '';
  if ($('aiInputModel')) {
    $('aiInputModel').value = state.aiModel || '';
    $('aiInputModel').placeholder = meta.model ? '例如 ' + meta.model : '填写该服务支持的模型 ID';
  }

  /* 自动模型选择：开启时把 Kilo 免费池的尝试顺序摆出来 */
  const autoBtn = $('switchAiAutoModel');
  if (autoBtn) {
    autoBtn.classList.toggle('on', !!state.aiAutoModel);
    autoBtn.setAttribute('aria-pressed', String(!!state.aiAutoModel));
  }
  const orderBox = $('aiAutoOrder');
  if (orderBox) {
    const kilo = (state.aiProviders || []).find((p) => p.id === 'kilo');
    let pool = [];
    if (kilo && Array.isArray(kilo.models) && kilo.models.length) {
      pool = kilo.models.map((m) => aiModelShort((m && m.id) || m));
    } else if (kilo && Array.isArray(kilo.presets)) {
      pool = kilo.presets.map(aiModelShort);
    }
    const head = pool.slice(0, 3);
    if (state.aiAutoModel && head.length) {
      orderBox.hidden = false;
      orderBox.textContent = '按顺序尝试：' + head.join(' → ') + ' → …';
    } else {
      orderBox.hidden = true;
      orderBox.textContent = '';
    }
  }

  /* 密钥区：免密钥供应商整块隐藏 */
  if ($('aiFieldKey')) $('aiFieldKey').hidden = noKey;
  const keyState = $('aiKeyState');
  if (keyState) {
    keyState.textContent = state.aiHasKey ? '已保存' : '未填写';
    keyState.setAttribute('data-state', state.aiHasKey ? 'on' : 'off');
  }
  const keyInput = $('aiInputKey');
  if (keyInput) {
    /* 值来自草稿，重画时不会把刚敲进去的密钥擦掉 */
    keyInput.value = state.aiKeyDraft || '';
    keyInput.placeholder = state.aiHasKey ? '已保存，留空则不修改' : '输入 API 密钥';
  }
  const hint = $('aiKeyHint');
  if (hint) {
    hint.hidden = !!state.aiHasKey;
    hint.textContent = state.aiHasKey ? '' : '尚未填入密钥。密钥加密保存在本机，不会上传到任何服务器。';
  }
  if ($('aiKeyNote')) $('aiKeyNote').hidden = noKey;
  if ($('btnAi2Clear')) $('btnAi2Clear').hidden = noKey || !state.aiHasKey;
  if ($('btnAi2GetKey')) $('btnAi2GetKey').hidden = noKey || !meta.keyUrl;

  renderAiModelChips(meta);
  refreshAiSaveState();
  /* 免密钥供应商也能拉模型，不按密钥有无禁用 */
  const fetchBtn = $('btnAiFetchModels');
  if (fetchBtn) fetchBtn.disabled = false;
}

function openAiSetup() {
  state.aiModelList = [];
  state.aiCustomDraft = null;
  state.aiKeyDraft = '';
  aiSaveError('');
  aiSetupTip('');
  aiTestLine('');
  $('aiModal2').hidden = false;
  renderAiSetup();
  loadAiConfig().then(() => renderAiSetup()).catch(() => {});
}

function closeAiSetup() {
  $('aiModal2').hidden = true;
  aiTestLine('');
  /* 未保存就关闭：丢掉弹窗里的临时改动，按 store 真实配置重画 */
  loadAiConfig().then(() => {
    if (!isAiAssistOpen()) return;
    renderAiAssistModel();
    renderAiAssistToggles();
  }).catch(() => {});
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

/* 桌宠互动频率：四个档位按钮，选中项高亮并同步右上角文字 */
function renderPetFreq() {
  const meta = PET_FREQ_META.find((f) => f.id === state.petFreq) || PET_FREQ_META[1];
  const label = $('petFreqLabel');
  if (label) label.textContent = meta.name;
  $$('#petFreqGrid .freq-opt').forEach((btn) => {
    btn.classList.toggle('on', btn.dataset.freq === state.petFreq);
  });
}

/* 桌宠右键菜单：HTML 实现，跟随当前皮肤 */
function renderPetMenuSkins() {
  const box = $('petMenuSkins');
  if (!box) return;
  box.innerHTML = SKIN_META.map((s) =>
    `<button data-skin-id="${s.id}" class="${s.id === state.skin ? 'on' : ''}">` +
    `<span class="dot" style="background:linear-gradient(140deg,${s.c[0]},${s.c[1]})"></span>` +
    `<span>${s.name}</span></button>`
  ).join('');
}
function openPetMenu(x, y) {
  const menu = $('petMenu');
  if (!menu) return;
  renderPetMenuSkins();
  $('petMenuSkins').hidden = true;
  menu.hidden = false;
  menu.style.left = '0px';
  menu.style.top = '0px';
  const w = menu.offsetWidth;
  const h = menu.offsetHeight;
  menu.style.left = Math.max(6, Math.min(x, window.innerWidth - w - 6)) + 'px';
  menu.style.top = Math.max(6, Math.min(y, window.innerHeight - h - 6)) + 'px';
}
function clampPetMenu() {
  const menu = $('petMenu');
  if (!menu || menu.hidden) return;
  const r = menu.getBoundingClientRect();
  if (r.bottom > window.innerHeight - 6) {
    menu.style.top = Math.max(6, window.innerHeight - r.height - 6) + 'px';
  }
}
function closePetMenu() {
  const menu = $('petMenu');
  if (menu) menu.hidden = true;
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

/* ---------------- AI 助手抽屉（主界面） ---------------- */
/* 会话与消息全部交给 renderer/ai-store.js（window.AIStore）落盘，
   这里只负责抽屉的渲染与请求编排；不改 main.js / preload.js / knowledge.js */
const AI_ASSIST_EXAMPLES = [
  { q: '用表格对比「动量守恒」和「能量守恒」的适用条件', tip: '物理' },
  { q: '圆锥曲线里二面角总找错，有没有通用步骤？', tip: '数学' },
  { q: '帮我把这周的错题整理成一份复习清单', tip: '复习' },
  { q: '最近有什么适合写作文的科技热点？', tip: '作文' }
];
const AI_ASSIST_REASON_SHOW = 4000;
const AI_ASSIST_SRC_MAX = 8;

const aiAssist = {
  doc: null,
  messages: [],
  busy: false,
  stopping: false,
  req: null,
  startedAt: 0,
  typingModel: '',
  editing: -1,
  mute: false,
  switched: false,
  actualModel: '',
  modelOpen: false
};

function aiAssistApi() { return window.AIStore || null; }
function isAiAssistOpen() { const el = $('aiAssistant'); return !!el && !el.hidden; }

function aiAssistEl(tag, cls, text) {
  const el = document.createElement(tag);
  if (cls) el.className = cls;
  if (text !== undefined && text !== null) el.textContent = String(text);
  return el;
}

function aiAssistThinkOn() { return state.aiThink !== false; }
function aiAssistWebOn() { return state.aiWeb !== false; }

function aiAssistErrorText(raw) {
  const s = String(raw === undefined || raw === null ? '' : raw).trim();
  if (!s) return '模型没有返回内容，请重试。';
  if (/已停止生成/.test(s)) return '已停止生成';
  return s;
}

function aiAssistEnsureDoc() {
  const api = aiAssistApi();
  if (!api) return null;
  if (!aiAssist.doc) aiAssist.doc = api.load();
  return aiAssist.doc;
}
function aiAssistSession() {
  const api = aiAssistApi();
  if (!api || !aiAssist.doc) return null;
  return api.current(aiAssist.doc);
}
function syncAiAssistMessages() {
  const s = aiAssistSession();
  aiAssist.messages = s && Array.isArray(s.messages) ? s.messages : [];
}
function aiAssistStore(fn) {
  const api = aiAssistApi();
  if (!api) return null;
  const doc = aiAssistEnsureDoc();
  if (!doc) return null;
  let out = null;
  aiAssist.mute = true;
  try { out = fn(api, doc); } catch (e) { out = null; }
  aiAssist.mute = false;
  syncAiAssistMessages();
  return out;
}

function aiAssistHistoryBefore(anchor) {
  const msgs = aiAssist.messages || [];
  const end = typeof anchor === 'number' && anchor >= 0 ? Math.min(anchor, msgs.length) : msgs.length;
  const out = [];
  for (let i = 0; i < end; i++) {
    const m = msgs[i];
    if (!m || !m.text || m.error || m.stopped) continue;
    out.push({ role: m.role === 'assistant' ? 'assistant' : 'user', content: String(m.text).slice(0, 2000) });
  }
  return out.slice(-6);
}

function aiAssistCopy(text, btn, back) {
  const s = String(text === undefined || text === null ? '' : text);
  const label = back || '复制';
  const done = (ok) => {
    if (!btn) { toast(ok ? '已复制' : '复制失败'); return; }
    btn.textContent = ok ? '已复制' : '复制失败';
    setTimeout(() => { if (btn.isConnected) btn.textContent = label; }, 1500);
  };
  try {
    if (bridge.copyText) {
      Promise.resolve(bridge.copyText(s)).then((r) => done(!(r && r.ok === false))).catch(() => done(false));
      return;
    }
  } catch (e) { /* 退回浏览器剪贴板 */ }
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(s).then(() => done(true)).catch(() => done(false));
    return;
  }
  done(false);
}

/* 轻量 Markdown：思路照 renderer/knowledge.js 的 renderMarkdown，先转义再套标签，
   代码块与行内代码用占位符保护，用户文本无法注入 HTML */
function aiAssistMarkdown(src) {
  let text = String(src === undefined || src === null ? '' : src)
    .replace(/\r\n?/g, '\n')
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '')
    .trim();
  if (!text) return '';

  const blocks = [];
  const hold = (html) => {
    blocks.push(html);
    return '\u0001B' + (blocks.length - 1) + '\u0002';
  };

  function inline(s) {
    let t = escapeHtml(s);
    const codes = [];
    t = t.replace(/\x60([^\x60]+)\x60/g, (_m, code) => {
      codes.push('<code>' + code + '</code>');
      return '\u0001C' + (codes.length - 1) + '\u0002';
    });
    t = t.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    t = t.replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>');
    t = t.replace(/==([^=]+)==/g, '<em>$1</em>');
    t = t.replace(/\u0001C(\d+)\u0002/g, (_m, i) => codes[Number(i)] || '');
    return t;
  }

  text = text.replace(/\x60\x60\x60([\w+#.-]*)[ \t]*\n?([\s\S]*?)(?:\x60\x60\x60|$)/g, (_m, lang, code) => {
    const body = escapeHtml(String(code).replace(/\n+$/, ''));
    const tag = lang ? escapeHtml(lang) : '代码';
    return hold(
      '<div class="ai-code">' +
        '<div class="ai-code__bar"><span class="ai-code__lang">' + tag + '</span>' +
        '<button class="ai-code__copy" type="button" data-ai-copy="code">复制代码</button></div>' +
        '<pre><code>' + body + '</code></pre>' +
      '</div>'
    );
  });

  text = text.replace(/(^\|.+\|[ \t]*\n\|[-: |]+\|[ \t]*\n(?:\|.*\|[ \t]*(?:\n|$))+)/gm, (m) => {
    const rows = m.trim().split('\n').filter(Boolean);
    if (rows.length < 2) return m;
    const split = (r) => r.replace(/^\||\|$/g, '').split('|').map((x) => x.trim());
    const head = split(rows[0]);
    const body = rows.slice(2).map(split);
    let html = '<table><thead><tr>' + head.map((h) => '<th>' + inline(h) + '</th>').join('') + '</tr></thead><tbody>';
    body.forEach((r) => {
      html += '<tr>' + head.map((_h, i) => '<td>' + inline(r[i] || '') + '</td>').join('') + '</tr>';
    });
    html += '</tbody></table>';
    return hold(html);
  });

  const out = [];
  let listType = null;
  let buf = [];
  const flushList = () => {
    if (!listType) return;
    out.push('<' + listType + '>' + buf.map((li) => '<li>' + inline(li) + '</li>').join('') + '</' + listType + '>');
    listType = null;
    buf = [];
  };

  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].replace(/\s+$/, '');
    if (!line.trim()) { flushList(); continue; }
    if (/^\u0001B\d+\u0002$/.test(line.trim())) { flushList(); out.push(line.trim()); continue; }
    if (/^(-{3,}|\*{3,}|_{3,})$/.test(line.trim())) { flushList(); out.push('<hr>'); continue; }
    const h = line.match(/^(#{1,4})\s+(.*)$/);
    if (h) {
      flushList();
      const lv = Math.min(3, h[1].length);
      out.push('<h' + lv + '>' + inline(h[2]) + '</h' + lv + '>');
      continue;
    }
    if (/^>\s?/.test(line)) {
      flushList();
      out.push('<blockquote>' + inline(line.replace(/^>\s?/, '')) + '</blockquote>');
      continue;
    }
    const ol = line.match(/^\s*(\d+)[.)、]\s+(.*)$/);
    if (ol) {
      if (listType !== 'ol') { flushList(); listType = 'ol'; }
      buf.push(ol[2]);
      continue;
    }
    const ul = line.match(/^\s*[-*+·•]\s+(.*)$/);
    if (ul) {
      if (listType !== 'ul') { flushList(); listType = 'ul'; }
      buf.push(ul[1]);
      continue;
    }
    flushList();
    out.push('<p>' + inline(line.trim()) + '</p>');
  }
  flushList();

  let html = out.join('');
  html = html.replace(/\u0001B(\d+)\u0002/g, (_m, i) => blocks[Number(i)] || '');
  return html;
}

/* ---- 抽屉渲染：思考过程 / 来源 / meta / 消息 ---- */
function aiAssistHost(url) {
  try { return String(new URL(url).hostname || '').replace(/^www\./, ''); } catch (e) { return ''; }
}
function aiAssistSafeUrl(raw) {
  const s = String(raw === undefined || raw === null ? '' : raw).trim();
  if (!s || s.length > 2000) return '';
  return /^https?:\/\//i.test(s) ? s : '';
}
function aiAssistBtn(label, onClick, cls) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'ai-msg__act' + (cls ? ' ' + cls : '');
  b.textContent = label;
  b.addEventListener('click', onClick);
  return b;
}
function aiAssistMsLabel(ms) {
  const n = Number(ms);
  if (!isFinite(n) || n <= 0) return '';
  if (n < 1000) return '不到 1 秒';
  const s = n / 1000;
  if (s < 10) return s.toFixed(1) + ' 秒';
  if (s < 60) return Math.round(s) + ' 秒';
  const min = Math.floor(s / 60);
  const rest = Math.round(s - min * 60);
  return min + ' 分' + (rest ? ' ' + rest + ' 秒' : '');
}
function aiAssistAuditLabel(audit) {
  if (!audit) return '';
  const issues = Array.isArray(audit.issues) ? audit.issues : [];
  if (issues.length) return '有 ' + issues.length + ' 处待核对';
  if (audit.note && /已按审核意见修正|已改写/.test(audit.note)) return '已改写';
  if (audit.note && /未完成|无法解析/.test(audit.note)) return '审核未完成';
  return '审核通过';
}
function buildAiAssistMeta(m) {
  const meta = aiAssistEl('div', 'ai-msg__meta');
  const parts = [];
  const model = m.modelName || m.model;
  if (model) parts.push({ t: aiModelShort(model) });
  if (m.providerName) parts.push({ t: m.providerName });
  const cost = aiAssistMsLabel(m.ms);
  if (cost) parts.push({ t: cost });
  const auditLabel = aiAssistAuditLabel(m.audit);
  if (auditLabel) parts.push({ t: auditLabel, warn: !!(m.audit && m.audit.issues && m.audit.issues.length) });
  parts.forEach((p, i) => {
    if (i) meta.appendChild(aiAssistEl('span', 'ai-msg__sep', '·'));
    meta.appendChild(aiAssistEl('span', p.warn ? 'is-warn' : null, p.t));
  });
  if (m.search && m.search.ok === false) {
    const miss = aiAssistEl('span', 'ai-msg__netmiss', '联网检索未命中');
    if (m.search.query) miss.title = '检索词：' + m.search.query;
    meta.appendChild(miss);
  }
  return meta;
}
function buildAiAssistAuditBox(m) {
  const audit = m && m.audit;
  if (!audit) return null;
  const issues = Array.isArray(audit.issues) ? audit.issues : [];
  if (!issues.length && !/未完成|无法解析/.test(audit.note || '')) return null;
  const box = aiAssistEl('div', 'ai-msg__audit' + (issues.length ? ' is-warn' : ''));
  box.textContent = issues.length
    ? '待核对：' + issues.join('；') + (audit.note ? '（' + audit.note + '）' : '')
    : '审核未完成：' + (audit.note || '请人工核对内容。');
  return box;
}
function buildAiAssistReason(m) {
  const raw = String((m && m.reasoning) || '');
  if (!raw.trim()) return null;
  const shown = raw.length > AI_ASSIST_REASON_SHOW ? raw.slice(0, AI_ASSIST_REASON_SHOW) + '…' : raw;
  const det = aiAssistEl('details', 'ai-reason');
  const sum = aiAssistEl('summary', 'ai-reason__sum', '思考过程 · ' + raw.length + ' 字');
  sum.title = '点击展开模型思考过程';
  det.appendChild(sum);
  det.appendChild(aiAssistEl('div', 'ai-reason__body', shown));
  return det;
}
/* 来源列表：默认收起，只显示「域名 · 标题」，不展示完整长链接 */
function buildAiAssistSearch(m, idx) {
  const search = m && m.search;
  if (!search || typeof search !== 'object' || search.ok === false) return null;
  const items = [];
  (Array.isArray(search.items) ? search.items : []).forEach((it) => {
    if (!it || typeof it !== 'object') return;
    const url = aiAssistSafeUrl(it.url);
    if (!url) return;
    items.push({
      url: url,
      title: String(it.title || '').slice(0, 160) || url,
      date: String(it.date || '').slice(0, 40)
    });
  });
  if (!items.length) return null;
  const list = items.slice(0, AI_ASSIST_SRC_MAX);
  const box = aiAssistEl('div', 'ai-src');
  const listId = 'aiAssistSrc' + idx;
  const head = aiAssistEl('button', 'ai-src__head');
  head.type = 'button';
  head.setAttribute('aria-expanded', 'false');
  head.setAttribute('aria-controls', listId);
  head.appendChild(aiAssistEl('span', 'ai-src__title', '已联网检索 ' + list.length + ' 条'));
  const caret = aiAssistEl('span', 'ai-src__caret', '展开');
  head.appendChild(caret);
  if (search.query) head.title = '检索词：' + search.query;
  const panel = aiAssistEl('div', 'ai-src__list');
  panel.id = listId;
  panel.hidden = true;
  list.forEach((it) => {
    const host = aiAssistHost(it.url);
    const a = aiAssistEl('a', 'ai-src__item');
    a.href = it.url;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    a.title = it.title;
    const row = aiAssistEl('span', 'ai-src__row');
    row.appendChild(aiAssistEl('span', 'ai-src__host', host || '来源'));
    if (it.title) {
      row.appendChild(aiAssistEl('span', 'ai-src__dot', '·'));
      row.appendChild(aiAssistEl('span', 'ai-src__name', it.title));
    }
    a.appendChild(row);
    if (it.date) a.appendChild(aiAssistEl('span', 'ai-src__date', it.date));
    panel.appendChild(a);
  });
  head.addEventListener('click', () => {
    const open = panel.hidden;
    panel.hidden = !open;
    head.setAttribute('aria-expanded', String(open));
    caret.textContent = open ? '收起' : '展开';
  });
  box.appendChild(head);
  box.appendChild(panel);
  return box;
}
function buildAiAssistTyping() {
  const wrap = aiAssistEl('div', 'ai-msg ai-msg--ai is-typing');
  const bubble = aiAssistEl('div', 'ai-msg__bubble');
  const dots = aiAssistEl('span', 'ai-typing');
  dots.appendChild(document.createElement('i'));
  dots.appendChild(document.createElement('i'));
  dots.appendChild(document.createElement('i'));
  bubble.appendChild(dots);
  bubble.appendChild(aiAssistEl('span', 'ai-typing__text', (aiAssist.typingModel || '模型') + ' 正在思考…'));
  wrap.appendChild(bubble);
  return wrap;
}
function buildAiAssistEditor(m, idx) {
  const box = aiAssistEl('div', 'ai-edit');
  const area = document.createElement('textarea');
  area.className = 'ai-edit__area';
  area.rows = 3;
  area.value = String(m.text || (m.request && (m.request.query || m.request.topic)) || '');
  const acts = aiAssistEl('div', 'ai-edit__acts');
  acts.appendChild(aiAssistBtn('取消', () => { aiAssist.editing = -1; renderAiAssist(); }));
  acts.appendChild(aiAssistBtn('保存重发', () => resendAiAssist(idx, area.value), 'is-primary'));
  area.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      resendAiAssist(idx, area.value);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      aiAssist.editing = -1;
      renderAiAssist();
    }
  });
  box.appendChild(area);
  box.appendChild(acts);
  return box;
}
function buildAiAssistMessage(m, idx) {
  const isUser = m.role === 'user';
  const wrap = aiAssistEl('div', 'ai-msg ' + (isUser ? 'ai-msg--user' : 'ai-msg--ai') +
    (m.error ? ' is-error' : '') + (m.stopped ? ' is-stopped' : ''));

  if (isUser) {
    if (aiAssist.editing === idx) {
      wrap.appendChild(buildAiAssistEditor(m, idx));
      return wrap;
    }
    wrap.appendChild(aiAssistEl('div', 'ai-msg__bubble', m.text || ''));
    const acts = aiAssistEl('div', 'ai-msg__acts');
    const copyBtn = aiAssistBtn('复制', () => aiAssistCopy(m.text, copyBtn));
    acts.appendChild(copyBtn);
    acts.appendChild(aiAssistBtn('编辑重发', () => { aiAssist.editing = idx; renderAiAssist(); }));
    acts.appendChild(aiAssistBtn('分支', () => branchAiAssist(idx)));
    wrap.appendChild(acts);
    return wrap;
  }

  const reason = buildAiAssistReason(m);
  if (reason) wrap.appendChild(reason);

  const bubble = aiAssistEl('div', 'ai-msg__bubble');
  if (m.error) {
    bubble.appendChild(aiAssistEl('b', 'ai-msg__err-title', '生成失败'));
    bubble.appendChild(aiAssistEl('p', 'ai-msg__err-text', m.text || '模型没有返回内容'));
    const row = aiAssistEl('div', 'ai-msg__err-acts');
    row.appendChild(aiAssistBtn('重试', () => retryAiAssist(idx), 'is-primary'));
    const rawText = String(m.error === true ? '' : m.error || '');
    if (rawText && rawText !== m.text) {
      const det = aiAssistEl('details', 'ai-msg__err-raw');
      det.appendChild(aiAssistEl('summary', null, '查看错误原文'));
      det.appendChild(aiAssistEl('code', null, rawText));
      row.appendChild(det);
    }
    bubble.appendChild(row);
  } else if (m.stopped) {
    bubble.appendChild(aiAssistEl('b', 'ai-msg__err-title', '已停止生成'));
    bubble.appendChild(aiAssistEl('p', 'ai-msg__err-text', '这次没有生成内容，可以点「重新生成」再来一次。'));
  } else {
    const md = aiAssistEl('div', 'ai-md');
    md.innerHTML = aiAssistMarkdown(m.text);
    bubble.appendChild(md);
  }
  wrap.appendChild(bubble);

  const meta = buildAiAssistMeta(m);
  if (meta && meta.childNodes.length) wrap.appendChild(meta);
  const audit = buildAiAssistAuditBox(m);
  if (audit) wrap.appendChild(audit);
  const src = buildAiAssistSearch(m, idx);
  if (src) wrap.appendChild(src);

  const acts = aiAssistEl('div', 'ai-msg__acts');
  const copyBtn = aiAssistBtn('复制', () => aiAssistCopy(m.text || (m.error ? String(m.error) : ''), copyBtn));
  acts.appendChild(copyBtn);
  if (m.request && m.request.query) acts.appendChild(aiAssistBtn('重新生成', () => retryAiAssist(idx)));
  acts.appendChild(aiAssistBtn('分支', () => branchAiAssist(idx)));
  wrap.appendChild(acts);
  return wrap;
}
function buildAiAssistEmpty() {
  const box = aiAssistEl('div', 'ai-empty');
  box.appendChild(aiAssistEl('div', 'ai-empty__head', 'AI 助手'));
  box.appendChild(aiAssistEl('p', 'ai-empty__hint', '问知识点、问思路、问最近的新闻都行，下面四张卡片可以直接点。'));
  const grid = aiAssistEl('div', 'ai-examples');
  AI_ASSIST_EXAMPLES.forEach((it) => {
    const card = aiAssistEl('button', 'ai-example');
    card.type = 'button';
    card.appendChild(aiAssistEl('em', null, it.tip));
    card.appendChild(aiAssistEl('span', 'ai-example__text', it.q));
    card.addEventListener('click', () => {
      const ta = $('aiAssistInput');
      if (!ta) return;
      ta.value = it.q;
      autoGrowAiInput();
      ta.focus();
    });
    grid.appendChild(card);
  });
  box.appendChild(grid);
  return box;
}
function renderAiAssist() {
  const body = $('aiAssistBody');
  if (!body) return;
  body.innerHTML = '';
  const msgs = aiAssist.messages || [];
  if (!msgs.length) body.appendChild(buildAiAssistEmpty());
  else for (let i = 0; i < msgs.length; i++) body.appendChild(buildAiAssistMessage(msgs[i], i));
  if (aiAssist.busy) body.appendChild(buildAiAssistTyping());
  /* 打开抽屉时首帧高度还没算准，滚到底要等一帧 */
  const toBottom = () => { body.scrollTop = body.scrollHeight; };
  toBottom();
  if (typeof requestAnimationFrame === 'function') requestAnimationFrame(toBottom);
}

/* ---- 抽屉：模型徽标 / 开关 / 会话列表 ---- */
function aiAssistModelLabel() {
  const meta = aiProviderMeta(state.aiProvider) || {};
  const cfg = state.aiModel || meta.model || '';
  /* 徽标显示「已选中的模型」，自动降级时用右侧小标提示，避免点开菜单后对不上 */
  const id = cfg || aiAssist.actualModel || state.aiModelUsed;
  return aiModelShort(id) || '未配置模型';
}
function renderAiAssistModel() {
  const name = $('aiAssistModelName');
  if (name) name.textContent = aiAssistModelLabel();
  const flag = $('aiAssistModelSwitch');
  const switched = !!aiAssist.switched || (!!state.aiModelUsed && !!state.aiModel && state.aiModelUsed !== state.aiModel);
  if (flag) flag.hidden = !switched;
  const btn = $('btnAiAssistModel');
  if (btn) {
    const cfgModel = state.aiModel || '';
    const usedModel = aiAssist.actualModel || state.aiModelUsed || '';
    const model = cfgModel || usedModel;
    let title = (state.aiProviderName || '模型') + (model ? ' · ' + model : '');
    if (usedModel && cfgModel && usedModel !== cfgModel) title += '（本次实际用 ' + usedModel + '）';
    btn.title = title + '（点击切换模型）';
  }
  if (aiAssist.modelOpen) renderAiAssistModelMenu();
}

/* ---- 抽屉：模型选择器（按供应商分组 + 搜索 + 当前项打勾） ---- */
function aiAssistModelGroups() {
  const groups = [];
  const provs = (state.aiProviders && state.aiProviders.length)
    ? state.aiProviders
    : [AI_FALLBACK_PROVIDER];
  provs.forEach((p) => {
    if (!p || !p.id) return;
    const items = [];
    const seen = {};
    const push = (id, name, ctx) => {
      const key = String(id || '').trim();
      if (!key || seen[key]) return;
      seen[key] = true;
      items.push({ id: key, name: String(name || '') || aiModelShort(key), ctx: Number(ctx) || 0 });
    };
    (Array.isArray(p.models) ? p.models : []).forEach((m) => push(m && m.id ? m.id : m, m && m.name, m && m.ctx));
    (Array.isArray(p.presets) ? p.presets : []).forEach((id) => push(id, '', 0));
    if (p.model) push(p.model, '', 0);
    if (p.id === 'custom') (state.aiCustomModels || []).forEach((id) => push(id, '', 0));
    if (p.id === state.aiProvider && state.aiModel) push(state.aiModel, '', 0);
    if (items.length) groups.push({ provider: p.id, name: p.name || p.id, noKey: !!p.noKey, items });
  });
  return groups;
}

function renderAiAssistModelMenu() {
  const box = $('aiAssistModelList');
  if (!box) return;
  const search = $('aiAssistModelSearch');
  const kw = String((search && search.value) || '').trim().toLowerCase();
  box.innerHTML = '';
  let total = 0;
  aiAssistModelGroups().forEach((g) => {
    const items = g.items.filter((m) => {
      if (!kw) return true;
      return m.id.toLowerCase().includes(kw) || String(m.name || '').toLowerCase().includes(kw);
    });
    if (!items.length) return;
    const head = document.createElement('div');
    head.className = 'ai-models__group';
    head.textContent = g.name;
    box.appendChild(head);
    items.forEach((m) => {
      total += 1;
      const on = g.provider === state.aiProvider && m.id === String(state.aiModel || '');
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'ai-models__item' + (on ? ' is-on' : '');
      btn.setAttribute('role', 'option');
      btn.setAttribute('aria-selected', String(on));
      btn.title = m.id + (m.ctx ? '　·　上下文 ' + m.ctx : '');
      const name = document.createElement('span');
      name.className = 'ai-models__name';
      name.textContent = m.name || aiModelShort(m.id);
      btn.appendChild(name);
      if (m.ctx) {
        const ctx = document.createElement('span');
        ctx.className = 'ai-models__ctx';
        ctx.textContent = Math.round(m.ctx / 1000) + 'K';
        btn.appendChild(ctx);
      }
      if (on) {
        const tick = document.createElement('em');
        tick.className = 'ai-models__tick';
        tick.textContent = '✓';
        btn.appendChild(tick);
      }
      btn.addEventListener('click', () => chooseAiAssistModel(g.provider, m));
      box.appendChild(btn);
    });
  });
  if (!kw && total) {
    const cur = box.querySelector('.ai-models__item.is-on');
    if (cur && typeof cur.scrollIntoView === 'function') {
      try { cur.scrollIntoView({ block: 'nearest' }); } catch (e) { /* 忽略 */ }
    }
  }
  if (!total) {
    const empty = document.createElement('div');
    empty.className = 'ai-models__empty';
    empty.textContent = kw
      ? '没有匹配「' + kw + '」的模型'
      : '当前供应商没有模型清单，可在下方配置里直接填写模型名';
    box.appendChild(empty);
  }
}

function setAiAssistModelMenu(open) {
  const box = $('aiAssistModels');
  const btn = $('btnAiAssistModel');
  if (!box || !btn) return;
  aiAssist.modelOpen = !!open;
  box.hidden = !open;
  btn.setAttribute('aria-expanded', String(!!open));
  if (!open) return;
  const search = $('aiAssistModelSearch');
  if (search) search.value = '';
  renderAiAssistModelMenu();
  if (search) setTimeout(() => { try { search.focus(); } catch (e) { /* 忽略 */ } }, 30);
}

async function chooseAiAssistModel(provider, m) {
  setAiAssistModelMenu(false);
  if (!m || !m.id) return;
  const patch = { model: m.id };
  if (provider && provider !== state.aiProvider) patch.provider = provider;
  const beforeModel = state.aiModel;
  const beforeProvider = state.aiProvider;
  state.aiModel = m.id;
  if (provider) state.aiProvider = provider;
  renderAiAssistModel();
  let res = null;
  try { res = await bridge.aiSaveConfig(patch); } catch (e) { res = { ok: false, error: (e && e.message) || '' }; }
  if (!res || res.ok === false) {
    state.aiModel = beforeModel;
    state.aiProvider = beforeProvider;
    renderAiAssistModel();
    toast('切换模型失败：' + ((res && res.error) || '请重试'));
    return;
  }
  if (res.model) state.aiModel = res.model;
  if (res.provider) state.aiProvider = res.provider;
  state.aiModelUsed = '';
  aiAssist.actualModel = '';
  aiAssist.switched = false;
  renderAiAssistModel();
  toast('已切换到 ' + (m.name || aiModelShort(m.id)));
  refreshAiAssistConfig();
}
function renderAiAssistToggles() {
  const think = $('btnAiAssistThink');
  if (think) {
    think.classList.toggle('on', aiAssistThinkOn());
    think.setAttribute('aria-pressed', String(aiAssistThinkOn()));
  }
  const web = $('btnAiAssistWeb');
  if (web) {
    web.classList.toggle('on', aiAssistWebOn());
    web.setAttribute('aria-pressed', String(aiAssistWebOn()));
  }
}
function renderAiAssistSend() {
  const btn = $('btnAiAssistSend');
  if (!btn) return;
  btn.disabled = false;
  const label = aiAssist.stopping ? '停止中…' : (aiAssist.busy ? '停止' : '发送');
  btn.textContent = label;
  btn.classList.toggle('is-stop', aiAssist.busy && !aiAssist.stopping);
  btn.title = aiAssist.busy ? '停止生成' : '发送';
  btn.setAttribute('aria-label', btn.title);
}
function aiAssistRelTime(ts) {
  const n = Number(ts) || 0;
  if (!n) return '';
  const diff = Date.now() - n;
  if (diff < 0) return '';
  if (diff < 60000) return '刚刚';
  if (diff < 3600000) return Math.floor(diff / 60000) + ' 分钟前';
  if (diff < 86400000) return Math.floor(diff / 3600000) + ' 小时前';
  if (diff < 7 * 86400000) return Math.floor(diff / 86400000) + ' 天前';
  const d = new Date(n);
  return (d.getMonth() + 1) + ' 月 ' + d.getDate() + ' 日';
}
function aiAssistSessBtn(label, onClick, cls) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'ai-sess__act' + (cls ? ' ' + cls : '');
  b.textContent = label;
  b.addEventListener('click', onClick);
  return b;
}
function renderAiAssistSessions() {
  const box = $('aiAssistSessList');
  if (!box) return;
  box.innerHTML = '';
  const api = aiAssistApi();
  if (!api || !aiAssist.doc) {
    box.appendChild(aiAssistEl('p', 'ai-sess__empty', '会话存储还没加载'));
    return;
  }
  const items = api.summary(aiAssist.doc);
  items.forEach((it) => {
    const row = aiAssistEl('div', 'ai-sess__row' + (it.current ? ' is-on' : ''));
    const main = aiAssistEl('button', 'ai-sess__main');
    main.type = 'button';
    const title = aiAssistEl('span', 'ai-sess__title', it.title || '新对话');
    title.title = it.title || '';
    main.appendChild(title);
    main.appendChild(aiAssistEl('span', 'ai-sess__meta', (it.count || 0) + ' 条 · ' + aiAssistRelTime(it.updatedAt)));
    main.addEventListener('click', () => { if (!it.current) switchAiAssistSession(it.id); });
    main.addEventListener('dblclick', () => startRenameAiAssist(it.id, row));
    row.appendChild(main);
    const acts = aiAssistEl('div', 'ai-sess__acts');
    acts.appendChild(aiAssistSessBtn('重命名', () => startRenameAiAssist(it.id, row)));
    acts.appendChild(aiAssistSessBtn('删除', (e) => deleteAiAssistSession(it.id, e.currentTarget), 'is-danger'));
    row.appendChild(acts);
    box.appendChild(row);
  });
}
function startRenameAiAssist(id, row) {
  if (!row || row.querySelector('.ai-sess__input')) return;
  const main = row.querySelector('.ai-sess__main');
  if (!main) return;
  const titleEl = row.querySelector('.ai-sess__title');
  const input = document.createElement('input');
  input.className = 'ai-sess__input';
  input.maxLength = 40;
  input.value = titleEl ? titleEl.textContent : '';
  main.hidden = true;
  row.insertBefore(input, row.firstChild);
  input.focus();
  input.select();
  const finish = (commit) => {
    if (!input.isConnected) return;
    const v = input.value.trim();
    input.remove();
    main.hidden = false;
    if (commit && v) {
      aiAssistStore((api, doc) => { api.rename(doc, id, v); return true; });
      renderAiAssistSessions();
      toast('会话已重命名');
    }
  };
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); finish(true); }
    else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); finish(false); }
  });
  input.addEventListener('blur', () => finish(true));
}
function switchAiAssistSession(id) {
  if (!id || !aiAssist.doc) return;
  if (aiAssist.busy) { toast('正在生成，先停一下再切换'); return; }
  /* 切会话前重新读一次库：别的工作台窗口或上次请求可能刚写过 */
  const api = aiAssistApi();
  if (!api) return;
  aiAssist.mute = true;
  try {
    aiAssist.doc = api.load();
    aiAssist.doc.currentId = id;
    api.save(aiAssist.doc);
  } catch (e) { /* 读失败就保持原样 */ }
  aiAssist.mute = false;
  syncAiAssistMessages();
  aiAssist.editing = -1;
  renderAiAssistSessions();
  renderAiAssist();
}
function newAiAssistSession() {
  if (aiAssist.busy) { toast('正在生成，先停一下再新建'); return; }
  aiAssistStore((api, doc) => { api.create(doc, {}); return true; });
  aiAssist.editing = -1;
  renderAiAssistSessions();
  renderAiAssist();
  const ta = $('aiAssistInput');
  if (ta) ta.focus();
}
function deleteAiAssistSession(id, btn) {
  if (!id) return;
  if (aiAssist.busy) { toast('正在生成，先停一下再删除'); return; }
  if (btn && btn.getAttribute('data-confirm') !== '1') {
    btn.setAttribute('data-confirm', '1');
    btn.textContent = '确认删除';
    btn.classList.add('is-confirm');
    clearTimeout(btn._confirmTimer);
    btn._confirmTimer = setTimeout(() => {
      if (!btn.isConnected) return;
      btn.removeAttribute('data-confirm');
      btn.classList.remove('is-confirm');
      btn.textContent = '删除';
    }, 4000);
    return;
  }
  if (btn) clearTimeout(btn._confirmTimer);
  aiAssistStore((api, doc) => { api.remove(doc, id); return true; });
  if (aiAssist.editing >= 0) aiAssist.editing = -1;
  renderAiAssistSessions();
  renderAiAssist();
  toast('已删除会话');
}

/* ---- 抽屉：发送 / 停止 / 重试 / 编辑重发 / 分支 ---- */
async function askAiAssist(req, opts) {
  const o = opts || {};
  if (aiAssist.busy) return;
  if (!bridge.aiAsk) { toast('当前环境不支持 AI 调用'); return; }
  const query = String((req && req.query) || '').trim();
  if (!query) { toast('先写一句想问的'); return; }
  const payload = {
    mode: 'custom',
    query: query,
    history: aiAssistHistoryBefore(o.anchor),
    think: req.think !== false,
    web: req.web !== false
  };
  if (state.aiModel) payload.model = state.aiModel;
  aiAssist.busy = true;
  aiAssist.stopping = false;
  aiAssist.req = { mode: 'custom', query: query, think: payload.think, web: payload.web };
  aiAssist.startedAt = Date.now();
  aiAssist.typingModel = aiModelShort(state.aiModelUsed || state.aiModel) || '模型';
  renderAiAssist();
  renderAiAssistSend();

  let res = null;
  let failure = '';
  try {
    res = await bridge.aiAsk(payload);
  } catch (e) {
    failure = (e && e.message) ? e.message : '调用失败';
  }
  const ms = Date.now() - aiAssist.startedAt;
  aiAssist.busy = false;
  aiAssist.stopping = false;
  aiAssist.req = null;
  aiAssist.typingModel = '';

  if (failure) {
    pushAiAssistFailure(req, failure, ms);
  } else if (res && res.ok && String(res.content || '').trim()) {
    pushAiAssistSuccess(req, res, ms);
  } else if (res && (res.cancelled || /已停止生成/.test(String(res.error || '')))) {
    pushAiAssistStopped(req, ms);
  } else {
    pushAiAssistFailure(req, String((res && res.error) || '模型没有返回内容'), ms);
  }

  renderAiAssist();
  renderAiAssistSessions();
  renderAiAssistSend();
  renderAiAssistModel();
}
function aiAssistRepeatReq(req) {
  return {
    mode: 'custom',
    query: String((req && req.query) || ''),
    think: req && req.think !== false,
    web: req && req.web !== false
  };
}
function pushAiAssistSuccess(req, res, ms) {
  const msg = {
    role: 'assistant',
    text: String(res.content || ''),
    request: aiAssistRepeatReq(req),
    reasoning: String(res.reasoning || ''),
    search: res.search && typeof res.search === 'object' ? res.search : null,
    model: String(res.model || ''),
    providerName: String(res.providerName || ''),
    audit: res.audit && typeof res.audit === 'object' ? res.audit : null,
    ms: ms,
    ts: Date.now()
  };
  aiAssistStore((api, doc) => { api.append(doc, msg); return true; });
  if (res.model) {
    aiAssist.actualModel = String(res.model);
    state.aiModelUsed = res.model;
    renderAiPanel();
  }
  aiAssist.switched = !!res.switched ||
    (!!res.model && !!state.aiModel && String(res.model) !== String(state.aiModel));
}
function pushAiAssistFailure(req, raw, ms) {
  const rawText = String(raw || '模型没有返回内容');
  const msg = {
    role: 'assistant',
    text: aiAssistErrorText(rawText),
    error: rawText,
    request: aiAssistRepeatReq(req),
    ms: ms,
    ts: Date.now()
  };
  aiAssistStore((api, doc) => { api.append(doc, msg); return true; });
}
function pushAiAssistStopped(req, ms) {
  const msg = {
    role: 'assistant',
    text: '',
    stopped: true,
    request: aiAssistRepeatReq(req),
    ms: ms,
    ts: Date.now()
  };
  aiAssistStore((api, doc) => { api.append(doc, msg); return true; });
}
function sendAiAssist(raw) {
  if (aiAssist.busy) { toast('正在生成，先停一下再发'); return; }
  const ta = $('aiAssistInput');
  const text = String(raw !== undefined && raw !== null ? raw : (ta ? ta.value : '')).trim();
  if (!text) { toast('先写一句想问的'); return; }
  const req = { mode: 'custom', query: text, think: aiAssistThinkOn(), web: aiAssistWebOn() };
  aiAssistStore((api, doc) => {
    api.append(doc, { role: 'user', text: text, request: aiAssistRepeatReq(req), ts: Date.now() });
    return true;
  });
  if (ta) { ta.value = ''; autoGrowAiInput(); }
  aiAssist.editing = -1;
  renderAiAssist();
  renderAiAssistSessions();
  askAiAssist(req, { anchor: (aiAssist.messages || []).length - 1 });
}
function retryAiAssist(idx) {
  if (aiAssist.busy) { toast('正在生成，先停一下再试'); return; }
  const m = (aiAssist.messages || [])[idx];
  if (!m) return;
  if (!m.request || !m.request.query) { toast('这条消息没有可复用的请求'); return; }
  const req = aiAssistRepeatReq(m.request);
  aiAssistStore((api, doc) => {
    const cur = api.current(doc);
    if (!cur) return null;
    return api.setMessages(doc, cur.id, (cur.messages || []).slice(0, idx));
  });
  aiAssist.editing = -1;
  renderAiAssist();
  askAiAssist(req, { anchor: idx - 1 });
}
function resendAiAssist(idx, rawText) {
  if (aiAssist.busy) { toast('正在生成，先停一下再发'); return; }
  const text = String(rawText || '').trim();
  if (!text) { toast('内容不能为空'); return; }
  const req = { mode: 'custom', query: text, think: aiAssistThinkOn(), web: aiAssistWebOn() };
  const ok = aiAssistStore((api, doc) => {
    const cur = api.current(doc);
    if (!cur) return null;
    api.setMessages(doc, cur.id, (cur.messages || []).slice(0, idx));
    api.append(doc, { role: 'user', text: text, request: aiAssistRepeatReq(req), ts: Date.now() });
    return true;
  });
  if (!ok) return;
  aiAssist.editing = -1;
  renderAiAssist();
  renderAiAssistSessions();
  askAiAssist(req, { anchor: idx });
}
function branchAiAssist(idx) {
  if (aiAssist.busy) { toast('正在生成，先停一下再分支'); return; }
  const done = aiAssistStore((api, doc) => {
    const cur = api.current(doc);
    if (!cur) return null;
    return api.branch(doc, cur.id, idx);
  });
  if (!done) { toast('分支失败，请重试'); return; }
  aiAssist.editing = -1;
  renderAiAssistSessions();
  renderAiAssist();
  toast('已从这条消息开出新会话');
}
async function stopAiAssist() {
  if (!aiAssist.busy || aiAssist.stopping) return;
  aiAssist.stopping = true;
  renderAiAssistSend();
  try { if (bridge.aiCancel) await bridge.aiCancel(); } catch (e) { /* 已经结束 */ }
}
async function toggleAiAssistFlag(kind) {
  if (!bridge.aiSaveConfig) { toast('当前环境不支持保存开关'); return; }
  const key = kind === 'web' ? 'aiWeb' : 'aiThink';
  const prev = state[key] !== false;
  state[key] = !prev;
  renderAiAssistToggles();
  const patch = {};
  patch[kind === 'web' ? 'web' : 'think'] = state[key];
  let ok = false;
  try {
    const res = await bridge.aiSaveConfig(patch);
    if (res && res.ok !== false) {
      const got = kind === 'web' ? res.web : res.think;
      if (typeof got === 'boolean') state[key] = got;
      ok = true;
    }
  } catch (e) { ok = false; }
  if (!ok) {
    state[key] = prev;
    toast('开关没保存成功，请重试');
  }
  renderAiAssistToggles();
}
function autoGrowAiInput() {
  const el = $('aiAssistInput');
  if (!el) return;
  const cs = window.getComputedStyle(el);
  const lh = parseFloat(cs.lineHeight) || 21;
  const pad = (parseFloat(cs.paddingTop) || 0) + (parseFloat(cs.paddingBottom) || 0);
  const max = lh * 6 + pad;
  el.style.height = 'auto';
  const h = Math.min(el.scrollHeight, max);
  el.style.height = h + 'px';
  el.style.overflowY = el.scrollHeight > max ? 'auto' : 'hidden';
}
function refreshAiAssistConfig() {
  if (!bridge.aiConfig) return;
  Promise.resolve(loadAiConfig())
    .then(() => { renderAiAssistModel(); renderAiAssistToggles(); })
    .catch(() => {});
}
function openAiAssistant() {
  const el = $('aiAssistant');
  if (!el) return;
  aiAssistEnsureDoc();
  syncAiAssistMessages();
  aiAssist.editing = -1;
  el.hidden = false;
  renderAiAssistModel();
  renderAiAssistToggles();
  renderAiAssistSend();
  renderAiAssistSessions();
  renderAiAssist();
  refreshAiAssistConfig();
  setTimeout(() => {
    const ta = $('aiAssistInput');
    if (ta) { ta.focus(); autoGrowAiInput(); }
  }, 60);
}
function closeAiAssistant() {
  const el = $('aiAssistant');
  if (!el) return;
  el.hidden = true;
  aiAssist.editing = -1;
  const list = $('aiAssistSessions');
  if (list) list.hidden = true;
  const btn = $('btnAiAssistList');
  if (btn) btn.setAttribute('aria-expanded', 'false');
  setAiAssistModelMenu(false);
  renderAiAssist();
}

function bindAiAssistant() {
  const openBtn = $('btnAiAssistant');
  if (openBtn) openBtn.addEventListener('click', openAiAssistant);
  const openBtn2 = $('btnAiAssistantSide');
  if (openBtn2) openBtn2.addEventListener('click', openAiAssistant);
  const closeBtn = $('btnAiAssistClose');
  if (closeBtn) closeBtn.addEventListener('click', closeAiAssistant);
  const backdrop = $('aiAssistBackdrop');
  if (backdrop) {
    backdrop.addEventListener('click', () => {
      if (aiAssist.modelOpen) { setAiAssistModelMenu(false); return; }
      const list = $('aiAssistSessions');
      if (list && !list.hidden) {
        list.hidden = true;
        const b = $('btnAiAssistList');
        if (b) b.setAttribute('aria-expanded', 'false');
        return;
      }
      closeAiAssistant();
    });
  }
  const modelBtn = $('btnAiAssistModel');
  if (modelBtn) {
    modelBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      setAiAssistModelMenu(!aiAssist.modelOpen);
    });
  }
  const modelCfg = $('btnAiAssistModelCfg');
  if (modelCfg) {
    modelCfg.addEventListener('click', (e) => {
      e.stopPropagation();
      setAiAssistModelMenu(false);
      if (typeof openAiSetup === 'function') openAiSetup();
    });
  }
  const modelSearch = $('aiAssistModelSearch');
  if (modelSearch) {
    modelSearch.addEventListener('input', () => renderAiAssistModelMenu());
    modelSearch.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { e.stopPropagation(); setAiAssistModelMenu(false); }
    });
  }
  document.addEventListener('click', (e) => {
    if (!aiAssist.modelOpen) return;
    if (e.target && e.target.closest && e.target.closest('.ai-model-wrap')) return;
    setAiAssistModelMenu(false);
  });
  const newBtn = $('btnAiAssistNew');
  if (newBtn) newBtn.addEventListener('click', newAiAssistSession);
  const sessNew = $('btnAiAssistSessNew');
  if (sessNew) sessNew.addEventListener('click', newAiAssistSession);
  const listBtn = $('btnAiAssistList');
  if (listBtn) {
    listBtn.addEventListener('click', () => {
      const list = $('aiAssistSessions');
      if (!list) return;
      const open = list.hidden;
      list.hidden = !open;
      listBtn.setAttribute('aria-expanded', String(open));
      if (open) renderAiAssistSessions();
    });
  }
  const thinkBtn = $('btnAiAssistThink');
  if (thinkBtn) thinkBtn.addEventListener('click', () => toggleAiAssistFlag('think'));
  const webBtn = $('btnAiAssistWeb');
  if (webBtn) webBtn.addEventListener('click', () => toggleAiAssistFlag('web'));
  const sendBtn = $('btnAiAssistSend');
  if (sendBtn) {
    sendBtn.addEventListener('click', () => {
      if (aiAssist.busy) stopAiAssist();
      else sendAiAssist();
    });
  }
  const ta = $('aiAssistInput');
  if (ta) {
    ta.addEventListener('input', autoGrowAiInput);
    ta.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter' || e.shiftKey) return;
      if (e.isComposing || e.keyCode === 229) return;
      e.preventDefault();
      sendAiAssist();
    });
  }
  const body = $('aiAssistBody');
  if (body) {
    body.addEventListener('click', (e) => {
      const target = e.target;
      const btn = target && target.closest ? target.closest('[data-ai-copy="code"]') : null;
      if (!btn) return;
      const box = btn.closest('.ai-code');
      const code = box ? box.querySelector('pre code') : null;
      if (code) aiAssistCopy(code.textContent, btn, '复制代码');
    });
  }
  window.addEventListener('ai-store-changed', () => {
    if (aiAssist.mute || !isAiAssistOpen() || aiAssist.busy) return;
    aiAssist.doc = aiAssistApi() ? aiAssistApi().load() : null;
    syncAiAssistMessages();
    renderAiAssistSessions();
    renderAiAssist();
  });
  const api = aiAssistApi();
  if (api) {
    aiAssist.doc = api.load();
    syncAiAssistMessages();
    if (typeof aiAssist.doc.currentId === 'string') {
      const cur = api.current(aiAssist.doc);
      if (cur) aiAssist.actualModel = '';
    }
  }
  renderAiAssistToggles();
  renderAiAssistModel();
  renderAiAssistSend();
  if (ta) autoGrowAiInput();
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
  $('btnMsEggClose').addEventListener('click', closeMilestoneEgg);
  $('btnDayEgg').addEventListener('click', () => {
    const raw = $('btnDayEgg').dataset.eggDay;
    if (raw === '' || raw == null) return;
    const days = Number(raw);
    if (Number.isNaN(days)) return;
    // 手动打开也视为当天已看过，避免关闭后自动补弹
    try { localStorage.setItem('gk-egg-auto-' + days + '-' + state.targetDate, '1'); } catch (e) { /* 忽略 */ }
    if (msEggPending === days) msEggPending = null;
    msEggAutoKey = '';
    enterEggFullscreen().then(() => showMilestoneEgg(days, true, true));
  });
  /* 重置当天彩蛋记录：下次打开程序时像第一次一样自动全屏播放 */
  $('btnEggReset').addEventListener('click', () => {
    const raw = $('btnEggReset').dataset.eggDay;
    if (raw === '' || raw == null) return;
    const days = Number(raw);
    if (Number.isNaN(days)) return;
    const key = 'gk-egg-auto-' + days + '-' + state.targetDate;
    try { localStorage.removeItem(key); } catch (e) { /* 忽略 */ }
    msEggResetHold = key;
    if (msEggAutoKey === key) msEggAutoKey = '';
    if (msEggPending === days) msEggPending = null;
    bridge.log('MILESTONE_EGG_RESET', { days, targetDate: state.targetDate });
    toast('彩蛋已重置 · 下次打开程序会再次播放');
  });
  /* 彩蛋：准备阶段点任意位置播放视频，卡片阶段点空白处关闭 */
  $('msEgg').addEventListener('click', (e) => {
    if (e.target.closest('.ms-egg__card') || e.target.closest('.ms-egg__skip')) return;
    if (msEggStage === 'ready') {
      playMsEggVideo();
      return;
    }
    if (msEggStage === 'card') closeMilestoneEgg();
  });
  $('btnMsEggSkip').addEventListener('click', (e) => {
    e.stopPropagation();
    if (msEggStage === 'playing' || msEggStage === 'ready') showMsEggCard();
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

  // 窗口按钮（最小化已移除：主界面只有宠物模式 / 设置 / 收进桌面宠物）
  // 点 × 关闭主界面时收进桌面宠物，而不是退出
  $('btnClose').addEventListener('click', async () => {
    $('settings').hidden = true;
    $('drawModal').hidden = true;
    $('firstDraw').hidden = true;
    if (!$('msEgg').hidden) closeMilestoneEgg();
    state.debugPreview = false;
    await enterPetMode();
    toast('已收进桌面宠物');
  });
  $('btnPet').addEventListener('click', enterPetMode);
  $('btnSettings').addEventListener('click', openSettings);

  // 宠物
  $('petView').addEventListener('contextmenu', (e) => {
    e.preventDefault();
    openPetMenu(e.clientX, e.clientY);
  });
  $$('.pet-actions button').forEach((btn) => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const act = btn.dataset.petAct;
      if (act === 'plus') await bridge.changeScale(0.1);
      else if (act === 'minus') await bridge.changeScale(-0.1);
      else if (act === 'panel') await bridge.setPetMode(false);
      else if (act === 'menu') {
        const r = btn.getBoundingClientRect();
        openPetMenu(r.left - 110, r.bottom + 6);
      }
    });
  });
  $('petMenu').addEventListener('click', async (e) => {
    const skinBtn = e.target.closest('[data-skin-id]');
    if (skinBtn) {
      const id = skinBtn.dataset.skinId;
      closePetMenu();
      if (!SKIN_META.some((s) => s.id === id)) return;
      state.skin = id;
      applySkin(id);
      renderSkinGrid();
      try {
        await bridge.saveSettings({ skin: id });
        toast('已切换为「' + SKIN_META.find((s) => s.id === id).name + '」');
      } catch (err) { /* 忽略 */ }
      return;
    }
    const btn = e.target.closest('[data-menu-act]');
    if (!btn) return;
    const act = btn.dataset.menuAct;
    if (act === 'skin') {
      const sub = $('petMenuSkins');
      sub.hidden = !sub.hidden;
      clampPetMenu();
      return;
    }
    closePetMenu();
    if (act === 'panel') await bridge.setPetMode(false);
    else if (act === 'classroom') bridge.openClassroom();
    else if (act === 'timetable') bridge.openTimetable();
    else if (act === 'knowledge') bridge.openKnowledge();
    else if (act === 'plus') await bridge.changeScale(0.1);
    else if (act === 'minus') await bridge.changeScale(-0.1);
  });
  document.addEventListener('click', (e) => {
    const menu = $('petMenu');
    if (menu && !menu.hidden && !e.target.closest('#petMenu')) closePetMenu();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closePetMenu();
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
    setTimeout(maybeTodayEgg, 600);
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
  /* AI 配置：设置页一行入口 → 弹窗内完成全部配置 */
  const aiRow = $('aiRow');
  const openAiByRow = (e) => { if (e) e.preventDefault(); openAiSetup(); };
  if (aiRow) {
    aiRow.addEventListener('click', openAiByRow);
    aiRow.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') openAiByRow(e);
    });
  }
  $('btnAi2Close').addEventListener('click', closeAiSetup);
  const ai2Back = $('aiModal2').querySelector('[data-ai2-close]');
  if (ai2Back) ai2Back.addEventListener('click', closeAiSetup);

  /* AI 助手抽屉：入口按钮、会话列表、发送与停止都在 bindAiAssistant 里 */
  bindAiAssistant();

  /* 输入即写回内存：切换供应商或重画时不会把刚填的字擦掉 */
  if ($('aiInputBase')) {
    $('aiInputBase').addEventListener('input', (e) => {
      state.aiBaseUrl = e.target.value;
      aiSaveError('');
      refreshAiSaveState();
    });
  }
  if ($('aiInputModel')) {
    $('aiInputModel').addEventListener('input', (e) => {
      state.aiModel = e.target.value;
      aiSaveError('');
      refreshAiSaveState();
    });
  }
  if ($('aiInputKey')) {
    $('aiInputKey').addEventListener('input', (e) => {
      state.aiKeyDraft = e.target.value;
      aiSaveError('');
    });
  }

  /* 自动模型选择开关 */
  if ($('switchAiAutoModel')) {
    $('switchAiAutoModel').addEventListener('click', async () => {
      const next = !state.aiAutoModel;
      state.aiAutoModel = next;
      renderAiSetup();
      try {
        const res = await bridge.aiSaveConfig({ autoModel: next });
        if (res && res.ok) {
          state.aiAutoModel = res.autoModel !== false;
          aiSetupTip(next ? '已开启自动模型选择，排队或报错时按顺序换模型。' : '已关闭自动模型选择。');
        } else {
          aiSaveError((res && res.error) || '开关没保存成功，请重试');
        }
      } catch (e) {
        aiSaveError('开关没保存成功：' + e.message);
      }
      renderAiSetup();
    });
  }

  if ($('btnAi2Cancel')) $('btnAi2Cancel').addEventListener('click', closeAiSetup);

  /* 清除密钥：只清当前供应商这一桶 */
  if ($('btnAi2Clear')) {
    $('btnAi2Clear').addEventListener('click', async () => {
      try {
        const res = await bridge.aiClearKey(state.aiProvider);
        if (res && res.ok) {
          state.aiHasKey = false;
          state.aiModelList = [];
          await loadAiConfig();
          renderAiSetup();
          aiSetupTip('已清除「' + (aiProviderMeta(state.aiProvider).name || 'AI') + '」在本机保存的密钥。');
        } else {
          aiSaveError((res && res.error) || '清除失败，请重试');
        }
      } catch (e) { aiSaveError('清除失败：' + e.message); }
    });
  }

  /* 拉取模型：Kilo 免费池免密钥也能拉，不按密钥有无禁用 */
  if ($('btnAiFetchModels')) {
    $('btnAiFetchModels').addEventListener('click', async () => {
      const btn = $('btnAiFetchModels');
      const { base, model, key } = aiFormValues();
      const isCustom = state.aiProvider === 'custom';
      const noKey = aiIsNoKey();
      if (!key && !state.aiHasKey && !noKey) {
        aiSetupTip('请先填写 API 密钥，再获取模型列表。', true);
        return;
      }
      btn.disabled = true;
      aiSetupTip('正在获取模型列表…');
      try {
        const patch = { provider: state.aiProvider };
        if (isCustom && base) patch.baseUrl = base;
        if (model) patch.model = model;
        const cfg = await bridge.aiSaveConfig(patch);
        if (!cfg || !cfg.ok) {
          aiSaveError((cfg && cfg.error) || '配置没保存成功，无法获取模型');
          aiSetupTip('');
          return;
        }
        if (key && !noKey) {
          const saved = await bridge.aiSaveKey(key, state.aiProvider);
          if (!saved || !saved.ok) { aiSaveError((saved && saved.error) || '密钥保存失败'); aiSetupTip(''); return; }
          state.aiKeyDraft = '';
        }
        aiSaveError('');
        const res = bridge.aiListModels ? await bridge.aiListModels() : { ok: false, error: '当前版本不支持' };
        if (res && res.ok && Array.isArray(res.models) && res.models.length) {
          state.aiModelList = res.models.slice(0, 60);
          renderAiSetup();
          aiSetupTip('已获取 ' + res.models.length + ' 个模型' + (res.keyless ? '（免密钥）' : '') + '，点选即可使用。');
        } else {
          aiSetupTip((res && res.error) || '该服务没有返回模型列表，请手动填写模型名。', true);
        }
        await loadAiConfig();
        renderAiSetup();
      } catch (e) {
        aiSetupTip('获取失败：' + e.message, true);
      } finally {
        btn.disabled = false;
      }
    });
  }

  if ($('btnAiHelp')) {
    $('btnAiHelp').addEventListener('click', () => {
      aiSetupTip('密钥在该服务商的控制台创建，形如 sk- 或一串字母数字；各供应商的密钥分别保存在本机，可随时清除。');
    });
  }

  if ($('btnAiEye')) {
    $('btnAiEye').addEventListener('click', () => {
      const input = $('aiInputKey');
      if (!input) return;
      const show = input.type === 'password';
      input.type = show ? 'text' : 'password';
      $('btnAiEye').textContent = show ? '隐藏' : '显示';
    });
  }

  if ($('btnAi2GetKey')) {
    $('btnAi2GetKey').addEventListener('click', async () => {
      const meta = aiProviderMeta(state.aiProvider);
      try {
        const res = await bridge.aiOpenAuth();
        if (res && res.ok) {
          aiSetupTip('已打开浏览器。登录后复制 Key，回到这里粘贴即可（复制的内容会自动填入）。');
        } else if (meta.keyUrl) {
          await bridge.openExternal(meta.keyUrl);
          aiSetupTip('已打开「' + (meta.name || 'AI') + '」的密钥页面。');
        } else {
          aiSetupTip((res && res.error) || '打开失败，请手动访问服务商控制台。', true);
        }
      } catch (e) {
        aiSetupTip('打开浏览器失败，请手动访问服务商控制台。', true);
      }
    });
  }

  /* 测试连通性：先把弹窗里的地址与模型落到 store，再用它跑一次真实请求 */
  if ($('btnAi2Test')) {
    $('btnAi2Test').addEventListener('click', async () => {
      if (state.aiTesting) return;
      const btn = $('btnAi2Test');
      state.aiTesting = true;
      btn.disabled = true;
      aiTestLine('');
      aiSetupTip('正在测试连通性…');
      try {
        const { base, model, key } = aiFormValues();
        const isCustom = state.aiProvider === 'custom';
        const patch = { provider: state.aiProvider };
        if (model) patch.model = model;
        if (isCustom && base) patch.baseUrl = base;
        const cfg = await bridge.aiSaveConfig(patch);
        if (!cfg || !cfg.ok) {
          aiSaveError((cfg && cfg.error) || '配置没保存成功，无法测试');
          aiSetupTip('');
          return;
        }
        if (key && !aiIsNoKey()) {
          const saved = await bridge.aiSaveKey(key, state.aiProvider);
          if (!saved || !saved.ok) { aiSaveError((saved && saved.error) || '密钥保存失败'); aiSetupTip(''); return; }
          state.aiKeyDraft = '';
        }
        aiSaveError('');
        const res = await bridge.aiTest();
        if (res && res.ok) {
          const sec = (Number(res.latencyMs || 0) / 1000).toFixed(1);
          aiTestLine('正常 · ' + sec + ' 秒 · ' + (aiModelShort(res.model) || '未知模型') +
            (res.switched ? '（已自动换模型）' : ''));
          aiSetupTip('');
        } else {
          const err = String((res && res.error) || '未知原因');
          aiTestLine('连接失败 · ' + (err.length > 60 ? err.slice(0, 60) + '…' : err), true, err);
          aiSetupTip('');
        }
        await loadAiConfig();
        renderAiSetup();
      } catch (e) {
        const msg = String(e.message || '未知原因');
        aiTestLine('连接失败 · ' + (msg.length > 60 ? msg.slice(0, 60) + '…' : msg), true, msg);
      } finally {
        state.aiTesting = false;
        btn.disabled = false;
      }
    });
  }

  /* 保存：失败把主进程回传的 error 原文就地显示，不再只丢 toast */
  if ($('btnAi2Save')) {
    $('btnAi2Save').addEventListener('click', async () => {
      const missing = refreshAiSaveState();
      if (missing.length) {
        aiSaveError('还需要填写：' + missing.join('、') + '；填完才能保存。');
        return;
      }
      const { base, model, key } = aiFormValues();
      const isCustom = state.aiProvider === 'custom';
      const btn = $('btnAi2Save');
      btn.disabled = true;
      aiSaveError('');
      aiTestLine('');
      try {
        const patch = { enabled: true, provider: state.aiProvider, model, autoModel: !!state.aiAutoModel };
        if (isCustom && base) patch.baseUrl = base;
        const cfg = await bridge.aiSaveConfig(patch);
        if (!cfg || !cfg.ok) {
          aiSaveError((cfg && cfg.error) || '保存失败，请检查接口地址与模型名');
          return;
        }
        if (key && !aiIsNoKey()) {
          const saved = await bridge.aiSaveKey(key, state.aiProvider);
          if (!saved || !saved.ok) { aiSaveError((saved && saved.error) || '密钥保存失败'); return; }
          state.aiKeyDraft = '';
        }
        await loadAiConfig();
        renderAiSetup();
        aiSetupTip(state.aiReady === false ? '已保存，但配置还没填完整。' : '已保存，AI 知识助手已启用。');
        toast(state.aiReady === false ? '已保存，但配置还没填完整' : '已保存，AI 知识助手已启用');
      } catch (e) {
        aiSaveError('保存失败：' + e.message);
      } finally {
        btn.disabled = false;
        refreshAiSaveState();
      }
    });
  }
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
  $$('#petFreqGrid .freq-opt').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const id = btn.dataset.freq;
      if (!PET_FREQ_META.some((f) => f.id === id)) return;
      state.petFreq = id;
      renderPetFreq();
      // 立即按新频率重排下一次台词与动作，不用等旧间隔走完
      fishState.idleAt = 0;
      fishState.hwActionAt = 0;
      fishState.spokenAt = Date.now();
      try {
        await bridge.saveSettings({ petFreq: id });
        toast('互动频率已切换为「' + PET_FREQ_META.find((f) => f.id === id).name + '」');
      } catch (e) { /* 忽略 */ }
    });
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
  const renderBackup = () => {
    const info = state.backupInfo || { count: 0, latest: '' };
    $('backupStatus').textContent = info.latest
      ? `最近备份：${info.latest}（共 ${info.count} 份）`
      : '每天启动时自动备份，保留最近 7 天';
    const pathText = state.backupPath || state.backupDefaultPath || '默认位置';
    $('backupPathLabel').textContent = pathText;
    $('backupPathLabel').title = pathText;
    const tag = $('backupPathTag');
    const fallback = !!(state.backupCustom && state.backupFallback);
    tag.classList.toggle('is-fallback', fallback);
    tag.classList.toggle('is-custom', !!(state.backupCustom && !fallback));
    tag.textContent = state.backupCustom ? (fallback ? '已回退默认' : '自定义') : '默认';
    $('backupPathHint').textContent = fallback
      ? '自定义文件夹当前不可用，备份会先写到默认位置，恢复后自动写回。'
      : (state.backupCustom
        ? '备份文件会写进这个文件夹，换机或重装前直接复制走即可。'
        : '安装时可以预先指定，之后也能在这里更改；未指定就用默认位置。');
  };
  const applyBackup = (res) => {
    if (!res || !res.ok) return false;
    if (res.backupPath) state.backupPath = res.backupPath;
    if (res.backupDefaultPath) state.backupDefaultPath = res.backupDefaultPath;
    if (res.backupInfo) state.backupInfo = res.backupInfo;
    state.backupCustom = !!res.backupCustom;
    state.backupFallback = !!res.backupFallback;
    renderBackup();
    return true;
  };
  renderBackup();
  $('btnBackupDirPick').addEventListener('click', async () => {
    const res = await bridge.pickBackupDir();
    if (res && res.canceled) return;
    if (applyBackup(res)) toast('备份位置已更新');
    else toast((res && res.error) || '选择备份文件夹失败');
  });
  $('btnBackupDirReset').addEventListener('click', async () => {
    const res = await bridge.resetBackupDir();
    if (applyBackup(res)) toast('已恢复默认备份位置');
    else toast((res && res.error) || '操作失败');
  });
  $('btnBackupDirOpen').addEventListener('click', async () => {
    const res = await bridge.openBackupDir();
    if (res && res.ok) return;
    toast((res && res.error) || '打不开备份文件夹');
  });
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
    if (!$('msEgg').hidden && msEggStage === 'ready' && (e.key === 'Enter' || e.key === ' ')) {
      e.preventDefault();
      playMsEggVideo();
      return;
    }
    if (e.key === 'Escape') {
      if (!$('aiModal2').hidden) closeAiSetup();
      else if (aiAssist.modelOpen) setAiAssistModelMenu(false);
      else if (isAiAssistOpen()) closeAiAssistant();
      else if (!$('msEgg').hidden) closeMilestoneEgg();
      else if (!$('agreementModal').hidden) closeAgreementModal();
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
    pickBackupDir: async () => ({ ok: false, canceled: true }),
    resetBackupDir: async () => ({ ok: false, error: '浏览器预览不支持修改备份位置' }),
    openBackupDir: async () => ({ ok: false, error: '浏览器预览不支持打开文件夹' }),
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
    quit: () => {},
    onModeChanged: () => {},
    onSkinChanged: () => {},
    onScaleChanged: () => {},
    onDebugChanged: () => {},
    onDebugPreview: () => {},
    aiConfig: async () => ({
      ok: true, enabled: store.aiEnabled !== false, provider: store.aiProvider || 'zhipu', providerName: '智谱 GLM',
      baseUrl: store.aiBaseUrl || 'https://open.bigmodel.cn/api/paas/v4/', model: store.aiModel || 'glm-4.7-flash',
      topic: store.aiTopic || '每日热点', hasKey: !!store.aiKey,
      think: store.aiThink !== false, web: store.aiWeb !== false,
      loginUrl: 'https://bigmodel.cn/login?redirect=https%3A%2F%2Fbigmodel.cn%2Fusercenter%2Fproj-mgmt%2Fapikeys',
      keyUrl: 'https://bigmodel.cn/usercenter/proj-mgmt/apikeys',
      authUrl: 'https://bigmodel.cn/login', ready: true, readyError: '',
      providers: [
        { id: 'zhipu', name: '智谱 GLM', baseUrl: 'https://open.bigmodel.cn/api/paas/v4/', model: 'glm-4.7-flash',
          hint: 'GLM-4.7-Flash 输入输出全免，调用 API 不强制实名', hasAuth: true,
          keyUrl: 'https://bigmodel.cn/usercenter/proj-mgmt/apikeys',
          presets: ['glm-4.7-flash', 'glm-4-flash-250414', 'glm-z1-flash'] },
        { id: 'custom', name: '自定义', baseUrl: '', model: '', hint: '任意 OpenAI 兼容服务', hasAuth: false, keyUrl: '', presets: [] }
      ]
    }),
    aiSaveConfig: async (patch) => Object.assign(store, patch) && save(),
    aiOpenAuth: async () => ({ ok: true, url: 'https://bigmodel.cn/login' }),
    aiStopClipboard: async () => ({ ok: true }),
    aiSaveKey: async (key) => { store.aiKey = String(key || ''); save(); return { ok: true, hasKey: true }; },
    aiClearKey: async () => { store.aiKey = ''; save(); return { ok: true, hasKey: false }; },
    aiTest: async () => ({ ok: false, error: '浏览器预览模式不支持真实调用' }),
    aiListModels: async () => ({ ok: false, error: '浏览器预览模式不支持获取模型列表' }),
    aiHot: async () => ({ ok: true, date: dateKey(), count: 0, text: '（浏览器预览模式不联网取热点）', error: '' }),
    aiAsk: async () => ({ ok: false, error: '浏览器预览模式不支持真实调用' })
  };
}

boot();
