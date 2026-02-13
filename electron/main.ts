import { app, BrowserWindow, nativeTheme } from 'electron'
import { closeSync, existsSync, openSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { registerIpcHandlers } from './ipc'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

const isLinux = process.platform === 'linux'
const isWsl =
  isLinux &&
  (typeof process.env.WSL_INTEROP === 'string' ||
    typeof process.env.WSL_DISTRO_NAME === 'string' ||
    typeof process.env.WSLENV === 'string')

function hasUsableDriRenderNode(): boolean {
  if (!isLinux) return true

  const driDir = '/dev/dri'
  if (!existsSync(driDir)) return false

  try {
    const candidates = readdirSync(driDir).filter((n) => /^renderD\\d+$/i.test(String(n)))
    for (const n of candidates) {
      const p = path.join(driDir, n)
      try {
        const fd = openSync(p, 'r+')
        closeSync(fd)
        return true
      } catch {
        // ignore and try next node
      }
    }
  } catch {
    return false
  }

  return false
}

function shouldDisableGpu(): boolean {
  if (!isLinux) return false

  const forced = process.env.CODEX_DESIGNER_DISABLE_GPU
  if (forced === '1') return true
  if (forced === '0') return false

  const isDev = Boolean(process.env.VITE_DEV_SERVER_URL)
  const driOk = hasUsableDriRenderNode()

  // Defaults:
  // - dev/Linux: prefer stability over GPU flakiness
  // - WSL: EGL/DRI permissions frequently fail (blank/white window)
  // - no usable render node: fall back to software
  return isDev || isWsl || !driOk
}

function configureGpuFallback() {
  if (!shouldDisableGpu()) return

  // Some Linux environments (VMs/remote desktops/WSL) intermittently fail GPU init,
  // resulting in a blank/white window even though the renderer is running.
  app.disableHardwareAcceleration()
  app.commandLine.appendSwitch('disable-gpu')
  app.commandLine.appendSwitch('disable-gpu-compositing')
  app.commandLine.appendSwitch('use-gl', 'swiftshader')
}

function configureLinuxWayland() {
  if (process.platform !== 'linux') return

  // Some WSLg setups render a blank window with Ozone/Wayland; allow an escape hatch.
  // Prefer X11 when the user requests it or when GPU is disabled (often correlated with WSLg flakiness).
  const forceX11 = process.env.CODEX_DESIGNER_FORCE_X11 === '1' || (isWsl && shouldDisableGpu())
  if (forceX11) {
    if (!process.env.ELECTRON_OZONE_PLATFORM_HINT) process.env.ELECTRON_OZONE_PLATFORM_HINT = 'x11'
    const hint = String(process.env.ELECTRON_OZONE_PLATFORM_HINT ?? '').trim()
    if (hint) app.commandLine.appendSwitch('ozone-platform-hint', hint)
    if (hint === 'x11') app.commandLine.appendSwitch('ozone-platform', 'x11')
    return
  }

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
configureGpuFallback()

process.env.APP_ROOT = path.join(__dirname, '..')
export const VITE_DEV_SERVER_URL = process.env['VITE_DEV_SERVER_URL']
export const MAIN_DIST = path.join(process.env.APP_ROOT, 'dist-electron')
export const RENDERER_DIST = path.join(process.env.APP_ROOT, 'dist')

process.env.VITE_PUBLIC = VITE_DEV_SERVER_URL ? path.join(process.env.APP_ROOT, 'public') : RENDERER_DIST

let mainWindow: BrowserWindow | null = null

function resolveRendererIconPath(): string | null {
  const base = String(process.env.VITE_PUBLIC || '').trim()
  if (!base) return null
  const iconPath = path.join(base, 'icon.png')
  return existsSync(iconPath) ? iconPath : null
}

function createMainWindow() {
  const isDev = Boolean(VITE_DEV_SERVER_URL)
  const iconPath = resolveRendererIconPath()

  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 980,
    minHeight: 680,
    icon: iconPath ?? undefined,
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#030712' : '#ffffff',
    title: 'codex-designer',
    webPreferences: {
      preload: path.join(__dirname, 'preload.mjs'),
    },
  })

  if (isDev) {
    mainWindow.webContents.on('did-fail-load', (_evt, errorCode, errorDescription, validatedURL) => {
      console.error('[renderer] did-fail-load', { errorCode, errorDescription, validatedURL })
    })
    mainWindow.webContents.on('render-process-gone', (_evt, details) => {
      console.error('[renderer] render-process-gone', details)
    })
    mainWindow.webContents.on('unresponsive', () => {
      console.error('[renderer] unresponsive')
    })
    mainWindow.webContents.on('responsive', () => {
      console.error('[renderer] responsive')
    })
    mainWindow.webContents.on('did-finish-load', () => {
      console.error('[renderer] did-finish-load')
    })
    mainWindow.webContents.on('console-message', (_event, level, message, line, sourceId) => {
      console.error('[renderer] console', { level, message, line, sourceId })
    })

    const openDevtools = process.env.CODEX_DESIGNER_DEVTOOLS !== '0'
    if (openDevtools) {
      mainWindow.webContents.once('dom-ready', () => {
        console.error('[renderer] dom-ready; opening devtools')
        mainWindow?.webContents.openDevTools({ mode: 'detach' })
      })
    }
  }

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
  // Register IPC before creating the window so the renderer can invoke APIs immediately.
  registerIpcHandlers()

  const iconPath = resolveRendererIconPath()
  if (iconPath && process.platform === 'darwin') {
    try {
      app.dock?.setIcon(iconPath)
    } catch {
      // ignore
    }
  }

  createMainWindow()

  app.on('browser-window-created', (_, win) => {
    win.setBackgroundColor(nativeTheme.shouldUseDarkColors ? '#030712' : '#ffffff')
  })
})
