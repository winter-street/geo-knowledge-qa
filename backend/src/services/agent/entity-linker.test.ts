import assert from 'node:assert/strict'
import { linkEntities } from './entity-linker.js'
import type { EntityLinkCandidate, LinkedEntity } from '../../types/index.js'

const candidates: EntityLinkCandidate[] = [
  { id: 'm-a', name: '演示矿床 A', type: 'Mineral', aliases: ['A 矿'] },
  { id: 'm-b', name: '演示矿床 B', type: 'Mineral', aliases: ['B 矿'] },
  { id: 's-a', name: '演示断裂 A', type: 'Structure', aliases: ['中央断裂'] },
]

const aliasResult = linkEntities('A 矿主要赋存在哪里？', candidates, [])
assert.equal(aliasResult.requiresClarification, false)
assert.equal(aliasResult.entities[0]?.id, 'm-a')
assert.equal(aliasResult.entities[0]?.matchedBy, 'alias')
assert.equal(aliasResult.entities[0]?.confidence, 0.95)

const active: LinkedEntity[] = [{
  id: 'm-b', name: '演示矿床 B', type: 'Mineral', confidence: 1,
  matchedBy: 'name', disambiguation: '上一轮活动实体',
}]
const contextResult = linkEntities('它的成矿时代是什么？', candidates, active)
assert.equal(contextResult.entities[0]?.id, 'm-b')
assert.equal(contextResult.entities[0]?.matchedBy, 'context')

const ambiguous = linkEntities('中央构造在哪里？', [
  { id: 's-1', name: '演示断裂 A', type: 'Structure', aliases: ['中央构造'] },
  { id: 's-2', name: '演示断裂 B', type: 'Structure', aliases: ['中央构造'] },
], [])
assert.equal(ambiguous.requiresClarification, true)
assert.deepEqual(ambiguous.entities.map((item) => item.id), ['s-1', 's-2'])

const explicitComparison = linkEntities('比较演示矿床 A 和演示矿床 B', candidates, [])
assert.equal(
  explicitComparison.requiresClarification,
  false,
  'two explicitly named entities are comparison targets, not ambiguous candidates',
)
assert.deepEqual(explicitComparison.entities.map((item) => item.id), ['m-a', 'm-b'])

console.log('[PASS] deterministic entity linking and ambiguity detection')
