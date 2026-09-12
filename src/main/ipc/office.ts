import type { FillTemplateParams, OfficeToPdfParams, TemplateScanParams } from '@shared/types'
import { handle } from './wrapper'
import { fillWord } from '../services/wordService'
import { fillExcel, previewData, scanTemplate } from '../services/excelService'
import { officeToPdf } from '../services/officeToPdfService'

handle('word:fill-template', (p: FillTemplateParams) => fillWord(p))
handle('excel:fill-template', (p: FillTemplateParams) => fillExcel(p))
handle('template:scan', (p: TemplateScanParams) => scanTemplate(p))
handle('data:preview', (p: { dataPath: string }) => previewData(p))
handle('office:to-pdf', (p: OfficeToPdfParams) => officeToPdf(p))
