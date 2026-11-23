<script setup lang="ts">
import { computed, ref } from 'vue'
import { api } from '../utils/ipc'
import { activeTasks, currentLabel, pendingCount, pendingJobs, queueActive } from '../utils/taskQueue'
import FilePreview from './FilePreview.vue'

/** 右下角悬浮任务坞：主进程推来的按文件进度 + 渲染层队列的排队/取消 */
const visible = computed(() => queueActive.value || activeTasks.value.length > 0)
const pct = (done: number, total: number) => (total > 0 ? Math.min(100, Math.round((done / total) * 100)) : 0)
const stopRunning = (id: number) => void api.taskCancel({ id })

/** 完成态直接打开产出所在文件夹：任务在后台跑完时，用户往往已经切到别的工具了 */
function openOut(outputs?: string[]): void {
  const first = outputs?.[0]
  if (!first) return
  const i = Math.max(first.lastIndexOf('\\'), first.lastIndexOf('/'))
  void api.openPath(i > 0 ? first.slice(0, i) : first)
}

/** 任务坞可以很长（批量任务排队时），支持折叠；收起状态在来新任务时自动展开 */
const collapsed = ref(false)

/** 应用内预览第一个产出（PDF / 图片可预览，其余类型弹窗里引导用系统程序打开） */
const previewOpen = ref(false)
const previewPath = ref('')
function previewOut(outputs?: string[]): void {
  const first = outputs?.[0]
  if (!first) return
  previewPath.value = first
  previewOpen.value = true
}
</script>

<template>
  <Transition name="dock">
    <div v-if="visible" class="task-dock" :class="{ 'task-dock--collapsed': collapsed }">
      <button class="dock-head" :title="collapsed ? '展开任务列表' : '收起任务列表'" @click="collapsed = !collapsed">
        <span class="dock-title">后台任务</span>
        <span v-if="pendingCount" class="dock-pending">排队 {{ pendingCount }}</span>
        <span class="dock-toggle">{{ collapsed ? '▲' : '▼' }}</span>
      </button>
      <div v-show="!collapsed" class="dock-body">
        <div v-for="t in activeTasks" :key="t.id" class="dock-row" :class="'dock-row--' + t.state">
          <div class="dock-label">
            {{ t.label }}
            <em v-if="t.state === 'done'" class="dock-mark dock-mark--ok">✓</em>
            <em v-else-if="t.state === 'error'" class="dock-mark dock-mark--err">✕</em>
            <em v-else-if="t.state === 'cancelled'" class="dock-mark dock-mark--wait">已请求停止，收尾中…</em>
          </div>
          <div class="dock-track"><i :style="{ width: pct(t.done, t.total) + '%' }" /></div>
          <div class="dock-num">{{ t.done }}/{{ t.total }}</div>
          <button v-if="t.state === 'running'" class="dock-cancel" title="在当前文件处理完后停止" @click="stopRunning(t.id)">■</button>
          <span v-else-if="t.state === 'done' && t.outputs?.length" class="dock-done-acts">
            <button class="dock-open" title="在本窗口预览第一个产出" @click="previewOut(t.outputs)">预览</button>
            <button class="dock-open" title="打开输出文件夹" @click="openOut(t.outputs)">打开</button>
          </span>
          <span v-else />
        </div>
        <div v-for="j in pendingJobs" :key="j.id" class="dock-row">
          <div class="dock-label">{{ j.label }}</div>
          <div class="dock-track dock-track--wait" />
          <span />
          <button class="dock-cancel" title="取消这个排队任务" @click="j.cancel()">✕</button>
        </div>
        <!-- 已出队但主进程还没上报任务（例如正在等对话框/读参数） -->
        <div v-if="queueActive && !activeTasks.length && !pendingJobs.length" class="dock-row">
          <div class="dock-label">{{ currentLabel }}…</div>
          <div class="dock-track dock-track--pulse"><i style="width: 40%" /></div>
          <span />
          <span />
        </div>
      </div>
    </div>
  </Transition>
  <FilePreview v-model:open="previewOpen" :path="previewPath" />
</template>

<style scoped>
.task-dock {
  position: fixed;
  right: 18px;
  bottom: 18px;
  width: 300px;
  padding: 10px 14px 12px;
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: var(--r-lg);
  box-shadow: var(--shadow-lg);
  z-index: 2500;
}
/* 标题即折叠开关：整行可点，展开状态指示箭头在右 */
.dock-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 6px;
  width: calc(100% + 28px);
  margin-left: -14px;
  padding: 2px 14px;
  border: none;
  background: transparent;
  cursor: pointer;
  font: inherit;
  color: inherit;
  text-align: left;
  border-radius: var(--r-lg);
}
.dock-head:hover .dock-toggle {
  color: var(--accent);
}
.task-dock--collapsed {
  padding-bottom: 10px;
}
.dock-toggle {
  font-size: 10px;
  color: var(--text-3);
  transition: color 0.15s;
}
/* 批量任务可能几十个：限高滚动，不再盖住右下角整块表单 */
.dock-body {
  max-height: 40vh;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
}
.dock-title {
  font-family: var(--font-display);
  font-size: 10px;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  color: var(--text-3);
}
.dock-pending {
  font-size: 11.5px;
  color: var(--amber);
}
.dock-row {
  display: grid;
  grid-template-columns: 1fr 80px 44px auto;
  align-items: center;
  gap: 8px;
  padding: 4px 0;
  flex-shrink: 0;
}
.dock-label {
  font-size: 12.5px;
  color: var(--text-1);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.dock-mark {
  font-style: normal;
  margin-left: 4px;
}
.dock-mark--ok {
  color: var(--el-color-success, #67c23a);
}
.dock-mark--err {
  color: var(--el-color-danger, #f56c6c);
}
.dock-mark--wait {
  font-style: normal;
  font-size: 11px;
  color: var(--text-3);
}
.dock-row--cancelled .dock-track i {
  background: var(--text-3);
}
.dock-track {
  height: 5px;
  border-radius: 3px;
  background: var(--surface-2);
  overflow: hidden;
}
.dock-track i {
  display: block;
  height: 100%;
  border-radius: 3px;
  background: var(--amber, #f2a73b);
  transition: width 0.25s;
}
.dock-row--done .dock-track i {
  background: var(--el-color-success, #67c23a);
}
.dock-row--error .dock-track i {
  background: var(--el-color-danger, #f56c6c);
}
.dock-track--pulse i {
  animation: dock-pulse 1.1s ease-in-out infinite alternate;
}
@keyframes dock-pulse {
  from {
    transform: translateX(-60%);
  }
  to {
    transform: translateX(180%);
  }
}
.dock-num {
  font-family: var(--font-mono);
  font-size: 11px;
  color: var(--text-3);
  text-align: right;
}
.dock-track--wait {
  background: repeating-linear-gradient(90deg, var(--line) 0 6px, transparent 6px 12px);
}
.dock-cancel {
  border: none;
  background: transparent;
  color: var(--text-3);
  cursor: pointer;
  font-size: 12px;
  padding: 2px;
  border-radius: 4px;
  justify-self: end;
}
.dock-cancel:hover {
  color: var(--el-color-danger, #f56c6c);
  background: var(--surface-2);
}
/* 完成态动作：预览第一个产出 + 打开所在文件夹 */
.dock-done-acts {
  display: inline-flex;
  gap: 4px;
  justify-self: end;
}
.dock-open {
  border: 1px solid var(--line);
  background: var(--surface-2);
  color: var(--accent);
  cursor: pointer;
  font-size: 11px;
  padding: 1px 8px;
  border-radius: 4px;
}
.dock-open:hover {
  border-color: var(--accent);
}
.dock-enter-active,
.dock-leave-active {
  transition: transform 0.22s ease, opacity 0.22s ease;
}
.dock-enter-from,
.dock-leave-to {
  transform: translateY(12px);
  opacity: 0;
}
</style>
