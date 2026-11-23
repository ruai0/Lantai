/** 解析页码表达式（如 "1-3,5,8-"）为 0-based 页索引数组，去重并升序 */
export function parseRanges(input: string, total: number): number[] {
  const trimmed = input.trim()
  if (!trimmed) throw new Error('页码不能为空')
  const tokens = trimmed.split(/[,，、\s]+/).filter(Boolean)
  const set = new Set<number>()
  for (const token of tokens) {
    const m = /^(\d+)(?:-(\d*))?$/.exec(token)
    if (!m) throw new Error(`无法识别的页码「${token}」，支持格式：3、5-8、10-`)
    const start = Number(m[1])
    const end = m[2] === undefined ? start : m[2] === '' ? total : Number(m[2])
    if (start < 1 || start > total) throw new Error(`页码 ${start} 超出范围（文档共 ${total} 页）`)
    if (end < 1 || end > total) throw new Error(`页码 ${end} 超出范围（文档共 ${total} 页）`)
    if (end < start) throw new Error(`页码区间颠倒：${token}`)
    for (let p = start; p <= end; p++) set.add(p - 1)
  }
  return [...set].sort((a, b) => a - b)
}
