import fs from 'node:fs'
import PizZip from 'pizzip'
import type { FillTemplateParams } from '@shared/types'
import { readDataRecords, resolveNamePattern, stemOf, uniquePath } from './fileUtils'
import { TaskCancelledError } from './taskProgress'
import { fillPptxXml, scanPptxXml } from './pptxTemplate'

/** pptx 里承载正文的部件（母版/版式/备注页不动，保证模板设计零损失） */
function slideEntries(zip: PizZip): Array<{ name: string; text: string }> {
  const out: Array<{ name: string; text: string }> = []
  for (const name of Object.keys(zip.files)) {
    if (/^ppt\/slides\/slide\d+\.xml$/.test(name)) out.push({ name, text: zip.files[name].asText() })
  }
  return out.sort((a, b) => a.name.localeCompare(b.name))
}

/** 扫描 PPT 模板里的 {字段} 占位符 */
export async function scanPptxFields(templatePath: string): Promise<string[]> {
  const buf = await fs.promises.readFile(templatePath)
  const zip = new PizZip(buf)
  const fields = new Set<string>()
  for (const entry of slideEntries(zip)) for (const f of scanPptxXml(entry.text)) fields.add(f)
  return [...fields]
}

/** 逐条数据生成 pptx：只重写 slide XML，其余字节原样保留 */
/** 按数据行批量生成 PPT。与 Word/Excel 同一套进度与中断口径。 */
export async function fillPptx(
  params: FillTemplateParams,
  onProgress?: (done: number, total: number) => void,
  isCancelled?: () => boolean
): Promise<{ outputs: string[] }> {
  const records = await readDataRecords(params.dataPath)
  const templateBuf = await fs.promises.readFile(params.templatePath)
  const base = stemOf(params.templatePath)

  const probe = new PizZip(templateBuf)
  const slides = slideEntries(probe)
  if (!slides.length) throw new Error('不是有效的 PPT 文件（未找到幻灯片）')
  const allFields = new Set<string>()
  for (const s of slides) for (const f of scanPptxXml(s.text)) allFields.add(f)
  if (!allFields.size) {
    const sample = records[0] ? Object.keys(records[0]).join('、') : '（数据文件为空）'
    throw new Error(`模板中未发现任何 {字段} 占位符。数据文件提供的字段：${sample}`)
  }

  const outputs: string[] = []
  for (let i = 0; i < records.length; i++) {
    if (isCancelled?.()) throw new TaskCancelledError()
    const zip = new PizZip(templateBuf)
    for (const s of slides) {
      try {
        zip.file(s.name, fillPptxXml(s.text, records[i]))
      } catch (err) {
        throw new Error(`第 ${i + 1} 条数据渲染失败：${err instanceof Error ? err.message : String(err)}`)
      }
    }
    const buf = zip.generate({ type: 'nodebuffer', compression: 'DEFLATE' }) as Buffer
    const name = resolveNamePattern(params.namePattern, records[i], i, base)
    const out = uniquePath(params.outDir, `${name}.pptx`)
    await fs.promises.writeFile(out, buf)
    outputs.push(out)
    onProgress?.(i + 1, records.length)
  }
  return { outputs }
}
