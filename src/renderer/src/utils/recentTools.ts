/**
 * 最近使用的工具（本地记录，不上传、不进设置文件）。
 *
 * 为什么要有这个：机关里很多活是"每天重复同一件事"——合并报送材料、批量转 PDF。
 * 手动收藏能解决，但用户往往想不到去收藏；自动按使用频次排一下就省了这步。
 * 与「常用工具（收藏）」互补：收藏是用户明确指定，最近使用是系统自己观察。
 *
 * 存 localStorage 而不是 settings.json：纯界面偏好，丢了也不影响数据，
 * 不值得为它走主进程读写与版本迁移。
 */
const KEY = 'lantai.recentTools'
/** 最多记多少个（够排前 4 即可，留点余量） */
const LIMIT = 12

interface RecentItem {
  path: string
  /** 最近一次使用时间 */
  time: number
  /** 使用次数，用于同分排序 */
  count: number
}

function load(): RecentItem[] {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return []
    const arr = JSON.parse(raw)
    if (!Array.isArray(arr)) return []
    return arr.filter(
      (x): x is RecentItem =>
        !!x && typeof x.path === 'string' && typeof x.time === 'number' && typeof x.count === 'number'
    )
  } catch {
    return []
  }
}

function save(items: RecentItem[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(items))
  } catch {
    /* 隐私模式/配额满时静默放弃：这只是个便利功能，不该影响主流程 */
  }
}

/** 记一次使用（每次进入某工具页时调用） */
export function touchTool(path: string): void {
  if (!path || path === '/') return
  const items = load()
  const hit = items.find(i => i.path === path)
  if (hit) {
    hit.time = Date.now()
    hit.count += 1
  } else {
    items.push({ path, time: Date.now(), count: 1 })
  }
  items.sort((a, b) => b.time - a.time)
  save(items.slice(0, LIMIT))
}

/**
 * 取最近的工具路径。
 * 排序先看次数再看时间：偶尔点开看一眼的不该压过每天用的，
 * 但完全按次数排又会让"上次用是三个月前"的长期占位，所以次数优先、时间兜底。
 */
export function recentToolPaths(limit = 4): string[] {
  return load()
    .slice()
    .sort((a, b) => b.count - a.count || b.time - a.time)
    .slice(0, limit)
    .map(i => i.path)
}

/** 清空记录（设置页「清除使用记录」用得到） */
export function clearRecentTools(): void {
  try {
    localStorage.removeItem(KEY)
  } catch {
    /* ignore */
  }
}
