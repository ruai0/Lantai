/** 应用偏好与使用历史（三端共享类型 + 默认值） */

export type OnComplete = 'notify' | 'openFolder' | 'openFile'
export type Theme = 'light' | 'dark' | 'system'

export interface AppSettings {
  /** 默认输出目录；各功能输出框为空时自动预填 */
  defaultOutDir: string
  /** 任务完成后的行为：仅提示 / 打开所在文件夹 / 打开输出文件 */
  onComplete: OnComplete
  theme: Theme
}

export const DEFAULT_SETTINGS: AppSettings = {
  defaultOutDir: '',
  onComplete: 'notify',
  theme: 'light'
}

/** 归一化：缺字段补默认、非法枚举回退，兼容旧配置文件 */
export function normalizeSettings(raw: unknown): AppSettings {
  const s = (raw ?? {}) as Partial<AppSettings>
  const onComplete = s.onComplete === 'openFolder' || s.onComplete === 'openFile' ? s.onComplete : 'notify'
  const theme = s.theme === 'dark' || s.theme === 'system' ? s.theme : 'light'
  return {
    defaultOutDir: typeof s.defaultOutDir === 'string' ? s.defaultOutDir : '',
    onComplete,
    theme
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
