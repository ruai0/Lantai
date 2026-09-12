import { app, Notification } from 'electron'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { handle } from './wrapper'
import { focusMainWindow } from '../mainWindow'
import { getSettings } from '../services/settingsService'

interface NotifyParams {
  title: string
  body: string
}

/** 系统通知（Windows toast）；点击唤起主窗口。仅当渲染层判断窗口不在前台时才调用 */
handle('app:notify', (p: NotifyParams): boolean => {
  if (!Notification.isSupported()) return false
  const n = new Notification({ title: p.title, body: p.body, silent: false })
  n.on('click', () => focusMainWindow())
  n.show()
  return true
})

/** 诊断快照：版本/运行环境/路径/日志/偏好，供设置页一键复制报障 */
handle('app:diagnostics', (): Record<string, string | number> => {
  const logDir = path.join(app.getPath('userData'), 'logs')
  let logs = '(无)'
  try {
    logs = fs
      .readdirSync(logDir)
      .filter(f => f.endsWith('.log'))
      .join(', ')
  } catch {
    /* 目录不存在 */
  }
  const s = getSettings()
  const cpu = os.cpus()[0]?.model ?? '未知'
  return {
    version: app.getVersion(),
    electron: process.versions.electron,
    node: process.versions.node,
    chrome: process.versions.chrome,
    platform: `${process.platform} ${os.release()} ${process.arch}`,
    cpu,
    memoryGB: Math.round((os.totalmem() / 1073741824) * 10) / 10,
    packaged: app.isPackaged ? '是' : '否（开发）',
    userData: app.getPath('userData'),
    logs: logs || '(空)',
    theme: s.theme,
    onComplete: s.onComplete,
    defaultOutDir: s.defaultOutDir || '(未设置)',
    favorites: s.favorites.length,
    notify: s.notify ? '开' : '关'
  }
})
