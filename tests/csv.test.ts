import { describe, expect, it } from 'vitest'
import { detectDelimiter, parseCsv } from '../src/main/services/excelToolsService'

describe('parseCsv', () => {
  it('普通逗号分隔', () => {
    expect(parseCsv('a,b,c\n1,2,3')).toEqual([
      ['a', 'b', 'c'],
      ['1', '2', '3']
    ])
  })

  it('带引号与内嵌逗号、引号转义', () => {
    expect(parseCsv('"a,1","he said ""hi""",c')).toEqual([['a,1', 'he said "hi"', 'c']])
  })

  it('引号内换行不切分', () => {
    expect(parseCsv('a,"x\ny",c')).toEqual([['a', 'x\ny', 'c']])
  })

  it('CRLF 行尾', () => {
    expect(parseCsv('a,b\r\n1,2')).toEqual([
      ['a', 'b'],
      ['1', '2']
    ])
  })

  it('末行无换行符也能收尾', () => {
    expect(parseCsv('a,b\n1,2')).toHaveLength(2)
  })
})

describe('detectDelimiter', () => {
  it('逗号优先', () => {
    expect(detectDelimiter('a,b,c')).toBe(',')
  })

  it('制表符', () => {
    expect(detectDelimiter('a\tb\tc')).toBe('\t')
  })

  it('分号', () => {
    expect(detectDelimiter('a;b;c')).toBe(';')
  })

  it('无分隔符时回退逗号', () => {
    expect(detectDelimiter('abc')).toBe(',')
  })
})
