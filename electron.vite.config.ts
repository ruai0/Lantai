import { resolve } from 'node:path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import vue from '@vitejs/plugin-vue'

const shared = resolve(__dirname, 'src/shared')

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    resolve: { alias: { '@shared': shared } }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    resolve: { alias: { '@shared': shared } }
  },
  renderer: {
    plugins: [vue()],
    // FT_TEST_HOOKS=1 时暴露组件实例（__vueParentComponent）供 scripts/cdp.mjs 驱动 UI 冒烟测试；
    // 正式构建不带此环境变量，产物不含该钩子。
    define: process.env.FT_TEST_HOOKS ? { __VUE_PROD_DEVTOOLS__: true } : {},
    resolve: { alias: { '@shared': shared } }
  }
})
