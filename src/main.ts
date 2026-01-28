import { createApp } from 'vue'
import { createRouter, createWebHashHistory } from 'vue-router'
import App from './App.vue'
import './style.css'

import WorkspacePage from './pages/WorkspacePage.vue'
import SessionPage from './pages/SessionPage.vue'
import SettingsPage from './pages/SettingsPage.vue'

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
    { path: '/', redirect: '/workspace' },
    { path: '/workspace', component: WorkspacePage },
    { path: '/session', component: SessionPage },
    { path: '/session/:slug', component: SessionPage },
    { path: '/settings', component: SettingsPage },
  ],
})

createApp(App).use(router).mount('#app')
