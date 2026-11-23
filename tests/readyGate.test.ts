/**
 * 表单就绪校验：按钮该不该置灰、提示什么。
 * 这块一旦判错，用户会卡在"按钮永远是灰的"状态里出不来，所以边界要测清。
 */
import { describe, expect, it } from 'vitest'
import { ref } from 'vue'
import { useReadyGate } from '../src/renderer/src/utils/useReadyGate'

describe('useReadyGate', () => {
  it('全部满足时不拦截，原因为空', () => {
    const { blocked, reason, missing } = useReadyGate(() => [
      { label: '文件', ok: true },
      { label: '目录', ok: true }
    ])
    expect(blocked.value).toBe(false)
    expect(reason.value).toBe('')
    expect(missing.value).toEqual([])
  })

  it('缺一项就拦截，并说清缺什么', () => {
    const { blocked, reason, missing } = useReadyGate(() => [
      { label: 'PDF 文件', ok: false },
      { label: '输出文件夹', ok: true }
    ])
    expect(blocked.value).toBe(true)
    expect(reason.value).toBe('还需：PDF 文件')
    expect(missing.value).toEqual(['PDF 文件'])
  })

  it('缺多项时全部列出（用顿号连接）', () => {
    const { reason } = useReadyGate(() => [
      { label: '主表', ok: false },
      { label: '副表', ok: false },
      { label: '关联列', ok: true }
    ])
    expect(reason.value).toBe('还需：主表、副表')
  })

  it('没有校验项时不拦截（空数组 = 无事可拦）', () => {
    const { blocked, reason } = useReadyGate(() => [])
    expect(blocked.value).toBe(false)
    expect(reason.value).toBe('')
  })

  it('随响应式数据实时变化（选完文件后立即解禁）', () => {
    const files = ref<string[]>([])
    const { blocked, reason } = useReadyGate(() => [
      { label: 'PDF 文件', ok: files.value.length > 0 }
    ])
    expect(blocked.value).toBe(true)
    files.value = ['C:\\a.pdf']
    expect(blocked.value).toBe(false)
    expect(reason.value).toBe('')
    files.value = []
    expect(blocked.value).toBe(true)
  })

  it('只认 ok 字段的真值，不做隐式转换误判', () => {
    const { blocked } = useReadyGate(() => [{ label: 'x', ok: false }])
    expect(blocked.value).toBe(true)
  })
})
