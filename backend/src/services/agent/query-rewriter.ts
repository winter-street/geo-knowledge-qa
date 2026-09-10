import { z } from 'zod'
import type { LLMToolCall, LLMToolDefinition } from '../llm/provider.js'
import type { AgentReplanInput } from './graph.js'

const rewriteArguments = z.object({
  rewrittenQuestion: z.string().trim().min(1).max(500),
})

const REWRITE_TOOL: LLMToolDefinition = {
  name: 'rewrite_query',
  description: 'Rewrite the geological retrieval query without answering it.',
  parameters: {
    type: 'object',
    additionalProperties: false,
    required: ['rewrittenQuestion'],
    properties: {
      rewrittenQuestion: { type: 'string', minLength: 1, maxLength: 500 },
    },
  },
}

type GenerateToolCalls = (
  systemPrompt: string,
  userPrompt: string,
  definitions: LLMToolDefinition[],
) => Promise<LLMToolCall[]>

function deterministicRewrite(input: AgentReplanInput): string {
  const entities = input.linkedEntities.map((entity) => entity.name).filter(Boolean)
  return [...new Set(entities), input.question].filter(Boolean).join(' ').slice(0, 500)
}

export function createLlmQueryRewriter(generateToolCalls: GenerateToolCalls) {
  return async (input: AgentReplanInput): Promise<string> => {
    try {
      const calls = await generateToolCalls(
        'Rewrite one geological retrieval query. Preserve the user intent and named entities. Do not answer, explain, or invent facts. Return the rewrite_query function call only.',
        JSON.stringify({
          question: input.question,
          intent: input.intent,
          retrievalMode: input.retrievalMode,
          entities: input.linkedEntities.map(({ id, name, type }) => ({ id, name, type })),
          retrievalFailures: input.reasonCodes,
        }),
        [REWRITE_TOOL],
      )
      const candidate = calls.find((call) => call.name === 'rewrite_query')
      const parsed = rewriteArguments.safeParse(candidate?.arguments)
      if (parsed.success) return parsed.data.rewrittenQuestion
    } catch {
      // Provider failures use the deterministic entity-aware query below.
    }
    return deterministicRewrite(input)
  }
}
