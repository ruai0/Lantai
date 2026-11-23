<script setup lang="ts">
import { api } from '../utils/ipc'
import { onMounted, ref, watch } from 'vue'
import { defaultOutDir } from '../utils/settings'

/** file=true：单输出工具用，输入框可编辑，允许在目录后直接补文件名（D:\out\报告.pdf） */
const props = defineProps<{ modelValue: string; title?: string; file?: boolean }>()
const emit = defineEmits<{ (e: 'update:modelValue', v: string): void }>()
const loading = ref(false)

// 输出框为空时带出默认输出目录；默认值可能在启动后才从主进程加载，故 watch 而非仅 onMounted
function prefill() {
  if (!props.modelValue && defaultOutDir.value) emit('update:modelValue', defaultOutDir.value)
}
onMounted(prefill)
watch(defaultOutDir, prefill)

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
    <el-input
      :model-value="modelValue"
      :readonly="!file"
      :placeholder="
        file
          ? '选择文件夹，或直接输入路径带文件名：D:\\输出\\报告.pdf'
          : defaultOutDir
            ? '默认输出目录'
            : '尚未选择文件夹'
      "
      clearable
      @update:model-value="emit('update:modelValue', String($event))"
    />
    <el-button type="primary" plain :loading="loading" @click="pick">选择文件夹</el-button>
  </div>
</template>
