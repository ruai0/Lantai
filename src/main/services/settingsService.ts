import { app } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import {
  DEFAULT_SETTINGS,
  HISTORY_LIMIT,
  normalizeSettings,
  type AppSettings,
  type HistoryEntry
} from '@shared/settings'

/**
 * 偏好与历史持久化到 userData（settings.json / history.json）。
 * 读失败回退默认，写失败静默（不影响主流程）。
 */

function file(name: string): string {
  return path.join(app.getPath('userData'), name)
}

function readJson<T>(name: string, fallback: T): T {
  try {
    return JSON.parse(fs.readFileSync(file(name), 'utf8')) as T
  } catch {
    return fallback
  }
}

function writeJson(name: string, value: unknown): void {
  try {
    fs.mkdirSync(path.dirname(file(name)), { recursive: true })
    fs.writeFileSync(file(name), JSON.stringify(value, null, 2))
  } catch {
    /* 落盘失败不影响使用 */
  }
}

export function getSettings(): AppSettings {
  return normalizeSettings(readJson<Partial<AppSettings>>('settings.json', DEFAULT_SETTINGS))
}

export function saveSettings(patch: Partial<AppSettings>): AppSettings {
  const merged = { ...getSettings(), ...patch }
  const next = normalizeSettings(merged)
  writeJson('settings.json', next)
  return next
}

export function getHistory(): HistoryEntry[] {
  const list = readJson<HistoryEntry[]>('history.json', [])
  return Array.isArray(list) ? list.filter(e => e && typeof e.time === 'number' && Array.isArray(e.outputs)) : []
}

export function addHistory(entry: HistoryEntry): HistoryEntry[] {
  const next = [entry, ...getHistory()].slice(0, HISTORY_LIMIT)
  writeJson('history.json', next)
  return next
}

export function clearHistory(): HistoryEntry[] {
  writeJson('history.json', [])
  return []
}
