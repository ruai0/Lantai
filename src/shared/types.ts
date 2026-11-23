/** main / preload / renderer 三端共享的类型定义 */

export interface ApiOk<T> {
  ok: true
  data: T
}
export interface ApiErr {
  ok: false
  error: string
}
export type ApiResult<T> = ApiOk<T> | ApiErr

export interface FileFilterDef {
  name: string
  extensions: string[]
}

export interface PickFilesParams {
  title?: string
  filters?: FileFilterDef[]
  multiple?: boolean
}

export interface PickedFile {
  path: string
  name: string
  base64: string
}

/* ---------- PDF ---------- */

export type PdfSplitMode = 'extract' | 'each' | 'everyN'

export interface PdfMergeParams {
  paths: string[]
  outDir: string
  /** 自定义输出文件名（可不带扩展名）；留空 = PDF合并_时间戳 */
  name?: string
}

export interface PdfSplitParams {
  path: string
  mode: PdfSplitMode
  /** extract 模式使用，如 "1-3,5,8-" */
  ranges?: string
  /** everyN 模式使用，每个文件包含的页数 */
  everyN?: number
  outDir: string
  /** everyN/extract 单文件输出时覆盖原文件（同名同目录，原文件保留为 .bak）；默认 false 另存 */
  overwrite?: boolean
}

export interface PdfRotateParams {
  path: string
  angle: 90 | 180 | 270
  /** 为空则旋转全部页 */
  ranges?: string
  outDir: string
}

export interface PdfPageNumberParams {
  path: string
  outDir: string
  position:
    | 'bottom-center'
    | 'bottom-right'
    | 'bottom-left'
    | 'top-right'
    | 'top-center'
    | 'top-left'
  /** 第一个页码的数字 */
  startAt: number
  /** 从第几页开始标注（1-based） */
  fromPage?: number
  /** 字号（pt），默认 9 */
  fontSize?: number
  /** 颜色 #rrggbb，默认灰 #595959 */
  color?: string
  /** 页码格式，支持 {n} {total} 占位符，默认 "{n} / {total}" */
  format?: string
  /** 距页边距离（pt），默认 20 */
  margin?: number
}

export interface PdfResult {
  outputs: string[]
}

/* ---------- PDF 增强 ---------- */

export interface PdfImagesParams {
  /** 图片路径，按选择顺序每张一页 */
  paths: string[]
  outDir: string
  /** 自定义输出文件名（可不带扩展名）；留空 = 图片转PDF_时间戳 */
  name?: string
  /** 页面适配：a4 = 等比缩放居中到 A4（默认，横图自动用横向页面）；none = 以图片像素作 pt（页面会非常大） */
  fit?: 'a4' | 'none'
}

export type WatermarkColor = 'gray' | 'red' | 'blue'

export interface PdfWatermarkParams {
  path: string
  text: string
  fontSize: number
  /** 0.05 ~ 1 */
  opacity: number
  /** 旋转角度（度，斜置常用 -45） */
  rotation: number
  /** true = 平铺满页；false = 页面居中单枚 */
  tile: boolean
  color: WatermarkColor
  outDir: string
}

export interface PdfDeletePagesParams {
  path: string
  /** 要删除的页码，如 "1-3,5" */
  ranges: string
  outDir: string
}

/** PDF 转图片在渲染进程用 pdfjs 完成，仅需渲染参数 */
export interface PdfToImagesParams {
  path: string
  /** 缩放倍数，2 ≈ 144dpi */
  scale: number
}

/* ---------- PDF 进阶：元数据 / 页面尺寸 / 页眉页脚 / 图片提取 / 批量 ---------- */

export interface PdfMetaInfo {
  path: string
  name: string
  pageCount: number
  sizeBytes: number
  title: string
  author: string
  subject: string
  keywords: string
  creator: string
  producer: string
  creationDate: string
  modificationDate: string
}

export interface PdfReadMetaParams {
  path: string
}

export interface PdfWriteMetaParams {
  paths: string[]
  outDir: string
  title: string
  author: string
  subject: string
  keywords: string
  /** true = 清空全部元数据（匿名化，用于报送前脱敏），忽略上方字段 */
  clear: boolean
}

export type PdfResizePreset = 'a4' | 'a3' | 'a5' | 'letter' | 'scale' | 'custom'

export interface PdfResizeParams {
  paths: string[]
  outDir: string
  preset: PdfResizePreset
  /** preset=custom：目标页宽（pt，1pt = 1/72 英寸） */
  width?: number
  /** preset=custom：目标页高（pt） */
  height?: number
  /** preset=scale：缩放倍数，1 = 原尺寸 */
  scale?: number
  /** 页面留白背景色（#rrggbb），默认白 */
  background?: string
  /** true = 等比缩放居中留白；false = 拉伸填满页面 */
  keepRatio: boolean
  /** auto = 沿用原页面方向 */
  orientation?: 'portrait' | 'landscape' | 'auto'
}

export interface PdfHeaderFooterParams {
  paths: string[]
  outDir: string
  /** 页眉文字，支持占位符 {页码} {总页数} {文件名} {日期} */
  header: string
  footer: string
  fontSize: number
  align: 'left' | 'center' | 'right'
  /** 距页面边缘的距离（pt） */
  margin: number
  /** 从第几页开始（1-based） */
  fromPage: number
  /** 文字颜色（#rrggbb），默认深灰 */
  color?: string
}

export interface PdfExtractImagesParams {
  path: string
  outDir: string
  /** 边长小于该像素的图片跳过（多为装饰性小图）；0 = 全部导出 */
  minSize?: number
}

export interface PdfExtractImagesResult {
  outputs: string[]
  /** 成功导出张数 */
  count: number
  /** 因格式不支持或过小而跳过的张数 */
  skipped: number
  pages: number
}

export type PdfBatchAction = 'watermark' | 'numbers' | 'headerFooter' | 'rotate' | 'stripMeta'

export interface PdfBatchParams {
  paths: string[]
  outDir: string
  action: PdfBatchAction
  /** watermark */
  watermarkText?: string
  watermarkFontSize?: number
  watermarkOpacity?: number
  watermarkRotation?: number
  watermarkTile?: boolean
  watermarkColor?: WatermarkColor
  /** numbers */
  startAt?: number
  position?: 'bottom-center' | 'bottom-right' | 'top-right'
  fromPage?: number
  /** headerFooter */
  header?: string
  footer?: string
  /** headerFooter 对齐方式 */
  align?: 'left' | 'center' | 'right'
  /** headerFooter 距页面边缘距离（pt） */
  margin?: number
  /** rotate */
  angle?: 90 | 180 | 270
  /** headerFooter / numbers 字号 */
  fontSize?: number
}

export interface PdfBatchResult {
  outputs: string[]
  failed: Array<{ name: string; reason: string }>
}

/* ---------- 模板填充（Word / Excel） ---------- */

export type DataRecord = Record<string, string>

export interface FillTemplateParams {
  templatePath: string
  dataPath: string
  /** 输出文件名模式，如 "通知书_{姓名}"，缺省为 模板名_序号 */
  namePattern?: string
  outDir: string
}

/* ---------- 批量重命名 ---------- */

export interface RenameRules {
  find?: string
  replace?: string
  prefix?: string
  suffix?: string
  extLower?: boolean
  sequence?: { start: number; step: number; digits: number } | null
}

export interface RenamePair {
  from: string
  to: string
  /** true 表示执行时会失败或产生冲突 */
  conflict: boolean
  /** unchanged 表示新旧名字相同，无需重命名 */
  unchanged: boolean
  reason?: string
}

export interface RenamePlanParams {
  dir: string
  /** 扩展名过滤（不带点，如 jpg）；空数组或缺省表示全部文件 */
  exts?: string[]
  rules: RenameRules
}

export interface RenameApplyParams {
  dir: string
  pairs: Array<{ from: string; to: string }>
}

/* ---------- 文件归类 ---------- */

export type OrganizeMode = 'ext' | 'month' | 'year'

export interface OrganizePlanParams {
  dir: string
  mode: OrganizeMode
}

export interface OrganizePair {
  from: string
  /** 含子文件夹的相对路径，如 "jpg/a.jpg" */
  to: string
  conflict: boolean
  reason?: string
}

export interface OrganizeApplyParams {
  dir: string
  pairs: Array<{ from: string; to: string }>
}

/* ---------- 模板扫描 / 数据预览 ---------- */

export interface TemplateScanParams {
  templatePath: string
  kind: 'word' | 'excel' | 'pptx'
}

export interface DataPreview {
  headers: string[]
  rows: string[][]
  total: number
}

/* ---------- 文件哈希 ---------- */

export type HashAlgorithm = 'md5' | 'sha1' | 'sha256'

export interface HashParams {
  paths: string[]
  algorithm: HashAlgorithm
}

export interface HashResult {
  path: string
  name: string
  hash: string
}

/* ---------- Excel 工具 ---------- */

export type ExcelMergeMode = 'sheets' | 'single'

export interface ExcelMergeParams {
  paths: string[]
  /** sheets = 每个文件一个工作表；single = 各文件第一个工作表纵向合并成一张表 */
  mode: ExcelMergeMode
  outDir: string
  /** 自定义输出文件名（可不带扩展名）；留空 = Excel合并_日期 */
  name?: string
  /** single 模式下表头所在行号（1-based，默认 1）；台账常在第 2、3 行 */
  headerRow?: number
}

export interface ExcelSplitSheetParams {
  path: string
  outDir: string
}

export interface ExcelSplitRowsParams {
  path: string
  /** 每个文件的数据行数（不含表头） */
  rowsPerFile: number
  outDir: string
  /** 要拆分的工作表名（留空 = 第一个工作表） */
  sheet?: string
  /** 表头所在行号（1-based，默认 1）；台账常在 2、3 行 */
  headerRow?: number
  /** 输出文件是否保留原工作表名（默认继承） */
  keepSheetName?: boolean
}

export interface ExcelCsvParams {
  paths: string[]
  /** csv 文件编码；运营商老系统导出常用 GBK */
  encoding: 'utf8' | 'gbk'
  outDir: string
}

export type MaskRule = 'phone' | 'idcard' | 'name' | 'custom'

export interface ExcelMaskParams {
  path: string
  /** 要脱敏的列名（表头行） */
  columns: string[]
  rule: MaskRule
  /** custom 规则：保留前 n 位 */
  keepHead?: number
  /** custom 规则：保留后 n 位 */
  keepTail?: number
  /** 掩码字符，默认 *（如用 ● 更醒目） */
  maskChar?: string
  outDir: string
  /** 要脱敏的工作表名（留空 = 第一个工作表） */
  sheet?: string
  /** 表头所在行号（1-based，默认 1） */
  headerRow?: number
}

/** 脱敏结果预览 */
export interface MaskPreview {
  column: string
  samples: Array<{ original: string; masked: string }>
}

/* ---------- Office → PDF ---------- */

export interface OfficeToPdfParams {
  paths: string[]
  outDir: string
}

export interface OfficeToPdfResult {
  outputs: string[]
  failed: Array<{ name: string; reason: string }>
}

/* ---------- 文件清单 / 重复文件 ---------- */

export interface InventoryParams {
  dir: string
  recursive: boolean
  outDir: string
  /** 自定义输出文件名（可不带扩展名）；留空 = 文件清单_日期 */
  name?: string
}

export interface InventoryResult {
  count: number
  outputPath: string
}

export interface DuplicateFile {
  path: string
  name: string
  sizeBytes: number
}

export interface DuplicateGroup {
  hash: string
  sizeBytes: number
  files: DuplicateFile[]
}

export interface DuplicateFindParams {
  dir: string
  recursive: boolean
  /** 只查找大于该体积（KB）的文件，默认 100KB */
  minSizeKB: number
}

export interface DuplicateResult {
  groups: DuplicateGroup[]
  scanned: number
}

export interface DuplicateExportParams {
  groups: DuplicateGroup[]
  outDir: string
  /** 自定义输出文件名（可不带扩展名）；留空 = 重复文件报告_日期 */
  name?: string
}

/** 重复文件处理：每组保留一份，其余移入 _重复文件 子目录（不删除） */
export interface DuplicateResolveParams {
  groups: DuplicateGroup[]
  /** earliest = 保留最早修改；latest = 保留最新；shortest = 保留路径最短 */
  keep: 'earliest' | 'latest' | 'shortest'
}

/* ---------- 文档批量查找替换 ---------- */

export interface ReplaceTextParams {
  /** .docx / .xlsx 文件，按扩展名分别处理 */
  paths: string[]
  find: string
  replace: string
  outDir: string
}

export interface ReplaceTextResult {
  outputs: string[]
  /** splitMisses = 疑似因排版拆开而漏替换的处数（>0 时前端提示用户复核） */
  counts: Array<{ name: string; count: number; splitMisses?: number }>
}

/* ---------- Excel 按列值拆分 ---------- */

export interface ExcelSplitColumnParams {
  path: string
  /** 分组列名（表头行），每个不同的值生成一个文件 */
  column: string
  outDir: string
  /** 要拆分的工作表名（留空 = 第一个工作表） */
  sheet?: string
  /** 表头所在行号（1-based，默认 1） */
  headerRow?: number
}

/* ---------- Excel 排序去重 ---------- */

/** 排序方向：升序（自然序）/ 降序 */
export type ExcelSortOrder = 'asc' | 'desc'

export interface ExcelSortDedupeParams {
  path: string
  outDir: string
  /** 排序键列名（表头行）；空数组 = 不排序，只去重 */
  sortColumns: string[]
  sortOrder: ExcelSortOrder
  /** 是否按 sortColumns 去重（留第一条） */
  dedupe: boolean
  /** 要处理的工作表名（留空 = 第一个工作表） */
  sheet?: string
  /** 表头所在行号（1-based，默认 1） */
  headerRow?: number
}

export interface ExcelSortDedupeResult {
  outputs: string[]
  /** 去重前的数据行数 */
  before: number
  /** 排序、去重后的数据行数 */
  after: number
  /** 被去掉的重复行数 */
  removed: number
}

/* ---------- Excel 分组汇总（透视的实用替身） ---------- */

export type ExcelAggregate =
  | 'count' // 计数
  | 'sum' // 求和
  | 'avg' // 平均
  | 'max' // 最大
  | 'min' // 最小

export interface ExcelGroupParams {
  path: string
  outDir: string
  /** 分组依据列名（表头行） */
  groupColumns: string[]
  /** 要汇总的数值列名（count 时可留空，表示只统计每组行数） */
  valueColumns: string[]
  /** 汇总方式 */
  aggregate: ExcelAggregate
  /** 要处理的工作表名（留空 = 第一个工作表） */
  sheet?: string
  /** 表头所在行号（1-based，默认 1） */
  headerRow?: number
}

export interface ExcelGroupResult {
  outputs: string[]
  /** 汇总表表头（分组列名 + 各汇总列名） */
  header: string[]
  /** 汇总结果的「组 × 列」数据行（前 8 行，供界面确认） */
  preview: string[][]
  groups: number
}

/* ---------- Excel 条件格式（标注重复 / 达标） ---------- */

export type ExcelCondRule = 'duplicate' | 'greater' | 'less' | 'between'

export interface ExcelCondFormatParams {
  path: string
  outDir: string
  /** 应用条件格式的列名（表头行） */
  columns: string[]
  rule: ExcelCondRule
  /** greater/less/between 的阈值（between 时用 value2） */
  value?: number
  value2?: number
  /** 填充色（十六进制，如 FFFF00），默认浅黄 */
  fill?: string
  /** 整行高亮（true）还是只高亮该列单元格（false） */
  wholeRow?: boolean
  /** 要处理的工作表名（留空 = 第一个工作表） */
  sheet?: string
  /** 表头所在行号（1-based，默认 1） */
  headerRow?: number
}

export interface ExcelCondFormatResult {
  outputs: string[]
  /** 被标记的单元格/行数 */
  matched: number
}

/* ---------- PDF 图片盖章 ---------- */

export type StampPosition = 'center' | 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right'

export interface PdfStampParams {
  path: string
  /** 盖章图片（PNG 带 transparent 声明效果最佳） */
  imagePath: string
  /** 图片宽度占页面宽度的百分比，默认 20 */
  scalePercent: number
  /** 0.1 ~ 1 */
  opacity: number
  position: StampPosition
  /** 应用页码，空 = 全部页 */
  ranges?: string
  outDir: string
}

/* ---------- ZIP 打包 / 解压 ---------- */

export interface ZipPackParams {
  /** 打整个文件夹（与 paths 二选一） */
  dir?: string
  /** 挑选若干文件打包（保留相对层级；与 dir 二选一） */
  paths?: string[]
  /** 生成的 zip 文件名，缺省用文件夹名 */
  zipName?: string
  outDir: string
  /** 压缩级别：store 仅打包最快，normal 默认，max 体积最小 */
  level?: 'store' | 'normal' | 'max'
}

export interface ZipUnpackParams {
  paths: string[]
  outDir: string
}

export interface ZipUnpackResult {
  /** 解压出的目标文件夹 */
  outputs: string[]
}

/* ---------- 批量提取联系方式 ---------- */

export type ExtractKind = 'phone' | 'idcard' | 'email'

export interface ExtractContactParams {
  paths: string[]
  /** 已在渲染进程抽取好的文本（如 PDF 文本层），与 paths 一起参与提取 */
  texts?: Array<{ name: string; text: string }>
  kinds: ExtractKind[]
  /** 是否按内容去重（默认去重） */
  dedupe: boolean
  outDir: string
  /** 输出文件名前缀（每类一个 txt：前缀_手机号.txt）；留空 = 手机号_N个.txt */
  name?: string
  /** 输出编码：内网台账常用 gbk；留空/utf8 为 UTF-8 */
  encoding?: 'utf8' | 'gbk'
}

export interface ExtractContactResult {
  counts: Array<{ kind: ExtractKind; label: string; count: number }>
  outputs: string[]
  /** 读取失败的文件（单个坏文件不影响其余） */
  failed?: Array<{ name: string; reason: string }>
}

/* ---------- 数据源全量记录（批量二维码等） ---------- */

export interface RecordsResult {
  records: DataRecord[]
}

/* ---------- Excel 跨表匹配填充 / 两表比对 ---------- */

export interface ExcelMatchFillParams {
  mainPath: string
  /** 主表的关联列名 */
  mainKey: string
  lookupPath: string
  /** 副表的关联列名 */
  lookupKey: string
  /** 副表中要取过来的列 */
  fetchColumns: string[]
  /** 主表匹配不到时填入的文本，默认留空 */
  notFoundText?: string
  /** 主表表头所在行号（1-based，默认 1）；台账常在第 2、3 行 */
  mainHeaderRow?: number
  /** 副表表头所在行号（1-based，默认 1） */
  lookupHeaderRow?: number
  /** 主表工作表名；留空 = 第一个工作表 */
  mainSheet?: string
  /** 副表工作表名；留空 = 第一个工作表 */
  lookupSheet?: string
  outDir: string
}

export interface ExcelMatchFillResult {
  outputs: string[]
  total: number
  matched: number
  unmatched: number
  /** 副表中出现多次的关联键（匹配时取首条，需提示复核） */
  dupKeys?: string[]
}

export interface ExcelCompareParams {
  aPath: string
  aKey: string
  bPath: string
  bKey: string
  /** 要比较的列（两表共有列名）；空 = 全部共有列 */
  columns?: string[]
  /** A 表表头所在行号（1-based，默认 1） */
  aHeaderRow?: number
  /** B 表表头所在行号（1-based，默认 1） */
  bHeaderRow?: number
  /** A 表工作表名；留空 = 第一个工作表 */
  aSheet?: string
  /** B 表工作表名；留空 = 第一个工作表 */
  bSheet?: string
  outDir: string
}

export interface ExcelCompareResult {
  outputPath: string
  /** 只在 A 表出现（B 中已删除） */
  onlyInA: number
  /** 只在 B 表出现（新增） */
  onlyInB: number
  /** 关联键相同但有列值变化 */
  changed: number
  same: number
  /** 存在重复的关联键（比对时取首条，结果可能不完整） */
  dupKeys?: string[]
  /** 因关联键重复而未参与比对的行数 */
  droppedRows?: number
}

/* ---------- PDF 页面整理 ---------- */

export interface PdfPagesInfoParams {
  paths: string[]
}

export interface PdfPagesInfoResult {
  pages: Array<{ path: string; count: number }>
}

/** 检查 PDF 是否加密（导入时提前提示用，不解密） */
export interface PdfCheckEncryptedParams {
  paths: string[]
}

export interface PdfCheckEncryptedResult {
  items: Array<{ path: string; encrypted: boolean }>
}

export interface PdfOrganizePage {
  /** 源文件在 paths 中的下标 */
  source: number
  /** 源文件内 0-based 页码 */
  page: number
  /** 该页额外旋转角度（度，90/180/270），缺省 0 */
  rotate?: number
  /**
   * 裁剪区域，取页面**渲染视图**的分数坐标（0~1，y 从页面顶部往下量）。
   * 用分数而非磅值：与渲染分辨率、设备像素比都无关，也不必读原页 MediaBox。
   * 仅在该页没有额外旋转时生效（旋转后的视图与页面坐标系不一致，硬裁会裁错位置）。
   */
  crop?: { x: number; y: number; w: number; h: number }
  /**
   * 本页的图片式标注（马赛克 / 涂抹 / 贴图），在大图预览里画好，导出时烧进页面。
   * 坐标一律为 **PDF 用户空间磅值**（渲染时由 pdf.js 视口换算，旋转页也准）。
   */
  annos?: PdfPageAnno[]
}

/** 涂抹：一条自由笔画（polyline），points 为 [x1,y1,x2,y2,...] 磅值；color 为 #rrggbb */
export interface PdfBrushAnno {
  kind: 'brush'
  color: string
  /** 笔宽，磅值 */
  width: number
  points: number[]
}

/** 马赛克：一个色块（平均色），x/y/w/h 为磅值矩形 */
export interface PdfMosaicAnno {
  kind: 'mosaic'
  /** RGB，0~1 */
  color: [number, number, number]
  x: number
  y: number
  w: number
  h: number
}

/** 贴图：一张 PNG（dataURL）按矩形盖在页面上，可调透明度 */
export interface PdfStickerAnno {
  kind: 'sticker'
  /** 会话内唯一 id，用于选中/拖动/删除；主进程忽略 */
  id: number
  /** PNG dataURL（渲染端统一转成 PNG，主进程直接 embedPng） */
  png: string
  x: number
  y: number
  w: number
  h: number
  /** 0~1 */
  opacity: number
}

export type PdfPageAnno = PdfBrushAnno | PdfMosaicAnno | PdfStickerAnno

export interface PdfOrganizeParams {
  paths: string[]
  /** 输出页顺序，可跨文件混合 */
  order: PdfOrganizePage[]
  /** 输出目录；预估体积 / 生成压缩中间文件时不需要 */
  outDir?: string
  /** 自定义输出文件名（可不带扩展名）；留空 = 页面整理_时间戳 */
  name?: string
}

/** 由已渲染好的 JPEG/PNG 字节重建 PDF（PDF 压缩在渲染进程栅格化后调用） */
export interface PdfBuildParams {
  /** 每页一张图的 base64（jpg 或 png） */
  imagesBase64: string[]
  outDir: string
  /** 输出文件名主干，缺省用「压缩重建」 */
  nameHint?: string
}

/* ---------- 平台层：任务队列 / 环境探测 / 文件夹展开 / 撤销 ---------- */

/** 主进程按文件循环的任务快照，经 task:update 推给渲染层 TaskDock；cancelled = 用户请求中断，在当前文件处理完后生效 */
export interface TaskSnapshot {
  id: number
  label: string
  done: number
  total: number
  state: 'running' | 'done' | 'error' | 'cancelled'
  /** 完成后可点开的产出路径（首项所在目录即输出文件夹）；用于任务坞里的"打开" */
  outputs?: string[]
}

/** 本机 Office/WPS 组件与中文字体探测结果 */
export interface EnvProbe {
  word: string
  excel: string
  ppt: string
  /** 命中的中文字体文件名（按水印优先级） */
  cjkFonts: string[]
  watermarkReady: boolean
  probedAt: number
}

/** 拖入路径混合展开的结果 */
export interface ExpandPathsResult {
  files: string[]
  /** 展开的目录数 */
  dirs: number
  /** 类型不符或不可访问而被丢弃的条目数 */
  rejected: number
  truncated: boolean
}

export type UndoKind = 'rename' | 'organize'

/** 某类操作最近一次可撤销的摘要 */
export interface UndoState {
  dir: string
  time: number
  count: number
}

export interface UndoResult {
  undone: number
  /** 执行后被用户挪走、无需还原的条目 */
  skipped: number
  failed: Array<{ path: string; reason: string }>
}

/** 自动更新状态（electron-updater 展平后的可序列化视图，主→渲染推送 update:state） */
export interface UpdateState {
  phase: 'idle' | 'checking' | 'not-available' | 'available' | 'downloading' | 'ready' | 'error'
  current: string
  /** 最新版本的版本号 */
  latest?: string
  /** 更新说明（latest.yml releaseNotes） */
  notes?: string
  /** downloading 阶段百分比 */
  percent?: number
  error?: string
}
