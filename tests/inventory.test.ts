import { describe, expect, it } from 'vitest'
import { groupDuplicates, humanSize, type FileEntry } from '../src/main/services/inventoryService'

function entry(path: string, sizeBytes: number): FileEntry {
  return { path, relPath: path, name: path, ext: '.bin', sizeBytes, mtimeMs: 0 }
}

const hasher =
  (map: Record<string, string>) =>
  async (p: string): Promise<string> =>
    map[p] ?? `md5-${p}`

describe('groupDuplicates', () => {
  it('体积不同的文件不参与哈希比对', async () => {
    const groups = await groupDuplicates([entry('a', 1), entry('b', 2)], hasher({}))
    expect(groups).toEqual([])
  })

  it('同体积同内容归为一组', async () => {
    const groups = await groupDuplicates(
      [entry('a', 100), entry('b', 100), entry('c', 100)],
      hasher({ a: 'x', b: 'x', c: 'y' })
    )
    expect(groups).toHaveLength(1)
    expect(groups[0].hash).toBe('x')
    expect(groups[0].files.map(f => f.name)).toEqual(['a', 'b'])
    expect(groups[0].sizeBytes).toBe(100)
  })

  it('只哈希体积重复的候选，节省 IO', async () => {
    const calls: string[] = []
    const groups = await groupDuplicates([entry('a', 1), entry('b', 2), entry('c', 2)], async p => {
      calls.push(p)
      return `md5-${p}`
    })
    expect(calls.sort()).toEqual(['b', 'c'])
    expect(groups).toEqual([])
  })

  it('按可释放体积降序排列各组', async () => {
    const groups = await groupDuplicates(
      [
        entry('small1', 10),
        entry('small2', 10),
        entry('big1', 1000),
        entry('big2', 1000),
        entry('big3', 1000)
      ],
      hasher({
        small1: 's',
        small2: 's',
        big1: 'b',
        big2: 'b',
        big3: 'b'
      })
    )
    expect(groups[0].files).toHaveLength(3)
    expect(groups[1].files).toHaveLength(2)
  })
})

describe('humanSize', () => {
  it('字节与进位', () => {
    expect(humanSize(0)).toBe('0 B')
    expect(humanSize(512)).toBe('512 B')
    expect(humanSize(1024)).toBe('1.0 KB')
    expect(humanSize(1536)).toBe('1.5 KB')
    expect(humanSize(5 * 1024 * 1024)).toBe('5.0 MB')
    expect(humanSize(3 * 1024 ** 3)).toBe('3.0 GB')
  })

  it('非法输入回退 0 B', () => {
    expect(humanSize(-1)).toBe('0 B')
    expect(humanSize(NaN)).toBe('0 B')
  })
})
