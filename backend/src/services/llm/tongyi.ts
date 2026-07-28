import OpenAI from 'openai'
import type { LLMProvider } from './provider.js'
import type { Chunk, Source, KGPath } from '../../types/index.js'
import { getRuntimeSettings } from '../runtime-settings.js'

export interface TongyiConfig {
  apiKey: string
  model: string
  baseURL: string
}

/**
 * 通义千问 Provider（OpenAI 兼容端点）
 *
 * DashScope 已提供 OpenAI 兼容接口:
 *   baseURL: https://dashscope.aliyuncs.com/compatible-mode/v1
 *   模型: qwen-plus / qwen-max / qwen-turbo
 *
 * 当前为占位实现，与 DeepSeek Provider 结构相同，
 * 仅 baseURL 和模型名不同。填入真实 key 后即可激活。
 */
export class TongyiProvider implements LLMProvider {
  readonly name = '通义千问'
  private client: OpenAI | null = null
  private model: string
  private config: TongyiConfig

  constructor(config: TongyiConfig) {
    this.config = config
    this.model = config.model
    // 仅在有 key 时创建客户端
    if (config.apiKey && config.apiKey !== 'sk-your-tongyi-key-here') {
      this.client = new OpenAI({ apiKey: config.apiKey, baseURL: config.baseURL })
    }
  }

  private ensureClient(): OpenAI {
    if (!this.client) {
      throw new Error('通义千问 API key 未配置，请在 .env 中设置 TONGYI_API_KEY')
    }
    return this.client
  }

  async generateAnswer(
    _question: string,
    _ragChunks: { chunk: Chunk; score: number }[],
    _kgContext: KGPath[],
    systemPrompt: string,
    userPrompt: string
  ): Promise<{ answer: string; sources: Source[] }> {
    const client = this.ensureClient()
    const completion = await client.chat.completions.create(
      {
        model: this.model,
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
      const client = this.ensureClient()
      const stream = await client.chat.completions.create(
        {
          model: this.model,
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
