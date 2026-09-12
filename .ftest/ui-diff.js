(async () => {
  const __Z = window.__Z
  if (!(await __Z.nav('#/tools', 'diffA'))) return { fail: 'diff refs 未挂载' }
  const st = __Z.vm('diffA')
  st.tab = 'diff'
  await __Z.wait(() => !!__Z.btn('对比'), 5000)
  st.diffA = '第一行\n第二行 旧\n第三行\n第四行'
  st.diffB = '第一行\n第二行 新\n第三行\n第四行\n第五行'
  __Z.btn('对比').click()
  await new Promise(r => setTimeout(r, 300))
  const r = JSON.parse(JSON.stringify(st.diffResult))
  const domLines = document.querySelectorAll('.diff-out .diff-line').length
  __Z.btn('交换').click()
  await new Promise(r2 => setTimeout(r2, 200))
  const swapped = JSON.parse(JSON.stringify(st.diffResult))
  return {
    added: r.added, deleted: r.deleted, changed: r.changed, same: r.same, truncated: r.truncated,
    types: r.lines.map(l => l.type + ':' + (l.aNo ?? '-') + ':' + (l.bNo ?? '-')),
    domLines, swappedChanged: swapped.changed, swappedAdded: swapped.added
  }
})()
