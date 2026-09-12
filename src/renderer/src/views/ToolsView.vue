<script setup lang="ts">
import { api } from '../utils/ipc'
import { computed, ref } from 'vue'
import { ElMessage } from 'element-plus'
import { CopyDocument } from '@element-plus/icons-vue'
import FilePickList from '../components/FilePickList.vue'
import OutDirPicker from '../components/OutDirPicker.vue'
import { basename, call } from '../utils/api'
import { diffLines, type DiffResult } from '@shared/textDiff'
import type { HashAlgorithm, HashResult } from '@shared/types'

const tab = ref<'json' | 'codec' | 'timestamp' | 'uuid' | 'hash' | 'qrcode' | 'extract' | 'batchqr' | 'qrdecode' | 'pinyin' | 'diff'>('json')

async function copy(text: string) {
  if (!text) {
    ElMessage.warning('没有可复制的内容')
    return
  }
  await navigator.clipboard.writeText(text)
  ElMessage.success('已复制')
}

/* ---------- JSON ---------- */

const jsonInput = ref('')
const jsonOutput = ref('')
const jsonError = ref('')

function formatJson(compact: boolean) {
  jsonError.value = ''
  jsonOutput.value = ''
  if (!jsonInput.value.trim()) {
    jsonError.value = '请输入 JSON'
    return
  }
  try {
    const obj = JSON.parse(jsonInput.value)
    jsonOutput.value = compact ? JSON.stringify(obj) : JSON.stringify(obj, null, 2)
  } catch (e) {
    jsonError.value = e instanceof Error ? e.message : String(e)
  }
}

/* ---------- 编解码 ---------- */

const codecKind = ref<'base64' | 'url'>('base64')
const codecInput = ref('')
const codecOutput = ref('')
const codecError = ref('')

function base64Encode(input: string): string {
  const bytes = new TextEncoder().encode(input)
  let bin = ''
  for (const b of bytes) bin += String.fromCharCode(b)
  return btoa(bin)
}

function base64Decode(input: string): string {
  const bin = atob(input.replace(/\s+/g, ''))
  const bytes = Uint8Array.from(bin, c => c.charCodeAt(0))
  return new TextDecoder().decode(bytes)
}

function runCodec(decode: boolean) {
  codecError.value = ''
  codecOutput.value = ''
  if (!codecInput.value) {
    codecError.value = '请输入内容'
    return
  }
  try {
    if (codecKind.value === 'base64') {
      codecOutput.value = decode ? base64Decode(codecInput.value) : base64Encode(codecInput.value)
    } else {
      codecOutput.value = decode ? decodeURIComponent(codecInput.value) : encodeURIComponent(codecInput.value)
    }
  } catch (e) {
    codecError.value = e instanceof Error ? e.message : String(e)
  }
}

/* ---------- 时间戳 ---------- */

const nowText = ref(new Date().toLocaleString('zh-CN', { hour12: false }))
const tsInput = ref('')
const tsToDate = ref('')
const dateValue = ref<Date | null>(null)
const dateToTs = ref('')

function refreshNow() {
  nowText.value = new Date().toLocaleString('zh-CN', { hour12: false })
}

function tsToDateFn() {
  tsToDate.value = ''
  const raw = tsInput.value.trim()
  if (!raw) return
  const n = Number(raw)
  if (!Number.isFinite(n)) {
    tsToDate.value = '无效数字'
    return
  }
  const ms = raw.replace('.', '').length >= 13 ? n : n * 1000
  const d = new Date(ms)
  tsToDate.value = isNaN(d.getTime()) ? '无效时间戳' : d.toLocaleString('zh-CN', { hour12: false })
}

function onDateChange(v: Date | null) {
  dateValue.value = v
  dateToTs.value = v ? String(v.getTime()) : ''
}

/* ---------- UUID ---------- */

const uuidText = ref('')

function genUuid() {
  const list: string[] = []
  for (let i = 0; i < 5; i++) list.push(crypto.randomUUID())
  uuidText.value = list.join('\n')
}

/* ---------- 文件哈希 ---------- */

const hashFiles = ref<string[]>([])
const hashAlgo = ref<HashAlgorithm>('md5')
const hashResults = ref<HashResult[]>([])
const hashing = ref(false)

async function calcHash() {
  if (!hashFiles.value.length) {
    ElMessage.warning('请先选择文件')
    return
  }
  hashing.value = true
  try {
    const r = await call(api.hashFiles({ paths: hashFiles.value, algorithm: hashAlgo.value }))
    if (r) hashResults.value = r
  } finally {
    hashing.value = false
  }
}

/* ---------- 二维码 ---------- */

const qrText = ref('')
const qrDataUrl = ref('')
const qrError = ref('')
const qrOutDir = ref('')
const qrSaving = ref(false)

async function genQr() {
  qrError.value = ''
  qrDataUrl.value = ''
  if (!qrText.value.trim()) {
    qrError.value = '请输入内容'
    return
  }
  try {
    const QRCode = await import('qrcode')
    qrDataUrl.value = await QRCode.toDataURL(qrText.value, { width: 260, margin: 2 })
  } catch (e) {
    qrError.value = e instanceof Error ? e.message : String(e)
  }
}

async function saveQr() {
  if (!qrDataUrl.value) return
  if (!qrOutDir.value) {
    ElMessage.warning('请先选择保存文件夹')
    return
  }
  qrSaving.value = true
  try {
    const b64 = qrDataUrl.value.split(',')[1] ?? ''
    await call(api.writeBinary({ dir: qrOutDir.value, name: `qrcode_${Date.now()}.png`, base64: b64 }), '已保存')
  } finally {
    qrSaving.value = false
  }
}

const hashName = computed(() => (p: string) => basename(p))

/* ---------- 批量提取联系方式 ---------- */

const DOC_FILTER = [
  { name: '支持的文件', extensions: ['txt', 'csv', 'xlsx', 'docx'] }
]
const extractFiles = ref<string[]>([])
const extractKinds = ref<Array<'phone' | 'idcard' | 'email'>>(['phone'])
const extractDedupe = ref(true)
const extractOutDir = ref('')
const extractResult = ref<{ counts: Array<{ kind: string; label: string; count: number }>; outputs: string[] } | null>(null)
const extractBusy = ref(false)

async function runExtract() {
  extractResult.value = null
  if (!extractFiles.value.length) {
    ElMessage.warning('请先选择文件')
    return
  }
  if (!extractKinds.value.length) {
    ElMessage.warning('请至少选择一种要提取的内容')
    return
  }
  if (!extractOutDir.value) {
    ElMessage.warning('请先选择输出文件夹')
    return
  }
  extractBusy.value = true
  try {
    const r = await call(
      api.extractContacts({
        paths: extractFiles.value,
        kinds: extractKinds.value,
        dedupe: extractDedupe.value,
        outDir: extractOutDir.value
      }),
      '提取完成'
    )
    if (r) extractResult.value = r
  } finally {
    extractBusy.value = false
  }
}

/* ---------- 批量二维码 ---------- */

const DATA_FILTER = [{ name: '数据文件', extensions: ['xlsx', 'json'] }]
const qrFiles = ref<string[]>([])
const qrRecords = ref<Array<Record<string, string>>>([])
const qrField = ref('')
const qrNameField = ref('')
const batchQrOutDir = ref('')
const batchQrOutputs = ref<string[]>([])
const batchQrBusy = ref(false)

async function loadQrRecords() {
  if (!qrFiles.value.length) {
    ElMessage.warning('请先选择数据文件')
    return
  }
  const r = await call(api.allRecords({ dataPath: qrFiles.value[0] }))
  if (r) {
    qrRecords.value = r.records
    qrField.value = ''
    qrNameField.value = ''
    ElMessage.success(`已读取 ${r.records.length} 行数据`)
  }
}

const qrFields = computed(() => (qrRecords.value.length ? Object.keys(qrRecords.value[0]) : []))

function outNameOf(rec: Record<string, string>, i: number): string {
  let name = qrNameField.value.trim().replace(/\{([^{}]+)\}/g, (_w, k: string) => rec[k.trim()] ?? '')
  name = name.replace(/[\\/:*?"<>|\r\n\t]/g, '_').trim()
  return name || `qrcode_${i + 1}`
}

async function runBatchQr() {  batchQrOutputs.value = []
  if (!qrRecords.value.length) {
    ElMessage.warning('请先选择数据文件并读取')
    return
  }
  if (!qrField.value) {
    ElMessage.warning('请选择二维码内容列')
    return
  }
  if (!batchQrOutDir.value) {
    ElMessage.warning('请先选择保存文件夹')
    return
  }
  batchQrBusy.value = true
  try {
    const QRCode = await import('qrcode')
    let ok = 0
    for (let i = 0; i < qrRecords.value.length; i++) {
      const rec = qrRecords.value[i]
      const content = (rec[qrField.value] ?? '').trim()
      if (!content) continue
      const dataUrl = await QRCode.toDataURL(content, { width: 400, margin: 2 })
      const r = await api.writeBinary({
        dir: batchQrOutDir.value,
        name: `${outNameOf(rec, i)}.png`,
        base64: dataUrl.split(',')[1] ?? ''
      })
      if (r.ok) {
        batchQrOutputs.value.push(r.data.path)
        ok++
      }
    }
    ElMessage.success(`已生成 ${ok} 个二维码`)
  } finally {
    batchQrBusy.value = false
  }
}

function openBatchQrDir() {
  void api.openPath(batchQrOutDir.value)
}

function openUrl(url: string) {
  void api.openPath(url)
}

function openPinDir() {
  void api.openPath(pinOutDir.value)
}

/* ---------- 识别二维码 ---------- */

const decFiles = ref<string[]>([])
const decResult = ref('')
const decError = ref('')
const decBusy = ref(false)

function bytesToBase64(bytes: Uint8Array): string {
  let bin = ''
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) bin += String.fromCharCode(...bytes.subarray(i, i + chunk))
  return btoa(bin)
}

async function runDecode() {
  decResult.value = ''
  decError.value = ''
  if (!decFiles.value.length) {
    ElMessage.warning('请先选择二维码图片')
    return
  }
  decBusy.value = true
  try {
    const r = await call(api.readFiles(decFiles.value))
    if (!r) return
    const base64 = r[0].base64
    const ext = (r[0].name.split('.').pop() ?? 'png').toLowerCase()
    const mime = ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : ext === 'webp' ? 'image/webp' : 'image/png'
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const im = new Image()
      im.onload = () => resolve(im)
      im.onerror = () => reject(new Error('图片解码失败'))
      im.src = `data:${mime};base64,${base64}`
    })
    const canvas = document.createElement('canvas')
    canvas.width = img.naturalWidth
    canvas.height = img.naturalHeight
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('无法创建画布')
    ctx.drawImage(img, 0, 0)
    const data = ctx.getImageData(0, 0, canvas.width, canvas.height)
    const jsQR = (await import('jsqr')).default
    const res = jsQR(data.data, data.width, data.height, { inversionAttempts: 'attemptBoth' })
    if (res?.data) decResult.value = res.data
    else decError.value = '没有识别到二维码，尝试裁剪或放大图片后重试'
  } catch (e) {
    decError.value = e instanceof Error ? e.message : String(e)
  } finally {
    decBusy.value = false
  }
}

const decIsUrl = computed(() => /^https?:\/\//i.test(decResult.value))

/* ---------- 名单加拼音 ---------- */

const pinFiles = ref<string[]>([])
const pinRecords = ref<Array<Record<string, string>>>([])
const pinField = ref('')
const pinTone = ref<'symbol' | 'none' | 'num'>('none')
const pinMode = ref<'full' | 'initial'>('full')
const pinOutDir = ref('')
const pinBusy = ref(false)
const pinOutput = ref('')

async function loadPinRecords() {
  if (!pinFiles.value.length) {
    ElMessage.warning('请先选择名单文件')
    return
  }
  const r = await call(api.allRecords({ dataPath: pinFiles.value[0] }))
  if (r) {
    pinRecords.value = r.records
    pinField.value = ''
    ElMessage.success(`已读取 ${r.records.length} 行`)
  }
}

const pinFields = computed(() => (pinRecords.value.length ? Object.keys(pinRecords.value[0]) : []))

async function runPinyin() {
  pinOutput.value = ''
  if (!pinRecords.value.length) {
    ElMessage.warning('请先选择文件并读取')
    return
  }
  if (!pinField.value) {
    ElMessage.warning('请选择姓名列')
    return
  }
  if (!pinOutDir.value) {
    ElMessage.warning('请选择输出文件夹')
    return
  }
  pinBusy.value = true
  try {
    const { pinyin } = await import('pinyin-pro')
    const lines = [`${pinField.value},拼音`]
    for (const rec of pinRecords.value) {
      const name = (rec[pinField.value] ?? '').trim()
      if (!name) continue
      const py = pinyin(name, { toneType: pinTone.value, type: 'array' })
        .map(s => (pinMode.value === 'initial' ? (s[0] ?? '').toUpperCase() : s))
        .join(pinMode.value === 'initial' ? '' : ' ')
      lines.push(`${name.replace(/,/g, '，')},${py}`)
    }
    const csv = '\uFEFF' + lines.join('\r\n')
    const b64 = bytesToBase64(new TextEncoder().encode(csv))
    const rr = await api.writeBinary({ dir: pinOutDir.value, name: '名单_带拼音.csv', base64: b64 })
    if (!rr.ok) throw new Error(rr.error)
    pinOutput.value = rr.data.path
    ElMessage.success(`已生成 ${lines.length - 1} 条`)
  } finally {
    pinBusy.value = false
  }
}

/* ---------- 文本对比 ---------- */

const TEXT_FILTER = [{ name: '文本文件', extensions: ['txt', 'md', 'csv', 'log', 'json', 'xml', 'html'] }]
const diffA = ref('')
const diffB = ref('')
const diffResult = ref<DiffResult | null>(null)

function runDiff() {
  diffResult.value = diffLines(diffA.value, diffB.value)
}

function swapDiff() {
  const t = diffA.value
  diffA.value = diffB.value
  diffB.value = t
  if (diffResult.value) runDiff()
}

function clearDiff() {
  diffA.value = ''
  diffB.value = ''
  diffResult.value = null
}

async function loadDiffFile(side: 'a' | 'b') {
  const r = await api.pickFiles({ filters: TEXT_FILTER, multiple: false, title: '选择文本文件' })
  if (!r.ok || !r.data.length) return
  const fr = await api.readFiles(r.data)
  if (!fr.ok) {
    ElMessage.error(fr.error)
    return
  }
  const bin = atob(fr.data[0].base64)
  const bytes = Uint8Array.from(bin, c => c.charCodeAt(0))
  let text = new TextDecoder('utf-8').decode(bytes)
  // 内网台账常见 GBK 编码：utf-8 解码出现替换字符时按 GBK 重试
  if (text.includes('\uFFFD')) {
    try {
      text = new TextDecoder('gbk').decode(bytes)
    } catch {
      /* 保留 utf-8 结果 */
    }
  }
  if (side === 'a') diffA.value = text
  else diffB.value = text
  ElMessage.success(`已载入 ${basename(fr.data[0].name)}`)
}
</script>

<template>
  <div>
    <h1 class="page-title">常用小工具</h1>
    <p class="page-desc">JSON、编解码、时间戳、UUID、文件哈希、二维码、文本对比，全部本地计算。</p>

    <el-tabs v-model="tab">
      <el-tab-pane label="JSON" name="json" />
      <el-tab-pane label="编解码" name="codec" />
      <el-tab-pane label="时间戳" name="timestamp" />
      <el-tab-pane label="UUID" name="uuid" />
      <el-tab-pane label="文件哈希" name="hash" />
      <el-tab-pane label="二维码" name="qrcode" />
      <el-tab-pane label="批量提取" name="extract" />
      <el-tab-pane label="批量二维码" name="batchqr" />
      <el-tab-pane label="识别二维码" name="qrdecode" />
      <el-tab-pane label="名单加拼音" name="pinyin" />
      <el-tab-pane label="文本对比" name="diff" />
    </el-tabs>

    <!-- JSON -->
    <div v-if="tab === 'json'" class="step-card">
      <el-input
        v-model="jsonInput"
        type="textarea"
        :rows="6"
        placeholder='粘贴 JSON，如 {"姓名":"张三","年龄":20}'
        class="mono"
      />
      <div class="form-row" style="margin-top: 8px">
        <el-button type="primary" @click="formatJson(false)">格式化</el-button>
        <el-button @click="formatJson(true)">压缩</el-button>
        <el-button :icon="CopyDocument" @click="copy(jsonOutput)">复制结果</el-button>
        <span v-if="jsonError" style="color: #f56c6c; font-size: 12px">{{ jsonError }}</span>
      </div>
      <el-input
        v-if="jsonOutput"
        v-model="jsonOutput"
        type="textarea"
        :rows="8"
        readonly
        class="mono"
        style="margin-top: 8px"
      />
    </div>

    <!-- 编解码 -->
    <div v-else-if="tab === 'codec'" class="step-card">
      <div class="form-row">
        <el-radio-group v-model="codecKind">
          <el-radio-button value="base64">Base64</el-radio-button>
          <el-radio-button value="url">URL</el-radio-button>
        </el-radio-group>
      </div>
      <el-input
        v-model="codecInput"
        type="textarea"
        :rows="4"
        placeholder="输入内容"
        class="mono"
        style="margin-top: 8px"
      />
      <div class="form-row" style="margin-top: 8px">
        <el-button type="primary" @click="runCodec(false)">编码 →</el-button>
        <el-button type="primary" plain @click="runCodec(true)">← 解码</el-button>
        <el-button :icon="CopyDocument" @click="copy(codecOutput)">复制结果</el-button>
        <span v-if="codecError" style="color: #f56c6c; font-size: 12px">{{ codecError }}</span>
      </div>
      <el-input
        v-if="codecOutput"
        v-model="codecOutput"
        type="textarea"
        :rows="4"
        readonly
        class="mono"
        style="margin-top: 8px"
      />
    </div>

    <!-- 时间戳 -->
    <div v-else-if="tab === 'timestamp'" class="step-card">
      <div class="form-row">
        <div class="form-item">
          <label>当前时间</label>
          <span class="mono">{{ nowText }}</span>
        </div>
        <el-button size="small" @click="refreshNow">刷新</el-button>
        <el-button :icon="CopyDocument" @click="copy(String(Date.now()))">复制当前毫秒时间戳</el-button>
      </div>
      <div class="form-row" style="margin-top: 14px">
        <div class="form-item">
          <label>时间戳 → 日期</label>
          <el-input v-model="tsInput" placeholder="秒或毫秒都支持" style="width: 220px" clearable @input="tsToDateFn" />
        </div>
        <span class="mono" style="color: #409eff">{{ tsToDate }}</span>
      </div>
      <div class="form-row" style="margin-top: 12px">
        <div class="form-item">
          <label>日期 → 时间戳</label>
          <el-date-picker v-model="dateValue" type="datetime" placeholder="选择日期时间" @change="onDateChange" />
        </div>
        <span class="mono" style="color: #409eff">{{ dateToTs }}</span>
        <el-button v-if="dateToTs" :icon="CopyDocument" @click="copy(dateToTs)" />
      </div>
    </div>

    <!-- UUID -->
    <div v-else-if="tab === 'uuid'" class="step-card">
      <el-button type="primary" @click="genUuid">生成 5 个 UUID</el-button>
      <el-button :icon="CopyDocument" :disabled="!uuidText" @click="copy(uuidText)">复制全部</el-button>
      <pre v-if="uuidText" class="mono" style="margin-top: 10px; line-height: 1.9">{{ uuidText }}</pre>
    </div>

    <!-- 文件哈希 -->
    <div v-else-if="tab === 'hash'" class="step-card">
      <div class="form-row">
        <div class="form-item" style="flex: 1">
          <FilePickList v-model="hashFiles" button-text="选择文件" title="选择要计算哈希的文件" />
        </div>
        <div class="form-item">
          <el-select v-model="hashAlgo" style="width: 100px">
            <el-option label="MD5" value="md5" />
            <el-option label="SHA-1" value="sha1" />
            <el-option label="SHA-256" value="sha256" />
          </el-select>
        </div>
        <el-button type="primary" :loading="hashing" @click="calcHash">计算</el-button>
      </div>
      <el-table v-if="hashResults.length" :data="hashResults" size="small" max-height="300" style="margin-top: 10px">
        <el-table-column label="文件" width="180" show-overflow-tooltip>
          <template #default="{ row }">{{ hashName(row.path) }}</template>
        </el-table-column>
        <el-table-column label="哈希值" show-overflow-tooltip>
          <template #default="{ row }"><span class="mono">{{ row.hash }}</span></template>
        </el-table-column>
        <el-table-column label="" width="60">
          <template #default="{ row }">
            <el-button :icon="CopyDocument" link @click="copy(row.hash)" />
          </template>
        </el-table-column>
      </el-table>
    </div>

    <!-- 二维码 -->
    <div v-else-if="tab === 'qrcode'" class="step-card">
      <el-input
        v-model="qrText"
        type="textarea"
        :rows="3"
        placeholder="输入文字或链接，如 https://example.com"
        style="max-width: 560px"
      />
      <div class="form-row" style="margin-top: 8px">
        <el-button type="primary" @click="genQr">生成二维码</el-button>
        <span v-if="qrError" style="color: #f56c6c; font-size: 12px">{{ qrError }}</span>
      </div>
      <div v-if="qrDataUrl" class="form-row" style="margin-top: 12px">
        <img :src="qrDataUrl" alt="二维码" style="width: 180px; height: 180px" />
        <div>
          <OutDirPicker v-model="qrOutDir" title="选择二维码保存位置" />
          <el-button type="primary" plain :loading="qrSaving" style="margin-top: 8px" @click="saveQr">
            保存 PNG
          </el-button>
        </div>
      </div>
    </div>

    <!-- 批量提取 -->
    <div v-else-if="tab === 'extract'" class="step-card">
      <div class="form-row">
        <div class="form-item" style="flex: 1">
          <FilePickList
            v-model="extractFiles"
            :filters="DOC_FILTER"
            button-text="选择文件"
            title="选择要提取的文件（txt / csv / xlsx / docx，可多选）"
          />
        </div>
      </div>
      <div class="form-row" style="margin-top: 12px">
        <div class="form-item">
          <label>要提取的内容</label>
          <el-checkbox-group v-model="extractKinds">
            <el-checkbox value="phone">手机号</el-checkbox>
            <el-checkbox value="idcard">身份证号</el-checkbox>
            <el-checkbox value="email">邮箱</el-checkbox>
          </el-checkbox-group>
        </div>
        <div class="form-item">
          <el-checkbox v-model="extractDedupe">去重</el-checkbox>
        </div>
      </div>
      <div class="form-row" style="margin-top: 12px">
        <OutDirPicker v-model="extractOutDir" title="选择输出文件夹" />
      </div>
      <div class="form-row" style="margin-top: 12px">
        <el-button type="primary" :loading="extractBusy" @click="runExtract">开始提取</el-button>
      </div>
      <template v-if="extractResult">
        <el-alert
          type="success"
          :closable="false"
          style="margin-top: 12px"
          :title="extractResult.counts.map(c => `${c.label} ${c.count} 个`).join('，')"
        />
        <ul class="file-list" style="margin-top: 8px">
          <li v-for="p in extractResult.outputs" :key="p">
            <span class="file-name">{{ basename(p) }}</span>
          </li>
        </ul>
      </template>
    </div>

    <!-- 批量二维码 -->
    <div v-else-if="tab === 'batchqr'" class="step-card">
      <div class="form-row">
        <div class="form-item" style="flex: 1">
          <FilePickList
            v-model="qrFiles"
            :filters="DATA_FILTER"
            :multiple="false"
            button-text="选择数据文件"
            title="选择数据文件（xlsx 第 1 行为字段名，或 json 对象数组）"
          />
        </div>
        <el-button plain @click="loadQrRecords">读取数据</el-button>
      </div>
      <div v-if="qrRecords.length" class="form-row" style="margin-top: 12px">
        <div class="form-item">
          <label>二维码内容列</label>
          <el-select v-model="qrField" placeholder="选择列" style="width: 200px">
            <el-option v-for="f in qrFields" :key="f" :label="f" :value="f" />
          </el-select>
        </div>
        <div class="form-item">
          <label>文件名列（如 {姓名}，留空用序号）</label>
          <el-select
            v-model="qrNameField"
            placeholder="选择列或直接输入 {列名}"
            style="width: 240px"
            filterable
            allow-create
            default-first-option
          >
            <el-option label="按序号命名" value="" />
            <el-option v-for="f in qrFields" :key="f" :label="`{${f}}`" :value="`{${f}}`" />
          </el-select>
        </div>
      </div>
      <div class="form-row" style="margin-top: 12px">
        <OutDirPicker v-model="batchQrOutDir" title="选择保存文件夹" />
      </div>
      <div class="form-row" style="margin-top: 12px">
        <el-button type="primary" :loading="batchQrBusy" :disabled="!qrRecords.length" @click="runBatchQr">
          生成全部二维码（{{ qrRecords.length }} 行）
        </el-button>
      </div>
      <el-result
        v-if="batchQrOutputs.length"
        icon="success"
        :title="`共生成 ${batchQrOutputs.length} 个 PNG`"
      >
        <template #extra>
          <el-button type="primary" @click="openBatchQrDir">打开文件夹</el-button>
        </template>
      </el-result>
    </div>

    <!-- 识别二维码 -->
    <div v-else-if="tab === 'qrdecode'" class="step-card">
      <div class="form-row">
        <div class="form-item" style="flex: 1">
          <FilePickList
            v-model="decFiles"
            :multiple="false"
            :filters="[{ name: '图片', extensions: ['png', 'jpg', 'jpeg', 'webp', 'bmp'] }]"
            button-text="选择二维码图片"
            title="选择含二维码的图片"
          />
        </div>
      </div>
      <div class="form-row" style="margin-top: 8px">
        <el-button type="primary" :loading="decBusy" @click="runDecode">识别</el-button>
      </div>
      <el-input v-if="decResult" :model-value="decResult" type="textarea" :rows="3" readonly class="mono" style="margin-top: 10px" />
      <div v-if="decResult" class="form-row" style="margin-top: 8px">
        <el-button :icon="CopyDocument" @click="copy(decResult)">复制内容</el-button>
        <el-button v-if="decIsUrl" type="primary" plain @click="openUrl(decResult)">在浏览器打开</el-button>
      </div>
      <div v-if="decError" style="color: #f56c6c; font-size: 12px; margin-top: 10px">{{ decError }}</div>
    </div>

    <!-- 名单加拼音 -->
    <div v-else-if="tab === 'pinyin'" class="step-card">
      <div class="form-row">
        <div class="form-item" style="flex: 1">
          <FilePickList
            v-model="pinFiles"
            :multiple="false"
            :filters="[{ name: '数据文件', extensions: ['xlsx', 'json'] }]"
            button-text="选择名单文件"
            title="选择名单（xlsx 第 1 行表头或 json 数组）"
          />
        </div>
        <el-button plain @click="loadPinRecords">读取</el-button>
      </div>
      <div v-if="pinRecords.length" class="form-row" style="margin-top: 12px">
        <div class="form-item">
          <label>姓名列</label>
          <el-select v-model="pinField" placeholder="选择列" style="width: 160px">
            <el-option v-for="f in pinFields" :key="f" :label="f" :value="f" />
          </el-select>
        </div>
        <div class="form-item">
          <label>声调</label>
          <el-radio-group v-model="pinTone">
            <el-radio-button value="none">无声调</el-radio-button>
            <el-radio-button value="symbol">带声调</el-radio-button>
            <el-radio-button value="num">数字调</el-radio-button>
          </el-radio-group>
        </div>
        <div class="form-item">
          <label>形式</label>
          <el-radio-group v-model="pinMode">
            <el-radio-button value="full">全拼</el-radio-button>
            <el-radio-button value="initial">首字母</el-radio-button>
          </el-radio-group>
        </div>
      </div>
      <div class="form-row" style="margin-top: 12px">
        <OutDirPicker v-model="pinOutDir" title="选择输出文件夹" />
      </div>
      <div class="form-row" style="margin-top: 12px">
        <el-button type="primary" :loading="pinBusy" :disabled="!pinRecords.length" @click="runPinyin">生成拼音列 CSV</el-button>
      </div>
      <div v-if="pinOutput" class="file-list" style="margin-top: 8px">
        <span class="file-name">{{ basename(pinOutput) }}</span>
        <el-button size="small" link type="primary" @click="openPinDir">打开文件夹</el-button>
      </div>
    </div>

    <!-- 文本对比 -->
    <div v-else class="step-card">
      <div class="diff-inputs">
        <div>
          <div class="diff-head">
            <span>原文</span>
            <el-button size="small" link type="primary" @click="loadDiffFile('a')">从文件载入</el-button>
          </div>
          <el-input v-model="diffA" type="textarea" :rows="10" placeholder="粘贴原文…" />
        </div>
        <div>
          <div class="diff-head">
            <span>改后</span>
            <el-button size="small" link type="primary" @click="loadDiffFile('b')">从文件载入</el-button>
          </div>
          <el-input v-model="diffB" type="textarea" :rows="10" placeholder="粘贴修改后的文本…" />
        </div>
      </div>
      <div class="form-row" style="margin-top: 12px">
        <el-button type="primary" @click="runDiff">对比</el-button>
        <el-button plain @click="swapDiff">交换</el-button>
        <el-button plain @click="clearDiff">清空</el-button>
      </div>
      <template v-if="diffResult">
        <div class="diff-stats">
          <span class="d-add">+ {{ diffResult.added }} 新增</span>
          <span class="d-del">− {{ diffResult.deleted }} 删除</span>
          <span class="d-chg">~ {{ diffResult.changed }} 变更</span>
          <span class="d-same">{{ diffResult.same }} 未变</span>
          <span v-if="diffResult.truncated" class="d-warn">差异过多，已按整段对比</span>
        </div>
        <div class="diff-out">
          <div v-for="(l, i) in diffResult.lines" :key="i" class="diff-line" :class="'t-' + l.type">
            <span class="ln">{{ l.aNo ?? '' }}</span>
            <span class="ln">{{ l.bNo ?? '' }}</span>
            <span class="sg">{{ l.type === 'add' ? '+' : l.type === 'del' ? '−' : l.type === 'chg' ? '~' : '' }}</span>
            <span class="tx">{{ l.text || ' ' }}</span>
          </div>
        </div>
      </template>
    </div>
  </div>
</template>
