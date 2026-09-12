<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { api } from '../utils/ipc'
import { TOOLS } from '../tools'
import { history, settings, updateSettings } from '../utils/settings'

const props = defineProps<{ modelValue: boolean }>()
const emit = defineEmits<{ (e: 'update:modelValue', v: boolean): void }>()
const router = useRouter()

const query = ref('')
const active = ref(0)
const inputEl = ref<HTMLInputElement | null>(null)

interface Cmd {
  id: string
  label: string
  hint: string
  group: string
  keywords: string
  run: () => void
}

const goto = (path: string) => () => {
  void router.push(path)
  close()
}
const openOut = (p: string) => () => {
  void api.openPath(p)
  close()
}

const actions = computed<Cmd[]>(() => [
  { id: 'a-settings', label: '打开设置', hint: '偏好与历史', group: '操作', keywords: 'settings 设置 偏好', run: goto('/settings') },
  { id: 'a-home', label: '回到总览', hint: '首页', group: '操作', keywords: 'home 首页 总览', run: goto('/') },
  {
    id: 'a-theme',
    label: settings.value.theme === 'dark' ? '切换到浅色' : '切换到深色',
    hint: '外观',
    group: '操作',
    keywords: 'theme 主题 深色 浅色 dark light',
    run: () => {
      void updateSettings({ theme: settings.value.theme === 'dark' ? 'light' : 'dark' })
      close()
    }
  }
])

const commands = computed<Cmd[]>(() => {
  const toolCmds: Cmd[] = TOOLS.map(t => ({
    id: 't' + t.path,
    label: t.name,
    hint: t.desc,
    group: '工具',
    keywords: [t.name, t.path, ...t.keywords].join(' ').toLowerCase(),
    run: goto(t.path)
  }))
  const histCmds: Cmd[] = history.value.slice(0, 12).map((h, i) => ({
    id: 'h' + i,
    label: h.outputs.map(basenameOf).join('、') || h.label,
    hint: `最近 · ${h.label}`,
    group: '最近输出',
    keywords: h.outputs.join(' ').toLowerCase() + ' ' + h.label,
    run: openOut(h.outputs[0])
  }))
  return [...toolCmds, ...histCmds, ...actions.value]
})

function basenameOf(p: string): string {
  const i = Math.max(p.lastIndexOf('\\'), p.lastIndexOf('/'))
  return i >= 0 ? p.slice(i + 1) : p
}

const filtered = computed(() => {
  const q = query.value.trim().toLowerCase()
  if (!q) return commands.value
  return commands.value.filter(c => c.label.toLowerCase().includes(q) || c.keywords.includes(q))
})

watch(filtered, () => (active.value = 0))
watch(
  () => props.modelValue,
  open => {
    if (open) {
      query.value = ''
      active.value = 0
      void nextTick(() => inputEl.value?.focus())
    }
  }
)

function close(): void {
  emit('update:modelValue', false)
}

function onKey(e: KeyboardEvent): void {
  if (e.key === 'ArrowDown') {
    e.preventDefault()
    active.value = Math.min(active.value + 1, filtered.value.length - 1)
  } else if (e.key === 'ArrowUp') {
    e.preventDefault()
    active.value = Math.max(active.value - 1, 0)
  } else if (e.key === 'Enter') {
    e.preventDefault()
    filtered.value[active.value]?.run()
  } else if (e.key === 'Escape') {
    e.preventDefault()
    close()
  }
}
</script>

<template>
  <Teleport to="body">
    <div v-if="modelValue" class="cmd-overlay" @click.self="close">
      <div class="cmd-panel">
        <input
          ref="inputEl"
          v-model="query"
          class="cmd-input"
          placeholder="搜索工具、最近输出，或输入命令…"
          @keydown="onKey"
        />
        <div class="cmd-list">
          <template v-for="(c, i) in filtered" :key="c.id">
            <div v-if="i === 0 || filtered[i - 1].group !== c.group" class="cmd-group">{{ c.group }}</div>
            <div class="cmd-item" :class="{ 'cmd-item--active': i === active }" @mouseenter="active = i" @click="c.run()">
              <span class="cmd-label">{{ c.label }}</span>
              <span class="cmd-hint">{{ c.hint }}</span>
            </div>
          </template>
          <div v-if="!filtered.length" class="cmd-empty">没有匹配项</div>
        </div>
        <div class="cmd-foot">
          <span><kbd>↑</kbd><kbd>↓</kbd> 选择</span>
          <span><kbd>Enter</kbd> 执行</span>
          <span><kbd>Esc</kbd> 关闭</span>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.cmd-overlay {
  position: fixed;
  inset: 0;
  background: rgba(8, 12, 20, 0.5);
  backdrop-filter: blur(2px);
  display: flex;
  align-items: flex-start;
  justify-content: center;
  padding-top: 14vh;
  z-index: 3000;
}
.cmd-panel {
  width: min(560px, 90vw);
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: var(--r-lg);
  box-shadow: var(--shadow-lg);
  overflow: hidden;
}
.cmd-input {
  width: 100%;
  border: none;
  outline: none;
  background: transparent;
  color: var(--text-1);
  font-family: var(--font-body);
  font-size: 15px;
  padding: 16px 18px;
  border-bottom: 1px solid var(--line-soft);
}
.cmd-list {
  max-height: 52vh;
  overflow-y: auto;
  padding: 6px;
}
.cmd-group {
  font-family: var(--font-display);
  font-size: 10px;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  color: var(--text-3);
  padding: 10px 12px 4px;
}
.cmd-item {
  display: flex;
  align-items: baseline;
  gap: 12px;
  padding: 9px 12px;
  border-radius: var(--r-md);
  cursor: pointer;
}
.cmd-item--active {
  background: var(--accent-wash);
}
.cmd-label {
  font-size: 13.5px;
  color: var(--text-1);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 55%;
}
.cmd-hint {
  font-size: 12px;
  color: var(--text-3);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  flex: 1;
}
.cmd-empty {
  padding: 24px;
  text-align: center;
  color: var(--text-3);
  font-size: 13px;
}
.cmd-foot {
  display: flex;
  gap: 16px;
  padding: 8px 14px;
  border-top: 1px solid var(--line-soft);
  font-size: 11.5px;
  color: var(--text-3);
}
.cmd-foot kbd {
  font-family: var(--font-mono);
  font-size: 10.5px;
  border: 1px solid var(--line);
  border-bottom-width: 2px;
  border-radius: 4px;
  padding: 0 5px;
  margin-right: 3px;
}
</style>
