/* AI 助手会话存储：主界面与知识窗口共用同一份数据（localStorage）
   数据结构：{ v:1, currentId, sessions:[{ id, title, createdAt, updatedAt, messages:[...] }] }
   消息结构与 knowledge.js 的 aiHistory 一致：{ role:'user'|'assistant', text, request, reasoning, search, model, providerName, audit, ms, error, stopped, ts } */
(function () {
  'use strict';
  var KEY = 'gk-ai-sessions-v1';
  var LEGACY = 'gk-ai-chat-v1';
  var MAX_SESSIONS = 60;
  var MAX_MESSAGES = 200;

  function uid() {
    return 's' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  }
  function textOf(msg) {
    if (!msg || typeof msg !== 'object') return '';
    var t = typeof msg.text === 'string' ? msg.text : '';
    if (!t && msg.request && typeof msg.request === 'object') {
      t = String(msg.request.topic || msg.request.query || '');
    }
    return t;
  }
  function titleFromMessages(messages, fallback) {
    var list = Array.isArray(messages) ? messages : [];
    for (var i = 0; i < list.length; i++) {
      if (list[i] && list[i].role === 'user') {
        var t = textOf(list[i]).replace(/\s+/g, ' ').trim();
        if (t) return t.length > 22 ? t.slice(0, 22) + '…' : t;
      }
    }
    return fallback || '新对话';
  }
  function normalizeMessage(m) {
    if (!m || typeof m !== 'object') return null;
    var role = m.role === 'user' ? 'user' : 'assistant';
    var out = {
      role: role,
      text: typeof m.text === 'string' ? m.text : '',
      ts: Number(m.ts) || Date.now()
    };
    if (m.request && typeof m.request === 'object') out.request = m.request;
    if (typeof m.reasoning === 'string' && m.reasoning) out.reasoning = m.reasoning;
    if (m.search && typeof m.search === 'object') out.search = m.search;
    if (m.model) out.model = String(m.model);
    if (m.providerName) out.providerName = String(m.providerName);
    if (m.audit && typeof m.audit === 'object') out.audit = m.audit;
    if (typeof m.ms === 'number') out.ms = m.ms;
    if (typeof m.error === 'string' && m.error) out.error = m.error;
    if (m.stopped) out.stopped = true;
    if (m.usage && typeof m.usage === 'object') out.usage = m.usage;
    return out;
  }
  function normalizeSession(s, idx) {
    if (!s || typeof s !== 'object') return null;
    var msgs = (Array.isArray(s.messages) ? s.messages : []).map(normalizeMessage).filter(Boolean);
    if (msgs.length > MAX_MESSAGES) msgs = msgs.slice(msgs.length - MAX_MESSAGES);
    var id = typeof s.id === 'string' && s.id ? s.id : uid();
    var createdAt = Number(s.createdAt) || Date.now();
    return {
      id: id,
      title: typeof s.title === 'string' && s.title.trim() ? s.title.trim().slice(0, 40) : titleFromMessages(msgs, '对话 ' + (idx + 1)),
      createdAt: createdAt,
      updatedAt: Number(s.updatedAt) || createdAt,
      messages: msgs
    };
  }
  function emptyState() {
    return { v: 1, currentId: '', sessions: [] };
  }
  function migrateLegacy(state) {
    var raw = null;
    try { raw = localStorage.getItem(LEGACY); } catch (e) { raw = null; }
    if (!raw) return false;
    var arr = null;
    try { arr = JSON.parse(raw); } catch (e) { arr = null; }
    if (!Array.isArray(arr) || !arr.length) return false;
    var msgs = arr.map(normalizeMessage).filter(Boolean);
    if (!msgs.length) return false;
    var now = Date.now();
    var s = { id: uid(), title: titleFromMessages(msgs, '历史对话'), createdAt: now, updatedAt: now, messages: msgs };
    state.sessions.unshift(s);
    state.currentId = s.id;
    return true;
  }
  function load() {
    var state = emptyState();
    var raw = null;
    try { raw = localStorage.getItem(KEY); } catch (e) { raw = null; }
    if (raw) {
      var data = null;
      try { data = JSON.parse(raw); } catch (e) { data = null; }
      if (data && Array.isArray(data.sessions)) {
        state.sessions = data.sessions.map(normalizeSession).filter(Boolean);
        if (typeof data.currentId === 'string') state.currentId = data.currentId;
      }
    }
    var migrated = migrateLegacy(state);
    if (!state.sessions.length) {
      var now = Date.now();
      state.sessions = [{ id: uid(), title: '新对话', createdAt: now, updatedAt: now, messages: [] }];
      state.currentId = state.sessions[0].id;
    }
    if (!state.sessions.some(function (x) { return x.id === state.currentId; })) {
      state.currentId = state.sessions[0].id;
    }
    if (migrated) {
      /* 迁移只做一次：立刻删掉旧键，避免每次 load 都复制一遍历史（会自我触发事件循环） */
      try { localStorage.removeItem(LEGACY); } catch (e) { /* 忽略 */ }
      save(state, true);
    }
    return state;
  }
  function save(state, silent) {
    try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) { /* 配额满时静默 */ }
    if (silent) return state;
    try { window.dispatchEvent(new CustomEvent('ai-store-changed', { detail: { currentId: state.currentId } })); } catch (e) {}
    return state;
  }
  function get(state, id) {
    var st = state || load();
    for (var i = 0; i < st.sessions.length; i++) if (st.sessions[i].id === id) return st.sessions[i];
    return null;
  }
  function current(state) {
    var st = state || load();
    return get(st, st.currentId) || st.sessions[0] || null;
  }
  function touch(session) {
    if (!session) return;
    session.updatedAt = Date.now();
    if (!session.title || session.title === '新对话') session.title = titleFromMessages(session.messages, session.title || '新对话');
  }
  function create(state, opts) {
    var st = state || load();
    var o = opts || {};
    var now = Date.now();
    var msgs = (Array.isArray(o.messages) ? o.messages : []).map(normalizeMessage).filter(Boolean);
    var s = { id: uid(), title: (o.title || titleFromMessages(msgs, '新对话')).slice(0, 40), createdAt: now, updatedAt: now, messages: msgs };
    st.sessions.unshift(s);
    if (st.sessions.length > MAX_SESSIONS) st.sessions = st.sessions.slice(0, MAX_SESSIONS);
    st.currentId = s.id;
    save(st);
    return s;
  }
  function append(state, msg) {
    var st = state || load();
    var s = current(st);
    if (!s) s = create(st, {});
    var m = normalizeMessage(msg);
    if (m) s.messages.push(m);
    if (s.messages.length > MAX_MESSAGES) s.messages = s.messages.slice(s.messages.length - MAX_MESSAGES);
    touch(s);
    save(st);
    return s;
  }
  function setMessages(state, id, messages) {
    var st = state || load();
    var s = get(st, id || st.currentId);
    if (!s) return null;
    s.messages = (Array.isArray(messages) ? messages : []).map(normalizeMessage).filter(Boolean);
    touch(s);
    save(st);
    return s;
  }
  function rename(state, id, title) {
    var st = state || load();
    var s = get(st, id);
    if (!s) return null;
    s.title = String(title || '').trim().slice(0, 40) || titleFromMessages(s.messages, '新对话');
    save(st);
    return s;
  }
  function remove(state, id) {
    var st = state || load();
    st.sessions = st.sessions.filter(function (x) { return x.id !== id; });
    if (!st.sessions.length) {
      var now = Date.now();
      st.sessions = [{ id: uid(), title: '新对话', createdAt: now, updatedAt: now, messages: [] }];
    }
    if (!st.sessions.some(function (x) { return x.id === st.currentId; })) st.currentId = st.sessions[0].id;
    save(st);
    return st;
  }
  /* 分支：把某个会话「截至第 at 条（含）」复制成一个新会话，原会话不动 */
  function branch(state, id, at) {
    var st = state || load();
    var src = get(st, id || st.currentId);
    if (!src) return null;
    var cut = typeof at === 'number' ? Math.max(0, Math.min(at + 1, src.messages.length)) : src.messages.length;
    var msgs = src.messages.slice(0, cut).map(normalizeMessage).filter(Boolean);
    return create(st, { title: (src.title || '对话') + ' · 分支', messages: msgs });
  }
  function summary(state) {
    var st = state || load();
    return st.sessions.map(function (s) {
      return { id: s.id, title: s.title, updatedAt: s.updatedAt, count: s.messages.length, current: s.id === st.currentId };
    });
  }
  window.AIStore = {
    KEY: KEY,
    LEGACY_KEY: LEGACY,
    load: load,
    save: save,
    get: get,
    current: current,
    create: create,
    append: append,
    setMessages: setMessages,
    rename: rename,
    remove: remove,
    branch: branch,
    summary: summary,
    titleFromMessages: titleFromMessages,
    uid: uid
  };
})();
