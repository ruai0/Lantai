/** main / renderer 共用的文件名工具（无 Node 依赖） */

export function sanitizeFilename(input: string): string {
  return input.replace(/[\\/:*?"<>|\r\n\t]/g, '_').trim()
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
