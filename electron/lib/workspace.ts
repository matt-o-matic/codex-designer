import { promises as fs } from 'node:fs'
import path from 'node:path'
import { ensureDir, fileExists } from './fs'

export type FeatureSummary = {
  slug: string
  docsDir: string
  planPath: string
  qnaPath: string
  implPath: string
  testJsonPath: string
  testMdPath: string
  assetsDir: string
  updatedAtMs: number | null
}

export function docsDir(workspacePath: string): string {
  return path.join(workspacePath, 'docs')
}

export async function ensureDocsDir(workspacePath: string): Promise<string> {
  const dir = docsDir(workspacePath)
  await ensureDir(dir)
  return dir
}

export async function listFeatures(workspacePath: string): Promise<FeatureSummary[]> {
  const docs = docsDir(workspacePath)
  if (!(await fileExists(docs))) return []

  const entries = await fs.readdir(docs, { withFileTypes: true })
  const planFiles = entries
    .filter((e) => e.isFile() && e.name.endsWith('.plan.md'))
    .map((e) => e.name)
    .sort((a, b) => a.localeCompare(b))

  const features: FeatureSummary[] = []
  for (const fileName of planFiles) {
    const slug = fileName.replace(/\.plan\.md$/, '')
    const planPath = path.join(docs, `${slug}.plan.md`)
    const qnaPath = path.join(docs, `${slug}.qna.md`)
    const implPath = path.join(docs, `${slug}.impl.md`)
    const testJsonPath = path.join(docs, `${slug}.test.json`)
    const testMdPath = path.join(docs, `${slug}.test.md`)
    const assetsDir = path.join(docs, 'assets', slug)

    const stats = await fs.stat(planPath).catch(() => null)
    features.push({
      slug,
      docsDir: docs,
      planPath,
      qnaPath,
      implPath,
      testJsonPath,
      testMdPath,
      assetsDir,
      updatedAtMs: stats ? stats.mtimeMs : null,
    })
  }

  return features.sort((a, b) => (b.updatedAtMs ?? 0) - (a.updatedAtMs ?? 0))
}

