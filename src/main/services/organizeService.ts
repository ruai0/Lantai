import path from 'node:path'
import type { OrganizeMode, OrganizePair } from '@shared/types'

/** 生成归类计划（纯函数）：ext→按扩展名，month→按修改年月，year→按修改年份 */
export function buildOrganizePlan(
  entries: Array<{ name: string; mtimeMs: number }>,
  mode: OrganizeMode
): OrganizePair[] {
  return entries.map(e => {
    let folder: string
    if (mode === 'ext') {
      const ext = path.extname(e.name).replace('.', '').toLowerCase()
      folder = ext || '其他'
    } else {
      const d = new Date(e.mtimeMs)
      const y = String(d.getFullYear())
      folder = mode === 'year' ? y : `${y}-${String(d.getMonth() + 1).padStart(2, '0')}`
    }
    return { from: e.name, to: `${folder}/${e.name}`, conflict: false }
  })
}
