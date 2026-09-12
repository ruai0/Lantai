<script setup lang="ts">
import { computed } from 'vue'
import { activeTasks, currentLabel, pendingCount, pendingJobs, queueActive } from '../utils/taskQueue'

/** 右下角悬浮任务坞：主进程推来的按文件进度 + 渲染层队列的排队数 */
const visible = computed(() => queueActive.value || activeTasks.value.length > 0)
const pct = (done: number, total: number) => (total > 0 ? Math.min(100, Math.round((done / total) * 100)) : 0)
</script>

<template>
  <Transition name="dock">
    <div v-if="visible" class="task-dock">
      <div class="dock-head">
        <span class="dock-title">后台任务</span>
        <span v-if="pendingCount" class="dock-pending">排队 {{ pendingCount }}</span>
      </div>
      <div v-for="t in activeTasks" :key="t.id" class="dock-row" :class="'dock-row--' + t.state">
        <div class="dock-label">
          {{ t.label }}
          <em v-if="t.state === 'done'" class="dock-mark dock-mark--ok">✓</em>
          <em v-else-if="t.state === 'error'" class="dock-mark dock-mark--err">✕</em>
        </div>
        <div class="dock-track"><i :style="{ width: pct(t.done, t.total) + '%' }" /></div>
        <div class="dock-num">{{ t.done }}/{{ t.total }}</div>
      </div>
      <div v-for="j in pendingJobs" :key="j.id" class="dock-row">
        <div class="dock-label">{{ j.label }}</div>
        <div class="dock-track dock-track--wait" />
        <button class="dock-cancel" title="取消这个排队任务" @click="j.cancel()">✕</button>
      </div>
      <!-- 已出队但主进程还没上报任务（例如正在等对话框/读参数） -->
      <div v-if="queueActive && !activeTasks.length && !pendingJobs.length" class="dock-row">
        <div class="dock-label">{{ currentLabel }}…</div>
        <div class="dock-track dock-track--pulse"><i style="width: 40%" /></div>
      </div>
    </div>
  </Transition>
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
.dock-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 6px;
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
  grid-template-columns: 1fr 90px 44px;
  align-items: center;
  gap: 8px;
  padding: 4px 0;
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
