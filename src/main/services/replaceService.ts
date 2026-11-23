import fs from 'node:fs'
import path from 'node:path'
import ExcelJS from 'exceljs'
import PizZip from 'pizzip'
import type { ReplaceTextParams, ReplaceTextResult } from '@shared/types'
import { uniquePath } from './fileUtils'
import { TaskCancelledError } from './taskProgress'

interface ReplaceOutcome {
  outPath: string
  count: number
  /** 疑似因排版被拆开而漏替换的处数 */
  splitMisses: number
}

export interface WordReplaceResult {
  xml: string
  /** 实际替换的处数 */
  count: number
  /** 因排版被拆进多个 run、导致无法匹配的处数（换 run 前的近似统计） */
  splitMisses: number
}

const XML_ESC = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

/**
 * 在 docx 的 XML 文本节点（<w:t>）里做替换。
 *
 * 仅在最简单的情形（查找词完整落在单个 <w:t> 内）直接替换；若一个段落内的
 * 相邻 <w:t> 片段拼起来才包含查找词（Word 因改字体/加粗/修订等把词拆进多个
 * run），则做「跨 run 合并匹配 + 按 run 边界回写」，把替换结果尽量塞回原片段，
 * 多余的片段清空。这样既不破坏原格式，又能命中被拆散的词。
 */
export function replaceInWordXml(xml: string, find: string, replace: string): [string, number] {
  const r = replaceInWordXmlDetailed(xml, find, replace)
  return [r.xml, r.count]
}

export function replaceInWordXmlDetailed(xml: string, find: string, replace: string): WordReplaceResult {
  if (!find) return { xml, count: 0, splitMisses: 0 }
  const escFind = XML_ESC(find)
  const escReplace = XML_ESC(replace)
  let count = 0
  let splitMisses = 0

  // 以 <w:t> ... </w:t> 为最小替换单元分组；同一段落（<w:p>…</w:p>）内的片段可跨 run 拼接
  const processChunk = (para: string): string => {
    const tagRe = /(<w:t(?:\s[^>]*)?>)([\s\S]*?)(<\/w:t>)/g
    const segs: Array<{ start: number; end: number; open: string; text: string }> = []
    let m: RegExpExecArray | null
    while ((m = tagRe.exec(para)) !== null) {
      segs.push({ start: m.index, end: m.index + m[0].length, open: m[1], text: m[2] })
    }
    if (segs.length === 0) return para

    const joined = segs.map(s => s.text).join('')
    if (!joined.includes(escFind)) return para

    // 简单情形：查找词落在单个片段内 → 沿用旧逻辑逐片段替换，天然不破坏格式
    // 复杂情形：查找词跨片段 → 在拼接文本上全局匹配
    const hadAnyInSingle = segs.some(s => s.text.includes(escFind))
    const replaced = joined.split(escFind).join(escReplace)
    const occurrences = joined.split(escFind).length - 1
    if (occurrences === 0) return para

    if (hadAnyInSingle && occurrences === segs.reduce((n, s) => n + (s.text.split(escFind).length - 1), 0)) {
      // 所有命中都在单一片段内，按片段替换即可（保留每个片段的 tag 属性）
      let changed = 0
      let idx = 0
      let rebuilt = ''
      for (const s of segs) {
        const hits = s.text.split(escFind).length - 1
        const newText = s.text.split(escFind).join(escReplace)
        rebuilt += para.slice(idx, s.start) + s.open + newText + '</w:t>'
        idx = s.end
        changed += hits
      }
      rebuilt += para.slice(idx)
      count += changed
      return rebuilt
    }

    // 跨片段：把替换后的文本按原片段长度依次回填，多余片段清空
    count += occurrences
    // 统计有多少处命中是被拆散的（无法单片段命中的命中数）
    const singleHits = segs.reduce((n, s) => n + (s.text.split(escFind).length - 1), 0)
    splitMisses += Math.max(0, occurrences - singleHits)

    const lens = segs.map(s => s.text.length)
    let cursor = 0
    const filled = lens.map(len => {
      const part = replaced.slice(cursor, cursor + len)
      cursor += len
      return part
    })
    // 若替换后总长度超过原容量，把剩余内容追加到最后一个片段，保证不丢字
    if (cursor < replaced.length) filled[filled.length - 1] += replaced.slice(cursor)

    let idx = 0
    let rebuilt = ''
    segs.forEach((s, i) => {
      rebuilt += para.slice(idx, s.start) + s.open + filled[i] + '</w:t>'
      idx = s.end
    })
    rebuilt += para.slice(idx)
    return rebuilt
  }

  // 段落内可跨 run 拼接；段落外的零散 <w:t> 单独处理（正常 docx 都会有 <w:p> 包裹）
  const PARA_RE = /<w:p\b[\s\S]*?<\/w:p>/g
  let out = ''
  let last = 0
  let pm: RegExpExecArray | null
  while ((pm = PARA_RE.exec(xml)) !== null) {
    out += processChunk(xml.slice(last, pm.index)) + processChunk(pm[0])
    last = pm.index + pm[0].length
  }
  out += processChunk(xml.slice(last))

  // 统计被拆散但仍未命中的情况：查找词的所有字符都出现在拼接文本里，但整体匹配不到
  // （例如被拆得更碎、或含不可见字符）——用于给用户「可能漏替换」的提示
  if (count === 0 && !xml.includes(escFind)) {
    const plain = xml.replace(/<[^>]+>/g, '')
    if (plain.includes(find)) splitMisses += 1
  }

  return { xml: out, count, splitMisses }
}

async function replaceWord(p: string, find: string, replace: string, outDir: string): Promise<ReplaceOutcome> {
  const buf = await fs.promises.readFile(p)
  const zip = new PizZip(buf)
  let count = 0
  let splitMisses = 0
  const targets = ['word/document.xml', ...Object.keys(zip.files).filter(n => /^word\/(header|footer)\d*\.xml$/.test(n))]
  for (const name of targets) {
    const file = zip.file(name)
    if (!file) continue
    const r = replaceInWordXmlDetailed(file.asText(), find, replace)
    if (r.count > 0) {
      zip.file(name, r.xml)
      count += r.count
    }
    splitMisses += r.splitMisses
  }
  const out = uniquePath(outDir, path.basename(p))
  await fs.promises.writeFile(out, zip.generate({ type: 'nodebuffer' }))
  return { outPath: out, count, splitMisses }
}

async function replaceExcel(p: string, find: string, replace: string, outDir: string): Promise<ReplaceOutcome> {
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.readFile(p)
  let count = 0
  wb.eachSheet(ws => {
    ws.eachRow(row => {
      row.eachCell({ includeEmpty: false }, cell => {
        if (typeof cell.value === 'string' && cell.value.includes(find)) {
          count += cell.value.split(find).length - 1
          cell.value = cell.value.split(find).join(replace)
        }
      })
    })
  })
  const out = uniquePath(outDir, path.basename(p))
  await wb.xlsx.writeFile(out)
  return { outPath: out, count, splitMisses: 0 }
}

export async function replaceText(
  params: ReplaceTextParams,
  onProgress?: (done: number, total: number) => void,
  isCancelled?: () => boolean
): Promise<ReplaceTextResult> {
  const find = params.find
  if (!find) throw new Error('请填写要查找的文字')
  if (params.paths.length === 0) throw new Error('请先选择文件')
  const outputs: string[] = []
  const counts: ReplaceTextResult['counts'] = []
  let done = 0
  for (const p of params.paths) {
    if (isCancelled?.()) throw new TaskCancelledError()
    const ext = path.extname(p).toLowerCase()
    let r: ReplaceOutcome
    if (ext === '.docx') r = await replaceWord(p, find, params.replace, params.outDir)
    else if (ext === '.xlsx') r = await replaceExcel(p, find, params.replace, params.outDir)
    else if (ext === '.doc') {
      throw new Error(`「${path.basename(p)}」是老版 .doc 格式，无法直接替换：请先用本机 Word / WPS 另存为 .docx 后再处理`)
    } else throw new Error(`暂只支持 .docx / .xlsx（不支持：${path.basename(p)}）`)
    outputs.push(r.outPath)
    counts.push({ name: path.basename(p), count: r.count, splitMisses: r.splitMisses })
    onProgress?.(++done, params.paths.length)
  }
  return { outputs, counts }
}
