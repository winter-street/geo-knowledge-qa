import type { LLMProvider, LLMToolCall, LLMToolDefinition } from './provider.js'
import type { Chunk, Source, KGPath, RetrievalMode, SpatialAnalysis, SpatialData } from '../../types/index.js'
import { buildPrompt, SYSTEM_PROMPT } from '../llm.js'

const OWL_TYPE_CN: Record<string, string> = {
  RockHostedMineral: '具有赋存岩石证据',
  StructurallyControlledMineral: '具有构造控制证据',
  AgeConstrainedMineral: '具有形成时代证据',
}

function formatOwlEvidence(types?: string[]): string {
  if (!types?.length) return ''
  return `（OWL推理：${types.map((type) => OWL_TYPE_CN[type] || type).join('、')}）`
}

/**
 * LLM Gateway — 多模型调度 + 异常互备
 *
 * 策略：
 *   1. 优先使用主模型 (primary)
 *   2. 主模型超时/网络错误 → 自动切换备用模型 (fallback)
 *   3. 备用也失败 → 返回 mock 降级回答
 */
export class LLMGateway {
  private providers: LLMProvider[] = []

  /** 注册 Provider（先注册的优先） */
  register(provider: LLMProvider): void {
    this.providers.push(provider)
    console.log(`[gateway] 已注册 Provider: ${provider.name}`)
  }

  /** 获取可用的 Provider 列表 */
  getProviders(): string[] {
    return this.providers.map((p) => p.name)
  }

  async generateToolCalls(
    systemPrompt: string,
    userPrompt: string,
    definitions: LLMToolDefinition[],
  ): Promise<LLMToolCall[]> {
    const primary = this.providers[0]
    if (!primary) return []
    try {
      return await primary.generateToolCalls(systemPrompt, userPrompt, definitions)
    } catch (error) {
      console.warn('[gateway] Agent tool planning failed; using deterministic fallback:', (error as Error).message)
      return []
    }
  }

  /** 非流式生成（带异常互备） */
  async generateAnswer(
    question: string,
    ragChunks: { chunk: Chunk; score: number }[],
    kgContext: KGPath[],
    retrievalMode: RetrievalMode = 'hybrid',
    spatialContext?: { data: SpatialData; analysis: SpatialAnalysis },
  ): Promise<{ answer: string; sources: Source[] }> {
    const prompt = buildPrompt(question, ragChunks, kgContext, retrievalMode, spatialContext)

    for (let i = 0; i < this.providers.length; i++) {
      const provider = this.providers[i]
      try {
        console.log(`[gateway] 调用 ${provider.name} (${i + 1}/${this.providers.length})`)
        const result = await provider.generateAnswer(
          question, ragChunks, kgContext, SYSTEM_PROMPT, prompt
        )
        return result
      } catch (err) {
        const msg = (err as Error).message
        console.warn(`[gateway] ${provider.name} 失败: ${msg}`)
        // 超时或网络错误 → 切换下一个
        if (this.isRetryable(msg) && i < this.providers.length - 1) {
          console.log(`[gateway] 切换备用模型...`)
          continue
        }
        // 最后一个也失败
        if (i === this.providers.length - 1) {
          console.warn('[gateway] 全部模型失败，降级到 mock 回答')
          return this.mockAnswer(question, ragChunks, kgContext, retrievalMode, spatialContext)
        }
      }
    }

    return this.mockAnswer(question, ragChunks, kgContext, retrievalMode, spatialContext)
  }

  /** 流式生成（当前不支持流式异常互备，回退到非流式） */
  async generateAnswerStream(
    question: string,
    ragChunks: { chunk: Chunk; score: number }[],
    kgContext: KGPath[],
    retrievalMode: RetrievalMode = 'hybrid',
    spatialContext: { data: SpatialData; analysis: SpatialAnalysis } | undefined,
    callbacks: {
      onChunk: (text: string) => void
      onDone: (sources: Source[]) => void
      onError: (err: Error) => void
    }
  ): Promise<void> {
    const primary = this.providers[0]
    if (!primary) {
      const { answer, sources } = this.mockAnswer(question, ragChunks, kgContext, retrievalMode, spatialContext)
      callbacks.onChunk(answer)
      callbacks.onDone(sources)
      return
    }

    const prompt = buildPrompt(question, ragChunks, kgContext, retrievalMode, spatialContext)

    try {
      await primary.generateAnswerStream(
        question, ragChunks, kgContext, SYSTEM_PROMPT, prompt, callbacks
      )
    } catch (err) {
      // 流式失败 → 降级为非流式 mock
      console.warn('[gateway] 流式失败，降级:', (err as Error).message)
      const { answer, sources } = this.mockAnswer(question, ragChunks, kgContext, retrievalMode, spatialContext)
      callbacks.onChunk(answer)
      callbacks.onDone(sources)
    }
  }

  /** 判断是否为可重试的错误（超时/网络） */
  private isRetryable(message: string): boolean {
    const lower = message.toLowerCase()
    return (
      lower.includes('timeout') ||
      lower.includes('etimedout') ||
      lower.includes('econnrefused') ||
      lower.includes('enotfound') ||
      lower.includes('429') ||
      lower.includes('rate') ||
      lower.includes('capacity')
    )
  }

  /** Mock 降级回答 */
  private mockAnswer(
    question: string,
    ragChunks: { chunk: Chunk; score: number }[],
    kgContext: KGPath[],
    retrievalMode: RetrievalMode = 'hybrid',
    spatialContext?: { data: SpatialData; analysis: SpatialAnalysis },
  ): { answer: string; sources: Source[] } {
    const showRag = retrievalMode === 'rag' || retrievalMode === 'hybrid'
    const showKg = retrievalMode === 'kg' || retrievalMode === 'hybrid'

    let answer = ''
    if (showRag && ragChunks.length > 0) {
      answer += `## 检索结果（共匹配 ${ragChunks.length} 个相关片段）\n\n`
      answer += '> 提示：LLM 服务暂时不可用，以下为检索直接结果。\n\n'
      for (let i = 0; i < ragChunks.length; i++) {
        const r = ragChunks[i]
        answer += `### ${i + 1}. 「${r.chunk.docTitle}」第${r.chunk.page}页\n`
        answer += r.chunk.content + '\n\n'
      }
    } else if (showRag) {
      answer = '未能检索到相关内容，且 LLM 服务暂时不可用。请稍后重试。'
    }
    if (showKg && kgContext.length > 0) {
      answer += '\n现有知识图谱及 OWL 推理结果显示：\n\n'
      for (const p of kgContext) {
        const inferred = p.inferred ? '（该关系由 OWL 规则推得）' : ''
        answer += `- 「${p.from}」${formatOwlEvidence(p.fromOwlTypes)}${p.relation}「${p.to}」${formatOwlEvidence(p.toOwlTypes)}${inferred}\n`
      }
    }
    if (spatialContext && spatialContext.analysis.summary.matchedCount > 0) {
      const summary = spatialContext.analysis.summary
      answer += `\n空间分析命中 ${summary.pointCount} 个点要素和 ${summary.lineCount} 条构造线。\n\n`
      for (const point of spatialContext.data.markers.slice(0, 10)) {
        const distance = point.distanceKm === undefined ? '' : `，距参照 ${point.distanceKm.toFixed(2)} 千米`
        const score = point.prospectivity ? `，演示有利度 ${point.prospectivity.score} 分` : ''
        answer += `- 「${point.name}」${distance}${score}${point.isMock ? '（功能演示数据）' : ''}\n`
      }
      if (summary.mockCount > 0) answer += '\n以上带标记的空间要素仅用于演示系统功能，不作为实际勘查依据。\n'
      if (spatialContext.analysis.regions.length > 1) {
        answer += '\n区域对比：\n\n'
        for (const region of spatialContext.analysis.regions.slice(0, 8)) {
          answer += `- ${region.region}：${region.count} 个点${region.averageProspectivityScore === undefined ? '' : `，演示有利度均分 ${region.averageProspectivityScore}`}\n`
        }
      }
    }
    if (!answer) {
      answer = '未能检索到相关内容，且 LLM 服务暂时不可用。请稍后重试。'
    }
    const sources: Source[] = ragChunks.slice(0, 5).map((r) => ({
      docId: r.chunk.id,
      docTitle: r.chunk.docTitle,
      page: r.chunk.page,
      snippet: r.chunk.content.slice(0, 150) + '...',
      synthetic: r.chunk.synthetic,
      isMock: r.chunk.isMock,
    }))
    return { answer, sources }
  }
}

/** 全局单例 */
export const gateway = new LLMGateway()
