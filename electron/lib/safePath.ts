import path from 'node:path'

export function resolveInside(baseDir: string, relPath: string): string {
  const resolvedBase = path.resolve(baseDir)
  const resolved = path.resolve(resolvedBase, relPath)
  if (resolved === resolvedBase) return resolved
  if (!resolved.startsWith(resolvedBase + path.sep)) {
    throw new Error('Path escapes workspace.')
  }
  return resolved
}

