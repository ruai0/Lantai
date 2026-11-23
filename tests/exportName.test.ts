import { describe, expect, it } from 'vitest'
import { exportFilename, splitOutputTarget } from '../src/shared/namePattern'

/** 导出自定义文件名：留空回退、剥扩展名、非法字符清洗 */
describe('exportFilename', () => {
  it('留空或全是非法字符 → 回退默认名', () => {
    expect(exportFilename(undefined, '.pdf', 'PDF合并_x')).toBe('PDF合并_x.pdf')
    expect(exportFilename('   ', '.pdf', 'PDF合并_x')).toBe('PDF合并_x.pdf')
    expect(exportFilename('a/b:c*d', '.pdf', 'fb')).toBe('a_b_c_d.pdf')
  })

  it('剥掉用户顺手输入的扩展名（大小写不敏感），统一补回', () => {
    expect(exportFilename('季度报告.pdf', '.pdf', 'fb')).toBe('季度报告.pdf')
    expect(exportFilename('季度报告.PDF', '.pdf', 'fb')).toBe('季度报告.pdf')
    expect(exportFilename('台账.xlsx', '.xlsx', 'fb')).toBe('台账.xlsx')
    // 扩展名与目标不符时保留在名字里（不是误输入）
    expect(exportFilename('报告.docx', '.pdf', 'fb')).toBe('报告.docx.pdf')
  })

  it('中文、数字、空格正常保留；首尾空格去掉', () => {
    expect(exportFilename('  2026 年 1 月 报送件  ', '.pdf', 'fb')).toBe('2026 年 1 月 报送件.pdf')
  })

  it('防目录穿越：路径分隔符被清洗为下划线', () => {
    expect(exportFilename('../../windows', '.pdf', 'fb')).toBe('.._.._windows.pdf')
  })
})

describe('splitOutputTarget（输出位置可带文件名）', () => {
  it('纯目录与末尾斜杠 → 只出目录', () => {
    expect(splitOutputTarget('D:\\输出')).toEqual({ dir: 'D:\\输出' })
    expect(splitOutputTarget('D:\\输出\\')).toEqual({ dir: 'D:\\输出' })
    expect(splitOutputTarget('/tmp/out/')).toEqual({ dir: '/tmp/out' })
  })

  it('末段带扩展名 → 拆目录+文件名', () => {
    expect(splitOutputTarget('D:\\输出\\报告.pdf')).toEqual({ dir: 'D:\\输出', name: '报告.pdf' })
    expect(splitOutputTarget('/tmp/out/奖状.pptx')).toEqual({ dir: '/tmp/out', name: '奖状.pptx' })
  })

  it('目录名尾缀是纯数字点号（v1.2）不误判为文件', () => {
    expect(splitOutputTarget('D:\\release\\v1.2')).toEqual({ dir: 'D:\\release\\v1.2' })
  })

  it('只写文件名 → dir 为空串（调用方回退默认目录）', () => {
    expect(splitOutputTarget('报告.docx')).toEqual({ dir: '', name: '报告.docx' })
  })

  it('空输入 → dir 空串', () => {
    expect(splitOutputTarget('   ')).toEqual({ dir: '' })
  })
})
