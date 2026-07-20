import type { KGPath, KGPathScoreReason } from '../types/index.js'
import type { KGQueryAnalysis } from './kg-query-analysis.js'

export interface KGPathCandidate extends KGPath {
  relationType: string
  candidateKind: 'direct' | 'region' | 'owl'
}

interface ScoredPath extends KGPathCandidate {
  score: number
  scoreReasons: KGPathScoreReason[]
  exactMatches: number
  relationIntentMatch: boolean
}

function isExplicitEndpoint(
  endpoint: string,
  analysis: KGQueryAnalysis,
  question: string,
): boolean {
  if (!question.includes(endpoint)) return false
  return !analysis.entityTerms.some((term) =>
    term.length > endpoint.length && term.includes(endpoint),
  )
}

function scoreCandidate(
  candidate: KGPathCandidate,
  analysis: KGQueryAnalysis,
  question: string,
): ScoredPath {
  const reasons: KGPathScoreReason[] = []
  let exactMatches = 0

  if (isExplicitEndpoint(candidate.from, analysis, question)) {
    exactMatches += 1
    reasons.push({
      code: 'exact_entity',
      value: 40,
      detail: `问题完整命中起点「${candidate.from}」`,
    })
  }
  if (isExplicitEndpoint(candidate.to, analysis, question)) {
    exactMatches += 1
    reasons.push({
      code: 'exact_entity',
      value: 40,
      detail: `问题完整命中终点「${candidate.to}」`,
    })
  }

  const keywordMatches = analysis.keywords.filter((keyword) =>
    candidate.from.includes(keyword) || candidate.to.includes(keyword),
  ).slice(0, 3)
  if (keywordMatches.length > 0) {
    reasons.push({
      code: 'keyword',
      value: keywordMatches.length * 8,
      detail: `端点命中关键词：${keywordMatches.join('、')}`,
    })
  }

  const regionMatch = analysis.regionTerms.find((region) =>
    candidate.from.includes(region)
      || candidate.to.includes(region)
      || candidate.regionContext?.includes(region),
  )
  if (regionMatch) {
    reasons.push({
      code: 'region',
      value: 20,
      detail: `路径属于问题区域「${regionMatch}」`,
    })
  }

  const relationIntentMatch = analysis.relationIntents.some(
    (intent) => intent === candidate.relationType,
  )
  if (relationIntentMatch) {
    reasons.push({
      code: 'relation_intent',
      value: 20,
      detail: `关系符合问题意图 ${candidate.relationType}`,
    })
  }

  if (candidate.candidateKind === 'owl') {
    reasons.push({
      code: 'owl_supplement',
      value: 0,
      detail: '由物化 OWL 分类补充',
    })
  }

  return {
    ...candidate,
    score: reasons.reduce((total, reason) => total + reason.value, 0),
    scoreReasons: reasons,
    exactMatches,
    relationIntentMatch,
  }
}

function comparePaths(a: ScoredPath, b: ScoredPath): number {
  return b.score - a.score
    || Number(b.relationIntentMatch) - Number(a.relationIntentMatch)
    || b.exactMatches - a.exactMatches
    || Number(Boolean(a.inferred)) - Number(Boolean(b.inferred))
    || a.from.localeCompare(b.from, 'zh-CN')
    || a.relationType.localeCompare(b.relationType)
    || a.to.localeCompare(b.to, 'zh-CN')
}

function publicPath(path: ScoredPath): KGPath {
  const { exactMatches: _exactMatches, relationIntentMatch: _relationMatch, ...result } = path
  return result
}

export function rankKgPaths(
  candidates: KGPathCandidate[],
  analysis: KGQueryAnalysis,
  question: string,
  limit = 10,
): KGPath[] {
  const seen = new Set<string>()
  const scored = candidates
    .filter((candidate) => {
      const key = [
        candidate.from,
        candidate.relationType,
        candidate.to,
        candidate.source ?? '',
      ].join('|')
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
    .map((candidate) => scoreCandidate(candidate, analysis, question))
    .sort(comparePaths)

  const allMain = scored.filter((path) => path.candidateKind !== 'owl')
  const hasRegionMatches = analysis.regionTerms.length > 0 && allMain.some(
    (path) => path.candidateKind === 'region'
      && path.scoreReasons.some((reason) => reason.code === 'region'),
  )
  const main = hasRegionMatches
    ? allMain.filter((path) => path.candidateKind === 'region')
    : allMain
  const owl = scored.filter((path) => path.candidateKind === 'owl')
  const selected: ScoredPath[] = main.slice(0, Math.min(8, limit))

  selected.push(...owl.slice(0, Math.min(2, limit - selected.length)))
  if (selected.length < limit) {
    selected.push(...main.slice(8, 8 + limit - selected.length))
  }

  return selected.slice(0, limit).map(publicPath)
}
