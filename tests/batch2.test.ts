import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import ExcelJS from 'exceljs'
import PizZip from 'pizzip'
import { replaceInWordXml, replaceText } from '../src/main/services/replaceService'
import { extractContacts } from '../src/main/services/extractService'
import { listZipContents, packZip, unpackZip } from '../src/main/services/zipService'

let tmp: string

beforeAll(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'freetool-test2-'))
})

afterAll(() => {
  fs.rmSync(tmp, { recursive: true, force: true })
})

describe('replaceInWordXml', () => {
  it('替换 w:t 文本节点内的目标文字并计数', () => {
    const xml =
      '<w:document><w:p><w:r><w:t>2025年度报告</w:t></w:r><w:r><w:t>2025</w:t></w:r></w:p></w:document>'
    const [out, count] = replaceInWordXml(xml, '2025', '2026')
    expect(count).toBe(2)
    expect(out).toContain('2026年度报告')
    expect(out).not.toContain('2025')
  })

  it('对查找与替换内容做 XML 转义', () => {
    const xml = '<w:t>a&lt;b</w:t>'
    const [out, count] = replaceInWordXml(xml, '<', '&amp;更多')
    expect(count).toBe(1)
    expect(out).toContain('a&amp;amp;更多b')
  })

  it('无匹配时原样返回', () => {
    const [out, count] = replaceInWordXml('<w:t>abc</w:t>', 'xyz', 'q')
    expect(count).toBe(0)
    expect(out).toBe('<w:t>abc</w:t>')
  })

  it('跨 run 拆开的词也能替换（同一段落内相邻 w:t 片段）', () => {
    // Word 常见：一个词被拆进多个 run（改字体/加粗/修订），如「张三丰」
    const xml =
      '<w:document><w:p><w:r><w:t>姓名：张</w:t></w:r><w:r><w:t>三</w:t></w:r><w:r><w:t>丰，职务</w:t></w:r></w:p></w:document>'
    const [out, count] = replaceInWordXml(xml, '张三丰', '李四')
    expect(count).toBe(1)
    expect(out).not.toContain('张三丰')
    expect(out.replace(/<[^>]+>/g, '')).toContain('姓名：李四，职务')
  })

  it('跨 run 替换保持片段数量不增，长度超出时顺延到末片段', () => {
    const xml = '<w:p><w:r><w:t>AB</w:t></w:r><w:r><w:t>CD</w:t></w:r></w:p>'
    const [out, count] = replaceInWordXml(xml, 'ABCD', 'WXYZ1234')
    expect(count).toBe(1)
    expect(out.replace(/<[^>]+>/g, '')).toBe('WXYZ1234')
  })

  it('不同段落不被错误拼接', () => {
    const xml = '<w:p><w:r><w:t>张</w:t></w:r></w:p><w:p><w:r><w:t>三</w:t></w:r></w:p>'
    const [, count] = replaceInWordXml(xml, '张三', 'X')
    expect(count).toBe(0)
  })
})

describe('replaceText 集成', () => {
  it('Excel 多文件批量替换', async () => {
    const paths: string[] = []
    for (const name of ['r1.xlsx', 'r2.xlsx']) {
      const wb = new ExcelJS.Workbook()
      const ws = wb.addWorksheet('S')
      ws.addRow(['单位', '说明'])
      ws.addRow(['移动公司', '2025年一季度'])
      const p = path.join(tmp, name)
      await wb.xlsx.writeFile(p)
      paths.push(p)
    }
    const r = await replaceText({ paths, find: '2025', replace: '2026', outDir: tmp })
    expect(r.outputs).toHaveLength(2)
    expect(r.counts.every(c => c.count === 1)).toBe(true)
    const wb = new ExcelJS.Workbook()
    await wb.xlsx.readFile(r.outputs[0])
    expect(wb.worksheets[0].getRow(2).getCell(2).value).toBe('2026年一季度')
  })

  it('Word docx 批量替换', async () => {
    const docXml =
      '<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:p><w:r><w:t>XX移动公司</w:t></w:r></w:p></w:document>'
    const paths: string[] = []
    for (const name of ['d1.docx', 'd2.docx']) {
      const zip = new PizZip()
      zip.file('[Content_Types].xml', '<Types/>')
      zip.file('word/document.xml', docXml)
      const p = path.join(tmp, name)
      if (!p.startsWith(tmp + path.sep)) throw new Error('fixture 路径越界')
      fs.writeFileSync(p, zip.generate({ type: 'nodebuffer' }))
      paths.push(p)
    }
    const r = await replaceText({ paths, find: 'XX移动', replace: 'YY联通', outDir: tmp })
    expect(r.counts.every(c => c.count === 1)).toBe(true)
    const back = new PizZip(fs.readFileSync(r.outputs[0]))
    expect(back.file('word/document.xml')?.asText()).toContain('YY联通公司')
  })
})

describe('extractContacts', () => {
  it('提取手机号（不误吸身份证内数字）', () => {
    const r = extractContacts('联系 13812345678，备选 139-8765-4321 不算，证件 330102199001011234', ['phone'])
    expect(r.phone).toEqual(['13812345678'])
    expect(r.idcard).toEqual([])
  })

  it('提取身份证号（含 X 结尾，且校验位/日期合法）', () => {
    const r = extractContacts('a330102199001011234b 11010119900307002X', ['idcard'])
    expect(r.idcard).toEqual(['330102199001011234', '11010119900307002X'])
  })

  it('过滤掉校验位不合法的 18 位数字串（如订单号）', () => {
    // ...123X 校验位应为 4，属无效号；订单号 123456789012345678 也不是证件号
    const r = extractContacts('订单 123456789012345678，证件 330102199001011234', ['idcard'])
    expect(r.idcard).toEqual(['330102199001011234'])
  })

  it('提取邮箱', () => {
    const r = extractContacts('发到 a.b@test.com.cn，抄送 c+tag@163.COM', ['email'])
    expect(r.email).toEqual(['a.b@test.com.cn', 'c+tag@163.COM'])
  })
})

describe('ZIP 打包 / 解压', () => {
  it('往返：打包带中文文件名的文件夹再解压', async () => {
    const src = path.join(tmp, '资料夹')
    fs.mkdirSync(path.join(src, '子目录'), { recursive: true })
    fs.writeFileSync(path.join(src, '说明.txt'), '中文内容')
    fs.writeFileSync(path.join(src, '子目录', '数据.csv'), 'a,b\n1,2')
    const outRoot = path.join(tmp, 'zip-out')
    fs.mkdirSync(outRoot, { recursive: true })
    const packed = await packZip({ dir: src, zipName: '我的资料', outDir: outRoot })
    expect(packed.count).toBe(2)
    expect(path.basename(packed.outputPath)).toBe('我的资料.zip')

    const unpackRoot = path.join(tmp, 'zip-unpack')
    fs.mkdirSync(unpackRoot, { recursive: true })
    const r = await unpackZip({ paths: [packed.outputPath], outDir: unpackRoot })
    expect(r.outputs).toHaveLength(1)
    expect(fs.readFileSync(path.join(r.outputs[0], '说明.txt'), 'utf-8')).toBe('中文内容')
    expect(fs.readFileSync(path.join(r.outputs[0], '子目录', '数据.csv'), 'utf-8')).toBe('a,b\n1,2')
  })

  it('挑选若干文件打包，保留共同父目录层级', async () => {
    const base = path.join(tmp, 'picked')
    fs.mkdirSync(path.join(base, 'a'), { recursive: true })
    fs.mkdirSync(path.join(base, 'b'), { recursive: true })
    const f1 = path.join(base, 'a', 'one.txt')
    const f2 = path.join(base, 'b', 'two.txt')
    fs.writeFileSync(f1, '1')
    fs.writeFileSync(f2, '2')
    const outRoot = path.join(tmp, 'picked-out')
    fs.mkdirSync(outRoot, { recursive: true })
    const packed = await packZip({ paths: [f1, f2], zipName: '选集', outDir: outRoot, level: 'max' })
    expect(packed.count).toBe(2)
    const zip = new PizZip(fs.readFileSync(packed.outputPath))
    expect(Object.keys(zip.files).sort()).toEqual(['a/one.txt', 'b/two.txt'])
  })

  it('预览打包清单：返回文件列表与总字节数', async () => {
    const dir = path.join(tmp, 'preview')
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(path.join(dir, 'x.txt'), 'hello')
    const list = await listZipContents({ dir })
    expect(list.files.map(f => f.rel)).toEqual(['x.txt'])
    expect(list.totalBytes).toBe(5)
  })

  it('加密 zip 解压时给出明确提示而非“文件损坏”', async () => {
    // 构造带通用位标志 bit0 的伪中央目录，验证 detectEncryptedZip 分支
    const buf = Buffer.alloc(64)
    const eocd = 22
    buf.writeUInt32LE(0x06054b50, eocd) // EOCD 签名
    buf.writeUInt16LE(1, eocd + 10) // 条目数
    buf.writeUInt32LE(0, eocd + 16) // 中央目录偏移 = 0
    buf.writeUInt32LE(0x02014b50, 0) // 中央目录条目签名
    buf.writeUInt16LE(0x0001, 8) // 通用位标志 bit0 = 加密
    buf.writeUInt16LE(0, 28) // 文件名长度
    buf.writeUInt16LE(0, 30) // 扩展字段长度
    buf.writeUInt16LE(0, 32) // 注释长度
    const bad = path.join(tmp, 'locked.zip')
    fs.writeFileSync(bad, buf)
    const outRoot = path.join(tmp, 'locked-out')
    fs.mkdirSync(outRoot, { recursive: true })
    await expect(unpackZip({ paths: [bad], outDir: outRoot })).rejects.toThrow(/已加密/)
  })
})
