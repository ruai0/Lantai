(async () => {
  const __Z = window.__Z
  if (!(await __Z.nav('#/filekit', 'zipMode'))) return { fail: 'FileKitView 未挂载' }
  const st = __Z.vm('zipMode')
  const OUT = 'J:/chinaMobile/network_project/freeTool/.ftest/out'
  const res = {}
  st.tab = 'zip'
  st.zipMode = 'pack'
  st.zipSourceDir = 'J:/chinaMobile/network_project/freeTool/.ftest/img'
  st.zipName = 'ftest-img'
  st.zipOutDir = OUT
  await st.runZip()
  res.pack = JSON.parse(JSON.stringify(st.zipOutputs || []))
  if (res.pack.length) {
    st.zipMode = 'unpack'
    st.zipFiles = [res.pack[0]]
    st.zipOutDir = OUT + '/unpacked'
    await st.runZip()
    res.unpack = JSON.parse(JSON.stringify(st.zipOutputs || []))
  }
  return res
})()
