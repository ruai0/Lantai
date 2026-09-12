import path from 'node:path'
import type { RenamePair, RenameRules } from '@shared/types'

export function filterByExts(names: string[], exts?: string[]): string[] {
  if (!exts || exts.length === 0) return names
  const set = new Set(exts.map(e => e.replace(/^\./, '').toLowerCase()))
  return names.filter(n => set.has(path.extname(n).replace(/^\./, '').toLowerCase()))
}

/**
 * 生成重命名计划（纯函数，可测试）。
 * existingNames 是目录里当前所有文件名，用于检测「目标名已被别的文件占用」。
 */
export function buildRenamePlan(
  names: string[],
  rules: RenameRules,
  existingNames?: Set<string>
): RenamePair[] {
  const known = existingNames ?? new Set(names)
  const targetCount = new Map<string, number>()
  let seq = rules.sequence?.start ?? 1

  const plan: RenamePair[] = names.map(name => {
    const ext = path.extname(name)
    const stem = ext ? name.slice(0, name.length - ext.length) : name
    let newStem = stem
    if (rules.find) newStem = newStem.split(rules.find).join(rules.replace ?? '')
    newStem = `${rules.prefix ?? ''}${newStem}${rules.suffix ?? ''}`
    if (rules.sequence) {
      newStem += `_${String(seq).padStart(Math.max(1, rules.sequence.digits), '0')}`
      seq += Math.max(1, rules.sequence.step)
    }
    const newExt = rules.extLower ? ext.toLowerCase() : ext
    const to = newStem + newExt
    targetCount.set(to, (targetCount.get(to) ?? 0) + 1)
    return { from: name, to, conflict: false, unchanged: to === name }
  })

  for (const pair of plan) {
    if (pair.unchanged) {
      pair.reason = '名字未变化'
      continue
    }
    if ((targetCount.get(pair.to) ?? 0) > 1) {
      pair.conflict = true
      pair.reason = `多个文件重命名为「${pair.to}」`
      continue
    }
    if (known.has(pair.to)) {
      // 目标名被占用：若占用者自己也会改名离开，则不算冲突
      const occupantMoves = plan.some(p => p.from === pair.to && p.to !== pair.to)
      if (!occupantMoves) {
        pair.conflict = true
        pair.reason = `目标名「${pair.to}」已存在`
      }
    }
  }
  return plan
}
