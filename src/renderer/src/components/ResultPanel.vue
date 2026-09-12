<script setup lang="ts">
import { api } from '../utils/ipc'
import { computed } from 'vue'
import { FolderOpened } from '@element-plus/icons-vue'
import { basename, dirname } from '../utils/api'

const props = defineProps<{ outputs: string[] }>()
const dir = computed(() => (props.outputs.length ? dirname(props.outputs[0]) : ''))

async function openDir() {
  await api.openPath(dir.value)
}
</script>

<template>
  <el-result
    v-if="outputs.length"
    icon="success"
    title="处理完成"
    :sub-title="`共输出 ${outputs.length} 个文件`"
  >
    <template #extra>
      <div class="result-extra">
        <el-button type="primary" :icon="FolderOpened" @click="openDir">打开输出文件夹</el-button>
        <ul class="file-list result-list">
          <li v-for="p in outputs.slice(0, 50)" :key="p">
            <span class="file-name" :title="p">{{ basename(p) }}</span>
          </li>
        </ul>
        <div v-if="outputs.length > 50" class="more-hint">
          …以及另外 {{ outputs.length - 50 }} 个文件
        </div>
      </div>
    </template>
  </el-result>
</template>
