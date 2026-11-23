/**
 * Word 排版单测：标题识别、单位换算、OOXML 实际改写结果。
 * XML 用例用极小片段，断言写出的属性（w:sz/w:line/w:ind/w:pgMar）而不是字符串匹配整段，
 * 这样 serializer 的换行/自闭合风格变化不影响用例。
 */
import { describe, expect, it } from 'vitest'
import { DOMParser } from '@xmldom/xmldom'
import { formatDocxXml } from '../src/main/services/wordFormatService'
import { PRESET_GONGWEN, PRESET_COMMON, detectHeading, headingLevel } from '../src/shared/wordFormat'
import { cmToTwips, halfPt, charIndent, twipsToCm } from '../src/shared/wunits'

const NS = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"'

/** 从 XML 里取某属性（按段落序号） */
function attrs(xml: string, tag: string, attr: string): string[] {
  const doc = new DOMParser().parseFromString(xml, 'text/xml')
  const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
  const els = doc.getElementsByTagNameNS(W, tag)
  const out: string[] = []
  for (let i = 0; i < els.length; i++) out.push(els[i].getAttribute(attr) || '')
  return out
}

function pgMar(xml: string) {
  const doc = new DOMParser().parseFromString(xml, 'text/xml')
  const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
  const m = doc.getElementsByTagNameNS(W, 'pgMar')[0]
  return m ? { top: m.getAttribute('w:top'), left: m.getAttribute('w:left') } : null
}

describe('detectHeading / headingLevel', () => {
  it('认出一、二、三级标题编号', () => {
    expect(headingLevel('一、总体要求')).toBe(1)
    expect(headingLevel('（一）组织领导')).toBe(2)
    expect(headingLevel('1. 工作目标')).toBe(3)
    expect(headingLevel('1、具体任务')).toBe(3)
    expect(headingLevel('（12）附则')).toBe(3)
    expect(headingLevel('1.2 分项目标')).toBe(3)
  })

  it('正文不误判', () => {
    expect(headingLevel('各单位要高度重视这项工作。')).toBe(0)
    expect(headingLevel('2026年10月17日印发')).toBe(0)
    expect(headingLevel('')).toBe(0)
    expect(headingLevel('一是提高认识')).toBe(0) // 顿号在前才算标题，"一是"是正文
  })

  it('过长的编号段不当标题（更像正文里的列举）', () => {
    const long = '一、' + '这是一段很长的正文内容'.repeat(10)
    expect(detectHeading(long)).toBeNull()
  })

  it('正常编号段返回层级与原文', () => {
    const hit = detectHeading('三、保障措施')
    expect(hit?.level).toBe(1)
    expect(hit?.text).toContain('保障措施')
  })
})

describe('单位换算', () => {
  it('厘米转 twips：国标页边距', () => {
    expect(cmToTwips(2.54)).toBe(1440)
    expect(cmToTwips(3.7)).toBe(2098)
    expect(cmToTwips(2.8)).toBe(1587)
    expect(twipsToCm(1440)).toBe(2.54)
  })

  it('磅转半磅值：三号字 16pt = 32', () => {
    expect(halfPt(16)).toBe(32)
    expect(halfPt(10.5)).toBe(21)
    expect(halfPt(22)).toBe(44)
  })

  it('字符缩进转 twips', () => {
    expect(charIndent(2, 16)).toBe(640)
    expect(charIndent(0, 16)).toBe(0)
  })
})

describe('formatDocxXml', () => {
  const doc = (paras: string, sect = '') => `<?xml version="1.0"?><w:document ${NS}><w:body>${paras}${sect}</w:body></w:document>`
  const p = (text: string, extra = '') =>
    `<w:p><w:pPr>${extra}</w:pPr><w:r><w:t>${text}</w:t></w:r></w:p>`
  const sect = `<w:sectPr><w:pgMar w:top="1440" w:bottom="1440" w:left="1800" w:right="1800"/></w:sectPr>`

  it('正文段套预设字体字号行距与首行缩进', () => {
    const r = formatDocxXml(doc(p('这是一段正文内容。'), sect), PRESET_GONGWEN)
    expect(attrs(r.xml, 'rFonts', 'w:eastAsia')).toEqual(['仿宋_GB2312'])
    expect(attrs(r.xml, 'sz', 'w:val')).toEqual(['32']) // 16pt → 32 半磅
    expect(attrs(r.xml, 'spacing', 'w:line')).toEqual(['560']) // 28pt → 560 twips
    expect(attrs(r.xml, 'spacing', 'w:lineRule')).toEqual(['exact'])
    expect(attrs(r.xml, 'ind', 'w:firstLineChars')).toEqual(['200']) // 2 字符
  })

  it('三级标题分别套黑体/楷体/仿宋加粗', () => {
    const r = formatDocxXml(
      doc(p('一、总体要求') + p('（一）组织领导') + p('1. 工作目标') + p('正文段落'), sect),
      PRESET_GONGWEN
    )
    expect(r.counts).toEqual([1, 1, 1, 1])
    expect(attrs(r.xml, 'rFonts', 'w:eastAsia')).toEqual(['黑体', '楷体_GB2312', '仿宋_GB2312', '仿宋_GB2312'])
    // 只有三级标题（1.）预设了 bold，因此整个文档只有 1 个 <w:b/>
    expect(r.xml.match(/<w:b\s*\/?>/g)?.length ?? 0).toBe(1)
    expect(r.headings.length).toBe(3)
  })

  it('页边距按预设改写', () => {
    const r = formatDocxXml(doc(p('正文'), sect), PRESET_GONGWEN)
    const m = pgMar(r.xml)
    expect(m).not.toBeNull()
    expect(m!.top).toBe(String(cmToTwips(3.7)))
    expect(m!.left).toBe(String(cmToTwips(2.8)))
    expect(r.marginChanged).toBe(true)
  })

  it('页边距已是目标值时不报 changed', () => {
    const same = `<w:sectPr><w:pgMar w:top="${cmToTwips(3.7)}" w:bottom="${cmToTwips(3.5)}" w:left="${cmToTwips(2.8)}" w:right="${cmToTwips(2.6)}"/></w:sectPr>`
    const r = formatDocxXml(doc(p('正文'), same), PRESET_GONGWEN)
    expect(r.marginChanged).toBe(false)
  })

  it('空段落不动（保留原有呼吸感）', () => {
    const r = formatDocxXml(doc('<w:p><w:pPr><w:spacing w:before="120"/></w:pPr></w:p>' + p('正文'), sect), PRESET_GONGWEN)
    expect(r.counts).toEqual([1, 0, 0, 0])
    // 空段落原有的 before 保留
    expect(attrs(r.xml, 'spacing', 'w:before')).toContain('120')
  })

  it('表格内段落跳过不动', () => {
    const xml = doc(
      `<w:tbl><w:tr><w:tc><w:p><w:r><w:t>一、表内不当标题</w:t></w:r></w:p></w:tc></w:tr></w:tbl>` + p('正文', ''),
      sect
    )
    const r = formatDocxXml(xml, PRESET_GONGWEN)
    expect(r.counts).toEqual([1, 0, 0, 0])
  })

  it('倍数行距的预设写 auto 规则', () => {
    const r = formatDocxXml(doc(p('正文'), sect), PRESET_COMMON)
    expect(attrs(r.xml, 'spacing', 'w:line')).toEqual(['360']) // 1.5 × 240
    expect(attrs(r.xml, 'spacing', 'w:lineRule')).toEqual(['auto'])
    expect(attrs(r.xml, 'rFonts', 'w:eastAsia')).toEqual(['宋体'])
    expect(attrs(r.xml, 'sz', 'w:val')).toEqual(['24']) // 12pt
  })

  it('原有 run 的 rPr 被替换而非叠加', () => {
    const r = formatDocxXml(doc(p('正文')), PRESET_GONGWEN)
    // 每个 run 最多一个 rFonts
    expect(attrs(r.xml, 'rFonts', 'w:eastAsia').length).toBe(1)
  })

  it('来路文档的乱格式被压掉：斜体/下划线等 rPr 子项清空重写', () => {
    const messy = `<w:p><w:r><w:rPr><w:i/><w:u w:val="single"/><w:color w:val="FF0000"/><w:sz w:val="18"/></w:rPr><w:t>正文</w:t></w:r></w:p>`
    const r = formatDocxXml(doc(messy, sect), PRESET_GONGWEN)
    expect(r.xml).not.toContain('<w:i/>')
    expect(r.xml).not.toContain('w:val="single"')
    expect(attrs(r.xml, 'sz', 'w:val')).toEqual(['32'])
  })
})
