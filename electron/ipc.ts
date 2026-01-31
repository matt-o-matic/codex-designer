import { BrowserWindow, app, clipboard, dialog, ipcMain } from 'electron'
import { execFile } from 'node:child_process'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { promisify } from 'node:util'
import { gitCommitAll, gitDiff, gitDiffStat, gitHeadCommit, gitInit, gitStatusPorcelain, isGitRepo } from './lib/git'
import { updateGitignore } from './lib/gitignore'
import { listCodexModels } from './lib/codexModels'
import { CodexRunManager, type StartRunArgs } from './lib/codexRuns'
import { RunLogStore } from './lib/runLogs'
import { writeJsonFileAtomic } from './lib/fs'
import { resolveInside } from './lib/safePath'
import { UserDataStore } from './lib/userDataStore'
import { ensureDocsDir, listFeatures } from './lib/workspace'
import { ensureProfilesFile, workspaceProfilesPath } from './lib/workspaceProfiles'
import {
  ensureWorkspaceDirs,
  readWorkspaceState,
  WorkspaceShareability,
  type WorkspaceRunDefaultsByRole,
  writeWorkspaceState,
} from './lib/workspaceState'

const execFileAsync = promisify(execFile)

async function getWslgWaylandEnv(): Promise<NodeJS.ProcessEnv | null> {
  if (process.platform !== 'linux') return null
  const isWsl =
    typeof process.env.WSL_INTEROP === 'string' ||
    typeof process.env.WSL_DISTRO_NAME === 'string' ||
    typeof process.env.WSLENV === 'string'
  if (!isWsl) return null

  const runtimeDir = '/mnt/wslg/runtime-dir'
  const display = String(process.env.WAYLAND_DISPLAY || 'wayland-0').trim()
  if (!display) return null

  try {
    await fs.stat(path.join(runtimeDir, display))
  } catch {
    return null
  }

  return { ...process.env, XDG_RUNTIME_DIR: runtimeDir, WAYLAND_DISPLAY: display }
}

function sanitizeRunDefaults(input: unknown): WorkspaceRunDefaultsByRole | null {
  if (!input || typeof input !== 'object') return null
  const src = input as any

  const out: WorkspaceRunDefaultsByRole = {}
  const roles: Array<keyof WorkspaceRunDefaultsByRole> = ['planning', 'implementation', 'testing', 'generic', 'newWork']
  const allowedEffort = new Set(['', 'minimal', 'low', 'medium', 'high', 'xhigh'])

  for (const role of roles) {
    const raw = src[role]
    if (!raw || typeof raw !== 'object') continue
    const r = raw as any

    const modelRaw = typeof r.model === 'string' ? r.model : ''
    const model = modelRaw.trim().slice(0, 200)
    const effortRaw = typeof r.modelReasoningEffort === 'string' ? r.modelReasoningEffort : ''
    const modelReasoningEffort = allowedEffort.has(effortRaw) ? effortRaw : ''

    const obj: any = {}
    if (model.length) obj.model = model
    if (modelReasoningEffort.length) obj.modelReasoningEffort = modelReasoningEffort
    if (Object.keys(obj).length) (out as any)[role] = obj
  }

  return Object.keys(out).length ? out : {}
}

export type WorkspaceSummary = {
  path: string
  isGitRepo: boolean
  isGitClean: boolean | null
  headCommit: string | null
  shareability: WorkspaceShareability | null
  features: Awaited<ReturnType<typeof listFeatures>>
}

export function registerIpcHandlers() {
  const userData = new UserDataStore()
  const runs = new CodexRunManager()
  const runLogs = new RunLogStore()

  ipcMain.handle('codex-designer:set-window-title', async (event, title: string): Promise<boolean> => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (!win) return false
    const safe = String(title ?? '').slice(0, 200)
    win.setTitle(safe || 'codex-designer')
    return true
  })

  ipcMain.handle('codex-designer:get-app-state', async () => {
    return userData.read()
  })

  ipcMain.handle('codex-designer:list-models', async () => {
    return listCodexModels({ clientName: 'codex-designer', clientVersion: app.getVersion() })
  })

  ipcMain.handle('codex-designer:get-clipboard-formats', async () => {
    const types: Array<'clipboard' | 'selection'> =
      process.platform === 'linux' ? ['clipboard', 'selection'] : ['clipboard']
    const out = new Set<string>()
    for (const t of types) {
      try {
        const formats = clipboard.availableFormats(t as any) ?? []
        for (const f of formats) out.add(f)
      } catch {
        // ignore
      }
    }

    if (process.platform === 'linux') {
      try {
        const env = (await getWslgWaylandEnv()) ?? undefined
        const res = await execFileAsync('wl-paste', ['-l'], {
          env,
          timeout: 1500,
          maxBuffer: 1024 * 1024,
        })
        const lines = String((res as any).stdout ?? '')
          .split(/\r?\n/g)
          .map((l) => l.trim())
          .filter(Boolean)
        for (const l of lines) out.add(l)
      } catch {
        // ignore (wl-paste may not be installed or WAYLAND_DISPLAY not set)
      }
    }

    return Array.from(out)
  })

  ipcMain.handle('codex-designer:read-clipboard-image-data-url', async (): Promise<string | null> => {
    const types: Array<'clipboard' | 'selection'> =
      process.platform === 'linux' ? ['clipboard', 'selection'] : ['clipboard']

    const toDataUrl = (mime: string, buf: Buffer) => `data:${mime};base64,${buf.toString('base64')}`

    const normalizeMime = (format: string) => {
      const f = String(format ?? '').trim()
      if (/^image\//i.test(f)) return f.toLowerCase()
      if (/png/i.test(f)) return 'image/png'
      if (/jpe?g/i.test(f)) return 'image/jpeg'
      if (/webp/i.test(f)) return 'image/webp'
      if (/gif/i.test(f)) return 'image/gif'
      if (/bmp/i.test(f) || /dib/i.test(f)) return 'image/bmp'
      if (/tiff?/i.test(f)) return 'image/tiff'
      return 'application/octet-stream'
    }

    try {
      // 1) Best effort via nativeImage (works well on most platforms).
      for (const t of types) {
        try {
          const img = clipboard.readImage(t as any)
          if (img && !img.isEmpty()) return img.toDataURL()
        } catch {
          // ignore
        }
      }

      // 2) Fallback via raw buffers for whatever image formats are exposed.
      for (const t of types) {
        let formats: string[] = []
        try {
          formats = clipboard.availableFormats(t as any) ?? []
        } catch {
          formats = []
        }
        const candidates = formats.filter((f) => /^image\//i.test(f) || /(png|jpe?g|webp|gif|bmp|dib|tiff?)/i.test(f))
        for (const fmt of candidates) {
          try {
            const buf = (clipboard as any).readBuffer(fmt, t) as Buffer
            if (!buf || !buf.length) continue
            const mime = normalizeMime(fmt)
            return toDataUrl(mime, buf)
          } catch {
            // ignore
          }
        }
      }

      // 3) Wayland fallback (WSLg often exposes clipboard images only to Wayland clients).
      // If Electron is running under X11, clipboard.availableFormats() can be empty even when wl-paste shows image/*.
      if (process.platform === 'linux') {
        try {
          const env = (await getWslgWaylandEnv()) ?? undefined
          const listed = await execFileAsync('wl-paste', ['-l'], {
            env,
            timeout: 1500,
            maxBuffer: 1024 * 1024,
          })
          const lines = String((listed as any).stdout ?? '')
            .split(/\r?\n/g)
            .map((l) => l.trim())
            .filter(Boolean)
          const images = lines.filter((l) => /^image\//i.test(l)).map((l) => l.toLowerCase())
          if (images.length) {
            const preferred = ['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/bmp', 'image/tiff']
            const chosen = preferred.find((p) => images.includes(p)) ?? images[0]
            const data = await execFileAsync('wl-paste', ['--type', chosen], {
              env,
              timeout: 5000,
              maxBuffer: 100 * 1024 * 1024,
              encoding: 'buffer' as any,
            })
            const buf = (data as any).stdout as Buffer
            if (buf && buf.length) return toDataUrl(chosen, buf)
          }
        } catch {
          // ignore
        }
      }

      return null
    } catch {
      return null
    }
  })

  ipcMain.handle('codex-designer:pick-workspace', async () => {
    const res = await dialog.showOpenDialog({
      properties: ['openDirectory', 'createDirectory'],
      title: 'Select a workspace folder',
    })
    if (res.canceled || res.filePaths.length === 0) return null
    return res.filePaths[0]
  })

  ipcMain.handle('codex-designer:open-workspace', async (_event, workspacePath: string): Promise<WorkspaceSummary> => {
    const stats = await fs.stat(workspacePath)
    if (!stats.isDirectory()) throw new Error('Workspace path is not a directory.')

    await userData.setActiveWorkspace(workspacePath)
    await ensureDocsDir(workspacePath)
    await ensureWorkspaceDirs(workspacePath)
    await ensureProfilesFile(workspacePath)

    const wsState = await readWorkspaceState(workspacePath)
    const shareability = wsState.shareability ?? null

    const gitRepo = await isGitRepo(workspacePath)
    let isClean: boolean | null = null
    let headCommit: string | null = null
    if (gitRepo) {
      isClean = (await gitStatusPorcelain(workspacePath)).trim().length === 0
      headCommit = await gitHeadCommit(workspacePath).catch(() => null)
      await updateGitignore(workspacePath, { ignoreShare: shareability === 'local' })
    }

    return {
      path: workspacePath,
      isGitRepo: gitRepo,
      isGitClean: isClean,
      headCommit,
      shareability,
      features: await listFeatures(workspacePath),
    }
  })

  ipcMain.handle(
    'codex-designer:set-workspace-shareability',
    async (_event, workspacePath: string, shareability: WorkspaceShareability): Promise<WorkspaceSummary> => {
      await ensureWorkspaceDirs(workspacePath)
      const wsState = await readWorkspaceState(workspacePath)
      const nextState = { ...wsState, shareability }
      await writeWorkspaceState(workspacePath, nextState)

      const gitRepo = await isGitRepo(workspacePath)
      let isClean: boolean | null = null
      let headCommit: string | null = null
      if (gitRepo) {
        isClean = (await gitStatusPorcelain(workspacePath)).trim().length === 0
        headCommit = await gitHeadCommit(workspacePath).catch(() => null)
        await updateGitignore(workspacePath, { ignoreShare: shareability === 'local' })
      }

      return {
        path: workspacePath,
        isGitRepo: gitRepo,
        isGitClean: isClean,
        headCommit,
        shareability,
        features: await listFeatures(workspacePath),
      }
    }
  )

  ipcMain.handle('codex-designer:init-git', async (_event, workspacePath: string): Promise<WorkspaceSummary> => {
    await gitInit(workspacePath)

    const wsState = await readWorkspaceState(workspacePath)
    const shareability = wsState.shareability ?? 'local'
    await updateGitignore(workspacePath, { ignoreShare: shareability === 'local' })

    const isClean = (await gitStatusPorcelain(workspacePath)).trim().length === 0
    const headCommit = await gitHeadCommit(workspacePath).catch(() => null)

    return {
      path: workspacePath,
      isGitRepo: true,
      isGitClean: isClean,
      headCommit,
      shareability,
      features: await listFeatures(workspacePath),
    }
  })

  ipcMain.handle('codex-designer:get-workspace-run-defaults', async (_event, workspacePath: string) => {
    await ensureWorkspaceDirs(workspacePath)
    const wsState = await readWorkspaceState(workspacePath)
    return wsState.runDefaults ?? null
  })

  ipcMain.handle(
    'codex-designer:set-workspace-run-defaults',
    async (_event, workspacePath: string, runDefaults: unknown): Promise<boolean> => {
      await ensureWorkspaceDirs(workspacePath)
      const wsState = await readWorkspaceState(workspacePath)
      const next = sanitizeRunDefaults(runDefaults)
      const merged = { ...wsState, runDefaults: next ?? undefined }
      await writeWorkspaceState(workspacePath, merged)
      return true
    }
  )

  ipcMain.handle('codex-designer:export-profiles', async (_event, workspacePath: string): Promise<string | null> => {
    const raw = await fs.readFile(workspaceProfilesPath(workspacePath), 'utf-8')
    const res = await dialog.showSaveDialog({
      title: 'Export profiles.json',
      defaultPath: path.join(workspacePath, 'profiles.json'),
      filters: [{ name: 'JSON', extensions: ['json'] }],
    })
    if (res.canceled || !res.filePath) return null
    await fs.writeFile(res.filePath, raw, 'utf-8')
    return res.filePath
  })

  ipcMain.handle('codex-designer:import-profiles', async (_event, workspacePath: string): Promise<string | null> => {
    const res = await dialog.showOpenDialog({
      title: 'Import profiles.json',
      properties: ['openFile'],
      filters: [{ name: 'JSON', extensions: ['json'] }],
    })
    if (res.canceled || res.filePaths.length === 0) return null

    const srcPath = res.filePaths[0]
    const raw = await fs.readFile(srcPath, 'utf-8')
    let parsed: any
    try {
      parsed = JSON.parse(raw)
    } catch {
      throw new Error('Invalid JSON file.')
    }

    if (!parsed || parsed.version !== 1 || !Array.isArray(parsed.profiles)) {
      throw new Error('Invalid profiles file (expected version: 1).')
    }

    parsed.updatedAt = new Date().toISOString()
    await writeJsonFileAtomic(workspaceProfilesPath(workspacePath), parsed)
    return srcPath
  })

  ipcMain.handle('codex-designer:start-run', async (event, args: StartRunArgs): Promise<{ runId: string }> => {
    const sender = event.sender
    let runId: string | null = null
    let loggerReady = false
    const bufferedThread: Array<unknown> = []
    const bufferedLog: Array<unknown> = []

    const started = runs.startRun(args, (evt) => {
      if (loggerReady && runId) {
        runLogs.append(runId, evt)
      } else {
        bufferedLog.push(evt)
      }

      if (typeof evt === 'object' && evt && 'type' in evt && String((evt as any).type).startsWith('run.')) {
        sender.send('codex-designer:run-event', { runId: (evt as any).runId, event: evt })
        return
      }
      if (!runId) {
        bufferedThread.push(evt)
        return
      }
      sender.send('codex-designer:run-event', { runId, event: evt })
    })

    runId = started.runId

    await runLogs.startRun(runId, args)
    loggerReady = true
    for (const evt of bufferedLog) runLogs.append(runId, evt)
    void runLogs.prune(200)

    for (const evt of bufferedThread) {
      sender.send('codex-designer:run-event', { runId, event: evt })
    }
    return started
  })

  ipcMain.handle('codex-designer:abort-run', async (_event, runId: string) => {
    runs.abortRun(runId)
  })

  ipcMain.handle(
    'codex-designer:read-text-file',
    async (_event, args: { workspacePath: string; relPath: string }) => {
      const abs = resolveInside(args.workspacePath, args.relPath)
      return fs.readFile(abs, 'utf-8')
    }
  )

  ipcMain.handle(
    'codex-designer:write-text-file',
    async (_event, args: { workspacePath: string; relPath: string; content: string }) => {
      const abs = resolveInside(args.workspacePath, args.relPath)
      await fs.mkdir(path.dirname(abs), { recursive: true })
      await fs.writeFile(abs, args.content, 'utf-8')
      return true
    }
  )

  ipcMain.handle(
    'codex-designer:save-attachment',
    async (
      _event,
      args: { workspacePath: string; featureSlug: string; ext: string; bytesBase64: string }
    ): Promise<{ relPath: string }> => {
      const safeExt = args.ext.replace(/[^a-zA-Z0-9]/g, '').toLowerCase() || 'bin'
      const dirRel = path.join('docs', 'assets', args.featureSlug)
      const dirAbs = resolveInside(args.workspacePath, dirRel)
      await fs.mkdir(dirAbs, { recursive: true })

      const stamp = new Date().toISOString().replace(/[:.]/g, '-')
      const name = `${stamp}-${Math.random().toString(16).slice(2)}.${safeExt}`
      const relPath = path.join(dirRel, name)
      const absPath = resolveInside(args.workspacePath, relPath)

      const buf = Buffer.from(args.bytesBase64, 'base64')
      await fs.writeFile(absPath, buf)
      return { relPath }
    }
  )

  ipcMain.handle(
    'codex-designer:read-attachment-data-url',
    async (_event, args: { workspacePath: string; relPath: string }): Promise<string> => {
      const abs = resolveInside(args.workspacePath, args.relPath)
      const buf = await fs.readFile(abs)
      const ext = path.extname(args.relPath).replace('.', '').toLowerCase()
      const mime =
        ext === 'png'
          ? 'image/png'
          : ext === 'jpg' || ext === 'jpeg'
            ? 'image/jpeg'
            : ext === 'gif'
              ? 'image/gif'
              : ext === 'webp'
                ? 'image/webp'
                : ext === 'bmp'
                  ? 'image/bmp'
                  : ext === 'tif' || ext === 'tiff'
                    ? 'image/tiff'
                    : ext === 'avif'
                      ? 'image/avif'
                      : ext === 'heic'
                        ? 'image/heic'
                        : 'application/octet-stream'
      return `data:${mime};base64,${buf.toString('base64')}`
    }
  )

  ipcMain.handle(
    'codex-designer:delete-attachment',
    async (_event, args: { workspacePath: string; relPath: string }): Promise<boolean> => {
      const rel = String(args.relPath ?? '').replace(/\\/g, '/')
      if (!rel.startsWith('docs/assets/')) throw new Error('Only attachments under docs/assets/ can be deleted.')

      const abs = resolveInside(args.workspacePath, args.relPath)
      const st = await fs.stat(abs).catch(() => null)
      if (!st) return true
      if (st.isDirectory()) throw new Error('Refusing to delete a directory.')
      await fs.rm(abs, { force: true })
      return true
    }
  )

  ipcMain.handle(
    'codex-designer:get-git-diff-stat',
    async (_event, args: { workspacePath: string; fromCommit: string }): Promise<string> => {
      return gitDiffStat(args.workspacePath, `${args.fromCommit}..HEAD`)
    }
  )

  ipcMain.handle(
    'codex-designer:get-git-diff',
    async (_event, args: { workspacePath: string; fromCommit: string }): Promise<string> => {
      return gitDiff(args.workspacePath, `${args.fromCommit}..HEAD`)
    }
  )

  ipcMain.handle(
    'codex-designer:git-commit-all',
    async (
      _event,
      args: { workspacePath: string; message: string }
    ): Promise<{ commit: string; stdout: string; stderr: string }> => {
      return gitCommitAll(args.workspacePath, args.message)
    }
  )

  ipcMain.handle(
    'codex-designer:list-run-logs',
    async (_event, args: { workspacePath?: string; featureSlug?: string } | undefined) => {
      return runLogs.listRunLogs(args)
    }
  )

  ipcMain.handle('codex-designer:read-run-log', async (_event, args: { runId: string; limit?: number }) => {
    return runLogs.readRunLog(args.runId, { limit: args.limit })
  })
}
