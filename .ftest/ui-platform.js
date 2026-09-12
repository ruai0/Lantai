(async () => {
  const __Z = window.__Z
  const FT = 'J:/chinaMobile/network_project/freeTool/.ftest/'
  const res = {}

  // ── #5 目录展开：拖入 .ftest/img（含 4 张 png），只要 png ──────────
  const exp = await window.api.expandPaths({ paths: [FT + 'img'], exts: ['png'] })
  res.expandOk = !!(exp.ok && exp.data.dirs === 1 && exp.data.files.length >= 3 && exp.data.files.every(p => p.toLowerCase().endsWith('.png')))

  // ── #2 环境探测：probe IPC + 诊断里带探测字段 ──────────────────────
  const pr = await window.api.probe({ force: true })
  res.probeOk = !!(pr.ok && typeof pr.data.word === 'string' && Array.isArray(pr.data.cjkFonts) && typeof pr.data.watermarkReady === 'boolean')
  const dg = await window.api.diagnostics()
  res.diagHasProbe = !!(dg.ok && 'officeWord' in dg.data && 'watermark' in dg.data)

  // ── #6 重命名撤销闭环：写两个文件 → 改名 → 撤销 → 原名回来 ─────────
  const b64 = s => btoa(unescape(encodeURIComponent(s)))
  const w1 = await window.api.writeBinary({ dir: FT + 'out', name: 'ud-a.txt', base64: b64('A') })
  const base = p => p.slice(Math.max(p.lastIndexOf('\\'), p.lastIndexOf('/')) + 1)
  if (!w1.ok) return { ...res, fail: 'writeBinary 失败：' + w1.error }
  const from1 = base(w1.data.path)
  const applied = await window.api.renameApply({ dir: FT + 'out', pairs: [{ from: from1, to: 'undone-' + from1 }] })
  const st1 = await window.api.undoState()
  const undone = await window.api.undoLast({ kind: 'rename' })
  const st2 = await window.api.undoState()
  const list = await window.api.expandPaths({ paths: [FT + 'out'], exts: ['txt'] })
  const names = list.ok ? list.data.files.map(base) : []
  res.undoRound = !!(
    applied.ok && applied.data.count === 1 && applied.data.undoable === 1 &&
    st1.ok && st1.data.rename && st1.data.rename.count === 1 &&
    undone.ok && undone.data.undone === 1 &&
    st2.ok && st2.data.rename === null &&
    names.includes(from1) && !names.includes('undone-' + from1)
  )

  // ── #1 进度通道：主进程 task:update 应推来 ZIP 打包任务 ────────────
  window.__tu = []
  const off = window.api.onTaskUpdate(l => window.__tu.push(l))
  const zipped = await window.api.zipPack({ dir: FT + 'img', outDir: FT + 'out' })
  res.zipOk = zipped.ok
  // 广播有 120ms 节流，等事件到位而不是同步检查
  res.progressSeen = await __Z.wait(
    () => window.__tu.some(l0 => l0.some(t => t.label === 'ZIP 打包' && t.done > 0)),
    4000
  )
  res.dockShown = !!document.querySelector('.task-dock') // done 状态驻留 ~2s，此刻应可见
  off()

  // ── #1 渲染层串行：连发两个合并任务，TaskDock 应出现排队数 ─────────
  const fixtures = [FT + 'fixture-a.pdf', FT + 'fixture-b.pdf']
  const m1 = window.api.pdfMerge({ paths: fixtures, outDir: FT + 'out' })
  const m2 = window.api.pdfMerge({ paths: fixtures, outDir: FT + 'out' })
  const both = await Promise.all([m1, m2])
  res.mergedTwice = both.every(r => r.ok && r.data.outputs.length === 1)

  // ── 软件更新：update:state 通道 + 设置页更新卡片渲染 ────────────────
  const us = await window.api.updateState()
  res.updateStateOk = !!(us.ok && typeof us.data.current === 'string')
  const uc = await window.api.updateCheck()
  res.updateCheckOk = !!uc.ok // 开发环境返回 idle+提示，不算错误
  if (!(await __Z.nav('#/settings', 'version'))) return { fail: 'SettingsView 未挂载' }
  await new Promise(r => setTimeout(r, 300))
  res.updateCardShown = document.body.textContent.includes('软件更新')

  return res
})()
