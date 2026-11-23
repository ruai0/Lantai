import fs from 'node:fs'
import path from 'node:path'
import ExcelJS from 'exceljs'
import iconv from 'iconv-lite'
import type { DataRecord } from '@shared/types'

export { sanitizeFilename, resolveNamePattern, exportFilename } from '@shared/namePattern'

/** 目录内重名时自动追加 (2)、(3)…，绝不覆盖已有文件；目录不存在则自动创建（输出目录被删/移动后任务不再裸抛 ENOENT） */
export function uniquePath(dir: string, filename: string): string {
  if (dir) fs.mkdirSync(dir, { recursive: true })
  const target = path.join(dir, filename)
  if (!fs.existsSync(target)) return target
  const ext = path.extname(filename)
  const stem = filename.slice(0, filename.length - ext.length)
  for (let i = 2; ; i++) {
    const candidate = path.join(dir, `${stem}(${i})${ext}`)
    if (!fs.existsSync(candidate)) return candidate
  }
}

export function stemOf(filePath: string): string {
  return path.basename(filePath, path.extname(filePath))
}

/**
 * 自然序比较（"文件2" < "文件10"，而非字典序的 "文件10" < "文件2"）。
 * 数字段按数值比较，其余按本地化比较（中文拼音序）。全项目统一口径，避免各处自实现。
 */
export function naturalCompare(a: string, b: string): number {
  const re = /(\d+)|(\D+)/g
  const ax = a.match(re) ?? []
  const bx = b.match(re) ?? []
  const len = Math.min(ax.length, bx.length)
  for (let i = 0; i < len; i++) {
    const x = ax[i]
    const y = bx[i]
    const xn = /^\d+$/.test(x)
    const yn = /^\d+$/.test(y)
    if (xn && yn) {
      const d = Number(x) - Number(y)
      if (d !== 0) return d
    } else {
      const c = x.localeCompare(y, 'zh-Hans-CN', { numeric: false })
      if (c !== 0) return c
    }
  }
  return ax.length - bx.length
}

/** 把 exceljs 单元格值转成字符串（兼容富文本 / 公式结果 / 超链接 / 日期） */
export function cellText(value: unknown): string {
  if (value === null || value === undefined) return ''
  if (value instanceof Date) return value.toISOString().slice(0, 10)
  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>
    if (Array.isArray(obj.richText)) {
      return (obj.richText as Array<{ text?: string }>).map(t => t.text ?? '').join('')
    }
    if ('result' in obj) return cellText(obj.result)
    if ('text' in obj) return cellText(obj.text)
    return ''
  }
  return String(value)
}

/**
 * 关联键 / 表头名归一化（全项目统一口径）：
 * 1. 去掉所有空白（含内部空格、全角空格）；
 * 2. 全角字母数字、常见全角标点转半角；
 * 3. 全角/半角括号、逗号等归一为统一形态；
 * 4. 忽略大小写（转小写）。
 * 用于跨表匹配、两表比对、多簿合并，避免「一个空格 / 全角括号 / 大小写差异」被当成两个键。
 */
export function normalizeKey(v: unknown): string {
  const s = cellText(v)
  const stripped = s
    // 全角空格
    .replace(/[\s\u3000]/g, '')
    // 全角 ASCII（！～）转半角
    .replace(/[\uff01-\uff5e]/g, ch => String.fromCharCode(ch.charCodeAt(0) - 0xfee0))
    // 全角括号（U+FF08/FF09）已在上一行转成 ()，这里兜底中文括号
    .replace(/[（]/g, '(')
    .replace(/[）]/g, ')')
    .replace(/[，]/g, ',')
    .replace(/[。]/g, '.')
    .toLowerCase()
  // 纯数字去掉多余的小数 .0（Excel 数值与文本混用）
  return /^\d+\.0+$/.test(stripped) ? stripped.split('.')[0] : stripped
}

/** 判断某个字符串是否包含需要归一化的字符（用于快速短路） */
export function needsNormalize(v: string): boolean {
  return /[\uff01-\uff5e\s\u3000（）]/.test(v) || /[A-Z]/.test(v)
}

/** 替换文本中的 {字段} 占位符；数据里没有的字段保持原样 */
export function replacePlaceholders(text: string, rec: DataRecord): string {
  return text.replace(/\{([^{}]+)\}/g, (whole, key: string) => {
    const k = key.trim()
    return k in rec ? rec[k] : whole
  })
}

/**
 * 读数据源文件：.json（对象数组）、.xlsx（第 1 行为字段名）或 .csv/.txt（首行表头）。
 * csv 默认按 UTF-8 读；运营老系统导出的 GBK 文本可用 encoding='gbk'。
 */
export async function readDataRecords(
  dataPath: string,
  opts?: { encoding?: 'utf8' | 'gbk'; headerRow?: number; sheet?: string }
): Promise<DataRecord[]> {
  const ext = path.extname(dataPath).toLowerCase()
  if (ext === '.json') {
    let parsed: unknown
    try {
      parsed = JSON.parse(await fs.promises.readFile(dataPath, 'utf-8'))
    } catch {
      throw new Error('JSON 数据文件解析失败，请检查格式')
    }
    if (!Array.isArray(parsed) || parsed.length === 0) {
      throw new Error('JSON 数据需要是非空的对象数组，如 [{"姓名":"张三"}]')
    }
    return parsed.map((item, i) => jsonToRecord(item, i))
  }
  if (ext === '.xlsx') return readXlsxRecords(dataPath, opts?.headerRow ?? 1, opts?.sheet)
  if (ext === '.csv' || ext === '.txt' || ext === '.tsv') return readCsvRecords(dataPath, opts?.encoding ?? 'utf8')
  throw new Error('数据文件仅支持 .xlsx / .csv / .json')
}

/** 读 CSV/TSV 数据源（首行表头）；支持引号包裹与转义 */
async function readCsvRecords(dataPath: string, encoding: 'utf8' | 'gbk'): Promise<DataRecord[]> {
  const buf = await fs.promises.readFile(dataPath)
  const text = (encoding === 'gbk' ? iconvDecode(buf) : buf.toString('utf-8')).replace(/^\uFEFF/, '')
  if (!text.trim()) throw new Error(`数据文件是空的：${path.basename(dataPath)}`)
  const firstLine = text.split(/\r?\n/, 1)[0] ?? ''
  const delim = pickDelimiter(firstLine, path.extname(dataPath).toLowerCase() === '.tsv')
  const rows = parseDelimited(text, delim)
  if (rows.length < 2) throw new Error('CSV 需要至少一行表头 + 一行数据')
  const headers = rows[0].map(h => h.trim())
  if (headers.filter(Boolean).length === 0) throw new Error('CSV 第一行需要是字段名（表头）')
  const records: DataRecord[] = []
  for (let r = 1; r < rows.length; r++) {
    const row = rows[r]
    if (row.every(v => v.trim() === '')) continue
    const rec: DataRecord = {}
    headers.forEach((h, i) => {
      if (h) rec[h] = (row[i] ?? '').trim()
    })
    records.push(rec)
  }
  if (records.length === 0) throw new Error('数据文件除表头外没有有效数据行')
  return records
}

/** 猜测分隔符（逗号 / 制表符 / 分号），tsv 直接制表符 */
function pickDelimiter(line: string, forceTab: boolean): string {
  if (forceTab) return '\t'
  const cands: Array<[string, number]> = [
    [',', line.split(',').length - 1],
    ['\t', line.split('\t').length - 1],
    [';', line.split(';').length - 1]
  ]
  cands.sort((a, b) => b[1] - a[1])
  return cands[0][1] > 0 ? cands[0][0] : ','
}

/** 解析分隔文本为二维数组（支持双引号包裹、转义引号与字段内换行） */
function parseDelimited(text: string, delim: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let inQuotes = false
  let i = 0
  while (i < text.length) {
    const ch = text[i]
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"'
          i += 2
          continue
        }
        inQuotes = false
        i++
        continue
      }
      field += ch
      i++
      continue
    }
    if (ch === '"') {
      inQuotes = true
      i++
      continue
    }
    if (ch === delim) {
      row.push(field)
      field = ''
      i++
      continue
    }
    if (ch === '\r') {
      i++
      continue
    }
    if (ch === '\n') {
      row.push(field)
      field = ''
      rows.push(row)
      row = []
      i++
      continue
    }
    field += ch
    i++
  }
  if (field !== '' || row.length > 0) {
    row.push(field)
    rows.push(row)
  }
  return rows
}

/** GBK 解码 */
function iconvDecode(buf: Buffer): string {
  return iconv.decode(buf, 'gbk')
}

/** 把二维数组/记录写成 CSV 文本（含表头；自动处理逗号、引号、换行转义） */
export function recordsToCsv(headers: string[], rows: Array<Array<string | number>>): string {
  const esc = (v: string | number): string => {
    const s = v === null || v === undefined ? '' : String(v)
    return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  const lines = [headers.map(esc).join(',')]
  for (const row of rows) lines.push(row.map(esc).join(','))
  return '\uFEFF' + lines.join('\r\n')
}

async function readXlsxRecords(dataPath: string, headerRow = 1, sheet?: string): Promise<DataRecord[]> {
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.readFile(dataPath)
  const ws = sheet ? wb.getWorksheet(sheet) : wb.worksheets[0]
  if (!ws) throw new Error('数据文件里没有工作表')
  const hr = Math.max(1, headerRow)
  const headers = new Map<number, string>()
  ws.getRow(hr).eachCell((cell, col) => {
    const name = cellText(cell.value).trim()
    if (name) headers.set(col, name)
  })
  if (headers.size === 0) throw new Error(`数据文件第 ${hr} 行需要是字段名（表头）`)
  const records: DataRecord[] = []
  for (let r = hr + 1; r <= ws.rowCount; r++) {
    const row = ws.getRow(r)
    const rec: DataRecord = {}
    let nonEmpty = false
    for (const [col, name] of headers) {
      const v = cellText(row.getCell(col).value)
      if (v !== '') nonEmpty = true
      rec[name] = v
    }
    if (nonEmpty) records.push(rec)
  }
  if (records.length === 0) throw new Error('数据文件除表头外没有有效数据行')
  return records
}

function jsonToRecord(item: unknown, index: number): DataRecord {
  if (typeof item !== 'object' || item === null) {
    throw new Error(`JSON 数据第 ${index + 1} 项不是对象`)
  }
  const out: DataRecord = {}
  for (const [k, v] of Object.entries(item as Record<string, unknown>)) {
    out[k] = cellText(v)
  }
  return out
}
