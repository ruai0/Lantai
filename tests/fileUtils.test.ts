import { mkdtempSync, rmSync, existsSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it, afterEach } from 'vitest'
import { naturalCompare, normalizeKey, uniquePath } from '../src/main/services/fileUtils'
import { findMissingPatternFields } from '../src/shared/namePattern'

describe('uniquePath 输出目录兜底', () => {
  const roots: string[] = []
  afterEach(() => {
    for (const r of roots.splice(0)) rmSync(r, { recursive: true, force: true })
  })

  it('目录不存在时自动创建，返回的路径可直接写文件', () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'ft-up-'))
    roots.push(root)
    const dir = path.join(root, 'out', 'deep')
    const p = uniquePath(dir, '报告.xlsx')
    expect(existsSync(dir)).toBe(true)
    expect(p).toBe(path.join(dir, '报告.xlsx'))
  })

  it('目录存在时行为不变：重名追加 (2)', () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'ft-up2-'))
    roots.push(root)
    expect(uniquePath(root, 'a.pdf')).toBe(path.join(root, 'a.pdf'))
    writeFileSync(path.join(root, 'a.pdf'), 'x')
    expect(uniquePath(root, 'a.pdf')).toBe(path.join(root, 'a(2).pdf'))
  })
})

describe('naturalCompare 自然序', () => {
  it('数字段按数值排（img2 在 img10 前）', () => {
    const arr = ['img10', 'img2', 'img1', 'img20', 'img3']
    expect([...arr].sort(naturalCompare)).toEqual(['img1', 'img2', 'img3', 'img10', 'img20'])
  })

  it('中文按拼音序', () => {
    expect(naturalCompare('张', '李')).toBeGreaterThan(0)
    expect(naturalCompare('安', '白')).toBeLessThan(0)
  })

  it('相同字符串返回 0', () => {
    expect(naturalCompare('a1', 'a1')).toBe(0)
  })
})

describe('normalizeKey 键归一化', () => {
  it('忽略大小写、空白与全半角差异', () => {
    expect(normalizeKey('  工 号 ')).toBe(normalizeKey('工号'))
    expect(normalizeKey('ＡＢＣ')).toBe(normalizeKey('abc'))
    expect(normalizeKey('编号（一）')).toBe(normalizeKey('编号(一)'))
  })

  it('纯数字串去掉尾部 .0', () => {
    expect(normalizeKey('1001.0')).toBe(normalizeKey('1001'))
  })
})

describe('findMissingPatternFields 文件名模式校验', () => {
  const sample = { 姓名: '张三', 单位: '甲' }

  it('全部字段命中时返回空', () => {
    expect(findMissingPatternFields('通知书_{姓名}_{单位}', sample)).toEqual([])
  })

  it('写错的字段会被报出（去重）', () => {
    expect(findMissingPatternFields('{姓名}_{错字段}_{错字段}', sample)).toEqual(['错字段'])
  })

  it('无模式或无样本时返回空', () => {
    expect(findMissingPatternFields('', sample)).toEqual([])
    expect(findMissingPatternFields('{姓名}', undefined)).toEqual([])
  })
})
