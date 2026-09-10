import type { Chunk, Source, KGPath } from '../../types/index.js'

export interface GenerationOptions {
  model?: string
  temperature?: number
  maxTokens?: number
}

export interface LLMToolDefinition {
  name: string
  description: string
  parameters: Record<string, unknown>
}

export interface LLMToolCall {
  id: string
  name: string
  arguments: Record<string, unknown>
}

/** LLM Provider 统一接口 */
export interface LLMProvider {
  /** 模型名称（用于日志和配置） */
  readonly name: string

  /** 非流式生成回答 */
  generateAnswer(
    question: string,
    ragChunks: { chunk: Chunk; score: number }[],
    kgContext: KGPath[],
    systemPrompt: string,
    userPrompt: string
  ): Promise<{ answer: string; sources: Source[] }>

  generateToolCalls(
    systemPrompt: string,
    userPrompt: string,
    definitions: LLMToolDefinition[],
  ): Promise<LLMToolCall[]>

  /** 流式生成回答 */
  generateAnswerStream(
    question: string,
    ragChunks: { chunk: Chunk; score: number }[],
    kgContext: KGPath[],
    systemPrompt: string,
    userPrompt: string,
    callbacks: {
      onChunk: (text: string) => void
      onDone: (sources: Source[]) => void
      onError: (err: Error) => void
    }
  ): Promise<void>
}
