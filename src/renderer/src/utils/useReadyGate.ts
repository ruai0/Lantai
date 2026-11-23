/**
 * 表单「就绪校验」：主执行按钮在必填项没填齐时提前禁用，并把缺什么写在按钮旁边。
 *
 * 为什么要统一做这件事：
 * 原先各页都是"点开始 → 弹「请先选择文件」→ 再回去选"，一天重复十几次就是十几次白点击。
 * 业界通行做法是按钮置灰 + 就近说明原因（而不是隐藏按钮，隐藏会让人找不到入口）。
 *
 * 用法：
 *   const { blocked, reason } = useReadyGate(() => [
 *     { label: 'PDF 文件', ok: files.value.length > 0 },
 *     { label: '输出文件夹', ok: !!outDir.value }
 *   ])
 * 模板：
 *   <el-button :disabled="blocked" :title="reason" data-blocked-reason="...">开始</el-button>
 *
 * 注意：只校验**绝对必要**的项（文件、输出目录），可选项一律不拦——
 * 误判会把用户卡死在自己也改不了的状态里，比多点一次更糟。
 */
import { computed, type ComputedRef } from 'vue'

export interface GateItem {
  /** 缺什么（用于提示文案），如「PDF 文件」 */
  label: string
  /** 是否已满足 */
  ok: boolean
}

export interface ReadyGate {
  blocked: ComputedRef<boolean>
  /** 「还需：PDF 文件、输出文件夹」；就绪时为空串 */
  reason: ComputedRef<string>
  /** 未满足项的标签 */
  missing: ComputedRef<string[]>
}

export function useReadyGate(items: () => GateItem[]): ReadyGate {
  const missing = computed(() => items().filter(i => !i.ok).map(i => i.label))
  const blocked = computed(() => missing.value.length > 0)
  const reason = computed(() =>
    missing.value.length ? `还需：${missing.value.join('、')}` : ''
  )
  return { blocked, reason, missing }
}
