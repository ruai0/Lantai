<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { ElMessage } from 'element-plus'
import { api } from '../utils/ipc'
import { updateState } from '../utils/update'

defineProps<{ modelValue: boolean }>()
const emit = defineEmits<{ (e: 'update:modelValue', v: boolean): void }>()

const info = ref<Record<string, string | number> | null>(null)
const devtoolsOn = ref(false)

onMounted(async () => {
  const r = await api.diagnostics()
  if (r.ok) info.value = r.data
})

async function copyAll() {
  if (!info.value) return
  const text = Object.entries(info.value)
    .map(([k, v]) => `${k}: ${v}`)
    .join('\n')
  try {
    await navigator.clipboard.writeText(`兰台 诊断信息\n${text}`)
    ElMessage.success('已复制诊断信息')
  } catch {
    ElMessage.error('剪贴板不可用')
  }
}

async function openLogs() {
  if (!info.value?.userData) return
  await api.openPath(`${info.value.userData}/logs`)
}

async function toggleDevtools() {
  const r = await api.toggleDevtools()
  if (r.ok) {
    devtoolsOn.value = r.data
    ElMessage.success(r.data ? 'DevTools 已打开（独立窗口）' : 'DevTools 已关闭')
  }
}

function onKey(e: KeyboardEvent) {
  if (e.key === 'Escape') {
    e.stopPropagation()
    emit('update:modelValue', false)
  }
}
</script>

<template>
  <Teleport to="body">
    <div v-if="modelValue" class="dbg-overlay" @click.self="emit('update:modelValue', false)" @keydown="onKey">
      <div class="dbg-panel">
        <div class="dbg-head">
          <span class="dbg-title">调试面板</span>
          <span class="dbg-sub">隐藏入口 · 仅供排障</span>
          <button class="dbg-close" @click="emit('update:modelValue', false)">✕</button>
        </div>
        <div class="dbg-body">
          <div class="dbg-btns">
            <el-button size="small" plain @click="toggleDevtools">{{ devtoolsOn ? '关闭 DevTools' : '打开 DevTools' }}</el-button>
            <el-button size="small" plain @click="openLogs">打开日志目录</el-button>
            <el-button size="small" plain @click="copyAll">复制诊断信息</el-button>
          </div>
          <dl v-if="info" class="dbg-kv">
            <template v-for="(v, k) in info" :key="k">
              <dt>{{ k }}</dt>
              <dd>{{ v }}</dd>
            </template>
            <dt>update.phase</dt>
            <dd>{{ updateState.phase }}{{ updateState.latest ? ' → ' + updateState.latest : '' }}</dd>
          </dl>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.dbg-overlay {
  position: fixed;
  inset: 0;
  background: rgba(8, 12, 20, 0.5);
  backdrop-filter: blur(2px);
  display: flex;
  align-items: flex-start;
  justify-content: center;
  padding-top: 12vh;
  z-index: 3200;
}
.dbg-panel {
  width: min(640px, 92vw);
  max-height: 74vh;
  display: flex;
  flex-direction: column;
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: var(--r-lg);
  box-shadow: var(--shadow-lg);
  overflow: hidden;
}
.dbg-head {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 14px 18px;
  border-bottom: 1px solid var(--line-soft);
}
.dbg-title {
  font-family: var(--font-doc);
  font-size: 15px;
  font-weight: 700;
  letter-spacing: 0.1em;
  color: var(--text-1);
}
.dbg-sub {
  font-size: 11.5px;
  color: var(--text-3);
}
.dbg-close {
  margin-left: auto;
  border: none;
  background: transparent;
  color: var(--text-3);
  cursor: pointer;
  font-size: 14px;
  padding: 2px 6px;
}
.dbg-body {
  overflow-y: auto;
  padding: 14px 18px 18px;
}
.dbg-btns {
  display: flex;
  gap: 8px;
  margin-bottom: 14px;
}
.dbg-kv {
  display: grid;
  grid-template-columns: 150px 1fr;
  gap: 4px 14px;
  margin: 0;
  font-size: 12.5px;
}
.dbg-kv dt {
  font-family: var(--font-mono);
  color: var(--text-3);
}
.dbg-kv dd {
  margin: 0;
  color: var(--text-2);
  word-break: break-all;
}
</style>
