import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const asar = require('@electron/asar')
const p = 'release-fix/win-unpacked/resources/app.asar'
const list = asar.listPackage(p).map(n => n.replace(/\\/g, '/').replace(/^\//, ''))
const htmls = list.filter(n => n.endsWith('.html'))
console.log('html entries:', htmls.join(', '))
for (const cand of [...htmls, ...list.filter(n => n.includes('index.html'))]) {
  try {
    const s = asar.extractFile(p, cand).toString()
    console.log('extracted', cand, 'worker-src:', s.includes("worker-src 'self' blob:"))
    break
  } catch (e) {
    console.log('fail', JSON.stringify(cand), e.message.slice(0, 40))
  }
}
const assetJs = list.filter(n => n.includes('assets') && n.endsWith('.js'))
let workerInlined = false
let apiWrapped = false
let devHook = false
for (const n of assetJs) {
  const s = asar.extractFile(p, n).toString()
  if (s.includes('PDFWorkerStream')) workerInlined = true
  if (s.includes('args.map')) apiWrapped = true
  if (s.includes('__vueParentComponent')) devHook = true
}
console.log('pdf worker inlined:', workerInlined)
console.log('renderer api plain-wrap:', apiWrapped)
console.log('devtools hook leaked:', devHook)
