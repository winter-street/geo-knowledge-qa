import { randomUUID } from 'node:crypto'
import type { AppStateStore } from '../../db/app-state.js'
import type {
  AgentIntent,
  AgentMemory,
  AgentPlan,
  AgentToolTrace,
  EntityLinkCandidate,
  KGPath,
  LinkedEntity,
  RetrievalMode,
  SpatialAnalysis,
  SpatialData,
  Chunk,
} from '../../types/index.js'
import { createAgentGraph } from './graph.js'
import type { AgentGraphEvent } from './graph.js'
import type { AgentToolRegistry } from './tools.js'
import type { AgentPlanningInput } from './planner.js'

type RagResult = { chunk: Chunk; score: number }

export interface PrepareAgentTurnInput {
  userId: string
  conversationId?: string
  question: string
  retrievalMode: RetrievalMode
}

export interface AgentOrchestratorDependencies {
  store: AppStateStore
  registry: AgentToolRegistry
  findCandidates(question: string): Promise<EntityLinkCandidate[]>
  createId?(prefix: string): string
  now?(): string
  toolTimeoutMs?: number
  runTimeoutMs?: number
  planWithModel?: (input: AgentPlanningInput) => Promise<AgentPlan>
}

export interface PreparedAgentTurn {
  userId: string
  conversationId: string
  runId: string
  question: string
  rewrittenQuestion: string
  intent: AgentIntent
  linkedEntities: LinkedEntity[]
  plan: AgentPlan
  toolTrace: AgentToolTrace[]
  ragResults: RagResult[]
  kgContext: KGPath[]
  spatialData: SpatialData
  spatialAnalysis?: SpatialAnalysis
  memory: AgentMemory
  startedAtMs: number
}

export interface PrepareAgentTurnOptions {
  onEvent?: (event: AgentGraphEvent) => void
  signal?: AbortSignal
}

function deadlineError(signal: AbortSignal): Error {
  return signal.reason instanceof Error ? signal.reason : new Error('Agent run timed out')
}

async function withAbort<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) throw deadlineError(signal)
  let onAbort: (() => void) | undefined
  try {
    // Some adapters cannot be cancelled; only this raced branch can emit events or persist its result.
    const aborted = new Promise<never>((_, reject) => {
      onAbort = () => reject(deadlineError(signal))
      signal.addEventListener('abort', onAbort, { once: true })
    })
    return await Promise.race([promise, aborted])
  } finally {
    if (onAbort) signal.removeEventListener('abort', onAbort)
  }
}

function idFactory(dependencies: AgentOrchestratorDependencies, prefix: string): string {
  return dependencies.createId?.(prefix) ?? `${prefix}-${randomUUID()}`
}

function currentTime(dependencies: AgentOrchestratorDependencies): string {
  return dependencies.now?.() ?? new Date().toISOString()
}

function ensureConversation(
  input: PrepareAgentTurnInput,
  dependencies: AgentOrchestratorDependencies,
): string {
  const conversationId = input.conversationId || idFactory(dependencies, 'conv')
  if (dependencies.store.getConversation(input.userId, conversationId)) return conversationId
  try {
    dependencies.store.createConversation(
      input.userId,
      conversationId,
      input.question.trim().slice(0, 30) || 'Geological investigation',
      currentTime(dependencies),
    )
  } catch {
    throw new Error('Conversation not found for user')
  }
  return conversationId
}

export async function prepareAgentTurn(
  input: PrepareAgentTurnInput,
  dependencies: AgentOrchestratorDependencies,
  options: PrepareAgentTurnOptions = {},
): Promise<PreparedAgentTurn> {
  const startedAtMs = Date.now()
  const runTimeoutMs = Math.max(1, dependencies.runTimeoutMs ?? 60_000)
  const controller = new AbortController()
  const timeout = setTimeout(
    () => controller.abort(new Error('Agent run timed out')),
    runTimeoutMs,
  )
  const onExternalAbort = () => controller.abort(
    options.signal?.reason instanceof Error
      ? options.signal.reason
      : new Error('Agent run timed out'),
  )
  if (options.signal?.aborted) onExternalAbort()
  else options.signal?.addEventListener('abort', onExternalAbort, { once: true })

  try {
    if (controller.signal.aborted) throw deadlineError(controller.signal)
    const conversationId = ensureConversation(input, dependencies)
    const memory = dependencies.store.loadMemory(input.userId, conversationId)
    dependencies.store.appendMessage(input.userId, conversationId, {
      id: idFactory(dependencies, 'msg'),
      role: 'user',
      content: input.question,
      createdAt: currentTime(dependencies),
    })

    const candidates = await withAbort(dependencies.findCandidates(input.question), controller.signal)
    const remainingMs = runTimeoutMs - (Date.now() - startedAtMs)
    if (remainingMs <= 0 || controller.signal.aborted) throw deadlineError(controller.signal)
    const graph = createAgentGraph({
      registry: dependencies.registry,
      toolTimeoutMs: dependencies.toolTimeoutMs ?? 10_000,
      runTimeoutMs: remainingMs,
      planWithModel: dependencies.planWithModel,
      onEvent: options.onEvent,
      signal: controller.signal,
    })
    const result = await graph.invoke({
      question: input.question,
      retrievalMode: input.retrievalMode,
      memory,
      candidates,
    })

    const runId = idFactory(dependencies, 'run')
    dependencies.store.createAgentRun({
      userId: input.userId,
      id: runId,
      conversationId,
      intent: result.intent,
      status: 'running',
      createdAt: currentTime(dependencies),
    })
    for (const trace of result.toolTrace) {
      dependencies.store.recordToolCall({
        id: idFactory(dependencies, 'tool'),
        runId,
        userId: input.userId,
        toolName: trace.toolName,
        argumentSummary: trace.argumentSummary,
        status: trace.status,
        latencyMs: trace.latencyMs,
        evidenceCount: trace.evidenceCount,
        createdAt: currentTime(dependencies),
      })
    }

    return {
      userId: input.userId,
      conversationId,
      runId,
      question: input.question,
      rewrittenQuestion: result.rewrittenQuestion,
      intent: result.intent,
      linkedEntities: result.linkedEntities,
      plan: result.plan,
      toolTrace: result.toolTrace,
      ragResults: result.ragResults,
      kgContext: result.kgContext,
      spatialData: result.spatialData,
      spatialAnalysis: result.spatialAnalysis,
      memory,
      startedAtMs,
    }
  } finally {
    clearTimeout(timeout)
    options.signal?.removeEventListener('abort', onExternalAbort)
  }
}

function rollingSummary(previous: string, question: string, answer: string): string {
  const entry = `Q: ${question.trim()}\nA: ${answer.trim()}`
  return [previous.trim(), entry].filter(Boolean).join('\n').slice(-2_000)
}

export function completeAgentTurn(
  prepared: PreparedAgentTurn,
  answer: string,
  dependencies: AgentOrchestratorDependencies,
): void {
  dependencies.store.appendMessage(prepared.userId, prepared.conversationId, {
    id: idFactory(dependencies, 'msg'),
    role: 'assistant',
    content: answer,
    createdAt: currentTime(dependencies),
  })
  const activeEntities = prepared.linkedEntities.length > 0
    ? prepared.linkedEntities
    : prepared.memory.activeEntities
  dependencies.store.saveMemory(
    prepared.userId,
    prepared.conversationId,
    rollingSummary(prepared.memory.summary, prepared.question, answer),
    activeEntities,
  )
  dependencies.store.finishAgentRun(
    prepared.userId,
    prepared.runId,
    'completed',
    Date.now() - prepared.startedAtMs,
    currentTime(dependencies),
  )
}

export function failAgentTurn(
  prepared: PreparedAgentTurn,
  dependencies: AgentOrchestratorDependencies,
): void {
  dependencies.store.finishAgentRun(
    prepared.userId,
    prepared.runId,
    'failed',
    Date.now() - prepared.startedAtMs,
    currentTime(dependencies),
  )
}
