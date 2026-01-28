export type TestStatus = 'not_run' | 'pass' | 'fail' | 'deferred' | 'blocked'

export type TestCase = {
  id: string
  title: string
  description?: string
  steps: string[]
  expected: string
  tags?: string[]
}

export type TestFeedbackLine = {
  text: string
  attachments: string[]
}

export type TestResult = {
  status: TestStatus
  feedback: TestFeedbackLine[]
}

export type TestRound = {
  id: string
  startedAt: string
  results: Record<string, TestResult>
}

export type TestPlan = {
  version: 1
  featureSlug: string
  generatedAt: string
  tests: TestCase[]
  rounds: TestRound[]
}

export function createEmptyTestPlan(featureSlug: string): TestPlan {
  return {
    version: 1,
    featureSlug,
    generatedAt: new Date().toISOString(),
    tests: [],
    rounds: [],
  }
}

export function ensureRound(plan: TestPlan): TestRound {
  if (plan.rounds.length) return plan.rounds[plan.rounds.length - 1]
  const round: TestRound = {
    id: 'round-1',
    startedAt: new Date().toISOString(),
    results: {},
  }
  plan.rounds.push(round)
  return round
}

export function renderTestMarkdown(plan: TestPlan): string {
  const lines: string[] = []
  lines.push(`# ${plan.featureSlug} — Manual Test Checklist`)
  lines.push('')
  lines.push(`Generated: ${plan.generatedAt}`)
  lines.push('')

  const latest = plan.rounds.length ? plan.rounds[plan.rounds.length - 1] : null
  if (latest) {
    lines.push(`Latest round: ${latest.id} (${latest.startedAt})`)
    lines.push('')
  }

  lines.push('## Tests')
  lines.push('')

  if (!plan.tests.length) {
    lines.push('- (no tests yet)')
    lines.push('')
    return lines.join('\n')
  }

  for (const test of plan.tests) {
    const status = latest?.results?.[test.id]?.status ?? 'not_run'
    const box = status === 'pass' ? 'x' : ' '
    lines.push(`- [${box}] **${test.id}** — ${test.title} _(status: ${status})_`)
    if (test.description) lines.push(`  - ${test.description}`)
    lines.push('  - Steps:')
    for (let i = 0; i < test.steps.length; i++) {
      lines.push(`    ${i + 1}. ${test.steps[i]}`)
    }
    lines.push(`  - Expected: ${test.expected}`)
    lines.push('')
  }

  return lines.join('\n')
}

