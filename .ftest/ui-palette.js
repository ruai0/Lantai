(async () => {
  const __Z = window.__Z
  const res = {}
  // ── 1) 命令面板：Ctrl+K 唤起、关键词过滤、回车直达 ──────────────────
  if (!(await __Z.nav('#/', 'pinned'))) return { fail: 'HomeView 未挂载' }
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true, bubbles: true }))
  res.paletteOpened = await __Z.wait(() => !!document.querySelector('.cmd-overlay'), 5000)
  if (!res.paletteOpened) return res
  const inp = document.querySelector('.cmd-input')
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
  setter.call(inp, '水印')
  inp.dispatchEvent(new Event('input', { bubbles: true }))
  await __Z.wait(() => {
    const items = [...document.querySelectorAll('.cmd-item .cmd-label')]
    return items.length > 0 && items[0].textContent.trim() === 'PDF 工具'
  }, 3000)
  const items = [...document.querySelectorAll('.cmd-item')]
  res.paletteFilter = items.map(i => i.querySelector('.cmd-label')?.textContent.trim()).join(',')
  items[0].click()
  res.paletteGotoPdf = await __Z.wait(() => location.hash === '#/pdf' && !document.querySelector('.cmd-overlay'), 5000)

  // ── 2) 收藏：首页星标 → 持久化 → 侧栏分组 → 取消收藏还原 ────────────
  if (!(await __Z.nav('#/', 'pinned'))) return { fail: 'HomeView 未挂载' }
  const home = __Z.vm('pinned')
  const star = document.querySelector('.tool-card .tool-star')
  if (!star) return { ...res, fail: '首页卡片无星标按钮' }
  star.click()
  res.pinToggled = await __Z.wait(() => home.pinned.length === 1, 5000)
  const back = await window.api.getSettings()
  res.favPersisted = !!(back.ok && back.data.favorites.includes('/pdf'))
  res.favSectionOnHome = await __Z.wait(() => !!document.querySelector('.tool-card--fav'), 3000)
  res.sidebarFavGroup = await __Z.wait(
    () => [...document.querySelectorAll('.el-menu-item-group__title')].some(t => t.textContent.includes('收藏')),
    3000
  )
  document.querySelector('.tool-card--fav .tool-star')?.click()
  res.favRestored = await __Z.wait(() => home.pinned.length === 0, 5000)

  // ── 3) 诊断信息：IPC 有数据 + 点击按钮有 UI 反馈 ─────────────────────
  if (!(await __Z.nav('#/settings', 'loadProbe'))) return { fail: 'SettingsView 未挂载' }
  const diag = await window.api.diagnostics()
  res.diagOk = !!(diag.ok && diag.data.version && diag.data.platform && diag.data.userData)
  const st = __Z.vm('loadProbe')
  await st.copyDiagnostics()
  res.diagMsgShown = await __Z.wait(
    () => [...document.querySelectorAll('.el-message')].some(m => /诊断信息|复制失败/.test(m.textContent)),
    5000
  )

  // ── 4) 系统通知通道：app:notify 走通主进程 ──────────────────────────
  const n = await window.api.notify({ title: 'FreeTool 冒烟测试', body: '系统通知通道正常' })
  res.notifyOk = n.ok && n.data === true

  return res
})()
