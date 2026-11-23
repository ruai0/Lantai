<script setup lang="ts">
/**
 * PDF 工作台：把「合并 / 拆页 / 调序 / 删页 / 旋转 / 提取」收进一个画布，
 * 左侧文件、中间页面缩略图（拖拽调序）、右侧操作与导出。其余单项功能仍走各页签。
 * 缩略图沿用 pdf.js 在渲染进程渲染，纯本地、无新依赖。
 */
import { api } from '../utils/ipc'
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import type { ComponentPublicInstance } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { openPdf, readPdfBytes } from '../utils/pdfjs'
import { usePageAnnos } from '../utils/usePageAnnos'
import OutDirPicker from './OutDirPicker.vue'
import { call } from '../utils/api'
import { parseRanges } from '@shared/pageRanges'
import {
  PDF_BIG_BYTES,
  PDF_COMPRESS_DPI_MAX,
  PDF_COMPRESS_DPI_MIN,
  PDF_COMPRESS_DEFAULT_DPI,
  PDF_COMPRESS_DEFAULT_QUALITY,
  PDF_COMPRESS_QUALITY_MAX,
  PDF_COMPRESS_QUALITY_MIN
} from '@shared/pdfCompress'
import type { PdfPageAnno } from '@shared/types'

const PDF_FILTER = [{ name: 'PDF 文件', extensions: ['pdf'] }]
const STICKER_FILTER = [{ name: '图片', extensions: ['png', 'jpg', 'jpeg', 'bmp', 'webp'] }]

interface WbPage {
  /** 唯一 id，用于拖拽与 key */
  uid: number
  /** 源文件在 files 中的下标 */
  source: number
  /** 源文件条目 uid：缩略图渲染按它找文件，不依赖 source 下标（移除文件会整体位移） */
  srcUid: number
  /** 源文件内 0-based 页码 */
  page: number
  /** 缩略图 dataURL；空串 = 还没渲染（进入可视区域才渲染） */
  thumb: string
  /** 本页额外旋转角度 */
  rotate: number
  /** 裁剪区域（渲染视图的分数坐标，y 自顶向下）；仅 rotate===0 时可设 */
  crop?: { x: number; y: number; w: number; h: number }
  /** 本页标注（马赛克/涂抹/贴图），PDF 用户空间磅值，导出时烧进页面 */
  annos?: PdfPageAnno[]
  selected: boolean
}

/** 文件条目：同一份 PDF 允许加入多次（各占一个条目），uid 是条目身份 */
interface WbFile {
  uid: number
  path: string
}

/** 新增文件的插入位置 */
type InsertPos = 'front' | 'beforeSelected' | 'end'

const props = defineProps<{ outDir: string }>()
const emit = defineEmits<{ (e: 'update:outDir', v: string): void }>()

const files = ref<WbFile[]>([])
const pages = ref<WbPage[]>([])
const loading = ref(false)
const text = ref('')
const exporting = ref(false)
const lastOutput = ref('')
/** 输出文件名（留空自动）；原「合并」页签的自定义名能力，页签合并后挪到这里 */
const outName = ref('')
/** 按页码范围删除的输入；原「删页」页签的快速路径，页签合并后挪到这里 */
const delRanges = ref('')
const zoom = ref(1)
/** 滑块两侧的 −/＋ 步进：比拖滑块好微调，键盘用户也能用 */
function zoomStep(d: number): void {
  zoom.value = Math.min(1.8, Math.max(0.6, Math.round((zoom.value + d) * 10) / 10))
}
const dragIndex = ref(-1)
const dragOverIndex = ref(-1)

let uidSeq = 0

const selectedCount = computed(() => pages.value.filter(p => p.selected).length)

function baseName(p: string): string {
  return p.split(/[\\/]/).pop() ?? p
}

/* ---------- 载入文件与缩略图 ---------- */

/**
 * 缩略图懒加载：导入只读页数、建占位页（大文件也毫秒级），缩略图由
 * IntersectionObserver 在页面滚进可视区域时才渲染（队列限流并发），
 * 同一文件的 pdf.js 文档缓存复用——页多的文件不再"全部渲染完才见到东西"。
 * 任务队列串行执行，连点两次「添加 PDF」也不会交错导致混页。
 */
interface RenderJob {
  entries: WbFile[]
  /** 插到这个页面之前；null = 追加到末尾（或列表为空时的任意位置） */
  anchorUid: number | null
}

const renderQueue: RenderJob[] = []
let rendering = false
/** 世代号：清空工作台时让正在跑的载入任务尽快退出 */
let renderEpoch = 0

function enqueueRender(entries: WbFile[], anchorUid: number | null): void {
  renderQueue.push({ entries, anchorUid })
  queuedJobs.value = renderQueue.length
  if (!rendering) void runRenderQueue()
}

/** 还在排队的载入批数：载入中再点「添加 PDF」是排队而非丢失，得让用户看见 */
const queuedJobs = ref(0)

async function runRenderQueue(): Promise<void> {
  rendering = true
  loading.value = true
  try {
    while (renderQueue.length) {
      const job = renderQueue.shift()!
      queuedJobs.value = renderQueue.length
      try {
        await loadFileEntries(job, renderEpoch)
      } catch (e) {
        ElMessage.error(e instanceof Error ? e.message : String(e))
      }
    }
  } finally {
    rendering = false
    loading.value = false
    text.value = ''
  }
}

/* ---------- pdf.js 文档缓存：整个工作台周期内每份文件只解析一次 ---------- */

interface OpenedDoc {
  doc: PdfDocProxy
  close: () => Promise<void>
}
const wbDocs = new Map<number, OpenedDoc>()

async function ensureWbDoc(entry: WbFile): Promise<OpenedDoc> {
  const cached = wbDocs.get(entry.uid)
  if (cached) return cached
  const opened = await openPdf(await readPdfBytes(entry.path))
  wbDocs.set(entry.uid, opened)
  return opened
}

async function closeWbDoc(uid: number): Promise<void> {
  const opened = wbDocs.get(uid)
  if (!opened) return
  wbDocs.delete(uid)
  try {
    await opened.close()
  } catch {
    /* 销毁失败不影响后续 */
  }
}

async function closeAllWbDocs(): Promise<void> {
  for (const uid of [...wbDocs.keys()]) await closeWbDoc(uid)
}

async function loadFileEntries(job: RenderJob, epoch: number): Promise<void> {
  for (const entry of job.entries) {
    if (epoch !== renderEpoch) return
    text.value = `正在载入：${baseName(entry.path)}`
    const opened = await ensureWbDoc(entry)
    if (epoch !== renderEpoch) return
    const total = opened.doc.numPages
    const si = files.value.findIndex(f => f.uid === entry.uid)
    const fresh: WbPage[] = []
    for (let pn = 1; pn <= total; pn++) {
      fresh.push({
        uid: uidSeq++,
        source: si < 0 ? 0 : si,
        srcUid: entry.uid,
        page: pn - 1,
        thumb: '',
        rotate: 0,
        selected: false
      })
    }
    // 锚点页可能已被删掉：那时退化为追加到末尾
    const idx = job.anchorUid != null ? pages.value.findIndex(p => p.uid === job.anchorUid) : -1
    if (idx >= 0) pages.value.splice(idx, 0, ...fresh)
    else pages.value.push(...fresh)
  }
}

/* ---------- 缩略图按需渲染：滚到哪画到哪 ---------- */

/** 缩略图渲染并发数：pdf.js 的解析在 worker，主线程只收画布指令，多路并行明显快于逐页串行 */
const THUMB_CONCURRENCY = 4
const thumbQueue: WbPage[] = []
let thumbRunning = false

function requestThumb(p: WbPage): void {
  if (p.thumb || thumbQueue.includes(p)) return
  thumbQueue.push(p)
  void pumpThumbs()
}

async function pumpThumbs(): Promise<void> {
  if (thumbRunning) return
  thumbRunning = true
  try {
    const workers = Array.from({ length: THUMB_CONCURRENCY }, () => thumbWorker())
    await Promise.all(workers)
  } finally {
    thumbRunning = false
  }
}

async function thumbWorker(): Promise<void> {
  while (thumbQueue.length) {
    const p = thumbQueue.shift()!
    if (p.thumb) continue
    try {
      const entry = files.value.find(f => f.uid === p.srcUid)
      if (!entry) continue
      const opened = await ensureWbDoc(entry)
      const page = await opened.doc.getPage(p.page + 1)
      const viewport = page.getViewport({ scale: 0.28 })
      const canvas = document.createElement('canvas')
      canvas.width = Math.floor(viewport.width)
      canvas.height = Math.floor(viewport.height)
      const ctx = canvas.getContext('2d')
      if (ctx) {
        ctx.fillStyle = '#ffffff'
        ctx.fillRect(0, 0, canvas.width, canvas.height)
        await page.render({ canvas, canvasContext: ctx, viewport }).promise
        p.thumb = canvas.toDataURL('image/jpeg', 0.55)
      }
      page.cleanup()
    } catch (e) {
      // 单页失败不拦其余页；错误只在控制台提示（导出时主进程还会给出权威结论）
      console.warn('[工作台] 缩略图渲染失败', e)
    }
    // 让出主线程，滚动静止时渲染不至于卡顿
    await new Promise(r => setTimeout(r, 0))
  }
}

/* ---------- 可视区域观察：格子出现/滚入就排队渲染它的缩略图 ---------- */

let cellObserver: IntersectionObserver | null = null
/** uid → 格子元素：键盘焦点移动与「预览关联回列表」都要按 uid 找 DOM */
const cellEls = new Map<number, HTMLElement>()

function cellRef(el: Element | ComponentPublicInstance | null, p: WbPage): void {
  if (!el || !(el instanceof Element)) {
    cellEls.delete(p.uid)
    return
  }
  const node = el as HTMLElement
  cellEls.set(p.uid, node)
  if (!cellObserver) {
    cellObserver = new IntersectionObserver(
      entries => {
        for (const en of entries) {
          if (!en.isIntersecting) continue
          const uid = Number((en.target as HTMLElement).dataset.uid)
          const page = pages.value.find(x => x.uid === uid)
          if (page) requestThumb(page)
          cellObserver?.unobserve(en.target)
        }
      },
      { root: null, rootMargin: '300px 0px' }
    )
  }
  node.dataset.uid = String(p.uid)
  cellObserver.observe(node)
}

/** 键盘操作格子：方向键移动焦点、Enter 看大图、空格勾选、Delete 删页 */
function onCellKey(e: KeyboardEvent, i: number, p: WbPage): void {
  const focus = (d: number) => cellEls.get(pages.value[i + d]?.uid ?? -1)?.focus()
  switch (e.key) {
    case 'ArrowRight':
    case 'ArrowDown':
      e.preventDefault()
      focus(1)
      break
    case 'ArrowLeft':
    case 'ArrowUp':
      e.preventDefault()
      focus(-1)
      break
    case 'Enter':
      e.preventDefault()
      openPreview(i)
      break
    case ' ':
      e.preventDefault()
      toggleSelect(p.uid)
      break
    case 'Delete':
    case 'Backspace':
      e.preventDefault()
      removePage(p.uid)
      break
  }
}

/** 关掉大图/翻页后，把缩略图列表同步滚到当前页 */
function syncListToPreview(): void {
  const p = pages.value[previewIndex.value]
  if (!p) return
  cellEls.get(p.uid)?.scrollIntoView({ block: 'nearest' })
}

onBeforeUnmount(() => {
  document.removeEventListener('keydown', onWbKey)
  cellObserver?.disconnect()
  cellObserver = null
  void closeAllWbDocs()
})

async function pickFiles() {
  const r = await api.pickFiles({ filters: PDF_FILTER, multiple: true, title: '选择 PDF 文件（可多选；同一份文件也可再次添加）' })
  if (!r.ok || !r.data.length) return
  if (!files.value.length && !pages.value.length) {
    addFilesAt(r.data, 'end')
    return
  }
  pendingPaths.value = r.data
  insertOpen.value = true
}

/** 导入前先问一声加密情况，别等编辑完了导出才发现 */
async function warnIfEncrypted(paths: string[]): Promise<void> {
  try {
    const r = await api.pdfCheckEncrypted({ paths })
    if (!r.ok) return
    const names = r.data.items.filter(i => i.encrypted).map(i => baseName(i.path))
    if (names.length) {
      ElMessage.info(`${names.join('、')} 已加密（无打开密码时导出会自动解密）`)
    }
  } catch {
    /* 检查失败不拦路，导出时自会给出结论 */
  }
}

function addFilesAt(paths: string[], pos: InsertPos, anchorOverride?: number): void {
  const entries = paths.map(p => ({ uid: uidSeq++, path: p }))
  // 锚点页：新页面插在它前面（它属于哪个文件，新文件条目就插在那个文件前面）
  let anchorUid: number | null = null
  let fi = files.value.length
  if (anchorOverride != null) {
    const idx = pages.value.findIndex(p => p.uid === anchorOverride)
    if (idx >= 0) {
      anchorUid = anchorOverride
      fi = pages.value[idx]!.source
    }
  } else if (pos === 'front') {
    anchorUid = pages.value[0]?.uid ?? null
    fi = 0
  } else if (pos === 'beforeSelected') {
    const first = pages.value.find(p => p.selected)
    if (first) {
      anchorUid = first.uid
      fi = first.source
    }
  }
  files.value.splice(fi, 0, ...entries)
  // 已有页面里引用了「新文件之后」的文件，下标整体后移
  pages.value.forEach(p => {
    if (p.source >= fi) p.source += entries.length
  })
  void warnIfEncrypted(paths)
  enqueueRender(entries, anchorUid)
}

/** 插入位置选择弹窗（工作台里已有内容时出现） */
const insertOpen = ref(false)
const pendingPaths = ref<string[]>([])
/** 直接指定插到第几页之前；打开弹窗时默认定位到选中页（无选中则最后） */
const insertAtPage = ref(1)
const insertAtMax = computed(() => Math.max(pages.value.length, 1))

watch(insertOpen, open => {
  if (!open) return
  const selIdx = pages.value.findIndex(p => p.selected)
  insertAtPage.value = selIdx >= 0 ? selIdx + 1 : pages.value.length
})

function applyInsert(pos: InsertPos): void {
  const paths = pendingPaths.value
  pendingPaths.value = []
  insertOpen.value = false
  if (paths.length) addFilesAt(paths, pos)
}

/** 插到输入的页码之前：页码就是当前列表的序号（1 起步），越界直接挡下 */
function applyInsertAtPage(): void {
  const paths = pendingPaths.value
  if (!paths.length) {
    insertOpen.value = false
    return
  }
  const total = pages.value.length
  const n = Math.floor(insertAtPage.value)
  if (!total) {
    pendingPaths.value = []
    insertOpen.value = false
    addFilesAt(paths, 'end')
    return
  }
  if (!Number.isFinite(n) || n < 1 || n > total) {
    ElMessage.warning(`页码需在 1 ~ ${total} 之间（当前共 ${total} 页）`)
    return
  }
  const anchor = pages.value[n - 1]!.uid
  pendingPaths.value = []
  insertOpen.value = false
  addFilesAt(paths, 'end', anchor)
}

async function removeFile(i: number) {
  if (loading.value) {
    ElMessage.info('正在载入缩略图，请稍候再移除文件')
    return
  }
  const [removed] = files.value.splice(i, 1)
  if (!removed) return
  // 释放该文件的 pdf.js 文档缓存，移除其所有页，并把其余页的 source 下标前移
  void closeWbDoc(removed.uid)
  pageHistory.length = 0
  canUndo.value = false
  pages.value = pages.value
    .filter(p => p.source !== i)
    .map(p => (p.source > i ? { ...p, source: p.source - 1 } : p))
}

/** 清空会丢掉旋转/裁剪/标注等全部编辑状态（原文件不受影响），确认一下再动手 */
async function clearAll() {
  if (files.value.length) {
    try {
      await ElMessageBox.confirm(
        '将清空所有文件与页面（旋转、裁剪、标注等编辑状态一并丢弃），原文件不受影响。',
        '清空工作台',
        { type: 'warning', confirmButtonText: '清空', cancelButtonText: '取消' }
      )
    } catch {
      return
    }
  }
  renderEpoch++
  renderQueue.length = 0
  thumbQueue.length = 0
  queuedJobs.value = 0
  pageHistory.length = 0
  canUndo.value = false
  files.value = []
  pages.value = []
  lastOutput.value = ''
  void closeAllWbDocs()
}

/* ---------- 页面操作 ---------- */

/* ---------- 撤销（Ctrl+Z）：删页/调序/旋转/裁剪等结构操作可回退 ----------
   快照是页对象的浅拷贝，annos 数组共享引用——标注编辑有自己的撤销栈，这里不重复管，
   也避免把几 MB 的贴图数据克隆进历史（上限 20 步）。 */
const MAX_PAGE_HISTORY = 20
const pageHistory: WbPage[][] = []
const canUndo = ref(false)

function pushHistory(): void {
  pageHistory.push(pages.value.map(p => ({ ...p })))
  if (pageHistory.length > MAX_PAGE_HISTORY) pageHistory.shift()
  canUndo.value = true
}

function undo(): void {
  const snap = pageHistory.pop()
  if (!snap) return
  pages.value = snap
  canUndo.value = pageHistory.length > 0
  estimate.value = null
}

/** 大图预览开着时 Ctrl+Z 归标注撤销管；输入框打字时不抢快捷键 */
function onWbKey(e: KeyboardEvent): void {
  if (previewOpen.value) return
  const el = document.activeElement
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) return
  if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === 'z') {
    e.preventDefault()
    undo()
  }
}

function toggleSelect(uid: number) {
  const p = pages.value.find(x => x.uid === uid)
  if (p) p.selected = !p.selected
}

function selectAll() {
  const all = pages.value.every(p => p.selected)
  pages.value.forEach(p => (p.selected = !all))
}

function rotatePage(uid: number, delta: number) {
  const p = pages.value.find(x => x.uid === uid)
  if (!p) return
  pushHistory()
  p.rotate = (p.rotate + delta + 360) % 360
}

function removePage(uid: number) {
  const p = pages.value.find(x => x.uid === uid)
  if (!p) return
  pushHistory()
  pages.value = pages.value.filter(x => x.uid !== uid)
}

function removeSelected() {
  if (!selectedCount.value) {
    ElMessage.warning('请先勾选要删除的页面')
    return
  }
  pushHistory()
  pages.value = pages.value.filter(p => !p.selected)
}

/**
 * 按页码范围删除（原「删页」页签的快速路径，页签合并后挪到这里）。
 * 48 页的台账要删掉后面 20 页，一页页点显然不如直接写 "29-48"。
 * 页码指**当前列表**中的序号（1 起步），与导出顺序一致。
 */
/** 回车删页：输入法选词时的回车不触发（避免打拼音时误删） */
function onDelEnter(e: KeyboardEvent): void {
  if (e.isComposing || e.keyCode === 229) return
  removeByRanges()
}

function removeByRanges(): void {
  const spec = delRanges.value.trim()
  if (!spec) {
    ElMessage.warning('请填写要删除的页码，如 29-48')
    return
  }
  if (pages.value.length < 2) {
    ElMessage.warning('至少保留一页')
    return
  }
  try {
    const drop = new Set(parseRanges(spec, pages.value.length))
    const rest = pages.value.filter((_, i) => !drop.has(i))
    if (!rest.length) {
      ElMessage.warning('不能删除全部页面')
      return
    }
    const removed = pages.value.length - rest.length
    if (!removed) {
      ElMessage.info('没有页面被删除（页码都在保留范围外？）')
      return
    }
    pushHistory()
    pages.value = rest
    delRanges.value = ''
    ElMessage.success(`已删除 ${removed} 页，仅影响本次导出，原文件不动`)
  } catch (e) {
    // parseRanges 的报错本身就说清了格式与越界，直接透出
    ElMessage.warning(e instanceof Error ? e.message : String(e))
  }
}

function rotateSelected(delta: number) {
  if (!selectedCount.value) {
    ElMessage.warning('请先勾选页面')
    return
  }
  pushHistory()
  pages.value.forEach(p => {
    if (p.selected) p.rotate = (p.rotate + delta + 360) % 360
  })
}

function moveSelectedToTop() {
  const sel = pages.value.filter(p => p.selected)
  if (!sel.length) {
    ElMessage.warning('请先勾选页面')
    return
  }
  pushHistory()
  pages.value = [...sel, ...pages.value.filter(p => !p.selected)]
}

/** 选中页整体移到最后 */
function moveSelectedToEnd() {
  const sel = pages.value.filter(p => p.selected)
  if (!sel.length) {
    ElMessage.warning('请先勾选页面')
    return
  }
  pushHistory()
  pages.value = [...pages.value.filter(p => !p.selected), ...sel]
}

/** 选中页整块前移/后移一位：连续勾选作为一个整体移动，到边界就停 */
function moveSelectedBy(delta: -1 | 1) {
  if (!selectedCount.value) {
    ElMessage.warning('请先勾选页面')
    return
  }
  pushHistory()
  const arr = [...pages.value]
  if (delta < 0) {
    for (let i = 1; i < arr.length; i++) {
      if (arr[i]!.selected && !arr[i - 1]!.selected) {
        const t = arr[i - 1]!
        arr[i - 1] = arr[i]!
        arr[i] = t
      }
    }
  } else {
    for (let i = arr.length - 2; i >= 0; i--) {
      if (arr[i]!.selected && !arr[i + 1]!.selected) {
        const t = arr[i + 1]!
        arr[i + 1] = arr[i]!
        arr[i] = t
      }
    }
  }
  pages.value = arr
}

function reverseAll() {
  pushHistory()
  pages.value = [...pages.value].reverse()
}

/* ---------- 拖拽调序 ---------- */

function onDragStart(i: number, e: DragEvent) {
  dragIndex.value = i
  if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move'
}
function onDragOver(i: number) {
  // 外部文件拖进来时 dragIndex 为 -1，别把调序高亮误点到格子上
  if (dragIndex.value < 0) return
  dragOverIndex.value = i
}
function onDrop(i: number) {
  const from = dragIndex.value
  dragIndex.value = -1
  dragOverIndex.value = -1
  if (from < 0 || from === i) return
  pushHistory()
  const arr = pages.value
  const [moved] = arr.splice(from, 1)
  arr.splice(i, 0, moved)
}

/* ---------- 导出 ---------- */

/** 页 → 导出页序项：旋转 / 裁剪 / 标注一并带走 */
function orderEntry(p: WbPage) {
  return {
    source: p.source,
    page: p.page,
    rotate: p.rotate,
    ...(p.crop ? { crop: p.crop } : {}),
    ...(p.annos && p.annos.length ? { annos: p.annos } : {})
  }
}

async function exportPdf() {
  if (!pages.value.length) {
    ElMessage.warning('没有可导出的页面')
    return
  }
  if (!props.outDir) {
    ElMessage.warning('请先选择输出文件夹')
    return
  }
  exporting.value = true
  try {
    const r = await call(
      api.pdfOrganize({
        paths: files.value.map(f => f.path),
        order: pages.value.map(orderEntry),
        outDir: props.outDir,
        name: outName.value.trim() || undefined
      }),
      '导出完成'
    )
    if (r) {
      lastOutput.value = r.outputs[0] ?? ''
      await refreshOutputSize(r.outputs[0])
    }
  } finally {
    exporting.value = false
  }
}

/* ---------- 大小预估与压缩导出 ---------- */

/** 预估结果（字节）；null = 还没估 */
const estimate = ref<{ bytes: number; pages: number } | null>(null)
const estimating = ref(false)
/** 压缩参数：与「压缩」页签同一套口径（dpi + JPEG 质量） */
const compDpi = ref(PDF_COMPRESS_DEFAULT_DPI)
const compQuality = ref(PDF_COMPRESS_DEFAULT_QUALITY)
const compressing = ref(false)
const compProgress = ref('')

/** 超过这个体积就提示可以压缩（发邮件/上传系统的常见门槛） */
const BIG_BYTES = PDF_BIG_BYTES

const fmtSize = (bytes: number): string => {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`
}

/** 源文件总大小，用来和预估结果对比 */
const sourceBytes = ref(0)

async function refreshSourceSize(): Promise<void> {
  if (!files.value.length) {
    sourceBytes.value = 0
    return
  }
  const r = await api.fileSizes(files.value.map(f => f.path))
  if (r.ok) sourceBytes.value = r.data.reduce((n, f) => n + f.sizeBytes, 0)
}

/** 预估导出体积：走主进程同一套构建逻辑，不落盘 */
async function estimateSize(): Promise<void> {
  if (!pages.value.length) {
    ElMessage.warning('没有可导出的页面')
    return
  }
  estimating.value = true
  try {
    const r = await call(api.pdfOrganizeEstimate({ paths: files.value.map(f => f.path), order: pages.value.map(orderEntry) }), undefined)
    if (r) {
      estimate.value = r
      await refreshSourceSize()
      if (r.bytes > BIG_BYTES) {
        ElMessage.warning(`预计 ${fmtSize(r.bytes)}，偏大，建议压缩后再发`)
      }
    }
  } finally {
    estimating.value = false
  }
}

/** 导出后回填实际大小（比预估更有说服力） */
async function refreshOutputSize(out: string): Promise<void> {
  if (!out) return
  const r = await api.fileSizes([out])
  if (r.ok && r.data[0]) {
    estimate.value = { bytes: r.data[0].sizeBytes, pages: pages.value.length }
    await refreshSourceSize()
  }
}

/** 页面一改（增删/旋转/裁剪/标注）预估就失效，避免显示旧数字误导 */
watch(
  () => pages.value.map(p => `${p.uid}:${p.rotate}:${p.crop ? 1 : 0}:${p.annos?.length ?? 0}`).join('|'),
  () => {
    estimate.value = null
  }
)

/**
 * 压缩后导出：先让主进程把旋转/裁剪/标注烧进中间 PDF，再逐页栅格化成 JPEG 重建。
 * 栅格化只认页面像素，不认识裁剪框和标注，所以必须先烧进中间文件——否则压缩会把它们丢掉。
 */
async function exportCompressed(): Promise<void> {
  if (!pages.value.length) {
    ElMessage.warning('没有可导出的页面')
    return
  }
  if (!props.outDir) {
    ElMessage.warning('请先选择输出文件夹')
    return
  }
  compressing.value = true
  compProgress.value = ''
  let tmpPath = ''
  try {
    const prep = await call(
      api.pdfOrganizeTemp({ paths: files.value.map(f => f.path), order: pages.value.map(orderEntry) }),
      undefined
    )
    if (!prep) return
    tmpPath = prep.path
    const bytes = await readPdfBytes(tmpPath)
    const opened = await openPdf(bytes)
    const images: string[] = []
    try {
      const total = opened.doc.numPages
      const scale = compDpi.value / 72
      for (let i = 1; i <= total; i++) {
        compProgress.value = `正在压缩：第 ${i} / ${total} 页`
        const page = await opened.doc.getPage(i)
        const viewport = page.getViewport({ scale })
        const canvas = document.createElement('canvas')
        canvas.width = Math.floor(viewport.width)
        canvas.height = Math.floor(viewport.height)
        const ctx = canvas.getContext('2d')
        if (!ctx) throw new Error('无法创建画布')
        ctx.fillStyle = '#ffffff'
        ctx.fillRect(0, 0, canvas.width, canvas.height)
        await page.render({ canvas, canvasContext: ctx, viewport }).promise
        images.push(canvas.toDataURL('image/jpeg', compQuality.value / 100).split(',')[1] ?? '')
        // 让出主线程，大文档压缩时界面不至于完全卡死
        if (i % 3 === 0) await new Promise(r => setTimeout(r, 0))
      }
    } finally {
      await opened.close()
    }
    const base = outName.value.trim() || pathBaseName(files.value[0]?.path ?? '') || 'PDF压缩'
    const out = await call(
      api.pdfBuildFromImages({
        imagesBase64: images,
        outDir: props.outDir,
        nameHint: `${base}_压缩`
      }),
      `压缩完成（${compQuality.value}% 质量 / ${compDpi.value} DPI）`
    )
    if (out) {
      lastOutput.value = out.outputs[0] ?? ''
      await refreshOutputSize(out.outputs[0])
    }
  } catch (e) {
    ElMessage.error(e instanceof Error ? e.message : String(e))
  } finally {
    compressing.value = false
    compProgress.value = ''
    // 中间文件用完就删（主进程只允许删临时目录内的文件）
    if (tmpPath) void api.pdfRemoveTemp({ path: tmpPath })
  }
}

/** 从路径取文件名主干，压缩输出默认用它 */
function pathBaseName(p: string): string {
  const base = p.split(/[\\/]/).pop() ?? ''
  return base.replace(/\.pdf$/i, '')
}

function openOutputDir() {
  void api.openPath(props.outDir)
}

/* ---------- 页面大图预览 ---------- */

/**
 * 48 页的缩略图只有指甲盖大，看不清内容、也没法确认"这页到底要不要删/转/提"。
 * 点缩略图开大图：按 ←/→ 翻页、可缩放，并直接对本页做旋转 / 删除 / 提取 / 只留这一页。
 * 大图按需重新用 pdf.js 渲染（缩略图阶段 doc 已 close）。
 *
 * 两条防并发渲染的措施（少了任何一条都会撞 pdf.js 的
 * "Cannot use the same canvas during multiple render() operations"）：
 *  1) 文档缓存——同一文件翻页只读一次文件、只建一次 worker、只解析一次；
 *     原先每次翻页都重读重解析，链路长、窗口大，是竞态的主要来源（也慢）。
 *  2) 取消上一次未完成的 RenderTask——缓存也挡不住用户连按翻页/拖缩放滑块，
 *     新渲染前先把上一个任务取消掉，canvas 上就只会有一个活跃任务。
 */
const previewOpen = ref(false)
const previewIndex = ref(0)
const previewCanvas = ref<HTMLCanvasElement | null>(null)
const previewZoom = ref(1)
const previewing = ref(false)
let previewToken = 0

/** 大图当前打开的 PDF 文档（按文件路径缓存，换文件才重建） */
let previewDoc: { path: string; doc: PdfDocProxy; close: () => Promise<void> } | null = null
/** 上一次未完成的渲染任务；新渲染前取消，避免同一 canvas 上叠加多个 render() */
let previewRenderTask: { cancel(): void } | null = null

type PdfDocProxy = Awaited<ReturnType<typeof openPdf>>['doc']

/** 取（必要时建立）大图的 PDF 文档；换文件时释放上一个 */
async function ensurePreviewDoc(path: string): Promise<PdfDocProxy> {
  if (previewDoc?.path === path) return previewDoc.doc
  const stale = previewDoc
  previewDoc = null
  if (stale) {
    try {
      await stale.close()
    } catch {
      /* 销毁失败不影响后续：worker 终将随页面回收 */
    }
  }
  const opened = await openPdf(await readPdfBytes(path))
  previewDoc = { path, doc: opened.doc, close: opened.close }
  return opened.doc
}

/** 关闭大图时释放缓存的文档与未完成的渲染任务 */
async function releasePreviewDoc(): Promise<void> {
  if (previewRenderTask) {
    try {
      previewRenderTask.cancel()
    } catch {
      /* 已结束的任务取消会抛，忽略 */
    }
    previewRenderTask = null
  }
  const stale = previewDoc
  previewDoc = null
  if (stale) {
    try {
      await stale.close()
    } catch {
      /* 同上 */
    }
  }
}

/** 是不是用户主动取消渲染导致的 rejection——这类不该弹错误 */
function isRenderCancelled(e: unknown): boolean {
  if (!e || typeof e !== 'object') return false
  const name = (e as { name?: string }).name ?? ''
  const msg = e instanceof Error ? e.message : String(e)
  return name === 'RenderingCancelledException' || /cancel/i.test(msg)
}

const previewPage = computed(() => pages.value[previewIndex.value] ?? null)
const previewTitle = computed(() => {
  const p = previewPage.value
  if (!p) return '页面预览'
  const f = files.value[p.source]
  return `${f ? baseName(f.path) : ''} · 第 ${previewIndex.value + 1} / ${pages.value.length} 页（原文件第 ${p.page + 1} 页）`
})
const previewAnnoCount = computed(() => previewPage.value?.annos?.length ?? 0)

/**
 * 大图内的「图片式编辑」：马赛克/涂抹/贴图/框选复制。
 * 标注直接写在页数据上（WbPage.annos），切页不丢；坐标由组合式就地换算成 PDF 磅值。
 */
const annos = usePageAnnos(
  () => previewPage.value?.annos,
  next => {
    const p = previewPage.value
    if (!p) return
    p.annos = next.length ? next : undefined
  },
  {
    // 马赛克取色 / 框选复制从这里拿原始页面像素（≈打印级密度），不再取屏幕分辨率
    capturePage: async pxPerPt => {
      const p = previewPage.value
      if (!p) return null
      const doc = await ensurePreviewDoc(files.value[p.source]?.path ?? '')
      const page = await doc.getPage(p.page + 1)
      const natural = page.getViewport({ scale: 1 })
      const vp = page.getViewport({
        scale: pxPerPt,
        rotation: (natural.rotation + p.rotate) % 360
      })
      const canvas = document.createElement('canvas')
      canvas.width = Math.floor(vp.width)
      canvas.height = Math.floor(vp.height)
      const ctx = canvas.getContext('2d')
      if (!ctx) return null
      ctx.fillStyle = '#ffffff'
      ctx.fillRect(0, 0, canvas.width, canvas.height)
      await page.render({ canvas, canvasContext: ctx, viewport: vp }).promise
      return { canvas, vp }
    }
  }
)
// 解构出来才能在模板里直接 v-model（顶层 setup 绑定才会正确读写 .value）
const {
  tool: annoTool,
  canUndo: annoCanUndo,
  drawAnnos: annosDraw,
  mosaicCell: annoCell,
  brushColor: annoBrushColor,
  brushWidth: annoBrushWidth,
  stickerOpacity: annoStickerOpacity,
  selectedId: annoSelectedId,
  pending: annoPending
} = annos

function openPreview(i: number): void {
  previewIndex.value = i
  previewOpen.value = true
  annos.reset()
  void nextTick(() => renderPreview())
  document.addEventListener('keydown', onPreviewKey)
  document.addEventListener('paste', onPreviewPaste)
}

function closePreview(): void {
  previewOpen.value = false
}

/** 编辑过标注的页：关掉大图后按「页面 + 当前标注」重画缩略图，列表所见即所得 */
async function refreshThumbWithAnnos(p: WbPage): Promise<void> {
  const entry = files.value.find(f => f.uid === p.srcUid)
  if (!entry) return
  try {
    const opened = await ensureWbDoc(entry)
    const pg = await opened.doc.getPage(p.page + 1)
    const vp = pg.getViewport({ scale: 0.28 })
    const canvas = document.createElement('canvas')
    canvas.width = Math.floor(vp.width)
    canvas.height = Math.floor(vp.height)
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    await pg.render({ canvas, canvasContext: ctx, viewport: vp }).promise
    if (p.annos?.length) annosDraw(ctx, p.annos, vp)
    p.thumb = canvas.toDataURL('image/jpeg', 0.55)
    pg.cleanup()
  } catch {
    /* 缩略图刷新失败不打扰用户，导出仍按页面数据走 */
  }
}

function onPreviewClosed(): void {
  document.removeEventListener('keydown', onPreviewKey)
  document.removeEventListener('paste', onPreviewPaste)
  const edited = previewPage.value
  if (edited?.annos?.length) void refreshThumbWithAnnos(edited)
  annos.reset()
  const c = previewCanvas.value
  if (c) {
    c.getContext('2d')?.clearRect(0, 0, c.width, c.height)
  }
  // 释放大图的 PDF 文档与未完成的渲染任务，避免 worker 泄漏
  void releasePreviewDoc()
  // 列表滚到大图最后看的那页，来回对照不迷路
  void nextTick(syncListToPreview)
}

function onPreviewKey(e: KeyboardEvent): void {
  if (!previewOpen.value) return
  // 编辑态快捷键（Ctrl+Z 撤销 / Delete 删贴图 / Esc 取消）优先消费
  if (annos.onKey(e)) return
  if (e.key === 'ArrowLeft') stepPreview(-1)
  else if (e.key === 'ArrowRight') stepPreview(1)
}

function stepPreview(delta: number): void {
  const n = previewIndex.value + delta
  if (n < 0 || n >= pages.value.length) return
  previewIndex.value = n
  annos.reset()
  syncListToPreview()
  void renderPreview()
}

/** 缩放变化去抖：滚轮连滚 / 拖滑块时不必每格都真渲染，停手 120ms 后画一次 */
let zoomRenderTimer: ReturnType<typeof setTimeout> | undefined
watch(previewZoom, () => {
  if (!previewOpen.value) return
  if (zoomRenderTimer) clearTimeout(zoomRenderTimer)
  zoomRenderTimer = setTimeout(() => void renderPreview(), 120)
})

/** 滚轮缩放大图：上滚放大、下滚缩小，范围与滑块一致 */
const PREVIEW_ZOOM_MIN = 0.5
const PREVIEW_ZOOM_MAX = 3

function onPreviewWheel(e: WheelEvent): void {
  if (!previewOpen.value) return
  const delta = e.deltaY < 0 ? 0.1 : -0.1
  const next = Math.round((previewZoom.value + delta) * 10) / 10
  previewZoom.value = Math.min(PREVIEW_ZOOM_MAX, Math.max(PREVIEW_ZOOM_MIN, next))
}

/* ---------- 画布式平移：没开任何编辑工具时，按住图片拖动即可移动视图 ----------
   本质是拖动舞台的 scrollLeft/scrollTop（放大后内容溢出舞台），滚动条藏起来，
   手感与看图软件一致。裁剪 / 标注 / 放贴图手势各自优先，平移让位。 */
let panActive = false
let panStage: HTMLElement | null = null
const panStart = { x: 0, y: 0, sl: 0, st: 0 }
const stageGrabbing = ref(false)

function onStagePanDown(e: MouseEvent): void {
  if (cropMode.value || annoPending.value || annoTool.value !== 'none') return
  // 只在按住图片本身时平移，点到四周留白/按钮不响应
  if (e.target !== previewCanvas.value) return
  const stage = (e.currentTarget as HTMLElement) ?? null
  if (!stage) return
  panActive = true
  panStage = stage
  stageGrabbing.value = true
  panStart.x = e.clientX
  panStart.y = e.clientY
  panStart.sl = stage.scrollLeft
  panStart.st = stage.scrollTop
  window.addEventListener('mousemove', onStagePanMove)
  window.addEventListener('mouseup', onStagePanUp)
}

function onStagePanMove(e: MouseEvent): void {
  if (!panActive || !panStage) return
  panStage.scrollLeft = panStart.sl - (e.clientX - panStart.x)
  panStage.scrollTop = panStart.st - (e.clientY - panStart.y)
}

function onStagePanUp(): void {
  panActive = false
  panStage = null
  stageGrabbing.value = false
  window.removeEventListener('mousemove', onStagePanMove)
  window.removeEventListener('mouseup', onStagePanUp)
}

/**
 * pdf.js 只画在离屏 base 画布上；可见画布 = base + 本页标注（由 usePageAnnos 合成）。
 * 页面自身旋转与工作台的额外旋转一并烘焙进视口——大图始终"正"着看，
 * 且 convertToPdfPoint 换出来的直接就是 PDF 用户空间坐标，旋转页上编辑/导出都准。
 */
const baseCanvas = document.createElement('canvas')

async function renderPreview(): Promise<void> {
  const p = previewPage.value
  const canvas = previewCanvas.value
  if (!p || !canvas) return
  const token = ++previewToken
  previewing.value = true
  // 取消上一次未完成的渲染：翻页/缩放连击时 canvas 上只留一个活跃任务
  if (previewRenderTask) {
    const stale = previewRenderTask
    previewRenderTask = null
    try {
      stale.cancel()
    } catch {
      /* 已自然结束的任务取消会抛，忽略 */
    }
  }
  try {
    const doc = await ensurePreviewDoc(files.value[p.source]?.path ?? '')
    if (token !== previewToken) return
    const page = await doc.getPage(p.page + 1)
    const stage = canvas.parentElement
    const availW = Math.max(240, (stage?.clientWidth ?? 720) - 16)
    const availH = Math.max(240, window.innerHeight * 0.66)
    const natural = page.getViewport({ scale: 1 })
    const dpr = window.devicePixelRatio || 1
    // 先适配舞台，再乘用户缩放与设备像素比，保证高分屏不糊
    const fit = Math.min(availW / natural.width, availH / natural.height) * previewZoom.value * dpr
    const vp = page.getViewport({
      scale: Math.max(0.05, fit),
      rotation: (natural.rotation + p.rotate) % 360
    })
    baseCanvas.width = Math.floor(vp.width)
    baseCanvas.height = Math.floor(vp.height)
    canvas.width = Math.floor(vp.width)
    canvas.height = Math.floor(vp.height)
    canvas.style.width = `${Math.floor(vp.width / dpr)}px`
    canvas.style.height = `${Math.floor(vp.height / dpr)}px`
    const bctx = baseCanvas.getContext('2d')
    if (!bctx) return
    bctx.fillStyle = '#ffffff'
    bctx.fillRect(0, 0, baseCanvas.width, baseCanvas.height)
    const task = page.render({ canvas: baseCanvas, canvasContext: bctx, viewport: vp })
    previewRenderTask = task
    try {
      await task.promise
    } finally {
      if (previewRenderTask === task) previewRenderTask = null
    }
    // 这一页画完了才做后续：cancel 后 token 已变，直接丢弃
    if (token !== previewToken) return
    page.cleanup()
    annos.attach(baseCanvas, canvas)
    annos.setViewport(vp, dpr)
    annos.redraw()
  } catch (e) {
    // 取消是"新的渲染已接手"的正常表现，不弹错误
    if (token === previewToken && !isRenderCancelled(e)) {
      ElMessage.error(e instanceof Error ? e.message : String(e))
    }
  } finally {
    if (token === previewToken) previewing.value = false
  }
}

function previewRotate(delta: number): void {
  const p = previewPage.value
  if (!p) return
  rotatePage(p.uid, delta)
  // 转起来之后视图与页面坐标系不再一致，原先框的裁剪区域会裁错位置，直接作废
  if ((p.rotate + 360) % 360 !== 0) p.crop = undefined
  void renderPreview()
}

/* ---------- 大图内裁剪 ---------- */

/**
 * 48 页台账最常需要的编辑就是"裁掉白边 / 裁掉页眉页脚 / 只留正文那一块"，
 * 这类操作只有看得清整页时才做得准，所以放在大图预览里做：
 * 拖框选区域 → 记成渲染视图的分数坐标 → 导出时由主进程写成 CropBox。
 * 旋转中的页不能裁（视图与页面坐标系不一致），进入裁剪前先挡掉。
 */
const cropMode = ref(false)
/** 选区，相对画布显示框的像素 */
const cropSel = ref<{ x: number; y: number; w: number; h: number } | null>(null)
let cropDragging = false
let cropOrigin = { x: 0, y: 0 }

const cropBoxStyle = computed(() => {
  const s = cropSel.value
  if (!s) return {}
  return {
    left: `${s.x}px`,
    top: `${s.y}px`,
    width: `${s.w}px`,
    height: `${s.h}px`
  }
})

/** 选区尺寸提示（按渲染视图的百分比，用户不必关心磅值） */
const cropLabel = computed(() => {
  const c = previewCanvas.value
  const s = cropSel.value
  if (!c || !s || !c.clientWidth) return ''
  const w = Math.round((s.w / c.clientWidth) * 100)
  const h = Math.round((s.h / c.clientHeight) * 100)
  return `${w}% × ${h}%`
})

/**
 * 已应用裁剪的常驻回显：框出保留区、把裁掉的部分压暗，并标出保留比例。
 * 少了这个，裁完只能等导出才知道成不成——这是"裁完不知道啥样"的直接解法。
 * 百分比定位，缩放/重渲染后依旧对齐；只在退出编辑模式时显示（拖拽中有虚线框就够了）。
 */
const keepStyle = computed(() => {
  const c = previewPage.value?.crop
  if (!c) return {}
  return {
    left: `${c.x * 100}%`,
    top: `${c.y * 100}%`,
    width: `${c.w * 100}%`,
    height: `${c.h * 100}%`
  }
})
const keepLabel = computed(() => {
  const c = previewPage.value?.crop
  if (!c) return ''
  return `保留 ${Math.round(c.w * 100)}% × ${Math.round(c.h * 100)}%`
})

function enterCrop(): void {
  const p = previewPage.value
  const c = previewCanvas.value
  if (!p || !c) return
  if ((p.rotate + 360) % 360 !== 0) {
    ElMessage.warning('这页现在是旋转状态，请先转正再裁剪')
    return
  }
  // 裁剪与图片式编辑互斥：都吃拖拽手势，同时开必然误触
  annos.setTool('none')
  cropSel.value = p.crop
    ? { x: p.crop.x * c.clientWidth, y: p.crop.y * c.clientHeight, w: p.crop.w * c.clientWidth, h: p.crop.h * c.clientHeight }
    : null
  cropMode.value = true
}

function exitCrop(): void {
  cropMode.value = false
  cropSel.value = null
}

function cropPoint(e: MouseEvent): { x: number; y: number } | null {
  const c = previewCanvas.value
  if (!c) return null
  const r = c.getBoundingClientRect()
  return {
    x: Math.max(0, Math.min(e.clientX - r.left, r.width)),
    y: Math.max(0, Math.min(e.clientY - r.top, r.height))
  }
}

function onCropDown(e: MouseEvent): void {
  const pt = cropPoint(e)
  if (!pt) return
  cropDragging = true
  cropOrigin = pt
  cropSel.value = { x: pt.x, y: pt.y, w: 0, h: 0 }
}

function onCropMove(e: MouseEvent): void {
  if (!cropDragging) return
  const pt = cropPoint(e)
  if (!pt) return
  cropSel.value = {
    x: Math.min(cropOrigin.x, pt.x),
    y: Math.min(cropOrigin.y, pt.y),
    w: Math.abs(pt.x - cropOrigin.x),
    h: Math.abs(pt.y - cropOrigin.y)
  }
}

function onCropUp(): void {
  if (!cropDragging) return
  cropDragging = false
  // 拖出个"线"没意义，直接取消，避免误生成一条 1px 的裁剪边
  if (cropSel.value && (cropSel.value.w < 8 || cropSel.value.h < 8)) cropSel.value = null
}

/** 确认裁剪：像素 → 渲染视图分数坐标，写回本页 */
function applyCrop(): void {
  const p = previewPage.value
  const c = previewCanvas.value
  const s = cropSel.value
  if (!p || !c) return
  if (!s || s.w < 8 || s.h < 8) {
    ElMessage.warning('请在页面上拖出一个区域再应用')
    return
  }
  pushHistory()
  p.crop = {
    x: round4(s.x / c.clientWidth),
    y: round4(s.y / c.clientHeight),
    w: round4(s.w / c.clientWidth),
    h: round4(s.h / c.clientHeight)
  }
  cropMode.value = false
  ElMessage.success('已记住这页的裁剪区域，导出时生效')
  void renderPreview()
}

function clearCrop(): void {
  const p = previewPage.value
  if (!p) return
  pushHistory()
  p.crop = undefined
  exitCrop()
  void renderPreview()
}

function round4(n: number): number {
  return Math.round(n * 10000) / 10000
}

/** 把当前这一页导出成独立的单页 PDF（等价于只勾它再"仅导出选中页"） */
async function previewExportOne(): Promise<void> {
  const p = previewPage.value
  if (!p) return
  if (!props.outDir) {
    ElMessage.warning('请先选择输出文件夹')
    return
  }
  try {
    const r = await call(
      api.pdfOrganize({
        paths: files.value.map(f => f.path),
        order: [orderEntry(p)],
        outDir: props.outDir
      }),
      '已提取本页'
    )
    if (r) lastOutput.value = r.outputs[0] ?? ''
  } catch {
    /* 错误已由 call 统一提示 */
  }
}

/** 删掉其余所有页，只留当前这一页（仅影响本次导出，不改原文件） */
async function previewKeepOnly(): Promise<void> {
  const p = previewPage.value
  if (!p || pages.value.length < 2) return
  try {
    await ElMessageBox.confirm(
      `将删除除第 ${previewIndex.value + 1} 页外的其他 ${pages.value.length - 1} 页。只影响这次导出的结果，你的原文件不会改动。`,
      '只留这一页',
      { type: 'warning', confirmButtonText: '删除其余页', cancelButtonText: '取消' }
    )
  } catch {
    return
  }
  pushHistory()
  pages.value = [p]
  previewIndex.value = 0
  ElMessage.success('已删除其余页，可直接导出')
  void renderPreview()
}

/** 删除当前页，并自动切到相邻页 */
function previewDelete(): void {
  const p = previewPage.value
  if (!p) return
  pushHistory()
  pages.value = pages.value.filter(x => x.uid !== p.uid)
  if (!pages.value.length) {
    closePreview()
    return
  }
  if (previewIndex.value >= pages.value.length) previewIndex.value = pages.value.length - 1
  annos.reset()
  void renderPreview()
}

/* ---------- 贴图来源：文件 / 剪贴板 ---------- */

function guessMime(p: string): string {
  const ext = p.split('.').pop()?.toLowerCase() ?? ''
  if (ext === 'png') return 'image/png'
  if (ext === 'jpg' || ext === 'jpeg') return 'image/jpeg'
  if (ext === 'webp') return 'image/webp'
  if (ext === 'bmp') return 'image/bmp'
  return 'image/png'
}

/** 统一转成 PNG dataURL：主进程 embedPng 只吃 PNG，顺便剥掉 EXIF 等元数据 */
async function stickerFromDataUrl(dataUrl: string): Promise<void> {
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image()
      el.onload = () => resolve(el)
      el.onerror = () => reject(new Error('图片解码失败'))
      el.src = dataUrl
    })
    const c = document.createElement('canvas')
    c.width = img.naturalWidth
    c.height = img.naturalHeight
    c.getContext('2d')?.drawImage(img, 0, 0)
    annos.beginPending(c.toDataURL('image/png'), img.naturalWidth, img.naturalHeight)
    ElMessage.success('图片已就绪，在页面上点击放置（可拖动、右下角缩放）')
  } catch {
    ElMessage.error('图片解码失败，请换一张试试')
  }
}

async function pickStickerFile(): Promise<void> {
  const r = await api.pickFiles({ filters: STICKER_FILTER, multiple: false, title: '选择要盖到页面上的图片' })
  if (!r.ok || !r.data.length) return
  const picked = r.data[0]
  const fr = await api.readFiles([picked])
  if (!fr.ok) {
    ElMessage.error(fr.error)
    return
  }
  await stickerFromDataUrl(`data:${guessMime(picked)};base64,${fr.data[0].base64}`)
}

/** 预览打开时监听粘贴：截图/复制的图片直接进入「点击放置」 */
function onPreviewPaste(e: ClipboardEvent): void {
  if (!previewOpen.value) return
  const items = e.clipboardData?.items
  if (!items) return
  for (const it of items) {
    if (it.type.startsWith('image/')) {
      const file = it.getAsFile()
      if (file) {
        e.preventDefault()
        const reader = new FileReader()
        reader.onload = () => {
          if (typeof reader.result === 'string') void stickerFromDataUrl(reader.result)
        }
        reader.readAsDataURL(file)
        return
      }
    }
  }
}

/* ---------- 拖拽导入 ---------- */

/**
 * 从资源管理器把 PDF 拖进工作台任意位置即可导入，与「添加 PDF」走同一套
 * 插入位置流程（工作台已有内容时同样弹位置选择）。缩略图格子自身的 drop
 * 只处理内部调序（dragIndex 为 -1 时直接返回），外部文件落到格子上会冒泡
 * 到这里统一处理。
 */
const fileDragOver = ref(false)

function onFileDragOver(e: DragEvent): void {
  if (e.dataTransfer && Array.from(e.dataTransfer.types).includes('Files')) {
    fileDragOver.value = true
  }
}

function onFileDragLeave(e: DragEvent): void {
  // 拖过子元素也会触发 dragleave，只有真正离开组件边界才取消高亮
  const el = e.currentTarget as HTMLElement | null
  if (el && e.relatedTarget instanceof Node && el.contains(e.relatedTarget)) return
  fileDragOver.value = false
}

function onFileDrop(e: DragEvent): void {
  fileDragOver.value = false
  const dropped = e.dataTransfer?.files
  if (!dropped?.length) return
  const paths: string[] = []
  for (const f of Array.from(dropped)) {
    const p = api.getPathForFile(f)
    if (p && /\.pdf$/i.test(p)) paths.push(p)
  }
  if (!paths.length) {
    ElMessage.warning('请拖入 PDF 文件（文件夹暂不支持）')
    return
  }
  if (!files.value.length && !pages.value.length) {
    addFilesAt(paths, 'end')
    return
  }
  pendingPaths.value = paths
  insertOpen.value = true
}

onBeforeUnmount(() => document.removeEventListener('keydown', onPreviewKey))
onMounted(() => document.addEventListener('keydown', onWbKey))

/** 把当前勾选页面导出为「只含这些页」的独立 PDF（等价于提取） */
async function exportSelected() {
  if (!selectedCount.value) {
    ElMessage.warning('请先勾选要提取的页面')
    return
  }
  try {
    // 临时构造只含勾选页的顺序
    const order = pages.value.filter(p => p.selected).map(orderEntry)
    const r = await call(
      api.pdfOrganize({
        paths: files.value.map(f => f.path),
        order,
        outDir: props.outDir
      }),
      '提取完成'
    )
    if (r) {
      lastOutput.value = r.outputs[0] ?? ''
      await refreshOutputSize(r.outputs[0])
    }
  } catch {
    /* 错误已由 call 统一提示 */
  }
}

/**
 * 外部带入文件（资源管理器右键唤起、或从别的页面跳转过来）。
 * 只接受 .pdf，其余忽略——工作台只处理 PDF。整体替换当前内容，从头加载。
 */
async function loadFiles(paths: string[]): Promise<void> {
  const pdfs = paths.filter(p => /\.pdf$/i.test(p))
  if (!pdfs.length) return
  renderEpoch++
  renderQueue.length = 0
  thumbQueue.length = 0
  queuedJobs.value = 0
  pageHistory.length = 0
  canUndo.value = false
  await closeAllWbDocs()
  files.value = pdfs.map(p => ({ uid: uidSeq++, path: p }))
  pages.value = []
  lastOutput.value = ''
  enqueueRender(files.value.slice(), null)
}

defineExpose({ pickFiles, loadFiles })
</script>

<template>
  <div
    class="wb"
    :class="{ 'is-file-over': fileDragOver }"
    @dragover.prevent="onFileDragOver"
    @dragenter.prevent="onFileDragOver"
    @dragleave="onFileDragLeave"
    @drop.prevent="onFileDrop"
  >
    <div class="wb-toolbar">
      <el-button type="primary" @click="pickFiles">添加 PDF</el-button>
      <el-button :disabled="!files.length" @click="clearAll">清空</el-button>
      <span class="wb-dim">|</span>
      <span class="wb-stat">
        文件 <b>{{ files.length }}</b> · 页面 <b>{{ pages.length }}</b> · 已选 <b>{{ selectedCount }}</b>
      </span>
      <div class="wb-spacer" />
      <span class="wb-dim">缩略图</span>
      <el-button size="small" class="wb-zoom-btn" @click="zoomStep(-0.1)" title="缩小">−</el-button>
      <el-slider v-model="zoom" :min="0.6" :max="1.8" :step="0.1" style="width: 110px" />
      <el-button size="small" class="wb-zoom-btn" @click="zoomStep(0.1)" title="放大">＋</el-button>
    </div>

    <div v-if="loading" class="wb-loading">
      <span class="wb-spinner" />
      <span>{{ text || '正在载入…' }}</span>
      <span v-if="queuedJobs" class="wb-dim">（还有 {{ queuedJobs }} 批文件在排队）</span>
    </div>

    <div class="wb-body">
      <!-- 左：文件列表 -->
      <aside class="wb-files">
        <div class="wb-panel-title">文件（{{ files.length }}）</div>
        <div v-if="!files.length" class="wb-empty-sm">还没有文件</div>
        <div v-for="(f, i) in files" :key="f.uid" class="wb-file">
          <span class="wb-file-idx">{{ i + 1 }}</span>
          <span class="wb-file-name" :title="f.path">{{ baseName(f.path) }}</span>
          <el-button size="small" link type="danger" :disabled="loading" @click="removeFile(i)">移除</el-button>
        </div>
      </aside>

      <!-- 中：页面缩略图 -->
      <section class="wb-pages">
        <div v-if="!pages.length && !loading" class="wb-empty">
          <p>点击「添加 PDF」开始，或把 PDF 文件直接拖进来</p>
          <p class="wb-dim">加载后可拖拽排序、旋转、删页、提取，最后一次性导出；点击缩略图看大图，里面还能打码 / 涂抹 / 贴图</p>
        </div>
        <div v-else class="wb-grid" :style="{ '--wb-scale': zoom }">
          <div
            v-for="(p, i) in pages"
            :key="p.uid"
            :ref="el => cellRef(el, p)"
            class="wb-cell"
            :class="{ 'is-drag': dragOverIndex === i, 'is-selected': p.selected }"
            draggable="true"
            tabindex="0"
            title="Enter 看大图 · 空格勾选 · Delete 删页 · 拖拽调序"
            @keydown="onCellKey($event, i, p)"
            @dragstart="onDragStart(i, $event)"
            @dragover.prevent="onDragOver(i)"
            @drop.prevent="onDrop(i)"
            @dragend="dragIndex = -1; dragOverIndex = -1"
          >
            <div class="wb-thumb-wrap" title="点击查看大图" @click.stop="openPreview(i)">
              <img
                v-if="p.thumb"
                :src="p.thumb"
                class="wb-thumb"
                :style="{ transform: `rotate(${p.rotate}deg)` }"
                draggable="false"
              />
              <div v-else class="wb-thumb-ph">
                <span class="wb-thumb-ph-num">{{ p.page + 1 }}</span>
              </div>
              <span class="wb-idx">{{ i + 1 }}</span>
              <span v-if="p.crop" class="wb-crop-badge" title="这页已设置裁剪区域">裁</span>
              <span v-if="p.annos && p.annos.length" class="wb-crop-badge wb-anno-badge" title="这页有标注（马赛克/涂抹/贴图）">编</span>
              <span v-if="p.selected" class="wb-check">✓</span>
            </div>
            <div class="wb-cap">
              文件{{ p.source + 1 }} · 第{{ p.page + 1 }}页<template v-if="p.crop"> · 已裁剪</template><template v-if="p.annos && p.annos.length"> · 已标注</template>
            </div>
            <div class="wb-cell-btns">
              <el-checkbox
                class="wb-pick"
                size="small"
                :model-value="p.selected"
                title="勾选后参与批量操作与导出"
                @change="toggleSelect(p.uid)"
              />
              <el-button size="small" @click.stop="rotatePage(p.uid, -90)" title="左转">↺</el-button>
              <el-button size="small" @click.stop="rotatePage(p.uid, 90)" title="右转">↻</el-button>
              <el-button size="small" type="danger" link @click.stop="removePage(p.uid)" title="删除该页">✕</el-button>
            </div>
          </div>
        </div>
      </section>

      <!-- 右：操作与导出 -->
      <aside class="wb-side">
        <div class="wb-panel-title">页面操作</div>
        <el-button size="small" style="width: 100%" :disabled="!canUndo" @click="undo">
          撤销（Ctrl+Z）
        </el-button>
        <el-button size="small" style="width: 100%" @click="selectAll">
          {{ pages.every(p => p.selected) && pages.length ? '取消全选' : '全选' }}
        </el-button>
        <el-button size="small" style="width: 100%" :disabled="!selectedCount" @click="rotateSelected(90)">选中页右转 90°</el-button>
        <el-button size="small" style="width: 100%" :disabled="!selectedCount" @click="rotateSelected(-90)">选中页左转 90°</el-button>
        <div class="wb-move-row">
          <el-button size="small" :disabled="!selectedCount" @click="moveSelectedBy(-1)">前移一位</el-button>
          <el-button size="small" :disabled="!selectedCount" @click="moveSelectedBy(1)">后移一位</el-button>
        </div>
        <el-button size="small" style="width: 100%" :disabled="!selectedCount" @click="moveSelectedToTop">选中页移到最前</el-button>
        <el-button size="small" style="width: 100%" :disabled="!selectedCount" @click="moveSelectedToEnd">选中页移到最后</el-button>
        <el-button size="small" style="width: 100%" :disabled="!selectedCount" @click="removeSelected">删除选中页</el-button>
        <div class="form-item mt-8">
          <label>按页码范围删</label>
          <el-input
            v-model="delRanges"
            size="small"
            placeholder="如 29-48"
            clearable
            @keydown.enter="onDelEnter"
          />
        </div>
        <el-button size="small" style="width: 100%; margin-top: 6px" @click="removeByRanges">删除这些页</el-button>
        <el-button size="small" style="width: 100%" :disabled="pages.length < 2" @click="reverseAll">整体倒序</el-button>

        <div class="wb-panel-title mt-14">导出</div>
        <OutDirPicker :model-value="outDir" file title="选择输出文件夹" @update:model-value="emit('update:outDir', $event)" />
        <div class="form-item mt-8">
          <label>输出文件名</label>
          <el-input v-model="outName" placeholder="留空自动：页面整理_时间戳" size="small" clearable />
        </div>
        <el-button type="primary" :loading="exporting" style="width: 100%; margin-top: 10px" @click="exportPdf">
          导出全部页面（{{ pages.length }}）
        </el-button>
        <el-button :disabled="!selectedCount" style="width: 100%; margin: 8px 0 0" @click="exportSelected">
          仅导出选中页（{{ selectedCount }}）
        </el-button>

        <!-- 大小预估：导出前就知道这一份多大，别等写完盘才发现发不出去 -->
        <div class="wb-size-row">
          <el-button size="small" :loading="estimating" @click="estimateSize">预估大小</el-button>
          <span v-if="estimate" class="wb-size">
            预计 <b>{{ fmtSize(estimate.bytes) }}</b>
            <template v-if="sourceBytes">
              （原 {{ fmtSize(sourceBytes) }}<template v-if="sourceBytes > 0">，
                {{ estimate.bytes <= sourceBytes ? '省' : '增' }}
                {{ Math.abs(Math.round((1 - estimate.bytes / sourceBytes) * 100)) }}%</template>）
            </template>
          </span>
          <span v-else class="wb-size wb-size--dim">改完页面可先估一下体积</span>
        </div>
        <el-alert
          v-if="estimate && estimate.bytes > BIG_BYTES"
          type="warning"
          :closable="false"
          class="mt-6"
          :title="`超过 10 MB，发邮件或上传系统可能受限，建议用下面的压缩导出`"
        />

        <!-- 压缩导出：质量/DPI 越低越小，文字会变模糊，按用途选 -->
        <div class="wb-panel-title mt-12">压缩后导出</div>
        <div class="wb-comp-row">
          <span class="wb-comp-label">质量 {{ compQuality }}%</span>
          <el-slider v-model="compQuality" :min="PDF_COMPRESS_QUALITY_MIN" :max="PDF_COMPRESS_QUALITY_MAX" :step="5" size="small" style="flex: 1" />
        </div>
        <div class="wb-comp-row">
          <span class="wb-comp-label">清晰度 {{ compDpi }} DPI</span>
          <el-slider v-model="compDpi" :min="PDF_COMPRESS_DPI_MIN" :max="PDF_COMPRESS_DPI_MAX" :step="8" size="small" style="flex: 1" />
        </div>
        <el-button
          :loading="compressing"
          style="width: 100%; margin-top: 6px"
          @click="exportCompressed"
        >
          压缩后导出（保留裁剪与标注）
        </el-button>
        <div v-if="compProgress" class="wb-comp-progress">{{ compProgress }}</div>
        <div class="wb-hint mt-6">
          压缩会把页面转成图片重排，文字层会丢失（不能再复制/搜索）；裁剪与标注会一起烧进去。
        </div>
        <div v-if="lastOutput" class="wb-done">
          <el-button size="small" type="primary" plain @click="openOutputDir">打开输出文件夹</el-button>
        </div>
        <div class="wb-hint">
          提示：合并 = 添加多个文件后直接导出；提取 = 勾选后仅导出选中页；删页可勾选也可直接写页码范围。
          新增文件可选插入位置（最前 / 选中页之前 / 最后），同一份文件也能添加多次。
          旋转、裁剪、标注都只影响本次导出，原文件不动。
        </div>
      </aside>
    </div>

    <!-- 插入位置选择：工作台里已有内容时，新文件从哪里插进来 -->
    <el-dialog v-model="insertOpen" title="新文件插入位置" width="400px" append-to-body>
      <p class="wb-insert-tip">本次添加的 {{ pendingPaths.length }} 个文件插到哪里？</p>
      <div class="wb-insert-btns">
        <el-button @click="applyInsert('front')">最前面</el-button>
        <el-button :disabled="!selectedCount" @click="applyInsert('beforeSelected')">
          选中页之前（{{ selectedCount }}）
        </el-button>
        <el-button type="primary" @click="applyInsert('end')">最后面</el-button>
      </div>
      <div class="wb-insert-at" v-if="pages.length">
        <span class="wb-dim">或插到指定页之前</span>
        <el-input-number
          v-model="insertAtPage"
          :min="1"
          :max="insertAtMax"
          :step="1"
          step-strictly
          size="small"
          style="width: 110px"
        />
        <span class="wb-dim">页（共 {{ pages.length }} 页）</span>
        <el-button size="small" @click="applyInsertAtPage">插到该页之前</el-button>
      </div>
    </el-dialog>

    <!-- 页面大图预览：点缩略图打开，←/→ 翻页，可直接对本页操作 -->
    <el-dialog
      v-model="previewOpen"
      :title="previewTitle"
      width="min(1040px, 94vw)"
      top="5vh"
      class="wb-preview-dialog"
      append-to-body
      destroy-on-close
      @close="closePreview"
      @closed="onPreviewClosed"
    >
      <div
        v-loading="previewing"
        class="pv-stage"
        :class="{ 'is-grabbing': stageGrabbing }"
        @wheel.prevent="onPreviewWheel"
        @mousedown="onStagePanDown"
        @mouseup="onCropUp"
        @mouseleave="onCropUp"
      >
        <!-- 画布外包一层紧贴画布的容器：裁剪蒙层以它为定位基准，
             原点才与 cropPoint 用的画布矩形一致（早期蒙层用 inset:12px 挂在舞台上，
             舞台 flex 居中 → 蒙层原点比画布左偏 (舞台宽-画布宽)/2，选框整体左移约 8cm） -->
        <div class="pv-canvas-wrap">
          <canvas
            ref="previewCanvas"
            class="pv-canvas"
            :class="{ 'pv-canvas--cropping': cropMode, 'pv-canvas--editing': annoTool !== 'none' || annoPending }"
            @mousedown.prevent="annos.onDown"
            @mousemove="annos.onMove"
            @mouseup="annos.onUp"
            @mouseleave="annos.onUp"
          />
          <!-- 裁剪蒙层：与画布同原点同尺寸，拖框选区域；进入前已挡掉旋转页 -->
          <div v-if="cropMode" class="pv-crop" @mousedown.prevent="onCropDown" @mousemove.prevent="onCropMove">
            <div class="pv-crop-box" :style="cropBoxStyle">
              <span v-if="cropLabel" class="pv-crop-size">{{ cropLabel }}</span>
            </div>
          </div>
          <!-- 裁完的常驻回显：保留区亮着、裁掉的部分压暗，不用等导出才知道成不成 -->
          <div v-else-if="previewPage?.crop" class="pv-crop-keep" :style="keepStyle">
            <span class="pv-crop-keep-size">{{ keepLabel }}</span>
          </div>
        </div>
        <div v-if="cropMode" class="pv-crop-bar">
          在页面上按住拖动，框出要保留的区域
          <el-button size="small" type="primary" @click="applyCrop">应用裁剪</el-button>
          <el-button size="small" @click="clearCrop">清除裁剪</el-button>
          <el-button size="small" @click="exitCrop">取消</el-button>
        </div>
      </div>
      <template #footer>
        <!-- 图片式编辑工具栏：马赛克/涂抹/框选复制/贴图 + 撤销；控件随当前工具切换 -->
        <div class="pv-tools">
          <el-button size="small" :type="annoTool === 'mosaic' ? 'primary' : 'default'" @click="annos.setTool(annoTool === 'mosaic' ? 'none' : 'mosaic')">马赛克</el-button>
          <el-button size="small" :type="annoTool === 'brush' ? 'primary' : 'default'" @click="annos.setTool(annoTool === 'brush' ? 'none' : 'brush')">涂抹</el-button>
          <el-button size="small" :type="annoTool === 'copy' ? 'primary' : 'default'" @click="annos.setTool(annoTool === 'copy' ? 'none' : 'copy')">框选复制</el-button>
          <el-button size="small" @click="pickStickerFile">贴图…</el-button>
          <el-button size="small" :disabled="!annoCanUndo" @click="annos.undo()">撤销</el-button>
          <el-button size="small" :disabled="!previewAnnoCount" @click="annos.clearAnnos()">清除本页标注</el-button>

          <template v-if="annoTool === 'mosaic'">
            <span class="pv-tool-label">块大小</span>
            <el-slider v-model="annoCell" :min="6" :max="40" :step="1" style="width: 90px" />
          </template>
          <template v-else-if="annoTool === 'brush'">
            <el-color-picker v-model="annoBrushColor" size="small" :predefine="['#111111', '#ffffff', '#e8380c', '#1677ff']" />
            <span class="pv-tool-label">笔宽</span>
            <el-slider v-model="annoBrushWidth" :min="1" :max="12" :step="0.5" style="width: 90px" />
          </template>
          <template v-if="annoSelectedId">
            <span class="pv-tool-label">透明度</span>
            <el-slider
              :model-value="annoStickerOpacity"
              :min="10"
              :max="100"
              style="width: 90px"
              @update:model-value="annos.setSelectedOpacity"
            />
            <el-button size="small" type="danger" link @click="annos.removeSelected()">删除贴图</el-button>
          </template>

          <span v-if="annoPending" class="pv-tool-hint">在页面上点击放置贴图（Esc 取消）</span>
          <span v-else-if="annoTool === 'mosaic'" class="pv-tool-hint">按住拖动，框出要打码的区域</span>
          <span v-else-if="annoTool === 'brush'" class="pv-tool-hint">按住涂抹；Ctrl+Z 撤销，Delete 删除选中贴图</span>
          <span v-else-if="annoTool === 'copy'" class="pv-tool-hint">拖框圈住要复制的内容，然后在页面别处点击放置</span>
          <span v-else-if="annoSelectedId" class="pv-tool-hint">拖动移动贴图，拖右下角小方块等比缩放</span>
        </div>
        <div class="pv-bar">
          <div class="pv-nav">
            <el-button size="small" :disabled="previewIndex <= 0" @click="stepPreview(-1)">← 上一页</el-button>
            <span class="pv-pos">第 {{ previewIndex + 1 }} / {{ pages.length }} 页</span>
            <el-button size="small" :disabled="previewIndex >= pages.length - 1" @click="stepPreview(1)">下一页 →</el-button>
            <span class="pv-zoom-label">缩放</span>
            <el-slider v-model="previewZoom" :min="PREVIEW_ZOOM_MIN" :max="PREVIEW_ZOOM_MAX" :step="0.1" style="width: 104px" />
            <span class="pv-key">← / → 翻页 · 滚轮缩放</span>
          </div>
          <div class="pv-acts">
            <el-button size="small" :type="cropMode ? 'warning' : 'default'" @click="cropMode ? exitCrop() : enterCrop()">
              {{ cropMode ? '退出裁剪' : '裁剪本页' }}
            </el-button>
            <el-button size="small" @click="previewRotate(-90)">左转 90°</el-button>
            <el-button size="small" @click="previewRotate(90)">右转 90°</el-button>
            <el-button size="small" type="primary" plain @click="previewExportOne">提取本页为单独 PDF</el-button>
            <el-button size="small" :disabled="pages.length < 2" @click="previewKeepOnly">只留这一页</el-button>
            <el-button size="small" type="danger" @click="previewDelete">删除本页</el-button>
          </div>
        </div>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
.wb {
  border: 1px solid var(--line);
  border-radius: var(--r-md);
  background: var(--surface);
  box-shadow: var(--shadow-sm);
  overflow: hidden;
}
/* 拖文件悬停时的整框提示：一眼看出松手就能导入 */
.wb.is-file-over {
  outline: 2px dashed var(--accent);
  outline-offset: -2px;
  background: var(--accent-wash);
}
.wb-toolbar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 12px;
  border-bottom: 1px solid var(--line);
  background: var(--surface-2);
  flex-wrap: wrap;
}
.wb-spacer {
  flex: 1;
}
.wb-dim {
  color: var(--text-3);
  font-size: 12px;
}
.wb-stat {
  font-size: 12.5px;
  color: var(--text-2);
}
.wb-stat b {
  color: var(--accent);
  font-family: var(--font-display);
}
.wb-loading {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 14px;
  font-size: 12px;
  color: var(--text-2);
  background: var(--accent-wash);
}
.wb-spinner {
  width: 13px;
  height: 13px;
  border: 2px solid var(--accent);
  border-top-color: transparent;
  border-radius: 50%;
  animation: wb-spin 0.7s linear infinite;
  flex-shrink: 0;
}
@keyframes wb-spin {
  to {
    transform: rotate(360deg);
  }
}
/* 高度必须是「确定值」：max-height 不会给 grid 子项一个确定高度，
   子项 height:auto 时 overflow-y:auto 完全不生效 → 内容溢出且滚不动（48 页只露出前 17 页）。
   配 grid-template-rows:minmax(0,1fr) 后三列才各自独立滚动。 */
.wb-body {
  display: grid;
  grid-template-columns: 190px minmax(0, 1fr) 230px;
  grid-template-rows: minmax(0, 1fr);
  height: clamp(460px, calc(100vh - 250px), 1320px);
}
.wb-files,
.wb-side,
.wb-pages {
  /* grid 子项默认 min-height:auto，会撑破容器导致不滚动 */
  min-height: 0;
}
.wb-files,
.wb-side {
  padding: 12px;
  overflow-y: auto;
  background: var(--surface-2);
}
.wb-files {
  border-right: 1px solid var(--line);
}
.wb-side {
  border-left: 1px solid var(--line);
}
.wb-panel-title {
  font-family: var(--font-display);
  font-size: 11.5px;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--text-3);
  margin-bottom: 8px;
}
.wb-file {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 5px 6px;
  border-radius: var(--r-sm);
  font-size: 12.5px;
}
.wb-file:hover {
  background: var(--surface);
}
.wb-file-idx {
  flex-shrink: 0;
  width: 18px;
  height: 18px;
  border-radius: 50%;
  background: var(--accent);
  color: #fff;
  font-size: 10.5px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-family: var(--font-display);
}
.wb-file-name {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--text-1);
}
.wb-empty-sm {
  font-size: 12px;
  color: var(--text-3);
  padding: 6px;
}
.wb-pages {
  overflow-y: auto;
  padding: 12px;
}.wb-empty {
  text-align: center;
  color: var(--text-2);
  padding: 80px 20px;
  font-size: 13px;
}
.wb-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(calc(118px * var(--wb-scale, 1)), 1fr));
  gap: 10px;
}
.wb-cell {
  border: 1px solid var(--line);
  border-radius: var(--r-sm);
  padding: 5px;
  background: var(--surface);
  cursor: grab;
  transition: border-color 0.15s, box-shadow 0.15s, transform 0.15s;
  user-select: none;
}
.wb-cell:active {
  cursor: grabbing;
}
.wb-cell.is-selected {
  border-color: var(--accent);
  box-shadow: 0 0 0 2px var(--accent-wash);
}
.wb-cell.is-drag {
  border-color: var(--amber);
  border-style: dashed;
  transform: translateY(-2px);
}
.wb-thumb-wrap {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  background: var(--surface-2);
  border-radius: 3px;
  min-height: 120px;
}
.wb-thumb {
  max-width: 100%;
  max-height: 150px;
  transition: transform 0.2s;
  display: block;
}
/* 缩略图未渲染时的占位：进入可视区域才真正画（页多的文件秒开靠它） */
.wb-thumb-ph {
  width: 104px;
  height: 140px;
  display: flex;
  align-items: flex-end;
  justify-content: flex-end;
  background:
    linear-gradient(45deg, var(--surface-2) 25%, transparent 25%, transparent 75%, var(--surface-2) 75%) 0 0 / 14px 14px,
    var(--surface);
}
.wb-thumb-ph-num {
  font-size: 11px;
  color: var(--text-3);
  background: rgba(16, 26, 41, 0.55);
  color: #fff;
  padding: 0 6px;
  border-radius: 6px 0 0 0;
  font-family: var(--font-display);
}
.wb-idx {
  position: absolute;
  left: 4px;
  top: 4px;
  background: rgba(16, 26, 41, 0.72);
  color: #fff;
  font-size: 10px;
  padding: 1px 6px;
  border-radius: 8px;
  font-family: var(--font-display);
}
/* 已设置裁剪的页：右上角小角标，一眼看出导出时哪几页会被裁 */
.wb-crop-badge {
  position: absolute;
  right: 4px;
  top: 4px;
  background: var(--accent);
  color: #fff;
  font-size: 10px;
  padding: 1px 5px;
  border-radius: 8px;
}
.wb-check {
  position: absolute;
  right: 4px;
  top: 4px;
  background: var(--accent);
  color: #fff;
  width: 18px;
  height: 18px;
  border-radius: 50%;
  font-size: 11px;
  display: flex;
  align-items: center;
  justify-content: center;
}
.wb-cap {
  font-size: 10.5px;
  color: var(--text-3);
  text-align: center;
  margin-top: 4px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.wb-cell-btns {
  display: flex;
  justify-content: center;
  gap: 2px;
  margin-top: 3px;
}
.wb-cell-btns :deep(.el-button) {
  padding: 2px 5px;
  height: 22px;
}
.wb-side :deep(.el-button) {
  margin-left: 0;
}
.wb-side :deep(.el-button + .el-button) {
  margin-top: 6px;
}
.wb-done {
  margin-top: 10px;
}
/* 大小预估行：按钮 + 数字，一行放得下就不换行 */
.wb-size-row {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 10px;
  flex-wrap: wrap;
}
.wb-size {
  font-size: 12px;
  color: var(--text-2);
}
.wb-size b {
  color: var(--accent);
  font-family: var(--font-display);
}
.wb-size--dim {
  color: var(--text-3);
}
/* 压缩参数行：标签定宽，滑块占满剩余 */
.wb-comp-row {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 4px;
}
.wb-comp-label {
  font-size: 12px;
  color: var(--text-3);
  width: 96px;
  flex: none;
}
.wb-comp-progress {
  margin-top: 6px;
  font-size: 12px;
  color: var(--text-2);
  font-family: var(--font-display);
}
.wb-hint {
  margin-top: 14px;
  font-size: 11px;
  line-height: 1.7;
  color: var(--text-3);
  border-top: 1px dashed var(--line);
  padding-top: 10px;
}
/* 缩略图可点击看大图：加悬浮提示 */
.wb-thumb-wrap {
  cursor: zoom-in;
}
.wb-thumb-wrap:hover .wb-idx {
  background: var(--accent);
}
.wb-cell-btns {
  align-items: center;
}
.wb-pick {
  margin-right: 2px;
  height: 22px;
}

.wb-cell:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 1px;
}
/* 选中页前移/后移：两个小按钮一行放下 */
.wb-move-row {
  display: flex;
  gap: 6px;
  margin-top: 6px;
}
.wb-move-row :deep(.el-button) {
  flex: 1;
  margin-left: 0;
}
/* 缩略图缩放步进按钮：贴着滑块，视觉上与滑块同高 */
.wb-zoom-btn {
  padding: 4px 8px;
}

/* ---------- 页面大图预览 ---------- */
.wb-preview-dialog :deep(.el-dialog__body) {
  padding: 0;
  background: var(--surface-2);
}
.pv-stage {
  height: min(70vh, 760px);
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: auto;
  padding: 12px;
  /* 画布式平移：滚动条藏掉（拖图代替滚动），放大后不像在滚网页 */
  scrollbar-width: none;
}
.pv-stage::-webkit-scrollbar {
  display: none;
}
.pv-stage.is-grabbing {
  cursor: grabbing;
  user-select: none;
}
.pv-stage.is-grabbing .pv-canvas {
  cursor: grabbing;
}
.pv-canvas {
  display: block;
  box-shadow: 0 2px 14px rgba(8, 14, 24, 0.28);
  background: #fff;
  transition: transform 0.18s;
  /* 默认抓手：暗示可以按住拖动；裁剪/编辑工具激活时由对应规则覆盖成十字 */
  cursor: grab;
}
/* 裁剪中：指针变成十字，页面微微压暗便于看清选区 */
.pv-canvas--cropping {
  cursor: crosshair;
  opacity: 0.92;
}
/* 紧贴画布的定位容器：蒙层与选框都以它为基准，原点/尺寸与画布完全一致。
   line-height:0 去掉行内块基线间隙，避免比画布高出几像素导致再偏移 */
.pv-canvas-wrap {
  position: relative;
  display: inline-block;
  line-height: 0;
}
.pv-crop {
  position: absolute;
  inset: 0;
  cursor: crosshair;
}
/* 蒙层里开洞露出选区（用巨大 box-shadow 盖住四周） */
.pv-crop-box {
  position: absolute;  border: 1.5px dashed var(--accent);
  box-shadow: 0 0 0 9999px rgba(10, 16, 26, 0.38);
  pointer-events: none;
}
.pv-crop-size {
  position: absolute;
  right: 0;
  bottom: -22px;
  font-size: 11px;
  color: #fff;
  background: rgba(16, 26, 41, 0.78);
  border-radius: 3px;
  padding: 1px 6px;
  white-space: nowrap;
}
/* 裁完后的常驻回显：保留区描边 + 裁掉部分压暗（box-shadow 开洞遮四周） */
.pv-crop-keep {
  position: absolute;
  border: 1.5px solid var(--accent);
  box-shadow: 0 0 0 9999px rgba(10, 16, 26, 0.46);
  pointer-events: none;
  z-index: 2;
}
.pv-crop-keep-size {
  position: absolute;
  left: 50%;
  bottom: -22px;
  transform: translateX(-50%);
  font-size: 11px;
  color: #fff;
  background: var(--accent);
  border-radius: 3px;
  padding: 1px 7px;
  white-space: nowrap;
}
.pv-crop-bar {
  position: absolute;
  top: 10px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 3;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 10px;
  border-radius: var(--r-md);
  background: var(--surface);
  border: 1px solid var(--line);
  box-shadow: var(--shadow-sm);
  font-size: 12px;
  color: var(--text-2);
  white-space: nowrap;
}
.pv-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
}
.pv-nav,
.pv-acts {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}
.pv-pos {
  font-size: 12.5px;
  color: var(--text-2);
  min-width: 92px;
  text-align: center;
  font-variant-numeric: tabular-nums;
}
.pv-zoom-label {
  font-size: 12px;
  color: var(--text-3);
  margin-left: 4px;
}
.pv-key {
  font-size: 11px;
  color: var(--text-3);
  border: 1px solid var(--line);
  border-radius: 3px;
  padding: 1px 5px;
}
/* 图片式编辑工具栏（马赛克/涂抹/贴图/撤销） */
.pv-tools {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
  padding: 2px 2px 8px;
}
.pv-tool-label {
  font-size: 12px;
  color: var(--text-3);
  white-space: nowrap;
}
.pv-tool-hint {
  font-size: 11.5px;
  color: var(--text-3);
}
/* 编辑工具激活时画布指针变十字，与裁剪一致的手势语言 */
.pv-canvas--editing {
  cursor: crosshair;
}
/* 已标注页的角标：与「裁」错开位置 */
.wb-anno-badge {
  top: 26px;
  background: var(--amber);
}
/* 插入位置弹窗 */
.wb-insert-tip {
  margin: 0 0 12px;
  font-size: 13px;
  color: var(--text-2);
}
.wb-insert-btns {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}
.wb-insert-at {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 14px;
  padding-top: 12px;
  border-top: 1px dashed var(--line);
  flex-wrap: wrap;
}

</style>
