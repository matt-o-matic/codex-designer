import { promises as fs } from 'node:fs'
import path from 'node:path'

export async function ensureDir(dirPath: string): Promise<void> {
  await fs.mkdir(dirPath, { recursive: true })
}

export async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.stat(filePath)
    return true
  } catch {
    return false
  }
}

export async function readJsonFile<T>(filePath: string): Promise<T | null> {
  try {
    const raw = await fs.readFile(filePath, 'utf-8')
    return JSON.parse(raw) as T
  } catch {
    return null
  }
}

export async function writeJsonFileAtomic(filePath: string, value: unknown): Promise<void> {
  const dir = path.dirname(filePath)
  await ensureDir(dir)

  const tmpPath = `${filePath}.tmp-${process.pid}-${Date.now()}`
  const data = JSON.stringify(value, null, 2) + '\n'
  await fs.writeFile(tmpPath, data, 'utf-8')
  await fs.rename(tmpPath, filePath)
}

