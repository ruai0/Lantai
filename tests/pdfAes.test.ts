import { describe, expect, it } from 'vitest'
import { aes128CbcDecrypt, aes128DecryptBlock, keyExpansion128 } from '../src/main/services/pdfAes'

function hex(s: string): Uint8Array {
  return Uint8Array.from(s.match(/.{2}/g)!.map(h => parseInt(h, 16)))
}
function toHex(b: Uint8Array): string {
  return Array.from(b, x => x.toString(16).padStart(2, '0')).join('')
}

describe('AES-128 解密（纯 JS 实现）', () => {
  it('FIPS-197 附录 C.1 单块向量', () => {
    const key = hex('000102030405060708090a0b0c0d0e0f')
    // 密文（加密明文 00112233...eeff 的结果）
    const cipher = hex('69c4e0d86a7b0430d8cdb78070b4c55a')
    const rounds = keyExpansion128(key)
    const plain = aes128DecryptBlock(cipher, rounds)
    expect(toHex(plain)).toBe('00112233445566778899aabbccddeeff')
  })

  it('NIST SP 800-38A F.2.1 CBC 向量（第一个块）', () => {
    const key = hex('2b7e151628aed2a6abf7158809cf4f3c')
    const iv = hex('000102030405060708090a0b0c0d0e0f')
    // 加密明文 6bc1bee22e409f96e93d7e117393172a 的结果
    const data = hex('7649abac8119b246cee98e9b12e9197d')
    const plain = aes128CbcDecrypt(iv, key, data)
    expect(toHex(plain)).toBe('6bc1bee22e409f96e93d7e117393172a')
  })

  it('CBC 多块链接（NIST SP 800-38A F.2.1 整组）', () => {
    const key = hex('2b7e151628aed2a6abf7158809cf4f3c')
    const iv = hex('000102030405060708090a0b0c0d0e0f')
    const cipher = hex(
      '7649abac8119b246cee98e9b12e9197d' +
        '5086cb9b507219ee95db113a917678b2' +
        '73bed6b8e3c1743b7116e69e22229516' +
        '3ff1caa1681fac09120eca307586e1a7'
    )
    const plain = aes128CbcDecrypt(iv, key, cipher)
    expect(toHex(plain)).toBe(
      '6bc1bee22e409f96e93d7e117393172a' +
        'ae2d8a571e03ac9c9eb76fac45af8e51' +
        '30c81c46a35ce411e5fbc1191a0a52ef' +
        'f69f2445df4f9b17ad2b417be66c3710'
    )
  })
})
