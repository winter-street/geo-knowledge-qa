import type { Chunk, RetrievalMode } from '../types/index.js'
import type { RuntimeSettings } from './runtime-settings.js'

export interface RetrievalPolicy {
  useRag: boolean
  useKg: boolean
  useSpatial: boolean
  ragMode: RuntimeSettings['ragMode']
  ragTopK: number
  ragWeight: number
  kgWeight: number
  spatialWeight: number
}

export function resolveRetrievalPolicy(
  requestedMode: RetrievalMode,
  settings: RuntimeSettings,
): RetrievalPolicy {
  const wantsRag = requestedMode === 'rag' || requestedMode === 'hybrid'
  const wantsKg = requestedMode === 'kg' || requestedMode === 'hybrid'
  return {
    useRag: settings.ragEnabled && wantsRag,
    useKg: settings.kgEnabled && wantsKg,
    useSpatial: settings.spatialEnabled,
    ragMode: settings.ragMode,
    ragTopK: settings.ragTopK,
    ragWeight: settings.ragWeight,
    kgWeight: settings.kgWeight,
    spatialWeight: settings.spatialWeight,
  }
}

export type WeightedRagResult = {
  chunk: Chunk
  score: number
  rawScore: number
  normalizedBgeScore?: number
  kgSupport?: number
  finalScore?: number
}

export function applyRagWeight(
  results: Array<{
    chunk: Chunk
    score: number
    rawScore?: number
    normalizedBgeScore?: number
    kgSupport?: number
    finalScore?: number
  }>,
  weight: number,
): WeightedRagResult[] {
  return results
    .map((result) => ({
      ...result,
      rawScore: result.rawScore ?? result.score,
      score: Number((result.score * weight).toFixed(6)),
    }))
    .sort((a, b) => b.score - a.score)
}

export function buildPathUsed(input: {
  policy: RetrievalPolicy
  ragSucceeded: boolean
  ragCount: number
  kgCount: number
  spatialCount: number
}): string[] {
  const paths: string[] = []
  if (input.policy.useRag && input.ragSucceeded && input.ragCount > 0) paths.push(input.policy.ragMode)
  if (input.policy.useKg && input.kgCount > 0) paths.push('kg')
  if (input.policy.useSpatial && input.spatialCount > 0) paths.push('spatial')
  return paths
}

export function hasAvailableRetrievalPath(
  policy: RetrievalPolicy,
  status: {
    ragSucceeded: boolean
    kgSucceeded: boolean
    spatialSucceeded: boolean
  },
): boolean {
  return (policy.useRag && status.ragSucceeded)
    || (policy.useKg && status.kgSucceeded)
    || (policy.useSpatial && status.spatialSucceeded)
}
