import { createReadStream, promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import readline from 'node:readline'

function codexHomeDir(): string {
  const env = process.env.CODEX_HOME
  if (env && env.trim().length) return env.trim()
  return path.join(os.homedir(), '.codex')
}

function sessionsDir(): string {
  return path.join(codexHomeDir(), 'sessions')
}

const sessionFileCache = new Map<string, string | null>()
const sessionCwdCache = new Map<string, string | null>()

async function findSessionFilePath(threadId: string): Promise<string | null> {
  const cached = sessionFileCache.get(threadId)
  if (cached !== undefined) return cached

  const root = sessionsDir()
  const stack: string[] = [root]
  while (stack.length) {
    const dir = stack.pop()!
    const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => [])
    for (const e of entries) {
      const full = path.join(dir, e.name)
      if (e.isDirectory()) {
        stack.push(full)
        continue
      }
      if (!e.isFile()) continue

      const name = e.name
      if (!name.includes(threadId)) continue
      if (!name.endsWith('.jsonl') && !name.endsWith('.json')) continue

      sessionFileCache.set(threadId, full)
      return full
    }
  }

  sessionFileCache.set(threadId, null)
  return null
}

export async function readCodexSessionCwd(threadId: string): Promise<string | null> {
  const cached = sessionCwdCache.get(threadId)
  if (cached !== undefined) return cached

  const p = await findSessionFilePath(threadId)
  if (!p) {
    sessionCwdCache.set(threadId, null)
    return null
  }

  const stream = createReadStream(p, { encoding: 'utf-8' })
  try {
    const rl = readline.createInterface({ input: stream, crlfDelay: Infinity })
    for await (const line of rl) {
      const trimmed = String(line ?? '').trim()
      if (!trimmed) continue
      try {
        const parsed = JSON.parse(trimmed) as any
        const cwd = typeof parsed?.payload?.cwd === 'string' ? parsed.payload.cwd : null
        sessionCwdCache.set(threadId, cwd)
        return cwd
      } catch {
        sessionCwdCache.set(threadId, null)
        return null
      } finally {
        rl.close()
      }
    }
    sessionCwdCache.set(threadId, null)
    return null
  } finally {
    try {
      stream.close()
    } catch {
      // ignore
    }
  }
}
