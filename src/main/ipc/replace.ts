import type { ReplaceTextParams } from '@shared/types'
import { handle } from './wrapper'
import { replaceText } from '../services/replaceService'

handle('replace:run', (p: ReplaceTextParams) => replaceText(p))
