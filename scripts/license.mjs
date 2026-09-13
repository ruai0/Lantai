/**
 * 兰台单位授权码签发工具（本地工具，私钥不入库）
 *
 *   node scripts/license.mjs genkey                                  # 生成新密钥对（轮换用，会打印需替换的公钥）
 *   node scripts/license.mjs sign --org "某某局" [--exp 2027-09-30] [--max 50]   # 签发授权码
 *   node scripts/license.mjs verify v1.xxxx.xxxx                     # 校验一个码（用应用内嵌公钥）
 *
 * 码格式：v1.<base64url(JSON 载荷)>.<base64url(Ed25519 签名)>，签名对「载荷 base64url 文本」计算。
 * 私钥 scripts/license-private.pem、台账 scripts/license-issued.jsonl 均在 .gitignore；
 * 私钥丢失 = 无法给老客户续期，务必异地备份。
 */
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

const ROOT = path.resolve(import.meta.dirname, '..')
const PRIV_FILE = path.join(ROOT, 'scripts', 'license-private.pem')
const LEDGER = path.join(ROOT, 'scripts', 'license-issued.jsonl')
const SERVICE_FILE = path.join(ROOT, 'src', 'main', 'services', 'licenseService.ts')

/** 应用内嵌公钥：直接从 licenseService.ts 提取，保证校验端与发布端永远一致 */
function embeddedPublicKey() {
  const src = fs.readFileSync(SERVICE_FILE, 'utf8')
  const m = src.match(/-----BEGIN PUBLIC KEY-----[\s\S]*?-----END PUBLIC KEY-----/)
  if (!m) throw new Error(`${path.relative(ROOT, SERVICE_FILE)} 中未找到公钥`)
  return m[0]
}

const b64url = buf => Buffer.from(buf).toString('base64url')

function signCode(payloadObj, privPem) {
  const priv = crypto.createPrivateKey(privPem)
  const payloadB64 = b64url(Buffer.from(JSON.stringify(payloadObj), 'utf8'))
  const sig = crypto.sign(null, Buffer.from(payloadB64, 'ascii'), priv)
  return `v1.${payloadB64}.${b64url(sig)}`
}

function verifyWith(code, pubPem) {
  const parts = String(code).trim().split('.')
  if (parts.length !== 3 || parts[0] !== 'v1') throw new Error('格式应为 v1.<载荷>.<签名>')
  const [, payloadB64, sigB64] = parts
  const ok = crypto.verify(null, Buffer.from(payloadB64, 'ascii'), pubPem, Buffer.from(sigB64, 'base64url'))
  if (!ok) throw new Error('签名校验失败')
  return JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8'))
}

function parseArgs(argv) {
  const out = { _: [] }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a.startsWith('--')) out[a.slice(2)] = argv[++i]
    else out._.push(a)
  }
  return out
}

const cmd = process.argv[2]
const args = parseArgs(process.argv.slice(3))

if (cmd === 'genkey') {
  if (fs.existsSync(PRIV_FILE) && !args.force) {
    console.error(`✖ 已有私钥 ${path.relative(ROOT, PRIV_FILE)}（轮换确需覆盖请加 --force，并记得旧码将全部失效）`)
    process.exit(1)
  }
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519')
  fs.writeFileSync(PRIV_FILE, privateKey.export({ type: 'pkcs8', format: 'pem' }))
  console.log('✔ 私钥已写入', path.relative(ROOT, PRIV_FILE), '—— 请立即异地备份！')
  console.log('✔ 把下面公钥替换进 src/main/services/licenseService.ts 的 LICENSE_PUBLIC_KEY：\n')
  console.log(publicKey.export({ type: 'spki', format: 'pem' }).toString().trim())
} else if (cmd === 'sign') {
  if (!args.org) {
    console.error('usage: node scripts/license.mjs sign --org "某某局" [--exp YYYY-MM-DD] [--max N]')
    process.exit(1)
  }
  if (!fs.existsSync(PRIV_FILE)) {
    console.error(`✖ 找不到私钥 ${path.relative(ROOT, PRIV_FILE)}，先运行 genkey`)
    process.exit(1)
  }
  const payload = { v: 1, prod: 'lantai', type: 'org', org: String(args.org).trim(), issued: Math.floor(Date.now() / 1000) }
  if (args.exp) {
    const t = Date.parse(`${args.exp}T23:59:59+08:00`)
    if (Number.isNaN(t)) {
      console.error('✖ --exp 需为 YYYY-MM-DD')
      process.exit(1)
    }
    payload.exp = Math.floor(t / 1000)
  }
  if (args.max) payload.max = Number(args.max)
  const code = signCode(payload, fs.readFileSync(PRIV_FILE, 'utf8'))
  const back = verifyWith(code, embeddedPublicKey()) // 自检：签发端验不过等于白签
  fs.appendFileSync(LEDGER, JSON.stringify({ at: new Date().toISOString(), ...back, code }) + '\n')
  console.log(code)
  console.log(`\n✔ 已记入台账 ${path.relative(ROOT, LEDGER)}（${back.org}${back.exp ? `，到期 ${args.exp}` : '，长期有效'}）`)
} else if (cmd === 'verify') {
  const code = args._[0]
  if (!code) {
    console.error('usage: node scripts/license.mjs verify <授权码>')
    process.exit(1)
  }
  try {
    console.log(JSON.stringify(verifyWith(code, embeddedPublicKey()), null, 2))
    console.log('✔ 有效')
  } catch (e) {
    console.error('✖', e.message)
    process.exit(1)
  }
} else {
  console.log('兰台授权码签发：genkey | sign --org "…" [--exp YYYY-MM-DD] [--max N] | verify <码>')
}
