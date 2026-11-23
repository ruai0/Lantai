import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import ExcelJS from 'exceljs'
import { PDFDocument } from 'pdf-lib'
import { compareTables, matchFill, normalizeKey } from '../src/main/services/excelMatchService'
import { mergeWorkbooks } from '../src/main/services/excelToolsService'
import { buildFromImages, organizePdf, pagesInfo } from '../src/main/services/pdfService'

let tmp: string

const TINY_PNG_B64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='

// 1x1 JPEG：解码后仅 160 字节，Buffer.from 会落进 Node 共享内存池（byteOffset≠0）。
// pdf-lib 的 JpegEmbedder 用 new DataView(buf.buffer) 从 0 读魔数，池内 Buffer 会误报「SOI not found」。
// buildFromImages 内部已用 standalone() 拷贝成独立 Uint8Array 规避，此测试锁死该回归。
const TINY_JPG_B64 =
  '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AVN//2Q=='

async function writeSheet(name: string, rows: (string | number)[][]): Promise<string> {
  const wb = new ExcelJS.Workbook()
  const ws = wb.addWorksheet('S')
  rows.forEach(r => ws.addRow(r))
  const p = path.join(tmp, name)
  await wb.xlsx.writeFile(p)
  return p
}

beforeAll(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'freetool-test3-'))
})

afterAll(() => {
  fs.rmSync(tmp, { recursive: true, force: true })
})

describe('normalizeKey', () => {
  it('去空白并归一化整数的 .0 形式', () => {
    expect(normalizeKey(' 13800138000 ')).toBe('13800138000')
    expect(normalizeKey('100.0')).toBe('100')
    expect(normalizeKey(100)).toBe('100')
    expect(normalizeKey('0571')).toBe('0571')
  })
})

describe('跨表匹配填充', () => {
  it('按关联键取列，未匹配填指定文本', async () => {
    const main = await writeSheet('m.xlsx', [
      ['工号', '姓名'],
      ['1', '张三'],
      ['2', '李四'],
      ['9', '王五']
    ])
    const look = await writeSheet('l.xlsx', [
      ['工号', '部门', '电话'],
      ['1', '网络部', '138'],
      ['2', '政企部', '139']
    ])
    const r = await matchFill({
      mainPath: main,
      mainKey: '工号',
      lookupPath: look,
      lookupKey: '工号',
      fetchColumns: ['部门', '电话'],
      notFoundText: '未匹配',
      outDir: tmp
    })
    expect(r).toMatchObject({ total: 3, matched: 2, unmatched: 1 })
    const wb = new ExcelJS.Workbook()
    await wb.xlsx.readFile(r.outputs[0])
    const ws = wb.worksheets[0]
    expect(ws.getRow(1).getCell(3).value).toBe('部门')
    expect(ws.getRow(1).getCell(4).value).toBe('电话')
    expect(ws.getRow(2).getCell(3).value).toBe('网络部')
    expect(ws.getRow(4).getCell(3).value).toBe('未匹配')
  })
})

describe('两表差异比对', () => {
  it('输出新增/删除/变更/一致计数与报告', async () => {
    const a = await writeSheet('a.xlsx', [
      ['工号', '姓名', '部门'],
      ['1', '张三', 'A部'],
      ['2', '李四', 'B部'],
      ['3', '王五', 'C部']
    ])
    const b = await writeSheet('b.xlsx', [
      ['工号', '姓名', '部门'],
      ['1', '张三', 'A部'], // 一致
      ['2', '李四', '换部'], // 变更
      ['4', '赵六', 'D部'] // 新增（只在 B）；3 为删除（只在 A）
    ])
    const r = await compareTables({ aPath: a, aKey: '工号', bPath: b, bKey: '工号', columns: ['部门'], outDir: tmp })
    expect(r.same).toBe(1)
    expect(r.changed).toBe(1)
    expect(r.onlyInA).toBe(1)
    expect(r.onlyInB).toBe(1)
    expect(fs.existsSync(r.outputPath)).toBe(true)
  })
})

describe('PDF 页面整理 / 重建', () => {
  async function makePdf(name: string, pages: number): Promise<string> {
    const doc = await PDFDocument.create()
    for (let i = 0; i < pages; i++) doc.addPage([300, 200])
    const p = path.join(tmp, name)
    if (!p.startsWith(tmp + path.sep)) throw new Error('fixture 路径越界')
    await fs.promises.writeFile(p, await doc.save())
    return p
  }

  it('pagesInfo 返回页数', async () => {
    const p = await makePdf('pi.pdf', 3)
    const r = await pagesInfo({ paths: [p] })
    expect(r.pages[0].count).toBe(3)
  })

  it('organizePdf 跨文件重排', async () => {
    const one = await makePdf('o1.pdf', 2)
    const two = await makePdf('o2.pdf', 3)
    const r = await organizePdf({
      paths: [one, two],
      order: [
        { source: 1, page: 0 },
        { source: 0, page: 1 },
        { source: 1, page: 2 }
      ],
      outDir: tmp
    })
    const doc = await PDFDocument.load(await fs.promises.readFile(r.outputs[0]))
    expect(doc.getPageCount()).toBe(3)
  })

  it('buildFromImages 每图一页', async () => {
    const r = await buildFromImages({ imagesBase64: [TINY_PNG_B64, TINY_PNG_B64], outDir: tmp, nameHint: '压缩测试' })
    const doc = await PDFDocument.load(await fs.promises.readFile(r.outputs[0]))
    expect(doc.getPageCount()).toBe(2)
  })

  it('buildFromImages 能嵌入池内小 JPEG（回归 SOI bug）', async () => {
    const r = await buildFromImages({ imagesBase64: [TINY_JPG_B64], outDir: tmp, nameHint: '小jpeg' })
    const doc = await PDFDocument.load(await fs.promises.readFile(r.outputs[0]))
    expect(doc.getPageCount()).toBe(1)
  })

  it('organizePdf 支持逐页旋转', async () => {
    const one = await makePdf('rot.pdf', 2)
    const r = await organizePdf({
      paths: [one],
      order: [
        { source: 0, page: 0, rotate: 90 },
        { source: 0, page: 1, rotate: 180 }
      ],
      outDir: tmp
    })
    const doc = await PDFDocument.load(await fs.promises.readFile(r.outputs[0]))
    expect(doc.getPage(0).getRotation().angle).toBe(90)
    expect(doc.getPage(1).getRotation().angle).toBe(180)
  })
})

describe('跨表匹配填充增强', () => {
  it('输出未匹配标记列与重复键提示', async () => {
    const main = await writeSheet('m2.xlsx', [
      ['工号', '姓名'],
      ['1', '张三'],
      ['9', '王五']
    ])
    const look = await writeSheet('l2.xlsx', [
      ['工号', '部门'],
      ['1', '网络部'],
      ['1', '政企部']
    ])
    const r = await matchFill({
      mainPath: main,
      mainKey: '工号',
      lookupPath: look,
      lookupKey: '工号',
      fetchColumns: ['部门'],
      notFoundText: '',
      outDir: tmp
    })
    expect(r.matched).toBe(1)
    expect(r.unmatched).toBe(1)
    expect(r.dupKeys).toContain('1')
    const wb = new ExcelJS.Workbook()
    await wb.xlsx.readFile(r.outputs[0])
    const ws = wb.worksheets[0]
    // 未匹配行在「匹配状态」列标注
    expect(ws.getRow(1).getCell(4).value).toBe('匹配状态')
    expect(ws.getRow(3).getCell(4).value).toBe('未匹配')
  })
})

describe('Excel 合并表头行', () => {
  it('可指定表头所在行（第 2 行）并归一化列名', async () => {
    const a = await writeSheet('mh1.xlsx', [
      ['某单位台账（2026）'],
      ['姓名', '部门（全称）'],
      ['张三', '网络部']
    ])
    const b = await writeSheet('mh2.xlsx', [
      ['另一批'],
      ['姓名', '部门(全称)'],
      ['李四', '政企部']
    ])
    const r = await mergeWorkbooks({ paths: [a, b], mode: 'single', outDir: tmp, headerRow: 2 })
    const wb = new ExcelJS.Workbook()
    await wb.xlsx.readFile(r.outputs[0])
    const ws = wb.worksheets[0]
    // 全半角括号差异被归一，列对齐为同一列
    expect(ws.getRow(1).getCell(1).value).toBe('姓名')
    expect(ws.getRow(2).getCell(2).value).toBe('网络部')
    expect(ws.getRow(3).getCell(2).value).toBe('政企部')
  })

  it('表头行不存在时给出明确错误', async () => {
    const a = await writeSheet('mh3.xlsx', [['只有一行']])
    await expect(mergeWorkbooks({ paths: [a, a], mode: 'single', outDir: tmp, headerRow: 5 })).rejects.toThrow(/第 5 行/)
  })
})
