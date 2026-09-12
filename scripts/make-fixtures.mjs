/**
 * 生成 UI 冒烟测试素材：纯色/渐变 PNG、二维码、测试 xlsx。
 * node scripts/make-fixtures.mjs
 */
import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const ROOT = path.resolve(import.meta.dirname, '..')
const IMG = path.join(ROOT, '.ftest', 'img')
fs.mkdirSync(IMG, { recursive: true })

/* ---- 最小 PNG 编码器（RGB8） ---- */
function crc32(buf) {
  let c, table = crc32.t
  if (!table) {
    table = crc32.t = new Int32Array(256)
    for (let n = 0; n < 256; n++) {
      c = n
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
      table[n] = c
    }
  }
  c = ~0
  for (let i = 0; i < buf.length; i++) c = table[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return ~c >>> 0
}
function chunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body))
  return Buffer.concat([len, body, crc])
}
function writePng(file, w, h, rgb) {
  const raw = Buffer.alloc((w * 3 + 1) * h)
  let o = 0
  for (let y = 0; y < h; y++) {
    raw[o++] = 0
    for (let x = 0; x < w; x++) {
      const [r, g, b] = rgb(x, y)
      raw[o++] = r
      raw[o++] = g
      raw[o++] = b
    }
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(w, 0)
  ihdr.writeUInt32BE(h, 4)
  ihdr[8] = 8
  ihdr[9] = 2
  fs.writeFileSync(
    file,
    Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      chunk('IHDR', ihdr),
      chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
      chunk('IEND', Buffer.alloc(0))
    ])
  )
  console.log('png:', file)
}

// 拼接素材：三张不同尺寸色块图
writePng(path.join(IMG, 'seg1.png'), 400, 300, (x) => [20 + x / 8, 60, 140])
writePng(path.join(IMG, 'seg2.png'), 400, 250, (x, y) => [220, 180 - y / 4, 40])
writePng(path.join(IMG, 'seg3.png'), 400, 350, (x, y) => [30 + y / 6, 160, 90 + x / 8])
// 证件照素材：一寸比例 295×413 @300dpi，肤色渐变
writePng(path.join(IMG, 'idphoto.png'), 295, 413, (x, y) => [
  200 - Math.abs(x - 147) / 3,
  170 - Math.abs(y - 200) / 6,
  150 - Math.abs(x - 147) / 4
])

/* ---- 二维码 ---- */
const QR = 'https://example.com/freetool-test'
const QR_FILE = path.join(IMG, 'qr-test.png')
const QRCode = require('qrcode')
await QRCode.toFile(QR_FILE, QR, { width: 480, margin: 2 })
console.log('qr:', QR_FILE, '->', QR)

/* ---- Excel 素材 ---- */
const ExcelJS = require('exceljs')
async function sheet(file, headers, rows) {
  const wb = new ExcelJS.Workbook()
  const ws = wb.addWorksheet('Sheet1')
  ws.addRow(headers)
  for (const r of rows) ws.addRow(r)
  await wb.xlsx.writeFile(file)
  console.log('xlsx:', file)
}
const F = n => path.join(ROOT, '.ftest', n)
await sheet(F('主表.xlsx'), ['工号', '姓名'], [['001', '张三'], ['002', '李四'], ['003', '王五']])
await sheet(F('副表.xlsx'), ['工号', '部门', '电话'], [['001', '网络部', '13800000001'], ['002', '运维部', '13800000002'], ['003', '综合部', '13800000003']])
await sheet(F('名单A.xlsx'), ['工号', '姓名', '手机'], [['001', '张三', '13800000001'], ['002', '李四', '13800000002'], ['004', '赵六', '13800000004']])
await sheet(F('名单B.xlsx'), ['工号', '姓名', '手机'], [['001', '张三', '13800000001'], ['002', '李四', '13900000002'], ['003', '王五', '13800000003']])
await sheet(F('名单加拼音.xlsx'), ['姓名', '单位'], [['张三', '网络部'], ['李四', '运维部'], ['王五', '综合部']])
