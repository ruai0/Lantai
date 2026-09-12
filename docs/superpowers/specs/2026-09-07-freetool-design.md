# FreeTool 办公工具箱 — 一期设计文档

日期：2026-09-07 · 状态：已实现（v0.2，含用户反馈增补）

## 0. v0.2 增补（用户反馈：功能太少、UI 偏大）

- **UI 紧凑化**：Element Plus 全局 `size: 'small'`，自定义密度 CSS（卡片/列表/表单间距、菜单行高 38px、侧栏 150px），默认窗口 1320×860。
- **PDF 添加页码**：`pdf:add-page-numbers`，底部居中/底部右侧/右上角，起始编号 + 起始页可配，pdf-lib 标准字体（数字样式）。
- **图片旋转/水平翻转**：renderer Canvas 变换，与缩放、水印叠加生效。
- **模板辅助信息**：`template:scan`（Word 扫 document.xml + 页眉页脚，Excel 扫全部文本单元格，列出 `{字段}`）；`data:preview`（表头 + 前 5 行预览）。
- **归类整理**（重命名页新标签）：`buildOrganizePlan` 按扩展名/修改年月/年份生成移动计划，预览冲突（目标同名）后执行。
- **常用小工具页**：JSON 格式化/压缩与编解码/时间戳/UUID 在 renderer 本地计算；文件哈希走 `file:hash`（node:crypto）；二维码用 qrcode 库（renderer）生成并可保存 PNG。

## 1. 背景与目标

桌面级办公工具箱（Windows 优先），处理 PDF / 图片 / Word / Excel 等办公文件。
技术栈已定：**Electron + Vue3 + TypeScript + Element Plus**，脚手架用 electron-vite（路线 B：从零搭建，不用 Rubick 二开）。

一期只做**纯 JS 库可覆盖的四件套**，零外部引擎依赖：

1. PDF 页面操作：合并 / 拆分（提取页码、逐页、按 N 页分卷）/ 旋转
2. 图片批处理：压缩（格式转换 + 质量 + 最长边缩放）+ 文字/图片水印
3. 文档模板填充：Word（docxtemplater）与 Excel（exceljs），数据源 xlsx 或 json，批量生成 N 份
4. 批量重命名：查找替换 / 前后缀 / 序号 / 扩展名小写，先预览（含冲突检测）后执行

二期（不在本期）：LibreOffice 引擎的 Office⇄PDF 高保真互转、OCR（PaddleOCR/tesseract）、抠图（rembg）、Excel 合并拆分与格式互转、剪贴板/截图等小工具。

## 2. 架构

electron-vite 标准三段式，关闭 nodeIntegration、保持上下文隔离：

- **main**（Node）：窗口创建 + 全部文件 IO 与文档处理。业务按工具拆分到 `src/main/services/`（pdfService / excelService / wordService / renameService / rangeUtils / fileUtils），`src/main/ipc/` 只做 IPC 注册与统一错误包装。
- **preload**：`contextBridge.exposeInMainWorld('api', …)` 暴露固定白名单，全部走 `ipcRenderer.invoke`。
- **renderer**：Vue3 + Element Plus + vue-router(hash)。图片压缩/水印在 renderer 用 Canvas 完成（避免 sharp 原生模块需要 MSVC 编译），main 只负责读文件/写文件。

### IPC 约定

- 通道按工具分组：`pdf:merge`、`pdf:split`、`pdf:rotate`、`word:fill-template`、`excel:fill-template`、`file:rename-plan`、`file:rename-apply`、`file:read-many`、`file:write-binary`、`dialog:pick-files`、`dialog:pick-directory`、`shell:open-path`。
- 统一返回 `{ ok: true, data } | { ok: false, error }`，wrapper 内 try/catch；renderer 侧 `call()` 帮助函数统一弹 ElMessage。
- 重命名/模板填充均为一次性批量任务（秒级），一期不做进度事件；图片处理循环在 renderer 内进行，有真实的进度条。
- 所有写盘目标目录由用户通过 dialog 指定；输出文件重名时自动追加 `(2)` 序号，不覆盖。

## 3. 数据流（各工具）

- PDF：用户选文件（dialog 返回路径）→ main 用 pdf-lib 处理 → 写入输出目录。
- 图片：main 读文件返回 base64 → renderer Canvas 解码/缩放/水印/编码 → base64 回传 main 写盘。JPEG 输出先铺白底防黑底；png 不支持质量参数。
- 模板填充：数据文件（xlsx 第 1 行为字段名，或 json 数组）→ 每行一条记录生成一份文件，文件名模式如 `通知书_{姓名}`，占位符 `{字段}` 未匹配时保留原样（Excel）/报错列出缺失字段（Word）。
- 重命名：main 列目录过滤扩展名 → 纯函数 `buildRenamePlan` 生成计划（含冲突检测：重名目标、与现有文件冲突、无变化）→ 预览表格 → 用户确认后按计划 rename。

## 4. 关键取舍（记录理由）

| 决策 | 理由 |
|---|---|
| 图片处理用 Canvas 而非 sharp | 用户机器无 MSVC 构建工具，原生模块编译易翻车；Canvas 零依赖 |
| docxtemplater 而非 docx 库排版 | 模板即 Word 文件本身，写 `{占位符}` 即可，维护成本低 |
| exceljs | 纯 JS、保留样式、支持 xlsx 读写（不支持 xls，UI 上过滤） |
| pdf-lib | 纯 JS；加密 PDF 一期明确不支持（isEncrypted → 报错提示先解密） |
| vue-router hash 模式 | 生产环境 file:// 协议下必须 |
| Element Plus 全量引入 | 牺牲包体积换配置简单、避免按需插件踩坑 |

## 5. 测试与验收

- vitest 覆盖 main 内纯函数：`parseRanges`（页码解析）、`buildRenamePlan`（重命名规则与冲突）。
- `npm run typecheck`（vue-tsc）+ `npm run build`（electron-vite build）必须通过。
- 冒烟：`npm run dev` 拉起窗口，四个工具页可导航、可执行真实操作。
- 打包：electron-builder NSIS 配置就绪（国内镜像），能出安装包即为加分项。

## 6. 目录结构

```
freeTool/
├─ docs/superpowers/specs/          本文档
├─ src/shared/types.ts              前后端共享类型
├─ src/main/  index.ts, ipc/{wrapper,system,pdf,office,rename}.ts, services/{pdf,excel,word,rename,fileUtils,rangeUtils}.ts
├─ src/preload/ index.ts, index.d.ts
├─ src/renderer/ index.html, src/{main.ts, App.vue, router/, styles/, utils/, components/, views/}
├─ tests/  rangeUtils.test.ts, renameService.test.ts
└─ .npmrc  electron/electron-builder 国内镜像
```
