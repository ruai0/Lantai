<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElNotification } from 'element-plus'
import { HomeFilled, Search, Setting } from '@element-plus/icons-vue'
import CommandPalette from './components/CommandPalette.vue'
import TaskDock from './components/TaskDock.vue'
import DebugDialog from './components/DebugDialog.vue'
import CloseChoiceDialog from './components/CloseChoiceDialog.vue'
import WelcomeDialog from './components/WelcomeDialog.vue'
import { groupedTools, toolByPath, type ToolDef } from './tools'
import { favorites, settings } from './utils/settings'
import { api } from './utils/ipc'
import { syncUpdateState, updateState } from './utils/update'

const route = useRoute()
const router = useRouter()
const active = computed(() => route.path)

const appVersion = ref('')
onMounted(() => {
  void api.getVersion().then(r => {
    if (r.ok) appVersion.value = r.data
  })
  void syncUpdateState()
})

watch(
  () => updateState.value.phase,
  phase => {
    if (phase !== 'ready') return
    const latest = updateState.value.latest ?? ''
    const notes = (updateState.value.notes ?? '').replace(/^#+\s*/gm, '').trim()
    ElNotification({
      title: `新版本 v${latest} 已就绪`,
      message: notes ? notes.slice(0, 100) + (notes.length > 100 ? '…' : '') : '点击打开设置 → 软件更新，重启安装',
      type: 'success',
      duration: 0,
      onClick: () => void router.push('/settings')
    })
  }
)

const paletteOpen = ref(false)
const debugOpen = ref(false)
const closeChoiceOpen = ref(false)

/** 隐藏调试口令：任意处（非输入框）连续键入 xiaoruai 弹出调试面板 */
const SECRET = 'xiaoruai'
let secretBuf = ''

function onGlobalKey(e: KeyboardEvent): void {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
    e.preventDefault()
    paletteOpen.value = !paletteOpen.value
    return
  }
  const t = e.target as HTMLElement | null
  const typing = !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || !!t.isContentEditable)
  if (typing || e.ctrlKey || e.metaKey || e.altKey) return
  if (!/^[a-zA-Z]$/.test(e.key)) return
  secretBuf = (secretBuf + e.key.toLowerCase()).slice(-SECRET.length)
  if (secretBuf === SECRET) {
    secretBuf = ''
    debugOpen.value = !debugOpen.value
  }
}

interface NavGroup {
  title: string
  items: Array<{ path: string; label: string; icon: ToolDef['icon'] | typeof HomeFilled }>
}

const toolGroups = computed<NavGroup[]>(() =>
  groupedTools().map(g => ({ title: g.title, items: g.tools.map(t => ({ path: t.path, label: t.name, icon: t.icon })) }))
)

const favGroup = computed<NavGroup | null>(() => {
  const items = favorites.value
    .map(p => toolByPath(p))
    .filter((t): t is ToolDef => !!t)
    .map(t => ({ path: t.path, label: t.name, icon: t.icon }))
  return items.length ? { title: '收藏', items } : null
})

onMounted(() => window.addEventListener('keydown', onGlobalKey))
onMounted(() => {
  const off = api.onWindowCloseRequest(() => (closeChoiceOpen.value = true))
  onBeforeUnmount(off)
})
onBeforeUnmount(() => window.removeEventListener('keydown', onGlobalKey))
</script>

<template>
  <el-container class="app-shell">
    <el-aside width="214px" class="app-aside">
      <div class="brand" @click="$router.push('/')">
        <div class="brand-mark" />
        <div class="brand-text">
          <div class="brand-word">兰台</div>
          <div class="brand-sub">办公工具箱</div>
        </div>
      </div>

      <div class="rail-search" @click="paletteOpen = true">
        <el-icon><Search /></el-icon>
        <span>搜索工具 / 命令</span>
        <kbd>Ctrl K</kbd>
      </div>

      <el-menu router :default-active="active" class="app-menu">
        <el-menu-item-group title="工作台">
          <el-menu-item index="/">
            <el-icon><HomeFilled /></el-icon>
            <span>总览</span>
          </el-menu-item>
        </el-menu-item-group>

        <el-menu-item-group v-if="favGroup" :title="favGroup.title">
          <el-menu-item v-for="m in favGroup.items" :key="m.path" :index="m.path">
            <el-icon><component :is="m.icon" /></el-icon>
            <span>{{ m.label }}</span>
          </el-menu-item>
        </el-menu-item-group>

        <el-menu-item-group v-for="g in toolGroups" :key="g.title" :title="g.title">
          <el-menu-item v-for="m in g.items" :key="m.path" :index="m.path">
            <el-icon><component :is="m.icon" /></el-icon>
            <span>{{ m.label }}</span>
          </el-menu-item>
        </el-menu-item-group>

        <el-menu-item-group title="系统">
          <el-menu-item index="/settings">
            <el-icon><Setting /></el-icon>
            <span>设置</span>
          </el-menu-item>
        </el-menu-item-group>
      </el-menu>

      <div class="rail-status">
        <span class="rail-ver">兰台 v{{ appVersion }} · by ruai0</span>
      </div>
    </el-aside>
    <el-main class="app-main">
      <div :key="route.path" class="view-enter">
        <router-view />
      </div>
    </el-main>

    <CommandPalette v-model="paletteOpen" />
    <TaskDock />
    <DebugDialog v-model="debugOpen" />
    <CloseChoiceDialog v-model="closeChoiceOpen" />
    <WelcomeDialog v-if="!settings.onboarded && appVersion" />
  </el-container>
</template>

<style scoped>
.brand {
  cursor: pointer;
  user-select: none;
}
.rail-search {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 2px 12px 8px;
  padding: 7px 10px;
  border: 1px solid var(--rail-line);
  border-radius: var(--r-md);
  color: var(--rail-text);
  font-size: 12.5px;
  cursor: pointer;
  transition: border-color 0.15s, color 0.15s;
}
.rail-search:hover {
  border-color: rgba(242, 167, 59, 0.5);
  color: var(--rail-text-hi);
}
.rail-search kbd {
  margin-left: auto;
  font-family: var(--font-mono);
  font-size: 10px;
  color: var(--rail-text);
  border: 1px solid var(--rail-line);
  border-radius: 4px;
  padding: 1px 5px;
}
</style>
