import assert from 'node:assert/strict'
import Database from 'better-sqlite3'
import { createAppStateStore } from './app-state.js'
import type { LinkedEntity } from '../types/index.js'

const db = new Database(':memory:')
const store = createAppStateStore(db)
const activeEntities: LinkedEntity[] = [{
  id: 'm-a', name: '演示矿床 A', type: 'Mineral', confidence: 1,
  matchedBy: 'name', disambiguation: '名称精确匹配',
}]

store.createConversation('user-a', 'conv-1', '演示会话')
store.appendMessage('user-a', 'conv-1', {
  id: 'msg-1', role: 'user', content: '介绍演示矿床 A', createdAt: '2026-07-27T00:00:00.000Z',
})
store.saveMemory('user-a', 'conv-1', '正在讨论演示矿床 A。', activeEntities)

assert.equal(store.getConversation('user-a', 'conv-1')?.title, '演示会话')
assert.equal(store.getConversation('user-b', 'conv-1'), undefined, 'another JWT user cannot read the conversation')
assert.equal(store.getRecentMessages('user-a', 'conv-1', 6).length, 1)
assert.equal(store.loadMemory('user-a', 'conv-1').activeEntities[0]?.id, 'm-a')
assert.throws(
  () => store.appendMessage('user-b', 'conv-1', {
    id: 'msg-2', role: 'user', content: '越权消息', createdAt: '2026-07-27T00:01:00.000Z',
  }),
  /conversation not found/i,
)

store.createAgentRun({
  id: 'run-1', userId: 'user-a', conversationId: 'conv-1', intent: 'entity_lookup',
  status: 'running', createdAt: '2026-07-27T00:00:01.000Z',
})
store.recordToolCall({
  id: 'tool-1', runId: 'run-1', userId: 'user-a', toolName: 'get_entity_detail',
  argumentSummary: { entityId: 'm-a', chainOfThought: 'must never persist' },
  status: 'completed', latencyMs: 12, evidenceCount: 1,
  createdAt: '2026-07-27T00:00:02.000Z',
})
store.finishAgentRun('user-a', 'run-1', 'completed', 24)

const trace = store.getToolCalls('user-a', 'run-1')
assert.equal(trace.length, 1)
assert.deepEqual(trace[0]?.argumentSummary, { entityId: 'm-a' })
assert.equal(trace[0]?.latencyMs, 12)
assert.deepEqual(store.getToolCalls('user-b', 'run-1'), [], 'tool traces are user scoped')

db.close()
console.log('[PASS] isolated application state and sanitized tool traces')
