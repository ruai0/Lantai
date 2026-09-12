/**
 * 生成应用图标：build/icon.png (256 RGBA) 与 build/icon.ico（PNG-in-ICO，Vista+ 支持）。
 * 设计语言对齐界面：墨蓝圆角底 + 白色文档 + 琥珀折角/信号点。
 * node scripts/make-icon.mjs
 */
import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'

const ROOT = path.resolve(import.meta.dirname, '..')
const OUT = path.join(ROOT, 'build')
fs.mkdirSync(OUT, { recursive: true })

const SIZE = 256
const SS = 4 // 超采样倍数，消除斜边锯齿

/* ---- 设计令牌 ---- */
const INK = [22, 32, 46, 255] // #16202e
const PAGE = [255, 255, 255, 255]
const LINE = [82, 97, 122, 255] // #52617a
const AMBER = [242, 167, 59, 255] // #f2a73b
const CLEAR = [0, 0, 0, 0]

function inRounded(x, y, r) {
  if (x < r && y < r) return (x - r) ** 2 + (y - r) ** 2 <= r * r
  if (x >= SIZE - r && y < r) return (x - (SIZE - r)) ** 2 + (y - r) ** 2 <= r * r
  if (x < r && y >= SIZE - r) return (x - r) ** 2 + (y - (SIZE - r)) ** 2 <= r * r
  if (x >= SIZE - r && y >= SIZE - r) return (x - (SIZE - r)) ** 2 + (y - (SIZE - r)) ** 2 <= r * r
  return true
}

/** 单点取色（超采样坐标用浮点） */
function pixel(x, y) {
  if (!inRounded(x, y, 56)) return CLEAR
  let c = INK
  // 文档页（右上角折角）
  const pageL = 72
  const pageR = 184
  const pageT = 56
  const pageB = 200
  const fold = 36
  const inPage = x >= pageL && x < pageR && y >= pageT && y < pageB
  const cut = pageR - x + (y - pageT) < fold
  if (inPage && !cut) {
    c = PAGE
    // 三行文字
    const rows = [
      [92, 100, 156],
      [116, 124, 156],
      [140, 148, 140]
    ]
    for (const [t, b, r] of rows) {
      if (y >= t && y < b && x >= 92 && x < r) c = LINE
    }
  }
  // 折角（琥珀色三角带）
  const d = pageR - x + (y - pageT)
  if (x >= pageL && x < pageR && y >= pageT && y < pageB && d >= fold && d < fold + 10) c = AMBER
  // 琥珀信号点
  if ((x - 190) ** 2 + (y - 194) ** 2 <= 20 * 20) c = AMBER
  return c
}

/* ---- 超采样渲染 ---- */
const img = new Uint8Array(SIZE * SIZE * 4)
for (let py = 0; py < SIZE; py++) {
  for (let px = 0; px < SIZE; px++) {
    const acc = [0, 0, 0, 0]
    for (let sy = 0; sy < SS; sy++) {
      for (let sx = 0; sx < SS; sx++) {
        const c = pixel(px + (sx + 0.5) / SS, py + (sy + 0.5) / SS)
        // 预乘 alpha 平均，避免透明边缘发黑
        acc[0] += c[0] * (c[3] / 255)
        acc[1] += c[1] * (c[3] / 255)
        acc[2] += c[2] * (c[3] / 255)
        acc[3] += c[3]
      }
    }
    const n = SS * SS
    const a = acc[3] / n
    const o = (py * SIZE + px) * 4
    if (a > 0) {
      img[o] = Math.round(acc[0] / n / (a / 255))
      img[o + 1] = Math.round(acc[1] / n / (a / 255))
      img[o + 2] = Math.round(acc[2] / n / (a / 255))
    }
    img[o + 3] = Math.round(a)
  }
}

/* ---- PNG 编码（RGBA） ---- */
function crc32(buf) {
  let c
  let table = crc32.t
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
const raw = Buffer.alloc((SIZE * 4 + 1) * SIZE)
{
  let o = 0
  for (let y = 0; y < SIZE; y++) {
    raw[o++] = 0
    for (let x = 0; x < SIZE * 4; x++) raw[o++] = img[y * SIZE * 4 + x]
  }
}
const ihdr = Buffer.alloc(13)
ihdr.writeUInt32BE(SIZE, 0)
ihdr.writeUInt32BE(SIZE, 4)
ihdr[8] = 8 // bit depth
ihdr[9] = 6 // RGBA
const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk('IHDR', ihdr),
  chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
  chunk('IEND', Buffer.alloc(0))
])
fs.writeFileSync(path.join(OUT, 'icon.png'), png)

/* ---- ICO（单张 256，PNG 负载） ---- */
const head = Buffer.alloc(6)
head.writeUInt16LE(0, 0) // reserved
head.writeUInt16LE(1, 2) // type: icon
head.writeUInt16LE(1, 4) // count
const entry = Buffer.alloc(16)
entry[0] = 0 // 256 宽（0 表示 256）
entry[1] = 0 // 256 高
entry[2] = 0 // 调色板
entry[3] = 0
entry.writeUInt16LE(1, 4) // planes
entry.writeUInt16LE(32, 6) // bpp
entry.writeUInt32LE(png.length, 8) // 数据长度
entry.writeUInt32LE(22, 12) // 数据偏移
fs.writeFileSync(path.join(OUT, 'icon.ico'), Buffer.concat([head, entry, png]))

console.log('written:', path.join(OUT, 'icon.png'), png.length, 'bytes')
console.log('written:', path.join(OUT, 'icon.ico'), 22 + png.length, 'bytes')
