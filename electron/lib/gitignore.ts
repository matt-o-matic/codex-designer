import { promises as fs } from 'node:fs'
import { execFile } from 'node:child_process'
import path from 'node:path'
import { promisify } from 'node:util'
import { fileExists } from './fs'

const execFileAsync = promisify(execFile)

function normalizeLine(line: string): string {
  return line.trim()
}

export async function updateGitignore(workdir: string, opts: { ignoreShare: boolean }): Promise<void> {
  const { stdout } = await execFileAsync('git', ['rev-parse', '--git-path', 'info/exclude'], { cwd: workdir })
  const excludePathRaw = stdout.trim()
  if (!excludePathRaw) throw new Error('Failed to resolve git exclude path.')
  const excludePath = path.isAbsolute(excludePathRaw) ? excludePathRaw : path.join(workdir, excludePathRaw)

  const existing = (await fileExists(excludePath)) ? await fs.readFile(excludePath, 'utf-8') : ''
  const eol = existing.includes('\r\n') ? '\r\n' : '\n'
  const lines = existing.split(/\r?\n/)

  const requiredIgnores: string[] = ['.codex-designer/cache/', '.codex-designer/tmp/']
  if (opts.ignoreShare) requiredIgnores.push('.codex-designer/share/')

  const header = '# codex-designer (auto)'
  const removeSet = new Set<string>([
    header,
    '.codex-designer/cache/',
    '.codex-designer/cache',
    '.codex-designer/tmp/',
    '.codex-designer/tmp',
    '.codex-designer/share/',
    '.codex-designer/share',
  ])

  const baseLines: string[] = []
  for (const line of lines) {
    const norm = normalizeLine(line)
    if (!norm) {
      baseLines.push(line)
      continue
    }
    if (removeSet.has(norm)) continue
    baseLines.push(line)
  }

  // Prevent repeated runs from accumulating blank lines at EOF.
  while (baseLines.length > 0 && normalizeLine(baseLines[baseLines.length - 1]) === '') {
    baseLines.pop()
  }

  const nextLines = [...baseLines]
  if (nextLines.length && normalizeLine(nextLines[nextLines.length - 1]) !== '') nextLines.push('')
  nextLines.push(header)
  for (const needed of requiredIgnores) nextLines.push(needed)

  const nextText = nextLines.join(eol) + eol
  if (nextText === existing) return

  await fs.mkdir(path.dirname(excludePath), { recursive: true })
  await fs.writeFile(excludePath, nextText, 'utf-8')
}
