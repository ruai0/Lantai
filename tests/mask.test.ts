import { describe, expect, it } from 'vitest'
import { maskValue } from '../src/main/services/excelToolsService'

describe('maskValue', () => {
  it('手机号保留前3后4', () => {
    expect(maskValue('13812345678', 'phone')).toBe('138****5678')
  })

  it('证件号保留前4后4', () => {
    expect(maskValue('330102199001011234', 'idcard')).toBe('3301**********1234')
  })

  it('姓名：两字保留姓，三字及以上保留姓与末字', () => {
    expect(maskValue('张三', 'name')).toBe('张*')
    expect(maskValue('张三丰', 'name')).toBe('张*丰')
    expect(maskValue('欧阳娜娜', 'name')).toBe('欧**娜')
  })

  it('自定义保留位数', () => {
    expect(maskValue('ABCDEFGH', 'custom', 2, 2)).toBe('AB****GH')
    expect(maskValue('ABCDEFGH', 'custom', 0, 0)).toBe('********')
    // 保留位覆盖全部字符时无可打码部分，原样返回
    expect(maskValue('AB', 'custom', 1, 1)).toBe('AB')
  })

  it('保留位数超过长度时全部保留并打码剩余', () => {
    expect(maskValue('123', 'custom', 5, 5)).toBe('123')
  })

  it('空值与空白原样返回', () => {
    expect(maskValue('', 'phone')).toBe('')
    expect(maskValue('   ', 'phone')).toBe('')
  })

  it('非字符串数字按文本处理', () => {
    expect(maskValue('13812345678', 'custom', 3, 4)).toBe('138****5678')
  })
})
