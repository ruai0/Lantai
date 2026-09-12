import { describe, expect, it } from 'vitest'
import { buildRenamePlan, filterByExts } from '../src/main/services/renameService'

describe('filterByExts', () => {
  it('按扩展名过滤（大小写不敏感、容忍点号）', () => {
    expect(filterByExts(['a.JPG', 'b.png', 'c.txt'], ['.jpg', 'png'])).toEqual(['a.JPG', 'b.png'])
  })

  it('空过滤条件返回全部', () => {
    expect(filterByExts(['a', 'b'], [])).toEqual(['a', 'b'])
  })
})

describe('buildRenamePlan', () => {
  it('查找替换 + 前缀 + 扩展名小写', () => {
    const plan = buildRenamePlan(['IMG_0001.JPG', 'IMG_0002.JPG'], {
      find: 'IMG_',
      replace: '照片_',
      prefix: '会议',
      extLower: true
    })
    expect(plan[0].to).toBe('会议照片_0001.jpg')
    expect(plan[1].to).toBe('会议照片_0002.jpg')
  })

  it('序号按列表顺序递增并补零', () => {
    const plan = buildRenamePlan(['b.txt', 'a.txt'], { sequence: { start: 5, step: 5, digits: 4 } })
    expect(plan[0].to).toBe('b_0005.txt')
    expect(plan[1].to).toBe('a_0010.txt')
  })

  it('无变化标记 unchanged 且不冲突', () => {
    const plan = buildRenamePlan(['a.txt'], {})
    expect(plan[0].unchanged).toBe(true)
    expect(plan[0].conflict).toBe(false)
  })

  it('多个文件目标名相同标记冲突', () => {
    const plan = buildRenamePlan(['ab.txt', 'ba.txt'], { find: 'b', replace: '' })
    expect(plan.every(p => p.conflict)).toBe(true)
    expect(plan[0].to).toBe('a.txt')
  })

  it('目标名与目录中不参与重命名的文件冲突', () => {
    const plan = buildRenamePlan(['a.txt'], { find: 'a', replace: 'b' }, new Set(['a.txt', 'b.txt']))
    expect(plan[0].conflict).toBe(true)
  })

  it('目标名被占用但占用者将改名离开，不算冲突', () => {
    const plan = buildRenamePlan(
      ['b.txt', 'b_1.txt'],
      { sequence: { start: 1, step: 1, digits: 1 } },
      new Set(['b.txt', 'b_1.txt'])
    )
    expect(plan[0].conflict).toBe(false)
    expect(plan[0].to).toBe('b_1.txt')
    expect(plan[1].to).toBe('b_1_2.txt')
  })

  it('后缀加在扩展名之前', () => {
    const plan = buildRenamePlan(['a.txt'], { suffix: '_备份' })
    expect(plan[0].to).toBe('a_备份.txt')
  })
})
