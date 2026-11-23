import { api } from './ipc'
import * as pdfjs from 'pdfjs-dist'
// 用 ?raw 把 worker 源码内联成字符串：Vite 对 `?url` 的动态导入会被包进
// __vitePreload，而 file:// 下 Chromium 不会触发 modulepreload 的 load 事件，
// 导致 await 永远不返回（表现为点击后毫无反应、也不报错）。
import workerSource from 'pdfjs-dist/build/pdf.worker.min.mjs?raw'

/** 加载 PDF 文档；每次给 pdf.js 一个新的 worker，用完即销毁 */
export async function openPdf(data: Uint8Array, timeoutMs = 30000) {
  const blob = new Blob([workerSource], { type: 'text/javascript' })
  const workerUrl = URL.createObjectURL(blob)
  const port = new Worker(workerUrl, { type: 'module' })
  pdfjs.GlobalWorkerOptions.workerPort = port
  const task = pdfjs.getDocument({ data })
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    const doc = await Promise.race([
      task.promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`PDF 解析超时（${Math.round(timeoutMs / 1000)} 秒）`)), timeoutMs)
      })
    ])
    return {
      doc,
      async close() {
        if (timer) clearTimeout(timer)
        try {
          await task.destroy()
        } finally {
          port.terminate()
          URL.revokeObjectURL(workerUrl)
        }
      }
    }
  } catch (e) {
    if (timer) clearTimeout(timer)
    port.terminate()
    URL.revokeObjectURL(workerUrl)
    throw e
  }
}

/** 读取 PDF 原始字节：走二进制通道，避免 base64 编码 + atob 解码的额外开销 */
export async function readPdfBytes(path: string): Promise<Uint8Array> {
  const res = await api.readBytes({ path })
  if (!res.ok) throw new Error(res.error)
  return res.data
}

/**
 * 抽取 PDF 全部文本（供“提取联系方式”等复用）。
 * 文本型 PDF 直接取文本层；扫描件（无文本层）返回空串——调用方据此提示用户。
 * 用 hasText 标记本页是否有文本层，方便上层统计。
 */
export async function extractPdfText(path: string): Promise<string> {
  const bytes = await readPdfBytes(path)
  const { doc, close } = await openPdf(bytes)
  try {
    const parts: string[] = []
    for (let i = 1; i <= doc.numPages; i++) {
      const page = await doc.getPage(i)
      const content = await page.getTextContent()
      const line = content.items
        .map(it => ('str' in it ? it.str : ''))
        .join('')
      parts.push(line)
      page.cleanup()
    }
    return parts.join('\n')
  } finally {
    await close()
  }
}
