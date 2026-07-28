import type { Chunk, Source, KGPath } from '../../types/index.js'

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
