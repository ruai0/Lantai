import { describe, expect, it } from 'vitest'
import { PDFDict, PDFDocument, PDFHexString, PDFName, PDFRawStream, PDFString } from 'pdf-lib'
import {
  computeFileKey,
  decryptStandard,
  objectKey,
  PAD,
  PdfDecryptError,
  rc4
} from '../src/main/services/pdfDecrypt'

function hex(s: string): Uint8Array {
  return Uint8Array.from(s.match(/.{2}/g)!.map(h => parseInt(h, 16)))
}
function toHex(b: Uint8Array): string {
  return Array.from(b, x => x.toString(16).padStart(2, '0')).join('')
}

describe('rc4', () => {
  it('公开测试向量（key="Key", data="Plaintext"）', () => {
    const out = rc4(new TextEncoder().encode('Key'), new TextEncoder().encode('Plaintext'))
    expect(toHex(out)).toBe('bbf316e8d940af0ad3')
  })
})

describe('标准加密密钥推导', () => {
  // 密码为空时 Algorithm 2 的输入是固定填充串，密钥推导应当确定
  it('同一输入两次推导结果一致，且长度取 keyLen', () => {
    const o = new Uint8Array(32).fill(7)
    const id0 = hex('00112233445566778899aabbccddeeff')
    const a = computeFileKey(PAD, o, -1340, id0, 3, 16, true)
    const b = computeFileKey(PAD, o, -1340, id0, 3, 16, true)
    expect(a.length).toBe(16)
    expect(toHex(a)).toBe(toHex(b))
  })

  it('P 值或 ID 不同则密钥不同', () => {
    const o = new Uint8Array(32).fill(1)
    const id0 = hex('000102030405060708090a0b0c0d0e0f')
    const a = computeFileKey(PAD, o, -1, id0, 3, 16, true)
    const b = computeFileKey(PAD, o, -2, id0, 3, 16, true)
    expect(toHex(a)).not.toBe(toHex(b))
  })
})

/**
 * 往返校验：在测试里充当「加密方」（与解密共用 Algorithm 2/5 的对称步骤），
 * 构造一个带加密标记的最小 PDF，跑 decryptStandard 后核对流与字符串是否复原。
 */
async function buildEncryptedDoc(opts: { r: 3; withUserPassword?: boolean }) {
  const doc = await PDFDocument.create()
  doc.addPage([120, 120])
  const ctx = doc.context

  const originalStream = Uint8Array.from({ length: 64 }, (_, i) => i & 0xff)
  const stream = PDFRawStream.of(ctx.obj({ Type: 'XObject', Subtype: 'Image' }), Uint8Array.from(originalStream))
  const streamRef = ctx.register(stream)

  const secretTitle = 'Secret-Title'
  const info = ctx.obj({
    Title: PDFString.of(secretTitle),
    Note: PDFHexString.of('cafe')
  })
  const infoRef = ctx.register(info)
  ctx.trailerInfo.Info = infoRef

  const o = new Uint8Array(32).fill(0xab)
  const id0 = hex('000102030405060708090a0b0c0d0e0f')
  const p = -1340
  const keyLen = 16
  // 用户口令为空时校验串由「空口令密钥」算出；模拟设了打开密码时换成另一把密钥
  const pwKey = opts.withUserPassword
    ? computeFileKey(PAD.map(b => b ^ 0x5a), o, p, id0, opts.r, keyLen, true)
    : computeFileKey(PAD, o, p, id0, opts.r, keyLen, true)

  // Algorithm 5（R3）：U = RC4 链（加密与解密同形）
  let u: Uint8Array = new Uint8Array(0)
  if (opts.r === 3) {
    // 用 node:crypto 在测试里做 MD5（测试文件不受主实现约束）
    const { createHash } = await import('node:crypto')
    const md5 = (...parts: Uint8Array[]) => {
      const h = createHash('md5')
      for (const x of parts) h.update(x)
      return new Uint8Array(h.digest())
    }
    u = rc4(pwKey, md5(PAD, id0))
    for (let i = 1; i <= 19; i++) u = rc4(Uint8Array.from(pwKey, b => b ^ i), u)
  }

  const encDict = ctx.obj({
    Filter: 'Standard',
    V: 2,
    R: opts.r,
    Length: 128,
    P: p,
    O: PDFHexString.of(Buffer.from(o).toString('hex')),
    U: PDFHexString.of(Buffer.from(u).toString('hex'))
  })
  const encRef = ctx.register(encDict)
  ctx.trailerInfo.Encrypt = encRef
  ctx.trailerInfo.ID = ctx.obj([
    PDFHexString.of(Buffer.from(id0).toString('hex')),
    PDFHexString.of('0'.repeat(32))
  ])

  // 加密流内容与 Title 字符串（RC4，对象密钥按 Algorithm 1）
  ;(stream as { contents: Uint8Array }).contents = rc4(
    objectKey(pwKey, streamRef.objectNumber, streamRef.generationNumber),
    originalStream
  )
  const titleKey = objectKey(pwKey, infoRef.objectNumber, infoRef.generationNumber)
  const encTitle = rc4(titleKey, new TextEncoder().encode(secretTitle))
  info.set(PDFName.of('Title'), PDFHexString.of(Buffer.from(encTitle).toString('hex')))

  return { doc, ctx, streamRef, originalStream, secretTitle, infoRef }
}

describe('decryptStandard', () => {
  it('无打开密码的 R3 文档：流与字符串复原、/Encrypt 摘除', async () => {
    const { doc, ctx, streamRef, originalStream, secretTitle } = await buildEncryptedDoc({ r: 3 })
    decryptStandard(doc)
    expect(ctx.trailerInfo.Encrypt).toBeUndefined()
    // 解密时流对象会被整体替换，须从 context 取最新的
    const dec = ctx.lookup(streamRef)
    expect(dec instanceof PDFRawStream).toBe(true)
    expect(toHex((dec as PDFRawStream).contents)).toBe(toHex(originalStream))
    const info = ctx.lookup(ctx.trailerInfo.Info!) as PDFDict | undefined
    expect(info).toBeTruthy()
    const title = info?.get(PDFName.of('Title')) as PDFHexString | undefined
    expect(title).toBeTruthy()
    expect(new TextDecoder().decode(title!.asBytes())).toBe(secretTitle)
  })

  it('设了打开密码的文档：明确报错而不是解出垃圾', async () => {
    const { doc } = await buildEncryptedDoc({ r: 3, withUserPassword: true })
    expect(() => decryptStandard(doc)).toThrow(PdfDecryptError)
  })
})
