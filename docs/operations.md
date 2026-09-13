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

## 国内镜像（Gitee）

连不上 GitHub 的用户：镜像仓库 https://gitee.com/ruai0/lantai （源码、Issue 参考、自行构建）。

**代码镜像已自动化**：`.github/workflows/mirror-gitee.yml` 在 main 推送与打 `v*` 标签时，把分支和标签单向同步到 Gitee。一次性配置：

```bash
ssh-keygen -t ed25519 -f ./gitee_deploy -C "lantai-github-actions" -N ""
# 公钥 gitee_deploy.pub → Gitee 仓库「设置 → 部署公钥」（勾选提供推送权限）
# 私钥 gitee_deploy   → GitHub 仓库 secret GITEE_SSH_KEY（填整个私钥文本）
```

未配置该 secret 时流水线自动跳过，不会报错。同步是 `--force` 单向覆盖：**改动一律走 GitHub，不要在 Gitee 上提交**。

**产物（安装包）镜像暂未启用**，两个实测结论：

- `https://gitee.com/api/v5/repos/ruai0/lantai/releases/latest` 返回 **404** —— Gitee 没有 `latest` 别名，附件直链只认 `https://gitee.com/<owner>/<repo>/releases/download/<tag>/<文件>`，路径含版本号，无法作为 electron-updater 需要的固定目录。
- 安装包 108–122MB（见 `release/`），个人版发行版附件上限常见为 100MB，**需先在自己的 Gitee 账号上实测能否传一个 110MB 附件**。

两条可选路线：

1. Gitee 滚动标签：维护一个固定 tag `latest` 的发行版，每次发版把 `latest.yml` + setup + blockmap 重传到它下面，把该 tag 的直链目录作为通用更新源。要求附件能过大小限制，且需验证匿名下载（不登录能否取到文件）。
2. 国内对象存储（推荐）：产物传腾讯云 COS / 阿里云 OSS 公共读桶，`https://<bucket>/<path>/lantai/` 作为通用更新源，electron-updater 原生支持，发版流水线只需多一步 `coscmd upload` / `ossutil cp`。用户在「设置 → 软件更新」填这一条地址即可，与内网镜像走的是同一套 generic 机制。

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
