import { app } from 'electron'
import type { AppSettings, HistoryEntry } from '@shared/settings'
import { handle } from './wrapper'
import { addHistory, clearHistory, getHistory, getSettings, saveSettings } from '../services/settingsService'
import { logMain } from '../services/log'

handle('settings:get', (): AppSettings => getSettings())
handle('settings:set', (patch: Partial<AppSettings>): AppSettings => {
  const next = saveSettings(patch ?? {})
  // 开机自启即时生效；写失败不阻塞（某些组策略会禁启动项）
  if (patch && typeof patch.autoStart === 'boolean') {
    try {
      app.setLoginItemSettings({ openAtLogin: patch.autoStart, path: process.execPath })
    } catch (e) {
      logMain('warn', `设置开机自启失败：${e instanceof Error ? e.message : String(e)}`)
    }
  }
  return next
})
handle('settings:version', (): string => app.getVersion())
handle('history:get', (): HistoryEntry[] => getHistory())
handle('history:add', (entry: HistoryEntry): HistoryEntry[] => addHistory(entry))
handle('history:clear', (): HistoryEntry[] => clearHistory())
