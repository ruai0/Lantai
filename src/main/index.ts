import { app, BrowserWindow, Menu, shell } from 'electron'
import path from 'node:path'
import './ipc'
import { installCrashLogging, logMain } from './services/log'
import { clampToDisplays, loadWindowState, watchWindowState } from './services/windowState'

installCrashLogging()

// 单实例：第二次启动时聚焦已有窗口而不是再开一个
if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => {
    const win = BrowserWindow.getAllWindows()[0]
    if (win) {
      if (win.isMinimized()) win.restore()
      win.focus()
    }
  })
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
  return win
}

app.whenReady().then(() => {
  if (app.isPackaged) Menu.setApplicationMenu(null)
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
