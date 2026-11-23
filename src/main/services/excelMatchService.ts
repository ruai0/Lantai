import path from 'node:path'
import ExcelJS from 'exceljs'
import type { ExcelCompareParams, ExcelCompareResult, ExcelMatchFillParams, ExcelMatchFillResult } from '@shared/types'
import { cellText, normalizeKey, sanitizeFilename, stemOf, uniquePath } from './fileUtils'

export { normalizeKey }

interface TableData {
  headers: string[]
  /** 每行的原始单元格值（按 headers 下标对齐） */
  rows: unknown[][]
}

/** 列出文件里所有工作表名（供 UI 选择） */
export async function listSheets(filePath: string): Promise<string[]> {
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.readFile(filePath)
  return wb.worksheets.map(ws => ws.name)
}

/**
 * 读取一个工作表为表格。
 * @param headerRow 表头所在行（1-based，默认 1）；台账常在第 2、3 行
 * @param sheetName 目标工作表名；留空 = 第一个工作表
 */
async function readTable(filePath: string, headerRow = 1, sheetName?: string): Promise<TableData> {
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.readFile(filePath)
  const ws = sheetName ? wb.getWorksheet(sheetName) : wb.worksheets[0]
  if (!ws) {
    const names = wb.worksheets.map(w => w.name).join('、')
    throw new Error(
      sheetName
        ? `「${path.basename(filePath)}」里找不到工作表「${sheetName}」（现有：${names}）`
        : `文件里没有工作表：${path.basename(filePath)}`
    )
  }
  const hr = Math.max(1, headerRow)
  const headers: string[] = []
  ws.getRow(hr).eachCell((cell, col) => {
    headers[col - 1] = cellText(cell.value).trim()
  })
  if (headers.filter(Boolean).length === 0) {
    throw new Error(`「${path.basename(filePath)}」第 ${hr} 行不是表头，请确认表头行号`)
  }
  const rows: unknown[][] = []
  for (let r = hr + 1; r <= ws.rowCount; r++) {
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

/** 表头名按归一化口径定位（容忍大小写 / 全半角 / 空白差异） */
function indexOfHeader(headers: string[], name: string, file: string): number {
  const target = normalizeKey(name)
  const i = headers.findIndex(h => normalizeKey(h) === target)
  if (i < 0) throw new Error(`「${path.basename(file)}」里找不到列「${name}」`)
  return i
}

/**
 * 按 key 建索引；重复 key 保留首次出现的行，并记录重复的 key 与丢失的行数供提示。
 * dupKeys 会回传给 UI 显式告警——一对多场景静默取首条是数据失真的高危来源。
 */
function buildLookup(
  data: TableData,
  keyIdx: number
): { map: Map<string, unknown[]>; dupKeys: string[]; droppedRows: number } {
  const map = new Map<string, unknown[]>()
  const dupSet = new Set<string>()
  let droppedRows = 0
  for (const row of data.rows) {
    const key = normalizeKey(row[keyIdx])
    if (!key) continue
    if (map.has(key)) {
      dupSet.add(key)
      droppedRows++
    } else {
      map.set(key, row)
    }
  }
  return { map, dupKeys: [...dupSet], droppedRows }
}

/* ---------- 跨表匹配填充（VLOOKUP 替代） ---------- */

export async function matchFill(params: ExcelMatchFillParams): Promise<ExcelMatchFillResult> {
  if (params.fetchColumns.length === 0) throw new Error('请至少选择一列要取过来的数据')
  const mainHeaderRow = Math.max(1, params.mainHeaderRow ?? 1)
  const lookupHeaderRow = Math.max(1, params.lookupHeaderRow ?? 1)
  const main = await readTable(params.mainPath, mainHeaderRow, params.mainSheet)
  const lookup = await readTable(params.lookupPath, lookupHeaderRow, params.lookupSheet)
  const mainKeyIdx = indexOfHeader(main.headers, params.mainKey, params.mainPath)
  const lookupKeyIdx = indexOfHeader(lookup.headers, params.lookupKey, params.lookupPath)
  const fetchIdx = params.fetchColumns.map(c => indexOfHeader(lookup.headers, c, params.lookupPath))
  const { map: index, dupKeys } = buildLookup(lookup, lookupKeyIdx)

  // 用 WorkbookReader 之外的方式读主表以保留格式：exceljs 直接读原始文件
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.readFile(params.mainPath)
  const ws = params.mainSheet ? wb.getWorksheet(params.mainSheet) : wb.worksheets[0]
  if (!ws) throw new Error(`「${path.basename(params.mainPath)}」里找不到工作表「${params.mainSheet}」`)
  const headerRow = ws.getRow(mainHeaderRow)
  const usedNames = new Set(main.headers.filter(Boolean))
  const newCols = params.fetchColumns.map((name, i) => {
    let title = name
    if (usedNames.has(title)) title = `${name}_来自副表`
    usedNames.add(title)
    const idx = main.headers.length + i + 1
    headerRow.getCell(idx).value = title
    // 新列沿用主表表头样式，避免"裸列"破坏观感
    headerRow.getCell(idx).font = { ...(headerRow.getCell(1).font ?? {}), bold: true }
    headerRow.getCell(idx).alignment = { ...(headerRow.getCell(1).alignment ?? {}) }
    return { idx, srcIdx: fetchIdx[i] }
  })
  // 未命中标记列
  const missColIdx = main.headers.length + newCols.length + 1
  headerRow.getCell(missColIdx).value = '匹配状态'
  headerRow.getCell(missColIdx).font = { bold: true }
  headerRow.getCell(missColIdx).alignment = { horizontal: 'center' }

  let matched = 0
  let unmatched = 0
  let outRow = mainHeaderRow + 1
  for (const row of main.rows) {
    const key = normalizeKey(row[mainKeyIdx])
    const hit = key ? index.get(key) : undefined
    if (hit) matched++
    else unmatched++
    for (const col of newCols) {
      const value = hit ? cellText(hit[col.srcIdx]) : params.notFoundText ?? ''
      const cell = ws.getRow(outRow).getCell(col.idx)
      cell.value = value
      // 沿用同列上方（表头）的对齐，避免左对齐数字列突兀
      if (headerRow.getCell(col.idx).alignment) cell.alignment = { ...(headerRow.getCell(col.idx).alignment ?? {}) }
    }
    // 未命中行给出显式标记，核对时一眼可筛
    ws.getRow(outRow).getCell(missColIdx).value = hit ? '' : '未匹配'
    outRow++
  }
  // 列宽适配：新列按表头宽度给个合理默认
  for (const col of newCols) ws.getColumn(col.idx).width = Math.max(12, String(headerRow.getCell(col.idx).value).length * 2 + 6)
  ws.getColumn(missColIdx).width = 10

  const out = uniquePath(params.outDir, `${stemOf(params.mainPath)}_已匹配.xlsx`)
  await wb.xlsx.writeFile(out)
  return { outputs: [out], total: main.rows.length, matched, unmatched, dupKeys }
}

/* ---------- 两表差异比对 ---------- */

export async function compareTables(params: ExcelCompareParams): Promise<ExcelCompareResult> {
  const aHeaderRow = Math.max(1, params.aHeaderRow ?? 1)
  const bHeaderRow = Math.max(1, params.bHeaderRow ?? 1)
  const a = await readTable(params.aPath, aHeaderRow, params.aSheet)
  const b = await readTable(params.bPath, bHeaderRow, params.bSheet)
  const aKeyIdx = indexOfHeader(a.headers, params.aKey, params.aPath)
  const bKeyIdx = indexOfHeader(b.headers, params.bKey, params.bPath)
  const shared = (params.columns?.length ? params.columns : a.headers.filter(Boolean)).filter(h => {
    const target = normalizeKey(h)
    return b.headers.some(bh => normalizeKey(bh) === target)
  })
  if (shared.length === 0) throw new Error('两个文件没有可比较的相同列名')

  const aBuild = buildLookup(a, aKeyIdx)
  const bBuild = buildLookup(b, bKeyIdx)
  const aMap = aBuild.map
  const bMap = bBuild.map
  // 重复键丢行会直接让"新增/删除/变更"计数失真，这里合并两侧的重复键一并回传告警
  const dupKeys = [...new Set([...aBuild.dupKeys, ...bBuild.dupKeys])]
  const droppedRows = aBuild.droppedRows + bBuild.droppedRows
  const colIdxOf = (headers: string[], name: string): number => {
    const target = normalizeKey(name)
    return headers.findIndex(h => normalizeKey(h) === target)
  }

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
      const av = cellText(row[colIdxOf(a.headers, name)]).trim()
      const bv = cellText(other[colIdxOf(b.headers, name)]).trim()
      // 比对也走归一化口径：忽略大小写 / 全半角 / 空白差异，避免误报"变更"
      if (normalizeKey(av) !== normalizeKey(bv)) {
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
  if (dupKeys.length) {
    const warn = ws.addRow([
      '⚠ 注意',
      `有 ${dupKeys.length} 个关联键存在重复（共 ${droppedRows} 行未参与比对），结果可能不完整：${dupKeys.slice(0, 10).join('、')}${dupKeys.length > 10 ? ' 等' : ''}`
    ])
    warn.font = { bold: true, color: { argb: 'FFB45309' } }
  }
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
    same,
    dupKeys,
    droppedRows
  }
}
