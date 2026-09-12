import { describe, expect, it } from 'vitest'
import { parseRanges } from '../src/main/services/rangeUtils'

describe('parseRanges', () => {
  it('解析单页与区间混合', () => {
    expect(parseRanges('1-3,5', 10)).toEqual([0, 1, 2, 4])
  })

  it('开区间到末尾', () => {
    expect(parseRanges('8-', 10)).toEqual([7, 8, 9])
  })

  it('支持中文逗号、顿号与空白分隔', () => {
    expect(parseRanges('1，2、3 4', 10)).toEqual([0, 1, 2, 3])
  })

  it('去重并升序', () => {
    expect(parseRanges('5,1-3,2', 10)).toEqual([0, 1, 2, 4])
  })

  it('开区间覆盖全部页', () => {
    expect(parseRanges('1-', 3)).toEqual([0, 1, 2])
  })

  it('拒绝非法 token', () => {
    expect(() => parseRanges('abc', 10)).toThrow('无法识别的页码')
  })

  it('拒绝越界页码', () => {
    expect(() => parseRanges('11', 10)).toThrow('超出范围')
  })

  it('拒绝颠倒区间', () => {
    expect(() => parseRanges('5-2', 10)).toThrow('区间颠倒')
  })

  it('空输入报错', () => {
    expect(() => parseRanges('  ', 10)).toThrow('页码不能为空')
  })
})
