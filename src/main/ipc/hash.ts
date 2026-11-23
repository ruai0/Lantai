import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import type { HashParams, HashResult } from '@shared/types'
import { handle } from './wrapper'
import { TaskCancelledError, runTracked } from '../services/taskProgress'

/** 逐个文件计算哈希（可中断；任务坞显示"第 n/共 m 个"） */
handle('file:hash', (p: HashParams) =>
  runTracked('计算文件哈希', p.paths.length, async ctx => {
    const out: HashResult[] = []
    for (let i = 0; i < p.paths.length; i++) {
      if (ctx.isCancelled()) throw new TaskCancelledError()
      const filePath = p.paths[i]
      const buf = await fs.promises.readFile(filePath)
      const hash = createHash(p.algorithm).update(buf).digest('hex')
      out.push({ path: filePath, name: path.basename(filePath), hash })
      ctx.progress(i + 1)
    }
    return out
  })
)
