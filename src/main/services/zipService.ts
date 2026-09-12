import fs from 'node:fs'
import path from 'node:path'
import PizZip from 'pizzip'
import type { ZipPackParams, ZipUnpackParams, ZipUnpackResult } from '@shared/types'
import { uniquePath } from './fileUtils'
import { TaskCancelledError } from './taskProgress'

interface WalkedFile {
  relPath: string
  fullPath: string
}

function walk(dir: string, root: string, out: WalkedFile[]): void {
  for (const it of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, it.name)
    if (it.isDirectory()) walk(full, root, out)
    else if (it.isFile()) out.push({ relPath: path.relative(root, full).split(path.sep).join('/'), fullPath: full })
  }
}

/** 把整个文件夹打包成一个 zip（保持子文件夹结构） */
export async function packZip(
  params: ZipPackParams,
  onProgress?: (done: number, total: number) => void,
  isCancelled?: () => boolean
): Promise<{ outputPath: string; count: number }> {
  if (!fs.existsSync(params.dir) || !fs.statSync(params.dir).isDirectory()) {
    throw new Error('请选择要打包的文件夹')
  }
  const files: WalkedFile[] = []
  walk(params.dir, params.dir, files)
  if (files.length === 0) throw new Error('该文件夹里没有文件')
  const zip = new PizZip()
  let done = 0
  for (const f of files) {
    if (isCancelled?.()) throw new TaskCancelledError()
    zip.file(f.relPath, fs.readFileSync(f.fullPath), { binary: true })
    onProgress?.(++done, files.length)
  }
  const name = (params.zipName?.trim() || path.basename(params.dir) || 'archive') + '.zip'
  const content = zip.generate({ type: 'nodebuffer', compression: 'DEFLATE' })
  const out = uniquePath(params.outDir, name)
  await fs.promises.writeFile(out, content)
  return { outputPath: out, count: files.length }
}

/** 解压 zip（或一批 zip），每个包解到独立子文件夹，绝不覆盖输出目录已有文件 */
export async function unpackZip(params: ZipUnpackParams): Promise<ZipUnpackResult> {
  if (params.paths.length === 0) throw new Error('请先选择 zip 文件')
  const outputs: string[] = []
  for (const p of params.paths) {
    const buf = await fs.promises.readFile(p)
    let zip: PizZip
    try {
      zip = new PizZip(buf)
    } catch {
      throw new Error(`无法读取 zip 文件（可能不是有效的 zip）：${path.basename(p)}`)
    }
    const dest = uniquePath(params.outDir, `${path.basename(p, path.extname(p))}`)
    fs.mkdirSync(dest, { recursive: true })
    let count = 0
    for (const name of Object.keys(zip.files)) {
      const entry = zip.files[name]
      const safe = name.replace(/\.\./g, '_')
      if (entry.dir || name.endsWith('/')) {
        fs.mkdirSync(path.join(dest, safe), { recursive: true })
        continue
      }
      const target = path.join(dest, safe)
      fs.mkdirSync(path.dirname(target), { recursive: true })
      fs.writeFileSync(target, entry.asNodeBuffer())
      count++
    }
    if (count === 0) throw new Error(`zip 里没有文件：${path.basename(p)}`)
    outputs.push(dest)
  }
  return { outputs }
}
