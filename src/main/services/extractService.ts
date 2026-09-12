import fs from 'node:fs'
import path from 'node:path'
import ExcelJS from 'exceljs'
import PizZip from 'pizzip'
import type { ExtractContactParams, ExtractContactResult, ExtractKind } from '@shared/types'
import { cellText } from './fileUtils'
import { uniquePath } from './fileUtils'

export const EXTRACT_LABELS: Record<ExtractKind, string> = {
  phone: '手机号',
  idcard: '身份证号',
  email: '邮箱'
}

export const EXTRACT_PATTERNS: Record<ExtractKind, RegExp> = {
  phone: /(?<!\d)1[3-9]\d{9}(?!\d)/g,
  idcard: /(?<!\d)\d{17}[\dXx](?!\d)/g,
  email: /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g
}

/** 从一段文本里提取联系方式（纯函数，供测试）。idcard 先于 phone，避免长号被截断 */
export function extractContacts(text: string, kinds: ExtractKind[]): Record<ExtractKind, string[]> {
  const result: Record<ExtractKind, string[]> = { phone: [], idcard: [], email: [] }
  // 先抠出身份证号，防止后续规则把长数字串误吸
  let rest = text.replace(EXTRACT_PATTERNS.idcard, ' ')
  if (kinds.includes('idcard')) result.idcard = text.match(EXTRACT_PATTERNS.idcard) ?? []
  if (kinds.includes('phone')) result.phone = rest.match(EXTRACT_PATTERNS.phone) ?? []
  if (kinds.includes('email')) result.email = rest.match(EXTRACT_PATTERNS.email) ?? []
  return result
}

async function readTextSmart(p: string): Promise<string> {
  const buf = await fs.promises.readFile(p)
  const utf8 = buf.toString('utf-8').replace(/^\uFEFF/, '')
  // 出现替换符多半是 GBK 被按 UTF-8 解了
  if (!utf8.includes('\uFFFD')) return utf8
  const { default: iconv } = await import('iconv-lite')
  return iconv.decode(buf, 'gbk')
}

async function readDocxText(p: string): Promise<string> {
  const zip = new PizZip(await fs.promises.readFile(p))
  let xml = zip.file('word/document.xml')?.asText() ?? ''
  for (const f of zip.file(/^word\/(header|footer)\d*\.xml$/)) xml += f.asText()
  return xml.replace(/<[^>]+>/g, ' ')
}

async function readXlsxText(p: string): Promise<string> {
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.readFile(p)
  const parts: string[] = []
  wb.eachSheet(ws => {
    ws.eachRow(row => {
      row.eachCell({ includeEmpty: false }, cell => parts.push(cellText(cell.value)))
    })
  })
  return parts.join('\n')
}

async function readAnyText(p: string): Promise<string> {
  const ext = path.extname(p).toLowerCase()
  if (ext === '.docx') return readDocxText(p)
  if (ext === '.xlsx') return readXlsxText(p)
  return readTextSmart(p)
}

export async function extractAndSave(params: ExtractContactParams): Promise<ExtractContactResult> {
  if (params.paths.length === 0) throw new Error('请先选择文件')
  if (params.kinds.length === 0) throw new Error('请至少选择一种要提取的内容')
  const found: Record<ExtractKind, Set<string>> = {
    phone: new Set(),
    idcard: new Set(),
    email: new Set()
  }
  for (const p of params.paths) {
    const text = await readAnyText(p)
    const res = extractContacts(text, params.kinds)
    for (const kind of params.kinds) {
      for (const v of res[kind]) {
        if (params.dedupe === false) found[kind].add(`${v}#${found[kind].size}`)
        else found[kind].add(v)
      }
    }
  }
  const outputs: string[] = []
  const counts: ExtractContactResult['counts'] = []
  for (const kind of params.kinds) {
    const values = [...found[kind]].map(v => (params.dedupe === false ? v.split('#')[0] ?? v : v))
    if (values.length === 0) continue
    const content = values.join('\r\n') + '\r\n'
    const out = uniquePath(params.outDir, `${EXTRACT_LABELS[kind]}_${values.length}个.txt`)
    await fs.promises.writeFile(out, content, 'utf-8')
    outputs.push(out)
    counts.push({ kind, label: EXTRACT_LABELS[kind], count: values.length })
  }
  if (outputs.length === 0) throw new Error('没有在所选文件里找到目标内容')
  return { counts, outputs }
}
