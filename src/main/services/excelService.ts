import fs from 'node:fs'
import ExcelJS from 'exceljs'
import PizZip from 'pizzip'
import type { DataPreview, DataRecord, FillTemplateParams, TemplateScanParams } from '@shared/types'
import { readDataRecords, resolveNamePattern, stemOf, uniquePath } from './fileUtils'
import { TaskCancelledError } from './taskProgress'
import { scanPptxFields } from './pptxService'

/**
 * 把记录填进工作簿所有文本单元格，返回替换次数与缺失字段集合。
 * 支持字符串、数字、公式结果（富文本）——占位符可能出现在数字/公式单元格里。
 * 缺失字段不再静默保留 {字段}，而是收集后由调用方统一抛错（与 Word/PPT 策略一致）。
 */
function fillWorkbook(wb: ExcelJS.Workbook, rec: DataRecord): { replaced: number; missing: Set<string> } {
  let replaced = 0
  const missing = new Set<string>()
  const sub = (text: string, collect: boolean): string =>
    text.replace(/\{([^{}]+)\}/g, (whole, key: string) => {
      const k = key.trim()
      if (k in rec) return rec[k]
      if (collect) missing.add(k)
      return whole
    })
  wb.eachSheet(ws => {
    ws.eachRow(row => {
      row.eachCell({ includeEmpty: false }, cell => {
        const v = cell.value
        if (typeof v === 'string' && v.includes('{')) {
          const after = sub(v, true)
          if (after !== v) {
            cell.value = after
            replaced++
          }
        } else if (v && typeof v === 'object') {
          // 富文本：逐段替换
          const obj = v as unknown as Record<string, unknown>
          if (Array.isArray(obj.richText)) {
            const arr = obj.richText as Array<{ text?: string }>
            let changed = false
            for (const seg of arr) {
              if (typeof seg.text === 'string' && seg.text.includes('{')) {
                const after = sub(seg.text, true)
                if (after !== seg.text) {
                  seg.text = after
                  changed = true
                }
              }
            }
            if (changed) {
              cell.value = { ...obj, richText: arr } as ExcelJS.CellValue
              replaced++
            }
          } else if ('result' in obj && typeof obj.result === 'string' && obj.result.includes('{')) {
            // 公式结果：把公式换成文本结果（占位符通常出现在纯文本标签里）
            const after = sub(obj.result, true)
            if (after !== obj.result) {
              cell.value = after
              replaced++
            }
          }
        }
      })
    })
  })
  return { replaced, missing }
}

/**
 * 按数据行批量生成 Excel。与 Word/PPT 同一套进度与中断口径。
 */
export async function fillExcel(
  params: FillTemplateParams,
  onProgress?: (done: number, total: number) => void,
  isCancelled?: () => boolean
): Promise<{ outputs: string[] }> {
  const records = await readDataRecords(params.dataPath)
  const templateBuf = await fs.promises.readFile(params.templatePath)
  const base = stemOf(params.templatePath)
  const outputs: string[] = []

  for (let i = 0; i < records.length; i++) {
    if (isCancelled?.()) throw new TaskCancelledError()
    const wb = new ExcelJS.Workbook()
    await wb.xlsx.load(templateBuf as unknown as ExcelJS.Buffer)
    const { replaced, missing } = fillWorkbook(wb, records[i])
    if (replaced === 0 && i === 0) {
      const fields = Object.keys(records[0]).slice(0, 8).join('、')
      throw new Error(`模板中未发现任何 {字段} 占位符（或占位符都在非文本单元格里）。数据文件提供的字段：${fields}`)
    }
    // 缺字段统一抛错：与 Word(docxtemplater)/PPT 的严格行为一致，避免静默产出半成品
    if (missing.size > 0) {
      throw new Error(`第 ${i + 1} 条数据缺字段：${[...missing].join('、')}（模板里有但数据文件没有这些列）`)
    }
    const name = resolveNamePattern(params.namePattern, records[i], i, base)
    const out = uniquePath(params.outDir, `${name}.xlsx`)
    await wb.xlsx.writeFile(out)
    outputs.push(out)
    onProgress?.(i + 1, records.length)
  }
  return { outputs }
}

/** 扫描模板里出现的 {字段} 占位符（word 扫正文+页眉页脚，excel 扫所有文本单元格，pptx 扫幻灯片） */
export async function scanTemplate(params: TemplateScanParams): Promise<{ fields: string[]; risky?: string[] }> {
  if (params.kind === 'pptx') return { fields: await scanPptxFields(params.templatePath) }
  if (params.kind === 'word') {
    const buf = await fs.promises.readFile(params.templatePath)
    const zip = new PizZip(buf)
    let xml = zip.file('word/document.xml')?.asText() ?? ''
    for (const f of zip.file(/^word\/(header|footer)\d*\.xml$/)) xml += f.asText()
    return scanWordXml(xml)
  }
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.readFile(params.templatePath)
  const fields = new Set<string>()
  wb.eachSheet(ws => {
    ws.eachRow(row => {
      row.eachCell({ includeEmpty: false }, cell => {
        const v = cell.value
        const text =
          typeof v === 'string'
            ? v
            : v && typeof v === 'object' && Array.isArray((v as { richText?: unknown }).richText)
              ? ((v as { richText: Array<{ text?: string }> }).richText).map(t => t.text ?? '').join('')
              : ''
        for (const m of text.matchAll(/\{([^{}]+)\}/g)) fields.add(m[1].trim())
      })
    })
  })
  return { fields: [...fields] }
}

/**
 * Word 占位符扫描：标准做法是把段落内所有 <w:t> 拼成一条字符轴再匹配，
 * 这样「被 Word 拆成多个 run 的占位符」也能扫到。同时识别出「跨 run 拆分」的字段，
 * 作为 risky 返回——docxtemplater 默认对拆分的占位符可能报错，提前提示用户避免"预览能扫到、生成却失败"。
 */
function scanWordXml(xml: string): { fields: string[]; risky: string[] } {
  const fields = new Set<string>()
  const risky = new Set<string>()
  // 逐段落处理：段落内跨 run 合并
  const PARA_RE = /<w:p\b[\s\S]*?<\/w:p>/g
  const T_RE = /<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g
  const decode = (s: string): string =>
    s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&')

  const handleChunk = (chunk: string, isParagraph: boolean) => {
    const texts: string[] = []
    for (const m of chunk.matchAll(T_RE)) texts.push(decode(m[1]))
    const joined = texts.join('')
    if (!joined.includes('{')) return
    const perRun = new Set<string>()
    if (isParagraph) {
      // 单 run 内能扫到的字段
      for (const t of texts) for (const m of t.matchAll(/\{([^{}]+)\}/g)) perRun.add(m[1].trim())
    }
    for (const m of joined.matchAll(/\{([^{}]+)\}/g)) {
      const tag = m[1].trim().replace(/^[#/@^%&]+/, '').trim()
      if (!tag) continue
      fields.add(tag)
      if (isParagraph && !perRun.has(m[1].trim())) risky.add(tag)
    }
  }

  for (const pm of xml.matchAll(PARA_RE)) {
    handleChunk(pm[0], true)
  }
  return { fields: [...fields], risky: [...risky] }
}

/** 数据文件预览：表头 + 前 5 行 */
export async function previewData(params: { dataPath: string }): Promise<DataPreview> {
  const records = await readDataRecords(params.dataPath)
  const headers = Object.keys(records[0])
  return {
    headers,
    rows: records.slice(0, 5).map(r => headers.map(h => r[h] ?? '')),
    total: records.length
  }
}
