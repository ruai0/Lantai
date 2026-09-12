# 发布与运维

## 发版流程（维护者）

```bash
# 1. CHANGELOG.md：把 "## [Unreleased]" 改为 "## [x.y.z] - 日期" 并提交，工作区保持干净
# 2. 一条命令：
npm run release 0.6.2
```

脚本做：校验（版本合法 / CHANGELOG 有对应段落 / 工作区干净 / tag 不存在）→ bump `package.json` → commit → tag → push。随后 **GitHub Actions 自动接管**：云端构建 NSIS 安装包 + 便携版 → 生成 SHA256SUMS.txt → 用 CHANGELOG 对应段落作为 Release 正文创建 Release。约 5~10 分钟，进度见仓库 Actions 页。

产物：`lantai-setup-x.y.z.exe`、`lantai-portable-x.y.z.exe`、`latest.yml`、`*.blockmap`、`SHA256SUMS.txt`。

> 本地 `npm run dist` 仅用于自测产物，**不要**把本地产物传 Release（与云端哈希不一致会让自动更新校验失败）。

## 自动更新机制

- 更新源内置为本仓库 Releases（`applyFeed` 识别 `github.com/<owner>/<repo>` 走 GitHub provider，其余按通用静态目录）。
- 用户侧零配置；内网机器可在「设置 → 软件更新」填任意 HTTP(S) 静态目录（放 latest.yml + setup + blockmap 即可），或填 `off` 彻底禁用。
- 未做代码签名：electron-updater 的签名校验已关，完整性由 latest.yml 内 SHA-512 保证（下载后自动比对，不符拒装）。
- 增量更新：`.blockmap` 让升级只下载变化字节段。
- 只有 NSIS 安装版参与自动更新；便携版不参与。

## 运维排障（用户机器）

- 主日志：`%APPDATA%/兰台/logs/main-YYYYMMDD.log`（启动记录 + 所有 IPC 业务异常 + 未捕获异常，超 5MB 轮转 .old）。用户报障先要这份，或让用户「设置 → 复制诊断信息」一键带上环境 + 日志尾巴。
- 单实例：重复启动聚焦已有窗口。窗口尺寸/位置记忆于 `%APPDATA%/兰台/window-state.json`，换显示器坐标失效自动回退居中。
- 渲染进程崩溃自动重载两次，仍失败弹窗引导重启。
- 从 FreeTool 时代升级：首启自动迁移旧 `%APPDATA%/FreeTool` 的设置/历史/窗口状态，旧文件保留。
- 装机验收先看「设置 → 本机环境」：Office/WPS 组件与中文字体探测结果（Office 转 PDF 与中文水印依赖它们）。

## 调试面板（维护者）

界面任意处（非输入框、英文输入法）连续键入 8 字母口令即弹出：环境键值 / 主日志尾巴 / 原始 settings+history / 操作（DevTools、立即检查更新、打开主页、重启、重置设置）。口令值见 `src/renderer/src/App.vue` 的 `SECRET`，勿写入公开教程。

## 版本与分支

- `main` 直推；发版靠 tag（`v*`）触发 CI，无独立 release 分支。
- 语义化版本：破坏性/大功能 minor，修 bug patch。
