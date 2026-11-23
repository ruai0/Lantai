import { dialog, shell } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import type { PickFilesParams, PickedFile } from '@shared/types'
import { handle } from './wrapper'
import { uniquePath } from '../services/fileUtils'
import { expandPaths } from '../services/expandService'

/** 会话内记住上次打开的目录，让文件/文件夹对话框从原地继续。
 *  只存内存不落盘：设置层约定「不记忆文件路径」，跨重启不保留。 */
let lastFilePickDir = ''
let lastDirPickDir = ''

handle('dialog:pick-files', async (p?: PickFilesParams): Promise<string[]> => {
  const res = await dialog.showOpenDialog({
    title: p?.title ?? '选择文件',
    defaultPath: lastFilePickDir || undefined,
    properties: p?.multiple === false ? ['openFile'] : ['openFile', 'multiSelections'],
    filters: p?.filters ?? [{ name: '所有文件', extensions: ['*'] }]
  })
  if (!res.canceled && res.filePaths.length) lastFilePickDir = path.dirname(res.filePaths[0])
  return res.canceled ? [] : res.filePaths
})

handle('dialog:pick-directory', async (title?: string): Promise<string | null> => {
  const res = await dialog.showOpenDialog({
    title: title ?? '选择输出文件夹',
    defaultPath: lastDirPickDir || undefined,
    properties: ['openDirectory', 'createDirectory']
  })
  if (!res.canceled && res.filePaths.length) lastDirPickDir = res.filePaths[0]
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

/** 读原始字节：渲染层 pdf.js 直接吃 Uint8Array，免去 base64 往返 + atob 解码（大文件明显快） */
handle('file:read-bytes', async (p: { path: string }): Promise<Uint8Array> => {
  const stat = await fs.promises.stat(p.path)
  if (stat.size > 150 * 1024 * 1024) throw new Error(`文件过大（超过 150MB）：${path.basename(p.path)}`)
  return new Uint8Array(await fs.promises.readFile(p.path))
})

handle('file:write-binary', async (p: { dir: string; name: string; base64: string }): Promise<{ path: string }> => {
  const out = uniquePath(p.dir, p.name)
  await fs.promises.writeFile(out, Buffer.from(p.base64, 'base64'))
  return { path: out }
})

/**
 * 拖入路径混合展开（#5 拖入整个文件夹）：逻辑在 expandService（可单测），这里只做通道注册。
 */
handle('file:expand-paths', (p: { paths: string[]; exts?: string[]; max?: number }) => expandPaths(p))
