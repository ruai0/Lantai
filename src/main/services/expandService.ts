import fs from 'node:fs'
import path from 'node:path'
import type { ExpandPathsResult } from '@shared/types'

/**
 * 拖入路径混合展开（#5 拖入整个文件夹）：目录递归收集符合扩展名的文件，
 * 文件原样保留（类型不符计入 rejected）。跳过隐藏目录与 node_modules，封顶 max 个防误拖全盘。
 * 纯逻辑 + fs，可单测。
 */
export async function expandPaths(p: { paths: string[]; exts?: string[]; max?: number }): Promise<ExpandPathsResult> {
  const extSet = p.exts?.length ? new Set(p.exts.map(e => e.replace(/^\./, '').toLowerCase())) : null
  const max = p.max ?? 2000
  const files: string[] = []
  let dirs = 0
  let rejected = 0
  let truncated = false
  const keep = (absPath: string): void => {
    if (files.length >= max) {
      truncated = true
      return
    }
    files.push(absPath)
  }
  const stack = [...p.paths]
  while (stack.length && !truncated) {
    const cur = stack.pop()!
    let st: fs.Stats
    try {
      st = await fs.promises.stat(cur)
    } catch {
      rejected++
      continue
    }
    if (!st.isDirectory()) {
      const ext = path.extname(cur).replace(/^\./, '').toLowerCase()
      if (extSet && !extSet.has(ext)) rejected++
      else keep(cur)
      continue
    }
    dirs++
    let ents: fs.Dirent[]
    try {
      ents = await fs.promises.readdir(cur, { withFileTypes: true })
    } catch {
      continue
    }
    for (const e of ents) {
      const full = path.join(cur, e.name)
      if (e.isDirectory()) {
        if (!e.name.startsWith('.') && e.name !== 'node_modules') stack.push(full)
      } else if (e.isFile() && !e.name.startsWith('.')) {
        const ext = path.extname(e.name).replace(/^\./, '').toLowerCase()
        if (extSet && !extSet.has(ext)) rejected++
        else keep(full)
        if (truncated) break
      }
    }
  }
  return { files: files.sort(), dirs, rejected, truncated }
}
