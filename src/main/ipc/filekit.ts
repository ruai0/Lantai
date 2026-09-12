import fs from 'node:fs'
import type {
  DuplicateExportParams,
  DuplicateFindParams,
  InventoryParams,
  ZipPackParams,
  ZipUnpackParams
} from '@shared/types'
import { handle } from './wrapper'
import { exportDuplicateReport, exportInventory, findDuplicates } from '../services/inventoryService'
import { packZip, unpackZip } from '../services/zipService'

handle('file:inventory', (p: InventoryParams) => exportInventory(p))
handle('file:find-duplicates', (p: DuplicateFindParams) => findDuplicates(p))
handle('file:export-duplicates', (p: DuplicateExportParams) => exportDuplicateReport(p))
handle('zip:pack', (p: ZipPackParams) => packZip(p))
handle('zip:unpack', (p: ZipUnpackParams) => unpackZip(p))
handle('file:sizes', (paths: string[]) =>
  paths.map(p => ({ path: p, sizeBytes: fs.statSync(p).size }))
)
