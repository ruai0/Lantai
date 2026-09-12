<script setup lang="ts">
import { computed } from 'vue'
import { useRoute } from 'vue-router'
import {
  Connection,
  CopyDocument,
  Document,
  EditPen,
  Files,
  FolderChecked,
  Grid,
  HomeFilled,
  Picture,
  Promotion,
  Search
} from '@element-plus/icons-vue'

const route = useRoute()
const active = computed(() => route.path)

const groups = [
  {
    title: '工作台',
    items: [{ path: '/', label: '总览', icon: HomeFilled }]
  },
  {
    title: '文档与 PDF',
    items: [
      { path: '/pdf', label: 'PDF 工具', icon: Document },
      { path: '/image', label: '图片工具', icon: Picture },
      { path: '/convert', label: '转 PDF', icon: Promotion },
      { path: '/office', label: '文档模板', icon: Files },
      { path: '/replace', label: '批量替换', icon: Search }
    ]
  },
  {
    title: '表格与数据',
    items: [
      { path: '/excel', label: 'Excel 工具', icon: Grid },
      { path: '/match', label: '匹配与比对', icon: Connection }
    ]
  },
  {
    title: '文件与效率',
    items: [
      { path: '/rename', label: '批量重命名', icon: EditPen },
      { path: '/filekit', label: '文件管理', icon: FolderChecked },
      { path: '/tools', label: '常用小工具', icon: CopyDocument }
    ]
  }
]
</script>

<template>
  <el-container class="app-shell">
    <el-aside width="214px" class="app-aside">
      <div class="brand" @click="$router.push('/')">
        <div class="brand-mark" />
        <div class="brand-text">
          <div class="brand-word">FreeTool</div>
          <div class="brand-sub">办公工具箱</div>
        </div>
      </div>

      <el-menu router :default-active="active" class="app-menu">
        <el-menu-item-group v-for="g in groups" :key="g.title" :title="g.title">
          <el-menu-item v-for="m in g.items" :key="m.path" :index="m.path">
            <el-icon><component :is="m.icon" /></el-icon>
            <span>{{ m.label }}</span>
          </el-menu-item>
        </el-menu-item-group>
      </el-menu>

      <div class="rail-status">
        <i class="pulse" />
        <span>本机离线处理</span>
        <span class="rail-ver">v0.5</span>
      </div>
    </el-aside>
    <el-main class="app-main">
      <div :key="route.path" class="view-enter">
        <router-view />
      </div>
    </el-main>
  </el-container>
</template>

<style scoped>
.brand {
  cursor: pointer;
  user-select: none;
}
</style>
