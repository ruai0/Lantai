<script setup lang="ts">
import { api } from '../utils/ipc'
import { ref } from 'vue'
import { ElMessage } from 'element-plus'
import StepCard from '../components/StepCard.vue'
import FilePickList from '../components/FilePickList.vue'
import OutDirPicker from '../components/OutDirPicker.vue'
import { callQ, basename } from '../utils/api'
import type { OfficeToPdfResult } from '@shared/types'

const OFFICE_FILTER = [
  {
    name: 'Office 文档',
    extensions: ['doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx']
  }
]

const files = ref<string[]>([])
const outDir = ref('')
const result = ref<OfficeToPdfResult | null>(null)
const running = ref(false)

async function run() {
  result.value = null
  if (!files.value.length) {
    ElMessage.warning('请先选择要转换的文档')
    return
  }
  const dir = outDir.value
  if (!dir) {
    ElMessage.warning('请先选择输出文件夹')
    return
  }
  running.value = true
  try {
    const r = await callQ('Office 转 PDF', () => api.officeToPdf({ paths: files.value, outDir: dir }), '转换完成')
    if (r) result.value = r
  } finally {
    running.value = false
  }
}

async function openOut() {
  await api.openPath(outDir.value)
}
</script>

<template>
  <div>
    <h1 class="page-title">Office 转 PDF</h1>
    <p class="page-desc">
      批量把 Word / Excel / PPT 转成 PDF（用于报送材料）。调用本机已安装的 Microsoft Office 或
      WPS 完成，全程离线；转换过程中请不要打开相关文档。
    </p>

    <StepCard :step="1" title="选择文档">
      <FilePickList
        v-model="files"
        :filters="OFFICE_FILTER"
        button-text="选择 Word / Excel / PPT"
        title="选择要转换为 PDF 的文档（可多选）"
      />
    </StepCard>

    <StepCard :step="2" title="输出位置">
      <OutDirPicker v-model="outDir" />
    </StepCard>

    <StepCard :step="3" title="执行">
      <el-button type="primary" :loading="running" @click="run">开始转换</el-button>
      <el-result
        v-if="result && result.outputs.length"
        icon="success"
        :title="`成功转换 ${result.outputs.length} 个文件`"
        :sub-title="result.failed.length ? `另有 ${result.failed.length} 个失败，见下方列表` : ''"
      >
        <template #extra>
          <el-button type="primary" @click="openOut">打开输出文件夹</el-button>
          <ul class="file-list">
            <li v-for="p in result.outputs.slice(0, 50)" :key="p" class="file-name">{{ basename(p) }}</li>
          </ul>
        </template>
      </el-result>
      <div v-if="result && result.failed.length" class="fail-box">
        <el-alert type="error" :closable="false" title="以下文件转换失败" />
        <ul class="fail-list">
          <li v-for="f in result.failed" :key="f.name">
            <b>{{ f.name }}</b>：{{ f.reason }}
          </li>
        </ul>
      </div>
    </StepCard>
  </div>
</template>

<style scoped>
.fail-box {
  margin-top: 16px;
  width: 100%;
}
.fail-list {
  margin-top: 8px;
  padding-left: 18px;
}
</style>
