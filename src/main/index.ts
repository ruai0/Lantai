import { app, BrowserWindow, Menu, nativeImage, shell, Tray } from 'electron'
import path from 'node:path'
import './ipc'
import { installCrashLogging, logMain } from './services/log'
import { clampToDisplays, loadWindowState, watchWindowState } from './services/windowState'
import { focusMainWindow, setMainWindow } from './mainWindow'
import { initAutoUpdater } from './ipc/update'

installCrashLogging()

let tray: Tray | null = null

// 单实例：第二次启动时聚焦已有窗口而不是再开一个
if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => focusMainWindow())
}

function createTray(): void {
  if (tray) return
  try {
    const icon = nativeImage.createFromPath(path.join(__dirname, '../renderer/tray.png')).resize({ width: 16, height: 16 })
    tray = new Tray(icon)
    tray.setToolTip('FreeTool 办公工具箱')
    tray.setContextMenu(
      Menu.buildFromTemplate([
        { label: '显示主窗口', click: () => focusMainWindow() },
        { type: 'separator' },
        { label: '退出', click: () => app.quit() }
      ])
    )
    tray.on('click', () => focusMainWindow())
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
    title: 'FreeTool 办公工具箱',
    backgroundColor: '#f5f7fa',
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js')
    }
  })

  win.on('ready-to-show', () => win.show())
  watchWindowState(win)

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
