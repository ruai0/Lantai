/**
 * 第四轮实证回归：用真实 Excel / zip 构造边界数据，端到端断言前几轮修复在数据上确实成立。
 * 与其余测试不同，这里刻意覆盖"多 sheet / 多行表头 / 全半角键 / 重复键 / 自定义掩码"等真实台账形态。
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import ExcelJS from 'exceljs'
import { naturalCompare, normalizeKey } from '../src/main/services/fileUtils'
import { compareTables, listSheets, matchFill } from '../src/main/services/excelMatchService'
import { desensitize, splitByRows } from '../src/main/services/excelToolsService'
import { listZipContents, packZip, unpackZip } from '../src/main/services/zipService'

let tmp: string

beforeAll(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lantai-r4-'))
})
afterAll(() => {
  fs.rmSync(tmp, { recursive: true, force: true })
})

async function readFirstSheet(file: string): Promise<ExcelJS.Worksheet> {
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.readFile(file)
  return wb.worksheets[0]
}

describe('第四轮实证：多 sheet 与多行表头', () => {
  it('listSheets 返回全部工作表，且拆分可指定 sheet', async () => {
    const p = path.join(tmp, 'multi.xlsx')
    const wb = new ExcelJS.Workbook()
    const s1 = wb.addWorksheet('汇总')
    s1.addRow(['编号', '名称'])
    s1.addRow(['1', '甲'])
    const s2 = wb.addWorksheet('明细')
    s2.addRow(['编号', '金额'])
    s2.addRow(['1', '100'])
    s2.addRow(['2', '200'])
    await wb.xlsx.writeFile(p)

    expect(await listSheets(p)).toEqual(['汇总', '明细'])

    const out = path.join(tmp, 'out-rows')
    fs.mkdirSync(out, { recursive: true })
    const r = await splitByRows({ path: p, rowsPerFile: 1, outDir: out, sheet: '明细' })
    const ws = await readFirstSheet(r.outputs[0])
    expect(String(ws.getRow(2).getCell(2).value)).toBe('100')
  })

  it('多行表头（表头在第 2 行）拆分时标题与表头整体保留', async () => {
    const p = path.join(tmp, 'hdr2.xlsx')
    const wb = new ExcelJS.Workbook()
    const ws = wb.addWorksheet('台账')
    ws.addRow(['XX单位 2026 年度台账', '', ''])
    ws.addRow(['编号', '姓名', '金额'])
    for (let i = 0; i < 5; i++) ws.addRow([String(i + 1), `人${i + 1}`, String((i + 1) * 10)])
    await wb.xlsx.writeFile(p)

    const out = path.join(tmp, 'out-hdr2')
    fs.mkdirSync(out, { recursive: true })
    const r = await splitByRows({ path: p, rowsPerFile: 2, outDir: out, headerRow: 2 })
    expect(r.outputs).toHaveLength(3)
    const back = await readFirstSheet(r.outputs[0])
    expect(String(back.getRow(1).getCell(1).value)).toContain('台账')
    expect(String(back.getRow(2).getCell(2).value)).toBe('姓名')
  })
})

describe('第四轮实证：键归一化匹配', () => {
  it('全角/半角、前后空格差异的工号都能匹配上', async () => {
    const main = path.join(tmp, 'main.xlsx')
    const look = path.join(tmp, 'look.xlsx')
    const wm = new ExcelJS.Workbook()
    const wsm = wm.addWorksheet('S')
    wsm.addRow(['工号', '姓名'])
    wsm.addRow(['Ａ００１', '张三'])
    wsm.addRow([' A002 ', '李四'])
    await wm.xlsx.writeFile(main)
    const wl = new ExcelJS.Workbook()
    const wsl = wl.addWorksheet('S')
    wsl.addRow(['工号', '部门'])
    wsl.addRow(['A001', '财务部'])
    wsl.addRow(['A002', '技术部'])
    await wl.xlsx.writeFile(look)

    const out = path.join(tmp, 'out-match')
    fs.mkdirSync(out, { recursive: true })
    const r = await matchFill({
      mainPath: main,
      mainKey: '工号',
      lookupPath: look,
      lookupKey: '工号',
      fetchColumns: ['部门'],
      notFoundText: '',
      outDir: out
    })
    expect(r.matched).toBe(2)
    const ws = await readFirstSheet(r.outputs[0])
    expect(String(ws.getRow(2).getCell(3).value)).toBe('财务部')
    expect(String(ws.getRow(3).getCell(3).value)).toBe('技术部')
  })

  it('normalizeKey 对全半角与空格归一', () => {
    expect(normalizeKey('Ａ００１')).toBe(normalizeKey('A001'))
    expect(normalizeKey(' A002 ')).toBe(normalizeKey('A002'))
  })
})

describe('第四轮实证：比对重复键告警', () => {
  it('副表重复键被检出并记录丢行数', async () => {
    const a = path.join(tmp, 'cmp-a.xlsx')
    const b = path.join(tmp, 'cmp-b.xlsx')
    const wa = new ExcelJS.Workbook()
    const wsa = wa.addWorksheet('S')
    wsa.addRow(['编号', '值'])
    wsa.addRow(['K1', '1'])
    await wa.xlsx.writeFile(a)
    const wb2 = new ExcelJS.Workbook()
    const wsb = wb2.addWorksheet('S')
    wsb.addRow(['编号', '值'])
    wsb.addRow(['K1', '1'])
    wsb.addRow(['K1', '2'])
    await wb2.xlsx.writeFile(b)

    const out = path.join(tmp, 'out-cmp')
    fs.mkdirSync(out, { recursive: true })
    const r = await compareTables({
      aPath: a,
      bPath: b,
      aKey: '编号',
      bKey: '编号',
      columns: ['值'],
      outDir: out
    })
    expect((r.dupKeys ?? []).length).toBeGreaterThanOrEqual(1)
    expect(r.droppedRows ?? 0).toBeGreaterThanOrEqual(1)
  })
})

describe('第四轮实证：脱敏与自然序', () => {
  it('自定义掩码字符 ● 写入真实单元格', async () => {
    const p = path.join(tmp, 'mask.xlsx')
    const wb = new ExcelJS.Workbook()
    const ws = wb.addWorksheet('S')
    ws.addRow(['手机号'])
    ws.addRow(['13812345678'])
    await wb.xlsx.writeFile(p)

    const out = path.join(tmp, 'out-mask')
    fs.mkdirSync(out, { recursive: true })
    const r = await desensitize({ path: p, columns: ['手机号'], rule: 'phone', maskChar: '●', outDir: out })
    const back = await readFirstSheet(r.outputs[0])
    expect(String(back.getRow(2).getCell(1).value)).toBe('138●●●●5678')
  })

  it('自然序：第2章 排在 第10章 之前', () => {
    const arr = ['第10章.docx', '第2章.docx', '第1章.docx', '第20章.docx']
    expect([...arr].sort(naturalCompare)).toEqual(['第1章.docx', '第2章.docx', '第10章.docx', '第20章.docx'])
  })
})

describe('第四轮实证：zip 挑包 / 预览 / 加密', () => {
  it('挑选文件打包保留层级，预览清单一致', async () => {
    const base = path.join(tmp, 'z')
    fs.mkdirSync(path.join(base, 'a'), { recursive: true })
    fs.mkdirSync(path.join(base, 'b'), { recursive: true })
    const f1 = path.join(base, 'a', '1.txt')
    const f2 = path.join(base, 'b', '2.txt')
    fs.writeFileSync(f1, 'x')
    fs.writeFileSync(f2, 'y')
    const out = path.join(tmp, 'zout')
    fs.mkdirSync(out, { recursive: true })
    const packed = await packZip({ paths: [f1, f2], outDir: out, level: 'max' })
    expect(packed.count).toBe(2)
    const list = await listZipContents({ paths: [f1, f2] })
    expect(list.files.map(f => f.rel).sort().join(',')).toBe('a/1.txt,b/2.txt')
  })

  it('加密 zip 给出明确提示而非“文件损坏”', async () => {
    const buf = Buffer.alloc(64)
    const eocd = 22
    buf.writeUInt32LE(0x06054b50, eocd)
    buf.writeUInt16LE(1, eocd + 10)
    buf.writeUInt32LE(0, eocd + 16)
    buf.writeUInt32LE(0x02014b50, 0)
    buf.writeUInt16LE(0x0001, 8)
    const bad = path.join(tmp, 'enc.zip')
    fs.writeFileSync(bad, buf)
    const out = path.join(tmp, 'enc-out')
    fs.mkdirSync(out, { recursive: true })
    await expect(unpackZip({ paths: [bad], outDir: out })).rejects.toThrow(/已加密/)
  })
})
