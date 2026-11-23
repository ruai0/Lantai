<script setup lang="ts">
import { computed, onActivated, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { Star, StarFilled } from '@element-plus/icons-vue'
import { groupedTools, toolByPath, type ToolDef } from '../tools'
import { favorites, isFavorite, toggleFavorite } from '../utils/settings'
import { recentToolPaths } from '../utils/recentTools'
import { api } from '../utils/ipc'

const router = useRouter()

const version = ref('')
onMounted(() => {
  void api.getVersion().then(r => {
    if (r.ok) version.value = r.data
  })
})

function openRepo(): void {
  void api.openExternal('https://github.com/ruai0/Lantai')
}

const indexed = computed(() => groupedTools())
const total = computed(() => groupedTools().reduce((n, g) => n + g.tools.length, 0))
const pinned = computed<ToolDef[]>(() => favorites.value.map(p => toolByPath(p)).filter((t): t is ToolDef => !!t))

/**
 * 最近使用：自动按使用频次排，排除已收藏的（收藏区已经列了，重复出现反而浪费版面）。
 * 每次回到首页重算一次，这样从工具页返回就能看到最新顺序。
 */
const recent = ref<ToolDef[]>([])
function refreshRecent(): void {
  recent.value = recentToolPaths(4)
    .filter(p => !isFavorite(p))
    .map(p => toolByPath(p))
    .filter((t): t is ToolDef => !!t)
}
onMounted(refreshRecent)
onActivated(refreshRecent)

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
        兰台，汉代典籍藏书之所。{{ total }} 组办公工具覆盖 PDF、Office 文档、Excel 台账与日常文件整理。<br />
        全部在本机完成，<b style="color: #f2a73b">文件不出电脑</b>，内网与涉密环境可离线使用。
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

    <!-- 最近使用：一行紧凑标签。下方分组里本来就有同样的工具，
         做成大卡片会和分组重复展示、白占首屏高度 -->
    <section v-if="recent.length" class="recent-bar">
      <span class="recent-label">最近</span>
      <button
        v-for="t in recent"
        :key="'recent-' + t.path"
        class="recent-chip"
        :title="t.desc"
        @click="router.push(t.path)"
      >
        <el-icon :size="14"><component :is="t.icon" /></el-icon>
        <span>{{ t.name }}</span>
      </button>
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

    <footer class="home-foot">
      <span>兰台（Lantai）v{{ version }} · © 2026 <b>ruai0</b> · 个人免费 · 单位需授权</span>
      <a class="home-foot-link" title="项目主页" @click="openRepo">github.com/ruai0/Lantai ↗</a>
    </footer>
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
.home-foot {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 14px;
  margin: 34px 0 8px;
  padding-top: 18px;
  border-top: 1px dashed var(--line);
  font-size: 12px;
  color: var(--text-3);
}
.home-foot b {
  color: var(--text-2);
  font-weight: 600;
}
.home-foot-link {
  color: var(--text-3);
  cursor: pointer;
  font-family: var(--font-mono);
  font-size: 11.5px;
  text-decoration: none;
}
.home-foot-link:hover {
  color: var(--amber);
}

/* 最近使用：一行标签条。与下方分组重复的工具不再各占一张大卡片 */
.recent-bar {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  margin: 4px 0 18px;
  padding: 8px 12px;
  background: var(--surface-2);
  border: 1px solid var(--line);
  border-radius: var(--r-md);
}
.recent-label {
  font-size: 12px;
  color: var(--text-3);
  letter-spacing: 0.04em;
  margin-right: 2px;
}
.recent-chip {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 4px 10px;
  font-size: 12.5px;
  color: var(--text-1);
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: 999px;
  cursor: pointer;
  transition: border-color 0.15s, color 0.15s;
}
.recent-chip:hover {
  color: var(--accent);
  border-color: var(--accent);
}
</style>
