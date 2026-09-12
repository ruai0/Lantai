(async () => {
  const __Z = window.__Z
  const st = __Z.vm('orgFiles')
  st.tab = 'organize'
  await __Z.wait(() => !!__Z.btn('载入页面缩略图'), 5000)
  st.orgFiles = ['C:\Users\REALE ME\Downloads\4-权限管理数据库模型.pdf']
  document.querySelectorAll('.el-message').forEach(m => m.remove())
  __Z.btn('载入页面缩略图').click()
  await __Z.wait(() => !st.orgBusy, 60000)
  const msgs = [...document.querySelectorAll('.el-message')].map(m => m.textContent.trim())
  // 直接探测 readFiles 与 worker 创建
  let apiProbe = null
  try {
    const r = await window.api.readFiles(['C:\Users\REALE ME\Downloads\4-权限管理数据库模型.pdf'])
    apiProbe = { ok: r.ok, len: r.ok ? r.data[0].base64.length : r.error }
  } catch (e) { apiProbe = { threw: String(e) } }
  let workerProbe = null
  try {
    const w = new Worker(URL.createObjectURL(new Blob(['self.onmessage=()=>postMessage(1)'], {type:'text/javascript'})), {type:'module'})
    workerProbe = await new Promise((res, rej) => {
      w.onmessage = () => { w.terminate(); res('blob-worker-ok') }
      w.onerror = e => { w.terminate(); res('blob-worker-error: ' + (e.message || e.type)) }
      setTimeout(() => rej('timeout'), 5000)
    })
  } catch (e) { workerProbe = 'threw: ' + String(e) }
  return { msgs, orgPages: st.orgPages.length, apiProbe, workerProbe }
})()
