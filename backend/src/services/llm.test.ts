import assert from 'node:assert/strict'
import { buildPrompt } from './llm.js'
import type { SpatialAnalysis, SpatialData } from '../types/index.js'

const prompt = buildPrompt('攀枝花钒钛磁铁矿受哪些构造控制？', [], [
  { from: '磁铁矿', relation: '赋存于', relationType: 'HOSTED_IN', to: '辉长岩' },
  {
    from: '攀枝花钒钛磁铁矿', relation: '受控于', relationType: 'CONTROLLED_BY',
    to: '演示断裂', isMock: true, source: 'spatial-demo-v1',
  },
], 'kg')

assert.match(prompt, /「磁铁矿」—\[赋存于\]→「辉长岩」/)
assert.doesNotMatch(prompt, /演示断裂|spatial-demo-v1/)
assert.match(prompt, /开头用 1 至 2 句话直接回答/)
assert.match(prompt, /2 至 4 个无序要点/)
assert.match(prompt, /300 至 500 个汉字/)
assert.doesNotMatch(prompt, /在回答末尾用列表列出关键地质实体/)
assert.doesNotMatch(prompt, /可以补充.*现有资料还覆盖/)

function spatialContext(spatialIntent: boolean): { data: SpatialData; analysis: SpatialAnalysis } {
  return {
    data: { markers: [{ id: 'm1', name: '测试矿点', type: 'Mineral', lng: 102, lat: 27 }], polylines: [] },
    analysis: {
      interpretation: {
        originalText: '测试问题', spatialIntent, entityTypes: ['Mineral'], mineralKinds: [],
        timePeriods: [], depositTypes: [], owlTypes: [], sortBy: 'name',
      },
      summary: {
        candidateCount: 1, matchedCount: 1, pointCount: 1, lineCount: 0, mockCount: 0,
        highProspectivityCount: 0, mediumProspectivityCount: 0, lowProspectivityCount: 0,
      },
      temporal: { buckets: [], unknownEraCount: 1 },
      regions: [],
      warnings: [],
    },
  }
}

assert.doesNotMatch(buildPrompt('介绍矿床构造', [], [], 'hybrid', spatialContext(false)), /空间分析上下文/)
assert.match(buildPrompt('测试矿点在哪里？', [], [], 'hybrid', spatialContext(true)), /空间分析上下文/)
console.log('[PASS] LLM prompt keeps answers concise and isolates demo/spatial context')
