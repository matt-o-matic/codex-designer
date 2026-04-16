import { PLAN_REQUIRED_SECTIONS, PLANNING_REVIEW_TOPICS } from './planning'

function renderAttachments(relPaths: string[]): string {
  if (!relPaths.length) return ''
  return `\n\n## Attachments\n\n${relPaths.map((p) => `- ${p}`).join('\n')}\n`
}

function renderBulletList(items: readonly string[], prefix = '- '): string {
  return items.map((item) => `${prefix}${item}`).join('\n')
}

function appendHouseStyle(prompt: string, houseStyleMarkdown?: string): string {
  const style = String(houseStyleMarkdown ?? '').trim()
  if (!style.length) return prompt
  return `${prompt}\n\n## House Style (workspace)\n${style}\n`
}

export function buildPlanningCreatePrompt(args: {
  featureSlug: string
  brief: string
  attachments?: string[]
  houseStyleMarkdown?: string
}): string {
  const slug = args.featureSlug
  const brief = args.brief?.trim() || ''
  const attachments = Array.isArray(args.attachments) ? args.attachments.filter(Boolean) : []

  const base = `You are codex-designer. Create a deterministic planning output for a new feature.

Return ONLY valid JSON matching the provided output schema (no markdown fences, no extra keys, no commentary).

## Inputs
- Feature slug: ${slug}
- Brief:\n${brief || '(no brief provided)'}${renderAttachments(attachments)}

## Output requirements
You must produce:
1) \`planMarkdown\`: a complete markdown document for \`docs/${slug}.plan.md\`
2) \`qna\`: a JSON object representing the full contents for \`docs/${slug}.qna.json\`

### Plan document requirements
- Title at top: \`# ${slug} — Plan\`
- Include a link/pointer to the Q&A doc: \`Related Q&A: \\\`docs/${slug}.qna.md\\\`\`
- Include sections (use \`##\` headings):
${renderBulletList(PLAN_REQUIRED_SECTIONS, '  - ')}
- \`## Planning Review\` must include these exact \`###\` subsections in this order:
${renderBulletList(PLANNING_REVIEW_TOPICS, '  - ')}
- Every Planning Review subsection must do one of these:
  - capture a concrete decision, implication, risk, or follow-up
  - explicitly state that the topic was considered and is not applicable, already obvious, or intentionally deferred
- Do not silently omit a Planning Review topic, even when no action is needed.
- Keep the rough sequencing intact:
  - Scope and Intent first
  - Dependency Mapping and Data Shape and Ownership before deeper technical planning
  - Error Topology and Test Contract after the success path is clear
- Be practical and implementation-ready:
  - \`## Design\` should include UI + data + integration notes as applicable
  - \`## Implementation Tasks\` should be an ordered checklist
  - \`## Validation\` should be a manual test checklist
  - \`## Open Questions\` should say \`None.\` if there are no remaining open questions

### Q&A JSON requirements
- \`qna.version\` must be \`1\`
- \`qna.featureSlug\` must equal \`${slug}\`
- \`qna.updatedAt\` must be an ISO timestamp string
- \`qna.rounds\` must contain exactly one round: Round 1
  - \`round.id\`: \`round-1\`
  - \`round.title\`: \`Round 1\`
  - \`round.questions\`: ask as many high-signal questions as needed in this round; there is no fixed question-count cap
- Round 1 questions should prioritize unresolved topics in this order:
  - Scope and Intent
  - Dependency Mapping
  - Data Shape and Ownership
  - Then the remaining Planning Review topics
- Skip questions when the answer is already obvious from the brief or the topic is clearly not applicable.
- It is valid for \`round.questions\` to be empty only if the brief already supports an implementation-ready plan and every Planning Review subsection is filled in accordingly.
- Each question must include:
  - \`id\`: stable, deterministic (e.g. \`r1-q1\`, \`r1-q2\`, ...)
  - \`prompt\`: the question text
  - \`options\`: 3–6 options with keys A–F and short, scannable text
  - \`recommendedKey\`: must match one of the option keys
  - \`answers\`: empty array (no answers yet)
- Exactly one option must have \`recommended: true\` (the recommended one).
`

  return appendHouseStyle(base, args.houseStyleMarkdown)
}

export function buildPlanningNextRoundPrompt(args: {
  featureSlug: string
  nextRoundNumber: number
  additionalNotes?: string
  houseStyleMarkdown?: string
}): string {
  const slug = args.featureSlug
  const nextRound = Math.max(1, Math.floor(args.nextRoundNumber || 1))
  const additionalNotes = String(args.additionalNotes ?? '').trim()

  const lateStageGuidance = nextRound >= 8
    ? `
## Wrap-up guidance (Round ${nextRound})
- You are in the late rounds. Consolidate aggressively and prefer resolving the remaining ambiguity in this round instead of spreading it across more shallow rounds.
- There is still no per-round question cap. Ask as many questions as needed to close the remaining gaps.
- Aim to finish planning within 10 rounds total when reasonable, but do NOT force completion if material ambiguity remains.
- Do NOT ask repeats or near-repeats of earlier questions. If the answer is already implied, make an assumption and record it in the plan.`
    : ''

  const notesBlock = additionalNotes
    ? `

## Additional notes (new requirements)
The user added these notes while reviewing the plan. Treat them as incremental requirements/clarifications:
${additionalNotes}
`
    : ''

  const base = `You are codex-designer. The user has answered the current Q&A.

Return ONLY valid JSON matching the provided output schema (no markdown fences, no extra keys, no commentary).

## Task
- Read \`docs/${slug}.qna.json\` and \`docs/${slug}.qna.md\` for the latest questions + answers.
- Update \`docs/${slug}.plan.md\` so it fully incorporates confirmed decisions and requirements.
- \`planMarkdown\` MUST be the full, complete contents for \`docs/${slug}.plan.md\` (not a diff).
- Generate ONLY the next set of follow-up questions as a single round object to append to \`docs/${slug}.qna.json\`.
${notesBlock}

## Plan structure requirements
- \`planMarkdown\` must keep these \`##\` sections:
${renderBulletList(PLAN_REQUIRED_SECTIONS, '  - ')}
- \`## Planning Review\` must include these exact \`###\` subsections in this order:
${renderBulletList(PLANNING_REVIEW_TOPICS, '  - ')}
- Every Planning Review subsection must either record a concrete conclusion/follow-up or explicitly note that it was considered and is not applicable, already obvious, or intentionally deferred.

## Follow-up rules (deterministic)
- Ask only high-signal questions that are still genuinely ambiguous.
- Do not ask "obvious" questions that can be inferred from the brief, plan, or prior rounds.
- Never ask duplicates of earlier questions (including reworded duplicates).
- Prefer documenting assumptions/decisions in the plan over asking another question.
- Prefer unresolved topics in this order:
  - Scope and Intent
  - Dependency Mapping
  - Data Shape and Ownership
  - Then the remaining Planning Review topics
- If "Additional notes" is present, prioritize clarifying those items before anything else.
- If "Additional notes" is present and any item is ambiguous, ask at least 1 follow-up question this round.
- There is no artificial cap on questions in this round. Ask as many as needed, but batch related ambiguities together instead of creating more rounds than necessary.
- Aim to finish planning in 10 rounds or fewer when reasonable, but do not force completion just to hit that target.
- Each question MUST include 3–6 multiple-choice options and a recommended default.
- Do not rewrite or duplicate earlier rounds.
- Return \`qnaRound.questions: []\` only when every Planning Review subsection is present in \`planMarkdown\` and all remaining material ambiguities have either been resolved or deliberately accepted as documented assumptions.
${lateStageGuidance}

## Q&A round JSON requirements
- The output must contain a single \`qnaRound\` object.
- \`qnaRound.id\`: \`round-${nextRound}\`
- \`qnaRound.title\`: usually \`Round ${nextRound}\`. If \`qnaRound.questions\` is empty, use \`Round ${nextRound} (complete)\`.
- \`qnaRound.questions\`: a list of follow-up questions (may be empty when planning is complete)
- Each question must include:
  - \`id\`: stable, deterministic (e.g. \`r${nextRound}-q1\`, \`r${nextRound}-q2\`, ...)
  - \`prompt\`
  - \`options\` (3–6 items)
  - \`recommendedKey\`
  - \`answers\`: empty array
- Exactly one option must have \`recommended: true\` (the recommended one).
`

  return appendHouseStyle(base, args.houseStyleMarkdown)
}

export function buildImplementationPrompt(args: { featureSlug: string; houseStyleMarkdown?: string }): string {
  const slug = args.featureSlug
  const base = `You are codex-designer in IMPLEMENTATION mode.

## Source of truth (read-only)
- \`docs/${slug}.plan.md\`
- \`docs/${slug}.qna.md\`

Do NOT modify the plan or Q&A docs. Implement the feature in the workspace according to the plan/Q&A.

## Non-negotiables
- Do not stop after scaffolding. Keep iterating until the feature is complete.
- Prefer strong inferences from the plan/Q&A over asking more questions.
- Only ask the user for input if you are truly blocked with no safe default.

## Work loop (repeat until done)
1) Read the plan’s “Implementation Tasks” and mirror them as a TODO checklist in \`docs/${slug}.impl.md\`.
2) Implement tasks in small, verifiable increments.
3) Add or extend AUTOMATED tests where feasible using the repo’s existing test framework (tests must be deterministic).
4) Run the repo’s validation commands (tests/typecheck/build/lint as applicable). Fix failures and re-run until green.
5) Keep \`docs/${slug}.impl.md\` updated with commands run + results and remaining TODOs.

## Implementation notes (required)
- Create or update: \`docs/${slug}.impl.md\`
- Keep it as an append-only work log with:
  - Current status / focus
  - TODO checklist aligned to the plan tasks
  - Commands run and results (as needed)
  - Decisions made during implementation (and why)

## Execution
- Make focused, minimal changes to implement the plan.
- Prefer small, verifiable steps; keep the repo buildable.
- If you discover missing requirements, record the question in \`docs/${slug}.impl.md\` and proceed with the safest reasonable assumption.

## Repo hygiene
- Avoid touching \`.gitignore\` unless the plan explicitly requires it.

## Completion criteria
- All plan “Implementation Tasks” are complete (or explicitly documented as deferred/out-of-scope with rationale).
- The plan’s “Validation” checklist is satisfied.
- The repo’s relevant automated checks pass (tests/typecheck/build).
`

  return appendHouseStyle(base, args.houseStyleMarkdown)
}

export function buildImplementationFollowupPrompt(args: {
  featureSlug: string
  message: string
  attachments?: string[]
  houseStyleMarkdown?: string
}): string {
  const slug = args.featureSlug
  const message = args.message?.trim() || ''
  const attachments = Array.isArray(args.attachments) ? args.attachments.filter(Boolean) : []

  const base = `Continue the existing Codex implementation thread for \`${slug}\`.

The user is providing follow-up context (logs, build/test errors, screenshots) to address before continuing.

## Follow-up
${message || '(no message provided)'}${renderAttachments(attachments)}
`

  return appendHouseStyle(base, args.houseStyleMarkdown)
}
