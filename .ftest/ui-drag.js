(async () => {
  const __Z = window.__Z
  const res = {}
  // 1) File 能否穿过 contextBridge（serialize.ts 的 File 放行逻辑）
  try {
    const f = new File(['x'], 'probe.pdf', { type: 'application/pdf' })
    const p = window.api.getPathForFile(f)
    res.bridge = 'ok, path=' + JSON.stringify(p)
  } catch (e) { res.bridge = 'THREW: ' + String(e) }
  // 2) 拖拽区渲染 + dragenter 高亮
  if (!(await __Z.nav('#/pdf', 'orgFiles'))) return { fail: 'PdfView 未挂载' }
  const st = __Z.vm('orgFiles')
  st.tab = 'organize'
  await __Z.wait(() => !!document.querySelector('.pick-zone'), 5000)
  const zone = document.querySelector('.pick-zone')
  res.zoneRendered = !!zone
  zone.dispatchEvent(new Event('dragenter', { bubbles: true }))
  await new Promise(r => setTimeout(r, 150))
  res.highlightOnEnter = zone.classList.contains('pick-zone--over')
  // 3) 模拟 drop：合成 File（无真实路径）应被安全跳过，不污染已选列表
  st.orgFiles = ['J:/chinaMobile/network_project/freeTool/.ftest/测试文档.pdf']
  await new Promise(r => setTimeout(r, 300))
  const dt = new DataTransfer()
  dt.items.add(new File(['x'], 'dropped.pdf', { type: 'application/pdf' }))
  const ev = new Event('drop', { bubbles: true })
  ev.dataTransfer = dt
  zone.dispatchEvent(ev)
  await new Promise(r => setTimeout(r, 250))
  res.afterDrop = st.orgFiles.length
  res.originalKept = st.orgFiles[0] ? st.orgFiles[0].includes('测试文档') : false
  res.highlightCleared = !zone.classList.contains('pick-zone--over')
  return res
})()
