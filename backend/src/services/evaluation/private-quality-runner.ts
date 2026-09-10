import type {
  PrivateEvaluationVariant,
  PrivateQualityMode,
  PrivateQualityObservation,
  PrivateQualitySuite,
} from './private-quality.js'

type PrivateTurn = PrivateQualitySuite['singleTurnCases'][number]
  | PrivateQualitySuite['multiTurnCases'][number]['turns'][number]

export interface PrivateAdapterObservation {
  answer: string
  retrievedDocumentFingerprints: string[]
  citationIds: string[]
  predictedIntent?: PrivateTurn['expectedIntent']
  selectedTools: PrivateTurn['expectedTools']
  linkedEntityIds: string[]
  agentOutcome?: PrivateTurn['expectedOutcome']
  replanCount: number
  latencyMs: number
  conversationId?: string
}

export interface PrivateQualityAdapter {
  executeDirect(input: { testCase: PrivateTurn }): Promise<PrivateAdapterObservation>
  executeQa(input: {
    mode: Exclude<PrivateQualityMode, 'direct'>
    testCase: PrivateTurn
    conversationId?: string
  }): Promise<PrivateAdapterObservation>
}

export function privateObservationKey(observation: Pick<
  PrivateQualityObservation,
  'caseId' | 'mode' | 'conversationGroupId' | 'turnIndex'
>): string {
  return observation.conversationGroupId
    ? `multi:${observation.conversationGroupId}:${observation.mode}:${observation.turnIndex}`
    : `single:${observation.caseId}:${observation.mode}`
}

function sameSet(left: string[], right: string[]): boolean {
  return [...new Set(left)].sort().join('\0') === [...new Set(right)].sort().join('\0')
}

function finalizeObservation(
  testCase: PrivateTurn,
  mode: PrivateQualityMode,
  observation: PrivateAdapterObservation,
  context: { conversationGroupId?: string; turnIndex?: number } = {},
): PrivateQualityObservation {
  const ranks = testCase.relevantDocumentFingerprints.map((fingerprint) => {
    const rank = observation.retrievedDocumentFingerprints.indexOf(fingerprint)
    return rank < 0 ? 0 : rank + 1
  })
  const expectsEntity = testCase.acceptedEntityIds.length > 0
  return {
    caseId: testCase.id,
    mode,
    ...context,
    question: testCase.question,
    answer: observation.answer,
    retrievedDocumentFingerprints: observation.retrievedDocumentFingerprints,
    citationIds: observation.citationIds,
    ...(observation.predictedIntent ? { predictedIntent: observation.predictedIntent } : {}),
    selectedTools: observation.selectedTools,
    linkedEntityIds: observation.linkedEntityIds,
    ...(observation.agentOutcome ? { agentOutcome: observation.agentOutcome } : {}),
    replanCount: observation.replanCount,
    latencyMs: observation.latencyMs,
    completedAt: new Date().toISOString(),
    ...(ranks.length > 0 ? { retrievalHitRanks: ranks } : {}),
    ...(observation.agentOutcome
      ? { expectedOutcomeMatched: observation.agentOutcome === testCase.expectedOutcome }
      : {}),
    ...(observation.predictedIntent
      ? { intentMatched: observation.predictedIntent === testCase.expectedIntent }
      : {}),
    ...(mode === 'agent'
      ? { toolSelectionMatched: sameSet(observation.selectedTools, testCase.expectedTools) }
      : {}),
    ...(expectsEntity
      ? { entityMatched: observation.linkedEntityIds.some((id) => testCase.acceptedEntityIds.includes(id)) }
      : {}),
  }
}

export async function runPrivateQualityEvaluation(options: {
  suite: PrivateQualitySuite
  variant: PrivateEvaluationVariant
  adapter: PrivateQualityAdapter
  completedKeys?: Set<string>
  onObservation(observation: PrivateQualityObservation): Promise<void>
}): Promise<PrivateQualityObservation[]> {
  const completed = options.completedKeys ?? new Set<string>()
  const observations: PrivateQualityObservation[] = []
  const singleModes: PrivateQualityMode[] = ['direct', 'rag', 'kg', 'hybrid', 'agent']
  for (const testCase of options.suite.singleTurnCases) {
    for (const mode of singleModes) {
      const key = `single:${testCase.id}:${mode}`
      if (completed.has(key)) continue
      const raw = mode === 'direct'
        ? await options.adapter.executeDirect({ testCase })
        : await options.adapter.executeQa({ mode, testCase })
      const observation = finalizeObservation(testCase, mode, raw)
      await options.onObservation(observation)
      observations.push(observation)
    }
  }

  const multiModes: PrivateQualityMode[] = ['direct', 'hybrid', 'agent']
  for (const testCase of options.suite.multiTurnCases) {
    for (const mode of multiModes) {
      const conversationId = mode === 'direct' ? undefined : `eval-${testCase.id}-${mode}`
      for (let turnIndex = 0; turnIndex < testCase.turns.length; turnIndex += 1) {
        const turn = testCase.turns[turnIndex]!
        const key = `multi:${testCase.id}:${mode}:${turnIndex}`
        if (completed.has(key)) continue
        const raw = mode === 'direct'
          ? await options.adapter.executeDirect({ testCase: turn })
          : await options.adapter.executeQa({ mode: mode as 'hybrid' | 'agent', testCase: turn, conversationId })
        const observation = finalizeObservation(turn, mode, raw, {
          conversationGroupId: testCase.id,
          turnIndex,
        })
        await options.onObservation(observation)
        observations.push(observation)
      }
    }
  }
  return observations
}
