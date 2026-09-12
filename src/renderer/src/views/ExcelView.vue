<script setup lang="ts">
import { api } from '../utils/ipc'
import { computed, ref } from 'vue'
import { ElMessage } from 'element-plus'
import StepCard from '../components/StepCard.vue'
import FilePickList from '../components/FilePickList.vue'
import OutDirPicker from '../components/OutDirPicker.vue'
import ResultPanel from '../components/ResultPanel.vue'
import { call } from '../utils/api'
import type { ExcelMergeMode, MaskPreview, MaskRule } from '@shared/types'

const XLSX_FILTER = [{ name: 'Excel 文件', extensions: ['xlsx'] }]
const CSV_FILTER = [{ name: 'CSV 文件', extensions: ['csv'] }]

const tab = ref<'merge' | 'splitSheets' | 'splitRows' | 'splitCol' | 'csv' | 'mask'>('merge')

const mergeFiles = ref<string[]>([])
const mergeMode = ref<ExcelMergeMode>('sheets')
const splitSheetsFile = ref<string[]>([])
const splitRowsFile = ref<string[]>([])
const rowsPerFile = ref(500)
const csvFiles = ref<string[]>([])
const csvEncoding = ref<'utf8' | 'gbk'>('utf8')

const maskFile = ref<string[]>([])
const maskColumns = ref<string[]>([])
const columnOptions = ref<string[]>([])
const maskRule = ref<MaskRule>('phone')
const keepHead = ref(0)
const keepTail = ref(4)

const splitColFile = ref<string[]>([])
const splitColHeaders = ref<string[]>([])
const splitColColumn = ref('')
const splitColGroups = ref(0)

const outDir = ref('')
const outputs = ref<string[]>([])
const previews = ref<MaskPreview[]>([])
const failed = ref<Array<{ name: string; reason: string }>>([])
const running = ref(false)

function singleOf(v: string[]): string {
  return v[0] ?? ''
}

async function loadHeaders() {
  if (!maskFile.value.length) {
    ElMessage.warning('请先选择 Excel 文件')
    return
  }
  const r = await call(api.excelReadHeaders({ path: singleOf(maskFile.value) }))
  if (r) {
    columnOptions.value = r.headers
    maskColumns.value = []
    ElMessage.success(`已读取 ${r.headers.length} 个列名`)
  }
}

async function loadSplitColHeaders() {
  if (!splitColFile.value.length) {
    ElMessage.warning('请先选择 Excel 文件')
    return
  }
  const r = await call(api.excelReadHeaders({ path: singleOf(splitColFile.value) }))
  if (r) {
    splitColHeaders.value = r.headers
    splitColColumn.value = ''
    ElMessage.success(`已读取 ${r.headers.length} 个列名`)
  }
}

async function run() {
  outputs.value = []
  previews.value = []
  failed.value = []
  const dir = outDir.value
  if (!dir) {
    ElMessage.warning('请先选择输出文件夹')
    return
  }
  running.value = true
  try {
    if (tab.value === 'merge') {
      if (mergeFiles.value.length < 2) {
        ElMessage.warning('合并至少需要选择两个 Excel 文件')
        return
      }
      const r = await call(
        api.excelMerge({ paths: mergeFiles.value, mode: mergeMode.value, outDir: dir }),
        '合并完成'
      )
      if (r) outputs.value = r.outputs
    } else if (tab.value === 'splitSheets') {
      if (!splitSheetsFile.value.length) {
        ElMessage.warning('请先选择文件')
        return
      }
      const r = await call(
        api.excelSplitSheets({ path: singleOf(splitSheetsFile.value), outDir: dir }),
        '拆分完成'
      )
      if (r) outputs.value = r.outputs
    } else if (tab.value === 'splitRows') {
      if (!splitRowsFile.value.length) {
        ElMessage.warning('请先选择文件')
        return
      }
      const r = await call(
        api.excelSplitRows({
          path: singleOf(splitRowsFile.value),
          rowsPerFile: rowsPerFile.value,
          outDir: dir
        }),
        '拆分完成'
      )
      if (r) outputs.value = r.outputs
    } else if (tab.value === 'splitCol') {
      if (!splitColFile.value.length) {
        ElMessage.warning('请先选择文件')
        return
      }
      if (!splitColColumn.value) {
        ElMessage.warning('请先点「读取表头」并选择分组列')
        return
      }
      splitColGroups.value = 0
      const r = await call(
        api.excelSplitColumn({
          path: singleOf(splitColFile.value),
          column: splitColColumn.value,
          outDir: dir
        }),
        '拆分完成'
      )
      if (r) {
        outputs.value = r.outputs
        splitColGroups.value = r.groups
      }
    } else if (tab.value === 'csv') {
      if (!csvFiles.value.length) {
        ElMessage.warning('请先选择 CSV 文件')
        return
      }
      const r = await call(
        api.excelCsvToXlsx({ paths: csvFiles.value, encoding: csvEncoding.value, outDir: dir }),
        '转换完成'
      )
      if (r) outputs.value = r.outputs
    } else {
      if (!maskFile.value.length) {
        ElMessage.warning('请先选择 Excel 文件')
        return
      }
      if (!maskColumns.value.length) {
        ElMessage.warning('请先点「读取表头」并选择要脱敏的列')
        return
      }
      const r = await call(
        api.excelMask({
          path: singleOf(maskFile.value),
          columns: maskColumns.value,
          rule: maskRule.value,
          keepHead: keepHead.value,
          keepTail: keepTail.value,
          outDir: dir
        }),
        '脱敏完成'
      )
      if (r) {
        outputs.value = r.outputs
        previews.value = r.previews
      }
    }
  } finally {
    running.value = false
  }
}

const hasParams = computed(() => tab.value !== 'splitSheets')
const outStep = computed(() => (hasParams.value ? 3 : 2))
const runLabel = computed(
  () =>
    (
      {
        merge: '开始合并',
        splitSheets: '开始拆分',
        splitRows: '开始拆分',
        splitCol: '开始拆分',
        csv: '开始转换',
        mask: '开始脱敏'
      } as Record<string, string>
    )[tab.value]
)
</script>

<template>
  <div>
    <h1 class="page-title">Excel 工具</h1>
    <p class="page-desc">多簿合并 / 拆分 / CSV 转换 / 数据脱敏。仅支持 .xlsx（旧 .xls 请先另存为 .xlsx）。</p>

    <el-tabs v-model="tab" class="excel-tabs">
      <el-tab-pane label="多簿合并" name="merge" />
      <el-tab-pane label="按表拆分" name="splitSheets" />
      <el-tab-pane label="按行拆分" name="splitRows" />
      <el-tab-pane label="按列值拆分" name="splitCol" />
      <el-tab-pane label="CSV转Excel" name="csv" />
      <el-tab-pane label="数据脱敏" name="mask" />
    </el-tabs>

    <StepCard :step="1" title="选择文件">
      <FilePickList
        v-if="tab === 'merge'"
        v-model="mergeFiles"
        :filters="XLSX_FILTER"
        button-text="选择多个 Excel"
        title="选择要合并的 Excel 文件"
      />
      <FilePickList
        v-else-if="tab === 'splitSheets'"
        v-model="splitSheetsFile"
        :filters="XLSX_FILTER"
        :multiple="false"
        button-text="选择 Excel"
        title="选择要按工作表拆分的文件"
      />
      <FilePickList
        v-else-if="tab === 'splitRows'"
        v-model="splitRowsFile"
        :filters="XLSX_FILTER"
        :multiple="false"
        button-text="选择 Excel"
        title="选择要按行数拆分的文件（取第一个工作表）"
      />
      <FilePickList
        v-else-if="tab === 'splitCol'"
        v-model="splitColFile"
        :filters="XLSX_FILTER"
        :multiple="false"
        button-text="选择 Excel"
        title="选择要按列值拆分的文件（取第一个工作表）"
      />
      <FilePickList
        v-else-if="tab === 'csv'"
        v-model="csvFiles"
        :filters="CSV_FILTER"
        button-text="选择 CSV 文件"
        title="选择要转为 Excel 的 CSV 文件"
      />
      <FilePickList
        v-else
        v-model="maskFile"
        :filters="XLSX_FILTER"
        :multiple="false"
        button-text="选择 Excel"
        title="选择要脱敏的文件（取第一个工作表）"
      />
    </StepCard>

    <StepCard v-if="tab === 'merge'" :step="2" title="合并方式">
      <el-radio-group v-model="mergeMode">
        <el-radio-button value="sheets">每个文件一个工作表</el-radio-button>
        <el-radio-button value="single">合并成一张表（按表头对齐）</el-radio-button>
      </el-radio-group>
      <div class="page-desc" style="margin-top: 8px">
        「合并成一张表」取各文件第一个工作表，第 1 行为表头，按列名对齐纵向追加。
      </div>
    </StepCard>

    <StepCard v-if="tab === 'splitRows'" :step="2" title="拆分设置">
      <div class="form-row">
        <div class="form-item">
          <label>每个文件的数据行数</label>
          <el-input-number v-model="rowsPerFile" :min="1" :max="1000000" :step="100" />
        </div>
      </div>
      <div class="page-desc" style="margin-top: 8px">拆分出的每个文件都会带上第 1 行表头。</div>
    </StepCard>

    <StepCard v-if="tab === 'splitCol'" :step="2" title="拆分设置">
      <el-button type="primary" plain @click="loadSplitColHeaders">读取表头</el-button>
      <div class="form-row" style="margin-top: 12px">
        <div class="form-item">
          <label>按哪一列的值拆分</label>
          <el-select
            v-model="splitColColumn"
            placeholder="先读取表头"
            style="width: 280px"
            :disabled="!splitColHeaders.length"
          >
            <el-option v-for="h in splitColHeaders" :key="h" :label="h" :value="h" />
          </el-select>
        </div>
      </div>
      <div class="page-desc" style="margin-top: 8px">
        每个不同的值生成一个文件（如按「单位」「月份」拆分台账），文件名自动带上该值；每个文件都带表头。
      </div>
      <el-alert
        v-if="splitColGroups > 0"
        style="margin-top: 10px"
        type="success"
        :closable="false"
        :title="`共按 ${splitColGroups} 个不同的值拆分`"
      />
    </StepCard>

    <StepCard v-if="tab === 'csv'" :step="2" title="编码">
      <el-radio-group v-model="csvEncoding">
        <el-radio-button value="utf8">UTF-8</el-radio-button>
        <el-radio-button value="gbk">GBK / 简体中文</el-radio-button>
      </el-radio-group>
      <div class="page-desc" style="margin-top: 8px">
        老系统 / 部分业务平台导出的 CSV 常为 GBK 编码；乱码时请换另一个试试。
      </div>
    </StepCard>

    <StepCard v-if="tab === 'mask'" :step="2" title="脱敏设置">
      <el-button type="primary" plain @click="loadHeaders">读取表头</el-button>
      <div class="form-row" style="margin-top: 12px">
        <div class="form-item">
          <label>要脱敏的列（可多选）</label>
          <el-select
            v-model="maskColumns"
            multiple
            collapse-tags
            collapse-tags-tooltip
            placeholder="先读取表头"
            style="width: 320px"
            :disabled="!columnOptions.length"
          >
            <el-option v-for="h in columnOptions" :key="h" :label="h" :value="h" />
          </el-select>
        </div>
        <div class="form-item">
          <label>规则</label>
          <el-select v-model="maskRule" style="width: 220px">
            <el-option label="手机号：保留前3后4（138****5678）" value="phone" />
            <el-option label="证件号：保留前4后4" value="idcard" />
            <el-option label="姓名：保留姓氏（张三→张*）" value="name" />
            <el-option label="自定义保留位数" value="custom" />
          </el-select>
        </div>
      </div>
      <div v-if="maskRule === 'custom'" class="form-row" style="margin-top: 10px">
        <div class="form-item">
          <label>保留前</label>
          <el-input-number v-model="keepHead" :min="0" :max="50" />
        </div>
        <div class="form-item">
          <label>保留后</label>
          <el-input-number v-model="keepTail" :min="0" :max="50" />
        </div>
      </div>
      <div class="page-desc" style="margin-top: 8px">
        在原文件基础上生成「_脱敏」新文件，原文件不动；空单元格跳过。
      </div>
    </StepCard>

    <StepCard :step="outStep" title="输出位置">
      <OutDirPicker v-model="outDir" />
    </StepCard>

    <StepCard :step="outStep + 1" title="执行">
      <el-button type="primary" :loading="running" @click="run">{{ runLabel }}</el-button>
      <ResultPanel :outputs="outputs" />
      <div v-if="previews.length" class="mask-previews">
        <el-alert type="success" :closable="false" title="脱敏效果抽样（每列前 3 条）" />
        <el-table v-for="pv in previews" :key="pv.column" :data="pv.samples" size="small" class="mask-table">
          <el-table-column label="列" width="160">
            <template #default>{{ pv.column }}</template>
          </el-table-column>
          <el-table-column prop="original" label="原值" />
          <el-table-column prop="masked" label="脱敏后" />
        </el-table>
      </div>
    </StepCard>
  </div>
</template>

<style scoped>
.excel-tabs {
  margin-bottom: 10px;
}
.mask-previews {
  margin-top: 16px;
  width: 100%;
}
.mask-table {
  margin-top: 8px;
}
</style>
