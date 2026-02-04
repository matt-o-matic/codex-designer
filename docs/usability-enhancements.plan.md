# usability-enhancements — Plan

Related Q&A: `docs/usability-enhancements.qna.md`

## Problem
Today the app splits `Workspace`, `Sessions`, and `Settings` even though they’re tightly related, and the session experience doesn’t support multi-thread work or a chat-like “history + composer” flow.

Key pain points:
- Repeating the same model defaults across modes.
- Shallow Git integration.
- Session details in a flyout instead of a true main panel.
- Final responses not shown as first-class formatted output.
- No per-workspace editable house style markdown.
- No clear activity indicators across concurrent sessions.

## Goals
- One unified workbench (workspace + sessions + current settings).
- Sidebar tree: workspaces → sessions; selecting a session takes over the main panel (no flyout).
- Chat-like UX per session:
  - Separate per-mode timelines (Planning / Implementation / Testing).
  - Rounds/runs as history cards; primary actions as inline control cards.
  - Always-visible config row + bottom expandable composer (≤25% height).
  - Plan/test docs shown inline as collapsible history cards.
- Run defaults UX: `Apply model` and `Apply model + thinking`.
- Git panel v1: fetch/pull/push + branch switch/create + merge with stdout/stderr.
- Open workspace folder in VS Code.
- Per-workspace house style markdown, injected into planning + implementation prompts.
- Session activity indicators (spinner) for multi-thread visibility.

## Non-goals
- Full editor / file explorer / in-app conflict resolution.
- Advanced Git client features (rebase UI, stash UI, interactive staging).
- Managing Git auth/credentials.
- Changing Q&A/testing logic; keep behavior, change presentation.

## Assumptions
- Electron + Vue; IPC via `window.codexDesigner`.
- Git available on PATH.
- VS Code may or may not have `code` CLI.
- Persistent history is assembled from:
  - `docs/<feature>.qna.json` (planning rounds)
  - `docs/<feature>.test.json` (testing rounds)
  - persisted run logs (run cards) + live in-memory run store
- UI-only state (expanded workspaces, last selected session/mode) stored in localStorage.

## Decisions
From Q&A:
- Unified workbench navigation; settings are workspace-scoped (v1).
- Sidebar shows recent workspaces; default expanded; expanding activates/switches workspace.
- Session renders in the main panel; workspace edit uses a side sheet/flyout.
- Sidebar does not show a workspace “settings” icon; use the workspace header action to open workspace settings.
- Sidebar “New workspace” control is its own row (above/below search), not squeezed inline with search.
- Run defaults: `Apply model` and `Apply model + thinking`.
- Git v1: fetch/pull/push + branch switch/create + merge; show stdout/stderr; no conflict UI.
- Pull uses plain `git pull`.
- `Open in VS Code`: try `code` first, then OS open fallback.
- Final response is always rendered as full markdown; event stream stays collapsible.
- House style markdown is injected into planning + implementation prompts.
- Bottom composer targets current mode by default, with dropdown override.
- Chat-like session UX:
  - Separate per-mode timelines.
  - Primary actions are inline control cards.
  - Q&A rounds are cards (questions + selected answers) with in-place expand-to-edit.
  - Config row is always visible above composer.
  - Plan/test docs render inline as collapsible history cards.
- No “Workbench” card in the main panel; use a simple empty state when no session is selected.

## Design
### Unified workbench + sidebar
- Replace top-level nav with one workbench screen.
- Sidebar:
  - Search and New Workspace are separate rows (do not squeeze together).
  - Recent workspaces (default expanded); expanding activates workspace.
  - Under each workspace: sessions (feature slugs from `docs/*.plan.md`).
  - Session rows show activity (spinner).
  - Workspace settings are opened from the workspace header (not via a sidebar icon).

### Session view (chat-like)
- Modes: Planning / Implementation / Testing → each has its own timeline.
- Timeline card types:
  - Round cards (Q&A rounds; test rounds)
  - Run cards (final response markdown + collapsible diagnostics)
  - Document cards (plan/test markdown inline, collapsible, “open file” affordance)
  - Control cards (generate next round, generate tests, run implementation, follow-up)
- Bottom dock:
  - Always-visible config row (profile/model/thinking + mode toggles).
  - Target dropdown (default current mode; allow override).
  - Expandable composer (≤25% height) with image paste/attachments.
- Empty state: when no session is selected, show a lightweight prompt (no “Workbench” card).

### Data & persistence
- Workspace state: `.codex-designer/cache/state.json` (run defaults + thread IDs).
- House style: `.codex-designer/share/house-style.md` (editor + preview; show sidebar preview).
- Planning/testing cards from their JSON sources; run cards from persisted run logs filtered by workspacePath+featureSlug.

### IPC/integration
- Add Git IPC: fetch/pull/push/branches/checkout/create/merge + minimal status.
- Add VS Code launch IPC.
- Prompt builders append house style markdown for planning + implementation.

## Implementation Tasks
1. [ ] Replace navigation with a unified workbench screen.
2. [ ] Build sidebar tree (workspaces → sessions) with persisted expand/selection state.
3. [ ] Remove session flyout; render selected session in the main panel.
4. [ ] Implement per-mode timelines (Planning/Implementation/Testing) with reusable card components.
5. [ ] Implement bottom dock (config row + target dropdown + expandable composer + attachments).
6. [ ] Planning timeline: round cards + inline plan doc card + control cards for planning actions.
7. [ ] Testing timeline: test round cards + inline test doc card + control cards for testing actions.
8. [ ] Implementation timeline: run cards (final markdown + collapsible diagnostics) + follow-ups via composer.
9. [ ] Load persisted run logs for history; merge with live run-store updates.
10. [ ] Add session activity indicators in sidebar (spinner).
11. [ ] Create workspace edit side sheet (opened from the workspace header) and migrate workspace-scoped controls (run defaults, profiles, shareability, runner playground).
12. [ ] Add `Apply model` / `Apply model + thinking` to run defaults.
13. [ ] Implement house style markdown read/write + editor/preview; show sidebar preview.
14. [ ] Inject house style into planning + implementation prompt builders.
15. [ ] Implement Git IPC + UI panel (with confirmation + stdout/stderr output viewer).
16. [ ] Implement `Open in VS Code` action with fallback behavior.

## Validation
- [ ] Unified workbench replaces Workspace/Sessions/Settings.
- [ ] Sidebar shows workspaces → sessions; expanding workspace activates it.
- [ ] Selecting a session takes over the main panel (no flyout).
- [ ] Sidebar does not show a workspace settings icon; workspace header action opens workspace settings.
- [ ] Sidebar “New workspace” control is not squeezed inline with search.
- [ ] Session has separate Planning/Implementation/Testing timelines.
- [ ] Primary actions are inline control cards; config row stays at bottom.
- [ ] Q&A rounds render as cards and expand to edit answers in place.
- [ ] Plan/test docs render inline as collapsible cards.
- [ ] Bottom composer expands to ≤25% height and supports image paste/attachments; target dropdown works.
- [ ] House style is editable per workspace and injected into planning + implementation prompts.
- [ ] Git panel can fetch/pull/push/checkout/create/merge with visible stdout/stderr.
- [ ] VS Code action launches or shows a clear error.
- [ ] Two sessions can run concurrently and both show activity indicators.
- [ ] Main panel shows a simple empty state when no session is selected (no “Workbench” card).
