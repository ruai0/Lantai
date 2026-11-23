import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import zlib from 'node:zlib'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib'

// pdfService 依赖 taskProgress，后者 import electron；这里用桩替代
vi.mock('electron', () => ({
  BrowserWindow: { getAllWindows: () => [] }
}))

import {
  addHeaderFooter,
  batchPdf,
  extractPdfImages,
  imagesToPdf,
  readPdfMeta,
  resizePdfPages,
  writePdfMeta
} from '../src/main/services/pdfService'

/** 图片转 PDF（默认 A4 适配） */
const saveImageToPdf = (imgPath: string) =>
  imagesToPdf({ paths: [imgPath], outDir: path.dirname(imgPath), fit: 'a4' })

let table: Int32Array | null = null
function crc32(buf: Buffer): number {
  if (!table) {
    table = new Int32Array(256)
    for (let n = 0; n < 256; n++) {
      let c = n
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
      table[n] = c
    }
  }
  let c = ~0
  for (let i = 0; i < buf.length; i++) c = table[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return ~c >>> 0
}
function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body))
  return Buffer.concat([len, body, crc])
}
/** 构造一块 8bit RGB PNG（行 filter 全 0），用于验证图片提取的往返正确性 */
function makePng(w: number, h: number): Uint8Array {
  const raw = Buffer.alloc((w * 3 + 1) * h)
  let o = 0
  for (let y = 0; y < h; y++) {
    raw[o++] = 0
    for (let x = 0; x < w; x++) {
      raw[o++] = (x * 7) & 255
      raw[o++] = (y * 11) & 255
      raw[o++] = ((x + y) * 13) & 255
    }
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(w, 0)
  ihdr.writeUInt32BE(h, 4)
  ihdr[8] = 8
  ihdr[9] = 2
  return new Uint8Array(
    Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      chunk('IHDR', ihdr),
      chunk('IDAT', zlib.deflateSync(raw)),
      chunk('IEND', Buffer.alloc(0))
    ])
  )
}

let root = ''
let src = ''

beforeAll(async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'lantai-pdf-'))
  src = path.join(root, 'src.pdf')
  const png = makePng(64, 64)
  const doc = await PDFDocument.create()
  const font = await doc.embedFont(StandardFonts.Helvetica)
  for (let i = 0; i < 2; i++) {
    const page = doc.addPage([600, 800])
    page.drawRectangle({ x: 40, y: 40, width: 200, height: 120, color: rgb(0.2, 0.4, 0.8) })
    page.drawText('page ' + (i + 1), { x: 60, y: 300, size: 18, font })
    const img = await doc.embedPng(png)
    page.drawImage(img, { x: 300, y: 500, width: 200, height: 200 })
  }
  fs.writeFileSync(src, await doc.save())
})

describe('PDF 进阶功能冒烟', () => {
  it('元数据读取 / 写入 / 匿名化', async () => {
    const meta = await readPdfMeta({ path: src })
    expect(meta.pageCount).toBe(2)
    expect(meta.sizeBytes).toBeGreaterThan(0)

    const w = await writePdfMeta({
      paths: [src],
      outDir: root,
      title: '标题甲',
      author: '作者乙',
      subject: '主题丙',
      keywords: 'aa,bb',
      clear: false
    })
    const after = await readPdfMeta({ path: w.outputs[0] })
    expect(after.title).toBe('标题甲')
    expect(after.author).toBe('作者乙')
    // pdf-lib 写关键词收数组、读回是无分隔符拼接，只需确认两个词都在
    expect(after.keywords).toContain('aa')
    expect(after.keywords).toContain('bb')

    const anon = await writePdfMeta({
      paths: [src],
      outDir: root,
      title: '',
      author: '',
      subject: '',
      keywords: '',
      clear: true
    })
    const cleared = await readPdfMeta({ path: anon.outputs[0] })
    expect(cleared.title).toBe('')
    expect(cleared.author).toBe('')
  })

  it('页面尺寸调整到 A4 纵向', async () => {
    const r = await resizePdfPages({
      paths: [src],
      outDir: root,
      preset: 'a4',
      keepRatio: true,
      background: '#ffffff',
      orientation: 'portrait'
    })
    const doc = await PDFDocument.load(fs.readFileSync(r.outputs[0]))
    expect(doc.getPageCount()).toBe(2)
    const size = doc.getPage(0).getSize()
    expect(Math.round(size.width)).toBe(595)
    expect(Math.round(size.height)).toBe(842)
  })

  it('页眉页脚（含占位符）', async () => {
    const r = await addHeaderFooter({
      paths: [src],
      outDir: root,
      header: 'TOP',
      footer: 'page {页码}/{总页数}',
      fontSize: 10,
      align: 'center',
      margin: 24,
      fromPage: 1
    })
    const doc = await PDFDocument.load(fs.readFileSync(r.outputs[0]))
    expect(doc.getPageCount()).toBe(2)
  })

  it('提取内嵌图片（Flate→PNG 往返）', async () => {
    const r = await extractPdfImages({ path: src, outDir: root, minSize: 8 })
    expect(r.pages).toBe(2)
    expect(r.count).toBeGreaterThanOrEqual(1)
    expect(fs.existsSync(r.outputs[0])).toBe(true)
    expect(fs.statSync(r.outputs[0]).size).toBeGreaterThan(0)
  })

  it('页眉页脚：中文文件名不会导致编码失败', async () => {
    // 文件名含中文 + 页脚用 {文件名} 占位符：必须走中文字体，否则 Helvetica 无法编码
    const cnPath = path.join(path.dirname(src), '中文报告.pdf')
    fs.copyFileSync(src, cnPath)
    const r = await addHeaderFooter({
      paths: [cnPath],
      outDir: path.dirname(src),
      header: '',
      footer: '{文件名} 第 {页码} 页',
      fontSize: 9,
      align: 'center',
      margin: 24,
      fromPage: 1
    })
    const doc = await PDFDocument.load(fs.readFileSync(r.outputs[0]))
    expect(doc.getPageCount()).toBe(2)
  })

  it('图片转 PDF：默认等比适配 A4', async () => {
    const png = makePng(1200, 2400) // 竖向高分辨率图，模拟手机照片
    const imgPath = path.join(path.dirname(src), 'photo.png')
    fs.writeFileSync(imgPath, png)
    const r = await saveImageToPdf(imgPath)
    const doc = await PDFDocument.load(fs.readFileSync(r.outputs[0]))
    const size = doc.getPage(0).getSize()
    expect(Math.round(size.width)).toBe(595)
    expect(Math.round(size.height)).toBe(842)
  })

  it('批量：多个文件加页码', async () => {
    const r = await batchPdf({
      paths: [src, src],
      outDir: root,
      action: 'numbers',
      startAt: 1,
      position: 'bottom-center',
      fromPage: 1
    })
    expect(r.outputs.length).toBe(2)
    expect(r.failed.length).toBe(0)
  })
})
