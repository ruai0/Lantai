/**
 * 一键发布：版本号 → 提交 → git tag → 推送 GitHub，云端 Actions 负责构建与 Release。
 *   node scripts/release.mjs 0.6.0     （或 npm run release 0.6.0）
 * 前置：CHANGELOG.md 已写好 "## [0.6.0]" 段落；工作区干净；origin 为 GitHub SSH。
 */
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

const ROOT = path.resolve(import.meta.dirname, '..')
const ver = process.argv[2]

function die(msg) {
  console.error(`✖ ${msg}`)
  process.exit(1)
}
function run(cmd, args) {
  const r = spawnSync(cmd, args, { cwd: ROOT, stdio: 'inherit' })
  if (r.status !== 0) die(`${[path.basename(cmd), ...args].join(' ')} 退出码 ${r.status}`)
}
function gitOut(args) {
  const r = spawnSync('git', args, { cwd: ROOT, encoding: 'utf8' })
  if (r.status !== 0) die(`git ${args.join(' ')} 失败：${r.stderr}`)
  return r.stdout.trim()
}

if (!ver) die('用法：node scripts/release.mjs <version>，例如 0.6.0')
if (!/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/.test(ver)) die(`版本号格式不合法：${ver}`)
if (gitOut(['status', '--porcelain'])) die('工作区不干净：先提交或还原所有改动')
if (gitOut(['tag', '-l', `v${ver}`])) die(`tag v${ver} 已存在，请勿重复发布`)

const pkgPath = path.join(ROOT, 'package.json')
const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'))
if (pkg.version === ver) die(`package.json 已是 ${ver}，请给个新版本号`)
const changelog = fs.readFileSync(path.join(ROOT, 'CHANGELOG.md'), 'utf8')
if (!changelog.includes(`## [${ver}]`)) die(`CHANGELOG.md 缺少 "## [${ver}]" 段落，先补写`)

console.log(`▶ 版本号 ${pkg.version} → ${ver}`)
pkg.version = ver
fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n')

run('git', ['add', 'package.json'])
run('git', ['commit', '-m', `release: v${ver}`])
run('git', ['tag', `v${ver}`])

console.log('▶ 推送到 GitHub（main + tag），云端 Actions 将自动构建并发布 Release')
run('git', ['push', 'origin', 'main'])
run('git', ['push', 'origin', `v${ver}`])

console.log(`\n✔ v${ver} 已交给 GitHub Actions 构建（约 5~10 分钟）`)
console.log(`  盯进度：仓库页 Actions 标签，或直接开 https://github.com/ruai0/Lantai/actions`)
console.log(`  完成后 Releases 页会多出 setup/便携版/latest.yml/SHA256SUMS.txt；`)
console.log(`  已安装的旧版本用户下次启动即会收到自动升级。`)
console.log(`  如需本地产物：npm run dist（发布请走上面的云端流程，别混用）`)
