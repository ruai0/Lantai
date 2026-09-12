<script setup lang="ts">
import { api } from '../utils/ipc'
import { computed, ref } from 'vue'
import { Delete } from '@element-plus/icons-vue'
import type { FileFilterDef } from '@shared/types'
import { basename } from '../utils/api'

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

const names = computed(() => props.modelValue.map(basename))

/** 允许的后缀集合（小写、不含点）；filters 缺省表示不限类型 */
const allowedExts = computed<Set<string> | null>(() => {
  if (!props.filters?.length) return null
  const set = new Set<string>()
  for (const f of props.filters) for (const ext of f.extensions) set.add(ext.toLowerCase())
  return set
})

function extOf(p: string): string {
  const i = p.lastIndexOf('.')
  return i < 0 ? '' : p.slice(i + 1).toLowerCase()
}

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

/** 拖入：合并去重，按 filters 过滤；单选时只取第一个合法文件 */
function onDrop(e: DragEvent) {
  dragOver.value = false
  const files = e.dataTransfer?.files
  if (!files?.length) return
  const merged = [...props.modelValue]
  let rejected = 0
  for (const file of Array.from(files)) {
    const p = api.getPathForFile(file)
    if (!p) continue
    if (allowedExts.value && !allowedExts.value.has(extOf(p))) {
      rejected++
      continue
    }
    if (!merged.includes(p)) merged.push(p)
  }
  const result = props.multiple ? merged : merged.slice(-1)
  if (rejected) console.warn(`[拖拽] 已忽略 ${rejected} 个不符合类型要求的文件`)
  emit('update:modelValue', result)
}

function remove(i: number) {
  emit('update:modelValue', props.modelValue.filter((_, idx) => idx !== i))
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
    <span class="pick-count">
      <template v-if="modelValue.length">已选 {{ modelValue.length }} 个</template>
      <template v-else>或将文件拖到此处</template>
    </span>
    <ul v-if="modelValue.length" class="file-list">
      <li v-for="(p, i) in modelValue" :key="p">
        <span class="file-name" :title="p">{{ names[i] }}</span>
        <el-button :icon="Delete" link type="danger" @click="remove(i)" />
      </li>
    </ul>
  </div>
</template>
