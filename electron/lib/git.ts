import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

export async function isGitRepo(workdir: string): Promise<boolean> {
  try {
    const { stdout } = await execFileAsync('git', ['rev-parse', '--is-inside-work-tree'], { cwd: workdir })
    return stdout.trim() === 'true'
  } catch {
    return false
  }
}

export async function gitInit(workdir: string): Promise<void> {
  await execFileAsync('git', ['init'], { cwd: workdir })
}

export async function gitStatusPorcelain(workdir: string): Promise<string> {
  const { stdout } = await execFileAsync('git', ['status', '--porcelain'], { cwd: workdir })
  return stdout
}

export async function gitHeadCommit(workdir: string): Promise<string> {
  const { stdout } = await execFileAsync('git', ['rev-parse', 'HEAD'], { cwd: workdir })
  return stdout.trim()
}

export async function gitDiff(workdir: string, range: string): Promise<string> {
  const { stdout } = await execFileAsync('git', ['diff', range], { cwd: workdir, maxBuffer: 10 * 1024 * 1024 })
  return stdout
}

export async function gitDiffStat(workdir: string, range: string): Promise<string> {
  const { stdout } = await execFileAsync('git', ['diff', '--stat', range], { cwd: workdir, maxBuffer: 1024 * 1024 })
  return stdout.trim()
}

export async function gitCommitAll(
  workdir: string,
  message: string
): Promise<{ commit: string; stdout: string; stderr: string }> {
  await execFileAsync('git', ['add', '-A'], { cwd: workdir })
  const { stdout, stderr } = await execFileAsync('git', ['commit', '-m', message], { cwd: workdir })
  const commit = await gitHeadCommit(workdir)
  return { commit, stdout, stderr }
}

