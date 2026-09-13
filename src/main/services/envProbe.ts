import { spawn } from 'node:child_process'
import type { EnvProbe } from '@shared/types'
import { listCjkFontNames } from './cjkFont'
import { resolveSoffice } from './officeToPdfService'

/**
 * 本机环境探测（#2 诊断增强）：
 * - Windows：查注册表 HKCR 的 COM ProgID + 扫 %SystemRoot%\Fonts。
 * - Linux/麒麟：探测 soffice（LibreOffice）可执行 + 递归扫中文字体目录。
 * 结果进程内缓存，装机验收/远程报障时一次探测长期复用。
 */

export type { EnvProbe }

/** ProgID 存在还不够——WPS 常把 Word.Application 这类 MS ProgID 也注册走；
 *  所以额外读 ProgID 键的默认值（实现描述，如 "Microsoft Word 2016" / "WPS Office …"）判定真实归属 */
const PROGS: Record<'word' | 'excel' | 'ppt', Array<{ id: string; ms: string; wps: string }>> = {
  word: [{ id: 'Word.Application', ms: 'Microsoft Word', wps: 'WPS 文字' }, { id: 'KWPS.Application', ms: 'Microsoft Word', wps: 'WPS 文字' }],
  excel: [{ id: 'Excel.Application', ms: 'Microsoft Excel', wps: 'WPS 表格' }, { id: 'KET.Application', ms: 'Microsoft Excel', wps: 'WPS 表格' }],
  ppt: [{ id: 'PowerPoint.Application', ms: 'Microsoft PowerPoint', wps: 'WPS 演示' }, { id: 'KWPP.Application', ms: 'Microsoft PowerPoint', wps: 'WPS 演示' }]
}

let cached: EnvProbe | null = null

/** 每个 ProgID 输出「id|描述」；描述可能为空串（键存在但无默认值） */
function detectOffice(): Promise<Map<string, string | null>> {
  return new Promise(resolve => {
    const ids = Object.values(PROGS).flatMap(list => list.map(x => x.id))
    const script = ids
      .map(
        id =>
          `$p='Registry::HKEY_CLASSES_ROOT\\${id}'; if (Test-Path $p) { try { $d=(Get-Item $p).GetValue('') } catch { $d=$null }; Write-Output ("${id}|" + ($d -replace "[\\r\\n|]+", ' ').Trim()) } else { Write-Output ("${id}|") }`
      )
      .join('\n')
    const child = spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', script], { windowsHide: true })
    let out = ''
    const timer = setTimeout(() => {
      child.kill()
      resolve(new Map())
    }, 8000)
    child.stdout.on('data', d => (out += d.toString()))
    child.on('error', () => {
      clearTimeout(timer)
      resolve(new Map())
    })
    child.on('exit', () => {
      clearTimeout(timer)
      const map = new Map<string, string | null>()
      for (const line of out.split(/\r?\n/)) {
        const i = line.indexOf('|')
        if (i > 0) map.set(line.slice(0, i).trim(), line.slice(i + 1).trim() || null)
      }
      resolve(map)
    })
  })
}

function detectFonts(): string[] {
  return listCjkFontNames()
}

/** Linux/麒麟：LibreOffice 一套通吃 word/excel/ppt，探到即三类都可用 */
async function probeLinux(): Promise<EnvProbe> {
  const soffice = await resolveSoffice()
  const label = soffice ? 'LibreOffice' : '未检测到（需安装 libreoffice）'
  const probe: EnvProbe = {
    word: label,
    excel: label,
    ppt: label,
    cjkFonts: detectFonts(),
    watermarkReady: false,
    probedAt: Date.now()
  }
  probe.watermarkReady = probe.cjkFonts.length > 0
  return probe
}

/** 判定单个 ProgID 的真实归属：描述含 WPS 或 K 开头 id → WPS；否则 MS */
function brandOf(cand: { id: string; ms: string; wps: string }, desc: string | null): string {
  if (cand.id.startsWith('K')) return cand.wps
  if (desc && /wps|kingsoft/i.test(desc)) return cand.wps
  return cand.ms
}

/** force=true 时忽略缓存重新探测（设置页「重新探测」按钮） */
export async function probeEnv(force = false): Promise<EnvProbe> {
  if (cached && !force) return cached
  if (process.platform !== 'win32') {
    cached = await probeLinux()
    return cached
  }
  const detected = await detectOffice()
  const label = (kind: 'word' | 'excel' | 'ppt'): string => {
    const brands: string[] = []
    for (const cand of PROGS[kind]) {
      if (!detected.has(cand.id)) continue
      const brand = brandOf(cand, detected.get(cand.id) ?? null)
      if (!brands.includes(brand)) brands.push(brand)
    }
    return brands.length ? brands.join(' + ') : '未检测到'
  }
  const probe: EnvProbe = {
    word: label('word'),
    excel: label('excel'),
    ppt: label('ppt'),
    cjkFonts: detectFonts(),
    watermarkReady: false,
    probedAt: Date.now()
  }
  probe.watermarkReady = probe.cjkFonts.length > 0
  cached = probe
  return probe
}
