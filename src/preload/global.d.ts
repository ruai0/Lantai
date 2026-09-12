import type {
  ApiResult,
  DataPreview,
  DuplicateExportParams,
  DuplicateFindParams,
  DuplicateResult,
  ExcelCsvParams,
  ExcelCompareParams,
  ExcelCompareResult,
  ExcelMaskParams,
  ExcelMatchFillParams,
  ExcelMatchFillResult,
  ExcelMergeParams,
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
  PdfDeletePagesParams,
  PdfBuildParams,
  PdfImagesParams,
  PdfMergeParams,
  PdfOrganizeParams,
  PdfPageNumberParams,
  PdfPagesInfoParams,
  PdfPagesInfoResult,
  PdfResult,
  PdfRotateParams,
  PdfSplitParams,
  PdfStampParams,
  PdfWatermarkParams,
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

export interface LantaiApi {
  /** 拖拽的 File → 绝对路径（同步，webUtils） */
  getPathForFile(file: File): string
  pickFiles(p?: PickFilesParams): Promise<ApiResult<string[]>>
  pickDirectory(title?: string): Promise<ApiResult<string | null>>
  readFiles(paths: string[]): Promise<ApiResult<PickedFile[]>>
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
  pdfOrganize(p: PdfOrganizeParams): Promise<ApiResult<PdfResult>>
  pdfBuildFromImages(p: PdfBuildParams): Promise<ApiResult<PdfResult>>
  excelMerge(p: ExcelMergeParams): Promise<ApiResult<PdfResult>>
  excelSplitSheets(p: ExcelSplitSheetParams): Promise<ApiResult<PdfResult>>
  excelSplitRows(p: ExcelSplitRowsParams): Promise<ApiResult<PdfResult>>
  excelSplitColumn(p: ExcelSplitColumnParams): Promise<ApiResult<{ outputs: string[]; groups: number }>>
  excelCsvToXlsx(p: ExcelCsvParams): Promise<ApiResult<PdfResult>>
  excelMask(p: ExcelMaskParams): Promise<ApiResult<{ outputs: string[]; previews: MaskPreview[] }>>
  excelReadHeaders(p: { path: string }): Promise<ApiResult<{ headers: string[] }>>
  excelMatchFill(p: ExcelMatchFillParams): Promise<ApiResult<ExcelMatchFillResult>>
  excelCompare(p: ExcelCompareParams): Promise<ApiResult<ExcelCompareResult>>
  officeToPdf(p: OfficeToPdfParams): Promise<ApiResult<OfficeToPdfResult>>
  fileInventory(p: InventoryParams): Promise<ApiResult<InventoryResult>>
  findDuplicates(p: DuplicateFindParams): Promise<ApiResult<DuplicateResult>>
  exportDuplicates(p: DuplicateExportParams): Promise<ApiResult<{ outputPath: string }>>
  zipPack(p: ZipPackParams): Promise<ApiResult<{ outputPath: string; count: number }>>
  zipUnpack(p: ZipUnpackParams): Promise<ApiResult<ZipUnpackResult>>
  fileSizes(paths: string[]): Promise<ApiResult<Array<{ path: string; sizeBytes: number }>>>
  replaceText(p: ReplaceTextParams): Promise<ApiResult<ReplaceTextResult>>
  extractContacts(p: ExtractContactParams): Promise<ApiResult<ExtractContactResult>>
  allRecords(p: { dataPath: string }): Promise<ApiResult<RecordsResult>>
  fillWord(p: FillTemplateParams): Promise<ApiResult<PdfResult>>
  fillExcel(p: FillTemplateParams): Promise<ApiResult<PdfResult>>
  scanTemplate(p: TemplateScanParams): Promise<ApiResult<{ fields: string[] }>>
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
  notify(p: { title: string; body: string }): Promise<ApiResult<boolean>>
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
  expandPaths(p: { paths: string[]; exts?: string[]; max?: number }): Promise<ApiResult<ExpandPathsResult>>
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
  /** 订阅更新状态推送；返回取消订阅函数 */
  onUpdateState(cb: (state: UpdateState) => void): () => void
}

declare global {
  interface Window {
    api: LantaiApi
  }
}

export {}
