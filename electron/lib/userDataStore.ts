import { app } from 'electron'
import path from 'node:path'
import { readJsonFile, writeJsonFileAtomic } from './fs'

export type AppState = {
  version: 1
  activeWorkspacePath?: string
  recentWorkspacePaths: string[]
}

function defaultState(): AppState {
  return { version: 1, recentWorkspacePaths: [] }
}

export class UserDataStore {
  private readonly statePath: string

  constructor() {
    const userDataDir = app.getPath('userData')
    this.statePath = path.join(userDataDir, 'codex-designer.state.json')
  }

  async read(): Promise<AppState> {
    const existing = await readJsonFile<AppState>(this.statePath)
    if (!existing || existing.version !== 1) return defaultState()
    return existing
  }

  async write(next: AppState): Promise<void> {
    await writeJsonFileAtomic(this.statePath, next)
  }

  async setActiveWorkspace(workspacePath: string): Promise<AppState> {
    const cur = await this.read()
    const deduped = [workspacePath, ...cur.recentWorkspacePaths.filter((p) => p !== workspacePath)].slice(
      0,
      20
    )
    const next: AppState = {
      ...cur,
      activeWorkspacePath: workspacePath,
      recentWorkspacePaths: deduped,
    }
    await this.write(next)
    return next
  }
}

