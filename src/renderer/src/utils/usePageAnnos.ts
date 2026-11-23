/**
 * PDF 工作台「大图页面编辑」组合式函数：马赛克 / 涂抹 / 贴图 / 框选复制 / 撤销。
 *
 * 与图片工具的「贴图 / 遮挡」是同一套交互，但落点完全不同：
 * - 图片工具改的是位图本身；这里改的是 PDF 页面，编辑记录为 **PDF 用户空间磅值**
 *   （用 pdf.js 视口 convertToPdfPoint 就地换算，页面自身旋转与工作台的额外旋转都已含在视口里），
 *   导出时由主进程 pdf-lib 画进内容流——文字层不丢、不整页栅格化、旋转页同样准确。
 * - 画布分层：base 离屏画布只放 pdf.js 渲染结果；可见画布 = base + 标注，
 *   每次变化整体重绘。马赛克取色与框选复制都取「当前可见」状态，盖住的就是看到的。
 */
import { ref } from 'vue'
import type { PdfPageAnno, PdfStickerAnno } from '@shared/types'
import { defaultStampSize } from './imageEdit'
import { isDrawableStroke, MIN_BRUSH_STEP_PT, mosaicBlocks } from '@shared/pdfAnno'

/** pdf.js 视口的最小结构（PDFPageViewport 结构上都满足） */
export interface AnnoViewport {
  scale: number
  convertToPdfPoint(x: number, y: number): number[]
  convertToViewportPoint(x: number, y: number): number[]
}

export type AnnoTool = 'none' | 'mosaic' | 'brush' | 'sticker' | 'copy'

/** 高清重取样的整页快照：canvas 为页面按 pxPerPt 像素/磅渲染的结果（不含标注） */
export interface AnnoSnapshot {
  canvas: HTMLCanvasElement
  vp: AnnoViewport
}

/**
 * 页面高清取样钩子：马赛克取色 / 框选复制从「屏幕分辨率画布」取样会糊，
 * 由调用方（工作台）用 pdf.js 按指定像素密度重渲染整页，这里再叠加标注使用。
 * 返回 null 表示无法取样（调用方回退到屏幕画布）。
 */
export type CapturePage = (pxPerPt: number) => Promise<AnnoSnapshot | null>

/** 框选复制/马赛克的取样密度（像素/磅）：4 ≈ 288 DPI，接近打印级 */
const COPY_PX_PER_PT = 4
const MOSAIC_PX_PER_PT = 3

/** 贴图缩放手柄命中半径（屏幕 CSS 像素） */
const HANDLE_PX = 8
/** 撤销栈深度 */
const UNDO_LIMIT = 30
/** 马赛克/框选最小选区（屏幕 CSS 像素），低于此视为误触 */
const MIN_SEL_PX = 10

let stickerSeq = 0

export function usePageAnnos(
  getAnnos: () => PdfPageAnno[] | undefined,
  commit: (next: PdfPageAnno[]) => void,
  hooks?: { capturePage?: CapturePage }
) {
  const capturePage = hooks?.capturePage
  const tool = ref<AnnoTool>('none')
  /** 撤销栈是否非空（按钮禁用态用） */
  const canUndo = ref(false)
  const brushColor = ref('#111111')
  /** 笔宽（磅值） */
  const brushWidth = ref(3)
  /** 马赛克块边长（屏幕 CSS 像素，与图片工具一致的口径） */
  const mosaicCell = ref(14)
  const stickerOpacity = ref(0.85)
  const selectedId = ref(0)
  /** 待放置贴图（来自文件选择 / 剪贴板 / 框选复制） */
  const pending = ref<{ png: string; natW: number; natH: number } | null>(null)
  /** 马赛克/框选的拖拽预览框（屏幕 CSS 像素，相对画布） */
  const dragSel = ref<{ x: number; y: number; w: number; h: number } | null>(null)

  let vp: AnnoViewport | null = null
  let dpr = 1
  let base: HTMLCanvasElement | null = null
  let view: HTMLCanvasElement | null = null
  const undoStack: PdfPageAnno[][] = []
  const imgCache = new Map<string, HTMLImageElement>()

  type DragMode = 'idle' | 'mosaic' | 'copy' | 'brush' | 'move' | 'resize'
  let mode: DragMode = 'idle'
  let dragStart = { x: 0, y: 0 }
  let moveStartPdf = { x: 0, y: 0 }
  let moveFrom = { x: 0, y: 0, w: 0, h: 0 }
  let stroke: number[] = []
  let moved = false
  /** 正在拖动/缩放的贴图 id */
  let moveId0 = 0

  /* ---------- 坐标换算 ---------- */

  function attach(baseCanvas: HTMLCanvasElement, viewCanvas: HTMLCanvasElement): void {
    base = baseCanvas
    view = viewCanvas
  }

  function setViewport(v: AnnoViewport, devicePixelRatio: number): void {
    vp = v
    dpr = devicePixelRatio || 1
  }

  /** 鼠标事件 → 画布内的屏幕 CSS 像素 */
  function cssPt(e: MouseEvent): { x: number; y: number } {
    if (!view) return { x: 0, y: 0 }
    const r = view.getBoundingClientRect()
    return {
      x: Math.max(0, Math.min(e.clientX - r.left, r.width)),
      y: Math.max(0, Math.min(e.clientY - r.top, r.height))
    }
  }

  /** 屏幕 CSS px → PDF 磅值 */
  function toPdf(cssX: number, cssY: number): { x: number; y: number } {
    if (!vp) return { x: 0, y: 0 }
    const [x, y] = vp.convertToPdfPoint(cssX * dpr, cssY * dpr)
    return { x, y }
  }

  /** PDF 磅值 → 屏幕 CSS px（命中测试用） */
  function pdfToCss(x: number, y: number): { x: number; y: number } {
    if (!vp) return { x: 0, y: 0 }
    const [vx, vy] = vp.convertToViewportPoint(x, y)
    return { x: vx / dpr, y: vy / dpr }
  }

  /** PDF 磅值 → 指定视口的后备存储像素（绘制用；不给 v 用当前屏幕视口） */
  function pdfToBackingOn(x: number, y: number, v: AnnoViewport | null): { x: number; y: number } {
    if (!v) return { x: 0, y: 0 }
    const [vx, vy] = v.convertToViewportPoint(x, y)
    return { x: vx, y: vy }
  }

  /** PDF 磅值 → 画布后备存储像素（绘制用） */
  function pdfToBacking(x: number, y: number): { x: number; y: number } {
    return pdfToBackingOn(x, y, vp)
  }

  /** 1 屏幕 CSS px 折合多少磅 */
  function cssToPt(): number {
    return vp ? dpr / vp.scale : 1
  }

  /* ---------- 绘制 ---------- */

  function getImg(png: string): HTMLImageElement | null {
    let img = imgCache.get(png)
    if (!img) {
      img = new Image()
      // 贴图解码完成前画不出来；加载好后整体重绘一次
      img.onload = () => redraw()
      img.src = png
      imgCache.set(png, img)
    }
    return img.complete && img.naturalWidth > 0 ? img : null
  }

  function drawAnnos(ctx: CanvasRenderingContext2D, annos: PdfPageAnno[], v: AnnoViewport | null = vp): void {
    ctx.imageSmoothingQuality = 'high'
    for (const a of annos) {
      if (a.kind === 'mosaic') {
        const tl = pdfToBackingOn(a.x, a.y + a.h, v)
        const br = pdfToBackingOn(a.x + a.w, a.y, v)
        const c = a.color.map(x => Math.round(x * 255))
        ctx.fillStyle = `rgb(${c[0]}, ${c[1]}, ${c[2]})`
        ctx.fillRect(tl.x, tl.y, br.x - tl.x, br.y - tl.y)
      } else if (a.kind === 'brush') {
        if (a.points.length < 4) continue
        ctx.strokeStyle = a.color
        ctx.lineWidth = Math.max(0.5, a.width * (v?.scale ?? 1))
        ctx.lineCap = 'round'
        ctx.lineJoin = 'round'
        ctx.beginPath()
        for (let i = 0; i < a.points.length; i += 2) {
          const p = pdfToBackingOn(a.points[i], a.points[i + 1], v)
          if (i === 0) ctx.moveTo(p.x, p.y)
          else ctx.lineTo(p.x, p.y)
        }
        ctx.stroke()
      } else {
        const img = getImg(a.png)
        if (!img) continue
        const tl = pdfToBackingOn(a.x, a.y + a.h, v)
        const br = pdfToBackingOn(a.x + a.w, a.y, v)
        ctx.save()
        ctx.globalAlpha = Math.min(1, Math.max(0.05, a.opacity))
        ctx.drawImage(img, tl.x, tl.y, br.x - tl.x, br.y - tl.y)
        ctx.restore()
      }
    }
  }

  /** base + 全部标注 + 进行中的临时图形（选区/笔画/选中框/待放贴图） */
  function redraw(): void {
    if (!view || !base) return
    const ctx = view.getContext('2d')
    if (!ctx) return
    ctx.imageSmoothingQuality = 'high'
    ctx.clearRect(0, 0, view.width, view.height)
    ctx.drawImage(base, 0, 0)
    const annos = getAnnos() ?? []
    drawAnnos(ctx, annos)

    // 进行中的笔画
    if (mode === 'brush' && stroke.length >= 4) {
      ctx.strokeStyle = brushColor.value
      ctx.lineWidth = Math.max(0.5, brushWidth.value * (vp?.scale ?? 1))
      ctx.lineCap = 'round'
      ctx.lineJoin = 'round'
      ctx.beginPath()
      for (let i = 0; i < stroke.length; i += 2) {
        const p = pdfToBacking(stroke[i], stroke[i + 1])
        if (i === 0) ctx.moveTo(p.x, p.y)
        else ctx.lineTo(p.x, p.y)
      }
      ctx.stroke()
    }

    // 马赛克/框选的拖拽预览
    const sel = dragSel.value
    if (sel && (mode === 'mosaic' || mode === 'copy')) {
      ctx.save()
      ctx.strokeStyle = mode === 'mosaic' ? '#1677ff' : '#52c41a'
      ctx.lineWidth = 1.5 * dpr
      ctx.setLineDash([6 * dpr, 4 * dpr])
      ctx.strokeRect(sel.x * dpr, sel.y * dpr, sel.w * dpr, sel.h * dpr)
      ctx.restore()
    }

    // 选中贴图的轮廓 + 缩放手柄
    const selSt = annos.find(a => a.kind === 'sticker' && a.id === selectedId.value) as PdfStickerAnno | undefined
    if (selSt) {
      const tl = pdfToCss(selSt.x, selSt.y + selSt.h)
      const br = pdfToCss(selSt.x + selSt.w, selSt.y)
      ctx.save()
      ctx.strokeStyle = '#1677ff'
      ctx.lineWidth = 1.5 * dpr
      ctx.setLineDash([5 * dpr, 3 * dpr])
      ctx.strokeRect(tl.x * dpr, tl.y * dpr, (br.x - tl.x) * dpr, (br.y - tl.y) * dpr)
      ctx.setLineDash([])
      ctx.fillStyle = '#1677ff'
      const h = HANDLE_PX * dpr
      ctx.fillRect(br.x * dpr - h / 2, br.y * dpr - h / 2, h, h)
      ctx.restore()
    }

    // 待放置贴图的预览轮廓（跟随鼠标）
    const pend = pending.value
    if (pend && view) {
      const size = defaultStampSize(view.clientWidth, view.clientHeight, pend.natW, pend.natH)
      ctx.save()
      ctx.strokeStyle = '#1677ff'
      ctx.lineWidth = 1.5 * dpr
      ctx.setLineDash([6 * dpr, 4 * dpr])
      ctx.strokeRect(
        dragStart.x * dpr - (size.w / 2) * dpr,
        dragStart.y * dpr - (size.h / 2) * dpr,
        size.w * dpr,
        size.h * dpr
      )
      ctx.restore()
    }
  }

  /* ---------- 撤销 / 提交 ---------- */

  function pushUndo(): void {
    undoStack.push(JSON.parse(JSON.stringify(getAnnos() ?? [])) as PdfPageAnno[])
    if (undoStack.length > UNDO_LIMIT) undoStack.shift()
    canUndo.value = true
  }

  function undo(): boolean {
    const prev = undoStack.pop()
    if (!prev) return false
    commit(prev)
    selectedId.value = 0
    canUndo.value = undoStack.length > 0
    redraw()
    return true
  }

  /** 滑块实时调选中贴图的透明度（同时记忆为下次贴图的默认透明度） */
  function setSelectedOpacity(v: number): void {
    const id = selectedId.value
    if (!id) return
    stickerOpacity.value = v
    commit((getAnnos() ?? []).map(a => (a.kind === 'sticker' && a.id === id ? { ...a, opacity: v } : a)))
    redraw()
  }

  function clearAnnos(): void {
    if (!(getAnnos() ?? []).length) return
    pushUndo()
    commit([])
    selectedId.value = 0
    redraw()
  }

  function removeSelected(): boolean {
    const id = selectedId.value
    if (!id) return false
    const cur = getAnnos() ?? []
    const rest = cur.filter(a => !(a.kind === 'sticker' && a.id === id))
    if (rest.length === cur.length) return false
    pushUndo()
    commit(rest)
    selectedId.value = 0
    redraw()
    return true
  }

  /* ---------- 贴图几何 ---------- */

  function stickerRectCss(s: PdfStickerAnno): { x: number; y: number; w: number; h: number } {
    const tl = pdfToCss(s.x, s.y + s.h)
    const br = pdfToCss(s.x + s.w, s.y)
    return { x: tl.x, y: tl.y, w: br.x - tl.x, h: br.y - tl.y }
  }

  function stickerAt(pt: { x: number; y: number }): number {
    const annos = getAnnos() ?? []
    for (let i = annos.length - 1; i >= 0; i--) {
      const a = annos[i]
      if (a.kind !== 'sticker') continue
      const r = stickerRectCss(a)
      if (pt.x >= r.x && pt.x <= r.x + r.w && pt.y >= r.y && pt.y <= r.y + r.h) return a.id
    }
    return 0
  }

  function hitHandle(s: PdfStickerAnno, pt: { x: number; y: number }): boolean {
    const br = pdfToCss(s.x + s.w, s.y)
    return Math.abs(pt.x - br.x) <= HANDLE_PX && Math.abs(pt.y - br.y) <= HANDLE_PX
  }

  /* ---------- 工具切换 ---------- */

  function setTool(t: AnnoTool): void {
    pending.value = null
    tool.value = t
    redraw()
  }

  function beginPending(png: string, natW: number, natH: number): void {
    pending.value = { png, natW, natH }
    tool.value = 'none'
    selectedId.value = 0
    redraw()
  }

  function placePending(pt: { x: number; y: number }): void {
    const pend = pending.value
    if (!pend || !view) return
    const size = defaultStampSize(view.clientWidth, view.clientHeight, pend.natW, pend.natH)
    const tl = toPdf(pt.x - size.w / 2, pt.y - size.h / 2)
    pushUndo()
    const id = ++stickerSeq
    commit([
      ...(getAnnos() ?? []),
      {
        kind: 'sticker',
        id,
        png: pend.png,
        x: tl.x,
        y: tl.y,
        w: size.w * cssToPt(),
        h: size.h * cssToPt(),
        opacity: stickerOpacity.value
      }
    ])
    selectedId.value = id
    pending.value = null
    redraw()
  }

  /* ---------- 指针交互 ---------- */

  function onDown(e: MouseEvent): void {
    if (!view) return
    const pt = cssPt(e)

    // 有待放置贴图：点哪放哪
    if (pending.value) {
      placePending(pt)
      return
    }

    if (tool.value === 'mosaic' || tool.value === 'copy') {
      mode = tool.value
      dragStart = pt
      dragSel.value = { x: pt.x, y: pt.y, w: 0, h: 0 }
      return
    }

    if (tool.value === 'brush') {
      mode = 'brush'
      stroke = []
      const p = toPdf(pt.x, pt.y)
      stroke.push(p.x, p.y)
      redraw()
      return
    }

    // 浏览模式：点贴图=选中/拖动，点把手=缩放，点空白=取消选择
    const id = stickerAt(pt)
    selectedId.value = id
    if (id) {
      const s = (getAnnos() ?? []).find(a => a.kind === 'sticker' && a.id === id) as PdfStickerAnno
      moveId0 = id
      moveFrom = { x: s.x, y: s.y, w: s.w, h: s.h }
      moveStartPdf = toPdf(pt.x, pt.y)
      mode = hitHandle(s, pt) ? 'resize' : 'move'
      moved = false
    } else {
      mode = 'idle'
    }
    redraw()
  }

  function onMove(e: MouseEvent): void {
    if (!view) return
    const pt = cssPt(e)

    // 待放置贴图跟随鼠标
    if (pending.value) {
      dragStart = pt
      redraw()
      return
    }

    if (mode === 'mosaic' || mode === 'copy') {
      dragSel.value = {
        x: Math.min(dragStart.x, pt.x),
        y: Math.min(dragStart.y, pt.y),
        w: Math.abs(pt.x - dragStart.x),
        h: Math.abs(pt.y - dragStart.y)
      }
      redraw()
      return
    }

    if (mode === 'brush') {
      const p = toPdf(pt.x, pt.y)
      const n = stroke.length
      if (n < 2) {
        stroke.push(p.x, p.y)
      } else {
        const dx = p.x - stroke[n - 2]
        const dy = p.y - stroke[n - 1]
        if (Math.hypot(dx, dy) >= MIN_BRUSH_STEP_PT) stroke.push(p.x, p.y)
      }
      redraw()
      return
    }

    if ((mode === 'move' || mode === 'resize') && moveId0) {
      const cur = toPdf(pt.x, pt.y)
      const dx = cur.x - moveStartPdf.x
      const dy = cur.y - moveStartPdf.y
      const s = (getAnnos() ?? []).find(a => a.kind === 'sticker' && a.id === moveId0) as PdfStickerAnno | undefined
      if (!s) return
      if (Math.abs(dx) > 0.01 || Math.abs(dy) > 0.01) {
        if (!moved) {
          pushUndo()
          moved = true
        }
        if (mode === 'move') {
          commit((getAnnos() ?? []).map(a =>
            a.kind === 'sticker' && a.id === moveId0 ? { ...a, x: moveFrom.x + dx, y: moveFrom.y + dy } : a
          ))
        } else {
          // 等比缩放：以左上角为锚，宽随手柄横向位移
          const tl = pdfToCss(moveFrom.x, moveFrom.y + moveFrom.h)
          const aspect = moveFrom.w / moveFrom.h
          const wPt = Math.max(8, (pt.x - tl.x) * cssToPt())
          commit((getAnnos() ?? []).map(a =>
            a.kind === 'sticker' && a.id === moveId0 ? { ...a, w: wPt, h: wPt / aspect } : a
          ))
        }
        redraw()
      }
    }
  }

  function onUp(): void {
    if (mode === 'mosaic' || mode === 'copy') {
      const sel = dragSel.value
      const wasMosaic = mode === 'mosaic'
      dragSel.value = null
      mode = 'idle'
      if (sel && sel.w >= MIN_SEL_PX && sel.h >= MIN_SEL_PX) {
        // 高清取样是异步的：选框先消失，块/贴图就绪后出现
        if (wasMosaic) void commitMosaic(sel)
        else void commitCopy(sel)
      } else {
        redraw()
      }
      return
    }
    if (mode === 'brush') {
      if (isDrawableStroke(stroke)) {
        pushUndo()
        commit([
          ...(getAnnos() ?? []),
          { kind: 'brush', color: brushColor.value, width: brushWidth.value, points: stroke }
        ])
      }
      stroke = []
      mode = 'idle'
      redraw()
      return
    }
    mode = 'idle'
  }

  /** 屏幕选区 → PDF 矩形（自动处理反向拖拽与旋转） */
  function selToPdfRect(sel: { x: number; y: number; w: number; h: number }): { x: number; y: number; w: number; h: number } | null {
    const a = toPdf(sel.x, sel.y)
    const b = toPdf(sel.x + sel.w, sel.y + sel.h)
    const w = Math.abs(b.x - a.x)
    const h = Math.abs(b.y - a.y)
    if (w < 0.5 || h < 0.5) return null
    return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w, h }
  }

  /** 防止上一次高清取样没完成时重复提交 */
  let committing = false

  /**
   * 页面「压平」快照：按 pxPerPt 像素/磅重渲染整页并叠加当前标注。
   * 马赛克取色与框选复制从这里取样（≈打印级密度），而不是屏幕分辨率画布——
   * 这样复制出来的块、马赛克平均色都来自原始页面内容，放大导出不糊。
   * 无法高清取样（未提供钩子/渲染失败）时返回 null，调用方回退屏幕画布。
   */
  async function flattenAt(pxPerPt: number): Promise<AnnoSnapshot | null> {
    if (!capturePage) return null
    let snap: AnnoSnapshot | null = null
    try {
      snap = await capturePage(pxPerPt)
    } catch {
      snap = null
    }
    if (!snap) return null
    const sctx = snap.canvas.getContext('2d')
    if (!sctx) return null
    drawAnnos(sctx, getAnnos() ?? [], snap.vp)
    return snap
  }

  /** 马赛克：优先整页高清取样，再按块平均；取不到就退回屏幕画布 */
  async function commitMosaic(sel: { x: number; y: number; w: number; h: number }): Promise<void> {
    if (committing) return
    const a = selToPdfRect(sel)
    if (!a) return
    committing = true
    try {
      const snap = await flattenAt(MOSAIC_PX_PER_PT)
      let ctx: CanvasRenderingContext2D | null
      let v: AnnoViewport | null
      if (snap) {
        ctx = snap.canvas.getContext('2d')
        v = snap.vp
      } else {
        ctx = view?.getContext('2d') ?? null
        v = vp
      }
      if (!ctx || !v) return
      const tl = pdfToBackingOn(a.x, a.y + a.h, v)
      const br = pdfToBackingOn(a.x + a.w, a.y, v)
      const ox = Math.round(Math.min(tl.x, br.x))
      const oy = Math.round(Math.min(tl.y, br.y))
      const rw = Math.round(Math.abs(br.x - tl.x))
      const rh = Math.round(Math.abs(br.y - tl.y))
      if (rw < 2 || rh < 2) return
      let data: Uint8ClampedArray
      try {
        data = ctx.getImageData(ox, oy, rw, rh).data
      } catch {
        return
      }
      const sampler = (bx: number, by: number, bw: number, bh: number): [number, number, number] => {
        const b1 = pdfToBackingOn(bx, by + bh, v)
        const b2 = pdfToBackingOn(bx + bw, by, v)
        const x0 = Math.max(0, Math.round(Math.min(b1.x, b2.x) - ox))
        const y0 = Math.max(0, Math.round(Math.min(b1.y, b2.y) - oy))
        const x1 = Math.min(rw, Math.round(Math.max(b1.x, b2.x) - ox))
        const y1 = Math.min(rh, Math.round(Math.max(b1.y, b2.y) - oy))
        let r = 0
        let g = 0
        let b = 0
        let n = 0
        for (let yy = y0; yy < y1; yy++) {
          for (let xx = x0; xx < x1; xx++) {
            const i = (yy * rw + xx) * 4
            r += data[i]
            g += data[i + 1]
            b += data[i + 2]
            n++
          }
        }
        if (!n) return [0, 0, 0]
        return [r / n / 255, g / n / 255, b / n / 255]
      }
      // 块的物理尺寸按当前屏幕口径换算（与滑块一致的观感），取样密度与块大小无关
      const blocks = mosaicBlocks(a, mosaicCell.value * cssToPt(), sampler)
      if (!blocks.length) return
      pushUndo()
      commit([...(getAnnos() ?? []), ...blocks])
      redraw()
    } finally {
      committing = false
    }
  }

  /**
   * 框选复制：优先从高清压平快照裁下选区（原始像素），进入「点击放置」状态；
   * 无法高清取样时退回屏幕画布截图（旧行为）。
   */
  async function commitCopy(sel: { x: number; y: number; w: number; h: number }): Promise<void> {
    if (committing) return
    committing = true
    try {
      const a = selToPdfRect(sel)
      if (a) {
        const snap = await flattenAt(COPY_PX_PER_PT)
        if (snap) {
          const p1 = snap.vp.convertToViewportPoint(a.x, a.y + a.h)
          const p2 = snap.vp.convertToViewportPoint(a.x + a.w, a.y)
          const sx = Math.round(Math.min(p1[0], p2[0]))
          const sy = Math.round(Math.min(p1[1], p2[1]))
          const sw = Math.round(Math.abs(p2[0] - p1[0]))
          const sh = Math.round(Math.abs(p2[1] - p1[1]))
          if (sw >= 2 && sh >= 2) {
            const tmp = document.createElement('canvas')
            tmp.width = sw
            tmp.height = sh
            const tctx = tmp.getContext('2d')
            if (!tctx) return
            tctx.imageSmoothingQuality = 'high'
            tctx.drawImage(snap.canvas, sx, sy, sw, sh, 0, 0, sw, sh)
            beginPending(tmp.toDataURL('image/png'), sw, sh)
            return
          }
        }
      }
      // 回退：从可见画布截取（屏幕分辨率）
      if (!view) return
      const sx = Math.round(sel.x * dpr)
      const sy = Math.round(sel.y * dpr)
      const sw = Math.max(1, Math.round(sel.w * dpr))
      const sh = Math.max(1, Math.round(sel.h * dpr))
      const tmp = document.createElement('canvas')
      tmp.width = sw
      tmp.height = sh
      const tctx = tmp.getContext('2d')
      if (!tctx) return
      tctx.drawImage(view, sx, sy, sw, sh, 0, 0, sw, sh)
      beginPending(tmp.toDataURL('image/png'), sw, sh)
    } finally {
      committing = false
    }
  }

  /* ---------- 键盘 ---------- */

  /** 处理预览态快捷键；返回 true 表示已消费（调用方不应再当翻页） */
  function onKey(e: KeyboardEvent): boolean {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
      e.preventDefault()
      undo()
      return true
    }
    if (e.key === 'Delete' || e.key === 'Backspace') {
      if (removeSelected()) {
        e.preventDefault()
        return true
      }
    }
    if (e.key === 'Escape') {
      if (pending.value) {
        pending.value = null
        redraw()
        return true
      }
      if (tool.value !== 'none') {
        setTool('none')
        return true
      }
      if (selectedId.value) {
        selectedId.value = 0
        redraw()
        return true
      }
    }
    return false
  }

  /** 切换预览页：清空编辑态（标注存在页数据上，不丢） */
  function reset(): void {
    tool.value = 'none'
    pending.value = null
    dragSel.value = null
    selectedId.value = 0
    stroke = []
    mode = 'idle'
    undoStack.length = 0
    canUndo.value = false
    imgCache.clear()
  }

  return {
    tool,
    canUndo,
    brushColor,
    brushWidth,
    mosaicCell,
    stickerOpacity,
    selectedId,
    pending,
    dragSel,
    attach,
    setViewport,
    redraw,
    setTool,
    beginPending,
    undo,
    setSelectedOpacity,
    clearAnnos,
    removeSelected,
    onDown,
    onMove,
    onUp,
    onKey,
    reset,
    /** 把标注画到任意视口的画布上（缩略图叠加标注结果用） */
    drawAnnos
  }
}
