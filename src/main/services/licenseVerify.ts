import crypto from 'node:crypto'
import { b64urlToBytes, parsePayloadJson, type LicensePayload } from '@shared/license'

/** 授权码格式版本前缀；载荷的 base64url 文本即被签名的原文 */
export const LICENSE_VERSION_PREFIX = 'v1'

export interface VerifyResult {
  ok: boolean
  payload?: LicensePayload
  reason?: string
}

/**
 * 验签授权码（纯函数，公钥作参数注入便于单测）。
 * 只回答「这码是不是我签的、格式对不对」；到期判定在 evaluatePayload。
 */
export function verifyLicenseCode(code: string, pubKeyPem: string): VerifyResult {
  const parts = String(code ?? '')
    .trim()
    .split('.')
  if (parts.length !== 3) return { ok: false, reason: '格式应为 v1.<载荷>.<签名>' }
  const [ver, payloadB64, sigB64] = parts
  if (ver !== LICENSE_VERSION_PREFIX) return { ok: false, reason: `不支持的授权码版本：${ver}` }
  let sig: Uint8Array
  let payloadBytes: Uint8Array
  try {
    sig = b64urlToBytes(sigB64)
    payloadBytes = b64urlToBytes(payloadB64)
  } catch {
    return { ok: false, reason: '不是有效的 base64url 编码' }
  }
  let valid = false
  try {
    valid = crypto.verify(null, Buffer.from(payloadB64, 'ascii'), pubKeyPem, Buffer.from(sig))
  } catch {
    return { ok: false, reason: '公钥加载失败' }
  }
  if (!valid) return { ok: false, reason: '签名校验失败，授权码无效或被改动' }
  const payload = parsePayloadJson(new TextDecoder().decode(payloadBytes))
  if (!payload) return { ok: false, reason: '载荷不合法或不适用于本软件' }
  return { ok: true, payload }
}
