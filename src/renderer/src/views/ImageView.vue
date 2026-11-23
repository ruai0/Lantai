<script setup lang="ts">
import { api } from '../utils/ipc'
import { computed, ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import StepCard from '../components/StepCard.vue'
import FilePickList from '../components/FilePickList.vue'
import OutDirPicker from '../components/OutDirPicker.vue'
import ResultPanel from '../components/ResultPanel.vue'
import ImageEditor from '../components/ImageEditor.vue'
import { call, basename } from '../utils/api'
import { useEnterSubmit } from '../utils/useEnterSubmit'
import { useReadyGate } from '../utils/useReadyGate'
import { useRemembered } from '../utils/useRememberedParams'
import { exportFilename, splitOutputTarget } from '@shared/namePattern'

/** 填完参数按 Enter 直接执行（主按钮已标 data-primary-action） */
useEnterSubmit()

/** 批量处理：至少一张图 + 输出目录 */
const { blocked: runBlocked, reason: runBlockedReason } = useReadyGate(() => [
  { label: '图片', ok: items.value.length > 0 },
  { label: '输出文件夹', ok: !!outBase.value.dir }
])

const IMG_FILTER = [{ name: '图片', extensions: ['jpg', 'jpeg', 'png', 'webp', 'bmp', 'gif'] }]

interface Item {
  path: string
  name: string
  base64: string
  status: '待处理' | '处理中' | '完成' | '失败'
  error?: string
  outPath?: string
}

const files = ref<string[]>([])
const items = ref<Item[]>([])
const outDir = ref('')
/** 输出位置解析：目录 + 可选文件名（名字先剥掉用户带的扩展名，实际扩展随所选格式） */
const outBase = computed(() => {
  const t = splitOutputTarget(outDir.value)
  return { dir: t.dir, name: t.name?.replace(/\.[^.]+$/, '') }
})
const outputs = ref<string[]>([])
const running = ref(false)
const progress = ref(0)

const format = ref<'image/jpeg' | 'image/png' | 'image/webp'>('image/jpeg')
const quality = ref(80)
const maxSide = ref(0)
/** 缩放模式：none=不缩放，maxSide=按最长边，percent=按百分比，targetKB=目标体积 */
const sizeMode = ref<'none' | 'maxSide' | 'percent' | 'targetKB'>('none')
const scalePercent = ref(50)
const targetKB = ref(500)
const rotateDeg = ref<0 | 90 | 180 | 270>(0)
const flipH = ref(false)
const wmText = ref('')
const wmFontSize = ref(24)
const wmOpacity = ref(40)
const wmTile = ref(true)
const wmAngle = ref(-30)
const wmColor = ref('#000000')
const wmGap = ref(60)
const wmImage = ref<{ name: string; base64: string } | null>(null)

const EXT: Record<string, string> = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp' }

watch(files, () => {
  void loadItems()
})

async function loadItems() {
  outputs.value = []
  if (!files.value.length) {
    items.value = []
    return
  }
  const r = await call(api.readFiles(files.value))
  if (!r) return
  items.value = r.map(f => ({ ...f, status: '待处理' as const }))
}

async function pickWmImage() {
  const res = await api.pickFiles({
    title: '选择水印图片（建议带透明通道的 PNG）',
    multiple: false,
    filters: [{ name: '图片', extensions: ['png', 'jpg', 'jpeg', 'webp'] }]
  })
  if (res.ok && res.data.length) {
    const r = await call(api.readFiles(res.data))
    if (r && r.length) wmImage.value = { name: r[0].name, base64: r[0].base64 }
  }
}

function mimeOf(name: string): string {
  const e = name.toLowerCase().split('.').pop() ?? ''
  if (e === 'png') return 'image/png'
  if (e === 'webp') return 'image/webp'
  if (e === 'gif') return 'image/gif'
  if (e === 'bmp') return 'image/bmp'
  return 'image/jpeg'
}

function loadImage(base64: string, mime: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('图片解码失败'))
    img.src = `data:${mime};base64,${base64}`
  })
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const fr = new FileReader()
    fr.onload = () => resolve(String(fr.result).split(',')[1] ?? '')
    fr.onerror = () => reject(new Error('读取编码结果失败'))
    fr.readAsDataURL(blob)
  })
}

function drawWatermark(ctx: CanvasRenderingContext2D, w: number, h: number, wmImg: HTMLImageElement | null) {
  ctx.save()
  ctx.globalAlpha = wmOpacity.value / 100
  ctx.translate(w / 2, h / 2)
  ctx.rotate((wmAngle.value * Math.PI) / 180)
  const radius = Math.ceil(Math.sqrt(w * w + h * h) / 2)
  const text = wmText.value.trim()
  if (text) {
    ctx.fillStyle = wmColor.value
    ctx.font = `${wmFontSize.value}px "Microsoft YaHei", sans-serif`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    if (wmTile.value) {
      const gap = Math.max(0, wmGap.value)
      const stepX = Math.max(ctx.measureText(text).width + gap, 120)
      const stepY = Math.max(wmFontSize.value * 3, 90)
      for (let x = -radius; x <= radius; x += stepX) {
        for (let y = -radius; y <= radius; y += stepY) ctx.fillText(text, x, y)
      }
    } else {
      ctx.fillText(text, 0, 0)
    }
  }
  if (wmImg) {
    if (wmTile.value) {
      const gap = Math.max(0, wmGap.value)
      const stepX = wmImg.width + gap
      const stepY = wmImg.height + gap
      for (let x = -radius; x <= radius; x += stepX) {
        for (let y = -radius; y <= radius; y += stepY) {
          ctx.drawImage(wmImg, x - wmImg.width / 2, y - wmImg.height / 2)
        }
      }
    } else {
      ctx.drawImage(wmImg, -wmImg.width / 2, -wmImg.height / 2)
    }
  }
  ctx.restore()
}

async function processOne(item: Item, wmImg: HTMLImageElement | null): Promise<string> {
  const img = await loadImage(item.base64, mimeOf(item.name))
  // 先按缩放模式算出基准尺寸
  const baseScale =
    sizeMode.value === 'maxSide'
      ? maxSide.value > 0
        ? Math.min(1, maxSide.value / Math.max(img.width, img.height))
        : 1
      : sizeMode.value === 'percent'
        ? Math.max(0.01, Math.min(4, scalePercent.value / 100))
        : 1
  let scale = baseScale
  const maxSideLimit = 16384
  let w = Math.max(1, Math.round(img.width * scale))
  let h = Math.max(1, Math.round(img.height * scale))
  if (Math.max(w, h) > maxSideLimit) {
    const s2 = maxSideLimit / Math.max(w, h)
    w = Math.max(1, Math.round(w * s2))
    h = Math.max(1, Math.round(h * s2))
    scale *= s2
  }
  const swap = rotateDeg.value === 90 || rotateDeg.value === 270
  const cw = swap ? h : w
  const ch = swap ? w : h
  const canvas = document.createElement('canvas')
  canvas.width = cw
  canvas.height = ch
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('无法创建画布')
  if (format.value === 'image/jpeg') {
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, cw, ch)
  }
  ctx.save()
  ctx.translate(cw / 2, ch / 2)
  ctx.rotate((rotateDeg.value * Math.PI) / 180)
  if (flipH.value) ctx.scale(-1, 1)
  ctx.drawImage(img, -w / 2, -h / 2, w, h)
  ctx.restore()
  if (wmText.value.trim() || wmImg) drawWatermark(ctx, cw, ch, wmImg)
  let blob = await new Promise<Blob | null>(res => canvas.toBlob(res, format.value, quality.value / 100))
  if (!blob) throw new Error('图片编码失败')
  // 目标体积模式：二分调质量逼近目标 KB（仅对 JPEG/WebP 有效，PNG 无损无法调）
  if (sizeMode.value === 'targetKB' && (format.value === 'image/jpeg' || format.value === 'image/webp')) {
    const targetBytes = Math.max(1, targetKB.value) * 1024
    const enc = (q: number) =>
      new Promise<Blob | null>(res => canvas.toBlob(res, format.value, Math.max(0.05, Math.min(1, q))))
    if (blob.size > targetBytes) {
      let lo = 0.05
      let hi = quality.value / 100
      let best = blob
      for (let i = 0; i < 7; i++) {
        const mid = (lo + hi) / 2
        const b = await enc(mid)
        if (!b) break
        if (b.size <= targetBytes) {
          best = b
          lo = mid
        } else {
          hi = mid
        }
      }
      blob = best
    }
  }
  const b64 = await blobToBase64(blob)
  const outName = item.name.replace(/\.[^.]+$/, '') + EXT[format.value]
  const r = await api.writeBinary({ dir: outBase.value.dir, name: outName, base64: b64 })
  if (!r.ok) throw new Error(r.error)
  return r.data.path
}

async function run() {
  if (!items.value.length) {
    ElMessage.warning('请先选择图片')
    return
  }
  if (!outBase.value.dir) {
    ElMessage.warning('请选择输出文件夹')
    return
  }
  running.value = true
  progress.value = 0
  outputs.value = []
  let wmImg: HTMLImageElement | null = null
  if (wmImage.value) {
    try {
      wmImg = await loadImage(wmImage.value.base64, mimeOf(wmImage.value.name))
    } catch {
      wmImg = null
    }
  }
  let done = 0
  let okCount = 0
  for (const item of items.value) {
    item.status = '处理中'
    try {
      const p = await processOne(item, wmImg)
      item.status = '完成'
      item.outPath = p
      outputs.value.push(p)
      okCount++
    } catch (e) {
      item.status = '失败'
      item.error = e instanceof Error ? e.message : String(e)
    }
    done++
    progress.value = Math.round((done / items.value.length) * 100)
  }
  running.value = false
  if (okCount === items.value.length) ElMessage.success(`全部 ${okCount} 张处理完成`)
  else ElMessage.warning(`${okCount} 张成功，${items.value.length - okCount} 张失败`)
}

const statusTag = (s: Item['status']) =>
  s === '完成' ? 'success' : s === '失败' ? 'danger' : s === '处理中' ? 'warning' : 'info'

/* ---------- 长图拼接 ---------- */

const stitchFiles = ref<string[]>([])
const stitchDir = ref<'v' | 'h'>('v')
const stitchGap = ref(0)
const stitchBg = ref('#ffffff')
const stitchFormat = ref<'png' | 'jpeg'>('png')
const stitchName = ref('')
const stitchBusy = ref(false)
const stitchOutput = ref('')

/** 自然序比较：img2 排在 img10 前面（普通字符串排序会反过来） */
function naturalCompare(a: string, b: string): number {
  return a.localeCompare(b, 'zh-CN', { numeric: true, sensitivity: 'base' })
}

/** 按文件名自然序排列（拼接顺序常需与文件名一致） */
function sortStitchByName() {
  stitchFiles.value = [...stitchFiles.value].sort((a, b) => naturalCompare(basename(a), basename(b)))
  ElMessage.success('已按文件名排序')
}

const stitchDragIdx = ref<number | null>(null)

function onStitchDragStart(i: number) {
  stitchDragIdx.value = i
}
function onStitchDrop(i: number) {
  const from = stitchDragIdx.value
  stitchDragIdx.value = null
  if (from === null || from === i) return
  const arr = [...stitchFiles.value]
  const [moved] = arr.splice(from, 1)
  arr.splice(i, 0, moved)
  stitchFiles.value = arr
}
function moveStitch(i: number, delta: number) {
  const j = i + delta
  if (j < 0 || j >= stitchFiles.value.length) return
  const arr = [...stitchFiles.value]
  ;[arr[i], arr[j]] = [arr[j], arr[i]]
  stitchFiles.value = arr
}

async function runStitch() {
  stitchOutput.value = ''
  if (!stitchFiles.value.length) {
    ElMessage.warning('请先选择图片（按选择顺序拼接）')
    return
  }
  if (!outBase.value.dir) {
    ElMessage.warning('请选择输出文件夹')
    return
  }
  stitchBusy.value = true
  try {
    const r = await call(api.readFiles(stitchFiles.value))
    if (!r) return
    const imgs: HTMLImageElement[] = []
    for (const f of r) {
      try {
        imgs.push(await loadImage(f.base64, mimeOf(f.name)))
      } catch {
        ElMessage.warning(`图片解码失败，已跳过：${f.name}`)
      }
    }
    if (imgs.length < 2) {
      ElMessage.warning('至少需要两张可用的图片')
      return
    }
    const gap = Math.max(0, stitchGap.value)
    const vertical = stitchDir.value === 'v'
    const canvas = document.createElement('canvas')
    if (vertical) {
      canvas.width = Math.max(...imgs.map(i => i.width))
      canvas.height = imgs.reduce((n, i) => n + i.height, 0) + gap * (imgs.length - 1)
    } else {
      canvas.width = imgs.reduce((n, i) => n + i.width, 0) + gap * (imgs.length - 1)
      canvas.height = Math.max(...imgs.map(i => i.height))
    }
    // 浏览器 canvas 有尺寸/面积上限（超出会静默得到空白图），提前拦截并给出可操作建议
    const MAX_SIDE = 16384
    const MAX_AREA = 268435456 // 16384 * 16384
    let drawScale = 1
    const side = Math.max(canvas.width, canvas.height)
    const area = canvas.width * canvas.height
    if (side > MAX_SIDE || area > MAX_AREA) {
      // 自动尝试按比例缩小到上限内，避免直接失败
      drawScale = Math.min(MAX_SIDE / side, Math.sqrt(MAX_AREA / area))
      const nw = Math.floor(canvas.width * drawScale)
      const nh = Math.floor(canvas.height * drawScale)
      const ok = window.confirm(
        `拼接后的图片尺寸为 ${canvas.width} × ${canvas.height}，超出浏览器可处理的上限，可能得到空白图。\n\n是否自动缩小到 ${nw} × ${nh} 后继续？\n（选"取消"可减少图片数量，或先到"批量"压缩后再拼接）`
      )
      if (!ok) return
      canvas.width = nw
      canvas.height = nh
    }
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('无法创建画布')
    ctx.fillStyle = stitchBg.value
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    // 按缩放比例绘制，间距一并缩放，保持整体构图一致
    let offset = 0
    for (const img of imgs) {
      const iw = Math.round(img.width * drawScale)
      const ih = Math.round(img.height * drawScale)
      if (vertical) {
        ctx.drawImage(img, Math.round((canvas.width - iw) / 2), offset, iw, ih)
        offset += ih + Math.round(gap * drawScale)
      } else {
        ctx.drawImage(img, offset, Math.round((canvas.height - ih) / 2), iw, ih)
        offset += iw + Math.round(gap * drawScale)
      }
    }
    const mime = stitchFormat.value === 'png' ? 'image/png' : 'image/jpeg'
    const blob = await new Promise<Blob | null>(res => canvas.toBlob(res, mime, 0.92))
    if (!blob) throw new Error('图片编码失败')
    const b64 = await blobToBase64(blob)
    const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14)
    const rr = await api.writeBinary({
      dir: outBase.value.dir,
      name: exportFilename(stitchName.value.trim() || outBase.value.name, stitchFormat.value === 'png' ? '.png' : '.jpg', `长图_${stamp}`),
      base64: b64
    })
    if (!rr.ok) throw new Error(rr.error)
    stitchOutput.value = rr.data.path
    ElMessage.success('拼接完成')
  } finally {
    stitchBusy.value = false
  }
}

/* ---------- 贴图 / 遮挡（单张交互式标注） ---------- */

const imgTab = ref<'batch' | 'stitch' | 'idphoto' | 'annotate'>('batch')

const annoFile = ref<string[]>([])
const annoImage = ref<{ name: string; mime: string; base64: string } | null>(null)
const annoFormat = ref<'image/png' | 'image/jpeg'>('image/png')
const annoQuality = ref(92)
const annoBusy = ref(false)
const annoOutput = ref('')
const annoPdfOutput = ref('')
const annoName = ref('')
// 导出增强：仅导出选区 / 扩展画布留白
const annoExportRegion = ref(false)
const annoExpand = ref(false)
const annoExpandW = ref(0)
const annoExpandH = ref(0)
const annoExpandTransparent = ref(false)
const annoExpandBg = ref('#ffffff')
const editorRef = ref<InstanceType<typeof ImageEditor> | null>(null)

watch(annoFile, async () => {
  annoOutput.value = ''
  annoPdfOutput.value = ''
  if (!annoFile.value.length) {
    annoImage.value = null
    return
  }
  const r = await call(api.readFiles(annoFile.value))
  if (!r || !r.length) {
    annoImage.value = null
    return
  }
  annoImage.value = { name: r[0].name, mime: mimeOf(r[0].name), base64: r[0].base64 }
})

async function runAnnoSave() {
  annoOutput.value = ''
  if (!annoImage.value || !editorRef.value) {
    ElMessage.warning('请先选择一张图片')
    return
  }
  if (!outBase.value.dir) {
    ElMessage.warning('请选择输出文件夹')
    return
  }
  annoBusy.value = true
  try {
    const opts: { region?: boolean; expand?: { w: number; h: number; bg: string | null } } = {}
    if (annoExportRegion.value) opts.region = true
    if (annoExpand.value && annoExpandW.value > 0 && annoExpandH.value > 0) {
      opts.expand = {
        w: annoExpandW.value,
        h: annoExpandH.value,
        bg: annoExpandTransparent.value ? null : annoExpandBg.value
      }
    }
    const blob = await editorRef.value.exportBlob(annoFormat.value, annoQuality.value / 100, opts)
    if (!blob) throw new Error('导出失败')
    const b64 = await blobToBase64(blob)
    const base = annoImage.value.name.replace(/\.[^.]+$/, '')
    const ext = annoFormat.value === 'image/png' ? 'png' : 'jpg'
    const r = await api.writeBinary({ dir: outBase.value.dir, name: exportFilename(annoName.value.trim() || outBase.value.name, `.${ext}`, `${base}_标注`), base64: b64 })
    if (!r.ok) throw new Error(r.error)
    annoOutput.value = r.data.path
    ElMessage.success('已保存')
  } catch (e) {
    ElMessage.error(e instanceof Error ? e.message : String(e))
  } finally {
    annoBusy.value = false
  }
}

/**
 * 把编辑结果直接转成单页 PDF（盖章件 / 扫描件回传系统的常见去处）。
 * 走 PDF 压缩链路同款通道（pdf:build-from-images）：按图片像素尺寸建页，
 * 「仅导出选区 / 扩展画布」与格式、质量设置一并生效。
 */
async function runAnnoExportPdf() {
  annoPdfOutput.value = ''
  if (!annoImage.value || !editorRef.value) {
    ElMessage.warning('请先选择一张图片')
    return
  }
  if (!outBase.value.dir) {
    ElMessage.warning('请选择输出文件夹')
    return
  }
  annoBusy.value = true
  try {
    const opts: { region?: boolean; expand?: { w: number; h: number; bg: string | null } } = {}
    if (annoExportRegion.value) opts.region = true
    if (annoExpand.value && annoExpandW.value > 0 && annoExpandH.value > 0) {
      opts.expand = {
        w: annoExpandW.value,
        h: annoExpandH.value,
        bg: annoExpandTransparent.value ? null : annoExpandBg.value
      }
    }
    const blob = await editorRef.value.exportBlob(annoFormat.value, annoQuality.value / 100, opts)
    if (!blob) throw new Error('导出失败')
    const b64 = await blobToBase64(blob)
    const base = (annoName.value.trim() || outBase.value.name || '图片转PDF').replace(/\.[^.]+$/, '')
    const r = await call(api.pdfBuildFromImages({ imagesBase64: [b64], outDir: outBase.value.dir, nameHint: `${base}_标注` }), 'PDF 已导出')
    if (r) annoPdfOutput.value = r.outputs[0] ?? ''
  } catch (e) {
    ElMessage.error(e instanceof Error ? e.message : String(e))
  } finally {
    annoBusy.value = false
  }
}

/* ---------- 证件照排版 ---------- */

const DPI = 300
const mm = (v: number) => Math.round((v / 25.4) * DPI)
const ID_SIZES: Record<string, { label: string; w: number; h: number }> = {
  one: { label: '一寸 25×35mm', w: 25, h: 35 },
  two: { label: '二寸 35×49mm', w: 35, h: 49 },
  smallOne: { label: '小一寸 22×32mm', w: 22, h: 32 },
  bigOne: { label: '大一寸 33×48mm', w: 33, h: 48 },
  smallTwo: { label: '小二寸 35×45mm', w: 35, h: 45 },
  passport: { label: '护照 33×48mm', w: 33, h: 48 }
}
const PAPERS: Record<string, { label: string; w: number; h: number }> = {
  six: { label: '6 寸相纸 152×102mm', w: 152, h: 102 },
  five: { label: '5 寸相纸 127×89mm', w: 127, h: 89 },
  a4: { label: 'A4 210×297mm', w: 210, h: 297 }
}

const idFile = ref<string[]>([])
const idSize = ref('one')
const idPaper = ref('six')
const idGap = ref(2)
const idMargin = ref(4)
const idCutLine = ref(true)
const idFormat = ref<'png' | 'jpeg'>('jpeg')
const idBusy = ref(false)
const idOutput = ref('')
const idName = ref('')

/* 参数记忆：记住页签与各页的格式/尺寸/水印等结构性设置（数值与选项基本固定） */
useRemembered('image', 'imgTab', imgTab)
// 批量处理
useRemembered('image', 'format', format)
useRemembered('image', 'quality', quality)
useRemembered('image', 'maxSide', maxSide)
useRemembered('image', 'sizeMode', sizeMode)
useRemembered('image', 'scalePercent', scalePercent)
useRemembered('image', 'targetKB', targetKB)
useRemembered('image', 'rotateDeg', rotateDeg)
useRemembered('image', 'flipH', flipH)
useRemembered('image', 'wmFontSize', wmFontSize)
useRemembered('image', 'wmOpacity', wmOpacity)
useRemembered('image', 'wmTile', wmTile)
useRemembered('image', 'wmAngle', wmAngle)
useRemembered('image', 'wmColor', wmColor)
useRemembered('image', 'wmGap', wmGap)
// 长图拼接
useRemembered('image', 'stitchDir', stitchDir)
useRemembered('image', 'stitchGap', stitchGap)
useRemembered('image', 'stitchBg', stitchBg)
useRemembered('image', 'stitchFormat', stitchFormat)
// 证件照排版
useRemembered('image', 'idSize', idSize)
useRemembered('image', 'idPaper', idPaper)
useRemembered('image', 'idGap', idGap)
useRemembered('image', 'idMargin', idMargin)
useRemembered('image', 'idCutLine', idCutLine)
useRemembered('image', 'idFormat', idFormat)
// 贴图 / 遮挡
useRemembered('image', 'annoFormat', annoFormat)
useRemembered('image', 'annoQuality', annoQuality)
useRemembered('image', 'annoExportRegion', annoExportRegion)
useRemembered('image', 'annoExpand', annoExpand)
useRemembered('image', 'annoExpandW', annoExpandW)
useRemembered('image', 'annoExpandH', annoExpandH)
useRemembered('image', 'annoExpandTransparent', annoExpandTransparent)
useRemembered('image', 'annoExpandBg', annoExpandBg)

async function runIdPhoto() {
  idOutput.value = ''
  if (!idFile.value.length) {
    ElMessage.warning('请先选择一张证件照')
    return
  }
  if (!outBase.value.dir) {
    ElMessage.warning('请选择输出文件夹')
    return
  }
  idBusy.value = true
  try {
    const r = await call(api.readFiles(idFile.value))
    if (!r) return
    const img = await loadImage(r[0].base64, mimeOf(r[0].name))
    const size = ID_SIZES[idSize.value]
    const paper = PAPERS[idPaper.value]
    const pw = mm(size.w)
    const ph = mm(size.h)
    const gap = mm(idGap.value)
    const margin = mm(idMargin.value)
    const usableW = mm(paper.w) - margin * 2
    const usableH = mm(paper.h) - margin * 2
    const cols = Math.max(1, Math.floor((usableW + gap) / (pw + gap)))
    const rows = Math.max(1, Math.floor((usableH + gap) / (ph + gap)))
    const blockW = cols * pw + (cols - 1) * gap
    const blockH = rows * ph + (rows - 1) * gap
    const startX = Math.round((mm(paper.w) - blockW) / 2)
    const startY = Math.round((mm(paper.h) - blockH) / 2)
    const canvas = document.createElement('canvas')
    canvas.width = mm(paper.w)
    canvas.height = mm(paper.h)
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('无法创建画布')
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    // 等比 cover：按目标框裁剪，保持人脸比例（原来直接拉伸会让人变形）
    const srcRatio = img.width / img.height
    const dstRatio = pw / ph
    let sx = 0
    let sy = 0
    let sw = img.width
    let sh = img.height
    if (srcRatio > dstRatio) {
      // 原图更宽 → 从两侧裁掉多余宽度（保持居中）
      sw = img.height * dstRatio
      sx = (img.width - sw) / 2
    } else {
      // 原图更高 → 从上下裁掉多余高度（略微偏上，给头顶留白）
      sh = img.width / dstRatio
      sy = Math.max(0, (img.height - sh) * 0.35)
    }
    for (let rr = 0; rr < rows; rr++) {
      for (let cc = 0; cc < cols; cc++) {
        const x = startX + cc * (pw + gap)
        const y = startY + rr * (ph + gap)
        ctx.drawImage(img, sx, sy, sw, sh, x, y, pw, ph)
        if (idCutLine.value) {
          ctx.strokeStyle = '#c0c4cc'
          ctx.lineWidth = 1
          ctx.setLineDash([4, 3])
          ctx.strokeRect(x - 0.5, y - 0.5, pw + 1, ph + 1)
          ctx.setLineDash([])
        }
      }
    }
    const mime = idFormat.value === 'png' ? 'image/png' : 'image/jpeg'
    const blob = await new Promise<Blob | null>(res => canvas.toBlob(res, mime, 0.95))
    if (!blob) throw new Error('图片编码失败')
    const b64 = await blobToBase64(blob)
    const total = rows * cols
    const name = exportFilename(idName.value.trim() || outBase.value.name, idFormat.value === 'png' ? '.png' : '.jpg', `证件照排版_${size.label.split(' ')[0]}_${total}张_${paper.label.split(' ')[0]}相纸`)
    const rr = await api.writeBinary({ dir: outBase.value.dir, name, base64: b64 })
    if (!rr.ok) throw new Error(rr.error)
    idOutput.value = rr.data.path
    ElMessage.success(`排版完成，共排 ${total} 张`)
  } finally {
    idBusy.value = false
  }
}
</script>

<template>
  <div>
    <h1 class="page-title">图片工具</h1>
    <p class="page-desc">批量压缩 / 格式转换 / 缩放 / 水印 / 长图拼接 / 贴图遮挡标注，全部在本机完成。</p>

    <el-tabs v-model="imgTab" style="margin-bottom: 10px">
      <el-tab-pane label="批量处理" name="batch" />
      <el-tab-pane label="长图拼接" name="stitch" />
      <el-tab-pane label="证件照排版" name="idphoto" />
      <el-tab-pane label="贴图 / 遮挡" name="annotate" />
    </el-tabs>

    <template v-if="imgTab === 'batch'">
    <StepCard :step="1" title="选择图片">
      <FilePickList v-model="files" :filters="IMG_FILTER" button-text="选择图片" title="选择要处理的图片" />
    </StepCard>

    <StepCard :step="2" title="处理参数">
      <div class="form-row">
        <div class="form-item">
          <label>输出格式</label>
          <el-select v-model="format" style="width: 120px">
            <el-option label="JPG" value="image/jpeg" />
            <el-option label="PNG" value="image/png" />
            <el-option label="WebP" value="image/webp" />
          </el-select>
        </div>
        <div class="form-item">
          <label>质量 {{ quality }}%</label>
          <el-slider v-model="quality" :min="10" :max="100" :disabled="format === 'image/png'" style="width: 160px" />
        </div>
        <div class="form-item">
          <label>尺寸</label>
          <el-select v-model="sizeMode" style="width: 150px">
            <el-option label="不缩放" value="none" />
            <el-option label="按最长边" value="maxSide" />
            <el-option label="按百分比" value="percent" />
            <el-option label="压到目标体积" value="targetKB" />
          </el-select>
        </div>
        <div v-if="sizeMode === 'maxSide'" class="form-item">
          <label>最长边(px)</label>
          <el-input-number v-model="maxSide" :min="1" :max="20000" :step="100" />
        </div>
        <div v-else-if="sizeMode === 'percent'" class="form-item">
          <label>缩放(%)</label>
          <el-input-number v-model="scalePercent" :min="1" :max="400" :step="5" />
        </div>
        <div v-else-if="sizeMode === 'targetKB'" class="form-item">
          <label>目标(KB)</label>
          <el-input-number v-model="targetKB" :min="1" :max="20000" :step="50" />
        </div>
        <div class="form-item">
          <label>旋转</label>
          <el-select v-model="rotateDeg" style="width: 90px">
            <el-option label="0°" :value="0" />
            <el-option label="90°" :value="90" />
            <el-option label="180°" :value="180" />
            <el-option label="270°" :value="270" />
          </el-select>
        </div>
        <div class="form-item">
          <el-checkbox v-model="flipH">水平翻转</el-checkbox>
        </div>
      </div>
      <div class="form-row mt-12">
        <div class="form-item">
          <label>水印文字</label>
          <el-input v-model="wmText" placeholder="留空则不加文字水印" style="width: 200px" clearable />
        </div>
        <div class="form-item">
          <label>字号</label>
          <el-input-number v-model="wmFontSize" :min="8" :max="200" />
        </div>
        <div class="form-item">
          <label>颜色</label>
          <el-color-picker v-model="wmColor" />
        </div>
        <div class="form-item">
          <label>角度°</label>
          <el-input-number v-model="wmAngle" :min="-180" :max="180" :step="15" />
        </div>
        <div class="form-item">
          <label>透明度 {{ wmOpacity }}%</label>
          <el-slider v-model="wmOpacity" :min="5" :max="100" style="width: 140px" />
        </div>
        <div class="form-item">
          <el-checkbox v-model="wmTile">平铺</el-checkbox>
        </div>
        <div v-if="wmTile" class="form-item">
          <label>间距(px)</label>
          <el-input-number v-model="wmGap" :min="0" :max="500" />
        </div>
        <div class="form-item">
          <el-button size="small" @click="pickWmImage">选择水印图片</el-button>
          <span v-if="wmImage" class="pick-count">{{ wmImage.name }}</span>
          <el-button v-if="wmImage" size="small" link type="danger" @click="wmImage = null">移除</el-button>
        </div>
      </div>
    </StepCard>

    <StepCard :step="3" title="输出位置">
      <OutDirPicker v-model="outDir" />
    </StepCard>

    <StepCard :step="4" title="执行">
      <el-button
        type="primary"
        :loading="running"
        :disabled="runBlocked"
        :title="runBlockedReason"
        :data-blocked-reason="runBlockedReason"
        data-primary-action
        @click="run"
      >
        开始处理（{{ items.length }} 张）
      </el-button>
      <div v-if="running || progress > 0" class="progress-row">
        <el-progress :percentage="progress" :stroke-width="14" />
      </div>
      <el-table v-if="items.length" :data="items" height="260" class="mt-14" size="small">
        <el-table-column label="文件" prop="name" show-overflow-tooltip />
        <el-table-column label="状态" width="90">
          <template #default="{ row }">
            <el-tag :type="statusTag(row.status)" size="small">{{ row.status }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="说明" show-overflow-tooltip>
          <template #default="{ row }">{{ row.error || row.outPath || '' }}</template>
        </el-table-column>
      </el-table>
      <ResultPanel :outputs="outputs" />
    </StepCard>
    </template>

    <template v-else-if="imgTab === 'stitch'">
      <StepCard :step="1" title="选择图片（可拖拽调整顺序）">
        <FilePickList
          v-model="stitchFiles"
          :filters="IMG_FILTER"
          button-text="选择图片"
          title="选择要拼接的图片（顺序决定拼接顺序）"
        />
        <div v-if="stitchFiles.length" style="margin-top: 12px; width: 100%">
          <div class="form-row" style="align-items: center">
            <span class="page-desc" style="margin: 0">共 {{ stitchFiles.length }} 张，拖拽列表项可调整拼接顺序</span>
            <el-button size="small" plain @click="sortStitchByName">按文件名排序</el-button>
          </div>
          <ul style="margin-top: 8px; padding: 0; list-style: none; max-height: 260px; overflow: auto; border: 1px solid var(--line, #dcdfe6); border-radius: 8px">
            <li
              v-for="(p, i) in stitchFiles"
              :key="p"
              draggable="true"
              style="display: flex; align-items: center; gap: 8px; padding: 4px 10px; border-bottom: 1px solid var(--line, #f0f0f0); cursor: grab; font-size: 13px"
              :style="stitchDragIdx === i ? { background: 'var(--surface-2, #f5f7fa)', opacity: 0.6 } : {}"
              @dragstart="onStitchDragStart(i)"
              @dragover.prevent
              @drop="onStitchDrop(i)"
            >
              <span style="color: var(--text-3, #999)">⠿</span>
              <span style="width: 22px; text-align: center; color: var(--text-3, #999)">{{ i + 1 }}</span>
              <span style="flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap" :title="p">{{ basename(p) }}</span>
              <el-button size="small" link @click="moveStitch(i, -1)">↑</el-button>
              <el-button size="small" link @click="moveStitch(i, 1)">↓</el-button>
              <el-button size="small" link type="danger" @click="stitchFiles = stitchFiles.filter((_, k) => k !== i)">移除</el-button>
            </li>
          </ul>
        </div>
      </StepCard>

      <StepCard :step="2" title="拼接设置">
        <div class="form-row">
          <div class="form-item">
            <label>方向</label>
            <el-radio-group v-model="stitchDir">
              <el-radio-button value="v">纵向（合成竖长图）</el-radio-button>
              <el-radio-button value="h">横向（合成横长图）</el-radio-button>
            </el-radio-group>
          </div>
          <div class="form-item">
            <label>间距(px)</label>
            <el-input-number v-model="stitchGap" :min="0" :max="500" />
          </div>
          <div class="form-item">
            <label>输出格式</label>
            <el-radio-group v-model="stitchFormat">
              <el-radio-button value="png">PNG（无损）</el-radio-button>
              <el-radio-button value="jpeg">JPG（更小）</el-radio-button>
            </el-radio-group>
          </div>
          <div class="form-item">
            <label>背景色</label>
            <el-color-picker v-model="stitchBg" />
          </div>
        </div>
        <div class="page-desc mt-8">
          适合聊天记录、长截图合并；图片按最大宽（高）对齐居中，不足处用背景色填充。
        </div>
      </StepCard>

      <StepCard :step="3" title="输出位置">
        <OutDirPicker v-model="outDir" file />
        <div class="form-row mt-12">
          <div class="form-item">
            <label>输出文件名</label>
            <el-input v-model="stitchName" placeholder="留空自动：长图_时间戳" style="width: 260px" clearable />
          </div>
        </div>
      </StepCard>

      <StepCard :step="4" title="执行">
        <el-button type="primary" :loading="stitchBusy" data-primary-action @click="runStitch">
          开始拼接（{{ stitchFiles.length }} 张）
        </el-button>
        <ResultPanel :outputs="stitchOutput ? [stitchOutput] : []" />
      </StepCard>
    </template>

    <template v-else-if="imgTab === 'idphoto'">
      <StepCard :step="1" title="选择证件照（一张）">
        <FilePickList
          v-model="idFile"
          :filters="IMG_FILTER"
          :multiple="false"
          button-text="选择照片"
          title="选择一张证件照原图"
        />
      </StepCard>

      <StepCard :step="2" title="排版设置">
        <div class="form-row">
          <div class="form-item">
            <label>照片尺寸</label>
            <el-select v-model="idSize" style="width: 180px">
              <el-option v-for="(v, k) in ID_SIZES" :key="k" :label="v.label" :value="k" />
            </el-select>
          </div>
          <div class="form-item">
            <label>相纸</label>
            <el-select v-model="idPaper" style="width: 200px">
              <el-option v-for="(v, k) in PAPERS" :key="k" :label="v.label" :value="k" />
            </el-select>
          </div>
        </div>
        <div class="form-row mt-10">
          <div class="form-item">
            <label>间距(mm)</label>
            <el-input-number v-model="idGap" :min="0" :max="10" />
          </div>
          <div class="form-item">
            <label>页边距(mm)</label>
            <el-input-number v-model="idMargin" :min="0" :max="20" />
          </div>
          <div class="form-item">
            <el-checkbox v-model="idCutLine">画裁切虚线</el-checkbox>
          </div>
          <div class="form-item">
            <label>格式</label>
            <el-radio-group v-model="idFormat">
              <el-radio-button value="jpeg">JPG</el-radio-button>
              <el-radio-button value="png">PNG</el-radio-button>
            </el-radio-group>
          </div>
        </div>
        <div class="page-desc mt-8">
          按 300dpi 排版整张相纸，冲印后沿虚线裁切即可。照片按目标尺寸等比裁剪（保持人脸比例不变形），建议原图人脸居中。
        </div>
      </StepCard>

      <StepCard :step="3" title="输出位置">
        <OutDirPicker v-model="outDir" file />
        <div class="form-row mt-12">
          <div class="form-item">
            <label>输出文件名</label>
            <el-input v-model="idName" placeholder="留空自动：证件照排版_尺寸_张数" style="width: 260px" clearable />
          </div>
        </div>
      </StepCard>

      <StepCard :step="4" title="执行">
        <el-button type="primary" :loading="idBusy" data-primary-action @click="runIdPhoto">开始排版</el-button>
        <ResultPanel :outputs="idOutput ? [idOutput] : []" />
      </StepCard>
    </template>

    <template v-else-if="imgTab === 'annotate'">
      <StepCard :step="1" title="选择图片（单张）">
        <FilePickList
          v-model="annoFile"
          :filters="IMG_FILTER"
          :multiple="false"
          button-text="选择图片"
          title="选择一张要标注的图片"
        />
      </StepCard>

      <StepCard :step="2" title="标注编辑">
        <ImageEditor ref="editorRef" :image="annoImage" />
        <div class="page-desc mt-10">全部在本机内存中完成，不会上传；快捷键见编辑器上方提示。</div>
      </StepCard>

      <StepCard :step="3" title="输出位置">
        <OutDirPicker v-model="outDir" file />
        <div class="form-row mt-12">
          <div class="form-item">
            <label>输出文件名</label>
            <el-input v-model="annoName" placeholder="留空自动：原名_标注" style="width: 260px" clearable />
          </div>
        </div>
      </StepCard>

      <StepCard :step="4" title="保存">
        <div class="form-row">
          <div class="form-item">
            <label>格式</label>
            <el-radio-group v-model="annoFormat">
              <el-radio-button value="image/png">PNG（无损，支持透明）</el-radio-button>
              <el-radio-button value="image/jpeg">JPG（更小）</el-radio-button>
            </el-radio-group>
            <div v-if="annoFormat === 'image/jpeg'" class="ed-label mt-4">
              注意：JPG 不支持透明通道，勾选的「透明背景」会被填成白色。
            </div>
          </div>
          <div class="form-item" v-if="annoFormat === 'image/jpeg'">
            <label>质量 {{ annoQuality }}%</label>
            <el-slider v-model="annoQuality" :min="50" :max="100" style="width: 140px" />
          </div>
          <div class="form-item">
            <el-button type="primary" :loading="annoBusy" data-primary-action @click="runAnnoSave">保存结果</el-button>
            <el-button :loading="annoBusy" @click="runAnnoExportPdf">导出为 PDF</el-button>
          </div>
        </div>
        <div class="form-row mt-10">
          <div class="form-item">
            <el-checkbox
              :model-value="annoExportRegion"
              @change="(v: boolean) => { annoExportRegion = v; if (v) annoExpand = false }"
            >
              仅导出选区
            </el-checkbox>
          </div>
          <div class="form-item">
            <el-checkbox
              :model-value="annoExpand"
              @change="(v: boolean) => { annoExpand = v; if (v) annoExportRegion = false }"
            >
              扩展画布留白（居中）
            </el-checkbox>
          </div>
        </div>
        <div class="page-desc mt-4">「仅导出选区」与「扩展画布」互斥，仅可择一。</div>
        <div class="form-row mt-8" v-if="annoExpand">
          <div class="form-item">
            <label>宽(px)</label>
            <el-input-number v-model="annoExpandW" :min="1" :max="20000" :step="50" />
          </div>
          <div class="form-item">
            <label>高(px)</label>
            <el-input-number v-model="annoExpandH" :min="1" :max="20000" :step="50" />
          </div>
          <div class="form-item">
            <el-checkbox v-model="annoExpandTransparent" style="margin-right: 8px">透明背景</el-checkbox>
            <el-color-picker v-model="annoExpandBg" :disabled="annoExpandTransparent" />
            <span class="ed-label" style="margin-left: 6px">留空=不扩展</span>
          </div>
        </div>
        <ResultPanel :outputs="[annoOutput, annoPdfOutput].filter(Boolean)" />
        <div class="page-desc mt-4">「导出为 PDF」把当前编辑结果（含选区 / 留白设置）转成单页 PDF，页面尺寸与图片像素一致。</div>
      </StepCard>
    </template>
  </div>
</template>
