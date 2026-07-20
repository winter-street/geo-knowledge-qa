import assert from 'node:assert/strict'
import {
  applyRagWeight,
  buildPathUsed,
  hasAvailableRetrievalPath,
  resolveRetrievalPolicy,
} from './retrieval-policy.js'
import type { RuntimeSettings } from './runtime-settings.js'

const settings: RuntimeSettings = {
  ragEnabled: true,
  ragMode: 'bge',
  ragWeight: 0.35,
  ragTopK: 5,
  kgEnabled: true,
  kgWeight: 0.4,
  spatialEnabled: true,
  spatialWeight: 0.25,
  llmModel: 'deepseek-chat',
  maxTokens: 2048,
  temperature: 0.3,
  updatedAt: null,
  updatedBy: null,
}

assert.deepEqual(resolveRetrievalPolicy('hybrid', settings), {
  useRag: true,
  useKg: true,
  useSpatial: true,
  ragMode: 'bge',
  ragTopK: 5,
  ragWeight: 0.35,
  kgWeight: 0.4,
  spatialWeight: 0.25,
})

const adminDisabled = { ...settings, ragEnabled: false, spatialEnabled: false }
assert.equal(resolveRetrievalPolicy('hybrid', adminDisabled).useRag, false)
assert.equal(resolveRetrievalPolicy('rag', adminDisabled).useRag, false, 'request cannot bypass admin switch')
assert.equal(resolveRetrievalPolicy('rag', settings).useKg, false, 'request can narrow configured paths')
assert.equal(resolveRetrievalPolicy('kg', settings).useRag, false)

const weighted = applyRagWeight([
  { chunk: { id: 1, content: 'A', docTitle: 'A', page: 1, docType: '' }, score: 0.8 },
  { chunk: { id: 2, content: 'B', docTitle: 'B', page: 1, docType: '' }, score: 0.4 },
], 0.5)
assert.deepEqual(weighted.map((item) => item.score), [0.4, 0.2])
assert.equal(weighted[0]?.rawScore, 0.8)

assert.deepEqual(buildPathUsed({
  policy: resolveRetrievalPolicy('hybrid', settings),
  ragSucceeded: true,
  ragCount: 3,
  kgCount: 2,
  spatialCount: 4,
}), ['bge', 'kg', 'spatial'])

const zeroWeight = resolveRetrievalPolicy('rag', { ...settings, ragWeight: 0 })
assert.equal(zeroWeight.useRag, true, 'zero weight lowers priority but does not disable retrieval')

assert.equal(hasAvailableRetrievalPath(resolveRetrievalPolicy('kg', settings), {
  ragSucceeded: false,
  kgSucceeded: false,
  spatialSucceeded: false,
}), false, 'an offline KG-only request has no available retrieval path')
assert.equal(hasAvailableRetrievalPath(resolveRetrievalPolicy('hybrid', settings), {
  ragSucceeded: true,
  kgSucceeded: false,
  spatialSucceeded: true,
}), true)

console.log('[PASS] retrieval policy: admin intersection, weights and actual path labels')
