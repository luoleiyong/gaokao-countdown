# 开发与发布流程

本文档记录「高考倒计时」的日常开发、版本发布、桌宠动作素材增改流程，供新会话或新协作者直接参照。

## 0. 项目位置与先读文件

- 项目路径：`D:\桌面\高考倒计时`
- 远程仓库：`https://github.com/luoleiyong/gaokao-countdown.git`（分支 `master`）
- 开始新任务前先读：
  1. `README.md`：功能、构建、目录结构
  2. `docs/development-workflow.md`：本文档
  3. `docs/character-actions.md`：桌宠动作素材与研究过程

新会话启动提示模板：

> 项目在 `D:\桌面\高考倒计时`。先读 `README.md`、`docs/development-workflow.md`、`docs/character-actions.md`，再按里面的流程执行。本次要做的：……

## 1. 关键文件

| 文件 | 作用 |
|---|---|
| `package.json` | 版本号、Electron 构建配置 |
| `package-lock.json` | 版本号需与 package.json 同步（两处） |
| `update/version.json` | 客户端更新公告（GitHub 不通时的 CDN 兜底） |
| `main.js` | 主进程：窗口、托盘、存储、天气、更新、课堂数据 |
| `preload.js` | 安全桥接 |
| `renderer/app.js` | 主界面、桌宠状态机、动作播放 |
| `renderer/fish.js` | 桌宠台词库 |
| `renderer/assets/hw/` | 写作业循环 169 帧 |
| `renderer/assets/hwact/` | 写作业互动动作，11 组 × 121 帧 |
| `docs/character-actions.md` | 动作素材来源、抠像参数、研究过程 |

## 2. 本地开发

```powershell
cd "D:\桌面\高考倒计时"
npm start
```

修改代码后先做语法检查：

```powershell
node --check renderer\app.js
node --check main.js
node --check preload.js
```

## 3. 版本号与更新公告

### 3.1 需要发布新版本时

1. 修改 `package.json` 的 `version`
2. 同步修改 `package-lock.json` 中两处 `version`（根节点和 `packages[""]`）
3. 修改 `update/version.json`：
   - `version` 与新版本一致
   - `notes` 写用户能看懂的更新内容（不写内部实现细节）
   - `url` 保持 `https://github.com/luoleiyong/gaokao-countdown/releases/latest`
4. 再构建、提交、发布

> `update/version.json` 只能在真正发布时改。否则客户端会收到一个“存在新版本但下载不到”的提示。

### 3.2 只打包、不发布时

- 可以临时升版本号，也可以保持当前版本
- **不要修改** `update/version.json`
- 不创建 GitHub Release
- 构建时加 `--publish never`，只产出本地安装包

## 4. 构建

在项目根目录执行：

```powershell
$env:ELECTRON_BUILDER_COMPRESSION_LEVEL="1"
npx electron-builder --win portable nsis `
  --config.npmRebuild=false `
  --config.compression=normal `
  --config.directories.output=distNN `
  --publish never
```

- `distNN` 用新目录（如 `dist15`），避免旧文件被占用
- 产物：
  - `GaokaoCountdown-X.Y.Z-portable.exe`
  - `GaokaoCountdown-Setup-X.Y.Z.exe`
  - `latest.yml`、`.blockmap`
- 构建前关闭正在运行的程序，避免 `win-unpacked` / exe 被锁
- `--publish never` 必加。electron-builder 在类 CI 环境会自动尝试发布，没有 `GH_TOKEN` 时会报错

## 5. 构建后校验

### 5.1 版本与修复是否进包

```powershell
node -e "const asar=require('@electron/asar');const p='distNN/win-unpacked/resources/app.asar';console.log(JSON.parse(asar.extractFile(p,'package.json').toString()).version)"
```

需要检查具体改动时：

```powershell
node -e "const asar=require('@electron/asar');const s=asar.extractFile('distNN/win-unpacked/resources/app.asar','renderer/app.js').toString();console.log(s.includes('要检查的字符串'))"
```

### 5.2 动作素材帧数

```powershell
Get-ChildItem "renderer\assets\hwact" -Directory | ForEach-Object {
  $n = (Get-ChildItem $_.FullName -Filter *.webp).Count
  "$($_.Name) $n"
}
```

每个动作应为 121 张，写作业循环 `renderer/assets/hw` 应为 169 张；两组都应是 **270×262** 无损 WebP。

### 5.3 启动验证

关闭旧进程后运行 `distNN\win-unpacked\高考倒计时.exe`，约 10 秒后查看同目录 `启动日志.txt`：

```text
程序启动（... version=X.Y.Z）
检查更新（latest=..., current=X.Y.Z, hasUpdate=...）
```

确认版本号正确、没有异常报错。测试完关闭进程。

## 6. 提交与推送

只提交源码、素材、文档和版本文件，**不要提交 `distNN`**：

```powershell
git add main.js preload.js renderer/app.js renderer/fish.js renderer/index.html renderer/styles.css
git add package.json package-lock.json update/version.json README.md docs
git commit -m "高考倒计时 X.Y.Z：一句话说明本次更新"
git push origin master
```

提交信息沿用现有风格：

- `高考倒计时 2.0.7：新增思考与饥饿等 4 组写作业动作，补充动作素材与研究文档`
- `高考倒计时 2.0.6：桌宠菜单跟随皮肤、分科写作业台词与互动频率`

## 7. 创建 GitHub Release 并上传资产

仓库没有安装 `gh` CLI，使用 GitHub REST API + Git 凭据管理器中的令牌。

### 7.1 取令牌（不要打印到日志）

```powershell
$env:GIT_TERMINAL_PROMPT="0"
$cred = ("protocol=https`nhost=github.com`n`n" | git credential fill)
$tok = (($cred -split "`n") | Where-Object { $_ -like 'password=*' }) -replace '^password=',''
```

### 7.2 创建 Release

```powershell
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$h = @{ Authorization = "token $tok"; 'User-Agent' = 'trae-agent'; Accept = 'application/vnd.github+json' }
$body = @{
  tag_name = 'vX.Y.Z'
  name = '高考倒计时 X.Y.Z'
  draft = $false
  prerelease = $false
  body = "**本次更新**`n`n- 更新点 1`n- 更新点 2`n- 修复了一些已知问题"
} | ConvertTo-Json
$rel = Invoke-RestMethod -Method Post `
  -Uri 'https://api.github.com/repos/luoleiyong/gaokao-countdown/releases' `
  -Headers $h -ContentType 'application/json; charset=utf-8' `
  -Body ([Text.Encoding]::UTF8.GetBytes($body))
"created id=$($rel.id) tag=$($rel.tag_name)"
```

### 7.3 上传两个安装包

`uploads.github.com` 在本机可能遇到 schannel 吊销检查失败，必须加 `--ssl-no-revoke`：

```powershell
$hdr = 'Authorization: token ' + $tok
$base = 'https://uploads.github.com/repos/luoleiyong/gaokao-countdown/releases/<RELEASE_ID>/assets?name='
foreach ($f in @('GaokaoCountdown-X.Y.Z-portable.exe','GaokaoCountdown-Setup-X.Y.Z.exe')) {
  $p = Join-Path 'D:\桌面\高考倒计时\distNN' $f
  curl.exe -sS -f --ssl-no-revoke -X POST -H $hdr `
    -H 'User-Agent: trae-agent' -H 'Content-Type: application/octet-stream' `
    --data-binary "@$p" ($base + $f)
}
```

## 8. CDN 刷新与验证

### 8.1 刷新 jsDelivr

```powershell
curl.exe -sS --ssl-no-revoke 'https://purge.jsdelivr.net/gh/luoleiyong/gaokao-countdown@master/update/version.json'
```

返回 `"status": "finished"` 即已提交刷新任务。

### 8.2 验证

```powershell
$h = @{ 'User-Agent' = 'trae-agent'; Accept = 'application/vnd.github+json' }
$r = Invoke-RestMethod -Uri 'https://api.github.com/repos/luoleiyong/gaokao-countdown/releases/tags/vX.Y.Z' -Headers $h
$r.assets | ForEach-Object { "$($_.name) $($_.size) $($_.state)" }

$l = Invoke-RestMethod -Uri 'https://api.github.com/repos/luoleiyong/gaokao-countdown/releases/latest' -Headers $h
"latest=$($l.tag_name)"
```

注意：jsDelivr 的 `@master` 分支解析可能有缓存延迟，刷新后仍可能短时间返回旧版本。客户端更新以 GitHub Latest Release 为主通道，CDN 只是兜底，延迟不影响发布结果。

## 9. 发布后检查清单

- [ ] `package.json` / `package-lock.json` / `update/version.json` 版本一致
- [ ] 构建产物版本号正确，`启动日志.txt` 显示新版本
- [ ] Git 已提交并推送，Release 的 tag 指向最新提交
- [ ] Release 里两个 exe 均为 `uploaded`
- [ ] GitHub `releases/latest` 已指向新版本
- [ ] jsDelivr 已刷新（允许延迟）
- [ ] 没有把 `distNN`、`node_modules` 提交进 Git

## 10. 桌宠动作素材增改

详细流程见 `docs/character-actions.md`，要点：

1. 视频规格：720×720、24fps、约 5 秒、纯色绿幕、固定机位、全身
2. ffmpeg 抽 121 帧
3. 比例法抠像 + 中值/形态学清理 + 去绿
4. 以写作业第 1 帧内容高度 191px 为基准，按 `docs/character-actions.md` 第 3.4 节计算缩放，输出 270×262
5. 保存无损 WebP 到 `renderer/assets/hwact/<key>/`
6. `renderer/app.js` 的 `HOMEWORK_ACTIONS` 增加 `{ key, lines }`
7. `renderer/fish.js` 的 `FISH_CHEER_LINES` 同步加入这些台词
8. 验证：每条台词触发、121 帧、270×262、角色高度误差 < 2%、绿边像素为 0

台词触发是**精确文本匹配**，气泡文案必须与 `HOMEWORK_ACTIONS` 中的字符串完全一致。

## 11. 常见坑

| 问题 | 处理 |
|---|---|
| electron-builder 结尾报 `GitHub Personal Access Token is not set` | 构建命令加 `--publish never` |
| `curl` 上传报 `schannel ... CRYPT_E_NO_REVOCATION_CHECK` | 加 `--ssl-no-revoke` |
| 构建时提示文件被占用 | 先关闭正在运行的 `高考倒计时.exe` / 便携版 |
| 旧 `dist` 目录里的 exe 被锁 | 输出到新的 `distNN` 目录 |
| jsDelivr 仍返回旧版本 | 正常缓存延迟，以 GitHub Latest 为准 |
| 桌宠动作不触发 | 检查台词是否与 `HOMEWORK_ACTIONS` 完全一致、`hwReady` 是否已加载完 169 帧 |
| 宠物模式更新弹窗点不到 | 已由 `ensurePanelForUpdate()` 先切回主界面，勿删 |
| 桌宠窗口 320×428 且不可聚焦 | 弹窗类交互必须先退出宠物模式 |

## 12. 不发布时的标准做法

```powershell
# 只改代码/素材，不动 update/version.json
$env:ELECTRON_BUILDER_COMPRESSION_LEVEL="1"
npx electron-builder --win portable nsis `
  --config.npmRebuild=false `
  --config.compression=normal `
  --config.directories.output=distNN `
  --publish never
```

不创建 Release、不刷新 CDN、不推送 `update/version.json`。需要发布时再按第 3、6、7、8 节执行。
