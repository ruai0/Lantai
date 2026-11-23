<script setup lang="ts">
import { api } from '../utils/ipc'
import { computed, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import StepCard from '../components/StepCard.vue'
import OutDirPicker from '../components/OutDirPicker.vue'
import ResultPanel from '../components/ResultPanel.vue'
import { splitOutputTarget } from '@shared/namePattern'
import { call, callQ } from '../utils/api'
import { useEnterSubmit } from '../utils/useEnterSubmit'
import { useRemembered } from '../utils/useRememberedParams'
import type { DuplicateGroup } from '@shared/types'

/** 填完参数按 Enter 直接执行（主按钮已标 data-primary-action） */
useEnterSubmit()

const tab = ref<'inventory' | 'duplicates' | 'zip'>('inventory')
const dir = ref('')
const outDir = ref('')
const invName = ref('')
const dupName = ref('')
const recursive = ref(true)
const minSizeKB = ref(100)

// 记住页签与扫描范围设置（是否含子目录、最小体积阈值）：同类整理任务反复做
useRemembered('filekit', 'tab', tab)
useRemembered('filekit', 'recursive', recursive)
useRemembered('filekit', 'minSizeKB', minSizeKB)

const inventoryCount = ref(0)
const inventoryPath = ref('')

const groups = ref<DuplicateGroup[]>([])
const scanned = ref(0)
const running = ref(false)

const dupCount = computed(() => groups.value.reduce((n, g) => n + g.files.length, 0))
const wastedBytes = computed(() =>
  groups.value.reduce((n, g) => n + g.sizeBytes * (g.files.length - 1), 0)
)

function fmtSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`
}

function tableData(): Array<{ group: number; size: string; name: string; path: string }> {
  const rows: Array<{ group: number; size: string; name: string; path: string }> = []
  groups.value.forEach((g, i) => {
    g.files.forEach(f =>
      rows.push({ group: i + 1, size: fmtSize(f.sizeBytes), name: f.name, path: f.path })
    )
  })
  return rows
}

async function runInventory() {
  if (!dir.value) {
    ElMessage.warning('请先选择要整理的文件夹')
    return
  }
  const { dir: out, name: pathName } = splitOutputTarget(outDir.value)
  if (!out) {
    ElMessage.warning('请在输出位置填写或选择输出文件夹')
    return
  }
  running.value = true
  try {
    const r = await callQ(
      '生成文件清单',
      () => api.fileInventory({ dir: dir.value, recursive: recursive.value, outDir: out, name: invName.value.trim() || pathName }),
      '清单导出完成'
    )
    if (r) {
      inventoryCount.value = r.count
      inventoryPath.value = r.outputPath
    }
  } finally {
    running.value = false
  }
}

async function runDuplicates() {
  if (!dir.value) {
    ElMessage.warning('请先选择要扫描的文件夹')
    return
  }
  groups.value = []
  running.value = true
  try {
    const r = await callQ(
      '查找重复文件',
      () => api.findDuplicates({
        dir: dir.value,
        recursive: recursive.value,
        minSizeKB: minSizeKB.value
      }),
      '扫描完成'
    )
    if (r) {
      groups.value = r.groups
      scanned.value = r.scanned
    }
  } finally {
    running.value = false
  }
}

const dupOutputs = ref<string[]>([])

async function exportReport() {
  dupOutputs.value = []
  const { dir: out, name: pathName } = splitOutputTarget(outDir.value)
  if (!out) {
    ElMessage.warning('请在输出位置填写或选择输出文件夹')
    return
  }
  const r = await call(api.exportDuplicates({ groups: groups.value, outDir: out, name: dupName.value.trim() || pathName }), '报告导出完成')
  if (r) dupOutputs.value = [r.outputPath]
}

const keepStrategy = ref<'earliest' | 'latest' | 'shortest'>('earliest')
const resolving = ref(false)

async function doResolve() {
  if (!groups.value.length) return
  // 批量移动属于“大动作”，先让用户确认，避免误点
  try {
    await ElMessageBox.confirm(
      `将把 ${dupCount.value} 个重复文件中的多余副本移入各自目录下的「_重复文件」子文件夹（保留 ${keepStrategy.value === 'earliest' ? '修改时间最早' : keepStrategy.value === 'latest' ? '修改时间最新' : '路径最短'} 的那一份）。文件不会被删除，核对无误后可自行清空。是否继续？`,
      '确认一键去重',
      { type: 'warning', confirmButtonText: '开始去重', cancelButtonText: '取消' }
    )
  } catch {
    return
  }
  resolving.value = true
  try {
    const r = await call(
      api.resolveDuplicates({ groups: groups.value, keep: keepStrategy.value }),
      '去重完成'
    )
    if (r) {
      const failedNote = r.failed.length ? `，${r.failed.length} 个失败` : ''
      ElMessage.success(`已移动 ${r.moved} 个副本到 _重复文件（保留 ${r.kept} 份）${failedNote}`)
      await runDuplicates()
    }
  } finally {
    resolving.value = false
  }
}

async function openInventory() {
  await api.openPath(inventoryPath.value)
}

async function browseDir() {
  const r = await api.pickDirectory('选择要处理的文件夹')
  if (r.ok && r.data) dir.value = r.data
}

/* ---------- 压缩 / 解压 ---------- */

const zipMode = ref<'pack' | 'unpack'>('pack')
/** 打包来源：folder 打整个文件夹，files 挑选文件（保留相对层级） */
const zipPackSource = ref<'folder' | 'files'>('folder')
const zipSourceDir = ref('')
const zipPickFiles = ref<string[]>([])
const zipName = ref('')
const zipLevel = ref<'store' | 'normal' | 'max'>('normal')
const zipFiles = ref<string[]>([])
const zipOutDir = ref('')
const zipOutputs = ref<string[]>([])
const zipBusy = ref(false)
const zipPreview = ref<{ files: Array<{ rel: string; sizeBytes: number }>; totalBytes: number } | null>(null)
const zipPreviewLoading = ref(false)

useRemembered('filekit', 'zipMode', zipMode)
useRemembered('filekit', 'zipPackSource', zipPackSource)
useRemembered('filekit', 'zipLevel', zipLevel)

const ZIP_FILTER = [{ name: 'ZIP 压缩包', extensions: ['zip'] }]
const ANY_FILTER: Array<{ name: string; extensions: string[] }> = []

function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`
}

async function browseZipSource() {
  const r = await api.pickDirectory('选择要打包的文件夹')
  if (r.ok && r.data) zipSourceDir.value = r.data
}

/** 打包前预览将包含的文件清单，避免盲打包 */
async function refreshZipPreview() {
  zipPreview.value = null
  if (zipMode.value !== 'pack') return
  const payload =
    zipPackSource.value === 'folder'
      ? zipSourceDir.value
        ? { dir: zipSourceDir.value }
        : null
      : zipPickFiles.value.length
        ? { paths: zipPickFiles.value }
        : null
  if (!payload) return
  zipPreviewLoading.value = true
  try {
    const r = await api.zipList(payload)
    if (r.ok && r.data) zipPreview.value = r.data
  } finally {
    zipPreviewLoading.value = false
  }
}

async function runZip() {
  zipOutputs.value = []
  const { dir, name: pathName } = splitOutputTarget(zipOutDir.value)
  if (!dir) {
    ElMessage.warning('请在输出位置填写或选择输出文件夹')
    return
  }
  zipBusy.value = true
  try {
    if (zipMode.value === 'pack') {
      const payload: Record<string, unknown> = { zipName: zipName.value.trim() || pathName || '', outDir: dir, level: zipLevel.value }
      if (zipPackSource.value === 'folder') {
        if (!zipSourceDir.value) {
          ElMessage.warning('请先选择要打包的文件夹')
          return
        }
        payload.dir = zipSourceDir.value
      } else {
        if (!zipPickFiles.value.length) {
          ElMessage.warning('请先选择要打包的文件')
          return
        }
        payload.paths = zipPickFiles.value
      }
      const r = await callQ('ZIP 打包', () => api.zipPack(payload as never), '打包完成')
      if (r) {
        zipOutputs.value = [r.outputPath]
        zipPreview.value = null
      }
    } else {
      if (!zipFiles.value.length) {
        ElMessage.warning('请先选择 zip 文件')
        return
      }
      const r = await call(api.zipUnpack({ paths: zipFiles.value, outDir: dir }), '解压完成')
      if (r) zipOutputs.value = r.outputs
    }
  } finally {
    zipBusy.value = false
  }
}
</script>

<template>
  <div>
    <h1 class="page-title">文件管理</h1>
    <p class="page-desc">生成文件清单 / 查找重复文件。适合资料归档、送审清单、清理冗余存储。</p>

    <el-tabs v-model="tab" class="filekit-tabs">
      <el-tab-pane label="文件清单导出" name="inventory" />
      <el-tab-pane label="重复文件查找" name="duplicates" />
      <el-tab-pane label="压缩 / 解压" name="zip" />
    </el-tabs>

    <template v-if="tab === 'zip'">
      <StepCard :step="1" title="选择操作">
        <el-radio-group v-model="zipMode" @change="zipOutputs = []; zipPreview = null">
          <el-radio-button value="pack">打包压缩</el-radio-button>
          <el-radio-button value="unpack">批量解压</el-radio-button>
        </el-radio-group>
      </StepCard>

      <StepCard :step="2" title="选择来源">
        <div v-if="zipMode === 'pack'">
          <el-radio-group v-model="zipPackSource" style="margin-bottom: 12px" @change="zipPreview = null">
            <el-radio-button value="folder">整个文件夹</el-radio-button>
            <el-radio-button value="files">挑选若干文件</el-radio-button>
          </el-radio-group>
          <div v-if="zipPackSource === 'folder'">
            <el-input :model-value="zipSourceDir" readonly placeholder="选择要打包的文件夹" style="max-width: 480px">
              <template #append>
                <el-button @click="browseZipSource">浏览</el-button>
              </template>
            </el-input>
          </div>
          <FilePickList
            v-else
            v-model="zipPickFiles"
            :filters="ANY_FILTER"
            button-text="选择文件"
            title="选择要打包的文件（同目录结构会被保留）"
          />
          <div class="form-row mt-12">
            <div class="form-item">
              <label>压缩包名（留空用文件夹名）</label>
              <el-input v-model="zipName" placeholder="如：2026年一季度台账" style="width: 260px" clearable />
            </div>
            <div class="form-item">
              <label>压缩级别</label>
              <el-select v-model="zipLevel" style="width: 200px">
                <el-option value="store" label="仅打包（最快，不压缩）" />
                <el-option value="normal" label="标准压缩（推荐）" />
                <el-option value="max" label="最大压缩（体积最小）" />
              </el-select>
            </div>
          </div>
          <div class="mt-12">
            <el-button :loading="zipPreviewLoading" @click="refreshZipPreview">预览将打包的内容</el-button>
          </div>
          <div v-if="zipPreview" class="zip-preview">
            <p class="zip-preview-sum">
              共 {{ zipPreview.files.length }} 个文件，未压缩合计 {{ fmtBytes(zipPreview.totalBytes) }}
            </p>
            <el-table :data="zipPreview.files.slice(0, 200)" size="small" max-height="240" border>
              <el-table-column prop="rel" label="路径" show-overflow-tooltip />
              <el-table-column label="大小" width="110" align="right">
                <template #default="{ row }">{{ fmtBytes(row.sizeBytes) }}</template>
              </el-table-column>
            </el-table>
            <p v-if="zipPreview.files.length > 200" class="zip-preview-more">
              仅显示前 200 项，其余 {{ zipPreview.files.length - 200 }} 项省略
            </p>
          </div>
        </div>
        <FilePickList
          v-else
          v-model="zipFiles"
          :filters="ZIP_FILTER"
          button-text="选择 ZIP 文件"
          title="选择要解压的 ZIP 文件（可多选，每个包解到独立文件夹）"
        />
      </StepCard>

      <StepCard :step="3" title="输出位置">
        <OutDirPicker v-model="zipOutDir" file />
      </StepCard>

      <StepCard :step="4" title="执行">
        <el-button type="primary" :loading="zipBusy" @click="runZip">
          {{ zipMode === 'pack' ? '开始打包' : '开始解压' }}
        </el-button>
        <ResultPanel :outputs="zipOutputs" />
      </StepCard>
    </template>

    <template v-else>

    <StepCard :step="1" title="选择文件夹">
      <el-input
        :model-value="dir"
        readonly
        placeholder="选择要处理的文件夹"
        style="max-width: 480px"
      >
        <template #append>
          <el-button @click="browseDir">浏览</el-button>
        </template>
      </el-input>
      <div class="form-row mt-12">
        <el-switch v-model="recursive" active-text="包含子文件夹" inactive-text="仅本层" />
      </div>
    </StepCard>

    <StepCard v-if="tab === 'inventory'" :step="2" title="输出位置">
      <OutDirPicker v-model="outDir" file />
      <div class="form-row mt-12">
        <div class="form-item">
          <label>输出文件名</label>
          <el-input v-model="invName" placeholder="留空自动：文件清单_日期；也可直接在上方路径里带文件名" style="width: 320px" clearable />
        </div>
      </div>
    </StepCard>
    <StepCard v-else :step="2" title="扫描设置">
      <div class="form-row">
        <div class="form-item">
          <label>只查大于（KB）</label>
          <el-input-number v-model="minSizeKB" :min="1" :max="1048576" :step="50" />
        </div>
      </div>
      <div class="page-desc mt-8">
        按文件「内容」判断是否重复（逐字节比对，与文件名无关），同名但内容不同的不算；体积越小扫描越慢，建议 100KB 起。
      </div>
      <div class="mt-12">
        <OutDirPicker v-model="outDir" file />
      </div>
      <div class="form-row mt-12">
        <div class="form-item">
          <label>报告文件名</label>
          <el-input v-model="dupName" placeholder="留空自动：重复文件报告_日期；也可直接在上方路径里带文件名" style="width: 320px" clearable />
        </div>
      </div>
    </StepCard>

    <StepCard :step="3" title="执行">
      <el-button v-if="tab === 'inventory'" type="primary" :loading="running" data-primary-action @click="runInventory">
        生成清单
      </el-button>
      <el-button v-else type="primary" :loading="running" data-primary-action @click="runDuplicates">开始扫描</el-button>

      <el-result
        v-if="tab === 'inventory' && inventoryPath"
        icon="success"
        :title="`清单已导出，共 ${inventoryCount} 个文件`"
      >
        <template #extra>
          <el-button type="primary" @click="openInventory">打开清单</el-button>
        </template>
      </el-result>

      <div v-if="tab === 'duplicates' && groups.length" style="width: 100%">
        <el-alert
          type="warning"
          :closable="false"
          :title="`扫描 ${scanned} 个文件，发现 ${groups.length} 组重复（共 ${dupCount} 个文件）`"
          :description="`清理冗余副本最多可释放约 ${fmtSize(wastedBytes)}。`"
          show-icon
        />
        <div class="form-row mt-12">
          <el-button type="primary" :disabled="!outDir" @click="exportReport">导出 Excel 报告</el-button>
          <div class="form-item">
            <label>保留哪一份</label>
            <el-select v-model="keepStrategy" style="width: 190px">
              <el-option label="保留修改时间最早的" value="earliest" />
              <el-option label="保留修改时间最新的" value="latest" />
              <el-option label="保留路径最短的（目录更浅）" value="shortest" />
            </el-select>
          </div>
          <el-button type="danger" plain :loading="resolving" @click="doResolve">一键去重（移入 _重复文件）</el-button>
        </div>
        <div class="page-desc mt-6">
          一键去重只把多余副本移动到同一目录下的「_重复文件」子文件夹，不删除任何文件，核对无误后可自行清空。
        </div>
        <ResultPanel :outputs="dupOutputs" />
        <el-table :data="tableData()" size="small" max-height="420" class="mt-12">
          <el-table-column prop="group" label="组" width="60" />
          <el-table-column prop="size" label="大小" width="100" />
          <el-table-column prop="name" label="文件名" width="260" show-overflow-tooltip />
          <el-table-column prop="path" label="完整路径" show-overflow-tooltip />
        </el-table>
      </div>
      <el-alert
        v-else-if="tab === 'duplicates' && scanned > 0 && !groups.length"
        type="success"
        :closable="false"
        :title="`扫描了 ${scanned} 个文件，没有发现重复内容`"
      />
    </StepCard>
    </template>
  </div>
</template>

<style scoped>
.filekit-tabs {
  margin-bottom: 10px;
}
.zip-preview {
  margin-top: 12px;
  padding: 12px;
  border: 1px solid var(--line);
  border-radius: var(--r-md);
  background: var(--surface-2);
}
.zip-preview-sum {
  margin: 0 0 8px;
  font-size: 13px;
  color: var(--text-1);
}
.zip-preview-more {
  margin: 6px 0 0;
  font-size: 12px;
  color: var(--text-3, #909399);
}
</style>
