(async () => {
  // 页面内驱动助手（幂等注入）
  window.__Z = window.__Z || {
    vm(key) {
      for (const el of document.querySelectorAll('*')) {
        let c = el.__vueParentComponent
        while (c) {
          try {
            if (c.setupState && key in c.setupState) return c.setupState
          } catch {}
          c = c.parent
        }
      }
      return null
    },
    btn(text) {
      for (const b of document.querySelectorAll('button'))
        if (b.textContent.trim().includes(text)) return b
      return null
    },
    async wait(fn, ms = 30000) {
      const t0 = Date.now()
      while (Date.now() - t0 < ms) {
        try {
          if (fn()) return true
        } catch {}
        await new Promise(r => setTimeout(r, 200))
      }
      return false
    },
    async nav(hash, vmKey, ms = 10000) {
      location.hash = hash
      const ok = await __Z.wait(() => __Z.vm(vmKey), ms)
      return ok
    }
  }
  const __Z = window.__Z

  // 1. 进入 PDF 工具 → 页面整理
  if (!(await __Z.nav('#/pdf', 'orgFiles'))) return { fail: 'PdfView 未挂载（__vueParentComponent 不可用？）' }
  const st = __Z.vm('orgFiles')
  st.tab = 'organize'
  await __Z.wait(() => !!__Z.btn('载入页面缩略图'), 5000)

  // 2. 注入两个真实 PDF 与输出目录
  const PDF_A = 'C:\\Users\\REALE ME\\Downloads\\4-权限管理数据库模型.pdf'
  const PDF_B = 'C:\\Users\\REALE ME\\Downloads\\Java编程规范新版.pdf'
  st.orgFiles = [PDF_A, PDF_B]
  st.outDir = 'J:\\chinaMobile\\network_project\\freeTool\\.ftest\\out'
  st.outputs = []

  // 3. 载入缩略图（验证 pdf.js 内联 worker + CSP 修复）
  const loadBtn = __Z.btn('载入页面缩略图')
  if (!loadBtn) return { fail: '找不到载入按钮' }
  loadBtn.click()
  const loaded = await __Z.wait(() => !st.orgBusy, 180000)
  if (!loaded) return { fail: '载入缩略图超时（worker 可能仍被阻塞）' }
  if (!st.orgPages.length) return { fail: 'orgPages 为空 —— worker 未产出任何页面' }
  const sampleThumb = st.orgPages[0].thumb
  if (typeof sampleThumb !== 'string' || !sampleThumb.startsWith('data:image/jpeg;base64,'))
    return { fail: '首张缩略图不是 jpeg dataURL', got: String(sampleThumb).slice(0, 60) }

  const before = st.orgPages.map(p => `${p.source}:${p.page}`).join(' ')

  // 4. 调序：把第 1 页移到最后；删除第 2 页
  const arr = st.orgPages
  arr.push(arr.shift())
  arr.splice(1, 1)
  const after = st.orgPages.map(p => `${p.source}:${p.page}`).join(' ')

  // 5. 应用整理
  const applyBtn = __Z.btn('应用整理')
  if (!applyBtn) return { fail: '找不到应用整理按钮' }
  applyBtn.click()
  const done = await __Z.wait(() => !st.running && st.outputs && st.outputs.length > 0, 120000)
  return {
    ok: done,
    pagesLoaded: st.orgPages.length + 2, // 移了 1 删了 1，还原原始总数
    orderBefore: before.slice(0, 60),
    orderAfter: after.slice(0, 60),
    outputs: st.outputs || []
  }
})()
