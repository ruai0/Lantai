/**
 * PDF 大图裁剪：分数坐标 → CropBox 的换算纯函数单测。
 * 关键点：渲染视图 y 自顶向下，PDF 坐标自底向上，必须镜像；非法框要夹紧而不是把整页裁没。
 */
import { describe, expect, it } from 'vitest'
import { cropBoxFromFractions } from '../src/main/services/pdfService'

/** A4：595 × 842，原点 (0,0) */
const A4 = { x: 0, y: 0, width: 595, height: 842 }

describe('cropBoxFromFractions', () => {
  it('全页 = 不裁（框与 MediaBox 一致）', () => {
    const r = cropBoxFromFractions(A4, { x: 0, y: 0, w: 1, h: 1 })
    expect(r).toEqual({ x: 0, y: 0, width: 595, height: 842 })
  })

  it('裁掉顶部 10%（y 从 0.1 起）：y 仍为 0，高度少一成', () => {
    const r = cropBoxFromFractions(A4, { x: 0, y: 0.1, w: 1, h: 0.9 })
    expect(r.x).toBe(0)
    expect(r.width).toBe(595)
    // 顶部被裁掉：新框的顶边从 842 降到 757.8，底边不变
    expect(r.y).toBe(0)
    expect(r.height).toBeCloseTo(842 * 0.9, 5)
  })

  it('裁掉底部 10%（选区只覆盖上 90%）：y 上移一成，顶边不动', () => {
    const r = cropBoxFromFractions(A4, { x: 0, y: 0, w: 1, h: 0.9 })
    expect(r.y).toBeCloseTo(842 * 0.1, 5)
    expect(r.height).toBeCloseTo(842 * 0.9, 5)
  })

  it('只留中间 50%：四边各留 25%', () => {
    const r = cropBoxFromFractions(A4, { x: 0.25, y: 0.25, w: 0.5, h: 0.5 })
    expect(r.x).toBeCloseTo(595 * 0.25, 5)
    expect(r.width).toBeCloseTo(595 * 0.5, 5)
    expect(r.y).toBeCloseTo(842 * 0.25, 5)
    expect(r.height).toBeCloseTo(842 * 0.5, 5)
  })

  it('MediaBox 原点非 0（如 [-20, -10, 615, 852]）时正确偏移', () => {
    const mb = { x: -20, y: -10, width: 635, height: 862 }
    const r = cropBoxFromFractions(mb, { x: 0.1, y: 0.2, w: 0.8, h: 0.6 })
    expect(r.x).toBeCloseTo(-20 + 635 * 0.1, 5)
    expect(r.width).toBeCloseTo(635 * 0.8, 5)
    expect(r.y).toBeCloseTo(-10 + 862 * (1 - 0.2 - 0.6), 5)
    expect(r.height).toBeCloseTo(862 * 0.6, 5)
  })

  it('反选（拖过头的框）会自动转正，不会产生负宽高', () => {
    const r = cropBoxFromFractions(A4, { x: 0.8, y: 0.9, w: -0.5, h: -0.7 })
    expect(r.width).toBeGreaterThan(0)
    expect(r.height).toBeGreaterThan(0)
    expect(r.x).toBeGreaterThanOrEqual(A4.x)
    expect(r.y).toBeGreaterThanOrEqual(A4.y)
  })

  it('越界选区被夹紧到页面内，不会把整页裁没', () => {
    const r = cropBoxFromFractions(A4, { x: -0.5, y: -0.5, w: 2, h: 2 })
    expect(r.x).toBeGreaterThanOrEqual(0)
    expect(r.y).toBeGreaterThanOrEqual(0)
    expect(r.width).toBeLessThanOrEqual(595)
    expect(r.height).toBeLessThanOrEqual(842)
    expect(r.width).toBe(595)
    expect(r.height).toBe(842)
  })
})
