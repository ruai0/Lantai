import { app } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import { evaluatePayload, LICENSE_ENFORCE, type LicenseStatus } from '@shared/license'
import { verifyLicenseCode } from './licenseVerify'

/**
 * 签发方公钥（Ed25519）。私钥只在作者本机 scripts/license-private.pem（不入库），
 * 轮换：node scripts/license.mjs genkey → 把打印的新公钥替换到这里。
 */
const LICENSE_PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEAIJJ6D+Dy6r39BB2/f4U1CxOxYOSaf6isTJgxIl2hSYY=
-----END PUBLIC KEY-----`

function licenseFilePath(): string {
  return path.join(app.getPath('userData'), 'lantai-license.key')
}

export function readLicenseCode(): string | null {
  try {
    return fs.readFileSync(licenseFilePath(), 'utf8').trim() || null
  } catch {
    return null
  }
}

/** 纯计算：由授权码文本得出状态（不落盘、不依赖 electron 路径，便于测试复用） */
export function computeLicenseStatus(code: string | null): LicenseStatus {
  if (!code) return { enforce: LICENSE_ENFORCE, state: 'unlicensed' }
  const v = verifyLicenseCode(code, LICENSE_PUBLIC_KEY)
  if (!v.ok || !v.payload) return { enforce: LICENSE_ENFORCE, state: 'invalid', error: v.reason }
  const ev = evaluatePayload(v.payload, Math.floor(Date.now() / 1000))
  return {
    enforce: LICENSE_ENFORCE,
    state: ev.state,
    org: v.payload.org,
    exp: v.payload.exp,
    perpetual: ev.perpetual,
    daysLeft: ev.daysLeft
  }
}

export function getLicenseStatus(): LicenseStatus {
  return computeLicenseStatus(readLicenseCode())
}

/** 注册：验签通过才落盘；抛错交给 IPC wrapper 转成 { ok:false } */
export function activateLicense(input: string): LicenseStatus {
  const code = String(input ?? '').trim()
  const v = verifyLicenseCode(code, LICENSE_PUBLIC_KEY)
  if (!v.ok) throw new Error(v.reason ?? '授权码无效')
  fs.mkdirSync(path.dirname(licenseFilePath()), { recursive: true })
  fs.writeFileSync(licenseFilePath(), code, 'utf8')
  return getLicenseStatus()
}

export function clearLicense(): LicenseStatus {
  try {
    fs.rmSync(licenseFilePath())
  } catch {
    /* 文件本就不存在，视为已清除 */
  }
  return getLicenseStatus()
}
