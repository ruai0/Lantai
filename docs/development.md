# 开发指南

## 常用命令

```bash
npm install         # 已配置国内镜像（.npmrc）
npm run dev         # 开发模式（热更新）
npm run build       # 构建到 out/（含 check:renderer 静态检查）
npm run typecheck   # vue-tsc
npm run test        # vitest 单测 + 临时目录集成冒烟
npm run test:ui     # 一键 UI 冒烟：构建测试包→起 CDP→跑 11 组真实界面场景
npm run dist        # 本地打包 NSIS + 便携版到 release/（正式发布走 npm run release）
npm run gen:icon    # 从 brand/lantai-source.png 重新生成全部图标尺寸
npm run shot        # 重新截取 README 界面图（docs/screenshots/）
```

> 前提：Node ≥ 18 且 `node` 在 PATH。若 npm 报「'node' 不是内部或外部命令」，确认 node.exe 目录已加入系统 PATH。

## 架构

```
src/
├─ shared/             types.ts 三端共享类型（IPC 统一返回 { ok, data | error }）；namePattern.ts 文件名共用工具；
│                      textDiff.ts 文本逐行差异；settings.ts 偏好类型 + 默认值 + 归一化（旧配置自动兼容）
├─ main/               主进程：ipc/ 薄注册层 + services/ 业务
│   ├─ pdfService          pdf-lib（水印中文用系统字体经 fontkit 嵌入）
│   ├─ excelToolsService   exceljs + iconv-lite（GBK）：合并/拆分/脱敏/CSV
│   ├─ excelMatchService   跨表匹配填充（VLOOKUP 替代）+ 两表差异比对
│   ├─ replaceService      docx XML 节点替换 + xlsx 单元格批量查找替换
│   ├─ officeToPdfService  PowerShell COM 自动化（Word/Excel/PPT × MS Office/WPS），逐文件进度
│   ├─ inventoryService    文件清单与重复文件（exceljs 报告导出）
│   ├─ zipService          PizZip 打包 / 批量解压
│   ├─ extractService      txt/csv/xlsx/docx 提取手机号/身份证/邮箱
│   ├─ taskProgress        任务队列进度广播（task:update 事件）+ 文件粒度取消
│   ├─ envProbe            本机 Office/WPS COM 注册表探测 + 中文字体扫描（结果缓存）
│   ├─ undoJournal         重命名/归类的撤销日志（userData/journal）
│   ├─ migrate             FreeTool→兰台 改名数据迁移
│   ├─ log                 主进程日志落盘（userData/logs，IPC 异常与崩溃记录）
│   └─ windowState         窗口尺寸/位置记忆（含显示器有效性钳制）
├─ preload/            contextBridge 白名单（global.d.ts 提供 window.api 类型 = LantaiApi）
└─ renderer/           Vue3 + Element Plus
    ├─ tools.ts            工具注册表：侧栏/首页/命令面板/收藏的唯一数据源
    ├─ utils/ipc.ts        window.api 包装（contextBridge 拒收 Vue Proxy，调用前 plain() 净化）
    ├─ utils/taskQueue.ts  渲染层串行队列 + 取消 + 主进程进度订阅
    ├─ utils/update.ts     更新状态订阅（electron-updater 事件经主进程转发）
    └─ components/         CommandPalette / TaskDock / DebugDialog / CloseChoiceDialog / WelcomeDialog …
```

- IPC 通道按工具分组（`pdf:merge`、`excel:mask`、`zip:pack`…），业务异常在 main 统一包装 `{ ok:false, error }`；渲染层 `call()` 弹提示返回 data。
- 输出文件重名自动追加 `(2)`，绝不覆盖；输出目录不存在自动创建。
- 图片处理走 Canvas；PDF 转图片/提取文字/压缩缩略图用 pdfjs-dist；二维码 qrcode/jsqr；拼音 pinyin-pro。
- 渲染层专用库（pdfjs-dist/jsqr/pinyin-pro/qrcode）放 devDependencies：vite 打进 assets，electron-builder 不再重复打包（省 ~17MB）。

## 设计系统

「精密仪器面板」：墨蓝操作台侧栏 + 琥珀信号色。

- 唯一样式入口 `src/renderer/src/styles/app.css`：顶部设计令牌（`--rail-*` 墨蓝、`--paper/--surface` 纸面、`--accent/--amber` 信号色、`--font-display/body/mono/doc`），随后接管 Element Plus CSS 变量，组件自动跟随主题。
- 字体：标题技术编号 Bahnschrift（DIN 窄体）；品牌字「兰台」用仿宋 `--font-doc`（公文正文字体）；正文 Microsoft YaHei；数值等宽 Cascadia Mono。
- 深色模式只翻转纸面/文字/线条令牌；已适配 `prefers-reduced-motion`。
- 新增功能页沿用共用类名（`step-card`、`file-list`、`tool-grid`、`form-row`）即获得同一观感。

## UI 冒烟（发版前必跑）

`npm run test:ui`：自动构建测试包（FT_TEST_HOOKS=1，暴露组件实例钩子，正式构建不带）→ 起 CDP :9222 → 跑 `.ftest/ui-*.js` 全部场景 → 汇总退出。

- 场景脚本是返回 JSON 的 async IIFE，由 `scripts/cdp.mjs` 在渲染进程执行；`__Z` 助手提供 `vm(key)`（按 setupState 键找组件）、`btn(text)`、`wait(fn)`、`nav(hash, vmKey)`。
- 素材在 `.ftest/`（`make-fixtures.mjs` 生成）；输出落 `.ftest/out/`（gitignore）。
- 新增场景：写好 `.ftest/ui-xxx.js` 后在 `scripts/ui-smoke.mjs` 的 SCENARIOS 注册（file/name/check）。
- 单跑一个场景：`npm run test:ui palette`。

## 图标管线

源图 `brand/lantai-source.png`（2048，AI 生成）→ `npm run gen:icon`：自动定位琥珀印面（行投影法，免疫背景噪点与水印）→ 扫描线蒙版（贴真实圆角、填实深色笔画）→ 产出 `build/icon.png`(256) / `icon.ico`(256/48/32/16) / `public/logo.png`(128) / `public/tray.png`(32)。换 logo 只替换源图重跑即可。
