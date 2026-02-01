import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

function toAsarUnpackedPath(p: string): string {
  return p.replace(/([\\/])app\.asar([\\/])/, '$1app.asar.unpacked$2')
}

export function findCodexBinaryPath(): string {
  const resolveFn: ((specifier: string) => string) | undefined = (import.meta as any).resolve
  if (!resolveFn) throw new Error('import.meta.resolve is not available; cannot locate Codex binary.')

  const sdkEntry = fileURLToPath(resolveFn('@openai/codex-sdk'))
  const sdkDistDir = path.dirname(sdkEntry)

  const { platform, arch } = process
  let targetTriple: string | null = null
  switch (platform) {
    case 'linux':
    case 'android': {
      if (arch === 'x64') targetTriple = 'x86_64-unknown-linux-musl'
      else if (arch === 'arm64') targetTriple = 'aarch64-unknown-linux-musl'
      break
    }
    case 'darwin': {
      if (arch === 'x64') targetTriple = 'x86_64-apple-darwin'
      else if (arch === 'arm64') targetTriple = 'aarch64-apple-darwin'
      break
    }
    case 'win32': {
      if (arch === 'x64') targetTriple = 'x86_64-pc-windows-msvc'
      else if (arch === 'arm64') targetTriple = 'aarch64-pc-windows-msvc'
      break
    }
    default:
      break
  }
  if (!targetTriple) throw new Error(`Unsupported platform: ${platform} (${arch})`)

  const vendorRoot = toAsarUnpackedPath(path.join(sdkDistDir, '..', 'vendor'))
  const codexBinaryName = process.platform === 'win32' ? 'codex.exe' : 'codex'
  const candidate = path.join(vendorRoot, targetTriple, 'codex', codexBinaryName)

  // In dev mode, or if the app isn't packaged into asar, the above should already exist.
  // In packaged mode, the vendor folder must be unpacked (asarUnpack) so the binary is executable.
  if (existsSync(candidate)) return candidate

  // Fallback: if the vendor folder was not unpacked, return the candidate path anyway so callers
  // can surface a useful error (instead of crashing on existsSync assumptions).
  return candidate
}
