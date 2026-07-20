import assert from 'node:assert/strict'
import { buildRetrievalConfigResponse } from './retrieval-status.js'
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

const response = buildRetrievalConfigResponse(settings, {
  flask: {
    available: true,
    retrieval: {
      bge: { available: false, reason: 'BGE 向量尚未加载' },
      tfidf: { available: true, reason: null },
    },
  },
  neo4j: { available: true, reason: null, nodes: 612 },
  spatial: { available: true, source: 'mock', demo: true, featureCount: 1306 },
  bert: { available: true, path: 'models/bert-ner', updatedAt: '2026-07-13T10:00:00.000Z' },
  owl: { available: false, path: 'output/geo_planning.owl', updatedAt: null },
})

assert.equal(response.loaded, true)
assert.deepEqual(response.settings, settings)
assert.equal(response.capabilities.find((item) => item.key === 'bge')?.available, false)
assert.equal(response.capabilities.find((item) => item.key === 'tfidf')?.available, true)
assert.equal(response.capabilities.find((item) => item.key === 'kg')?.details, '612 个节点')
assert.equal(response.capabilities.find((item) => item.key === 'spatial')?.demo, true)
assert.match(response.capabilities.find((item) => item.key === 'spatial')?.reason ?? '', /演示/)

const bert = response.offlineArtifacts.find((item) => item.key === 'bert')
assert.equal(bert?.available, true)
assert.equal(bert?.online, false, 'BERT artifact must not be presented as an online retrieval path')
const owl = response.offlineArtifacts.find((item) => item.key === 'owl')
assert.equal(owl?.available, false)
assert.match(owl?.reason ?? '', /未找到/)

console.log('[PASS] retrieval status: online capabilities and offline artifacts are distinguished')
