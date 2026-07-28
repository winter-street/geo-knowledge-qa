import assert from 'node:assert/strict'
import { buildAgentMemory, rewriteFollowUpQuestion } from './memory.js'
import type { AgentMessage, LinkedEntity } from '../../types/index.js'

const messages: AgentMessage[] = Array.from({ length: 14 }, (_, index) => ({
  id: `m-${index + 1}`,
  role: index % 2 === 0 ? 'user' : 'assistant',
  content: `消息 ${index + 1}`,
  createdAt: `2026-07-27T00:${String(index).padStart(2, '0')}:00.000Z`,
}))
const entities: LinkedEntity[] = [
  {
    id: 'mineral-a', name: '演示矿床 A', type: 'Mineral', confidence: 1,
    matchedBy: 'name', disambiguation: '名称精确匹配',
  },
  {
    id: 'mineral-b', name: '演示矿床 B', type: 'Mineral', confidence: 0.95,
    matchedBy: 'alias', disambiguation: '别名匹配',
  },
]

const memory = buildAgentMemory(messages, '此前讨论了两个演示矿床。', entities)
assert.equal(memory.recentMessages.length, 12, 'six turns retain at most twelve messages')
assert.equal(memory.recentMessages[0]?.id, 'm-3')
assert.deepEqual(memory.activeEntities, entities)

assert.equal(rewriteFollowUpQuestion('它赋存在哪里？', memory), '演示矿床 A赋存在哪里？')
assert.equal(
  rewriteFollowUpQuestion('比较刚才两个矿床的成矿时代', memory),
  '比较演示矿床 A与演示矿床 B的成矿时代',
)
assert.equal(
  rewriteFollowUpQuestion('磁铁矿通常形成于什么时期？', memory),
  '磁铁矿通常形成于什么时期？',
)
assert.equal(
  rewriteFollowUpQuestion('它赋存在哪里？', { ...memory, activeEntities: [] }),
  '它赋存在哪里？',
)

console.log('[PASS] six-turn agent memory and follow-up rewriting')
