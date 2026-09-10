import assert from 'node:assert/strict'
import { buildPublicEvaluationSuite, buildSyntheticValidationRun } from './fixtures.js'
import { evaluateRun } from './metrics.js'

const suite = buildPublicEvaluationSuite()
const input = buildSyntheticValidationRun(suite, 'test')
assert.equal(input.suite.singleTurnCases.length, 80)
assert.equal(input.suite.multiTurnCases.length, 20)

const supportedResult = input.singleTurnResults.find((item) => item.caseId === 'supported-031')!
supportedResult.retrievedDocumentIds = []
supportedResult.predictedIntent = 'chitchat'
supportedResult.selectedTools = []
supportedResult.linkedEntityId = 'SYN-ENTITY-01'
supportedResult.citationIds = ['D999-P1']
supportedResult.unsupportedClaims = 1
input.multiTurnResults[0]!.turnSuccess = [true, false, true]

const report = evaluateRun(input, 'test')
assert.equal(report.split, 'test')
assert.equal(report.caseCounts.singleTurn, 40)
assert.equal(report.caseCounts.multiTurn, 10)
assert.equal(report.metrics.recallAt5, 29 / 30)
assert.equal(report.metrics.mrrAt10, 29 / 30)
assert.equal(report.metrics.intentAccuracy, 39 / 40)
assert.equal(report.metrics.toolSelectionAccuracy, 39 / 40)
assert.equal(report.metrics.entityLinkTop1Accuracy, 39 / 40)
assert.equal(report.metrics.citationPrecision, 29 / 30)
assert.equal(report.metrics.multiTurnTaskSuccess, 0.9)
assert.equal(report.metrics.unsupportedClaimRate, 1 / 60)
assert.equal(report.acceptance.recallAt5.passed, true)

assert.throws(
  () => evaluateRun({ ...input, singleTurnResults: input.singleTurnResults.filter((item) => item.caseId !== 'refusal-011') }, 'test'),
  /exactly one result for each selected single-turn case/i,
)
assert.throws(
  () => evaluateRun({ ...input, singleTurnResults: [...input.singleTurnResults, input.singleTurnResults[1]!] }, 'test'),
  /duplicate single-turn result/i,
)
assert.throws(
  () => evaluateRun({ ...input, singleTurnResults: [...input.singleTurnResults, { ...input.singleTurnResults[1]!, caseId: 'supported-001' }] }, 'test'),
  /selected split/i,
)
assert.throws(
  () => evaluateRun({
    ...input,
    singleTurnResults: input.singleTurnResults.map((item) => item.caseId === 'supported-031'
      ? { ...item, unsupportedClaims: item.totalClaims + 1 }
      : item),
  }, 'test'),
  /unsupported claims cannot exceed total claims/i,
)

console.log('[PASS] deterministic evaluation metrics and complete-suite acceptance thresholds')
