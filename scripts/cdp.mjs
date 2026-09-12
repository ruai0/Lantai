/**
 * 通用 CDP 驱动：node scripts/cdp.mjs <expr-file>
 * 连接 --remote-debugging-port=9222 的渲染进程，执行表达式文件并打印 JSON 结果。
 * 表达式必须是返回可序列化值的 async IIFE。
 */
import fs from 'node:fs'

const file = process.argv[2]
if (!file) {
  console.error('usage: node scripts/cdp.mjs <expr-file>')
  process.exit(1)
}
const expr = `
window.__Z = window.__Z || {
  vm(key) {
    for (const el of document.querySelectorAll('*')) {
      let c = el.__vueParentComponent
      while (c) {
        try {
          if (c.setupState && key in c.setupState) return c.setupState
        } catch {}
        c = c.parent
      }
    }
    return null
  },
  btn(text) {
    for (const b of document.querySelectorAll('button'))
      if (b.textContent.trim().includes(text)) return b
    return null
  },
  async wait(fn, ms = 30000) {
    const t0 = Date.now()
    while (Date.now() - t0 < ms) {
      try {
        if (fn()) return true
      } catch {}
      await new Promise(r => setTimeout(r, 200))
    }
    return false
  },
  async nav(hash, vmKey, ms = 10000) {
    location.hash = hash
    return __Z.wait(() => __Z.vm(vmKey), ms)
  }
};
${fs.readFileSync(file, 'utf8')}
`

const list = await (await fetch('http://127.0.0.1:9222/json')).json()
const page = list.find(t => t.type === 'page' && t.url.includes('renderer'))
if (!page) throw new Error('no renderer debug target; 应用需以 --remote-debugging-port=9222 启动')

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

const r = await send('Runtime.evaluate', {
  expression: expr,
  awaitPromise: true,
  returnByValue: true,
  timeout: 300000
})
if (r.result?.exceptionDetails) {
  console.error('PAGE EXCEPTION:', JSON.stringify(r.result.exceptionDetails, null, 2))
  process.exit(2)
}
console.log(JSON.stringify(r.result?.result?.value, null, 2))
ws.close()
