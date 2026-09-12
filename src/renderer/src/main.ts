import { createApp } from 'vue'
import ElementPlus from 'element-plus'
import { ElMessage } from 'element-plus'
import zhCn from 'element-plus/es/locale/lang/zh-cn'
import 'element-plus/dist/index.css'
import App from './App.vue'
import router from './router'
import './styles/app.css'
import { initSettings } from './utils/settings'
import { api } from './utils/ipc'

// 拖拽文件落在非拖拽区时，浏览器默认会导航到 file://，整个应用被替换。
// 在 window 层统一拦截，只有显式声明的拖拽区会自行处理 drop。
window.addEventListener('dragover', e => e.preventDefault())
window.addEventListener('drop', e => e.preventDefault())

// 全局错误兜底：任何未捕获错误都落主进程日志并给用户一句人话提示（3 秒节流防刷屏）。
let lastToastAt = 0
function reportError(where: string, err: unknown): void {
  const msg = err instanceof Error ? err.message : String(err)
  void api.logError({ where, message: err instanceof Error ? `${msg}\n${err.stack ?? ''}` : msg })
  const now = Date.now()
  if (now - lastToastAt > 3000) {
    lastToastAt = now
    ElMessage.error(`出了点问题：${msg.slice(0, 120)}`)
  }
}
window.addEventListener('error', e => reportError('window', e.error ?? e.message))
window.addEventListener('unhandledrejection', e => reportError('promise', e.reason))

// 立即挂载，保证应用尽早可交互；偏好加载后异步应用主题/默认目录。
// 默认 :root 即浅色，深色用户仅在启动瞬间偏亮，无功能闪烁。
const app = createApp(App)
app.config.errorHandler = (err, _instance, info) => reportError(`vue:${info}`, err)
app.use(router).use(ElementPlus, { locale: zhCn, size: 'small' }).mount('#app')
void initSettings()
