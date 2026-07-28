import assert from 'node:assert/strict'
import { createAgentPlan } from './planner.js'

const hybrid = createAgentPlan({
  intent: 'geology_qa',
  question: 'How is Demo Deposit related to Demo Fault?',
  retrievalMode: 'hybrid',
  linkedEntities: [],
})

assert.deepEqual(hybrid.steps.map((step) => step.tool), [
  'search_documents',
  'query_knowledge_graph',
])
assert.ok(hybrid.steps.every((step) => step.label.length > 0))
assert.ok(hybrid.steps.length <= 3)
assert.equal(JSON.stringify(hybrid).includes('chainOfThought'), false)
assert.equal(JSON.stringify(hybrid).includes('reasoning'), false)

const linkedEntity = {
  id: 'entity-1',
  name: 'Demo Deposit',
  type: 'Mineral' as const,
  confidence: 0.9,
  matchedBy: 'context' as const,
  disambiguation: 'Active entity',
}
const entityDetail = createAgentPlan({
  intent: 'entity_lookup',
  question: 'Show its details',
  retrievalMode: 'hybrid',
  linkedEntities: [linkedEntity],
})
assert.deepEqual(entityDetail.steps.map((step) => step.tool), ['get_entity_detail'])

const entityDetailRagOnly = createAgentPlan({
  intent: 'entity_lookup',
  question: 'Show its details',
  retrievalMode: 'rag',
  linkedEntities: [linkedEntity],
})
assert.deepEqual(
  entityDetailRagOnly.steps.map((step) => step.tool),
  ['search_documents'],
  'deterministic fallback must preserve RAG-only mode for entity questions',
)

const spatial = createAgentPlan({
  intent: 'spatial_analysis',
  question: 'What is near Demo Deposit?',
  retrievalMode: 'hybrid',
  linkedEntities: [],
})
assert.deepEqual(spatial.steps.map((step) => step.tool), [
  'spatial_query',
  'query_knowledge_graph',
])

const spatialRagOnly = createAgentPlan({
  intent: 'spatial_analysis',
  question: 'What is near Demo Deposit?',
  retrievalMode: 'rag',
  linkedEntities: [],
})
assert.deepEqual(spatialRagOnly.steps.map((step) => step.tool), ['spatial_query'])

console.log('[PASS] bounded declarative agent planning')
