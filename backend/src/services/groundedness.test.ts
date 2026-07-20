import assert from 'node:assert/strict'
import {
  bootstrapUnsupportedClaimInterval,
  calculateMetrics,
  createSeededRandom,
  parseJudgeResponse,
  shuffleMethods,
  validateGroundednessCases,
  type BenchmarkAnswerRecord,
  type GroundednessCase,
} from './groundedness.js'

const supportedCases: GroundednessCase[] = Array.from({ length: 25 }, (_, index) => ({
  id: `supported-${index + 1}`,
  category: '矿床特征',
  question: `测试题 ${index + 1}`,
  expectedMode: 'answer',
  evidence: [{ docId: 1, page: 1, note: '测试证据' }],
}))
const refusalCases: GroundednessCase[] = Array.from({ length: 5 }, (_, index) => ({
  id: `refusal-${index + 1}`,
  category: '无证据拒答',
  question: `拒答题 ${index + 1}`,
  expectedMode: 'refuse',
  evidence: [],
}))
assert.deepEqual(validateGroundednessCases([...supportedCases, ...refusalCases]), [])
assert.match(validateGroundednessCases(supportedCases)[0]!, /30 题/)

const parsed = parseJudgeResponse('```json\n{"isRefusal":false,"claims":[{"text":"尾亚赋存于辉长岩","verdict":"支持","evidenceRefs":["D3-P1"]},{"text":"储量为十亿吨","verdict":"无证据支持","evidenceRefs":[]}]}\n```')
assert.equal(parsed.claims[0]?.verdict, 'supported')
assert.equal(parsed.claims[1]?.verdict, 'unsupported')

const records: BenchmarkAnswerRecord[] = [
  { caseId: 'a', expectedMode: 'answer', method: 'system', answer: 'a', status: 'judged', judgement: parsed },
  { caseId: 'b', expectedMode: 'refuse', method: 'system', answer: 'b', status: 'judged', judgement: { isRefusal: true, claims: [] } },
  { caseId: 'c', expectedMode: 'refuse', method: 'direct', answer: 'c', status: 'judged', judgement: { isRefusal: false, claims: [{ text: '编造事实', verdict: 'unsupported', evidenceRefs: [] }] } },
  { caseId: 'd', expectedMode: 'answer', method: 'direct', answer: 'd', status: 'unjudged', error: 'invalid json' },
]
const metrics = calculateMetrics(records)
assert.equal(metrics.judgedAnswers, 3)
assert.equal(metrics.unjudgedAnswers, 1)
assert.equal(metrics.factualClaims, 3)
assert.equal(metrics.unsupportedClaims, 2)
assert.equal(metrics.unanswerableFalseAnswerRate, 0.5)
const interval = bootstrapUnsupportedClaimInterval(records, 50, createSeededRandom(7))
assert.ok(interval.low !== null && interval.high !== null)
assert.deepEqual(shuffleMethods(() => 0.2), ['system', 'direct'])
assert.deepEqual(shuffleMethods(() => 0.8), ['direct', 'system'])

console.log('[PASS] groundedness metrics: cases, blind order, parser, refusal and unjudged handling')
