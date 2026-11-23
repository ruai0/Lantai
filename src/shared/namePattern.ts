/** main / renderer 共用的文件名工具（无 Node 依赖） */

export function sanitizeFilename(input: string): string {
  return input.replace(/[\\/:*?"<>|\r\n\t]/g, '_').trim()
}

/**
 * 用户自定义导出名 → 最终文件名：去首尾空格、剥掉用户顺手输入的扩展名、清洗非法字符；
 * 清洗后为空则回退 fallback。重名防撞由调用侧 uniquePath 负责。
 */
export function exportFilename(raw: string | undefined, ext: string, fallback: string): string {
  let name = (raw ?? '').trim()
  if (name.toLowerCase().endsWith(ext)) name = name.slice(0, -ext.length).trim()
  name = sanitizeFilename(name)
  return `${name || fallback}${ext}`
}

/**
 * 解析「输出位置」文本 → 目录 + 可选文件名：
 * 末段带字母开头的扩展名（报告.pdf）视为文件名；纯数字尾缀（目录 v1.2）与末尾斜杠按目录处理；
 * 只写了「报告.pdf」时 dir 为空串，由调用方回退默认输出目录或提示补全。
 */
export function splitOutputTarget(p: string): { dir: string; name?: string } {
  const t = (p ?? '').trim().replace(/[/\\]+$/, '')
  if (!t) return { dir: '' }
  const i = Math.max(t.lastIndexOf('/'), t.lastIndexOf('\\'))
  const base = t.slice(i + 1)
  if (/\.[A-Za-z][A-Za-z0-9]{0,9}$/.test(base)) {
    return { dir: i >= 0 ? t.slice(0, i) : '', name: base }
  }
  return { dir: t }
}

/** 按文件名模式生成输出名，如 "通知书_{姓名}"；结果为空时回退 fallbackBase_序号 */
export function resolveNamePattern(
  pattern: string | undefined,
  rec: Record<string, string>,
  index: number,
  fallbackBase: string
): string {
  let name = ''
  if (pattern && pattern.trim()) {
    name = pattern.trim().replace(/\{([^{}]+)\}/g, (_whole, key: string) => {
      const k = key.trim()
      return k in rec ? rec[k] : ''
    })
  }
  name = sanitizeFilename(name)
  if (!name) name = sanitizeFilename(`${fallbackBase}_${index + 1}`)
  return name
}

/**
 * 校验文件名模式里的占位符是否都能在样本记录里命中。
 * 返回未命中的字段名数组（去重）；用户写了 {错字段} 时调用方据此提示，而不是静默生成 "通知书_ xxx"。
 */
export function findMissingPatternFields(
  pattern: string | undefined,
  sample: Record<string, unknown> | undefined
): string[] {
  if (!pattern || !sample) return []
  const keys = new Set(Object.keys(sample))
  const missing = new Set<string>()
  for (const m of pattern.matchAll(/\{([^{}]+)\}/g)) {
    const k = m[1].trim()
    if (k && !keys.has(k)) missing.add(k)
  }
  return [...missing]
}
