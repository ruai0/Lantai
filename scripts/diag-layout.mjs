/**
 * 临时诊断：验证新版布局
 *   ① 页签不再折两行（PDF / Excel）
 *   ② 侧栏二级菜单可切换功能且高亮正确
 *   ③ 侧栏可折叠（宽度 214→64）
 *   ④ 沉浸模式隐藏侧栏与顶栏
 *   ⑤ 顶栏面包屑显示 工具 › 子功能
 * 用法：node scripts/diag-layout.mjs
 */
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

const ROOT = path.resolve(import.meta.dirname, '..')
const PORT = 9361
const sleep = ms => new Promise(r => setTimeout(r, ms))
const env = { ...process.env }
delete env.ELECTRON_RUN_AS_NODE
const app = spawn(path.join(ROOT, 'node_modules', 'electron', 'dist', 'electron.exe'), ['.', `--remote-debugging-port=${PORT}`], {
  cwd: ROOT, env, stdio: 'ignore', detached: true
})
process.on('exit', () => { try { process.kill(-app.pid) } catch {} })
async function findPage() {
  for (let i = 0; i < 100; i++) {
    try { const l = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json(); const p = l.find(t => t.type === 'page' && t.url.includes('renderer')); if (p) return p } catch {}
    await sleep(500)
  }
  throw new Error('CDP 超时')
}
const page = await findPage()
const ws = new WebSocket(page.webSocketDebuggerUrl)
await new Promise(r => ws.onopen = r)
let seq = 0; const pend = new Map()
ws.onmessage = e => { const m = JSON.parse(e.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id) } }
const send = (me, pa = {}) => new Promise(res => { const id = ++seq; pend.set(id, res); ws.send(JSON.stringify({ id, method: me, params: pa })) })
const ev = async (x, aw = false) => {
  const r = await send('Runtime.evaluate', { expression: x, returnByValue: true, awaitPromise: aw })
  if (r.result?.exceptionDetails) return 'ERR:' + String(r.result.exceptionDetails.exception?.description ?? '').slice(0, 200)
  return r.result?.result?.value
}
await send('Page.enable'); await send('Runtime.enable')
await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 860, deviceScaleFactor: 1, mobile: false })

const shot = async n => {
  const r = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false })
  fs.writeFileSync(path.join(ROOT, 'docs', 'screenshots', n), Buffer.from(r.result.data, 'base64'))
  console.log('   截图', n)
}
const crumbs = () => ev(`(()=>{const c=document.querySelector('.crumbs'); return c?c.textContent.replace(/\\s+/g,' ').trim():'(无)'})()`)
const tabsRows = () => ev(`(()=>{const n=document.querySelector('.el-tabs__nav'); return n?Math.round(n.getBoundingClientRect().height/40):0})()`)

for (const [toolPath, toolLabel, name] of [['/pdf', 'PDF 工具', '水印'], ['/excel', 'Excel 工具', '排序去重']]) {
  await ev(`location.hash=${JSON.stringify('#' + toolPath)}`)
  await sleep(1500)
  const rows = await tabsRows()
  console.log(`\n===== ${toolLabel} =====`)
  console.log('① 视图内横排页签行数:', rows, rows === 0 ? '✓ 已无页签' : '❌ 仍有页签')
  console.log('⑤ 顶栏面包屑:', await crumbs())
  await shot(`diag-layout-${toolPath.replace('/','')}-top.png`)

  // ② 点侧栏二级菜单里的目标功能
  const hit = await ev(`(()=>{
    const items=[...document.querySelectorAll('.app-menu--sub .el-menu-item')]
    const t=items.find(x=>x.textContent.trim()===${JSON.stringify(name)})
    if(!t) return '没找到「${name}」（共 '+items.length+' 项）'
    t.click(); return '已点击'
  })()`)
  await sleep(900)
  const on = await ev(`(()=>{
    const items=[...document.querySelectorAll('.app-menu--sub .el-menu-item')]
    const act=items.filter(x=>x.classList.contains('sub-item--on')).map(x=>x.textContent.trim())
    const hash=location.hash
    return JSON.stringify({高亮: act, hash})
  })()`)
  console.log('② 点击侧栏「' + name + '」:', hit, '|', on)
  await shot(`diag-layout-${toolPath.replace('/','')}-sub.png`)
}

// ③ 折叠侧栏
await ev(`location.hash='#/pdf?x'`); await sleep(300)
await ev(`location.hash='#/pdf'`); await sleep(1400)
const railW0 = await ev(`Math.round(document.querySelector('.app-aside').getBoundingClientRect().width)`)
const collapsed0 = await ev(`document.querySelector('.rail-collapsed')!==null`)
await ev(`(()=>{const b=[...document.querySelectorAll('.topbar-btn')][0]; b.click()})()`)
await sleep(700)
const railW1 = await ev(`Math.round(document.querySelector('.app-aside').getBoundingClientRect().width)`)
const collapsed1 = await ev(`document.querySelector('.rail-collapsed')!==null`)
console.log('\n===== 侧栏折叠 =====')
console.log(`③ 折叠前 aside 宽 ${railW0}px（collapsed=${collapsed0}）→ 折叠后 ${railW1}px（collapsed=${collapsed1}）`,
  railW1 < railW0 ? '✓ 已变窄' : '❌ 未变化')
await shot('diag-layout-rail-collapsed.png')
await ev(`(()=>{const b=[...document.querySelectorAll('.topbar-btn')][0]; b.click()})()`)
await sleep(600)

// ④ 沉浸模式
const imBtn = await ev(`(()=>{const bs=[...document.querySelectorAll('.topbar-btn')]; const b=bs[bs.length-1]; b.click(); return 'clicked'})()`)
await sleep(800)
const imm = await ev(`JSON.stringify({
  immersive: document.body.classList.contains('is-immersive'),
  asideHidden: getComputedStyle(document.querySelector('.app-aside')).display,
  topbarHidden: getComputedStyle(document.querySelector('.topbar')).display,
  exitBtn: !!document.querySelector('.immersive-exit')
})`)
console.log('\n===== 沉浸模式 =====')
console.log('④ 点击全屏:', imBtn, '|', imm)
await shot('diag-layout-immersive.png')
await ev(`document.querySelector('.immersive-exit').click()`); await sleep(500)
const back = await ev(`document.body.classList.contains('is-immersive')`)
console.log('   退出沉浸:', back ? '❌ 未退出' : '✓ 已退出')

ws.close(); process.exit(0)
