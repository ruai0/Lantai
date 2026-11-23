import type {
  ApiResult,
  DataPreview,
  DuplicateExportParams,
  DuplicateResolveParams,
  DuplicateFindParams,
  DuplicateResult,
  ExcelCompareParams,
  ExcelCompareResult,
  ExcelCondFormatParams,
  ExcelCondFormatResult,
  ExcelCsvParams,
  ExcelGroupParams,
  ExcelGroupResult,
  ExcelMaskParams,
  ExcelMatchFillParams,
  ExcelMatchFillResult,
  ExcelMergeParams,
  ExcelSortDedupeParams,
  ExcelSortDedupeResult,
  ExcelSplitColumnParams,
  ExcelSplitRowsParams,
  ExcelSplitSheetParams,
  ExtractContactParams,
  ExtractContactResult,
  FillTemplateParams,
  HashAlgorithm,
  HashParams,
  HashResult,
  InventoryParams,
  InventoryResult,
  MaskPreview,
  OfficeToPdfParams,
  OfficeToPdfResult,
  OrganizeApplyParams,
  OrganizePair,
  OrganizePlanParams,
  PdfBatchParams,
  PdfBatchResult,
  PdfCheckEncryptedParams,
  PdfCheckEncryptedResult,
  PdfDeletePagesParams,
  PdfBuildParams,
  PdfExtractImagesParams,
  PdfExtractImagesResult,
  PdfHeaderFooterParams,
  PdfImagesParams,
  PdfMergeParams,
  PdfMetaInfo,
  PdfOrganizeParams,
  PdfPageNumberParams,
  PdfPagesInfoParams,
  PdfPagesInfoResult,
  PdfReadMetaParams,
  PdfResizeParams,
  PdfResult,
  PdfRotateParams,
  PdfSplitParams,
  PdfStampParams,
  PdfWatermarkParams,
  PdfWriteMetaParams,
  PickFilesParams,
  PickedFile,
  RecordsResult,
  RenameApplyParams,
  RenamePair,
  RenamePlanParams,
  ReplaceTextParams,
  ReplaceTextResult,
  TemplateScanParams,
  ZipPackParams,
  ZipUnpackParams,
  ZipUnpackResult
} from '../shared/types'
import type {
  EnvProbe,
  ExpandPathsResult,
  TaskSnapshot,
  UndoKind,
  UndoResult,
  UndoState,
  UpdateState
} from '../shared/types'
import type { AppSettings, HistoryEntry } from '../shared/settings'
import type { RememberedParams } from '../shared/params'
import type { LicenseStatus } from '../shared/license'
import type { WordFormatParams, WordFormatReport, WordScanItem } from '../shared/wordFormat'

export interface LantaiApi {
  /** 运行平台：win32 / linux / darwin */
  platform: string
  /** 拖拽的 File → 绝对路径（同步，webUtils） */
  getPathForFile(file: File): string
  pickFiles(p?: PickFilesParams): Promise<ApiResult<string[]>>
  pickDirectory(title?: string): Promise<ApiResult<string | null>>
  readFiles(paths: string[]): Promise<ApiResult<PickedFile[]>>
  /** 读单个文件的原始字节（渲染层 pdf.js 直接用，免去 base64 往返） */
  readBytes(p: { path: string }): Promise<ApiResult<Uint8Array>>
  writeBinary(p: { dir: string; name: string; base64: string }): Promise<ApiResult<{ path: string }>>
  openPath(target: string): Promise<ApiResult<boolean>>
  pdfMerge(p: PdfMergeParams): Promise<ApiResult<PdfResult>>
  pdfSplit(p: PdfSplitParams): Promise<ApiResult<PdfResult>>
  pdfRotate(p: PdfRotateParams): Promise<ApiResult<PdfResult>>
  pdfPageNumbers(p: PdfPageNumberParams): Promise<ApiResult<PdfResult>>
  pdfImagesToPdf(p: PdfImagesParams): Promise<ApiResult<PdfResult>>
  pdfWatermark(p: PdfWatermarkParams): Promise<ApiResult<PdfResult>>
  pdfStampImage(p: PdfStampParams): Promise<ApiResult<PdfResult>>
  pdfDeletePages(p: PdfDeletePagesParams): Promise<ApiResult<PdfResult>>
  pdfPagesInfo(p: PdfPagesInfoParams): Promise<ApiResult<PdfPagesInfoResult>>
  /** 检查 PDF 是否加密（导入时提前提示，不解密） */
  pdfCheckEncrypted(p: PdfCheckEncryptedParams): Promise<ApiResult<PdfCheckEncryptedResult>>
  pdfOrganize(p: PdfOrganizeParams): Promise<ApiResult<PdfResult>>
  /** 只预估不落盘：返回按当前页序/裁剪/标注导出后的字节数 */
  pdfOrganizeEstimate(p: PdfOrganizeParams): Promise<ApiResult<{ bytes: number; pages: number }>>
  /** 生成压缩用中间 PDF（系统临时目录），供渲染层栅格化后重建 */
  pdfOrganizeTemp(p: PdfOrganizeParams): Promise<ApiResult<{ path: string }>>
  /** 删除压缩流程的中间文件（仅限临时目录） */
  pdfRemoveTemp(p: { path: string }): Promise<ApiResult<boolean>>
  pdfBuildFromImages(p: PdfBuildParams): Promise<ApiResult<PdfResult>>
  pdfReadMeta(p: PdfReadMetaParams): Promise<ApiResult<PdfMetaInfo>>
  pdfWriteMeta(p: PdfWriteMetaParams): Promise<ApiResult<PdfResult>>
  pdfResize(p: PdfResizeParams): Promise<ApiResult<PdfResult>>
  pdfHeaderFooter(p: PdfHeaderFooterParams): Promise<ApiResult<PdfResult>>
  pdfExtractImages(p: PdfExtractImagesParams): Promise<ApiResult<PdfExtractImagesResult>>
  pdfBatch(p: PdfBatchParams): Promise<ApiResult<PdfBatchResult>>
  excelMerge(p: ExcelMergeParams): Promise<ApiResult<PdfResult>>
  excelSplitSheets(p: ExcelSplitSheetParams): Promise<ApiResult<PdfResult>>
  excelSplitRows(p: ExcelSplitRowsParams): Promise<ApiResult<PdfResult>>
  excelSplitColumn(p: ExcelSplitColumnParams): Promise<ApiResult<{ outputs: string[]; groups: number }>>
  excelCsvToXlsx(p: ExcelCsvParams): Promise<ApiResult<PdfResult>>
  excelMask(p: ExcelMaskParams): Promise<ApiResult<{ outputs: string[]; previews: MaskPreview[] }>>
  excelSortDedupe(p: ExcelSortDedupeParams): Promise<ApiResult<ExcelSortDedupeResult>>
  excelGroup(p: ExcelGroupParams): Promise<ApiResult<ExcelGroupResult>>
  excelCondFormat(p: ExcelCondFormatParams): Promise<ApiResult<ExcelCondFormatResult>>
  excelReadHeaders(p: { path: string; headerRow?: number; sheet?: string }): Promise<ApiResult<{ headers: string[] }>>
  excelListSheets(p: { path: string }): Promise<ApiResult<string[]>>
  excelMatchFill(p: ExcelMatchFillParams): Promise<ApiResult<ExcelMatchFillResult>>
  excelCompare(p: ExcelCompareParams): Promise<ApiResult<ExcelCompareResult>>
  officeToPdf(p: OfficeToPdfParams): Promise<ApiResult<OfficeToPdfResult>>
  fileInventory(p: InventoryParams): Promise<ApiResult<InventoryResult>>
  findDuplicates(p: DuplicateFindParams): Promise<ApiResult<DuplicateResult>>
  exportDuplicates(p: DuplicateExportParams): Promise<ApiResult<{ outputPath: string }>>
  resolveDuplicates(p: DuplicateResolveParams): Promise<ApiResult<{ moved: number; kept: number; failed: Array<{ name: string; reason: string }> }>>
  zipPack(p: ZipPackParams): Promise<ApiResult<{ outputPath: string; count: number }>>
  zipUnpack(p: ZipUnpackParams): Promise<ApiResult<ZipUnpackResult>>
  zipList(p: { dir?: string; paths?: string[] }): Promise<ApiResult<{ files: Array<{ rel: string; sizeBytes: number }>; totalBytes: number }>>
  fileSizes(paths: string[]): Promise<ApiResult<Array<{ path: string; sizeBytes: number }>>>
  replaceText(p: ReplaceTextParams): Promise<ApiResult<ReplaceTextResult>>
  extractContacts(p: ExtractContactParams): Promise<ApiResult<ExtractContactResult>>
  allRecords(p: { dataPath: string }): Promise<ApiResult<RecordsResult>>
  fillWord(p: FillTemplateParams): Promise<ApiResult<PdfResult>>
  formatWord(p: WordFormatParams): Promise<ApiResult<WordFormatReport>>
  scanWordFormat(p: { paths: string[] }): Promise<ApiResult<WordScanItem[]>>
  fillExcel(p: FillTemplateParams): Promise<ApiResult<PdfResult>>
  fillPptx(p: FillTemplateParams): Promise<ApiResult<{ outputs: string[] }>>
  scanTemplate(p: TemplateScanParams): Promise<ApiResult<{ fields: string[]; risky?: string[] }>>
  previewData(p: { dataPath: string }): Promise<ApiResult<DataPreview>>
  renamePlan(p: RenamePlanParams): Promise<ApiResult<{ plan: RenamePair[] }>>
  renameApply(p: RenameApplyParams): Promise<ApiResult<{ count: number; undoable: number }>>
  organizePlan(p: OrganizePlanParams): Promise<ApiResult<{ plan: OrganizePair[] }>>
  organizeApply(p: OrganizeApplyParams): Promise<ApiResult<{ count: number; undoable: number }>>
  hashFiles(p: HashParams): Promise<ApiResult<HashResult[]>>
  getSettings(): Promise<ApiResult<AppSettings>>
  setSettings(patch: Partial<AppSettings>): Promise<ApiResult<AppSettings>>
  getVersion(): Promise<ApiResult<string>>
  getHistory(): Promise<ApiResult<HistoryEntry[]>>
  addHistory(entry: HistoryEntry): Promise<ApiResult<HistoryEntry[]>>
  clearHistory(): Promise<ApiResult<HistoryEntry[]>>
  /** 工具参数记忆：读取全部 / 写入某视图 / 清空 */
  getParams(): Promise<ApiResult<RememberedParams>>
  setViewParams(p: { view: string; patch: Record<string, unknown> }): Promise<ApiResult<RememberedParams>>
  clearParams(): Promise<ApiResult<RememberedParams>>
  notify(p: { title: string; body: string }): Promise<ApiResult<boolean>>
  /** 资源管理器右键菜单：查询 / 安装 / 卸载 */
  shellMenuStatus(): Promise<ApiResult<{ supported: boolean; installed: boolean; reason?: string }>>
  shellMenuInstall(): Promise<ApiResult<{ supported: boolean; installed: boolean; reason?: string }>>
  shellMenuUninstall(): Promise<ApiResult<{ supported: boolean; installed: boolean; reason?: string }>>
  /** 取走右键菜单唤起的意图（文件 + 动作），取一次即清空 */
  takeShellIntent(): Promise<ApiResult<{ action: string; files: string[] } | null>>
  onShellIntent(cb: (p: { action: string; files: string[] }) => void): () => void
  /** 用系统默认浏览器打开 http(s) 链接 */
  openExternal(url: string): Promise<ApiResult<boolean>>
  /** 开/关 DevTools（独立窗口），返回操作后的开启状态 */
  toggleDevtools(): Promise<ApiResult<boolean>>
  /** 调试面板：原始设置 / 历史尾 / 主日志尾巴 */
  devInfo(): Promise<ApiResult<Record<string, string | number>>>
  openUserData(): Promise<ApiResult<boolean>>
  relaunchApp(): Promise<ApiResult<boolean>>
  resetSettings(): Promise<ApiResult<boolean>>
  /** 关闭询问对话框的选择结果回传 */
  applyCloseChoice(p: { action: 'tray' | 'quit' }): Promise<ApiResult<boolean>>
  /** 渲染层错误上报主日志 */
  logError(p: { where: string; message: string }): Promise<ApiResult<boolean>>
  /** 订阅「用户点了关闭按钮且设置为询问」事件；返回取消订阅 */
  onWindowCloseRequest(cb: () => void): () => void
  diagnostics(): Promise<ApiResult<Record<string, string | number>>>
  probe(p?: { force?: boolean }): Promise<ApiResult<EnvProbe>>
  expandPaths(p: { paths: string[]; exts?: string[]; max?: number; recursive?: boolean }): Promise<ApiResult<ExpandPathsResult>>
  undoLast(p: { kind: UndoKind }): Promise<ApiResult<UndoResult>>
  undoState(): Promise<ApiResult<Record<UndoKind, UndoState | null>>>
  /** 订阅主进程任务进度推送；返回取消订阅函数 */
  onTaskUpdate(cb: (list: TaskSnapshot[]) => void): () => void
  /** 请求取消主进程任务（当前文件处理完后停止） */
  taskCancel(p: { id: number }): Promise<ApiResult<boolean>>
  taskList(): Promise<ApiResult<TaskSnapshot[]>>
  updateCheck(): Promise<ApiResult<UpdateState>>
  updateInstall(): Promise<ApiResult<boolean>>
  updateState(): Promise<ApiResult<UpdateState>>
  /** 单位授权：查询状态 / 注册授权码 / 解除授权 */
  licenseStatus(): Promise<ApiResult<LicenseStatus>>
  licenseActivate(code: string): Promise<ApiResult<LicenseStatus>>
  licenseDeactivate(): Promise<ApiResult<LicenseStatus>>
  /** 订阅更新状态推送；返回取消订阅函数 */
  onUpdateState(cb: (state: UpdateState) => void): () => void
}

declare global {
  interface Window {
    api: LantaiApi
  }
}

export {}
