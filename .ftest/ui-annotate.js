(async () => {
  const __Z = window.__Z
  if (!(await __Z.nav('#/image', 'annoFile'))) return { fail: 'ImageView 未挂载' }
  const st = __Z.vm('annoFile')
  const OUT = 'J:/chinaMobile/network_project/freeTool/.ftest/out'
  const IMG = 'J:/chinaMobile/network_project/freeTool/.ftest/img/'
  const ed = () => __Z.vm('stamps')
  const res = {}

  st.imgTab = 'annotate'
  await __Z.wait(() => !!__Z.btn('保存结果'), 3000)
  st.annoFile = [IMG + 'seg1.png']
  await __Z.wait(() => ed() && ed().ready, 6000)
  if (!ed() || !ed().ready) return { fail: '编辑器未就绪' }

  const canvas = document.querySelector('.ed-canvas')
  const r = canvas.getBoundingClientRect()
  const fire = (type, x, y) =>
    canvas.dispatchEvent(
      new PointerEvent(type, { pointerId: 7, clientX: r.left + x, clientY: r.top + y, bubbles: true })
    )
  const dragBox = (x1, y1, x2, y2) => {
    fire('pointerdown', x1, y1)
    fire('pointermove', (x1 + x2) / 2, (y1 + y2) / 2)
    fire('pointermove', x2, y2)
    fire('pointerup', x2, y2)
  }
  const hash = async blob => {
    const d = new Uint8Array(await blob.arrayBuffer())
    let h = 2166136261
    for (const b of d) {
      h ^= b
      h = Math.imul(h, 16777619)
    }
    return h >>> 0
  }
  const sizeOf = async blob => {
    const url = URL.createObjectURL(blob)
    const img = new Image()
    await new Promise((ok, err) => {
      img.onload = ok
      img.onerror = err
      img.src = url
    })
    URL.revokeObjectURL(url)
    return [img.naturalWidth, img.naturalHeight]
  }
  const ex = f => st.editorRef.exportBlob(f ?? 'image/png', 100)

  // 基线：未标注导出尺寸应等于原图
  const h0 = await hash(await ex())
  res.baseSize = await sizeOf(await ex())

  // 马赛克：拖矩形改变像素；撤销后逐字节还原
  ed().tool = 'mosaic'
  ed().mosaicCell = 16
  dragBox(r.width * 0.1, r.height * 0.1, r.width * 0.45, r.height * 0.4)
  res.mosaicChanged = (await hash(await ex())) !== h0
  ed().undo()
  res.undoRestored = (await hash(await ex())) === h0

  // 涂抹：画笔涂一笔也应改变像素
  ed().tool = 'cover'
  fire('pointerdown', r.width * 0.6, r.height * 0.6)
  fire('pointermove', r.width * 0.75, r.height * 0.7)
  fire('pointerup', r.width * 0.75, r.height * 0.7)
  res.coverChanged = (await hash(await ex())) !== h0
  ed().undo()
  res.coverRestored = (await hash(await ex())) === h0

  // 贴图：点击放置 → 落下合并改变像素 → 撤销还原
  const rf = await window.api.readFiles([IMG + 'seg2.png'])
  if (!rf.ok || !rf.data.length) return { fail: '贴图素材读取失败' }
  const im = new Image()
  im.src = 'data:image/png;base64,' + rf.data[0].base64
  await new Promise((ok, err) => {
    im.onload = ok
    im.onerror = err
  })
  ed().tool = 'stamp'
  ed().stampSrc = { name: 'seg2.png', img: im, sw: im.naturalWidth, sh: im.naturalHeight }
  fire('pointerdown', r.width * 0.5, r.height * 0.5)
  fire('pointerup', r.width * 0.5, r.height * 0.5)
  res.stampPlaced = ed().stamps.length === 1
  ed().mergeDown()
  res.stampMerged = (await hash(await ex())) !== h0
  ed().undo()
  res.stampRestored = (await hash(await ex())) === h0

  // 框选：拖框 → 复制 → Ctrl+V 原尺寸贴出 → 合并改变像素
  ed().tool = 'select'
  dragBox(r.width * 0.1, r.height * 0.6, r.width * 0.3, r.height * 0.8)
  await __Z.wait(() => !!ed().selRect, 2000)
  res.selectRect = !!ed().selRect
  await ed().copySelection()
  res.clipReady = !!ed().clip
  // 原图层无损验证：按 snap 后的原位贴回 → 合并 → 与未标注基线逐字节一致
  const rr = ed().selRect
  const cx = Math.round(rr.x)
  const cy = Math.round(rr.y)
  const cw = Math.round(rr.x + rr.w) - cx
  const ch = Math.round(rr.y + rr.h) - cy
  ed().placeStamp({ x: cx + cw / 2, y: cy + ch / 2 }, ed().clip, cw, ch, 'lossless', true)
  ed().mergeDown()
  res.lossless = (await hash(await ex())) === h0
  ed().undo()
  ed().pasteClip()
  res.pasteStamp = ed().stamps.length === 1
  ed().mergeDown()
  res.pasteMerged = (await hash(await ex())) !== h0
  ed().undo()

  // Alt+滚轮：以光标为中心缩放（zoomed 后退出适应）
  const s0 = ed().scale
  canvas.dispatchEvent(
    new WheelEvent('wheel', {
      altKey: true,
      deltaY: -100,
      clientX: r.left + r.width * 0.5,
      clientY: r.top + r.height * 0.5,
      bubbles: true
    })
  )
  res.altWheelZoom = ed().scale > s0
  ed().setFit(true)

  // 裁剪：框选后应用，导出尺寸等于选区尺寸
  ed().tool = 'crop'
  dragBox(r.width * 0.05, r.height * 0.05, r.width * 0.55, r.height * 0.55)
  if (!ed().cropRect) return { fail: '裁剪框未生成' }
  const cr = ed().cropRect
  const sx = Math.round(cr.x)
  const sy = Math.round(cr.y)
  const want = [Math.round(cr.x + cr.w) - sx, Math.round(cr.y + cr.h) - sy]
  ed().applyCrop()
  res.cropOk = JSON.stringify(await sizeOf(await ex())) === JSON.stringify(want)

  // 保存落盘
  st.outDir = OUT
  await st.runAnnoSave()
  res.saved = typeof st.annoOutput === 'string' && st.annoOutput.includes('seg1_标注')
  return res
})()
