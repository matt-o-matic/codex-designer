import { createApp } from 'vue'
import { createRouter, createWebHashHistory } from 'vue-router'
import App from './App.vue'
import './style.css'

import WorkbenchPage from './pages/WorkbenchPage.vue'

const storedTheme = localStorage.getItem('codex-designer:theme')
if (storedTheme === 'dark') {
  document.documentElement.classList.add('dark')
} else if (storedTheme === 'light') {
  document.documentElement.classList.remove('dark')
} else if (window.matchMedia?.('(prefers-color-scheme: dark)')?.matches) {
  document.documentElement.classList.add('dark')
}

const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    { path: '/', component: WorkbenchPage },
    { path: '/workspace', redirect: '/' },
    { path: '/session', redirect: '/' },
    { path: '/session/:slug', redirect: '/' },
    { path: '/settings', redirect: '/' },
  ],
})

createApp(App).use(router).mount('#app')
