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
    { path: '/dashboard', redirect: '/' },
    { path: '/dashboard/', redirect: '/' },
    { path: '/login', redirect: '/' },
    { path: '/logout', redirect: '/' },
    { path: '/sign-in', redirect: '/' },
    { path: '/signout', redirect: '/' },
    { path: '/signin', redirect: '/' },
    { path: '/auth', redirect: '/' },
    { path: '/auth/logout', redirect: '/' },
    { path: '/auth/login', redirect: '/' },
    { path: '/workspace', redirect: '/' },
    { path: '/session', redirect: '/' },
    { path: '/session/:slug', redirect: '/' },
    { path: '/settings', redirect: '/' },
    { path: '/:pathMatch(.*)*', redirect: '/' },
  ],
})

const normaliseRouteLikePath = (value: unknown): string => {
  const raw = String(value ?? '')
  const [pathOnly] = raw.split('?')
  return String(pathOnly ?? '/')
    .split('#')[0]
    .trim()
    .replace(/\/{2,}/g, '/')
    .replace(/\/+$/, '') || '/'
}

function isLikelyAuthLogoutDestination(pathValue: string): boolean {
  const path = normaliseRouteLikePath(pathValue).toLowerCase()
  return (
    path === '/dashboard' ||
    path === '/login' ||
    path === '/logout' ||
    path === '/sign-in' ||
    path === '/signin' ||
    path === '/signout' ||
    path === '/auth' ||
    path === '/auth/logout' ||
    path === '/auth/login' ||
    path.startsWith('/dashboard/')
  )
}

router.beforeEach((to) => {
  const path = normaliseRouteLikePath(to.fullPath)
  if (!isLikelyAuthLogoutDestination(path)) return
  return '/'
})

router.onError((error, to) => {
  const nextPath = typeof to?.fullPath === 'string' ? to.fullPath : String(to)
  const message = String(error?.message ?? error ?? '')
  if (!message.includes('Invalid navigation guard')) return

  console.error('Invalid navigation guard, redirecting to home:', {
    to: nextPath,
    error: message,
  })

  if (nextPath === '/') return
  void router.replace('/').catch(() => {
    // ignore to avoid recursive error loops while recovering
  })
})

createApp(App).use(router).mount('#app')
