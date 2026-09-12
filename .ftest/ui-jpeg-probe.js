(async () => {
  const __Z = window.__Z
  if (!(await __Z.nav('#/pdf', 'orgFiles'))) return { fail: 'no mount' }
  const st = __Z.vm('orgFiles')
  const r = await window.api.readFiles(['J:/chinaMobile/network_project/freeTool/.ftest/fixture-a.pdf'])
  const bin = atob(r.data[0].base64)
  const bytes = Uint8Array.from(bin, c => c.charCodeAt(0))
  const opened = await (async () => {
    // 复用页面已加载的 pdfjs：通过 PdfView 的缩略图路径拿 doc
    st.tab = 'organize'
    st.orgFiles = ['J:/chinaMobile/network_project/freeTool/.ftest/fixture-a.pdf']
    await __Z.wait(() => !!__Z.btn('载入页面缩略图'), 5000); __Z.btn('载入页面缩略图').click()
    await __Z.wait(() => !st.orgBusy, 60000)
    return st.orgPages.length
  })()
  // 直接渲染一页成 JPEG 检查头部
  const img = new Image()
  img.src = 'data:image/jpeg;base64,' + st.orgPages[0].thumb.split(',')[1]
  await new Promise((res, rej) => { img.onload = res; img.onerror = rej })
  const canvas = document.createElement('canvas')
  canvas.width = 992
  canvas.height = 1403
  const ctx = canvas.getContext('2d')
  ctx.fillStyle = '#fff'
  ctx.fillRect(0, 0, 992, 1403)
  ctx.drawImage(img, 0, 0)
  const jpegB64 = canvas.toDataURL('image/jpeg', 0.6).split(',')[1]
  return {
    thumbs: opened,
    thumbHead: st.orgPages[0].thumb.slice(0, 30),
    jpegHead: jpegB64.slice(0, 12),
    jpegIsSoi: jpegB64.startsWith('/9j/'),
    jpegLen: jpegB64.length
  }
})()
