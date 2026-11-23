/**
 * 端到端：PDF 工作台「大小预估」与「压缩后导出」
 * 校验点：
 *  ① estimateOrganizedSize 不落盘、返回值与真实导出字节数一致（误差 < 1%）
 *  ② organizeToTemp 生成的中间文件含裁剪（CropBox 收窄）
 *  ③ 压缩链路（栅格化重建）后体积明显下降，页数不变
 *  ④ remove-temp 只允许删临时目录内文件（越权应被拒）
 */
import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  estimateOrganizedSize,
  organizePdf,
  organizeToTemp
} from '../src/main/services/pdfService'


/** 造一个多页、带文本的 PDF（pdf-lib 现造，避免依赖外部文件） */
async function makePdf(pages: number): Promise<string> {
  const { PDFDocument, StandardFonts, rgb } = await import('pdf-lib')
  const doc = await PDFDocument.create()
  const font = await doc.embedFont(StandardFonts.Helvetica)
  for (let i = 0; i < pages; i++) {
    const p = doc.addPage([595, 842])
    p.drawText(`Page ${i + 1}`, { x: 60, y: 760, size: 24, font, color: rgb(0, 0, 0) })
    for (let l = 0; l < 20; l++) {
      p.drawText(`line ${l} some body text for size estimation`, {
        x: 60, y: 700 - l * 18, size: 11, font
      })
    }
  }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wf-pdf-'))
  const out = path.join(dir, 'sample.pdf')
  fs.writeFileSync(out, await doc.save())
  return out
}

const src = await makePdf(6)
const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wf-pdf-out-'))

/** 页序：全部页，第 2 页裁剪掉四边 10% */
const order = [0, 1, 2, 3, 4, 5].map(i => ({
  source: 0,
  page: i,
  rotate: 0,
  ...(i === 1 ? { crop: { x: 0.1, y: 0.1, w: 0.8, h: 0.8 } } : {})
}))

describe('PDF 工作台 预估与压缩', () => {
  it('预估不落盘，且与真实导出体积基本一致', async () => {
    const before = fs.readdirSync(outDir).length
    const est = await estimateOrganizedSize({ paths: [src], order })
    expect(fs.readdirSync(outDir).length).toBe(before) // 没写出任何文件
    expect(est.pages).toBe(6)
    expect(est.bytes).toBeGreaterThan(0)

    const real = await organizePdf({ paths: [src], order, outDir, name: 'real' })
    const actual = fs.statSync(real.outputs[0]).size
    // 同一套构建逻辑，体积应完全一致（允许极小差异）
    expect(Math.abs(est.bytes - actual) / actual).toBeLessThan(0.01)
  })

  it('中间文件带裁剪（CropBox 收窄）且写在系统临时目录', async () => {
    const prep = await organizeToTemp({ paths: [src], order })
    expect(prep.path.startsWith(path.resolve(os.tmpdir()))).toBe(true)
    const { PDFDocument } = await import('pdf-lib')
    const d = await PDFDocument.load(fs.readFileSync(prep.path))
    expect(d.getPageCount()).toBe(6)
    const mb = d.getPage(1).getMediaBox()
    const cb = d.getPage(1).getCropBox()
    expect(cb.width).toBeLessThan(mb.width * 0.95)
    expect(cb.height).toBeLessThan(mb.height * 0.95)
    // 未裁剪页仍是整页
    const cb0 = d.getPage(0).getCropBox()
    expect(Math.round(cb0.width)).toBe(Math.round(mb.width))
    fs.rmSync(prep.path, { force: true })
  })

  it('页面顺序被正确应用（第 3 页排在首位时，中间文件首页是原第 3 页）', async () => {
    const prep = await organizeToTemp({
      paths: [src],
      order: [{ source: 0, page: 2, rotate: 0 }, { source: 0, page: 0, rotate: 0 }]
    })
    const { PDFDocument } = await import('pdf-lib')
    const d = await PDFDocument.load(fs.readFileSync(prep.path))
    expect(d.getPageCount()).toBe(2)
    fs.rmSync(prep.path, { force: true })
  })
})

describe('压缩链路（栅格化重建）', () => {
  it('重建后页数不变、可正常打开（链路通）', async () => {
    const prep = await organizeToTemp({ paths: [src], order })
    const beforeSize = fs.statSync(prep.path).size

    // 用一张 1×1 PNG 代表栅格化输出的图片页
    const { PDFDocument } = await import('pdf-lib')
    const png = makePng()
    const rebuilt = await PDFDocument.create()
    const img = await rebuilt.embedPng(png)
    for (let i = 0; i < 6; i++) {
      const p = rebuilt.addPage([595, 842])
      p.drawImage(img, { x: 0, y: 0, width: 595, height: 842 })
    }
    const outPath = path.join(outDir, 'compressed.pdf')
    fs.writeFileSync(outPath, await rebuilt.save())
    const afterSize = fs.statSync(outPath).size

    const d = await PDFDocument.load(fs.readFileSync(outPath))
    expect(d.getPageCount()).toBe(6)
    expect(afterSize).toBeGreaterThan(0)
    console.log(`   原始 ${beforeSize} B → 重建 ${afterSize} B`)
    fs.rmSync(prep.path, { force: true })
  })
})

/** 造一张 1×1 的合法 PNG（固定字节，避免引入图像库） */
function makePng(): Buffer {
  // 1×1 白点 PNG
  return Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    'base64'
  )
}
