import { app, BrowserWindow, nativeImage, Notification } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import { autoUpdater } from 'electron-updater'
import type { NsisUpdater, UpdateInfo } from 'electron-updater'
import type { UpdateState } from '@shared/types'
import { handle } from './wrapper'
import { getSettings } from '../services/settingsService'
import { logMain } from '../services/log'
import { DEFAULT_UPDATE_FEED, parseUpdateFeed } from '../services/updateFeed'

export { DEFAULT_UPDATE_FEED, parseUpdateFeed }

/**
 * 自动更新（electron-updater，NSIS + latest.yml，任意 HTTP(S) 静态托管）。
 * - 更新源 = 设置里的 updateFeed（GenericProvider 根地址）；留空则一切更新动作静默关闭，
 *   完全离线的机器不会有任何对外请求。
 * - 未做代码签名：verifyUpdateCodeSignature 关掉；包体完整性由 latest.yml 里的 SHA-512 保证。
 * - 检查通过后自动后台下载，下载完成推 'ready'，渲染层引导用户「重启安装」。
 */

let state: UpdateState = { phase: 'idle', current: app.getVersion() }
/** 托盘「检查更新」触发的轮次：结果额外弹系统 toast（窗口此刻多半没在前台） */
let toastOnResult = false

function toast(title: string, body: string): void {
  if (!Notification.isSupported()) return
  let icon: Electron.NativeImage | undefined
  try {
    const p = path.join(__dirname, '../renderer/logo.png')
    if (fs.existsSync(p)) icon = nativeImage.createFromPath(p)
  } catch {
    /* 无图标也可用 */
  }
  const n = new Notification({ title, body, icon })
  n.on('click', () => {
    for (const win of BrowserWindow.getAllWindows()) if (!win.isDestroyed()) win.show()
  })
  n.show()
}

/** 托盘菜单入口：检查结果以 toast 反馈 */
export function trayCheckForUpdates(): void {
  if (!app.isPackaged) return toast('兰台', '开发环境不检查更新')
  if (!applyFeed()) return toast('兰台 · 更新', '更新源被禁用（设置为 off）或地址无效')
  toastOnResult = true
  void autoUpdater.checkForUpdates().catch(() => {})
}

function push(): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send('update:state', state)
  }
}

function setState(patch: Partial<UpdateState>): void {
  state = { ...state, ...patch, current: app.getVersion() }
  push()
}

/** 从 UpdateInfo 提取展示字段（releaseNotes 可能是数组/对象，统一拍平成文本） */
function notesOf(info: UpdateInfo): string | undefined {
  const n = info.releaseNotes
  if (!n) return undefined
  if (typeof n === 'string') return n
  if (Array.isArray(n)) return n.map(x => (typeof x === 'string' ? x : (x as { note?: string }).note ?? '')).join('\n').trim() || undefined
  return undefined
}

/** 应用更新源；返回是否可用 */
function applyFeed(): boolean {
  const raw = getSettings().updateFeed.trim()
  const parsed = parseUpdateFeed(raw)
  if (!parsed) {
    if (!/^(off|none|-)$/i.test(raw)) logMain('warn', `updateFeed 非 http(s) 地址，忽略：${raw}`)
    return false
  }
  autoUpdater.setFeedURL(parsed)
  return true
}

export function initAutoUpdater(): void {
  if (!app.isPackaged) return // 开发环境不碰更新
  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = true
  // v6 起签名校验是函数（返回错误串，null=通过）；本项目未做代码签名，恒通过——
  // 完整性由 latest.yml 中的 SHA-512 保证（electron-updater 下载后自动比对）
  if (process.platform === 'win32') (autoUpdater as NsisUpdater).verifyUpdateCodeSignature = async () => null

  autoUpdater.on('checking-for-update', () => setState({ phase: 'checking' }))
  autoUpdater.on('update-available', info => setState({ phase: 'available', latest: info.version, notes: notesOf(info) }))
  autoUpdater.on('update-not-available', info => {
    setState({ phase: 'not-available', latest: info.version })
    if (toastOnResult) {
      toastOnResult = false
      toast('兰台 · 更新', `已是最新版本 v${info.version}`)
    }
  })
  autoUpdater.on('download-progress', p => setState({ phase: 'downloading', percent: Math.round(p.percent) }))
  autoUpdater.on('update-downloaded', info => {
    setState({ phase: 'ready', latest: info.version, notes: notesOf(info) })
    logMain('info', `更新包已下载：${info.version}`)
    if (toastOnResult) {
      toastOnResult = false
      toast(`v${info.version} 已就绪`, '打开设置 → 软件更新，点「重启并安装」')
    }
  })
  autoUpdater.on('error', e => {
    setState({ phase: 'error', error: e.message })
    logMain('warn', `更新失败：${e.message}`)
    if (toastOnResult) {
      toastOnResult = false
      toast('兰台 · 更新失败', e.message.slice(0, 120))
    }
  })

  // 启动静默检查（5s 后避开冷启动）；走内置官方源或用户配置的镜像地址
  setTimeout(() => {
    if (applyFeed()) void autoUpdater.checkForUpdates().catch(() => {})
  }, 5000)
}

handle('update:check', async () => {
  if (!app.isPackaged) return { ...state, error: state.error ?? '开发环境不检查更新' }
  if (!applyFeed()) return { ...state, phase: 'error' as const, error: '更新源地址无效' }
  try {
    await autoUpdater.checkForUpdates()
  } catch (e) {
    setState({ phase: 'error', error: e instanceof Error ? e.message : String(e) })
  }
  return state
})

handle('update:install', () => {
  if (state.phase !== 'ready') throw new Error('更新尚未下载完成')
  setImmediate(() => autoUpdater.quitAndInstall(false, true))
  return true
})

handle('update:state', () => state)
