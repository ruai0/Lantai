/**
 * 应用图标管线：从 brand/lantai-source.png（2048 源图）自动派生全部尺寸。
 *   node scripts/make-icon.mjs
 * 处理：定位琥珀色印面外接框（裁掉背景与右下角水印）→ 圆角矩形 alpha 蒙版（外圈透明）
 *      → 预乘 alpha 面积平均降采样 → build/icon.png(256) / public/logo.png(128) / public/tray.png(32)
 * 依赖：仅 node:zlib（内置 PNG 解码支持 8bit RGB/RGBA，含 Adam7 隔行——生图工具常输出隔行 PNG）。
 */
import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'

const ROOT = path.resolve(import.meta.dirname, '..')
const SRC = path.join(ROOT, 'brand', 'lantai-source.png')

/* ---------- PNG 解码（8bit，RGB/RGBA/灰度/灰+A，支持 Adam7 隔行） ---------- */
function decodePng(buf) {
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error('不是 PNG')
  let off = 8
  let width = 0
  let height = 0
  let color = 0
  let interlace = 0
  const idat = []
  while (off < buf.length) {
    const len = buf.readUInt32BE(off)
    const type = buf.toString('ascii', off + 4, off + 8)
    const data = buf.subarray(off + 8, off + 8 + len)
    if (type === 'IHDR') {
      width = data.readUInt32BE(0)
      height = data.readUInt32BE(4)
      if (data[8] !== 8) throw new Error('仅支持 8bit PNG')
      color = data[9]
      interlace = data[12]
    } else if (type === 'IDAT') idat.push(data)
    else if (type === 'IEND') break
    off += 12 + len
  }
  const ch = color === 6 ? 4 : color === 2 ? 3 : color === 0 ? 1 : color === 4 ? 2 : 0
  if (!ch) throw new Error('不支持的颜色类型 ' + color)
  const raw = zlib.inflateSync(Buffer.concat(idat))
  const out = Buffer.alloc(width * height * 4)

  /** 解一组扫描线（一个非隔行区域），写入全图 (x0,y0) 起、步长 (sx,sy) 的位置 */
  let p = 0
  function decodeRegion(w, h, x0, y0, sx, sy) {
    const stride = w * ch
    let prev = Buffer.alloc(stride)
    for (let y = 0; y < h; y++) {
      const f = raw[p++]
      const line = raw.subarray(p, p + stride)
      p += stride
      const cur = Buffer.from(line)
      for (let x = 0; x < stride; x++) {
        const a = x >= ch ? cur[x - ch] : 0
        const b = prev[x]
        const c = x >= ch ? prev[x - ch] : 0
        let v = line[x]
        if (f === 1) v = (v + a) & 255
        else if (f === 2) v = (v + b) & 255
        else if (f === 3) v = (v + ((a + b) >> 1)) & 255
        else if (f === 4) {
          const pp = a + b - c
          const pa = Math.abs(pp - a)
          const pb = Math.abs(pp - b)
          const pc = Math.abs(pp - c)
          const pr = pa <= pb && pa <= pc ? a : pb <= pc ? b : c
          v = (v + pr) & 255
        }
        cur[x] = v
      }
      const gy = y0 + y * sy
      for (let x = 0; x < w; x++) {
        const o = (gy * width + x0 + x * sx) * 4
        if (color === 6) {
          out[o] = cur[x * 4]
          out[o + 1] = cur[x * 4 + 1]
          out[o + 2] = cur[x * 4 + 2]
          out[o + 3] = cur[x * 4 + 3]
        } else if (color === 2) {
          out[o] = cur[x * 3]
          out[o + 1] = cur[x * 3 + 1]
          out[o + 2] = cur[x * 3 + 2]
          out[o + 3] = 255
        } else if (color === 0) {
          out[o] = out[o + 1] = out[o + 2] = cur[x]
          out[o + 3] = 255
        } else {
          out[o] = out[o + 1] = out[o + 2] = cur[x * 2]
          out[o + 3] = cur[x * 2 + 1]
        }
      }
      prev = cur
    }
  }

  if (interlace === 0) {
    decodeRegion(width, height, 0, 0, 1, 1)
  } else if (interlace === 1) {
    // Adam7 七遍：{x起始,x步长,y起始,y步长}
    const passes = [
      [0, 8, 0, 8],
      [4, 8, 0, 8],
      [0, 4, 0, 4],
      [2, 4, 0, 2],
      [0, 2, 0, 2],
      [1, 2, 0, 1],
      [0, 1, 1, 1]
    ]
    for (const [xs, xstep, ys, ystep] of passes) {
      const w = Math.ceil((width - xs) / xstep)
      const h = Math.ceil((height - ys) / ystep)
      if (w > 0 && h > 0) decodeRegion(w, h, xs, ys, xstep, ystep)
    }
  } else throw new Error('不支持的隔行方式 ' + interlace)
  return { width, height, data: out }
}

/* ---------- 琥珀印面定位 ---------- */
function isAmber(r, g, b) {
  return r > 140 && g > 80 && r > b + 40
}

/**
 * 行/列投影法：背景噪点会让个别像素命中琥珀色，外接框会被拉爆；
 * 改为「该行/列命中数超过 30% 才算进入印面」，对孤立噪点免疫。
 */
function amberBox(img) {
  const rowHits = new Int32Array(img.height)
  const colHits = new Int32Array(img.width)
  for (let y = 0; y < img.height; y++) {
    for (let x = 0; x < img.width; x++) {
      const o = (y * img.width + x) * 4
      if (isAmber(img.data[o], img.data[o + 1], img.data[o + 2])) {
        rowHits[y]++
        colHits[x]++
      }
    }
  }
  const span = hits => {
    const th = Math.max(2, Math.round((hits === rowHits ? img.height : img.width) * 0.3))
    let lo = -1
    let hi = -1
    for (let i = 0; i < hits.length; i++) {
      if (hits[i] >= th) {
        if (lo < 0) lo = i
        hi = i
      }
    }
    if (lo < 0) throw new Error('源图里找不到琥珀色印面')
    return [lo, hi - lo + 1]
  }
  const [x, w] = span(colHits)
  const [y, h] = span(rowHits)
  return { x, y, w, h }
}

/* ---------- 圆角蒙版 + 降采样 ---------- */
/**
 * 印面蒙版（源分辨率）：每行取琥珀色最左/最右像素之间为内部。
 * 天然贴合圆角轮廓，「兰」字的深色笔画被行跨度自动填实；边缘抗锯齿交给降采样。
 */
function buildMask(img, box) {
  const mask = new Uint8Array(box.w * box.h)
  for (let y = 0; y < box.h; y++) {
    let lo = -1
    let hi = -1
    for (let x = 0; x < box.w; x++) {
      const o = (box.y + y) * img.width * 4 + (box.x + x) * 4
      if (isAmber(img.data[o], img.data[o + 1], img.data[o + 2])) {
        if (lo < 0) lo = x
        hi = x
      }
    }
    if (lo < 0) continue
    for (let x = lo; x <= hi; x++) mask[y * box.w + x] = 1
  }
  return mask
}

function render(src, srcBox, mask, size) {
  const scale = srcBox.w / size
  const out = Buffer.alloc(size * size * 4)
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let acc = [0, 0, 0, 0]
      // 每输出像素 4×4 网格超采样，非整数缩放比也均匀
      for (let j = 0; j < 4; j++) {
        for (let i = 0; i < 4; i++) {
          const sx = Math.min(srcBox.w - 1, Math.floor((x + (i + 0.5) / 4) * scale))
          const sy = Math.min(srcBox.h - 1, Math.floor((y + (j + 0.5) / 4) * scale))
          const o = (srcBox.y + sy) * src.width * 4 + (srcBox.x + sx) * 4
          const a = mask[sy * srcBox.w + sx] ? 255 : 0
          // 预乘 alpha 平均，透明边缘不发黑
          acc[0] += src.data[o] * (a / 255)
          acc[1] += src.data[o + 1] * (a / 255)
          acc[2] += src.data[o + 2] * (a / 255)
          acc[3] += a
        }
      }
      const a = acc[3] / 16
      const o = (y * size + x) * 4
      if (a > 0) {
        out[o] = Math.round(acc[0] / 16 / (a / 255))
        out[o + 1] = Math.round(acc[1] / 16 / (a / 255))
        out[o + 2] = Math.round(acc[2] / 16 / (a / 255))
      }
      out[o + 3] = Math.round(a)
    }
  }
  return out
}

/* ---------- PNG 编码 ---------- */
function crc32(buf) {
  let table = crc32.t
  if (!table) {
    table = crc32.t = new Int32Array(256)
    for (let n = 0; n < 256; n++) {
      let c = n
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
      table[n] = c
    }
  }
  let c = ~0
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
function encodePng(size, rgba) {
  const raw = Buffer.alloc((size * 4 + 1) * size)
  let o = 0
  for (let y = 0; y < size; y++) {
    raw[o++] = 0
    rgba.copy(raw, o, y * size * 4, (y + 1) * size * 4)
    o += size * 4
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0)
  ihdr.writeUInt32BE(size, 4)
  ihdr[8] = 8
  ihdr[9] = 6
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ])
}

/* ---------- 主流程 ---------- */
const src = decodePng(fs.readFileSync(SRC))
const box = amberBox(src)

// 调试：node scripts/make-icon.mjs --probe —— 输出命中分布与采样颜色，不写文件
if (process.argv.includes('--probe')) {
  let n = 0
  const samples = []
  for (let i = 0; i < src.width * src.height; i += 997) {
    const o = i * 4
    const r = src.data[o]
    const g = src.data[o + 1]
    const b = src.data[o + 2]
    if (r > 140 && g > 80 && r > b + 40) {
      n++
      if (samples.length < 6) samples.push(`(${i % src.width},${Math.floor(i / src.width)})=${r},${g},${b}`)
    }
  }
  console.log('hit-rate', (n / (src.width * src.height / 997)).toFixed(4), samples.join(' '))
  const at = (x, y) => {
    const o = (y * src.width + x) * 4
    return [src.data[o], src.data[o + 1], src.data[o + 2]].join(',')
  }
  console.log('corner', at(2, 2), '| mid-top', at(src.width >> 1, 2), '| center', at(src.width >> 1, src.height >> 1))
  process.exit(0)
}

// 调试：--thumb <out.png> —— 解码结果 1/8 缩略图，肉眼核对解码正确性
if (process.argv.includes('--thumb')) {
  const out = process.argv[process.argv.indexOf('--thumb') + 1]
  const s = src.width >> 3
  const buf = Buffer.alloc(s * s * 4)
  for (let y = 0; y < s; y++) {
    for (let x = 0; x < s; x++) {
      let r = 0
      let g = 0
      let b = 0
      let a = 0
      for (let j = 0; j < 8; j++) {
        for (let i = 0; i < 8; i++) {
          const o = ((y * 8 + j) * src.width + x * 8 + i) * 4
          r += src.data[o]
          g += src.data[o + 1]
          b += src.data[o + 2]
          a += src.data[o + 3]
        }
      }
      const o = (y * s + x) * 4
      buf[o] = r / 64
      buf[o + 1] = g / 64
      buf[o + 2] = b / 64
      buf[o + 3] = a / 64
    }
  }
  fs.writeFileSync(out, encodePng(s, buf))
  console.log('thumb:', out)
  process.exit(0)
}
// 印面在源图里是正方形；按宽裁，防止检测框因水印残留偏移
const side = Math.min(box.w, box.h)
box.w = side
box.h = side
console.log(`源图 ${src.width}x${src.height}，印面框 ${side}px @(${box.x},${box.y})`)
const mask = buildMask(src, box)

const targets = [
  { file: path.join(ROOT, 'build', 'icon.png'), size: 256 },
  { file: path.join(ROOT, 'src', 'renderer', 'public', 'logo.png'), size: 128 },
  { file: path.join(ROOT, 'src', 'renderer', 'public', 'tray.png'), size: 32 }
]
for (const t of targets) {
  fs.mkdirSync(path.dirname(t.file), { recursive: true })
  const png = encodePng(t.size, render(src, box, mask, t.size))
  fs.writeFileSync(t.file, png)
  console.log('written:', path.relative(ROOT, t.file), png.length, 'bytes')
}
// App.vue 以模块方式 import 侧栏 logo（vite 会解析模板相对路径），public 那份供主进程按文件读
fs.copyFileSync(path.join(ROOT, 'src', 'renderer', 'public', 'logo.png'), path.join(ROOT, 'src', 'renderer', 'src', 'assets', 'logo.png'))

/* ---- 多尺寸 ICO（PNG 负载，Vista+）：256/48/32/16 一次配齐 ---- */
const icoSizes = [256, 48, 32, 16]
const icoImages = icoSizes.map(s => encodePng(s, render(src, box, mask, s)))
const head = Buffer.alloc(6)
head.writeUInt16LE(0, 0)
head.writeUInt16LE(1, 2) // type: icon
head.writeUInt16LE(icoSizes.length, 4)
let offset = 6 + 16 * icoSizes.length
const entries = Buffer.alloc(16 * icoSizes.length)
icoSizes.forEach((s, i) => {
  const e = i * 16
  entries[e] = s >= 256 ? 0 : s // 256 用 0 表示
  entries[e + 1] = s >= 256 ? 0 : s
  entries[e + 3] = 32 // bpp 标记
  entries.writeUInt16LE(1, e + 4) // planes
  entries.writeUInt16LE(32, e + 6)
  entries.writeUInt32LE(icoImages[i].length, e + 8)
  entries.writeUInt32LE(offset, e + 12)
  offset += icoImages[i].length
})
const ico = Buffer.concat([head, entries, ...icoImages])
fs.writeFileSync(path.join(ROOT, 'build', 'icon.ico'), ico)
console.log('written: build/icon.ico', ico.length, 'bytes', '(256/48/32/16)')
