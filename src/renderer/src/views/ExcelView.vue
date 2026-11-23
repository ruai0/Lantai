<script setup lang="ts">
import { api } from '../utils/ipc'
import { computed, ref, type Ref } from 'vue'
import { ElMessage } from 'element-plus'
import StepCard from '../components/StepCard.vue'
import FilePickList from '../components/FilePickList.vue'
import OutDirPicker from '../components/OutDirPicker.vue'
import ResultPanel from '../components/ResultPanel.vue'
import { call, callQ } from '../utils/api'
import { useEnterSubmit } from '../utils/useEnterSubmit'
import { useReadyGate } from '../utils/useReadyGate'
import { useRemembered } from '../utils/useRememberedParams'
import type { ExcelMergeMode, MaskPreview, MaskRule } from '@shared/types'
import { splitOutputTarget } from '@shared/namePattern'

/** 填完参数按 Enter 直接执行（主按钮已标 data-primary-action） */
useEnterSubmit()

/** 当前页签必选的文件：没选就把主按钮置灰，省得点下去才被告知 */
const tabFiles = computed<string[]>(() => {
  switch (tab.value) {
    case 'merge':
      return mergeFiles.value
    case 'splitSheets':
      return splitSheetsFile.value
    case 'splitRows':
      return splitRowsFile.value
    case 'splitCol':
      return splitColFile.value
    case 'sort':
      return sortFile.value
    case 'group':
      return groupFile.value
    case 'condfmt':
      return cfFile.value
    case 'csv':
      return csvFiles.value
    case 'mask':
      return maskFile.value
    default:
      return []
  }
})

const { blocked: runBlocked, reason: runBlockedReason } = useReadyGate(() => [
  { label: '表格文件', ok: tabFiles.value.length > 0 }
])

const XLSX_FILTER = [{ name: 'Excel 文件', extensions: ['xlsx'] }]
const CSV_FILTER = [{ name: 'CSV 文件', extensions: ['csv'] }]

const tab = ref<'merge' | 'splitSheets' | 'splitRows' | 'splitCol' | 'csv' | 'mask' | 'sort' | 'group' | 'condfmt'>('merge')

const mergeFiles = ref<string[]>([])
const mergeMode = ref<ExcelMergeMode>('sheets')
const mergeName = ref('')
const mergeHeaderRow = ref(1)
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
const maskChar = ref('*')
const maskSheet = ref('')
const maskHeaderRow = ref(1)
const maskSheets = ref<string[]>([])

const splitColFile = ref<string[]>([])
const splitColHeaders = ref<string[]>([])
const splitColColumn = ref('')
const splitColGroups = ref(0)
const splitColSheet = ref('')
const splitColHeaderRow = ref(1)
const splitColSheets = ref<string[]>([])

const splitRowsSheet = ref('')
const splitRowsHeaderRow = ref(1)
const splitRowsSheets = ref<string[]>([])

/* ---------- 排序去重 ---------- */
const sortFile = ref<string[]>([])
const sortHeaders = ref<string[]>([])
const sortColumns = ref<string[]>([])
const sortOrder = ref<'asc' | 'desc'>('asc')
const sortDedupe = ref(true)
const sortSheet = ref('')
const sortHeaderRow = ref(1)
const sortSheets = ref<string[]>([])
const sortResult = ref<{ before: number; after: number; removed: number } | null>(null)

/* ---------- 分组汇总 ---------- */
const groupFile = ref<string[]>([])
const groupHeaders = ref<string[]>([])
const groupColumns = ref<string[]>([])
const groupValueColumns = ref<string[]>([])
const groupAggregate = ref<'count' | 'sum' | 'avg' | 'max' | 'min'>('count')
const groupSheet = ref('')
const groupHeaderRow = ref(1)
const groupSheets = ref<string[]>([])
const groupPreview = ref<string[][]>([])
const groupCount = ref(0)
const groupTableHeader = ref<string[]>([])

/* ---------- 条件格式 ---------- */
const cfFile = ref<string[]>([])
const cfHeaders = ref<string[]>([])
const cfColumns = ref<string[]>([])
const cfRule = ref<'duplicate' | 'greater' | 'less' | 'between'>('duplicate')
const cfValue = ref<number | undefined>(undefined)
const cfValue2 = ref<number | undefined>(undefined)
const cfFill = ref('#FFF3B0')
const cfWholeRow = ref(true)
const cfSheet = ref('')
const cfHeaderRow = ref(1)
const cfSheets = ref<string[]>([])
const cfMatched = ref(0)

const outDir = ref('')
const outputs = ref<string[]>([])
const previews = ref<MaskPreview[]>([])
const failed = ref<Array<{ name: string; reason: string }>>([])
const running = ref(false)

// 记住页签与结构性参数（模式、表头行、每份行数、编码、脱敏规则与掩码）：台账处理反复做，这些基本不变
useRemembered('excel', 'tab', tab)
useRemembered('excel', 'mergeMode', mergeMode)
useRemembered('excel', 'mergeHeaderRow', mergeHeaderRow)
useRemembered('excel', 'rowsPerFile', rowsPerFile)
useRemembered('excel', 'csvEncoding', csvEncoding)
useRemembered('excel', 'maskRule', maskRule)
useRemembered('excel', 'keepHead', keepHead)
useRemembered('excel', 'keepTail', keepTail)
useRemembered('excel', 'maskChar', maskChar)
useRemembered('excel', 'maskHeaderRow', maskHeaderRow)
useRemembered('excel', 'splitColHeaderRow', splitColHeaderRow)
useRemembered('excel', 'splitRowsHeaderRow', splitRowsHeaderRow)
useRemembered('excel', 'sortOrder', sortOrder)
useRemembered('excel', 'sortDedupe', sortDedupe)
useRemembered('excel', 'sortHeaderRow', sortHeaderRow)
useRemembered('excel', 'groupAggregate', groupAggregate)
useRemembered('excel', 'groupHeaderRow', groupHeaderRow)
useRemembered('excel', 'cfRule', cfRule)
useRemembered('excel', 'cfFill', cfFill)
useRemembered('excel', 'cfWholeRow', cfWholeRow)
useRemembered('excel', 'cfHeaderRow', cfHeaderRow)

function singleOf(v: string[]): string {
  return v[0] ?? ''
}

/** 用户填 "#RRGGBB" 或 "RRGGBB" 都能喂给原生取色器 */
function normalizeColor(c: string): string {
  const s = (c || '').replace(/^#/, '').trim()
  return /^[0-9a-fA-F]{6}$/.test(s) ? `#${s.toLowerCase()}` : '#fff3b0'
}

/** 读取工作簿的工作表清单，供按 sheet 操作时选择 */
async function loadSheets(filePath: string): Promise<string[]> {
  if (!filePath) return []
  const r = await call(api.excelListSheets({ path: filePath }), '')
  return r ?? []
}

async function loadHeaders() {
  if (!maskFile.value.length) {
    ElMessage.warning('请先选择 Excel 文件')
    return
  }
  maskSheets.value = await loadSheets(singleOf(maskFile.value))
  maskSheet.value = ''
  const r = await call(api.excelReadHeaders({ path: singleOf(maskFile.value), headerRow: maskHeaderRow.value, sheet: maskSheet.value || undefined }))
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
  splitColSheets.value = await loadSheets(singleOf(splitColFile.value))
  splitColSheet.value = ''
  const r = await call(api.excelReadHeaders({ path: singleOf(splitColFile.value), headerRow: splitColHeaderRow.value, sheet: splitColSheet.value || undefined }))
  if (r) {
    splitColHeaders.value = r.headers
    splitColColumn.value = ''
    ElMessage.success(`已读取 ${r.headers.length} 个列名`)
  }
}

async function loadSplitRowsSheets() {
  if (!splitRowsFile.value.length) return
  splitRowsSheets.value = await loadSheets(singleOf(splitRowsFile.value))
  splitRowsSheet.value = ''
}

/** 通用：读取某文件的表头与工作表列表（排序/分组/条件格式共用） */
async function loadHeadersInto(
  files: string[],
  headerRow: number,
  headerTarget: Ref<string[]>,
  sheetsTarget: Ref<string[]>,
  sheetRef: Ref<string>
): Promise<void> {
  if (!files.length) {
    ElMessage.warning('请先选择 Excel 文件')
    return
  }
  sheetsTarget.value = await loadSheets(singleOf(files))
  sheetRef.value = ''
  const r = await call(api.excelReadHeaders({ path: singleOf(files), headerRow, sheet: undefined }))
  if (r) {
    headerTarget.value = r.headers
    ElMessage.success(`已读取 ${r.headers.length} 个列名`)
  }
}

async function loadSortHeaders() {
  await loadHeadersInto(sortFile.value, sortHeaderRow.value, sortHeaders, sortSheets, sortSheet)
  sortColumns.value = []
}
async function loadGroupHeaders() {
  await loadHeadersInto(groupFile.value, groupHeaderRow.value, groupHeaders, groupSheets, groupSheet)
  groupColumns.value = []
  groupValueColumns.value = []
}
async function loadCfHeaders() {
  await loadHeadersInto(cfFile.value, cfHeaderRow.value, cfHeaders, cfSheets, cfSheet)
  cfColumns.value = []
}

async function run() {
  outputs.value = []
  previews.value = []
  sortResult.value = null
  groupPreview.value = []
  groupTableHeader.value = []
  groupCount.value = 0
  cfMatched.value = 0
  failed.value = []
  const { dir, name: pathName } = splitOutputTarget(outDir.value)
  if (!dir) {
    ElMessage.warning('请在输出位置填写或选择输出文件夹')
    return
  }
  running.value = true
  try {
    if (tab.value === 'merge') {
      if (mergeFiles.value.length < 2) {
        ElMessage.warning('合并至少需要选择两个 Excel 文件')
        return
      }
      const r = await callQ(
        'Excel 多簿合并',
        () => api.excelMerge({ paths: mergeFiles.value, mode: mergeMode.value, outDir: dir, name: mergeName.value.trim() || pathName, headerRow: mergeHeaderRow.value }),
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
      const r = await callQ(
        'Excel 按行拆分',
        () => api.excelSplitRows({
          path: singleOf(splitRowsFile.value),
          rowsPerFile: rowsPerFile.value,
          outDir: dir,
          sheet: splitRowsSheet.value || undefined,
          headerRow: splitRowsHeaderRow.value
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
      const r = await callQ(
        'Excel 按列拆分',
        () =>
          api.excelSplitColumn({
            path: singleOf(splitColFile.value),
            column: splitColColumn.value,
            outDir: dir,
            sheet: splitColSheet.value || undefined,
            headerRow: splitColHeaderRow.value
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
      const r = await callQ(
        'CSV 转 Excel',
        () => api.excelCsvToXlsx({ paths: csvFiles.value, encoding: csvEncoding.value, outDir: dir }),
        '转换完成'
      )
      if (r) outputs.value = r.outputs
    } else if (tab.value === 'sort') {
      if (!sortFile.value.length) {
        ElMessage.warning('请先选择 Excel 文件')
        return
      }
      if (!sortColumns.value.length && !sortDedupe.value) {
        ElMessage.warning('请选择排序依据列，或勾选「按所选列去重」')
        return
      }
      if (sortDedupe.value && !sortColumns.value.length) {
        ElMessage.warning('勾选去重后必须选择作为去重依据的列')
        return
      }
      const r = await call(
        api.excelSortDedupe({
          path: singleOf(sortFile.value),
          outDir: dir,
          sortColumns: sortColumns.value,
          sortOrder: sortOrder.value,
          dedupe: sortDedupe.value,
          sheet: sortSheet.value || undefined,
          headerRow: sortHeaderRow.value
        }),
        '处理完成'
      )
      if (r) {
        outputs.value = r.outputs
        sortResult.value = { before: r.before, after: r.after, removed: r.removed }
      }
    } else if (tab.value === 'group') {
      if (!groupFile.value.length) {
        ElMessage.warning('请先选择 Excel 文件')
        return
      }
      if (!groupColumns.value.length) {
        ElMessage.warning('请先点「读取表头」并选择分组依据列')
        return
      }
      if (groupAggregate.value !== 'count' && !groupValueColumns.value.length) {
        ElMessage.warning('「求和/平均/最大/最小」需要选择要汇总的数值列（只按组计数则选「计数」）')
        return
      }
      const r = await call(
        api.excelGroup({
          path: singleOf(groupFile.value),
          outDir: dir,
          groupColumns: groupColumns.value,
          valueColumns: groupValueColumns.value,
          aggregate: groupAggregate.value,
          sheet: groupSheet.value || undefined,
          headerRow: groupHeaderRow.value
        }),
        '汇总完成'
      )
      if (r) {
        outputs.value = r.outputs
        groupPreview.value = r.preview
        groupTableHeader.value = r.header
        groupCount.value = r.groups
      }
    } else if (tab.value === 'condfmt') {
      if (!cfFile.value.length) {
        ElMessage.warning('请先选择 Excel 文件')
        return
      }
      if (!cfColumns.value.length) {
        ElMessage.warning('请先点「读取表头」并选择要标注的列')
        return
      }
      const r = await call(
        api.excelCondFormat({
          path: singleOf(cfFile.value),
          outDir: dir,
          columns: cfColumns.value,
          rule: cfRule.value,
          value: cfValue.value,
          value2: cfValue2.value,
          fill: cfFill.value,
          wholeRow: cfWholeRow.value,
          sheet: cfSheet.value || undefined,
          headerRow: cfHeaderRow.value
        }),
        '标注完成'
      )
      if (r) {
        outputs.value = r.outputs
        cfMatched.value = r.matched
      }
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
          maskChar: maskChar.value || '*',
          sheet: maskSheet.value || undefined,
          headerRow: maskHeaderRow.value,
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
        mask: '开始脱敏',
        sort: sortDedupe.value ? '开始排序去重' : '开始排序',
        group: groupAggregate.value === 'count' ? '开始分组计数' : '开始分组汇总',
        condfmt: '开始标注'
      } as Record<string, string>
    )[tab.value]
)
</script>

<template>
  <div>
    <h1 class="page-title">Excel 工具</h1>
    <p class="page-desc">合并 / 拆分 / 排序去重 / 分组汇总 / 条件格式 / CSV 转换 / 数据脱敏。仅支持 .xlsx（旧 .xls 请先另存为 .xlsx）。</p>

    <el-tabs v-model="tab" class="excel-tabs">
      <el-tab-pane label="多簿合并" name="merge" />
      <el-tab-pane label="按表拆分" name="splitSheets" />
      <el-tab-pane label="按行拆分" name="splitRows" />
      <el-tab-pane label="按列值拆分" name="splitCol" />
      <el-tab-pane label="排序去重" name="sort" />
      <el-tab-pane label="分组汇总" name="group" />
      <el-tab-pane label="条件格式" name="condfmt" />
      <el-tab-pane label="CSV 转 Excel" name="csv" />
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
        v-else-if="tab === 'sort'"
        v-model="sortFile"
        :filters="XLSX_FILTER"
        :multiple="false"
        button-text="选择 Excel"
        title="选择要排序/去重的文件"
      />
      <FilePickList
        v-else-if="tab === 'group'"
        v-model="groupFile"
        :filters="XLSX_FILTER"
        :multiple="false"
        button-text="选择 Excel"
        title="选择要分组汇总的文件"
      />
      <FilePickList
        v-else-if="tab === 'condfmt'"
        v-model="cfFile"
        :filters="XLSX_FILTER"
        :multiple="false"
        button-text="选择 Excel"
        title="选择要条件标注的文件"
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
        title="选择要脱敏的文件（可选工作表与表头行）"
      />
    </StepCard>

    <StepCard v-if="tab === 'merge'" :step="2" title="合并方式">
      <el-radio-group v-model="mergeMode">
        <el-radio-button value="sheets">每个文件一个工作表</el-radio-button>
        <el-radio-button value="single">合并成一张表（按表头对齐）</el-radio-button>
      </el-radio-group>
      <div class="form-row mt-12">
        <div class="form-item" v-if="mergeMode === 'single'">
          <label>表头在第几行</label>
          <el-input-number v-model="mergeHeaderRow" :min="1" :max="20" />
        </div>
        <div class="form-item">
          <label>输出文件名</label>
          <el-input v-model="mergeName" placeholder="留空自动：Excel合并_日期" style="width: 300px" clearable />
        </div>
      </div>
      <div class="page-desc mt-8">
        「合并成一张表」取各文件第一个工作表，按表头列名对齐纵向追加（表头名忽略空格与全半角括号差异）；表头行可改，台账表头常见于第 2、3 行。文件名无需 .xlsx 后缀，同名自动追加 (2)(3)… 不覆盖。
      </div>
    </StepCard>

    <StepCard v-if="tab === 'splitRows'" :step="2" title="拆分设置">
      <div class="form-row">
        <div class="form-item">
          <label>每个文件的数据行数</label>
          <el-input-number v-model="rowsPerFile" :min="1" :max="1000000" :step="100" />
        </div>
        <div class="form-item">
          <label>工作表</label>
          <el-select v-model="splitRowsSheet" placeholder="第一个工作表" style="width: 200px" clearable @focus="loadSplitRowsSheets">
            <el-option v-for="s in splitRowsSheets" :key="s" :label="s" :value="s" />
          </el-select>
        </div>
        <div class="form-item">
          <label>表头在第几行</label>
          <el-input-number v-model="splitRowsHeaderRow" :min="1" :max="20" />
        </div>
      </div>
      <div class="page-desc mt-8">
        拆分出的每个文件都会带上表头（第 {{ splitRowsHeaderRow }} 行及之前的行整体作为表头）。
      </div>
    </StepCard>

    <StepCard v-if="tab === 'splitCol'" :step="2" title="拆分设置">
      <div class="form-row">
        <div class="form-item">
          <label>工作表</label>
          <el-select v-model="splitColSheet" placeholder="第一个工作表" style="width: 200px" clearable>
            <el-option v-for="s in splitColSheets" :key="s" :label="s" :value="s" />
          </el-select>
        </div>
        <div class="form-item">
          <label>表头在第几行</label>
          <el-input-number v-model="splitColHeaderRow" :min="1" :max="20" />
        </div>
        <div class="form-item" style="align-self: flex-end">
          <el-button type="primary" plain @click="loadSplitColHeaders">读取表头</el-button>
        </div>
      </div>
      <div class="form-row mt-12">
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
      <div class="page-desc mt-8">
        每个不同的值生成一个文件（如按「单位」「月份」拆分台账），文件名自动带上该值；每个文件都带表头。
      </div>
      <el-alert
        v-if="splitColGroups > 0"
        class="mt-10"
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
      <div class="page-desc mt-8">
        老系统 / 部分业务平台导出的 CSV 常为 GBK 编码；乱码时请换另一个试试。
      </div>
    </StepCard>

    <StepCard v-if="tab === 'sort'" :step="2" title="排序与去重">
      <div class="form-row">
        <div class="form-item">
          <label>工作表</label>
          <el-select v-model="sortSheet" placeholder="第一个工作表" style="width: 200px" clearable>
            <el-option v-for="s in sortSheets" :key="s" :label="s" :value="s" />
          </el-select>
        </div>
        <div class="form-item">
          <label>表头在第几行</label>
          <el-input-number v-model="sortHeaderRow" :min="1" :max="20" />
        </div>
        <div class="form-item" style="align-self: flex-end">
          <el-button type="primary" plain @click="loadSortHeaders">读取表头</el-button>
        </div>
      </div>
      <div class="form-row mt-12">
        <div class="form-item">
          <label>排序依据列（可多选，按优先级依次排）</label>
          <el-select
            v-model="sortColumns"
            multiple
            collapse-tags
            collapse-tags-tooltip
            placeholder="先读取表头"
            style="width: 320px"
            :disabled="!sortHeaders.length"
          >
            <el-option v-for="h in sortHeaders" :key="h" :label="h" :value="h" />
          </el-select>
        </div>
        <div class="form-item">
          <label>顺序</label>
          <el-radio-group v-model="sortOrder">
            <el-radio-button value="asc">升序</el-radio-button>
            <el-radio-button value="desc">降序</el-radio-button>
          </el-radio-group>
        </div>
      </div>
      <div class="mt-10">
        <el-checkbox v-model="sortDedupe">同时去重（按排序依据列判断，每组只留第一条）</el-checkbox>
      </div>
      <div class="page-desc mt-8">
        文字列按自然序排（"第2号"会排在"第10号"前面），数字列按大小排；空行排到最后。
        去重时只保留每组的第一行（配合升序往往就是"最早的那条"）。表头及之前的行会原样保留。
      </div>
    </StepCard>

    <StepCard v-if="tab === 'group'" :step="2" title="分组汇总">
      <div class="form-row">
        <div class="form-item">
          <label>工作表</label>
          <el-select v-model="groupSheet" placeholder="第一个工作表" style="width: 200px" clearable>
            <el-option v-for="s in groupSheets" :key="s" :label="s" :value="s" />
          </el-select>
        </div>
        <div class="form-item">
          <label>表头在第几行</label>
          <el-input-number v-model="groupHeaderRow" :min="1" :max="20" />
        </div>
        <div class="form-item" style="align-self: flex-end">
          <el-button type="primary" plain @click="loadGroupHeaders">读取表头</el-button>
        </div>
      </div>
      <div class="form-row mt-12">
        <div class="form-item">
          <label>分组依据列（可多选，相同的值归为一行）</label>
          <el-select
            v-model="groupColumns"
            multiple
            collapse-tags
            collapse-tags-tooltip
            placeholder="先读取表头"
            style="width: 320px"
            :disabled="!groupHeaders.length"
          >
            <el-option v-for="h in groupHeaders" :key="h" :label="h" :value="h" />
          </el-select>
        </div>
        <div class="form-item">
          <label>汇总方式</label>
          <el-select v-model="groupAggregate" style="width: 160px">
            <el-option label="计数（每组几行）" value="count" />
            <el-option label="求和" value="sum" />
            <el-option label="平均" value="avg" />
            <el-option label="最大" value="max" />
            <el-option label="最小" value="min" />
          </el-select>
        </div>
      </div>
      <div v-if="groupAggregate !== 'count'" class="form-row mt-12">
        <div class="form-item">
          <label>要汇总的数值列（可多选）</label>
          <el-select
            v-model="groupValueColumns"
            multiple
            collapse-tags
            collapse-tags-tooltip
            placeholder="如 金额、人数"
            style="width: 320px"
            :disabled="!groupHeaders.length"
          >
            <el-option v-for="h in groupHeaders" :key="h" :label="h" :value="h" />
          </el-select>
          <div class="page-desc mt-4">
            非数字单元格会被忽略；汇总结果默认保留两位小数。
          </div>
        </div>
      </div>
      <div class="page-desc mt-8">
        例：按「单位」分组、对「发放金额」求和 —— 生成一张"每单位一行、可一眼看清合计"的新表，相当于把透视表最常用的那一步做成了固定结果。
      </div>
    </StepCard>

    <StepCard v-if="tab === 'condfmt'" :step="2" title="条件格式">
      <div class="form-row">
        <div class="form-item">
          <label>工作表</label>
          <el-select v-model="cfSheet" placeholder="第一个工作表" style="width: 200px" clearable>
            <el-option v-for="s in cfSheets" :key="s" :label="s" :value="s" />
          </el-select>
        </div>
        <div class="form-item">
          <label>表头在第几行</label>
          <el-input-number v-model="cfHeaderRow" :min="1" :max="20" />
        </div>
        <div class="form-item" style="align-self: flex-end">
          <el-button type="primary" plain @click="loadCfHeaders">读取表头</el-button>
        </div>
      </div>
      <div class="form-row mt-12">
        <div class="form-item">
          <label>作用列（可多选）</label>
          <el-select
            v-model="cfColumns"
            multiple
            collapse-tags
            collapse-tags-tooltip
            placeholder="先读取表头"
            style="width: 320px"
            :disabled="!cfHeaders.length"
          >
            <el-option v-for="h in cfHeaders" :key="h" :label="h" :value="h" />
          </el-select>
        </div>
        <div class="form-item">
          <label>规则</label>
          <el-select v-model="cfRule" style="width: 260px">
            <el-option label="标出重复（内容相同的整行）" value="duplicate" />
            <el-option label="大于某值" value="greater" />
            <el-option label="小于某值" value="less" />
            <el-option label="介于两值之间" value="between" />
          </el-select>
        </div>
      </div>
      <div class="form-row mt-12">
        <div class="form-item" v-if="cfRule === 'greater' || cfRule === 'less' || cfRule === 'between'">
          <label>阈值</label>
          <el-input-number v-model="cfValue" :controls="true" style="width: 160px" />
        </div>
        <div class="form-item" v-if="cfRule === 'between'">
          <label>到</label>
          <el-input-number v-model="cfValue2" :controls="true" style="width: 160px" />
        </div>
        <div class="form-item">
          <label>填充色</label>
          <el-input v-model="cfFill" style="width: 120px" placeholder="#FFF3B0">
            <template #append>
              <input type="color" :value="normalizeColor(cfFill)" @input="cfFill = ($event.target as HTMLInputElement).value" style="width: 28px; height: 22px; border: none; background: none; cursor: pointer" />
            </template>
          </el-input>
        </div>
        <div class="form-item" style="align-self: flex-end">
          <el-checkbox v-model="cfWholeRow">整行高亮</el-checkbox>
        </div>
      </div>
      <div class="page-desc mt-8">
        直接改原文件里的样式，生成一个新副本（原文件不动）。重复判断按全角/半角、空格统一后比较，格式不同的同一个名字也能认出来。
      </div>
    </StepCard>

    <StepCard v-if="tab === 'mask'" :step="2" title="脱敏设置">
      <div class="form-row">
        <div class="form-item">
          <label>工作表</label>
          <el-select v-model="maskSheet" placeholder="第一个工作表" style="width: 200px" clearable>
            <el-option v-for="s in maskSheets" :key="s" :label="s" :value="s" />
          </el-select>
        </div>
        <div class="form-item">
          <label>表头在第几行</label>
          <el-input-number v-model="maskHeaderRow" :min="1" :max="20" />
        </div>
        <div class="form-item" style="align-self: flex-end">
          <el-button type="primary" plain @click="loadHeaders">读取表头</el-button>
        </div>
      </div>
      <div class="form-row mt-12">
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
        <div class="form-item">
          <label>掩码字符</label>
          <el-input v-model="maskChar" style="width: 90px" maxlength="1" placeholder="*" />
        </div>
      </div>
      <div v-if="maskRule === 'custom'" class="form-row mt-10">
        <div class="form-item">
          <label>保留前</label>
          <el-input-number v-model="keepHead" :min="0" :max="50" />
        </div>
        <div class="form-item">
          <label>保留后</label>
          <el-input-number v-model="keepTail" :min="0" :max="50" />
        </div>
      </div>
      <div class="page-desc mt-8">
        在原文件基础上生成「_脱敏」新文件，原文件不动；空单元格跳过。
      </div>
    </StepCard>

    <!-- 输出位置与执行合并：执行区只有一个按钮，单独占卡会白吃一块高度 -->
    <StepCard :step="outStep" title="输出位置与执行">
      <OutDirPicker v-model="outDir" :file="tab === 'merge'" />
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
          {{ runLabel }}
        </el-button>
      </div>
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
      <el-alert
        v-if="tab === 'sort' && sortResult"
        type="success"
        :closable="false"
        class="mt-8"
        :title="`数据行 ${sortResult.before} 行 → ${sortResult.after} 行（去掉重复 ${sortResult.removed} 行）`"
      />
      <div v-if="tab === 'group' && groupPreview.length" class="mask-previews">
        <el-alert
          type="success"
          :closable="false"
          :title="`共 ${groupCount} 组（预览前 ${Math.min(8, groupPreview.length)} 行）`"
          :description="`每组一列依据 + 各组汇总值；完整结果已写入上表文件。`"
        />
        <el-table :data="groupPreview" size="small" class="mask-table">
          <el-table-column v-for="(h, i) in groupTableHeader" :key="i" :label="h" :prop="String(i)" />
        </el-table>
      </div>
      <el-alert
        v-if="tab === 'condfmt' && cfMatched"
        type="success"
        :closable="false"
        class="mt-8"
        :title="`已标注 ${cfMatched} 处（行/单元格），填充色 ${cfFill}`"
      />
      <el-alert
        v-if="tab === 'condfmt' && outputs.length && !cfMatched"
        type="info"
        :closable="false"
        class="mt-8"
        title="没有符合条件的行，结果文件与原文件一致"
      />
    </StepCard>
  </div>
</template>

<style scoped>
.mask-previews {
  margin-top: 16px;
  width: 100%;
}
.mask-table {
  margin-top: 8px;
}
</style>
