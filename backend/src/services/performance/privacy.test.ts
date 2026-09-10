import assert from 'node:assert/strict'
import { sanitizePublicSummary, findSensitiveCanaries } from './privacy.js'
import type { PerformanceSummary } from './types.js'

const canaries = ['PRIVATE_QUESTION', 'SECRET_TITLE', 'sk-private-key', '113.123,42.456', 'Bearer private-token']
const privateSummary = {
  schemaVersion: '1.0',
  manifest: { runId: 'run', label: 'private', createdAt: '2026-08-09T00:00:00.000Z', gitCommit: 'abc', nodeVersion: '22.18.0', model: 'deepseek-chat', synthetic: false },
  observationCount: 1,
  modes: [],
  overall: { successRate: 1, rawSuccessRate: 1, supplierRateLimitRate: 0 },
  thresholds: {},
  errorCategories: [],
  resources: [],
  limitations: ['Remote latency is environment-dependent.'],
  privateQuestion: canaries[0],
  privateTitle: canaries[1],
  apiKey: canaries[2],
  coordinate: canaries[3],
  jwt: canaries[4],
} as PerformanceSummary & Record<string, unknown>

const publicSummary = sanitizePublicSummary(privateSummary)
const serialized = JSON.stringify(publicSummary)
assert.deepEqual(findSensitiveCanaries(serialized, canaries), [])
assert.equal(publicSummary.privacy.rawContentIncluded, false)
assert.equal(publicSummary.privacy.publishable, true)

console.log('[PASS] allowlist-based public performance projection')
