<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { api } from '../utils/ipc'
import { settings } from '../utils/settings'
import { checkUpdate, updateState } from '../utils/update'

const props = defineProps<{ modelValue: boolean }>()
const emit = defineEmits<{ (e: 'update:modelValue', v: boolean): void }>()

type Tab = 'env' | 'log' | 'data' | 'ops'
const tab = ref<Tab>('env')

const info = ref<Record<string, string | number> | null>(null)
const dev = ref<Record<string, string | number> | null>(null)
const devtoolsOn = ref(false)
const checking = ref(false)

async function loadAll(): Promise<void> {
  const [d, v] = await Promise.all([api.diagnostics(), api.devInfo()])
  if (d.ok) info.value = d.data
  if (v.ok) dev.value = v.data
}
onMounted(loadAll)

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

async function toggleDevtools() {
  const r = await api.toggleDevtools()
  if (r.ok) {
    devtoolsOn.value = r.data
    ElMessage.success(r.data ? 'DevTools 已打开（独立窗口）' : 'DevTools 已关闭')
  }
}

function feedUrl(): string {
  const f = settings.value.updateFeed.trim()
  return !f ? 'https://github.com/ruai0/Lantai（内置官方源）' : f === 'off' || f === 'none' || f === '-' ? '已禁用' : f
}

async function forceCheck() {
  checking.value = true
  try {
    const s = await checkUpdate()
    ElMessage[s.phase === 'error' ? 'error' : 'success'](`更新检查：${s.phase}${s.error ? ' — ' + s.error : ''}`)
  } finally {
    checking.value = false
  }
}

async function relaunch() {
  await ElMessageBox.confirm('重启主进程？未保存的表单内容会丢失。', '重启应用', { type: 'warning' })
  void api.relaunchApp()
}

async function resetAll() {
  await ElMessageBox.confirm('将删除偏好设置与使用历史并重启（日志保留）。确认？', '重置设置', { type: 'error', confirmButtonText: '删除并重启' })
  void api.resetSettings()
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
          <span class="dbg-sub">隐藏入口 · 仅供维护者排障</span>
          <button class="dbg-close" @click="emit('update:modelValue', false)">✕</button>
        </div>

        <div class="dbg-tabs">
          <button :class="{ on: tab === 'env' }" @click="tab = 'env'">环境</button>
          <button :class="{ on: tab === 'log' }" @click="tab = 'log'">日志</button>
          <button :class="{ on: tab === 'data' }" @click="tab = 'data'">数据</button>
          <button :class="{ on: tab === 'ops' }" @click="tab = 'ops'">操作</button>
          <button class="dbg-refresh" @click="loadAll">刷新</button>
        </div>

        <div class="dbg-body">
          <!-- 环境 -->
          <dl v-if="tab === 'env' && info" class="dbg-kv">
            <template v-for="(v, k) in info" :key="k">
              <dt>{{ k }}</dt>
              <dd>{{ v }}</dd>
            </template>
            <dt>update</dt>
            <dd>{{ updateState.phase }}{{ updateState.latest ? ' → ' + updateState.latest : '' }}{{ updateState.error ? ' · ' + updateState.error : '' }}</dd>
            <dt>update.feed</dt>
            <dd>{{ feedUrl() }}</dd>
          </dl>

          <!-- 日志 -->
          <template v-if="tab === 'log'">
            <pre class="dbg-pre">{{ dev?.logTail ?? '(未加载)' }}</pre>
            <div class="dbg-btns" style="margin-top: 10px">
              <el-button size="small" plain @click="api.openPath(`${dev?.userData ?? ''}/logs`)">打开日志目录</el-button>
              <el-button size="small" plain @click="copyAll">复制诊断信息</el-button>
            </div>
          </template>

          <!-- 数据 -->
          <template v-if="tab === 'data' && dev">
            <div class="dbg-sec">settings.json</div>
            <pre class="dbg-pre dbg-pre--short">{{ dev.settingsRaw }}</pre>
            <div class="dbg-sec">history.json（{{ dev.historyCount }} 条，前 6000 字符）</div>
            <pre class="dbg-pre dbg-pre--short">{{ dev.historyRaw }}</pre>
            <div class="dbg-btns" style="margin-top: 10px">
              <el-button size="small" plain @click="api.openUserData()">打开数据目录</el-button>
            </div>
          </template>

          <!-- 操作 -->
          <template v-if="tab === 'ops'">
            <div class="dbg-ops">
              <div class="dbg-op">
                <div>
                  <b>DevTools</b>
                  <p>独立窗口模式开/关，可看渲染层 console 与网络</p>
                </div>
                <el-button size="small" @click="toggleDevtools">{{ devtoolsOn ? '关闭' : '打开' }}</el-button>
              </div>
              <div class="dbg-op">
                <div>
                  <b>立即检查更新</b>
                  <p>绕过启动节奏，走当前配置的真实更新源（{{ feedUrl() }}）</p>
                </div>
                <el-button size="small" :loading="checking" @click="forceCheck">检查</el-button>
              </div>
              <div class="dbg-op">
                <div>
                  <b>打开项目主页</b>
                  <p>系统浏览器打开 github.com/ruai0/Lantai</p>
                </div>
                <el-button size="small" @click="api.openExternal('https://github.com/ruai0/Lantai')">打开</el-button>
              </div>
              <div class="dbg-op">
                <div>
                  <b>重启应用</b>
                  <p>主进程 relaunch，用于改设置后想干净重来</p>
                </div>
                <el-button size="small" @click="relaunch">重启</el-button>
              </div>
              <div class="dbg-op dbg-op--danger">
                <div>
                  <b>重置设置</b>
                  <p>删除偏好与使用历史后重启（日志与撤销记录保留）</p>
                </div>
                <el-button size="small" type="danger" plain @click="resetAll">重置</el-button>
              </div>
            </div>
          </template>
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
  padding-top: 10vh;
  z-index: 3200;
}
.dbg-panel {
  width: min(720px, 94vw);
  max-height: 78vh;
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
.dbg-tabs {
  display: flex;
  gap: 2px;
  padding: 8px 14px 0;
  border-bottom: 1px solid var(--line-soft);
}
.dbg-tabs button {
  border: none;
  background: transparent;
  font-size: 12.5px;
  color: var(--text-3);
  cursor: pointer;
  padding: 7px 14px 9px;
  border-bottom: 2px solid transparent;
}
.dbg-tabs button.on {
  color: var(--text-1);
  border-bottom-color: var(--amber);
}
.dbg-tabs .dbg-refresh {
  margin-left: auto;
  border: 1px solid var(--line);
  border-radius: 6px;
  padding: 3px 10px;
  align-self: center;
  margin-bottom: 6px;
}
.dbg-body {
  overflow-y: auto;
  padding: 14px 18px 18px;
}
.dbg-btns {
  display: flex;
  gap: 8px;
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
.dbg-sec {
  font-family: var(--font-mono);
  font-size: 11px;
  letter-spacing: 0.08em;
  color: var(--text-3);
  margin: 12px 0 6px;
}
.dbg-sec:first-child {
  margin-top: 0;
}
.dbg-pre {
  margin: 0;
  padding: 10px 12px;
  border: 1px solid var(--line-soft);
  border-radius: var(--r-md);
  background: var(--surface-2);
  font-family: var(--font-mono);
  font-size: 11.5px;
  line-height: 1.55;
  color: var(--text-2);
  white-space: pre-wrap;
  word-break: break-all;
  max-height: 46vh;
  overflow-y: auto;
}
.dbg-pre--short {
  max-height: 22vh;
}
.dbg-ops {
  display: flex;
  flex-direction: column;
}
.dbg-op {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 18px;
  padding: 11px 2px;
  border-bottom: 1px dashed var(--line-soft);
}
.dbg-op b {
  font-size: 13px;
  color: var(--text-1);
}
.dbg-op p {
  margin: 3px 0 0;
  font-size: 12px;
  color: var(--text-3);
}
.dbg-op--danger b {
  color: var(--el-color-danger, #f56c6c);
}
</style>
