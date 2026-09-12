import type { ReplaceTextParams } from '@shared/types'
import { handle } from './wrapper'
import { runTracked } from '../services/taskProgress'
import { replaceText } from '../services/replaceService'

handle('replace:run', p => runTracked('批量查找替换', p.paths.length, ctx => replaceText(p, ctx.progress, ctx.isCancelled)))
