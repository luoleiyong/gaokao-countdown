/*
 * 桌宠动作素材校验（在 Electron 渲染进程里解码 WebP）
 *
 * 用法：
 *   npm run verify         全量校验 1331 帧
 *   npm run verify:fast    每 8 帧抽 1 帧，快速自检
 *
 * 校验项：
 *   - 写作业循环 169 帧、11 组动作各 121 帧
 *   - 每帧尺寸 270×262
 *   - 每帧非透明像素 > 0（没有空白/解码失败）
 *   - 绿色边缘像素为 0（alpha>0 且 g-max(r,b) > 10）
 */
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

const ASSETS = path.join(__dirname, '..', 'renderer', 'assets');
const EXPECT_W = 270;
const EXPECT_H = 262;
const HW_COUNT = 169;
const ACTION_COUNT = 121;
const ACTION_KEYS = ['stretch', 'water', 'eyes', 'snack', 'tidy', 'window', 'cheer', 'think', 'ponder', 'hungry', 'crave'];

const fast = process.argv.includes('--fast');
const step = fast ? 8 : 1;

function listFrames(dir, expected, relPrefix) {
  if (!fs.existsSync(dir)) return { rel: relPrefix, missing: true, files: [] };
  const files = fs.readdirSync(dir).filter((f) => /^f\d{3}\.webp$/.test(f)).sort();
  return {
    rel: relPrefix,
    expected,
    files: files.map((f) => ({
      rel: path.posix.join(relPrefix, f),
      url: pathToFileURL(path.join(dir, f)).href
    }))
  };
}

function collectGroups() {
  const groups = [];
  const hw = listFrames(path.join(ASSETS, 'hw'), HW_COUNT, 'hw');
  groups.push(hw);
  ACTION_KEYS.forEach((key) => {
    groups.push(listFrames(path.join(ASSETS, 'hwact', key), ACTION_COUNT, 'hwact/' + key));
  });
  return groups;
}

async function run() {
  const groups = collectGroups();
  const problems = [];
  const rows = [];

  groups.forEach((g) => {
    if (g.missing) {
      problems.push(`${g.rel}：目录不存在`);
      return;
    }
    if (g.files.length !== g.expected) {
      problems.push(`${g.rel}：帧数 ${g.files.length}，应为 ${g.expected}`);
    }
    rows.push({ group: g.rel, frames: g.files.length });
  });

  const all = [];
  groups.forEach((g) => {
    g.files.forEach((f, i) => {
      if (i % step === 0) all.push(f);
    });
  });

  console.log(`校验 ${all.length} 帧（共 ${groups.reduce((n, g) => n + g.files.length, 0)} 帧，抽样步长 ${step}）…`);

  const win = new BrowserWindow({
    show: false,
    width: 200,
    height: 200,
    webPreferences: {
      // file:// 页面读取 canvas 像素需要关闭同源限制，仅本地校验脚本使用
      webSecurity: false,
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  await win.loadFile(path.join(__dirname, 'verify.html'));

  const batchSize = 40;
  const results = [];
  for (let i = 0; i < all.length; i += batchSize) {
    const batch = all.slice(i, i + batchSize);
    const chunk = await win.webContents.executeJavaScript(
      `window.verifyFrames(${JSON.stringify(batch)})`
    );
    results.push(...chunk);
    process.stdout.write(`\r已检查 ${Math.min(i + batchSize, all.length)}/${all.length}`);
  }
  process.stdout.write('\n');

  let badSize = 0;
  let badGreen = 0;
  let badEmpty = 0;
  let worstGreen = 0;
  results.forEach((r) => {
    if (r.error) {
      badEmpty += 1;
      problems.push(`${r.file}：${r.error === 'decode' ? '解码失败' : '读取失败'}`);
      return;
    }
    if (r.w !== EXPECT_W || r.h !== EXPECT_H) {
      badSize += 1;
      problems.push(`${r.file}：尺寸 ${r.w}×${r.h}，应为 ${EXPECT_W}×${EXPECT_H}`);
    }
    if (!r.opaque) {
      badEmpty += 1;
      problems.push(`${r.file}：没有任何非透明像素`);
    }
    if (r.green > 0) {
      badGreen += 1;
      worstGreen = Math.max(worstGreen, r.green);
      problems.push(`${r.file}：绿色边缘像素 ${r.green} 个（最大差值 ${r.maxDelta}）`);
    }
  });

  console.log('\n分组帧数：');
  rows.forEach((r) => console.log(`  ${r.group.padEnd(18)} ${r.frames}`));
  console.log(`\n尺寸不符 ${badSize} 帧，空白/解码失败 ${badEmpty} 帧，绿边 ${badGreen} 帧（单帧最多 ${worstGreen} 像素）`);

  win.destroy();

  if (problems.length) {
    console.log('\n问题明细（最多 30 条）：');
    problems.slice(0, 30).forEach((p) => console.log('  - ' + p));
    if (problems.length > 30) console.log(`  … 其余 ${problems.length - 30} 条省略`);
    console.log('\n校验未通过');
    app.exit(1);
    return;
  }
  console.log('\n校验通过：帧数、尺寸、透明度与绿边全部正常');
  app.exit(0);
}

app.whenReady().then(() => {
  run().catch((e) => {
    console.error('校验脚本异常：', e && e.message ? e.message : e);
    app.exit(2);
  });
});
