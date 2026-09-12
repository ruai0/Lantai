import { computed, ref } from 'vue'
import { api } from './ipc'
import { DEFAULT_SETTINGS, type AppSettings, type HistoryEntry } from '@shared/settings'

/**
 * 全局偏好单例：启动时从主进程加载，主题即时应用到 <html data-theme>。
 * theme=system 时跟随系统深浅色偏好。
 */

export const settings = ref<AppSettings>({ ...DEFAULT_SETTINGS })
export const history = ref<HistoryEntry[]>([])

const media = typeof window !== 'undefined' ? window.matchMedia('(prefers-color-scheme: dark)') : null

function effectiveTheme(s: AppSettings): 'light' | 'dark' {
  if (s.theme === 'system') return media?.matches ? 'dark' : 'light'
  return s.theme
}

function applyTheme(): void {
  document.documentElement.dataset.theme = effectiveTheme(settings.value)
}

if (media) media.addEventListener('change', applyTheme)

let ready = false

/** 应用启动时 await 一次；失败不阻塞（用默认值） */
export async function initSettings(): Promise<void> {
  if (ready) return
  ready = true
  const [s, h] = await Promise.all([api.getSettings(), api.getHistory()])
  if (s.ok) settings.value = s.data
  if (h.ok) history.value = h.data
  applyTheme()
}

export async function updateSettings(patch: Partial<AppSettings>): Promise<void> {
  const res = await api.setSettings(patch)
  settings.value = res.ok ? res.data : { ...settings.value, ...patch }
  applyTheme()
}

export async function recordHistory(label: string, outputs: string[]): Promise<void> {
  if (!outputs.length) return
  const res = await api.addHistory({ time: Date.now(), label, outputs })
  if (res.ok) history.value = res.data
}

export async function clearHistory(): Promise<void> {
  const res = await api.clearHistory()
  if (res.ok) history.value = res.data
}

export const defaultOutDir = computed(() => settings.value.defaultOutDir)
export const favorites = computed(() => settings.value.favorites)

export function isFavorite(path: string): boolean {
  return settings.value.favorites.includes(path)
}

/** 切换收藏，返回切换后的状态 */
export async function toggleFavorite(path: string): Promise<boolean> {
  const cur = settings.value.favorites
  const on = cur.includes(path)
  const next = on ? cur.filter(p => p !== path) : [...cur, path]
  await updateSettings({ favorites: next })
  return !on
}
