import type { TaskSnapshot } from '@shared/types'
import { handle } from './wrapper'
import { activeTaskList, cancelTask } from '../services/taskProgress'

/** 任务坞：列出进行中/刚结束的任务 + 请求取消（文件边界生效） */
handle('task:cancel', (p: { id: number }): boolean => cancelTask(p.id))
handle('task:list', (): TaskSnapshot[] => activeTaskList())
