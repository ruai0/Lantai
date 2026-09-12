import { app } from 'electron'

/** 真退出口径唯一来源：托盘菜单、更新安装、关闭询问选「退出」都走这里 */

let isQuitting = false

export function quitApp(): void {
  isQuitting = true
  app.quit()
}

export function getIsQuitting(): boolean {
  return isQuitting
}
