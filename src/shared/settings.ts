/** 应用偏好与使用历史（三端共享类型 + 默认值） */

export type OnComplete = 'notify' | 'openFolder' | 'openFile'
export type Theme = 'light' | 'dark' | 'system'

export interface AppSettings {
  /** 默认输出目录；各功能输出框为空时自动预填 */
  defaultOutDir: string
  /** 任务完成后的行为：仅提示 / 打开所在文件夹 / 打开输出文件 */
  onComplete: OnComplete
  theme: Theme
  /** 窗口不在前台时，任务完成弹系统通知 */
  notify: boolean
  /** 收藏的工具路由 path（首页置顶 + 侧栏收藏分组） */
  favorites: string[]
  /** 更新源地址（latest.yml 所在目录，http/https）；留空 = 使用内置官方源，填 off = 彻底禁用 */
  updateFeed: string
  /** 点关闭按钮时收进托盘而不是退出应用 */
  minimizeToTray: boolean
}

export const DEFAULT_SETTINGS: AppSettings = {
  defaultOutDir: '',
  onComplete: 'notify',
  theme: 'light',
  notify: true,
  favorites: [],
  updateFeed: '',
  minimizeToTray: true
}

/** 归一化：缺字段补默认、非法枚举回退，兼容旧配置文件 */
export function normalizeSettings(raw: unknown): AppSettings {
  const s = (raw ?? {}) as Partial<AppSettings>
  const onComplete = s.onComplete === 'openFolder' || s.onComplete === 'openFile' ? s.onComplete : 'notify'
  const theme = s.theme === 'dark' || s.theme === 'system' ? s.theme : 'light'
  return {
    defaultOutDir: typeof s.defaultOutDir === 'string' ? s.defaultOutDir : '',
    onComplete,
    theme,
    notify: s.notify !== false,
    favorites: Array.isArray(s.favorites) ? s.favorites.filter((x): x is string => typeof x === 'string') : [],
    updateFeed: typeof s.updateFeed === 'string' ? s.updateFeed : '',
    minimizeToTray: s.minimizeToTray !== false
  }
}

export interface HistoryEntry {
  /** 完成时间（毫秒时间戳） */
  time: number
  /** 功能标签，如「页面整理」「差异比对」 */
  label: string
  /** 输出文件/文件夹绝对路径 */
  outputs: string[]
}

export const HISTORY_LIMIT = 100
