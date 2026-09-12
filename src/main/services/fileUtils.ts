import fs from 'node:fs'
import path from 'node:path'
import ExcelJS from 'exceljs'
import type { DataRecord } from '@shared/types'

export { sanitizeFilename, resolveNamePattern } from '@shared/namePattern'

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

/** 替换文本中的 {字段} 占位符；数据里没有的字段保持原样 */
export function replacePlaceholders(text: string, rec: DataRecord): string {
  return text.replace(/\{([^{}]+)\}/g, (whole, key: string) => {
    const k = key.trim()
    return k in rec ? rec[k] : whole
  })
}

/** 读数据源文件：.json（对象数组）或 .xlsx（第 1 行为字段名） */
export async function readDataRecords(dataPath: string): Promise<DataRecord[]> {
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
  if (ext === '.xlsx') return readXlsxRecords(dataPath)
  throw new Error('数据文件仅支持 .xlsx 或 .json')
}

async function readXlsxRecords(dataPath: string): Promise<DataRecord[]> {
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.readFile(dataPath)
  const ws = wb.worksheets[0]
  if (!ws) throw new Error('数据文件里没有工作表')
  const headers = new Map<number, string>()
  ws.getRow(1).eachCell((cell, col) => {
    const name = cellText(cell.value).trim()
    if (name) headers.set(col, name)
  })
  if (headers.size === 0) throw new Error('数据文件第 1 行需要是字段名（表头）')
  const records: DataRecord[] = []
  for (let r = 2; r <= ws.rowCount; r++) {
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
