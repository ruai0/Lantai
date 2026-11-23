<script setup lang="ts">
import { api } from '../utils/ipc'
import { computed, ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import { Delete } from '@element-plus/icons-vue'
import type { FileFilterDef } from '@shared/types'
import { basename } from '../utils/api'
import { looksLikePaths, parsePastedPaths } from '@shared/pastePaths'

const props = withDefaults(
  defineProps<{
    modelValue: string[]
    filters?: FileFilterDef[]
    multiple?: boolean
    buttonText?: string
    title?: string
  }>(),
  { multiple: true, buttonText: '选择文件' }
)

const emit = defineEmits<{ (e: 'update:modelValue', v: string[]): void }>()
const loading = ref(false)
const dragOver = ref(false)

/**
 * 拖入文件夹时是否连子目录一起收。
 * 默认开（一次把整个台账拖进来最省事），但子目录里常混着草稿、旧版、图片素材，
 * 全部收进来反而要手工剔除，所以给个开关。
 */
const recursive = ref(true)

/**
 * 列表渲染上限：一次拖进整个台账可能有上千个文件，
 * 全量渲染几千个 <li> 会让切换页签明显卡顿。先显示前 200 个，
 * 需要时点「展开全部」——绝大多数场景看前几十个就够确认选对了。
 */
const RENDER_LIMIT = 200
const showAll = ref(false)
const visibleFiles = computed(() =>
  showAll.value ? props.modelValue : props.modelValue.slice(0, RENDER_LIMIT)
)
const hiddenCount = computed(() => Math.max(0, props.modelValue.length - RENDER_LIMIT))

/** 清空后重置展开状态，下次再选重新折叠 */
watch(
  () => props.modelValue.length,
  n => {
    if (n === 0) showAll.value = false
  }
)

const names = computed(() => props.modelValue.map(basename))

/** 允许的后缀集合（小写、不含点）；filters 缺省表示不限类型 */
const allowedExts = computed<Set<string> | null>(() => {
  if (!props.filters?.length) return null
  const set = new Set<string>()
  for (const f of props.filters) for (const ext of f.extensions) set.add(ext.toLowerCase())
  return set
})

async function pick() {
  loading.value = true
  try {
    const res = await api.pickFiles({
      filters: props.filters,
      multiple: props.multiple,
      title: props.title
    })
    if (res.ok && res.data.length) emit('update:modelValue', res.data)
  } finally {
    loading.value = false
  }
}

/** 拖入：接受文件与整个文件夹（目录由主进程递归展开），合并去重，按 filters 过滤 */
async function onDrop(e: DragEvent) {
  dragOver.value = false
  const files = e.dataTransfer?.files
  if (!files?.length) return
  const paths: string[] = []
  for (const file of Array.from(files)) {
    const p = api.getPathForFile(file)
    if (p) paths.push(p)
  }
  if (!paths.length) return
  loading.value = true
  try {
    const res = await api.expandPaths({ paths, exts: allowedExts.value ? [...allowedExts.value] : undefined, recursive: recursive.value })
    if (!res.ok) {
      ElMessage.error(res.error)
      return
    }
    const merged = [...props.modelValue]
    for (const p of res.data.files) if (!merged.includes(p)) merged.push(p)
    const result = props.multiple ? merged : merged.slice(-1)
    if (res.data.dirs) ElMessage.success(`已展开 ${res.data.dirs} 个文件夹，共 ${res.data.files.length} 个文件`)
    if (res.data.truncated) ElMessage.warning('文件数超过 2000 上限，仅收录前面部分')
    // 拖入了不符合类型的文件要让用户看见，否则会以为拖放没生效
    if (res.data.rejected) ElMessage.warning(`已忽略 ${res.data.rejected} 个不符合类型要求的文件`)
    emit('update:modelValue', result)
  } finally {
    loading.value = false
  }
}

function remove(i: number) {
  emit('update:modelValue', props.modelValue.filter((_, idx) => idx !== i))
}

/** 一次清空：拖进几十个文件发现选错目录时，一个个点删除太费劲 */
function clearAll() {
  emit('update:modelValue', [])
}

/**
 * 粘贴路径：办公场景常从资源管理器复制文件、或从表格里复制一列路径，
 * 逐个选很烦。解析剪贴板文本（支持换行/引号/分号）后走与拖拽同一条
 * 展开通道（校验存在性 + 按类型过滤 + 支持整段文件夹）。
 */
async function pasteFromClipboard() {
  let text = ''
  try {
    text = await navigator.clipboard.readText()
  } catch {
    ElMessage.error('读取剪贴板失败：请换用「选择文件」按钮')
    return
  }
  if (!text.trim()) {
    ElMessage.warning('剪贴板是空的：请先在资源管理器里复制文件（Ctrl+C）')
    return
  }
  const parsed = parsePastedPaths(text)
  if (!parsed.length || !looksLikePaths(parsed)) {
    ElMessage.warning('剪贴板内容不像文件路径：请复制"文件"本身（在资源管理器里选中后 Ctrl+C）')
    return
  }
  loading.value = true
  try {
    const res = await api.expandPaths({ paths: parsed, exts: allowedExts.value ? [...allowedExts.value] : undefined, recursive: recursive.value })
    if (!res.ok) {
      ElMessage.error(res.error)
      return
    }
    if (!res.data.files.length) {
      ElMessage.warning(
        res.data.rejected
          ? `剪贴板里的 ${res.data.rejected} 个条目都不符合本工具要求的文件类型`
          : '剪贴板里的路径都不存在，请检查文件是否已被移动或删除'
      )
      return
    }
    const merged = [...props.modelValue]
    let added = 0
    for (const p of res.data.files) if (!merged.includes(p)) { merged.push(p); added++ }
    if (!added) {
      ElMessage.info('这些文件已在已选列表里')
      return
    }
    const result = props.multiple ? merged : merged.slice(-1)
    if (res.data.dirs) ElMessage.success(`已展开 ${res.data.dirs} 个文件夹，新增 ${added} 个文件`)
    else if (res.data.rejected) ElMessage.success(`已添加 ${added} 个文件（${res.data.rejected} 个类型不符已忽略）`)
    else ElMessage.success(`已添加 ${added} 个文件`)
    emit('update:modelValue', result)
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <div
    class="pick-zone"
    :class="{ 'pick-zone--over': dragOver }"
    @dragover.prevent="dragOver = true"
    @dragenter.prevent="dragOver = true"
    @dragleave.prevent="dragOver = false"
    @drop.prevent="onDrop"
  >
    <el-button type="primary" plain :loading="loading" @click="pick">{{ buttonText }}</el-button>
    <el-button plain :disabled="loading" class="pick-paste" @click="pasteFromClipboard">粘贴路径</el-button>
    <el-checkbox v-model="recursive" size="small" class="pick-recursive" title="拖入或粘贴文件夹时是否连子文件夹一起收">
      含子文件夹
    </el-checkbox>
    <span class="pick-count">
      <template v-if="modelValue.length">已选 {{ modelValue.length }} 个</template>
      <template v-else>或将文件拖到此处</template>
    </span>
    <ul v-if="modelValue.length" class="file-list">
      <li v-for="(p, i) in visibleFiles" :key="p">
        <span class="file-name" :title="p">{{ names[i] }}</span>
        <el-button :icon="Delete" link type="danger" @click="remove(i)" />
      </li>
    </ul>
    <div v-if="hiddenCount > 0 && !showAll" class="pick-clear">
      <el-button link type="primary" size="small" @click="showAll = true">
        展开全部（还有 {{ hiddenCount }} 个未显示）
      </el-button>
    </div>
    <div v-if="modelValue.length > 1" class="pick-clear">
      <el-button link type="danger" size="small" @click="clearAll">
        清空全部（{{ modelValue.length }}）
      </el-button>
    </div>
  </div>
</template>

<style scoped>
/* 「含子文件夹」开关：跟在两个按钮后面，别抢主操作的视觉重量 */
.pick-recursive {
  margin-left: 10px;
  font-weight: 400;
}
/* 「清空全部」：只在选了 2 个以上时出现，单个直接点行尾删除就行 */
.pick-clear {
  margin-top: 4px;
}
</style>
