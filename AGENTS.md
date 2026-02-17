# AGENTS

Purpose: this file gives local guidance for contributors and coding agents working in this repository.

## Repository shape

- `electron/` contains all privileged process code (main process, IPC handlers, Codex runner, git/filesystem operations).
- `src/` contains the Vue 3 renderer application.
- `docs/` contains generated workflow artifacts and planning references for the app itself.
- `public/` and `build/` contain app assets.

## Core principles

- Treat Electron boundaries as security boundaries.
  - UI should not execute shell/filesystem logic directly.
  - All privileged operations should flow through typed IPC handlers.
- Keep persistence paths validated:
  - workspace writes should remain under expected workspace roots unless explicitly intended.
  - prefer `safePath` checks for user-provided paths.
- Preserve existing UX patterns for the workbench and session workflow.
- Prefer small, incremental changes with clear migration intent.
- Keep logging explicit and action-oriented; avoid dumping sensitive content.

## Local workflow defaults

- Use `npm run dev` for local iteration.
- Use `npm run build` before asking for release-like reviews.
- Keep formatting consistent with existing TypeScript/Vue style.
- Keep IPC payloads in TypeScript-safe shapes and avoid broad `any` propagation.
- When touching model selection/run logic:
  - keep profile/model defaults and per-mode settings in sync
  - keep run lifecycle events emitted and persisted consistently

## Contributor constraints

- Minimize changes to unrelated files.
- Do not add dependencies without explaining the tradeoff.
- Do not alter build scripts unless release behavior requires it.
- Avoid editing app behavior in multiple layers (renderer + main + preload + docs) unless coordinated in one change set.

## File-level expectations

- `src/lib/*` should hold shared UI domain logic.
- `src/components/*` should stay presentation + interaction-oriented.
- `electron/lib/*` should hold orchestration and persistence primitives.
- `electron/ipc.ts` should validate and sanitize inbound IPC inputs.

## Safety notes

- Do not store secrets in localStorage, workspace markdown artifacts, or debug logs.
- If you introduce or handle new environment variables, document them in `SECURITY.md` and README.
- For any new user-facing shell command execution, require explicit user action and surface clear errors.

