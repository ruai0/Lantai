/**
 * Word 排版端到端（真 docx 进出）：造"来路脏"文档 → 排版 → 读回 XML 校验
 * 字体/字号/行距/缩进/页边距，以及斜体下划线等乱格式是否被压掉、表格内是否幸免。
 * 单测里已覆盖纯函数与 XML 片段，这里专验"打包成 docx 再解开"这条真实链路。
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import PizZip from 'pizzip'
import { DOMParser } from '@xmldom/xmldom'
import { PRESET_GONGWEN } from '../src/shared/wordFormat'
import { formatWordFiles } from '../src/main/services/wordFormatService'

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'

/** 造一个最小但合法的 docx（含 Content_Types 与 rels，Word 能打开） */
function makeDocx(parasXml: string): Buffer {
  const zip = new PizZip()
  zip.file('[Content_Types].xml',
    '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
    '<Default Extension="xml" ContentType="application/xml"/>' +
    '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>')
  zip.file('_rels/.rels',
    '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>')
  zip.file('word/document.xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="${W}"><w:body>${parasXml}` +
    '<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1134" w:bottom="1134" w:left="1418" w:right="1418"/></w:sectPr>' +
    '</w:body></w:document>')
  return zip.generate({ type: 'nodebuffer' })
}

/** 脏文档：斜体+红字、雅黑、下划线、无显式字体、多余空段、表内段落 */
const DIRTY = makeDocx(
  '<w:p><w:pPr><w:spacing w:line="276"/></w:pPr><w:r><w:rPr><w:i/><w:color w:val="FF0000"/><w:sz w:val="21"/></w:rPr><w:t>一、总体要求</w:t></w:r></w:p>' +
  '<w:p><w:r><w:rPr><w:rFonts w:eastAsia="微软雅黑"/><w:sz w:val="18"/></w:rPr><w:t>（一）组织领导</w:t></w:r></w:p>' +
  '<w:p><w:r><w:rPr><w:u w:val="single"/></w:rPr><w:t>1. 工作目标</w:t></w:r></w:p>' +
  '<w:p><w:r><w:t>各单位要高度重视这项工作，抓好落实。</w:t></w:r></w:p>' +
  '<w:p/>' +
  '<w:tbl><w:tr><w:tc><w:p><w:r><w:t>表内一、不该动</w:t></w:r></w:p></w:tc></w:tr></w:tbl>'
)

function readBack(buf: Buffer) {
  const xml = new PizZip(buf).file('word/document.xml')!.asText()
  const doc = new DOMParser().parseFromString(xml, 'text/xml')
  const list = (t: string, a: string) => {
    const l = doc.getElementsByTagNameNS(W, t)
    const o: string[] = []
    for (let i = 0; i < l.length; i++) o.push(l[i].getAttribute(a) || '')
    return o
  }
  const texts: string[] = []
  const tl = doc.getElementsByTagNameNS(W, 't')
  for (let i = 0; i < tl.length; i++) texts.push(tl[i].textContent || '')
  return { xml, doc, list, texts }
}

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wf-e2e-'))
const src = path.join(dir, '测试文档.docx')
fs.writeFileSync(src, DIRTY)
const rep = await formatWordFiles({ paths: [src], outDir: dir, preset: PRESET_GONGWEN })

describe('Word 排版端到端（真 docx）', () => {
  it('产出新文件且原文件不动', () => {
    expect(rep.outputs.length).toBe(1)
    expect(fs.existsSync(rep.outputs[0])).toBe(true)
    expect(fs.readFileSync(src).equals(DIRTY)).toBe(true)
  })

  it('报告统计正确：正文 1 段、三级标题各 1 个', () => {
    expect(rep.files[0].counts).toEqual([1, 1, 1, 1])
    expect(rep.files[0].marginChanged).toBe(true)
    expect(rep.files[0].headings.length).toBe(3)
  })

  it('字体字号全部按公文预设落位', () => {
    const { list } = readBack(fs.readFileSync(rep.outputs[0]))
    // 只有表格外 4 个 run 被改写
    expect(list('rFonts', 'w:eastAsia')).toEqual(['黑体', '楷体_GB2312', '仿宋_GB2312', '仿宋_GB2312'])
    expect(list('sz', 'w:val')).toEqual(['32', '32', '32', '32'])
    expect(list('spacing', 'w:line')).toEqual(['560', '560', '560', '560'])
    expect(list('spacing', 'w:lineRule')).toEqual(['exact', 'exact', 'exact', 'exact'])
    expect(list('ind', 'w:firstLineChars')).toEqual(['200', '200', '200', '200'])
    expect(list('jc', 'w:val')).toEqual(['both', 'both', 'both', 'both'])
  })

  it('页边距按国标改写', () => {
    const { doc } = readBack(fs.readFileSync(rep.outputs[0]))
    const m = doc.getElementsByTagNameNS(W, 'pgMar')[0]
    expect(m.getAttribute('w:top')).toBe('2098') // 3.7cm
    expect(m.getAttribute('w:left')).toBe('1587') // 2.8cm
  })

  it('斜体/下划线/红色/微软雅黑 全部被压掉', () => {
    const { xml } = readBack(fs.readFileSync(rep.outputs[0]))
    expect(/<w:i(\s|\/|>)/.test(xml)).toBe(false)
    expect(xml.includes('w:val="single"')).toBe(false)
    expect(xml.includes('w:val="FF0000"')).toBe(false)
    expect(xml.includes('微软雅黑')).toBe(false)
  })

  it('只有三级标题加粗', () => {
    const { xml } = readBack(fs.readFileSync(rep.outputs[0]))
    expect(xml.match(/<w:b\s*\/?>/g)?.length ?? 0).toBe(1)
  })

  it('表格内段落原样保留', () => {
    const { texts, xml } = readBack(fs.readFileSync(rep.outputs[0]))
    expect(texts).toContain('表内一、不该动')
    const tablePart = xml.slice(xml.indexOf('<w:tbl>'), xml.indexOf('</w:tbl>'))
    expect(tablePart.includes('w:eastAsia')).toBe(false)
  })

  it('空段落不套样式（保留原有呼吸感）', () => {
    const { xml } = readBack(fs.readFileSync(rep.outputs[0]))
    expect(xml.includes('<w:p/>') || xml.includes('<w:p></w:p>')).toBe(true)
  })
})

describe('批量排版：进度与中断', () => {
  /** 造 N 份可排版的 docx */
  function makeBatch(n: number): { dir: string; paths: string[] } {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wf-batch-'))
    const paths: string[] = []
    for (let i = 0; i < n; i++) {
      const p = path.join(dir, `doc${i + 1}.docx`)
      fs.writeFileSync(p, DIRTY)
      paths.push(p)
    }
    return { dir, paths }
  }

  it('逐份回调进度，最后一份到达 total', async () => {
    const { dir, paths } = makeBatch(3)
    const seen: Array<[number, number]> = []
    await formatWordFiles({ paths, outDir: dir, preset: PRESET_GONGWEN }, (d, t) => seen.push([d, t]))
    expect(seen).toEqual([
      [1, 3],
      [2, 3],
      [3, 3]
    ])
  })

  it('中途取消：只处理到中断点，抛取消异常', async () => {
    const { dir, paths } = makeBatch(3)
    let calls = 0
    const seen: number[] = []
    await expect(
      formatWordFiles(
        { paths, outDir: dir, preset: PRESET_GONGWEN },
        d => seen.push(d),
        // 第一次放行，第二次开始拒绝
        () => ++calls > 1
      )
    ).rejects.toThrow(/取消|cancel/i)
    // 只完成第一份就该停：进度回调只到 1
    expect(seen).toEqual([1])
    // 产出也只有一份（目录里另有 3 个源文件）
    const produced = fs.readdirSync(dir).filter(f => !/^doc\d+\.docx$/.test(f))
    expect(produced.length).toBe(1)
  })

  it('不传回调时行为与原来一致（向后兼容）', async () => {
    const { dir, paths } = makeBatch(2)
    const rep = await formatWordFiles({ paths, outDir: dir, preset: PRESET_GONGWEN })
    expect(rep.outputs.length).toBe(2)
  })
})
