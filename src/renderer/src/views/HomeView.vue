<script setup lang="ts">
import { markRaw } from 'vue'
import { useRouter } from 'vue-router'
import {
  Connection,
  CopyDocument,
  Document,
  EditPen,
  Files,
  FolderChecked,
  Grid,
  Picture,
  Promotion,
  Search
} from '@element-plus/icons-vue'

const router = useRouter()

interface Tool {
  path: string
  icon: ReturnType<typeof markRaw>
  name: string
  desc: string
}

const groups: Array<{ title: string; caption: string; tools: Tool[] }> = [
  {
    title: '文档与 PDF',
    caption: '报送、归档、盖章',
    tools: [
      {
        path: '/pdf',
        icon: markRaw(Document),
        name: 'PDF 工具',
        desc: '合并 / 拆分 / 删页 / 旋转 / 页码 / 水印 / 盖章 / 压缩 / 提取文字 / 页面整理'
      },
      {
        path: '/image',
        icon: markRaw(Picture),
        name: '图片工具',
        desc: '批量压缩、格式转换、水印、长图拼接、证件照排版'
      },
      {
        path: '/convert',
        icon: markRaw(Promotion),
        name: 'Office 转 PDF',
        desc: 'Word / Excel / PPT 批量转 PDF，调用本机 Office 或 WPS'
      },
      {
        path: '/office',
        icon: markRaw(Files),
        name: '文档模板填充',
        desc: '模板写 {字段} + 数据表，按行批量生成通知书、证明'
      },
      {
        path: '/replace',
        icon: markRaw(Search),
        name: '批量查找替换',
        desc: '多个 Word / Excel 一次改文字，适合更名、改日期'
      }
    ]
  },
  {
    title: '表格与数据',
    caption: '台账、报表、核对',
    tools: [
      {
        path: '/excel',
        icon: markRaw(Grid),
        name: 'Excel 工具',
        desc: '多簿合并、按表/行/列值拆分、CSV 转换、数据脱敏'
      },
      {
        path: '/match',
        icon: markRaw(Connection),
        name: '表格匹配 / 比对',
        desc: '跨表匹配填充替代 VLOOKUP，两版名单差异一键出报告'
      }
    ]
  },
  {
    title: '文件与效率',
    caption: '整理、清单、小工具',
    tools: [
      {
        path: '/rename',
        icon: markRaw(EditPen),
        name: '重命名 / 归类',
        desc: '批量重命名带冲突预检，按扩展名或日期自动归类'
      },
      {
        path: '/filekit',
        icon: markRaw(FolderChecked),
        name: '文件管理',
        desc: '送审清单导出、重复文件查找、ZIP 打包与批量解压'
      },
      {
        path: '/tools',
        icon: markRaw(CopyDocument),
        name: '常用小工具',
        desc: 'JSON、编解码、哈希、二维码生成与识别、提取联系方式、名单加拼音'
      }
    ]
  }
]

let seq = 0
const total = groups.reduce((n, g) => n + g.tools.length, 0)
const indexed = groups.map(g => ({
  ...g,
  tools: g.tools.map(t => ({ ...t, idx: String(++seq).padStart(2, '0') }))
}))
</script>

<template>
  <div>
    <header class="hero">
      <div class="hero-kicker">Offline Workstation · 本地文件处理</div>
      <h1 class="hero-title">FreeTool</h1>
      <p class="hero-lead">
        {{ total }} 组办公工具，覆盖 PDF、Office 文档、Excel 台账与日常文件整理。全部在本机完成，
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
          <span class="tool-arrow">→</span>
        </el-card>
      </div>
    </section>

    <el-alert
      style="margin-top: 28px"
      type="info"
      :closable="false"
      title="后续规划"
      description="剪贴板历史、取色器、PDF 加密与解密保护。已明确不做：OCR 文字识别、抠图去背景（需引入模型，体积与准确率不划算）。"
    />
  </div>
</template>
