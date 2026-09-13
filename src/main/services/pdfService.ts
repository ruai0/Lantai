import fs from 'node:fs'
import path from 'node:path'
import fontkit from '@pdf-lib/fontkit'
import { PDFDocument, StandardFonts, degrees, rgb } from 'pdf-lib'
import { findCjkFont } from './cjkFont'
import type {
  PdfDeletePagesParams,
  PdfImagesParams,
  PdfMergeParams,
  PdfPageNumberParams,
  PdfResult,
  PdfRotateParams,
  PdfSplitParams,
  PdfStampParams,
  PdfWatermarkParams,
  WatermarkColor
} from '@shared/types'
import { parseRanges } from './rangeUtils'
import { stemOf, uniquePath } from './fileUtils'
import { TaskCancelledError } from './taskProgress'

async function loadPdf(filePath: string): Promise<PDFDocument> {
  const bytes = await fs.promises.readFile(filePath)
  const doc = await PDFDocument.load(bytes, { ignoreEncryption: true })
  if (doc.isEncrypted) throw new Error('该 PDF 已加密，请先解密后再处理')
  return doc
}

function stamp(): string {
  const d = new Date()
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`
}

/**
 * pdf-lib 的 JpegEmbedder/PngEmbedder 用 `new DataView(buf.buffer)` 从 0 开始读魔数，
 * 而 Node 的 Buffer 小于 4KB 时落在共享内存池里（byteOffset ≠ 0），
 * 于是合法的小 JPEG/PNG 会报「SOI not found in JPEG」。统一拷贝成独立 Uint8Array 再嵌入。
 */
function standalone(data: Buffer | Uint8Array): Uint8Array {
  return new Uint8Array(data)
}

async function save(doc: PDFDocument, outDir: string, filename: string): Promise<string> {
  const bytes = await doc.save()
  const out = uniquePath(outDir, filename)
  await fs.promises.writeFile(out, bytes)
  return out
}

export async function mergePdfs(
  params: PdfMergeParams,
  onProgress?: (done: number, total: number) => void,
  isCancelled?: () => boolean
): Promise<PdfResult> {
  if (params.paths.length < 2) throw new Error('合并至少需要选择两个 PDF 文件')
  const merged = await PDFDocument.create()
  let done = 0
  for (const p of params.paths) {
    if (isCancelled?.()) throw new TaskCancelledError()
    const src = await loadPdf(p)
    const pages = await merged.copyPages(src, src.getPageIndices())
    pages.forEach(pg => merged.addPage(pg))
    onProgress?.(++done, params.paths.length)
  }
  const out = await save(merged, params.outDir, `PDF合并_${stamp()}.pdf`)
  return { outputs: [out] }
}

export async function splitPdf(params: PdfSplitParams): Promise<PdfResult> {
  const src = await loadPdf(params.path)
  const total = src.getPageCount()
  const base = stemOf(params.path)
  const outputs: string[] = []

  if (params.mode === 'extract') {
    const indices = parseRanges(params.ranges ?? '', total)
    const doc = await PDFDocument.create()
    const pages = await doc.copyPages(src, indices)
    pages.forEach(pg => doc.addPage(pg))
    outputs.push(await save(doc, params.outDir, `${base}_提取页.pdf`))
  } else if (params.mode === 'each') {
    for (let i = 0; i < total; i++) {
      const doc = await PDFDocument.create()
      const [pg] = await doc.copyPages(src, [i])
      doc.addPage(pg)
      outputs.push(await save(doc, params.outDir, `${base}_第${i + 1}页.pdf`))
    }
  } else {
    const n = params.everyN ?? 1
    if (!Number.isInteger(n) || n < 1) throw new Error('每份页数必须是正整数')
    for (let start = 0; start < total; start += n) {
      const end = Math.min(start + n - 1, total - 1)
      const doc = await PDFDocument.create()
      const indices: number[] = []
      for (let i = start; i <= end; i++) indices.push(i)
      const pages = await doc.copyPages(src, indices)
      pages.forEach(pg => doc.addPage(pg))
      outputs.push(await save(doc, params.outDir, `${base}_第${start + 1}-${end + 1}页.pdf`))
    }
  }
  return { outputs }
}

export async function rotatePdf(params: PdfRotateParams): Promise<PdfResult> {
  const doc = await loadPdf(params.path)
  const total = doc.getPageCount()
  const indices =
    params.ranges && params.ranges.trim() ? parseRanges(params.ranges, total) : doc.getPageIndices()
  for (const i of indices) {
    const page = doc.getPage(i)
    page.setRotation(degrees((page.getRotation().angle + params.angle) % 360))
  }
  const out = await save(doc, params.outDir, `${stemOf(params.path)}_旋转${params.angle}度.pdf`)
  return { outputs: [out] }
}

export async function addPageNumbers(params: PdfPageNumberParams): Promise<PdfResult> {
  const doc = await loadPdf(params.path)
  const total = doc.getPageCount()
  const from = Math.max(1, params.fromPage ?? 1)
  if (from > total) throw new Error(`起始页 ${from} 超出范围（文档共 ${total} 页）`)
  const font = await doc.embedFont(StandardFonts.Helvetica)
  const size = 9
  const color = rgb(0.35, 0.35, 0.35)
  const count = total - from + 1
  const lastNo = params.startAt + count - 1
  const pages = doc.getPages()
  let n = params.startAt
  for (let i = from - 1; i < total; i++) {
    const page = pages[i]
    const text = `${n} / ${lastNo}`
    n++
    const tw = font.widthOfTextAtSize(text, size)
    const { width, height } = page.getSize()
    let x = width / 2 - tw / 2
    let y = 20
    if (params.position === 'bottom-right') {
      x = width - tw - 24
      y = 20
    } else if (params.position === 'top-right') {
      x = width - tw - 24
      y = height - 28
    }
    page.drawText(text, { x, y, size, font, color })
  }
  const out = await save(doc, params.outDir, `${stemOf(params.path)}_页码.pdf`)
  return { outputs: [out] }
}

/* ---------- 图片合成 PDF ---------- */

const IMAGE_TYPES: Record<string, 'jpg' | 'png'> = {
  '.jpg': 'jpg',
  '.jpeg': 'jpg',
  '.png': 'png'
}

export async function imagesToPdf(params: PdfImagesParams): Promise<PdfResult> {
  if (params.paths.length === 0) throw new Error('请先选择图片')
  const doc = await PDFDocument.create()
  for (const p of params.paths) {
    const kind = IMAGE_TYPES[path.extname(p).toLowerCase()]
    if (!kind) throw new Error(`暂只支持 JPG / PNG 图片（不支持：${path.basename(p)}）`)
    const bytes = await fs.promises.readFile(p)
    const img = kind === 'jpg' ? await doc.embedJpg(standalone(bytes)) : await doc.embedPng(standalone(bytes))
    const page = doc.addPage([img.width, img.height])
    page.drawImage(img, { x: 0, y: 0, width: img.width, height: img.height })
  }
  const out = await save(doc, params.outDir, `图片合成_${stamp()}.pdf`)
  return { outputs: [out] }
}

/* ---------- 文字水印 ---------- */

/** 系统里可用的中文字体（按优先级）；全部缺失时回退西文字体（仅支持英文水印）。跨平台定位见 cjkFont.ts */
function loadCjkFont(): Buffer | null {
  const p = findCjkFont()
  if (!p) return null
  try {
    return fs.readFileSync(p)
  } catch {
    return null
  }
}

const WATERMARK_COLORS: Record<WatermarkColor, ReturnType<typeof rgb>> = {
  gray: rgb(0.55, 0.55, 0.55),
  red: rgb(0.82, 0.12, 0.12),
  blue: rgb(0.12, 0.32, 0.75)
}

export async function watermarkPdf(params: PdfWatermarkParams): Promise<PdfResult> {
  const text = params.text.trim()
  if (!text) throw new Error('请填写水印文字')
  const doc = await loadPdf(params.path)
  let font
  if (/[\u4e00-\u9fff]/.test(text)) {
    const fontBytes = loadCjkFont()
    if (!fontBytes) throw new Error('系统中未找到可用中文字体（Windows 需 simhei 等；Linux/麒麟 需 Noto/文泉驿等），中文水印不可用')
    doc.registerFontkit(fontkit)
    font = await doc.embedFont(fontBytes, { subset: true })
  } else {
    font = await doc.embedFont(StandardFonts.HelveticaBold)
  }
  const opacity = Math.min(1, Math.max(0.05, params.opacity))
  const color = WATERMARK_COLORS[params.color] ?? WATERMARK_COLORS.gray
  const size = params.fontSize
  const tw = font.widthOfTextAtSize(text, size)
  const th = size
  const rot = degrees(params.rotation)
  for (const page of doc.getPages()) {
    const { width, height } = page.getSize()
    if (params.tile) {
      const gapX = tw + size * 1.5
      const gapY = th + size * 3
      const cols = Math.ceil(width / gapX) + 1
      const rows = Math.ceil(height / gapY) + 1
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          page.drawText(text, {
            x: c * gapX,
            y: r * gapY - th,
            size,
            font,
            color,
            opacity,
            rotate: rot
          })
        }
      }
    } else {
      page.drawText(text, {
        x: Math.max(0, width / 2 - tw / 2),
        y: height / 2 - th / 2,
        size,
        font,
        color,
        opacity,
        rotate: rot
      })
    }
  }
  const out = await save(doc, params.outDir, `${stemOf(params.path)}_水印.pdf`)
  return { outputs: [out] }
}

/* ---------- 图片盖章 / 图片水印 ---------- */

export async function stampImage(params: PdfStampParams): Promise<PdfResult> {
  const ext = path.extname(params.imagePath).toLowerCase()
  if (ext !== '.png' && ext !== '.jpg' && ext !== '.jpeg') {
    throw new Error('盖章图片仅支持 PNG / JPG')
  }
  const doc = await loadPdf(params.path)
  const imgBytes = standalone(await fs.promises.readFile(params.imagePath))
  const img = ext === '.png' ? await doc.embedPng(imgBytes) : await doc.embedJpg(imgBytes)
  const opacity = Math.min(1, Math.max(0.1, params.opacity))
  const scale = Math.min(100, Math.max(2, params.scalePercent)) / 100
  const total = doc.getPageCount()
  const indices =
    params.ranges && params.ranges.trim() ? parseRanges(params.ranges, total) : doc.getPageIndices()
  const margin = 6
  for (const i of indices) {
    const page = doc.getPage(i)
    const { width, height } = page.getSize()
    const w = width * scale
    const h = (img.height / img.width) * w
    let x = width / 2 - w / 2
    let y = height / 2 - h / 2
    if (params.position === 'top-right') {
      x = width - w - margin
      y = height - h - margin
    } else if (params.position === 'top-left') {
      x = margin
      y = height - h - margin
    } else if (params.position === 'bottom-right') {
      x = width - w - margin
      y = margin
    } else if (params.position === 'bottom-left') {
      x = margin
      y = margin
    }
    page.drawImage(img, { x, y, width: w, height: h, opacity })
  }
  const out = await save(doc, params.outDir, `${stemOf(params.path)}_盖章.pdf`)
  return { outputs: [out] }
}

/* ---------- 删除指定页 ---------- */

export async function deletePdfPages(params: PdfDeletePagesParams): Promise<PdfResult> {
  const src = await loadPdf(params.path)
  const total = src.getPageCount()
  const delSet = new Set(parseRanges(params.ranges, total))
  if (delSet.size === 0) throw new Error('请填写要删除的页码，如 1-3,5')
  if (delSet.size >= total) throw new Error('不能删除全部页面')
  const keep = src.getPageIndices().filter(i => !delSet.has(i))
  const doc = await PDFDocument.create()
  const pages = await doc.copyPages(src, keep)
  pages.forEach(pg => doc.addPage(pg))
  const out = await save(doc, params.outDir, `${stemOf(params.path)}_删${delSet.size}页.pdf`)
  return { outputs: [out] }
}

/* ---------- 页面整理 / 信息 ---------- */

export async function pagesInfo(
  params: import('@shared/types').PdfPagesInfoParams
): Promise<import('@shared/types').PdfPagesInfoResult> {
  const pages: Array<{ path: string; count: number }> = []
  for (const p of params.paths) {
    const doc = await loadPdf(p)
    pages.push({ path: p, count: doc.getPageCount() })
  }
  return { pages }
}

/** 按给定的跨文件页顺序重排为一个新 PDF */
export async function organizePdf(
  params: import('@shared/types').PdfOrganizeParams
): Promise<PdfResult> {
  if (params.paths.length === 0) throw new Error('请先选择 PDF 文件')
  if (params.order.length === 0) throw new Error('没有任何页面可输出')
  const srcs: PDFDocument[] = []
  for (const p of params.paths) srcs.push(await loadPdf(p))
  const doc = await PDFDocument.create()
  for (const entry of params.order) {
    const src = srcs[entry.source]
    if (!src) throw new Error(`页序里引用了不存在的文件 #${entry.source}`)
    if (entry.page < 0 || entry.page >= src.getPageCount()) {
      throw new Error(`第 ${entry.page + 1} 页超出文件 #${entry.source} 的范围（共 ${src.getPageCount()} 页）`)
    }
    const [pg] = await doc.copyPages(src, [entry.page])
    doc.addPage(pg)
  }
  const out = await save(doc, params.outDir, `页面整理_${stamp()}.pdf`)
  return { outputs: [out] }
}

/* ---------- 由图片字节重建 PDF（PDF 压缩链路） ---------- */

export async function buildFromImages(params: import('@shared/types').PdfBuildParams): Promise<PdfResult> {
  if (params.imagesBase64.length === 0) throw new Error('没有可写入的页面')
  const doc = await PDFDocument.create()
  for (const b64 of params.imagesBase64) {
    const bytes = standalone(Buffer.from(b64, 'base64'))
    // 依据 magic 判断 png / jpeg
    const isPng = bytes[0] === 0x89 && bytes[1] === 0x50
    const img = isPng ? await doc.embedPng(bytes) : await doc.embedJpg(bytes)
    const page = doc.addPage([img.width, img.height])
    page.drawImage(img, { x: 0, y: 0, width: img.width, height: img.height })
  }
  const base = params.nameHint?.trim() || 'PDF压缩'
  const out = await save(doc, params.outDir, `${base}_${stamp()}.pdf`)
  return { outputs: [out] }
}
