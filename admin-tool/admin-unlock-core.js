/* 管理员免密工具 · 共用逻辑
 * 只读写 %APPDATA%\GaokaoCountdown 下的 admin-unlock.json，
 * 不依赖 Electron，Node 8+ 可直接运行。
 */
const fs = require('fs');
const os = require('os');
const path = require('path');

const appData = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
const dir = process.env.GK_USER_DIR || path.join(appData, 'GaokaoCountdown');
const ticketFile = path.join(dir, 'admin-unlock.json');
const storeFile = path.join(dir, 'store.json');

function readTicket() {
  try { return JSON.parse(fs.readFileSync(ticketFile, 'utf8')); } catch (e) { return null; }
}

function readStatus() {
  const t = readTicket();
  const now = Date.now();
  if (!t || !t.expires) return { valid: false, expires: 0, remain: 0, expiresAt: '', file: ticketFile, dir: dir };
  const remain = Math.max(0, Number(t.expires) - now);
  return {
    valid: remain > 0,
    expires: Number(t.expires),
    remain: remain,
    expiresAt: t.expiresAt || new Date(Number(t.expires)).toLocaleString(),
    file: ticketFile,
    dir: dir
  };
}

function writeTicket(minutes) {
  const mins = Math.max(1, Math.min(7 * 24 * 60, Math.round(Number(minutes) || 1)));
  const expires = Date.now() + mins * 60000;
  const data = { expires: expires, expiresAt: new Date(expires).toISOString(), by: 'admin-unlock', ts: Date.now() };
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(ticketFile, JSON.stringify(data, null, 2), 'utf8');
  return { data: data, minutes: mins };
}

function dropTicket() {
  if (!fs.existsSync(ticketFile)) return false;
  try { fs.unlinkSync(ticketFile); return true; } catch (e) { return false; }
}

module.exports = {
  dir: dir,
  ticketFile: ticketFile,
  storeFile: storeFile,
  readTicket: readTicket,
  readStatus: readStatus,
  writeTicket: writeTicket,
  dropTicket: dropTicket
};
