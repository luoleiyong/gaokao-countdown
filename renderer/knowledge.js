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
  getInit: async () => null,
  aiConfig: async () => ({ ok: false, enabled: false }),
  aiSaveConfig: async () => ({ ok: false, error: '当前环境不支持保存设置' }),
  aiAsk: async () => ({ ok: false, error: '当前环境不支持 AI 检索' }),
  aiHot: async () => ({ ok: false })
};

const STORE_KEY = 'gk-know-drawn-v1';
const drawn = {};
const state = {
  subject: 'all',
  drawing: false,
  openDrawer: null,
  history: [],
  /* AI 知识助手 */
  aiEnabled: false,
  aiMode: 'knowledge',
  aiBusy: false,
  aiTopic: '',
  aiLast: null,
  aiHistory: [],
  /* 会话界面状态（不参与持久化） */
  aiConfig: null,
  aiPendingModel: '',
  aiPendingReasoning: '',
  aiStopping: false,
  aiThink: false,
  aiWeb: false,
  aiPinned: true,
  aiEditing: -1,
  aiModelsOpen: false,
  aiClearArmed: false,
  aiClearTimer: 0,
  /* 会话列表：数据统一存在 window.AIStore（gk-ai-sessions-v1） */
  aiStore: null,
  aiSessionId: '',
  aiSessionEditing: '',
  aiSessionConfirm: '',
  aiSessionTimer: 0,
  aiSessionsOpen: false,
  aiSwitchSeq: 0,
  aiRun: null
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
    if (info && info.store) {
      state.aiEnabled = info.store.aiEnabled !== false;
      state.aiTopic = info.store.aiTopic || '';
    }
  } catch (e) { /* 读取失败则展示全部十科 */ }

  loadDrawn();
  state.aiHistory = loadAiHistory();
  buildAll();
  $('kTotal').textContent = ALL.length;
  renderSubjects();
  updateStat();
  renderHistory();

  $('kDraw').addEventListener('click', () => beginDraw(false));
  $('kDraw10').addEventListener('click', () => beginDraw(true));
  $('kBack').addEventListener('click', () => bridge.closeKnowledge());
  bindAi();

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      const modal = $('aiModal');
      if (modal && !modal.hidden) {
        e.preventDefault();
        /* 先收起抽屉与模型菜单，再退一层关弹窗 */
        if (state.aiSessionsOpen) setAiSessionsOpen(false);
        else if (state.aiModelsOpen) setAiModelMenu(false);
        else closeAiModal();
        return;
      }
      bridge.closeKnowledge();
    } else if (e.key === ' ' || e.key === 'Enter') {
      const modal = $('aiModal');
      if (modal && !modal.hidden) return;
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
/* ================== AI 对话：Markdown 渲染 ================== */
function escapeHtmlText(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
}

/* 段落 / 表格里的裸地址收成链接：可见文字只留域名，完整地址进 title。
   入参是已经转义过的 HTML，地址里的 & 是 &amp; 形式，直接放进属性合法；
   代码块与行内代码不走这里，地址保持原样。 */
function linkifyBareUrlText(html) {
  return String(html == null ? '' : html).replace(/https?:\/\/[^\s\u0001\u0002<>]+/gi, function (m) {
    var tail = '';
    var trail = m.match(/(?:&quot;|&#39;|[)\.,;:!?，。；：！？）】」』…、])+$/);
    if (trail) {
      tail = trail[0];
      m = m.slice(0, m.length - trail[0].length);
    }
    var href = safeHttpUrl(m.replace(/&amp;/g, '&'));
    if (!href) return m + tail;
    var host = urlHost(href);
    var label = host || href.slice(0, 40);
    if (label.length > 40) label = label.slice(0, 40);
    return '<a class="ai-md__url" href="' + m + '" title="' + m +
      '" target="_blank" rel="noopener noreferrer">' + escapeHtmlText(label) + '</a>' + tail;
  });
}

/* 轻量 Markdown → HTML：只覆盖对话里常见的语法，不引第三方库（CSP 限制 script-src self）
   安全：先剥掉控制字符，代码块与行内代码换成占位符，用户文本无法伪造占位符、也无法注入标签 */
function renderMarkdown(src) {
  var text = String(src == null ? '' : src)
    .replace(/\r\n?/g, '\n')
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '')
    .trim();
  if (!text) return '';

  var blocks = [];
  var hold = function (html) {
    blocks.push(html);
    return '\u0001B' + (blocks.length - 1) + '\u0002';
  };

  function inline(s) {
    var t = escapeHtmlText(s);
    var codes = [];
    t = t.replace(/\x60([^\x60]+)\x60/g, function (_m, code) {
      codes.push('<code>' + code + '</code>');
      return '\u0001C' + (codes.length - 1) + '\u0002';
    });
    t = t.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    t = t.replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>');
    t = t.replace(/==([^=]+)==/g, '<em>$1</em>');
    /* 行内代码此时已是占位符，代码里的地址不会被收成链接 */
    t = linkifyBareUrlText(t);
    t = t.replace(/\u0001C(\d+)\u0002/g, function (_m, i) { return codes[Number(i)] || ''; });
    return t;
  }

  /* 代码块：带语言标签与「复制代码」按钮（点击由 #aiChat 的事件代理处理） */
  text = text.replace(/\x60\x60\x60([\w+#.-]*)[ \t]*\n?([\s\S]*?)(?:\x60\x60\x60|$)/g, function (_m, lang, code) {
    var body = escapeHtmlText(String(code).replace(/\n+$/, ''));
    var tag = lang ? escapeHtmlText(lang) : '代码';
    return hold(
      '<div class="ai-code">' +
        '<div class="ai-code__bar"><span class="ai-code__lang">' + tag + '</span>' +
        '<button class="ai-code__copy" type="button" data-ai-copy="code">复制代码</button></div>' +
        '<pre><code>' + body + '</code></pre>' +
      '</div>'
    );
  });

  /* 表格 */
  text = text.replace(/(^\|.+\|[ \t]*\n\|[-: |]+\|[ \t]*\n(?:\|.*\|[ \t]*(?:\n|$))+)/gm, function (m) {
    var rows = m.trim().split('\n').filter(Boolean);
    if (rows.length < 2) return m;
    var split = function (r) { return r.replace(/^\||\|$/g, '').split('|').map(function (x) { return x.trim(); }); };
    var head = split(rows[0]);
    var body = rows.slice(2).map(split);
    var html = '<table><thead><tr>' + head.map(function (h) { return '<th>' + inline(h) + '</th>'; }).join('') + '</tr></thead><tbody>';
    body.forEach(function (r) {
      html += '<tr>' + head.map(function (_h, i) { return '<td>' + inline(r[i] || '') + '</td>'; }).join('') + '</tr>';
    });
    html += '</tbody></table>';
    return hold(html);
  });

  var out = [];
  var listType = null;
  var buf = [];
  var flushList = function () {
    if (!listType) return;
    out.push('<' + listType + '>' + buf.map(function (li) { return '<li>' + inline(li) + '</li>'; }).join('') + '</' + listType + '>');
    listType = null;
    buf = [];
  };

  var linesArr = text.split('\n');
  for (var i = 0; i < linesArr.length; i++) {
    var line = linesArr[i].trimEnd();
    if (!line.trim()) { flushList(); continue; }

    if (/^\u0001B\d+\u0002$/.test(line.trim())) { flushList(); out.push(line.trim()); continue; }
    if (/^(-{3,}|\*{3,}|_{3,})$/.test(line.trim())) { flushList(); out.push('<hr>'); continue; }

    var h = line.match(/^(#{1,4})\s+(.*)$/);
    if (h) {
      flushList();
      var lv = Math.min(3, h[1].length);
      out.push('<h' + lv + '>' + inline(h[2]) + '</h' + lv + '>');
      continue;
    }
    if (/^>\s?/.test(line)) {
      flushList();
      out.push('<blockquote>' + inline(line.replace(/^>\s?/, '')) + '</blockquote>');
      continue;
    }
    var ol = line.match(/^\s*(\d+)[.)、]\s+(.*)$/);
    if (ol) {
      if (listType !== 'ol') { flushList(); listType = 'ol'; }
      buf.push(ol[2]);
      continue;
    }
    var ul = line.match(/^\s*[-*+·•]\s+(.*)$/);
    if (ul) {
      if (listType !== 'ul') { flushList(); listType = 'ul'; }
      buf.push(ul[1]);
      continue;
    }
    flushList();
    out.push('<p>' + inline(line.trim()) + '</p>');
  }
  flushList();

  var html = out.join('');
  html = html.replace(/\u0001B(\d+)\u0002/g, function (_m, i2) { return blocks[Number(i2)] || ''; });
  return html;
}

/* ================== AI 对话：请求对象与会话历史 ================== */
/* 会话改存 gk-ai-sessions-v1（由 renderer/ai-store.js 管理），
   旧键 gk-ai-chat-v1 的迁移在 AIStore.load() 内部完成，这里不再读写它 */
var AI_CHAT_MAX = 200;   /* 与 AIStore.MAX_MESSAGES 对齐，切换会话不再截断 */
var AI_MODES = ['knowledge', 'news', 'custom'];
var AI_MODE_HINT = {
  knowledge: '按所选学科讲清一个知识点，并给出易错提醒。',
  news: '先取今日热点，再结合学科整理成可用的备考素材。',
  custom: '直接提出你的问题，回答会贴合所选学科。'
};
var AI_EXAMPLES = [
  { mode: 'knowledge', subject: '物理', topic: '', query: '梳理牛顿第二定律的易错点', tip: '知识点' },
  { mode: 'knowledge', subject: '物理', topic: '', query: '用表格对比动量守恒与能量守恒', tip: '知识点' },
  { mode: 'news', subject: '语文', topic: '科技热点', query: '', tip: '每日热点' },
  { mode: 'custom', subject: '数学', topic: '', query: '立体几何里二面角总找错，有没有通用步骤？', tip: '自定义' }
];

/* ================== AI 对话：思考过程与联网来源 ================== */
var AI_REASON_SHOW_MAX = 4000;   /* 折叠块里最多显示 4000 字 */
var AI_REASON_STORE_MAX = 8000;  /* 落 localStorage 的上限，避免长文撑爆配额 */
var AI_SEARCH_MAX = 8;           /* 来源列表最多 8 条 */

function cleanReasoning(raw) {
  var s = String(raw == null ? '' : raw).replace(/\r\n?/g, '\n');
  if (!s.trim()) return '';
  return s.length > AI_REASON_STORE_MAX ? s.slice(0, AI_REASON_STORE_MAX) : s;
}

/* 只接受 http / https，javascript: data: 之类一律丢掉 */
function safeHttpUrl(raw) {
  var s = String(raw == null ? '' : raw).trim();
  if (!s || s.length > 2000) return '';
  if (!/^https?:\/\//i.test(s)) return '';
  return s;
}

function urlHost(raw) {
  try { return String(new URL(raw).hostname || '').replace(/^www\./, ''); } catch (e) { return ''; }
}

function cleanSearch(raw) {
  if (!raw || typeof raw !== 'object') return null;
  var items = [];
  (Array.isArray(raw.items) ? raw.items : []).slice(0, AI_SEARCH_MAX).forEach(function (it) {
    if (!it || typeof it !== 'object') return;
    var url = safeHttpUrl(it.url);
    if (!url) return;
    items.push({
      title: String(it.title || url).slice(0, 160),
      url: url,
      date: String(it.date || '').slice(0, 40),
      snippet: String(it.snippet || '').slice(0, 300)
    });
  });
  return {
    ok: raw.ok !== false,
    query: String(raw.query || '').slice(0, 120),
    source: String(raw.source || '').slice(0, 60),
    items: items
  };
}

/* 折叠块用原生 <details>：summary 自带键盘焦点，Enter / Space 都能展开 */
function buildAiReasonBlock(m) {
  var raw = cleanReasoning(m && m.reasoning);
  if (!raw) return null;
  var shown = raw.length > AI_REASON_SHOW_MAX ? raw.slice(0, AI_REASON_SHOW_MAX) + '…' : raw;
  var det = document.createElement('details');
  det.className = 'ai-reason';
  var sum = document.createElement('summary');
  sum.className = 'ai-reason__sum';
  sum.textContent = '思考过程 · ' + raw.length + ' 字';
  sum.title = '点击展开模型思考过程';
  var body = document.createElement('div');
  body.className = 'ai-reason__body';
  body.textContent = shown;
  det.appendChild(sum);
  det.appendChild(body);
  return det;
}

/* 来源列表：meta 行下方一行「已联网检索 N 条 · 引擎」，展开后逐条给出域名、标题与摘要 */
function buildAiSearchBlock(m, idx) {
  var search = m && m.search;
  if (!search || typeof search !== 'object') return null;
  if (search.ok === false) return null;           /* 未命中：只在 meta 行提示 */
  var items = Array.isArray(search.items) ? search.items : [];
  if (!items.length) return null;

  var box = document.createElement('div');
  box.className = 'ai-src';

  var listId = 'aiSrcList' + idx;
  var head = document.createElement('button');
  head.type = 'button';
  head.className = 'ai-src__head';
  head.setAttribute('aria-expanded', 'false');
  head.setAttribute('aria-controls', listId);

  var engines = (Array.isArray(search.engines) ? search.engines : []).map(function (e) {
    return String((e && e.name) || '').trim();
  }).filter(Boolean);
  var read = search.read && typeof search.read === 'object' ? search.read : null;

  var title = document.createElement('span');
  title.className = 'ai-src__title';
  title.textContent = '已联网检索 ' + items.length + ' 条' + (engines.length ? ' · ' + engines.join(' / ') : '');
  head.appendChild(title);
  if (read && read.ok) {
    var readTag = document.createElement('span');
    readTag.className = 'ai-src__read';
    readTag.textContent = '读过 ' + read.ok + ' 篇';
    head.appendChild(readTag);
  }
  var caret = document.createElement('span');
  caret.className = 'ai-src__caret';
  caret.textContent = '展开';
  head.appendChild(caret);
  var tip = ['检索词：' + (search.query || '')];
  if (search.elapsed) tip.push('耗时 ' + search.elapsed + ' 秒');
  if (search.cached) tip.push('本次复用了刚才的结果');
  if (read && read.tried) tip.push('抓正文 ' + read.ok + '/' + read.tried);
  head.title = tip.join(' · ');

  var list = document.createElement('div');
  list.className = 'ai-src__list';
  list.id = listId;
  list.hidden = true;

  items.forEach(function (it) {
    var a = document.createElement('a');
    a.className = 'ai-src__item';
    a.href = it.url;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    a.title = it.snippet || it.title || it.url;
    /* 只显示「域名 · 标题」，不铺完整地址，避免长链接把气泡撑开 */
    var host = urlHost(it.url);
    var label = String(it.title || '').trim();
    if (!label || /^https?:\/\//i.test(label)) label = host || String(it.url || '').slice(0, 40);
    var t = document.createElement('span');
    t.className = 'ai-src__item-title';
    t.textContent = host ? (label && label !== host ? host + ' · ' + label : host) : label;
    a.appendChild(t);
    var excerpt = String(it.excerpt || '').trim();
    if (excerpt) {
      var ex = document.createElement('span');
      ex.className = 'ai-src__excerpt';
      ex.textContent = excerpt.slice(0, 160);
      a.appendChild(ex);
    }
    var meta = document.createElement('span');
    meta.className = 'ai-src__item-meta';
    meta.textContent = [it.src, it.date].filter(Boolean).join(' · ');
    if (!meta.textContent) meta.hidden = true;
    a.appendChild(meta);
    list.appendChild(a);
  });

  head.addEventListener('click', function () {
    var open = list.hidden;
    list.hidden = !open;
    head.setAttribute('aria-expanded', String(open));
    caret.textContent = open ? '收起' : '展开';
  });

  box.appendChild(head);
  box.appendChild(list);
  return box;
}

/* 请求对象：只放主进程认识的字段，绝不存展示文案 */
function cleanRequest(raw) {
  if (!raw || typeof raw !== 'object') return null;
  var mode = AI_MODES.indexOf(raw.mode) >= 0 ? raw.mode : 'knowledge';
  var req = {
    mode: mode,
    subject: String(raw.subject || '').slice(0, 20),
    topic: String(raw.topic || '').slice(0, 60),
    query: String(raw.query || '').slice(0, 500)
  };
  if (!req.topic && !req.query) return null;
  return req;
}

function normalizeAiMessage(raw) {
  if (!raw || typeof raw !== 'object' || !raw.role) return null;
  var role = raw.role === 'user' ? 'user' : 'assistant';
  var text = String(raw.text == null ? '' : raw.text);
  var reason = role === 'assistant' ? cleanReasoning(raw.reasoning) : '';
  if (!text && !raw.error && !reason) return null;
  var msg = { role: role, text: text, time: typeof raw.time === 'string' ? raw.time : '' };
  var req = cleanRequest(raw.request);
  if (req) msg.request = req;
  if (role === 'assistant') {
    if (raw.model) msg.model = String(raw.model);
    if (raw.modelName) msg.modelName = String(raw.modelName);
    if (raw.source) msg.source = String(raw.source);
    if (reason) msg.reasoning = reason;
    var search = cleanSearch(raw.search);
    if (search) msg.search = search;
    if (Number.isFinite(raw.ms)) msg.ms = raw.ms;
    if (raw.switched) {
      msg.switched = true;
      if (Array.isArray(raw.attempted)) msg.attempted = raw.attempted.slice(0, 4);
    }
    if (raw.audit && typeof raw.audit === 'object') {
      msg.audit = {
        ok: raw.audit.ok !== false,
        issues: Array.isArray(raw.audit.issues) ? raw.audit.issues.slice(0, 5).map(String) : [],
        note: String(raw.audit.note || '')
      };
    }
    if (raw.error) msg.error = true;
    if (raw.stopped) msg.stopped = true;
    if (raw.rawError) msg.rawError = String(raw.rawError);
  }
  return msg;
}

/* ---------------- 会话存储：统一走 window.AIStore ----------------
   函数名保持不变（loadAiHistory / saveAiHistory / trimAiHistory），调用点不用改。
   ai-store 的 normalizeMessage 只认固定字段，被它丢掉的展示字段
   （modelName / source / switched / attempted / error / stopped / time）
   打包进 request.ui 一起存，读回来再摊平，上层消息结构不变。 */
function ensureAiStore() {
  var api = window.AIStore;
  if (!api || typeof api.load !== 'function') return null;
  if (!state.aiStore || !Array.isArray(state.aiStore.sessions) || !state.aiStore.sessions.length) {
    var knownIds = storedAiSessionIds(api);
    state.aiStore = api.load();
    settleLegacyMigration(api, knownIds);
  }
  return api;
}

/* load() 之前已落盘的会话 id：用来认出「这次 load() 新冒出来的会话」 */
function storedAiSessionIds(api) {
  var ids = {};
  var raw = null;
  try { raw = localStorage.getItem((api && api.KEY) || 'gk-ai-sessions-v1'); } catch (e) { raw = null; }
  if (!raw) return ids;
  var data = null;
  try { data = JSON.parse(raw); } catch (e2) { data = null; }
  if (data && Array.isArray(data.sessions)) {
    data.sessions.forEach(function (s) { if (s && s.id) ids[s.id] = true; });
  }
  return ids;
}

/* 旧键 gk-ai-chat-v1 的迁移由 AIStore.load() 负责，但它既不清旧键，也会在每次
   load() 时再迁出一份，等于每开一次知识窗多一个同名会话。第一次迁移时把迁出来的
   会话内容记成自己的标记（旧键本身不读不写），之后凡是这次 load() 新冒出来、内容
   等于该标记或正好是另一个会话前缀的会话，都按重复副本清掉。 */
var AI_LEGACY_SETTLED_KEY = 'gk-ai-legacy-settled-v1';
function aiSessionSig(s) {
  var list = s && Array.isArray(s.messages) ? s.messages : [];
  return list.map(function (m) { return (m.role || '') + '\u0001' + String(m.text || ''); }).join('\u0002');
}
function settleLegacyMigration(api, knownIds) {
  var st = state.aiStore;
  if (!api || !st || !Array.isArray(st.sessions) || !st.sessions.length) return;
  var known = knownIds || {};
  var fresh = st.sessions.filter(function (s) { return !known[s.id]; });
  if (!fresh.length) return;
  var saved = null;
  try { saved = JSON.parse(localStorage.getItem(AI_LEGACY_SETTLED_KEY) || 'null'); } catch (e) { saved = null; }
  if (!saved || typeof saved.sig !== 'string') {
    /* 第一次迁移：认下它，把内容记成基线，之后按内容判重 */
    var seed = fresh.length === 1 ? fresh[0] : null;
    if (!seed && st.sessions.length === 1) seed = st.sessions[0];
    if (seed) {
      try { localStorage.setItem(AI_LEGACY_SETTLED_KEY, JSON.stringify({ sig: aiSessionSig(seed), at: Date.now() })); } catch (e2) { /* 配额满时忽略 */ }
    }
    return;
  }
  var sigs = {};
  st.sessions.forEach(function (s) { sigs[s.id] = aiSessionSig(s); });
  var drop = {};
  fresh.forEach(function (s) {
    var sig = sigs[s.id];
    /* 空会话（新建还没聊）永远不删，否则用户刚建的新对话会被当成迁移副本吞掉 */
    if (!sig || sig.length < 8) return;
    if (sig === saved.sig) { drop[s.id] = true; return; }
    var host = st.sessions.some(function (t) {
      return t.id !== s.id && sigs[t.id].length > sig.length && sigs[t.id].indexOf(sig) === 0;
    });
    if (host) drop[s.id] = true;
  });
  if (!Object.keys(drop).length) return;
  st.sessions = st.sessions.filter(function (s) { return !drop[s.id]; });
  if (!st.sessions.length) {
    api.create(st, {});
    return;
  }
  if (!st.sessions.some(function (x) { return x.id === st.currentId; })) st.currentId = st.sessions[0].id;
  api.save(st);
}

function clockOf(ts) {
  var d = new Date(Number(ts) || Date.now());
  return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
}

/* 相对时间：刚刚 / N 分钟前 / N 小时前 / N 天前，超过 30 天显示日期 */
function relTimeOf(ts) {
  var t = Number(ts) || 0;
  if (!t) return '';
  var diff = Date.now() - t;
  if (diff < 60000) return '刚刚';
  var min = Math.floor(diff / 60000);
  if (min < 60) return min + ' 分钟前';
  var hr = Math.floor(min / 60);
  if (hr < 24) return hr + ' 小时前';
  var day = Math.floor(hr / 24);
  if (day < 30) return day + ' 天前';
  var d = new Date(t);
  return (d.getMonth() + 1) + '月' + d.getDate() + '日';
}

/* 存储消息 → 界面消息（兼容没有 reasoning / search / request.ui 的老数据） */
function fromStoredMessage(sm) {
  if (!sm || typeof sm !== 'object') return null;
  var ui = (sm.request && sm.request.ui && typeof sm.request.ui === 'object') ? sm.request.ui : {};
  var msg = normalizeAiMessage({
    role: sm.role,
    text: sm.text,
    time: typeof ui.time === 'string' && ui.time ? ui.time : clockOf(sm.ts),
    request: sm.request,
    reasoning: sm.reasoning,
    search: sm.search,
    model: sm.model,
    modelName: ui.modelName || '',
    providerName: sm.providerName,
    source: ui.source || '',
    audit: sm.audit,
    ms: sm.ms,
    error: !!(ui.error || sm.error),
    stopped: !!(ui.stopped || sm.stopped),
    rawError: ui.rawError || (typeof sm.error === 'string' && sm.error !== '1' ? sm.error : ''),
    switched: !!ui.switched,
    attempted: Array.isArray(ui.attempted) ? ui.attempted : []
  });
  if (msg) msg.ts = Number(sm.ts) || 0;
  return msg;
}

function aiUiOf(m) {
  var ui = {};
  if (m.time) ui.time = String(m.time);
  if (m.modelName) ui.modelName = String(m.modelName);
  if (m.source) ui.source = String(m.source);
  if (m.switched) ui.switched = true;
  if (Array.isArray(m.attempted) && m.attempted.length) ui.attempted = m.attempted.slice(0, 4);
  if (m.error) ui.error = true;
  if (m.stopped) ui.stopped = true;
  if (m.rawError) ui.rawError = String(m.rawError);
  return ui;
}

/* 界面消息 → 存储消息：request 里挂 ui，其余字段与 ai-store 白名单对齐 */
function toStoreMessage(m) {
  if (!m || !m.role) return null;
  var out = {
    role: m.role === 'user' ? 'user' : 'assistant',
    text: String(m.text == null ? '' : m.text),
    ts: Number(m.ts) || Date.now()
  };
  var req = m.request ? cleanRequest(m.request) : null;
  if (req) {
    var ui = aiUiOf(m);
    if (Object.keys(ui).length) req.ui = ui;
    out.request = req;
  }
  if (m.reasoning) out.reasoning = m.reasoning;
  if (m.search) out.search = m.search;
  if (m.model) out.model = m.model;
  if (m.providerName) out.providerName = m.providerName;
  if (m.audit) out.audit = m.audit;
  if (Number.isFinite(m.ms)) out.ms = m.ms;
  if (m.error) out.error = '1';
  if (m.stopped) out.stopped = true;
  return out;
}

/* 读当前会话；旧 localStorage 数据已在 AIStore.load() 里迁成一个会话 */
function loadAiHistory() {
  var api = ensureAiStore();
  if (!api) {
    state.aiSessionId = '';
    return [];
  }
  var cur = api.current(state.aiStore);
  state.aiSessionId = cur && cur.id ? cur.id : '';
  var list = cur && Array.isArray(cur.messages) ? cur.messages : [];
  return list.map(fromStoredMessage).filter(Boolean).slice(-AI_CHAT_MAX);
}

function saveAiHistory() {
  var api = ensureAiStore();
  if (!api) return;
  /* 会话可能已被删除或被迁移清理换掉，id 失效时回落到当前会话，避免静默丢写 */
  if (!state.aiSessionId || !api.get(state.aiStore, state.aiSessionId)) {
    var cur = api.current(state.aiStore);
    state.aiSessionId = cur && cur.id ? cur.id : '';
  }
  if (!state.aiSessionId) return;
  api.setMessages(state.aiStore, state.aiSessionId, state.aiHistory.map(toStoreMessage).filter(Boolean));
  renderAiSessions();
}

function trimAiHistory() {
  if (state.aiHistory.length > AI_CHAT_MAX) state.aiHistory = state.aiHistory.slice(-AI_CHAT_MAX);
}

function nowLabel() {
  return clockOf(Date.now());
}

/* ---------------- 会话列表 ---------------- */
function aiSessionEmptyText() {
  return '还没有对话';
}

function renderAiSessions() {
  var box = $('aiSessionList');
  if (!box) return;
  var api = ensureAiStore();
  var list = api ? api.summary(state.aiStore) : [];
  box.innerHTML = '';

  if (!list.length) {
    var empty = document.createElement('p');
    empty.className = 'ai-sessions__empty';
    empty.textContent = aiSessionEmptyText();
    box.appendChild(empty);
    return;
  }

  list.forEach(function (item) {
    var row = document.createElement('div');
    row.className = 'ai-session' + (item.current ? ' is-on' : '');
    row.dataset.sid = item.id;
    row.setAttribute('role', 'listitem');
    row.tabIndex = 0;

    if (state.aiSessionEditing === item.id) {
      row.classList.add('is-editing');
      var input = document.createElement('input');
      input.className = 'ai-session__rename';
      input.id = 'aiSessionRename';
      input.type = 'text';
      input.maxLength = 40;
      input.value = item.title || '';
      input.setAttribute('aria-label', '重命名对话');
      row.appendChild(input);
      box.appendChild(row);
      return;
    }

    var title = document.createElement('span');
    title.className = 'ai-session__title';
    title.textContent = item.title || '新对话';
    title.title = item.title || '新对话';

    var meta = document.createElement('span');
    meta.className = 'ai-session__meta';
    var count = document.createElement('span');
    count.className = 'ai-session__count';
    count.textContent = (Number(item.count) || 0) + ' 条';
    var when = document.createElement('span');
    when.className = 'ai-session__time';
    when.textContent = relTimeOf(item.updatedAt);
    meta.appendChild(count);
    meta.appendChild(when);

    var acts = document.createElement('div');
    acts.className = 'ai-session__acts';
    var ren = document.createElement('button');
    ren.type = 'button';
    ren.className = 'ai-session__act';
    ren.dataset.act = 'rename';
    ren.dataset.sid = item.id;
    ren.textContent = '重命名';
    ren.title = '重命名这个对话';
    var del = document.createElement('button');
    del.type = 'button';
    del.className = 'ai-session__act is-del';
    del.dataset.act = 'del';
    del.dataset.sid = item.id;
    del.textContent = '删除';
    del.title = '删除这个对话';
    acts.appendChild(ren);
    acts.appendChild(del);

    row.appendChild(title);
    row.appendChild(meta);
    row.appendChild(acts);

    if (state.aiSessionConfirm === item.id) {
      row.classList.add('is-confirm');
      var bar = document.createElement('div');
      bar.className = 'ai-session__confirm';
      var tip = document.createElement('span');
      tip.className = 'ai-session__confirm-tip';
      tip.textContent = '删除后不能恢复';
      var no = document.createElement('button');
      no.type = 'button';
      no.className = 'ai-session__act';
      no.dataset.act = 'del-no';
      no.dataset.sid = item.id;
      no.textContent = '取消';
      var yes = document.createElement('button');
      yes.type = 'button';
      yes.className = 'ai-session__act is-danger';
      yes.dataset.act = 'del-yes';
      yes.dataset.sid = item.id;
      yes.textContent = '删除';
      bar.appendChild(tip);
      bar.appendChild(no);
      bar.appendChild(yes);
      row.appendChild(bar);
    }

    box.appendChild(row);
  });

  var editing = $('aiSessionRename');
  if (editing) {
    setTimeout(function () {
      if (editing.isConnected) {
        editing.focus();
        try { editing.select(); } catch (e) { /* 忽略 */ }
      }
    }, 0);
  }
}

function beginRenameAiSession(id) {
  if (!id) return;
  state.aiSessionEditing = id;
  state.aiSessionConfirm = '';
  renderAiSessions();
}

function commitAiSessionRename() {
  var id = state.aiSessionEditing;
  if (!id) return;
  var input = $('aiSessionRename');
  var value = input ? input.value : '';
  var api = ensureAiStore();
  state.aiSessionEditing = '';
  if (api) api.rename(state.aiStore, id, value);
  renderAiSessions();
}

function armDeleteAiSession(id) {
  if (!id) return;
  state.aiSessionConfirm = id;
  clearTimeout(state.aiSessionTimer);
  state.aiSessionTimer = setTimeout(function () {
    if (state.aiSessionConfirm !== id) return;
    state.aiSessionConfirm = '';
    renderAiSessions();
  }, 6000);
  renderAiSessions();
}

function cancelDeleteAiSession() {
  state.aiSessionConfirm = '';
  clearTimeout(state.aiSessionTimer);
  renderAiSessions();
}

function confirmDeleteAiSession(id) {
  var api = ensureAiStore();
  if (!api || !id) return;
  if (state.aiBusy) {
    showAiNotice('正在生成，先点「停止」再删除对话。', true);
    return;
  }
  clearTimeout(state.aiSessionTimer);
  state.aiSessionConfirm = '';
  var wasCurrent = id === state.aiSessionId;
  api.remove(state.aiStore, id);
  if (wasCurrent || state.aiSessionId !== state.aiStore.currentId) {
    state.aiEditing = -1;
    state.aiPendingModel = '';
    state.aiPendingReasoning = '';
    resetAiClearArmed();
    state.aiHistory = loadAiHistory();
    renderAiChat({ bottom: true });
    updateAiSendState();
  }
  renderAiSessions();
  showAiNotice('已删除这个对话，其他对话不受影响。');
}

function newAiSession() {
  var api = ensureAiStore();
  if (!api) return;
  if (state.aiBusy) {
    showAiNotice('正在生成，先点「停止」再新建对话。', true);
    return;
  }
  var session = api.create(state.aiStore, {});
  state.aiSessionId = session && session.id ? session.id : state.aiStore.currentId;
  state.aiHistory = [];
  state.aiEditing = -1;
  state.aiPendingModel = '';
  state.aiPendingReasoning = '';
  state.aiSessionEditing = '';
  state.aiSessionConfirm = '';
  resetAiClearArmed();
  renderAiSessions();
  renderAiChat({ bottom: true });
  updateAiSendState();
  showAiNotice(AI_MODE_HINT[currentAiMode()]);
  setAiSessionsOpen(false);
  var q = $('aiQuery');
  if (q) {
    q.value = '';
    autoGrowQuery();
    q.focus();
  }
}

async function switchAiSession(id) {
  var api = ensureAiStore();
  if (!api || !id) return;
  setAiSessionsOpen(false);
  if (id === state.aiSessionId) return;
  state.aiSessionEditing = '';
  state.aiSessionConfirm = '';
  clearTimeout(state.aiSessionTimer);

  var seq = ++state.aiSwitchSeq;
  if (state.aiBusy) {
    showAiNotice('已停止上一个回答，正在切换对话。', true);
    try { await cancelAiAsk(); } catch (e) { /* 忽略 */ }
    if (state.aiRun) {
      try { await state.aiRun; } catch (e2) { /* 忽略 */ }
    }
  }
  if (seq !== state.aiSwitchSeq) return;

  api = ensureAiStore();
  if (!api) return;
  if (!api.get(state.aiStore, id)) {
    renderAiSessions();
    return;
  }
  state.aiStore.currentId = id;
  api.save(state.aiStore);
  state.aiSessionId = id;
  state.aiEditing = -1;
  state.aiPendingModel = '';
  state.aiPendingReasoning = '';
  resetAiClearArmed();
  state.aiHistory = loadAiHistory();
  state.aiPinned = true;
  renderAiSessions();
  renderAiChat({ bottom: true });
  updateAiSendState();
  showAiNotice(AI_MODE_HINT[currentAiMode()]);
  autoGrowQuery();
}

/* 分支：把当前会话截到第 idx 条（含）复制成新会话，原会话不动 */
function branchAiAt(idx) {
  if (state.aiBusy) {
    showAiNotice('正在生成，先点「停止」再分支。', true);
    return;
  }
  var api = ensureAiStore();
  if (!api) return;
  var session = api.branch(state.aiStore, state.aiSessionId, idx);
  if (!session) {
    showAiNotice('这条消息还不能分支。', true);
    return;
  }
  state.aiSessionId = session.id;
  state.aiHistory = loadAiHistory();
  state.aiEditing = -1;
  state.aiSessionEditing = '';
  state.aiSessionConfirm = '';
  resetAiClearArmed();
  state.aiPinned = true;
  renderAiSessions();
  renderAiChat({ bottom: true });
  updateAiSendState();
  showAiNotice('已在新对话里继续。');
  setAiSessionsOpen(false);
}

function setAiSessionsOpen(open) {
  state.aiSessionsOpen = !!open;
  var modal = $('aiModal');
  var box = modal ? modal.querySelector('.ai-box') : null;
  if (box) box.classList.toggle('is-sessions-open', state.aiSessionsOpen);
  var btn = $('btnAiSessions');
  if (btn) btn.setAttribute('aria-expanded', String(state.aiSessionsOpen));
}

function resetAiClearArmed() {
  if (!state.aiClearArmed) return;
  state.aiClearArmed = false;
  clearTimeout(state.aiClearTimer);
  var btn = $('btnAiClearChat');
  if (btn) {
    btn.textContent = '清空对话';
    btn.classList.remove('is-confirm');
  }
}

/* 统一的外链打开方式：避免把知识窗的 window 暴露给外部页面 */
function openAiExternal(href) {
  var url = String(href || '');
  if (!/^https?:\/\//i.test(url)) return;
  var win = null;
  try { win = window.open(url, '_blank'); } catch (e) { win = null; }
  if (win) {
    try { win.opener = null; } catch (e2) { /* 忽略 */ }
  }
}

/* 展示文案：由请求推导，编辑重发时不会把包装文案当成问题再包一层 */
function displayTextOf(req) {
  if (!req) return '';
  if (req.mode === 'custom') return req.query || req.topic;
  if (req.mode === 'news') return '整理「' + (req.topic || '每日热点') + '」相关素材';
  return '讲解「' + (req.query || req.topic) + '」';
}

/* 编辑框里显示的原文（不带「讲解」包装） */
function rawTextOf(m) {
  if (m && m.request) {
    if (m.request.mode === 'news') return m.request.topic || m.request.query;
    return m.request.query || m.request.topic;
  }
  return String((m && m.text) || '');
}

/* 老数据没有 request 时，从前一条用户消息推断请求（兜底，推断不出就隐藏重试按钮） */
function legacyRequestAt(idx) {
  for (var i = idx - 1; i >= 0; i--) {
    var m = state.aiHistory[i];
    if (!m || m.role !== 'user') continue;
    var t = String(m.text || '').trim();
    if (!t) return null;
    var news = t.match(/^整理「(.+)」相关素材$/);
    if (news) return { mode: 'news', subject: '', topic: news[1], query: '' };
    var know = t.match(/^讲解「(.+)」$/);
    if (know) return { mode: 'knowledge', subject: '', topic: '', query: know[1] };
    return { mode: 'custom', subject: '', topic: '', query: t };
  }
  return null;
}

function requestOfMessage(m, idx) {
  if (m && m.request) return m.request;
  return legacyRequestAt(idx);
}

/* 传给主进程的上下文：最近 6 条，去掉失败与停止的占位消息 */
function aiHistoryPayload(source) {
  var list = [];
  (source || state.aiHistory).forEach(function (m) {
    if (!m || m.error || m.stopped) return;
    var text = String(m.role === 'user' ? rawTextOf(m) : m.text || '').trim();
    if (!text) return;
    list.push({ role: m.role === 'user' ? 'user' : 'assistant', content: text });
  });
  return list.slice(-6);
}

/* ================== AI 对话：消息渲染 ================== */
function formatAiMs(ms) {
  var n = Number(ms);
  if (!isFinite(n) || n <= 0) return '';
  if (n < 1000) return '不到 1 秒';
  var s = n / 1000;
  if (s < 10) return s.toFixed(1) + ' 秒';
  if (s < 60) return Math.round(s) + ' 秒';
  var min = Math.floor(s / 60);
  var rest = Math.round(s - min * 60);
  return min + ' 分' + (rest ? ' ' + rest + ' 秒' : '');
}

function aiAuditLabel(audit) {
  if (!audit) return '';
  if (audit.note && /已按审核意见修正|已改写/.test(audit.note)) return '已改写';
  if (audit.issues && audit.issues.length) return '有审核提示';
  if (audit.note && /未完成|无法解析/.test(audit.note)) return '审核未完成';
  return '审核通过';
}

function copyAiText(text, btn, label) {
  var ok = true;
  try {
    if (bridge.copyText) {
      var r = bridge.copyText(String(text == null ? '' : text));
      if (r && r.ok === false) ok = false;
    } else if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(String(text == null ? '' : text));
    } else {
      ok = false;
    }
  } catch (e) { ok = false; }
  if (!btn) return;
  var back = label || '复制';
  btn.textContent = ok ? '已复制' : '复制失败';
  setTimeout(function () { if (btn.isConnected) btn.textContent = back; }, 1500);
}

function aiActionButton(label, onClick, extraClass) {
  var b = document.createElement('button');
  b.type = 'button';
  b.className = 'ai-msg__act' + (extraClass ? ' ' + extraClass : '');
  b.textContent = label;
  b.addEventListener('click', onClick);
  return b;
}

function buildAiMeta(m) {
  var meta = document.createElement('div');
  meta.className = 'ai-msg__meta';
  var parts = [];
  var name = m.modelName || m.model;
  if (name) parts.push({ text: name, cls: 'ai-msg__model' });
  var cost = formatAiMs(m.ms);
  if (cost) parts.push({ text: cost });
  var audit = aiAuditLabel(m.audit);
  if (audit) parts.push({ text: audit, cls: audit === '已改写' || audit === '有审核提示' ? 'is-warn' : '' });
  parts.forEach(function (p, i) {
    if (i) {
      var dot = document.createElement('span');
      dot.className = 'ai-msg__sep';
      dot.textContent = '·';
      meta.appendChild(dot);
    }
    var sp = document.createElement('span');
    sp.className = p.cls || '';
    sp.textContent = p.text;
    meta.appendChild(sp);
  });
  if (m.source && /联网/.test(m.source)) {
    var chip = document.createElement('span');
    chip.className = 'ai-msg__flag';
    chip.textContent = '联网热点';
    meta.appendChild(chip);
  }
  if (m.switched) {
    var sw = document.createElement('span');
    sw.className = 'ai-msg__flag is-warn';
    sw.textContent = '已自动换模型';
    var tried = Array.isArray(m.attempted) ? m.attempted : [];
    if (tried.length) {
      sw.title = tried.map(function (x) { return (x.model || '') + '：' + (x.error || ''); }).join('\n');
    }
    meta.appendChild(sw);
  }
  if (m.search && m.search.ok === false) {
    var miss = document.createElement('span');
    miss.className = 'ai-msg__netmiss';
    miss.textContent = '联网检索未命中';
    if (m.search.query) miss.title = '检索词：' + m.search.query;
    meta.appendChild(miss);
  }
  return meta;
}

function buildAiAuditBlock(m) {
  var audit = m.audit;
  if (!audit) return null;
  var issues = Array.isArray(audit.issues) ? audit.issues : [];
  if (!issues.length && !/未完成|无法解析/.test(audit.note || '')) return null;
  var box = document.createElement('div');
  box.className = 'ai-msg__audit' + (issues.length ? ' is-warn' : '');
  box.textContent = issues.length
    ? '审核提示：' + issues.join('；') + (audit.note ? '（' + audit.note + '）' : '')
    : '审核未完成：' + (audit.note || '请人工核对内容。');
  return box;
}

function buildAiTyping() {
  var wrap = document.createElement('div');
  wrap.className = 'ai-msg ai-msg--ai is-typing';
  var bubble = document.createElement('div');
  bubble.className = 'ai-msg__bubble';
  var dots = document.createElement('span');
  dots.className = 'ai-typing';
  dots.appendChild(document.createElement('i'));
  dots.appendChild(document.createElement('i'));
  dots.appendChild(document.createElement('i'));
  var label = document.createElement('span');
  label.className = 'ai-typing__text';
  var thinking = cleanReasoning(state.aiPendingReasoning);
  label.textContent = thinking
    ? (state.aiPendingModel || '模型') + ' 正在思考…'
    : (state.aiPendingModel || '模型') + ' 正在生成';
  bubble.appendChild(dots);
  bubble.appendChild(label);
  wrap.appendChild(bubble);
  return wrap;
}

function buildAiEditor(m, idx) {
  var box = document.createElement('div');
  box.className = 'ai-edit';
  var area = document.createElement('textarea');
  area.className = 'ai-edit__area';
  area.id = 'aiEditArea';
  area.rows = 3;
  area.value = rawTextOf(m);
  var acts = document.createElement('div');
  acts.className = 'ai-edit__acts';
  var save = aiActionButton('保存重发', function () { saveAiEdit(idx, area.value); }, 'is-primary');
  var cancel = aiActionButton('取消', function () { state.aiEditing = -1; renderAiChat(); });
  acts.appendChild(cancel);
  acts.appendChild(save);
  area.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); saveAiEdit(idx, area.value); }
    else if (e.key === 'Escape') { e.preventDefault(); state.aiEditing = -1; renderAiChat(); }
  });
  box.appendChild(area);
  box.appendChild(acts);
  return box;
}

function buildAiMessage(m, idx) {
  var isUser = m.role === 'user';
  var wrap = document.createElement('div');
  wrap.className = 'ai-msg ' + (isUser ? 'ai-msg--user' : 'ai-msg--ai') +
    (m.error ? ' is-error' : '') + (m.stopped ? ' is-stopped' : '');

  if (isUser) {
    if (state.aiEditing === idx) {
      wrap.appendChild(buildAiEditor(m, idx));
      return wrap;
    }
    var bubble = document.createElement('div');
    bubble.className = 'ai-msg__bubble';
    bubble.textContent = m.text;
    wrap.appendChild(bubble);

    var acts = document.createElement('div');
    acts.className = 'ai-msg__acts';
    var copyBtn = aiActionButton('复制', function () { copyAiText(m.text, copyBtn); });
    acts.appendChild(copyBtn);
    acts.appendChild(aiActionButton('编辑重发', function () { beginEditUser(idx); }));
    acts.appendChild(aiActionButton('分支', function () { branchAiAt(idx); }));
    wrap.appendChild(acts);
    return wrap;
  }

  var body = document.createElement('div');
  body.className = 'ai-msg__bubble';
  if (m.error || m.stopped) {
    var title = document.createElement('b');
    title.className = 'ai-msg__err-title';
    title.textContent = m.stopped ? '已停止生成' : '生成失败';
    body.appendChild(title);
    if (!m.stopped) {
      var p = document.createElement('p');
      p.className = 'ai-msg__err-text';
      p.textContent = m.text;
      body.appendChild(p);
    }
    if (m.rawError && m.rawError !== m.text) {
      var det = document.createElement('details');
      det.className = 'ai-msg__err-raw';
      var sum = document.createElement('summary');
      sum.textContent = '查看错误原文';
      var code = document.createElement('code');
      code.textContent = m.rawError;
      det.appendChild(sum);
      det.appendChild(code);
      body.appendChild(det);
    }
  } else {
    var reasonBlock = buildAiReasonBlock(m);
    if (reasonBlock) body.appendChild(reasonBlock);
    if (String(m.text || '').trim()) {
      var md = document.createElement('div');
      md.className = 'ai-md';
      md.innerHTML = renderMarkdown(m.text);
      body.appendChild(md);
    } else {
      var waiting = document.createElement('p');
      waiting.className = 'ai-think-pending';
      waiting.textContent = '正在思考…';
      body.appendChild(waiting);
    }
    var auditBox = buildAiAuditBlock(m);
    if (auditBox) body.appendChild(auditBox);
  }
  wrap.appendChild(body);

  if (!m.error && !m.stopped) {
    wrap.appendChild(buildAiMeta(m));
    var srcBlock = buildAiSearchBlock(m, idx);
    if (srcBlock) wrap.appendChild(srcBlock);
  }

  var row = document.createElement('div');
  row.className = 'ai-msg__acts';
  if (!m.error && !m.stopped) {
    var copyMd = aiActionButton('复制', function () { copyAiText(m.text, copyMd); });
    row.appendChild(copyMd);
  }
  var req = requestOfMessage(m, idx);
  if (req) {
    var retryLabel = m.error || m.stopped ? '重试' : '重新生成';
    row.appendChild(aiActionButton(retryLabel, function () { regenerateAt(idx); }));
  }
  if (m.error) {
    var copyErr = aiActionButton('复制错误', function () { copyAiText(m.rawError || m.text, copyErr); });
    row.appendChild(copyErr);
  }
  /* 分支：从这条消息（含）截出一个新对话，原对话不变 */
  row.appendChild(aiActionButton('分支', function () { branchAiAt(idx); }));
  if (row.childNodes.length) wrap.appendChild(row);
  return wrap;
}

function buildAiEmpty() {
  var wrap = document.createElement('div');
  wrap.className = 'ai-empty';
  var head = document.createElement('b');
  head.className = 'ai-empty__head';
  head.textContent = '想先问点什么？';
  var hint = document.createElement('p');
  hint.className = 'ai-empty__hint';
  hint.textContent = '点下面的示例直接开始，也可以自己输入问题。';
  var grid = document.createElement('div');
  grid.className = 'ai-examples';
  AI_EXAMPLES.forEach(function (ex) {
    var card = document.createElement('button');
    card.type = 'button';
    card.className = 'ai-example';
    var tip = document.createElement('em');
    tip.textContent = ex.tip;
    var text = document.createElement('span');
    text.textContent = ex.subject
      ? ex.subject + ' · ' + (ex.query || ('整理「' + ex.topic + '」相关素材'))
      : (ex.query || ('整理「' + ex.topic + '」相关素材'));
    card.appendChild(tip);
    card.appendChild(text);
    card.addEventListener('click', function () { applyAiExample(ex); });
    grid.appendChild(card);
  });
  wrap.appendChild(head);
  wrap.appendChild(hint);
  wrap.appendChild(grid);
  return wrap;
}

function renderAiChat(opts) {
  var box = $('aiChat');
  var scroll = $('aiChatScroll');
  if (!box || !scroll) return;
  var force = !!(opts && opts.bottom);
  var prevTop = scroll.scrollTop;
  var gap = scroll.scrollHeight - scroll.scrollTop - scroll.clientHeight;
  var atBottom = gap < 48;

  box.innerHTML = '';
  if (!state.aiHistory.length && !state.aiBusy) {
    box.appendChild(buildAiEmpty());
  } else {
    state.aiHistory.forEach(function (m, idx) { box.appendChild(buildAiMessage(m, idx)); });
    if (state.aiBusy) box.appendChild(buildAiTyping());
  }

  if (force || atBottom) scrollToAiBottom();
  else {
    scroll.scrollTop = prevTop;
    onAiScroll();
  }
}

function scrollToAiBottom() {
  var scroll = $('aiChatScroll');
  if (!scroll) return;
  scroll.scrollTop = scroll.scrollHeight;
  state.aiPinned = true;
  var jump = $('aiJump');
  if (jump) jump.hidden = true;
}

function onAiScroll() {
  var scroll = $('aiChatScroll');
  if (!scroll) return;
  var gap = scroll.scrollHeight - scroll.scrollTop - scroll.clientHeight;
  state.aiPinned = gap < 48;
  var jump = $('aiJump');
  if (jump) jump.hidden = gap < 120;
}

/* ================== AI 对话：主流程 ================== */
function showAiNotice(text, isErr) {
  var box = $('aiNotice');
  if (!box) return;
  if (!text) {
    box.hidden = true;
    box.textContent = '';
    box.classList.remove('is-err');
    return;
  }
  box.textContent = text;
  box.hidden = false;
  box.classList.toggle('is-err', !!isErr);
}

function fillAiSubjects() {
  var sel = $('aiSubject');
  if (!sel) return;
  var current = sel.value || state.subject;
  sel.innerHTML = '';
  SUBJECTS.forEach(function (s) {
    var op = document.createElement('option');
    op.value = s.name;
    op.textContent = s.name;
    sel.appendChild(op);
  });
  var all = document.createElement('option');
  all.value = '';
  all.textContent = '不限学科';
  sel.appendChild(all);
  var pick = SUBJECTS.find(function (s) { return s.name === current || s.id === current; });
  sel.value = pick ? pick.name : '';
}

function currentAiMode() {
  return AI_MODES.indexOf(state.aiMode) >= 0 ? state.aiMode : 'knowledge';
}

function setAiMode(mode) {
  var m = AI_MODES.indexOf(mode) >= 0 ? mode : 'knowledge';
  state.aiMode = m;
  document.querySelectorAll('.ai-mode').forEach(function (b) {
    var on = b.dataset.mode === m;
    b.classList.toggle('is-on', on);
    b.setAttribute('aria-selected', String(on));
  });
  var isCustom = m === 'custom';
  if ($('aiScopeRow')) $('aiScopeRow').hidden = isCustom;
  if ($('aiPresets')) $('aiPresets').hidden = isCustom;
  var q = $('aiQuery');
  if (q) {
    q.placeholder = isCustom
      ? '直接提问，例如：用表格对比动量守恒与能量守恒'
      : (m === 'news' ? '补充要求，例如：只要科技类，写成议论文素材' : '输入要讲解的知识点，例如：牛顿第二定律的适用范围');
  }
  if (m === 'news' && $('aiTopic') && !$('aiTopic').value.trim()) {
    $('aiTopic').value = state.aiTopic || '每日热点';
  }
  autoGrowQuery();
  updateAiSendState();
  var notice = $('aiNotice');
  if (notice && !notice.classList.contains('is-err')) showAiNotice(AI_MODE_HINT[m]);
}

function autoGrowQuery() {
  var q = $('aiQuery');
  if (!q) return;
  var cs = window.getComputedStyle(q);
  var lh = parseFloat(cs.lineHeight) || 19.5;
  var pad = (parseFloat(cs.paddingTop) || 0) + (parseFloat(cs.paddingBottom) || 0);
  var max = lh * 6 + pad + 2;
  q.style.height = 'auto';
  var h = Math.min(q.scrollHeight, max);
  q.style.height = Math.max(h, lh + pad + 2) + 'px';
  q.style.overflowY = q.scrollHeight > max ? 'auto' : 'hidden';
}

function canAiSend() {
  if (!state.aiEnabled) return false;
  var text = ($('aiQuery') && $('aiQuery').value.trim()) || '';
  var topic = ($('aiTopic') && $('aiTopic').value.trim()) || '';
  if (currentAiMode() === 'custom') return !!text;
  return !!(text || topic);
}

function updateAiSendState() {
  var btn = $('btnAiSend');
  if (!btn) return;
  if (state.aiBusy) {
    btn.classList.remove('is-ready');
    btn.classList.add('is-stop');
    btn.textContent = state.aiStopping ? '停止中…' : '停止';
    btn.disabled = !!state.aiStopping;
    return;
  }
  btn.classList.remove('is-stop');
  btn.textContent = '发送';
  var ok = canAiSend();
  btn.disabled = !ok;
  btn.classList.toggle('is-ready', ok);
}

function composeRequest() {
  var mode = currentAiMode();
  var subject = ($('aiSubject') && $('aiSubject').value) || '';
  var topic = ($('aiTopic') && $('aiTopic').value.trim()) || '';
  var query = ($('aiQuery') && $('aiQuery').value.trim()) || '';
  return { mode: mode, subject: subject, topic: topic, query: query };
}

function submitCompose() {
  if (state.aiBusy) return;
  var req = cleanRequest(composeRequest());
  if (!req) {
    showAiNotice('请先填写问题或主题。', true);
    return;
  }
  startAiAsk(req, { display: displayTextOf(req), pushUser: true });
}

function applyAiExample(ex) {
  if (state.aiBusy) {
    showAiNotice('正在生成，先点「停止」再试示例。', true);
    return;
  }
  setAiMode(ex.mode);
  var sel = $('aiSubject');
  if (sel) {
    var hit = SUBJECTS.find(function (s) { return s.name === ex.subject; });
    sel.value = hit ? hit.name : '';
  }
  if ($('aiTopic')) $('aiTopic').value = ex.topic || '';
  if ($('aiQuery')) $('aiQuery').value = ex.query || '';
  autoGrowQuery();
  updateAiSendState();
  var req = cleanRequest(ex);
  if (req) startAiAsk(req, { display: displayTextOf(req), pushUser: true });
}

async function runAiAsk(rawReq, opts) {
  opts = opts || {};
  if (!state.aiEnabled) {
    showAiNotice('AI 知识助手还没开启，请先到「设置 · AI 知识助手」里启用。', true);
    return;
  }
  if (state.aiBusy) {
    showAiNotice('正在生成，先点「停止」再发送。', true);
    return;
  }
  var req = cleanRequest(rawReq);
  if (!req) {
    showAiNotice('请先填写问题或主题。', true);
    return;
  }

  var at = Number.isInteger(opts.at) ? Math.max(0, Math.min(opts.at, state.aiHistory.length)) : state.aiHistory.length;
  if (at < state.aiHistory.length) state.aiHistory = state.aiHistory.slice(0, at);

  /* 上下文只取「这一轮之前」的消息：不把当前问题再塞进 history，避免与 query 重复 */
  var baseEnd = at;
  if (opts.pushUser === false) {
    for (var back = at - 1; back >= 0; back--) {
      if (state.aiHistory[back] && state.aiHistory[back].role === 'user') { baseEnd = back; break; }
    }
  }
  var history = aiHistoryPayload(state.aiHistory.slice(0, baseEnd));

  if (opts.pushUser !== false) {
    state.aiHistory.push({ role: 'user', text: String(opts.display || displayTextOf(req)), request: req, time: nowLabel(), ts: Date.now() });
  }
  state.aiEditing = -1;
  state.aiPinned = true;
  trimAiHistory();
  saveAiHistory();

  state.aiBusy = true;
  state.aiStopping = false;
  state.aiPendingModel = mLabelForPending();
  state.aiPendingReasoning = '';
  updateAiSendState();
  renderAiChat({ bottom: true });

  var started = Date.now();
  var res = null;
  var thrown = '';
  try {
    res = await bridge.aiAsk({
      mode: req.mode,
      subject: req.subject,
      topic: req.topic,
      query: req.query || req.topic,
      history: history,
      think: !!state.aiThink,
      web: !!state.aiWeb
    });
  } catch (e) {
    thrown = (e && e.message) || '请求失败';
  }
  var ms = Date.now() - started;

  state.aiBusy = false;
  state.aiStopping = false;
  state.aiPendingModel = '';
  state.aiPendingReasoning = '';

  if (res && res.ok) {
    var reply = {
      role: 'assistant',
      text: String(res.content || ''),
      request: req,
      time: nowLabel(),
      ts: Date.now(),
      model: res.model || '',
      modelName: res.modelName || '',
      providerName: res.providerName || '',
      source: res.source || '',
      audit: res.audit || null,
      switched: !!res.switched,
      attempted: Array.isArray(res.attempted) ? res.attempted : [],
      ms: ms
    };
    var replyReason = cleanReasoning(res.reasoning);
    if (replyReason) reply.reasoning = replyReason;
    var replySearch = cleanSearch(res.search);
    if (replySearch) reply.search = replySearch;
    state.aiHistory.push(reply);
    updateAiModelBadgeFromResult(res);
    trimAiHistory();
    saveAiHistory();
    if (req.mode !== 'news' && $('aiQuery')) {
      $('aiQuery').value = '';
      autoGrowQuery();
    }
    showAiNotice('');
    updateAiSendState();
    renderAiChat();
    return;
  }

  var rawError = String((res && res.error) || thrown || '');
  var cancelled = !!(res && (res.cancelled || /已停止生成/.test(rawError))) || /已停止生成/.test(thrown);
  state.aiHistory.push({
    role: 'assistant',
    text: cancelled ? '已停止生成' : friendlyAiError(rawError),
    request: req,
    time: nowLabel(),
    ts: Date.now(),
    error: !cancelled,
    stopped: cancelled,
    rawError: rawError,
    attempted: Array.isArray(res && res.attempted) ? res.attempted : [],
    ms: ms
  });
  trimAiHistory();
  saveAiHistory();
  updateAiSendState();
  renderAiChat();
  if (!cancelled) showAiNotice('这次没有生成成功，可以点「重试」再发一次。', true);
}

/* 所有发起请求的入口都走这里：把 promise 记到 state.aiRun，
   切换 / 删除 / 新建会话时可以等它收尾，避免旧回答写进新会话。 */
function startAiAsk(rawReq, opts) {
  var p = runAiAsk(rawReq, opts);
  state.aiRun = p;
  var done = function () {
    if (state.aiRun === p) state.aiRun = null;
  };
  p.then(done, done);
  return p;
}

/* 长 id 只留最后一段：nvidia/nemotron-3.5-lightning:free -> nemotron-3.5-lightning */
function aiModelShort(id) {
  var full = String(id || '');
  if (!full) return '';
  if (/^kilo-auto\b/.test(full)) return full;
  var seg = full.replace(/:free$/, '').split('/');
  return seg[seg.length - 1] || full;
}

function mLabelForPending() {
  var cfg = state.aiConfig || {};
  return aiModelShort(cfg.modelUsed || cfg.model) || '模型';
}

function regenerateAt(idx) {
  if (state.aiBusy) {
    showAiNotice('正在生成，先点「停止」再重新生成。', true);
    return;
  }
  var m = state.aiHistory[idx];
  if (!m || m.role !== 'assistant') return;
  var req = requestOfMessage(m, idx);
  if (!req) {
    showAiNotice('这条回答没有留下原始请求，不能重新生成。', true);
    return;
  }
  startAiAsk(req, { at: idx, pushUser: false });
}

function beginEditUser(idx) {
  if (state.aiBusy) {
    showAiNotice('正在生成，先点「停止」再编辑。', true);
    return;
  }
  var m = state.aiHistory[idx];
  if (!m || m.role !== 'user') return;
  state.aiEditing = idx;
  renderAiChat();
  var area = $('aiEditArea');
  if (area) {
    area.focus();
    try { area.setSelectionRange(area.value.length, area.value.length); } catch (e) { /* 忽略 */ }
  }
}

/* 编辑重发：用新文本构造新请求，替换该条及其后所有消息 */
function saveAiEdit(idx, text) {
  var value = String(text || '').trim();
  if (!value) {
    showAiNotice('内容为空，没有发送。', true);
    return;
  }
  var m = state.aiHistory[idx];
  var base = requestOfMessage(m, idx) || { mode: currentAiMode(), subject: '', topic: '', query: '' };
  var req = {
    mode: base.mode || 'custom',
    subject: base.subject || '',
    topic: '',
    query: ''
  };
  if (req.mode === 'news') req.topic = value;
  else req.query = value;
  state.aiEditing = -1;
  startAiAsk(req, { at: idx, pushUser: true, display: displayTextOf(req) });
}

async function cancelAiAsk() {
  if (!state.aiBusy || state.aiStopping) return;
  state.aiStopping = true;
  updateAiSendState();
  try {
    if (bridge.aiCancel) await bridge.aiCancel();
  } catch (e) { /* 忽略 */ }
}

/* ================== AI 对话：模型徽标与选择 ================== */
function aiModelList() {
  var cfg = state.aiConfig || {};
  var list = [];
  (cfg.models || []).forEach(function (m) {
    if (!m || !m.id) return;
    list.push({ id: String(m.id), name: String(m.name || m.id), ctx: Number(m.ctx) || 0 });
  });
  (cfg.customModels || []).forEach(function (id) {
    if (!id) return;
    if (list.some(function (x) { return x.id === id; })) return;
    list.push({ id: String(id), name: String(id), ctx: 0 });
  });
  return list;
}

function currentAiModelId() {
  var cfg = state.aiConfig || {};
  // 徽标默认显示当前配置的模型；自动换模型的实际情况由 updateAiModelBadgeFromResult 覆盖
  return String(cfg.model || '');
}

function updateAiModelBadge(text, extra) {
  var el = $('aiModelName');
  if (!el) return;
  var opts = extra || {};
  var id = text || currentAiModelId();
  var title = opts.title || id || '未选择模型';
  el.textContent = aiModelShort(id) || '未选择模型';
  el.title = title;
  var btn = $('btnAiModel');
  if (btn) btn.title = title;
  var tag = $('aiModelTag');
  if (tag) tag.hidden = !opts.switched;
}

/* 会话清空 / 重新打开面板：徽标回到 aiConfig().model */
function resetAiModelBadge() {
  updateAiModelBadge('');
}

/* 成功后按本次实际使用的模型刷新：短名 + 完整 id 与供应商写进 title */
function updateAiModelBadgeFromResult(res) {
  if (!res) return;
  var id = String(res.model || '') || currentAiModelId();
  var provider = String(res.providerName || res.provider || '');
  var title = id ? ('本次使用：' + id + (provider ? ' · ' + provider : '')) : '未选择模型';
  updateAiModelBadge(id, { title: title, switched: !!res.switched });
}

/* ---------- 思考 / 联网开关（与 aiConfig().think / .web 同步） ---------- */
function syncAiToggleButtons() {
  var think = $('btnAiThink');
  if (think) {
    think.setAttribute('aria-pressed', String(!!state.aiThink));
    think.classList.toggle('is-on', !!state.aiThink);
  }
  var web = $('btnAiWeb');
  if (web) {
    web.setAttribute('aria-pressed', String(!!state.aiWeb));
    web.classList.toggle('is-on', !!state.aiWeb);
  }
}

/* 先乐观更新，接口失败就回滚，避免开关和持久化值打架 */
async function setAiToggle(kind, next) {
  var isThink = kind === 'think';
  var key = isThink ? 'aiThink' : 'aiWeb';
  var field = isThink ? 'think' : 'web';
  var btn = isThink ? $('btnAiThink') : $('btnAiWeb');
  var before = !!state[key];
  if (before === !!next) return;
  state[key] = !!next;
  if (state.aiConfig) state.aiConfig[field] = !!next;
  syncAiToggleButtons();
  if (btn) btn.disabled = true;

  var patch = {};
  patch[field] = !!next;
  var res = null;
  try { res = await bridge.aiSaveConfig(patch); } catch (e) { res = { ok: false, error: (e && e.message) || '' }; }

  if (btn) btn.disabled = false;
  if (res && res.ok === false) {
    state[key] = before;
    if (state.aiConfig) state.aiConfig[field] = before;
    syncAiToggleButtons();
    showAiNotice((isThink ? '思考' : '联网') + '开关保存失败：' + (res.error || '请稍后再试'), true);
    return;
  }
  var notice = $('aiNotice');
  if (notice && notice.classList.contains('is-err')) showAiNotice(AI_MODE_HINT[currentAiMode()]);
}

function fmtCtx(ctx) {
  var n = Number(ctx) || 0;
  if (!n) return '';
  if (n < 1000) return n + ' token';
  return Math.round(n / 1000) + ' 千 token';
}

function renderAiModelMenu() {
  var box = $('aiModels');
  if (!box) return;
  box.innerHTML = '';
  var list = aiModelList();
  var head = document.createElement('div');
  head.className = 'ai-models__head';
  head.textContent = list.length
    ? '可用模型 · 当前 ' + (aiModelShort(currentAiModelId()) || '未选择')
    : '当前供应商没有返回模型清单，可在设置里直接填写模型名。';
  box.appendChild(head);
  list.forEach(function (m) {
    var item = document.createElement('button');
    item.type = 'button';
    item.className = 'ai-models__item';
    item.setAttribute('role', 'option');
    item.dataset.model = m.id;
    var on = m.id === String((state.aiConfig || {}).model || '') || m.id === currentAiModelId();
    item.classList.toggle('is-on', on);
    item.setAttribute('aria-selected', String(on));
    var name = document.createElement('span');
    name.className = 'ai-models__name';
    name.textContent = m.name;
    var ctx = document.createElement('span');
    ctx.className = 'ai-models__ctx';
    ctx.textContent = fmtCtx(m.ctx);
    item.appendChild(name);
    item.appendChild(ctx);
    item.title = m.id;
    item.addEventListener('click', function () { chooseAiModel(m); });
    box.appendChild(item);
  });
}

function setAiModelMenu(open) {
  var box = $('aiModels');
  var btn = $('btnAiModel');
  if (!box || !btn) return;
  state.aiModelsOpen = !!open;
  if (open) renderAiModelMenu();
  box.hidden = !open;
  btn.setAttribute('aria-expanded', String(!!open));
}

async function chooseAiModel(m) {
  setAiModelMenu(false);
  if (!m || !m.id) return;
  var cfg = state.aiConfig;
  var old = cfg ? cfg.model : '';
  if (cfg) {
    cfg.model = m.id;
    cfg.modelUsed = '';
  }
  updateAiModelBadge(m.id);
  var res = null;
  try {
    res = await bridge.aiSaveConfig({ model: m.id });
  } catch (e) {
    res = { ok: false, error: (e && e.message) || '' };
  }
  if (res && res.ok === false) {
    if (cfg) cfg.model = old;
    updateAiModelBadge();
    showAiNotice('切换模型失败：' + (res.error || '请稍后再试'), true);
  } else {
    showAiNotice('已切换到 ' + m.name + '。');
  }
}

async function loadAiConfig() {
  var cfg = null;
  try { cfg = await bridge.aiConfig(); } catch (e) { cfg = null; }
  if (!cfg || cfg.ok === false) {
    state.aiConfig = null;
    state.aiEnabled = false;
    updateAiModelBadge('读取失败');
    showAiNotice('读取 AI 配置失败，请重开这个窗口再试。', true);
    updateAiSendState();
    return;
  }
  state.aiConfig = cfg;
  state.aiEnabled = cfg.enabled !== false;
  if (cfg.topic) state.aiTopic = cfg.topic;
  state.aiThink = cfg.think === true;
  state.aiWeb = cfg.web === true;
  syncAiToggleButtons();
  updateAiModelBadge();
  if (!state.aiEnabled) {
    showAiNotice('AI 知识助手还没开启，请先到「设置 · AI 知识助手」里启用。', true);
  } else if (cfg.ready === false) {
    showAiNotice('AI 还没配置好：' + (cfg.readyError || '请到设置里检查模型与接口地址。'), true);
  } else {
    showAiNotice(AI_MODE_HINT[currentAiMode()]);
  }
  if (state.aiModelsOpen) renderAiModelMenu();
  updateAiSendState();
}

/* ================== AI 对话：打开 / 关闭 / 绑定 ================== */
function openAiModal() {
  var modal = $('aiModal');
  if (!modal) return;
  fillAiSubjects();
  resetAiModelBadge();
  /* 每次打开都回到干净状态：不残留上一次的编辑框、待发模型与确认态 */
  state.aiEditing = -1;
  state.aiPendingModel = '';
  state.aiPendingReasoning = '';
  state.aiSessionEditing = '';
  state.aiSessionConfirm = '';
  clearTimeout(state.aiSessionTimer);
  setAiModelMenu(false);
  setAiSessionsOpen(false);
  resetAiClearArmed();
  ensureAiStore();
  if (!state.aiBusy) state.aiHistory = loadAiHistory();
  var back = modal.querySelector('.modal__backdrop');
  if (back) {
    back.hidden = false;
    back.style.pointerEvents = '';
  }
  modal.hidden = false;
  document.body.classList.add('ai-open');
  setAiMode(currentAiMode());
  renderAiSessions();
  renderAiChat({ bottom: true });
  updateAiSendState();
  autoGrowQuery();
  setTimeout(function () {
    var q = $('aiQuery');
    if (q && !state.aiHistory.length) q.focus();
    autoGrowQuery();
  }, 80);
  loadAiConfig();
}

function closeAiModal() {
  var modal = $('aiModal');
  if (modal) {
    modal.hidden = true;
    var boxEl = modal.querySelector('.ai-box');
    if (boxEl) boxEl.classList.remove('is-sessions-open');
    /* 残留的遮罩层会继续吃掉页面点击，关闭时一并停用 */
    var back = modal.querySelector('.modal__backdrop');
    if (back) {
      back.hidden = true;
      back.style.pointerEvents = 'none';
    }
  }
  state.aiSessionsOpen = false;
  document.body.classList.remove('ai-open');
  setAiModelMenu(false);
  setAiSessionsOpen(false);
  state.aiEditing = -1;
  state.aiPendingModel = '';
  state.aiPendingReasoning = '';
  state.aiSessionEditing = '';
  state.aiSessionConfirm = '';
  clearTimeout(state.aiSessionTimer);
  resetAiModelBadge();
  resetAiClearArmed();
  if (state.aiBusy) cancelAiAsk();
}

function friendlyAiError(raw) {
  var msg = String(raw || '');
  if (/HTTP 429|1305|访问量过大|rate.?limit/i.test(msg)) {
    return '免费模型这会儿排队的人太多（限流）。等 1–2 分钟再点一次，或换个时段试试。';
  }
  if (/HTTP 401|令牌|验证不正确|invalid.*key/i.test(msg)) {
    return 'API 密钥无效或已过期，请到设置 → AI 知识助手里重新填写。';
  }
  if (/HTTP 403|无权限|forbidden/i.test(msg)) {
    return '这个密钥没有调用该模型的权限，请检查模型名或账户额度。';
  }
  if (/超时|aborted|timeout/i.test(msg)) {
    return '模型响应超时了。免费模型在晚上会比较慢，稍后再试一次。';
  }
  if (/还没有 API Key|先.*密钥/i.test(msg)) {
    return '还没填写 API 密钥，请先到设置 → AI 知识助手里添加。';
  }
  if (/还没开启|先.*开启/i.test(msg)) {
    return 'AI 知识助手还没启用，请到设置 → AI 知识助手里打开。';
  }
  if (/域名解析|网络|ENOTFOUND|ECONN/i.test(msg)) {
    return '网络连接有问题，请检查网络后重试。';
  }
  return msg || '生成失败，请稍后再试。';
}

function bindAi() {
  /* AI 检索入口已移到主界面 AI 助手，知识签不再提供入口 */
  var btn = $('kAi');
  if (btn) btn.addEventListener('click', openAiModal);
  var modal = $('aiModal');
  if (!modal) return;

  /* × 双保险：pointerdown 与 click 都接，避免被拖动区 / 事件吞掉 */
  var closeBtn = $('btnAiClose');
  if (closeBtn) {
    var shutAi = function (e) {
      if (e) {
        e.preventDefault();
        e.stopPropagation();
      }
      closeAiModal();
    };
    closeBtn.addEventListener('pointerdown', shutAi);
    closeBtn.addEventListener('click', shutAi);
  }
  var back = modal.querySelector('[data-ai-close]');
  if (back) {
    back.addEventListener('pointerdown', function (e) {
      e.preventDefault();
      closeAiModal();
    });
    back.addEventListener('click', function (e) {
      e.preventDefault();
      closeAiModal();
    });
  }

  /* 会话列表：新建 / 切换 / 重命名 / 删除 */
  if ($('btnAiSessions')) {
    $('btnAiSessions').addEventListener('click', function (e) {
      e.stopPropagation();
      setAiSessionsOpen(!state.aiSessionsOpen);
    });
  }
  if ($('btnAiNewChat')) {
    $('btnAiNewChat').addEventListener('click', function (e) {
      e.stopPropagation();
      newAiSession();
    });
  }

  var sessionList = $('aiSessionList');
  if (sessionList) {
    sessionList.addEventListener('click', function (e) {
      var act = e.target.closest('[data-act]');
      var row = e.target.closest('.ai-session');
      var id = (act && act.dataset.sid) || (row && row.dataset.sid) || '';
      if (act) {
        e.preventDefault();
        e.stopPropagation();
        var kind = act.dataset.act;
        if (kind === 'rename') beginRenameAiSession(id);
        else if (kind === 'del') armDeleteAiSession(id);
        else if (kind === 'del-no') cancelDeleteAiSession();
        else if (kind === 'del-yes') confirmDeleteAiSession(id);
        return;
      }
      if (row && id && !e.target.closest('.ai-session__rename')) {
        Promise.resolve(switchAiSession(id)).catch(function () { /* 忽略 */ });
      }
    });
    sessionList.addEventListener('contextmenu', function (e) {
      var row = e.target.closest('.ai-session');
      if (!row) return;
      e.preventDefault();
      sessionList.querySelectorAll('.ai-session').forEach(function (x) {
        if (x !== row) x.classList.remove('is-menu');
      });
      row.classList.add('is-menu');
    });
    sessionList.addEventListener('keydown', function (e) {
      if (e.target && e.target.id === 'aiSessionRename') {
        if (e.key === 'Enter') {
          e.preventDefault();
          commitAiSessionRename();
        } else if (e.key === 'Escape') {
          e.preventDefault();
          e.stopPropagation();
          state.aiSessionEditing = '';
          renderAiSessions();
        }
        return;
      }
      if (e.key !== 'Enter' && e.key !== ' ') return;
      var row = e.target.closest('.ai-session');
      if (!row || !row.dataset.sid) return;
      e.preventDefault();
      Promise.resolve(switchAiSession(row.dataset.sid)).catch(function () { /* 忽略 */ });
    });
    sessionList.addEventListener('focusout', function (e) {
      var t = e.target;
      if (!t || t.id !== 'aiSessionRename' || !state.aiSessionEditing) return;
      setTimeout(function () {
        if ($('aiSessionRename') === t && state.aiSessionEditing) commitAiSessionRename();
      }, 0);
    });
  }

  document.querySelectorAll('.ai-mode').forEach(function (b) {
    b.addEventListener('click', function () { setAiMode(b.dataset.mode); });
  });

  var send = $('btnAiSend');
  if (send) {
    send.addEventListener('click', function () {
      if (state.aiBusy) cancelAiAsk();
      else submitCompose();
    });
  }

  var q = $('aiQuery');
  if (q) {
    q.addEventListener('input', function () {
      autoGrowQuery();
      updateAiSendState();
    });
    q.addEventListener('keydown', function (e) {
      if (e.key !== 'Enter' || e.shiftKey || e.isComposing || e.keyCode === 229) return;
      e.preventDefault();
      if (!state.aiBusy) submitCompose();
    });
  }

  if ($('aiTopic')) $('aiTopic').addEventListener('input', updateAiSendState);
  if ($('aiSubject')) $('aiSubject').addEventListener('change', updateAiSendState);
  if ($('aiJump')) $('aiJump').addEventListener('click', function () { scrollToAiBottom(); });
  if ($('aiChatScroll')) $('aiChatScroll').addEventListener('scroll', onAiScroll);

  document.querySelectorAll('.ai-preset').forEach(function (b) {
    b.addEventListener('click', function () {
      var t = b.dataset.topic || '';
      if ($('aiTopic')) $('aiTopic').value = t;
      document.querySelectorAll('.ai-preset').forEach(function (x) { x.classList.toggle('is-on', x === b); });
      updateAiSendState();
    });
  });

  if ($('btnAiThink')) {
    $('btnAiThink').addEventListener('click', function () { setAiToggle('think', !state.aiThink); });
  }
  if ($('btnAiWeb')) {
    $('btnAiWeb').addEventListener('click', function () { setAiToggle('web', !state.aiWeb); });
  }

  /* 主进程若提供流式进度，先把思考过程接住，气泡里就能显示「正在思考…」 */
  if (typeof bridge.onAiProgress === 'function') {
    bridge.onAiProgress(function (data) {
      if (!data || !state.aiBusy) return;
      var text = cleanReasoning(data.reasoning);
      if (!text) return;
      state.aiPendingReasoning = text;
      renderAiChat();
    });
  }

  if ($('btnAiModel')) {
    $('btnAiModel').addEventListener('click', function (e) {
      e.stopPropagation();
      setAiModelMenu(!state.aiModelsOpen);
    });
  }

  if ($('btnAiClearChat')) {
    $('btnAiClearChat').addEventListener('click', function () {
      var clearBtn = $('btnAiClearChat');
      if (state.aiBusy) {
        showAiNotice('正在生成，先点「停止」再清空对话。', true);
        return;
      }
      if (!state.aiHistory.length) return;
      if (!state.aiClearArmed) {
        state.aiClearArmed = true;
        clearBtn.textContent = '确认清空？';
        clearBtn.classList.add('is-confirm');
        clearTimeout(state.aiClearTimer);
        state.aiClearTimer = setTimeout(function () {
          state.aiClearArmed = false;
          clearBtn.textContent = '清空对话';
          clearBtn.classList.remove('is-confirm');
        }, 3000);
        return;
      }
      clearTimeout(state.aiClearTimer);
      state.aiClearArmed = false;
      clearBtn.textContent = '清空对话';
      clearBtn.classList.remove('is-confirm');
      state.aiHistory = [];
      state.aiEditing = -1;
      resetAiModelBadge();
      saveAiHistory();
      showAiNotice('已清空对话。');
      renderAiChat({ bottom: true });
      updateAiSendState();
    });
  }

  /* 代码块复制按钮：内容随 innerHTML 重建，用事件代理 */
  var chat = $('aiChat');
  if (chat) {
    chat.addEventListener('click', function (e) {
      var link = e.target.closest('.ai-src__item, .ai-md a[href]');
      if (link) {
        e.preventDefault();
        openAiExternal(link.getAttribute('href'));
        return;
      }
      var copy = e.target.closest('[data-ai-copy]');
      if (!copy) return;
      var codeBox = copy.closest('.ai-code');
      var code = codeBox ? codeBox.querySelector('code') : null;
      if (code) copyAiText(code.textContent, copy, '复制代码');
    });
  }

  modal.addEventListener('click', function (e) {
    if (state.aiModelsOpen && !e.target.closest('.ai-model-wrap')) setAiModelMenu(false);
    if (!e.target.closest('.ai-session__acts')) {
      modal.querySelectorAll('.ai-session.is-menu').forEach(function (x) { x.classList.remove('is-menu'); });
    }
  });

  modal.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') {
      e.stopPropagation();
      if (state.aiSessionsOpen) setAiSessionsOpen(false);
      else if (state.aiModelsOpen) setAiModelMenu(false);
      else closeAiModal();
      return;
    }
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && e.target && e.target.id === 'aiQuery') {
      e.preventDefault();
      if (!state.aiBusy) submitCompose();
    }
  });

  syncAiToggleButtons();
}

init();
