import type { Chunk, KGPath } from '../types/index.js'

export interface RerankedRagResult {
  chunk: Chunk
  score: number
  rawScore: number
  normalizedBgeScore: number
  kgSupport: number
  finalScore: number
}

const RELATION_TERMS: Record<string, string[]> = {
  HOSTED_IN: ['赋存', '围岩', '容矿', '寄主'],
  CONTROLLED_BY: ['控制', '受控', '控矿', '断裂'],
  FORMED_IN: ['形成', '成矿时代', '年代', '时期'],
  LIES_IN: ['位于', '分布', '区域', '地区'],
  ASSOCIATED_WITH: ['伴生', '共生', '关联'],
}

function endpointRelevance(name: string, question: string): number {
  if (question.includes(name)) return name.length
  return 0
}

function pathSupport(content: string, question: string, path: KGPath): number {
  const fromRelevance = endpointRelevance(path.from, question)
  const toRelevance = endpointRelevance(path.to, question)
  const queryEntity = toRelevance > fromRelevance ? path.to : path.from
  const relatedEntity = queryEntity === path.from ? path.to : path.from
  const relationTerms = RELATION_TERMS[path.relationType ?? ''] ?? [path.relation]

  const questionEntityCoverage = content.includes(queryEntity) ? 1 : 0
  const relatedEntityCoverage = content.includes(relatedEntity) ? 1 : 0
  const relationIntentCoverage = relationTerms.some((term) => content.includes(term)) ? 1 : 0

  return Math.min(
    1,
    0.6 * questionEntityCoverage
      + 0.3 * relatedEntityCoverage
      + 0.1 * relationIntentCoverage,
  )
}

function kgSupportForChunk(content: string, question: string, paths: KGPath[]): number {
  return paths.reduce(
    (best, path) => Math.max(best, pathSupport(content, question, path)),
    0,
  )
}

export function rerankRagResults(
  question: string,
  ragResults: Array<{ chunk: Chunk; score: number }>,
  kgPaths: KGPath[],
  topK: number,
): RerankedRagResult[] {
  if (ragResults.length === 0 || topK <= 0) return []

  const bestScore = Math.max(...ragResults.map((result) => result.score))
  if (bestScore <= 0) return []
  const threshold = Math.max(0.04, bestScore * 0.45)
  const eligible = ragResults
    .map((result, originalRank) => ({ ...result, originalRank }))
    .filter((result) => result.score >= threshold)

  if (kgPaths.length === 0) {
    return eligible.slice(0, topK).map((result) => ({
      chunk: result.chunk,
      score: result.score,
      rawScore: result.score,
      normalizedBgeScore: Number((result.score / bestScore).toFixed(6)),
      kgSupport: 0,
      finalScore: result.score,
    }))
  }

  return eligible
    .map((result) => {
      const normalizedBgeScore = result.score / bestScore
      const kgSupport = kgSupportForChunk(result.chunk.content, question, kgPaths)
      const finalScore = 0.8 * normalizedBgeScore + 0.2 * kgSupport
      return {
        chunk: result.chunk,
        score: Number(finalScore.toFixed(6)),
        rawScore: result.score,
        normalizedBgeScore: Number(normalizedBgeScore.toFixed(6)),
        kgSupport: Number(kgSupport.toFixed(6)),
        finalScore: Number(finalScore.toFixed(6)),
        originalRank: result.originalRank,
      }
    })
    .sort((left, right) =>
      right.finalScore - left.finalScore
        || left.originalRank - right.originalRank
        || left.chunk.id - right.chunk.id,
    )
    .slice(0, topK)
    .map(({ originalRank: _originalRank, ...result }) => result)
}
