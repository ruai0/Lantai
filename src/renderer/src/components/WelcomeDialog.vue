<script setup lang="ts">
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import { updateSettings } from '../utils/settings'

/** 新用户首启三步指引：只出现一次，完成/跳过都会记录 onboarded */
const emit = defineEmits<{ (e: 'done'): void }>()
const router = useRouter()

const step = ref(0)
const STEPS = 3

function next(): void {
  if (step.value < STEPS - 1) step.value++
  else finish()
}

function finish(): void {
  void updateSettings({ onboarded: true })
  emit('done')
}

function toSettings(): void {
  finish()
  void router.push('/settings')
}
</script>

<template>
  <div class="wc-mask">
    <div class="wc-panel">
      <div class="wc-head">
        <span class="wc-brand">兰台</span>
        <span class="wc-step">{{ step + 1 }} / {{ STEPS }}</span>
        <button class="wc-skip" @click="finish">跳过</button>
      </div>

      <div class="wc-body">
        <template v-if="step === 0">
          <h2>欢迎使用兰台</h2>
          <p>
            这是一个<b>完全离线</b>的办公文书工具箱：PDF、Office、Excel 台账的批量处理全在本机完成，
            <em style="color: #f2a73b; font-style: normal">文件不出电脑</em>，内网与涉密环境可放心使用。
          </p>
          <p>关闭主窗口时兰台会收进右下角托盘继续待命，需要退出请在托盘图标上右键。</p>
        </template>
        <template v-else-if="step === 1">
          <h2>三步用起来</h2>
          <ul class="wc-list">
            <li><b>1</b>把文件或整个文件夹拖进虚线框（或点按钮选择）</li>
            <li><b>2</b>选好输出目录——建议先到设置里定一个默认输出文件夹，之后全自动预填</li>
            <li><b>3</b>点执行。批量任务在右下角有进度，跑着也能切去干别的活</li>
          </ul>
          <p>找不到功能？按 <kbd>Ctrl</kbd>+<kbd>K</kbd> 搜索，常用工具可以点卡片右上角星标收藏。</p>
        </template>
        <template v-else>
          <h2>更新与反馈</h2>
          <p>
            应用会默认从官方仓库检查新版本并自动下载，右下角提示「重启安装」即可升级；
            离线机器可在「设置 → 软件更新」关闭。
          </p>
          <p>
            遇到不确定的报错：设置页底部「复制诊断信息」一键复制环境全量信息，连同问题描述发到
            <b>1393930984@qq.com</b>（单位授权洽谈同邮箱），报障不用截图。
          </p>
        </template>
      </div>

      <div class="wc-foot">
        <div class="wc-dots">
          <i v-for="i in STEPS" :key="i" :class="{ on: i - 1 === step }" />
        </div>
        <el-button v-if="step === 1" link type="primary" @click="toSettings">去设置默认输出目录 →</el-button>
        <el-button :type="step === STEPS - 1 ? 'primary' : 'default'" @click="next">
          {{ step === STEPS - 1 ? '开始使用' : '下一步' }}
        </el-button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.wc-mask {
  position: fixed;
  inset: 0;
  background: rgba(8, 12, 20, 0.55);
  backdrop-filter: blur(3px);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 3400;
}
.wc-panel {
  width: min(520px, 92vw);
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: var(--r-lg);
  box-shadow: var(--shadow-lg);
  padding: 20px 26px 22px;
}
.wc-head {
  display: flex;
  align-items: baseline;
  gap: 12px;
  padding-bottom: 12px;
  border-bottom: 1px solid var(--line-soft);
}
.wc-brand {
  font-family: var(--font-doc);
  font-size: 18px;
  font-weight: 700;
  letter-spacing: 0.2em;
  color: var(--amber);
}
.wc-step {
  font-family: var(--font-mono);
  font-size: 11px;
  color: var(--text-3);
}
.wc-skip {
  margin-left: auto;
  border: none;
  background: transparent;
  color: var(--text-3);
  font-size: 12.5px;
  cursor: pointer;
}
.wc-skip:hover {
  color: var(--text-1);
}
.wc-body {
  min-height: 190px;
  padding: 18px 2px;
}
.wc-body h2 {
  margin: 0 0 12px;
  font-family: var(--font-doc);
  font-size: 20px;
  letter-spacing: 0.06em;
  color: var(--text-1);
}
.wc-body p {
  margin: 0 0 10px;
  font-size: 13.5px;
  line-height: 1.8;
  color: var(--text-2);
}
.wc-list {
  margin: 0 0 12px;
  padding: 0;
  list-style: none;
}
.wc-list li {
  display: flex;
  gap: 10px;
  align-items: baseline;
  padding: 6px 0;
  font-size: 13.5px;
  color: var(--text-2);
  line-height: 1.7;
}
.wc-list b {
  flex-shrink: 0;
  width: 20px;
  height: 20px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  background: var(--accent-wash);
  color: var(--amber);
  font-family: var(--font-mono);
  font-size: 12px;
}
.wc-body kbd {
  font-family: var(--font-mono);
  font-size: 11px;
  border: 1px solid var(--line);
  border-bottom-width: 2px;
  border-radius: 4px;
  padding: 0 5px;
  margin: 0 2px;
}
.wc-foot {
  display: flex;
  align-items: center;
  gap: 14px;
  padding-top: 14px;
  border-top: 1px solid var(--line-soft);
}
.wc-dots {
  display: flex;
  gap: 6px;
  margin-right: auto;
}
.wc-dots i {
  width: 18px;
  height: 3px;
  border-radius: 2px;
  background: var(--line);
}
.wc-dots i.on {
  background: var(--amber);
}
</style>
