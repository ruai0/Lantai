/**
 * 文件夹展开（含子文件夹开关）与右键菜单启动参数解析。
 * 递归行为直接影响"拖一个文件夹进来会收多少文件"，错一次就是几百个无关文件。
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { expandPaths } from '../src/main/services/expandService'
import { parseShellIntent } from '../src/main/services/shellMenuService'

/** 造一棵目录树：root/{a.pdf, b.docx, sub/{c.pdf, deep/{d.pdf}}, .hidden/{e.pdf}} */
function makeTree(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wf-expand-'))
  fs.writeFileSync(path.join(root, 'a.pdf'), 'x')
  fs.writeFileSync(path.join(root, 'b.docx'), 'x')
  fs.mkdirSync(path.join(root, 'sub'))
  fs.writeFileSync(path.join(root, 'sub', 'c.pdf'), 'x')
  fs.mkdirSync(path.join(root, 'sub', 'deep'))
  fs.writeFileSync(path.join(root, 'sub', 'deep', 'd.pdf'), 'x')
  fs.mkdirSync(path.join(root, '.hidden'))
  fs.writeFileSync(path.join(root, '.hidden', 'e.pdf'), 'x')
  return root
}

describe('expandPaths 递归开关', () => {
  const root = makeTree()

  it('默认递归：收齐所有层级（跳过 . 开头的目录）', async () => {
    const r = await expandPaths({ paths: [root], exts: ['pdf'] })
    const names = r.files.map(f => path.basename(f)).sort()
    expect(names).toEqual(['a.pdf', 'c.pdf', 'd.pdf'])
  })

  it('recursive=false：只收顶层文件，不下探子目录', async () => {
    const r = await expandPaths({ paths: [root], exts: ['pdf'], recursive: false })
    expect(r.files.map(f => path.basename(f))).toEqual(['a.pdf'])
  })

  it('后缀过滤生效', async () => {
    const r = await expandPaths({ paths: [root], exts: ['docx'] })
    expect(r.files.map(f => path.basename(f))).toEqual(['b.docx'])
  })

  it('直接传文件也能收（不限递归设置）', async () => {
    const file = path.join(root, 'sub', 'deep', 'd.pdf')
    const r = await expandPaths({ paths: [file], exts: ['pdf'], recursive: false })
    expect(r.files).toEqual([file])
  })

  it('不存在的路径计入 rejected 而不抛错', async () => {
    const r = await expandPaths({ paths: [path.join(root, 'nope.pdf')], exts: ['pdf'] })
    expect(r.files.length).toBe(0)
    expect(r.rejected).toBe(1)
  })
})

describe('parseShellIntent 启动参数', () => {
  it('解析动作与文件', () => {
    const r = parseShellIntent(['Lantai.exe', '--shell-action=to-pdf', 'C:\\a.docx', 'D:\\b.docx'])
    expect(r).toEqual({ action: 'to-pdf', files: ['C:\\a.docx', 'D:\\b.docx'] })
  })

  it('无参数时返回 null（正常双击启动）', () => {
    expect(parseShellIntent(['Lantai.exe'])).toBeNull()
  })

  it('未知动作返回 null，避免误跳转', () => {
    expect(parseShellIntent(['Lantai.exe', '--shell-action=format-disk', 'C:\\a.pdf'])).toBeNull()
  })

  it('忽略 Electron 自身开关参数', () => {
    const r = parseShellIntent(['Lantai.exe', '--shell-action=open', '--no-sandbox', 'C:\\a.pdf'])
    expect(r?.files).toEqual(['C:\\a.pdf'])
  })

  it('exe 自身路径不能被当成待处理文件', () => {
    const r = parseShellIntent([
      String.raw`I:\tools\lantai\Lantai.exe`,
      '--shell-action=to-pdf',
      String.raw`C:\a.docx`
    ])
    expect(r?.files).toEqual([String.raw`C:\a.docx`])
  })

  it('四个 PDF 动作都认得', () => {
    for (const a of ['pdf-to-images', 'pdf-compress', 'pdf-text', 'open']) {
      expect(parseShellIntent(['x', `--shell-action=${a}`, 'C:\\a.pdf'])?.action).toBe(a)
    }
  })
})
