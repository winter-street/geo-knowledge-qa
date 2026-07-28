import type { JwtPayload } from '../middleware/auth.js'
import { buildMapPlan } from '../services/map-plan.js'
import { generateAnswer } from '../services/llm.js'
import {
  completeAgentTurn,
  failAgentTurn,
  prepareAgentTurn,
  type AgentOrchestratorDependencies,
  type PreparedAgentTurn,
} from '../services/agent/orchestrator.js'
import { getAgentRuntimeDependencies } from '../services/agent/runtime.js'
import { groundAnswer } from '../services/grounding.js'
import { toSources } from '../services/tfidf.js'
import type { QaAskRequest, RetrievalMode } from '../types/index.js'

export interface AgentQaRequest {
  user?: JwtPayload
  body: QaAskRequest
}

export interface AgentQaResponse {
  status(code: number): AgentQaResponse
  json(body: unknown): unknown
  writeHead(code: number, headers?: Record<string, string>): unknown
  write(chunk: string): unknown
  end(): unknown
}

export interface AgentQaDependencies {
  orchestrator: AgentOrchestratorDependencies
  generateAnswer: typeof generateAnswer
  runTimeoutMs?: number
}

function defaults(): AgentQaDependencies {
  return {
    orchestrator: getAgentRuntimeDependencies(),
    generateAnswer,
    runTimeoutMs: 60_000,
  }
}

function sse(response: AgentQaResponse, event: unknown): void {
  response.write(`data: ${JSON.stringify(event)}\n\n`)
}

async function withinDeadline<T>(promise: Promise<T>, remainingMs: number): Promise<T> {
  if (remainingMs <= 0) throw new Error('Agent run timed out')
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    // A provider may finish later, but this race is the only path to response emission and persistence.
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error('Agent run timed out')), remainingMs)
    })
    return await Promise.race([promise, timeout])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

function commonMetadata(prepared: PreparedAgentTurn) {
  return {
    conversationId: prepared.conversationId,
    intent: prepared.intent,
    linkedEntities: prepared.linkedEntities,
    toolTrace: prepared.toolTrace,
    plan: prepared.plan,
  }
}

function localIntentAnswer(prepared: PreparedAgentTurn): string | undefined {
  if (prepared.intent === 'chitchat') {
    return '你好，我可以协助检索地质文献、查询知识图谱，并分析矿产、岩石与构造的空间关系。请告诉我你想调查的地质问题。'
  }
  if (prepared.intent === 'clarification') {
    return '我还不能确定你指的是哪个地质实体。请补充实体名称、类型或所在区域后再试。'
  }
  return undefined
}

export async function handleAgentQa(
  request: AgentQaRequest,
  response: AgentQaResponse,
  dependencies: AgentQaDependencies = defaults(),
): Promise<void> {
  const userId = request.user?.userId
  if (!userId) {
    response.status(401).json({ error: 'Authentication required' })
    return
  }

  const question = request.body.question.trim()
  const retrievalMode = (request.body.retrievalMode ?? 'hybrid') as RetrievalMode
  const startedAt = Date.now()
  const runTimeoutMs = Math.max(1, dependencies.runTimeoutMs ?? 60_000)
  const turnController = new AbortController()
  const turnTimeout = setTimeout(
    () => turnController.abort(new Error('Agent run timed out')),
    runTimeoutMs,
  )
  let prepared: PreparedAgentTurn | undefined
  try {
    if (request.body.stream) {
      response.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'X-Accel-Buffering': 'no',
      })
      sse(response, {
        type: 'meta',
        ragCount: 0,
        kgCount: 0,
        spatialCount: 0,
        kgContext: [],
        spatialData: { markers: [], polylines: [] },
        pending: true,
      })
    }
    prepared = await prepareAgentTurn({
      userId,
      conversationId: request.body.conversationId,
      question,
      retrievalMode,
    }, dependencies.orchestrator, {
      onEvent: request.body.stream
        ? (event) => sse(response, event)
        : undefined,
      signal: turnController.signal,
    })

    const mapPlan = buildMapPlan(prepared.rewrittenQuestion, prepared.spatialAnalysis)
    const metadata = commonMetadata(prepared)

    const remainingMs = runTimeoutMs - (Date.now() - startedAt)
    let generated: Awaited<ReturnType<typeof generateAnswer>>
    const localAnswer = localIntentAnswer(prepared)
    if (localAnswer) {
      generated = { answer: localAnswer, sources: [] }
    } else {
      try {
        generated = await withinDeadline(
          dependencies.generateAnswer(
            prepared.rewrittenQuestion,
            prepared.ragResults,
            prepared.kgContext,
            retrievalMode,
            prepared.spatialAnalysis
              ? { data: prepared.spatialData, analysis: prepared.spatialAnalysis }
              : undefined,
          ),
          remainingMs,
        )
      } catch {
        generated = {
          answer: 'Agent generation timed out. Available retrieval evidence is returned for review.',
          sources: toSources(prepared.ragResults),
        }
      }
    }
    // Chitchat and clarification are intentionally local responses. Every generated
    // factual answer must be grounded before it is persisted or sent to the client.
    const grounded = localAnswer
      ? { answer: generated.answer, citations: [], rejectedClaims: 0 }
      : groundAnswer(generated.answer, prepared.ragResults, prepared.kgContext)
    const sources = generated.sources.length > 0 ? generated.sources : toSources(prepared.ragResults)
    completeAgentTurn(prepared, grounded.answer, dependencies.orchestrator)

    if (request.body.stream) {
      sse(response, { type: 'chunk', content: grounded.answer })
      sse(response, {
        type: 'done',
        sources,
        kgContext: prepared.kgContext,
        spatialData: prepared.spatialData,
        spatialAnalysis: prepared.spatialAnalysis,
        mapPlan,
        citations: grounded.citations,
        ...metadata,
      })
      response.end()
      return
    }

    response.json({
      answer: grounded.answer,
      sources,
      kgContext: prepared.kgContext,
      spatialData: prepared.spatialData,
      spatialAnalysis: prepared.spatialAnalysis,
      mapPlan,
      citations: grounded.citations,
      ...metadata,
    })
  } catch (error) {
    if (prepared) failAgentTurn(prepared, dependencies.orchestrator)
    if (request.body.stream) {
      sse(response, { type: 'error', message: error instanceof Error ? error.message : 'Agent failed' })
      response.end()
    } else {
      response.status(500).json({ error: error instanceof Error ? error.message : 'Agent failed' })
    }
  } finally {
    clearTimeout(turnTimeout)
  }
}
