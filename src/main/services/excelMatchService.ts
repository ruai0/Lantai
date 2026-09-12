import fs from 'node:fs'
import path from 'node:path'
import ExcelJS from 'exceljs'
import type { ExcelCompareParams, ExcelCompareResult, ExcelMatchFillParams, ExcelMatchFillResult } from '@shared/types'
import { cellText, sanitizeFilename, stemOf, uniquePath } from './fileUtils'

/** 关联键归一：去空白；纯数字去掉多余的 .0（Excel 数值与文本混用时仍能对上） */
export function normalizeKey(v: unknown): string {
  const s = cellText(v).trim()
  if (/^\d+\.0+$/.test(s)) return s.split('.')[0]
  return s
}

interface TableData {
  headers: string[]
  /** 每行的原始单元格值（按 headers 下标对齐） */
  rows: unknown[][]
}

async function readTable(filePath: string): Promise<TableData> {
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.readFile(filePath)
  const ws = wb.worksheets[0]
  if (!ws) throw new Error(`文件里没有工作表：${path.basename(filePath)}`)
  const headers: string[] = []
  ws.getRow(1).eachCell((cell, col) => {
    headers[col - 1] = cellText(cell.value).trim()
  })
  if (headers.filter(Boolean).length === 0) throw new Error(`第 1 行不是表头：${path.basename(filePath)}`)
  const rows: unknown[][] = []
  for (let r = 2; r <= ws.rowCount; r++) {
    const row = ws.getRow(r)
    const values: unknown[] = []
    let empty = true
    for (let c = 1; c <= headers.length; c++) {
      const v = row.getCell(c).value
      values.push(v)
      if (cellText(v).trim() !== '') empty = false
    }
    if (!empty) rows.push(values)
  }
  return { headers, rows }
}

function indexOfHeader(headers: string[], name: string, file: string): number {
  const i = headers.findIndex(h => h === name)
  if (i < 0) throw new Error(`「${path.basename(file)}」里找不到列「${name}」`)
  return i
}

/** 副表按 key 建索引；重复 key 保留首次出现的行 */
function buildLookup(data: TableData, keyIdx: number): Map<string, unknown[]> {
  const map = new Map<string, unknown[]>()
  for (const row of data.rows) {
    const key = normalizeKey(row[keyIdx])
    if (!key) continue
    if (!map.has(key)) map.set(key, row)
  }
  return map
}

/* ---------- 跨表匹配填充（VLOOKUP 替代） ---------- */

export async function matchFill(params: ExcelMatchFillParams): Promise<ExcelMatchFillResult> {
  if (params.fetchColumns.length === 0) throw new Error('请至少选择一列要取过来的数据')
  const main = await readTable(params.mainPath)
  const lookup = await readTable(params.lookupPath)
  const mainKeyIdx = indexOfHeader(main.headers, params.mainKey, params.mainPath)
  const lookupKeyIdx = indexOfHeader(lookup.headers, params.lookupKey, params.lookupPath)
  const fetchIdx = params.fetchColumns.map(c => indexOfHeader(lookup.headers, c, params.lookupPath))
  const index = buildLookup(lookup, lookupKeyIdx)

  const wb = new ExcelJS.Workbook()
  await wb.xlsx.readFile(params.mainPath)
  const ws = wb.worksheets[0]
  const headerRow = ws.getRow(1)
  const usedNames = new Set(main.headers.filter(Boolean))
  const newCols = params.fetchColumns.map((name, i) => {
    let title = name
    if (usedNames.has(title)) title = `${name}_来自副表`
    usedNames.add(title)
    const idx = main.headers.length + i + 1
    headerRow.getCell(idx).value = title
    headerRow.getCell(idx).font = { bold: true }
    return { idx, srcIdx: fetchIdx[i] }
  })

  let matched = 0
  let unmatched = 0
  let outRow = 2
  for (const row of main.rows) {
    const key = normalizeKey(row[mainKeyIdx])
    const hit = key ? index.get(key) : undefined
    if (hit) matched++
    else unmatched++
    for (const col of newCols) {
      const value = hit ? cellText(hit[col.srcIdx]) : params.notFoundText ?? ''
      ws.getRow(outRow).getCell(col.idx).value = value
    }
    outRow++
  }

  const out = uniquePath(params.outDir, `${stemOf(params.mainPath)}_已匹配.xlsx`)
  await wb.xlsx.writeFile(out)
  return { outputs: [out], total: main.rows.length, matched, unmatched }
}

/* ---------- 两表差异比对 ---------- */

export async function compareTables(params: ExcelCompareParams): Promise<ExcelCompareResult> {
  const a = await readTable(params.aPath)
  const b = await readTable(params.bPath)
  const aKeyIdx = indexOfHeader(a.headers, params.aKey, params.aPath)
  const bKeyIdx = indexOfHeader(b.headers, params.bKey, params.bPath)
  const shared = (params.columns?.length ? params.columns : a.headers.filter(Boolean)).filter(h =>
    b.headers.includes(h)
  )
  if (shared.length === 0) throw new Error('两个文件没有可比较的相同列名')

  const aMap = buildLookup(a, aKeyIdx)
  const bMap = buildLookup(b, bKeyIdx)
  const colIdx = (headers: string[], name: string): number => headers.indexOf(name)

  const onlyInA: Array<[string, unknown[]]> = []
  const onlyInB: Array<[string, unknown[]]> = []
  const changes: Array<[string, string, string, string]> = []
  let same = 0
  for (const [key, row] of aMap) {
    const other = bMap.get(key)
    if (!other) {
      onlyInA.push([key, row])
      continue
    }
    let differs = false
    for (const name of shared) {
      const av = cellText(row[colIdx(a.headers, name)]).trim()
      const bv = cellText(other[colIdx(b.headers, name)]).trim()
      if (av !== bv) {
        differs = true
        changes.push([key, name, av, bv])
      }
    }
    if (!differs) same++
  }
  for (const [key, row] of bMap) {
    if (!aMap.has(key)) onlyInB.push([key, row])
  }

  const wb = new ExcelJS.Workbook()
  const ws = wb.addWorksheet('差异比对')
  const summary = ws.addRow(['比对结果', `只在 A（B 中已删除）${onlyInA.length} 条`, `只在 B（新增）${onlyInB.length} 条`, `变更 ${changes.length} 处`, `完全一致 ${same} 条`])
  summary.font = { bold: true }
  ws.addRow([])
  ws.addRow(['【B 中已删除（只在 A 表）】'])
  ws.getRow(ws.rowCount).font = { bold: true }
  ws.addRow(['关联键', ...a.headers.filter(Boolean)])
  ws.getRow(ws.rowCount).font = { bold: true }
  onlyInA.forEach(([key, row]) => ws.addRow([key, ...row.map(cellText)]))
  ws.addRow([])
  ws.addRow(['【新增（只在 B 表）】'])
  ws.getRow(ws.rowCount).font = { bold: true }
  ws.addRow(['关联键', ...b.headers.filter(Boolean)])
  ws.getRow(ws.rowCount).font = { bold: true }
  onlyInB.forEach(([key, row]) => ws.addRow([key, ...row.map(cellText)]))
  ws.addRow([])
  ws.addRow(['【变更明细】'])
  ws.getRow(ws.rowCount).font = { bold: true }
  ws.addRow(['关联键', '列名', 'A 表值', 'B 表值'])
  ws.getRow(ws.rowCount).font = { bold: true }
  changes.forEach(c => ws.addRow(c))
  ws.getColumn(1).width = 24
  ws.getColumn(4).width = 40

  const base = `${stemOf(params.aPath)}_vs_${stemOf(params.bPath)}`.slice(0, 60)
  const out = uniquePath(params.outDir, `${sanitizeFilename(base)}_差异.xlsx`)
  await wb.xlsx.writeFile(out)
  return {
    outputPath: out,
    onlyInA: onlyInA.length,
    onlyInB: onlyInB.length,
    changed: changes.length,
    same
  }
}
