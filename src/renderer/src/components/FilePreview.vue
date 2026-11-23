<script setup lang="ts">
/**
 * 应用内文件预览弹窗：PDF 逐页渲染（pdf.js，上限 30 页）、图片直显、
 * 其余类型引导用系统程序打开。ResultPanel 与 TaskDock 共用。
 */
import { computed, ref, watch } from 'vue'
import { basename } from '../utils/api'
import { api } from '../utils/ipc'

const props = defineProps<{ path: string }>()
const open = defineModel<boolean>('open', { default: false })

type PreviewKind = 'pdf' | 'image' | 'other'

const IMAGE_EXTS = /\.(png|jpe?g|bmp|gif|webp)$/i

const kind = computed<PreviewKind>(() => {
  if (/\.pdf$/i.test(props.path)) return 'pdf'
  if (IMAGE_EXTS.test(props.path)) return 'image'
  return 'other'
})
const title = computed(() => (props.path ? basename(props.path) : '预览'))

const previewing = ref(false)
const note = ref('')
const pdfStage = ref<HTMLElement | null>(null)
const imageSrc = ref('')
/** 渲染世代号：关弹窗/换文件时让进行中的逐页渲染尽快停下 */
let token = 0
let opened: { close: () => Promise<void> } | null = null

/** PDF 预览最多渲染的页数：防止几百页的文档把 DOM 和内存吃满 */
const PREVIEW_PAGE_LIMIT = 30

/** pdf.js 体积大，只在真的预览 PDF 时才动态加载（与其他页签共享同一分块） */
async function loadPdfjs() {
  return import('../utils/pdfjs')
}

watch([open, () => props.path], ([o]) => {
  if (!o) return
  note.value = ''
  imageSrc.value = ''
  if (kind.value === 'image') void renderImage()
  else if (kind.value === 'pdf') void renderPdf()
})

async function renderImage(): Promise<void> {
  const r = await api.readFiles([props.path])
  if (!r.ok) {
    note.value = r.error
    return
  }
  const lower = props.path.toLowerCase()
  const mime = lower.endsWith('.png')
    ? 'image/png'
    : lower.endsWith('.webp')
      ? 'image/webp'
      : lower.endsWith('.bmp')
        ? 'image/bmp'
        : lower.endsWith('.gif')
          ? 'image/gif'
          : 'image/jpeg'
  imageSrc.value = `data:${mime};base64,${r.data[0].base64}`
}

async function renderPdf(): Promise<void> {
  const t = ++token
  previewing.value = true
  try {
    const { openPdf, readPdfBytes } = await loadPdfjs()
    const o = await openPdf(await readPdfBytes(props.path))
    if (t !== token) {
      await o.close()
      return
    }
    opened = o
    const stage = pdfStage.value
    if (!stage) return
    stage.innerHTML = ''
    const total = o.doc.numPages
    const limit = Math.min(total, PREVIEW_PAGE_LIMIT)
    note.value = total > PREVIEW_PAGE_LIMIT ? `共 ${total} 页，预览只显示前 ${PREVIEW_PAGE_LIMIT} 页` : ''
    const dpr = window.devicePixelRatio || 1
    for (let pn = 1; pn <= limit; pn++) {
      if (t !== token) return
      const page = await o.doc.getPage(pn)
      const natural = page.getViewport({ scale: 1 })
      // 适配弹窗宽度，高分屏乘 dpr 保证不糊
      const availW = Math.max(320, (stage.clientWidth || 760) - 16)
      const scale = Math.min(2, availW / natural.width) * dpr
      const vp = page.getViewport({ scale })
      const canvas = document.createElement('canvas')
      canvas.width = Math.floor(vp.width)
      canvas.height = Math.floor(vp.height)
      canvas.style.width = `${Math.floor(vp.width / dpr)}px`
      canvas.style.height = `${Math.floor(vp.height / dpr)}px`
      const ctx = canvas.getContext('2d')
      if (!ctx) continue
      ctx.fillStyle = '#ffffff'
      ctx.fillRect(0, 0, canvas.width, canvas.height)
      await page.render({ canvas, canvasContext: ctx, viewport: vp }).promise
      if (t !== token) return
      const wrap = document.createElement('div')
      wrap.className = 'fp-pdf-page'
      const label = document.createElement('span')
      label.className = 'fp-pdf-page-num'
      label.textContent = String(pn)
      wrap.appendChild(canvas)
      wrap.appendChild(label)
      stage.appendChild(wrap)
      page.cleanup()
    }
  } catch (e) {
    if (t === token) note.value = e instanceof Error ? e.message : String(e)
  } finally {
    if (t === token) previewing.value = false
  }
}

function onClosed(): void {
  token++
  const stage = pdfStage.value
  if (stage) stage.innerHTML = ''
  imageSrc.value = ''
  note.value = ''
  const stale = opened
  opened = null
  if (stale) void stale.close()
}

function openWithSystem(): void {
  void api.openPath(props.path)
}
</script>

<template>
  <el-dialog
    v-model="open"
    :title="title"
    width="min(880px, 92vw)"
    top="4vh"
    append-to-body
    destroy-on-close
    @closed="onClosed"
  >
    <div v-loading="previewing" class="fp-stage">
      <div v-show="kind === 'pdf'" ref="pdfStage" class="fp-pdf-stage" />
      <img v-if="kind === 'image' && imageSrc" :src="imageSrc" class="fp-image" />
      <div v-if="kind === 'other'" class="fp-fallback">
        <p>该文件类型不支持内置预览。</p>
        <el-button type="primary" plain @click="openWithSystem">用系统程序打开</el-button>
      </div>
    </div>
    <div v-if="note" class="fp-note">{{ note }}</div>
  </el-dialog>
</template>

<style scoped>
/* 预览舞台：竖向滚动，PDF 页与图片居中 */
.fp-stage {
  min-height: 200px;
  max-height: 72vh;
  overflow-y: auto;
  background: var(--surface-2);
  border-radius: var(--r-sm);
  padding: 8px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
}
.fp-pdf-stage {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
  width: 100%;
}
.fp-pdf-page {
  position: relative;
  line-height: 0;
  box-shadow: 0 2px 10px rgba(8, 14, 24, 0.2);
  background: #fff;
}
.fp-pdf-page-num {
  position: absolute;
  left: 0;
  top: 0;
  background: rgba(16, 26, 41, 0.72);
  color: #fff;
  font-size: 10.5px;
  padding: 1px 6px;
  border-radius: 0 0 6px 0;
  line-height: 1.5;
}
.fp-image {
  max-width: 100%;
  max-height: 70vh;
  object-fit: contain;
  background: #fff;
  box-shadow: 0 2px 10px rgba(8, 14, 24, 0.2);
}
.fp-fallback {
  padding: 40px 20px;
  text-align: center;
  color: var(--text-2);
  font-size: 13px;
}
.fp-fallback .el-button {
  margin-top: 10px;
}
.fp-note {
  margin-top: 6px;
  font-size: 12px;
  color: var(--text-3);
}
</style>
