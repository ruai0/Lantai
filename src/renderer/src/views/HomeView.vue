<script setup lang="ts">
import { computed } from 'vue'
import { useRouter } from 'vue-router'
import { Star, StarFilled } from '@element-plus/icons-vue'
import { groupedTools, toolByPath, type ToolDef } from '../tools'
import { favorites, isFavorite, toggleFavorite } from '../utils/settings'

const router = useRouter()

let seq = 0
const indexed = computed(() =>
  groupedTools().map(g => ({
    ...g,
    tools: g.tools.map(t => ({ ...t, idx: String(++seq).padStart(2, '0') }))
  }))
)
const total = computed(() => groupedTools().reduce((n, g) => n + g.tools.length, 0))

const pinned = computed<ToolDef[]>(() => favorites.value.map(p => toolByPath(p)).filter((t): t is ToolDef => !!t))

async function toggle(t: ToolDef, e: Event): Promise<void> {
  e.stopPropagation()
  await toggleFavorite(t.path)
}
</script>

<template>
  <div>
    <header class="hero">
      <div class="hero-kicker">Lantai · 本地文件处理</div>
      <h1 class="hero-title">兰台</h1>
      <p class="hero-lead">
        兰台，汉代典籍藏书之所。{{ total }} 组办公工具覆盖 PDF、Office 文档、Excel 台账与日常文件整理。全部在本机完成，
        <b style="color: #f2a73b">文件不出电脑</b>，内网与涉密环境可直接使用。
      </p>
      <div class="hero-stats">
        <div>
          <div class="stat-num">{{ total }}<em>组</em></div>
          <div class="stat-label">工具模块</div>
        </div>
        <div>
          <div class="stat-num">50<em>+</em></div>
          <div class="stat-label">处理能力</div>
        </div>
        <div>
          <div class="stat-num">0<em>次</em></div>
          <div class="stat-label">文件上传</div>
        </div>
      </div>

      <!-- 右侧仪表装饰 -->
      <div class="hero-gauge" aria-hidden="true">
        <div class="gauge-ticks"></div>
        <div class="gauge-arc"></div>
        <div class="gauge-core">
          <div class="gauge-val">100<em>%</em></div>
          <div class="gauge-cap">LOCAL</div>
        </div>
      </div>
    </header>

    <section v-if="pinned.length">
      <div class="section-label">
        <span>常用工具</span>
        <span style="letter-spacing: 0.04em; text-transform: none; font-family: var(--font-body)">你收藏的，点击卡片直达</span>
      </div>
      <div class="tool-grid">
        <el-card
          v-for="t in pinned"
          :key="'fav-' + t.path"
          class="tool-card tool-card--fav"
          shadow="never"
          @click="router.push(t.path)"
        >
          <div class="tool-head">
            <div class="tool-icon">
              <el-icon :size="19"><component :is="t.icon" /></el-icon>
            </div>
            <div>
              <div class="tool-name">{{ t.name }}</div>
              <div class="tool-idx">已收藏</div>
            </div>
          </div>
          <div class="tool-desc">{{ t.desc }}</div>
          <button class="tool-star" title="取消收藏" @click="toggle(t, $event)">
            <el-icon :size="16"><StarFilled /></el-icon>
          </button>
        </el-card>
      </div>
    </section>

    <section v-for="g in indexed" :key="g.title">
      <div class="section-label">
        <span>{{ g.title }}</span>
        <span style="letter-spacing: 0.04em; text-transform: none; font-family: var(--font-body)">{{ g.caption }}</span>
      </div>
      <div class="tool-grid">
        <el-card
          v-for="(t, i) in g.tools"
          :key="t.path"
          class="tool-card"
          shadow="never"
          :style="{ '--d': `${120 + i * 55}ms` }"
          @click="router.push(t.path)"
        >
          <div class="tool-head">
            <div class="tool-icon">
              <el-icon :size="19"><component :is="t.icon" /></el-icon>
            </div>
            <div>
              <div class="tool-name">{{ t.name }}</div>
              <div class="tool-idx">NO.{{ t.idx }}</div>
            </div>
          </div>
          <div class="tool-desc">{{ t.desc }}</div>
          <button
            class="tool-star"
            :class="{ 'tool-star--on': isFavorite(t.path) }"
            :title="isFavorite(t.path) ? '取消收藏' : '收藏到常用'"
            @click="toggle(t, $event)"
          >
            <el-icon :size="16"><StarFilled v-if="isFavorite(t.path)" /><Star v-else /></el-icon>
          </button>
          <span class="tool-arrow">→</span>
        </el-card>
      </div>
    </section>
  </div>
</template>

<style scoped>
.tool-star {
  position: absolute;
  top: 12px;
  right: 12px;
  border: none;
  background: transparent;
  color: var(--text-3);
  cursor: pointer;
  padding: 4px;
  border-radius: 6px;
  opacity: 0;
  transition: opacity 0.15s, color 0.15s, background 0.15s;
  display: inline-flex;
}
.tool-card:hover .tool-star {
  opacity: 1;
}
.tool-star:hover {
  background: var(--surface-2);
  color: var(--amber);
}
.tool-star--on {
  opacity: 1;
  color: var(--amber);
}
.tool-card--fav .tool-star {
  opacity: 1;
  color: var(--amber);
}
</style>
