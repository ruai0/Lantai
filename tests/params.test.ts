import { describe, expect, it } from 'vitest'
import {
  mergeViewParams,
  normalizeRememberedParams,
  VALUE_SIZE_LIMIT
} from '../src/shared/params'
import { DEFAULT_SETTINGS, normalizeSettings } from '../src/shared/settings'

describe('参数记忆 normalizeRememberedParams', () => {
  it('非对象/数组/空值一律回退空对象', () => {
    expect(normalizeRememberedParams(null)).toEqual({})
    expect(normalizeRememberedParams(undefined)).toEqual({})
    expect(normalizeRememberedParams('x')).toEqual({})
    expect(normalizeRememberedParams([1, 2])).toEqual({})
  })

  it('保留字符串/数字/布尔/字符串数组，剔除函数等非法值', () => {
    const out = normalizeRememberedParams({
      pdf: { splitMode: 'extract', everyN: 3, wmTile: true, kinds: ['phone', 'email'], bad: () => 1 }
    })
    expect(out.pdf).toEqual({ splitMode: 'extract', everyN: 3, wmTile: true, kinds: ['phone', 'email'] })
  })

  it('数组里混入对象则整体丢弃该键', () => {
    expect(normalizeRememberedParams({ t: { k: ['a', { x: 1 }] } })).toEqual({})
  })

  it('超长字符串（超过上限）被丢弃', () => {
    const long = 'x'.repeat(VALUE_SIZE_LIMIT + 1)
    expect(normalizeRememberedParams({ t: { k: long } })).toEqual({})
  })

  it('剔除空视图名与空键名', () => {
    expect(normalizeRememberedParams({ '': { k: 1 }, t: { '': 1 } })).toEqual({})
  })
})

describe('参数记忆 mergeViewParams', () => {
  it('浅合并到指定视图，不动其它视图', () => {
    const base = { pdf: { a: 1 }, tools: { b: 2 } }
    const next = mergeViewParams(base, 'pdf', { c: 3 })
    expect(next.pdf).toEqual({ a: 1, c: 3 })
    expect(next.tools).toEqual({ b: 2 })
  })

  it('值为 undefined 视为删除该键；视图清空后整组移除', () => {
    expect(mergeViewParams({ pdf: { a: 1, b: 2 } }, 'pdf', { a: undefined }).pdf).toEqual({ b: 2 })
    expect(mergeViewParams({ pdf: { a: 1 } }, 'pdf', { a: undefined })).toEqual({})
  })

  it('空视图名直接返回原对象', () => {
    const base = { pdf: { a: 1 } }
    expect(mergeViewParams(base, '', { x: 1 })).toBe(base)
  })

  it('不修改传入的原始对象（不可变更新）', () => {
    const base = { pdf: { a: 1 } }
    mergeViewParams(base, 'pdf', { a: 9 })
    expect(base.pdf).toEqual({ a: 1 })
  })
})

describe('设置新增 rememberParams 字段', () => {
  it('默认开启；显式 false 才关闭；非法值回退默认开启', () => {
    expect(DEFAULT_SETTINGS.rememberParams).toBe(true)
    expect(normalizeSettings({}).rememberParams).toBe(true)
    expect(normalizeSettings({ rememberParams: false }).rememberParams).toBe(false)
    expect(normalizeSettings({ rememberParams: 'no' }).rememberParams).toBe(true)
  })
})
