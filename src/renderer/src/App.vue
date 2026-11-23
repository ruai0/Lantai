<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { SHELL_ACTION_ROUTE, useShellFiles } from './utils/shellIntent'
import { touchTool } from './utils/recentTools'
import { ElMessage, ElNotification } from 'element-plus'
import { Fold, FullScreen, HomeFilled, RefreshLeft, Search, Setting } from '@element-plus/icons-vue'
import CommandPalette from './components/CommandPalette.vue'
import TaskDock from './components/TaskDock.vue'
import DebugDialog from './components/DebugDialog.vue'
import CloseChoiceDialog from './components/CloseChoiceDialog.vue'
import WelcomeDialog from './components/WelcomeDialog.vue'
import logoUrl from './assets/logo.png'
import { groupedTools, toolByPath, type ToolDef } from './tools'
import { favorites, settings, updateSettings } from './utils/settings'
import { api } from './utils/ipc'
import { syncUpdateState, updateState } from './utils/update'

const route = useRoute()
const router = useRouter()
const { shellFiles } = useShellFiles()
const active = computed(() => route.path)

/** 进入工具页就记一次使用，首页「最近使用」据此排序 */
watch(
  () => route.path,
  p => {
    if (toolByPath(p)) touchTool(p)
  },
  { immediate: true }
)

const appVersion = ref('')
/** 麒麟/Linux 为测试版发行，侧栏底部加标识；Windows 正式版不显示 */
const isLinux = api.platform === 'linux'
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
  // Ctrl+B 折叠/展开侧栏（与主流编辑器一致，中老年用户也能一键让出宽度）
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'b') {
    e.preventDefault()
    toggleCollapsed()
    return
  }
  // Esc 退出沉浸模式
  if (e.key === 'Escape' && immersive.value) {
    immersive.value = false
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

/**
 * 侧栏分组顺序：工作台 / 收藏（有才显示）/ 各工具组 / 系统。
 * 注意：**不用 el-menu-item-group**——Element Plus 的折叠态只照顾直接子级菜单项
 * （标签隐藏是 `.el-menu--collapse>.el-menu-item>span` 直接子选择器，group 里的项漏掉；
 *  分组标题则既不隐藏也不给 nowrap，64px 栏宽下中文一字一行竖排）。
 * 菜单项提为直接子级 + 标签走 #title 槽（折叠时自动进悬浮 tooltip），分组标题用自绘 div。
 */
const railGroups = computed<NavGroup[]>(() => {
  const groups: NavGroup[] = [{ title: '工作台', items: [{ path: '/', label: '总览', icon: HomeFilled }] }]
  if (favGroup.value) groups.push(favGroup.value)
  groups.push(...toolGroups.value)
  groups.push({ title: '系统', items: [{ path: '/settings', label: '设置', icon: Setting }] })
  return groups
})

/* ---------- 侧栏折叠 / 沉浸模式 ---------- */

/** 侧栏是否收成图标栏：给工具区让宽度，设置里记住，Ctrl+B 随时切换 */
const collapsed = computed(() => settings.value.sidebarCollapsed)
function toggleCollapsed(): void {
  void updateSettings({ sidebarCollapsed: !settings.value.sidebarCollapsed })
}

/** 沉浸模式：藏起侧栏与顶栏，让工作台/预览吃满整窗；Esc 或浮动按钮退出 */
const immersive = ref(false)
watch(immersive, v => {
  document.body.classList.toggle('is-immersive', v)
})

onMounted(() => window.addEventListener('keydown', onGlobalKey))
onMounted(() => {
  const off = api.onWindowCloseRequest(() => (closeChoiceOpen.value = true))
  onBeforeUnmount(off)
})

/* ---------- 资源管理器右键菜单唤起 ---------- */

/**
 * 从资源管理器右键点进来的文件：按动作跳到对应工具并把文件塞进待处理区。
 * 启动时取一次（主进程取完即清空），应用已开着时由主进程推送过来。
 */
async function consumeShellIntent(intent: { action: string; files: string[] } | null): Promise<void> {
  if (!intent) return
  shellFiles.value = intent.files
  const route = SHELL_ACTION_ROUTE[intent.action] ?? '/'
  if (intent.files.length) {
    ElMessage.success(`已接收 ${intent.files.length} 个文件，可直接开始处理`)
  }
  await router.push(route)
}

onMounted(async () => {
  const r = await api.takeShellIntent()
  if (r.ok) await consumeShellIntent(r.data)
  const off = api.onShellIntent(p => void consumeShellIntent(p))
  onBeforeUnmount(off)
})
onBeforeUnmount(() => window.removeEventListener('keydown', onGlobalKey))
</script>

<template>
  <el-container class="app-shell" :class="{ 'rail-collapsed': collapsed, 'is-immersive': immersive }">
    <el-aside :width="collapsed ? '64px' : '214px'" class="app-aside">
      <div class="brand" :class="{ 'brand--mini': collapsed }" @click="$router.push('/')">
        <img class="brand-mark" :src="logoUrl" alt="" />
        <div v-if="!collapsed" class="brand-text">
          <div class="brand-word">兰台</div>
          <div class="brand-sub">办公工具箱</div>
        </div>
      </div>

      <div class="rail-search" :class="{ 'rail-search--mini': collapsed }" :title="collapsed ? '搜索工具 / 命令 (Ctrl K)' : ''" @click="paletteOpen = true">
        <el-icon><Search /></el-icon>
        <span v-if="!collapsed">搜索工具 / 命令</span>
        <kbd v-if="!collapsed">Ctrl K</kbd>
      </div>

      <el-menu
        router
        :collapse="collapsed"
        :default-active="active"
        class="app-menu"
      >
        <template v-for="(g, gi) in railGroups" :key="g.title">
          <!-- 分组标题自绘：折叠态换成浅分隔线（EP 的 group 标题折叠时会竖排） -->
          <div v-if="!collapsed" class="rail-group-title">{{ g.title }}</div>
          <div v-else-if="gi > 0" class="rail-group-rule" />
          <el-menu-item v-for="m in g.items" :key="m.path" :index="m.path">
            <!-- 标签放 #title 槽：折叠时 EP 自动收进悬浮 tooltip，展开时正常显示在图标后 -->
            <template #title><span class="rail-label">{{ m.label }}</span></template>
            <el-icon><component :is="m.icon" /></el-icon>
          </el-menu-item>
        </template>
      </el-menu>

      <div v-if="!collapsed" class="rail-status">
        <span class="rail-ver">兰台 v{{ appVersion }} · by ruai0</span>
        <span v-if="isLinux" class="rail-beta" title="麒麟/Linux 版本为测试版，功能与稳定性持续完善中">麒麟测试版</span>
      </div>
    </el-aside>

    <el-main class="app-main">
      <!-- 顶部功能栏：侧栏开关 + 沉浸模式开关。常驻但只有 40px 高，不抢内容空间 -->
      <div class="topbar">
        <el-tooltip :content="collapsed ? '展开侧栏 (Ctrl B)' : '收起侧栏 (Ctrl B)'" placement="bottom">
          <button class="topbar-btn" :aria-label="collapsed ? '展开侧栏' : '收起侧栏'" @click="toggleCollapsed">
            <el-icon :size="16"><Fold /></el-icon>
          </button>
        </el-tooltip>
        <!-- 这条提示只在首页出现：进了具体工具页，用户早就知道侧栏能收了，常驻只会占地方 -->
        <span v-if="route.path === '/'" class="topbar-hint">{{ collapsed ? '侧栏已收起，点左上角或按 Ctrl+B 展开' : '收起侧栏可让内容区更宽，页签不再折行' }}</span>
        <span v-else-if="collapsed" class="topbar-hint">侧栏已收起，按 Ctrl+B 展开</span>
        <div class="topbar-right">
          <el-tooltip :content="immersive ? '退出全屏 (Esc)' : '全屏专注模式'" placement="bottom">
            <button class="topbar-btn" :class="{ 'topbar-btn--on': immersive }" :aria-label="immersive ? '退出全屏' : '全屏专注模式'" @click="immersive = !immersive">
              <el-icon :size="16"><component :is="immersive ? RefreshLeft : FullScreen" /></el-icon>
            </button>
          </el-tooltip>
        </div>
      </div>

      <!-- KeepAlive 缓存各工具页：切到别的工具再回来，已选文件与参数仍在，不用从头重来 -->
      <router-view v-slot="{ Component }">
        <keep-alive>
          <component :is="Component" :key="route.path" class="view-enter" />
        </keep-alive>
      </router-view>

      <button v-if="immersive" class="immersive-exit" @click="immersive = false">退出全屏</button>
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
.brand--mini {
  display: flex;
  justify-content: center;
}
.rail-search--mini {
  justify-content: center;
  padding: 7px 0;
}
.rail-search--mini .el-icon {
  margin: 0;
}
/* 侧栏折叠时子项图标居中，恢复常规内距 */
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
/* 顶部功能栏：侧栏开关 + 面包屑 + 沉浸开关。常驻但只有 40px 高，不抢内容空间 */
.topbar {
  display: flex;
  align-items: center;
  gap: 8px;
  height: 40px;
  margin: -6px -4px 12px;
  padding: 0 4px;
  border-bottom: 1px solid var(--line-soft);
}
.topbar-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 30px;
  height: 30px;
  border: 1px solid transparent;
  border-radius: var(--r-sm);
  background: none;
  color: var(--text-2);
  cursor: pointer;
  transition: background 0.15s, color 0.15s, border-color 0.15s;
}
.topbar-btn:hover {
  background: var(--surface-2);
  border-color: var(--line);
  color: var(--text-1);
}
.topbar-btn--on {
  color: var(--accent);
  border-color: var(--accent-wash);
  background: var(--accent-wash);
}
.topbar-hint {
  margin-left: 4px;
  font-size: 12px;
  color: var(--text-3);
}
.topbar-right {
  margin-left: auto;
  display: flex;
  align-items: center;
  gap: 6px;
}
/* 沉浸模式：藏起侧栏与顶栏，工具内容吃满整窗 */
.is-immersive .app-aside,
.is-immersive .topbar {
  display: none;
}
.immersive-exit {
  position: fixed;
  right: 18px;
  bottom: 18px;
  z-index: 20;
  padding: 7px 14px;
  border: 1px solid var(--line);
  border-radius: 999px;
  background: var(--surface);
  color: var(--text-2);
  font-size: 12.5px;
  cursor: pointer;
  box-shadow: var(--shadow-sm);
}
.immersive-exit:hover {
  color: var(--accent);
  border-color: var(--accent);
}
body.is-immersive {
  overflow: hidden;
}
</style>
