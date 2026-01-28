# codex-designer — Plan

Primary Q&A log: `docs/codex-designer.qna.md`

## Problem

Codex CLI is powerful, but planning, requirements Q&A, implementation, and manual validation are currently “chat-shaped” and easy to lose track of across repos/features. We want a **local UI** that:

- lets a user “babble” (text + images) about something to build,
- runs a **structured Q&A** (up to ~10 rounds) to lock requirements,
- produces/maintains **plan + Q&A + implementation notes** markdown artifacts,
- guides implementation from the same UI,
- generates and guides **manual feature testing**, including deferring tests and iterating on feedback.

## Goals

- Single-user, local-first interface to run a full workflow: **Brief → Q&A rounds → Plan → Implement → Test → Iterate**.
- Supports **new project in an empty repo** or **new feature in an existing repo** (user selects workspace path).
- “Q&A mode” is structured: each question can present **multiple-choice options** plus a freeform answer box.
- User can select **model**, **mode**, and **permissions** for runs (details in Q&A).
- Attachments: accept **pasted text and images** (clipboard) and associate them with a session.
- Planning artifacts:
  - `docs/[feature].plan.md` (source of truth for implementation)
  - `docs/[feature].qna.md` (Round N Q:/A:)
  - `docs/[feature].impl.md` (implementation notes / progress)
- Produce a **key features to test** checklist and guide manual testing with:
  - pass/fail/blocked/deferred per feature
  - ability to defer features for one or more rounds
  - capture feedback + attachments per test item
  - “Implement feedback” loop that returns to planning/implementation.

## Non-goals (initially)

- Multi-user / remote collaboration.
- Hosting or cloud storage; everything stays on local disk by default.
- Fully automated E2E testing framework (we’ll guide manual testing first; automation can be added later).

## Key decisions

- Packaging: **Electron desktop app** (v1).
- UI stack: **Vue + Tailwind** (dark-mode-first, material-inspired); **Material Symbols** primary icon set (Heroicons fallback).
- AI execution: **wrap Codex** via `@openai/codex-sdk` (Node 18+); do not re-implement Codex behavior in-app.
- Runner (v1): **SDK only** (the SDK wraps a bundled `codex` binary and streams JSONL events).
- Credentials: codex-designer does **not** manage credentials; rely on Codex’s existing auth/config.
- Model sources: **OpenAI only** (v1).
- Mode/permissions: support **presets + advanced panel** (v1).
- Advanced settings (v1): approval policy, sandbox mode, network on/off, working directory, model.
- Network toggle semantics (v1): “network=off” blocks network for tool/executed commands, but does not prevent model calls.
- Presets (v1): **Careful** and **YOLO** (YOLO = “no training wheels”).
  - Careful default mapping: `sandbox=workspace-write`, `approval=on-failure`, `network=off`.
  - YOLO default mapping: `sandbox=danger-full-access`, `approval=never`, `network=on`.
- Artifacts: write markdown artifacts into the target workspace under `docs/` by default; create `docs/` automatically if missing.
- New folder UX: when creating a new workspace folder, offer to run `git init`.
- Git before implementation: if the workspace is not a git repo, **prompt to `git init` before implementation runs**.
- Q&A rounds: **warn at 10 rounds** but allow override; allow editing prior answers **only before implementation starts**.
- Q&A edits (pre-implementation): treat changes as **corrections appended to the Q&A log** (no rewriting history); regenerate from the next round only, while preserving the evolution of answers.
- Plan regeneration (v1): do not auto-regenerate on correction; regeneration is part of the Q&A flow (explicit “Regenerate plan”/“Generate next round” action).
- Implementation safety (v1): no mandatory pre-apply diff review; let Codex apply changes directly (but show diffs after runs).
- Git checkpoints (v1): before implementation runs, require a clean working tree and record current `HEAD` as the checkpoint anchor (no empty commits).
- Git checkpoint constraints (v1):
  - If git working tree is dirty: refuse checkpoint creation and require the user to clean up manually before running implementation.
  - If working tree is clean: do not create an empty commit; record current `HEAD` as the checkpoint anchor.
  - Do not auto-commit after implementation runs; commit happens after acceptance/testing.
- Manual testing storage: **JSON “mini-db” + Markdown export**.
- Test deferrals: a **“defer this round” checkbox** per test item; deferred items reappear automatically next testing round.
- Attachments: store pasted images under the workspace in `docs/assets/...` with no enforced limits (v1).
- SDK limitations (v1): if a requested advanced setting isn’t supported, require explicit confirmation and run with best-effort settings (no direct CLI fallback in v1).
- App state:
  - Run logs + streamed events live in Electron `userData` only (per-machine).
  - Shareable workspace config lives in `.codex-designer/` (repo-local).
- Workspace profile export location (v1): `.codex-designer/share/profiles.json`.
- Workspace cache/state (v1): `.codex-designer/cache/state.json` (also used for plan↔Q&A sync metadata).
- Workspace profile shareability (v1): ask per workspace whether `.codex-designer/share/` should be gitignored (local-only) or committed (shareable); always gitignore `.codex-designer/cache/`.
- One-shot overrides (v1): in Careful, allow a single-run override with an explicit warning (scope: tool-network only).
- Implementation session persistence (v1): best-effort resume across app restarts; prefer a stable run/session identifier when available.
- Implementation resume fallback (v1): if true resume isn’t possible, start a new run with a structured recap + links to artifacts and prior run logs.
- Plan/Q&A gating (v1): block implementation in Careful when Q&A is newer than the last plan regeneration; allow in YOLO with a warning.
- Testing history (v1): store full per-round results in `docs/[feature].test.json` (statuses + feedback text/images).
- Testing rounds (v1): allow manual “Start testing round” and auto-create a new round after implementation runs when there were code changes and at least one key test is not `pass`.
- Testing round init (v1): when auto-creating a new round after code changes, reset previously-`pass` tests to `not_run` and carry forward `fail`/`deferred`/`blocked` as-is.
- Acceptance → commit workflow (v1):
  - Careful: acceptance requires all key tests are `pass` or `deferred` (no `fail`/`blocked`/`not_run`).
  - YOLO: allow manual acceptance override and allow committing even if acceptance is not met (with a warning).
- “Commit accepted changes” (v1): stage and commit all repo changes; commit message is auto-generated but editable.
- OS support: macOS + Windows + Linux (v1).
- Distribution: dev-only for now (no installers/packages required for v1).

## UX / IA (initial spec, refine in Q&A)

Default to an **App UI** (workflow/data-heavy), dark-mode-first, Tailwind-first, material-inspired.

- **Global shell**
  - Topbar: workspace picker, active feature/session, run profile (Careful/YOLO) + model, run button, theme toggle.
  - Sidebar: Projects/Workspaces, Sessions (Planning/Implementation/Testing), Files, Settings.
- **Core screens**
  1. Workspace picker/creator
     - Choose existing folder (repo) or create a new folder.
  2. “New work” wizard
     - Choose: “New project” vs “New feature”
     - Feature slug + brief + attachments
     - Select model/mode/permissions profile
  3. Q&A rounds (up to 10)
     - Master/detail: left list of questions; right detail with choices + freeform
     - Answer evolution: show “current answer” plus an expandable history of corrections (expanded by default)
     - “Generate next round” action (records to `docs/[feature].qna.md`, updates plan)
     - Clear states: incomplete answers, blocked questions, resolved questions
  4. Plan review
     - Render markdown plan with a “diff since last round”
     - Checklist view derived from the plan’s tasks/acceptance criteria
  5. Implementation
     - Start implementation run
     - Careful gating: block if plan is out-of-date vs Q&A (must regenerate plan first)
     - Git safety: require clean working tree; record `HEAD` as a checkpoint anchor (no empty commits); block runs if dirty
     - If requested settings can’t be applied (SDK limitation): show warning + require confirmation; run with best-effort settings
     - One-shot overrides: allow per-run override (Careful only) with prominent warning banner
     - Stream logs + show file diffs / changed files
     - Maintain `docs/[feature].impl.md` automatically (milestones, decisions, gotchas)
  6. Testing
     - “Key features to test” list (generated + editable)
     - Each test item: steps, expected result, attachments, status (`not_run`/pass/fail/deferred/blocked)
     - Testing rounds: track per-round results and feedback (text + images)
     - Acceptance: “All pass” gates acceptance in Careful; YOLO allows manual override
     - “Commit accepted changes” stages + commits all changes (after acceptance/testing)
     - “Implement feedback” launches a fix run scoped to failing items

## Technical design (initial, refine in Q&A)

### Electron + Vue (v1)

- **Main process (Node.js)**
  - Workspace access (create/select folders; optional `git init` on new folder; prompt to `git init` before implementation runs if not a repo).
  - Read/write markdown artifacts in `docs/` + attachments under `docs/assets/`.
  - Run orchestration for Codex via `@openai/codex-sdk`, streaming progress/events to the UI.
  - Crash-safe persistence for session metadata.
- **Renderer (Vue 3)**
  - Tailwind-first, dark-mode-first, material-inspired UI.
  - Q&A flows with structured choices + freeform answers.
  - Markdown plan viewer/editor and implementation log viewer.
  - Manual testing runner backed by JSON “mini-db” + markdown export.

### Codex integration (layer on top, not a replacement)

- codex-designer should **not** implement planning/implementation logic itself; it should orchestrate Codex runs (skills) and present a better UX around them.
- Runs should be configurable by the user: model, preset mode, advanced permissions/settings (approval policy, sandbox mode, network on/off, working directory).
- Implementation should run the equivalent of the `$implement-plan` skill against the generated plan file and maintain `docs/[feature].impl.md`.
- Codex auth is out of scope for codex-designer; users authenticate/configure Codex outside the app.
- “Implement feedback” should resume the current implementation session and add failed-test context (notes + attachments) to the prompt.

### Codex SDK details (v1, per Q&A)

- Runner: `@openai/codex-sdk` (Node 18+). The SDK wraps a bundled `codex` binary and streams JSONL events.
- Thread APIs: `startThread`, `resumeThread`, `run`, `runStreamed` (use `runStreamed` for the live UI timeline).
- No “fork/backtrack”: “reopen round” and corrections are implemented by starting a new thread and replaying a structured recap (plan + latest answers + links to artifacts).
- Structured outputs: use `outputSchema` for:
  - extracting/normalizing the plan into a UI-friendly JSON structure (stored in cache), and
  - generating/updating `docs/[feature].test.json`.
- Images: pass as structured inputs with `local_image` and store assets under `docs/assets/[feature]/...`.
- Permissions mapping: presets/advanced settings map directly to Codex config (`sandbox_mode`, `approval_policy`, `sandbox_workspace_write.network_access`).
- Stop behavior: SDK has no graceful cancel; v1 “Stop” kills the underlying subprocess and marks the run interrupted (workspace may be dirty).
- Diff UI: do not depend on SDK patch text; compute diffs via git from the checkpoint anchor (e.g. `git diff <checkpoint>..HEAD`).
- Future: if we outgrow SDK limitations (e.g. graceful cancel), switch runner to `codex app-server`.

### Artifacts and storage

- Primary artifacts live in the workspace under `docs/`:
  - `docs/[feature].plan.md`
  - `docs/[feature].qna.md`
  - `docs/[feature].impl.md`
  - `docs/[feature].test.json` (mini-db)
  - `docs/[feature].test.md` (readable export)
- Attachments live in the workspace under `docs/assets/[feature]/...` and are referenced from markdown and JSON.
- Repo-local config/state lives under `.codex-designer/`:
  - `.codex-designer/share/profiles.json` (exported run profiles; may be committed if workspace is “shareable”)
  - `.codex-designer/cache/state.json` (plan/Q&A sync metadata and other lightweight workspace state; always gitignored)
- App-global state (UI preferences, recent workspaces, run logs/streams, thread IDs) stored in Electron’s `userData` directory (cross-platform default).

## Implementation plan (scaffolding-first)

1. Bootstrap project
   - Initialize Electron + Vue + TypeScript + Tailwind (dark-mode-first)
   - Add house-style UI primitives (buttons, inputs, cards, chips, dialogs)
   - Configure Material Symbols (Heroicons fallback)
2. Define core data model + storage
   - Workspace registry
   - Session model (planning/implementation/testing)
   - Workspace config folders:
     - `.codex-designer/share/` (optionally committed)
     - `.codex-designer/cache/` (always gitignored)
   - Plan/Q&A sync metadata stored in `.codex-designer/cache/state.json` only
   - Run profiles:
     - Presets: Careful + YOLO (as defined above)
     - Advanced overrides: approval policy, sandbox mode, network on/off, working directory, model
     - Storage: global defaults in Electron `userData` + export/import per workspace into `.codex-designer/share/profiles.json`
   - Artifact file conventions and location rules
   - Q&A answer evolution: store corrections append-only and compute “current answer” as the latest entry
3. Build UI shell + navigation (material-inspired Tailwind house style)
4. Implement “New work” flow
   - feature slug + brief + attachments
   - model/mode/permissions profiles
5. Q&A engine UI
   - question list, choice rendering, freeform answers, completeness gating
   - round generation and persistence to `docs/[feature].qna.md`
6. Plan sync
   - render and edit `docs/[feature].plan.md`
   - show diff/changes between rounds
7. Codex integration
   - run “plan-task” and “implement-plan” flows via `@openai/codex-sdk`
   - SDK limitations: if requested settings cannot be applied, warn + require confirmation; then run best-effort
   - Git integration:
     - prompt to `git init` if workspace is not a repo (before implementation runs)
     - before implementation runs: require a clean working tree and record current `HEAD` as the checkpoint anchor (no empty commits)
     - if the working tree is dirty: block the run and ask the user to clean up manually
     - after acceptance/testing: provide a “Commit accepted changes” action that stages all changes and opens an editable auto-generated commit message
   - Maintain an “implementation session” concept so “Implement feedback” can resume with context
   - If a prior session cannot be resumed, start a new run with a structured recap + links to prior artifacts/logs
   - Stop/cancel: implement “Stop” by killing the underlying runner subprocess and marking the run interrupted
   - stream logs, capture outputs, update `docs/[feature].impl.md`
8. Testing module
   - generate editable “key features to test” into JSON mini-db + markdown export
   - guided runner with status + “defer this round” + feedback capture (text + images)
   - JSON supports per-round test results (full history), with statuses: `not_run`, `pass`, `fail`, `deferred`, `blocked`
   - Support manual “Start testing round” and auto-create a new round after implementation runs when there were code changes and at least one test is not `pass`
   - Auto-round init: reset prior `pass` → `not_run`; carry `fail`/`deferred`/`blocked` forward
   - “implement feedback” resumes implementation session and supplies failed-test context to Codex
9. Polishing
   - robust empty/loading/error states
   - keyboard shortcuts (run, next question, mark deferred)
   - crash-safe persistence and recovery on restart

## Validation checklist (for codex-designer itself)

- Create a new workspace session and generate `docs/[feature].plan.md` + `docs/[feature].qna.md`.
- Run at least 2 Q&A rounds; confirm docs update correctly and remain the source of truth.
- Paste an image from clipboard; confirm it’s stored and linked in the session.
- Switch model/mode/permissions profile and confirm it affects the next run.
- Verify Careful/YOLO preset mappings match expected behavior.
- Export/import run profiles for a workspace and confirm they round-trip.
- Trigger implementation; confirm logs stream, diffs display, and `docs/[feature].impl.md` updates.
- Verify Careful blocks implementation if Q&A is newer than the last plan regeneration; YOLO warns but can proceed.
- Verify one-shot override in Careful is a one-run-only toggle and is clearly warned.
- Confirm unsupported-advanced-settings warning + confirmation flow works (SDK limitation).
- In a git workspace, confirm runs are blocked when the working tree is dirty, and `HEAD` is recorded as a checkpoint anchor when clean.
- Confirm there is no auto-commit after implementation runs, and “Commit accepted changes” works after testing.
- Generate testing checklist; mark items pass/fail/deferred; defer an item and resume later.
- Fail a test, submit feedback + attachment, and run an “implement feedback” loop.

## Open questions

None (defaults chosen; see `docs/codex-designer.qna.md` for history).
