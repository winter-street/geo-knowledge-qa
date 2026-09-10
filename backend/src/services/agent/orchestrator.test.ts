import assert from 'node:assert/strict'
import Database from 'better-sqlite3'
import { createAppStateStore } from '../../db/app-state.js'
import { createAgentToolRegistry } from './tools.js'
import { prepareAgentTurn, completeAgentTurn } from './orchestrator.js'

const db = new Database(':memory:')
const store = createAppStateStore(db)
const registry = createAgentToolRegistry({
  async searchDocuments() {
    return { output: { results: [] }, evidenceCount: 0 }
  },
  async queryKnowledgeGraph() {
    return { output: { results: [{ from: 'Demo Deposit', relation: 'HOSTED_IN', to: 'Demo Rock' }] }, evidenceCount: 1 }
  },
  async spatialQuery() { return { output: { data: { markers: [], polylines: [] } }, evidenceCount: 0 } },
  async getEntityDetail() { return { output: { name: 'Demo Deposit' }, evidenceCount: 1 } },
})

let sequence = 0
const dependencies = {
  store,
  registry,
  async findCandidates() {
    return [{ id: 'node-1', name: 'Demo Deposit', type: 'Mineral' as const, aliases: ['Deposit A'] }]
  },
  createId(prefix: string) {
    sequence += 1
    return `${prefix}-${sequence}`
  },
  now() { return '2026-07-27T00:00:00.000Z' },
}

const prepared = await prepareAgentTurn({
  userId: 'user-a',
  conversationId: 'conv-agent',
  question: 'How is Demo Deposit hosted?',
  retrievalMode: 'kg',
}, dependencies)

assert.equal(prepared.conversationId, 'conv-agent')
assert.equal(prepared.intent, 'geology_qa')
assert.equal(store.getRecentMessages('user-a', 'conv-agent', 6).length, 1)
assert.equal(store.getConversation('user-b', 'conv-agent'), undefined)
assert.equal(store.getToolCalls('user-a', prepared.runId).length, 1)

completeAgentTurn(prepared, 'It is hosted in Demo Rock.', dependencies)
assert.equal(store.getRecentMessages('user-a', 'conv-agent', 6).length, 2)
assert.equal(store.loadMemory('user-a', 'conv-agent').activeEntities[0]?.id, 'node-1')

const timeoutRegistry = createAgentToolRegistry({
  async searchDocuments() {
    await new Promise(() => undefined)
    return { output: null, evidenceCount: 0 }
  },
  async queryKnowledgeGraph() { return { output: { results: [] }, evidenceCount: 0 } },
  async spatialQuery() { return { output: { data: { markers: [], polylines: [] } }, evidenceCount: 0 } },
  async getEntityDetail() { return { output: null, evidenceCount: 0 } },
})
const timedOut = await prepareAgentTurn({
  userId: 'user-a',
  conversationId: 'conv-timeout',
  question: 'Search synthetic documents',
  retrievalMode: 'rag',
}, { ...dependencies, registry: timeoutRegistry, toolTimeoutMs: 5 })
assert.equal(timedOut.toolTrace[0]?.status, 'timeout')
assert.equal(String(store.getToolCalls('user-a', timedOut.runId)[0]?.status), 'timeout')

await assert.rejects(
  prepareAgentTurn({
    userId: 'user-b',
    conversationId: 'conv-agent',
    question: 'Unauthorized follow-up',
    retrievalMode: 'kg',
  }, dependencies),
  /conversation not found/i,
)

db.close()
console.log('[PASS] JWT-scoped agent turn persistence')
