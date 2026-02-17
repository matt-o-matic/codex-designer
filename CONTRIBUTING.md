# Contributing

Thanks for helping improve Codex Designer.

## Getting started

1. Fork the repository and create a branch.
2. Install dependencies:
   - `npm install`
3. Run the app in development:
   - `npm run dev`
4. Make changes with tests/verification as scope allows.

## Code style and standards

- Use TypeScript everywhere possible.
- Keep renderer-side and Electron main-process responsibilities separate.
- Use existing composables and helpers in `src/lib`.
- Prefer existing patterns for state, async handling, and typing in `src` and `electron`.
- Avoid broad, untyped objects in IPC payloads.
- Keep changes narrowly scoped unless refactoring intentionally.

## Run workflow

### Before opening a PR

- Run:
  - `npm run build`
- Open key flows manually:
  - workspace selection
  - model list refresh
  - planning/implementation/testing runs
  - local file writes in workspace artifacts
  - git actions if touched

### Commit hygiene

- Keep commits focused and descriptive.
- Prefer message format that explains user-facing behavior changed.

## Pull requests

When opening a PR, include:

- What changed and why.
- Manual verification checklist.
- Any platform-specific notes (macOS/Windows/Linux).
- Known caveats and follow-up tasks.

## Documentation changes

- Update `README.md` if onboarding, run flow, or workspace layout changes.
- Add `SECURITY.md` notes for any new env vars or auth-related behavior.
- Update `AGENTS.md` if architecture boundaries or non-obvious workflows change.

## Support

For design questions or architecture review, include reproduction details and the relevant log snippets before asking for deeper debugging support.

