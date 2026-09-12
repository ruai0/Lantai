import fs from 'node:fs'
import path from 'node:path'
import type {
  OrganizeApplyParams,
  OrganizePair,
  OrganizePlanParams,
  RenameApplyParams,
  RenamePlanParams
} from '@shared/types'
import { handle } from './wrapper'
import { buildRenamePlan, filterByExts } from '../services/renameService'
import { buildOrganizePlan } from '../services/organizeService'

handle('file:rename-plan', (p: RenamePlanParams) => {
  const entries = fs.readdirSync(p.dir, { withFileTypes: true })
  const fileNames = entries.filter(e => e.isFile()).map(e => e.name)
  const allNames = new Set(fileNames)
  const filtered = filterByExts(fileNames, p.exts)
  return { plan: buildRenamePlan(filtered, p.rules, allNames) }
})

handle('file:rename-apply', (p: RenameApplyParams) => {
  let count = 0
  for (const pair of p.pairs) {
    if (pair.from === pair.to) continue
    const from = path.join(p.dir, pair.from)
    const to = path.join(p.dir, pair.to)
    if (fs.existsSync(to)) throw new Error(`目标已存在，已中止：${pair.to}（此前已完成 ${count} 个）`)
    fs.renameSync(from, to)
    count++
  }
  return { count }
})

handle('file:organize-plan', (p: OrganizePlanParams) => {
  const entries = fs
    .readdirSync(p.dir, { withFileTypes: true })
    .filter(e => e.isFile())
    .map(e => {
      const stat = fs.statSync(path.join(p.dir, e.name))
      return { name: e.name, mtimeMs: stat.mtimeMs }
    })
  const plan: OrganizePair[] = buildOrganizePlan(entries, p.mode)
  for (const pair of plan) {
    if (fs.existsSync(path.join(p.dir, pair.to))) {
      pair.conflict = true
      pair.reason = '目标文件夹已存在同名文件'
    }
  }
  return { plan }
})

handle('file:organize-apply', (p: OrganizeApplyParams) => {
  let count = 0
  for (const pair of p.pairs) {
    const from = path.join(p.dir, pair.from)
    const to = path.join(p.dir, pair.to)
    fs.mkdirSync(path.dirname(to), { recursive: true })
    if (fs.existsSync(to)) throw new Error(`目标已存在，已中止：${pair.to}（此前已完成 ${count} 个）`)
    fs.renameSync(from, to)
    count++
  }
  return { count }
})
