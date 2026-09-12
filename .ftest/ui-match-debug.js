(async () => {
  const __Z = window.__Z
  const st = __Z.vm('mMain')
  document.querySelectorAll('.el-message').forEach(m => m.remove())
  const FT = 'J:/chinaMobile/network_project/freeTool/.ftest/'
  st.tab = 'fill'
  st.mMain.files = [FT + '主表.xlsx']
  st.mMain.key = '工号'
  st.mLook.files = [FT + '副表.xlsx']
  st.mLook.key = '工号'
  st.mFetch = ['部门', '电话']
  st.outDir = FT + 'out'
  await st.runFill()
  const msgs = [...document.querySelectorAll('.el-message')].map(m => m.textContent.trim())
  return { msgs, fillKeys: st.fillResult ? Object.keys(st.fillResult) : null, fill: JSON.parse(JSON.stringify(st.fillResult || null)) }
})()
