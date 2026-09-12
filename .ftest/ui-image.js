(async () => {
  const __Z = window.__Z
  if (!(await __Z.nav('#/image', 'stitchFiles'))) return { fail: 'ImageView 未挂载' }
  const st = __Z.vm('stitchFiles')
  const OUT = 'J:/chinaMobile/network_project/freeTool/.ftest/out'
  const IMG = 'J:/chinaMobile/network_project/freeTool/.ftest/img/'
  const res = {}
  st.imgTab = 'stitch'
  await __Z.wait(() => !!__Z.btn('开始拼接') || !!st.runStitch, 3000)
  st.stitchFiles = [IMG + 'seg1.png', IMG + 'seg2.png', IMG + 'seg3.png']
  st.outDir = OUT
  await st.runStitch()
  res.stitch = st.stitchOutput
  st.imgTab = 'idphoto'
  await __Z.wait(() => !!__Z.btn('开始排版'), 3000)
  st.idFile = [IMG + 'idphoto.png']
  await st.runIdPhoto()
  res.idphoto = st.idOutput
  return res
})()
