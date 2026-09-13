/**
 * 图片标注编辑（贴图 / 遮挡 / 裁剪）的纯计算函数。
 * 不依赖 DOM，方便用 vitest 直接覆盖几何与尺寸逻辑。
 */

export interface Rect {
  x: number
  y: number
  w: number
  h: number
}

export function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v))
}

/** 把任意起终点的拖拽框整理成 x/y 非负、宽高非负的矩形（支持从右下往左上拖） */
export function normalizeRect(x1: number, y1: number, x2: number, y2: number): Rect {
  return {
    x: Math.min(x1, x2),
    y: Math.min(y1, y2),
    w: Math.abs(x2 - x1),
    h: Math.abs(y2 - y1)
  }
}

/** 马赛克块数：按 cell 向上取整，至少 1×1，且不超过区域像素数（cell 小于 1 时逐像素） */
export function pixelGrid(w: number, h: number, cell: number): { cols: number; rows: number } {
  const c = Math.max(cell, 0.0001)
  return {
    cols: Math.max(1, Math.min(Math.ceil(w), Math.ceil(w / c))),
    rows: Math.max(1, Math.min(Math.ceil(h), Math.ceil(h / c)))
  }
}

/** 新贴图的默认尺寸：等比缩到不超过底图宽高的 30%，且不放大原图，最小 16px */
export function defaultStampSize(
  baseW: number,
  baseH: number,
  natW: number,
  natH: number
): { w: number; h: number } {
  const limit = Math.min(baseW, baseH) * 0.3
  const scale = Math.min(1, limit / Math.max(natW, natH, 1))
  return {
    w: Math.max(16, Math.round(natW * scale)),
    h: Math.max(16, Math.round(natH * scale))
  }
}

/** 等比缩放适配容器：完整显示且不超过 maxScale（适应窗口时通常封顶 1，避免小图被拉糊） */
export function fitScale(w: number, h: number, boxW: number, boxH: number, maxScale = 1): number {
  if (w <= 0 || h <= 0 || boxW <= 0 || boxH <= 0) return maxScale
  return clamp(Math.min(boxW / w, boxH / h), 0, maxScale)
}

/** 贴图右下角缩放把手命中判定：imgPoint 为图片坐标，handleSize 为屏幕像素半径折算到图片坐标 */
export function hitResizeHandle(
  stamp: { x: number; y: number; w: number; h: number },
  imgPoint: { x: number; y: number },
  handleSize: number
): boolean {
  const hx = stamp.x + stamp.w
  const hy = stamp.y + stamp.h
  return (
    imgPoint.x >= hx - handleSize &&
    imgPoint.x <= hx + handleSize &&
    imgPoint.y >= hy - handleSize &&
    imgPoint.y <= hy + handleSize
  )
}

/** 命中测试：点是否落在贴图矩形内（自上而下选择时按数组倒序遍历由调用方负责） */
export function hitStamp(
  stamp: { x: number; y: number; w: number; h: number },
  imgPoint: { x: number; y: number }
): boolean {
  return (
    imgPoint.x >= stamp.x &&
    imgPoint.x <= stamp.x + stamp.w &&
    imgPoint.y >= stamp.y &&
    imgPoint.y <= stamp.y + stamp.h
  )
}
