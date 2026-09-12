import { app } from 'electron'
import type { AppSettings, HistoryEntry } from '@shared/settings'
import { handle } from './wrapper'
import { addHistory, clearHistory, getHistory, getSettings, saveSettings } from '../services/settingsService'

handle('settings:get', (): AppSettings => getSettings())
handle('settings:set', (patch: Partial<AppSettings>): AppSettings => saveSettings(patch ?? {}))
handle('settings:version', (): string => app.getVersion())
handle('history:get', (): HistoryEntry[] => getHistory())
handle('history:add', (entry: HistoryEntry): HistoryEntry[] => addHistory(entry))
handle('history:clear', (): HistoryEntry[] => clearHistory())
