import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

export type GitCommandResult = {
  stdout: string
  stderr: string
  exitCode: number
}

export async function gitExec(workdir: string, args: string[]): Promise<GitCommandResult> {
  try {
    const { stdout, stderr } = await execFileAsync('git', args, {
      cwd: workdir,
      timeout: 60_000,
      maxBuffer: 20 * 1024 * 1024,
    })
    return { stdout: String(stdout ?? ''), stderr: String(stderr ?? ''), exitCode: 0 }
  } catch (e: any) {
    const stdout = typeof e?.stdout === 'string' ? e.stdout : ''
    const stderr =
      typeof e?.stderr === 'string'
        ? e.stderr
        : e instanceof Error
          ? e.message
          : String(e)
    const code = typeof e?.code === 'number' && Number.isFinite(e.code) ? e.code : 1
    return { stdout: String(stdout ?? ''), stderr: String(stderr ?? ''), exitCode: code }
  }
}

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

export async function gitFetch(workdir: string): Promise<GitCommandResult> {
  return gitExec(workdir, ['fetch'])
}

export async function gitPull(workdir: string): Promise<GitCommandResult> {
  return gitExec(workdir, ['pull'])
}

export async function gitPush(workdir: string): Promise<GitCommandResult> {
  return gitExec(workdir, ['push'])
}

export async function gitCurrentBranch(workdir: string): Promise<string | null> {
  const res = await gitExec(workdir, ['rev-parse', '--abbrev-ref', 'HEAD'])
  if (res.exitCode !== 0) return null
  const name = res.stdout.trim()
  return name && name !== 'HEAD' ? name : null
}

export async function gitListLocalBranches(workdir: string): Promise<{ current: string | null; branches: string[] }> {
  const res = await gitExec(workdir, ['branch', '--list', '--no-color'])
  const lines = res.stdout.split(/\r?\n/g).map((l) => l.trimEnd())
  const branches: string[] = []
  let current: string | null = null
  for (const line of lines) {
    if (!line.trim().length) continue
    const isCur = line.startsWith('* ')
    const name = line.replace(/^\*\s+/, '').trim()
    if (!name) continue
    branches.push(name)
    if (isCur) current = name
  }
  branches.sort((a, b) => a.localeCompare(b))
  return { current, branches }
}

export async function gitCheckout(workdir: string, refName: string): Promise<GitCommandResult> {
  const name = String(refName ?? '').trim()
  if (!name.length) return { stdout: '', stderr: 'Missing branch name.', exitCode: 2 }
  return gitExec(workdir, ['checkout', name])
}

export async function gitCreateBranch(
  workdir: string,
  branchName: string,
  baseRef?: string
): Promise<GitCommandResult> {
  const name = String(branchName ?? '').trim()
  if (!name.length) return { stdout: '', stderr: 'Missing branch name.', exitCode: 2 }
  const base = String(baseRef ?? '').trim()
  return base.length ? gitExec(workdir, ['checkout', '-b', name, base]) : gitExec(workdir, ['checkout', '-b', name])
}

export async function gitMerge(workdir: string, refName: string): Promise<GitCommandResult> {
  const name = String(refName ?? '').trim()
  if (!name.length) return { stdout: '', stderr: 'Missing merge source.', exitCode: 2 }
  return gitExec(workdir, ['merge', '--no-edit', name])
}
