<script setup lang="ts">
import { api } from '../utils/ipc'
import { computed, ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import { DocumentCopy, FolderOpened } from '@element-plus/icons-vue'
import { basename, dirname } from '../utils/api'
import FilePreview from './FilePreview.vue'

const props = defineProps<{ outputs: string[] }>()
const dir = computed(() => (props.outputs.length ? dirname(props.outputs[0]) : ''))

async function openDir() {
  await api.openPath(dir.value)
}

/** 直接打开某个产出文件：省掉"先开文件夹再一个个找" */
async function openFile(p: string) {
  await api.openPath(p)
}

/** 可内置预览的类型才显示预览按钮（PDF / 图片） */
function previewable(p: string): boolean {
  return /\.pdf$/i.test(p) || /\.(png|jpe?g|bmp|gif|webp)$/i.test(p)
}

/** 产出总大小。批量跑完几十个文件时，"这一批一共多大"是用户下一个动作（发邮件/拷贝）的判断依据 */
const totalBytes = ref(0)
watch(
  () => props.outputs,
  async outs => {
    if (!outs.length) {
      totalBytes.value = 0
      return
    }
    const r = await api.fileSizes(outs)
    if (r.ok) totalBytes.value = r.data.reduce((n, f) => n + f.sizeBytes, 0)
  },
  { immediate: true, deep: true }
)

const totalText = computed(() => {
  const b = totalBytes.value
  if (!b) return ''
  if (b < 1024) return `${b} B`
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`
  return `${(b / 1024 / 1024).toFixed(2)} MB`
})

/** 把全部产出路径复制到剪贴板（发给同事、填到系统里都用得上） */
async function copyPaths() {
  try {
    await navigator.clipboard.writeText(props.outputs.join('\n'))
    ElMessage.success(`已复制 ${props.outputs.length} 个文件路径`)
  } catch {
    ElMessage.error('复制失败：请手动选择路径复制')
  }
}

/* ---------- 应用内预览 ---------- */

const previewOpen = ref(false)
const previewPath = ref('')

function openPreview(p: string): void {
  previewPath.value = p
  previewOpen.value = true
}

/** 产出多于 8 个时列表默认收起，完成面板不再把主内容顶下去半屏 */
const listExpanded = ref(false)
</script>

<template>
  <div v-if="outputs.length" class="rp-done">
    <div class="rp-head">
      <span class="rp-dot" aria-hidden="true">✓</span>
      <span class="rp-title">处理完成</span>
      <span class="rp-stat">共 {{ outputs.length }} 个文件<template v-if="totalText"> · 合计 {{ totalText }}</template></span>
      <span class="rp-actions">
        <el-button size="small" type="primary" plain :icon="FolderOpened" @click="openDir">打开文件夹</el-button>
        <el-button size="small" :icon="DocumentCopy" @click="copyPaths">复制路径</el-button>
        <el-button
          v-if="outputs.length > 8"
          size="small"
          link
          type="primary"
          @click="listExpanded = !listExpanded"
        >
          {{ listExpanded ? '收起列表' : `展开全部 ${outputs.length} 个` }}
        </el-button>
      </span>
    </div>
    <ul v-show="listExpanded || outputs.length <= 8" class="file-list result-list">
      <li v-for="p in outputs.slice(0, 50)" :key="p">
        <button class="file-name file-name--link" :title="`点击打开：${p}`" @click="openFile(p)">
          {{ basename(p) }}
        </button>
        <el-button
          v-if="previewable(p)"
          class="rp-preview-btn"
          size="small"
          link
          type="primary"
          title="在本窗口预览"
          @click="openPreview(p)"
        >
          预览
        </el-button>
      </li>
    </ul>
    <div v-if="(listExpanded || outputs.length <= 8) && outputs.length > 50" class="more-hint">
      …以及另外 {{ outputs.length - 50 }} 个文件
    </div>
    <FilePreview v-model:open="previewOpen" :path="previewPath" />
  </div>
</template>

<style scoped>
/* 紧凑结果栏：一行放得下状态与动作；原先的 el-result 大图标版要吃掉约 100px 高度，
   批量工具页跑完后主内容被顶下去半屏 */
.rp-done {
  margin-top: 12px;
  padding: 10px 14px;
  background: var(--surface-2);
  border: 1px solid var(--line);
  border-left: 3px solid var(--el-color-success, #67c23a);
  border-radius: var(--r-md);
}
.rp-head {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}
.rp-dot {
  flex-shrink: 0;
  width: 20px;
  height: 20px;
  border-radius: 50%;
  background: var(--el-color-success, #67c23a);
  color: #fff;
  font-size: 12px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}
.rp-title {
  font-weight: 600;
  color: var(--text-1);
  font-size: 13.5px;
}
.rp-stat {
  font-size: 12.5px;
  color: var(--text-2);
  flex: 1;
}
.rp-actions {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}
.rp-actions :deep(.el-button + .el-button) {
  margin-left: 0;
}
/* 行内预览按钮：仅 PDF / 图片产出出现 */
.rp-preview-btn {
  margin-left: 8px;
}
.file-name--link {
  background: none;
  border: 0;
  padding: 0;
  font: inherit;
  color: inherit;
  text-align: left;
  cursor: pointer;
}
.file-name--link:hover {
  color: var(--accent);
  text-decoration: underline;
}
</style>
