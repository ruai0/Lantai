(async () => {
  const __Z = window.__Z
  const st = __Z.vm('orgFiles') // PdfView
  const P = 'C:/Users/REALE ME/Downloads/4-权限管理数据库模型.pdf'
  const OUT = 'J:/chinaMobile/network_project/freeTool/.ftest/out'
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
    res.compress = { outputs: st.outputs, beforeAfterKB: st.compResult && [Math.round(st.compResult.before / 1024), Math.round(st.compResult.after / 1024)] }
  } catch (e) { res.compress = 'threw: ' + String(e) }
  try {
    st.tab = 'toimg'
    st.toimgFile = [P]
    st.imgScale = 2
    st.outDir = OUT
    st.outputs = []
    await st.run()
    res.toimg = st.outputs
  } catch (e) { res.toimg = 'threw: ' + String(e) }
  try {
    st.tab = 'text'
    st.textFile = [P]
    st.outDir = OUT
    st.outputs = []
    await st.run()
    res.text = st.outputs
  } catch (e) { res.text = 'threw: ' + String(e) }
  return res
})()
