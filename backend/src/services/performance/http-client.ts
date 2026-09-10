import { performance } from 'node:perf_hooks'
import type { AgentToolName } from '../../types/index.js'
import type { PerformanceMode, RequestObservation } from './types.js'

export interface PerformanceClientOptions {
  baseURL: string
  token: string
  runId: string
  requestId: string
  caseId: string
  question: string
  mode: PerformanceMode
  retrievalMode?: 'rag' | 'kg' | 'hybrid'
  conversationId?: string
  timeoutMs?: number
}

export interface LoginResult {
  token: string
  username: string
  role: 'user' | 'admin'
}

interface QaPayload {
  citations?: Array<{ id?: string }>
  sources?: Array<{ docId?: string | number }>
  intent?: string
  linkedEntities?: Array<{ id?: string }>
  toolTrace?: Array<{ toolName?: string }>
  performance?: {
    stages?: Record<string, number>
    counters?: Record<string, number>
  }
}

function endpoint(baseURL: string, path: string): string {
  return `${baseURL.replace(/\/$/u, '')}${path}`
}

function classifyHttp(status: number): RequestObservation['status'] {
  return status === 429 ? 'supplier_rate_limit' : 'http_error'
}

function baseObservation(input: PerformanceClientOptions, totalMs: number): RequestObservation {
  return {
    runId: input.runId,
    requestId: input.requestId,
    caseId: input.caseId,
    mode: input.mode,
    status: 'protocol_error',
    totalMs,
    retrievedDocumentIds: [],
    citationIds: [],
    selectedTools: [],
  }
}

function applyPayload(observation: RequestObservation, payload: QaPayload): RequestObservation {
  const sources = payload.sources ?? []
  const citations = payload.citations ?? []
  const toolTrace = payload.toolTrace ?? []
  const performanceData = payload.performance
  const counters = performanceData?.counters ?? {}
  return {
    ...observation,
    retrievedDocumentIds: sources.flatMap((source) => source.docId === undefined ? [] : [String(source.docId)]),
    citationIds: citations.flatMap((citation) => citation.id ? [citation.id] : []),
    predictedIntent: payload.intent as RequestObservation['predictedIntent'],
    linkedEntityId: payload.linkedEntities?.[0]?.id,
    selectedTools: toolTrace.flatMap((trace) => trace.toolName as AgentToolName | undefined ?? []),
    stageTimings: performanceData?.stages,
    llmCalls: counters.llmCalls,
    inputTokens: counters.inputTokens,
    outputTokens: counters.outputTokens,
  }
}

export async function login(
  baseURL: string,
  credentials: { username: string; password: string },
  timeoutMs = 10_000,
): Promise<LoginResult> {
  const response = await fetch(endpoint(baseURL, '/api/auth/login'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(credentials),
    signal: AbortSignal.timeout(timeoutMs),
  })
  if (!response.ok) throw new Error(`Login failed with HTTP ${response.status}`)
  const payload = await response.json() as LoginResult
  if (!payload.token) throw new Error('Login response did not contain a token')
  return payload
}

export async function askJson(input: PerformanceClientOptions): Promise<RequestObservation> {
  const startedAt = performance.now()
  const observation = baseObservation(input, 0)
  try {
    const response = await fetch(endpoint(input.baseURL, '/api/qa/ask'), {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${input.token}`,
        'Content-Type': 'application/json',
        'X-Perf-Run-Id': input.runId,
        'X-Perf-Request-Id': input.requestId,
      },
      body: JSON.stringify({
        question: input.question,
        conversationId: input.conversationId,
        retrievalMode: input.retrievalMode ?? 'hybrid',
        agentMode: input.mode === 'agent' ? 'agent' : 'direct',
        stream: false,
      }),
      signal: AbortSignal.timeout(input.timeoutMs ?? 90_000),
    })
    const totalMs = performance.now() - startedAt
    if (!response.ok) return { ...observation, status: classifyHttp(response.status), httpStatus: response.status, totalMs }
    return applyPayload({ ...observation, status: 'success', httpStatus: response.status, totalMs }, await response.json() as QaPayload)
  } catch (error) {
    const totalMs = performance.now() - startedAt
    const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase()
    return {
      ...observation,
      status: message.includes('timeout') || message.includes('aborted') ? 'timeout' : 'http_error',
      totalMs,
      errorCategory: message.slice(0, 120),
    }
  }
}

export async function askSse(input: PerformanceClientOptions): Promise<RequestObservation> {
  const startedAt = performance.now()
  const observation = baseObservation(input, 0)
  try {
    const response = await fetch(endpoint(input.baseURL, '/api/qa/ask'), {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${input.token}`,
        'Content-Type': 'application/json',
        Accept: 'text/event-stream',
        'X-Perf-Run-Id': input.runId,
        'X-Perf-Request-Id': input.requestId,
      },
      body: JSON.stringify({
        question: input.question,
        conversationId: input.conversationId,
        retrievalMode: input.retrievalMode ?? 'hybrid',
        agentMode: input.mode === 'agent' ? 'agent' : 'direct',
        stream: true,
      }),
      signal: AbortSignal.timeout(input.timeoutMs ?? 90_000),
    })
    const ttfbMs = performance.now() - startedAt
    if (!response.ok) return { ...observation, status: classifyHttp(response.status), httpStatus: response.status, totalMs: ttfbMs, ttfbMs }
    if (!response.body) return { ...observation, status: 'protocol_error', totalMs: ttfbMs, ttfbMs, errorCategory: 'missing response body' }

    let buffer = ''
    let firstEventMs: number | undefined
    let firstContentMs: number | undefined
    let performanceData: QaPayload['performance']
    let finalPayload: QaPayload | undefined
    let terminalError: string | undefined
    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    const consume = (text: string): void => {
      buffer += text
      while (true) {
        const boundary = buffer.indexOf('\n\n')
        if (boundary < 0) return
        const frame = buffer.slice(0, boundary)
        buffer = buffer.slice(boundary + 2)
        const dataLine = frame.split('\n').find((line) => line.startsWith('data: '))
        if (!dataLine) continue
        const raw = dataLine.slice(6).trim()
        if (raw === '[DONE]') continue
        let event: Record<string, unknown>
        try { event = JSON.parse(raw) as Record<string, unknown> } catch { terminalError = 'invalid SSE JSON'; continue }
        firstEventMs ??= performance.now() - startedAt
        if (event.type === 'chunk' && typeof event.content === 'string' && event.content.length > 0) {
          firstContentMs ??= performance.now() - startedAt
        }
        if (event.type === 'performance') performanceData = event.performance as QaPayload['performance']
        if (event.type === 'done') finalPayload = event as QaPayload
        if (event.type === 'error') terminalError = String(event.message ?? 'SSE error')
      }
    }
    while (true) {
      const item = await reader.read()
      if (item.done) break
      consume(decoder.decode(item.value, { stream: true }))
    }
    consume(decoder.decode())
    const totalMs = performance.now() - startedAt
    if (terminalError) return { ...observation, status: 'protocol_error', totalMs, ttfbMs, firstEventMs, firstContentMs, errorCategory: terminalError }
    if (!finalPayload) return { ...observation, status: 'protocol_error', totalMs, ttfbMs, firstEventMs, firstContentMs, errorCategory: 'missing done event' }
    return applyPayload({ ...observation, status: 'success', httpStatus: response.status, totalMs, ttfbMs, firstEventMs, firstContentMs, stageTimings: performanceData?.stages }, { ...finalPayload, performance: performanceData ?? finalPayload.performance })
  } catch (error) {
    const totalMs = performance.now() - startedAt
    const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase()
    return {
      ...observation,
      status: message.includes('timeout') || message.includes('aborted') ? 'timeout' : 'http_error',
      totalMs,
      errorCategory: message.slice(0, 120),
    }
  }
}
