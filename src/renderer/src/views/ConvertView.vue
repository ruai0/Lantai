<script setup lang="ts">
import { api } from '../utils/ipc'
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import StepCard from '../components/StepCard.vue'
import FilePickList from '../components/FilePickList.vue'
import OutDirPicker from '../components/OutDirPicker.vue'
import { callQ, basename } from '../utils/api'
import { useEnterSubmit } from '../utils/useEnterSubmit'
import { useShellFiles } from '../utils/shellIntent'
import type { EnvProbe, OfficeToPdfResult } from '@shared/types'

/** 填完参数按 Enter 直接执行（主按钮已标 data-primary-action） */
useEnterSubmit()

const OFFICE_FILTER = [
  {
    name: 'Office 文档',
    extensions: ['doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx']
  }
]

const files = ref<string[]>([])
const { take } = useShellFiles()
const outDir = ref('')
const result = ref<OfficeToPdfResult | null>(null)
const running = ref(false)
const router = useRouter()

/* 环境探测：未装 Office/WPS 时该功能必定失败，提前告知而不是等到转换中途报错 */
const probe = ref<EnvProbe | null>(null)
const probing = ref(false)

async function refreshProbe(force = false) {
  probing.value = true
  try {
    const r = await api.probe({ force })
    if (r.ok) probe.value = r.data
  } finally {
    probing.value = false
  }
}
onMounted(() => {
  void refreshProbe()
  // 从资源管理器右键「转换为 PDF」进来的文件，直接填好待转列表
  const incoming = take()
  if (incoming.length) files.value = incoming
})

/** 按所选文件的类型判断是否有对应的转换组件；未选文件时判断是否三者都缺 */
const requiredKinds = computed<Array<'word' | 'excel' | 'ppt'>>(() => {
  const kinds = new Set<'word' | 'excel' | 'ppt'>()
  for (const f of files.value) {
    const ext = f.split('.').pop()?.toLowerCase() ?? ''
    if (ext === 'doc' || ext === 'docx') kinds.add('word')
    else if (ext === 'xls' || ext === 'xlsx') kinds.add('excel')
    else if (ext === 'ppt' || ext === 'pptx') kinds.add('ppt')
  }
  return [...kinds]
})

const missingLabel = computed(() => {
  if (!probe.value) return ''
  const map: Record<string, string> = { word: 'Word', excel: 'Excel', ppt: 'PowerPoint' }
  const kinds = requiredKinds.value.length ? requiredKinds.value : (['word', 'excel', 'ppt'] as const)
  const missing = kinds.filter(k => /未检测到/.test(probe.value![k]))
  if (!missing.length) return ''
  return missing.map(k => map[k]).join(' / ')
})

/** 环境层面：未选文件时只要三者全缺才拦截；选了文件后只要缺对应组件就拦截 */
const envBlocked = computed(() => {
  if (!probe.value) return false
  if (requiredKinds.value.length === 0) {
    return ['word', 'excel', 'ppt'].every(k => /未检测到/.test(probe.value![k as 'word']))
  }
  return !!missingLabel.value
})

/**
 * 主按钮是否可点：环境缺失或没选文件都拦住。
 * 环境问题已经有上方红框详细说明，不再重复写进 title；
 * 没选文件这种"缺什么"则由 gate 统一给出提示。
 */
const noFiles = computed(() => files.value.length === 0)
const blocked = computed(() => envBlocked.value || noFiles.value)
const blockedReason = computed(() => (envBlocked.value || !noFiles.value ? '' : '还需：待转换文件'))

function goSettings() {
  void router.push('/settings')
}

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

    <el-alert
      v-if="blocked"
      type="error"
      :closable="false"
      style="margin-bottom: 16px"
      show-icon
      :title="`本机未检测到可用的 ${missingLabel}，无法完成转换`"
    >
      <template #default>
        <div class="mt-6">
          请先安装 Microsoft Office 或 WPS，然后点击「重新探测」。
          <el-button size="small" type="primary" link @click="goSettings">去设置页查看环境详情</el-button>
          <el-button size="small" link :loading="probing" @click="refreshProbe(true)">重新探测</el-button>
        </div>
      </template>
    </el-alert>
    <el-alert
      v-else-if="probe && missingLabel"
      type="warning"
      :closable="false"
      style="margin-bottom: 16px"
      show-icon
      :title="`所选文件类型需要的 ${missingLabel} 未检测到，这些文件可能转换失败`"
    >
      <template #default>
        <el-button size="small" type="primary" link @click="goSettings">去设置页查看环境详情</el-button>
      </template>
    </el-alert>

    <StepCard :step="1" title="选择文档">
      <FilePickList
        v-model="files"
        :filters="OFFICE_FILTER"
        button-text="选择 Word / Excel / PPT"
        title="选择要转换为 PDF 的文档（可多选）"
      />
    </StepCard>

    <!-- 输出位置与执行合并：执行区只有一个按钮，单独占卡会白吃一块高度 -->
    <StepCard :step="2" title="输出位置与执行">
      <OutDirPicker v-model="outDir" />
      <div class="run-row">
        <el-button
          type="primary"
          :loading="running"
          :disabled="blocked"
          :title="blockedReason"
          :data-blocked-reason="blockedReason"
          data-primary-action
          @click="run"
        >
          开始转换
        </el-button>
      </div>
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
