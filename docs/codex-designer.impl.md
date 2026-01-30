# codex-designer — Implementation Notes

Plan (read-only): `docs/codex-designer.plan.md`  
Q&A (read-only): `docs/codex-designer.qna.md`

## Status

- Current focus: close remaining v1 workflow gaps (profiles, Q&A corrections, run logs, feedback loop).

## Work log

### 2026-01-28

- Initialized implementation log.
- Bootstrapped Electron + Vue + TS + Tailwind project skeleton.
- Added basic shell UI (topbar/sidebar) with dark-mode toggle + mobile nav drawer.
- Implemented initial workspace storage + IPC:
  - Recent workspaces tracked in Electron `userData`.
  - Repo-local `.codex-designer/share/` + `.codex-designer/cache/` created on open.
  - Workspace scan for `docs/*.plan.md` to discover features.
- Integrated Codex SDK runner (main process) with streaming events + abort support and a small “runner playground” UI.
- Added first-pass session UI:
  - “New work” modal runs a deterministic planning prompt (schema-backed) via Codex SDK.
  - Q&A tab parses `docs/[feature].qna.md` into structured questions (choices + freeform) and writes answers back to markdown.
  - Plan tab renders `docs/[feature].plan.md`.
  - Testing tab reads/writes `docs/[feature].test.json` + exports `docs/[feature].test.md`, supports per-round status and pasted-image attachments.
- Added git/implementation safety primitives:
  - Implementation runs require a clean git working tree and record a checkpoint `HEAD` (for diffing).
  - Diff viewer uses `git diff <checkpoint>..HEAD`.
  - Commit flow stages+commits all changes with editable message, gated by acceptance in Careful.
- Added per-workspace profiles file at `.codex-designer/share/profiles.json` (created on workspace open) and runner uses it to override preset options.
- Added run log persistence (Electron `userData`) and IPC endpoints to list/read run logs.
- Updated Q&A editing to be correction-append-only (no rewriting A: lines) + shows answer history in UI; locks Q&A once implementation starts.
- Added workspace UI to edit/import/export Careful/YOLO runner profiles (`.codex-designer/share/profiles.json`).
- Added New Work image pasting (clipboard) + attachments list; attachments are saved under `docs/assets/[feature]/...` and passed to Codex as `local_image` inputs.
- Added “Implement feedback” from Testing (fails/blocked + attachments passed back into an implementation run).
- Added one-shot “tool network” override toggles (Careful) for planning/testing and implementation runs.
- Added implementation UI gating for git requirements (init git + dirty tree warnings).
- Fixed Codex SDK binary resolution by externalizing `@openai/codex-sdk` from the Electron main bundle (so its vendored `vendor/` binaries resolve correctly).
- Added dynamic window title updates to include workspace + active session slug.
- Fixed “New work” UX so a session slug route shows the run stream even before `docs/*.plan.md` exists (previously the right panel showed “Select a feature session”).
- Streamlined the UI layout (full-width app; reduced horizontal padding and card padding on Sessions/Workspace/Settings).
- Converted all model fields to a dropdown (common models + “Custom…” escape hatch) for planning/implementation/new work and the Settings runner.
- Replaced the hard-coded model list with a live query to Codex (`app-server` JSON-RPC `model/list`) so the dropdown only shows valid Codex models for the signed-in user.
- Q&A UX upgrades:
  - Answers are multi-line, auto-growing fields (same for other freeform text inputs).
  - Pasting images into Q&A answers saves them under `docs/assets/[feature]/...`, inserts a markdown reference into the answer, and automatically includes those images as `local_image` inputs in subsequent planning/implementation runs.
  - Added “Regenerate latest” for Q&A to delete and re-generate the most recent round.
  - Q&A answers now persist as an append-only answer block (`A:` followed by indented lines), so multi-line answers and image refs don’t break parsing.
- Improved Q&A parsing and UX:
  - More robust option parsing (including bolded `**A)**` styles) and `Recommended:` / `Default:` line support.
  - Q&A UI shows a recommended/default choice and preselects an option when answers are blank.
- Hardened “New work” submission: added submit state + error handling; navigates immediately to the new session and refreshes workspace in the background.
- Commands run:
  - `npm install`
  - `npm run typecheck`
  - `npm run build`
- Note: `npm install` reported 3 moderate vulnerabilities (not addressed yet).

## TODO (high level)

- Remaining polish / gaps:
  - Add a run-history viewer UI (list/read persisted logs from Electron `userData`).
  - New project wizard (create new workspace folder + offer `git init`) vs “new feature” (current UI assumes existing workspace).
  - Plan review improvements: diff since last Q&A round + checklist view.
  - Testing export: include feedback + attachments in `docs/[feature].test.md`.
  - Keyboard shortcuts + richer timeline rendering of Codex streamed events.
  - Address `npm install` vulnerability report (optional; not done in v1 scaffold).

## Decisions recorded during implementation

- None yet (plan/Q&A already locked).
