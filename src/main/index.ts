import { app, BrowserWindow, dialog, Menu, nativeImage, shell, Tray } from 'electron'
import path from 'node:path'
import './ipc'
import { installCrashLogging, logMain } from './services/log'
import { clampToDisplays, loadWindowState, watchWindowState } from './services/windowState'
import { focusMainWindow, getMainWindow, setMainWindow } from './mainWindow'
import { initAutoUpdater, trayCheckForUpdates } from './ipc/update'
import { migrateLegacyUserData } from './services/migrate'
import { getSettings } from './services/settingsService'
import { getIsQuitting, quitApp } from './quit'

// Windows 通知归属与 NSIS 快捷方式的 AUMID 保持一致（打包安装器写入的是 build.appId）
app.setAppUserModelId('com.ruai1024.lantai')
migrateLegacyUserData()
installCrashLogging()

let tray: Tray | null = null

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
        { label: '检查更新', click: () => trayCheckForUpdates() },
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

  // 关闭按钮行为（设置 → 关闭主窗口时）：tray 收托盘；quit 放行真退出；ask 交给渲染层弹选择
  win.on('close', e => {
    if (getIsQuitting() || !tray) return
    const mode = getSettings().onClose
    if (mode === 'quit') return
    e.preventDefault()
    if (mode === 'tray') {
      win.hide()
      return
    }
    if (!win.isVisible()) win.show()
    win.focus()
    win.webContents.send('app:close-request')
  })

  win.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url)
    return { action: 'deny' }
  })

  // 渲染进程崩溃自愈：先静默重载两次（偶发崩溃用户无感），仍崩则弹窗引导重启；全程留痕
  let crashReloads = 0
  win.webContents.on('render-process-gone', (_e, details) => {
    logMain('error', `渲染进程退出: ${JSON.stringify(details)}`)
    if (details.reason === 'clean-exit') return
    if (crashReloads < 2) {
      crashReloads++
      logMain('info', `渲染进程崩溃，自动重载（第 ${crashReloads}/2 次）`)
      win.webContents.reload()
      return
    }
    void dialog
      .showMessageBox(win, {
        type: 'error',
        title: '兰台',
        message: '界面进程异常退出，自动恢复失败',
        detail: '建议重启应用；若反复出现，请在「设置 → 复制诊断信息」后把内容发给作者 ruai0 排查。',
        buttons: ['重启应用', '退出'],
        noLink: true
      })
      .then(({ response }) => {
        if (response === 0) {
          app.relaunch()
          app.exit(0)
        } else app.quit()
      })
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
