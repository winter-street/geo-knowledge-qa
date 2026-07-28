import OpenAI from 'openai'
import type { LLMProvider } from './provider.js'
import type { Chunk, Source, KGPath } from '../../types/index.js'
import { getRuntimeSettings } from '../runtime-settings.js'

export interface DeepSeekConfig {
  apiKey: string
  model: string
  baseURL: string
}

/**
 * DeepSeek Provider（OpenAI 兼容 SDK）
 *
 * 支持 deepseek-v4-flash / deepseek-v4-pro 等模型
 */
export class DeepSeekProvider implements LLMProvider {
  readonly name = 'DeepSeek'
  private client: OpenAI
  private model: string

  constructor(config: DeepSeekConfig) {
    this.client = new OpenAI({ apiKey: config.apiKey, baseURL: config.baseURL })
    this.model = config.model
  }

  async generateAnswer(
    _question: string,
    _ragChunks: { chunk: Chunk; score: number }[],
    _kgContext: KGPath[],
    systemPrompt: string,
    userPrompt: string
  ): Promise<{ answer: string; sources: Source[] }> {
    const completion = await this.client.chat.completions.create(
      {
        model: getRuntimeSettings().llmModel || this.model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        temperature: getRuntimeSettings().temperature,
        max_tokens: getRuntimeSettings().maxTokens,
      },
      { timeout: 30000 }
    )

    const answer = completion.choices[0]?.message?.content || '抱歉，未能生成回答。'
    const sources: Source[] = _ragChunks.map((r) => ({
      docId: r.chunk.id,
      docTitle: r.chunk.docTitle,
      page: r.chunk.page,
      snippet: r.chunk.content.slice(0, 150) + '...',
    }))
    return { answer, sources }
  }

  async generateAnswerStream(
    _question: string,
    _ragChunks: { chunk: Chunk; score: number }[],
    _kgContext: KGPath[],
    systemPrompt: string,
    userPrompt: string,
    callbacks: {
      onChunk: (text: string) => void
      onDone: (sources: Source[]) => void
      onError: (err: Error) => void
    }
  ): Promise<void> {
    try {
      const stream = await this.client.chat.completions.create(
        {
          model: getRuntimeSettings().llmModel || this.model,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt },
          ],
          temperature: getRuntimeSettings().temperature,
          max_tokens: getRuntimeSettings().maxTokens,
          stream: true,
        },
        { timeout: 60000 }
      )

      for await (const chunk of stream) {
        const delta = chunk.choices?.[0]?.delta?.content
        if (delta) callbacks.onChunk(delta)
      }

      const sources: Source[] = _ragChunks.map((r) => ({
        docId: r.chunk.id,
        docTitle: r.chunk.docTitle,
        page: r.chunk.page,
        snippet: r.chunk.content.slice(0, 150) + '...',
      }))
      callbacks.onDone(sources)
    } catch (err) {
      callbacks.onError(err as Error)
    }
  }
}
