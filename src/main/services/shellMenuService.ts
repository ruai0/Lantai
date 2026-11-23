/**
 * 资源管理器右键菜单：选中文件后直接交给兰台处理，省掉"打开应用→选工具→再选文件"。
 *
 * 写在 HKCU\Software\Classes\*\shell 下，**当前用户范围、不需要管理员权限**，
 * 也不碰系统级 HKCR，卸载时删干净即可。注册表操作用 Windows 自带的 reg.exe，
 * 不额外引依赖。
 *
 * 只有打包后的 exe 才能注册：开发模式下 process.execPath 是 electron.exe，
 * 注册进去点了会打开一个空 Electron，反而添乱。
 */
import { execFile } from 'node:child_process'
import { app } from 'electron'
import { promisify } from 'node:util'

const run = promisify(execFile)

/** 右键菜单的根键；用产品名做命名空间，避免和别的工具撞 */
const ROOT = 'HKCU\\Software\\Classes\\*\\shell\\Lantai'

export type ShellAction = 'open' | 'to-pdf' | 'pdf-to-images' | 'pdf-compress' | 'pdf-text'

interface MenuItem {
  key: string
  label: string
  action: ShellAction
}

/** 子菜单项：前四项是日常最常走的转换，最后一项兜底打开主界面 */
const ITEMS: MenuItem[] = [
  { key: 'to-pdf', label: '转换为 PDF', action: 'to-pdf' },
  { key: 'pdf-to-images', label: 'PDF 转图片', action: 'pdf-to-images' },
  { key: 'pdf-compress', label: 'PDF 压缩', action: 'pdf-compress' },
  { key: 'pdf-text', label: '提取文字', action: 'pdf-text' },
  { key: 'open', label: '打开兰台', action: 'open' }
]

async function reg(args: string[]): Promise<void> {
  await run('reg', args, { windowsHide: true })
}

/** 注册表值里反斜杠与引号要原样保留，reg 的 /d 参数用双引号包住整串即可 */
const q = (s: string): string => `"${s}"`

export interface ShellMenuStatus {
  /** 能否安装（打包后才行） */
  supported: boolean
  installed: boolean
  /** 不支持时的原因，供界面提示 */
  reason?: string
}

/**
 * 查询是否已安装。
 * 只看 reg 的**退出码**（键存在=0，不存在=1），不解析输出文本——
 * reg.exe 的输出是系统 ANSI 代码页（中文 Windows 为 GBK），Node 按 UTF-8 解码会成乱码，
 * 用中文字面量匹配必然失败，会把"已安装"误判成"未安装"。
 */
export async function shellMenuStatus(): Promise<ShellMenuStatus> {
  if (process.platform !== 'win32') {
    return { supported: false, installed: false, reason: '仅 Windows 支持资源管理器右键菜单' }
  }
  if (!app.isPackaged) {
    return { supported: false, installed: false, reason: '开发模式下不注册（会指向 electron.exe），打包安装后可用' }
  }
  try {
    await run('reg', ['query', ROOT], { windowsHide: true })
    return { supported: true, installed: true }
  } catch {
    return { supported: true, installed: false }
  }
}

/** 安装/更新右键菜单（可重复执行，幂等） */
export async function installShellMenu(): Promise<ShellMenuStatus> {
  const status = await shellMenuStatus()
  if (!status.supported) throw new Error(status.reason ?? '当前环境不支持右键菜单')

  const exe = process.execPath
  // 根键：显示名 + 图标 + 声明用子键承载子菜单
  await reg(['add', ROOT, '/ve', '/d', '兰台', '/f'])
  await reg(['add', ROOT, '/v', 'Icon', '/d', q(exe), '/f'])
  // Player = 支持多选（选中多个文件时一次调用，命令行会带多个路径）
  await reg(['add', ROOT, '/v', 'MultiSelectModel', '/d', 'Player', '/f'])
  // 有子键时 reg 需要 SubCommands 为空串，才会展开为级联菜单
  await reg(['add', ROOT, '/v', 'SubCommands', '/d', '', '/f'])

  for (const item of ITEMS) {
    const sub = `${ROOT}\\shell\\${item.key}`
    await reg(['add', sub, '/ve', '/d', item.label, '/f'])
    await reg(['add', sub, '/v', 'Icon', '/d', q(exe), '/f'])
    // %1 在 MultiSelectModel=Player 下会被替换为全部选中文件
    await reg([
      'add',
      `${sub}\\command`,
      '/ve',
      '/d',
      q(`"${exe}" --shell-action=${item.action} "%1"`),
      '/f'
    ])
  }
  return shellMenuStatus()
}

/** 卸载：整棵子树删掉（reg delete 需要 /f 免交互） */
export async function uninstallShellMenu(): Promise<ShellMenuStatus> {
  try {
    await reg(['delete', ROOT, '/f'])
  } catch {
    // 本来就没装，忽略
  }
  return shellMenuStatus()
}

/* ---------- 从资源管理器唤起时的启动意图 ---------- */

export interface ShellIntent {
  action: ShellAction
  files: string[]
}

/**
 * 解析启动参数：`--shell-action=to-pdf "C:\a.docx" "C:\b.docx"`。
 * 双击图标正常启动时不带这些参数，返回 null。
 *
 * 注意 argv[0] 是 exe 自身路径（如 I:\tools\lantai\Lantai.exe），必须跳过——
 * 否则它会被当成一个待处理文件塞进列表。second-instance 的 argv 同样以 exe 开头。
 */
export function parseShellIntent(argv: string[]): ShellIntent | null {
  const actionArg = argv.find(a => a.startsWith('--shell-action='))
  if (!actionArg) return null
  const action = actionArg.slice('--shell-action='.length) as ShellAction
  const known: ShellAction[] = ['open', 'to-pdf', 'pdf-to-images', 'pdf-compress', 'pdf-text']
  if (!known.includes(action)) return null
  const files = argv
    .slice(1) // 跳过 exe 自身路径
    .filter(a => !a.startsWith('-')) // 排除 Electron 与自定义开关
    .filter(a => /[\\/]/.test(a) && !/\.exe$/i.test(a)) // 必须像路径，且不是可执行文件
  return { action, files }
}
