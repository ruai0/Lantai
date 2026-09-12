import { plain } from '@shared/serialize'

/**
 * window.api 的渲染进程包装。
 * contextBridge 在参数进入 preload 之前就用结构化克隆语义序列化，
 * Vue 的 reactive/ref Proxy 会在那里抛「An object could not be cloned」，
 * 所以净化必须发生在调用 window.api 之前（渲染侧），preload 侧的 plain 只是第二道保险。
 */
type Api = typeof window.api

export const api: Api = new Proxy({} as Api, {
  get(_target, key: string | symbol): unknown {
    const fn = (window.api as unknown as Record<string | symbol, unknown>)[key]
    if (typeof fn !== 'function') return fn
    return (...args: unknown[]) => (fn as (...a: unknown[]) => unknown)(...args.map(a => plain(a)))
  }
})
