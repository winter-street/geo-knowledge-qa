import assert from 'node:assert/strict'
import {
  gridCellColor,
  gridCellDetails,
  gridTargetDetails,
  gridTargetSummary,
} from './prospectivity-grid.js'
import type { ProspectivityTarget } from '../types/index.js'

assert.equal(gridCellColor(90), '#B83A1F')
assert.equal(gridCellColor(80), '#B8860B')
assert.equal(gridCellColor(65), '#B8860B')
assert.equal(gridCellColor(64.9), '#2E7D5B')
assert.equal(gridCellColor(60), '#2E7D5B')

const target: ProspectivityTarget = {
  id: 'target-1',
  name: '演示靶区 A',
  coordinates: [],
  cellCount: 5,
  areaKm2: 493.2,
  averageScore: 91.5,
  maxScore: 97,
  pointCount: 18,
  minimumScore: 85,
  dominantMineralKind: '钒钛磁铁矿',
  dominantEra: '晚二叠世',
  demo: true,
}

assert.match(gridTargetSummary(target), /演示靶区 A/)
assert.match(gridTargetSummary(target), /493.2 km²/)
assert.match(gridTargetSummary(target), /晚二叠世/)

const cellDetails = gridCellDetails({
  id: 'grid-1',
  coordinates: [[[101, 26], [102, 26], [102, 27], [101, 27], [101, 26]]],
  center: [101.5, 26.5],
  score: 88,
  level: 'high',
  factors: [
    { key: 'structure', label: '构造邻近度', score: 36, maxScore: 40, evidence: '距断裂 1.2 km' },
    { key: 'density', label: '矿点密度', score: 22, maxScore: 25, evidence: '邻近 5 个矿点' },
    { key: 'ontology', label: 'OWL/KG 证据', score: 17, maxScore: 20, evidence: '命中 3 条关系' },
    { key: 'geology', label: '地质一致性', score: 13, maxScore: 15, evidence: '矿种与时代一致' },
  ],
  pointCount: 2,
  dominantMineralKind: '钒钛磁铁矿',
  dominantEra: '晚二叠世',
  demo: true,
})
assert.equal(cellDetails.factors.length, 4)
assert.match(cellDetails.disclaimer, /不作为实际勘查结论/)

const targetDetails = gridTargetDetails(target)
assert.match(targetDetails.metrics, /均分 91.5/)
assert.match(targetDetails.metrics, /最高 97/)
assert.match(targetDetails.disclaimer, /不作为实际勘查结论/)

console.log('[PASS] prospectivity grid UI: score colors and target summary')
