import { contextBridge, ipcRenderer } from 'electron'

type PickWorkspaceResult = string | null

type AppState = {
  version: 1
  activeWorkspacePath?: string
  recentWorkspacePaths: string[]
}

type WorkspaceSummary = {
  path: string
  isGitRepo: boolean
  isGitClean: boolean | null
  headCommit: string | null
  shareability: 'local' | 'shareable' | null
  features: {
    slug: string
    docsDir: string
    planPath: string
    qnaPath: string
    implPath: string
    testJsonPath: string
    testMdPath: string
    assetsDir: string
    updatedAtMs: number | null
  }[]
}

type WorkspaceRunDefaults = {
  model?: string
  modelReasoningEffort?: 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | ''
}

type WorkspaceRunDefaultsByRole = {
  planning?: WorkspaceRunDefaults
  implementation?: WorkspaceRunDefaults
  testing?: WorkspaceRunDefaults
  generic?: WorkspaceRunDefaults
  newWork?: WorkspaceRunDefaults
}

type StartRunArgs = {
  workspacePath: string
  featureSlug?: string
  role: 'planning' | 'implementation' | 'testing' | 'generic'
  profileId: 'careful' | 'yolo'
  model?: string
  modelReasoningEffort?: 'minimal' | 'low' | 'medium' | 'high' | 'xhigh'
  input: string | Array<{ type: 'text'; text: string } | { type: 'local_image'; path: string }>
  outputSchema?: unknown
  oneShotNetwork?: boolean
}

type RunEventPayload = {
  runId: string
  event: unknown
}

type CodexModelInfo = {
  model: string
  displayName: string
  description: string
  isDefault: boolean
}

const api = {
  setWindowTitle(title: string): Promise<boolean> {
    return ipcRenderer.invoke('codex-designer:set-window-title', title)
  },
  pickWorkspace(): Promise<PickWorkspaceResult> {
    return ipcRenderer.invoke('codex-designer:pick-workspace')
  },
  getAppState(): Promise<AppState> {
    return ipcRenderer.invoke('codex-designer:get-app-state')
  },
  listModels(): Promise<CodexModelInfo[]> {
    return ipcRenderer.invoke('codex-designer:list-models')
  },
  getClipboardFormats(): Promise<string[]> {
    return ipcRenderer.invoke('codex-designer:get-clipboard-formats')
  },
  readClipboardImageDataUrl(): Promise<string | null> {
    return ipcRenderer.invoke('codex-designer:read-clipboard-image-data-url')
  },
  openWorkspace(workspacePath: string): Promise<WorkspaceSummary> {
    return ipcRenderer.invoke('codex-designer:open-workspace', workspacePath)
  },
  setWorkspaceShareability(workspacePath: string, shareability: 'local' | 'shareable'): Promise<WorkspaceSummary> {
    return ipcRenderer.invoke('codex-designer:set-workspace-shareability', workspacePath, shareability)
  },
  getWorkspaceRunDefaults(workspacePath: string): Promise<WorkspaceRunDefaultsByRole | null> {
    return ipcRenderer.invoke('codex-designer:get-workspace-run-defaults', workspacePath)
  },
  setWorkspaceRunDefaults(workspacePath: string, runDefaults: WorkspaceRunDefaultsByRole | null): Promise<boolean> {
    return ipcRenderer.invoke('codex-designer:set-workspace-run-defaults', workspacePath, runDefaults)
  },
  initGit(workspacePath: string): Promise<WorkspaceSummary> {
    return ipcRenderer.invoke('codex-designer:init-git', workspacePath)
  },
  exportProfiles(workspacePath: string): Promise<string | null> {
    return ipcRenderer.invoke('codex-designer:export-profiles', workspacePath)
  },
  importProfiles(workspacePath: string): Promise<string | null> {
    return ipcRenderer.invoke('codex-designer:import-profiles', workspacePath)
  },
  startRun(args: StartRunArgs): Promise<{ runId: string }> {
    return ipcRenderer.invoke('codex-designer:start-run', args)
  },
  abortRun(runId: string): Promise<void> {
    return ipcRenderer.invoke('codex-designer:abort-run', runId)
  },
  onRunEvent(callback: (payload: RunEventPayload) => void): () => void {
    const listener = (_event: unknown, payload: RunEventPayload) => callback(payload)
    ipcRenderer.on('codex-designer:run-event', listener)
    return () => ipcRenderer.off('codex-designer:run-event', listener)
  },
  readTextFile(workspacePath: string, relPath: string): Promise<string> {
    return ipcRenderer.invoke('codex-designer:read-text-file', { workspacePath, relPath })
  },
  writeTextFile(workspacePath: string, relPath: string, content: string): Promise<boolean> {
    return ipcRenderer.invoke('codex-designer:write-text-file', { workspacePath, relPath, content })
  },
  saveAttachment(args: { workspacePath: string; featureSlug: string; ext: string; bytesBase64: string }): Promise<{
    relPath: string
  }> {
    return ipcRenderer.invoke('codex-designer:save-attachment', args)
  },
  readAttachmentDataUrl(workspacePath: string, relPath: string): Promise<string> {
    return ipcRenderer.invoke('codex-designer:read-attachment-data-url', { workspacePath, relPath })
  },
  deleteAttachment(workspacePath: string, relPath: string): Promise<boolean> {
    return ipcRenderer.invoke('codex-designer:delete-attachment', { workspacePath, relPath })
  },
  getGitDiffStat(workspacePath: string, fromCommit: string): Promise<string> {
    return ipcRenderer.invoke('codex-designer:get-git-diff-stat', { workspacePath, fromCommit })
  },
  getGitDiff(workspacePath: string, fromCommit: string): Promise<string> {
    return ipcRenderer.invoke('codex-designer:get-git-diff', { workspacePath, fromCommit })
  },
  gitCommitAll(workspacePath: string, message: string): Promise<{ commit: string; stdout: string; stderr: string }> {
    return ipcRenderer.invoke('codex-designer:git-commit-all', { workspacePath, message })
  },
  listRunLogs(filter?: { workspacePath?: string; featureSlug?: string }): Promise<any[]> {
    return ipcRenderer.invoke('codex-designer:list-run-logs', filter)
  },
  readRunLog(runId: string, limit?: number): Promise<{ meta: any; events: any[] }> {
    return ipcRenderer.invoke('codex-designer:read-run-log', { runId, limit })
  },
}

contextBridge.exposeInMainWorld('codexDesigner', api)

export type CodexDesignerPreloadApi = typeof api
