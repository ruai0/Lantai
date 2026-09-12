import fs from 'node:fs'
import PizZip from 'pizzip'
import Docxtemplater from 'docxtemplater'
import type { FillTemplateParams } from '@shared/types'
import { readDataRecords, resolveNamePattern, stemOf, uniquePath } from './fileUtils'

interface DocxErrorInfo {
  properties?: {
    errors?: Array<{ properties?: { explanation?: string } }>
  }
}

export async function fillWord(params: FillTemplateParams): Promise<{ outputs: string[] }> {
  const records = await readDataRecords(params.dataPath)
  const templateBuf = await fs.promises.readFile(params.templatePath)
  const base = stemOf(params.templatePath)
  const outputs: string[] = []

  for (let i = 0; i < records.length; i++) {
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
  }
  return { outputs }
}
