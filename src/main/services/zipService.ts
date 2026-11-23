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

/** 把若干文件（保持相对 srcRoot 的目录结构）或整个文件夹打包成一个 zip */
export async function packZip(
  params: ZipPackParams,
  onProgress?: (done: number, total: number) => void,
  isCancelled?: () => boolean
): Promise<{ outputPath: string; count: number }> {
  const files: WalkedFile[] = []
  let defaultBase = 'archive'
  if (params.paths && params.paths.length) {
    // 挑选文件模式：以共同父目录为根，保留层级；单文件时取其文件名
    const root = commonRoot(params.paths)
    defaultBase = path.basename(root) || 'archive'
    for (const p of params.paths) {
      if (isCancelled?.()) throw new TaskCancelledError()
      if (!fs.existsSync(p) || !fs.statSync(p).isFile()) continue
      const rel = path.relative(root, p).split(path.sep).join('/') || path.basename(p)
      files.push({ relPath: rel, fullPath: p })
    }
    if (files.length === 0) throw new Error('没有可打包的文件')
  } else {
    if (!params.dir || !fs.existsSync(params.dir) || !fs.statSync(params.dir).isDirectory()) {
      throw new Error('请选择要打包的文件夹（或选择若干文件）')
    }
    walk(params.dir, params.dir, files)
    if (files.length === 0) throw new Error('该文件夹里没有文件')
    defaultBase = path.basename(params.dir) || 'archive'
  }
  const zip = new PizZip()
  let done = 0
  for (const f of files) {
    if (isCancelled?.()) throw new TaskCancelledError()
    zip.file(f.relPath, fs.readFileSync(f.fullPath), { binary: true })
    onProgress?.(++done, files.length)
  }
  const zn = (params.zipName?.trim() ?? '').replace(/\.zip$/i, '').trim()
  const name = (zn || defaultBase) + '.zip'
  // 压缩级别：store = 仅打包不压缩（最快）；9 = 最高压缩（最小体积）
  const level = params.level ?? 'normal'
  let content: Buffer
  if (level === 'store') {
    content = zip.generate({ type: 'nodebuffer', compression: 'STORE' })
  } else {
    const opt = { type: 'nodebuffer' as const, compression: 'DEFLATE' as const, compressionOptions: { level: (level === 'max' ? 9 : 6) as 9 | 6 } }
    content = zip.generate(opt)
  }
  const out = uniquePath(params.outDir, name)
  await fs.promises.writeFile(out, content)
  return { outputPath: out, count: files.length }
}

/**
 * 检测 zip 是否加密：遍历中央目录区的每个条目，检查通用位标志（General Purpose Bit Flag）的 bit 0。
 * PizZip（JSZip 分支）不支持加密条目，会抛“文件损坏”之类的误导性错误，这里提前甄别。
 */
function detectEncryptedZip(buf: Buffer): boolean {
  const EOCD_SIG = 0x06054b50
  const CEN_SIG = 0x02014b50
  // 1) 从尾部往前找 End Of Central Directory（最多扫描 64KB + 22 字节）
  let eocd = -1
  const scanStart = Math.max(0, buf.length - 65557)
  for (let i = buf.length - 22; i >= scanStart; i--) {
    if (buf.readUInt32LE(i) === EOCD_SIG) {
      eocd = i
      break
    }
  }
  if (eocd < 0) return false
  // 2) 定位中央目录起始偏移与条目数
  const cenOffset = buf.readUInt32LE(eocd + 16)
  let p = cenOffset
  // 3) 逐个条目读取 flag 字段（偏移 +8）
  while (p + 46 <= buf.length && buf.readUInt32LE(p) === CEN_SIG) {
    const flag = buf.readUInt16LE(p + 8)
    if ((flag & 0x0001) !== 0) return true
    const nameLen = buf.readUInt16LE(p + 28)
    const extraLen = buf.readUInt16LE(p + 30)
    const commentLen = buf.readUInt16LE(p + 32)
    p += 46 + nameLen + extraLen + commentLen
  }
  return false
}

/** 求若干文件路径的最长公共目录 */
function commonRoot(paths: string[]): string {
  if (paths.length === 1) return path.dirname(paths[0])
  const split = paths.map(p => path.dirname(p).split(path.sep))
  const first = split[0]
  let i = 0
  for (; i < first.length; i++) {
    if (!split.every(s => s[i] === first[i])) break
  }
  const root = first.slice(0, i).join(path.sep) || path.sep
  // 若共同父目录恰好是某个文件本身所在目录，仍以它为根即可
  return root
}

/** 列出 zip 将包含的文件清单（打包前预览，避免盲打包） */
export async function listZipContents(params: {
  dir?: string
  paths?: string[]
}): Promise<{ files: Array<{ rel: string; sizeBytes: number }>; totalBytes: number }> {
  const files: WalkedFile[] = []
  if (params.paths && params.paths.length) {
    const root = commonRoot(params.paths)
    for (const p of params.paths) {
      if (!fs.existsSync(p) || !fs.statSync(p).isFile()) continue
      const rel = path.relative(root, p).split(path.sep).join('/') || path.basename(p)
      files.push({ relPath: rel, fullPath: p })
    }
  } else if (params.dir && fs.existsSync(params.dir) && fs.statSync(params.dir).isDirectory()) {
    walk(params.dir, params.dir, files)
  }
  let totalBytes = 0
  const list = files.map(f => {
    const sizeBytes = fs.statSync(f.fullPath).size
    totalBytes += sizeBytes
    return { rel: f.relPath, sizeBytes }
  })
  return { files: list, totalBytes }
}

/** 解压 zip（或一批 zip），每个包解到独立子文件夹，绝不覆盖输出目录已有文件 */
export async function unpackZip(params: ZipUnpackParams): Promise<ZipUnpackResult> {
  if (params.paths.length === 0) throw new Error('请先选择 zip 文件')
  const outputs: string[] = []
  for (const p of params.paths) {
    const buf = await fs.promises.readFile(p)
    // 加密 zip 的目录区含 flag bit 0，PizZip 不支持读取——提前给出准确提示而不是误报“文件损坏”
    const encrypted = detectEncryptedZip(buf)
    if (encrypted) {
      throw new Error(`该 zip 已加密，暂不支持解压：${path.basename(p)}`)
    }
    let zip: PizZip
    try {
      zip = new PizZip(buf)
    } catch {
      throw new Error(`无法读取 zip 文件（可能不是有效的 zip）：${path.basename(p)}`)
    }
    const dest = uniquePath(params.outDir, `${path.basename(p, path.extname(p))}`)
    fs.mkdirSync(dest, { recursive: true })
    const destAbs = path.resolve(dest)
    let count = 0
    for (const name of Object.keys(zip.files)) {
      const entry = zip.files[name]
      // Zip Slip 防护：统一分隔符、逐段剔除 . 与 ..、丢弃绝对路径前缀，再解析并强制约束在 dest 内
      const rel = name
        .replace(/\\/g, '/')
        .split('/')
        .filter(seg => seg && seg !== '.' && seg !== '..')
        .join('/')
      if (!rel) continue
      const target = path.resolve(destAbs, rel)
      if (target !== destAbs && !target.startsWith(destAbs + path.sep)) continue
      if (entry.dir || name.endsWith('/')) {
        fs.mkdirSync(target, { recursive: true })
        continue
      }
      fs.mkdirSync(path.dirname(target), { recursive: true })
      fs.writeFileSync(target, entry.asNodeBuffer())
      count++
    }
    if (count === 0) throw new Error(`zip 里没有文件：${path.basename(p)}`)
    outputs.push(dest)
  }
  return { outputs }
}
