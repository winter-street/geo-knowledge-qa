import type { AgentIntent, AgentToolName } from '../../types/index.js'

export const PERFORMANCE_MODES = ['direct', 'rag', 'kg', 'hybrid', 'agent'] as const
export type PerformanceMode = typeof PERFORMANCE_MODES[number]

export const PERFORMANCE_STAGES = [
  'auth', 'retrieval', 'rerank', 'intent', 'entity_link', 'planning',
  'tools', 'llm', 'grounding', 'persistence', 'total',
] as const
export type PerformanceStage = typeof PERFORMANCE_STAGES[number]

export interface BenchmarkCase {
  id: string
  kind: 'supported' | 'refusal'
  question: string
  split?: 'development' | 'test'
  relevantDocumentIds?: string[]
  acceptedCitationIds?: string[]
  expectedIntent?: AgentIntent
  expectedTools?: AgentToolName[]
  expectedEntityId?: string
}

export type ObservationStatus =
  | 'success'
  | 'http_error'
  | 'timeout'
  | 'protocol_error'
  | 'supplier_rate_limit'

export interface RequestObservation {
  runId: string
  requestId: string
  caseId: string
  mode: PerformanceMode
  status: ObservationStatus
  httpStatus?: number
  totalMs: number
  ttfbMs?: number
  firstEventMs?: number
  firstContentMs?: number
  stageTimings?: Partial<Record<PerformanceStage, number>>
  retrievedDocumentIds: string[]
  citationIds: string[]
  predictedIntent?: AgentIntent
  selectedTools: AgentToolName[]
  linkedEntityId?: string
  refused?: boolean
  totalClaims?: number
  unsupportedClaims?: number
  llmCalls?: number
  inputTokens?: number
  outputTokens?: number
  errorCategory?: string
}

export interface PerformanceDiagnostics {
  runId?: string
  requestId?: string
  stages: Partial<Record<PerformanceStage, number>>
  counters: {
    ragCount?: number
    kgCount?: number
    spatialCount?: number
    toolCount?: number
    llmCalls?: number
    inputTokens?: number
    outputTokens?: number
  }
}

export interface PerformanceModeSummary {
  mode: PerformanceMode
  requestCount: number
  successRate: number
  errorRate: number
  timeoutRate: number
  latencyMs: { p50: number; p95: number; p99: number; p99ReferenceOnly: boolean }
  sseMs?: {
    firstEventP50: number
    firstEventP95: number
    firstContentP50: number
    firstContentP95: number
    completeP50: number
    completeP95: number
  }
  retrieval?: { recallAt5: number | null; mrrAt10: number | null }
  quality?: {
    intentAccuracy: number | null
    toolSelectionAccuracy: number | null
    entityLinkTop1Accuracy: number | null
    citationPrecision: number | null
    refusalFalseAnswerRate: number | null
    unsupportedClaimRate: number | null
  }
}

export interface PerformanceRunManifest {
  runId: string
  label: string
  createdAt: string
  gitCommit: string
  nodeVersion: string
  pythonVersion?: string
  neo4jVersion?: string
  dataSnapshotHash?: string
  model: string
  synthetic: boolean
}

export interface ThresholdResult {
  value: number
  operator: '<=' | '>='
  threshold: number
  passed: boolean
}

export interface PerformanceSummary {
  schemaVersion: '1.0'
  manifest: PerformanceRunManifest
  observationCount: number
  modes: PerformanceModeSummary[]
  overall: {
    successRate: number
    rawSuccessRate: number
    supplierRateLimitRate: number
    throughputPerSecond?: number
  }
  thresholds: Record<string, ThresholdResult>
  errorCategories: Array<{ category: string; count: number }>
  resources: Array<{
    name: string
    sampleCount: number
    availabilityRate: number
    peakWorkingSetBytes?: number
    peakCpuPercent?: number
  }>
  limitations: string[]
}

export interface PublicPerformanceSummary {
  schemaVersion: '1.0'
  manifest: PerformanceRunManifest
  observationCount: number
  modes: PerformanceModeSummary[]
  overall: PerformanceSummary['overall']
  thresholds: Record<string, ThresholdResult>
  errorCategories: Array<{ category: string; count: number }>
  resources: PerformanceSummary['resources']
  limitations: string[]
  privacy: { rawContentIncluded: false; publishable: boolean }
}
