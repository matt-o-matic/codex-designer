function renderAttachments(relPaths: string[]): string {
  if (!relPaths.length) return ''
  return `\n\n## Attachments\n\n${relPaths.map((p) => `- ${p}`).join('\n')}\n`
}

export function buildPlanningCreatePrompt(args: {
  featureSlug: string
  brief: string
  attachments?: string[]
}): string {
  const slug = args.featureSlug
  const brief = args.brief?.trim() || ''
  const attachments = Array.isArray(args.attachments) ? args.attachments.filter(Boolean) : []

  return `You are codex-designer. Create a deterministic planning output for a new feature.

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
  - Problem
  - Goals
  - Non-goals
  - Assumptions
  - Decisions (may be empty initially)
  - Design (high-level; include UI + data + integration notes as applicable)
  - Implementation Tasks (ordered checklist)
  - Validation (manual test checklist)
- Be practical and implementation-ready, but keep unknowns clearly marked as open questions.

### Q&A JSON requirements
- \`qna.version\` must be \`1\`
- \`qna.featureSlug\` must equal \`${slug}\`
- \`qna.updatedAt\` must be an ISO timestamp string
- \`qna.rounds\` must contain exactly one round: Round 1
  - \`round.id\`: \`round-1\`
  - \`round.title\`: \`Round 1\`
  - \`round.questions\`: ~6–10 high-signal questions unless the brief is extremely underspecified
- Each question must include:
  - \`id\`: stable, deterministic (e.g. \`r1-q1\`, \`r1-q2\`, ...)
  - \`prompt\`: the question text
  - \`options\`: 3–6 options with keys A–F and short, scannable text
  - \`recommendedKey\`: must match one of the option keys
  - \`answers\`: empty array (no answers yet)
- Exactly one option must have \`recommended: true\` (the recommended one).
`
}

export function buildPlanningNextRoundPrompt(args: {
  featureSlug: string
  nextRoundNumber: number
  additionalNotes?: string
}): string {
  const slug = args.featureSlug
  const nextRound = Math.max(1, Math.floor(args.nextRoundNumber || 1))
  const additionalNotes = String(args.additionalNotes ?? '').trim()

  const wrapUpMode = nextRound >= 6
  const finalStretch = nextRound >= 9
  const hardStop = nextRound >= 12

  const followUpCap = hardStop ? 0 : finalStretch ? 1 : wrapUpMode ? 3 : 8

  const lateStageGuidance = wrapUpMode
    ? `
## Wrap-up guidance (Round ${nextRound})
- This Q&A is already deep. Strongly prefer making reasonable inferences from prior rounds + the updated plan.
- Ask ONLY truly blocking questions that would materially change implementation.
- Maximum follow-ups this round: ${followUpCap}.
- Do NOT ask repeats or near-repeats of earlier questions. If the answer is already implied, make an assumption and record it in the plan.
- If there are no remaining high-signal ambiguities, return \`qnaRound.questions: []\` and set \`qnaRound.title\` to \`Round ${nextRound} (complete)\`.
${hardStop ? '- Hard stop: do not ask more questions; finalize the plan and return an empty questions list.\n' : ''}`
    : ''

  const notesBlock = additionalNotes
    ? `

## Additional notes (new requirements)
The user added these notes while reviewing the plan. Treat them as incremental requirements/clarifications:
${additionalNotes}
`
    : ''

  return `You are codex-designer. The user has answered the current Q&A.

Return ONLY valid JSON matching the provided output schema (no markdown fences, no extra keys, no commentary).

## Task
- Read \`docs/${slug}.qna.json\` and \`docs/${slug}.qna.md\` for the latest questions + answers.
- Update \`docs/${slug}.plan.md\` so it fully incorporates confirmed decisions and requirements.
- \`planMarkdown\` MUST be the full, complete contents for \`docs/${slug}.plan.md\` (not a diff).
- Generate ONLY the next set of follow-up questions as a single round object to append to \`docs/${slug}.qna.json\`.
${notesBlock}

## Follow-up rules (deterministic)
- Ask only high-signal questions that are still genuinely ambiguous.
- Do not ask "obvious" questions that can be inferred from the brief, plan, or prior rounds.
- Never ask duplicates of earlier questions (including reworded duplicates).
- Prefer documenting assumptions/decisions in the plan over asking another question.
- If "Additional notes" is present, prioritize clarifying those items before anything else.
- If "Additional notes" is present and any item is ambiguous, ask at least 1 follow-up question this round.
- Target follow-up count this round: 0–${followUpCap}. Zero is allowed when planning is complete.
- Each question MUST include 3–6 multiple-choice options and a recommended default.
- Do not rewrite or duplicate earlier rounds.
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
}

export function buildImplementationPrompt(args: { featureSlug: string }): string {
  const slug = args.featureSlug
  return `You are codex-designer in IMPLEMENTATION mode.

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
}

export function buildImplementationFollowupPrompt(args: {
  featureSlug: string
  message: string
  attachments?: string[]
}): string {
  const slug = args.featureSlug
  const message = args.message?.trim() || ''
  const attachments = Array.isArray(args.attachments) ? args.attachments.filter(Boolean) : []

  return `Continue the existing Codex implementation thread for \`${slug}\`.

The user is providing follow-up context (logs, build/test errors, screenshots) to address before continuing.

## Follow-up
${message || '(no message provided)'}${renderAttachments(attachments)}
`
}
