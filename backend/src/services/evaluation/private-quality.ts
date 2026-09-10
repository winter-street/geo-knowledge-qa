import { createHash } from 'node:crypto'
import { z } from 'zod'

const intentSchema = z.enum([
  'geology_qa', 'entity_lookup', 'spatial_analysis',
  'region_comparison', 'chitchat', 'clarification',
])
const toolSchema = z.enum([
  'search_documents', 'query_knowledge_graph', 'spatial_query', 'get_entity_detail',
])
const expectedOutcomeSchema = z.enum(['answered', 'clarification_required', 'refused'])
const fingerprintSchema = z.string().regex(/^[a-f0-9]{64}$/)

const privateTurnSchema = z.object({
  id: z.string().min(1),
  question: z.string().min(1),
  expectedIntent: intentSchema,
  expectedTools: z.array(toolSchema).max(3),
  relevantDocumentFingerprints: z.array(fingerprintSchema),
  acceptedEntityIds: z.array(z.string().min(1)),
  expectedOutcome: expectedOutcomeSchema,
})

export const privateEvaluationSuiteSchema = z.object({
  schemaVersion: z.literal('1.0'),
  private: z.literal(true),
  frozenAt: z.string().datetime(),
  label: z.string().min(1),
  singleTurnCases: z.array(privateTurnSchema.extend({
    kind: z.enum(['supported', 'refusal']),
  })).length(40),
  multiTurnCases: z.array(z.object({
    id: z.string().min(1),
    turns: z.array(privateTurnSchema).length(3),
  })).length(10),
}).superRefine((suite, context) => {
  const supported = suite.singleTurnCases.filter((item) => item.kind === 'supported').length
  const refusal = suite.singleTurnCases.filter((item) => item.kind === 'refusal').length
  if (supported !== 30 || refusal !== 10) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['singleTurnCases'],
      message: 'Private suite must contain exactly 30 supported and 10 refusal cases.',
    })
  }
  const ids = [
    ...suite.singleTurnCases.map((item) => item.id),
    ...suite.multiTurnCases.flatMap((item) => [item.id, ...item.turns.map((turn) => turn.id)]),
  ]
  if (new Set(ids).size !== ids.length) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['singleTurnCases'], message: 'Case IDs must be unique.' })
  }
})

export type PrivateQualitySuite = z.infer<typeof privateEvaluationSuiteSchema>
export type PrivateEvaluationVariant = 'baseline' | 'candidate'
export type PrivateQualityMode = 'direct' | 'rag' | 'kg' | 'hybrid' | 'agent'

export interface PrivateQualityObservation {
  caseId: string
  mode: PrivateQualityMode
  conversationGroupId?: string
  turnIndex?: number
  question: string
  answer: string
  retrievedDocumentFingerprints: string[]
  citationIds: string[]
  predictedIntent?: z.infer<typeof intentSchema>
  selectedTools: z.infer<typeof toolSchema>[]
  linkedEntityIds: string[]
  agentOutcome?: z.infer<typeof expectedOutcomeSchema>
  replanCount: number
  latencyMs: number
  completedAt: string
  retrievalHitRanks?: number[]
  expectedOutcomeMatched?: boolean
  intentMatched?: boolean
  toolSelectionMatched?: boolean
  entityMatched?: boolean
}

export interface PrivateQualityRun {
  label: string
  variant: PrivateEvaluationVariant
  suiteHash: string
  startedAt: string
  completedAt: string
  observations: PrivateQualityObservation[]
}

export function hashPrivateSuite(suite: PrivateQualitySuite): string {
  return createHash('sha256').update(JSON.stringify(suite), 'utf8').digest('hex')
}

export function estimatePrivateApiCalls(suite: PrivateQualitySuite, variant: PrivateEvaluationVariant) {
  const singleCount = suite.singleTurnCases.length
  const multiTurnCount = suite.multiTurnCases.reduce((sum, item) => sum + item.turns.length, 0)
  const singleCalls = singleCount * 4 + singleCount * 2
  const multiCalls = multiTurnCount * 2 + multiTurnCount * 2
  const replanAllowance = variant === 'candidate' ? singleCount + multiTurnCount : 0
  return {
    estimated: singleCalls + multiCalls + replanAllowance,
    limits: variant === 'baseline'
      ? { warning: 350, hard: 400 }
      : { warning: 450, hard: 480 },
  }
}

function average(values: number[]): number {
  return values.length === 0 ? 0 : values.reduce((sum, value) => sum + value, 0) / values.length
}

function ratio(numerator: number, denominator: number): number {
  return denominator === 0 ? 0 : numerator / denominator
}

function percentile(values: number[], fraction: number): number {
  if (values.length === 0) return 0
  const ordered = [...values].sort((left, right) => left - right)
  return ordered[Math.max(0, Math.ceil(ordered.length * fraction) - 1)] ?? 0
}

export function projectPrivateRunPublicly(run: PrivateQualityRun) {
  const modes = ['direct', 'rag', 'kg', 'hybrid', 'agent'] as const
  return {
    schemaVersion: '1.0',
    runKind: 'private-domain-evaluation-summary',
    label: run.label,
    variant: run.variant,
    suiteHash: run.suiteHash,
    startedAt: run.startedAt,
    completedAt: run.completedAt,
    humanReviewStatus: 'pending' as const,
    semanticCitationCorrectness: null,
    modes: Object.fromEntries(modes.map((mode) => {
      const observations = run.observations.filter((item) => item.mode === mode)
      const retrievalCases = observations.filter((item) => item.retrievalHitRanks)
      const recallAt5 = average(retrievalCases.map((item) =>
        ratio(item.retrievalHitRanks!.filter((rank) => rank > 0 && rank <= 5).length, item.retrievalHitRanks!.length),
      ))
      const mrrAt10 = average(retrievalCases.map((item) => {
        const rank = item.retrievalHitRanks!.filter((value) => value > 0 && value <= 10).sort((a, b) => a - b)[0]
        return rank ? 1 / rank : 0
      }))
      return [mode, {
        observationCount: observations.length,
        recallAt5,
        mrrAt10,
        refusalComplianceRate: ratio(
          observations.filter((item) => item.expectedOutcomeMatched).length,
          observations.filter((item) => item.expectedOutcomeMatched !== undefined).length,
        ),
        intentAccuracy: ratio(
          observations.filter((item) => item.intentMatched).length,
          observations.filter((item) => item.intentMatched !== undefined).length,
        ),
        toolSelectionAccuracy: ratio(
          observations.filter((item) => item.toolSelectionMatched).length,
          observations.filter((item) => item.toolSelectionMatched !== undefined).length,
        ),
        entityAccuracy: ratio(
          observations.filter((item) => item.entityMatched).length,
          observations.filter((item) => item.entityMatched !== undefined).length,
        ),
        validCitationIdRate: ratio(
          observations.flatMap((item) => item.citationIds).filter((id) => /^(D\d+-P\d+|KG\d+)$/.test(id)).length,
          observations.flatMap((item) => item.citationIds).length,
        ),
        replanTriggerRate: ratio(observations.filter((item) => item.replanCount > 0).length, observations.length),
        latencyMs: {
          mean: average(observations.map((item) => item.latencyMs)),
          p95: percentile(observations.map((item) => item.latencyMs), 0.95),
        },
      }]
    })),
  }
}
