export type QnaStateVersion = 1

export type QnaOptionV1 = {
  key: string
  text: string
  recommended: boolean
}

export type QnaAnswerRevisionV1 = {
  id: string
  createdAt: string
  selectedKey: string
  notes: string
  attachments: string[]
}

export type QnaQuestionV1 = {
  id: string
  prompt: string
  options: QnaOptionV1[]
  recommendedKey: string
  answers: QnaAnswerRevisionV1[]
}

export type QnaRoundV1 = {
  id: string
  title: string
  questions: QnaQuestionV1[]
}

export type QnaStateV1 = {
  version: 1
  featureSlug: string
  updatedAt: string
  rounds: QnaRoundV1[]
}

export function createEmptyQnaStateV1(featureSlug: string): QnaStateV1 {
  return { version: 1, featureSlug, updatedAt: new Date().toISOString(), rounds: [] }
}

export function parseQnaStateJson(raw: string): QnaStateV1 | null {
  let parsed: any
  try {
    parsed = JSON.parse(String(raw ?? ''))
  } catch {
    return null
  }
  if (!parsed || parsed.version !== 1) return null
  if (typeof parsed.featureSlug !== 'string' || !parsed.featureSlug.trim().length) return null
  if (typeof parsed.updatedAt !== 'string') return null
  if (!Array.isArray(parsed.rounds)) return null
  return parsed as QnaStateV1
}

export function normalizeQnaStateV1(input: QnaStateV1): { state: QnaStateV1; changed: boolean } {
  let changed = false
  const state: QnaStateV1 = structuredClone(input)

  for (const round of state.rounds) {
    for (const q of round.questions) {
      const seen = new Set<string>()
      const nextOpts: QnaOptionV1[] = []
      for (const opt of q.options ?? []) {
        const key = String(opt.key ?? '').trim().toUpperCase()
        if (!key) continue
        if (seen.has(key)) {
          changed = true
          continue
        }
        seen.add(key)
        nextOpts.push({
          key,
          text: String(opt.text ?? ''),
          recommended: !!opt.recommended,
        })
      }
      if (nextOpts.length !== (q.options?.length ?? 0)) changed = true
      q.options = nextOpts

      const fallbackKey = q.options[0]?.key ?? 'A'
      const rec = String(q.recommendedKey ?? '').trim().toUpperCase()
      if (!rec || !q.options.some((o) => o.key === rec)) {
        q.recommendedKey = fallbackKey
        changed = true
      } else {
        q.recommendedKey = rec
      }

      // Ensure exactly one recommended flag matches recommendedKey.
      for (const opt of q.options) {
        const should = opt.key === q.recommendedKey
        if (opt.recommended !== should) {
          opt.recommended = should
          changed = true
        }
      }

      // Normalize answers.
      for (const a of q.answers ?? []) {
        const k = String(a.selectedKey ?? '').trim().toUpperCase()
        if (k && a.selectedKey !== k) {
          a.selectedKey = k
          changed = true
        }
        if (!Array.isArray(a.attachments)) {
          ;(a as any).attachments = []
          changed = true
        }
      }
    }
  }

  if (changed) state.updatedAt = new Date().toISOString()
  return { state, changed }
}

function ensureTrailingNewline(text: string): string {
  return text.endsWith('\n') ? text : `${text}\n`
}

function normalizeLineEndings(text: string): string {
  return String(text ?? '').replace(/\r\n/g, '\n').replace(/\r/g, '\n')
}

function indentLines(lines: string[], prefix = '  '): string[] {
  return lines.map((l) => `${prefix}${l}`)
}

function renderAnswerRevision(
  question: QnaQuestionV1,
  ans: QnaAnswerRevisionV1,
  label: string
): string[] {
  const selected = String(ans.selectedKey ?? '').trim() || question.recommendedKey
  const optText = question.options.find((o) => o.key === selected)?.text ?? ''
  const header = optText ? `${label} [${selected}] ${optText}` : `${label} ${selected}`

  const out: string[] = [header.trimEnd()]

  const notes = normalizeLineEndings(ans.notes ?? '').trimEnd()
  if (notes.trim().length) {
    out.push(...indentLines(['Notes:']))
    out.push(...indentLines(notes.split('\n'), '    '))
  }

  const attachments = Array.isArray(ans.attachments) ? ans.attachments.filter(Boolean) : []
  if (attachments.length) {
    out.push(...indentLines(['Attachments:']))
    out.push(...indentLines(attachments.map((p) => `- ${p}`), '    '))
  }

  return out
}

export function renderQnaMarkdownFromState(state: QnaStateV1): string {
  const slug = state.featureSlug
  const lines: string[] = []
  lines.push(`# ${slug} — Q&A`)
  lines.push('')
  lines.push(`Related plan: \`docs/${slug}.plan.md\``)
  lines.push('')

  for (const round of state.rounds) {
    lines.push(`## ${round.title}`)
    lines.push('')

    for (const q of round.questions) {
      lines.push(`Q: ${q.prompt}`)
      for (const opt of q.options) {
        lines.push(`- ${opt.key}) ${opt.text}`)
      }
      lines.push(`Recommended: ${q.recommendedKey}`)

      if (!q.answers.length) {
        lines.push('A:')
        lines.push('')
        continue
      }

      const ordered = [...q.answers]
      for (let i = 0; i < ordered.length; i++) {
        const ans = ordered[i]
        const isLast = i === ordered.length - 1
        const label = isLast ? 'A (current):' : `A (rev ${i + 1}):`
        lines.push(...renderAnswerRevision(q, ans, label))
      }
      lines.push('')
    }
  }

  return ensureTrailingNewline(lines.join('\n').trimEnd())
}
