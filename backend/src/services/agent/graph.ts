import { Annotation, END, START, StateGraph } from '@langchain/langgraph'
import type {
  AgentIntent,
  AgentMemory,
  AgentPlan,
  AgentToolTrace,
  Chunk,
  EntityLinkCandidate,
  KGPath,
  LinkedEntity,
  RetrievalMode,
  SpatialAnalysis,
  SpatialData,
} from '../../types/index.js'
import { classifyAgentIntent } from './intent.js'
import { linkEntities } from './entity-linker.js'
import { rewriteFollowUpQuestion } from './memory.js'
import { createAgentPlan } from './planner.js'
import type { AgentPlanningInput } from './planner.js'
import { executeToolCalls, type AgentToolExecution } from './executor.js'
import type { AgentToolRegistry } from './tools.js'
import { rerankRagResults } from '../rag-reranker.js'
import { selectDiverseEvidence } from '../evidence-selection.js'

type RagResult = { chunk: Chunk; score: number }

const AgentState = Annotation.Root({
  question: Annotation<string>(),
  retrievalMode: Annotation<RetrievalMode>(),
  memory: Annotation<AgentMemory>(),
  candidates: Annotation<EntityLinkCandidate[]>({ reducer: (_left, right) => right, default: () => [] }),
  intent: Annotation<AgentIntent>({ reducer: (_left, right) => right, default: () => 'geology_qa' }),
  rewrittenQuestion: Annotation<string>({ reducer: (_left, right) => right, default: () => '' }),
  linkedEntities: Annotation<LinkedEntity[]>({ reducer: (_left, right) => right, default: () => [] }),
  plan: Annotation<AgentPlan>({ reducer: (_left, right) => right, default: () => ({ steps: [] }) }),
  executions: Annotation<AgentToolExecution[]>({ reducer: (_left, right) => right, default: () => [] }),
  toolTrace: Annotation<AgentToolTrace[]>({ reducer: (_left, right) => right, default: () => [] }),
  ragResults: Annotation<RagResult[]>({ reducer: (_left, right) => right, default: () => [] }),
  kgContext: Annotation<KGPath[]>({ reducer: (_left, right) => right, default: () => [] }),
  spatialData: Annotation<SpatialData>({
    reducer: (_left, right) => right,
    default: () => ({ markers: [], polylines: [] }),
  }),
  spatialAnalysis: Annotation<SpatialAnalysis | undefined>({
    reducer: (_left, right) => right,
    default: () => undefined,
  }),
})

export interface AgentGraphInput {
  question: string
  retrievalMode: RetrievalMode
  memory: AgentMemory
  candidates?: EntityLinkCandidate[]
}

export interface AgentGraphResult {
  intent: AgentIntent
  rewrittenQuestion: string
  linkedEntities: LinkedEntity[]
  plan: AgentPlan
  toolTrace: AgentToolTrace[]
  ragResults: RagResult[]
  kgContext: KGPath[]
  spatialData: SpatialData
  spatialAnalysis?: SpatialAnalysis
}

export interface AgentGraphOptions {
  registry: AgentToolRegistry
  toolTimeoutMs?: number
  runTimeoutMs?: number
  planWithModel?: (input: AgentPlanningInput) => Promise<AgentPlan>
  onEvent?: (event: AgentGraphEvent) => void
  signal?: AbortSignal
}

export type AgentGraphEvent =
  | { type: 'plan'; plan: AgentPlan }
  | { type: 'tool_start'; tool: AgentToolTrace }
  | { type: 'tool_end'; tool: AgentToolTrace }

function notify(options: AgentGraphOptions, acceptingEvents: boolean, event: AgentGraphEvent): void {
  if (!acceptingEvents || options.signal?.aborted) return
  try {
    options.onEvent?.(event)
  } catch {
    // Streaming observers must not alter the Agent state graph.
  }
}

function objectValue(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' ? value as Record<string, unknown> : undefined
}

function evidenceValue(value: unknown): string | undefined {
  if (value === null || value === undefined || value === '') return undefined
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return String(value).slice(0, 300)
  }
  if (Array.isArray(value)) {
    const items = value
      .map((item) => evidenceValue(item))
      .filter((item): item is string => Boolean(item))
    return items.length > 0 ? items.join(', ').slice(0, 300) : undefined
  }
  try {
    const serialized = JSON.stringify(value)
    return serialized && serialized !== '{}' ? serialized.slice(0, 300) : undefined
  } catch {
    return undefined
  }
}

function entityDetailEvidence(detail: Record<string, unknown>): KGPath[] {
  const name = evidenceValue(detail.name) ?? 'Unknown entity'
  const type = evidenceValue(detail.type)
  const paths: KGPath[] = type
    ? [{ from: name, relation: 'ENTITY_TYPE', relationType: 'INSTANCE_OF', to: type, source: 'Neo4j entity detail' }]
    : []

  for (const [key, rawValue] of Object.entries(detail)) {
    if (paths.length >= 12 || key === 'entityId' || key === 'name' || key === 'type') continue
    const value = evidenceValue(rawValue)
    if (!value) continue
    paths.push({
      from: name,
      relation: `PROPERTY_${key}`,
      relationType: 'HAS_PROPERTY',
      to: value,
      source: 'Neo4j entity detail',
    })
  }
  return paths
}

function collectEvidence(executions: AgentToolExecution[], question: string): Pick<
  AgentGraphResult,
  'ragResults' | 'kgContext' | 'spatialData' | 'spatialAnalysis'
> {
  let ragResults: RagResult[] = []
  let kgContext: KGPath[] = []
  let spatialData: SpatialData = { markers: [], polylines: [] }
  let spatialAnalysis: SpatialAnalysis | undefined

  for (const execution of executions) {
    if (execution.trace.status !== 'completed') continue
    const output = objectValue(execution.output)
    if (!output) continue
    if (execution.toolName === 'search_documents' && Array.isArray(output.results)) {
      ragResults = output.results as RagResult[]
    } else if (execution.toolName === 'query_knowledge_graph' && Array.isArray(output.results)) {
      kgContext = output.results as KGPath[]
    } else if (execution.toolName === 'get_entity_detail') {
      kgContext = [...kgContext, ...entityDetailEvidence(output)]
    } else if (execution.toolName === 'spatial_query') {
      const data = objectValue(output.data)
      if (data && Array.isArray(data.markers) && Array.isArray(data.polylines)) {
        spatialData = data as unknown as SpatialData
      }
      const analysis = objectValue(output.analysis)
      if (analysis) spatialAnalysis = analysis as unknown as SpatialAnalysis
    }
  }

  const reranked = rerankRagResults(question, ragResults, kgContext, ragResults.length)
  ragResults = selectDiverseEvidence(reranked, 5, 2)
  return { ragResults, kgContext, spatialData, spatialAnalysis }
}

export function createAgentGraph(options: AgentGraphOptions): {
  invoke(input: AgentGraphInput): Promise<AgentGraphResult>
} {
  let acceptingEvents = false
  const compiled = new StateGraph(AgentState)
    .addNode('understand', (state) => {
      const rewrittenQuestion = rewriteFollowUpQuestion(state.question, state.memory)
      const entityResult = linkEntities(
        state.question,
        state.candidates,
        state.memory.activeEntities,
      )
      const intent = entityResult.requiresClarification
        ? 'clarification'
        : classifyAgentIntent(state.question, {
          hasActiveEntities: state.memory.activeEntities.length > 0,
        })
      return { intent, rewrittenQuestion, linkedEntities: entityResult.entities }
    })
    .addNode('make_plan', async (state) => {
      const planningInput = {
        intent: state.intent,
        question: state.rewrittenQuestion,
        retrievalMode: state.retrievalMode,
        linkedEntities: state.linkedEntities,
      }
      const plan = options.planWithModel
        ? await options.planWithModel(planningInput)
        : createAgentPlan(planningInput)
      notify(options, acceptingEvents, { type: 'plan', plan })
      return { plan }
    })
    .addNode('execute_tools', async (state) => {
      const executed = await executeToolCalls(state.plan.steps, options.registry, {
        maxTools: 3,
        toolTimeoutMs: options.toolTimeoutMs ?? 10_000,
        onToolStart: (tool) => notify(options, acceptingEvents, { type: 'tool_start', tool }),
        onToolEnd: (tool) => notify(options, acceptingEvents, { type: 'tool_end', tool }),
      })
      return { executions: executed.results, toolTrace: executed.trace }
    })
    .addNode('evidence', (state) => collectEvidence(state.executions, state.rewrittenQuestion))
    .addEdge(START, 'understand')
    .addEdge('understand', 'make_plan')
    .addEdge('make_plan', 'execute_tools')
    .addEdge('execute_tools', 'evidence')
    .addEdge('evidence', END)
    .compile()

  return {
    async invoke(input): Promise<AgentGraphResult> {
      const timeoutMs = Math.max(1, options.runTimeoutMs ?? 60_000)
      let timer: ReturnType<typeof setTimeout> | undefined
      let onAbort: (() => void) | undefined
      acceptingEvents = true
      try {
        const timeout = new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error('Agent run timed out')), timeoutMs)
          timer.unref?.()
        })
        const pending = [compiled.invoke({ ...input, candidates: input.candidates ?? [] }), timeout]
        if (options.signal) {
          pending.push(new Promise<never>((_, reject) => {
            onAbort = () => reject(
              options.signal?.reason instanceof Error
                ? options.signal.reason
                : new Error('Agent run timed out'),
            )
            if (options.signal?.aborted) onAbort()
            else options.signal?.addEventListener('abort', onAbort, { once: true })
          }))
        }
        const result = await Promise.race(pending)
        return result as AgentGraphResult
      } finally {
        acceptingEvents = false
        if (timer) clearTimeout(timer)
        if (onAbort) options.signal?.removeEventListener('abort', onAbort)
      }
    },
  }
}
