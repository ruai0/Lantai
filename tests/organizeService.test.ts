import { describe, expect, it } from 'vitest'
import { buildOrganizePlan } from '../src/main/services/organizeService'

// 2026-09-07 与 2025-12-31（本地时区语义不参与断言，仅用年份分组）
const SEP = new Date(2026, 8, 7, 10, 0, 0).getTime()
const DEC = new Date(2025, 11, 31, 10, 0, 0).getTime()

describe('buildOrganizePlan', () => {
  it('按扩展名归类，无扩展名进「其他」', () => {
    const plan = buildOrganizePlan(
      [
        { name: 'a.JPG', mtimeMs: SEP },
        { name: 'b.png', mtimeMs: SEP },
        { name: '说明文件', mtimeMs: SEP }
      ],
      'ext'
    )
    expect(plan.map(p => p.to)).toEqual(['jpg/a.JPG', 'png/b.png', '其他/说明文件'])
  })

  it('按修改年份归类', () => {
    const plan = buildOrganizePlan(
      [
        { name: 'a.txt', mtimeMs: SEP },
        { name: 'b.txt', mtimeMs: DEC }
      ],
      'year'
    )
    expect(plan[0].to).toBe(`${new Date(SEP).getFullYear()}/a.txt`)
    expect(plan[1].to).toBe(`${new Date(DEC).getFullYear()}/b.txt`)
  })

  it('按修改年月归类，月份两位补零', () => {
    const plan = buildOrganizePlan([{ name: 'a.txt', mtimeMs: SEP }], 'month')
    const d = new Date(SEP)
    const expected = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}/a.txt`
    expect(plan[0].to).toBe(expected)
  })

  it('文件名保持不变（to 仅添加目录前缀）', () => {
    const plan = buildOrganizePlan([{ name: '报 告.pdf', mtimeMs: SEP }], 'ext')
    expect(plan[0].from).toBe('报 告.pdf')
    expect(plan[0].conflict).toBe(false)
  })
})
