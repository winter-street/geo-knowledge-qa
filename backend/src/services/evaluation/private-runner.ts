import { evaluationRunInputSchema, evaluationSuiteSchema } from './schemas.js'
import type {
  EvaluationMode,
  EvaluationRunInput,
  EvaluationSplit,
  MultiTurnEvaluationCase,
  PublicEvaluationSuite,
  SingleTurnEvaluationCase,
} from './types.js'
import type { AgentIntent, AgentToolName } from '../../types/index.js'

export interface PrivateSingleObservation {
  retrievedDocumentIds: string[]
  predictedIntent: AgentIntent
  selectedTools: AgentToolName[]
  linkedEntityId?: string
  citationIds: string[]
  refused: boolean
  answeredFactually: boolean
  totalClaims: number
  unsupportedClaims: number
  latencyMs: number
}

export interface PrivateBaselineObservation {
  totalClaims: number
  unsupportedClaims: number
}

export interface PrivateMultiObservation {
  turnSuccess: boolean[]
  latencyMs: number
}

export interface PrivateEvaluationAdapter {
  executeSingle(input: {
    mode: EvaluationMode
    testCase: SingleTurnEvaluationCase
  }): Promise<PrivateSingleObservation>
  executeDirectBaseline(input: {
    testCase: SingleTurnEvaluationCase
  }): Promise<PrivateBaselineObservation>
  executeMulti(input: {
    testCase: MultiTurnEvaluationCase
  }): Promise<PrivateMultiObservation>
}

export async function runPrivateEvaluation(
  suiteInput: PublicEvaluationSuite,
  split: EvaluationSplit,
  adapter: PrivateEvaluationAdapter,
): Promise<EvaluationRunInput> {
  const suite = evaluationSuiteSchema.parse(suiteInput) as PublicEvaluationSuite
  const singleTurnCases = suite.singleTurnCases.filter((item) => item.split === split)
  const multiTurnCases = suite.multiTurnCases.filter((item) => item.split === split)
  const singleTurnResults = []

  for (const testCase of singleTurnCases) {
    const [observation, baseline] = await Promise.all([
      adapter.executeSingle({ mode: testCase.evaluationMode, testCase }),
      adapter.executeDirectBaseline({ testCase }),
    ])
    singleTurnResults.push({
      caseId: testCase.id,
      retrievedDocumentIds: observation.retrievedDocumentIds,
      predictedIntent: observation.predictedIntent,
      selectedTools: observation.selectedTools,
      ...(observation.linkedEntityId ? { linkedEntityId: observation.linkedEntityId } : {}),
      citationIds: observation.citationIds,
      refused: observation.refused,
      answeredFactually: observation.answeredFactually,
      totalClaims: observation.totalClaims,
      unsupportedClaims: observation.unsupportedClaims,
      directBaselineTotalClaims: baseline.totalClaims,
      directBaselineUnsupportedClaims: baseline.unsupportedClaims,
      latencyMs: observation.latencyMs,
    })
  }

  const multiTurnResults = []
  for (const testCase of multiTurnCases) {
    const observation = await adapter.executeMulti({ testCase })
    multiTurnResults.push({
      caseId: testCase.id,
      turnSuccess: observation.turnSuccess,
      latencyMs: observation.latencyMs,
    })
  }

  return evaluationRunInputSchema.parse({
    suite,
    singleTurnResults,
    multiTurnResults,
  }) as EvaluationRunInput
}
