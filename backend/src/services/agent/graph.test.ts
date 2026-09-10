import assert from 'node:assert/strict'
import { createAgentGraph } from './graph.js'
import { createAgentToolRegistry } from './tools.js'

const registry = createAgentToolRegistry({
  async searchDocuments() {
    const contents = [
      'Copper mineralization follows the northeast fault.',
      'Granite supplied heat to the hydrothermal system.',
      'Skarn occurs along the intrusive contact zone.',
      'Magnetite is hosted by layered gabbro.',
      'Alteration includes silicification and sericitization.',
      'Mineralization formed during the synthetic Jurassic event.',
    ]
    const results = contents.map((content, index) => ({
      chunk: {
        id: index + 1,
        content,
        docTitle: `D${index + 1}`,
        page: 1,
        docType: 'synthetic',
      },
      score: 0.9 - index * 0.05,
    }))
    return { output: { results }, evidenceCount: results.length }
  },
  async queryKnowledgeGraph() {
    return { output: { results: [{ from: 'Demo Deposit', relation: 'HOSTED_IN', to: 'Demo Rock' }] }, evidenceCount: 1 }
  },
  async spatialQuery() { return { output: { data: { markers: [], polylines: [] } }, evidenceCount: 0 } },
  async getEntityDetail() { return { output: null, evidenceCount: 0 } },
})

const graph = createAgentGraph({ registry, toolTimeoutMs: 50, runTimeoutMs: 500 })
const result = await graph.invoke({
  question: 'How is Demo Deposit hosted?',
  retrievalMode: 'hybrid',
  memory: { recentMessages: [], summary: '', activeEntities: [] },
  candidates: [{ id: 'demo-1', name: 'Demo Deposit', type: 'Mineral', aliases: ['Deposit A'] }],
})

assert.equal(result.intent, 'geology_qa')
assert.equal(result.rewrittenQuestion, 'How is Demo Deposit hosted?')
assert.equal(result.linkedEntities[0]?.id, 'demo-1')
assert.deepEqual(result.plan.steps.map((step) => step.tool), ['search_documents', 'query_knowledge_graph'])
assert.equal(result.toolTrace.length, 2)
assert.equal(result.ragResults.length, 5, 'Agent context must retain at most five diverse chunks')
assert.equal(result.kgContext.length, 1)

console.log('[PASS] fixed LangGraph agent state flow')

const detailRegistry = createAgentToolRegistry({
  async searchDocuments() { return { output: { results: [] }, evidenceCount: 0 } },
  async queryKnowledgeGraph() { return { output: { results: [] }, evidenceCount: 0 } },
  async spatialQuery() { return { output: { data: { markers: [], polylines: [] } }, evidenceCount: 0 } },
  async getEntityDetail() {
    return {
      output: {
        entityId: 'demo-1',
        name: 'Demo Deposit',
        type: 'Mineral',
        hostRock: 'Demo Rock',
        scale: 'small',
      },
      evidenceCount: 1,
    }
  },
})
const detailGraph = createAgentGraph({
  registry: detailRegistry,
  toolTimeoutMs: 50,
  runTimeoutMs: 500,
  async planWithModel() {
    return {
      steps: [{
        id: 'entity-detail',
        label: 'Read entity details',
        tool: 'get_entity_detail',
        args: { entityId: 'demo-1' },
      }],
    }
  },
})
const detailResult = await detailGraph.invoke({
  question: 'Show details for Demo Deposit',
  retrievalMode: 'kg',
  memory: { recentMessages: [], summary: '', activeEntities: [] },
  candidates: [{ id: 'demo-1', name: 'Demo Deposit', type: 'Mineral' }],
})
assert.deepEqual(
  detailResult.kgContext.map((path) => [path.from, path.relation, path.to]),
  [
    ['Demo Deposit', 'ENTITY_TYPE', 'Mineral'],
    ['Demo Deposit', 'PROPERTY_hostRock', 'Demo Rock'],
    ['Demo Deposit', 'PROPERTY_scale', 'small'],
  ],
  'entity detail output must become answer evidence',
)

console.log('[PASS] entity detail tool output becomes KG evidence')

const activeEntity = {
  id: 'demo-1',
  name: 'Demo Deposit',
  type: 'Mineral' as const,
  confidence: 1,
  matchedBy: 'name' as const,
  disambiguation: 'Previous turn',
}
const followUpGraph = createAgentGraph({
  registry: detailRegistry,
  toolTimeoutMs: 50,
  runTimeoutMs: 500,
})
const followUpResult = await followUpGraph.invoke({
  question: '它的详情',
  retrievalMode: 'kg',
  memory: { recentMessages: [], summary: '', activeEntities: [activeEntity] },
  candidates: [],
})
assert.equal(followUpResult.rewrittenQuestion, 'Demo Deposit的详情')
assert.equal(followUpResult.linkedEntities[0]?.id, 'demo-1')
assert.equal(followUpResult.linkedEntities[0]?.matchedBy, 'context')
assert.deepEqual(followUpResult.plan.steps.map((step) => step.tool), ['get_entity_detail'])

console.log('[PASS] rewritten follow-up retains active entity linking')
