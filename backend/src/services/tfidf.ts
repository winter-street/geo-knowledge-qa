import type { Chunk, Source } from '../types/index.js'
import type { RuntimeSettings } from './runtime-settings.js'
import { getSyntheticDemoRepository, syntheticDemoEnabled } from './synthetic-demo.js'

/**
 * TF-IDF 向量检索器 — 通过 HTTP 调用 Flask 微服务 (:5000/search)
 *
 * 本地 TF-IDF 模型（buildModel/makeTfidfVector 等）已移除，
 * 全部检索逻辑由 Phase 1 Flask 微服务承载。
 */

/** 检索 Top-K 相关 chunk（调 Flask 检索服务） */
export interface RagSearchResponse {
  results: { chunk: Chunk; score: number }[]
  mode: RuntimeSettings['ragMode']
  succeeded: boolean
  reason?: string
}

export async function search(
  query: string,
  topK: number,
  mode: RuntimeSettings['ragMode'],
): Promise<RagSearchResponse> {
  if (syntheticDemoEnabled()) {
    return getSyntheticDemoRepository().searchDocuments(query, topK, mode)
  }
  try {
    const resp = await fetch('http://127.0.0.1:5000/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ question: query, top_k: topK, retrieval_mode: mode }),
      signal: AbortSignal.timeout(15000),
    })
    if (!resp.ok) {
      const error = await resp.json().catch(() => ({})) as { reason?: string; error?: string }
      const reason = error.reason || error.error || `HTTP ${resp.status}`
      console.warn(`[retrieval] Flask ${mode} 检索失败: ${reason}`)
      return { results: [], mode, succeeded: false, reason }
    }
    const data = await resp.json() as { chunks?: any[]; mode?: string }
    // 转换 Flask 返回格式
    const results = (data.chunks || []).map((c: any) => ({
      chunk: {
        id: c.id,
        content: c.text,
        docTitle: c.doc_title,
        page: c.page,
        docType: '',
      },
      score: c.score,
    }))
    return { results, mode, succeeded: true }
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err)
    console.warn(`[retrieval] Flask ${mode} 检索异常:`, reason)
    return { results: [], mode, succeeded: false, reason }
  }
}

/** 从检索结果构建 Source 对象 */
export function toSources(
  results: { chunk: Chunk; score: number }[]
): Source[] {
  return results.map((r) => ({
    docId: r.chunk.id,
    docTitle: r.chunk.docTitle,
    page: r.chunk.page,
    snippet: r.chunk.content.slice(0, 120) + '...',
    synthetic: r.chunk.synthetic,
    isMock: r.chunk.isMock,
  }))
}
