import assert from 'node:assert/strict'
import {
  createMessageMapPlan,
  mapPlanLabels,
  filterSpatialTaskData,
  reduceMapPlan,
  requiresFullMap,
  toMapViewState,
  type SpatialTaskSnapshot,
} from './map-plan.js'
import type { MapPlan } from '../types/index.js'

const plan: MapPlan = {
  id: 'plan-grid-1',
  version: 1,
  title: '攀西靶区分析',
  autoExecute: true,
  openFullMap: true,
  actions: [
    { type: 'query', question: '用10公里网格预测攀西晚二叠世钒钛磁铁矿靶区' },
    { type: 'filter-region', regions: ['攀西钒钛成矿带'] },
    { type: 'filter-era', eras: ['晚二叠世'] },
    { type: 'set-result-mode', mode: 'score' },
    { type: 'grid-prediction', gridSizeKm: 10, minimumScore: 85 },
    { type: 'fit-bounds' },
  ],
  warnings: [],
}

const snapshot = reduceMapPlan(plan)
assert.equal(snapshot.planId, 'plan-grid-1')
assert.equal(snapshot.resultMode, 'score')
assert.deepEqual(snapshot.selectedRegions, ['攀西钒钛成矿带'])
assert.deepEqual(snapshot.selectedEras, ['晚二叠世'])
assert.deepEqual(snapshot.grid, { gridSizeKm: 10, minimumScore: 85 })
assert.equal(snapshot.actionResults.length, plan.actions.length)
assert.ok(snapshot.actionResults.every((item) => item.status === 'pending'))

const repeated = reduceMapPlan(plan, snapshot)
assert.equal(repeated, snapshot, 'same plan must not be reduced twice')

const exportPlan: MapPlan = {
  ...plan,
  id: 'plan-export-1',
  actions: [{ type: 'suggest-export', format: 'csv' }],
}
const exportSnapshot = reduceMapPlan(exportPlan)
assert.equal(exportSnapshot.exportSuggestion, 'csv')

const restored: SpatialTaskSnapshot = JSON.parse(JSON.stringify(snapshot))
assert.equal(restored.grid?.gridSizeKm, 10)

assert.deepEqual(mapPlanLabels(plan), [
  '空间查询', '区域筛选', '年代筛选', '有利度排序', '网格预测', '地图定位',
])
assert.equal(requiresFullMap(plan), true)
assert.equal(requiresFullMap({ ...plan, openFullMap: false, actions: [{ type: 'query', question: '攀西' }] }), false)

const filtered = filterSpatialTaskData({
  ...snapshot,
  buffer: { radiusKm: 10, targetType: 'Structure' },
  data: {
    markers: [
      { id: 'a', name: 'A', type: 'Mineral', lng: 102, lat: 27, region: '攀西钒钛成矿带', era: '晚二叠世', nearestStructureKm: 5 },
      { id: 'b', name: 'B', type: 'Mineral', lng: 103, lat: 28, region: '攀西钒钛成矿带', era: '晚二叠世', nearestStructureKm: 15 },
      { id: 'c', name: 'C', type: 'Mineral', lng: 90, lat: 40, region: '东天山成矿带', era: '晚二叠世', nearestStructureKm: 2 },
    ],
    polylines: [],
  },
})
assert.deepEqual(filtered.markers?.map((marker) => marker.id), ['a'])

const viewState = toMapViewState({
  ...snapshot,
  heatmapEnabled: true,
  timeline: { mode: 'play' },
})
assert.equal(viewState.selectedRegion, '攀西钒钛成矿带')
assert.equal(viewState.selectedEra, '晚二叠世')
assert.equal(viewState.resultMode, 'score')
assert.equal(viewState.heatmapVisible, true)
assert.equal(viewState.timelineMode, 'play')

const messagePlan = createMessageMapPlan('msg-123', '攀枝花钒钛磁铁矿受哪些构造控制？')
assert.deepEqual(messagePlan, {
  id: 'qa-msg-123', version: 1, title: '问答空间结果', autoExecute: true, openFullMap: false,
  actions: [
    { type: 'query', question: '攀枝花钒钛磁铁矿受哪些构造控制？' },
    { type: 'fit-bounds' },
  ],
  warnings: [],
})
assert.deepEqual(createMessageMapPlan('msg-123', '攀枝花钒钛磁铁矿受哪些构造控制？'), messagePlan)

console.log('[PASS] map task reducer: filters, grid, export and duplicate protection')
