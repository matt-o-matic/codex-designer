import path from 'node:path'
import { readJsonFile, writeJsonFileAtomic } from './fs'
import { codexDesignerShareDir } from './workspaceState'
import type { ApprovalMode, SandboxMode, ThreadOptions } from '@openai/codex-sdk'

export type ProfileId = 'careful' | 'yolo'

export type WorkspaceProfile = {
  id: ProfileId
  label: string
  threadOptions: Omit<ThreadOptions, 'workingDirectory'>
}

export type WorkspaceProfilesFile = {
  version: 1
  updatedAt: string
  profiles: WorkspaceProfile[]
}

export function workspaceProfilesPath(workspacePath: string): string {
  return path.join(codexDesignerShareDir(workspacePath), 'profiles.json')
}

export function defaultWorkspaceProfilesFile(): WorkspaceProfilesFile {
  return {
    version: 1,
    updatedAt: new Date().toISOString(),
    profiles: [
      {
        id: 'careful',
        label: 'Careful',
        threadOptions: {
          sandboxMode: 'workspace-write' satisfies SandboxMode,
          approvalPolicy: 'on-failure' satisfies ApprovalMode,
          networkAccessEnabled: false,
        },
      },
      {
        id: 'yolo',
        label: 'YOLO',
        threadOptions: {
          sandboxMode: 'danger-full-access' satisfies SandboxMode,
          approvalPolicy: 'never' satisfies ApprovalMode,
          networkAccessEnabled: true,
        },
      },
    ],
  }
}

export async function ensureProfilesFile(workspacePath: string): Promise<void> {
  const filePath = workspaceProfilesPath(workspacePath)
  const existing = await readJsonFile<WorkspaceProfilesFile>(filePath)
  if (existing && existing.version === 1) return
  await writeJsonFileAtomic(filePath, defaultWorkspaceProfilesFile())
}

export async function readProfilesFile(workspacePath: string): Promise<WorkspaceProfilesFile | null> {
  const filePath = workspaceProfilesPath(workspacePath)
  const existing = await readJsonFile<WorkspaceProfilesFile>(filePath)
  if (!existing || existing.version !== 1) return null
  return existing
}

