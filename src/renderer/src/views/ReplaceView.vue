<script setup lang="ts">
import { api } from '../utils/ipc'
import { computed, ref } from 'vue'
import { ElMessage } from 'element-plus'
import StepCard from '../components/StepCard.vue'
import FilePickList from '../components/FilePickList.vue'
import OutDirPicker from '../components/OutDirPicker.vue'
import ResultPanel from '../components/ResultPanel.vue'
import { callQ } from '../utils/api'
import { useEnterSubmit } from '../utils/useEnterSubmit'
import { useReadyGate } from '../utils/useReadyGate'
import type { ReplaceTextResult } from '@shared/types'

/** 填完参数按 Enter 直接执行（主按钮已标 data-primary-action） */
useEnterSubmit()

/** 文档与查找词都齐了才能替换；留空的替换词是合法的（等于删除） */
const { blocked: runBlocked, reason: runBlockedReason } = useReadyGate(() => [
  { label: '待替换文档', ok: files.value.length > 0 },
  { label: '查找文字', ok: !!findText.value.trim() }
])

const OFFICE_FILTER = [{ name: 'Word / Excel 文档', extensions: ['docx', 'xlsx', 'doc'] }]

const files = ref<string[]>([])
const findText = ref('')
const replaceWith = ref('')
const outDir = ref('')
const result = ref<ReplaceTextResult | null>(null)
const running = ref(false)

const totalSplitMiss = computed(() =>
  (result.value?.counts ?? []).reduce((n, c) => n + (c.splitMisses ?? 0), 0)
)

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
      <div class="page-desc mt-8">
        Word 正文、页眉页脚与 Excel 所有单元格都会处理，被排版拆开的词会自动跨片段匹配；替换后仍建议抽查。
      </div>
    </StepCard>

    <!-- 输出位置与执行合并：执行区只有一个按钮，单独占卡会白吃一块高度 -->
    <StepCard :step="3" title="输出位置与执行">
      <OutDirPicker v-model="outDir" />
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
          开始替换
        </el-button>
      </div>
      <ResultPanel v-if="result" :outputs="result.outputs" />
      <el-alert
        v-if="totalSplitMiss"
        type="warning"
        :closable="false"
        class="mt-12"
        :title="`有 ${totalSplitMiss} 处疑似因排版拆开而未能替换，请打开文件复核`"
      />
      <el-table
        v-if="result"
        :data="result.counts"
        size="small"
        max-height="260"
        class="mt-12"
      >
        <el-table-column prop="name" label="文件" show-overflow-tooltip />
        <el-table-column prop="count" label="替换次数" width="110" />
        <el-table-column label="疑似漏替换" width="110">
          <template #default="{ row }">
            <span :style="row.splitMisses ? 'color:#e6a23c' : ''">{{ row.splitMisses || 0 }}</span>
          </template>
        </el-table-column>
      </el-table>
    </StepCard>
  </div>
</template>
