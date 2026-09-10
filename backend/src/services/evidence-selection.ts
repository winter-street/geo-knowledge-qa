import type { Chunk } from '../types/index.js'

type RagEvidence = { chunk: Chunk; score: number }

function normalizedContent(content: string): string {
  return content.toLocaleLowerCase('zh-CN').replace(/[\p{P}\p{S}\s]+/gu, '')
}

function shingles(content: string): Set<string> {
  const normalized = normalizedContent(content)
  if (normalized.length <= 3) return new Set([normalized])
  const result = new Set<string>()
  for (let index = 0; index <= normalized.length - 3; index += 1) {
    result.add(normalized.slice(index, index + 3))
  }
  return result
}

function nearDuplicate(left: string, right: string): boolean {
  const normalizedLeft = normalizedContent(left)
  const normalizedRight = normalizedContent(right)
  if (!normalizedLeft || !normalizedRight) return false
  if (normalizedLeft === normalizedRight) return true
  if (normalizedLeft.includes(normalizedRight) || normalizedRight.includes(normalizedLeft)) {
    const ratio = Math.min(normalizedLeft.length, normalizedRight.length)
      / Math.max(normalizedLeft.length, normalizedRight.length)
    if (ratio >= 0.9) return true
  }

  const leftShingles = shingles(left)
  const rightShingles = shingles(right)
  let overlap = 0
  for (const value of leftShingles) {
    if (rightShingles.has(value)) overlap += 1
  }
  const union = leftShingles.size + rightShingles.size - overlap
  return union > 0 && overlap / union >= 0.86
}

export function selectDiverseEvidence<T extends RagEvidence>(
  candidates: T[],
  limit = 5,
  maxPerDocument = 2,
): T[] {
  if (limit <= 0 || maxPerDocument <= 0) return []
  const selected: T[] = []
  const documentCounts = new Map<string, number>()

  for (const candidate of candidates) {
    if (selected.length >= limit) break
    const documentKey = candidate.chunk.docTitle.trim() || `chunk:${candidate.chunk.id}`
    if ((documentCounts.get(documentKey) ?? 0) >= maxPerDocument) continue
    if (selected.some((entry) => nearDuplicate(entry.chunk.content, candidate.chunk.content))) continue
    selected.push(candidate)
    documentCounts.set(documentKey, (documentCounts.get(documentKey) ?? 0) + 1)
  }

  return selected
}
