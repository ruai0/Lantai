<script setup lang="ts">
import { api } from '../utils/ipc'
import { computed, ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import StepCard from '../components/StepCard.vue'
import FilePickList from '../components/FilePickList.vue'
import OutDirPicker from '../components/OutDirPicker.vue'
import ResultPanel from '../components/ResultPanel.vue'
import { call } from '../utils/api'
import type { DataPreview } from '@shared/types'

const tab = ref<'word' | 'excel'>('word')

const templateFile = ref<string[]>([])
const dataFile = ref<string[]>([])
const namePattern = ref('')
const outDir = ref('')
const outputs = ref<string[]>([])
const running = ref(false)

const templateFields = ref<string[]>([])
const preview = ref<DataPreview | null>(null)
const previewRows = ref<Array<Record<string, string>>>([])

const templateFilter = computed(() =>
  tab.value === 'word'
    ? [{ name: 'Word 模板 (docx)', extensions: ['docx'] }]
    : [{ name: 'Excel 模板 (xlsx)', extensions: ['xlsx'] }]
)

const dataFilter = [{ name: '数据文件 (xlsx / json)', extensions: ['xlsx', 'json'] }]

watch([tab, templateFile], async () => {
  templateFields.value = []
  if (!templateFile.value.length) return
  const r = await call(api.scanTemplate({ templatePath: templateFile.value[0], kind: tab.value }))
  if (r) templateFields.value = r.fields
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
  running.value = true
  try {
    const params = {
      templatePath: templateFile.value[0],
      dataPath: dataFile.value[0],
      namePattern: namePattern.value.trim() || undefined,
      outDir: outDir.value
    }
    const r =
      tab.value === 'word'
        ? await call(api.fillWord(params), '生成完成')
        : await call(api.fillExcel(params), '生成完成')
    if (r) outputs.value = r.outputs
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
    </el-tabs>

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
      <div v-else-if="templateFile.length" class="page-desc" style="margin-top: 6px">
        未在模板中扫描到 {占位符}，生成的文档内容将完全相同。
      </div>
    </StepCard>

    <StepCard :step="2" title="选择数据文件">
      <FilePickList
        v-model="dataFile"
        :filters="dataFilter"
        :multiple="false"
        button-text="选择数据文件"
        title="选择数据文件（xlsx 第 1 行为字段名，或 json 对象数组）"
      />
      <template v-if="preview">
        <div class="pick-count" style="display: block; margin-top: 8px">
          共 {{ preview.total }} 条数据，预览前 {{ preview.rows.length }} 条：
        </div>
        <el-table :data="previewRows" size="small" max-height="150" style="margin-top: 4px">
          <el-table-column v-for="h in preview.headers" :key="h" :label="h" min-width="90" show-overflow-tooltip>
            <template #default="{ row }">{{ row[h] }}</template>
          </el-table-column>
        </el-table>
      </template>
    </StepCard>

    <StepCard :step="3" title="输出设置">
      <div class="form-row">
        <div class="form-item">
          <label>文件名模式</label>
          <el-input
            v-model="namePattern"
            placeholder="如 通知书_{姓名}，留空则用 模板名_序号"
            style="width: 300px"
            clearable
          />
        </div>
      </div>
      <div style="margin-top: 10px">
        <OutDirPicker v-model="outDir" />
      </div>
    </StepCard>

    <StepCard :step="4" title="执行">
      <el-button type="primary" :loading="running" @click="run">开始生成</el-button>
      <ResultPanel :outputs="outputs" />
    </StepCard>
  </div>
</template>

<style scoped>
.office-tabs {
  margin-bottom: 10px;
}
</style>
