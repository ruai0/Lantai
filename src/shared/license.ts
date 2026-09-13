/**
 * 单位授权（离线签名授权码）共享类型与纯函数。
 * 许可口径见 LICENSE：个人免费、单位使用需授权。授权码 = v1.<base64url(JSON 载荷)>.<base64url(Ed25519 签名)>，
 * 签名对「载荷的 base64url 文本字节」计算（避免 JSON 序列化差异），验证端只需内嵌公钥。
 */

export interface LicensePayload {
  /** 格式版本 */
  v: 1
  /** 产品标识，防串用其他产品的码 */
  prod: 'lantai'
  type: 'org'
  /** 被授权单位名称（显示用，也是侵权证据） */
  org: string
  /** 签发时间（epoch 秒） */
  issued: number
  /** 到期时间（epoch 秒）；缺省 = 长期有效 */
  exp?: number
  /** 约定部署机器数上限（合同口径，软件内不做强制锁机） */
  max?: number
}

export type LicenseState = 'unlicensed' | 'valid' | 'expired' | 'invalid'

export interface LicenseStatus {
  /** 授权强制开关（构建期常量，作者侧）；false 时 UI 不出现任何授权元素 */
  enforce: boolean
  state: LicenseState
  org?: string
  exp?: number
  /** 无到期日的长期授权 */
  perpetual?: boolean
  /** 距到期剩余天数（向下取整前） */
  daysLeft?: number
  /** state=invalid 时的失败原因（签发的码不对 / 被改过） */
  error?: string
}

/**
 * 授权执行总开关（构建期常量）：
 * false = 当前发布形态：授权逻辑完整保留但不生效，界面上不出现授权元素；
 * true  = 面向单位打包时启用：设置页出现「单位授权」卡片，未注册/到期显示软提示（不硬阻断，内网环境锁死会出事故）。
 */
export const LICENSE_ENFORCE = false

/** base64url → 字节（atob 在 Node 16+/浏览器均可用，渲染层也能调用） */
export function b64urlToBytes(s: string): Uint8Array {
  const norm = s.replace(/-/g, '+').replace(/_/g, '/')
  const bin = atob(norm + '='.repeat((4 - (norm.length % 4)) % 4))
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

/** 载荷 JSON → 校验过的 LicensePayload；形状不符返回 null（不含签名校验） */
export function parsePayloadJson(json: string): LicensePayload | null {
  try {
    const p = JSON.parse(json) as LicensePayload
    if (
      p &&
      typeof p === 'object' &&
      p.v === 1 &&
      p.prod === 'lantai' &&
      p.type === 'org' &&
      typeof p.org === 'string' &&
      p.org.length > 0 &&
      typeof p.issued === 'number' &&
      (p.exp === undefined || typeof p.exp === 'number') &&
      (p.max === undefined || typeof p.max === 'number')
    ) {
      return p
    }
  } catch {
    /* 非 JSON 载荷 */
  }
  return null
}

/** 纯日期计算：载荷有效的前提下判定 valid / expired，并给出剩余天数 */
export function evaluatePayload(p: LicensePayload, nowSec: number): { state: 'valid' | 'expired'; perpetual: boolean; daysLeft?: number } {
  if (p.exp === undefined) return { state: 'valid', perpetual: true }
  const daysLeft = Math.ceil((p.exp - nowSec) / 86400)
  return { state: nowSec > p.exp ? 'expired' : 'valid', perpetual: false, daysLeft }
}
