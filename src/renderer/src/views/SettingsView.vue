<script setup lang="ts">
import { api } from '../utils/ipc'
import { computed, onMounted, ref } from 'vue'
import { ElMessage } from 'element-plus'
import { Delete, FolderChecked, Setting } from '@element-plus/icons-vue'
import StepCard from '../components/StepCard.vue'
import { basename } from '../utils/api'
import { clearHistory, history, settings, updateSettings } from '../utils/settings'
import { checkUpdate, installUpdate, syncUpdateState, updateState } from '../utils/update'
import type { EnvProbe } from '@shared/types'
import type { OnComplete, Theme } from '@shared/settings'

const version = ref('')
const loadingDir = ref(false)
const probe = ref<EnvProbe | null>(null)
const probing = ref(false)

async function loadProbe(force = false) {
  probing.value = true
  try {
    const r = await api.probe({ force })
    if (r.ok) probe.value = r.data
  } finally {
    probing.value = false
  }
}

/* ---------- 软件更新 ---------- */

const feedInput = ref('')
const checking = ref(false)
const installing = ref(false)

onMounted(async () => {
  const v = await api.getVersion()
  if (v.ok) version.value = v.data
  feedInput.value = settings.value.updateFeed
  void loadProbe()
  void syncUpdateState()
})

async function saveFeed() {
  await updateSettings({ updateFeed: feedInput.value.trim() })
}

async function runCheck() {
  checking.value = true
  try {
    await checkUpdate()
  } finally {
    checking.value = false
  }
}

async function runInstall() {
  installing.value = true
  try {
    await installUpdate()
  } catch {
    installing.value = false
  }
}

const updateStatus = computed(() => {
  const s = updateState.value
  switch (s.phase) {
    case 'checking':
      return { type: 'info' as const, text: '正在检查更新…' }
    case 'not-available':
      return { type: 'success' as const, text: `已是最新版本 v${s.current}` }
    case 'available':
    case 'downloading':
      return { type: 'warning' as const, text: `发现 v${s.latest}，下载中 ${s.percent ?? 0}%` }
    case 'ready':
      return { type: 'success' as const, text: `v${s.latest} 已下载完成，重启后生效` }
    case 'error':
      return { type: 'danger' as const, text: s.error || '更新失败' }
    default:
      return { type: 'info' as const, text: s.error ?? '尚未检查' }
  }
})

async function pickDefaultDir() {
  loadingDir.value = true
  try {
    const res = await api.pickDirectory('选择默认输出文件夹')
    if (res.ok && res.data) await updateSettings({ defaultOutDir: res.data })
  } finally {
    loadingDir.value = false
  }
}

async function clearDefaultDir() {
  await updateSettings({ defaultOutDir: '' })
}

async function chooseComplete(v: string | number | boolean) {
  await updateSettings({ onComplete: v as OnComplete })
}

async function chooseTheme(v: string | number | boolean) {
  await updateSettings({ theme: v as Theme })
}

async function toggleNotify(v: boolean | string | number) {
  await updateSettings({ notify: v === true })
}

async function copyDiagnostics() {
  const res = await api.diagnostics()
  if (!res.ok) {
    ElMessage.error(res.error)
    return
  }
  const text = Object.entries(res.data)
    .map(([k, v]) => `${k}: ${v}`)
    .join('\n')
  try {
    await navigator.clipboard.writeText(`FreeTool 诊断信息\n${text}`)
    ElMessage.success('诊断信息已复制，可直接发给技术支持')
  } catch {
    ElMessage.error('复制失败：剪贴板不可用，请截图或重试')
  }
}

function openOutput(p: string) {
  void api.openPath(p)
}

async function wipeHistory() {
  await clearHistory()
  ElMessage.success('已清空使用历史')
}

function fmtTime(t: number): string {
  const d = new Date(t)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}
</script>

<template>
  <div>
    <h1 class="page-title">设置</h1>
    <p class="page-desc">偏好保存在本机，全部功能共享同一套设置。</p>

    <StepCard :step="1" title="默认输出文件夹">
      <div class="outdir-row">
        <el-input :model-value="settings.defaultOutDir" placeholder="未设置（各功能需手动选择输出目录）" readonly />
        <el-button type="primary" plain :loading="loadingDir" @click="pickDefaultDir">选择文件夹</el-button>
        <el-button v-if="settings.defaultOutDir" link type="danger" :icon="Delete" @click="clearDefaultDir">清除</el-button>
      </div>
      <p class="hint">设置后，各功能的输出框会自动预填此目录（仍可临时改）。</p>
    </StepCard>

    <StepCard :step="2" title="任务完成后">
      <el-radio-group :model-value="settings.onComplete" @change="chooseComplete">
        <el-radio-button value="notify">仅提示</el-radio-button>
        <el-radio-button value="openFolder">打开所在文件夹</el-radio-button>
        <el-radio-button value="openFile">打开输出文件</el-radio-button>
      </el-radio-group>
      <p class="hint">统一所有导出/转换类操作完成后的行为。</p>
      <div class="notify-row">
        <span>窗口不在前台时，任务完成弹系统通知</span>
        <el-switch :model-value="settings.notify" @change="toggleNotify" />
      </div>
    </StepCard>

    <StepCard :step="3" title="外观">
      <el-radio-group :model-value="settings.theme" @change="chooseTheme">
        <el-radio-button value="light">浅色</el-radio-button>
        <el-radio-button value="dark">深色</el-radio-button>
        <el-radio-button value="system">跟随系统</el-radio-button>
      </el-radio-group>
    </StepCard>

    <StepCard :step="4" title="本机环境">
      <template #head-extra>
        <el-button link type="primary" size="small" style="margin-left: 12px" :loading="probing" @click="loadProbe(true)">
          重新探测
        </el-button>
      </template>
      <div v-if="probe" class="probe-grid">
        <div class="probe-item"><span>Word 组件</span><b :class="{ 'probe-bad': probe.word.includes('未') }">{{ probe.word }}</b></div>
        <div class="probe-item"><span>Excel 组件</span><b :class="{ 'probe-bad': probe.excel.includes('未') }">{{ probe.excel }}</b></div>
        <div class="probe-item"><span>PPT 组件</span><b :class="{ 'probe-bad': probe.ppt.includes('未') }">{{ probe.ppt }}</b></div>
        <div class="probe-item">
          <span>中文水印</span>
          <b :class="{ 'probe-bad': !probe.watermarkReady }">{{ probe.watermarkReady ? `可用（${probe.cjkFonts[0]}）` : '缺中文字体' }}</b>
        </div>
      </div>
      <p v-else class="hint">{{ probing ? '正在探测本机 Office/WPS 组件与字体…' : '尚未探测。' }}</p>
      <p class="hint">「Office 转 PDF」与「PDF 中文水印」依赖以上环境；内网装机验收时先看这里，报错时也请连诊断信息一起反馈。</p>
    </StepCard>

    <StepCard :step="5" title="使用历史">
      <template #head-extra>
        <el-button v-if="history.length" link type="danger" size="small" style="margin-left: 12px" @click="wipeHistory">
          清空
        </el-button>
      </template>
      <el-table v-if="history.length" :data="history" size="small" max-height="420">
        <el-table-column label="时间" width="150">
          <template #default="{ row }">{{ fmtTime(row.time) }}</template>
        </el-table-column>
        <el-table-column prop="label" label="功能" width="120" />
        <el-table-column label="输出">
          <template #default="{ row }">
            <div class="hist-outputs">
              <span v-for="p in row.outputs.slice(0, 3)" :key="p" class="hist-file" :title="p">{{ basename(p) }}</span>
              <span v-if="row.outputs.length > 3" class="hist-more">…共 {{ row.outputs.length }} 项</span>
            </div>
          </template>
        </el-table-column>
        <el-table-column label="" width="90">
          <template #default="{ row }">
            <el-button link type="primary" size="small" :icon="FolderChecked" @click="openOutput(row.outputs[0])">打开</el-button>
          </template>
        </el-table-column>
      </el-table>
      <el-empty v-else description="还没有产出记录" :image-size="60" />
    </StepCard>

    <StepCard :step="6" title="软件更新">
      <div class="outdir-row">
        <el-input
          v-model="feedInput"
          placeholder="更新源地址，如 https://dl.example.com/freetool 或 https://github.com/ruai1024/freetool（留空 = 永不检查）"
          clearable
          @change="saveFeed"
        />
        <el-button type="primary" plain :loading="checking" @click="runCheck">检查更新</el-button>
        <el-button v-if="updateState.phase === 'ready'" type="success" :loading="installing" @click="runInstall">
          重启并安装
        </el-button>
      </div>
      <p class="hint">
        当前版本 v{{ version }} ·
        <el-tag :type="updateStatus.type" size="small">{{ updateStatus.text }}</el-tag>
      </p>
      <p v-if="updateState.notes" class="hint" style="white-space: pre-wrap">{{ updateState.notes }}</p>
      <p class="hint">
        更新源指向存放 latest.yml + 安装包的目录（自建静态服务或 GitHub Releases 仓库主页均可）。未配置时应用不会发起任何网络请求；
        安装包未做代码签名，升级包完整性由 SHA-512 校验。
      </p>
    </StepCard>

    <div class="about">
      <el-icon><Setting /></el-icon>
      <span>FreeTool 办公工具箱 v{{ version }}</span>
      <span class="about-dot">·</span>
      <span>本机离线处理，文件不出电脑</span>
      <el-button link type="primary" size="small" style="margin-left: auto" @click="copyDiagnostics">复制诊断信息</el-button>
    </div>
  </div>
</template>

<style scoped>
.hint {
  margin: 10px 0 0;
  font-size: 12px;
  color: var(--text-3);
}
.notify-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-top: 14px;
  padding-top: 14px;
  border-top: 1px solid var(--line-soft);
  font-size: 13px;
  color: var(--text-2);
}
.hist-outputs {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.hist-file {
  font-family: var(--font-mono);
  font-size: 12px;
  color: var(--text-2);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.hist-more {
  font-size: 12px;
  color: var(--text-3);
}
.probe-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px 24px;
}
.probe-item {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  gap: 12px;
  padding: 7px 10px;
  border: 1px solid var(--line-soft);
  border-radius: var(--r-md);
  background: var(--surface-2);
  font-size: 12.5px;
  color: var(--text-3);
}
.probe-item b {
  color: var(--text-1);
  font-weight: 500;
  text-align: right;
}
.probe-bad {
  color: var(--el-color-danger, #f56c6c) !important;
}
.about {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 20px;
  padding: 12px 14px;
  border: 1px solid var(--line);
  border-radius: var(--r-md);
  background: var(--surface);
  color: var(--text-2);
  font-size: 12.5px;
}
.about-dot {
  color: var(--text-3);
}
</style>
