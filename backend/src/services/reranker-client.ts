import type { Chunk } from '../types/index.js'

type RagResult = { chunk: Chunk; score: number }
type FetchLike = (input: string, init?: RequestInit) => Promise<Response>

export interface RerankerStatus {
  mode: 'bge-reranker' | 'fallback'
  reason?: string
  model?: string
}

export interface RerankerClientResult {
  results: RagResult[]
  status: RerankerStatus
}

function fallback(candidates: RagResult[], reason: string): RerankerClientResult {
  return { results: candidates, status: { mode: 'fallback', reason } }
}

export async function rerankDocuments(
  question: string,
  candidates: RagResult[],
  topK = 20,
  fetchImpl: FetchLike = fetch,
): Promise<RerankerClientResult> {
  if (candidates.length === 0) return fallback([], 'no candidates')
  const boundedCandidates = candidates.slice(0, 20)
  const boundedTopK = Math.max(1, Math.min(20, topK, boundedCandidates.length))
  if (boundedCandidates.every((entry) => entry.chunk.synthetic)) {
    return fallback(boundedCandidates.slice(0, boundedTopK), 'synthetic demo deterministic order')
  }
  try {
    const response = await fetchImpl('http://127.0.0.1:5000/rerank', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        question,
        candidates: boundedCandidates.map((entry) => ({
          id: entry.chunk.id,
          text: entry.chunk.content,
          doc_title: entry.chunk.docTitle,
          page: entry.chunk.page,
          score: entry.score,
        })),
        top_k: boundedTopK,
      }),
      signal: AbortSignal.timeout(10_000),
    })
    if (!response.ok) return fallback(boundedCandidates, `HTTP ${response.status}`)
    const payload = await response.json() as {
      chunks?: Array<{ id?: number; rerank_score?: number }>
      rerank?: {
        status?: 'applied' | 'fallback'
        mode?: string
        reason?: string
        model?: string
      }
    }
    if (payload.rerank?.status !== 'applied') {
      return fallback(boundedCandidates, payload.rerank?.reason || 'reranker unavailable')
    }
    const byId = new Map(boundedCandidates.map((entry) => [entry.chunk.id, entry]))
    const results = (payload.chunks ?? []).flatMap((item) => {
      const original = item.id === undefined ? undefined : byId.get(item.id)
      if (!original || typeof item.rerank_score !== 'number' || !Number.isFinite(item.rerank_score)) return []
      return [{ ...original, score: item.rerank_score }]
    }).slice(0, boundedTopK)
    if (results.length === 0) return fallback(boundedCandidates, 'reranker returned no valid results')
    return {
      results,
      status: {
        mode: 'bge-reranker',
        model: payload.rerank.model,
      },
    }
  } catch (error) {
    return fallback(boundedCandidates, error instanceof Error ? error.message : String(error))
  }
}
