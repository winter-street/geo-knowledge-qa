import type {
  AgentMode,
  AgentPlan,
  AgentResponseMetadata,
  AgentToolTrace,
  Conversation,
  KGPath,
  MapAction,
  MapPlan,
  QaAskResponse,
  RetrievalMode,
  Source,
  SpatialAnalysis,
  SpatialData,
} from '@/types'
import request from './request'

/** 提交问题，获取 AI 回答（普通 JSON 模式） */
export async function askQuestion(
  question: string,
  retrievalMode: RetrievalMode = 'hybrid',
  conversationId?: string,
  agentMode: AgentMode = 'agent',
): Promise<QaAskResponse> {
  const response = await request.post<unknown, QaAskResponse>('/qa/ask', {
    question,
    retrievalMode,
    conversationId,
    agentMode,
  })
  return { ...response, mapPlan: normalizeMapPlan(response.mapPlan) }
}

/**
 * 归一化后端返回的空间数据。
 * 后端契约尚在演进中，此处容错多种形态，保证前端拿到的永远是干净的 SpatialData 或 undefined：
 *   - undefined / null          → undefined
 *   - []（greeting 分支占位）   → undefined（无空间数据）
 *   - { markers, polylines }    → 过滤非法项后返回
 */
export function normalizeSpatial(raw: any): SpatialData | undefined {
  if (!raw) return undefined
  // 后端 greeting 分支可能返回空数组占位
  if (Array.isArray(raw)) return undefined
  if (typeof raw !== 'object') return undefined

  const markers = Array.isArray(raw.markers)
    ? raw.markers.filter(
        (m: any) => m && typeof m.lng === 'number' && typeof m.lat === 'number',
      )
    : []
  const polylines = Array.isArray(raw.polylines)
    ? raw.polylines.filter((p: any) => p && Array.isArray(p.path) && p.path.length >= 2)
    : []

  if (markers.length === 0 && polylines.length === 0) return undefined
  return { markers, polylines }
}

function normalizeSpatialAnalysis(raw: any): SpatialAnalysis | undefined {
  if (!raw || typeof raw !== 'object' || !raw.interpretation || !raw.summary) return undefined
  if (typeof raw.summary.matchedCount !== 'number' || !Array.isArray(raw.warnings)) return undefined
  return raw as SpatialAnalysis
}

const ENTITY_TYPES = new Set(['Mineral', 'Rock', 'Structure', 'TimePeriod', 'DepositType', 'Region'])

function normalizeMapAction(raw: any): MapAction | undefined {
  if (!raw || typeof raw !== 'object' || typeof raw.type !== 'string') return undefined
  switch (raw.type) {
    case 'query':
      return typeof raw.question === 'string' && raw.question.trim()
        ? { type: 'query', question: raw.question.trim() }
        : undefined
    case 'filter-region':
      return Array.isArray(raw.regions) && raw.regions.every((item: unknown) => typeof item === 'string')
        ? { type: 'filter-region', regions: raw.regions }
        : undefined
    case 'filter-era':
      return Array.isArray(raw.eras) && raw.eras.every((item: unknown) => typeof item === 'string')
        ? { type: 'filter-era', eras: raw.eras }
        : undefined
    case 'filter-entity':
      return Array.isArray(raw.entityTypes) && raw.entityTypes.every((item: unknown) => ENTITY_TYPES.has(String(item)))
        ? { type: 'filter-entity', entityTypes: raw.entityTypes }
        : undefined
    case 'set-result-mode':
      return raw.mode === 'query' || raw.mode === 'score'
        ? { type: 'set-result-mode', mode: raw.mode }
        : undefined
    case 'buffer': {
      const radiusKm = Number(raw.radiusKm)
      if (!Number.isFinite(radiusKm) || radiusKm < 0.1 || radiusKm > 1000) return undefined
      if (raw.targetType !== undefined && !ENTITY_TYPES.has(String(raw.targetType))) return undefined
      return {
        type: 'buffer', radiusKm,
        ...(typeof raw.anchorName === 'string' ? { anchorName: raw.anchorName } : {}),
        ...(raw.targetType ? { targetType: raw.targetType } : {}),
      }
    }
    case 'heatmap':
      return typeof raw.enabled === 'boolean' ? { type: 'heatmap', enabled: raw.enabled } : undefined
    case 'timeline':
      return ['all', 'single', 'play'].includes(raw.mode)
        ? { type: 'timeline', mode: raw.mode, ...(typeof raw.era === 'string' ? { era: raw.era } : {}) }
        : undefined
    case 'compare-regions':
      return Array.isArray(raw.regions) && raw.regions.length >= 2 && raw.regions.every((item: unknown) => typeof item === 'string')
        ? { type: 'compare-regions', regions: raw.regions }
        : undefined
    case 'grid-prediction':
      return [5, 10, 20].includes(raw.gridSizeKm) && (raw.minimumScore === undefined || Number.isFinite(raw.minimumScore))
        ? { type: 'grid-prediction', gridSizeKm: raw.gridSizeKm, ...(raw.minimumScore === undefined ? {} : { minimumScore: raw.minimumScore }) }
        : undefined
    case 'fit-bounds':
      return { type: 'fit-bounds' }
    case 'suggest-export':
      return raw.format === 'geojson' || raw.format === 'csv'
        ? { type: 'suggest-export', format: raw.format }
        : undefined
    default:
      return undefined
  }
}

export function normalizeMapPlan(raw: any): MapPlan | undefined {
  if (!raw || typeof raw !== 'object' || raw.version !== 1 || typeof raw.id !== 'string') return undefined
  if (!Array.isArray(raw.actions) || !Array.isArray(raw.warnings)) return undefined
  const actions = raw.actions.map(normalizeMapAction)
  if (actions.some((item: MapAction | undefined) => !item)) return undefined
  if (!raw.warnings.every((item: unknown) => typeof item === 'string')) return undefined
  return {
    id: raw.id,
    version: 1,
    title: typeof raw.title === 'string' ? raw.title : '空间分析',
    autoExecute: raw.autoExecute === true,
    openFullMap: raw.openFullMap === true,
    actions: actions as MapAction[],
    warnings: raw.warnings,
  }
}

/** SSE 流式问答的回调集合 */
export interface QaStreamCallbacks {
  onMeta: (meta: { ragCount: number; kgCount: number; kgContext: KGPath[]; spatialData?: SpatialData; spatialAnalysis?: SpatialAnalysis; mapPlan?: MapPlan }) => void
  onPlan?: (plan: AgentPlan) => void
  onToolStart?: (tool: AgentToolTrace) => void
  onToolEnd?: (tool: AgentToolTrace) => void
  onChunk: (text: string) => void
  onDone: (sources: Source[], kgContext: KGPath[], spatialData?: SpatialData, spatialAnalysis?: SpatialAnalysis, mapPlan?: MapPlan, agent?: AgentResponseMetadata) => void
  onError: (err: Error) => void
}

function agentMetadata(event: any): AgentResponseMetadata | undefined {
  const metadata: AgentResponseMetadata = {
    ...(typeof event.conversationId === 'string' ? { conversationId: event.conversationId } : {}),
    ...(typeof event.intent === 'string' ? { intent: event.intent } : {}),
    ...(Array.isArray(event.linkedEntities) ? { linkedEntities: event.linkedEntities } : {}),
    ...(Array.isArray(event.citations) ? { citations: event.citations } : {}),
    ...(Array.isArray(event.toolTrace) ? { toolTrace: event.toolTrace } : {}),
    ...(event.plan && Array.isArray(event.plan.steps) ? { plan: event.plan } : {}),
  }
  return Object.keys(metadata).length > 0 ? metadata : undefined
}

export function dispatchQaSseEvent(event: any, callbacks: QaStreamCallbacks): void {
  switch (event?.type) {
    case 'meta':
      callbacks.onMeta({
        ragCount: event.ragCount,
        kgCount: event.kgCount,
        kgContext: event.kgContext ?? [],
        spatialData: normalizeSpatial(event.spatialData),
        spatialAnalysis: normalizeSpatialAnalysis(event.spatialAnalysis),
        mapPlan: normalizeMapPlan(event.mapPlan),
      })
      break
    case 'plan':
      if (event.plan && Array.isArray(event.plan.steps)) callbacks.onPlan?.(event.plan)
      break
    case 'tool_start':
      if (event.tool && typeof event.tool.toolName === 'string') callbacks.onToolStart?.(event.tool)
      break
    case 'tool_end':
      if (event.tool && typeof event.tool.toolName === 'string') callbacks.onToolEnd?.(event.tool)
      break
    case 'chunk':
      callbacks.onChunk(event.content)
      break
    case 'done':
      callbacks.onDone(
        event.sources || [],
        event.kgContext || [],
        normalizeSpatial(event.spatialData),
        normalizeSpatialAnalysis(event.spatialAnalysis),
        normalizeMapPlan(event.mapPlan),
        agentMetadata(event),
      )
      break
    case 'error':
      callbacks.onError(new Error(event.message || 'Stream error'))
      break
  }
}

/**
 * SSE 流式问答
 *
 * 事件链路：meta（检索元信息 + 可选 spatialData）→ chunk（逐字回答）→ done（来源 + 图谱 + 空间数据）
 *
 * @returns abort 函数，可用于取消请求
 */
export function askQuestionStream(
  question: string,
  retrievalMode: RetrievalMode = 'hybrid',
  callbacks: QaStreamCallbacks,
  conversationId?: string,
  agentMode: AgentMode = 'agent',
): () => void {
  const controller = new AbortController()

  const run = async () => {
    try {
      const token = localStorage.getItem('token')
      // 绕过 Vite 代理直连后端（代理会缓冲 SSE 响应导致失去流式效果）
      const backendOrigin = import.meta.env.VITE_BACKEND_ORIGIN || 'http://localhost:3000'
      const backendUrl = import.meta.env.DEV ? `${backendOrigin}/api/qa/ask` : '/api/qa/ask'
      const resp = await fetch(backendUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ question, stream: true, retrievalMode, conversationId, agentMode }),
        signal: controller.signal,
      })

      if (!resp.ok) {
        const errData = await resp.json().catch(() => ({}))
        throw new Error((errData as any).error || `HTTP ${resp.status}`)
      }

      // 某些环境（旧浏览器 / 代理剥离流）下 body 可能为空，提前给出可读报错而非崩溃
      if (!resp.body) {
        throw new Error('当前环境不支持流式响应（response body 为空）')
      }

      const reader = resp.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() || ''

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue
          try {
            const event = JSON.parse(line.slice(6))
            if (event.type === 'plan' || event.type === 'tool_start' || event.type === 'tool_end') {
              dispatchQaSseEvent(event, callbacks)
              continue
            }
            switch (event.type) {
              case 'meta':
                callbacks.onMeta({
                  ragCount: event.ragCount,
                  kgCount: event.kgCount,
                  kgContext: event.kgContext ?? [],
                  // 后端可能在 meta 阶段就把空间数据带上，便于地图先于文字渲染
                  spatialData: normalizeSpatial(event.spatialData),
                  spatialAnalysis: normalizeSpatialAnalysis(event.spatialAnalysis),
                  mapPlan: normalizeMapPlan(event.mapPlan),
                })
                break
              case 'chunk':
                callbacks.onChunk(event.content)
                break
              case 'done':
                callbacks.onDone(
                  event.sources || [],
                  event.kgContext || [],
                  normalizeSpatial(event.spatialData),
                  normalizeSpatialAnalysis(event.spatialAnalysis),
                  normalizeMapPlan(event.mapPlan),
                  agentMetadata(event),
                )
                break
              case 'error':
                callbacks.onError(new Error(event.message || '流式错误'))
                break
            }
          } catch { /* 非 JSON 行跳过 */ }
        }
      }
    } catch (err: any) {
      if (err.name !== 'AbortError') {
        callbacks.onError(err)
      }
    }
  }

  run()

  return () => controller.abort()
}

/** 获取对话历史列表 */
export async function getHistory(): Promise<Conversation[]> {
  try {
    return request.get('/qa/history')
  } catch {
    return []
  }
}

/** 获取指定对话的消息 */
export async function getMessages(_conversationId: string): Promise<any[]> {
  try {
    return request.get(`/qa/messages/${_conversationId}`)
  } catch {
    return []
  }
}
