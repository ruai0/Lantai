/**
 * IPC 参数净化：Vue 的 ref()/reactive() 返回 Proxy，而 Electron 的
 * ipcRenderer.invoke 走结构化克隆，Proxy 会抛
 * 「An object could not be cloned」。这里递归重建为纯数据。
 *
 * 不用 JSON 往返：PDF 压缩等通道会传几十 MB 的 base64 数组，
 * 序列化再解析会凭空翻倍内存与耗时；数组 map 只复制引用，成本线性且低。
 */
export function plain<T>(v: T): T {
  if (v === null || typeof v !== 'object') return v
  if (ArrayBuffer.isView(v) || v instanceof ArrayBuffer) return v
  // File/Blob 要原样穿过 contextBridge（webUtils.getPathForFile 依赖真实对象）
  if (typeof File !== 'undefined' && v instanceof File) return v
  if (typeof Blob !== 'undefined' && v instanceof Blob) return v
  if (Array.isArray(v)) return v.map(item => plain(item)) as unknown as T
  if (v instanceof Date) return new Date(v.getTime()) as unknown as T
  const out: Record<string, unknown> = {}
  for (const key of Object.keys(v)) out[key] = plain((v as Record<string, unknown>)[key])
  return out as T
}
