# FreeTool 办公工具箱

桌面级办公工具箱（Windows / Electron + Vue3 + TypeScript + Element Plus）。全部功能**离线本地处理**，文件不出电脑。

## 功能（v0.5）

| 工具 | 能力 |
|---|---|
| PDF 工具 | 合并、拆分（提取页码 / 逐页 / 按 N 页分卷）、删除指定页、旋转（可指定页码）、添加页码、**文字水印**（中文、平铺/居中、透明度、角度、颜色）、**图片盖章**（电子签章，九宫格位置 + 缩放 + 透明度，可指定页）、**图片合成 PDF**（多图按顺序每张一页）、**PDF 转图片**（1x/2x/3x 导出 PNG）、**提取文字**（转 TXT，扫描件除外）、**PDF 压缩**（按 120/150/200dpi + 质量重建，显示前后体积）、**页面整理**（跨文件缩略图重排 / 删页，重组成新 PDF） |
| Excel 工具 | **多簿合并**（每簿一表 / 按表头对齐合并成一张表）、**按工作表拆分**、**按行数拆分**（自动带表头）、**按列值拆分**（按单位/月份把一张表拆成 N 个文件）、**CSV→Excel**（UTF-8 / GBK 双编码，保留前导零）、**数据脱敏**（手机号 / 证件号 / 姓名 / 自定义保留位数，输出前给出抽样预览） |
| 表格匹配 / 比对 | **跨表匹配填充**（VLOOKUP 替代：主表按关联列从副表批量取列，未匹配可填指定文本，输出仍保留主表格式）、**两表差异比对**（按关联列比对两版名单，导出「删除 / 新增 / 变更明细 / 一致计数」四段式 Excel 报告） |
| Office 转 PDF | 批量把 Word / Excel / PPT 转成 PDF，调用本机已装的 **Microsoft Office 或 WPS**（自动探测），逐文件报告成功 / 失败原因 |
| 批量查找替换 | 多个 **Word（docx）/ Excel（xlsx）** 一次替换同名文字（公司更名、日期更新、术语统一），逐文件统计替换次数，输出新文件 |
| 图片工具 | 批量压缩（JPG/PNG/WebP + 质量滑块）、按最长边缩放、旋转 / 水平翻转、文字/图片水印（可平铺）、**长图拼接**（纵向/横向、间距、背景色）、**证件照排版**（一寸/二寸/护照等尺寸按 300dpi 排满 6寸/5寸/A4 相纸，可画裁切线）、实时进度 |
| 文档模板填充 | Word（docx）与 Excel（xlsx）模板写 `{字段}` 占位符，自动扫描模板占位符、数据预览前 5 行；数据源 xlsx（首行表头）或 json 数组；文件名模式如 `通知书_{姓名}` |
| 批量重命名 / 归类 | 查找替换、前后缀、序号、扩展名小写，冲突检测后执行；按扩展名 / 修改年月 / 年份归类到子文件夹 |
| 文件管理 | **文件清单导出 Excel**（文件名 / 类型 / 大小 / 修改时间 / 相对路径，可含子文件夹，适合送审清单）、**重复文件查找**（按内容 MD5 判断，可导出 Excel 报告，不自动删除）、**ZIP 打包 / 批量解压**（每个包解到独立文件夹，重名不覆盖） |
| 常用小工具 | JSON 格式化/压缩、Base64 / URL 编解码（UTF-8 安全）、时间戳⇄日期、UUID 批量生成、文件哈希（MD5/SHA-1/SHA-256）、二维码生成并保存 PNG、**批量提取联系方式**（从 txt/csv/xlsx/docx 提取手机号 / 身份证号 / 邮箱，去重导出 TXT）、**批量二维码**（从 Excel/JSON 数据按行生成 PNG，可按 `{列名}` 命名文件）、**识别二维码**（从图片还原内容，是链接可一键打开）、**名单加拼音**（Excel/JSON 姓名列批量生成拼音，可选声调样式与首字母，导出 CSV）、**文本对比**（两版文字逐行比对，新增/删除/变更/未变四色统一视图，支持从文件载入含 GBK 自动识别） |

## 界面设计

v0.5 起采用「**精密仪器面板**」设计语言：墨蓝操作台侧栏 + 琥珀信号色，替代 Element Plus 默认蓝。

- 唯一样式入口是 `src/renderer/src/styles/app.css`：顶部是设计令牌（`--rail-*` 墨蓝、`--paper/--surface` 纸面、`--accent/--amber` 信号色、`--font-display/body/mono`），随后接管 Element Plus 的 CSS 变量，因此按钮、标签页、表格、滑块、开关等组件会自动跟随主题，**无需改动各功能页**。
- 字体：标题与技术编号用 Windows 自带的 `Bahnschrift`（DIN 风格窄体，离线可用），正文保留 `Microsoft YaHei / PingFang SC` 保证中文可读性，文件名与数值用等宽 `Cascadia Mono / Consolas`。
- 功能页共用的类名（`step-card`、`step-no`、`file-list`、`tool-grid`、`form-row` 等）保持不变，新增页面沿用即可自动获得同一套观感。
- 已适配 `prefers-reduced-motion`，窄屏下隐藏横幅仪表装饰并收紧留白。

## 开发

```bash
npm install      # 已配置国内镜像（.npmrc）
npm run dev      # 开发模式（热更新）
npm run build    # 构建到 out/
npm run typecheck
npm run test     # vitest 单测 + 临时目录集成冒烟测试
npm run dist     # 打包 Windows NSIS 安装包 + 便携版到 release/
```

> 前提：Node ≥ 18 且 `node` 在 PATH 中。若 npm 报「'node' 不是内部或外部命令」，确认 node.exe 所在目录（如 `J:\node_js`）已加入系统 PATH。

## 架构

```
src/
├─ shared/             types.ts 三端共享类型（IPC 统一返回 { ok, data | error }）；namePattern.ts 文件名共用工具；textDiff.ts 文本逐行差异（前后缀剥离 + LCS + 删增配对）
├─ main/               主进程：ipc/ 薄注册层 + services/ 业务
│   ├─ pdfService          pdf-lib（水印中文用系统字体 simhei/deng 等经 fontkit 嵌入）
│   ├─ excelToolsService   exceljs + iconv-lite（GBK）：合并/拆分/脱敏/CSV
│   ├─ excelMatchService   跨表匹配填充（VLOOKUP 替代）+ 两表差异比对
│   ├─ replaceService      docx XML 节点替换 + xlsx 单元格批量查找替换
│   ├─ officeToPdfService  PowerShell COM 自动化（Word/Excel/PPT × MS Office/WPS）
│   ├─ inventoryService    文件清单与重复文件（exceljs 报告导出）
│   ├─ zipService          PizZip 打包 / 批量解压
│   └─ extractService      txt/csv/xlsx/docx 提取手机号/身份证/邮箱
├─ preload/            contextBridge 白名单（global.d.ts 提供 window.api 类型）
└─ renderer/           Vue3 + Element Plus；图片处理/长图拼接/证件照排版用 Canvas，PDF 转图片·提取文字·压缩缩略图用 pdfjs-dist，二维码用 qrcode、识别用 jsqr、拼音用 pinyin-pro
```

- IPC 通道按工具分组（`pdf:merge`、`excel:mask`、`excel:match-fill`、`excel:compare`、`office:to-pdf`、`file:find-duplicates`、`zip:pack`、`text:extract`…），业务异常在 main 统一包装为 `{ ok:false, error }`。
- 输出文件重名自动追加 `(2)`，绝不覆盖。
- 测试：vitest 覆盖 main 内纯函数（页码解析、重命名计划、脱敏、CSV 解析、重复分组、联系方式提取、Word XML 替换、关联键归一）+ 临时目录集成冒烟（真实 xlsx/PDF/zip 读写往返，含匹配填充、差异比对、页面整理、图片重建 PDF）。

## 已知限制（v0.5）

- 加密 PDF 不支持（会提示先解密）；Office 转 PDF 需要本机装有 MS Office 或 WPS。
- PDF 页码使用内置西文字体（数字与 `/`）；水印/盖章中文用系统黑体/等线等字体，系统缺字体时仅支持西文。
- PDF 压缩是「整页栅格化后重建」：对扫描/图片型 PDF 效果好，文字型 PDF 会被转成图片（文字不可再复制、放大打印发虚），故提供多档分辨率。
- Excel 合并/拆分保留单元格值，不保留公式、样式与合并单元格；跨表匹配填充会保留主表原格式并在末尾追加取来的列；比对/脱敏仅取第一个工作表；不支持 .xls 旧格式（Office 转 PDF 支持 .xls）。
- 批量查找替换在 Word 的文本节点内生效，被排版拆开的词（同一词分到多个 run）可能匹配不到，建议替换后抽查；docx 页眉页脚同样处理。
- 批量提取联系方式按正则识别（11 位 1[3-9] 开头、18 位身份证、邮箱），图片/扫描件内文字不在范围内。
- 二维码识别用 jsQR（单码、常规光照下效果好），严重模糊/倾斜/多码图可能识别失败。
- ZIP 打包生成的 zip 用 UTF-8 文件名，老版 WinRAR/XP 解压可能显示乱码（Windows 10+ 资源管理器正常）。
- 图片处理走 Canvas，超大图（>50MP）内存占用较高；avif 编码、HEIC 解码暂不支持。
- PDF 转图片/提取文字/压缩按整页逐页处理，数百页大文件耗时较长。

## 后续规划

剪贴板历史、取色器、PDF 加密/解密（需打包外部工具）。已明确不做：OCR 文字识别、抠图去背景（需引入模型、包体积与准确率不划算）。

## 设计文档

[docs/superpowers/specs/2026-09-07-freetool-design.md](docs/superpowers/specs/2026-09-07-freetool-design.md)
