import type { Chunk, KGPath } from '../types/index.js'
import { rerankRagResults } from './rag-reranker.js'
import { selectDiverseEvidence } from './evidence-selection.js'
import {
  applyRagWeight,
  type RetrievalPolicy,
  type WeightedRagResult,
} from './retrieval-policy.js'

export function ragCandidateTopK(policy: RetrievalPolicy): number {
  return policy.useRag ? 20 : 0
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
    ragResults.length,
  )
  const finalLimit = Math.min(5, policy.ragTopK)
  return applyRagWeight(
    selectDiverseEvidence(reranked, finalLimit, 2),
    policy.ragWeight,
  )
}
