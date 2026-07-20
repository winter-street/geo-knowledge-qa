import { defineStore } from 'pinia'
import { ref, computed, reactive } from 'vue'
import type { Message, Conversation } from '@/types'
import { getHistory, askQuestion, askQuestionStream } from '@/api/qa'
import { createConversationTitle, DEFAULT_CONVERSATION_TITLE } from '@/utils/conversation'
import { useSpatialTaskStore } from './spatial-task'

const STORAGE_KEY = 'geo-qa-store'

function loadFromStorage(): { conversations: Conversation[]; messagesMap: Record<string, Message[]> } | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    return JSON.parse(raw)
  } catch {
    return null
  }
}

function saveToStorage(conversations: Conversation[], messagesObj: Record<string, Message[]>) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ conversations, messagesMap: messagesObj }))
  } catch { /* quota exceeded */ }
}

export const useQaStore = defineStore('qa', () => {
  const spatialTask = useSpatialTaskStore()
  const saved = loadFromStorage()
  const conversations = ref<Conversation[]>(saved?.conversations ?? [])
  const currentId = ref<string | null>(null)
  // 用 reactive 普通对象代替 ref<Map>，确保 .set/.get 操作触发响应式更新
  const messagesObj = reactive<Record<string, Message[]>>(saved?.messagesMap ?? {})
  const loading = ref(false)
  const error = ref<string | null>(null)
  const retrievalMode = ref<'rag' | 'kg' | 'hybrid'>('hybrid')

  const currentConversation = computed(() =>
    conversations.value.find((c) => c.id === currentId.value)
  )

  const currentMessages = computed<Message[]>(() => {
    if (!currentId.value) return []
    return messagesObj[currentId.value] ?? []
  })

  async function loadHistory() {
    try {
      conversations.value = await getHistory()
    } catch { /* 后端不可用 */ }
    if (conversations.value.length > 0 && !currentId.value) {
      selectConversation(conversations.value[0]!.id)
    }
  }

  function selectConversation(id: string) {
    currentId.value = id
    error.value = null
    if (!messagesObj[id]) {
      messagesObj[id] = []
    }
  }

  function addConversation(title: string): string {
    const id = `conv-${Date.now()}`
    const conv: Conversation = { id, title, createdAt: Date.now() }
    conversations.value.unshift(conv)
    messagesObj[id] = []
    currentId.value = id
    error.value = null
    persist()
    return id
  }

  function createConversation(): string {
    return addConversation(DEFAULT_CONVERSATION_TITLE)
  }

  function prepareConversation(content: string): string {
    const selected = conversations.value.find((c) => c.id === currentId.value)
    const cid = selected ? selected.id : addConversation(createConversationTitle(content))
    const convIndex = conversations.value.findIndex((c) => c.id === cid)

    if (
      convIndex !== -1
      && conversations.value[convIndex]!.title === DEFAULT_CONVERSATION_TITLE
      && (messagesObj[cid]?.length ?? 0) === 0
    ) {
      conversations.value[convIndex] = {
        ...conversations.value[convIndex]!,
        title: createConversationTitle(content),
      }
    }

    return cid
  }

  function deleteConversation(id: string) {
    const idx = conversations.value.findIndex((c) => c.id === id)
    if (idx === -1) return
    conversations.value.splice(idx, 1)
    delete messagesObj[id]
    if (currentId.value === id) {
      currentId.value = conversations.value[0]?.id ?? null
    }
    persist()
  }

  function renameConversation(id: string, title: string) {
    const idx = conversations.value.findIndex((c) => c.id === id)
    const existing = conversations.value[idx]
    if (!existing || !title.trim()) return
    // 替换整个对象触发 Vue 响应式更新
    conversations.value[idx] = { ...existing, title: title.trim() }
    persist()
  }

  function pinConversation(id: string) {
    const idx = conversations.value.findIndex((c) => c.id === id)
    const existing = conversations.value[idx]
    if (!existing) return
    const conv: Conversation = { ...existing, pinned: !existing.pinned }
    conversations.value.splice(idx, 1)
    if (conv.pinned) {
      conversations.value.unshift(conv)
    } else {
      // 取消置顶：放回原位
      conversations.value.splice(idx, 0, conv)
    }
    persist()
  }

  function clearError() {
    error.value = null
  }

  async function sendMessage(content: string) {
    const normalizedContent = content.trim()
    if (!normalizedContent) return
    const cid = prepareConversation(normalizedContent)

    const userMsg: Message = {
      id: `msg-${Date.now()}`,
      role: 'user',
      content: normalizedContent,
      timestamp: Date.now(),
    }

    messagesObj[cid] = [...(messagesObj[cid] || []), userMsg]
    loading.value = true
    error.value = null

    try {
      const res = await askQuestion(normalizedContent, retrievalMode.value)
      const aiMsg: Message = {
        id: `msg-${Date.now()}-ai`,
        role: 'assistant',
        content: res.answer,
        sources: res.sources,
        kgContext: res.kgContext ?? [],
        spatialData: res.spatialData,
        spatialAnalysis: res.spatialAnalysis,
        mapPlan: res.mapPlan,
        timestamp: Date.now(),
      }
      if (res.mapPlan) spatialTask.accept(res.mapPlan, res.spatialData, res.spatialAnalysis)
      messagesObj[cid] = [...messagesObj[cid], aiMsg]
    } catch (e: any) {
      error.value = e?.message || '请求失败'
    } finally {
      loading.value = false
      persist()
    }
  }

  let cancelStream: (() => void) | null = null

  /** 流式发送消息 — SSE 逐字更新 */
  function sendMessageStream(content: string) {
    const normalizedContent = content.trim()
    if (!normalizedContent) return
    cancelStream?.()

    const cid = prepareConversation(normalizedContent)

    const userMsg: Message = {
      id: `msg-${Date.now()}`,
      role: 'user',
      content: normalizedContent,
      timestamp: Date.now(),
    }

    const aiId = `msg-${Date.now()}-ai`
    const aiMsg: Message = {
      id: aiId,
      role: 'assistant',
      content: '',
      sources: [],
      timestamp: Date.now(),
    }

    // 一次性设置用户消息和空的 AI 占位消息
    messagesObj[cid] = [...(messagesObj[cid] || []), userMsg, aiMsg]
    loading.value = true
    error.value = null
    persist()

    // 强制触发响应式更新（替换整个 aiMsg 对象而非变异属性）
    function patchAiMsg(partial: Partial<Message>) {
      const msgs = [...(messagesObj[cid] || [])]
      const idx = msgs.findIndex((m) => m.id === aiId)
      const existing = msgs[idx]
      if (existing) {
        msgs[idx] = { ...existing, ...partial }
        messagesObj[cid] = msgs
      }
    }

    cancelStream = askQuestionStream(normalizedContent, retrievalMode.value, {
      onMeta(meta) {
        // 后端若在 meta 阶段就带回空间数据，先挂到消息上，地图可先于文字开始渲染
        if (meta.spatialData || meta.spatialAnalysis || meta.mapPlan) {
          patchAiMsg({
            ...(meta.spatialData ? { spatialData: meta.spatialData } : {}),
            ...(meta.spatialAnalysis ? { spatialAnalysis: meta.spatialAnalysis } : {}),
            ...(meta.mapPlan ? { mapPlan: meta.mapPlan } : {}),
          })
        }
        if (meta.mapPlan) spatialTask.accept(meta.mapPlan, meta.spatialData, meta.spatialAnalysis)
      },
      onChunk(text) {
        aiMsg.content += text
        patchAiMsg({ content: aiMsg.content })
      },
      onDone(sources, kgContext, spatialData, spatialAnalysis, mapPlan) {
        // done 为权威结果；若 done 未带 spatialData 则保留 meta 阶段已挂的，避免被 undefined 覆盖
        patchAiMsg({
          sources,
          kgContext,
          ...(spatialData ? { spatialData } : {}),
          ...(spatialAnalysis ? { spatialAnalysis } : {}),
          ...(mapPlan ? { mapPlan } : {}),
        })
        if (mapPlan) spatialTask.accept(mapPlan, spatialData, spatialAnalysis)

        loading.value = false
        persist()
        cancelStream = null
      },
      onError(err) {
        if (err.name === 'AbortError') return
        patchAiMsg({ content: aiMsg.content || `请求失败: ${err.message}` })
        loading.value = false
        error.value = err.message
        persist()
        cancelStream = null
      },
    })
  }

  function persist() {
    saveToStorage(conversations.value, { ...messagesObj })
  }

  return {
    conversations,
    currentId,
    currentMessages,
    loading,
    error,
    retrievalMode,
    currentConversation,
    loadHistory,
    selectConversation,
    createConversation,
    deleteConversation,
    renameConversation,
    pinConversation,
    sendMessage,
    sendMessageStream,
    clearError,
  }
})
