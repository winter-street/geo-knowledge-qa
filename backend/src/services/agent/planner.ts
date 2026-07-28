import type {
  AgentIntent,
  AgentPlan,
  AgentPlanStep,
  LinkedEntity,
  RetrievalMode,
} from '../../types/index.js'

export interface AgentPlanningInput {
  intent: AgentIntent
  question: string
  retrievalMode: RetrievalMode
  linkedEntities: LinkedEntity[]
}

function step(
  id: string,
  label: string,
  tool: AgentPlanStep['tool'],
  args: Record<string, unknown>,
): AgentPlanStep {
  return { id, label, tool, args }
}

export function createAgentPlan(input: AgentPlanningInput): AgentPlan {
  const { intent, question, retrievalMode, linkedEntities } = input
  let steps: AgentPlanStep[] = []

  if (intent === 'entity_lookup') {
    if (retrievalMode === 'rag') {
      steps = [step('entity-documents', 'Search geological documents', 'search_documents', {
        query: question,
        topK: 20,
        retrievalMode: 'bge',
      })]
    } else {
      const entity = linkedEntities[0]
      steps = entity
        ? [step('entity-detail', 'Read linked entity details', 'get_entity_detail', { entityId: entity.id })]
        : [step('entity-search', 'Search entity relations', 'query_knowledge_graph', { question })]
    }
  } else if (intent === 'spatial_analysis' || intent === 'region_comparison') {
    steps = [
      step('spatial', 'Run spatial analysis', 'spatial_query', { question }),
    ]
    if (retrievalMode !== 'rag') {
      steps.push(step('spatial-kg', 'Find supporting graph relations', 'query_knowledge_graph', { question }))
    }
  } else if (intent === 'geology_qa') {
    if (retrievalMode !== 'kg') {
      steps.push(step('documents', 'Search geological documents', 'search_documents', {
        query: question,
        topK: 20,
        retrievalMode: 'bge',
      }))
    }
    if (retrievalMode !== 'rag') {
      steps.push(step('knowledge-graph', 'Query geological relations', 'query_knowledge_graph', { question }))
    }
  }

  return { steps: steps.slice(0, 3) }
}
