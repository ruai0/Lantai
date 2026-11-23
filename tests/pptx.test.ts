import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import PizZip from 'pizzip'
import { fillPptxXml, scanPptxXml } from '../src/main/services/pptxTemplate'
import { fillPptx, scanPptxFields } from '../src/main/services/pptxService'

/** PPT 模板填充：run 劈分合并、格式保留、转义、严格缺字段 + 服务级 zip 管线 */

const run = (text: string, rPr = '') => `<a:r>${rPr ? `<a:rPr ${rPr}/>` : ''}<a:t>${text}</a:t></a:r>`
const para = (...runs: string[]) => `<a:p>${runs.join('')}</a:p>`
const slide = (...paras: string[]) => `<p:sld><p:cSld><p:sp><p:txBody>${paras.join('')}</p:txBody></p:sp></p:cSld></p:sld>`

describe('scanPptxXml', () => {
  it('识别单 run 与跨 run 劈开的占位符，去重、去空白、剥前缀标记', () => {
    const xml = slide(
      para(run('尊敬的{ 姓名 }：')),
      para(run('{姓', 'lang="zh-CN"'), run('名}您好')),
      para(run('{#单位}')),
      para(run('落款：{姓名}'))
    )
    expect(scanPptxXml(xml)).toEqual(['姓名', '单位'])
  })

  it('无占位符返回空数组', () => {
    expect(scanPptxXml(slide(para(run('纯文本，无花括号'))))).toEqual([])
  })
})

describe('fillPptxXml', () => {
  it('单 run 内占位符直接替换', () => {
    const out = fillPptxXml(slide(para(run('兹通知{姓名}同志')), ), { 姓名: '张三' })
    expect(out).toContain('<a:t>兹通知张三同志</a:t>')
  })

  it('跨 run 劈开的占位符：值写进首个 run，其余清空，rPr 原样保留', () => {
    const xml = slide(para(run('{姓', 'lang="zh-CN" b="1"'), run('名}您好')))
    const out = fillPptxXml(xml, { 姓名: '李四' })
    expect(out).toContain('<a:rPr lang="zh-CN" b="1"/>')
    expect(out).toContain('<a:t>李四</a:t>')
    expect(out).toContain('<a:t>您好</a:t>')
    expect(out).not.toContain('姓')
  })

  it('多占位符混排（含跨 run），非占位 run 不动', () => {
    const xml = slide(para(run('{a}'), run('和{'), run('b}'), run('（盖章）')))
    const out = fillPptxXml(xml, { a: 'A&份', b: 'B' })
    expect(out).toContain('<a:t>A&amp;份</a:t>') // 值里的 & 转义
    expect(out).toContain('<a:t>和B</a:t>')
    expect(out).toContain('<a:t>（盖章）</a:t>')
  })

  it('模板既有实体又无占位符时逐字节不动', () => {
    const xml = slide(para(run('A&amp;B &lt;C&gt;')))
    expect(fillPptxXml(xml, {})).toBe(xml)
  })

  it('占位符前含 emoji（代理对）不错位', () => {
    const out = fillPptxXml(slide(para(run('😀{x}!'))), { x: 'V' })
    expect(out).toContain('<a:t>😀V!</a:t>')
  })

  it('缺字段抛错并点名缺哪个', () => {
    expect(() => fillPptxXml(slide(para(run('{姓名}'))), {})).toThrow(/姓名/)
  })

  it('同一占位符多次出现（含跨 run 劈开的重复）全部替换', () => {
    const xml = slide(para(run('{a}与{a}')), para(run('共{'), run('b}份，另{b}份')))
    const out = fillPptxXml(xml, { a: 'X', b: 'Y' })
    expect(out).toContain('<a:t>X与X</a:t>')
    expect(out).toContain('<a:t>共Y</a:t>')
    expect(out).toContain('<a:t>份，另Y份</a:t>')
    expect(out).not.toContain('{')
  })

  it('表格单元格里的占位符同样替换（a:p 在 a:tbl 内也命中）', () => {
    const xml =
      '<p:sld><a:tbl><a:tr><a:tc>' +
      para(run('编号：{编号}')) +
      '</a:tc></a:tr></a:tbl></p:sld>'
    const out = fillPptxXml(xml, { 编号: 'A-001' })
    expect(out).toContain('<a:t>编号：A-001</a:t>')
    expect(scanPptxXml(xml)).toEqual(['编号'])
  })
})

describe('fillPptx（服务级 zip 管线）', () => {
  const tmp = path.join(os.tmpdir(), 'lantai-pptx-test')

  function makeTemplate(): string {
    fs.rmSync(tmp, { recursive: true, force: true })
    fs.mkdirSync(tmp, { recursive: true })
    const zip = new PizZip()
    zip.file('[Content_Types].xml', '<Types/>')
    zip.file('ppt/slides/slide1.xml', slide(para(run('兹有{单位}同志')), para(run('{姓'), run('名}获奖'))))
    zip.file('ppt/media/logo.png', Buffer.from([0x89, 0x50, 0x4e, 0x47]))
    const tpl = path.join(tmp, '奖状模板.pptx')
    fs.writeFileSync(tpl, zip.generate({ type: 'nodebuffer' }))
    return tpl
  }

  it('扫描真实 zip 里的幻灯片字段', async () => {
    expect(await scanPptxFields(makeTemplate())).toEqual(['单位', '姓名'])
  })

  it('逐条生成：slide 替换正确、非 slide 部件原样保留、命名模式生效', async () => {
    const tpl = makeTemplate()
    const data = path.join(tmp, 'data.json')
    fs.writeFileSync(data, JSON.stringify([
      { 单位: '办公室', 姓名: '张三' },
      { 单位: '财务科', 姓名: '李四' }
    ]))
    const outDir = path.join(tmp, 'out')
    const r = await fillPptx({ templatePath: tpl, dataPath: data, namePattern: '奖状_{姓名}', outDir })
    expect(r.outputs).toHaveLength(2)
    expect(path.basename(r.outputs[0])).toBe('奖状_张三.pptx')

    const zip = new PizZip(fs.readFileSync(r.outputs[1]))
    const xml = zip.file('ppt/slides/slide1.xml')!.asText()
    expect(xml).toContain('兹有财务科同志')
    expect(xml).toContain('<a:t>李四</a:t>')
    expect(Array.from(zip.file('ppt/media/logo.png')!.asNodeBuffer())).toEqual([0x89, 0x50, 0x4e, 0x47])
  })

  it('无占位符模板直接报错（防呆）', async () => {
    const tpl = makeTemplate()
    const zip = new PizZip(fs.readFileSync(tpl))
    zip.file('ppt/slides/slide1.xml', slide(para(run('没有占位符'))))
    const plain = path.join(tmp, 'plain.pptx')
    fs.writeFileSync(plain, zip.generate({ type: 'nodebuffer' }))
    const data = path.join(tmp, 'd2.json')
    fs.writeFileSync(data, JSON.stringify([{ a: '1' }]))
    await expect(fillPptx({ templatePath: plain, dataPath: data, outDir: path.join(tmp, 'out2') })).rejects.toThrow(/未发现任何/)
  })
})
