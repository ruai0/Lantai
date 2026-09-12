import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import ExcelJS from 'exceljs'
import PizZip from 'pizzip'
import { PDFDocument } from 'pdf-lib'
import { stampImage, watermarkPdf } from '../src/main/services/pdfService'
import { csvToXlsx, desensitize, splitBySheets } from '../src/main/services/excelToolsService'
import { matchFill } from '../src/main/services/excelMatchService'
import { compareTables } from '../src/main/services/excelMatchService'
import { findDuplicates } from '../src/main/services/inventoryService'
import { extractAndSave } from '../src/main/services/extractService'
import { officeToPdf } from '../src/main/services/officeToPdfService'

let tmp: string
const TINY_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64'
)

async function writeXlsx(name: string, rows: (string | number)[][], sheets = 1): Promise<string> {
  const wb = new ExcelJS.Workbook()
  for (let s = 0; s < sheets; s++) {
    const ws = wb.addWorksheet(`表${s + 1}`)
    rows.forEach(r => ws.addRow(r))
  }
  const p = path.join(tmp, name)
  await wb.xlsx.writeFile(p)
  return p
}

async function writeDocx(name: string, text: string): Promise<string> {
  const zip = new PizZip()
  zip.file('[Content_Types].xml', '<Types/>')
  zip.file(
    'word/document.xml',
    `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:p><w:r><w:t>${text}</w:t></w:r></w:p></w:document>`
  )
  const p = path.join(tmp, name)
  fs.writeFileSync(p, zip.generate({ type: 'nodebuffer' }))
  return p
}

async function makePdf(name: string, pages: number): Promise<string> {
  const doc = await PDFDocument.create()
  for (let i = 0; i < pages; i++) doc.addPage([400, 300])
  const p = path.join(tmp, name)
  await fs.promises.writeFile(p, await doc.save())
  return p
}

beforeAll(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'freetool-func-'))
})

afterAll(() => {
  fs.rmSync(tmp, { recursive: true, force: true })
})

describe('PDF 盖章与水印（真实文件）', () => {
  it('图片盖章：默认全部页，页数不变且文件可读', async () => {
    const src = await makePdf('s.pdf', 3)
    const img = path.join(tmp, 'seal.png')
    await fs.promises.writeFile(img, TINY_PNG)
    const r = await stampImage({
      path: src,
      imagePath: img,
      scalePercent: 25,
      opacity: 0.8,
      position: 'bottom-right',
      outDir: tmp
    })
    expect(fs.existsSync(r.outputs[0])).toBe(true)
    const doc = await PDFDocument.load(await fs.promises.readFile(r.outputs[0]))
    expect(doc.getPageCount()).toBe(3)
  })

  it('盖章可只作用于指定页', async () => {
    const src = await makePdf('s2.pdf', 2)
    const img = path.join(tmp, 'seal.png')
    const r = await stampImage({
      path: src,
      imagePath: img,
      scalePercent: 20,
      opacity: 1,
      position: 'center',
      ranges: '1',
      outDir: tmp
    })
    expect(r.outputs).toHaveLength(1)
  })

  it('拒绝非图片盖章文件', async () => {
    const src = await makePdf('s3.pdf', 1)
    const bad = path.join(tmp, 'bad.txt')
    await fs.promises.writeFile(bad, 'x')
    await expect(
      stampImage({ path: src, imagePath: bad, scalePercent: 20, opacity: 1, position: 'center', outDir: tmp })
    ).rejects.toThrow('PNG / JPG')
  })

  it('中文水印产出可读 PDF', async () => {
    const fontsDir = path.join(process.env.SystemRoot ?? 'C:\\Windows', 'Fonts')
    if (!fs.existsSync(path.join(fontsDir, 'simhei.ttf'))) return
    const src = await makePdf('wm2.pdf', 2)
    const r = await watermarkPdf({
      path: src,
      text: '内部资料 请勿外传',
      fontSize: 28,
      opacity: 0.25,
      rotation: -30,
      tile: true,
      color: 'red',
      outDir: tmp
    })
    const doc = await PDFDocument.load(await fs.promises.readFile(r.outputs[0]))
    expect(doc.getPageCount()).toBe(2)
  })
})

describe('Excel 功能（真实文件）', () => {
  it('多 sheet 文件按表拆分', async () => {
    const src = await writeXlsx('multi.xlsx', [['列A', '列B'], ['1', '2']], 3)
    const r = await splitBySheets({ path: src, outDir: tmp })
    expect(r.outputs).toHaveLength(3)
    r.outputs.forEach(o => expect(fs.existsSync(o)).toBe(true))
  })

  it('制表符分隔的 CSV 也能转换', async () => {
    const csv = path.join(tmp, 'tab.csv')
    await fs.promises.writeFile(csv, '名称\t数量\n苹果\t3\n', 'utf-8')
    const r = await csvToXlsx({ paths: [csv], encoding: 'utf8', outDir: tmp })
    const wb = new ExcelJS.Workbook()
    await wb.xlsx.readFile(r.outputs[0])
    expect(wb.worksheets[0].getRow(2).getCell(1).value).toBe('苹果')
    expect(wb.worksheets[0].getRow(2).getCell(2).value).toBe(3)
  })

  it('自定义脱敏规则按保留位数打码', async () => {
    const src = await writeXlsx('cust.xlsx', [['编号', '备注'], ['AB123456CD', 'x']])
    const r = await desensitize({ path: src, columns: ['编号'], rule: 'custom', keepHead: 2, keepTail: 2, outDir: tmp })
    const wb = new ExcelJS.Workbook()
    await wb.xlsx.readFile(r.outputs[0])
    expect(wb.worksheets[0].getRow(2).getCell(1).value).toBe('AB******CD')
    expect(wb.worksheets[0].getRow(2).getCell(2).value).toBe('x')
  })

  it('匹配填充：副表重复关联键取首次出现', async () => {
    const main = await writeXlsx('mf_main.xlsx', [['工号', '姓名'], ['7', '赵六']])
    const look = await writeXlsx('mf_look.xlsx', [
      ['工号', '部门'],
      ['7', '第一部门'],
      ['7', '第二部门']
    ])
    const r = await matchFill({
      mainPath: main,
      mainKey: '工号',
      lookupPath: look,
      lookupKey: '工号',
      fetchColumns: ['部门'],
      outDir: tmp
    })
    const wb = new ExcelJS.Workbook()
    await wb.xlsx.readFile(r.outputs[0])
    expect(wb.worksheets[0].getRow(2).getCell(3).value).toBe('第一部门')
  })

  it('比对：不指定列时比较全部共有列', async () => {
    const a = await writeXlsx('cmp_a.xlsx', [['工号', '姓名', '部门'], ['1', '张三', 'A']])
    const b = await writeXlsx('cmp_b.xlsx', [['工号', '姓名', '部门'], ['1', '张三', 'B']])
    const r = await compareTables({ aPath: a, aKey: '工号', bPath: b, bKey: '工号', outDir: tmp })
    expect(r.changed).toBe(1)
    expect(r.same).toBe(0)
  })

  it('关联列不存在时给出明确报错', async () => {
    const a = await writeXlsx('bad_a.xlsx', [['工号'], ['1']])
    const b = await writeXlsx('bad_b.xlsx', [['编号'], ['1']])
    await expect(
      compareTables({ aPath: a, aKey: '工号', bPath: b, bKey: '工号', outDir: tmp })
    ).rejects.toThrow('找不到列')
  })
})

describe('文件管理与提取（真实目录）', () => {
  it('在真实目录里查出重复文件', async () => {
    const dir = path.join(tmp, 'dup')
    fs.mkdirSync(path.join(dir, 'sub'), { recursive: true })
    const blob = Buffer.alloc(200 * 1024, 7)
    fs.writeFileSync(path.join(dir, 'a.bin'), blob)
    fs.writeFileSync(path.join(dir, 'sub', 'copy.bin'), blob)
    fs.writeFileSync(path.join(dir, 'other.bin'), Buffer.alloc(200 * 1024, 9))
    const r = await findDuplicates({ dir, recursive: true, minSizeKB: 100 })
    expect(r.scanned).toBe(3)
    expect(r.groups).toHaveLength(1)
    expect(r.groups[0].files).toHaveLength(2)
  })

  it('跨 docx 与 txt 提取并去重', async () => {
    const out = path.join(tmp, 'extract-out')
    fs.mkdirSync(out, { recursive: true })
    const txt = path.join(tmp, 'contacts.txt')
    await fs.promises.writeFile(txt, '张三 13800001111，李四 13800001111', 'utf-8')
    const docx = await writeDocx('contacts.docx', '王五 13900002222')
    const r = await extractAndSave({ paths: [txt, docx], kinds: ['phone'], dedupe: true, outDir: out })
    expect(r.counts.find(c => c.kind === 'phone')?.count).toBe(2)
    const content = fs.readFileSync(r.outputs[0], 'utf-8')
    expect(content).toContain('13800001111')
    expect(content).toContain('13900002222')
  })

  it('GBK 文本被自动按 GBK 解码', async () => {
    const { default: iconv } = await import('iconv-lite')
    const out = path.join(tmp, 'extract-gbk')
    fs.mkdirSync(out, { recursive: true })
    const p = path.join(tmp, 'gbk.txt')
    fs.writeFileSync(p, iconv.encode('联系人 13700007777 邮箱 a@b.com', 'gbk'))
    const r = await extractAndSave({ paths: [p], kinds: ['phone', 'email'], dedupe: true, outDir: out })
    expect(r.counts.find(c => c.kind === 'phone')?.count).toBe(1)
    expect(r.counts.find(c => c.kind === 'email')?.count).toBe(1)
  })
})

describe('Office 转 PDF（依赖本机 Office / WPS）', () => {
  it('Excel 能转出 PDF（未装 Office/WPS 时跳过）', async () => {
    const src = await writeXlsx('to-pdf.xlsx', [['项目', '数值'], ['甲', 12]])
    const out = path.join(tmp, 'pdf-out')
    fs.mkdirSync(out, { recursive: true })
    let r
    try {
      r = await officeToPdf({ paths: [src], outDir: out })
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      // 本机没有可用的 Office/WPS 组件时不算功能缺陷
      if (msg.includes('未安装') || msg.includes('无法启动 PowerShell')) return
      throw e
    }
    expect(r.outputs, JSON.stringify(r.failed)).toHaveLength(1)
    expect(r.failed).toHaveLength(0)
    const bytes = await fs.promises.readFile(r.outputs[0])
    expect(bytes.subarray(0, 5).toString()).toBe('%PDF-')
    expect(bytes.length).toBeGreaterThan(500)
  }, 180000)

  it('拒绝不支持的格式', async () => {
    const bad = path.join(tmp, 'x.txt')
    await fs.promises.writeFile(bad, 'x')
    await expect(officeToPdf({ paths: [bad], outDir: tmp })).rejects.toThrow('仅支持')
  })
})
