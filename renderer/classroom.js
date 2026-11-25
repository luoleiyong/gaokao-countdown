'use strict';
/* 课堂助手 · 随机点名 / 名单管理 / 管理员模式 / 课程表 */

const $ = (id) => document.getElementById(id);
const DAYS = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];
const SKINS = ['board', 'starry', 'warm', 'bamboo'];
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const bridge = window.gaokao || createMockBridge();

const state = {
  data: null,
  adminData: null,
  adminRosterId: '',
  rosterDraft: { name: '', step: 'name' },
  trashPicked: [],
  drawing: false,
  ttRows: null,
  ttFile: null,
  debugMode: false,
  voice: false,
  mute: false,
  noRepeat: false,
  drawCount: 1,
  classFull: false,
  groupMode: 'count',
  groupValue: 4,
  timer: { mode: 'countdown', total: 300, left: 300, elapsed: 0, running: false, tick: null, endAt: 0, startAt: 0, full: false, autoFullTimer: null }
};

function esc(v) {
  return String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

/* ---------------- Toast ---------------- */
let toastTimer = null;
function toast(msg) {
  const el = $('clsToast');
  if (!el) return;
  el.textContent = msg;
  el.hidden = false;
  requestAnimationFrame(() => el.classList.add('show'));
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    el.classList.remove('show');
    setTimeout(() => { el.hidden = true; }, 260);
  }, 2600);
}

/* ---------------- 语音朗读 ---------------- */
function speakName(name) {
  if (state.mute || !state.voice || !name || !window.speechSynthesis) return;
  try {
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(String(name));
    u.lang = 'zh-CN';
    u.rate = 0.92;
    u.pitch = 1;
    u.volume = 1;
    const voices = window.speechSynthesis.getVoices();
    const zh = voices.find((v) => /zh[-_]CN/i.test(v.lang)) || voices.find((v) => /^zh/i.test(v.lang));
    if (zh) u.voice = zh;
    window.speechSynthesis.speak(u);
  } catch (e) { /* 忽略语音失败 */ }
}

/* ---------------- 启动 ---------------- */
async function boot() {
  const params = new URLSearchParams(location.search);
  const skin = params.get('skin');
  if (SKINS.includes(skin)) document.body.setAttribute('data-skin', skin);
  try {
    state.drawCount = Math.max(1, Math.min(20, parseInt(localStorage.getItem('cls-draw-count'), 10) || 1));
  } catch (e) { state.drawCount = 1; }
  try {
    state.noRepeat = localStorage.getItem('cls-no-repeat') === '1';
  } catch (e) { state.noRepeat = false; }
  bindStaticEvents();
  await reload();
  if (params.get('admin') === '1') {
    setTimeout(() => openAdmin(), 320);
  }
}

async function reload() {
  try {
    state.data = await bridge.classroomGet();
  } catch (e) {
    state.data = { rosters: [], activeRosterId: '', timetable: null };
  }
  renderAll();
}

function activeRoster() {
  const d = state.data;
  if (!d || !Array.isArray(d.rosters)) return null;
  return d.rosters.find((r) => r.id === d.activeRosterId) || null;
}

function renderAll() {
  renderRosterList();
  resetStage();
}

/* ---------------- 名单 ---------------- */
function renderRosterList() {
  const box = $('rosterList');
  const empty = $('rosterEmpty');
  const rosters = (state.data && state.data.rosters) || [];
  const delBtn = $('btnDeleteRoster');
  if (delBtn) delBtn.disabled = rosters.length === 0;
  box.innerHTML = '';
  if (!rosters.length) {
    box.hidden = true;
    empty.hidden = false;
    return;
  }
  box.hidden = false;
  empty.hidden = true;
  rosters.forEach((r) => {
    const btn = document.createElement('button');
    btn.className = 'roster-item' + (r.id === state.data.activeRosterId ? ' on' : '');
    btn.innerHTML = `<b>${esc(r.name)}</b><span>${r.names.length} 人</span>`;
    btn.title = '名单内容已锁定，需在管理员模式中修改';
    btn.addEventListener('click', () => selectRoster(r.id));
    box.appendChild(btn);
  });
}

async function selectRoster(id) {
  if (state.drawing) return;
  await bridge.classroomSetActive(id);
  state.data.activeRosterId = id;
  renderRosterList();
  resetStage();
}

function maxDrawCount() {
  const roster = activeRoster();
  return Math.max(1, Math.min(20, roster ? roster.names.length : 1));
}

function renderDrawCount() {
  const max = maxDrawCount();
  state.drawCount = Math.min(Math.max(1, state.drawCount), max);
  $('rollCount').textContent = String(state.drawCount);
  $('btnCountMinus').disabled = state.drawCount <= 1;
  $('btnCountPlus').disabled = state.drawCount >= max;
}

function resetStage() {
  const roster = activeRoster();
  const nameEl = $('rollName');
  nameEl.classList.remove('rolling', 'landed', 'multiple');
  if (!roster) {
    nameEl.innerHTML = '<span>课堂</span><span>点名</span>';
    $('rollRoster').textContent = '未选择名单';
    $('rollSub').textContent = '选择左侧名单，然后开始点名';
    $('btnRoll').querySelector('span').textContent = '开 始 点 名';
    state.drawCount = 1;
    renderDrawCount();
    return;
  }
  nameEl.innerHTML = '<span>课堂</span><span>点名</span>';
  $('rollRoster').textContent = roster.name;
  $('rollSub').textContent = roster.names.length
    ? '准备好了，点击开始点名'
    : '名单为空，请导入名单或让管理员添加学生';
  $('btnRoll').querySelector('span').textContent = '开 始 点 名';
  renderDrawCount();
}

/* ---------------- 点名 ---------------- */
async function rollOnce() {
  const roster = activeRoster();
  if (!roster) return toast('请先在左侧选择或导入名单');
  if (!roster.names.length) return toast('名单为空，请先导入名单');
  if (state.drawing) return;

  state.drawing = true;
  const btn = $('btnRoll');
  const nameEl = $('rollName');
  btn.disabled = true;
  btn.querySelector('span').textContent = '点 名 中…';
  nameEl.classList.remove('landed', 'multiple');
  nameEl.classList.add('rolling');
  $('rollSub').textContent = '讲台下的目光都在这里…';
  if (window.GkSound) {
    try {
      GkSound.unlock();
      GkSound.playShake();
    } catch (e) { /* 忽略音效失败 */ }
  }

  let res;
  try {
    res = await bridge.classroomDraw(roster.id, state.drawCount, { noRepeat: state.noRepeat });
  } catch (e) {
    res = { ok: false, error: e.message };
  }
  if (!res || !res.ok) {
    state.drawing = false;
    btn.disabled = false;
    btn.querySelector('span').textContent = '开 始 点 名';
    nameEl.classList.remove('rolling');
    toast((res && res.error) || '点名失败，请重试');
    return;
  }

  const names = roster.names.map((n) => n.name);
  for (let i = 0; i < 18; i++) {
    nameEl.textContent = names[Math.floor(Math.random() * names.length)] || '—';
    await wait(46 + i * 5);
  }
  const results = Array.isArray(res.names) && res.names.length ? res.names : [res.name];
  if (results.length > 1) {
    nameEl.classList.add('multiple');
    nameEl.innerHTML = results.map((n) => `<span>${esc(n)}</span>`).join('');
  } else {
    nameEl.textContent = results[0];
  }
  nameEl.classList.remove('rolling');
  nameEl.classList.add('landed');
  let subText = roster.name;
  if (state.noRepeat) {
    if (res.wrapped) subText = `${roster.name} · 本轮已抽完，已开启新一轮`;
    else if (typeof res.roundLeft === 'number' && res.roundLeft === 0) subText = `${roster.name} · 本轮已全部抽完`;
    else if (typeof res.roundLeft === 'number') subText = `${roster.name} · 本轮还剩 ${res.roundLeft} 人`;
  }
  $('rollSub').textContent = subText;
  if (res.wrapped) toast('本轮已抽完，已自动开启新一轮');
  if (window.GkSound) {
    try { GkSound.playDrawDone(); } catch (e) { /* 忽略音效失败 */ }
  }
  speakName(results.join('、'));
  btn.disabled = false;
  btn.querySelector('span').textContent = '再 点 一 次';
  state.drawing = false;
}

/* ---------------- 名单导入 ---------------- */
async function importPaths(paths) {
  const list = (paths || []).filter(Boolean);
  if (!list.length) return;
  let res;
  try {
    res = await bridge.classroomImportRosters(list);
  } catch (e) {
    return toast('导入失败：' + e.message);
  }
  if (!res || !res.ok) {
    toast((res && res.errors && res.errors[0]) || '没有识别到姓名');
    return;
  }
  state.data = res.data;
  renderRosterList();
  resetStage();
  const summary = res.created.map((c) => `${c.name}（${c.count}人）`).join('、');
  toast('已导入 ' + summary + (res.errors.length ? `；${res.errors.length} 个文件失败` : ''));
  if (!$('adminModal').hidden) await refreshAdmin();
}

function filesToPaths(files) {
  return Array.from(files || []).map((f) => bridge.getFilePath(f)).filter(Boolean);
}

/* ---------------- 新建名单：命名 → 添加学生 ---------------- */
const NAME_HEADER_RE = /^(姓名|名字|学生姓名|学生|name|序号|编号|学号|班级|性别)$/i;

/* 行首序号（"3. 张三" / "3 张三"）只在后面还有内容时去掉，纯编号行原样保留 */
function stripDraftIndex(line) {
  const s = String(line == null ? '' : line).trim();
  if (!s) return '';
  const byPunct = s.replace(/^(\d{1,3})\s*[.、)．:：]\s*(?=\S)/, '').trim();
  if (byPunct !== s) return byPunct;
  const bySpace = s.replace(/^(\d{1,3})\s+(?=\S)/, '').trim();
  if (bySpace !== s) return bySpace;
  return s;
}

function parseDraftNames(text) {
  const raw = String(text || '').replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
  const out = [];
  raw.split('\n').forEach((line) => {
    stripDraftIndex(line).split(/[\s,，;；、\t]+/).forEach((token) => {
      let t = String(token == null ? '' : token).trim();
      t = t.replace(/^["'\s]+|["'\s]+$/g, '');
      if (!t || t.length > 30) return;
      if (NAME_HEADER_RE.test(t)) return;
      out.push(t);
    });
  });
  return Array.from(new Set(out));
}

function openRosterDialog() {
  state.rosterDraft = { name: '', step: 'name' };
  $('rosterNameInput').value = '';
  $('rosterNamesInput').value = '';
  const fillInput = $('rosterFillCount');
  if (fillInput) fillInput.value = '10';
  resetFillButton();
  $('rosterNameError').textContent = '';
  $('rosterNamesError').textContent = '';
  $('rosterModal').hidden = false;
  setRosterStep('name');
  setTimeout(() => { const el = $('rosterNameInput'); if (el) el.focus(); }, 60);
}

function closeRosterDialog() {
  $('rosterModal').hidden = true;
}

function setRosterStep(step) {
  state.rosterDraft.step = step;
  const naming = step === 'name';
  $('rosterStepName').hidden = !naming;
  $('rosterStepNames').hidden = naming;
  $('rosterTitle').textContent = naming ? '新建名单' : '添加学生';
  $('rosterDraftName').textContent = state.rosterDraft.name || '';
  if (!naming) {
    updateRosterDraftCount();
    setTimeout(() => { const el = $('rosterNamesInput'); if (el) el.focus(); }, 60);
  }
}

function submitRosterName() {
  const err = $('rosterNameError');
  const name = $('rosterNameInput').value.trim().slice(0, 40);
  if (!name) {
    err.textContent = '请先输入名单名称';
    $('rosterNameInput').focus();
    return;
  }
  const rosters = (state.data && state.data.rosters) || [];
  if (rosters.some((r) => r.name === name)) {
    err.textContent = '已有同名名单，请换一个名称';
    $('rosterNameInput').select();
    return;
  }
  err.textContent = '';
  state.rosterDraft.name = name;
  setRosterStep('names');
}

function updateRosterDraftCount() {
  const names = parseDraftNames($('rosterNamesInput').value);
  $('rosterNameCount').textContent = names.length
    ? `已识别 ${names.length} 人${names.length > 200 ? '（人数较多）' : ''}`
    : '还没有输入姓名';
  $('btnRosterSave').disabled = names.length === 0;
  return names;
}

async function saveRosterDraft() {
  const err = $('rosterNamesError');
  const names = parseDraftNames($('rosterNamesInput').value);
  if (!names.length) {
    err.textContent = '请至少输入一个学生姓名';
    $('rosterNamesInput').focus();
    return;
  }
  const btn = $('btnRosterSave');
  const label = btn.textContent;
  btn.disabled = true;
  btn.textContent = '保存中…';
  let res = null;
  try {
    res = await bridge.classroomCreateRoster(state.rosterDraft.name, names.join('\n'));
  } catch (e) {
    res = null;
  }
  btn.textContent = label;
  btn.disabled = false;
  if (!res || !res.ok) {
    err.textContent = (res && res.error) || '保存失败，请重试';
    return;
  }
  state.data = res.data;
  state.data.activeRosterId = res.rosterId;
  try { await bridge.classroomSetActive(res.rosterId); } catch (e) { /* 已由主进程设为当前名单 */ }
  renderRosterList();
  resetStage();
  const total = typeof res.count === 'number' ? res.count : names.length;
  closeRosterDialog();
  toast(`已创建「${state.rosterDraft.name}」，共 ${total} 人`);
}

/* ---------------- 数字快捷填充 ---------------- */
const FILL_MAX = 500;
let fillConfirmUntil = 0;

function resetFillButton() {
  const btn = $('btnRosterFill');
  if (!btn) return;
  fillConfirmUntil = 0;
  btn.textContent = '生成编号';
}

function applyRosterFill() {
  const btn = $('btnRosterFill');
  const input = $('rosterFillCount');
  const area = $('rosterNamesInput');
  if (!btn || !input || !area) return;
  const n = Math.max(1, Math.min(FILL_MAX, Math.floor(Number(input.value) || 0)));
  input.value = String(n);
  if (area.value.trim() && Date.now() > fillConfirmUntil) {
    fillConfirmUntil = Date.now() + 4000;
    btn.textContent = '再点一次替换';
    toast('输入框里已有内容，再点一次会替换成编号');
    return;
  }
  fillConfirmUntil = 0;
  btn.textContent = '生成编号';
  const lines = [];
  for (let i = 1; i <= n; i++) lines.push(String(i));
  area.value = lines.join('\n');
  area.dispatchEvent(new Event('input', { bubbles: true }));
  area.focus();
  area.scrollTop = area.scrollHeight;
  toast(`已填充 1 到 ${n}`);
}

/* ---------------- 删除名单 / 最近删除 ---------------- */
function openDeleteRosterDialog() {
  state.trashPicked = [];
  $('rosterDeleteModal').hidden = false;
  renderTrashDialog();
}

function closeDeleteRosterDialog() {
  $('rosterDeleteModal').hidden = true;
}

function updateTrashConfirm() {
  const btn = $('btnTrashConfirm');
  if (!btn) return;
  const n = state.trashPicked.length;
  btn.disabled = n === 0;
  btn.textContent = n ? `删除所选（${n}）` : '删除所选';
}

function renderTrashDialog() {
  const d = state.data || {};
  const rosters = d.rosters || [];
  const trash = d.trash || [];
  const picked = new Set(state.trashPicked);
  const pick = $('trashPickList');
  pick.innerHTML = '';
  rosters.forEach((r) => {
    const row = document.createElement('label');
    row.className = 'trash-row';
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = picked.has(r.id);
    cb.addEventListener('change', () => {
      const set = new Set(state.trashPicked);
      if (cb.checked) set.add(r.id);
      else set.delete(r.id);
      state.trashPicked = Array.from(set);
      updateTrashConfirm();
    });
    const name = document.createElement('span');
    name.className = 'trash-row__name';
    name.textContent = r.name;
    const count = document.createElement('span');
    count.className = 'trash-row__count';
    count.textContent = `${r.names.length} 人`;
    row.append(cb, name, count);
    pick.appendChild(row);
  });
  $('trashPickEmpty').hidden = rosters.length > 0;
  updateTrashConfirm();

  const list = $('trashRecentList');
  list.innerHTML = '';
  const now = Date.now();
  trash.forEach((t) => {
    const item = document.createElement('div');
    item.className = 'trash-item';
    const name = document.createElement('span');
    name.className = 'trash-item__name';
    name.textContent = t.name;
    const meta = document.createElement('span');
    meta.className = 'trash-item__meta';
    const days = Math.max(1, Math.ceil(((Number(t.expiresAt) || now) - now) / 86400000));
    meta.textContent = `${t.count} 人 · 还剩 ${days} 天`;
    const btn = document.createElement('button');
    btn.className = 'cls-ghost trash-restore';
    btn.textContent = '恢复';
    btn.addEventListener('click', () => restoreRosters([t.id]));
    item.append(name, meta, btn);
    list.appendChild(item);
  });
  $('trashRecentEmpty').hidden = trash.length > 0;
  $('trashRecentCount').textContent = `${trash.length} 个`;
}

async function confirmDeleteRosters() {
  const ids = state.trashPicked.slice();
  if (!ids.length) return;
  const btn = $('btnTrashConfirm');
  btn.disabled = true;
  btn.textContent = '删除中…';
  let res = null;
  try {
    res = await bridge.classroomDeleteRosters(ids);
  } catch (e) {
    res = null;
  }
  if (!res || !res.ok) {
    toast((res && res.error) || '删除失败，请重试');
    renderTrashDialog();
    return;
  }
  state.data = res.data;
  state.trashPicked = [];
  renderRosterList();
  resetStage();
  renderTrashDialog();
  toast(`已删除 ${res.deleted} 个名单，可在「最近删除」里恢复`);
}

async function restoreRosters(ids) {
  let res = null;
  try {
    res = await bridge.classroomRestoreRosters(ids);
  } catch (e) {
    res = null;
  }
  if (!res || !res.ok) {
    toast((res && res.error) || '恢复失败，请重试');
    return;
  }
  state.data = res.data;
  renderRosterList();
  resetStage();
  renderTrashDialog();
  toast(`已恢复 ${res.restored} 个名单`);
}

/* ---------------- 管理员 ---------------- */
async function openAdmin() {
  $('adminModal').hidden = false;
  $('adminTitle').textContent = '管理员模式';
  let status;
  try {
    status = await bridge.classroomAdminStatus();
  } catch (e) {
    status = { hasPassword: false, unlocked: false };
  }
  if (!status.hasPassword) {
    renderAdminGate('setup');
    return;
  }
  if (status.unlocked) {
    const res = await bridge.classroomAdminData();
    if (res && res.ok) {
      applyAdmin(res.data);
      return;
    }
  }
  renderAdminGate('login');
}

function closeAdmin() {
  $('adminModal').hidden = true;
}

function renderAdminGate(mode) {
  const setup = mode === 'setup';
  $('adminTitle').textContent = setup ? '设置管理员密码' : '管理员验证';
  const body = $('adminBody');
  body.innerHTML =
    `<p class="admin-intro">${setup
      ? '首次进入管理员模式，请设置一个密码（至少 4 位）。密码只保存在本机，用于修改名单、权重与查看抽取次数。'
      : '请输入管理员密码。'}</p>
    <div class="admin-form">
      <input type="password" class="cls-input" id="adminPwd" placeholder="${setup ? '设置密码' : '管理员密码'}" autocomplete="off" />
      ${setup ? '<input type="password" class="cls-input" id="adminPwd2" placeholder="再次输入密码" autocomplete="off" />' : ''}
      <div class="admin-error" id="adminError"></div>
      <button class="cls-primary" id="btnAdminGate">${setup ? '设置并进入' : '进入管理员模式'}</button>
    </div>`;

  const submit = async () => {
    const err = $('adminError');
    const pw = $('adminPwd').value;
    if (setup) {
      const pw2 = $('adminPwd2').value;
      if (pw.length < 4) { err.textContent = '密码至少 4 位'; return; }
      if (pw !== pw2) { err.textContent = '两次输入的密码不一致'; return; }
      const res = await bridge.classroomAdminSetup(pw);
      if (!res || !res.ok) { err.textContent = (res && res.error) || '设置失败'; return; }
      state.adminData = res.data;
      state.adminRosterId = res.data.activeRosterId || '';
      renderRosterList();
      renderAdminPanel();
      toast('管理员密码已设置');
    } else {
      if (!pw) { err.textContent = '请输入密码'; return; }
      const res = await bridge.classroomAdminLogin(pw);
      if (!res || !res.ok) { err.textContent = (res && res.error) || '密码不正确'; return; }
      state.adminData = res.data;
      state.adminRosterId = res.data.activeRosterId || '';
      renderRosterList();
      renderAdminPanel();
      toast('已进入管理员模式');
    }
  };

  $('btnAdminGate').addEventListener('click', submit);
  body.querySelectorAll('input').forEach((inp) => {
    inp.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') submit();
    });
  });
  setTimeout(() => { const el = $('adminPwd'); if (el) el.focus(); }, 60);
}

function applyAdmin(data) {
  state.adminData = data;
  state.data = data;
  if (!state.adminRosterId || !data.rosters.some((r) => r.id === state.adminRosterId)) {
    state.adminRosterId = data.activeRosterId || (data.rosters[0] && data.rosters[0].id) || '';
  }
  renderRosterList();
  renderAdminPanel();
}

async function refreshAdmin() {
  const res = await bridge.classroomAdminData();
  if (res && res.ok) applyAdmin(res.data);
}

function renderAdminPanel() {
  const d = state.adminData || state.data;
  if (!d) return;
  $('adminTitle').textContent = '管理员模式';
  const rosters = Array.isArray(d.rosters) ? d.rosters : [];
  if (!state.adminRosterId || !rosters.some((r) => r.id === state.adminRosterId)) {
    state.adminRosterId = d.activeRosterId || (rosters[0] && rosters[0].id) || '';
  }
  const roster = rosters.find((r) => r.id === state.adminRosterId);
  const body = $('adminBody');
  const quota = d.adminQuota || { used: false, restricted: false, vip: false };
  const quotaVip = !!quota.vip;
  const quotaLocked = !!(quota.used && quota.restricted && !quotaVip);
  const quotaName = quota.name || '该学生';
  body.innerHTML =
    `<p class="admin-hint">管理员模式可修改名单名称、修改学生姓名、查看被抽中次数，并为每位学生单独设置抽取权重（0.1 – 10，权重越高越容易被抽到）。</p>
    ${quotaVip ? `<div class="admin-quota admin-quota--vip"><b>已解锁权重不限次数</b>：所有学生的权重都可以随时调整。</div>` : ''}
    ${quotaLocked ? `<div class="admin-quota"><b>今日免密额度已用于「${esc(quotaName)}」</b>：只能继续调整这名学生的权重，其他学生的权重今日锁定，明天自动恢复。
      <div class="admin-quota__redeem">
        <input class="cls-input" id="adminVipCode" placeholder="兑换码" autocomplete="off" spellcheck="false" />
        <button class="cls-ghost" id="btnAdminVipRedeem">兑换</button>
      </div>
    </div>` : ''}
    <div class="admin-toolbar">
      <select class="cls-input" id="adminRosterSelect">
        ${rosters.length
          ? rosters.map((r) => `<option value="${esc(r.id)}"${r.id === state.adminRosterId ? ' selected' : ''}>${esc(r.name)}（${r.names.length}人）</option>`).join('')
          : '<option>暂无名单</option>'}
      </select>
      <input class="cls-input admin-roster-name" id="adminRosterName" value="${esc(roster ? roster.name : '')}" placeholder="名单名称" />
      <button class="cls-ghost" id="btnAdminRename">保存名称</button>
      <button class="cls-ghost" id="btnAdminReset">重置抽取次数</button>
      <button class="cls-danger" id="btnAdminDeleteRoster">删除名单</button>
    </div>
    <div class="admin-table-wrap">
      <table class="admin-table">
        <thead><tr><th style="width:44%">姓名</th><th style="width:126px">权重</th><th style="width:110px">抽到次数</th><th style="width:64px"></th></tr></thead>
        <tbody>
          ${roster && roster.names.length
            ? roster.names.map((n) => `<tr data-nid="${esc(n.id)}">
                <td><input class="cls-input admin-name-input" data-role="name" value="${esc(n.name)}" /></td>
                <td><input type="number" class="admin-weight" data-role="weight" min="0.1" max="10" step="0.1" value="${n.weight}"${quotaLocked && n.id !== quota.nameId ? ' disabled title="非VIP用户仅限一人使用，请次日再试"' : ''} /></td>
                <td><span class="admin-count"><b>${n.count}</b> 次</span></td>
                <td><button class="cls-danger" data-role="remove" style="padding:4px 10px">删除</button></td>
              </tr>`).join('')
            : '<tr><td colspan="4"><span class="admin-hint">名单为空，可在下方批量添加学生。</span></td></tr>'}
        </tbody>
      </table>
    </div>
    <div class="admin-row">
      <textarea class="cls-textarea cls-textarea--sm admin-add-names" id="adminAddNames" placeholder="批量添加姓名：每行一个，或用逗号分隔"></textarea>
      <button class="cls-ghost" id="btnAdminAddNames">添加学生</button>
    </div>
    <div class="admin-section-title">签运簿</div>
    <div class="admin-row admin-history">
      <span class="admin-hint">当前 <b>${d.historyCount || 0}</b> 条记录${d.historyBackupCount ? ` · 可恢复上次清空的 ${d.historyBackupCount} 条` : ''}</span>
      <button class="cls-danger" id="btnAdminClearHistory">清空签运簿</button>
      <button class="cls-ghost" id="btnAdminRestoreHistory" ${d.historyBackupCount ? '' : 'disabled'}>撤销清空</button>
    </div>
    <div class="admin-section-title">调试（仅管理员可见）</div>
    <div class="admin-row">
      <label class="admin-switch"><input type="checkbox" id="adminDebug" ${d.debugMode ? 'checked' : ''} /> 调试模式（预览每日首抽，不影响真实记录）</label>
      <button class="cls-ghost" id="btnAdminDebugDraw">触发每日抽签动画</button>
    </div>
    <div class="admin-section-title">修改管理员密码</div>
    <div class="admin-pwd">
      <input type="password" class="cls-input" id="adminOldPw" placeholder="原密码" autocomplete="off" />
      <input type="password" class="cls-input" id="adminNewPw" placeholder="新密码（至少 4 位）" autocomplete="off" />
      <button class="cls-ghost" id="btnAdminChangePw">修改密码</button>
    </div>
    <div class="admin-foot">
      <span id="adminHint"></span>
      <button class="cls-ghost" id="btnAdminLock">退出管理员</button>
    </div>`;

  wireAdminPanel(roster);
}

function wireAdminPanel(roster) {
  const body = $('adminBody');
  const rosterId = state.adminRosterId;

  $('adminRosterSelect').addEventListener('change', (e) => {
    state.adminRosterId = e.target.value;
    renderAdminPanel();
  });

  $('btnAdminRename').addEventListener('click', async () => {
    if (!roster) return toast('暂无名单');
    const name = $('adminRosterName').value.trim();
    if (!name) return toast('名单名称不能为空');
    const res = await bridge.classroomRenameRoster(rosterId, name);
    if (res && res.ok) { applyAdmin(res.data); toast('名单名称已保存'); }
    else toast((res && res.error) || '保存失败');
  });

  $('btnAdminReset').addEventListener('click', async () => {
    if (!roster) return toast('暂无名单');
    if (!window.confirm(`确定把「${roster.name}」所有学生的抽到次数清零？`)) return;
    const res = await bridge.classroomResetCounts(rosterId);
    if (res && res.ok) { applyAdmin(res.data); toast('抽取次数已重置'); }
    else toast((res && res.error) || '操作失败');
  });

  const vipBtn = $('btnAdminVipRedeem');
  if (vipBtn) {
    vipBtn.addEventListener('click', async () => {
      const input = $('adminVipCode');
      const code = ((input && input.value) || '').trim();
      if (!code) return toast('请输入兑换码');
      const res = await bridge.classroomVipRedeem(code);
      if (res && res.ok) {
        applyAdmin(res.data);
        toast('兑换成功，权重已不限次数');
      } else {
        toast((res && res.error) || '兑换失败');
      }
    });
    const input = $('adminVipCode');
    if (input) {
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); vipBtn.click(); }
      });
    }
  }

  $('btnAdminDeleteRoster').addEventListener('click', async () => {
    if (!roster) return toast('暂无名单');
    if (!window.confirm(`确定删除名单「${roster.name}」？该名单的学生与抽取记录都会被删除。`)) return;
    const res = await bridge.classroomDeleteRoster(rosterId);
    if (res && res.ok) { applyAdmin(res.data); toast('名单已删除'); }
    else toast((res && res.error) || '删除失败');
  });

  const table = body.querySelector('.admin-table');
  table.addEventListener('change', async (e) => {
    const tr = e.target.closest('tr[data-nid]');
    if (!tr) return;
    const role = e.target.dataset.role;
    if (role !== 'name' && role !== 'weight') return;
    const patch = role === 'name' ? { name: e.target.value } : { weight: Number(e.target.value) };
    const res = await bridge.classroomUpdateName(rosterId, tr.dataset.nid, patch);
    if (res && res.ok) {
      state.adminData = res.data;
      state.data = res.data;
      if (role === 'name') toast('姓名已保存');
    } else {
      toast((res && res.error) || '保存失败');
      if (res && res.data) applyAdmin(res.data);
      else if (role === 'weight') refreshAdmin();
    }
  });
  table.addEventListener('click', async (e) => {
    if (e.target.dataset.role !== 'remove') return;
    const tr = e.target.closest('tr[data-nid]');
    if (!tr) return;
    const res = await bridge.classroomRemoveName(rosterId, tr.dataset.nid);
    if (res && res.ok) { applyAdmin(res.data); toast('已删除'); }
    else toast((res && res.error) || '删除失败');
  });

  $('btnAdminAddNames').addEventListener('click', async () => {
    if (!roster) return toast('请先新建或导入名单');
    const text = $('adminAddNames').value.trim();
    if (!text) return toast('请输入要添加的姓名');
    const res = await bridge.classroomAddNames(rosterId, text);
    if (res && res.ok) {
      applyAdmin(res.data);
      toast(res.added ? `已添加 ${res.added} 名学生` : '没有新增姓名（可能已存在）');
    } else toast((res && res.error) || '添加失败');
  });

  $('btnAdminClearHistory').addEventListener('click', async () => {
    const total = (state.adminData && state.adminData.historyCount) || 0;
    if (!window.confirm(`确定清空签运簿？当前 ${total} 条记录将被清空，清空后可以点击“撤销清空”恢复。`)) return;
    const res = await bridge.classroomClearHistory();
    if (res && res.ok) {
      applyAdmin(res.data);
      toast(`已清空 ${res.count} 条记录，可点击“撤销清空”恢复`);
    } else {
      toast((res && res.error) || '清空失败');
    }
  });
  $('btnAdminRestoreHistory').addEventListener('click', async () => {
    const res = await bridge.classroomRestoreHistory();
    if (res && res.ok) {
      applyAdmin(res.data);
      toast(`已恢复 ${res.count} 条签运记录`);
    } else {
      toast((res && res.error) || '没有可恢复的数据');
    }
  });

  $('adminDebug').addEventListener('change', async (e) => {
    const res = await bridge.adminSetDebug(e.target.checked);
    if (res && res.ok) {
      state.debugMode = !!res.debugMode;
      toast(res.debugMode ? '已开启调试模式' : '已关闭调试模式');
    } else {
      e.target.checked = !e.target.checked;
      toast((res && res.error) || '操作失败');
    }
  });
  $('btnAdminDebugDraw').addEventListener('click', async () => {
    const res = await bridge.adminTriggerDraw();
    if (res && res.ok) toast('已触发抽签动画，请查看主界面');
    else toast((res && res.error) || '请先开启调试模式');
  });

  $('btnAdminChangePw').addEventListener('click', async () => {
    const oldPw = $('adminOldPw').value;
    const newPw = $('adminNewPw').value;
    if (newPw.length < 4) return toast('新密码至少 4 位');
    const res = await bridge.classroomChangePassword(oldPw, newPw);
    if (res && res.ok) {
      $('adminOldPw').value = '';
      $('adminNewPw').value = '';
      $('adminHint').textContent = '密码已更新';
      toast('管理员密码已修改');
    } else toast((res && res.error) || '修改失败');
  });

  $('btnAdminLock').addEventListener('click', async () => {
    await bridge.classroomAdminLock();
    state.adminData = null;
    closeAdmin();
    toast('已退出管理员模式');
  });
}

/* ---------------- 课程表 ---------------- */
function renderTimetable() {
  const t = state.data && state.data.timetable;
  if (!t) return;
  $('ttTitle').value = t.title || '我的课程表';
  const table = $('ttTable');
  const head = `<thead><tr>
      <th>节次</th><th class="tt-time-col">时间</th>
      ${DAYS.map((d) => `<th>${d}</th>`).join('')}
      <th class="tt-del-col"></th>
    </tr></thead>`;
  const body = t.periods.map((p, pi) => `<tr data-pi="${pi}">
      <td><input class="tt-input tt-input--label" data-role="label" value="${esc(p.label)}" /></td>
      <td><input class="tt-input tt-input--time" data-role="time" value="${esc(p.time)}" placeholder="08:00-08:45" /></td>
      ${DAYS.map((d, di) => `<td><input class="tt-input tt-input--cell" data-role="cell" data-di="${di}" value="${esc(p.cells[di] || '')}" /></td>`).join('')}
      <td><button class="tt-del" data-role="del" title="删除这一节">×</button></td>
    </tr>`).join('');
  table.innerHTML = head + `<tbody>${body}</tbody>`;
}

let ttSaveTimer = null;
function scheduleTtSave() {
  clearTimeout(ttSaveTimer);
  ttSaveTimer = setTimeout(saveTimetable, 450);
}

async function saveTimetable() {
  if (!state.data || !state.data.timetable) return;
  try {
    const res = await bridge.classroomSaveTimetable(state.data.timetable);
    if (res && res.ok && res.timetable) state.data.timetable = res.timetable;
  } catch (e) { /* 忽略，下次编辑会重试 */ }
}

function wireTimetable() {
  const table = $('ttTable');
  table.addEventListener('change', (e) => {
    const tr = e.target.closest('tr[data-pi]');
    if (!tr || !state.data || !state.data.timetable) return;
    const p = state.data.timetable.periods[Number(tr.dataset.pi)];
    if (!p) return;
    const role = e.target.dataset.role;
    if (role === 'label') p.label = e.target.value.slice(0, 12);
    else if (role === 'time') p.time = e.target.value.slice(0, 24);
    else if (role === 'cell') p.cells[Number(e.target.dataset.di)] = e.target.value.slice(0, 30);
    scheduleTtSave();
  });
  table.addEventListener('click', (e) => {
    if (e.target.dataset.role !== 'del') return;
    const tr = e.target.closest('tr[data-pi]');
    if (!tr) return;
    const idx = Number(tr.dataset.pi);
    if (!state.data.timetable.periods[idx]) return;
    state.data.timetable.periods.splice(idx, 1);
    renderTimetable();
    scheduleTtSave();
  });
  $('ttTitle').addEventListener('input', (e) => {
    if (!state.data || !state.data.timetable) return;
    state.data.timetable.title = e.target.value.slice(0, 40);
    scheduleTtSave();
  });
  $('btnTtAdd').addEventListener('click', () => {
    const t = state.data.timetable;
    t.periods.push({
      id: 'p' + Date.now().toString(36),
      label: `第${t.periods.length + 1}节`,
      time: '',
      cells: ['', '', '', '', '', '', '']
    });
    renderTimetable();
    scheduleTtSave();
  });
}

/* ---------------- 课程表导入 ---------------- */
function openTtImport() {
  state.ttRows = null;
  state.ttFile = null;
  $('ttImportText').value = '';
  $('ttFileName').textContent = '未选择文件';
  $('ttImportModal').hidden = false;
}
function closeTtImport() {
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
  const periods = [];
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
    periods.push({
      id: 'p' + i + '_' + Date.now().toString(36),
      label: (labelRaw || `第${periods.length + 1}节`).replace(/\s/g, '').slice(0, 12),
      time: time.replace(/：/g, ':').slice(0, 24),
      cells
    });
  }
  return periods;
}

function parseTimetableText(text) {
  const lines = String(text || '').replace(/\r\n?/g, '\n').split('\n').map((l) => l.trim()).filter(Boolean);
  if (!lines.length) return [];
  const rows = lines.map((l) => l.split(/[,\t，]/).map((c) => c.trim()));
  const grid = parseTimetableRows(rows);
  if (grid.length) return grid;

  const periods = [];
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
    periods.push({
      id: 'p' + i + '_' + Date.now().toString(36),
      label: (labelMatch ? labelMatch[0].replace(/\s/g, '') : `第${periods.length + 1}节`).slice(0, 12),
      time: timeMatch ? timeMatch[0].replace(/：/g, ':').replace(/[~—至]/g, '-') : '',
      cells
    });
  });
  return periods;
}

async function doImportTimetable() {
  let periods = [];
  if (state.ttRows) {
    periods = parseTimetableRows(state.ttRows);
    if (!periods.length) periods = parseTimetableText(state.ttRows.map((r) => r.join(' ')).join('\n'));
  } else {
    periods = parseTimetableText($('ttImportText').value);
  }
  if (!periods.length) {
    toast('没有解析到课程，请检查格式后重试');
    return;
  }
  state.data.timetable.periods = periods;
  renderTimetable();
  await saveTimetable();
  closeTtImport();
  toast(`课程表已导入，共 ${periods.length} 节`);
}

/* ---------------- 全屏模式（点点名 / 分组 / 计时通用，右上角退出） ---------------- */
async function setClassFullscreen(on) {
  const next = !!on;
  if (state.classFull === next) return;
  state.classFull = next;
  document.body.classList.toggle('cls-fullscreen', next);
  const exit = $('btnExitFull');
  if (exit) exit.hidden = !next;
  if (next) {
    $('timerBgPanel').hidden = true;
    toast('全屏模式 · 点击右上角「退出全屏」或按 Esc 退出');
  }
  try {
    if (bridge.setClassFullscreen) await bridge.setClassFullscreen(next);
    else if (bridge.setFullScreen) await bridge.setFullScreen(next);
  } catch (e) { /* 忽略 */ }
}

/* ---------------- 随机分组 ---------------- */
function clampGroupValue() {
  const roster = activeRoster();
  const total = roster && roster.names.length ? roster.names.length : 4;
  const max = Math.max(2, Math.min(20, total));
  state.groupValue = Math.min(max, Math.max(2, state.groupValue));
  $('groupValue').textContent = String(state.groupValue);
}

function changeGroupValue(delta) {
  state.groupValue += delta;
  clampGroupValue();
  renderGroupPlaceholder();
}

function renderGroupPlaceholder() {
  clampGroupValue();
  const roster = activeRoster();
  const box = $('groupResult');
  if (!roster || !roster.names.length) {
    box.innerHTML = '<p class="group-empty">请先在「随机点名」中选择或导入名单</p>';
    return;
  }
  const unit = state.groupMode === 'count' ? '组' : '人';
  box.innerHTML = `<p class="group-empty">当前名单「${esc(roster.name)}」共 ${roster.names.length} 人，每组目标 ${state.groupValue} ${unit}，点击「随机分组」</p>`;
}

function shuffled(list) {
  const arr = list.slice();
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function generateGroups() {
  const roster = activeRoster();
  if (!roster || !roster.names.length) return toast('请先选择有学生的名单');
  clampGroupValue();
  const names = shuffled(roster.names.map((n) => n.name));
  const total = names.length;
  let groups = [];
  if (state.groupMode === 'size') {
    const size = Math.max(1, Math.min(state.groupValue, total));
    for (let i = 0; i < total; i += size) groups.push(names.slice(i, i + size));
  } else {
    const count = Math.max(1, Math.min(state.groupValue, total));
    groups = Array.from({ length: count }, () => []);
    names.forEach((n, i) => groups[i % count].push(n));
  }
  const html = groups.map((g, i) => (
    `<section class="group-card">
      <div class="group-card__head"><b>第 ${i + 1} 组</b><span>${g.length} 人</span></div>
      <div class="group-card__names">${g.map((n) => `<span>${esc(n)}</span>`).join('')}</div>
    </section>`
  )).join('');
  $('groupResult').innerHTML = `<div class="group-grid">${html}</div>`;
  if (bridge.log) bridge.log('GROUP_DRAW', { mode: state.groupMode, value: state.groupValue, groups: groups.length });
  toast(`已随机分为 ${groups.length} 组`);
}

/* ---------------- 课堂计时 ---------------- */
function fmtTimer(sec) {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function timerParts(sec) {
  const total = Math.max(0, Math.floor(sec));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return [Math.floor(m / 10) % 10, m % 10, Math.floor(s / 10), s % 10];
}

function renderTimer() {
  const t = state.timer;
  const value = t.mode === 'stopwatch' ? t.elapsed : t.left;
  const parts = timerParts(value);
  ['timerM1', 'timerM0', 'timerS1', 'timerS0'].forEach((id, i) => {
    const el = $(id);
    if (el) el.textContent = String(parts[i]);
  });
  document.body.classList.toggle('timer-running', t.running);
  document.body.classList.toggle('timer-done', t.mode === 'countdown' && t.left <= 0);
  document.body.classList.toggle('timer-stopwatch', t.mode === 'stopwatch');
  $('btnTimerPause').textContent = t.running
    ? '暂停'
    : (t.left < t.total && t.left > 0 && t.mode === 'countdown' ? '继续' : (t.mode === 'stopwatch' && t.elapsed > 0 ? '继续' : '开始'));
  document.querySelectorAll('#timerMode button').forEach((b) => {
    b.classList.toggle('on', b.dataset.mode === t.mode);
  });
  document.querySelectorAll('#timerFixed button').forEach((b) => {
    b.classList.toggle('on', t.mode === 'countdown' && Number(b.dataset.sec) === t.total);
  });
  document.querySelectorAll('.timer-digit-col button').forEach((b) => {
    b.disabled = t.running;
  });
}

function stopTimerTick() {
  if (state.timer.tick) {
    clearInterval(state.timer.tick);
    state.timer.tick = null;
  }
}

/* 设置倒计时时长（固定时间 / 数字加减共用） */
function applyTimerSeconds(total, tip) {
  stopTimerTick();
  cancelTimerFullscreen();
  const t = state.timer;
  t.mode = 'countdown';
  t.running = false;
  t.endAt = 0;
  t.startAt = 0;
  t.total = Math.max(5, Math.min(99 * 60 + 59, total));
  t.left = t.total;
  document.body.classList.remove('timer-done');
  renderTimer();
  $('timerTip').textContent = tip || `已设置 ${fmtTimer(t.total)}`;
}

/* 倒计时 / 计时器（正计时）切换 */
function setTimerMode(mode) {
  const t = state.timer;
  const next = mode === 'stopwatch' ? 'stopwatch' : 'countdown';
  if (t.mode === next) return;
  stopTimerTick();
  cancelTimerFullscreen();
  t.running = false;
  t.endAt = 0;
  t.startAt = 0;
  t.mode = next;
  if (next === 'stopwatch') t.elapsed = 0;
  else t.left = t.total;
  document.body.classList.remove('timer-done');
  renderTimer();
  $('timerTip').textContent = next === 'stopwatch'
    ? '计时器：从 0 开始正计时'
    : '设置时长后点击开始，3 秒后自动全屏';
}

function stepTimer(delta) {
  if (state.timer.mode !== 'countdown') return;
  applyTimerSeconds(state.timer.total + Number(delta || 0), '');
}

function cancelTimerFullscreen() {
  if (state.timer.autoFullTimer) {
    clearTimeout(state.timer.autoFullTimer);
    state.timer.autoFullTimer = null;
  }
}

/* 开始计时 3 秒后自动进入全屏，只保留大号倒计时 */
function scheduleTimerFullscreen() {
  const t = state.timer;
  if (t.full) return;
  cancelTimerFullscreen();
  $('timerTip').textContent = '计时中 · 3 秒后自动全屏';
  t.autoFullTimer = setTimeout(() => {
    t.autoFullTimer = null;
    enterTimerFullscreen();
  }, 3000);
}

async function enterTimerFullscreen() {
  const t = state.timer;
  if (t.full) return;
  t.full = true;
  document.body.classList.add('timer-full');
  renderTimer();
  const bgVideo = $('timerBgVideo');
  if (bgVideo && !bgVideo.hidden) {
    const p = bgVideo.play();
    if (p && p.catch) p.catch(() => { /* 忽略 */ });
  }
  $('timerTip').textContent = '按 Esc 或点击空白处退出全屏';
  try {
    if (bridge.setTimerFullscreen) await bridge.setTimerFullscreen(true);
    else if (bridge.setFullScreen) await bridge.setFullScreen(true);
  } catch (e) { /* 忽略 */ }
}

async function exitTimerFullscreen() {
  const t = state.timer;
  if (!t.full) return;
  t.full = false;
  document.body.classList.remove('timer-full');
  renderTimer();
  const done = t.mode === 'countdown' && t.left <= 0;
  const paused = t.mode === 'stopwatch' ? t.elapsed > 0 : t.left < t.total;
  $('timerTip').textContent = done
    ? '时间到！'
    : (t.running ? (t.mode === 'stopwatch' ? '计时中…' : '倒计时中…') : (paused ? '已暂停' : '设置时长后点击开始，3 秒后自动全屏'));
  try {
    if (bridge.setTimerFullscreen) await bridge.setTimerFullscreen(false);
    else if (bridge.setFullScreen) await bridge.setFullScreen(false);
  } catch (e) { /* 忽略 */ }
}

function finishTimer() {
  const t = state.timer;
  stopTimerTick();
  cancelTimerFullscreen();
  t.running = false;
  t.endAt = 0;
  t.startAt = 0;
  renderTimer();
  if (window.GkSound) {
    try {
      GkSound.unlock();
      GkSound.playDrawDone();
    } catch (e) { /* 忽略 */ }
  }
  toast('时间到！');
  document.body.classList.add('timer-flash');
  setTimeout(() => document.body.classList.remove('timer-flash'), 1600);
  $('timerTip').textContent = t.full ? '时间到！按 Esc 退出全屏' : '时间到！';
  if (bridge.log) bridge.log('TIMER_DONE', { total: t.total });
}

function timerTick() {
  const t = state.timer;
  if (!t.running) return;
  if (t.mode === 'stopwatch') {
    const elapsed = Math.max(0, Math.floor((Date.now() - t.startAt) / 1000));
    if (elapsed !== t.elapsed) {
      t.elapsed = elapsed;
      renderTimer();
    }
    return;
  }
  if (!t.endAt) return;
  const left = Math.max(0, Math.ceil((t.endAt - Date.now()) / 1000));
  if (left === t.left) return;
  t.left = left;
  renderTimer();
  if (left <= 0) {
    finishTimer();
    return;
  }
  // 最后 10 秒每秒提示，最后 3 秒提高音调
  if (left <= 10 && window.GkSound) {
    try {
      GkSound.unlock();
      GkSound.playTimerTick(left <= 3);
    } catch (e) { /* 忽略 */ }
  }
}

function toggleTimer() {
  const t = state.timer;
  if (t.running) {
    if (t.mode === 'stopwatch') {
      t.elapsed = Math.max(0, Math.floor((Date.now() - t.startAt) / 1000));
    } else {
      t.left = Math.max(0, Math.ceil((t.endAt - Date.now()) / 1000));
    }
    stopTimerTick();
    cancelTimerFullscreen();
    t.running = false;
    t.endAt = 0;
    t.startAt = 0;
    renderTimer();
    $('timerTip').textContent = t.full ? '已暂停 · 按 Esc 或点击空白处退出' : '已暂停';
    return;
  }
  document.body.classList.remove('timer-done');
  t.running = true;
  if (t.mode === 'stopwatch') {
    t.startAt = Date.now() - t.elapsed * 1000;
  } else {
    if (t.left <= 0) t.left = t.total;
    t.endAt = Date.now() + t.left * 1000;
  }
  if (window.GkSound) {
    try { GkSound.unlock(); } catch (e) { /* 忽略 */ }
  }
  stopTimerTick();
  t.tick = setInterval(timerTick, 250);
  renderTimer();
  scheduleTimerFullscreen();
}

function resetTimer() {
  const t = state.timer;
  stopTimerTick();
  cancelTimerFullscreen();
  t.running = false;
  t.endAt = 0;
  t.startAt = 0;
  if (t.mode === 'stopwatch') t.elapsed = 0;
  else t.left = t.total;
  document.body.classList.remove('timer-done');
  if (t.full) exitTimerFullscreen();
  renderTimer();
  $('timerTip').textContent = t.mode === 'stopwatch' ? '计时器已归零' : '已重置，点击开始计时';
}

/* ---------------- 外观与背景：液态玻璃参数 + 背景设置合并为一个面板 ---------------- */
const GLASS_KEY = 'cls-glass-look';
const TIMER_LOOK_KEY = 'cls-timer-look'; // 旧版键：仅用于一次性迁移
const UI_LOOK_KEY = 'cls-ui-look';       // 旧版键：仅用于一次性迁移
const TIMER_BG_KEY = 'cls-timer-bg';
const TIMER_BG_MODE_KEY = 'cls-timer-bg-mode';
const TIMER_BG_LIST_KEY = 'cls-timer-bg-list';
const GLASS_DEFAULT = { opacity: 55, veil: 25, blur: 18, font: 100, width: 100, radius: 18 };

function clampLook(v, min, max, def) {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : def;
}

/* 六个参数只存一份：透明度 / 遮罩 / 模糊 / 字号 / 宽度 / 圆角，面板里不再出现重复滑杆 */
function readGlassLook() {
  const look = Object.assign({}, GLASS_DEFAULT);
  let saved = null;
  try { saved = JSON.parse(localStorage.getItem(GLASS_KEY) || 'null'); } catch (e) { saved = null; }
  if (!saved || typeof saved !== 'object') {
    // 首次升级：把旧版「计时背景」与「液态玻璃外观」两份设置合并保存
    saved = {};
    try {
      const oldTimer = JSON.parse(localStorage.getItem(TIMER_LOOK_KEY) || 'null');
      const oldUi = JSON.parse(localStorage.getItem(UI_LOOK_KEY) || 'null');
      if (oldTimer && typeof oldTimer === 'object') Object.assign(saved, oldTimer);
      if (oldUi && typeof oldUi === 'object') Object.assign(saved, oldUi);
    } catch (e) { /* 忽略 */ }
    try { localStorage.setItem(GLASS_KEY, JSON.stringify(saved)); } catch (e) { /* 忽略 */ }
  }
  look.opacity = clampLook(saved.opacity, 20, 95, GLASS_DEFAULT.opacity);
  look.veil = clampLook(saved.veil, 0, 80, GLASS_DEFAULT.veil);
  look.blur = clampLook(saved.blur, 0, 40, GLASS_DEFAULT.blur);
  look.font = clampLook(saved.font, 85, 140, GLASS_DEFAULT.font);
  look.width = clampLook(saved.width, 80, 140, GLASS_DEFAULT.width);
  look.radius = clampLook(saved.radius, 4, 36, GLASS_DEFAULT.radius);
  return look;
}

function applyGlassLook(look) {
  const root = document.body;
  root.style.setProperty('--timer-opacity', String(look.opacity / 100));
  root.style.setProperty('--timer-veil', String(look.veil / 100));
  // 一个「毛玻璃模糊」同时驱动计时卡片与所有玻璃面板，两边不再各调一套
  root.style.setProperty('--timer-blur', look.blur + 'px');
  root.style.setProperty('--ui-glass-blur', look.blur + 'px');
  root.style.setProperty('--ui-text-scale', String(look.font / 100));
  root.style.setProperty('--ui-glass-w', String(look.width / 100));
  root.style.setProperty('--glass-radius', look.radius + 'px');
  // 字体颜色与强调色不再开放调节，始终跟随当前皮肤，避免拖动滑杆时整页变色
  root.style.removeProperty('--text');
  root.style.removeProperty('--gold');
  const sync = (id, v) => { const el = $(id); if (el) el.value = String(v); };
  const setTxt = (id, t) => { const el = $(id); if (el) el.textContent = t; };
  sync('timerOpacity', look.opacity); setTxt('timerOpacityVal', look.opacity + '%');
  sync('timerVeil', look.veil); setTxt('timerVeilVal', look.veil + '%');
  sync('timerBlur', look.blur); setTxt('timerBlurVal', look.blur + 'px');
  sync('lookFont', look.font); setTxt('lookFontVal', look.font + '%');
  sync('lookWidth', look.width); setTxt('lookWidthVal', look.width + '%');
  sync('lookRadius', look.radius); setTxt('lookRadiusVal', look.radius + 'px');
}

function readGlassFromPanel() {
  const val = (id, def) => { const el = $(id); return el ? Number(el.value) : def; };
  return {
    opacity: val('timerOpacity', GLASS_DEFAULT.opacity),
    veil: val('timerVeil', GLASS_DEFAULT.veil),
    blur: val('timerBlur', GLASS_DEFAULT.blur),
    font: val('lookFont', GLASS_DEFAULT.font),
    width: val('lookWidth', GLASS_DEFAULT.width),
    radius: val('lookRadius', GLASS_DEFAULT.radius)
  };
}

function saveGlassLook(look) {
  applyGlassLook(look);
  try { localStorage.setItem(GLASS_KEY, JSON.stringify(look)); } catch (e) { /* 忽略 */ }
}

/* 外观与背景共用一个面板：顶栏缩略图 / 计时页缩略图都从这个面板进入 */
function bindAppearance() {
  applyGlassLook(readGlassLook());
  ['timerOpacity', 'timerVeil', 'timerBlur', 'lookFont', 'lookWidth', 'lookRadius'].forEach((id) => {
    const el = $(id);
    if (el) el.addEventListener('input', () => saveGlassLook(readGlassFromPanel()));
  });
  const reset = $('btnLookReset');
  if (reset) reset.addEventListener('click', () => {
    saveGlassLook(Object.assign({}, GLASS_DEFAULT));
    toast('已恢复默认外观');
  });

  const togglePanel = () => {
    const panel = $('timerBgPanel');
    if (!panel) return;
    panel.hidden = !panel.hidden;
  };
  const topBgBtn = $('btnClsBg');
  if (topBgBtn) topBgBtn.addEventListener('click', togglePanel);
  const timerBgBtn = $('btnTimerBg');
  if (timerBgBtn) timerBgBtn.addEventListener('click', togglePanel);
  $('btnTimerBgClose').addEventListener('click', () => { $('timerBgPanel').hidden = true; });
  $('btnTimerBgPick').addEventListener('click', pickTimerBackground);
  document.querySelectorAll('.timer-bg-opt').forEach((btn) => {
    btn.addEventListener('click', () => {
      setTimerBgMode(btn.dataset.bgMode);
      if (btn.dataset.bgMode !== 'custom') toast('背景已切换为' + btn.textContent.trim());
    });
  });
  $('timerBgImg').addEventListener('error', handleTimerBgError);
  $('timerBgVideo').addEventListener('error', handleTimerBgError);
  applyTimerBackground();
  document.addEventListener('click', (e) => {
    const panel = $('timerBgPanel');
    if (!panel || panel.hidden) return;
    // 点击列表项会立即重建按钮，用事件路径判断，避免元素被移除后误判为点击空白
    const path = typeof e.composedPath === 'function' ? e.composedPath() : [];
    if (path.includes(panel) || path.includes($('btnTimerBg')) || path.includes($('btnClsBg'))) return;
    if (e.target.closest && e.target.closest('#btnTimerBg, #btnClsBg, #btnExitFull')) return;
    panel.hidden = true;
  });
}

function readTimerBg() {
  try {
    const saved = JSON.parse(localStorage.getItem(TIMER_BG_KEY) || 'null');
    return saved && saved.url ? saved : null;
  } catch (e) { return null; }
}

function saveTimerBgList(list) {
  try { localStorage.setItem(TIMER_BG_LIST_KEY, JSON.stringify(list.slice(0, 12))); } catch (e) { /* 忽略 */ }
}

function readTimerBgList() {
  let list = [];
  try { list = JSON.parse(localStorage.getItem(TIMER_BG_LIST_KEY) || '[]'); } catch (e) { list = []; }
  if (!Array.isArray(list)) list = [];
  list = list.filter((x) => x && x.url).slice(0, 12);
  const current = readTimerBg();
  // 内置动画不进「已导入背景」列表，避免出现无法删除的条目
  const isBuiltin = (u) => /[\\/]assets[\\/]bg[\\/]/i.test(String(u || ''));
  if (current && current.url && !isBuiltin(current.url) && !list.some((x) => x.url === current.url)) {
    list.unshift(current);
    saveTimerBgList(list);
  }
  return list.slice(0, 12);
}

function rememberTimerBg(cfg) {
  if (!cfg || !cfg.url) return;
  const list = readTimerBgList().filter((x) => x.url !== cfg.url);
  list.unshift(cfg);
  saveTimerBgList(list);
}

function renderTimerBgList() {
  const box = $('timerBgList');
  const label = $('timerBgListLabel');
  if (!box) return;
  const list = readTimerBgList();
  const current = readTimerBg();
  const mode = readTimerBgMode();
  box.innerHTML = '';
  if (label) label.hidden = !list.length;
  box.hidden = !list.length;
  list.forEach((cfg) => {
    const chip = document.createElement('div');
    chip.className = 'timer-bg-chip' + (mode === 'custom' && current && current.url === cfg.url ? ' on' : '');
    const nameBtn = document.createElement('button');
    nameBtn.className = 'timer-bg-chip__name';
    nameBtn.textContent = cfg.name || '已导入背景';
    nameBtn.title = cfg.name || '';
    nameBtn.addEventListener('click', () => selectTimerBg(cfg));
    const delBtn = document.createElement('button');
    delBtn.className = 'timer-bg-chip__del';
    delBtn.textContent = '×';
    delBtn.title = '删除这个背景';
    delBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      deleteTimerBg(cfg);
    });
    const thumb = document.createElement('img');
    thumb.className = 'timer-bg-chip__thumb';
    thumb.alt = '';
    if (/\.(mp4|webm)(\?|$)/i.test(cfg.url)) {
      videoThumb(cfg.url).then((pic) => { if (pic && thumb.isConnected) thumb.src = pic; });
    } else {
      thumb.src = cfg.url;
    }
    chip.appendChild(thumb);
    chip.appendChild(nameBtn);
    chip.appendChild(delBtn);
    box.appendChild(chip);
  });
}

/* ---------------- 内置动画背景（随安装包一起分发，默认静音循环） ---------------- */
const BUILTIN_BGS = [
  { id: 'builtin-1', name: '内置动画 1', file: 'builtin-1.mp4' },
  { id: 'builtin-2', name: '内置动画 2', file: 'builtin-2.mp4' },
  { id: 'builtin-3', name: '内置动画 3', file: 'builtin-3.mp4' }
];

let builtinUrlMap = null;

function builtinBgUrlFallback(file) {
  try { return new URL('../assets/bg/' + file, location.href).href; } catch (e) { return '../assets/bg/' + file; }
}

function builtinBgUrl(file) {
  return (builtinUrlMap && builtinUrlMap[file]) || builtinBgUrlFallback(file);
}

// 打包后视频在 app.asar.unpacked 里，主进程给出真实 file:// 地址；源码运行时回退相对路径
async function ensureBuiltinUrls() {
  if (builtinUrlMap) return builtinUrlMap;
  const map = {};
  try {
    if (bridge.classroomBuiltinBgs) {
      const res = await bridge.classroomBuiltinBgs();
      if (res && res.ok && res.urls) Object.keys(res.urls).forEach((k) => { map[k] = res.urls[k]; });
    }
  } catch (e) { /* 回退相对路径 */ }
  BUILTIN_BGS.forEach((item) => { if (!map[item.file]) map[item.file] = builtinBgUrlFallback(item.file); });
  builtinUrlMap = map;
  return map;
}

function renderBuiltinBgs() {
  const box = $('timerBgBuiltin');
  if (!box) return;
  if (!builtinUrlMap) {
    ensureBuiltinUrls().then(() => renderBuiltinBgs()).catch(() => {});
    return;
  }
  const mode = readTimerBgMode();
  const current = readTimerBg();
  box.innerHTML = '';
  BUILTIN_BGS.forEach((item) => {
    const url = builtinBgUrl(item.file);
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'timer-bg-chip bg-builtin-chip' + (mode === 'custom' && current && current.url === url ? ' on' : '');
    chip.title = item.name + '（静音循环）';
    const thumb = document.createElement('img');
    thumb.className = 'timer-bg-chip__thumb';
    thumb.alt = '';
    videoThumb(url).then((pic) => { if (pic && thumb.isConnected) thumb.src = pic; });
    const label = document.createElement('span');
    label.className = 'bg-builtin-chip__name';
    label.textContent = item.name;
    chip.appendChild(thumb);
    chip.appendChild(label);
    chip.addEventListener('click', () => {
      setTimerBackground({ url: url, name: item.name, ext: '.mp4', builtin: true });
      toast('已切换到' + item.name);
    });
    box.appendChild(chip);
  });
}

async function deleteTimerBg(cfg) {
  if (!cfg || !cfg.url) return;
  const label = cfg.name || '未命名背景';
  if (typeof window.confirm === 'function' && !window.confirm('删除已导入的背景「' + label + '」？')) return;
  saveTimerBgList(readTimerBgList().filter((x) => x.url !== cfg.url));
  const current = readTimerBg();
  if (current && current.url === cfg.url) setTimerBackground(null);
  else applyTimerBackground();
  if (bridge.deleteTimerBackground) {
    try { await bridge.deleteTimerBackground(cfg.url); } catch (e) { /* 忽略 */ }
  }
  toast('已删除背景');
}

function selectTimerBg(cfg) {
  if (!cfg || !cfg.url) return;
  try {
    localStorage.setItem(TIMER_BG_KEY, JSON.stringify(cfg));
    localStorage.setItem(TIMER_BG_MODE_KEY, 'custom');
  } catch (e) { /* 忽略 */ }
  applyTimerBackground();
}

function handleTimerBgError() {
  const current = readTimerBg();
  if (current && current.url) {
    saveTimerBgList(readTimerBgList().filter((x) => x.url !== current.url));
  }
  setTimerBackground(null);
}

function readTimerBgMode() {
  let mode = '';
  try { mode = localStorage.getItem(TIMER_BG_MODE_KEY) || ''; } catch (e) { /* 忽略 */ }
  // 纯黑 / 纯白背景已下线：历史数据统一回落到主题背景
  if (mode === 'black' || mode === 'white') mode = 'theme';
  if (!['theme', 'custom'].includes(mode)) {
    mode = readTimerBg() ? 'custom' : 'theme';
  }
  if (mode === 'custom' && !readTimerBg()) mode = 'theme';
  return mode;
}

function updateTimerBgUi(mode, media) {
  const panel = $('pageTimer');
  if (panel) panel.setAttribute('data-bg', mode);
  const name = $('timerBgName');
  if (name) {
    if (mode === 'custom' && media) name.textContent = '当前：' + (media.name || '自定义背景');
    else name.textContent = '当前：主题默认背景';
  }
  document.querySelectorAll('.timer-bg-opt').forEach((btn) => {
    btn.classList.toggle('on', btn.dataset.bgMode === mode);
  });
}

/* 点名 / 分组页复用课堂计时的背景：自定义图片或视频整窗铺满 */
function applyClassroomBackground(mode, media) {
  const img = $('clsBgImg');
  const video = $('clsBgVideo');
  if (!img || !video) return;
  document.body.setAttribute('data-cls-bg', mode);
  if (mode === 'custom' && media) {
    const isVideo = /\.(mp4|webm)(\?|$)/i.test(media.url);
    if (isVideo) {
      img.hidden = true;
      img.removeAttribute('src');
      video.hidden = false;
      video.src = media.url;
      video.muted = true;
      video.loop = true;
      const p = video.play();
      if (p && p.catch) p.catch(() => { /* 等用户交互 */ });
    } else {
      video.pause();
      video.hidden = true;
      video.removeAttribute('src');
      img.hidden = false;
      img.src = media.url;
    }
  } else {
    img.hidden = true;
    img.removeAttribute('src');
    video.pause();
    video.hidden = true;
    video.removeAttribute('src');
  }
}

/* 视频背景：抽一帧当缩略图（多时间点取最亮的一帧，结果缓存） */
const videoThumbCache = new Map();
function videoThumb(url) {
  if (!url) return Promise.resolve('');
  if (videoThumbCache.has(url)) return Promise.resolve(videoThumbCache.get(url));
  const pending = new Promise((resolve) => {
    const v = document.createElement('video');
    const canvas = document.createElement('canvas');
    canvas.width = 184;
    canvas.height = 128;
    const ctx = canvas.getContext('2d');
    let done = false;
    let best = '';
    let bestScore = -1;
    let idx = 0;
    let times = [0.6, 1.2, 2, 3];
    const finish = (val) => {
      if (done) return;
      done = true;
      clearTimeout(guard);
      v.removeAttribute('src');
      try { v.load(); } catch (err) { /* 忽略 */ }
      videoThumbCache.set(url, val);
      resolve(val);
    };
    const probe = () => {
      if (idx >= times.length) { finish(best); return; }
      try { v.currentTime = times[idx]; } catch (err) { finish(best); }
    };
    const guard = setTimeout(() => finish(best), 6000);
    v.muted = true;
    v.playsInline = true;
    v.preload = 'auto';
    v.addEventListener('error', () => finish(''), { once: true });
    v.addEventListener('loadedmetadata', () => {
      const d = Number.isFinite(v.duration) && v.duration > 0 ? v.duration : 4;
      times = [d * 0.08, d * 0.3, d * 0.55, d * 0.8].map((x) => Math.max(0.1, x));
      probe();
    }, { once: true });
    v.addEventListener('seeked', () => {
      try {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(v, 0, 0, canvas.width, canvas.height);
        const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
        let sum = 0;
        for (let i = 0; i < data.length; i += 4 * 97) {
          sum += data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114;
        }
        const score = sum / Math.ceil(data.length / (4 * 97));
        if (score > bestScore) {
          bestScore = score;
          best = canvas.toDataURL('image/png');
        }
        // 已经够亮就直接用，省掉后面的取帧
        if (score > 92 || idx >= times.length - 1) { finish(best); return; }
      } catch (err) { finish(best); return; }
      idx += 1;
      probe();
    });
    v.src = url;
    try { v.load(); } catch (err) { finish(''); }
  });
  videoThumbCache.set(url, pending);
  return pending;
}

/* 更换背景按钮的图画预览：图片缩略图 / 主题渐变 / 纯黑纯白色块 / 视频首帧 */
function syncBgPics(mode, media) {
  const isVideo = mode === 'custom' && media && /\.(mp4|webm)(\?|$)/i.test(media.url);
  const state = mode === 'custom' && media ? (isVideo ? 'video' : 'custom') : mode;
  const label = mode === 'custom' && media ? (media.name || '自定义背景')
    : mode === 'black' ? '纯黑背景'
      : mode === 'white' ? '纯白背景' : '主题背景';
  document.querySelectorAll('.bg-picbtn').forEach((btn) => {
    btn.dataset.bgmode = state;
    btn.title = label + ' · 点击更换背景';
    btn.setAttribute('aria-label', '更换背景（当前：' + label + '）');
    const img = btn.querySelector('.bg-picbtn__img');
    if (!img) return;
    if (state === 'custom') {
      img.hidden = false;
      img.src = media.url;
    } else if (state === 'video') {
      img.hidden = false;
      const src = media.url;
      videoThumb(src).then((pic) => {
        if (!pic || btn.dataset.bgmode !== 'video' || btn.querySelector('.bg-picbtn__img') !== img) return;
        img.src = pic;
      });
    } else {
      img.hidden = true;
      img.removeAttribute('src');
    }
  });
}

function applyTimerBackground() {
  const img = $('timerBgImg');
  const video = $('timerBgVideo');
  if (!img || !video) return;
  const mode = readTimerBgMode();
  const media = readTimerBg();
  if (mode === 'custom' && media) {
    const isVideo = /\.(mp4|webm)(\?|$)/i.test(media.url);
    if (isVideo) {
      img.hidden = true;
      img.removeAttribute('src');
      video.hidden = false;
      video.src = media.url;
      video.muted = true;
      video.loop = true;
      if (!$('pageTimer').hidden) {
        const p = video.play();
        if (p && p.catch) p.catch(() => { /* 等用户交互或加载完成 */ });
      }
    } else {
      video.pause();
      video.hidden = true;
      video.removeAttribute('src');
      img.hidden = false;
      img.src = media.url;
    }
  } else {
    img.hidden = true;
    img.removeAttribute('src');
    video.pause();
    video.hidden = true;
    video.removeAttribute('src');
  }
  updateTimerBgUi(mode, media);
  applyClassroomBackground(mode, media);
  syncBgPics(mode, media);
  renderTimerBgList();
  renderBuiltinBgs();
}

function setTimerBgMode(mode) {
  const next = ['theme', 'custom'].includes(mode) ? mode : 'theme';
  try { localStorage.setItem(TIMER_BG_MODE_KEY, next); } catch (e) { /* 忽略 */ }
  applyTimerBackground();
}

function setTimerBackground(cfg) {
  try {
    if (cfg) {
      localStorage.setItem(TIMER_BG_KEY, JSON.stringify(cfg));
      localStorage.setItem(TIMER_BG_MODE_KEY, 'custom');
    } else {
      localStorage.removeItem(TIMER_BG_KEY);
      localStorage.setItem(TIMER_BG_MODE_KEY, 'theme');
    }
  } catch (e) { /* 忽略 */ }
  applyTimerBackground();
}

async function pickTimerBackground() {
  if (!bridge.pickTimerBackground) { toast('当前版本不支持导入背景'); return; }
  try {
    const res = await bridge.pickTimerBackground();
    if (!res || !res.ok) {
      if (res && !res.canceled) toast(res.error || '导入失败');
      return;
    }
    const cfg = { url: res.url, name: res.name, ext: res.ext };
    rememberTimerBg(cfg);
    setTimerBackground(cfg);
    toast(/^(mp4|webm)$/i.test(res.ext) ? '背景已更新，全屏时循环播放' : '背景已更新');
  } catch (e) {
    toast('导入失败');
  }
}



/* 课堂内的标签切换：计时页占满整个窗口 */
function activateTab(name) {
  document.querySelectorAll('.cls-tab').forEach((t) => t.classList.toggle('on', t.dataset.tab === name));
  $('pageRoll').hidden = name !== 'roll';
  $('pageGroup').hidden = name !== 'group';
  $('pageTimer').hidden = name !== 'timer';
  document.body.classList.toggle('timer-page', name === 'timer');
  if (name !== 'timer') {
    cancelTimerFullscreen();
    $('timerBgPanel').hidden = true;
  }
  $('timerBgPanel').hidden = true;
  const bgVideo = $('timerBgVideo');
  if (bgVideo && !bgVideo.hidden) {
    if (name === 'timer') {
      const p = bgVideo.play();
      if (p && p.catch) p.catch(() => { /* 忽略 */ });
    } else {
      bgVideo.pause();
    }
  }
  if (name === 'timer') renderTimer();
  if (name === 'group') renderGroupPlaceholder();
}

/* ---------------- 事件绑定 ---------------- */
function bindStaticEvents() {
  $('btnBackHome').addEventListener('click', () => bridge.closeClassroom());
  $('btnRoll').addEventListener('click', rollOnce);

  // 抽取人数
  renderDrawCount();
  $('btnCountMinus').addEventListener('click', () => {
    state.drawCount = Math.max(1, state.drawCount - 1);
    renderDrawCount();
    try { localStorage.setItem('cls-draw-count', String(state.drawCount)); } catch (e) { /* 忽略 */ }
  });
  $('btnCountPlus').addEventListener('click', () => {
    state.drawCount = Math.min(maxDrawCount(), state.drawCount + 1);
    renderDrawCount();
    try { localStorage.setItem('cls-draw-count', String(state.drawCount)); } catch (e) { /* 忽略 */ }
  });

  // 朗读 / 静音开关（互斥，保存在本机）
  try { state.voice = localStorage.getItem('cls-voice') === '1'; } catch (e) { state.voice = false; }
  try { state.mute = localStorage.getItem('cls-mute') === '1'; } catch (e) { state.mute = false; }
  if (state.mute) state.voice = false;
  $('voiceToggle').checked = state.voice;
  $('muteToggle').checked = state.mute;
  $('voiceToggle').addEventListener('change', (e) => {
    state.voice = !!e.target.checked;
    if (state.voice && state.mute) {
      state.mute = false;
      $('muteToggle').checked = false;
      try { localStorage.setItem('cls-mute', '0'); } catch (err) { /* 忽略 */ }
    }
    try { localStorage.setItem('cls-voice', state.voice ? '1' : '0'); } catch (err) { /* 忽略 */ }
    if (state.voice) speakName('朗读已开启');
  });
  $('muteToggle').addEventListener('change', (e) => {
    state.mute = !!e.target.checked;
    if (state.mute) {
      state.voice = false;
      $('voiceToggle').checked = false;
      try { localStorage.setItem('cls-voice', '0'); } catch (err) { /* 忽略 */ }
      if (window.speechSynthesis) {
        try { window.speechSynthesis.cancel(); } catch (err) { /* 忽略 */ }
      }
    }
    try { localStorage.setItem('cls-mute', state.mute ? '1' : '0'); } catch (err) { /* 忽略 */ }
    toast(state.mute ? '已开启静音模式，点名不再朗读' : '已关闭静音模式');
  });

  // 一轮不重复
  $('noRepeatToggle').checked = state.noRepeat;
  $('noRepeatToggle').addEventListener('change', (e) => {
    state.noRepeat = !!e.target.checked;
    try { localStorage.setItem('cls-no-repeat', state.noRepeat ? '1' : '0'); } catch (err) { /* 忽略 */ }
    resetStage();
    toast(state.noRepeat ? '已开启一轮不重复' : '已关闭一轮不重复');
  });

  // 一键重置抽取次数（重复 / 不重复）
  $('btnResetDraw').addEventListener('click', async () => {
    const roster = activeRoster();
    if (!roster) return toast('请先在左侧选择名单');
    if (state.drawing) return;
    if (!bridge.classroomResetDraw) return toast('当前版本不支持重置');
    try {
      const res = await bridge.classroomResetDraw(roster.id);
      if (!res || !res.ok) return toast((res && res.error) || '重置失败');
      await reload();
      resetStage();
      toast('已重置抽取次数，重复与不重复模式都已刷新');
    } catch (e) {
      toast('重置失败：' + e.message);
    }
  });

  // 全屏 / 分组 / 计时
  $('btnFull').addEventListener('click', () => setClassFullscreen(true));
  $('btnExitFull').addEventListener('click', () => setClassFullscreen(false));
  $('btnGroupGenerate').addEventListener('click', generateGroups);
  $('btnGroupMinus').addEventListener('click', () => changeGroupValue(-1));
  $('btnGroupPlus').addEventListener('click', () => changeGroupValue(1));
  $('groupMode').addEventListener('change', (e) => {
    state.groupMode = e.target.value;
    renderGroupPlaceholder();
  });
  $('btnTimerStart').addEventListener('click', toggleTimer);
  $('btnTimerPause').addEventListener('click', toggleTimer);
  $('btnTimerReset').addEventListener('click', resetTimer);
  $('btnTimerFull').addEventListener('click', enterTimerFullscreen);
  $('btnTimerExit').addEventListener('click', exitTimerFullscreen);
  $('btnTimerBack').addEventListener('click', () => activateTab('roll'));
  $('timerMode').addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-mode]');
    if (btn) setTimerMode(btn.dataset.mode);
  });
  $('timerFixed').addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-sec]');
    if (!btn) return;
    applyTimerSeconds(Number(btn.dataset.sec) || 300, `已选择 ${btn.textContent.trim()}`);
  });
  document.querySelectorAll('.timer-digit-col button').forEach((btn) => {
    btn.addEventListener('click', () => stepTimer(Number(btn.dataset.step) || 0));
  });
  /* 全屏时点击空白处退出（按钮和数字区域除外） */
  $('pageTimer').addEventListener('click', (e) => {
    if (!state.timer.full) return;
    if (e.target.closest('button') || e.target.closest('.timer-clock')) return;
    exitTimerFullscreen();
  });
  renderTimer();
  bindAppearance();

  document.querySelectorAll('.cls-tab').forEach((tab) => {
    tab.addEventListener('click', () => activateTab(tab.dataset.tab));
  });

  $('btnAdmin') && $('btnAdmin').addEventListener('click', openAdmin);
  if (bridge.onAdminOpen) bridge.onAdminOpen(() => openAdmin());
  document.querySelectorAll('[data-close="admin"]').forEach((el) => el.addEventListener('click', closeAdmin));

  $('btnImportRoster').addEventListener('click', () => $('fileRoster').click());
  $('fileRoster').addEventListener('change', async (e) => {
    const paths = filesToPaths(e.target.files);
    e.target.value = '';
    await importPaths(paths);
  });
  $('btnNewRoster').addEventListener('click', openRosterDialog);
  $('btnDeleteRoster').addEventListener('click', openDeleteRosterDialog);
  document.querySelectorAll('[data-close="roster"]').forEach((el) => el.addEventListener('click', closeRosterDialog));
  document.querySelectorAll('[data-close="rosterDelete"]').forEach((el) => el.addEventListener('click', closeDeleteRosterDialog));
  $('btnTrashConfirm').addEventListener('click', confirmDeleteRosters);
  $('btnRosterFill').addEventListener('click', applyRosterFill);
  $('rosterFillCount').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); applyRosterFill(); }
  });
  $('btnRosterNext').addEventListener('click', submitRosterName);
  $('rosterNameInput').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); submitRosterName(); }
  });
  $('rosterNamesInput').addEventListener('input', () => {
    resetFillButton();
    updateRosterDraftCount();
  });
  $('rosterNamesInput').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); saveRosterDraft(); }
  });
  $('btnRosterBack').addEventListener('click', () => setRosterStep('name'));
  $('btnRosterSave').addEventListener('click', saveRosterDraft);

  const pane = $('rosterPane');
  pane.addEventListener('dragenter', (e) => {
    e.preventDefault();
    pane.classList.add('drag');
  });
  pane.addEventListener('dragover', (e) => {
    e.preventDefault();
    pane.classList.add('drag');
  });
  pane.addEventListener('dragleave', (e) => {
    if (!pane.contains(e.relatedTarget)) pane.classList.remove('drag');
  });
  pane.addEventListener('drop', async (e) => {
    e.preventDefault();
    pane.classList.remove('drag');
    const paths = filesToPaths(e.dataTransfer.files);
    await importPaths(paths);
  });
  ['dragover', 'drop'].forEach((ev) => {
    window.addEventListener(ev, (e) => {
      if (!pane.contains(e.target)) e.preventDefault();
    });
  });

  bridge.onSkinChanged((data) => {
    if (data && SKINS.includes(data.skin)) document.body.setAttribute('data-skin', data.skin);
  });

  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (state.timer.full) {
      e.preventDefault();
      exitTimerFullscreen();
      return;
    }
    if (!$('rosterDeleteModal').hidden) return closeDeleteRosterDialog();
    if (!$('rosterModal').hidden) return closeRosterDialog();
    if (!$('adminModal').hidden) return closeAdmin();
    if (state.classFull) {
      e.preventDefault();
      setClassFullscreen(false);
      return;
    }
    bridge.closeClassroom();
  });
}

/* ---------------- 浏览器预览兜底 ---------------- */
function createMockBridge() {
  const KEY = 'classroom-mock-store';
  const defaultTt = {
    title: '我的课程表',
    days: DAYS.slice(),
    periods: ['08:00-08:45', '08:55-09:40', '10:00-10:45', '10:55-11:40', '14:00-14:45', '14:55-15:40', '16:00-16:45']
      .map((time, i) => ({ id: 'p' + (i + 1), label: `第${i + 1}节`, time, cells: ['', '', '', '', '', '', ''] }))
  };
  let store;
  try {
    store = JSON.parse(localStorage.getItem(KEY) || 'null');
  } catch (e) { store = null; }
  if (!store) {
    store = {
      activeRosterId: 'r1',
      passwordHash: '',
      debugMode: false,
      rosters: [
        { id: 'r1', name: '示例班级', createdAt: Date.now(), lastPickId: '', names: ['张三', '李四', '王五', '赵六'].map((n, i) => ({ id: 'n' + i, name: n, weight: 1, count: 0, pickedAt: 0 })) }
      ],
      trash: [],
      timetable: defaultTt
    };
  }
  const save = () => localStorage.setItem(KEY, JSON.stringify(store));
  const pub = () => ({
    activeRosterId: store.activeRosterId,
    rosters: store.rosters.map((r) => ({ id: r.id, name: r.name, names: r.names.map((n) => ({ id: n.id, name: n.name })) })),
    trash: (store.trash || []).map((t) => ({
      id: t.roster.id,
      name: t.roster.name,
      count: t.roster.names.length,
      deletedAt: t.deletedAt,
      expiresAt: t.deletedAt + 3 * 86400000
    })),
    timetable: store.timetable,
    hasPassword: !!store.passwordHash,
    unlocked: false,
    debugMode: !!store.debugMode
  });
  const admin = () => {
    const d = pub();
    d.rosters = store.rosters.map((r) => ({ ...r, names: r.names.map((n) => ({ ...n })) }));
    return d;
  };
  return {
    classroomGet: async () => pub(),
    classroomAdminStatus: async () => ({ hasPassword: !!store.passwordHash, unlocked: false }),
    classroomAdminData: async () => ({ ok: false, error: '浏览器预览不可用' }),
    classroomAdminSetup: async (pw) => { store.passwordHash = pw; save(); return { ok: true, data: admin() }; },
    classroomAdminLogin: async (pw) => (store.passwordHash === pw ? { ok: true, data: admin() } : { ok: false, error: '密码不正确' }),
    classroomAdminLock: async () => ({ ok: true }),
    classroomChangePassword: async () => ({ ok: true }),
    classroomImportRosters: async () => ({ ok: false, created: [], errors: ['浏览器预览不支持导入文件'] }),
    classroomCreateRoster: async (name, text) => {
      const rosterName = String(name || '').trim() || '新名单';
      if (store.rosters.some((x) => x.name === rosterName)) return { ok: false, error: '已有同名名单，请换一个名称' };
      const names = parseDraftNames(text);
      const r = {
        id: 'r' + Date.now(),
        name: rosterName,
        createdAt: Date.now(),
        lastPickId: '',
        names: names.map((n, i) => ({ id: 'n' + Date.now() + i, name: n, weight: 1, count: 0, pickedAt: 0 }))
      };
      store.rosters.push(r);
      store.activeRosterId = r.id;
      save();
      return { ok: true, rosterId: r.id, count: r.names.length, data: pub() };
    },
    classroomDeleteRosters: async (ids) => {
      const list = Array.isArray(ids) ? ids : [];
      if (!store.trash) store.trash = [];
      const now = Date.now();
      const removed = store.rosters.filter((x) => list.includes(x.id));
      store.rosters = store.rosters.filter((x) => !list.includes(x.id));
      removed.forEach((roster) => store.trash.unshift({ roster, deletedAt: now }));
      if (!store.rosters.some((x) => x.id === store.activeRosterId)) {
        store.activeRosterId = store.rosters.length ? store.rosters[0].id : '';
      }
      save();
      return { ok: true, deleted: removed.length, data: pub() };
    },
    classroomRestoreRosters: async (ids) => {
      const list = Array.isArray(ids) ? ids : [];
      if (!store.trash) store.trash = [];
      const restored = [];
      store.trash = store.trash.filter((t) => {
        if (!list.includes(t.roster.id)) return true;
        store.rosters.push(t.roster);
        restored.push(t.roster);
        return false;
      });
      if (!store.rosters.some((x) => x.id === store.activeRosterId)) {
        store.activeRosterId = store.rosters.length ? store.rosters[0].id : '';
      }
      save();
      return { ok: true, restored: restored.length, data: pub() };
    },
    classroomSetActive: async (id) => { store.activeRosterId = id; save(); return { ok: true }; },
    classroomRenameRoster: async () => ({ ok: false, error: '浏览器预览不可用' }),
    classroomDeleteRoster: async () => ({ ok: false, error: '浏览器预览不可用' }),
    classroomAddNames: async () => ({ ok: false, error: '浏览器预览不可用' }),
    classroomUpdateName: async () => ({ ok: false, error: '浏览器预览不可用' }),
    classroomRemoveName: async () => ({ ok: false, error: '浏览器预览不可用' }),
    classroomResetCounts: async () => ({ ok: false, error: '浏览器预览不可用' }),
    classroomDraw: async (id, count = 1) => {
      const r = store.rosters.find((x) => x.id === id);
      if (!r || !r.names.length) return { ok: false, error: '名单为空' };
      const pool = r.names.slice();
      const want = Math.max(1, Math.min(count || 1, pool.length));
      const picked = [];
      for (let i = 0; i < want && pool.length; i++) {
        const total = pool.reduce((sum, n) => sum + (Number(n.weight) || 1), 0);
        let roll = Math.random() * total;
        let idx = pool.length - 1;
        for (let j = 0; j < pool.length; j++) {
          roll -= Number(pool[j].weight) || 1;
          if (roll <= 0) { idx = j; break; }
        }
        const n = pool.splice(idx, 1)[0];
        n.count += 1;
        picked.push(n.name);
      }
      save();
      return { ok: true, name: picked[0], names: picked, roster: r.name };
    },
    classroomClearHistory: async () => ({ ok: false, error: '浏览器预览不可用' }),
    classroomRestoreHistory: async () => ({ ok: false, error: '浏览器预览不可用' }),
    classroomSaveTimetable: async (t) => { store.timetable = t; save(); return { ok: true, timetable: t }; },
    classroomParseSheet: async () => ({ ok: false, error: '浏览器预览不可用' }),
    adminSetDebug: async (on) => { store.debugMode = !!on; save(); return { ok: true, debugMode: !!on }; },
    adminTriggerDraw: async () => ({ ok: true }),
    getFilePath: () => '',
    closeClassroom: () => window.close(),
    onSkinChanged: () => {},
    onAdminOpen: () => {}
  };
}

boot();
