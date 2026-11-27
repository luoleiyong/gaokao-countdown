'use strict';
/*
 * 高考倒计时 · 桌面宠物（Windows）
 * 主进程：窗口/宠物层级、托盘、开机自启、本地存储、启动日志
 */
const { app, BrowserWindow, ipcMain, Menu, Tray, nativeImage, screen, dialog, net, session, shell, globalShortcut, safeStorage, clipboard } = require('electron');
const fs = require('fs');
const path = require('path');
const { pathToFileURL, fileURLToPath } = require('url');
const crypto = require('crypto');
const nodeNet = require('net');
const { execFile, execFileSync, spawn } = require('child_process');

let XLSX = null;
try { XLSX = require('xlsx'); } catch { /* 缺少表格组件时仅支持 txt/csv */ }
let DOCX = null;
try { DOCX = require('docx'); } catch { /* 缺少 Word 组件时导出 docx 会提示 */ }
let MAMMOTH = null;
try { MAMMOTH = require('mammoth'); } catch { /* 缺少解析组件时不能读取 docx */ }

const USER_DIR = path.join(app.getPath('appData'), 'GaokaoCountdown');
const STORE_FILE = path.join(USER_DIR, 'store.json');
/* 免密票据：由 tools/admin-unlock.js 写入，过期自动失效 */
const ADMIN_TICKET_FILE = path.join(USER_DIR, 'admin-unlock.json');
/* 免密权重额度：一天只允许改一名学生的权重（非VIP限制） */
const ADMIN_QUOTA_FILE = path.join(USER_DIR, 'admin-quota.json');
/* VIP 兑换凭据：兑换后权重不再限次 */
const VIP_FILE = path.join(USER_DIR, 'vip.json');
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

/* ---------------- AI 大模型：免费、调用 API 不强制实名的智谱 GLM ---------------- */
const SUBJECT_NAMES = {
  chinese: '语文', math: '数学', english: '英语', japanese: '日语',
  physics: '物理', chemistry: '化学', biology: '生物',
  politics: '政治', history: '历史', geography: '地理'
};
/* 内置供应商只放免费、调用 API 不强制实名的；custom 供用户自行接入任意 OpenAI 兼容服务 */
/* Kilo 免费池：api.kilo.ai 的 OpenAI 兼容网关，免费模型无需任何密钥（参考 dsh-our-free-model 的 src/kilo.js） */
const KILO_BASE = 'https://api.kilo.ai/api/gateway/';
/* free 为可无密钥调用的模型；think 表示可下发 reasoning.enabled=false 关掉思考，避免 max_tokens 被思考吃光 */
const KILO_MODELS = [
  { id: 'kilo-auto/free', name: 'Auto Free · 自动路由', ctx: 256000, think: true },
  { id: 'nvidia/nemotron-3.5-lightning:free', name: 'Nemotron 3.5 Lightning · NVIDIA', ctx: 1000000, think: true },
  { id: 'inclusionai/ling-3.2-flash:free', name: 'Ling 3.2 Flash · inclusionAI', ctx: 1048576, think: true },
  { id: 'baidu/ernie-5.5-flash-preview:free', name: 'ERNIE 5.5 Flash · 百度', ctx: 1024000, think: true },
  { id: 'nvidia/nemotron-3-ultra-550b-a55b:free', name: 'Nemotron 3 Ultra 550B · NVIDIA', ctx: 1000000, think: true },
  { id: 'nvidia/nemotron-3.5-super-vl:free', name: 'Nemotron 3.5 Super VL · NVIDIA', ctx: 1000000, think: true, vision: true },
  { id: 'nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free', name: 'Nemotron 3 Nano Omni · NVIDIA', ctx: 256000, think: true, vision: true },
  { id: 'particle-ai/particle-1:free', name: 'Particle 1', ctx: 1048576, think: true },
  { id: 'recursive/flint-v1.0:free', name: 'Flint v1.0', ctx: 262144, think: true },
  { id: 'reflection/beam-free', name: 'Beam Free', ctx: 1048576, think: true },
  { id: 'openrouter/free', name: 'OpenRouter Free', ctx: 200000, think: true },
  { id: 'liquid/lfm-3-1.7b:free', name: 'LFM 3 1.7B · Liquid', ctx: 262144, think: true },
  { id: 'stealth/glyph-cluster', name: 'Glyph Cluster', ctx: 256000, think: true }
];
const AI_PROVIDERS = [
  {
    id: 'kilo',
    name: 'Kilo 免费池',
    baseUrl: KILO_BASE,
    model: 'kilo-auto/free',
    authUrl: '',
    keyUrl: 'https://kilo.ai/',
    noKey: true,
    hint: '无需密钥，直连 Kilo 免费池；高峰期可开「自动换模型」',
    presets: KILO_MODELS.map((m) => m.id),
    models: KILO_MODELS
  },
  {
    id: 'pollinations',
    name: 'Pollinations 免费池',
    baseUrl: 'https://text.pollinations.ai/v1',
    model: 'openai-fast',
    authUrl: '',
    keyUrl: 'https://pollinations.ai/',
    noKey: true,
    hint: '无需密钥，匿名额度约每 45 秒 1 次；Kilo 排队时自动顶上',
    presets: ['openai-fast'],
    models: [{ id: 'openai-fast', name: 'GPT-OSS 20B · 带思考', ctx: 131072, think: true }]
  },
  {
    id: 'zhipu',
    name: '智谱 GLM',
    baseUrl: 'https://open.bigmodel.cn/api/paas/v4/',
    model: 'glm-4.7-flash',
    authUrl: 'https://bigmodel.cn/login',
    keyUrl: 'https://bigmodel.cn/usercenter/proj-mgmt/apikeys',
    hint: 'GLM-4.7-Flash 输入输出全免，调用 API 不强制实名',
    presets: ['glm-4.7-flash', 'glm-4-flash-250414', 'glm-z1-flash']
  },
  {
    id: 'sensenova',
    name: '商汤日日新',
    baseUrl: 'https://token.sensenova.cn/v1/',
    model: 'sensenova-6.8-flash-lite',
    authUrl: 'https://platform.sensenova.cn/login',
    keyUrl: 'https://platform.sensenova.cn/console/api-key',
    freeNote: 'Token Plan 每 5 小时 1500 次免费调用',
    hint: '登录后可用免费模型，Token Plan 公测期免费',
    presets: ['sensenova-6.8-flash-lite', 'deepseek-v4-flash', 'kimi-k3', 'glm-5.2']
  },
  {
    id: 'custom',
    name: '自定义',
    baseUrl: '',
    model: '',
    authUrl: '',
    keyUrl: '',
    hint: '填入任意兼容 OpenAI Chat Completions 的服务地址与模型名；本机网关可免密钥',
    presets: []
  }
];
const AI_AUTH_REDIRECT = 'https://bigmodel.cn/usercenter/proj-mgmt/apikeys';
const AI_LOGIN_URL = AI_PROVIDERS[0].authUrl + '?redirect=' + encodeURIComponent(AI_AUTH_REDIRECT);
/* 登录地址按供应商取；自定义供应商没有登录页，返回空串 */
function aiAuthUrlOf(provider) { return provider && provider.authUrl ? provider.authUrl : ''; }
function aiLoginUrlOf(provider) {
  const auth = aiAuthUrlOf(provider);
  if (!auth) return '';
  return auth + '?redirect=' + encodeURIComponent(provider.keyUrl || AI_AUTH_REDIRECT);
}
/* 联网热点：新浪滚动公开接口，失败时自动退回模型生成并如实标注来源 */
const AI_HOT_URL = 'https://feed.mix.sina.com.cn/api/roll/get?pageid=153&lid=2510&k=&num=20&page=1';
/* 联网检索：Bing RSS 与百度热搜都是公开只读接口，不需要密钥 */
const AI_SEARCH_RSS = 'https://cn.bing.com/search?format=rss&count=10&mkt=zh-CN&setlang=zh-hans&cc=CN&q=';
const AI_SEARCH_RSS_EN = 'https://cn.bing.com/search?format=rss&count=10&mkt=en-US&setlang=en&q=';
const AI_NEWS_RSS = 'https://cn.bing.com/news/search?format=rss&mkt=zh-CN&setlang=zh-hans&q=';
const AI_BAIDU_HOT = 'https://top.baidu.com/api/board?platform=wise&tab=realtime';
/* 联网多源：今日头条热榜 / 知乎日报 / 权威 RSS（人民网、新华网、中新网）/ 科技媒体（IT之家、Solidot） */
const AI_TOUTIAO_HOT = 'https://www.toutiao.com/hot-event/hot-board/?origin=toutiao_pc';
const AI_ZHIHU_LATEST = 'https://news-at.zhihu.com/api/4/news/latest';
const AI_RSS_FEEDS = [
  { name: '人民网', url: 'http://www.people.com.cn/rss/politics.xml', kind: 'politics' },
  { name: '新华网', url: 'http://www.xinhuanet.com/politics/news_politics.xml', kind: 'politics' },
  { name: '中新网', url: 'https://www.chinanews.com.cn/rss/scroll-news.xml', kind: 'society' },
  { name: 'IT之家', url: 'https://www.ithome.com/rss/', kind: 'tech' },
  { name: 'Solidot', url: 'https://www.solidot.org/index.rss', kind: 'tech' },
  { name: '36氪', url: 'https://36kr.com/feed', kind: 'tech' },
  { name: '机器之心', url: 'https://www.jiqizhixin.com/rss', kind: 'tech' },
  { name: '量子位', url: 'https://www.qbitai.com/feed', kind: 'tech' },
  { name: '少数派', url: 'https://sspai.com/feed', kind: 'life' }
];
const AI_SEARCH_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36';
const STORE_DEFAULTS = {
  targetDate: '2027-06-07',
  skin: 'board',
  petScale: 1,
  petFreq: 'slow',
  /* 主界面整体字号：1 为标准，用户可在设置 → 界面字号里调 */
  uiFontScale: 1,
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
  classroom: null,
  aiEnabled: true,
  aiProvider: 'kilo',
  aiBaseUrl: KILO_BASE,
  aiModel: 'kilo-auto/free',
  aiKeyEnc: '',
  /* 每个供应商各自保存自己的加密密钥，切换供应商不再看起来像「密钥丢了」 */
  aiKeys: {},
  /* 用户手动填过的模型名，重启后仍在候选 chips 里 */
  aiCustomModels: [],
  /* 自动换模型：一个模型排队/超时/报错时按顺序切到下一个 */
  aiAutoModel: true,
  aiModelUsed: '',
  /* 本机代理（Clash 等）：直连不通时自动探测并写回，也可手动指定 */
  aiProxy: '',
  /* 每个供应商各自记住最后用过的地址与模型，切来切去不会互相覆盖 */
  aiProviderPrefs: {},
  /* 显示模型思考过程（reasoning） */
  aiThink: true,
  /* 回答前先联网检索最新信息 */
  aiWeb: true,
  aiTopic: '每日热点',
  aiNewsDate: '',
  aiNewsCache: null,
  /* 每日热点自动化：默认每天 08:00 抓一次，主界面卡片显示前 4 条 */
  newsAutoEnabled: true,
  newsAutoTime: '08:00',
  newsAutoDate: '',
  newsAutoItems: [],
  newsAutoSources: [],
  newsAutoTrend: '',
  newsAutoError: '',
  newsAutoAt: 0
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
/* AI 密钥：内存中保存明文，落盘只写加密后的 aiKeyEnc（新版按供应商分桶写 aiKeys） */
let aiKey = '';
let aiClipboardTimer = null;
let aiClipboardLast = '';
/* 当前正在进行的对话请求，用于「停止生成」 */
let aiAbortCtl = null;

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
/* 删除的名单在本机保留 3 天，过期自动清除 */
const ROSTER_TRASH_TTL = 3 * 24 * 60 * 60 * 1000;

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
  return { passwordHash: '', passwordSalt: '', activeRosterId: '', rosters: [], trash: [], timetable: defaultTimetable() };
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
  out.trash = Array.isArray(c.trash)
    ? c.trash
      .map((t) => {
        if (!t || typeof t !== 'object') return null;
        const roster = normalizeRoster(t.roster);
        const deletedAt = Number(t.deletedAt);
        if (!roster || !deletedAt) return null;
        if (Date.now() - deletedAt >= ROSTER_TRASH_TTL) return null;
        return { roster, deletedAt };
      })
      .filter(Boolean)
      .slice(0, 100)
    : [];
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

/* 读免密票据：{expires: 毫秒时间戳}；不存在、格式错、过期都算无效 */
function adminTicketFresh() {
  try {
    if (!fs.existsSync(ADMIN_TICKET_FILE)) return false;
    const raw = JSON.parse(fs.readFileSync(ADMIN_TICKET_FILE, 'utf8'));
    const exp = Number(raw && raw.expires);
    if (!exp || !isFinite(exp)) return false;
    if (exp <= Date.now()) return false;
    return true;
  } catch (e) {
    return false;
  }
}
function adminTicketRemain() {
  try {
    const raw = JSON.parse(fs.readFileSync(ADMIN_TICKET_FILE, 'utf8'));
    const exp = Number(raw && raw.expires);
    return exp > Date.now() ? exp - Date.now() : 0;
  } catch (e) {
    return 0;
  }
}

/* 免密进入的管理员会话：票据只管开门，进门后整场都按非VIP限额走，不因票据过期而放开 */
let adminTicketSession = false;
function adminQuotaRead() {
  try {
    const raw = JSON.parse(fs.readFileSync(ADMIN_QUOTA_FILE, 'utf8'));
    if (!raw || typeof raw !== 'object') return null;
    return raw;
  } catch (e) {
    return null;
  }
}
function adminQuotaToday() {
  const q = adminQuotaRead();
  if (!q || q.date !== dateKey() || !q.nameId) return null;
  return q;
}
function adminQuotaSave(q) {
  try {
    fs.writeFileSync(ADMIN_QUOTA_FILE, JSON.stringify(q));
  } catch (e) { /* 写入失败不阻断管理 */ }
}
/* VIP 兑换码：作者的联系方式，兑换后长期有效，权重不限次数 */
const VIP_CODE = '3270423617@qq.com';
function vipActive() {
  try {
    const raw = JSON.parse(fs.readFileSync(VIP_FILE, 'utf8'));
    return !!(raw && raw.vip === true);
  } catch (e) {
    return false;
  }
}
function vipSave() {
  try {
    fs.writeFileSync(VIP_FILE, JSON.stringify({ vip: true, at: Date.now() }));
  } catch (e) { /* 写不进去也不阻断本次会话 */ }
}
/* 兑换码比对：忽略大小写、空格与常见前缀，输入不作为日志明文保存 */
function vipMatchCode(input) {
  const s = String(input || '')
    .replace(/\s+/g, '')
    .replace(/^mailto:/i, '')
    .toLowerCase();
  return s === VIP_CODE.toLowerCase();
}

function adminQuotaInfo() {
  const q = adminQuotaToday();
  const vip = vipActive();
  const restricted = !vip && !!(adminTicketSession || adminTicketFresh());
  if (!q) return { used: false, restricted: restricted, vip: vip, date: dateKey() };
  return {
    used: true,
    restricted: restricted,
    vip: vip,
    date: q.date,
    rosterId: q.rosterId || '',
    nameId: q.nameId,
    name: q.name || ''
  };
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
    merged.uiFontScale = normalizeUiFontScale(merged.uiFontScale);
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
    // AI 配置归一化：只接受已支持的供应商，密钥只保留加密串
    merged.aiProvider = AI_PROVIDERS.some((p) => p.id === merged.aiProvider) ? merged.aiProvider : 'kilo';
    // 旧的「本地网关」预设已移除：内置供应商地址若还指向本机，回落到该供应商默认地址
    if (merged.aiProvider !== 'custom' && /127\.0\.0\.1|localhost/i.test(String(merged.aiBaseUrl || ''))) {
      merged.aiBaseUrl = '';
    }
    const aiProvider = AI_PROVIDERS.find((p) => p.id === merged.aiProvider) || AI_PROVIDERS[0];
    const rawBase = typeof merged.aiBaseUrl === 'string' ? merged.aiBaseUrl.trim() : '';
    // 关键修复：自定义地址规范化失败时保留用户原文，不再静默清空
    merged.aiBaseUrl = normalizeAiBase(rawBase) || rawBase || aiProvider.baseUrl;
    merged.aiModel = typeof merged.aiModel === 'string' && merged.aiModel.trim()
      ? merged.aiModel.trim().slice(0, 60)
      : aiProvider.model;
    merged.aiKeyEnc = typeof merged.aiKeyEnc === 'string' ? merged.aiKeyEnc : '';
    // 密钥按供应商分桶：旧版只有一个 aiKeyEnc，迁移到当前供应商名下
    const keys = migratedAiKeys(data.aiKeys);
    // 只有「老版本单格密钥」这种一次性的情况才迁移到当前供应商；
    // 已经有分桶就说明是新数据，缺谁就是没填，不能拿别人的 Key 顶上（会被网关判 401）。
    if (!Object.keys(keys).length && merged.aiKeyEnc) keys[merged.aiProvider] = merged.aiKeyEnc;
    merged.aiKeys = keys;
    merged.aiCustomModels = normalizeModelNames(data.aiCustomModels);
    merged.aiAutoModel = merged.aiAutoModel !== false;
    merged.aiModelUsed = typeof merged.aiModelUsed === 'string' ? merged.aiModelUsed.slice(0, 80) : '';
    merged.aiProxy = normalizeAiProxy(data.aiProxy);
    merged.aiProviderPrefs = normalizeAiPrefs(data.aiProviderPrefs);
    merged.aiEnabled = merged.aiEnabled !== false;
    merged.aiTopic = typeof merged.aiTopic === 'string' && merged.aiTopic.trim()
      ? merged.aiTopic.trim().slice(0, 40)
      : '每日热点';
    merged.aiNewsDate = typeof merged.aiNewsDate === 'string' ? merged.aiNewsDate : '';
    merged.aiNewsCache = merged.aiNewsCache && typeof merged.aiNewsCache === 'object' ? merged.aiNewsCache : null;
    // 每日热点自动化：字段缺失时按默认开启、08:00 处理，旧数据升级后直接可用
    merged.newsAutoEnabled = data.newsAutoEnabled !== false;
    merged.newsAutoTime = normalizeNewsTime(data.newsAutoTime);
    merged.newsAutoDate = typeof data.newsAutoDate === 'string' ? data.newsAutoDate.slice(0, 10) : '';
    merged.newsAutoItems = normalizeNewsItems(data.newsAutoItems);
    merged.newsAutoSources = Array.isArray(data.newsAutoSources)
      ? data.newsAutoSources
        .filter((s) => s && typeof s === 'object')
        .map((s) => ({ name: String(s.name || '').slice(0, 20), count: Number(s.count) || 0 }))
        .slice(0, 8)
      : [];
    merged.newsAutoTrend = typeof data.newsAutoTrend === 'string' ? data.newsAutoTrend.slice(0, 400) : '';
    merged.newsAutoError = typeof data.newsAutoError === 'string' ? data.newsAutoError.slice(0, 200) : '';
    merged.newsAutoAt = Number(data.newsAutoAt) || 0;
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
  NEWS_AUTO: '自动抓取每日热点',
  NEWS_CONFIG: '每日热点设置',
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
/* 主界面字号档位：0.9 / 1 / 1.15 / 1.3，非法值回到标准档 */
function normalizeUiFontScale(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return 1;
  const steps = [0.9, 1, 1.15, 1.3];
  let best = 1;
  let gap = Infinity;
  steps.forEach((s) => {
    const d = Math.abs(s - n);
    if (d < gap) { gap = d; best = s; }
  });
  return best;
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

/* 把底层网络异常翻译成用户看得懂的中文，避免直接抛 "This operation was aborted" */
function friendlyNetError(e, timeout) {
  const msg = String((e && e.message) || e || '');
  const name = String((e && e.name) || '');
  if (name === 'AbortError' || /aborted|abort/i.test(msg)) {
    return '请求超时（' + Math.round(timeout / 1000) + ' 秒），免费模型在高峰期可能很慢，请稍后重试或换个时段';
  }
  if (/ENOTFOUND|EAI_AGAIN|getaddrinfo/i.test(msg)) return '域名解析失败，请检查网络连接';
  if (/ECONNREFUSED/i.test(msg)) return '连接被拒绝，请检查接口地址是否正确';
  if (/certificate|CERT_/i.test(msg)) return '证书校验失败，请确认接口地址是 https 且证书有效';
  if (/net::ERR_/i.test(msg)) return '网络请求失败：' + msg.slice(0, 120);
  return msg || '网络请求失败';
}

/* 智谱免费模型在高峰期会返回 429 + code 1305（访问量过大），这类错误值得退避重试 */
function isRetryableError(e) {
  const msg = String((e && e.message) || '');
  if (/HTTP 429|HTTP 5\d\d/.test(msg)) return true;
  if (/1302|1305/.test(msg)) return true;
  if (/aborted|abort|timeout|ETIMEDOUT|ECONNRESET|EAI_AGAIN/i.test(msg)) return true;
  return false;
}

/* 大模型对话接口走 POST：带超时、错误翻译与有限次退避重试 */
async function postJson(url, body, timeout = 60000, headers, retryOpts) {
  const opt = retryOpts || {};
  const maxTries = opt.tries || 2;
  const payload = JSON.stringify(body);
  let lastError = null;
  for (let attempt = 0; attempt < maxTries; attempt++) {
    if (attempt > 0) {
      // 429/5xx 退避 2s、5s；超时类退避 1.5s
      const wait = /HTTP 4|HTTP 5|1302|1305/.test(String(lastError && lastError.message))
        ? (attempt === 1 ? 2000 : 5000)
        : 1500;
      if (opt.onRetry) { try { opt.onRetry(attempt, lastError); } catch { /* 忽略 */ } }
      await new Promise((r) => setTimeout(r, wait));
    }
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), timeout);
    // 外部取消（用户点「停止」）：把外部 signal 接到本次请求上
    const ext = opt.signal;
    const onExt = () => { try { ac.abort(); } catch { /* 忽略 */ } };
    if (ext) {
      if (ext.aborted) onExt();
      else if (typeof ext.addEventListener === 'function') ext.addEventListener('abort', onExt);
    }
    try {
      const res = await net.fetch(url, {
        method: 'POST',
        signal: ac.signal,
        headers: Object.assign({
          'Content-Type': 'application/json',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36',
          'Accept': 'application/json'
        }, headers || {}),
        body: payload
      });
      if (!res.ok) {
        const detail = await res.text().catch(() => '');
        const raw = 'HTTP ' + res.status + (detail ? ' ' + detail.slice(0, 300) : '');
        const err = new Error(raw);
        err.status = res.status;
        throw err;
      }
      return await res.json();
    } catch (e) {
      lastError = e;
      if (ext && ext.aborted) throw new Error('已停止生成');
      if (!isRetryableError(e) || attempt === maxTries - 1) {
        throw new Error(friendlyNetError(e, timeout));
      }
    } finally {
      if (ext && typeof ext.removeEventListener === 'function') ext.removeEventListener('abort', onExt);
      clearTimeout(timer);
    }
  }
  throw new Error(friendlyNetError(lastError, timeout));
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
/* 主窗口尺寸随界面字号放大：CSS 视口保持约 1160×740，字号调大时窗口同步变大 */
function panelTargetSize() {
  const area = screen.getPrimaryDisplay().workArea;
  const s = normalizeUiFontScale(store.uiFontScale);
  return {
    width: Math.min(Math.round(1160 * s), area.width - 40),
    height: Math.min(Math.round(740 * s), area.height - 40)
  };
}
function createWindow() {
  const area = screen.getPrimaryDisplay().workArea;
  const target = panelTargetSize();
  let w = target.width;
  let h = target.height;
  let x = Math.round(area.x + (area.width - w) / 2);
  let y = Math.round(area.y + (area.height - h) / 2);
  if (store.panelBounds && Number.isFinite(store.panelBounds.width)) {
    w = Math.max(target.width, Math.min(store.panelBounds.width, area.width));
    h = Math.max(target.height, Math.min(store.panelBounds.height, area.height));
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
    const t = panelTargetSize();
    const b = panelBounds || { x: area.x + 40, y: area.y + 40, width: t.width, height: t.height };
    const width = Math.max(t.width, Math.min(b.width, area.width));
    const height = Math.max(t.height, Math.min(b.height, area.height));
    const x = Math.min(Math.max(area.x, b.x), area.x + area.width - width);
    const y = Math.min(Math.max(area.y, b.y), area.y + area.height - height);
    win.setBounds({ x, y, width, height });
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

/* 改字号时同步改窗口：CSS 视口保持约 1160×740，最大字号下热点卡片不会被裁 */
function resizePanelForFont() {
  if (!win || win.isDestroyed() || mode !== 'panel') return;
  const area = screen.getPrimaryDisplay().workArea;
  const t = panelTargetSize();
  const b = win.getBounds();
  const width = Math.min(t.width, area.width);
  const height = Math.min(t.height, area.height);
  if (width === b.width && height === b.height) return;
  const x = Math.min(Math.max(area.x, Math.round(b.x + (b.width - width) / 2)), area.x + area.width - width);
  const y = Math.min(Math.max(area.y, Math.round(b.y + (b.height - height) / 2)), area.y + area.height - height);
  win.setBounds({ x, y, width, height });
  store.panelBounds = win.getBounds();
  saveStore();
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
/* 姓名允许中文、字母、数字，纯数字（学号/座位号）也算有效姓名 */
function cleanNameToken(token) {
  let t = String(token == null ? '' : token).replace(/^\uFEFF/, '').trim();
  t = t.replace(/^["'\s]+|["'\s]+$/g, '');
  t = t.replace(/^(\d{1,3})\s*[.、)．:：]\s*(?=\S)/, '');
  t = t.trim();
  if (!t || t.length > 30) return '';
  if (NAME_HEADER_RE.test(t)) return '';
  return t;
}
/* 行首序号（"3. 张三" / "3 张三"）只在后面还有内容时去掉，纯编号行原样保留 */
function stripNameLineIndex(line) {
  const s = String(line == null ? '' : line).trim();
  if (!s) return '';
  const byPunct = s.replace(/^(\d{1,3})\s*[.、)．:：]\s*(?=\S)/, '').trim();
  if (byPunct !== s) return byPunct;
  const bySpace = s.replace(/^(\d{1,3})\s+(?=\S)/, '').trim();
  if (bySpace !== s) return bySpace;
  return s;
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
      stripNameLineIndex(line).split(/[\s,，;；、\t]+/).forEach((tok) => {
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
function pruneRosterTrash() {
  const c = store.classroom;
  if (!c || !Array.isArray(c.trash) || !c.trash.length) return;
  const now = Date.now();
  c.trash = c.trash.filter((t) => t && t.roster && Number(t.deletedAt) && now - Number(t.deletedAt) < ROSTER_TRASH_TTL);
}
function rosterTrashList() {
  const c = store.classroom;
  if (!Array.isArray(c.trash)) return [];
  return c.trash
    .filter((t) => t && t.roster)
    .slice()
    .sort((a, b) => Number(b.deletedAt) - Number(a.deletedAt))
    .map((t) => ({
      id: t.roster.id,
      name: t.roster.name,
      count: Array.isArray(t.roster.names) ? t.roster.names.length : 0,
      deletedAt: Number(t.deletedAt),
      expiresAt: Number(t.deletedAt) + ROSTER_TRASH_TTL
    }));
}
function classroomPublicData() {
  const c = store.classroom;
  pruneRosterTrash();
  return {
    activeRosterId: c.activeRosterId,
    rosters: c.rosters.map((r) => ({
      id: r.id,
      name: r.name,
      names: r.names.map((n) => ({ id: n.id, name: n.name }))
    })),
    trash: rosterTrashList(),
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
  data.adminQuota = adminQuotaInfo();
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
/* ---------------- AI 大模型：密钥 / 对话 / 联网热点 / 审核自查 ---------------- */

/* 密钥加密：优先用 Electron safeStorage；不可用时退回带前缀的 Base64，绝不写明文 */
function aiEncryptKey(plain) {
  const text = String(plain || '');
  try {
    if (safeStorage.isEncryptionAvailable()) {
      return safeStorage.encryptString(text).toString('base64');
    }
  } catch { /* 加密不可用时走降级 */ }
  return Buffer.from('gk1:' + text, 'utf8').toString('base64');
}

function aiDecryptEnc(encRaw) {
  const enc = encRaw ? String(encRaw) : '';
  if (!enc) return '';
  try {
    const raw = Buffer.from(enc, 'base64');
    if (raw.length > 4 && raw.slice(0, 4).toString('utf8') === 'gk1:') return raw.slice(4).toString('utf8');
    if (safeStorage.isEncryptionAvailable()) return safeStorage.decryptString(raw);
    return raw.toString('utf8');
  } catch {
    return '';
  }
}

/* 兼容旧调用：只读当前供应商那一格 */
function aiDecryptKey(storeRef) {
  return aiDecryptEnc(storeRef && storeRef.aiKeyEnc);
}

/* 密钥按供应商分桶，切换供应商不再看起来像「密钥丢了」 */
const aiKeyCache = new Map();

function aiKeysBucket() {
  if (!store.aiKeys || typeof store.aiKeys !== 'object') store.aiKeys = {};
  return store.aiKeys;
}

function aiKeyOf(providerId) {
  if (!providerId) return '';
  if (aiKeyCache.has(providerId)) return aiKeyCache.get(providerId);
  const bucket = aiKeysBucket();
  let plain = aiDecryptEnc(bucket[providerId]);
  // 旧版单格密钥只在「桶里一条都没有、且就是当前供应商」时兜底迁移；
  // 否则切到免密钥供应商会把自己家的 Key 发给别人，直接被判 401。
  if (!plain && providerId === store.aiProvider && !Object.keys(bucket).length) {
    plain = aiDecryptEnc(store.aiKeyEnc) || aiKey;
    if (plain) aiRememberKey(providerId, plain);
  }
  if (plain) aiKeyCache.set(providerId, plain);
  return plain;
}

function aiRememberKey(providerId, plain) {
  const value = String(plain || '');
  if (!value) return;
  aiKeyCache.set(providerId, value);
  const bucket = aiKeysBucket();
  bucket[providerId] = aiEncryptKey(value);
  if (providerId === store.aiProvider) store.aiKeyEnc = bucket[providerId];
}

function aiForgetKey(providerId) {
  aiKeyCache.delete(providerId);
  const bucket = aiKeysBucket();
  delete bucket[providerId];
  if (providerId === store.aiProvider) {
    store.aiKeyEnc = '';
    aiKey = '';
  }
}

function aiHasKey(providerId) {
  return !!aiKeyOf(providerId);
}

/* 旧 store 只有 aiKeyEnc 一格，迁移成按供应商分桶 */
function migratedAiKeys(raw) {
  const out = {};
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    Object.keys(raw).forEach((k) => {
      const enc = raw[k];
      if (typeof enc === 'string' && enc) out[String(k)] = enc;
    });
  }
  return out;
}

function normalizeModelNames(raw) {
  const list = Array.isArray(raw) ? raw : [];
  const seen = new Set();
  const out = [];
  list.forEach((item) => {
    const name = String(item || '').trim().slice(0, 80);
    if (!name || seen.has(name)) return;
    seen.add(name);
    out.push(name);
  });
  return out.slice(0, 20);
}

/* 每个供应商各记一份「上次用的地址 + 模型」，切回来时原样还原 */
function normalizeAiPrefs(raw) {
  const out = {};
  if (!raw || typeof raw !== 'object') return out;
  AI_PROVIDERS.forEach((prov) => {
    const item = raw[prov.id];
    if (!item || typeof item !== 'object') return;
    const baseUrl = typeof item.baseUrl === 'string' ? item.baseUrl.trim().slice(0, 200) : '';
    const model = typeof item.model === 'string' ? item.model.trim().slice(0, 80) : '';
    if (!baseUrl && !model) return;
    out[prov.id] = { baseUrl, model };
  });
  return out;
}

function aiPrefsBucket() {
  if (!store.aiProviderPrefs || typeof store.aiProviderPrefs !== 'object') store.aiProviderPrefs = {};
  return store.aiProviderPrefs;
}

function aiRememberPref(providerId, baseUrl, model) {
  if (!providerId) return;
  const bucket = aiPrefsBucket();
  const prev = bucket[providerId] || {};
  const next = {
    baseUrl: String(baseUrl || prev.baseUrl || '').slice(0, 200),
    model: String(model || prev.model || '').slice(0, 80)
  };
  if (!next.baseUrl && !next.model) return;
  bucket[providerId] = next;
}

function aiProviderOf(storeRef) {
  const found = AI_PROVIDERS.find((p) => p.id === storeRef.aiProvider);
  if (found && found.id !== 'custom') return found;
  if (found && found.id === 'custom') {
    return {
      id: 'custom',
      name: '自定义',
      baseUrl: storeRef.aiBaseUrl || '',
      model: storeRef.aiModel || '',
      authUrl: '',
      keyUrl: '',
      hint: found.hint,
      presets: Array.isArray(storeRef.aiCustomModels) ? storeRef.aiCustomModels.slice(0, 20) : []
    };
  }
  return AI_PROVIDERS[0];
}

/* 自定义供应商必须同时有 baseUrl 与 model，才允许发请求 */
/* 本地网关（magpie / Ollama / LM Studio 等）允许不带协议头与末尾 /v1 */
const LOCAL_HOST_RE = /^(127\.0\.0\.1|localhost|0\.0\.0\.0|\[::1\]|::1)(:\d+)?(\/|$)/i;

function normalizeAiBase(input) {
  let b = String(input || '').trim();
  if (!b) return '';
  // 只写了 127.0.0.1:3425 这种，补上 http://
  if (!/^https?:\/\//i.test(b)) {
    if (LOCAL_HOST_RE.test(b)) b = 'http://' + b;
    else return '';
  }
  return b.replace(/\/+$/, '') + '/';
}

/* 本机代理地址：支持 http://127.0.0.1:1081、socks5://…，或只写 127.0.0.1:1081 */
function normalizeAiProxy(input) {
  const raw = String(input == null ? '' : input).trim().slice(0, 120);
  if (!raw) return '';
  if (/^(https?|socks5):\/\//i.test(raw)) return raw.replace(/\/+$/, '');
  if (/^[\w.\-]+:\d{2,5}$/.test(raw)) return 'http://' + raw;
  return '';
}

function aiIsLocalBase(base) {
  return LOCAL_HOST_RE.test(String(base || '').replace(/^https?:\/\//i, ''));
}

/* ---------------- AI 出网：直连不通时自动走本机代理 ---------------- */
/* 背景：api.kilo.ai 在部分网络下 443 被阻断（DNS 正常、TCP 握手超时），
   而本机常驻 Clash / v2ray 之类代理（1081 / 7890 / 7897 / 10809 / 1080）。
   这里用独立 session 承载 AI 请求，直连失败后探测本机代理端口，命中就改走代理并记住。 */
const AI_PROXY_PORTS = [1081, 7890, 7897, 10809, 1080];
let aiNetSessionRef = null;
let aiProxyApplied = null;

function aiNetSession() {
  if (!aiNetSessionRef) {
    try { aiNetSessionRef = session.fromPartition('ai-net'); } catch { aiNetSessionRef = null; }
  }
  return aiNetSessionRef || session.defaultSession;
}

function aiProxyOf() {
  const raw = String(store.aiProxy || '').trim();
  if (!raw) return '';
  if (/^(https?|socks5):\/\//i.test(raw)) return raw.replace(/\/+$/, '');
  return 'http://' + raw.replace(/\/+$/, '');
}

async function aiApplyProxy(proxyUrl) {
  const target = proxyUrl || '';
  if (aiProxyApplied === target) return;
  const ses = aiNetSession();
  try {
    if (!target) await ses.setProxy({ mode: 'direct' });
    else await ses.setProxy({ proxyRules: target, proxyBypassRules: '<-loopback>' });
    aiProxyApplied = target;
  } catch (e) {
    appendLog('AI_PROXY_APPLY_FAIL', { proxy: target, error: String(e && e.message || '').slice(0, 120) });
  }
}

function aiProbePort(port) {
  return new Promise((resolve) => {
    let done = false;
    const finish = (ok) => {
      if (done) return;
      done = true;
      try { sock.destroy(); } catch { /* 忽略 */ }
      resolve(ok);
    };
    const sock = nodeNet.connect({ host: '127.0.0.1', port });
    sock.setTimeout(350);
    sock.once('connect', () => finish(true));
    sock.once('timeout', () => finish(false));
    sock.once('error', () => finish(false));
  });
}

async function aiFindLocalProxy() {
  for (const port of AI_PROXY_PORTS) {
    if (await aiProbePort(port)) return 'http://127.0.0.1:' + port;
  }
  return '';
}

function aiNetError(e) {
  if (e && e.status) return false;
  const msg = String((e && e.message) || '');
  return /ERR_[A-Z_]+|ECONNRESET|ECONNREFUSED|ECONNABORTED|ETIMEDOUT|ENETUNREACH|EHOSTUNREACH|EAI_AGAIN|EPROTO|socket hang up|network|timeout|超时|无法连接|连接失败|网络/i.test(msg);
}

async function aiFetchOnce(url, ctx, proxyUrl) {
  await aiApplyProxy(proxyUrl);
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), ctx.timeout);
  const ext = ctx.signal;
  const onExt = () => { try { ac.abort(); } catch { /* 忽略 */ } };
  if (ext) {
    if (ext.aborted) onExt();
    else if (typeof ext.addEventListener === 'function') ext.addEventListener('abort', onExt);
  }
  try {
    const res = await aiNetSession().fetch(url, {
      method: ctx.method,
      headers: ctx.headers,
      body: ctx.payload,
      signal: ac.signal
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      const err = new Error('HTTP ' + res.status + (detail ? ' ' + detail.slice(0, 300) : ''));
      err.status = res.status;
      throw err;
    }
    return await res.json();
  } finally {
    if (ext && typeof ext.removeEventListener === 'function') ext.removeEventListener('abort', onExt);
    clearTimeout(timer);
  }
}

/* AI 专用 JSON 请求：直连 → 失败探测本机代理 → 走代理；显式配置了代理则 代理 → 直连 */
async function aiFetchJson(url, opts) {
  const o = opts || {};
  const method = o.method || 'POST';
  const ctx = {
    method,
    timeout: o.timeout || 60000,
    signal: o.signal,
    payload: o.body === undefined ? undefined : JSON.stringify(o.body),
    headers: Object.assign({
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36',
      'Accept': 'application/json'
    }, method === 'GET' ? {} : { 'Content-Type': 'application/json' }, o.headers || {})
  };
  const tries = Math.max(1, o.tries || 1);
  const run = async (proxyUrl) => {
    let last = null;
    for (let attempt = 0; attempt < tries; attempt++) {
      if (attempt > 0) {
        const wait = /HTTP 4|HTTP 5|1302|1305/.test(String(last && last.message)) ? (attempt === 1 ? 2000 : 5000) : 1500;
        await new Promise((r) => setTimeout(r, wait));
      }
      try {
        return await aiFetchOnce(url, ctx, proxyUrl);
      } catch (e) {
        last = e;
        if (ctx.signal && ctx.signal.aborted) throw new Error('已停止生成');
        if (!isRetryableError(e) || attempt === tries - 1) break;
      }
    }
    throw last || new Error('请求失败');
  };

  const explicit = aiProxyOf();
  if (explicit) {
    try {
      return await run(explicit);
    } catch (e) {
      if (ctx.signal && ctx.signal.aborted) throw e;
      if (!aiNetError(e)) throw new Error(friendlyNetError(e, ctx.timeout));
      return await run('');
    }
  }
  try {
    return await run('');
  } catch (e) {
    if (ctx.signal && ctx.signal.aborted) throw e;
    if (!aiNetError(e)) throw new Error(friendlyNetError(e, ctx.timeout));
    const found = await aiFindLocalProxy();
    if (!found) throw new Error(friendlyNetError(e, ctx.timeout) + '；本机没有检测到可用代理');
    const res = await run(found);
    store.aiProxy = found;
    saveStore();
    appendLog('AI_PROXY_AUTO', { proxy: found });
    return res;
  }
}

function aiConfigReady(storeRef) {
  const base = String(storeRef.aiBaseUrl || '').trim();
  const model = String(storeRef.aiModel || '').trim();
  const provider = AI_PROVIDERS.find((p) => p.id === storeRef.aiProvider) || AI_PROVIDERS[0];
  if (storeRef.aiProvider === 'custom') {
    const norm = normalizeAiBase(base);
    if (!norm) return { ok: false, error: '请先填写接口地址（https:// 开头；本机地址可直接写 127.0.0.1:端口）' };
    if (!model) return { ok: false, error: '请先填写模型名（可从网关的 /v1/models 里挑）' };
    return { ok: true, base: norm, model };
  }
  if (!base && provider.baseUrl) return { ok: true, base: provider.baseUrl, model: model || provider.model };
  return { ok: true, base, model };
}

/* ---------------- 自动模型选择：一个模型排队/报错就换下一个 ---------------- */
/* Kilo 免费池里实测响应快的模型排前面；kilo-auto/free 是网关自己的自动路由 */
const AI_KILO_ORDER = KILO_MODELS.map((m) => m.id);
const aiCooldown = new Map();
const AI_COOLDOWN_MS = 90000;

function aiCooling(model) {
  const at = aiCooldown.get(model);
  if (!at) return false;
  if (Date.now() - at < AI_COOLDOWN_MS) return true;
  aiCooldown.delete(model);
  return false;
}

function aiModelMeta(providerId, model) {
  const pid = String(providerId || '');
  if (pid === 'kilo') {
    const found = KILO_MODELS.find((m) => m.id === model);
    return found || { id: model, name: model, ctx: 0, think: true };
  }
  return { id: model, name: model, ctx: 0, think: false };
}

/* 内容路由：按问题类型优先尝试更合适的免费模型，视觉问题先走 VL / Omni */
const AI_TASK_MODELS = {
  vision: ['nvidia/nemotron-3.5-super-vl:free', 'nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free'],
  code: ['inclusionai/ling-3.2-flash:free', 'nvidia/nemotron-3-ultra-550b-a55b:free', 'nvidia/nemotron-3.5-lightning:free'],
  math: ['nvidia/nemotron-3-ultra-550b-a55b:free', 'nvidia/nemotron-3.5-lightning:free', 'inclusionai/ling-3.2-flash:free'],
  history: ['baidu/ernie-5.5-flash-preview:free', 'inclusionai/ling-3.2-flash:free'],
  long: ['inclusionai/ling-3.2-flash:free', 'particle-ai/particle-1:free', 'reflection/beam-free'],
  general: ['kilo-auto/free']
};
function aiTaskOf(text, hasImage) {
  if (hasImage) return 'vision';
  const s = String(text || '');
  if (/数学|公式|方程|导数|积分|几何|三角|概率|物理|化学|计算|求解/.test(s)) return 'math';
  if (/代码|编程|函数|算法|python|javascript|java|c\+\+|sql|报错|bug|程序/i.test(s)) return 'code';
  if (/历史|人物|朝代|战争|革命|古代|近代|史料|评价/.test(s)) return 'history';
  if (s.length > 600) return 'long';
  return 'general';
}

/* 候选链：当前配置的模型 → Kilo 免费池其余模型 → 其他已配密钥的供应商 */
function aiCandidates(opts) {
  const o = opts || {};
  const provider = aiProviderOf(store);
  const out = [];
  const seen = new Set();
  const push = (providerId, model, allowCooling) => {
    const m = String(model || '').trim();
    if (!m) return;
    const key = providerId + '::' + m;
    if (seen.has(key)) return;
    seen.add(key);
    const meta = aiModelMeta(providerId, m);
    /* 视觉请求只走支持图片的模型：否则 kilo-auto / 文本模型会返回 404，最后被别的供应商 401 盖住 */
    if (o.vision) {
      if (providerId === 'kilo' && !meta.vision) return;
      if (providerId === 'pollinations') return;
      if (providerId === 'zhipu' && !/vision|vl|4v/i.test(m)) return;
    }
    const entryProvider = AI_PROVIDERS.find((p) => p.id === providerId) || provider;
    out.push({
      providerId,
      providerName: entryProvider.name,
      base: providerId === 'custom' ? (normalizeAiBase(store.aiBaseUrl) || '') : (entryProvider.baseUrl || ''),
      model: m,
      modelName: meta.name,
      think: !!meta.think,
      key: aiKeyOf(providerId),
      noKey: !!entryProvider.noKey,
      cooling: aiCooling(m) && !allowCooling
    });
  };

  const preferred = String(o.model || store.aiModel || '').trim();
  if (provider.id === 'kilo') {
    push('kilo', preferred, true);
    /* 只排前 3 个 Kilo 模型，给其它免密钥通道留出候选位，不然整条链全被 Kilo 占满 */
    AI_KILO_ORDER.slice(0, 3).forEach((m) => push('kilo', m, false));
  } else if (provider.id === 'custom') {
    push('custom', preferred, true);
    (Array.isArray(store.aiCustomModels) ? store.aiCustomModels : []).forEach((m) => push('custom', m, false));
  } else {
    push(provider.id, preferred || provider.model, true);
    (provider.presets || []).forEach((m) => push(provider.id, m, false));
  }

  if (o.vision) {
    /* 视觉模型不在前 3 个默认候选里，这里显式补进候选链 */
    AI_TASK_MODELS.vision.forEach((m) => push('kilo', m, false));
    KILO_MODELS.filter((x) => x.vision).forEach((x) => push('kilo', x.id, false));
  }

  if (store.aiAutoModel !== false) {
    AI_PROVIDERS.forEach((p) => {
      if (p.id === 'custom' || p.id === provider.id) return;
      if (!p.noKey && !aiKeyOf(p.id)) return;
      const models = p.id === 'kilo' ? AI_KILO_ORDER.slice(0, 3) : [p.model].concat((p.presets || []).slice(0, 2));
      models.forEach((m) => push(p.id, m, false));
    });
  }

  // 自动模型：按内容类型把更合适的免费模型排到前面（用户手选的模型仍排第一）
  if (store.aiAutoModel !== false && !o.model) {
    const task = aiTaskOf(o.query || '', !!o.vision);
    const pref = AI_TASK_MODELS[task] || AI_TASK_MODELS.general;
    out.sort((a, b) => {
      const ia = pref.indexOf(a.model);
      const ib = pref.indexOf(b.model);
      return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
    });
  }

  // 冷却中的模型排到最后，仅当整条链都冷却时才回退使用
  const ready = out.filter((c) => !c.cooling);
  const cooling = out.filter((c) => c.cooling);
  const ordered = ready.concat(cooling);
  const limit = o.maxModels || (out.length > 1 ? 6 : 1);
  return ordered.slice(0, Math.max(1, limit));
}

/* ---------------- 免密钥网关预检：不可达就别傻等 90 秒 ---------------- */
const aiReachCache = new Map();
const AI_REACH_TTL = 5 * 60 * 1000;

async function aiReachable(cand) {
  const base = String((cand && cand.base) || '').replace(/\/+$/, '');
  if (!base) return true;
  const hit = aiReachCache.get(base);
  if (hit && Date.now() - hit.at < AI_REACH_TTL) return hit.ok;
  let ok = false;
  try {
    const res = await aiFetchJson(base + '/models', { method: 'GET', timeout: 5000, tries: 1 });
    ok = !!(res && (Array.isArray(res.data) || Array.isArray(res.models)));
  } catch (e) {
    ok = false;
  }
  aiReachCache.set(base, { ok, at: Date.now() });
  return ok;
}

/* 免密钥供应商整家不通时，直接从候选链里摘掉；全都不通就留一个快失败的兜底 */
async function aiPruneCandidates(list) {
  if (list.length <= 1) return list;
  const blocked = new Set();
  for (const c of list) {
    // 只探 Kilo：它时通时断，探一次能省掉几十秒等待；其它免密钥通道（Pollinations）有频率限制，多探反而浪费额度
    if (!c.noKey || c.providerId !== 'kilo' || blocked.has(c.providerId)) continue;
    const ok = await aiReachable(c);
    if (!ok) blocked.add(c.providerId);
  }
  if (!blocked.size) return list;
  appendLog('AI_PROVIDER_UNREACHABLE', { providers: Array.from(blocked) });
  const live = list.filter((c) => !blocked.has(c.providerId));
  if (live.length) return live;
  const only = list.slice(0, 1);
  only[0].fastFail = true;
  return only;
}

/* GET 版 JSON 请求：用于拉取 /models 列表 */
async function postJsonGet(url, timeout = 30000, headers) {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeout);
  try {
    const res = await net.fetch(url, {
      method: 'GET',
      signal: ac.signal,
      headers: Object.assign({
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36',
        'Accept': 'application/json'
      }, headers || {})
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      throw new Error('HTTP ' + res.status + (detail ? ' ' + detail.slice(0, 160) : ''));
    }
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

/* 单次请求：针对一个候选模型发一次 Chat Completions */
async function aiCallOnce(cand, body, o) {
  const headers = {};
  // 免密钥供应商绝不带 Authorization：带上别人的 Key 会被网关判 401
  const key = cand.noKey ? '' : (cand.key || '');
  if (key) headers.Authorization = 'Bearer ' + key;
  const base = String(cand.base || '').replace(/\/+$/, '');
  if (!base) throw new Error('接口地址为空，请先在 AI 设置里填写');
  const url = base + '/chat/completions';
  const send = (payload) => aiFetchJson(url, { body: payload, timeout: o.timeout || 90000, headers, tries: o.tries || 1, signal: o.signal });

  const wantThink = o.think === true;
  const payload = Object.assign({}, body);
  if (cand.think) {
    // 想拿思考过程就显式要，不想要就关掉：Nemotron / GPT-OSS 这类会先输出 reasoning，把 max_tokens 吃光
    payload.reasoning = { enabled: wantThink };
    delete payload.reasoning_effort;
  }
  /* 参数级降级梯子：网关不认哪个字段就摘掉哪个，最后一次只用最朴素的三个字段 */
  const ladder = [payload];
  if (cand.think) ladder.push(Object.assign({}, body));
  if (body.response_format) {
    const noFmt = Object.assign({}, body);
    delete noFmt.response_format;
    ladder.push(noFmt);
  }
  if (body.max_tokens) {
    // 商汤每日新兼容模式用 max_completion_tokens，智谱用 max_tokens，两个都试
    const alt = Object.assign({}, body);
    alt.max_completion_tokens = alt.max_tokens;
    delete alt.max_tokens;
    ladder.push(alt);
    const none = Object.assign({}, body);
    delete none.max_tokens;
    ladder.push(none);
  }
  if (typeof body.temperature === 'number') {
    const noTemp = Object.assign({}, body);
    delete noTemp.temperature;
    ladder.push(noTemp);
  }
  let res = null;
  let usedPayload = null;
  let lastErr = null;
  const tried = new Set();
  for (const attemptBody of ladder) {
    const sig = JSON.stringify(attemptBody);
    if (tried.has(sig)) continue;
    tried.add(sig);
    try {
      res = await send(attemptBody);
      usedPayload = attemptBody;
      lastErr = null;
      break;
    } catch (e) {
      lastErr = e;
      if (String(e.message) === '已停止生成') break;
      const st = Number(e.status) || 0;
      // 认证/权限/地址/限流/服务端错误：换字段没用，直接交给上层换模型
      if (st === 401 || st === 403 || st === 404 || st === 429 || st >= 500) break;
      const soft = st === 400 || /reasoning|unknown|unsupported|invalid|parameter|字段|max_tokens|response_format|temperature|400/i.test(String(e.message));
      if (!soft) break;
    }
  }
  if (lastErr) throw lastErr;
  const choices = (res && res.choices) || [];
  if (!choices.length) {
    throw new Error((res && res.error && res.error.message) || '模型没有返回内容');
  }
  const msg = choices[0].message || {};
  let content = String(msg.content == null ? '' : msg.content).trim();
  let reasoning = String(msg.reasoning || msg.reasoning_content || '').trim();
  if (!content && reasoning && wantThink && cand.think && usedPayload) {
    // 思考很贵：轻量模型常把 max_tokens 全花在 reasoning 上，正文被截成空串。
    // 这时对同一个模型关掉思考再要一次正文，两段都留下，用户既看得到思考也拿得到答案。
    try {
      const plain = Object.assign({}, usedPayload, { reasoning: { enabled: false } });
      const res2 = await send(plain);
      const msg2 = (res2.choices && res2.choices[0] && res2.choices[0].message) || {};
      const c2 = String(msg2.content == null ? '' : msg2.content).trim();
      if (c2) {
        content = c2;
        res = res2;
        const r2 = String(msg2.reasoning || msg2.reasoning_content || '').trim();
        if (r2.length > reasoning.length) reasoning = r2;
      }
    } catch (e) {
      if (String(e.message) === '已停止生成') throw e;
    }
  }
  if (!content) {
    const err = new Error(reasoning ? '模型只输出了思考过程，正文是空的' : '模型没有返回内容');
    err.emptyContent = true;
    err.reasoning = reasoning.slice(0, 6000);
    throw err;
  }
  return {
    content,
    usage: res.usage || null,
    model: res.model || cand.model,
    reasoning: reasoning.slice(0, 6000),
    reasoningLen: reasoning.length
  };
}

/* 通用对话：messages 为 [{role, content}]；开启自动换模型时沿候选链逐个尝试 */
async function aiChat(messages, opts) {
  const o = opts || {};
  const cands = await aiPruneCandidates(aiCandidates(o));
  if (!cands.length) {
    const ready = aiConfigReady(store);
    throw new Error(ready.ok ? '暂无可用的模型，请检查 AI 设置' : ready.error);
  }
  const attempted = [];
  let lastError = null;
  for (let i = 0; i < cands.length; i++) {
    const cand = cands[i];
    if (o.signal && o.signal.aborted) throw new Error('已停止生成');
    const body = {
      model: cand.model,
      messages,
      temperature: typeof o.temperature === 'number' ? o.temperature : 0.4,
      stream: false
    };
    if (o.maxTokens) body.max_tokens = o.maxTokens;
    if (o.json) body.response_format = { type: 'json_object' };
    try {
      const oneOpts = cand.fastFail
        ? Object.assign({}, o, { timeout: Math.min(o.timeout || 90000, 12000) })
        : Object.assign({}, o, { think: o.think === true });
      const res = await aiCallOnce(cand, body, oneOpts);
      aiCooldown.delete(cand.model);
      /* 记下这次真正跑起来的模型：徽标与配置面板都读它 */
      store.aiModelUsed = (res.model && String(res.model)) || cand.model;
      saveStore();
      return {
        content: res.content,
        usage: res.usage,
        model: res.model,
        reasoning: res.reasoning || '',
        providerId: cand.providerId,
        providerName: cand.providerName,
        attempted,
        switched: attempted.length > 0
      };
    } catch (e) {
      lastError = e;
      if (e.message === '已停止生成') throw e;
      attempted.push({ model: cand.model, providerName: cand.providerName, error: String(e.message || '').slice(0, 160) });
      aiCooldown.set(cand.model, Date.now());
    }
  }
  const hint = cands.some((c) => c.fastFail) ? '；免费模型池当前网络不可达，可在 AI 设置里填本机代理，或换用有密钥的供应商' : '';
  const err = new Error((lastError ? lastError.message : '模型没有返回内容') + hint);
  err.attempted = attempted;
  throw err;
}

function aiSubjectText(storeRef) {
  const ids = Array.isArray(storeRef.selectedSubjects) && storeRef.selectedSubjects.length
    ? storeRef.selectedSubjects
    : DEFAULT_SUBJECTS;
  return ids.map((id) => SUBJECT_NAMES[id] || id).join('、');
}

function aiTopicLabel(storeRef, topic) {
  const t = String(topic || '').trim() || storeRef.aiTopic || '每日热点';
  return t.slice(0, 40);
}

/* 联网热点：多源并行（今日头条 + 百度热搜 + 知乎日报 + 人民网），按天缓存；全挂时退回新浪滚动 */
async function aiHotNews(force) {
  const today = new Date().toISOString().slice(0, 10);
  if (!force && store.aiNewsDate === today && store.aiNewsCache && store.aiNewsCache.text) {
    return store.aiNewsCache;
  }
  let error = '';
  const lines = [];
  const sources = [];
  const jobs = [
    { name: '今日头条', p: aiToutiaoHotItems(10, 9000) },
    { name: '百度热搜', p: aiBaiduHotItems(8, 9000) },
    { name: '知乎日报', p: aiZhihuDailyItems(5, 9000) },
    { name: '人民网', p: aiRssSourceItems(AI_RSS_FEEDS[0], 4, 9000) }
  ];
  const settled = await Promise.allSettled(jobs.map((j) => j.p));
  settled.forEach((res, i) => {
    const name = jobs[i].name;
    if (res.status === 'fulfilled' && Array.isArray(res.value) && res.value.length) {
      sources.push({ name, count: res.value.length });
      res.value.forEach((it) => {
        const bits = [it.title];
        if (it.snippet) bits.push('— ' + it.snippet);
        if (it.url) bits.push('（' + it.url + '）');
        lines.push('[' + name + '] ' + bits.join(' '));
      });
    } else if (res.status === 'rejected') {
      const msg = String((res.reason && res.reason.message) || res.reason).slice(0, 120);
      if (!error) error = msg;
      appendLog('AI_NEWS_FAIL', { engine: name, error: msg });
    }
  });
  /* 四路都挂了：退回新浪滚动，至少给模型一点当日新闻 */
  if (!lines.length) {
    try {
      const raw = await fetchText(AI_HOT_URL, 10000);
      let parsed = null;
      try { parsed = JSON.parse(raw); } catch { parsed = null; }
      const items = parsed && parsed.result && Array.isArray(parsed.result.data) ? parsed.result.data : [];
      items.slice(0, 12).forEach((it) => {
        const title = String((it && (it.title || it.stitle)) || '').trim();
        const url = String((it && it.url) || '').trim();
        if (title) lines.push('[新浪] ' + title + (url ? ' （' + url + '）' : ''));
      });
      if (lines.length) sources.push({ name: '新浪滚动', count: lines.length });
    } catch (e) {
      if (!error) error = e.message;
    }
  }
  const count = lines.length;
  const text = lines.slice(0, 24).map((one, i) => '(' + (i + 1) + ') ' + one).join('\n');
  const payload = {
    date: today,
    count,
    sources,
    text: text || '（暂未获取到今日热点，将由模型生成通用备考素材）',
    error
  };
  store.aiNewsDate = today;
  store.aiNewsCache = payload;
  saveStore();
  return payload;
}



/* ---------------- 每日热点自动化：到点抓取 + 主界面卡片 ---------------- */
/* 时间只接受 HH:mm，非法值一律回落 08:00，避免坏数据把定时器卡死 */
function normalizeNewsTime(v) {
  const s = String(v == null ? '' : v).trim();
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(s) ? s : '08:00';
}

/* 卡片只认这几条字段，顺手去重、截断，避免把大对象塞进 store */
function normalizeNewsItems(input) {
  const list = Array.isArray(input) ? input : [];
  const seen = new Set();
  const out = [];
  list.forEach((it) => {
    if (!it || typeof it !== 'object') return;
    const title = String(it.title || '').replace(/\s+/g, ' ').trim().slice(0, 120);
    if (!title || seen.has(title)) return;
    seen.add(title);
    const url = String(it.url || '').trim().slice(0, 400);
    const summary = String(it.summary || '').replace(/\s+/g, ' ').trim().slice(0, 160);
    out.push({
      title,
      source: String(it.source || it.src || '').trim().slice(0, 20),
      summary,
      date: String(it.date || '').trim().slice(0, 20),
      url: /^https?:\/\//i.test(url) ? url : ''
    });
  });
  return out.slice(0, 12);
}

/* 重要度打分：权威源 > 热榜，关键词命中加分，越靠前分越高 */
const NEWS_IMPORTANT_RE = /重大|突发|紧急|国务院|中央|全国|外交|国际|战争|冲突|政策|发布|通报|事故|灾害|高考|教育|开学|考试|录取|分数线|经济|就业|物价|医保|社保|航天|科技|芯片|人工智能/;
function newsScoreOf(it, sourceRank, index) {
  const text = String((it && it.title) || '');
  let score = (sourceRank || 1) * 10 - index;
  if (NEWS_IMPORTANT_RE.test(text)) score += 14;
  if (/国际|全球|海外|联合国|美国|欧洲|俄|乌|中东|日韩|东盟/i.test(text)) score += 6;
  if (text.length >= 8 && text.length <= 40) score += 2;
  return score;
}

/* 多路公开源并行抓一次，按重要度排序；全部失败时退回新浪滚动 */
async function newsFetchItems() {
  const jobs = [
    { name: '今日头条', rank: 2, p: aiToutiaoHotItems(10, 9000) },
    { name: '百度热搜', rank: 2, p: aiBaiduHotItems(10, 9000) },
    { name: '知乎日报', rank: 1, p: aiZhihuDailyItems(5, 9000) },
    { name: '人民网', rank: 3, p: aiRssSourceItems(AI_RSS_FEEDS[0], 6, 9000) },
    { name: '新华网', rank: 3, p: aiRssSourceItems(AI_RSS_FEEDS[1], 6, 9000) },
    { name: '中新网', rank: 3, p: aiRssSourceItems(AI_RSS_FEEDS[2], 6, 9000) },
    { name: 'Bing 资讯', rank: 2, p: aiBingNewsItems('国内外 重大新闻', 8, 9000) },
    { name: 'Bing 资讯', rank: 2, p: aiBingNewsItems('国际 要闻', 6, 9000) }
  ];
  const settled = await Promise.allSettled(jobs.map((j) => j.p));
  const candidates = [];
  const sources = [];
  let error = '';
  settled.forEach((res, i) => {
    const name = jobs[i].name;
    if (res.status === 'fulfilled' && Array.isArray(res.value) && res.value.length) {
      const exist = sources.find((s) => s.name === name);
      if (exist) exist.count += res.value.length;
      else sources.push({ name, count: res.value.length });
      res.value.forEach((it, idx) => {
        candidates.push({
          title: it.title,
          source: name,
          summary: it.snippet || it.summary || '',
          date: it.date || '',
          url: it.url,
          score: newsScoreOf(it, jobs[i].rank, idx)
        });
      });
    } else if (res.status === 'rejected' && !error) {
      error = String((res.reason && res.reason.message) || res.reason).slice(0, 120);
    }
  });
  if (!candidates.length) {
    try {
      const raw = await fetchText(AI_HOT_URL, 10000);
      let parsed = null;
      try { parsed = JSON.parse(raw); } catch { parsed = null; }
      const rows = parsed && parsed.result && Array.isArray(parsed.result.data) ? parsed.result.data : [];
      rows.slice(0, 12).forEach((it, idx) => {
        const title = String((it && (it.title || it.stitle)) || '').trim();
        if (title) {
          candidates.push({
            title, source: '新浪滚动', summary: '', date: '', url: String((it && it.url) || '').trim(),
            score: newsScoreOf({ title }, 2, idx)
          });
        }
      });
      if (candidates.length) sources.push({ name: '新浪滚动', count: candidates.length });
    } catch (e) {
      if (!error) error = e.message;
    }
  }
  /* 先按分数排序，再做标题去重，最后取前 8 条 */
  const seen = new Set();
  const items = [];
  candidates
    .sort((a, b) => b.score - a.score)
    .forEach((it) => {
      const key = String(it.title).replace(/[\s,.!?，。！？、：；「」（）【】"'“”·\-—|:;]/g, '').slice(0, 16);
      if (!key || seen.has(key)) return;
      seen.add(key);
      items.push(it);
    });
  return { items: normalizeNewsItems(items.slice(0, 8)), sources, error };
}

/* 今日趋势点评：优先让模型写 2-3 句；模型不可用时用来源与关键词拼一句兜底 */
async function newsTrendOf(items) {
  const list = Array.isArray(items) ? items : [];
  if (!list.length) return '';
  const titles = list.map((it, i) => `${i + 1}. ${it.title}（${it.source || '公开热榜'}）`).join('\n');
  if (store.aiEnabled !== false && aiConfigReady(store).ok) {
    try {
      const res = await aiChat([
        { role: 'system', content: '你是新闻编辑，用简体中文写「今日趋势点评」。只输出 2-3 句连贯的话，不分点、不加标题、不用「综上所述」，不编造事实。' },
        { role: 'user', content: '下面是今天的新闻热点：\n' + titles + '\n\n请概括今天舆论共同关注的方向、可能的成因，以及对高中生备考的启示，控制在 90 字内。' }
      ], { maxTokens: 260, temperature: 0.5, timeout: 45000, tries: 1 });
      const text = String(res.content || '').replace(/\s+/g, ' ').trim();
      if (text) return text.slice(0, 300);
    } catch (e) {
      appendLog('NEWS_TREND_FAIL', { error: String((e && e.message) || e).slice(0, 100) });
    }
  }
  const names = Array.from(new Set(list.map((it) => it.source).filter(Boolean))).slice(0, 3);
  const top = list.slice(0, 3).map((it) => it.title).join('；');
  return `今日热点主要集中在${top}。信息来自${names.join('、') || '公开热榜'}，可结合学科视角继续跟进。`;
}


/* 卡片要的摘要：启用状态、抓取时间、条目与失败原因 */
function newsBrief() {
  const items = Array.isArray(store.newsAutoItems) ? store.newsAutoItems : [];
  return {
    enabled: store.newsAutoEnabled !== false,
    time: normalizeNewsTime(store.newsAutoTime),
    date: store.newsAutoDate || '',
    today: dateKey(),
    items: items.slice(0, 12),
    sources: Array.isArray(store.newsAutoSources) ? store.newsAutoSources : [],
    trend: store.newsAutoTrend || '',
    error: store.newsAutoError || '',
    at: Number(store.newsAutoAt) || 0
  };
}

function newsBroadcast() {
  const payload = newsBrief();
  BrowserWindow.getAllWindows().forEach((w) => {
    try {
      if (!w.isDestroyed()) w.webContents.send('news:updated', payload);
    } catch { /* 忽略 */ }
  });
}

/* 抓一次写进 store；force=true 表示用户手动刷新，忽略「今天已经抓过」 */
async function newsRefresh(force) {
  const today = dateKey();
  if (!force && store.newsAutoDate === today && Array.isArray(store.newsAutoItems) && store.newsAutoItems.length) {
    return newsBrief();
  }
  const out = await newsFetchItems();
  if (out.items.length) {
    store.newsAutoDate = today;
    store.newsAutoItems = out.items;
    store.newsAutoSources = out.sources;
    store.newsAutoTrend = '';
    store.newsAutoError = '';
    store.newsAutoAt = Date.now();
    saveStore();
    appendLog('NEWS_AUTO', {
      force: !!force, date: store.newsAutoDate, count: out.items.length,
      ok: true, error: ''
    });
    newsBroadcast();
    /* 趋势点评需要模型，放到后台算；算完再广播一次，不拖慢卡片首屏 */
    newsTrendOf(out.items).then((text) => {
      if (!text) return;
      if (store.newsAutoDate !== today) return;
      store.newsAutoTrend = text;
      saveStore();
      newsBroadcast();
    }).catch(() => { /* 点评失败不影响条目 */ });
    return newsBrief();
  }
  store.newsAutoError = out.error || '暂未获取到今日热点';
  store.newsAutoAt = Date.now();
  saveStore();
  appendLog('NEWS_AUTO', {
    force: !!force, date: store.newsAutoDate, count: 0,
    ok: false, error: store.newsAutoError
  });
  newsBroadcast();
  return newsBrief();
}

/* 每 60 秒看一次表：到点且今天还没抓过就抓；晚开机当天的补抓也靠它 */
let newsTimer = null;
function newsTick() {
  if (store.newsAutoEnabled === false) return;
  const today = dateKey();
  if (store.newsAutoDate === today) return;
  const now = new Date();
  const hhmm = String(now.getHours()).padStart(2, '0') + ':' + String(now.getMinutes()).padStart(2, '0');
  if (hhmm < normalizeNewsTime(store.newsAutoTime)) return;
  newsRefresh(true).catch(() => { /* 失败原因已写进 store，卡片上会显示 */ });
}

function startNewsScheduler() {
  if (newsTimer) clearInterval(newsTimer);
  /* 启动 6 秒后先补一次，避免开机晚于设定时间就整天没内容 */
  setTimeout(() => { try { newsTick(); } catch { /* 忽略 */ } }, 6000);
  newsTimer = setInterval(() => { try { newsTick(); } catch { /* 忽略 */ } }, 60 * 1000);
}

/* ---------------- 联网检索：Bing RSS 主通道 + 百度热搜榜 ---------------- */
function aiStripTags(s) {
  return String(s || '')
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

function aiRssItems(xml, limit) {
  const out = [];
  const blocks = String(xml || '').match(/<item>[\s\S]*?<\/item>/g) || [];
  blocks.slice(0, limit || 8).forEach((one) => {
    const pick = (tag) => {
      const m = one.match(new RegExp('<' + tag + '>([\\s\\S]*?)<\\/' + tag + '>'));
      return m ? aiStripTags(m[1]) : '';
    };
    const title = pick('title');
    const url = pick('link');
    if (!title || !url) return;
    out.push({ title: title.slice(0, 120), url: url.slice(0, 400), date: pick('pubDate').slice(0, 40), snippet: pick('description').slice(0, 160) });
  });
  return out;
}

/* 今日头条热榜：公开 JSON，data[].Title / Url */
async function aiToutiaoHotItems(limit, timeout) {
  const raw = await fetchText(AI_TOUTIAO_HOT, timeout || 9000);
  const j = JSON.parse(raw);
  const arr = Array.isArray(j.data) ? j.data : [];
  return arr.slice(0, limit || 10).map((x) => ({
    title: aiStripTags(x.Title || x.title || '').slice(0, 120),
    url: String(x.Url || x.url || '').slice(0, 400),
    date: '实时',
    snippet: '',
    src: '今日头条'
  })).filter((x) => x.title);
}

/* 知乎日报：公开 JSON，stories[].title / id / hint */
async function aiZhihuDailyItems(limit, timeout) {
  const raw = await fetchText(AI_ZHIHU_LATEST, timeout || 9000);
  const j = JSON.parse(raw);
  const arr = Array.isArray(j.stories) ? j.stories : [];
  return arr.slice(0, limit || 6).map((x) => ({
    title: aiStripTags(x.title || '').slice(0, 120),
    url: x.url ? (/^https?:/.test(String(x.url)) ? String(x.url) : 'https://daily.zhihu.com/story/' + x.id) : '',
    date: '今日',
    snippet: aiStripTags(x.hint || '').slice(0, 120),
    src: '知乎日报'
  })).filter((x) => x.title);
}

/* 通用 RSS：给权威媒体与科技媒体的订阅源 */
async function aiRssSourceItems(feed, limit, timeout) {
  if (!feed || !feed.url) return [];
  const xml = await fetchText(feed.url, timeout || 9000, { Accept: 'application/rss+xml,application/xml,text/xml,*/*' });
  return aiRssItems(xml, limit || 5).map((it) => Object.assign(it, { src: feed.name }));
}

/* 多源去重合并：标题去掉空白与标点后取前 16 字作指纹 */
function aiMergeItems(groups, limit) {
  const seen = new Set();
  const out = [];
  (groups || []).forEach((list) => {
    (list || []).forEach((it) => {
      if (!it || !it.title) return;
      const key = String(it.title).replace(/[\s,.!?，。！？、：；「」（）【】"'“”·\-—|:;]/g, '').slice(0, 16);
      if (!key || seen.has(key)) return;
      seen.add(key);
      out.push(it);
    });
  });
  return out.slice(0, limit || 12);
}

/* 问题类型：决定抓哪几路源，避免每次都把七个源全打一遍 */
function aiQueryKind(q) {
  const s = String(q || '');
  if (/科技|人工智能|大模型|芯片|手机|开源|编程|软件|硬件|苹果|华为|小米|特斯拉|发布会|显卡|操作系统|互联网/i.test(s)) return 'tech';
  if (/时政|政策|会议|外交|国际|军事|领导人|国务院|两会|主席|总统|战争|局势|民生|社会/i.test(s)) return 'politics';
  if (/新闻|热点|热搜|大事|时事|今天|今日|昨天|最近|近期|发生了什么|有什么事|世界|国内/i.test(s)) return 'news';
  return 'general';
}

/* 百度热搜：当下真实在聊的话题，适合回答「今天发生了什么」 */
async function aiBaiduHotItems(limit, timeout) {
  const raw = await fetchText(AI_BAIDU_HOT, timeout || 10000);
  const j = JSON.parse(raw);
  const card = (((j.data || {}).cards || [])[0] || {});
  const group = ((card.content || [])[0] || {});
  return (group.content || []).slice(0, limit || 8).map((x) => ({
    title: String((x && x.word) || '').slice(0, 120),
    url: String((x && x.url) || '').slice(0, 400),
    date: '实时',
    snippet: aiStripTags((x && x.desc) || '').slice(0, 160),
    src: '百度热搜'
  })).filter((x) => x.title);
}

/* Bing RSS：给具体问题找网页标题与链接；中文查询走 zh-CN，英文查询走 en-US */
function aiLooksEnglish(q) {
  const s = String(q || '').replace(/[^\x00-\x7F]/g, '');
  return s.length >= 4 && s.length > String(q || '').replace(/\s/g, '').length * 0.6;
}
async function aiBingItems(q, limit, timeout) {
  const base = aiLooksEnglish(q) ? AI_SEARCH_RSS_EN : AI_SEARCH_RSS;
  const xml = await fetchText(base + encodeURIComponent(q), timeout || 12000, { Accept: 'application/rss+xml,application/xml,text/xml,*/*' });
  return aiRssItems(xml, limit || 8).map((it) => Object.assign(it, { src: 'Bing' }));
}
/* Bing 资讯 RSS：比热榜更贴近「这个问题最近的报道」 */
async function aiBingNewsItems(q, limit, timeout) {
  const xml = await fetchText(AI_NEWS_RSS + encodeURIComponent(q), timeout || 12000, { Accept: 'application/rss+xml,application/xml,text/xml,*/*' });
  return aiRssItems(xml, limit || 8).map((it) => Object.assign(it, { src: 'Bing 资讯' }));
}
/* 按类型取 RSS 源，避免每次把九个订阅源全打一遍 */
function aiRssFeedsOf(kind) {
  if (kind === 'tech') return AI_RSS_FEEDS.filter((f) => f.kind === 'tech');
  if (kind === 'politics') return AI_RSS_FEEDS.filter((f) => f.kind === 'politics');
  return AI_RSS_FEEDS.filter((f) => f.kind === 'life' || f.kind === 'society');
}

/* ---------------- 深度检索：多引擎搜索 → 抓正文 → 带编号引用 ---------------- */
/* 参考 Perplexity / 秘塔这类「检索式 AI」的做法：先在多引擎找候选，再抓回正文，
   交给模型时每条都带编号与链接，回答里用 [1][2] 指回来源。 */
const AI_SEARCH_ENGINES = [
  { id: 'toutiao', name: '头条搜索', parse: 'toutiao', url: (q) => 'https://so.toutiao.com/search?keyword=' + encodeURIComponent(q) + '&pd=information' },
  { id: 'so360', name: '360搜索', parse: 'so360', url: (q) => 'https://www.so.com/s?q=' + encodeURIComponent(q) },
  { id: 'bing', name: 'Bing', parse: 'bing', url: (q, page) => 'https://cn.bing.com/search?q=' + encodeURIComponent(q) + '&count=10' + (page > 1 ? '&first=' + (page - 1) * 10 + 1 : '') },
  { id: 'sogou', name: '搜狗', parse: 'sogou', url: (q) => 'https://www.sogou.com/web?query=' + encodeURIComponent(q) }
];
const AI_DEEP_CACHE = new Map();
const AI_DEEP_TTL = 5 * 60 * 1000;
const AI_DEEP_CACHE_MAX = 40;

/* 比 aiStripTags 更彻底：先剥脚本样式，再解 HTML 实体，用于搜索结果与网页正文 */
function aiHtmlText(s) {
  return String(s || '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;|&ensp;|&emsp;|&thinsp;|&#0?160;|&#0?183;|&middot;/gi, ' ')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
    .replace(/&mdash;|&ndash;/g, '—').replace(/&hellip;/g, '…')
    .replace(/&ldquo;/g, '“').replace(/&rdquo;/g, '”')
    .replace(/&[a-z#0-9]+;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function aiCleanTitle(s) {
  return aiHtmlText(s).replace(/([\u4e00-\u9fa5，。、；：！？（）「」《》])\s+(?=[\u4e00-\u9fa5，。、；：！？（）「」《》])/g, '$1');
}

function aiParseBing(html) {
  const out = [];
  String(html || '').split('class="b_algo"').slice(1).forEach((seg) => {
    const h2 = seg.match(/<h2[\s\S]{0,3000}?<\/h2>/);
    if (!h2) return;
    const a = h2[0].match(/<a[^>]+href="(https?:\/\/[^"]+)"[^>]*>([\s\S]*?)<\/a>/);
    if (!a) return;
    const title = aiCleanTitle(a[2]);
    if (!title || title.length < 4) return;
    const p = seg.match(/<p[^>]*>([\s\S]{0,800}?)<\/p>/);
    out.push({ title: title.slice(0, 120), url: a[1], snippet: p ? aiHtmlText(p[1]).slice(0, 200) : '', src: 'Bing' });
  });
  return out;
}

function aiParseSogou(html) {
  const out = [];
  String(html || '').split('class="vr-title').slice(1).forEach((seg) => {
    const a = seg.match(/<a[^>]*href="(https?:\/\/[^"]+)"[^>]*>([\s\S]{0,400}?)<\/a>/);
    if (!a) return;
    const title = aiCleanTitle(a[2]);
    if (!title || title.length < 6) return;
    if (/相关资讯|全部结果|搜索热词|大家都在搜/.test(title)) return;
    if (/sogou\.com\/sogou\?/.test(a[1])) return;
    out.push({ title: title.slice(0, 120), url: a[1], snippet: '', src: '搜狗' });
  });
  return out;
}

function aiParse360(html) {
  const out = [];
  String(html || '').split('class="res-title').slice(1).forEach((seg) => {
    const md = seg.match(/data-mdurl="([^"]+)"/);
    const a = seg.match(/<a[^>]*href="([^"]+)"[^>]*>([\s\S]{0,400}?)<\/a>/);
    if (!a) return;
    const url = md ? md[1] : (/^https?:/.test(a[1]) ? a[1] : '');
    const title = aiCleanTitle(a[2]);
    if (!url || !title) return;
    const p = seg.match(/<p[^>]*class="res-desc"[^>]*>([\s\S]{0,800}?)<\/p>/);
    out.push({ title: title.slice(0, 120), url: url, snippet: p ? aiHtmlText(p[1]).slice(0, 200) : '', src: '360搜索' });
  });
  return out;
}

function aiParseToutiao(html) {
  const out = [];
  const seen = new Set();
  const re = /<a[^>]*href="(\/search\/jump\?[^"]+)"[^>]*>([\s\S]{0,300}?)<\/a>/g;
  let m;
  while ((m = re.exec(String(html || '')))) {
    const title = aiCleanTitle(m[2]);
    if (!title || title.length < 5 || seen.has(title)) continue;
    seen.add(title);
    const hit = m[1].match(/(?:\?|&|&amp;)url=([^&"]+)/);
    let real = '';
    if (hit) { try { real = decodeURIComponent(hit[1]); } catch (e) { real = ''; } }
    if (!/^https?:/i.test(real) && real) {
      try { real = decodeURIComponent(unescape(real)); } catch (e) { /* 保留原值 */ }
    }
    const h5 = String(real).match(/[?&]h5_url=([^&]+)/);
    if (h5) {
      try {
        const inner = decodeURIComponent(h5[1]);
        if (/^https?:/i.test(inner)) real = inner;
      } catch (e) { /* 保留外层地址 */ }
    }
    out.push({
      title: title.slice(0, 120),
      url: /^https?:/i.test(real) ? real : 'https://so.toutiao.com' + m[1].replace(/&amp;/g, '&'),
      snippet: '',
      src: '头条搜索'
    });
  }
  return out;
}

/* 网页正文：按块标签切段，丢掉短块（导航、按钮），保留像正文的段落 */
function aiPageText(html) {
  const src = String(html || '');
  const titleM = src.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const descM = src.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']*)["']/i);
  const body = src
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(nav|header|footer|aside|noscript|svg|form|iframe)[\s\S]*?<\/\1>/gi, ' ');
  const paras = body.split(/<\/(?:p|div|section|article|h[1-4]|li|td|br)>/i)
    .map((x) => aiHtmlText(x))
    .filter((x) => x.length >= 40);
  let text = paras.join('\n');
  if (text.length < 200 && descM) text = aiHtmlText(descM[1]) + '\n' + text;
  return { title: titleM ? aiHtmlText(titleM[1]).slice(0, 120) : '', text: text.slice(0, 2400) };
}

/* 抓 HTML 时按 meta / header 里的字符集解码，GBK 站点不会变成乱码 */
async function aiFetchHtmlText(url, timeout, headers) {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeout || 9000);
  try {
    const res = await net.fetch(url, {
      signal: ac.signal,
      headers: Object.assign({
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,*/*',
        'Accept-Language': 'zh-CN,zh;q=0.9'
      }, headers || {})
    });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const buf = Buffer.from(await res.arrayBuffer());
    const head = buf.slice(0, 4096).toString('latin1');
    const ct = String(res.headers.get('content-type') || '');
    let cs = (ct.match(/charset=["']?([\w-]+)/i) || [])[1] || (head.match(/charset=["']?([\w-]+)/i) || [])[1] || '';
    cs = /gb2312|gbk|gb18030/i.test(cs) ? 'gbk' : /big5/i.test(cs) ? 'big5' : 'utf-8';
    try { return new TextDecoder(cs).decode(buf); } catch (e) { return buf.toString('utf8'); }
  } finally {
    clearTimeout(timer);
  }
}

async function aiReadPage(item, timeout) {
  if (!item || !/^https?:/i.test(item.url || '')) return null;
  if (/\.(pdf|zip|rar|7z|mp4|mp3|apk|exe|dmg)(\?|$)/i.test(item.url)) return null;
  const html = await aiFetchHtmlText(item.url, timeout || 9000);
  const page = aiPageText(html);
  const text = String(page.text || '').replace(/[ \t]+/g, ' ').replace(/\n{2,}/g, '\n').trim();
  if (text.length < 60) return null;
  return { url: item.url, title: page.title || item.title, chars: text.length, excerpt: text.slice(0, 1600) };
}

/* 从摘要里认时间：2026年11月13日 / 9 小时之前 / 昨天 */
function aiSniffDate(text) {
  const s = String(text || '');
  const m = s.match(/(\d{4})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日/);
  if (m) return m[1] + '-' + String(m[2]).padStart(2, '0') + '-' + String(m[3]).padStart(2, '0');
  const m2 = s.match(/(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m2) return m2[1] + '-' + String(m2[2]).padStart(2, '0') + '-' + String(m2[3]).padStart(2, '0');
  const h = s.match(/(\d{1,2})\s*小时之[前内]/) || s.match(/(\d{1,2})\s*分钟之[前内]/);
  if (h) return '今天';
  if (/昨天|昨日/.test(s)) return '昨天';
  if (/今天|今日|刚刚/.test(s)) return '今天';
  return '';
}

function aiHostOf(url) {
  try { return new URL(url).host.replace(/^www\./, ''); } catch (e) { return ''; }
}

/* 一次问题给两个检索式：原句 + 「最新」，让结果既准确又有时效 */
function aiVariantQueries(q) {
  const base = String(q || '').trim().slice(0, 100);
  if (!base) return [];
  const out = [base];
  if (!/最新|今天|今日|实时|刚刚/.test(base)) out.push(base + ' 最新');
  return out.slice(0, 2);
}

/* 太短或纯寒暄的句子不必联网，省掉一次五秒的等待 */
function aiWorthWeb(text) {
  const s = String(text || '').trim();
  if (s.length < 4) return false;
  if (/^(你好|您好|hi|hello|hey|在吗|谢谢|好的|嗯+|哦|测试|test)[!！。.？?~]*$/i.test(s)) return false;
  return true;
}

/* 垂直源：按问题类型补热榜 / 权威 RSS / 科技媒体，由 aiDeepSearch 统一并发抓取。
   只用公开只读接口，不依赖密钥；某一路失败不影响其他来源。 */
function aiVerticalJobs(q, limit, timeout) {
  const kind = aiQueryKind(q);
  const jobs = [];
  const add = (name, fn) => jobs.push({ name: name, p: Promise.resolve().then(fn) });
  if (kind === 'news') {
    add('今日头条', () => aiToutiaoHotItems(limit, timeout));
    add('百度热搜', () => aiBaiduHotItems(limit, timeout));
    add('知乎日报', () => aiZhihuDailyItems(6, timeout));
    add('Bing 资讯', () => aiBingNewsItems(q, limit, timeout));
  } else if (kind === 'politics') {
    add('人民网', () => aiRssSourceItems(AI_RSS_FEEDS[0], 5, timeout));
    add('新华网', () => aiRssSourceItems(AI_RSS_FEEDS[1], 5, timeout));
    add('中新网', () => aiRssSourceItems(AI_RSS_FEEDS[2], 5, timeout));
  } else if (kind === 'tech') {
    aiRssFeedsOf('tech').forEach((feed) => {
      add(feed.name, () => aiRssSourceItems(feed, 4, timeout));
    });
  } else {
    /* 具体问题不加热榜/生活类垂直源，避免「今天的热搜」把无关内容带进回答；
       只有明确问「最近/热点」时才由上面的 news 分支补充。 */
  }
  return jobs;
}

/* 查询词切分：中文 2 字滑窗 + 英文/数字，去掉常见虚词，用于结果相关性打分 */
function aiQueryTokens(q) {
  const s = String(q || '').toLowerCase();
  const stop = new Set(['什么', '怎么', '如何', '为什么', '哪些', '一下', '请问', '今天', '最近', '最新', '介绍', '解释', '帮我', '可以', '需要', '关于', '的是', '有哪些', '一个', '这个', '那个']);
  const tokens = new Set();
  const cn = s.match(/[\u4e00-\u9fa5]{2,}/g) || [];
  cn.forEach((seg) => {
    for (let i = 0; i < seg.length - 1; i++) {
      const t = seg.slice(i, i + 2);
      if (!stop.has(t)) tokens.add(t);
    }
  });
  (s.match(/[a-z0-9]{2,}/g) || []).forEach((t) => tokens.add(t));
  return Array.from(tokens).slice(0, 24);
}
function aiRelevance(it, tokens) {
  if (!tokens.length) return 1;
  const text = (String(it.title || '') + ' ' + String(it.snippet || it.excerpt || '')).toLowerCase();
  let hit = 0;
  tokens.forEach((t) => { if (text.indexOf(t) >= 0) hit++; });
  return hit / Math.min(tokens.length, 8);
}

async function aiDeepSearch(query, opts) {
  const o = opts || {};
  const q = String(query || '').trim().slice(0, 120);
  const nowBits = aiNowBits();
  if (!q) return { ok: false, query: '', source: '', items: [], engines: [], read: null, elapsed: 0, at: nowBits.time };
  const hit = AI_DEEP_CACHE.get(q);
  if (hit && Date.now() - hit.at < AI_DEEP_TTL && !o.refresh && hit.data && hit.data.ok) {
    return Object.assign({ cached: true }, hit.data);
  }
  const started = Date.now();
  const timeout = o.timeout || 11000;
  const plan = [];
  aiVariantQueries(q).forEach((v, vi) => {
    AI_SEARCH_ENGINES.forEach((eng) => {
      plan.push({ engine: eng, q: v, page: 1 });
      // Bing 多抓一页，变体检索不再只发头条和 Bing
      if (eng.id === 'bing' && vi === 0) plan.push({ engine: eng, q: v, page: 2 });
    });
  });
  const parseOf = (id, html) => (id === 'toutiao' ? aiParseToutiao(html) : id === 'so360' ? aiParse360(html) : id === 'bing' ? aiParseBing(html) : aiParseSogou(html));
  const verticalJobs = aiVerticalJobs(q, o.limit || 8, timeout);
  const [settled, verticalSettled] = await Promise.all([
    Promise.allSettled(plan.map((p) => (async () => {
      const acceptLang = aiLooksEnglish(p.q) ? 'en-US,en;q=0.9' : 'zh-CN,zh;q=0.9';
      const html = await fetchText(p.engine.url(p.q, p.page), timeout, { Accept: 'text/html,application/xhtml+xml,*/*', 'Accept-Language': acceptLang });
      return { name: p.engine.name, items: parseOf(p.engine.id, html) };
    })())),
    Promise.allSettled(verticalJobs.map((j) => j.p))
  ]);
  const engines = [];
  const buckets = [];
  settled.forEach((res, i) => {
    if (res.status === 'fulfilled' && res.value.items && res.value.items.length) {
      const name = res.value.name;
      const at = engines.find((e) => e.name === name);
      if (at) at.count += res.value.items.length;
      else engines.push({ name: name, count: res.value.items.length });
      buckets.push(res.value.items);
    } else if (res.status === 'rejected') {
      appendLog('AI_SEARCH_FAIL', { engine: plan[i].engine.name, page: plan[i].page, error: String((res.reason && res.reason.message) || res.reason).slice(0, 120) });
    }
  });
  verticalSettled.forEach((res, i) => {
    if (res.status === 'fulfilled' && Array.isArray(res.value) && res.value.length) {
      const name = verticalJobs[i].name;
      const at = engines.find((e) => e.name === name);
      if (at) at.count += res.value.length;
      else engines.push({ name: name, count: res.value.length });
      buckets.push(res.value);
    } else if (res.status === 'rejected') {
      appendLog('AI_SEARCH_FAIL', { engine: verticalJobs[i].name, error: String((res.reason && res.reason.message) || res.reason).slice(0, 120) });
    }
  });
  /* 轮转交织：各家轮流占一位，避免结果多的引擎霸占前排 */
  const merged = [];
  const seen = new Set();
  const maxLen = buckets.reduce((n, b) => Math.max(n, b.length), 0);
  for (let i = 0; i < maxLen; i++) {
    for (let b = 0; b < buckets.length; b++) {
      const it = buckets[b][i];
      if (!it || !it.title) continue;
      if (/^https?:\/\/ai\.so\.com\//i.test(it.url || '')) continue;
      if (/百度百科|维基百科|百度知道|演唱的歌曲|汉语国学|字典|的意思与解释/.test(it.title || '')) continue;
      if (/hanyuguoxue|zdic\.net|cidianwang/.test(it.url || '')) continue;
      const key = String(it.title).replace(/[\s,.!?，。！？、：；「」（）【】"'“”·\-—|:;]/g, '').slice(0, 16);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      merged.push(it);
    }
  }
  merged.forEach((it) => { if (!it.date) it.date = aiSniffDate(it.snippet || ''); });
  const nowMs = Date.now();
  const ageOf = (it) => {
    const m = String(it.date || '').match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
    if (!m) return -1;
    const t = Date.parse(m[1] + '-' + m[2] + '-' + m[3] + 'T00:00:00+08:00');
    return isNaN(t) ? -1 : Math.round((nowMs - t) / 86400000);
  };
  const stale = (it) => { const a = ageOf(it); return a > 120; };
  const fresh = merged.filter((it) => !stale(it));
  const old = merged.filter(stale);
  const ordered = fresh.concat(old);
  /* 具体问题做相关性过滤：标题/摘要至少要命中查询词，避免热榜和资讯把无关内容带进来；
     新闻/时政类保留按时效与权威度的原顺序。 */
  const qkind = aiQueryKind(q);
  const limit = o.limit || 8;
  let items;
  if (qkind === 'news' || qkind === 'politics') {
    items = ordered.slice(0, limit);
  } else {
    const tokens = aiQueryTokens(q);
    const pool = fresh.length >= 3 ? fresh : ordered;
    const scored = pool.map((it, idx) => ({ it: it, idx: idx, rel: aiRelevance(it, tokens) }));
    const relevant = scored
      .filter((x) => x.rel >= 0.15)
      .sort((a, b) => (b.rel - a.rel) || (a.idx - b.idx));
    items = (relevant.length >= 3 ? relevant : scored.slice(0, 3)).slice(0, limit).map((x) => x.it);
  }
  /* 每家站点最多抓一条正文，最多四篇，控制耗时 */
  const readCount = o.readCount === undefined ? 4 : o.readCount;
  const picked = [];
  const hostUsed = new Set();
  const skipHost = /(^|\.)(baike\.baidu\.com|zhidao\.baidu\.com|wikipedia\.org|douban\.com|bilibili\.com|weibo\.com)$/;
  const goodHost = /(gov\.cn|xinhuanet\.com|people\.com\.cn|chinanews\.com|thepaper\.cn|36kr\.com|ithome\.com|solidot\.org|stdaily\.com|sina\.com\.cn|163\.com|qq\.com|sohu\.com|ifeng\.com|yicai\.com|jiqizhixin\.com|qbitai\.com|sspai\.com|oschina\.net|infoq\.cn|csdn\.net|chsi\.com\.cn|moe\.gov\.cn)$/;
  const rank = (host) => (goodHost.test(host) ? 0 : /toutiao\.com$/.test(host) ? 2 : 1);
  items
    .map((it, i) => ({ it: it, i: i, host: aiHostOf(it.url) }))
    .filter((x) => x.host && !skipHost.test(x.host) && !/article\.zlink\.toutiao\.com/.test(x.host) && String(x.it.url).length <= 320)
    .sort((a, b) => rank(a.host) - rank(b.host) || a.i - b.i)
    .forEach((x) => {
      if (picked.length >= readCount) return;
      if (hostUsed.has(x.host)) return;
      hostUsed.add(x.host);
      picked.push(x.it);
    });
  const reads = await Promise.allSettled(picked.map((it) => aiReadPage(it, timeout)));
  let readOk = 0;
  reads.forEach((res, i) => {
    if (res.status === 'fulfilled' && res.value) {
      readOk++;
      const target = picked[i];
      target.excerpt = res.value.excerpt;
      target.chars = res.value.chars;
      if (!target.title || target.title.length < 6) target.title = res.value.title || target.title;
    }
  });
  const data = {
    ok: items.length > 0,
    query: q,
    kind: aiQueryKind(q),
    source: engines.map((e) => e.name).join(' · '),
    items: items,
    engines: engines,
    read: { tried: picked.length, ok: readOk },
    elapsed: Math.round((Date.now() - started) / 100) / 10,
    at: nowBits.time
  };
  if (data.ok) {
    if (AI_DEEP_CACHE.size >= AI_DEEP_CACHE_MAX) {
      const oldest = AI_DEEP_CACHE.keys().next().value;
      if (oldest) AI_DEEP_CACHE.delete(oldest);
    }
    AI_DEEP_CACHE.set(q, { at: Date.now(), data: data });
  }
  return data;
}

/* 判断这句话是不是在问「现在/最近」的事，需要先联网再回答 */
function aiNeedsWeb(text) {
  const s = String(text || '');
  if (!s) return false;
  return /今天|今日|昨天|昨晚|刚刚|最近|近期|现在|最新|新闻|热点|热搜|发生了什么|有什么事|行情|股价|价格|发布|上市|开售|赛程|比分|天气|版本|更新|2026|2027|今年|本月|上周|这周|实时|current|latest|today|news/i.test(s);
}

function aiNowBits() {
  const now = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return {
    date: now.getFullYear() + '-' + pad(now.getMonth() + 1) + '-' + pad(now.getDate()),
    time: pad(now.getHours()) + ':' + pad(now.getMinutes())
  };
}

function aiWebBlock(search) {
  if (!search || !search.ok || !search.items.length) return '';
  const nowBits = aiNowBits();
  const lines = search.items.map((it, i) => {
    const out = ['[' + (i + 1) + '] ' + (it.src ? it.src + ' · ' : '') + String(it.title || '').slice(0, 120) + (it.date ? '（' + it.date + '）' : '')];
    if (it.snippet) out.push('摘要：' + String(it.snippet).slice(0, 200));
    if (it.url) out.push('链接：' + it.url);
    if (it.excerpt) out.push('正文摘录：' + String(it.excerpt).slice(0, 900));
    return out.join('\n');
  });
  return [
    '【联网检索结果 · ' + (search.source || '网页搜索') + ' · 检索词「' + search.query + '」 · 今天是 ' + nowBits.date + '，抓取于 ' + nowBits.time + '】',
    lines.join('\n\n'),
    '说明：以上是刚刚抓到的公开网页，可能过时或不完整。引用时在句末用 [编号] 标出来源，涉及数字、日期、人名要写清来自哪一条；拿不准就说拿不准，不要自己补日期。'
  ].join('\n');
}

/* 问答主流程：联网检索 → 模型生成（不再做二次审核或改写） */
async function aiRunAsk(payload) {
  const provider = aiProviderOf(store);
  const ac = new AbortController();
  aiAbortCtl = ac;
  const signal = ac.signal;
  const subject = String((payload && payload.subject) || '').trim();
  const mode = String((payload && payload.mode) || 'knowledge').trim();
  const topic = aiTopicLabel(store, payload && payload.topic);
  const query = String((payload && payload.query) || '').trim();
  const attachments = Array.isArray(payload && payload.attachments) ? payload.attachments : [];
  const images = attachments.filter((a) => a && a.kind === 'image' && /^data:image\//i.test(String(a.dataUrl || ''))).slice(0, 3);
  const textFiles = attachments.filter((a) => a && a.kind === 'text' && a.text).slice(0, 3);
  let attachText = '';
  if (textFiles.length) {
    attachText = '\n\n【附件内容】\n' + textFiles.map((f) => {
      return '--- ' + String(f.name || '文件') + ' ---\n' + String(f.text || '').slice(0, 20000);
    }).join('\n\n');
  }
  const subjectText = subject ? '「' + subject + '」' : '（' + aiSubjectText(store) + '）';

  const wantThink = payload && payload.think !== undefined ? !!payload.think : store.aiThink !== false;
  const wantWeb = payload && payload.web !== undefined ? !!payload.web : store.aiWeb !== false;

  let newsBlock = '';
  let source = '模型生成';
  if (mode === 'news') {
    const news = await aiHotNews(!!(payload && payload.refresh));
    newsBlock = news.text;
    const newsNames = (news.sources || []).map((s) => s.name).join(' + ');
    source = news.count ? '联网热点（' + (newsNames || '公开热榜') + '）' : '模型生成';
  }

  /* 问「今天/最近」的事、或用户手动开了联网：先抓公开结果再交给模型 */
  const askText = query || (images.length ? '请分析这张图片' : topic);
  let search = { ok: false, query: '', source: '', items: [] };
  if (wantWeb && aiWorthWeb(askText)) {
    search = await aiDeepSearch(mode === 'news' ? topic : askText, { limit: 8, timeout: 11000, refresh: !!(payload && payload.refresh) });
    if (search.ok) source = search.source + '（联网检索）';
  }
  const webBlock = aiWebBlock(search);

  const nowBits = aiNowBits();
  const system = [
    '你是「AI 知识助手」，一个通用对话助手，除了辅导高考，也能像 ChatGPT 那样聊任何话题。',
    '',
    '【当前时间】今天是 ' + nowBits.date + '，现在 ' + nowBits.time + '（北京时间）。凡涉及「今天/今年/最近」的时间基准都用这一天，不要写成往年日期。',
    '【能力范围】学科知识、时事新闻、生活常识、技术、写作、闲聊都可以直接回答，不需要把每个问题都扯回学习。',
    '【联网信息】如果下面给了【联网检索结果】，就基于它回答「今天/最近」的问题，并写明来源与日期；如果没给，或结果与问题无关，就如实说你这边没有实时信息，再给出已知背景，绝不编造具体日期、数字、人名、比分或价格。',
    '【诚实】不确定就直说不确定；不要为了显得完整而虚构细节，也不要声明自己是「只做高考的助手」而拒绝回答。',
    '【内容安全】拒绝生成色情、性暗示、暴力犯罪教程、赌博诈骗、毒品制作等违法或伤害未成年人的内容；遇到这类请求直接简短拒绝，并把话题引回学习与正常讨论。',
    '【历史人物】历史人物、历史事件、朝代与人物评价属于正常学习内容，可以正常讲解、比较与评价，不需要回避；请区分史实与观点，不编造史料。',
    '',
    '【公式】数学、物理、化学公式统一用 LaTeX 写在 $...$ 或 $$...$$ 中：分数用 \\frac{分子}{分母}，上下标用 ^ 与 _，根号用 \\sqrt{}，不要用纯文字描述公式。',
    '【化学式】化学式与反应方程式用 mhchem：$\\ce{H2SO4}$、$\\ce{2H2 + O2 -> 2H2O}$，反应条件写成 $\\ce{... ->[高温高压] ...}$。',
    '',
    '【排版要求】用 Markdown 让重点一眼可见：',
    '1. 每个要点用 **加粗** 标出关键词或结论，不要把整句都加粗。',
    '2. 分点用有序列表（1. 2. 3.）或无序列表（- ），每条一行。',
    '3. 需要分组时用三级标题 ### 小标题。',
    '4. 对比、并列关系用 Markdown 表格。',
    '5. 关键术语、公式、代码用 `反引号` 包裹。',
    '6. 不要输出 HTML 标签，不要堆砌「【】」「■■」这类装饰符号。',
    '',
    '【文风】简体中文，先给结论再展开，简洁直接；闲聊就正常聊天，不写「综上所述」「希望对你有帮助」这类套话。',
    '【语言】除模型名、代码、专有名词外一律用简体中文，不要在中文段落里夹整句英文；检索到的英文内容要译成中文再说。'
  ].join('\n');

  let user = '';
  if (mode === 'news') {
    user = [
      '任务：结合' + subjectText + '学科，整理「' + topic + '」内容。',
      '请输出：',
      '1. 热点要点：不超过 5 条，每条不超过 40 字。',
      '2. 学科链接：说明每条与该学科考点或作文角度的关联。',
      '3. 素材建议：给出 1-2 个可化用的表达方向。',
      '不要编造热点，只基于下面提供的材料；材料为空时请说明并改为通用备考建议。',
      '---',
      '【今日热点材料】',
      newsBlock
    ].join('\n');
  } else if (mode === 'custom') {
    user = [
      '问题：' + (query || topic),
      webBlock ? '' : '（这次没有联网检索结果，涉及实时信息时请说明这一点。）',
      webBlock
    ].filter(Boolean).join('\n\n');
  } else {
    user = [
      '任务：讲解' + subjectText + '学科的' + (query ? '「' + query + '」' : topic) + '相关知识点。',
      '请输出：',
      '1. 核心结论：不超过 80 字，直接给出准确定义或结论。',
      '2. 要点拆解：3-5 条，每条不超过 50 字。',
      '3. 易错提醒：1-2 条，指出常见误解或易错点。',
      '知识必须准确、无争议；若存在教材版本差异，请注明「不同教材表述略有差异」。不要编造数据、人名或引语。',
      webBlock
    ].filter(Boolean).join('\n');
  }
  if (mode === 'news' && webBlock) user += '\n\n' + webBlock;
  if (attachText) user += attachText;
  if (images.length) user += '\n\n【图片附件】共 ' + images.length + ' 张，请结合图片内容回答。';

  /* 带上最近几轮问答作为上下文，让追问能接着聊 */
  const historyMsgs = [];
  const hist = Array.isArray(payload && payload.history) ? payload.history : [];
  hist.slice(-6).forEach((m) => {
    if (!m || !m.content) return;
    const role = m.role === 'assistant' ? 'assistant' : 'user';
    historyMsgs.push({ role: role, content: String(m.content).slice(0, 2000) });
  });

  const userContent = images.length
    ? [{ type: 'text', text: user }].concat(images.map((img) => ({
      type: 'image_url',
      image_url: { url: String(img.dataUrl) }
    })))
    : user;

  const gen = await aiChat([
    { role: 'system', content: system },
    ...historyMsgs,
    { role: 'user', content: userContent }
  ], {
    maxTokens: wantThink ? 2400 : 1600,
    timeout: 120000,
    tries: 2,
    signal,
    think: wantThink,
    model: String((payload && payload.model) || ''),
    query: askText,
    vision: images.length > 0
  });

  const content = gen.content;
  /* 不再做二次审核与改写：模型输出原文直接返回，避免改变语气、删减内容或改坏公式 */
  const audit = { ok: true, issues: [], note: '' };
  return {
    ok: true,
    subject,
    topic,
    mode,
    query,
    source,
    content,
    model: gen.model,
    modelName: aiModelMeta(gen.providerId || provider.id, gen.model).name,
    provider: gen.providerId || provider.id,
    providerName: gen.providerName || provider.name,
    switched: !!gen.switched,
    attempted: Array.isArray(gen.attempted) ? gen.attempted : [],
    usage: gen.usage,
    audit,
    reasoning: String(gen.reasoning || '').slice(0, 6000),
    think: wantThink,
    search: {
      ok: !!search.ok,
      query: search.query || '',
      source: search.source || '',
      cached: !!search.cached,
      elapsed: Number(search.elapsed) || 0,
      engines: Array.isArray(search.engines) ? search.engines.slice(0, 6).map((e) => ({ name: String(e.name || '').slice(0, 20), count: Number(e.count) || 0 })) : [],
      read: search.read && typeof search.read === 'object' ? { tried: Number(search.read.tried) || 0, ok: Number(search.read.ok) || 0 } : null,
      items: Array.isArray(search.items) ? search.items.slice(0, 8).map((it) => ({
        title: String(it.title || '').slice(0, 160),
        url: String(it.url || '').slice(0, 400),
        snippet: String(it.snippet || '').slice(0, 200),
        date: String(it.date || '').slice(0, 40),
        src: String(it.src || '').slice(0, 20),
        chars: Number(it.chars) || 0,
        excerpt: String(it.excerpt || '').slice(0, 400)
      })) : []
    }
  };
}

async function aiTestConnection() {
  const provider = aiProviderOf(store);
  const ready = aiConfigReady(store);
  if (!ready.ok) return { ok: false, error: ready.error };
  const keyless = !!provider.noKey || (provider.id === 'custom' && aiIsLocalBase(ready.base || ''));
  if (!keyless && !aiKeyOf(provider.id)) {
    return { ok: false, error: '还没有 API Key，请先添加；也可以切换到无需密钥的 Kilo / Pollinations 免费池' };
  }
  const started = Date.now();
  const res = await aiChat([{ role: 'user', content: '请只回复两个字：正常' }], { maxTokens: 32, timeout: 60000, tries: 2 });
  return {
    ok: true,
    latencyMs: Date.now() - started,
    model: res.model,
    modelName: aiModelMeta(res.providerId || provider.id, res.model).name,
    provider: res.providerId || provider.id,
    providerName: res.providerName || provider.name,
    switched: !!res.switched,
    content: res.content
  };
}

/* 拉取模型列表：Kilo 免费池免密钥，其余供应商需要 Key */
async function aiListModels() {
  const provider = aiProviderOf(store);
  const ready = aiConfigReady(store);
  if (!ready.ok) return { ok: false, error: ready.error };
  const base = (ready.base || provider.baseUrl || '').replace(/\/+$/, '');
  if (!base) return { ok: false, error: '还没有填写接口地址' };
  const key = aiKeyOf(provider.id);
  const keyless = !!provider.noKey || aiIsLocalBase(base);
  if (!keyless && !key) return { ok: false, error: '还没有 API Key' };
  const headers = key ? { Authorization: 'Bearer ' + key } : {};
  /* Pollinations 只暴露根路径 /models，直接用它内置的免费清单，省一次必失败的请求 */
  if (provider.id === 'pollinations' && Array.isArray(provider.models) && provider.models.length) {
    return { ok: true, models: provider.models.map((m) => ({ id: m.id, name: m.name, free: true, ctx: m.ctx || 0 })), keyless };
  }
  const res = await aiFetchJson(base + '/models', { method: 'GET', timeout: 30000, headers, tries: 1 });
  const list = Array.isArray(res && res.data) ? res.data : (Array.isArray(res) ? res : []);
  let models = list
    .map((m) => {
      const id = String((m && (m.id || m.name)) || '').trim();
      if (!id) return null;
      return {
        id,
        name: String((m && (m.display_name || m.name)) || id),
        free: m && (m.isFree === true || m.free === true || /:free$/.test(id) || id === 'kilo-auto/free'),
        vision: /vl|vision|omni|multimodal/i.test(id)
      };
    })
    .filter(Boolean);
  if (provider.id === 'kilo') {
    const freeIds = new Set(KILO_MODELS.map((m) => m.id));
    models = models.filter((m) => m.free || freeIds.has(m.id));
    // 网关没标免费时，也用本地清单兜底
    KILO_MODELS.forEach((m) => {
      if (!models.some((x) => x.id === m.id)) models.push({ id: m.id, name: m.name, free: true, ctx: m.ctx, vision: !!m.vision });
    });
  }
  const seen = new Set();
  models = models.filter((m) => (seen.has(m.id) ? false : (seen.add(m.id), true)));
  if (!models.length) return { ok: false, error: '服务没有返回模型列表' };
  return { ok: true, models, keyless };
}

/* 方案 C 的辅助：用户复制 Key 后自动回填。只做剪贴板轮询，不替代浏览器操作 */
function startAiClipboardWatch() {
  stopAiClipboardWatch();
  aiClipboardLast = '';
  aiClipboardTimer = setInterval(() => {
    try {
      const text = clipboard.readText();
      if (!text) return;
      const value = text.trim();
      if (!value || value === aiClipboardLast) return;
      // 智谱 Key 形如 32位.id 或纯字母数字，这里放宽到 20 位以上、且不含明显非 Key 字符
      if (value.length < 20 || value.length > 200) return;
      if (!/^[A-Za-z0-9_.:\-]+$/.test(value)) return;
      aiClipboardLast = value;
      aiKey = value;
      store.aiKeyEnc = aiEncryptKey(value);
      saveStore();
      stopAiClipboardWatch();
      appendLog('AI_KEY_FILLED', { length: value.length });
    } catch { /* 读取剪贴板异常时忽略，下轮再试 */ }
  }, 1500);
}

function stopAiClipboardWatch() {
  if (aiClipboardTimer) {
    clearInterval(aiClipboardTimer);
    aiClipboardTimer = null;
  }
}

function wireIpc() {
  ipcMain.handle('app:get-init', () => {
    const bdir = backupDirInfo();
    return {
    store: {
      targetDate: store.targetDate,
      skin: store.skin,
      petScale,
      petFreq: store.petFreq,
      uiFontScale: normalizeUiFontScale(store.uiFontScale),
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
      backupDefaultPath: bdir.defaultDir,
      aiEnabled: store.aiEnabled !== false,
      aiProvider: store.aiProvider,
      aiProviderName: aiProviderOf(store).name,
      aiBaseUrl: store.aiBaseUrl,
      aiModel: store.aiModel,
      aiModelUsed: store.aiModelUsed || '',
      aiTopic: store.aiTopic,
      aiHasKey: aiHasKey(aiProviderOf(store).id),
      aiNoKey: !!aiProviderOf(store).noKey,
      aiAutoModel: store.aiAutoModel !== false,
      aiThink: store.aiThink !== false,
      aiWeb: store.aiWeb !== false,
      aiProxy: store.aiProxy || '',
      aiCustomModels: normalizeModelNames(store.aiCustomModels),
      news: newsBrief(),
      aiLoginUrl: aiLoginUrlOf(aiProviderOf(store)),
      aiKeyUrl: aiProviderOf(store).keyUrl || '',
      aiAuthUrl: aiAuthUrlOf(aiProviderOf(store)),
      aiReady: aiConfigReady(store).ok,
      aiReadyError: aiConfigReady(store).ok ? '' : aiConfigReady(store).error,
      aiProviders: AI_PROVIDERS.map((p) => ({
        id: p.id, name: p.name, baseUrl: p.baseUrl, model: p.model,
        hint: p.hint || '', presets: Array.isArray(p.presets) ? p.presets : [],
        noKey: !!p.noKey, hasAuth: !!p.authUrl, keyUrl: p.keyUrl || '',
        models: (Array.isArray(p.models) ? p.models : []).map((m) => ({
          id: m.id, name: m.name || m.id, ctx: m.ctx || 0, free: true, vision: !!m.vision
        }))
      }))
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
    if (patch.uiFontScale != null) {
      store.uiFontScale = normalizeUiFontScale(patch.uiFontScale);
      resizePanelForFont();
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
    if (typeof patch.newsAutoEnabled === 'boolean') store.newsAutoEnabled = patch.newsAutoEnabled;
    if (typeof patch.newsAutoTime === 'string') store.newsAutoTime = normalizeNewsTime(patch.newsAutoTime);
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
      uiFontScale: normalizeUiFontScale(store.uiFontScale),
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

  /* ---------------- AI 文档：Markdown → Word / Excel / 纯文本 ---------------- */
  const AI_SUP_MAP = {
    '0': '⁰', '1': '¹', '2': '²', '3': '³', '4': '⁴', '5': '⁵', '6': '⁶', '7': '⁷', '8': '⁸', '9': '⁹',
    '+': '⁺', '-': '⁻', '=': '⁼', '(': '⁽', ')': '⁾', 'n': 'ⁿ', 'i': 'ⁱ'
  };
  const AI_SUB_MAP = {
    '0': '₀', '1': '₁', '2': '₂', '3': '₃', '4': '₄', '5': '₅', '6': '₆', '7': '₇', '8': '₈', '9': '₉',
    '+': '₊', '-': '₋', '=': '₌', '(': '₍', ')': '₎',
    'a': 'ₐ', 'e': 'ₑ', 'o': 'ₒ', 'x': 'ₓ', 'h': 'ₕ', 'k': 'ₖ', 'l': 'ₗ', 'm': 'ₘ', 'n': 'ₙ', 'p': 'ₚ', 's': 'ₛ', 't': 'ₜ'
  };
  function aiRaise(text, map) {
    return String(text == null ? '' : text).split('').map((c) => map[c] || c).join('');
  }
  /* LaTeX → 可读纯文本：Word / TXT 里不出现原始反斜杠 */
  function aiMathPlain(src) {
    let s = String(src == null ? '' : src);
    s = s.replace(/\\ce\{([^{}]*)\}/g, (_m, body) => String(body)
      .replace(/<=>|<->|\\rightleftharpoons|\\leftrightharpoons/g, '⇌')
      .replace(/->/g, '→')
      .replace(/<-(?!>)/g, '←')
      .replace(/\^(\d*[+-])/g, (_x, c) => aiRaise(c, AI_SUP_MAP))
      .replace(/\s*\^\s*/g, '↑')
      .replace(/([A-Za-z)\]])(\d+)/g, (_x, a, d) => a + aiRaise(d, AI_SUB_MAP)));
    s = s.replace(/\\frac\{([^{}]+)\}\{([^{}]+)\}/g, '($1)/($2)');
    s = s.replace(/\\sqrt\[([^\]]+)\]\{([^{}]+)\}/g, '$1√($2)');
    s = s.replace(/\\sqrt\{([^{}]+)\}/g, '√($1)');
    const cmds = {
      '\\leftrightharpoons': '⇌', '\\rightleftharpoons': '⇌', '\\xrightarrow': '→', '\\xleftarrow': '←',
      '\\times': '×', '\\div': '÷', '\\pm': '±', '\\mp': '∓',
      '\\leq': '≤', '\\le': '≤', '\\geq': '≥', '\\ge': '≥', '\\neq': '≠', '\\ne': '≠',
      '\\approx': '≈', '\\equiv': '≡', '\\infty': '∞', '\\cdot': '·',
      '\\rightarrow': '→', '\\to': '→', '\\Rightarrow': '⇒', '\\leftarrow': '←',
      '\\Delta': 'Δ', '\\Omega': 'Ω', '\\alpha': 'α', '\\beta': 'β', '\\gamma': 'γ',
      '\\delta': 'δ', '\\theta': 'θ', '\\lambda': 'λ', '\\mu': 'μ', '\\sigma': 'σ',
      '\\omega': 'ω', '\\pi': 'π', '\\rho': 'ρ', '\\eta': 'η', '\\nu': 'ν',
      '\\phi': 'φ', '\\varphi': 'φ', '\\tau': 'τ', '\\epsilon': 'ε', '\\varepsilon': 'ε',
      '\\kappa': 'κ', '\\psi': 'ψ', '\\chi': 'χ', '\\zeta': 'ζ', '\\xi': 'ξ',
      '\\sum': '∑', '\\int': '∫', '\\partial': '∂', '\\nabla': '∇', '\\circ': '°',
      '\\sin': 'sin', '\\cos': 'cos', '\\tan': 'tan', '\\log': 'log', '\\ln': 'ln',
      '\\lim': 'lim', '\\max': 'max', '\\min': 'min',
      '\\left': '', '\\right': '', '\\text': '', '\\mathrm': '', '\\mathbf': '',
      '\\,': ' ', '\\;': ' ', '\\!': '', '\\quad': ' ', '\\qquad': '  '
    };
    Object.keys(cmds).forEach((k) => { s = s.split(k).join(cmds[k]); });
    s = s.replace(/\^\{([^{}]+)\}/g, (_m, x) => aiRaise(x, AI_SUP_MAP));
    s = s.replace(/\^([A-Za-z0-9+\-])/g, (_m, x) => aiRaise(x, AI_SUP_MAP));
    s = s.replace(/_\{([^{}]+)\}/g, (_m, x) => aiRaise(x, AI_SUB_MAP));
    s = s.replace(/_([A-Za-z0-9+\-])/g, (_m, x) => aiRaise(x, AI_SUB_MAP));
    s = s.replace(/\\[a-zA-Z]+/g, '');
    s = s.replace(/[{}]/g, '');
    return s.replace(/\s+/g, ' ').trim();
  }
  function aiStripInline(s) {
    let t = String(s == null ? '' : s);
    t = t.replace(/!\[[^\]]*\]\([^)]*\)/g, '');
    t = t.replace(/\[([^\]]+)\]\([^)]*\)/g, '$1');
    t = t.replace(/\x60([^\x60]+)\x60/g, '$1');
    t = t.replace(/\$([^$\n]+?)\$/g, (_m, x) => aiMathPlain(x));
    t = t.replace(/\*\*([^*]+)\*\*/g, '$1');
    t = t.replace(/(^|[^*])\*([^*\n]+)\*/g, '$1$2');
    t = t.replace(/==([^=]+)==/g, '$1');
    return t.trim();
  }
  function markdownToPlain(md) {
    let text = String(md == null ? '' : md).replace(/\r\n?/g, '\n');
    text = text.replace(/\x60\x60\x60[\w+#.-]*[ \t]*\n?([\s\S]*?)(?:\x60\x60\x60|$)/g,
      (_m, code) => '\n' + String(code).replace(/\n+$/, '') + '\n');
    const out = [];
    text.split('\n').forEach((line) => {
      const t = line.trim();
      if (!t) { out.push(''); return; }
      if (/^\|?[\s:-]+\|[\s:|-]*$/.test(t)) return;
      if (/^[-—_]{3,}$/.test(t)) return;
      if (/^\|.*\|$/.test(t)) {
        out.push(t.replace(/^\||\|$/g, '').split('|').map((x) => aiStripInline(x)).join(' | '));
        return;
      }
      out.push(aiStripInline(t.replace(/^#{1,4}\s+/, '').replace(/^>\s?/, '').replace(/^[-*+•]\s+/, '· ')));
    });
    return out.join('\n').replace(/\n{3,}/g, '\n\n').trim();
  }
  function markdownToRows(md) {
    const rows = [];
    const lines = String(md == null ? '' : md).replace(/\r\n?/g, '\n').split('\n');
    let code = null;
    for (let i = 0; i < lines.length; i++) {
      const raw = lines[i];
      const t = raw.trim();
      if (t.startsWith('\x60\x60\x60')) {
        if (code) { code.forEach((c) => rows.push([c])); code = null; } else { code = []; }
        continue;
      }
      if (code) { code.push(raw); continue; }
      if (!t) { if (rows.length && rows[rows.length - 1].length) rows.push([]); continue; }
      if (/^\|?[\s:-]+\|[\s:|-]*$/.test(t)) continue;
      if (/^[-—_]{3,}$/.test(t)) { rows.push([]); continue; }
      const h = t.match(/^(#{1,4})\s+(.*)$/);
      if (h) { rows.push([aiStripInline(h[2])]); continue; }
      if (/^\|.*\|$/.test(t)) {
        rows.push(t.replace(/^\||\|$/g, '').split('|').map((x) => aiStripInline(x)));
        continue;
      }
      const ul = t.match(/^[-*+•]\s+(.*)$/);
      if (ul) { rows.push(['• ' + aiStripInline(ul[1])]); continue; }
      rows.push([aiStripInline(t.replace(/^>\s?/, ''))]);
    }
    if (code) code.forEach((c) => rows.push([c]));
    return rows;
  }
  function aiDocStamp() {
    const d = new Date();
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日 ${p(d.getHours())}:${p(d.getMinutes())}`;
  }
  /* 行内 Markdown → Word 文本段（粗体 / 代码 / 公式，粗体内部还会再解析公式） */
  function docxInlineRuns(text, bold, depth) {
    const src = String(text == null ? '' : text);
    const runs = [];
    const re = /(\*\*([^*]+)\*\*|\x60([^\x60]+)\x60|\$([^$\n]+)\$)/g;
    const base = bold ? { bold: true } : {};
    const push = (t, extra) => {
      if (t) runs.push(new DOCX.TextRun(Object.assign({ text: t, size: 22 }, base, extra || {})));
    };
    let last = 0;
    let m;
    while ((m = re.exec(src))) {
      push(src.slice(last, m.index));
      if (m[2] !== undefined) {
        if ((depth || 0) < 2) docxInlineRuns(m[2], true, (depth || 0) + 1).forEach((r) => runs.push(r));
        else push(m[2]);
      } else if (m[3] !== undefined) {
        runs.push(new DOCX.TextRun({ text: m[3], font: 'Consolas', size: 20, bold: !!bold }));
      } else if (m[4] !== undefined) {
        runs.push(new DOCX.TextRun({ text: aiMathPlain(m[4]), size: 22, italics: true, bold: !!bold }));
      }
      last = m.index + m[0].length;
    }
    push(src.slice(last));
    return runs.length ? runs : [new DOCX.TextRun({ text: ' ', size: 22, bold: !!bold })];
  }
  function buildDocxChildren(markdown) {
    const { Paragraph, Table, TableRow, TableCell, WidthType, HeadingLevel } = DOCX;
    const heads = [HeadingLevel.HEADING_1, HeadingLevel.HEADING_2, HeadingLevel.HEADING_3, HeadingLevel.HEADING_4];
    const children = [];
    const lines = String(markdown == null ? '' : markdown).replace(/\r\n?/g, '\n').split('\n');
    const splitRow = (t) => t.replace(/^\||\|$/g, '').split('|').map((x) => x.trim());
    let i = 0;
    while (i < lines.length) {
      const t = lines[i].trim();
      if (!t) { i++; continue; }
      if (t.startsWith('\x60\x60\x60')) {
        i++;
        const code = [];
        while (i < lines.length && !lines[i].trim().startsWith('\x60\x60\x60')) { code.push(lines[i]); i++; }
        i++;
        code.forEach((c, idx) => children.push(new Paragraph({
          spacing: { after: idx === code.length - 1 ? 160 : 0 },
          children: [new DOCX.TextRun({ text: c || ' ', font: 'Consolas', size: 19 })]
        })));
        continue;
      }
      if (/^\|.*\|$/.test(t) && i + 1 < lines.length && /^\|?[\s:-]+\|[\s:|-]*$/.test(lines[i + 1].trim())) {
        const header = splitRow(t);
        i += 2;
        const body = [];
        while (i < lines.length && /^\|.*\|$/.test(lines[i].trim())) { body.push(splitRow(lines[i].trim())); i++; }
        const rows = [header].concat(body).map((cells, ri) => new TableRow({
          tableHeader: ri === 0,
          children: cells.map((c) => new TableCell({ children: [new Paragraph({ children: docxInlineRuns(c) })] }))
        }));
        children.push(new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows }));
        children.push(new Paragraph({ text: '', spacing: { after: 120 } }));
        continue;
      }
      const h = t.match(/^(#{1,4})\s+(.*)$/);
      if (h) {
        children.push(new Paragraph({ heading: heads[Math.min(3, h[1].length - 1)], children: docxInlineRuns(h[2]) }));
        i++;
        continue;
      }
      if (/^(-{3,}|\*{3,}|_{3,})$/.test(t)) { children.push(new Paragraph({ text: '' })); i++; continue; }
      const ul = t.match(/^[-*+•]\s+(.*)$/);
      if (ul) { children.push(new Paragraph({ bullet: { level: 0 }, children: docxInlineRuns(ul[1]) })); i++; continue; }
      if (/^\d+[.)、]\s+/.test(t)) { children.push(new Paragraph({ bullet: { level: 0 }, children: docxInlineRuns(t) })); i++; continue; }
      if (/^>\s?/.test(t)) {
        children.push(new Paragraph({ indent: { left: 360 }, children: docxInlineRuns(t.replace(/^>\s?/, '')) }));
        i++;
        continue;
      }
      children.push(new Paragraph({ spacing: { after: 100 }, children: docxInlineRuns(t) }));
      i++;
    }
    return children;
  }
  async function writeAiDocx(filePath, markdown, title) {
    const { Document, Packer, Paragraph, TextRun } = DOCX;
    const children = [
      new Paragraph({ heading: DOCX.HeadingLevel.TITLE, children: [new TextRun({ text: title, bold: true, size: 40 })] }),
      new Paragraph({ spacing: { after: 200 }, children: [new TextRun({ text: '高考倒计时 AI 助手 · ' + aiDocStamp(), size: 18, color: '888888' })] })
    ].concat(buildDocxChildren(markdown));
    const doc = new Document({
      styles: { default: { document: { run: { font: 'Microsoft YaHei', size: 22 } } } },
      sections: [{
        properties: { page: { margin: { top: 900, bottom: 900, left: 1000, right: 1000 } } },
        children
      }]
    });
    fs.writeFileSync(filePath, await Packer.toBuffer(doc));
  }
  function writeAiXlsx(filePath, markdown, title) {
    const rows = [[title], ['高考倒计时 AI 助手 · ' + aiDocStamp()], []].concat(markdownToRows(markdown));
    const ws = XLSX.utils.aoa_to_sheet(rows);
    const width = rows.reduce((n, r) => Math.max(n, r.length), 1);
    ws['!cols'] = Array.from({ length: width }, (_v, i) => ({ wch: i === 0 ? 46 : 30 }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'AI 回答');
    XLSX.writeFile(wb, filePath);
  }
  /* 读取 AI 附件：docx / xlsx / 文本，统一返回纯文本 */
  async function readAiDocFile(filePath, ext) {
    const stat = fs.statSync(filePath);
    if (stat.size > 20 * 1024 * 1024) throw new Error('文件超过 20 MB，请精简后再试');
    if (ext === 'docx') {
      if (!MAMMOTH) throw new Error('Word 解析组件不可用');
      const res = await MAMMOTH.extractRawText({ path: filePath });
      return String((res && res.value) || '').replace(/\n{3,}/g, '\n\n').trim().slice(0, 60000);
    }
    if (ext === 'xlsx' || ext === 'xls') {
      if (!XLSX) throw new Error('表格组件不可用');
      const wb = XLSX.readFile(filePath);
      const parts = [];
      wb.SheetNames.slice(0, 6).forEach((name) => {
        const csv = XLSX.utils.sheet_to_csv(wb.Sheets[name], { blankrows: false });
        parts.push('【工作表：' + name + '】\n' + csv);
      });
      return parts.join('\n\n').slice(0, 60000);
    }
    if (ext === 'doc') throw new Error('暂不支持旧版 .doc，请另存为 .docx 后再试');
    return fs.readFileSync(filePath, 'utf8').slice(0, 60000);
  }

  /* AI 回答导出为文档：Markdown / HTML / Word / Excel / 纯文本，内容由渲染层传入 */
  ipcMain.handle('ai:export-doc', async (_e, payload) => {
    try {
      const data = payload && typeof payload === 'object' ? payload : {};
      const rawTitle = String(data.title || 'AI 回答').replace(/[\\/:*?"<>|\r\n]/g, '_').slice(0, 40) || 'AI 回答';
      const markdown = String(data.markdown || '').slice(0, 400000);
      const html = String(data.html || '').slice(0, 800000);
      /* 正文只含回答本身：Word / Excel / TXT 不再重复渲染标题与时间行 */
      const body = String(data.body || markdown).slice(0, 400000);
      if (!markdown && !html && !body) return { ok: false, error: '没有可导出的内容' };
      const labels = { md: 'Markdown', docx: 'Word 文档', xlsx: 'Excel 表格', txt: '纯文本', html: '网页文档' };
      const want = String(data.format || 'md').toLowerCase();
      const format = Object.prototype.hasOwnProperty.call(labels, want) ? want : 'md';
      const stamp = (() => {
        const d = new Date();
        const p = (n) => String(n).padStart(2, '0');
        return d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + '-' + p(d.getHours()) + p(d.getMinutes());
      })();
      const filters = [{ name: labels[format], extensions: [format] }];
      Object.keys(labels).forEach((k) => { if (k !== format) filters.push({ name: labels[k], extensions: [k] }); });
      const { canceled, filePath } = await dialog.showSaveDialog(win, {
        title: '导出为文档',
        defaultPath: path.join(app.getPath('downloads'), rawTitle + '-' + stamp + '.' + format),
        filters
      });
      if (canceled || !filePath) return { ok: false, canceled: true };
      let target = filePath;
      let ext = (path.extname(target) || '').slice(1).toLowerCase();
      if (!ext) { target += '.' + format; ext = format; }
      const fmt = Object.prototype.hasOwnProperty.call(labels, ext) ? ext : format;
      if (fmt === 'html') fs.writeFileSync(target, html, 'utf8');
      else if (fmt === 'md') fs.writeFileSync(target, markdown, 'utf8');
      else if (fmt === 'txt') {
        const plain = body ? markdownToPlain(body) : String(html).replace(/<[^>]+>/g, '');
        fs.writeFileSync(target, plain, 'utf8');
      } else if (fmt === 'xlsx') {
        if (!XLSX) return { ok: false, error: '表格组件不可用，请重装完整版本' };
        writeAiXlsx(target, body, rawTitle);
      } else {
        if (!DOCX) return { ok: false, error: 'Word 组件不可用，请重装完整版本' };
        await writeAiDocx(target, body, rawTitle);
      }
      appendLog('AI_EXPORT', { file: path.basename(target), format: fmt });
      return { ok: true, filePath: target, format: fmt };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });

  /* AI 附件读取：docx / xlsx / 文本，主进程读出纯文本回传渲染层 */
  ipcMain.handle('ai:read-doc', async (_e, payload) => {
    try {
      const p = payload && typeof payload === 'object' ? payload : {};
      const filePath = String(p.path || '');
      if (!filePath) return { ok: false, error: '没有拿到文件路径' };
      if (!fs.existsSync(filePath)) return { ok: false, error: '文件不存在或已被移动' };
      const ext = (path.extname(filePath) || '').slice(1).toLowerCase();
      const text = await readAiDocFile(filePath, ext);
      if (!text) return { ok: false, error: '文件里没有可读取的文字' };
      appendLog('AI_READ_DOC', { ext, chars: text.length });
      return { ok: true, text };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });

  /* 课程表 AI 识图：把课表图片交给视觉模型，返回可直接导入的 CSV 文本 */
  ipcMain.handle('timetable:ai-import', async (_e, payload) => {
    try {
      const p = payload && typeof payload === 'object' ? payload : {};
      const image = String(p.image || '');
      if (!/^data:image\/(png|jpe?g|webp|bmp);base64,/i.test(image)) {
        return { ok: false, error: '请先选择课程表图片' };
      }
      if (image.length > 12 * 1024 * 1024) return { ok: false, error: '图片太大，请压缩到 6 MB 以内' };
      const specs = {
        weekday: {
          label: '工作日课程表（周一至周五）',
          columns: '节次,时间,周一,周二,周三,周四,周五',
          example: '节次,时间,周一,周二,周三,周四,周五\n第1节,08:00-08:45,语文,数学,英语,物理,化学\n第2节,08:55-09:40,数学,语文,物理,英语,生物',
          rules: '一行一节；某天没有课就留空；晚自习节次写「晚自习1」。'
        },
        'weekend-fixed': {
          label: '课程固定的周末作息',
          columns: '节次,周六时间,周日时间,周六课程,周日课程',
          example: '节次,周六时间,周日时间,周六课程,周日课程\n第1节,08:20-09:00,08:20-09:00,语文,数学\n第5节,14:10-14:50,14:10-14:50,物理,放假',
          rules: '周六、周日时间分列；没有课留空；放假写「放假」。'
        },
        'weekend-variable': {
          label: '按日期登记的周末课程',
          columns: '日期,节次,时间,课程',
          example: '日期,节次,时间,课程\n2026-11-14,第1节,08:20-09:00,物理\n2026-11-14,第2节,09:10-09:50,物理',
          rules: '日期写 YYYY-MM-DD；每个日期从第 1 节开始列；看不清的日期不要编造。'
        }
      };
      const target = Object.prototype.hasOwnProperty.call(specs, p.target) ? p.target : 'weekday';
      const spec = specs[target];
      const note = String(p.note || '').replace(/\s+/g, ' ').trim().slice(0, 200);
      const system = [
        '你是课程表识别助手。把图片里的课程表转成 CSV，只输出 CSV 本身。',
        '不要解释，不要 Markdown 代码块，不要表头以外的多余文字。',
        '看不清的格子留空，不要猜测；课程名保持图片原文；时间统一成 24 小时制 HH:MM-HH:MM。'
      ].join('\n');
      const userText = [
        '导入目标：' + spec.label,
        '列名必须是：' + spec.columns,
        '示例：',
        spec.example,
        '规则：' + spec.rules,
        note ? '用户补充要求：' + note : ''
      ].filter(Boolean).join('\n');
      const gen = await aiChat([
        { role: 'system', content: system },
        {
          role: 'user',
          content: [
            { type: 'text', text: userText },
            { type: 'image_url', image_url: { url: image } }
          ]
        }
      ], {
        model: String(p.model || ''),
        query: '课程表图片识别',
        vision: true,
        think: false,
        maxTokens: 2600,
        timeout: 120000,
        tries: 2
      });
      appendLog('TIMETABLE_AI_IMPORT', { target, model: gen.model, chars: String(gen.content || '').length });
      const meta = KILO_MODELS.find((m) => m.id === gen.model);
      return { ok: true, text: gen.content, model: gen.model, modelName: meta ? meta.name : gen.model, target };
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

  /* ---------------- AI 大模型 IPC ---------------- */
  ipcMain.handle('ai:config', () => {
    const provider = aiProviderOf(store);
    const ready = aiConfigReady(store);
    const hasKey = aiHasKey(provider.id);
    const base = store.aiBaseUrl || provider.baseUrl || '';
    return {
      ok: true,
      enabled: store.aiEnabled !== false,
      provider: provider.id,
      providerName: provider.name,
      baseUrl: base,
      model: store.aiModel || provider.model,
      modelUsed: store.aiModelUsed || '',
      topic: store.aiTopic,
      hasKey,
      noKey: !!provider.noKey || aiIsLocalBase(base),
      autoModel: store.aiAutoModel !== false,
      think: store.aiThink !== false,
      web: store.aiWeb !== false,
      proxy: store.aiProxy || '',
      customModels: normalizeModelNames(store.aiCustomModels),
      models: (Array.isArray(provider.models) ? provider.models : []).map((m) => ({
        id: m.id, name: m.name || m.id, ctx: m.ctx || 0, free: true
      })),
      loginUrl: aiLoginUrlOf(provider),
      keyUrl: provider.keyUrl || '',
      authUrl: aiAuthUrlOf(provider),
      ready: ready.ok,
      readyError: ready.ok ? '' : ready.error,
      providers: AI_PROVIDERS.map((p) => ({
        id: p.id, name: p.name, baseUrl: p.baseUrl, model: p.model,
        hint: p.hint || '', presets: Array.isArray(p.presets) ? p.presets : [],
        noKey: !!p.noKey, hasAuth: !!p.authUrl, keyUrl: p.keyUrl || '',
        models: (Array.isArray(p.models) ? p.models : []).map((m) => ({
          id: m.id, name: m.name || m.id, ctx: m.ctx || 0, free: true, vision: !!m.vision
        }))
      }))
    };
  });

  /* 保存非密钥配置；密钥单独走 ai:save-key，避免明文进 IPC 日志 */
  ipcMain.handle('ai:save-config', (_e, payload) => {
    const p = payload && typeof payload === 'object' ? payload : {};
    const prevProvider = store.aiProvider;
    const warnings = [];
    if (typeof p.enabled === 'boolean') store.aiEnabled = p.enabled;
    if (typeof p.autoModel === 'boolean') store.aiAutoModel = p.autoModel;
    if (typeof p.think === 'boolean') store.aiThink = p.think;
    if (typeof p.web === 'boolean') store.aiWeb = p.web;
    if (typeof p.provider === 'string' && AI_PROVIDERS.some((x) => x.id === p.provider)) {
      if (p.provider !== prevProvider) {
        // 切换前把旧供应商的地址与模型存进它自己的格子，切回来能原样还原
        aiRememberPref(prevProvider, store.aiBaseUrl, store.aiModel);
        store.aiProvider = p.provider;
        const target = AI_PROVIDERS.find((x) => x.id === p.provider) || AI_PROVIDERS[0];
        const saved = aiPrefsBucket()[p.provider] || {};
        // 用户没显式给地址/模型时：优先用该供应商上次的值，其次用内置默认值
        if (typeof p.baseUrl !== 'string') store.aiBaseUrl = saved.baseUrl || target.baseUrl || '';
        if (typeof p.model !== 'string') store.aiModel = saved.model || target.model || '';
        delete store.aiModelUsed;
      } else {
        store.aiProvider = p.provider;
      }
    }
    if (typeof p.baseUrl === 'string') {
      const rawBase = p.baseUrl.trim();
      if (!rawBase) {
        // 空串视为「不改」，避免一次误清空让用户以为配置没保存
        if (!store.aiBaseUrl) warnings.push('接口地址为空，请填写完整地址');
      } else {
        const normalized = normalizeAiBase(rawBase);
        if (!normalized) {
          // 非法地址不再静默清空：原值保留并把原因回给界面
          return {
            ok: false,
            error: '接口地址要以 http:// 或 https:// 开头，例如 https://api.example.com/v1/',
            baseUrl: store.aiBaseUrl || ''
          };
        }
        store.aiBaseUrl = normalized;
      }
    }
    if (typeof p.model === 'string') {
      const model = p.model.trim().slice(0, 80);
      if (model) store.aiModel = model;
    }
    if (typeof p.proxy === 'string') {
      const rawProxy = p.proxy.trim();
      if (!rawProxy) store.aiProxy = '';
      else {
        const normProxy = normalizeAiProxy(rawProxy);
        if (!normProxy) {
          return { ok: false, error: '代理地址要写成 127.0.0.1:1081 或 http://127.0.0.1:1081 这种形式', proxy: store.aiProxy || '' };
        }
        if (normProxy !== store.aiProxy) aiProxyApplied = null;
        store.aiProxy = normProxy;
      }
    }
    if (typeof p.topic === 'string' && p.topic.trim()) store.aiTopic = p.topic.trim().slice(0, 40);
    // 自定义模型清单：rememberModel 追加，forgetModel 删除
    if (typeof p.rememberModel === 'string' && p.rememberModel.trim()) {
      store.aiCustomModels = normalizeModelNames([p.rememberModel.trim()].concat(store.aiCustomModels || []));
    }
    if (typeof p.forgetModel === 'string' && p.forgetModel.trim()) {
      const drop = p.forgetModel.trim();
      store.aiCustomModels = normalizeModelNames((store.aiCustomModels || []).filter((m) => m !== drop));
      if (store.aiModel === drop) store.aiModel = '';
    }
    // 当前供应商的地址与模型也写进它自己的格子，下次切换不会丢
    aiRememberPref(store.aiProvider, store.aiBaseUrl, store.aiModel);
    saveStore();
    appendLog('AI_CONFIG_SAVE', { enabled: store.aiEnabled, provider: store.aiProvider, model: store.aiModel, autoModel: store.aiAutoModel });
    return {
      ok: true,
      enabled: store.aiEnabled,
      model: store.aiModel,
      provider: store.aiProvider,
      baseUrl: store.aiBaseUrl,
      topic: store.aiTopic,
      autoModel: store.aiAutoModel !== false,
      think: store.aiThink !== false,
      web: store.aiWeb !== false,
      proxy: store.aiProxy || '',
      customModels: normalizeModelNames(store.aiCustomModels),
      warnings
    };
  });

  /* 打开登录页（带 redirect 回跳 Key 管理页），并开始剪贴板轮询等待复制 */
  ipcMain.handle('ai:open-auth', async () => {
    const provider = aiProviderOf(store);
    const url = aiLoginUrlOf(provider) || provider.keyUrl;
    if (!url) {
      return { ok: false, error: '当前供应商没有内置登录页，请直接在对话框里粘贴 API Key' };
    }
    try {
      await shell.openExternal(url);
      startAiClipboardWatch();
      appendLog('AI_AUTH_OPEN', { url, provider: provider.id });
      return { ok: true, url, keyUrl: provider.keyUrl, redirect: AI_AUTH_REDIRECT };
    } catch (e) {
      return { ok: false, error: e.message, url, keyUrl: provider.keyUrl };
    }
  });

  /* 拉取可用模型列表：走 OpenAI 兼容的 GET /models */
  ipcMain.handle('ai:list-models', async () => {
    const provider = aiProviderOf(store);
    try {
      const out = await aiListModels();
      if (!out.ok) return out;
      appendLog('AI_MODELS_OK', { provider: provider.id, count: out.models.length, keyless: !!out.keyless });
      return out;
    } catch (e) {
      appendLog('AI_MODELS_FAIL', { provider: provider.id, message: e.message });
      return { ok: false, error: friendlyNetError(e) };
    }
  });

  ipcMain.handle('ai:stop-clipboard', () => {
    stopAiClipboardWatch();
    return { ok: true };
  });

  /* 用户手动粘贴 Key 时保存：只存加密串 */
  ipcMain.handle('ai:save-key', (_e, key, providerId) => {
    const provider = aiProviderOf(store);
    const pid = typeof providerId === 'string' && AI_PROVIDERS.some((p) => p.id === providerId) ? providerId : provider.id;
    const value = String(key || '').replace(/\s+/g, '');
    if (!value) {
      // 免密钥供应商允许留空，其它供应商留空等于清空
      aiForgetKey(pid);
      saveStore();
      appendLog('AI_KEY_EMPTY', { provider: pid });
      return { ok: true, hasKey: false };
    }
    if (value.length < 8) {
      return { ok: false, error: 'API Key 太短，请确认复制完整' };
    }
    if (/[^A-Za-z0-9_.:\-]/.test(value)) {
      return { ok: false, error: 'API Key 里有异常字符，请重新复制' };
    }
    aiRememberKey(pid, value);
    if (pid === store.aiProvider) aiKey = value;
    saveStore();
    stopAiClipboardWatch();
    appendLog('AI_KEY_SAVE', { provider: pid, length: value.length });
    return { ok: true, hasKey: true };
  });

  ipcMain.handle('ai:clear-key', (_e, providerId) => {
    const provider = aiProviderOf(store);
    const pid = typeof providerId === 'string' && AI_PROVIDERS.some((p) => p.id === providerId) ? providerId : provider.id;
    aiForgetKey(pid);
    if (pid === store.aiProvider) aiKey = '';
    stopAiClipboardWatch();
    saveStore();
    appendLog('AI_KEY_CLEAR', { provider: pid });
    return { ok: true, hasKey: false };
  });

  /* 连通性测试：真实发一次最小请求 */
  ipcMain.handle('ai:test', async () => {
    try {
      const out = await aiTestConnection();
      appendLog('AI_TEST', { ok: !!out.ok, model: out.model, provider: out.provider, error: out.error || '' });
      return out;
    } catch (e) {
      appendLog('AI_TEST_FAIL', { message: e.message });
      return { ok: false, error: e.message };
    }
  });

  /* 只取今日联网热点，不调用模型 */
  ipcMain.handle('ai:hot', async (_e, refresh) => {
    try {
      return { ok: true, ...(await aiHotNews(!!refresh)) };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });

  /* 每日热点卡片：读取缓存 / 手动刷新 / 改时间与开关 */
  ipcMain.handle('news:brief', () => ({ ok: true, ...newsBrief() }));
  ipcMain.handle('news:refresh', async () => {
    try {
      const data = await newsRefresh(true);
      return { ok: true, ...data, error: data.items.length ? '' : (data.error || '暂未获取到今日热点') };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });
  ipcMain.handle('news:config', (_e, patch) => {
    const p = patch && typeof patch === 'object' ? patch : {};
    if (typeof p.enabled === 'boolean') store.newsAutoEnabled = p.enabled;
    if (typeof p.time === 'string') store.newsAutoTime = normalizeNewsTime(p.time);
    saveStore();
    appendLog('NEWS_CONFIG', { enabled: store.newsAutoEnabled !== false, time: store.newsAutoTime });
    return { ok: true, enabled: store.newsAutoEnabled !== false, time: store.newsAutoTime };
  });

  /* AI 对话框主入口：知识点 / 每日热点 / 自定义提问，均带审核自查 */
  ipcMain.handle('ai:ask', async (_e, payload) => {
    try {
      if (!store.aiEnabled) {
        return { ok: false, error: 'AI 功能还没开启，请先在设置里打开' };
      }
      return await aiRunAsk(payload || {});
    } catch (e) {
      const cancelled = /已停止生成/.test(e.message || '');
      if (!cancelled) appendLog('AI_ASK_FAIL', { message: e.message });
      return { ok: false, error: e.message, cancelled, attempted: e.attempted || [] };
    } finally {
      aiAbortCtl = null;
    }
  });

  /* 停止生成：中断当前请求 */
  ipcMain.handle('ai:cancel', () => {
    if (aiAbortCtl) {
      try { aiAbortCtl.abort(); } catch { /* 忽略重复中断 */ }
      aiAbortCtl = null;
      appendLog('AI_CANCEL', {});
      return { ok: true };
    }
    return { ok: true, idle: true };
  });

  ipcMain.on('window:hide', () => {
    if (win && !win.isDestroyed()) win.hide();
    appendLog('WINDOW_HIDE', { source: 'renderer' });
  });
  ipcMain.on('app:quit', quitApp);

  /* ---------------- 课堂助手 IPC ---------------- */
  const adminGuard = () => ((classroomUnlocked || adminTicketFresh()) ? null : { ok: false, error: '请先进入管理员模式' });

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
      ['builtin-1.mp4', 'builtin-2.mp4', 'builtin-3.mp4'].forEach((name) => {
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

  ipcMain.handle('classroom:admin-status', () => {
    const ticket = adminTicketFresh();
    if (ticket) { classroomUnlocked = true; adminTicketSession = true; }
    return {
      hasPassword: adminHasPassword() || ticket,
      unlocked: classroomUnlocked || ticket,
      bypass: ticket,
      remain: ticket ? adminTicketRemain() : 0
    };
  });

  ipcMain.handle('classroom:admin-data', () => {
    const guard = adminGuard();
    if (guard) return guard;
    return { ok: true, data: classroomAdminData() };
  });

  ipcMain.handle('classroom:vip-redeem', (_e, code) => {
    const guard = adminGuard();
    if (guard) return guard;
    if (vipActive()) return { ok: true, data: classroomAdminData(), quota: adminQuotaInfo() };
    if (!vipMatchCode(code)) {
      appendLog('VIP_REDEEM_FAIL', {});
      return { ok: false, error: '兑换码不正确', quota: adminQuotaInfo() };
    }
    vipSave();
    appendLog('VIP_REDEEM', {});
    return { ok: true, data: classroomAdminData(), quota: adminQuotaInfo() };
  });

  ipcMain.handle('classroom:admin-setup', (_e, password) => {
    if (adminTicketFresh()) {
      classroomUnlocked = true;
      adminTicketSession = true;
      return { ok: true, data: classroomAdminData(), bypass: true };
    }
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
    if (adminTicketFresh()) {
      classroomUnlocked = true;
      adminTicketSession = true;
      appendLog('ADMIN_LOGIN', { bypass: 'ticket' });
      return { ok: true, data: classroomAdminData() };
    }
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
    adminTicketSession = false;
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

  ipcMain.handle('classroom:create-roster', (_e, name, text) => {
    const rosterName = String(name || '').trim().slice(0, 40);
    if (!rosterName) return { ok: false, error: '请输入名单名称' };
    if (store.classroom.rosters.some((r) => r.name === rosterName)) {
      return { ok: false, error: '已有同名名单，请换一个名称' };
    }
    const names = parseNameText(text);
    const roster = {
      id: uid('r'),
      name: rosterName,
      createdAt: Date.now(),
      names: names.map((n) => ({ id: uid('n'), name: n, weight: 1, count: 0, pickedAt: 0 })),
      lastPickId: ''
    };
    store.classroom.rosters.push(roster);
    store.classroom.activeRosterId = roster.id;
    saveStore();
    appendLog('ROSTER_CREATE', { id: roster.id, name: rosterName, count: roster.names.length });
    return { ok: true, rosterId: roster.id, count: roster.names.length, data: classroomPublicData() };
  });

  /* 删除名单（不必进管理员）：先进「最近删除」，可恢复，3 天后自动清除 */
  ipcMain.handle('classroom:delete-rosters', (_e, ids) => {
    const list = Array.isArray(ids) ? ids.filter((id) => typeof id === 'string' && id) : [];
    if (!list.length) return { ok: false, error: '请先选择要删除的名单' };
    const c = store.classroom;
    const removed = [];
    c.rosters = c.rosters.filter((r) => {
      if (!list.includes(r.id)) return true;
      removed.push(r);
      return false;
    });
    if (!removed.length) return { ok: false, error: '名单不存在' };
    if (!Array.isArray(c.trash)) c.trash = [];
    const now = Date.now();
    removed.forEach((roster) => {
      c.trash = c.trash.filter((t) => !t || !t.roster || t.roster.id !== roster.id);
      c.trash.unshift({ roster, deletedAt: now });
    });
    pruneRosterTrash();
    if (!c.rosters.some((r) => r.id === c.activeRosterId)) {
      c.activeRosterId = c.rosters.length ? c.rosters[0].id : '';
    }
    saveStore();
    appendLog('ROSTER_TRASH', { names: removed.map((r) => r.name), count: removed.length });
    return { ok: true, deleted: removed.length, data: classroomPublicData() };
  });

  ipcMain.handle('classroom:restore-rosters', (_e, ids) => {
    const list = Array.isArray(ids) ? ids.filter((id) => typeof id === 'string' && id) : [];
    if (!list.length) return { ok: false, error: '请先选择要恢复的名单' };
    const c = store.classroom;
    if (!Array.isArray(c.trash)) c.trash = [];
    const restored = [];
    c.trash = c.trash.filter((t) => {
      if (!t || !t.roster || !list.includes(t.roster.id)) return true;
      const roster = t.roster;
      const taken = new Set(c.rosters.map((r) => r.name));
      let name = roster.name;
      if (taken.has(name)) {
        for (let i = 1; i < 100; i++) {
          const candidate = `${roster.name}（恢复${i > 1 ? i : ''}）`.slice(0, 40);
          if (!taken.has(candidate)) { name = candidate; break; }
        }
      }
      roster.name = name;
      if (c.rosters.some((r) => r.id === roster.id)) roster.id = uid('r');
      c.rosters.push(roster);
      restored.push(roster);
      return false;
    });
    if (!restored.length) return { ok: false, error: '没有找到要恢复的名单' };
    if (!c.rosters.some((r) => r.id === c.activeRosterId)) c.activeRosterId = c.rosters[0].id;
    saveStore();
    appendLog('ROSTER_RESTORE', { names: restored.map((r) => r.name), count: restored.length });
    return { ok: true, restored: restored.length, data: classroomPublicData() };
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
    if (patch && patch.weight != null) {
      /* 非VIP限额：免密进来的一天只放一个人的权重，改成功即占额度，换人直接拒绝；VIP 不限 */
      if (!vipActive() && (adminTicketSession || adminTicketFresh())) {
        const used = adminQuotaToday();
        if (used && used.nameId !== nameId) {
          appendLog('ADMIN_QUOTA_BLOCK', { rosterId: rosterId, nameId: nameId, usedNameId: used.nameId });
          return {
            ok: false,
            error: '请稍后重试（非VIP用户仅限一人使用）。请次日再试',
            data: classroomAdminData(),
            quota: adminQuotaInfo()
          };
        }
        if (!used) {
          adminQuotaSave({
            date: dateKey(),
            rosterId: rosterId,
            nameId: nameId,
            name: target.name,
            ts: Date.now()
          });
          appendLog('ADMIN_QUOTA_USE', { rosterId: rosterId, nameId: nameId, name: target.name });
        }
      }
      target.weight = clampWeight(patch.weight);
    }
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
    /* 免密工具带 --admin 启动：直接进课堂助手并弹出管理员模式 */
    if (Array.isArray(argv) && argv.includes('--admin')) {
      openClassroomWindow({ admin: true });
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

    // 注意：这里不能无条件调用 app.setAppUserModelId()。Windows 任务栏会拿 AUMID 去开始菜单里
    // 找同名快捷方式取图标；便携版 / win-unpacked 直接运行时没有这个快捷方式，任务栏就会退化成
    // 空白的默认图标（用户看到的「白色图标」）。不设置 AUMID 时任务栏直接用窗口图标，四套主题下都正常。
    // 通知功能没有使用 Electron Notification，所以去掉 AUMID 不影响任何现有功能。
    createWindow();
    createTray();
    wireIpc();
    startNewsScheduler();
    registerGlobalShortcuts();
    if (isTestBuildApp()) {
      setTimeout(() => openTestPanel(), 1600);
    }
    if (process.argv.includes('--classroom')) {
      setTimeout(() => openClassroomWindow(), 500);
    }
    if (process.argv.includes('--admin')) {
      setTimeout(() => openClassroomWindow({ admin: true }), 500);
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
