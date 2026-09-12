import { app, BrowserWindow, screen } from 'electron'
import fs from 'node:fs'
import path from 'node:path'

/**
 * 窗口状态记忆：尺寸/位置存 userData/window-state.json。
 * 恢复时校验位置仍在某个显示器内（换过显示器/投过屏就不信任旧坐标）。
 */

interface SavedState {
  width: number
  height: number
  x?: number
  y?: number
}

function stateFile(): string {
  return path.join(app.getPath('userData'), 'window-state.json')
}

export function loadWindowState(fallback: { width: number; height: number }): SavedState {
  try {
    const s = JSON.parse(fs.readFileSync(stateFile(), 'utf8')) as SavedState
    if (s.width >= 640 && s.height >= 480) return s
  } catch {
    /* 首次运行或文件损坏 */
  }
  return fallback
}

export function watchWindowState(win: BrowserWindow): void {
  let timer: ReturnType<typeof setTimeout> | undefined
  const save = () => {
    try {
      fs.writeFileSync(stateFile(), JSON.stringify(win.getBounds()))
    } catch {
      /* 写失败不影响使用 */
    }
  }
  const saveSoon = () => {
    clearTimeout(timer)
    timer = setTimeout(save, 400)
  }
  win.on('moved', saveSoon)
  win.on('resized', saveSoon)
  win.on('close', () => {
    clearTimeout(timer)
    save()
  })
}

/** 把保存的位置钳制到当前显示器范围内；无有效位置则返回 undefined（居中） */
export function clampToDisplays(s: SavedState): SavedState {
  if (s.x === undefined || s.y === undefined) return s
  const visible = screen.getAllDisplays().some(d => {
    const a = d.bounds
    const b = { x: s.x!, y: s.y!, width: s.width, height: s.height }
    return b.x < a.x + a.width - 60 && b.x + b.width > a.x + 60 && b.y < a.y + a.height - 60 && b.y + b.height > a.y + 60
  })
  return visible ? s : { width: s.width, height: s.height }
}
