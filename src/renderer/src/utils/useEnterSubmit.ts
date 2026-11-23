import { onMounted, onUnmounted } from 'vue'
import { ElMessage } from 'element-plus'

/**
 * 全局 Enter 提交：在页面上按 Enter 时，触发当前视图的主操作（提交按钮）。
 *
 * 为什么用全局监听而不是逐页 @keyup.enter：
 * - 各工具页布局差异大（按钮分布在 StepCard 内），逐个绑定易漏且维护成本高；
 * - 用户预期是"填完参数敲回车就跑"，与焦点在哪个控件无关（只要不在多行文本里）。
 *
 * 触发规则：
 * 1. **中文输入法选词时的回车不算提交**（isComposing / keyCode 229）——
 *    否则打拼音按回车挑候选字，工具就直接开始跑了，这是中文用户必踩的坑。
 * 2. 焦点在 <textarea> 内时忽略（换行语义）；标记了 `data-enter-submit="off"` 的输入框也忽略。
 * 3. 只触发带 `data-primary-action` 标记的按钮（由各页显式标注主"执行"按钮），不做模糊回退，
 *    避免误触"选择文件夹"等其它主色按钮。
 * 4. 有弹窗（.el-overlay / .el-dialog）打开时不触发，防止"确认对话框里回车跑工具"。
 * 5. 按钮禁用或 loading 时不触发；但**禁用时会把缺什么提示出来**——
 *    否则用户按回车毫无反应，只会以为程序卡了。
 *
 * 用法：在某个视图组件 setup 中调用 `useEnterSubmit()`，并给主提交按钮加 `data-primary-action`。
 * （仅需在含"开始执行"操作的视图调用，工具型纯查询页可不接）
 */
export function useEnterSubmit(): void {
  function handler(e: KeyboardEvent): void {
    if (e.key !== 'Enter' && e.keyCode !== 13) return
    // 输入法组合中（正在打拼音/五笔、挑候选字）：回车属于输入法，不是提交
    if (e.isComposing || e.keyCode === 229) return
    const target = e.target as HTMLElement | null
    if (!target) return
    const tag = target.tagName
    // 多行文本：换行优先
    if (tag === 'TEXTAREA') return
    if (target.dataset.enterSubmit === 'off') return
    // 弹窗打开时不触发
    if (document.querySelector('.el-overlay:not([style*="display: none"])')) return

    const btn = document.querySelector<HTMLButtonElement>('.app-main [data-primary-action]')
    if (!btn) return
    if (btn.offsetParent === null) return
    if (btn.disabled || btn.classList.contains('is-loading')) {
      // 按了回车却什么都不发生，会让人以为卡死；把"缺什么"说出来
      const why = btn.dataset.blockedReason
      if (why && !btn.classList.contains('is-loading')) ElMessage.warning(why)
      return
    }
    e.preventDefault()
    btn.click()
  }

  onMounted(() => window.addEventListener('keydown', handler))
  onUnmounted(() => window.removeEventListener('keydown', handler))
}
