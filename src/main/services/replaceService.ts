import fs from 'node:fs'
import path from 'node:path'
import ExcelJS from 'exceljs'
import PizZip from 'pizzip'
import type { ReplaceTextParams, ReplaceTextResult } from '@shared/types'
import { uniquePath } from './fileUtils'

interface ReplaceOutcome {
  outPath: string
  count: number
}

/** 在 docx 的 XML 文本节点（<w:t>）里做替换；跨 run 拆开的文字匹配不到（与模板扫描同一限制） */
export function replaceInWordXml(xml: string, find: string, replace: string): [string, number] {
  let count = 0
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  const escFind = esc(find)
  const escReplace = esc(replace)
  const re = new RegExp(`(<w:t[^>]*>)([\\s\\S]*?)</w:t>`, 'g')
  const out = xml.replace(re, (whole, open: string, text: string) => {
    if (!text.includes(escFind)) return whole
    const parts = text.split(escFind)
    count += parts.length - 1
    return open + parts.join(escReplace) + '</w:t>'
  })
  return [out, count]
}

async function replaceWord(p: string, find: string, replace: string, outDir: string): Promise<ReplaceOutcome> {
  const buf = await fs.promises.readFile(p)
  const zip = new PizZip(buf)
  let count = 0
  const targets = ['word/document.xml', ...Object.keys(zip.files).filter(n => /^word\/(header|footer)\d*\.xml$/.test(n))]
  for (const name of targets) {
    const file = zip.file(name)
    if (!file) continue
    const [xml, n] = replaceInWordXml(file.asText(), find, replace)
    if (n > 0) {
      zip.file(name, xml)
      count += n
    }
  }
  const out = uniquePath(outDir, path.basename(p))
  await fs.promises.writeFile(out, zip.generate({ type: 'nodebuffer' }))
  return { outPath: out, count }
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
  return { outPath: out, count }
}

export async function replaceText(
  params: ReplaceTextParams,
  onProgress?: (done: number, total: number) => void
): Promise<ReplaceTextResult> {
  const find = params.find
  if (!find) throw new Error('请填写要查找的文字')
  if (params.paths.length === 0) throw new Error('请先选择文件')
  const outputs: string[] = []
  const counts: ReplaceTextResult['counts'] = []
  let done = 0
  for (const p of params.paths) {
    const ext = path.extname(p).toLowerCase()
    let r: ReplaceOutcome
    if (ext === '.docx') r = await replaceWord(p, find, params.replace, params.outDir)
    else if (ext === '.xlsx') r = await replaceExcel(p, find, params.replace, params.outDir)
    else throw new Error(`暂只支持 .docx / .xlsx（不支持：${path.basename(p)}）`)
    outputs.push(r.outPath)
    counts.push({ name: path.basename(p), count: r.count })
    onProgress?.(++done, params.paths.length)
  }
  return { outputs, counts }
}
