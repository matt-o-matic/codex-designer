export function stripCodeFences(text: string): string {
  const raw = String(text ?? '')
  const trimmed = raw.trim()
  const m = trimmed.match(/^```[a-zA-Z0-9_-]*\s*\n([\s\S]*)\n```$/)
  return m ? m[1] : raw
}

export function extractFirstJsonValue(text: string): string | null {
  const raw = String(text ?? '')
  let idx = 0

  while (idx < raw.length && /\s/.test(raw[idx])) idx++
  if (idx >= raw.length) return null

  let start = idx
  if (raw[start] !== '{' && raw[start] !== '[') {
    const obj = raw.indexOf('{', idx)
    const arr = raw.indexOf('[', idx)
    if (obj === -1 && arr === -1) return null
    if (obj === -1) start = arr
    else if (arr === -1) start = obj
    else start = Math.min(obj, arr)
  }

  const open = raw[start]
  if (open !== '{' && open !== '[') return null

  const stack: Array<'{' | '['> = []
  let inString = false
  let escape = false

  for (let i = start; i < raw.length; i++) {
    const ch = raw[i]

    if (inString) {
      if (escape) {
        escape = false
        continue
      }
      if (ch === '\\') {
        escape = true
        continue
      }
      if (ch === '"') inString = false
      continue
    }

    if (ch === '"') {
      inString = true
      continue
    }

    if (ch === '{' || ch === '[') {
      stack.push(ch)
      continue
    }

    if (ch === '}' || ch === ']') {
      const last = stack.pop()
      if (!last) return null
      if (last === '{' && ch !== '}') return null
      if (last === '[' && ch !== ']') return null
      if (!stack.length) return raw.slice(start, i + 1)
    }
  }

  return null
}

export function parseLenientJson(text: string): { value: unknown; jsonText: string } | null {
  const withoutFences = stripCodeFences(text)
  const trimmed = withoutFences.trim().replace(/^\uFEFF/, '')
  if (!trimmed.length) return null

  try {
    return { value: JSON.parse(trimmed), jsonText: trimmed }
  } catch {
    // Ignore any trailing junk after the first complete JSON object/array.
    const extracted = extractFirstJsonValue(trimmed)
    if (!extracted) return null
    try {
      return { value: JSON.parse(extracted), jsonText: extracted }
    } catch {
      return null
    }
  }
}

