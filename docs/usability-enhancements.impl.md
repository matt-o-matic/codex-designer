# usability-enhancements — Implementation Log

## Status (2026-02-04)
Current focus: initialize implementation log + begin unified workbench refactor.

## TODO (from `docs/usability-enhancements.plan.md`)
- [ ] 1) Replace navigation with a unified workbench screen.
- [ ] 2) Build sidebar tree (workspaces → sessions) with persisted expand/selection state.
- [ ] 3) Remove session flyout; render selected session in the main panel.
- [ ] 4) Implement per-mode timelines (Planning/Implementation/Testing) with reusable card components.
- [ ] 5) Implement bottom dock (config row + target dropdown + expandable composer + attachments).
- [ ] 6) Planning timeline: round cards + inline plan doc card + control cards for planning actions.
- [ ] 7) Testing timeline: test round cards + inline test doc card + control cards for testing actions.
- [ ] 8) Implementation timeline: run cards (final markdown + collapsible diagnostics) + follow-ups via composer.
- [ ] 9) Load persisted run logs for history; merge with live run-store updates.
- [ ] 10) Add session activity indicators in sidebar (spinner + work-type icon).
- [ ] 11) Create workspace edit side sheet and migrate workspace-scoped controls (run defaults, profiles, shareability, runner playground).
- [ ] 12) Add `Apply model` / `Apply model + thinking` to run defaults.
- [ ] 13) Implement house style markdown read/write + editor/preview; show sidebar preview.
- [ ] 14) Inject house style into planning + implementation prompt builders.
- [ ] 15) Implement Git IPC + UI panel (with confirmation + stdout/stderr output viewer).
- [ ] 16) Implement `Open in VS Code` action with fallback behavior.

## Work log
### 2026-02-04
- Read: `docs/usability-enhancements.plan.md`, `docs/usability-enhancements.qna.md`.
- Created: `docs/usability-enhancements.impl.md`.
- Implemented initial unified Workbench scaffolding:
  - Added `src/pages/WorkbenchPage.vue` and routed `/workspace`, `/session/*`, `/settings` → `/`.
  - Added `src/lib/workbenchUi.ts` for persisted expand/selection state.
  - Updated sidebar to a workspace → sessions tree (`src/components/AppSidebar.vue`, `src/components/AppSidebarMobile.vue`).
  - Added a placeholder session panel (`src/components/SessionWorkbench.vue`) rendered in the main panel (no flyout).
  - Extended app state cache for multi-workspace sidebar rendering (`src/lib/appState.ts`).
  - Extended run store to track `workspacePath` for activity indicators (`src/lib/runStore.ts`).

Commands run:
- `npm run typecheck` → failed (`node`/`npm` not available in this environment).

### 2026-02-04 (continued)
- Implemented session-as-main-panel workbench UX:
  - Session view now renders as a chat-like set of per-mode timelines (Planning / Implementation / Testing).
  - Bottom dock includes: mode toggles, always-visible config row, target dropdown, and an expandable composer with image paste.
  - Final responses render as full markdown in run cards; diagnostics are collapsible.
  - Persisted run logs are loaded and merged with live run-store updates.
- Added workspace edit side sheet (workspace-scoped v1 settings):
  - Shareability + git init + status.
  - Run defaults (all roles) with `Apply model` + `Apply model + thinking`.
  - House style markdown editor + preview (stored at `.codex-designer/share/house-style.md`) + sidebar preview.
  - Profiles (import/export + edit modal) and runner playground.
  - Git panel v1 (fetch/pull/push, checkout/create branch, merge) with stdout/stderr viewer + confirmations.
  - `Open in VS Code` action with `code` CLI → OS open fallback and clear errors.
- Injected house style into planning + implementation prompt builders.

Commands run (local Node toolchain bootstrapped into `/tmp/codex-node`):
- `node -v` → `v20.11.1` (used for initial `npm` availability).
- `node -v` → `v22.11.0` (required for Vite/plugin-vue; provides `crypto.hash`).
- `npm run typecheck` (Node `v22.11.0`) → OK.
- `npm run build` (Node `v22.11.0`) → OK.

Automated tests:
- No existing test framework in this repo; no deterministic tests added in this implementation.

TODO status snapshot (2026-02-04):
- [x] 1) Replace navigation with a unified workbench screen.
- [x] 2) Build sidebar tree (workspaces → sessions) with persisted expand/selection state.
- [x] 3) Remove session flyout; render selected session in the main panel.
- [x] 4) Implement per-mode timelines (Planning/Implementation/Testing) with reusable card components.
- [x] 5) Implement bottom dock (config row + target dropdown + expandable composer + attachments).
- [x] 6) Planning timeline: round cards + inline plan doc card + control cards for planning actions.
- [x] 7) Testing timeline: test round cards + inline test doc card + control cards for testing actions.
- [x] 8) Implementation timeline: run cards (final markdown + collapsible diagnostics) + follow-ups via composer.
- [x] 9) Load persisted run logs for history; merge with live run-store updates.
- [x] 10) Add session activity indicators in sidebar (spinner + work-type icon).
- [x] 11) Create workspace edit side sheet and migrate workspace-scoped controls (run defaults, profiles, shareability, runner playground).
- [x] 12) Add `Apply model` / `Apply model + thinking` to run defaults.
- [x] 13) Implement house style markdown read/write + editor/preview; show sidebar preview.
- [x] 14) Inject house style into planning + implementation prompt builders.
- [x] 15) Implement Git IPC + UI panel (with confirmation + stdout/stderr output viewer).
- [x] 16) Implement `Open in VS Code` action with fallback behavior.

### 2026-02-04 (follow-up)
User concern: ensure “thread” history is preserved per mode (Planning / Implementation / Testing), otherwise the chat-style UX breaks.

Implemented:
- Persist/resume testing thread IDs (previously only planning+implementation persisted).
  - Workspace state now supports `testingThreadId` under `.codex-designer/cache/state.json`.

Commands run:
- `export PATH=/tmp/codex-node/node-v22.11.0-darwin-arm64/bin:$PATH && npm run typecheck` → OK.
- `export PATH=/tmp/codex-node/node-v22.11.0-darwin-arm64/bin:$PATH && npm run build` → OK.

### 2026-02-13
Requested UX improvement: show which files changed during runs (with basic diff stats), appended to the end of the run card (and updating live while a run is streaming).

Implemented:
- Added a Git worktree summary IPC (`codex-designer:get-git-worktree-summary`) returning per-file status + `+adds/-dels` (best-effort; untracked files get approximate `+lines` when small text).
- Run store now refreshes the worktree summary when files change / commands complete, and once more at run end.
- Run cards render an “Edited files” section after the final response markdown.
- Run cards now stream `finalResponse` live from `agent_message` item updates (previously could appear only at completion, depending on event ordering).
- IPC handlers are registered before the main window is created (avoids “No handler registered” races during dev reloads); the renderer also retries briefly if the handler isn’t ready yet.

Commands run:
- `npm run typecheck` → OK.
- `npm run build` → OK.
- `npm run pack` → OK.

### 2026-02-04 (follow-up 9)
Request: show an explicit TODO overlay when Codex emits `todo_list` items; place it bottom-right above the input dock.

Implemented:
- Added a floating TODO overlay anchored to the bottom dock, shown when a running session run emits a `todo_list` item event (`src/components/SessionWorkbench.vue`).
  - Prefers the currently-targeted mode’s running run; falls back to the most recent running run.
  - Shows checklist items + completion count; dismissible per-run.

Commands run:
- `export PATH=/tmp/codex-node/node-v22.11.0-darwin-arm64/bin:$PATH && npm run typecheck` → OK.
- `export PATH=/tmp/codex-node/node-v22.11.0-darwin-arm64/bin:$PATH && npm run build` → OK.

### 2026-02-04 (follow-up 5)
Request: add timestamps to chat entries.

Implemented:
- Added human-readable timestamps to run history cards (both the “You” message and the Codex response header).

Commands run:
- `export PATH=/tmp/codex-node/node-v22.11.0-darwin-arm64/bin:$PATH && npm run typecheck` → OK.
- `export PATH=/tmp/codex-node/node-v22.11.0-darwin-arm64/bin:$PATH && npm run build` → OK.

### 2026-02-04 (follow-up 4)
Request: add timestamps to chat entries.

Implemented:
- Added human-readable timestamps to run history cards (both the “You” message and the Codex response header).

Commands run:
- `export PATH=/tmp/codex-node/node-v22.11.0-darwin-arm64/bin:$PATH && npm run typecheck` → OK.
- `export PATH=/tmp/codex-node/node-v22.11.0-darwin-arm64/bin:$PATH && npm run build` → OK.

### 2026-02-04 (follow-up 3)
UX fixes requested:
- Left sidebar scrolls independently from the main panel.
- Session history reads like a chat (oldest → newest, not newest-first).
- User composer prompts are persisted and rendered in history.

Implemented:
- Independent scroll containers:
  - App layout now uses a fixed-height viewport with `overflow-hidden`; sidebar and main content have their own `overflow-y-auto`.
- Chronological history:
  - Run cards are sorted oldest → newest.
  - Testing rounds no longer render newest-first.
- Persist and render user prompts:
  - `startRun` now accepts `uiAction` + `uiUserMessage` and persists them in run log meta.
  - Run cards render a “You” block (with attachment previews) when `uiUserMessage` is present.

Commands run:
- `export PATH=/tmp/codex-node/node-v22.11.0-darwin-arm64/bin:$PATH && npm run typecheck` → OK.
- `export PATH=/tmp/codex-node/node-v22.11.0-darwin-arm64/bin:$PATH && npm run build` → OK.

### 2026-02-04 (follow-up 2)
Bug: `SessionWorkbench.vue` threw `ReferenceError: Cannot access 'runLogsLoading' before initialization` when the immediate watcher called `loadRunLogs()` before `runLogsLoading`/`runLogsById` were initialized.

Implemented:
- Moved run-log state refs (`runLogsLoading`, `runLogsById`) above the immediate `watch()` that triggers `loadRunLogs()`.

Commands run:
- `export PATH=/tmp/codex-node/node-v22.11.0-darwin-arm64/bin:$PATH && npm run typecheck` → OK.
- `export PATH=/tmp/codex-node/node-v22.11.0-darwin-arm64/bin:$PATH && npm run build` → OK.

### 2026-02-04 (follow-up 6)
Request: add timestamps to chat entries.

Implemented:
- Added human-readable timestamps to run history cards (both the “You” message and the Codex response header).

Commands run:
- `export PATH=/tmp/codex-node/node-v22.11.0-darwin-arm64/bin:$PATH && npm run typecheck` → OK.
- `export PATH=/tmp/codex-node/node-v22.11.0-darwin-arm64/bin:$PATH && npm run build` → OK.

### 2026-02-04 (follow-up 7)
Requested usability improvements:
- If a run is “running” but its PID is no longer alive, mark it failed (crashed/aborted UX fix).
- Sidebar: auto-load sessions for all workspaces, add search, per-workspace “new feature” + “edit workspace”, and make the left panel resizable.

Implemented:
- Run PID liveness checks:
  - Active runs now monitor their PID while tailing the events file; if the PID disappears, emit `run.failed` (`electron/lib/codexRuns.ts`).
  - Persisted run logs: any stale `status: running` log with a dead PID is repaired to `failed` and a synthetic `run.failed` event is appended (`electron/lib/runLogs.ts`).
- Sidebar UX:
  - Added `getWorkspaceSummary` preload API and background-prefetch of workspace summaries so all workspaces show sessions without requiring activation clicks (`electron/preload.ts`, `src/lib/appState.ts`).
  - Desktop sidebar is resizable with a persisted width (`src/App.vue`, `src/components/AppSidebar.vue`).
  - Replaced the left-sidebar “codex-designer” title with a search bar filtering workspaces + sessions; added “New feature” + per-workspace settings actions; improved empty states (`src/components/AppSidebar.vue`, `src/components/AppSidebarMobile.vue`).
  - Added a `NewFeatureModal` to create a new feature by generating plan + Q&A docs (`src/components/NewFeatureModal.vue`, `src/lib/newFeatureUi.ts`).

Commands run:
- `npm run typecheck` → OK.
- `npm run build` → OK.

### 2026-02-04 (follow-up 8)
Requested UX tweaks:
- Remove the left-sidebar app icon + global workspace settings icon; rely on per-workspace actions.
- Put the “Add workspace” button above/below search (not crammed inline).
- Remove the “Workbench” hero card from the main view.
- Add a bottom-sticky “context window” + limits display for the current session.

Implemented:
- Sidebar header cleanup:
  - Desktop + mobile sidebars now render as: search → full-width “Add workspace” → workspace list (`src/components/AppSidebar.vue`, `src/components/AppSidebarMobile.vue`).
  - Removed the extra top-row icons (app icon + global settings button); per-workspace “New feature” + settings remain.
- Context + limits panel:
  - Added a bottom-sticky “Context” panel showing per-session/mode token usage (In/Cached/Out) plus sandbox/approvals/network state (`src/components/AppSidebar.vue`, `src/components/AppSidebarMobile.vue`).
  - Run store now aggregates token usage from Codex `turn.completed` events (`src/lib/runStore.ts`).
- Main view:
  - Removed the unnecessary “Workbench” card; kept a slimmer empty state + recent list (`src/pages/WorkbenchPage.vue`).

Commands run:
- `export PATH=/tmp/codex-node/node-v22.11.0-darwin-arm64/bin:$PATH && npm run typecheck` → OK.
- `export PATH=/tmp/codex-node/node-v22.11.0-darwin-arm64/bin:$PATH && npm run build` → OK.
