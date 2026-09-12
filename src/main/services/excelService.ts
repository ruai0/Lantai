import fs from 'node:fs'
import ExcelJS from 'exceljs'
import PizZip from 'pizzip'
import type { DataPreview, DataRecord, FillTemplateParams, TemplateScanParams } from '@shared/types'
import { readDataRecords, replacePlaceholders, resolveNamePattern, stemOf, uniquePath } from './fileUtils'

/** 把记录填进工作簿所有文本单元格，返回替换次数 */
function fillWorkbook(wb: ExcelJS.Workbook, rec: DataRecord): number {
  let replaced = 0
  wb.eachSheet(ws => {
    ws.eachRow(row => {
      row.eachCell({ includeEmpty: false }, cell => {
        if (typeof cell.value === 'string' && cell.value.includes('{')) {
          const after = replacePlaceholders(cell.value, rec)
          if (after !== cell.value) {
            cell.value = after
            replaced++
          }
        }
      })
    })
  })
  return replaced
}

export async function fillExcel(params: FillTemplateParams): Promise<{ outputs: string[] }> {
  const records = await readDataRecords(params.dataPath)
  const templateBuf = await fs.promises.readFile(params.templatePath)
  const base = stemOf(params.templatePath)
  const outputs: string[] = []

  for (let i = 0; i < records.length; i++) {
    const wb = new ExcelJS.Workbook()
    await wb.xlsx.load(templateBuf as unknown as ExcelJS.Buffer)
    const replaced = fillWorkbook(wb, records[i])
    if (replaced === 0 && i === 0) {
      const fields = Object.keys(records[0])
        .slice(0, 8)
        .join('、')
      throw new Error(`模板中未发现任何 {字段} 占位符。数据文件提供的字段：${fields}`)
    }
    const name = resolveNamePattern(params.namePattern, records[i], i, base)
    const out = uniquePath(params.outDir, `${name}.xlsx`)
    await wb.xlsx.writeFile(out)
    outputs.push(out)
  }
  return { outputs }
}

/** 扫描模板里出现的 {字段} 占位符（word 扫正文+页眉页脚，excel 扫所有文本单元格） */
export async function scanTemplate(params: TemplateScanParams): Promise<{ fields: string[] }> {
  if (params.kind === 'word') {
    const buf = await fs.promises.readFile(params.templatePath)
    const zip = new PizZip(buf)
    let xml = zip.file('word/document.xml')?.asText() ?? ''
    for (const f of zip.file(/^word\/(header|footer)\d*\.xml$/)) xml += f.asText()
    const fields = new Set<string>()
    for (const m of xml.matchAll(/\{([^{}]+)\}/g)) {
      const tag = m[1]
        .trim()
        .replace(/^[#/@^%&]+/, '')
        .trim()
      if (tag) fields.add(tag)
    }
    return { fields: [...fields] }
  }
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.readFile(params.templatePath)
  const fields = new Set<string>()
  wb.eachSheet(ws => {
    ws.eachRow(row => {
      row.eachCell({ includeEmpty: false }, cell => {
        if (typeof cell.value === 'string') {
          for (const m of cell.value.matchAll(/\{([^{}]+)\}/g)) fields.add(m[1].trim())
        }
      })
    })
  })
  return { fields: [...fields] }
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
