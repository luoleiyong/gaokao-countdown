#!/usr/bin/env node
/* 管理员免密 · 图形界面版
 *   node admin-tool\admin-unlock-ui.js              启动后自动打开浏览器
 *   node admin-tool\admin-unlock-ui.js --port 4788 --no-open
 * 只监听 127.0.0.1，POST 需要 X-GK-Tool 头并校验 Origin，避免其它网页借用接口。
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');
const { exec } = require('child_process');
const core = require('./admin-unlock-core.js');

const argv = process.argv.slice(2);
const portAt = argv.indexOf('--port');
const PREFERRED = Number((portAt >= 0 && argv[portAt + 1]) || 4788) || 4788;
const NO_OPEN = argv.indexOf('--no-open') >= 0;
const PAGE_FILE = path.join(__dirname, 'admin-unlock-ui.html');

function send(res, code, obj, isHtml) {
  var body = isHtml ? obj : JSON.stringify(obj);
  res.writeHead(code, {
    'Content-Type': isHtml ? 'text/html; charset=utf-8' : 'application/json; charset=utf-8',
    'Cache-Control': 'no-store'
  });
  res.end(body);
}

function readBody(req) {
  return new Promise(function (resolve) {
    var s = '';
    req.on('data', function (c) { s += c; if (s.length > 8192) req.destroy(); });
    req.on('end', function () { try { resolve(JSON.parse(s || '{}')); } catch (e) { resolve({}); } });
  });
}

var server = http.createServer(async function (req, res) {
  var u = url.parse(req.url, true);
  var port = server.address() ? server.address().port : 0;
  var origin = req.headers.origin;
  if (origin) {
    var allowed = origin === 'http://127.0.0.1:' + port || origin === 'http://localhost:' + port;
    if (!allowed) return send(res, 403, { ok: false, error: 'forbidden origin' });
  }
  if (req.method === 'GET' && (u.pathname === '/' || u.pathname === '/index.html')) {
    try { return send(res, 200, fs.readFileSync(PAGE_FILE, 'utf8'), true); }
    catch (e) { return send(res, 500, '找不到 admin-unlock-ui.html，请把它和本文件放在同一目录。', true); }
  }
  if (req.method === 'GET' && u.pathname === '/api/status') {
    var s = core.readStatus();
    s.hasPassword = core.hasPassword();
    return send(res, 200, s);
  }
  if (req.method === 'POST') {
    if (req.headers['x-gk-tool'] !== '1') return send(res, 403, { ok: false, error: '缺少工具请求头' });
    var body = await readBody(req);
    if (u.pathname === '/api/unlock') {
      var t = core.writeTicket(body.minutes || 1);
      return send(res, 200, { ok: true, minutes: t.minutes, expires: t.data.expires });
    }
    if (u.pathname === '/api/lock') return send(res, 200, { ok: true, removed: core.dropTicket() });
    if (u.pathname === '/api/reset-password') {
      var pw = String(body.password || '');
      if (pw.length < 4) return send(res, 200, { ok: false, error: '密码至少 4 位' });
      core.resetPassword(pw);
      return send(res, 200, { ok: true });
    }
  }
  send(res, 404, { ok: false, error: 'not found' });
});

function openBrowser(target) {
  var cmd = process.platform === 'win32' ? 'start "" "' + target + '"'
    : process.platform === 'darwin' ? 'open "' + target + '"' : 'xdg-open "' + target + '"';
  exec(cmd, { windowsHide: true }, function () {});
}

function listen(port, tries) {
  server.once('error', function (e) {
    if (e && e.code === 'EADDRINUSE' && tries > 0) return listen(port + 1, tries - 1);
    console.error('启动失败：' + e.message);
    process.exit(1);
  });
  server.listen(port, '127.0.0.1', function () {
    var target = 'http://127.0.0.1:' + port + '/';
    console.log('管理员免密工具已启动：' + target);
    console.log('票据位置：' + core.ticketFile);
    console.log('按 Ctrl+C 退出（已开启的免密仍然有效，直到过期）。');
    if (!NO_OPEN) openBrowser(target);
  });
}
listen(PREFERRED, 9);
