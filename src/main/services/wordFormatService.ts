/**
 * Word 排版：把文档按预设统一成正文字体/字号/行距/缩进、三级标题字体、页边距。
 *
 * 走的是项目里已验证过的路：PizZip 解包 → @xmldom/xmldom 改 `word/document.xml`
 * 与 `word/styles.xml` → 重新打包。字体字号写在段落自己的 rPr/pPr 上而不是改 styles.xml，
 * 因为来路文档的样式表千差万别，段落级覆盖才压得住。
 */
import PizZip from 'pizzip'
import { DOMParser, XMLSerializer, type Element as XElement, type Document as XDocument } from '@xmldom/xmldom'
import fs from 'node:fs'
import path from 'node:path'
import {
  detectHeading,
  type FmtPreset,
  type HeadingHit,
  type WordFormatFileReport,
  type WordFormatReport,
  type WordScanItem
} from '@shared/wordFormat'
import { cmToTwips, halfPt, charIndent } from '@shared/wunits'
import { TaskCancelledError } from './taskProgress'

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
const q = (local: string): string => `w:${local}`

export interface WordFormatParams {
  paths: string[]
  outDir: string
  preset: FmtPreset
  /** 自定义输出文件名主干；留空 = 原文件名 */
  name?: string
}

/* ---------- XML 小工具 ---------- */

/** 找直接子级元素（不递归，避免把孙子辈的 rPr 抓来用）；找不到返回 null */
function findFirst(parent: XElement | XDocument, local: string): XElement | null {
  const list = (parent as XElement).getElementsByTagNameNS
    ? (parent as XElement).getElementsByTagNameNS(W, local)
    : []
  for (let i = 0; i < list.length; i++) {
    // 只认直接子级，别把孙子辈的 rPr 抓来用
    const el = list[i]
    if (el.parentNode === parent) return el
  }
  return null
}

/** 段落文本：拼所有 w:t */
function paraText(p: XElement): string {
  const ts = p.getElementsByTagNameNS(W, 't')
  let s = ''
  for (let i = 0; i < ts.length; i++) s += ts[i].textContent ?? ''
  return s
}

/** 该段落是否在表格内——表格段落另有版式，先不碰 */
function isInsideTable(el: XElement): boolean {
  let n: unknown = el
  while (n && (n as XElement).nodeType === 1) {
    if ((n as XElement).localName === 'tc') return true
    n = (n as XElement).parentNode
  }
  return false
}

/* ---------- 段落级改写 ---------- */

/** 给一个 run 套字体字号加粗：清掉旧的 rPr 再按 OOXML 要求的顺序重建 */
function applyRunFmt(run: XElement, fmt: { font: string; size: number; bold: boolean }): void {
  const doc = run.ownerDocument!
  let rPr = findFirst(run, 'rPr')
  if (rPr) run.removeChild(rPr)
  rPr = doc.createElementNS(W, q('rPr'))
  // 顺序：rFonts → b → sz → szCs（schema 要求）
  const rFonts = doc.createElementNS(W, q('rFonts'))
  rFonts.setAttribute('w:ascii', fmt.font)
  rFonts.setAttribute('w:hAnsi', fmt.font)
  rFonts.setAttribute('w:eastAsia', fmt.font)
  rPr.appendChild(rFonts)
  if (fmt.bold) {
    const b = doc.createElementNS(W, q('b'))
    rPr.appendChild(b)
  }
  const sz = doc.createElementNS(W, q('sz'))
  sz.setAttribute('w:val', String(halfPt(fmt.size)))
  rPr.appendChild(sz)
  const szCs = doc.createElementNS(W, q('szCs'))
  szCs.setAttribute('w:val', String(halfPt(fmt.size)))
  rPr.appendChild(szCs)
  run.insertBefore(rPr, run.firstChild)
}

/** 给段落套 pPr：行距、缩进、对齐、段前段后 */
function applyParaFmt(
  p: XElement,
  fmt: { linePt?: number; lineMultiple?: number; firstLineChars?: number; spaceBeforePt?: number; spaceAfterPt?: number; align?: string }
): void {
  const doc = p.ownerDocument!
  let pPr = findFirst(p, 'pPr')
  if (!pPr) {
    pPr = doc.createElementNS(W, q('pPr'))
    p.insertBefore(pPr, p.firstChild)
  }
  // 行距
  let spacing = findFirst(pPr, 'spacing')
  if (!spacing) {
    spacing = doc.createElementNS(W, q('spacing'))
    pPr.appendChild(spacing)
  }
  const el = spacing as XElement
  if (fmt.linePt) {
    el.setAttribute('w:line', String(Math.round(fmt.linePt * 20)))
    el.setAttribute('w:lineRule', 'exact')
  } else if (fmt.lineMultiple) {
    el.setAttribute('w:line', String(Math.round(fmt.lineMultiple * 240)))
    el.setAttribute('w:lineRule', 'auto')
  }
  if (fmt.spaceBeforePt) el.setAttribute('w:before', String(Math.round(fmt.spaceBeforePt * 20)))
  if (fmt.spaceAfterPt) el.setAttribute('w:after', String(Math.round(fmt.spaceAfterPt * 20)))

  // 首行缩进：优先 firstLineChars（随字号自适应，改字号不用重算）
  let ind = findFirst(pPr, 'ind')
  if (fmt.firstLineChars && fmt.firstLineChars > 0) {
    if (!ind) {
      ind = doc.createElementNS(W, q('ind'))
      pPr.appendChild(ind)
    }
    ;(ind as XElement).setAttribute('w:firstLineChars', String(Math.round(fmt.firstLineChars * 100)))
    ;(ind as XElement).setAttribute('w:firstLine', String(charIndent(fmt.firstLineChars, 16)))
  } else if (ind) {
    // 该层级不缩进：把首行缩进归零，免得继承来路文档的设置
    ;(ind as XElement).setAttribute('w:firstLineChars', '0')
    ;(ind as XElement).setAttribute('w:firstLine', '0')
  }

  // 对齐
  let jc = findFirst(pPr, 'jc')
  if (fmt.align && fmt.align !== 'left') {
    if (!jc) {
      jc = doc.createElementNS(W, q('jc'))
      pPr.appendChild(jc)
    }
    ;(jc as XElement).setAttribute('w:val', fmt.align)
  } else if (jc) {
    ;(jc as XElement).setAttribute('w:val', 'left')
  }
}

/** 给一个段落按层级套格式 */
function applyLevel(p: XElement, preset: FmtPreset, level: 0 | 1 | 2 | 3): void {
  const fmt = level === 0 ? preset.body : level === 1 ? preset.h1 : level === 2 ? preset.h2 : preset.h3
  const runs = p.getElementsByTagNameNS(W, 'r')
  for (let i = 0; i < runs.length; i++) applyRunFmt(runs[i], fmt)
  applyParaFmt(p, fmt)
}

/* ---------- 页边距 ---------- */

function applyMargins(doc: XDocument, preset: FmtPreset): boolean {
  const sects = doc.getElementsByTagNameNS(W, 'sectPr')
  if (!sects.length) return false
  const mar = findFirst(sects[0], 'pgMar')
  if (!mar) return false
  const el = mar as XElement
  const before = el.getAttribute('w:top') + '|' + el.getAttribute('w:bottom') + '|' + el.getAttribute('w:left') + '|' + el.getAttribute('w:right')
  el.setAttribute('w:top', String(cmToTwips(preset.page.top)))
  el.setAttribute('w:bottom', String(cmToTwips(preset.page.bottom)))
  el.setAttribute('w:left', String(cmToTwips(preset.page.left)))
  el.setAttribute('w:right', String(cmToTwips(preset.page.right)))
  const after = el.getAttribute('w:top') + '|' + el.getAttribute('w:bottom') + '|' + el.getAttribute('w:left') + '|' + el.getAttribute('w:right')
  return before !== after
}

/* ---------- 主流程 ---------- */

/** 把 docx 的 XML 改写为排版后的 XML；返回统计（便于单测与报告） */
export function formatDocxXml(xml: string, preset: FmtPreset): {
  xml: string
  counts: [number, number, number, number]
  headings: string[]
  marginChanged: boolean
} {
  const doc = new DOMParser().parseFromString(xml, 'text/xml')
  const body = doc.getElementsByTagNameNS(W, 'body')[0]
  const counts: [number, number, number, number] = [0, 0, 0, 0]
  const headings: string[] = []
  if (body) {
    const paras = body.getElementsByTagNameNS(W, 'p')
    // getElementsByTagNameNS 是活列表，原地改不会增减元素，安全
    for (let i = 0; i < paras.length; i++) {
      const p = paras[i]
      if (isInsideTable(p)) continue // 表格内段落另有版式，先不碰
      const text = paraText(p)
      if (!text.trim()) continue // 空段落只当间隔，不改样式（改了就丢原有呼吸感）
      const hit: HeadingHit | null = detectHeading(text)
      const level = hit ? hit.level : 0
      applyLevel(p, preset, level)
      counts[level]++
      if (hit && headings.length < 40) headings.push(`L${level} ${hit.text}`)
    }
  }
  const marginChanged = applyMargins(doc, preset)
  return { xml: new XMLSerializer().serializeToString(doc), counts, headings, marginChanged }
}

/** 排版单个 docx 文件，输出到 outDir；保留原文件 */
export async function formatOneWord(
  src: string,
  outDir: string,
  preset: FmtPreset,
  nameStem?: string
): Promise<WordFormatFileReport> {
  const rep: WordFormatFileReport = {
    path: src,
    out: '',
    ok: false,
    counts: [0, 0, 0, 0],
    headings: [],
    marginChanged: false
  }
  try {
    const buf = fs.readFileSync(src)
    const zip = new PizZip(buf)
    const entry = zip.file('word/document.xml')
    if (!entry) throw new Error('不是有效的 .docx（缺少 word/document.xml）')
    const r = formatDocxXml(entry.asText(), preset)
    zip.file('word/document.xml', r.xml)
    rep.counts = r.counts
    rep.headings = r.headings
    rep.marginChanged = r.marginChanged
    const stem = nameStem?.trim() || path.parse(src).name
    const out = path.join(outDir, `${stem}.docx`)
    // 同名不静默覆盖：追加 (2)(3)
    let finalOut = out
    let n = 2
    while (fs.existsSync(finalOut)) finalOut = path.join(outDir, `${stem} (${n++}).docx`)
    fs.writeFileSync(finalOut, zip.generate({ type: 'nodebuffer' }))
    rep.out = finalOut
    rep.ok = true
  } catch (e) {
    rep.error = e instanceof Error ? e.message : String(e)
  }
  return rep
}

/**
 * 批量排版。
 * 支持进度与中断：一份文档动辄几百毫秒，一百份就是几十秒，
 * 用户选错目录或中途改主意时得能停下来，也得知道还剩多少。
 */
export async function formatWordFiles(
  params: WordFormatParams,
  onProgress?: (done: number, total: number) => void,
  isCancelled?: () => boolean
): Promise<WordFormatReport> {
  if (!params.paths.length) throw new Error('请先选择 Word 文件')
  if (!params.outDir) throw new Error('请先选择输出文件夹')
  fs.mkdirSync(params.outDir, { recursive: true })
  const files: WordFormatFileReport[] = []
  const total = params.paths.length
  let done = 0
  for (const p of params.paths) {
    // 中断检查放在每个文件之前：已处理的文件保留，不白跑
    if (isCancelled?.()) throw new TaskCancelledError()
    files.push(await formatOneWord(p, params.outDir, params.preset, params.name))
    onProgress?.(++done, total)
  }
  const ok = files.filter(f => f.ok)
  if (!ok.length) throw new Error(files[0]?.error ?? '全部文件处理失败')
  return { outputs: ok.map(f => f.out), files }
}

/** 只扫描不改写：给界面在处理前展示"会认出多少标题、页边距要不要动" */
export async function scanWordHeadings(paths: string[]): Promise<
  Array<{ path: string; counts: [number, number, number, number]; headings: string[]; error?: string }>
> {
  const out: WordScanItem[] = []
  for (const p of paths) {
    try {
      const zip = new PizZip(fs.readFileSync(p))
      const entry = zip.file('word/document.xml')
      if (!entry) throw new Error('不是有效的 .docx')
      const doc = new DOMParser().parseFromString(entry.asText(), 'text/xml')
      const body = doc.getElementsByTagNameNS(W, 'body')[0]
      const counts: [number, number, number, number] = [0, 0, 0, 0]
      const headings: string[] = []
      if (body) {
        const paras = body.getElementsByTagNameNS(W, 'p')
        for (let i = 0; i < paras.length; i++) {
          const t = paraText(paras[i])
          if (!t.trim()) continue
          const hit = detectHeading(t)
          const lv = hit ? hit.level : 0
          counts[lv]++
          if (hit && headings.length < 30) headings.push(`L${lv} ${hit.text}`)
        }
      }
      out.push({ path: p, counts, headings })
    } catch (e) {
      out.push({ path: p, counts: [0, 0, 0, 0], headings: [], error: e instanceof Error ? e.message : String(e) })
    }
  }
  return out
}
