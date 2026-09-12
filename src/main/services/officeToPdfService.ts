import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { OfficeToPdfParams, OfficeToPdfResult } from '@shared/types'
import { stemOf, uniquePath } from './fileUtils'

const SUPPORTED = ['.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx']

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

export async function officeToPdf(
  params: OfficeToPdfParams,
  onProgress?: (done: number, total: number) => void
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
  const tmp = path.join(os.tmpdir(), `freetool_office2pdf_${Date.now()}.ps1`)
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
      clearTimeout(timer)
      reject(new Error(`无法启动 PowerShell：${e.message}`))
    })
    child.on('exit', code => {
      clearTimeout(timer)
      if (buf) consume(buf)
      if (code === 0 || outputs.length || failed.length) resolve()
      else reject(new Error(err.trim() || `PowerShell 退出码 ${code}`))
    })
  })
  await fs.promises.rm(tmp, { force: true }).catch(() => {})

  if (outputs.length === 0 && failed.length === 0) {
    throw new Error('没有产生任何转换结果，请确认本机已安装 Office 或 WPS')
  }
  return { outputs, failed }
}
