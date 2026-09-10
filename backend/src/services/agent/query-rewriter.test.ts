import assert from 'node:assert/strict'
import { createLlmQueryRewriter } from './query-rewriter.js'

let calls = 0
const rewrite = createLlmQueryRewriter(async (_system, _user, definitions) => {
  calls += 1
  assert.deepEqual(definitions.map((definition) => definition.name), ['rewrite_query'])
  return [{
    id: 'rewrite-1',
    name: 'rewrite_query',
    arguments: { rewrittenQuestion: '新疆东部铜矿构造控矿证据' },
  }]
})

assert.equal(await rewrite({
  question: '新疆铜矿',
  intent: 'geology_qa',
  retrievalMode: 'hybrid',
  linkedEntities: [],
  reasonCodes: ['NO_EVIDENCE'],
}), '新疆东部铜矿构造控矿证据')
assert.equal(calls, 1)

const fallback = createLlmQueryRewriter(async () => {
  throw new Error('provider unavailable')
})
assert.equal(await fallback({
  question: '它在哪里',
  intent: 'entity_lookup',
  retrievalMode: 'kg',
  linkedEntities: [{
    id: 'entity-1',
    name: '测试矿床',
    type: 'Mineral',
    confidence: 0.9,
    matchedBy: 'context',
    disambiguation: 'active entity',
  }],
  reasonCodes: ['MISSING_KG_EVIDENCE'],
}), '测试矿床 它在哪里')

console.log('[PASS] structured LLM query rewrite with deterministic fallback')
