import type {
  ExcelCompareParams,
  ExcelCondFormatParams,
  ExcelCsvParams,
  ExcelGroupParams,
  ExcelMaskParams,
  ExcelMatchFillParams,
  ExcelMergeParams,
  ExcelSortDedupeParams,
  ExcelSplitColumnParams,
  ExcelSplitRowsParams,
  ExcelSplitSheetParams
} from '@shared/types'
import { handle } from './wrapper'
import {
  conditionalFormat,
  csvToXlsx,
  desensitize,
  groupSummary,
  mergeWorkbooks,
  readHeaders,
  sortDedupe,
  splitByColumn,
  splitByRows,
  splitBySheets
} from '../services/excelToolsService'
import { compareTables, listSheets, matchFill } from '../services/excelMatchService'
import { runTracked } from '../services/taskProgress'

handle('excel:merge', (p: ExcelMergeParams) =>
  runTracked('Excel 多簿合并', p.paths.length, ctx =>
    mergeWorkbooks(p, { onProgress: ctx.progress, isCancelled: ctx.isCancelled })
  )
)
handle('excel:split-sheets', (p: ExcelSplitSheetParams) => splitBySheets(p))
handle('excel:split-rows', (p: ExcelSplitRowsParams) =>
  runTracked('Excel 按行拆分', 0, ctx =>
    splitByRows(p, { onProgress: ctx.progress, isCancelled: ctx.isCancelled })
  )
)
handle('excel:split-column', (p: ExcelSplitColumnParams) =>
  runTracked('Excel 按列拆分', 0, ctx => splitByColumn(p, { onProgress: ctx.progress, isCancelled: ctx.isCancelled }))
)
handle('excel:csv-to-xlsx', (p: ExcelCsvParams) =>
  runTracked('CSV 转 Excel', p.paths.length, ctx =>
    csvToXlsx(p, { onProgress: ctx.progress, isCancelled: ctx.isCancelled })
  )
)
handle('excel:mask', (p: ExcelMaskParams) => desensitize(p))
handle('excel:sort-dedupe', (p: ExcelSortDedupeParams) => sortDedupe(p))
handle('excel:group', (p: ExcelGroupParams) => groupSummary(p))
handle('excel:conditional-format', (p: ExcelCondFormatParams) => conditionalFormat(p))
handle('excel:read-headers', (p: { path: string; headerRow?: number; sheet?: string }) =>
  readHeaders(p.path, p.headerRow, p.sheet)
)
handle('excel:list-sheets', (p: { path: string }) => listSheets(p.path))
handle('excel:match-fill', (p: ExcelMatchFillParams) => matchFill(p))
handle('excel:compare', (p: ExcelCompareParams) => compareTables(p))
