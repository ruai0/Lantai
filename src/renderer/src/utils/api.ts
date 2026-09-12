import { ElMessage } from 'element-plus'
import type { ApiResult } from '@shared/types'

/** 统一调用 window.api：失败弹错误并返回 null，成功可选弹提示并返回 data */
export async function call<T>(p: Promise<ApiResult<T>>, successMsg?: string): Promise<T | null> {
  const res = await p
  if (!res.ok) {
    ElMessage.error(res.error)
    return null
  }
  if (successMsg) ElMessage.success(successMsg)
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
