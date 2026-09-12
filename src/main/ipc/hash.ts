import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import type { HashParams, HashResult } from '@shared/types'
import { handle } from './wrapper'

handle('file:hash', async (p: HashParams): Promise<HashResult[]> => {
  const out: HashResult[] = []
  for (const filePath of p.paths) {
    const buf = await fs.promises.readFile(filePath)
    const hash = createHash(p.algorithm).update(buf).digest('hex')
    out.push({ path: filePath, name: path.basename(filePath), hash })
  }
  return out
})
