import { createApp } from 'vue'
import ElementPlus from 'element-plus'
import zhCn from 'element-plus/es/locale/lang/zh-cn'
import 'element-plus/dist/index.css'
import App from './App.vue'
import router from './router'
import './styles/app.css'

// 拖拽文件落在非拖拽区时，浏览器默认会导航到 file://，整个应用被替换。
// 在 window 层统一拦截，只有显式声明的拖拽区会自行处理 drop。
window.addEventListener('dragover', e => e.preventDefault())
window.addEventListener('drop', e => e.preventDefault())

createApp(App).use(router).use(ElementPlus, { locale: zhCn, size: 'small' }).mount('#app')
