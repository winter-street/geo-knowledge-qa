import assert from 'node:assert/strict'
import { createAgentToolRegistry } from './tools.js'
import { executeToolCalls } from './executor.js'
import type { AgentPlanStep } from '../../types/index.js'

let documentCalls = 0
let entityCalls = 0
const registry = createAgentToolRegistry({
  async searchDocuments(args) {
    documentCalls += 1
    return { output: { query: args.query }, evidenceCount: 2 }
  },
  async queryKnowledgeGraph(args) {
    return { output: { question: args.question }, evidenceCount: 1 }
  },
  async spatialQuery(args) {
    return { output: { question: args.question }, evidenceCount: 3 }
  },
  async getEntityDetail(args) {
    entityCalls += 1
    return { output: { id: args.entityId }, evidenceCount: 1 }
  },
})

const fourCalls: AgentPlanStep[] = [
  { id: 's1', label: 'Documents', tool: 'search_documents', args: { query: 'demo', topK: 5, retrievalMode: 'bge' } },
  { id: 's2', label: 'Graph', tool: 'query_knowledge_graph', args: { question: 'demo' } },
  { id: 's3', label: 'Spatial', tool: 'spatial_query', args: { question: 'demo' } },
  { id: 's4', label: 'Detail', tool: 'get_entity_detail', args: { entityId: 'entity-1' } },
]
const bounded = await executeToolCalls(fourCalls, registry, { toolTimeoutMs: 50 })
assert.equal(bounded.results.length, 3)
assert.equal(bounded.trace.length, 3)
assert.equal(entityCalls, 0, 'a fourth tool must never execute')
assert.deepEqual(bounded.trace.map((item) => item.status), ['completed', 'completed', 'completed'])
assert.equal(documentCalls, 1)

const invalid = await executeToolCalls([
  { id: 'invalid', label: 'Invalid', tool: 'search_documents', args: { query: '', topK: 100 } },
], registry, { toolTimeoutMs: 50 })
assert.equal(invalid.trace[0]?.status, 'failed')
assert.equal(invalid.trace[0]?.evidenceCount, 0)
assert.equal(documentCalls, 1, 'invalid arguments must not reach the handler')

const timeoutRegistry = createAgentToolRegistry({
  async searchDocuments() {
    await new Promise(() => undefined)
    return { output: null, evidenceCount: 0 }
  },
  async queryKnowledgeGraph() { return { output: [], evidenceCount: 0 } },
  async spatialQuery() { return { output: [], evidenceCount: 0 } },
  async getEntityDetail() { return { output: null, evidenceCount: 0 } },
})
const timedOut = await executeToolCalls([
  { id: 'timeout', label: 'Timeout', tool: 'search_documents', args: { query: 'demo', topK: 5, retrievalMode: 'tfidf' } },
], timeoutRegistry, { toolTimeoutMs: 5 })
assert.equal(timedOut.trace[0]?.status, 'timeout')
assert.ok((timedOut.trace[0]?.latencyMs ?? 0) >= 0)

console.log('[PASS] typed bounded tool execution and timeout degradation')
