import assert from 'node:assert/strict'
import { buildMapPlan } from './map-plan.js'
import type { SpatialAnalysis, SpatialRegionSummary } from '../types/index.js'

function region(region: string): SpatialRegionSummary {
  return {
    region,
    count: 10,
    mineralCount: 8,
    rockCount: 2,
    structureCount: 1,
    highProspectivityCount: 3,
    averageProspectivityScore: 84,
    maxProspectivityScore: 92,
    centroid: [102, 27],
    bbox: [101, 26, 103, 28],
  }
}

function analysis(question: string, regions: string[]): SpatialAnalysis {
  return {
    interpretation: {
      originalText: question,
      spatialIntent: true,
      entityTypes: ['Mineral'],
      mineralKinds: question.includes('钒钛') ? ['钒钛磁铁矿'] : [],
      timePeriods: question.includes('晚二叠世') ? ['晚二叠世'] : [],
      depositTypes: [],
      owlTypes: [],
      sortBy: question.includes('有利度') || question.includes('预测') ? 'score' : 'name',
    },
    summary: {
      candidateCount: 20,
      matchedCount: 20,
      pointCount: 18,
      lineCount: 2,
      mockCount: 20,
      highProspectivityCount: 5,
      mediumProspectivityCount: 8,
      lowProspectivityCount: 5,
    },
    temporal: { buckets: [], unknownEraCount: 0 },
    regions: regions.map(region),
    warnings: [],
  }
}

const comparisonQuestion = '对比攀西和东天山的钒钛磁铁矿有利度'
const comparison = buildMapPlan(
  comparisonQuestion,
  analysis(comparisonQuestion, ['攀西钒钛成矿带', '东天山成矿带']),
)
assert.deepEqual(comparison?.actions.map((item) => item.type), [
  'query', 'filter-region', 'set-result-mode', 'compare-regions', 'fit-bounds',
])
assert.equal(comparison?.openFullMap, false)
assert.deepEqual(comparison?.actions[1], {
  type: 'filter-region',
  regions: ['攀西钒钛成矿带', '东天山成矿带'],
})

const gridQuestion = '用10公里网格预测攀西钒钛磁铁矿靶区'
const grid = buildMapPlan(gridQuestion, analysis(gridQuestion, ['攀西钒钛成矿带']))
assert.equal(grid?.openFullMap, false)
assert.deepEqual(grid?.actions.map((item) => item.type), [
  'query', 'filter-region', 'set-result-mode', 'grid-prediction', 'fit-bounds',
])
assert.deepEqual(grid?.actions[3], {
  type: 'grid-prediction',
  gridSizeKm: 10,
  minimumScore: 85,
})

const bufferQuestion = '显示攀西断裂10公里范围内的高有利矿点'
const buffer = buildMapPlan(bufferQuestion, analysis(bufferQuestion, ['攀西钒钛成矿带']))
assert.deepEqual(buffer?.actions.map((item) => item.type), [
  'query', 'filter-region', 'set-result-mode', 'buffer', 'fit-bounds',
])
assert.deepEqual(buffer?.actions[3], {
  type: 'buffer', radiusKm: 10, anchorName: '攀西断裂', targetType: 'Structure',
})

const heatmap = buildMapPlan('打开地图查看全国矿产热力分布')
assert.deepEqual(heatmap?.actions.map((item) => item.type), ['query', 'heatmap', 'fit-bounds'])
assert.equal(heatmap?.openFullMap, true)

const exportPlan = buildMapPlan('导出当前空间分析结果为GeoJSON')
assert.equal(exportPlan?.actions.at(-1)?.type, 'suggest-export')
assert.deepEqual(exportPlan?.actions.at(-1), { type: 'suggest-export', format: 'geojson' })

assert.equal(buildMapPlan('你好，介绍一下你自己'), undefined)

console.log('[PASS] map plan: comparison, grid, buffer, heatmap and export actions')
