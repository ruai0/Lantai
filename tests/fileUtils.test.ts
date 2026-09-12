import { mkdtempSync, rmSync, existsSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it, afterEach } from 'vitest'
import { uniquePath } from '../src/main/services/fileUtils'

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
