import { describe, expect, it } from 'vitest'
import { looksLikePaths, parsePastedPaths } from '../src/shared/pastePaths'

describe('粘贴路径解析 parsePastedPaths', () => {
  it('空/纯空白返回空数组', () => {
    expect(parsePastedPaths('')).toEqual([])
    expect(parsePastedPaths('   \n  \n ')).toEqual([])
  })

  it('每行一个路径（Windows 复制文件的默认形态）', () => {
    expect(parsePastedPaths('C:\\a\\b.pdf\nD:\\c\\d.pdf\n')).toEqual(['C:\\a\\b.pdf', 'D:\\c\\d.pdf'])
  })

  it('带引号的路径保留空格', () => {
    expect(parsePastedPaths('"C:\\my docs\\a b.pdf"\n"C:\\my docs\\c d.pdf"')).toEqual([
      'C:\\my docs\\a b.pdf',
      'C:\\my docs\\c d.pdf'
    ])
  })

  it('半角与全角分号、逗号分隔都能切', () => {
    expect(parsePastedPaths('C:\\a.pdf,D:\\b.pdf;C:\\c.pdf，D:\\d.pdf；C:\\e.pdf')).toEqual([
      'C:\\a.pdf',
      'D:\\b.pdf',
      'C:\\c.pdf',
      'D:\\d.pdf',
      'C:\\e.pdf'
    ])
  })

  it('去重且保持出现顺序', () => {
    expect(parsePastedPaths('C:\\a.pdf\nC:\\a.pdf\nD:\\b.pdf\nC:\\a.pdf')).toEqual(['C:\\a.pdf', 'D:\\b.pdf'])
  })

  it('去掉首尾空白', () => {
    expect(parsePastedPaths('   C:\\a.pdf   \n\tD:\\b.pdf\t')).toEqual(['C:\\a.pdf', 'D:\\b.pdf'])
  })

  it('UNC 网络路径按单行保留', () => {
    expect(parsePastedPaths('\\\\server\\share\\a.pdf')).toEqual(['\\\\server\\share\\a.pdf'])
  })
})

describe('粘贴内容形态判断 looksLikePaths', () => {
  it('含盘符或反斜杠判定为路径', () => {
    expect(looksLikePaths(['C:\\a\\b.pdf', 'D:\\c.pdf'])).toBe(true)
    expect(looksLikePaths(['\\\\srv\\share'])).toBe(true)
    expect(looksLikePaths(['docs/a.pdf'])).toBe(true)
  })

  it('普通句子判定为非路径', () => {
    expect(looksLikePaths(['你好世界'])).toBe(false)
    expect(looksLikePaths(['a@b.com'])).toBe(false)
  })

  it('空数组判定为非路径', () => {
    expect(looksLikePaths([])).toBe(false)
  })
})
