# AGENTS.md · 本项目的 AI 协作规则

> 给所有在本仓库里改代码的 AI / 协作者。每次新会话**先读本文件**，再读 `README.md`、`docs/development-workflow.md`、`docs/audit-log.md`。
> 本文件里的规则优先于个人习惯；与用户当面指令冲突时，以用户当面指令为准，并在审计日志里记下偏离原因。

## 0. 一次任务的标准动作

1. 读 `README.md` + `docs/development-workflow.md` + `docs/audit-log.md`（最近 3 条）。
2. 复现问题或确认需求，先定位到**具体文件与行号**，再动手。
3. 只改必要文件；改完跑语法检查、真机验证、截图取证。
4. 在 `docs/audit-log.md` 追加一条审计记录（模板见第 8 节）。
5. 回复用户时按第 9 节的交付格式给结论。

## 1. 代码修改审计规则（强制）

- **一次任务一份记录**：每轮改动都要在 `docs/audit-log.md` 追加一条，包含：版本号、日期、用户原始需求（引用原话）、改动文件与行号、改动原因、影响面、验证证据、回滚方式。缺一项视为没做完。
- **最小改动**：只碰与需求相关的行。禁止顺手重构、禁止整文件格式化、禁止改无关命名。不得不动大范围时，先说明理由再改。
- **可回滚**：新增优先于删改；删素材、删 IPC、删 store 字段前必须确认没有引用方。保留旧素材文件，除非用户明确说删。
- **接口稳定**：`preload.js` 暴露的桥名（`window.gaokao.*`）、IPC 频道名（`classroom:*`、`window:*`、`store:*`）、`store.json` 字段名都是对外契约，改名等于破坏升级兼容；确需改必须同时写迁移。
- **数据安全**：改 `store` 结构必须写默认值 + 归一化（`normalize*`）+ 旧数据兼容；测试**不得写用户真实数据** —— 测试前把 `%APPDATA%\GaokaoCountdown\store.json` 备份走，测完还原；`--user-data-dir` 不隔离业务数据，别指望它。
- **必跑检查**：`node --check main.js`、`node --check preload.js`、`node --check renderer\classroom.js`、`node --check renderer\app.js`（改到哪个跑哪个，改主进程要全跑）。
- **UI 改动必须有截图**：窗口 1120×760，四套主题（board / starry / warm / bamboo）至少抽查 2 套，截图看完再交付。
- **不擅自发布**：用户没说「发布 / 发版 / 更新 GitHub」时，只打包不发布：不动 `update/version.json`、不 commit/push、不建 Release。
- **不擅自提交**：用户没说「提交 / push」时保持工作区改动，最后在交付里说明「未提交」。

## 2. UI 文字规则（文案规范）

### 2.1 语言与标点
- 简体中文；全角标点：`，。：；！？「」`。中文句子内不用半角逗号句号。
- 数字与单位之间留一个半角空格：`5 分钟`、`100 人`、`3 天`、`1120×760` 例外（尺寸本身用 ×）。
- 中英文混排时英文两侧留空格：`txt / csv / xlsx / xls`。
- 不用感叹号堆叠，不用「温馨提示」「请注意」这类空话。

### 2.2 术语表（同一概念只用一个词）
| 概念 | 用词 | 不要用 |
|---|---|---|
| 抽人页面 | 随机点名 | 抽奖、摇号 |
| 分组页面 | 随机分组 | 分班 |
| 计时页面 | 课堂计时 | 倒计时器、计时器（除非指计时器模式） |
| 学生集合 | 名单 | 班级、名册、列表 |
| 名单里的人 | 学生 / 姓名 | 成员、条目 |
| 管理员入口 | 管理员模式 | 后台、超级模式 |
| 删除后的暂存 | 最近删除 | 回收站、垃圾箱 |
| 外观设置面板 | 外观与背景 | 皮肤、主题设置 |
| 满屏 | 全屏 | 全屏模式（按钮上只写「全屏」「退出全屏」） |

### 2.3 按钮与提示
- 按钮 = 动词 + 对象：`新建名单`、`生成编号`、`恢复默认`、`选择文件夹`、`开始点名`。长度控制在 6 字内，必要时两行。
- 会打开后续步骤的按钮，文案要写清下一步：`下一步：添加学生`。
- 操作成功用 toast：`已…`（`已创建「二班名单」，共 5 人`）；失败用原因句：`已有同名名单，请换一个名称`，不要只说「操作失败」。
- 破坏性操作必须写清后果与可恢复性：`删除后会放进「最近删除」，可以随时恢复；3 天后自动清除。`
- 数量用「已识别 N 人」「还剩 X 天」「删除所选（N）」这类固定句式，别自创。
- 输入框占位符给**示例**而不是说明：`张三\n李四\n王五`、`txt / csv / xlsx / xls`。
- 文案改动要同步 `README.md` 的功能表 / FAQ，避免文档和界面打架。

### 2.4 文案长度与排版
- 顶栏标签 ≤ 4 字；卡片标题 ≤ 6 字；按钮单行不换行。
- 说明文字不超过两行（约 40 字），超了拆成列表或 hint。
- 次要说明用 `.roster-lock-hint` / hint 类的小字号弱色，不抢主信息。

## 3. 视觉与主题规则

- **颜色只能走变量**：`--text` `--dim` `--faint` `--gold` `--gold-soft` `--gold-deep` `--glass-*` `--ui-*` `--glass-radius`。禁止在 classroom.css / styles.css 里写死 `rgba(217,182,74,…)` 这类具体颜色；确需半透明就用 `color-mix(in srgb, var(--gold) 30%, transparent)`。
- **强调色随皮肤**：课堂助手的四套皮肤强调色在 `renderer/classroom.css` 顶部统一覆盖：
  `board #e9dcbb` / `starry #bcc2ff` / `warm #a06f24` / `bamboo #6f8a46`。
  **主界面保持 `renderer/styles.css` 里的原金色**，除非用户明确要求一起改。
- **正文永远跟 `--text`**：强调文字也用 `--text`，只有底色/描边/阴影用 `--gold`。改字号滑杆只能改字号，不能改颜色（`applyGlassLook` 里不要 setProperty `--text`/`--gold`）。
- **玻璃卡片复用配方**：`.timer-glass`、`.timer-card` 的毛玻璃参数（`--timer-opacity` / `--timer-veil` / `--timer-blur`）是唯一来源，新面板不要另造一套。
- **四皮肤都要验**：新增颜色/卡片/按钮后，至少截图 board + starry + warm + bamboo 各一张，确认没有某套皮肤下文字看不清。
- **全屏与拖动**：全屏用 `body.cls-fullscreen`；可拖动区域用 `-webkit-app-region: drag`，交互控件必须 `no-drag`。

## 4. 架构硬约束（踩过的坑，别再踩）

| 约束 | 原因 |
|---|---|
| 不要调用 `app.setAppUserModelId()` | 便携版 / win-unpacked 没有同名开始菜单快捷方式，任务栏会退化成空白默认图标（2.3.7 修过） |
| 起 GUI 前 `$env:ELECTRON_RUN_AS_NODE=$null` | 本机环境变量会导出它，否则 exe 以 Node 模式运行并报 `bad option: --user-data-dir` |
| `--user-data-dir` 不隔离业务数据 | `main.js` 用 `app.getPath('appData')` + `GaokaoCountdown`，改不了；测试就备份/还原 store.json |
| 课堂标签是 `data-tab`（roll/group/timer） | 不是 `data-view` |
| CDP `visibilityState=hidden` 时 Promise 永不 resolve | 截图/异步求值要重启窗口或全用同步表达式 |
| PowerShell 5.1 按 ANSI 读无 BOM 的 .ps1 | 脚本里**不要出现中文字面量**，路径靠 `Get-ChildItem` 动态取 |
| 打包命令退出码 1 常是 npm 警告 | 判成功看 `dist*` 产物与版本号，不看 exit code |
| `build/` 目录被 git 跟踪 | 改 `build/installer.nsh`、`build/icon.png` 同样要进审计记录 |

## 5. 文件与命名

- 主进程逻辑全在 `main.js`（单文件，按功能分段，用 `// ===== 段名 =====` 分隔）；新增 IPC 放在对应功能段内，不要另起文件。
- 渲染层：`renderer/app.js`（主界面）、`renderer/classroom.js`（课堂助手）、`renderer/styles.css`（主界面主题变量）、`renderer/classroom.css`（课堂助手样式）。
- class 名前缀：主界面 `g-`，课堂助手 `cls-`；新组件沿用前缀。
- 素材：内置背景 `assets/bg/builtin-N.mp4`（打包时 `asarUnpack`），彩蛋 `renderer/assets/ms/ms-*.mp4`。

## 6. 构建与发布

完整流程见 `docs/development-workflow.md`，要点：

- 版本号三处同步：`package.json` 第 3 行、`package-lock.json` 第 3 行与 `packages[""]` 里的 version。
- 打包：`node scripts/build-official.js distNNN portable,nsis`（先停 electron 与 `高考倒计时` 进程，删旧目录）。
- 不发布时：删掉 `distNNN\latest.yml`，不动 `update/version.json`。
- 发布时：`update/version.json` 写版本 + 中文更新说明 → commit/push → GitHub Release（tag `vX.Y.Z`，上传 portable + Setup）→ 刷新 jsDelivr → 打包版实机确认 `检查更新` 命中新版本。

## 7. 禁止事项

- 禁止把测试数据留在用户真实 store（名单、设置、备份路径）。
- 禁止在渲染进程里开 `nodeIntegration` / 关 `contextIsolation`。
- 禁止在打包产物里留 `latest.yml` 却声称「未发布」。
- 禁止改完不验证就交付：没有截图 / 没有实测数据的修复不算完成。

## 8. 审计记录模板（追加到 docs/audit-log.md）

```md
### 2.3.x · 2026-11-23 · 一句话标题
- 需求原话：「……」
- 改动：
  - `renderer/classroom.css:70`：改了什么
  - `main.js:3286`：改了什么，为什么
- 影响面：哪些页面 / 哪些皮肤 / 哪些数据
- 验证：命令、实测数值、截图路径
- 回滚：还原哪几行 / 从哪个 dist 取回
```

## 9. 交付格式（回复用户时）

1. **结论先行**：一句话说清修好了什么 / 为什么。
2. **变更清单表**：文件 | 位置 | 改了什么 | 为什么。
3. **验证证据**：实测数值、截图、四皮肤抽查结果。
4. **版本与产物**：版本号、exe 体积、是否发布、是否提交。
5. **未做的事**：明确列出「没动的地方」（例如「主界面仍保持原金色」），避免用户以为已改。
