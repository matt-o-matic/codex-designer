import { spawn } from 'node:child_process'
import readline from 'node:readline'
import { findCodexBinaryPath } from './codexBinary'

export type CodexModelInfo = {
  model: string
  displayName: string
  description: string
  isDefault: boolean
}

type JsonRpcError = { code: number; message: string; data?: unknown }
type JsonRpcResponse = { id: number; result?: unknown; error?: JsonRpcError }
type JsonRpcNotification = { method: string; params?: unknown }

function isResponse(msg: unknown): msg is JsonRpcResponse {
  return !!msg && typeof msg === 'object' && 'id' in (msg as any) && ('result' in (msg as any) || 'error' in (msg as any))
}

function isNotification(msg: unknown): msg is JsonRpcNotification {
  return !!msg && typeof msg === 'object' && 'method' in (msg as any) && !('id' in (msg as any))
}

function normalizeModelList(models: any[]): CodexModelInfo[] {
  const dedup = new Map<string, CodexModelInfo>()
  for (const m of models ?? []) {
    const model = typeof m?.model === 'string' ? m.model : ''
    if (!model) continue
    const displayName = typeof m?.displayName === 'string' ? m.displayName : model
    const description = typeof m?.description === 'string' ? m.description : ''
    const isDefault = !!m?.isDefault
    dedup.set(model, { model, displayName, description, isDefault })
  }

  const out = Array.from(dedup.values())
  out.sort((a, b) => {
    if (a.isDefault !== b.isDefault) return a.isDefault ? -1 : 1
    return a.displayName.localeCompare(b.displayName)
  })
  return out
}

export async function listCodexModels(args: {
  clientName: string
  clientVersion: string
  timeoutMs?: number
}): Promise<CodexModelInfo[]> {
  const timeoutMs = args.timeoutMs ?? 15_000
  const codexPath = findCodexBinaryPath()

  const child = spawn(codexPath, ['app-server'], { stdio: ['pipe', 'pipe', 'pipe'], env: process.env })
  const stderrChunks: Buffer[] = []
  child.stderr?.on('data', (d) => stderrChunks.push(Buffer.isBuffer(d) ? d : Buffer.from(String(d))))

  if (!child.stdin || !child.stdout) {
    child.kill()
    throw new Error('Failed to start Codex app-server (missing stdio).')
  }

  const rl = readline.createInterface({ input: child.stdout, crlfDelay: Infinity })
  let exited = false
  let exitError: Error | null = null
  child.once('exit', (code, signal) => {
    exited = true
    if (code !== 0 || signal) {
      const stderr = Buffer.concat(stderrChunks).toString('utf8').trim()
      const detail = signal ? `signal ${signal}` : `code ${code ?? 1}`
      exitError = new Error(`Codex app-server exited with ${detail}${stderr ? `: ${stderr}` : ''}`)
    }
  })

  const pending = new Map<number, { resolve: (v: any) => void; reject: (e: Error) => void }>()
  let nextId = 1

  const pump = (async () => {
    for await (const line of rl) {
      const trimmed = String(line ?? '').trim()
      if (!trimmed) continue
      let msg: unknown
      try {
        msg = JSON.parse(trimmed)
      } catch {
        continue
      }

      if (isNotification(msg)) continue
      if (!isResponse(msg)) continue
      const id = typeof msg.id === 'number' ? msg.id : NaN
      if (!Number.isFinite(id)) continue
      const waiter = pending.get(id)
      if (!waiter) continue
      pending.delete(id)

      if (msg.error) waiter.reject(new Error(msg.error.message))
      else waiter.resolve(msg.result)
    }
  })()

  const send = async <T>(method: string, params: unknown): Promise<T> => {
    if (exited) throw exitError ?? new Error('Codex app-server exited unexpectedly.')
    const id = nextId++

    const p = new Promise<T>((resolve, reject) => {
      pending.set(id, { resolve: resolve as any, reject })
    })

    const payload = JSON.stringify({ id, method, params })
    child.stdin.write(`${payload}\n`)

    const timer = setTimeout(() => {
      const waiter = pending.get(id)
      if (!waiter) return
      pending.delete(id)
      waiter.reject(new Error(`Timed out waiting for Codex response (${method}).`))
    }, timeoutMs)

    try {
      return await p
    } finally {
      clearTimeout(timer)
    }
  }

  try {
    await send('initialize', { clientInfo: { name: args.clientName, version: args.clientVersion } })

    const models: any[] = []
    let cursor: string | null = null
    for (let page = 0; page < 50; page++) {
      const res: { data: any[]; nextCursor: string | null } = await send('model/list', { cursor, limit: 200 })
      if (Array.isArray(res?.data)) models.push(...res.data)
      cursor = typeof res?.nextCursor === 'string' ? res.nextCursor : null
      if (!cursor) break
    }

    return normalizeModelList(models)
  } finally {
    try {
      child.kill()
    } catch {
      // ignore
    }
    rl.close()
    void pump.catch(() => {})
  }
}
