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

const names = computed(() => props.modelValue.map(basename))

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

function remove(i: number) {
  emit('update:modelValue', props.modelValue.filter((_, idx) => idx !== i))
}
</script>

<template>
  <div>
    <el-button type="primary" plain :loading="loading" @click="pick">{{ buttonText }}</el-button>
    <span v-if="modelValue.length" class="pick-count">已选 {{ modelValue.length }} 个</span>
    <ul v-if="modelValue.length" class="file-list">
      <li v-for="(p, i) in modelValue" :key="p">
        <span class="file-name" :title="p">{{ names[i] }}</span>
        <el-button :icon="Delete" link type="danger" @click="remove(i)" />
      </li>
    </ul>
  </div>
</template>
