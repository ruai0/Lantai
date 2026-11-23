import fs from 'node:fs'
import type {
  DuplicateExportParams,
  DuplicateFindParams,
  DuplicateResolveParams,
  InventoryParams,
  ZipUnpackParams
} from '@shared/types'
import { handle } from './wrapper'
import { beginTask, runTracked } from '../services/taskProgress'
import { exportDuplicateReport, exportInventory, findDuplicates, resolveDuplicates } from '../services/inventoryService'
import { listZipContents, packZip, unpackZip } from '../services/zipService'

handle('file:inventory', (p: InventoryParams) =>
  runTracked('生成文件清单', 0, ctx =>
    exportInventory(p, { onProgress: (done, total) => ctx.progress(done, total), isCancelled: ctx.isCancelled })
  )
)
handle('file:find-duplicates', (p: DuplicateFindParams) => {
  // 两段式（遍历目录 → 逐个算 MD5）：共用一个任务句柄，标签随阶段切换
  const task = beginTask('查找重复文件', 0)
  return findDuplicates(p, {
    onProgress: (done, total) => {
      task.updateLabel(total === undefined ? `扫描文件（已发现 ${done} 个）` : `比对文件内容（${done}/${total}）`)
      task.progress(done, total)
    },
    isCancelled: () => task.isCancelled()
  })
    .then(r => {
      task.finish()
      return r
    })
    .catch(e => {
      task.finish(e instanceof Error && e.name === 'TaskCancelled' ? 'cancelled' : 'error')
      throw e
    })
})
handle('file:export-duplicates', (p: DuplicateExportParams) => exportDuplicateReport(p))
handle('file:resolve-duplicates', (p: DuplicateResolveParams) => resolveDuplicates(p))
handle('zip:pack', p => runTracked('ZIP 打包', 0, ctx => packZip(p, ctx.progress, ctx.isCancelled)))
handle('zip:unpack', (p: ZipUnpackParams) => unpackZip(p))
handle('zip:list', (p: { dir?: string; paths?: string[] }) => listZipContents(p))
handle('file:sizes', (paths: string[]) =>
  paths.map(p => ({ path: p, sizeBytes: fs.statSync(p).size }))
)
