import { describe, expect, it } from 'vitest'
import path from 'node:path'
import { pickFontByPaths, collectFontFiles, findCjkFont, linuxFontDirs, LINUX_CJK_FONTS } from '../src/main/services/cjkFont'
import { resolveSoffice, buildSofficeArgs } from '../src/main/services/officeToPdfService'

/**
 * 麒麟 / Linux 平台适配的纯逻辑单测：字体定位、soffice 探测与参数。
 * 全部注入假 fs / which，不依赖真实系统与 LibreOffice。
 */

describe('pickFontByPaths', () => {
  it('按候选优先级命中，大小写不敏感，返回完整路径', () => {
    const paths = ['/usr/share/fonts/truetype/SimHei.TTF', '/usr/share/fonts/a/arial.ttf']
    expect(pickFontByPaths(paths, ['simhei.ttf', 'wqy-zenhei.ttc'])).toBe('/usr/share/fonts/truetype/SimHei.TTF')
  })
  it('都不存在返回 null', () => {
    expect(pickFontByPaths(['/d/dejavu.ttf'], LINUX_CJK_FONTS)).toBeNull()
  })
})

describe('collectFontFiles', () => {
  // key 用 path.join 构造，保证在 win32 测试环境（反斜杠）与 Linux 真机（正斜杠）都一致
  const R = '/f'
  const NOTO = path.join(R, 'noto')
  const SUB = path.join(NOTO, 'sub')
  const tree: Record<string, string[]> = {
    [R]: ['noto', 'readme.txt'],
    [NOTO]: ['NotoSansCJK-Regular.ttc', 'NotoSansCJKsc-Regular.otf', 'sub'],
    [SUB]: ['deep.ttf']
  }
  const exists = (p: string) => p in tree
  const isDir = (p: string) => p in tree
  const readDir = (p: string) => tree[p] ?? []

  it('递归收集字体文件为完整路径，忽略非字体文件', () => {
    const files = collectFontFiles(R, exists, isDir, readDir)
    expect(files).toEqual(
      expect.arrayContaining([
        path.join(NOTO, 'NotoSansCJK-Regular.ttc'),
        path.join(NOTO, 'NotoSansCJKsc-Regular.otf'),
        path.join(SUB, 'deep.ttf')
      ])
    )
    expect(files.some(f => f.endsWith('readme.txt'))).toBe(false)
    expect(files.some(f => f.endsWith('noto'))).toBe(false)
  })
  it('不存在的根目录返回空', () => {
    expect(collectFontFiles('/nope', () => false, () => false, () => [])).toEqual([])
  })
})

describe('findCjkFont（Linux 分支）', () => {
  it('在注入的字体目录树里定位到优先的 .otf 单面字体，且保留子目录完整路径', () => {
    const root = linuxFontDirs('/home/u')[0]
    const tree: Record<string, string[]> = { [root]: ['cjk'], [path.join(root, 'cjk')]: ['wqy-zenhei.ttc', 'NotoSansCJKsc-Regular.otf'] }
    const hit = findCjkFont('linux', {
      exists: p => p in tree,
      isDir: p => p in tree,
      readDir: p => tree[p] ?? [],
      home: '/home/u'
    })
    // 候选表里 NotoSansCJKsc-Regular.otf 排在 wqy 之前，应优先命中，且路径含子目录 cjk
    expect(hit).toBe(path.join(root, 'cjk', 'NotoSansCJKsc-Regular.otf'))
  })
  it('无任何中文字体时返回 null', () => {
    const hit = findCjkFont('linux', { exists: () => false, isDir: () => false, readDir: () => [], home: '/h' })
    expect(hit).toBeNull()
  })
})

describe('resolveSoffice', () => {
  it('命中固定安装路径', () => {
    const found = resolveSoffice({ exists: p => p === '/usr/bin/soffice', which: () => null })
    expect(found).toBe('/usr/bin/soffice')
  })
  it('固定路径没有则走 which', () => {
    const found = resolveSoffice({ exists: () => false, which: b => (b === 'libreoffice' ? '/opt/lo/bin/libreoffice' : null) })
    expect(found).toBe('/opt/lo/bin/libreoffice')
  })
  it('都没有返回 null（触发上层“未检测到 LibreOffice”提示）', () => {
    expect(resolveSoffice({ exists: () => false, which: () => null })).toBeNull()
  })
})

describe('buildSofficeArgs', () => {
  it('拼出无头转 PDF 到指定目录的参数', () => {
    expect(buildSofficeArgs('/in/报告.docx', '/tmp/out')).toEqual(['--headless', '--norestore', '--convert-to', 'pdf', '--outdir', '/tmp/out', '/in/报告.docx'])
  })
})
