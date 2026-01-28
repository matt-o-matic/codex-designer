import { promises as fs } from 'node:fs'
import path from 'node:path'
import { fileExists } from './fs'

function normalizeLine(line: string): string {
  return line.trim()
}

export async function updateGitignore(workdir: string, opts: { ignoreShare: boolean }): Promise<void> {
  const gitignorePath = path.join(workdir, '.gitignore')
  const existing = (await fileExists(gitignorePath)) ? await fs.readFile(gitignorePath, 'utf-8') : ''
  const lines = existing.split(/\r?\n/)

  const requiredIgnores = new Set<string>(['.codex-designer/cache/'])
  if (opts.ignoreShare) requiredIgnores.add('.codex-designer/share/')

  const nextLines: string[] = []
  const seen = new Set<string>()

  for (const line of lines) {
    const norm = normalizeLine(line)
    if (!norm) {
      nextLines.push(line)
      continue
    }
    if (norm === '.codex-designer/cache/' || norm === '.codex-designer/share/') {
      continue
    }
    nextLines.push(line)
    seen.add(norm)
  }

  if (nextLines.length > 0 && normalizeLine(nextLines[nextLines.length - 1]) !== '') nextLines.push('')

  for (const needed of requiredIgnores) {
    if (!seen.has(needed)) nextLines.push(needed)
  }

  nextLines.push('')
  await fs.writeFile(gitignorePath, nextLines.join('\n'), 'utf-8')
}

