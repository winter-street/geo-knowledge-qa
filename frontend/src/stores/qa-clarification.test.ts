import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import type { AgentClarificationPrompt } from '@/types'

const getHistory = vi.fn(async () => [] as any[])
const askQuestionStream = vi.fn(() => vi.fn())
const getPendingClarification = vi.fn()

vi.mock('@/api/qa', () => ({
  getHistory,
  askQuestion: vi.fn(),
  askQuestionStream,
  getPendingClarification,
}))

const pending: AgentClarificationPrompt = {
  clarificationId: 'clarify-1',
  question: '请选择你指的地质实体。',
  originalQuestion: '中央构造的详情',
  candidates: [{
    entityId: 'structure-1', name: '演示断裂 A', type: 'Structure',
    confidence: 0.95, reason: 'Alias match',
  }],
}

describe('QA clarification state', () => {
  beforeEach(() => {
    const values = new Map<string, string>()
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
      removeItem: (key: string) => values.delete(key),
      clear: () => values.clear(),
    })
    setActivePinia(createPinia())
    askQuestionStream.mockClear()
    getPendingClarification.mockReset().mockResolvedValue(pending)
  })

  it('restores a pending clarification and submits the selected entity', async () => {
    const { useQaStore } = await import('./qa')
    const store = useQaStore()
    const conversationId = store.createConversation()
    await store.restorePendingClarification(conversationId)

    expect(store.currentMessages.at(-1)?.clarification?.clarificationId).toBe('clarify-1')
    store.resolveClarification(pending.candidates[0]!)

    expect(askQuestionStream).toHaveBeenCalledOnce()
    expect(askQuestionStream.mock.calls[0]?.[5]).toEqual({
      clarificationId: 'clarify-1', selectedEntityId: 'structure-1',
    })
  })

  it('drops browser-only conversations when the server has no history', async () => {
    const { useQaStore } = await import('./qa')
    const store = useQaStore()
    store.createConversation()

    await store.loadHistory()

    expect(getHistory).toHaveBeenCalledOnce()
    expect(store.conversations).toEqual([])
    expect(store.currentId).toBeNull()
  })
})
