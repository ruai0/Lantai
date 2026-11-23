/**
 * 错误翻译表：每个 errno 都要翻成"发生了什么 + 怎么办"。
 * 这块最容易犯两类错——把中文业务错误又包一层（读起来别扭），
 * 或者把路径整条塞进提示（长路径比错误本身还难读）。
 */
import { describe, expect, it } from 'vitest'
import { toFriendlyMessage } from '../src/main/services/friendlyError'

/** 造一个带 code/path 的 Node 风格错误 */
function nodeErr(code: string, message: string, p?: string): Error {
  const e = new Error(message) as Error & { code: string; path?: string }
  e.code = code
  if (p) e.path = p
  return e
}

describe('toFriendlyMessage', () => {
  it('中文业务错误原样返回，不二次包装', () => {
    const msg = '该文件只有一个工作表，无需拆分'
    expect(toFriendlyMessage(new Error(msg))).toBe(msg)
  })

  it('文件被占用（EBUSY）翻成"关掉 Office"', () => {
    const r = toFriendlyMessage(nodeErr('EBUSY', "EBUSY: resource busy or locked, open 'D:\\报送\\通知.docx'", 'D:\\报送\\通知.docx'))
    expect(r).toContain('通知.docx')
    expect(r).toContain('占用')
    expect(r).toContain('关闭')
    expect(r).not.toContain('EBUSY')
  })

  it('提示里只放文件名，不放整条长路径', () => {
    const long = 'D:\\很深\\很深的\\目录\\再来一层\\报送材料\\通知.docx'
    const r = toFriendlyMessage(nodeErr('EBUSY', 'busy', long))
    expect(r).toContain('通知.docx')
    expect(r).not.toContain('很深')
  })

  it('找不到文件（ENOENT）', () => {
    const r = toFriendlyMessage(nodeErr('ENOENT', "ENOENT: no such file or directory", 'D:\\a.xlsx'))
    expect(r).toContain('找不到')
    expect(r).toContain('a.xlsx')
  })

  it('磁盘满（ENOSPC）', () => {
    expect(toFriendlyMessage(nodeErr('ENOSPC', 'no space left'))).toContain('空间不足')
  })

  it('路径过长（ENAMETOOLONG）给出可操作建议', () => {
    const r = toFriendlyMessage(nodeErr('ENAMETOOLONG', 'name too long'))
    expect(r).toContain('260')
    expect(r).toContain('层级更浅')
  })

  it('权限不足（EACCES / EPERM）', () => {
    expect(toFriendlyMessage(nodeErr('EACCES', 'denied'))).toContain('权限')
    expect(toFriendlyMessage(nodeErr('EPERM', 'not permitted'))).toContain('占用')
  })

  it('未知错误保留原文，但给出查日志的去处', () => {
    const r = toFriendlyMessage(new Error('some weird internal failure'))
    expect(r).toContain('some weird internal failure')
    expect(r).toContain('日志')
  })

  it('非 Error 对象也能处理（不抛）', () => {
    expect(() => toFriendlyMessage('字符串错误')).not.toThrow()
    expect(toFriendlyMessage(null)).toContain('null')
  })

  it('Office COM 失败给出安装建议', () => {
    const r = toFriendlyMessage(new Error('Cannot CreateObject Word.Application'))
    expect(r).toContain('Office')
  })

  it('英文加密提示转中文', () => {
    const r = toFriendlyMessage(new Error('The document is encrypted and requires a password'))
    expect(r).toContain('加密')
  })
})
