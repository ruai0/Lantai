import { createRouter, createWebHashHistory } from 'vue-router'

const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    { path: '/', name: 'home', component: () => import('../views/HomeView.vue') },
    { path: '/pdf', name: 'pdf', component: () => import('../views/PdfView.vue') },
    { path: '/image', name: 'image', component: () => import('../views/ImageView.vue') },
    { path: '/excel', name: 'excel', component: () => import('../views/ExcelView.vue') },
    { path: '/match', name: 'match', component: () => import('../views/MatchView.vue') },
    { path: '/convert', name: 'convert', component: () => import('../views/ConvertView.vue') },
    { path: '/office', name: 'office', component: () => import('../views/OfficeView.vue') },
    { path: '/replace', name: 'replace', component: () => import('../views/ReplaceView.vue') },
    { path: '/rename', name: 'rename', component: () => import('../views/RenameView.vue') },
    { path: '/filekit', name: 'filekit', component: () => import('../views/FileKitView.vue') },
    { path: '/tools', name: 'tools', component: () => import('../views/ToolsView.vue') },
    { path: '/settings', name: 'settings', component: () => import('../views/SettingsView.vue') }
  ]
})

export default router
