import { z } from 'zod'
import type { AgentPlan, AgentPlanStep } from '../../types/index.js'
import type { LLMToolCall, LLMToolDefinition } from '../llm/provider.js'
import { createAgentPlan, type AgentPlanningInput } from './planner.js'
import {
  getEntityDetailSchema,
  queryKnowledgeGraphSchema,
  searchDocumentsSchema,
  spatialQuerySchema,
} from './tools.js'

const validatedToolCall = z.discriminatedUnion('name', [
  z.object({ id: z.string(), name: z.literal('search_documents'), arguments: searchDocumentsSchema }),
  z.object({ id: z.string(), name: z.literal('query_knowledge_graph'), arguments: queryKnowledgeGraphSchema }),
  z.object({ id: z.string(), name: z.literal('spatial_query'), arguments: spatialQuerySchema }),
  z.object({ id: z.string(), name: z.literal('get_entity_detail'), arguments: getEntityDetailSchema }),
])

export const AGENT_TOOL_DEFINITIONS: LLMToolDefinition[] = [
  {
    name: 'search_documents',
    description: 'Retrieve supporting geological document passages.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      required: ['query', 'topK', 'retrievalMode'],
      properties: {
        query: { type: 'string', minLength: 1 },
        topK: { type: 'integer', minimum: 1, maximum: 20 },
        retrievalMode: { type: 'string', enum: ['bge', 'tfidf'] },
      },
    },
  },
  {
    name: 'query_knowledge_graph',
    description: 'Find structured geological entity relations and paths.',
    parameters: {
      type: 'object', additionalProperties: false, required: ['question'],
      properties: { question: { type: 'string', minLength: 1 } },
    },
  },
  {
    name: 'spatial_query',
    description: 'Run map and spatial analysis for distance, range, region, or comparison questions.',
    parameters: {
      type: 'object', additionalProperties: false, required: ['question'],
      properties: { question: { type: 'string', minLength: 1 } },
    },
  },
  {
    name: 'get_entity_detail',
    description: 'Read details for one already linked knowledge-graph entity ID.',
    parameters: {
      type: 'object', additionalProperties: false, required: ['entityId'],
      properties: { entityId: { type: 'string', minLength: 1 } },
    },
  },
]

const STEP_LABELS: Record<AgentPlanStep['tool'], string> = {
  search_documents: 'Search geological documents',
  query_knowledge_graph: 'Query geological relations',
  spatial_query: 'Run spatial analysis',
  get_entity_detail: 'Read linked entity details',
}

export type GenerateToolCalls = (
  systemPrompt: string,
  userPrompt: string,
  definitions: LLMToolDefinition[],
) => Promise<LLMToolCall[]>

function allowedTools(retrievalMode: AgentPlanningInput['retrievalMode']): Set<AgentPlanStep['tool']> {
  const allowed = new Set<AgentPlanStep['tool']>(['spatial_query'])
  if (retrievalMode !== 'kg') allowed.add('search_documents')
  if (retrievalMode !== 'rag') {
    allowed.add('query_knowledge_graph')
    allowed.add('get_entity_detail')
  }
  return allowed
}

export function createLlmAgentPlanner(generateToolCalls: GenerateToolCalls) {
  return async (input: AgentPlanningInput): Promise<AgentPlan> => {
    try {
      const allowed = allowedTools(input.retrievalMode)
      const calls = await generateToolCalls(
        'Select up to three tools for the geological investigation. Use function calls only. Do not explain or reveal reasoning.',
        JSON.stringify({
          intent: input.intent,
          question: input.question,
          retrievalMode: input.retrievalMode,
          linkedEntities: input.linkedEntities.map(({ id, name, type }) => ({ id, name, type })),
        }),
        AGENT_TOOL_DEFINITIONS.filter((definition) => allowed.has(definition.name as AgentPlanStep['tool'])),
      )
      const steps = calls.flatMap((call, index) => {
        const parsed = validatedToolCall.safeParse(call)
        if (!parsed.success || !allowed.has(parsed.data.name)) return []
        return [{
          id: parsed.data.id || `tool-${index + 1}`,
          label: STEP_LABELS[parsed.data.name],
          tool: parsed.data.name,
          args: parsed.data.arguments,
        } satisfies AgentPlanStep]
      }).slice(0, 3)
      return steps.length > 0 ? { steps } : createAgentPlan(input)
    } catch {
      return createAgentPlan(input)
    }
  }
}
