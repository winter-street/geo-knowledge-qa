import assert from 'node:assert/strict'
import {
  estimatePrivateApiCalls,
  privateEvaluationSuiteSchema,
  projectPrivateRunPublicly,
} from './private-quality.js'
import { canonicalDocumentFingerprint } from './document-fingerprint.js'

const supported = Array.from({ length: 30 }, (_, index) => ({
  id: `supported-${index + 1}`,
  kind: 'supported' as const,
  question: `private supported question ${index + 1}`,
  expectedIntent: 'geology_qa' as const,
  expectedTools: ['search_documents' as const],
  relevantDocumentFingerprints: ['a'.repeat(64)],
  acceptedEntityIds: [],
  expectedOutcome: 'answered' as const,
}))
const refusal = Array.from({ length: 10 }, (_, index) => ({
  id: `refusal-${index + 1}`,
  kind: 'refusal' as const,
  question: `private refusal question ${index + 1}`,
  expectedIntent: 'geology_qa' as const,
  expectedTools: ['search_documents' as const, 'query_knowledge_graph' as const],
  relevantDocumentFingerprints: [],
  acceptedEntityIds: [],
  expectedOutcome: 'refused' as const,
}))
const multiTurnCases = Array.from({ length: 10 }, (_, caseIndex) => ({
  id: `multi-${caseIndex + 1}`,
  turns: Array.from({ length: 3 }, (_, turnIndex) => ({
    id: `multi-${caseIndex + 1}-turn-${turnIndex + 1}`,
    question: `private multi question ${caseIndex + 1}-${turnIndex + 1}`,
    expectedIntent: 'entity_lookup' as const,
    expectedTools: ['get_entity_detail' as const],
    relevantDocumentFingerprints: [],
    acceptedEntityIds: ['entity-private'],
    expectedOutcome: 'answered' as const,
  })),
}))
const suite = privateEvaluationSuiteSchema.parse({
  schemaVersion: '1.0', private: true, frozenAt: '2026-08-11T00:00:00.000Z',
  label: 'private-holdout-v1', singleTurnCases: [...supported, ...refusal], multiTurnCases,
})

assert.equal(estimatePrivateApiCalls(suite, 'baseline').estimated, 360)
assert.equal(estimatePrivateApiCalls(suite, 'candidate').estimated, 430)
assert.deepEqual(estimatePrivateApiCalls(suite, 'baseline').limits, { warning: 350, hard: 400 })
assert.deepEqual(estimatePrivateApiCalls(suite, 'candidate').limits, { warning: 450, hard: 480 })

const chunks = [
  { page: 1, chunkIndex: 0, text: '  同一份\n地质 文档  ' },
  { page: 2, chunkIndex: 0, text: '第二页' },
]
assert.equal(
  canonicalDocumentFingerprint(chunks),
  canonicalDocumentFingerprint(chunks.map((chunk) => ({ ...chunk, text: chunk.text.normalize('NFKC') }))),
)
assert.match(canonicalDocumentFingerprint(chunks), /^[a-f0-9]{64}$/)

const publicReport = projectPrivateRunPublicly({
  label: 'candidate-v1', variant: 'candidate', suiteHash: 'b'.repeat(64),
  startedAt: '2026-08-11T00:00:00.000Z', completedAt: '2026-08-11T00:10:00.000Z',
  observations: [{
    caseId: 'supported-1', mode: 'agent', question: 'private supported question 1',
    answer: 'private model answer', retrievedDocumentFingerprints: ['a'.repeat(64)],
    citationIds: ['D1-P1'], predictedIntent: 'geology_qa', selectedTools: ['search_documents'],
    linkedEntityIds: ['entity-private'], agentOutcome: 'answered', replanCount: 1,
    latencyMs: 10, completedAt: '2026-08-11T00:00:10.000Z',
  }],
})
const serialized = JSON.stringify(publicReport)
assert.equal(serialized.includes('private supported question'), false)
assert.equal(serialized.includes('private model answer'), false)
assert.equal(serialized.includes('entity-private'), false)
assert.equal(serialized.includes('a'.repeat(64)), false)
assert.equal(publicReport.humanReviewStatus, 'pending')

console.log('[PASS] private quality suite, budget, fingerprint and public projection')
