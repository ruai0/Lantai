import { ipcMain } from 'electron'
import type { ApiResult } from '@shared/types'
import { logMain } from '../services/log'
import { toFriendlyMessage } from '../services/friendlyError'

/**
 * 统一 IPC 包装：把业务异常转换成 { ok:false, error }，避免渲染层拿到裸 reject；同时落盘日志便于排障。
 * 抛给界面的文案经 toFriendlyMessage 翻译——原始 errno 英文对使用者没有意义，
 * 日志里仍保留完整 stack，排障不受影响。
 */
export function handle<T>(channel: string, fn: (args: any) => Promise<T> | T): void {
  ipcMain.handle(channel, async (_event, args: any): Promise<ApiResult<T>> => {
    try {
      return { ok: true, data: await fn(args) }
    } catch (err) {
      logMain('error', `${channel}: ${err instanceof Error ? err.stack ?? err.message : String(err)}`)
      return { ok: false, error: toFriendlyMessage(err) }
    }
  })
}
