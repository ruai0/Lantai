import fs from 'node:fs'
import path from 'node:path'
import ExcelJS from 'exceljs'
import iconv from 'iconv-lite'
import type {
  DataRecord,
  ExcelCsvParams,
  ExcelMergeMode,
  ExcelMergeParams,
  ExcelMaskParams,
  ExcelSplitColumnParams,
  ExcelSplitRowsParams,
  ExcelSplitSheetParams,
  MaskPreview,
  MaskRule
} from '@shared/types'
import { sanitizeFilename, stemOf, uniquePath } from './fileUtils'

type CellValue = ExcelJS.CellValue

/** 读取一个工作簿（缓存所有 sheet 的二维值数组 + 表头行号信息） */
interface SheetData {
  name: string
  rows: CellValue[][]
}

async function readSheets(filePath: string): Promise<SheetData[]> {
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.readFile(filePath)
  const out: SheetData[] = []
  for (const ws of wb.worksheets) {
    const rows: CellValue[][] = []
    for (let r = 1; r <= ws.rowCount; r++) {
      const row = ws.getRow(r)
      const values: CellValue[] = []
      for (let c = 1; c <= ws.columnCount; c++) values.push(row.getCell(c).value)
      rows.push(values)
    }
    out.push({ name: ws.name, rows })
  }
  return out
}

function newWorkbookWithSheets(sheets: Array<{ name: string; rows: CellValue[][] }>): ExcelJS.Workbook {
  const wb = new ExcelJS.Workbook()
  for (const s of sheets) {
    const ws = wb.addWorksheet(s.name)
    for (const row of s.rows) ws.addRow(row)
  }
  return wb
}

/** 单元格值 → 普通值（保留数字/日期原样，富文本与公式结果转文本） */
function plainValue(v: CellValue): CellValue {
  if (v === null || v === undefined) return ''
  if (v instanceof Date) return v
  if (typeof v === 'object') {
    const obj = v as unknown as Record<string, unknown>
    if (Array.isArray(obj.richText)) {
      return (obj.richText as Array<{ text?: string }>).map(t => t.text ?? '').join('')
    }
    if ('result' in obj) return plainValue(obj.result as CellValue)
    if ('text' in obj) return plainValue(obj.text as CellValue)
    return ''
  }
  return v
}

/* ---------- 多簿合并 ---------- */

function headerText(v: CellValue): string {
  const s = plainValue(v)
  if (typeof s === 'string') return s.trim()
  if (s === null || s === undefined) return ''
  return String(s)
}

export async function mergeWorkbooks(params: ExcelMergeParams): Promise<{ outputs: string[] }> {
  if (params.paths.length < 2) throw new Error('合并至少需要选择两个 Excel 文件')
  const all: Array<{ file: string; sheets: SheetData[] }> = []
  for (const p of params.paths) all.push({ file: p, sheets: await readSheets(p) })

  let sheets: Array<{ name: string; rows: CellValue[][] }>
  if (params.mode === 'sheets') {
    // 单 sheet 的簿用文件名做表名（合并多个 Sheet1 时一眼能认出来），多 sheet 保留原名
    const used = new Set<string>()
    sheets = []
    for (const item of all) {
      const base = sanitizeFilename(stemOf(item.file)) || '表'
      for (const s of item.sheets) {
        let name = item.sheets.length === 1 ? base : s.name || base
        let n = 2
        while (used.has(name)) name = `${base}_${n++}`
        used.add(name)
        sheets.push({ name, rows: s.rows })
      }
    }
  } else {
    // 各文件第一个工作表合并成一张表：表头按出现顺序取并集，按列名对齐
    const headers: string[] = []
    const seen = new Set<string>()
    for (const item of all) {
      const first = item.sheets[0]
      if (!first || first.rows.length === 0) continue
      for (const v of first.rows[0]) {
        const h = headerText(v)
        if (h && !seen.has(h)) {
          seen.add(h)
          headers.push(h)
        }
      }
    }
    if (headers.length === 0) throw new Error('没有在所选文件的第一个工作表里找到表头（第 1 行）')
    const rows: CellValue[][] = [headers]
    for (const item of all) {
      const first = item.sheets[0]
      if (!first || first.rows.length === 0) continue
      const localHeaders = first.rows[0].map(headerText)
      for (let r = 1; r < first.rows.length; r++) {
        const row = first.rows[r]
        if (row.every(v => v === null || v === undefined || v === '')) continue
        const out: CellValue[] = new Array(headers.length).fill('')
        localHeaders.forEach((h, c) => {
          const idx = headers.indexOf(h)
          if (idx >= 0) out[idx] = plainValue(row[c])
        })
        rows.push(out)
      }
    }
    sheets = [{ name: '合并结果', rows }]
  }

  const wb = newWorkbookWithSheets(sheets)
  const out = uniquePath(params.outDir, `Excel合并_${new Date().toISOString().slice(0, 10)}.xlsx`)
  await wb.xlsx.writeFile(out)
  return { outputs: [out] }
}

/* ---------- 按 Sheet 拆分 ---------- */

export async function splitBySheets(params: ExcelSplitSheetParams): Promise<{ outputs: string[] }> {
  const sheets = await readSheets(params.path)
  if (sheets.length <= 1) throw new Error('该文件只有一个工作表，无需拆分')
  const base = stemOf(params.path)
  const outputs: string[] = []
  for (const s of sheets) {
    const wb = newWorkbookWithSheets([{ name: s.name, rows: s.rows }])
    const out = uniquePath(params.outDir, `${base}_${sanitizeFilename(s.name)}.xlsx`)
    await wb.xlsx.writeFile(out)
    outputs.push(out)
  }
  return { outputs }
}

/* ---------- 按行数拆分 ---------- */

export async function splitByRows(params: ExcelSplitRowsParams): Promise<{ outputs: string[] }> {
  const n = params.rowsPerFile
  if (!Number.isInteger(n) || n < 1) throw new Error('每个文件的行数必须是正整数')
  const sheets = await readSheets(params.path)
  const first = sheets[0]
  if (!first || first.rows.length <= 1) throw new Error('该文件没有可拆分的数据行（第 1 行为表头）')
  const header = first.rows[0]
  const dataRows = first.rows.slice(1).filter(r => !r.every(v => v === null || v === undefined || v === ''))
  if (dataRows.length === 0) throw new Error('该文件除表头外没有数据行')
  const base = stemOf(params.path)
  const outputs: string[] = []
  for (let start = 0; start < dataRows.length; start += n) {
    const chunk = dataRows.slice(start, start + n)
    const end = start + chunk.length
    const wb = newWorkbookWithSheets([{ name: first.name, rows: [header, ...chunk] }])
    const out = uniquePath(params.outDir, `${base}_第${start + 1}-${end}行.xlsx`)
    await wb.xlsx.writeFile(out)
    outputs.push(out)
  }
  return { outputs }
}

/* ---------- 按列值拆分 ---------- */

export async function splitByColumn(params: ExcelSplitColumnParams): Promise<{ outputs: string[]; groups: number }> {
  const sheets = await readSheets(params.path)
  const first = sheets[0]
  if (!first || first.rows.length <= 1) throw new Error('该文件没有可拆分的数据行（第 1 行为表头）')
  const header = first.rows[0]
  const colIdx = header.findIndex(h => headerText(h) === params.column)
  if (colIdx < 0) throw new Error(`找不到列「${params.column}」，请检查表头`)

  const groups = new Map<string, CellValue[][]>()
  for (let r = 1; r < first.rows.length; r++) {
    const row = first.rows[r]
    if (row.every(v => v === null || v === undefined || v === '')) continue
    const raw = row[colIdx]
    const key = headerText(raw === null || raw === undefined ? '' : raw) || '空值'
    const arr = groups.get(key) ?? []
    arr.push(row)
    groups.set(key, arr)
  }
  if (groups.size === 0) throw new Error('该列没有有效数据')
  if (groups.size === 1) throw new Error(`「${params.column}」列只有一种值，无需拆分`)

  const base = stemOf(params.path)
  const outputs: string[] = []
  for (const [key, rows] of groups) {
    const wb = newWorkbookWithSheets([{ name: first.name, rows: [header, ...rows] }])
    const out = uniquePath(params.outDir, `${base}_${sanitizeFilename(key)}.xlsx`)
    await wb.xlsx.writeFile(out)
    outputs.push(out)
  }
  return { outputs, groups: groups.size }
}

/* ---------- CSV → Excel ---------- */

/** 解析 CSV 文本为二维数组；支持双引号包裹、转义引号与换行 */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let inQuotes = false
  let i = 0
  const push = () => {
    row.push(field)
    field = ''
    if (!inQuotes && row.some(v => v !== '')) {
      rows.push(row)
      row = []
    }
  }
  while (i < text.length) {
    const ch = text[i]
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"'
          i += 2
          continue
        }
        inQuotes = false
        i++
        continue
      }
      field += ch
      i++
      continue
    }
    if (ch === '"') {
      inQuotes = true
      i++
      continue
    }
    if (ch === ',') {
      row.push(field)
      field = ''
      i++
      continue
    }
    if (ch === '\r') {
      i++
      continue
    }
    if (ch === '\n') {
      push()
      i++
      continue
    }
    field += ch
    i++
  }
  if (field !== '' || row.length > 0) push()
  return rows
}

/** 根据首行猜测分隔符（逗号 / 制表符 / 分号） */
export function detectDelimiter(line: string): string {
  const counts: Array<[string, number]> = [
    [',', 0],
    ['\t', 0],
    [';', 0]
  ]
  for (const d of counts) d[1] = line.split(d[0]).length - 1
  counts.sort((a, b) => b[1] - a[1])
  return counts[0][1] > 0 ? counts[0][0] : ','
}

function csvWithDelimiter(text: string, delimiter: string): string[][] {
  if (delimiter === ',') return parseCsv(text)
  const swapped = text
    .replace(/"([^"]*)"/g, (_m, g1: string) => `\u0000${g1.replace(new RegExp(delimiter, 'g'), ',')}\u0001`)
    .split(delimiter)
    .join(',')
    .replace(/\u0000/g, '')
    .replace(/\u0001/g, '')
  return parseCsv(swapped)
}

export async function csvToXlsx(params: ExcelCsvParams): Promise<{ outputs: string[] }> {
  if (params.paths.length === 0) throw new Error('请先选择 CSV 文件')
  const outputs: string[] = []
  for (const p of params.paths) {
    const buf = await fs.promises.readFile(p)
    const text = (
      params.encoding === 'gbk' ? iconv.decode(buf, 'gbk') : buf.toString('utf-8')
    ).replace(/^\uFEFF/, '')
    if (!text.trim()) throw new Error(`CSV 文件是空的：${path.basename(p)}`)
    const rows = csvWithDelimiter(text, detectDelimiter(text.split(/\r?\n/, 2)[0] ?? ''))
    const wb = new ExcelJS.Workbook()
    const ws = wb.addWorksheet('Sheet1')
    for (const row of rows) {
      // 纯数字转数值方便求和；但保留前导零（区号、手机号 0 开头编码）与超长数字（证件号）
      if (row.length === 0) continue
      ws.addRow(
        row.map(v =>
          /^-?\d+(\.\d+)?$/.test(v) && v.length < 15 && !/^0\d/.test(v) ? Number(v) : v
        )
      )
    }
    const out = uniquePath(params.outDir, `${stemOf(p)}.xlsx`)
    await wb.xlsx.writeFile(out)
    outputs.push(out)
  }
  return { outputs }
}

/* ---------- 数据脱敏 ---------- */

/** 按001规则打码单个值（纯函数，供测试） */
export function maskValue(text: string, rule: MaskRule, keepHead = 0, keepTail = 0): string {
  const s = (text ?? '').trim()
  if (!s) return s
  const chars = [...s]
  const n = chars.length
  const mask = (head: number, tail: number): string => {
    const h = Math.max(0, Math.min(Math.floor(head), n))
    const t = Math.max(0, Math.min(Math.floor(tail), n - h))
    const mid = n - h - t
    return (
      chars.slice(0, h).join('') +
      '*'.repeat(mid) +
      (t > 0 ? chars.slice(n - t).join('') : '')
    )
  }
  switch (rule) {
    case 'phone':
      return mask(3, 4)
    case 'idcard':
      return mask(4, 4)
    case 'name':
      return n === 1 ? s : mask(1, n >= 3 ? 1 : 0)
    case 'custom':
      return mask(keepHead, keepTail)
  }
}

export async function desensitize(
  params: ExcelMaskParams
): Promise<{ outputs: string[]; previews: MaskPreview[] }> {
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.readFile(params.path)
  const ws = wb.worksheets[0]
  if (!ws) throw new Error('该文件没有工作表')
  const headers = new Map<number, string>()
  ws.getRow(1).eachCell((cell, col) => {
    const name = typeof cell.value === 'string' ? cell.value.trim() : String(cell.value ?? '').trim()
    if (name) headers.set(col, name)
  })
  const targets: number[] = []
  for (const col of params.columns) {
    let found: number | null = null
    for (const [c, name] of headers) {
      if (name === col) {
        found = c
        break
      }
    }
    if (found === null) throw new Error(`找不到列「${col}」，请检查表头`)
    targets.push(found)
  }
  if (targets.length === 0) throw new Error('请至少选择一个要脱敏的列')

  const previews: MaskPreview[] = []
  const samplesOf = new Map<number, Array<{ original: string; masked: string }>>()
  for (let r = 2; r <= ws.rowCount; r++) {
    const row = ws.getRow(r)
    for (const col of targets) {
      const cell = row.getCell(col)
      const original = typeof cell.value === 'string' ? cell.value : String(cell.value ?? '')
      if (!original.trim()) continue
      const masked = maskValue(
        original,
        params.rule,
        params.keepHead ?? 0,
        params.keepTail ?? 0
      )
      if (masked !== original) cell.value = masked
      const arr = samplesOf.get(col) ?? []
      if (arr.length < 3) arr.push({ original, masked })
      samplesOf.set(col, arr)
    }
  }
  for (const col of targets) {
    const name = headers.get(col) ?? String(col)
    previews.push({ column: name, samples: samplesOf.get(col) ?? [] })
  }

  const out = uniquePath(params.outDir, `${stemOf(params.path)}_脱敏.xlsx`)
  await wb.xlsx.writeFile(out)
  return { outputs: [out], previews }
}

/** 读取表头列名（供脱敏列选择） */
export async function readHeaders(filePath: string): Promise<{ headers: string[] }> {
  const records = await readFirstSheetRecords(filePath)
  if (records.length === 0) throw new Error('该文件没有数据行')
  return { headers: Object.keys(records[0]) }
}

async function readFirstSheetRecords(filePath: string): Promise<DataRecord[]> {
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.readFile(filePath)
  const ws = wb.worksheets[0]
  if (!ws) throw new Error('该文件没有工作表')
  const headers = new Map<number, string>()
  ws.getRow(1).eachCell((cell, col) => {
    const name = typeof cell.value === 'string' ? cell.value.trim() : String(cell.value ?? '').trim()
    if (name) headers.set(col, name)
  })
  const records: DataRecord[] = []
  for (let r = 2; r <= ws.rowCount; r++) {
    const row = ws.getRow(r)
    const rec: DataRecord = {}
    let nonEmpty = false
    for (const [col, name] of headers) {
      const v = row.getCell(col).value
      const s = typeof v === 'string' ? v : v === null || v === undefined ? '' : String(v)
      if (s !== '') nonEmpty = true
      rec[name] = s
    }
    if (nonEmpty) records.push(rec)
  }
  return records
}
