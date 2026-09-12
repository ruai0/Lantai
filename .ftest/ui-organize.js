(async () => {
  const __Z = window.__Z
  // 1. 进入 PDF 工具 → 页面整理
  if (!(await __Z.nav('#/pdf', 'orgFiles'))) return { fail: 'PdfView 未挂载' }
  const st = __Z.vm('orgFiles')
  st.tab = 'organize'
  await __Z.wait(() => !!__Z.btn('载入页面缩略图'), 5000)

  // 2. 注入两个 fixture PDF 与输出目录
  const FT = 'J:/chinaMobile/network_project/freeTool/.ftest/'
  st.orgFiles = [FT + 'fixture-a.pdf', FT + 'fixture-b.pdf']
  st.outDir = FT + 'out'
  st.outputs = []

  // 3. 载入缩略图（验证 pdf.js 内联 worker + CSP + blob worker）
  __Z.btn('载入页面缩略图').click()
  const loaded = await __Z.wait(() => !st.orgBusy, 120000)
  if (!loaded) return { fail: '载入缩略图超时（worker 可能被阻塞）' }
  if (st.orgPages.length !== 5) return { fail: '期望 5 页缩略图', got: st.orgPages.length }
  if (!st.orgPages[0].thumb.startsWith('data:image/jpeg;base64,')) return { fail: '缩略图不是 jpeg dataURL' }

  // 4. 调序：首页移到最后，再删第 2 页 → 期望输出 4 页
  const arr = st.orgPages
  arr.push(arr.shift())
  arr.splice(1, 1)
  const order = st.orgPages.map(p => `${p.source}:${p.page}`).join(' ')
  if (order !== '0:1 1:1 1:2 0:0') return { fail: '调序结果不符', order }

  // 5. 应用整理
  __Z.btn('应用整理').click()
  const done = await __Z.wait(() => !st.running && st.outputs && st.outputs.length > 0, 120000)
  if (!done) return { fail: '应用整理超时', order }
  return { ok: true, order, outputs: JSON.parse(JSON.stringify(st.outputs)) }
})()
