<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { api } from '../utils/ipc'
import { call } from '../utils/api'
import {
  clamp,
  defaultStampSize,
  fitScale,
  hitResizeHandle,
  normalizeRect,
  pixelGrid,
  type Rect
} from '../utils/imageEdit'

/**
 * 单张图片的交互式标注画布：马赛克打码、涂抹遮挡、贴图盖章、文字标注、形状标注（矩形/椭圆/直线/箭头）、
 * 滤镜调色（亮度/对比度/灰度/反色）、框选复制、裁剪。
 * 全分辨率状态放在非响应式的离屏 canvas（work）上，viewRef 只做按 scale 的可视化渲染；
 * HTMLImageElement 不放进深响应式（Proxy 会丢失内部插槽导致 drawImage 失败），一律 shallowRef。
 */

interface BaseAnno {
  id: number
  x: number
  y: number
  w: number
  h: number
  opacity: number
}
interface StampAnno extends BaseAnno {
  kind: 'stamp'
  img: CanvasImageSource
  name: string
}
interface TextAnno extends BaseAnno {
  kind: 'text'
  text: string
  fontSize: number
  color: string
  stroke: boolean
  shadow: boolean
}
interface ShapeAnno extends BaseAnno {
  kind: 'shape'
  shape: 'rect' | 'ellipse' | 'line' | 'arrow'
  color: string
  lineWidth: number
}
type AnnoItem = StampAnno | TextAnno | ShapeAnno

type ShapeKind = 'rect' | 'ellipse' | 'line' | 'arrow'
const SHAPE_KINDS: ShapeKind[] = ['rect', 'ellipse', 'line', 'arrow']
const isShapeTool = (t: string) => SHAPE_KINDS.includes(t as ShapeKind)

type Tool = 'mosaic' | 'cover' | 'stamp' | 'text' | 'rect' | 'ellipse' | 'line' | 'arrow' | 'select' | 'crop'

const props = defineProps<{ image: { name: string; mime: string; base64: string } | null }>()

const rootRef = ref<HTMLDivElement | null>(null)
const viewRef = ref<HTMLCanvasElement | null>(null)
const wrapRef = ref<HTMLDivElement | null>(null)

const ready = ref(false)
const tool = ref<Tool>('mosaic')
const scale = ref(1)
const fitMode = ref(true)
const isFull = ref(false)
/** 画布衬底背景，默认柔和灰棋盘格，避免透明 PNG 在明暗主题下闪成刺眼的纯白/纯黑 */
const bgMode = ref<'checker' | 'white' | 'gray' | 'black'>('checker')

const mosaicCell = ref(14)
const brushColor = ref('#000000')
const brushSize = ref(28)
const stampSrc = shallowRef<{ name: string; img: HTMLImageElement; sw: number; sh: number } | null>(null)
const stampOpacity = ref(100)
const stamps = shallowRef<AnnoItem[]>([])
const selId = ref<number | null>(null)
const cropRect = ref<Rect | null>(null)
const selRect = ref<Rect | null>(null)
const clip = shallowRef<HTMLCanvasElement | null>(null)
const historyLen = ref(0)

/* 文字标注参数 */
const textSize = ref(32)
const textColor = ref('#ffffff')
const textStroke = ref(true)
const textShadow = ref(false)

/* 形状标注参数 */
const shapeColor = ref('#f56c6c')
const shapeWidth = ref(4)

/* 滤镜调色 */
const adjBright = ref(0)
const adjContrast = ref(0)
const adjGray = ref(false)
const adjInvert = ref(false)
const adjOpen = ref(false)
let adjBase: HTMLCanvasElement | null = null

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
  id: number
  sx: number
  sy: number
  cx: number
  cy: number
  dx: number
  dy: number
  ow: number
  oh: number
  ofs: number
  shape: '' | ShapeKind
} = freshDrag()

function freshDrag() {
  return { mode: '' as const, id: 0, sx: 0, sy: 0, cx: 0, cy: 0, dx: 0, dy: 0, ow: 0, oh: 0, ofs: 0, shape: '' as const }
}

// 透明度滑块对「当前选中标注」实时生效，未选中时作为下次放置的默认值
watch(stampOpacity, v => {
  const s = stamps.value.find(i => i.id === selId.value)
  if (s) {
    s.opacity = v
    render()
  }
})
// 形状颜色/线宽实时作用于选中的形状
watch([shapeColor, shapeWidth], () => {
  const s = stamps.value.find(i => i.id === selId.value)
  if (s && s.kind === 'shape') {
    s.color = shapeColor.value
    s.lineWidth = shapeWidth.value
    render()
  }
})
// 文字样式实时作用于选中的文字
watch([textColor, textStroke, textShadow], () => {
  const s = stamps.value.find(i => i.id === selId.value)
  if (s && s.kind === 'text') {
    s.color = textColor.value
    s.stroke = textStroke.value
    s.shadow = textShadow.value
    render()
  }
})

// 切换工具时取消当前选中，避免对象被"幽灵选中"却看不到选中框
watch(tool, () => {
  selId.value = null
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
    case 'text':
      return '点击图上任意位置输入文字；拖动移位、右下角缩放（同步改字号），选中后可改样式，双击重新编辑。'
    case 'rect':
    case 'ellipse':
    case 'line':
    case 'arrow':
      return '在图上拖出区域生成形状；右下角缩放，选中后调颜色与粗细，「落下合并」写入图片。'
    case 'select':
      return selRect.value
        ? '已框选。Ctrl+C 复制选区（按原尺寸），Ctrl+V 贴出为贴图；复制后在其他软件里也能粘贴。'
        : '拖框圈住图上任意内容（文字、表格、印章），复制后可贴到别处。'
    case 'crop':
      return cropRect.value
        ? '拖动重新框选，满意后点「应用裁剪」；未落下的标注会随裁剪一并合并。'
        : '在图上拖出要保留的区域。'
  }
})

const cursorClass = computed(() =>
  tool.value === 'cover' || tool.value === 'stamp' || tool.value === 'text' || isShapeTool(tool.value) ? '' : 'ed-cross'
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

function drawArrow(ctx: CanvasRenderingContext2D, x1: number, y1: number, x2: number, y2: number, lw: number) {
  ctx.beginPath()
  ctx.moveTo(x1, y1)
  ctx.lineTo(x2, y2)
  ctx.stroke()
  const ang = Math.atan2(y2 - y1, x2 - x1)
  const head = Math.max(8, lw * 3.5)
  ctx.beginPath()
  ctx.moveTo(x2, y2)
  ctx.lineTo(x2 - head * Math.cos(ang - Math.PI / 7), y2 - head * Math.sin(ang - Math.PI / 7))
  ctx.lineTo(x2 - head * Math.cos(ang + Math.PI / 7), y2 - head * Math.sin(ang + Math.PI / 7))
  ctx.closePath()
  ctx.fill()
}

/** 把标注层（图片/文字/形状）合并写入目标画布；ox/oy 为额外偏移（用于导出选区/扩展画布） */
function mergeAnno(target: HTMLCanvasElement, list: AnnoItem[], ox = 0, oy = 0) {
  const ctx = target.getContext('2d')!
  for (const s of list) {
    ctx.save()
    ctx.globalAlpha = s.opacity / 100
    if (s.kind === 'stamp') {
      ctx.drawImage(s.img, s.x + ox, s.y + oy, s.w, s.h)
    } else if (s.kind === 'text') {
      ctx.font = `${s.fontSize}px "Microsoft YaHei", sans-serif`
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      if (s.shadow) {
        ctx.shadowColor = 'rgba(0,0,0,0.45)'
        ctx.shadowBlur = Math.max(2, s.fontSize / 8)
      }
      if (s.stroke) {
        ctx.lineWidth = Math.max(1, s.fontSize / 14)
        ctx.lineJoin = 'round'
        ctx.strokeStyle = '#000000'
        ctx.strokeText(s.text, s.x + ox + s.w / 2, s.y + oy + s.h / 2)
      }
      ctx.fillStyle = s.color
      ctx.fillText(s.text, s.x + ox + s.w / 2, s.y + oy + s.h / 2)
    } else {
      ctx.strokeStyle = s.color
      ctx.fillStyle = s.color
      ctx.lineWidth = Math.max(1, s.lineWidth)
      const x = s.x + ox
      const y = s.y + oy
      if (s.shape === 'rect') {
        ctx.strokeRect(x, y, s.w, s.h)
      } else if (s.shape === 'ellipse') {
        ctx.beginPath()
        ctx.ellipse(x + s.w / 2, y + s.h / 2, Math.abs(s.w / 2), Math.abs(s.h / 2), 0, 0, Math.PI * 2)
        ctx.stroke()
      } else if (s.shape === 'line') {
        ctx.beginPath()
        ctx.moveTo(x, y)
        ctx.lineTo(x + s.w, y + s.h)
        ctx.stroke()
      } else {
        drawArrow(ctx, x, y, x + s.w, y + s.h, Math.max(1, s.lineWidth))
      }
    }
    ctx.restore()
  }
}

/** 落下合并：把未合并的标注写进工作画布（可撤销） */
function mergeDown() {
  if (!work || !stamps.value.length) return
  pushHistory()
  mergeAnno(work, stamps.value)
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

/** 拖框取整到图片像素；贴图/复制/裁剪/形状都按整数坐标走，避免亚像素重采样把原图插值糊掉 */
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
    mergeAnno(work, stamps.value)
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
): StampAnno {
  const size = natural
    ? { w: Math.min(sw, imgW), h: Math.min(sh, imgH) }
    : defaultStampSize(imgW, imgH, sw, sh)
  const item: StampAnno = {
    id: ++stampSeq,
    kind: 'stamp',
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

function measureTextW(text: string, fontSize: number): number {
  const c = document.createElement('canvas')
  const ctx = c.getContext('2d')!
  ctx.font = `${fontSize}px "Microsoft YaHei", sans-serif`
  return Math.ceil(ctx.measureText(text).width)
}

function placeText(p: { x: number; y: number }, text: string): TextAnno {
  const fs = textSize.value
  const w = Math.max(40, measureTextW(text, fs))
  const h = Math.round(fs * 1.4)
  const item: TextAnno = {
    id: ++stampSeq,
    kind: 'text',
    text,
    fontSize: fs,
    color: textColor.value,
    stroke: textStroke.value,
    shadow: textShadow.value,
    x: Math.round(clamp(p.x - w / 2, 0, Math.max(0, imgW - w))),
    y: Math.round(clamp(p.y - h / 2, 0, Math.max(0, imgH - h))),
    w,
    h,
    opacity: stampOpacity.value
  }
  stamps.value = [...stamps.value, item]
  selId.value = item.id
  return item
}

function placeShape(kind: 'rect' | 'ellipse' | 'line' | 'arrow', r: Rect): ShapeAnno {
  const item: ShapeAnno = {
    id: ++stampSeq,
    kind: 'shape',
    shape: kind,
    color: shapeColor.value,
    lineWidth: shapeWidth.value,
    x: r.x,
    y: r.y,
    w: r.w,
    h: r.h,
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
  mergeAnno(c, stamps.value)
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

/**
 * 桌面端（Electron / WebView）里 window.prompt 不弹窗且返回 null，
 * 统一走 Element Plus 的输入框保证可用性；取消返回 null。
 */
function promptText(title: string, initial = ''): Promise<string | null> {
  return ElMessageBox.prompt(title, '文字标注', {
    inputValue: initial,
    inputPlaceholder: '输入要写在图上的文字',
    confirmButtonText: '确定',
    cancelButtonText: '取消'
  })
    .then(r => String(r.value ?? ''))
    .catch(() => null)
}

async function editSelectedText() {
  const s = stamps.value.find(i => i.id === selId.value)
  if (!s || s.kind !== 'text') {
    ElMessage.info('请先选中一个文字标注')
    return
  }
  const v = await promptText('编辑文字：', s.text)
  if (v == null) return
  if (!v.trim()) {
    stamps.value = stamps.value.filter(i => i.id !== s.id)
    selId.value = null
  } else {
    s.text = v.trim()
    const w = Math.max(40, measureTextW(s.text, s.fontSize))
    s.w = w
  }
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

function hitAnno(s: AnnoItem, p: { x: number; y: number }): boolean {
  if (s.kind === 'shape' && (s.shape === 'line' || s.shape === 'arrow')) {
    const x1 = s.x
    const y1 = s.y
    const x2 = s.x + s.w
    const y2 = s.y + s.h
    const dx = x2 - x1
    const dy = y2 - y1
    const len2 = dx * dx + dy * dy || 1
    let t = ((p.x - x1) * dx + (p.y - y1) * dy) / len2
    t = clamp(t, 0, 1)
    const cx = x1 + t * dx
    const cy = y1 + t * dy
    return Math.hypot(p.x - cx, p.y - cy) <= Math.max(s.lineWidth, 8)
  }
  return p.x >= s.x && p.x <= s.x + s.w && p.y >= s.y && p.y <= s.y + s.h
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
  if (tool.value === 'text') {
    // 命中已有文字则选中（双击编辑），不新建；空白处才弹窗输入
    const hit = [...stamps.value].reverse().find(s => s.kind === 'text' && hitAnno(s, p))
    if (hit) {
      selId.value = hit.id
      drag = { ...freshDrag(), mode: 'move', id: hit.id, dx: p.x - hit.x, dy: p.y - hit.y }
      render()
      return
    }
    void (async () => {
      const t = await promptText('输入文字：')
      if (t && t.trim()) {
        placeText(p, t.trim())
        render()
      }
    })()
    return
  }
  if (tool.value === 'mosaic' || tool.value === 'crop' || tool.value === 'select') {
    drag = { ...freshDrag(), mode: 'rect', sx: p.x, sy: p.y, cx: p.x, cy: p.y }
    return
  }
  if (isShapeTool(tool.value)) {
    drag = { ...freshDrag(), mode: 'rect', sx: p.x, sy: p.y, cx: p.x, cy: p.y, shape: tool.value as ShapeKind }
    return
  }
  // 贴图：优先缩放把手 > 已有标注 > 放置新贴图
  const list = stamps.value
  const sel = list.find(s => s.id === selId.value)
  if (sel && hitResizeHandle(sel, p, HANDLE_PX / scale.value)) {
    drag = { ...freshDrag(), mode: 'resize', id: sel.id, ow: sel.w, oh: sel.h, ofs: sel.kind === 'text' ? sel.fontSize : 0 }
    return
  }
  const hit = [...list].reverse().find(s => hitAnno(s, p))
  if (hit) {
    selId.value = hit.id
    drag = { ...freshDrag(), mode: 'move', id: hit.id, dx: p.x - hit.x, dy: p.y - hit.y }
    render()
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
    if (s.kind === 'stamp') {
      s.w = Math.round(clamp(p.x - s.x, 16, imgW - s.x))
      s.h = Math.max(16, Math.round(s.w * (drag.oh / Math.max(drag.ow, 1))))
      if (s.y + s.h > imgH) s.h = imgH - s.y
    } else if (s.kind === 'text') {
      const w = Math.round(clamp(p.x - s.x, 16, imgW - s.x))
      const ratio = drag.ow > 0 ? w / drag.ow : 1
      s.w = w
      s.h = Math.max(16, Math.round(drag.oh * ratio))
      s.fontSize = Math.max(8, Math.round(drag.ofs * ratio))
      if (s.y + s.h > imgH) s.h = imgH - s.y
    } else {
      s.w = Math.round(clamp(p.x - s.x, 4, imgW - s.x))
      s.h = Math.round(clamp(p.y - s.y, 4, imgH - s.y))
    }
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
  } else if (drag.mode === 'rect' && isShapeTool(tool.value)) {
    const r = snapRect(normalizeRect(drag.sx, drag.sy, drag.cx, drag.cy))
    if (Math.abs(r.w) > 4 || Math.abs(r.h) > 4) placeShape(tool.value as ShapeKind, r)
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

/* ---------- 滤镜调色 ---------- */

function applyFilter(src: HTMLCanvasElement, o: { bright: number; contrast: number; gray: boolean; invert: boolean }): HTMLCanvasElement {
  const c = cloneOf(src)
  const ctx = c.getContext('2d')!
  if (o.gray || o.invert || o.bright !== 0 || o.contrast !== 0) {
    const img = ctx.getImageData(0, 0, c.width, c.height)
    const d = img.data
    const b = o.bright / 100
    const cf = (259 * (o.contrast + 255)) / (255 * (259 - o.contrast))
    for (let i = 0; i < d.length; i += 4) {
      let r = d[i]
      let g = d[i + 1]
      let bl = d[i + 2]
      if (o.gray) {
        const v = 0.299 * r + 0.587 * g + 0.114 * bl
        r = g = bl = v
      }
      if (o.invert) {
        r = 255 - r
        g = 255 - g
        bl = 255 - bl
      }
      d[i] = clamp(Math.round(cf * (r - 128) + 128 + b * 255), 0, 255)
      d[i + 1] = clamp(Math.round(cf * (g - 128) + 128 + b * 255), 0, 255)
      d[i + 2] = clamp(Math.round(cf * (bl - 128) + 128 + b * 255), 0, 255)
    }
    ctx.putImageData(img, 0, 0)
  }
  return c
}

function enterAdjust() {
  if (!work) return
  adjBase = cloneOf(work)
  applyAdjustPreview()
}

/**
 * 调色面板打开时先备份当前画面。
 * 没有这一步 adjBase 永远是 null，滑块拖了也不会有反应——
 * 表现就是"滤镜 / 调色"看起来完全坏掉。
 */
watch(adjOpen, v => {
  if (v) enterAdjust()
})

function applyAdjustPreview() {
  if (!adjBase || !work) return
  work = applyFilter(adjBase, { bright: adjBright.value, contrast: adjContrast.value, gray: adjGray.value, invert: adjInvert.value })
  render()
}

function applyAdjust() {
  if (!work) return
  // 把预览结果固化为可撤销的一步（撤销即回到进入滤镜前的状态）
  history.push(adjBase ?? cloneOf(work))
  if (history.length > HISTORY_MAX) history.shift()
  historyLen.value = history.length
  adjBase = cloneOf(work)
  adjOpen.value = false
  ElMessage.success('调色已应用')
}

function cancelAdjust() {
  if (!adjBase) return
  work = adjBase
  adjOpen.value = false
  render()
}

/* ---------- 供父组件导出 ---------- */

interface ExportOptions {
  /** 仅导出当前选区（含选区内的标注） */
  region?: boolean
  /** 扩展画布尺寸（居中留白），bg 为 null 表示透明（PNG 有效） */
  expand?: { w: number; h: number; bg: string | null }
}

async function exportBlob(
  format: 'image/png' | 'image/jpeg',
  quality: number,
  opts: ExportOptions = {}
): Promise<Blob | null> {
  if (!work) return null
  const c = document.createElement('canvas')
  const ctx = c.getContext('2d')!
  const jpg = format === 'image/jpeg'

  if (opts.expand && opts.expand.w > 0 && opts.expand.h > 0) {
    const { w, h, bg } = opts.expand
    c.width = w
    c.height = h
    if (bg !== null) {
      ctx.fillStyle = bg
      ctx.fillRect(0, 0, w, h)
    } else if (jpg) {
      ctx.fillStyle = '#ffffff'
      ctx.fillRect(0, 0, w, h)
    }
    const ox = Math.round((w - imgW) / 2)
    const oy = Math.round((h - imgH) / 2)
    ctx.drawImage(work, ox, oy)
    mergeAnno(c, stamps.value, ox, oy)
  } else if (opts.region && selRect.value) {
    const r = snapRect(selRect.value)
    c.width = Math.max(1, Math.round(r.w))
    c.height = Math.max(1, Math.round(r.h))
    if (jpg) {
      ctx.fillStyle = '#ffffff'
      ctx.fillRect(0, 0, c.width, c.height)
    }
    ctx.drawImage(work, r.x, r.y, r.w, r.h, 0, 0, c.width, c.height)
    mergeAnno(c, stamps.value, -r.x, -r.y)
  } else {
    c.width = work.width
    c.height = work.height
    if (jpg) {
      ctx.fillStyle = '#ffffff'
      ctx.fillRect(0, 0, c.width, c.height)
    }
    ctx.drawImage(work, 0, 0)
    mergeAnno(c, stamps.value)
  }
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
  } else if ((e.key === 'Delete' || e.key === 'Backspace') && tool.value !== 'select' && tool.value !== 'crop' && selId.value != null) {
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

function drawSelBox(ctx: CanvasRenderingContext2D, s: AnnoItem) {
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

function drawShapeAnno(ctx: CanvasRenderingContext2D, s: ShapeAnno) {
  const k = scale.value
  ctx.save()
  ctx.globalAlpha = s.opacity / 100
  ctx.strokeStyle = s.color
  ctx.fillStyle = s.color
  ctx.lineWidth = Math.max(1, s.lineWidth * k)
  const x = s.x * k
  const y = s.y * k
  const w = s.w * k
  const h = s.h * k
  if (s.shape === 'rect') {
    ctx.strokeRect(x, y, w, h)
  } else if (s.shape === 'ellipse') {
    ctx.beginPath()
    ctx.ellipse(x + w / 2, y + h / 2, Math.abs(w / 2), Math.abs(h / 2), 0, 0, Math.PI * 2)
    ctx.stroke()
  } else if (s.shape === 'line') {
    ctx.beginPath()
    ctx.moveTo(x, y)
    ctx.lineTo(x + w, y + h)
    ctx.stroke()
  } else {
    drawArrow(ctx, x, y, x + w, y + h, Math.max(1, s.lineWidth * k))
  }
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
    if (s.kind === 'stamp') {
      ctx.drawImage(s.img, s.x * k, s.y * k, s.w * k, s.h * k)
    } else if (s.kind === 'text') {
      ctx.font = `${s.fontSize * k}px "Microsoft YaHei", sans-serif`
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      if (s.shadow) {
        ctx.shadowColor = 'rgba(0,0,0,0.45)'
        ctx.shadowBlur = Math.max(2, (s.fontSize * k) / 8)
      }
      if (s.stroke) {
        ctx.lineWidth = Math.max(1, (s.fontSize * k) / 14)
        ctx.lineJoin = 'round'
        ctx.strokeStyle = '#000000'
        ctx.strokeText(s.text, s.x * k + (s.w * k) / 2, s.y * k + (s.h * k) / 2)
      }
      ctx.fillStyle = s.color
      ctx.fillText(s.text, s.x * k + (s.w * k) / 2, s.y * k + (s.h * k) / 2)
    } else {
      drawShapeAnno(ctx, s)
    }
    ctx.restore()
  }
  const sel = stamps.value.find(s => s.id === selId.value)
  if (sel && (tool.value === 'stamp' || tool.value === 'text' || isShapeTool(tool.value))) drawSelBox(ctx, sel)
  if (tool.value === 'mosaic' && drag.mode === 'rect') drawPendingRect(ctx)
  if (isShapeTool(tool.value) && drag.mode === 'rect') drawPendingRect(ctx)
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
          <el-radio-button value="text">文字</el-radio-button>
          <el-radio-button value="rect">矩形</el-radio-button>
          <el-radio-button value="ellipse">椭圆</el-radio-button>
          <el-radio-button value="line">直线</el-radio-button>
          <el-radio-button value="arrow">箭头</el-radio-button>
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
      <div class="ed-group" v-else-if="tool === 'text'">
        <span class="ed-label">字号 {{ textSize }}</span>
        <el-slider v-model="textSize" :min="12" :max="200" style="width: 90px" />
        <span class="ed-label">颜色</span>
        <el-color-picker v-model="textColor" show-alpha />
        <el-checkbox v-model="textStroke">描边</el-checkbox>
        <el-checkbox v-model="textShadow">阴影</el-checkbox>
        <el-button size="small" :disabled="selId == null" @click="editSelectedText">编辑选中文字</el-button>
        <span class="ed-label">透明度 {{ stampOpacity }}%</span>
        <el-slider v-model="stampOpacity" :min="10" :max="100" style="width: 80px" />
        <template v-if="stamps.length">
          <el-button size="small" type="primary" plain @click="mergeDown">落下合并（{{ stamps.length }}）</el-button>
        </template>
        <el-button size="small" type="danger" plain :disabled="selId == null" @click="removeSelected">删除选中</el-button>
      </div>
      <div class="ed-group" v-else-if="isShapeTool(tool)">
        <span class="ed-label">颜色</span>
        <el-color-picker v-model="shapeColor" show-alpha />
        <span class="ed-label">粗细 {{ shapeWidth }}px</span>
        <el-slider v-model="shapeWidth" :min="1" :max="60" style="width: 90px" />
        <span class="ed-label">透明度 {{ stampOpacity }}%</span>
        <el-slider v-model="stampOpacity" :min="10" :max="100" style="width: 80px" />
        <el-button size="small" type="primary" plain :disabled="!stamps.length" @click="mergeDown">落下合并（{{ stamps.length }}）</el-button>
        <el-button size="small" type="danger" plain :disabled="selId == null" @click="removeSelected">删除选中</el-button>
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
        <el-popover v-model:visible="adjOpen" placement="bottom" :width="260" trigger="click">
          <template #reference>
            <el-button size="small" :type="adjOpen ? 'primary' : ''" plain>滤镜 / 调色</el-button>
          </template>
          <div class="ed-adjust">
            <div class="ed-adjust-row">
              <span class="ed-label">亮度 {{ adjBright }}</span>
              <el-slider v-model="adjBright" :min="-100" :max="100" @input="applyAdjustPreview" />
            </div>
            <div class="ed-adjust-row">
              <span class="ed-label">对比度 {{ adjContrast }}</span>
              <el-slider v-model="adjContrast" :min="-100" :max="100" @input="applyAdjustPreview" />
            </div>
            <div class="ed-adjust-row">
              <el-checkbox v-model="adjGray" @change="applyAdjustPreview">灰度</el-checkbox>
              <el-checkbox v-model="adjInvert" @change="applyAdjustPreview">反色</el-checkbox>
            </div>
            <div class="ed-adjust-actions">
              <el-button size="small" @click="cancelAdjust">取消</el-button>
              <el-button size="small" type="primary" @click="applyAdjust">应用</el-button>
            </div>
          </div>
        </el-popover>
      </div>
      <div class="ed-group">
        <span class="ed-label">背景</span>
        <el-radio-group v-model="bgMode" size="small">
          <el-radio-button value="checker">棋盘</el-radio-button>
          <el-radio-button value="white">白</el-radio-button>
          <el-radio-button value="gray">灰</el-radio-button>
          <el-radio-button value="black">黑</el-radio-button>
        </el-radio-group>
      </div>
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
      <span class="ed-label">Alt+滚轮缩放 · 滚轮平移 · 双击文字可编辑</span>
    </div>

    <div ref="wrapRef" :class="['ed-wrap', 'bg-' + bgMode]">
      <canvas
        ref="viewRef"
        class="ed-canvas"
        :class="cursorClass"
        @pointerdown="onDown"
        @pointermove="onMove"
        @pointerup="onUp"
        @pointercancel="onUp"
        @dblclick="editSelectedText"
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
}
/* 画布背景可切换：默认柔和灰棋盘格（不随明暗主题闪成纯白/纯黑），护眼且不刺眼 */
.ed-wrap.bg-checker {
  background: repeating-conic-gradient(#e9e9e9 0% 25%, #dcdcdc 0% 50%) 0 0 / 22px 22px;
}
.ed-wrap.bg-white {
  background: #ffffff;
}
.ed-wrap.bg-gray {
  background: #d9d9d9;
}
.ed-wrap.bg-black {
  background: #1e1e1e;
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
.ed-adjust {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.ed-adjust-row {
  display: flex;
  align-items: center;
  gap: 10px;
}
.ed-adjust-row .el-slider {
  flex: 1;
}
.ed-adjust-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}
</style>
