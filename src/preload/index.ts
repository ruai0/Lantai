import { contextBridge, ipcRenderer, webUtils } from 'electron'
import { plain } from '../shared/serialize'

/** 统一入口：把 Vue 的 Proxy/ref 转成可结构化克隆的纯数据 */
const invoke = (channel: string, ...args: unknown[]): Promise<unknown> =>
  ipcRenderer.invoke(channel, ...args.map(a => plain(a)))

const api = {
  /** 拖拽进来的 File → 真实路径（Electron 32+ 移除了 File.path，必须走 webUtils） */
  getPathForFile: (file: File): string => webUtils.getPathForFile(file),
  pickFiles: (p?: unknown) => invoke('dialog:pick-files', p),
  pickDirectory: (title?: string) => invoke('dialog:pick-directory', title),
  readFiles: (paths: string[]) => invoke('file:read-many', paths),
  writeBinary: (p: unknown) => invoke('file:write-binary', p),
  openPath: (target: string) => invoke('shell:open-path', target),
  pdfMerge: (p: unknown) => invoke('pdf:merge', p),
  pdfSplit: (p: unknown) => invoke('pdf:split', p),
  pdfRotate: (p: unknown) => invoke('pdf:rotate', p),
  pdfPageNumbers: (p: unknown) => invoke('pdf:add-page-numbers', p),
  pdfImagesToPdf: (p: unknown) => invoke('pdf:images-to-pdf', p),
  pdfWatermark: (p: unknown) => invoke('pdf:watermark', p),
  pdfStampImage: (p: unknown) => invoke('pdf:stamp-image', p),
  pdfDeletePages: (p: unknown) => invoke('pdf:delete-pages', p),
  pdfPagesInfo: (p: unknown) => invoke('pdf:pages-info', p),
  pdfOrganize: (p: unknown) => invoke('pdf:organize', p),
  pdfBuildFromImages: (p: unknown) => invoke('pdf:build-from-images', p),
  excelMerge: (p: unknown) => invoke('excel:merge', p),
  excelSplitSheets: (p: unknown) => invoke('excel:split-sheets', p),
  excelSplitRows: (p: unknown) => invoke('excel:split-rows', p),
  excelSplitColumn: (p: unknown) => invoke('excel:split-column', p),
  excelCsvToXlsx: (p: unknown) => invoke('excel:csv-to-xlsx', p),
  excelMask: (p: unknown) => invoke('excel:mask', p),
  excelReadHeaders: (p: unknown) => invoke('excel:read-headers', p),
  excelMatchFill: (p: unknown) => invoke('excel:match-fill', p),
  excelCompare: (p: unknown) => invoke('excel:compare', p),
  officeToPdf: (p: unknown) => invoke('office:to-pdf', p),
  fileInventory: (p: unknown) => invoke('file:inventory', p),
  findDuplicates: (p: unknown) => invoke('file:find-duplicates', p),
  exportDuplicates: (p: unknown) => invoke('file:export-duplicates', p),
  zipPack: (p: unknown) => invoke('zip:pack', p),
  zipUnpack: (p: unknown) => invoke('zip:unpack', p),
  fileSizes: (paths: string[]) => invoke('file:sizes', paths),
  replaceText: (p: unknown) => invoke('replace:run', p),
  extractContacts: (p: unknown) => invoke('text:extract', p),
  allRecords: (p: unknown) => invoke('data:all-records', p),
  fillWord: (p: unknown) => invoke('word:fill-template', p),
  fillExcel: (p: unknown) => invoke('excel:fill-template', p),
  scanTemplate: (p: unknown) => invoke('template:scan', p),
  previewData: (p: unknown) => invoke('data:preview', p),
  renamePlan: (p: unknown) => invoke('file:rename-plan', p),
  renameApply: (p: unknown) => invoke('file:rename-apply', p),
  organizePlan: (p: unknown) => invoke('file:organize-plan', p),
  organizeApply: (p: unknown) => invoke('file:organize-apply', p),
  hashFiles: (p: unknown) => invoke('file:hash', p),
  getSettings: () => invoke('settings:get'),
  setSettings: (patch: unknown) => invoke('settings:set', patch),
  getVersion: () => invoke('settings:version'),
  getHistory: () => invoke('history:get'),
  addHistory: (entry: unknown) => invoke('history:add', entry),
  clearHistory: () => invoke('history:clear')
}

contextBridge.exposeInMainWorld('api', api)

export type FreeToolApi = typeof api
