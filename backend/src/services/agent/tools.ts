import { z } from 'zod'
import type { AgentToolName } from '../../types/index.js'

export const searchDocumentsSchema = z.object({
  query: z.string().trim().min(1),
  topK: z.number().int().min(1).max(20).default(20),
  retrievalMode: z.enum(['bge', 'tfidf']).default('bge'),
})

export const queryKnowledgeGraphSchema = z.object({
  question: z.string().trim().min(1),
})

export const spatialQuerySchema = z.object({
  question: z.string().trim().min(1),
})

export const getEntityDetailSchema = z.object({
  entityId: z.string().trim().min(1),
})

export interface AgentToolHandlerResult {
  output: unknown
  evidenceCount: number
}

export interface AgentToolHandlers {
  searchDocuments(args: z.infer<typeof searchDocumentsSchema>): Promise<AgentToolHandlerResult>
  queryKnowledgeGraph(args: z.infer<typeof queryKnowledgeGraphSchema>): Promise<AgentToolHandlerResult>
  spatialQuery(args: z.infer<typeof spatialQuerySchema>): Promise<AgentToolHandlerResult>
  getEntityDetail(args: z.infer<typeof getEntityDetailSchema>): Promise<AgentToolHandlerResult>
}

export interface RegisteredAgentTool {
  schema: z.ZodTypeAny
  execute(args: unknown): Promise<AgentToolHandlerResult>
}

export type AgentToolRegistry = Record<AgentToolName, RegisteredAgentTool>

export function createAgentToolRegistry(handlers: AgentToolHandlers): AgentToolRegistry {
  return {
    search_documents: {
      schema: searchDocumentsSchema,
      execute: (args) => handlers.searchDocuments(args as z.infer<typeof searchDocumentsSchema>),
    },
    query_knowledge_graph: {
      schema: queryKnowledgeGraphSchema,
      execute: (args) => handlers.queryKnowledgeGraph(args as z.infer<typeof queryKnowledgeGraphSchema>),
    },
    spatial_query: {
      schema: spatialQuerySchema,
      execute: (args) => handlers.spatialQuery(args as z.infer<typeof spatialQuerySchema>),
    },
    get_entity_detail: {
      schema: getEntityDetailSchema,
      execute: (args) => handlers.getEntityDetail(args as z.infer<typeof getEntityDetailSchema>),
    },
  }
}
