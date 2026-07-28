import type {
  AcceptanceCheck,
  EvaluationMetrics,
  EvaluationReport,
  EvaluationRunInput,
  EvaluationSplit,
  HumanBlindReview,
} from './types.js'
import { evaluationRunInputSchema } from './schemas.js'

function average(values: number[]): number {
  return values.length === 0 ? 0 : values.reduce((sum, value) => sum + value, 0) / values.length
}

function ratio(numerator: number, denominator: number, emptyValue = 0): number {
  return denominator === 0 ? emptyValue : numerator / denominator
}

function sameSet(left: string[], right: string[]): boolean {
  return [...new Set(left)].sort().join('\u0000') === [...new Set(right)].sort().join('\u0000')
}

function percentile(values: number[], percentileValue: number): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((left, right) => left - right)
  return sorted[Math.max(0, Math.ceil(percentileValue * sorted.length) - 1)] ?? 0
}

function check(value: number, threshold: number, operator: '>=' | '<='): AcceptanceCheck {
  return { value, threshold, operator, passed: operator === '>=' ? value >= threshold : value <= threshold }
}

function duplicateId(values: string[]): string | undefined {
  const seen = new Set<string>()
  for (const value of values) {
    if (seen.has(value)) return value
    seen.add(value)
  }
  return undefined
}

function validateRunCoverage(input: EvaluationRunInput, split: EvaluationSplit): void {
  const singleCaseIds = input.suite.singleTurnCases.map((item) => item.id)
  const multiCaseIds = input.suite.multiTurnCases.map((item) => item.id)
  if (duplicateId(singleCaseIds)) throw new Error('Duplicate single-turn case ID.')
  if (duplicateId(multiCaseIds)) throw new Error('Duplicate multi-turn case ID.')

  const singleResultIds = input.singleTurnResults.map((item) => item.caseId)
  const multiResultIds = input.multiTurnResults.map((item) => item.caseId)
  if (duplicateId(singleResultIds)) throw new Error('Duplicate single-turn result.')
  if (duplicateId(multiResultIds)) throw new Error('Duplicate multi-turn result.')

  const knownSingleIds = new Set(singleCaseIds)
  const knownMultiIds = new Set(multiCaseIds)
  if (singleResultIds.some((id) => !knownSingleIds.has(id))) throw new Error('Unknown single-turn result case ID.')
  if (multiResultIds.some((id) => !knownMultiIds.has(id))) throw new Error('Unknown multi-turn result case ID.')

  const selectedSingleIds = input.suite.singleTurnCases.filter((item) => item.split === split).map((item) => item.id)
  const selectedMultiIds = input.suite.multiTurnCases.filter((item) => item.split === split).map((item) => item.id)
  const resultSingleSet = new Set(singleResultIds)
  const resultMultiSet = new Set(multiResultIds)
  if (selectedSingleIds.some((id) => !resultSingleSet.has(id))) {
    throw new Error('Expected exactly one result for each selected single-turn case.')
  }
  if (selectedMultiIds.some((id) => !resultMultiSet.has(id))) {
    throw new Error('Expected exactly one result for each selected multi-turn case.')
  }
  if (singleResultIds.some((id) => !selectedSingleIds.includes(id))) {
    throw new Error('Single-turn results must belong to the selected split.')
  }
  if (multiResultIds.some((id) => !selectedMultiIds.includes(id))) {
    throw new Error('Multi-turn results must belong to the selected split.')
  }

  const multiCaseById = new Map(input.suite.multiTurnCases.map((item) => [item.id, item]))
  for (const result of input.multiTurnResults) {
    if (result.turnSuccess.length !== multiCaseById.get(result.caseId)?.turns.length) {
      throw new Error('Multi-turn result must contain one success flag per turn.')
    }
  }
}

function aggregateHumanReview(input: EvaluationRunInput, split: EvaluationSplit): HumanBlindReview {
  const selected = [
    ...input.suite.singleTurnCases.filter((item) => item.split === split),
    ...input.suite.multiTurnCases.filter((item) => item.split === split),
  ]
  const reviews = selected.map((item) => item.humanBlindReview)
  if (reviews.length === 0 || reviews.some((review) => review?.status !== 'complete')) {
    return { status: 'pending', reviewer: null, notes: null }
  }
  const reviewers = [...new Set(reviews.flatMap((review) => review?.reviewer ?? []))]
  return {
    status: 'complete',
    reviewer: reviewers.length === 1 ? reviewers[0]! : null,
    notes: `Blind review completed for ${reviews.length} selected samples.`,
  }
}

export function evaluateRun(input: EvaluationRunInput, split: EvaluationSplit): EvaluationReport {
  input = evaluationRunInputSchema.parse(input) as EvaluationRunInput
  validateRunCoverage(input, split)
  const singleCases = input.suite.singleTurnCases.filter((item) => item.split === split)
  const multiCases = input.suite.multiTurnCases.filter((item) => item.split === split)
  const singleResultById = new Map(input.singleTurnResults.map((item) => [item.caseId, item]))
  const multiResultById = new Map(input.multiTurnResults.map((item) => [item.caseId, item]))
  const supportedCases = singleCases.filter((item) => item.kind === 'supported' && item.relevantDocumentIds.length > 0)

  const recallAt5 = average(supportedCases.map((item) => {
    const retrieved = new Set(singleResultById.get(item.id)?.retrievedDocumentIds.slice(0, 5) ?? [])
    return ratio(item.relevantDocumentIds.filter((id) => retrieved.has(id)).length, item.relevantDocumentIds.length)
  }))
  const mrrAt10 = average(supportedCases.map((item) => {
    const relevant = new Set(item.relevantDocumentIds)
    const rank = (singleResultById.get(item.id)?.retrievedDocumentIds.slice(0, 10) ?? [])
      .findIndex((id) => relevant.has(id))
    return rank < 0 ? 0 : 1 / (rank + 1)
  }))

  let citationCount = 0
  let validCitationCount = 0
  let totalClaims = 0
  let unsupportedClaims = 0
  let directClaims = 0
  let directUnsupportedClaims = 0
  for (const item of singleCases) {
    const result = singleResultById.get(item.id)
    if (!result) continue
    citationCount += result.citationIds.length
    const accepted = new Set(item.acceptedCitationIds)
    validCitationCount += result.citationIds.filter((id) => accepted.has(id)).length
    totalClaims += result.totalClaims
    unsupportedClaims += result.unsupportedClaims
    directClaims += result.directBaselineTotalClaims
    directUnsupportedClaims += result.directBaselineUnsupportedClaims
  }

  const refusalCases = singleCases.filter((item) => item.kind === 'refusal')
  const entityCases = singleCases.filter((item) => item.expectedEntityId)
  const multiSuccess = multiCases.filter((item) => {
    const result = multiResultById.get(item.id)
    return Boolean(result)
      && result!.turnSuccess.length === item.turns.length
      && result!.turnSuccess.every(Boolean)
  }).length
  const latencies = [
    ...singleCases.flatMap((item) => {
      const latency = singleResultById.get(item.id)?.latencyMs
      return latency === undefined ? [] : [latency]
    }),
    ...multiCases.flatMap((item) => {
      const latency = multiResultById.get(item.id)?.latencyMs
      return latency === undefined ? [] : [latency]
    }),
  ]
  const unsupportedClaimRate = ratio(unsupportedClaims, totalClaims)
  const directUnsupportedClaimRate = ratio(directUnsupportedClaims, directClaims)

  const metrics: EvaluationMetrics = {
    recallAt5,
    mrrAt10,
    intentAccuracy: ratio(singleCases.filter((item) =>
      singleResultById.get(item.id)?.predictedIntent === item.expectedIntent).length, singleCases.length),
    toolSelectionAccuracy: ratio(singleCases.filter((item) =>
      sameSet(singleResultById.get(item.id)?.selectedTools ?? [], item.expectedTools)).length, singleCases.length),
    entityLinkTop1Accuracy: ratio(entityCases.filter((item) =>
      singleResultById.get(item.id)?.linkedEntityId === item.expectedEntityId).length, entityCases.length),
    citationPrecision: ratio(validCitationCount, citationCount, singleCases.some((item) => item.acceptedCitationIds.length > 0) ? 0 : 1),
    refusalFalseAnswerRate: ratio(refusalCases.filter((item) => {
      const result = singleResultById.get(item.id)
      return Boolean(result?.answeredFactually && !result.refused)
    }).length, refusalCases.length),
    multiTurnTaskSuccess: ratio(multiSuccess, multiCases.length),
    unsupportedClaimRate,
    directUnsupportedClaimRate,
    unsupportedClaimImprovement: directUnsupportedClaimRate - unsupportedClaimRate,
    orchestrationLatencyMs: { p50: percentile(latencies, 0.5), p95: percentile(latencies, 0.95) },
  }

  return {
    schemaVersion: '1.0',
    runKind: 'synthetic-harness-validation',
    split,
    caseCounts: { singleTurn: singleCases.length, multiTurn: multiCases.length },
    metrics,
    acceptance: {
      recallAt5: check(metrics.recallAt5, 0.8, '>='),
      mrrAt10: check(metrics.mrrAt10, 0.7, '>='),
      intentAccuracy: check(metrics.intentAccuracy, 0.9, '>='),
      toolSelectionAccuracy: check(metrics.toolSelectionAccuracy, 0.9, '>='),
      entityLinkTop1Accuracy: check(metrics.entityLinkTop1Accuracy, 0.85, '>='),
      citationPrecision: check(metrics.citationPrecision, 0.9, '>='),
      refusalFalseAnswerRate: check(metrics.refusalFalseAnswerRate, 0.1, '<='),
      multiTurnTaskSuccess: check(metrics.multiTurnTaskSuccess, 0.8, '>='),
      unsupportedClaimRate: check(metrics.unsupportedClaimRate, 0.35, '<='),
      unsupportedClaimImprovement: check(metrics.unsupportedClaimImprovement, 0.2, '>='),
    },
    judging: {
      automated: 'auxiliary-only',
      humanBlindReview: aggregateHumanReview(input, split),
    },
  }
}

export function renderEvaluationReport(report: EvaluationReport): string {
  const metricRows = Object.entries(report.acceptance).map(([name, item]) =>
    `| ${name} | ${item.value.toFixed(3)} | ${item.operator} ${item.threshold.toFixed(2)} | ${item.passed ? 'pass' : 'fail'} |`,
  )
  return `# Synthetic Harness Validation\n\n`
    + `Split: \`${report.split}\`\n\n`
    + `This report validates the deterministic evaluation harness. It is not a model-performance claim. Automated judging is auxiliary only.\n\n`
    + `Human blind review: ${report.judging.humanBlindReview.status}\n\n`
    + `| Metric | Value | Threshold | Status |\n|---|---:|---:|---|\n${metricRows.join('\n')}\n\n`
    + `Latency: p50 ${report.metrics.orchestrationLatencyMs.p50} ms, p95 ${report.metrics.orchestrationLatencyMs.p95} ms.\n`
}
