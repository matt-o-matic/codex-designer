# usability-enhancements — Q&A

Related plan: `docs/usability-enhancements.plan.md`

## Round 1

Q: What should be the primary navigation model after combining `Workspace`, `Sessions`, and `Settings`?
- A) Single unified workbench (sidebar tree + main panel context)
- B) Keep separate routes but hide them behind one combined sidebar entry
- C) Top-level tabs inside one page (Workspace/Sessions/Settings)
- D) Minimal change: keep current nav items, just add cross-links
Recommended: A
A (current): [A] Single unified workbench (sidebar tree + main panel context)

Q: In v1, which settings should be treated as workspace-scoped vs app-global?
- A) Everything shown as workspace-scoped; no dedicated global settings page
- B) Split: tiny app-global prefs + workspace-scoped operational settings
- C) Keep current Settings page as-is (global) but reachable from workbench
- D) Defer: keep existing split until later
Recommended: A
A (current): [A] Everything shown as workspace-scoped; no dedicated global settings page

Q: For the sidebar workspace list, how should multiple workspaces behave?
- A) Show recent workspaces; any can expand to show sessions (lazy-load on expand)
- B) Show only the active workspace; workspace switching via dropdown/picker
- C) Accordion: list recent workspaces but only one expanded at a time
- D) Only show workspaces inside a modal picker (not persistent)
Recommended: A
A (current): [A] Show recent workspaces; any can expand to show sessions (lazy-load on expand)
  Notes:
    I think everything starts off as expanded. And switching between them would be a lot like switching between chats in the chatGPT interface.

Q: What should the `Apply to all modes` control do for run defaults?
- A) Apply model + thinking level from current mode to all roles
- B) Apply model only (leave thinking level unchanged)
- C) Apply only to the three main modes (planning/implementation/new work)
- D) Provide two actions: `Apply model` and `Apply model + thinking`
- E) Do nothing in UI; rely on users editing a JSON file
Recommended: D
A (current): [D] Provide two actions: `Apply model` and `Apply model + thinking`

Q: Which Git capabilities are required in the first usable iteration?
- A) Panel with fetch/pull/push + branch switch/create + merge; show stdout/stderr; no conflict UI
- B) Only fetch/pull/push and current-branch status (no branch ops)
- C) Full git client UI (staging, per-file actions, conflict resolution)
- D) Freeform command box to run arbitrary git commands
Recommended: A
A (current): [A] Panel with fetch/pull/push + branch switch/create + merge; show stdout/stderr; no conflict UI

Q: What default safety behavior should `Pull` use?
- A) Default to `pull --ff-only` to avoid implicit merge commits
- B) Use plain `git pull` (whatever user config does)
- C) Always `pull --rebase`
- D) Always prompt the user to choose the pull strategy each time
Recommended: A
A (current): [B] Use plain `git pull` (whatever user config does)

Q: How should `Open in VS Code` work cross-platform?
- A) Try `code` CLI first; fallback to OS open; show clear error if neither works
- B) Require `code` CLI; show setup instructions otherwise
- C) Never use `code`; always OS open only
- D) User-configurable command path in settings
Recommended: A
A (current): [A] Try `code` CLI first; fallback to OS open; show clear error if neither works

Q: When a session is selected, what should happen to the layout?
- A) Session becomes main panel content; sidebar stays; workspace edit uses a flyout side sheet
- B) Keep the current session flyout overlay; just move the session list into sidebar
- C) Open sessions in a new window
- D) Session replaces the entire window (no sidebar while viewing a session)
Recommended: A
A (current): [A] Session becomes main panel content; sidebar stays; workspace edit uses a flyout side sheet

Q: How should the run feed present the final response?
- A) Always render final response as full markdown; keep event details collapsible
- B) Show final response only; hide the underlying event stream entirely
- C) Keep current event stream UI but auto-expand final response details
- D) Render final response only as plain text (no markdown formatting)
Recommended: A
A (current): [A] Always render final response as full markdown; keep event details collapsible

Q: How should session activity indicators classify the type of work in progress?
- A) Spinner + icon derived from run role and UI action (Q&A/implement/testing/scripts/follow-up/generic)
- B) Spinner only (no type icon)
- C) Only indicate potentially code-modifying work (implementation/testing)
- D) Show a numeric progress indicator (based on event count) instead of type
Recommended: A
A (current): [A] Spinner + icon derived from run role and UI action (Q&A/implement/testing/scripts/follow-up/generic)

## Round 2

Q: Should the per-workspace `House Style` markdown be display-only, or also injected into Codex prompts?
- A) Display-only (UI reference only)
- B) Inject into planning prompts only
- C) Inject into planning + implementation prompts
- D) Inject into all runs (planning/implementation/testing/generic)
- E) User-toggle per run (checkbox)
Recommended: C
A (current): [C] Inject into planning + implementation prompts

Q: The new bottom composer should append to the current session. What should it target by default?
- A) Always the planning thread (Q&A)
- B) Always the implementation thread
- C) Default to the current tab (planning vs implementation), with a dropdown to override
- D) Always start a new generic run (no thread continuation)
- E) Keep per-tab inputs only (no bottom composer)
Recommended: C
A (current): [C] Default to the current tab (planning vs implementation), with a dropdown to override

Q: When you expand a non-active workspace in the sidebar, should that also activate/switch to it?
- A) Yes — expanding also activates it (chat-like switching)
- B) No — expanding is passive; activating requires a separate click/action
- C) Allow expanding multiple workspaces without switching the active one (peek sessions)
- D) Only one workspace at a time; switch via picker (no sidebar list)
Recommended: A
A (current): [A] Yes — expanding also activates it (chat-like switching)

## Round 3

Q: For the new chat-like experience, should the session have one unified timeline across all modes, or separate timelines per mode?
- A) Separate timelines per mode (Planning / Implementation / Testing)
- B) One unified timeline, with a mode filter (chips/tabs)
- C) One unified timeline always showing everything (no filter)
- D) Keep current mode tabs, but only make planning/testing chat-like
Recommended: A
A (current): [A] Separate timelines per mode (Planning / Implementation / Testing)

Q: You requested that Q&A/testing rounds and their actions live as controls in the history. How literal should that be?
- A) All primary actions are inline control cards in the history (chat-like)
- B) Actions stay in a bottom toolbar near the composer (history is read-only)
- C) Both: inline control cards + a small bottom toolbar for quick access
- D) Keep actions where they are today; only move the composer/config
Recommended: A
A (current): [A] All primary actions are inline control cards in the history (chat-like)

Q: How should Q&A rounds appear in the planning history?
- A) Round cards show questions + chosen answers; expand to edit in place
- B) Round cards are summary-only; editing opens a modal
- C) Only the latest round is editable; prior rounds are read-only
- D) Keep the current Q&A editor unchanged; add a separate history view
Recommended: A
A (current): [A] Round cards show questions + chosen answers; expand to edit in place

Q: What should the bottom “configuration around everything” look like in the session view?
- A) Always-visible compact config row above the composer (profile/model/thinking/etc)
- B) Config hidden behind a settings button that expands inline
- C) Config stays at the top; only the composer moves to the bottom
- D) Config is per-action card only (each history control has its own config)
Recommended: A
A (current): [A] Always-visible compact config row above the composer (profile/model/thinking/etc)

Q: Should plan/test documents be rendered inline as part of the chat-like history (collapsible), or kept as separate dedicated views?
- A) Render inline as collapsible history cards (with an “open file” affordance)
- B) Keep as separate views/tabs; history only shows rounds/runs
- C) Inline preview only (first ~N lines), full doc always opened separately
- D) No inline rendering; only show links to open the files
Recommended: A
A (current): [A] Render inline as collapsible history cards (with an “open file” affordance)

## Round 4 (complete)

## Additional notes
- Sidebar activity: spinner only (remove work-type icon).
- Sidebar workspace settings: no settings icon in the sidebar; use the workspace header settings action.
- Sidebar layout: place “New workspace” control above/below search as its own row (not squeezed inline).
- Main panel: no “Workbench” card; show a simple empty state when no session is selected.
