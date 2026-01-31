import { app } from 'electron'
import { createWriteStream } from 'node:fs'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { ensureDir, readJsonFile, writeJsonFileAtomic } from './fs'
import type { StartRunArgs, ThreadRole } from './codexRuns'

export type RunLogStatus = 'running' | 'completed' | 'failed' | 'aborted'

export type RunLogMeta = {
  version: 1
  runId: string
  workspacePath: string
  featureSlug?: string
  role: ThreadRole
  profileId: 'careful' | 'yolo'
  model?: string
  startedAt: string
  endedAt?: string
  status: RunLogStatus
  error?: string
  checkpoint?: string
  threadId?: string
  finalResponse?: string
}

function rootDir(): string {
  return path.join(app.getPath('userData'), 'codex-designer')
}

function runsDir(): string {
  return path.join(rootDir(), 'runs')
}

function metaPath(runId: string): string {
  return path.join(runsDir(), `${runId}.meta.json`)
}

function eventsPath(runId: string): string {
  return path.join(runsDir(), `${runId}.events.jsonl`)
}

function safeJsonLine(value: unknown): string {
  try {
    return JSON.stringify(value)
  } catch (e) {
    return JSON.stringify({ _unserializable: true, message: e instanceof Error ? e.message : String(e) })
  }
}

function isRunEvent(evt: unknown): evt is { type: string } {
  return typeof evt === 'object' && !!evt && 'type' in (evt as any) && typeof (evt as any).type === 'string'
}

function nowIso(): string {
  return new Date().toISOString()
}

export class RunLogStore {
  private readonly writers = new Map<string, RunLogWriter>()

  async startRun(runId: string, args: StartRunArgs): Promise<void> {
    if (this.writers.has(runId)) return
    await ensureDir(runsDir())

    const meta: RunLogMeta = {
      version: 1,
      runId,
      workspacePath: args.workspacePath,
      featureSlug: args.featureSlug,
      role: args.role,
      profileId: args.profileId,
      model: args.model,
      startedAt: nowIso(),
      status: 'running',
    }

    const writer = new RunLogWriter(runId, meta)
    this.writers.set(runId, writer)
    await writer.init()
  }

  append(runId: string, evt: unknown): void {
    const writer = this.writers.get(runId)
    if (!writer) return
    writer.append(evt)
    if (writer.isClosed()) this.writers.delete(runId)
  }

  async listRunLogs(filter?: { workspacePath?: string; featureSlug?: string }): Promise<RunLogMeta[]> {
    await ensureDir(runsDir())
    const entries = await fs.readdir(runsDir(), { withFileTypes: true })
    const metas: RunLogMeta[] = []
    for (const e of entries) {
      if (!e.isFile()) continue
      if (!e.name.endsWith('.meta.json')) continue
      const runId = e.name.replace(/\.meta\.json$/, '')
      const meta = await readJsonFile<RunLogMeta>(metaPath(runId))
      if (!meta || meta.version !== 1) continue
      if (filter?.workspacePath && meta.workspacePath !== filter.workspacePath) continue
      if (filter?.featureSlug && meta.featureSlug !== filter.featureSlug) continue
      metas.push(meta)
    }
    metas.sort((a, b) => b.startedAt.localeCompare(a.startedAt))
    return metas
  }

  async readRunLog(runId: string, opts?: { limit?: number }): Promise<{ meta: RunLogMeta | null; events: unknown[] }> {
    const meta = await readJsonFile<RunLogMeta>(metaPath(runId))
    const raw = await fs.readFile(eventsPath(runId), 'utf-8').catch(() => '')
    const lines = raw.split(/\r?\n/).filter((l) => l.trim().length)
    const lim = opts?.limit && opts.limit > 0 ? opts.limit : undefined
    const slice = lim ? lines.slice(Math.max(0, lines.length - lim)) : lines
    const events: unknown[] = []
    for (const line of slice) {
      try {
        events.push(JSON.parse(line))
      } catch {
        // ignore
      }
    }
    return { meta: meta && meta.version === 1 ? meta : null, events }
  }

  async prune(maxRuns = 200): Promise<void> {
    const all = await this.listRunLogs()
    if (all.length <= maxRuns) return
    const toDelete = all.slice(maxRuns)
    await Promise.all(
      toDelete.map(async (m) => {
        await fs.rm(metaPath(m.runId), { force: true })
        await fs.rm(eventsPath(m.runId), { force: true })
      })
    )
  }
}

class RunLogWriter {
  private readonly metaFile: string
  private readonly eventsFile: string
  private stream: ReturnType<typeof createWriteStream> | null = null
  private meta: RunLogMeta
  private closed = false
  private metaWriteChain: Promise<void> = Promise.resolve()

  constructor(runId: string, meta: RunLogMeta) {
    this.meta = meta
    this.metaFile = metaPath(runId)
    this.eventsFile = eventsPath(runId)
  }

  async init(): Promise<void> {
    await writeJsonFileAtomic(this.metaFile, this.meta)
    this.stream = createWriteStream(this.eventsFile, { flags: 'a' })
  }

  isClosed(): boolean {
    return this.closed
  }

  append(evt: unknown): void {
    if (this.closed) return
    this.stream?.write(`${safeJsonLine(evt)}\n`)

    if (isRunEvent(evt)) {
      const t = (evt as any).type
      if (t === 'run.thread' && typeof (evt as any).threadId === 'string') {
        this.meta.threadId = String((evt as any).threadId)
        void this.flushMeta()
      } else if (t === 'run.checkpoint' && typeof (evt as any).headCommit === 'string') {
        this.meta.checkpoint = String((evt as any).headCommit)
        void this.flushMeta()
      } else if (t === 'run.result' && typeof (evt as any).finalResponse === 'string') {
        const text = String((evt as any).finalResponse)
        this.meta.finalResponse = text.length > 20000 ? text.slice(0, 20000) : text
        void this.flushMeta()
      } else if (t === 'run.failed') {
        this.meta.status = 'failed'
        if (typeof (evt as any).message === 'string') this.meta.error = String((evt as any).message)
        void this.finalize().catch((e) => console.error('[run-logs] finalize failed', e))
      } else if (t === 'run.aborted') {
        this.meta.status = 'aborted'
        void this.finalize().catch((e) => console.error('[run-logs] finalize failed', e))
      } else if (t === 'run.completed') {
        if (this.meta.status === 'running') this.meta.status = 'completed'
        void this.finalize().catch((e) => console.error('[run-logs] finalize failed', e))
      }
    }
  }

  private queueMetaWrite(): Promise<void> {
    this.metaWriteChain = this.metaWriteChain
      .catch(() => {
        // keep chain alive
      })
      .then(() => writeJsonFileAtomic(this.metaFile, this.meta))
      .catch((e) => {
        console.error('[run-logs] meta write failed', e)
      })
    return this.metaWriteChain
  }

  private async flushMeta(): Promise<void> {
    if (this.closed) {
      await this.metaWriteChain
      return
    }
    await this.queueMetaWrite()
  }

  private async finalize(): Promise<void> {
    if (this.closed) return
    this.closed = true
    this.meta.endedAt = nowIso()
    await this.queueMetaWrite()

    const s = this.stream
    this.stream = null
    if (!s) return

    await new Promise<void>((resolve) => {
      s.end(() => resolve())
    })
  }
}
