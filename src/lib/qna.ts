export type QnaOption = {
  key: string
  text: string
}

export type QnaAnswer = {
  text: string
  lineIndex: number
}

export type QnaQuestion = {
  id: string
  roundTitle: string
  prompt: string
  options: QnaOption[]
  answers: QnaAnswer[]
  answer: string | null
  answerLineIndex: number | null
  insertAfterLineIndex: number
}

export type QnaRound = {
  title: string
  questions: QnaQuestion[]
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
      let answerLineIndex: number | null = null
      let lastOptionLineIndex: number | null = null

      let j = i + 1
      for (; j < lines.length; j++) {
        const next = lines[j]
        if (/^##\s+Round\s+\d+/i.test(next)) break
        if (/^\s*Q:\s*/.test(next)) break

        const optMatch = next.match(/^\s*-\s*([A-Z])\)\s*(.+)\s*$/)
        if (optMatch) {
          options.push({ key: optMatch[1], text: optMatch[2].trim() })
          lastOptionLineIndex = j
          continue
        }

        const aMatch = next.match(/^\s*A:\s*(.*)\s*$/)
        if (aMatch) {
          const text = aMatch[1].trim() || ''
          answers.push({ text, lineIndex: j })
          answer = text
          answerLineIndex = j
          continue
        }
      }

      const id = `${roundIndex}:${currentRound.questions.length}`
      const insertAfterLineIndex =
        answerLineIndex !== null ? answerLineIndex : lastOptionLineIndex !== null ? lastOptionLineIndex : i
      currentRound.questions.push({
        id,
        roundTitle: currentRound.title,
        prompt,
        options,
        answers,
        answer,
        answerLineIndex,
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

  // Apply from bottom to top to keep indices stable when inserting.
  const normalized = updates
    .map((u) => ({ ...u, answer: u.answer ?? '' }))
    .filter((u) => byId.has(u.id))
    .sort((a, b) => {
      const qa = byId.get(a.id)!
      const qb = byId.get(b.id)!
      const ia = (qa.answerLineIndex ?? qa.insertAfterLineIndex) + 0.5
      const ib = (qb.answerLineIndex ?? qb.insertAfterLineIndex) + 0.5
      return ib - ia
    })

  for (const u of normalized) {
    const q = byId.get(u.id)!
    const current = q.answer ?? ''
    if (u.answer === current) continue
    const line = `A: ${u.answer}`
    const insertAt = (q.answerLineIndex ?? q.insertAfterLineIndex) + 1
    lines.splice(insertAt, 0, line)
  }

  return lines.join('\n')
}
