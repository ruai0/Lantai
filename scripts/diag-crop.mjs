/**
 * 临时诊断：大图内裁剪端到端
 *   ① 打开大图 → 进入裁剪 → 模拟拖框 → 应用
 *   ② 缩略图出现"裁"角标
 *   ③ 提取本页 → 产出 PDF 的 CropBox 确实生效（页面可视尺寸变小）
 * 需要先注入 diagLoad（见 PdfWorkbench）。
 */
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'

const ROOT = path.resolve(import.meta.dirname, '..')
const PDF = process.argv[2]
const PORT = 9371
const sleep = ms => new Promise(r => setTimeout(r, ms))
const env = { ...process.env }
delete env.ELECTRON_RUN_AS_NODE
const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lantai-crop-'))
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
await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false })
await ev(`location.hash='#/pdf'`); await sleep(1600)
await ev(`(()=>{const t=[...document.querySelectorAll('.app-menu--sub .el-menu-item')].find(x=>x.textContent.trim()==='工作台'); if(t) t.click()})()`); await sleep(900)
await ev(`window.__wb.value.diagLoad(${JSON.stringify(PDF)}).catch(()=>{})`, true)
await sleep(5000)
// 通过 DOM 设置输出目录（OutDirPicker 是可编辑输入框，v-model 监听原生 input 事件）
await ev(`(()=>{
  const inp=document.querySelector('.wb-side .el-input__inner')
  if(!inp) return 'no input'
  inp.value=${JSON.stringify(outDir)}
  inp.dispatchEvent(new Event('input',{bubbles:true}))
  return 'set'
})()`)
await sleep(400)

console.log('=== ① 打开第 3 页大图并进入裁剪 ===')
await ev(`(()=>{document.querySelectorAll('.wb-thumb-wrap')[2].click()})()`)
await sleep(2800)
const opened = await ev(`!!document.querySelector('.wb-preview-dialog')`)
console.log('大图已打开:', opened)
await ev(`(()=>{const b=[...document.querySelectorAll('.wb-preview-dialog .el-button')].find(x=>x.textContent.includes('裁剪本页')); if(b) b.click()})()`)
await sleep(700)
const cropMode = await ev(`(()=>{const o=document.querySelector('.pv-crop'); return {蒙层: !!o, 光标: getComputedStyle(document.querySelector('.pv-canvas')).cursor}})()`)
console.log('裁剪模式:', cropMode)

console.log('=== ② 模拟拖框（页面上半 60% 区域）===')
const drag = await ev(`(()=>{
  const c=document.querySelector('.pv-canvas'); if(!c) return 'no canvas'
  const r=c.getBoundingClientRect()
  const stage=document.querySelector('.pv-stage')
  const opts={bubbles:true,cancelable:true,view:window}
  stage.dispatchEvent(new MouseEvent('mousedown',{...opts,clientX:r.left+r.width*0.08,clientY:r.top+r.height*0.05}))
  stage.dispatchEvent(new MouseEvent('mousemove',{...opts,clientX:r.left+r.width*0.92,clientY:r.top+r.height*0.65}))
  stage.dispatchEvent(new MouseEvent('mouseup',{...opts}))
  const box=document.querySelector('.pv-crop-box')
  return JSON.stringify({选区: box?{w:Math.round(box.getBoundingClientRect().width),h:Math.round(box.getBoundingClientRect().height)}:null, 提示: document.querySelector('.pv-crop-size')?.textContent||''})
})()`)
console.log('拖框结果:', drag)
await shot('diag-crop-select.png')
console.log('截图 diag-crop-select.png')

console.log('=== ③ 应用裁剪 ===')
await ev(`(()=>{const b=[...document.querySelectorAll('.pv-crop-bar .el-button')].find(x=>x.textContent.includes('应用裁剪')); if(b) b.click()})()`)
await sleep(1500)
const after = await ev(`JSON.stringify((()=>{
  const p=window.__wb.value && document.querySelector('.wb-preview-dialog .el-dialog__title')
  const badge=document.querySelector('.wb-crop-badge')
  const cap=document.querySelector('.wb-cap')
  return {角标: !!badge, 说明: cap?cap.textContent.trim():'', 标题: p?p.textContent.trim():''}
})())`)
console.log('应用后:', after)
await shot('diag-crop-applied.png')
console.log('截图 diag-crop-applied.png')

console.log('=== ④ 提取本页并核对 CropBox ===')
await ev(`(()=>{const b=[...document.querySelectorAll('.wb-preview-dialog .el-button')].find(x=>x.textContent.includes('提取本页')); if(b) b.click()})()`)
await sleep(3500)
const toast = await ev(`(()=>{const c=document.querySelector('.el-message__content'); return c?c.textContent.trim():''})()`)
console.log('提示:', toast || '(无)')
ws.close()

// 用 pdf-lib 核对产出的 PDF
const { PDFDocument } = await import('pdf-lib')
await sleep(800)
const files = fs.readdirSync(outDir).filter(f => f.endsWith('.pdf'))
console.log('输出目录文件:', files)
if (files.length) {
  const d = await PDFDocument.load(fs.readFileSync(path.join(outDir, files[0])))
  const pg = d.getPage(0)
  const mb = pg.getMediaBox(), cb = pg.getCropBox()
  console.log('原 MediaBox:', JSON.stringify(mb))
  console.log('产出 CropBox:', JSON.stringify(cb))
  const shrunk = cb.width < mb.width - 1 || cb.height < mb.height - 1
  console.log(shrinkCheck(cb, mb) ? '✓ 裁剪已生效（可视范围明显小于整页）' : '❌ 裁剪未生效')
}
function shrinkCheck(cb, mb) {
  return cb.width < mb.width * 0.9 && cb.height < mb.height * 0.9
}
process.exit(0)
async function shot(n) {
  const r = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false })
  fs.writeFileSync(path.join(ROOT, 'docs', 'screenshots', n), Buffer.from(r.result.data, 'base64'))
}
