import assert from 'node:assert/strict'
import Database from 'better-sqlite3'
import { createAppStateStore } from '../db/app-state.js'
import { createAgentToolRegistry } from '../services/agent/tools.js'
import { handleAgentQa, type AgentQaResponse } from './qa-agent.js'

function responseRecorder(): AgentQaResponse & { statusCode: number; jsonBody?: unknown; chunks: string[] } {
  return {
    chunks: [],
    statusCode: 200,
    status(code) { this.statusCode = code; return this },
    json(body) { this.jsonBody = body; return this },
    writeHead(code) { this.statusCode = code; return this },
    write(chunk) { this.chunks.push(String(chunk)); return true },
    end() { return this },
  }
}

async function waitFor(predicate: () => boolean, timeoutMs = 250): Promise<boolean> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (predicate()) return true
    await new Promise((resolve) => setTimeout(resolve, 2))
  }
  return predicate()
}

const db = new Database(':memory:')
const store = createAppStateStore(db)
const registry = createAgentToolRegistry({
  async searchDocuments() { return { output: { results: [] }, evidenceCount: 0 } },
  async queryKnowledgeGraph() {
    return { output: { results: [{ from: 'Demo Deposit', relation: 'HOSTED_IN', to: 'Demo Rock' }] }, evidenceCount: 1 }
  },
  async spatialQuery() { return { output: { data: { markers: [], polylines: [] } }, evidenceCount: 0 } },
  async getEntityDetail() { return { output: { name: 'Demo Deposit' }, evidenceCount: 1 } },
})
let sequence = 0
const dependencies = {
  orchestrator: {
    store,
    registry,
    async findCandidates() {
      return [{ id: 'node-1', name: 'Demo Deposit', type: 'Mineral' as const }]
    },
    createId(prefix: string) { sequence += 1; return `${prefix}-${sequence}` },
    now() { return '2026-07-27T00:00:00.000Z' },
  },
  async generateAnswer() {
    return { answer: 'Demo Deposit is hosted in Demo Rock.', sources: [] }
  },
}

const jsonResponse = responseRecorder()
await handleAgentQa({
  user: { userId: 'user-a', username: 'demo', role: 'user' },
  body: { question: 'How is Demo Deposit hosted?', conversationId: 'conv-json', retrievalMode: 'kg' },
}, jsonResponse, dependencies)

const body = jsonResponse.jsonBody as Record<string, unknown>
assert.equal(body.conversationId, 'conv-json')
assert.equal(body.intent, 'geology_qa')
assert.equal((body.linkedEntities as unknown[]).length, 1)
assert.equal((body.toolTrace as unknown[]).length, 1)
assert.match(String(body.answer), /\[KG1\]/)
assert.deepEqual((body.citations as Array<{ id: string }>).map((citation) => citation.id), ['KG1'])

const streamResponse = responseRecorder()
await handleAgentQa({
  user: { userId: 'user-a', username: 'demo', role: 'user' },
  body: { question: 'How is Demo Deposit hosted?', conversationId: 'conv-stream', retrievalMode: 'kg', stream: true },
}, streamResponse, dependencies)
const events = streamResponse.chunks
  .filter((line) => line.startsWith('data: '))
  .map((line) => JSON.parse(line.slice(6).trim()))
assert.deepEqual(events.map((event) => event.type), [
  'meta', 'plan', 'tool_start', 'tool_end', 'chunk', 'done',
])
assert.equal(events.at(-1)?.conversationId, 'conv-stream')
assert.deepEqual(events.at(-1)?.citations.map((citation: { id: string }) => citation.id), ['KG1'])

let releaseTool: (() => void) | undefined
const liveRegistry = createAgentToolRegistry({
  async searchDocuments() { return { output: { results: [] }, evidenceCount: 0 } },
  async queryKnowledgeGraph() {
    await new Promise<void>((resolve) => { releaseTool = resolve })
    return { output: { results: [{ from: 'Demo Deposit', relation: 'HOSTED_IN', to: 'Demo Rock' }] }, evidenceCount: 1 }
  },
  async spatialQuery() { return { output: { data: { markers: [], polylines: [] } }, evidenceCount: 0 } },
  async getEntityDetail() { return { output: { name: 'Demo Deposit' }, evidenceCount: 1 } },
})
const liveResponse = responseRecorder()
const liveRequest = handleAgentQa({
  user: { userId: 'user-a', username: 'demo', role: 'user' },
  body: { question: 'How is Demo Deposit hosted?', conversationId: 'conv-live', retrievalMode: 'kg', stream: true },
}, liveResponse, {
  ...dependencies,
  orchestrator: { ...dependencies.orchestrator, registry: liveRegistry },
})

assert.equal(
  await waitFor(() => liveResponse.chunks.some((line) => line.includes('"type":"tool_start"'))),
  true,
  'tool_start must be emitted while the tool is still running',
)
const liveEventsBeforeRelease = liveResponse.chunks
  .filter((line) => line.startsWith('data: '))
  .map((line) => JSON.parse(line.slice(6).trim()))
assert.deepEqual(liveEventsBeforeRelease.map((event) => event.type), ['meta', 'plan', 'tool_start'])
assert.ok(releaseTool, 'tool execution should have started')
releaseTool()
await liveRequest
const liveEvents = liveResponse.chunks
  .filter((line) => line.startsWith('data: '))
  .map((line) => JSON.parse(line.slice(6).trim()))
assert.deepEqual(liveEvents.map((event) => event.type), [
  'meta', 'plan', 'tool_start', 'tool_end', 'chunk', 'done',
])

let releaseCandidates: ((value: Array<{ id: string; name: string; type: 'Mineral' }>) => void) | undefined
let delayedToolCalls = 0
let delayedAnswerCalls = 0
const delayedRegistry = createAgentToolRegistry({
  async searchDocuments() { delayedToolCalls += 1; return { output: { results: [] }, evidenceCount: 0 } },
  async queryKnowledgeGraph() { delayedToolCalls += 1; return { output: { results: [] }, evidenceCount: 0 } },
  async spatialQuery() { delayedToolCalls += 1; return { output: { data: { markers: [], polylines: [] } }, evidenceCount: 0 } },
  async getEntityDetail() { delayedToolCalls += 1; return { output: null, evidenceCount: 0 } },
})
const deadlineResponse = responseRecorder()
const deadlineRequest = handleAgentQa({
  user: { userId: 'user-a', username: 'demo', role: 'user' },
  body: { question: 'Inspect Demo Deposit', conversationId: 'conv-deadline', retrievalMode: 'kg' },
}, deadlineResponse, {
  runTimeoutMs: 20,
  orchestrator: {
    ...dependencies.orchestrator,
    registry: delayedRegistry,
    async findCandidates() {
      return await new Promise((resolve) => { releaseCandidates = resolve })
    },
  },
  async generateAnswer() {
    delayedAnswerCalls += 1
    return { answer: 'late answer', sources: [] }
  },
})
assert.equal(
  await Promise.race([
    deadlineRequest.then(() => true),
    new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 250)),
  ]),
  true,
  'the whole Agent turn deadline must include entity candidate lookup',
)
assert.equal(deadlineResponse.statusCode, 500)
assert.match(String((deadlineResponse.jsonBody as { error?: string })?.error), /timed out/i)
assert.equal(delayedToolCalls, 0)
assert.equal(delayedAnswerCalls, 0)
assert.equal((db.prepare('SELECT COUNT(*) AS count FROM agent_runs WHERE conversation_id = ?').get('conv-deadline') as { count: number }).count, 0)

releaseCandidates?.([{ id: 'late-node', name: 'Demo Deposit', type: 'Mineral' }])
await new Promise((resolve) => setTimeout(resolve, 30))
assert.equal(delayedToolCalls, 0, 'late candidate completion must not continue the graph')
assert.equal(delayedAnswerCalls, 0, 'late candidate completion must not generate an answer')
assert.equal((db.prepare('SELECT COUNT(*) AS count FROM agent_runs WHERE conversation_id = ?').get('conv-deadline') as { count: number }).count, 0)

let releaseDeadlineTool: (() => void) | undefined
let answerAfterDeadlineTool = 0
const deadlineToolRegistry = createAgentToolRegistry({
  async searchDocuments() { return { output: { results: [] }, evidenceCount: 0 } },
  async queryKnowledgeGraph() {
    await new Promise<void>((resolve) => { releaseDeadlineTool = resolve })
    return { output: { results: [] }, evidenceCount: 0 }
  },
  async spatialQuery() { return { output: { data: { markers: [], polylines: [] } }, evidenceCount: 0 } },
  async getEntityDetail() { return { output: null, evidenceCount: 0 } },
})
const deadlineToolResponse = responseRecorder()
const deadlineToolRequest = handleAgentQa({
  user: { userId: 'user-a', username: 'demo', role: 'user' },
  body: { question: 'How is Demo Deposit hosted?', conversationId: 'conv-tool-deadline', retrievalMode: 'kg', stream: true },
}, deadlineToolResponse, {
  runTimeoutMs: 20,
  orchestrator: {
    ...dependencies.orchestrator,
    registry: deadlineToolRegistry,
    toolTimeoutMs: 500,
  },
  async generateAnswer() {
    answerAfterDeadlineTool += 1
    return { answer: 'must not run', sources: [] }
  },
})
assert.equal(
  await Promise.race([
    deadlineToolRequest.then(() => true),
    new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 250)),
  ]),
  true,
  'the whole Agent turn deadline must preempt a longer tool timeout',
)
const toolDeadlineEventTypes = deadlineToolResponse.chunks
  .filter((line) => line.startsWith('data: '))
  .map((line) => JSON.parse(line.slice(6).trim()).type)
assert.deepEqual(toolDeadlineEventTypes, ['meta', 'plan', 'tool_start', 'error'])
assert.equal(answerAfterDeadlineTool, 0)
assert.equal((db.prepare('SELECT COUNT(*) AS count FROM agent_runs WHERE conversation_id = ?').get('conv-tool-deadline') as { count: number }).count, 0)
releaseDeadlineTool?.()
await new Promise((resolve) => setTimeout(resolve, 30))
assert.deepEqual(
  deadlineToolResponse.chunks
    .filter((line) => line.startsWith('data: '))
    .map((line) => JSON.parse(line.slice(6).trim()).type),
  toolDeadlineEventTypes,
  'late tool completion must not emit a second terminal trace event',
)
assert.equal((db.prepare('SELECT COUNT(*) AS count FROM agent_runs WHERE conversation_id = ?').get('conv-tool-deadline') as { count: number }).count, 0)

let releaseAnswer: ((value: { answer: string; sources: [] }) => void) | undefined
const answerDeadlineResponse = responseRecorder()
await handleAgentQa({
  user: { userId: 'user-a', username: 'demo', role: 'user' },
  body: { question: 'How is Demo Deposit hosted?', conversationId: 'conv-answer-deadline', retrievalMode: 'kg' },
}, answerDeadlineResponse, {
  ...dependencies,
  runTimeoutMs: 20,
  async generateAnswer() {
    return await new Promise((resolve) => { releaseAnswer = resolve })
  },
})
assert.equal(answerDeadlineResponse.statusCode, 200)
assert.match(String((answerDeadlineResponse.jsonBody as { answer?: string })?.answer), /timed out|证据不足/i)
assert.equal((db.prepare('SELECT COUNT(*) AS count FROM agent_messages WHERE conversation_id = ?').get('conv-answer-deadline') as { count: number }).count, 2)
releaseAnswer?.({ answer: 'late private model output', sources: [] })
await new Promise((resolve) => setTimeout(resolve, 30))
assert.equal(
  (db.prepare('SELECT COUNT(*) AS count FROM agent_messages WHERE conversation_id = ?').get('conv-answer-deadline') as { count: number }).count,
  2,
  'late model completion must not append or replace the persisted fallback answer',
)

const chitchatResponse = responseRecorder()
await handleAgentQa({
  user: { userId: 'user-a', username: 'demo', role: 'user' },
  body: { question: '你好', conversationId: 'conv-chitchat', retrievalMode: 'hybrid' },
}, chitchatResponse, {
  ...dependencies,
  async generateAnswer() {
    throw new Error('chitchat must not require an LLM provider')
  },
})
assert.equal(chitchatResponse.statusCode, 200)
assert.match(
  String((chitchatResponse.jsonBody as { answer?: string })?.answer),
  /地质|矿产|知识图谱/,
  'chitchat must remain useful without a configured LLM provider',
)

const noEvidenceRegistry = createAgentToolRegistry({
  async searchDocuments() { return { output: { results: [] }, evidenceCount: 0 } },
  async queryKnowledgeGraph() { return { output: { results: [] }, evidenceCount: 0 } },
  async spatialQuery() { return { output: { data: { markers: [], polylines: [] } }, evidenceCount: 0 } },
  async getEntityDetail() { return { output: null, evidenceCount: 0 } },
})
const noEvidenceResponse = responseRecorder()
await handleAgentQa({
  user: { userId: 'user-a', username: 'demo', role: 'user' },
  body: { question: 'How is Demo Deposit hosted?', conversationId: 'conv-no-evidence', retrievalMode: 'kg' },
}, noEvidenceResponse, {
  ...dependencies,
  orchestrator: { ...dependencies.orchestrator, registry: noEvidenceRegistry },
  async generateAnswer() {
    return { answer: 'Demo Deposit is hosted in a concealed intrusive body.', sources: [] }
  },
})
assert.match(String((noEvidenceResponse.jsonBody as { answer?: string })?.answer), /证据不足|无法确认/)
assert.deepEqual((noEvidenceResponse.jsonBody as { citations?: unknown[] })?.citations, [])

db.close()
console.log('[PASS] backward-compatible Agent JSON and SSE contract')
