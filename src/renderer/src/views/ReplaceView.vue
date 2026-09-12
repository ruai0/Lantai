<script setup lang="ts">
import { api } from '../utils/ipc'
import { ref } from 'vue'
import { ElMessage } from 'element-plus'
import StepCard from '../components/StepCard.vue'
import FilePickList from '../components/FilePickList.vue'
import OutDirPicker from '../components/OutDirPicker.vue'
import ResultPanel from '../components/ResultPanel.vue'
import { callQ } from '../utils/api'
import type { ReplaceTextResult } from '@shared/types'

const OFFICE_FILTER = [{ name: 'Word / Excel 文档', extensions: ['docx', 'xlsx'] }]

const files = ref<string[]>([])
const findText = ref('')
const replaceWith = ref('')
const outDir = ref('')
const result = ref<ReplaceTextResult | null>(null)
const running = ref(false)

async function run() {
  result.value = null
  if (!files.value.length) {
    ElMessage.warning('请先选择文档')
    return
  }
  if (!findText.value) {
    ElMessage.warning('请填写要查找的文字')
    return
  }
  const dir = outDir.value
  if (!dir) {
    ElMessage.warning('请先选择输出文件夹')
    return
  }
  running.value = true
  try {
    const r = await callQ(
      '批量查找替换',
      () =>
        api.replaceText({
          paths: files.value,
          find: findText.value,
          replace: replaceWith.value,
          outDir: dir
        }),
      '替换完成'
    )
    if (r) result.value = r
  } finally {
    running.value = false
  }
}
</script>

<template>
  <div>
    <h1 class="page-title">批量查找替换</h1>
    <p class="page-desc">
      多个 Word（.docx）/ Excel（.xlsx）文件一次替换同名文字，如公司更名、日期更新、系统升级后的术语统一。输出为新文件，原文件不动。
    </p>

    <StepCard :step="1" title="选择文档">
      <FilePickList
        v-model="files"
        :filters="OFFICE_FILTER"
        button-text="选择 Word / Excel"
        title="选择要批量替换的文档（可多选）"
      />
    </StepCard>

    <StepCard :step="2" title="替换内容">
      <div class="form-row">
        <div class="form-item">
          <label>查找文字</label>
          <el-input v-model="findText" placeholder="如：2025年" style="width: 260px" clearable />
        </div>
        <div class="form-item">
          <label>替换为（留空 = 删除）</label>
          <el-input v-model="replaceWith" placeholder="如：2026年" style="width: 260px" clearable />
        </div>
      </div>
      <div class="page-desc" style="margin-top: 8px">
        Word 正文、页眉页脚与 Excel 所有单元格都会处理；被排版拆开的词可能匹配不到，替换后请抽查。
      </div>
    </StepCard>

    <StepCard :step="3" title="输出位置">
      <OutDirPicker v-model="outDir" />
    </StepCard>

    <StepCard :step="4" title="执行">
      <el-button type="primary" :loading="running" @click="run">开始替换</el-button>
      <ResultPanel v-if="result" :outputs="result.outputs" />
      <el-table
        v-if="result"
        :data="result.counts"
        size="small"
        max-height="260"
        style="margin-top: 12px"
      >
        <el-table-column prop="name" label="文件" show-overflow-tooltip />
        <el-table-column prop="count" label="替换次数" width="110" />
      </el-table>
    </StepCard>
  </div>
</template>
