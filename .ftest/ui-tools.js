(async () => {
  const __Z = window.__Z
  if (!(await __Z.nav('#/tools', 'decFiles'))) return { fail: 'ToolsView 未挂载' }
  const st = __Z.vm('decFiles')
  const OUT = 'J:/chinaMobile/network_project/freeTool/.ftest/out'
  const QR = 'J:/chinaMobile/network_project/freeTool/.ftest/img/qr-test.png'
  const res = {}
  st.tab = 'qrdecode'
  st.decFiles = [QR]
  await st.runDecode()
  res.decode = { result: st.decResult, error: st.decError, expectUrl: st.decIsUrl }
  st.tab = 'pinyin'
  st.pinFiles = ['J:/chinaMobile/network_project/freeTool/.ftest/名单加拼音.xlsx']
  await st.loadPinRecords()
  res.pinyinRows = st.pinRecords.length
  st.pinField = '姓名'
  st.pinOutDir = OUT
  await st.runPinyin()
  res.pinyin = st.pinOutput
  return res
})()
