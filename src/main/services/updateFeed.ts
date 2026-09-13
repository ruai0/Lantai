/** 官方更新源内置：用户零配置即可收到更新；设置里填地址则覆盖（镜像/内网发布场景） */
export const DEFAULT_UPDATE_FEED = 'https://github.com/ruai0/Lantai'

/**
 * 解析更新源地址（纯函数，可单测）。
 * 规则：留空 → 内置官方源；off/none/- → 禁用（null）；
 * github.com/<owner>/<repo> → GitHub Releases provider；其余 http(s) → 通用静态目录；非法协议 → null。
 */
export function parseUpdateFeed(
  raw: string,
  fallback = DEFAULT_UPDATE_FEED
): { provider: 'github'; owner: string; repo: string } | { provider: 'generic'; url: string } | null {
  const trimmed = (raw ?? '').trim()
  if (/^(off|none|-)$/i.test(trimmed)) return null
  const feed = trimmed || fallback
  if (!/^https?:\/\//i.test(feed)) return null
  const gh = feed.match(/^https?:\/\/(?:www\.)?github\.com\/([^/]+)\/([^/]+)\/?$/i)
  if (gh) return { provider: 'github', owner: gh[1], repo: gh[2] }
  return { provider: 'generic', url: feed }
}
