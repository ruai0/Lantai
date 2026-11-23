/** Excel 工具端到端回归：用真实 xlsx/csv 文件走服务层全链路（合并/拆分/CSV/脱敏/去重/汇总/匹配/比对/条件格式） */
import { beforeAll, afterAll, describe, expect, it } from 'vitest'
import ExcelJS from 'exceljs'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import iconv from 'iconv-lite'
import type { CellValue } from 'exceljs'

import {
  mergeWorkbooks,
  splitBySheets,
  splitByRows,
  splitByColumn,
  csvToXlsx,
  desensitize,
  sortDedupe,
  groupSummary,
  conditionalFormat,
  readHeaders
} from '../src/main/services/excelToolsService'
import { matchFill, compareTables, listSheets } from '../src/main/services/excelMatchService'

const ctx = { onProgress: () => {}, isCancelled: () => false }
let dir: string

async function readRows(file: string, sheet?: string): Promise<CellValue[][]> {
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.readFile(file)
  const ws = sheet ? wb.getWorksheet(sheet)! : wb.worksheets[0]
  const rows: CellValue[][] = []
  ws.eachRow(r => rows.push(r.values as CellValue[]))
  return rows
}

beforeAll(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lantai-excel-e2e-')) })
afterAll(() => { fs.rmSync(dir, { recursive: true, force: true }) })

async function makeWorkbook(file: string, sheets: Record<string, (string | number)[][]>) {
  const wb = new ExcelJS.Workbook()
  for (const [name, rows] of Object.entries(sheets)) {
    const ws = wb.addWorksheet(name)
    rows.forEach(r => ws.addRow(r))
  }
  await wb.xlsx.writeFile(file)
}

describe('Excel 工具端到端（真实文件）', () => {
  let a = '', b = '', multi = ''

  beforeAll(async () => {
    a = path.join(dir, 'a.xlsx')
    b = path.join(dir, 'b.xlsx')
    multi = path.join(dir, 'multi.xlsx')
    await makeWorkbook(a, { Sheet1: [
      ['姓名', '手机号', '部门', '金额'],
      ['张三', '13812345678', '运维', 100],
      ['李四', '13987654321', '市场', 200],
      ['王五', '15011112222', '运维', 300],
      ['张三', '13812345678', '运维', 100] // 重复行
    ] })
    await makeWorkbook(b, { Sheet1: [
      ['姓名', '手机号', '部门', '金额'],
      ['赵六', '15133334444', '市场', 400],
      ['钱七', '15255556666', '财务', 500]
    ] })
    await makeWorkbook(multi, {
      台账: [['编号', '内容'], [1, '甲'], [2, '乙'], [3, '丙'], [4, '丁'], [5, '戊']],
      备注: [['说明'], ['第一条'], ['第二条']]
    })
  })

  it('多簿合并 single 模式（表头对齐纵向拼接）', async () => {
    const r: any = await mergeWorkbooks({ paths: [a, b], mode: 'single', outDir: dir }, ctx)
    const rows = await readRows(r.outputs[0])
    expect(r.outputs).toHaveLength(1)
    expect(rows).toHaveLength(7) // 1 表头 + 4 + 2 数据行
    expect(rows.some(r => String(r[1]) === '赵六')).toBe(true)
  })

  it('多簿合并 sheets 模式（每文件一个工作表）', async () => {
    const r: any = await mergeWorkbooks({ paths: [a, b], mode: 'sheets', outDir: dir }, ctx)
    const wb = new ExcelJS.Workbook()
    await wb.xlsx.readFile(r.outputs[0])
    expect(wb.worksheets).toHaveLength(2)
    expect(wb.getWorksheet('a')).toBeDefined()
  })

  it('按工作表拆分：2 表 → 2 文件', async () => {
    const r: any = await splitBySheets({ path: multi, outDir: dir })
    expect(r.outputs).toHaveLength(2)
    const rows = await readRows(r.outputs[0])
    expect(rows).toHaveLength(6)
  })

  it('按行拆分：5 行每 2 行一档 → 3 文件', async () => {
    const r: any = await splitByRows({ path: multi, rowsPerFile: 2, outDir: dir }, ctx)
    expect(r.outputs).toHaveLength(3)
    const last = await readRows(r.outputs[2])
    expect(last).toHaveLength(2) // 表头 + 剩余 1 行
  })

  it('按列值拆分：部门 2 值 → 2 文件', async () => {
    const r: any = await splitByColumn({ path: a, column: '部门', outDir: dir }, ctx)
    expect(r.outputs).toHaveLength(2)
    const all = (await Promise.all(r.outputs.map((f: string) => readRows(f)))).flat()
    expect(all.some(x => String(x[1]) === '李四')).toBe(true)
  })

  it('CSV 转 Excel：UTF-8 与 GBK 都能转', async () => {
    const u8 = path.join(dir, 'u8.csv')
    fs.writeFileSync(u8, '姓名,金额\n张三,100\n', 'utf8')
    const gbk = path.join(dir, 'gbk.csv')
    fs.writeFileSync(gbk, iconv.encode('姓名,金额\n李四,200\n', 'gbk'))
    const r: any = await csvToXlsx({ paths: [u8, gbk], encoding: 'gbk', outDir: dir }, ctx)
    expect(r.outputs).toHaveLength(2)
    const rows = await readRows(r.outputs[1])
    expect(String(rows[1][1])).toBe('李四')
  })

  it('手机号脱敏：保留前 3 后 4', async () => {
    const r: any = await desensitize({ path: a, columns: ['手机号'], rule: 'phone', outDir: dir })
    const rows = await readRows(r.outputs[0])
    expect(String(rows[1][2])).toMatch(/^138\*{4}5678$/)
  })

  it('排序去重：4 行去重后 3 行且按金额降序', async () => {
    const r: any = await sortDedupe({ path: a, outDir: dir, sortColumns: ['金额'], sortOrder: 'desc', dedupe: true })
    expect(r.after).toBe(3)
    const rows = await readRows(r.outputs[0])
    expect(Number(rows[1][4])).toBe(300)
  })

  it('分组汇总：按部门求和金额', async () => {
    const r: any = await groupSummary({ path: a, outDir: dir, groupColumns: ['部门'], valueColumns: ['金额'], aggregate: 'sum' })
    expect(r.groups).toBe(2)
    expect(r.outputs).toHaveLength(1)
    const rows = await readRows(r.outputs[0])
    const yunwei = rows.find(x => String(x[1]) === '运维')
    expect(Number(yunwei![2])).toBe(500) // 100 + 100 + 300
  })

  it('条件格式：金额大于 250 的单元格高亮', async () => {
    const r: any = await conditionalFormat({ path: a, outDir: dir, columns: ['金额'], rule: 'greater', value: 250 })
    expect(r.outputs).toHaveLength(1)
    const wb = new ExcelJS.Workbook()
    await wb.xlsx.readFile(r.outputs[0])
    const ws = wb.worksheets[0]
    let filled = 0
    ws.eachRow(row => row.eachCell(cell => { if (cell.fill?.fgColor?.argb && cell.fill.fgColor.argb !== 'FFFFFFFF') filled++ }))
    expect(filled).toBe(1) // 原始数据中只有 300 > 250，高亮一格
  })

  it('读表头与列工作表清单', async () => {
    const h: any = await readHeaders(a, 1)
    expect(h.headers ?? h).toContain('手机号')
    const s: any = await listSheets(multi)
    expect((s.sheets ?? s).join()).toContain('台账')
  })

  it('跨表匹配填充：2 匹配 1 未匹配', async () => {
    const lookup = path.join(dir, 'lookup.xlsx')
    await makeWorkbook(lookup, { Sheet1: [['姓名', '电话'], ['张三', '010-111'], ['李四', '010-222']] })
    const r: any = await matchFill({
      mainPath: a, mainKey: '姓名', lookupPath: lookup, lookupKey: '姓名',
      fetchColumns: ['电话'], notFoundText: '未找到', outDir: dir
    })
    expect(r.matched).toBe(3)
    expect(r.unmatched).toBe(1)
    const rows = await readRows(r.outputs[0])
    const zh = rows.find(x => String(x[1]) === '张三')
    expect(String(zh![5])).toBe('010-111')
    expect(rows.some(x => String(x[5]) === '未找到')).toBe(true)
  })

  it('名单比对：能查出增删', async () => {
    const r: any = await compareTables({ aPath: a, aKey: '姓名', bPath: b, bKey: '姓名', outDir: dir })
    expect(r.onlyInA).toBeGreaterThanOrEqual(1)
    expect(r.onlyInB).toBeGreaterThanOrEqual(2)
    expect(fs.existsSync(r.outputPath)).toBe(true)
  })
})
