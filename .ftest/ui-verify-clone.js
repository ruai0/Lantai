(async () => {
  const __Z = window.__Z
  const st = __Z.vm('orgFiles')
  const P = 'C:/Users/REALE ME/Downloads/4-权限管理数据库模型.pdf'
  // 1) 纯数组参数
  let r1
  try { r1 = await window.api.pdfPagesInfo({ paths: [P] }) } catch (e) { r1 = { threw: String(e) } }
  // 2) reactive Proxy 数组参数
  st.orgFiles = [P]
  let r2
  try { r2 = await window.api.pdfPagesInfo({ paths: st.orgFiles }) } catch (e) { r2 = { threw: String(e) } }
  // 3) Proxy 直接作为顶层参数
  let r3
  try { r3 = await window.api.readFiles(st.orgFiles) } catch (e) { r3 = { threw: String(e) } }
  return {
    plainArg: r1.ok ? 'ok' : r1.error || r1.threw,
    proxyInObject: r2.ok ? 'ok' : r2.error || r2.threw,
    proxyTopLevel: r3.ok ? 'ok' : r3.error || r3.threw
  }
})()
