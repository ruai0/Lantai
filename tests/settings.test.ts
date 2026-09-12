import { describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS, normalizeSettings } from '../src/shared/settings'

describe('设置归一化 normalizeSettings', () => {
  it('默认配置带 updateFeed 空串（未配置 = 关闭一切更新）', () => {
    expect(DEFAULT_SETTINGS.updateFeed).toBe('')
    expect(normalizeSettings({}).updateFeed).toBe('')
  })

  it('旧版配置文件缺字段时逐项补默认', () => {
    const s = normalizeSettings({ theme: 'dark', favorites: ['/pdf', 1] })
    expect(s.theme).toBe('dark')
    expect(s.favorites).toEqual(['/pdf'])
    expect(s.updateFeed).toBe('')
    expect(s.notify).toBe(true)
  })

  it('updateFeed 仅接受字符串，非法类型回退空串', () => {
    expect(normalizeSettings({ updateFeed: 'https://dl.example.com/freetool' }).updateFeed).toBe(
      'https://dl.example.com/freetool'
    )
    expect(normalizeSettings({ updateFeed: 123 }).updateFeed).toBe('')
    expect(normalizeSettings({ updateFeed: null }).updateFeed).toBe('')
  })

  it('onClose 默认询问；旧版 minimizeToTray 布尔值自动迁移', () => {
    expect(DEFAULT_SETTINGS.onClose).toBe('ask')
    expect(normalizeSettings({}).onClose).toBe('ask')
    expect(normalizeSettings({ minimizeToTray: true }).onClose).toBe('tray')
    expect(normalizeSettings({ minimizeToTray: false }).onClose).toBe('quit')
    expect(normalizeSettings({ onClose: 'quit', minimizeToTray: true }).onClose).toBe('quit')
    expect(normalizeSettings({ onClose: 'bogus' }).onClose).toBe('ask')
  })

  it('onboarded 默认 false，仅显式 true 才跳过首启指引', () => {
    expect(DEFAULT_SETTINGS.onboarded).toBe(false)
    expect(normalizeSettings({ onboarded: true }).onboarded).toBe(true)
    expect(normalizeSettings({ onboarded: 'yes' }).onboarded).toBe(false)
  })
})
