import assert from 'node:assert/strict'
import { createLlmAgentPlanner } from './llm-planner.js'

const input = {
  intent: 'geology_qa' as const,
  question: 'How is Demo Deposit hosted?',
  retrievalMode: 'hybrid' as const,
  linkedEntities: [],
}

let definitionCount = 0
const planner = createLlmAgentPlanner(async (_system, _user, definitions) => {
  definitionCount = definitions.length
  return [
    { id: 'c1', name: 'search_documents', arguments: { query: 'Demo Deposit', topK: 20, retrievalMode: 'bge' } },
    { id: 'c2', name: 'query_knowledge_graph', arguments: { question: 'Demo Deposit' } },
    { id: 'c3', name: 'spatial_query', arguments: { question: 'Demo Deposit nearby' } },
    { id: 'c4', name: 'get_entity_detail', arguments: { entityId: 'ignored-fourth' } },
  ]
})
const plan = await planner(input)
assert.equal(definitionCount, 4)
assert.deepEqual(plan.steps.map((step) => step.tool), [
  'search_documents', 'query_knowledge_graph', 'spatial_query',
])
assert.ok(plan.steps.length <= 3)

const fallbackPlanner = createLlmAgentPlanner(async () => [
  { id: 'invalid', name: 'search_documents', arguments: { query: '', topK: 100 } },
])
const fallback = await fallbackPlanner(input)
assert.deepEqual(fallback.steps.map((step) => step.tool), [
  'search_documents', 'query_knowledge_graph',
])

const ragOnlyPlanner = createLlmAgentPlanner(async () => [
  { id: 'disallowed-kg', name: 'query_knowledge_graph', arguments: { question: 'Demo Deposit' } },
  { id: 'allowed-rag', name: 'search_documents', arguments: { query: 'Demo Deposit', topK: 20, retrievalMode: 'bge' } },
])
const ragOnly = await ragOnlyPlanner({ ...input, retrievalMode: 'rag' })
assert.deepEqual(
  ragOnly.steps.map((step) => step.tool),
  ['search_documents'],
  'RAG-only planning must reject KG tool calls returned by the model',
)

const kgOnlyPlanner = createLlmAgentPlanner(async () => [
  { id: 'disallowed-rag', name: 'search_documents', arguments: { query: 'Demo Deposit', topK: 20, retrievalMode: 'bge' } },
])
const kgOnly = await kgOnlyPlanner({ ...input, retrievalMode: 'kg' })
assert.deepEqual(
  kgOnly.steps.map((step) => step.tool),
  ['query_knowledge_graph'],
  'KG-only planning must fall back to a mode-compliant deterministic plan',
)

console.log('[PASS] standard LLM tool calls with validated deterministic fallback')
