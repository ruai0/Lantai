import type { FillTemplateParams, OfficeToPdfParams, TemplateScanParams } from '@shared/types'
import { handle } from './wrapper'
import { runTracked } from '../services/taskProgress'
import { fillWord } from '../services/wordService'
import { fillExcel, previewData, scanTemplate } from '../services/excelService'
import { officeToPdf } from '../services/officeToPdfService'

handle('word:fill-template', (p: FillTemplateParams) => fillWord(p))
handle('excel:fill-template', (p: FillTemplateParams) => fillExcel(p))
handle('template:scan', (p: TemplateScanParams) => scanTemplate(p))
handle('data:preview', (p: { dataPath: string }) => previewData(p))
handle('office:to-pdf', p => runTracked('Office 转 PDF', p.paths.length, d => officeToPdf(p, d)))
