(async () => {
  const __Z = window.__Z
  const st = __Z.vm('mMain')
  document.querySelectorAll('.el-message').forEach(m => m.remove())
  const FT = 'J:/chinaMobile/network_project/freeTool/.ftest/'
  st.tab = 'compare'
  st.cA.files = [FT + '名单A.xlsx']
  st.cA.key = '工号'
  st.cA.headers = ['工号', '姓名', '手机']
  st.cB.files = [FT + '名单B.xlsx']
  st.cB.key = '工号'
  st.cB.headers = ['工号', '姓名', '手机']
  await st.runCompare()
  const msgs = [...document.querySelectorAll('.el-message')].map(m => m.textContent.trim())
  return { msgs, compare: JSON.parse(JSON.stringify(st.compareResult || null)) }
})()
