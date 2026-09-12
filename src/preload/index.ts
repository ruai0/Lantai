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
  clearHistory: () => invoke('history:clear'),
  notify: (p: unknown) => invoke('app:notify', p),
  openExternal: (url: string) => invoke('shell:open-external', url),
  toggleDevtools: () => invoke('app:toggle-devtools'),
  devInfo: () => invoke('app:devinfo'),
  openUserData: () => invoke('app:open-userdata'),
  relaunchApp: () => invoke('app:relaunch'),
  resetSettings: () => invoke('app:reset-settings'),
  /** 关闭询问：渲染层弹选择框，用户点完把结果送回主进程执行 */
  applyCloseChoice: (p: unknown) => invoke('app:apply-close-choice', p),
  onWindowCloseRequest: (cb: () => void): (() => void) => {
    const listener = (): void => cb()
    ipcRenderer.on('app:close-request', listener)
    return () => ipcRenderer.removeListener('app:close-request', listener)
  },
  diagnostics: () => invoke('app:diagnostics'),
  probe: (p?: unknown) => invoke('app:probe', p),
  expandPaths: (p: unknown) => invoke('file:expand-paths', p),
  undoLast: (p: unknown) => invoke('file:undo-last', p),
  undoState: () => invoke('file:undo-state'),
  /** 订阅主进程任务进度；返回取消订阅函数（contextBridge 支持传函数回调） */
  onTaskUpdate: (cb: (list: unknown[]) => void): (() => void) => {
    const listener = (_e: unknown, list: unknown[]): void => cb(list)
    ipcRenderer.on('task:update', listener)
    return () => ipcRenderer.removeListener('task:update', listener)
  },
  updateCheck: () => invoke('update:check'),
  updateInstall: () => invoke('update:install'),
  updateState: () => invoke('update:state'),
  /** 订阅更新状态推送；返回取消订阅函数 */
  onUpdateState: (cb: (state: unknown) => void): (() => void) => {
    const listener = (_e: unknown, s: unknown): void => cb(s)
    ipcRenderer.on('update:state', listener)
    return () => ipcRenderer.removeListener('update:state', listener)
  }
}

contextBridge.exposeInMainWorld('api', api)

export type LantaiApi = typeof api
