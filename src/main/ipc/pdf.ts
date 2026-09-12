import type {
  PdfBuildParams,
  PdfDeletePagesParams,
  PdfImagesParams,
  PdfOrganizeParams,
  PdfPageNumberParams,
  PdfPagesInfoParams,
  PdfResult,
  PdfStampParams,
  PdfWatermarkParams
} from '@shared/types'
import { handle } from './wrapper'
import {
  addPageNumbers,
  buildFromImages,
  deletePdfPages,
  imagesToPdf,
  mergePdfs,
  organizePdf,
  pagesInfo,
  rotatePdf,
  splitPdf,
  stampImage,
  watermarkPdf
} from '../services/pdfService'

handle('pdf:merge', (p: import('@shared/types').PdfMergeParams) => mergePdfs(p))
handle('pdf:split', (p: import('@shared/types').PdfSplitParams) => splitPdf(p))
handle('pdf:rotate', (p: import('@shared/types').PdfRotateParams) => rotatePdf(p))
handle('pdf:add-page-numbers', (p: PdfPageNumberParams) => addPageNumbers(p))
handle('pdf:images-to-pdf', (p: PdfImagesParams) => imagesToPdf(p))
handle('pdf:watermark', (p: PdfWatermarkParams) => watermarkPdf(p))
handle('pdf:stamp-image', (p: PdfStampParams) => stampImage(p))
handle('pdf:delete-pages', (p: PdfDeletePagesParams) => deletePdfPages(p))
handle('pdf:pages-info', (p: PdfPagesInfoParams) => pagesInfo(p))
handle('pdf:organize', (p: PdfOrganizeParams) => organizePdf(p))
handle('pdf:build-from-images', (p: PdfBuildParams) => buildFromImages(p))

export type { PdfResult }
