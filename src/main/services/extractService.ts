import fs from 'node:fs'
import path from 'node:path'
import ExcelJS from 'exceljs'
import PizZip from 'pizzip'
import type { ExtractContactParams, ExtractContactResult, ExtractKind } from '@shared/types'
import { cellText } from './fileUtils'
import { sanitizeFilename, uniquePath } from './fileUtils'

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

/** 身份证号校验位（GB 11643-1999），用于过滤订单号/流水号等 18 位干扰串 */
const ID_WEIGHTS = [7, 9, 10, 5, 8, 4, 2, 1, 6, 3, 7, 9, 10, 5, 8, 4, 2]
const ID_CHECK = ['1', '0', 'X', '9', '8', '7', '6', '5', '4', '3', '2']

export function isValidIdCard(id: string): boolean {
  const s = id.trim().toUpperCase()
  if (!/^\d{17}[\dX]$/.test(s)) return false
  const year = Number(s.slice(6, 10))
  const month = Number(s.slice(10, 12))
  const day = Number(s.slice(12, 14))
  if (year < 1900 || year > 2100 || month < 1 || month > 12 || day < 1 || day > 31) return false
  let sum = 0
  for (let i = 0; i < 17; i++) sum += Number(s[i]) * ID_WEIGHTS[i]
  return ID_CHECK[sum % 11] === s[17]
}

/** 从一段文本里提取联系方式（纯函数，供测试）。idcard 先于 phone，避免长号被截断；
 *  idcard 额外做校验位/日期校验，避免把订单号、流水号误当证件号。 */
export function extractContacts(text: string, kinds: ExtractKind[]): Record<ExtractKind, string[]> {
  const result: Record<ExtractKind, string[]> = { phone: [], idcard: [], email: [] }
  // 先抠出身份证号，防止后续规则把长数字串误吸
  let rest = text
  if (kinds.includes('idcard')) {
    result.idcard = (text.match(EXTRACT_PATTERNS.idcard) ?? []).filter(isValidIdCard)
  }
  rest = rest.replace(EXTRACT_PATTERNS.idcard, ' ')
  if (kinds.includes('phone')) result.phone = rest.match(EXTRACT_PATTERNS.phone) ?? []
  if (kinds.includes('email')) result.email = rest.match(EXTRACT_PATTERNS.email) ?? []
  return result
}

/** 累计多段文本的提取结果（带跨来源去重），供文件提取与预抽文本提取共用 */
function accumulate(
  text: string,
  kinds: ExtractKind[],
  dedupe: boolean,
  seen: Record<ExtractKind, Set<string>>,
  values: Record<ExtractKind, string[]>
): void {
  const res = extractContacts(text, kinds)
  for (const kind of kinds) {
    for (const v of res[kind]) {
      if (dedupe) {
        if (seen[kind].has(v)) continue
        seen[kind].add(v)
      }
      values[kind].push(v)
    }
  }
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
  const presets = params.texts ?? []
  if (params.paths.length === 0 && presets.length === 0) throw new Error('请先选择文件')
  if (params.kinds.length === 0) throw new Error('请至少选择一种要提取的内容')
  const seen: Record<ExtractKind, Set<string>> = {
    phone: new Set(),
    idcard: new Set(),
    email: new Set()
  }
  const values: Record<ExtractKind, string[]> = { phone: [], idcard: [], email: [] }
  const failed: Array<{ name: string; reason: string }> = []
  const dedupe = params.dedupe !== false
  // 先处理渲染进程预抽好的文本（PDF 文本层），再处理磁盘文件
  for (const item of presets) accumulate(item.text, params.kinds, dedupe, seen, values)
  for (const p of params.paths) {
    let text: string
    try {
      text = await readAnyText(p)
    } catch (e) {
      // 单个坏文件不再拖垮整批
      failed.push({ name: path.basename(p), reason: e instanceof Error ? e.message : String(e) })
      continue
    }
    accumulate(text, params.kinds, dedupe, seen, values)
  }
  const outputs: string[] = []
  const counts: ExtractContactResult['counts'] = []
  for (const kind of params.kinds) {
    const list = values[kind]
    if (list.length === 0) continue
    const content = list.join('\r\n') + '\r\n'
    // 前缀模式：每类一个 txt（一次任务可能出手机号/证件号/姓名多个文件，单名不适用）
    const prefix = sanitizeFilename((params.name ?? '').trim())
    const out = uniquePath(params.outDir, prefix ? `${prefix}_${EXTRACT_LABELS[kind]}.txt` : `${EXTRACT_LABELS[kind]}_${list.length}个.txt`)
    // 编码可选：内网台账习惯 GBK，默认 UTF-8；统一走 iconv 以避免记事本/旧版 Excel 乱码
    const buf =
      params.encoding === 'gbk'
        ? (await import('iconv-lite')).default.encode(content, 'gbk')
        : Buffer.from(content, 'utf-8')
    await fs.promises.writeFile(out, buf)
    outputs.push(out)
    counts.push({ kind, label: EXTRACT_LABELS[kind], count: list.length })
  }
  if (outputs.length === 0) {
    if (failed.length) {
      throw new Error(`所有文件都读取失败：${failed.map(f => `${f.name}（${f.reason}）`).join('；')}`)
    }
    throw new Error('没有在所选文件里找到目标内容')
  }
  return { counts, outputs, failed }
}
