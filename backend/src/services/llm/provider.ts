import type { Chunk, Source, KGPath } from '../../types/index.js'

/** 单次调用覆盖参数，仅供离线评测等受控任务使用。 */
export interface GenerationOptions {
  model?: string
  temperature?: number
  maxTokens?: number
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
    userPrompt: string,
    options?: GenerationOptions,
  ): Promise<{ answer: string; sources: Source[] }>

  /** 不拼接检索上下文的原始文本生成，用于受控基线与评测裁判。 */
  generateText(
    systemPrompt: string,
    userPrompt: string,
    options?: GenerationOptions,
  ): Promise<string>

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
    },
    options?: GenerationOptions,
  ): Promise<void>
}
