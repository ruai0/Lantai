import { describe, expect, it } from 'vitest'
import {
  clamp,
  defaultStampSize,
  fitScale,
  hitResizeHandle,
  hitStamp,
  normalizeRect,
  pixelGrid
} from '../src/renderer/src/utils/imageEdit'

describe('clamp', () => {
  it('落在区间内时原样返回，越界时收边', () => {
    expect(clamp(5, 0, 10)).toBe(5)
    expect(clamp(-3, 0, 10)).toBe(0)
    expect(clamp(99, 0, 10)).toBe(10)
  })
})

describe('normalizeRect', () => {
  it('从左上向右下拖拽', () => {
    expect(normalizeRect(10, 20, 60, 90)).toEqual({ x: 10, y: 20, w: 50, h: 70 })
  })
  it('从右下向左上拖拽同样成立', () => {
    expect(normalizeRect(60, 90, 10, 20)).toEqual({ x: 10, y: 20, w: 50, h: 70 })
  })
  it('零尺寸拖拽不产生负值', () => {
    expect(normalizeRect(30, 30, 30, 30)).toEqual({ x: 30, y: 30, w: 0, h: 0 })
  })
})

describe('pixelGrid', () => {
  it('按块大小向上取整', () => {
    expect(pixelGrid(100, 60, 14)).toEqual({ cols: 8, rows: 5 })
  })
  it('cell 大于区域时至少 1×1', () => {
    expect(pixelGrid(10, 8, 32)).toEqual({ cols: 1, rows: 1 })
  })
  it('cell 极小时不超过逐像素', () => {
    expect(pixelGrid(10, 8, 0.01)).toEqual({ cols: 10, rows: 8 })
  })
})

describe('defaultStampSize', () => {
  it('大贴图等比缩到底图短边的 30%', () => {
    const s = defaultStampSize(1000, 800, 500, 250)
    expect(s).toEqual({ w: 240, h: 120 })
  })
  it('小贴图不放大', () => {
    expect(defaultStampSize(2000, 1500, 80, 40)).toEqual({ w: 80, h: 40 })
  })
  it('异常输入也有最小尺寸兜底', () => {
    const s = defaultStampSize(0, 0, 0, 0)
    expect(s.w).toBeGreaterThanOrEqual(16)
    expect(s.h).toBeGreaterThanOrEqual(16)
  })
})

describe('fitScale', () => {
  it('宽高比取更受限的一边', () => {
    expect(fitScale(2000, 1000, 500, 400)).toBeCloseTo(0.25)
  })
  it('默认封顶 1，小图不放大', () => {
    expect(fitScale(200, 100, 800, 600)).toBe(1)
  })
  it('允许放大时可超过 1', () => {
    expect(fitScale(200, 100, 800, 600, 8)).toBeCloseTo(4)
  })
  it('非法输入返回 maxScale', () => {
    expect(fitScale(0, 100, 800, 600)).toBe(1)
  })
})

describe('命中测试', () => {
  const stamp = { x: 100, y: 100, w: 50, h: 40 }
  it('点在贴图内命中', () => {
    expect(hitStamp(stamp, { x: 120, y: 110 })).toBe(true)
  })
  it('点在贴图外不命中', () => {
    expect(hitStamp(stamp, { x: 200, y: 110 })).toBe(false)
  })
  it('右下角把手在容差内命中', () => {
    expect(hitResizeHandle(stamp, { x: 152, y: 142 }, 6)).toBe(true)
    expect(hitResizeHandle(stamp, { x: 120, y: 110 }, 6)).toBe(false)
  })
})
