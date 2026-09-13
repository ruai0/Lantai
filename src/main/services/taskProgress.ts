import { BrowserWindow } from 'electron'
import type { TaskSnapshot } from '@shared/types'

/**
 * 任务进度广播：主进程按文件循环的服务在这里登记进度，节流推给所有窗口。
 * 渲染层 TaskDock 订阅 task:update 展示悬浮进度条；完成/出错/取消的任务延迟几秒移除。
 * 取消语义：cancelTask 置位后，服务的文件循环在下一个边界抛 TaskCancelledError；
 * 正在处理的单个文件不半途中断（合并到一半的 PDF、写了一半的 xlsx 都会留残件），
 * 所以取消粒度 = 文件，Office 转换则直接杀 PowerShell 子进程。
 */

export type TaskState = TaskSnapshot['state']

/** 服务循环检测到用户取消时抛出；IPC wrapper 会把它变成 { ok:false, error:'任务已取消' } */
export class TaskCancelledError extends Error {
  constructor() {
    super('任务已取消')
    this.name = 'TaskCancelled'
  }
}

export interface TaskHandle {
  /** 主进程任务 id；渲染层经 task:update 拿到后调 cancelTask */
  readonly id: number
  /** done 单调不回退；条目数执行中才知的任务（如打包）可带 total 修正分母 */
  progress(done: number, total?: number): void
  isCancelled(): boolean
  finish(state?: TaskState): void
}

interface TaskRecord extends TaskSnapshot {
  cancelled: boolean
}

const active = new Map<number, TaskRecord>()
let nextId = 1
let timer: NodeJS.Timeout | null = null

function broadcast(): void {
  if (timer) return
  timer = setTimeout(() => {
    timer = null
    const list: TaskSnapshot[] = [...active.values()].map(({ cancelled, ...snap }) => snap)
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) win.webContents.send('task:update', list)
    }
  }, 120)
}

/** 开始一个带进度的任务；total 是文件/条目数 */
export function beginTask(label: string, total: number): TaskHandle {
  const id = nextId++
  active.set(id, { id, label, done: 0, total: Math.max(1, total), state: 'running', cancelled: false })
  broadcast()
  return {
    id,
    progress(done: number, total?: number): void {
      const t = active.get(id)
      if (!t) return
      if (total !== undefined) t.total = Math.max(1, total)
      t.done = Math.max(t.done, Math.min(done, t.total))
      broadcast()
    },
    isCancelled(): boolean {
      return active.get(id)?.cancelled === true
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
      }, state === 'running' ? 0 : state === 'done' ? 2200 : 5000)
    }
  }
}

/** 请求取消：置位并立即以 cancelled 状态广播（循环在文件边界兑现）。返回是否命中一个运行中的任务 */
export function cancelTask(id: number): boolean {
  const t = active.get(id)
  if (!t || t.state !== 'running') return false
  t.cancelled = true
  t.state = 'cancelled'
  broadcast()
  return true
}

/** 当前任务快照列表（渲染层崩溃重载后用于恢复任务坞显示） */
export function activeTaskList(): TaskSnapshot[] {
  return [...active.values()].map(({ cancelled, ...snap }) => snap)
}

/** 包装一次带循环的服务调用：ctx 提供进度上报与取消探测 */
export interface TaskCtx {
  progress(done: number, total?: number): void
  isCancelled(): boolean
}

export async function runTracked<T>(label: string, total: number, fn: (ctx: TaskCtx) => Promise<T>): Promise<T> {
  const t = beginTask(label, total)
  const ctx: TaskCtx = { progress: (d, total2) => t.progress(d, total2), isCancelled: () => t.isCancelled() }
  try {
    const r = await fn(ctx)
    t.finish()
    return r
  } catch (e) {
    t.finish(e instanceof TaskCancelledError ? 'cancelled' : 'error')
    throw e
  }
}
