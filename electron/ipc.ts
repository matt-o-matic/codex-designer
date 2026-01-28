import { dialog, ipcMain } from 'electron'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { gitCommitAll, gitDiff, gitDiffStat, gitHeadCommit, gitInit, gitStatusPorcelain, isGitRepo } from './lib/git'
import { updateGitignore } from './lib/gitignore'
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
  writeWorkspaceState,
} from './lib/workspaceState'

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

  ipcMain.handle('codex-designer:get-app-state', async () => {
    return userData.read()
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
