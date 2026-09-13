import { spawn, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { OfficeToPdfParams, OfficeToPdfResult } from '@shared/types'
import { stemOf, uniquePath } from './fileUtils'
import { TaskCancelledError } from './taskProgress'

const SUPPORTED = ['.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx']

/** Linux/麒麟 下 LibreOffice 可执行文件的常见位置（deb、snap、flatpak 兜底） */
const SOFFICE_CANDIDATES = ['/usr/bin/soffice', '/usr/bin/libreoffice', '/snap/bin/libreoffice', '/usr/lib/libreoffice/program/soffice', '/var/lib/flatpak/exports/bin/org.libreoffice.LibreOffice']

/** 探测可用的 soffice/libreoffice；返回可执行路径或 null。注入 deps 便于单测 */
export function resolveSoffice(deps?: { exists?: (p: string) => boolean; which?: (bin: string) => string | null }): string | null {
  const exists = deps?.exists ?? (p => { try { return fs.existsSync(p) } catch { return false } })
  for (const c of SOFFICE_CANDIDATES) if (exists(c)) return c
  const which = deps?.which ?? ((bin: string) => { try { return spawnSync('which', [bin], { encoding: 'utf8' }).stdout?.trim() || null } catch { return null } })
  for (const bin of ['soffice', 'libreoffice']) {
    const found = which(bin)
    if (found) return found
  }
  return null
}

/** soffice 转换命令参数（纯函数，便于单测）：无头、转 PDF、输出到指定目录、单文件 */
export function buildSofficeArgs(src: string, outDir: string): string[] {
  return ['--headless', '--norestore', '--convert-to', 'pdf', '--outdir', outDir, src]
}

/** PowerShell 单引号字符串转义 */
function psStr(s: string): string {
  return `'${s.replace(/'/g, "''")}'`
}

function buildScript(pairs: Array<[string, string]>): string {
  // 用 PSCustomObject 承载每一对：PowerShell 的 @() 会扁平化嵌套数组，
  // 写成 @( @('a','b') ) 会被拆成一维字符串，导致逐字符取值出错
  const items = pairs.map(([src, pdf]) => `[pscustomobject]@{src=${psStr(src)};pdf=${psStr(pdf)}}`).join(', ')
  return `$ErrorActionPreference = 'Stop'
try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch {}
$cache = @{}
function Get-OfficeApp([string]$kind) {
  if ($cache.ContainsKey($kind)) { return $cache[$kind] }
  $ids = switch ($kind) {
    'word' { @('Word.Application','KWPS.Application') }
    'excel' { @('Excel.Application','KET.Application') }
    'ppt' { @('PowerPoint.Application','KWPP.Application') }
  }
  foreach ($id in $ids) {
    try {
      $app = New-Object -ComObject $id
      if ($kind -ne 'ppt') { $app.Visible = $false }
      try { $app.DisplayAlerts = 0 } catch {}
      $cache[$kind] = $app
      return $app
    } catch { }
  }
  throw "本机未安装可用的 Office 或 WPS（$kind 组件）"
}
$pairs = @(${items})
foreach ($pair in $pairs) {
  $src = $pair.src; $pdf = $pair.pdf
  $ext = [IO.Path]::GetExtension($src).ToLower()
  try {
    switch -regex ($ext) {
      '^\\.docx?$' {
        $app = Get-OfficeApp 'word'
        $doc = $app.Documents.Open($src, $false, $true)
        try { $doc.ExportAsFixedFormat($pdf, 17) } finally { $doc.Close(0) }
      }
      '^\\.xlsx?$' {
        $app = Get-OfficeApp 'excel'
        $wb = $app.Workbooks.Open($src, 0, $true)
        try { $wb.ExportAsFixedFormat(0, $pdf) } finally { $wb.Close($false) }
      }
      '^\\.pptx?$' {
        $app = Get-OfficeApp 'ppt'
        $pres = $app.Presentations.Open($src, $true, $false, $false)
        try { $pres.SaveAs($pdf, 32) } finally { $pres.Close() }
      }
      default { throw "不支持的格式：$ext" }
    }
    Write-Output ("OK|" + $src + "|" + $pdf)
  } catch {
    $reason = ($_.Exception.Message -replace "[\\r\\n|]+", ' ').Trim()
    Write-Output ("FAIL|" + $src + "|" + $reason)
  }
}
foreach ($app in $cache.Values) { try { $app.Quit() } catch {} }
`
}

/** Windows：PowerShell + Office/WPS COM 批量转换（缓存应用实例，逐行推进度） */
async function officeToPdfWin(
  params: OfficeToPdfParams,
  onProgress?: (done: number, total: number) => void,
  isCancelled?: () => boolean
): Promise<OfficeToPdfResult> {
  if (params.paths.length === 0) throw new Error('请先选择要转换的文件')
  const bad = params.paths.filter(p => !SUPPORTED.includes(path.extname(p).toLowerCase()))
  if (bad.length) {
    throw new Error(`仅支持 Word/Excel/PPT 文件（不支持：${bad.map(b => path.basename(b)).join('、')}）`)
  }

  // 输出名在 JS 侧算好传给脚本，保证重名不覆盖
  const pairs: Array<[string, string]> = params.paths.map(p => [
    p,
    uniquePath(params.outDir, `${stemOf(p)}.pdf`)
  ])
  const script = buildScript(pairs)
  const tmp = path.join(os.tmpdir(), `lantai_office2pdf_${Date.now()}.ps1`)
  // PowerShell 5.1 默认按 ANSI 读 .ps1，加 UTF-8 BOM 保证中文路径不乱码
  await fs.promises.writeFile(tmp, '\ufeff' + script, 'utf-8')

  // PowerShell 逐文件输出一行 OK/FAIL，边读边推进度，不等整个批次结束
  const outputs: string[] = []
  const failed: OfficeToPdfResult['failed'] = []
  const total = pairs.length
  const consume = (line: string): void => {
    const m = line.match(/^(OK|FAIL)\|([^|]*)\|(.*)$/)
    if (!m) return
    if (m[1] === 'OK') outputs.push(m[3].trim())
    else failed.push({ name: path.basename(m[2].trim()), reason: m[3].trim() || '未知错误' })
    onProgress?.(outputs.length + failed.length, total)
  }

  await new Promise<void>((resolve, reject) => {
    const child = spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', tmp], {
      windowsHide: true
    })
    let buf = ''
    let err = ''
    let byUser = false
    // 取消语义：杀子进程即可，Office 后台实例会被 PowerShell 退出时带走；已完成的文件保留
    const poll = setInterval(() => {
      if (isCancelled?.()) {
        byUser = true
        child.kill()
      }
    }, 400)
    const timer = setTimeout(() => {
      child.kill()
      reject(new Error('转换超时（10 分钟），请关闭正在打开的 Office 文档后重试'))
    }, 10 * 60 * 1000)
    child.stdout.on('data', d => {
      buf += d.toString()
      const lines = buf.split(/\r?\n/)
      buf = lines.pop() ?? ''
      lines.forEach(consume)
    })
    child.stderr.on('data', d => (err += d.toString()))
    child.on('error', e => {
      clearInterval(poll)
      clearTimeout(timer)
      reject(new Error(`无法启动 PowerShell：${e.message}`))
    })
    child.on('exit', code => {
      clearInterval(poll)
      clearTimeout(timer)
      if (buf) consume(buf)
      if (byUser) reject(new TaskCancelledError())
      else if (code === 0 || outputs.length || failed.length) resolve()
      else reject(new Error(err.trim() || `PowerShell 退出码 ${code}`))
    })
  })
  await fs.promises.rm(tmp, { force: true }).catch(() => {})

  if (outputs.length === 0 && failed.length === 0) {
    throw new Error('没有产生任何转换结果，请确认本机已安装 Office 或 WPS')
  }
  return { outputs, failed }
}

/** 单文件 soffice 转换，resolve 退出码；用户取消则 reject(TaskCancelledError) */
function convertOne(soffice: string, src: string, tmpDir: string, isCancelled?: () => boolean): Promise<number> {
  return new Promise((resolve, reject) => {
    const child = spawn(soffice, buildSofficeArgs(src, tmpDir), { env: { ...process.env, HOME: process.env.HOME ?? os.homedir() } })
    let killed = false
    const poll = setInterval(() => {
      if (isCancelled?.()) {
        killed = true
        child.kill('SIGKILL')
      }
    }, 400)
    const timer = setTimeout(() => {
      child.kill('SIGKILL')
    }, 5 * 60 * 1000)
    child.on('error', e => {
      clearInterval(poll)
      clearTimeout(timer)
      reject(new Error(`无法启动 LibreOffice：${e.message}`))
    })
    child.on('exit', code => {
      clearInterval(poll)
      clearTimeout(timer)
      if (killed) reject(new TaskCancelledError())
      else resolve(code ?? -1)
    })
  })
}

/** Linux/麒麟：LibreOffice 无头逐文件转换（正确性优先，批量偏慢为已知限制） */
async function officeToPdfLinux(
  params: OfficeToPdfParams,
  onProgress?: (done: number, total: number) => void,
  isCancelled?: () => boolean
): Promise<OfficeToPdfResult> {
  const soffice = resolveSoffice()
  if (!soffice) throw new Error('未检测到 LibreOffice：麒麟/Linux 下 Office 转 PDF 依赖它，请先安装 libreoffice')
  const outputs: string[] = []
  const failed: OfficeToPdfResult['failed'] = []
  const total = params.paths.length
  for (let i = 0; i < total; i++) {
    if (isCancelled?.()) throw new TaskCancelledError()
    const src = params.paths[i]
    const out = uniquePath(params.outDir, `${stemOf(src)}.pdf`)
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lantai_o2p_'))
    try {
      const code = await convertOne(soffice, src, tmpDir, isCancelled)
      const produced = path.join(tmpDir, `${stemOf(src)}.pdf`)
      if (code === 0 && fs.existsSync(produced)) {
        try {
          fs.renameSync(produced, out)
        } catch {
          fs.copyFileSync(produced, out)
          fs.rmSync(produced, { force: true })
        }
        outputs.push(out)
      } else {
        failed.push({ name: path.basename(src), reason: `LibreOffice 转换失败（退出码 ${code}）` })
      }
    } catch (e) {
      if (e instanceof TaskCancelledError) throw e
      failed.push({ name: path.basename(src), reason: e instanceof Error ? e.message : String(e) })
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true })
    }
    onProgress?.(i + 1, total)
  }
  if (outputs.length === 0 && failed.length === 0) throw new Error('没有产生任何转换结果')
  return { outputs, failed }
}

/** 平台分发：Windows 走 COM，其余走 LibreOffice */
export async function officeToPdf(
  params: OfficeToPdfParams,
  onProgress?: (done: number, total: number) => void,
  isCancelled?: () => boolean
): Promise<OfficeToPdfResult> {
  if (params.paths.length === 0) throw new Error('请先选择要转换的文件')
  const bad = params.paths.filter(p => !SUPPORTED.includes(path.extname(p).toLowerCase()))
  if (bad.length) {
    throw new Error(`仅支持 Word/Excel/PPT 文件（不支持：${bad.map(b => path.basename(b)).join('、')}）`)
  }
  return process.platform === 'win32' ? officeToPdfWin(params, onProgress, isCancelled) : officeToPdfLinux(params, onProgress, isCancelled)
}
