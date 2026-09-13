<script setup lang="ts">
import { api } from '../utils/ipc'
import { ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import StepCard from '../components/StepCard.vue'
import FilePickList from '../components/FilePickList.vue'
import OutDirPicker from '../components/OutDirPicker.vue'
import ResultPanel from '../components/ResultPanel.vue'
import ImageEditor from '../components/ImageEditor.vue'
import { call } from '../utils/api'

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
const outputs = ref<string[]>([])
const running = ref(false)
const progress = ref(0)

const format = ref<'image/jpeg' | 'image/png' | 'image/webp'>('image/jpeg')
const quality = ref(80)
const maxSide = ref(0)
const rotateDeg = ref<0 | 90 | 180 | 270>(0)
const flipH = ref(false)
const wmText = ref('')
const wmFontSize = ref(24)
const wmOpacity = ref(40)
const wmTile = ref(true)
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
  ctx.rotate(-Math.PI / 6)
  const radius = Math.ceil(Math.sqrt(w * w + h * h) / 2)
  const text = wmText.value.trim()
  if (text) {
    ctx.fillStyle = '#000000'
    ctx.font = `${wmFontSize.value}px "Microsoft YaHei", sans-serif`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    if (wmTile.value) {
      const stepX = Math.max(ctx.measureText(text).width + 60, 120)
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
      const stepX = wmImg.width + 60
      const stepY = wmImg.height + 60
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
  const scale = maxSide.value > 0 ? Math.min(1, maxSide.value / Math.max(img.width, img.height)) : 1
  const w = Math.max(1, Math.round(img.width * scale))
  const h = Math.max(1, Math.round(img.height * scale))
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
  const blob = await new Promise<Blob | null>(res => canvas.toBlob(res, format.value, quality.value / 100))
  if (!blob) throw new Error('图片编码失败')
  const b64 = await blobToBase64(blob)
  const outName = item.name.replace(/\.[^.]+$/, '') + EXT[format.value]
  const r = await api.writeBinary({ dir: outDir.value, name: outName, base64: b64 })
  if (!r.ok) throw new Error(r.error)
  return r.data.path
}

async function run() {
  if (!items.value.length) {
    ElMessage.warning('请先选择图片')
    return
  }
  if (!outDir.value) {
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
const stitchBusy = ref(false)
const stitchOutput = ref('')

async function runStitch() {
  stitchOutput.value = ''
  if (!stitchFiles.value.length) {
    ElMessage.warning('请先选择图片（按选择顺序拼接）')
    return
  }
  if (!outDir.value) {
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
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('无法创建画布')
    ctx.fillStyle = stitchBg.value
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    let offset = 0
    for (const img of imgs) {
      if (vertical) {
        ctx.drawImage(img, Math.round((canvas.width - img.width) / 2), offset)
        offset += img.height + gap
      } else {
        ctx.drawImage(img, offset, Math.round((canvas.height - img.height) / 2))
        offset += img.width + gap
      }
    }
    const mime = stitchFormat.value === 'png' ? 'image/png' : 'image/jpeg'
    const blob = await new Promise<Blob | null>(res => canvas.toBlob(res, mime, 0.92))
    if (!blob) throw new Error('图片编码失败')
    const b64 = await blobToBase64(blob)
    const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14)
    const rr = await api.writeBinary({
      dir: outDir.value,
      name: `长图_${stamp}.${stitchFormat.value === 'png' ? 'png' : 'jpg'}`,
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
const editorRef = ref<InstanceType<typeof ImageEditor> | null>(null)

watch(annoFile, async () => {
  annoOutput.value = ''
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
  if (!outDir.value) {
    ElMessage.warning('请选择输出文件夹')
    return
  }
  annoBusy.value = true
  try {
    const blob = await editorRef.value.exportBlob(annoFormat.value, annoQuality.value / 100)
    if (!blob) throw new Error('导出失败')
    const b64 = await blobToBase64(blob)
    const base = annoImage.value.name.replace(/\.[^.]+$/, '')
    const ext = annoFormat.value === 'image/png' ? 'png' : 'jpg'
    const r = await api.writeBinary({ dir: outDir.value, name: `${base}_标注.${ext}`, base64: b64 })
    if (!r.ok) throw new Error(r.error)
    annoOutput.value = r.data.path
    ElMessage.success('已保存')
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

async function runIdPhoto() {
  idOutput.value = ''
  if (!idFile.value.length) {
    ElMessage.warning('请先选择一张证件照')
    return
  }
  if (!outDir.value) {
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
    for (let rr = 0; rr < rows; rr++) {
      for (let cc = 0; cc < cols; cc++) {
        const x = startX + cc * (pw + gap)
        const y = startY + rr * (ph + gap)
        ctx.drawImage(img, x, y, pw, ph)
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
    const name = `证件照排版_${size.label.split(' ')[0]}_${total}张_${paper.label.split(' ')[0]}相纸.${idFormat.value === 'png' ? 'png' : 'jpg'}`
    const rr = await api.writeBinary({ dir: outDir.value, name, base64: b64 })
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
          <label>最长边(px，0=原尺寸)</label>
          <el-input-number v-model="maxSide" :min="0" :max="20000" :step="100" />
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
      <div class="form-row" style="margin-top: 12px">
        <div class="form-item">
          <label>水印文字</label>
          <el-input v-model="wmText" placeholder="留空则不加文字水印" style="width: 200px" clearable />
        </div>
        <div class="form-item">
          <label>字号</label>
          <el-input-number v-model="wmFontSize" :min="8" :max="200" />
        </div>
        <div class="form-item">
          <label>透明度 {{ wmOpacity }}%</label>
          <el-slider v-model="wmOpacity" :min="5" :max="100" style="width: 140px" />
        </div>
        <div class="form-item">
          <el-checkbox v-model="wmTile">平铺</el-checkbox>
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
      <el-button type="primary" :loading="running" size="large" @click="run">
        开始处理（{{ items.length }} 张）
      </el-button>
      <div v-if="running || progress > 0" class="progress-row">
        <el-progress :percentage="progress" :stroke-width="14" />
      </div>
      <el-table v-if="items.length" :data="items" height="260" style="margin-top: 14px" size="small">
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
      <StepCard :step="1" title="选择图片（按选择顺序拼接）">
        <FilePickList
          v-model="stitchFiles"
          :filters="IMG_FILTER"
          button-text="选择图片"
          title="选择要拼接的图片（按选择顺序）"
        />
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
        <div class="page-desc" style="margin-top: 8px">
          适合聊天记录、长截图合并；图片按最大宽（高）对齐居中，不足处用背景色填充。
        </div>
      </StepCard>

      <StepCard :step="3" title="输出位置">
        <OutDirPicker v-model="outDir" />
      </StepCard>

      <StepCard :step="4" title="执行">
        <el-button type="primary" :loading="stitchBusy" @click="runStitch">
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
        <div class="form-row" style="margin-top: 10px">
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
        <div class="page-desc" style="margin-top: 8px">
          按 300dpi 排版整张相纸，冲印后沿虚线裁切即可。照片会按目标尺寸拉伸，若比例不合请先自行裁剪。
        </div>
      </StepCard>

      <StepCard :step="3" title="输出位置">
        <OutDirPicker v-model="outDir" />
      </StepCard>

      <StepCard :step="4" title="执行">
        <el-button type="primary" :loading="idBusy" @click="runIdPhoto">开始排版</el-button>
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
        <div class="page-desc" style="margin-top: 10px">全部在本机内存中完成，不会上传；快捷键见编辑器上方提示。</div>
      </StepCard>

      <StepCard :step="3" title="输出位置">
        <OutDirPicker v-model="outDir" />
      </StepCard>

      <StepCard :step="4" title="保存">
        <div class="form-row">
          <div class="form-item">
            <label>格式</label>
            <el-radio-group v-model="annoFormat">
              <el-radio-button value="image/png">PNG（无损，支持透明）</el-radio-button>
              <el-radio-button value="image/jpeg">JPG（更小）</el-radio-button>
            </el-radio-group>
          </div>
          <div class="form-item" v-if="annoFormat === 'image/jpeg'">
            <label>质量 {{ annoQuality }}%</label>
            <el-slider v-model="annoQuality" :min="50" :max="100" style="width: 140px" />
          </div>
          <div class="form-item">
            <el-button type="primary" :loading="annoBusy" @click="runAnnoSave">保存结果</el-button>
          </div>
        </div>
        <ResultPanel :outputs="annoOutput ? [annoOutput] : []" />
      </StepCard>
    </template>
  </div>
</template>
