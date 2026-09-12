<script setup lang="ts">
import { api } from '../utils/ipc'
import { ref } from 'vue'

const props = defineProps<{ modelValue: string; title?: string }>()
const emit = defineEmits<{ (e: 'update:modelValue', v: string): void }>()
const loading = ref(false)

async function pick() {
  loading.value = true
  try {
    const res = await api.pickDirectory(props.title ?? '选择输出文件夹')
    if (res.ok && res.data) emit('update:modelValue', res.data)
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <div class="outdir-row">
    <el-input :model-value="modelValue" placeholder="尚未选择文件夹" readonly />
    <el-button type="primary" plain :loading="loading" @click="pick">选择文件夹</el-button>
  </div>
</template>
