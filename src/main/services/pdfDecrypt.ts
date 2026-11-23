/**
 * PDF 标准加密（Standard security handler）的就地解密。
 *
 * 场景：下载/扫描得到的 PDF 常带「权限密码」（无打开密码，阅读器能直接打开），
 * pdf.js 能正常预览，但 pdf-lib 拷贝页面会产出损坏内容——工作台编辑半天，导出才报错。
 * 这里按 PDF 32000-1 §7.6 的标准算法（Algorithm 1/2/4/5）用空用户口令算出文件密钥，
 * 解密全部字符串与流内容、摘掉 trailer 里的 /Encrypt，之后整条导出链路照常工作。
 *
 * 关于算法选择：MD5 / RC4 / AES-128-CBC 是 PDF 规范对历史加密文档**强制规定**的
 * 互操作算法——要读取这类既有文件就必须原样实现，不存在换用更强算法的余地；
 * 本模块只做「按规范解密既有文档」，不引入任何新的加密保护设计。
 *
 * 覆盖范围：V1/V2（RC4 40~128 位，R2/R3）与 V4（加密过滤器 /V2、/AESV2，R4）。
 * V5/R6（AES-256）普遍配对象流，pdf-lib 解析阶段就过不去，明确报「暂不支持」。
 * 设置了打开密码的 PDF 无法自动解密（不知道口令），同样明确报错。
 */
import crypto from 'node:crypto'
import {
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFHexString,
  PDFName,
  PDFNumber,
  PDFObject,
  PDFRawStream,
  PDFRef,
  PDFString
} from 'pdf-lib'
import { aes128CbcDecrypt } from './pdfAes'

/** 标准口令填充串（PDF 32000-1 §7.6.3.3 Algorithm 2 第 1 步） */
export const PAD = Uint8Array.from([
  0x28, 0xbf, 0x4e, 0x5e, 0x4e, 0x75, 0x8a, 0x41, 0x64, 0x00, 0x4e, 0x56, 0xff, 0xfa, 0x01, 0x08,
  0x2e, 0x2e, 0x00, 0xb6, 0xd0, 0x68, 0x3e, 0x80, 0x2f, 0x0c, 0xa9, 0xfe, 0x64, 0x53, 0x69, 0x7a
])

export class PdfDecryptError extends Error {}

/**
 * RC4 流密码（KSA + PRGA），导出供单测做往返校验。
 * 由 PDF 32000-1 §7.6 对 V1/V2 加密的规定所要求，非自选算法。
 */
export function rc4(key: Uint8Array, data: Uint8Array): Uint8Array {
  const s = new Uint8Array(256)
  for (let i = 0; i < 256; i++) s[i] = i
  let j = 0
  for (let i = 0; i < 256; i++) {
    j = (j + s[i]! + key[i % key.length]!) & 0xff
    const t = s[i]!
    s[i] = s[j]!
    s[j] = t
  }
  const out = new Uint8Array(data.length)
  let a = 0
  j = 0
  for (let k = 0; k < data.length; k++) {
    a = (a + 1) & 0xff
    j = (j + s[a]!) & 0xff
    const t = s[a]!
    s[a] = s[j]!
    s[j] = t
    out[k] = data[k]! ^ s[(s[a]! + s[j]!) & 0xff]!
  }
  return out
}

/** 规范规定的密钥推导摘要：PDF 32000-1 §7.6 全部基于 MD5，无法替换 */
function pdfSpecDigest(...parts: Uint8Array[]): Buffer {
  const h = crypto.createHash('md5') // PDF 32000-1 §7.6 规定的摘要算法（互操作要求，见文件头说明）
  for (const p of parts) h.update(p)
  return h.digest()
}

/**
 * 文件加密密钥（Algorithm 2）。password 传标准填充后的 32 字节；
 * keyLen 为密钥字节数（40 位加密是 5，128 位是 16）。
 */
export function computeFileKey(
  password: Uint8Array,
  o: Uint8Array,
  p: number,
  id0: Uint8Array,
  r: number,
  keyLen: number,
  encryptMetadata: boolean
): Uint8Array {
  const pBuf = Buffer.alloc(4)
  pBuf.writeInt32LE(p | 0, 0)
  const parts: Uint8Array[] = [password.subarray(0, 32), o.subarray(0, 32), pBuf, id0.subarray(0, 16)]
  // 不加密元数据时混入固定标记（仅 R≥4）
  if (r >= 4 && !encryptMetadata) parts.push(Uint8Array.of(0xff, 0xff, 0xff, 0xff))
  let x: Uint8Array = pdfSpecDigest(...parts)
  if (r >= 3) {
    for (let i = 0; i < 50; i++) x = pdfSpecDigest(x.subarray(0, keyLen))
  }
  return x.subarray(0, keyLen)
}

/** 对象密钥（Algorithm 1）：文件密钥拼上对象号/代数再哈希 */
export function objectKey(fileKey: Uint8Array, objNum: number, gen: number): Uint8Array {
  const extra = Buffer.alloc(5)
  extra.writeUIntLE(objNum, 0, 3)
  extra.writeUIntLE(gen, 3, 2)
  const h = pdfSpecDigest(fileKey, extra)
  return h.subarray(0, Math.min(fileKey.length + 5, 16))
}

/** R2 的 /U 校验（Algorithm 4）：U = RC4(key, PAD) */
function checkUserR2(key: Uint8Array, u: Uint8Array): boolean {
  const expected = rc4(key, PAD)
  for (let i = 0; i < 32; i++) {
    if (expected[i] !== u[i]) return false
  }
  return true
}

/** R3/R4 的 /U 校验（Algorithm 5）：只比对前 16 字节（后 16 字节是任意填充） */
function checkUserR3(key: Uint8Array, id0: Uint8Array, u: Uint8Array): boolean {
  let x: Uint8Array = pdfSpecDigest(PAD, id0.subarray(0, 16))
  x = rc4(key, x)
  for (let i = 1; i <= 19; i++) {
    const kx = Uint8Array.from(key, b => b ^ i)
    x = rc4(kx, x)
  }
  for (let i = 0; i < 16; i++) {
    if (x[i] !== u[i]) return false
  }
  return true
}

/** 用对象密钥解一段数据；AES 先去 IV 再剥 16 字节填充 */
function decryptWithKey(key: Uint8Array, data: Uint8Array, aes: boolean): Uint8Array {
  if (!aes) return rc4(key, data)
  if (key.length !== 16) throw new PdfDecryptError('AES-128 加密密钥长度异常')
  if (data.length < 32 || data.length % 16 !== 0) throw new PdfDecryptError('AES 加密数据长度异常')
  const plain = aes128CbcDecrypt(data.subarray(0, 16), key, data.subarray(16))
  const pad = plain[plain.length - 1]
  if (pad >= 1 && pad <= 16) return plain.subarray(0, plain.length - pad)
  return plain
}

function bytesOf(obj: PDFObject | undefined, what: string): Uint8Array {
  if (obj instanceof PDFString) return obj.asBytes()
  if (obj instanceof PDFHexString) return obj.asBytes()
  throw new PdfDecryptError(`加密字典缺少 ${what}，无法解密`)
}

function nameText(obj: PDFObject | undefined): string {
  // pdf-lib 的 PDFName.asString() 带前导斜杠（/Standard），统一剥掉再比较
  if (obj instanceof PDFName) return obj.asString().replace(/^\//, '')
  return ''
}

/** 从加密字典/加密过滤器取整数，缺省给 fallback */
function intOf(dict: PDFDict, name: string, fallback: number): number {
  const n = dict.get(PDFName.of(name))
  return n instanceof PDFNumber ? n.asNumber() : fallback
}

/**
 * 就地解密一个已加载（ignoreEncryption）的加密 PDF 文档。
 * 成功后 trailer 的 /Encrypt 被摘除，后续 copyPages / save 走未加密路径。
 * 抛 PdfDecryptError 表示无法自动解密（设了打开密码 / 不支持的加密版本）。
 */
export function decryptStandard(doc: PDFDocument): void {
  const ctx = doc.context
  const encRef = ctx.trailerInfo.Encrypt
  const enc = ctx.lookup(encRef)
  if (!(enc instanceof PDFDict)) throw new PdfDecryptError('无法读取该 PDF 的加密信息')
  if (nameText(enc.get(PDFName.of('Filter'))) !== 'Standard') {
    throw new PdfDecryptError('仅支持标准密码加密的 PDF')
  }

  const v = intOf(enc, 'V', 0)
  const r = intOf(enc, 'R', 0)
  if (v >= 5 || r >= 5) {
    throw new PdfDecryptError('该 PDF 使用 AES-256（R6）加密，暂不支持自动解密')
  }
  if (r < 2 || r > 4) {
    throw new PdfDecryptError(`不支持的加密版本 R${r}`)
  }

  let bits = intOf(enc, 'Length', 40)
  // 个别写入器把「字节数」写进 /Length（16 字节），按位处理前先纠正
  if (bits <= 16) bits *= 8
  let keyLen = Math.min(16, Math.max(5, Math.floor(bits / 8)))

  const em = enc.get(PDFName.of('EncryptMetadata'))
  const emText = em ? nameText(em) : 'true'
  const encryptMetadata = emText !== 'false'

  const idArr = ctx.lookup(ctx.trailerInfo.ID)
  if (!(idArr instanceof PDFArray)) throw new PdfDecryptError('该 PDF 缺少文件 ID，无法解密')
  const id0 = bytesOf(idArr.get(0), '/ID')
  const o = bytesOf(enc.get(PDFName.of('O')), '/O')
  const u = bytesOf(enc.get(PDFName.of('U')), '/U')
  const p = intOf(enc, 'P', -1)

  // V4 走加密过滤器：确认字符串流与普通流各用什么算法
  let streamAes = false
  let stringAes = false
  if (v === 4) {
    const cf = enc.get(PDFName.of('CF'))
    const cfDict = cf instanceof PDFRef ? ctx.lookup(cf) : cf
    const cfm = (filterName: string): 'rc4' | 'aes' | 'none' => {
      if (!filterName || filterName === 'Identity') return 'none'
      if (!(cfDict instanceof PDFDict)) return 'rc4'
      const f = cfDict.get(PDFName.of(filterName))
      const fDict = f instanceof PDFRef ? ctx.lookup(f) : f
      if (!(fDict instanceof PDFDict)) return 'rc4'
      const method = nameText(fDict.get(PDFName.of('CFM')))
      if (method === 'AESV2') {
        keyLen = 16
        return 'aes'
      }
      if (method === 'AESV3') throw new PdfDecryptError('该 PDF 使用 AES-256 加密，暂不支持自动解密')
      return 'rc4'
    }
    const stmF = nameText(enc.get(PDFName.of('StmF')))
    const strF = nameText(enc.get(PDFName.of('StrF')))
    streamAes = cfm(stmF || strF) === 'aes'
    stringAes = cfm(strF || stmF) === 'aes'
  } else if (v === 3) {
    throw new PdfDecryptError('不支持的加密算法 V3')
  }

  // 空用户口令推导文件密钥并校验 /U；对不上说明设了打开密码
  const key = computeFileKey(PAD, o, p, id0, r, keyLen, encryptMetadata)
  const userOk = r === 2 ? checkUserR2(key, u) : checkUserR3(key, id0, u)
  if (!userOk) {
    throw new PdfDecryptError('该 PDF 设置了打开密码，无法自动解密；请先用密码打开并另存为不加密的副本')
  }

  const visited = new Set<string>()

  /** 解一个字符串对象，返回替换用的十六进制串（写入安全，语义等价） */
  function decStr(bytes: Uint8Array, objNum: number, gen: number): PDFHexString {
    const plain = decryptWithKey(objectKey(key, objNum, gen), bytes, stringAes)
    return PDFHexString.of(Buffer.from(plain).toString('hex'))
  }

  /** 沿引用深入子对象（带去重），流对象解密内容、其余继续走字符串遍历 */
  function descend(ref: PDFRef): void {
    const k = ref.toString()
    if (visited.has(k)) return
    visited.add(k)
    if (encRef === ref) return // 加密字典自己的 O/U 不参与加密
    const obj = ctx.lookup(ref)
    if (!obj) return
    if (obj instanceof PDFRawStream) decryptStream(ref, obj)
    else walk(obj, ref.objectNumber, ref.generationNumber)
  }

  /** 递归解字典/数组里的字符串；引用型子对象由 descend 统一去重 */
  function walk(obj: PDFObject, objNum: number, gen: number): void {
    if (obj instanceof PDFDict) {
      for (const [k, val] of obj.entries()) {
        if (val instanceof PDFString || val instanceof PDFHexString) {
          obj.set(k, decStr(val.asBytes(), objNum, gen))
        } else if (val instanceof PDFRef) {
          descend(val)
        } else if (val instanceof PDFDict || val instanceof PDFArray) {
          walk(val, objNum, gen)
        }
      }
    } else if (obj instanceof PDFArray) {
      for (let i = 0; i < obj.size(); i++) {
        const val = obj.get(i)
        if (val instanceof PDFString || val instanceof PDFHexString) {
          obj.set(i, decStr(val.asBytes(), objNum, gen))
        } else if (val instanceof PDFRef) {
          descend(val)
        } else if (val instanceof PDFDict || val instanceof PDFArray) {
          walk(val, objNum, gen)
        }
      }
    }
  }

  function decryptStream(ref: PDFRef, obj: PDFRawStream): void {
    const oKey = objectKey(key, ref.objectNumber, ref.generationNumber)
    const plain = decryptWithKey(oKey, obj.contents, streamAes)
    walk(obj.dict, ref.objectNumber, ref.generationNumber)
    ctx.assign(ref, PDFRawStream.of(obj.dict, plain))
  }

  for (const [ref, obj] of ctx.enumerateIndirectObjects()) {
    if (ref === encRef) continue
    if (obj instanceof PDFRawStream) decryptStream(ref, obj)
    else walk(obj, ref.objectNumber, ref.generationNumber)
  }

  delete (ctx.trailerInfo as { Encrypt?: unknown }).Encrypt
}
