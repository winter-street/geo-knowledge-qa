import assert from 'node:assert/strict'
import { buildPublicEvaluationSuite } from './fixtures.js'
import { runPrivateEvaluation } from './private-runner.js'
import type { EvaluationMode } from './types.js'

const seenModes = new Set<EvaluationMode>()
const run = await runPrivateEvaluation(buildPublicEvaluationSuite(), 'test', {
  async executeSingle(input) {
    seenModes.add(input.mode)
    return {
      retrievedDocumentIds: input.testCase.relevantDocumentIds,
      predictedIntent: input.testCase.expectedIntent,
      selectedTools: input.testCase.expectedTools,
      linkedEntityId: input.testCase.expectedEntityId,
      citationIds: input.testCase.acceptedCitationIds.slice(0, 1),
      refused: input.testCase.kind === 'refusal',
      answeredFactually: input.testCase.kind === 'supported',
      totalClaims: input.testCase.kind === 'supported' ? 1 : 0,
      unsupportedClaims: 0,
      latencyMs: 10,
      answer: 'must never be persisted',
    }
  },
  async executeDirectBaseline() {
    return { totalClaims: 1, unsupportedClaims: 1 }
  },
  async executeMulti(input) {
    return { turnSuccess: input.testCase.turns.map(() => true), latencyMs: 20 }
  },
})

assert.deepEqual(seenModes, new Set<EvaluationMode>(['direct', 'rag', 'kg', 'hybrid', 'agent']))
assert.equal(run.suite.singleTurnCases.length, 80)
assert.equal(run.suite.multiTurnCases.length, 20)
assert.equal(run.singleTurnResults.length, 40)
assert.equal(run.multiTurnResults.length, 10)
assert.equal(JSON.stringify(run).includes('must never be persisted'), false)

console.log('[PASS] private evaluation runner dispatch and privacy boundary')
