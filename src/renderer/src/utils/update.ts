import { ref } from 'vue'
import type { UpdateState } from '@shared/types'
import { api } from './ipc'

/** 更新状态单例：主进程 update:state 推送 + 手动检查/安装入口 */

export const updateState = ref<UpdateState>({ phase: 'idle', current: '' })

api.onUpdateState(s => {
  updateState.value = s
})

/** 拉一次当前状态（订阅建立前的快照）；开发环境主进程返回 idle+提示，不算错误 */
export async function syncUpdateState(): Promise<void> {
  const r = await api.updateState()
  if (r.ok) updateState.value = r.data
}

export async function checkUpdate(): Promise<UpdateState> {
  const r = await api.updateCheck()
  if (r.ok) updateState.value = r.data
  else updateState.value = { ...updateState.value, phase: 'error', error: r.error }
  return updateState.value
}

export async function installUpdate(): Promise<boolean> {
  const r = await api.updateInstall()
  return r.ok
}
