import { ElMessage } from 'element-plus'
import type { ApiResult } from '@shared/types'
import { api } from './ipc'
import { enqueue } from './taskQueue'
import { recordHistory, settings } from './settings'

/** 从各服务返回体里提取输出路径（outputs[] / outputPath / path 三种约定） */
function extractOutputs(data: unknown): string[] {
  if (!data || typeof data !== 'object') return []
  const d = data as Record<string, unknown>
  if (Array.isArray(d.outputs)) return d.outputs.filter((x): x is string => typeof x === 'string')
  if (typeof d.outputPath === 'string') return [d.outputPath]
  if (typeof d.path === 'string') return [d.path]
  return []
}

/** 统一调用 window.api：失败弹错误并返回 null，成功可选弹提示并返回 data */
export async function call<T>(p: Promise<ApiResult<T>>, successMsg?: string): Promise<T | null> {
  const res = await p
  if (!res.ok) {
    ElMessage.error(res.error)
    return null
  }
  if (successMsg) {
    ElMessage.success(successMsg)
    // 有输出路径才算一次「产出任务」：记录历史并按偏好执行完成行为
    const outputs = extractOutputs(res.data)
    if (outputs.length) {
      void recordHistory(successMsg, outputs)
      const mode = settings.value.onComplete
      if (mode === 'openFolder') void api.openPath(dirname(outputs[0]))
      else if (mode === 'openFile') void api.openPath(outputs[0])
      // 窗口不在前台时补一条系统通知，点击可唤回主窗口
      if (settings.value.notify && !document.hasFocus()) {
        void api.notify({ title: `兰台 · ${successMsg}`, body: basename(outputs[0]) })
      }
    }
  }
  return res.data
}

export function basename(p: string): string {
  const i = Math.max(p.lastIndexOf('\\'), p.lastIndexOf('/'))
  return i >= 0 ? p.slice(i + 1) : p
}

export function dirname(p: string): string {
  const i = Math.max(p.lastIndexOf('\\'), p.lastIndexOf('/'))
  return i > 0 ? p.slice(0, i) : p
}

/**
 * 排队版 call：重批量任务（合并、Office 转换、批量替换、打包）走 #1 串行队列，
 * 发起后可切到别的工具继续排队；进度与「进行中」列表见右下角 TaskDock。
 * label 请与主进程 runTracked 的通道名保持一致，便于 Dock 对齐展示。
 */
export function callQ<T>(label: string, job: () => Promise<ApiResult<T>>, successMsg?: string): Promise<T | null> {
  return enqueue(label, () => call(job(), successMsg))
}
