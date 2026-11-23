import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import zlib from 'node:zlib'
import fontkit from '@pdf-lib/fontkit'
import {
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFName,
  PDFNumber,
  PDFRawStream,
  PDFRef,
  StandardFonts,
  degrees,
  rgb
} from 'pdf-lib'
import { LineCapStyle } from 'pdf-lib'
import type { PDFContext, PDFImage, PDFPage } from 'pdf-lib'
import { findCjkFont } from './cjkFont'
import type {
  PdfBatchParams,
  PdfBatchResult,
  PdfDeletePagesParams,
  PdfExtractImagesParams,
  PdfExtractImagesResult,
  PdfHeaderFooterParams,
  PdfImagesParams,
  PdfMergeParams,
  PdfMetaInfo,
  PdfPageAnno,
  PdfPageNumberParams,
  PdfReadMetaParams,
  PdfResizeParams,
  PdfResult,
  PdfRotateParams,
  PdfSplitParams,
  PdfStampParams,
  PdfWatermarkParams,
  PdfWriteMetaParams,
  WatermarkColor
} from '@shared/types'
import { parseRanges } from '@shared/pageRanges'
import { hexToRgb01, svgPolylinePath } from '@shared/pdfAnno'
import { stemOf, uniquePath, exportFilename } from './fileUtils'
import { decryptStandard, PdfDecryptError } from './pdfDecrypt'
import { TaskCancelledError } from './taskProgress'

async function loadPdf(filePath: string): Promise<PDFDocument> {
  const bytes = await fs.promises.readFile(filePath)
  let doc: PDFDocument
  try {
    doc = await PDFDocument.load(bytes, { ignoreEncryption: true })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    throw new Error(`无法解析该 PDF：${msg}`)
  }
  // 带权限密码（无打开密码）的 PDF 就地解密，后续拷贝/导出走未加密路径
  if (doc.isEncrypted) {
    try {
      decryptStandard(doc)
    } catch (e) {
      if (e instanceof PdfDecryptError) throw new Error(e.message)
      const msg = e instanceof Error ? e.message : String(e)
      throw new Error(`解密该 PDF 失败：${msg}`)
    }
  }
  return doc
}

/** 逐个检查 PDF 是否加密（供工作台导入时提前提示，不实际解密） */
export async function checkPdfEncrypted(params: {
  paths: string[]
}): Promise<{ items: Array<{ path: string; encrypted: boolean }> }> {
  const items: Array<{ path: string; encrypted: boolean }> = []
  for (const p of params.paths) {
    try {
      const bytes = await fs.promises.readFile(p)
      const doc = await PDFDocument.load(bytes, { ignoreEncryption: true })
      items.push({ path: p, encrypted: doc.isEncrypted })
    } catch {
      // 读不了/解析不了的文件交给后续真正处理时报错
      items.push({ path: p, encrypted: false })
    }
  }
  return { items }
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
  const out = await save(merged, params.outDir, exportFilename(params.name, '.pdf', `PDF合并_${stamp()}`))
  return { outputs: [out] }
}

/**
 * 拆分 PDF。按页拆时 48 页就是 48 个文件，可能跑十几秒，
 * 所以要能看进度、能中途停（已拆出的文件保留）。
 */
export async function splitPdf(
  params: PdfSplitParams,
  onProgress?: (done: number, total: number) => void,
  isCancelled?: () => boolean
): Promise<PdfResult> {
  const src = await loadPdf(params.path)
  const total = src.getPageCount()
  const base = stemOf(params.path)
  const outputs: string[] = []

  if (params.mode === 'extract') {
    const indices = parseRanges(params.ranges ?? '', total)
    const doc = await PDFDocument.create()
    const pages = await doc.copyPages(src, indices)
    pages.forEach(pg => doc.addPage(pg))
    // 覆盖模式：抽出的页替换原文件（原文件先备份为 .bak，避免误操作丢原件）
    if (params.overwrite) {
      const target = await backupAndOverwrite(params.path, await doc.save())
      outputs.push(target)
    } else {
      outputs.push(await save(doc, params.outDir, `${base}_提取页.pdf`))
    }
  } else if (params.mode === 'each') {
    for (let i = 0; i < total; i++) {
      if (isCancelled?.()) throw new TaskCancelledError()
      const doc = await PDFDocument.create()
      const [pg] = await doc.copyPages(src, [i])
      doc.addPage(pg)
      outputs.push(await save(doc, params.outDir, `${base}_第${i + 1}页.pdf`))
      onProgress?.(i + 1, total)
    }
  } else {
    const n = params.everyN ?? 1
    if (!Number.isInteger(n) || n < 1) throw new Error('每份页数必须是正整数')
    for (let start = 0; start < total; start += n) {
      if (isCancelled?.()) throw new TaskCancelledError()
      const end = Math.min(start + n - 1, total - 1)
      const doc = await PDFDocument.create()
      const indices: number[] = []
      for (let i = start; i <= end; i++) indices.push(i)
      const pages = await doc.copyPages(src, indices)
      pages.forEach(pg => doc.addPage(pg))
      outputs.push(await save(doc, params.outDir, `${base}_第${start + 1}-${end + 1}页.pdf`))
      onProgress?.(Math.min(start + n, total), total)
    }
  }
  return { outputs }
}

/** 把新内容写回原路径，原文件先另存为同名 .bak（已存在则加时间戳），实现「原地覆盖」又不丢原件 */
async function backupAndOverwrite(originalPath: string, bytes: Uint8Array): Promise<string> {
  const dir = path.dirname(originalPath)
  const base = path.basename(originalPath)
  const bak = path.join(dir, `${base}.bak`)
  await fs.promises.copyFile(originalPath, bak)
  await fs.promises.writeFile(originalPath, bytes)
  return originalPath
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
  const size = params.fontSize ?? 9
  const color = params.color ? rgbFromHex(params.color) : rgb(0.35, 0.35, 0.35)
  const format = params.format ?? '{n} / {total}'
  const count = total - from + 1
  const lastNo = params.startAt + count - 1
  const margin = params.margin ?? 20
  const pages = doc.getPages()
  let n = params.startAt
  for (let i = from - 1; i < total; i++) {
    const page = pages[i]
    const text = format
      .replace(/\{n\}/g, String(n))
      .replace(/\{total\}/g, String(lastNo))
      .replace(/\{页码\}/g, String(n))
      .replace(/\{总页数\}/g, String(lastNo))
    n++
    const tw = font.widthOfTextAtSize(text, size)
    const { width, height } = page.getSize()
    let x = width / 2 - tw / 2
    let y = margin
    if (params.position === 'bottom-right') {
      x = width - tw - margin - 4
      y = margin
    } else if (params.position === 'bottom-left') {
      x = margin
      y = margin
    } else if (params.position === 'top-right') {
      x = width - tw - margin - 4
      y = height - margin - size
    } else if (params.position === 'top-center' || params.position === 'top-left') {
      x = params.position === 'top-left' ? margin : width / 2 - tw / 2
      y = height - margin - size
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

/**
 * 多张图片合成一个 PDF。几十张高清图逐张解码嵌入会明显变慢，
 * 给进度与中断，避免界面像卡死。
 */
export async function imagesToPdf(
  params: PdfImagesParams,
  onProgress?: (done: number, total: number) => void,
  isCancelled?: () => boolean
): Promise<PdfResult> {
  if (params.paths.length === 0) throw new Error('请先选择图片')
  const doc = await PDFDocument.create()
  const fit = params.fit ?? 'a4'
  const A4 = { w: 595.28, h: 841.89 }
  const total = params.paths.length
  for (let i = 0; i < total; i++) {
    if (isCancelled?.()) throw new TaskCancelledError()
    const p = params.paths[i]
    const kind = IMAGE_TYPES[path.extname(p).toLowerCase()]
    if (!kind) throw new Error(`暂只支持 JPG / PNG 图片（不支持：${path.basename(p)}）`)
    const bytes = await fs.promises.readFile(p)
    const img = kind === 'jpg' ? await doc.embedJpg(standalone(bytes)) : await doc.embedPng(standalone(bytes))
    if (fit === 'none') {
      // 1 像素 = 1pt：大图会得到上米级的页面，仅在需要保留原始像素尺寸时使用
      const page = doc.addPage([img.width, img.height])
      page.drawImage(img, { x: 0, y: 0, width: img.width, height: img.height })
    } else {
      // 等比缩放居中到 A4，横图自动用横向页面，四周留白
      const portrait = img.height >= img.width
      const pw = portrait ? A4.w : A4.h
      const ph = portrait ? A4.h : A4.w
      const s = Math.min(pw / img.width, ph / img.height)
      const dw = img.width * s
      const dh = img.height * s
      const page = doc.addPage([pw, ph])
      page.drawImage(img, { x: (pw - dw) / 2, y: (ph - dh) / 2, width: dw, height: dh })
    }
    onProgress?.(i + 1, total)
  }
  const out = await save(doc, params.outDir, exportFilename(params.name, '.pdf', `图片转PDF_${stamp()}`))
  return { outputs: [out] }
}

/* ---------- 文字水印 ---------- */

/** 系统里可用的中文字体（按优先级）；全部缺失时回退西文字体（仅支持英文水印）。跨平台定位见 cjkFont.ts */
/** 字体文件动辄十几 MB，批量处理时每个文件都读一遍会明显拖慢，这里缓存一份 */
let cachedCjkFont: Buffer | null = null
function loadCjkFont(): Buffer | null {
  if (cachedCjkFont) return cachedCjkFont
  const p = findCjkFont()
  if (!p) return null
  try {
    cachedCjkFont = fs.readFileSync(p)
    return cachedCjkFont
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
/** 把渲染视图的分数裁剪区域换算成 CropBox（纯函数，便于单测）。
 *  mediaBox：{x,y,width,height}；crop：渲染视图分数坐标（y 自顶向下）。
 *  返回 {x,y,width,height}，供 setCropBox 使用。 */
export function cropBoxFromFractions(
  mediaBox: { x: number; y: number; width: number; height: number },
  crop: { x: number; y: number; w: number; h: number }
): { x: number; y: number; width: number; height: number } {
  const x0 = mediaBox.x + crop.x * mediaBox.width
  const x1 = mediaBox.x + (crop.x + crop.w) * mediaBox.width
  // 渲染视图 y 自顶向下，PDF 坐标自底向上，先镜像
  const topY = mediaBox.y + mediaBox.height - crop.y * mediaBox.height
  const bottomY = mediaBox.y + mediaBox.height - (crop.y + crop.h) * mediaBox.height
  // 夹紧到页面范围内，避免非法框把整页裁没
  const left = Math.max(mediaBox.x, Math.min(x0, x1))
  const right = Math.min(mediaBox.x + mediaBox.width, Math.max(x0, x1))
  const bottom = Math.max(mediaBox.y, Math.min(topY, bottomY))
  const top = Math.min(mediaBox.y + mediaBox.height, Math.max(topY, bottomY))
  return { x: left, y: bottom, width: right - left, height: top - bottom }
}

/** 把渲染视图的分数裁剪区域换算成页面坐标并设置 CropBox（裁掉白边/页眉页脚/不要的部分）
 *  只处理无旋转页：旋转后视图与页面坐标系不一致，UI 已限制这种情况不能裁。
 *  用 CropBox 而非 MediaBox：裁下来的内容只是不再显示，不破坏原有内容流与坐标系。 */
function applyCrop(pg: import('pdf-lib').PDFPage, crop: { x: number; y: number; w: number; h: number }): void {
  if (pg.getRotation().angle !== 0) return
  const mb = pg.getMediaBox()
  const box = cropBoxFromFractions(mb, crop)
  if (box.width < 1 || box.height < 1) return
  pg.setCropBox(box.x, box.y, box.width, box.height)
}

/** 矩形坐标是否可用（防 NaN/Infinity 把内容流写坏） */
function usableRect(x: number, y: number, w: number, h: number): boolean {
  return [x, y, w, h].every(Number.isFinite) && w > 0 && h > 0
}

/**
 * 把大图预览里画好的标注烧进页面：马赛克=平均色矩形、涂抹=圆头折线、贴图=PNG 覆盖。
 * 坐标是渲染时就地换算好的 PDF 用户空间磅值，旋转页同样准确（随页面内容一起旋转）。
 * 全部画在原有内容之上：不重排、不整页栅格化，文字层与文本搜索不受影响。
 * 同一张贴图重复使用只嵌入一次。
 */
async function applyPageAnnos(
  pg: PDFPage,
  doc: PDFDocument,
  annos: PdfPageAnno[] | undefined
): Promise<void> {
  if (!annos || annos.length === 0) return
  const embedded = new Map<string, PDFImage>()
  for (const a of annos) {
    if (a.kind === 'mosaic') {
      if (!usableRect(a.x, a.y, a.w, a.h)) continue
      pg.drawRectangle({
        x: a.x,
        y: a.y,
        width: a.w,
        height: a.h,
        color: rgb(a.color[0], a.color[1], a.color[2])
      })
    } else if (a.kind === 'brush') {
      const d = svgPolylinePath(a.points)
      if (!d || !(a.width > 0)) continue
      const [cr, cg, cb] = hexToRgb01(a.color)
      // 圆头笔帽 + 渲染端密集采样，导出笔画与画布上看到的连续涂抹一致
      pg.drawSvgPath(d, {
        borderColor: rgb(cr, cg, cb),
        borderWidth: a.width,
        borderOpacity: 1,
        borderLineCap: LineCapStyle.Round
      })
    } else {
      if (!a.png.startsWith('data:image/png') || !usableRect(a.x, a.y, a.w, a.h)) continue
      let img = embedded.get(a.png)
      if (!img) {
        const b64 = a.png.slice(a.png.indexOf(',') + 1)
        img = await doc.embedPng(Buffer.from(b64, 'base64'))
        embedded.set(a.png, img)
      }
      pg.drawImage(img, {
        x: a.x,
        y: a.y,
        width: a.w,
        height: a.h,
        opacity: Math.min(1, Math.max(0.05, a.opacity))
      })
    }
  }
}

export async function organizePdf(
  params: import('@shared/types').PdfOrganizeParams
): Promise<PdfResult> {
  if (!params.outDir) throw new Error('请先选择输出文件夹')
  const doc = await buildOrganizedDoc(params)
  const out = await save(doc, params.outDir, exportFilename(params.name, '.pdf', `页面整理_${stamp()}`))
  return { outputs: [out] }
}

/** 按页序 + 旋转 + 裁剪 + 标注构建成品文档（导出与预估共用，保证两者口径一致） */
async function buildOrganizedDoc(params: import('@shared/types').PdfOrganizeParams): Promise<PDFDocument> {
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
    if (entry.rotate) {
      pg.setRotation(degrees((pg.getRotation().angle + entry.rotate) % 360))
    }
    if (entry.crop) applyCrop(pg, entry.crop)
    await applyPageAnnos(pg, doc, entry.annos)
    doc.addPage(pg)
  }
  return doc
}

/**
 * 只预估不落盘：按同一套构建逻辑生成字节，返回大小。
 * 用户在点导出前就该知道"这一份多大"，别等写完盘才发现几十兆发不出去。
 */
export async function estimateOrganizedSize(
  params: import('@shared/types').PdfOrganizeParams
): Promise<{ bytes: number; pages: number }> {
  const doc = await buildOrganizedDoc(params)
  const bytes = await doc.save()
  return { bytes: bytes.byteLength, pages: doc.getPageCount() }
}

/**
 * 生成压缩用的中间 PDF（含旋转/裁剪/标注），写到系统临时目录。
 * 压缩必须在渲染进程栅格化（要 canvas），而栅格化不认识裁剪框和标注，
 * 所以先把它们烧进一个中间 PDF，再逐页转 JPEG 重建——这样压缩后标注和裁剪都还在。
 */
export async function organizeToTemp(
  params: import('@shared/types').PdfOrganizeParams
): Promise<{ path: string }> {
  const doc = await buildOrganizedDoc(params)
  const bytes = await doc.save()
  const dir = path.join(os.tmpdir(), 'lantai-compress')
  await fs.promises.mkdir(dir, { recursive: true })
  const out = path.join(dir, `prep-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.pdf`)
  await fs.promises.writeFile(out, bytes)
  return { path: out }
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

/* ---------- 通用小工具 ---------- */

function rgbFromHex(hex: string): ReturnType<typeof rgb> {
  const v = hex.replace('#', '')
  const full = v.length === 3 ? v.split('').map(c => c + c).join('') : v
  const n = parseInt(full, 16)
  if (Number.isNaN(n)) throw new Error(`颜色格式不正确：${hex}`)
  return rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255)
}

/** 按对齐方式算文字起点 x（pt 坐标系，margin 为左右安全边距） */
function alignX(align: 'left' | 'center' | 'right', textW: number, pageW: number, margin: number): number {
  if (align === 'left') return margin
  if (align === 'right') return Math.max(margin, pageW - textW - margin)
  return Math.max(margin, (pageW - textW) / 2)
}

/* ---------- 元数据读取 / 写入（含匿名化） ---------- */

export async function readPdfMeta(params: PdfReadMetaParams): Promise<PdfMetaInfo> {
  const bytes = await fs.promises.readFile(params.path)
  // 读元数据允许加密文档：PDF 的 Info 字典通常不加密封面信息
  const doc = await PDFDocument.load(bytes, { ignoreEncryption: true })
  const fmt = (d?: Date) => (d ? d.toISOString().replace('T', ' ').slice(0, 19) : '')
  return {
    path: params.path,
    name: path.basename(params.path),
    pageCount: doc.getPageCount(),
    sizeBytes: bytes.length,
    title: doc.getTitle() ?? '',
    author: doc.getAuthor() ?? '',
    subject: doc.getSubject() ?? '',
    keywords: doc.getKeywords() ?? '',
    creator: doc.getCreator() ?? '',
    producer: doc.getProducer() ?? '',
    creationDate: fmt(doc.getCreationDate()),
    modificationDate: fmt(doc.getModificationDate())
  }
}

export async function writePdfMeta(params: PdfWriteMetaParams): Promise<PdfResult> {
  if (params.paths.length === 0) throw new Error('请先选择 PDF 文件')
  const suffix = params.clear ? '_匿名' : '_元数据'
  const outputs: string[] = []
  for (const p of params.paths) {
    const doc = await loadPdf(p)
    if (params.clear) {
      doc.setTitle('')
      doc.setAuthor('')
      doc.setSubject('')
      doc.setKeywords([])
      doc.setCreator('')
      doc.setProducer('')
      const epoch = new Date('2000-01-01T00:00:00Z')
      doc.setCreationDate(epoch)
      doc.setModificationDate(epoch)
      // 顺带摘掉 XMP 元数据流（含创建软件、UUID 等隐私字段）
      try {
        doc.catalog.delete(PDFName.of('Metadata'))
      } catch {
        /* 没有 XMP 元数据时忽略 */
      }
    } else {
      if (params.title.trim()) doc.setTitle(params.title.trim())
      if (params.author.trim()) doc.setAuthor(params.author.trim())
      if (params.subject.trim()) doc.setSubject(params.subject.trim())
      // pdf-lib 的 setKeywords 收数组（读取时才拼成字符串）；支持多种分隔符
      if (params.keywords.trim()) {
        doc.setKeywords(params.keywords.split(/[,，;；]\s*/).filter(Boolean))
      }
    }
    outputs.push(await save(doc, params.outDir, `${stemOf(p)}${suffix}.pdf`))
  }
  return { outputs }
}

/* ---------- 页面尺寸调整 ---------- */

/** 常用纸张尺寸（pt，1pt = 1/72 英寸，300dpi 打印换算见 UI 说明） */
const PAGE_SIZES: Record<string, { w: number; h: number }> = {
  a5: { w: 419.53, h: 595.28 },
  a4: { w: 595.28, h: 841.89 },
  a3: { w: 841.89, h: 1190.55 },
  letter: { w: 612, h: 792 }
}

function pageTarget(params: PdfResizeParams, sw: number, sh: number): { w: number; h: number } {
  if (params.preset === 'scale') {
    const s = params.scale && params.scale > 0 ? params.scale : 1
    return { w: Math.max(1, sw * s), h: Math.max(1, sh * s) }
  }
  if (params.preset === 'custom') {
    const w = Math.max(1, params.width ?? 0)
    const h = Math.max(1, params.height ?? 0)
    if (!w || !h) throw new Error('请填写目标页面尺寸')
    return { w, h }
  }
  const base = PAGE_SIZES[params.preset]
  if (!base) throw new Error('未知的目标页面尺寸')
  const orient = params.orientation ?? 'auto'
  const landscape = orient === 'landscape' || (orient === 'auto' && sh > sw)
  return landscape ? { w: base.h, h: base.w } : { w: base.w, h: base.h }
}

export async function resizePdfPages(params: PdfResizeParams): Promise<PdfResult> {
  if (params.paths.length === 0) throw new Error('请先选择 PDF 文件')
  const bg = params.background ? rgbFromHex(params.background) : rgb(1, 1, 1)
  const outputs: string[] = []
  for (const p of params.paths) {
    const src = await loadPdf(p)
    const out = await PDFDocument.create()
    for (const page of src.getPages()) {
      const { width: sw, height: sh } = page.getSize()
      const t = pageTarget(params, sw, sh)
      const s = params.keepRatio ? Math.min(t.w / sw, t.h / sh) : 1
      const dw = params.keepRatio ? Math.max(1, sw * s) : t.w
      const dh = params.keepRatio ? Math.max(1, sh * s) : t.h
      const embedded = await out.embedPage(page)
      const np = out.addPage([t.w, t.h])
      np.drawRectangle({ x: 0, y: 0, width: t.w, height: t.h, color: bg })
      np.drawPage(embedded, { x: (t.w - dw) / 2, y: (t.h - dh) / 2, width: dw, height: dh })
    }
    outputs.push(await save(out, params.outDir, `${stemOf(p)}_调整尺寸.pdf`))
  }
  return { outputs }
}

/* ---------- 页眉 / 页脚 ---------- */

export async function addHeaderFooter(params: PdfHeaderFooterParams): Promise<PdfResult> {
  if (params.paths.length === 0) throw new Error('请先选择 PDF 文件')
  if (!params.header.trim() && !params.footer.trim()) throw new Error('请填写页眉或页脚内容')
  const color = params.color ? rgbFromHex(params.color) : rgb(0.35, 0.35, 0.35)
  const size = params.fontSize
  const today = new Date().toISOString().slice(0, 10)
  const outputs: string[] = []
  for (const p of params.paths) {
    const doc = await loadPdf(p)
    const base = stemOf(p)
    // 占位符会把文件名填进正文，所以是否启用中文字体要看「替换后的实际内容」，
    // 否则中文文件名会用 Helvetica 绘制，触发 WinAnsi 编码错误或输出乱码
    const needCjk = /[\u4e00-\u9fff]/.test(`${params.header}${params.footer}${base}`)
    let font
    if (needCjk) {
      const fb = loadCjkFont()
      if (!fb) throw new Error('系统中未找到可用中文字体，中文页眉页脚不可用')
      doc.registerFontkit(fontkit)
      font = await doc.embedFont(fb, { subset: true })
    } else {
      font = await doc.embedFont(StandardFonts.Helvetica)
    }
    const total = doc.getPageCount()
    const from = Math.max(1, params.fromPage || 1)
    if (from > total) throw new Error(`起始页 ${from} 超出范围（文档共 ${total} 页）`)
    const fill = (s: string, no: number) =>
      s
        .replace(/\{页码\}/g, String(no))
        .replace(/\{总页数\}/g, String(total))
        .replace(/\{文件名\}/g, base)
        .replace(/\{日期\}/g, today)
    const pages = doc.getPages()
    for (let i = from - 1; i < total; i++) {
      const page = pages[i]
      const { width, height } = page.getSize()
      const no = i + 1
      if (params.header.trim()) {
        const t = fill(params.header, no)
        page.drawText(t, {
          x: alignX(params.align, font.widthOfTextAtSize(t, size), width, params.margin),
          y: height - params.margin - size,
          size,
          font,
          color
        })
      }
      if (params.footer.trim()) {
        const t = fill(params.footer, no)
        page.drawText(t, {
          x: alignX(params.align, font.widthOfTextAtSize(t, size), width, params.margin),
          y: params.margin,
          size,
          font,
          color
        })
      }
    }
    outputs.push(await save(doc, params.outDir, `${base}_页眉页脚.pdf`))
  }
  return { outputs }
}

/* ---------- 提取 PDF 内嵌图片 ---------- */

let crcTable: Int32Array | null = null
function crc32(buf: Buffer): number {
  if (!crcTable) {
    crcTable = new Int32Array(256)
    for (let n = 0; n < 256; n++) {
      let c = n
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
      crcTable[n] = c
    }
  }
  let c = ~0
  for (let i = 0; i < buf.length; i++) c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return ~c >>> 0
}
function pngChunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body))
  return Buffer.concat([len, body, crc])
}
/** 把已去预测的行像素打包成 PNG */
function encodePngImage(width: number, height: number, comps: 1 | 3, pixels: Buffer, stride: number): Buffer {
  const raw = Buffer.alloc((stride + 1) * height)
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0 // filter type: None
    pixels.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride)
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = comps === 3 ? 2 : 0 // color type: 2=RGB, 0=Gray
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', zlib.deflateSync(raw, { level: 6 })),
    pngChunk('IEND', Buffer.alloc(0))
  ])
}
/** 还原 PNG 预测（Predictor 10~15）：每行首字节为 filter type */
function undoPrediction(data: Buffer, height: number, stride: number, bpp: number): Buffer {
  const out = Buffer.alloc(height * stride)
  for (let y = 0; y < height; y++) {
    const head = y * (stride + 1)
    const ft = data[head]
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? out[y * stride + x - bpp] : 0
      const b = y > 0 ? out[(y - 1) * stride + x] : 0
      const c = x >= bpp && y > 0 ? out[(y - 1) * stride + x - bpp] : 0
      let v = data[head + 1 + x]
      if (ft === 1) v += a
      else if (ft === 2) v += b
      else if (ft === 3) v += (a + b) >> 1
      else if (ft === 4) {
        const pr0 = a + b - c
        const pa = Math.abs(pr0 - a)
        const pb = Math.abs(pr0 - b)
        const pc = Math.abs(pr0 - c)
        const pr = pa <= pb && pa <= pc ? a : pb <= pc ? b : c
        v += pr
      }
      out[y * stride + x] = v & 255
    }
  }
  return out
}

/** PDFName.asString() 返回带前导斜杠的形式（如 "/Image"），比较前统一剥掉 */
function nameStr(n: PDFName): string {
  return n.asString().replace(/^\//, '')
}

function filterNamesOf(stream: PDFRawStream): string[] {
  const f = stream.dict.lookup(PDFName.of('Filter'))
  const names: string[] = []
  if (f instanceof PDFName) names.push(nameStr(f))
  else if (f instanceof PDFArray) {
    for (const e of f.asArray()) if (e instanceof PDFName) names.push(nameStr(e))
  }
  return names
}

/** 返回每像素分量数：目前仅支持可靠还原的 DeviceRGB(3) / DeviceGray(1) / 等价 ICCBased */
function componentsOf(space: unknown, ctx: PDFContext): number | null {
  const resolved = space instanceof PDFRef ? ctx.lookup(space) : space
  if (resolved instanceof PDFName) {
    const n = nameStr(resolved)
    if (n === 'DeviceRGB' || n === 'RGB') return 3
    if (n === 'DeviceGray' || n === 'G') return 1
    return null
  }
  if (resolved instanceof PDFArray) {
    const head0 = resolved.get(0)
    const head = head0 instanceof PDFRef ? ctx.lookup(head0) : head0
    if (head instanceof PDFName && nameStr(head) === 'ICCBased') {
      const ref1 = resolved.get(1)
      const icc = ref1 instanceof PDFRef ? ctx.lookup(ref1) : ref1
      try {
        const n = (icc as PDFRawStream).dict.lookup(PDFName.of('N'))
        if (n instanceof PDFNumber) {
          const v = n.asNumber()
          if (v === 3) return 3
          if (v === 1) return 1
        }
      } catch {
        /* ICC 流结构异常时按不支持处理 */
      }
    }
  }
  return null
}

function predictorOf(stream: PDFRawStream, ctx: PDFContext): number {
  let dp = stream.dict.lookup(PDFName.of('DecodeParms'))
  if (!dp) dp = stream.dict.lookup(PDFName.of('DP'))
  const resolved = dp instanceof PDFRef ? ctx.lookup(dp) : dp
  let dict: PDFDict | undefined
  if (resolved instanceof PDFDict) dict = resolved
  else if (resolved instanceof PDFArray) {
    const first = resolved.get(0)
    const f = first instanceof PDFRef ? ctx.lookup(first) : first
    if (f instanceof PDFDict) dict = f
  }
  if (dict) {
    const p = dict.lookup(PDFName.of('Predictor'))
    if (p instanceof PDFNumber) return p.asNumber()
  }
  return 1
}

/**
 * 提取页面里的所有图片资源：DCTDecode 直接写 JPEG，FlateDecode 还原为 PNG。
 * 其余编码（JPXDecode / CCITTFax / Indexed 调色板等）无法可靠还原，计入 skipped。
 */
export async function extractPdfImages(params: PdfExtractImagesParams): Promise<PdfExtractImagesResult> {
  const bytes = await fs.promises.readFile(params.path)
  const doc = await PDFDocument.load(bytes, { ignoreEncryption: true })
  const ctx = doc.context
  const dir = uniquePath(params.outDir, `${stemOf(params.path)}_图片`)
  await fs.promises.mkdir(dir, { recursive: true })
  const seen = new Set<string>()
  const outputs: string[] = []
  let skipped = 0
  const minSize = params.minSize ?? 0
  try {
    const pages = doc.getPages()
    for (let pi = 0; pi < pages.length; pi++) {
      const resources = pages[pi].node.Resources()
      const xobj = resources?.lookup(PDFName.of('XObject'))
      if (!(xobj instanceof PDFDict)) continue
      for (const [, ref] of xobj.entries()) {
        if (!(ref instanceof PDFRef)) continue
        const key = ref.toString()
        if (seen.has(key)) continue // 同一张图被多页共用时只导出一次
        seen.add(key)
        const obj = ctx.lookup(ref)
        if (!(obj instanceof PDFRawStream)) continue
        const subtype = obj.dict.lookup(PDFName.of('Subtype'))
        if (!(subtype instanceof PDFName) || nameStr(subtype) !== 'Image') continue
        const wN = obj.dict.lookup(PDFName.of('Width'))
        const hN = obj.dict.lookup(PDFName.of('Height'))
        if (!(wN instanceof PDFNumber) || !(hN instanceof PDFNumber)) {
          skipped++
          continue
        }
        const w = Math.round(wN.asNumber())
        const h = Math.round(hN.asNumber())
        if (w <= 0 || h <= 0) {
          skipped++
          continue
        }
        if (minSize > 0 && (w < minSize || h < minSize)) {
          skipped++
          continue
        }
        const data = Buffer.from(obj.getContents())
        const filters = filterNamesOf(obj)
        if (filters.includes('DCTDecode')) {
          const out = uniquePath(dir, `第${pi + 1}页_${outputs.length + 1}.jpg`)
          await fs.promises.writeFile(out, data)
          outputs.push(out)
          continue
        }
        if (filters.length === 1 && filters[0] === 'FlateDecode') {
          const comps = componentsOf(obj.dict.lookup(PDFName.of('ColorSpace')), ctx)
          if (comps !== 1 && comps !== 3) {
            skipped++
            continue
          }
          try {
            const stride = comps * w
            const inflated = zlib.inflateSync(data)
            const predictor = predictorOf(obj, ctx)
            const pixels =
              predictor >= 10 ? undoPrediction(inflated, h, stride, comps) : inflated.subarray(0, h * stride)
            if (pixels.length < h * stride) throw new Error('像素数据长度不足')
            const png = encodePngImage(w, h, comps, pixels, stride)
            const out = uniquePath(dir, `第${pi + 1}页_${outputs.length + 1}.png`)
            await fs.promises.writeFile(out, png)
            outputs.push(out)
            continue
          } catch {
            skipped++
            continue
          }
        }
        skipped++
      }
    }
  } finally {
    // 一张图都没捞到时不要把空目录留在输出目录里
    if (!outputs.length) {
      await fs.promises.rm(dir, { recursive: true, force: true }).catch(() => undefined)
    }
  }
  return { outputs, count: outputs.length, skipped, pages: doc.getPageCount() }
}

/* ---------- 批量处理 ---------- */

/** 对多个 PDF 统一套用同一个操作；单文件失败不影响其余，失败原因逐条返回 */
export async function batchPdf(
  params: PdfBatchParams,
  onProgress?: (done: number, total: number) => void,
  isCancelled?: () => boolean
): Promise<PdfBatchResult> {
  if (params.paths.length === 0) throw new Error('请先选择 PDF 文件')
  const outputs: string[] = []
  const failed: Array<{ name: string; reason: string }> = []
  let done = 0
  for (const p of params.paths) {
    if (isCancelled?.()) throw new TaskCancelledError()
    try {
      if (params.action === 'watermark') {
        if (!params.watermarkText?.trim()) throw new Error('请填写水印文字')
        const r = await watermarkPdf({
          path: p,
          text: params.watermarkText,
          fontSize: params.watermarkFontSize ?? 48,
          opacity: params.watermarkOpacity ?? 0.25,
          rotation: params.watermarkRotation ?? -45,
          tile: params.watermarkTile ?? true,
          color: params.watermarkColor ?? 'gray',
          outDir: params.outDir
        })
        outputs.push(...r.outputs)
      } else if (params.action === 'numbers') {
        const r = await addPageNumbers({
          path: p,
          outDir: params.outDir,
          position: params.position ?? 'bottom-center',
          startAt: params.startAt ?? 1,
          fromPage: params.fromPage ?? 1
        })
        outputs.push(...r.outputs)
      } else if (params.action === 'headerFooter') {
        const r = await addHeaderFooter({
          paths: [p],
          outDir: params.outDir,
          header: params.header ?? '',
          footer: params.footer ?? '',
          fontSize: params.fontSize ?? 10,
          align: params.align ?? 'center',
          margin: params.margin ?? 24,
          fromPage: params.fromPage ?? 1
        })
        outputs.push(...r.outputs)
      } else if (params.action === 'rotate') {
        if (!params.angle) throw new Error('请选择旋转角度')
        const r = await rotatePdf({ path: p, angle: params.angle, outDir: params.outDir })
        outputs.push(...r.outputs)
      } else {
        const r = await writePdfMeta({
          paths: [p],
          outDir: params.outDir,
          title: '',
          author: '',
          subject: '',
          keywords: '',
          clear: true
        })
        outputs.push(...r.outputs)
      }
    } catch (e) {
      failed.push({ name: path.basename(p), reason: e instanceof Error ? e.message : String(e) })
    }
    onProgress?.(++done, params.paths.length)
  }
  return { outputs, failed }
}
