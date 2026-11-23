<script setup lang="ts">
import { api } from '../utils/ipc'
import { computed, reactive, ref } from 'vue'
import { ElMessage } from 'element-plus'
import StepCard from '../components/StepCard.vue'
import FilePickList from '../components/FilePickList.vue'
import OutDirPicker from '../components/OutDirPicker.vue'
import ResultPanel from '../components/ResultPanel.vue'
import { call } from '../utils/api'
import { useEnterSubmit } from '../utils/useEnterSubmit'
import { useReadyGate } from '../utils/useReadyGate'
import { useRemembered } from '../utils/useRememberedParams'
import type { ExcelCompareResult, ExcelMatchFillResult } from '@shared/types'

/** 填完参数按 Enter 直接执行（主按钮已标 data-primary-action） */
useEnterSubmit()

/** 匹配填充：两张表、两个关联列、至少一列要取的数据，缺一不可 */
const { blocked: fillBlocked, reason: fillReason } = useReadyGate(() => [
  { label: '主表', ok: mMain.files.length > 0 },
  { label: '副表', ok: mLook.files.length > 0 },
  { label: '主表关联列', ok: !!mMain.key },
  { label: '副表关联列', ok: !!mLook.key },
  { label: '要取的数据列', ok: mFetch.value.length > 0 }
])

/** 差异比对：两张表 + 两个关联列 */
const { blocked: cmpBlocked, reason: cmpReason } = useReadyGate(() => [
  { label: '表 A', ok: cA.files.length > 0 },
  { label: '表 B', ok: cB.files.length > 0 },
  { label: 'A 的关联列', ok: !!cA.key },
  { label: 'B 的关联列', ok: !!cB.key }
])

const XLSX_FILTER = [{ name: 'Excel 文件', extensions: ['xlsx'] }]

const tab = ref<'fill' | 'compare'>('fill')
// 记住上次用的页签与「主表缺列时」的取值来源，重做同类任务免重选
useRemembered('match', 'tab', tab)

interface Slot {
  files: string[]
  headers: string[]
  key: string
  /** 表头所在行（1-based） */
  headerRow: number
  /** 工作表名；空 = 第一个 */
  sheet: string
  sheets: string[]
}

function newSlot(): Slot {
  return reactive<Slot>({ files: [], headers: [], key: '', headerRow: 1, sheet: '', sheets: [] })
}

const outDir = ref('')
const running = ref(false)

/* ---------- 匹配填充 ---------- */
const mMain = newSlot()
const mLook = newSlot()
const mFetch = ref<string[]>([])
const mNotFound = ref('')
const fillResult = ref<ExcelMatchFillResult | null>(null)

/** 读取工作表列表（选文件后自动调用） */
async function loadSheets(slot: Slot) {
  if (!slot.files.length) return
  const r = await call(api.excelListSheets({ path: slot.files[0] }))
  if (r) {
    slot.sheets = r
    slot.sheet = ''
  }
}

async function loadHeaders(slot: Slot) {
  if (!slot.files.length) {
    ElMessage.warning('请先选择文件')
    return
  }
  const r = await call(
    api.excelReadHeaders({ path: slot.files[0], headerRow: slot.headerRow, sheet: slot.sheet || undefined })
  )
  if (r) {
    slot.headers = r.headers
    slot.key = ''
    ElMessage.success(`已读取 ${r.headers.length} 个列名`)
  }
}

/** 选文件后重置并自动读取工作表 */
function onFileChange(slot: Slot) {
  slot.headers = []
  slot.key = ''
  void loadSheets(slot)
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
        mainHeaderRow: mMain.headerRow,
        mainSheet: mMain.sheet || undefined,
        lookupPath: mLook.files[0],
        lookupKey: mLook.key,
        lookupHeaderRow: mLook.headerRow,
        lookupSheet: mLook.sheet || undefined,
        fetchColumns: mFetch.value,
        notFoundText: mNotFound.value,
        outDir: dir
      }),
      '匹配完成'
    )
    if (r) {
      fillResult.value = r
    }
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
  const norm = (s: string) => s.replace(/[\s\u3000]/g, '').replace(/[\uff01-\uff5e]/g, ch => String.fromCharCode(ch.charCodeAt(0) - 0xfee0)).toLowerCase()
  const setB = new Map(cB.headers.map(h => [norm(h), h]))
  return cA.headers.filter(h => h && setB.has(norm(h)))
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
        aHeaderRow: cA.headerRow,
        aSheet: cA.sheet || undefined,
        bPath: cB.files[0],
        bKey: cB.key,
        bHeaderRow: cB.headerRow,
        bSheet: cB.sheet || undefined,
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
          title="选择主表 .xlsx"
          @update:model-value="onFileChange(mMain)"
        />
        <div class="form-row mt-10">
          <div class="form-item">
            <label>工作表</label>
            <el-select v-model="mMain.sheet" placeholder="第一个工作表" style="width: 160px" clearable @change="loadHeaders(mMain)">
              <el-option v-for="s in mMain.sheets" :key="s" :label="s" :value="s" />
            </el-select>
          </div>
          <div class="form-item">
            <label>表头在第几行</label>
            <el-input-number v-model="mMain.headerRow" :min="1" :max="50" size="small" @change="loadHeaders(mMain)" />
          </div>
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
          title="选择副表 .xlsx"
          @update:model-value="onFileChange(mLook)"
        />
        <div class="form-row mt-10">
          <div class="form-item">
            <label>工作表</label>
            <el-select v-model="mLook.sheet" placeholder="第一个工作表" style="width: 160px" clearable @change="loadHeaders(mLook)">
              <el-option v-for="s in mLook.sheets" :key="s" :label="s" :value="s" />
            </el-select>
          </div>
          <div class="form-item">
            <label>表头在第几行</label>
            <el-input-number v-model="mLook.headerRow" :min="1" :max="50" size="small" @change="loadHeaders(mLook)" />
          </div>
          <el-button plain @click="loadHeaders(mLook)">读取表头</el-button>
          <div class="form-item">
            <label>关联列</label>
            <el-select v-model="mLook.key" placeholder="先读取表头" style="width: 200px" :disabled="!mLook.headers.length">
              <el-option v-for="h in mLook.headers" :key="h" :label="h" :value="h" />
            </el-select>
          </div>
        </div>
        <div class="form-row mt-10">
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
          @update:model-value="onFileChange(cA)"
        />
        <div class="form-row mt-10">
          <div class="form-item">
            <label>工作表</label>
            <el-select v-model="cA.sheet" placeholder="第一个工作表" style="width: 160px" clearable @change="loadHeaders(cA)">
              <el-option v-for="s in cA.sheets" :key="s" :label="s" :value="s" />
            </el-select>
          </div>
          <div class="form-item">
            <label>表头在第几行</label>
            <el-input-number v-model="cA.headerRow" :min="1" :max="50" size="small" @change="loadHeaders(cA)" />
          </div>
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
          @update:model-value="onFileChange(cB)"
        />
        <div class="form-row mt-10">
          <div class="form-item">
            <label>工作表</label>
            <el-select v-model="cB.sheet" placeholder="第一个工作表" style="width: 160px" clearable @change="loadHeaders(cB)">
              <el-option v-for="s in cB.sheets" :key="s" :label="s" :value="s" />
            </el-select>
          </div>
          <div class="form-item">
            <label>表头在第几行</label>
            <el-input-number v-model="cB.headerRow" :min="1" :max="50" size="small" @change="loadHeaders(cB)" />
          </div>
          <el-button plain @click="loadHeaders(cB)">读取表头</el-button>
          <div class="form-item">
            <label>关联列</label>
            <el-select v-model="cB.key" placeholder="先读取表头" style="width: 200px" :disabled="!cB.headers.length">
              <el-option v-for="h in cB.headers" :key="h" :label="h" :value="h" />
            </el-select>
          </div>
        </div>
        <div class="form-row mt-10">
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
      <div class="page-desc mt-6">完成后是否打开结果由「设置 → 完成与关闭行为」统一决定。</div>
    </StepCard>

    <StepCard :step="4" title="执行">
      <el-button
        v-if="tab === 'fill'"
        type="primary"
        :loading="running"
        :disabled="fillBlocked"
        :title="fillReason"
        :data-blocked-reason="fillReason"
        data-primary-action
        @click="runFill"
      >
        开始匹配
      </el-button>
      <el-button
        v-else
        type="primary"
        :loading="running"
        :disabled="cmpBlocked"
        :title="cmpReason"
        :data-blocked-reason="cmpReason"
        data-primary-action
        @click="runCompare"
      >
        开始比对
      </el-button>

      <template v-if="tab === 'fill' && fillResult">
        <el-alert
          type="success"
          :closable="false"
          class="mt-12"
          :title="`共 ${fillResult.total} 行：匹配 ${fillResult.matched} 行，未匹配 ${fillResult.unmatched} 行`"
        />
        <el-alert
          v-if="fillResult.unmatched > 0"
          type="warning"
          :closable="false"
          class="mt-8"
          title="结果表最后一列「匹配状态」标出了未匹配的行，可直接在 Excel 里筛选复核。"
        />
        <el-alert
          v-if="fillResult.dupKeys && fillResult.dupKeys.length"
          type="warning"
          :closable="false"
          class="mt-8"
          :title="`副表有 ${fillResult.dupKeys.length} 个关联键重复（匹配时取首条），如：${fillResult.dupKeys.slice(0, 5).join('、')}${fillResult.dupKeys.length > 5 ? ' 等' : ''}`"
        />
        <ResultPanel :outputs="fillResult.outputs" />
      </template>

      <template v-if="tab === 'compare' && compareResult">
        <el-alert
          type="success"
          :closable="false"
          class="mt-12"
          :title="`新增 ${compareResult.onlyInB}、删除 ${compareResult.onlyInA}、变更 ${compareResult.changed} 处、一致 ${compareResult.same} 条`"
          description="差异报告已导出为 Excel 并自动打开（三段：B中已删除 / 新增 / 变更明细）。"
        />
        <el-alert
          v-if="compareResult.dupKeys && compareResult.dupKeys.length"
          type="warning"
          :closable="false"
          class="mt-8"
          :title="`⚠ 有 ${compareResult.dupKeys.length} 个关联键存在重复（共 ${compareResult.droppedRows ?? 0} 行未参与比对），结果可能不完整，请先核对关联键唯一性`"
          :description="`重复键如：${compareResult.dupKeys.slice(0, 5).join('、')}${compareResult.dupKeys.length > 5 ? ' 等' : ''}`"
        />
      </template>
    </StepCard>
  </div>
</template>

<style scoped>
.match-tabs {
  margin-bottom: 10px;
}
</style>
