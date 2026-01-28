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
  - “New work” modal runs `$plan-task <slug>` via Codex SDK.
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
