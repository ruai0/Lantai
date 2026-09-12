<script setup lang="ts">
import { api } from '../utils/ipc'
import { computed, reactive, ref } from 'vue'
import { ElMessage } from 'element-plus'
import StepCard from '../components/StepCard.vue'
import FilePickList from '../components/FilePickList.vue'
import OutDirPicker from '../components/OutDirPicker.vue'
import ResultPanel from '../components/ResultPanel.vue'
import { call } from '../utils/api'
import type { ExcelCompareResult, ExcelMatchFillResult } from '@shared/types'

const XLSX_FILTER = [{ name: 'Excel 文件', extensions: ['xlsx'] }]

const tab = ref<'fill' | 'compare'>('fill')

interface Slot {
  files: string[]
  headers: string[]
  key: string
}

function newSlot(): Slot {
  return reactive<Slot>({ files: [], headers: [], key: '' })
}

const outDir = ref('')
const running = ref(false)

/* ---------- 匹配填充 ---------- */
const mMain = newSlot()
const mLook = newSlot()
const mFetch = ref<string[]>([])
const mNotFound = ref('')
const fillResult = ref<ExcelMatchFillResult | null>(null)

async function loadHeaders(slot: Slot) {
  if (!slot.files.length) {
    ElMessage.warning('请先选择文件')
    return
  }
  const r = await call(api.excelReadHeaders({ path: slot.files[0] }))
  if (r) {
    slot.headers = r.headers
    slot.key = ''
    ElMessage.success(`已读取 ${r.headers.length} 个列名`)
  }
}

async function runFill() {
  fillResult.value = null
  if (!mMain.files.length || !mLook.files.length) {
    ElMessage.warning('请分别选择主表和副表')
    return
  }
  if (!mMain.key || !mLook.key) {
    ElMessage.warning('请为两个表各选一个关联列（如工号、单位编码）')
    return
  }
  if (!mFetch.value.length) {
    ElMessage.warning('请至少选择一列要取过来的数据')
    return
  }
  const dir = outDir.value
  if (!dir) {
    ElMessage.warning('请先选择输出文件夹')
    return
  }
  running.value = true
  try {
    const r = await call(
      api.excelMatchFill({
        mainPath: mMain.files[0],
        mainKey: mMain.key,
        lookupPath: mLook.files[0],
        lookupKey: mLook.key,
        fetchColumns: mFetch.value,
        notFoundText: mNotFound.value,
        outDir: dir
      }),
      '匹配完成'
    )
    if (r) fillResult.value = r
  } finally {
    running.value = false
  }
}

/* ---------- 两表比对 ---------- */
const cA = newSlot()
const cB = newSlot()
const cColumns = ref<string[]>([])
const compareResult = ref<ExcelCompareResult | null>(null)

const sharedColumns = computed(() => {
  const setB = new Set(cB.headers)
  return cA.headers.filter(h => h && setB.has(h))
})

async function runCompare() {
  compareResult.value = null
  if (!cA.files.length || !cB.files.length) {
    ElMessage.warning('请分别选择两个表')
    return
  }
  if (!cA.key || !cB.key) {
    ElMessage.warning('请为两个表各选一个关联列')
    return
  }
  const dir = outDir.value
  if (!dir) {
    ElMessage.warning('请先选择输出文件夹')
    return
  }
  running.value = true
  try {
    const r = await call(
      api.excelCompare({
        aPath: cA.files[0],
        aKey: cA.key,
        bPath: cB.files[0],
        bKey: cB.key,
        columns: cColumns.value,
        outDir: dir
      }),
      '比对完成'
    )
    if (r) {
      compareResult.value = r
    }
  } finally {
    running.value = false
  }
}
</script>

<template>
  <div>
    <h1 class="page-title">表格匹配 / 比对</h1>
    <p class="page-desc">
      台账核对利器：跨表匹配填充（VLOOKUP 替代）与两版名单差异比对，全程本地处理。
    </p>

    <el-tabs v-model="tab" class="match-tabs">
      <el-tab-pane label="跨表匹配填充" name="fill" />
      <el-tab-pane label="两表差异比对" name="compare" />
    </el-tabs>

    <template v-if="tab === 'fill'">
      <StepCard :step="1" title="主表（要补数据的表）">
        <FilePickList
          v-model="mMain.files"
          :filters="XLSX_FILTER"
          :multiple="false"
          button-text="选择主表"
          title="选择主表 .xlsx（取第一个工作表）"
        />
        <div class="form-row" style="margin-top: 10px">
          <el-button plain @click="loadHeaders(mMain)">读取表头</el-button>
          <div class="form-item">
            <label>关联列</label>
            <el-select v-model="mMain.key" placeholder="先读取表头" style="width: 200px" :disabled="!mMain.headers.length">
              <el-option v-for="h in mMain.headers" :key="h" :label="h" :value="h" />
            </el-select>
          </div>
        </div>
      </StepCard>

      <StepCard :step="2" title="副表（数据来源表）">
        <FilePickList
          v-model="mLook.files"
          :filters="XLSX_FILTER"
          :multiple="false"
          button-text="选择副表"
          title="选择副表 .xlsx（取第一个工作表）"
        />
        <div class="form-row" style="margin-top: 10px">
          <el-button plain @click="loadHeaders(mLook)">读取表头</el-button>
          <div class="form-item">
            <label>关联列</label>
            <el-select v-model="mLook.key" placeholder="先读取表头" style="width: 200px" :disabled="!mLook.headers.length">
              <el-option v-for="h in mLook.headers" :key="h" :label="h" :value="h" />
            </el-select>
          </div>
        </div>
        <div class="form-row" style="margin-top: 10px">
          <div class="form-item" style="flex: 1">
            <label>要取过来的列（可多选）</label>
            <el-select v-model="mFetch" multiple collapse-tags collapse-tags-tooltip placeholder="先读取副表表头" style="width: 100%" :disabled="!mLook.headers.length">
              <el-option v-for="h in mLook.headers" :key="h" :label="h" :value="h" />
            </el-select>
          </div>
          <div class="form-item">
            <label>未匹配到时填</label>
            <el-input v-model="mNotFound" placeholder="留空 = 空" style="width: 140px" clearable />
          </div>
        </div>
      </StepCard>
    </template>

    <template v-else>
      <StepCard :step="1" title="A 表（旧版）">
        <FilePickList
          v-model="cA.files"
          :filters="XLSX_FILTER"
          :multiple="false"
          button-text="选择 A 表"
          title="选择 A 表（视为基准）"
        />
        <div class="form-row" style="margin-top: 10px">
          <el-button plain @click="loadHeaders(cA)">读取表头</el-button>
          <div class="form-item">
            <label>关联列</label>
            <el-select v-model="cA.key" placeholder="先读取表头" style="width: 200px" :disabled="!cA.headers.length">
              <el-option v-for="h in cA.headers" :key="h" :label="h" :value="h" />
            </el-select>
          </div>
        </div>
      </StepCard>

      <StepCard :step="2" title="B 表（新版）">
        <FilePickList
          v-model="cB.files"
          :filters="XLSX_FILTER"
          :multiple="false"
          button-text="选择 B 表"
          title="选择 B 表（视为更新后）"
        />
        <div class="form-row" style="margin-top: 10px">
          <el-button plain @click="loadHeaders(cB)">读取表头</el-button>
          <div class="form-item">
            <label>关联列</label>
            <el-select v-model="cB.key" placeholder="先读取表头" style="width: 200px" :disabled="!cB.headers.length">
              <el-option v-for="h in cB.headers" :key="h" :label="h" :value="h" />
            </el-select>
          </div>
        </div>
        <div class="form-row" style="margin-top: 10px">
          <div class="form-item" style="flex: 1">
            <label>比较哪些列（留空 = 全部共有列）</label>
            <el-select v-model="cColumns" multiple collapse-tags collapse-tags-tooltip placeholder="两表共有的列" style="width: 100%">
              <el-option v-for="h in sharedColumns" :key="h" :label="h" :value="h" />
            </el-select>
          </div>
        </div>
      </StepCard>
    </template>

    <StepCard :step="3" title="输出位置">
      <OutDirPicker v-model="outDir" />
    </StepCard>

    <StepCard :step="4" title="执行">
      <el-button v-if="tab === 'fill'" type="primary" :loading="running" @click="runFill">开始匹配</el-button>
      <el-button v-else type="primary" :loading="running" @click="runCompare">开始比对</el-button>

      <template v-if="tab === 'fill' && fillResult">
        <el-alert
          type="success"
          :closable="false"
          style="margin-top: 12px"
          :title="`共 ${fillResult.total} 行：匹配 ${fillResult.matched} 行，未匹配 ${fillResult.unmatched} 行`"
        />
        <ResultPanel :outputs="fillResult.outputs" />
      </template>

      <el-alert
        v-if="tab === 'compare' && compareResult"
        type="success"
        :closable="false"
        style="margin-top: 12px"
        :title="`新增 ${compareResult.onlyInB}、删除 ${compareResult.onlyInA}、变更 ${compareResult.changed} 处、一致 ${compareResult.same} 条`"
        description="差异报告已导出为 Excel 并自动打开（三段：B中已删除 / 新增 / 变更明细）。"
      />
    </StepCard>
  </div>
</template>

<style scoped>
.match-tabs {
  margin-bottom: 10px;
}
</style>
