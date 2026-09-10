import assert from 'node:assert/strict'
import { privateEvaluationSuiteSchema } from './private-quality.js'
import { runPrivateQualityEvaluation } from './private-quality-runner.js'

const singleTurnCases = Array.from({ length: 40 }, (_, index) => ({
  id: `single-${index + 1}`,
  kind: index < 30 ? 'supported' as const : 'refusal' as const,
  question: `question ${index + 1}`,
  expectedIntent: 'geology_qa' as const,
  expectedTools: ['search_documents' as const],
  relevantDocumentFingerprints: index < 30 ? ['a'.repeat(64)] : [],
  acceptedEntityIds: [],
  expectedOutcome: index < 30 ? 'answered' as const : 'refused' as const,
}))
const multiTurnCases = Array.from({ length: 10 }, (_, index) => ({
  id: `multi-${index + 1}`,
  turns: Array.from({ length: 3 }, (_, turn) => ({
    id: `multi-${index + 1}-${turn + 1}`,
    question: `multi question ${index + 1}-${turn + 1}`,
    expectedIntent: 'entity_lookup' as const,
    expectedTools: ['get_entity_detail' as const],
    relevantDocumentFingerprints: [],
    acceptedEntityIds: [],
    expectedOutcome: 'answered' as const,
  })),
}))
const suite = privateEvaluationSuiteSchema.parse({
  schemaVersion: '1.0', private: true, frozenAt: '2026-08-11T00:00:00.000Z',
  label: 'holdout', singleTurnCases, multiTurnCases,
})

let directCalls = 0
let qaCalls = 0
const observations = await runPrivateQualityEvaluation({
  suite,
  variant: 'baseline',
  completedKeys: new Set(['single:single-1:direct']),
  async onObservation() {},
  adapter: {
    async executeDirect() {
      directCalls += 1
      return { answer: 'direct answer', retrievedDocumentFingerprints: [], citationIds: [], selectedTools: [], linkedEntityIds: [], replanCount: 0, latencyMs: 1 }
    },
    async executeQa(input) {
      qaCalls += 1
      return {
        answer: 'qa answer', retrievedDocumentFingerprints: ['a'.repeat(64)], citationIds: ['D1-P1'],
        predictedIntent: input.mode === 'agent' ? 'geology_qa' : undefined,
        selectedTools: input.mode === 'agent' ? ['search_documents'] : [],
        linkedEntityIds: [], agentOutcome: input.testCase.expectedOutcome,
        replanCount: 0, latencyMs: 2, conversationId: input.conversationId,
      }
    },
  },
})

assert.equal(observations.length, 289, 'one completed work item must be skipped on resume')
assert.equal(directCalls, 39 + 30, 'direct runs once per remaining single case and multi turn')
assert.equal(qaCalls, 160 + 60, 'four QA modes per single case and two QA modes per multi turn')
assert.equal(observations.filter((item) => item.mode === 'agent').length, 70)
assert.equal(observations.find((item) => item.caseId === 'single-2' && item.mode === 'agent')?.retrievalHitRanks?.[0], 1)

console.log('[PASS] resumable five-mode private quality runner matrix')
