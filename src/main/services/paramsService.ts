import { app } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import {
  mergeViewParams,
  normalizeRememberedParams,
  type RememberedParams
} from '@shared/params'

/**
 * 工具参数记忆持久化到 userData/params.json。
 * 读失败回退空对象，写失败静默（不影响主流程）。
 * 「清除记忆」= 直接删 file 内容，不删历史（历史是任务产物，两者相互独立）。
 */

function file(): string {
  return path.join(app.getPath('userData'), 'params.json')
}

export function getRememberedParams(): RememberedParams {
  try {
    return normalizeRememberedParams(JSON.parse(fs.readFileSync(file(), 'utf8')))
  } catch {
    return {}
  }
}

function write(next: RememberedParams): void {
  try {
    fs.mkdirSync(path.dirname(file()), { recursive: true })
    fs.writeFileSync(file(), JSON.stringify(next, null, 2))
  } catch {
    /* 落盘失败不影响使用 */
  }
}

/** 写入某个视图的参数（浅合并；值为 undefined 表示删除该键） */
export function saveViewParams(view: string, patch: Record<string, unknown>): RememberedParams {
  const next = mergeViewParams(getRememberedParams(), view, patch ?? {})
  write(next)
  return next
}

/** 清空全部记忆的参数 */
export function clearRememberedParams(): RememberedParams {
  write({})
  return {}
}
