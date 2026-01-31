import path from 'node:path'
import { ensureDir, readJsonFile, writeJsonFileAtomic } from './fs'

export type WorkspaceShareability = 'local' | 'shareable'

export type WorkspaceRunDefaults = {
  model?: string
  modelReasoningEffort?: 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | ''
}

export type WorkspaceRunDefaultsByRole = {
  planning?: WorkspaceRunDefaults
  implementation?: WorkspaceRunDefaults
  testing?: WorkspaceRunDefaults
  generic?: WorkspaceRunDefaults
  newWork?: WorkspaceRunDefaults
}

export type WorkspaceState = {
  version: 1
  shareability?: WorkspaceShareability
  runDefaults?: WorkspaceRunDefaultsByRole
  features?: Record<
    string,
    {
      planningThreadId?: string
      implementationThreadId?: string
      lastPlanRegeneratedAt?: string
      lastQnaUpdatedAt?: string
    }
  >
}

export function codexDesignerDir(workspacePath: string): string {
  return path.join(workspacePath, '.codex-designer')
}

export function codexDesignerShareDir(workspacePath: string): string {
  return path.join(codexDesignerDir(workspacePath), 'share')
}

export function codexDesignerCacheDir(workspacePath: string): string {
  return path.join(codexDesignerDir(workspacePath), 'cache')
}

export function workspaceStatePath(workspacePath: string): string {
  return path.join(codexDesignerCacheDir(workspacePath), 'state.json')
}

export async function ensureWorkspaceDirs(workspacePath: string): Promise<void> {
  await ensureDir(codexDesignerShareDir(workspacePath))
  await ensureDir(codexDesignerCacheDir(workspacePath))
}

function defaultWorkspaceState(): WorkspaceState {
  return { version: 1 }
}

export async function readWorkspaceState(workspacePath: string): Promise<WorkspaceState> {
  const filePath = workspaceStatePath(workspacePath)
  const existing = await readJsonFile<WorkspaceState>(filePath)
  if (!existing || existing.version !== 1) return defaultWorkspaceState()
  return existing
}

export async function writeWorkspaceState(workspacePath: string, next: WorkspaceState): Promise<void> {
  const filePath = workspaceStatePath(workspacePath)
  await writeJsonFileAtomic(filePath, next)
}
