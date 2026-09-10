import assert from 'node:assert/strict'
import { buildPublicEvaluationSuite, buildSyntheticValidationRun } from './fixtures.js'
import { evaluateRun, renderEvaluationReport } from './metrics.js'
import { evaluationSuiteSchema } from './schemas.js'

const suite = buildPublicEvaluationSuite()
assert.equal(suite.singleTurnCases.length, 80)
assert.equal(suite.singleTurnCases.filter((item) => item.kind === 'supported').length, 60)
assert.equal(suite.singleTurnCases.filter((item) => item.kind === 'refusal').length, 20)
assert.equal(suite.multiTurnCases.length, 20)
assert.equal(suite.multiTurnCases.every((item) => item.turns.length === 3), true)
assert.deepEqual(new Set(suite.singleTurnCases.map((item) => item.evaluationMode)), new Set([
  'direct', 'rag', 'kg', 'hybrid', 'agent',
]))
assert.equal(suite.singleTurnCases.every((item) => item.synthetic), true)
assert.equal(suite.multiTurnCases.every((item) => item.synthetic), true)
assert.equal(suite.singleTurnCases.some((item) => item.split === 'development'), true)
assert.equal(suite.singleTurnCases.some((item) => item.split === 'test'), true)
assert.equal(
  suite.singleTurnCases.filter((item) => item.split === 'test')
    .every((item) => item.humanBlindReview === null),
  true,
)
assert.equal(suite.multiTurnCases.every((item) => item.humanBlindReview === null), true)

const developmentEntityIds = new Set([
  ...suite.singleTurnCases.filter((item) => item.split === 'development').flatMap((item) => item.expectedEntityId ?? []),
  ...suite.multiTurnCases.filter((item) => item.split === 'development').flatMap((item) =>
    item.turns.flatMap((turn) => turn.expectedEntityId ?? [])),
])
const testEntityIds = new Set([
  ...suite.singleTurnCases.filter((item) => item.split === 'test').flatMap((item) => item.expectedEntityId ?? []),
  ...suite.multiTurnCases.filter((item) => item.split === 'test').flatMap((item) =>
    item.turns.flatMap((turn) => turn.expectedEntityId ?? [])),
])
assert.deepEqual([...developmentEntityIds].filter((id) => testEntityIds.has(id)), [])

const developmentDocumentIds = new Set(suite.singleTurnCases
  .filter((item) => item.split === 'development')
  .flatMap((item) => item.relevantDocumentIds))
const testDocumentIds = new Set(suite.singleTurnCases
  .filter((item) => item.split === 'test')
  .flatMap((item) => item.relevantDocumentIds))
assert.deepEqual([...developmentDocumentIds].filter((id) => testDocumentIds.has(id)), [])

const invalidStructureIsolation = structuredClone(suite)
const developmentStructureCase = invalidStructureIsolation.singleTurnCases.find((item) => item.split === 'development')!
const testStructureCase = invalidStructureIsolation.singleTurnCases.find((item) => item.split === 'test')!
developmentStructureCase.expectedStructureId = testStructureCase.expectedStructureId
assert.throws(() => evaluationSuiteSchema.parse(invalidStructureIsolation), /structure IDs must not overlap/i)

const invalidRegionIsolation = structuredClone(suite)
const developmentRegionCase = invalidRegionIsolation.singleTurnCases.find((item) => item.split === 'development')!
const testRegionCase = invalidRegionIsolation.singleTurnCases.find((item) => item.split === 'test')!
developmentRegionCase.expectedRegionId = testRegionCase.expectedRegionId
assert.throws(() => evaluationSuiteSchema.parse(invalidRegionIsolation), /region IDs must not overlap/i)

const invalidKindCounts = structuredClone(suite)
for (const item of invalidKindCounts.singleTurnCases) item.kind = 'supported'
assert.throws(() => evaluationSuiteSchema.parse(invalidKindCounts), /60 supported and 20 refusal/i)

const invalidSplitCounts = structuredClone(suite)
invalidSplitCounts.singleTurnCases[0]!.split = 'test'
assert.throws(() => evaluationSuiteSchema.parse(invalidSplitCounts), /40 single-turn cases per split/i)

const invalidPerSplitKinds = structuredClone(suite)
invalidPerSplitKinds.singleTurnCases.find((item) => item.split === 'development' && item.kind === 'supported')!.kind = 'refusal'
invalidPerSplitKinds.singleTurnCases.find((item) => item.split === 'test' && item.kind === 'refusal')!.kind = 'supported'
assert.throws(() => evaluationSuiteSchema.parse(invalidPerSplitKinds), /30 supported and 10 refusal cases per split/i)

const validationRun = buildSyntheticValidationRun(suite)
const report = evaluateRun(validationRun, 'test')
assert.equal(Object.values(report.acceptance).every((item) => item.passed), true)
assert.equal(report.judging.automated, 'auxiliary-only')
assert.deepEqual(report.judging.humanBlindReview, {
  status: 'pending', reviewer: null, notes: null,
})
assert.match(renderEvaluationReport(report), /synthetic harness validation/i)
assert.match(renderEvaluationReport(report), /human blind review: pending/i)

const incompleteSuiteRun = {
  ...validationRun,
  suite: {
    ...suite,
    singleTurnCases: suite.singleTurnCases.filter((item) => item.split === 'test'),
    multiTurnCases: suite.multiTurnCases.filter((item) => item.split === 'test'),
  },
}
assert.throws(
  () => evaluateRun(incompleteSuiteRun, 'test'),
  /80 element/i,
)

const incompleteReviewSuite = structuredClone(suite)
for (const item of incompleteReviewSuite.singleTurnCases.filter((item) => item.split === 'test')) {
  item.humanBlindReview = { status: 'complete', reviewer: 'reviewer-a', notes: 'approved' }
}
const incompleteReviewReport = evaluateRun({
  ...buildSyntheticValidationRun(incompleteReviewSuite),
  suite: incompleteReviewSuite,
}, 'test')
assert.deepEqual(incompleteReviewReport.judging.humanBlindReview, {
  status: 'pending', reviewer: null, notes: null,
})

const completeReviewSuite = structuredClone(incompleteReviewSuite)
for (const item of completeReviewSuite.multiTurnCases.filter((item) => item.split === 'test')) {
  item.humanBlindReview = { status: 'complete', reviewer: 'reviewer-a', notes: 'approved' }
}
const completeReviewReport = evaluateRun({
  ...buildSyntheticValidationRun(completeReviewSuite),
  suite: completeReviewSuite,
}, 'test')
assert.deepEqual(completeReviewReport.judging.humanBlindReview, {
  status: 'complete', reviewer: 'reviewer-a', notes: 'Blind review completed for 50 selected samples.',
})

console.log('[PASS] privacy-safe public evaluation fixtures and report contract')
