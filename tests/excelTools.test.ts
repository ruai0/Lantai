/**
 * 第六轮实证：Excel 排序去重 / 分组汇总 / 条件格式，用真实台账数据端到端断言。
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import ExcelJS from 'exceljs'
import { conditionalFormat, groupSummary, sortDedupe } from '../src/main/services/excelToolsService'

let tmp: string
beforeAll(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lantai-r6-'))
})
afterAll(() => {
  fs.rmSync(tmp, { recursive: true, force: true })
})

/** 生成一份"按单位发放"台账：含重复行、乱序、可累加的金额 */
async function makeLedger(): Promise<string> {
  const p = path.join(tmp, 'ledger.xlsx')
  const wb = new ExcelJS.Workbook()
  const ws = wb.addWorksheet('发放')
  ws.addRow(['单位', '姓名', '金额'])
  // 同名 + 全角空格/大小写差异也应是同一个键
  ws.addRow(['第一中学', '张三', 100])
  ws.addRow(['第二中学', '李四', 200])
  ws.addRow(['第一中学', '张三', 100])
  ws.addRow(['第2中学', '王五', 50])
  ws.addRow(['第10中学', '赵六', 25])
  ws.addRow(['第一中学', '张三', '100'])
  await wb.xlsx.writeFile(p)
  return p
}

async function readRows(file: string): Promise<ExcelJS.CellValue[][]> {
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.readFile(file)
  const ws = wb.worksheets[0]
  const rows: ExcelJS.CellValue[][] = []
  for (let r = 1; r <= ws.rowCount; r++) rows.push(ws.getRow(r).values as ExcelJS.CellValue[])
  return rows
}

describe('排序去重', () => {
  it('多列升序 + 去重：保留表头，去掉 2 条重复', async () => {
    const p = await makeLedger()
    const r = await sortDedupe({
      path: p,
      outDir: tmp,
      sortColumns: ['单位', '姓名'],
      sortOrder: 'asc',
      dedupe: true
    })
    expect(r.removed).toBe(2)
    expect(r.before).toBe(6)
    expect(r.after).toBe(4)

    const rows = await readRows(r.outputs[0])
    // 表头原样保留
    expect(rows[0].slice(1, 4)).toEqual(['单位', '姓名', '金额'])
    // 自然序：'第2' < '第10'（数字按数值比，不是字典序）；
    // '第一'/'第二' 无数字，走中文拼音序（di'er 在 diyi 前）
    const units = rows.slice(1).map(x => String(x[1]))
    expect(units).toEqual(['第2中学', '第10中学', '第二中学', '第一中学'])
  })

  it('降序排序、不去重时行数不变', async () => {
    const p = await makeLedger()
    const r = await sortDedupe({
      path: p,
      outDir: tmp,
      sortColumns: ['金额'],
      sortOrder: 'desc',
      dedupe: false
    })
    expect(r.before).toBe(r.after)
    expect(r.removed).toBe(0)
    const rows = await readRows(r.outputs[0])
    const amounts = rows.slice(1).map(x => Number(x[3]))
    // 文本数字 '100' 也按数值参与排序（台账里金额列常被存成文本）
    expect(amounts).toEqual([200, 100, 100, 100, 50, 25])
  })

  it('多行表头：第 1–2 行整体作为表头保留', async () => {
    const p = path.join(tmp, 'multihead.xlsx')
    const wb = new ExcelJS.Workbook()
    const ws = wb.addWorksheet('S')
    ws.addRow(['2026年发放台账'])
    ws.addRow(['单位', '金额'])
    ws.addRow(['B 单位', 1])
    ws.addRow(['A 单位', 2])
    await wb.xlsx.writeFile(p)

    const r = await sortDedupe({
      path: p,
      outDir: tmp,
      sortColumns: ['单位'],
      sortOrder: 'asc',
      dedupe: false,
      headerRow: 2
    })
    const rows = await readRows(r.outputs[0])
    expect(rows[0][1]).toBe('2026年发放台账')
    expect(rows[1].slice(1, 3)).toEqual(['单位', '金额'])
    expect(String(rows[2][1])).toBe('A 单位')
  })

  it('只想去重却没选排序列时报错', async () => {
    const p = await makeLedger()
    await expect(
      sortDedupe({ path: p, outDir: tmp, sortColumns: [], sortOrder: 'asc', dedupe: true })
    ).rejects.toThrow('去重需要先选择')
  })
})

describe('分组汇总', () => {
  it('计数：每组行数，含重复条目合并后第一中学组 3 行', async () => {
    const p = await makeLedger()
    const r = await groupSummary({ path: p, outDir: tmp, groupColumns: ['单位'], valueColumns: [], aggregate: 'count' })
    expect(r.groups).toBe(4)
    const out = new Map(r.preview.map(row => [String(row[0]), Number(row[1])]))
    expect(out.get('第一中学')).toBe(3)
    expect(out.get('第二中学')).toBe(1)
    expect(out.get('第10中学')).toBe(1)
    expect(r.header).toEqual(['单位', '计数'])
  })

  it('求和：文本数字也计入，第一中学合计 300', async () => {
    const p = await makeLedger()
    const r = await groupSummary({
      path: p,
      outDir: tmp,
      groupColumns: ['单位'],
      valueColumns: ['金额'],
      aggregate: 'sum'
    })
    const out = new Map(r.preview.map(row => [String(row[0]), Number(row[1])]))
    expect(out.get('第一中学')).toBe(300)
    expect(out.get('第二中学')).toBe(200)
  })

  it('多列分组 + 求最大', async () => {
    const p = await makeLedger()
    const r = await groupSummary({
      path: p,
      outDir: tmp,
      groupColumns: ['单位', '姓名'],
      valueColumns: ['金额'],
      aggregate: 'max'
    })
    expect(r.header).toEqual(['单位', '姓名', '金额_最大'])
    // (单位,姓名) 组合共 4 组
    expect(r.groups).toBe(4)
  })

  it('汇总列缺失时报错', async () => {
    const p = await makeLedger()
    await expect(
      groupSummary({ path: p, outDir: tmp, groupColumns: ['单位'], valueColumns: [], aggregate: 'sum' })
    ).rejects.toThrow('需要选择要汇总的数值列')
  })
})

describe('条件格式', () => {
  it('标出重复：3 条"第一中学/张三"整行命中', async () => {
    const p = await makeLedger()
    const r = await conditionalFormat({
      path: p,
      outDir: tmp,
      columns: ['单位'],
      rule: 'duplicate',
      wholeRow: true,
      fill: '#FFFF00'
    })
    // 单位重复的有：第一中学×3、第2中学与第10中学不算重复 → 3 行
    expect(r.matched).toBe(3)

    const wb = new ExcelJS.Workbook()
    await wb.xlsx.readFile(r.outputs[0])
    const ws = wb.worksheets[0]
    const fill = ws.getRow(2).getCell(1).fill as unknown as { fgColor?: { argb?: string } }
    expect(fill.fgColor?.argb).toBe('FFFFFF00')
    // 第 3 行（第二中学）不重复，不应被上色
    const plain = ws.getRow(3).getCell(1).fill as unknown
    expect(plain).toBeUndefined()
  })

  it('大于阈值：金额 > 100 命中 1 行', async () => {
    const p = await makeLedger()
    const r = await conditionalFormat({
      path: p,
      outDir: tmp,
      columns: ['金额'],
      rule: 'greater',
      value: 100,
      wholeRow: false
    })
    expect(r.matched).toBe(1)
  })

  it('介于两值：50–150 命中 4 行', async () => {
    const p = await makeLedger()
    const r = await conditionalFormat({
      path: p,
      outDir: tmp,
      columns: ['金额'],
      rule: 'between',
      value: 50,
      value2: 150
    })
    expect(r.matched).toBe(4)
  })

  it('阈值缺失时报错', async () => {
    const p = await makeLedger()
    await expect(
      conditionalFormat({ path: p, outDir: tmp, columns: ['金额'], rule: 'greater' })
    ).rejects.toThrow('请填写阈值')
  })
})
