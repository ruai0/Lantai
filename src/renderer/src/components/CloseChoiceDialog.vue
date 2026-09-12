<script setup lang="ts">
import { ref } from 'vue'
import { api } from '../utils/ipc'
import { updateSettings } from '../utils/settings'

/** 点关闭按钮且设置=询问时弹出（微信式）：选完可记住，不再骚扰 */
const props = defineProps<{ modelValue: boolean }>()
const emit = defineEmits<{ (e: 'update:modelValue', v: boolean): void }>()

const remember = ref(true)

async function choose(action: 'tray' | 'quit'): Promise<void> {
  if (remember.value) await updateSettings({ onClose: action })
  emit('update:modelValue', false)
  await api.applyCloseChoice({ action })
}
</script>

<template>
  <Teleport to="body">
    <div v-if="modelValue" class="cc-overlay" @click.self="emit('update:modelValue', false)">
      <div class="cc-panel">
        <div class="cc-title">关闭主窗口</div>
        <p class="cc-desc">兰台可以继续留在右下角托盘里待命，也可以直接退出。</p>
        <div class="cc-btns">
          <el-button type="primary" @click="choose('tray')">最小化到托盘</el-button>
          <el-button @click="choose('quit')">退出程序</el-button>
        </div>
        <label class="cc-remember">
          <el-checkbox v-model="remember" size="small">记住我的选择（以后不再询问，可在设置里改）</el-checkbox>
        </label>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.cc-overlay {
  position: fixed;
  inset: 0;
  background: rgba(8, 12, 20, 0.5);
  backdrop-filter: blur(2px);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 3300;
}
.cc-panel {
  width: min(380px, 90vw);
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: var(--r-lg);
  box-shadow: var(--shadow-lg);
  padding: 22px 24px;
}
.cc-title {
  font-family: var(--font-doc);
  font-size: 16px;
  font-weight: 700;
  letter-spacing: 0.08em;
  color: var(--text-1);
}
.cc-desc {
  margin: 10px 0 18px;
  font-size: 13px;
  color: var(--text-2);
  line-height: 1.6;
}
.cc-btns {
  display: flex;
  gap: 10px;
}
.cc-remember {
  display: block;
  margin-top: 14px;
}
</style>
