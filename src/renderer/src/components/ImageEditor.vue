<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'
import { ElMessage } from 'element-plus'
import { api } from '../utils/ipc'
import { call } from '../utils/api'
import {
  clamp,
  defaultStampSize,
  fitScale,
  hitResizeHandle,
  hitStamp,
  normalizeRect,
  pixelGrid,
  type Rect
} from '../utils/imageEdit'

/**
 * 单张图片的交互式标注画布：马赛克打码、涂抹遮挡、贴图盖章、框选复制、裁剪。
 * 全分辨率状态放在非响应式的离屏 canvas（work）上，viewRef 只做按 scale 的可视化渲染；
 * HTMLImageElement 不放进深响应式（Proxy 会丢失内部插槽导致 drawImage 失败），一律 shallowRef。
 */
interface StampItem {
  id: number
  img: CanvasImageSource
  name: string
  x: number
  y: number
  w: number
  h: number
  opacity: number
}

type Tool = 'mosaic' | 'cover' | 'stamp' | 'select' | 'crop'

const props = defineProps<{ image: { name: string; mime: string; base64: string } | null }>()

const rootRef = ref<HTMLDivElement | null>(null)
const viewRef = ref<HTMLCanvasElement | null>(null)
const wrapRef = ref<HTMLDivElement | null>(null)

const ready = ref(false)
const tool = ref<Tool>('mosaic')
const scale = ref(1)
const fitMode = ref(true)
const isFull = ref(false)

const mosaicCell = ref(14)
const brushColor = ref('#000000')
const brushSize = ref(28)
const stampSrc = shallowRef<{ name: string; img: HTMLImageElement; sw: number; sh: number } | null>(null)
const stampOpacity = ref(100)
const stamps = shallowRef<StampItem[]>([])
const selId = ref<number | null>(null)
const cropRect = ref<Rect | null>(null)
const selRect = ref<Rect | null>(null)
const clip = shallowRef<HTMLCanvasElement | null>(null)
const historyLen = ref(0)

let work: HTMLCanvasElement | null = null
let imgW = 0
let imgH = 0
let history: HTMLCanvasElement[] = []
let stampSeq = 0
let resizeObserver: ResizeObserver | null = null
const HISTORY_MAX = 12
const HANDLE_PX = 7 // 缩放把手命中半径（屏幕像素）

let drag: {
  mode: '' | 'rect' | 'stroke' | 'move' | 'resize'
  sx: number
  sy: number
  cx: number
  cy: number
  dx: number
  dy: number
  ow: number
  oh: number
  id: number
} = freshDrag()

function freshDrag() {
  return { mode: '' as const, sx: 0, sy: 0, cx: 0, cy: 0, dx: 0, dy: 0, ow: 0, oh: 0, id: 0 }
}

// 透明度滑块对「当前选中贴图」实时生效，未选中时作为下次放置的默认值
watch(stampOpacity, v => {
  const s = stamps.value.find(i => i.id === selId.value)
  if (s) {
    s.opacity = v
    render()
  }
})

const hint = computed(() => {
  switch (tool.value) {
    case 'mosaic':
      return '在图上拖出矩形打马赛克，可多次操作；块越小越细。'
    case 'cover':
      return '按住鼠标涂抹，盖住手机号、姓名等敏感信息；颜色和粗细在上方调整。'
    case 'stamp':
      return stampSrc.value
        ? '点击放置贴图，可连续盖多个；拖动移位、右下角缩放，选中后调透明度，「落下合并」写入图片。也可 Ctrl+V 粘贴剪贴板图片。'
        : '先点「选择贴图」挑一张图（建议带透明通道的 PNG，如电子章、Logo、截图），或 Ctrl+V 粘贴剪贴板里的图片。'
    case 'select':
      return selRect.value
        ? '已框选。Ctrl+C 复制选区（按原尺寸），Ctrl+V 贴出为贴图；复制后在其他软件里也能粘贴。'
        : '拖框圈住图上任意内容（文字、表格、印章），复制后可贴到别处。'
    case 'crop':
      return cropRect.value
        ? '拖动重新框选，满意后点「应用裁剪」；未落下的贴图会随裁剪一并合并。'
        : '在图上拖出要保留的区域。'
  }
})

const cursorClass = computed(() =>
  tool.value === 'cover' || tool.value === 'stamp' ? '' : 'ed-cross'
)

/* ---------- 加载与缩放 ---------- */

watch(
  () => props.image,
  () => {
    void load()
  },
  { immediate: true }
)

function loadImageEl(base64: string, mime: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('图片解码失败'))
    img.src = `data:${mime};base64,${base64}`
  })
}

async function load() {
  if (!props.image) {
    ready.value = false
    work = null
    history = []
    stamps.value = []
    selId.value = null
    cropRect.value = null
    selRect.value = null
    clip.value = null
    historyLen.value = 0
    return
  }
  try {
    const img = await loadImageEl(props.image.base64, props.image.mime)
    imgW = img.naturalWidth
    imgH = img.naturalHeight
    work = document.createElement('canvas')
    work.width = imgW
    work.height = imgH
    work.getContext('2d')!.drawImage(img, 0, 0)
    history = []
    stamps.value = []
    selId.value = null
    cropRect.value = null
    selRect.value = null
    stampSeq = 0
    historyLen.value = 0
    fitMode.value = true
    ready.value = true
    fit()
    render()
  } catch {
    ready.value = false
    ElMessage.error('图片解码失败，请换一张试试')
  }
}

function fit() {
  const wrap = wrapRef.value
  if (!wrap || !imgW) return
  scale.value = fitScale(imgW, imgH, wrap.clientWidth - 28, wrap.clientHeight - 28, 1)
}

function setFit(v: boolean) {
  fitMode.value = v
  if (v) fit()
  else scale.value = 1
  render()
}

function zoom(delta: number) {
  fitMode.value = false
  scale.value = clamp(Math.round((scale.value + delta) * 100) / 100, 0.05, 5)
  render()
}

/** Alt+滚轮：以光标处的图片点为中心缩放（普通滚轮照常平移） */
function onWheel(e: WheelEvent) {
  if (!e.altKey || !ready.value) return
  e.preventDefault()
  const canvas = viewRef.value
  const wrap = wrapRef.value
  if (!canvas || !wrap) return
  const old = scale.value
  const before = canvas.getBoundingClientRect()
  const u = (e.clientX - before.left) / old
  const v = (e.clientY - before.top) / old
  fitMode.value = false
  scale.value = clamp(old * (e.deltaY < 0 ? 1.15 : 1 / 1.15), 0.05, 5)
  render()
  const after = canvas.getBoundingClientRect()
  wrap.scrollLeft += after.left - (e.clientX - u * scale.value)
  wrap.scrollTop += after.top - (e.clientY - v * scale.value)
}

/* ---------- 历史与合成 ---------- */

function cloneOf(c: HTMLCanvasElement): HTMLCanvasElement {
  const n = document.createElement('canvas')
  n.width = c.width
  n.height = c.height
  n.getContext('2d')!.drawImage(c, 0, 0)
  return n
}

function pushHistory() {
  if (!work) return
  history.push(cloneOf(work))
  if (history.length > HISTORY_MAX) history.shift()
  historyLen.value = history.length
}

function undo() {
  if (!history.length || !work) return
  work = history.pop()!
  historyLen.value = history.length
  render()
}

function mergeStamps(target: HTMLCanvasElement, list: StampItem[]) {
  const ctx = target.getContext('2d')!
  for (const s of list) {
    ctx.save()
    ctx.globalAlpha = s.opacity / 100
    ctx.drawImage(s.img, s.x, s.y, s.w, s.h)
    ctx.restore()
  }
}

/** 落下合并：把未合并的贴图写进工作画布（可撤销） */
function mergeDown() {
  if (!work || !stamps.value.length) return
  pushHistory()
  mergeStamps(work, stamps.value)
  stamps.value = []
  selId.value = null
  render()
}

function pixelate(r: Rect) {
  if (!work) return
  const cell = clamp(mosaicCell.value, 4, 80)
  const { cols, rows } = pixelGrid(r.w, r.h, cell)
  const t = document.createElement('canvas')
  t.width = cols
  t.height = rows
  const tc = t.getContext('2d')!
  tc.drawImage(work, r.x, r.y, r.w, r.h, 0, 0, cols, rows)
  const ctx = work.getContext('2d')!
  ctx.imageSmoothingEnabled = false
  ctx.drawImage(t, 0, 0, cols, rows, r.x, r.y, r.w, r.h)
  ctx.imageSmoothingEnabled = true
}

/** 拖框取整到图片像素；贴图/复制/裁剪都按整数坐标走，避免亚像素重采样把原图插值糊掉 */
function snapRect(r: Rect): Rect {
  const x = Math.round(r.x)
  const y = Math.round(r.y)
  return { x, y, w: Math.round(r.x + r.w) - x, h: Math.round(r.y + r.h) - y }
}

function applyCrop() {
  if (!work || !cropRect.value) return
  const r = snapRect(cropRect.value)
  if (r.w < 8 || r.h < 8) {
    ElMessage.warning('选区太小，请重新框选')
    return
  }
  pushHistory()
  if (stamps.value.length) {
    mergeStamps(work, stamps.value)
    stamps.value = []
    selId.value = null
  }
  const c = document.createElement('canvas')
  c.width = Math.round(r.w)
  c.height = Math.round(r.h)
  c.getContext('2d')!.drawImage(work, r.x, r.y, r.w, r.h, 0, 0, c.width, c.height)
  work = c
  imgW = c.width
  imgH = c.height
  cropRect.value = null
  fitMode.value = true
  fit()
  render()
}

function cancelCrop() {
  cropRect.value = null
  render()
}

/* ---------- 贴图：放置 / 复制 / 粘贴 ---------- */

function placeStamp(
  p: { x: number; y: number },
  src: CanvasImageSource,
  sw: number,
  sh: number,
  name: string,
  natural: boolean
): StampItem {
  const size = natural
    ? { w: Math.min(sw, imgW), h: Math.min(sh, imgH) }
    : defaultStampSize(imgW, imgH, sw, sh)
  const item: StampItem = {
    id: ++stampSeq,
    img: src,
    name,
    x: Math.round(clamp(p.x - size.w / 2, 0, Math.max(0, imgW - size.w))),
    y: Math.round(clamp(p.y - size.h / 2, 0, Math.max(0, imgH - size.h))),
    w: Math.round(size.w),
    h: Math.round(size.h),
    opacity: stampOpacity.value
  }
  stamps.value = [...stamps.value, item]
  selId.value = item.id
  return item
}

/** 当前可视区域的中心（图片坐标），粘贴落点用 */
function viewCenter(): { x: number; y: number } {
  const canvas = viewRef.value
  const wrap = wrapRef.value
  if (!canvas || !wrap) return { x: imgW / 2, y: imgH / 2 }
  const sx = wrap.scrollLeft + wrap.clientWidth / 2 - canvas.offsetLeft
  const sy = wrap.scrollTop + wrap.clientHeight / 2 - canvas.offsetTop
  return {
    x: clamp(sx / scale.value, 0, imgW),
    y: clamp(sy / scale.value, 0, imgH)
  }
}

async function copySelection() {
  if (!work || !selRect.value) return
  const r = snapRect(selRect.value)
  if (r.w < 2 || r.h < 2) return
  const c = document.createElement('canvas')
  c.width = Math.round(r.w)
  c.height = Math.round(r.h)
  const ctx = c.getContext('2d')!
  ctx.imageSmoothingEnabled = false
  ctx.drawImage(work, r.x, r.y, r.w, r.h, 0, 0, c.width, c.height)
  ctx.save()
  ctx.translate(-r.x, -r.y)
  mergeStamps(c, stamps.value)
  ctx.restore()
  clip.value = c
  // 尽力写入系统剪贴板；失败不影响应用内粘贴
  try {
    const blob = await new Promise<Blob | null>(res => c.toBlob(res, 'image/png'))
    if (blob) await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })])
  } catch {
    /* 无权限或环境不支持 */
  }
  ElMessage.success('已复制选区，切到贴图或按 Ctrl+V 贴出')
}

function pasteClip() {
  if (!clip.value) {
    void readSystemClipboard()
    return
  }
  if (tool.value !== 'stamp') tool.value = 'stamp'
  placeStamp(viewCenter(), clip.value, clip.value.width, clip.value.height, '剪贴板', true)
  render()
}

/** Ctrl+V 在应用内没有复制内容时，读取系统剪贴板里的图片（截图 / PS 复制的均可） */
async function readSystemClipboard() {
  try {
    const items = await navigator.clipboard.read()
    const it = items.find(i => i.types.includes('image/png'))
    if (!it) {
      ElMessage.info('剪贴板里没有图片，可先在「框选」里复制选区')
      return
    }
    const blob = await it.getType('image/png')
    const bmp = await createImageBitmap(blob)
    const c = document.createElement('canvas')
    c.width = bmp.width
    c.height = bmp.height
    c.getContext('2d')!.drawImage(bmp, 0, 0)
    clip.value = c
    if (tool.value !== 'stamp') tool.value = 'stamp'
    placeStamp(viewCenter(), c, c.width, c.height, '剪贴板', true)
    render()
  } catch {
    ElMessage.info('无法读取系统剪贴板，可用「复制选区」在应用内完成')
  }
}

function cancelSel() {
  selRect.value = null
  render()
}

/* ---------- 指针交互 ---------- */

function toImgPoint(e: PointerEvent): { x: number; y: number } {
  const canvas = viewRef.value!
  const r = canvas.getBoundingClientRect()
  return {
    x: clamp((e.clientX - r.left) / scale.value, 0, imgW),
    y: clamp((e.clientY - r.top) / scale.value, 0, imgH)
  }
}

function onDown(e: PointerEvent) {
  if (!ready.value || !work || drag.mode) return
  try {
    viewRef.value!.setPointerCapture(e.pointerId)
  } catch {
    /* 合成事件或指针已失效时忽略，不影响本次交互 */
  }
  const p = toImgPoint(e)
  if (tool.value === 'cover') {
    pushHistory()
    drag = { ...freshDrag(), mode: 'stroke', sx: p.x, sy: p.y, cx: p.x, cy: p.y }
    strokeTo(p, null)
    return
  }
  if (tool.value === 'mosaic' || tool.value === 'crop' || tool.value === 'select') {
    drag = { ...freshDrag(), mode: 'rect', sx: p.x, sy: p.y, cx: p.x, cy: p.y }
    return
  }
  // 贴图：优先缩放把手 > 已有贴图 > 放置新贴图
  const list = stamps.value
  const sel = list.find(s => s.id === selId.value)
  if (sel && hitResizeHandle(sel, p, HANDLE_PX / scale.value)) {
    drag = { ...freshDrag(), mode: 'resize', id: sel.id, ow: sel.w, oh: sel.h }
    return
  }
  const hit = [...list].reverse().find(s => hitStamp(s, p))
  if (hit) {
    selId.value = hit.id
    drag = { ...freshDrag(), mode: 'move', id: hit.id, dx: p.x - hit.x, dy: p.y - hit.y }
    return
  }
  if (!stampSrc.value && !clip.value) {
    ElMessage.info('先点上方「选择贴图」挑图，或用「框选」复制一块内容再 Ctrl+V')
    return
  }
  const src = stampSrc.value
  const item = src
    ? placeStamp(p, src.img, src.sw || src.img.naturalWidth, src.sh || src.img.naturalHeight, src.name, false)
    : placeStamp(p, clip.value!, clip.value!.width, clip.value!.height, '剪贴板', true)
  drag = { ...freshDrag(), mode: 'move', id: item.id, dx: p.x - item.x, dy: p.y - item.y }
  render()
}

function onMove(e: PointerEvent) {
  if (!ready.value || !drag.mode || !work) return
  const p = toImgPoint(e)
  if (drag.mode === 'stroke') {
    strokeTo(p, { x: drag.cx, y: drag.cy })
    drag.cx = p.x
    drag.cy = p.y
    return
  }
  if (drag.mode === 'rect') {
    drag.cx = p.x
    drag.cy = p.y
    if (tool.value === 'crop') cropRect.value = normalizeRect(drag.sx, drag.sy, drag.cx, drag.cy)
    else if (tool.value === 'select') selRect.value = normalizeRect(drag.sx, drag.sy, drag.cx, drag.cy)
    render()
    return
  }
  const list = stamps.value
  const s = list.find(i => i.id === drag.id)
  if (!s) return
  if (drag.mode === 'move') {
    s.x = Math.round(clamp(p.x - drag.dx, 0, Math.max(0, imgW - s.w)))
    s.y = Math.round(clamp(p.y - drag.dy, 0, Math.max(0, imgH - s.h)))
  } else if (drag.mode === 'resize') {
    // 拖右下角等比缩放，最小 16px，不超出底图；取整避免亚像素重采样
    s.w = Math.round(clamp(p.x - s.x, 16, imgW - s.x))
    s.h = Math.max(16, Math.round(s.w * (drag.oh / Math.max(drag.ow, 1))))
    if (s.y + s.h > imgH) s.h = imgH - s.y
  }
  render()
}

function onUp() {
  if (!ready.value || !drag.mode) return
  if (drag.mode === 'rect' && tool.value === 'mosaic') {
    const r = snapRect(normalizeRect(drag.sx, drag.sy, drag.cx, drag.cy))
    if (r.w > 2 && r.h > 2) {
      pushHistory()
      pixelate(r)
    }
  }
  drag = freshDrag()
  render()
}

function strokeTo(p: { x: number; y: number }, from: { x: number; y: number } | null) {
  if (!work) return
  const ctx = work.getContext('2d')!
  ctx.fillStyle = brushColor.value
  ctx.strokeStyle = brushColor.value
  ctx.lineWidth = brushSize.value
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  if (from) {
    ctx.beginPath()
    ctx.moveTo(from.x, from.y)
    ctx.lineTo(p.x, p.y)
    ctx.stroke()
  } else {
    ctx.beginPath()
    ctx.arc(p.x, p.y, brushSize.value / 2, 0, Math.PI * 2)
    ctx.fill()
  }
  render()
}

/* ---------- 贴图素材 ---------- */

function mimeOf(name: string): string {
  const e = name.toLowerCase().split('.').pop() ?? ''
  if (e === 'png') return 'image/png'
  if (e === 'webp') return 'image/webp'
  if (e === 'bmp') return 'image/bmp'
  if (e === 'gif') return 'image/gif'
  return 'image/jpeg'
}

const pickingStamp = ref(false)
async function pickStamp() {
  pickingStamp.value = true
  try {
    const res = await api.pickFiles({
      title: '选择要贴上的图片（建议带透明通道的 PNG）',
      multiple: false,
      filters: [{ name: '图片', extensions: ['png', 'jpg', 'jpeg', 'webp', 'bmp'] }]
    })
    if (!res.ok || !res.data.length) return
    const r = await call(api.readFiles(res.data))
    if (!r || !r.length) return
    const img = await loadImageEl(r[0].base64, mimeOf(r[0].name))
    stampSrc.value = { name: r[0].name, img, sw: img.naturalWidth, sh: img.naturalHeight }
    if (tool.value !== 'stamp') tool.value = 'stamp'
  } catch {
    ElMessage.error('贴图解码失败，请换一张试试')
  } finally {
    pickingStamp.value = false
  }
}

function removeSelected() {
  if (selId.value == null) return
  stamps.value = stamps.value.filter(s => s.id !== selId.value)
  selId.value = null
  render()
}

/* ---------- 全屏 ---------- */

function onFsChange() {
  isFull.value = document.fullscreenElement === rootRef.value
}

function toggleFull() {
  const el = rootRef.value
  if (!el) return
  if (document.fullscreenElement) void document.exitFullscreen().catch(() => {})
  else void el.requestFullscreen().catch(() => ElMessage.info('当前环境不支持全屏'))
}

/* ---------- 供父组件导出 ---------- */

async function exportBlob(format: 'image/png' | 'image/jpeg', quality: number): Promise<Blob | null> {
  if (!work) return null
  const c = document.createElement('canvas')
  c.width = work.width
  c.height = work.height
  const ctx = c.getContext('2d')!
  if (format === 'image/jpeg') {
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, c.width, c.height)
  }
  ctx.drawImage(work, 0, 0)
  mergeStamps(c, stamps.value)
  return await new Promise(res => c.toBlob(res, format, quality / 100))
}

defineExpose({ exportBlob })

/* ---------- 生命周期 ---------- */

function onKey(e: KeyboardEvent) {
  if (!ready.value) return
  const t = e.target as HTMLElement | null
  if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return
  const mod = e.ctrlKey || e.metaKey
  const k = e.key.toLowerCase()
  if (mod && k === 'z') {
    e.preventDefault()
    undo()
  } else if (mod && k === 'c' && tool.value === 'select' && selRect.value) {
    e.preventDefault()
    void copySelection()
  } else if (mod && k === 'v') {
    e.preventDefault()
    pasteClip()
  } else if ((e.key === 'Delete' || e.key === 'Backspace') && tool.value === 'stamp' && selId.value != null) {
    e.preventDefault()
    removeSelected()
  }
}

onMounted(() => {
  window.addEventListener('keydown', onKey)
  document.addEventListener('fullscreenchange', onFsChange)
  wrapRef.value?.addEventListener('wheel', onWheel, { passive: false })
  if (wrapRef.value && typeof ResizeObserver !== 'undefined') {
    resizeObserver = new ResizeObserver(() => {
      if (fitMode.value) {
        fit()
        render()
      }
    })
    resizeObserver.observe(wrapRef.value)
  }
})

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKey)
  document.removeEventListener('fullscreenchange', onFsChange)
  wrapRef.value?.removeEventListener('wheel', onWheel)
  resizeObserver?.disconnect()
})

/* ---------- 可视化渲染 ---------- */

function drawSelBox(ctx: CanvasRenderingContext2D, s: StampItem) {
  const k = scale.value
  ctx.save()
  ctx.strokeStyle = '#409eff'
  ctx.lineWidth = 1.5
  ctx.setLineDash([5, 4])
  ctx.strokeRect(s.x * k, s.y * k, s.w * k, s.h * k)
  ctx.setLineDash([])
  ctx.fillStyle = '#409eff'
  const hs = HANDLE_PX
  ctx.fillRect(s.x * k + s.w * k - hs, s.y * k + s.h * k - hs, hs, hs)
  ctx.restore()
}

function drawPendingRect(ctx: CanvasRenderingContext2D) {
  const r = normalizeRect(drag.sx, drag.sy, drag.cx, drag.cy)
  const k = scale.value
  ctx.save()
  ctx.strokeStyle = '#409eff'
  ctx.lineWidth = 1.5
  ctx.setLineDash([5, 4])
  ctx.strokeRect(r.x * k, r.y * k, r.w * k, r.h * k)
  ctx.restore()
}

function drawRectBox(ctx: CanvasRenderingContext2D, r: Rect, color: string) {
  const k = scale.value
  ctx.save()
  ctx.strokeStyle = color
  ctx.lineWidth = 1.5
  ctx.setLineDash([5, 4])
  ctx.strokeRect(r.x * k, r.y * k, r.w * k, r.h * k)
  ctx.restore()
}

function drawCropOverlay(ctx: CanvasRenderingContext2D, r: Rect, cssW: number, cssH: number) {
  const k = scale.value
  ctx.save()
  ctx.fillStyle = 'rgba(0,0,0,0.45)'
  ctx.beginPath()
  ctx.rect(0, 0, cssW, cssH)
  ctx.rect(r.x * k, r.y * k, r.w * k, r.h * k)
  ctx.fill('evenodd')
  ctx.strokeStyle = '#ffffff'
  ctx.lineWidth = 1.5
  ctx.setLineDash([6, 4])
  ctx.strokeRect(r.x * k, r.y * k, r.w * k, r.h * k)
  ctx.restore()
}

function render() {
  const canvas = viewRef.value
  if (!canvas) return
  if (!work || !ready.value) {
    canvas.width = 0
    canvas.height = 0
    return
  }
  const cssW = Math.max(1, Math.round(imgW * scale.value))
  const cssH = Math.max(1, Math.round(imgH * scale.value))
  const dpr = window.devicePixelRatio || 1
  canvas.style.width = cssW + 'px'
  canvas.style.height = cssH + 'px'
  canvas.width = Math.round(cssW * dpr)
  canvas.height = Math.round(cssH * dpr)
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  ctx.clearRect(0, 0, cssW, cssH)
  ctx.drawImage(work, 0, 0, cssW, cssH)
  const k = scale.value
  for (const s of stamps.value) {
    ctx.save()
    ctx.globalAlpha = s.opacity / 100
    ctx.drawImage(s.img, s.x * k, s.y * k, s.w * k, s.h * k)
    ctx.restore()
  }
  const sel = stamps.value.find(s => s.id === selId.value)
  if (tool.value === 'stamp' && sel) drawSelBox(ctx, sel)
  if (tool.value === 'mosaic' && drag.mode === 'rect') drawPendingRect(ctx)
  if (tool.value === 'select' && selRect.value) drawRectBox(ctx, selRect.value, '#67c23a')
  if (tool.value === 'crop' && cropRect.value) drawCropOverlay(ctx, cropRect.value, cssW, cssH)
}
</script>

<template>
  <div class="ed" ref="rootRef">
    <div class="ed-toolbar">
      <div class="ed-group">
        <el-radio-group v-model="tool" size="small">
          <el-radio-button value="mosaic">马赛克</el-radio-button>
          <el-radio-button value="cover">涂抹</el-radio-button>
          <el-radio-button value="stamp">贴图</el-radio-button>
          <el-radio-button value="select">框选</el-radio-button>
          <el-radio-button value="crop">裁剪</el-radio-button>
        </el-radio-group>
      </div>

      <div class="ed-group" v-if="tool === 'mosaic'">
        <span class="ed-label">块大小 {{ mosaicCell }}px</span>
        <el-slider v-model="mosaicCell" :min="4" :max="60" style="width: 110px" />
      </div>
      <div class="ed-group" v-else-if="tool === 'cover'">
        <span class="ed-label">颜色</span>
        <el-color-picker v-model="brushColor" :predefine="['#000000', '#ffffff', '#c0c4cc']" />
        <span class="ed-label">粗细 {{ brushSize }}px</span>
        <el-slider v-model="brushSize" :min="4" :max="120" style="width: 110px" />
      </div>
      <div class="ed-group" v-else-if="tool === 'stamp'">
        <el-button size="small" :loading="pickingStamp" @click="pickStamp">选择贴图</el-button>
        <span v-if="stampSrc" class="ed-label ed-ellipsis">{{ stampSrc.name }}</span>
        <el-button size="small" plain :disabled="!clip" @click="pasteClip">粘贴 Ctrl+V</el-button>
        <template v-if="stamps.length">
          <span class="ed-label">透明度 {{ stampOpacity }}%</span>
          <el-slider v-model="stampOpacity" :min="10" :max="100" style="width: 90px" />
          <el-button size="small" type="primary" plain @click="mergeDown">落下合并（{{ stamps.length }}）</el-button>
          <el-button size="small" type="danger" plain :disabled="selId == null" @click="removeSelected">
            删除选中
          </el-button>
        </template>
      </div>
      <div class="ed-group" v-else-if="tool === 'select'">
        <el-button size="small" type="primary" :disabled="!selRect" @click="copySelection">
          复制 Ctrl+C
        </el-button>
        <el-button size="small" plain :disabled="!clip" @click="pasteClip">粘贴 Ctrl+V</el-button>
        <el-button size="small" :disabled="!selRect" @click="cancelSel">取消选区</el-button>
      </div>
      <div class="ed-group" v-else>
        <el-button size="small" type="primary" :disabled="!cropRect" @click="applyCrop">应用裁剪</el-button>
        <el-button size="small" :disabled="!cropRect" @click="cancelCrop">取消</el-button>
      </div>

      <span class="ed-spacer" />
      <div class="ed-group">
        <span class="ed-label">{{ Math.round(scale * 100) }}%</span>
        <el-button size="small" circle @click="zoom(-0.25)" title="缩小">−</el-button>
        <el-button size="small" circle @click="zoom(0.25)" title="放大">＋</el-button>
        <el-button size="small" :type="fitMode ? 'primary' : ''" plain @click="setFit(true)">适应</el-button>
        <el-button size="small" plain @click="setFit(false)">1:1</el-button>
      </div>
      <div class="ed-group">
        <el-button size="small" :disabled="!historyLen" @click="undo">撤销</el-button>
        <el-button size="small" :disabled="!ready" @click="load()">重置</el-button>
        <el-button size="small" plain @click="toggleFull" :title="isFull ? '退出全屏（Esc）' : '全屏编辑'">
          {{ isFull ? '退出全屏' : '全屏' }}
        </el-button>
      </div>
    </div>

    <div class="ed-hint" v-if="ready">
      <span>{{ hint }}</span>
      <span class="ed-label">Alt+滚轮缩放 · 滚轮平移</span>
    </div>

    <div ref="wrapRef" class="ed-wrap">
      <canvas
        ref="viewRef"
        class="ed-canvas"
        :class="cursorClass"
        @pointerdown="onDown"
        @pointermove="onMove"
        @pointerup="onUp"
        @pointercancel="onUp"
      />
      <div v-if="!ready" class="ed-empty">在上方选择一张图片后开始标注</div>
    </div>
  </div>
</template>

<style scoped>
.ed {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.ed-toolbar {
  display: flex;
  align-items: center;
  gap: 8px 12px;
  flex-wrap: wrap;
}
/* 功能簇内部不换行，换行只发生在簇与簇之间，避免缩放/撤销组被拦腰截断 */
.ed-group {
  display: flex;
  align-items: center;
  gap: 8px;
  white-space: nowrap;
}
.ed-label {
  font-size: 12px;
  color: var(--text-3);
  white-space: nowrap;
}
.ed-ellipsis {
  max-width: 160px;
  overflow: hidden;
  text-overflow: ellipsis;
}
.ed-spacer {
  flex: 1;
}
.ed-hint {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 4px 16px;
  flex-wrap: wrap;
  font-size: 12px;
  color: var(--text-3);
}
.ed-wrap {
  position: relative;
  height: 480px;
  overflow: auto;
  border: 1px solid var(--line);
  border-radius: 8px;
  /* 棋盘格衬底，透明 PNG 一眼可辨 */
  background:
    repeating-conic-gradient(var(--surface-2) 0% 25%, transparent 0% 50%) 0 0 / 20px 20px;
}
.ed:fullscreen {
  padding: 14px;
  background: var(--surface-1);
}
.ed:fullscreen .ed-wrap {
  flex: 1;
  height: auto;
  min-height: 0;
}
.ed-canvas {
  display: block;
  margin: 14px auto;
  box-shadow: 0 1px 6px rgb(0 0 0 / 0.18);
}
.ed-canvas.ed-cross {
  cursor: crosshair;
}
.ed-empty {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--text-3);
  font-size: 13px;
  pointer-events: none;
}
</style>
