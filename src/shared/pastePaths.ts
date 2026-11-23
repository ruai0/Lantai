/** 粘贴路径解析：把用户从资源管理器/Excel 里复制来的文本切成一条条路径（纯函数，可单测） */

/**
 * 常见粘贴形态：
 * - 每行一个路径（Windows 复制文件默认这种）
 * - 带引号的路径 "C:\a b\c.pdf"（Excel 单元格、PowerShell 复制）
 * - 分号或逗号分隔的一长串（资源管理器地址栏、某些导出）
 * - 首尾多余空白/空行
 */
export function parsePastedPaths(raw: string): string[] {
  if (!raw) return []
  const out: string[] = []
  const push = (s: string): void => {
    const t = s.trim().replace(/^["']|["']$/g, '').trim()
    if (t) out.push(t)
  }
  // 先按行切；引号内的换行（罕见）会被当分隔，可接受
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed) continue
    if (trimmed.startsWith('"')) {
      // "C:\a b\c.pdf" "C:\d\e.pdf"  → 按引号段解析，允许空格
      const re = /"([^"]*)"/g
      let m: RegExpExecArray | null
      let matched = false
      while ((m = re.exec(trimmed))) {
        push(m[1])
        matched = true
      }
      if (matched) continue
      push(trimmed)
      continue
    }
    // 一行内多个分号/逗号分隔
    for (const part of trimmed.split(/[;,，；]/)) push(part)
  }
  // 去重保序
  return [...new Set(out)]
}

/** 粗略判断是不是个路径（含盘符或以 \ / 分隔）；用于"没粘到路径就给提示" */
export function looksLikePaths(lines: string[]): boolean {
  if (!lines.length) return false
  return lines.every(l => /^[a-zA-Z]:[\\/]/.test(l) || l.startsWith('\\\\') || l.includes('\\') || l.includes('/'))
}
