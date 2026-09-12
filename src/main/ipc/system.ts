import { dialog, shell } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import type { PickFilesParams, PickedFile } from '@shared/types'
import { handle } from './wrapper'
import { uniquePath } from '../services/fileUtils'

handle('dialog:pick-files', async (p?: PickFilesParams): Promise<string[]> => {
  const res = await dialog.showOpenDialog({
    title: p?.title ?? '选择文件',
    properties: p?.multiple === false ? ['openFile'] : ['openFile', 'multiSelections'],
    filters: p?.filters ?? [{ name: '所有文件', extensions: ['*'] }]
  })
  return res.canceled ? [] : res.filePaths
})

handle('dialog:pick-directory', async (title?: string): Promise<string | null> => {
  const res = await dialog.showOpenDialog({
    title: title ?? '选择输出文件夹',
    properties: ['openDirectory', 'createDirectory']
  })
  return res.canceled || res.filePaths.length === 0 ? null : res.filePaths[0]
})

handle('shell:open-path', async (target: string): Promise<boolean> => {
  const err = await shell.openPath(target)
  if (err) throw new Error(err)
  return true
})

handle('file:read-many', async (paths: string[]): Promise<PickedFile[]> => {
  const out: PickedFile[] = []
  for (const p of paths) {
    const stat = await fs.promises.stat(p)
    if (stat.size > 150 * 1024 * 1024) throw new Error(`文件过大（超过 150MB）：${path.basename(p)}`)
    const buf = await fs.promises.readFile(p)
    out.push({ path: p, name: path.basename(p), base64: buf.toString('base64') })
  }
  return out
})

handle('file:write-binary', async (p: { dir: string; name: string; base64: string }): Promise<{ path: string }> => {
  const out = uniquePath(p.dir, p.name)
  await fs.promises.writeFile(out, Buffer.from(p.base64, 'base64'))
  return { path: out }
})

/**
 * 拖入路径混合展开（#5 拖入整个文件夹）：目录递归收集符合扩展名的文件，
 * 文件原样保留（类型不符计入 rejected）。跳过隐藏目录与 node_modules，封顶 max 个防误拖全盘。
 */
handle(
  'file:expand-paths',
  async (p: { paths: string[]; exts?: string[]; max?: number }): Promise<{
    files: string[]
    dirs: number
    rejected: number
    truncated: boolean
  }> => {
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
)
