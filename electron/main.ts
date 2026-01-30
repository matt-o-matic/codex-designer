import { app, BrowserWindow, nativeTheme } from 'electron'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { registerIpcHandlers } from './ipc'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

function configureLinuxWayland() {
  if (process.platform !== 'linux') return

  const isWsl =
    typeof process.env.WSL_INTEROP === 'string' ||
    typeof process.env.WSL_DISTRO_NAME === 'string' ||
    typeof process.env.WSLENV === 'string'

  // WSLg provides its Wayland socket under /mnt/wslg/runtime-dir, but some shells set XDG_RUNTIME_DIR
  // to /run/user/<uid>, which prevents Wayland clipboard access (wl-paste) and Wayland Chromium startup.
  if (isWsl) {
    const wslgRuntimeDir = '/mnt/wslg/runtime-dir'
    const display = String(process.env.WAYLAND_DISPLAY || 'wayland-0').trim()
    if (display) {
      const wslgSocket = path.join(wslgRuntimeDir, display)
      if (existsSync(wslgSocket)) {
        const curRuntime = String(process.env.XDG_RUNTIME_DIR || '').trim()
        const curSocket = curRuntime ? path.join(curRuntime, display) : ''
        if (!curSocket || !existsSync(curSocket)) {
          process.env.XDG_RUNTIME_DIR = wslgRuntimeDir
        }
        process.env.WAYLAND_DISPLAY = display
      }
    }
  }

  const hasWayland = typeof process.env.WAYLAND_DISPLAY === 'string' && process.env.WAYLAND_DISPLAY.length > 0
  if (!hasWayland) return

  // Prefer Wayland on WSLg so clipboard image types (e.g. image/bmp) are visible to the app.
  if (!process.env.ELECTRON_OZONE_PLATFORM_HINT) {
    process.env.ELECTRON_OZONE_PLATFORM_HINT = isWsl ? 'wayland' : 'auto'
  }
  if (isWsl && !process.env.ELECTRON_ENABLE_WAYLAND) process.env.ELECTRON_ENABLE_WAYLAND = '1'

  const hint = String(process.env.ELECTRON_OZONE_PLATFORM_HINT ?? '').trim()
  if (hint) app.commandLine.appendSwitch('ozone-platform-hint', hint)
  if (hint === 'wayland') app.commandLine.appendSwitch('ozone-platform', 'wayland')
}

configureLinuxWayland()

process.env.APP_ROOT = path.join(__dirname, '..')
export const VITE_DEV_SERVER_URL = process.env['VITE_DEV_SERVER_URL']
export const MAIN_DIST = path.join(process.env.APP_ROOT, 'dist-electron')
export const RENDERER_DIST = path.join(process.env.APP_ROOT, 'dist')

process.env.VITE_PUBLIC = VITE_DEV_SERVER_URL ? path.join(process.env.APP_ROOT, 'public') : RENDERER_DIST

let mainWindow: BrowserWindow | null = null

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 980,
    minHeight: 680,
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#030712' : '#ffffff',
    title: 'codex-designer',
    webPreferences: {
      preload: path.join(__dirname, 'preload.mjs'),
    },
  })

  if (VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(VITE_DEV_SERVER_URL)
  } else {
    mainWindow.loadFile(path.join(RENDERER_DIST, 'index.html'))
  }
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
    mainWindow = null
  }
})

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createMainWindow()
  }
})

app.whenReady().then(() => {
  createMainWindow()

  app.on('browser-window-created', (_, win) => {
    win.setBackgroundColor(nativeTheme.shouldUseDarkColors ? '#030712' : '#ffffff')
  })
})

// IPC
app.whenReady().then(() => {
  registerIpcHandlers()
})
