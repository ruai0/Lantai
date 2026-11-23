<script setup lang="ts">
import { api } from '../utils/ipc'
import { computed, ref } from 'vue'
import { ElMessage } from 'element-plus'
import StepCard from '../components/StepCard.vue'
import FilePickList from '../components/FilePickList.vue'
import OutDirPicker from '../components/OutDirPicker.vue'
import ResultPanel from '../components/ResultPanel.vue'
import { callQ } from '../utils/api'
import { useEnterSubmit } from '../utils/useEnterSubmit'
import { useReadyGate } from '../utils/useReadyGate'
import { useRemembered } from '../utils/useRememberedParams'
import { BODY_FONTS, HEAD_FONTS, PRESETS, PRESET_GONGWEN, type FmtPreset } from '@shared/wordFormat'
import type { WordFormatReport, WordScanItem } from '@shared/wordFormat'

/** 填完参数按 Enter 直接执行（主按钮已标 data-primary-action） */
useEnterSubmit()

/** 没选文档就把按钮置灰：Word 排版离不开源文件 */
const { blocked: runBlocked, reason: runBlockedReason } = useReadyGate(() => [
  { label: 'Word 文档', ok: files.value.length > 0 }
])

const DOC_FILTER = [{ name: 'Word 文档', extensions: ['docx'] }]

const files = ref<string[]>([])
const presetId = ref(PRESET_GONGWEN.id)
const outDir = ref('')
const running = ref(false)
const result = ref<WordFormatReport | null>(null)
const scanning = ref(false)
const scan = ref<WordScanItem[] | null>(null)

/** 自定义参数：以预设为底，改哪项存哪项，切预设时整块重置 */
const custom = ref({
  bodyFont: PRESET_GONGWEN.body.font,
  bodySize: PRESET_GONGWEN.body.size,
  bodyLine: PRESET_GONGWEN.body.linePt ?? 28,
  bodyIndent: PRESET_GONGWEN.body.firstLineChars ?? 2,
  h1Font: PRESET_GONGWEN.h1.font,
  h2Font: PRESET_GONGWEN.h2.font,
  h3Font: PRESET_GONGWEN.h3.font,
  mTop: PRESET_GONGWEN.page.top,
  mBottom: PRESET_GONGWEN.page.bottom,
  mLeft: PRESET_GONGWEN.page.left,
  mRight: PRESET_GONGWEN.page.right
})

const preset = computed<FmtPreset>(() => {
  const base = PRESETS.find(p => p.id === presetId.value) ?? PRESET_GONGWEN
  return {
    ...base,
    page: {
      top: custom.value.mTop,
      bottom: custom.value.mBottom,
      left: custom.value.mLeft,
      right: custom.value.mRight
    },
    body: { ...base.body, font: custom.value.bodyFont, size: custom.value.bodySize, linePt: custom.value.bodyLine, lineMultiple: undefined, firstLineChars: custom.value.bodyIndent },
    h1: { ...base.h1, font: custom.value.h1Font },
    h2: { ...base.h2, font: custom.value.h2Font },
    h3: { ...base.h3, font: custom.value.h3Font }
  }
})

/** 切预设时把自定义面板同步成该预设的值，避免"看着是公文、存的是上一套" */
function onPresetChange(id: string): void {
  presetId.value = id
  const p = PRESETS.find(x => x.id === id)
  if (!p) return
  custom.value = {
    bodyFont: p.body.font,
    bodySize: p.body.size,
    bodyLine: p.body.linePt ?? 28,
    bodyIndent: p.body.firstLineChars ?? 2,
    h1Font: p.h1.font,
    h2Font: p.h2.font,
    h3Font: p.h3.font,
    mTop: p.page.top,
    mBottom: p.page.bottom,
    mLeft: p.page.left,
    mRight: p.page.right
  }
}

useRemembered('wordfmt', 'presetId', presetId)
useRemembered('wordfmt', 'custom', custom)

/** 处理前扫一遍：把认定的标题列出来供抽查，宁可漏认也别错杀 */
async function scanHeadings(): Promise<void> {
  if (!files.value.length) {
    ElMessage.warning('请先选择 Word 文档')
    return
  }
  scanning.value = true
  try {
    const r = await api.scanWordFormat({ paths: files.value })
    scan.value = r.ok ? r.data : null
    if (!r.ok) ElMessage.error(r.error)
  } finally {
    scanning.value = false
  }
}

const totalHeadings = computed(() => {
  const c = [0, 0, 0, 0]
  for (const s of scan.value ?? []) for (let i = 0; i < 4; i++) c[i] += s.counts[i] ?? 0
  return c
})

async function run(): Promise<void> {
  result.value = null
  if (!files.value.length) {
    ElMessage.warning('请先选择 Word 文档')
    return
  }
  const dir = outDir.value
  if (!dir) {
    ElMessage.warning('请先选择输出文件夹')
    return
  }
  running.value = true
  try {
    const r = await callQ<WordFormatReport>('Word 排版', () =>
      api.formatWord({ paths: files.value, outDir: dir, preset: preset.value })
    , '排版完成')
    if (r) result.value = r
  } finally {
    running.value = false
  }
}
</script>

<template>
  <div>
    <h1 class="page-title">Word 排版</h1>
    <p class="page-desc">
      把文档一次性排成正文字体字号行距缩进、三级标题字体、页边距。内置党政机关公文（GB/T 9704）等预设，也可逐项微调。
      标题按「一、」「（一）」「1.」编号自动认定，只对确定是标题的段落动手——宁可漏认，也不错杀正文。
      输出为新文件，原文件不动。
    </p>

    <StepCard :step="1" title="选择文档">
      <FilePickList
        v-model="files"
        :filters="DOC_FILTER"
        button-text="选择 Word 文档"
        title="选择要排版的 .docx（可多选，各文件独立套用）"
      />
      <el-button size="small" class="mt-8" :loading="scanning" @click="scanHeadings">
        先看看会认定出哪些标题
      </el-button>
      <div v-if="scan" class="page-desc mt-8">
        共 {{ scan.length }} 个文件：正文 {{ totalHeadings[0] }} 段、一级标题 {{ totalHeadings[1] }} 个、
        二级 {{ totalHeadings[2] }} 个、三级 {{ totalHeadings[3] }} 个。
      </div>
      <el-collapse v-if="scan" class="mt-8">
        <el-collapse-item
          v-for="s in scan"
          :key="s.path"
          :title="`${s.path.split(/[\\/]/).pop()}（L1 ${s.counts[1]} · L2 ${s.counts[2]} · L3 ${s.counts[3]}）`"
        >
          <div v-if="s.error" class="page-desc">读取失败：{{ s.error }}</div>
          <div v-else-if="!s.headings.length" class="page-desc">没认出标题，将只统一正文与页边距。</div>
          <ol v-else class="wf-headings">
            <li v-for="(h, i) in s.headings" :key="i">{{ h }}</li>
          </ol>
        </el-collapse-item>
      </el-collapse>
    </StepCard>

    <StepCard :step="2" title="排版预设">
      <div class="form-row" style="flex-wrap: wrap; gap: 12px">
        <el-radio-group v-model="presetId" @change="onPresetChange">
          <el-radio-button v-for="p in PRESETS" :key="p.id" :value="p.id">{{ p.name }}</el-radio-button>
        </el-radio-group>
      </div>
      <div class="page-desc mt-8">
        {{ (PRESETS.find(p => p.id === presetId) ?? PRESET_GONGWEN).desc }}
      </div>

      <el-collapse class="mt-10">
        <el-collapse-item title="自定义微调（改哪项存哪项）">
          <div class="form-row" style="flex-wrap: wrap">
            <div class="form-item">
              <label>正文字体</label>
              <el-select v-model="custom.bodyFont" style="width: 150px" filterable allow-create>
                <el-option v-for="f in BODY_FONTS" :key="f" :label="f" :value="f" />
              </el-select>
            </div>
            <div class="form-item">
              <label>正文字号（磅）</label>
              <el-input-number v-model="custom.bodySize" :min="6" :max="36" :step="0.5" size="small" />
            </div>
            <div class="form-item">
              <label>行距（磅）</label>
              <el-input-number v-model="custom.bodyLine" :min="12" :max="60" :step="1" size="small" />
            </div>
            <div class="form-item">
              <label>首行缩进（字符）</label>
              <el-input-number v-model="custom.bodyIndent" :min="0" :max="4" :step="1" size="small" />
            </div>
          </div>
          <div class="form-row" style="flex-wrap: wrap">
            <div class="form-item">
              <label>一级标题字体</label>
              <el-select v-model="custom.h1Font" style="width: 150px" filterable allow-create>
                <el-option v-for="f in HEAD_FONTS" :key="f" :label="f" :value="f" />
              </el-select>
            </div>
            <div class="form-item">
              <label>二级标题字体</label>
              <el-select v-model="custom.h2Font" style="width: 150px" filterable allow-create>
                <el-option v-for="f in HEAD_FONTS" :key="f" :label="f" :value="f" />
              </el-select>
            </div>
            <div class="form-item">
              <label>三级标题字体</label>
              <el-select v-model="custom.h3Font" style="width: 150px" filterable allow-create>
                <el-option v-for="f in HEAD_FONTS" :key="f" :label="f" :value="f" />
              </el-select>
            </div>
          </div>
          <div class="form-row" style="flex-wrap: wrap">
            <div class="form-item">
              <label>上边距（cm）</label>
              <el-input-number v-model="custom.mTop" :min="0" :max="6" :step="0.1" size="small" />
            </div>
            <div class="form-item">
              <label>下边距（cm）</label>
              <el-input-number v-model="custom.mBottom" :min="0" :max="6" :step="0.1" size="small" />
            </div>
            <div class="form-item">
              <label>左边距（cm）</label>
              <el-input-number v-model="custom.mLeft" :min="0" :max="6" :step="0.1" size="small" />
            </div>
            <div class="form-item">
              <label>右边距（cm）</label>
              <el-input-number v-model="custom.mRight" :min="0" :max="6" :step="0.1" size="small" />
            </div>
          </div>
          <div class="page-desc mt-8">
            页边距按国标口径预填（上 3.7 / 下 3.5 / 左 2.8 / 右 2.6）。字号、行距改动即时生效于本次排版。
          </div>
        </el-collapse-item>
      </el-collapse>
    </StepCard>

    <!-- 输出位置与执行合并：执行区只有一个按钮，单独占卡会白吃一块高度 -->
    <StepCard :step="3" title="输出位置与执行">
      <OutDirPicker v-model="outDir" />
      <div class="run-row">
        <el-button
          type="primary"
          :loading="running"
          :disabled="runBlocked"
          :title="runBlockedReason"
          :data-blocked-reason="runBlockedReason"
          data-primary-action
          @click="run"
        >
          开始排版
        </el-button>
      </div>
      <ResultPanel v-if="result" :outputs="result.outputs" />
      <el-table v-if="result" :data="result.files" size="small" max-height="300" class="mt-12">
        <el-table-column label="文件" min-width="180" show-overflow-tooltip>
          <template #default="{ row }">{{ row.path.split(/[\\/]/).pop() }}</template>
        </el-table-column>
        <el-table-column label="结果" width="80">
          <template #default="{ row }">
            <el-tag :type="row.ok ? 'success' : 'danger'" size="small">{{ row.ok ? '完成' : '失败' }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="正文" width="70">
          <template #default="{ row }">{{ row.counts[0] }} 段</template>
        </el-table-column>
        <el-table-column label="标题 L1/L2/L3" width="130">
          <template #default="{ row }">{{ row.counts[1] }} / {{ row.counts[2] }} / {{ row.counts[3] }}</template>
        </el-table-column>
        <el-table-column label="页边距" width="90">
          <template #default="{ row }">
            <span v-if="row.ok">{{ row.marginChanged ? '已改' : '未变' }}</span>
            <span v-else>—</span>
          </template>
        </el-table-column>
        <el-table-column label="说明" min-width="160" show-overflow-tooltip>
          <template #default="{ row }">{{ row.error ?? '' }}</template>
        </el-table-column>
      </el-table>
    </StepCard>
  </div>
</template>

<style scoped>
.wf-headings {
  margin: 0;
  padding-left: 20px;
  max-height: 220px;
  overflow: auto;
  font-size: 12.5px;
  line-height: 1.8;
  color: var(--text-2);
}
</style>
