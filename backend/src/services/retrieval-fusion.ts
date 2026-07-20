import type { Chunk, KGPath } from '../types/index.js'
import { rerankRagResults } from './rag-reranker.js'
import {
  applyRagWeight,
  type RetrievalPolicy,
  type WeightedRagResult,
} from './retrieval-policy.js'

export function ragCandidateTopK(policy: RetrievalPolicy): number {
  return policy.useRag ? Math.max(policy.ragTopK * 3, 15) : 0
}

export function finalizeRetrievalResults(
  question: string,
  ragResults: Array<{ chunk: Chunk; score: number }>,
  kgPaths: KGPath[],
  policy: RetrievalPolicy,
): WeightedRagResult[] {
  if (!policy.useRag) return []
  const reranked = rerankRagResults(
    question,
    ragResults,
    policy.useKg ? kgPaths : [],
    policy.ragTopK,
  )
  return applyRagWeight(reranked, policy.ragWeight)
}
