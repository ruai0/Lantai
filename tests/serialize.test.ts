import { describe, expect, it } from 'vitest'
import { reactive, ref } from 'vue'
import { plain } from '../src/shared/serialize'

/**
 * Electron 的 ipcRenderer.invoke 用结构化克隆序列化参数，
 * Vue 的 ref()/reactive() 返回 Proxy，直接传会抛
 * 「An object could not be cloned」——这正是界面点击「没反应」的根因。
 */
describe('IPC 参数净化 plain()', () => {
  it('复现：ref 数组无法被结构化克隆', () => {
    const files = ref(['a.pdf', 'b.pdf'])
    expect(() => structuredClone(files.value)).toThrow()
  })

  it('reactive 对象同样无法克隆', () => {
    const slot = reactive({ files: ['x.xlsx'], key: '工号' })
    expect(() => structuredClone(slot)).toThrow()
  })

  it('经 plain() 后可克隆且内容一致', () => {
    const files = ref(['a.pdf', 'b.pdf'])
    const out = plain(files.value)
    expect(() => structuredClone(out)).not.toThrow()
    expect(out).toEqual(['a.pdf', 'b.pdf'])
  })

  it('嵌套的 ref/reactive 混合参数整体转纯数据', () => {
    const paths = ref(['p1'])
    const kinds = ref(['phone', 'email'])
    const payload = reactive({ paths: paths.value, kinds: kinds.value, dedupe: true, outDir: '/tmp/x' })
    const out = plain(payload)
    expect(() => structuredClone(out)).not.toThrow()
    expect(out).toEqual({ paths: ['p1'], kinds: ['phone', 'email'], dedupe: true, outDir: '/tmp/x' })
    expect(Object.getPrototypeOf(out)).toBe(Object.prototype)
  })

  it('标量与 null 原样返回', () => {
    expect(plain(undefined)).toBe(undefined)
    expect(plain(null)).toBe(null)
    expect(plain('abc')).toBe('abc')
    expect(plain(42)).toBe(42)
    expect(plain(false)).toBe(false)
  })

  it('二进制负载原样保留', () => {
    const bytes = new Uint8Array([1, 2, 3])
    expect(plain(bytes)).toBe(bytes)
    const buf = new ArrayBuffer(4)
    expect(plain(buf)).toBe(buf)
  })

  it('Date 仍是 Date（重命名/归类会传时间）', () => {
    const d = new Date('2026-09-12T00:00:00Z')
    const out = plain({ at: d })
    expect(out.at).toBeInstanceOf(Date)
    expect(out.at.getTime()).toBe(d.getTime())
  })

  it('深层嵌套的 ref 数组里的对象也会被拆成纯数据', () => {
    const pairs = ref([{ from: 'a.txt', to: 'b.txt' }])
    const out = plain({ dir: '/d', pairs: pairs.value })
    expect(() => structuredClone(out)).not.toThrow()
    expect(out.pairs).toEqual([{ from: 'a.txt', to: 'b.txt' }])
  })
})
