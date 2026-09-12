/**
 * 一键发布：版本号 → 提交 → git tag → 构建安装包 → 生成 SHA256SUMS.txt。
 *   node scripts/release.mjs 0.6.0     （或 npm run release 0.6.0）
 * 前置：CHANGELOG.md 已写好 "## [0.6.0]" 段落；工作区干净。
 * 发布物生成在 release/ 后，需手工上传到更新源（GitHub Releases 或静态目录）。
 */
import { spawnSync } from 'node:child_process'
import crypto from 'node:crypto'
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

console.log('▶ 构建渲染层 + 主进程')
run(process.execPath, [path.join(ROOT, 'node_modules', 'electron-vite', 'bin', 'electron-vite.js'), 'build'])

console.log('▶ 打包安装程序（electron-builder）')
run(process.execPath, [path.join(ROOT, 'node_modules', 'electron-builder', 'out', 'cli', 'cli.js')])

console.log('▶ 生成 SHA256SUMS.txt')
const rel = path.join(ROOT, 'release')
const artifacts = fs
  .readdirSync(rel)
  .filter(f => /(\.exe|\.yml|\.blockmap)$/i.test(f) && f.includes(ver))
if (!artifacts.length) die('release/ 里没有找到本次版本的产物')
const lines = artifacts.map(f => {
  const hash = crypto.createHash('sha256').update(fs.readFileSync(path.join(rel, f))).digest('hex')
  console.log(`  ${hash.slice(0, 16)}…  ${f}`)
  return `${hash}  ${f}`
})
fs.writeFileSync(path.join(rel, 'SHA256SUMS.txt'), lines.join('\n') + '\n')

console.log(`\n✔ v${ver} 发布物已就绪（release/ + SHA256SUMS.txt，git tag v${ver} 已打）`)
console.log('  下一步：把 setup / portable / latest.yml / blockmap 上传到更新源（如 GitHub Releases），')
console.log('  用户端在「设置 → 软件更新」配置更新源后即可自动收到升级。')
