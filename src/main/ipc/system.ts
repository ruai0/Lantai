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
