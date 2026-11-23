<script setup lang="ts">
import { api } from '../utils/ipc'
import { computed, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import StepCard from '../components/StepCard.vue'
import FilePickList from '../components/FilePickList.vue'
import OutDirPicker from '../components/OutDirPicker.vue'
import ResultPanel from '../components/ResultPanel.vue'
import { call, callQ } from '../utils/api'
import { useEnterSubmit } from '../utils/useEnterSubmit'
import { useReadyGate } from '../utils/useReadyGate'
import { useRemembered } from '../utils/useRememberedParams'
import type { DataPreview, EnvProbe } from '@shared/types'
import { findMissingPatternFields } from '@shared/namePattern'

/** 填完参数按 Enter 直接执行（主按钮已标 data-primary-action） */
useEnterSubmit()

/** 模板与数据缺一不可；输出目录一般有默认值，不拦 */
const { blocked: runBlocked, reason: runBlockedReason } = useReadyGate(() => [
  { label: '模板文件', ok: templateFile.value.length > 0 },
  { label: '数据文件', ok: dataFile.value.length > 0 }
])

const tab = ref<'word' | 'excel' | 'pptx'>('word')

const templateFile = ref<string[]>([])
const dataFile = ref<string[]>([])
const namePattern = ref('')
const outDir = ref('')
const outputs = ref<string[]>([])
const running = ref(false)
/** 填充后顺势导出 PDF（治「批量通知书要出 PDF，还得再手动转一遍」的断点） */
const toPdf = ref(false)

// 记住上次的文件名规则、文档类型与「是否直出 PDF」：同一批通知书反复做，模式基本不变
useRemembered('office', 'tab', tab)
useRemembered('office', 'namePattern', namePattern)
useRemembered('office', 'toPdf', toPdf)

/* 直出 PDF 依赖本机 Office/WPS：未装时提前告知并禁用，而不是生成到一半才失败 */
const probe = ref<EnvProbe | null>(null)
const router = useRouter()
onMounted(async () => {
  const r = await api.probe({})
  if (r.ok) probe.value = r.data
})
const pdfEngineMissing = computed(() => {
  if (!toPdf.value || !probe.value) return false
  const kinds = tab.value === 'word' ? ['word'] : tab.value === 'excel' ? ['excel'] : ['ppt']
  return kinds.every(k => /未检测到/.test(probe.value![k as 'word']))
})

const templateFields = ref<string[]>([])
const riskyFields = ref<string[]>([])
/** 文件名模式里写错、样本数据中不存在的字段（用于提前提示，而非静默生成空名） */
const patternMissingFields = computed(() => findMissingPatternFields(namePattern.value, previewRows.value[0]))
const preview = ref<DataPreview | null>(null)
const previewRows = ref<Array<Record<string, string>>>([])

const templateFilter = computed(() =>
  tab.value === 'word'
    ? [{ name: 'Word 模板 (docx)', extensions: ['docx'] }]
    : tab.value === 'excel'
      ? [{ name: 'Excel 模板 (xlsx)', extensions: ['xlsx'] }]
      : [{ name: 'PPT 模板 (pptx)', extensions: ['pptx'] }]
)

const dataFilter = [{ name: '数据文件 (xlsx / csv / json)', extensions: ['xlsx', 'csv', 'json'] }]

watch([tab, templateFile], async () => {
  templateFields.value = []
  riskyFields.value = []
  if (!templateFile.value.length) return
  const r = await call(api.scanTemplate({ templatePath: templateFile.value[0], kind: tab.value }))
  if (r) {
    templateFields.value = r.fields
    riskyFields.value = r.risky ?? []
  }
})

watch(dataFile, async () => {
  preview.value = null
  previewRows.value = []
  if (!dataFile.value.length) return
  const r = await call(api.previewData({ dataPath: dataFile.value[0] }))
  if (r) {
    preview.value = r
    previewRows.value = r.rows.map(cells => Object.fromEntries(r.headers.map((h, i) => [h, cells[i]])))
  }
})

async function run() {
  outputs.value = []
  if (!templateFile.value.length) {
    ElMessage.warning('请先选择模板文件')
    return
  }
  if (!dataFile.value.length) {
    ElMessage.warning('请先选择数据文件')
    return
  }
  if (!outDir.value) {
    ElMessage.warning('请选择输出文件夹')
    return
  }
  if (pdfEngineMissing.value) {
    ElMessage.warning('未检测到 Office/WPS，无法导出 PDF：请先安装，或在设置里检查本机环境')
    return
  }
  running.value = true
  try {
    const params = {
      templatePath: templateFile.value[0],
      dataPath: dataFile.value[0],
      namePattern: namePattern.value.trim() || undefined,
      outDir: outDir.value
    }
    // 走串行队列：几百行数据就是几百份文档，必须能在右下角看进度、中途取消
    const doneMsg = toPdf.value ? undefined : '生成完成'
    const r =
      tab.value === 'word'
        ? await callQ('Word 批量填充', () => api.fillWord(params), doneMsg)
        : tab.value === 'excel'
          ? await callQ('Excel 批量填充', () => api.fillExcel(params), doneMsg)
          : await callQ('PPT 批量填充', () => api.fillPptx(params), doneMsg)
    if (!r) return

    if (toPdf.value && r.outputs.length) {
      // 直出 PDF：对刚生成的文档逐一转换（走串行队列，可在右下角任务坞看进度/取消）
      const conv = await callQ(
        'Office 转 PDF',
        () => api.officeToPdf({ paths: r.outputs, outDir: outDir.value }),
        '生成并导出 PDF 完成'
      )
      const convOutputs = conv?.outputs ?? []
      // 有转换失败的：把已成功的 PDF 与失败原因一并交代清楚
      if (conv?.failed?.length) {
        const names = conv.failed.map(f => f.name).join('、')
        ElMessage.error(`${conv.failed.length} 份转 PDF 失败：${names}（文档已生成，可单独重试）`)
      }
      outputs.value = convOutputs
    } else {
      outputs.value = r.outputs
    }
  } finally {
    running.value = false
  }
}
</script>

<template>
  <div>
    <h1 class="page-title">文档模板填充</h1>
    <p class="page-desc">模板里写 {字段名} 占位符，数据文件每一行生成一份文档。</p>

    <el-tabs v-model="tab" class="office-tabs">
      <el-tab-pane label="Word 模板" name="word" />
      <el-tab-pane label="Excel 模板" name="excel" />
      <el-tab-pane label="PPT 模板" name="pptx" />
    </el-tabs>

    <el-alert
      v-if="tab === 'pptx'"
      type="info"
      :closable="false"
      style="margin-bottom: 12px"
      show-icon
      title="PPT 填充只处理幻灯片正文；母版、版式与演讲者备注页里的 {占位符} 不会生效。"
    />
    <el-alert
      v-if="tab === 'excel'"
      type="info"
      :closable="false"
      style="margin-bottom: 12px"
      show-icon
      title="Excel 填充支持文本、数字与公式结果单元格中的 {占位符}；三种格式一致：数据缺字段时会直接报错并指明缺失项。"
    />

    <StepCard :step="1" title="选择模板">
      <FilePickList
        :key="tab"
        v-model="templateFile"
        :filters="templateFilter"
        :multiple="false"
        button-text="选择模板文件"
        title="选择模板文件"
      />
      <div v-if="templateFields.length" class="field-tags">
        <span class="form-item"><label>识别到的占位符：</label></span>
        <el-tag v-for="f in templateFields" :key="f" size="small" type="info">{{ f }}</el-tag>
      </div>
      <el-alert
        v-if="riskyFields.length"
        type="warning"
        :closable="false"
        class="mt-8"
        show-icon
        :title="`有 ${riskyFields.length} 个占位符在模板里被格式拆开（跨多个文本片段），生成时可能失败：${riskyFields.slice(0, 6).join('、')}${riskyFields.length > 6 ? ' 等' : ''}`"
        description="建议：删除该占位符后重新输入一遍（确保它是一个整体），或统一字体格式。"
      />
      <div v-else-if="templateFile.length && !templateFields.length" class="page-desc mt-6">
        未在模板中扫描到 {占位符}，生成的文档内容将完全相同。
      </div>
    </StepCard>

    <StepCard :step="2" title="选择数据文件">
      <FilePickList
        v-model="dataFile"
        :filters="dataFilter"
        :multiple="false"
        button-text="选择数据文件"
        title="选择数据文件（xlsx/csv 首行为字段名，或 json 对象数组）"
      />
      <template v-if="preview">
        <div class="pick-count" style="display: block; margin-top: 8px">
          共 {{ preview.total }} 条数据，预览前 {{ preview.rows.length }} 条：
        </div>
        <el-table :data="previewRows" size="small" max-height="150" class="mt-4">
          <el-table-column v-for="h in preview.headers" :key="h" :label="h" min-width="90" show-overflow-tooltip>
            <template #default="{ row }">{{ row[h] }}</template>
          </el-table-column>
        </el-table>
      </template>
    </StepCard>

    <!-- 输出设置与执行合并：执行区只有一个按钮，单独占卡会白吃一块高度 -->
    <StepCard :step="3" title="输出设置与执行">
      <div class="form-row">
        <div class="form-item">
          <label>文件名模式</label>
          <el-input
            v-model="namePattern"
            placeholder="如 通知书_{姓名}，留空则用 模板名_序号"
            style="width: 300px"
            clearable
          />
          <div class="page-desc mt-4">
            可选字段：{{ templateFields.length ? templateFields.join('、') : '（选模板后显示）' }}
          </div>
        </div>
      </div>
      <el-alert
        v-if="patternMissingFields.length"
        type="warning"
        :closable="false"
        class="mt-8"
        :title="`文件名模式里的字段在数据中不存在，会被替换为空：${patternMissingFields.join('、')}`"
      />
      <div class="mt-10">
        <OutDirPicker v-model="outDir" />
      </div>
      <div class="mt-10">
        <el-checkbox v-model="toPdf">生成后直接导出 PDF（无需再手动转换一遍）</el-checkbox>
        <div class="page-desc mt-4">
          依赖本机 Office / WPS；勾选后每份文档生成完会立刻转成 PDF，原 Word/Excel/PPT 文件同时保留。
        </div>
      </div>
      <el-alert
        v-if="pdfEngineMissing"
        type="warning"
        :closable="false"
        class="mt-8"
        show-icon
        title="本机未检测到可用的 Office / WPS，无法导出 PDF。"
        description="请先安装 Office 或 WPS；或取消勾选，仅生成文档。"
      >
        <template #default>
          <div class="mt-6">
            <el-button size="small" @click="router.push('/settings')">去设置里检查本机环境</el-button>
          </div>
        </template>
      </el-alert>
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
          开始生成
        </el-button>
      </div>
      <ResultPanel :outputs="outputs" />
    </StepCard>
  </div>
</template>

<style scoped>
.office-tabs {
  margin-bottom: 10px;
}
</style>
