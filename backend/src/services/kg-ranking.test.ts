import assert from 'node:assert/strict'
import type { KGQueryAnalysis } from './kg-query-analysis.js'
import {
  rankKgPaths,
  type KGPathCandidate,
} from './kg-ranking.js'

function path(
  from: string,
  relationType: string,
  to: string,
  extra: Partial<KGPathCandidate> = {},
): KGPathCandidate {
  return {
    from,
    relation: relationType,
    relationType,
    to,
    candidateKind: 'direct',
    ...extra,
  }
}

const analysis: KGQueryAnalysis = {
  keywords: ['攀西', '钒钛磁铁矿'],
  entityTerms: ['钒钛磁铁矿'],
  regionTerms: ['攀西'],
  relationIntents: ['CONTROLLED_BY'],
  owlRules: ['StructurallyControlledMineral'],
}

const candidates = [
  path('磁铁矿', 'ASSOCIATED_WITH', '钒钛磁铁矿'),
  path('方铅矿', 'CONTROLLED_BY', '断裂带', { candidateKind: 'owl' }),
  path('磁铁矿', 'CONTROLLED_BY', '韧性剪切带', { candidateKind: 'owl' }),
  path('钒钛磁铁矿', 'CONTROLLED_BY', '东天山造山带', { candidateKind: 'owl' }),
  path('攀枝花钒钛磁铁矿', 'CONTROLLED_BY', '攀枝花南北向断裂', {
    candidateKind: 'region',
    regionContext: '攀西钒钛成矿带',
    isMock: true,
    source: 'spatial-demo-v1',
  }),
  path('磁铁矿', 'HOSTED_IN', '辉长岩'),
  path('磁铁矿', 'HOSTED_IN', '辉长岩'),
]

const question = '攀西钒钛磁铁矿受什么构造控制'
const ranked = rankKgPaths(candidates, analysis, question)

assert.equal(ranked[0]?.from, '攀枝花钒钛磁铁矿')
assert.equal(ranked[0]?.relationType, 'CONTROLLED_BY')
assert.ok(ranked[0]?.scoreReasons?.some((reason) => reason.code === 'region'))
assert.ok(ranked.filter((item) => item.candidateKind === 'owl').length <= 2)
assert.ok(
  ranked
    .filter((item) => item.candidateKind !== 'owl')
    .every((item) => item.candidateKind === 'region'),
)

const deduplicated = rankKgPaths([
  path('磁铁矿', 'HOSTED_IN', '辉长岩'),
  path('磁铁矿', 'HOSTED_IN', '辉长岩'),
], {
  ...analysis,
  regionTerms: [],
}, question)
assert.equal(
  deduplicated.filter((item) => item.from === '磁铁矿' && item.to === '辉长岩').length,
  1,
)
assert.deepEqual(
  rankKgPaths(candidates, analysis, question),
  rankKgPaths(candidates, analysis, question),
)

const exact = rankKgPaths([
  path('攀枝花钒钛磁铁矿', 'HOSTED_IN', '层状辉长岩'),
], {
  ...analysis,
  relationIntents: ['HOSTED_IN'],
}, '攀枝花钒钛磁铁矿赋存在哪类岩石中')
assert.ok(exact[0]?.scoreReasons?.some((reason) => reason.code === 'exact_entity'))

console.log('[PASS] KG path scoring, quotas and deterministic ordering')
