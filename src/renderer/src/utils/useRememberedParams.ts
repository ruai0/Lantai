import { onUnmounted, ref, watch, type Ref } from 'vue'
import { api } from './ipc'
import { settings } from './settings'
import type { RememberedParams } from '@shared/params'

/**
 * 工具参数记忆：把各工具页的关键参数（格式、模式、数值、命名规则等）记到本地，
 * 下次打开自动回填——同一批活儿做第二次不用重填。
 *
 * 设计取舍：
 * - **只记忆"稳定参数"，不记忆文件/文件夹路径**（文件随时被移动或删除，记住会误导）；
 *   输出目录由全局「默认输出目录」统一处理，这里也不再重复记忆。
 * - 快照在应用启动时一次性读入内存（initRememberedParams），水合是同步的，避免界面先空后闪。
 * - 变更以「视图」为单位防抖落盘（同一页多次改动只写一次），失败静默。
 * - 用户在设置里关掉「记住参数」后：不再写入；已记的内容保留，可手动清除。
 */

/** 全部记忆快照（视图 key → 参数名 → 值） */
export const remembered = ref<RememberedParams>({})

let loaded = false

/** 应用启动时 await 一次；失败用空快照（不阻塞） */
export async function initRememberedParams(): Promise<void> {
  if (loaded) return
  loaded = true
  const r = await api.getParams()
  if (r.ok) remembered.value = r.data
}

/* ---------- 按视图批量落盘 ---------- */

const pending: Record<string, Record<string, unknown>> = {}
const timers: Record<string, ReturnType<typeof setTimeout>> = {}

function flush(view: string): void {
  const patch = pending[view]
  delete pending[view]
  if (!patch) return
  if (!settings.value.rememberParams) return
  void api.setViewParams({ view, patch }).then(r => {
    if (r.ok) remembered.value = r.data
  })
}

function schedule(view: string, key: string, value: unknown): void {
  if (!settings.value.rememberParams) return
  pending[view] = { ...(pending[view] ?? {}), [key]: value }
  if (timers[view]) clearTimeout(timers[view])
  timers[view] = setTimeout(() => flush(view), 400)
}

/** 立即落盘某视图的待写参数（用于 onUnmounted，避免防抖窗口内丢改动） */
export function flushViewParams(view: string): void {
  if (timers[view]) clearTimeout(timers[view])
  delete timers[view]
  flush(view)
}

/** 清空全部记忆并刷新快照 */
export async function clearRemembered(): Promise<void> {
  const r = await api.clearParams()
  remembered.value = r.ok ? r.data : {}
}

/* ---------- 组合式 API ---------- */

/**
 * 把一个 ref 接上参数记忆。
 * @param view 视图 key（建议用路由 name，如 'pdf'）
 * @param key  参数名（同视图内唯一，如 'splitMode'）
 * @param r    要记忆的 ref（string/number/boolean 等可 JSON 序列化的简单值）
 *
 * 用法：`useRemembered('pdf', 'splitMode', splitMode)` —— 挂载即回填，改动即保存。
 */
export function useRemembered<V>(view: string, key: string, r: Ref<V>): void {
  // 同步回填：从已加载快照取值，界面首帧就是用户上次的选择
  const saved = remembered.value[view]?.[key]
  if (saved !== undefined && typeof saved === typeof r.value) {
    r.value = saved as V
  } else if (Array.isArray(saved) && Array.isArray(r.value)) {
    r.value = saved as V
  }
  watch(r, v => schedule(view, key, v))
  // 组件卸载时立即落盘，避免防抖窗口（400ms）内切页丢掉刚改的参数
  onUnmounted(() => flushViewParams(view))
}

/**
 * 一次记忆多个参数（同一视图）。等价于对每个键各调一次 useRemembered。
 * 用法：`useRememberedMany('excel', { splitMode, headerRow, sheet })`
 */
export function useRememberedMany(view: string, map: Record<string, Ref<unknown>>): void {
  for (const [key, r] of Object.entries(map)) useRemembered(view, key, r)
}
