import { app } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import { logMain } from './log'

/**
 * FreeTool → 兰台 改名的数据迁移：新 userData 缺关键文件时，
 * 从旧目录（打包版 %APPDATA%\FreeTool、开发版 %APPDATA%\freetool）整份复制过来。
 * 只复制不删除，旧数据保留；任何一步失败都不阻塞启动。
 */

const CARRY_FILES = ['settings.json', 'history.json', 'window-state.json']
const LEGACY_DIRS = ['FreeTool', 'freetool']

export function migrateLegacyUserData(): void {
  const target = app.getPath('userData')
  const appData = app.getPath('appData')
  for (const file of CARRY_FILES) {
    const dst = path.join(target, file)
    if (fs.existsSync(dst)) continue
    for (const legacy of LEGACY_DIRS) {
      const src = path.join(appData, legacy, file)
      try {
        if (!fs.existsSync(src)) continue
        fs.mkdirSync(target, { recursive: true })
        fs.copyFileSync(src, dst)
        logMain('info', `改名迁移：${legacy}/${file} → userData/${file}`)
        break
      } catch {
        /* 迁移失败不影响使用，新目录会走默认值 */
      }
    }
  }
}
