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
}

export interface PdfSplitParams {
  path: string
  mode: PdfSplitMode
  /** extract 模式使用，如 "1-3,5,8-" */
  ranges?: string
  /** everyN 模式使用，每个文件包含的页数 */
  everyN?: number
  outDir: string
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
  position: 'bottom-center' | 'bottom-right' | 'top-right'
  /** 第一个页码的数字 */
  startAt: number
  /** 从第几页开始标注（1-based） */
  fromPage?: number
}

export interface PdfResult {
  outputs: string[]
}

/* ---------- PDF 增强 ---------- */

export interface PdfImagesParams {
  /** 图片路径，按选择顺序每张一页 */
  paths: string[]
  outDir: string
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
  kind: 'word' | 'excel'
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
  /** 要脱敏的列名（首行表头） */
  columns: string[]
  rule: MaskRule
  /** custom 规则：保留前 n 位 */
  keepHead?: number
  /** custom 规则：保留后 n 位 */
  keepTail?: number
  outDir: string
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
  counts: Array<{ name: string; count: number }>
}

/* ---------- Excel 按列值拆分 ---------- */

export interface ExcelSplitColumnParams {
  path: string
  /** 分组列名（首行表头），每个不同的值生成一个文件 */
  column: string
  outDir: string
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
  dir: string
  /** 生成的 zip 文件名，缺省用文件夹名 */
  zipName?: string
  outDir: string
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
  kinds: ExtractKind[]
  /** 是否按内容去重（默认去重） */
  dedupe: boolean
  outDir: string
}

export interface ExtractContactResult {
  counts: Array<{ kind: ExtractKind; label: string; count: number }>
  outputs: string[]
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
  outDir: string
}

export interface ExcelMatchFillResult {
  outputs: string[]
  total: number
  matched: number
  unmatched: number
}

export interface ExcelCompareParams {
  aPath: string
  aKey: string
  bPath: string
  bKey: string
  /** 要比较的列（两表共有列名）；空 = 全部共有列 */
  columns?: string[]
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
}

/* ---------- PDF 页面整理 ---------- */

export interface PdfPagesInfoParams {
  paths: string[]
}

export interface PdfPagesInfoResult {
  pages: Array<{ path: string; count: number }>
}

export interface PdfOrganizePage {
  /** 源文件在 paths 中的下标 */
  source: number
  /** 源文件内 0-based 页码 */
  page: number
}

export interface PdfOrganizeParams {
  paths: string[]
  /** 输出页顺序，可跨文件混合 */
  order: PdfOrganizePage[]
  outDir: string
}

/** 由已渲染好的 JPEG/PNG 字节重建 PDF（PDF 压缩在渲染进程栅格化后调用） */
export interface PdfBuildParams {
  /** 每页一张图的 base64（jpg 或 png） */
  imagesBase64: string[]
  outDir: string
  /** 输出文件名主干，缺省用「压缩重建」 */
  nameHint?: string
}
