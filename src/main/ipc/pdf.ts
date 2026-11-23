import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type {
  PdfBuildParams,
  PdfDeletePagesParams,
  PdfExtractImagesParams,
  PdfHeaderFooterParams,
  PdfImagesParams,
  PdfOrganizeParams,
  PdfPageNumberParams,
  PdfPagesInfoParams,
  PdfReadMetaParams,
  PdfResizeParams,
  PdfResult,
  PdfStampParams,
  PdfWatermarkParams,
  PdfWriteMetaParams
} from '@shared/types'
import { handle } from './wrapper'
import { runTracked } from '../services/taskProgress'
import {
  addHeaderFooter,
  addPageNumbers,
  batchPdf,
  buildFromImages,
  checkPdfEncrypted,
  deletePdfPages,
  estimateOrganizedSize,
  extractPdfImages,
  imagesToPdf,
  mergePdfs,
  organizePdf,
  organizeToTemp,
  pagesInfo,
  readPdfMeta,
  resizePdfPages,
  rotatePdf,
  splitPdf,
  stampImage,
  watermarkPdf,
  writePdfMeta
} from '../services/pdfService'

handle('pdf:merge', p => runTracked('PDF 合并', p.paths.length, ctx => mergePdfs(p, ctx.progress, ctx.isCancelled)))
handle('pdf:split', (p: import('@shared/types').PdfSplitParams) =>
  runTracked('PDF 拆分', 1, ctx => splitPdf(p, ctx.progress, ctx.isCancelled))
)
handle('pdf:rotate', (p: import('@shared/types').PdfRotateParams) => rotatePdf(p))
handle('pdf:add-page-numbers', (p: PdfPageNumberParams) => addPageNumbers(p))
handle('pdf:images-to-pdf', (p: PdfImagesParams) =>
  runTracked('图片转 PDF', p.paths.length, ctx => imagesToPdf(p, ctx.progress, ctx.isCancelled))
)
handle('pdf:watermark', (p: PdfWatermarkParams) => watermarkPdf(p))
handle('pdf:stamp-image', (p: PdfStampParams) => stampImage(p))
handle('pdf:delete-pages', (p: PdfDeletePagesParams) => deletePdfPages(p))
handle('pdf:pages-info', (p: PdfPagesInfoParams) => pagesInfo(p))
handle('pdf:check-encrypted', (p: import('@shared/types').PdfCheckEncryptedParams) => checkPdfEncrypted(p))
handle('pdf:organize', (p: PdfOrganizeParams) => organizePdf(p))
handle('pdf:organize-estimate', (p: PdfOrganizeParams) => estimateOrganizedSize(p))
handle('pdf:organize-temp', (p: PdfOrganizeParams) => organizeToTemp(p))
/** 删除压缩流程的中间文件；只允许删系统临时目录内的文件，防止越权删用户数据 */
handle('pdf:remove-temp', async (p: { path: string }) => {
  const tmpRoot = path.resolve(os.tmpdir())
  const target = path.resolve(p.path)
  if (!target.startsWith(tmpRoot + path.sep)) throw new Error('只允许删除临时目录内的文件')
  await fs.promises.rm(target, { force: true })
  return true
})
handle('pdf:build-from-images', (p: PdfBuildParams) => buildFromImages(p))
handle('pdf:read-meta', (p: PdfReadMetaParams) => readPdfMeta(p))
handle('pdf:write-meta', (p: PdfWriteMetaParams) => writePdfMeta(p))
handle('pdf:resize', (p: PdfResizeParams) => resizePdfPages(p))
handle('pdf:header-footer', (p: PdfHeaderFooterParams) => addHeaderFooter(p))
handle('pdf:extract-images', (p: PdfExtractImagesParams) => extractPdfImages(p))
handle('pdf:batch', p =>
  runTracked('PDF 批量处理', p.paths.length, ctx => batchPdf(p, ctx.progress, ctx.isCancelled))
)

export type { PdfResult }
