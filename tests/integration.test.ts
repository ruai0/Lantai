import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import ExcelJS from 'exceljs'
import { PDFDocument, rgb, StandardFonts } from 'pdf-lib'
import { csvToXlsx, desensitize, mergeWorkbooks, splitByColumn, splitByRows, splitBySheets } from '../src/main/services/excelToolsService'
import { deletePdfPages, imagesToPdf, watermarkPdf } from '../src/main/services/pdfService'
import { exportInventory } from '../src/main/services/inventoryService'

let tmp: string

const TINY_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64'
)

async function makeXlsx(name: string, rows: string[][]): Promise<string> {
  const wb = new ExcelJS.Workbook()
  const ws = wb.addWorksheet('Sheet1')
  rows.forEach(r => ws.addRow(r))
  const p = path.join(tmp, name)
  await wb.xlsx.writeFile(p)
  return p
}

async function makePdf(name: string, pages: number): Promise<string> {
  const doc = await PDFDocument.create()
  const font = await doc.embedFont(StandardFonts.Helvetica)
  for (let i = 0; i < pages; i++) {
    const page = doc.addPage([300, 200])
    page.drawText(`p${i}`, { x: 10, y: 100, size: 12, font, color: rgb(0, 0, 0) })
  }
  const p = path.join(tmp, name)
  if (!p.startsWith(tmp + path.sep)) throw new Error('fixture 路径越界')
  await fs.promises.writeFile(p, await doc.save())
  return p
}

beforeAll(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'freetool-test-'))
})

afterAll(() => {
  fs.rmSync(tmp, { recursive: true, force: true })
})

describe('Excel 多簿合并', () => {
  it('每文件一个工作表', async () => {
    const a = await makeXlsx('a.xlsx', [['姓名', '电话'], ['张三', '13800000000']])
    const b = await makeXlsx('b.xlsx', [['城市', '月份'], ['杭州', '1月']])
    const r = await mergeWorkbooks({ paths: [a, b], mode: 'sheets', outDir: tmp })
    expect(r.outputs).toHaveLength(1)
    const wb = new ExcelJS.Workbook()
    await wb.xlsx.readFile(r.outputs[0])
    expect(wb.worksheets.map(w => w.name).sort()).toEqual(['a', 'b'])
  })

  it('合并成一张表按表头对齐', async () => {
    const a = await makeXlsx('m1.xlsx', [['姓名', '电话'], ['张三', '138'], ['李四', '139']])
    const b = await makeXlsx('m2.xlsx', [['姓名', '城市'], ['王五', '杭州']])
    const r = await mergeWorkbooks({ paths: [a, b], mode: 'single', outDir: tmp })
    const wb = new ExcelJS.Workbook()
    await wb.xlsx.readFile(r.outputs[0])
    const ws = wb.worksheets[0]
    expect(ws.getRow(1).getCell(2).value).toBe('电话')
    // a 有 2 行数据，b 的数据从第 4 行开始
    expect(ws.getRow(4).getCell(1).value).toBe('王五')
    expect(ws.getRow(4).getCell(3).value).toBe('杭州')
    expect(ws.rowCount).toBe(4)
  })
})

describe('Excel 拆分', () => {
  it('按工作表拆分', async () => {
    const wb = new ExcelJS.Workbook()
    wb.addWorksheet('一月').addRow(['月份', '金额'])
    wb.addWorksheet('二月').addRow(['月份', '金额'])
    const src = path.join(tmp, 's.xlsx')
    await wb.xlsx.writeFile(src)
    const r = await splitBySheets({ path: src, outDir: tmp })
    expect(r.outputs).toHaveLength(2)
    expect(path.basename(r.outputs[0])).toContain('一月')
    expect(path.basename(r.outputs[1])).toContain('二月')
  })

  it('按列值拆分并带表头', async () => {
    const src = await makeXlsx('col.xlsx', [
      ['单位', '金额'],
      ['杭州', '100'],
      ['宁波', '200'],
      ['杭州', '300'],
      ['', '400']
    ])
    const r = await splitByColumn({ path: src, column: '单位', outDir: tmp })
    expect(r.groups).toBe(3)
    const hangzhou = r.outputs.find(p => p.includes('杭州'))
    expect(hangzhou).toBeTruthy()
    const wb = new ExcelJS.Workbook()
    await wb.xlsx.readFile(hangzhou ?? '')
    const ws = wb.worksheets[0]
    expect(ws.getRow(1).getCell(1).value).toBe('单位')
    expect(ws.rowCount).toBe(3)
    expect(ws.getRow(2).getCell(2).value).toBe('100')
  })

  it('按行数拆分并带表头', async () => {
    const rows = [['编号', '值']]
    for (let i = 1; i <= 7; i++) rows.push([String(i), 'x'])
    const src = await makeXlsx('rows.xlsx', rows)
    const r = await splitByRows({ path: src, rowsPerFile: 3, outDir: tmp })
    expect(r.outputs).toHaveLength(3)
    const wb = new ExcelJS.Workbook()
    await wb.xlsx.readFile(r.outputs[0])
    expect(wb.worksheets[0].getRow(1).getCell(1).value).toBe('编号')
    expect(wb.worksheets[0].rowCount).toBe(4)
  })
})

describe('CSV 转 Excel', () => {
  it('UTF-8 基本转换并保留前导零', async () => {
    const csv = path.join(tmp, 't.csv')
    await fs.promises.writeFile(csv, '编号,城市\n0571,杭州\n', 'utf-8')
    const r = await csvToXlsx({ paths: [csv], encoding: 'utf8', outDir: tmp })
    const wb = new ExcelJS.Workbook()
    await wb.xlsx.readFile(r.outputs[0])
    const ws = wb.worksheets[0]
    expect(ws.getRow(2).getCell(1).value).toBe('0571')
    expect(ws.getRow(2).getCell(2).value).toBe('杭州')
  })

  it('GBK 编码转换', async () => {
    const { default: iconv } = await import('iconv-lite')
    const csv = path.join(tmp, 'g.csv')
    await fs.promises.writeFile(csv, iconv.encode('编号,城市\n001,北京\n', 'gbk'))
    const r = await csvToXlsx({ paths: [csv], encoding: 'gbk', outDir: tmp })
    const wb = new ExcelJS.Workbook()
    await wb.xlsx.readFile(r.outputs[0])
    expect(wb.worksheets[0].getRow(2).getCell(2).value).toBe('北京')
  })
})

describe('数据脱敏', () => {
  it('按列脱敏并返回抽样', async () => {
    const src = await makeXlsx('mask.xlsx', [
      ['姓名', '手机号', '备注'],
      ['张三', '13812345678', '无'],
      ['李四', '13987654321', '无']
    ])
    const r = await desensitize({ path: src, columns: ['姓名'], rule: 'name', outDir: tmp })
    const r2 = await desensitize({ path: src, columns: ['手机号'], rule: 'phone', outDir: tmp })
    const wb = new ExcelJS.Workbook()
    await wb.xlsx.readFile(r.outputs[0])
    const ws = wb.worksheets[0]
    expect(ws.getRow(2).getCell(1).value).toBe('张*')
    expect(r.previews).toHaveLength(1)
    const wb2 = new ExcelJS.Workbook()
    await wb2.xlsx.readFile(r2.outputs[0])
    const ws2 = wb2.worksheets[0]
    expect(ws2.getRow(2).getCell(2).value).toBe('138****5678')
    expect(ws2.getRow(2).getCell(1).value).toBe('张三')
    expect(ws2.getRow(2).getCell(3).value).toBe('无')
  })
})

describe('PDF 服务', () => {
  it('图片合成 PDF（每图一页）', async () => {
    const p1 = path.join(tmp, 'i1.png')
    const p2 = path.join(tmp, 'i2.png')
    await fs.promises.writeFile(p1, TINY_PNG)
    await fs.promises.writeFile(p2, TINY_PNG)
    const r = await imagesToPdf({ paths: [p1, p2], outDir: tmp })
    const doc = await PDFDocument.load(await fs.promises.readFile(r.outputs[0]))
    expect(doc.getPageCount()).toBe(2)
  })

  it('删除指定页', async () => {
    const src = await makePdf('del.pdf', 4)
    const r = await deletePdfPages({ path: src, ranges: '2-3', outDir: tmp })
    const doc = await PDFDocument.load(await fs.promises.readFile(r.outputs[0]))
    expect(doc.getPageCount()).toBe(2)
  })

  it('中文水印使用系统中文字体', async () => {
    const fontsDir = path.join(process.env.SystemRoot ?? 'C:\\Windows', 'Fonts')
    const hasCjk = fs.existsSync(path.join(fontsDir, 'simhei.ttf'))
    if (!hasCjk) return
    const src = await makePdf('wm.pdf', 1)
    const r = await watermarkPdf({
      path: src,
      text: '内部资料',
      fontSize: 24,
      opacity: 0.3,
      rotation: -45,
      tile: true,
      color: 'gray',
      outDir: tmp
    })
    const doc = await PDFDocument.load(await fs.promises.readFile(r.outputs[0]))
    expect(doc.getPageCount()).toBe(1)
  })
})

describe('文件清单', () => {
  it('导出 xlsx 清单', async () => {
    const sub = path.join(tmp, 'dir-a')
    fs.mkdirSync(sub, { recursive: true })
    await fs.promises.writeFile(path.join(sub, 'b.txt'), 'hello')
    await fs.promises.writeFile(path.join(tmp, 'a.txt'), 'x'.repeat(10))
    const r = await exportInventory({ dir: tmp, recursive: true, outDir: tmp })
    expect(r.count).toBeGreaterThanOrEqual(2)
    const wb = new ExcelJS.Workbook()
    await wb.xlsx.readFile(r.outputPath)
    expect(wb.worksheets[0].getRow(1).getCell(2).value).toBe('文件名')
  })
})
