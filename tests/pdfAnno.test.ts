/**
 * PDF 工作台「图片式标注」共享纯函数单测。
 * 关键点：SVG path 的数字必须干净（两位小数、-0 归一），马赛克网格必须整块无缝平铺，
 * 颜色换算三种写法口径一致——这些错了导出内容流就是废的。
 */
import { describe, expect, it } from 'vitest'
import {
  fmtPt,
  hexToRgb01,
  isDrawableStroke,
  MIN_BRUSH_STEP_PT,
  mosaicBlocks,
  rgb255To01,
  svgPolylinePath
} from '../src/shared/pdfAnno'

describe('fmtPt', () => {
  it('保留两位小数', () => {
    expect(fmtPt(12.3456)).toBe('12.35')
    expect(fmtPt(100)).toBe('100')
  })
  it('接近 0 的值归一为 0，不输出 -0', () => {
    expect(fmtPt(-0.001)).toBe('0')
    expect(fmtPt(0)).toBe('0')
  })
  it('整数不带小数点尾巴', () => {
    expect(fmtPt(595)).toBe('595')
  })
})

describe('svgPolylinePath', () => {
  it('单个点不成笔画', () => {
    expect(svgPolylinePath([10, 20])).toBe('')
  })
  it('两个点 = M + L', () => {
    expect(svgPolylinePath([10, 20, 30, 40])).toBe('M 10 20 L 30 40')
  })
  it('多点按序拼接，坐标取两位小数', () => {
    expect(svgPolylinePath([1, 2, 3.456, 4, 5, 6])).toBe('M 1 2 L 3.46 4 L 5 6')
    expect(svgPolylinePath([1.239, 2, 3.456, 4])).toBe('M 1.24 2 L 3.46 4')
  })
  it('奇数个坐标时忽略最后一个落单值', () => {
    expect(svgPolylinePath([1, 2, 3, 4, 5])).toBe('M 1 2 L 3 4')
  })
})

describe('hexToRgb01', () => {
  it('六位写法', () => {
    expect(hexToRgb01('#000000')).toEqual([0, 0, 0])
    expect(hexToRgb01('#ffffff')).toEqual([1, 1, 1])
    expect(hexToRgb01('#1677ff')).toEqual([22 / 255, 119 / 255, 1])
  })
  it('三位缩写展开', () => {
    expect(hexToRgb01('#f00')).toEqual([1, 0, 0])
  })
  it('非法输入回退黑色，不抛异常', () => {
    expect(hexToRgb01('#xyz')).toEqual([0, 0, 0])
    expect(hexToRgb01('')).toEqual([0, 0, 0])
  })
})

describe('rgb255To01', () => {
  it('整数三元组转 0~1', () => {
    expect(rgb255To01(255, 0, 128)).toEqual([1, 0, 128 / 255])
  })
})

describe('mosaicBlocks', () => {
  const stub = (): [number, number, number] => [0.5, 0.5, 0.5]

  it('按块大小向上取整，块与块无缝平铺原区域', () => {
    const blocks = mosaicBlocks({ x: 0, y: 0, w: 100, h: 50 }, 10, stub)
    expect(blocks).toHaveLength(50)
    // 第一块从左下角开始
    expect(blocks[0]).toMatchObject({ x: 0, y: 0, w: 10, h: 10 })
    // 总覆盖 = 原区域（10 列 × 10 宽、5 行 × 10 高）
    expect(blocks.reduce((s, b) => s + b.w * b.h, 0)).toBeCloseTo(100 * 50, 6)
  })

  it('不能整除时最后一块到区域边缘，不越界', () => {
    const blocks = mosaicBlocks({ x: 10, y: 20, w: 25, h: 25 }, 10, stub)
    expect(blocks).toHaveLength(9) // ceil(25/10)=3 → 3×3
    const maxX = Math.max(...blocks.map(b => b.x + b.w))
    const maxY = Math.max(...blocks.map(b => b.y + b.h))
    expect(maxX).toBeCloseTo(35, 6)
    expect(maxY).toBeCloseTo(45, 6)
  })

  it('cell 非正数 = 整块一块', () => {
    const blocks = mosaicBlocks({ x: 0, y: 0, w: 80, h: 60 }, 0, stub)
    expect(blocks).toHaveLength(1)
    expect(blocks[0]).toMatchObject({ x: 0, y: 0, w: 80, h: 60 })
  })

  it('sampler 收到的是每个子块矩形（PDF 坐标，y 向上）', () => {
    const seen: Array<{ x: number; y: number; w: number; h: number }> = []
    mosaicBlocks({ x: 0, y: 0, w: 20, h: 20 }, 10, (x, y, w, h) => {
      seen.push({ x, y, w, h })
      return [0, 0, 0]
    })
    expect(seen).toEqual([
      { x: 0, y: 0, w: 10, h: 10 },
      { x: 10, y: 0, w: 10, h: 10 },
      { x: 0, y: 10, w: 10, h: 10 },
      { x: 10, y: 10, w: 10, h: 10 }
    ])
  })

  it('sampler 的颜色原样落到块上', () => {
    let i = 0
    const blocks = mosaicBlocks({ x: 5, y: 5, w: 10, h: 10 }, 10, () => [i++ / 255, 0, 1])
    expect(blocks[0].color).toEqual([0, 0, 1])
  })

  it('零尺寸区域不产生块', () => {
    expect(mosaicBlocks({ x: 0, y: 0, w: 0, h: 10 }, 10, stub)).toEqual([])
    expect(mosaicBlocks({ x: 0, y: 0, w: -5, h: 10 }, 10, stub)).toEqual([])
  })
})

describe('笔画门槛', () => {
  it('采样间距下限为正数', () => {
    expect(MIN_BRUSH_STEP_PT).toBeGreaterThan(0)
  })
  it('至少两个点才成笔画', () => {
    expect(isDrawableStroke([1, 2])).toBe(false)
    expect(isDrawableStroke([1, 2, 3, 4])).toBe(true)
  })
})
