import { app, BrowserWindow, Menu, nativeImage, shell, Tray } from 'electron'
import path from 'node:path'
import './ipc'
import { installCrashLogging, logMain } from './services/log'
import { clampToDisplays, loadWindowState, watchWindowState } from './services/windowState'
import { focusMainWindow, getMainWindow, setMainWindow } from './mainWindow'
import { initAutoUpdater } from './ipc/update'
import { migrateLegacyUserData } from './services/migrate'
import { getSettings } from './services/settingsService'

// Windows 通知归属与 NSIS 快捷方式的 AUMID 保持一致（打包安装器写入的是 build.appId）
app.setAppUserModelId('com.ruai1024.lantai')
migrateLegacyUserData()
installCrashLogging()

let tray: Tray | null = null
/** 只有托盘菜单/更新安装走这里；否则点关闭只是收进托盘 */
let isQuitting = false
let trayHintShown = false

function quitApp(): void {
  isQuitting = true
  app.quit()
}
app.on('before-quit', () => (isQuitting = true))

// 单实例：第二次启动时聚焦已有窗口而不是再开一个
if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => focusMainWindow())
}

function toggleMainWindow(): void {
  const win = getMainWindow()
  if (!win) {
    createWindow()
    return
  }
  if (win.isVisible() && win.isFocused()) win.hide()
  else focusMainWindow()
}

function createTray(): void {
  if (tray) return
  try {
    const icon = nativeImage.createFromPath(path.join(__dirname, '../renderer/tray.png')).resize({ width: 16, height: 16 })
    tray = new Tray(icon)
    tray.setToolTip('兰台 办公工具箱（右键菜单可退出）')
    tray.setContextMenu(
      Menu.buildFromTemplate([
        { label: '显示主窗口', click: () => focusMainWindow() },
        { type: 'separator' },
        { label: '退出 兰台', click: quitApp }
      ])
    )
    // Windows 上单击即触发 click；双击额外兜底
    tray.on('click', () => toggleMainWindow())
    tray.on('double-click', () => focusMainWindow())
  } catch (e) {
    logMain('warn', `托盘创建失败：${e instanceof Error ? e.message : String(e)}`)
  }
}

function createWindow(): BrowserWindow {
  const saved = clampToDisplays(loadWindowState({ width: 1320, height: 860 }))
  const win = new BrowserWindow({
    ...saved,
    minWidth: 1024,
    minHeight: 640,
    show: false,
    autoHideMenuBar: true,
    title: '兰台 办公工具箱',
    backgroundColor: '#f5f7fa',
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js')
    }
  })

  win.on('ready-to-show', () => win.show())
  watchWindowState(win)

  // 关闭按钮 = 收进托盘（可在设置里改回直接退出）；真退出由 isQuitting 放行
  win.on('close', e => {
    if (isQuitting || !tray || !getSettings().minimizeToTray) return
    e.preventDefault()
    win.hide()
    if (!trayHintShown) {
      trayHintShown = true
      tray.displayBalloon({
        title: '兰台仍在后台运行',
        content: '已最小化到右下角托盘：单击图标恢复窗口，右键「退出 兰台」才会真正关闭。',
        iconType: 'info'
      })
    }
  })

  win.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url)
    return { action: 'deny' }
  })

  // 渲染进程崩溃/无响应留痕（内网排障唯一线索）
  win.webContents.on('render-process-gone', (_e, details) => {
    logMain('error', `渲染进程退出: ${JSON.stringify(details)}`)
  })
  win.on('unresponsive', () => logMain('warn', '窗口无响应'))

  if (!app.isPackaged && process.env['ELECTRON_RENDERER_URL']) {
    void win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    void win.loadFile(path.join(__dirname, '../renderer/index.html'))
  }
  setMainWindow(win)
  return win
}

app.whenReady().then(() => {
  if (app.isPackaged) Menu.setApplicationMenu(null)
  createWindow()
  createTray()
  initAutoUpdater()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
