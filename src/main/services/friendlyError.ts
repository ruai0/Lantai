/**
 * 把 Node / 系统的原始错误翻译成「人话 + 怎么办」。
 *
 * 为什么需要这一层：IPC 统一包装里原本直接把 `err.message` 抛给界面，
 * 而 Node 的报错长这样——
 *   EBUSY: resource busy or locked, open 'D:\报送\通知.docx'
 *   ENOSPC: no space left on device, write
 *   ENOENT: no such file or directory, open 'D:\台账.xlsx'
 * 机关用户看到这些只会一脸茫然，然后来问「点了一下就报错了」。
 *
 * 原则：
 * 1. 已经是中文的业务错误（我们自己在服务里 throw 的）原样返回，不要二次包装；
 * 2. 认得的 errno 码翻成「发生了什么 + 你该怎么做」，并带上文件名；
 * 3. 认不得的保留原文，但加一句提示去日志看详情——总比吞掉好。
 */

/** Node 的 fs 错误带 code / path / syscall */
interface NodeFsError extends Error {
  code?: string
  path?: string
  syscall?: string
}

/** 从错误里取文件名（只取末段，整条长路径塞进提示反而更难读） */
function baseName(p?: string): string {
  if (!p) return ''
  const i = Math.max(p.lastIndexOf('\\'), p.lastIndexOf('/'))
  return i >= 0 ? p.slice(i + 1) : p
}

/** 判断是不是我们自己的中文业务错误（含 CJK 就认为已经可读） */
function looksHumanReadable(msg: string): boolean {
  return /[\u4e00-\u9fa5]/.test(msg)
}

export function toFriendlyMessage(err: unknown): string {
  const e = (err instanceof Error ? err : new Error(String(err))) as NodeFsError
  const raw = e.message ?? String(err)
  const name = baseName(e.path)

  const code = e.code ?? ''
  const at = name ? `「${name}」` : '该文件'

  // 有 errno 码就先按码翻译。
  // 不能先判断"含中文就算可读"——路径里带中文是常态
  // （EBUSY: ... open 'D:\报送\通知.docx' 会被误判成已经可读而原样透出）。
  if (code) {
    switch (code) {
      case 'EBUSY':
      case 'EPERM':
        // Windows 上 EBUSY 绝大多数是 Office/WPS 正开着这个文件
        return `${at}正被其他程序占用（通常是 Word / Excel / WPS 还开着它）。请关闭后重试。`
      case 'EACCES':
        return `没有权限访问${at}。请确认它不是只读，或换一个有写入权限的输出文件夹。`
      case 'ENOENT':
        return `找不到${at}，它可能已被移动、改名或删除。请重新选择文件。`
      case 'ENOSPC':
        return '磁盘空间不足，无法写入。请清理输出盘空间后重试。'
      case 'ENAMETOOLONG':
        return '文件路径太长（Windows 一般限制 260 个字符）。请把文件移到层级更浅的文件夹，或缩短文件名。'
      case 'EMFILE':
      case 'ENFILE':
        return '同时打开的文件过多。请稍等片刻再试，或分批处理。'
      case 'EISDIR':
        return `${at}是一个文件夹，不是文件。请选择文件。`
      case 'ENOTDIR':
        return '路径中有一段不是文件夹。请检查路径是否正确。'
      case 'EROFS':
        return '目标是只读位置（如光盘或受保护目录），无法写入。请换一个输出文件夹。'
      case 'EEXIST':
        return `${at}已存在。为避免覆盖，请换一个输出文件名。`
      case 'EPIPE':
      case 'ECONNRESET':
        return '与外部程序的连接中断了。请重试；若反复出现，请重启应用。'
      default:
        break
    }
  }

  // 没有 errno 码、且本身已是中文：这是我们自己在服务里写的业务提示，直接用
  if (looksHumanReadable(raw)) return raw

  // Office COM 转换的典型失败：本机没装 Office/WPS，或文档损坏
  if (/ActiveX|COM|CreateObject|Word\.Application|Excel\.Application/i.test(raw)) {
    return '调用本机 Office / WPS 失败。请确认已安装 Office 或 WPS，并尝试先用它单独打开该文件看是否正常。'
  }
  // 加密 PDF 的提示已经足够清楚，但英文版的要转一下
  if (/encrypted|password/i.test(raw)) {
    return `${at}已加密，需要先解密才能处理。`
  }

  // 认不得的：保留原文，但别让用户以为只能干瞪眼
  return `${raw}（详细信息已记录到日志，可在「设置 → 关于」里查看）`
}
