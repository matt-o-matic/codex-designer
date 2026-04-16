export const PLAN_REQUIRED_SECTIONS = [
  'Problem',
  'Goals',
  'Non-goals',
  'Assumptions',
  'Decisions',
  'Design',
  'Planning Review',
  'Open Questions',
  'Implementation Tasks',
  'Validation',
] as const

export const PLANNING_REVIEW_TOPICS = [
  'Scope and Intent',
  'Dependency Mapping',
  'Data Shape and Ownership',
  'State and Lifecycle',
  'Auth and Access',
  'Integration Surface',
  'Performance Expectations',
  'Migration and Rollout',
  'Documentation Obligation',
  'Error Topology',
  'Test Contract',
] as const

function normalizeHeading(value: string): string {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
}

function normalizeMarkdown(markdown: string): string {
  return String(markdown ?? '').replace(/\r\n/g, '\n').replace(/\r/g, '\n')
}

function levelTwoHeadings(markdown: string): string[] {
  const headings: string[] = []
  for (const line of normalizeMarkdown(markdown).split('\n')) {
    const match = line.match(/^##\s+(.+?)\s*$/)
    if (!match) continue
    headings.push(normalizeHeading(match[1]))
  }
  return headings
}

function planningReviewHeadings(markdown: string): string[] {
  const headings: string[] = []
  let inPlanningReview = false

  for (const line of normalizeMarkdown(markdown).split('\n')) {
    const levelTwo = line.match(/^##\s+(.+?)\s*$/)
    if (levelTwo) {
      inPlanningReview = normalizeHeading(levelTwo[1]) === normalizeHeading('Planning Review')
      continue
    }
    if (!inPlanningReview) continue

    const levelThree = line.match(/^###\s+(.+?)\s*$/)
    if (!levelThree) continue
    headings.push(normalizeHeading(levelThree[1]))
  }

  return headings
}

function relatedQnaLine(featureSlug?: string): string | null {
  const slug = String(featureSlug ?? '').trim()
  if (!slug) return null
  return `Related Q&A: \`docs/${slug}.qna.md\``
}

export function validatePlanningPlanMarkdown(markdown: string, featureSlug?: string): string[] {
  const normalizedMarkdown = normalizeMarkdown(markdown)
  const lines = normalizedMarkdown.split('\n')
  const firstNonEmpty = lines.find((line) => line.trim().length > 0) ?? ''
  const issues: string[] = []

  if (!/^#\s+.+$/.test(firstNonEmpty.trim())) {
    issues.push('Missing plan title as the first non-empty line.')
  }

  const relatedLine = relatedQnaLine(featureSlug)
  if (relatedLine) {
    if (!normalizedMarkdown.includes(relatedLine)) {
      issues.push(`Missing related Q&A link: ${relatedLine}`)
    }
  } else if (!normalizedMarkdown.includes('Related Q&A:')) {
    issues.push('Missing related Q&A link.')
  }

  const topLevel = new Set(levelTwoHeadings(normalizedMarkdown))
  const missingSections = PLAN_REQUIRED_SECTIONS.filter((heading) => !topLevel.has(normalizeHeading(heading)))
  if (missingSections.length) {
    issues.push(`Missing required plan sections: ${missingSections.join(', ')}`)
  }

  const reviewHeadings = planningReviewHeadings(normalizedMarkdown)
  const reviewSet = new Set(reviewHeadings)
  const missingReviewTopics = PLANNING_REVIEW_TOPICS.filter((heading) => !reviewSet.has(normalizeHeading(heading)))
  if (missingReviewTopics.length) {
    issues.push(`Missing Planning Review topics: ${missingReviewTopics.join(', ')}`)
  }

  const orderedReviewHeadings = reviewHeadings
    .map((heading) => PLANNING_REVIEW_TOPICS.findIndex((required) => normalizeHeading(required) === heading))
    .filter((idx) => idx >= 0)

  for (let i = 1; i < orderedReviewHeadings.length; i++) {
    if (orderedReviewHeadings[i] < orderedReviewHeadings[i - 1]) {
      issues.push('Planning Review topics must stay in the required order.')
      break
    }
  }

  return issues
}

export function assertValidPlanningPlanMarkdown(markdown: string, featureSlug?: string): void {
  const issues = validatePlanningPlanMarkdown(markdown, featureSlug)
  if (!issues.length) return
  throw new Error(`Planning output failed validation. ${issues.join(' ')}`)
}
