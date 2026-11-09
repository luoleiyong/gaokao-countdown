'use strict';
/*
 * 高考倒计时 · 桌面宠物（Windows）
 * 主进程：窗口/宠物层级、托盘、开机自启、本地存储、启动日志
 */
const { app, BrowserWindow, ipcMain, Menu, Tray, nativeImage, screen, dialog, net, shell } = require('electron');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFile, execFileSync } = require('child_process');

let XLSX = null;
try { XLSX = require('xlsx'); } catch { /* 缺少表格组件时仅支持 txt/csv */ }

const USER_DIR = path.join(app.getPath('appData'), 'GaokaoCountdown');
const STORE_FILE = path.join(USER_DIR, 'store.json');
const LOG_DIR = path.join(USER_DIR, 'logs');
const LOG_FILE = path.join(LOG_DIR, 'launch.log');

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
  classroom: null
};

let win = null;
let knowledgeWin = null;
let knowledgeSubjectsKey = '';
let classroomWin = null;
let classroomUnlocked = false;
let tray = null;
let quitting = false;
let mode = 'panel';
let firstTodayLaunch = false;
let petScale = 1;
let panelBounds = null;
let saveBoundsTimer = null;
let updateTask = { version: '', filePath: '', downloading: false, done: false };

function updateDir() {
  return path.join(app.getPath('temp'), 'GaokaoCountdownUpdate');
}

/* ---------------- 存储 & 日志 ---------------- */
function ensureDirs() {
  fs.mkdirSync(USER_DIR, { recursive: true });
  fs.mkdirSync(LOG_DIR, { recursive: true });
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
  return {
    title: '我的课程表',
    days: TIMETABLE_DAYS.slice(),
    periods: times.map((time, i) => ({
      id: 'p' + (i + 1),
      label: `第${i + 1}节`,
      time,
      cells: ['', '', '', '', '', '', '']
    }))
  };
}
function normalizeTimetable(input) {
  const def = defaultTimetable();
  const t = input && typeof input === 'object' ? input : null;
  if (!t || !Array.isArray(t.periods) || !t.periods.length) return def;
  return {
    title: String(t.title || def.title).slice(0, 40),
    days: Array.isArray(t.days) && t.days.length === 7 ? t.days.map((d) => String(d).slice(0, 6)) : def.days,
    periods: t.periods.slice(0, 16).map((p, i) => ({
      id: typeof p.id === 'string' && p.id ? p.id : 'p' + (i + 1),
      label: String(p.label || `第${i + 1}节`).slice(0, 12),
      time: String(p.time || '').slice(0, 24),
      cells: Array.from({ length: 7 }, (_, j) => {
        const v = Array.isArray(p.cells) ? p.cells[j] : '';
        return String(v == null ? '' : v).slice(0, 30);
      })
    }))
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
    lastPickId: typeof input.lastPickId === 'string' ? input.lastPickId : ''
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
    // 更新源固定为项目仓库，避免旧配置残留
    merged.updateUrl = DEFAULT_UPDATE_URL;
    return merged;
  } catch {
    const fresh = Object.assign({}, STORE_DEFAULTS);
    fresh.classroom = defaultClassroom();
    return fresh;
  }
}
const store = loadStore();
petScale = clampScale(store.petScale);

function saveStore() {
  try {
    ensureDirs();
    const tmp = STORE_FILE + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(store, null, 2), 'utf8');
    fs.renameSync(tmp, STORE_FILE);
  } catch { /* 忽略写盘失败，不影响主流程 */ }
}
function appendLog(event, detail) {
  try {
    ensureDirs();
    const line = `[${new Date().toISOString()}] ${event} ${JSON.stringify(detail || {})}\n`;
    fs.appendFileSync(LOG_FILE, line, 'utf8');
  } catch { /* 忽略 */ }
}
function readLogs(limit = 40) {
  try {
    const lines = fs.readFileSync(LOG_FILE, 'utf8').split(/\r?\n/).filter(Boolean);
    return lines.slice(-limit).reverse();
  } catch {
    return [];
  }
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
    const geo = await fetchJson(
      'https://geocoding-api.open-meteo.com/v1/search?name=' +
        encodeURIComponent(cityPref) + '&count=1&language=zh&format=json',
      7000
    );
    const hit = geo && geo.results && geo.results[0];
    if (!hit) throw new Error('未找到城市：' + cityPref);
    return { city: hit.name, lat: hit.latitude, lon: hit.longitude, source: 'city' };
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

async function fetchWeatherData() {
  // 主源：中国天气网（国内可直连）
  try {
    const cnLoc = await resolveCnCity();
    const cn = await fetchCnWeather(cnLoc);
    if (cn) return cn;
  } catch (e) {
    appendLog('WEATHER_CN_FAIL', { message: e.message });
  }

  // 备用源：Open-Meteo（海外网络环境）
  const loc = await resolveLocation();
  const url = 'https://api.open-meteo.com/v1/forecast?latitude=' + loc.lat +
    '&longitude=' + loc.lon +
    '&current=temperature_2m,relative_humidity_2m,weather_code,wind_speed_10m' +
    '&daily=weather_code,temperature_2m_max,temperature_2m_min' +
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
    source: loc.source,
    updatedAt: Date.now()
  };
}

/* ---------------- 开机自启（写 HKCU Run，路径含空格也不会截断） ---------------- */
const RUN_KEY = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run';
const RUN_NAME = 'GaokaoCountdown';

function autoLaunchCommand() {
  // 便携版运行在临时解压目录，自启应指回便携 exe 本体
  const portable = process.env.PORTABLE_EXECUTABLE_FILE;
  if (portable && fs.existsSync(portable)) {
    return `"${portable}" --pet`;
  }
  if (process.defaultApp) {
    return `"${process.execPath}" "${path.resolve(process.argv[1])}" --pet`;
  }
  return `"${app.getPath('exe')}" --pet`;
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
  try { win.setBackgroundMaterial('none'); } catch { /* 旧系统忽略 */ }
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  win.once('ready-to-show', () => {
    disableDwmShadow(win);
    // 开机自启并带 --pet 参数时，直接以桌面宠物出现，不闪主界面
    if (process.argv.includes('--pet')) {
      applyPetMode(true);
    } else {
      win.show();
    }
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
  return { width: Math.round(282 * scale), height: Math.round(252 * scale) };
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
  if (knowledgeWin && !knowledgeWin.isDestroyed()) knowledgeWin.webContents.send('skin:changed', { skin: id });
  if (classroomWin && !classroomWin.isDestroyed()) classroomWin.webContents.send('skin:changed', { skin: id });
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

/* 学科知识签独立窗口 */
function openKnowledgeWindow() {
  const subjectsKey = (store.selectedSubjects || []).join(',');
  if (knowledgeWin && !knowledgeWin.isDestroyed()) {
    // 选科在设置里改动后，刷新已打开的知识签窗口
    if (subjectsKey !== knowledgeSubjectsKey) {
      knowledgeSubjectsKey = subjectsKey;
      knowledgeWin.webContents.reload();
    }
    knowledgeWin.show();
    knowledgeWin.focus();
    return;
  }
  knowledgeSubjectsKey = subjectsKey;
  knowledgeWin = new BrowserWindow({
    width: 920,
    height: 680,
    minWidth: 780,
    minHeight: 560,
    frame: false,
    thickFrame: false,
    transparent: true,
    hasShadow: false,
    resizable: false,
    show: false,
    title: '学科知识签',
    icon: path.join(__dirname, 'build', 'icon.png'),
    backgroundColor: '#00000000',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      spellcheck: false,
      backgroundThrottling: false
    }
  });
  knowledgeWin.setMenuBarVisibility(false);
  try { knowledgeWin.setBackgroundMaterial('none'); } catch { /* 旧系统忽略 */ }
  knowledgeWin.loadFile(path.join(__dirname, 'renderer', 'knowledge.html'), { query: { skin: store.skin } });
  knowledgeWin.once('ready-to-show', () => {
    disableDwmShadow(knowledgeWin);
    knowledgeWin.show();
  });
  knowledgeWin.on('closed', () => { knowledgeWin = null; });
  appendLog('KNOWLEDGE_OPEN', { skin: store.skin });
}

/* ---------------- 课堂助手窗口与数据 ---------------- */
function openClassroomWindow() {
  if (classroomWin && !classroomWin.isDestroyed()) {
    classroomWin.show();
    classroomWin.focus();
    return;
  }
  classroomWin = new BrowserWindow({
    width: 1120,
    height: 760,
    minWidth: 940,
    minHeight: 620,
    frame: false,
    thickFrame: false,
    transparent: true,
    hasShadow: false,
    resizable: true,
    show: false,
    title: '课堂助手',
    icon: path.join(__dirname, 'build', 'icon.png'),
    backgroundColor: '#00000000',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      spellcheck: false,
      backgroundThrottling: false
    }
  });
  classroomWin.setMenuBarVisibility(false);
  try { classroomWin.setBackgroundMaterial('none'); } catch { /* 旧系统忽略 */ }
  classroomWin.loadFile(path.join(__dirname, 'renderer', 'classroom.html'), { query: { skin: store.skin } });
  classroomWin.once('ready-to-show', () => {
    disableDwmShadow(classroomWin);
    classroomWin.show();
    classroomWin.focus();
  });
  classroomWin.on('closed', () => {
    classroomWin = null;
    classroomUnlocked = false;
  });
  appendLog('CLASSROOM_OPEN', {});
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
  if (!XLSX) throw new Error('当前版本缺少表格组件，请改用 txt/csv');
  const wb = XLSX.readFile(filePath);
  const sheet = wb.Sheets[wb.SheetNames[0]];
  if (!sheet) throw new Error('表格中没有工作表');
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false, defval: '' });
  return rows.map((r) => (Array.isArray(r) ? r.map((c) => String(c == null ? '' : c).trim()) : []));
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
  return data;
}
function drawFromRoster(rosterId) {
  const roster = store.classroom.rosters.find((r) => r.id === rosterId);
  if (!roster) return { ok: false, error: '名单不存在' };
  if (!roster.names.length) return { ok: false, error: '名单里还没有学生' };
  const pool = roster.names.filter((n) => n.weight > 0);
  if (!pool.length) return { ok: false, error: '权重都为 0，无法点名' };
  const candidates = pool.length > 1 ? pool.filter((n) => n.id !== roster.lastPickId) : pool;
  const total = candidates.reduce((sum, n) => sum + n.weight, 0);
  let r = Math.random() * total;
  let picked = candidates[candidates.length - 1];
  for (const n of candidates) {
    r -= n.weight;
    if (r <= 0) { picked = n; break; }
  }
  picked.count += 1;
  picked.pickedAt = Date.now();
  roster.lastPickId = picked.id;
  saveStore();
  return { ok: true, name: picked.name, roster: roster.name, rosterId: roster.id };
}
function broadcastDebugMode() {
  if (win && !win.isDestroyed()) win.webContents.send('debug:changed', { on: !!store.debugMode });
  if (classroomWin && !classroomWin.isDestroyed()) classroomWin.webContents.send('debug:changed', { on: !!store.debugMode });
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
    { label: '学科知识签', click: () => openKnowledgeWindow() },
    { label: '桌面宠物模式', click: () => { showPanel(); setTimeout(() => applyPetMode(true), 200); } },
    { type: 'separator' },
    { label: '隐藏到托盘', click: () => { if (win && !win.isDestroyed()) win.hide(); } },
    { type: 'separator' },
    { label: '退出程序', click: quitApp }
  ]);
  tray.setContextMenu(menu);
}

function petContextMenu() {
  const template = [
    { label: '回到主界面', click: () => applyPetMode(false) },
    { label: '课堂助手', click: () => openClassroomWindow() },
    { label: '学科知识签屋', click: () => openKnowledgeWindow() },
    {
      label: '更换皮肤',
      submenu: SKINS.map((s) => ({
        label: s.name + (store.skin === s.id ? ' ✓' : ''),
        click: () => setSkin(s.id)
      }))
    },
    { label: `放大（${Math.round(petScale * 100)}%）`, click: () => changeScale(0.1) },
    { label: '缩小', click: () => changeScale(-0.1) },
    { type: 'separator' },
    { label: '隐藏到托盘', click: () => { if (win && !win.isDestroyed()) win.hide(); } },
    { label: '退出程序', click: quitApp }
  ];
  if (win && !win.isDestroyed()) Menu.buildFromTemplate(template).popup({ window: win });
}

/* ---------------- IPC ---------------- */
function wireIpc() {
  ipcMain.handle('app:get-init', () => ({
    store: {
      targetDate: store.targetDate,
      skin: store.skin,
      petScale,
      autoLaunch: store.autoLaunch,
      history: store.history,
      updateUrl: store.updateUrl,
      weatherCity: store.weatherCity,
      selectedSubjects: store.selectedSubjects,
      debugMode: !!store.debugMode,
      onboarded: !!store.onboarded
    },
    isFirstToday: firstTodayLaunch,
    today: dateKey(),
    mode,
    logs: readLogs(30),
    skins: SKINS,
    version: app.getVersion(),
    platform: process.platform,
    startedAt: new Date().toISOString()
  }));

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
    if (typeof patch.weatherCity === 'string') {
      store.weatherCity = patch.weatherCity.trim().slice(0, 60);
      store.weatherCache = null;
    }
    if (Array.isArray(patch.selectedSubjects)) {
      const list = Array.from(new Set(patch.selectedSubjects.filter((id) => SUBJECT_IDS.includes(id)))).slice(0, 6);
      if (list.length) store.selectedSubjects = list;
    }
    if (typeof patch.onboarded === 'boolean') store.onboarded = patch.onboarded;
    saveStore();
    appendLog('SETTINGS', { targetDate: store.targetDate, petScale });
    return {
      ok: true, targetDate: store.targetDate, skin: store.skin, petScale,
      updateUrl: store.updateUrl, weatherCity: store.weatherCity, selectedSubjects: store.selectedSubjects,
      onboarded: !!store.onboarded
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

  ipcMain.handle('app:clear-history', () => {
    store.history = [];
    saveStore();
    appendLog('HISTORY_CLEAR', {});
    return { ok: true };
  });

  ipcMain.handle('app:get-logs', () => readLogs(40));

  ipcMain.handle('weather:get', async () => {
    const cache = store.weatherCache;
    const fresh = cache && cache.data && cache.data.source === 'weather.com.cn' &&
      Array.isArray(cache.data.days) && cache.data.days.length &&
      cache.data.days[0].date === cnDate(0) &&
      Date.now() - cache.ts < 20 * 60 * 1000;
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

  ipcMain.handle('app:check-update', async () => {
    const current = app.getVersion();
    let latest = '';
    let notes = '';
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
    const mirrors = downloadUrl ? UPDATE_MIRRORS.map((prefix) => prefix + downloadUrl) : [];
    const setupMirrors = setupUrl ? UPDATE_MIRRORS.map((prefix) => prefix + setupUrl).concat(setupUrl) : [];
    const portableMirrors = portableUrl ? UPDATE_MIRRORS.map((prefix) => prefix + portableUrl).concat(portableUrl) : [];
    const downloaded = !!(updateTask.done && updateTask.version === latest && updateTask.filePath && fs.existsSync(updateTask.filePath));
    appendLog('UPDATE_CHECK', { latest, current, hasUpdate, source, setup: !!setupUrl });
    return {
      configured: true,
      ok: true,
      current,
      latest,
      notes,
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
    const dir = updateDir();
    fs.mkdirSync(dir, { recursive: true });
    const filePath = path.join(dir, `GaokaoCountdown-Setup-${version}.exe`);
    if (fs.existsSync(filePath) && fs.statSync(filePath).size > 20 * 1024 * 1024) {
      updateTask = { version, filePath, downloading: false, done: true };
      return { ok: true, filePath, version, cached: true };
    }

    updateTask = { version, filePath, downloading: true, done: false };
    const tmp = filePath + '.part';
    let lastError = '下载失败';
    for (const url of urls) {
      try {
        if (fs.existsSync(tmp)) fs.unlinkSync(tmp);
        const res = await net.fetch(url, {
          headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }
        });
        if (!res.ok || !res.body) throw new Error('HTTP ' + res.status);
        const total = Number(res.headers.get('content-length')) || 0;
        const stream = fs.createWriteStream(tmp);
        const reader = res.body.getReader();
        let received = 0;
        let sentAt = 0;
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          const chunk = Buffer.from(value);
          received += chunk.length;
          stream.write(chunk);
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
        await new Promise((resolve, reject) => {
          stream.on('error', reject);
          stream.end(() => resolve());
        });
        if (fs.statSync(tmp).size < 20 * 1024 * 1024) throw new Error('安装包大小异常');
        fs.renameSync(tmp, filePath);
        updateTask = { version, filePath, downloading: false, done: true };
        if (sender && !sender.isDestroyed()) {
          sender.send('update:downloaded', { version, filePath });
        }
        appendLog('UPDATE_DOWNLOADED', { version, size: fs.statSync(filePath).size });
        return { ok: true, filePath, version };
      } catch (e) {
        lastError = e.message;
        appendLog('UPDATE_DOWNLOAD_FAIL', { url, message: e.message });
      }
    }
    try { if (fs.existsSync(tmp)) fs.unlinkSync(tmp); } catch { /* 忽略 */ }
    updateTask = { version, filePath: '', downloading: false, done: false };
    if (sender && !sender.isDestroyed()) sender.send('update:error', { version, error: lastError });
    return { ok: false, error: lastError };
  };

  ipcMain.handle('app:update-download', (event, payload) => downloadUpdatePackage(event.sender, payload));

  /* 点击安装：退出应用后启动安装程序，安装成功再清理旧的便携版与安装包 */
  ipcMain.handle('app:install-update', (_e, filePath) => {
    try {
      const setup = String(filePath || updateTask.filePath || '');
      if (!setup || !fs.existsSync(setup)) return { ok: false, error: '安装包不存在，请重新下载' };
      const portable = process.env.PORTABLE_EXECUTABLE_FILE;
      const oldPortable = portable && fs.existsSync(portable) ? path.resolve(portable) : '';
      const dir = updateDir();
      fs.mkdirSync(dir, { recursive: true });
      const psPath = path.join(dir, 'apply-update.ps1');
      const psQuote = (p) => "'" + String(p).replace(/'/g, "''") + "'";
      const lines = [
        'Start-Sleep -Seconds 2',
        `$p = Start-Process -FilePath ${psQuote(setup)} -PassThru -Wait`,
        'if ($p.ExitCode -eq 0) {'
      ];
      if (oldPortable && oldPortable.toLowerCase() !== path.resolve(setup).toLowerCase()) {
        lines.push(`  if (Test-Path ${psQuote(oldPortable)}) { Remove-Item -LiteralPath ${psQuote(oldPortable)} -Force -ErrorAction SilentlyContinue }`);
      }
      lines.push(`  if (Test-Path ${psQuote(setup)}) { Remove-Item -LiteralPath ${psQuote(setup)} -Force -ErrorAction SilentlyContinue }`);
      lines.push('}');
      lines.push('Remove-Item -LiteralPath $MyInvocation.MyCommand.Path -Force -ErrorAction SilentlyContinue');
      fs.writeFileSync(psPath, '\uFEFF' + lines.join('\r\n'), 'utf8');

      const { spawn } = require('child_process');
      const child = spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-WindowStyle', 'Hidden', '-File', psPath], {
        detached: true,
        stdio: 'ignore',
        windowsHide: true
      });
      child.unref();
      appendLog('UPDATE_INSTALL', { setup, oldPortable });
      setTimeout(() => quitApp(), 350);
      return { ok: true };
    } catch (e) {
      appendLog('UPDATE_INSTALL_ERR', { message: e.message });
      return { ok: false, error: e.message };
    }
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
  ipcMain.on('knowledge:close', () => {
    if (knowledgeWin && !knowledgeWin.isDestroyed()) knowledgeWin.close();
  });

  ipcMain.on('pet:menu', petContextMenu);
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
    const notify = () => {
      if (classroomWin && !classroomWin.isDestroyed()) classroomWin.webContents.send('admin:open');
    };
    if (classroomWin && !classroomWin.isDestroyed()) {
      classroomWin.show();
      classroomWin.focus();
      setTimeout(notify, 220);
    } else {
      openClassroomWindow();
      if (classroomWin && !classroomWin.isDestroyed()) {
        classroomWin.webContents.once('did-finish-load', () => setTimeout(notify, 320));
      }
    }
    return { ok: true };
  });
  ipcMain.on('classroom:close', () => {
    if (classroomWin && !classroomWin.isDestroyed()) classroomWin.close();
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
    saveStore();
    return { ok: true, data: classroomAdminData() };
  });

  ipcMain.handle('classroom:draw', (_e, rosterId) => drawFromRoster(rosterId));

  ipcMain.handle('classroom:save-timetable', (_e, timetable) => {
    store.classroom.timetable = normalizeTimetable(timetable);
    saveStore();
    return { ok: true, timetable: store.classroom.timetable };
  });

  ipcMain.handle('classroom:parse-sheet', (_e, filePath) => {
    try {
      return { ok: true, rows: readSheetRows(String(filePath || '')) };
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
}

/* ---------------- 生命周期 ---------------- */
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', (_e, argv) => {
    showPanel();
    if (Array.isArray(argv) && argv.includes('--pet')) {
      setTimeout(() => applyPetMode(true), 200);
    }
    if (Array.isArray(argv) && argv.includes('--classroom')) {
      openClassroomWindow();
    }
  });

  app.whenReady().then(() => {
    ensureDirs();
    const today = dateKey();
    firstTodayLaunch = store.lastLaunchDate !== today;
    store.lastLaunchDate = today;
    store.autoLaunch = readAutoLaunch();
    saveStore();
    appendLog('APP_START', { firstToday: firstTodayLaunch, pet: process.argv.includes('--pet'), version: app.getVersion() });

    app.setAppUserModelId('com.trae.gaokao.countdown');
    createWindow();
    createTray();
    wireIpc();
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

  app.on('before-quit', () => {
    quitting = true;
    saveStore();
  });
}
