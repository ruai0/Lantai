import fs from 'node:fs'
import path from 'node:path'
import ExcelJS from 'exceljs'
import iconv from 'iconv-lite'
import type {
  ExcelAggregate,
  ExcelCondFormatParams,
  ExcelCondFormatResult,
  ExcelCsvParams,
  ExcelGroupParams,
  ExcelGroupResult,
  ExcelMergeParams,
  ExcelMaskParams,
  ExcelSortDedupeParams,
  ExcelSortDedupeResult,
  ExcelSplitColumnParams,
  ExcelSplitRowsParams,
  ExcelSplitSheetParams,
  MaskPreview,
  MaskRule
} from '@shared/types'
import { exportFilename, naturalCompare, normalizeKey, sanitizeFilename, stemOf, uniquePath } from './fileUtils'
import { TaskCancelledError } from './taskProgress'

type CellValue = ExcelJS.CellValue

/** 进度/取消回调（与 inventoryService 同构，便于 IPC 统一用 runTracked 包装） */
export interface ExcelOpts {
  onProgress?: (done: number, total?: number) => void
  isCancelled?: () => boolean
}

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

/** 读取指定工作表（默认第一个），供拆分/脱敏按 sheet 操作 */
async function readOneSheet(filePath: string, sheet?: string): Promise<SheetData> {
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.readFile(filePath)
  const ws = sheet ? wb.getWorksheet(sheet) : wb.worksheets[0]
  if (!ws) throw new Error(sheet ? `找不到工作表「${sheet}」` : '该文件没有工作表')
  const rows: CellValue[][] = []
  for (let r = 1; r <= ws.rowCount; r++) {
    const row = ws.getRow(r)
    const values: CellValue[] = []
    for (let c = 1; c <= ws.columnCount; c++) values.push(row.getCell(c).value)
    rows.push(values)
  }
  return { name: ws.name, rows }
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

export async function mergeWorkbooks(params: ExcelMergeParams, opts?: ExcelOpts): Promise<{ outputs: string[] }> {
  if (params.paths.length < 2) throw new Error('合并至少需要选择两个 Excel 文件')
  const all: Array<{ file: string; sheets: SheetData[] }> = []
  for (let i = 0; i < params.paths.length; i++) {
    if (opts?.isCancelled?.()) throw new TaskCancelledError()
    const p = params.paths[i]
    all.push({ file: p, sheets: await readSheets(p) })
    opts?.onProgress?.(i + 1, params.paths.length)
  }

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
    // 表头行可由用户指定（台账表头常在第 2、3 行，上面是标题/单位/日期）
    const headerRowNo = Math.max(1, params.headerRow ?? 1)
    // 表头比较走共享归一化口径（去空白 + 全半角 + 大小写），与匹配/比对统一
    const norm = normalizeKey
    const headers: string[] = []
    const seen = new Set<string>()
    for (const item of all) {
      const first = item.sheets[0]
      if (!first || first.rows.length < headerRowNo) continue
      for (const v of first.rows[headerRowNo - 1]) {
        const h = headerText(v)
        if (h && !seen.has(norm(h))) {
          seen.add(norm(h))
          headers.push(h)
        }
      }
    }
    if (headers.length === 0) throw new Error(`没有在所选文件的第 ${headerRowNo} 行找到表头，请确认表头行号`)
    const rows: CellValue[][] = [headers]
    for (const item of all) {
      const first = item.sheets[0]
      if (!first || first.rows.length <= headerRowNo) continue
      const headerIndex = new Map(headers.map((h, i) => [norm(h), i]))
      const localHeaders = first.rows[headerRowNo - 1].map(v => headerText(v))
      for (let r = headerRowNo; r < first.rows.length; r++) {
        const row = first.rows[r]
        if (row.every(v => v === null || v === undefined || v === '')) continue
        const out: CellValue[] = new Array(headers.length).fill('')
        localHeaders.forEach((h, c) => {
          const idx = headerIndex.get(norm(h))
          if (idx !== undefined) out[idx] = plainValue(row[c])
        })
        rows.push(out)
      }
    }
    sheets = [{ name: '合并结果', rows }]
  }

  const wb = newWorkbookWithSheets(sheets)
  const out = uniquePath(params.outDir, exportFilename(params.name, '.xlsx', `Excel合并_${new Date().toISOString().slice(0, 10)}`))
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

export async function splitByRows(
  params: ExcelSplitRowsParams,
  opts?: ExcelOpts
): Promise<{ outputs: string[] }> {
  const n = params.rowsPerFile
  if (!Number.isInteger(n) || n < 1) throw new Error('每个文件的行数必须是正整数')
  const ws = await readOneSheet(params.path, params.sheet)
  const hr = Math.max(1, params.headerRow ?? 1)
  const totalRows = ws.rows.length
  if (totalRows <= hr) throw new Error(`该文件没有可拆分的数据行（第 ${hr} 行为表头）`)
  // 表头 = 第 1 行到第 headerRow 行（多行表头整体保留）
  const header = ws.rows.slice(0, hr)
  const dataRows = ws.rows.slice(hr).filter(r => !r.every(v => v === null || v === undefined || v === ''))
  if (dataRows.length === 0) throw new Error('该文件除表头外没有数据行')
  const base = stemOf(params.path)
  const sheetName = params.keepSheetName === false ? 'Sheet1' : ws.name
  const fileCount = Math.ceil(dataRows.length / n)
  const outputs: string[] = []
  for (let start = 0; start < dataRows.length; start += n) {
    if (opts?.isCancelled?.()) throw new TaskCancelledError()
    const chunk = dataRows.slice(start, start + n)
    const end = start + chunk.length
    const wb = newWorkbookWithSheets([{ name: sheetName, rows: [...header, ...chunk] }])
    const out = uniquePath(params.outDir, `${base}_第${start + 1}-${end}行.xlsx`)
    await wb.xlsx.writeFile(out)
    outputs.push(out)
    opts?.onProgress?.(outputs.length, fileCount)
  }
  return { outputs }
}

/* ---------- 按列值拆分 ---------- */

export async function splitByColumn(
  params: ExcelSplitColumnParams,
  opts?: ExcelOpts
): Promise<{ outputs: string[]; groups: number }> {
  const ws = await readOneSheet(params.path, params.sheet)
  const hr = Math.max(1, params.headerRow ?? 1)
  const header = ws.rows[hr - 1]
  const dataRows = ws.rows.slice(hr)
  if (!header || dataRows.length === 0) throw new Error(`该文件没有可拆分的数据行（第 ${hr} 行为表头）`)
  const colIdx = header.findIndex(h => headerText(h) === params.column)
  if (colIdx < 0) throw new Error(`找不到列「${params.column}」，请检查表头`)

  const groups = new Map<string, CellValue[][]>()
  for (const row of dataRows) {
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
    // 一列值可能有几十个分组，逐个写文件；支持中途停，已写出的保留
    if (opts?.isCancelled?.()) throw new TaskCancelledError()
    const wb = newWorkbookWithSheets([{ name: ws.name, rows: [header, ...rows] }])
    const out = uniquePath(params.outDir, `${base}_${sanitizeFilename(key)}.xlsx`)
    await wb.xlsx.writeFile(out)
    outputs.push(out)
    opts?.onProgress?.(outputs.length, groups.size)
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

export async function csvToXlsx(params: ExcelCsvParams, opts?: ExcelOpts): Promise<{ outputs: string[] }> {
  if (params.paths.length === 0) throw new Error('请先选择 CSV 文件')
  const outputs: string[] = []
  for (let i = 0; i < params.paths.length; i++) {
    if (opts?.isCancelled?.()) throw new TaskCancelledError()
    const p = params.paths[i]
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
    opts?.onProgress?.(outputs.length, params.paths.length)
  }
  return { outputs }
}

/* ---------- 数据脱敏 ---------- */

/** 按规则打码单个值（纯函数，供测试）；maskChar 默认 *（可用 ● 等更醒目字符） */
export function maskValue(text: string, rule: MaskRule, keepHead = 0, keepTail = 0, maskChar = '*'): string {
  const s = (text ?? '').trim()
  if (!s) return s
  const chars = [...s]
  const n = chars.length
  const mc = (maskChar || '*').slice(0, 1) || '*'
  const mask = (head: number, tail: number): string => {
    const h = Math.max(0, Math.min(Math.floor(head), n))
    const t = Math.max(0, Math.min(Math.floor(tail), n - h))
    const mid = n - h - t
    return (
      chars.slice(0, h).join('') +
      mc.repeat(mid) +
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
  const ws = params.sheet ? wb.getWorksheet(params.sheet) : wb.worksheets[0]
  if (!ws) throw new Error(params.sheet ? `找不到工作表「${params.sheet}」` : '该文件没有工作表')
  const hr = Math.max(1, params.headerRow ?? 1)
  const headers = new Map<number, string>()
  ws.getRow(hr).eachCell((cell, col) => {
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
  for (let r = hr + 1; r <= ws.rowCount; r++) {
    const row = ws.getRow(r)
    for (const col of targets) {
      const cell = row.getCell(col)
      const original = typeof cell.value === 'string' ? cell.value : String(cell.value ?? '')
      if (!original.trim()) continue
      const masked = maskValue(
        original,
        params.rule,
        params.keepHead ?? 0,
        params.keepTail ?? 0,
        params.maskChar ?? '*'
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

/** 读取表头列名（供脱敏/匹配列选择）；可指定表头行号与工作表 */
export async function readHeaders(filePath: string, headerRow = 1, sheet?: string): Promise<{ headers: string[] }> {
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.readFile(filePath)
  const ws = sheet ? wb.getWorksheet(sheet) : wb.worksheets[0]
  if (!ws) throw new Error('该文件没有工作表')
  const hr = Math.max(1, headerRow)
  const headers: string[] = []
  ws.getRow(hr).eachCell((_cell, col) => {
    const v = ws.getRow(hr).getCell(col).value
    const name = typeof v === 'string' ? v.trim() : String(v ?? '').trim()
    if (name) headers.push(name)
  })
  if (headers.length === 0) throw new Error(`第 ${hr} 行没有找到表头`)
  return { headers }
}

/* ---------- 排序 / 去重 ---------- */

/** 表头行 → 列名到列号（1-based）的映射 */
function headerIndexMap(ws: ExcelJS.Worksheet, headerRow: number): Map<string, number> {
  const map = new Map<string, number>()
  ws.getRow(headerRow).eachCell((cell, col) => {
    const name = typeof cell.value === 'string' ? cell.value.trim() : String(cell.value ?? '').trim()
    if (name) map.set(name, col)
  })
  return map
}

/** 把用到的列名解析为列号，找不到直接报错（避免静默按错列处理） */
function resolveColumns(map: Map<string, number>, names: string[], what = '列'): number[] {
  const out: number[] = []
  for (const n of names) {
    const c = map.get(n)
    if (c === undefined) throw new Error(`找不到${what}「${n}」，请检查表头行与列名`)
    out.push(c)
  }
  return out
}

/** 单元格值比较：数字按数值比（含"看着像数字的文本"，台账里数字列常被存成文本），
 *  其余按自然序（"第2号" < "第10号"）；空值恒排最后 */
function compareCells(a: CellValue, b: CellValue, desc: boolean): number {
  const na = plainValue(a)
  const nb = plainValue(b)
  const fa = numericOf(na)
  const fb = numericOf(nb)
  let cmp: number
  if (fa !== null && fb !== null) cmp = fa - fb
  else {
    const sa = na === null || na === undefined ? '' : String(na)
    const sb = nb === null || nb === undefined ? '' : String(nb)
    cmp = naturalCompare(sa, sb)
  }
  const ea = na === '' || na === null || na === undefined
  const eb = nb === '' || nb === null || nb === undefined
  if (ea !== eb) return ea ? 1 : -1
  return desc ? -cmp : cmp
}

/** 数字（或"看起来是数字"的文本，如 '100'、'1,200'）→ 数值；否则 null */
function numericOf(v: CellValue): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null
  if (typeof v !== 'string') return null
  const s = v.trim().replace(/,/g, '')
  if (!s || !/^-?\d+(\.\d+)?$/.test(s)) return null
  const n = Number(s)
  return Number.isFinite(n) ? n : null
}

export async function sortDedupe(params: ExcelSortDedupeParams): Promise<ExcelSortDedupeResult> {
  if (!params.sortColumns.length && !params.dedupe) {
    throw new Error('请至少选择排序依据，或勾选「按所选列去重」')
  }
  const sheet = await readOneSheet(params.path, params.sheet)
  const hr = Math.max(1, params.headerRow ?? 1)
  const headerRows = sheet.rows.slice(0, hr)
  const dataRows = sheet.rows.slice(hr)
  if (dataRows.length === 0) throw new Error('该工作表没有数据行（除表头外为空）')

  const map = new Map<string, number>()
  headerRows[headerRows.length - 1].forEach((v, i) => {
    const name = typeof v === 'string' ? v.trim() : String(v ?? '').trim()
    if (name) map.set(name, i + 1)
  })
  const sortCols = resolveColumns(map, params.sortColumns, '排序列')
  const keyCols = sortCols.length ? sortCols : []
  const desc = params.sortOrder === 'desc'

  let rows = dataRows.slice()
  if (sortCols.length) {
    rows.sort((ra, rb) => {
      for (const col of sortCols) {
        const c = compareCells(ra[col - 1], rb[col - 1], desc)
        if (c !== 0) return c
      }
      return 0
    })
  }

  const before = rows.length
  let removed = 0
  if (params.dedupe) {
    if (!keyCols.length) throw new Error('去重需要先选择「排序列」作为去重依据')
    const seen = new Set<string>()
    const kept: CellValue[][] = []
    for (const r of rows) {
      const key = keyCols.map(c => normalizeKey(r[c - 1])).join('\u0001')
      if (seen.has(key)) {
        removed++
        continue
      }
      seen.add(key)
      kept.push(r)
    }
    rows = kept
  }

  const wb = newWorkbookWithSheets([{ name: sheet.name, rows: [...headerRows, ...rows] }])
  const suffix = params.dedupe ? '_去重' : '_排序'
  const out = uniquePath(params.outDir, `${stemOf(params.path)}${suffix}.xlsx`)
  await wb.xlsx.writeFile(out)
  return { outputs: [out], before, after: rows.length, removed }
}

/* ---------- 分组汇总（透视的实用替身） ---------- */

const AGG_LABEL: Record<ExcelAggregate, string> = {
  count: '计数',
  sum: '求和',
  avg: '平均',
  max: '最大',
  min: '最小'
}

export async function groupSummary(params: ExcelGroupParams): Promise<ExcelGroupResult> {
  if (!params.groupColumns.length) throw new Error('请至少选择一列作为分组依据')
  if (params.aggregate !== 'count' && !params.valueColumns.length) {
    throw new Error(`「${AGG_LABEL[params.aggregate]}」需要选择要汇总的数值列`)
  }
  const sheet = await readOneSheet(params.path, params.sheet)
  const hr = Math.max(1, params.headerRow ?? 1)
  const headerRows = sheet.rows.slice(0, hr)
  const dataRows = sheet.rows.slice(hr)
  if (dataRows.length === 0) throw new Error('该工作表没有数据行（除表头外为空）')

  const map = new Map<string, number>()
  headerRows[headerRows.length - 1].forEach((v, i) => {
    const name = typeof v === 'string' ? v.trim() : String(v ?? '').trim()
    if (name) map.set(name, i + 1)
  })
  const groupCols = resolveColumns(map, params.groupColumns, '分组列')
  const valueCols = resolveColumns(map, params.valueColumns, '汇总列')

  // 累计每组每列的聚合值
  interface Acc {
    count: number
    sums: number[]
    nums: number[][]
  }
  const groups = new Map<string, { key: CellValue[]; acc: Acc }>()
  const order: string[] = []
  for (const r of dataRows) {
    const keyVals = groupCols.map(c => r[c - 1])
    const key = keyVals.map(v => normalizeKey(v)).join('\u0001')
    let g = groups.get(key)
    if (!g) {
      g = {
        key: keyVals,
        acc: { count: 0, sums: valueCols.map(() => 0), nums: valueCols.map(() => []) }
      }
      groups.set(key, g)
      order.push(key)
    }
    g.acc.count++
    if (params.aggregate !== 'count') {
      valueCols.forEach((col, i) => {
        const v = plainValue(r[col - 1])
        const num = typeof v === 'number' ? v : Number(String(v).replace(/,/g, '').trim())
        if (!Number.isNaN(num)) {
          g!.acc.sums[i] += num
          g!.acc.nums[i].push(num)
        }
      })
    }
  }

  const groupHeader = params.groupColumns
  const valueHeader =
    params.aggregate === 'count'
      ? ['计数']
      : params.valueColumns.map(v => `${v}_${AGG_LABEL[params.aggregate]}`)
  const outHeader: CellValue[] = [...groupHeader, ...valueHeader]
  const outRows: CellValue[][] = [...headerRows, outHeader]
  for (const k of order) {
    const g = groups.get(k)!
    const agg: CellValue[] =
      params.aggregate === 'count'
        ? [g.acc.count]
        : valueCols.map((_col, i) => {
            const nums = g.acc.nums[i]
            if (!nums.length) return ''
            switch (params.aggregate) {
              case 'sum':
                return round2(g.acc.sums[i])
              case 'avg':
                return round2(g.acc.sums[i] / nums.length)
              case 'max':
                return round2(Math.max(...nums))
              case 'min':
                return round2(Math.min(...nums))
              default:
                return ''
            }
          })
    outRows.push([...g.key, ...agg])
  }

  const wb = newWorkbookWithSheets([{ name: '汇总', rows: outRows }])
  const out = uniquePath(params.outDir, `${stemOf(params.path)}_分组汇总.xlsx`)
  await wb.xlsx.writeFile(out)
  // 前 8 行预览（数据行），表头单独返回给界面
  const preview = outRows.slice(hr, hr + 8).map(r => r.map(v => (v === null || v === undefined ? '' : String(v))))
  return { outputs: [out], header: [...groupHeader, ...valueHeader], preview, groups: order.length }
}

/** 保留两位小数（去掉尾随 0） */
function round2(n: number): number {
  return Math.round(n * 100) / 100
}

/* ---------- 条件格式（标注重复 / 达标） ---------- */

export async function conditionalFormat(params: ExcelCondFormatParams): Promise<ExcelCondFormatResult> {
  if (!params.columns.length) throw new Error('请至少选择一列作为条件格式的作用列')
  if ((params.rule === 'greater' || params.rule === 'less') && typeof params.value !== 'number') {
    throw new Error('请填写阈值')
  }
  if (params.rule === 'between' && (typeof params.value !== 'number' || typeof params.value2 !== 'number')) {
    throw new Error('「介于」需要填写上下限')
  }
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.readFile(params.path)
  const ws = params.sheet ? wb.getWorksheet(params.sheet) : wb.worksheets[0]
  if (!ws) throw new Error(params.sheet ? `找不到工作表「${params.sheet}」` : '该文件没有工作表')
  const hr = Math.max(1, params.headerRow ?? 1)
  const map = headerIndexMap(ws, hr)
  const cols = resolveColumns(map, params.columns)
  const fill = (params.fill ?? 'FFFF00').replace(/^#/, '').toUpperCase()
  const argb = `FF${fill.padStart(6, '0').slice(-6)}`

  const paint = (row: number, col: number): void => {
    const cells = params.wholeRow ? [1, ws.columnCount] : [col, col]
    for (let c = cells[0]; c <= cells[1]; c++) ws.getRow(row).getCell(c).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb } }
  }

  let matched = 0
  if (params.rule === 'duplicate') {
    // 以首列为主键判断重复（多列时按组合键），重复的每一行都标出来
    const seen = new Map<string, number[]>()
    for (let r = hr + 1; r <= ws.rowCount; r++) {
      const key = cols.map(c => normalizeKey(ws.getRow(r).getCell(c).value)).join('\u0001')
      if (key.replace(/\u0001/g, '') === '') continue
      const arr = seen.get(key) ?? []
      arr.push(r)
      seen.set(key, arr)
    }
    for (const rows of seen.values()) {
      if (rows.length < 2) continue
      for (const r of rows) {
        if (params.wholeRow) paint(r, cols[0])
        else for (const c of cols) paint(r, c)
        matched++
      }
    }
  } else {
    for (let r = hr + 1; r <= ws.rowCount; r++) {
      for (const c of cols) {
        const v = plainValue(ws.getRow(r).getCell(c).value)
        const num = typeof v === 'number' ? v : Number(String(v).replace(/,/g, '').trim())
        if (Number.isNaN(num)) continue
        const hit =
          params.rule === 'greater'
            ? num > (params.value as number)
            : params.rule === 'less'
              ? num < (params.value as number)
              : num >= (params.value as number) && num <= (params.value2 as number)
        if (hit) {
          paint(r, c)
          matched++
        }
      }
    }
  }

  const out = uniquePath(params.outDir, `${stemOf(params.path)}_标注.xlsx`)
  await wb.xlsx.writeFile(out)
  return { outputs: [out], matched }
}
