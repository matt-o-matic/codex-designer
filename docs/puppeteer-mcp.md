# Puppeteer MCP for Codex (Windows)

## What I installed/configured

- **MCP server:** `@hisma/server-puppeteer` (global npm install)
  - Binary: `mcp-server-puppeteer`
- **Codex MCP registration:** global server named `puppeteer`
- **Global skill:** `puppeteer-ui-diagnostics` (diagnosis-only; no code edits)

## Why this MCP server

I initially evaluated `@modelcontextprotocol/server-puppeteer` because it’s the canonical/reference Puppeteer MCP server. During installation it emitted an npm deprecation warning (“Package no longer supported”), so I switched to **`@hisma/server-puppeteer`**, which is a maintained fork of that archived server and:

- keeps the well-known **`puppeteer_*` tool names** (avoids collisions and makes prompts predictable)
- updates dependencies (notably Puppeteer) compared to the deprecated upstream package
- works cleanly on Windows via a global install (`mcp-server-puppeteer`)

## Alternatives considered

- `@modelcontextprotocol/server-puppeteer`: deprecated on npm (warning during install).
- `puppeteer-real-browser-mcp-server`: strong Windows Chrome-path detection and resilience, but tool names are generic (`click`, `navigate`, etc.) and may collide with other toolsets; also assumes Chrome is installed.
- `puppeteer-mcp-server`: older publish cadence/dependencies than the `hisma` fork.

## Install (global)

From PowerShell:

```powershell
npm install -g @hisma/server-puppeteer@latest
```

Verify the binary is on PATH:

```powershell
Get-Command mcp-server-puppeteer
```

## Configure Codex (global MCP server)

Register it once:

```powershell
codex mcp add puppeteer -- mcp-server-puppeteer
```

Verify:

```powershell
codex mcp list
codex mcp get puppeteer --json
```

Note: restart Codex after adding MCP servers so the tool list refreshes.
You may also need to restart Codex to pick up newly added skills in `~/.codex/skills`.

## What tools you get

This server exposes a small, predictable tool surface (names are prefixed):

- `puppeteer_navigate` (optional `launchOptions`, optional `allowDangerous`)
- `puppeteer_screenshot` (supports element screenshots and viewport sizing)
- `puppeteer_click`
- `puppeteer_hover`
- `puppeteer_fill`
- `puppeteer_select`
- `puppeteer_evaluate`

It also provides resources like:

- `console://logs` (browser console output)
- `screenshot://<name>` (captured screenshots)

## Global skill: `puppeteer-ui-diagnostics`

Installed to:

- `C:/Users/mbra349/.codex/skills/puppeteer-ui-diagnostics/SKILL.md`

This skill is designed for **end-to-end workflow validation and UI troubleshooting**:

- reproduce the issue in the UI with Puppeteer MCP
- capture screenshots + console logs as evidence
- trace likely root cause(s) by correlating evidence to frontend code and runtime state

**Hard rule:** the skill explicitly prohibits any code modification (no patches/edits). It’s diagnosis + reporting only.

To trigger it, mention the skill by name (e.g. `$puppeteer-ui-diagnostics`) or ask for UI workflow validation/troubleshooting with Puppeteer MCP.

## Troubleshooting

### `mcp-server-puppeteer` not found

- Re-open the terminal so PATH picks up global npm bins.
- Verify where npm is installing globals:
  - `npm config get prefix`

### Browser won’t launch / crashes immediately

- Try a simpler first navigation (`https://example.com`) to confirm the browser itself starts.
- If the issue seems headless-related, use `launchOptions` (via `puppeteer_navigate`) to switch modes, e.g. headful:
  - `launchOptions: { headless: false }`

### Codex doesn’t show Puppeteer tools

- Confirm the server is enabled: `codex mcp list`
- Restart Codex to reload MCP tool definitions.

## Uninstall / rollback

```powershell
codex mcp remove puppeteer
npm uninstall -g @hisma/server-puppeteer
```
