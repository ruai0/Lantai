/**
 * 界面截图：启动应用（CDP）→ 逐页截取 → 关闭。产物 docs/screenshots/*.png，供 README 使用。
 *   node scripts/shot.mjs
 * 前置：out/ 已有构建产物（npm run build）。
 */
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

const ROOT = path.resolve(import.meta.dirname, '..')
const PORT = 9223
const OUT = path.join(ROOT, 'docs', 'screenshots')
fs.mkdirSync(OUT, { recursive: true })

const sleep = ms => new Promise(r => setTimeout(r, ms))
const app = spawn(path.join(ROOT, 'node_modules', 'electron', 'dist', 'electron.exe'), ['.', `--remote-debugging-port=${PORT}`], {
  cwd: ROOT,
  stdio: 'ignore',
  detached: true
})
process.on('exit', () => {
  try {
    process.kill(app.pid)
  } catch {
    /* gone */
  }
})

async function findPage() {
  for (let i = 0; i < 60; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json()
      const p = list.find(t => t.type === 'page' && t.url.includes('renderer'))
      if (p) return p
    } catch {
      /* 还没起来 */
    }
    await sleep(500)
  }
  throw new Error('CDP 目标超时，检查 out/ 是否已构建')
}

const page = await findPage()
const ws = new WebSocket(page.webSocketDebuggerUrl)
await new Promise((res, rej) => {
  ws.onopen = res
  ws.onerror = rej
})
let seq = 0
const pending = new Map()
ws.onmessage = e => {
  const m = JSON.parse(e.data)
  if (m.id && pending.has(m.id)) {
    pending.get(m.id)(m)
    pending.delete(m.id)
  }
}
const send = (method, params = {}) =>
  new Promise(res => {
    const id = ++seq
    pending.set(id, res)
    ws.send(JSON.stringify({ id, method, params }))
  })

await send('Page.enable')
// 等应用挂载（侧栏渲染出来）
for (let i = 0; i < 40; i++) {
  const r = await send('Runtime.evaluate', { expression: "!!document.querySelector('.app-menu')", returnByValue: true })
  if (r.result?.result?.value === true) break
  await sleep(300)
}

const shots = [
  { hash: '#/', file: 'home.png', wait: 1200 },
  { hash: '#/pdf', file: 'pdf.png', wait: 700 },
  { hash: '#/settings', file: 'settings.png', wait: 900 }
]
for (const s of shots) {
  await send('Runtime.evaluate', { expression: `location.hash = ${JSON.stringify(s.hash)}` })
  await sleep(s.wait)
  const img = await send('Page.captureScreenshot', { format: 'png' })
  fs.writeFileSync(path.join(OUT, s.file), Buffer.from(img.result.data, 'base64'))
  console.log('shot:', s.file)
}
ws.close()
process.kill(app.pid)
console.log('done →', path.relative(ROOT, OUT))
process.exit(0)
