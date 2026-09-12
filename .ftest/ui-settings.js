(async () => {
  const __Z = window.__Z
  const FT = 'J:/chinaMobile/network_project/freeTool/.ftest/'
  const res = {}
  // 1) 进入设置页
  if (!(await __Z.nav('#/settings', 'version'))) return { fail: 'SettingsView 未挂载' }
  const st = __Z.vm('version')
  res.versionShown = typeof st.version === 'string' && st.version.length > 0

  // 2) 主题切换：深色应写到 <html data-theme>
  await st.chooseTheme('dark')
  await new Promise(r => setTimeout(r, 150))
  res.themeDark = document.documentElement.dataset.theme === 'dark'
  await st.chooseTheme('light')
  await new Promise(r => setTimeout(r, 150))
  res.themeLight = document.documentElement.dataset.theme === 'light'

  // 3) 完成行为持久化：改设置后从主进程读回
  await st.chooseComplete('openFolder')
  const back = await window.api.getSettings()
  res.onCompletePersisted = back.ok && back.data.onComplete === 'openFolder'
  await st.chooseComplete('notify')

  // 4) 默认输出目录预填：设置后经 store 改默认，再进 PDF 页看 outDir 是否带出
  st.settings.defaultOutDir = FT + 'out'
  if (!(await __Z.nav('#/pdf', 'orgFiles'))) return { fail: 'PdfView 未挂载' }
  const pdf = __Z.vm('orgFiles')
  await __Z.wait(() => !!pdf.outDir, 3000)
  res.defaultDirPrefilled = pdf.outDir === FT + 'out'
  // 复原，避免影响其它场景
  st.settings.defaultOutDir = ''
  return res
})()
