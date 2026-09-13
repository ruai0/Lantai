import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

/**
 * 跨平台中文字体定位（PDF 中文水印 / 环境探测共用同一张清单）。
 * Windows：字体平铺在 %SystemRoot%\Fonts，按候选名精确命中。
 * Linux/麒麟：字体散落在多个目录且常带架构后缀，改为递归扫描 + 按优先级打分。
 * 纯函数（注入 fs/exists 与目录列表）便于单测，不依赖 electron。
 */

/** 与旧行为一致：Windows 字体目录下的候选（按水印优先级） */
export const WIN_CJK_FONTS = ['simhei.ttf', 'deng.ttf', 'simfang.ttf', 'simkai.ttf', 'STZHONGS.TTF']

/**
 * Linux/麒麟 常见中文字体文件名（按优先级）。
 * 优先单面 .otf/.ttf（fontkit 直接可嵌），.ttc 集合作为兜底（部分环境仅有 ttc）。
 */
export const LINUX_CJK_FONTS = [
  'NotoSansCJKsc-Regular.otf',
  'NotoSansCJK-Regular.ttc',
  'SourceHanSansSC-Regular.otf',
  'SourceHanSansCN-Regular.otf',
  'NotoSansSC-Regular.otf',
  'wqy-microhei.ttc',
  'wqy-zenhei.ttc',
  'simhei.ttf',
  'msyh.ttf'
]

/** 麒麟/UOS/通用 Linux 的字体搜索目录 */
export function linuxFontDirs(home = os.homedir()): string[] {
  return ['/usr/share/fonts', '/usr/local/share/fonts', path.join(home, '.fonts')]
}

/** 在完整路径列表里，按候选优先级挑第一个 basename 命中的字体绝对路径（大小写不敏感） */
export function pickFontByPaths(allPaths: string[], candidates: string[]): string | null {
  for (const name of candidates) {
    const lower = name.toLowerCase()
    const hit = allPaths.find(p => path.basename(p).toLowerCase() === lower)
    if (hit) return hit
  }
  return null
}

/** 递归收集目录下的字体文件绝对路径（限深，避免误扫超大树） */
export function collectFontFiles(root: string, exists: (p: string) => boolean, isDir: (p: string) => boolean, readDir: (p: string) => string[], maxDepth = 6): string[] {
  if (!exists(root)) return []
  const out: string[] = []
  const stack: Array<{ dir: string; depth: number }> = [{ dir: root, depth: 0 }]
  while (stack.length) {
    const { dir, depth } = stack.pop()!
    if (depth > maxDepth) continue
    let entries: string[]
    try {
      entries = readDir(dir)
    } catch {
      continue
    }
    for (const name of entries) {
      const full = path.join(dir, name)
      if (isDir(full)) stack.push({ dir: full, depth: depth + 1 })
      else if (/\.(ttf|otf|ttc)$/i.test(name)) out.push(full)
    }
  }
  return out
}

/**
 * 定位一个可嵌入的中文字体文件，返回绝对路径或 null。
 * win32 走平铺精确匹配，其余走 Linux 递归扫描。
 */
export function findCjkFont(platform: NodeJS.Platform = process.platform, deps?: { exists?: (p: string) => boolean; isDir?: (p: string) => boolean; readDir?: (p: string) => string[]; env?: NodeJS.ProcessEnv; home?: string }): string | null {
  const exists = deps?.exists ?? (p => fs.existsSync(p))
  const isDir = deps?.isDir ?? (p => { try { return fs.statSync(p).isDirectory() } catch { return false } })
  const readDir = deps?.readDir ?? (p => fs.readdirSync(p))

  if (platform === 'win32') {
    const dir = path.join(deps?.env?.SystemRoot ?? 'C:\\Windows', 'Fonts')
    const files = exists(dir) ? readDir(dir).map(f => path.join(dir, f)) : []
    return pickFontByPaths(files, WIN_CJK_FONTS)
  }

  const all: string[] = []
  for (const d of linuxFontDirs(deps?.home)) all.push(...collectFontFiles(d, exists, isDir, readDir))
  return pickFontByPaths(all, LINUX_CJK_FONTS)
}

/** 供 envProbe 使用：列出命中的候选字体文件名（按优先级），用于展示 watermarkReady */
export function listCjkFontNames(platform: NodeJS.Platform = process.platform, deps?: Parameters<typeof findCjkFont>[1]): string[] {
  const hit = findCjkFont(platform, deps)
  return hit ? [path.basename(hit)] : []
}
