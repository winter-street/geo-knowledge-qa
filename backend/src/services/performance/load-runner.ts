import { performance } from 'node:perf_hooks'
import type { RequestObservation } from './types.js'

export type ScenarioId = 'hybrid-json' | 'agent-json' | 'agent-sse' | 'agent-multiturn'

export interface LoadRequest {
  runId: string
  requestId: string
  workerId: number
  caseId: string
  question: string
  conversationId: string
  turnIndex?: number
}

export interface LoadClient {
  execute(request: LoadRequest): Promise<RequestObservation>
}

export interface LoadScenarioConfig {
  runId: string
  scenario: ScenarioId
  concurrency: number
  questions: Array<{ id: string; question: string }>
  warmupMs?: number
  durationMs?: number
  now?: () => number
}

export interface LoadScenarioResult {
  scenario: ScenarioId
  concurrency: number
  warmupMs: number
  durationMs: number
  observations: RequestObservation[]
  warmupRequestCount: number
}

export async function runLoadScenario(
  config: LoadScenarioConfig,
  clientFactory: (workerId: number) => Promise<LoadClient> | LoadClient,
): Promise<LoadScenarioResult> {
  if (!Number.isInteger(config.concurrency) || config.concurrency < 1 || config.concurrency > 100) {
    throw new RangeError('concurrency must be an integer between 1 and 100')
  }
  if (config.questions.length === 0) throw new Error('load scenario requires at least one question')
  const now = config.now ?? (() => performance.now())
  const warmupMs = Math.max(0, config.warmupMs ?? 15_000)
  const durationMs = Math.max(1, config.durationMs ?? 60_000)
  const startedAt = now()
  const measurementStartedAt = startedAt + warmupMs
  const deadline = measurementStartedAt + durationMs
  const observations: RequestObservation[] = []
  let warmupRequestCount = 0

  const workers = Array.from({ length: config.concurrency }, async (_, workerId) => {
    const client = await clientFactory(workerId)
    let sequence = 0
    while (now() < deadline) {
      const requestStartedAt = now()
      const question = config.questions[(workerId + sequence) % config.questions.length]!
      const conversationId = `${config.runId}-${config.scenario}-worker-${workerId}`
      const turns = config.scenario === 'agent-multiturn' ? [0, 1, 2] : [undefined]
      for (const turnIndex of turns) {
        if (now() >= deadline) break
        const requestId = `${config.runId}-${config.scenario}-${workerId}-${sequence}-${turnIndex ?? 0}`
        const observation = await client.execute({
          runId: config.runId,
          requestId,
          workerId,
          caseId: question.id,
          question: question.question,
          conversationId,
          turnIndex,
        })
        if (requestStartedAt >= measurementStartedAt) observations.push(observation)
        else warmupRequestCount += 1
      }
      sequence += 1
    }
  })
  await Promise.all(workers)
  return { scenario: config.scenario, concurrency: config.concurrency, warmupMs, durationMs, observations, warmupRequestCount }
}
