/**
 * PDF 工作台「图片式标注」的共享纯函数：主进程导出与渲染进程绘制共用同一套口径，
 * 避免两边各写一份、改一头忘一头。坐标一律为 PDF 用户空间磅值（y 自底向上）。
 */
import type { PdfMosaicAnno } from './types'

/** 数字格式化：两位小数，接近 0 归一，避免内容流里出现 1e-21 这类脏值 */
export function fmtPt(n: number): string {
  const v = Math.abs(n) < 5e-3 ? 0 : n
  return (Math.round(v * 100) / 100).toString()
}

/** polyline 点集 → SVG path 字符串（M/L），供 pdf-lib drawSvgPath 使用 */
export function svgPolylinePath(points: number[]): string {
  if (points.length < 4) return ''
  let d = `M ${fmtPt(points[0])} ${fmtPt(points[1])}`
  for (let i = 2; i + 1 < points.length; i += 2) {
    d += ` L ${fmtPt(points[i])} ${fmtPt(points[i + 1])}`
  }
  return d
}

/** #rrggbb / #rgb → RGB 0~1；非法输入回退黑色 */
export function hexToRgb01(hex: string): [number, number, number] {
  const v = hex.replace('#', '').trim()
  const full = v.length === 3 ? v.split('').map(c => c + c).join('') : v
  if (!/^[0-9a-fA-F]{6}$/.test(full)) return [0, 0, 0]
  return [
    parseInt(full.slice(0, 2), 16) / 255,
    parseInt(full.slice(2, 4), 16) / 255,
    parseInt(full.slice(4, 6), 16) / 255
  ]
}

/** 0~255 整数三元组 → 0~1（画布采样结果转 pdf-lib 色值用） */
export function rgb255To01(r: number, g: number, b: number): [number, number, number] {
  return [r / 255, g / 255, b / 255]
}

/**
 * 把一块区域按 cell 大小切成马赛克网格，逐块取平均色。
 * rect：PDF 磅值矩形（x/y 为左下角，w/h 为正）；cellPt：块边长（磅值，<=0 时整块一块）。
 * sample：按矩形取平均色（渲染进程从画布采样；主进程/测试可注入）。
 */
export function mosaicBlocks(
  rect: { x: number; y: number; w: number; h: number },
  cellPt: number,
  sample: (x: number, y: number, w: number, h: number) => [number, number, number]
): PdfMosaicAnno[] {
  const w = Math.max(0, rect.w)
  const h = Math.max(0, rect.h)
  if (w <= 0 || h <= 0) return []
  const c = cellPt > 0 ? cellPt : Math.max(w, h)
  const cols = Math.max(1, Math.ceil(w / c))
  const rows = Math.max(1, Math.ceil(h / c))
  const bw = w / cols
  const bh = h / rows
  const out: PdfMosaicAnno[] = []
  for (let r = 0; r < rows; r++) {
    for (let col = 0; col < cols; col++) {
      const bx = rect.x + col * bw
      const by = rect.y + r * bh
      out.push({ kind: 'mosaic', color: sample(bx, by, bw, bh), x: bx, y: by, w: bw, h: bh })
    }
  }
  return out
}

/** 笔画采样点最小间距（磅值）：低于此距离的点丢弃，控制点稠度与文件体积 */
export const MIN_BRUSH_STEP_PT = 1.5

/** 是否值得落成一条笔画（至少两个点） */
export function isDrawableStroke(points: number[]): boolean {
  return points.length >= 4
}
