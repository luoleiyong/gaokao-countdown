'use strict';

(function () {
  const api = window.gaokao;
  const $ = (id) => document.getElementById(id);
  const logEl = $('tpLog');
  const lines = [];

  function log(text) {
    const t = new Date();
    const stamp = `${String(t.getHours()).padStart(2, '0')}:${String(t.getMinutes()).padStart(2, '0')}:${String(t.getSeconds()).padStart(2, '0')}`;
    lines.push(`${stamp}  ${text}`);
    while (lines.length > 6) lines.shift();
    logEl.textContent = lines.join('\n');
    logEl.scrollTop = logEl.scrollHeight;
  }

  function labelOf(btn) {
    return (btn.textContent || '').trim() || btn.dataset.test;
  }

  async function send(action, label) {
    if (!api || !api.testRun) { log('当前环境不支持测试命令'); return; }
    log('执行：' + label);
    try {
      const res = await api.testRun(action);
      if (res && res.ok === false) log('失败：' + (res.error || '未知错误'));
    } catch (e) {
      log('失败：' + (e && e.message ? e.message : e));
    }
  }

  $('tpBody').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-test]');
    if (!btn) return;
    send(btn.dataset.test, labelOf(btn));
  });

  $('tpClose').addEventListener('click', () => {
    if (api && api.closeTestPanel) api.closeTestPanel();
  });

  $('tpShowMain').addEventListener('click', () => send('showmain', '显示主界面'));

  if (api && api.getInit) {
    api.getInit().then((init) => {
      if (init && init.version) $('tpVer').textContent = 'v' + init.version;
    }).catch(() => { /* 忽略 */ });
  } else {
    $('tpVer').textContent = 'preview';
  }
})();
