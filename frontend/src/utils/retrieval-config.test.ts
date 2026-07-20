import assert from 'node:assert/strict'
import {
  toRuntimeSettingsPayload,
  parseRetrievalConfigResponse,
  validateRuntimeSettingsForm,
} from './retrieval-config.js'
import type { RetrievalConfigResponse } from '../types/index.js'

const response: RetrievalConfigResponse = {
  loaded: true,
  message: 'loaded',
  settings: {
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
  },
  capabilities: [{
    key: 'spatial', label: '空间检索', available: true, enabled: true,
    reason: '演示数据', demo: true,
  }],
  offlineArtifacts: [],
}

const before = structuredClone(response)
const payload = toRuntimeSettingsPayload(response.settings)
assert.deepEqual(payload, {
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
})
assert.deepEqual(response, before, 'building a save payload must not mutate the form response')
assert.equal('capabilities' in payload, false)
assert.equal('updatedAt' in payload, false)

assert.deepEqual(validateRuntimeSettingsForm(response.settings), {})
assert.deepEqual(
  validateRuntimeSettingsForm({ ...response.settings, ragTopK: 0, kgWeight: 2 }),
  { ragTopK: 'Top-K 必须是 1 到 20 的整数', kgWeight: '知识图谱权重必须在 0 到 1 之间' },
)
assert.equal(parseRetrievalConfigResponse(response).settings.ragMode, 'bge')
assert.throws(
  () => parseRetrievalConfigResponse({ paths: [], topK: 5 }),
  /接口结构不兼容，请重启后端服务/,
)

console.log('[PASS] retrieval config form: payload whitelist and field validation')
