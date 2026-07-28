import { describe, expect, it, vi } from 'vitest'
import { dispatchQaSseEvent } from './qa'

describe('agent SSE compatibility', () => {
  it('dispatches plan and safe tool events', () => {
    const callbacks = {
      onMeta: vi.fn(),
      onPlan: vi.fn(),
      onToolStart: vi.fn(),
      onToolEnd: vi.fn(),
      onChunk: vi.fn(),
      onDone: vi.fn(),
      onError: vi.fn(),
    }
    dispatchQaSseEvent({ type: 'plan', plan: { steps: [{ id: 's1', label: 'Search', tool: 'search_documents' }] } }, callbacks)
    dispatchQaSseEvent({ type: 'tool_start', tool: { id: 't1', toolName: 'search_documents', status: 'running' } }, callbacks)
    dispatchQaSseEvent({ type: 'tool_end', tool: { id: 't1', toolName: 'search_documents', status: 'completed', latencyMs: 12, evidenceCount: 2 } }, callbacks)
    expect(callbacks.onPlan).toHaveBeenCalledOnce()
    expect(callbacks.onToolStart).toHaveBeenCalledOnce()
    expect(callbacks.onToolEnd).toHaveBeenCalledOnce()
  })

  it('keeps old servers compatible when agent fields are omitted', () => {
    const callbacks = {
      onMeta: vi.fn(),
      onChunk: vi.fn(),
      onDone: vi.fn(),
      onError: vi.fn(),
    }
    dispatchQaSseEvent({ type: 'done', sources: [], kgContext: [] }, callbacks)
    expect(callbacks.onDone).toHaveBeenCalledWith([], [], undefined, undefined, undefined, undefined)
  })
})
