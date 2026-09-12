import type { ExtractContactParams } from '@shared/types'
import { handle } from './wrapper'
import { extractAndSave } from '../services/extractService'
import { readDataRecords } from '../services/fileUtils'

handle('text:extract', (p: ExtractContactParams) => extractAndSave(p))
handle('data:all-records', async (p: { dataPath: string }) => ({
  records: await readDataRecords(p.dataPath)
}))
