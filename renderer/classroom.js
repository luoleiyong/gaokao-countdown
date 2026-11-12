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
  drawing: false,
  ttRows: null,
  ttFile: null,
  debugMode: false,
  voice: false,
  mute: false,
  noRepeat: false,
  drawCount: 1,
  projection: false,
  groupMode: 'count',
  groupValue: 4,
  timer: { total: 300, left: 300, running: false, tick: null }
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
  body.innerHTML =
    `<p class="admin-hint">管理员模式可修改名单名称、修改学生姓名、查看被抽中次数，并为每位学生单独设置抽取权重（0.1 – 10，权重越高越容易被抽到）。</p>
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
                <td><input type="number" class="admin-weight" data-role="weight" min="0.1" max="10" step="0.1" value="${n.weight}" /></td>
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

/* ---------------- 全屏投影 ---------------- */
async function setProjection(on) {
  state.projection = !!on;
  document.body.classList.toggle('projection', state.projection);
  try {
    if (bridge.setFullScreen) await bridge.setFullScreen(state.projection);
  } catch (e) { /* 忽略 */ }
  if (state.projection) toast('投影模式 · 按 Esc 退出');
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

function renderTimer() {
  $('timerDisplay').textContent = fmtTimer(state.timer.left);
  $('btnTimerStart').textContent = state.timer.running
    ? '暂停'
    : (state.timer.left < state.timer.total && state.timer.left > 0 ? '继续计时' : '开始计时');
  document.body.classList.toggle('timer-running', state.timer.running);
}

function stopTimerTick() {
  if (state.timer.tick) {
    clearInterval(state.timer.tick);
    state.timer.tick = null;
  }
}

function setTimerMinutes(min) {
  stopTimerTick();
  state.timer.running = false;
  state.timer.total = Math.max(60, (Number(min) || 5) * 60);
  state.timer.left = state.timer.total;
  renderTimer();
  $('timerTip').textContent = `已选择 ${Math.round(state.timer.total / 60)} 分钟`;
}

function onTimerDone() {
  if (window.GkSound) {
    try {
      GkSound.unlock();
      GkSound.playDrawDone();
    } catch (e) { /* 忽略 */ }
  }
  toast('时间到！');
  document.body.classList.add('timer-flash');
  setTimeout(() => document.body.classList.remove('timer-flash'), 1600);
  if (bridge.log) bridge.log('TIMER_DONE', { total: state.timer.total });
}

function toggleTimer() {
  if (state.timer.running) {
    stopTimerTick();
    state.timer.running = false;
    renderTimer();
    $('timerTip').textContent = '已暂停';
    return;
  }
  if (state.timer.left <= 0) state.timer.left = state.timer.total;
  state.timer.running = true;
  state.timer.tick = setInterval(() => {
    state.timer.left -= 1;
    if (state.timer.left <= 0) {
      state.timer.left = 0;
      stopTimerTick();
      state.timer.running = false;
      renderTimer();
      onTimerDone();
      return;
    }
    renderTimer();
  }, 1000);
  renderTimer();
  $('timerTip').textContent = '计时中…';
}

function resetTimer() {
  stopTimerTick();
  state.timer.running = false;
  state.timer.left = state.timer.total;
  renderTimer();
  $('timerTip').textContent = '已重置';
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

  // 投影 / 分组 / 计时
  $('btnProjection').addEventListener('click', () => setProjection(!state.projection));
  $('btnGroupGenerate').addEventListener('click', generateGroups);
  $('btnGroupMinus').addEventListener('click', () => changeGroupValue(-1));
  $('btnGroupPlus').addEventListener('click', () => changeGroupValue(1));
  $('groupMode').addEventListener('change', (e) => {
    state.groupMode = e.target.value;
    renderGroupPlaceholder();
  });
  $('btnTimerStart').addEventListener('click', toggleTimer);
  $('btnTimerReset').addEventListener('click', resetTimer);
  $('timerPresets').addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-min]');
    if (!btn) return;
    $('timerPresets').querySelectorAll('button').forEach((b) => b.classList.toggle('on', b === btn));
    setTimerMinutes(Number(btn.dataset.min) || 5);
  });

  document.querySelectorAll('.cls-tab').forEach((tab) => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.cls-tab').forEach((t) => t.classList.toggle('on', t === tab));
      const name = tab.dataset.tab;
      $('pageRoll').hidden = name !== 'roll';
      $('pageGroup').hidden = name !== 'group';
      $('pageTimer').hidden = name !== 'timer';
      if (name === 'group') renderGroupPlaceholder();
    });
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
  $('btnNewRoster').addEventListener('click', async () => {
    let res;
    try {
      res = await bridge.classroomCreateRoster('新名单');
    } catch (err) {
      return toast('新建失败');
    }
    if (!res || !res.ok) return toast('新建失败');
    state.data = res.data;
    state.data.activeRosterId = res.rosterId;
    await bridge.classroomSetActive(res.rosterId);
    renderRosterList();
    resetStage();
    toast('已新建空名单，可在管理员模式中添加学生');
  });

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
    if (!$('adminModal').hidden) return closeAdmin();
    if (state.projection) return setProjection(false);
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
      timetable: defaultTt
    };
  }
  const save = () => localStorage.setItem(KEY, JSON.stringify(store));
  const pub = () => ({
    activeRosterId: store.activeRosterId,
    rosters: store.rosters.map((r) => ({ id: r.id, name: r.name, names: r.names.map((n) => ({ id: n.id, name: n.name })) })),
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
    classroomCreateRoster: async (name) => {
      const r = { id: 'r' + Date.now(), name: name || '新名单', createdAt: Date.now(), lastPickId: '', names: [] };
      store.rosters.push(r);
      save();
      return { ok: true, rosterId: r.id, data: pub() };
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
      for (let i = 0; i < want; i++) {
        const idx = Math.floor(Math.random() * pool.length);
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
