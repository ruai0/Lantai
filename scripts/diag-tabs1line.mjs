/** 临时诊断：横排页签单行验证（1280 展开侧栏 / 折叠侧栏两种情况）。 */
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
const ROOT = path.resolve(import.meta.dirname, '..')
const PORT = 9381
const sleep = ms => new Promise(r => setTimeout(r, ms))
const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE
const app = spawn(path.join(ROOT, 'node_modules', 'electron', 'dist', 'electron.exe'), ['.', `--remote-debugging-port=${PORT}`], { cwd: ROOT, env, stdio: 'ignore', detached: true })
process.on('exit', () => { try { process.kill(-app.pid) } catch {} })
async function findPage() {
  for (let i = 0; i < 100; i++) { try { const l = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json(); const p = l.find(t => t.type === 'page' && t.url.includes('renderer')); if (p) return p } catch {} await sleep(500) }
  throw new Error('CDP 超时')
}
const page = await findPage()
const ws = new WebSocket(page.webSocketDebuggerUrl)
await new Promise(r => ws.onopen = r)
let seq = 0; const pend = new Map()
ws.onmessage = e => { const m = JSON.parse(e.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id) } }
const send = (me, pa = {}) => new Promise(res => { const id = ++seq; pend.set(id, res); ws.send(JSON.stringify({ id, method: me, params: pa })) })
const ev = async x => { const r = await send('Runtime.evaluate', { expression: x, returnByValue: true }); if (r.result?.exceptionDetails) return 'ERR'; return r.result?.result?.value }
await send('Page.enable'); await send('Runtime.enable')
const shot = async n => { const r = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false }); fs.writeFileSync(path.join(ROOT, 'docs', 'screenshots', n), Buffer.from(r.result.data, 'base64')); console.log('   截图', n) }

const measure = `(()=>{
  const nav=document.querySelector('.el-tabs__nav'); if(!nav) return JSON.stringify({no:'tabs'})
  const r=nav.getBoundingClientRect()
  const items=[...document.querySelectorAll('.el-tabs__item')]
  const tops=new Set(items.map(i=>Math.round(i.getBoundingClientRect().top)))
  const wrap=document.querySelector('.el-tabs__nav-wrap')
  return JSON.stringify({ tabCount: items.length, 行数: tops.size, nav宽: Math.round(r.width), 容器宽: wrap?Math.round(wrap.getBoundingClientRect().width):-1, 溢出: r.width > (wrap?wrap.clientWidth:0) + 1 })
})()`

await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 860, deviceScaleFactor: 1, mobile: false })
for (const pathName of ['/pdf', '/excel']) {
  await ev(`location.hash='${pathName}'`); await sleep(1600)
  // 侧栏展开
  const expanded = await ev(measure)
  console.log(`\n=== ${pathName}（侧栏展开）===`)
  console.log(expanded)
  await shot(`diag-tabs1line-${pathName.replace('/', '')}-open.png`)
  // 侧栏折叠
  await ev(`(()=>{const b=[...document.querySelectorAll('.topbar-btn')][0]; b.click()})()`)
  await sleep(700)
  const collapsedState = await ev(measure)
  console.log(`--- 侧栏折叠 ---`)
  console.log(collapsedState)
  await shot(`diag-tabs1line-${pathName.replace('/', '')}-folded.png`)
  await ev(`(()=>{const b=[...document.querySelectorAll('.topbar-btn')][0]; b.click()})()`)
  await sleep(500)
}
// 沉浸模式仍在
await ev(`location.hash='#/pdf'`); await sleep(1200)
await ev(`(()=>{const bs=[...document.querySelectorAll('.topbar-btn')]; bs[bs.length-1].click()})()`)
await sleep(700)
const imm = await ev(`JSON.stringify({沉浸: document.body.classList.contains('is-immersive'), 侧栏隐藏: getComputedStyle(document.querySelector('.app-aside')).display==='none', 退出按钮: !!document.querySelector('.immersive-exit')})`)
console.log('\n=== 沉浸模式 ===')
console.log(imm)
await ev(`(()=>{const b=document.querySelector('.immersive-exit'); if(b) b.click()})()`)
ws.close(); process.exit(0)
