import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

/**
 * 平台层新服务的纯逻辑单测：撤销日志、任务取消、目录展开、更新源解析。
 * undoJournal/taskProgress 依赖 electron（userData 路径 / 广播窗口列表），统一 mock 掉。
 */
const ROOT = path.join(os.tmpdir(), 'lantai-platform-test')

vi.mock('electron', async () => {
  const os = await import('node:os')
  const path = await import('node:path')
  return {
    app: { getPath: () => path.join(os.tmpdir(), 'lantai-platform-test') },
    BrowserWindow: { getAllWindows: () => [] }
  }
})

const { undoLast, undoState, writeJournal } = await import('../src/main/services/undoJournal')
const { TaskCancelledError, activeTaskList, beginTask, cancelTask, runTracked } = await import('../src/main/services/taskProgress')
const { expandPaths } = await import('../src/main/services/expandService')
const { parseUpdateFeed } = await import('../src/main/services/updateFeed')

beforeAll(() => {
  fs.rmSync(ROOT, { recursive: true, force: true })
  fs.mkdirSync(ROOT, { recursive: true })
})
afterEach(() => {
  for (const f of fs.readdirSync(ROOT)) fs.rmSync(path.join(ROOT, f), { recursive: true, force: true })
})

describe('undoJournal 撤销日志', () => {
  it('无日志时 undoLast 抛错', () => {
    expect(undoState().rename).toBeNull()
    expect(() => undoLast('rename')).toThrow(/没有可撤销/)
  })

  it('正常撤销：逆序还原并清空日志', () => {
    const a = path.join(ROOT, 'a.txt')
    const b = path.join(ROOT, 'b.txt')
    const a2 = path.join(ROOT, 'sub', 'a.txt')
    const b2 = path.join(ROOT, 'sub', 'b.txt')
    fs.writeFileSync(a, '1')
    fs.writeFileSync(b, '2')
    fs.mkdirSync(path.join(ROOT, 'sub'))
    fs.renameSync(a, a2)
    fs.renameSync(b, b2)
    writeJournal('rename', ROOT, [
      { from: a, to: a2 },
      { from: b, to: b2 }
    ])
    expect(undoState().rename?.count).toBe(2)
    const r = undoLast('rename')
    expect(r).toMatchObject({ undone: 2, skipped: 0 })
    expect(fs.existsSync(a) && fs.existsSync(b)).toBe(true)
    expect(undoState().rename).toBeNull()
  })

  it('目标已被用户挪走算 skipped；原位置被占算 failed', () => {
    const from = path.join(ROOT, 'x.txt')
    const to = path.join(ROOT, 'y.txt')
    fs.writeFileSync(to, '1')
    writeJournal('organize', ROOT, [{ from, to }])
    fs.rmSync(to) // 用户把文件挪走了
    const r1 = undoLast('organize')
    expect(r1.undone).toBe(0)
    expect(r1.skipped).toBe(1)

    fs.writeFileSync(to, '2')
    fs.writeFileSync(from, 'occupied') // 原位置已有文件
    writeJournal('organize', ROOT, [{ from, to }])
    const r2 = undoLast('organize')
    expect(r2.undone).toBe(0)
    expect(r2.failed[0]?.reason).toContain('占用')
    expect(fs.existsSync(to)).toBe(true) // 失败时不动用户文件
  })
})

describe('taskProgress 取消语义', () => {
  it('cancelTask 置位 isCancelled，重复取消返回 false', () => {
    const t = beginTask('测试任务', 3)
    expect(t.isCancelled()).toBe(false)
    expect(cancelTask(t.id)).toBe(true)
    expect(t.isCancelled()).toBe(true)
    expect(cancelTask(t.id)).toBe(false) // 非 running 不可再取消
    t.finish('cancelled')
  })

  it('runTracked：TaskCancelledError 记为 cancelled，其他异常记为 error', async () => {
    await expect(
      runTracked('取消任务', 2, async ctx => {
        ctx.progress(1)
        throw new TaskCancelledError()
      })
    ).rejects.toThrow(/已取消/)
    expect(activeTaskList().some(t => t.label === '取消任务' && t.state === 'cancelled')).toBe(true)

    await expect(
      runTracked('出错任务', 2, async () => {
        throw new Error('炸了')
      })
    ).rejects.toThrow('炸了')
    expect(activeTaskList().some(t => t.label === '出错任务' && t.state === 'error')).toBe(true)
  })

  it('runTracked 正常完成：done 补满、状态 done', async () => {
    const r = await runTracked('完成任务', 2, async ctx => {
      ctx.progress(1)
      ctx.progress(2)
      return 'ok'
    })
    expect(r).toBe('ok')
    const snap = activeTaskList().find(t => t.label === '完成任务')
    expect(snap).toMatchObject({ done: 2, total: 2, state: 'done' })
  })
})

describe('expandPaths 目录展开', () => {
  const mkTree = () => {
    const treeRoot = path.join(ROOT, 'tree')
    for (const rel of ['a.png', 'b.jpg', '.secret.png', 'sub/c.png', 'node_modules/e.png', '.hidden/f.png']) {
      const p = path.join(treeRoot, rel)
      if (!p.startsWith(treeRoot + path.sep)) throw new Error('fixture 路径越界')
      fs.mkdirSync(path.dirname(p), { recursive: true })
      fs.writeFileSync(p, 'x')
    }
  }
  beforeEach(mkTree)

  it('递归收集 + 类型过滤 + 跳过隐藏/依赖目录 + 文件计入 rejected', async () => {
    const r = await expandPaths({
      paths: [path.join(ROOT, 'tree'), path.join(ROOT, 'missing.bin'), path.join(ROOT, 'tree', 'b.jpg')],
      exts: ['png']
    })
    expect(r.files.map(f => path.basename(f)).sort()).toEqual(['a.png', 'c.png'])
    expect(r.dirs).toBe(2) // tree + sub（.hidden 与 node_modules 不进）
    expect(r.rejected).toBe(3) // missing.bin + 直拖 b.jpg + 遍历到的 b.jpg
    expect(r.truncated).toBe(false)
  })

  it('max 截断', async () => {
    const r = await expandPaths({ paths: [path.join(ROOT, 'tree')], max: 1 })
    expect(r.files.length).toBe(1)
    expect(r.truncated).toBe(true)
  })
})

describe('parseUpdateFeed 更新源解析', () => {
  it('留空走内置官方源（github）', () => {
    expect(parseUpdateFeed('')).toEqual({ provider: 'github', owner: 'ruai0', repo: 'Lantai' })
    expect(parseUpdateFeed('  ')).toEqual({ provider: 'github', owner: 'ruai0', repo: 'Lantai' })
  })

  it('off/none/- 禁用', () => {
    expect(parseUpdateFeed('off')).toBeNull()
    expect(parseUpdateFeed('NONE')).toBeNull()
    expect(parseUpdateFeed('-')).toBeNull()
  })

  it('github 地址走 Releases provider（含尾斜杠/www）', () => {
    expect(parseUpdateFeed('https://github.com/foo/bar')).toEqual({ provider: 'github', owner: 'foo', repo: 'bar' })
    expect(parseUpdateFeed('https://www.github.com/foo/bar/')).toEqual({ provider: 'github', owner: 'foo', repo: 'bar' })
  })

  it('其余 http(s) 走通用静态目录；非法协议拒绝', () => {
    expect(parseUpdateFeed('http://192.168.1.8/floor/lantai/')).toEqual({
      provider: 'generic',
      url: 'http://192.168.1.8/floor/lantai/'
    })
    expect(parseUpdateFeed('ftp://example.com')).toBeNull()
    expect(parseUpdateFeed('github.com/foo/bar')).toBeNull()
  })
})
