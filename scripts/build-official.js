'use strict';
/*
 * 正式版打包：先把测试面板相关文件移出 renderer，打包后自动恢复。
 * 用法：npm run build:official（默认输出 dist30）
 */
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const stash = path.join(root, '.testpanel-stash');
const files = ['testpanel.html', 'testpanel.js', 'testpanel-window.js', 'testpanel-window.css'];
const output = process.argv[2] || 'dist30';
const targets = String(process.argv[3] || 'portable').split(',').map((s) => s.trim()).filter(Boolean);

function moveOut() {
  fs.mkdirSync(stash, { recursive: true });
  files.forEach((name) => {
    const src = path.join(root, 'renderer', name);
    if (fs.existsSync(src)) fs.renameSync(src, path.join(stash, name));
  });
}

function restore() {
  files.forEach((name) => {
    const src = path.join(stash, name);
    if (fs.existsSync(src)) fs.renameSync(src, path.join(root, 'renderer', name));
  });
  try { fs.rmdirSync(stash); } catch { /* 忽略 */ }
}

let code = 1;
try {
  moveOut();
  const res = spawnSync(
    process.platform === 'win32' ? 'npx.cmd' : 'npx',
    [
      'electron-builder', '--win', ...targets,
      '--config.npmRebuild=false',
      '--config.compression=maximum',
      '--config.directories.output=' + output,
      '--publish', 'never'
    ],
    { cwd: root, stdio: 'inherit', shell: process.platform === 'win32' }
  );
  code = res.status == null ? 1 : res.status;
} finally {
  restore();
  process.exitCode = code;
}
