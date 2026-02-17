# Security Policy

## Supported versions

This project is currently pre-public; there is no version support matrix yet. Security fixes are applied continuously to the latest code.

## Security model

- The app does not embed or request API keys for model providers.
- Authentication for Codex is delegated to the user’s local Codex installation/configuration.
- Workspace data is separated into:
  - local workspace artifacts (`docs`, `.codex-designer/*`)
  - app-local runtime state (`userData`)

## Sensitive data handling

- No static credentials are committed in source by design.
- Logs are used for developer diagnostics and runtime troubleshooting.
- Avoid storing secrets in:
  - localStorage
  - markdown artifacts
  - debug logs

## Known risk areas

- Debug tooling can expose clipboard content when explicitly enabled for troubleshooting.
- User-approved command execution and workspace operations can modify local files.
- Child process execution for Codex/gits happens in the local environment and follows local OS permissions.

## Hardening recommendations for contributors

- Keep all filesystem and shell-facing actions in Electron main process handlers.
- Validate/normalize any user-supplied path before read/write/exec paths.
- Keep model/token-sensitive values trimmed and bounded before sending into prompts or persistence.
- Prefer deterministic parsing and JSON-safe persistence to avoid injection into markdown/code generation surfaces.
- Update this document when introducing new environment variables or privileged IPC endpoints.

## Reporting a security issue

If you discover a security concern:

1. Do not open public issue details until triaged.
2. Capture a minimal reproduction summary (steps, platform, version, and expected vs observed behavior).
3. Contact the maintainer privately (email or private disclosure channel) and include:
   - impact level
   - affected files
   - potential data exposure
   - reproducible steps

## Environment assumptions

- Use at least Node 18+.
- Run with standard filesystem permissions for the workspace you intend to automate.
- Ensure Codex authentication and binary trust assumptions are aligned with your local policy.

