/** 工具参数记忆（跨会话复用）：三端共享类型 + 纯函数归一化 */

/**
 * 参数记忆的数据形态：按「视图 key」分组，组内为「参数名 → 值」。
 * 只存稳定、可复用的参数（格式、模式、数值、目录名等）；
 * **不存文件/文件夹绝对路径**——文件随时可能被移动或删除，记住反而造成误导。
 */
export type RememberedParams = Record<string, Record<string, unknown>>

/** 单个视图组内参数上限，防止异常数据无限膨胀 */
export const VIEW_PARAM_LIMIT = 40
/** 顶层视图组上限 */
export const VIEW_COUNT_LIMIT = 40
/** 单个值的序列化长度上限（超长直接丢弃，避免把大对象塞进来） */
export const VALUE_SIZE_LIMIT = 2000

function isPlainValue(v: unknown): boolean {
  const t = typeof v
  if (t === 'string' || t === 'number' || t === 'boolean') return true
  if (v === null) return true
  if (Array.isArray(v)) return v.length <= 200 && v.every(x => typeof x === 'string' || typeof x === 'number')
  return false
}

/** 归一化读入的记忆数据：剔除非法 key/值、截断超长字符串，兼容旧文件 */
export function normalizeRememberedParams(raw: unknown): RememberedParams {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
  const out: RememberedParams = {}
  let groups = 0
  for (const [view, group] of Object.entries(raw as Record<string, unknown>)) {
    if (groups >= VIEW_COUNT_LIMIT) break
    if (!view || typeof view !== 'string' || typeof group !== 'object' || group === null || Array.isArray(group)) continue
    const clean: Record<string, unknown> = {}
    let n = 0
    for (const [k, v] of Object.entries(group as Record<string, unknown>)) {
      if (n >= VIEW_PARAM_LIMIT) break
      if (!k || !isPlainValue(v)) continue
      if (typeof v === 'string' && v.length > VALUE_SIZE_LIMIT) continue
      clean[k] = v
      n++
    }
    if (Object.keys(clean).length) {
      out[view] = clean
      groups++
    }
  }
  return out
}

/** 合并一个视图的参数（浅合并，值 undefined 视为删除） */
export function mergeViewParams(
  all: RememberedParams,
  view: string,
  patch: Record<string, unknown>
): RememberedParams {
  if (!view) return all
  const cur: Record<string, unknown> = { ...(all[view] ?? {}) }
  for (const [k, v] of Object.entries(patch ?? {})) {
    if (v === undefined || !isPlainValue(v)) delete cur[k]
    else if (typeof v === 'string' && v.length > VALUE_SIZE_LIMIT) delete cur[k]
    else cur[k] = v
  }
  const next: RememberedParams = { ...all }
  if (Object.keys(cur).length) next[view] = cur
  else delete next[view]
  return normalizeRememberedParams(next)
}
