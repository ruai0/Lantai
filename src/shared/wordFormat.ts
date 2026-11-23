/**
 * Word 排版：纯计算与识别逻辑。主进程据此改写 OOXML，渲染层据此展示预设，两边同一套口径。
 * 坐标单位换算集中在 wunits.ts，避免"字号当磅值还是半磅"这类事在两头各写一份。
 */
import { cmToTwips, halfPt, charIndent } from './wunits'

/** 标题层级：0 = 正文，1/2/3 = 一/二/三级标题 */
export type HeadingLevel = 0 | 1 | 2 | 3

export interface FmtPreset {
  id: string
  name: string
  desc: string
  page: {
    /** 四边页边距，单位厘米 */
    top: number
    bottom: number
    left: number
    right: number
  }
  /** 正文 */
  body: RunFmt
  /** 三级标题 */
  h1: RunFmt
  h2: RunFmt
  h3: RunFmt
}

export interface RunFmt {
  /** 中文字体名（eastAsia），同时写入 ascii/hAnsi 以保证英文数字也统一 */
  font: string
  /** 字号，单位磅 */
  size: number
  bold: boolean
  /** 行距：固定磅值（lineRule=exact）或倍数（lineRule=auto）。公文用固定值 */
  linePt?: number
  lineMultiple?: number
  /** 首行缩进字符数（正文字段有意义） */
  firstLineChars?: number
  /** 段前段后间距，磅 */
  spaceBeforePt?: number
  spaceAfterPt?: number
  /** 对齐 */
  align?: 'left' | 'center' | 'right' | 'both'
}

/** 党政机关公文格式（GB/T 9704-2012）常用口径 */
export const PRESET_GONGWEN: FmtPreset = {
  id: 'gongwen',
  name: '党政机关公文',
  desc: '仿宋_GB2312 三号正文、行距固定 28 磅、首行缩进 2 字符；标题小标宋二号居中；一/二/三级标题黑体、楷体、仿宋加粗',
  page: { top: 3.7, bottom: 3.5, left: 2.8, right: 2.6 },
  body: { font: '仿宋_GB2312', size: 16, bold: false, linePt: 28, firstLineChars: 2, align: 'both' },
  h1: { font: '黑体', size: 16, bold: false, linePt: 28, firstLineChars: 2, align: 'both' },
  h2: { font: '楷体_GB2312', size: 16, bold: false, linePt: 28, firstLineChars: 2, align: 'both' },
  h3: { font: '仿宋_GB2312', size: 16, bold: true, linePt: 28, firstLineChars: 2, align: 'both' }
}

/** 通用文档：宋体小四、1.5 倍行距，标题黑体/楷体 */
export const PRESET_COMMON: FmtPreset = {
  id: 'common',
  name: '通用文档',
  desc: '宋体小四正文、1.5 倍行距、首行缩进 2 字符；标题黑体/楷体，适合通知、报告、总结',
  page: { top: 2.54, bottom: 2.54, left: 3.17, right: 3.17 },
  body: { font: '宋体', size: 12, bold: false, lineMultiple: 1.5, firstLineChars: 2, align: 'both' },
  h1: { font: '黑体', size: 14, bold: false, lineMultiple: 1.5, firstLineChars: 0, align: 'left' },
  h2: { font: '楷体', size: 13, bold: false, lineMultiple: 1.5, firstLineChars: 0, align: 'left' },
  h3: { font: '宋体', size: 12, bold: true, lineMultiple: 1.5, firstLineChars: 0, align: 'left' }
}

/** 简洁紧凑：五号字、1.25 倍行距，页边距收窄，适合内部资料、汇编 */
export const PRESET_COMPACT: FmtPreset = {
  id: 'compact',
  name: '简洁紧凑',
  desc: '宋体五号正文、1.25 倍行距、页边距 2cm，适合内部资料与汇编稿',
  page: { top: 2, bottom: 2, left: 2, right: 2 },
  body: { font: '宋体', size: 10.5, bold: false, lineMultiple: 1.25, firstLineChars: 2, align: 'both' },
  h1: { font: '黑体', size: 12, bold: false, lineMultiple: 1.25, firstLineChars: 0, align: 'left' },
  h2: { font: '楷体', size: 11, bold: false, lineMultiple: 1.25, firstLineChars: 0, align: 'left' },
  h3: { font: '宋体', size: 10.5, bold: true, lineMultiple: 1.25, firstLineChars: 0, align: 'left' }
}

export const PRESETS: FmtPreset[] = [PRESET_GONGWEN, PRESET_COMMON, PRESET_COMPACT]

export const presetById = (id: string): FmtPreset =>
  PRESETS.find(p => p.id === id) ?? PRESET_GONGWEN

/* ---------- 报告类型（主进程产出、渲染层展示，放 shared 免得渲染层反向 import 主进程） ---------- */

export interface WordFormatFileReport {
  path: string
  out: string
  ok: boolean
  error?: string
  /** 各层级段落数：[正文, 一级, 二级, 三级] */
  counts: [number, number, number, number]
  /** 认定出的标题文本（供抽查），最多列 40 条 */
  headings: string[]
  /** 页边距是否改动 */
  marginChanged: boolean
}

export interface WordFormatReport {
  outputs: string[]
  files: WordFormatFileReport[]
}

export interface WordScanItem {
  path: string
  counts: [number, number, number, number]
  headings: string[]
  error?: string
}

/* ---------- 字体候选（界面下拉用；都允许手输，装了公文字体的机器能直接选到） ---------- */

export const BODY_FONTS = [
  '仿宋_GB2312',
  '仿宋',
  '宋体',
  '楷体_GB2312',
  '楷体',
  '方正仿宋_GBK',
  '微软雅黑'
]

export const HEAD_FONTS = [
  '黑体',
  '方正小标宋简体',
  '楷体_GB2312',
  '楷体',
  '宋体',
  '仿宋_GB2312',
  '华文中宋',
  '微软雅黑'
]

/* ---------- 标题识别 ---------- */

const CN_NUM = '一二三四五六七八九十百千零〇两'
/** 「一、」「二十二、」——一级标题 */
const RE_L1 = new RegExp(`^[${CN_NUM}]+、`)
/** 「（一）」「（二十二）」——二级标题 */
const RE_L2 = new RegExp(`^（[${CN_NUM}]+）`)
/** 「1.」「1、」「1.2」「1）」「（1）」——三级及以下。注意（一）已在上一条匹配，这里只认全角/半角数字 */
const RE_L3 = /^(\d+(\.\d+)*)[\.、）]/
/** 「（1）xxx」——全角括号包数字，同样算三级 */
const RE_L3_PAREN = /^（\d+）/

/** 段首的编号本身，判断层级用 */
export function headingLevel(text: string): HeadingLevel {
  const t = text.trim()
  if (!t) return 0
  if (RE_L1.test(t)) return 1
  if (RE_L2.test(t)) return 2
  if (RE_L3.test(t)) return 3
  if (RE_L3_PAREN.test(t)) return 3
  return 0
}

/** 取值（含编号后的内容）长度上限：超过这个长度的"一、"更像正文里的列举而不是标题 */
const HEADING_MAX_CHARS = 60

export interface HeadingHit {
  level: HeadingLevel
  /** 段首编号（「一、」「（一）」「1.」），无则为空 */
  marker: string
  text: string
}

/**
 * 识别一段是否为标题。**保守优先**：只认编号型标题，
 * 不靠"短且居中"猜——那类随手一调就错杀，宁可漏认也不误伤。
 */
export function detectHeading(raw: string): HeadingHit | null {
  const text = raw.replace(/\s+/g, ' ').trim()
  if (!text) return null
  const level = headingLevel(text)
  if (level === 0) return null
  if (text.length > HEADING_MAX_CHARS) return null
  return { level, marker: text.slice(0, text.length - text.replace(/^[（(]?[一二三四五六七八九十百千零〇两\d]+[）)、\.、]?/, '').length) || text.slice(0, 6), text }
}

/* ---------- 单位换算（薄封装，便于单测与统一口径） ---------- */

export const u = {
  cmToTwips,
  halfPt,
  charIndent
}
