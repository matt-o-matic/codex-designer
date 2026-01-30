export type CodexModelInfo = {
  model: string
  displayName: string
  description: string
  isDefault: boolean
}

let cachedModels: CodexModelInfo[] | null = null
let inflight: Promise<CodexModelInfo[]> | null = null

function normalize(models: unknown): CodexModelInfo[] {
  if (!Array.isArray(models)) return []
  const out: CodexModelInfo[] = []
  for (const m of models) {
    if (!m || typeof m !== 'object') continue
    const model = typeof (m as any).model === 'string' ? (m as any).model : ''
    if (!model) continue
    out.push({
      model,
      displayName: typeof (m as any).displayName === 'string' ? (m as any).displayName : model,
      description: typeof (m as any).description === 'string' ? (m as any).description : '',
      isDefault: !!(m as any).isDefault,
    })
  }
  out.sort((a, b) => {
    if (a.isDefault !== b.isDefault) return a.isDefault ? -1 : 1
    return a.displayName.localeCompare(b.displayName)
  })
  return out
}

export async function listCodexModels(opts?: { forceRefresh?: boolean }): Promise<CodexModelInfo[]> {
  const force = !!opts?.forceRefresh
  if (!force && cachedModels) return cachedModels
  if (!force && inflight) return inflight

  inflight = (async () => {
    const raw = await window.codexDesigner?.listModels?.()
    const models = normalize(raw)
    cachedModels = models
    return models
  })().finally(() => {
    inflight = null
  })

  return inflight
}

