(async () => {
  const info = { hash: location.hash, hasVue: false, keys: null }
  for (const el of document.querySelectorAll('*')) {
    const c = el.__vueParentComponent
    if (c) {
      info.hasVue = true
      let cur = c, depth = 0
      while (cur && depth < 30) {
        try {
          if (cur.setupState && 'orgFiles' in cur.setupState) { info.foundOrg = true; break }
        } catch {}
        cur = cur.parent; depth++
      }
      break
    }
  }
  return info
})()
