(async () => {
  const __Z = window.__Z
  if (!(await __Z.nav('#/match', 'mMain'))) return { fail: 'MatchView 未挂载' }
  const st = __Z.vm('mMain')
  const OUT = 'J:/chinaMobile/network_project/freeTool/.ftest/out'
  const FT = 'J:/chinaMobile/network_project/freeTool/.ftest/'
  const res = {}
  st.tab = 'fill'
  st.mMain.files = [FT + '主表.xlsx']
  st.mMain.key = '工号'
  st.mLook.files = [FT + '副表.xlsx']
  st.mLook.key = '工号'
  st.mFetch = ['部门', '电话']
  st.outDir = OUT
  await st.runFill()
  res.fill = st.fillResult
  st.tab = 'compare'
  st.cA.files = [FT + '名单A.xlsx']
  st.cA.key = '工号'
  st.cA.headers = ['工号', '姓名', '手机']
  st.cB.files = [FT + '名单B.xlsx']
  st.cB.key = '工号'
  st.cB.headers = ['工号', '姓名', '手机']
  await st.runCompare()
  res.compare = st.compareResult
  return res
})()
