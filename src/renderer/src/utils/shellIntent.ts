/**
 * 从资源管理器右键菜单唤起的文件暂存区。
 *
 * 为什么不直接塞给某个组件的 props：唤起动作可能落到不同路由（转 PDF 去 /office、
 * PDF 相关去 /pdf），路由切换与组件挂载时机不一致，用模块级 ref 做交接最省事。
 * 消费方取走即清空，避免下次进页面又莫名多出一批文件。
 */
import { ref } from 'vue'

/** 右键菜单动作 → 目标路由 */
export const SHELL_ACTION_ROUTE: Record<string, string> = {
  open: '/',
  'to-pdf': '/convert', // Office 转 PDF（不是 /office 的模板填充）
  'pdf-to-images': '/pdf',
  'pdf-compress': '/pdf',
  'pdf-text': '/pdf'
}

/** 待处理文件（右键菜单带进来的） */
const shellFiles = ref<string[]>([])

export function useShellFiles() {
  /** 取走并清空；调用方负责把文件填进自己的选择列表 */
  function take(): string[] {
    const files = shellFiles.value
    shellFiles.value = []
    return files
  }
  /** 只看不取（调试/提示用） */
  function peek(): string[] {
    return shellFiles.value
  }
  return { shellFiles, take, peek }
}
