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
  if (!ok) return { fail: 'thumb load timeout' }
  // 复刻 runCompress：用 pdfjs 直接渲染 120dpi 页面
  const r = await window.api.readFiles([FT + 'fixture-a.pdf'])
  const bin = atob(r.data[0].base64)
  const bytes = Uint8Array.from(bin, c => c.charCodeAt(0))
  const pdfjs = await import('/node_modules/pdfjs-dist/build/pdf.mjs').catch(() => null)
  // 拿不到独立 pdfjs，就用缩略图放大近似——不，直接走通道测 build：
  const b64 = st.orgPages[0].thumb.split(',')[1]
  const rb = await window.api.pdfBuildFromImages({ imagesBase64: [b64], outDir: FT + 'out', nameHint: 'probe' })
  return {
    thumbHead: b64.slice(0, 10),
    thumbLen: b64.length,
    build: rb.ok ? 'ok' : 'ERR:' + rb.error
  }
})()
