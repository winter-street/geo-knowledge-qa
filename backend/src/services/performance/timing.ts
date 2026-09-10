import { performance } from 'node:perf_hooks'
import type { PerformanceDiagnostics, PerformanceStage } from './types.js'

export interface RequestTiming {
  enabled: boolean
  measure<T>(stage: PerformanceStage, operation: () => Promise<T>): Promise<T>
  measureSync<T>(stage: PerformanceStage, operation: () => T): T
  mark(stage: PerformanceStage, durationMs: number): void
  setCounter(name: keyof PerformanceDiagnostics['counters'], value: number): void
  finish(): PerformanceDiagnostics
  snapshot(): PerformanceDiagnostics
}

export function createRequestTiming(
  enabled: boolean,
  now: () => number = () => performance.now(),
  ids: { runId?: string; requestId?: string } = {},
): RequestTiming {
  const stages: Partial<Record<PerformanceStage, number>> = {}
  const counters: PerformanceDiagnostics['counters'] = {}
  const startedAt = now()
  let finished = false

  const mark = (stage: PerformanceStage, durationMs: number): void => {
    if (!enabled || !Number.isFinite(durationMs) || durationMs < 0) return
    stages[stage] = Number(((stages[stage] ?? 0) + durationMs).toFixed(2))
  }

  const snapshot = (): PerformanceDiagnostics => ({
    ...(ids.runId ? { runId: ids.runId } : {}),
    ...(ids.requestId ? { requestId: ids.requestId } : {}),
    stages: { ...stages },
    counters: { ...counters },
  })

  const measure = async <T>(stage: PerformanceStage, operation: () => Promise<T>): Promise<T> => {
    if (!enabled) return operation()
    const operationStarted = now()
    try {
      return await operation()
    } finally {
      mark(stage, now() - operationStarted)
    }
  }

  const measureSync = <T>(stage: PerformanceStage, operation: () => T): T => {
    if (!enabled) return operation()
    const operationStarted = now()
    try {
      return operation()
    } finally {
      mark(stage, now() - operationStarted)
    }
  }

  return {
    enabled,
    measure,
    measureSync,
    mark,
    setCounter(name, value) {
      if (enabled && Number.isFinite(value) && value >= 0) counters[name] = value
    },
    finish() {
      if (enabled && !finished) {
        mark('total', now() - startedAt)
        finished = true
      }
      return snapshot()
    },
    snapshot,
  }
}

export function performanceTraceEnabled(
  perfTestMode: string | undefined,
  runId: string | undefined,
  requestId: string | undefined,
): boolean {
  return perfTestMode === 'true' && Boolean(runId) && Boolean(requestId)
}
