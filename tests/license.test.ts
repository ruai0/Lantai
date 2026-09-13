import { describe, expect, it } from 'vitest'
import crypto from 'node:crypto'
import { verifyLicenseCode } from '../src/main/services/licenseVerify'
import { evaluatePayload, parsePayloadJson, type LicensePayload } from '../src/shared/license'

/**
 * 授权码纯逻辑单测：验签、防篡改、载荷形状、到期判定。
 * 用测试专用密钥对，不依赖作者私钥文件（CI 里没有）。
 */

const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519')
const PUB_PEM = publicKey.export({ type: 'spki', format: 'pem' }).toString()

/** 与 scripts/license.mjs 同一算法：签名对载荷的 base64url 文本计算 */
function sign(payload: LicensePayload): string {
  const payloadB64 = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url')
  const sig = crypto.sign(null, Buffer.from(payloadB64, 'ascii'), privateKey)
  return `v1.${payloadB64}.${sig.toString('base64url')}`
}

const basePayload: LicensePayload = { v: 1, prod: 'lantai', type: 'org', org: '某某局', issued: 1_700_000_000 }

describe('verifyLicenseCode', () => {
  it('正确签名的码通过，并还原载荷字段', () => {
    const code = sign({ ...basePayload, exp: 1_800_000_000, max: 50 })
    const r = verifyLicenseCode(code, PUB_PEM)
    expect(r.ok).toBe(true)
    expect(r.payload?.org).toBe('某某局')
    expect(r.payload?.exp).toBe(1_800_000_000)
    expect(r.payload?.max).toBe(50)
  })

  it('篡改载荷（换单位名）→ 签名校验失败', () => {
    const code = sign(basePayload)
    const [, payloadB64, sigB64] = code.split('.')
    const evil = { ...basePayload, org: '蹭授权的局' }
    const evilB64 = Buffer.from(JSON.stringify(evil), 'utf8').toString('base64url')
    const r = verifyLicenseCode(`v1.${evilB64}.${sigB64}`, PUB_PEM)
    expect(r.ok).toBe(false)
    expect(r.reason).toContain('签名')
    void payloadB64
  })

  it('换一副公钥 → 校验失败', () => {
    const other = crypto.generateKeyPairSync('ed25519')
    const r = verifyLicenseCode(sign(basePayload), other.publicKey.export({ type: 'spki', format: 'pem' }).toString())
    expect(r.ok).toBe(false)
  })

  it('格式错误：段数不对 / 版本不符 / 非 base64url', () => {
    expect(verifyLicenseCode('abc', PUB_PEM).ok).toBe(false)
    expect(verifyLicenseCode('v2.a.b', PUB_PEM).reason).toContain('版本')
    expect(verifyLicenseCode('v1!!!.a.b', PUB_PEM).ok).toBe(false)
  })

  it('签名有效但载荷声明的产品不是 lantai → 拒绝', () => {
    const payload = { ...basePayload, prod: 'other' } as unknown as LicensePayload
    const r = verifyLicenseCode(sign(payload), PUB_PEM)
    expect(r.ok).toBe(false)
    expect(r.reason).toContain('载荷')
  })

  it('空输入不炸', () => {
    expect(verifyLicenseCode('', PUB_PEM).ok).toBe(false)
    expect(verifyLicenseCode(null as unknown as string, PUB_PEM).ok).toBe(false)
  })
})

describe('evaluatePayload / parsePayloadJson', () => {
  it('无 exp = 长期有效', () => {
    const ev = evaluatePayload(basePayload, 1_900_000_000)
    expect(ev).toEqual({ state: 'valid', perpetual: true })
  })

  it('到期日之后 = expired，之前 = valid 且给剩余天数', () => {
    const p = { ...basePayload, exp: 1_800_000_000 }
    expect(evaluatePayload(p, 1_800_000_001).state).toBe('expired')
    const soon = evaluatePayload(p, 1_800_000_000 - 3 * 86400)
    expect(soon.state).toBe('valid')
    expect(soon.daysLeft).toBe(3)
  })

  it('形状校验：缺 org / 类型错 / 非 JSON 都返回 null', () => {
    expect(parsePayloadJson('{"v":1,"prod":"lantai","type":"org","issued":1}')).toBeNull()
    expect(parsePayloadJson('{"v":1,"prod":"lantai","type":"org","org":"x","issued":"1"}')).toBeNull()
    expect(parsePayloadJson('not json')).toBeNull()
    expect(parsePayloadJson(JSON.stringify(basePayload))?.org).toBe('某某局')
  })
})
