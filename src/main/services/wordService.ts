import fs from 'node:fs'
import PizZip from 'pizzip'
import Docxtemplater from 'docxtemplater'
import type { FillTemplateParams } from '@shared/types'
import { readDataRecords, resolveNamePattern, stemOf, uniquePath } from './fileUtils'
import { TaskCancelledError } from './taskProgress'

interface DocxErrorInfo {
  properties?: {
    errors?: Array<{ properties?: { explanation?: string } }>
  }
}

/**
 * 按数据行批量生成文档。
 * 一行一份，几百行的名单就是几百个文件，必须能看进度、能中途停——
 * 否则用户点错了模板只能干等，或强杀进程丢掉已生成的部分。
 */
export async function fillWord(
  params: FillTemplateParams,
  onProgress?: (done: number, total: number) => void,
  isCancelled?: () => boolean
): Promise<{ outputs: string[] }> {
  const records = await readDataRecords(params.dataPath)
  const templateBuf = await fs.promises.readFile(params.templatePath)
  const base = stemOf(params.templatePath)
  const outputs: string[] = []

  for (let i = 0; i < records.length; i++) {
    // 已生成的文件保留，不白跑
    if (isCancelled?.()) throw new TaskCancelledError()
    const zip = new PizZip(templateBuf)
    const doc = new Docxtemplater(zip, { paragraphLoop: true, linebreaks: true })
    try {
      doc.render(records[i])
    } catch (err) {
      const info = err as DocxErrorInfo
      const explanations = info?.properties?.errors
        ?.map(e => e?.properties?.explanation)
        .filter(Boolean)
        .join('；')
      throw new Error(`第 ${i + 1} 条数据渲染失败：${explanations || String(err)}`)
    }
    const buf = doc.getZip().generate({ type: 'nodebuffer' }) as Buffer
    const name = resolveNamePattern(params.namePattern, records[i], i, base)
    const out = uniquePath(params.outDir, `${name}.docx`)
    await fs.promises.writeFile(out, buf)
    outputs.push(out)
    onProgress?.(i + 1, records.length)
  }
  return { outputs }
}
