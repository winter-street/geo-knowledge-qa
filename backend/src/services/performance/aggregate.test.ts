import assert from 'node:assert/strict'
import { aggregateRun } from './aggregate.js'
import type { PerformanceRunManifest, RequestObservation } from './types.js'

const manifest: PerformanceRunManifest = {
  runId: 'run-1', label: 'test', createdAt: '2026-08-09T00:00:00.000Z', gitCommit: 'abc123',
  nodeVersion: '22.18.0', model: 'stub', synthetic: true,
}
const observations: RequestObservation[] = [
  { runId: 'run-1', requestId: '1', caseId: 'case-1', mode: 'rag', status: 'success', totalMs: 100, firstEventMs: 20, firstContentMs: 40, retrievedDocumentIds: ['doc-1'], citationIds: ['D1-P1'], selectedTools: [] },
  { runId: 'run-1', requestId: '2', caseId: 'case-1', mode: 'rag', status: 'success', totalMs: 200, firstEventMs: 30, firstContentMs: 50, retrievedDocumentIds: ['other', 'doc-1'], citationIds: ['D1-P1'], selectedTools: [] },
  { runId: 'run-1', requestId: '3', caseId: 'case-1', mode: 'direct', status: 'success', totalMs: 80, retrievedDocumentIds: [], citationIds: [], selectedTools: [] },
]
const summary = aggregateRun({
  manifest,
  observations,
  durationMs: 1_000,
  cases: [{ id: 'case-1', kind: 'supported', question: 'private', relevantDocumentIds: ['doc-1'], acceptedCitationIds: ['D1-P1'] }],
})
const rag = summary.modes.find((item) => item.mode === 'rag')!
const direct = summary.modes.find((item) => item.mode === 'direct')!
assert.equal(rag.latencyMs.p50, 100)
assert.equal(rag.latencyMs.p95, 200)
assert.equal(rag.retrieval?.recallAt5, 1)
assert.equal(rag.retrieval?.mrrAt10, 0.75)
assert.equal(direct.retrieval?.recallAt5, null)
assert.equal(summary.overall.rawSuccessRate, 1)
assert.equal(summary.thresholds.errorRate?.passed, true)
assert.deepEqual(summary.resources, [])

console.log('[PASS] performance aggregation and thresholds')
