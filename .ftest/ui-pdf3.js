(async () => {
  const __Z = window.__Z
  if (!(await __Z.nav('#/pdf', 'orgFiles'))) return { fail: 'PdfView 未挂载' }
  const st = __Z.vm('orgFiles')
  const FT = 'J:/chinaMobile/network_project/freeTool/.ftest/'
  const P = FT + 'fixture-a.pdf'
  const OUT = FT + 'out'
  const res = {}
  try {
    st.tab = 'compress'
    st.compressFile = [P]
    st.compDpi = 120
    st.compQuality = 60
    st.outDir = OUT
    st.outputs = []
    st.compResult = null
    await st.run()
    res.compress = st.outputs.length > 0 && st.compResult ? 'ok' : { fail: '无输出', outputs: st.outputs }
  } catch (e) { res.compress = 'threw: ' + String(e) }
  try {
    st.tab = 'toimg'
    st.toimgFile = [P]
    st.imgScale = 2
    st.outDir = OUT
    st.outputs = []
    await st.run()
    res.toimg = st.outputs.length === 2 ? 'ok' : { fail: '期望 2 张 PNG', got: st.outputs.length }
  } catch (e) { res.toimg = 'threw: ' + String(e) }
  try {
    st.tab = 'text'
    st.textFile = [P]
    st.outDir = OUT
    st.outputs = []
    await st.run()
    res.text = st.outputs.length > 0 ? 'ok' : { fail: '无 TXT 输出' }
  } catch (e) { res.text = 'threw: ' + String(e) }
  return res
})()
