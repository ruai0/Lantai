/**
 * AES-128 解密（纯 TypeScript，仅解密方向）。
 *
 * 用途：PDF 标准加密 V4/AESV2（R4）的流与字符串解密（PDF 32000-1 §7.6）。
 * 这里的算法由 PDF 规范对既有加密文档的互操作要求决定：要读取这类文件
 * 就必须按规范实现 AES-128-CBC 解密，不存在换用更强算法的选项；
 * 本模块只解密既有数据，不引入任何新的加密保护设计。
 *
 * S 盒由有限域求逆 + 仿射变换按标准构造生成（不抄表，避免转录错误），
 * 正确性由 FIPS-197 与 NIST SP 800-38A 的公开测试向量锁定（tests/pdfAes.test.ts）。
 */

/** GF(2^8) 乘法，模多项式 x^8+x^4+x^3+x+1 (0x11b) */
function gmul(a: number, b: number): number {
  let p = 0
  for (let i = 0; i < 8; i++) {
    if (b & 1) p ^= a
    const hi = a & 0x80
    a = (a << 1) & 0xff
    if (hi) a ^= 0x1b
    b >>= 1
  }
  return p
}

function gfInv(a: number): number {
  if (a === 0) return 0
  for (let x = 1; x < 256; x++) {
    if (gmul(a, x) === 1) return x
  }
  return 0
}

const rotl8 = (b: number, n: number): number => ((b << n) | (b >>> (8 - n))) & 0xff

/** AES S 盒：乘法逆元 + 固定仿射变换（FIPS-197 §5.3.2） */
const SBOX = Uint8Array.from({ length: 256 }, (_, i) => {
  const inv = gfInv(i)
  return inv ^ rotl8(inv, 1) ^ rotl8(inv, 2) ^ rotl8(inv, 3) ^ rotl8(inv, 4) ^ 0x63
})
const INV_SBOX = Uint8Array.from({ length: 256 }, (_, i) => SBOX.indexOf(i))

/** InvMixColumns 系数表 {09,0b,0d,0e} */
const M9 = Uint8Array.from({ length: 256 }, (_, i) => gmul(i, 0x09))
const MB = Uint8Array.from({ length: 256 }, (_, i) => gmul(i, 0x0b))
const MD = Uint8Array.from({ length: 256 }, (_, i) => gmul(i, 0x0d))
const ME = Uint8Array.from({ length: 256 }, (_, i) => gmul(i, 0x0e))

/** AES-128 轮密钥扩展：11 组 16 字节（44 个 32 位字） */
export function keyExpansion128(key: Uint8Array): Uint8Array[] {
  if (key.length !== 16) throw new Error('AES-128 密钥必须 16 字节')
  const w = new Uint8Array(176)
  w.set(key)
  let rcon = 1
  for (let i = 16; i < 176; i += 4) {
    let t0 = w[i - 4]!
    let t1 = w[i - 3]!
    let t2 = w[i - 2]!
    let t3 = w[i - 1]!
    if (i % 16 === 0) {
      // RotWord + SubWord + Rcon
      const a = t0
      t0 = SBOX[t1]! ^ rcon
      t1 = SBOX[t2]!
      t2 = SBOX[t3]!
      t3 = SBOX[a]!
      rcon = (rcon << 1) ^ (rcon & 0x80 ? 0x11b : 0)
      rcon &= 0xff
    }
    w[i] = w[i - 16]! ^ t0
    w[i + 1] = w[i - 15]! ^ t1
    w[i + 2] = w[i - 14]! ^ t2
    w[i + 3] = w[i - 13]! ^ t3
  }
  const rounds: Uint8Array[] = []
  for (let r = 0; r < 11; r++) rounds.push(w.slice(r * 16, r * 16 + 16))
  return rounds
}

function addRoundKey(s: Uint8Array, rk: Uint8Array): void {
  for (let i = 0; i < 16; i++) s[i] ^= rk[i]!
}

function invSubBytes(s: Uint8Array): void {
  for (let i = 0; i < 16; i++) s[i] = INV_SBOX[s[i]!]!
}

function invShiftRows(s: Uint8Array): void {
  // 行 r = 下标 r, r+4, r+8, r+12，解密方向循环右移 r 位
  let t = s[13]!
  s[13] = s[9]!
  s[9] = s[5]!
  s[5] = s[1]!
  s[1] = t
  t = s[2]!
  s[2] = s[10]!
  s[10] = t
  t = s[6]!
  s[6] = s[14]!
  s[14] = t
  t = s[3]!
  s[3] = s[7]!
  s[7] = s[11]!
  s[11] = s[15]!
  s[15] = t
}

function invMixColumns(s: Uint8Array): void {
  for (let c = 0; c < 16; c += 4) {
    const a0 = s[c]!
    const a1 = s[c + 1]!
    const a2 = s[c + 2]!
    const a3 = s[c + 3]!
    s[c] = ME[a0]! ^ MB[a1]! ^ MD[a2]! ^ M9[a3]!
    s[c + 1] = M9[a0]! ^ ME[a1]! ^ MB[a2]! ^ MD[a3]!
    s[c + 2] = MD[a0]! ^ M9[a1]! ^ ME[a2]! ^ MB[a3]!
    s[c + 3] = MB[a0]! ^ MD[a1]! ^ M9[a2]! ^ ME[a3]!
  }
}

/** 解密单个 16 字节块（FIPS-197 §5.3.5 InvCipher，标准轮密钥序） */
export function aes128DecryptBlock(block: Uint8Array, rounds: Uint8Array[]): Uint8Array {
  const s = Uint8Array.from(block)
  addRoundKey(s, rounds[10]!)
  for (let r = 9; r >= 1; r--) {
    invShiftRows(s)
    invSubBytes(s)
    addRoundKey(s, rounds[r]!)
    invMixColumns(s)
  }
  invShiftRows(s)
  invSubBytes(s)
  addRoundKey(s, rounds[0]!)
  return s
}

/**
 * AES-128-CBC 解密（无填充剥离，填充由调用方按 PDF 规范处理）。
 * 输入 = IV(16 字节) + 密文（16 的倍数），输出明文。
 */
export function aes128CbcDecrypt(iv: Uint8Array, key: Uint8Array, data: Uint8Array): Uint8Array {
  if (data.length === 0 || data.length % 16 !== 0) throw new Error('AES 密文长度必须是 16 的倍数')
  const rounds = keyExpansion128(key)
  const out = new Uint8Array(data.length)
  let prev = Uint8Array.from(iv.subarray(0, 16))
  for (let off = 0; off < data.length; off += 16) {
    const block = aes128DecryptBlock(data.subarray(off, off + 16), rounds)
    for (let i = 0; i < 16; i++) out[off + i] = block[i]! ^ prev[i]!
    prev = Uint8Array.from(data.subarray(off, off + 16))
  }
  return out
}
