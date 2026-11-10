'use strict';
/* 学科知识签 · 独立窗口逻辑
   十门学科（语数英日理化生政史地，按设置选科过滤）/ 不重复抽取 / 十连抽 / 抽屉 / 公式 · 易错点 · 技巧 */

const $ = (id) => document.getElementById(id);
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

let SUBJECTS = SUBJECT_META.slice();

/* 合并正题库与公式/易错/技巧补充题库 */
const DATA = Object.assign({}, window.KNOWLEDGE || {});
const EXTRA = window.KNOWLEDGE_EXTRA || {};
Object.keys(EXTRA).forEach((key) => {
  DATA[key] = (Array.isArray(DATA[key]) ? DATA[key] : []).concat(Array.isArray(EXTRA[key]) ? EXTRA[key] : []);
});

const ALL = [];

const bridge = window.gaokao || {
  closeKnowledge: () => { try { window.close(); } catch (e) { /* ignore */ } },
  onSkinChanged: () => {},
  getInit: async () => null
};

const STORE_KEY = 'gk-know-drawn-v1';
const drawn = {};
const state = {
  subject: 'all',
  drawing: false,
  openDrawer: null,
  history: []
};

/* ---------------- 持久化的已抽记录（按九科全量保存，换选科后不丢） ---------------- */
function loadDrawn() {
  let raw = {};
  try { raw = JSON.parse(localStorage.getItem(STORE_KEY) || '{}') || {}; } catch (e) { raw = {}; }
  SUBJECT_META.forEach((s) => {
    const list = Array.isArray(raw[s.id]) ? raw[s.id] : [];
    drawn[s.id] = Array.from(new Set(list.filter((n) => Number.isInteger(n) && n > 0)));
  });
}
function saveDrawn() {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(drawn)); } catch (e) { /* ignore */ }
}
function isDrawn(it) {
  return drawn[it.subject].includes(it.index);
}
function totalDrawn() {
  return SUBJECTS.reduce((sum, s) => sum + drawn[s.id].length, 0);
}

/* ---------------- 题库组装 ---------------- */
function buildAll() {
  ALL.length = 0;
  SUBJECTS.forEach((s) => {
    const list = Array.isArray(DATA[s.id]) ? DATA[s.id] : [];
    list.forEach((item, i) => {
      ALL.push({
        subject: s.id,
        subjectName: s.name,
        color: s.color,
        index: i + 1,
        total: list.length,
        t: item.t || '',
        d: item.d || '',
        f: item.f || '',
        e: item.e || '',
        k: item.k || ''
      });
    });
  });
}

function pool() {
  const all = ALL.filter((it) => !isDrawn(it));
  return state.subject === 'all' ? all : all.filter((it) => it.subject === state.subject);
}

/* ---------------- 初始化 ---------------- */
function applySkin(id) {
  const valid = ['board', 'starry', 'warm', 'bamboo'];
  document.body.setAttribute('data-skin', valid.includes(id) ? id : 'board');
}

async function init() {
  const skin = new URLSearchParams(location.search).get('skin');
  applySkin(skin || 'board');
  if (bridge.onSkinChanged) {
    bridge.onSkinChanged((data) => {
      if (data && data.skin) applySkin(data.skin);
    });
  }

  try {
    const info = bridge.getInit ? await bridge.getInit() : null;
    const sel = info && info.store ? info.store.selectedSubjects : null;
    if (Array.isArray(sel) && sel.length) {
      const ids = new Set(sel.map((id) => (id === 'foreign' ? 'english' : id)));
      const filtered = SUBJECT_META.filter((s) => ids.has(s.id));
      if (filtered.length) SUBJECTS = filtered;
    }
  } catch (e) { /* 读取失败则展示全部十科 */ }

  loadDrawn();
  buildAll();
  $('kTotal').textContent = ALL.length;
  renderSubjects();
  updateStat();
  renderHistory();

  $('kDraw').addEventListener('click', () => beginDraw(false));
  $('kDraw10').addEventListener('click', () => beginDraw(true));
  $('kBack').addEventListener('click', () => bridge.closeKnowledge());

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') bridge.closeKnowledge();
    else if (e.key === ' ' || e.key === 'Enter') {
      if (e.target && /button|input|textarea/.test(e.target.tagName.toLowerCase())) return;
      e.preventDefault();
      beginDraw(false);
    }
  });
}

/* ---------------- 科目与抽屉 ---------------- */
function renderSubjects() {
  const box = $('kSubjects');
  box.innerHTML = '';

  const allBtn = document.createElement('button');
  allBtn.className = 'k-subject on';
  allBtn.dataset.subject = 'all';
  allBtn.style.setProperty('--c', '#d9b64a');
  allBtn.innerHTML = `<i></i><em>全部科目</em><b>${ALL.length}</b>`;
  box.appendChild(allBtn);

  SUBJECTS.forEach((s) => {
    const n = ALL.filter((x) => x.subject === s.id).length;
    if (!n) return;
    const btn = document.createElement('button');
    btn.className = 'k-subject';
    btn.dataset.subject = s.id;
    btn.style.setProperty('--c', s.color);
    btn.innerHTML = `<i></i><em>${s.name}</em><b>${n}</b>`;
    box.appendChild(btn);

    const drawer = document.createElement('div');
    drawer.className = 'k-drawer';
    drawer.dataset.subject = s.id;
    drawer.hidden = true;
    box.appendChild(drawer);
  });

  box.addEventListener('click', onSubjectAreaClick);
}

function onSubjectAreaClick(e) {
  const reset = e.target.closest('.k-drawer__reset');
  if (reset) {
    resetSubject(reset.closest('.k-drawer').dataset.subject);
    return;
  }

  const row = e.target.closest('.k-drawer__item');
  if (row) {
    const subject = row.closest('.k-drawer').dataset.subject;
    const idx = Number(row.dataset.index);
    const it = ALL.find((x) => x.subject === subject && x.index === idx);
    if (it) showItem(it, true);
    return;
  }

  const btn = e.target.closest('.k-subject');
  if (!btn || state.drawing) return;
  const subject = btn.dataset.subject;
  const wasOpen = state.openDrawer === subject;
  state.subject = subject;
  syncSubjectButtons();
  if (subject === 'all') closeDrawers();
  else if (wasOpen) closeDrawers();
  else openDrawer(subject);
  updateStat();
}

function syncSubjectButtons() {
  document.querySelectorAll('.k-subject').forEach((b) => {
    b.classList.toggle('on', b.dataset.subject === state.subject);
  });
}

function openDrawer(subject) {
  state.openDrawer = subject;
  document.querySelectorAll('.k-drawer').forEach((d) => {
    d.hidden = d.dataset.subject !== subject;
  });
  renderDrawer(subject);
}

function closeDrawers() {
  state.openDrawer = null;
  document.querySelectorAll('.k-drawer').forEach((d) => { d.hidden = true; });
}

function renderDrawer(subject) {
  const drawer = document.querySelector(`.k-drawer[data-subject="${subject}"]`);
  if (!drawer) return;
  const list = ALL.filter((x) => x.subject === subject);
  const drawnSet = new Set(drawn[subject] || []);

  drawer.innerHTML = '';
  const stat = document.createElement('div');
  stat.className = 'k-drawer__stat';
  stat.innerHTML = `<span>已抽 <b>${drawnSet.size}</b> 次 / 共 <b>${list.length}</b> 条</span>` +
    '<button class="k-drawer__reset">重置</button>';
  drawer.appendChild(stat);

  const listBox = document.createElement('div');
  listBox.className = 'k-drawer__list';
  list.forEach((it) => {
    const row = document.createElement('button');
    row.className = 'k-drawer__item' + (drawnSet.has(it.index) ? ' drawn' : '');
    row.dataset.index = String(it.index);
    const no = document.createElement('span');
    no.textContent = String(it.index).padStart(2, '0');
    const title = document.createElement('em');
    title.textContent = it.t;
    const mark = document.createElement('i');
    mark.textContent = '✓';
    row.appendChild(no);
    row.appendChild(title);
    row.appendChild(mark);
    listBox.appendChild(row);
  });
  drawer.appendChild(listBox);
}

function resetSubject(subject) {
  const meta = SUBJECTS.find((s) => s.id === subject);
  const label = meta ? meta.name : subject;
  if (!window.confirm(`重置${label}的抽取记录？之后可以重新抽到这些知识点。`)) return;
  drawn[subject] = [];
  saveDrawn();
  renderDrawer(subject);
  updateStat();
}

/* ---------------- 抽签 ---------------- */
function swayBell(el) {
  if (!el) return;
  el.classList.remove('sway');
  void el.offsetWidth;
  el.classList.add('sway');
  setTimeout(() => el.classList.remove('sway'), 1400);
}

function setButtons() {
  const rem = pool().length;
  $('kDraw').disabled = state.drawing || rem === 0;
  $('kDraw10').disabled = state.drawing || rem === 0;
  $('kDraw').textContent = rem === 0 ? '已全部抽完' : '摇 一 签';
  $('kDraw10').textContent = rem === 0 ? '已全部抽完' : '十 连 抽';
}

function beginDraw(ten) {
  if (state.drawing) return;
  const rem = pool();
  if (!rem.length) return;

  state.drawing = true;
  setButtons();
  if (window.GkSound) {
    GkSound.unlock();
    GkSound.playShake();
  }
  swayBell($('kWindbell'));

  let ticks = 0;
  const spin = setInterval(() => {
    const it = rem[Math.floor(Math.random() * rem.length)];
    showItem(it, false);
    if (++ticks >= 11) {
      clearInterval(spin);
      if (ten) revealTen(rem);
      else finishOne(rem);
    }
  }, 55);
}

function finishOne(rem) {
  const it = rem[Math.floor(Math.random() * rem.length)];
  drawn[it.subject].push(it.index);
  saveDrawn();
  showItem(it, true);
  pushHistory([it]);
  doneDraw();
}

/* 十连抽：与单抽一致的签卡翻转 + 风铃音效，逐张揭晓后汇总 */
async function revealTen(rem) {
  const count = Math.min(10, rem.length);
  const shuffled = rem.slice();
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const t = shuffled[i];
    shuffled[i] = shuffled[j];
    shuffled[j] = t;
  }
  const picks = shuffled.slice(0, count);
  picks.forEach((it) => drawn[it.subject].push(it.index));
  saveDrawn();

  for (let i = 0; i < picks.length; i++) {
    showItem(picks[i], true);
    if (window.GkSound) GkSound.playDrawDone();
    await new Promise((r) => setTimeout(r, 240));
  }

  renderBatch(picks, rem.length < 10);
  pushHistory(picks);
  doneDraw();
}

function doneDraw() {
  state.drawing = false;
  setButtons();
  updateStat();
  if (state.openDrawer) renderDrawer(state.openDrawer);
  renderHistory();
  if (window.GkSound) GkSound.playDrawDone();
}

function pushHistory(items) {
  items.forEach((it) => state.history.unshift(it));
  state.history = state.history.slice(0, 18);
}

/* ---------------- 展示 ---------------- */
function showItem(it, flash) {
  const sign = $('kSign');
  $('kEmpty').hidden = true;
  $('kBatch').hidden = true;
  sign.hidden = false;

  $('kSubjectBadge').textContent = it.subjectName;
  $('kNo').textContent = `第 ${it.index} 条 / 共 ${it.total} 条`;
  $('kTitle').textContent = it.t;
  $('kDesc').textContent = it.d;

  const formula = $('kFormula');
  formula.hidden = !it.f;
  formula.textContent = it.f || '';

  const error = $('kError');
  error.hidden = !it.e;
  $('kErrorText').textContent = it.e || '';

  const tip = $('kTipRow');
  tip.hidden = !it.k;
  $('kTip').textContent = it.k || '';

  if (flash) {
    sign.classList.remove('flash');
    void sign.offsetWidth;
    sign.classList.add('flash');
  }
}

function renderBatch(items, truncated) {
  $('kEmpty').hidden = true;
  $('kSign').hidden = true;
  $('kBatch').hidden = false;
  $('kBatchCount').textContent = items.length;

  const headEm = $('kBatch').querySelector('em');
  headEm.textContent = truncated
    ? `本科目仅剩 ${items.length} 条，已全部抽出`
    : '点击任意一条可看详情';

  const list = $('kBatchList');
  list.innerHTML = '';
  items.forEach((it) => {
    const row = document.createElement('button');
    row.className = 'k-batch__row';
    const badge = document.createElement('span');
    badge.className = 'k-batch__subject';
    badge.style.setProperty('--c', it.color);
    badge.textContent = it.subjectName;
    const title = document.createElement('em');
    title.textContent = it.t;
    row.appendChild(badge);
    row.appendChild(title);
    row.addEventListener('click', () => showItem(it, true));
    list.appendChild(row);
  });
}

/* ---------------- 统计与历史 ---------------- */
function updateStat() {
  const rem = pool().length;
  const currentDrawn = state.subject === 'all' ? totalDrawn() : (drawn[state.subject] || []).length;
  $('kPoolCount').textContent = rem;
  $('kDrawCount').textContent = currentDrawn;
  $('kTotalDrawn').textContent = totalDrawn();
  setButtons();
}

function renderHistory() {
  const list = $('kHistList');
  $('kHistCount').textContent = state.history.length;
  list.innerHTML = '';

  if (!state.history.length) {
    const empty = document.createElement('div');
    empty.className = 'k-history__empty';
    empty.textContent = '摇一签，签缘会记在这里';
    list.appendChild(empty);
    return;
  }

  state.history.forEach((it) => {
    const chip = document.createElement('button');
    chip.className = 'k-hist-chip';
    chip.style.setProperty('--c', it.color);
    chip.innerHTML = `<i></i><span>${it.subjectName} · ${it.t}</span>`;
    chip.title = it.t;
    chip.addEventListener('click', () => showItem(it, true));
    list.appendChild(chip);
  });
}

init();
