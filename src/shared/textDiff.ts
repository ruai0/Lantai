/**
 * 文本逐行差异对比（纯函数，渲染进程直接调用）。
 * 策略：先剥公共前后缀，中间段做 LCS；中间段过大时降级为「整段替换」并标记 truncated。
 * 相邻的删除+新增会配对成「变更」行，更符合看改动的直觉。
 */

export type DiffType = 'same' | 'add' | 'del' | 'chg'

export interface DiffLine {
  type: DiffType
  text: string
  /** 左侧（原文）行号，从 1 开始；add 行为 null */
  aNo: number | null
  /** 右侧（新文）行号，从 1 开始；del 行为 null */
  bNo: number | null
}

export interface DiffResult {
  lines: DiffLine[]
  added: number
  deleted: number
  changed: number
  same: number
  /** 中间段超过 LCS 上限，降级为整段替换（结果仍正确但不够细） */
  truncated: boolean
}

/** 中间段 LCS 上限：2000×2000 的 DP 表约 16MB，再大就降级 */
const MAX_MID = 2000

export function splitLines(text: string): string[] {
  if (text === '') return []
  return text.split(/\r\n|\r|\n/)
}

function lcsOps(a: string[], b: string[]): DiffLine[] {
  const n = a.length
  const m = b.length
  // dp[i][j] = a[i..] 与 b[j..] 的 LCS 长度
  const dp = new Uint32Array((n + 1) * (m + 1))
  const at = (i: number, j: number) => i * (m + 1) + j
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[at(i, j)] = a[i] === b[j] ? dp[at(i + 1, j + 1)] + 1 : Math.max(dp[at(i + 1, j)], dp[at(i, j + 1)])
    }
  }
  const out: DiffLine[] = []
  let i = 0
  let j = 0
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      out.push({ type: 'same', text: a[i], aNo: i + 1, bNo: j + 1 })
      i++
      j++
    } else if (dp[at(i + 1, j)] >= dp[at(i, j + 1)]) {
      out.push({ type: 'del', text: a[i], aNo: i + 1, bNo: null })
      i++
    } else {
      out.push({ type: 'add', text: b[j], aNo: null, bNo: j + 1 })
      j++
    }
  }
  while (i < n) out.push({ type: 'del', text: a[i], aNo: ++i, bNo: null })
  while (j < m) out.push({ type: 'add', text: b[j], aNo: null, bNo: ++j })
  return out
}

/** 把连续的 del 块与紧随其后的 add 块按行配对成 chg */
function pairChanges(lines: DiffLine[]): DiffLine[] {
  const out: DiffLine[] = []
  let k = 0
  while (k < lines.length) {
    if (lines[k].type === 'del') {
      const dels: DiffLine[] = []
      while (k < lines.length && lines[k].type === 'del') dels.push(lines[k++])
      const adds: DiffLine[] = []
      while (k < lines.length && lines[k].type === 'add') adds.push(lines[k++])
      const paired = Math.min(dels.length, adds.length)
      for (let p = 0; p < paired; p++)
        out.push({ type: 'chg', text: adds[p].text, aNo: dels[p].aNo, bNo: adds[p].bNo })
      for (let p = paired; p < dels.length; p++) out.push(dels[p])
      for (let p = paired; p < adds.length; p++) out.push(adds[p])
    } else {
      out.push(lines[k++])
    }
  }
  return out
}

export function diffLines(a: string, b: string): DiffResult {
  const A = splitLines(a)
  const B = splitLines(b)
  let p = 0
  while (p < A.length && p < B.length && A[p] === B[p]) p++
  let s = 0
  while (s < A.length - p && s < B.length - p && A[A.length - 1 - s] === B[B.length - 1 - s]) s++

  const midA = A.slice(p, A.length - s)
  const midB = B.slice(p, B.length - s)
  const truncated = midA.length > MAX_MID || midB.length > MAX_MID

  const head: DiffLine[] = A.slice(0, p).map((t, idx) => ({ type: 'same', text: t, aNo: idx + 1, bNo: idx + 1 }))
  const tail: DiffLine[] = A.slice(A.length - s).map((t, idx) => ({
    type: 'same',
    text: t,
    aNo: A.length - s + idx + 1,
    bNo: B.length - s + idx + 1
  }))

  let mid: DiffLine[]
  if (truncated) {
    const aOff = p
    const bOff = p
    mid = [
      ...midA.map((t, idx) => ({ type: 'del' as const, text: t, aNo: aOff + idx + 1, bNo: null })),
      ...midB.map((t, idx) => ({ type: 'add' as const, text: t, aNo: null, bNo: bOff + idx + 1 }))
    ]
  } else {
    mid = lcsOps(midA, midB)
    // 修正行号：LCS 在中间段内从 1 开始，需平移 p
    for (const l of mid) {
      if (l.aNo !== null) l.aNo += p
      if (l.bNo !== null) l.bNo += p
    }
  }

  const lines = pairChanges([...head, ...mid, ...tail])
  let added = 0
  let deleted = 0
  let changed = 0
  let same = 0
  for (const l of lines) {
    if (l.type === 'add') added++
    else if (l.type === 'del') deleted++
    else if (l.type === 'chg') changed++
    else same++
  }
  return { lines, added, deleted, changed, same, truncated }
}
