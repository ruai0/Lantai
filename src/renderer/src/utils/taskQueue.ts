import { computed, ref } from 'vue'
import type { TaskSnapshot } from '@shared/types'
import { api } from './ipc'

/**
 * #1 任务队列（渲染层）：批量任务串行调度，发起后可以切走干别的。
 * 队列在这里；进度真值在主进程（按文件循环），经 task:update 推回来给 TaskDock。
 * 排队中的任务可单独取消；正在执行的不中断（主进程循环无中断点）。
 */

export interface PendingJob {
  id: number
  label: string
  cancel(): void
}

const labels = ref<string[]>([])
export const activeTasks = ref<TaskSnapshot[]>([])
export const pendingJobs = ref<PendingJob[]>([])

let chain: Promise<unknown> = Promise.resolve()
let nextId = 1

export function enqueue<T>(label: string, job: () => Promise<T>): Promise<T> {
  labels.value = [...labels.value, label]
  let rejectCancelled: ((r: Error) => void) | null = null
  const cancelled = new Promise<never>((_, rej) => {
    rejectCancelled = rej
  })
  cancelled.catch(() => {}) // 取消发生但任务已在跑时，这条 rejection 无人消费，防 unhandled
  const entry: PendingJob = {
    id: nextId++,
    label,
    cancel: () => rejectCancelled?.(new Error('已取消'))
  }
  pendingJobs.value = [...pendingJobs.value, entry]
  const run = chain.then(async () => {
    labels.value = labels.value.slice(1)
    pendingJobs.value = pendingJobs.value.filter(j => j.id !== entry.id)
    return Promise.race([job(), cancelled])
  })
  chain = run.then(() => undefined).catch(() => undefined)
  return run
}

export const currentLabel = computed(() => labels.value[0] ?? '')
export const pendingCount = computed(() => Math.max(0, labels.value.length - 1))
export const queueActive = computed(() => labels.value.length > 0)

api.onTaskUpdate(list => {
  activeTasks.value = list as TaskSnapshot[]
})
