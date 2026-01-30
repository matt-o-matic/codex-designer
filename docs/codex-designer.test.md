# codex-designer — Manual Test Checklist

Generated: 2026-01-28T14:56:54.230Z

Latest round: round-1 (2026-01-28T14:56:54.230Z)

## Tests

- [x] **CDX-MAN-001** — Create Workspace + New Work Session (Artifacts Created) _(status: pass)_
  - Verify workspace selection/creation works and that planning artifacts are written under the target workspace `docs/` folder (auto-created if missing).
  - Steps:
    1. Launch `codex-designer`.
    2. In the workspace picker, choose an empty folder (or create a new folder) as the workspace.
    3. Confirm `docs/` is created automatically if it doesn’t exist.
    4. Start a new work session (e.g., New feature) with a feature slug like `smoke-feature` and enter a brief.
    5. Trigger the initial planning action that generates artifacts (e.g., first Q&A round / plan generation).
    6. On disk, verify `docs/smoke-feature.plan.md` and `docs/smoke-feature.qna.md` exist in the workspace and are non-empty.
  - Expected: A new session is created and the workspace contains `docs/[feature].plan.md` and `docs/[feature].qna.md` (with `docs/` auto-created if missing).

- [x] **CDX-MAN-002** — Q&A Rounds Append and Update Plan (2+ Rounds) _(status: pass)_
  - Verify structured Q&A supports multiple rounds and that `docs/[feature].qna.md` is append-only while the plan updates and remains the implementation source of truth.
  - Steps:
    1. Open the feature session’s Q&A screen.
    2. Answer Round 1 questions using both choice options and freeform text.
    3. Generate the next round (Round 2).
    4. Verify `docs/[feature].qna.md` contains both Round 1 and Round 2 (Round 1 content is not rewritten).
    5. Open the plan view and confirm `docs/[feature].plan.md` updates after Round 2 and the UI shows a diff/“since last round” indicator.
    6. Edit the plan in the UI (add a small line) and confirm the change is written back to `docs/[feature].plan.md` on disk.
  - Expected: Q&A rounds append to `docs/[feature].qna.md`; the plan updates and edits persist to `docs/[feature].plan.md`.

- [x] **CDX-MAN-003** — Pre-Implementation Answer Edit Creates Appended Correction (No History Rewrite) _(status: pass)_
  - Verify editing prior answers is allowed only before implementation and that edits are recorded as appended corrections (audit trail), with explicit plan regeneration required.
  - Steps:
    1. Before starting any implementation run, edit an earlier Q&A answer from a prior round in the UI.
    2. Confirm the UI indicates the change will be recorded as a correction (append-only) rather than rewriting history.
    3. Save the change.
    4. Verify `docs/[feature].qna.md` still contains the original answer text and that the correction is appended (no prior content overwritten).
    5. Confirm the UI shows the “current answer” as the latest correction and shows answer history (expanded by default).
    6. Confirm the plan is not auto-regenerated and the UI indicates plan/Q&A are out of sync until you click `Regenerate plan`.
    7. Verify `.codex-designer/cache/state.json` exists and reflects that Q&A is newer than the last plan regeneration (e.g., updated round/hash metadata).
  - Expected: Corrections are appended to `docs/[feature].qna.md`, the plan is not regenerated automatically, and plan/Q&A sync state is tracked in `.codex-designer/cache/state.json`.

- [ ] **CDX-MAN-004** — Warn at 10 Q&A Rounds and Allow Override _(status: fail)_
  - Verify the app warns when approaching/exceeding ~10 rounds but allows the user to override and continue.
  - Steps:
    1. In a feature session, generate Q&A rounds until you reach Round 10.
    2. Attempt to generate Round 11.
    3. Confirm a warning is shown about exceeding ~10 rounds and an override option is available.
    4. Choose the override and proceed.
    5. Verify `docs/[feature].qna.md` now contains a Round 11 entry.
  - Expected: The app warns at ~10 rounds and allows an explicit override; the Q&A log reflects the additional round.

- [ ] **CDX-MAN-005** — Clipboard Image Attachment Stored Under docs/assets and Linked _(status: not_run)_
  - Verify pasted images are accepted and stored under `docs/assets/[feature]/...` with no enforced limits, and are associated with the session and referenced from artifacts.
  - Steps:
    1. Copy an image to the clipboard (e.g., a screenshot).
    2. Paste the image into the brief, a Q&A answer, or other attachment-capable field.
    3. Confirm the UI displays the attachment (thumbnail/chip) in the session.
    4. On disk, verify an image file was created under `docs/assets/[feature]/...` in the workspace.
    5. Verify the relevant artifact references the attachment path (e.g., in `docs/[feature].qna.md`, `docs/[feature].impl.md`, or `docs/[feature].test.json` depending on where it was attached).
  - Expected: The pasted image is saved under `docs/assets/[feature]/...`, remains associated with the session, and is referenced from persisted artifacts.

- [x] **CDX-MAN-006** — Careful/YOLO Preset Mappings + Advanced Settings Apply to Next Run _(status: pass)_
  - Verify presets map to the specified sandbox/approval/network settings and that advanced settings are configurable and affect the next Codex run.
  - Steps:
    1. Open run profile selector and choose `Careful`.
    2. Open Advanced settings and confirm the effective mapping shows `sandbox=workspace-write`, `approval=on-failure`, `network=off`, plus model and working directory controls.
    3. Trigger a Codex-backed run (e.g., generate next Q&A round or regenerate plan).
    4. Switch to `YOLO` and confirm the effective mapping shows `sandbox=danger-full-access`, `approval=never`, `network=on`.
    5. Trigger the same Codex-backed run again and confirm the run summary/config reflects the new preset.
    6. (Optional) In `network=off`, run a flow that would try a networked tool/command and confirm tool-network is blocked while model calls still occur.
  - Expected: Careful/YOLO presets match the specified mappings and advanced settings apply to subsequent runs; `network=off` blocks tool/executed-command network access without preventing model calls.

- [ ] **CDX-MAN-007** — Export/Import Run Profiles and Workspace Share/Cache Gitignore Strategy _(status: not_run)_
  - Verify profiles can be exported/imported per workspace to `.codex-designer/share/profiles.json`, and that `.codex-designer/cache/` is always gitignored while shareability is user-chosen.
  - Steps:
    1. In workspace settings, choose `Local only` vs `Shareable in repo` for `.codex-designer/share/` when prompted.
    2. Export run profiles for the workspace.
    3. Verify `.codex-designer/share/profiles.json` exists and contains the exported profiles.
    4. Verify `.codex-designer/cache/` is always gitignored (via `.gitignore` update or an explicit UI indicator).
    5. If `Local only` was chosen, verify `.codex-designer/share/` is gitignored; if `Shareable in repo` was chosen, verify it is not gitignored.
    6. Import profiles from `.codex-designer/share/profiles.json` and confirm profile names/mappings round-trip correctly.
  - Expected: Profiles export/import works via `.codex-designer/share/profiles.json`, `.codex-designer/cache/` is always gitignored, and `.codex-designer/share/` gitignore behavior matches the selected shareability.

- [ ] **CDX-MAN-008** — Prompt git init for Non-Git Workspace Before Implementation _(status: not_run)_
  - Verify the app prompts to initialize git when a workspace is not a repo, before allowing implementation runs.
  - Steps:
    1. Select or create a workspace folder that does not contain a `.git/` directory.
    2. Start an implementation run from the Implementation screen.
    3. Confirm the app prompts to run `git init` before proceeding.
    4. Accept the prompt.
    5. Verify `.git/` now exists in the workspace.
    6. Retry the implementation run and confirm it proceeds to the next safety checks (e.g., clean working tree requirement).
  - Expected: Implementation is gated by git initialization: the app prompts for `git init`, performs it on acceptance, and then continues with implementation safety checks.

- [ ] **CDX-MAN-009** — Implementation Safety: Dirty Working Tree Blocks; Clean Tree Records Checkpoint Anchor _(status: not_run)_
  - Verify implementation is blocked when git working tree is dirty and that when clean, the app records current `HEAD` as the checkpoint anchor (no empty checkpoint commit).
  - Steps:
    1. In a git workspace, create an uncommitted change outside the app (modify any file without committing).
    2. Attempt to start an implementation run.
    3. Confirm the app blocks the run and instructs you to clean the working tree manually (no auto-staging/commit).
    4. Clean the working tree (commit or discard changes) so `git status` is clean.
    5. Start the implementation run again.
    6. Confirm the app records the current `HEAD` as the checkpoint anchor and does not create an empty checkpoint commit.
    7. Confirm the diff view is based on that checkpoint anchor for the run.
  - Expected: Dirty trees block implementation; clean trees allow it, using recorded `HEAD` as a checkpoint anchor without creating empty commits.

- [ ] **CDX-MAN-010** — Implementation Run UX: Streamed Logs, Diff via Git, impl.md Updates, No Auto-Commit, Stop _(status: not_run)_
  - Verify implementation runs stream events, diffs are shown via git from checkpoint anchor, `docs/[feature].impl.md` updates, no auto-commit occurs, and Stop interrupts runs safely (with warnings).
  - Steps:
    1. Ensure the workspace is a clean git repo and the plan is ready.
    2. Start an implementation run for the feature plan.
    3. Verify logs/events stream in real time in the UI timeline.
    4. After completion, open changed-files and diff views and confirm they align with `git diff <checkpoint>..HEAD`.
    5. Verify `docs/[feature].impl.md` exists and contains new content from this run.
    6. Confirm no commit was created automatically after the run.
    7. Start a second run intended to take long enough to interrupt (e.g., a larger task).
    8. Click `Stop` during the run.
    9. Confirm the run is marked interrupted and the UI warns the workspace may be left dirty.
  - Expected: Runs stream live updates, diffs are computed from the checkpoint anchor via git, `docs/[feature].impl.md` is updated, no auto-commit happens, and Stop marks the run interrupted with appropriate warnings.

- [ ] **CDX-MAN-011** — Plan/Q&A Consistency Gating: Careful Blocks, YOLO Warns _(status: not_run)_
  - Verify that when Q&A is newer than the last plan regeneration, implementation is blocked in Careful but allowed with warning in YOLO.
  - Steps:
    1. Generate a plan from the current Q&A (baseline synced state).
    2. Append a new Q&A answer or correction without regenerating the plan.
    3. Switch to `Careful` preset and attempt to start implementation.
    4. Confirm the app blocks implementation and requires you to regenerate the plan first.
    5. Switch to `YOLO` preset and attempt to start implementation again.
    6. Confirm the app shows a warning about plan/Q&A mismatch but allows proceeding.
  - Expected: Careful enforces plan/Q&A sync by blocking implementation; YOLO allows proceeding with an explicit warning.

- [ ] **CDX-MAN-012** — Careful One-Shot Tool-Network Override Applies to Exactly One Run _(status: not_run)_
  - Verify Careful supports a one-run-only override to enable tool/executed-command network access, with a clear warning, and that it resets automatically after the run.
  - Steps:
    1. Select `Careful` preset.
    2. Enable the one-shot override for tool-network for the next run and confirm a prominent warning banner is shown.
    3. Start a run that would normally require tool-network access.
    4. Confirm tool-network access is enabled for that run.
    5. After the run finishes, verify the one-shot override has reset to off.
    6. Start another run and confirm it uses `network=off` unless the override is re-enabled.
  - Expected: One-shot override is clearly warned, applies to exactly one run, and automatically resets afterward.

- [ ] **CDX-MAN-013** — Unsupported Advanced Settings: Warn, Require Confirmation, Run Best-Effort (SDK Only) _(status: not_run)_
  - Verify that when a requested advanced setting can’t be applied due to SDK limitations, the app warns, requires confirmation, and runs best-effort without silently falling back to CLI.
  - Steps:
    1. In Advanced settings, select an option/combination the app indicates is not supported by the current `@openai/codex-sdk` capabilities.
    2. Start the run.
    3. Confirm the app warns that the setting can’t be fully applied and requires explicit confirmation to continue.
    4. Confirm the run proceeds using best-effort settings.
    5. Confirm the run summary indicates which settings were applied vs ignored, and that there was no transparent CLI fallback.
  - Expected: Unsupported settings trigger a warning + confirmation gate; the run proceeds best-effort via SDK only with clear transparency.

- [ ] **CDX-MAN-014** — Testing Checklist Generation Produces JSON Mini-DB + Markdown Export _(status: not_run)_
  - Verify the Testing module generates editable key tests into `docs/[feature].test.json` and produces a readable `docs/[feature].test.md` export.
  - Steps:
    1. Open the Testing module for a feature session.
    2. Generate `key features to test`.
    3. Verify `docs/[feature].test.json` and `docs/[feature].test.md` are created/updated on disk.
    4. Edit a test item (title/steps/expected) in the UI and save.
    5. Verify both `docs/[feature].test.json` and `docs/[feature].test.md` reflect the edit.
  - Expected: Testing checklist is generated into `docs/[feature].test.json` and exported to `docs/[feature].test.md`; edits persist to both outputs.

- [ ] **CDX-MAN-015** — Testing Rounds: Statuses, Deferral, Per-Round Feedback + Attachments Persist _(status: not_run)_
  - Verify testing rounds are tracked with full per-round history in JSON, allowed statuses are enforced, deferrals reappear next round, and feedback (text+images) is stored per-round.
  - Steps:
    1. Click `Start testing round` and confirm a new round is created in `docs/[feature].test.json`.
    2. Set three different items to `pass`, `fail`, and `deferred` using the `defer this round` checkbox.
    3. Add feedback text and paste an image attachment for the failed item.
    4. Verify the attachment file is stored under `docs/assets/[feature]/...`.
    5. Restart the app and reopen the same session.
    6. Confirm round statuses persist, feedback is stored per-round, and the attachment reference remains valid.
    7. Start the next testing round and confirm deferred items reappear for the new round (not evaluated in the prior round).
  - Expected: Testing rounds and per-round statuses/feedback persist in `docs/[feature].test.json`; deferred items reappear in the next round; attachments are stored in `docs/assets/[feature]/...`.

- [ ] **CDX-MAN-016** — Auto-Create New Testing Round After Code Changes + Status Carryover Rules _(status: not_run)_
  - Verify a new testing round auto-creates after an implementation run when there were code changes and at least one test is not `pass`, and that status initialization follows the specified rules.
  - Steps:
    1. Ensure the current testing round has at least one item that is not `pass` (e.g., `fail`, `blocked`, or `deferred`).
    2. Run an implementation that changes files in the workspace.
    3. Confirm the app auto-creates a new testing round after the run completes.
    4. Verify the new round resets previously `pass` → `not_run`.
    5. Verify `fail`/`deferred`/`blocked` carry forward unchanged into the new round.
    6. Verify prior rounds remain accessible in history in `docs/[feature].test.json`.
  - Expected: After code changes with not-all-pass tests, a new testing round is auto-created; `pass` resets to `not_run` and other non-pass statuses carry forward; history is preserved.

- [ ] **CDX-MAN-017** — Acceptance + Commit Accepted Changes (Careful Gating vs YOLO Override) _(status: not_run)_
  - Verify acceptance gates committing in Careful (pass or deferred only), while YOLO permits manual override; commit stages and commits all changes with an editable auto-generated message.
  - Steps:
    1. In `Careful`, ensure at least one key test is `fail`, `blocked`, or `not_run`.
    2. Confirm acceptance is not met and `Commit accepted changes` is disabled/blocked.
    3. Update tests so all key items are `pass` or `deferred`.
    4. Confirm acceptance is met and `Commit accepted changes` becomes enabled.
    5. Click `Commit accepted changes` and confirm it stages and commits all changes in the repo.
    6. Confirm the commit message is auto-generated but editable before finalizing.
    7. Switch to `YOLO` with failing/unrun tests and confirm committing is still possible via an explicit override, with a warning shown.
  - Expected: Careful gates commit on acceptance (pass or deferred only); YOLO can override with warning; commit stages+commits all changes and message is editable.

- [ ] **CDX-MAN-018** — Implement Feedback Loop Uses Failed-Test Context and Resumes or Recaps Session _(status: not_run)_
  - Verify `Implement feedback` launches a fix run using failing-test context and attempts to resume the implementation session; if resume isn’t possible, it starts a new run with a structured recap and links to prior artifacts/logs.
  - Steps:
    1. Mark a key test as `fail` and add detailed feedback (text and optionally an image).
    2. Click `Implement feedback`.
    3. Confirm the app starts/resumes an implementation run and includes the failing test context in the run inputs.
    4. If session resume is unavailable, confirm fallback behavior: a new run starts with a structured recap and references to prior artifacts/logs.
    5. After the run, verify `docs/[feature].impl.md` is updated and you can proceed to re-test via the Testing module.
  - Expected: Implement feedback starts a fix-focused run that includes failed-test context, resumes when possible, and otherwise uses a recap-based fallback; implementation notes update accordingly.
