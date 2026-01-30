# codex-designer — Q&A

Related plan: `docs/codex-designer.plan.md`

## Round 1

### 1) Packaging / runtime

Q: What should the first deliverable be?
- A) Electron desktop app (best FS + process spawning + clipboard)
- B) Local web app (Node backend + browser UI)
- C) Start as local web app, then package via Electron later
A: A

### 2) AI execution model

Q: How should the tool “run Codex” under the hood?
- A) Spawn `codex` CLI as a subprocess and stream its output into the UI
- B) Call an AI provider API directly (OpenAI/etc) and implement our own “skills” runner
- C) Hybrid: planning via direct API, implementation via `codex` subprocess
A: Use the Codex SDK and CLI when needed.

Q: If spawning `codex`, should we assume it’s already installed on the machine?
- A) Yes, external dependency is fine
- B) No, bundle it / vendor it
- C) Not sure yet
A: A

### 3) Model / mode / permissions

Q: Which “mode” and “permissions” do you want exposed in the UI?
- A) Mirror Codex concepts (e.g. approval policy, sandbox mode, network access)
- B) App-specific presets (Safe / Normal / Full access) that map to Codex settings internally
- C) Both (advanced panel)
A: C

Q: Which model sources should be supported initially?
- A) OpenAI only
- B) OpenAI + Azure OpenAI
- C) OpenAI + “any OpenAI-compatible” endpoint
- D) Other:
A: A

### 4) Workspace + artifact conventions

Q: Where should codex-designer store its markdown artifacts by default?
- A) In the target workspace under `docs/`
- B) In a repo-local hidden folder (e.g. `.codex-designer/`) and optionally export to `docs/`
- C) In a global folder (e.g. `~/.codex-designer/`) with links back to the repo
A: A -- also offer to run git init on a new folder

Q: Should codex-designer create `docs/` if missing, or ask first?
- A) Create automatically
- B) Ask / require confirmation per workspace
A: A

### 5) Q&A round mechanics

Q: Do you want the UI to enforce a hard cap of 10 rounds, or just warn?
- A) Hard cap
- B) Warn + allow override
A: B

Q: Should users be able to edit prior answers after moving to the next round?
- A) Yes (with explicit “reopen round” and regenerate plan)
- B) No (append-only, but allow new clarifications)
- C) Yes, but only before implementation starts
A: C

### 6) Implementation flow

Q: What does “Implement it from the interface” mean for v1?
- A) One-button run that applies changes immediately
- B) Run + show proposed diff(s) + require explicit “Apply” confirmation
- C) Generate patch files only; user applies manually
A: Actually run codex with the $implement-plan skill on the plan file that has been generated as a result of the back and forth.
A: Use deterministic prompts (based on the skill guidance) so the app does not require the skill to be installed; still run via Codex SDK and keep `docs/[feature].impl.md` as the implementation log.

Q: During implementation runs, should codex-designer be allowed to run shell commands in the workspace?
- A) Yes, but with step-level approvals shown in UI
- B) Yes, no prompts (power-user)
- C) No, file edits only
A: wrap codex sdk -- let codex do the actual work. don't try and implement codex from scratch, this is meant to be a layer on top to make it easier, not a full-fledged replacement. this allows users to use their own chatgpt logins, etc.

### 7) Manual testing workflow

Q: How should “key features to test” be represented?
- A) A markdown checklist file in `docs/` (e.g. `docs/[feature].test.md`)
- B) A structured JSON file + an optional markdown export
- C) Stored only in the app state (not ideal, but simplest)
A: A and B -- JSON should be edited and used as a mini-db --- markdown for user readability

Q: How should deferrals work?
- A) Per test item, with a “defer until round N” field
- B) Per test item, with freeform “blocked by …” notes and no fixed round number
- C) Both
A: Just a checkbox to defer for that current round.

### 8) Attachments (text/images)

Q: Where should pasted images be stored?
- A) Under the workspace (e.g. `docs/assets/[feature]/...`)
- B) Under a repo-local app folder (e.g. `.codex-designer/attachments/...`)
- C) Under a global app folder (e.g. `~/.codex-designer/attachments/...`)
A: A

Q: Any constraints we should enforce?
- A) Max image size (MB): ___
- B) Strip metadata (EXIF) on import: Yes/No
- C) Allowed types: PNG/JPG/WebP/…
A: No restrictions for now.

### 9) “Beautiful UI” baseline

Q: Any strong preferences for the UI stack?
- A) React + Tailwind (+ Headless UI)
- B) Vue + Tailwind
- C) Svelte + Tailwind
- D) Other:
A: B

Q: Icon set preference?
- A) Heroicons
- B) Lucide
- C) Material Symbols
- D) Other:
A: C (primary with A as a fallback)

## Round 2

### 1) Codex integration details

Q: When you say “Codex SDK”, what should v1 do in practice?
- A) Spawn `codex` CLI only (subprocess) and stream output
- B) Use a Codex Node SDK if available; fallback to spawning the CLI
- C) SDK only (no subprocess), even if it’s more work
- D) Other: (describe expected interface)
A: C --> B as a last resort

Q: Should codex-designer manage credentials at all?
- A) No; rely entirely on Codex’s existing auth/config (user logs in outside the app)
- B) Yes; allow setting API key / env vars per run profile in the UI
- C) Both (default to A, with an advanced override)
A: A

### 2) Run profiles (model / mode / permissions)

Q: What exactly should be configurable in v1 “Advanced”?
- A) approval policy, sandbox mode, network on/off, working directory, model
- B) A + runtime limits (timeouts, max steps) and generation params (if supported)
- C) Keep v1 minimal: model + 2–3 presets only
A: A

Q: What presets should we ship with by default (names + what they map to)?
A: Careful and YOLO.. best judgement on both --- YOLO should be no training wheels.

### 3) Implementation safety / diff review

Q: Do you want a mandatory review step before changes land on disk?
- A) Yes: require a clean git tree; run; show diff; user clicks “Apply”
- B) Optional: show diff, but allow auto-apply
- C) No: let Codex apply changes directly
A: C

Q: If the workspace is not a git repo, should codex-designer offer to `git init` before implementation runs?
- A) Yes, always prompt
- B) Yes, but only for “new project” workspaces
- C) No
A: A

### 4) Editing answers (pre-implementation)

Q: If a user edits an earlier answer before implementation starts, what should happen?
- A) “Reopen round”: regenerate plan starting from that round forward (keep an audit trail)
- B) Append a correction note; only regenerate the next round
- C) Disallow editing content; only allow new clarifications (despite earlier preference)
A: B

### 5) Manual testing deferrals

Q: For “defer this round”, should a deferred test automatically reappear in the next testing round?
- A) Yes (and it’s “not evaluated” until you run it)
- B) No (deferred stays deferred until manually un-deferred)
- C) Support both behaviors per item
A: A

### 6) File conventions

Q: Confirm these v1 paths (or propose alternatives):
- `docs/[feature].test.json` (mini-db)
- `docs/[feature].test.md` (readable export)
- `docs/assets/[feature]/...` (attachments)
A: Confirmed

### 7) OS / distribution

Q: Which OSs should v1 target?
- A) macOS only
- B) macOS + Windows
- C) macOS + Windows + Linux
A: C

Q: Preferred distribution format (if any): DMG / ZIP / installer / “dev only for now”?
A: dev only for now

## Round 3

### 1) Preset mappings (Careful / YOLO)

Q: You said “best judgement” for presets — confirm these default mappings for v1?

Careful (default safe):
- A) `sandbox=workspace-write`, `approval=on-request`, `network=off`
- B) `sandbox=workspace-write`, `approval=on-failure`, `network=off`
- C) Other (describe)
A: B

YOLO (no training wheels):
- A) `sandbox=danger-full-access`, `approval=never`, `network=on`
- B) `sandbox=danger-full-access`, `approval=on-failure`, `network=on`
- C) Other (describe)
A: A

### 2) SDK vs CLI fallback behavior

Q: If the Codex SDK cannot support a requested setting (e.g. sandbox/network/approval) or cannot run the needed “skill flow”, how should v1 behave?
- A) Transparently fall back to spawning the `codex` CLI for that run
- B) Fall back, but show a warning + require explicit confirmation in the UI
- C) Do not fall back; instead disable that capability in the UI until the SDK supports it
A: B

### 3) App state location

Q: Is it acceptable that run profiles + recent workspaces live in Electron `userData` (per-machine), while the actual artifacts live in the workspace `docs/`?
- A) Yes
- B) Prefer everything repo-local
- C) Both: global defaults, but allow exporting/importing profiles per workspace
A: C

### 4) Git safety (undo)

Q: Since there’s no mandatory pre-apply diff review, do you want an optional “checkpoint” before implementation runs?
- A) Yes: offer “Create checkpoint commit” when git is available (default on in Careful)
- B) Optional toggle only (default off)
- C) No checkpoint support in v1
A: Default to commit locally before implementations. Autogen commit message based on changes (like on nano-model summary)

### 5) Q&A “corrections” UX

Q: For pre-implementation edits that become appended corrections (not rewriting history), how should the UI show the “current answer”?
- A) Latest correction is the current answer; show history collapsed/expandable
- B) Original answer stays “current”; corrections are notes only
- C) Other (describe)
A: Append to the end of the doc in the current round -- pull it forward preserve the previous round to show the evolution of the thought process around the concept.

### 6) Testing rounds + history

Q: How should `docs/[feature].test.json` track testing rounds?
- A) Store only current status per test, plus a lightweight per-round summary history
- B) Store full per-round results (each round has statuses/notes/attachments)
- C) No history; latest only
A: B

Q: Confirm statuses needed per test item (v1):
- A) `not_run`, `pass`, `fail`, `deferred`, `blocked`
- B) `pass`, `fail`, `deferred` only (keep it minimal)
- C) Other (describe)
A: A - plus feedback lines (text+image)

### 7) “Implement feedback” behavior

Q: When you click “Implement feedback” from failed tests, should codex-designer:
- A) Run implementation only (patch code) using failing tests/notes as input; do not rewrite the plan
- B) Update the plan first (so plan stays source of truth), then run implementation
- C) Ask each time (A/B)
A: Resume implementation session and add feedback to the prompt with test context

## Round 4

### 1) “Network on/off” semantics

Q: In presets/advanced settings, what should “network=off” actually mean?
- A) Disallow network for tool/executed commands (e.g. `npm install`, `curl`), but model calls still work
- B) Fully offline (no model calls / no installs) — only local edits
- C) Other (describe)
A: A

### 2) Git checkpoint details

Q: For the default pre-implementation checkpoint commit, what should happen if the git working tree is dirty?
- A) Commit all current changes (staging automatically) as the checkpoint
- B) Prompt user to choose what to include (stage/unstage UI)
- C) Refuse and ask user to clean up manually
A: C

Q: If the working tree is clean, should we create an empty checkpoint commit anyway?
- A) Yes (for a consistent undo anchor)
- B) No (just remember the current HEAD as the checkpoint)
A: B

Q: After an implementation run finishes, should codex-designer also offer to auto-commit the new changes?
- A) Yes (default on in Careful, off in YOLO)
- B) Yes (default on in both)
- C) No (checkpoint only)
A: C - commit happens after acceptance/testing.

### 3) Profile export/import format + location

Q: When exporting run profiles per workspace, where should the exported file live?
- A) `docs/.codex-designer/profiles.json`
- B) `.codex-designer/profiles.json` (repo root)
- C) `docs/codex-designer.profiles.json`
- D) Other:
A: B

### 4) Implementation session persistence

Q: For “resume implementation session”, should sessions be resumable across app restarts?
- A) Yes (store a stable session/run identifier)
- B) No (resume only within the current app session)
- C) Best effort (resume when possible; otherwise start a new session)
A: C (prefer A)

### 5) Q&A corrections + plan regeneration UX

Q: When a correction is appended, should codex-designer automatically regenerate the plan (from the next round), or require an explicit action?
- A) Auto-regenerate immediately
- B) Require clicking “Regenerate plan”
- C) Ask each time
A: B - should be part of the Q&A rounds

Q: In the UI, how should the “current answer” vs history be displayed?
- A) Show current answer (latest), with a collapsible “Answer history” timeline
- B) Always show the full evolution inline (no collapse)
- C) Other:
A: A - but expanded by default

### 6) Testing rounds + feedback schema

Q: What should start a new “testing round” in `docs/[feature].test.json`?
- A) Each time the user clicks “Start testing round”
- B) Each time after an implementation run completes
- C) Both (A is manual; B auto-creates a new round if tests change)
A: C

Q: For feedback lines (text + images), should we store them:
- A) On the test item overall (shared across rounds)
- B) Per-round, per-test item (recommended)
- C) Per-failure only (when status = fail)
A: B

## Round 5

### 1) Workspace config + git hygiene

Q: Should `.codex-designer/` be gitignored by default?
- A) Yes, add to `.gitignore` automatically (profiles are local-only)
- B) No, keep it commit-friendly by default (teams can share profiles)
- C) Ask per workspace (“Local only” vs “Shareable in repo”)
A: C

### 2) Acceptance → commit workflow

Q: What should “acceptance” mean for enabling a final commit?
- A) All “key features to test” are `pass` (no fails/blocked), then allow “Commit accepted changes”
- B) Manual “Mark accepted” toggle independent of test statuses
- C) Both (A gates by default in Careful; YOLO allows manual override)
A: C

Q: When the user clicks “Commit accepted changes”, should codex-designer:
- A) Stage and commit all changes in the repo
- B) Show a simple file list for inclusion/exclusion (no full staging UI)
- C) Require the user to stage manually outside the app
A: A

### 3) Auto “testing rounds” trigger

Q: For “auto-create a new testing round after implementation runs when tests change”, what should count as “tests change” in v1?
- A) Any implementation run that modifies files in the workspace
- B) Only if the test definition list changes (`docs/[feature].test.json` items added/removed/edited)
- C) Only if there were code changes AND at least one test is not `pass`
- D) Other:
A: C

### 4) One-shot overrides (network, sandbox, approvals)

Q: In Careful preset, should the UI allow a one-shot override for a single run (e.g. temporarily enable tool-network for `npm install`)?
- A) Yes (explicit per-run override with clear warning)
- B) No (must change the active profile)
- C) Yes, but only via Advanced panel
A: A

### 5) Implementation session resume semantics

Q: If we cannot truly “resume” a prior Codex session (SDK limitation), should codex-designer:
- A) Start a new session but include a structured recap + links to artifacts/run logs as context
- B) Start a new session with no recap (clean slate)
- C) Block and require SDK resume support
A: A

### 6) Plan/Q&A consistency gating

Q: When Q&A has new answers/corrections that haven’t been folded into the plan yet, should codex-designer block implementation until “Regenerate plan” runs?
- A) Yes (plan must be source of truth before implementation)
- B) No (allow implementation but warn)
- C) Only block in Careful; YOLO can proceed
A: C

## Round 6

### 1) `.codex-designer/` contents + gitignore strategy

Q: Since you want to choose “Local only” vs “Shareable in repo” per workspace, should we split `.codex-designer/` into:
- A) `.codex-designer/share/` (profiles, committed if shareable) + `.codex-designer/cache/` (always gitignored: run logs, snapshots, etc.)
- B) Keep a single folder and just toggle gitignore on/off for the whole thing
- C) Other (describe)
A: A

Q: Regardless of shareability, should run logs (stream output, diffs, checkpoints metadata) be kept:
- A) Repo-local under `.codex-designer/cache/`
- B) Only in Electron `userData`
- C) Both (cache in repo for portability; userData for recent/perf)
A: B

### 2) Acceptance gating semantics

Q: In Careful preset, should “All tests pass” mean:
- A) Every key test status is `pass` (so `deferred`/`blocked`/`not_run` prevent acceptance)
- B) `pass` or `deferred` is acceptable (allow acceptance with deferred items)
- C) Other (describe)
A: B

### 3) “Commit accepted changes” details

Q: You want “stage + commit all changes”. If there are still failing/unrun tests, should YOLO allow committing anyway?
- A) Yes (manual override)
- B) No (commit action always gated by acceptance)
A: A

Q: Should the commit message be:
- A) Auto-generated but editable before commit
- B) Fully auto (no edit)
- C) Manual entry only (no generator)
A: A

### 4) Plan/Q&A sync metadata

Q: To enforce “plan must be source of truth” in Careful, where should we store the “plan generated from Q&A up to round N / hash” metadata?
- A) In `.codex-designer/cache/state.json` only (no changes to docs)
- B) As a small machine-readable footer/header in the plan/Q&A markdown (portable across machines)
- C) Both
A: A

### 5) Auto new testing round behavior

Q: When we auto-create a new testing round after code changes (and some tests aren’t `pass`), how should the new round initialize statuses?
- A) Copy previous round statuses forward as defaults
- B) Reset all to `not_run` (previous round remains as history)
- C) Reset only previously-`pass` tests to `not_run` (keep fail/deferred/blocked)
A: You choose. 
Decision (default): C

### 6) One-shot override scope (Careful)

Q: Which settings should be eligible for a one-shot override in Careful?
- A) Network only (tool/executed commands)
- B) Network + approval policy
- C) Network + approval + sandbox
- D) Other (describe)
A: I don't care. Just choose something that makes sense. I'll be using YOLO all the time anyway.
Decision (default): A


Some additional notes about the SDK and overall direction -- (note that I would like for this to be the last round of questions... just choose defaults... i want to be able to use this tool to further iterate on this tool in a way that has less friction.)

Notes:
## SDK clarifications (final)

- v1 uses `@openai/codex-sdk` (Node 18+) as the only runner.
  - Note: the SDK wraps a bundled `codex` binary, spawns it as a subprocess, and streams JSONL events over stdin/stdout.
- Thread API surface we can rely on in v1: `startThread`, `resumeThread`, `run`, `runStreamed`.
  - No native “fork/backtrack” API. “Reopen round” and “corrections” are implemented by starting a new thread and replaying a structured recap (plan + Q&A answers + links to artifacts).
- Streaming + UI:
  - `run()` buffers until completion.
  - `runStreamed()` drives the live UI timeline (agent messages, tool/command progress, file change notifications, turn completion).
- Structured output:
  - We use `outputSchema` for plan JSON and for `docs/[feature].test.json` generation/updates.
- Images:
  - We use structured inputs with `local_image` and store assets under `docs/assets/[feature]/...`.
- Security / permissions:
  - Network is OFF by default. Network ON is an explicit per-run override (Careful default stays off; YOLO = enable).
  - Presets map directly to Codex config: `sandbox_mode`, `approval_policy`, and `sandbox_workspace_write.network_access`.
- Stop/cancel behavior (important):
  - The SDK does not expose an `abort()` / `cancel()` for an in-flight `run()` or `runStreamed()` turn.
  - v1 “Stop” = hard-stop the underlying subprocess and mark the run as interrupted; the workspace may be left dirty.
  - Careful safety net: require clean git tree + create a checkpoint commit before implementation runs.
- Diff UI behavior:
  - The SDK can emit file-change notifications, but v1 does NOT depend on receiving full patch/diff text from the SDK.
  - Diff view uses `git diff` from the checkpoint commit.
- When we outgrow SDK:
  - If we need graceful turn cancellation or richer interactive controls, we switch the runner to `codex app-server` (same UI contract, better control primitives).
