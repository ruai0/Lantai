(async () => {
  const __Z = window.__Z
  if (!(await __Z.nav('#/pdf', 'orgFiles'))) return { fail: 'no mount' }
  const st = __Z.vm('orgFiles')
  const FT = 'J:/chinaMobile/network_project/freeTool/.ftest/'
  st.tab = 'organize'
  await __Z.wait(() => !!__Z.btn('载入页面缩略图'), 5000)
  st.orgFiles = [FT + 'fixture-a.pdf']
  __Z.btn('载入页面缩略图').click()
  const ok = await __Z.wait(() => !st.orgBusy && st.orgPages.length > 0, 60000)
  if (!ok) return { fail: 'timeout' }
  return { b64: st.orgPages[0].thumb.split(',')[1] }
})()
