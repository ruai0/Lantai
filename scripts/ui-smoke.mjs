/**
 * 一键 UI 冒烟：构建测试包 → 启动带 CDP 的应用 → 跑全部场景 → 汇总退出。
 *   npm run test:ui            # 全部场景
 *   npm run test:ui organize   # 只跑名字含 organize 的场景
 * 前置：node_modules 已安装；场景脚本在 .ftest/ui-*.js，素材由 make-fixtures 生成。
 */
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

const ROOT = path.resolve(import.meta.dirname, '..')
const PORT = 9222
const NODE = process.execPath
const SCENARIOS = [
  { file: 'ui-drag.js', name: '拖拽选文件', check: r => r.zoneRendered && r.originalKept && !String(r.bridge).startsWith('THREW') },
  { file: 'ui-organize.js', name: 'PDF 页面整理', check: r => r.ok === true },
  { file: 'ui-pdf3.js', name: 'PDF 压缩/转图/提取', check: r => r.compress === 'ok' && r.toimg === 'ok' && r.text === 'ok' },
  { file: 'ui-image.js', name: '长图拼接/证件照', check: r => typeof r.stitch === 'string' && typeof r.idphoto === 'string' },
  { file: 'ui-tools.js', name: '二维码识别/拼音', check: r => String(r.decode?.result).includes('freetool-test') && !!r.pinyin },
  { file: 'ui-filekit.js', name: 'ZIP 打包解压', check: r => r.pack?.length > 0 && r.unpack?.length > 0 },
  { file: 'ui-match.js', name: '匹配填充/差异比对', check: r => r.fill?.matched === 3 && r.compare?.changed === 1 },
  { file: 'ui-diff.js', name: '文本对比', check: r => r.changed === 1 && r.added === 1 },
  {
    file: 'ui-palette.js',
    name: '命令面板/收藏/诊断/通知',
    check: r =>
      r.paletteOpened &&
      r.paletteGotoPdf &&
      r.favPersisted &&
      r.sidebarFavGroup &&
      r.favRestored &&
      r.diagOk &&
      r.diagMsgShown &&
      r.notifyOk
  },
  {
    file: 'ui-platform.js',
    name: '任务进度/环境探测/拖目录/撤销/更新',
    check: r =>
      r.expandOk &&
      r.probeOk &&
      r.diagHasProbe &&
      r.undoRound &&
      r.progressSeen &&
      r.dockShown &&
      r.zipOk &&
      r.mergedTwice &&
      r.updateStateOk &&
      r.updateCheckOk &&
      r.updateCardShown &&
      r.authorShown &&
      r.debugOpened &&
      r.debugClosed &&
      r.diagHasFeed &&
      r.traySwitchShown
  },
  {
    file: 'ui-settings.js',
    name: '设置（主题/完成行为/默认目录）',
    check: r => r.versionShown && r.themeDark && r.themeLight && r.onCompletePersisted && r.defaultDirPrefilled
  }
]

function run(cmd, args, opts = {}) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { cwd: ROOT, stdio: 'inherit', shell: false, ...opts })
    p.on('exit', code => (code === 0 ? resolve() : reject(new Error(`${path.basename(cmd)} 退出码 ${code}`))))
    p.on('error', reject)
  })
}

function spawnDetached(cmd, args) {
  const log = fs.openSync(path.join(ROOT, '.ftest', 'ui-smoke-app.log'), 'a')
  const p = spawn(cmd, args, { cwd: ROOT, stdio: ['ignore', log, log], shell: false, detached: true })
  fs.closeSync(log)
  return p
}

async function waitForTarget(timeoutMs = 30000) {
  const t0 = Date.now()
  while (Date.now() - t0 < timeoutMs) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json()
      if (list.some(t => t.type === 'page' && t.url.includes('renderer'))) return
    } catch {
      /* 还没起来 */
    }
    await new Promise(r => setTimeout(r, 500))
  }
  throw new Error('CDP 目标等待超时，查看 .ftest/ui-smoke-app.log')
}

/** 跑一个表达式文件，返回解析后的 JSON（失败/异常返回 null） */
async function evalFile(file, outFile) {
  try {
    const fd = fs.openSync(outFile, 'w')
    try {
      await run(NODE, [path.join(ROOT, 'scripts/cdp.mjs'), file], { stdio: ['ignore', fd, 'inherit'] })
    } finally {
      fs.closeSync(fd)
    }
    return JSON.parse(fs.readFileSync(outFile, 'utf8'))
  } catch {
    return null
  }
}

// CDP 目标出现 ≠ Vue 已挂载；等侧栏渲染出来再跑场景，避免首个场景抢跑超时
async function waitForApp(timeoutMs = 20000) {
  const ready = path.join(ROOT, '.ftest', 'ui-ready.js')
  const out = path.join(ROOT, '.ftest', 'ui-smoke-ready.json')
  const t0 = Date.now()
  while (Date.now() - t0 < timeoutMs) {
    const r = await evalFile(ready, out)
    if (r?.ready) return
    await new Promise(r2 => setTimeout(r2, 400))
  }
  throw new Error('应用挂载等待超时（侧栏未渲染），查看 .ftest/ui-smoke-app.log')
}

async function main() {
  const filter = process.argv[2]
  const scenarios = filter ? SCENARIOS.filter(s => s.file.includes(filter) || s.name.includes(filter)) : SCENARIOS
  if (!scenarios.length) {
    console.error(`没有匹配 "${filter}" 的场景`)
    process.exit(1)
  }

  console.log('▶ 构建测试包（FT_TEST_HOOKS=1）')
  process.env.FT_TEST_HOOKS = '1'
  await run(NODE, [path.join(ROOT, 'node_modules/electron-vite/bin/electron-vite.js'), 'build'])

  console.log('▶ 生成测试素材')
  await run(NODE, [path.join(ROOT, 'scripts/make-fixtures.mjs')])

  console.log(`▶ 启动应用（CDP :${PORT}）`)
  const app = spawnDetached(path.join(ROOT, 'node_modules/electron/dist/electron.exe'), ['.', `--remote-debugging-port=${PORT}`])
  const cleanup = () => {
    try {
      process.kill(app.pid)
    } catch {
      /* 已退出 */
    }
  }
  process.on('exit', cleanup)

  let failed = 0
  try {
    await waitForTarget()
    await waitForApp()
    for (const s of scenarios) {
      const file = path.join(ROOT, '.ftest', s.file)
      const t0 = Date.now()
      const result = await evalFile(file, path.join(ROOT, '.ftest', 'ui-smoke-last.json'))
      const secs = ((Date.now() - t0) / 1000).toFixed(1)
      const ok = result && !result.fail && s.check(result)
      if (!ok) failed++
      console.log(`${ok ? '✅' : '❌'} ${s.name}（${secs}s）${ok ? '' : ' → ' + JSON.stringify(result ?? '执行异常')}`)
    }
  } finally {
    cleanup()
  }
  console.log(failed ? `\n${failed} 个场景失败` : '\n全部场景通过')
  process.exit(failed ? 1 : 0)
}

main().catch(e => {
  console.error(e.message)
  process.exit(1)
})
