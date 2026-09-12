import { app } from 'electron'
import fs from 'node:fs'
import path from 'node:path'

/**
 * 主进程日志：追加写 userData/logs/main-YYYYMMDD.log。
 * 内网分发场景用户无法开 DevTools，出错只能靠这份落盘日志定位。
 */

const MAX_BYTES = 5 * 1024 * 1024 // 超过 5MB 时旧文件改名保留一份

function logDir(): string {
  const dir = path.join(app.getPath('userData'), 'logs')
  fs.mkdirSync(dir, { recursive: true })
  return dir
}

function today(): string {
  const d = new Date()
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}`
}

function file(): string {
  return path.join(logDir(), `main-${today()}.log`)
}

export function logMain(level: 'info' | 'warn' | 'error', msg: string): void {
  try {
    const f = file()
    try {
      const st = fs.statSync(f)
      if (st.size > MAX_BYTES) fs.renameSync(f, f.replace(/\.log$/, '.old.log'))
    } catch {
      /* 文件不存在 */
    }
    fs.appendFileSync(f, `${new Date().toISOString()} [${level}] ${msg}\n`)
  } catch {
    /* 日志本身失败不能再抛异常 */
  }
}

/** 未捕获异常：记录后保活。办公工具箱单次操作出错不应让整个应用退出 */
export function installCrashLogging(): void {
  process.on('uncaughtException', err => {
    logMain('error', `uncaughtException: ${err.stack ?? err.message}`)
  })
  process.on('unhandledRejection', reason => {
    logMain('error', `unhandledRejection: ${reason instanceof Error ? reason.stack : String(reason)}`)
  })
  logMain('info', `FreeTool ${app.getVersion()} 启动（electron ${process.versions.electron}，${process.platform}）`)
}
