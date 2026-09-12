<script setup lang="ts">
import { api } from '../utils/ipc'
import { computed, reactive, ref } from 'vue'
import { ElMessage } from 'element-plus'
import StepCard from '../components/StepCard.vue'
import OutDirPicker from '../components/OutDirPicker.vue'
import { call } from '../utils/api'
import type { OrganizeMode, OrganizePair, RenamePair } from '@shared/types'

const mode = ref<'rename' | 'organize'>('rename')

/* ---------- 批量重命名 ---------- */

const dir = ref('')
const exts = ref('')
const rules = reactive({
  find: '',
  replace: '',
  prefix: '',
  suffix: '',
  extLower: false,
  useSeq: false,
  seqStart: 1,
  seqStep: 1,
  seqDigits: 3
})

const plan = ref<RenamePair[]>([])
const making = ref(false)
const applying = ref(false)

const planRows = computed(() => plan.value.slice(0, 100))
const conflictCount = computed(() => plan.value.filter(p => p.conflict).length)
const todoCount = computed(() => plan.value.filter(p => !p.conflict && !p.unchanged).length)

function currentRules() {
  return {
    find: rules.find || undefined,
    replace: rules.find ? rules.replace : undefined,
    prefix: rules.prefix || undefined,
    suffix: rules.suffix || undefined,
    extLower: rules.extLower,
    sequence: rules.useSeq
      ? { start: rules.seqStart, step: rules.seqStep, digits: rules.seqDigits }
      : null
  }
}

async function makePlan() {
  if (!dir.value) {
    ElMessage.warning('请先选择文件夹')
    return
  }
  making.value = true
  try {
    const extList = exts.value
      .split(/[,，\s]+/)
      .map(s => s.trim().replace(/^\./, ''))
      .filter(Boolean)
    const r = await call(
      api.renamePlan({ dir: dir.value, exts: extList, rules: currentRules() })
    )
    if (r) plan.value = r.plan
  } finally {
    making.value = false
  }
}

async function apply() {
  if (conflictCount.value) {
    ElMessage.error('存在冲突项，请调整规则后重新生成预览')
    return
  }
  const todo = plan.value.filter(p => !p.unchanged)
  if (!todo.length) {
    ElMessage.warning('没有需要重命名的文件')
    return
  }
  applying.value = true
  try {
    await call(
      api.renameApply({ dir: dir.value, pairs: todo.map(p => ({ from: p.from, to: p.to })) }),
      `完成 ${todo.length} 个重命名`
    )
    plan.value = []
  } finally {
    applying.value = false
  }
}

function tagOf(p: RenamePair) {
  if (p.conflict) return { type: 'danger' as const, text: '冲突' }
  if (p.unchanged) return { type: 'info' as const, text: '不变' }
  return { type: 'success' as const, text: '就绪' }
}

/* ---------- 归类整理 ---------- */

const oDir = ref('')
const oMode = ref<OrganizeMode>('ext')
const oPlan = ref<OrganizePair[]>([])
const oMaking = ref(false)
const oApplying = ref(false)

const oPlanRows = computed(() => oPlan.value.slice(0, 100))
const oConflictCount = computed(() => oPlan.value.filter(p => p.conflict).length)
const oTodoCount = computed(() => oPlan.value.filter(p => !p.conflict && p.from !== p.to).length)

const oModeLabels: Record<OrganizeMode, string> = {
  ext: '按扩展名（jpg/、png/…）',
  month: '按修改年月（2026-09/…）',
  year: '按年份（2026/…）'
}

async function makeOrganizePlan() {
  if (!oDir.value) {
    ElMessage.warning('请先选择文件夹')
    return
  }
  oMaking.value = true
  try {
    const r = await call(api.organizePlan({ dir: oDir.value, mode: oMode.value }))
    if (r) oPlan.value = r.plan
  } finally {
    oMaking.value = false
  }
}

async function applyOrganize() {
  const todo = oPlan.value.filter(p => !p.conflict)
  if (!todo.length) {
    ElMessage.warning('没有需要移动的文件')
    return
  }
  oApplying.value = true
  try {
    await call(
      api.organizeApply({ dir: oDir.value, pairs: todo.map(p => ({ from: p.from, to: p.to })) }),
      `已归类 ${todo.length} 个文件`
    )
    oPlan.value = []
  } finally {
    oApplying.value = false
  }
}
</script>

<template>
  <div>
    <h1 class="page-title">批量重命名 / 归类整理</h1>
    <p class="page-desc">先预览再执行；冲突会标红并阻止执行。</p>

    <el-tabs v-model="mode" class="rename-tabs">
      <el-tab-pane label="批量重命名" name="rename" />
      <el-tab-pane label="归类整理" name="organize" />
    </el-tabs>

    <!-- 批量重命名 -->
    <template v-if="mode === 'rename'">
      <StepCard :step="1" title="选择文件夹">
        <OutDirPicker v-model="dir" title="选择要重命名的文件夹" />
        <div class="form-row" style="margin-top: 10px">
          <div class="form-item">
            <label>只处理这些扩展名</label>
            <el-input v-model="exts" placeholder="如 jpg,png（留空 = 全部文件）" style="width: 240px" clearable />
          </div>
        </div>
      </StepCard>

      <StepCard :step="2" title="命名规则">
        <div class="form-row">
          <div class="form-item">
            <label>查找</label>
            <el-input v-model="rules.find" placeholder="要替换的文字" style="width: 150px" clearable />
          </div>
          <div class="form-item">
            <label>替换为</label>
            <el-input v-model="rules.replace" placeholder="留空 = 删除" style="width: 150px" clearable />
          </div>
          <div class="form-item">
            <label>添加前缀</label>
            <el-input v-model="rules.prefix" style="width: 130px" clearable />
          </div>
          <div class="form-item">
            <label>添加后缀</label>
            <el-input v-model="rules.suffix" placeholder="加在扩展名前" style="width: 130px" clearable />
          </div>
        </div>
        <div class="form-row" style="margin-top: 10px">
          <div class="form-item">
            <el-checkbox v-model="rules.useSeq">加序号</el-checkbox>
          </div>
          <template v-if="rules.useSeq">
            <div class="form-item">
              <label>起始</label>
              <el-input-number v-model="rules.seqStart" :min="0" :max="999999" size="small" />
            </div>
            <div class="form-item">
              <label>步长</label>
              <el-input-number v-model="rules.seqStep" :min="1" :max="100" size="small" />
            </div>
            <div class="form-item">
              <label>位数</label>
              <el-input-number v-model="rules.seqDigits" :min="1" :max="8" size="small" />
            </div>
          </template>
          <div class="form-item">
            <el-checkbox v-model="rules.extLower">扩展名转小写</el-checkbox>
          </div>
        </div>
      </StepCard>

      <StepCard :step="3" title="预览">
        <el-button type="primary" plain :loading="making" @click="makePlan">生成预览</el-button>
        <span v-if="plan.length" class="pick-count">
          共 {{ plan.length }} 项：{{ todoCount }} 项将重命名
          <template v-if="conflictCount">，<b style="color: #f56c6c">{{ conflictCount }} 项冲突</b></template>
        </span>
        <el-table v-if="plan.length" :data="planRows" height="280" style="margin-top: 8px" size="small">
          <el-table-column type="index" label="#" width="44" />
          <el-table-column label="原文件名" prop="from" show-overflow-tooltip />
          <el-table-column label="新文件名" prop="to" show-overflow-tooltip />
          <el-table-column label="状态" width="70">
            <template #default="{ row }">
              <el-tag :type="tagOf(row).type" size="small">{{ tagOf(row).text }}</el-tag>
            </template>
          </el-table-column>
          <el-table-column label="原因" prop="reason" show-overflow-tooltip width="190" />
        </el-table>
        <div v-if="plan.length > 100" class="more-hint" style="margin-top: 6px">
          仅显示前 100 行，执行时按全部 {{ plan.length }} 项处理
        </div>
      </StepCard>

      <StepCard :step="4" title="执行">
        <el-button
          type="primary"
          :loading="applying"
          :disabled="!plan.length || conflictCount > 0"
          @click="apply"
        >
          执行重命名（{{ todoCount }} 项）
        </el-button>
      </StepCard>
    </template>

    <!-- 归类整理 -->
    <template v-else>
      <StepCard :step="1" title="选择文件夹">
        <OutDirPicker v-model="oDir" title="选择要整理的文件夹" />
      </StepCard>

      <StepCard :step="2" title="归类方式">
        <el-radio-group v-model="oMode">
          <el-radio-button value="ext">{{ oModeLabels.ext }}</el-radio-button>
          <el-radio-button value="month">{{ oModeLabels.month }}</el-radio-button>
          <el-radio-button value="year">{{ oModeLabels.year }}</el-radio-button>
        </el-radio-group>
      </StepCard>

      <StepCard :step="3" title="预览">
        <el-button type="primary" plain :loading="oMaking" @click="makeOrganizePlan">生成预览</el-button>
        <span v-if="oPlan.length" class="pick-count">
          共 {{ oPlan.length }} 项，{{ oTodoCount }} 项将移动
          <template v-if="oConflictCount">，<b style="color: #f56c6c">{{ oConflictCount }} 项冲突</b></template>
        </span>
        <el-table v-if="oPlan.length" :data="oPlanRows" height="280" style="margin-top: 8px" size="small">
          <el-table-column type="index" label="#" width="44" />
          <el-table-column label="文件" prop="from" show-overflow-tooltip />
          <el-table-column label="移动到" prop="to" show-overflow-tooltip />
          <el-table-column label="状态" width="70">
            <template #default="{ row }">
              <el-tag :type="row.conflict ? 'danger' : 'success'" size="small">
                {{ row.conflict ? '冲突' : '就绪' }}
              </el-tag>
            </template>
          </el-table-column>
          <el-table-column label="原因" prop="reason" show-overflow-tooltip width="190" />
        </el-table>
      </StepCard>

      <StepCard :step="4" title="执行">
        <el-button
          type="primary"
          :loading="oApplying"
          :disabled="!oPlan.length || oConflictCount > 0"
          @click="applyOrganize"
        >
          执行归类（{{ oTodoCount }} 项）
        </el-button>
      </StepCard>
    </template>
  </div>
</template>

<style scoped>
.rename-tabs {
  margin-bottom: 10px;
}
</style>
