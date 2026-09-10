import type {
  BenchmarkCase,
  PerformanceMode,
  PerformanceModeSummary,
  PerformanceRunManifest,
  PerformanceSummary,
  RequestObservation,
  ThresholdResult,
} from './types.js'
import { PERFORMANCE_MODES } from './types.js'
import { percentile } from './statistics.js'
import type { ProcessResourceSample } from './process-sampler.js'

export interface AggregateRunInput {
  manifest: PerformanceRunManifest
  observations: RequestObservation[]
  cases?: BenchmarkCase[]
  durationMs?: number
  limitations?: string[]
  resourceSamples?: ProcessResourceSample[]
}

function ratio(numerator: number, denominator: number): number {
  return denominator === 0 ? 0 : numerator / denominator
}

function nullableRatio(numerator: number, denominator: number): number | null {
  return denominator === 0 ? null : numerator / denominator
}

function sameSet(left: string[], right: string[]): boolean {
  return [...new Set(left)].sort().join('\u0000') === [...new Set(right)].sort().join('\u0000')
}

function threshold(value: number, operator: '<=' | '>=', target: number): ThresholdResult {
  return { value, operator, threshold: target, passed: operator === '<=' ? value <= target : value >= target }
}

function aggregateMode(
  mode: PerformanceMode,
  observations: RequestObservation[],
  cases: Map<string, BenchmarkCase>,
): PerformanceModeSummary {
  const successful = observations.filter((item) => item.status === 'success')
  const latencies = observations.map((item) => item.totalMs)
  const firstEvents = observations.flatMap((item) => item.firstEventMs === undefined ? [] : [item.firstEventMs])
  const firstContents = observations.flatMap((item) => item.firstContentMs === undefined ? [] : [item.firstContentMs])
  const retrievalApplicable = mode === 'rag' || mode === 'hybrid' || mode === 'agent'
  const supported = successful.filter((item) => (cases.get(item.caseId)?.relevantDocumentIds?.length ?? 0) > 0)
  const recallValues = supported.map((item) => {
    const relevant = cases.get(item.caseId)?.relevantDocumentIds ?? []
    const retrieved = new Set(item.retrievedDocumentIds.slice(0, 5))
    return ratio(relevant.filter((id) => retrieved.has(id)).length, relevant.length)
  })
  const reciprocalRanks = supported.map((item) => {
    const relevant = new Set(cases.get(item.caseId)?.relevantDocumentIds ?? [])
    const rank = item.retrievedDocumentIds.slice(0, 10).findIndex((id) => relevant.has(id))
    return rank < 0 ? 0 : 1 / (rank + 1)
  })

  let citationCount = 0
  let acceptedCitationCount = 0
  let claimCount = 0
  let unsupportedClaimCount = 0
  let refusalCount = 0
  let refusalFalseAnswers = 0
  let intentCases = 0
  let correctIntents = 0
  let toolCases = 0
  let correctTools = 0
  let entityCases = 0
  let correctEntities = 0
  for (const item of successful) {
    const testCase = cases.get(item.caseId)
    if (!testCase) continue
    const accepted = new Set(testCase.acceptedCitationIds ?? [])
    citationCount += item.citationIds.length
    acceptedCitationCount += item.citationIds.filter((id) => accepted.has(id)).length
    claimCount += item.totalClaims ?? 0
    unsupportedClaimCount += item.unsupportedClaims ?? 0
    if (testCase.kind === 'refusal') {
      refusalCount += 1
      if (item.refused === false) refusalFalseAnswers += 1
    }
    if (testCase.expectedIntent) {
      intentCases += 1
      if (item.predictedIntent === testCase.expectedIntent) correctIntents += 1
    }
    if (testCase.expectedTools) {
      toolCases += 1
      if (sameSet(item.selectedTools, testCase.expectedTools)) correctTools += 1
    }
    if (testCase.expectedEntityId) {
      entityCases += 1
      if (item.linkedEntityId === testCase.expectedEntityId) correctEntities += 1
    }
  }

  return {
    mode,
    requestCount: observations.length,
    successRate: ratio(successful.length, observations.length),
    errorRate: ratio(observations.filter((item) => item.status === 'http_error' || item.status === 'protocol_error').length, observations.length),
    timeoutRate: ratio(observations.filter((item) => item.status === 'timeout').length, observations.length),
    latencyMs: {
      p50: percentile(latencies, 0.5),
      p95: percentile(latencies, 0.95),
      p99: percentile(latencies, 0.99),
      p99ReferenceOnly: latencies.length < 100,
    },
    ...(firstEvents.length > 0 || firstContents.length > 0 ? {
      sseMs: {
        firstEventP50: percentile(firstEvents, 0.5),
        firstEventP95: percentile(firstEvents, 0.95),
        firstContentP50: percentile(firstContents, 0.5),
        firstContentP95: percentile(firstContents, 0.95),
        completeP50: percentile(latencies, 0.5),
        completeP95: percentile(latencies, 0.95),
      },
    } : {}),
    retrieval: retrievalApplicable
      ? {
          recallAt5: recallValues.length === 0 ? null : recallValues.reduce((sum, value) => sum + value, 0) / recallValues.length,
          mrrAt10: reciprocalRanks.length === 0 ? null : reciprocalRanks.reduce((sum, value) => sum + value, 0) / reciprocalRanks.length,
        }
      : { recallAt5: null, mrrAt10: null },
    quality: {
      intentAccuracy: nullableRatio(correctIntents, intentCases),
      toolSelectionAccuracy: nullableRatio(correctTools, toolCases),
      entityLinkTop1Accuracy: nullableRatio(correctEntities, entityCases),
      citationPrecision: nullableRatio(acceptedCitationCount, citationCount),
      refusalFalseAnswerRate: nullableRatio(refusalFalseAnswers, refusalCount),
      unsupportedClaimRate: nullableRatio(unsupportedClaimCount, claimCount),
    },
  }
}

export function aggregateRun(input: AggregateRunInput): PerformanceSummary {
  const cases = new Map((input.cases ?? []).map((item) => [item.id, item]))
  const modes = PERFORMANCE_MODES.map((mode) =>
    aggregateMode(mode, input.observations.filter((item) => item.mode === mode), cases))
  const rateLimited = input.observations.filter((item) => item.status === 'supplier_rate_limit').length
  const validAttempts = input.observations.length - rateLimited
  const successes = input.observations.filter((item) => item.status === 'success').length
  const errors = input.observations.filter((item) => item.status === 'http_error' || item.status === 'protocol_error').length
  const timeouts = input.observations.filter((item) => item.status === 'timeout').length
  const firstEventP95 = percentile(input.observations.flatMap((item) => item.firstEventMs === undefined ? [] : [item.firstEventMs]), 0.95)
  const firstContentP95 = percentile(input.observations.flatMap((item) => item.firstContentMs === undefined ? [] : [item.firstContentMs]), 0.95)
  const errorCounts = new Map<string, number>()
  for (const item of input.observations) {
    if (item.status === 'success') continue
    const category = item.errorCategory || item.status
    errorCounts.set(category, (errorCounts.get(category) ?? 0) + 1)
  }
  const errorRate = ratio(errors, input.observations.length)
  const timeoutRate = ratio(timeouts, input.observations.length)
  const resourceNames = [...new Set((input.resourceSamples ?? []).map((item) => item.name))]
  const resources = resourceNames.map((name) => {
    const samples = (input.resourceSamples ?? []).filter((item) => item.name === name)
    const available = samples.filter((item) => item.available)
    const workingSets = available.flatMap((item) => item.workingSetBytes === undefined ? [] : [item.workingSetBytes])
    const cpuValues = available.flatMap((item) => item.cpuPercent === undefined ? [] : [item.cpuPercent])
    return {
      name,
      sampleCount: samples.length,
      availabilityRate: ratio(available.length, samples.length),
      ...(workingSets.length > 0 ? { peakWorkingSetBytes: Math.max(...workingSets) } : {}),
      ...(cpuValues.length > 0 ? { peakCpuPercent: Math.max(...cpuValues) } : {}),
    }
  })
  return {
    schemaVersion: '1.0',
    manifest: input.manifest,
    observationCount: input.observations.length,
    modes,
    overall: {
      successRate: ratio(successes, validAttempts),
      rawSuccessRate: ratio(successes, input.observations.length),
      supplierRateLimitRate: ratio(rateLimited, input.observations.length),
      ...(input.durationMs && input.durationMs > 0 ? { throughputPerSecond: successes / (input.durationMs / 1_000) } : {}),
    },
    thresholds: {
      errorRate: threshold(errorRate, '<=', 0.01),
      timeoutRate: threshold(timeoutRate, '<=', 0.01),
      ...(firstEventP95 > 0 ? { sseFirstEventP95: threshold(firstEventP95, '<=', 1_000) } : {}),
      ...(firstContentP95 > 0 ? { sseFirstContentP95: threshold(firstContentP95, '<=', 2_000) } : {}),
    },
    errorCategories: [...errorCounts.entries()].map(([category, count]) => ({ category, count })).sort((left, right) => right.count - left.count),
    resources,
    limitations: [...new Set(input.limitations ?? [])],
  }
}
