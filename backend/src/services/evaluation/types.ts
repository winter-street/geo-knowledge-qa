import type { AgentIntent, AgentToolName } from '../../types/index.js'

export type EvaluationSplit = 'development' | 'test'
export type EvaluationMode = 'direct' | 'rag' | 'kg' | 'hybrid' | 'agent'

export interface HumanBlindReview {
  status: 'pending' | 'complete'
  reviewer: string | null
  notes: string | null
}

export interface SingleTurnEvaluationCase {
  id: string
  split: EvaluationSplit
  kind: 'supported' | 'refusal'
  synthetic: true
  question: string
  evaluationMode: EvaluationMode
  expectedIntent: AgentIntent
  expectedTools: AgentToolName[]
  expectedEntityId?: string
  expectedStructureId?: string
  expectedRegionId?: string
  relevantDocumentIds: string[]
  acceptedCitationIds: string[]
  humanBlindReview: HumanBlindReview | null
}

export interface MultiTurnEvaluationTurn {
  id: string
  question: string
  expectedIntent: AgentIntent
  expectedTools: AgentToolName[]
  expectedEntityId?: string
  expectedStructureId?: string
  expectedRegionId?: string
}

export interface MultiTurnEvaluationCase {
  id: string
  split: EvaluationSplit
  synthetic: true
  turns: MultiTurnEvaluationTurn[]
  humanBlindReview: HumanBlindReview | null
}

export interface PublicEvaluationSuite {
  schemaVersion: '1.0'
  synthetic: true
  singleTurnCases: SingleTurnEvaluationCase[]
  multiTurnCases: MultiTurnEvaluationCase[]
}

export interface SingleTurnEvaluationResult {
  caseId: string
  retrievedDocumentIds: string[]
  predictedIntent: AgentIntent
  selectedTools: AgentToolName[]
  linkedEntityId?: string
  citationIds: string[]
  refused: boolean
  answeredFactually: boolean
  totalClaims: number
  unsupportedClaims: number
  directBaselineTotalClaims: number
  directBaselineUnsupportedClaims: number
  latencyMs: number
}

export interface MultiTurnEvaluationResult {
  caseId: string
  turnSuccess: boolean[]
  latencyMs: number
}

export interface EvaluationRunInput {
  suite: PublicEvaluationSuite
  singleTurnResults: SingleTurnEvaluationResult[]
  multiTurnResults: MultiTurnEvaluationResult[]
}

export interface EvaluationMetrics {
  recallAt5: number
  mrrAt10: number
  intentAccuracy: number
  toolSelectionAccuracy: number
  entityLinkTop1Accuracy: number
  citationPrecision: number
  refusalFalseAnswerRate: number
  multiTurnTaskSuccess: number
  unsupportedClaimRate: number
  directUnsupportedClaimRate: number
  unsupportedClaimImprovement: number
  orchestrationLatencyMs: { p50: number; p95: number }
}

export interface AcceptanceCheck {
  value: number
  threshold: number
  operator: '>=' | '<='
  passed: boolean
}

export interface EvaluationReport {
  schemaVersion: '1.0'
  runKind: 'synthetic-harness-validation'
  split: EvaluationSplit
  caseCounts: { singleTurn: number; multiTurn: number }
  metrics: EvaluationMetrics
  acceptance: Record<string, AcceptanceCheck>
  judging: {
    automated: 'auxiliary-only'
    humanBlindReview: HumanBlindReview
  }
}
