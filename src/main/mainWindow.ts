import { BrowserWindow } from 'electron'

/** 主窗口引用：托盘、通知点击、二次实例聚焦都聚焦到这里 */
let mainWin: BrowserWindow | null = null

export function setMainWindow(win: BrowserWindow): void {
  mainWin = win
  win.on('closed', () => {
    if (mainWin === win) mainWin = null
  })
}

export function getMainWindow(): BrowserWindow | null {
  return mainWin && !mainWin.isDestroyed() ? mainWin : null
}

export function focusMainWindow(): void {
  if (!mainWin || mainWin.isDestroyed()) return
  if (mainWin.isMinimized()) mainWin.restore()
  if (!mainWin.isVisible()) mainWin.show()
  mainWin.focus()
}
