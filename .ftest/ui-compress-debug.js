(async () => {
  const __Z = window.__Z
  if (!(await __Z.nav('#/pdf', 'orgFiles'))) return { fail: 'no mount' }
  const st = __Z.vm('orgFiles')
  document.querySelectorAll('.el-message').forEach(m => m.remove())
  st.tab = 'compress'
  st.compressFile = ['J:/chinaMobile/network_project/freeTool/.ftest/fixture-a.pdf']
  st.compDpi = 120
  st.compQuality = 60
  st.outDir = 'J:/chinaMobile/network_project/freeTool/.ftest/out'
  st.outputs = []
  st.compResult = null
  await st.run()
  await new Promise(r => setTimeout(r, 500))
  return {
    msgs: [...document.querySelectorAll('.el-message')].map(m => m.textContent.trim()),
    outputs: JSON.parse(JSON.stringify(st.outputs)),
    compResult: st.compResult
  }
})()
