/**
 * 渲染进程禁用 Node-only 全局（nodeIntegration 关闭时它们会在运行时抛 ReferenceError，
 * 且往往被静默吞掉，表现为「点了没反应」）。构建前扫一遍，命中即失败。
 */
import fs from 'node:fs'
import path from 'node:path'

const ROOT = path.resolve(import.meta.dirname, '../src/renderer')
const BANNED = [
  { re: /\bBuffer\s*\./, why: 'Node Buffer 在渲染进程不存在，请用 atob/btoa' },
  { re: /\brequire\s*\(/, why: '渲染进程不能用 require，请走 preload 暴露的 window.api' },
  { re: /\bprocess\.(env|cwd|platform)/, why: '渲染进程不能读 process' },
  { re: /\b__dirname\b/, why: '渲染进程没有 __dirname' },
  { re: /from\s+['"]node:/, why: '渲染进程不能 import node: 内置模块' }
]

const files = []
;(function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name)
    if (e.isDirectory()) walk(full)
    else if (/\.(ts|vue|js)$/.test(e.name)) files.push(full)
  }
})(ROOT)

const hits = []
for (const f of files) {
  const lines = fs.readFileSync(f, 'utf-8').split(/\r?\n/)
  lines.forEach((line, i) => {
    if (line.includes('check-renderer') || /禁用|不能用|不存在/.test(line)) return
    for (const b of BANNED) {
      if (b.re.test(line)) hits.push(`${path.relative(ROOT, f)}:${i + 1}  ${b.why}\n    ${line.trim()}`)
    }
  })
}

if (hits.length) {
  console.error('\n渲染进程使用了 Node-only API（运行时会抛错且可能被静默吞掉）：\n')
  console.error(hits.join('\n') + '\n')
  process.exit(1)
}
console.log(`check:renderer 通过（${files.length} 个文件）`)
