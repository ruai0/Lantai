<script setup lang="ts">
import { api } from '../utils/ipc'
import { computed, ref } from 'vue'
import { ElMessage } from 'element-plus'
import StepCard from '../components/StepCard.vue'
import FilePickList from '../components/FilePickList.vue'
import OutDirPicker from '../components/OutDirPicker.vue'
import ResultPanel from '../components/ResultPanel.vue'
import { call, callQ } from '../utils/api'
import { openPdf } from '../utils/pdfjs'
import type { PdfSplitMode, PdfToImagesParams, WatermarkColor } from '@shared/types'

const PDF_FILTER = [{ name: 'PDF 文件', extensions: ['pdf'] }]
const IMG_FILTER = [{ name: '图片', extensions: ['jpg', 'jpeg', 'png'] }]

const tab = ref<
  | 'merge'
  | 'split'
  | 'rotate'
  | 'numbers'
  | 'images'
  | 'watermark'
  | 'delpages'
  | 'toimg'
  | 'stamp'
  | 'text'
  | 'compress'
  | 'organize'
>('merge')

const mergeFiles = ref<string[]>([])
const splitFile = ref<string[]>([])
const rotateFile = ref<string[]>([])
const numbersFile = ref<string[]>([])
const imagesFiles = ref<string[]>([])
const watermarkFile = ref<string[]>([])
const delpagesFile = ref<string[]>([])
const toimgFile = ref<string[]>([])
const stampFile = ref<string[]>([])
const stampImagePath = ref<string[]>([])
const stampScale = ref(20)
const stampOpacity = ref(100)
const stampPosition = ref<'center' | 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right'>('center')
const stampRanges = ref('')
const textFile = ref<string[]>([])

const compressFile = ref<string[]>([])
const compDpi = ref(150)
const compQuality = ref(80)
const compResult = ref<{ before: number; after: number } | null>(null)

interface OrgPage {
  source: number
  page: number
  thumb: string
}
const orgFiles = ref<string[]>([])
const orgPages = ref<OrgPage[]>([])
const orgBusy = ref(false)

function fmtMB(bytes: number): string {
  return bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.round(bytes / 1024)} KB`
}

async function pdfjsDoc(path: string) {
  const files = await call(api.readFiles([path]))
  if (!files) return null
  const data = base64ToBytes(files[0].base64)
  const opened = await openPdf(data)
  return { doc: opened.doc, close: opened.close, name: files[0].name }
}

async function runCompress(dir: string): Promise<boolean> {
  const res = await pdfjsDoc(singleOf(compressFile.value))
  if (!res) return false
  const { doc } = res
  if (doc.numPages > 200) {
    await res.close()
    throw new Error(`压缩一次最多 200 页（当前 ${doc.numPages} 页），请先用「拆分」分段处理`)
  }
  const scale = compDpi.value / 72
  const images: string[] = []
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i)
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
  }
  await res.close()
  const out = await call(
    api.pdfBuildFromImages({
      imagesBase64: images,
      outDir: dir,
      nameHint: singleOf(compressFile.value).split(/[\\/]/).pop()?.replace(/\.pdf$/i, '') + '_压缩'
    }),
    undefined
  )
  if (!out) return false
  outputs.value = out.outputs
  const sizes = await call(api.fileSizes([singleOf(compressFile.value), out.outputs[0]]))
  if (sizes) {
    compResult.value = { before: sizes[0].sizeBytes, after: sizes[1].sizeBytes }
  }
  return true
}

async function loadOrgThumbs() {
  orgPages.value = []
  if (!orgFiles.value.length) {
    ElMessage.warning('请先选择 PDF 文件')
    return
  }
  orgBusy.value = true
  try {
    const info = await call(api.pdfPagesInfo({ paths: orgFiles.value }))
    if (!info) return
    for (const [srcIdx, entry] of info.pages.entries()) {
      const res = await pdfjsDoc(orgFiles.value[srcIdx])
      if (!res) continue
      for (let p = 0; p < entry.count; p++) {
        const page = await res.doc.getPage(p + 1)
        const viewport = page.getViewport({ scale: 0.3 })
        const canvas = document.createElement('canvas')
        canvas.width = Math.floor(viewport.width)
        canvas.height = Math.floor(viewport.height)
        const ctx = canvas.getContext('2d')
        if (!ctx) continue
        ctx.fillStyle = '#ffffff'
        ctx.fillRect(0, 0, canvas.width, canvas.height)
        await page.render({ canvas, canvasContext: ctx, viewport }).promise
        orgPages.value.push({ source: srcIdx, page: p, thumb: canvas.toDataURL('image/jpeg', 0.6) })
      }
      await res.close()
    }
    if (!orgPages.value.length) ElMessage.warning('没有读取到任何页面')
  } catch (e) {
    ElMessage.error(e instanceof Error ? e.message : String(e))
  } finally {
    orgBusy.value = false
  }
}

function moveOrg(i: number, delta: number) {
  const j = i + delta
  if (j < 0 || j >= orgPages.value.length) return
  const arr = orgPages.value
  ;[arr[i], arr[j]] = [arr[j], arr[i]]
}

function removeOrg(i: number) {
  orgPages.value.splice(i, 1)
}

async function runOrganize(dir: string): Promise<boolean> {
  if (!orgPages.value.length) {
    ElMessage.warning('没有可输出的页面')
    return false
  }
  const r = await call(
    api.pdfOrganize({
      paths: orgFiles.value,
      order: orgPages.value.map(p => ({ source: p.source, page: p.page })),
      outDir: dir
    }),
    '整理完成'
  )
  if (r) outputs.value = r.outputs
  return !!r
}

const splitMode = ref<PdfSplitMode>('extract')
const ranges = ref('')
const everyN = ref(1)
const angle = ref<90 | 180 | 270>(90)
const rotateRanges = ref('')
const numPosition = ref<'bottom-center' | 'bottom-right' | 'top-right'>('bottom-center')
const numStart = ref(1)
const numFromPage = ref(1)
const wmText = ref('内部资料')
const wmSize = ref(36)
const wmOpacity = ref(20)
const wmRotate = ref(-45)
const wmTile = ref(true)
const wmColor = ref<WatermarkColor>('gray')
const delRanges = ref('')
const imgScale = ref(2)

const outDir = ref('')
const outputs = ref<string[]>([])
const running = ref(false)

function singleOf(v: string[]): string {
  return v[0] ?? ''
}

/** 渲染进程没有 Node 的 Buffer（nodeIntegration 关闭），用 atob 解码 */
function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return bytes
}

async function runToImages(dir: string): Promise<boolean> {
  const res = await pdfjsDoc(singleOf(toimgFile.value))
  if (!res) return false
  const { doc, name } = res
  const base = name.replace(/\.pdf$/i, '')
  try {
    for (let i = 1; i <= doc.numPages; i++) {
      const page = await doc.getPage(i)
      const viewport = page.getViewport({ scale: imgScale.value })
      const canvas = document.createElement('canvas')
      canvas.width = Math.floor(viewport.width)
      canvas.height = Math.floor(viewport.height)
      const ctx = canvas.getContext('2d')
      if (!ctx) throw new Error('无法创建画布')
      await page.render({ canvas, canvasContext: ctx, viewport }).promise
      const b64 = canvas.toDataURL('image/png').split(',')[1] ?? ''
      const r = await call(api.writeBinary({ dir, name: `${base}_第${i}页.png`, base64: b64 }), undefined)
      if (r) outputs.value.push(r.path)
    }
  } finally {
    await res.close()
  }
  return true
}

function bytesToBase64(bytes: Uint8Array): string {
  let bin = ''
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode(...bytes.subarray(i, i + chunk))
  }
  return btoa(bin)
}

async function runExtractText(dir: string): Promise<boolean> {
  const res = await pdfjsDoc(singleOf(textFile.value))
  if (!res) return false
  const { doc, name } = res
  const pages: string[] = []
  try {
    for (let i = 1; i <= doc.numPages; i++) {
      const page = await doc.getPage(i)
      const content = await page.getTextContent()
      let line = ''
      for (const item of content.items) {
        if ('str' in item) {
          line += item.str
          if ('hasEOL' in item && item.hasEOL) line += '\n'
        }
      }
      pages.push(line.trim())
    }
  } finally {
    await res.close()
  }
  const text = pages.join('\n\n').trim()
  if (!text) throw new Error('没有提取到文字（可能是扫描件，需要 OCR）')
  const b64 = bytesToBase64(new TextEncoder().encode(text))
  const base = name.replace(/\.pdf$/i, '')
  const r = await call(api.writeBinary({ dir, name: `${base}.txt`, base64: b64 }), undefined)
  if (r) outputs.value.push(r.path)
  return true
}

async function run() {
  outputs.value = []
  compResult.value = null
  const dir = outDir.value
  if (!dir) {
    ElMessage.warning('请先选择输出文件夹')
    return
  }
  running.value = true
  try {
    if (tab.value === 'merge') {
      if (mergeFiles.value.length < 2) {
        ElMessage.warning('合并至少需要选择两个 PDF')
        return
      }
      const r = await callQ('PDF 合并', () => api.pdfMerge({ paths: mergeFiles.value, outDir: dir }), '合并完成')
      if (r) outputs.value = r.outputs
    } else if (tab.value === 'split') {
      if (!splitFile.value.length) {
        ElMessage.warning('请先选择要拆分的 PDF')
        return
      }
      if (splitMode.value === 'extract' && !ranges.value.trim()) {
        ElMessage.warning('请填写要提取的页码，如 1-3,5')
        return
      }
      const r = await call(
        api.pdfSplit({
          path: singleOf(splitFile.value),
          mode: splitMode.value,
          ranges: ranges.value,
          everyN: everyN.value,
          outDir: dir
        }),
        '拆分完成'
      )
      if (r) outputs.value = r.outputs
    } else if (tab.value === 'rotate') {
      if (!rotateFile.value.length) {
        ElMessage.warning('请先选择要旋转的 PDF')
        return
      }
      const r = await call(
        api.pdfRotate({
          path: singleOf(rotateFile.value),
          angle: angle.value,
          ranges: rotateRanges.value,
          outDir: dir
        }),
        '旋转完成'
      )
      if (r) outputs.value = r.outputs
    } else if (tab.value === 'numbers') {
      if (!numbersFile.value.length) {
        ElMessage.warning('请先选择要加页码的 PDF')
        return
      }
      const r = await call(
        api.pdfPageNumbers({
          path: singleOf(numbersFile.value),
          position: numPosition.value,
          startAt: numStart.value,
          fromPage: numFromPage.value,
          outDir: dir
        }),
        '页码添加完成'
      )
      if (r) outputs.value = r.outputs
    } else if (tab.value === 'images') {
      if (!imagesFiles.value.length) {
        ElMessage.warning('请先选择图片')
        return
      }
      const r = await call(
        api.pdfImagesToPdf({ paths: imagesFiles.value, outDir: dir }),
        '合成完成'
      )
      if (r) outputs.value = r.outputs
    } else if (tab.value === 'watermark') {
      if (!watermarkFile.value.length) {
        ElMessage.warning('请先选择 PDF')
        return
      }
      if (!wmText.value.trim()) {
        ElMessage.warning('请填写水印文字')
        return
      }
      const r = await call(
        api.pdfWatermark({
          path: singleOf(watermarkFile.value),
          text: wmText.value,
          fontSize: wmSize.value,
          opacity: wmOpacity.value / 100,
          rotation: wmRotate.value,
          tile: wmTile.value,
          color: wmColor.value,
          outDir: dir
        }),
        '水印添加完成'
      )
      if (r) outputs.value = r.outputs
    } else if (tab.value === 'delpages') {
      if (!delpagesFile.value.length) {
        ElMessage.warning('请先选择 PDF')
        return
      }
      if (!delRanges.value.trim()) {
        ElMessage.warning('请填写要删除的页码，如 1-3,5')
        return
      }
      const r = await call(
        api.pdfDeletePages({
          path: singleOf(delpagesFile.value),
          ranges: delRanges.value,
          outDir: dir
        }),
        '删除完成'
      )
      if (r) outputs.value = r.outputs
    } else if (tab.value === 'stamp') {
      if (!stampFile.value.length) {
        ElMessage.warning('请先选择 PDF')
        return
      }
      if (!stampImagePath.value.length) {
        ElMessage.warning('请先选择盖章图片（PNG/JPG）')
        return
      }
      const r = await call(
        api.pdfStampImage({
          path: singleOf(stampFile.value),
          imagePath: stampImagePath.value[0],
          scalePercent: stampScale.value,
          opacity: stampOpacity.value / 100,
          position: stampPosition.value,
          ranges: stampRanges.value,
          outDir: dir
        }),
        '盖章完成'
      )
      if (r) outputs.value = r.outputs
    } else if (tab.value === 'toimg') {
      if (!toimgFile.value.length) {
        ElMessage.warning('请先选择 PDF')
        return
      }
      try {
        const ok = await runToImages(dir)
        if (ok) ElMessage.success('转换完成')
      } catch (e) {
        ElMessage.error(e instanceof Error ? e.message : String(e))
      }
    } else if (tab.value === 'compress') {
      if (!compressFile.value.length) {
        ElMessage.warning('请先选择 PDF')
        return
      }
      try {
        const ok = await runCompress(dir)
        if (ok) ElMessage.success('压缩完成')
      } catch (e) {
        ElMessage.error(e instanceof Error ? e.message : String(e))
      }
    } else if (tab.value === 'organize') {
      try {
        await runOrganize(dir)
      } catch (e) {
        ElMessage.error(e instanceof Error ? e.message : String(e))
      }
    } else {
      if (!textFile.value.length) {
        ElMessage.warning('请先选择 PDF')
        return
      }
      try {
        const ok = await runExtractText(dir)
        if (ok) ElMessage.success('提取完成')
      } catch (e) {
        ElMessage.error(e instanceof Error ? e.message : String(e))
      }
    }
  } finally {
    running.value = false
  }
}

const needFileOnly = computed(() => tab.value === 'images')
const hasParams = computed(() =>
  ['split', 'rotate', 'numbers', 'watermark', 'delpages', 'toimg', 'stamp', 'compress', 'organize'].includes(
    tab.value
  )
)
const outStep = computed(() => (hasParams.value ? 3 : 2))
</script>

<template>
  <div>
    <h1 class="page-title">PDF 工具</h1>
    <p class="page-desc">合并 / 拆分 / 旋转 / 页码 / 水印 / 图片转换。加密的 PDF 请先解密再处理。</p>

    <el-tabs v-model="tab" class="pdf-tabs">
      <el-tab-pane label="合并" name="merge" />
      <el-tab-pane label="拆分" name="split" />
      <el-tab-pane label="删除页" name="delpages" />
      <el-tab-pane label="旋转" name="rotate" />
      <el-tab-pane label="页码" name="numbers" />
      <el-tab-pane label="文字水印" name="watermark" />
      <el-tab-pane label="图片盖章" name="stamp" />
      <el-tab-pane label="图片合成" name="images" />
      <el-tab-pane label="PDF转图片" name="toimg" />
      <el-tab-pane label="提取文字" name="text" />
      <el-tab-pane label="PDF压缩" name="compress" />
      <el-tab-pane label="页面整理" name="organize" />
    </el-tabs>

    <StepCard :step="1" title="选择文件">
      <FilePickList
        v-if="tab === 'merge'"
        v-model="mergeFiles"
        :filters="PDF_FILTER"
        button-text="选择多个 PDF"
        title="选择要合并的 PDF（按选择顺序合并）"
      />
      <FilePickList
        v-else-if="tab === 'compress'"
        v-model="compressFile"
        :filters="PDF_FILTER"
        :multiple="false"
        button-text="选择 PDF"
        title="选择要压缩的 PDF"
      />
      <FilePickList
        v-else-if="tab === 'organize'"
        v-model="orgFiles"
        :filters="PDF_FILTER"
        button-text="选择一个或多个 PDF"
        title="选择要整理页面的 PDF（可跨文件调序）"
      />
      <FilePickList
        v-else-if="tab === 'split'"
        v-model="splitFile"
        :filters="PDF_FILTER"
        :multiple="false"
        button-text="选择 PDF"
        title="选择要拆分的 PDF"
      />
      <FilePickList
        v-else-if="tab === 'delpages'"
        v-model="delpagesFile"
        :filters="PDF_FILTER"
        :multiple="false"
        button-text="选择 PDF"
        title="选择要删除页面的 PDF"
      />
      <FilePickList
        v-else-if="tab === 'rotate'"
        v-model="rotateFile"
        :filters="PDF_FILTER"
        :multiple="false"
        button-text="选择 PDF"
        title="选择要旋转的 PDF"
      />
      <FilePickList
        v-else-if="tab === 'numbers'"
        v-model="numbersFile"
        :filters="PDF_FILTER"
        :multiple="false"
        button-text="选择 PDF"
        title="选择要加页码的 PDF"
      />
      <FilePickList
        v-else-if="tab === 'watermark'"
        v-model="watermarkFile"
        :filters="PDF_FILTER"
        :multiple="false"
        button-text="选择 PDF"
        title="选择要加水印的 PDF"
      />
      <FilePickList
        v-else-if="tab === 'images'"
        v-model="imagesFiles"
        :filters="IMG_FILTER"
        button-text="选择图片（JPG/PNG）"
        title="选择要合成 PDF 的图片（按选择顺序每张一页）"
      />
      <FilePickList
        v-else-if="tab === 'stamp'"
        v-model="stampFile"
        :filters="PDF_FILTER"
        :multiple="false"
        button-text="选择 PDF"
        title="选择要盖章的 PDF"
      />
      <FilePickList
        v-else-if="tab === 'text'"
        v-model="textFile"
        :filters="PDF_FILTER"
        :multiple="false"
        button-text="选择 PDF"
        title="选择要提取文字的 PDF"
      />
      <FilePickList
        v-else-if="tab === 'toimg'"
        v-model="toimgFile"
        :filters="PDF_FILTER"
        :multiple="false"
        button-text="选择 PDF"
        title="选择要转为图片的 PDF"
      />
    </StepCard>

    <StepCard v-if="tab === 'stamp'" :step="2" title="盖章设置">
      <div class="form-row">
        <div class="form-item">
          <label>盖章图片</label>
          <FilePickList
            v-model="stampImagePath"
            :filters="[{ name: '图片', extensions: ['png', 'jpg', 'jpeg'] }]"
            :multiple="false"
            button-text="选择图片（建议透明 PNG）"
            title="选择盖章图片"
          />
        </div>
      </div>
      <div class="form-row" style="margin-top: 12px">
        <div class="form-item">
          <label>宽度占比 {{ stampScale }}%</label>
          <el-slider v-model="stampScale" :min="2" :max="100" style="width: 160px" />
        </div>
        <div class="form-item">
          <label>不透明度 {{ stampOpacity }}%</label>
          <el-slider v-model="stampOpacity" :min="10" :max="100" style="width: 160px" />
        </div>
        <div class="form-item">
          <label>位置</label>
          <el-select v-model="stampPosition" style="width: 110px">
            <el-option label="页面居中" value="center" />
            <el-option label="右上角" value="top-right" />
            <el-option label="左上角" value="top-left" />
            <el-option label="右下角" value="bottom-right" />
            <el-option label="左下角" value="bottom-left" />
          </el-select>
        </div>
        <div class="form-item">
          <label>页码（空 = 全部页）</label>
          <el-input v-model="stampRanges" placeholder="如 1" style="width: 140px" clearable />
        </div>
      </div>
      <div class="page-desc" style="margin-top: 8px">适合电子签章、条码贴图等场景；图片按原始宽高比缩放。</div>
    </StepCard>

    <StepCard v-if="tab === 'split'" :step="2" title="拆分方式">
      <div class="form-row">
        <el-radio-group v-model="splitMode">
          <el-radio-button value="extract">提取页码</el-radio-button>
          <el-radio-button value="each">逐页拆分</el-radio-button>
          <el-radio-button value="everyN">按 N 页分卷</el-radio-button>
        </el-radio-group>
      </div>
      <div v-if="splitMode === 'extract'" class="form-row" style="margin-top: 10px">
        <div class="form-item">
          <label>页码范围</label>
          <el-input v-model="ranges" placeholder="如 1-3,5,8-" style="width: 220px" clearable />
        </div>
      </div>
      <div v-if="splitMode === 'everyN'" class="form-row" style="margin-top: 10px">
        <div class="form-item">
          <label>每份页数</label>
          <el-input-number v-model="everyN" :min="1" :max="9999" />
        </div>
      </div>
    </StepCard>

    <StepCard v-if="tab === 'delpages'" :step="2" title="删除页设置">
      <div class="form-row">
        <div class="form-item">
          <label>要删除的页码</label>
          <el-input v-model="delRanges" placeholder="如 1-3,5" style="width: 220px" clearable />
        </div>
      </div>
      <div class="page-desc" style="margin-top: 8px">剩余页面按原顺序另存为新文件，原文件不会改动。</div>
    </StepCard>

    <StepCard v-if="tab === 'rotate'" :step="2" title="旋转设置">
      <div class="form-row">
        <div class="form-item">
          <label>旋转角度</label>
          <el-radio-group v-model="angle">
            <el-radio-button :value="90">90°</el-radio-button>
            <el-radio-button :value="180">180°</el-radio-button>
            <el-radio-button :value="270">270°</el-radio-button>
          </el-radio-group>
        </div>
        <div class="form-item">
          <label>页码（空 = 全部页）</label>
          <el-input v-model="rotateRanges" placeholder="如 1-3,5" style="width: 180px" clearable />
        </div>
      </div>
    </StepCard>

    <StepCard v-if="tab === 'numbers'" :step="2" title="页码设置">
      <div class="form-row">
        <div class="form-item">
          <label>位置</label>
          <el-radio-group v-model="numPosition">
            <el-radio-button value="bottom-center">底部居中</el-radio-button>
            <el-radio-button value="bottom-right">底部右侧</el-radio-button>
            <el-radio-button value="top-right">右上角</el-radio-button>
          </el-radio-group>
        </div>
        <div class="form-item">
          <label>起始编号</label>
          <el-input-number v-model="numStart" :min="0" :max="99999" />
        </div>
        <div class="form-item">
          <label>从第几页开始</label>
          <el-input-number v-model="numFromPage" :min="1" :max="99999" />
        </div>
      </div>
      <div class="page-desc" style="margin-top: 8px">样式为「n / N」数字页码，第 2 页起标注时编号自动顺延。</div>
    </StepCard>

    <StepCard v-if="tab === 'watermark'" :step="2" title="水印设置">
      <div class="form-row">
        <div class="form-item">
          <label>水印文字</label>
          <el-input v-model="wmText" placeholder="如：内部资料 / XX公司专用" style="width: 260px" clearable />
        </div>
        <div class="form-item">
          <label>字号</label>
          <el-input-number v-model="wmSize" :min="8" :max="200" />
        </div>
      </div>
      <div class="form-row" style="margin-top: 10px">
        <div class="form-item">
          <label>不透明度 {{ wmOpacity }}%</label>
          <el-slider v-model="wmOpacity" :min="5" :max="100" style="width: 180px" />
        </div>
        <div class="form-item">
          <label>角度</label>
          <el-input-number v-model="wmRotate" :min="-90" :max="90" :step="15" />
        </div>
        <div class="form-item">
          <label>颜色</label>
          <el-radio-group v-model="wmColor">
            <el-radio-button value="gray">灰色</el-radio-button>
            <el-radio-button value="red">红色</el-radio-button>
            <el-radio-button value="blue">蓝色</el-radio-button>
          </el-radio-group>
        </div>
        <div class="form-item">
          <label>布局</label>
          <el-switch v-model="wmTile" active-text="平铺" inactive-text="居中单枚" />
        </div>
      </div>
    </StepCard>

    <StepCard v-if="tab === 'toimg'" :step="2" title="清晰度">
      <div class="form-row">
        <div class="form-item">
          <label>缩放倍数</label>
          <el-radio-group v-model="imgScale">
            <el-radio-button :value="1">1x（72dpi）</el-radio-button>
            <el-radio-button :value="2">2x（约144dpi）</el-radio-button>
            <el-radio-button :value="3">3x（约216dpi）</el-radio-button>
          </el-radio-group>
        </div>
      </div>
      <div class="page-desc" style="margin-top: 8px">每页导出一张 PNG；页数较多时耗时较长，请耐心等待。</div>
    </StepCard>

    <StepCard v-if="tab === 'compress'" :step="2" title="压缩设置">
      <div class="form-row">
        <div class="form-item">
          <label>输出分辨率</label>
          <el-radio-group v-model="compDpi">
            <el-radio-button :value="120">120dpi 更省</el-radio-button>
            <el-radio-button :value="150">150dpi 推荐</el-radio-button>
            <el-radio-button :value="200">200dpi 清晰</el-radio-button>
          </el-radio-group>
        </div>
        <div class="form-item">
          <label>图片质量 {{ compQuality }}%</label>
          <el-slider v-model="compQuality" :min="40" :max="95" style="width: 160px" />
        </div>
      </div>
      <el-alert
        type="info"
        :closable="false"
        show-icon
        style="margin-top: 10px"
        title="原理：把每页重新渲染为图片后重建 PDF。对扫描版 / 图片型 PDF 效果最好；文字型 PDF 会栅格化，文字将不可复制、也不宜打印放大。"
      />
    </StepCard>

    <StepCard v-if="tab === 'organize'" :step="2" title="页面重排">
      <div class="form-row">
        <el-button type="primary" plain :loading="orgBusy" @click="loadOrgThumbs">载入页面缩略图</el-button>
        <span class="page-desc">默认按选择顺序排列；用 ↑ ↓ 调整，✕ 移除，跨文件可任意调序。</span>
      </div>
      <div v-if="orgPages.length" class="org-grid">
        <div v-for="(pg, i) in orgPages" :key="`${pg.source}-${pg.page}-${i}`" class="org-cell">
          <img :src="pg.thumb" class="org-thumb" />
          <div class="org-cap">文件{{ pg.source + 1 }} · 第{{ pg.page + 1 }}页</div>
          <div class="org-btns">
            <el-button size="small" :disabled="i === 0" @click="moveOrg(i, -1)">↑</el-button>
            <el-button size="small" :disabled="i === orgPages.length - 1" @click="moveOrg(i, 1)">↓</el-button>
            <el-button size="small" type="danger" link @click="removeOrg(i)">✕</el-button>
          </div>
        </div>
      </div>
    </StepCard>

    <StepCard :step="outStep" title="输出位置">
      <OutDirPicker v-model="outDir" />
    </StepCard>

    <StepCard :step="outStep + 1" title="执行">
      <el-button type="primary" :loading="running" @click="run">
        {{
          {
            merge: '开始合并',
            split: '开始拆分',
            delpages: '开始删除',
            rotate: '开始旋转',
            numbers: '开始添加页码',
            watermark: '开始添加水印',
            stamp: '开始盖章',
            images: '开始合成 PDF',
            toimg: '开始转换',
            text: '开始提取',
            compress: '开始压缩',
            organize: '应用整理'
          }[tab]
        }}
      </el-button>
      <ResultPanel :outputs="outputs" />
      <el-alert
        v-if="tab === 'compress' && compResult"
        type="success"
        :closable="false"
        show-icon
        style="margin-top: 12px"
        :title="`原大小 ${fmtMB(compResult.before)} → 新大小 ${fmtMB(compResult.after)}（节省 ${Math.max(0, Math.round((1 - compResult.after / compResult.before) * 100))}%）`"
      />
    </StepCard>
  </div>
</template>

<style scoped>
.pdf-tabs {
  margin-bottom: 10px;
}
.org-grid {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  margin-top: 12px;
}
.org-cell {
  width: 120px;
  border: 1px solid #dcdfe6;
  border-radius: 6px;
  padding: 6px;
  text-align: center;
  background: #fff;
}
.org-thumb {
  width: 100%;
  height: 150px;
  object-fit: contain;
  background: #f5f7fa;
}
.org-cap {
  font-size: 12px;
  color: #909399;
  margin-top: 4px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.org-btns {
  margin-top: 4px;
}
</style>
