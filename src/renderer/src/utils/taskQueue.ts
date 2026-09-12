import { computed, ref } from 'vue'
import type { TaskSnapshot } from '@shared/types'
import { api } from './ipc'

/**
 * #1 任务队列（渲染层）：批量任务串行调度，发起后可以切走干别的。
 * 队列在这里；进度真值在主进程（按文件循环），经 task:update 推回来给 TaskDock。
 */

const labels = ref<string[]>([])
export const activeTasks = ref<TaskSnapshot[]>([])

let chain: Promise<unknown> = Promise.resolve()

/** 入队一个任务；返回的 Promise 在【该任务】执行完成时兑现 */
export function enqueue<T>(label: string, job: () => Promise<T>): Promise<T> {
  labels.value = [...labels.value, label]
  const run = chain.then(async () => {
    labels.value = labels.value.slice(1)
    return job()
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
