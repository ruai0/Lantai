import { createApp } from 'vue'
import ElementPlus from 'element-plus'
import zhCn from 'element-plus/es/locale/lang/zh-cn'
import 'element-plus/dist/index.css'
import App from './App.vue'
import router from './router'
import './styles/app.css'
import { initSettings } from './utils/settings'

// 拖拽文件落在非拖拽区时，浏览器默认会导航到 file://，整个应用被替换。
// 在 window 层统一拦截，只有显式声明的拖拽区会自行处理 drop。
window.addEventListener('dragover', e => e.preventDefault())
window.addEventListener('drop', e => e.preventDefault())

// 立即挂载，保证应用尽早可交互；偏好加载后异步应用主题/默认目录。
// 默认 :root 即浅色，深色用户仅在启动瞬间偏亮，无功能闪烁。
createApp(App).use(router).use(ElementPlus, { locale: zhCn, size: 'small' }).mount('#app')
void initSettings()
