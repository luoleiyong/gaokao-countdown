'use strict';
/*
 * 高考倒计时 · 桌面宠物（Windows）
 * 主进程：窗口/宠物层级、托盘、开机自启、本地存储、启动日志
 */
const { app, BrowserWindow, ipcMain, Menu, Tray, nativeImage, screen, dialog, net, shell, globalShortcut } = require('electron');
const fs = require('fs');
const path = require('path');
const { pathToFileURL, fileURLToPath } = require('url');
const crypto = require('crypto');
const { execFile, execFileSync, spawn } = require('child_process');

let XLSX = null;
try { XLSX = require('xlsx'); } catch { /* 缺少表格组件时仅支持 txt/csv */ }

const USER_DIR = path.join(app.getPath('appData'), 'GaokaoCountdown');
const STORE_FILE = path.join(USER_DIR, 'store.json');
const LOG_NAME = '启动日志.txt';

const SKINS = [
  { id: 'board', name: '黑板粉笔' },
  { id: 'starry', name: '星河夜航' },
  { id: 'warm', name: '晨光纸卷' },
  { id: 'bamboo', name: '青竹小院' }
];
const SUBJECT_IDS = ['chinese', 'math', 'english', 'japanese', 'physics', 'chemistry', 'biology', 'politics', 'history', 'geography'];
const DEFAULT_SUBJECTS = ['chinese', 'math', 'english', 'physics', 'chemistry', 'biology'];
const REPO_URL = 'https://github.com/luoleiyong/gaokao-countdown';
const DEFAULT_UPDATE_URL = REPO_URL;
/* 国内加速下载前缀：拼接在 GitHub 资源直链前面 */
const UPDATE_MIRRORS = ['https://gh-proxy.com/', 'https://ghproxy.net/'];
/* GitHub API 被墙时的镜像前缀（同样拼接完整 API 地址） */
const UPDATE_API_MIRRORS = ['https://gh-proxy.com/', 'https://ghproxy.net/'];
/* GitHub API 不可达时的更新清单兜底（jsDelivr 国内可直连） */
const UPDATE_MANIFESTS = [
  'https://cdn.jsdelivr.net/gh/luoleiyong/gaokao-countdown@master/update/version.json',
  'https://fastly.jsdelivr.net/gh/luoleiyong/gaokao-countdown@master/update/version.json',
  'https://gcore.jsdelivr.net/gh/luoleiyong/gaokao-countdown@master/update/version.json'
];
const STORE_DEFAULTS = {
  targetDate: '2027-06-07',
  skin: 'board',
  petScale: 1,
  petFreq: 'slow',
  autoLaunch: false,
  debugMode: false,
  onboarded: false,
  history: [],
  lastLaunchDate: '',
  panelBounds: null,
  petPos: null,
  updateUrl: DEFAULT_UPDATE_URL,
  weatherCity: '',
  weatherCache: null,
  selectedSubjects: DEFAULT_SUBJECTS.slice(),
  pendingCleanup: [],
  pendingInstallUpdate: '',
  updateAutoCheck: true,
  updateAutoDownload: true,
  events: [],
  backupAuto: true,
  lastBackupDate: '',
  backupDir: '',
  classroom: null
};

let win = null;
let testWin = null;
let currentView = 'home';
let panelViewSnapshot = null;
let classroomUnlocked = false;
let tray = null;
let quitting = false;
let mode = 'panel';
let eggFullscreen = false;
let eggBounds = null;
let timerFullscreen = false;
let timerBounds = null;
let classFullscreen = false;
let classBounds = null;
let firstTodayLaunch = false;
let petScale = 1;
let panelBounds = null;
let saveBoundsTimer = null;
let updateTask = { version: '', filePath: '', downloading: false, done: false };
let installerLaunched = false;
let historyBackup = null;

function updateDir() {
  return path.join(app.getPath('temp'), 'GaokaoCountdownUpdate');
}

/* 安装包下载目录：临时目录失败时依次回退到下载目录与数据目录 */
function updateDirs() {
  const list = [updateDir()];
  try { list.push(path.join(app.getPath('downloads'), 'GaokaoCountdownUpdate')); } catch { /* 忽略 */ }
  list.push(path.join(USER_DIR, 'update'));
  return Array.from(new Set(list));
}

/* 重命名重试：杀毒软件短暂占用时也能完成落盘 */
function renameWithRetry(src, dest) {
  let lastError = null;
  for (let i = 0; i < 4; i++) {
    try {
      fs.renameSync(src, dest);
      return;
    } catch (e) {
      lastError = e;
      try { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 250); } catch { /* 忽略 */ }
    }
  }
  try {
    fs.copyFileSync(src, dest);
    fs.unlinkSync(src);
    return;
  } catch (e) {
    lastError = e;
  }
  throw lastError || new Error('无法保存安装包');
}

/* ---------------- 安装包下载：直连优先 + 分片并发 ---------------- */
const UPDATE_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/* 探测服务器是否支持 Range：total>0 支持；error 表示连接失败 */
async function probeRange(url) {
  try {
    const res = await net.fetch(url, {
      headers: { 'User-Agent': UPDATE_UA, Range: 'bytes=0-0' },
      signal: AbortSignal.timeout(12000)
    });
    const status = res.status;
    const contentRange = res.headers.get('content-range') || '';
    try { await res.body?.cancel(); } catch { /* 忽略 */ }
    if (status === 206) {
      const m = contentRange.match(/\/(\d+)/);
      return { total: m ? Number(m[1]) : 0, error: false };
    }
    return { total: 0, error: false };
  } catch {
    return { total: 0, error: true };
  }
}

/* 单连接下载：服务器不支持 Range 或分片失败时兜底 */
async function streamDownload(url, tmpPath, sender, version) {
  const handle = await fs.promises.open(tmpPath, 'w');
  const controller = new AbortController();
  let stallTimer = setTimeout(() => {
    try { controller.abort(); } catch { /* 忽略 */ }
  }, 30000);
  const armStall = () => {
    clearTimeout(stallTimer);
    stallTimer = setTimeout(() => {
      try { controller.abort(); } catch { /* 忽略 */ }
    }, 30000);
  };
  try {
    const res = await net.fetch(url, {
      headers: { 'User-Agent': UPDATE_UA },
      signal: controller.signal
    });
    if (!res.ok || !res.body) throw new Error('HTTP ' + res.status);
    const total = Number(res.headers.get('content-length')) || 0;
    const reader = res.body.getReader();
    let received = 0;
    let sentAt = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      armStall();
      const chunk = Buffer.from(value);
      received += chunk.length;
      await handle.write(chunk);
      if (sender && !sender.isDestroyed() && Date.now() - sentAt > 180) {
        sentAt = Date.now();
        sender.send('update:progress', {
          version,
          received,
          total,
          percent: total ? Math.min(99, Math.round((received / total) * 100)) : 0
        });
      }
    }
  } finally {
    clearTimeout(stallTimer);
    try { await handle.close(); } catch { /* 忽略 */ }
  }
}

/* 分片并发下载：默认 4~8 个连接，单个分片失败自动续传 */
async function rangeDownload(url, tmpPath, total, sender, version) {
  const threads = total > 80 * 1024 * 1024 ? 8 : (total > 40 * 1024 * 1024 ? 6 : 4);
  const partSize = Math.ceil(total / threads);
  const handle = await fs.promises.open(tmpPath, 'w');
  let received = 0;
  let sentAt = 0;
  let aborted = false;
  const controllers = new Set();

  const report = () => {
    if (aborted || !sender || sender.isDestroyed()) return;
    const now = Date.now();
    if (now - sentAt < 200 && received < total) return;
    sentAt = now;
    sender.send('update:progress', {
      version,
      received,
      total,
      percent: Math.min(99, Math.round((received / total) * 100))
    });
  };

  const jobs = [];
  try {
    await handle.truncate(total);
    for (let i = 0; i < threads; i++) {
      const start = i * partSize;
      const end = Math.min(total - 1, start + partSize - 1);
      if (start > end) continue;
      jobs.push((async () => {
        let pos = start;
        let tries = 0;
        while (pos <= end) {
          if (aborted) throw new Error('分片下载已中止');
          const controller = new AbortController();
          controllers.add(controller);
          let stallTimer = null;
          const armStall = () => {
            clearTimeout(stallTimer);
            stallTimer = setTimeout(() => {
              try { controller.abort(); } catch { /* 忽略 */ }
            }, 25000);
          };
          try {
            armStall();
            const res = await net.fetch(url, {
              headers: { 'User-Agent': UPDATE_UA, Range: `bytes=${pos}-${end}` },
              signal: controller.signal
            });
            if (res.status !== 206 || !res.body) throw new Error('HTTP ' + res.status);
            const reader = res.body.getReader();
            for (;;) {
              const { done, value } = await reader.read();
              if (done) break;
              armStall();
              const chunk = Buffer.from(value);
              const remain = end - pos + 1;
              const slice = chunk.length > remain ? chunk.subarray(0, remain) : chunk;
              await handle.write(slice, 0, slice.length, pos);
              pos += slice.length;
              received += slice.length;
              report();
              if (pos > end) break;
            }
            clearTimeout(stallTimer);
            if (pos <= end) throw new Error('分片提前结束');
          } catch (e) {
            clearTimeout(stallTimer);
            if (++tries > 4) throw e;
            await sleep(300 * tries);
          } finally {
            controllers.delete(controller);
          }
        }
      })());
    }

    try {
      await Promise.all(jobs);
    } catch (e) {
      aborted = true;
      for (const c of controllers) {
        try { c.abort(); } catch { /* 忽略 */ }
      }
      await Promise.allSettled(jobs);
      throw e;
    }

    const size = fs.statSync(tmpPath).size;
    if (size !== total) throw new Error(`安装包大小校验失败（${size}/${total}）`);
  } finally {
    try { await handle.close(); } catch { /* 忽略 */ }
  }
}

/* 先直连分片下载，失败再退回单连接；由外层负责切换镜像 */
async function downloadAssetToFile(url, tmpPath, sender, version) {
  const probe = await probeRange(url);
  if (probe.error) throw new Error('连接超时或被拦截');
  if (probe.total > 0) {
    try {
      await rangeDownload(url, tmpPath, probe.total, sender, version);
      return 'range';
    } catch (e) {
      appendLog('UPDATE_RANGE_FAIL', { url, message: e.message });
      try { if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath); } catch { /* 忽略 */ }
    }
  }
  await streamDownload(url, tmpPath, sender, version);
  return 'stream';
}


/* 检查文件开头是否为 Windows 可执行文件的 MZ 头 */
function hasExeHeader(file) {
  let fd = null;
  try {
    fd = fs.openSync(file, 'r');
    const buf = Buffer.alloc(2);
    fs.readSync(fd, buf, 0, 2, 0);
    return buf[0] === 0x4d && buf[1] === 0x5a;
  } catch {
    return false;
  } finally {
    if (fd !== null) {
      try { fs.closeSync(fd); } catch { /* 忽略 */ }
    }
  }
}

/* 静默运行安装程序（/S 无界面安装，--force-run 安装完成后自动启动） */
function spawnSilentInstaller(setup) {
  try {
    const child = spawn(setup, ['/S', '--updated', '--force-run'], {
      detached: true,
      stdio: 'ignore',
      windowsHide: true
    });
    child.once('error', () => {
      try { shell.openPath(setup); } catch { /* 忽略 */ }
    });
    child.unref();
    return true;
  } catch {
    try { shell.openPath(setup); } catch { /* 忽略 */ }
    return false;
  }
}

/* ---------------- 存储 & 日志 ---------------- */
function ensureDirs() {
  fs.mkdirSync(USER_DIR, { recursive: true });
}
/* 旧版“外语”拆分为英语/日语，并限制最多 6 科 */
function normalizeSubjects(input) {
  const list = Array.isArray(input) ? input : [];
  const mapped = list.map((id) => (id === 'foreign' ? 'english' : id));
  const filtered = Array.from(new Set(mapped.filter((id) => SUBJECT_IDS.includes(id)))).slice(0, 6);
  return filtered.length ? filtered : DEFAULT_SUBJECTS.slice();
}

/* ---------------- 课堂助手：名单 / 课程表 ---------------- */
const TIMETABLE_DAYS = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];

function uid(prefix) {
  return prefix + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}
function clampWeight(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return 1;
  return Math.min(10, Math.max(0.1, Math.round(n * 10) / 10));
}
function defaultTimetable() {
  const times = ['08:00-08:45', '08:55-09:40', '10:00-10:45', '10:55-11:40', '14:00-14:45', '14:55-15:40', '16:00-16:45', '18:30-19:15'];
  const weekendSim = ['08:20-09:00', '09:10-09:50', '10:00-10:40', '10:50-11:20', '14:10-14:50', '15:00-15:40', '15:50-16:30', '16:40-17:20'];
  return {
    title: '我的课程表',
    days: TIMETABLE_DAYS.slice(),
    periods: times.map((time, i) => ({
      id: 'p' + (i + 1),
      label: `第${i + 1}节`,
      time,
      cells: ['', '', '', '', '', '', '']
    })),
    weekend: {
      enabled: false,
      variable: false,
      periods: weekendSim.map((time, i) => ({
        id: 'w' + (i + 1),
        label: `第${i + 1}节`,
        times: [time, time],
        cells: ['', '']
      })),
      entries: []
    }
  };
}
/* 测试版示例课程表：工作日填满科目，周末留空 */
function demoTimetable() {
  const t = defaultTimetable();
  t.title = '测试课程表（示例）';
  const subjects = ['语文', '数学', '英语', '物理', '化学', '生物', '自习', '体育'];
  t.periods = t.periods.map((p, i) => ({
    ...p,
    cells: TIMETABLE_DAYS.map((_, day) => (day > 4 ? '' : subjects[(i + day) % subjects.length]))
  }));
  return t;
}

function normalizeTimetableDate(v) {
  const s = String(v == null ? '' : v).trim();
  let m = s.match(/(\d{4})\s*[-/.年]\s*(\d{1,2})\s*[-/.月]\s*(\d{1,2})/);
  if (!m) return '';
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (!y || mo < 1 || mo > 12 || d < 1 || d > 31) return '';
  return `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}
function normalizeTimetable(input) {
  const def = defaultTimetable();
  const t = input && typeof input === 'object' ? input : {};
  const periods = Array.isArray(t.periods) && t.periods.length ? t.periods : def.periods;
  const w = t.weekend && typeof t.weekend === 'object' ? t.weekend : null;
  const weekend = {
    enabled: !!(w && w.enabled),
    variable: !!(w && w.variable),
    periods: (w && Array.isArray(w.periods) ? w.periods : def.weekend.periods)
      .slice(0, 24)
      .map((p, i) => {
        const times = Array.isArray(p && p.times) ? p.times : [];
        return {
          id: p && typeof p.id === 'string' && p.id ? p.id : 'w' + (i + 1),
          label: String((p && p.label) || `第${i + 1}节`).slice(0, 12),
          times: Array.from({ length: 2 }, (_, j) => String(times[j] == null ? '' : times[j]).slice(0, 24)),
          cells: Array.from({ length: 2 }, (_, j) => {
            const v = p && Array.isArray(p.cells) ? p.cells[j] : '';
            return String(v == null ? '' : v).slice(0, 30);
          })
        };
      }),
    entries: (w && Array.isArray(w.entries) ? w.entries : [])
      .slice(0, 2000)
      .map((e, i) => {
        const date = normalizeTimetableDate(e && e.date);
        if (!date) return null;
        return {
          id: e && typeof e.id === 'string' && e.id ? e.id : 'we' + i + Date.now().toString(36),
          date,
          label: String((e && e.label) || '').slice(0, 12),
          time: String((e && e.time) || '').slice(0, 24),
          subject: String((e && e.subject) || '').slice(0, 30)
        };
      })
      .filter(Boolean)
  };
  return {
    title: String(t.title || def.title).slice(0, 40),
    days: Array.isArray(t.days) && t.days.length === 7 ? t.days.map((d) => String(d).slice(0, 6)) : def.days,
    periods: periods.slice(0, 24).map((p, i) => ({
      id: typeof p.id === 'string' && p.id ? p.id : 'p' + (i + 1),
      label: String(p.label || `第${i + 1}节`).slice(0, 12),
      time: String(p.time || '').slice(0, 24),
      night: !!p.night,
      cells: Array.from({ length: 7 }, (_, j) => {
        const v = Array.isArray(p.cells) ? p.cells[j] : '';
        return String(v == null ? '' : v).slice(0, 30);
      })
    })),
    weekend
  };
}
function normalizeRoster(input) {
  if (!input || typeof input !== 'object' || !Array.isArray(input.names)) return null;
  const names = input.names.map((n) => {
    if (!n) return null;
    const name = String(n.name || '').trim().slice(0, 30);
    if (!name) return null;
    return {
      id: typeof n.id === 'string' && n.id ? n.id : uid('n'),
      name,
      weight: clampWeight(n.weight),
      count: Math.max(0, parseInt(n.count, 10) || 0),
      pickedAt: Number(n.pickedAt) || 0
    };
  }).filter(Boolean);
  return {
    id: typeof input.id === 'string' && input.id ? input.id : uid('r'),
    name: String(input.name || '未命名名单').slice(0, 40),
    createdAt: Number(input.createdAt) || Date.now(),
    names,
    lastPickId: typeof input.lastPickId === 'string' ? input.lastPickId : '',
    roundIds: Array.isArray(input.roundIds)
      ? Array.from(new Set(input.roundIds.filter((id) => names.some((n) => n.id === id))))
      : []
  };
}
function defaultClassroom() {
  return { passwordHash: '', passwordSalt: '', activeRosterId: '', rosters: [], timetable: defaultTimetable() };
}
function normalizeClassroom(input) {
  const c = input && typeof input === 'object' ? input : {};
  const out = defaultClassroom();
  out.passwordHash = typeof c.passwordHash === 'string' ? c.passwordHash : '';
  out.passwordSalt = typeof c.passwordSalt === 'string' ? c.passwordSalt : '';
  out.rosters = Array.isArray(c.rosters) ? c.rosters.map(normalizeRoster).filter(Boolean) : [];
  out.activeRosterId = typeof c.activeRosterId === 'string' ? c.activeRosterId : '';
  if (!out.rosters.some((r) => r.id === out.activeRosterId)) {
    out.activeRosterId = out.rosters.length ? out.rosters[0].id : '';
  }
  out.timetable = normalizeTimetable(c.timetable);
  return out;
}
function normalizeEvents(input) {
  return (Array.isArray(input) ? input : []).map((e) => {
    if (!e || typeof e !== 'object') return null;
    const name = String(e.name || '').trim().slice(0, 30);
    const date = String(e.date || '');
    if (!name || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
    return { id: typeof e.id === 'string' && e.id ? e.id : uid('e'), name, date };
  }).filter(Boolean).slice(0, 30);
}
const BACKUP_HINT_FILE = path.join(USER_DIR, 'install-backup-path.txt');
function defaultBackupDir() {
  return path.join(USER_DIR, 'backups');
}
/* 校验备份目录：绝对路径、可创建、可写入（写一次探针文件再删掉） */
function checkBackupDir(input) {
  const dir = String(input == null ? '' : input).trim().replace(/[\\/]+$/, '');
  if (!dir) return { ok: false, error: '路径为空' };
  if (dir.length > 200) return { ok: false, error: '路径过长' };
  if (!path.isAbsolute(dir)) return { ok: false, error: '请选择完整的文件夹路径' };
  try {
    fs.mkdirSync(dir, { recursive: true });
    if (!fs.statSync(dir).isDirectory()) return { ok: false, error: '该路径不是文件夹' };
    const probe = path.join(dir, '.gk-write-test');
    fs.writeFileSync(probe, 'ok');
    fs.unlinkSync(probe);
    return { ok: true, dir };
  } catch (e) {
    if (e && (e.code === 'EACCES' || e.code === 'EPERM')) return { ok: false, error: '没有写入权限' };
    if (e && e.code === 'ENOENT') return { ok: false, error: '文件夹不可用' };
    return { ok: false, error: (e && e.message) || '文件夹不可用' };
  }
}
/* 实际使用的备份目录：自定义优先，不可用时自动退回默认位置，保证备份不中断 */
function backupDirInfo() {
  const custom = typeof store.backupDir === 'string' ? store.backupDir.trim() : '';
  if (custom) {
    const res = checkBackupDir(custom);
    if (res.ok) return { dir: res.dir, custom: true, fallback: false, defaultDir: defaultBackupDir() };
    return { dir: defaultBackupDir(), custom: true, fallback: true, error: res.error, defaultDir: defaultBackupDir() };
  }
  return { dir: defaultBackupDir(), custom: false, fallback: false, defaultDir: defaultBackupDir() };
}
function backupDir() {
  return backupDirInfo().dir;
}
/* 安装向导写的提示文件可能来自不同 NSIS 编码：UTF-16（含/不含 BOM）或本地 ANSI（GBK），逐个兼容 */
function decodeHintBuffer(buf) {
  if (!buf || !buf.length) return '';
  if (buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xfe) return buf.subarray(2).toString('utf16le').replace(/^\uFEFF/, '').trim();
  if (buf.length >= 2 && buf[0] === 0xfe && buf[1] === 0xff) return Buffer.from(buf.subarray(2)).swap16().toString('utf16le').trim();
  if (buf.length >= 2 && buf[0] !== 0 && buf[1] === 0) return buf.toString('utf16le').replace(/\u0000+$/, '').trim();
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buf).replace(/^\uFEFF/, '').trim();
  } catch {
    try { return new TextDecoder('gbk').decode(buf).trim(); } catch { return buf.toString('utf8').trim(); }
  }
}
/* 安装向导选择的备份位置：仅当用户从未设置时采用一次，读完即删 */
function consumeInstallBackupHint() {
  try {
    if (!fs.existsSync(BACKUP_HINT_FILE)) return '';
    const raw = decodeHintBuffer(fs.readFileSync(BACKUP_HINT_FILE));
    try { fs.unlinkSync(BACKUP_HINT_FILE); } catch { /* 忽略 */ }
    if (!raw) return '';
    const res = checkBackupDir(raw);
    return res.ok ? res.dir : '';
  } catch {
    return '';
  }
}
/* 每天首次启动自动备份 store.json，保留最近 7 份 */
function runAutoBackup(force) {
  if (!store.backupAuto && !force) return null;
  const today = dateKey();
  if (!force && store.lastBackupDate === today) return null;
  try {
    // 备份的是磁盘上的 store.json，先把挂起的写入落盘，避免备份到旧数据
    flushStore();
    if (!fs.existsSync(STORE_FILE)) return null;
    const info = backupDirInfo();
    let dir = info.dir;
    try {
      fs.mkdirSync(dir, { recursive: true });
    } catch {
      // 自定义目录突然不可用（U 盘拔出、网络盘断线）时退回默认位置，备份不能断
      dir = defaultBackupDir();
      fs.mkdirSync(dir, { recursive: true });
    }
    const file = path.join(dir, `store-${today}.json`);
    fs.copyFileSync(STORE_FILE, file);
    const files = fs.readdirSync(dir)
      .filter((f) => /^store-\d{4}-\d{2}-\d{2}\.json$/.test(f))
      .sort();
    while (files.length > 7) {
      try { fs.unlinkSync(path.join(dir, files.shift())); } catch { /* 忽略 */ }
    }
    store.lastBackupDate = today;
    saveStore();
    appendLog('BACKUP_AUTO', { file, count: files.length, dir, custom: info.custom, fallback: dir !== info.dir });
    return file;
  } catch (e) {
    appendLog('BACKUP_ERR', { message: e.message });
    return null;
  }
}
function latestBackupInfo() {
  try {
    const files = fs.readdirSync(backupDir())
      .filter((f) => /^store-\d{4}-\d{2}-\d{2}\.json$/.test(f))
      .sort();
    if (!files.length) return { count: 0, latest: '' };
    return { count: files.length, latest: files[files.length - 1].replace(/^store-|\.json$/g, '') };
  } catch {
    return { count: 0, latest: '' };
  }
}
/* 备份位置状态：初始化与设置页共用一份结构 */
function backupPayload() {
  const info = backupDirInfo();
  return {
    ok: true,
    backupDir: store.backupDir || '',
    backupPath: info.dir,
    backupCustom: info.custom,
    backupFallback: info.fallback,
    backupDefaultPath: info.defaultDir,
    backupInfo: latestBackupInfo()
  };
}
function hashPassword(password, salt) {
  return crypto.createHash('sha256').update(salt + '|' + String(password)).digest('hex');
}
function adminHasPassword() {
  return !!(store.classroom.passwordHash && store.classroom.passwordSalt);
}
function adminVerify(password) {
  if (!adminHasPassword()) return false;
  return hashPassword(password, store.classroom.passwordSalt) === store.classroom.passwordHash;
}

function loadStore() {
  ensureDirs();
  try {
    const raw = fs.readFileSync(STORE_FILE, 'utf8');
    const data = JSON.parse(raw);
    const merged = Object.assign({}, STORE_DEFAULTS, data, {
      history: Array.isArray(data.history) ? data.history : []
    });
    merged.selectedSubjects = normalizeSubjects(merged.selectedSubjects);
    merged.classroom = normalizeClassroom(data.classroom);
    merged.debugMode = !!merged.debugMode;
    merged.pendingCleanup = Array.isArray(data.pendingCleanup)
      ? data.pendingCleanup.filter((p) => typeof p === 'string' && p.trim()).slice(0, 8)
      : [];
    merged.pendingInstallUpdate = typeof data.pendingInstallUpdate === 'string' ? data.pendingInstallUpdate : '';
    merged.petFreq = ['quiet', 'slow', 'fast', 'ultra'].includes(merged.petFreq) ? merged.petFreq : 'slow';
    merged.updateAutoCheck = merged.updateAutoCheck !== false;
    merged.updateAutoDownload = merged.updateAutoDownload !== false;
    merged.events = normalizeEvents(data.events);
    merged.backupAuto = merged.backupAuto !== false;
    merged.lastBackupDate = typeof data.lastBackupDate === 'string' ? data.lastBackupDate : '';
    merged.backupDir = typeof data.backupDir === 'string' ? data.backupDir.trim().slice(0, 200) : '';
    // 安装向导里选过备份位置时，首次启动采用（用户之后可在设置里改）
    if (!merged.backupDir) merged.backupDir = consumeInstallBackupHint();
    // 更新源固定为项目仓库，避免旧配置残留
    merged.updateUrl = DEFAULT_UPDATE_URL;
    return merged;
  } catch {
    // 文件损坏时先留一份原件，避免用户数据被直接覆盖
    try {
      if (fs.existsSync(STORE_FILE)) {
        const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
        fs.copyFileSync(STORE_FILE, path.join(USER_DIR, `store.损坏-${stamp}.json`));
      }
    } catch { /* 忽略备份失败 */ }
    const fresh = Object.assign({}, STORE_DEFAULTS);
    fresh.classroom = defaultClassroom();
    return fresh;
  }
}
const store = loadStore();
petScale = clampScale(store.petScale);

/* 存储写盘：400ms 内多次修改合并成一次原子写，退出前用 flushStore() 兜底 */
let storeDirty = false;
let storeSaveTimer = null;

function flushStore() {
  if (storeSaveTimer) {
    clearTimeout(storeSaveTimer);
    storeSaveTimer = null;
  }
  if (!storeDirty) return;
  storeDirty = false;
  try {
    ensureDirs();
    const tmp = STORE_FILE + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(store, null, 2), 'utf8');
    fs.renameSync(tmp, STORE_FILE);
  } catch { /* 忽略写盘失败，不影响主流程 */ }
}

function saveStore() {
  storeDirty = true;
  if (storeSaveTimer) return;
  storeSaveTimer = setTimeout(() => {
    storeSaveTimer = null;
    flushStore();
  }, 400);
}
const LOG_LABELS = {
  APP_START: '程序启动',
  APP_QUIT: '程序退出',
  WINDOW_READY: '主界面就绪',
  WINDOW_HIDE: '隐藏主界面',
  NAV_HOME: '返回主界面',
  SETTINGS: '设置已更新',
  MODE_CHANGE: '切换显示模式',
  DEBUG_MODE: '调试模式变更',
  KNOWLEDGE_OPEN: '打开学科知识签',
  CLASSROOM_OPEN: '打开课堂点名',
  TIMETABLE_OPEN: '打开课程表',
  WEATHER_OK: '天气获取成功',
  WEATHER_ERR: '天气获取失败',
  WEATHER_CN_FAIL: '中国天气网获取失败',
  WEATHER_HOURLY_OK: '逐小时天气获取成功',
  WEATHER_HOURLY_FAIL: '逐小时天气获取失败',
  UPDATE_CHECK: '检查更新',
  UPDATE_API_FAIL: '更新接口连接失败',
  UPDATE_ERR: '更新检查失败',
  UPDATE_DOWNLOADED: '安装包下载完成',
  UPDATE_DOWNLOAD_FAIL: '安装包下载失败',
  UPDATE_INSTALL: '启动安装程序',
  UPDATE_DEFER: '已安排退出后安装',
  UPDATE_INSTALL_ON_QUIT: '退出时启动安装程序',
  UPDATE_INSTALL_ERR: '安装程序启动失败',
  UPDATE_INSTALL_ON_QUIT_ERR: '退出安装启动失败',
  UPDATE_CLEANUP: '清理旧版本文件',
  ADMIN_SETUP: '设置管理员密码',
  ADMIN_LOGIN: '管理员登录成功',
  ADMIN_LOGIN_FAIL: '管理员密码错误',
  ADMIN_LOCK: '退出管理员模式',
  ADMIN_PASSWORD_CHANGE: '修改管理员密码',
  ROSTER_IMPORT: '导入名单',
  ROSTER_DELETE: '删除名单',
  SIGN_DRAW: '开启幸运签',
  HISTORY_CLEAR: '清空签运簿',
  HISTORY_RESTORE: '恢复签运簿',
  BACKUP_AUTO: '自动备份数据',
  BACKUP_ERR: '自动备份失败',
  STORE_RECOVER: '数据文件损坏已保留备份',
  DATA_EXPORT: '导出数据',
  DATA_IMPORT: '导入数据',
  EVENT_SAVE: '保存重要日子',
  GROUP_DRAW: '随机分组',
  TIMER_DONE: '课堂计时结束',
  TIMER_BG: '更换计时背景',
  TIMER_BG_DEL: '删除计时背景',
  SHORTCUT_FAIL: '全局快捷键注册失败',
  RENDER_GONE: '界面进程异常退出',
  RENDER_RECOVER: '界面进程已重新加载',
  MILESTONE_EGG: '倒计时里程碑彩蛋',
  MILESTONE_EGG_RESET: '重置彩蛋播放',
  TEST_SEED: '载入测试数据',
  PET_ENCOURAGE: '桌面宠物课程提示',
  MAIN_ERROR: '主进程异常',
  DWM_ERR: '窗口特效设置失败',
  CLIENT: '客户端事件'
};

function logDetailText(detail) {
  if (!detail || typeof detail !== 'object') return '';
  const parts = [];
  Object.keys(detail).slice(0, 6).forEach((key) => {
    const value = detail[key];
    if (value == null || value === '') return;
    parts.push(`${key}=${typeof value === 'object' ? JSON.stringify(value) : value}`);
  });
  return parts.length ? '（' + parts.join('，') + '）' : '';
}

function logCandidates() {
  const list = [];
  if (app.isPackaged) {
    if (process.env.PORTABLE_EXECUTABLE_FILE) {
      list.push(path.join(path.dirname(process.env.PORTABLE_EXECUTABLE_FILE), LOG_NAME));
    }
    list.push(path.join(path.dirname(process.execPath), LOG_NAME));
  }
  list.push(path.join(USER_DIR, LOG_NAME));
  return Array.from(new Set(list));
}

/* 日志批量异步追加：避免每次点按都同步阻塞主进程，退出前用 flushLogsSync() 兜底 */
const logQueue = [];
let logWriting = false;

function appendLog(event, detail) {
  try {
    ensureDirs();
    const now = new Date();
    const p2 = (n) => String(n).padStart(2, '0');
    const time = `${now.getFullYear()}-${p2(now.getMonth() + 1)}-${p2(now.getDate())} ` +
      `${p2(now.getHours())}:${p2(now.getMinutes())}:${p2(now.getSeconds())}`;
    const label = LOG_LABELS[event] || event;
    logQueue.push(`[${time}] ${label}${logDetailText(detail)}\n`);
    if (logQueue.length > 200) logQueue.splice(0, logQueue.length - 200);
    drainLogs();
  } catch { /* 忽略日志失败 */ }
}

function drainLogs() {
  if (logWriting || !logQueue.length) return;
  logWriting = true;
  const batch = logQueue.splice(0, logQueue.length).join('');
  const files = logCandidates();
  const tryWrite = (i) => {
    if (i >= files.length) {
      logWriting = false;
      return;
    }
    fs.appendFile(files[i], batch, 'utf8', (err) => {
      if (err) {
        tryWrite(i + 1);
        return;
      }
      logWriting = false;
      if (logQueue.length) drainLogs();
    });
  };
  tryWrite(0);
}

function flushLogsSync() {
  if (!logQueue.length) return;
  const batch = logQueue.splice(0, logQueue.length).join('');
  for (const file of logCandidates()) {
    try {
      fs.appendFileSync(file, batch, 'utf8');
      return;
    } catch { /* 尝试下一个位置 */ }
  }
}

/* 新版本首次启动时清理旧便携版与安装包（安装成功后才可能执行成功） */
function runPendingCleanup() {
  const list = Array.isArray(store.pendingCleanup) ? store.pendingCleanup : [];
  if (!list.length) return;
  const selfPaths = [process.execPath];
  if (process.env.PORTABLE_EXECUTABLE_FILE) selfPaths.push(process.env.PORTABLE_EXECUTABLE_FILE);
  const selfSet = new Set(selfPaths.filter(Boolean).map((p) => path.resolve(p).toLowerCase()));
  list.forEach((p) => {
    try {
      const rp = path.resolve(p);
      if (selfSet.has(rp.toLowerCase())) return;
      if (fs.existsSync(rp)) {
        fs.unlinkSync(rp);
        appendLog('UPDATE_CLEANUP', { file: rp });
      }
    } catch { /* 文件被占用时下次再试 */ }
  });
  store.pendingCleanup = [];
  saveStore();
}
function dateKey(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
function clampScale(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return 1;
  return Math.min(1.6, Math.max(0.8, Math.round(n * 10) / 10));
}

/* ---------------- 天气 / 版本网络功能 ---------------- */
const WMO_DESC = {
  0: '晴', 1: '晴间多云', 2: '多云', 3: '阴',
  45: '雾', 48: '雾凇',
  51: '小毛毛雨', 53: '毛毛雨', 55: '大毛毛雨', 56: '冻毛毛雨', 57: '强冻毛毛雨',
  61: '小雨', 63: '中雨', 65: '大雨', 66: '冻雨', 67: '强冻雨',
  71: '小雪', 73: '中雪', 75: '大雪', 77: '雪粒',
  80: '小阵雨', 81: '阵雨', 82: '强阵雨', 85: '小阵雪', 86: '强阵雪',
  95: '雷阵雨', 96: '雷阵雨伴冰雹', 99: '强雷暴冰雹'
};

async function fetchJson(url, timeout = 8000, headers) {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeout);
  try {
    const res = await net.fetch(url, {
      signal: ac.signal,
      headers: Object.assign({
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36',
        'Accept': 'application/json,text/plain,*/*'
      }, headers || {})
    });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

async function fetchText(url, timeout = 8000, headers) {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeout);
  try {
    const res = await net.fetch(url, {
      signal: ac.signal,
      headers: Object.assign({
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36',
        'Accept': 'text/html,application/json,text/plain,*/*'
      }, headers || {})
    });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    return await res.text();
  } finally {
    clearTimeout(timer);
  }
}

function versionCmp(a, b) {
  const pa = String(a).replace(/^v/i, '').split('.').map((x) => parseInt(x, 10) || 0);
  const pb = String(b).replace(/^v/i, '').split('.').map((x) => parseInt(x, 10) || 0);
  const n = Math.max(pa.length, pb.length);
  for (let i = 0; i < n; i++) {
    const x = pa[i] || 0;
    const y = pb[i] || 0;
    if (x !== y) return x - y;
  }
  return 0;
}

function parseGitHubRepo(url) {
  const m = String(url).match(/^https?:\/\/github\.com\/([^/]+)\/([^/?#]+)/i);
  if (!m) return null;
  if (m[2].toLowerCase() === 'releases') return null;
  return { owner: m[1], repo: m[2].replace(/\.git$/i, '') };
}

/* ---- 中国天气网（国内可直连，作为主天气源） ---- */
const CN_WEATHER_HEADERS = {
  'Referer': 'http://www.weather.com.cn/',
  'Accept': 'text/html,application/json,text/plain,*/*'
};

function cnDate(offset) {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/* 城市名归一化：「杭州市」→「杭州」，「黔东南苗族侗族自治州」→「黔东南」 */
function cityCandidates(names) {
  const out = [];
  names.forEach((raw) => {
    const name = String(raw || '').trim();
    if (!name) return;
    out.push(name);
    const trimmed = name.replace(/(特别行政区|自治州|自治县|地区|新区|市|县|区|盟|旗)$/, '');
    if (trimmed && trimmed !== name) out.push(trimmed);
    const auto = name.match(/^(.+?)(?:苗族|侗族|彝族|白族|傣族|藏族|羌族|土家族|壮族|回族|蒙古族|哈萨克|柯尔克孜|哈尼族|布依族|朝鲜族|满族|瑶族|黎族|畲族|水族|仡佬族)/);
    if (auto && auto[1] && auto[1].length >= 2) out.push(auto[1]);
  });
  return Array.from(new Set(out));
}

async function searchCnCityOnce(name) {
  const text = await fetchText(
    'http://toy1.weather.com.cn/search?cityname=' + encodeURIComponent(name),
    7000,
    CN_WEATHER_HEADERS
  );
  const start = text.indexOf('[');
  const end = text.lastIndexOf(']');
  if (start < 0 || end <= start) return null;
  let list;
  try { list = JSON.parse(text.slice(start, end + 1)); } catch { return null; }
  if (!Array.isArray(list)) return null;
  const hit = list.find((x) => /^\d{9}$/.test(String((x && x.ref) || '').split('~')[0]));
  if (!hit) return null;
  const parts = String(hit.ref).split('~');
  return { id: parts[0], name: parts[2] || name };
}

/* 常用城市 → 中国天气网城市代码（搜索接口不可用时兜底） */
const CN_CITY_IDS = {
  北京: '101010100', 上海: '101020100', 天津: '101030100', 重庆: '101040100',
  哈尔滨: '101050101', 长春: '101060101', 沈阳: '101070101', 呼和浩特: '101080101',
  石家庄: '101090101', 太原: '101100101', 西安: '101110101', 济南: '101120101',
  乌鲁木齐: '101130101', 拉萨: '101140101', 西宁: '101150101', 兰州: '101160101',
  银川: '101170101', 郑州: '101180101', 南京: '101190101', 武汉: '101200101',
  杭州: '101210101', 合肥: '101220101', 福州: '101230101', 南昌: '101240101',
  长沙: '101250101', 贵阳: '101260101', 成都: '101270101', 广州: '101280101',
  昆明: '101290101', 南宁: '101300101', 海口: '101310101', 香港: '101320101',
  澳门: '101330101', 台北: '101340101',
  深圳: '101280601', 苏州: '101190401', 青岛: '101120201', 大连: '101070201',
  厦门: '101230201', 宁波: '101210401', 无锡: '101190201', 东莞: '101281601',
  佛山: '101280800', 温州: '101210701', 珠海: '101280701', 三亚: '101310201',
  徐州: '101190801', 常州: '101191101', 南通: '101190501', 烟台: '101120501',
  潍坊: '101120601', 唐山: '101090501', 保定: '101090201', 洛阳: '101180901',
  宜昌: '101200901', 襄阳: '101200201', 株洲: '101250301', 赣州: '101240701',
  芜湖: '101220301', 泉州: '101230501', 汕头: '101280501', 惠州: '101280301',
  中山: '101281701', 江门: '101281101', 湛江: '101281001', 桂林: '101300501',
  柳州: '101300301', 遵义: '101260201', 凯里: '101260501', 都匀: '101260401',
  铜仁: '101260601', 毕节: '101260701', 六盘水: '101260801', 安顺: '101260301',
  绵阳: '101270401', 德阳: '101270501', 宜宾: '101271101', 大理: '101290201',
  丽江: '101291401', 宝鸡: '101110901', 咸阳: '101110200', 榆林: '101110401',
  天水: '101160901', 包头: '101080201', 吉林: '101060201', 大庆: '101050901'
};

function lookupCnCity(name) {
  const candidates = cityCandidates([name]);
  for (const cand of candidates) {
    if (CN_CITY_IDS[cand]) return { id: CN_CITY_IDS[cand], name: cand };
  }
  return null;
}

async function searchCnCity(name) {
  // 先查内置城市表，避免搜索接口波动
  const local = lookupCnCity(name);
  if (local) return local;

  const candidates = cityCandidates([name]);
  for (const cand of candidates) {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const hit = await searchCnCityOnce(cand);
        if (hit) return hit;
        break; // 接口正常但没有匹配结果，换下一个候选名
      } catch { /* 网络抖动时重试一次 */ }
    }
  }
  return null;
}

async function resolveCnCity() {
  const pref = (store.weatherCity || '').trim();
  if (pref) {
    if (/^\d{9}$/.test(pref)) return { id: pref, name: pref, source: 'cityid' };
    const hit = await searchCnCity(pref);
    if (!hit) throw new Error('未找到城市：' + pref);
    return { id: hit.id, name: hit.name, source: 'city' };
  }
  try {
    const r = await fetchJson('https://ipwho.is/?lang=zh-CN', 6000);
    if (r && r.success !== false) {
      const hit = await searchCnCity(r.city || r.region || '');
      if (hit) return { id: hit.id, name: hit.name, source: 'ip' };
    }
  } catch { /* 尝试下一个定位源 */ }
  try {
    const r = await fetchJson('https://myip.ipip.net/json', 6000);
    const loc = r && r.data && Array.isArray(r.data.location) ? r.data.location : [];
    const hit = await searchCnCity(loc[2] || loc[1] || '');
    if (hit) return { id: hit.id, name: hit.name, source: 'ip' };
  } catch { /* 尝试下一个定位源 */ }
  try {
    const r = await fetchJson('http://ip-api.com/json/?fields=status,city,regionName&lang=zh-CN', 6000);
    if (r && r.status === 'success') {
      const hit = await searchCnCity(r.city || r.regionName || '');
      if (hit) return { id: hit.id, name: hit.name, source: 'ip' };
    }
  } catch { /* 使用默认城市 */ }
  return { id: '101010100', name: '北京', source: 'fallback' };
}

async function fetchCnWeather(loc) {
  let now = null;
  try {
    const text = await fetchText(
      'http://d1.weather.com.cn/weather_index/' + loc.id + '.html',
      8000,
      CN_WEATHER_HEADERS
    );
    const m = text.match(/var\s+dataSK\s*=\s*(\{[\s\S]*?\});/);
    if (m) now = JSON.parse(m[1]);
  } catch { /* 当前实况失败，继续尝试取预报 */ }

  let days = [];
  try {
    const html = await fetchText('http://www.weather.com.cn/weather/' + loc.id + '.shtml', 9000);
    const re = /<li class="sky[^"]*"[\s\S]*?<\/li>/g;
    let m;
    while ((m = re.exec(html)) && days.length < 3) {
      const block = m[0];
      const wea = /<p[^>]*class="wea"[^>]*>([^<]*)<\/p>/.exec(block);
      const tem = /<p[^>]*class="tem"[^>]*>([\s\S]*?)<\/p>/.exec(block);
      if (!wea || !tem) continue;
      // 温度可能写成「12℃」或「12」，今天也可能只有最低温
      const hi = /<span>\s*(-?\d+)/.exec(tem[1]);
      const lo = /<i>\s*(-?\d+)/.exec(tem[1]);
      const max = hi ? Number(hi[1]) : (lo ? Number(lo[1]) : null);
      if (max == null) continue;
      const win = /<p[^>]*class="win"[^>]*>([\s\S]*?)<\/p>/.exec(block);
      let windDir = '';
      let windLevel = '';
      if (win) {
        // 风向在 span 的 title 里（白天/夜间两段），风力在 i 标签内
        const dirs = [];
        const spanRe = /title="([^"]*)"/g;
        let sm;
        while ((sm = spanRe.exec(win[1]))) {
          const d = sm[1].trim();
          if (d) dirs.push(d);
        }
        windDir = Array.from(new Set(dirs)).join('转');
        const lv = /<i>([\s\S]*?)<\/i>/.exec(win[1]);
        windLevel = lv ? lv[1].replace(/<[^>]*>/g, '').trim() : '';
      }
      days.push({
        date: cnDate(days.length),
        desc: wea[1].trim() || '天气',
        max,
        min: lo ? Number(lo[1]) : max,
        windDir,
        windLevel
      });
    }
  } catch { /* 预报失败则尝试备用接口 */ }

  // 备用：dingzhi 接口补足今天
  if (days.length < 3) {
    try {
      const text = await fetchText('http://d1.weather.com.cn/dingzhi/' + loc.id + '.html', 7000, CN_WEATHER_HEADERS);
      const m = text.match(/var\s+cityDZ\d*\s*=\s*(\{[\s\S]*?\});/);
      if (m) {
        const info = (JSON.parse(m[1]).weatherinfo) || {};
        const hi = parseInt(info.temp, 10);
        const lo = parseInt(info.tempn, 10);
        if (Number.isFinite(hi) || Number.isFinite(lo)) {
          const day = {
            date: cnDate(0),
            desc: String(info.weather || '天气').trim(),
            max: Number.isFinite(hi) ? hi : lo,
            min: Number.isFinite(lo) ? lo : hi,
            windDir: String(info.wd || ''),
            windLevel: String(info.ws || '')
          };
          if (!days.some((d) => d.date === day.date)) days.unshift(day);
        }
      }
    } catch { /* 忽略备用接口 */ }
  }

  if (!now && !days.length) return null;
  const temp = now && Number.isFinite(Number(now.temp)) ? Math.round(Number(now.temp)) : days[0].max;
  return {
    ok: true,
    city: (now && now.cityname) || loc.name,
    temp,
    humidity: now ? parseInt(now.SD, 10) || 0 : 0,
    wind: now ? parseInt(now.wse, 10) || 0 : 0,
    windDir: now ? String(now.WD || '') : '',
    aqi: now ? parseInt(now.aqi, 10) || 0 : 0,
    code: 0,
    desc: (now && now.weather) || (days[0] && days[0].desc) || '天气',
    days,
    source: 'weather.com.cn',
    updatedAt: Date.now()
  };
}

/* ---- Open-Meteo（海外网络环境备用） ---- */
async function resolveLocation() {
  const cityPref = (store.weatherCity || '').trim();
  if (cityPref) {
    const plain = cityPref.replace(/市$/, '');
    if (CN_CITY_COORDS[plain]) {
      const c = CN_CITY_COORDS[plain];
      return { city: cityPref, lat: c[0], lon: c[1], source: 'city' };
    }
    const geo = await fetchJson(
      'https://geocoding-api.open-meteo.com/v1/search?name=' +
        encodeURIComponent(cityPref) + '&count=1&language=zh&format=json',
      7000
    ).catch(() => null);
    const hit = geo && geo.results && geo.results[0];
    if (hit) return { city: hit.name, lat: hit.latitude, lon: hit.longitude, source: 'city' };
  }
  try {
    const r = await fetchJson('https://ipwho.is/', 6000);
    if (r && r.success !== false && Number.isFinite(r.latitude) && Number.isFinite(r.longitude)) {
      return { city: r.city || r.region || '本地', lat: r.latitude, lon: r.longitude, source: 'ip' };
    }
  } catch { /* 尝试下一个定位源 */ }
  try {
    const r = await fetchJson('http://ip-api.com/json/?fields=status,country,regionName,city,lat,lon&lang=zh-CN', 6000);
    if (r && r.status === 'success' && Number.isFinite(r.lat) && Number.isFinite(r.lon)) {
      return { city: r.city || r.regionName || '本地', lat: r.lat, lon: r.lon, source: 'ip' };
    }
  } catch { /* 使用默认城市 */ }
  return { city: '北京', lat: 39.9042, lon: 116.4074, source: 'fallback' };
}

/* Open-Meteo 逐小时预报 → 24 小时精简数据 */
function parseHourly(data) {
  const h = data && data.hourly;
  if (!h || !Array.isArray(h.time)) return [];
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate(), now.getHours());
  const out = [];
  for (let i = 0; i < h.time.length; i++) {
    const t = new Date(h.time[i]);
    if (Number.isNaN(t.getTime()) || t < start) continue;
    const code = Number(h.weather_code ? h.weather_code[i] : 0);
    const hh = String(t.getHours()).padStart(2, '0');
    out.push({
      time: h.time[i],
      label: out.length === 0 ? '现在' : `${hh}时`,
      temp: Math.round(Number(h.temperature_2m ? h.temperature_2m[i] : 0)),
      code,
      desc: WMO_DESC[code] || '天气',
      pop: Math.round(Number(h.precipitation_probability ? h.precipitation_probability[i] : 0)) || 0
    });
    if (out.length >= 24) break;
  }
  return out;
}

async function fetchHourlyForecast(cityName) {
  let loc = null;
  const key = String(cityName || '').trim();
  const plain = key.replace(/市$/, '');
  if (plain && CN_CITY_COORDS[plain]) {
    const c = CN_CITY_COORDS[plain];
    loc = { lat: c[0], lon: c[1] };
  }
  if (!loc) loc = await resolveLocation();
  const url = 'https://api.open-meteo.com/v1/forecast?latitude=' + loc.lat +
    '&longitude=' + loc.lon +
    '&hourly=temperature_2m,weather_code,precipitation_probability' +
    '&timezone=auto&forecast_days=2';
  const data = await fetchJson(url, 12000);
  return parseHourly(data);
}

/* 常用城市坐标（用于逐小时预报，避免同名地名定位到错误地区） */
const CN_CITY_COORDS = {
  北京: [39.90, 116.41], 上海: [31.23, 121.47], 天津: [39.13, 117.20], 重庆: [29.56, 106.55],
  哈尔滨: [45.80, 126.53], 长春: [43.82, 125.32], 沈阳: [41.80, 123.43], 呼和浩特: [40.84, 111.75],
  石家庄: [38.04, 114.51], 太原: [37.87, 112.55], 西安: [34.34, 108.94], 济南: [36.65, 117.12],
  乌鲁木齐: [43.83, 87.62], 拉萨: [29.65, 91.14], 西宁: [36.62, 101.78], 兰州: [36.06, 103.83],
  银川: [38.49, 106.23], 郑州: [34.75, 113.63], 南京: [32.06, 118.80], 武汉: [30.59, 114.31],
  杭州: [30.27, 120.15], 合肥: [31.82, 117.23], 福州: [26.07, 119.30], 南昌: [28.68, 115.89],
  长沙: [28.23, 112.94], 贵阳: [26.65, 106.63], 成都: [30.57, 104.07], 广州: [23.13, 113.26],
  昆明: [25.04, 102.71], 南宁: [22.82, 108.37], 海口: [20.04, 110.32], 香港: [22.32, 114.17],
  澳门: [22.20, 113.54], 台北: [25.03, 121.57], 深圳: [22.54, 114.06], 苏州: [31.30, 120.58],
  青岛: [36.07, 120.38], 大连: [38.91, 121.61], 厦门: [24.48, 118.09], 宁波: [29.87, 121.55],
  无锡: [31.49, 120.31], 东莞: [23.02, 113.75], 佛山: [23.02, 113.12], 温州: [27.99, 120.70],
  珠海: [22.27, 113.58], 三亚: [18.25, 109.51], 徐州: [34.26, 117.18], 常州: [31.81, 119.97],
  南通: [31.98, 120.89], 烟台: [37.46, 121.45], 潍坊: [36.71, 119.16], 唐山: [39.63, 118.18],
  保定: [38.87, 115.46], 洛阳: [34.62, 112.45], 宜昌: [30.69, 111.29], 襄阳: [32.01, 112.12],
  株洲: [27.83, 113.13], 赣州: [25.83, 114.93], 芜湖: [31.35, 118.43], 泉州: [24.87, 118.68],
  汕头: [23.35, 116.68], 惠州: [23.11, 114.42], 中山: [22.52, 113.39], 江门: [22.58, 113.08],
  湛江: [21.27, 110.36], 桂林: [25.27, 110.29], 柳州: [24.33, 109.43], 遵义: [27.73, 106.93],
  凯里: [26.57, 107.98], 都匀: [26.26, 107.52], 铜仁: [27.72, 109.19], 毕节: [27.28, 105.29],
  六盘水: [26.59, 104.83], 安顺: [26.25, 105.95], 绵阳: [31.47, 104.68], 德阳: [31.13, 104.40],
  宜宾: [28.77, 104.63], 大理: [25.61, 100.27], 丽江: [26.86, 100.23], 宝鸡: [34.36, 107.24],
  咸阳: [34.33, 108.71], 榆林: [38.29, 109.73], 天水: [34.58, 105.72], 包头: [40.66, 109.84],
  吉林: [43.84, 126.55], 大庆: [46.59, 125.10]
};

async function fetchWeatherData() {
  // 主源：中国天气网（国内可直连），逐小时预报按需单独获取
  try {
    const cnLoc = await resolveCnCity();
    const cn = await fetchCnWeather(cnLoc);
    if (cn) {
      cn.hours = [];
      cn.updatedAt = Date.now();
      return cn;
    }
  } catch (e) {
    appendLog('WEATHER_CN_FAIL', { message: e.message });
  }

  // 备用源：Open-Meteo（海外网络环境）
  const loc = await resolveLocation();
  const url = 'https://api.open-meteo.com/v1/forecast?latitude=' + loc.lat +
    '&longitude=' + loc.lon +
    '&current=temperature_2m,relative_humidity_2m,weather_code,wind_speed_10m' +
    '&daily=weather_code,temperature_2m_max,temperature_2m_min' +
    '&hourly=temperature_2m,weather_code,precipitation_probability' +
    '&timezone=auto&forecast_days=3';
  const data = await fetchJson(url, 6000);
  const cur = data && data.current;
  if (!cur) throw new Error('天气数据为空');
  const code = Number(cur.weather_code);
  const daily = data.daily || {};
  const days = Array.isArray(daily.time)
    ? daily.time.map((date, i) => {
        const c = Number(daily.weather_code ? daily.weather_code[i] : 0);
        return {
          date,
          code: c,
          desc: WMO_DESC[c] || '天气',
          max: Math.round(Number(daily.temperature_2m_max ? daily.temperature_2m_max[i] : 0)),
          min: Math.round(Number(daily.temperature_2m_min ? daily.temperature_2m_min[i] : 0))
        };
      })
    : [];
  return {
    ok: true,
    city: loc.city,
    lat: loc.lat,
    lon: loc.lon,
    temp: Math.round(Number(cur.temperature_2m)),
    humidity: Math.round(Number(cur.relative_humidity_2m)),
    wind: Math.round(Number(cur.wind_speed_10m)),
    code,
    desc: WMO_DESC[code] || '天气',
    days,
    hours: parseHourly(data),
    source: loc.source,
    updatedAt: Date.now()
  };
}

/* ---------------- 开机自启（写 HKCU Run，路径含空格也不会截断） ---------------- */
const RUN_KEY = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run';
const RUN_NAME = 'GaokaoCountdown';

function autoLaunchCommand() {
  // 便携版运行在临时解压目录，自启应指回便携 exe 本体；开机后直接打开主界面
  const portable = process.env.PORTABLE_EXECUTABLE_FILE;
  if (portable && fs.existsSync(portable)) {
    return `"${portable}"`;
  }
  if (process.defaultApp) {
    return `"${process.execPath}" "${path.resolve(process.argv[1])}"`;
  }
  return `"${app.getPath('exe')}"`;
}
function readAutoLaunch() {
  try {
    execFileSync('reg', ['query', RUN_KEY, '/v', RUN_NAME], { windowsHide: true, stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}
function setAutoLaunchEnabled(on) {
  try {
    if (on) {
      execFileSync('reg', ['add', RUN_KEY, '/v', RUN_NAME, '/t', 'REG_SZ', '/d', autoLaunchCommand(), '/f'], { windowsHide: true, stdio: 'pipe' });
    } else {
      try {
        execFileSync('reg', ['delete', RUN_KEY, '/v', RUN_NAME, '/f'], { windowsHide: true, stdio: 'pipe' });
      } catch { /* 本来就没有时忽略 */ }
    }
    return { ok: true, enabled: readAutoLaunch() };
  } catch (e) {
    return { ok: false, error: e.message, enabled: readAutoLaunch() };
  }
}

/* ---------------- 测试版控制面板 ---------------- */
function isTestBuildApp() {
  // 正式版只认版本号：打包后的程序即使带 --test-mode 也不会启用测试面板
  if (/-test/i.test(app.getVersion())) return true;
  return !app.isPackaged && process.argv.includes('--test-mode');
}

function openTestPanel() {
  if (!isTestBuildApp()) return { ok: false, error: '仅测试版可用' };
  if (testWin && !testWin.isDestroyed()) {
    if (testWin.isMinimized()) testWin.restore();
    testWin.show();
    testWin.focus();
    return { ok: true };
  }
  const area = screen.getPrimaryDisplay().workArea;
  const w = 380;
  const h = Math.min(780, area.height - 80);
  testWin = new BrowserWindow({
    width: w,
    height: h,
    minWidth: 340,
    minHeight: 480,
    x: Math.max(area.x, area.x + area.width - w - 18),
    y: area.y + 40,
    frame: false,
    resizable: true,
    alwaysOnTop: true,
    skipTaskbar: false,
    show: false,
    backgroundColor: '#0e1318',
    title: '高考倒计时 · 测试面板',
    icon: path.join(__dirname, 'build', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      spellcheck: false
    }
  });
  testWin.setMenuBarVisibility(false);
  try { testWin.setAlwaysOnTop(true, 'floating'); } catch { /* 旧系统忽略 */ }
  testWin.loadFile(path.join(__dirname, 'renderer', 'testpanel.html'));
  testWin.once('ready-to-show', () => testWin.show());
  testWin.on('closed', () => { testWin = null; });
  return { ok: true };
}

/* ---------------- 窗口 ---------------- */
function createWindow() {
  const area = screen.getPrimaryDisplay().workArea;
  let w = Math.min(1160, area.width - 48);
  let h = Math.min(740, area.height - 48);
  let x = Math.round(area.x + (area.width - w) / 2);
  let y = Math.round(area.y + (area.height - h) / 2);
  if (store.panelBounds && Number.isFinite(store.panelBounds.width)) {
    w = Math.max(980, Math.min(store.panelBounds.width, area.width));
    h = Math.max(640, Math.min(store.panelBounds.height, area.height));
    x = Math.min(Math.max(area.x, store.panelBounds.x), area.x + area.width - w);
    y = Math.min(Math.max(area.y, store.panelBounds.y), area.y + area.height - h);
  }

  win = new BrowserWindow({
    width: w,
    height: h,
    minWidth: 200,
    minHeight: 180,
    x,
    y,
    frame: false,
    thickFrame: false,
    transparent: true,
    hasShadow: false,
    resizable: false,
    minimizable: false,
    show: false,
    skipTaskbar: false,
    backgroundColor: '#00000000',
    title: '高考倒计时',
    icon: path.join(__dirname, 'build', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      spellcheck: false
    }
  });

  win.setMenuBarVisibility(false);
  // 主界面取消最小化：任何路径触发的最小化都立刻还原，只保留「收进宠物 / 隐藏到托盘」
  try { win.setMinimizable(false); } catch { /* 旧版本 API 缺失时忽略 */ }
  win.on('minimize', () => {
    if (!win || win.isDestroyed() || quitting) return;
    appendLog('MINIMIZE_BLOCKED', {});
    try { win.restore(); } catch { /* 忽略 */ }
  });
  try { win.setBackgroundMaterial('none'); } catch { /* 旧系统忽略 */ }
  win.loadFile(
    path.join(__dirname, 'renderer', 'index.html'),
    isTestBuildApp() ? { query: { test: '1' } } : undefined
  );
  win.once('ready-to-show', () => {
    disableDwmShadow(win);
    // 开机自启与手动启动统一进入主界面，避免宠物模式与主界面来回切换
    win.show();
  });

  /* 渲染进程崩溃/被杀后自动重新加载，避免只剩一个空窗口 */
  win.webContents.on('render-process-gone', (_e, details) => {
    appendLog('RENDER_GONE', { reason: details.reason, exitCode: details.exitCode });
    if (quitting) return;
    if (details.reason === 'clean-exit') return;
    setTimeout(() => {
      if (!win || win.isDestroyed()) return;
      try {
        win.reload();
        appendLog('RENDER_RECOVER', { reason: details.reason });
      } catch { /* 忽略重载失败 */ }
    }, 800);
  });

  win.on('close', (e) => {
    if (!quitting) {
      e.preventDefault();
      win.hide();
      appendLog('WINDOW_HIDE', { reason: 'close-to-tray' });
    }
  });
  win.on('moved', rememberBounds);
  win.on('resized', rememberBounds);
}

function rememberBounds() {
  if (!win) return;
  if (mode === 'pet') {
    if (saveBoundsTimer) clearTimeout(saveBoundsTimer);
    saveBoundsTimer = setTimeout(() => {
      const b = win.getBounds();
      store.petPos = { x: b.x, y: b.y };
      saveStore();
    }, 400);
  } else if (mode === 'panel') {
    if (saveBoundsTimer) clearTimeout(saveBoundsTimer);
    saveBoundsTimer = setTimeout(() => {
      if (!win || win.isDestroyed()) return;
      const b = win.getBounds();
      store.panelBounds = { x: b.x, y: b.y, width: b.width, height: b.height };
      saveStore();
    }, 500);
  }
}

function petSize(scale) {
  /* 卡片 334 + 顶部 93.84 的大肥鱼区域，加上外层 20px 留白；整体随缩放一起放大 */
  return {
    width: Math.round(300 * scale + 20),
    height: Math.round((334 + 93.84) * scale + 20)
  };
}

function applyPetMode(on) {
  if (!win || win.isDestroyed()) return;
  if (on && mode !== 'pet') {
    panelBounds = win.getBounds();
    const s = petScale;
    const area = screen.getPrimaryDisplay().workArea;
    const { width, height } = petSize(s);
    let x = area.x + area.width - width - 28;
    let y = area.y + area.height - height - 28;
    if (store.petPos) {
      x = Math.min(Math.max(area.x, store.petPos.x), area.x + area.width - width);
      y = Math.min(Math.max(area.y, store.petPos.y), area.y + area.height - height);
    }
    mode = 'pet';
    win.setResizable(false);
    try { win.setMinimizable(false); } catch { /* 忽略 */ }
    win.setMinimumSize(200, 180);
    win.setSkipTaskbar(true);
    win.setAlwaysOnTop(false);
    win.setFocusable(false);
    win.setBounds({ x, y, width, height });
    win.showInactive();
    win.webContents.send('mode:changed', { mode, scale: petScale });
    sendToBottom();
    appendLog('MODE_CHANGE', { mode });
  } else if (!on && mode === 'pet') {
    mode = 'panel';
    win.setFocusable(true);
    win.setSkipTaskbar(false);
    win.setResizable(false);
    try { win.setMinimizable(false); } catch { /* 忽略 */ }
    win.setMinimumSize(980, 640);
    const area = screen.getPrimaryDisplay().workArea;
    const b = panelBounds || { x: area.x + 40, y: area.y + 40, width: Math.min(1160, area.width - 48), height: Math.min(740, area.height - 48) };
    const width = Math.max(980, Math.min(b.width, area.width));
    const height = Math.max(640, Math.min(b.height, area.height));
    win.setBounds({ x: b.x, y: b.y, width, height });
    win.show();
    win.focus();
    win.webContents.send('mode:changed', { mode, scale: petScale });
    appendLog('MODE_CHANGE', { mode });
  }
}

function changeScale(delta) {
  petScale = clampScale(petScale + delta);
  store.petScale = petScale;
  saveStore();
  if (win && !win.isDestroyed()) {
    if (mode === 'pet') {
      const area = screen.getPrimaryDisplay().workArea;
      const { width, height } = petSize(petScale);
      const b = win.getBounds();
      const x = Math.min(Math.max(area.x, b.x), area.x + area.width - width);
      const y = Math.min(Math.max(area.y, b.y), area.y + area.height - height);
      win.setBounds({ x, y, width, height });
      win.webContents.send('mode:changed', { mode, scale: petScale });
    } else {
      win.webContents.send('scale:changed', { scale: petScale });
    }
  }
}

function setSkin(id) {
  if (!SKINS.some((s) => s.id === id)) return store.skin;
  store.skin = id;
  saveStore();
  if (win && !win.isDestroyed()) win.webContents.send('skin:changed', { skin: id });
  appendLog('SETTINGS', { skin: id });
  return id;
}

/* 关闭 Windows DWM 给窗口的非客户区渲染（阴影/边线） */
function disableDwmShadow(target) {
  if (process.platform !== 'win32' || !target || target.isDestroyed()) return;
  try {
    const buf = target.getNativeWindowHandle();
    const hwnd = buf.readBigUInt64LE(0).toString();
    const ps = [
      '$sig = @"',
      'using System;',
      'using System.Runtime.InteropServices;',
      'public class GkDwm {',
      '  [DllImport("dwmapi.dll")] public static extern int DwmSetWindowAttribute(IntPtr hwnd, int attr, ref int attrValue, int attrSize);',
      '}',
      '"@',
      'Add-Type -TypeDefinition $sig',
      '$v = 1',
      `[GkDwm]::DwmSetWindowAttribute([IntPtr]${hwnd}, 2, [ref]$v, 4) | Out-Null`
    ].join('\n');
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', ps], { windowsHide: true }, (err) => {
      if (err) appendLog('DWM_ERR', { message: err.message });
    });
  } catch (e) {
    appendLog('DWM_ERR', { message: e.message });
  }
}

/* ---------------- 主窗口内页面切换（知识签 / 课堂点名） ---------------- */
function navigateToView(view, extraQuery) {
  if (!win || win.isDestroyed()) return;
  if (mode === 'pet') applyPetMode(false);
  if (currentView === 'home') panelViewSnapshot = win.getBounds();
  if (currentView === 'classroom' && view !== 'classroom') classroomUnlocked = false;
  currentView = view;

  const size = view === 'knowledge'
    ? { width: 920, height: 680, minWidth: 780, minHeight: 560 }
    : (view === 'timetable'
      ? { width: 1180, height: 780, minWidth: 980, minHeight: 640 }
      : { width: 1120, height: 760, minWidth: 940, minHeight: 620 });
  const area = screen.getPrimaryDisplay().workArea;
  const width = Math.min(size.width, area.width - 16);
  const height = Math.min(size.height, area.height - 16);
  const b = win.getBounds();
  const x = Math.min(Math.max(area.x, b.x), area.x + area.width - width);
  const y = Math.min(Math.max(area.y, b.y), area.y + area.height - height);

  win.setResizable(true);
  win.setMinimumSize(size.minWidth, size.minHeight);
  win.setBounds({ x, y, width, height });
  win.show();
  win.focus();
  win.loadFile(path.join(__dirname, 'renderer', view + '.html'), {
    query: Object.assign({ skin: store.skin }, extraQuery || {})
  });
  appendLog(view === 'knowledge' ? 'KNOWLEDGE_OPEN'
    : (view === 'timetable' ? 'TIMETABLE_OPEN' : 'CLASSROOM_OPEN'), {});
}

function goHomeView() {
  if (!win || win.isDestroyed()) return;
  if (win.isFullScreen()) win.setFullScreen(false);
  classFullscreen = false;
  classBounds = null;
  timerFullscreen = false;
  timerBounds = null;
  currentView = 'home';
  classroomUnlocked = false;
  win.setResizable(false);
  win.setMinimumSize(980, 640);
  const area = screen.getPrimaryDisplay().workArea;
  const b = panelViewSnapshot || store.panelBounds || {
    x: area.x + 40,
    y: area.y + 40,
    width: Math.min(1160, area.width - 48),
    height: Math.min(740, area.height - 48)
  };
  const width = Math.max(980, Math.min(b.width || 1160, area.width));
  const height = Math.max(640, Math.min(b.height || 740, area.height));
  const x = Math.min(Math.max(area.x, b.x || area.x), area.x + area.width - width);
  const y = Math.min(Math.max(area.y, b.y || area.y), area.y + area.height - height);
  win.setBounds({ x, y, width, height });
  win.show();
  win.focus();
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  panelViewSnapshot = null;
  appendLog('NAV_HOME', {});
}

function openKnowledgeWindow() {
  if (currentView === 'knowledge') {
    win.show();
    win.focus();
    return;
  }
  navigateToView('knowledge');
}

function openClassroomWindow(options) {
  if (currentView === 'classroom') {
    win.show();
    win.focus();
    if (options && options.admin) {
      win.webContents.send('admin:open');
    }
    return;
  }
  navigateToView('classroom', options && options.admin ? { admin: '1' } : undefined);
}

function openTimetableView() {
  if (!win || win.isDestroyed()) return;
  if (currentView === 'timetable') {
    win.show();
    win.focus();
    return;
  }
  navigateToView('timetable');
}

const NAME_HEADER_RE = /^(姓名|名字|学生姓名|学生|name|序号|编号|学号|班级|性别)$/i;
function cleanNameToken(token) {
  let t = String(token == null ? '' : token).replace(/^\uFEFF/, '').trim();
  t = t.replace(/^["'\s]+|["'\s]+$/g, '');
  t = t.replace(/^\d+\s*[.、)．:：]?\s*/, '');
  t = t.trim();
  if (!t || t.length > 30) return '';
  if (NAME_HEADER_RE.test(t)) return '';
  if (/^\d+$/.test(t)) return '';
  return t;
}
function parseNameText(text) {
  const raw = String(text || '').replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
  const lines = raw.split('\n').filter((l) => l.trim());
  let col = -1;
  for (let i = 0; i < Math.min(lines.length, 5); i++) {
    const cells = lines[i].split(/[,，;；\t]/).map((c) => c.trim());
    const idx = cells.findIndex((c) => /^(姓名|名字|学生姓名|学生|name)$/i.test(c));
    if (idx >= 0) {
      col = idx;
      lines.splice(0, i + 1);
      break;
    }
  }
  const out = [];
  lines.forEach((line) => {
    if (col >= 0) {
      const cells = line.split(/[,，;；\t]/);
      const v = cleanNameToken(cells[col]);
      if (v) out.push(v);
    } else {
      line.split(/[\s,，;；、\t]+/).forEach((tok) => {
        const v = cleanNameToken(tok);
        if (v) out.push(v);
      });
    }
  });
  return Array.from(new Set(out));
}
function readSheetRows(filePath) {
  const sheets = readWorkbookSheets(filePath);
  if (!sheets.length) throw new Error('表格中没有工作表');
  return sheets[0].rows;
}
function readWorkbookSheets(filePath) {
  if (!XLSX) throw new Error('当前版本缺少表格组件，请改用 txt/csv');
  const wb = XLSX.readFile(filePath);
  if (!wb.SheetNames.length) throw new Error('表格中没有工作表');
  return wb.SheetNames.map((name) => {
    const sheet = wb.Sheets[name];
    const rows = sheet ? XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false, defval: '' }) : [];
    return {
      name,
      rows: rows.map((r) => (Array.isArray(r) ? r.map((c) => String(c == null ? '' : c).trim()) : []))
    };
  });
}
function namesFromRows(rows) {
  let col = -1;
  let start = 0;
  for (let r = 0; r < Math.min(rows.length, 6); r++) {
    const idx = (rows[r] || []).findIndex((c) => /^(姓名|名字|学生姓名|学生|name)$/i.test(String(c || '').trim()));
    if (idx >= 0) { col = idx; start = r + 1; break; }
  }
  const out = [];
  if (col >= 0) {
    for (let r = start; r < rows.length; r++) {
      const v = cleanNameToken((rows[r] || [])[col]);
      if (v) out.push(v);
    }
  } else {
    const width = rows.reduce((m, r) => Math.max(m, r.length), 0);
    let bestCol = -1;
    let bestScore = 0;
    for (let c = 0; c < width; c++) {
      let score = 0;
      rows.forEach((row) => {
        const v = cleanNameToken(row[c]);
        if (v && /^[\u4e00-\u9fa5·]{2,8}$/.test(v)) score++;
      });
      if (score > bestScore) { bestScore = score; bestCol = c; }
    }
    if (bestCol >= 0) {
      rows.forEach((row) => {
        const v = cleanNameToken(row[bestCol]);
        if (v) out.push(v);
      });
    } else {
      rows.forEach((row) => row.forEach((cell) => {
        const v = cleanNameToken(cell);
        if (v) out.push(v);
      }));
    }
  }
  return Array.from(new Set(out));
}
function importRosterFiles(filePaths) {
  const created = [];
  const errors = [];
  const list = Array.isArray(filePaths) ? filePaths : [];
  list.forEach((fp) => {
    try {
      if (typeof fp !== 'string' || !fs.existsSync(fp)) throw new Error('文件不存在');
      const ext = path.extname(fp).toLowerCase();
      let names = [];
      if (['.xlsx', '.xls', '.xlsm'].includes(ext)) {
        names = namesFromRows(readSheetRows(fp));
      } else if (ext === '.csv') {
        names = XLSX ? namesFromRows(readSheetRows(fp)) : parseNameText(fs.readFileSync(fp, 'utf8'));
      } else {
        names = parseNameText(fs.readFileSync(fp, 'utf8'));
      }
      if (!names.length) throw new Error('没有识别到姓名');
      const roster = {
        id: uid('r'),
        name: (path.basename(fp, ext) || '导入名单').slice(0, 40),
        createdAt: Date.now(),
        names: names.map((name) => ({ id: uid('n'), name, weight: 1, count: 0, pickedAt: 0 })),
        lastPickId: ''
      };
      store.classroom.rosters.push(roster);
      if (!store.classroom.activeRosterId) store.classroom.activeRosterId = roster.id;
      created.push({ name: roster.name, count: roster.names.length });
    } catch (e) {
      errors.push(path.basename(fp) + '：' + e.message);
    }
  });
  if (created.length) saveStore();
  appendLog('ROSTER_IMPORT', { created, errors });
  return { ok: created.length > 0, created, errors };
}
function classroomPublicData() {
  const c = store.classroom;
  return {
    activeRosterId: c.activeRosterId,
    rosters: c.rosters.map((r) => ({
      id: r.id,
      name: r.name,
      names: r.names.map((n) => ({ id: n.id, name: n.name }))
    })),
    timetable: c.timetable,
    hasPassword: adminHasPassword(),
    unlocked: classroomUnlocked,
    debugMode: !!store.debugMode
  };
}
function classroomAdminData() {
  const data = classroomPublicData();
  data.rosters = store.classroom.rosters.map((r) => ({
    id: r.id,
    name: r.name,
    createdAt: r.createdAt,
    lastPickId: r.lastPickId,
    names: r.names.map((n) => ({ id: n.id, name: n.name, weight: n.weight, count: n.count, pickedAt: n.pickedAt }))
  }));
  data.historyCount = store.history.length;
  data.historyBackupCount = historyBackup ? historyBackup.length : 0;
  return data;
}
/* 权重随机：先累加权重再二分定位，命中概率只由权重决定，与名单导入顺序无关 */
function weightedPick(candidates) {
  const n = candidates.length;
  if (n <= 1) return candidates[0];
  const cum = new Array(n);
  let total = 0;
  for (let i = 0; i < n; i++) {
    total += Math.max(0.0001, Number(candidates[i].weight) || 0.0001);
    cum[i] = total;
  }
  const r = Math.random() * total;
  let lo = 0;
  let hi = n - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (cum[mid] <= r) lo = mid + 1;
    else hi = mid;
  }
  return candidates[lo];
}
function drawFromRoster(rosterId, count, options) {
  const roster = store.classroom.rosters.find((r) => r.id === rosterId);
  if (!roster) return { ok: false, error: '名单不存在' };
  if (!roster.names.length) return { ok: false, error: '名单里还没有学生' };
  const pool = roster.names.filter((n) => n.weight > 0);
  if (!pool.length) return { ok: false, error: '权重都为 0，无法点名' };
  const want = Math.max(1, Math.min(parseInt(count, 10) || 1, pool.length));
  const noRepeat = !!(options && options.noRepeat);
  const picked = [];
  let wrapped = false;

  if (noRepeat) {
    // 不重复模式：在本轮剩余的人里按权重随机抽，抽完自动开启新一轮
    let round = new Set(
      (Array.isArray(roster.roundIds) ? roster.roundIds : []).filter((id) => pool.some((n) => n.id === id))
    );
    while (picked.length < want && picked.length < pool.length) {
      let remain = pool.filter((n) => !round.has(n.id));
      if (!remain.length) {
        round = new Set();
        wrapped = true;
        remain = pool.slice();
      }
      const hit = weightedPick(remain);
      round.add(hit.id);
      hit.count += 1;
      hit.pickedAt = Date.now();
      picked.push(hit);
      roster.roundIds = Array.from(round);
    }
  } else {
    // 重复模式：每次都在全部学生里独立按权重随机，不排除任何人
    const candidates = pool.slice();
    for (let i = 0; i < want && candidates.length; i++) {
      const hit = weightedPick(candidates);
      hit.count += 1;
      hit.pickedAt = Date.now();
      picked.push(hit);
      candidates.splice(candidates.indexOf(hit), 1);
    }
    roster.roundIds = [];
  }

  if (!picked.length) return { ok: false, error: '点名失败，请重试' };
  roster.lastPickId = picked[picked.length - 1].id;
  saveStore();
  const roundSet = new Set(roster.roundIds || []);
  const roundLeft = noRepeat ? pool.filter((n) => !roundSet.has(n.id)).length : 0;
  return {
    ok: true,
    name: picked[0].name,
    names: picked.map((n) => n.name),
    roster: roster.name,
    rosterId: roster.id,
    noRepeat,
    wrapped,
    roundLeft
  };
}
function broadcastDebugMode() {
  if (win && !win.isDestroyed()) win.webContents.send('debug:changed', { on: !!store.debugMode });
}

/* 把窗口压到桌面层（其他程序窗口之下，桌面之上） */
function sendToBottom() {
  if (process.platform !== 'win32' || !win || win.isDestroyed()) return;
  try {
    const handle = win.getNativeWindowHandle();
    const hwnd = handle.readBigUInt64LE(0).toString();
    const ps = [
      '$sig = @"',
      'using System;',
      'using System.Runtime.InteropServices;',
      'public class GkWin32 {',
      '  [DllImport("user32.dll", SetLastError=true)]',
      '  public static extern bool SetWindowPos(IntPtr hWnd, IntPtr hWndInsertAfter, int X, int Y, int cx, int cy, uint uFlags);',
      '}',
      '"@',
      'Add-Type -TypeDefinition $sig',
      `[GkWin32]::SetWindowPos([IntPtr]${hwnd}, [IntPtr]1, 0, 0, 0, 0, 0x0013) | Out-Null`
    ].join('\n');
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', ps], { windowsHide: true }, (err) => {
      if (err) appendLog('SET_BOTTOM_ERR', { message: err.message });
    });
  } catch (e) {
    appendLog('SET_BOTTOM_ERR', { message: e.message });
  }
}

/* ---------------- 托盘 / 应用 ---------------- */
function showPanel() {
  if (!win || win.isDestroyed()) return;
  if (currentView !== 'home') {
    goHomeView();
    return;
  }
  if (mode === 'pet') applyPetMode(false);
  else {
    win.show();
    win.focus();
  }
}

function quitApp() {
  quitting = true;
  appendLog('APP_QUIT', {});
  app.quit();
}

function createTray() {
  let icon;
  try {
    icon = nativeImage.createFromPath(path.join(__dirname, 'build', 'icon.png'));
    if (icon.isEmpty()) icon = nativeImage.createEmpty();
  } catch {
    icon = nativeImage.createEmpty();
  }
  icon = icon.resize({ width: 20, height: 20 });
  tray = new Tray(icon);
  tray.setToolTip('高考倒计时 · 每日幸运签');
  updateTrayMenu();
  tray.on('double-click', showPanel);
  tray.on('click', showPanel);
}

function updateTrayMenu() {
  if (!tray) return;
  const menu = Menu.buildFromTemplate([
    { label: '打开主界面', click: showPanel },
    { label: '课堂助手', click: () => openClassroomWindow() },
    { label: '课程表', click: () => openTimetableView() },
    { label: '学科知识签', click: () => openKnowledgeWindow() },
    { label: '桌面宠物模式', click: () => { showPanel(); setTimeout(() => applyPetMode(true), 200); } },
    { type: 'separator' },
    { label: '隐藏到托盘', click: () => { if (win && !win.isDestroyed()) win.hide(); } },
    { type: 'separator' },
    { label: '退出程序', click: quitApp }
  ]);
  tray.setContextMenu(menu);
}



/* ---------------- IPC ---------------- */
function wireIpc() {
  ipcMain.handle('app:get-init', () => {
    const bdir = backupDirInfo();
    return {
    store: {
      targetDate: store.targetDate,
      skin: store.skin,
      petScale,
      petFreq: store.petFreq,
      autoLaunch: store.autoLaunch,
      history: store.history,
      updateUrl: store.updateUrl,
      weatherCity: store.weatherCity,
      selectedSubjects: store.selectedSubjects,
      debugMode: !!store.debugMode,
      onboarded: !!store.onboarded,
      updateAutoCheck: !!store.updateAutoCheck,
      updateAutoDownload: !!store.updateAutoDownload,
      pendingInstallUpdate: store.pendingInstallUpdate || '',
      events: store.events,
      timetable: store.classroom.timetable,
      backupAuto: store.backupAuto !== false,
      lastBackupDate: store.lastBackupDate || '',
      backupInfo: latestBackupInfo(),
      backupDir: store.backupDir || '',
      backupPath: bdir.dir,
      backupCustom: bdir.custom,
      backupFallback: bdir.fallback,
      backupDefaultPath: bdir.defaultDir
    },
    isFirstToday: firstTodayLaunch,
    today: dateKey(),
    mode,
    skins: SKINS,
    version: app.getVersion(),
    testMode: isTestBuildApp(),
    platform: process.platform,
    startedAt: new Date().toISOString()
    };
  });

  ipcMain.handle('app:save-settings', (_e, patch) => {
    if (!patch || typeof patch !== 'object') return { ok: false };
    if (typeof patch.targetDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(patch.targetDate)) {
      store.targetDate = patch.targetDate;
    }
    if (typeof patch.skin === 'string') setSkin(patch.skin);
    if (patch.petScale != null) {
      petScale = clampScale(patch.petScale);
      store.petScale = petScale;
    }
    if (typeof patch.petFreq === 'string' && ['quiet', 'slow', 'fast', 'ultra'].includes(patch.petFreq)) {
      store.petFreq = patch.petFreq;
    }
    if (typeof patch.weatherCity === 'string') {
      store.weatherCity = patch.weatherCity.trim().slice(0, 60);
      store.weatherCache = null;
    }
    if (Array.isArray(patch.selectedSubjects)) {
      const list = Array.from(new Set(patch.selectedSubjects.filter((id) => SUBJECT_IDS.includes(id)))).slice(0, 6);
      if (list.length) store.selectedSubjects = list;
    }
    if (typeof patch.onboarded === 'boolean') store.onboarded = patch.onboarded;
    if (typeof patch.updateAutoCheck === 'boolean') store.updateAutoCheck = patch.updateAutoCheck;
    if (typeof patch.updateAutoDownload === 'boolean') store.updateAutoDownload = patch.updateAutoDownload;
    if (typeof patch.backupAuto === 'boolean') store.backupAuto = patch.backupAuto;
    if (typeof patch.backupDir === 'string') {
      const raw = patch.backupDir.trim();
      if (!raw) {
        store.backupDir = '';
      } else {
        const check = checkBackupDir(raw);
        if (!check.ok) return { ok: false, error: check.error };
        store.backupDir = check.dir;
      }
    }
    saveStore();
    appendLog('SETTINGS', { targetDate: store.targetDate, petScale });
    return {
      ok: true, targetDate: store.targetDate, skin: store.skin, petScale, petFreq: store.petFreq,
      updateUrl: store.updateUrl, weatherCity: store.weatherCity, selectedSubjects: store.selectedSubjects,
      onboarded: !!store.onboarded,
      updateAutoCheck: !!store.updateAutoCheck,
      updateAutoDownload: !!store.updateAutoDownload
    };
  });

  ipcMain.handle('app:set-auto-launch', (_e, enabled) => {
    const on = !!enabled;
    const res = setAutoLaunchEnabled(on);
    store.autoLaunch = res.enabled;
    saveStore();
    appendLog('AUTO_LAUNCH', { enabled: on, command: autoLaunchCommand(), ok: res.ok });
    return { ok: res.ok, enabled: res.enabled, actual: res.enabled, error: res.error };
  });

  ipcMain.handle('app:add-history', (_e, entry) => {
    if (!entry || typeof entry !== 'object' || !entry.date) return { ok: false, history: store.history };
    const idx = store.history.findIndex((h) => h.date === entry.date && h.no === entry.no);
    if (idx >= 0) store.history[idx] = entry;
    else store.history.unshift(entry);
    store.history = store.history.slice(0, 400);
    saveStore();
    appendLog('SIGN_DRAW', { date: entry.date, no: entry.no, level: entry.level, daysLeft: entry.daysLeft });
    return { ok: true, history: store.history };
  });

  /* 重要日子（多事件倒计时） */
  ipcMain.handle('app:save-events', (_e, list) => {
    store.events = normalizeEvents(list);
    saveStore();
    appendLog('EVENT_SAVE', { count: store.events.length });
    return { ok: true, events: store.events };
  });

  /* 数据导出 / 导入 */
  ipcMain.handle('app:export-data', async () => {
    try {
      const res = await dialog.showSaveDialog(win, {
        title: '导出高考倒计时数据',
        defaultPath: path.join(app.getPath('documents'), `高考倒计时数据-${dateKey()}.json`),
        filters: [{ name: 'JSON 数据文件', extensions: ['json'] }]
      });
      if (res.canceled || !res.filePath) return { ok: false, canceled: true };
      fs.writeFileSync(res.filePath, JSON.stringify(store, null, 2), 'utf8');
      appendLog('DATA_EXPORT', { file: res.filePath });
      return { ok: true, filePath: res.filePath };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });

  ipcMain.handle('app:import-data', async () => {
    try {
      const res = await dialog.showOpenDialog(win, {
        title: '导入高考倒计时数据',
        properties: ['openFile'],
        filters: [{ name: 'JSON 数据文件', extensions: ['json'] }]
      });
      if (res.canceled || !res.filePaths.length) return { ok: false, canceled: true };
      const raw = fs.readFileSync(res.filePaths[0], 'utf8');
      const data = JSON.parse(raw);
      if (!data || typeof data !== 'object') return { ok: false, error: '文件内容不是有效的数据' };
      runAutoBackup(true);
      if (typeof data.targetDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(data.targetDate)) store.targetDate = data.targetDate;
      if (SKINS.some((s) => s.id === data.skin)) store.skin = data.skin;
      if (data.petScale != null) {
        petScale = clampScale(data.petScale);
        store.petScale = petScale;
      }
      if (Array.isArray(data.history)) {
        store.history = data.history.filter((h) => h && typeof h === 'object' && h.date).slice(0, 400);
      }
      if (Array.isArray(data.selectedSubjects)) store.selectedSubjects = normalizeSubjects(data.selectedSubjects);
      if (Array.isArray(data.events)) store.events = normalizeEvents(data.events);
      if (data.classroom && typeof data.classroom === 'object') store.classroom = normalizeClassroom(data.classroom);
      if (typeof data.weatherCity === 'string') {
        store.weatherCity = data.weatherCity.trim().slice(0, 60);
        store.weatherCache = null;
      }
      if (typeof data.onboarded === 'boolean') store.onboarded = data.onboarded;
      if (typeof data.updateAutoCheck === 'boolean') store.updateAutoCheck = data.updateAutoCheck;
      if (typeof data.updateAutoDownload === 'boolean') store.updateAutoDownload = data.updateAutoDownload;
      if (typeof data.backupAuto === 'boolean') store.backupAuto = data.backupAuto;
      saveStore();
      appendLog('DATA_IMPORT', { file: res.filePaths[0] });
      return { ok: true, filePath: res.filePaths[0] };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });

  /* 数据备份位置：选择 / 恢复默认 / 打开所在文件夹 */
  ipcMain.handle('app:pick-backup-dir', async () => {
    try {
      const info = backupDirInfo();
      const res = await dialog.showOpenDialog(win, {
        title: '选择数据备份文件夹',
        defaultPath: fs.existsSync(info.dir) ? info.dir : info.defaultDir,
        buttonLabel: '用这个文件夹',
        properties: ['openDirectory', 'createDirectory']
      });
      if (res.canceled || !res.filePaths.length) return { ok: false, canceled: true };
      const check = checkBackupDir(res.filePaths[0]);
      if (!check.ok) return { ok: false, error: check.error };
      store.backupDir = check.dir;
      saveStore();
      appendLog('BACKUP_DIR', { dir: check.dir });
      runAutoBackup(true);
      return backupPayload();
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });

  ipcMain.handle('app:reset-backup-dir', () => {
    store.backupDir = '';
    saveStore();
    appendLog('BACKUP_DIR', { dir: defaultBackupDir(), reset: true });
    runAutoBackup(true);
    return backupPayload();
  });

  ipcMain.handle('app:open-backup-dir', async () => {
    const info = backupDirInfo();
    try { fs.mkdirSync(info.dir, { recursive: true }); } catch { /* 忽略 */ }
    const error = await shell.openPath(info.dir);
    return { ok: !error, path: info.dir, error: error || '' };
  });

  ipcMain.handle('window:set-fullscreen', (_e, on) => {
    if (!win || win.isDestroyed()) return { ok: false };
    win.setFullScreen(!!on);
    return { ok: true, fullscreen: win.isFullScreen() };
  });

  /* 彩蛋专用全屏：铺满当前显示器并置顶，结束后恢复到原来的窗口位置 */
  ipcMain.handle('window:set-egg-fullscreen', (_e, on) => {
    if (!win || win.isDestroyed()) return { ok: false };
    if (on) {
      if (eggFullscreen) return { ok: true };
      eggBounds = win.getBounds();
      const display = screen.getDisplayMatching(eggBounds);
      eggFullscreen = true;
      win.setAlwaysOnTop(true, 'screen-saver');
      win.setSkipTaskbar(true);
      win.setBounds(display.bounds);
      win.show();
      win.focus();
    } else if (eggFullscreen) {
      eggFullscreen = false;
      const b = eggBounds || store.panelBounds;
      eggBounds = null;
      win.setAlwaysOnTop(false);
      win.setSkipTaskbar(mode === 'pet');
      if (b) win.setBounds(b);
      win.show();
      win.focus();
    }
    return { ok: true };
  });

  /* 课堂全屏模式：铺满当前显示器，退出时精确恢复原来的窗口位置 */
  ipcMain.handle('window:set-class-fullscreen', (_e, on) => {
    if (!win || win.isDestroyed()) return { ok: false };
    if (on) {
      if (classFullscreen) return { ok: true };
      const bounds = win.getBounds();
      const display = screen.getDisplayMatching(bounds);
      classBounds = bounds;
      classFullscreen = true;
      win.setBounds(display.bounds);
      win.show();
    } else if (classFullscreen) {
      classFullscreen = false;
      const b = classBounds || store.panelBounds;
      classBounds = null;
      if (b) win.setBounds(b);
      win.show();
    }
    return { ok: true };
  });

  /* 课堂计时全屏：手动保存/恢复窗口尺寸，避免系统全屏切换残留大窗口 */
  ipcMain.handle('window:set-timer-fullscreen', (_e, on) => {
    if (!win || win.isDestroyed()) return { ok: false };
    if (on) {
      if (timerFullscreen) return { ok: true };
      const bounds = win.getBounds();
      const display = screen.getDisplayMatching(bounds);
      const alreadyFull = bounds.width >= display.bounds.width - 2 && bounds.height >= display.bounds.height - 2;
      timerBounds = alreadyFull ? (store.panelBounds || bounds) : bounds;
      timerFullscreen = true;
      win.setBounds(display.bounds);
      win.show();
    } else if (timerFullscreen) {
      timerFullscreen = false;
      const b = timerBounds || store.panelBounds;
      timerBounds = null;
      if (b) win.setBounds(b);
      win.show();
    }
    return { ok: true };
  });

  /* 计时背景：选择图片或动画，复制到数据目录后返回本地地址 */
  ipcMain.handle('timer:pick-background', async () => {
    if (!win || win.isDestroyed()) return { ok: false };
    const res = await dialog.showOpenDialog(win, {
      title: '选择计时背景动画或图片',
      properties: ['openFile'],
      filters: [
        { name: '图片', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp'] },
        { name: '视频', extensions: ['mp4', 'webm'] }
      ]
    });
    if (res.canceled || !res.filePaths.length) return { ok: false, canceled: true };
    const src = res.filePaths[0];
    const ext = path.extname(src).toLowerCase();
    try {
      const dir = path.join(USER_DIR, 'timer-bg');
      fs.mkdirSync(dir, { recursive: true });
      const dest = path.join(dir, 'timer-bg-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6) + ext);
      fs.copyFileSync(src, dest);
      appendLog('TIMER_BG', { ext });
      return { ok: true, url: pathToFileURL(dest).href, name: path.basename(src), ext };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });

  /* 删除已导入的计时背景：仅允许删除数据目录 timer-bg 内的文件 */
  ipcMain.handle('timer:delete-background', (_e, url) => {
    try {
      const file = fileURLToPath(String(url || ''));
      const dir = path.resolve(path.join(USER_DIR, 'timer-bg')) + path.sep;
      const resolved = path.resolve(file);
      if (!resolved.startsWith(dir)) return { ok: false, error: '路径不允许' };
      if (fs.existsSync(resolved)) fs.unlinkSync(resolved);
      appendLog('TIMER_BG_DEL', { file: path.basename(resolved) });
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });

  ipcMain.handle('weather:get', async () => {
    const cache = store.weatherCache;
    const fresh = cache && cache.data && cache.data.source === 'weather.com.cn' &&
      Array.isArray(cache.data.days) && cache.data.days.length &&
      cache.data.days[0].date === cnDate(0) &&
      Date.now() - cache.ts < 8 * 60 * 1000;
    if (fresh) return cache.data;
    try {
      const data = await fetchWeatherData();
      store.weatherCache = { ts: Date.now(), data };
      saveStore();
      appendLog('WEATHER_OK', { city: data.city, temp: data.temp, source: data.source });
      return data;
    } catch (e) {
      appendLog('WEATHER_ERR', { message: e.message });
      if (cache && cache.data) return Object.assign({}, cache.data, { stale: true });
      return { ok: false, error: e.message };
    }
  });

  /* 逐小时预报：按需获取，10 分钟内复用 */
  let hourlyCache = { key: '', ts: 0, hours: [] };
  ipcMain.handle('weather:hourly', async () => {
    const city = (store.weatherCity || (store.weatherCache && store.weatherCache.data && store.weatherCache.data.city) || '').trim();
    if (hourlyCache.hours.length && hourlyCache.key === city && Date.now() - hourlyCache.ts < 10 * 60 * 1000) {
      return { ok: true, hours: hourlyCache.hours, cached: true };
    }
    try {
      const hours = await fetchHourlyForecast(city);
      if (!hours.length) throw new Error('逐小时数据为空');
      hourlyCache = { key: city, ts: Date.now(), hours };
      appendLog('WEATHER_HOURLY_OK', { city, count: hours.length });
      return { ok: true, hours };
    } catch (e) {
      appendLog('WEATHER_HOURLY_FAIL', { message: e.message });
      return { ok: false, error: e.message, hours: [] };
    }
  });

  ipcMain.handle('app:check-update', async () => {
    // 测试版：返回固定的演示更新，不访问 GitHub 或任何更新源
    if (isTestBuildApp()) {
      const current = app.getVersion();
      const latest = '2.2.7-test';
      appendLog('UPDATE_CHECK', { latest, current, hasUpdate: true, source: 'test-fake' });
      return {
        configured: true,
        ok: true,
        current,
        latest,
        notes: '测试版演示更新（不读取 GitHub）',
        notesFull: '这是测试版的假更新推送，不会访问 GitHub 或任何更新源。\n- 用于验证更新公告与更新按钮\n- 新增课堂计时自定义时长、最后 10 秒提示音与自动全屏\n- 测试数据与上课 / 放学状态一键切换',
        highlights: ['测试版假更新，不访问 GitHub', '课堂计时支持自定义时长与自动全屏', '测试数据与桌宠状态一键切换'],
        url: '',
        pageUrl: '',
        mirrors: [],
        setupUrl: '',
        portableUrl: '',
        setupMirrors: [],
        portableMirrors: [],
        downloaded: false,
        downloadFilePath: '',
        downloading: false,
        hasUpdate: true,
        source: 'test-fake'
      };
    }
    const current = app.getVersion();
    let latest = '';
    let notes = '';
    let notesFull = '';
    let highlights = [];
    let downloadUrl = '';
    let setupUrl = '';
    let portableUrl = '';
    let pageUrl = REPO_URL + '/releases/latest';
    let source = '';

    const gh = parseGitHubRepo(store.updateUrl || DEFAULT_UPDATE_URL);
    if (gh) {
      const api = 'https://api.github.com/repos/' + gh.owner + '/' + gh.repo + '/releases/latest';
      const readRelease = (info, from) => {
        if (!info || !info.tag_name) return false;
        latest = String(info.tag_name).replace(/^v/i, '').trim();
        notes = String(info.body || '').replace(/\s+/g, ' ').slice(0, 200);
        notesFull = String(info.body || '').slice(0, 1500);
        highlights = notesFull
          .split(/\r?\n/)
          .map((line) => line.replace(/^[\s\-*•·]+/, '').trim())
          .filter(Boolean)
          .slice(0, 8);
        pageUrl = String(info.html_url || pageUrl);
        const assets = Array.isArray(info.assets) ? info.assets : [];
        const exeAssets = assets.filter((a) => /\.exe$/i.test(String(a.name || '')));
        const setupAsset = exeAssets.find((a) => /setup|安装/i.test(String(a.name || '')));
        const portableAsset = exeAssets.find((a) => /portable|便携/i.test(String(a.name || '')))
          || exeAssets.find((a) => !/setup|安装/i.test(String(a.name || '')));
        setupUrl = setupAsset ? String(setupAsset.browser_download_url || '') : '';
        portableUrl = portableAsset ? String(portableAsset.browser_download_url || '') : '';
        downloadUrl = setupUrl || portableUrl;
        source = from;
        return !!latest;
      };
      try {
        readRelease(await fetchJson(api, 9000), 'github');
      } catch (e) {
        appendLog('UPDATE_API_FAIL', { message: e.message });
      }
      // 直连 GitHub API 失败时，走国内镜像代理再试
      if (!latest) {
        for (const prefix of UPDATE_API_MIRRORS) {
          try {
            if (readRelease(await fetchJson(prefix + api, 9000), 'mirror')) break;
          } catch { /* 换下一个镜像 */ }
        }
      }
    }

    // GitHub 与镜像都不可达时，改用 jsDelivr 更新清单
    if (!latest) {
      for (const manifest of UPDATE_MANIFESTS) {
        try {
          const info = await fetchJson(manifest, 8000);
          const v = String((info && info.version) || '').trim();
          if (!v) continue;
          latest = v;
          notes = String(info.notes || '').slice(0, 200);
          notesFull = String(info.notes || '').slice(0, 1500);
          highlights = notesFull ? notesFull.split(/[；;。]\s*/).map((s) => s.trim()).filter(Boolean).slice(0, 6) : [];
          downloadUrl = '';
          pageUrl = REPO_URL + '/releases/latest';
          source = 'jsdelivr';
          break;
        } catch { /* 换下一个 CDN */ }
      }
    }

    if (!latest) {
      appendLog('UPDATE_ERR', { message: '更新源均不可用' });
      return { configured: true, ok: false, error: '网络不可用，稍后会自动重试', current };
    }

    const hasUpdate = versionCmp(latest, current) > 0;
    // 直连优先：GitHub 自己的 CDN 通常比公益镜像快，失败再自动切换镜像
    const mirrors = downloadUrl ? [downloadUrl].concat(UPDATE_MIRRORS.map((prefix) => prefix + downloadUrl)) : [];
    const setupMirrors = setupUrl ? [setupUrl].concat(UPDATE_MIRRORS.map((prefix) => prefix + setupUrl)) : [];
    const portableMirrors = portableUrl ? [portableUrl].concat(UPDATE_MIRRORS.map((prefix) => prefix + portableUrl)) : [];
    const downloaded = !!(updateTask.done && updateTask.version === latest && updateTask.filePath && fs.existsSync(updateTask.filePath));
    appendLog('UPDATE_CHECK', { latest, current, hasUpdate, source, setup: !!setupUrl });
    return {
      configured: true,
      ok: true,
      current,
      latest,
      notes,
      notesFull,
      highlights,
      url: downloadUrl || pageUrl,
      pageUrl,
      mirrors,
      setupUrl,
      portableUrl,
      setupMirrors,
      portableMirrors,
      downloaded,
      downloadFilePath: downloaded ? updateTask.filePath : '',
      downloading: !!updateTask.downloading && updateTask.version === latest,
      hasUpdate,
      source
    };
  });

  /* 后台静默下载安装包，支持进度事件 */
  const downloadUpdatePackage = async (sender, payload) => {
    const version = String((payload && payload.version) || '').trim();
    const urls = ((payload && payload.urls) || []).filter((u) => typeof u === 'string' && /^https?:\/\//i.test(u));
    if (!version) return { ok: false, error: '缺少版本号' };
    if (!urls.length) return { ok: false, error: '没有可用的下载地址' };
    if (updateTask.downloading) {
      return { ok: false, error: '正在下载中', downloading: true };
    }
    const fileName = `GaokaoCountdown-Setup-${version}.exe`;
    const dirs = updateDirs();

    // 已有完整安装包直接复用
    for (const dir of dirs) {
      const filePath = path.join(dir, fileName);
      try {
        if (fs.existsSync(filePath) && fs.statSync(filePath).size > 20 * 1024 * 1024) {
          updateTask = { version, filePath, downloading: false, done: true };
          return { ok: true, filePath, version, cached: true };
        }
      } catch { /* 忽略 */ }
    }

    updateTask = { version, filePath: '', downloading: true, done: false };
    let lastError = '下载失败';
    let fsFailure = false;

    for (const url of urls) {
      for (const dir of dirs) {
        const filePath = path.join(dir, fileName);
        const tmp = `${filePath}.${process.pid}.${Date.now()}.part`;
        try {
          fs.mkdirSync(dir, { recursive: true });
          // 清理同目录遗留的临时分片（被占用时忽略）
          try {
            fs.readdirSync(dir)
              .filter((f) => f.endsWith('.part'))
              .forEach((f) => { try { fs.unlinkSync(path.join(dir, f)); } catch { /* 忽略 */ } });
          } catch { /* 忽略 */ }

          const mode = await downloadAssetToFile(url, tmp, sender, version);
          if (fs.statSync(tmp).size < 20 * 1024 * 1024) throw new Error('安装包大小异常');
          // 镜像有时会返回 HTML 错误页，用 PE 头再确认一次
          if (!hasExeHeader(tmp)) throw new Error('下载内容不是有效的安装包');
          renameWithRetry(tmp, filePath);
          updateTask = { version, filePath, downloading: false, done: true };
          if (sender && !sender.isDestroyed()) {
            sender.send('update:downloaded', { version, filePath });
          }
          appendLog('UPDATE_DOWNLOADED', { version, size: fs.statSync(filePath).size, dir, mode });
          return { ok: true, filePath, version };
        } catch (e) {
          lastError = e.message;
          fsFailure = /EPERM|EACCES|EBUSY|ENOSPC|EROFS|EMFILE|ENFILE|EEXIST|ENOTDIR|EISDIR|EINVAL/.test(String(e.code || '') + ' ' + String(e.message || ''));
          try { if (fs.existsSync(tmp)) fs.unlinkSync(tmp); } catch { /* 忽略 */ }
          appendLog('UPDATE_DOWNLOAD_FAIL', { url, dir, message: e.message, fs: fsFailure });
        }
        // 文件权限问题换下一个目录重试；网络问题换下一个下载地址
        if (!fsFailure) break;
      }
    }

    updateTask = { version, filePath: '', downloading: false, done: false };
    const friendly = fsFailure
      ? '无法写入下载目录（可能被杀毒软件拦截），请关闭拦截后重试'
      : lastError;
    if (sender && !sender.isDestroyed()) sender.send('update:error', { version, error: friendly });
    return { ok: false, error: friendly };
  };

  ipcMain.handle('app:update-download', (event, payload) => downloadUpdatePackage(event.sender, payload));

  /* 点击安装：静默运行安装程序，安装完成后自动启动；无安装包时打开下载页 */
  ipcMain.handle('app:install-update', async (_e, filePath) => {
    try {
      const setup = String(filePath || updateTask.filePath || '');
      if (!setup || !fs.existsSync(setup)) {
        try { shell.openExternal(`${REPO_URL}/releases/latest`); } catch { /* 忽略 */ }
        return { ok: false, manual: true, error: '安装包不存在，已打开下载页，请手动下载安装' };
      }
      const portable = process.env.PORTABLE_EXECUTABLE_FILE;
      const oldPortable = portable && fs.existsSync(portable) ? path.resolve(portable) : '';
      store.pendingCleanup = Array.from(new Set([oldPortable, setup].filter(Boolean)));
      store.pendingInstallUpdate = '';
      saveStore();

      installerLaunched = true;
      const args = ['/S', '--updated', '--force-run'];
      const launched = await new Promise((resolve) => {
        let done = false;
        const finish = (result) => {
          if (done) return;
          done = true;
          resolve(result);
        };
        let child = null;
        try {
          child = spawn(setup, args, { detached: true, stdio: 'ignore', windowsHide: true });
        } catch (e) {
          finish({ ok: false, error: e.message });
          return;
        }
        child.once('error', (e) => finish({ ok: false, error: e.message }));
        child.once('spawn', () => {
          try { child.unref(); } catch { /* 忽略 */ }
          finish({ ok: true });
        });
        setTimeout(() => {
          try { child.unref(); } catch { /* 忽略 */ }
          finish({ ok: true });
        }, 1500);
      });

      if (launched.ok) {
        appendLog('UPDATE_INSTALL', { setup, oldPortable, mode: 'silent', args: args.join(' ') });
      } else {
        // 静默启动失败时回退到交互式安装，用户手动完成安装后仍会自动启动
        appendLog('UPDATE_INSTALL_FALLBACK', { setup, message: launched.error });
        const openError = await shell.openPath(setup);
        appendLog('UPDATE_INSTALL', { setup, oldPortable, openError, mode: 'interactive' });
      }
      setTimeout(() => quitApp(), 700);
      return { ok: true };
    } catch (e) {
      appendLog('UPDATE_INSTALL_ERR', { message: e.message });
      return { ok: false, error: e.message };
    }
  });

  /* 稍后更新：退出程序时再启动安装程序 */
  ipcMain.handle('app:defer-install', (_e, filePath) => {
    const setup = String(filePath || updateTask.filePath || '');
    if (!setup || !fs.existsSync(setup)) return { ok: false, error: '安装包不存在' };
    store.pendingInstallUpdate = setup;
    saveStore();
    appendLog('UPDATE_DEFER', { setup });
    return { ok: true };
  });

  /* 下载更新：优先选择能连通的国内镜像，再交给系统浏览器打开 */
  ipcMain.handle('app:download-update', async (_e, urls) => {
    const list = (Array.isArray(urls) ? urls : [urls]).filter((u) => typeof u === 'string' && /^https?:\/\//i.test(u));
    for (const u of list) {
      const ac = new AbortController();
      const timer = setTimeout(() => ac.abort(), 6000);
      try {
        const res = await net.fetch(u, {
          method: 'HEAD',
          signal: ac.signal,
          headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }
        });
        clearTimeout(timer);
        if (res.ok || res.status === 405 || res.status === 403) {
          shell.openExternal(u);
          appendLog('UPDATE_DOWNLOAD_OPEN', { url: u });
          return { ok: true, url: u };
        }
      } catch {
        clearTimeout(timer);
      }
    }
    if (list.length) {
      shell.openExternal(list[0]);
      return { ok: true, url: list[0], unverified: true };
    }
    return { ok: false };
  });

  ipcMain.handle('app:open-url', (_e, url) => {
    try {
      if (typeof url !== 'string' || !/^https?:\/\//i.test(url)) return { ok: false };
      shell.openExternal(url);
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });

  ipcMain.handle('app:save-image', async (_e, dataUrl, name) => {
    try {
      if (typeof dataUrl !== 'string' || !dataUrl.startsWith('data:image/png;base64,')) {
        return { ok: false, error: 'invalid image' };
      }
      const safeName = String(name || '幸运签.png').replace(/[\\/:*?"<>|]/g, '_');
      const { canceled, filePath } = await dialog.showSaveDialog(win, {
        title: '保存签卡',
        defaultPath: path.join(app.getPath('downloads'), safeName),
        filters: [{ name: 'PNG 图片', extensions: ['png'] }]
      });
      if (canceled || !filePath) return { ok: false, canceled: true };
      const base64 = dataUrl.split(',')[1];
      fs.writeFileSync(filePath, Buffer.from(base64, 'base64'));
      appendLog('SIGN_CARD_SAVED', { file: filePath });
      return { ok: true, filePath };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });

  ipcMain.on('app:log', (_e, event, detail) => appendLog(String(event || 'CLIENT'), detail));

  ipcMain.handle('window:set-pet-mode', (_e, on) => {
    applyPetMode(!!on);
    return { mode };
  });
  ipcMain.handle('window:change-scale', (_e, delta) => {
    changeScale(Number(delta) || 0);
    return { scale: petScale };
  });
  ipcMain.handle('knowledge:open', () => {
    openKnowledgeWindow();
    return { ok: true };
  });
  ipcMain.on('knowledge:close', () => goHomeView());

  ipcMain.on('window:hide', () => {
    if (win && !win.isDestroyed()) win.hide();
    appendLog('WINDOW_HIDE', { source: 'renderer' });
  });
  ipcMain.on('app:quit', quitApp);

  /* ---------------- 课堂助手 IPC ---------------- */
  const adminGuard = () => (classroomUnlocked ? null : { ok: false, error: '请先进入管理员模式' });

  ipcMain.handle('classroom:open', () => {
    openClassroomWindow();
    return { ok: true };
  });

  /* 从设置页版本号进入管理员模式 */
  ipcMain.handle('classroom:open-admin', () => {
    openClassroomWindow({ admin: true });
    return { ok: true };
  });
  ipcMain.on('classroom:close', () => goHomeView());

  /* 课程表（独立页面） */
  ipcMain.handle('timetable:open', () => {
    openTimetableView();
    return { ok: true };
  });
  ipcMain.on('timetable:close', () => goHomeView());

  // 内置动画背景：视频用 asarUnpack 解包，file:// 必须指向 app.asar.unpacked 里的真实文件
  ipcMain.handle('classroom:builtin-bgs', () => {
    try {
      const baseDir = path.join(__dirname, 'assets', 'bg')
        .replace(/app\.asar([\\/])/, 'app.asar.unpacked$1');
      const urls = {};
      ['builtin-1.mp4', 'builtin-2.mp4'].forEach((name) => {
        const full = path.join(baseDir, name);
        try {
          if (fs.existsSync(full)) urls[name] = pathToFileURL(full).href;
        } catch (e) { /* 单个文件缺失时跳过 */ }
      });
      return { ok: true, dir: baseDir, urls };
    } catch (e) {
      return { ok: false, urls: {} };
    }
  });

  ipcMain.handle('classroom:get', () => classroomPublicData());

  ipcMain.handle('classroom:admin-status', () => ({
    hasPassword: adminHasPassword(),
    unlocked: classroomUnlocked
  }));

  ipcMain.handle('classroom:admin-data', () => {
    const guard = adminGuard();
    if (guard) return guard;
    return { ok: true, data: classroomAdminData() };
  });

  ipcMain.handle('classroom:admin-setup', (_e, password) => {
    if (adminHasPassword()) return { ok: false, error: '管理员密码已设置' };
    const pw = String(password || '');
    if (pw.length < 4) return { ok: false, error: '密码至少 4 位' };
    store.classroom.passwordSalt = crypto.randomBytes(16).toString('hex');
    store.classroom.passwordHash = hashPassword(pw, store.classroom.passwordSalt);
    classroomUnlocked = true;
    saveStore();
    appendLog('ADMIN_SETUP', {});
    return { ok: true, data: classroomAdminData() };
  });

  ipcMain.handle('classroom:admin-login', (_e, password) => {
    if (!adminVerify(password)) {
      appendLog('ADMIN_LOGIN_FAIL', {});
      return { ok: false, error: '密码不正确' };
    }
    classroomUnlocked = true;
    appendLog('ADMIN_LOGIN', {});
    return { ok: true, data: classroomAdminData() };
  });

  ipcMain.handle('classroom:admin-lock', () => {
    classroomUnlocked = false;
    return { ok: true };
  });

  ipcMain.handle('classroom:admin-change-password', (_e, oldPassword, newPassword) => {
    const guard = adminGuard();
    if (guard) return guard;
    if (!adminVerify(oldPassword)) return { ok: false, error: '原密码不正确' };
    const pw = String(newPassword || '');
    if (pw.length < 4) return { ok: false, error: '新密码至少 4 位' };
    store.classroom.passwordSalt = crypto.randomBytes(16).toString('hex');
    store.classroom.passwordHash = hashPassword(pw, store.classroom.passwordSalt);
    saveStore();
    appendLog('ADMIN_PASSWORD_CHANGE', {});
    return { ok: true };
  });

  ipcMain.handle('classroom:import-rosters', (_e, paths) => {
    const res = importRosterFiles(paths);
    res.data = classroomPublicData();
    return res;
  });

  ipcMain.handle('classroom:create-roster', (_e, name) => {
    const roster = {
      id: uid('r'),
      name: String(name || '新名单').slice(0, 40),
      createdAt: Date.now(),
      names: [],
      lastPickId: ''
    };
    store.classroom.rosters.push(roster);
    if (!store.classroom.activeRosterId) store.classroom.activeRosterId = roster.id;
    saveStore();
    return { ok: true, rosterId: roster.id, data: classroomPublicData() };
  });

  ipcMain.handle('classroom:set-active', (_e, id) => {
    if (!store.classroom.rosters.some((r) => r.id === id)) return { ok: false };
    store.classroom.activeRosterId = id;
    saveStore();
    return { ok: true };
  });

  ipcMain.handle('classroom:rename-roster', (_e, id, name) => {
    const guard = adminGuard();
    if (guard) return guard;
    const roster = store.classroom.rosters.find((r) => r.id === id);
    if (!roster) return { ok: false, error: '名单不存在' };
    roster.name = String(name || '').trim().slice(0, 40) || roster.name;
    saveStore();
    return { ok: true, data: classroomAdminData() };
  });

  ipcMain.handle('classroom:delete-roster', (_e, id) => {
    const guard = adminGuard();
    if (guard) return guard;
    store.classroom.rosters = store.classroom.rosters.filter((r) => r.id !== id);
    if (!store.classroom.rosters.some((r) => r.id === store.classroom.activeRosterId)) {
      store.classroom.activeRosterId = store.classroom.rosters.length ? store.classroom.rosters[0].id : '';
    }
    saveStore();
    appendLog('ROSTER_DELETE', { id });
    return { ok: true, data: classroomAdminData() };
  });

  ipcMain.handle('classroom:add-names', (_e, rosterId, text) => {
    const guard = adminGuard();
    if (guard) return guard;
    const roster = store.classroom.rosters.find((r) => r.id === rosterId);
    if (!roster) return { ok: false, error: '名单不存在' };
    const names = parseNameText(text);
    const exists = new Set(roster.names.map((n) => n.name));
    const added = [];
    names.forEach((name) => {
      if (exists.has(name)) return;
      exists.add(name);
      roster.names.push({ id: uid('n'), name, weight: 1, count: 0, pickedAt: 0 });
      added.push(name);
    });
    saveStore();
    return { ok: true, added: added.length, data: classroomAdminData() };
  });

  ipcMain.handle('classroom:update-name', (_e, rosterId, nameId, patch) => {
    const guard = adminGuard();
    if (guard) return guard;
    const roster = store.classroom.rosters.find((r) => r.id === rosterId);
    const target = roster && roster.names.find((n) => n.id === nameId);
    if (!target) return { ok: false, error: '学生不存在' };
    if (patch && typeof patch.name === 'string') {
      const name = patch.name.trim().slice(0, 30);
      if (name) target.name = name;
    }
    if (patch && patch.weight != null) target.weight = clampWeight(patch.weight);
    saveStore();
    return { ok: true, data: classroomAdminData() };
  });

  ipcMain.handle('classroom:remove-name', (_e, rosterId, nameId) => {
    const guard = adminGuard();
    if (guard) return guard;
    const roster = store.classroom.rosters.find((r) => r.id === rosterId);
    if (!roster) return { ok: false };
    roster.names = roster.names.filter((n) => n.id !== nameId);
    saveStore();
    return { ok: true, data: classroomAdminData() };
  });

  ipcMain.handle('classroom:reset-counts', (_e, rosterId) => {
    const guard = adminGuard();
    if (guard) return guard;
    const roster = store.classroom.rosters.find((r) => r.id === rosterId);
    if (!roster) return { ok: false };
    roster.names.forEach((n) => { n.count = 0; n.pickedAt = 0; });
    roster.lastPickId = '';
    roster.roundIds = [];
    saveStore();
    return { ok: true, data: classroomAdminData() };
  });

  ipcMain.handle('classroom:draw', (_e, rosterId, count, options) => drawFromRoster(rosterId, count, options));

  // 课堂页一键重置抽取次数（重复 / 不重复共用）
  ipcMain.handle('classroom:reset-draw', (_e, rosterId) => {
    const roster = store.classroom.rosters.find((r) => r.id === rosterId);
    if (!roster) return { ok: false, error: '名单不存在' };
    roster.names.forEach((n) => { n.count = 0; n.pickedAt = 0; });
    roster.lastPickId = '';
    roster.roundIds = [];
    saveStore();
    return { ok: true };
  });

  /* 管理员：清空 / 恢复签运簿（误触可回退） */
  ipcMain.handle('classroom:clear-history', () => {
    const guard = adminGuard();
    if (guard) return guard;
    runAutoBackup(true);
    historyBackup = store.history.slice();
    store.history = [];
    saveStore();
    appendLog('HISTORY_CLEAR', { count: historyBackup.length });
    return { ok: true, count: historyBackup.length, data: classroomAdminData() };
  });

  ipcMain.handle('classroom:restore-history', () => {
    const guard = adminGuard();
    if (guard) return guard;
    if (!historyBackup) return { ok: false, error: '没有可恢复的数据' };
    store.history = historyBackup.slice();
    const count = store.history.length;
    historyBackup = null;
    saveStore();
    appendLog('HISTORY_RESTORE', { count });
    return { ok: true, count, data: classroomAdminData() };
  });

  ipcMain.handle('classroom:save-timetable', (_e, timetable) => {
    store.classroom.timetable = normalizeTimetable(timetable);
    saveStore();
    return { ok: true, timetable: store.classroom.timetable };
  });

  ipcMain.handle('classroom:parse-sheet', (_e, filePath) => {
    try {
      const sheets = readWorkbookSheets(String(filePath || ''));
      return { ok: true, rows: sheets[0].rows, sheets };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });

  ipcMain.handle('admin:set-debug', (_e, on) => {
    const guard = adminGuard();
    if (guard) return guard;
    store.debugMode = !!on;
    saveStore();
    broadcastDebugMode();
    appendLog('DEBUG_MODE', { on: store.debugMode });
    return { ok: true, debugMode: store.debugMode };
  });

  ipcMain.handle('admin:trigger-draw', () => {
    const guard = adminGuard();
    if (guard) return guard;
    showPanel();
    setTimeout(() => {
      if (win && !win.isDestroyed()) win.webContents.send('debug:preview');
    }, 260);
    return { ok: true };
  });

  /* 测试版控制面板：独立窗口，命令转发给主界面执行 */
  ipcMain.handle('test:open', () => openTestPanel());
  ipcMain.handle('test:close', () => {
    if (testWin && !testWin.isDestroyed()) testWin.close();
    return { ok: true };
  });
  /* 测试版：一键写入示例名单与课程表，方便直接演示 */
  ipcMain.handle('test:seed-data', (_e, kind) => {
    if (!isTestBuildApp()) return { ok: false, error: '仅测试版可用' };
    const what = String(kind || 'all');
    const result = { ok: true, roster: false, timetable: false };
    if (what === 'clean') {
      const before = store.classroom.rosters.length;
      store.classroom.rosters = store.classroom.rosters.filter((r) => r.name !== '测试班级（示例）');
      if (!store.classroom.rosters.some((r) => r.id === store.classroom.activeRosterId)) {
        store.classroom.activeRosterId = store.classroom.rosters.length ? store.classroom.rosters[0].id : '';
      }
      // 课程表从当天启动备份恢复，避免测试数据覆盖真实课表
      try {
        const file = path.join(backupDir(), `store-${dateKey()}.json`);
        if (fs.existsSync(file)) {
          const backup = JSON.parse(fs.readFileSync(file, 'utf8'));
          if (backup.classroom && backup.classroom.timetable) {
            store.classroom.timetable = normalizeTimetable(backup.classroom.timetable);
            result.timetable = true;
          }
        }
      } catch { /* 忽略恢复失败 */ }
      saveStore();
      appendLog('TEST_SEED', { kind: what });
      result.removed = before - store.classroom.rosters.length;
      return result;
    }
    if (what === 'roster' || what === 'all') {
      let roster = store.classroom.rosters.find((r) => r.name === '测试班级（示例）');
      if (!roster) {
        roster = {
          id: uid('r'),
          name: '测试班级（示例）',
          createdAt: Date.now(),
          names: [],
          lastPickId: '',
          roundIds: []
        };
        store.classroom.rosters.push(roster);
      }
      const exists = new Set(roster.names.map((n) => n.name));
      ['张明', '李华', '王芳', '刘洋', '陈晨', '杨帆', '赵磊', '周悦', '吴桐', '徐宁', '孙可', '马骁', '朱琳', '胡佳', '高远', '林夏']
        .forEach((name) => {
          if (exists.has(name)) return;
          exists.add(name);
          roster.names.push({ id: uid('n'), name, weight: 1, count: 0, pickedAt: 0 });
        });
      store.classroom.activeRosterId = roster.id;
      result.roster = true;
    }
    if (what === 'timetable' || what === 'all') {
      store.classroom.timetable = demoTimetable();
      result.timetable = true;
    }
    saveStore();
    appendLog('TEST_SEED', { kind: what });
    return result;
  });

  ipcMain.handle('test:run', (_e, action) => {
    if (!isTestBuildApp()) return { ok: false, error: '仅测试版可用' };
    const name = String(action || '');
    if (name === 'showmain') {
      showPanel();
      return { ok: true };
    }
    if (!win || win.isDestroyed()) return { ok: false, error: '主窗口不可用' };
    win.webContents.send('test:action', name);
    return { ok: true };
  });
}

/* ---------------- 全局快捷键 ---------------- */
function registerGlobalShortcuts() {
  const list = [
    ['CommandOrControl+Alt+K', () => openClassroomWindow()],
    ['CommandOrControl+Alt+G', () => showPanel()]
  ];
  list.forEach(([accel, handler]) => {
    try {
      if (!globalShortcut.register(accel, handler)) appendLog('SHORTCUT_FAIL', { accel });
    } catch (e) {
      appendLog('SHORTCUT_FAIL', { accel, message: e.message });
    }
  });
}

/* ---------------- 生命周期 ---------------- */
process.on('uncaughtException', (err) => {
  const detail = (err && (err.stack || err.message)) || String(err);
  try { appendLog('MAIN_ERROR', { message: String(detail).slice(0, 600) }); } catch { /* 忽略 */ }
  // 不弹阻塞式对话框，避免用户无法继续点击界面
  try {
    if (tray && !tray.isDestroyed()) {
      tray.displayBalloon({
        title: '程序遇到一点问题',
        content: '错误已写入启动日志，可稍后重试。'
      });
    }
  } catch { /* 忽略 */ }
});
process.on('unhandledRejection', (reason) => {
  const detail = (reason && (reason.stack || reason.message)) || String(reason);
  try { appendLog('MAIN_ERROR', { message: 'Promise: ' + String(detail).slice(0, 600) }); } catch { /* 忽略 */ }
});

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', (_e, argv) => {
    showPanel();
    if (Array.isArray(argv) && argv.includes('--classroom')) {
      openClassroomWindow();
    }
  });

  app.whenReady().then(() => {
    ensureDirs();
    runPendingCleanup();
    if (store.pendingInstallUpdate && !fs.existsSync(store.pendingInstallUpdate)) {
      store.pendingInstallUpdate = '';
      saveStore();
    }
    const today = dateKey();
    firstTodayLaunch = store.lastLaunchDate !== today;
    store.lastLaunchDate = today;
    store.autoLaunch = readAutoLaunch();
    // 旧版本的自启命令带 --pet，升级后统一重写为直接打开主界面
    if (store.autoLaunch) {
      try { setAutoLaunchEnabled(true); } catch { /* 忽略 */ }
    }
    saveStore();
    appendLog('APP_START', { firstToday: firstTodayLaunch, version: app.getVersion() });
    runAutoBackup(false);

    app.setAppUserModelId('com.trae.gaokao.countdown');
    createWindow();
    createTray();
    wireIpc();
    registerGlobalShortcuts();
    if (isTestBuildApp()) {
      setTimeout(() => openTestPanel(), 1600);
    }
    if (process.argv.includes('--classroom')) {
      setTimeout(() => openClassroomWindow(), 500);
    }

    screen.on('display-metrics-changed', () => {
      if (mode === 'pet' && win) applyPetMode(true);
    });
  });

  app.on('window-all-closed', () => {
    // 托盘常驻：不退出
    if (process.platform !== 'win32') app.quit();
  });

  app.on('will-quit', () => {
    try { globalShortcut.unregisterAll(); } catch { /* 忽略 */ }
    try { if (testWin && !testWin.isDestroyed()) testWin.destroy(); } catch { /* 忽略 */ }
    flushStore();
    flushLogsSync();
  });

  app.on('before-quit', () => {
    quitting = true;
    // 用户选择“稍后更新”：退出主程序时启动安装向导
    if (!installerLaunched && store.pendingInstallUpdate && fs.existsSync(store.pendingInstallUpdate)) {
      const setup = store.pendingInstallUpdate;
      const portable = process.env.PORTABLE_EXECUTABLE_FILE;
      const oldPortable = portable && fs.existsSync(portable) ? path.resolve(portable) : '';
      store.pendingCleanup = Array.from(new Set([...(store.pendingCleanup || []), oldPortable, setup].filter(Boolean)));
      store.pendingInstallUpdate = '';
      installerLaunched = true;
      saveStore();
      try {
        spawnSilentInstaller(setup);
        appendLog('UPDATE_INSTALL_ON_QUIT', { setup, mode: 'silent' });
      } catch (e) {
        appendLog('UPDATE_INSTALL_ON_QUIT_ERR', { message: e.message });
      }
    }
    saveStore();
    flushStore();
  });
}
