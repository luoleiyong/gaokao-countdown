#!/usr/bin/env node
/* 管理员免密 · 命令行版（不需要界面时用）
 *   node admin-tool\admin-unlock.js                 免密 60 分钟
 *   node admin-tool\admin-unlock.js --minutes 10    指定分钟数
 *   node admin-tool\admin-unlock.js --status        看剩余时间
 *   node admin-tool\admin-unlock.js --lock          立即收回
 */
const core = require('./admin-unlock-core.js');
const argv = process.argv.slice(2);
const has = (n) => argv.indexOf('--' + n) >= 0;
const val = (n, d) => { const i = argv.indexOf('--' + n); return i >= 0 && argv[i + 1] ? argv[i + 1] : d; };

if (has('status')) {
  const s = core.readStatus();
  console.log(s.valid
    ? '免密票据有效，还剩 ' + Math.round(s.remain / 60000) + ' 分钟（到期 ' + s.expiresAt + '）。'
    : '免密票据：没有或已过期。');
  process.exit(0);
}

if (has('lock')) {
  console.log(core.dropTicket() ? '免密票据已删除，下次进入管理员需要密码。' : '没有可删除的票据。');
  process.exit(0);
}


const minutes = Number(val('minutes', 1)) || 1;
const t = core.writeTicket(minutes);
console.log('已开启管理员免密，有效 ' + t.minutes + ' 分钟（到 ' + new Date(t.data.expires).toLocaleString() + '）。');
console.log('打开「课堂助手 → 管理员模式」会直接进入，不再询问密码。');
console.log('票据位置：' + core.ticketFile);
