import { app, Notification, shell } from 'electron'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { handle } from './wrapper'
import { focusMainWindow, getMainWindow } from '../mainWindow'
import { getSettings } from '../services/settingsService'
import { DEFAULT_UPDATE_FEED } from './update'
import { quitApp } from '../quit'
import { probeEnv } from '../services/envProbe'

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

/** 关闭询问对话框里用户点完按钮，渲染层把选择结果送回来执行 */
handle('app:apply-close-choice', (p: { action: 'tray' | 'quit' }): boolean => {
  const win = getMainWindow()
  if (!win) return false
  if (p.action === 'quit') {
    quitApp()
    return true
  }
  win.hide()
  return true
})

/** 外部浏览器打开链接（仅 http/https，作者主页等） */
handle('shell:open-external', (url: string): boolean => {
  if (!/^https?:\/\//i.test(url)) throw new Error('仅允许打开 http(s) 链接')
  void shell.openExternal(url)
  return true
})

/** 隐藏调试入口用：开/关 DevTools（独立窗口模式），返回操作后状态 */
handle('app:toggle-devtools', (): boolean => {
  const win = getMainWindow()
  if (!win) return false
  if (win.webContents.isDevToolsOpened()) {
    win.webContents.closeDevTools()
    return false
  }
  win.webContents.openDevTools({ mode: 'detach' })
  return true
})

/** 诊断快照：版本/运行环境/路径/日志/偏好，供设置页一键复制报障 */
handle('app:diagnostics', async (): Promise<Record<string, string | number>> => {
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
  // 环境探测失败不拖垮诊断整体：标记未探测即可
  let probe: Awaited<ReturnType<typeof probeEnv>> | null = null
  try {
    probe = await probeEnv()
  } catch {
    /* 探测异常按未探测处理 */
  }
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
    notify: s.notify ? '开' : '关',
    updateFeed: s.updateFeed.trim() || DEFAULT_UPDATE_FEED,
    officeWord: probe?.word ?? '未探测',
    officeExcel: probe?.excel ?? '未探测',
    officePpt: probe?.ppt ?? '未探测',
    cjkFonts: probe ? (probe.cjkFonts.join(', ') || '无') : '未探测',
    watermark: probe ? (probe.watermarkReady ? '可用' : '缺中文字体') : '未探测'
  }
})

/** 环境探测（设置页展示用）；force=true 忽略缓存重探 */
handle('app:probe', (p?: { force?: boolean }) => probeEnv(!!p?.force))

/* ---------- 调试面板专用（隐藏口令进入，勿接公开入口） ---------- */

/** 运行时全量信息：原始设置、历史尾、主日志尾巴 */
handle('app:devinfo', (): Record<string, string | number> => {
  const dir = app.getPath('userData')
  const read = (name: string): string => {
    try {
      return fs.readFileSync(path.join(dir, name), 'utf8')
    } catch {
      return '(无)'
    }
  }
  let historyCount = 0
  const histRaw = read('history.json')
  try {
    const h = JSON.parse(histRaw)
    if (Array.isArray(h)) historyCount = h.length
  } catch {
    /* ignore */
  }
  let logTail = '(无日志)'
  try {
    const logDir = path.join(dir, 'logs')
    const files = fs.readdirSync(logDir).filter(f => f.endsWith('.log')).sort()
    const last = files[files.length - 1]
    if (last) {
      const lines = fs.readFileSync(path.join(logDir, last), 'utf8').split(/\r?\n/).filter(Boolean)
      logTail = lines.slice(-150).join('\n')
    }
  } catch {
    /* ignore */
  }
  return {
    userData: dir,
    settingsRaw: read('settings.json'),
    historyCount,
    historyRaw: histRaw.length > 6000 ? histRaw.slice(0, 6000) + '\n…(截断)' : histRaw,
    logTail
  }
})

/** 打开 userData 根目录（排障时直接看文件） */
handle('app:open-userdata', async (): Promise<boolean> => {
  const err = await shell.openPath(app.getPath('userData'))
  if (err) throw new Error(err)
  return true
})

/** 重启应用（app.exit 绕开 close→托盘 拦截） */
handle('app:relaunch', () => {
  app.relaunch()
  app.exit(0)
  return true
})

/** 清空偏好与历史后重启（排障核选项：日志与 journal 保留） */
handle('app:reset-settings', () => {
  const dir = app.getPath('userData')
  for (const f of ['settings.json', 'history.json']) {
    try {
      fs.rmSync(path.join(dir, f), { force: true })
    } catch {
      /* ignore */
    }
  }
  app.relaunch()
  app.exit(0)
  return true
})
