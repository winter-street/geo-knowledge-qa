import assert from 'node:assert/strict'
import { renderBlindReviewCsv } from './private-blind-review.js'

const common = {
  label: 'run', variant: 'baseline' as const, suiteHash: 'a'.repeat(64),
  startedAt: '2026-08-11T00:00:00.000Z', completedAt: '2026-08-11T00:01:00.000Z',
}
const observation = {
  caseId: 'case-1', mode: 'agent' as const, question: '真实私有问题',
  answer: '基线回答', retrievedDocumentFingerprints: [], citationIds: ['D1-P1'],
  selectedTools: [], linkedEntityIds: [], agentOutcome: 'answered' as const,
  replanCount: 0, latencyMs: 1, completedAt: '2026-08-11T00:00:01.000Z',
}
const csv = renderBlindReviewCsv(
  { ...common, observations: [observation] },
  { ...common, label: 'candidate', variant: 'candidate', observations: [{ ...observation, answer: '候选回答' }] },
)
assert.match(csv, /^pair_id,case_id_hash,mode,question,answer_a,answer_b,citations_a,citations_b,expected_outcome,reviewer_preference,factual_support,citation_support,refusal_correct,notes\r?\n/)
assert.match(csv, /真实私有问题/)
assert.match(csv, /基线回答/)
assert.match(csv, /候选回答/)
assert.equal(csv.trimEnd().endsWith(',,,,,'), true, 'human review columns must remain empty')

console.log('[PASS] deterministic private blind-review CSV contract')
