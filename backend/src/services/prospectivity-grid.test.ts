import assert from 'node:assert/strict'
import { matchMockSpatial } from '../data/spatial-mock.js'
import { analyzeSpatialQuery } from './spatial.js'
import { buildProspectivityGrid, prospectivityGridEntityTypes } from './prospectivity-grid.js'

assert.deepEqual(prospectivityGridEntityTypes, ['Mineral', 'Rock', 'Structure'])

const data = matchMockSpatial('攀西钒钛磁铁矿构造有利度')
const result = buildProspectivityGrid(data, {
  gridSizeKm: 10,
  minimumScore: 85,
})

assert.equal(result.gridSizeKm, 10)
assert.equal(result.minimumScore, 85)
assert.equal(result.demo, true)
assert.ok(result.cells.length > 0)
assert.ok(result.cells.length < 5000)
assert.ok(result.cells.every((cell) => cell.score >= 0 && cell.score <= 100))
assert.ok(result.cells.every((cell) =>
  cell.factors.reduce((sum, factor) => sum + factor.maxScore, 0) === 100
))
assert.ok(result.cells.some((cell) => cell.pointCount > 0))
assert.ok(result.targets.length > 0, 'mock dataset should produce at least one high-score demo target')
assert.ok(result.targets.every((target) => target.minimumScore === 85))
assert.ok(result.targets.every((target) => target.averageScore >= 85))
assert.ok(result.targets.every((target) => target.demo))
assert.ok(result.targets.some((target) => target.cellCount > 1 && target.coordinates.length < target.cellCount))
assert.match(result.disclaimer, /演示/)

const dynamicData = {
  markers: [{
    id: 'dynamic-mineral',
    name: '动态评分矿点',
    type: 'Mineral',
    lng: 101.7,
    lat: 26.5,
    mineralKind: '钒钛磁铁矿',
    era: '晚二叠世',
    depositType: '岩浆分异型',
    owlTypes: ['StructurallyControlledMineral'],
    evidence: '受区域断裂控制',
  }],
  polylines: [{
    id: 'dynamic-fault',
    type: 'Structure',
    label: '测试断裂',
    path: [[101.65, 26.45], [101.75, 26.55]] as Array<[number, number]>,
  }],
}
const matchingGrid = buildProspectivityGrid(dynamicData, {
  gridSizeKm: 5,
  minimumScore: 85,
  criteria: {
    mineralKinds: ['钒钛磁铁矿'],
    timePeriods: ['晚二叠世'],
    depositTypes: ['岩浆分异型'],
  },
})
const mismatchingGrid = buildProspectivityGrid(dynamicData, {
  gridSizeKm: 5,
  minimumScore: 85,
  criteria: {
    mineralKinds: ['金矿'],
    timePeriods: ['第四纪'],
    depositTypes: ['热液型'],
  },
})
const bestGeologyScore = (grid: typeof matchingGrid) => Math.max(
  ...grid.cells.map((cell) => cell.factors.find((factor) => factor.key === 'geology')?.score ?? 0),
)
assert.equal(bestGeologyScore(matchingGrid), 15)
assert.equal(bestGeologyScore(mismatchingGrid), 0)
assert.ok(Math.max(...matchingGrid.cells.map((cell) => cell.score)) > Math.max(...mismatchingGrid.cells.map((cell) => cell.score)))

const analyzed = await analyzeSpatialQuery({
  question: '用10公里网格预测攀西钒钛磁铁矿靶区',
  includeMock: true,
  entityTypes: [...prospectivityGridEntityTypes],
})
const analyzedGrid = buildProspectivityGrid(analyzed.data, {
  gridSizeKm: 10,
  minimumScore: 85,
  criteria: analyzed.analysis.interpretation,
})
assert.ok(analyzed.data.polylines.length > 0)
assert.ok(analyzedGrid.targets.length > 0)

const empty = buildProspectivityGrid({ markers: [], polylines: [] }, {
  gridSizeKm: 10,
  minimumScore: 85,
})
assert.deepEqual(empty.cells, [])
assert.deepEqual(empty.targets, [])
assert.ok(empty.warnings.length > 0)

console.log(`[PASS] prospectivity grid: ${result.cells.length} cells, ${result.targets.length} targets`)
