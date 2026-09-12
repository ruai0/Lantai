import { app } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import type { UndoKind, UndoResult, UndoState } from '@shared/types'

/**
 * 破坏性原地操作（重命名/归类）的撤销日志。
 * 每类操作只保留最近一次 journal（userData/journal/<kind>.json），
 * apply 时写入（异常中止也写，恢复半截现场），撤销成功后删除。
 */

export type { UndoKind, UndoResult, UndoState }

export interface UndoOp {
  /** 执行前绝对路径 */
  from: string
  /** 执行后绝对路径 */
  to: string
}

interface JournalFile {
  kind: UndoKind
  dir: string
  time: number
  ops: UndoOp[]
}

function fileFor(kind: UndoKind): string {
  return path.join(app.getPath('userData'), 'journal', `${kind}.json`)
}

function read(kind: UndoKind): JournalFile | null {
  try {
    const j = JSON.parse(fs.readFileSync(fileFor(kind), 'utf8')) as JournalFile
    return Array.isArray(j.ops) && j.ops.length ? j : null
  } catch {
    return null
  }
}

export function writeJournal(kind: UndoKind, dir: string, ops: UndoOp[]): void {
  if (!ops.length) return
  const f = fileFor(kind)
  fs.mkdirSync(path.dirname(f), { recursive: true })
  fs.writeFileSync(f, JSON.stringify({ kind, dir, time: Date.now(), ops }, null, 2))
}

export function undoState(): Record<UndoKind, UndoState | null> {
  const one = (kind: UndoKind): UndoState | null => {
    const j = read(kind)
    return j ? { dir: j.dir, time: j.time, count: j.ops.length } : null
  }
  return { rename: one('rename'), organize: one('organize') }
}

/** 撤销最近一次操作：按逆序把 to 移回 from；文件被后续操作挪走算 skipped，原位置被占算 failed */
export function undoLast(kind: UndoKind): UndoResult {
  const j = read(kind)
  if (!j) throw new Error('没有可撤销的操作')
  let undone = 0
  let skipped = 0
  const failed: UndoResult['failed'] = []
  for (const op of [...j.ops].reverse()) {
    if (!fs.existsSync(op.to)) {
      skipped++
      continue
    }
    if (fs.existsSync(op.from)) {
      failed.push({ path: op.to, reason: '原位置已被其它文件占用' })
      continue
    }
    try {
      fs.mkdirSync(path.dirname(op.from), { recursive: true })
      fs.renameSync(op.to, op.from)
      undone++
    } catch (e) {
      failed.push({ path: op.to, reason: e instanceof Error ? e.message : String(e) })
    }
  }
  fs.rmSync(fileFor(kind), { force: true })
  return { undone, skipped, failed }
}
