import { BrowserWindow } from 'electron'
import type { TaskSnapshot } from '@shared/types'

/**
 * 任务进度广播：主进程按文件循环的服务在这里登记进度，节流推给所有窗口。
 * 渲染层 TaskDock 订阅 task:update 展示悬浮进度条；完成/出错的任务延迟几秒移除，
 * 让用户看到「完成」状态而不是瞬间消失。
 */

export type { TaskSnapshot }

type TaskState = TaskSnapshot['state']

interface TaskHandle {
  /** done 单调不回退；条目数执行中才知的任务（如打包）可带 total 修正分母 */
  progress(done: number, total?: number): void
  finish(state?: TaskState): void
}

const active = new Map<number, TaskSnapshot>()
let nextId = 1
let timer: NodeJS.Timeout | null = null

function broadcast(): void {
  if (timer) return
  timer = setTimeout(() => {
    timer = null
    const list: TaskSnapshot[] = [...active.values()]
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) win.webContents.send('task:update', list)
    }
  }, 120)
}

/** 开始一个带进度的任务；total 是文件/条目数 */
export function beginTask(label: string, total: number): TaskHandle {
  const id = nextId++
  active.set(id, { id, label, done: 0, total: Math.max(1, total), state: 'running' })
  broadcast()
  return {
    progress(done: number, total?: number): void {
      const t = active.get(id)
      if (!t) return
      if (total !== undefined) t.total = Math.max(1, total)
      t.done = Math.max(t.done, Math.min(done, t.total))
      broadcast()
    },
    finish(state: TaskState = 'done'): void {
      const t = active.get(id)
      if (!t) return
      t.state = state
      if (state === 'done') t.done = t.total
      broadcast()
      setTimeout(() => {
        active.delete(id)
        broadcast()
      }, state === 'done' ? 2200 : 5000)
    }
  }
}

/** 包装一次带循环的服务调用：progress(done) 推进度，异常自动记为 error 并原样抛出 */
export async function runTracked<T>(
  label: string,
  total: number,
  fn: (progress: (done: number, total?: number) => void) => Promise<T>
): Promise<T> {
  const t = beginTask(label, total)
  try {
    const r = await fn(d => t.progress(d))
    t.finish()
    return r
  } catch (e) {
    t.finish('error')
    throw e
  }
}
