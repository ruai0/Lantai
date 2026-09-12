import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import type { EnvProbe } from '@shared/types'

/**
 * 本机环境探测（#2 诊断增强）：
 * - Office/WPS：查注册表 HKCR 的 COM ProgID（比 New-Object 实例化快几个数量级，
 *   ProgID 注册 ≈ 组件可用；真正的可用性最终以一次实际转换为准）。
 * - 中文字体：与 pdfService 的水印字体优先级同一张清单，扫描 %SystemRoot%\Fonts。
 * 结果进程内缓存，装机验收/远程报障时一次探测长期复用。
 */

export type { EnvProbe }

/** 与 pdfService.CJK_FONTS 保持一致 */
const CJK_FONTS = ['simhei.ttf', 'deng.ttf', 'simfang.ttf', 'simkai.ttf', 'STZHONGS.TTF']

const PROGS: Record<'word' | 'excel' | 'ppt', Array<[string, string]>> = {
  word: [
    ['Word.Application', 'Microsoft Word'],
    ['KWPS.Application', 'WPS 文字']
  ],
  excel: [
    ['Excel.Application', 'Microsoft Excel'],
    ['KET.Application', 'WPS 表格']
  ],
  ppt: [
    ['PowerPoint.Application', 'Microsoft PowerPoint'],
    ['KWPP.Application', 'WPS 演示']
  ]
}

let cached: EnvProbe | null = null

function detectOffice(): Promise<Record<'word' | 'excel' | 'ppt', string[]>> {
  return new Promise(resolve => {
    const ids = Object.values(PROGS).flatMap(list => list.map(([id]) => id))
    const script = ids.map(id => `Write-Output ("{0}={1}" -f '${id}', (Test-Path "Registry::HKEY_CLASSES_ROOT\\${id}" -ErrorAction SilentlyContinue))`).join('\n')
    const child = spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', script], { windowsHide: true })
    let out = ''
    const timer = setTimeout(() => {
      child.kill()
      resolve({ word: [], excel: [], ppt: [] })
    }, 8000)
    child.stdout.on('data', d => (out += d.toString()))
    child.on('error', () => {
      clearTimeout(timer)
      resolve({ word: [], excel: [], ppt: [] })
    })
    child.on('exit', () => {
      clearTimeout(timer)
      const hit = new Map<string, boolean>()
      for (const line of out.split(/\r?\n/)) {
        const m = line.match(/^(.+?)=(True|False)$/)
        if (m) hit.set(m[1].trim(), m[2] === 'True')
      }
      const result: Record<'word' | 'excel' | 'ppt', string[]> = { word: [], excel: [], ppt: [] }
      for (const [kind, list] of Object.entries(PROGS) as Array<['word' | 'excel' | 'ppt', Array<[string, string]>]>) {
        for (const [id, name] of list) if (hit.get(id)) result[kind].push(name)
      }
      resolve(result)
    })
  })
}

function detectFonts(): string[] {
  const dir = path.join(process.env.SystemRoot ?? 'C:\\Windows', 'Fonts')
  return CJK_FONTS.filter(name => fs.existsSync(path.join(dir, name)))
}

/** force=true 时忽略缓存重新探测（设置页「重新探测」按钮） */
export async function probeEnv(force = false): Promise<EnvProbe> {
  if (cached && !force) return cached
  const office = await detectOffice()
  const label = (list: string[]) => (list.length ? list.join(' + ') : '未检测到')
  const probe: EnvProbe = {
    word: label(office.word),
    excel: label(office.excel),
    ppt: label(office.ppt),
    cjkFonts: detectFonts(),
    watermarkReady: false,
    probedAt: Date.now()
  }
  probe.watermarkReady = probe.cjkFonts.length > 0
  cached = probe
  return probe
}
