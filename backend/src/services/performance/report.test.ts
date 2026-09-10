import assert from 'node:assert/strict'
import { renderBlindReviewCsv, renderPublicReport } from './report.js'
import { sanitizePublicSummary } from './privacy.js'
import type { PerformanceSummary } from './types.js'

const summary: PerformanceSummary = {
  schemaVersion: '1.0',
  manifest: { runId: 'run', label: 'smoke', createdAt: '2026-08-09T00:00:00.000Z', gitCommit: 'abc', nodeVersion: '22.18.0', model: 'stub', synthetic: true },
  observationCount: 0,
  modes: [],
  overall: { successRate: 1, rawSuccessRate: 1, supplierRateLimitRate: 0 },
  thresholds: {},
  errorCategories: [],
  resources: [],
  limitations: [],
}
const report = renderPublicReport(sanitizePublicSummary(summary))
assert.match(report, /synthetic harness validation/i)
assert.match(report, /no raw questions/i)

const unmeasuredReport = renderPublicReport(sanitizePublicSummary({
  ...summary,
  modes: [{
    mode: 'direct', requestCount: 0, successRate: 0, errorRate: 0, timeoutRate: 0,
    latencyMs: { p50: 0, p95: 0, p99: 0, p99ReferenceOnly: true },
    retrieval: { recallAt5: null, mrrAt10: null },
  }],
}))
assert.match(unmeasuredReport, /\| direct \| 0 \| n\/a \| n\/a \| n\/a \| n\/a \|/)

const csv = renderBlindReviewCsv([{ sampleId: 'sample-1', question: 'q,1', answer: '"answer"', allowedEvidence: 'D1-P1' }])
assert.match(csv, /"q,1"/)
assert.match(csv, /""answer""/)
assert.equal(csv.includes('mode'), false)

console.log('[PASS] private/public performance reports')
