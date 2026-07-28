import type {
  AgentPlanStep,
  AgentToolName,
  AgentToolTrace,
} from '../../types/index.js'
import { sanitizeToolArguments } from '../../db/app-state.js'
import type { AgentToolHandlerResult, AgentToolRegistry } from './tools.js'

export interface AgentToolExecution {
  stepId: string
  toolName: AgentToolName
  output?: unknown
  trace: AgentToolTrace
}

export interface AgentToolExecutionResult {
  results: AgentToolExecution[]
  trace: AgentToolTrace[]
}

export interface ToolExecutionOptions {
  maxTools?: number
  toolTimeoutMs?: number
  onToolStart?: (trace: AgentToolTrace) => void
  onToolEnd?: (trace: AgentToolTrace) => void
}

function notify(callback: ((trace: AgentToolTrace) => void) | undefined, trace: AgentToolTrace): void {
  try {
    callback?.(trace)
  } catch {
    // Observability callbacks must not change tool execution behavior.
  }
}

async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error('tool timeout')), ms)
    })
    return await Promise.race([promise, timeout])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

async function executeOne(
  step: AgentPlanStep,
  registry: AgentToolRegistry,
  timeoutMs: number,
  options: ToolExecutionOptions,
): Promise<AgentToolExecution> {
  const startedAt = Date.now()
  const argumentSummary = sanitizeToolArguments(step.args)
  notify(options.onToolStart, {
    id: step.id,
    toolName: step.tool,
    argumentSummary,
    status: 'running',
    latencyMs: 0,
    evidenceCount: 0,
  })
  const tool = registry[step.tool]
  const parsed = tool.schema.safeParse(step.args)
  if (!parsed.success) {
    const trace: AgentToolTrace = {
      id: step.id,
      toolName: step.tool,
      argumentSummary,
      status: 'failed',
      latencyMs: Date.now() - startedAt,
      evidenceCount: 0,
      error: 'Invalid tool arguments',
    }
    notify(options.onToolEnd, trace)
    return { stepId: step.id, toolName: step.tool, trace }
  }

  try {
    const result = await withTimeout<AgentToolHandlerResult>(tool.execute(parsed.data), timeoutMs)
    const trace: AgentToolTrace = {
      id: step.id,
      toolName: step.tool,
      argumentSummary,
      status: 'completed',
      latencyMs: Date.now() - startedAt,
      evidenceCount: Math.max(0, Math.floor(result.evidenceCount)),
    }
    notify(options.onToolEnd, trace)
    return { stepId: step.id, toolName: step.tool, output: result.output, trace }
  } catch (error) {
    const timedOut = error instanceof Error && error.message === 'tool timeout'
    const trace: AgentToolTrace = {
      id: step.id,
      toolName: step.tool,
      argumentSummary,
      status: timedOut ? 'timeout' : 'failed',
      latencyMs: Date.now() - startedAt,
      evidenceCount: 0,
      error: timedOut ? 'Tool timed out' : 'Tool execution failed',
    }
    notify(options.onToolEnd, trace)
    return { stepId: step.id, toolName: step.tool, trace }
  }
}

export async function executeToolCalls(
  steps: AgentPlanStep[],
  registry: AgentToolRegistry,
  options: ToolExecutionOptions = {},
): Promise<AgentToolExecutionResult> {
  const maxTools = Math.min(3, Math.max(0, options.maxTools ?? 3))
  const timeoutMs = Math.max(1, options.toolTimeoutMs ?? 10_000)
  const results = await Promise.all(
    steps.slice(0, maxTools).map((item) => executeOne(item, registry, timeoutMs, options)),
  )
  return { results, trace: results.map((item) => item.trace) }
}
