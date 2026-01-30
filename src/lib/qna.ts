export type QnaOption = {
  key: string
  text: string
  recommended?: boolean
}

export type QnaAnswer = {
  text: string
  lineIndex: number
  endLineIndex: number
}

export type QnaQuestion = {
  id: string
  roundTitle: string
  prompt: string
  options: QnaOption[]
  recommendedKey: string | null
  answers: QnaAnswer[]
  answer: string | null
  answerLineIndex: number | null
  answerEndLineIndex: number | null
  insertAfterLineIndex: number
}

export type QnaRound = {
  title: string
  questions: QnaQuestion[]
}

function parseOptionLine(line: string): { key: string; text: string; recommended: boolean } | null {
  const trimmed = line.trim()
  if (!trimmed) return null
  // Avoid confusing answer lines like "A: ..." with option lines.
  if (/^A:\s*/i.test(trimmed)) return null
  if (/^Q:\s*/i.test(trimmed)) return null
  if (/^(Recommended|Default|Suggested)\s*:/i.test(trimmed)) return null

  // Examples:
  // - A) Option text
  // - **A)** Option text
  // * (B) Option text
  // C. Option text
  // [D] Option text
  const m = trimmed.match(
    /^(?:[-*]\s*)?(?:\*\*|\*)?\s*[\(\[]?\s*([A-Z])\s*(?:\*\*|\*)?\s*[\)\.\:\-\]]\s*(?:\*\*|\*)?\s*(.+)\s*$/
  )
  if (!m) return null
  const key = m[1]
  const text = m[2].trim()
  const recommended = /\b(recommended|default|suggested)\b/i.test(text)
  return { key, text, recommended }
}

function parseRecommendedLine(line: string): string | null {
  const m = line
    .trim()
    .match(/^(?:Recommended|Default|Suggested)\s*:\s*[\(\[]?\s*([A-Z])\s*[\)\]]?(?:\b.*)?$/i)
  if (!m) return null
  return m[1].toUpperCase()
}

export function parseQnaMarkdown(markdown: string): { rounds: QnaRound[]; allQuestions: QnaQuestion[] } {
  const lines = markdown.split(/\r?\n/)

  const rounds: QnaRound[] = []
  let currentRound: QnaRound | null = null
  let roundIndex = -1

  let i = 0
  while (i < lines.length) {
    const line = lines[i]
    const roundMatch = line.match(/^##\s+(Round\s+\d+.*)$/i)
    if (roundMatch) {
      roundIndex += 1
      currentRound = { title: roundMatch[1].trim(), questions: [] }
      rounds.push(currentRound)
      i += 1
      continue
    }

    const qMatch = line.match(/^\s*Q:\s*(.+)\s*$/)
    if (qMatch) {
      if (!currentRound) {
        roundIndex += 1
        currentRound = { title: `Round ${roundIndex + 1}`, questions: [] }
        rounds.push(currentRound)
      }

      const prompt = qMatch[1].trim()
      const options: QnaOption[] = []
      const answers: QnaAnswer[] = []
      let answer: string | null = null
      let lastAnswerEndLineIndex: number | null = null
      let answerLineIndex: number | null = null
      let answerEndLineIndex: number | null = null
      let lastOptionLineIndex: number | null = null
      let recommendedKey: string | null = null
      let recommendedLineIndex: number | null = null

      let j = i + 1
      for (; j < lines.length; j++) {
        const next = lines[j]
        if (/^##\s+Round\s+\d+/i.test(next)) break
        if (/^\s*Q:\s*/.test(next)) break

        const rec = parseRecommendedLine(next)
        if (rec) {
          recommendedKey = rec
          recommendedLineIndex = j
          continue
        }

        const opt = parseOptionLine(next)
        if (opt) {
          const recommended = opt.recommended || /\(recommended\)|\[recommended\]/i.test(opt.text)
          options.push({ key: opt.key, text: opt.text, recommended })
          lastOptionLineIndex = j
          if (recommended && !recommendedKey) recommendedKey = opt.key
          continue
        }

        const aMatch = next.match(/^\s*A:\s*(.*)\s*$/)
        if (aMatch) {
          const first = (aMatch[1] ?? '').trimEnd()
          const blockLines: string[] = []
          let k = j + 1
          while (k < lines.length) {
            const line = lines[k]
            if (/^##\s+Round\s+\d+/i.test(line)) break
            if (/^\s*Q:\s*/.test(line)) break
            if (!line.startsWith('  ')) break
            blockLines.push(line.slice(2).trimEnd())
            k += 1
          }

          const parts: string[] = []
          if (first.trim().length) parts.push(first.trimEnd())
          if (blockLines.length) parts.push(...blockLines)
          const text = parts.join('\n').trimEnd()

          const endLineIndex = Math.max(j, k - 1)
          answers.push({ text, lineIndex: j, endLineIndex })
          answer = text
          answerLineIndex = j
          answerEndLineIndex = endLineIndex
          lastAnswerEndLineIndex = endLineIndex
          j = k - 1
          continue
        }
      }

      const id = `${roundIndex}:${currentRound.questions.length}`
      const insertAfterLineIndex =
        lastAnswerEndLineIndex !== null
          ? lastAnswerEndLineIndex
          : recommendedLineIndex !== null
            ? recommendedLineIndex
            : lastOptionLineIndex !== null
              ? lastOptionLineIndex
              : i
      if (recommendedKey) {
        for (const opt of options) opt.recommended = opt.key === recommendedKey
      }
      currentRound.questions.push({
        id,
        roundTitle: currentRound.title,
        prompt,
        options,
        recommendedKey,
        answers,
        answer,
        answerLineIndex,
        answerEndLineIndex,
        insertAfterLineIndex,
      })

      i = j
      continue
    }

    i += 1
  }

  const allQuestions = rounds.flatMap((r) => r.questions)
  return { rounds, allQuestions }
}

export function applyAnswersToQnaMarkdown(
  original: string,
  updates: Array<{ id: string; answer: string }>
): string {
  const lines = original.split(/\r?\n/)
  const { allQuestions } = parseQnaMarkdown(original)
  const byId = new Map(allQuestions.map((q) => [q.id, q]))

  const normalize = (v: unknown) =>
    String(v ?? '')
      .replace(/\r\n/g, '\n')
      .replace(/\r/g, '\n')
      .trimEnd()

  const renderBlock = (rawAnswer: string): string[] => {
    const raw = normalize(rawAnswer)
    if (!raw.length) return ['A:']
    const parts = raw.split('\n')
    const first = parts[0]?.trimEnd() ?? ''
    const block: string[] = [`A: ${first}`.trimEnd()]
    for (const ln of parts.slice(1)) block.push(`  ${ln}`)
    return block
  }

  // Apply from bottom to top to keep indices stable when inserting.
  const normalized = updates
    .map((u) => ({ ...u, answer: u.answer ?? '' }))
    .filter((u) => byId.has(u.id))
    .sort((a, b) => {
      const qa = byId.get(a.id)!
      const qb = byId.get(b.id)!
      const ia =
        (qa.answerEndLineIndex ?? qa.insertAfterLineIndex) +
        (qa.answers.length ? 0.5 : 0)
      const ib =
        (qb.answerEndLineIndex ?? qb.insertAfterLineIndex) +
        (qb.answers.length ? 0.5 : 0)
      return ib - ia
    })

  for (const u of normalized) {
    const q = byId.get(u.id)!
    const current = normalize(q.answer)
    const next = normalize(u.answer)
    const hasHistory = q.answers.length > 1
    if (!hasHistory && next === current) continue

    const block = renderBlock(next)

    if (q.answers.length) {
      // Collapse to a single answer block at the original A: position.
      const blocks = [...q.answers].sort((a, b) => a.lineIndex - b.lineIndex)
      for (const a of [...blocks].reverse()) {
        const start = a.lineIndex
        const end = a.endLineIndex
        if (start < 0 || end < start) continue
        lines.splice(start, end - start + 1)
      }
      const insertAt = blocks[0].lineIndex
      lines.splice(insertAt, 0, ...block)
      continue
    }

    const insertAt = q.insertAfterLineIndex + 1
    lines.splice(insertAt, 0, ...block)
  }

  return lines.join('\n')
}
