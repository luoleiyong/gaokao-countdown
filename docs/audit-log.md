# 代码修改审计日志

> 规则见 `AGENTS.md` 第 1 节。每次改动追加一条，新的写最上面。
> 每条必须包含：需求原话、改动文件:行、原因、影响面、验证证据、回滚方式。

## 2.3.7 · 2026-11-23 · 修复便携版任务栏图标变空白 + 建立审计规则

- 需求原话：「发现这个应用图标在电脑任务栏显示的是白色的，没有原来显示的样子了修复好后发布新版本2.然后加入本项目代码修改的审计规则，在ui文字等加入规则，以后新对话方便ai参考」
- 改动：
  - `main.js:3286-3289`：删除 `app.setAppUserModelId('com.trae.gaokao.countdown')`，改为说明性注释。
  - 新增 `AGENTS.md`：代码修改审计规则、UI 文案规范、视觉/主题规则、架构硬约束、构建发布要点、交付格式。
  - 新增 `docs/audit-log.md`：本文件。
- 原因：Windows 任务栏用窗口的 AppUserModelID 去开始菜单里找同名快捷方式取图标；便携版与 `win-unpacked` 直接运行时不存在该快捷方式，任务栏退化成系统默认空白图标（`IDI_APPLICATION`）。不设置 AUMID 时任务栏直接使用 `BrowserWindow` 的 `icon`（`build/icon.png`），四套主题下都能正常显示。项目没有使用 `Electron Notification`，去掉 AUMID 不影响通知。
- 影响面：任务栏按钮图标、托盘图标（不受影响）、窗口图标；不涉及业务数据。
- 验证：
  - 复现：启动 `dist236\win-unpacked\高考倒计时.exe`，任务栏按钮为空白页面图标；`WM_GETICON` 返回 256×256 正确图标，说明窗口图标本身没问题，问题在 AUMID 解析。
  - 对比：dev 用 `GK_SKIP_AUMID=1` 启动 → 任务栏显示「高」图标；删除调用后 dev 正常启动同样显示「高」图标。
  - 打包版：2.3.7 的 `win-unpacked` 与 portable 启动后任务栏均为「高」图标（截图 `C:\Temp\gk236-shots\taskbar-*.png`）。
- 回滚：把 `main.js:3286` 的注释换回 `app.setAppUserModelId('com.trae.gaokao.countdown');`（不建议，会再次出现空白图标）。

## 2.3.6 · 2026-11-23 · 课堂助手强调色随主题

- 需求原话：「我指的是这个颜色与主题不统一哦」（承接 m03333「除青竹小院…其他主题颜色显示的字都是橘黄色」）
- 改动：`renderer/classroom.css` 顶部按皮肤覆盖 `--gold/--gold-soft/--gold-deep`；40 处 `color: var(--gold)` → `var(--text)`；28 处硬编码 `rgba(217,182,74,…)` → `color-mix(in srgb, var(--gold) …)`；3 处自定义背景下的深绿文字 → `var(--text)` 派生。
- 原因：正文早已跟随 `--text`，真正固定为金色的是强调色变量；只有青竹小院把 `--gold` 定义成绿色，所以只有它看着一致。
- 验证：四皮肤 computed 色值抽查（board `#e9dcbb` / starry `#bcc2ff` / warm `#a06f24` / bamboo `#6f8a46`），截图见 `C:\Temp\gk236-shots\`。
- 回滚：还原 `renderer/classroom.css` 顶部覆盖块并把 `color: var(--text)` 改回 `var(--gold)`。

## 2.3.5 · 2026-11-23 · 新增「内置动画 3」

- 需求原话：「@D:\桌面\内置1.mp4 在内置动画中再加入一个这个动画，」
- 改动：`main.js` 内置背景白名单加 `builtin-3.mp4`；`renderer/classroom.js` `BUILTIN_BGS` 增加条目；`renderer/classroom.css` 给 `#timerBgBuiltin` 三列 grid（原 flex 换行导致第三个芯片被裁）；新增 `assets/bg/builtin-3.mp4`（3,719,372 B，960×540，24 fps，2:26）。
- 验证：dev 与打包版都实测第三个芯片可点、`duration=146.25`、`readyState=4`、循环静音播放。
- 回滚：删除 `builtin-3.mp4` 与三处引用，恢复 `#timerBgBuiltin` 的 flex 布局。

## 2.3.4 · 2026-11-23 · 替换内置背景与彩蛋视频

- 需求原话：「@D:\xiaz\蓝绿蓝金鎏金山水.mp4 @D:\xiaz\内置1.mp4 我新加入了一个动画视频… @D:\xiaz\高考日 · 归零（10 秒）.mp4 @D:\xiaz\30 天 · 落笔如收剑（余烬10秒）.mp4 这2个10秒视频是特殊的彩蛋动画」
- 改动：`assets/bg/builtin-1.mp4` 换为鎏金山水（5,590,725 B / 4:19 / 无音轨）；`renderer/assets/ms/ms-0.mp4`、`ms-30.mp4` 换为 10 秒彩蛋（保留 AAC 96k 音轨，彩蛋播放时 `muted=false`）。
- 验证：抽帧确认画面正常；`showMilestoneEgg(0/30)` 实测 `duration=10.08`、`volume=0.65`。
- 回滚：从 git 历史取回旧 mp4 覆盖。

## 2.3.3 · 2026-11-23 · 名单支持数字、数字填充、删除名单与最近删除

- 需求原话：「添加设备名字有问题，改为识别文字和数字，纯数字也可以，加入一个数字快捷填充…」「在名单列表下方新建名单处加入删除名单按钮，点击后可以勾选名单进行删除，可以撤销恢复，然后删除后的数据同样也保存在本地，3天后自动清除。」
- 改动：`main.js` `stripNameLineIndex`/`cleanNameToken` 放开纯数字、`ROSTER_TRASH_TTL` 与 `classroom:delete-rosters`/`classroom:restore-rosters`；`preload.js` 两个桥；`classroom.html` 数字填充行 + 删除弹窗；`classroom.css` `.roster-actions`/`.trash-*`/锁定提示改 `var(--dim)`；`classroom.js` `applyRosterFill`、`openDeleteRosterDialog`、`restoreRosters`。
- 验证：`张三\nA2\n007\n3. 李四\n5 王五\n12` → 6 人；填充 1..12；删除→最近删除→恢复→过期 3 天自清；重名恢复自动加「（恢复）」。
- 回滚：还原上述五处改动，删除 `trash` 字段（`normalizeClassroom` 会忽略）。

## 2.3.2 · 2026-11-23 · 新建名单改为「先命名 → 再添加学生」

- 需求原话：「帮我优化一下在随机点名中点击新建名单后先弹出对话框+名单命名。然后命名完后加入一个添加页输入文字，但是一旦保存后就无法移除这个名单中的任何数据，除非到管理员模式中移除。2.本次更新为2.3.2，不发布」
- 改动：`main.js` 新增 `classroom:create-roster`（校验空名/重名，返回 `data`）；`preload.js` `classroomCreateRoster`；`classroom.html` 新增 `#rosterModal` 两步表单；`classroom.js` `openRosterDialog`/`setRosterStep`/`saveRosterDraft`；`classroom.css` `.cls-modal[hidden]` 等样式。
- 验证：空名/重名拦截、已识别 N 人、保存后名单出现在左栏；普通模式删除被 `adminGuard` 拒绝，管理员模式可删。
- 回滚：删除 `#rosterModal` 与相关函数，恢复 `btnNewRoster` 旧行为。
