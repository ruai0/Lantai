import { describe, expect, it } from 'vitest'
import { diffLines, splitLines } from '../src/shared/textDiff'

const compact = (r: ReturnType<typeof diffLines>) =>
  r.lines.map(l => `${l.type}:${l.aNo ?? '-'}:${l.bNo ?? '-'}:${l.text}`)

describe('splitLines', () => {
  it('空串返回空数组', () => expect(splitLines('')).toEqual([]))
  it('兼容三种换行', () => expect(splitLines('a\r\nb\nc\rd')).toEqual(['a', 'b', 'c', 'd']))
})

describe('diffLines', () => {
  it('完全相同', () => {
    const r = diffLines('一\n二\n三', '一\n二\n三')
    expect(compact(r)).toEqual(['same:1:1:一', 'same:2:2:二', 'same:3:3:三'])
    expect(r).toMatchObject({ added: 0, deleted: 0, changed: 0, same: 3, truncated: false })
  })

  it('中间插入一行，前后缀剥离后行号正确', () => {
    const r = diffLines('A\nB\nD', 'A\nB\nC\nD')
    expect(compact(r)).toEqual(['same:1:1:A', 'same:2:2:B', 'add:-:3:C', 'same:3:4:D'])
    expect(r.added).toBe(1)
  })

  it('删除一行', () => {
    const r = diffLines('A\nB\nC', 'A\nC')
    expect(compact(r)).toEqual(['same:1:1:A', 'del:2:-:B', 'same:3:2:C'])
    expect(r.deleted).toBe(1)
  })

  it('相邻删增配对为变更', () => {
    const r = diffLines('A\n旧值\nC', 'A\n新值\nC')
    expect(compact(r)).toEqual(['same:1:1:A', 'chg:2:2:新值', 'same:3:3:C'])
    expect(r.changed).toBe(1)
    expect(r.deleted).toBe(0)
    expect(r.added).toBe(0)
  })

  it('一侧为空', () => {
    const r = diffLines('A\nB', '')
    expect(compact(r)).toEqual(['del:1:-:A', 'del:2:-:B'])
    const r2 = diffLines('', 'A')
    expect(compact(r2)).toEqual(['add:-:1:A'])
  })

  it('尾部增删不误配公共前缀', () => {
    const r = diffLines('1\n2\n3', '1\n2\n3\n4')
    expect(compact(r)).toEqual(['same:1:1:1', 'same:2:2:2', 'same:3:3:3', 'add:-:4:4'])
  })

  it('超长中间段降级并标记 truncated', () => {
    const a = Array.from({ length: 2500 }, (_, i) => `a${i}`).join('\n')
    const b = Array.from({ length: 2500 }, (_, i) => `b${i}`).join('\n')
    const r = diffLines(a, b)
    expect(r.truncated).toBe(true)
    // 降级块（整段删+整段增）同样配对成变更行
    expect(r.changed).toBe(2500)
    expect(r.deleted).toBe(0)
    expect(r.added).toBe(0)
    expect(r.same).toBe(0)
  })

  it('大量相同行只比中间', () => {
    const common = Array.from({ length: 100 }, (_, i) => `L${i}`).join('\n')
    const r = diffLines(`${common}\nX\n${common}`, `${common}\nY\n${common}`)
    expect(r.changed).toBe(1)
    expect(r.same).toBe(200)
    expect(r.truncated).toBe(false)
  })
})
