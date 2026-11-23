<script setup lang="ts">
import { api } from '../utils/ipc'
import { computed, nextTick, onMounted, ref, useTemplateRef, watch } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import StepCard from '../components/StepCard.vue'
import FilePickList from '../components/FilePickList.vue'
import OutDirPicker from '../components/OutDirPicker.vue'
import ResultPanel from '../components/ResultPanel.vue'
import PdfWorkbench from '../components/PdfWorkbench.vue'
import { call, callQ } from '../utils/api'
import { useEnterSubmit } from '../utils/useEnterSubmit'
import { useShellFiles } from '../utils/shellIntent'
import { useReadyGate } from '../utils/useReadyGate'
import { PDF_COMPRESS_DEFAULT_DPI, PDF_COMPRESS_DEFAULT_QUALITY } from '@shared/pdfCompress'
import { useRemembered } from '../utils/useRememberedParams'
import { openPdf } from '../utils/pdfjs'
import type { PdfSplitMode, WatermarkColor } from '@shared/types'
import { splitOutputTarget } from '@shared/namePattern'
/** 填完参数按 Enter 直接执行（主按钮已标 data-primary-action） */
useEnterSubmit()

/** 工作台实例：从资源管理器右键唤起时把文件直接塞进去 */
const wbRef = useTemplateRef<{ loadFiles(p: string[]): Promise<void> }>('wbRef')
const { take: takeShellFiles } = useShellFiles()

onMounted(async () => {
  // 等一帧让工作台先挂载，再灌文件
  await nextTick()
  const incoming = takeShellFiles()
  if (incoming.length) await wbRef.value?.loadFiles(incoming)
})
const PDF_FILTER = [{ name: 'PDF 文件', extensions: ['pdf'] }]
const IMG_FILTER = [{ name: '图片', extensions: ['jpg', 'jpeg', 'png'] }]
const tab = ref<
  | 'workbench'
  | 'split'
  | 'numbers'
  | 'images'
  | 'watermark'
  | 'toimg'
  | 'stamp'
  | 'text'
  | 'compress'
  | 'meta'
  | 'resize'
  | 'hf'
  | 'extract'
  | 'batch'
>('workbench')
const splitFile = ref<string[]>([])
const numbersFile = ref<string[]>([])
const imagesFiles = ref<string[]>([])
const imagesName = ref('')
const imagesFit = ref<'a4' | 'none'>('a4')
const watermarkFile = ref<string[]>([])
const toimgFile = ref<string[]>([])
const stampFile = ref<string[]>([])
const stampImagePath = ref<string[]>([])
const stampScale = ref(20)
const stampOpacity = ref(100)
const stampPosition = ref<'center' | 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right'>('center')
const stampRanges = ref('')
const textFile = ref<string[]>([])
const compressFile = ref<string[]>([])
const compDpi = ref(PDF_COMPRESS_DEFAULT_DPI)
const compQuality = ref(PDF_COMPRESS_DEFAULT_QUALITY)
const compResult = ref<{ before: number; after: number } | null>(null)
const compCancelled = ref(false)
const compProgress = ref('')
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
  const scale = compDpi.value / 72
  const images: string[] = []
  compCancelled.value = false
  try {
    for (let i = 1; i <= doc.numPages; i++) {
      if (compCancelled.value) throw new Error('已取消压缩')
      compProgress.value = `正在压缩：第 ${i} / ${doc.numPages} 页`
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
      // 让出主线程，避免大文档压缩时界面完全卡死
      if (i % 3 === 0) await new Promise(r => setTimeout(r, 0))
    }
  } finally {
    compProgress.value = ''
    await res.close()
  }
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
const splitMode = ref<PdfSplitMode>('extract')
const ranges = ref('')
const everyN = ref(1)
const splitOverwrite = ref(false)
const numPosition = ref<'bottom-center' | 'bottom-right' | 'bottom-left' | 'top-right' | 'top-center' | 'top-left'>('bottom-center')
const numStart = ref(1)
const numFromPage = ref(1)
const numFontSize = ref(9)
const numColor = ref('#595959')
const numFormat = ref('{n} / {total}')
const numMargin = ref(20)
const wmText = ref('内部资料')
const wmSize = ref(36)
const wmOpacity = ref(20)
const wmRotate = ref(-45)
const wmTile = ref(true)
const wmColor = ref<WatermarkColor>('gray')
const imgScale = ref(2)
/* ---------- 元数据 / 匿名化 ---------- */
const metaFile = ref<string[]>([])
const metaInfo = ref<import('@shared/types').PdfMetaInfo | null>(null)
const metaTitle = ref('')
const metaAuthor = ref('')
const metaSubject = ref('')
const metaKeywords = ref('')
/* ---------- 页面尺寸 ---------- */
const resizeFiles = ref<string[]>([])
const resizePreset = ref<import('@shared/types').PdfResizePreset>('a4')
const resizeWidth = ref(595)
const resizeHeight = ref(842)
const resizeScale = ref(1)
const resizeKeepRatio = ref(true)
const resizeOrientation = ref<'portrait' | 'landscape' | 'auto'>('auto')
const resizeBg = ref('#ffffff')
/* ---------- 页眉页脚 ---------- */
const hfFiles = ref<string[]>([])
const hfHeader = ref('')
const hfFooter = ref('{文件名}  第 {页码} 页 / 共 {总页数} 页')
const hfSize = ref(9)
const hfAlign = ref<'left' | 'center' | 'right'>('center')
const hfMargin = ref(28)
const hfFromPage = ref(1)
const hfColor = ref('#555555')
/* ---------- 提取图片 ---------- */
const extractFile = ref<string[]>([])
const extractMin = ref(48)
const extractInfo = ref<{ count: number; skipped: number; pages: number } | null>(null)
/* ---------- 批量处理 ---------- */
const batchFiles = ref<string[]>([])
const batchAction = ref<import('@shared/types').PdfBatchAction>('watermark')
const batchWmText = ref('内部资料')
const batchWmSize = ref(36)
const batchWmOpacity = ref(20)
const batchWmRotate = ref(-45)
const batchAngle = ref<90 | 180 | 270>(90)
const batchNumStart = ref(1)
const batchNumPos = ref<'bottom-center' | 'bottom-right' | 'top-right'>('bottom-center')
const batchHeader = ref('')
const batchFooter = ref('第 {页码} 页 / 共 {总页数} 页')
const batchFontSize = ref(9)
const batchHfAlign = ref<'left' | 'center' | 'right'>('center')
const batchHfMargin = ref(24)
const batchHfFrom = ref(1)
const batchNumFrom = ref(1)
const batchFailed = ref<Array<{ name: string; reason: string }>>([])
/** 选中元数据用的 PDF 时，回读其现有信息并填入表单 */
watch(metaFile, async () => {
  metaInfo.value = null
  if (!metaFile.value.length) return
  const r = await call(api.pdfReadMeta({ path: metaFile.value[0] }), undefined)
  if (!r) return
  metaInfo.value = r
  metaTitle.value = r.title
  metaAuthor.value = r.author
  metaSubject.value = r.subject
  metaKeywords.value = r.keywords
})
/** 匿名化：一键抹掉作者 / 制作软件 / 时间戳等隐私字段 */
async function runStripMeta() {
  if (!metaFile.value.length) {
    ElMessage.warning('请先选择 PDF')
    return
  }
  const { dir } = splitOutputTarget(outDir.value)
  if (!dir) {
    ElMessage.warning('请选择输出文件夹')
    return
  }
  running.value = true
  try {
    const r = await call(
      api.pdfWriteMeta({
        paths: metaFile.value,
        outDir: dir,
        title: '',
        author: '',
        subject: '',
        keywords: '',
        clear: true
      }),
      '元数据已清除'
    )
    if (r) outputs.value = r.outputs
  } finally {
    running.value = false
  }
}
const outDir = ref('')
const wbOutDir = ref('')
const outputs = ref<string[]>([])
const running = ref(false)
/* 参数记忆：记住页签与各页的结构性参数（模式、角度、字号、位置、模板文本等）。
   文件列表与页码范围不记（前者会失效，后者每次不同）。 */
useRemembered('pdf', 'tab', tab)
// 图片转 PDF / 转图片
useRemembered('pdf', 'imagesFit', imagesFit)
useRemembered('pdf', 'imgScale', imgScale)
// 盖章
useRemembered('pdf', 'stampScale', stampScale)
useRemembered('pdf', 'stampOpacity', stampOpacity)
useRemembered('pdf', 'stampPosition', stampPosition)
// 压缩
useRemembered('pdf', 'compDpi', compDpi)
useRemembered('pdf', 'compQuality', compQuality)
// 拆分 / 旋转
useRemembered('pdf', 'splitMode', splitMode)
useRemembered('pdf', 'everyN', everyN)
// 页码
useRemembered('pdf', 'numPosition', numPosition)
useRemembered('pdf', 'numStart', numStart)
useRemembered('pdf', 'numFromPage', numFromPage)
useRemembered('pdf', 'numFontSize', numFontSize)
useRemembered('pdf', 'numColor', numColor)
useRemembered('pdf', 'numFormat', numFormat)
useRemembered('pdf', 'numMargin', numMargin)
// 水印
useRemembered('pdf', 'wmText', wmText)
useRemembered('pdf', 'wmSize', wmSize)
useRemembered('pdf', 'wmOpacity', wmOpacity)
useRemembered('pdf', 'wmRotate', wmRotate)
useRemembered('pdf', 'wmTile', wmTile)
useRemembered('pdf', 'wmColor', wmColor)
// 页面尺寸
useRemembered('pdf', 'resizePreset', resizePreset)
useRemembered('pdf', 'resizeWidth', resizeWidth)
useRemembered('pdf', 'resizeHeight', resizeHeight)
useRemembered('pdf', 'resizeScale', resizeScale)
useRemembered('pdf', 'resizeKeepRatio', resizeKeepRatio)
useRemembered('pdf', 'resizeOrientation', resizeOrientation)
useRemembered('pdf', 'resizeBg', resizeBg)
// 页眉页脚
useRemembered('pdf', 'hfHeader', hfHeader)
useRemembered('pdf', 'hfFooter', hfFooter)
useRemembered('pdf', 'hfSize', hfSize)
useRemembered('pdf', 'hfAlign', hfAlign)
useRemembered('pdf', 'hfMargin', hfMargin)
useRemembered('pdf', 'hfColor', hfColor)
// 提取图片
useRemembered('pdf', 'extractMin', extractMin)
// 批量
useRemembered('pdf', 'batchAction', batchAction)
useRemembered('pdf', 'batchWmText', batchWmText)
useRemembered('pdf', 'batchWmSize', batchWmSize)
useRemembered('pdf', 'batchWmOpacity', batchWmOpacity)
useRemembered('pdf', 'batchWmRotate', batchWmRotate)
useRemembered('pdf', 'batchAngle', batchAngle)
useRemembered('pdf', 'batchNumStart', batchNumStart)
useRemembered('pdf', 'batchNumPos', batchNumPos)
useRemembered('pdf', 'batchFooter', batchFooter)
useRemembered('pdf', 'batchFontSize', batchFontSize)
useRemembered('pdf', 'batchHfAlign', batchHfAlign)
useRemembered('pdf', 'batchHfMargin', batchHfMargin)
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
  const { dir, name: pathName } = splitOutputTarget(outDir.value)
  if (!dir) {
    ElMessage.warning('请在输出位置填写或选择输出文件夹')
    return
  }
  running.value = true
  try {
    if (tab.value === 'split') {
      if (!splitFile.value.length) {
        ElMessage.warning('请先选择要拆分的 PDF')
        return
      }
      if (splitMode.value === 'extract' && !ranges.value.trim()) {
        ElMessage.warning('请填写要提取的页码，如 1-3,5')
        return
      }
      if (splitMode.value === 'extract' && splitOverwrite.value) {
        try {
          await ElMessageBox.confirm(
            '提取结果将直接覆盖原文件（原文件会先备份为 .bak）。请确认你已保留其他副本，是否继续？',
            '确认覆盖原文件',
            { type: 'warning', confirmButtonText: '覆盖原文件', cancelButtonText: '取消' }
          )
        } catch {
          return
        }
      }
      const r = await callQ(
        'PDF 拆分',
        () =>
          api.pdfSplit({
            path: singleOf(splitFile.value),
            mode: splitMode.value,
            ranges: ranges.value,
            everyN: everyN.value,
            overwrite: splitMode.value === 'extract' ? splitOverwrite.value : false,
            outDir: dir
          }),
        '拆分完成'
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
          fontSize: numFontSize.value,
          color: numColor.value,
          format: numFormat.value,
          margin: numMargin.value,
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
      const r = await callQ(
        '图片转 PDF',
        () =>
          api.pdfImagesToPdf({
            paths: imagesFiles.value,
            outDir: dir,
            name: imagesName.value.trim() || pathName,
            fit: imagesFit.value
          }),
        '转换完成'
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
    } else if (tab.value === 'meta') {
      if (!metaFile.value.length) {
        ElMessage.warning('请先选择 PDF')
        return
      }
      const r = await call(
        api.pdfWriteMeta({
          paths: metaFile.value,
          outDir: dir,
          title: metaTitle.value,
          author: metaAuthor.value,
          subject: metaSubject.value,
          keywords: metaKeywords.value,
          clear: false
        }),
        '元数据写入完成'
      )
      if (r) outputs.value = r.outputs
    } else if (tab.value === 'resize') {
      if (!resizeFiles.value.length) {
        ElMessage.warning('请先选择 PDF')
        return
      }
      const r = await call(
        api.pdfResize({
          paths: resizeFiles.value,
          outDir: dir,
          preset: resizePreset.value,
          width: resizeWidth.value,
          height: resizeHeight.value,
          scale: resizeScale.value,
          background: resizeBg.value,
          keepRatio: resizeKeepRatio.value,
          orientation: resizeOrientation.value
        }),
        '页面尺寸调整完成'
      )
      if (r) outputs.value = r.outputs
    } else if (tab.value === 'hf') {
      if (!hfFiles.value.length) {
        ElMessage.warning('请先选择 PDF')
        return
      }
      if (!hfHeader.value.trim() && !hfFooter.value.trim()) {
        ElMessage.warning('请填写页眉或页脚')
        return
      }
      const r = await call(
        api.pdfHeaderFooter({
          paths: hfFiles.value,
          outDir: dir,
          header: hfHeader.value,
          footer: hfFooter.value,
          fontSize: hfSize.value,
          align: hfAlign.value,
          margin: hfMargin.value,
          fromPage: hfFromPage.value,
          color: hfColor.value
        }),
        '页眉页脚添加完成'
      )
      if (r) outputs.value = r.outputs
    } else if (tab.value === 'extract') {
      if (!extractFile.value.length) {
        ElMessage.warning('请先选择 PDF')
        return
      }
      extractInfo.value = null
      const r = await call(
        api.pdfExtractImages({ path: singleOf(extractFile.value), outDir: dir, minSize: extractMin.value }),
        undefined
      )
      if (!r) return
      outputs.value = r.outputs
      extractInfo.value = { count: r.count, skipped: r.skipped, pages: r.pages }
      if (r.count) ElMessage.success(`导出 ${r.count} 张图片`)
      else ElMessage.warning('没有找到可导出的图片')
    } else if (tab.value === 'batch') {
      if (!batchFiles.value.length) {
        ElMessage.warning('请先选择 PDF')
        return
      }
      batchFailed.value = []
      const action = batchAction.value
      const common = { paths: batchFiles.value, outDir: dir }
      let params: import('@shared/types').PdfBatchParams
      if (action === 'watermark') {
        if (!batchWmText.value.trim()) {
          ElMessage.warning('请填写水印文字')
          return
        }
        params = {
          ...common,
          action,
          watermarkText: batchWmText.value,
          watermarkFontSize: batchWmSize.value,
          watermarkOpacity: batchWmOpacity.value / 100,
          watermarkRotation: batchWmRotate.value,
          watermarkTile: true,
          watermarkColor: 'gray'
        }
      } else if (action === 'numbers') {
        params = { ...common, action, startAt: batchNumStart.value, position: batchNumPos.value, fromPage: batchNumFrom.value }
      } else if (action === 'headerFooter') {
        params = {
          ...common,
          action,
          header: batchHeader.value,
          footer: batchFooter.value,
          fontSize: batchFontSize.value,
          align: batchHfAlign.value,
          margin: batchHfMargin.value,
          fromPage: batchHfFrom.value
        }
      } else if (action === 'rotate') {
        params = { ...common, action, angle: batchAngle.value }
      } else {
        params = { ...common, action }
      }
      const r = await callQ('PDF 批量处理', () => api.pdfBatch(params), '批量处理完成')
      if (r) {
        outputs.value = r.outputs
        batchFailed.value = r.failed
        if (r.failed.length) ElMessage.warning(`${r.outputs.length} 个成功，${r.failed.length} 个失败`)
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
/** 需要「输出位置」这一步的页签（工作台自带导出区，不在此列） */
const hasParams = computed(() =>
  [
    'split',
    'numbers',
    'watermark',
    'toimg',
    'stamp',
    'compress',
    'meta',
    'resize',
    'hf',
    'extract',
    'batch',
    'images'
  ].includes(tab.value)
)
/** 「输出位置」的步骤号：选择(1) → 设置(2) → 输出(3)；没有设置卡片的页签则前移一位 */
const outStep = computed(() => (hasParams.value ? 3 : 2))

/**
 * 当前页签的「必填文件」：没选文件就把主按钮置灰并说明缺什么，
 * 不必点下去才弹「请先选择 PDF」。工作台有自己的交互，不在此列。
 */
const tabFiles = computed<string[]>(() => {
  switch (tab.value) {
    case 'split':
      return splitFile.value
    case 'numbers':
      return numbersFile.value
    case 'images':
      return imagesFiles.value
    case 'watermark':
      return watermarkFile.value
    case 'toimg':
      return toimgFile.value
    case 'stamp':
      return stampFile.value
    case 'text':
      return textFile.value
    case 'compress':
      return compressFile.value
    case 'meta':
      return metaFile.value
    case 'resize':
      return resizeFiles.value
    case 'hf':
      return hfFiles.value
    case 'extract':
      return extractFile.value
    case 'batch':
      return batchFiles.value
    default:
      return []
  }
})

const { blocked: runBlocked, reason: runBlockedReason } = useReadyGate(() => [
  { label: 'PDF 文件', ok: tabFiles.value.length > 0 }
])
</script>
<template>
  <div>
    <h1 class="page-title">PDF 工具</h1>
    <p class="page-desc">工作台把合并 / 拆页 / 调序 / 删页 / 旋转 / 提取收在一处：添加 PDF 后在缩略图上直接操作、一次导出。带权限密码（无打开密码）的 PDF 导出时自动解密；同一份文件可多次添加，新文件可选插入位置。</p>
    <el-tabs v-model="tab" class="pdf-tabs">
      <el-tab-pane label="工作台" name="workbench" />
      <el-tab-pane label="拆分" name="split" />
      <el-tab-pane label="页码" name="numbers" />
      <el-tab-pane label="水印" name="watermark" />
      <el-tab-pane label="盖章" name="stamp" />
      <el-tab-pane label="页眉页脚" name="hf" />
      <el-tab-pane label="图片转 PDF" name="images" />
      <el-tab-pane label="PDF 转图片" name="toimg" />
      <el-tab-pane label="提取文字" name="text" />
      <el-tab-pane label="提取图片" name="extract" />
      <el-tab-pane label="压缩" name="compress" />
      <el-tab-pane label="页面尺寸" name="resize" />
      <el-tab-pane label="元数据" name="meta" />
      <el-tab-pane label="批量处理" name="batch" />
    </el-tabs>
    <!-- 工作台：合并 / 拆页 / 调序 / 删页 / 旋转 / 提取 一体化 -->
    <template v-if="tab === 'workbench'">
      <PdfWorkbench ref="wbRef" v-model:out-dir="wbOutDir" />
    </template>
    <!-- 第 1 步：选择文件（盖章页的盖章图片在选择 PDF 之后的设置卡片里） -->
    <StepCard v-if="tab !== 'workbench'" :step="1" title="选择文件">
      <FilePickList
        v-if="tab === 'compress'"
        v-model="compressFile"
        :filters="PDF_FILTER"
        :multiple="false"
        button-text="选择 PDF"
        title="选择要压缩的 PDF"
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
        button-text="选择图片（JPG/PNG，转PDF）"
        title="选择要转为 PDF 的图片（按选择顺序每张一页）"
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
      <FilePickList
        v-else-if="tab === 'meta'"
        v-model="metaFile"
        :filters="PDF_FILTER"
        :multiple="false"
        button-text="选择 PDF"
        title="选择要查看 / 修改元数据的 PDF"
      />
      <FilePickList
        v-else-if="tab === 'resize'"
        v-model="resizeFiles"
        :filters="PDF_FILTER"
        button-text="选择一个或多个 PDF"
        title="选择要调整页面尺寸的 PDF"
      />
      <FilePickList
        v-else-if="tab === 'hf'"
        v-model="hfFiles"
        :filters="PDF_FILTER"
        button-text="选择一个或多个 PDF"
        title="选择要加页眉页脚的 PDF"
      />
      <FilePickList
        v-else-if="tab === 'extract'"
        v-model="extractFile"
        :filters="PDF_FILTER"
        :multiple="false"
        button-text="选择 PDF"
        title="选择要提取图片的 PDF"
      />
      <FilePickList
        v-else-if="tab === 'batch'"
        v-model="batchFiles"
        :filters="PDF_FILTER"
        button-text="选择多个 PDF"
        title="选择要批量处理的 PDF"
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
      <div class="form-row mt-12">
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
      <div class="page-desc mt-8">适合电子签章、条码贴图等场景；图片按原始宽高比缩放。</div>
    </StepCard>
    <StepCard v-if="tab === 'split'" :step="2" title="拆分方式">
      <div class="form-row">
        <el-radio-group v-model="splitMode">
          <el-radio-button value="extract">提取页码</el-radio-button>
          <el-radio-button value="each">逐页拆分</el-radio-button>
          <el-radio-button value="everyN">按 N 页分卷</el-radio-button>
        </el-radio-group>
      </div>
      <div v-if="splitMode === 'extract'" class="form-row mt-10">
        <div class="form-item">
          <label>页码范围</label>
          <el-input v-model="ranges" placeholder="如 1-3,5,8-" style="width: 220px" clearable />
        </div>
      </div>
      <div v-if="splitMode === 'everyN'" class="form-row mt-10">
        <div class="form-item">
          <label>每份页数</label>
          <el-input-number v-model="everyN" :min="1" :max="9999" />
        </div>
      </div>
      <div v-if="splitMode === 'extract'" class="form-row mt-10">
        <el-checkbox v-model="splitOverwrite">用提取结果覆盖原文件（原文件先备份为 .bak）</el-checkbox>
      </div>
    </StepCard>
    <StepCard v-if="tab === 'numbers'" :step="2" title="页码设置">
      <div class="form-row">
        <div class="form-item">
          <label>位置</label>
          <el-select v-model="numPosition" style="width: 130px">
            <el-option label="底部居中" value="bottom-center" />
            <el-option label="底部左侧" value="bottom-left" />
            <el-option label="底部右侧" value="bottom-right" />
            <el-option label="顶部居中" value="top-center" />
            <el-option label="顶部左侧" value="top-left" />
            <el-option label="顶部右侧" value="top-right" />
          </el-select>
        </div>
        <div class="form-item">
          <label>格式</label>
          <el-select v-model="numFormat" style="width: 150px" allow-create filterable default-first-option>
            <el-option label="1 / 10（n / 总）" value="{n} / {total}" />
            <el-option label="第1页 共10页" value="第{n}页 共{total}页" />
            <el-option label="第 1 页" value="第 {n} 页" />
            <el-option label="- 1 -" value="- {n} -" />
            <el-option label="1" value="{n}" />
          </el-select>
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
      <div class="form-row mt-10">
        <div class="form-item">
          <label>字号</label>
          <el-input-number v-model="numFontSize" :min="6" :max="72" />
        </div>
        <div class="form-item">
          <label>颜色</label>
          <el-color-picker v-model="numColor" />
        </div>
        <div class="form-item">
          <label>距页边</label>
          <el-input-number v-model="numMargin" :min="4" :max="120" />
        </div>
      </div>
      <div class="page-desc mt-8">格式支持 {n}（当前页）与 {total}（末页编号）占位符；第 2 页起标注时编号自动顺延。</div>
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
      <div class="form-row mt-10">
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
      <div class="page-desc mt-8">每页导出一张 PNG；页数较多时耗时较长，请耐心等待。</div>
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
        class="mt-10"
        title="原理：把每页重新渲染为图片后重建 PDF。对扫描版 / 图片型 PDF 效果最好；文字型 PDF 会栅格化，文字将不可复制、也不宜打印放大。"
      />
      <div v-if="compProgress" class="form-row mt-12">
        <span class="mono">{{ compProgress }}</span>
        <el-button size="small" type="danger" plain @click="compCancelled = true">取消</el-button>
      </div>
    </StepCard>
    <StepCard v-if="tab === 'images'" :step="2" title="页面适配">
      <div class="form-row">
        <div class="form-item">
          <label>页面尺寸</label>
          <el-radio-group v-model="imagesFit">
            <el-radio-button value="a4">适配 A4（推荐）</el-radio-button>
            <el-radio-button value="none">原始像素（1px = 1pt）</el-radio-button>
          </el-radio-group>
        </div>
      </div>
      <div class="page-desc mt-8">
        手机照片动辄 4000×3000 像素，直接用像素当页面尺寸会得到约 1.4 米的页面，打印和预览都会异常；
        选「适配 A4」会等比缩放居中并留白，横图自动用横向页面。
      </div>
    </StepCard>
    <StepCard v-if="tab === 'meta'" :step="2" title="文档信息">
      <el-descriptions v-if="metaInfo" :column="2" border size="small">
        <el-descriptions-item label="页数">{{ metaInfo.pageCount }} 页</el-descriptions-item>
        <el-descriptions-item label="大小">{{ fmtMB(metaInfo.sizeBytes) }}</el-descriptions-item>
        <el-descriptions-item label="制作软件">{{ metaInfo.producer || '—' }}</el-descriptions-item>
        <el-descriptions-item label="创建者">{{ metaInfo.creator || '—' }}</el-descriptions-item>
        <el-descriptions-item label="创建时间">{{ metaInfo.creationDate || '—' }}</el-descriptions-item>
        <el-descriptions-item label="修改时间">{{ metaInfo.modificationDate || '—' }}</el-descriptions-item>
      </el-descriptions>
      <div v-else class="page-desc">选择一个 PDF 后显示其元信息。</div>
      <div class="form-row mt-12">
        <div class="form-item">
          <label>标题</label>
          <el-input v-model="metaTitle" placeholder="留空表示不修改" style="width: 220px" clearable />
        </div>
        <div class="form-item">
          <label>作者</label>
          <el-input v-model="metaAuthor" placeholder="留空表示不修改" style="width: 180px" clearable />
        </div>
      </div>
      <div class="form-row mt-10">
        <div class="form-item">
          <label>主题</label>
          <el-input v-model="metaSubject" placeholder="留空表示不修改" style="width: 220px" clearable />
        </div>
        <div class="form-item">
          <label>关键词</label>
          <el-input v-model="metaKeywords" placeholder="多个用逗号分隔" style="width: 220px" clearable />
        </div>
        <div class="form-item">
          <el-button type="danger" plain :loading="running" @click="runStripMeta">清除元数据（匿名化）</el-button>
        </div>
      </div>
      <div class="page-desc mt-8">
        一律另存为新文件、原文件不改动。报送材料前可用「清除元数据」抹掉作者、制作软件、时间戳等隐私信息。
      </div>
    </StepCard>
    <StepCard v-if="tab === 'resize'" :step="2" title="目标尺寸">
      <div class="form-row">
        <div class="form-item">
          <label>目标纸张</label>
          <el-radio-group v-model="resizePreset">
            <el-radio-button value="a4">A4</el-radio-button>
            <el-radio-button value="a3">A3</el-radio-button>
            <el-radio-button value="a5">A5</el-radio-button>
            <el-radio-button value="letter">Letter</el-radio-button>
            <el-radio-button value="scale">按比例缩放</el-radio-button>
            <el-radio-button value="custom">自定义(pt)</el-radio-button>
          </el-radio-group>
        </div>
      </div>
      <div class="form-row mt-10">
        <div v-if="resizePreset === 'scale'" class="form-item">
          <label>缩放倍数</label>
          <el-input-number v-model="resizeScale" :min="0.1" :max="5" :step="0.05" />
        </div>
        <template v-else-if="resizePreset === 'custom'">
          <div class="form-item">
            <label>宽(pt)</label>
            <el-input-number v-model="resizeWidth" :min="1" :max="10000" />
          </div>
          <div class="form-item">
            <label>高(pt)</label>
            <el-input-number v-model="resizeHeight" :min="1" :max="10000" />
          </div>
        </template>
        <template v-else>
          <div class="form-item">
            <label>方向</label>
            <el-radio-group v-model="resizeOrientation">
              <el-radio-button value="auto">跟随原页面</el-radio-button>
              <el-radio-button value="portrait">纵向</el-radio-button>
              <el-radio-button value="landscape">横向</el-radio-button>
            </el-radio-group>
          </div>
        </template>
        <div class="form-item">
          <label>背景色</label>
          <el-color-picker v-model="resizeBg" />
        </div>
        <div class="form-item">
          <el-switch v-model="resizeKeepRatio" active-text="等比居中留白" inactive-text="拉伸填满" />
        </div>
      </div>
      <div class="page-desc mt-8">
        A4 = 595×842pt。等比模式按原比例缩放并居中，其余用背景色留白；已被旋转过的页面建议先用「旋转」转正再调整。
      </div>
    </StepCard>
    <StepCard v-if="tab === 'hf'" :step="2" title="页眉页脚">
      <div class="form-row">
        <div class="form-item">
          <label>页眉</label>
          <el-input v-model="hfHeader" placeholder="留空则不加页眉，如：XX公司内部资料" style="width: 300px" clearable />
        </div>
        <div class="form-item">
          <label>页脚</label>
          <el-input v-model="hfFooter" placeholder="支持 {页码} {总页数} {文件名} {日期}" style="width: 300px" clearable />
        </div>
      </div>
      <div class="form-row mt-10">
        <div class="form-item">
          <label>字号</label>
          <el-input-number v-model="hfSize" :min="6" :max="36" />
        </div>
        <div class="form-item">
          <label>对齐</label>
          <el-radio-group v-model="hfAlign">
            <el-radio-button value="left">左</el-radio-button>
            <el-radio-button value="center">居中</el-radio-button>
            <el-radio-button value="right">右</el-radio-button>
          </el-radio-group>
        </div>
        <div class="form-item">
          <label>距页边(pt)</label>
          <el-input-number v-model="hfMargin" :min="0" :max="200" />
        </div>
        <div class="form-item">
          <label>从第几页</label>
          <el-input-number v-model="hfFromPage" :min="1" :max="99999" />
        </div>
        <div class="form-item">
          <label>颜色</label>
          <el-color-picker v-model="hfColor" />
        </div>
      </div>
      <div class="page-desc mt-8">占位符：{页码} {总页数} {文件名} {日期}；支持中文（依赖系统中文字体）。</div>
    </StepCard>
    <StepCard v-if="tab === 'extract'" :step="2" title="提取设置">
      <div class="form-row">
        <div class="form-item">
          <label>最小边长(px)</label>
          <el-input-number v-model="extractMin" :min="0" :max="9999" />
        </div>
        <div class="form-item">
          <span class="page-desc">小于该尺寸的图片（多为装饰线条、色块）将被跳过；填 0 表示全部导出。</span>
        </div>
      </div>
      <div class="page-desc mt-8">
        图片导出到「文件名_图片」子目录，同名自动追加序号；JPEG 编码直接取出原始字节，属于无损提取。
      </div>
    </StepCard>
    <StepCard v-if="tab === 'batch'" :step="2" title="批量操作">
      <div class="form-row">
        <div class="form-item">
          <label>操作</label>
          <el-radio-group v-model="batchAction">
            <el-radio-button value="watermark">加水印</el-radio-button>
            <el-radio-button value="numbers">加页码</el-radio-button>
            <el-radio-button value="headerFooter">加页眉页脚</el-radio-button>
            <el-radio-button value="rotate">旋转</el-radio-button>
            <el-radio-button value="stripMeta">清元数据</el-radio-button>
          </el-radio-group>
        </div>
      </div>
      <div v-if="batchAction === 'watermark'" class="form-row mt-10">
        <div class="form-item">
          <label>水印文字</label>
          <el-input v-model="batchWmText" style="width: 240px" clearable />
        </div>
        <div class="form-item">
          <label>字号</label>
          <el-input-number v-model="batchWmSize" :min="8" :max="200" />
        </div>
        <div class="form-item">
          <label>不透明度 {{ batchWmOpacity }}%</label>
          <el-slider v-model="batchWmOpacity" :min="5" :max="100" style="width: 140px" />
        </div>
        <div class="form-item">
          <label>角度</label>
          <el-input-number v-model="batchWmRotate" :min="-90" :max="90" :step="15" />
        </div>
      </div>
      <div v-else-if="batchAction === 'numbers'" class="form-row mt-10">
        <div class="form-item">
          <label>位置</label>
          <el-radio-group v-model="batchNumPos">
            <el-radio-button value="bottom-center">底部居中</el-radio-button>
            <el-radio-button value="bottom-right">底部右侧</el-radio-button>
            <el-radio-button value="top-right">右上角</el-radio-button>
          </el-radio-group>
        </div>
        <div class="form-item">
          <label>起始编号</label>
          <el-input-number v-model="batchNumStart" :min="0" :max="99999" />
        </div>
        <div class="form-item">
          <label>起始页</label>
          <el-input-number v-model="batchNumFrom" :min="1" :max="99999" />
        </div>
      </div>
      <div v-else-if="batchAction === 'headerFooter'" class="form-row mt-10">
        <div class="form-item">
          <label>页眉</label>
          <el-input v-model="batchHeader" placeholder="留空不加" style="width: 240px" clearable />
        </div>
        <div class="form-item">
          <label>页脚</label>
          <el-input v-model="batchFooter" style="width: 260px" clearable />
        </div>
        <div class="form-item">
          <label>字号</label>
          <el-input-number v-model="batchFontSize" :min="6" :max="36" />
        </div>
        <div class="form-item">
          <label>对齐</label>
          <el-radio-group v-model="batchHfAlign">
            <el-radio-button value="left">左</el-radio-button>
            <el-radio-button value="center">居中</el-radio-button>
            <el-radio-button value="right">右</el-radio-button>
          </el-radio-group>
        </div>
        <div class="form-item">
          <label>边距(pt)</label>
          <el-input-number v-model="batchHfMargin" :min="4" :max="120" />
        </div>
        <div class="form-item">
          <label>起始页</label>
          <el-input-number v-model="batchHfFrom" :min="1" :max="99999" />
        </div>
      </div>
      <div v-else-if="batchAction === 'rotate'" class="form-row mt-10">
        <div class="form-item">
          <label>角度</label>
          <el-radio-group v-model="batchAngle">
            <el-radio-button :value="90">90°</el-radio-button>
            <el-radio-button :value="180">180°</el-radio-button>
            <el-radio-button :value="270">270°</el-radio-button>
          </el-radio-group>
        </div>
      </div>
      <div v-else class="page-desc mt-10">
        清除每个 PDF 的作者、制作软件、时间戳等元数据，另存为「原名_匿名.pdf」。
      </div>
      <div class="page-desc mt-8">
        对每个 PDF 分别套用同一套参数、各自另存新文件，原文件不改动；单个失败不影响其余，失败原因会在下方列出。
      </div>
    </StepCard>
    <!-- 输出位置与执行合并成一张卡片：执行区只有一个按钮，单独占一张卡会白吃掉一整块高度，
         而且主按钮下移后 768px 屏上要滚动才能点到 -->
    <StepCard v-if="tab !== 'workbench'" :step="outStep" title="输出位置与执行">
      <OutDirPicker v-model="outDir" :file="tab === 'images'" />
      <div v-if="tab === 'images'" class="form-row mt-12">
        <div class="form-item">
          <label>输出文件名</label>
          <el-input v-model="imagesName" placeholder="留空自动：图片转PDF_时间戳" style="width: 300px" clearable />
        </div>
      </div>
      <div v-if="tab === 'images'" class="page-desc mt-8">也可在上方直接输入「文件夹\名字.pdf」；无需 .pdf 后缀，同名自动追加 (2)(3)… 不覆盖。</div>
      <div class="run-row">
        <el-button
          type="primary"
          :loading="running"
          :disabled="runBlocked"
          :title="runBlockedReason"
          :data-blocked-reason="runBlockedReason"
          data-primary-action
          @click="run"
        >
        {{
          {
            split: '开始拆分',
            numbers: '开始添加页码',
            watermark: '开始添加水印',
            stamp: '开始盖章',
            images: '开始转换',
            toimg: '开始转换',
            text: '开始提取',
            compress: '开始压缩',
            meta: '写入元数据',
            resize: '开始调整尺寸',
            hf: '开始添加',
            extract: '开始提取',
            batch: '开始批量处理'
          }[tab]
        }}
      </el-button>
      </div>
      <ResultPanel :outputs="outputs" />
      <el-alert
        v-if="tab === 'extract' && extractInfo"
        type="info"
        :closable="false"
        show-icon
        class="mt-12"
        :title="`共 ${extractInfo.pages} 页，导出 ${extractInfo.count} 张图片${extractInfo.skipped ? `，跳过 ${extractInfo.skipped} 个（格式不支持或过小）` : ''}`"
      />
      <div v-if="tab === 'batch' && batchFailed.length" class="mt-12">
        <el-alert type="error" :closable="false" title="以下文件处理失败" />
        <ul class="fail-list">
          <li v-for="f in batchFailed" :key="f.name"><b>{{ f.name }}</b>：{{ f.reason }}</li>
        </ul>
      </div>
      <el-alert
        v-if="tab === 'compress' && compResult"
        type="success"
        :closable="false"
        show-icon
        class="mt-12"
        :title="`原大小 ${fmtMB(compResult.before)} → 新大小 ${fmtMB(compResult.after)}（节省 ${Math.max(0, Math.round((1 - compResult.after / compResult.before) * 100))}%）`"
      />
    </StepCard>
  </div>
</template>
<style scoped>
.fail-list {
  margin-top: 8px;
  padding-left: 18px;
  font-size: 13px;
  color: var(--text-2, #606266);
}
</style>