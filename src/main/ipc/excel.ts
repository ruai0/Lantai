import type {
  ExcelCompareParams,
  ExcelCsvParams,
  ExcelMaskParams,
  ExcelMatchFillParams,
  ExcelMergeParams,
  ExcelSplitColumnParams,
  ExcelSplitRowsParams,
  ExcelSplitSheetParams
} from '@shared/types'
import { handle } from './wrapper'
import {
  csvToXlsx,
  desensitize,
  mergeWorkbooks,
  readHeaders,
  splitByColumn,
  splitByRows,
  splitBySheets
} from '../services/excelToolsService'
import { compareTables, matchFill } from '../services/excelMatchService'

handle('excel:merge', (p: ExcelMergeParams) => mergeWorkbooks(p))
handle('excel:split-sheets', (p: ExcelSplitSheetParams) => splitBySheets(p))
handle('excel:split-rows', (p: ExcelSplitRowsParams) => splitByRows(p))
handle('excel:split-column', (p: ExcelSplitColumnParams) => splitByColumn(p))
handle('excel:csv-to-xlsx', (p: ExcelCsvParams) => csvToXlsx(p))
handle('excel:mask', (p: ExcelMaskParams) => desensitize(p))
handle('excel:read-headers', (p: { path: string }) => readHeaders(p.path))
handle('excel:match-fill', (p: ExcelMatchFillParams) => matchFill(p))
handle('excel:compare', (p: ExcelCompareParams) => compareTables(p))
