import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import ExcelJS from 'exceljs'
import type {
  DuplicateExportParams,
  DuplicateFile,
  DuplicateFindParams,
  DuplicateGroup,
  DuplicateResult,
  InventoryParams,
  InventoryResult
} from '@shared/types'
import { uniquePath } from './fileUtils'

export interface FileEntry {
  path: string
  /** 相对目录的路径（含子文件夹） */
  relPath: string
  name: string
  ext: string
  sizeBytes: number
  mtimeMs: number
}

async function walkFiles(dir: string, recursive: boolean, out: FileEntry[], root: string): Promise<void> {
  let items: fs.Dirent[]
  try {
    items = await fs.promises.readdir(dir, { withFileTypes: true })
  } catch {
    throw new Error(`无法读取文件夹：${dir}`)
  }
  for (const it of items) {
    const full = path.join(dir, it.name)
    if (it.isDirectory()) {
      if (recursive) await walkFiles(full, recursive, out, root)
      continue
    }
    if (!it.isFile()) continue
    const stat = await fs.promises.stat(full)
    out.push({
      path: full,
      relPath: path.relative(root, full),
      name: it.name,
      ext: path.extname(it.name).toLowerCase(),
      sizeBytes: stat.size,
      mtimeMs: stat.mtimeMs
    })
  }
}

/** 字节数 → 人类可读大小（纯函数，供测试） */
export function humanSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let v = bytes
  let u = 0
  while (v >= 1024 && u < units.length - 1) {
    v /= 1024
    u++
  }
  return u === 0 ? `${v} B` : `${v.toFixed(v >= 100 ? 0 : 1)} ${units[u]}`
}

function fmtTime(mtimeMs: number): string {
  const d = new Date(mtimeMs)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

/* ---------- 文件清单导出 ---------- */

export async function exportInventory(params: InventoryParams): Promise<InventoryResult> {
  const entries: FileEntry[] = []
  await walkFiles(params.dir, params.recursive, entries, params.dir)
  if (entries.length === 0) throw new Error('该文件夹里没有文件')
  entries.sort((a, b) => a.relPath.localeCompare(b.relPath, 'zh-CN'))

  const wb = new ExcelJS.Workbook()
  const ws = wb.addWorksheet('文件清单')
  ws.addRow(['序号', '文件名', '类型', '大小', '修改时间', '相对路径'])
  ws.getRow(1).font = { bold: true }
  entries.forEach((e, i) => {
    ws.addRow([
      i + 1,
      e.name,
      e.ext ? e.ext.slice(1).toUpperCase() : '',
      humanSize(e.sizeBytes),
      fmtTime(e.mtimeMs),
      e.relPath
    ])
  })
  ws.getColumn(2).width = 40
  ws.getColumn(6).width = 60
  const out = uniquePath(params.outDir, `文件清单_${new Date().toISOString().slice(0, 10)}.xlsx`)
  await wb.xlsx.writeFile(out)
  return { count: entries.length, outputPath: out }
}

/* ---------- 重复文件查找 ---------- */

async function walkForDup(
  dir: string,
  recursive: boolean,
  minSizeBytes: number,
  out: FileEntry[],
  root: string
): Promise<void> {
  const items = await fs.promises.readdir(dir, { withFileTypes: true }).catch(() => [])
  for (const it of items) {
    const full = path.join(dir, it.name)
    if (it.isDirectory()) {
      if (recursive) await walkForDup(full, recursive, minSizeBytes, out, root)
      continue
    }
    if (!it.isFile()) continue
    const stat = await fs.promises.stat(full).catch(() => null)
    if (!stat || stat.size < minSizeBytes) continue
    out.push({
      path: full,
      relPath: path.relative(root, full),
      name: it.name,
      ext: path.extname(it.name).toLowerCase(),
      sizeBytes: stat.size,
      mtimeMs: stat.mtimeMs
    })
  }
}

async function md5File(p: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash('md5')
    const stream = fs.createReadStream(p)
    stream.on('data', d => hash.update(d))
    stream.on('error', reject)
    stream.on('end', () => resolve(hash.digest('hex')))
  })
}

/** 按内容哈希把候选文件归并成重复组（纯函数，供测试；hasher 可注入） */
export async function groupDuplicates(
  candidates: FileEntry[],
  hasher: (p: string) => Promise<string>
): Promise<DuplicateGroup[]> {
  // 先按体积分组，只有同体积的才可能内容相同
  const bySize = new Map<number, FileEntry[]>()
  for (const e of candidates) {
    const arr = bySize.get(e.sizeBytes) ?? []
    arr.push(e)
    bySize.set(e.sizeBytes, arr)
  }
  const needHash: FileEntry[] = []
  for (const arr of bySize.values()) if (arr.length > 1) needHash.push(...arr)

  const byHash = new Map<string, FileEntry[]>()
  for (const e of needHash) {
    const h = await hasher(e.path)
    const arr = byHash.get(h) ?? []
    arr.push(e)
    byHash.set(h, arr)
  }
  const groups: DuplicateGroup[] = []
  for (const [hash, files] of byHash) {
    if (files.length < 2) continue
    files.sort((a, b) => a.relPath.localeCompare(b.relPath, 'zh-CN'))
    groups.push({ hash, sizeBytes: files[0].sizeBytes, files: files.map(toDuplicateFile) })
  }
  groups.sort((a, b) => b.sizeBytes * (b.files.length - 1) - a.sizeBytes * (a.files.length - 1))
  return groups
}

function toDuplicateFile(e: FileEntry): DuplicateFile {
  return { path: e.path, name: e.name, sizeBytes: e.sizeBytes }
}

export async function findDuplicates(params: DuplicateFindParams): Promise<DuplicateResult> {
  const minSizeKB = Math.max(1, params.minSizeKB || 100)
  const entries: FileEntry[] = []
  await walkForDup(params.dir, params.recursive, minSizeKB * 1024, entries, params.dir)
  const groups = await groupDuplicates(entries, md5File)
  return { groups, scanned: entries.length }
}

export async function exportDuplicateReport(
  params: DuplicateExportParams
): Promise<{ outputPath: string }> {
  const wb = new ExcelJS.Workbook()
  const ws = wb.addWorksheet('重复文件')
  ws.addRow(['组号', '大小', '文件名', '所在路径', 'MD5'])
  ws.getRow(1).font = { bold: true }
  params.groups.forEach((g, i) => {
    g.files.forEach((f, j) => {
      ws.addRow([
        j === 0 ? i + 1 : '',
        j === 0 ? humanSize(g.sizeBytes) : '',
        f.name,
        f.path,
        j === 0 ? g.hash : ''
      ])
    })
  })
  ws.getColumn(3).width = 40
  ws.getColumn(4).width = 70
  const out = uniquePath(params.outDir, `重复文件报告_${new Date().toISOString().slice(0, 10)}.xlsx`)
  await wb.xlsx.writeFile(out)
  return { outputPath: out }
}
