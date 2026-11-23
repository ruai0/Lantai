import type { FillTemplateParams, TemplateScanParams } from '@shared/types'
import { handle } from './wrapper'
import { runTracked } from '../services/taskProgress'
import { fillWord } from '../services/wordService'
import { fillExcel, previewData, scanTemplate } from '../services/excelService'
import { fillPptx } from '../services/pptxService'
import { officeToPdf } from '../services/officeToPdfService'
import { formatWordFiles, scanWordHeadings, type WordFormatParams } from '../services/wordFormatService'

handle('word:fill-template', (p: FillTemplateParams) =>
  runTracked('Word 批量填充', 1, ctx => fillWord(p, ctx.progress, ctx.isCancelled))
)
handle('word:format', (p: WordFormatParams) =>
  runTracked('Word 排版', p.paths.length, ctx => formatWordFiles(p, ctx.progress, ctx.isCancelled))
)
handle('word:format-scan', (p: { paths: string[] }) => scanWordHeadings(p.paths))
handle('excel:fill-template', (p: FillTemplateParams) =>
  runTracked('Excel 批量填充', 1, ctx => fillExcel(p, ctx.progress, ctx.isCancelled))
)
handle('pptx:fill-template', (p: FillTemplateParams) =>
  runTracked('PPT 批量填充', 1, ctx => fillPptx(p, ctx.progress, ctx.isCancelled))
)
handle('template:scan', (p: TemplateScanParams) => scanTemplate(p))
handle('data:preview', (p: { dataPath: string }) => previewData(p))
handle('office:to-pdf', p => runTracked('Office 转 PDF', p.paths.length, ctx => officeToPdf(p, ctx.progress, ctx.isCancelled)))
