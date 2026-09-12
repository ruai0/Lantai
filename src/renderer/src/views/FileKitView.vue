<script setup lang="ts">
import { api } from '../utils/ipc'
import { computed, ref } from 'vue'
import { ElMessage } from 'element-plus'
import StepCard from '../components/StepCard.vue'
import OutDirPicker from '../components/OutDirPicker.vue'
import { call, callQ, basename } from '../utils/api'
import type { DuplicateGroup } from '@shared/types'

const tab = ref<'inventory' | 'duplicates' | 'zip'>('inventory')
const dir = ref('')
const outDir = ref('')
const recursive = ref(true)
const minSizeKB = ref(100)

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
  if (!outDir.value) {
    ElMessage.warning('请先选择输出文件夹')
  }
  running.value = true
  try {
    const r = await call(
      api.fileInventory({ dir: dir.value, recursive: recursive.value, outDir: outDir.value }),
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
    const r = await call(
      api.findDuplicates({
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

async function exportReport() {
  const r = await call(api.exportDuplicates({ groups: groups.value, outDir: outDir.value }), '报告导出完成')
  if (r) await api.openPath(r.outputPath)
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
const zipSourceDir = ref('')
const zipName = ref('')
const zipFiles = ref<string[]>([])
const zipOutDir = ref('')
const zipOutputs = ref<string[]>([])
const zipBusy = ref(false)

const ZIP_FILTER = [{ name: 'ZIP 压缩包', extensions: ['zip'] }]

async function browseZipSource() {
  const r = await api.pickDirectory('选择要打包的文件夹')
  if (r.ok && r.data) zipSourceDir.value = r.data
}

async function runZip() {
  zipOutputs.value = []
  const dir = zipOutDir.value
  if (!dir) {
    ElMessage.warning('请先选择输出文件夹')
    return
  }
  zipBusy.value = true
  try {
    if (zipMode.value === 'pack') {
      if (!zipSourceDir.value) {
        ElMessage.warning('请先选择要打包的文件夹')
        return
      }
      const r = await callQ(
        'ZIP 打包',
        () => api.zipPack({ dir: zipSourceDir.value, zipName: zipName.value, outDir: dir }),
        '打包完成'
      )
      if (r) zipOutputs.value = [r.outputPath]
    } else {
      if (!zipFiles.value.length) {
        ElMessage.warning('请先选择 zip 文件')
        return
      }
      const r = await call(
        api.zipUnpack({ paths: zipFiles.value, outDir: dir }),
        '解压完成'
      )
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
        <el-radio-group v-model="zipMode" @change="zipOutputs = []">
          <el-radio-button value="pack">打包文件夹</el-radio-button>
          <el-radio-button value="unpack">批量解压</el-radio-button>
        </el-radio-group>
      </StepCard>

      <StepCard :step="2" title="选择来源">
        <div v-if="zipMode === 'pack'">
          <el-input :model-value="zipSourceDir" readonly placeholder="选择要打包的文件夹" style="max-width: 480px">
            <template #append>
              <el-button @click="browseZipSource">浏览</el-button>
            </template>
          </el-input>
          <div class="form-row" style="margin-top: 12px">
            <div class="form-item">
              <label>压缩包名（留空用文件夹名）</label>
              <el-input v-model="zipName" placeholder="如：2026年一季度台账" style="width: 260px" clearable />
            </div>
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
        <OutDirPicker v-model="zipOutDir" />
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
      <div class="form-row" style="margin-top: 12px">
        <el-switch v-model="recursive" active-text="包含子文件夹" inactive-text="仅本层" />
      </div>
    </StepCard>

    <StepCard v-if="tab === 'inventory'" :step="2" title="输出位置">
      <OutDirPicker v-model="outDir" />
    </StepCard>
    <StepCard v-else :step="2" title="扫描设置">
      <div class="form-row">
        <div class="form-item">
          <label>只查大于（KB）</label>
          <el-input-number v-model="minSizeKB" :min="1" :max="1048576" :step="50" />
        </div>
      </div>
      <div class="page-desc" style="margin-top: 8px">
        按文件内容（MD5）判断是否重复，同名但内容不同的不算；体积越小扫描越慢，建议 100KB 起。
      </div>
    </StepCard>

    <StepCard :step="3" title="执行">
      <el-button v-if="tab === 'inventory'" type="primary" :loading="running" @click="runInventory">
        生成清单
      </el-button>
      <el-button v-else type="primary" :loading="running" @click="runDuplicates">开始扫描</el-button>

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
          :description="`清理冗余副本最多可释放约 ${fmtSize(wastedBytes)}。建议逐组核对后手动删除，本工具不会自动删除任何文件。`"
          show-icon
        />
        <el-button type="primary" style="margin-top: 12px" :disabled="!outDir" @click="exportReport">
          导出 Excel 报告
        </el-button>
        <el-table :data="tableData()" size="small" max-height="420" style="margin-top: 12px">
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
</style>
