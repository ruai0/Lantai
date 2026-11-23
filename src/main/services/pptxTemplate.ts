import type { DataRecord } from '@shared/types'

/**
 * PPTX 模板填充的纯 XML 逻辑（pptx = zip 里的 OOXML，只动 ppt/slides/slideN.xml，版式零损失）。
 * 占位符约定与 Word/Excel 一致：单花括号 {字段名}。
 * 难点：PowerPoint 会把一句话按格式切成多个 run，占位符可能被劈开（如 "{姓" + "名}"）——
 * 这里按段落把所有 <a:t> 文本拼成一条字符轴，占位符命中段整体替换为值（挂在首个参与 run），
 * 其余参与 run 清空对应片段；未参与的 run 原样保留（格式不受影响）。
 */

const PLACEHOLDER = /\{([^{}]+)\}/g
const PARAGRAPH_RE = /<a:p(?:\s[^>]*)?>[\s\S]*?<\/a:p>/g
const RUN_RE = /<a:r(?:\s[^>]*)?>[\s\S]*?<\/a:r>/g
const TEXT_RE = /<a:t(?:\s[^>]*)?>([\s\S]*?)<\/a:t>/

function decodeEntities(s: string): string {
  return s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&')
}

function encodeText(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

/** 归一化占位符里的字段名：去空白、剥掉 docxtemplater 风格前缀标记 */
function normalizeTag(tag: string): string {
  return tag
    .trim()
    .replace(/^[#/@^%&]+/, '')
    .trim()
}

interface RunInfo {
  /** 该 run 在段落原文里的起止 */
  start: number
  end: number
  /** <a:t> 内容在段落原文里的起止（不含标签） */
  tStart: number
  tEnd: number
  text: string
}

/** 提取一个段落里各 run 的 <a:t> 文本（解码后） */
function parseRuns(paragraph: string): RunInfo[] {
  const runs: RunInfo[] = []
  for (const m of paragraph.matchAll(RUN_RE)) {
    const runStart = m.index ?? 0
    const t = m[0].match(TEXT_RE)
    if (!t || t.index === undefined) continue
    // 内容起点按尾部 </a:t> 定长反推，避免 indexOf 在极端文本下误命中
    const inner = t[0].length - t[1].length - '</a:t>'.length
    runs.push({
      start: runStart,
      end: runStart + m[0].length,
      tStart: runStart + t.index + inner,
      tEnd: runStart + t.index + inner + t[1].length,
      text: decodeEntities(t[1])
    })
  }
  return runs
}

/** 段落全文（各 run 拼接）里扫描占位符字段名 */
export function scanPptxXml(xml: string): string[] {
  const fields = new Set<string>()
  for (const pm of xml.matchAll(PARAGRAPH_RE)) {
    const full = parseRuns(pm[0])
      .map(r => r.text)
      .join('')
    for (const m of full.matchAll(PLACEHOLDER)) {
      const tag = normalizeTag(m[1])
      if (tag) fields.add(tag)
    }
  }
  return [...fields]
}

/**
 * 用一条数据替换段落占位符。缺字段直接抛错（与 docxtemplater 默认严格行为一致，
 * 避免静默产出半成品文档）。
 */
export function fillPptxXml(xml: string, record: DataRecord): string {
  return xml.replace(PARAGRAPH_RE, paragraph => {
    const runs = parseRuns(paragraph)
    if (!runs.length) return paragraph
    // 字符轴按 UTF-16 码元切（与 matchAll 的下标口径一致，emoji 也不错位）
    const axis: Array<{ run: number; ch: string }> = []
    runs.forEach((r, i) => {
      for (let k = 0; k < r.text.length; k++) axis.push({ run: i, ch: r.text[k] })
    })
    const full = axis.map(a => a.ch).join('')
    if (!full.includes('{')) return paragraph

    const matches = [...full.matchAll(PLACEHOLDER)]
    if (!matches.length) return paragraph

    const out = [...axis]
    // 从后往前替换，避免前面的替换移动后面的下标
    for (let i = matches.length - 1; i >= 0; i--) {
      const m = matches[i]
      const s = m.index
      const key = normalizeTag(m[1])
      const v = record[key]
      if (v === undefined) throw new Error(`数据缺字段「${key}」（占位符 {${m[1]}}）`)
      const firstRun = out[s].run
      const value = String(v)
      const cells = []
      for (let k = 0; k < value.length; k++) cells.push({ run: firstRun, ch: value[k] })
      out.splice(s, m[0].length, ...cells)
    }
    // 按 run 重组文本
    const rebuilt: string[] = runs.map(() => '')
    for (const cell of out) rebuilt[cell.run] += cell.ch

    // 从后往前改写各 run 的 <a:t> 内容（只动文本变了的）
    let patched = paragraph
    for (let i = runs.length - 1; i >= 0; i--) {
      if (rebuilt[i] === runs[i].text) continue
      const r = runs[i]
      patched = patched.slice(0, r.tStart) + encodeText(rebuilt[i]) + patched.slice(r.tEnd)
    }
    return patched
  })
}
